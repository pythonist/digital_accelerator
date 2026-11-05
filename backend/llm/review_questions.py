# backend/llm/review_questions.py
import re

class ReviewQuestionsGenerator:
    """
    Generates critical review/regulator-style challenge questions based on empirical case facts.
    STRICT RULES: Questions only, no answers or evaluations. No dollar signs ($).
    """
    
    def __init__(self, llm_provider):
        self.ollama = llm_provider
    
    def generate_review_questions(self, case_summary, model="gpt-4o-mini"):
        """
        Generate 5-7 critical review questions grounded in the case telemetry.
        """
        if not self.ollama or not self.ollama.check_connection():
            return ["AI service unavailable"]
        
        if "error" in case_summary:
            return [f"Cannot generate questions: {case_summary['error']}"]
        
        case_id = case_summary.get("case_id", "Unknown")
        alert_type = case_summary.get("alert_type", "Unknown")
        metrics = case_summary.get("key_metrics", {})
        reasons = case_summary.get("why_triggered", [])
        cust = case_summary.get("customer_profile", {})
        counterparties = case_summary.get("top_counterparties", [])

        vol = float(metrics.get('total_volume') or 0)
        txn_cnt = metrics.get('transaction_count', 0)
        
        system_prompt = """You are a Senior Regulatory Examiner (OCC, FinCEN, RBI, FCA) conducting an AML audit.

CRITICAL RULES:
1. Generate CHALLENGE QUESTIONS ONLY - no answers.
2. Ground every question in the SPECIFIC numbers, customer details, and transaction volume provided.
3. Do NOT use dollar signs ($). Format numbers as exact values (e.g. 271,586.91).
4. Questions should probe evidence completeness, legitimacy of counterparties, source of wealth, and justification for filing/closing.
5. Format: Return ONLY a clean numbered list (1. to 5.), one per line."""

        cp_names = ", ".join([cp.get('name') for cp in counterparties[:3]]) if counterparties else "none recorded"

        user_prompt = f"""Formulate 5 sharp, auditor-grade examination challenge questions for this case.

**CASE FACTS:**
- **Case ID:** {case_id}
- **Primary Alert:** {alert_type}
- **Entity:** {cust.get('customer_name', 'N/A')} ({cust.get('segment', 'Commercial')} | Country: {cust.get('country', 'N/A')})
- **Transaction Activity:** {txn_cnt} transactions totaling {vol:,.2f}
- **Key Counterparties:** {cp_names}
- **Triggers:** {'; '.join(reasons)}

Return 5 numbered questions that challenge the compliance investigator's rationale."""

        try:
            response = self.ollama.generate(
                prompt=user_prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=0.4,
                max_tokens=500,
            )
            
            text = response.get('response', '')
            
            questions = []
            for line in text.split('\n'):
                line = line.strip()
                match = re.match(r'^[\d\-\*]+[\.\)]\s*(.+)$', line)
                if match:
                    questions.append(match.group(1).strip())
                elif line and not re.match(r'^\d+$', line) and len(line) > 15:
                    questions.append(line)
            
            return questions[:6] if questions else ["What is the verified commercial rationale for the aggregated transaction volume?"]
        
        except Exception as e:
            return [f"Error: {str(e)}"]
