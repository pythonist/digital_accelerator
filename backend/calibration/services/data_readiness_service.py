# backend/calibration/services/data_readiness_service.py
"""
Data Readiness Service - STEP 0 Gate
Manages the final readiness state for environment data
"""
import json
from datetime import datetime

class DataReadinessService:
    """Manages STEP 0 completion gate"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def check_readiness(self, env_id):
        """
        Check if environment data is ready for STEP 1
        
        Returns:
            {
                'is_ready': bool,
                'conditions': {
                    'transactions_uploaded': bool,
                    'accounts_uploaded': bool,
                    'customers_uploaded': bool,
                    'mapping_completed': bool,
                    'joins_validated': bool
                },
                'missing': [str],
                'ready_at': timestamp or None
            }
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # Get or create readiness record
        cursor.execute("""
            INSERT OR IGNORE INTO data_readiness (env_id) VALUES (?)
        """, (env_id,))
        conn.commit()
        
        cursor.execute("""
            SELECT transactions_uploaded, accounts_uploaded, customers_uploaded,
                   mapping_completed, joins_validated, is_ready, ready_at
            FROM data_readiness
            WHERE env_id = ?
        """, (env_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        conditions = {
            'transactions_uploaded': bool(row[0]),
            'accounts_uploaded': bool(row[1]),
            'customers_uploaded': bool(row[2]),
            'mapping_completed': bool(row[3]),
            'joins_validated': bool(row[4])
        }
        
        is_ready = all(conditions.values())
        
        missing = [k.replace('_', ' ').title() for k, v in conditions.items() if not v]
        
        return {
            'is_ready': is_ready,
            'conditions': conditions,
            'missing': missing,
            'ready_at': row[6] if row[6] else None
        }
    
    def update_upload_status(self, env_id, table_name):
        """Mark table as uploaded"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        field = f"{table_name}_uploaded"
        cursor.execute(f"""
            UPDATE data_readiness 
            SET {field} = 1, updated_at = CURRENT_TIMESTAMP
            WHERE env_id = ?
        """, (env_id,))
        
        conn.commit()
        conn.close()
        
        # Auto-check readiness
        self._auto_finalize(env_id)
    
    def update_mapping_status(self, env_id, completed=True):
        """Mark mapping as completed"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE data_readiness 
            SET mapping_completed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE env_id = ?
        """, (1 if completed else 0, env_id))
        
        conn.commit()
        conn.close()
        
        self._auto_finalize(env_id)
    
    def update_validation_status(self, env_id, validated=True):
        """Mark joins as validated"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE data_readiness 
            SET joins_validated = ?, updated_at = CURRENT_TIMESTAMP
            WHERE env_id = ?
        """, (1 if validated else 0, env_id))
        
        conn.commit()
        conn.close()
        
        self._auto_finalize(env_id)
    
    def _auto_finalize(self, env_id):
        """Auto-finalize readiness if all conditions met"""
        readiness = self.check_readiness(env_id)
        
        if readiness['is_ready']:
            conn = self.db.connect()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE data_readiness 
                SET is_ready = 1, ready_at = CURRENT_TIMESTAMP
                WHERE env_id = ? AND is_ready = 0
            """, (env_id,))
            
            conn.commit()
            conn.close()
            
            print(f"✅ STEP 0 COMPLETE: Environment {env_id} is ready for exploration")
    
    def reset_readiness(self, env_id):
        """Reset readiness state (for re-uploads)"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE data_readiness 
            SET is_ready = 0, ready_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE env_id = ?
        """, (env_id,))
        
        conn.commit()
        conn.close()