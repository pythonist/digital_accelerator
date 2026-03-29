from services.graph_analytics_service import GraphAnalyticsService
from services.graph_explainer_service import GraphExplainerService
from services.network_findings_service import NetworkFindingsService
from services.network_graph_builder_service import NetworkGraphBuilderService
from services.network_report_adapter_service import NetworkReportAdapterService


class NetworkIntelligenceService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.builder = NetworkGraphBuilderService(db_manager)
        self.analytics = GraphAnalyticsService()
        self.findings = NetworkFindingsService()
        self.explainer = GraphExplainerService()
        self.report_adapter = NetworkReportAdapterService()

    def analyze(self, case_id, filters=None):
        graph_payload = self.builder.build_case_graph(case_id, filters=filters)
        analytics = self.analytics.analyze(graph_payload)
        findings = self.findings.build(case_id, graph_payload, analytics)
        executive_summary = self.explainer.build_summary(graph_payload, analytics, findings)

        top_entities = []
        for item in (analytics.get("hubs") or [])[:5]:
            top_entities.append(
                {
                    "label": item.get("label"),
                    "entity_type": "Hub",
                    "metric": item.get("degree_centrality"),
                }
            )
        for item in (analytics.get("bridges") or [])[:5]:
            if any(existing.get("label") == item.get("label") for existing in top_entities):
                continue
            top_entities.append(
                {
                    "label": item.get("label"),
                    "entity_type": "Bridge",
                    "metric": item.get("betweenness"),
                }
            )

        report_payload = {
            "graph_summary": executive_summary,
            "suspicious_clusters": findings.get("suspicious_clusters") or [],
            "hub_entities": analytics.get("hubs") or [],
            "bridge_entities": analytics.get("bridges") or [],
            "high_risk_entities": analytics.get("high_risk_entities") or [],
            "funnel_patterns": {
                "collectors": analytics.get("collectors") or [],
                "distributors": analytics.get("distributors") or [],
            },
            "circular_flow_findings": analytics.get("cycles") or [],
            "path_highlights": analytics.get("shortest_paths") or [],
            "visibility_limitations": findings.get("visibility_limitations") or "",
            "network_risk_assessment": findings.get("network_risk_assessment") or {},
            "top_entities": top_entities,
        }

        return {
            "case_id": case_id,
            "graph": graph_payload.get("graph"),
            "visibility": graph_payload.get("visibility"),
            "filters": filters or {},
            "executive_summary": executive_summary,
            "kpis": findings.get("kpis"),
            "findings": findings.get("key_findings"),
            "evidence": findings.get("evidence"),
            "analytics": analytics,
            "timeline": graph_payload.get("transactions") or [],
            "relationship_matrix": analytics.get("relationship_matrix"),
            "report_snippets": findings.get("report_snippets"),
            "report_payload": report_payload,
            "narrative": executive_summary,
        }
