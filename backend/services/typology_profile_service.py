from collections import Counter
from typing import Any, Dict, List

from case_pack.case_pack_generator import CasePackGenerator
from services.case_profile_builder import CaseProfileBuilder
from services.case_similarity_service import CaseSimilarityService
from services.network_report_adapter_service import NetworkReportAdapterService


HIGH_RISK_ALERT_KEYWORDS = ("HIGH_RISK", "CORRIDOR", "DEST", "STRUCT", "MULE", "LAYER", "RAPID", "FUNNEL")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


class TypologyProfileService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.profile_builder = CaseProfileBuilder(db_manager)
        self.case_pack_generator = CasePackGenerator(db_manager)
        self.similarity_service = CaseSimilarityService(db_manager)
        self.network_adapter = NetworkReportAdapterService()

    def _load_saved_network(self, case_id: str) -> Dict[str, Any]:
        conn = self.db_manager.connect()
        try:
            saved = self.network_adapter.load_case_result(conn.cursor(), case_id)
            return self.network_adapter.to_report_payload((saved or {}).get("payload") or {})
        finally:
            self.db_manager.close_connection(conn)

    def _analyze_transactions(self, transactions: List[Dict[str, Any]]) -> Dict[str, Any]:
        amounts = [_safe_float(item.get("amount") or item.get("txn_amount") or item.get("TXN_AMOUNT")) for item in transactions]
        amounts = [value for value in amounts if value > 0]
        below_threshold = [value for value in amounts if 8500 <= value <= 10000]
        rounded = [value for value in amounts if int(round(value)) % 100 == 0]
        counterparties = [str(item.get("counterparty") or item.get("beneficiary") or item.get("beneficiary_account") or "").strip() for item in transactions]
        counterparties = [value for value in counterparties if value]
        counterparty_counter = Counter(counterparties)
        dominant_counterparty_count = counterparty_counter.most_common(1)[0][1] if counterparty_counter else 0
        dominant_counterparty_ratio = (dominant_counterparty_count / len(counterparties)) if counterparties else 0.0

        inbound = 0
        outbound = 0
        for item in transactions:
            txn_type = str(item.get("type") or item.get("txn_type") or item.get("TXN_TYPE") or "").lower()
            if any(token in txn_type for token in ("credit", "deposit", "cash_deposit", "salary", "inbound")):
                inbound += 1
            elif txn_type:
                outbound += 1

        return {
            "transaction_count": len(transactions),
            "sub_threshold_count": len(below_threshold),
            "sub_threshold_ratio": (len(below_threshold) / len(amounts)) if amounts else 0.0,
            "round_amount_ratio": (len(rounded) / len(amounts)) if amounts else 0.0,
            "dominant_counterparty_ratio": dominant_counterparty_ratio,
            "dominant_counterparty_count": dominant_counterparty_count,
            "unique_counterparties": len(counterparty_counter),
            "inbound_count": inbound,
            "outbound_count": outbound,
            "rapid_movement_indicator": 1.0 if inbound and outbound and abs(inbound - outbound) <= max(2, (len(transactions) * 0.2)) else 0.0,
            "top_counterparties": [{"name": name, "count": count} for name, count in counterparty_counter.most_common(5)],
        }

    def _build_signal_categories(
        self,
        raw_features: Dict[str, Any],
        pack: Dict[str, Any],
        network_report: Dict[str, Any],
        similar_results: List[Dict[str, Any]],
        txn_metrics: Dict[str, Any],
    ) -> Dict[str, List[Dict[str, str]]]:
        alert_labels = list((pack.get("alerts") or [])[:5])
        similar_positive = [
            item for item in similar_results
            if "sar" in str(item.get("resolution_outcome") or "").lower() or "escalat" in str(item.get("resolution_outcome") or "").lower()
        ]
        return {
            "transaction_behavior": [
                {
                    "label": "Suspicious transaction count",
                    "value": str(int(raw_features.get("suspicious_txn_count") or 0)),
                    "detail": "High transaction count can indicate repeated suspicious movement or bursty case activity.",
                },
                {
                    "label": "Pass-through ratio",
                    "value": f"{raw_features.get('pass_through_ratio', 0):.2f}",
                    "detail": "Higher values indicate inbound and outbound activity is closely matched, which can support mule or pass-through review.",
                },
                {
                    "label": "Below-threshold transfer ratio",
                    "value": f"{txn_metrics.get('sub_threshold_ratio', 0):.2f}",
                    "detail": "Repeated values just under reporting thresholds can support structuring review.",
                },
            ],
            "alert_profile": [
                {
                    "label": "Alert count",
                    "value": str(int(raw_features.get("alert_count") or 0)),
                    "detail": "Alert volume and recurrence help frame whether the case reflects isolated or repeated suspicious activity.",
                },
                {
                    "label": "Dominant alert families",
                    "value": ", ".join(sorted(set(str(item.get("type") or item.get("rule") or item.get("RULE_TRIGGERED") or "-") for item in alert_labels if item))) or "None available",
                    "detail": "Alert families help connect the case to known suspicious behavior patterns.",
                },
            ],
            "customer_account_risk": [
                {
                    "label": "Customer risk rating",
                    "value": f"{raw_features.get('customer_risk_rating', 0):.0f}",
                    "detail": "Elevated customer risk can strengthen the seriousness of pattern-aligned activity.",
                },
                {
                    "label": "KYC completeness",
                    "value": f"{raw_features.get('kyc_completeness', 0):.1f}%",
                    "detail": "Poor or aging KYC can reduce confidence in the customer profile and strengthen escalation rationale.",
                },
            ],
            "network_graph_features": [
                {
                    "label": "Suspicious clusters",
                    "value": str(len(network_report.get("suspicious_clusters") or [])),
                    "detail": "Cluster evidence can strengthen funnel, layering, or coordinated network interpretations.",
                },
                {
                    "label": "Bridge entities",
                    "value": str(len(network_report.get("bridge_entities") or [])),
                    "detail": "Bridge nodes can indicate intermediary routing or layering behavior.",
                },
                {
                    "label": "Funnel patterns",
                    "value": str(len((network_report.get("funnel_patterns") or {}).get("collectors") or [])),
                    "detail": "Collector and distributor structures can support funnel-like interpretations.",
                },
            ],
            "similar_case_retrieval": [
                {
                    "label": "Similar cases reviewed",
                    "value": str(len(similar_results)),
                    "detail": "Historical matches show whether the current case resembles prior investigated patterns.",
                },
                {
                    "label": "Escalated or SAR precedents",
                    "value": str(len(similar_positive)),
                    "detail": "Prior escalated outcomes do not prove the current case, but they can strengthen pattern context.",
                },
            ],
            "rule_engine_outputs": [
                {
                    "label": "Rule or typology hints",
                    "value": ", ".join(sorted(set(str(item.get("type") or item.get("rule") or item.get("RULE_TRIGGERED") or "-") for item in (pack.get("alerts") or []) if any(token in str(item.get("type") or item.get("rule") or item.get("RULE_TRIGGERED") or "").upper() for token in HIGH_RISK_ALERT_KEYWORDS)))) or "No direct typology-labeled alerts",
                    "detail": "Rule families and alert descriptors can add context but should not be treated as final proof.",
                },
            ],
            "time_pattern_anomalies": [
                {
                    "label": "Off-hours ratio",
                    "value": f"{raw_features.get('off_hours_ratio', 0):.2f}",
                    "detail": "Off-hours activity can indicate unusual timing behavior for the customer or account profile.",
                },
                {
                    "label": "Weekend ratio",
                    "value": f"{raw_features.get('weekend_ratio', 0):.2f}",
                    "detail": "Weekend transaction concentration can support suspicious velocity or burst pattern review.",
                },
                {
                    "label": "Burstiness",
                    "value": f"{raw_features.get('burstiness', 0):.2f}",
                    "detail": "Bursty activity can point to condensed suspicious movement rather than routine customer behavior.",
                },
            ],
        }

    def build(self, case_id: str) -> Dict[str, Any]:
        profile = self.profile_builder.build_case_profile(case_id)
        pack = self.case_pack_generator.generate_case_pack(case_id) or {}
        transactions = list(pack.get("transactions") or pack.get("ledger") or [])
        alerts = list(pack.get("alerts") or [])
        network_report = self._load_saved_network(case_id)
        try:
            similar = self.similarity_service.retrieve_similar_cases(case_id, mode="typology", top_k=4, threshold=0.1)
        except Exception:
            similar = {"results": []}
        similar_results = similar.get("results") or []
        txn_metrics = self._analyze_transactions(transactions)
        raw_features = dict(profile.get("raw_features") or {})
        metadata = dict(profile.get("metadata") or {})

        graph_support = {
            "hub_count": len(network_report.get("hub_entities") or []),
            "bridge_count": len(network_report.get("bridge_entities") or []),
            "suspicious_cluster_count": len(network_report.get("suspicious_clusters") or []),
            "collector_count": len((network_report.get("funnel_patterns") or {}).get("collectors") or []),
            "distributor_count": len((network_report.get("funnel_patterns") or {}).get("distributors") or []),
            "cycle_count": len(network_report.get("circular_flow_findings") or []),
            "path_count": len(network_report.get("path_highlights") or []),
            "network_risk_score": _safe_float((network_report.get("network_risk_assessment") or {}).get("score")),
            "visibility_limitations": network_report.get("visibility_limitations") or "",
        }

        similar_support = {
            "match_count": len(similar_results),
            "sar_precedent_count": sum(1 for item in similar_results if "sar" in str(item.get("resolution_outcome") or "").lower()),
            "escalated_match_count": sum(1 for item in similar_results if "escalat" in str(item.get("resolution_outcome") or "").lower() or "pending" in str(item.get("resolution_outcome") or "").lower()),
            "top_matches": similar_results[:3],
        }

        data_limitations = [
            "Assessment is based on currently visible internal case, alert, transaction, and relationship data.",
        ]
        if graph_support["visibility_limitations"]:
            data_limitations.append(str(graph_support["visibility_limitations"]))
        else:
            data_limitations.append("Cross-bank downstream visibility may be partial, so network confidence can be constrained.")
        if txn_metrics["transaction_count"] < 4:
            data_limitations.append("Transaction volume is limited for this case, which reduces pattern confidence.")
        if graph_support["hub_count"] + graph_support["bridge_count"] + graph_support["suspicious_cluster_count"] == 0:
            data_limitations.append("Network evidence is sparse for this case, so typology support is driven primarily by transaction and alert signals.")
        if similar_support["match_count"] == 0:
            data_limitations.append("No strong historical comparison set was available from similar-case retrieval.")

        return {
            "case_id": case_id,
            "profile": profile,
            "pack_preview": {
                "alert_count": len(alerts),
                "transaction_count": len(transactions),
                "typology_flags": pack.get("typology_flags") or {},
                "alerts": alerts[:8],
                "transactions": transactions[:12],
            },
            "raw_features": raw_features,
            "metadata": metadata,
            "transaction_metrics": txn_metrics,
            "graph_support": graph_support,
            "similar_case_support": similar_support,
            "signal_categories": self._build_signal_categories(raw_features, pack, network_report, similar_results, txn_metrics),
            "data_limitations": data_limitations,
        }
