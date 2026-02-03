# backend/calibration/services/threshold_service.py
"""
Threshold Service - Step 3
Handles percentile computation, simulation, and threshold recommendation
"""
import pandas as pd
from ..builder.percentile_engine import PercentileEngine
from ..builder.threshold_simulator import ThresholdSimulator
import json
import numpy as np

class ThresholdService:
    """Handle threshold calibration and simulation"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def compute_percentiles(self, run_id, metric='amount'):
        """
        Execute Step 3a: Compute percentile distribution
        
        Args:
            run_id: Calibration run ID
            metric: 'amount' or 'count'
        
        Returns:
            {
                'percentiles': [...],
                'distribution_stats': {...}
            }
        """
        # Load aggregated data from Step 2
        aggregated_df = self._load_aggregated_df(run_id)
        
        if aggregated_df.empty:
            raise ValueError("No aggregated data found. Run Step 2 first.")
        
        print(f"📊 Computing percentiles for {metric}")
        
        # Use PercentileEngine
        conn = self.db.connect()
        percentile_engine = PercentileEngine(conn)
        
        percentiles = percentile_engine.compute_percentiles(
            run_id,
            aggregated_df,
            metric=metric
        )
        
        conn.close()
        
        print(f"✅ Computed {len(percentiles)} percentile points")
        
        return {
            'percentiles': percentiles,
            'metric': metric
        }
    
    def simulate_threshold(self, run_id, threshold_value, metric='amount'):
        """
        Execute Step 3b: Simulate impact of specific threshold
        
        Args:
            run_id: Calibration run ID
            threshold_value: Threshold to test
            metric: 'amount' or 'count'
        
        Returns:
            {
                'threshold': float,
                'percentile': float,
                'alerts_triggered': int,
                'unique_entities_flagged': int,
                'pct_population_flagged': float,
                'risk_breakdown': {...}
            }
        """
        aggregated_df = self._load_aggregated_df(run_id)
        
        print(f"🎯 Simulating threshold: {threshold_value}")
        
        # Use ThresholdSimulator
        simulator = ThresholdSimulator(self.db)
        
        result = simulator.simulate_threshold(
            run_id,
            aggregated_df,
            threshold_value,
            metric=f'aggregated_{metric}'
        )
        
        print(f"✅ Simulation complete: {result['alerts_triggered']} alerts")
        
        return result
    
    def simulate_multiple_thresholds(self, run_id, percentile_list=None, metric='amount'):
        """
        Execute Step 3c: Simulate multiple thresholds at once
        
        Args:
            run_id: Calibration run ID
            percentile_list: [50, 75, 90, 95, 99] or None for defaults
            metric: 'amount' or 'count'
        
        Returns:
            {
                'simulations': [...],
                'recommended_threshold': {...}
            }
        """
        if percentile_list is None:
            percentile_list = [75, 80, 85, 90, 95, 97, 99]
        
        aggregated_df = self._load_aggregated_df(run_id)
        
        # Get percentile values
        metric_col = f'aggregated_{metric}'
        values = aggregated_df[metric_col].dropna()
        
        percentiles_dict = {}
        for p in percentile_list:
            threshold = float(np.percentile(values, p))
            percentiles_dict[f'p{p}'] = threshold
        
        print(f"🎯 Simulating {len(percentiles_dict)} thresholds")
        
        # Run simulations
        simulator = ThresholdSimulator(self.db)
        simulations = simulator.simulate_multiple_thresholds(
            run_id,
            aggregated_df,
            percentiles_dict,
            metric=metric_col
        )
        
        # Generate recommendation
        recommendation = self._generate_recommendation(simulations)
        
        return {
            'simulations': simulations,
            'recommended_threshold': recommendation
        }
    
    def _generate_recommendation(self, simulations):
        """
        Generate threshold recommendation based on simulations
        
        Logic:
        - Prefer 90-95th percentile range
        - Balance alert volume vs coverage
        - Flag Low/Medium/High based on alert volume
        """
        if not simulations:
            return None
        
        # Sort by percentile
        sorted_sims = sorted(simulations, key=lambda x: x.get('percentile', 0))
        
        # Find sweet spot (90-95th percentile)
        candidates = [
            s for s in sorted_sims 
            if 90 <= s.get('percentile', 0) <= 95
        ]
        
        if not candidates:
            # Fallback to 90th percentile
            candidates = [
                s for s in sorted_sims 
                if s.get('percentile', 0) >= 90
            ]
        
        if not candidates:
            # Last resort: pick highest percentile
            recommended = sorted_sims[-1]
        else:
            # Pick middle candidate
            recommended = candidates[len(candidates) // 2]
        
        # Determine severity
        alert_count = recommended['alerts_triggered']
        severity = 'Low' if alert_count > 1000 else 'Medium' if alert_count > 100 else 'High'
        
        return {
            'threshold': recommended['threshold_value'],
            'percentile': recommended.get('percentile'),
            'alerts_triggered': alert_count,
            'unique_entities': recommended.get('unique_entities_flagged'),
            'pct_population': recommended.get('pct_population_flagged'),
            'severity': severity,
            'rationale': f"Recommended {recommended.get('percentile')}th percentile threshold "
                        f"({recommended['threshold_value']:,.2f}) balances alert volume "
                        f"({alert_count}) with population coverage."
        }
    
    def select_threshold(self, run_id, threshold_value, percentile=None):
        """
        Finalize threshold selection
        
        Updates run status to 'threshold_selected'
        """
        # Simulate to get metrics
        result = self.simulate_threshold(run_id, threshold_value)
        
        # Update run
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE calibration_runs
            SET selected_threshold = ?,
                selected_percentile = ?,
                estimated_alert_count = ?,
                status = 'threshold_selected',
                current_step = 4
            WHERE run_id = ?
        """, (
            threshold_value,
            percentile or result.get('percentile'),
            result['alerts_triggered'],
            run_id
        ))
        
        conn.commit()
        conn.close()
        
        print(f"✅ Threshold selected: {threshold_value}")
        
        return {
            'threshold': threshold_value,
            'percentile': percentile or result.get('percentile'),
            'estimated_alerts': result['alerts_triggered']
        }
    
    def get_simulations(self, run_id):
        """Retrieve all simulations for a run"""
        simulator = ThresholdSimulator(self.db)
        return simulator.get_simulations(run_id)
    
    def _load_aggregated_df(self, run_id):
        conn = self.db.connect()
        query = """
            SELECT *
            FROM aggregated_populations
            WHERE run_id = ?
        """
        df = pd.read_sql(query, conn, params=(run_id,))
        conn.close()
        return df
