# backend/calibration/services/calibration_ks_narrative_service.py
"""
KS Narrative Service - FIXED VERSION
====================================
Generates realistic, investigator-grade explanations for KS statistics.

CRITICAL FIX: Updated narratives to reflect realistic KS ranges for financial data.
"""


class CalibrationKSNarrativeService:
    """
    Translates KS statistics into clear, actionable explanations.
    Now uses realistic thresholds for financial transaction data.
    """
    
    @staticmethod
    def generate_ks_explanation(ks_result):
        """
        Generate human-readable KS interpretation with realistic expectations.
        
        Returns:
            {
                'headline': str,
                'explanation': str,
                'recommendation': str,
                'technical_note': str
            }
        """
        ks_stat = ks_result.get('ks_statistic')
        interpretation = ks_result.get('interpretation')
        threshold = ks_result.get('threshold')
        populations = ks_result.get('populations', {})
        
        if interpretation == 'insufficient_data':
            return {
                'headline': 'Insufficient Data',
                'explanation': 'Not enough entities in one or both populations to compute KS statistic reliably.',
                'recommendation': 'Adjust threshold to increase population sizes, or use percentile analysis.',
                'technical_note': 'KS requires at least 10 entities in each population.'
            }
        
        # FIXED: Realistic narratives for financial data
        narratives = {
            'weak': {
                'headline': f'Weak Separation (KS = {ks_stat:.3f})',
                'explanation': (
                    f'The alerted and suppressed populations show minimal structural difference. '
                    f'Entities just above the threshold of ₹{threshold:,.0f} behave very similarly to '
                    f'entities just below it. This threshold may not be effectively isolating a distinct '
                    f'risk cohort from the broader population.'
                ),
                'recommendation': (
                    'Consider testing higher percentiles or reviewing your aggregation strategy. '
                    'A KS value above 0.15 would indicate better separation. In financial data, '
                    'some overlap is normal, but this threshold shows very little differentiation.'
                ),
                'technical_note': f'KS < 0.15 indicates minimal distributional difference. This is common when thresholds are too low or aggregation periods are too short.'
            },
            'moderate': {
                'headline': f'Moderate Separation (KS = {ks_stat:.3f})',
                'explanation': (
                    f'The threshold creates noticeable structural difference between populations. '
                    f'Entities above ₹{threshold:,.0f} show detectably different behavioral patterns '
                    f'compared to those below. This represents functional separation, though not dramatic.'
                ),
                'recommendation': (
                    'This level of separation is workable for production use. The threshold is capturing '
                    'a behaviorally distinct cohort. Review the percentile ladder to see if nearby '
                    'thresholds offer incrementally better KS values (target: 0.35+).'
                ),
                'technical_note': f'KS 0.15-0.35 suggests moderate distributional divergence. This is typical for well-calibrated thresholds in financial surveillance.'
            },
            'strong': {
                'headline': f'Strong Separation (KS = {ks_stat:.3f})',
                'explanation': (
                    f'The threshold creates clear structural separation between populations. '
                    f'Entities above ₹{threshold:,.0f} form a distinctly different behavioral cohort '
                    f'from those below. This indicates the threshold successfully isolates a high-risk '
                    f'segment with measurably different transaction patterns.'
                ),
                'recommendation': (
                    'This is strong evidence of meaningful segmentation. This KS value indicates '
                    'excellent threshold calibration for financial data. Combine with entity impact '
                    'analysis and operational capacity assessment for final decision.'
                ),
                'technical_note': f'KS 0.35-0.60 indicates substantial distributional difference. This represents high-quality separation in financial contexts.'
            },
            'very_strong': {
                'headline': f'Excellent Separation (KS = {ks_stat:.3f})',
                'explanation': (
                    f'The threshold creates exceptional structural separation. The alerted population '
                    f'is highly distinct from the suppressed population, suggesting ₹{threshold:,.0f} '
                    f'identifies a fundamentally different risk profile. KS values above 0.60 are rare '
                    f'in financial data and indicate very strong behavioral differentiation.'
                ),
                'recommendation': (
                    'This is excellent separation quality - rare in financial surveillance contexts. '
                    'Verify this threshold aligns with operational capacity and regulatory coverage goals. '
                    'Such high KS values sometimes indicate data quality issues or overly aggressive '
                    'thresholds, so validate entity-level impact carefully.'
                ),
                'technical_note': f'KS > 0.60 indicates populations are highly divergent. Note: KS above 0.70 in financial data is extremely rare and should prompt data quality verification.'
            }
        }
        
        return narratives.get(interpretation, narratives['weak'])
    
    @staticmethod
    def generate_comparison_narrative(ks_sensitivity_data):
        """
        Generate narrative for KS sensitivity across percentiles.
        """
        curve = ks_sensitivity_data.get('sensitivity_curve', [])
        optimal = ks_sensitivity_data.get('optimal_separation')
        
        if not curve:
            return {
                'summary': 'Insufficient data for KS sensitivity analysis.',
                'optimal_range': None,
                'insights': []
            }
        
        max_ks = max([p['ks_statistic'] for p in curve])
        min_ks = min([p['ks_statistic'] for p in curve])
        
        # FIXED: Use realistic thresholds for "strong"
        strong_count = len([p for p in curve if p['ks_statistic'] >= 0.35])
        
        insights = []
        
        if max_ks >= 0.35:
            insights.append(
                f'Peak separation occurs at p{optimal["percentile"]} (KS = {optimal["ks_statistic"]:.3f}), '
                f'indicating this percentile creates the clearest behavioral distinction.'
            )
        
        if max_ks - min_ks > 0.2:
            insights.append(
                'KS varies significantly across percentiles, suggesting threshold placement '
                'has substantial impact on population separation quality.'
            )
        
        if strong_count >= 3:
            insights.append(
                f'{strong_count} percentiles show strong separation (KS ≥ 0.35), '
                f'providing flexibility in threshold selection.'
            )
        elif strong_count == 0:
            insights.append(
                'No percentile achieves strong separation (KS ≥ 0.35). Consider alternative '
                'aggregation strategies, longer lookback periods, or feature engineering.'
            )
        
        if optimal:
            summary = (
                f'Optimal KS separation found at p{optimal["percentile"]} '
                f'(threshold: ₹{optimal["threshold"]:,.0f}, KS: {optimal["ks_statistic"]:.3f}). '
                f'This percentile maximizes the structural difference between alerted and suppressed populations.'
            )
        else:
            summary = 'No clear optimal separation point identified.'
        
        return {
            'summary': summary,
            'optimal_range': f'p{optimal["percentile"] - 2} - p{optimal["percentile"] + 2}' if optimal else None,
            'insights': insights,
            'max_ks': round(max_ks, 3),
            'min_ks': round(min_ks, 3)
        }
    
    @staticmethod
    def generate_str_context_narrative(ks_result_with_str):
        """
        Generate interpretation combining KS + STR overlay.
        """
        ks_stat = ks_result_with_str.get('ks_statistic')
        interpretation = ks_result_with_str.get('interpretation')
        str_overlay = ks_result_with_str.get('str_overlay', {})
        
        capture_rate = str_overlay.get('capture_rate', 0)
        captured_strs = str_overlay.get('captured_strs', 0)
        total_strs = str_overlay.get('total_strs', 0)
        
        if total_strs == 0:
            str_note = 'No STR data available for this period.'
        else:
            str_note = (
                f'Of {total_strs} known STRs in the analysis period, {captured_strs} ({capture_rate:.1f}%) '
                f'would have been captured above this threshold. This provides regulatory outcome context '
                f'but does NOT influence the KS statistic, which is computed purely from aggregated '
                f'transaction behavior.'
            )
        
        return {
            'ks_interpretation': CalibrationKSNarrativeService.generate_ks_explanation(ks_result_with_str),
            'str_context': str_note,
            'combined_assessment': (
                f'KS separation is {interpretation} ({ks_stat:.3f}). '
                f'STR capture rate of {capture_rate:.1f}% provides regulatory outcome context. '
                f'Threshold selection should balance distributional separation quality with '
                f'operational capacity and regulatory coverage requirements.'
            )
        }