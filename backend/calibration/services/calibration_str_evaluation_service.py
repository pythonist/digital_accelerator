# backend/calibration/services/calibration_str_evaluation_service.py
"""
STR Evaluation Service - Read-Only Ground Truth Overlay
CRITICAL: STR is downstream of calibration, used ONLY for evaluation

FIXED VERSION - Simplified for: account_id + str_filed_date ONLY
No complex date logic - just match by account_id
"""
import pandas as pd
import json
from datetime import datetime


class CalibrationSTREvaluationService:
    """
    Evaluates calibration effectiveness against STR ground truth
    
    SCOPE LIMITATION:
    - This service is READ-ONLY
    - STR data is NEVER used in aggregation or threshold selection
    - STR is applied AFTER calibration to measure effectiveness
    
    SIMPLIFIED SCHEMA:
    - Only uses: account_id, str_filed_date
    - Matches STRs to alerted accounts by account_id only
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def evaluate_str_capture(self, run_id, threshold, metric='amount'):
        """
        Evaluate STR capture for a given calibration outcome
        
        Simple logic:
        1. Get alerted account IDs from calibration
        2. Get all STR account IDs from database
        3. Compare sets to find captured vs missed
        
        Args:
            run_id: Calibration run identifier
            threshold: Applied threshold value
            metric: 'amount' or 'count'
        
        Returns:
            {
                total_strs: int,
                captured_strs: int,
                missed_strs: int,
                false_positives: int,
                capture_rate: float,
                precision: float
            }
        """
        # 1. Load alerted accounts from calibration outcome
        alerted_accounts = self._get_alerted_accounts(run_id, threshold, metric)
        
        if not alerted_accounts:
            return self._empty_evaluation()
        
        # 2. Load STR data (SIMPLIFIED - just get all STR account IDs)
        str_accounts = self._load_str_accounts_simple()
        
        if not str_accounts:
            return {
                **self._empty_evaluation(),
                'note': 'No STR data available. Ensure strs table exists with account_id and str_filed_date columns.'
            }
        
        # 3. Set-based comparison
        alerted_set = set(alerted_accounts)
        str_set = set(str_accounts)
        
        # Core metrics
        captured = alerted_set & str_set  # Intersection
        missed = str_set - alerted_set     # STRs we didn't alert on
        false_positives = alerted_set - str_set  # Alerts without STR
        
        total_strs = len(str_set)
        captured_count = len(captured)
        missed_count = len(missed)
        fp_count = len(false_positives)
        
        # Rates
        capture_rate = round((captured_count / total_strs) * 100, 2) if total_strs > 0 else 0.0
        precision = round((captured_count / len(alerted_set)) * 100, 2) if len(alerted_set) > 0 else 0.0
        
        return {
            'total_strs': total_strs,
            'captured_strs': captured_count,
            'missed_strs': missed_count,
            'false_positives': fp_count,
            'total_alerts': len(alerted_set),
            'capture_rate': capture_rate,
            'precision': precision,
            'str_accounts': list(str_set),
            'captured_str_accounts': list(captured),
            'missed_str_accounts': list(missed),
            'timestamp': datetime.now().isoformat()
        }
    
    def get_missed_str_details(self, run_id, threshold, metric='amount', limit=50):
        """
        Get detailed records for missed STRs
        Returns account details + aggregated metrics for missed STR accounts
        """
        evaluation = self.evaluate_str_capture(run_id, threshold, metric)
        missed_accounts = evaluation.get('missed_str_accounts', [])
        
        if not missed_accounts:
            return {
                'total_missed': 0,
                'records': []
            }
        
        # Load aggregated data for these accounts
        from calibration.shared.calibration_helpers import load_calibration_population
        df, metadata = load_calibration_population(run_id, self.db)
        
        # Filter to missed STR accounts
        missed_df = df[df['account_id'].isin(missed_accounts)]
        
        # Get metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in missed_df.columns:
            numeric_cols = missed_df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Build records
        records = []
        for _, row in missed_df.head(limit).iterrows():
            record = {
                'account_id': row.get('account_id', 'N/A'),
                'customer_id': row.get('customer_id', 'N/A'),
                'aggregated_value': float(row[target_col]) if target_col and target_col in row else 0,
                'distance_from_threshold': float(row[target_col] - threshold) if target_col and target_col in row else 0,
                'distance_pct': round(((row[target_col] - threshold) / threshold * 100), 2) if target_col and target_col in row and threshold > 0 else 0
            }
            
            # Add any available risk indicators
            for col in ['risk_rating', 'customer_type', 'account_type']:
                if col in row:
                    record[col] = str(row[col])
            
            records.append(record)
        
        return {
            'total_missed': len(missed_accounts),
            'records': records,
            'note': 'These STR accounts fell below the threshold - they were suppressed but later filed STRs'
        }
    
    def compare_threshold_str_impact(self, run_id, thresholds, metric='amount'):
        """
        Compare STR capture across multiple threshold scenarios
        Useful for understanding trade-offs
        """
        results = []
        
        for threshold in thresholds:
            eval_result = self.evaluate_str_capture(run_id, threshold, metric)
            
            results.append({
                'threshold': threshold,
                'total_alerts': eval_result['total_alerts'],
                'captured_strs': eval_result['captured_strs'],
                'missed_strs': eval_result['missed_strs'],
                'capture_rate': eval_result['capture_rate'],
                'precision': eval_result['precision']
            })
        
        return {
            'scenarios': results,
            'total_strs': results[0]['captured_strs'] + results[0]['missed_strs'] if results else 0,
            'note': 'Comparison of STR capture across different thresholds'
        }
    
    def _get_alerted_accounts(self, run_id, threshold, metric):
        """
        Get list of alerted account IDs for a given threshold
        Uses existing calibration outcome logic
        """
        from calibration.shared.calibration_helpers import load_calibration_population, ThresholdApplicator
        
        try:
            df, metadata = load_calibration_population(run_id, self.db)
            
            col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
            target_col = col_map.get(metric, 'aggregated_amount')
            
            if target_col not in df.columns:
                numeric_cols = df.select_dtypes(include=['number']).columns
                target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
            
            if not target_col:
                return []
            
            # Apply threshold
            applicator = ThresholdApplicator()
            result = applicator.apply_threshold(df, target_col, threshold)
            
            alerted_df = result['alerted_df']
            
            if alerted_df.empty or 'account_id' not in alerted_df.columns:
                return []
            
            return alerted_df['account_id'].unique().tolist()
            
        except Exception as e:
            print(f"⚠️ Error loading alerted accounts: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def _load_str_accounts_simple(self):
        """
        Load all STR account IDs from database
        
        SIMPLIFIED: Just get distinct account_ids from strs table
        No date filtering - assumes STRs are relevant to analysis period
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # ✅ SIMPLE QUERY: Just get all unique account_ids
            cursor.execute("""
                SELECT DISTINCT account_id
                FROM strs
                WHERE account_id IS NOT NULL
            """)
            
            str_accounts = [row['account_id'] for row in cursor.fetchall()]
            
            if str_accounts:
                print(f"✅ Loaded {len(str_accounts)} unique STR accounts")
            else:
                print("⚠️ No STR accounts found in database")
                print("💡 Ensure 'strs' table has data with columns: account_id, str_filed_date")
            
            return str_accounts
            
        except Exception as e:
            print(f"❌ Error loading STR data: {e}")
            print("\n📋 Expected STR table schema:")
            print("   CREATE TABLE strs (")
            print("       account_id TEXT NOT NULL,")
            print("       str_filed_date DATE NOT NULL")
            print("   );")
            print("\n💡 Make sure:")
            print("   1. Table 'strs' exists")
            print("   2. Column 'account_id' exists")
            print("   3. Table has data")
            
            import traceback
            traceback.print_exc()
            
            return []
        finally:
            conn.close()
    
    def _empty_evaluation(self):
        """Return empty evaluation structure"""
        return {
            'total_strs': 0,
            'captured_strs': 0,
            'missed_strs': 0,
            'false_positives': 0,
            'total_alerts': 0,
            'capture_rate': 0.0,
            'precision': 0.0,
            'str_accounts': [],
            'captured_str_accounts': [],
            'missed_str_accounts': []
        }
    
    def check_str_table_exists(self):
        """
        Utility method to check if STR table exists and has data
        Useful for debugging
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Check if table exists
            cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='strs'
            """)
            
            table_exists = cursor.fetchone() is not None
            
            if not table_exists:
                return {
                    'exists': False,
                    'row_count': 0,
                    'sample_data': [],
                    'message': 'STR table does not exist'
                }
            
            # Count rows
            cursor.execute("SELECT COUNT(*) as count FROM strs")
            row_count = cursor.fetchone()['count']
            
            # Get sample data
            cursor.execute("SELECT * FROM strs LIMIT 5")
            sample_data = [dict(row) for row in cursor.fetchall()]
            
            return {
                'exists': True,
                'row_count': row_count,
                'sample_data': sample_data,
                'message': f'STR table exists with {row_count} rows'
            }
            
        except Exception as e:
            return {
                'exists': False,
                'row_count': 0,
                'sample_data': [],
                'message': f'Error checking STR table: {str(e)}'
            }
        finally:
            conn.close()