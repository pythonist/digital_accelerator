# backend/case_pack/case_summary_builder.py
import sqlite3
import json
from datetime import datetime

class CaseSummaryBuilder:
    """
    Deterministic case summary builder.
    NO LLM usage. NO free-text generation.
    Pure data extraction and structuring.
    """
    
    def __init__(self, db_manager):
        self.db_manager = db_manager
    
    def build_case_summary(self, case_id):
        """
        Build structured case summary from database.
        Returns JSON-serializable dict.
        """
        conn = self.db_manager.connect()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            summary = {
                "case_id": case_id,
                "summary_generated_at": datetime.now().isoformat(),
                "alert_type": "Unknown",
                "why_triggered": [],
                "key_metrics": {},
                "system_recommendation": "REVIEW_REQUIRED",
                "evidence_references": {
                    "tables_used": [],
                    "transaction_ids": [],
                    "alert_ids": []
                }
            }
            
            # Get case metadata
            try:
                cursor.execute("SELECT * FROM cases WHERE case_id = ? OR caseid = ?", (case_id, case_id))
                case_row = cursor.fetchone()
                if case_row:
                    summary["case_metadata"] = dict(case_row)
            except:
                pass
            
            # Get alerts for this case
            alerts = []
            try:
                cursor.execute("SELECT * FROM alerts WHERE case_id = ? OR caseid = ?", (case_id, case_id))
                alerts = [dict(row) for row in cursor.fetchall()]
                summary["evidence_references"]["alert_ids"] = [a.get('alert_id', a.get('alertid', f'alert_{i}')) for i, a in enumerate(alerts)]
                summary["evidence_references"]["tables_used"].append("alerts")
            except:
                pass
            
            # Determine alert type from most severe alert
            if alerts:
                severity_map = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}
                most_severe = max(alerts, key=lambda a: severity_map.get(str(a.get('severity', 'low')).lower(), 0))
                summary["alert_type"] = most_severe.get('alert_type', most_severe.get('type', 'Suspicious Activity'))
                summary["alert_severity"] = most_severe.get('severity', 'Medium')
            
            # Build trigger reasons (deterministic rules)
            summary["why_triggered"] = self._extract_trigger_reasons(alerts, cursor, case_id)
            
            # Calculate key metrics
            summary["key_metrics"] = self._calculate_metrics(cursor, case_id, alerts)
            
            # System recommendation (rule-based)
            summary["system_recommendation"] = self._generate_recommendation(summary["key_metrics"], alerts)
            
            return summary
            
        except Exception as e:
            return {"error": str(e), "case_id": case_id}
        finally:
            self.db_manager.close_connection(conn)
    
    def _extract_trigger_reasons(self, alerts, cursor, case_id):
        """Extract why this case was flagged (deterministic)"""
        reasons = []
        
        for alert in alerts:
            severity = str(alert.get('severity', 'medium')).lower()
            alert_type = alert.get('alert_type', alert.get('type', 'Unknown'))
            
            if severity == 'critical':
                reasons.append(f"Critical alert: {alert_type}")
            elif severity == 'high':
                reasons.append(f"High-risk alert: {alert_type}")
        
        # Check transaction patterns
        try:
            cursor.execute("""
                SELECT COUNT(*) as cnt, SUM(CAST(amount AS REAL)) as total
                FROM transactions 
                WHERE case_id = ? OR caseid = ?
            """, (case_id, case_id))
            row = cursor.fetchone()
            if row and row['cnt']:
                if row['cnt'] > 50:
                    reasons.append(f"High transaction velocity: {row['cnt']} transactions")
                if row['total'] and row['total'] > 500000:
                    reasons.append(f"Large aggregate volume: ${row['total']:,.0f}")
        except:
            pass
        
        return reasons if reasons else ["Flagged for routine review"]
    
    def _calculate_metrics(self, cursor, case_id, alerts):
        """Calculate key numeric metrics"""
        metrics = {
            "alert_count": len(alerts),
            "critical_alerts": sum(1 for a in alerts if str(a.get('severity', '')).lower() == 'critical'),
            "transaction_count": 0,
            "total_volume": 0,
            "max_transaction": 0,
            "baseline_avg": 0,
            "alert_day_avg": 0
        }
        
        try:
            cursor.execute("""
                SELECT 
                    COUNT(*) as cnt,
                    SUM(CAST(amount AS REAL)) as total,
                    MAX(CAST(amount AS REAL)) as max_amt,
                    AVG(CAST(amount AS REAL)) as avg_amt
                FROM transactions
                WHERE case_id = ? OR caseid = ?
            """, (case_id, case_id))
            
            row = cursor.fetchone()
            if row:
                metrics["transaction_count"] = row['cnt'] or 0
                metrics["total_volume"] = row['total'] or 0
                metrics["max_transaction"] = row['max_amt'] or 0
                metrics["alert_day_avg"] = row['avg_amt'] or 0
                
                # Baseline (mock - 70% of alert day)
                metrics["baseline_avg"] = metrics["alert_day_avg"] * 0.7
        except:
            pass
        
        return metrics
    
    def _generate_recommendation(self, metrics, alerts):
        """Rule-based recommendation"""
        if metrics["critical_alerts"] > 0:
            return "ESCALATE_IMMEDIATELY"
        
        if metrics["alert_count"] >= 3 and metrics["total_volume"] > 100000:
            return "FILE_SAR"
        
        if metrics["transaction_count"] > 100 or metrics["total_volume"] > 500000:
            return "DEEP_INVESTIGATION"
        
        return "REVIEW_REQUIRED"