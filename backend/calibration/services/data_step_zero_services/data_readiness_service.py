# backend/calibration/services/data_step_zero_services/data_readiness_service.py
"""
Data Readiness Service - RELAXED VERSION
Allows users to proceed with warnings instead of hard blocks
"""
import json
from datetime import datetime


class DataReadinessService:
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def check_readiness(self, env_id: str) -> dict:
        """
        Check Step 0 readiness - RELAXED, no hard blockers.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            print(f"🔍 [READINESS] Checking Step 0 status for: {env_id}")
            
            checks = {}
            blockers = []
            warnings = []
            recommendations = []
            
            # CHECK 1: Datasets Uploaded
            cursor.execute("""
                SELECT COUNT(*) FROM datasets 
                WHERE env_id = ? AND is_active = 1
            """, (env_id,))
            
            dataset_count = cursor.fetchone()[0]
            checks['datasets_uploaded'] = dataset_count >= 2
            
            if dataset_count == 0:
                warnings.append("⚠️ No datasets uploaded. Upload at least 2 datasets to continue.")
            elif dataset_count == 1:
                warnings.append("⚠️ Only 1 dataset uploaded. Upload more for better results.")
            
            # CHECK 2: Join Plans Created
            cursor.execute("""
                SELECT COUNT(*) FROM join_plans 
                WHERE env_id = ?
            """, (env_id,))
            
            plan_count = cursor.fetchone()[0]
            checks['join_plan_created'] = plan_count > 0
            
            if plan_count == 0:
                warnings.append("⚠️ No join plan created. Click 'Proceed to Step 1' to create one automatically.")
            
            # CHECK 3: Schema Metadata
            cursor.execute("""
                SELECT COUNT(*) FROM schema_metadata 
                WHERE dataset_id IN (
                    SELECT dataset_id FROM datasets WHERE env_id = ?
                )
            """, (env_id,))
            
            schema_count = cursor.fetchone()[0]
            checks['schema_confirmed'] = schema_count > 0
            
            # CHECK 4: Logical View (not a blocker!)
            view_name = f"{env_id}_calibration_data"
            
            cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='view' AND name=?
            """, (view_name,))
            
            view_exists = cursor.fetchone() is not None
            checks['logical_view_created'] = view_exists
            
            if not view_exists:
                warnings.append("ℹ️ Logical view will be created when you proceed to Step 1.")
            else:
                try:
                    cursor.execute(f'SELECT COUNT(*) FROM "{view_name}"')
                    view_row_count = cursor.fetchone()[0]
                    checks['view_row_count'] = view_row_count
                    
                    # Check for join explosion
                    cursor.execute("""
                        SELECT SUM(row_count) FROM datasets 
                        WHERE env_id = ? AND is_active = 1
                    """, (env_id,))
                    
                    total_before = cursor.fetchone()[0] or 0
                    
                    if view_row_count > total_before * 1.5:
                        warnings.append(
                            f"⚠️ Join increased rows from {total_before:,} to {view_row_count:,}. "
                            f"Review join keys to avoid data explosion."
                        )
                except:
                    pass
            
            # CHECK 5: Schema Mapping (not a blocker!)
            cursor.execute("""
                SELECT mapping_config FROM schema_mappings
                WHERE env_id = ? AND mapping_type = 'golden_source'
            """, (env_id,))
            
            mapping_row = cursor.fetchone()
            checks['mapping_completed'] = mapping_row is not None
            
            if not mapping_row:
                warnings.append("ℹ️ Schema mapping will be created automatically when you proceed.")
            
            # RELAXED: Always ready if datasets exist
            ready = dataset_count >= 1  # Only need 1 dataset minimum
            
            # Recommendations
            if ready:
                if not view_exists:
                    recommendations.append("✅ Click 'Proceed to Step 1' to finalize setup and create logical view.")
                else:
                    recommendations.append("✅ Step 0 complete! You can proceed to Population Extraction.")
            else:
                recommendations.append("❌ Upload at least 1 dataset to continue.")
            
            result = {
                'ready': ready,
                'checks': checks,
                'blockers': blockers,  # Empty! No hard blocks
                'warnings': warnings,
                'recommendations': recommendations
            }
            
            print(f"  {'✅' if ready else '❌'} Overall readiness: {ready}")
            
            return result
            
        finally:
            conn.close()
    
    def mark_step_complete(self, env_id: str, step_name: str) -> dict:
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO step_completion_gates
                (gate_id, env_id, step_name, is_complete, completed_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
            """, (
                f"{env_id}_{step_name}",
                env_id,
                step_name,
                datetime.now().isoformat(),
                datetime.now().isoformat()
            ))
            
            conn.commit()
            return {'success': True}
            
        except Exception as e:
            conn.rollback()
            return {'success': False, 'error': str(e)}
        finally:
            conn.close()
    
    def get_completion_status(self, env_id: str) -> dict:
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT step_name, is_complete, completed_at
                FROM step_completion_gates
                WHERE env_id = ?
            """, (env_id,))
            
            steps = {}
            for row in cursor.fetchall():
                steps[row[0]] = {
                    'complete': bool(row[1]),
                    'completed_at': row[2]
                }
            
            return {'success': True, 'steps': steps}
        finally:
            conn.close()