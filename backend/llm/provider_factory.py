"""
Factory for selecting the active LLM provider.

Strict single-provider architecture: OpenAI only.
All fallbacks to local models, Ollama, or external providers have been removed.
"""

from __future__ import annotations

import os


def _instantiate_provider(provider: str = "openai"):
    from llm.openai_wrapper import OpenAIWrapper

    return OpenAIWrapper()


def load_llm_provider():
    """Return the provider router used by every module.
    
    Routes strictly to OpenAI using credentials from .env.
    """
    from llm.unified_provider import UnifiedLLMProvider

    return UnifiedLLMProvider()


def load_legacy_llm_provider():
    """Legacy environment-only provider loader."""
    from llm.openai_wrapper import OpenAIWrapper

    return OpenAIWrapper()
