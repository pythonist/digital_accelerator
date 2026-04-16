from typing import Any, Dict, List


class TypologyRulesEngine:
    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        try:
            if value in (None, ""):
                return default
            return float(value)
        except Exception:
            return default

    def _fmt_decimal(self, value: Any, digits: int = 2, default: float = 0.0) -> str:
        return f"{self._safe_float(value, default):.{digits}f}"

    def _signal(self, signal: str, observed_value: Any, why_it_matters: str, category: str, typology_id: str, weight: float) -> Dict[str, Any]:
        return {
            "signal": signal,
            "observed_value": observed_value,
            "why_it_matters": why_it_matters,
            "category": category,
            "affected_typology": typology_id,
            "weight": weight,
        }

    def _evidence_total(self, evidence: List[Dict[str, Any]]) -> float:
        return min(1.0, sum(float(item.get("weight") or 0.0) for item in evidence))

    def evaluate(self, profile_payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        raw = profile_payload.get("raw_features") or {}
        txn = profile_payload.get("transaction_metrics") or {}
        graph = profile_payload.get("graph_support") or {}
        similar = profile_payload.get("similar_case_support") or {}
        metadata = profile_payload.get("metadata") or {}
        limitations = profile_payload.get("data_limitations") or []
        results: Dict[str, Dict[str, Any]] = {}

        def finalize(typology_id: str, label: str, evidence: List[Dict[str, Any]], weak_reason: str, next_checks: List[str], influence: str):
            results[typology_id] = {
                "typology_id": typology_id,
                "typology_name": label,
                "score": round(self._evidence_total(evidence), 4),
                "evidence": evidence,
                "weak_reason": weak_reason,
                "next_checks": next_checks,
                "influence": influence,
                "limitations": limitations,
            }

        mule = []
        if raw.get("pass_through_ratio", 0) >= 0.72:
            mule.append(self._signal("Pass-through ratio", self._fmt_decimal(raw.get("pass_through_ratio")), "Rapid release of incoming funds can indicate an account is being used to move third-party funds rather than retain them.", "transaction_behavior", "mule_account_behavior", 0.34))
        if txn.get("rapid_movement_indicator", 0) >= 1:
            mule.append(self._signal("Balanced inbound and outbound movement", "Present", "Closely matched inflow and outflow counts can support mule-style routing behavior.", "transaction_behavior", "mule_account_behavior", 0.14))
        if raw.get("off_hours_ratio", 0) >= 0.25 or raw.get("weekend_ratio", 0) >= 0.25:
            mule.append(self._signal("Unusual transaction timing", f"Off-hours {self._fmt_decimal(raw.get('off_hours_ratio'))} | Weekend {self._fmt_decimal(raw.get('weekend_ratio'))}", "Unusual timing can strengthen concern that the account is being operated for suspicious movement rather than routine customer use.", "time_pattern_anomalies", "mule_account_behavior", 0.08))
        if graph.get("collector_count", 0) or graph.get("distributor_count", 0):
            mule.append(self._signal("Collector / distributor network support", f"Collectors {graph.get('collector_count', 0)} | Distributors {graph.get('distributor_count', 0)}", "Network support strengthens the interpretation that the account may be moving third-party funds through a wider visible structure.", "network_graph_features", "mule_account_behavior", 0.14))
        if similar.get("sar_precedent_count", 0) or similar.get("escalated_match_count", 0):
            mule.append(self._signal("Historical precedent", f"SAR {similar.get('sar_precedent_count', 0)} | Escalated {similar.get('escalated_match_count', 0)}", "Historically escalated matches do not prove the case, but they strengthen the context for mule-like behavior.", "similar_case_retrieval", "mule_account_behavior", 0.1))
        if raw.get("customer_risk_rating", 0) >= 60 or raw.get("pep_flag", 0) or raw.get("sanctions_flag", 0):
            mule.append(self._signal("Customer/account risk context", f"Risk {self._fmt_decimal(raw.get('customer_risk_rating'), 0)}", "Elevated customer risk can increase the seriousness of mule-like movement patterns.", "customer_account_risk", "mule_account_behavior", 0.08))
        finalize("mule_account_behavior", "Mule Account Behavior", mule, "Visible activity does not yet show strong rapid pass-through or network-supported mule signals.", ["Verify whether incoming funds were retained or quickly transferred onward.", "Confirm whether the customer profile supports the observed third-party transfer pattern.", "Review linked beneficiaries and counterparties for repeated reuse across other cases."], "Strong mule alignment should increase escalation sensitivity, especially where pass-through behavior is repeated.")

        structuring = []
        if txn.get("sub_threshold_ratio", 0) >= 0.3:
            structuring.append(self._signal("Below-threshold transfer ratio", self._fmt_decimal(txn.get("sub_threshold_ratio")), "Repeated values just below common reporting thresholds can suggest threshold avoidance behavior.", "transaction_behavior", "structuring", 0.3))
        if txn.get("sub_threshold_count", 0) >= 3:
            structuring.append(self._signal("Count of below-threshold transfers", txn.get("sub_threshold_count", 0), "A cluster of below-threshold transactions is a classic structuring indicator.", "transaction_behavior", "structuring", 0.18))
        if raw.get("burstiness", 0) >= 0.35:
            structuring.append(self._signal("Burstiness", self._fmt_decimal(raw.get("burstiness")), "Concentrated transaction timing can support a structuring interpretation when sub-threshold values arrive in a short window.", "time_pattern_anomalies", "structuring", 0.1))
        if txn.get("round_amount_ratio", 0) >= 0.25:
            structuring.append(self._signal("Round amount ratio", self._fmt_decimal(txn.get("round_amount_ratio")), "Repeated rounded values can indicate deliberate transaction shaping rather than natural commerce.", "transaction_behavior", "structuring", 0.12))
        if raw.get("structuring_score", 0) >= 0.5 or "STRUCT" in str(metadata.get("dominant_alert_family") or "").upper():
            structuring.append(self._signal("Rule / profile alignment", self._fmt_decimal(raw.get("structuring_score")), "Existing rule or profile alignment strengthens the structuring hypothesis.", "rule_engine_outputs", "structuring", 0.16))
        if raw.get("suspicious_txn_count", 0) >= 6:
            structuring.append(self._signal("Suspicious transaction volume", self._fmt_decimal(raw.get("suspicious_txn_count"), 0), "Higher suspicious transaction count can strengthen a repeated-threshold-avoidance pattern.", "alert_profile", "structuring", 0.08))
        finalize("structuring", "Structuring", structuring, "The current case does not show enough repeated sub-threshold behavior to materially support structuring.", ["Review whether repeated transfers cluster just below common reporting thresholds.", "Check whether transaction timing suggests deliberate splitting of larger values.", "Confirm whether cash or rapid transfer channels are over-represented in the sequence."], "Structuring alignment should guide threshold-avoidance review and may support escalation if repeated behavior is confirmed.")

        layering = []
        if graph.get("bridge_count", 0) > 0:
            layering.append(self._signal("Bridge entities", graph.get("bridge_count", 0), "Bridge nodes can indicate intermediary routing accounts that help obscure the original flow path.", "network_graph_features", "layering", 0.22))
        if graph.get("suspicious_cluster_count", 0) > 0:
            layering.append(self._signal("Suspicious clusters", graph.get("suspicious_cluster_count", 0), "Dense clusters strengthen the possibility of coordinated routing or intermediary movement.", "network_graph_features", "layering", 0.1))
        if graph.get("cycle_count", 0) > 0:
            layering.append(self._signal("Circular paths", graph.get("cycle_count", 0), "Visible cycles can indicate circular or round-tripping behavior within the reachable network.", "network_graph_features", "layering", 0.16))
        if raw.get("high_risk_geo_ratio", 0) >= 0.25:
            layering.append(self._signal("High-risk geography exposure", self._fmt_decimal(raw.get("high_risk_geo_ratio")), "Routing through higher-risk geographies can strengthen layering concern.", "transaction_behavior", "layering", 0.12))
        if raw.get("layering_score", 0) >= 0.5:
            layering.append(self._signal("Profile layering score", self._fmt_decimal(raw.get("layering_score")), "Existing case-profile alignment increases the likelihood of a layering-style pattern.", "rule_engine_outputs", "layering", 0.16))
        if graph.get("network_risk_score", 0) >= 60:
            layering.append(self._signal("Network risk context", self._fmt_decimal(graph.get("network_risk_score"), 0), "Higher network risk strengthens the significance of intermediary routing findings.", "network_graph_features", "layering", 0.08))
        finalize("layering", "Layering", layering, "Visible routing evidence does not currently show strong multi-hop or bridge-supported layering behavior.", ["Inspect whether funds move through intermediary accounts before reaching end beneficiaries.", "Review path explanations and bridge entities in Network Intelligence.", "Check whether linked alerts or cases share the same routing nodes or corridors."], "Layering alignment should increase focus on intermediary paths and network-based escalation rationale.")

        funnel = []
        if graph.get("collector_count", 0) > 0:
            funnel.append(self._signal("Collector structures", graph.get("collector_count", 0), "Many-to-one visible relationships can support funnel account interpretation.", "network_graph_features", "funnel_account", 0.22))
        if txn.get("dominant_counterparty_ratio", 0) >= 0.35:
            funnel.append(self._signal("Counterparty concentration", self._fmt_decimal(txn.get("dominant_counterparty_ratio")), "A high share of activity routed to a limited destination set can support funnel behavior.", "transaction_behavior", "funnel_account", 0.18))
        if raw.get("unique_counterparties", 0) >= 6:
            funnel.append(self._signal("Broad counterparty footprint", self._fmt_decimal(raw.get("unique_counterparties"), 0), "A wide set of counterparties feeding a smaller destination set can indicate funneling.", "transaction_behavior", "funnel_account", 0.12))
        if raw.get("funnel_score", 0) >= 0.45:
            funnel.append(self._signal("Profile funnel score", self._fmt_decimal(raw.get("funnel_score")), "Case-profile alignment supports a funnel interpretation.", "rule_engine_outputs", "funnel_account", 0.16))
        if similar.get("match_count", 0) >= 2:
            funnel.append(self._signal("Similar-case corroboration", similar.get("match_count", 0), "Historically similar cases can strengthen the reading of collector or funnel-like movement.", "similar_case_retrieval", "funnel_account", 0.08))
        finalize("funnel_account", "Funnel Account", funnel, "The visible case does not yet show strong collector or concentrated destination behavior.", ["Check whether multiple parties are feeding a single account or beneficiary set in a short period.", "Confirm whether the focal account behaves as a collector before onward movement.", "Review network collector and distributor findings for coordinated activity."], "Funnel alignment can support escalation where multiple sources converge on limited destinations.")

        pass_through = []
        if raw.get("pass_through_ratio", 0) >= 0.78:
            pass_through.append(self._signal("High pass-through ratio", self._fmt_decimal(raw.get("pass_through_ratio")), "High matched inflow and outflow suggests funds are not being retained for ordinary usage.", "transaction_behavior", "pass_through_behavior", 0.38))
        if raw.get("inbound_outbound_imbalance", 0) <= 0.25:
            pass_through.append(self._signal("Low inbound/outbound imbalance", self._fmt_decimal(raw.get("inbound_outbound_imbalance")), "Balanced inflow and outflow can support pass-through usage rather than retained customer activity.", "transaction_behavior", "pass_through_behavior", 0.12))
        if raw.get("burstiness", 0) >= 0.3:
            pass_through.append(self._signal("Condensed timing", self._fmt_decimal(raw.get("burstiness")), "Rapidly sequenced activity can strengthen a pass-through interpretation.", "time_pattern_anomalies", "pass_through_behavior", 0.1))
        if graph.get("collector_count", 0) or graph.get("distributor_count", 0):
            pass_through.append(self._signal("Network support", f"Collectors {graph.get('collector_count', 0)} | Distributors {graph.get('distributor_count', 0)}", "Network support can strengthen the reading that the account is routing rather than retaining funds.", "network_graph_features", "pass_through_behavior", 0.1))
        if raw.get("pass_through_typology_score", 0) >= 0.4:
            pass_through.append(self._signal("Profile pass-through score", self._fmt_decimal(raw.get("pass_through_typology_score")), "Existing case-profile alignment increases confidence in the pass-through hypothesis.", "rule_engine_outputs", "pass_through_behavior", 0.12))
        finalize("pass_through_behavior", "Pass-Through Behavior", pass_through, "Observed movement does not currently show strong rapid-release behavior in visible account activity.", ["Review whether funds are retained or quickly moved onward after receipt.", "Check for repeated pairs of inbound credits followed by outbound transfers.", "Verify whether limited balance retention fits the stated customer purpose."], "Pass-through alignment should strengthen escalation where rapid fund exit lacks a credible customer purpose.")

        circular = []
        if graph.get("cycle_count", 0) > 0:
            circular.append(self._signal("Circular paths detected", graph.get("cycle_count", 0), "Visible cycles suggest possible round-tripping or recycled movement within the reachable network.", "network_graph_features", "circular_movement", 0.46))
        if graph.get("path_count", 0) > 0 and graph.get("bridge_count", 0) > 0:
            circular.append(self._signal("Bridge-supported pathing", f"Paths {graph.get('path_count', 0)} | Bridges {graph.get('bridge_count', 0)}", "Visible intermediary routes can strengthen circular or recycling concerns.", "network_graph_features", "circular_movement", 0.12))
        if raw.get("layering_score", 0) >= 0.45:
            circular.append(self._signal("Layering overlap", self._fmt_decimal(raw.get("layering_score")), "Circular movement can overlap with layering-style routing behavior.", "rule_engine_outputs", "circular_movement", 0.08))
        finalize("circular_movement", "Circular Movement", circular, "No clear cycles or round-tripping paths were detected in currently visible data.", ["Inspect visible paths between linked entities for returning movement.", "Check whether the same value or counterparties reappear across short path sequences.", "Treat circular findings cautiously where external bank visibility is limited."], "Circular movement findings can materially strengthen escalation when supported by visible path evidence.")

        corridor = []
        if raw.get("high_risk_geo_ratio", 0) >= 0.25:
            corridor.append(self._signal("High-risk geography ratio", self._fmt_decimal(raw.get("high_risk_geo_ratio")), "Repeated exposure to higher-risk destinations can support corridor concern.", "transaction_behavior", "high_risk_corridor", 0.46))
        if raw.get("corridor_exposure", 0) >= 2:
            corridor.append(self._signal("Corridor breadth", self._fmt_decimal(raw.get("corridor_exposure"), 0), "Multiple corridors can strengthen concern when combined with higher-risk destinations.", "transaction_behavior", "high_risk_corridor", 0.14))
        if "HIGH" in str(metadata.get("dominant_alert_family") or "").upper() or "DEST" in str(metadata.get("dominant_alert_family") or "").upper():
            corridor.append(self._signal("Alert family support", str(metadata.get("dominant_alert_family") or "-"), "Alert lineage aligned to high-risk destination behavior can strengthen corridor interpretation.", "rule_engine_outputs", "high_risk_corridor", 0.12))
        finalize("high_risk_corridor", "High-Risk Corridor", corridor, "Geographic exposure is not yet strong enough to materially support a corridor-based typology.", ["Review whether suspicious movement repeatedly involves higher-risk geographies.", "Confirm whether the corridor is consistent with the customer profile and expected business activity.", "Check whether linked alerts or cases show the same destination pattern."], "Corridor alignment should strengthen escalation when geographic exposure is repeated and unsupported by customer context.")

        beneficiary = []
        if raw.get("counterparty_concentration", 0) >= 0.35:
            beneficiary.append(self._signal("Counterparty concentration", self._fmt_decimal(raw.get("counterparty_concentration")), "High concentration suggests a limited destination set is receiving a large share of activity.", "transaction_behavior", "concentrated_beneficiary_pattern", 0.32))
        if txn.get("dominant_counterparty_ratio", 0) >= 0.4:
            beneficiary.append(self._signal("Dominant beneficiary ratio", self._fmt_decimal(txn.get("dominant_counterparty_ratio")), "A single beneficiary dominating visible flows can support concentration-based concern.", "transaction_behavior", "concentrated_beneficiary_pattern", 0.22))
        if raw.get("repeated_beneficiary_ratio", 0) >= 0.3:
            beneficiary.append(self._signal("Repeated beneficiary ratio", self._fmt_decimal(raw.get("repeated_beneficiary_ratio")), "Repeated reuse of the same destination accounts can strengthen beneficiary concentration findings.", "transaction_behavior", "concentrated_beneficiary_pattern", 0.12))
        if graph.get("collector_count", 0) > 0:
            beneficiary.append(self._signal("Collector network support", graph.get("collector_count", 0), "Network collector patterns can strengthen the significance of beneficiary concentration.", "network_graph_features", "concentrated_beneficiary_pattern", 0.08))
        finalize("concentrated_beneficiary_pattern", "Concentrated Beneficiary Pattern", beneficiary, "Visible counterparties are not concentrated enough to materially support a beneficiary concentration pattern.", ["Review whether a limited beneficiary set receives a disproportionate share of suspicious value.", "Check whether concentrated beneficiaries recur across linked alerts or similar cases.", "Assess whether any beneficiary relationship is legitimate and documented."], "Concentrated beneficiary findings can help support network-driven escalation or branch confirmation.")

        burst = []
        if raw.get("burstiness", 0) >= 0.45:
            burst.append(self._signal("Burstiness", self._fmt_decimal(raw.get("burstiness")), "Strong activity concentration in a short time window can indicate non-routine suspicious movement.", "time_pattern_anomalies", "burst_spike_transaction_pattern", 0.4))
        if raw.get("off_hours_ratio", 0) >= 0.3 or raw.get("weekend_ratio", 0) >= 0.3:
            burst.append(self._signal("Time-pattern anomaly", f"Off-hours {self._fmt_decimal(raw.get('off_hours_ratio'))} | Weekend {self._fmt_decimal(raw.get('weekend_ratio'))}", "Unusual timing can strengthen a burst or spike interpretation.", "time_pattern_anomalies", "burst_spike_transaction_pattern", 0.12))
        if raw.get("suspicious_txn_count", 0) >= 8:
            burst.append(self._signal("High suspicious volume", self._fmt_decimal(raw.get("suspicious_txn_count"), 0), "Higher suspicious transaction count can strengthen the reading of concentrated surge activity.", "alert_profile", "burst_spike_transaction_pattern", 0.14))
        finalize("burst_spike_transaction_pattern", "Burst / Spike Transaction Pattern", burst, "The current case does not show strong condensed spike behavior in visible timing data.", ["Check whether suspicious activity clusters into a narrow time window.", "Review whether new counterparties appear rapidly during the observed spike.", "Confirm whether the burst is supported by baseline or network evidence."], "Burst/spike patterns can guide faster escalation when timing concentration is paired with other suspicious signals.")

        return results
