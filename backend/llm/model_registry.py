"""Discovery and metadata for the FCIP platform's selectable LLMs.

Strict single-provider architecture: OpenAI only.
All model selection is driven exclusively by the .env configuration.
"""

from __future__ import annotations

import os
from typing import Any


def _get_configured_chat_model() -> str:
    raw = (
        os.getenv("OPENAI_MODEL")
        or os.getenv("LLM_DEFAULT_MODEL")
        or "openai.gpt-5.6-luna"
    ).strip().strip('"').strip("'")
    if raw.startswith("openai:"):
        raw = raw[7:].strip()
    return raw or "openai.gpt-5.6-luna"


def _get_configured_embed_model() -> str:
    raw = (
        os.getenv("OPENAI_EMBED_MODEL")
        or os.getenv("LLM_EMBED_MODEL")
        or "vertex_ai.gemini-embedding-2"
    ).strip().strip('"').strip("'")
    if raw.startswith("openai:"):
        raw = raw[7:].strip()
    return raw or "vertex_ai.gemini-embedding-2"


def _format_model_label(model_id: str) -> str:
    name = model_id.strip()
    cleaned = name.replace("gpt-", "GPT-").replace("-", " ").title()
    return f"OpenAI · {cleaned}"


def model_catalog() -> list[dict[str, Any]]:
    """Return the configured OpenAI models from .env."""
    has_api_key = bool(os.getenv("OPENAI_API_KEY"))
    chat_model = _get_configured_chat_model()
    embed_model = _get_configured_embed_model()

    catalog = [
        {
            "id": f"openai:{chat_model}",
            "provider": "openai",
            "name": chat_model,
            "label": _format_model_label(chat_model),
            "type": "chat",
            "offline": False,
            "available": has_api_key,
        }
    ]

    # Also register the configured embedding model for services that inspect the catalog
    if embed_model and embed_model != chat_model:
        catalog.append({
            "id": f"openai:{embed_model}",
            "provider": "openai",
            "name": embed_model,
            "label": f"OpenAI · Embeddings ({embed_model})",
            "type": "embedding",
            "offline": False,
            "available": has_api_key,
        })

    return catalog


def split_model_id(model_id: str | None) -> tuple[str | None, str | None]:
    raw = str(model_id or "").strip()
    if not raw:
        return None, None
    if ":" not in raw:
        return "openai", raw
    provider, model = raw.split(":", 1)
    return "openai", model.strip()


def find_local_model(model_name: str | None) -> tuple[str, Any] | None:
    """Stub retained for backward compatibility; local models are disabled."""
    return None
