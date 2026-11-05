"""
Real investigation tools used by the agentic workflow.

These tools read the active investigation database through existing backend
services. They do not sleep, fabricate findings, or return placeholder text.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from api.service_locator import services
from case_pack.case_pack_generator import CasePackGenerator
from services.case_data_aggregator import CaseDataAggregator


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _compact(value: Any, max_items: int = 25) -> Any:
    value = _jsonable(value)
    if isinstance(value, list):
        return value[:max_items]
    if isinstance(value, dict):
        return {k: _compact(v, max_items=max_items) for k, v in value.items()}
    return value


def _db_manager(context: dict | None = None):
    context = context or {}
    env_id = context.get("env_id") or getattr(getattr(services, "metadata_manager", None), "active_env", None)
    tenant_id = context.get("tenant_id")
    if not env_id:
        raise RuntimeError("No active environment is available for the agentic investigation.")
    return services.get_investigation_db(env_id, tenant_id)


def get_case_context(case_id: str, context: dict | None = None) -> dict:
    db_manager = _db_manager(context)
    aggregated = CaseDataAggregator(db_manager).aggregate_case(case_id, analyst_name="Agentic Investigator")
    try:
        case_pack = CasePackGenerator(db_manager).generate_case_pack(case_id) or {}
    except Exception as exc:
        case_pack = {"error": str(exc)}
    return {
        "case_report_context": _compact(aggregated, max_items=18),
        "case_pack": _compact(case_pack, max_items=18),
        "environment": {"env_id": (context or {}).get("env_id")},
    }


def _fetch_case_retrieval(case_id: str, context: dict | None = None) -> dict:
    payload = get_case_context(case_id, context)
    report = payload.get("case_report_context") or {}
    return {
        "case_id": case_id,
        "cover": report.get("cover"),
        "case_overview": report.get("case_overview"),
        "evidence_summary": report.get("evidence_summary"),
        "lineage_origin": (report.get("lineage") or {}).get("origin_chain"),
        "source": "CaseDataAggregator.aggregate_case + CasePackGenerator.generate_case_pack",
    }


def _fetch_customer_profile(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    support = report.get("support_file") or {}
    case_pack = get_case_context(case_id, context).get("case_pack") or {}
    return {
        "customer": {
            "customer_id": (report.get("cover") or {}).get("customer_id"),
            "account_id": (report.get("cover") or {}).get("account_id"),
            "risk_level": (report.get("cover") or {}).get("risk_level"),
            "metadata": ((report.get("case_overview") or {}).get("metadata") or {}),
        },
        "kyc_and_profile": case_pack.get("customer_profile") or case_pack.get("customer") or {},
        "supporting_workspace": {
            "summary": support.get("summary"),
            "hypothesis": support.get("hypothesis"),
            "mitigating_factors": support.get("mitigating_factors"),
        },
    }


def _fetch_transaction_history(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    ledger = report.get("transaction_ledger") or {}
    rows = ledger.get("rows") or []
    amounts = [float(row.get("amount") or 0) for row in rows if isinstance(row, dict)]
    counterparties = Counter(str(row.get("counterparty") or "-") for row in rows if isinstance(row, dict))
    channels = Counter(str(row.get("channel") or "-") for row in rows if isinstance(row, dict))
    return {
        "transaction_count": ledger.get("count") or len(rows),
        "total_amount": ledger.get("total_amount"),
        "peak_activity": ledger.get("peak_activity") or (max(amounts) if amounts else 0),
        "patterns": ledger.get("patterns") or [],
        "top_counterparties": ledger.get("top_counterparties") or [{"name": k, "count": v} for k, v in counterparties.most_common(10)],
        "channel_mix": [{"channel": k, "count": v} for k, v in channels.most_common(10)],
        "sample_transactions": rows[:30],
    }


def _fetch_rule_engine(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    return {
        "alerts": ((report.get("case_overview") or {}).get("alerts") or [])[:30],
        "rules": (report.get("rule_typology") or {}).get("rules") or [],
        "rule_typology_summary": (report.get("rule_typology") or {}).get("summary") or {},
        "copilot_insights": report.get("copilot_insights") or {},
    }


def _fetch_network_intelligence(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    graph = report.get("graph_summary") or {}
    lineage = report.get("lineage") or {}
    return {
        "graph_summary": graph,
        "lineage": lineage,
        "network_entities": {
            "entity_count": graph.get("entities"),
            "cluster_count": graph.get("clusters"),
            "central_nodes": graph.get("central_nodes") or [],
            "hub_entities": graph.get("hub_entities") or [],
            "bridge_entities": graph.get("bridge_entities") or [],
            "path_highlights": graph.get("path_highlights") or [],
        },
    }


def _fetch_typology_intelligence(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    rules = report.get("rule_typology") or {}
    return {
        "primary_typology": rules.get("primary_typology"),
        "supporting_typologies": rules.get("typologies") or [],
        "rules": rules.get("rules") or [],
        "typology_summary": rules.get("summary") or {},
        "similar_cases": report.get("similar_cases") or {},
    }


def _fetch_previous_investigations(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    support = report.get("support_file") or {}
    return {
        "similar_cases": report.get("similar_cases") or {},
        "prior_resolution": report.get("resolution") or {},
        "existing_case_notes": {
            "analyst_notes": support.get("analyst_notes"),
            "claims": support.get("claims") or [],
            "timeline_events": support.get("timeline_events") or [],
            "evidence_items": support.get("evidence_items") or [],
        },
    }


def _fetch_timeline(case_id: str, context: dict | None = None) -> dict:
    report = get_case_context(case_id, context).get("case_report_context") or {}
    events = []
    overview = report.get("case_overview") or {}
    timeline = overview.get("timeline") or {}
    for key, label in (("created_at", "Case opened"), ("updated_at", "Case updated"), ("resolved_at", "Case resolved")):
        if timeline.get(key) and timeline.get(key) != "-":
            events.append({"timestamp": timeline.get(key), "event": label, "source": "case_overview"})
    for row in ((report.get("case_overview") or {}).get("alerts") or [])[:20]:
        events.append({"timestamp": row.get("date"), "event": f"Alert {row.get('alert_id')}", "detail": row.get("rule"), "source": "alerts"})
    for row in ((report.get("transaction_ledger") or {}).get("rows") or [])[:40]:
        events.append({"timestamp": row.get("date"), "event": f"Transaction {row.get('reference')}", "detail": row, "source": "transactions"})
    grouped = defaultdict(int)
    for item in events:
        grouped[str(item.get("source") or "unknown")] += 1
    return {"events": events, "event_counts_by_source": dict(grouped)}


TOOL_REGISTRY = {
    "case_retrieval": {
        "description": "Retrieve case facts, alerts, evidence summary, source metadata, and lineage origin.",
        "fn": lambda case_id, memory, context: _fetch_case_retrieval(case_id, context),
    },
    "customer_profile": {
        "description": "Retrieve customer/account profile, KYC attributes, risk level, and workspace hypotheses.",
        "fn": lambda case_id, memory, context: _fetch_customer_profile(case_id, context),
    },
    "transaction_history": {
        "description": "Analyze transaction history, values, counterparties, channels, velocity, and sampled records.",
        "fn": lambda case_id, memory, context: _fetch_transaction_history(case_id, context),
    },
    "rule_engine": {
        "description": "Retrieve triggered rules, alerts, rule typology summary, and deterministic risk signals.",
        "fn": lambda case_id, memory, context: _fetch_rule_engine(case_id, context),
    },
    "network_intelligence": {
        "description": "Analyze linked entities, lineage, graph clusters, hubs, bridges, and path highlights.",
        "fn": lambda case_id, memory, context: _fetch_network_intelligence(case_id, context),
    },
    "typology_intelligence": {
        "description": "Compare evidence to AML typologies and similar historical cases.",
        "fn": lambda case_id, memory, context: _fetch_typology_intelligence(case_id, context),
    },
    "previous_investigations": {
        "description": "Retrieve previous investigation notes, similar cases, prior outcomes, claims, and evidence items.",
        "fn": lambda case_id, memory, context: _fetch_previous_investigations(case_id, context),
    },
    "investigation_timeline": {
        "description": "Build a chronological timeline from case, alert, and transaction evidence.",
        "fn": lambda case_id, memory, context: _fetch_timeline(case_id, context),
    },
}


def run_tool(tool_name: str, case_id: str, memory_text: str, context: dict | None = None) -> dict:
    entry = TOOL_REGISTRY.get(tool_name)
    if not entry:
        return {"ok": False, "raw": None, "error": f"Unknown tool: {tool_name}"}
    started = datetime.utcnow()
    try:
        result = entry["fn"](case_id, memory_text, context or {})
        return {
            "ok": True,
            "raw": _jsonable(result),
            "error": None,
            "input_params": {"case_id": case_id, "tool_name": tool_name, "env_id": (context or {}).get("env_id")},
            "execution_time_ms": int((datetime.utcnow() - started).total_seconds() * 1000),
        }
    except Exception as exc:
        return {
            "ok": False,
            "raw": None,
            "error": f"Tool execution failed: {exc}",
            "input_params": {"case_id": case_id, "tool_name": tool_name, "env_id": (context or {}).get("env_id")},
            "execution_time_ms": int((datetime.utcnow() - started).total_seconds() * 1000),
        }


def raw_to_json_text(raw: Any) -> str:
    return json.dumps(_jsonable(raw), indent=2, default=str)
