# backend/calibration/services/calibration_distribution_service.py
"""
Distribution Service - Handles histogram, shape analysis, and distribution tables
Fixes JSON serialization issues with NumPy types
"""
import pandas as pd
import numpy as np
from calibration.shared.calibration_helpers import (
    CalibrationContracts, 
    DistributionAnalyzer,
    load_calibration_population
)

class CalibrationDistributionService:
    """
    Provides distribution intelligence for Step 3
    - Histogram generation
    - Distribution tables
    - Shape analysis
    - Near-miss analysis
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
        self.analyzer = DistributionAnalyzer()
    
    def _sanitize_numpy(self, obj):
        """
        Recursively convert numpy types to native Python types for JSON serialization.
        Fixes TypeError: Object of type bool_ is not JSON serializable
        """
        if isinstance(obj, dict):
            return {k: self._sanitize_numpy(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._sanitize_numpy(v) for v in obj]
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.bool_):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return self._sanitize_numpy(obj.tolist())
        return obj

    def get_distribution_table(self, run_id, metric='amount', bins=50, threshold=None):
        """
        Generate distribution table from histogram bins
        Returns table view with ranges, counts, and percentages
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        # Determine column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if target_col is None:
            raise ValueError(f"No numeric column found for metric '{metric}'")
        
        values = df[target_col].dropna()
        total = len(values)
        
        # Generate histogram
        counts, bin_edges = np.histogram(values, bins=bins)
        
        cumulative = 0
        table_rows = []
        
        for i in range(len(counts)):
            count = int(counts[i])
            cumulative += count
            bin_start = float(bin_edges[i])
            bin_end = float(bin_edges[i+1])
            
            is_above = False
            if threshold is not None:
                is_above = bin_start >= threshold
            
            table_rows.append({
                "range": f"₹{self._format_currency(bin_start)} - ₹{self._format_currency(bin_end)}",
                "bin_start": round(bin_start, 2),
                "bin_end": round(bin_end, 2),
                "entity_count": count,
                "pct_population": round((count / total) * 100, 2),
                "cumulative_pct": round((cumulative / total) * 100, 2),
                "is_above_threshold": is_above
            })
        
        result = {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "binning": CalibrationContracts.binning_metadata("equal_width", bins),
            "bins": table_rows,
            "total_entities": total,
            "metric": metric
        }
        
        return self._sanitize_numpy(result)
    
    def analyze_distribution_shape(self, run_id, metric='amount'):
        """
        Analyze distribution shape characteristics
        Returns skewness, tail info, and interpretive notes
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        shape_analysis = self.analyzer.analyze_shape(values)
        
        result = {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "distribution_shape": shape_analysis,
            "stats": {
                "min": float(values.min()),
                "max": float(values.max()),
                "mean": float(values.mean()),
                "median": float(values.median()),
                "std": float(values.std()),
                "p75": float(values.quantile(0.75)),
                "p90": float(values.quantile(0.90)),
                "p95": float(values.quantile(0.95)),
                "p99": float(values.quantile(0.99))
            }
        }
        
        # Sanitize to ensure bool_ becomes bool
        return self._sanitize_numpy(result)
    
    def get_near_miss_analysis(self, run_id, threshold, band_pct=10.0, metric='amount'):
        """
        Analyze entities within near-miss band of threshold
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        # Calculate band
        lower_bound = threshold * (1 - band_pct/100)
        upper_bound = threshold
        
        # Count entities in band
        in_band = values[(values >= lower_bound) & (values < upper_bound)]
        above_threshold = values[values >= threshold]
        
        # Get unique entities if possible
        entity_cols = ['account_id', 'customer_id', 'entity_id']
        unique_in_band = 0
        for col in entity_cols:
            if col in df.columns:
                band_df = df[(df[target_col] >= lower_bound) & (df[target_col] < upper_bound)]
                unique_in_band = int(band_df[col].nunique())
                break
        
        result = {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "near_miss": {
                **CalibrationContracts.near_miss_band(threshold, band_pct),
                "entity_count": len(in_band),
                "unique_entities": unique_in_band,
                "pct_of_alerts": round((len(in_band) / len(above_threshold) * 100), 2) if len(above_threshold) > 0 else 0
            }
        }
        
        return self._sanitize_numpy(result)
    
    def get_histogram_for_viz(self, run_id, metric='amount', bins=50):
        """
        Generate histogram data optimized for chart visualization
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        total = len(values)
        
        counts, bin_edges = np.histogram(values, bins=bins)
        
        cumulative = 0
        histogram = []
        
        for i in range(len(counts)):
            count = int(counts[i])
            cumulative += count
            histogram.append({
                'bin_start': float(bin_edges[i]),
                'bin_end': float(bin_edges[i+1]),
                'count': count,
                'pct_of_total': round((count / total) * 100, 2),
                'cumulative_pct': round((cumulative / total) * 100, 2)
            })
        
        return self._sanitize_numpy(histogram)
    
    def _format_currency(self, value):
        """Format currency for display"""
        if value >= 10000000:  # 1 Crore
            return f"{value/10000000:.1f}Cr"
        elif value >= 100000:  # 1 Lakh
            return f"{value/100000:.1f}L"
        elif value >= 1000:
            return f"{value/1000:.1f}K"
        else:
            return f"{value:.0f}"