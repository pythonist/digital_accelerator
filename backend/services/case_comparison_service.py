from itertools import combinations
from statistics import mean
from typing import Dict, List

from services.case_similarity_service import CaseSimilarityService
from services.comparison_explainer_service import ComparisonExplainerService


class CaseComparisonService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.similarity_service = CaseSimilarityService(db_manager)
        self.index_service = self.similarity_service.index_service
        self.explainer = ComparisonExplainerService()

    def _component_scores(self, case_id_a: str, case_id_b: str) -> Dict[str, float]:
        return {
            "behavioral": self.index_service.get_component_similarity(case_id_a, case_id_b, "behavioral"),
            "typology": self.index_service.get_component_similarity(case_id_a, case_id_b, "typology"),
            "network": self.index_service.get_component_similarity(case_id_a, case_id_b, "network"),
            "alert": self.index_service.get_component_similarity(case_id_a, case_id_b, "alert"),
        }

    def _hybrid_score(self, component_scores: Dict[str, float]) -> float:
        weights = {"behavioral": 0.45, "typology": 0.25, "network": 0.20, "alert": 0.10}
        return max(0.0, min(1.0, sum(component_scores[key] * weights[key] for key in weights)))

    def compare_cases(self, case_ids: List[str], base_case_id: str = None) -> Dict:
        case_ids = [str(case_id) for case_id in (case_ids or []) if str(case_id).strip()]
        unique_case_ids = []
        for case_id in case_ids:
            if case_id not in unique_case_ids:
                unique_case_ids.append(case_id)
        if len(unique_case_ids) < 2:
            raise ValueError("At least two cases are required for comparison.")

        self.index_service.ensure_index()
        profiles = {case_id: self.index_service.get_profile(case_id) for case_id in unique_case_ids}
        for case_id, profile in profiles.items():
            if not profile:
                raise ValueError(f"Case {case_id} is not available in the case retrieval index.")

        if len(unique_case_ids) == 2:
            case_a, case_b = unique_case_ids[0], unique_case_ids[1]
            component_scores = self._component_scores(case_a, case_b)
            final_score = self._hybrid_score(component_scores)
            explanation = self.explainer.build_detailed_summary(profiles[case_a], profiles[case_b], component_scores, final_score)
            return {
                "mode": "detailed",
                "base_case_id": base_case_id or case_a,
                "comparison_pair": [case_a, case_b],
                "overall_similarity": round(final_score, 4),
                "component_scores": {key: round(value, 4) for key, value in component_scores.items()},
                "executive_summary": explanation["executive_summary"],
                "shared_indicators": explanation["shared_indicators"],
                "key_differences": explanation["key_differences"],
                "risk_alert_profile": {
                    case_a: profiles[case_a]["metadata"],
                    case_b: profiles[case_b]["metadata"],
                },
                "transaction_behavior": {
                    case_a: {key: profiles[case_a]["raw_features"][key] for key in ["suspicious_txn_count", "total_suspicious_amount", "off_hours_ratio", "weekend_ratio", "pass_through_ratio"]},
                    case_b: {key: profiles[case_b]["raw_features"][key] for key in ["suspicious_txn_count", "total_suspicious_amount", "off_hours_ratio", "weekend_ratio", "pass_through_ratio"]},
                },
                "counterparty_comparison": {
                    case_a: profiles[case_a]["preview"]["top_counterparties"],
                    case_b: profiles[case_b]["preview"]["top_counterparties"],
                },
                "typology_footprint": {
                    case_a: {key: profiles[case_a]["raw_features"][key] for key in ["structuring_score", "layering_score", "mule_score", "funnel_score", "pass_through_typology_score"]},
                    case_b: {key: profiles[case_b]["raw_features"][key] for key in ["structuring_score", "layering_score", "mule_score", "funnel_score", "pass_through_typology_score"]},
                },
                "network_similarity": {
                    "score": round(component_scores["network"], 4),
                    "shared_indicators": explanation["shared_indicators"],
                },
                "timeline_comparison": {
                    case_a: profiles[case_a]["preview"]["transactions"][:6],
                    case_b: profiles[case_b]["preview"]["transactions"][:6],
                },
                "outcome_comparison": explanation["outcome_summary"],
                "ai_comparative_insight": explanation["comparative_insight"],
            }

        matrix = []
        pair_scores = []
        for case_id in unique_case_ids:
            row = []
            for other_id in unique_case_ids:
                if case_id == other_id:
                    similarity = 1.0
                else:
                    similarity = self._hybrid_score(self._component_scores(case_id, other_id))
                row.append({"case_id": other_id, "similarity": round(similarity, 4)})
            matrix.append({"case_id": case_id, "comparisons": row})

        for case_a, case_b in combinations(unique_case_ids, 2):
            pair_scores.append((f"{case_a} vs {case_b}", self._hybrid_score(self._component_scores(case_a, case_b))))

        cluster_summary = self.explainer.build_portfolio_summary(pair_scores)
        feature_rows = [
            {
                "feature": "Risk Score",
                "values": {case_id: profiles[case_id]["metadata"].get("risk_score") for case_id in unique_case_ids},
            },
            {
                "feature": "Alert Count",
                "values": {case_id: profiles[case_id]["raw_features"].get("alert_count") for case_id in unique_case_ids},
            },
            {
                "feature": "Suspicious Transaction Count",
                "values": {case_id: profiles[case_id]["raw_features"].get("suspicious_txn_count") for case_id in unique_case_ids},
            },
            {
                "feature": "Total Suspicious Amount",
                "values": {case_id: profiles[case_id]["raw_features"].get("total_suspicious_amount") for case_id in unique_case_ids},
            },
            {
                "feature": "Dominant Alert Family",
                "values": {case_id: profiles[case_id]["metadata"].get("dominant_alert_family") for case_id in unique_case_ids},
            },
            {
                "feature": "Dominant Typology",
                "values": {case_id: profiles[case_id]["metadata"].get("dominant_typology") for case_id in unique_case_ids},
            },
            {
                "feature": "Resolution Outcome",
                "values": {case_id: profiles[case_id]["metadata"].get("outcome_status") for case_id in unique_case_ids},
            },
        ]
        average_scores = {case_id: mean([cell["similarity"] for cell in row["comparisons"] if cell["case_id"] != case_id]) for case_id, row in zip(unique_case_ids, matrix)}
        outlier_case = min(average_scores, key=average_scores.get) if average_scores else None

        return {
            "mode": "portfolio",
            "base_case_id": base_case_id or unique_case_ids[0],
            "case_ids": unique_case_ids,
            "comparison_matrix": matrix,
            "feature_rows": feature_rows,
            "shared_feature_clusters": cluster_summary["strongest_pairs"],
            "strongest_common_patterns": [
                "Aligned transaction volume and alert density",
                "Comparable typology footprint across selected cases",
                "Common network and counterparty structure",
            ],
            "outlier_case_flags": [
                {
                    "case_id": outlier_case,
                    "reason": "This case has the lowest average similarity to the rest of the selected portfolio.",
                }
            ] if outlier_case else [],
            "pair_drilldown_candidates": cluster_summary["strongest_pairs"],
            "outcome_comparison": {case_id: profiles[case_id]["metadata"].get("outcome_status") for case_id in unique_case_ids},
            "portfolio_insight": (
                "Portfolio comparison highlights which selected cases form the strongest behavioral cluster and which case sits outside the common pattern. "
                "Use the strongest pair for deeper forensic comparison."
            ),
        }
