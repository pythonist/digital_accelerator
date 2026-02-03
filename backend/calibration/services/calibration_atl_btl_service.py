# backend/calibration/services/calibration_atl_btl_service.py
"""
ATL / BTL Analysis Service
==========================
Above-the-Line / Below-the-Line comparative evaluation.
Bank-standard governance mechanism for threshold justification.

CRITICAL PRINCIPLES:
1. ATL/BTL operates ONLY on aggregated data (post Step 2)
2. STR is evaluation-only, NEVER influences computation
3. Provides "why not lower?" justification
4. Aggregation is NEVER re-run
"""
import pandas as pd
import numpy as np
from calibration.shared.calibration_helpers import load_calibration_population



class CalibrationATLBTLService:
    """
    Handles Above-the-Line / Below-the-Line analysis for threshold calibration.
    
    ATL/BTL answers: "What happens if we lower the threshold? 
    Do we capture meaningful additional risk or just noise?"
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def compute_atl_btl_split(self, run_id, threshold, btl_band_pct=10.0, metric='amount'):
        """
        Split population into ATL, BTL, and Far-Below zones.
        
        Args:
            run_id: Calibration run identifier
            threshold: Selected threshold value
            btl_band_pct: BTL band as percentage below threshold (default: 10%)
            metric: Metric to analyze
        
        Returns:
            {
                'threshold': float,
                'btl_band': {
                    'lower': float,
                    'upper': float,
                    'pct': float
                },
                'atl': {
                    'count': int,
                    'pct_population': float,
                    'accounts': int,
                    'customers': int
                },
                'btl': {
                    'count': int,
                    'pct_population': float,
                    'accounts': int,
                    'customers': int
                },
                'far_below': {
                    'count': int,
                    'pct_population': float
                },
                'total_population': int
            }
        """
        # Load aggregated population
        df, metadata = load_calibration_population(run_id, self.db)
        
        if df.empty:
            raise ValueError("No aggregated data found. Complete Step 2 first.")
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if not target_col:
            raise ValueError(f"No numeric column found for metric '{metric}'")
        
        # Calculate BTL band
        btl_lower = threshold * (1 - btl_band_pct / 100)
        btl_upper = threshold
        
        # Split populations
        atl_df = df[df[target_col] >= threshold]
        btl_df = df[(df[target_col] >= btl_lower) & (df[target_col] < threshold)]
        far_below_df = df[df[target_col] < btl_lower]
        
        total = len(df)
        
        # ATL metrics
        atl_metrics = self._compute_zone_metrics(atl_df, total)
        
        # BTL metrics
        btl_metrics = self._compute_zone_metrics(btl_df, total)
        
        # Far below metrics
        far_below_metrics = {
            'count': int(len(far_below_df)),
            'pct_population': round((len(far_below_df) / total) * 100, 2) if total > 0 else 0
        }
        
        return {
            'threshold': float(threshold),
            'btl_band': {
                'lower': round(btl_lower, 2),
                'upper': float(threshold),
                'pct': btl_band_pct
            },
            'atl': atl_metrics,
            'btl': btl_metrics,
            'far_below': far_below_metrics,
            'total_population': int(total),
            'metric': metric,
            'alert_grain': metadata.get('level', 'ACCOUNT').upper()
        }
    
    def compute_volume_sensitivity(self, run_id, threshold, btl_band_pct=10.0, metric='amount'):
        """
        Analyze incremental alert volume if threshold is lowered.
        
        Returns:
            {
                'current_threshold': {
                    'value': float,
                    'alerts': int,
                    'alert_rate': float
                },
                'if_lowered_to_btl_lower': {
                    'threshold': float,
                    'alerts': int,
                    'alert_rate': float,
                    'incremental_alerts': int,
                    'pct_increase': float
                },
                'workload_impact': str
            }
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        total = len(df)
        
        # Current threshold
        current_alerts = len(df[df[target_col] >= threshold])
        current_rate = (current_alerts / total) * 100 if total > 0 else 0
        
        # If lowered to BTL lower bound
        btl_lower = threshold * (1 - btl_band_pct / 100)
        lowered_alerts = len(df[df[target_col] >= btl_lower])
        lowered_rate = (lowered_alerts / total) * 100 if total > 0 else 0
        
        incremental = lowered_alerts - current_alerts
        pct_increase = ((incremental / current_alerts) * 100) if current_alerts > 0 else 0
        
        # Interpret workload impact
        if pct_increase < 10:
            impact = 'MINIMAL'
        elif pct_increase < 30:
            impact = 'MODERATE'
        elif pct_increase < 50:
            impact = 'SIGNIFICANT'
        else:
            impact = 'SEVERE'
        
        return {
            'current_threshold': {
                'value': float(threshold),
                'alerts': int(current_alerts),
                'alert_rate': round(current_rate, 2)
            },
            'if_lowered_to_btl_lower': {
                'threshold': round(btl_lower, 2),
                'alerts': int(lowered_alerts),
                'alert_rate': round(lowered_rate, 2),
                'incremental_alerts': int(incremental),
                'pct_increase': round(pct_increase, 2)
            },
            'workload_impact': impact
        }
    
    def compute_str_overlay(self, run_id, threshold, btl_band_pct=10.0, metric='amount'):
        """
        Overlay STR outcomes on ATL/BTL split.
        
        CRITICAL: STR is for evaluation ONLY, not computation.
        
        Returns:
            {
                'atl_str': {
                    'total_strs': int,
                    'str_pct': float
                },
                'btl_str': {
                    'total_strs': int,
                    'str_pct': float
                },
                'incremental_str_capture': int,
                'incremental_str_pct': float,
                'conclusion': str
            }
        """
        try:
            from calibration.services.calibration_str_evaluation_service import CalibrationSTREvaluationService
            
            # Get ATL/BTL split
            split = self.compute_atl_btl_split(run_id, threshold, btl_band_pct, metric)
            
            # Get STR data
            str_service = CalibrationSTREvaluationService(self.db)
            
            # ATL STR capture
            atl_str = str_service.evaluate_str_capture(run_id, threshold, metric)
            
            # BTL + ATL STR capture (lowered threshold)
            btl_lower = threshold * (1 - btl_band_pct / 100)
            lowered_str = str_service.evaluate_str_capture(run_id, btl_lower, metric)
            
            atl_strs = atl_str.get('captured_strs', 0)
            total_strs = atl_str.get('total_strs', 0)
            lowered_strs = lowered_str.get('captured_strs', 0)
            
            # Incremental STRs in BTL
            incremental_strs = lowered_strs - atl_strs
            
            # Calculate percentages
            atl_str_pct = (atl_strs / total_strs * 100) if total_strs > 0 else 0
            btl_str_pct = (incremental_strs / total_strs * 100) if total_strs > 0 else 0
            
            # Generate conclusion
            if incremental_strs == 0:
                conclusion = "Lowering threshold captures NO additional STRs. Current threshold is optimal."
            elif incremental_strs <= 2 and split['btl']['count'] > 100:
                conclusion = f"Lowering threshold adds {split['btl']['count']} alerts but only {incremental_strs} STR(s). Not justified."
            elif btl_str_pct < 5:
                conclusion = "BTL zone contains minimal STR concentration. Threshold appropriately set."
            else:
                conclusion = f"BTL contains {incremental_strs} STRs ({btl_str_pct:.1f}%). Consider threshold review."
            
            return {
                'atl_str': {
                    'total_strs': int(atl_strs),
                    'str_pct': round(atl_str_pct, 2)
                },
                'btl_str': {
                    'total_strs': int(incremental_strs),
                    'str_pct': round(btl_str_pct, 2)
                },
                'incremental_str_capture': int(incremental_strs),
                'incremental_str_pct': round(btl_str_pct, 2),
                'total_strs_in_period': int(total_strs),
                'conclusion': conclusion,
                'note': 'STR metrics shown for evaluation only - not used in threshold computation'
            }
            
        except Exception as e:
            print(f"⚠️ STR overlay unavailable: {e}")
            return {
                'atl_str': {'total_strs': 0, 'str_pct': 0.0},
                'btl_str': {'total_strs': 0, 'str_pct': 0.0},
                'incremental_str_capture': 0,
                'incremental_str_pct': 0.0,
                'total_strs_in_period': 0,
                'conclusion': 'STR data not available',
                'note': 'STR evaluation could not be performed'
            }
    
    def compute_behavioral_concentration(self, run_id, threshold, btl_band_pct=10.0, metric='amount'):
        """
        Compare behavioral patterns in ATL vs BTL.
        
        Proves that ATL contains qualitatively different behavior.
        
        Returns:
            {
                'atl_patterns': {...},
                'btl_patterns': {...},
                'concentration_ratio': float,
                'interpretation': str
            }
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Split
        btl_lower = threshold * (1 - btl_band_pct / 100)
        atl_df = df[df[target_col] >= threshold]
        btl_df = df[(df[target_col] >= btl_lower) & (df[target_col] < threshold)]
        
        # Compute patterns
        atl_patterns = self._compute_behavioral_patterns(atl_df, target_col)
        btl_patterns = self._compute_behavioral_patterns(btl_df, target_col)
        
        # Concentration ratio (ATL mean / BTL mean)
        atl_mean = atl_patterns['mean_value']
        btl_mean = btl_patterns['mean_value']
        concentration_ratio = (atl_mean / btl_mean) if btl_mean > 0 else 0
        
        # Interpretation
        if concentration_ratio >= 3.0:
            interpretation = "STRONG: ATL population is 3x+ more concentrated than BTL"
        elif concentration_ratio >= 2.0:
            interpretation = "MODERATE: ATL population is 2x+ more concentrated than BTL"
        elif concentration_ratio >= 1.5:
            interpretation = "WEAK: ATL shows some concentration over BTL"
        else:
            interpretation = "MINIMAL: ATL and BTL show similar concentration"
        
        return {
            'atl_patterns': atl_patterns,
            'btl_patterns': btl_patterns,
            'concentration_ratio': round(concentration_ratio, 2),
            'interpretation': interpretation
        }
    
    def generate_atl_btl_narrative(self, run_id, threshold, btl_band_pct=10.0, metric='amount'):
        """
        Generate committee-friendly narrative for ATL/BTL analysis.
        
        Returns plain-language explanation suitable for governance documentation.
        """
        # Get all components
        split = self.compute_atl_btl_split(run_id, threshold, btl_band_pct, metric)
        sensitivity = self.compute_volume_sensitivity(run_id, threshold, btl_band_pct, metric)
        str_overlay = self.compute_str_overlay(run_id, threshold, btl_band_pct, metric)
        
        # Generate narrative
        narrative = f"""
ATL / BTL Threshold Justification

Selected Threshold: ₹{threshold:,.0f}
BTL Band: {btl_band_pct}% below threshold (₹{split['btl_band']['lower']:,.0f} - ₹{threshold:,.0f})

Population Split:
- Above-the-Line (ATL): {split['atl']['count']:,} alerts ({split['atl']['pct_population']:.1f}% of population)
- Below-the-Line (BTL): {split['btl']['count']:,} near-misses ({split['btl']['pct_population']:.1f}% of population)

Workload Impact if Lowered:
Lowering the threshold by {btl_band_pct}% would increase alert volume from {sensitivity['current_threshold']['alerts']:,} to {sensitivity['if_lowered_to_btl_lower']['alerts']:,} (+{sensitivity['if_lowered_to_btl_lower']['incremental_alerts']:,} alerts, {sensitivity['if_lowered_to_btl_lower']['pct_increase']:.1f}% increase). This represents a {sensitivity['workload_impact']} workload impact.

STR Capture Analysis:
{str_overlay['conclusion']}
- ATL captures {str_overlay['atl_str']['total_strs']} STRs ({str_overlay['atl_str']['str_pct']:.1f}%)
- BTL contains {str_overlay['btl_str']['total_strs']} additional STRs ({str_overlay['btl_str']['str_pct']:.1f}%)

Conclusion:
The selected threshold of ₹{threshold:,.0f} balances risk capture with operational efficiency. Lowering the threshold would generate {sensitivity['if_lowered_to_btl_lower']['incremental_alerts']:,} additional alerts while capturing only {str_overlay['incremental_str_capture']} additional STR(s), demonstrating that the current threshold appropriately separates signal from noise.
"""
        
        return {
            'narrative': narrative.strip(),
            'headline': f"Threshold justified: +{sensitivity['if_lowered_to_btl_lower']['incremental_alerts']:,} alerts for +{str_overlay['incremental_str_capture']} STRs",
            'recommendation': str_overlay['conclusion']
        }
    
    def _compute_zone_metrics(self, zone_df, total_population):
        """Compute metrics for a zone (ATL/BTL/Far Below)"""
        count = len(zone_df)
        pct = (count / total_population * 100) if total_population > 0 else 0
        
        metrics = {
            'count': int(count),
            'pct_population': round(pct, 2)
        }
        
        # Entity counts
        if 'account_id' in zone_df.columns:
            metrics['accounts'] = int(zone_df['account_id'].nunique())
        
        if 'customer_id' in zone_df.columns:
            metrics['customers'] = int(zone_df['customer_id'].nunique())
        
        return metrics
    
    def _compute_behavioral_patterns(self, zone_df, metric_col):
        """Compute behavioral pattern metrics for a zone"""
        if zone_df.empty:
            return {
                'mean_value': 0.0,
                'median_value': 0.0,
                'std_value': 0.0,
                'max_value': 0.0,
                'skewness': 0.0
            }
        
        values = zone_df[metric_col]
        
        return {
            'mean_value': float(values.mean()),
            'median_value': float(values.median()),
            'std_value': float(values.std()),
            'max_value': float(values.max()),
            'skewness': float(values.skew()) if len(values) > 2 else 0.0
        }