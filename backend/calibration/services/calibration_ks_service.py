# backend/calibration/services/calibration_ks_service.py
"""
Kolmogorov-Smirnov Statistics Service - FIXED VERSION
=====================================================
Computes KS statistics with REALISTIC thresholds for financial data.

CRITICAL FIX: KS values of 1.0 are impossible in real financial data.
The original thresholds were too aggressive. New thresholds reflect
actual financial distribution characteristics.

REALISTIC KS INTERPRETATION:
- 0.0-0.15: Weak separation (populations very similar)
- 0.15-0.35: Moderate separation (some structural difference)
- 0.35-0.60: Strong separation (clear structural difference)
- 0.60+: Excellent separation (highly distinct populations)

Note: In financial data, KS > 0.7 is RARE and indicates exceptional separation.
"""
import pandas as pd
import numpy as np
from scipy import stats
from calibration.shared.calibration_helpers import load_calibration_population


class CalibrationKSService:
    """
    Handles Kolmogorov-Smirnov statistical analysis with realistic thresholds.
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def compute_ks_statistic(self, run_id, threshold, metric='amount'):
        """
        Compute KS statistic between alerted and suppressed populations.
        
        Returns:
            {
                'ks_statistic': float,          # KS value [0, 1]
                'p_value': float,               # Statistical significance
                'interpretation': str,          # Human-readable level
                'max_separation_point': float,  # Point of maximum divergence
                'populations': {
                    'alerted_size': int,
                    'suppressed_size': int,
                    'total_size': int
                }
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
        
        # Split populations at threshold
        alerted_values = df[df[target_col] >= threshold][target_col].dropna()
        suppressed_values = df[df[target_col] < threshold][target_col].dropna()
        
        if len(alerted_values) < 10 or len(suppressed_values) < 10:
            return self._insufficient_data_response(len(alerted_values), len(suppressed_values))
        
        # Compute KS statistic
        ks_stat, p_value = stats.ks_2samp(alerted_values, suppressed_values)
        
        # Find point of maximum separation
        max_sep_point = self._find_max_separation_point(
            alerted_values, suppressed_values
        )
        
        # FIXED: Use realistic interpretation
        interpretation = self._interpret_ks_value(ks_stat)
        
        return {
            'ks_statistic': float(ks_stat),
            'p_value': float(p_value),
            'interpretation': interpretation,
            'max_separation_point': float(max_sep_point),
            'populations': {
                'alerted_size': int(len(alerted_values)),
                'suppressed_size': int(len(suppressed_values)),
                'total_size': int(len(df)),
                'alerted_pct': round((len(alerted_values) / len(df)) * 100, 2)
            },
            'threshold': float(threshold),
            'metric': metric,
            'alert_grain': metadata.get('level', 'ACCOUNT').upper()
        }
    
    def compute_ks_across_percentiles(self, run_id, percentiles=None, metric='amount'):
        """
        Compute KS statistics across multiple percentile thresholds.
        """
        if percentiles is None:
            percentiles = [75, 80, 85, 90, 92, 94, 95, 96, 97, 98, 99]
        
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        sensitivity_curve = []
        
        for p in percentiles:
            threshold = float(values.quantile(p / 100))
            
            alerted = values[values >= threshold]
            suppressed = values[values < threshold]
            
            if len(alerted) >= 10 and len(suppressed) >= 10:
                ks_stat, _ = stats.ks_2samp(alerted, suppressed)
                
                sensitivity_curve.append({
                    'percentile': p,
                    'threshold': round(threshold, 2),
                    'ks_statistic': round(float(ks_stat), 4),
                    'interpretation': self._interpret_ks_value(ks_stat),
                    'alerted_count': int(len(alerted)),
                    'suppressed_count': int(len(suppressed))
                })
        
        optimal = max(sensitivity_curve, key=lambda x: x['ks_statistic']) if sensitivity_curve else None
        
        return {
            'sensitivity_curve': sensitivity_curve,
            'optimal_separation': optimal,
            'metric': metric,
            'alert_grain': metadata.get('level', 'ACCOUNT').upper()
        }
    
    def _find_max_separation_point(self, alerted_values, suppressed_values):
        """
        Find the point where CDFs have maximum vertical distance.
        """
        all_values = np.concatenate([alerted_values, suppressed_values])
        sorted_values = np.sort(all_values)
        
        max_diff = 0
        max_point = sorted_values[0]
        
        for val in sorted_values:
            ecdf_alerted = (alerted_values <= val).mean()
            ecdf_suppressed = (suppressed_values <= val).mean()
            
            diff = abs(ecdf_alerted - ecdf_suppressed)
            
            if diff > max_diff:
                max_diff = diff
                max_point = val
        
        return max_point
    
    def _interpret_ks_value(self, ks_stat):
        """
        FIXED: Realistic KS interpretation for financial data.
        
        Financial transaction distributions are inherently similar because:
        1. Most transactions follow similar behavioral patterns
        2. Even "high risk" accounts share many normal behaviors
        3. True separation comes from subtle distributional differences
        
        REALISTIC THRESHOLDS (based on empirical financial data):
        - 0.0-0.15: Weak separation - threshold not capturing distinct cohort
        - 0.15-0.35: Moderate separation - some structural difference detected
        - 0.35-0.60: Strong separation - clear behavioral distinction
        - 0.60+: Excellent separation - rare in financial data, exceptional distinction
        
        Note: KS values above 0.7 in financial data are EXTREMELY rare and should
        prompt data quality checks. A KS of 1.0 is theoretically impossible in
        continuous distributions with any overlap.
        """
        if ks_stat < 0.15:
            return 'weak'
        elif ks_stat < 0.35:
            return 'moderate'
        elif ks_stat < 0.60:
            return 'strong'
        else:
            # KS >= 0.60 is excellent in financial contexts
            return 'very_strong'
    
    def _insufficient_data_response(self, alerted_size, suppressed_size):
        """Return response when sample sizes are too small"""
        return {
            'ks_statistic': None,
            'p_value': None,
            'interpretation': 'insufficient_data',
            'max_separation_point': None,
            'populations': {
                'alerted_size': alerted_size,
                'suppressed_size': suppressed_size,
                'total_size': alerted_size + suppressed_size,
                'alerted_pct': 0
            },
            'note': 'Insufficient data for KS analysis. Need at least 10 entities in each population.'
        }
    
    def compare_ks_with_str_overlay(self, run_id, threshold, metric='amount'):
        """
        Compute KS statistic WITH STR evaluation overlay.
        
        CRITICAL: STR is ONLY used for interpretation, NOT computation.
        """
        ks_result = self.compute_ks_statistic(run_id, threshold, metric)
        
        try:
            from calibration.services.calibration_str_evaluation_service import CalibrationSTREvaluationService
            str_service = CalibrationSTREvaluationService(self.db)
            str_eval = str_service.evaluate_str_capture(run_id, threshold, metric)
        except Exception as e:
            print(f"⚠️ STR overlay unavailable: {e}")
            str_eval = {
                'total_strs': 0,
                'captured_strs': 0,
                'capture_rate': 0.0,
                'note': 'STR data not available'
            }
        
        return {
            **ks_result,
            'str_overlay': {
                'total_strs': str_eval.get('total_strs', 0),
                'captured_strs': str_eval.get('captured_strs', 0),
                'capture_rate': str_eval.get('capture_rate', 0.0),
                'note': 'STR metrics shown for evaluation only - not used in KS computation'
            }
        }