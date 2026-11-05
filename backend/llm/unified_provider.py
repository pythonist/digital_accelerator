"""Provider-aware adapter used by all backend modules that request an LLM.

Strict single-provider architecture: OpenAI only.
All requests route directly to the OpenAI-compatible endpoint configured in .env.
"""

from __future__ import annotations

import os
from typing import Any

from llm.openai_wrapper import OpenAIWrapper
from llm.model_registry import model_catalog, split_model_id


class UnifiedLLMProvider:
    provider_name = "openai"

    def __init__(self) -> None:
        self._providers: dict[str, OpenAIWrapper] = {}

    def _selection(self, requested: str | None = None) -> tuple[str, str]:
        selected = requested
        try:
            from flask import g, has_request_context
            if has_request_context():
                selected = getattr(g, "llm_model", None) or selected
        except ImportError:
            pass

        selected = selected or os.getenv("OPENAI_MODEL") or os.getenv("LLM_DEFAULT_MODEL") or "openai.gpt-5.6-luna"
        _, model = split_model_id(selected)
        return "openai", model or "openai.gpt-5.6-luna"

    def _provider(self, model: str) -> OpenAIWrapper:
        key = f"openai:{model}"
        if key not in self._providers:
            self._providers[key] = OpenAIWrapper(default_model=model)
        return self._providers[key]

    def _active(self, model: str | None = None) -> OpenAIWrapper:
        _, selected_model = self._selection(model)
        return self._provider(selected_model)

    @property
    def default_model(self) -> str:
        _, model = self._selection()
        return model

    @property
    def embedding_model(self) -> str:
        return getattr(self._active(), "embedding_model", os.getenv("OPENAI_EMBED_MODEL", "vertex_ai.gemini-embedding-2"))

    def check_connection(self) -> bool:
        try:
            return bool(self._active().check_connection())
        except Exception:
            return False

    def list_models(self):
        return model_catalog()

    def generate(self, prompt: str, model: str | None = None, **kwargs):
        return self._active(model).generate(prompt, model=model, **kwargs)

    def stream_generate(self, prompt: str, model: str | None = None, **kwargs):
        provider = self._active(model)
        streamer = getattr(provider, "stream_generate", None)
        if callable(streamer):
            yield from streamer(prompt, model=model, **kwargs)
            return
        result = provider.generate(prompt, model=model, **kwargs)
        if result.get("success") and result.get("response"):
            yield str(result["response"])

    def chat(self, message: str, model: str | None = None, **kwargs):
        return self._active(model).chat(message, model=model, **kwargs)

    def generate_embedding(self, text: str, model: str | None = None, **kwargs):
        return self._active(model).generate_embedding(text, model=model, **kwargs)

    def clear_history(self):
        return self._active().clear_history()

    def get_history(self):
        return self._active().get_history()
