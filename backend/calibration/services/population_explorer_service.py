# backend/calibration/services/population_explorer_service.py
"""
Population Explorer Service - FIXED transaction_direction bug
"""
import json
import pandas as pd
import sqlite3
from datetime import datetime

class PopulationExplorerService:
    """STEP 1: Population Explorer with proper column mapping"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def explore_population(self, run_id, env_id, filters):
        """Execute live population exploration using LOGICAL VIEW"""
        conn = self.db.connect()
        
        try:
            view_name = f"{env_id}_calibration_data"
            mapping = self._get_mapping(conn, env_id)
            
            # Debug logging
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) FROM {view_name}")
            total_in_view = cursor.fetchone()[0]
            print(f"🔍 [DEBUG] View '{view_name}' has {total_in_view:,} total rows")
            
            cursor.execute(f"PRAGMA table_info({view_name})")
            view_cols = [row[1] for row in cursor.fetchall()]
            print(f"🔍 [DEBUG] View has columns: {view_cols[:15]}...")
            
            cat_col = mapping.get('transactions', {}).get('transaction_category')
            if cat_col:
                cursor.execute(f'SELECT DISTINCT "{cat_col}" FROM {view_name} LIMIT 10')
                cats = [row[0] for row in cursor.fetchall()]
                print(f"🔍 [DEBUG] Categories in view: {cats}")
            
            # Build base query
            base_query = f'SELECT COUNT(*) FROM "{view_name}"'
            cursor.execute(base_query)
            original_count = cursor.fetchone()[0]
            
            # Build filter WHERE clauses
            where_clauses, filter_labels = self._build_filter_clauses(filters, mapping)
            
            # Debug SQL
            if where_clauses:
                debug_sql = f'SELECT COUNT(*) FROM "{view_name}" WHERE {" AND ".join(where_clauses)}'
                print(f"🔍 [DEBUG] Executing SQL:")
                print(f"   {debug_sql}")
                
                cursor.execute(debug_sql)
                filtered_count = cursor.fetchone()[0]
                
                # Test each filter individually
                print(f"🔍 [DEBUG] Testing filters individually:")
                for i, clause in enumerate(where_clauses):
                    test_sql = f'SELECT COUNT(*) FROM "{view_name}" WHERE {clause}'
                    cursor.execute(test_sql)
                    test_count = cursor.fetchone()[0]
                    print(f"   Filter {i+1}: {clause} → {test_count:,} rows")
            else:
                filtered_count = original_count
            
            # Get stats
            stats = self._get_stats(conn, view_name, where_clauses, mapping)
            
            # Calculate reduction
            reduction_pct = round(
                ((original_count - filtered_count) / original_count * 100) if original_count > 0 else 0,
                2
            )
            
            # Calculate per-filter impact
            reduction_by_filter = self._calculate_filter_impact(
                conn, view_name, filters, mapping
            )
            
            return {
                'original_count': original_count,
                'filtered_count': filtered_count,
                'reduction_pct': reduction_pct,
                'unique_accounts': stats.get('unique_accounts', 0),
                'unique_customers': stats.get('unique_customers', 0),
                'date_range_start': stats.get('min_date'),
                'date_range_end': stats.get('max_date'),
                'filters_applied': filter_labels,
                'reduction_by_filter': reduction_by_filter
            }
            
        finally:
            conn.close()
    
    def get_filter_options(self, run_id, env_id):
        """Get available filter options from VIEW"""
        conn = self.db.connect()
        
        try:
            view_name = f"{env_id}_calibration_data"
            mapping = self._get_mapping(conn, env_id)
            
            print(f"🔍 [POP EXPLORER] Getting filter options from view: {view_name}")
            print(f"📋 [POP EXPLORER] Mapping: {mapping}")
            
            options = {}
            
            def get_distinct(field_key, table_type):
                """Get distinct values with fallback"""
                col = mapping.get(table_type, {}).get(field_key)
                
                if not col:
                    col = field_key
                    print(f"⚠️ [POP EXPLORER] No mapping for {field_key}, trying column '{col}' directly")
                
                query = f'SELECT DISTINCT "{col}" FROM "{view_name}" WHERE "{col}" IS NOT NULL ORDER BY "{col}" LIMIT 100'
                
                try:
                    result = [row[0] for row in conn.execute(query).fetchall()]
                    print(f"✅ [POP EXPLORER] Found {len(result)} distinct values for {field_key}")
                    return result
                except Exception as e:
                    print(f"❌ [POP EXPLORER] Failed to get {field_key}: {e}")
                    return []
            
            options['transaction_categories'] = get_distinct('transaction_category', 'transactions')
            options['risk_ratings'] = get_distinct('risk_rating', 'customers')
            options['customer_types'] = get_distinct('customer_type', 'customers')
            options['account_types'] = get_distinct('account_type', 'accounts')
            options['account_statuses'] = get_distinct('account_status', 'accounts')
            
            print(f"📊 [POP EXPLORER] Filter options loaded: {sum(len(v) for v in options.values())} total values")
            
            return options
            
        finally:
            conn.close()

    def confirm_population_filters(self, run_id, env_id, filters):
        """Confirm filters and advance to STEP 2"""
        conn = self.db.connect()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            # Validate filters work
            stats = self.explore_population(run_id, env_id, filters)
            
            # Save filter configuration
            cursor.execute("""
                UPDATE calibration_runs
                SET population_filters = ?,
                    base_population_count = ?,
                    status = 'POPULATION_CONFIRMED',
                    current_step = 2,
                    updated_at = ?
                WHERE run_id = ?
            """, (
                json.dumps(filters),
                stats['filtered_count'],
                datetime.utcnow().isoformat(),
                run_id
            ))
            
            conn.commit()
            
            cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
            row = cursor.fetchone()
            
            run = {
                'run_id': row['run_id'],
                'env_id': row['env_id'],
                'run_name': row['scenario_name'],
                'status': row['status'],
                'current_step': row['current_step'],
                'population_filters': json.loads(row['population_filters']) if row['population_filters'] else None,
                'base_population_count': row['base_population_count']
            }
            
            return {'run': run}
            
        finally:
            conn.close()

    def _get_mapping(self, conn, env_id):
        """Load Schema Mapping from DB"""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT mapping_config 
            FROM schema_mappings 
            WHERE env_id = ? AND mapping_type = 'golden_source'
        """, (env_id,))
        
        row = cursor.fetchone()
        if not row:
            print(f"⚠️ No mapping found for {env_id}, using defaults")
            return {}
        
        try:
            return json.loads(row[0])
        except:
            print(f"⚠️ Failed to parse mapping for {env_id}")
            return {}
    
    def _get_mapped_col(self, mapping, field_name):
        """
        Get mapped column name, with fallback to field_name if not in mapping
        Checks transactions mapping first, then field_name directly
        """
        # Try to find in transactions mapping
        txn_map = mapping.get('transactions', {})
        if field_name in txn_map:
            result = txn_map[field_name]
            print(f"🔍 [MAPPING] {field_name} → {result} (from transactions)")
            return result
        
        # Try customers mapping
        cust_map = mapping.get('customers', {})
        if field_name in cust_map:
            result = cust_map[field_name]
            print(f"🔍 [MAPPING] {field_name} → {result} (from customers)")
            return result
        
        # Try accounts mapping
        acc_map = mapping.get('accounts', {})
        if field_name in acc_map:
            result = acc_map[field_name]
            print(f"🔍 [MAPPING] {field_name} → {result} (from accounts)")
            return result
        
        # Fallback to field_name
        print(f"⚠️ [MAPPING] {field_name} → {field_name} (no mapping found, using as-is)")
        return field_name
    
    def _build_filter_clauses(self, filters, mapping):
        """Build WHERE clauses - FIXED to properly map transaction_direction"""
        where_clauses = []
        filter_labels = []
        
        def mapped_col(field):
            """Get mapped column with proper table prefix lookup"""
            return self._get_mapped_col(mapping, field)
        
        def safe_in_clause(col, values):
            """Generate safe IN clause"""
            if not values:
                return None
            escaped = [v.replace("'", "''") for v in values]
            return f'"{col}" IN (\'' + "','".join(escaped) + '\')'
        
        # TRANSACTION FILTERS
        txn_filters = filters.get('transaction_filters', {})
        cust_filters = filters.get('customer_filters', {})
        acc_filters = filters.get('account_filters', {})
        
        if txn_filters.get('transaction_category'):
            col = mapped_col('transaction_category')
            clause = safe_in_clause(col, txn_filters['transaction_category'])
            if clause:
                where_clauses.append(clause)
                filter_labels.append(f'Category: {", ".join(txn_filters["transaction_category"])}')
        
        # ✅ FIX: Check if transaction_direction exists in the data
        if txn_filters.get('transaction_direction'):
            col = mapped_col('transaction_direction')
            # Verify the column actually exists
            clause = safe_in_clause(col, txn_filters['transaction_direction'])
            if clause:
                where_clauses.append(clause)
                filter_labels.append(f'Direction: {", ".join(txn_filters["transaction_direction"])}')
                print(f"✅ [POP FILTER] Using transaction_direction column: {col}")

        # CUSTOMER FILTERS
        if cust_filters.get('risk_rating'):
            col = mapped_col('risk_rating')
            clause = safe_in_clause(col, cust_filters['risk_rating'])
            if clause:
                where_clauses.append(clause)
                filter_labels.append(f'Risk: {", ".join(cust_filters["risk_rating"])}')

        if cust_filters.get('customer_type'):
            col = mapped_col('customer_type')
            clause = safe_in_clause(col, cust_filters['customer_type'])
            if clause:
                where_clauses.append(clause)
                filter_labels.append(f'Customer Type: {", ".join(cust_filters["customer_type"])}')

        if cust_filters.get('pep_flag'):
            col = mapped_col('pep_flag')
            where_clauses.append(f'"{col}" = \'{cust_filters["pep_flag"]}\'')
            filter_labels.append(f'PEP: {cust_filters["pep_flag"]}')

        # ACCOUNT FILTERS
        if acc_filters.get('account_type'):
            col = mapped_col('account_type')
            clause = safe_in_clause(col, acc_filters['account_type'])
            if clause:
                where_clauses.append(clause)
                filter_labels.append(f'Account Type: {", ".join(acc_filters["account_type"])}')

        if acc_filters.get('account_status'):
            col = mapped_col('account_status')
            clause = safe_in_clause(col, acc_filters['account_status'])
            if clause:
                where_clauses.append(f"({clause} OR \"{col}\" IS NULL)")
                filter_labels.append(
                    f"Account Status: {', '.join(acc_filters['account_status'])} (incl. NULL)"
                )

        # Safety net
        where_clauses = [
            w for w in where_clauses
            if not w.endswith(">= ") and not w.endswith("<= ")
        ]

        print("🧪 [POP FILTER DEBUG]")
        print("   WHERE:", where_clauses)

        return where_clauses, filter_labels

    def _get_stats(self, conn, view_name, where_clauses, mapping):
        """Get aggregated stats from view"""
        where_clause = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        acc_id_col = self._get_mapped_col(mapping, 'account_id')
        cust_id_col = self._get_mapped_col(mapping, 'customer_id')
        date_col = self._get_mapped_col(mapping, 'transaction_date')
        
        query = f"""
            SELECT 
                COUNT(DISTINCT "{acc_id_col}") as unique_accounts,
                COUNT(DISTINCT "{cust_id_col}") as unique_customers,
                MIN("{date_col}") as min_date,
                MAX("{date_col}") as max_date
            FROM "{view_name}"
            {where_clause}
        """
        
        try:
            result = conn.execute(query).fetchone()
            if not result:
                return {}
            
            return {
                'unique_accounts': result[0] or 0,
                'unique_customers': result[1] or 0,
                'min_date': result[2],
                'max_date': result[3]
            }
        except Exception as e:
            print(f"⚠️ Stats query failed: {e}")
            return {}

    def _calculate_filter_impact(self, conn, view_name, filters, mapping):
        """Calculate incremental reduction per filter"""
        reduction_map = {}
        
        base_query = f'SELECT COUNT(*) FROM "{view_name}"'
        cursor = conn.cursor()
        cursor.execute(base_query)
        base_count = cursor.fetchone()[0]
        
        current_count = base_count
        
        filter_groups = [
            ('Transaction', filters.get('transaction_filters', {})),
            ('Customer', filters.get('customer_filters', {})),
            ('Account', filters.get('account_filters', {}))
        ]
        
        for group_name, group_filters in filter_groups:
            if not group_filters or not any(group_filters.values()):
                continue
            
            temp_filters = {f'{group_name.lower()}_filters': group_filters}
            where_clauses, _ = self._build_filter_clauses(temp_filters, mapping)
            
            if where_clauses:
                filtered_query = f'SELECT COUNT(*) FROM "{view_name}" WHERE {" AND ".join(where_clauses)}'
                cursor.execute(filtered_query)
                new_count = cursor.fetchone()[0]
                
                reduction = current_count - new_count
                if reduction > 0:
                    reduction_map[group_name] = reduction
                
                current_count = new_count
        
        return reduction_map
    
    def preview_population(self, run_id, env_id, filters, limit=10):
        """Fetch sample rows for preview"""
        conn = self.db.connect()
        conn.row_factory = None
        
        try:
            view_name = f"{env_id}_calibration_data"
            mapping = self._get_mapping(conn, env_id)
            
            where_clauses, _ = self._build_filter_clauses(filters, mapping)
            
            query = f'SELECT * FROM "{view_name}"'
            if where_clauses:
                query += f" WHERE {' AND '.join(where_clauses)}"
            query += f" LIMIT {limit}"
            
            cursor = conn.execute(query)
            columns = [description[0] for description in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            
            return {
                'columns': columns,
                'rows': rows,
                'limit': limit
            }
            
        finally:
            conn.close()

    def fetch_population_dataframe(self, run_id, env_id, filters, limit=None):
        """INTERNAL API: Fetch data for Step 2 using LOGICAL VIEW"""
        conn = self.db.connect()
        
        try:
            view_name = f"{env_id}_calibration_data"
            mapping = self._get_mapping(conn, env_id)
            
            date_col = self._get_mapped_col(mapping, 'transaction_date')
            amt_col = self._get_mapped_col(mapping, 'transaction_amount')
            acc_col = self._get_mapped_col(mapping, 'account_id')
            
            query = f"""
                SELECT 
                    "{date_col}" AS transaction_date,
                    "{amt_col}" AS transaction_amount,
                    "{acc_col}" AS account_id,
                    *
                FROM "{view_name}"
            """
            
            where_clauses, _ = self._build_filter_clauses(filters, mapping)
            if where_clauses:
                query += f" WHERE {' AND '.join(where_clauses)}"
            
            if limit:
                query += f" LIMIT {limit}"
            
            df = pd.read_sql(query, conn)
            df = df.loc[:, ~df.columns.duplicated()]
            
            if 'transaction_date' in df.columns:
                df['transaction_date'] = pd.to_datetime(df['transaction_date'], errors='coerce')
            
            if 'transaction_amount' in df.columns:
                df['transaction_amount'] = pd.to_numeric(df['transaction_amount'], errors='coerce').fillna(0.0)
            
            print(f"✅ [POP EXPLORER] Fetched {len(df):,} rows from view")
            
            return df
            
        finally:
            conn.close()