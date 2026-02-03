# backend/calibration/builder/percentile_engine.py
"""
Percentile Engine - Step 3 (ENHANCED)
Computes statistical distribution of the aggregated population with proper storage
"""
import pandas as pd
import numpy as np
import json

class PercentileEngine:
    """
    Handles percentile calculation and distribution analysis
    
    Core Logic:
    1. Takes V2 (aggregated population) as input
    2. Computes percentiles: p50, p55, p60...p99
    3. Each percentile value becomes a candidate threshold
    4. Stores results for visualization
    """
    
    def __init__(self, db_manager):
        self.db = db_manager

    def compute_histogram(self, df, metric_col, bins=50):
        """
        Generates distribution shape for visualization.
        Returns: List of { bin_start, bin_end, count, cumulative_count }
        """
        values = df[metric_col].dropna()
        if values.empty: return []

        # Use numpy to compute histogram (efficient)
        counts, bin_edges = np.histogram(values, bins=bins)
        
        total = len(values)
        cumulative = 0
        histogram = []

        for i in range(len(counts)):
            count = int(counts[i])
            cumulative += count
            histogram.append({
                'bin_start': float(bin_edges[i]),
                'bin_end': float(bin_edges[i+1]),
                'count': count,
                'pct_of_total': (count / total) * 100,
                'cumulative_pct': (cumulative / total) * 100
            })
        
        return histogram

    def compute_percentiles(self, run_id, aggregated_df, metric='amount'):
        """
        Compute percentile distribution from aggregated data (V2).
        """
        if aggregated_df.empty:
            raise ValueError("Aggregated DataFrame is empty. Cannot compute percentiles.")
        
        # 1. Identify the target column
        col_map = {
            'amount': 'aggregated_amount', 
            'count': 'aggregated_count'
        }
        target_col = col_map.get(metric, 'aggregated_amount')
        
        # Fallback search
        if target_col not in aggregated_df.columns:
            numeric_cols = aggregated_df.select_dtypes(include=[np.number]).columns
            if len(numeric_cols) > 0:
                target_col = numeric_cols[0]
            else:
                raise ValueError(f"No numeric column found for metric '{metric}'")
        
        print(f"📊 Computing percentiles on column: {target_col}")
        
        # 2. Extract values
        values = aggregated_df[target_col].dropna()
        total_rows = len(values)
        
        if total_rows == 0:
            raise ValueError(f"No valid values in column '{target_col}'")
        
        # 3. Define percentiles to compute (Granular at high end)
        percentiles_to_calc = [
            50, 55, 60, 65, 70, 75, 80, 85, 
            90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 99.5, 99.9
        ]
        
        results = []
        
        # 4. Compute each percentile
        for p in percentiles_to_calc:
            threshold_val = float(np.percentile(values, p))
            
            # Impact simulation
            breached = values[values >= threshold_val]
            alert_count = len(breached)
            pct_population = round((alert_count / total_rows) * 100, 2)
            
            result = {
                'percentile': p,
                'threshold': round(threshold_val, 2),
                'alert_count': int(alert_count),
                'pct_population': pct_population,
                'unique_entities': 0
            }
            
            # Count unique entities if ID exists
            entity_cols = ['account_id', 'customer_id', 'entity_id']
            for entity_col in entity_cols:
                if entity_col in aggregated_df.columns:
                    breached_df = aggregated_df[aggregated_df[target_col] >= threshold_val]
                    result['unique_entities'] = int(breached_df[entity_col].nunique())
                    break
            
            results.append(result)
        
        # 5. Store in database
        self._store_percentiles(run_id, metric, results)
        
        # 6. NEW: Compute Histogram for UI
        histogram = self.compute_histogram(aggregated_df, target_col)
        
        return {
            'percentiles': results,
            'histogram': histogram,
            'stats': {
                'min': float(values.min()),
                'max': float(values.max()),
                'mean': float(values.mean()),
                'total_count': total_rows
            }
        }

    def _store_percentiles(self, run_id, metric_name, results):
        """
        Store percentile results in database
        
        This enables:
        - Fast retrieval without recomputation
        - Historical tracking
        - Comparison across runs
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Clear existing percentiles for this run/metric
            cursor.execute("""
                DELETE FROM calibration_percentiles 
                WHERE run_id = ? AND metric_name = ?
            """, (run_id, metric_name))
            
            # Insert all percentiles
            for result in results:
                cursor.execute("""
                    INSERT INTO calibration_percentiles 
                    (run_id, metric_name, percentile, value, alert_count, unique_entities, pct_population)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    run_id,
                    metric_name,
                    result['percentile'],
                    result['threshold'],
                    result['alert_count'],
                    result.get('unique_entities', 0),
                    result['pct_population']
                ))
            
            conn.commit()
            print(f"💾 Stored {len(results)} percentiles in database")
            
        except Exception as e:
            conn.rollback()
            print(f"❌ Failed to store percentiles: {e}")
            raise
        finally:
            conn.close()

    def get_stored_percentiles(self, run_id, metric='amount'):
        """
        Retrieve previously computed percentiles from database
        
        Returns:
            List of percentile objects (same format as compute_percentiles)
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT percentile, value, alert_count, unique_entities, pct_population 
            FROM calibration_percentiles 
            WHERE run_id = ? AND metric_name = ? 
            ORDER BY percentile ASC
        """, (run_id, metric))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return []
        
        results = []
        for row in rows:
            results.append({
                'percentile': row[0],
                'threshold': row[1],
                'alert_count': row[2],
                'unique_entities': row[3],
                'pct_population': row[4]
            })
        
        return results
    
    def get_distribution_summary(self, run_id, metric='amount'):
        """
        Get statistical summary of the distribution
        
        Returns:
            {
                'min': float,
                'max': float,
                'mean': float,
                'median': float,
                'std': float,
                'total_entities': int,
                'percentiles': [...]
            }
        """
        percentiles = self.get_stored_percentiles(run_id, metric)
        
        if not percentiles:
            return None
        
        # Extract key statistics
        p50 = next((p for p in percentiles if p['percentile'] == 50), None)
        
        summary = {
            'metric': metric,
            'total_entities': percentiles[0]['alert_count'] * 2,  # Rough estimate
            'median': p50['threshold'] if p50 else 0,
            'percentiles': percentiles,
            'key_thresholds': {
                'p75': next((p['threshold'] for p in percentiles if p['percentile'] == 75), None),
                'p90': next((p['threshold'] for p in percentiles if p['percentile'] == 90), None),
                'p95': next((p['threshold'] for p in percentiles if p['percentile'] == 95), None),
                'p99': next((p['threshold'] for p in percentiles if p['percentile'] == 99), None)
            }
        }
        
        return summary
    
    def find_threshold_for_alert_target(self, run_id, target_alert_count, metric='amount'):
        """
        Reverse lookup: Given a target alert count, find the threshold
        
        Example:
            "I want to generate ~500 alerts per month"
            → Returns: "Use threshold of ₹45,000 (p92)"
        """
        percentiles = self.get_stored_percentiles(run_id, metric)
        
        if not percentiles:
            return None
        
        # Find closest match
        closest = min(percentiles, key=lambda p: abs(p['alert_count'] - target_alert_count))
        
        return {
            'recommended_threshold': closest['threshold'],
            'percentile': closest['percentile'],
            'estimated_alerts': closest['alert_count'],
            'actual_target': target_alert_count,
            'variance': abs(closest['alert_count'] - target_alert_count)
        }
    # Add this method to PercentileEngine class
    