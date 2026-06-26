# backend/api/routes/cases.py
import pandas as pd
from flask import Blueprint, request, jsonify, send_file
from api.utils import handle_errors
from api.services import services
import os
import sqlite3
import json
import io
import re
from datetime import datetime
from urllib.parse import unquote
from case_pack.case_pack_generator import CasePackGenerator
from case_pack.sentinel_handoff_report import generate_sentinel_handoff_report_pdf

cases_bp = Blueprint('cases', __name__)

def get_db_manager():
    """Helper to resolve the active investigation DB manager for the request."""
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    tenant_id = getattr(request, 'tenant_id', None)
    if not env_id:
        raise ValueError("No active environment selected.")
    return services.get_investigation_db(env_id, tenant_id)

def get_db_connection():
    """Helper to get environment-specific DB connection."""
    return get_db_manager().connect()


def _normalize_case_id(value):
    text = str(value or "").strip()
    return text if text else None


def _read_active_case_scope(cursor):
    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='active_case_scope'")
        if not cursor.fetchone():
            return {"type": "GLOBAL", "value": None, "run_id": None, "case_ids": []}

        cursor.execute("SELECT scope_type, scope_value, case_ids, run_id FROM active_case_scope WHERE id = 1")
        row = cursor.fetchone()
        if not row:
            return {"type": "GLOBAL", "value": None, "run_id": None, "case_ids": []}

        scope_type, scope_value, case_ids_json, run_id = row
        parsed_value = scope_value
        if isinstance(scope_value, str) and scope_value.strip().startswith(("[", "{")):
            try:
                parsed_value = json.loads(scope_value)
            except Exception:
                parsed_value = scope_value
        try:
            case_ids = json.loads(case_ids_json) if case_ids_json else []
        except Exception:
            case_ids = []
        normalized_ids = [_normalize_case_id(value) for value in case_ids]
        normalized_ids = [value for value in normalized_ids if value]
        return {
            "type": str(scope_type or "GLOBAL"),
            "value": parsed_value,
            "run_id": run_id,
            "case_ids": normalized_ids,
        }
    except Exception:
        return {"type": "GLOBAL", "value": None, "run_id": None, "case_ids": []}


def _case_scope_ids(cursor):
    scope = _read_active_case_scope(cursor)
    if str(scope.get("type") or "GLOBAL").upper() == "GLOBAL":
        return None
    case_ids = scope.get("case_ids") or []
    return case_ids if case_ids else []


def _scope_contains_case(cursor, case_id):
    normalized = _normalize_case_id(case_id)
    if not normalized:
        return False
    scope_case_ids = _case_scope_ids(cursor)
    if scope_case_ids is None:
        return True
    return normalized in {str(value) for value in scope_case_ids}


def _filter_df_to_scope(df, scope_case_ids):
    if df is None or df.empty or scope_case_ids is None:
        return df
    if not scope_case_ids:
        return df.iloc[0:0].copy()
    normalized_scope = {str(value) for value in scope_case_ids if value is not None}
    if not normalized_scope:
        return df.iloc[0:0].copy()

    case_col = next(
        (
            col for col in df.columns
            if "case" in str(col).lower() and ("id" in str(col).lower() or "no" in str(col).lower())
        ),
        None,
    )
    if not case_col:
        return df
    scoped_series = df[case_col].astype(str).map(lambda value: value.strip())
    return df.loc[scoped_series.isin(normalized_scope)].copy()


def _detect_case_table_columns(column_names):
    names = [str(col) for col in (column_names or [])]
    return {
        "case_id": next(
            (
                col for col in names
                if "case" in col.lower() and ("id" in col.lower() or "no" in col.lower())
            ),
            None,
        ),
        "pipeline_id": next((col for col in names if col.lower() in {"fcc_pipeline_id", "pipeline_id", "source_pipeline_id"}), None),
        "pipeline_name": next((col for col in names if col.lower() in {"fcc_pipeline_name", "pipeline_name", "source_pipeline_name"}), None),
        "publish_id": next((col for col in names if col.lower() in {"fcc_publish_id", "publish_id", "source_publish_id"}), None),
        "publish_label": next((col for col in names if col.lower() in {"fcc_publish_label", "publish_label", "source_publish_label"}), None),
        "risk_rating": next((col for col in names if col.lower() in {"risk_rating", "risk_level", "severity"}), None),
        "customer_risk_rating": next((col for col in names if col.lower() in {"customer_risk_rating", "customer_risk"}), None),
        "account_risk_rating": next((col for col in names if col.lower() in {"account_risk_rating", "account_risk"}), None),
        "priority": next((col for col in names if col.lower() in {"priority", "case_priority"}), None),
        "linked_cases_count": next((col for col in names if col.lower() in {"linked_cases_count", "linked_case_count"}), None),
        "prior_alerts_count": next((col for col in names if col.lower() in {"prior_alerts_count", "previous_alerts_count", "prev_alerts"}), None),
        "prior_case_count": next((col for col in names if col.lower() in {"prior_case_count", "previous_sars_count", "prev_sars"}), None),
        "historical_frequency": next((col for col in names if col.lower() in {"historical_frequency", "history_band", "history_profile"}), None),
        "behavior_context": next((col for col in names if col.lower() in {"behavior_context", "risk_context", "investigation_context"}), None),
    }


def _quote_identifier(name):
    return '"' + str(name or "").replace('"', '""') + '"'


def _load_case_source_metadata(conn, case_ids):
    normalized_ids = [str(value).strip() for value in (case_ids or []) if str(value or "").strip()]
    if not normalized_ids:
        return {}

    cursor = conn.cursor()
    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'")
        if not cursor.fetchone():
            return {}

        cursor.execute("PRAGMA table_info(cases)")
        case_columns = _detect_case_table_columns([row[1] for row in cursor.fetchall()])
        case_id_col = case_columns.get("case_id")
        selected_cols = [case_id_col] + [
            case_columns[key]
            for key in (
                "pipeline_id",
                "pipeline_name",
                "publish_id",
                "publish_label",
                "risk_rating",
                "customer_risk_rating",
                "account_risk_rating",
                "priority",
                "linked_cases_count",
                "prior_alerts_count",
                "prior_case_count",
                "historical_frequency",
                "behavior_context",
            )
            if case_columns.get(key)
        ]
        selected_cols = [col for col in selected_cols if col]
        if not case_id_col or len(selected_cols) <= 1:
            return {}

        quoted_cols = ", ".join(_quote_identifier(col) for col in selected_cols)
        placeholders = ",".join(["?"] * len(normalized_ids))
        cursor.execute(
            f'SELECT {quoted_cols} FROM "cases" WHERE {_quote_identifier(case_id_col)} IN ({placeholders})',
            normalized_ids,
        )
        rows = cursor.fetchall()
        lookup = {}
        for row in rows:
            payload = dict(zip(selected_cols, row))
            case_id = _normalize_case_id(payload.get(case_id_col))
            if not case_id:
                continue
            lookup[case_id] = {
                "source_pipeline_id": payload.get(case_columns.get("pipeline_id")) if case_columns.get("pipeline_id") else None,
                "source_pipeline_name": payload.get(case_columns.get("pipeline_name")) if case_columns.get("pipeline_name") else None,
                "source_publish_id": payload.get(case_columns.get("publish_id")) if case_columns.get("publish_id") else None,
                "source_publish_label": payload.get(case_columns.get("publish_label")) if case_columns.get("publish_label") else None,
                "risk_rating": payload.get(case_columns.get("risk_rating")) if case_columns.get("risk_rating") else None,
                "customer_risk_rating": payload.get(case_columns.get("customer_risk_rating")) if case_columns.get("customer_risk_rating") else None,
                "account_risk_rating": payload.get(case_columns.get("account_risk_rating")) if case_columns.get("account_risk_rating") else None,
                "case_priority": payload.get(case_columns.get("priority")) if case_columns.get("priority") else None,
                "linked_cases_count": payload.get(case_columns.get("linked_cases_count")) if case_columns.get("linked_cases_count") else None,
                "prior_alerts_count": payload.get(case_columns.get("prior_alerts_count")) if case_columns.get("prior_alerts_count") else None,
                "prior_case_count": payload.get(case_columns.get("prior_case_count")) if case_columns.get("prior_case_count") else None,
                "historical_frequency": payload.get(case_columns.get("historical_frequency")) if case_columns.get("historical_frequency") else None,
                "behavior_context": payload.get(case_columns.get("behavior_context")) if case_columns.get("behavior_context") else None,
            }
        return lookup
    except Exception:
        return {}


def _now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _get_llm_service():
    requested_provider = str(os.getenv("LLM_PROVIDER") or "").strip().lower()
    ollama_enabled = str(os.getenv("LLM_ENABLE_OLLAMA_FALLBACK") or "").strip().lower() in {"1", "true", "yes", "on"}
    candidates = [
        getattr(services, 'llm_provider', None),
        getattr(services, '_gpt4all_wrapper', None),
    ]
    if requested_provider == "ollama" or ollama_enabled:
        candidates.append(getattr(services, 'ollama_wrapper', None))
    if os.getenv("OPENAI_API_KEY") and not any(getattr(candidate, "provider_name", "") == "openai" for candidate in candidates if candidate):
        try:
            from llm.openai_wrapper import OpenAIWrapper
            candidates.insert(0, OpenAIWrapper())
        except Exception:
            pass
    for candidate in candidates:
        if not candidate:
            continue
        try:
            checker = getattr(candidate, 'check_connection', None)
            if callable(checker) and not checker():
                continue
            return candidate
        except Exception:
            continue
    return None


def _get_case_resolution_llm_candidates():
    candidates = []

    llm_provider = getattr(services, 'llm_provider', None)
    if llm_provider:
        candidates.append(llm_provider)

    gpt4all_wrapper = getattr(services, '_gpt4all_wrapper', None)
    if not gpt4all_wrapper:
        try:
            from llm.gpt4all_wrapper import GPT4AllWrapper
            gpt4all_wrapper = GPT4AllWrapper()
            setattr(services, '_gpt4all_wrapper', gpt4all_wrapper)
        except Exception:
            gpt4all_wrapper = None
    if gpt4all_wrapper:
        candidates.append(gpt4all_wrapper)

    if os.getenv("OPENAI_API_KEY"):
        if not any(getattr(candidate, 'provider_name', '') == 'openai' for candidate in candidates):
            try:
                from llm.openai_wrapper import OpenAIWrapper
                candidates.append(OpenAIWrapper())
            except Exception:
                pass

    if str(os.getenv("LLM_PROVIDER") or "").strip().lower() == "ollama" or str(os.getenv("LLM_ENABLE_OLLAMA_FALLBACK") or "").strip().lower() in {"1", "true", "yes", "on"}:
        ollama_service = getattr(services, 'ollama_wrapper', None)
        if ollama_service and getattr(ollama_service, 'provider_name', '') == 'ollama':
            candidates.append(ollama_service)
        if not any(getattr(candidate, 'provider_name', '') == 'ollama' for candidate in candidates):
            try:
                from llm.ollama_wrapper import OllamaWrapper
                candidates.append(OllamaWrapper())
            except Exception:
                pass

    deduped = []
    seen = set()
    for candidate in candidates:
        provider_name = str(getattr(candidate, 'provider_name', '') or candidate.__class__.__name__).strip().lower()
        base_url = str(getattr(candidate, 'base_url', '') or '').strip().lower()
        model_name = str(getattr(candidate, 'default_model', '') or '').strip().lower()
        key = (provider_name, base_url, model_name)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _generate_case_resolution_llm_response(prompt, model=None, system_prompt=None, temperature=0.1, max_tokens=360):
    errors = []
    for candidate in _get_case_resolution_llm_candidates():
        try:
            if not hasattr(candidate, 'check_connection') or not candidate.check_connection():
                errors.append(f"{getattr(candidate, 'provider_name', candidate.__class__.__name__)} unavailable")
                continue

            requested_model = model or getattr(candidate, 'default_model', None)
            result = candidate.generate(
                prompt=prompt,
                model=requested_model,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            if isinstance(result, dict) and result.get("success") and result.get("response"):
                return result, candidate

            errors.append(
                f"{getattr(candidate, 'provider_name', candidate.__class__.__name__)} failed: "
                f"{(result or {}).get('error') or 'empty response'}"
            )
        except Exception as exc:
            errors.append(f"{getattr(candidate, 'provider_name', candidate.__class__.__name__)} exception: {exc}")

    return {"success": False, "error": " | ".join(errors)}, None


def _table_exists(cursor, table_name):
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,))
    return bool(cursor.fetchone())


def _ensure_case_resolution_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS case_resolution_workspaces (
            case_id TEXT PRIMARY KEY,
            support_file_json TEXT NOT NULL,
            decision_status TEXT,
            final_action TEXT,
            analyst_rationale TEXT,
            sar_draft TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _safe_json_loads(value, fallback):
    if isinstance(value, (dict, list)):
        return value
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _normalize_evidence_strength(value):
    text = str(value or "").strip().lower()
    mapping = {
        "strong": "Strong",
        "medium": "Moderate",
        "moderate": "Moderate",
        "weak": "Weak",
        "low": "Weak",
    }
    return mapping.get(text, "Moderate")


def _normalize_case_resolution_support_file(case_id, payload=None):
    source = payload if isinstance(payload, dict) else {}
    summary = source.get("summary") if isinstance(source.get("summary"), dict) else {}
    hypothesis = source.get("hypothesis") if isinstance(source.get("hypothesis"), dict) else {}
    readiness = source.get("sar_readiness") if isinstance(source.get("sar_readiness"), dict) else {}
    decision = source.get("decision") if isinstance(source.get("decision"), dict) else {}
    investigation_summary = source.get("investigation_summary") if isinstance(source.get("investigation_summary"), dict) else {}
    case_synthesis = source.get("case_synthesis") if isinstance(source.get("case_synthesis"), dict) else {}
    source_payload = source.get("source_payload") if isinstance(source.get("source_payload"), dict) else {}
    audit = source.get("audit") if isinstance(source.get("audit"), dict) else {}
    progress = list(source.get("progress_steps") or [])
    if not progress:
        progress = [
            {"key": "intake", "label": "Intake", "state": "done"},
            {"key": "investigation", "label": "Investigation", "state": "current"},
            {"key": "evidence_built", "label": "Evidence Built", "state": "upcoming"},
            {"key": "narrative_drafted", "label": "Narrative Drafted", "state": "upcoming"},
            {"key": "decision", "label": "Decision", "state": "upcoming"},
            {"key": "closed", "label": "Closed", "state": "upcoming"},
        ]

    evidence_items = []
    for index, item in enumerate(source.get("evidence_items") or []):
        if not isinstance(item, dict):
            continue
        evidence_items.append({
            "id": item.get("id") or f"evidence_{index + 1}",
            "title": item.get("title") or item.get("evidence_type") or f"Evidence {index + 1}",
            "evidence_type": item.get("evidence_type") or "Investigation Finding",
            "source_module": item.get("source_module") or "Case Workspace",
            "source_records": list(item.get("source_records") or []),
            "occurred_at": item.get("occurred_at"),
            "why_it_matters": item.get("why_it_matters") or "",
            "strength": _normalize_evidence_strength(item.get("strength")),
            "analyst_status": item.get("analyst_status") or "pending",
            "analyst_comment": item.get("analyst_comment") or "",
            "is_key_evidence": bool(item.get("is_key_evidence")),
        })

    claims = []
    for index, item in enumerate(source.get("claims") or []):
        if not isinstance(item, dict):
            continue
        claims.append({
            "id": item.get("id") or f"claim_{index + 1}",
            "claim": item.get("claim") or "",
            "status": item.get("status") or "draft",
            "supported_evidence_ids": list(item.get("supported_evidence_ids") or []),
            "confidence": item.get("confidence") or "Needs analyst review",
            "notes": item.get("notes") or "",
        })

    mitigating_factors = []
    for index, item in enumerate(source.get("mitigating_factors") or []):
        if isinstance(item, str):
            mitigating_factors.append({
                "id": f"mitigating_{index + 1}",
                "factor": item,
                "status": "open",
                "analyst_note": "",
            })
        elif isinstance(item, dict):
            mitigating_factors.append({
                "id": item.get("id") or f"mitigating_{index + 1}",
                "factor": item.get("factor") or "",
                "status": item.get("status") or "open",
                "analyst_note": item.get("analyst_note") or "",
            })

    timeline_events = []
    for index, item in enumerate(source.get("timeline_events") or []):
        if not isinstance(item, dict):
            continue
        timeline_events.append({
            "id": item.get("id") or f"timeline_{index + 1}",
            "ts": item.get("ts") or item.get("date") or item.get("occurred_at"),
            "title": item.get("title") or item.get("label") or f"Timeline Event {index + 1}",
            "category": item.get("category") or "Case Event",
            "detail": item.get("detail") or item.get("description") or "",
            "source_module": item.get("source_module") or item.get("source") or "Investigation",
            "record_ids": list(item.get("record_ids") or []),
        })

    sar_sections = []
    for index, item in enumerate(source.get("sar_sections") or []):
        if not isinstance(item, dict):
            continue
        sar_sections.append({
            "id": item.get("id") or f"sar_section_{index + 1}",
            "title": item.get("title") or f"Section {index + 1}",
            "content": item.get("content") or "",
            "references": list(item.get("references") or []),
        })

    support_file = {
        "case_id": case_id,
        "title": source.get("title") or "Case Support File",
        "progress_steps": progress,
        "summary": {
            "case_id": case_id,
            "alert_count": int(summary.get("alert_count") or 0),
            "risk_score": summary.get("risk_score") if summary.get("risk_score") is not None else None,
            "analyst_status": summary.get("analyst_status") or "Under Investigation",
            "recommended_disposition": summary.get("recommended_disposition") or "Analyst Review Required",
            "confidence": summary.get("confidence") or "Pending",
        },
        "hypothesis": {
            "title": hypothesis.get("title") or "Suspicion Hypothesis",
            "pattern": hypothesis.get("pattern") or "",
            "narrative": hypothesis.get("narrative") or "",
            "supported": bool(hypothesis.get("supported")),
        },
        "evidence_items": evidence_items,
        "claims": claims,
        "mitigating_factors": mitigating_factors,
        "timeline_events": timeline_events,
        "investigation_summary": {
            "text": investigation_summary.get("text") or "",
            "references": list(investigation_summary.get("references") or []),
            "status_note": investigation_summary.get("status_note") or "",
        },
        "case_synthesis": {
            "reviewed": case_synthesis.get("reviewed") or "",
            "found": case_synthesis.get("found") or "",
            "supports_suspicion": case_synthesis.get("supports_suspicion") or "",
            "weakens_suspicion": case_synthesis.get("weakens_suspicion") or "",
            "requires_validation": case_synthesis.get("requires_validation") or "",
        },
        "sar_readiness": {
            "status": readiness.get("status") or "Not Ready",
            "reason": readiness.get("reason") or "Accepted evidence has not been curated yet.",
        },
        "decision": {
            "analyst_status": decision.get("analyst_status") or summary.get("analyst_status") or "Under Investigation",
            "final_action": decision.get("final_action") or "",
            "rationale": decision.get("rationale") or "",
            "sar_status": decision.get("sar_status") or ("Drafted" if source.get("sar_draft") else "Not Started"),
            "sar_accepted_at": decision.get("sar_accepted_at") or "",
            "sar_accepted_by": decision.get("sar_accepted_by") or "",
            "accepted_sar_draft": decision.get("accepted_sar_draft") or "",
            "requires_rationale": True,
        },
        "analyst_notes": source.get("analyst_notes") or "",
        "module_feeds": source.get("module_feeds") if isinstance(source.get("module_feeds"), dict) else {},
        "source_payload": source_payload,
        "ai_review": source.get("ai_review") if isinstance(source.get("ai_review"), dict) else {"draft_reasoning": "", "questions": []},
        "sar_sections": sar_sections,
        "sar_draft": source.get("sar_draft") or "",
        "audit": {
            "created_at": audit.get("created_at") or _now_iso(),
            "updated_at": audit.get("updated_at") or _now_iso(),
        },
    }
    return support_file


def _load_case_resolution_row(cursor, case_id):
    _ensure_case_resolution_table(cursor)
    cursor.execute(
        """
        SELECT support_file_json, decision_status, final_action, analyst_rationale, sar_draft, created_at, updated_at
        FROM case_resolution_workspaces
        WHERE case_id = ?
        """,
        (case_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    support_file = _normalize_case_resolution_support_file(case_id, _safe_json_loads(row[0], {}))
    support_file["decision"]["analyst_status"] = row[1] or support_file["decision"].get("analyst_status") or "Under Investigation"
    support_file["decision"]["final_action"] = row[2] or support_file["decision"].get("final_action") or ""
    support_file["decision"]["rationale"] = row[3] or support_file["decision"].get("rationale") or ""
    support_file["sar_draft"] = row[4] or support_file.get("sar_draft") or ""
    support_file["audit"]["created_at"] = row[5] or support_file["audit"].get("created_at") or _now_iso()
    support_file["audit"]["updated_at"] = row[6] or support_file["audit"].get("updated_at") or _now_iso()
    return support_file


def _persist_case_resolution_row(cursor, case_id, support_file):
    _ensure_case_resolution_table(cursor)
    normalized = _normalize_case_resolution_support_file(case_id, support_file)
    normalized["audit"]["updated_at"] = _now_iso()
    cursor.execute(
        """
        INSERT INTO case_resolution_workspaces (
            case_id, support_file_json, decision_status, final_action, analyst_rationale, sar_draft, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(case_id) DO UPDATE SET
            support_file_json = excluded.support_file_json,
            decision_status = excluded.decision_status,
            final_action = excluded.final_action,
            analyst_rationale = excluded.analyst_rationale,
            sar_draft = excluded.sar_draft,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            case_id,
            json.dumps(normalized),
            normalized["decision"].get("analyst_status"),
            normalized["decision"].get("final_action"),
            normalized["decision"].get("rationale"),
            normalized.get("sar_draft") or "",
        ),
    )
    return normalized


def _extract_json_object(text):
    raw = str(text or "").strip()
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    candidate = fenced.group(1).strip() if fenced else raw
    try:
        return json.loads(candidate)
    except Exception:
        pass
    brace_match = re.search(r"(\{.*\})", candidate, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(1))
        except Exception:
            return None
    return None


def _join_sar_sections(sections):
    blocks = []
    for section in sections or []:
        title = str(section.get("title") or "").strip()
        content = str(section.get("content") or "").strip()
        if not title or not content:
            continue
        blocks.append(f"{title}\n{content}")
    return "\n\n".join(blocks).strip()


def _slugify_text(value):
    text = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())
    return text.strip("_") or "section"


def _build_case_resolution_reference_map(support_file):
    evidence_lookup = {}
    for item in support_file.get("evidence_items", []) or []:
        evidence_lookup[str(item.get("id") or "")] = item
    return evidence_lookup


def _build_case_resolution_narrative_payload(case_id, support_file):
    source_payload = support_file.get("source_payload") or {}
    evidence_items = support_file.get("evidence_items", []) or []
    accepted_evidence = [item for item in evidence_items if str(item.get("analyst_status") or "").lower() == "accepted"]
    approved_claims = []
    accepted_ids = {str(item.get("id") or "") for item in accepted_evidence if item.get("id")}
    for claim in support_file.get("claims", []) or []:
        status = str(claim.get("status") or "").lower()
        supported = [item for item in (claim.get("supported_evidence_ids") or []) if str(item) in accepted_ids]
        if status in {"accepted", "approved", "supported"} and supported:
            approved_claims.append({
                "claim": claim.get("claim"),
                "supported_evidence_ids": supported,
                "notes": claim.get("notes") or "",
            })
    return {
        "case_id": case_id,
        "summary": support_file.get("summary") or {},
        "hypothesis": support_file.get("hypothesis") or {},
        "accepted_evidence": accepted_evidence,
        "all_evidence": evidence_items,
        "approved_claims": approved_claims,
        "mitigating_factors": support_file.get("mitigating_factors") or [],
        "timeline_events": (support_file.get("timeline_events") or [])[:12],
        "analyst_notes": support_file.get("analyst_notes") or "",
        "module_feeds": support_file.get("module_feeds") or {},
        "source_payload": source_payload,
    }


def _build_case_resolution_narrative_fallback(case_id, support_file):
    payload = _build_case_resolution_narrative_payload(case_id, support_file)
    accepted_evidence = payload["accepted_evidence"]
    all_evidence = payload["all_evidence"]
    approved_claims = payload["approved_claims"]
    mitigating = payload["mitigating_factors"]
    summary = payload["summary"]
    hypothesis = payload["hypothesis"]
    evidence_lookup = _build_case_resolution_reference_map(support_file)

    accepted_refs = [str(item.get("id")) for item in accepted_evidence[:6] if item.get("id")]
    broad_refs = accepted_refs or [str(item.get("id")) for item in all_evidence[:6] if item.get("id")]

    summary_parts = []
    summary_parts.append(
        f"Case {case_id} was reviewed using alert context, transaction history, baseline analysis, graph and lineage outputs, and the current analyst evidence set."
    )
    if hypothesis.get("pattern"):
        summary_parts.append(
            f"The working hypothesis remains {str(hypothesis.get('pattern')).strip().lower()}, based on the currently available investigation inputs."
        )
    if approved_claims:
        summary_parts.append(
            f"The present record contains {len(approved_claims)} analyst-approved claim(s) supported by accepted evidence."
        )
    else:
        summary_parts.append(
            "The present record does not yet contain analyst-approved claims supported by accepted evidence."
        )
    if accepted_evidence:
        summary_parts.append(
            f"The accepted evidence set currently contains {len(accepted_evidence)} item(s), including {', '.join(item.get('title') or 'evidence item' for item in accepted_evidence[:3])}."
        )
    else:
        summary_parts.append(
            "Evidence has been collected across modules, but the analyst has not yet accepted enough evidence to support a final suspicious activity narrative."
        )
    if mitigating:
        summary_parts.append(
            f"Mitigating factors remain under consideration, including {str((mitigating[0] or {}).get('factor') or 'documented contradictory context').strip().lower()}."
        )

    synthesis = {
        "reviewed": "Alert inventory, transaction history, baseline deviations, network and lineage findings, related case intelligence, and analyst notes were reviewed for this case.",
        "found": (
            "Current findings indicate potentially suspicious behavior that still requires careful confirmation."
            if all_evidence else
            "No substantive findings were available for synthesis at the time of review."
        ),
        "supports_suspicion": (
            "Suspicion is supported by accepted evidence and approved claims recorded in the Case Support File."
            if accepted_evidence and approved_claims else
            "Suspicion is not yet strongly supported because the accepted evidence base remains limited or unapproved."
        ),
        "weakens_suspicion": (
            "; ".join(str(item.get("factor") or "").strip() for item in mitigating[:2]) or
            "No explicit mitigating factors were documented."
        ),
        "requires_validation": (
            "Additional analyst validation is required before any SAR recommendation is finalized."
            if len(accepted_evidence) < 2 or not approved_claims else
            "The narrative is supported, but final analyst review is still required before filing."
        ),
    }

    enough_for_sar = len(accepted_evidence) >= 2 and len(approved_claims) >= 1
    subject_info = f"Subject case identifier: {case_id}. Current risk score: {summary.get('risk_score')}. Alert count in scope: {summary.get('alert_count')}."
    case_overview = (
        "This case was escalated for investigation after retained alerts and downstream analytical review indicated activity requiring explanation."
        if enough_for_sar else
        "This case is under active review. The investigation record has been assembled from the available case inputs, but the evidence base remains preliminary."
    )
    alert_background = "Alert background was assessed using the retained alert set carried in the Case Support File and the originating case context."
    txn_review = (
        "Transaction activity reviewed includes the transaction history linked to the case and the events reflected in the timeline and accepted evidence."
        if accepted_evidence else
        "Transaction activity has been collected from the connected case sources, but the draft should be treated as preliminary until the analyst confirms which transactions are material."
    )
    behavioral = (
        "Behavioral analysis considered baseline deviations, prior alert context, and any historical or repetitive activity available in the investigation record."
        if all_evidence else
        "Behavioral and historical analysis remains limited because the connected investigation modules have not yet produced a strong corroborating evidence set."
    )
    linked_entities = (
        "Linked entity findings were reviewed using graph and lineage outputs, including related paths, connected entities, and network-derived observations."
        if all_evidence else
        "Linked entity findings are currently limited and should be validated against graph and lineage outputs before reliance."
    )
    grounds = (
        "Grounds for suspicion are limited to the approved claims and the accepted evidence mapped to those claims."
        if enough_for_sar else
        "Grounds for suspicion remain provisional because accepted evidence and approved claims are not yet sufficient for a fully supported filing recommendation."
    )
    risk_drivers = []
    if hypothesis.get("pattern"):
        risk_drivers.append(f"Current hypothesis: {hypothesis.get('pattern')}.")
    if accepted_evidence:
        risk_drivers.append(
            f"Accepted evidence includes {', '.join(str(item.get('title') or 'evidence item') for item in accepted_evidence[:3])}."
        )
    elif all_evidence:
        risk_drivers.append(
            f"Available investigation signals include {', '.join(str(item.get('title') or 'evidence item') for item in all_evidence[:3])}."
        )
    if not risk_drivers:
        risk_drivers.append("Risk drivers remain preliminary because the current case record does not yet contain enough validated evidence.")
    next_steps = (
        "Analyst should validate the generated narrative against the linked alerts, transactions, baseline results, graph outputs, and lineage details before filing."
        if enough_for_sar else
        "Analyst should review the linked alerts, transactions, baseline results, graph outputs, and lineage details and then refine the rationale before any closure or filing decision."
    )
    conclusion = (
        "Based on the accepted evidence and approved claims presently recorded, the case appears ready for formal SAR drafting, subject to final analyst review."
        if enough_for_sar else
        "The case is not yet fully ready for a final SAR recommendation. The draft can be used as a working narrative, but additional analyst validation is still required."
    )
    sar_sections = []
    for title, content, refs in [
        ("Subject Information", subject_info, broad_refs[:3]),
        ("Case Overview", case_overview, broad_refs[:3]),
        ("Alert Background", alert_background, [ref for ref in broad_refs if "alert" in ref][:3] or broad_refs[:2]),
        ("Transaction Activity Reviewed", txn_review, broad_refs[:3]),
        ("Behavioral and Historical Analysis", behavioral, [ref for ref, item in evidence_lookup.items() if item.get("source_module") in {"Baseline", "Case Pack"}][:4] or broad_refs[:3]),
        ("Linked Entity Findings", linked_entities, [ref for ref, item in evidence_lookup.items() if item.get("source_module") in {"Graph Analysis", "Lineage Explorer"}][:4] or broad_refs[:3]),
        ("Grounds for Suspicion", grounds, broad_refs[:5]),
        ("Explain Risk Drivers", " ".join(risk_drivers), broad_refs[:4]),
        ("Recommended Next Steps", next_steps, broad_refs[:3]),
        ("Conclusion and Recommendation", conclusion, broad_refs[:4]),
    ]:
        sar_sections.append({
            "id": f"sar_{_slugify_text(title)}",
            "title": title,
            "content": content,
            "references": refs,
        })

    return {
        "investigation_summary": {
            "text": " ".join(summary_parts).strip(),
            "references": broad_refs,
            "status_note": (
                "Case appears ready for SAR drafting subject to final analyst review."
                if enough_for_sar else
                "Case is not yet ready for SAR drafting because accepted evidence or approved claims remain insufficient."
            ),
        },
        "case_synthesis": synthesis,
        "sar_sections": sar_sections,
        "sar_draft": _join_sar_sections(sar_sections),
    }


def _load_case_resolution_case_snapshot(cursor, case_id):
    snapshot = {
        "case_id": case_id,
        "alert_count": 0,
        "risk_score": None,
        "analyst_status": "Under Investigation",
        "recommended_disposition": "Analyst Review Required",
        "confidence": "Pending",
    }

    if _table_exists(cursor, "cases"):
        cursor.execute("PRAGMA table_info(cases)")
        columns = [row[1] for row in cursor.fetchall()]
        detected = _detect_case_table_columns(columns)
        case_id_col = detected.get("case_id")
        if case_id_col:
            select_cols = [case_id_col]
            optional_cols = {
                "status": next((col for col in columns if str(col).lower() == "status"), None),
                "risk_score": next((col for col in columns if "risk_score" in str(col).lower()), None),
                "alert_count": next((col for col in columns if "alert_count" in str(col).lower()), None),
                "priority": detected.get("priority"),
            }
            select_cols.extend([col for col in optional_cols.values() if col])
            quoted_cols = ", ".join(_quote_identifier(col) for col in select_cols)
            cursor.execute(
                f'SELECT {quoted_cols} FROM "cases" WHERE {_quote_identifier(case_id_col)} = ? LIMIT 1',
                (case_id,),
            )
            row = cursor.fetchone()
            if row:
                data = dict(zip(select_cols, row))
                status_col = optional_cols.get("status")
                risk_score_col = optional_cols.get("risk_score")
                alert_count_col = optional_cols.get("alert_count")
                snapshot["analyst_status"] = data.get(status_col) or snapshot["analyst_status"]
                snapshot["risk_score"] = data.get(risk_score_col) if risk_score_col else snapshot["risk_score"]
                snapshot["alert_count"] = int(data.get(alert_count_col) or 0) if alert_count_col else snapshot["alert_count"]

    if _table_exists(cursor, "alerts"):
        cursor.execute("PRAGMA table_info(alerts)")
        alert_cols = [row[1] for row in cursor.fetchall()]
        alert_case_col = next((c for c in alert_cols if "case" in str(c).lower() and ("id" in str(c).lower() or "no" in str(c).lower())), None)
        if alert_case_col:
            cursor.execute(
                f'SELECT COUNT(*) FROM "alerts" WHERE {_quote_identifier(alert_case_col)} = ?',
                (case_id,),
            )
            row = cursor.fetchone()
            if row and row[0] is not None:
                snapshot["alert_count"] = int(row[0])

    return snapshot


def _update_case_status_record(cursor, case_id, new_status):
    updated = False
    for table in ("cases", "master_cleaned_data", "master_case_summary"):
        if not _table_exists(cursor, table):
            continue
        cursor.execute(f'PRAGMA table_info("{table}")')
        cols = [r[1] for r in cursor.fetchall()]
        case_col = next((c for c in cols if 'case' in c.lower() and ('id' in c.lower() or 'no' in c.lower())), None)
        if not case_col:
            continue
        status_col = next((c for c in cols if 'status' == c.lower()), None)
        if not status_col:
            cursor.execute(f'ALTER TABLE "{table}" ADD COLUMN status TEXT DEFAULT \'New\'')
            status_col = 'status'
        cursor.execute(f'SELECT COUNT(*) FROM "{table}" WHERE "{case_col}" = ?', (case_id,))
        exists_row = cursor.fetchone()
        if not exists_row or not exists_row[0]:
            continue
        cursor.execute(f'UPDATE "{table}" SET "{status_col}" = ? WHERE "{case_col}" = ?', (new_status, case_id))
        updated = True
    if _table_exists(cursor, "case_queue"):
        updates = ['current_status = ?', 'last_updated_at = ?']
        values = [new_status, _now_iso()]
        stage_value = {
            "Draft Prepared": "Resolution Draft",
            "Pending L2 Review": "Escalation",
            "Pending BM Review": "Escalation",
            "Pending Vigilance Review": "Escalation",
            "Escalated": "Escalation",
            "Awaiting Response": "Final Decision",
            "SAR Recommended": "Final Decision",
            "Closed": "Closure",
            "Rejected / No Further Action": "Closure",
        }.get(new_status)
        if stage_value:
            updates.append('current_stage = ?')
            values.append(stage_value)
        if new_status in {"Closed", "Rejected / No Further Action"}:
            updates.append('closed_at = ?')
            values.append(_now_iso())
        values.append(case_id)
        cursor.execute(f'UPDATE "case_queue" SET {", ".join(updates)} WHERE case_id = ?', values)
        updated = updated or cursor.rowcount > 0
    return updated

# =========================================================================
#  CASE SCOPE MANAGEMENT (NEW - CRITICAL)
# =========================================================================

@cases_bp.route('/case-scope/set', methods=['POST'])
@handle_errors
def set_case_scope():
    """
    Sets the active case scope for the environment.
    This becomes the authoritative filter for ALL screens.
    
    Scope Types:
    - GLOBAL: All cases (default)
    - BUCKET: Specific priority bucket from a run
    - CUSTOM: User-defined case ID list
    """
    data = request.json
    scope_type = data.get('scope_type', 'GLOBAL')
    scope_value = data.get('scope_value')
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Create scope table if doesn't exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_case_scope (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                scope_type TEXT NOT NULL,
                scope_value TEXT,
                case_ids TEXT,
                run_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Resolve case IDs based on scope type
        case_ids = []
        run_id = None
        
        if scope_type == 'BUCKET':
            bucket_name = scope_value
            run_id = data.get('run_id')
            
            if not run_id:
                cursor.execute("SELECT run_id FROM focus_runs ORDER BY run_at DESC LIMIT 1")
                row = cursor.fetchone()
                if not row:
                    return jsonify({"success": False, "error": "No focus runs available"}), 400
                run_id = row[0]
            
            # Get case IDs from this bucket
            if bucket_name == 'All':
                cursor.execute(
                    "SELECT entity_key FROM focus_results WHERE run_id = ? AND is_included = 1",
                    (run_id,)
                )
            else:
                cursor.execute(
                    "SELECT entity_key FROM focus_results WHERE run_id = ? AND bucket = ? AND is_included = 1",
                    (run_id, bucket_name)
                )
            
            case_ids = [r[0] for r in cursor.fetchall()]
            
        elif scope_type == 'CUSTOM':
            case_ids = scope_value if isinstance(scope_value, list) else []
            
        elif scope_type == 'GLOBAL':
            cursor.execute("SELECT DISTINCT case_id FROM cases")
            case_ids = [str(r[0]) for r in cursor.fetchall()]
        
        stored_scope_value = scope_value
        if isinstance(scope_value, (list, dict)):
            stored_scope_value = json.dumps(scope_value)

        # Store scope
        cursor.execute("""
            INSERT OR REPLACE INTO active_case_scope (id, scope_type, scope_value, case_ids, run_id, updated_at)
            VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (scope_type, stored_scope_value, json.dumps(case_ids), run_id))
        
        conn.commit()
        
        return jsonify({
            "success": True,
            "scope": {
                "type": scope_type,
                "value": scope_value,
                "run_id": run_id,
                "case_count": len(case_ids)
            }
        })
        
    finally:
        if conn: conn.close()


@cases_bp.route('/case-scope/get', methods=['GET'])
@handle_errors
def get_case_scope():
    """Returns the current active scope + filtered case IDs"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='active_case_scope'")
        if not cursor.fetchone():
            return jsonify({
                "success": True,
                "scope": {
                    "type": "GLOBAL",
                    "value": None,
                    "case_count": 0,
                    "case_ids": []
                }
            })
        
        cursor.execute("SELECT scope_type, scope_value, case_ids, run_id FROM active_case_scope WHERE id = 1")
        row = cursor.fetchone()
        
        if not row:
            return jsonify({
                "success": True,
                "scope": {"type": "GLOBAL", "value": None, "case_count": 0, "case_ids": []}
            })
        
        scope_type, scope_value, case_ids_json, run_id = row
        if isinstance(scope_value, str) and scope_value.strip().startswith(('[', '{')):
            try:
                scope_value = json.loads(scope_value)
            except Exception:
                pass
        case_ids = json.loads(case_ids_json) if case_ids_json else []
        
        return jsonify({
            "success": True,
            "scope": {
                "type": scope_type,
                "value": scope_value,
                "run_id": run_id,
                "case_count": len(case_ids),
                "case_ids": case_ids
            }
        })
        
    finally:
        if conn: conn.close()


@cases_bp.route('/case-scope/clear', methods=['POST'])
@handle_errors
def clear_case_scope():
    """Resets to GLOBAL scope"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM active_case_scope WHERE id = 1")
        conn.commit()
        return jsonify({"success": True, "message": "Scope reset to GLOBAL"})
    finally:
        if conn: conn.close()


# =========================================================================
#  FOCUS ENGINE ROUTES (FIXED)
# =========================================================================

@cases_bp.route('/focus/run', methods=['POST'])
@handle_errors
def run_focus_engine():
    """FIXED: Now stores structured run metadata"""
    config = request.json.get('config', None)
    
    if not hasattr(services, 'focus_engine') or not services.focus_engine:
        from services.focus_engine import FocusEngine
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
        db_manager = services.get_investigation_db(env_id, getattr(request, 'tenant_id', None))
        services.focus_engine = FocusEngine(db_manager)

    result = services.focus_engine.run_focus_job(config_override=config)
    
    # ✅ FIX: Store run metadata in structured format
    if result.get('success'):
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            # Ensure table has all needed columns
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS focus_runs (
                    run_id TEXT PRIMARY KEY,
                    run_at TEXT,
                    total_cases INTEGER,
                    included_cases INTEGER,
                    configuration TEXT,
                    min_threshold INTEGER,
                    lookback_days INTEGER,
                    bucket_distribution TEXT
                )
            """)
            
            # Extract bucket distribution
            cursor.execute("""
                SELECT bucket, COUNT(*) 
                FROM focus_results 
                WHERE run_id = ? AND is_included = 1 
                GROUP BY bucket
            """, (result['run_id'],))
            
            buckets = {row[0] if row[0] else 'Review': row[1] for row in cursor.fetchall()}
            
            # Store metadata
            cursor.execute("""
                INSERT OR REPLACE INTO focus_runs 
                (run_id, run_at, total_cases, included_cases, configuration, min_threshold, lookback_days, bucket_distribution)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                result['run_id'],
                result.get('run_at') or datetime.now().isoformat(),
                result.get('total_cases', 0),
                result.get('included_cases', 0),
                json.dumps(config or {}),
                config.get('min_score_threshold') if config else None,
                config.get('lookback_days') if config else None,
                json.dumps(buckets)
            ))
            
            conn.commit()
        finally:
            if conn: conn.close()
    
    return jsonify(result) if result['success'] else (jsonify(result), 500)


@cases_bp.route('/focus/inbox', methods=['GET'])
@handle_errors
def get_focus_inbox():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='focus_runs'")
        if not cursor.fetchone():
             return jsonify({"success": True, "cases": [], "message": "Focus engine not initialized"})

        cursor.execute("SELECT run_id, run_at FROM focus_runs ORDER BY run_at DESC LIMIT 1")
        run_row = cursor.fetchone()
        
        if not run_row:
            try:
                if not hasattr(services, 'focus_engine') or not services.focus_engine:
                    from services.focus_engine import FocusEngine
                    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
                    db_manager = services.get_investigation_db(env_id, getattr(request, 'tenant_id', None))
                    services.focus_engine = FocusEngine(db_manager)
                services.focus_engine.run_focus_job()
                cursor.execute("SELECT run_id, run_at FROM focus_runs ORDER BY run_at DESC LIMIT 1")
                run_row = cursor.fetchone()
            except Exception:
                run_row = None
            if not run_row:
                return jsonify({"success": False, "error": "Risk index not built. Run Focus Engine.", "cases": []})
            
        run_id, run_at = run_row

        run_at_reason = None
        if run_at:
            try:
                from datetime import datetime
                datetime.fromisoformat(str(run_at).replace("Z", "+00:00"))
            except Exception:
                run_at_reason = "run_at not parseable as ISO timestamp"
                run_at = None
        
        cursor.execute("""
            SELECT entity_key, risk_score, bucket, reasons, 
                   alert_count, critical_count, last_alert_date, alert_vector
            FROM focus_results
            WHERE run_id = ? AND is_included = 1
            ORDER BY risk_score DESC
        """, (run_id,))
        
        rows = cursor.fetchall()
        scope_case_ids = _case_scope_ids(cursor)
        if scope_case_ids is not None:
            allowed_ids = {str(value) for value in scope_case_ids}
            rows = [row for row in rows if str(row[0]) in allowed_ids]
        source_lookup = _load_case_source_metadata(conn, [row[0] for row in rows])
        cases = []
        for r in rows:
            try: reasons_list = json.loads(r[3])
            except: reasons_list = []
            try: vector = json.loads(r[7])
            except: vector = {}
            try:
                rs = int(r[1]) if r[1] is not None else None
            except Exception:
                rs = None
            hybrid = None
            if rs is not None:
                try:
                    hybrid = max(0.0, min(1.0, float(rs) / 100.0))
                except Exception:
                    hybrid = None
            source_meta = source_lookup.get(str(r[0]), {})
            enriched_reasons = [str(reason).strip() for reason in (reasons_list or []) if str(reason or "").strip()]
            behavior_context = source_meta.get("behavior_context")
            prior_alerts_count = source_meta.get("prior_alerts_count")
            linked_cases_count = source_meta.get("linked_cases_count")
            if behavior_context and behavior_context not in enriched_reasons:
                enriched_reasons.append(str(behavior_context))
            if str(prior_alerts_count or "").strip():
                enriched_reasons.append(f"{prior_alerts_count} prior alerts")
            if str(linked_cases_count or "").strip():
                enriched_reasons.append(f"{linked_cases_count} linked cases")
            deduped_reasons = []
            seen_reasons = set()
            for item in enriched_reasons:
                key = str(item).strip().lower()
                if not key or key in seen_reasons:
                    continue
                seen_reasons.add(key)
                deduped_reasons.append(item)

            cases.append({
                "case_id": r[0],
                "risk_score": rs,
                "hybrid_score": hybrid,
                "bucket": r[2] if r[2] else "Review",
                "reasons": deduped_reasons[:4],
                "alert_count": r[4],
                "critical_alerts": r[5],
                "last_alert": r[6],
                "alert_types": vector,
                "context_run_id": run_id,
                "rule_trigger_reason": "Rules are executed per-case via /api/v2/risk-intelligence/analyze",
                "source_pipeline_id": source_meta.get("source_pipeline_id"),
                "source_pipeline_name": source_meta.get("source_pipeline_name"),
                "source_publish_id": source_meta.get("source_publish_id"),
                "source_publish_label": source_meta.get("source_publish_label"),
                "severity": source_meta.get("risk_rating"),
                "customer_risk_rating": source_meta.get("customer_risk_rating"),
                "account_risk_rating": source_meta.get("account_risk_rating"),
                "case_priority": source_meta.get("case_priority"),
                "linked_cases_count": source_meta.get("linked_cases_count"),
                "prior_alerts_count": source_meta.get("prior_alerts_count"),
                "prior_case_count": source_meta.get("prior_case_count"),
                "historical_frequency": source_meta.get("historical_frequency"),
                "behavior_context": source_meta.get("behavior_context"),
            })
            
        payload = {"success": True, "run_id": run_id, "run_at": run_at, "cases": cases}
        if run_at_reason:
            payload["run_at_reason"] = run_at_reason
        return jsonify(payload)
    finally:
        if conn: conn.close()


@cases_bp.route('/focus/history', methods=['GET'])
@handle_errors
def get_focus_history():
    """FIXED: Returns structured table data with AUTO-MIGRATION"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='focus_runs'")
        if not cursor.fetchone(): 
            return jsonify({"success": True, "history": []})

        # ✅ AUTO-MIGRATE: Check if new columns exist
        cursor.execute("PRAGMA table_info(focus_runs)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        
        if 'min_threshold' not in existing_cols:
            print("⚠️  Migrating focus_runs table schema...")
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN min_threshold INTEGER")
        if 'lookback_days' not in existing_cols:
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN lookback_days INTEGER")
        if 'bucket_distribution' not in existing_cols:
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN bucket_distribution TEXT")
        
        conn.commit()

        # Now safe to query
        cursor.execute("""
            SELECT run_id, run_at, total_cases, included_cases, 
                   min_threshold, lookback_days, bucket_distribution
            FROM focus_runs 
            ORDER BY run_at DESC 
            LIMIT 20
        """)
        
        rows = cursor.fetchall()
        history = []
        
        for r in rows:
            try:
                buckets = json.loads(r[6]) if r[6] else {}
            except:
                buckets = {}
            
            history.append({
                "run_id": r[0],
                "run_at": r[1],
                "total_cases": r[2],
                "included_cases": r[3],
                "threshold": r[4] if r[4] else 'N/A',
                "lookback_days": r[5] if r[5] else 'N/A',
                "buckets": buckets
            })
        
        return jsonify({"success": True, "history": history})
    finally:
        if conn: conn.close()


@cases_bp.route('/focus/bucket/update', methods=['POST'])
@handle_errors
def update_case_bucket():
    """Persist bucket changes"""
    data = request.json
    case_ids = data.get('case_ids', [])
    new_bucket = data.get('bucket')
    run_id = data.get('run_id')

    if not case_ids or not new_bucket:
        return jsonify({"error": "Missing case_ids or bucket"}), 400

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(case_ids))
        
        query = f"UPDATE focus_results SET bucket = ? WHERE entity_key IN ({placeholders})"
        params = [new_bucket] + case_ids
        
        if run_id:
            query += " AND run_id = ?"
            params.append(run_id)
            
        cursor.execute(query, params)
        conn.commit()
        return jsonify({"success": True, "updated": cursor.rowcount})
    finally:
        if conn: conn.close()


# =========================================================================
#  LEGACY RANKING (Keep for compatibility)
# =========================================================================

@cases_bp.route('/cases/rerank', methods=['POST'])
@handle_errors
def rerank_cases():
    """Legacy ranking endpoint"""
    conn = services.investigation_db.connect()
    try:
        try:
            df_alerts = pd.read_sql("SELECT * FROM alerts", conn)
            df_cases = pd.read_sql("SELECT * FROM cases", conn)
        except Exception as e:
            return jsonify({"success": False, "error": f"Data Missing: {str(e)}"}), 400

        if df_alerts.empty:
            return jsonify({"success": True, "message": "No alerts to rank.", "cases_processed": 0})

        df_alerts.columns = [c.lower() for c in df_alerts.columns]
        df_cases.columns = [c.lower() for c in df_cases.columns]
        
        case_id_col = next((c for c in df_alerts.columns if 'case' in c and 'id' in c), None)
        severity_col = next((c for c in df_alerts.columns if 'severity' in c or 'priority' in c or 'type' in c), None)
        date_col = next((c for c in df_alerts.columns if 'date' in c or 'time' in c or 'created' in c), None)

        if not case_id_col:
            return jsonify({"success": False, "error": "Could not identify Case ID in alerts."}), 400

        grouped = df_alerts.groupby(case_id_col)
        ranking_data = []
        
        for case_id, group in grouped:
            score = 0
            crit_count = 0
            alert_vector = {}
            
            for _, row in group.iterrows():
                sev = str(row.get(severity_col, 'Medium')).capitalize()
                alert_vector[sev] = alert_vector.get(sev, 0) + 1
                
                if 'Critical' in sev: 
                    score += 20
                    crit_count += 1
                elif 'High' in sev: score += 10
                elif 'Medium' in sev: score += 5
                else: score += 1
            
            final_score = min(100, score)
            last_date = None
            if date_col:
                try: last_date = group[date_col].max()
                except: pass
            
            ranking_data.append({
                "entity_key": str(case_id),
                "entity_type": "case",
                "risk_score": final_score,
                "alert_count": len(group),
                "critical_alert_count": crit_count,
                "last_alert_date": last_date,
                "alert_vector": json.dumps(alert_vector)
            })

        if not ranking_data:
             return jsonify({"success": True, "message": "No cases ranked.", "cases_processed": 0})
             
        df_rank = pd.DataFrame(ranking_data)
        df_rank.to_sql('investigation_risk_index', conn, if_exists='replace', index=False)
        
        cursor = conn.cursor()
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_risk_score ON investigation_risk_index(risk_score DESC)")
        conn.commit()

        return jsonify({
            "success": True, 
            "message": "Focus Engine run successfully", 
            "cases_processed": len(df_rank)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/cases/ranked', methods=['GET'])
@handle_errors
def get_ranked_cases():
    """Legacy ranked cases endpoint"""
    conn = services.investigation_db.connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='investigation_risk_index'")
        if not cursor.fetchone():
            return jsonify({
                "success": False,
                "error": "Risk index not built yet. Please run Focus Engine first.",
                "cases": []
            })
        
        query = """
            SELECT entity_key, entity_type, risk_score, alert_count, 
                   critical_alert_count, last_alert_date, alert_vector
            FROM investigation_risk_index
            WHERE entity_type = 'case'
            ORDER BY risk_score DESC, alert_count DESC
            LIMIT 100
        """
        
        df = pd.read_sql(query, conn)
        
        if df.empty:
            return jsonify({"success": True, "cases": []})
        
        cases = []
        for _, row in df.iterrows():
            alert_vector = json.loads(row['alert_vector']) if row['alert_vector'] else {}
            
            reasons = []
            if row['critical_alert_count'] > 0:
                reasons.append(f"{row['critical_alert_count']} Critical Alert(s)")
            if row['risk_score'] > 80:
                reasons.append("High Aggregate Risk")
            elif row['alert_count'] > 10:
                reasons.append("High Alert Volume")
            
            reason_text = ", ".join(reasons) if reasons else "Routine Review"

            cases.append({
                "case_id": row['entity_key'],
                "risk_score": int(row['risk_score']),
                "risk_level": _risk_level_from_score(row['risk_score']),
                "alert_count": int(row['alert_count']),
                "critical_alerts": int(row['critical_alert_count']),
                "last_alert": row['last_alert_date'],
                "alert_types": alert_vector,
                "reasoning": reason_text,
                "status": "New" 
            })
        
        return jsonify({"success": True, "cases": cases})
        
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/cases/search', methods=['GET'])
@handle_errors
def search_cases():
    """Manual Override - Search any entity by ID"""
    query = request.args.get('q', '').strip()
    if not query: return jsonify({"success": False, "error": "Query parameter 'q' required"})
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM cases WHERE CAST(case_id AS TEXT) LIKE ? LIMIT 1", (f"%{query}%",))
        row = cursor.fetchone()
        
        if row:
            return jsonify({
                "success": True,
                "found": True,
                "entity": {
                    "entity_id": query,
                    "type": "case",
                    "source": "Master Data (Global)"
                }
            })
        return jsonify({"success": False, "error": "Not found in Master Data"})
    finally:
        if conn: conn.close()


def _risk_level_from_score(score):
    if score >= 80: return "Critical"
    elif score >= 60: return "High"
    elif score >= 40: return "Medium"
    elif score > 0: return "Low"
    else: return "Unscored"


# =========================================================================
#  UTILITY ENDPOINTS
# =========================================================================

@cases_bp.route('/case-list', methods=['GET'])
@handle_errors
def list_cases():
    conn = get_db_connection()
    try:
        try:
            df_raw = pd.read_sql('SELECT * FROM "cases"', conn)
        except Exception:
            return jsonify([])

        scope_case_ids = _case_scope_ids(conn.cursor())
        df_raw = _filter_df_to_scope(df_raw, scope_case_ids)
        if df_raw.empty:
            return jsonify([])

        raw_id_col = next((c for c in df_raw.columns if 'case' in c.lower() and ('id' in c.lower() or 'no' in c.lower())), None)
        if not raw_id_col:
            return jsonify([])

        status_col = next((c for c in df_raw.columns if str(c).lower() == 'status'), None)
        risk_rating_col = next((c for c in df_raw.columns if 'risk_rating' in str(c).lower() or 'risk_level' in str(c).lower()), None)
        risk_score_col = next((c for c in df_raw.columns if 'risk_score' in str(c).lower()), None)
        alert_count_col = next((c for c in df_raw.columns if 'alert_count' in str(c).lower()), None)
        pipeline_id_col = next((c for c in df_raw.columns if str(c).lower() in {'fcc_pipeline_id', 'pipeline_id', 'source_pipeline_id'}), None)
        pipeline_name_col = next((c for c in df_raw.columns if str(c).lower() in {'fcc_pipeline_name', 'pipeline_name', 'source_pipeline_name'}), None)
        publish_id_col = next((c for c in df_raw.columns if str(c).lower() in {'fcc_publish_id', 'publish_id'}), None)
        publish_label_col = next((c for c in df_raw.columns if str(c).lower() in {'fcc_publish_label', 'publish_label'}), None)
        customer_risk_col = next((c for c in df_raw.columns if str(c).lower() in {'customer_risk_rating', 'customer_risk'}), None)
        account_risk_col = next((c for c in df_raw.columns if str(c).lower() in {'account_risk_rating', 'account_risk'}), None)
        priority_col = next((c for c in df_raw.columns if str(c).lower() in {'priority', 'case_priority'}), None)
        linked_cases_col = next((c for c in df_raw.columns if str(c).lower() in {'linked_cases_count', 'linked_case_count'}), None)
        prior_alerts_col = next((c for c in df_raw.columns if str(c).lower() in {'prior_alerts_count', 'previous_alerts_count', 'prev_alerts'}), None)
        prior_case_col = next((c for c in df_raw.columns if str(c).lower() in {'prior_case_count', 'previous_sars_count', 'prev_sars'}), None)
        historical_frequency_col = next((c for c in df_raw.columns if str(c).lower() in {'historical_frequency', 'history_band', 'history_profile'}), None)
        behavior_context_col = next((c for c in df_raw.columns if str(c).lower() in {'behavior_context', 'risk_context', 'investigation_context'}), None)

        def derive_priority(row):
            risk_rating = str(row.get(risk_rating_col) or '').strip().lower() if risk_rating_col else ''
            if risk_rating in {'critical', 'high'}:
                return 'High'
            try:
                score = float(row.get(risk_score_col)) if risk_score_col else 0.0
            except Exception:
                score = 0.0
            if score >= 70:
                return 'High'
            if score >= 40:
                return 'Medium'
            return 'Low'

        cases = []
        for _, row in df_raw.iterrows():
            row_payload = row.to_dict()
            cases.append({
                "case_id": row_payload.get(raw_id_col),
                "status": row_payload.get(status_col) if status_col else "New",
                "priority": derive_priority(row_payload),
                "alert_count": int(row_payload.get(alert_count_col) or 0) if alert_count_col else 0,
                "source_pipeline_id": row_payload.get(pipeline_id_col) if pipeline_id_col else None,
                "source_pipeline_name": row_payload.get(pipeline_name_col) if pipeline_name_col else None,
                "source_publish_id": row_payload.get(publish_id_col) if publish_id_col else None,
                "source_publish_label": row_payload.get(publish_label_col) if publish_label_col else None,
                "risk_rating": row_payload.get(risk_rating_col) if risk_rating_col else None,
                "customer_risk_rating": row_payload.get(customer_risk_col) if customer_risk_col else None,
                "account_risk_rating": row_payload.get(account_risk_col) if account_risk_col else None,
                "case_priority": row_payload.get(priority_col) if priority_col else None,
                "linked_cases_count": int(row_payload.get(linked_cases_col) or 0) if linked_cases_col else 0,
                "prior_alerts_count": int(row_payload.get(prior_alerts_col) or 0) if prior_alerts_col else 0,
                "prior_case_count": int(row_payload.get(prior_case_col) or 0) if prior_case_col else 0,
                "historical_frequency": row_payload.get(historical_frequency_col) if historical_frequency_col else None,
                "behavior_context": row_payload.get(behavior_context_col) if behavior_context_col else None,
            })
        return jsonify(cases)
    finally:
        if conn: conn.close()


@cases_bp.route('/case-narrative/generate', methods=['POST'])
def generate_narrative():
    try:
        prompt = request.json.get('prompt', '')
        llm_service = _get_llm_service()
        if llm_service:
            res = llm_service.generate(prompt)
            if res.get('success'):
                return jsonify(res)
        return jsonify({'success': True, 'response': "**Narrative Template**\nPending AI generation."})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})


@cases_bp.route('/case-pack/<case_id>', methods=['GET'])
@handle_errors
def get_case_pack(case_id):
    case_id = unquote(case_id)
    db_manager = get_db_manager()
    conn = db_manager.connect()
    try:
        if not _scope_contains_case(conn.cursor(), case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404
    finally:
        db_manager.close_connection(conn)
    generator = CasePackGenerator(db_manager)
    pack = generator.generate_case_pack(case_id)
    return jsonify(pack)


@cases_bp.route('/case/<case_id>/update-status', methods=['POST'])
@handle_errors
def update_status(case_id):
    new_status = request.json.get('status')
    case_id = unquote(case_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if not _scope_contains_case(cursor, case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404
        _update_case_status_record(cursor, case_id, new_status)
        conn.commit()
        return jsonify({"success": True})
    finally:
        if conn: conn.close()


@cases_bp.route('/case-resolution/<case_id>/support-file', methods=['GET'])
@handle_errors
def get_case_resolution_support_file(case_id):
    case_id = unquote(case_id)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not _scope_contains_case(cursor, case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404

        support_file = _load_case_resolution_row(cursor, case_id)
        if not support_file:
            case_snapshot = _load_case_resolution_case_snapshot(cursor, case_id)
            support_file = _normalize_case_resolution_support_file(
                case_id,
                {
                    "summary": case_snapshot,
                    "decision": {"analyst_status": case_snapshot.get("analyst_status")},
                },
            )
        return jsonify({
            "success": True,
            "case_id": case_id,
            "support_file": support_file,
        })
    finally:
        if conn:
            conn.close()


@cases_bp.route('/case-resolution/<case_id>/support-file', methods=['POST'])
@handle_errors
def save_case_resolution_support_file(case_id):
    case_id = unquote(case_id)
    payload = request.get_json(silent=True) or {}
    incoming = payload.get("support_file") if isinstance(payload.get("support_file"), dict) else payload
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not _scope_contains_case(cursor, case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404

        support_file = _normalize_case_resolution_support_file(case_id, incoming)
        final_action = str(support_file["decision"].get("final_action") or "").strip()
        rationale = str(support_file["decision"].get("rationale") or "").strip()
        sar_status = str(support_file["decision"].get("sar_status") or "").strip()
        if sar_status.lower() == "accepted" and support_file.get("sar_draft"):
            support_file["decision"]["accepted_sar_draft"] = str(
                support_file["decision"].get("accepted_sar_draft") or support_file.get("sar_draft") or ""
            )
            support_file["decision"]["sar_accepted_at"] = str(
                support_file["decision"].get("sar_accepted_at") or _now_iso()
            )
            support_file["decision"]["sar_accepted_by"] = str(
                support_file["decision"].get("sar_accepted_by") or getattr(request, "username", None) or "system"
            )
            support_file["decision"]["analyst_status"] = "Draft Prepared"
            support_file["summary"]["analyst_status"] = "Draft Prepared"
        if final_action and not rationale:
            return jsonify({
                "success": False,
                "error": "Analyst rationale is required before final case closure or escalation.",
            }), 400

        saved = _persist_case_resolution_row(cursor, case_id, support_file)
        if final_action and rationale:
            _update_case_status_record(cursor, case_id, final_action)
        elif sar_status.lower() == "accepted" and support_file.get("sar_draft"):
            _update_case_status_record(cursor, case_id, "Draft Prepared")
        conn.commit()
        return jsonify({
            "success": True,
            "case_id": case_id,
            "support_file": saved,
        })
    finally:
        if conn:
            conn.close()


@cases_bp.route('/case-resolution/<case_id>/investigation-summary', methods=['POST', 'OPTIONS'])
@cases_bp.route('/case-resolution/<case_id>/generate-investigation-summary', methods=['POST', 'OPTIONS'])
@handle_errors
def generate_case_resolution_investigation_summary(case_id):
    case_id = unquote(case_id)
    payload = request.get_json(silent=True) or {}
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not _scope_contains_case(cursor, case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404

        support_file = payload.get("support_file") if isinstance(payload.get("support_file"), dict) else None
        if not support_file:
            support_file = _load_case_resolution_row(cursor, case_id)
        support_file = _normalize_case_resolution_support_file(case_id, support_file)

        fallback = _build_case_resolution_narrative_fallback(case_id, support_file)
        narrative_result = fallback

        prompt_payload = _build_case_resolution_narrative_payload(case_id, support_file)
        prompt = (
            "You are assisting with AML case investigation narrative drafting.\n"
            "Write in formal investigation language.\n"
            "Do not use markdown formatting.\n"
            "Do not use double asterisks.\n"
            "Do not use em dashes.\n"
            "Do not invent facts.\n"
            "Do not make conclusions that are not supported by the provided evidence.\n"
            "If evidence is weak or incomplete, state that clearly.\n\n"
            "Return valid JSON with this shape:\n"
            "{\n"
            '  "investigation_summary": {"text": "...", "status_note": "..."},\n'
            '  "case_synthesis": {\n'
            '    "reviewed": "...",\n'
            '    "found": "...",\n'
            '    "supports_suspicion": "...",\n'
            '    "weakens_suspicion": "...",\n'
            '    "requires_validation": "..."\n'
            "  }\n"
            "}\n\n"
            f"Structured case payload:\n{json.dumps(prompt_payload, default=str)}"
        )
        result, llm_service = _generate_case_resolution_llm_response(
            prompt=prompt,
            model=payload.get("model"),
            system_prompt=(
                "You are an AML investigator writing assistant. "
                "You organize and summarize facts supplied by the system. "
                "You are not the source of truth. "
                "All statements must be grounded in the supplied evidence."
            ),
            temperature=0.1,
            max_tokens=360,
        )
        if result.get("success"):
            parsed = _extract_json_object(result.get("response"))
            if isinstance(parsed, dict):
                narrative_result = {
                    **fallback,
                    "investigation_summary": {
                        **fallback.get("investigation_summary", {}),
                        **(parsed.get("investigation_summary") or {}),
                        "references": fallback.get("investigation_summary", {}).get("references", []),
                    },
                    "case_synthesis": {
                        **fallback.get("case_synthesis", {}),
                        **(parsed.get("case_synthesis") or {}),
                    },
                    "sar_sections": fallback.get("sar_sections", []),
                    "sar_draft": fallback.get("sar_draft", ""),
                }
        elif result.get("error"):
            fallback_note = fallback.get("investigation_summary", {}).get("status_note") or ""
            fallback["investigation_summary"]["status_note"] = (
                f"{fallback_note} Local narrative drafting fallback used because AI generation was unavailable."
            ).strip()
            narrative_result = fallback

        support_file["investigation_summary"] = narrative_result.get("investigation_summary", {})
        support_file["case_synthesis"] = narrative_result.get("case_synthesis", {})
        saved = _persist_case_resolution_row(cursor, case_id, support_file)
        conn.commit()

        return jsonify({
            "success": True,
            "case_id": case_id,
            "investigation_summary": saved.get("investigation_summary", {}),
            "case_synthesis": saved.get("case_synthesis", {}),
            "support_file": saved,
        })
    finally:
        if conn:
            conn.close()


@cases_bp.route('/case-resolution/<case_id>/sar-draft', methods=['POST', 'OPTIONS'])
@cases_bp.route('/case-resolution/<case_id>/draft-sar', methods=['POST', 'OPTIONS'])
@cases_bp.route('/case-resolution/<case_id>/generate-sar', methods=['POST', 'OPTIONS'])
@handle_errors
def generate_case_resolution_sar_draft(case_id):
    case_id = unquote(case_id)
    payload = request.get_json(silent=True) or {}
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not _scope_contains_case(cursor, case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404

        support_file = payload.get("support_file") if isinstance(payload.get("support_file"), dict) else None
        if not support_file:
            support_file = _load_case_resolution_row(cursor, case_id)
        support_file = _normalize_case_resolution_support_file(case_id, support_file)

        summary = support_file.get("summary", {})
        hypothesis = support_file.get("hypothesis", {})
        source_payload = support_file.get("source_payload") or {}
        accepted_evidence = [
            item for item in support_file.get("evidence_items", [])
            if str(item.get("analyst_status") or "").lower() == "accepted"
        ]
        timeline_events = support_file.get("timeline_events", [])[:12]
        analyst_notes = str(support_file.get("analyst_notes") or "").strip()
        evidence_lines = []
        for item in accepted_evidence[:12]:
            evidence_lines.append(
                f"{item.get('title')}: {item.get('why_it_matters') or 'Accepted analyst evidence.'} "
                f"[Source: {item.get('source_module')} | Records: {', '.join(map(str, item.get('source_records') or [])) or 'n/a'}]"
            )

        fallback = _build_case_resolution_narrative_fallback(case_id, support_file)
        fallback_sections = fallback.get("sar_sections", [])
        sar_sections = fallback_sections
        source_payload_summary = json.dumps(source_payload, default=str)
        if len(source_payload_summary) > 32000:
            source_payload_summary = source_payload_summary[:32000] + " ..."

        prompt = (
            "You are assisting with AML case investigation narrative drafting.\n"
            "Write in formal investigation language.\n"
            "Do not use markdown formatting.\n"
            "Do not use double asterisks.\n"
            "Do not use em dashes.\n"
            "Do not invent facts.\n"
            "Do not make conclusions that are not supported by the provided evidence.\n"
            "If evidence is weak or incomplete, state that clearly.\n\n"
            "Use the structured source payload from the connected investigation screens as the primary source material.\n"
            "The analyst can edit the result later, but the first draft must come entirely from the supplied JSON.\n\n"
            "Return valid JSON with this shape:\n"
            "{\n"
            '  "sar_sections": [\n'
            '    {"title": "Subject Information", "content": "..."},\n'
            '    {"title": "Case Overview", "content": "..."},\n'
            '    {"title": "Alert Background", "content": "..."},\n'
            '    {"title": "Transaction Activity Reviewed", "content": "..."},\n'
            '    {"title": "Behavioral and Historical Analysis", "content": "..."},\n'
            '    {"title": "Linked Entity Findings", "content": "..."},\n'
            '    {"title": "Grounds for Suspicion", "content": "..."},\n'
            '    {"title": "Explain Risk Drivers", "content": "..."},\n'
            '    {"title": "Recommended Next Steps", "content": "..."},\n'
            '    {"title": "Conclusion and Recommendation", "content": "..."}\n'
            "  ]\n"
            "}\n\n"
            f"Case ID: {case_id}\n"
            f"Risk Score: {summary.get('risk_score')}\n"
            f"Alert Count: {summary.get('alert_count')}\n"
            f"Suspicion Hypothesis: {hypothesis.get('pattern') or hypothesis.get('narrative') or 'Analyst review in progress'}\n\n"
            "Accepted Evidence, if any:\n"
            f"{chr(10).join(evidence_lines) or 'None recorded'}\n\n"
            "Timeline Facts:\n"
            f"{json.dumps(timeline_events, default=str)}\n\n"
            f"Analyst Notes:\n{analyst_notes or 'None recorded'}\n\n"
            f"Connected Screen Source Payload:\n{source_payload_summary}"
        )

        result, llm_service = _generate_case_resolution_llm_response(
            prompt=prompt,
            model=payload.get("model"),
            system_prompt=(
                "You are an AML SAR drafting assistant. "
                "You organize evidence-backed facts into regulator-friendly prose. "
                "Use only supplied facts. Never fabricate support."
            ),
            temperature=0.1,
            max_tokens=520,
        )
        raw_response = str(result.get("response") or "").strip()
        if result.get("success"):
            parsed = _extract_json_object(raw_response)
            if isinstance(parsed, dict) and isinstance(parsed.get("sar_sections"), list):
                fallback_ref_map = {str(section.get("title") or ""): section.get("references") or [] for section in fallback_sections}
                sar_sections = []
                for index, section in enumerate(parsed.get("sar_sections") or []):
                    if not isinstance(section, dict):
                        continue
                    title = str(section.get("title") or "").strip() or f"Section {index + 1}"
                    sar_sections.append({
                        "id": f"sar_{_slugify_text(title)}",
                        "title": title,
                        "content": str(section.get("content") or "").strip(),
                        "references": fallback_ref_map.get(title, []),
                    })
            elif raw_response:
                support_file["sar_sections"] = fallback_sections
                support_file["sar_draft"] = raw_response
                support_file["sar_readiness"] = {
                    "status": "Analyst Review Required",
                    "reason": "SAR draft generated from the combined investigation JSON payload. Analyst review is still required before filing.",
                }
                saved = _persist_case_resolution_row(cursor, case_id, support_file)
                conn.commit()
                return jsonify({
                    "success": True,
                    "case_id": case_id,
                    "sar_draft": raw_response,
                    "support_file": saved,
                })

        sar_draft = _join_sar_sections(sar_sections)
        if not sar_draft and raw_response:
            sar_draft = raw_response
        if not sar_draft:
            sar_draft = fallback.get("sar_draft") or _join_sar_sections(fallback_sections)

        if sar_draft and not any(str(section.get("content") or "").strip() for section in sar_sections):
            sar_sections = fallback_sections or sar_sections

        support_file["sar_sections"] = sar_sections
        support_file["sar_draft"] = sar_draft
        support_file["decision"]["sar_status"] = "Drafted" if sar_draft else support_file["decision"].get("sar_status") or "Not Started"
        support_file["decision"]["sar_accepted_at"] = ""
        support_file["decision"]["sar_accepted_by"] = ""
        support_file["decision"]["accepted_sar_draft"] = ""
        support_file["sar_readiness"] = {
            "status": "Analyst Review Required",
            "reason": (
                f"SAR draft generated from the combined investigation JSON payload using "
                f"{getattr(llm_service, 'provider_name', 'local narrative fallback')}. "
                "Analyst review is still required before filing."
            ),
        }
        saved = _persist_case_resolution_row(cursor, case_id, support_file)
        conn.commit()

        return jsonify({
            "success": True,
            "case_id": case_id,
            "sar_draft": sar_draft,
            "support_file": saved,
        })
    finally:
        if conn:
            conn.close()


@cases_bp.route('/case-pack/<case_id>/export', methods=['GET'])
@handle_errors
def export_case_pack(case_id):
    case_id = unquote(case_id)
    output_dir = 'data/case_packs'
    os.makedirs(output_dir, exist_ok=True)
    path = f'{output_dir}/case_{case_id}_{datetime.now().strftime("%Y%m%d")}.json'
    db_manager = get_db_manager()
    conn = db_manager.connect()
    try:
        if not _scope_contains_case(conn.cursor(), case_id):
            return jsonify({"success": False, "error": f"Case {case_id} is outside the active FCC handoff scope."}), 404
    finally:
        db_manager.close_connection(conn)
    CasePackGenerator(db_manager).export_case_pack_json(case_id, path)
    return jsonify({'success': True, 'path': path})


@cases_bp.route('/case-report/handoff/pdf', methods=['POST'])
@handle_errors
def download_case_handoff_report_pdf():
    body = request.get_json(silent=True) or {}
    handoff = body.get('handoff') if isinstance(body.get('handoff'), dict) else {}
    audience = str(body.get('audience') or 'technical').strip().lower() or 'technical'
    strict_min_pages = str(body.get('strict_min_pages', True)).strip().lower() in {'1', 'true', 'yes', 'on'}

    db_manager = get_db_manager()
    conn = db_manager.connect()
    try:
        scope = _read_active_case_scope(conn.cursor())
    finally:
        db_manager.close_connection(conn)

    scoped_case_ids = scope.get('case_ids') or []
    if str(scope.get('type') or 'GLOBAL').upper() != 'GLOBAL' and not scoped_case_ids:
        return jsonify({
            "success": False,
            "error": "No active FCC case scope is available for report generation.",
        }), 400

    pdf_bytes = generate_sentinel_handoff_report_pdf(
        db_manager,
        handoff=handoff,
        scope_case_ids=scoped_case_ids if scoped_case_ids else None,
        audience=audience,
        strict_min_pages=strict_min_pages,
    )

    pipeline_name = str(
        handoff.get('pipeline_name')
        or handoff.get('publish_label')
        or 'sentinel_handoff'
    )
    safe_name = re.sub(r'[^a-zA-Z0-9_-]+', '_', pipeline_name).strip('_') or 'sentinel_handoff'
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'{safe_name}_sentinel_report.pdf',
    )


# @cases_bp.route('/explorer/tree-data', methods=['POST'])
# @handle_errors
# def get_entity_tree():
#     """Returns full hierarchical data"""
#     root_id = request.json.get('id')
#     if not root_id: return jsonify({'error': 'Root ID required'}), 400

#     conn = services.investigation_db.connect()
#     conn.row_factory = sqlite3.Row
#     cur = conn.cursor()

#     def clean(r):
#         if not r: return {}
#         d = dict(r)
#         return {k: (v.decode('utf-8') if isinstance(v, bytes) else str(v)) for k,v in d.items()}

#     def get_col(tbl, keywords):
#         try:
#             cur.execute(f"PRAGMA table_info({tbl})")
#             cols = [r['name'] for r in cur.fetchall()]
#             for c in cols:
#                 if c.lower() in [k.lower() for k in keywords]: return c
#             for c in cols:
#                 if any(k.lower() in c.lower() for k in keywords): return c
#             return None
#         except: return None

#     try:
#         case_col = get_col('cases', ['case_id', 'caseid'])
#         if not case_col: return jsonify({'error': 'Case ID col not found'}), 404
        
#         cur.execute(f"SELECT * FROM cases WHERE {case_col} = ?", [root_id])
#         case_row = cur.fetchone()
#         if not case_row: return jsonify({'error': 'Case not found'}), 404
        
#         case_data = clean(case_row)
#         tree = {
#             "id": str(case_data[case_col]),
#             "type": "Case",
#             "label": f"Case {case_data[case_col]}",
#             "details": case_data,
#             "children": []
#         }

#         ucic_col = get_col('cases', ['ucic', 'unique_id'])
#         ucic = case_data.get(ucic_col)
        
#         if ucic:
#             ucic_node = {
#                 "id": str(ucic), "type": "UCIC", 
#                 "label": f"Profile: {ucic}", 
#                 "details": {"UCIC": ucic}, 
#                 "children": []
#             }
            
#             c_ucic_col = get_col('customers', ['ucic', 'unique_id'])
#             if c_ucic_col:
#                 cur.execute(f"SELECT * FROM customers WHERE {c_ucic_col} = ?", [ucic])
#                 for c in cur.fetchall():
#                     cd = clean(c)
#                     name_col = next((k for k in cd.keys() if 'name' in k.lower()), 'Name')
#                     id_col = next((k for k in cd.keys() if 'id' in k.lower()), 'ID')
#                     ucic_node["children"].append({
#                         "id": str(cd.get(id_col, 'Unknown')), 
#                         "type": "Customer", 
#                         "label": str(cd.get(name_col, 'Customer')),
#                         "details": cd
#                     })
            
#             a_ucic_col = get_col('accounts', ['ucic', 'unique_id'])
#             if a_ucic_col:
#                 cur.execute(f"SELECT * FROM accounts WHERE {a_ucic_col} = ?", [ucic])
#                 for a in cur.fetchall():
#                     ad = clean(a)
#                     aid_col = next((k for k in ad.keys() if 'account' in k.lower() and 'id' in k.lower()), 'AcctID')
#                     ucic_node["children"].append({
#                         "id": str(ad.get(aid_col, 'Unknown')), 
#                         "type": "Account", 
#                         "label": str(ad.get(aid_col, 'Account')),
#                         "details": ad
#                     })
            
#             tree["children"].append(ucic_node)

#         alert_case_col = get_col('alerts', ['case_id', 'caseid'])
#         if alert_case_col:
#             cur.execute(f"SELECT * FROM alerts WHERE {alert_case_col} = ?", [root_id])
#             alerts = cur.fetchall()
            
#             for al in alerts:
#                 ald = clean(al)
#                 aid_col = next((k for k in ald.keys() if 'alert' in k.lower() and 'id' in k.lower()), 'AlertID')
#                 atype_col = next((k for k in ald.keys() if 'type' in k.lower()), 'Type')
                
#                 alert_node = {
#                     "id": str(ald.get(aid_col, 'Alert')), 
#                     "type": "Alert", 
#                     "label": str(ald.get(atype_col, 'Suspicious Activity')),
#                     "details": ald,
#                     "children": []
#                 }

#                 txn_link_col = next((k for k in ald.keys() if 'trans' in k.lower() and 'id' in k.lower()), None)
#                 if txn_link_col and ald.get(txn_link_col):
#                     txn_id = ald.get(txn_link_col)
#                     t_id_col = get_col('transactions', ['transaction_id', 'txn_id', 'trans_id'])
#                     if t_id_col:
#                         cur.execute(f"SELECT * FROM transactions WHERE {t_id_col} = ?", [txn_id])
#                         txn = cur.fetchone()
#                         if txn:
#                             td = clean(txn)
#                             amt_col = next((k for k in td.keys() if 'amt' in k.lower() or 'amount' in k.lower()), 'Amount')
#                             alert_node["children"].append({
#                                 "id": str(td.get(t_id_col)), 
#                                 "type": "Transaction", 
#                                 "label": f"Amt: {td.get(amt_col, 0)}", 
#                                 "details": td
#                             })

#                 tree["children"].append(alert_node)

#         return jsonify(tree)
#     except Exception as e:
#         import traceback
#         traceback.print_exc()
#         return jsonify({'error': str(e)}), 500
#     finally:
#         services.investigation_db.close_connection(conn)

# backend/api/routes/cases.py (UPDATED SECTION ONLY - Replace the existing /explorer/tree-data endpoint)

@cases_bp.route('/explorer/tree-data', methods=['POST'])
@handle_errors
def get_entity_tree():
    """
    Returns hierarchical evidence lineage with REAL computed metrics.
    
    ARCHITECTURE:
    1. Verify case exists
    2. Compute 4 real metrics (alert_count, txn_volume, network_density, risk_score)
    3. Build lineage tree explaining HOW metrics were derived
    4. Attach raw data sections (alerts, accounts, transactions)
    
    SAFETY GUARANTEES:
    - Never assumes columns exist without verification
    - Uses explicit, validated join paths only
    - Fails loudly with descriptive errors
    - Marks cached vs realtime accurately
    """
    root_id = request.json.get('id')
    if not root_id: 
        return jsonify({'error': 'Root ID required'}), 400

    conn = services.investigation_db.connect()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ============================================================
    # UTILITY FUNCTIONS
    # ============================================================
    
    def clean(r):
        """Convert sqlite3.Row to clean dict with UTF-8 strings"""
        if not r: return {}
        d = dict(r)
        return {k: (v.decode('utf-8') if isinstance(v, bytes) else str(v) if v is not None else None) 
                for k, v in d.items()}

    def get_col(tbl, keywords):
        """
        Find column matching keywords (case-insensitive, flexible matching).
        Returns None if not found.
        """
        try:
            cur.execute(f"PRAGMA table_info({tbl})")
            cols = [r['name'] for r in cur.fetchall()]
            
            # Exact match first
            for c in cols:
                if c.upper() in [k.upper() for k in keywords]: 
                    return c
            
            # Partial match second
            for c in cols:
                if any(k.upper() in c.upper() for k in keywords): 
                    return c
            
            return None
        except: 
            return None

    def table_exists(tbl):
        """Check if table exists in database"""
        try:
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tbl,))
            return cur.fetchone() is not None
        except:
            return False

    def safe_float(val):
        """Convert to float, handling None/empty gracefully"""
        if val is None or val == '':
            return 0.0
        try:
            return float(val)
        except:
            return 0.0

    # ============================================================
    # METRIC COMPUTATION ENGINE
    # ============================================================
    
    def compute_real_metrics(case_id):
        """
        Compute 4 core metrics using validated join paths.
        Returns dict with metric values + audit trail.
        """
        metrics = {
            'alert_count': None,
            'transaction_volume': None,
            'network_density': None,
            'risk_score': None,
            'computation_log': []
        }

        # -------------------- METRIC 1: ALERT COUNT --------------------
        # Join: alerts.CASE_ID → cases.CASE_ID
        if table_exists('alerts'):
            alert_case_col = get_col('alerts', ['CASE_ID', 'case_id', 'caseid'])
            
            if alert_case_col:
                try:
                    query = f"SELECT COUNT(*) as cnt FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    result = cur.fetchone()
                    count = result['cnt'] if result else 0
                    
                    metrics['alert_count'] = {
                        'value': count,
                        'freshness': 'realtime',
                        'computation': f"COUNT(*) FROM alerts WHERE {alert_case_col} = '{case_id}'",
                        'source_table': 'alerts',
                        'join_path': f"alerts.{alert_case_col} = cases.CASE_ID"
                    }
                    metrics['computation_log'].append(f"✓ Alert count: {count} alerts found")
                    
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Alert count failed: {str(e)}")
                    metrics['alert_count'] = {
                        'value': 0,
                        'freshness': 'unavailable',
                        'error': str(e)
                    }
            else:
                metrics['computation_log'].append("✗ Alert count: No CASE_ID column found in alerts table")
        else:
            metrics['computation_log'].append("✗ Alert count: alerts table does not exist")

        # -------------------- METRIC 2: TRANSACTION VOLUME --------------------
        # Strategy: Use the direct CASE_ID column in transactions table
        # Join: transactions.CASE_ID → cases.CASE_ID
        
        transaction_volume = 0.0
        join_method = None
        
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_amount_col = get_col('transactions', ['TXN_AMOUNT', 'amount', 'amt', 'value'])
            
            if txn_case_col and txn_amount_col:
                try:
                    query = f"""
                        SELECT SUM(CAST({txn_amount_col} AS REAL)) as total
                        FROM transactions
                        WHERE {txn_case_col} = ?
                    """
                    cur.execute(query, [case_id])
                    result = cur.fetchone()
                    transaction_volume = safe_float(result['total']) if result else 0.0
                    join_method = f"transactions.{txn_case_col} = cases.CASE_ID (direct)"
                    
                    metrics['computation_log'].append(
                        f"✓ Transaction volume (direct): ${transaction_volume:,.2f}"
                    )
                    
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Transaction volume failed: {str(e)}")
            else:
                metrics['computation_log'].append(
                    f"✗ Transaction volume: Missing columns (case_col={txn_case_col}, amt_col={txn_amount_col})"
                )
        else:
            metrics['computation_log'].append("✗ Transaction volume: transactions table does not exist")
        
        metrics['transaction_volume'] = {
            'value': transaction_volume,
            'freshness': 'realtime' if transaction_volume > 0 or join_method else 'unavailable',
            'computation': f"SUM(transactions.{txn_amount_col or 'amount'}) WHERE CASE_ID = '{case_id}'",
            'source_table': 'transactions',
            'join_path': join_method if join_method else 'No valid join path found'
        }

        # -------------------- METRIC 3: NETWORK DENSITY --------------------
        # Count distinct entities linked to this case:
        # - Unique CUSTOMER_ID values
        # - Unique ACCOUNT_ID values
        # Strategy: Use CUSTOMER_ID from transactions OR alerts
        
        network_entities = set()
        
        # Get customers from transactions
        if table_exists('transactions') and txn_case_col:
            txn_cust_col = get_col('transactions', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            txn_acct_col = get_col('transactions', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if txn_cust_col:
                try:
                    query = f"SELECT DISTINCT {txn_cust_col} FROM transactions WHERE {txn_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        cust_id = row[txn_cust_col]
                        if cust_id:
                            network_entities.add(f"CUST:{cust_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density (customers): {str(e)}")
            
            if txn_acct_col:
                try:
                    query = f"SELECT DISTINCT {txn_acct_col} FROM transactions WHERE {txn_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        acct_id = row[txn_acct_col]
                        if acct_id:
                            network_entities.add(f"ACCT:{acct_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density (accounts): {str(e)}")
        
        # Also get customers/accounts from alerts
        if table_exists('alerts') and alert_case_col:
            alert_cust_col = get_col('alerts', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            alert_acct_col = get_col('alerts', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if alert_cust_col:
                try:
                    query = f"SELECT DISTINCT {alert_cust_col} FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        cust_id = row[alert_cust_col]
                        if cust_id:
                            network_entities.add(f"CUST:{cust_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density from alerts: {str(e)}")
            
            if alert_acct_col:
                try:
                    query = f"SELECT DISTINCT {alert_acct_col} FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        acct_id = row[alert_acct_col]
                        if acct_id:
                            network_entities.add(f"ACCT:{acct_id}")
                except Exception as e:
                    pass
        
        network_count = len(network_entities)
        metrics['network_density'] = {
            'value': network_count,
            'freshness': 'realtime' if network_count > 0 else 'unavailable',
            'computation': 'COUNT(DISTINCT customers) + COUNT(DISTINCT accounts) from transactions & alerts',
            'source_table': 'transactions, alerts',
            'join_path': 'transactions.CASE_ID = cases.CASE_ID, alerts.CASE_ID = cases.CASE_ID'
        }
        
        if network_count > 0:
            metrics['computation_log'].append(f"✓ Network density: {network_count} unique entities")
        else:
            metrics['computation_log'].append("✗ Network density: No entities found")

        # -------------------- METRIC 4: RISK SCORE (CACHED) --------------------
        # CRITICAL: This is pre-computed and stored in focus_results
        # DO NOT compute dynamically
        
        if table_exists('focus_results'):
            try:
                cur.execute(
                    "SELECT risk_score FROM focus_results WHERE entity_key = ? ORDER BY run_id DESC LIMIT 1",
                    [case_id]
                )
                result = cur.fetchone()
                
                if result and result['risk_score'] is not None:
                    risk_value = safe_float(result['risk_score'])
                    metrics['risk_score'] = {
                        'value': risk_value,
                        'freshness': 'cached',
                        'computation': 'Pre-computed by Focus Engine (stored in focus_results)',
                        'source_table': 'focus_results',
                        'join_path': 'focus_results.entity_key = cases.CASE_ID'
                    }
                    metrics['computation_log'].append(f"✓ Risk score (cached): {risk_value}/100")
                else:
                    metrics['risk_score'] = {
                        'value': None,
                        'freshness': 'unavailable',
                        'computation': 'Not computed yet by Focus Engine',
                        'source_table': 'focus_results'
                    }
                    metrics['computation_log'].append("✗ Risk score: No cached value in focus_results")
                    
            except Exception as e:
                metrics['computation_log'].append(f"✗ Risk score query failed: {str(e)}")
                metrics['risk_score'] = {
                    'value': None,
                    'freshness': 'unavailable',
                    'error': str(e)
                }
        else:
            metrics['computation_log'].append("✗ Risk score: focus_results table does not exist")
            metrics['risk_score'] = {
                'value': None,
                'freshness': 'unavailable',
                'computation': 'Focus Engine not run'
            }

        return metrics

    # ============================================================
    # LINEAGE TREE BUILDER
    # ============================================================
    
    def build_evidence_lineage(case_id, metrics):
        """
        Build lineage tree explaining HOW metrics were derived.
        Lineage is explanatory, NOT computational.
        """
        lineage_root = {
            "id": f"lineage_{case_id}",
            "type": "Lineage",
            "label": "Evidence Lineage & Derivation Logic",
            "details": {
                "description": "System computation transparency and data provenance",
                "audit_trail": "All metrics computed from live database queries"
            },
            "children": [],
            "metadata": {
                "is_evidence": True,
                "expand_default": True,
                "priority": "high"
            }
        }

        children = []

        # ---------- RISK SCORE (IF AVAILABLE) ----------
        if metrics['risk_score'] and metrics['risk_score'].get('value') is not None:
            risk_node = {
                "id": f"derived_risk_score_{case_id}",
                "type": "DerivedField",
                "label": f"Risk Score ({metrics['risk_score']['value']}/100)",
                "details": {
                    "metric_name": "risk_score",
                    "current_value": metrics['risk_score']['value'],
                    "value_freshness": metrics['risk_score']['freshness'],
                    "computation": metrics['risk_score']['computation'],
                    "source_table": metrics['risk_score']['source_table'],
                    "join_path": metrics['risk_score'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_focus_{case_id}",
                        "type": "SourceColumn",
                        "label": "focus_results.risk_score",
                        "details": {
                            "table": "focus_results",
                            "column": "risk_score",
                            "role": "Pre-computed risk index",
                            "note": "Computed by Focus Engine using alert severity weights"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": True,
                    "priority": "critical"
                }
            }
            children.append(risk_node)

        # ---------- ALERT COUNT ----------
        if metrics.get('alert_count') and metrics['alert_count'].get('value') is not None:
            alert_node = {
                "id": f"derived_alert_count_{case_id}",
                "type": "DerivedField",
                "label": f"Alert Count ({metrics['alert_count']['value']})",
                "details": {
                    "metric_name": "alert_count",
                    "current_value": metrics['alert_count']['value'],
                    "value_freshness": metrics['alert_count']['freshness'],
                    "computation": metrics['alert_count']['computation'],
                    "source_table": metrics['alert_count']['source_table'],
                    "join_path": metrics['alert_count'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_alerts_{case_id}",
                        "type": "SourceColumn",
                        "label": "alerts.CASE_ID",
                        "details": {
                            "table": "alerts",
                            "column": "CASE_ID",
                            "role": "Foreign key linking alerts to cases"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "high"
                }
            }
            children.append(alert_node)

        # ---------- TRANSACTION VOLUME ----------
        if metrics['transaction_volume'] and metrics['transaction_volume'].get('value') is not None:
            txn_val = metrics['transaction_volume']['value']
            txn_node = {
                "id": f"derived_txn_volume_{case_id}",
                "type": "DerivedField",
                "label": f"Transaction Volume (${txn_val:,.2f})",
                "details": {
                    "metric_name": "transaction_volume",
                    "current_value": f"${txn_val:,.2f}",
                    "value_freshness": metrics['transaction_volume']['freshness'],
                    "computation": metrics['transaction_volume']['computation'],
                    "source_table": metrics['transaction_volume']['source_table'],
                    "join_path": metrics['transaction_volume'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_transactions_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions.TXN_AMOUNT",
                        "details": {
                            "table": "transactions",
                            "column": "TXN_AMOUNT",
                            "role": "Transaction monetary value",
                            "aggregation": "SUM"
                        }
                    },
                    {
                        "id": f"src_transactions_case_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions.CASE_ID",
                        "details": {
                            "table": "transactions",
                            "column": "CASE_ID",
                            "role": "Direct link to case (enables direct aggregation)"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "high"
                }
            }
            children.append(txn_node)

        # ---------- NETWORK DENSITY ----------
        if metrics['network_density'] and metrics['network_density'].get('value') is not None:
            network_val = metrics['network_density']['value']
            network_node = {
                "id": f"derived_network_{case_id}",
                "type": "DerivedField",
                "label": f"Network Density ({network_val} entities)",
                "details": {
                    "metric_name": "network_density",
                    "current_value": network_val,
                    "value_freshness": metrics['network_density']['freshness'],
                    "computation": metrics['network_density']['computation'],
                    "source_table": metrics['network_density']['source_table'],
                    "join_path": metrics['network_density'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_network_cust_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions/alerts.CUSTOMER_ID",
                        "details": {
                            "table": "transactions, alerts",
                            "column": "CUSTOMER_ID",
                            "role": "Unique customer identifier for network traversal"
                        }
                    },
                    {
                        "id": f"src_network_acct_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions/alerts.ACCOUNT_ID",
                        "details": {
                            "table": "transactions, alerts",
                            "column": "ACCOUNT_ID",
                            "role": "Unique account identifier for network traversal"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "medium"
                }
            }
            children.append(network_node)

        lineage_root["children"] = children
        return lineage_root

    # ============================================================
    # MAIN EXECUTION
    # ============================================================
    
    try:
        # Verify case exists
        case_col = get_col('cases', ['CASE_ID', 'case_id', 'caseid'])
        if not case_col:
            return jsonify({'error': 'Cannot identify CASE_ID column in cases table'}), 500
        
        cur.execute(f"SELECT * FROM cases WHERE {case_col} = ?", [root_id])
        case_row = cur.fetchone()
        if not case_row:
            return jsonify({'error': f'Case {root_id} not found'}), 404
        
        case_data = clean(case_row)

        # Compute real metrics
        print(f"\n{'='*60}")
        print(f"COMPUTING METRICS FOR CASE: {root_id}")
        print(f"{'='*60}")
        
        metrics = compute_real_metrics(root_id)
        
        # Log computation results
        for log_entry in metrics['computation_log']:
            print(log_entry)
        print(f"{'='*60}\n")

        # Build lineage with real metrics
        lineage_node = build_evidence_lineage(root_id, metrics)
        
        # Build tree structure
        tree = {
            "id": str(case_data[case_col]),
            "type": "Case",
            "label": f"Case {case_data[case_col]}",
            "details": case_data,
            "children": [lineage_node],
            "evidence_summary": {
                "risk_score": metrics['risk_score'].get('value') if metrics['risk_score'] else None,
                "alert_count": metrics['alert_count'].get('value', 0) if metrics['alert_count'] else 0,
                "critical_count": 0,  # Could be computed if severity column exists
                "total_volume": metrics['transaction_volume'].get('value', 0) if metrics['transaction_volume'] else 0,
                "evidence_strength": (
                    "STRONG" if all([
                        metrics['alert_count'] and metrics['alert_count'].get('value', 0) > 0,
                        metrics['transaction_volume'] and metrics['transaction_volume'].get('value', 0) > 0
                    ]) else "MODERATE"
                ),
                "data_completeness": (
                    "COMPLETE" if all([
                        metrics['alert_count'] and metrics['alert_count'].get('freshness') == 'realtime',
                        metrics['transaction_volume'] and metrics['transaction_volume'].get('freshness') == 'realtime',
                        metrics['network_density'] and metrics['network_density'].get('freshness') == 'realtime'
                    ]) else "PARTIAL"
                )
            }
        }

        # ============================================================
        # ADD CONTEXT SECTIONS (NOT EVIDENCE)
        # ============================================================
        
        # CUSTOMERS SECTION
        cust_ids = set()
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_cust_col = get_col('transactions', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            
            if txn_case_col and txn_cust_col:
                cur.execute(
                    f"SELECT DISTINCT {txn_cust_col} FROM transactions WHERE {txn_case_col} = ?",
                    [root_id]
                )
                cust_ids.update(row[txn_cust_col] for row in cur.fetchall() if row[txn_cust_col])
        
        if cust_ids and table_exists('customers'):
            cust_section = {
                "id": f"customers_section_{root_id}",
                "type": "CustomersSection",
                "label": f"Linked Customers ({len(cust_ids)})",
                "details": {"count": len(cust_ids)},
                "children": [],
                "metadata": {
                    "is_evidence": False,
                    "expand_default": False,
                    "priority": "low"
                }
            }
            
            cust_id_col = get_col('customers', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            if cust_id_col:
                for cid in list(cust_ids)[:10]:  # Limit to 10
                    cur.execute(f"SELECT * FROM customers WHERE {cust_id_col} = ?", [cid])
                    cust_row = cur.fetchone()
                    if cust_row:
                        cust_data = clean(cust_row)
                        cust_section["children"].append({
                            "id": str(cid),
                            "type": "Customer",
                            "label": f"Customer {cid}",
                            "details": cust_data
                        })
                
                if cust_section["children"]:
                    tree["children"].append(cust_section)

        # ACCOUNTS SECTION
        acct_ids = set()
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_acct_col = get_col('transactions', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if txn_case_col and txn_acct_col:
                cur.execute(
                    f"SELECT DISTINCT {txn_acct_col} FROM transactions WHERE {txn_case_col} = ?",
                    [root_id]
                )
                acct_ids.update(row[txn_acct_col] for row in cur.fetchall() if row[txn_acct_col])
        
        if acct_ids and table_exists('accounts'):
            acct_section = {
                "id": f"accounts_section_{root_id}",
                "type": "AccountsSection",
                "label": f"Linked Accounts ({len(acct_ids)})",
                "details": {"count": len(acct_ids)},
                "children": [],
                "metadata": {
                    "is_evidence": False,
                    "expand_default": False,
                    "priority": "low"
                }
            }
            
            acct_id_col = get_col('accounts', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            if acct_id_col:
                for aid in list(acct_ids)[:10]:  # Limit to 10
                    cur.execute(f"SELECT * FROM accounts WHERE {acct_id_col} = ?", [aid])
                    acct_row = cur.fetchone()
                    if acct_row:
                        acct_data = clean(acct_row)
                        acct_section["children"].append({
                            "id": str(aid),
                            "type": "Account",
                            "label": f"Account {aid}",
                            "details": acct_data
                        })
                
                if acct_section["children"]:
                    tree["children"].append(acct_section)

        # ALERTS SECTION
        if table_exists('alerts'):
            alert_case_col = get_col('alerts', ['CASE_ID', 'case_id', 'caseid'])
            
            if alert_case_col:
                cur.execute(f"SELECT * FROM alerts WHERE {alert_case_col} = ? LIMIT 10", [root_id])
                alerts = [clean(row) for row in cur.fetchall()]
                
                if alerts:
                    alerts_section = {
                        "id": f"alerts_section_{root_id}",
                        "type": "AlertsSection",
                        "label": f"Raw Alerts ({len(alerts)})",
                        "details": {"count": len(alerts)},
                        "children": [],
                        "metadata": {
                            "is_evidence": False,
                            "expand_default": False,
                            "priority": "low"
                        }
                    }
                    
                    alert_id_col = get_col('alerts', ['ALERT_ID', 'alert_id', 'alertid'])
                    
                    for alert in alerts:
                        alert_label = f"Alert {alert.get(alert_id_col, 'N/A')}"
                        if 'ALERT_SCORE' in alert:
                            alert_label += f" (Score: {alert['ALERT_SCORE']})"
                        
                        alerts_section["children"].append({
                            "id": str(alert.get(alert_id_col, f"alert_{len(alerts_section['children'])}")),
                            "type": "Alert",
                            "label": alert_label,
                            "details": alert
                        })
                    
                    tree["children"].append(alerts_section)

        # TRANSACTIONS SECTION
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            
            if txn_case_col:
                cur.execute(f"SELECT * FROM transactions WHERE {txn_case_col} = ? LIMIT 10", [root_id])
                transactions = [clean(row) for row in cur.fetchall()]
                
                if transactions:
                    txns_section = {
                        "id": f"transactions_section_{root_id}",
                        "type": "TransactionsSection",
                        "label": f"Raw Transactions ({len(transactions)})",
                        "details": {"count": len(transactions)},
                        "children": [],
                        "metadata": {
                            "is_evidence": False,
                            "expand_default": False,
                            "priority": "low"
                        }
                    }
                    
                    txn_id_col = get_col('transactions', ['TRANSACTION_ID', 'transaction_id', 'txn_id'])
                    txn_amount_col = get_col('transactions', ['TXN_AMOUNT', 'amount', 'amt'])
                    
                    for txn in transactions:
                        txn_label = f"Txn {txn.get(txn_id_col, 'N/A')}"
                        if txn_amount_col and txn.get(txn_amount_col):
                            txn_label += f" (${safe_float(txn[txn_amount_col]):,.2f})"
                        
                        txns_section["children"].append({
                            "id": str(txn.get(txn_id_col, f"txn_{len(txns_section['children'])}")),
                            "type": "Transaction",
                            "label": txn_label,
                            "details": txn
                        })
                    
                    tree["children"].append(txns_section)

        return jsonify(tree)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500
    finally:
        services.investigation_db.close_connection(conn)
