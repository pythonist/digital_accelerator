"""
LLM client layer for the agentic investigation workflow.

ChatGPT is used for planning, reasoning, reflection, risk, findings, reports,
recommendations, and QA. Nemotron is used for summarizing large tool outputs
and updating the cumulative investigation memory.
"""

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
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
NEMOTRON_MODEL = os.environ.get("NEMOTRON_MODEL", "nvidia/nemotron-4-340b-instruct").strip().strip('"').strip("'")
NEMOTRON_BASE_URL = os.environ.get("NEMOTRON_BASE_URL", "https://integrate.api.nvidia.com/v1").strip().rstrip("/")
LLM_TIMEOUT = float(os.environ.get("AGENTIC_LLM_TIMEOUT", os.environ.get("LLM_TIMEOUT", "90")) or 90)

_openai_client = None
_nemotron_client = None
_last_call = None


class LLMError(Exception):
    pass


def _secret(name: str) -> str:
    return str(os.environ.get(name) or "").strip().strip('"').strip("'")


def _client(kind: str) -> OpenAI:
    global _openai_client, _nemotron_client

    if kind == "chatgpt":
        api_key = _secret("OPENAI_API_KEY")
        if not api_key:
            raise LLMError("OPENAI_API_KEY is not configured.")
        if _openai_client is None:
            _openai_client = OpenAI(api_key=api_key, base_url=OPENAI_BASE_URL, timeout=LLM_TIMEOUT)
        return _openai_client

    if kind == "nemotron":
        api_key = _secret("NEMOTRON_API_KEY") or _secret("OPENROUTER_API_KEY")
        if not api_key:
            raise LLMError("NEMOTRON_API_KEY or OPENROUTER_API_KEY is not configured.")
        if _nemotron_client is None:
            _nemotron_client = OpenAI(api_key=api_key, base_url=NEMOTRON_BASE_URL, timeout=LLM_TIMEOUT)
        return _nemotron_client

    raise LLMError(f"Unknown LLM client kind: {kind}")


def provider_status() -> dict:
    return {
        "chatgpt": {
            "configured": bool(_secret("OPENAI_API_KEY")),
            "model": OPENAI_MODEL,
            "base_url": OPENAI_BASE_URL,
        },
        "nemotron": {
            "configured": bool(_secret("NEMOTRON_API_KEY") or _secret("OPENROUTER_API_KEY")),
            "model": NEMOTRON_MODEL,
            "base_url": NEMOTRON_BASE_URL,
        },
    }


def last_call_metadata() -> dict | None:
    return dict(_last_call) if isinstance(_last_call, dict) else None


def _run(kind: str, model: str, system: str, user: str, temperature: float, json_mode: bool) -> str:
    global _last_call
    started = perf_counter()
    try:
        kwargs = {
            "model": model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = _client(kind).chat.completions.create(**kwargs)
        content = (resp.choices[0].message.content or "").strip()
        _last_call = {
            "provider": kind,
            "model": model,
            "base_url": OPENAI_BASE_URL if kind == "chatgpt" else NEMOTRON_BASE_URL,
            "latency_ms": int((perf_counter() - started) * 1000),
            "prompt_chars": len(system or "") + len(user or ""),
            "response_chars": len(content),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        if not content:
            raise LLMError(f"{kind} returned an empty response.")
        return content
    except Exception as exc:
        if isinstance(exc, LLMError):
            raise
        raise LLMError(f"LLM call failed ({kind}:{model}): {exc}") from exc


def chatgpt_complete(system: str, user: str, temperature: float = 0.2) -> str:
    return _run("chatgpt", OPENAI_MODEL, system, user, temperature, json_mode=False)


def chatgpt_complete_json(system: str, user: str, temperature: float = 0.1) -> dict:
    raw = _run("chatgpt", OPENAI_MODEL, system, user, temperature, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMError(f"ChatGPT did not return valid JSON: {raw[:500]}") from exc


def nemotron_summarize(tool_name: str, raw_output: str, current_memory: str = "") -> str:
    system = (
        "You are Nemotron acting as the memory and compression agent for a "
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
    return _run("nemotron", NEMOTRON_MODEL, system, user, temperature=0.1, json_mode=False)


def run_llm_text(provider: str, system: str, user: str, temperature: float = 0.2) -> str:
    """Compatibility entry point used by the agentic workflow."""
    if str(provider or "").lower().startswith(("local:", "gpt4all:", "ollama:", "openai:", "openrouter:")):
        from llm.unified_provider import UnifiedLLMProvider
        result = UnifiedLLMProvider().generate(
            prompt=user,
            model=provider,
            system_prompt=system,
            temperature=temperature,
        )
        if not result.get("success"):
            raise LLMError(result.get("error") or "Selected LLM provider failed.")
        return str(result.get("response") or "")
    model = OPENAI_MODEL if provider == "chatgpt" else NEMOTRON_MODEL
    return _run(provider, model, system, user, temperature, json_mode=False)


def run_llm_json(provider: str, system: str, user: str, temperature: float = 0.1) -> str:
    """Compatibility entry point for JSON-formatted LLM responses."""
    if str(provider or "").lower().startswith(("local:", "gpt4all:", "ollama:", "openai:", "openrouter:")):
        from llm.unified_provider import UnifiedLLMProvider
        result = UnifiedLLMProvider().generate(
            prompt=user,
            model=provider,
            system_prompt=system,
            temperature=temperature,
        )
        if not result.get("success"):
            raise LLMError(result.get("error") or "Selected LLM provider failed.")
        return str(result.get("response") or "")
    model = OPENAI_MODEL if provider == "chatgpt" else NEMOTRON_MODEL
    return _run(provider, model, system, user, temperature, json_mode=True)
