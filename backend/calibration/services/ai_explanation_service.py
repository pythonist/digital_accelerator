# backend/calibration/services/ai_explanation_service.py
"""
AI Explanation Service
Generates natural language explanations for calibration decisions
Uses Ollama for local LLM inference
"""
import json
class AIExplanationService:
    """Generates AI explanations for report sections"""
    
    def __init__(self, ollama_wrapper=None):
        self.llm = ollama_wrapper
        self.enabled = ollama_wrapper is not None
    def _generate(self, prompt, context_data=None):
        """Helper to safely execute LLM generation"""
        if not self.enabled:
            return None
        
        try:
            # If context data is provided, append it to the prompt
            full_prompt = prompt
            if context_data:
                # Sanitize data to avoid token limits if necessary
                full_prompt = f"{prompt}\n\nCONTEXT DATA:\n{json.dumps(context_data, indent=2, default=str)}"

            result = self.llm.generate(
                prompt=full_prompt,
                temperature=0.3,
                max_tokens=250
            )
            
            return result.get('response', '') if result.get('success') else None
        except Exception as e:
            print(f"⚠️ AI Generation failed: {e}")
            return None
    def explain_data_foundation(self, data_stats):
        """Explain data foundation and quality"""
        if not self.enabled:
            return None
        
        prompt = f"""Explain the data foundation for this AML calibration in 2-3 sentences:

- {data_stats.get('total_transactions', 0):,} transactions loaded
- Account match rate: {data_stats.get('account_match_rate', 0)}%
- Customer match rate: {data_stats.get('customer_match_rate', 0)}%

Focus on: data quality implications and why join rates matter for calibration accuracy.
Keep it professional and concise."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=200
        )
        
        return result.get('response', '') if result.get('success') else None
    
    def explain_filter_strategy(self, scenario_analysis):
        """Explain why filters were applied"""
        if not self.enabled:
            return None
        
        original = scenario_analysis.get('original_count', 0)
        final = scenario_analysis.get('final_count', 0)
        reduction = scenario_analysis.get('reduction_pct', 0)
        
        prompt = f"""Explain this AML scenario filtering strategy in 2-3 sentences:

Population reduced from {original:,} to {final:,} transactions ({reduction}% reduction).
Filters: {scenario_analysis.get('logic_summary', 'N/A')}

Focus on: why filtering is necessary for effective calibration and risk focus.
Keep it professional and regulatory-focused."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=200
        )
        
        return result.get('response', '') if result.get('success') else None
    
    def explain_aggregation_logic(self, aggregation_analysis):
        """Explain aggregation transformation"""
        if not self.enabled:
            return None
        
        level = aggregation_analysis.get('aggregation_level', 'account')
        lookback = aggregation_analysis.get('lookback_days', 90)
        input_rows = aggregation_analysis.get('input_rows', 0)
        output_rows = aggregation_analysis.get('output_rows', 0)
        
        prompt = f"""Explain this AML aggregation strategy in 2-3 sentences:

- Level: {level.upper()}
- Lookback: {lookback} days
- Transformation: {input_rows:,} transactions → {output_rows:,} behavioral aggregates

Focus on: why aggregation is critical for detecting behavioral patterns vs individual transactions.
Keep it professional and explain the risk detection value."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=200
        )
        
        return result.get('response', '') if result.get('success') else None
    
    def explain_threshold_selection(self, threshold_analysis):
        """Explain threshold calibration decision"""
        if not self.enabled:
            return None
        
        threshold = threshold_analysis.get('selected_threshold', 0)
        percentile = threshold_analysis.get('selected_percentile', 0)
        alerts = threshold_analysis.get('estimated_alerts', 0)
        pct_flagged = threshold_analysis.get('pct_flagged', 0)
        
        prompt = f"""Explain this AML threshold selection in 2-3 sentences:

Selected: ₹{threshold:,} ({percentile}th percentile)
Impact: {alerts:,} alerts/month ({pct_flagged}% of population)

Focus on: why this threshold balances risk coverage with operational workload.
Explain what percentile-based calibration means for regulators.
Keep it professional and audit-focused."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=250
        )
        
        return result.get('response', '') if result.get('success') else None

    # ✅ ADD THIS METHOD
    def explain_ks_statistics(self, data):
        """Explain KS Statistics (Statistical Separation)"""
        prompt = """
        Act as a Quantitative Risk Analyst. Interpret the Kolmogorov-Smirnov (KS) statistic 
        calculated for this AML threshold calibration.

        Data Provided:
        - KS Statistic (0 to 1 score)
        - P-Value (significance)
        - Interpretation (Weak/Moderate/Strong)

        Your goal:
        Explain whether the selected threshold successfully separates the "alerted" population 
        from the "normal" population. 
        - If KS > 0.4, emphasize the strong statistical validity.
        - If KS < 0.2, suggest that the threshold might need refinement.
        
        Keep it under 80 words. Focus on "statistical discriminative power".
        """
        return self._generate(prompt, data)

    # ✅ ADD THIS METHOD
    def explain_atl_btl_analysis(self, data):
        """Explain ATL/BTL (Above/Below the Line) Analysis"""
        prompt = """
        Act as an AML Operations Manager. Analyze the "Below-the-Line" (BTL) testing results 
        to justify why the threshold should NOT be lowered.

        Data Provided:
        - Current Threshold (ATL)
        - BTL Band (e.g., 10% below threshold)
        - Count of entities in BTL zone
        - Percentage increase in workload if lowered

        Your goal:
        Argue that lowering the threshold would result in a significant increase in false positive 
        workload (noise) without a proportional capture of high-risk behavior. 
        Use the term "diminishing returns" or "operational strain".

        Keep it under 80 words.
        """
        return self._generate(prompt, data)
    
    def explain_governance_decision(self, governance_data):
        """Explain approval decision"""
        if not self.enabled:
            return None
        
        status = governance_data.get('status', 'draft')
        comment = governance_data.get('approval_comment', 'No comment provided')
        
        if status != 'approved':
            return None
        
        prompt = f"""Explain the significance of this approval in 2 sentences:

Status: APPROVED
Approver's comment: "{comment}"

Focus on: what approval means for deployment and regulatory compliance.
Keep it brief and professional."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=150
        )
        
        return result.get('response', '') if result.get('success') else None
    
    def generate_executive_summary(self, report_data):
        """Generate AI-powered executive summary"""
        if not self.enabled:
            return None
        
        threshold = report_data.get('threshold_analysis', {}).get('selected_threshold', 0)
        percentile = report_data.get('threshold_analysis', {}).get('selected_percentile', 0)
        alerts = report_data.get('threshold_analysis', {}).get('estimated_alerts', 0)
        scenario = report_data.get('meta', {}).get('scenario', 'Unknown')
        
        prompt = f"""Generate a professional executive summary (3-4 sentences) for this AML calibration:

Scenario: {scenario}
Threshold: ₹{threshold:,} ({percentile}th percentile)
Expected Alerts: {alerts:,} per month

The summary should:
1. State the calibration outcome
2. Explain the business value
3. Confirm regulatory readiness

Keep it executive-level, professional, and confidence-inspiring."""

        result = self.llm.generate(
            prompt=prompt,
            temperature=0.3,
            max_tokens=300
        )
        
        return result.get('response', '') if result.get('success') else None