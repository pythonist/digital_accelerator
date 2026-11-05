"""
LLM client layer for the agentic investigation workflow.

Strict single-provider architecture: OpenAI only.
All planning, reasoning, summarizing, and reporting route directly to OpenAI
via OpenAIWrapper using credentials and models configured in .env.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, Optional

try:
    from security.dotenv_loader import load_dotenv

    load_dotenv(str(Path(__file__).resolve().parents[2] / ".env"), override=False)
except Exception:
    pass

logger = logging.getLogger("aml.llm.clients")

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "openai.gpt-5.6-luna").strip().strip('"').strip("'")
_raw_openai_base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
if _raw_openai_base.endswith("/chat/completions"):
    _raw_openai_base = _raw_openai_base[:-len("/chat/completions")].rstrip("/")
OPENAI_BASE_URL = _raw_openai_base
LLM_TIMEOUT = float(os.environ.get("AGENTIC_LLM_TIMEOUT", os.environ.get("LLM_TIMEOUT", "180")) or 180)
AGENTIC_LLM_MAX_TOKENS = int(os.environ.get("AGENTIC_LLM_MAX_TOKENS", "4096") or 4096)

_last_call: Optional[Dict[str, Any]] = None


class LLMError(Exception):
    pass


def _secret(name: str) -> str:
    return str(os.environ.get(name) or "").strip().strip('"').strip("'")


def provider_status() -> dict:
    return {
        "openai": {
            "configured": bool(_secret("OPENAI_API_KEY")),
            "model": OPENAI_MODEL,
            "base_url": OPENAI_BASE_URL,
        },
        "chatgpt": {
            "configured": bool(_secret("OPENAI_API_KEY")),
            "model": OPENAI_MODEL,
            "base_url": OPENAI_BASE_URL,
        },
    }


def last_call_metadata() -> dict | None:
    return dict(_last_call) if isinstance(_last_call, dict) else None


def _run_unified(provider: str, system: str, user: str, **kwargs: Any) -> str:
    """Run the OpenAI model via UnifiedLLMProvider and retain audit metadata for the session."""
    global _last_call
    from llm.unified_provider import UnifiedLLMProvider

    started = perf_counter()
    model_name = OPENAI_MODEL
    result = UnifiedLLMProvider().generate(
        prompt=user,
        model=model_name,
        system_prompt=system,
    )
    if not isinstance(result, dict) or not result.get("success"):
        err = (result or {}).get("error") if isinstance(result, dict) else "Unknown failure"
        raise LLMError(f"OpenAI provider failed: {err}")
    response = str(result.get("response") or result.get("text") or "").strip()
    if not response:
        raise LLMError("OpenAI returned an empty response.")

    _last_call = {
        "provider": "openai",
        "model": model_name,
        "latency_ms": int((perf_counter() - started) * 1000),
        "prompt_chars": len(system or "") + len(user or ""),
        "response_chars": len(response),
        "finish_reason": result.get("finish_reason"),
        "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
    }
    return response


def chatgpt_complete(system: str, user: str, **kwargs: Any) -> str:
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user)


def chatgpt_complete_json(system: str, user: str, **kwargs: Any) -> dict:
    raw = _run_unified(f"openai:{OPENAI_MODEL}", system, user)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"OpenAI did not return valid JSON: {raw[:300]}") from exc


def nemotron_summarize(tool_name: str, raw_output: str, current_memory: str = "") -> str:
    """Memory and compression agent routed to OpenAI."""
    system = (
        "You are acting as the memory and compression agent for a "
        "financial crime investigation. Summarize only the supplied tool output. "
        "Do not invent facts. Return concise markdown with these headings: "
        "Current Facts, Evidence, Findings, Missing Information, Outstanding "
        "Questions, Current Risk."
    )
    user = (
        f"Tool: {tool_name}\n\n"
        f"Existing investigation memory:\n{current_memory[-6000:] or 'None yet.'}\n\n"
        f"Raw tool output:\n{raw_output[:30000]}\n\n"
        "Update the investigation memory from this tool output."
    )
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user)


def run_llm_text(provider: str, system: str, user: str, **kwargs: Any) -> str:
    """Compatibility entry point used by the agentic workflow."""
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user)


def run_llm_json(provider: str, system: str, user: str, **kwargs: Any) -> dict:
    """Compatibility entry point for JSON-formatted LLM responses."""
    raw = _run_unified(f"openai:{OPENAI_MODEL}", system, user)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"OpenAI did not return valid JSON: {raw[:300]}") from exc
