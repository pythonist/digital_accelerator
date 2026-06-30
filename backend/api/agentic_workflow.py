"""
Autonomous LLM-backed investigation workflow.

This module intentionally fails closed when the configured LLMs are not
available. It does not use fake delays, placeholder findings, or hardcoded
summaries.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

from api.agent_db import (
    create_session,
    get_db_connection,
    get_memory,
    get_tool_execution_log,
    log_activity,
    save_document,
    save_findings,
    save_llm_interaction,
    update_memory,
    update_session_status,
)
from api.routes.agent_tools import TOOL_REGISTRY, get_case_context, raw_to_json_text, run_tool
from api.routes.llm_clients import (
    LLMError,
    run_llm_text,
    run_llm_json,
    last_call_metadata,
    provider_status,
)


MAX_QA_LOOPS = 0
WORKFLOW_VERSION = "real-llm-only-2026-06-30-1900"
WORKFLOW_FILE = str(Path(__file__).resolve())
WORKFLOW_LOADED_AT = datetime.utcnow().isoformat() + "Z"
DOCUMENT_TYPES = [
    "Executive Summary",
    "Full Investigation Report",
    "SAR Draft"
]


def _save_last_llm(session_id: str, stage: str, prompt: str, response) -> None:
    meta = last_call_metadata() or {}
    save_llm_interaction(
        session_id=session_id,
        stage=stage,
        provider=meta.get("provider") or "unknown",
        model=meta.get("model") or "unknown",
        prompt_text=prompt,
        response_text=response if isinstance(response, str) else json.dumps(response, default=str),
        metadata=meta,
    )


def _chat_json(session_id: str, provider: str, stage: str, system: str, user: str, temperature: float = 0.1) -> dict:
    raw = run_llm_json(provider, system, user, temperature=temperature)
    _save_last_llm(session_id, stage, f"SYSTEM:\n{system}\n\nUSER:\n{user}", raw)
    
    if isinstance(raw, dict):
        return raw
        
    try:
        # Some models return JSON enclosed in markdown
        cleaned = str(raw).strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
    except json.JSONDecodeError as exc:
        raise LLMError(f"{provider} did not return valid JSON: {str(raw)[:500]}") from exc


def _chat_text(session_id: str, provider: str, stage: str, system: str, user: str, temperature: float = 0.2) -> str:
    response = run_llm_text(provider, system, user, temperature=temperature)
    _save_last_llm(session_id, stage, f"SYSTEM:\n{system}\n\nUSER:\n{user}", response)
    return response


def _summarize_tool(session_id: str, provider: str, tool_name: str, raw_output: str, current_memory: str = "") -> str:
    system = (
        f"You are {provider} acting as the memory and compression agent for a "
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
    return _chat_text(session_id, provider, f"summarize:{tool_name}", system, user, temperature=0.1)


def _current_memory(session_id: str) -> str:
    mem = get_memory(session_id)
    return mem["memory_text"] if mem else ""


def _insert_plan_steps(session_id: str, steps: list[dict], start_index: int = 0) -> list[str]:
    conn = get_db_connection()
    c = conn.cursor()
    ids = []
    try:
        for index, step in enumerate(steps):
            step_id = str(uuid.uuid4())
            ids.append(step_id)
            tool_name = step.get("tool")
            tool_meta = TOOL_REGISTRY.get(tool_name, {})
            c.execute(
                """
                INSERT INTO investigation_plan
                    (id, session_id, step_number, action_name, description, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    step_id,
                    session_id,
                    start_index + index + 1,
                    str(tool_name or "").replace("_", " ").title(),
                    step.get("reason") or tool_meta.get("description", ""),
                    "pending",
                    datetime.now().isoformat(),
                ),
            )
        conn.commit()
        return ids
    finally:
        conn.close()


def plan_investigation(session_id: str, case_id: str, context: dict, prior_memory: str = "") -> list[dict]:
    case_context = get_case_context(case_id, context)
    tool_list = "\n".join(f"- {name}: {meta['description']}" for name, meta in TOOL_REGISTRY.items())
    provider = context.get("selected_model", "chatgpt")
    system = (
        f"You are {provider} acting as the Planner Agent for a senior AML investigation. "
        "Use the supplied case data and available tools to produce a dynamic plan. "
        "You MUST include EXACTLY one step for every available tool listed. "
        "Do NOT hallucinate or invent new tools. "
        "Include all tools in a logical sequence and explain why each step is needed. "
        "Respond only with JSON "
        'in this shape: {"steps":[{"tool":"<tool_name>","reason":"<case-specific reason>"}]}.'
    )
    user = (
        f"Case ID: {case_id}\n\n"
        f"Available tools:\n{tool_list}\n\n"
        f"Case data:\n{json.dumps(case_context, indent=2, default=str)[:45000]}\n\n"
        f"Prior memory if this is a follow-up loop:\n{prior_memory[-12000:] or 'None'}\n\n"
        "Create the investigation plan."
    )
    result = _chat_json(session_id, provider, "planner", system, user)
    steps = result.get("steps") or []
    valid = [step for step in steps if step.get("tool") in TOOL_REGISTRY]
    if not valid:
        raise LLMError("Planner did not return any valid tool steps.")
    return valid


def execute_step(session_id: str, case_id: str, tool_name: str, step_db_id: str, context: dict) -> None:
    log_activity(session_id, f"Executing tool: {tool_name}", "running")
    update_session_status(session_id, "running", current_step=tool_name)

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("UPDATE investigation_plan SET status = 'running' WHERE id = ?", (step_db_id,))
    conn.commit()
    conn.close()

    memory_text = _current_memory(session_id)
    result = run_tool(tool_name, case_id, memory_text, context)
    raw_output = raw_to_json_text(result.get("raw")) if result.get("ok") else ""

    conn = get_db_connection()
    c = conn.cursor()
    try:
        if not result.get("ok"):
            summary = result.get("error") or "Tool execution failed."
            c.execute(
                "UPDATE investigation_plan SET status = 'failed', result_summary = ? WHERE id = ?",
                (summary, step_db_id),
            )
            c.execute(
                """
                INSERT INTO tool_execution_log
                    (id, session_id, tool_name, input_params, output_data, summary, status, execution_time_ms, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    session_id,
                    tool_name,
                    json.dumps(result.get("input_params") or {}),
                    "",
                    summary,
                    "failed",
                    result.get("execution_time_ms"),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            log_activity(session_id, f"Tool failed: {tool_name} - {summary}", "error")
            update_memory(session_id, memory_text + f"\n\n[{tool_name}]\nFAILED: {summary}")
            return

        provider = context.get("selected_model", "chatgpt")
        summary = _summarize_tool(session_id, provider, tool_name, raw_output, current_memory=memory_text)

        c.execute(
            """
            INSERT INTO tool_execution_log
                (id, session_id, tool_name, input_params, output_data, summary, status, execution_time_ms, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                session_id,
                tool_name,
                json.dumps(result.get("input_params") or {}),
                raw_output,
                summary,
                "success",
                result.get("execution_time_ms"),
                datetime.now().isoformat(),
            ),
        )
        c.execute(
            "UPDATE investigation_plan SET status = 'completed', result_summary = ? WHERE id = ?",
            (summary, step_db_id),
        )
        conn.commit()
        update_memory(session_id, memory_text + f"\n\n[{tool_name}]\n{summary}")
        log_activity(session_id, f"Completed tool: {tool_name}", "success")
    finally:
        conn.close()


def synthesize_risk(session_id: str, case_id: str, memory_text: str, provider: str) -> dict:
    system = (
        f"You are {provider} acting as the Risk Agent. Produce an evidence-backed AML "
        "risk assessment from the accumulated memory. Respond only with JSON: "
        '{"risk_score":0-100,"confidence":0-100,"key_drivers":["..."],'
        '"risk_evolution":[{"stage":"...","score":0,"reason":"..."}]}.'
    )
    user = f"Case ID: {case_id}\n\nAccumulated memory:\n{memory_text[-30000:]}"
    return _chat_json(session_id, provider, "risk_agent", system, user, temperature=0.1)


def qa_review(session_id: str, case_id: str, memory_text: str, risk_result: dict, provider: str) -> dict:
    system = (
        f"You are {provider} acting as the QA Reflection Agent. Decide whether the "
        "investigation has enough evidence or whether more tool execution is needed. "
        "Respond only with JSON: "
        '{"sufficient":true,"reasoning":"...","missing":["..."],"additional_focus":["..."]}.'
    )
    user = (
        f"Case ID: {case_id}\n\nMemory:\n{memory_text[-30000:]}\n\n"
        f"Risk assessment:\n{json.dumps(risk_result, indent=2, default=str)}"
    )
    return _chat_json(session_id, provider, "qa_reflection", system, user, temperature=0.1)


def extract_findings(session_id: str, case_id: str, tool_log: list[dict], risk_result: dict, provider: str) -> dict:
    evidence_blocks = "\n\n".join(
        f"=== {row.get('tool_name')} ({row.get('status')}) ===\n{row.get('output_data') or row.get('summary') or ''}"
        for row in tool_log
    )
    system = (
        f"You are {provider} acting as the lead AML Findings Agent. Analyze the full "
        "raw evidence trail and produce structured, audit-ready findings. Every "
        "finding, evidence item, risk driver, and recommendation must cite actual "
        "data from a tool output. Do not create placeholder findings. Respond only "
        "with JSON in this shape: "
        '{"findings":[{"title":"...","detail":"...","source_tool":"...","evidence":"...",'
        '"severity":"critical|high|medium|low","confidence":0-100,"impacted_accounts":[],'
        '"impacted_transactions":[],"linked_entities":[],"typologies":[]}],'
        '"evidence_items":[{"source_tool":"...","record_id":"...","evidence":"...","confidence":0-100}],'
        '"risk_drivers":[{"driver":"...","explanation":"...","source_tool":"...","evidence":"..."}],'
        '"recommendations":[{"action":"...","owner":"...","priority":"high|medium|low","rationale":"..."}],'
        '"timeline":[{"timestamp":"...","event":"...","source_tool":"...","evidence":"..."}],'
        '"open_questions":[{"question":"...","why_it_matters":"..."}]}.'
    )
    user = (
        f"Case ID: {case_id}\n"
        f"Risk result:\n{json.dumps(risk_result, indent=2, default=str)}\n\n"
        f"Full tool evidence:\n{evidence_blocks[:70000]}"
    )
    data = _chat_json(session_id, provider, "findings_agent", system, user, temperature=0.12)
    for key in ("findings", "evidence_items", "risk_drivers", "recommendations", "timeline", "open_questions"):
        if not isinstance(data.get(key), list):
            data[key] = []
    return data


def generate_document(session_id: str, case_id: str, doc_type: str, findings_data: dict, risk_result: dict, tool_log: list[dict], provider: str) -> str:
    system = (
        f"You are {provider} acting as the Report Agent for an enterprise AML team. "
        "Write detailed, compliance-appropriate markdown using only the supplied "
        "structured findings, risk result, and tool summaries. Do not invent facts."
    )
    user = (
        f"Document type: {doc_type}\nCase ID: {case_id}\n\n"
        f"Risk result:\n{json.dumps(risk_result, indent=2, default=str)}\n\n"
        f"Structured findings:\n{json.dumps(findings_data, indent=2, default=str)[:45000]}\n\n"
        f"Tool summaries:\n{json.dumps([{k: row.get(k) for k in ('tool_name', 'summary', 'status')} for row in tool_log], indent=2, default=str)}\n\n"
        "Write the document with clear section headings, evidence references, "
        "recommendations where relevant, and enough detail for senior analyst review."
    )
    return _chat_text(session_id, provider, f"document:{doc_type}", system, user, temperature=0.18)


def generate_reports(session_id: str, case_id: str, risk_result: dict, provider: str) -> dict:
    tool_log = get_tool_execution_log(session_id)
    findings_data = extract_findings(session_id, case_id, tool_log, risk_result, provider)
    save_findings(session_id, findings_data)
    for doc_type in DOCUMENT_TYPES:
        content = generate_document(session_id, case_id, doc_type, findings_data, risk_result, tool_log, provider)
        save_document(session_id, doc_type, content)
    return findings_data


def _finalize_risk(session_id: str, risk_result: dict) -> None:
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        "UPDATE investigation_session SET risk_score = ?, confidence = ?, end_time = ? WHERE id = ?",
        (
            risk_result.get("risk_score"),
            risk_result.get("confidence"),
            datetime.now().isoformat(),
            session_id,
        ),
    )
    conn.commit()
    conn.close()


def run_agentic_investigation(case_id: str, session_id: str, context: dict | None = None) -> None:
    context = context or {}
    try:
        provider = context.get("selected_model", "chatgpt")
        providers = provider_status()
        log_activity(session_id, f"Started agentic investigation for Case {case_id}", "info")
        log_activity(session_id, f"Loaded workflow {WORKFLOW_VERSION} from {WORKFLOW_FILE}", "info")
        log_activity(
            session_id,
            f"Using model {provider} (LLM providers: ChatGPT={providers['chatgpt']['model']} Nemotron={providers['nemotron']['model']})",
            "info",
        )
        update_memory(session_id, f"Case ID: {case_id}\nInvestigation initialized at {datetime.utcnow().isoformat()}Z.")

        log_activity(session_id, f"Planner Agent analyzing live case data with {provider}.", "running")
        steps = plan_investigation(session_id, case_id, context)
        step_ids = _insert_plan_steps(session_id, steps)
        log_activity(session_id, f"{provider} generated {len(steps)} investigation steps.", "success")

        for step, step_id in zip(steps, step_ids):
            execute_step(session_id, case_id, step["tool"], step_id, context)

        risk_result = {}
        for loop_index in range(MAX_QA_LOOPS + 1):
            memory_text = _current_memory(session_id)
            log_activity(session_id, f"Risk Agent synthesizing evidence with {provider}.", "running")
            risk_result = synthesize_risk(session_id, case_id, memory_text, provider)
            _finalize_risk(session_id, risk_result)
            log_activity(session_id, "Risk synthesis complete.", "success")

            log_activity(session_id, f"QA Reflection Agent reviewing evidence sufficiency with {provider}.", "running")
            qa_result = qa_review(session_id, case_id, memory_text, risk_result, provider)
            if qa_result.get("sufficient") or loop_index == MAX_QA_LOOPS:
                log_activity(session_id, f"QA review complete: {qa_result.get('reasoning')}", "success")
                break

            log_activity(session_id, f"QA requested more evidence: {', '.join(qa_result.get('missing') or [])}", "info")
            followup_steps = plan_investigation(session_id, case_id, context, prior_memory=memory_text)
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM investigation_plan WHERE session_id = ?", (session_id,))
            offset = c.fetchone()["COUNT(*)"]
            conn.close()
            followup_ids = _insert_plan_steps(session_id, followup_steps, start_index=offset)
            for step, step_id in zip(followup_steps, followup_ids):
                execute_step(session_id, case_id, step["tool"], step_id, context)

        log_activity(session_id, f"Findings Agent analyzing the complete evidence trail with {provider}.", "running")
        update_session_status(session_id, "running", current_step="Generating Findings and Documents")
        findings_data = generate_reports(session_id, case_id, risk_result, provider)
        log_activity(
            session_id,
            f"Generated {len(findings_data.get('findings') or [])} findings, "
            f"{len(findings_data.get('recommendations') or [])} recommendations, and {len(DOCUMENT_TYPES)} documents.",
            "success",
        )

        update_session_status(session_id, "completed", current_step="Done")
        _finalize_risk(session_id, risk_result)
        log_activity(session_id, "Agentic investigation complete.", "success")
    except Exception as exc:
        update_session_status(session_id, "failed", current_step=f"Failed: {exc}")
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("UPDATE investigation_session SET end_time = ? WHERE id = ?", (datetime.now().isoformat(), session_id))
        conn.commit()
        conn.close()
        log_activity(session_id, f"Agentic investigation failed: {exc}", "error")


def start_investigation_async(case_id: str, context: dict | None = None) -> str:
    session_id = create_session(case_id)
    thread = threading.Thread(target=run_agentic_investigation, args=(case_id, session_id, context or {}))
    thread.daemon = True
    thread.start()
    return session_id
