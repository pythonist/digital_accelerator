# backend/calibration/services/approval_service.py
"""
Approval Service - Governance & Sign-Off
Handles immutable run locking and audit trail
"""
from datetime import datetime
import json

class ApprovalService:
    """Manages calibration approval workflow"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def approve_run(self, run_id, approved_by, comment=None):
        """
        Approve and lock calibration run
        Makes run immutable
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # Validate prerequisites
        cursor.execute("""
            SELECT status, selected_threshold 
            FROM calibration_runs 
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Run {run_id} not found")
        
        if row['selected_threshold'] is None:
            raise ValueError("Cannot approve: No threshold selected")
        
        if row['status'] in ['approved', 'rejected']:
            raise ValueError(f"Run already {row['status']}")
        
        # Lock the run
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE calibration_runs
            SET status = 'approved',
                approved_by = ?,
                approved_at = ?,
                approval_comment = ?,
                updated_at = ?
            WHERE run_id = ?
        """, (approved_by, now, comment, now, run_id))
        
        # Audit trail
        self._log_action(cursor, run_id, approved_by, 'approved', {
            'comment': comment,
            'timestamp': now
        })
        
        conn.commit()
        
        # Fetch updated run
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        conn.close()
        
        print(f"✅ Run {run_id} APPROVED by {approved_by}")
        return run
    
    def reject_run(self, run_id, rejected_by, reason):
        """
        Reject calibration run
        Allows re-calibration
        """
        if not reason:
            raise ValueError("Rejection reason required")
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # Validate state
        cursor.execute("SELECT status FROM calibration_runs WHERE run_id = ?", (run_id,))
        row = cursor.fetchone()
        
        if not row:
            raise ValueError(f"Run {run_id} not found")
        
        if row['status'] == 'approved':
            raise ValueError("Cannot reject: Already approved")
        
        # Update status
        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE calibration_runs
            SET status = 'rejected',
                approved_by = ?,
                approved_at = ?,
                approval_comment = ?,
                current_step = 3,
                updated_at = ?
            WHERE run_id = ?
        """, (rejected_by, now, reason, now, run_id))
        
        # Audit trail
        self._log_action(cursor, run_id, rejected_by, 'rejected', {
            'reason': reason,
            'timestamp': now
        })
        
        conn.commit()
        
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        conn.close()
        
        print(f"❌ Run {run_id} REJECTED by {rejected_by}")
        return run
    
    def get_approval_metadata(self, run_id):
        """Get approval details for display"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT approved_by, approved_at, approval_comment, status
            FROM calibration_runs
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            'approved_by': row['approved_by'],
            'approved_at': row['approved_at'],
            'comment': row['approval_comment'],
            'status': row['status'],
            'is_locked': row['status'] in ['approved', 'rejected']
        }
    
    def _log_action(self, cursor, run_id, user, action, details):
        """Write to audit log"""
        cursor.execute("""
            INSERT INTO calibration_audit_log (run_id, user, action, details)
            VALUES (?, ?, ?, ?)
        """, (run_id, user, action, json.dumps(details)))