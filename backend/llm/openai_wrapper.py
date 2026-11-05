"""
OpenAI-compatible LLM wrapper.

Uses the OpenAI Chat Completions and Embeddings HTTP APIs directly so the app
does not need the OpenAI Python SDK installed.

Strict single-provider architecture:
- Routes every chat/reasoning/summary call through OpenAI HTTP API.
- Sends payload with ONLY {"model": configured_model, "messages": [...]}.
- Does not transmit temperature or unverified optional parameters.
- Standardizes wrapper results as success/response or success=false/error.
- Never logs API keys or investigation content.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional

import requests

logger = logging.getLogger("aml.llm.openai_wrapper")

_raw_base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
if _raw_base.endswith("/chat/completions"):
    _raw_base = _raw_base[:-len("/chat/completions")].rstrip("/")
DEFAULT_BASE_URL = _raw_base
DEFAULT_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_DEFAULT_MODEL") or "openai.gpt-5.6-luna"
DEFAULT_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL") or os.getenv("LLM_EMBED_MODEL") or "vertex_ai.gemini-embedding-2"
REQUEST_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT") or os.getenv("LLM_TIMEOUT") or "180")


def _verify_ssl() -> bool:
    val = os.getenv("OPENAI_VERIFY_SSL", "true").strip().lower()
    return val not in {"0", "false", "no", "off"}


class OpenAIWrapper:
    provider_name = "openai"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        default_model: str = DEFAULT_MODEL,
        embedding_model: str = DEFAULT_EMBED_MODEL,
    ):
        raw_api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY")
        self.api_key = str(raw_api_key or "").strip().strip('"').strip("'")

        cleaned_url = str(base_url or DEFAULT_BASE_URL).strip().rstrip("/")
        if cleaned_url.endswith("/chat/completions"):
            cleaned_url = cleaned_url[:-len("/chat/completions")].rstrip("/")
        self.base_url = cleaned_url

        self.default_model = default_model or DEFAULT_MODEL
        self.embedding_model = embedding_model or DEFAULT_EMBED_MODEL
        self.conversation_history: List[Dict[str, str]] = []
        self._connection_checked = False
        self._connection_ok = False

    def _get_context_overrides(self) -> tuple[str, str, str]:
        model = self.default_model
        base_url = self.base_url
        api_key = self.api_key
        return model, base_url, api_key

    def _chat_url(self) -> str:
        _, base_url, _ = self._get_context_overrides()
        base = base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"

    def _embeddings_url(self) -> str:
        _, base_url, _ = self._get_context_overrides()
        base = base_url.rstrip("/")
        if base.endswith("/embeddings"):
            return base
        return f"{base}/embeddings"

    def _headers(self) -> Dict[str, str]:
        _, _, api_key = self._get_context_overrides()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if api_key:
            headers["api-key"] = api_key
        return headers

    def check_connection(self) -> bool:
        if not self.api_key:
            return False
        if os.getenv("OPENAI_SKIP_CONNECTION_CHECK", "true").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        if self._connection_checked:
            return self._connection_ok
        try:
            # Minimal health probe: check /models if supported, or assume true if gateway returns 404/405
            models_url = f"{self.base_url}/models"
            response = requests.get(
                models_url,
                headers=self._headers(),
                timeout=min(REQUEST_TIMEOUT, 6),
                verify=_verify_ssl(),
            )
            if response.status_code == 200 or response.status_code in {404, 405}:
                self._connection_ok = True
            else:
                self._connection_ok = False
        except Exception as exc:
            logger.debug("OpenAI connection probe failed: %s", type(exc).__name__)
            self._connection_ok = False
        self._connection_checked = True
        return self._connection_ok

    def list_models(self) -> List[str]:
        dyn_model, _, _ = self._get_context_overrides()
        chosen = dyn_model or self.default_model or os.getenv("OPENAI_MODEL") or DEFAULT_MODEL
        if chosen.startswith("openai:"):
            chosen = chosen[7:]
        return [chosen]

    def _chat_payload(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        stream: bool = False,
        temperature: Optional[float] = None,  # accepted for caller compatibility, never transmitted
        max_tokens: Optional[int] = None,      # accepted for caller compatibility, never transmitted
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Construct the minimal chat payload required by the gateway.
        
        ONLY transmits {'model': ..., 'messages': [...]}.
        Omits temperature, max_tokens, and any extra parameters rejected by gateways.
        """
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": str(system_prompt)})
        for item in history or []:
            role = "assistant" if str(item.get("role")).lower() == "assistant" else "user"
            messages.append({"role": role, "content": str(item.get("content") or "")})
        messages.append({"role": "user", "content": str(prompt or "")})

        dyn_model, _, _ = self._get_context_overrides()
        chosen_model = model or dyn_model or self.default_model or os.getenv("OPENAI_MODEL") or DEFAULT_MODEL
        if chosen_model.startswith("openai:"):
            chosen_model = chosen_model[7:]

        body: Dict[str, Any] = {
            "model": chosen_model,
            "messages": messages,
        }
        if stream:
            body["stream"] = True

        return body

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Execute a completion request and return standardized success/response or error."""
        start = time.time()
        _, _, api_key = self._get_context_overrides()
        if not api_key:
            return {
                "success": False,
                "error": "OPENAI_API_KEY is not configured",
                "response": "",
                "text": "",
                "provider": self.provider_name,
            }

        try:
            payload = self._chat_payload(
                prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            )
            chat_url = self._chat_url()

            response = requests.post(
                chat_url,
                headers=self._headers(),
                json=payload,
                timeout=REQUEST_TIMEOUT,
                verify=_verify_ssl(),
            )

            latency = round(time.time() - start, 2)
            model_sent = payload.get("model")

            if response.status_code != 200:
                err_text = response.text[:400] if response.text else f"Status code {response.status_code}"
                logger.warning("LLM request failed (model=%s, status=%s)", model_sent, response.status_code)
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {err_text}",
                    "response": "",
                    "text": "",
                    "model": model_sent,
                    "provider": self.provider_name,
                    "latency_sec": latency,
                }

            data = response.json()
            choices = data.get("choices") or []
            choice = choices[0] if choices else {}
            message = choice.get("message") or {}
            content = (message.get("content") or "").strip()

            if not content:
                finish_reason = choice.get("finish_reason") or "empty_content"
                logger.warning("LLM returned blank content (model=%s, finish_reason=%s)", model_sent, finish_reason)
                return {
                    "success": False,
                    "error": f"LLM returned no content ({finish_reason})",
                    "response": "",
                    "text": "",
                    "model": model_sent,
                    "provider": self.provider_name,
                    "finish_reason": finish_reason,
                    "latency_sec": latency,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

            return {
                "success": True,
                "response": content,
                "text": content,
                "model": model_sent,
                "provider": self.provider_name,
                "finish_reason": choice.get("finish_reason"),
                "latency_sec": latency,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except requests.Timeout:
            latency = round(time.time() - start, 2)
            logger.warning("LLM request timed out after %ss", REQUEST_TIMEOUT)
            return {
                "success": False,
                "error": f"OpenAI request timeout ({REQUEST_TIMEOUT}s)",
                "response": "",
                "text": "",
                "provider": self.provider_name,
                "latency_sec": latency,
            }
        except Exception as exc:
            latency = round(time.time() - start, 2)
            logger.warning("LLM call exception: %s", type(exc).__name__)
            return {
                "success": False,
                "error": str(exc),
                "response": "",
                "text": "",
                "provider": self.provider_name,
                "latency_sec": latency,
            }

    def chat(
        self,
        message: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        use_history: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Multi-turn chat helper that maintains conversation history."""
        history = list(self.conversation_history) if use_history else []
        payload_messages = list(history)

        dyn_model, _, _ = self._get_context_overrides()
        chosen_model = model or dyn_model or self.default_model or os.getenv("OPENAI_MODEL") or DEFAULT_MODEL
        if chosen_model.startswith("openai:"):
            chosen_model = chosen_model[7:]

        start = time.time()
        _, _, api_key = self._get_context_overrides()
        if not api_key:
            return {
                "success": False,
                "error": "OPENAI_API_KEY is not configured",
                "response": "",
                "text": "",
                "provider": self.provider_name,
            }

        body_messages: List[Dict[str, str]] = []
        if system_prompt:
            body_messages.append({"role": "system", "content": str(system_prompt)})
        for item in payload_messages:
            role = "assistant" if str(item.get("role")).lower() == "assistant" else "user"
            body_messages.append({"role": role, "content": str(item.get("content") or "")})
        body_messages.append({"role": "user", "content": str(message or "")})

        payload = {
            "model": chosen_model,
            "messages": body_messages,
        }

        try:
            response = requests.post(
                self._chat_url(),
                headers=self._headers(),
                json=payload,
                timeout=REQUEST_TIMEOUT,
                verify=_verify_ssl(),
            )
            latency = round(time.time() - start, 2)

            if response.status_code != 200:
                err_text = response.text[:400] if response.text else f"Status code {response.status_code}"
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {err_text}",
                    "response": "",
                    "text": "",
                    "model": chosen_model,
                    "provider": self.provider_name,
                    "latency_sec": latency,
                }

            data = response.json()
            choices = data.get("choices") or []
            choice = choices[0] if choices else {}
            content = ((choice.get("message") or {}).get("content") or "").strip()

            if not content:
                finish_reason = choice.get("finish_reason") or "empty_content"
                return {
                    "success": False,
                    "error": f"LLM returned no content ({finish_reason})",
                    "response": "",
                    "text": "",
                    "model": chosen_model,
                    "provider": self.provider_name,
                    "finish_reason": finish_reason,
                    "latency_sec": latency,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

            if use_history:
                self.conversation_history.append({"role": "user", "content": message})
                self.conversation_history.append({"role": "assistant", "content": content})

            return {
                "success": True,
                "response": content,
                "text": content,
                "model": chosen_model,
                "provider": self.provider_name,
                "finish_reason": choice.get("finish_reason"),
                "latency_sec": latency,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except requests.Timeout:
            return {
                "success": False,
                "error": f"OpenAI request timeout ({REQUEST_TIMEOUT}s)",
                "response": "",
                "text": "",
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
            }
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "response": "",
                "text": "",
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
            }

    def stream_generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any,
    ) -> Iterator[str]:
        """Streaming generator that yields tokens from the OpenAI SSE stream."""
        _, _, api_key = self._get_context_overrides()
        if not api_key:
            yield "Error: OPENAI_API_KEY is not configured."
            return

        payload = self._chat_payload(
            prompt,
            model=model,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            **kwargs,
        )

        try:
            with requests.post(
                self._chat_url(),
                headers=self._headers(),
                json=payload,
                stream=True,
                timeout=REQUEST_TIMEOUT,
                verify=_verify_ssl(),
            ) as resp:
                if resp.status_code != 200:
                    yield f"Error: HTTP {resp.status_code}: {resp.text[:300]}"
                    return
                for line in resp.iter_lines():
                    if not line:
                        continue
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if line_str.startswith("data: "):
                        data_part = line_str[6:].strip()
                        if data_part == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_part)
                            delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
                            content = delta.get("content")
                            if content:
                                yield content
                        except Exception:
                            continue
        except Exception as exc:
            yield f"Error: {exc}"

    def generate_embedding(self, text: str, model: Optional[str] = None) -> Optional[List[float]]:
        """Generate embedding vector using the configured embedding model."""
        _, _, api_key = self._get_context_overrides()
        if not api_key:
            return None

        chosen_model = model or self.embedding_model or os.getenv("OPENAI_EMBED_MODEL") or DEFAULT_EMBED_MODEL
        if chosen_model.startswith("openai:"):
            chosen_model = chosen_model[7:]

        try:
            response = requests.post(
                self._embeddings_url(),
                headers=self._headers(),
                json={"model": chosen_model, "input": str(text or "")},
                timeout=REQUEST_TIMEOUT,
                verify=_verify_ssl(),
            )
            if response.status_code != 200:
                logger.warning("Embedding request failed (status=%s)", response.status_code)
                return None
            data = response.json().get("data") or []
            vector = (data[0] or {}).get("embedding") if data else None
            return list(vector) if vector is not None else None
        except Exception as exc:
            logger.warning("Embedding exception: %s", type(exc).__name__)
            return None

    def clear_history(self) -> None:
        self.conversation_history = []

    def get_history(self) -> List[Dict[str, str]]:
        return list(self.conversation_history)
