import json
from typing import Any, Dict, List

from case_pack.case_pack_generator import CasePackGenerator


def _pick_first(record: Dict[str, Any], keys: List[str], default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


class CasePacketBuilder:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.generator = CasePackGenerator(db_manager)

    def build_case_packet(self, case_id: str) -> Dict[str, Any]:
        packet = self.generator.generate_case_pack(case_id)
        return packet if isinstance(packet, dict) else {}

    def _load_resolution_workspace(self, case_id: str) -> Dict[str, Any]:
        conn = self.db_manager.connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT support_file_json, sar_draft, updated_at
                FROM case_resolution_workspaces
                WHERE case_id = ?
                """,
                (case_id,),
            )
            row = cur.fetchone()
            if not row:
                return {}
            payload = {}
            try:
                payload = json.loads(row[0] or "{}")
            except Exception:
                payload = {}
            decision = payload.get("decision") if isinstance(payload.get("decision"), dict) else {}
            current_draft = str(row[1] or payload.get("sar_draft") or "").strip()
            accepted_draft = str(decision.get("accepted_sar_draft") or "").strip()
            return {
                "has_sar_draft": bool(current_draft),
                "sar_status": decision.get("sar_status") or ("Drafted" if current_draft else "Not Started"),
                "sar_updated_at": row[2],
                "sar_excerpt": (accepted_draft or current_draft)[:420],
                "accepted_sar_draft": accepted_draft,
                "sar_draft": current_draft,
                "sar_accepted_at": decision.get("sar_accepted_at"),
                "sar_accepted_by": decision.get("sar_accepted_by"),
            }
        except Exception:
            return {}
        finally:
            self.db_manager.close_connection(conn)

    def build_case_summary(self, case_id: str, queue_row: Dict[str, Any]) -> Dict[str, Any]:
        packet = self.build_case_packet(case_id)
        resolution_workspace = self._load_resolution_workspace(case_id)
        alerts = list(packet.get("alerts") or [])
        transactions = list(packet.get("transactions") or [])
        customers = list(packet.get("customers") or [])
        accounts = list(packet.get("accounts") or [])
        ledger = list(packet.get("ledger") or [])
        evidence = list(packet.get("evidence") or [])
        network_profile = packet.get("network_profile") or {}

        suspicious_amounts = []
        for txn in transactions:
            value = _pick_first(txn, ["amount", "txn_amount", "transaction_amount", "amt", "value"], 0)
            try:
                suspicious_amounts.append(float(value or 0))
            except Exception:
                pass

        top_counterparties = []
        for item in list(network_profile.get("top_counterparties") or [])[:5]:
            name = _pick_first(item, ["name", "counterparty", "party"], "-")
            count = _pick_first(item, ["count", "frequency", "txn_count"], 0)
            top_counterparties.append({"name": name, "count": count})

        why_generated = packet.get("narrative") or packet.get("summary") or "Case was generated from retained FCC alert activity and investigator review context."
        risk_indicators = []
        if queue_row.get("severity"):
            risk_indicators.append(str(queue_row["severity"]))
        if packet.get("risk_score"):
            risk_indicators.append(f"Score {packet.get('risk_score')}")
        if packet.get("typology_flags"):
            risk_indicators.append("Typology markers present")

        return {
            "packet": packet,
            "case_overview": {
                "case_id": case_id,
                "linked_alert_ids": [str(_pick_first(alert, ["alert_id", "ALERT_ID"], "")) for alert in alerts[:10] if _pick_first(alert, ["alert_id", "ALERT_ID"], "")],
                "customer_id": queue_row.get("customer_id"),
                "account_id": queue_row.get("account_id"),
                "branch": queue_row.get("branch_code"),
                "current_owner": queue_row.get("assigned_to"),
                "status": queue_row.get("current_status"),
                "stage": queue_row.get("current_stage"),
                "created_date": queue_row.get("created_at"),
                "last_updated": queue_row.get("last_updated_at"),
                "sla_due_date": queue_row.get("sla_due_at"),
            },
            "customer_account_snapshot": {
                "customer": customers[:3],
                "accounts": accounts[:3],
            },
            "alert_summary": {
                "alert_name": queue_row.get("scenario_name"),
                "why_generated": why_generated,
                "aggregate_risk_indicators": risk_indicators,
                "linked_alert_count": len(alerts),
                "recent_markers": packet.get("typology_flags") or [],
            },
            "transaction_highlights": {
                "suspicious_transaction_count": len(transactions),
                "date_range": {
                    "from": ledger[0].get("date") if ledger else None,
                    "to": ledger[-1].get("date") if ledger else None,
                },
                "total_suspicious_amount": round(sum(suspicious_amounts), 2),
                "top_counterparties": top_counterparties,
                "unusual_behavior_summary": packet.get("narrative") or "Activity review pending analyst validation.",
            },
            "evidence_summary": {
                "rule_triggers_summary": [str(_pick_first(alert, ["type", "alert_type", "rule_triggered", "RULE_TRIGGERED"], "-")) for alert in alerts[:5]],
                "model_score_summary": {"risk_score": packet.get("risk_score"), "severity": queue_row.get("severity")},
                "analyst_findings_summary": queue_row.get("current_stage"),
                "linked_documents": [{"label": "Case Pack", "case_id": case_id}] if packet else [],
                "evidence_items": evidence[:5],
            },
            "resolution_workspace": resolution_workspace,
            "mail_context": {
                "case_id": case_id,
                "customer_id": queue_row.get("customer_id") or _pick_first(customers[0], ["customer_id", "CUSTOMER_ID"], "-") if customers else "-",
                "account_id": queue_row.get("account_id") or _pick_first(accounts[0], ["account_id", "ACCOUNT_ID"], "-") if accounts else "-",
                "severity": queue_row.get("severity") or "Medium",
                "scenario_name": queue_row.get("scenario_name") or "Alert Review",
                "why_review_needed": why_generated,
                "transaction_summary": f"{len(transactions)} suspicious transactions totaling {round(sum(suspicious_amounts), 2):,.2f}",
                "risk_indicators": ", ".join(risk_indicators) or "Risk review pending",
                "recommended_next_action": "Review case in the platform and provide disposition or escalation response.",
                "sla_due_at": queue_row.get("sla_due_at") or "-",
                "case_link": f"/investigation?case_id={case_id}",
            },
        }
