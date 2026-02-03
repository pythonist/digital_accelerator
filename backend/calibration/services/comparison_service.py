# backend/calibration/services/comparison_service.py
"""
Comparison Service - Step 5 (Future)
Compares bank alerts with tool-generated alerts
"""
import pandas as pd
import json
import uuid

class ComparisonService:
    """Handle bank alert comparison"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def load_bank_alerts(self, env_id, bank_alerts_csv):
        """
        Load bank's alert master file
        
        Expected columns:
        - alert_id
        - account_id
        - alert_date
        
        Returns:
            {
                'row_count': int,
                'date_range': {...},
                'sample': [...]
            }
        """
        df = pd.read_csv(bank_alerts_csv)
        
        # Normalize column names
        df.columns = [col.strip().lower().replace(' ', '_') for col in df.columns]
        
        # Validate required columns
        required = ['alert_id', 'account_id', 'alert_date']
        missing = [col for col in required if col not in df.columns]
        
        if missing:
            raise ValueError(f"Missing required columns: {missing}")
        
        # Store in temp table
        table_name = f"{env_id}_bank_alerts"
        conn = self.db.connect()
        df.to_sql(table_name, conn, if_exists='replace', index=False)
        conn.close()
        
        return {
            'table_name': table_name,
            'row_count': len(df),
            'date_range': {
                'start': df['alert_date'].min(),
                'end': df['alert_date'].max()
            },
            'sample': df.head(10).to_dict('records')
        }
    
    def compare_alerts(self, run_id, bank_alerts_table):
        """
        Compare bank alerts with tool-generated alerts
        
        Logic:
        - Tool alerts = Aggregated population WHERE value >= threshold
        - Bank alerts = Bank alert master
        - Match on: (account_id, alert_date)
        
        Returns:
            {
                'comparison_id': str,
                'bank_alert_count': int,
                'tool_alert_count': int,
                'common_alerts': int,
                'bank_only_alerts': int,
                'tool_only_alerts': int,
                'match_rate': float,
                'details': [...]
            }
        """
        # Get tool alerts (from aggregated population above threshold)
        tool_alerts_df = self._get_tool_alerts(run_id)
        
        # Get bank alerts
        conn = self.db.connect()
        bank_alerts_df = pd.read_sql_query(
            f'SELECT * FROM "{bank_alerts_table}"',
            conn
        )
        conn.close()
        
        print(f"🔄 Comparing {len(bank_alerts_df)} bank alerts vs {len(tool_alerts_df)} tool alerts")
        
        # Normalize dates for matching
        bank_alerts_df['alert_date'] = pd.to_datetime(bank_alerts_df['alert_date']).dt.date
        tool_alerts_df['anchor_date'] = pd.to_datetime(tool_alerts_df['anchor_date']).dt.date
        
        # Create match keys
        bank_alerts_df['match_key'] = (
            bank_alerts_df['account_id'].astype(str) + '_' + 
            bank_alerts_df['alert_date'].astype(str)
        )
        
        tool_alerts_df['match_key'] = (
            tool_alerts_df['account_id'].astype(str) + '_' + 
            tool_alerts_df['anchor_date'].astype(str)
        )
        
        # Perform comparison
        bank_keys = set(bank_alerts_df['match_key'])
        tool_keys = set(tool_alerts_df['match_key'])
        
        common = bank_keys & tool_keys
        bank_only = bank_keys - tool_keys
        tool_only = tool_keys - bank_keys
        
        # Calculate metrics
        match_rate = (len(common) / len(bank_keys) * 100) if len(bank_keys) > 0 else 0
        
        result = {
            'bank_alert_count': len(bank_alerts_df),
            'tool_alert_count': len(tool_alerts_df),
            'common_alerts': len(common),
            'bank_only_alerts': len(bank_only),
            'tool_only_alerts': len(tool_only),
            'match_rate': round(match_rate, 2),
            'precision': round(len(common) / len(tool_keys) * 100, 2) if len(tool_keys) > 0 else 0,
            'recall': round(len(common) / len(bank_keys) * 100, 2) if len(bank_keys) > 0 else 0
        }
        
        # Store comparison
        comparison_id = self._store_comparison(run_id, result, common, bank_only, tool_only)
        result['comparison_id'] = comparison_id
        
        print(f"✅ Comparison complete: {result['match_rate']:.1f}% match rate")
        
        return result
    
    def _get_tool_alerts(self, run_id):
        """
        Get tool-generated alerts (aggregated population above threshold)
        
        Returns DataFrame with: account_id, anchor_date, aggregated_amount
        """
        # Get threshold
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT selected_threshold, env_id, scenario_config, aggregation_config
            FROM calibration_runs
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Run {run_id} not found")
        
        threshold = row[0]
        if threshold is None:
            raise ValueError("No threshold selected for this run")
        
        env_id = row[1]
        scenario_config = json.loads(row[2]) if row[2] else {}
        aggregation_config = json.loads(row[3]) if row[3] else {}
        
        conn.close()
        
        # Rebuild aggregated population and filter by threshold
        from .threshold_service import ThresholdService
        threshold_service = ThresholdService(self.db)
        aggregated_df = threshold_service._load_aggregated_df(run_id)
        
        # Filter by threshold
        tool_alerts = aggregated_df[aggregated_df['aggregated_amount'] >= threshold].copy()
        
        return tool_alerts[['account_id', 'anchor_date', 'aggregated_amount']]
    
    def _store_comparison(self, run_id, result, common, bank_only, tool_only):
        """Store comparison results in DB"""
        comparison_id = str(uuid.uuid4())
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        details = {
            'common_alerts': list(common),
            'bank_only_alerts': list(bank_only),
            'tool_only_alerts': list(tool_only)
        }
        
        cursor.execute("""
            INSERT INTO bank_alert_comparison
            (comparison_id, run_id, bank_alert_count, tool_alert_count,
             common_alerts, bank_only_alerts, tool_only_alerts, comparison_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            comparison_id,
            run_id,
            result['bank_alert_count'],
            result['tool_alert_count'],
            result['common_alerts'],
            result['bank_only_alerts'],
            result['tool_only_alerts'],
            json.dumps(details)
        ))
        
        conn.commit()
        conn.close()
        
        return comparison_id
    
    def get_comparison_details(self, comparison_id):
        """Retrieve detailed comparison results"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT run_id, bank_alert_count, tool_alert_count,
                   common_alerts, bank_only_alerts, tool_only_alerts,
                   comparison_details, created_at
            FROM bank_alert_comparison
            WHERE comparison_id = ?
        """, (comparison_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        details = json.loads(row[6]) if row[6] else {}
        
        return {
            'comparison_id': comparison_id,
            'run_id': row[0],
            'bank_alert_count': row[1],
            'tool_alert_count': row[2],
            'common_alerts': row[3],
            'bank_only_alerts': row[4],
            'tool_only_alerts': row[5],
            'match_rate': round(row[3] / row[1] * 100, 2) if row[1] > 0 else 0,
            'details': details,
            'created_at': row[7]
        }
    
    def export_comparison_report(self, comparison_id):
        """
        Export comparison as detailed CSV report
        
        Returns:
            {
                'csv_path': str,
                'summary': {...}
            }
        """
        details = self.get_comparison_details(comparison_id)
        
        if not details:
            raise ValueError(f"Comparison {comparison_id} not found")
        
        # Create detailed report DataFrame
        comparison_details = details['details']
        
        rows = []
        
        # Common alerts
        for key in comparison_details.get('common_alerts', []):
            rows.append({
                'match_key': key,
                'category': 'Both Bank & Tool',
                'status': 'Match'
            })
        
        # Bank only
        for key in comparison_details.get('bank_only_alerts', []):
            rows.append({
                'match_key': key,
                'category': 'Bank Only',
                'status': 'False Negative'
            })
        
        # Tool only
        for key in comparison_details.get('tool_only_alerts', []):
            rows.append({
                'match_key': key,
                'category': 'Tool Only',
                'status': 'False Positive'
            })
        
        df = pd.DataFrame(rows)
        
        # Save to CSV
        csv_path = f"data/calibration/comparison_{comparison_id}.csv"
        df.to_csv(csv_path, index=False)
        
        return {
            'csv_path': csv_path,
            'summary': {
                'total_rows': len(df),
                'matches': details['common_alerts'],
                'false_negatives': details['bank_only_alerts'],
                'false_positives': details['tool_only_alerts']
            }
        }