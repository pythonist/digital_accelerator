# backend/llm/review_questions.py

class ReviewQuestionsGenerator:
    """
    Generates critical review/regulator-style questions.
    STRICT RULES: Questions only, no answers or evaluations.
    """
    
    def __init__(self, llm_provider):
        self.ollama = llm_provider
    
    def generate_review_questions(self, case_summary, model="gpt-4o-mini"):
        """
        Generate 5-7 critical review questions.
        
        Args:
            case_summary: Structured dict from CaseSummaryBuilder
            model: LLM model to use
        
        Returns:
            list: List of question strings
        """
        
        if not self.ollama or not self.ollama.check_connection():
            return ["AI service unavailable"]
        
        if "error" in case_summary:
            return [f"Cannot generate questions: {case_summary['error']}"]
        
        case_id = case_summary.get("case_id", "Unknown")
        alert_type = case_summary.get("alert_type", "Unknown")
        metrics = case_summary.get("key_metrics", {})
        reasons = case_summary.get("why_triggered", [])
        
        system_prompt = """You are a Senior Compliance Officer conducting case review.

CRITICAL RULES:
1. Generate QUESTIONS ONLY - no answers
2. Do NOT evaluate correctness
3. Do NOT suggest compliance actions
4. Do NOT introduce facts not in the data
5. Questions should be challenging and regulatory-focused

Generate questions a regulator or senior reviewer would ask."""

        user_prompt = f"""Generate 5-7 critical review questions for this AML case.

**Case ID:** {case_id}
**Alert Type:** {alert_type}

**Triggers:**
{chr(10).join(f'- {r}' for r in reasons)}

**Metrics:**
- Alerts: {metrics.get('alert_count', 0)} ({metrics.get('critical_alerts', 0)} critical)
- Transactions: {metrics.get('transaction_count', 0)}
- Volume: ${metrics.get('total_volume', 0):,.2f}

Generate questions that probe:
1. Evidence adequacy
2. Pattern explanation
3. Customer due diligence
4. Regulatory compliance considerations
5. Investigation completeness

Format: Return ONLY a numbered list of questions, one per line.
Example:
1. What is the source of funds for the flagged transactions?
2. Has enhanced due diligence been performed on this customer?
etc."""

        try:
            response = self.ollama.generate(
                prompt=user_prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=0.4,
                max_tokens=220,
            )
            
            text = response.get('response', '')
            
            # Parse numbered list
            import re
            questions = []
            for line in text.split('\n'):
                line = line.strip()
                # Match "1." or "1)" or "-" prefixed lines
                match = re.match(r'^[\d\-\*]+[\.\)]\s*(.+)$', line)
                if match:
                    questions.append(match.group(1).strip())
                elif line and not re.match(r'^\d+$', line):  # Skip standalone numbers
                    questions.append(line)
            
            return questions[:7] if questions else ["Unable to generate questions"]
        
        except Exception as e:
            return [f"Error: {str(e)}"]
