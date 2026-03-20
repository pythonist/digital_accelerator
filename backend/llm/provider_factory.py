"""
Factory for selecting the active LLM provider.

Supported providers:
  - ollama
  - gpt4all
"""

import os
import traceback


def load_llm_provider():
    provider = str(os.getenv("LLM_PROVIDER") or "ollama").strip().lower()

    try:
        if provider == "gpt4all":
            from llm.gpt4all_wrapper import GPT4AllWrapper

            return GPT4AllWrapper()

        if provider == "ollama":
            from llm.ollama_wrapper import OllamaWrapper

            return OllamaWrapper()

        raise ValueError(f"Unsupported LLM_PROVIDER '{provider}'. Expected 'ollama' or 'gpt4all'.")
    except Exception as exc:
        print(f"AI provider unavailable ({provider}): {exc}")
        traceback.print_exc()
        return None

