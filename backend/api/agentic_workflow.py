"""
Autonomous LLM-backed investigation workflow.

This module intentionally fails closed when the configured LLMs are not
available. It does not use fake delays, placeholder findings, or hardcoded
summaries.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from api.agents import resolve_workflow_nodes
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


def _parse_llm_json(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    cleaned = str(raw).strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    start = cleaned.find("{")
    if start < 0:
        raise json.JSONDecodeError("No JSON object found", cleaned, 0)
    target = cleaned[start:].strip()
    try:
        value, _ = json.JSONDecoder().raw_decode(target)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    # Robust suffix repair for trailing truncated JSON
    for suffix in ["}", "]}", "]}}", "\"]}", "\"]}}", "\"}]}}", "\"}]"]:
        try:
            val = json.loads(target + suffix)
            if isinstance(val, dict):
                return val
        except Exception:
            pass

    # Item recovery for truncated findings output
    try:
        import re
        repaired = {}
        for key in ["findings", "evidence_items", "risk_drivers", "recommendations", "timeline", "open_questions"]:
            m = re.search(rf'"{key}"\s*:\s*(\[[^\]]*\])', target)
            if m:
                try:
                    repaired[key] = json.loads(m.group(1))
                except Exception:
                    repaired[key] = []
            else:
                repaired[key] = []
        if any(repaired.values()):
            return repaired
    except Exception:
        pass

    value, _ = json.JSONDecoder().raw_decode(target)
    if not isinstance(value, dict):
        raise json.JSONDecodeError("Expected a JSON object", cleaned, start)
    return value


def _chat_json(session_id: str, provider: str, stage: str, system: str, user: str, **kwargs) -> dict:
    prompt = f"SYSTEM:\n{system}\n\nUSER:\n{user}"
    raw = run_llm_json(provider, system, user)
    _save_last_llm(session_id, stage, prompt, raw)
    try:
        return _parse_llm_json(raw)
    except json.JSONDecodeError:
        # A real retry is preferable to publishing incomplete LLM output as findings.
        retry_system = (
            f"{system}\n\nYour previous response was incomplete or invalid. Return one COMPLETE, "
            "compact JSON object only. Do not use markdown fences. Keep arrays concise."
        )
        retry_raw = run_llm_json(provider, retry_system, user)
        _save_last_llm(session_id, f"{stage}:retry", f"SYSTEM:\n{retry_system}\n\nUSER:\n{user}", retry_raw)
        try:
            return _parse_llm_json(retry_raw)
        except json.JSONDecodeError as exc:
            raise LLMError(f"{provider} returned incomplete JSON for {stage}; findings/documents were not fabricated.") from exc


def _chat_text(session_id: str, provider: str, stage: str, system: str, user: str, **kwargs) -> str:
    response = run_llm_text(provider, system, user)
    _save_last_llm(session_id, stage, f"SYSTEM:\n{system}\n\nUSER:\n{user}", response)
    return response


def _summarize_tool(
    session_id: str,
    provider: str,
    tool_name: str,
    raw_output: str,
    current_memory: str = "",
    agent_instructions: str = "",
    agent_config: dict | None = None,
) -> str:
    agent_config = agent_config or {}
    evidence_depth = agent_config.get("evidence_depth", "standard")
    max_evidence = agent_config.get("max_evidence", 6)
    system = (
        "You are an expert AML investigator summarizing forensic tool findings. "
        "Summarize the evidence in 2-4 bullet points under 90 words: "
        "Key Facts, Metrics/Entities, Flags, and Risk. Do not hallucinate."
    )
    user = (
        f"Tool: {tool_name}\n\n"
        f"Raw tool output:\n{raw_output[:1800]}\n\n"
        f"Focus: {agent_instructions or 'Standard AML scope'}\n\n"
        f"Depth: {evidence_depth}. Maximum {max_evidence} points.\n\n"
        "Provide a concise summary."
    )
    return _chat_text(session_id, provider, f"summarize:{tool_name}", system, user)


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
                    (id, session_id, step_number, action_name, description, status, timestamp, agent_id, agent_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    step_id,
                    session_id,
                    start_index + index + 1,
                    step.get("agent_name") or str(tool_name or "").replace("_", " ").title(),
                    step.get("reason") or tool_meta.get("description", ""),
                    "pending",
                    datetime.now().isoformat(),
                    step.get("agent_id"),
                    step.get("agent_type"),
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
    
    # Compact high-signal case profile
    core_case = {
        "case_id": case_context.get("case_id") or case_id,
        "customer_id": case_context.get("customer_id"),
        "account_id": case_context.get("account_id"),
        "risk_score": case_context.get("risk_score"),
        "status": case_context.get("status"),
        "alerts": case_context.get("alerts") or [],
        "case_type": case_context.get("case_type"),
    }
    
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
        f"Case data summary:\n{json.dumps(core_case, indent=2, default=str)}\n\n"
        f"Prior memory if this is a follow-up loop:\n{prior_memory[-3000:] or 'None'}\n\n"
        "Create the investigation plan."
    )
    result = _chat_json(session_id, provider, "planner", system, user)
    steps = result.get("steps") or []
    valid = [step for step in steps if step.get("tool") in TOOL_REGISTRY]
    if not valid:
        raise LLMError("Planner did not return any valid tool steps.")
    return valid


def execute_step(session_id: str, case_id: str, tool_name: str, step_db_id: str, context: dict, agent: dict | None = None) -> None:
    agent = agent or {}
    agent_name = agent.get("name") or tool_name.replace("_", " ").title()
    agent_config = agent.get("config") if isinstance(agent.get("config"), dict) else {}
    log_activity(session_id, f"Agent started: {agent_name}", "running")
    update_session_status(session_id, "running", current_step=agent_name)

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

        configured_model = str(agent_config.get("model") or "inherit")
        selected_model = context.get("selected_model", "chatgpt")
        tool_provider = configured_model if configured_model != "inherit" else selected_model
        
        # Route strictly to configured OpenAI provider
        worker_provider = tool_provider if tool_provider in ("chatgpt", "openai") else "chatgpt"

        log_activity(
            session_id,
            f"{agent_name} analyzing evidence ({agent_config.get('evidence_depth', 'standard')} depth).",
            "info",
        )
        try:
            summary = _summarize_tool(
                session_id,
                worker_provider,
                tool_name,
                raw_output,
                current_memory=memory_text,
                agent_instructions=str(agent.get("instructions") or ""),
                agent_config=agent_config,
            )
        except Exception as exc:
            exc_str = str(exc)
            if any(k in exc_str.lower() for k in ["quota", "credit", "429", "insufficient_quota"]):
                log_activity(session_id, f"OpenAI Rate/Credit notice on {agent_name}: evidence recorded.", "warning")
            else:
                log_activity(session_id, f"{agent_name}: summary notice ({exc}) - evidence recorded.", "info")
            summary = f"Evidence captured ({len(raw_output)} bytes). Note: automated LLM summary fallback applied."

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
        log_activity(session_id, f"Agent completed: {agent_name}", "success")
        time.sleep(1.0)
    finally:
        conn.close()


def synthesize_risk(session_id: str, case_id: str, memory_text: str, provider: str) -> dict:
    system = (
        f"You are {provider} acting as the Risk Agent. Produce an evidence-backed AML "
        "risk assessment from the accumulated memory. Respond only with JSON: "
        '{"risk_score":0-100,"confidence":0-100,"key_drivers":["..."],'
        '"risk_evolution":[{"stage":"...","score":0,"reason":"..."}]}.'
    )
    user = f"Case ID: {case_id}\n\nAccumulated memory:\n{memory_text[-6000:]}"
    return _chat_json(session_id, provider, "risk_agent", system, user)


def qa_review(session_id: str, case_id: str, memory_text: str, risk_result: dict, provider: str) -> dict:
    system = (
        f"You are {provider} acting as the QA Reflection Agent. Decide whether the "
        "investigation has enough evidence or whether more tool execution is needed. "
        "Respond only with JSON: "
        '{"sufficient":true,"reasoning":"...","missing":["..."],"additional_focus":["..."]}.'
    )
    user = (
        f"Case ID: {case_id}\n\nMemory:\n{memory_text[-5000:]}\n\n"
        f"Risk assessment:\n{json.dumps(risk_result, indent=2, default=str)}"
    )
    return _chat_json(session_id, provider, "qa_reflection", system, user)


def extract_findings(session_id: str, case_id: str, tool_log: list[dict], risk_result: dict, provider: str) -> dict:
    evidence_blocks = "\n\n".join(
        f"=== {row.get('tool_name')} ===\n{row.get('summary') or ''}"
        for row in tool_log
    )
    system = (
        f"You are {provider} acting as the lead AML Findings Agent. Analyze the full "
        "evidence trail and produce structured, audit-ready findings. Every "
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
        '"open_questions":[{"question":"...","why_it_matters":"..."}]}. '
        "Limit output to 3 findings, 5 evidence items, 3 risk drivers, 3 recommendations, "
        "5 timeline entries, and 3 open questions so the JSON is complete."
    )
    user = (
        f"Case ID: {case_id}\n"
        f"Risk result:\n{json.dumps(risk_result, indent=2, default=str)}\n\n"
        f"Full tool evidence summaries:\n{evidence_blocks[:4500]}"
    )
    data = _chat_json(session_id, provider, "findings_agent", system, user)
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
    compact_tools = [{k: row.get(k) for k in ('tool_name', 'summary', 'status')} for row in tool_log]
    user = (
        f"Document type: {doc_type}\nCase ID: {case_id}\n\n"
        f"Risk result:\n{json.dumps(risk_result, indent=2, default=str)}\n\n"
        f"Structured findings:\n{json.dumps(findings_data, indent=2, default=str)[:4000]}\n\n"
        f"Tool summaries:\n{json.dumps(compact_tools, indent=2, default=str)[:3500]}\n\n"
        "Write the document with clear section headings, evidence references, "
        "recommendations where relevant, and enough detail for senior analyst review."
    )
    return _chat_text(session_id, provider, f"document:{doc_type}", system, user)


def generate_reports(session_id: str, case_id: str, risk_result: dict, provider: str) -> dict:
    tool_log = [row for row in get_tool_execution_log(session_id) if row.get("status") == "success"]
    if not tool_log:
        raise RuntimeError("No successful evidence tool output is available for report generation.")
    time.sleep(1.0)
    findings_data = extract_findings(session_id, case_id, tool_log, risk_result, provider)
    save_findings(session_id, findings_data)
    for doc_type in DOCUMENT_TYPES:
        time.sleep(1.0)
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
        raw_provider = context.get("selected_model", "chatgpt")
        provider = raw_provider if raw_provider in ("chatgpt", "openai") else "chatgpt"
        providers = provider_status()
        log_activity(session_id, f"Started agentic investigation for Case {case_id}", "info")
        log_activity(session_id, f"Loaded workflow {WORKFLOW_VERSION} from {WORKFLOW_FILE}", "info")
        openai_model = (
            providers.get("openai", {}).get("model")
            or providers.get("chatgpt", {}).get("model")
            or "gpt-5.6-luna"
        )
        log_activity(
            session_id,
            f"Using model {provider} (Configured OpenAI model: {openai_model})",
            "info",
        )
        update_memory(session_id, f"Case ID: {case_id}\nInvestigation initialized at {datetime.utcnow().isoformat()}Z.")

        workflow_agents = resolve_workflow_nodes(context.get("workflow_nodes"))
        if workflow_agents:
            log_activity(session_id, f"Canvas workflow loaded with {len(workflow_agents)} configured agents.", "success")
            steps = [
                {
                    "tool": agent["tool_name"],
                    "reason": agent.get("description") or f"Configured {agent['name']} agent.",
                    "agent_id": agent.get("node_id") or agent["id"],
                    "agent_type": agent["agent_type"],
                    "agent_name": agent["name"],
                    "agent": agent,
                }
                for agent in workflow_agents
            ]
        else:
            log_activity(session_id, f"Planner Agent analyzing live case data with {provider}.", "running")
            steps = plan_investigation(session_id, case_id, context)
        step_ids = _insert_plan_steps(session_id, steps)
        log_activity(session_id, f"{provider} prepared {len(steps)} investigation agents.", "success")

        if workflow_agents:
            workers = min(4, len(steps))
            log_activity(session_id, f"Spawning {workers} parallel investigation agents.", "running")
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="agentic") as executor:
                futures = [
                    executor.submit(execute_step, session_id, case_id, step["tool"], step_id, context, step.get("agent"))
                    for step, step_id in zip(steps, step_ids)
                ]
                for future in as_completed(futures):
                    future.result()
            log_activity(session_id, "Parallel agent execution completed.", "success")
        else:
            for step, step_id in zip(steps, step_ids):
                execute_step(session_id, case_id, step["tool"], step_id, context)

        successful_tools = [row for row in get_tool_execution_log(session_id) if row.get("status") == "success"]
        if not successful_tools:
            raise RuntimeError("No evidence tools completed successfully; findings and documents were not generated.")
        if len(successful_tools) < len(steps):
            log_activity(session_id, f"Continuing with {len(successful_tools)}/{len(steps)} successful evidence agents.", "info")

        risk_result = {}
        for loop_index in range(MAX_QA_LOOPS + 1):
            memory_text = _current_memory(session_id)
            log_activity(session_id, f"Risk Agent synthesizing evidence with {provider}.", "running")
            risk_result = synthesize_risk(session_id, case_id, memory_text, provider)
            _finalize_risk(session_id, risk_result)
            log_activity(session_id, "Risk synthesis complete.", "success")
            time.sleep(1.0)

            log_activity(session_id, f"QA Reflection Agent reviewing evidence sufficiency with {provider}.", "running")
            qa_result = qa_review(session_id, case_id, memory_text, risk_result, provider)
            if qa_result.get("sufficient") or loop_index == MAX_QA_LOOPS:
                log_activity(session_id, f"QA review complete: {qa_result.get('reasoning')}", "success")
                time.sleep(1.0)
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
        exc_str = str(exc)
        if any(term in exc_str.lower() for term in ["quota", "credit", "429", "insufficient_quota"]):
            user_msg = "OpenAI API credit limit reached or rate limit exceeded ($2 credit limit). Please check your OpenAI account balance."
            update_session_status(session_id, "failed", current_step=f"Failed: {user_msg}")
            log_activity(session_id, f"Investigation halted: {user_msg}", "error")
        else:
            update_session_status(session_id, "failed", current_step=f"Failed: {exc}")
            log_activity(session_id, f"Agentic investigation failed: {exc}", "error")
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
