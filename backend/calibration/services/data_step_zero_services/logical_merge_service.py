# ============================================================================
# backend/calibration/services/data_step_zero_services/logical_merge_service.py
# ============================================================================
"""
Logical Merge Service - COMPLETE IMPLEMENTATION
Manages join chains without creating physical tables.
Core principle: Joins are LOGICAL only - preview-only execution.
"""
import pandas as pd
import json
from datetime import datetime
import uuid


class LogicalMergeService:
    def __init__(self, db_manager, schema_service):
        self.db = db_manager
        self.schema_service = schema_service
        print("✅ [MERGE SERVICE] Initialized")

    def generate_preview(self, env_id, chain):
        """Generate join preview with debugging and metrics"""
        print(f"\n🔍 [MERGE PREVIEW] Starting preview for env: {env_id}")
        print(f"📊 [MERGE PREVIEW] Chain length: {len(chain) if chain else 0}")
        
        if not chain or len(chain) == 0:
            print("❌ [MERGE PREVIEW] Empty chain")
            return {'success': False, 'error': 'Empty chain'}

        conn = self.db.connect()
        try:
            # 1. Base Step Construction
            base_step = chain[0]
            base_ds_id = base_step.get('dataset_id') or base_step.get('datasetId')
            
            if not base_ds_id:
                return {'success': False, 'error': 'Base dataset ID is missing'}

            print(f"📍 [MERGE PREVIEW] Base dataset: {base_ds_id}")
            
            base_table = self._get_table_name(env_id, base_ds_id)
            base_alias = base_step.get('alias', 't0')
            print(f"📍 [MERGE PREVIEW] Base table: {base_table} (alias: {base_alias})")
            
            # Use SELECT * to ensure we get columns from ALL joined tables
            query = f'SELECT * FROM "{base_table}" AS {base_alias}'
            
            # Track metadata for metrics
            join_log = []
            
            # 2. Add Joins
            for i in range(1, len(chain)):
                step = chain[i]
                ds_id = step.get('dataset_id') or step.get('datasetId')
                if not ds_id:
                    print(f"⚠️ [MERGE PREVIEW] Step {i}: Missing dataset_id")
                    continue 
                
                table_name = self._get_table_name(env_id, ds_id)
                alias = step.get('alias', f't{i}')
                join_type = step.get('join_type', 'LEFT JOIN')
                left_on = step.get('left_on') or step.get('leftOn')
                right_on = step.get('right_on') or step.get('rightOn')

                if not left_on or not right_on:
                    print(f"⚠️ [MERGE PREVIEW] Step {i}: Missing join keys")
                    continue

                # Handle alias.column format (e.g. ensure 't0.id' or 't1.id')
                clean_left = left_on
                if "." not in clean_left:
                    # Default to joining against the immediate previous table or base
                    prev_alias = chain[i-1].get('alias', f't{i-1}')
                    clean_left = f"{prev_alias}.{clean_left}"

                query += f"""
                    {join_type} "{table_name}" AS {alias}
                    ON {clean_left} = {alias}.{right_on}
                """
                
                print(f"🔗 [MERGE PREVIEW] Step {i}: {join_type} {table_name} ON {clean_left} = {alias}.{right_on}")
                join_log.append(f"Joined {table_name} ({join_type})")
            
            # 3. Execution (Limit for Preview)
            preview_limit = 100
            query_limit = f"{query} LIMIT {preview_limit}"
            
            print(f"\n🚀 [MERGE PREVIEW] Executing SQL:")
            print(f"   {query_limit}")
            
            df = pd.read_sql_query(query_limit, conn)
            
            print(f"✅ [MERGE PREVIEW] Query executed: {len(df)} rows × {len(df.columns)} columns")
            
            # 4. Metrics Calculation (On the sample + Schema)
            # Get original column count of the base table to calculate "Added Cols"
            base_schema = self.schema_service.get_effective_schema(env_id, base_ds_id)
            initial_col_count = len(base_schema.get('columns', [])) if base_schema.get('success') else 0
            final_col_count = len(df.columns)
            
            # 5. Deduplicate Columns (CRITICAL FIX)
            # If two tables have 'account_id', Pandas/SQLite returns both.
            # React keys crash on duplicates. We rename duplicates to 'col', 'col_1', 'col_2'.
            original_cols = df.columns.tolist()
            cols = pd.Series(df.columns)
            for dup in cols[cols.duplicated()].unique(): 
                indices = cols[cols == dup].index.values.tolist()
                cols[indices] = [dup + '_' + str(i) if i != 0 else dup for i in range(len(indices))]
            df.columns = cols
            
            if len(original_cols) != len(set(original_cols)):
                print(f"🔄 [MERGE PREVIEW] Deduplicated {len(original_cols) - len(set(original_cols))} columns")

            result = {
                'success': True,
                'preview': {
                    'columns': df.columns.tolist(),
                    'rows': df.to_dict(orient='records'),
                    'metrics': {
                        'input_cols': initial_col_count,
                        'output_cols': final_col_count,
                        'added_cols': max(0, final_col_count - initial_col_count),
                        'rows_returned': len(df),
                        'join_steps': len(join_log)
                    }
                }
            }
            
            print(f"✅ [MERGE PREVIEW] Preview generated successfully")
            return result
            
        except Exception as e:
            print(f"❌ [MERGE PREVIEW] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}
        finally:
            conn.close()

    def create_join_plan(self, env_id, plan_name, chain, create_view=False):
        """Save join plan with debugging"""
        print(f"\n💾 [MERGE SAVE] Saving plan: '{plan_name}' for env: {env_id}")
        print(f"📊 [MERGE SAVE] Chain steps: {len(chain)}")
        
        conn = self.db.connect()
        cursor = conn.cursor()
        try:
            # Check if plan exists
            cursor.execute("""
                SELECT plan_id FROM join_plans 
                WHERE env_id = ? AND plan_name = ?
            """, (env_id, plan_name))
            
            existing = cursor.fetchone()
            plan_id = existing[0] if existing else str(uuid.uuid4())
            
            if existing:
                print(f"🔄 [MERGE SAVE] Updating existing plan: {plan_id}")
                cursor.execute("""
                    UPDATE join_plans
                    SET chain_json = ?, updated_at = ?
                    WHERE plan_id = ?
                """, (json.dumps(chain), datetime.now().isoformat(), plan_id))
            else:
                print(f"🆕 [MERGE SAVE] Creating new plan: {plan_id}")
                cursor.execute("""
                    INSERT INTO join_plans (plan_id, env_id, plan_name, chain_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (plan_id, env_id, plan_name, json.dumps(chain), datetime.now().isoformat()))
            
            # Try to Create View (Non-Fatal)
            if create_view:
                try:
                    sql_result = self._build_sql(env_id, chain, limit=None)
                    if sql_result['success']:
                        view_name = f"{env_id}_calibration_view"
                        cursor.execute(f"DROP VIEW IF EXISTS {view_name}")
                        cursor.execute(f"CREATE VIEW {view_name} AS {sql_result['sql']}")
                        print(f"✅ [MERGE] Created view: {view_name}")
                except Exception as view_err:
                    print(f"⚠️ [MERGE] View creation skipped: {view_err}")

            conn.commit()
            print(f"✅ [MERGE SAVE] Plan saved: {plan_id}")
            
            return {
                'success': True, 
                'plan_id': plan_id,
                'message': f"Join plan '{plan_name}' saved successfully"
            }
            
        except Exception as e:
            conn.rollback()
            print(f"❌ [MERGE SAVE] Failed: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}
        finally:
            conn.close()

    def _get_table_name(self, env_id, dataset_id):
        """Get table name with error handling"""
        conn = self.db.connect()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT table_name FROM datasets 
                WHERE dataset_id = ? AND env_id = ?
            """, (dataset_id, env_id))
            
            row = cursor.fetchone()
            if not row:
                error_msg = f"Dataset {dataset_id} not found in env {env_id}"
                print(f"❌ [MERGE] {error_msg}")
                raise ValueError(error_msg)
            
            return row[0]
        finally:
            conn.close()

    def _build_sql(self, env_id, chain, limit=None):
        """Helper to build raw SQL string"""
        try:
            base_step = chain[0]
            base_id = base_step.get('dataset_id') or base_step.get('datasetId')
            base_table = self._get_table_name(env_id, base_id)
            base_alias = base_step.get('alias', 't0')
            
            sql = f'SELECT * FROM "{base_table}" AS {base_alias}'
            
            for i in range(1, len(chain)):
                step = chain[i]
                ds_id = step.get('dataset_id') or step.get('datasetId')
                if not ds_id: continue
                
                table_name = self._get_table_name(env_id, ds_id)
                alias = step.get('alias', f't{i}')
                join_type = step.get('join_type', 'LEFT JOIN')
                
                left = step.get('left_on') or step.get('leftOn')
                if "." not in left:
                    left = f"{chain[i-1].get('alias', f't{i-1}')}.{left}"
                
                right = step.get('right_on') or step.get('rightOn')
                sql += f' {join_type} "{table_name}" AS {alias} ON {left} = {alias}.{right}'
            
            if limit:
                sql += f" LIMIT {limit}"
            
            return {'success': True, 'sql': sql}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_join_plan(self, plan_id: str) -> dict:
        """Retrieve a saved join plan"""
        print(f"\n📥 [MERGE LOAD] Loading plan: {plan_id}")
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT plan_id, env_id, plan_name, chain_json, created_at
                FROM join_plans
                WHERE plan_id = ?
            """, (plan_id,))
            
            row = cursor.fetchone()
            if not row:
                print(f"❌ [MERGE LOAD] Plan not found: {plan_id}")
                return {'success': False, 'error': 'Plan not found'}
            
            plan_data = {
                'plan_id': row[0],
                'env_id': row[1],
                'plan_name': row[2],
                'chain': json.loads(row[3]),
                'created_at': row[4]
            }
            
            print(f"✅ [MERGE LOAD] Loaded: '{plan_data['plan_name']}' ({len(plan_data['chain'])} steps)")
            
            return {
                'success': True,
                'plan': plan_data
            }
            
        finally:
            conn.close()
    
    def list_join_plans(self, env_id: str) -> list:
        """List all join plans for an environment"""
        print(f"\n📋 [MERGE LIST] Listing plans for env: {env_id}")
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT plan_id, plan_name, created_at
                FROM join_plans
                WHERE env_id = ?
                ORDER BY created_at DESC
            """, (env_id,))
            
            plans = []
            for row in cursor.fetchall():
                plans.append({
                    'plan_id': row[0],
                    'plan_name': row[1],
                    'created_at': row[2]
                })
            
            print(f"✅ [MERGE LIST] Found {len(plans)} plan(s)")
            return plans
            
        finally:
            conn.close()
    
    def delete_join_plan(self, plan_id: str) -> dict:
        """Delete a join plan"""
        print(f"\n🗑️ [MERGE DELETE] Deleting plan: {plan_id}")
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("DELETE FROM join_plans WHERE plan_id = ?", (plan_id,))
            
            if cursor.rowcount == 0:
                print(f"❌ [MERGE DELETE] Plan not found")
                return {'success': False, 'error': 'Plan not found'}
            
            conn.commit()
            print(f"✅ [MERGE DELETE] Plan deleted")
            
            return {
                'success': True,
                'plan_id': plan_id,
                'message': 'Plan deleted'
            }
            
        finally:
            conn.close()

    def suggest_join_chain(self, env_id: str, dataset_ids: list) -> dict:
        """AI-powered suggestion for join chain"""
        print(f"\n🤖 [MERGE SUGGEST] Suggesting chain for {len(dataset_ids)} datasets")
        
        if len(dataset_ids) < 2:
            return {
                'success': False,
                'error': 'Need at least 2 datasets'
            }
        
        # Get schemas for all datasets
        schemas = {}
        for dataset_id in dataset_ids:
            schema = self.schema_service.get_effective_schema(env_id, dataset_id)
            if schema.get('success'):
                schemas[dataset_id] = schema['columns']
        
        # Heuristic suggestion logic
        base_dataset = self._find_base_dataset(schemas)
        
        # Build chain
        suggested_chain = [{'dataset_id': base_dataset, 'alias': f'ds_{base_dataset[:8]}'}]
        
        remaining = [d for d in dataset_ids if d != base_dataset]
        
        for right_dataset in remaining:
            # Find best join key
            join_suggestion = self.schema_service.get_join_compatible_columns(
                env_id,
                suggested_chain[-1]['dataset_id'],
                right_dataset
            )
            
            if join_suggestion.get('suggestions'):
                best = join_suggestion['suggestions'][0]
                suggested_chain.append({
                    'dataset_id': right_dataset,
                    'alias': f'ds_{right_dataset[:8]}',
                    'join_type': 'LEFT JOIN',
                    'left_on': best['left'],
                    'right_on': best['right'],
                    'confidence': best['confidence']
                })
        
        print(f"✅ [MERGE SUGGEST] Generated chain with {len(suggested_chain)} steps")
        
        return {
            'success': True,
            'suggested_chain': suggested_chain,
            'reasoning': f"Started with {base_dataset[:8]} as base (most unique columns)"
        }
    
    def _validate_chain(self, env_id: str, chain: list) -> dict:
        """Validate join chain for correctness"""
        errors = []
        
        # Check base dataset
        if not chain[0].get('dataset_id'):
            errors.append("Base dataset missing dataset_id")
            return {'valid': False, 'errors': errors}
        
        # Validate each join step
        for i in range(1, len(chain)):
            step = chain[i]
            prev_step = chain[i-1]
            
            # Required fields
            required = ['dataset_id', 'join_type', 'left_on', 'right_on']
            for field in required:
                if not step.get(field):
                    errors.append(f"Step {i}: Missing {field}")
            
            if errors:
                continue
            
            # Validate join type
            if step['join_type'] not in ['LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN']:
                errors.append(f"Step {i}: Invalid join_type {step['join_type']}")
            
            # Validate left key exists in previous dataset
            left_schema = self.schema_service.get_effective_schema(env_id, prev_step['dataset_id'])
            if left_schema.get('success'):
                left_cols = [c['name'] for c in left_schema['columns']]
                if step['left_on'] not in left_cols:
                    errors.append(f"Step {i}: left_on '{step['left_on']}' not found in previous dataset")
            
            # Validate right key exists in current dataset
            right_schema = self.schema_service.get_effective_schema(env_id, step['dataset_id'])
            if right_schema.get('success'):
                right_cols = [c['name'] for c in right_schema['columns']]
                if step['right_on'] not in right_cols:
                    errors.append(f"Step {i}: right_on '{step['right_on']}' not found in dataset")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors
        }
    
    def _find_base_dataset(self, schemas: dict) -> str:
        """Heuristic to find best base dataset"""
        scores = {}
        
        for dataset_id, columns in schemas.items():
            score = 0
            
            for col in columns:
                # High uniqueness = likely identifier
                if col.get('unique_pct', 0) > 80:
                    score += 2
                
                # ID in name
                if 'id' in col['name'].lower():
                    score += 1
            
            scores[dataset_id] = score
        
        # Return highest scoring dataset
        return max(scores.items(), key=lambda x: x[1])[0] if scores else list(schemas.keys())[0]
    
    def save_plan(self, env_id, chain, name):
        """Alias for create_join_plan"""
        return self.create_join_plan(env_id, name, chain)