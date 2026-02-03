# backend/calibration/services/calibration_outcome_service.py
"""
Calibration Outcome Service - Entity Realization Layer
Materializes which accounts/customers are alerted vs suppressed
"""
import pandas as pd
import json
from datetime import datetime
from calibration.shared.calibration_helpers import (
    CalibrationContracts,
    ThresholdApplicator,
    load_calibration_population
)


class CalibrationOutcomeService:
    """
    Handles entity-level impact analysis and outcome persistence
    Core responsibility: Answer "Which entities are alerted?"
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
        self.applicator = ThresholdApplicator()
    
    def get_outcome_impact(self, run_id, threshold, percentile, metric='amount'):
        """
        Get comprehensive outcome impact for a threshold
        
        Returns:
            - Entity counts (alerted/suppressed/near-miss)
            - Customer rollup
            - Summary statistics
        """
        # Load aggregated population
        df, metadata = load_calibration_population(run_id, self.db)
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            # Fallback to first numeric column
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if not target_col:
            raise ValueError(f"No numeric column found for metric '{metric}'")
        
        # Apply threshold using centralized logic
        result = self.applicator.apply_threshold(df, target_col, threshold)
        
        # Get customer rollup
        customer_rollup = self.applicator.get_customer_rollup(result['alerted_df'])
        
        # Convert numpy types for JSON serialization
        summary = self._sanitize_dict(result['summary'])
        near_miss_band = self._sanitize_dict(result['near_miss_band'])
        customer_rollup = self._sanitize_dict(customer_rollup)
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "threshold": float(threshold),
            "percentile": float(percentile),
            "metric": metric,
            "summary": summary,
            "near_miss_band": near_miss_band,
            "customer_rollup": customer_rollup
        }
    def _normalize_column_name(self, df, desired_col):
        """
        Find column regardless of table prefix
        Example: 'customer_id' matches 't0_customer_id', 't1_customer_id', etc.
        """
        if desired_col in df.columns:
            return desired_col
        
        # Try with common prefixes
        for prefix in ['t0_', 't1_', 't2_', 't3_']:
            prefixed = f"{prefix}{desired_col}"
            if prefixed in df.columns:
                return prefixed
        
        # Try without prefix if starts with t0_, t1_, etc
        for col in df.columns:
            if col.lower().endswith(f"_{desired_col}") or col.lower() == desired_col:
                return col
        
        return None
    
    def get_alert_population(self, run_id, threshold, metric='amount', 
                        category='alerted', limit=100, offset=0):
        """
        Get paginated entity population table - FIXED for prefixed columns
        """
        # Load data
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Apply threshold
        result = self.applicator.apply_threshold(df, target_col, threshold)
        
        # Select appropriate dataframe
        if category == 'alerted':
            population_df = result['alerted_df']
        elif category == 'suppressed':
            population_df = result['suppressed_df']
        elif category == 'near_miss':
            population_df = result['near_miss_df']
        else:
            raise ValueError(f"Invalid category: {category}")
        
        total_count = len(population_df)
        
        # Add distance from threshold
        if not population_df.empty and target_col in population_df.columns:
            population_df = population_df.copy()
            population_df['distance_from_threshold'] = population_df[target_col] - threshold
            population_df['distance_pct'] = ((population_df[target_col] - threshold) / threshold * 100).round(2)
        
        # Paginate
        paginated_df = population_df.iloc[offset:offset+limit]
        
        # ✅ FIX: Smart column detection for prefixed names
        account_id_col = self._normalize_column_name(paginated_df, 'account_id')
        customer_id_col = self._normalize_column_name(paginated_df, 'customer_id')
        transaction_date_col = self._normalize_column_name(paginated_df, 'transaction_date')
        transaction_category_col = self._normalize_column_name(paginated_df, 'transaction_category')
        transaction_type_col = self._normalize_column_name(paginated_df, 'transaction_type')
        
        # Convert to records
        records = []
        for _, row in paginated_df.iterrows():
            record = {
                'account_id': row.get(account_id_col, 'N/A') if account_id_col else 'N/A',
                'customer_id': row.get(customer_id_col, 'N/A') if customer_id_col else 'N/A',
                'value': float(row[target_col]) if target_col in row else 0,
                'distance_from_threshold': float(row.get('distance_from_threshold', 0)),
                'distance_pct': float(row.get('distance_pct', 0)),
                'category': category
            }
            
            # Add optional columns
            if transaction_date_col and transaction_date_col in row:
                record['transaction_date'] = str(row[transaction_date_col])
            if transaction_category_col and transaction_category_col in row:
                record['transaction_category'] = str(row[transaction_category_col])
            if transaction_type_col and transaction_type_col in row:
                record['transaction_type'] = str(row[transaction_type_col])
            
            records.append(record)
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "category": category,
            "total_count": int(total_count),
            "page_size": limit,
            "offset": offset,
            "records": records
        }
        
    def get_customer_impact(self, run_id, threshold, metric='amount'):
        """
        Get customer-level impact analysis
        """
        df, metadata = load_calibration_population(run_id, self.db)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        result = self.applicator.apply_threshold(df, target_col, threshold)
        customer_rollup = self.applicator.get_customer_rollup(result['alerted_df'])
        
        return {
            "alert_grain": CalibrationContracts.alert_grain(metadata.get('level', 'ACCOUNT_DATE')),
            "threshold": float(threshold),
            **self._sanitize_dict(customer_rollup)
        }
    
    def persist_approved_outcome(self, run_id, threshold, percentile, metric, 
                                rationale, approved_by):
        """
        Persist immutable calibration outcome
        MANDATORY for audit trail
        """
        # Get full outcome
        outcome = self.get_outcome_impact(run_id, threshold, percentile, metric)
        
        # Load data to get entity IDs
        df, _ = load_calibration_population(run_id, self.db)
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        result = self.applicator.apply_threshold(df, target_col, threshold)
        
        # Extract entity IDs
        alert_account_ids = []
        alert_customer_ids = []
        
        if not result['alerted_df'].empty:
            if 'account_id' in result['alerted_df'].columns:
                alert_account_ids = result['alerted_df']['account_id'].unique().tolist()
            if 'customer_id' in result['alerted_df'].columns:
                alert_customer_ids = result['alerted_df']['customer_id'].unique().tolist()
        
        # Generate outcome ID
        outcome_id = f"{run_id}_outcome_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Persist to database
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO calibration_outcomes (
                    outcome_id, run_id, metric, percentile, threshold,
                    alert_account_ids, alert_customer_ids, summary_json,
                    near_miss_band_json, rationale, approved_by, approved_at,
                    is_immutable
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
            """, (
                outcome_id,
                run_id,
                metric,
                float(percentile),
                float(threshold),
                json.dumps(alert_account_ids),
                json.dumps(alert_customer_ids),
                json.dumps(outcome['summary']),
                json.dumps(outcome['near_miss_band']),
                rationale,
                approved_by
            ))
            
            # Update run status
            cursor.execute("""
                UPDATE calibration_runs
                SET status = 'approved',
                    selected_threshold = ?,
                    selected_percentile = ?,
                    estimated_alert_count = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
            """, (
                float(threshold),
                float(percentile),
                outcome['summary']['alerted_count'],
                run_id
            ))
            
            conn.commit()
            
            return {
                "outcome_id": outcome_id,
                "run_id": run_id,
                "threshold": threshold,
                "percentile": percentile,
                "alerted_accounts": outcome['summary']['alerted_accounts'],
                "alerted_customers": outcome['summary']['alerted_customers'],
                "approved_by": approved_by,
                "approved_at": datetime.now().isoformat(),
                "is_immutable": True
            }
            
        except Exception as e:
            conn.rollback()
            raise Exception(f"Failed to persist outcome: {e}")
        finally:
            conn.close()
    
    def get_approved_outcome(self, run_id):
        """Retrieve approved outcome for a run"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT outcome_id, run_id, metric, percentile, threshold,
                   alert_account_ids, alert_customer_ids, summary_json,
                   near_miss_band_json, rationale, approved_by, approved_at
            FROM calibration_outcomes
            WHERE run_id = ? AND is_immutable = 1
            ORDER BY approved_at DESC
            LIMIT 1
        """, (run_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            "outcome_id": row[0],
            "run_id": row[1],
            "metric": row[2],
            "percentile": row[3],
            "threshold": row[4],
            "alert_account_ids": json.loads(row[5]) if row[5] else [],
            "alert_customer_ids": json.loads(row[6]) if row[6] else [],
            "summary": json.loads(row[7]) if row[7] else {},
            "near_miss_band": json.loads(row[8]) if row[8] else {},
            "rationale": row[9],
            "approved_by": row[10],
            "approved_at": row[11]
        }
    
    def _sanitize_dict(self, obj):
        """Convert numpy types to Python natives for JSON"""
        import numpy as np
        
        if isinstance(obj, dict):
            return {k: self._sanitize_dict(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._sanitize_dict(v) for v in obj]
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj