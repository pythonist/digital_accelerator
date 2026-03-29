import json
from datetime import datetime


class NetworkReportAdapterService:
    def ensure_schema(self, cursor):
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS network_intelligence_results (
                case_id TEXT PRIMARY KEY,
                analysis_json TEXT NOT NULL,
                include_in_report INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    def save_case_result(self, cursor, case_id, payload, include_in_report=True):
        self.ensure_schema(cursor)
        now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        cursor.execute(
            """
            INSERT INTO network_intelligence_results (
                case_id, analysis_json, include_in_report, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(case_id) DO UPDATE SET
                analysis_json = excluded.analysis_json,
                include_in_report = excluded.include_in_report,
                updated_at = excluded.updated_at
            """,
            (
                case_id,
                json.dumps(payload, default=str),
                1 if include_in_report else 0,
                now,
                now,
            ),
        )
        return self.load_case_result(cursor, case_id)

    def load_case_result(self, cursor, case_id):
        self.ensure_schema(cursor)
        cursor.execute(
            """
            SELECT case_id, analysis_json, include_in_report, created_at, updated_at
            FROM network_intelligence_results
            WHERE case_id = ?
            """,
            (case_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "case_id": row[0],
            "payload": json.loads(row[1]) if row[1] else {},
            "include_in_report": bool(row[2]),
            "created_at": row[3],
            "updated_at": row[4],
        }

    def to_report_payload(self, analysis_payload):
        payload = analysis_payload or {}
        report = payload.get("report_payload") or {}
        return {
            "graph_summary": report.get("graph_summary") or payload.get("executive_summary") or "",
            "suspicious_clusters": report.get("suspicious_clusters") or [],
            "hub_entities": report.get("hub_entities") or [],
            "bridge_entities": report.get("bridge_entities") or [],
            "high_risk_entities": report.get("high_risk_entities") or [],
            "funnel_patterns": report.get("funnel_patterns") or [],
            "circular_flow_findings": report.get("circular_flow_findings") or [],
            "path_highlights": report.get("path_highlights") or [],
            "visibility_limitations": report.get("visibility_limitations") or "",
            "network_risk_assessment": report.get("network_risk_assessment") or {},
            "report_snippets": payload.get("report_snippets") or [],
        }
