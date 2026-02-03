# backend/calibration/builder/threshold_simulator.py
"""
Threshold Simulator - Step 3 (ENHANCED)
Simulates impact of different threshold values with detailed analytics
"""
import pandas as pd
import numpy as np
import uuid

class ThresholdSimulator:
    """
    Simulates threshold impact on aggregated data (V2 population)
    
    For any given threshold:
    1. Filters V2 to see how many alerts would trigger
    2. Analyzes risk distribution
    3. Computes entity-level impact
    4. Stores simulation for comparison
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def simulate_threshold(self, run_id, aggregated_df, threshold, metric='amount'):
        """
        Simulate impact of a specific threshold value.
        
        Args:
            run_id: Calibration run ID
            aggregated_df: V2 population (aggregated data from Step 2)
            threshold: Threshold value to test (e.g., 50000)
            metric: 'amount' or 'count'
        
        Returns:
            {
                'threshold_value': 50000.0,
                'percentile': 92.5,
                'alerts_triggered': 1234,
                'unique_entities_flagged': 567,
                'pct_population_flagged': 12.34,
                'risk_breakdown': {'High': 100, 'Medium': 500, 'Low': 634}
            }
        """
        
        if aggregated_df.empty:
            raise ValueError("Aggregated DataFrame is empty")
        
        # 1. Identify target column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        # Fallback column detection
        if target_col not in aggregated_df.columns:
            numeric_cols = aggregated_df.select_dtypes(include=[np.number]).columns
            if len(numeric_cols) > 0:
                target_col = numeric_cols[0]
            else:
                raise ValueError(f"No numeric column found for metric '{metric}'")
        
        print(f"🎯 Simulating threshold: {threshold:,.2f} on {target_col}")
        
        # 2. Filter for breaches (The "Alert Generation" logic)
        breached_df = aggregated_df[aggregated_df[target_col] >= threshold].copy()
        
        total_rows = len(aggregated_df)
        alerts_triggered = len(breached_df)
        
        print(f"   → {alerts_triggered:,} / {total_rows:,} rows would trigger alerts")
        
        # 3. Calculate percentile (reverse lookup)
        all_values = aggregated_df[target_col].dropna()
        below_threshold = (all_values < threshold).sum()
        percentile = (below_threshold / len(all_values) * 100) if len(all_values) > 0 else 0
        
        # 4. Calculate percentage flagged
        pct_flagged = round((alerts_triggered / total_rows * 100), 2) if total_rows > 0 else 0
        
        # 5. Entity-level impact
        entity_col = self._find_entity_column(aggregated_df)
        unique_entities = 0
        
        if entity_col and entity_col in breached_df.columns:
            unique_entities = breached_df[entity_col].nunique()
            print(f"   → {unique_entities:,} unique entities flagged")
        else:
            unique_entities = alerts_triggered  # Assume 1 alert = 1 entity
        
        # 6. Risk breakdown
        risk_breakdown = self._analyze_risk_distribution(breached_df)
        
        # 7. Additional analytics
        analytics = self._compute_additional_metrics(breached_df, target_col)
        
        # 8. Build result package
        result = {
            'threshold_value': float(threshold),
            'percentile': round(percentile, 2),
            'alerts_triggered': int(alerts_triggered),
            'unique_entities_flagged': int(unique_entities),
            'pct_population_flagged': float(pct_flagged),
            'risk_breakdown': risk_breakdown,
            **analytics
        }
        
        # 9. Store simulation log
        self._store_simulation(run_id, metric, result)
        
        print(f"✅ Simulation complete: {alerts_triggered:,} alerts ({pct_flagged}%)")
        
        return result
    
    def _find_entity_column(self, df):
        """Find the entity identifier column"""
        possible_cols = ['account_id', 'customer_id', 'entity_id', 'id']
        for col in possible_cols:
            if col in df.columns:
                return col
        return None
    
    def _analyze_risk_distribution(self, breached_df):
        """
        Analyze risk distribution of flagged entities
        
        Looks for risk indicators in the data:
        - risk_rating column
        - canonical_risk_rating column
        - customer_risk_rating column
        """
        risk_breakdown = {'High': 0, 'Medium': 0, 'Low': 0, 'Unknown': 0}
        
        # Try to find risk column
        risk_cols = ['risk_rating', 'canonical_risk_rating', 'customer_risk_rating']
        risk_col = None
        
        for col in risk_cols:
            if col in breached_df.columns:
                risk_col = col
                break
        
        if risk_col:
            # Normalize values to uppercase
            risk_values = breached_df[risk_col].str.upper() if breached_df[risk_col].dtype == 'object' else breached_df[risk_col]
            counts = risk_values.value_counts()
            
            risk_breakdown = {
                'High': int(counts.get('HIGH', 0)),
                'Medium': int(counts.get('MEDIUM', 0)) + int(counts.get('MED', 0)),
                'Low': int(counts.get('LOW', 0)),
                'Unknown': int(breached_df[risk_col].isnull().sum())
            }
        else:
            # No risk column found
            risk_breakdown['Unknown'] = len(breached_df)
        
        return risk_breakdown
    
    def _compute_additional_metrics(self, breached_df, metric_col):
        """
        Compute additional analytics for the breached population
        """
        if breached_df.empty:
            return {
                'avg_breach_amount': 0,
                'max_breach_amount': 0,
                'total_breach_volume': 0
            }
        
        values = breached_df[metric_col].dropna()
        
        return {
            'avg_breach_amount': round(float(values.mean()), 2) if len(values) > 0 else 0,
            'max_breach_amount': round(float(values.max()), 2) if len(values) > 0 else 0,
            'total_breach_volume': round(float(values.sum()), 2) if len(values) > 0 else 0,
            'median_breach_amount': round(float(values.median()), 2) if len(values) > 0 else 0
        }
    
    def _store_simulation(self, run_id, metric, result):
        """
        Store simulation result in database for:
        - Historical tracking
        - Comparison across thresholds
        - Audit trail
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            simulation_id = str(uuid.uuid4())
            
            # Determine percentile label
            percentile_label = f"p{int(result['percentile'])}" if result['percentile'] > 0 else "custom"
            
            cursor.execute("""
                INSERT INTO threshold_simulations
                (simulation_id, run_id, metric, threshold_value, percentile_label,
                 alerts_triggered, unique_entities_flagged, pct_population_flagged,
                 high_risk_count, medium_risk_count, low_risk_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                simulation_id,
                run_id,
                metric,
                result['threshold_value'],
                percentile_label,
                result['alerts_triggered'],
                result['unique_entities_flagged'],
                result['pct_population_flagged'],
                result['risk_breakdown'].get('High', 0),
                result['risk_breakdown'].get('Medium', 0),
                result['risk_breakdown'].get('Low', 0)
            ))
            
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Failed to store simulation: {e}")
        finally:
            conn.close()
    
    def get_all_simulations(self, run_id):
        """
        Retrieve all simulations for comparison
        
        Useful for:
        - Showing threshold comparison table
        - Generating charts
        - Finding optimal threshold
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT threshold_value, percentile_label, alerts_triggered,
                   unique_entities_flagged, pct_population_flagged,
                   high_risk_count, medium_risk_count, low_risk_count,
                   simulated_at
            FROM threshold_simulations
            WHERE run_id = ?
            ORDER BY threshold_value ASC
        """, (run_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        simulations = []
        for row in rows:
            simulations.append({
                'threshold_value': row[0],
                'percentile_label': row[1],
                'alerts_triggered': row[2],
                'unique_entities_flagged': row[3],
                'pct_population_flagged': row[4],
                'risk_breakdown': {
                    'High': row[5],
                    'Medium': row[6],
                    'Low': row[7]
                },
                'simulated_at': row[8]
            })
        
        return simulations
    
    def find_optimal_threshold(self, run_id, target_alert_range=(100, 500)):
        """
        Find the optimal threshold based on target alert volume
        
        Args:
            target_alert_range: (min, max) desired alert count
        
        Returns:
            Best matching simulation result
        """
        simulations = self.get_all_simulations(run_id)
        
        if not simulations:
            return None
        
        # Filter simulations within target range
        candidates = [
            sim for sim in simulations
            if target_alert_range[0] <= sim['alerts_triggered'] <= target_alert_range[1]
        ]
        
        if not candidates:
            # Find closest
            candidates = simulations
        
        # Prefer middle of range for balance
        target_midpoint = (target_alert_range[0] + target_alert_range[1]) / 2
        optimal = min(candidates, key=lambda s: abs(s['alerts_triggered'] - target_midpoint))
        
        return optimal