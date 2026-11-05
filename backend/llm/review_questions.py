# backend/llm/review_questions.py
import os
import re
from typing import Any, Dict, List, Optional


class ReviewQuestionsGenerator:
    """
    Generates critical review/regulator-style challenge questions based on empirical case facts.
    STRICT RULES: Questions only, no answers or evaluations. No dollar signs ($).
    """

    def __init__(self, llm_provider):
        self.llm_provider = llm_provider

    def generate_review_questions(self, case_summary: Dict[str, Any], model: Optional[str] = None) -> List[str]:
        """
        Generate 5-7 critical review questions grounded in the case telemetry.
        """
        if not self.llm_provider:
            return ["AI service unavailable. LLM provider not configured."]

        try:
            if hasattr(self.llm_provider, "check_connection") and not self.llm_provider.check_connection():
                return ["AI service unavailable. Connection check failed."]
        except Exception:
            return ["AI service unavailable. Connection check failed."]

        if not isinstance(case_summary, dict) or "error" in case_summary:
            err = case_summary.get("error") if isinstance(case_summary, dict) else "Invalid summary"
            return [f"Cannot generate questions: {err}"]

        case_id = case_summary.get("case_id", "Unknown")
        alert_type = case_summary.get("alert_type", "Unknown")
        metrics = case_summary.get("key_metrics", {})
        reasons = case_summary.get("why_triggered", [])
        cust = case_summary.get("customer_profile", {})
        counterparties = case_summary.get("top_counterparties", [])

        vol = float(metrics.get("total_volume") or 0)
        txn_cnt = metrics.get("transaction_count", 0)

        system_prompt = """You are a Senior Regulatory Examiner (OCC, FinCEN, RBI, FCA) conducting an AML audit.

CRITICAL RULES:
1. Generate CHALLENGE QUESTIONS ONLY - no answers.
2. Ground every question in the SPECIFIC numbers, customer details, and transaction volume provided.
3. Do NOT use dollar signs ($). Format numbers as exact values (e.g. 271,586.91).
4. Questions should probe evidence completeness, legitimacy of counterparties, source of wealth, and justification for filing/closing.
5. Format: Return ONLY a clean numbered list (1. to 5.), one per line."""

        cp_names = ", ".join([cp.get("name") for cp in counterparties[:3]]) if counterparties else "none recorded"

        user_prompt = f"""Formulate 5 sharp, auditor-grade examination challenge questions for this case.

**CASE FACTS:**
- **Case ID:** {case_id}
- **Primary Alert:** {alert_type}
- **Entity:** {cust.get('customer_name', 'N/A')} ({cust.get('segment', 'Commercial')} | Country: {cust.get('country', 'N/A')})
- **Transaction Activity:** {txn_cnt} transactions totaling {vol:,.2f}
- **Key Counterparties:** {cp_names}
- **Triggers:** {'; '.join(reasons)}

Return 5 numbered questions that challenge the compliance investigator's rationale."""

        chosen_model = model or getattr(self.llm_provider, "default_model", None) or os.getenv("OPENAI_MODEL")

        try:
            response = self.llm_provider.generate(
                prompt=user_prompt,
                model=chosen_model,
                system_prompt=system_prompt,
            )

            if not isinstance(response, dict) or not response.get("success"):
                err = (response or {}).get("error") if isinstance(response, dict) else "Unknown failure"
                return [f"Error: {err}"]

            text = str(response.get("response") or response.get("text") or "").strip()
            if not text:
                return ["Error: LLM returned no content"]

            questions = []
            for line in text.split("\n"):
                line = line.strip()
                match = re.match(r"^[\d\-\*]+[\.\)]\s*(.+)$", line)
                if match:
                    questions.append(match.group(1).strip())
                elif line and not re.match(r"^\d+$", line) and len(line) > 15:
                    questions.append(line)

            return questions[:6] if questions else ["What is the verified commercial rationale for the aggregated transaction volume?"]

        except Exception as e:
            return [f"Error: {str(e)}"]
