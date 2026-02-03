# backend/calibration/services/aggregation_insight_service.py
"""
Aggregation Insight Service
Generates "what this misses" and calibration risk insights
"""
import pandas as pd
import numpy as np

class AggregationInsightService:
    """Generate investigator insights"""
    
    @staticmethod
    def generate_missed_behavior_warnings(config):
        """Generate warnings about what this aggregation might miss"""
        warnings = []
        
        lookback_value = config.get('lookback_value', 30)
        lookback_unit = config.get('lookback_unit', 'days')
        level = config.get('level', 'account')
        frequency = config.get('frequency', 'daily')
        
        # Convert to days for comparison
        lookback_days = lookback_value
        if lookback_unit == 'weeks':
            lookback_days = lookback_value * 7
        elif lookback_unit == 'months':
            lookback_days = lookback_value * 30
        
        # Short lookback warnings
        if lookback_days < 7:
            warnings.append({
                'category': 'temporal',
                'message': 'Single-day spikes smaller than weekly context',
                'severity': 'medium',
                'explanation': f'{lookback_days}-day window may amplify short-term noise'
            })
        
        # Long lookback warnings
        if lookback_days > 90:
            warnings.append({
                'category': 'temporal',
                'message': 'Recent behavioral shifts',
                'severity': 'low',
                'explanation': f'{lookback_days}-day window smooths recent changes'
            })
        
        # Intra-day patterns
        if frequency == 'daily':
            warnings.append({
                'category': 'temporal',
                'message': 'Intra-day transaction bursts',
                'severity': 'low',
                'explanation': 'Daily snapshots aggregate all same-day activity'
            })
        
        # Entity-level warnings
        if level == 'customer':
            warnings.append({
                'category': 'structural',
                'message': 'Account-specific patterns',
                'severity': 'medium',
                'explanation': 'Customer aggregation may mask individual account behavior'
            })
        
        if level == 'account':
            warnings.append({
                'category': 'structural',
                'message': 'Cross-account coordination (smurfing)',
                'severity': 'medium',
                'explanation': 'Account-level misses behavior split across customer accounts'
            })
        
        # Filter warnings
        if not config.get('filter_history', True):
            warnings.append({
                'category': 'scope',
                'message': 'Mixed transaction types',
                'severity': 'high',
                'explanation': 'Aggregating all types may dilute specific behavioral patterns'
            })
        
        return warnings
    
    @staticmethod
    def generate_calibration_risk_preview(v2_df, config):
        """Generate calibration risk indicators (no thresholds)"""
        risks = []
        
        # Get lookback days
        lookback_value = config.get('lookback_value', 30)
        lookback_unit = config.get('lookback_unit', 'days')
        lookback_days = lookback_value
        if lookback_unit == 'weeks':
            lookback_days = lookback_value * 7
        elif lookback_unit == 'months':
            lookback_days = lookback_value * 30
        
        metrics = config.get('metrics', ['sum_amount'])
        
        # Define column names upfront
        amount_col = f"agg_{lookback_days}d_amount"
        count_col = f"agg_{lookback_days}d_count"
        
        # Amount metric stability
        if any(m in metrics for m in ['sum_amount', 'amount']):
            if amount_col in v2_df.columns:
                values = v2_df[amount_col].dropna()
                if len(values) > 0 and values.mean() > 0:
                    cv = values.std() / values.mean()
                    
                    if cv < 0.5:
                        risks.append({
                            'metric': 'SUM(amount)',
                            'stability': 'stable',
                            'detail': f'CV = {cv:.2f} - low variability',
                            'calibration_impact': 'Thresholds will have consistent hit rates'
                        })
                    elif cv < 1.5:
                        risks.append({
                            'metric': 'SUM(amount)',
                            'stability': 'moderate',
                            'detail': f'CV = {cv:.2f} - moderate variability',
                            'calibration_impact': 'Expect some threshold sensitivity'
                        })
                    else:
                        risks.append({
                            'metric': 'SUM(amount)',
                            'stability': 'volatile',
                            'detail': f'CV = {cv:.2f} - high variability',
                            'calibration_impact': 'Thresholds may produce unstable alert volumes'
                        })
        
        # Count metric stability
        if 'count' in metrics or 'velocity' in metrics:
            if count_col in v2_df.columns:
                values = v2_df[count_col].dropna()
                if len(values) > 0 and values.mean() > 0:
                    cv = values.std() / values.mean()
                    
                    if cv < 0.5:
                        risks.append({
                            'metric': 'COUNT(*)',
                            'stability': 'stable',
                            'detail': f'CV = {cv:.2f} - consistent frequency',
                            'calibration_impact': 'Good candidate for frequency-based rules'
                        })
                    else:
                        risks.append({
                            'metric': 'COUNT(*)',
                            'stability': 'bursty',
                            'detail': f'CV = {cv:.2f} - irregular patterns',
                            'calibration_impact': 'May need wider threshold margins'
                        })
        
        # Entity-level variance
        entity_col = f"{config['level']}_id"
        if entity_col in v2_df.columns and amount_col in v2_df.columns:
            entity_variance = v2_df.groupby(entity_col)[amount_col].std().mean()
            overall_std = v2_df[amount_col].std()
            
            if overall_std > 0 and entity_variance / overall_std > 0.7:
                risks.append({
                    'metric': 'Cross-entity',
                    'stability': 'high within-entity variance',
                    'detail': 'Behavior varies more within entities than across',
                    'calibration_impact': 'Entity-level thresholds may be more effective'
                })
        
        return risks
    
    @staticmethod
    def generate_snapshot_explainer(v2_df, config):
        """Generate detailed explanation for one sample snapshot"""
        if v2_df.empty:
            return None
        
        # Get lookback days
        lookback_value = config.get('lookback_value', 30)
        lookback_unit = config.get('lookback_unit', 'days')
        lookback_days = lookback_value
        if lookback_unit == 'weeks':
            lookback_days = lookback_value * 7
        elif lookback_unit == 'months':
            lookback_days = lookback_value * 30
        
        entity_col = f"{config['level']}_id"
        
        # Pick a snapshot with median behavior
        count_col = f"agg_{lookback_days}d_count"
        if count_col in v2_df.columns:
            median_count = v2_df[count_col].median()
            sample_row = v2_df.iloc[(v2_df[count_col] - median_count).abs().argsort()[0]]
        else:
            sample_row = v2_df.iloc[len(v2_df) // 2]  # Middle row
        
        explainer = {
            'entity_id': str(sample_row[entity_col]) if entity_col in sample_row else 'Unknown',
            'anchor_date': str(sample_row['transaction_date']) if 'transaction_date' in sample_row else 'Unknown',
            'window_start': str(pd.to_datetime(sample_row['transaction_date']) - pd.Timedelta(days=lookback_days - 1)) if 'transaction_date' in sample_row else 'Unknown',
            'window_end': str(sample_row['transaction_date']) if 'transaction_date' in sample_row else 'Unknown'
        }
        
        # Add metrics
        if count_col in sample_row:
            explainer['included_transactions'] = int(sample_row[count_col])
        
        amount_col = f"agg_{lookback_days}d_amount"
        if amount_col in sample_row:
            explainer['total_amount'] = float(sample_row[amount_col])
        
        avg_col = f"avg_{lookback_days}d_amount"
        if avg_col in sample_row:
            explainer['avg_amount'] = float(sample_row[avg_col])
        
        return explainer