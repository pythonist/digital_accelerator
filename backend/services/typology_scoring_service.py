from typing import Any, Dict


class TypologyScoringService:
    def _confidence_from_score(self, score: float, evidence_count: int, limitation_count: int) -> str:
        adjusted = max(0.0, min(1.0, float(score) + min(evidence_count, 5) * 0.03 - limitation_count * 0.04))
        if adjusted >= 0.78:
            return "High"
        if adjusted >= 0.58:
            return "Moderate"
        if adjusted >= 0.35:
            return "Low"
        return "Limited Evidence"

    def _status_from_score(self, score: float, rank: int, confidence: str) -> str:
        if confidence == "Limited Evidence" and score < 0.22:
            return "Not Enough Evidence"
        if rank == 0 and score >= 0.5:
            return "Primary"
        if score >= 0.38:
            return "Supporting"
        if score >= 0.2:
            return "Weak Signal"
        return "Not Significant"

    def assess(self, evaluated: Dict[str, Dict[str, Any]], profile_payload: Dict[str, Any], analysis_mode: str = "balanced") -> Dict[str, Any]:
        mode = str(analysis_mode or "balanced").strip().lower()
        mode_multiplier = {"balanced": 1.0, "evidence-led": 0.95, "escalation-sensitive": 1.06}.get(mode, 1.0)
        rows = []
        for payload in evaluated.values():
            evidence = payload.get("evidence") or []
            score = max(0.0, min(1.0, float(payload.get("score") or 0.0) * mode_multiplier))
            confidence = self._confidence_from_score(score, len(evidence), len(payload.get("limitations") or []))
            rows.append({**payload, "score": round(score, 4), "confidence": confidence, "evidence_strength": "Strong" if len(evidence) >= 4 and score >= 0.58 else "Moderate" if len(evidence) >= 2 and score >= 0.35 else "Limited"})

        rows.sort(key=lambda item: item["score"], reverse=True)
        for index, row in enumerate(rows):
            row["status"] = self._status_from_score(row["score"], index, row["confidence"])

        primary = rows[0] if rows else None
        supporting = [row for row in rows[1:] if row["status"] in {"Supporting", "Weak Signal"}][:3]
        profile = profile_payload.get("profile") or {}
        metadata = profile.get("metadata") or {}
        limitations = profile_payload.get("data_limitations") or []
        score_value = round((primary.get("score") or 0.0) * 100) if primary else 0

        return {
            "analysis_mode": mode,
            "summary_bar": {
                "primary_typology": primary.get("typology_name") if primary else "Assessment Pending",
                "confidence_level": primary.get("confidence") if primary else "Limited Evidence",
                "supporting_typologies": ", ".join(item["typology_name"] for item in supporting) if supporting else "No material supporting typologies",
                "typology_risk_score": score_value,
                "evidence_strength": primary.get("evidence_strength") if primary else "Limited",
                "coverage_note": limitations[0] if limitations else "Assessment is based on available structured case data.",
            },
            "primary_typology": primary,
            "supporting_typologies": supporting,
            "typology_rows": rows,
            "typology_risk_score": score_value,
            "overall_assessment": (
                f"Visible case behavior aligns most strongly to {primary['typology_name']} with {primary['confidence'].lower()} confidence."
                if primary and primary["status"] == "Primary"
                else f"{primary['typology_name']} is the strongest visible pattern, but the signal remains supporting rather than conclusive."
                if primary and primary["status"] == "Supporting"
                else f"{primary['typology_name']} is currently the strongest weak signal, but additional corroboration is required."
                if primary
                else "Current evidence does not yet support a strong typology conclusion."
            ),
            "case_snapshot": {
                "case_id": profile_payload.get("case_id"),
                "customer": metadata.get("customer_name") or metadata.get("customer_id") or "Customer",
                "customer_id": metadata.get("customer_id") or "-",
                "account_id": metadata.get("account_id") or "-",
                "alert_count": int(profile_payload.get("raw_features", {}).get("alert_count") or 0),
                "total_suspicious_amount": round(float(profile_payload.get("raw_features", {}).get("total_suspicious_amount") or 0), 2),
                "risk_score": metadata.get("risk_score") or 0,
                "status": metadata.get("outcome_status") or "Open",
                "assigned_analyst": metadata.get("assigned_to") or "Analyst",
                "linked_entities": int(profile_payload.get("graph_support", {}).get("hub_count", 0) + profile_payload.get("graph_support", {}).get("bridge_count", 0)),
                "severity": metadata.get("severity") or "-",
            },
            "data_quality": {
                "limitations": limitations,
                "evidence_count": sum(len(row.get("evidence") or []) for row in rows),
            },
        }
