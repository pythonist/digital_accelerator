from typing import Any, Dict, List


class TypologyExplainerService:
    def _sentence_list(self, items: List[str]) -> str:
        cleaned = [str(item).strip() for item in items if str(item).strip()]
        if not cleaned:
            return ""
        if len(cleaned) == 1:
            return cleaned[0]
        return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"

    def build(self, scoring_payload: Dict[str, Any], profile_payload: Dict[str, Any]) -> Dict[str, Any]:
        primary = scoring_payload.get("primary_typology") or {}
        supporting = scoring_payload.get("supporting_typologies") or []
        signal_categories = profile_payload.get("signal_categories") or {}
        limitations = profile_payload.get("data_limitations") or []
        graph_support = profile_payload.get("graph_support") or {}
        similar_support = profile_payload.get("similar_case_support") or {}
        primary_evidence = primary.get("evidence") or []

        summary_sections = {
            "assessment_overview": (
                f"The strongest visible pattern for this case is {primary.get('typology_name') or 'under review'}, with "
                f"{str(primary.get('confidence') or 'limited evidence').lower()} confidence and a typology risk score of "
                f"{scoring_payload.get('typology_risk_score') or 0}."
            ),
            "primary_typology": f"Primary typology indicates {primary.get('typology_name') or 'no material typology identified'}.",
            "supporting_typologies": (
                f"Supporting patterns include {self._sentence_list([item.get('typology_name') for item in supporting if item.get('typology_name')])}."
                if supporting else
                "No supporting typology currently rises above a weak signal."
            ),
            "why_detected": (
                f"This pattern is being driven by {self._sentence_list([item.get('why_it_matters') for item in primary_evidence[:3]])}."
                if primary_evidence else
                "The current case does not yet have enough corroborating signals to support a strong typology narrative."
            ),
            "key_evidence_and_signals": [f"{item.get('signal')}: {item.get('observed_value')}" for item in primary_evidence[:5]] or ["No material typology evidence has been collected yet."],
            "recommended_next_steps": list(primary.get("next_checks") or []),
            "confidence_and_limitations": [
                f"Confidence is {primary.get('confidence') or 'Limited Evidence'} because the assessment relies on visible structured case data only.",
                *limitations[:3],
            ],
        }

        what_strengthens = []
        if similar_support.get("sar_precedent_count", 0):
            what_strengthens.append("Historically similar cases include SAR-recommended or escalated precedents.")
        if graph_support.get("suspicious_cluster_count", 0) or graph_support.get("bridge_count", 0):
            what_strengthens.append("Visible network findings add corroboration through clusters, bridges, or funnel structures.")
        if primary_evidence:
            what_strengthens.append("Multiple structured transaction and alert signals align to the same typology.")

        what_weakens = []
        if primary.get("confidence") in {"Low", "Limited Evidence"}:
            what_weakens.append("Current signal strength is modest and requires more corroboration before it should influence closure or escalation.")
        if graph_support.get("hub_count", 0) + graph_support.get("bridge_count", 0) + graph_support.get("suspicious_cluster_count", 0) == 0:
            what_weakens.append("Visible network evidence is sparse, so the assessment relies mainly on transaction and alert behavior.")
        if similar_support.get("match_count", 0) == 0:
            what_weakens.append("There is limited historical precedent from similar-case retrieval for this exact pattern.")

        branch_confirmation = primary.get("score", 0) >= 0.45 and primary.get("typology_id") in {"mule_account_behavior", "pass_through_behavior", "funnel_account"}
        l2_review = primary.get("score", 0) >= 0.55 or primary.get("typology_id") in {"layering", "circular_movement", "high_risk_corridor"}

        return {
            "summary_sections": summary_sections,
            "supporting_signals": [{"category": category.replace("_", " ").title(), "items": rows} for category, rows in signal_categories.items()],
            "investigator_guidance": {
                "what_to_verify": (summary_sections["recommended_next_steps"] + (["Review whether historically escalated matches create a relevant precedent for this case."] if (primary.get("status") in {"Primary", "Supporting"} and similar_support.get("escalated_match_count", 0)) else []) + (["Reconcile typology findings with Network Intelligence before final resolution."] if (graph_support.get("bridge_count", 0) or graph_support.get("collector_count", 0)) else []))[:5],
                "what_is_missing": ["Confirm whether the observed activity fits the stated customer profile.", "Review whether additional supporting documentation or branch context exists for the visible movement."] if primary.get("confidence") != "High" else ["No critical evidence gap was identified, but analyst validation is still required before closure."],
                "what_could_strengthen": what_strengthens or ["More corroborating transaction, network, or historical signals would strengthen the assessment."],
                "what_could_weaken": what_weakens or ["A credible customer explanation or supporting documentation could weaken the typology assessment."],
                "l2_review_should_be_considered": l2_review,
                "branch_confirmation_may_be_needed": branch_confirmation,
                "sufficiency_note": "The current typology is strong enough to influence escalation review, but it should still be reconciled with broader case evidence." if primary.get("status") == "Primary" else "This typology is a supporting investigation aid and should not be treated as a standalone decision.",
            },
            "report_snippets": [
                f"Case behavior aligns primarily with {primary.get('typology_name') or 'a limited-evidence pattern'} based on visible structured case signals.",
                *( [f"Key supporting indicators include {self._sentence_list([item.get('signal').lower() for item in primary_evidence[:3]])}."] if primary_evidence else [] ),
                *( [f"Supporting typologies include {self._sentence_list([item.get('typology_name') for item in supporting if item.get('typology_name')])}."] if supporting else [] ),
                *( [limitations[0]] if limitations else [] ),
            ],
            "limitations_note": " ".join(limitations[:3]) if limitations else "Assessment is based on available internal bank and investigation data.",
        }
