"""
OpenAI-compatible LLM wrapper.

Uses the OpenAI Chat Completions and Embeddings HTTP APIs directly so the app
does not need the OpenAI Python SDK installed. The rest of the code can keep
calling the same provider interface used by GPT4All/Ollama:
  - check_connection()
  - list_models()
  - generate()
  - chat()
  - generate_embedding()
"""

from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Dict, List, Optional

import requests


_raw_base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
if _raw_base.endswith("/chat/completions"):
    _raw_base = _raw_base[:-len("/chat/completions")].rstrip("/")
DEFAULT_BASE_URL = _raw_base
DEFAULT_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_DEFAULT_MODEL") or "gpt-4o-mini"
DEFAULT_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL") or os.getenv("LLM_EMBED_MODEL") or "text-embedding-3-small"
REQUEST_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT") or os.getenv("LLM_TIMEOUT") or "180")
DEFAULT_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS") or os.getenv("OPENAI_MAX_TOKENS") or "800")
DEFAULT_TOKEN_CAP = int(os.getenv("LLM_TOKEN_CAP") or os.getenv("OPENAI_TOKEN_CAP") or "4096")


def _verify_ssl() -> bool:
    val = os.getenv("OPENAI_VERIFY_SSL", "true").strip().lower()
    return val not in {"0", "false", "no", "off"}


def _bounded_tokens(requested: Optional[int], is_reasoning: bool = False) -> int:
    try:
        value = int(requested if requested is not None else DEFAULT_MAX_TOKENS)
    except Exception:
        value = DEFAULT_MAX_TOKENS
    value = max(32, value)
    if is_reasoning:
        value = max(value, 2048)
        cap = int(os.getenv("AGENTIC_REASONING_TOKEN_CAP") or "4096")
    else:
        cap = int(os.getenv("AGENTIC_LLM_TOKEN_CAP") or "2048")
    if cap > 0:
        value = min(value, cap)
    return value


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
        cleaned_url = str(base_url or DEFAULT_BASE_URL).rstrip("/")
        if cleaned_url.endswith("/chat/completions"):
            cleaned_url = cleaned_url[:-len("/chat/completions")].rstrip("/")
        self.base_url = cleaned_url
        self.default_model = default_model
        self.embedding_model = embedding_model
        self.conversation_history: List[Dict] = []
        self._connection_checked = False
        self._connection_ok = False

    def _get_context_overrides(self) -> tuple[str, str, str]:
        model = self.default_model
        base_url = self.base_url
        api_key = self.api_key
        return model, base_url, api_key

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
        if os.getenv("OPENAI_SKIP_CONNECTION_CHECK", "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        if self._connection_checked:
            return self._connection_ok
        try:
            response = requests.get(
                f"{self.base_url}/models",
                headers=self._headers(),
                timeout=min(REQUEST_TIMEOUT, 6),
                verify=_verify_ssl(),
            )
            if response.status_code == 200:
                self._connection_ok = True
            elif response.status_code in {404, 405} and self.base_url != "https://api.openai.com/v1":
                # Org GenAI proxy/gateway often only exposes /chat/completions and returns 404/405 for /models
                self._connection_ok = True
            else:
                self._connection_ok = False
        except Exception:
            self._connection_ok = False
        self._connection_checked = True
        return self._connection_ok

    def list_models(self) -> List[str]:
        if not self.api_key:
            return []
        try:
            model, base_url, _ = self._get_context_overrides()
            response = requests.get(
                f"{base_url}/models",
                headers=self._headers(),
                timeout=min(REQUEST_TIMEOUT, 15),
                verify=_verify_ssl(),
            )
            if response.status_code != 200:
                return [model]
            models = response.json().get("data") or []
            names = sorted({str(item.get("id") or "").strip() for item in models if item.get("id")})
            if model and model not in names:
                names.insert(0, model)
            return names[:100]
        except Exception:
            return [model] if model else []

    def _chat_payload(
        self,
        prompt: str,
        *,
        model: Optional[str],
        system_prompt: Optional[str],
        history: Optional[List[Dict]] = None,
        temperature: float = 0.5,
        max_tokens: int = 800,
        token_key: str = "max_tokens",
    ) -> Dict:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": str(system_prompt)})
        for message in history or []:
            role = "assistant" if str(message.get("role")).lower() == "assistant" else "user"
            messages.append({"role": role, "content": str(message.get("content") or "")})
        messages.append({"role": "user", "content": str(prompt or "")})

        dyn_model, _, _ = self._get_context_overrides()
        
        chosen_model = model or dyn_model or "gpt-4o-mini"
        if chosen_model.startswith("openai:"):
            chosen_model = chosen_model[7:]

        is_reasoning_model = any(
            chosen_model.startswith(prefix)
            for prefix in ("o1", "o3", "o4", "gpt-5", "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.2", "gpt-5.1")
        )

        body = {
            "model": chosen_model,
            "messages": messages,
        }

        # Reasoning models reject custom temperatures (only accept 1.0 or omitted)
        if not is_reasoning_model and temperature is not None:
            body["temperature"] = float(temperature)

        # Reasoning models use max_completion_tokens instead of max_tokens
        final_token_key = "max_completion_tokens" if is_reasoning_model else token_key
        body[final_token_key] = _bounded_tokens(max_tokens, is_reasoning=is_reasoning_model)
        return body

    def _post_chat(self, payload: Dict, timeout: Optional[int] = None) -> requests.Response:
        _, base_url, _ = self._get_context_overrides()
        effective_timeout = timeout or REQUEST_TIMEOUT
        # For large completions or reasoning models, ensure sufficient timeout
        token_count = int(payload.get("max_completion_tokens") or payload.get("max_tokens") or 0)
        if token_count >= 1500:
            effective_timeout = max(effective_timeout, 180)
        return requests.post(
            f"{base_url}/chat/completions",
            headers=self._headers(),
            json=payload,
            timeout=effective_timeout,
            verify=_verify_ssl(),
        )

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 800,
    ) -> Dict:
        start = time.time()
        _, _, api_key = self._get_context_overrides()
        if not api_key:
            return {"success": False, "error": "API_KEY is not configured", "provider": self.provider_name}
        try:
            payload = self._chat_payload(
                prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            response = self._post_chat(payload)

            # Auto-retry 1: temperature not supported
            if response.status_code == 400 and "temperature" in response.text:
                payload.pop("temperature", None)
                response = self._post_chat(payload)

            # Auto-retry 2: max_tokens vs max_completion_tokens
            if response.status_code == 400 and "max_tokens" in response.text:
                val = payload.pop("max_tokens", None)
                if val is not None:
                    payload["max_completion_tokens"] = val
                response = self._post_chat(payload)

            # Auto-retry 3: 429 Rate limit backoff (TPM/RPM rate limit exceeded)
            retry_count = 0
            while response.status_code == 429 and retry_count < 4:
                retry_count += 1
                wait_sec = 8.0
                try:
                    import re
                    match = re.search(r"try again in ([\d\.]+)s", response.text)
                    if match:
                        wait_sec = float(match.group(1)) + 1.5
                    elif "Retry-After" in response.headers:
                        wait_sec = float(response.headers["Retry-After"]) + 1.0
                    else:
                        wait_sec = 6.0 * retry_count
                except Exception:
                    wait_sec = 8.0
                
                # Dynamically trim token budget on rate limit to fit within TPM recovery
                for k in ("max_tokens", "max_completion_tokens"):
                    if k in payload and payload[k] > 600:
                        payload[k] = max(350, int(payload[k] * 0.7))

                time.sleep(min(wait_sec, 20.0))
                response = self._post_chat(payload)
                
                # If tier 1 quota on heavy model is persistently throttled, seamlessly fallback to gpt-4o-mini
                if response.status_code == 429 and retry_count >= 2:
                    current_model = str(payload.get("model", "")).lower()
                    if "mini" not in current_model:
                        payload["model"] = "gpt-4o-mini"
                        response = self._post_chat(payload)

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text[:500]}",
                    "provider": self.provider_name,
                    "latency_sec": round(time.time() - start, 2),
                }
            data = response.json()
            choice = (data.get("choices") or [{}])[0]
            text = ((choice.get("message") or {}).get("content") or "").strip()
            return {
                "success": bool(text),
                "response": text,
                "model": payload.get("model"),
                "provider": self.provider_name,
                "finish_reason": choice.get("finish_reason"),
                "latency_sec": round(time.time() - start, 2),
                "timestamp": datetime.utcnow().isoformat(),
            }
        except requests.Timeout:
            return {"success": False, "error": "OpenAI request timeout", "provider": self.provider_name}
        except Exception as exc:
            return {"success": False, "error": str(exc), "provider": self.provider_name}

    def chat(
        self,
        message: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        use_history: bool = True,
        temperature: float = 0.5,
        max_tokens: int = 800,
    ) -> Dict:
        history = self.conversation_history if use_history else []
        result = self.generate(
            message,
            model=model,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if result.get("success") and use_history:
            self.conversation_history.append({"role": "user", "content": message})
            self.conversation_history.append({"role": "assistant", "content": result.get("response") or ""})
        return result

    def generate_embedding(self, text: str, model: Optional[str] = None) -> Optional[List[float]]:
        if not self.api_key:
            return None
        try:
            response = requests.post(
                f"{self.base_url}/embeddings",
                headers=self._headers(),
                json={"model": model or self.embedding_model, "input": str(text or "")},
                timeout=REQUEST_TIMEOUT,
                verify=_verify_ssl(),
            )
            if response.status_code != 200:
                return None
            data = response.json().get("data") or []
            vector = (data[0] or {}).get("embedding") if data else None
            return list(vector) if vector is not None else None
        except Exception:
            return None

    def clear_history(self):
        self.conversation_history = []

    def get_history(self) -> List[Dict]:
        return list(self.conversation_history)
