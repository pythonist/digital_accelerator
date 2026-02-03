# backend/calibration/services/calibration_ks_visualization_service.py
"""
KS Visualization Service
========================
Generates CDF curves and visual data for KS analysis.
"""
import pandas as pd
import numpy as np
from calibration.shared.calibration_helpers import load_calibration_population


class CalibrationKSVisualizationService:
    """
    Prepares visualization-ready data for KS analysis.
    Generates empirical CDF curves for frontend charting.
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def generate_cdf_comparison(self, run_id, threshold, metric='amount', points=100):
        """
        Generate dual empirical CDF curves for alerted vs suppressed populations.
        
        Returns data ready for direct frontend charting (e.g., Recharts).
        
        Args:
            run_id: Calibration run identifier
            threshold: Split point
            metric: Metric to analyze
            points: Number of points in CDF curve (higher = smoother)
        
        Returns:
            {
                'cdf_data': [
                    {
                        'value': 1000,
                        'alerted_cdf': 0.15,
                        'suppressed_cdf': 0.45,
                        'separation': 0.30
                    },
                    ...
                ],
                'max_separation': {
                    'value': 45000,
                    'separation': 0.52,
                    'alerted_cdf': 0.35,
                    'suppressed_cdf': 0.87
                },
                'threshold_marker': {
                    'value': 50000,
                    'alerted_cdf': 0.0,  # All alerted > threshold
                    'suppressed_cdf': 1.0  # All suppressed < threshold
                }
            }
        """
        # Load aggregated population
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Split populations
        alerted_values = df[df[target_col] >= threshold][target_col].dropna().values
        suppressed_values = df[df[target_col] < threshold][target_col].dropna().values
        
        if len(alerted_values) < 10 or len(suppressed_values) < 10:
            return self._empty_cdf_response()
        
        # Generate evaluation points (spanning both distributions)
        min_val = min(alerted_values.min(), suppressed_values.min())
        max_val = max(alerted_values.max(), suppressed_values.max())
        
        eval_points = np.linspace(min_val, max_val, points)
        
        # Compute ECDFs
        cdf_data = []
        max_sep = {'separation': 0, 'value': min_val}
        
        for val in eval_points:
            # ECDF = proportion of values <= val
            alerted_cdf = float((alerted_values <= val).mean())
            suppressed_cdf = float((suppressed_values <= val).mean())
            separation = abs(alerted_cdf - suppressed_cdf)
            
            cdf_data.append({
                'value': round(float(val), 2),
                'alerted_cdf': round(alerted_cdf, 4),
                'suppressed_cdf': round(suppressed_cdf, 4),
                'separation': round(separation, 4)
            })
            
            # Track maximum separation point
            if separation > max_sep['separation']:
                max_sep = {
                    'value': float(val),
                    'separation': separation,
                    'alerted_cdf': alerted_cdf,
                    'suppressed_cdf': suppressed_cdf
                }
        
        # Threshold marker
        threshold_marker = {
            'value': float(threshold),
            'alerted_cdf': float((alerted_values <= threshold).mean()),
            'suppressed_cdf': float((suppressed_values <= threshold).mean())
        }
        
        return {
            'cdf_data': cdf_data,
            'max_separation': max_sep,
            'threshold_marker': threshold_marker,
            'populations': {
                'alerted_size': len(alerted_values),
                'suppressed_size': len(suppressed_values),
                'alerted_range': [float(alerted_values.min()), float(alerted_values.max())],
                'suppressed_range': [float(suppressed_values.min()), float(suppressed_values.max())]
            },
            'metric': metric
        }
    
    def generate_ks_heatmap(self, run_id, metric='amount', resolution=20):
        """
        Generate a heatmap showing KS values across percentile range.
        
        Useful for identifying "sweet spots" where separation is maximal.
        
        Returns:
            {
                'heatmap_data': [
                    {'percentile': 75, 'ks_value': 0.25, 'category': 'weak'},
                    {'percentile': 80, 'ks_value': 0.35, 'category': 'moderate'},
                    ...
                ]
            }
        """
        from scipy import stats
        
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        # Generate percentiles
        percentiles = np.linspace(75, 99, resolution)
        
        heatmap_data = []
        
        for p in percentiles:
            threshold = values.quantile(p / 100)
            
            alerted = values[values >= threshold]
            suppressed = values[values < threshold]
            
            if len(alerted) >= 10 and len(suppressed) >= 10:
                ks_stat, _ = stats.ks_2samp(alerted, suppressed)
                
                # Categorize
                if ks_stat < 0.2:
                    category = 'weak'
                elif ks_stat < 0.4:
                    category = 'moderate'
                elif ks_stat < 0.7:
                    category = 'strong'
                else:
                    category = 'very_strong'
                
                heatmap_data.append({
                    'percentile': round(float(p), 1),
                    'ks_value': round(float(ks_stat), 4),
                    'category': category,
                    'threshold': round(float(threshold), 2)
                })
        
        return {
            'heatmap_data': heatmap_data,
            'metric': metric
        }
    
    def _empty_cdf_response(self):
        """Return empty CDF structure"""
        return {
            'cdf_data': [],
            'max_separation': None,
            'threshold_marker': None,
            'populations': {
                'alerted_size': 0,
                'suppressed_size': 0
            },
            'note': 'Insufficient data for CDF generation'
        }