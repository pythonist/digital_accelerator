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


DEFAULT_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
DEFAULT_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_DEFAULT_MODEL") or "gpt-4o-mini"
DEFAULT_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL") or os.getenv("LLM_EMBED_MODEL") or "text-embedding-3-small"
REQUEST_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT") or os.getenv("LLM_TIMEOUT") or "45")
DEFAULT_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS") or os.getenv("OPENAI_MAX_TOKENS") or "320")
DEFAULT_TOKEN_CAP = int(os.getenv("LLM_TOKEN_CAP") or os.getenv("OPENAI_TOKEN_CAP") or str(DEFAULT_MAX_TOKENS))


def _bounded_tokens(requested: Optional[int]) -> int:
    try:
        value = int(requested if requested is not None else DEFAULT_MAX_TOKENS)
    except Exception:
        value = DEFAULT_MAX_TOKENS
    value = max(32, value)
    if DEFAULT_TOKEN_CAP > 0:
        value = min(value, DEFAULT_TOKEN_CAP)
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
        self.base_url = str(base_url or DEFAULT_BASE_URL).rstrip("/")
        self.default_model = default_model
        self.embedding_model = embedding_model
        self.conversation_history: List[Dict] = []
        self._connection_checked = False
        self._connection_ok = False

    def _get_context_overrides(self) -> tuple[str, str, str]:
        model = self.default_model
        base_url = self.base_url
        api_key = self.api_key
        try:
            from flask import has_request_context, g
            if has_request_context():
                req_model = getattr(g, "llm_model", None)
                if req_model == "nemotron":
                    model = "nvidia/nemotron-3-ultra-550b-a55b"
                    base_url = "https://openrouter.ai/api/v1"
                    api_key = os.getenv("OPENROUTER_API_KEY") or api_key
                elif req_model == "chatgpt":
                    # explicitly requested chatgpt
                    pass
        except ImportError:
            pass
        return model, base_url, api_key

    def _headers(self) -> Dict[str, str]:
        _, _, api_key = self._get_context_overrides()
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

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
                timeout=min(REQUEST_TIMEOUT, 10),
            )
            self._connection_ok = response.status_code == 200
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
        
        # Override with global setting if frontend specifically chose it
        try:
            from flask import has_request_context, g
            if has_request_context() and getattr(g, "llm_model", None) in {"nemotron", "chatgpt"}:
                model = dyn_model
        except ImportError:
            pass

        return {
            "model": model or dyn_model,
            "messages": messages,
            "temperature": float(temperature),
            token_key: _bounded_tokens(max_tokens),
        }

    def _post_chat(self, payload: Dict) -> requests.Response:
        _, base_url, _ = self._get_context_overrides()
        return requests.post(
            f"{base_url}/chat/completions",
            headers=self._headers(),
            json=payload,
            timeout=REQUEST_TIMEOUT,
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
            if response.status_code == 400 and "max_tokens" in response.text:
                payload = self._chat_payload(
                    prompt,
                    model=model,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    token_key="max_completion_tokens",
                )
                response = self._post_chat(payload)
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text[:500]}",
                    "provider": self.provider_name,
                    "latency_sec": round(time.time() - start, 2),
                }
            data = response.json()
            text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
            return {
                "success": bool(text),
                "response": text,
                "model": payload.get("model"),
                "provider": self.provider_name,
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
