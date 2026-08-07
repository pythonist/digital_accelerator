"""Discovery and metadata for the FCIP platform's selectable LLMs."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_DIRS = (
    Path(os.getenv("LLM_MODEL_DIR", "")) if os.getenv("LLM_MODEL_DIR") else None,
    Path(r"H:\OllamaModels"),
    REPO_ROOT / "data" / "local_models",
)


def _local_dirs() -> list[Path]:
    return [path for path in DEFAULT_LOCAL_DIRS if path and path.exists()]


def _local_models() -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for directory in _local_dirs():
        try:
            paths = sorted(directory.glob("*.gguf"), key=lambda item: item.name.lower())
        except OSError:
            continue
        for path in paths:
            key = path.name.lower()
            if key in seen:
                continue
            seen.add(key)
            models.append({
                "id": f"local:{path.name}",
                "provider": "local",
                "name": path.name,
                "label": f"Local · {path.stem}",
                "path": str(path),
                "offline": True,
                "available": True,
            })
    return models


def model_catalog() -> list[dict[str, Any]]:
    """Return configured cloud/API/server models plus discovered GGUF files."""
    catalog = [
        {
            "id": "openai:gpt-4o-mini",
            "provider": "openai",
            "name": "gpt-4o-mini",
            "label": "OpenAI · GPT-4o mini",
            "offline": False,
            "available": bool(os.getenv("OPENAI_API_KEY")),
        },
        {
            "id": "openrouter:nvidia/nemotron-3-ultra-550b-a55b",
            "provider": "openrouter",
            "name": "nvidia/nemotron-3-ultra-550b-a55b",
            "label": "OpenRouter · Nemotron 3 Ultra",
            "offline": False,
            "available": bool(os.getenv("OPENROUTER_API_KEY") or os.getenv("NEMOTRON_API_KEY")),
        },
        {
            "id": "ollama:llama3.2:1b",
            "provider": "ollama",
            "name": "llama3.2:1b",
            "label": "Ollama · llama3.2:1b",
            "offline": True,
            "available": True,
        },
    ]
    return [*_local_models(), *catalog]


def split_model_id(model_id: str | None) -> tuple[str | None, str | None]:
    raw = str(model_id or "").strip()
    if not raw:
        return None, None
    if ":" not in raw:
        return None, raw
    provider, model = raw.split(":", 1)
    return provider.strip().lower(), model.strip()


def find_local_model(model_name: str | None) -> tuple[str, Path] | None:
    requested = Path(str(model_name or "").strip())
    for directory in _local_dirs():
        candidate = requested if requested.is_absolute() else directory / requested.name
        if candidate.suffix.lower() == ".gguf" and candidate.exists():
            return candidate.name, candidate.parent
    return None
