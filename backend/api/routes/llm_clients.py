"""
LLM client layer for the agentic investigation workflow.

Strict single-provider architecture: OpenAI only.
All planning, reasoning, summarizing, and reporting route directly to OpenAI
using credentials and models configured in .env.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from time import perf_counter

from openai import OpenAI

try:
    from security.dotenv_loader import load_dotenv

    load_dotenv(str(Path(__file__).resolve().parents[2] / ".env"), override=False)
except Exception:
    pass


OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip().strip('"').strip("'")
_raw_openai_base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
if _raw_openai_base.endswith("/chat/completions"):
    _raw_openai_base = _raw_openai_base[:-len("/chat/completions")].rstrip("/")
OPENAI_BASE_URL = _raw_openai_base
LLM_TIMEOUT = float(os.environ.get("AGENTIC_LLM_TIMEOUT", os.environ.get("LLM_TIMEOUT", "180")) or 180)
AGENTIC_LLM_MAX_TOKENS = int(os.environ.get("AGENTIC_LLM_MAX_TOKENS", "4096") or 4096)

_openai_client = None
_last_call = None


class LLMError(Exception):
    pass


def _secret(name: str) -> str:
    return str(os.environ.get(name) or "").strip().strip('"').strip("'")


def _client() -> OpenAI:
    global _openai_client

    api_key = _secret("OPENAI_API_KEY")
    if not api_key:
        raise LLMError("OPENAI_API_KEY is not configured.")
    if _openai_client is None:
        default_headers = {"api-key": api_key} if api_key else None
        _openai_client = OpenAI(
            api_key=api_key,
            base_url=OPENAI_BASE_URL,
            timeout=LLM_TIMEOUT,
            default_headers=default_headers,
        )
    return _openai_client


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


def _run_unified(provider: str, system: str, user: str, temperature: float, max_tokens: int | None) -> str:
    """Run the OpenAI model and retain audit metadata for the session."""
    global _last_call
    from llm.unified_provider import UnifiedLLMProvider

    started = perf_counter()
    model_name = OPENAI_MODEL
    result = UnifiedLLMProvider().generate(
        prompt=user,
        model=model_name,
        system_prompt=system,
        temperature=temperature,
        max_tokens=max_tokens or AGENTIC_LLM_MAX_TOKENS,
    )
    if not result.get("success"):
        raise LLMError(result.get("error") or "OpenAI provider failed.")
    response = str(result.get("response") or "")
    if not response:
        raise LLMError("OpenAI returned an empty response.")
    _last_call = {
        "provider": "openai",
        "model": model_name,
        "latency_ms": int((perf_counter() - started) * 1000),
        "prompt_chars": len(system or "") + len(user or ""),
        "response_chars": len(response),
        "finish_reason": result.get("finish_reason"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    return response


def chatgpt_complete(system: str, user: str, temperature: float = 0.2) -> str:
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user, temperature, max_tokens=1800)


def chatgpt_complete_json(system: str, user: str, temperature: float = 0.1) -> dict:
    raw = _run_unified(f"openai:{OPENAI_MODEL}", system, user, temperature, max_tokens=1800)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"OpenAI did not return valid JSON: {raw[:500]}") from exc


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
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user, temperature=0.1, max_tokens=1200)


def run_llm_text(provider: str, system: str, user: str, temperature: float = 0.2, max_tokens: int | None = None) -> str:
    """Compatibility entry point used by the agentic workflow."""
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user, temperature, max_tokens)


def run_llm_json(provider: str, system: str, user: str, temperature: float = 0.1, max_tokens: int | None = None) -> str:
    """Compatibility entry point for JSON-formatted LLM responses."""
    return _run_unified(f"openai:{OPENAI_MODEL}", system, user, temperature, max_tokens)
