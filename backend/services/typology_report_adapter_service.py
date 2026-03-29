from typing import Any, Dict


class TypologyReportAdapterService:
    def to_report_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        payload = payload or {}
        primary = payload.get("primary_typology") or {}
        supporting = payload.get("supporting_typologies") or []
        explanation = payload.get("summary_sections") or {}
        guidance = payload.get("investigator_guidance") or {}
        return {
            "primary_typology": primary.get("typology_name") or "Assessment Pending",
            "supporting_typologies": [item.get("typology_name") for item in supporting if item.get("typology_name")],
            "typology_scores": [
                {
                    "typology_name": item.get("typology_name"),
                    "score": item.get("score"),
                    "confidence": item.get("confidence"),
                    "status": item.get("status"),
                }
                for item in (payload.get("typology_rows") or [])
            ],
            "typology_explanation": explanation.get("why_detected") or explanation.get("assessment_overview") or "",
            "supporting_evidence": explanation.get("key_evidence_and_signals") or [],
            "investigator_guidance": guidance.get("what_to_verify") or [],
            "confidence_note": (explanation.get("confidence_and_limitations") or [""])[0],
            "limitations_note": payload.get("limitations_note") or "",
            "report_snippets": payload.get("report_snippets") or [],
        }
