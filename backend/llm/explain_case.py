# backend/llm/explain_case.py
import os
from typing import Any, Dict, Optional


class CaseExplainer:
    """
    LLM helper for generating analyst-style explanations.
    STRICT RULES: Uses grounded empirical case telemetry, no decisions.
    """

    def __init__(self, llm_provider):
        self.llm_provider = llm_provider

    def explain_case(self, case_summary: Dict[str, Any], model: Optional[str] = None) -> str:
        """
        Generate analyst-style explanation from case summary.

        Args:
            case_summary: Structured dict from CaseSummaryBuilder
            model: LLM model to use (resolves to OPENAI_MODEL by default)

        Returns:
            str: Analyst-style explanation text
        """
        if not self.llm_provider:
            return "AI service unavailable. Please ensure your LLM provider is active."

        try:
            if hasattr(self.llm_provider, "check_connection") and not self.llm_provider.check_connection():
                return "AI service unavailable. Please ensure your LLM provider is active."
        except Exception:
            return "AI service unavailable. Connection check failed."

        if not isinstance(case_summary, dict) or "error" in case_summary:
            err = case_summary.get("error") if isinstance(case_summary, dict) else "Invalid summary"
            return f"Cannot explain case: {err}"

        case_id = case_summary.get("case_id", "Unknown")
        alert_type = case_summary.get("alert_type", "Unknown")
        metrics = case_summary.get("key_metrics", {})
        reasons = case_summary.get("why_triggered", [])
        recommendation = case_summary.get("system_recommendation", "REVIEW_REQUIRED")
        cust = case_summary.get("customer_profile", {})
        counterparties = case_summary.get("top_counterparties", [])
        typologies = case_summary.get("typology_signals", [])

        vol = float(metrics.get("total_volume") or 0)
        max_txn = float(metrics.get("max_transaction") or 0)
        base_avg = float(metrics.get("baseline_avg") or 0)
        inflow = float(metrics.get("inflow_credits") or 0)
        outflow = float(metrics.get("outflow_debits") or 0)

        system_prompt = """You are a Senior AML Compliance & Forensic Financial Intelligence Analyst.

CRITICAL RULES:
1. Ground every statement in the PROVIDED case data. Cite exact transaction counts, total amounts, counterparties, and timestamps.
2. Do NOT invent facts or hallucinate zero values if metrics are provided.
3. Do NOT use currency signs ($). Format all numbers as exact numeric values (e.g. 271,586.91).
4. Do NOT dictate final regulatory filing decisions (e.g. "You must file a SAR"). Frame findings objectively: "The evidence highlights [pattern] which requires analyst determination on [risk factor]."
5. Write in structured markdown with headings, bold key figures, and bullet points. Focus on:
   - Case Snapshot & Alert Genesis
   - Transaction Flow & Velocity Breakdown (Credits vs Debits, Peak Amounts)
   - Counterparty & Typology Exposure
   - Objective Assessment & Audit Defensibility"""

        cp_text = (
            "\n".join([f"- Counterparty {cp.get('name')}: Volume {cp.get('volume', 0):,.2f}" for cp in counterparties[:5]])
            if counterparties
            else "- No significant external counterparty concentration recorded."
        )
        typo_text = ", ".join(typologies) if typologies else "No active automated typology triggers"

        user_prompt = f"""Analyze this AML case and generate an exhaustive, professional investigative narrative.

**CASE TELEMETRY DATA:**
- **Case ID:** {case_id}
- **Primary Alert Typology:** {alert_type}
- **Customer Entity:** {cust.get('customer_name', 'N/A')} ({cust.get('segment', 'Commercial')} | Country: {cust.get('country', 'N/A')} | KYC Completeness: {cust.get('kyc_completeness_pct', '100')}%)
- **System Recommendation:** {recommendation}

**TRIGGER FACTORS:**
{chr(10).join(f'- {r}' for r in reasons)}

**EMPIRICAL KEY METRICS:**
- Alert Count: {metrics.get('alert_count', 0)} ({metrics.get('critical_alerts', 0)} High/Critical)
- Total Transaction Count: {metrics.get('transaction_count', 0)}
- Aggregate Volume: {vol:,.2f}
- Peak Single Transaction: {max_txn:,.2f}
- Baseline Average Transaction: {base_avg:,.2f}
- Total Inflow (Credits): {inflow:,.2f}
- Total Outflow (Debits): {outflow:,.2f}

**COUNTERPARTY CONCENTRATION:**
{cp_text}

**ACTIVE TYPOLOGY SIGNALS:**
{typo_text}

Synthesize these exact facts into a clean 3-4 section markdown report with subheadings (###). Cite the real metrics above without truncation."""

        chosen_model = model or getattr(self.llm_provider, "default_model", None) or os.getenv("OPENAI_MODEL")

        try:
            response = self.llm_provider.generate(
                prompt=user_prompt,
                model=chosen_model,
                system_prompt=system_prompt,
            )

            if isinstance(response, dict) and response.get("success"):
                content = str(response.get("response") or response.get("text") or "").strip()
                if content:
                    return content
                return "Failed to generate explanation: Empty response from LLM."
            err = (response or {}).get("error") if isinstance(response, dict) else "Unknown failure"
            return f"Failed to generate explanation: {err}"

        except Exception as e:
            return f"Error generating explanation: {str(e)}"
