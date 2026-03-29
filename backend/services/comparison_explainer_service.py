from typing import Dict, List, Tuple


FEATURE_LABELS = {
    "suspicious_txn_count": "suspicious transaction count",
    "total_suspicious_amount": "total suspicious amount",
    "average_suspicious_amount": "average suspicious amount",
    "off_hours_ratio": "off-hours activity",
    "weekend_ratio": "weekend activity",
    "pass_through_ratio": "pass-through behavior",
    "repeated_beneficiary_ratio": "repeated beneficiary behavior",
    "unique_counterparties": "counterparty breadth",
    "counterparty_concentration": "counterparty concentration",
    "high_risk_geo_ratio": "high-risk geography exposure",
    "alert_count": "alert count",
    "distinct_alert_families": "alert family footprint",
    "customer_risk_rating": "customer risk profile",
    "linked_accounts_count": "linked account count",
    "structuring_score": "structuring footprint",
    "layering_score": "layering footprint",
    "mule_score": "mule footprint",
    "funnel_score": "funnel-account footprint",
    "pass_through_typology_score": "pass-through typology",
}


class ComparisonExplainerService:
    def _matching_features(self, left_profile: Dict, right_profile: Dict, limit: int = 4) -> List[str]:
        left = left_profile.get("raw_features") or {}
        right = right_profile.get("raw_features") or {}
        closeness = []
        for key, label in FEATURE_LABELS.items():
            left_value = float(left.get(key) or 0.0)
            right_value = float(right.get(key) or 0.0)
            denom = max(abs(left_value), abs(right_value), 1.0)
            closeness.append((abs(left_value - right_value) / denom, label))
        closeness.sort(key=lambda item: item[0])
        return [label for _, label in closeness[:limit]]

    def _difference_features(self, left_profile: Dict, right_profile: Dict, limit: int = 4) -> List[str]:
        left = left_profile.get("raw_features") or {}
        right = right_profile.get("raw_features") or {}
        divergence = []
        for key, label in FEATURE_LABELS.items():
            left_value = float(left.get(key) or 0.0)
            right_value = float(right.get(key) or 0.0)
            denom = max(abs(left_value), abs(right_value), 1.0)
            divergence.append((abs(left_value - right_value) / denom, label, left_value, right_value))
        divergence.sort(key=lambda item: item[0], reverse=True)
        return [f"{label}: {round(left_value, 2)} vs {round(right_value, 2)}" for _, label, left_value, right_value in divergence[:limit]]

    def _shared_indicators(self, left_profile: Dict, right_profile: Dict) -> List[str]:
        left_features = left_profile.get("raw_features") or {}
        right_features = right_profile.get("raw_features") or {}
        indicators = []
        if left_features.get("off_hours_ratio", 0) > 0.25 and right_features.get("off_hours_ratio", 0) > 0.25:
            indicators.append("Both cases show elevated off-hours activity.")
        if left_features.get("counterparty_concentration", 0) > 0.25 and right_features.get("counterparty_concentration", 0) > 0.25:
            indicators.append("Both cases show concentrated counterparty behavior.")
        if left_features.get("pass_through_ratio", 0) > 0.45 and right_features.get("pass_through_ratio", 0) > 0.45:
            indicators.append("Both cases show elevated pass-through or funnel movement.")
        if left_features.get("high_risk_geo_ratio", 0) > 0.15 and right_features.get("high_risk_geo_ratio", 0) > 0.15:
            indicators.append("Both cases show high-risk geography exposure.")
        if left_profile.get("metadata", {}).get("dominant_alert_family") == right_profile.get("metadata", {}).get("dominant_alert_family"):
            indicators.append(f"Both cases align to the {left_profile.get('metadata', {}).get('dominant_alert_family')} alert family.")
        return indicators[:5]

    def _common_risk_traits(self, left_profile: Dict, right_profile: Dict) -> List[str]:
        left_meta = left_profile.get("metadata") or {}
        right_meta = right_profile.get("metadata") or {}
        traits = []
        if left_meta.get("risk_tier") == right_meta.get("risk_tier"):
            traits.append(f"Both cases are in the {left_meta.get('risk_tier')} risk tier.")
        if left_meta.get("severity") == right_meta.get("severity") and left_meta.get("severity"):
            traits.append(f"Both cases currently carry {left_meta.get('severity')} severity.")
        if left_profile.get("raw_features", {}).get("pep_flag") and right_profile.get("raw_features", {}).get("pep_flag"):
            traits.append("Both cases include PEP exposure.")
        if left_profile.get("raw_features", {}).get("sanctions_flag") and right_profile.get("raw_features", {}).get("sanctions_flag"):
            traits.append("Both cases include sanctions indicators.")
        return traits[:4]

    def _typology_pattern(self, left_profile: Dict, right_profile: Dict) -> str:
        left_typology = left_profile.get("metadata", {}).get("dominant_typology")
        right_typology = right_profile.get("metadata", {}).get("dominant_typology")
        if left_typology and left_typology == right_typology:
            return f"Both cases align most closely to a {left_typology.replace('_', ' ')} pattern."
        return f"{left_typology or 'Current case'} and {right_typology or 'matched case'} do not align to the same dominant typology."

    def build_match_explanation(self, left_profile: Dict, right_profile: Dict, component_scores: Dict[str, float], final_score: float) -> Dict:
        shared_indicators = self._shared_indicators(left_profile, right_profile)
        top_matching_features = self._matching_features(left_profile, right_profile)
        key_differences = self._difference_features(left_profile, right_profile)
        common_risk_traits = self._common_risk_traits(left_profile, right_profile)
        typology_pattern = self._typology_pattern(left_profile, right_profile)

        matched_because = shared_indicators[:]
        if component_scores.get("behavioral", 0.0) >= 0.7:
            matched_because.append("Behavioral transaction rhythm is strongly aligned.")
        if component_scores.get("network", 0.0) >= 0.6:
            matched_because.append("Network and counterparty structure is materially similar.")
        if component_scores.get("typology", 0.0) >= 0.6:
            matched_because.append("Typology footprint aligns across the two cases.")
        if not matched_because:
            matched_because.append("Similarity is driven by a partial combination of alert, network, and transaction indicators.")

        left_risk = float((left_profile.get("metadata") or {}).get("risk_score") or 0.0)
        right_risk = float((right_profile.get("metadata") or {}).get("risk_score") or 0.0)
        higher_risk_case = left_profile.get("case_id") if left_risk >= right_risk else right_profile.get("case_id")

        comparative_insight = (
            f"The compared cases show a {round(final_score * 100)}% overall similarity. "
            f"Similarity is strongest across {', '.join(top_matching_features[:3])}. "
            f"{higher_risk_case} currently appears higher risk based on the present risk score and case profile. "
            f"{typology_pattern}"
        )

        return {
            "shared_indicators": shared_indicators,
            "top_matching_features": top_matching_features,
            "key_differences": key_differences,
            "similar_typology_pattern": typology_pattern,
            "common_risk_traits": common_risk_traits,
            "outcome_summary": {
                "base_case": (left_profile.get("metadata") or {}).get("outcome_status"),
                "matched_case": (right_profile.get("metadata") or {}).get("outcome_status"),
            },
            "matched_because": matched_because,
            "comparative_insight": comparative_insight,
        }

    def build_detailed_summary(self, left_profile: Dict, right_profile: Dict, component_scores: Dict[str, float], final_score: float) -> Dict:
        explanation = self.build_match_explanation(left_profile, right_profile, component_scores, final_score)
        executive_summary = (
            f"{left_profile.get('case_id')} and {right_profile.get('case_id')} show {round(final_score * 100)}% similarity. "
            f"The strongest alignment is across {', '.join(explanation['top_matching_features'][:2])}. "
            f"Material differences remain in {', '.join(item.split(':')[0] for item in explanation['key_differences'][:2])}."
        )
        return {
            **explanation,
            "executive_summary": executive_summary,
        }

    def build_portfolio_summary(self, pair_rows: List[Tuple[str, float]]) -> Dict:
        sorted_rows = sorted(pair_rows, key=lambda item: item[1], reverse=True)
        strongest = [{"pair": pair, "score": round(score * 100, 1)} for pair, score in sorted_rows[:5]]
        weakest = [{"pair": pair, "score": round(score * 100, 1)} for pair, score in sorted_rows[-3:]] if sorted_rows else []
        return {
            "strongest_pairs": strongest,
            "outlier_pairs": weakest,
        }
