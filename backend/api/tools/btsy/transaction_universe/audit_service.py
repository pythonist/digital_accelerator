# backend/api/tools/btsy/transaction_universe/audit_service.py
"""
Audit Trail Service - Comprehensive tracking for calibration process
"""
import duckdb
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class AuditTrailService:
    """Manages audit trail for calibration process"""
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._ensure_tables()
    
    def _ensure_tables(self):
        """Create audit tables if they don't exist"""
        conn = duckdb.connect(str(self.db_path))
        try:
            # Main audit log table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY,
                    calibration_run_id INTEGER NOT NULL,
                    step_name VARCHAR NOT NULL,
                    action VARCHAR NOT NULL,
                    entity_type VARCHAR,
                    entity_id VARCHAR,
                    metadata JSON,
                    metrics JSON,
                    performed_by VARCHAR,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    duration_seconds DOUBLE
                )
            """)
            
            # Step summary table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS step_summary (
                    id INTEGER PRIMARY KEY,
                    calibration_run_id INTEGER NOT NULL,
                    step_name VARCHAR NOT NULL,
                    step_status VARCHAR NOT NULL,
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    input_metrics JSON,
                    output_metrics JSON,
                    configuration JSON,
                    notes TEXT,
                    UNIQUE(calibration_run_id, step_name)
                )
            """)
            
            # Create sequence for audit_log
            conn.execute("""
                CREATE SEQUENCE IF NOT EXISTS audit_log_seq START 1
            """)
            
            # Create sequence for step_summary
            conn.execute("""
                CREATE SEQUENCE IF NOT EXISTS step_summary_seq START 1
            """)
            
            logger.info(f"[AUDIT] Audit tables initialized at {self.db_path}")
        finally:
            conn.close()
    
    def log_action(
        self,
        calibration_run_id: int,
        step_name: str,
        action: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
        metrics: Optional[Dict] = None,
        performed_by: str = 'system',
        duration_seconds: Optional[float] = None
    ) -> int:
        """
        Log an action in the audit trail
        
        Args:
            calibration_run_id: ID of the calibration run
            step_name: Name of the step (e.g., 'step0_foundation', 'step1_universe')
            action: Action performed (e.g., 'create', 'update', 'freeze', 'delete')
            entity_type: Type of entity (e.g., 'snapshot', 'universe', 'behaviour')
            entity_id: ID of the entity
            metadata: Additional metadata
            metrics: Metrics/statistics captured
            performed_by: User/system that performed the action
            duration_seconds: Time taken for the action
            
        Returns:
            Audit log ID
        """
        conn = duckdb.connect(str(self.db_path))
        try:
            audit_id = conn.execute("SELECT nextval('audit_log_seq')").fetchone()[0]
            
            conn.execute("""
                INSERT INTO audit_log (
                    id, calibration_run_id, step_name, action, entity_type, entity_id,
                    metadata, metrics, performed_by, timestamp, duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                audit_id,
                calibration_run_id,
                step_name,
                action,
                entity_type,
                entity_id,
                json.dumps(metadata) if metadata else None,
                json.dumps(metrics) if metrics else None,
                performed_by,
                datetime.now(),
                duration_seconds
            ])
            
            logger.info(
                f"[AUDIT] Logged action: run={calibration_run_id}, "
                f"step={step_name}, action={action}, entity={entity_type}:{entity_id}"
            )
            
            return audit_id
        finally:
            conn.close()
    
    def start_step(
        self,
        calibration_run_id: int,
        step_name: str,
        input_metrics: Optional[Dict] = None,
        configuration: Optional[Dict] = None
    ):
        """Mark step as started"""
        conn = duckdb.connect(str(self.db_path))
        try:
            # Check if step exists
            existing = conn.execute("""
                SELECT id FROM step_summary 
                WHERE calibration_run_id = ? AND step_name = ?
            """, [calibration_run_id, step_name]).fetchone()
            
            if existing:
                # Update existing
                conn.execute("""
                    UPDATE step_summary 
                    SET step_status = 'in_progress',
                        start_time = ?,
                        input_metrics = ?,
                        configuration = ?
                    WHERE calibration_run_id = ? AND step_name = ?
                """, [
                    datetime.now(),
                    json.dumps(input_metrics) if input_metrics else None,
                    json.dumps(configuration) if configuration else None,
                    calibration_run_id,
                    step_name
                ])
            else:
                # Insert new
                step_id = conn.execute("SELECT nextval('step_summary_seq')").fetchone()[0]
                conn.execute("""
                    INSERT INTO step_summary (
                        id, calibration_run_id, step_name, step_status,
                        start_time, input_metrics, configuration
                    ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?)
                """, [
                    step_id,
                    calibration_run_id,
                    step_name,
                    datetime.now(),
                    json.dumps(input_metrics) if input_metrics else None,
                    json.dumps(configuration) if configuration else None
                ])
            
            logger.info(f"[AUDIT] Started step: {step_name} for run {calibration_run_id}")
        finally:
            conn.close()
    
    def complete_step(
        self,
        calibration_run_id: int,
        step_name: str,
        output_metrics: Optional[Dict] = None,
        notes: Optional[str] = None
    ):
        """Mark step as completed"""
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("""
                UPDATE step_summary 
                SET step_status = 'completed',
                    end_time = ?,
                    output_metrics = ?,
                    notes = ?
                WHERE calibration_run_id = ? AND step_name = ?
            """, [
                datetime.now(),
                json.dumps(output_metrics) if output_metrics else None,
                notes,
                calibration_run_id,
                step_name
            ])
            
            logger.info(f"[AUDIT] Completed step: {step_name} for run {calibration_run_id}")
        finally:
            conn.close()
    
    def get_step_audit(
        self,
        calibration_run_id: int,
        step_name: str
    ) -> Dict[str, Any]:
        """Get audit trail for a specific step"""
        conn = duckdb.connect(str(self.db_path))
        try:
            # Get step summary
            summary = conn.execute("""
                SELECT * FROM step_summary
                WHERE calibration_run_id = ? AND step_name = ?
            """, [calibration_run_id, step_name]).fetchone()
            
            # Get all actions for this step
            actions = conn.execute("""
                SELECT 
                    id, action, entity_type, entity_id,
                    metadata, metrics, performed_by, timestamp, duration_seconds
                FROM audit_log
                WHERE calibration_run_id = ? AND step_name = ?
                ORDER BY timestamp DESC
            """, [calibration_run_id, step_name]).fetchall()
            
            result = {
                'step_name': step_name,
                'calibration_run_id': calibration_run_id,
                'summary': None,
                'actions': []
            }
            
            if summary:
                result['summary'] = {
                    'status': summary[3],
                    'start_time': summary[4].isoformat() if summary[4] else None,
                    'end_time': summary[5].isoformat() if summary[5] else None,
                    'input_metrics': json.loads(summary[6]) if summary[6] else None,
                    'output_metrics': json.loads(summary[7]) if summary[7] else None,
                    'configuration': json.loads(summary[8]) if summary[8] else None,
                    'notes': summary[9]
                }
            
            for action in actions:
                result['actions'].append({
                    'id': action[0],
                    'action': action[1],
                    'entity_type': action[2],
                    'entity_id': action[3],
                    'metadata': json.loads(action[4]) if action[4] else None,
                    'metrics': json.loads(action[5]) if action[5] else None,
                    'performed_by': action[6],
                    'timestamp': action[7].isoformat() if action[7] else None,
                    'duration_seconds': action[8]
                })
            
            return result
        finally:
            conn.close()
    
    def get_full_audit(self, calibration_run_id: int) -> Dict[str, Any]:
        """Get complete audit trail for a calibration run"""
        conn = duckdb.connect(str(self.db_path))
        try:
            # Get all step summaries
            steps = conn.execute("""
                SELECT 
                    step_name, step_status, start_time, end_time,
                    input_metrics, output_metrics, configuration, notes
                FROM step_summary
                WHERE calibration_run_id = ?
                ORDER BY start_time
            """, [calibration_run_id]).fetchall()
            
            # Get all actions
            all_actions = conn.execute("""
                SELECT 
                    step_name, action, entity_type, entity_id,
                    metadata, metrics, performed_by, timestamp, duration_seconds
                FROM audit_log
                WHERE calibration_run_id = ?
                ORDER BY timestamp
            """, [calibration_run_id]).fetchall()
            
            result = {
                'calibration_run_id': calibration_run_id,
                'steps': [],
                'timeline': []
            }
            
            # Process steps
            for step in steps:
                step_data = {
                    'step_name': step[0],
                    'status': step[1],
                    'start_time': step[2].isoformat() if step[2] else None,
                    'end_time': step[3].isoformat() if step[3] else None,
                    'input_metrics': json.loads(step[4]) if step[4] else None,
                    'output_metrics': json.loads(step[5]) if step[5] else None,
                    'configuration': json.loads(step[6]) if step[6] else None,
                    'notes': step[7]
                }
                
                # Calculate duration
                if step[2] and step[3]:
                    duration = (step[3] - step[2]).total_seconds()
                    step_data['duration_seconds'] = duration
                
                result['steps'].append(step_data)
            
            # Process timeline
            for action in all_actions:
                result['timeline'].append({
                    'step_name': action[0],
                    'action': action[1],
                    'entity_type': action[2],
                    'entity_id': action[3],
                    'metadata': json.loads(action[4]) if action[4] else None,
                    'metrics': json.loads(action[5]) if action[5] else None,
                    'performed_by': action[6],
                    'timestamp': action[7].isoformat() if action[7] else None,
                    'duration_seconds': action[8]
                })
            
            return result
        finally:
            conn.close()
    
    def generate_report(self, calibration_run_id: int) -> Dict[str, Any]:
        """Generate a comprehensive audit report"""
        audit_data = self.get_full_audit(calibration_run_id)
        
        # Calculate overall statistics
        completed_steps = [s for s in audit_data['steps'] if s['status'] == 'completed']
        total_duration = sum(s.get('duration_seconds', 0) for s in completed_steps)
        
        report = {
            'calibration_run_id': calibration_run_id,
            'report_generated_at': datetime.now().isoformat(),
            'summary': {
                'total_steps': len(audit_data['steps']),
                'completed_steps': len(completed_steps),
                'total_actions': len(audit_data['timeline']),
                'total_duration_seconds': total_duration,
                'total_duration_formatted': f"{total_duration / 60:.2f} minutes"
            },
            'steps': audit_data['steps'],
            'timeline': audit_data['timeline']
        }
        
        return report
