# backend/case_pack/case_summary_builder.py
import json
from datetime import datetime
from case_pack.case_pack_generator import CasePackGenerator

class CaseSummaryBuilder:
    """
    Deterministic case summary builder.
    NO LLM usage. NO free-text generation.
    Pulls grounded, multi-table linked data via CasePackGenerator.
    """
    
    def __init__(self, db_manager):
        self.db_manager = db_manager
    
    def build_case_summary(self, case_id):
        """
        Build structured case summary using ground-truth CasePackGenerator.
        Returns JSON-serializable dict with real metrics, alerts, and counterparties.
        """
        try:
            generator = CasePackGenerator(self.db_manager)
            case_pack = generator.generate_case_pack(case_id)
            
            if not case_pack:
                return {"error": f"Case {case_id} not found", "case_id": case_id}

            alerts = case_pack.get("alerts", [])
            ledger = case_pack.get("ledger", [])
            financial_profile = case_pack.get("financial_profile", {})
            network_profile = case_pack.get("network_profile", {})
            customers = case_pack.get("customers", [])
            typology_flags = case_pack.get("typology_flags", [])
            risk_score = case_pack.get("risk_score", 0)

            total_volume = float(financial_profile.get("total_volume", 0) or 0)
            max_txn = float(financial_profile.get("max_transaction", 0) or 0)
            avg_txn = float(financial_profile.get("avg_transaction", 0) or 0)
            flow_ratio = financial_profile.get("flow_ratio", {})
            credit_vol = float(flow_ratio.get("credit", 0) or 0)
            debit_vol = float(flow_ratio.get("debit", 0) or 0)

            critical_alerts = sum(1 for a in alerts if str(a.get("severity", "")).lower() in ["critical", "high"])
            
            # Determine alert type from primary alert
            primary_alert_type = "Suspicious Transaction Activity"
            if alerts:
                primary_alert_type = alerts[0].get("alert_type") or alerts[0].get("scenario") or "Triggered Alert"

            # Dynamic trigger reasons based on real metrics
            reasons = []
            if alerts:
                for a in alerts[:3]:
                    reasons.append(f"Alert [{a.get('alert_id', 'ALT')}]: {a.get('alert_type', 'Activity')} (Severity: {a.get('severity', 'Medium')})")
            if len(ledger) > 0:
                reasons.append(f"Transaction volume: {len(ledger)} recorded transactions totaling {total_volume:,.2f}")
            if max_txn > 10000:
                reasons.append(f"Peak single transaction exposure of {max_txn:,.2f}")
            if typology_flags:
                for t in typology_flags:
                    reasons.append(f"Typology signal flagged: {t}")

            if not reasons:
                reasons = ["Flagged for routine regulatory review"]

            primary_customer = customers[0] if customers else {}

            summary = {
                "case_id": case_id,
                "summary_generated_at": datetime.now().isoformat(),
                "risk_score": risk_score,
                "alert_type": primary_alert_type,
                "why_triggered": reasons,
                "customer_profile": {
                    "customer_id": primary_customer.get("customer_id", "N/A"),
                    "customer_name": primary_customer.get("customer_name", "N/A"),
                    "segment": primary_customer.get("segment", "Commercial"),
                    "country": primary_customer.get("country", "US"),
                    "risk_rating": primary_customer.get("risk_rating", "Medium"),
                    "kyc_completeness_pct": primary_customer.get("kyc_completeness_pct", 100)
                },
                "key_metrics": {
                    "alert_count": len(alerts),
                    "critical_alerts": critical_alerts,
                    "transaction_count": len(ledger),
                    "total_volume": round(total_volume, 2),
                    "max_transaction": round(max_txn, 2),
                    "baseline_avg": round(avg_txn, 2),
                    "inflow_credits": round(credit_vol, 2),
                    "outflow_debits": round(debit_vol, 2)
                },
                "financial_profile": financial_profile,
                "top_counterparties": network_profile.get("top_counterparties", []) if isinstance(network_profile, dict) else [],
                "typology_signals": typology_flags,
                "system_recommendation": "FILE_SAR" if (critical_alerts > 0 or risk_score > 75) else "REVIEW_REQUIRED",
                "evidence_references": {
                    "tables_used": ["cases", "alerts", "transactions", "customers"],
                    "alert_ids": [a.get("alert_id") for a in alerts if a.get("alert_id")],
                    "sample_transactions": [
                        {"date": l.get("date"), "amount": l.get("amount"), "type": l.get("type"), "ref": l.get("reference")}
                        for l in ledger[:10]
                    ]
                }
            }

            return summary

        except Exception as e:
            return {"error": str(e), "case_id": case_id}