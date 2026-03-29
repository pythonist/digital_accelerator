from typing import Dict, List, Optional

from services.case_vector_index_service import CaseVectorIndexService, DEFAULT_HYBRID_WEIGHTS
from services.comparison_explainer_service import ComparisonExplainerService


class CaseSimilarityService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.index_service = CaseVectorIndexService(db_manager)
        self.explainer = ComparisonExplainerService()

    def _normalize_mode(self, mode: Optional[str]) -> str:
        text = str(mode or "hybrid").strip().lower()
        mapping = {
            "behavioral similarity": "behavioral",
            "behavioral": "behavioral",
            "typology similarity": "typology",
            "typology": "typology",
            "network similarity": "network",
            "network": "network",
            "hybrid similarity": "hybrid",
            "hybrid": "hybrid",
        }
        return mapping.get(text, "hybrid")

    def _resolve_weights(self, mode: str, weights: Optional[Dict[str, float]]) -> Dict[str, float]:
        if mode == "behavioral":
            return {"behavioral": 1.0, "typology": 0.0, "network": 0.0, "alert": 0.0}
        if mode == "typology":
            return {"behavioral": 0.0, "typology": 1.0, "network": 0.0, "alert": 0.0}
        if mode == "network":
            return {"behavioral": 0.0, "typology": 0.0, "network": 1.0, "alert": 0.0}
        resolved = dict(DEFAULT_HYBRID_WEIGHTS)
        for key in resolved:
            if weights and key in weights:
                try:
                    resolved[key] = max(0.0, float(weights[key]))
                except Exception:
                    continue
        total = sum(resolved.values()) or 1.0
        return {key: value / total for key, value in resolved.items()}

    def _passes_filters(self, base_profile: Dict, candidate_profile: Dict, filters: Dict) -> bool:
        base_meta = base_profile.get("metadata") or {}
        candidate_meta = candidate_profile.get("metadata") or {}
        if filters.get("same_branch") and candidate_meta.get("branch_code") != base_meta.get("branch_code"):
            return False
        if filters.get("same_alert_family") and candidate_meta.get("dominant_alert_family") != base_meta.get("dominant_alert_family"):
            return False
        if filters.get("same_risk_tier") and candidate_meta.get("risk_tier") != base_meta.get("risk_tier"):
            return False
        if filters.get("same_customer_segment") and candidate_meta.get("customer_segment") != base_meta.get("customer_segment"):
            return False
        if filters.get("same_time_period") and candidate_meta.get("time_period") != base_meta.get("time_period"):
            return False

        outcome_filter = str(filters.get("outcome_filter") or "").strip().lower()
        candidate_outcome = str(candidate_meta.get("outcome_status") or "").lower()
        if filters.get("include_only_escalated") and "pending" not in candidate_outcome and "escalated" not in candidate_outcome:
            return False
        if filters.get("include_only_sar_recommended") and "sar recommended" not in candidate_outcome:
            return False
        if not filters.get("include_resolved", True) and candidate_outcome in {"closed", "rejected / no further action"}:
            return False
        if outcome_filter and outcome_filter not in candidate_outcome:
            return False
        return True

    def retrieve_similar_cases(
        self,
        base_case_id: str,
        mode: str = "hybrid",
        top_k: int = 10,
        threshold: float = 0.0,
        weights: Optional[Dict[str, float]] = None,
        filters: Optional[Dict] = None,
    ) -> Dict:
        filters = filters or {}
        mode_key = self._normalize_mode(mode)
        weights_map = self._resolve_weights(mode_key, weights)
        self.index_service.ensure_index()

        base_profile = self.index_service.get_profile(base_case_id)
        if not base_profile:
            raise ValueError(f"Case {base_case_id} is not available in the case retrieval index.")

        candidate_seed = self.index_service.search_component(base_case_id, mode_key if mode_key != "hybrid" else "hybrid", top_k=max(top_k * 12, 40))
        if not candidate_seed:
            candidate_seed = [{"case_id": case_id, "score": 0.0} for case_id in self.index_service.get_case_ids() if case_id != str(base_case_id)]

        seen = set()
        results = []
        for item in candidate_seed:
            candidate_id = str(item.get("case_id"))
            if candidate_id in seen or candidate_id == str(base_case_id):
                continue
            seen.add(candidate_id)
            candidate_profile = self.index_service.get_profile(candidate_id)
            if not candidate_profile or not self._passes_filters(base_profile, candidate_profile, filters):
                continue

            component_scores = {
                "behavioral": self.index_service.get_component_similarity(base_case_id, candidate_id, "behavioral"),
                "typology": self.index_service.get_component_similarity(base_case_id, candidate_id, "typology"),
                "network": self.index_service.get_component_similarity(base_case_id, candidate_id, "network"),
                "alert": self.index_service.get_component_similarity(base_case_id, candidate_id, "alert"),
            }
            final_score = sum(component_scores[name] * weights_map.get(name, 0.0) for name in component_scores)
            final_score = max(0.0, min(1.0, final_score))
            if final_score < float(threshold or 0.0):
                continue

            explanation = self.explainer.build_match_explanation(base_profile, candidate_profile, component_scores, final_score)
            metadata = candidate_profile.get("metadata") or {}
            results.append({
                "case_id": candidate_id,
                "similarity_score": round(final_score, 4),
                "shared_indicators": explanation["shared_indicators"],
                "top_matching_features": explanation["top_matching_features"],
                "key_differences": explanation["key_differences"],
                "similar_typology_pattern": explanation["similar_typology_pattern"],
                "common_risk_traits": explanation["common_risk_traits"],
                "resolution_outcome": metadata.get("outcome_status"),
                "matched_because": explanation["matched_because"],
                "outcome_summary": explanation["outcome_summary"],
                "component_scores": {name: round(score, 4) for name, score in component_scores.items()},
                "risk_score": metadata.get("risk_score"),
                "severity": metadata.get("severity"),
                "branch_code": metadata.get("branch_code"),
                "dominant_alert_family": metadata.get("dominant_alert_family"),
                "dominant_typology": metadata.get("dominant_typology"),
                "customer_segment": metadata.get("customer_segment"),
                "last_updated_at": metadata.get("last_updated_at"),
                "preview": candidate_profile.get("preview") or {},
            })

        results.sort(key=lambda item: item["similarity_score"], reverse=True)
        return {
            "base_case_id": str(base_case_id),
            "mode": mode_key,
            "weights": weights_map,
            "threshold": float(threshold or 0.0),
            "results": results[:max(1, int(top_k))],
            "last_index_refresh": self.index_service.index_status().get("last_rebuilt_at"),
            "methodology": "structured_case_fingerprint",
        }
