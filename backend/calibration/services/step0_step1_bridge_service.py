# backend/calibration/services/step0_step1_bridge_service.py
"""
Step 0 → Step 1 Data Bridge Service - COMPLETE FIX
Creates canonical view with EXPLICIT column selection to prevent duplicates
Ensures accurate schema mapping for population filters
"""
import pandas as pd
from datetime import datetime
import json


class Step0Step1BridgeService:
    """
    Materializes Step 0 data into canonical format for Step 1.
    
    CRITICAL FIXES:
    1. Uses EXPLICIT column selection in SQL (not SELECT *)
    2. Aliases all columns to prevent duplicates (t0_account_id, c_account_id)
    3. Tracks semantic field mapping during SQL generation
    4. Creates accurate schema mapping for population filters
    5. No join explosion - pure logical view
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def materialize_for_step1(self, env_id: str, join_plan_id: str = None, 
                             dataset_mapping: dict = None) -> dict:
        """
        Create canonical view for Step 1 from Step 0 join plan.
        
        Args:
            env_id: Environment ID
            join_plan_id: ID of the saved join plan
            dataset_mapping: Optional {table_type: dataset_id} if no plan
        
        Returns:
            {
                'success': bool,
                'view_created': str,
                'schema_mapping': dict,
                'row_count': int,
                'message': str
            }
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            print(f"🔗 [BRIDGE] Creating logical view for Step 1: {env_id}")
            
            # ============================================================
            # STEP 1: Load Join Plan
            # ============================================================
            if join_plan_id:
                cursor.execute("""
                    SELECT chain_json FROM join_plans 
                    WHERE plan_id = ?
                """, (str(join_plan_id),))
                
                row = cursor.fetchone()
                if not row:
                    return {
                        'success': False,
                        'error': f'Join plan {join_plan_id} not found'
                    }
                
                chain = json.loads(row[0])
                print(f"✅ [BRIDGE] Loaded join plan with {len(chain)} steps")
            else:
                if not dataset_mapping:
                    return {
                        'success': False,
                        'error': 'Either join_plan_id or dataset_mapping required'
                    }
                chain = self._build_chain_from_mapping(env_id, dataset_mapping)
            
            # ============================================================
            # STEP 2: Build JOIN SQL with EXPLICIT columns (NEW)
            # ============================================================
            join_sql = self._build_join_sql_explicit_columns(env_id, chain)
            
            if not join_sql['success']:
                return join_sql
            
            sql = join_sql['sql']
            column_mapping = join_sql['column_mapping']
            
            print(f"📝 [BRIDGE] Generated JOIN SQL with {len(column_mapping)} mapped fields")
            
            # ============================================================
            # STEP 3: Create Logical VIEW
            # ============================================================
            view_name = f"{env_id}_calibration_data"
            
            cursor.execute(f"DROP VIEW IF EXISTS {view_name}")
            cursor.execute(f"CREATE VIEW {view_name} AS {sql}")
            
            print(f"✅ [BRIDGE] Created view: {view_name}")
            
            # ============================================================
            # STEP 4: Get Row Count
            # ============================================================
            cursor.execute(f'SELECT COUNT(*) FROM {view_name}')
            row_count = cursor.fetchone()[0]
            
            print(f"📊 [BRIDGE] View contains {row_count:,} rows")
            
            # ============================================================
            # STEP 5: Create Schema Mapping from tracked columns (NEW)
            # ============================================================
            schema_mapping = self._create_schema_mapping_from_tracking(
                column_mapping, chain
            )
            
            # ============================================================
            # STEP 6: Save Metadata
            # ============================================================
            cursor.execute("""
                INSERT OR REPLACE INTO schema_mappings
                (env_id, mapping_type, mapping_config, updated_at)
                VALUES (?, ?, ?, ?)
            """, (
                str(env_id),
                'golden_source',
                json.dumps(schema_mapping),
                datetime.now().isoformat()
            ))
            
            cursor.execute("""
                INSERT OR REPLACE INTO golden_dataset_metadata
                (env_id, source_plan_id, row_count, created_at)
                VALUES (?, ?, ?, ?)
            """, (
                str(env_id),
                str(join_plan_id) if join_plan_id else None,
                int(row_count),
                datetime.now().isoformat()
            ))
            
            conn.commit()
            
            print(f"✅ [BRIDGE] Schema mapping:")
            print(f"   Transactions: {list(schema_mapping.get('transactions', {}).keys())}")
            print(f"   Customers: {list(schema_mapping.get('customers', {}).keys())}")
            print(f"   Accounts: {list(schema_mapping.get('accounts', {}).keys())}")
            
            return {
                'success': True,
                'view_created': view_name,
                'schema_mapping': schema_mapping,
                'row_count': row_count,
                'message': f'Logical view created with {row_count:,} rows'
            }
            
        except Exception as e:
            conn.rollback()
            print(f"❌ [BRIDGE] Materialization failed: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            conn.close()
    
    def _build_join_sql_explicit_columns(self, env_id: str, chain: list) -> dict:
        """
        Build SQL with EXPLICIT column selection and DERIVED transaction_direction
        """
        try:
            if not chain or len(chain) == 0:
                return {'success': False, 'error': 'Empty chain'}

            # =========================
            # Base dataset
            # =========================
            base_step = chain[0]
            base_ds_id = base_step.get('dataset_id') or base_step.get('datasetId')

            if not base_ds_id:
                return {'success': False, 'error': 'Base dataset missing'}

            base_table = self._get_table_name_for_dataset(env_id, base_ds_id)
            base_alias = base_step.get('alias', 't0')

            column_mapping = {}
            select_parts = []

            base_cols = self._get_table_columns(base_table)
            print(f"📋 [BRIDGE] Base table '{base_table}' has {len(base_cols)} columns")

            amount_col = None  # 🔥 track amount column for direction derivation

            # =========================
            # Base table columns
            # =========================
            for col in base_cols:
                if col.lower() in ['id', 'loaded_at', 'rowid']:
                    continue

                aliased_name = f"{base_alias}_{col}".replace('-', '_').replace(' ', '_')
                select_parts.append(f'{base_alias}."{col}" AS {aliased_name}')

                col_lower = col.lower()

                if 'transaction_id' in col_lower or col_lower in ['id', 'txn_id']:
                    column_mapping['transaction_id'] = aliased_name

                elif 'transaction_date' in col_lower or col_lower in ['date', 'txn_date', 'trans_date', 'transaction_datetime']:
                    column_mapping['transaction_date'] = aliased_name

                elif 'transaction_amount' in col_lower or col_lower in ['amount', 'txn_amount', 'trans_amount']:
                    column_mapping['transaction_amount'] = aliased_name
                    amount_col = col  # 🔥 remember physical amount column

                elif 'transaction_category' in col_lower or col_lower in ['category', 'txn_category']:
                    column_mapping['transaction_category'] = aliased_name

                elif 'transaction_type' in col_lower or col_lower in ['type', 'txn_type']:
                    column_mapping['transaction_type'] = aliased_name

                elif 'account_id' in col_lower:
                    column_mapping['account_id'] = aliased_name

                elif 'customer_id' in col_lower or col_lower in ['cust_id', 'client_id']:
                    column_mapping['customer_id'] = aliased_name

            # =========================
            # 🔥 DERIVED transaction_direction (CRITICAL FIX)
            # =========================
            if amount_col:
                select_parts.append(
                    f"""
                    CASE
                        WHEN {base_alias}."{amount_col}" < 0 THEN 'DEBIT'
                        WHEN {base_alias}."{amount_col}" > 0 THEN 'CREDIT'
                        ELSE 'UNKNOWN'
                    END AS {base_alias}_transaction_direction
                    """
                )
                column_mapping['transaction_direction'] = f"{base_alias}_transaction_direction"
                print("✅ [BRIDGE] Derived transaction_direction from amount")
            else:
                print("⚠️ [BRIDGE] No amount column found → transaction_direction not derived")

            # =========================
            # FROM + JOINS
            # =========================
            from_clause = f'FROM "{base_table}" AS {base_alias}'
            join_clauses = []

            for i in range(1, len(chain)):
                step = chain[i]
                ds_id = step.get('dataset_id') or step.get('datasetId')
                if not ds_id:
                    continue

                table_name = self._get_table_name_for_dataset(env_id, ds_id)
                alias = step.get('alias', f't{i}')
                join_type = step.get('join_type', 'LEFT JOIN')
                left_on = step.get('left_on') or step.get('leftOn')
                right_on = step.get('right_on') or step.get('rightOn')

                if not left_on or not right_on:
                    continue

                if "." not in left_on:
                    prev_alias = chain[i - 1].get('alias', f't{i - 1}')
                    left_on = f"{prev_alias}.{left_on}"

                joined_cols = self._get_table_columns(table_name)
                print(f"📋 [BRIDGE] Joined table '{table_name}' has {len(joined_cols)} columns")

                for col in joined_cols:
                    if col.lower() in ['id', 'loaded_at', 'rowid']:
                        continue
                    if col.lower() == right_on.lower():
                        continue

                    aliased_name = f"{alias}_{col}".replace('-', '_').replace(' ', '_')
                    select_parts.append(f'{alias}."{col}" AS {aliased_name}')

                    col_lower = col.lower()

                    if 'risk_rating' in col_lower:
                        column_mapping['risk_rating'] = aliased_name
                    elif 'customer_type' in col_lower:
                        column_mapping['customer_type'] = aliased_name
                    elif 'pep_flag' in col_lower or col_lower == 'pep':
                        column_mapping['pep_flag'] = aliased_name
                    elif 'account_type' in col_lower:
                        column_mapping['account_type'] = aliased_name
                    elif 'account_status' in col_lower:
                        column_mapping['account_status'] = aliased_name

                join_clauses.append(
                    f'{join_type} "{table_name}" AS {alias} ON {left_on} = {alias}."{right_on}"'
                )

            sql = f"SELECT {', '.join(select_parts)} {from_clause} {' '.join(join_clauses)}"

            print(f"✅ [BRIDGE] Generated SQL with {len(select_parts)} columns")
            print(f"✅ [BRIDGE] Mapped semantic fields: {list(column_mapping.keys())}")

            return {
                'success': True,
                'sql': sql,
                'column_mapping': column_mapping
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    
    def _create_schema_mapping_from_tracking(self, column_mapping: dict, chain: list) -> dict:
        """
        Create schema mapping using the tracked column mapping from SQL generation
        
        Args:
            column_mapping: Dict mapping semantic fields to actual column names
            chain: Join chain to determine dataset types
        
        Returns:
            {
                'transactions': {'transaction_id': 't0_transaction_id', ...},
                'customers': {'customer_id': 'c_customer_id', ...},
                'accounts': {'account_id': 'a_account_id', ...}
            }
        """
        mapping = {
            'transactions': {},
            'customers': {},
            'accounts': {}
        }
        
        # Transaction fields
        txn_fields = [
            'transaction_id', 'transaction_date', 'transaction_amount',
            'transaction_category', 'transaction_type', 'account_id', 'customer_id'
        ]
        
        for field in txn_fields:
            if field in column_mapping:
                mapping['transactions'][field] = column_mapping[field]
        
        # Customer fields
        cust_fields = [
            'customer_id', 'customer_name', 'risk_rating', 
            'customer_type', 'pep_flag'
        ]
        
        for field in cust_fields:
            if field in column_mapping:
                mapping['customers'][field] = column_mapping[field]
            elif f'{field}_alt' in column_mapping:
                mapping['customers'][field] = column_mapping[f'{field}_alt']
        
        # Account fields
        acc_fields = [
            'account_id', 'account_type', 'account_status'
        ]
        
        for field in acc_fields:
            if field in column_mapping:
                mapping['accounts'][field] = column_mapping[field]
            elif f'{field}_alt' in column_mapping:
                mapping['accounts'][field] = column_mapping[f'{field}_alt']
        
        return mapping
    
    def _get_table_columns(self, table_name: str) -> list:
        """Get column names for a table"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute(f'PRAGMA table_info("{table_name}")')
            return [row[1] for row in cursor.fetchall()]
        finally:
            conn.close()
    
    def _get_table_name_for_dataset(self, env_id: str, dataset_id: str) -> str:
        """Get physical table name for a dataset ID"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT table_name FROM datasets 
                WHERE dataset_id = ?
            """, (str(dataset_id),))
            
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Dataset {dataset_id} not found")
            
            return row[0]
        finally:
            conn.close()
    
    def _get_dataset_name(self, env_id: str, dataset_id: str) -> str:
        """Get dataset display name for a dataset ID"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT dataset_name FROM datasets 
                WHERE dataset_id = ?
            """, (str(dataset_id),))
            
            row = cursor.fetchone()
            if not row:
                return "Unknown"
            
            return row[0]
        finally:
            conn.close()
    
    def _build_chain_from_mapping(self, env_id: str, dataset_mapping: dict) -> list:
        """
        Build a simple chain from dataset mapping.
        Fallback when no join plan exists.
        """
        chain = []
        
        # Base: transactions
        if 'transactions' in dataset_mapping:
            chain.append({
                'dataset_id': dataset_mapping['transactions'],
                'alias': 't0'
            })
        
        # Join customers
        if 'customers' in dataset_mapping:
            chain.append({
                'dataset_id': dataset_mapping['customers'],
                'alias': 'c',
                'join_type': 'LEFT JOIN',
                'left_on': 'customer_id',
                'right_on': 'customer_id'
            })
        
        # Join accounts
        if 'accounts' in dataset_mapping:
            chain.append({
                'dataset_id': dataset_mapping['accounts'],
                'alias': 'a',
                'join_type': 'LEFT JOIN',
                'left_on': 'account_id',
                'right_on': 'account_id'
            })
        
        return chain
    
    def check_step1_readiness(self, env_id: str) -> dict:
        """
        Check if logical view exists for Step 1.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            view_name = f"{env_id}_calibration_data"
            
            # Check if view exists
            cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='view' AND name=?
            """, (view_name,))
            
            view_exists = cursor.fetchone() is not None
            
            if not view_exists:
                return {
                    'ready': False,
                    'missing': ['Logical view not created'],
                    'message': 'Complete Step 0 data foundation first'
                }
            
            # Get row count from view
            cursor.execute(f'SELECT COUNT(*) FROM "{view_name}"')
            row_count = cursor.fetchone()[0]
            
            # Check schema mapping
            cursor.execute("""
                SELECT mapping_config FROM schema_mappings
                WHERE env_id = ? AND mapping_type = 'golden_source'
            """, (str(env_id),))
            
            mapping_row = cursor.fetchone()
            has_mapping = mapping_row is not None
            
            ready = view_exists and has_mapping and row_count > 0
            
            return {
                'ready': ready,
                'view_name': view_name,
                'row_count': row_count,
                'has_mapping': has_mapping,
                'message': 'Ready for Step 1' if ready else 'Configuration incomplete'
            }
            
        finally:
            conn.close()
    def _create_schema_mapping(self, conn, env_id: str, chain: list) -> dict:
        """
        Create schema mapping - IMPROVED VERSION
        Maps semantic field names to actual column names in the view
        """
        mapping = {
            'transactions': {},
            'customers': {},
            'accounts': {}
        }
        
        cursor = conn.cursor()
        
        # Get all columns from the created view
        view_name = f"{env_id}_calibration_data"
        cursor.execute(f'PRAGMA table_info("{view_name}")')
        view_columns = [row[1] for row in cursor.fetchall()]
        
        print(f"📋 [BRIDGE] View has {len(view_columns)} columns: {view_columns[:10]}...")
        
        # Map standard fields using fuzzy matching on actual view columns
        for col in view_columns:
            col_lower = col.lower()
            
            # Transaction mappings
            if 'transaction_id' in col_lower or (col_lower == 'id' and 'transaction' in col_lower):
                mapping['transactions']['transaction_id'] = col
            elif 'transaction_date' in col_lower or col_lower in ['date', 'txn_date', 'trans_date']:
                mapping['transactions']['transaction_date'] = col
            elif 'transaction_amount' in col_lower or col_lower in ['amount', 'txn_amount', 'trans_amount']:
                mapping['transactions']['transaction_amount'] = col
            elif 'transaction_category' in col_lower or col_lower in ['category', 'txn_category']:
                mapping['transactions']['transaction_category'] = col
            elif 'transaction_direction' in col_lower or col_lower in ['direction', 'txn_direction']:
                mapping['transactions']['transaction_direction'] = col
            
            # Customer mappings
            elif 'risk_rating' in col_lower or col_lower == 'risk':
                mapping['customers']['risk_rating'] = col
            elif 'customer_type' in col_lower or col_lower in ['cust_type', 'client_type']:
                mapping['customers']['customer_type'] = col
            elif 'pep_flag' in col_lower or col_lower == 'pep':
                mapping['customers']['pep_flag'] = col
            
            # Account mappings  
            elif 'account_type' in col_lower or col_lower in ['acc_type', 'account_category']:
                mapping['accounts']['account_type'] = col
            elif 'account_status' in col_lower or col_lower in ['acc_status', 'status']:
                mapping['accounts']['account_status'] = col
            
            # ID columns
            elif 'account_id' in col_lower or col_lower in ['acc_id', 'accountid']:
                mapping['transactions']['account_id'] = col
                mapping['accounts']['account_id'] = col
            elif 'customer_id' in col_lower or col_lower in ['cust_id', 'client_id', 'customerid']:
                mapping['transactions']['customer_id'] = col
                
                mapping['customers']['customer_id'] = col
        
        print(f"✅ [BRIDGE] Schema mapping created:")
        print(f"   Transactions: {list(mapping['transactions'].keys())}")
        print(f"   Customers: {list(mapping['customers'].keys())}")
        print(f"   Accounts: {list(mapping['accounts'].keys())}")
        
        return mapping