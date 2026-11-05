"""Configurable investigation agents for the Agentic Workflow canvas."""

from __future__ import annotations

import uuid
from typing import Any

from api.agent_db import get_agent_definitions, save_agent_definition
from api.routes.agent_tools import TOOL_REGISTRY

DEFAULT_AGENT_CONFIG = {
    "model": "inherit",
    "evidence_depth": "standard",
    "max_evidence": 8,
}


BUILTIN_AGENTS = [
    {"id": "case-retrieval", "name": "Case Retrieval", "agent_type": "retrieval", "tool_name": "case_retrieval", "description": "Collect case facts, source lineage, and existing evidence.", "color": "#2563eb", "icon": "search"},
    {"id": "transaction-history", "name": "Transaction History", "agent_type": "transaction", "tool_name": "transaction_history", "description": "Analyse transaction value, velocity, counterparties, and channels.", "color": "#e8590c", "icon": "payments"},
    {"id": "customer-profile", "name": "Customer Profile", "agent_type": "customer", "tool_name": "customer_profile", "description": "Review KYC, customer risk, accounts, and supporting context.", "color": "#7c3aed", "icon": "person"},
    {"id": "network-intelligence", "name": "Network Intelligence", "agent_type": "network", "tool_name": "network_intelligence", "description": "Explore linked entities, hubs, bridges, and transaction paths.", "color": "#0891b2", "icon": "hub"},
    {"id": "typology-analysis", "name": "Typology Analysis", "agent_type": "typology", "tool_name": "typology_intelligence", "description": "Match evidence to AML typologies and similar historic cases.", "color": "#b45309", "icon": "psychology"},
    {"id": "alert-review", "name": "Alert & Rule Review", "agent_type": "rules", "tool_name": "rule_engine", "description": "Interpret triggered rules, alerts, and deterministic signals.", "color": "#dc2626", "icon": "warning"},
    {"id": "prior-case-review", "name": "Prior Case Review", "agent_type": "history", "tool_name": "previous_investigations", "description": "Compare previous cases, outcomes, and analyst notes.", "color": "#475569", "icon": "history"},
    {"id": "timeline-builder", "name": "Timeline Builder", "agent_type": "timeline", "tool_name": "investigation_timeline", "description": "Build an evidence-backed chronological timeline.", "color": "#16a34a", "icon": "timeline"},
]


def _safe_agent(agent: dict[str, Any], custom: bool = False) -> dict[str, Any]:
    raw_config = agent.get("config") if isinstance(agent.get("config"), dict) else {}
    config = {**DEFAULT_AGENT_CONFIG, **raw_config}
    if config["evidence_depth"] not in {"fast", "standard", "deep"}:
        config["evidence_depth"] = "standard"
    try:
        config["max_evidence"] = max(1, min(25, int(config["max_evidence"])))
    except (TypeError, ValueError):
        config["max_evidence"] = DEFAULT_AGENT_CONFIG["max_evidence"]
    config["model"] = str(config.get("model") or "inherit")[:160]
    return {
        "id": str(agent.get("id") or uuid.uuid4()),
        "name": str(agent.get("name") or "Investigation Agent"),
        "agent_type": str(agent.get("agent_type") or "custom"),
        "tool_name": str(agent.get("tool_name") or ""),
        "instructions": str(agent.get("instructions") or ""),
        "description": str(agent.get("description") or ""),
        "color": str(agent.get("color") or "#475569"),
        "icon": str(agent.get("icon") or "smart_toy"),
        "config": config,
        "custom": custom,
    }


def list_agents() -> list[dict[str, Any]]:
    custom = [_safe_agent(agent, custom=True) for agent in get_agent_definitions()]
    return [_safe_agent(agent) for agent in BUILTIN_AGENTS] + custom


def create_agent(payload: dict[str, Any]) -> dict[str, Any]:
    tool_name = str(payload.get("tool_name") or "").strip()
    if tool_name not in TOOL_REGISTRY:
        raise ValueError("Select a valid investigation data source for this agent.")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Agent name is required.")
    agent = _safe_agent({**payload, "id": payload.get("id") or f"custom-{uuid.uuid4()}", "name": name}, custom=True)
    save_agent_definition(agent)
    return agent


def resolve_workflow_nodes(nodes: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Validate canvas nodes and return executable, tool-backed agents in canvas order."""
    if not nodes:
        return []
    catalog = {agent["id"]: agent for agent in list_agents()}
    resolved = []
    seen = set()
    for raw in nodes:
        if not isinstance(raw, dict) or raw.get("enabled", True) is False:
            continue
        source = catalog.get(str(raw.get("agent_id") or raw.get("id") or ""), raw)
        source_config = source.get("config") if isinstance(source.get("config"), dict) else {}
        raw_config = raw.get("config") if isinstance(raw.get("config"), dict) else {}
        agent = _safe_agent(
            {
                **source,
                **{k: v for k, v in raw.items() if k in {"id", "name", "tool_name", "instructions"}},
                "config": {**source_config, **raw_config},
            },
            custom=bool(source.get("custom")),
        )
        if raw.get("instance_name"):
            agent["name"] = str(raw["instance_name"])[:120]
        node_id = str(raw.get("node_id") or raw.get("id") or agent["id"])
        if node_id in seen or agent["tool_name"] not in TOOL_REGISTRY:
            continue
        seen.add(node_id)
        agent["node_id"] = node_id
        agent["position"] = raw.get("position") or {"x": 0, "y": 0}
        resolved.append(agent)
    return resolved
