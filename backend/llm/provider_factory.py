"""
Factory for selecting the active LLM provider.

Supported providers:
  - ollama
  - gpt4all
"""

import os
import traceback


def _instantiate_provider(provider: str):
    if provider == "gpt4all":
        from llm.gpt4all_wrapper import GPT4AllWrapper

        return GPT4AllWrapper()

    if provider == "ollama":
        from llm.ollama_wrapper import OllamaWrapper

        return OllamaWrapper()

    raise ValueError(f"Unsupported LLM_PROVIDER '{provider}'. Expected 'ollama' or 'gpt4all'.")


def load_llm_provider():
    requested_provider = str(os.getenv("LLM_PROVIDER") or "ollama").strip().lower() or "ollama"
    fallback_chain = [requested_provider]
    if requested_provider == "ollama":
        fallback_chain.append("gpt4all")
    elif requested_provider == "gpt4all":
        fallback_chain.append("ollama")

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
            print(f"AI provider unavailable ({provider}): {exc}")
            traceback.print_exc()

    print(
        "AI provider unavailable after fallback chain:",
        " | ".join(errors) if errors else requested_provider,
    )
    return None
