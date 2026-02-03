"""
Calibration Run Manager
Handles stateful run lifecycle (create, load, update, delete)
"""
import json
import uuid
from datetime import datetime

class CalibrationRunManager:
    """Manages calibration run lifecycle and state"""
    
    def __init__(self, db_connection):
        self.db = db_connection
        self.cursor = self.db.cursor()
    
    def create_run(self, env_id, created_by, scenario_name=None):
        """
        Create a new calibration run
        
        Returns:
            dict: {run_id, status, created_at, ...}
        """
        run_id = f"CAL_{uuid.uuid4().hex[:12].upper()}"
        
        query = """
        INSERT INTO calibration_runs 
        (run_id, env_id, created_by, scenario_name, status)
        VALUES (?, ?, ?, ?, 'DRAFT')
        """
        
        self.cursor.execute(query, (
            run_id,
            env_id,
            created_by,
            scenario_name or f"Calibration {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        ))
        self.db.commit()
        
        return self.get_run(run_id)
    
    def get_run(self, run_id):
        """Load run by ID"""
        query = "SELECT * FROM calibration_runs WHERE run_id = ?"
        self.cursor.execute(query, (run_id,))
        row = self.cursor.fetchone()
        
        if not row:
            return None
        
        return self._row_to_dict(row)
    
    def list_runs(self, env_id=None, created_by=None, status=None, limit=50):
        """
        List runs with optional filters
        
        Returns:
            list: [{run_id, status, created_at, ...}, ...]
        """
        query = "SELECT * FROM calibration_runs WHERE 1=1"
        params = []
        
        if env_id:
            query += " AND env_id = ?"
            params.append(env_id)
        
        if created_by:
            query += " AND created_by = ?"
            params.append(created_by)
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        
        self.cursor.execute(query, params)
        rows = self.cursor.fetchall()
        
        return [self._row_to_dict(row) for row in rows]
    
    def update_run(self, run_id, **updates):
        """
        Update run fields dynamically
        
        Args:
            run_id: Run ID
            **updates: Any column=value pairs to update
        
        Example:
            update_run(run_id, status='AGGREGATED', base_population_count=5000)
        """
        if not updates:
            return self.get_run(run_id)
        
        # Always update timestamp
        updates['updated_at'] = datetime.now().isoformat()
        
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        query = f"UPDATE calibration_runs SET {set_clause} WHERE run_id = ?"
        
        self.cursor.execute(query, list(updates.values()) + [run_id])
        self.db.commit()
        
        return self.get_run(run_id)
    
    def update_scenario_config(self, run_id, scenario_config):
        """Update scenario config (JSON)"""
        return self.update_run(
            run_id,
            scenario_config=json.dumps(scenario_config),
            status='SCENARIO_DEFINED'
        )
    
    def update_aggregation_config(self, run_id, aggregation_config):
        """Update aggregation config (JSON)"""
        return self.update_run(
            run_id,
            aggregation_config=json.dumps(aggregation_config),
            status='AGGREGATED'
        )
    
    def select_threshold(self, run_id, threshold, percentile, alert_count):
        """Record selected threshold"""
        return self.update_run(
            run_id,
            selected_threshold=threshold,
            selected_percentile=percentile,
            alert_count_at_threshold=alert_count,
            status='SIMULATED'
        )
    
    def approve_run(self, run_id, approved_by, comment=None):
        """Approve calibration run"""
        return self.update_run(
            run_id,
            approval_status='APPROVED',
            approved_by=approved_by,
            approved_at=datetime.now().isoformat(),
            approval_comment=comment,
            status='APPROVED'
        )
    
    def reject_run(self, run_id, rejected_by, comment):
        """Reject calibration run"""
        return self.update_run(
            run_id,
            approval_status='REJECTED',
            approved_by=rejected_by,
            approved_at=datetime.now().isoformat(),
            approval_comment=comment,
            status='REJECTED'
        )
    
    def delete_run(self, run_id):
        """Delete run (cascade deletes related data)"""
        self.cursor.execute("DELETE FROM calibration_runs WHERE run_id = ?", (run_id,))
        self.db.commit()
        return {"deleted": True, "run_id": run_id}
    
    def _row_to_dict(self, row):
        """Convert SQLite row to dict"""
        if not row:
            return None
        
        columns = [desc[0] for desc in self.cursor.description]
        result = dict(zip(columns, row))
        
        # Parse JSON fields
        if result.get('scenario_config'):
            try:
                result['scenario_config'] = json.loads(result['scenario_config'])
            except:
                pass
        
        if result.get('aggregation_config'):
            try:
                result['aggregation_config'] = json.loads(result['aggregation_config'])
            except:
                pass
        
        return result