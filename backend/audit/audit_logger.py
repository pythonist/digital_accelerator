"""
Audit Logger for AML System
File: /audit_new/audit_logger.py

Tracks all system actions in an isolated, tamper-evident database.
"""

import sqlite3
import json
import hashlib
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

class AuditLogger:
    """Secure Audit Logger with Hash Chaining and Isolated Database."""
    
    def __init__(self, audit_folder='audit', db_name='audit_log.db'):
        """Initialize audit logger with isolated DB path"""
        # 1. Setup Isolated Database Path
        self.audit_dir = audit_folder
        if not os.path.exists(self.audit_dir):
            os.makedirs(self.audit_dir)
            
        self.db_path = os.path.join(self.audit_dir, db_name)
        self.init_schema()

    def _connect(self):
        """Connect specifically to the audit database."""
        return sqlite3.connect(self.db_path)

    def init_schema(self):
        """Initialize the audit table with tamper-evident hash columns."""
        conn = self._connect()
        cursor = conn.cursor()
        
        # Added previous_hash and current_hash for tamper evidence
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                user TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id TEXT,
                details TEXT,
                ip_address TEXT,
                previous_hash TEXT,
                current_hash TEXT
            )
        ''')
        conn.commit()
        conn.close()

    def _calculate_hash(self, timestamp, user, action, details, prev_hash):
        """
        Creates a SHA-256 hash of the current record + the previous record's hash.
        This creates the 'chain' that breaks if data is altered.
        """
        # Combine all fields into a single string payload
        # We use a separator '|' to avoid collision attacks
        payload = f"{timestamp}|{user}|{action}|{details}|{prev_hash}"
        return hashlib.sha256(payload.encode('utf-8')).hexdigest()

    def log_action(self, user: str, action: str, 
                   entity_type: str = None, entity_id: str = None,
                   details: Dict = None, ip_address: str = None) -> bool:
        """
        Log a system action with cryptographic chaining.
        """
        conn = self._connect()
        cursor = conn.cursor()
        
        try:
            timestamp = datetime.now().isoformat()
            details_json = json.dumps(details) if details else "{}"

            # 1. Get the hash of the MOST RECENT row to link the chain
            cursor.execute("SELECT current_hash FROM audit_log ORDER BY id DESC LIMIT 1")
            last_row = cursor.fetchone()
            
            # If first log ever, use a Genesis Hash (64 zeros)
            previous_hash = last_row[0] if last_row else "0" * 64

            # 2. Calculate the NEW hash
            current_hash = self._calculate_hash(timestamp, user, action, details_json, previous_hash)

            # 3. Insert the record
            cursor.execute('''
                INSERT INTO audit_log 
                (timestamp, user, action, entity_type, entity_id, details, ip_address, previous_hash, current_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (timestamp, user, action, entity_type, entity_id, details_json, ip_address, previous_hash, current_hash))
            
            conn.commit()
            return True
        except Exception as e:
            print(f"❌ AUDIT LOGGING FAILED: {e}")
            return False
        finally:
            conn.close()

    # =================================================================
    # CONVENIENCE WRAPPERS
    # =================================================================

    def log_login(self, user, success, ip_address=None):
        return self.log_action(
            user=user,
            action='login_attempt',
            entity_type='auth',
            details={'success': success},
            ip_address=ip_address
        )
    
    def log_logout(self, user, ip_address=None):
        return self.log_action(
            user=user,
            action='logout',
            entity_type='auth',
            ip_address=ip_address
        )

    def log_case_view(self, user, case_id, ip_address=None):
        return self.log_action(
            user=user,
            action='view_case',
            entity_type='case',
            entity_id=case_id,
            details={'access_type': 'read'},
            ip_address=ip_address
        )
    
    def log_case_update(self, user, case_id, changes, ip_address=None):
        return self.log_action(
            user=user,
            action='update_case',
            entity_type='case',
            entity_id=case_id,
            details={'changes': changes},
            ip_address=ip_address
        )
    
    def log_disposition_change(self, user, case_id, old_disposition, new_disposition, ip_address=None):
        return self.log_action(
            user=user,
            action='change_disposition',
            entity_type='case',
            entity_id=case_id,
            details={
                'old_value': old_disposition,
                'new_value': new_disposition
            },
            ip_address=ip_address
        )
    
    def log_str_filed(self, user: str, case_id: str, ip_address: str = None):
        return self.log_action(
            user=user,
            action='file_str',
            entity_type='case',
            entity_id=case_id,
            details={'action': 'STR filed', 'critical': True},
            ip_address=ip_address
        )

    def log_case_escalation(self, user: str, case_id: str, reason: str, ip_address: str = None):
        return self.log_action(
            user=user,
            action='escalate_case',
            entity_type='case',
            entity_id=case_id,
            details={'reason': reason, 'escalated': True},
            ip_address=ip_address
        )

    def log_rule_execution(self, user, case_id, rule_results, ip_address=None):
        return self.log_action(
            user=user,
            action='execute_rules',
            entity_type='case',
            entity_id=case_id,
            details={
                'violations': rule_results.get('total_violations', 0),
                'max_severity': rule_results.get('max_severity')
            },
            ip_address=ip_address
        )
    
    def log_search(self, user: str, search_query: str, results_count: int, ip_address: str = None):
        return self.log_action(
            user=user,
            action='search',
            entity_type='search',
            details={
                'query': search_query,
                'results': results_count
            },
            ip_address=ip_address
        )

    def log_export(self, user: str, export_type: str, entity_ids: list, ip_address: str = None):
        return self.log_action(
            user=user,
            action='export_data',
            entity_type=export_type,
            details={
                'export_count': len(entity_ids),
                'entities': entity_ids[:10] 
            },
            ip_address=ip_address
        )
    
    def log_data_ingestion(self, user, filename, records_count, ip_address=None):
        return self.log_action(
            user=user,
            action='ingest_data',
            entity_type='data',
            details={
                'filename': filename,
                'records': records_count
            },
            ip_address=ip_address
        )

    # =================================================================
    # RETRIEVAL & VERIFICATION
    # =================================================================

    def get_audit_trail(self, entity_type=None, entity_id=None, user=None, 
                       start_date=None, end_date=None, limit=100):
        """Retrieve audit logs with filtering."""
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT * FROM audit_log WHERE 1=1"
        params = []
        
        if entity_type:
            query += " AND entity_type = ?"
            params.append(entity_type)
        if entity_id:
            query += " AND entity_id = ?"
            params.append(entity_id)
        if user:
            query += " AND user = ?"
            params.append(user)
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)

        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = []
        for row in cursor.fetchall():
            item = dict(row)
            # Parse JSON details back to dict for frontend
            if item.get('details'):
                try:
                    item['details'] = json.loads(item['details'])
                except:
                    pass
            rows.append(item)
            
        conn.close()
        return rows

    def get_case_audit_trail(self, case_id: str) -> list:
        """Get complete audit trail for a case"""
        return self.get_audit_trail(entity_type='case', entity_id=case_id)

    def verify_integrity(self):
        """
        Check if the database has been tampered with by re-calculating 
        hashes row by row and comparing them to stored hashes.
        """
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM audit_log ORDER BY id ASC")
        rows = cursor.fetchall()
        conn.close()

        prev_hash = "0" * 64
        for row in rows:
            # Row index mapping: 
            # 0:id, 1:timestamp, 2:user, 3:action, 4:entity_type, 
            # 5:entity_id, 6:details, 7:ip_address, 8:previous_hash, 9:current_hash
            
            row_id = row[0]
            timestamp = row[1]
            user = row[2]
            action = row[3]
            details = row[6]
            stored_prev = row[8]
            stored_curr = row[9]

            # Check 1: Does this row link correctly to the previous one?
            if stored_prev != prev_hash:
                return False, f"Broken Chain at ID {row_id}: Previous hash mismatch."
            
            # Check 2: Is this row's data valid?
            calced_curr = self._calculate_hash(timestamp, user, action, details, prev_hash)
            if calced_curr != stored_curr:
                return False, f"Data Tampered at ID {row_id}: Hash mismatch."
            
            # Move forward
            prev_hash = stored_curr 
            
        return True, "Integrity Verified: All logs are consistent and untampered."

    def generate_audit_report(self, start_date: str, end_date: str) -> Dict:
        """Generate audit summary report"""
        conn = self._connect()
        cursor = conn.cursor()
        
        # Total actions
        cursor.execute('''
            SELECT COUNT(*) FROM audit_log 
            WHERE timestamp BETWEEN ? AND ?
        ''', (start_date, end_date))
        total_actions = cursor.fetchone()[0]
        
        # Actions by type
        cursor.execute('''
            SELECT action, COUNT(*) as count 
            FROM audit_log 
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY action
            ORDER BY count DESC
        ''', (start_date, end_date))
        actions_by_type = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Critical actions
        cursor.execute('''
            SELECT COUNT(*) FROM audit_log 
            WHERE action IN ('file_str', 'escalate_case', 'change_disposition')
            AND timestamp BETWEEN ? AND ?
        ''', (start_date, end_date))
        critical_actions = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            'period': {'start': start_date, 'end': end_date},
            'total_actions': total_actions,
            'actions_by_type': actions_by_type,
            'critical_actions': critical_actions
        }

# Usage Example
if __name__ == '__main__':
    audit = AuditLogger()
    
    # Log actions
    audit.log_case_view('analyst1', 'CASE000001', '192.168.1.100')
    print("Log added.")
    
    # Verify
    success, msg = audit.verify_integrity()
    print(msg)