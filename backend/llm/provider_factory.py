"""
Factory for selecting the active LLM provider.

Supported providers:
  - openai
  - ollama
  - gpt4all
"""

import os
import traceback


def _as_bool(raw, default=False):
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _instantiate_provider(provider: str):
    if provider == "openai":
        from llm.openai_wrapper import OpenAIWrapper

        return OpenAIWrapper()

    if provider == "gpt4all":
        from llm.gpt4all_wrapper import GPT4AllWrapper

        return GPT4AllWrapper()

    if provider == "ollama":
        from llm.ollama_wrapper import OllamaWrapper

        return OllamaWrapper()

    raise ValueError(f"Unsupported LLM_PROVIDER '{provider}'. Expected 'openai', 'gpt4all', or 'ollama'.")


def load_llm_provider():
    """Return the single provider router used by every module.

    The router keeps provider selection request-scoped, so a local GGUF,
    OpenAI-compatible API, OpenRouter, or Ollama can be chosen without
    rebuilding the Flask process.
    """
    from llm.unified_provider import UnifiedLLMProvider

    return UnifiedLLMProvider()


def load_legacy_llm_provider():
    """Legacy environment-only provider loader retained for scripts."""
    requested_raw = os.getenv("LLM_PROVIDER")
    requested_provider = str(requested_raw or "").strip().lower()
    if not requested_provider:
        requested_provider = "openai" if os.getenv("OPENAI_API_KEY") else "gpt4all"

    ollama_enabled = _as_bool(os.getenv("LLM_ENABLE_OLLAMA_FALLBACK"), default=False)
    if requested_provider == "ollama" and not ollama_enabled:
        print("Ollama provider is disabled for this environment; using GPT4All.")
        requested_provider = "gpt4all"

    fallback_chain = [requested_provider]

    if requested_provider == "openai":
        fallback_chain.append("gpt4all")
    elif requested_provider == "ollama":
        fallback_chain.extend(["openai", "gpt4all"])
    elif requested_provider == "gpt4all":
        if os.getenv("OPENAI_API_KEY"):
            fallback_chain.append("openai")
    if requested_provider != "ollama" and ollama_enabled:
        fallback_chain.append("ollama")

    deduped_chain = []
    for provider in fallback_chain:
        if provider not in deduped_chain:
            deduped_chain.append(provider)
    fallback_chain = deduped_chain

    errors = []

    for provider in fallback_chain:
        try:
            instance = _instantiate_provider(provider)
            checker = getattr(instance, "check_connection", None)
            if callable(checker) and not checker():
                errors.append(f"{provider}: connection check failed")
                continue
            if provider != requested_provider:
                print(f"AI provider fallback activated: {requested_provider} -> {provider}")
            return instance
        except Exception as exc:
            errors.append(f"{provider}: {exc}")
            if provider == requested_provider or _as_bool(os.getenv("LLM_DEBUG_PROVIDER_ERRORS"), default=False):
                print(f"AI provider unavailable ({provider}): {exc}")
                traceback.print_exc()

    print(
        "AI provider unavailable after fallback chain:",
        " | ".join(errors) if errors else requested_provider,
    )
    return None
