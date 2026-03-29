class GraphExplainerService:
    def build_summary(self, graph_payload, analytics, findings):
        kpis = findings.get("kpis") or {}
        case_id = graph_payload.get("case_id")
        visibility_note = findings.get("visibility_limitations") or "Visibility is limited to available bank data."
        focal_account = graph_payload.get("focal_account_id") or "the focal account"

        lines = [
            f"Network review for case {case_id} was centered on {focal_account} and evaluated visible entity relationships, transaction flows, and shared network structures.",
            findings.get("network_risk_assessment", {}).get("assessment") or "Network evidence was reviewed for escalation relevance.",
        ]

        if kpis.get("suspicious_cluster_count"):
            lines.append(
                f"{kpis['suspicious_cluster_count']} suspicious cluster(s) were identified in the visible graph, indicating the case is linked to a broader sub-network rather than appearing fully isolated."
            )
        else:
            lines.append("No strong suspicious cluster was detected in the currently visible graph, and the case appears relatively contained within available relationship data.")

        if kpis.get("hub_entity_count"):
            lines.append(f"{kpis['hub_entity_count']} hub entity signal(s) and {kpis.get('bridge_entity_count', 0)} bridge signal(s) were identified and should be reviewed for concentration or intermediary behavior.")

        if str(kpis.get("funnel_pattern_flag")) == "Observed":
            lines.append("Collector or distributor behavior is visible in the current graph and may indicate funnel, mule, or pass-through structures.")

        if str(kpis.get("circular_flow_flag")) == "Observed":
            lines.append("Circular movement was detected in visible relationships and may warrant escalation if corroborated by transaction and case evidence.")

        lines.append(visibility_note)
        return " ".join(lines)
