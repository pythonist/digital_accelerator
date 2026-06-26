# backend/llm/explain_case.py
import json

class CaseExplainer:
    """
    LLM helper for generating analyst-style explanations.
    STRICT RULES: Uses only provided data, no decisions.
    """
    
    def __init__(self, llm_provider):
        self.ollama = llm_provider
    
    def explain_case(self, case_summary, model="gpt-4o-mini"):
        """
        Generate analyst-style explanation from case summary.
        
        Args:
            case_summary: Structured dict from CaseSummaryBuilder
            model: LLM model to use
        
        Returns:
            str: Analyst-style explanation text
        """
        
        if not self.ollama or not self.ollama.check_connection():
            return "AI service unavailable. Configure the local AI provider first."
        
        # Validate input
        if "error" in case_summary:
            return f"Cannot explain case: {case_summary['error']}"
        
        case_id = case_summary.get("case_id", "Unknown")
        alert_type = case_summary.get("alert_type", "Unknown")
        metrics = case_summary.get("key_metrics", {})
        reasons = case_summary.get("why_triggered", [])
        recommendation = case_summary.get("system_recommendation", "REVIEW_REQUIRED")
        
        # Build structured prompt
        system_prompt = """You are a Senior AML Investigator Assistant.

CRITICAL RULES:
1. Use ONLY the provided case data
2. Do NOT invent facts or numbers
3. Do NOT suggest compliance decisions
4. Do NOT override system recommendations
5. Write in professional, analytical tone
6. Focus on WHAT the data shows, not WHAT TO DO

Your role: Explain the case facts in clear, analyst-appropriate language."""

        user_prompt = f"""Analyze this AML case and provide a professional explanation.

**Case ID:** {case_id}
**Alert Type:** {alert_type}
**System Recommendation:** {recommendation}

**Why Flagged:**
{chr(10).join(f'- {r}' for r in reasons)}

**Key Metrics:**
- Alert Count: {metrics.get('alert_count', 0)}
- Critical Alerts: {metrics.get('critical_alerts', 0)}
- Transaction Count: {metrics.get('transaction_count', 0)}
- Total Volume: ${metrics.get('total_volume', 0):,.2f}
- Max Transaction: ${metrics.get('max_transaction', 0):,.2f}
- Alert Day Average: ${metrics.get('alert_day_avg', 0):,.2f}
- Baseline Average: ${metrics.get('baseline_avg', 0):,.2f}

Write a concise 2-3 paragraph explanation of what the data shows. Focus on:
1. What patterns are present
2. Why the system flagged this
3. What the metrics indicate

Do NOT suggest actions or decisions."""

        try:
            response = self.ollama.generate(
                prompt=user_prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=0.3,
                max_tokens=260,
            )
            
            return response.get('response', 'Failed to generate explanation.')
        
        except Exception as e:
            return f"Error generating explanation: {str(e)}"
