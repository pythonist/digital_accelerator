# backend/calibration/services/aggregation_narrative_service.py
"""
Aggregation Narrative Service
Auto-generates human-readable explanations
"""

class AggregationNarrativeService:
    """Generate investigator-friendly explanations"""
    
    @staticmethod
    def generate_intent_narrative(config):
        """Generate aggregation intent explanation"""
        level = config.get('level', 'account')
        lookback = config.get('lookback_value', 30)
        unit = config.get('lookback_unit', 'days')
        freq = config.get('frequency', 'daily')
        metrics = config.get('metrics', [])
        filter_history = config.get('filter_history', True)
        
        # Entity description
        entity_desc = "account-level" if level == 'account' else "customer-level"
        
        # Time window description
        time_desc = f"{lookback}-{unit}"
        
        # Frequency description
        freq_map = {
            'daily': 'daily snapshots',
            'weekly': 'weekly snapshots',
            'monthly': 'monthly snapshots'
        }
        freq_desc = freq_map.get(freq, 'periodic snapshots')
        
        # Metrics description
        metric_desc = []
        if 'sum_amount' in metrics:
            metric_desc.append("total transaction value")
        if 'avg_amount' in metrics:
            metric_desc.append("average transaction size")
        if 'count' in metrics or 'velocity' in metrics:
            metric_desc.append("transaction frequency")
        metric_str = ", ".join(metric_desc) if metric_desc else "transaction patterns"
        
        # Filter description
        filter_desc = "matching Step 1 criteria" if filter_history else "across all transaction types"
        
        # Build narrative
        narrative = (
            f"This aggregation summarizes behavior at the {entity_desc}, "
            f"using a {time_desc} rolling window to compute {metric_str}. "
            f"The output produces {freq_desc}, aggregating transactions {filter_desc}."
        )
        
        return narrative
    
    @staticmethod
    def generate_use_case_hint(config):
        """Suggest typical use cases"""
        lookback = config.get('lookback_value', 30)
        unit = config.get('lookback_unit', 'days')
        metrics = config.get('metrics', [])
        
        hints = []
        
        # Short lookback
        if unit == 'days' and lookback <= 7:
            hints.append("Short windows (≤7 days) are useful for detecting rapid structuring or burst activity.")
        
        # Medium lookback
        if unit == 'days' and 7 < lookback <= 30:
            hints.append("Medium windows (7-30 days) balance responsiveness with stability, ideal for behavioral baselines.")
        
        # Long lookback
        if (unit == 'days' and lookback > 90) or unit == 'months':
            hints.append("Long windows (>90 days) smooth short-term noise but may miss recent behavioral shifts.")
        
        # Velocity focus
        if 'count' in metrics or 'velocity' in metrics:
            hints.append("Transaction count/velocity metrics help identify structuring and smurfing patterns.")
        
        return hints
    
    @staticmethod
    def generate_warnings(config, stats):
        """Generate configuration warnings"""
        warnings = []
        
        # High compression
        compression = stats.get('compression_ratio', 0)
        if compression > 50:
            warnings.append({
                'type': 'high_compression',
                'message': f"Compression ratio of {compression}x is very high. Consider reviewing time grain or frequency.",
                'severity': 'info'
            })
        
        # Low compression
        if compression < 2 and compression > 0:
            warnings.append({
                'type': 'low_compression',
                'message': f"Compression ratio of {compression}x is low. Output may be too granular for effective calibration.",
                'severity': 'info'
            })
        
        # Long lookback
        lookback = config.get('lookback_value', 30)
        unit = config.get('lookback_unit', 'days')
        if (unit == 'days' and lookback > 180) or (unit == 'months' and lookback > 6):
            warnings.append({
                'type': 'long_lookback',
                'message': "Very long lookback windows may over-smooth recent behavioral changes.",
                'severity': 'warning'
            })
        
        # High zero rate
        metric_stats = stats.get('stats', {})
        amount_stats = metric_stats.get('amount', {})
        if amount_stats.get('zeros_pct', 0) > 30:
            warnings.append({
                'type': 'high_zeros',
                'message': f"{amount_stats['zeros_pct']:.1f}% of aggregated values are zero. Review population or filter criteria.",
                'severity': 'warning'
            })
        
        return warnings
    
    @staticmethod
    def generate_full_explanation(config, stats):
        """Generate complete explanation bundle"""
        return {
            'intent': AggregationNarrativeService.generate_intent_narrative(config),
            'use_case_hints': AggregationNarrativeService.generate_use_case_hint(config),
            'warnings': AggregationNarrativeService.generate_warnings(config, stats)
        }