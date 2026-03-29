from services.typology_explainer_service import TypologyExplainerService
from services.typology_profile_service import TypologyProfileService
from services.typology_report_adapter_service import TypologyReportAdapterService
from services.typology_rules_engine import TypologyRulesEngine
from services.typology_scoring_service import TypologyScoringService


class TypologyIntelligenceService:
    def __init__(self, db_manager):
        self.profile_service = TypologyProfileService(db_manager)
        self.rules_engine = TypologyRulesEngine()
        self.scoring_service = TypologyScoringService()
        self.explainer = TypologyExplainerService()
        self.report_adapter = TypologyReportAdapterService()

    def analyze(self, case_id, options=None):
        options = options or {}
        profile_payload = self.profile_service.build(case_id)
        evaluated = self.rules_engine.evaluate(profile_payload)
        scored = self.scoring_service.assess(evaluated, profile_payload, analysis_mode=options.get("analysis_mode") or "balanced")
        explained = self.explainer.build(scored, profile_payload)
        payload = {
            "case_id": case_id,
            **scored,
            **explained,
            "supporting_signal_categories": profile_payload.get("signal_categories") or {},
            "raw_profile": {
                "metadata": profile_payload.get("metadata") or {},
                "raw_features": profile_payload.get("raw_features") or {},
                "transaction_metrics": profile_payload.get("transaction_metrics") or {},
                "graph_support": profile_payload.get("graph_support") or {},
                "similar_case_support": profile_payload.get("similar_case_support") or {},
            },
            "analysis_options": options,
        }
        payload["report_payload"] = self.report_adapter.to_report_payload(payload)
        return payload
