# backend/calibration/services/calibration_comparison_service.py
"""
Comparison Service - Percentile ladder, sensitivity curves, exploration paths
FIXED: NaN handling in delta calculations
"""
import pandas as pd
import numpy as np
from calibration.shared.calibration_helpers import (
    CalibrationContracts,
    DistributionAnalyzer,
    ExplorationPathSuggester,
    load_calibration_population
)


class CalibrationComparisonService:
    """
    Handles scenario comparison, percentile ladders, and exploration suggestions
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
        self.analyzer = DistributionAnalyzer()
        self.suggester = ExplorationPathSuggester()
    
    def get_percentile_ladder(self, run_id, percentiles=None, metric='amount'):
        """
        Generate percentile ladder with sensitivity analysis
        Returns table with alerts, deltas, and sensitivity for each percentile
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
        total = len(values)
        
        ladder = []
        prev_alerts = None
        
        for p in percentiles:
            threshold = float(values.quantile(p / 100))
            alerts = len(values[values >= threshold])
            pct_population = round((alerts / total) * 100, 2) if total > 0 else 0
            
            # ✅ FIX: Calculate deltas with None checks
            delta_alerts = None
            delta_pct = None
            if prev_alerts is not None and prev_alerts > 0:
                delta_alerts = prev_alerts - alerts
                delta_pct = round((delta_alerts / prev_alerts) * 100, 1)
            
            # ✅ FIX: Calculate sensitivity with safe defaults
            try:
                sensitivity = self.analyzer.calculate_sensitivity(df, target_col, p, threshold)
            except Exception as e:
                print(f"⚠️ Sensitivity calculation failed for p{p}: {e}")
                sensitivity = {
                    "alerts_per_1pct": 0,
                    "alerts_per_1000_currency": 0,
                    "stability": "UNKNOWN"
                }
            
            ladder.append({
                "percentile": p,
                "threshold": round(threshold, 2),
                "alerts": alerts,
                "delta_alerts": delta_alerts,  # Will be None for first row
                "delta_pct": delta_pct,  # Will be None for first row
                "pct_population": pct_population,
                "sensitivity": sensitivity
            })
            
            prev_alerts = alerts
        
        # Get exploration suggestion
        try:
            exploration = self.suggester.suggest_path(ladder)
        except Exception as e:
            print(f"⚠️ Exploration suggestion failed: {e}")
            exploration = None
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "ladder": ladder,
            "suggested_exploration": exploration
        }
    
    def calculate_sensitivity_curve(self, run_id, metric='amount', granularity=0.5):
        """
        Calculate full sensitivity curve across percentile range
        Returns sensitivity at each percentile step
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        curve = []
        percentiles = np.arange(75, 99.5, granularity)
        
        for p in percentiles:
            threshold = float(values.quantile(p / 100))
            
            try:
                sensitivity = self.analyzer.calculate_sensitivity(df, target_col, p, threshold)
            except Exception as e:
                sensitivity = {
                    "alerts_per_1pct": 0,
                    "alerts_per_1000_currency": 0,
                    "stability": "UNKNOWN"
                }
            
            curve.append({
                "percentile": round(p, 1),
                "threshold": round(threshold, 2),
                "sensitivity_score": sensitivity['alerts_per_1pct'],
                "stability": sensitivity['stability']
            })
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "sensitivity_curve": curve
        }
    
    def compare_scenarios(self, run_id, scenario_thresholds, metric='amount'):
        """
        Compare multiple threshold scenarios side-by-side
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        total = len(values)
        
        scenarios = []
        
        for i, threshold in enumerate(scenario_thresholds):
            alerts = len(values[values >= threshold])
            pct_pop = round((alerts / total) * 100, 2) if total > 0 else 0
            
            # Find approximate percentile
            percentile = round(values[values < threshold].count() / total * 100, 1) if total > 0 else 0
            
            scenarios.append({
                "scenario_id": i + 1,
                "threshold": threshold,
                "percentile": percentile,
                "alerts": alerts,
                "pct_population": pct_pop
            })
        
        # Calculate deltas between scenarios
        for i in range(1, len(scenarios)):
            scenarios[i]['delta_from_prev'] = scenarios[i-1]['alerts'] - scenarios[i]['alerts']
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "scenarios": scenarios
        }
    
    def get_delta_analysis(self, run_id, threshold1, threshold2, metric='amount'):
        """
        Detailed delta analysis between two thresholds
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        values = df[target_col].dropna()
        
        # Calculate for both thresholds
        alerts1 = len(values[values >= threshold1])
        alerts2 = len(values[values >= threshold2])
        
        # Entities in the gap
        if threshold1 < threshold2:
            gap_entities = values[(values >= threshold1) & (values < threshold2)]
        else:
            gap_entities = values[(values >= threshold2) & (values < threshold1)]
        
        delta_alerts = alerts1 - alerts2
        delta_pct = round((delta_alerts / alerts1) * 100, 1) if alerts1 > 0 else 0
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "threshold1": threshold1,
            "threshold2": threshold2,
            "alerts1": alerts1,
            "alerts2": alerts2,
            "delta_alerts": abs(delta_alerts),
            "delta_pct": abs(delta_pct),
            "entities_in_gap": len(gap_entities),
            "direction": "increase" if alerts2 > alerts1 else "decrease"
        }