"""Provider-aware adapter used by all backend modules that request an LLM."""

from __future__ import annotations

import os
from typing import Any

from llm.gpt4all_wrapper import GPT4AllWrapper
from llm.ollama_wrapper import OllamaWrapper
from llm.openai_wrapper import OpenAIWrapper
from llm.model_registry import find_local_model, model_catalog, split_model_id


class UnifiedLLMProvider:
    provider_name = "unified"

    def __init__(self) -> None:
        self._providers: dict[str, Any] = {}

    def _selection(self, requested: str | None = None) -> tuple[str, str]:
        selected = requested
        try:
            from flask import g, has_request_context
            if has_request_context():
                selected = getattr(g, "llm_model", None) or selected
        except ImportError:
            pass
        selected = selected or os.getenv("LLM_DEFAULT_MODEL") or ""
        provider, model = split_model_id(selected)
        if provider:
            return provider, model or ""
        if model and model.lower().endswith(".gguf") and find_local_model(model):
            return "local", model
        configured = str(os.getenv("LLM_PROVIDER") or "").strip().lower()
        provider = configured or ("openai" if os.getenv("OPENAI_API_KEY") else "local")
        if provider in {"local", "gpt4all"} and model and not find_local_model(model):
            model = ""
        if provider in {"local", "gpt4all"} and not model:
            local_models = [item for item in model_catalog() if item.get("provider") == "local"]
            model = local_models[0].get("name", "") if local_models else ""
        if provider == "openai" and not model:
            model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        return provider, model

    def _provider(self, provider: str, model: str):
        key = f"{provider}:{model}"
        if key in self._providers:
            return self._providers[key]

        if provider in {"local", "gpt4all"}:
            local = find_local_model(model)
            if not local:
                raise FileNotFoundError(f"Local GGUF model not found: {model}")
            model_name, model_dir = local
            instance = GPT4AllWrapper(
                default_model=model_name,
                model_dir=model_dir,
                allow_download=False,
            )
        elif provider in {"openrouter", "nemotron"}:
            instance = OpenAIWrapper(
                api_key=os.getenv("OPENROUTER_API_KEY") or os.getenv("NEMOTRON_API_KEY"),
                base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                default_model=model or "nvidia/nemotron-3-ultra-550b-a55b",
            )
        elif provider == "ollama":
            instance = OllamaWrapper(
                base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
                default_model=model or os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.2:1b"),
            )
        else:
            instance = OpenAIWrapper(default_model=model or "gpt-4o-mini")
        self._providers[key] = instance
        return instance

    def _active(self, model: str | None = None):
        provider, selected_model = self._selection(model)
        return self._provider(provider, selected_model)

    @property
    def default_model(self) -> str:
        provider, model = self._selection()
        return f"{provider}:{model}" if model else provider

    @property
    def embedding_model(self) -> str:
        return getattr(self._active(), "embedding_model", "")

    def check_connection(self) -> bool:
        try:
            return bool(self._active().check_connection())
        except Exception:
            return False

    def list_models(self):
        return model_catalog()

    def generate(self, prompt: str, model: str | None = None, **kwargs):
        return self._active(model).generate(prompt, model=None, **kwargs)

    def stream_generate(self, prompt: str, model: str | None = None, **kwargs):
        provider = self._active(model)
        streamer = getattr(provider, "stream_generate", None)
        if callable(streamer):
            yield from streamer(prompt, model=None, **kwargs)
            return
        result = provider.generate(prompt, model=None, **kwargs)
        if result.get("success") and result.get("response"):
            yield str(result["response"])

    def chat(self, message: str, model: str | None = None, **kwargs):
        return self._active(model).chat(message, model=None, **kwargs)

    def generate_embedding(self, text: str, model: str | None = None, **kwargs):
        return self._active(model).generate_embedding(text, model=model, **kwargs)

    def clear_history(self):
        return self._active().clear_history()

    def get_history(self):
        return self._active().get_history()
