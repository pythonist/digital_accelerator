# backend/calibration/services/golden_dataset_builder.py
"""
Golden Dataset Builder - DYNAMIC MAPPING SUPPORT
Creates master dataset: TRANSACTIONS LEFT JOIN ACCOUNTS LEFT JOIN CUSTOMERS
Uses stored schema mappings to alias source columns to canonical names.
"""
import pandas as pd
import sqlite3
import json
from pathlib import Path
import uuid
from datetime import datetime

class GoldenDatasetBuilder:
    """Builds golden dataset with proper joins and dynamic column mapping"""
    
    def __init__(self, db_manager):
        self.db_manager = db_manager
    
    def _get_mapping(self, env_id):
        """Retrieve stored column mapping for environment"""
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT mapping_config FROM schema_mappings 
            WHERE env_id = ? AND mapping_type = 'golden_source'
        """, (env_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row and row[0]:
            return json.loads(row[0])
        return None

    def build_golden_dataset(self, env_id):
        """
        Build golden dataset with proper joins and user-defined mapping.
        """
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        
        # 0. Load Mapping
        mapping = self._get_mapping(env_id)
        if not mapping:
            raise ValueError(f"Schema mapping not found for {env_id}. Please map columns first.")

        # Validate Join Keys
        required_keys = [
            ('transactions', 'account_id'),
            ('accounts', 'account_id'),
            ('accounts', 'customer_id'),
            ('customers', 'customer_id')
        ]
        for table, key in required_keys:
            if not mapping.get(table, {}).get(key):
                raise ValueError(f"Missing required mapping: '{key}' in '{table}'.")

        # 1. Check if all tables exist
        txn_table = f"{env_id}_transactions"
        acc_table = f"{env_id}_accounts"
        cust_table = f"{env_id}_customers"
        
        for table in [txn_table, acc_table, cust_table]:
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            if not cursor.fetchone():
                raise ValueError(f"Table {table} not found. Please upload all data first.")
        
        # 2. Perform LEFT JOINs with DYNAMIC MAPPING
        print(f"🔗 Building golden dataset for {env_id} using saved mapping...")
        
        golden_table = f"{env_id}_golden_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Helper: Returns 'alias."source_col" AS target_col'
        def get_col(table_key, map_key, target_alias=None):
            source_col = mapping.get(table_key, {}).get(map_key)
            final_name = target_alias if target_alias else map_key
            
            if not source_col:
                return f"NULL AS {final_name}"
            
            tbl_alias = 't' if table_key == 'transactions' else 'a' if table_key == 'accounts' else 'c'
            # Escape double quotes in column names
            safe_source = source_col.replace('"', '""')
            return f'{tbl_alias}."{safe_source}" AS {final_name}'

        # Construct SQL
        # We explicitly name columns to match downstream expectations (e.g. acc_account_id)
        join_query = f"""
        CREATE TABLE "{golden_table}" AS
        SELECT 
            -- Transaction fields
            {get_col('transactions', 'transaction_id')},
            {get_col('transactions', 'account_id')},
            {get_col('transactions', 'transaction_date')},
            {get_col('transactions', 'transaction_amount')},
            {get_col('transactions', 'transaction_type')},
            {get_col('transactions', 'transaction_category')},
            {get_col('transactions', 'transaction_direction')},
            
            -- Account fields (LEFT JOIN)
            {get_col('accounts', 'account_id', 'acc_account_id')},
            {get_col('accounts', 'customer_id', 'acc_customer_id')},
            {get_col('accounts', 'account_type')},
            {get_col('accounts', 'account_open_date')},
            {get_col('accounts', 'account_status')},
            
            -- Customer fields (LEFT JOIN)
            {get_col('customers', 'customer_id', 'cust_customer_id')},
            {get_col('customers', 'customer_type')},
            {get_col('customers', 'risk_rating', 'customer_risk_rating')},
            {get_col('customers', 'kyc_status')},
            {get_col('customers', 'pep_flag')}
            
        FROM "{txn_table}" t
        
        LEFT JOIN "{acc_table}" a 
            ON t."{mapping['transactions']['account_id']}" = a."{mapping['accounts']['account_id']}"
        
        LEFT JOIN "{cust_table}" c 
            ON a."{mapping['accounts']['customer_id']}" = c."{mapping['customers']['customer_id']}"
        """
        
        try:
            cursor.execute(join_query)
            conn.commit()
        except sqlite3.OperationalError as e:
            conn.close()
            raise ValueError(f"SQL Error: {e}")
        
        # 3. Generate join statistics
        cursor.execute(f'SELECT COUNT(*) FROM "{golden_table}"')
        total_rows = cursor.fetchone()[0]
        
        cursor.execute(f'SELECT COUNT(*) FROM "{golden_table}" WHERE acc_account_id IS NULL')
        unmatched_accounts = cursor.fetchone()[0]
        
        cursor.execute(f'SELECT COUNT(*) FROM "{golden_table}" WHERE cust_customer_id IS NULL')
        unmatched_customers = cursor.fetchone()[0]
        
        # 4. Get column names
        cursor.execute(f'PRAGMA table_info("{golden_table}")')
        columns = [row[1] for row in cursor.fetchall()]
        
        # 5. Cache metadata
        cache_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT OR REPLACE INTO golden_dataset_cache
            (cache_id, env_id, row_count, status, file_path, metadata)
            VALUES (?, ?, ?, 'ready', ?, ?)
        """, (
            cache_id,
            env_id,
            total_rows,
            golden_table,
            pd.io.json.dumps({
                'columns': columns,
                'join_stats': {
                    'total_transactions': total_rows,
                    'matched_accounts': total_rows - unmatched_accounts,
                    'unmatched_accounts': unmatched_accounts,
                    'matched_customers': total_rows - unmatched_customers,
                    'unmatched_customers': unmatched_customers
                }
            })
        ))
        conn.commit()
        
        join_report = [
            {
                'step': 'Transactions → Accounts',
                'join_type': 'LEFT JOIN',
                'matched': total_rows - unmatched_accounts,
                'unmatched': unmatched_accounts,
                'match_rate': round(((total_rows - unmatched_accounts) / total_rows * 100), 2) if total_rows > 0 else 0
            },
            {
                'step': 'Accounts → Customers',
                'join_type': 'LEFT JOIN',
                'matched': total_rows - unmatched_customers,
                'unmatched': unmatched_customers,
                'match_rate': round(((total_rows - unmatched_customers) / total_rows * 100), 2) if total_rows > 0 else 0
            }
        ]
        
        conn.close()
        print(f"✅ Golden dataset created: {golden_table}")
        
        return {
            'table_name': golden_table,
            'row_count': total_rows,
            'join_report': join_report,
            'columns': columns
        }
    
    def load_golden_dataset(self, env_id):
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT file_path FROM golden_dataset_cache
            WHERE env_id = ? AND status = 'ready'
            ORDER BY created_at DESC
            LIMIT 1
        """, (env_id,))
        
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"No golden dataset found for {env_id}. Please build it first.")
        
        golden_table = row[0]
        df = pd.read_sql_query(f'SELECT * FROM "{golden_table}"', conn)
        conn.close()
        return df
    
    def get_golden_preview(self, env_id, limit=100):
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT file_path, row_count, metadata FROM golden_dataset_cache
            WHERE env_id = ? AND status = 'ready'
            ORDER BY created_at DESC
            LIMIT 1
        """, (env_id,))
        
        row = cursor.fetchone()
        if not row:
            return None
        
        golden_table = row[0]
        total_count = row[1]
        metadata = pd.io.json.loads(row[2]) if row[2] else {}
        
        try:
            cursor.execute(f'SELECT * FROM "{golden_table}" LIMIT ?', (limit,))
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        except Exception:
            return None
            
        conn.close()
        return {
            'columns': columns,
            'rows': rows,
            'total_count': total_count,
            'join_stats': metadata.get('join_stats', {})
        }