import json
import uuid
from datetime import datetime
from pathlib import Path


class ReportStorageService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.output_dir = Path(getattr(db_manager, "db_path", "data/reports.db")).parent / "reports"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def ensure_schema(self, cursor):
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS case_reports (
                report_id TEXT PRIMARY KEY,
                case_id TEXT,
                batch_ref TEXT,
                report_name TEXT,
                report_scope TEXT,
                report_format TEXT,
                status TEXT,
                created_by TEXT,
                created_at TEXT,
                generated_at TEXT,
                version_no INTEGER,
                file_path TEXT,
                file_name TEXT,
                summary_json TEXT
            )
            """
        )

    def next_version(self, cursor, case_id):
        self.ensure_schema(cursor)
        cursor.execute("SELECT COALESCE(MAX(version_no), 0) FROM case_reports WHERE case_id = ?", (case_id,))
        row = cursor.fetchone()
        return int(row[0] or 0) + 1

    def build_output_path(self, file_name):
        return self.output_dir / file_name

    def register_report(self, cursor, *, case_id=None, batch_ref=None, report_name, report_scope, report_format="pdf",
                        status="generated", created_by="system", version_no=1, file_path, file_name, summary=None):
        self.ensure_schema(cursor)
        report_id = f"RPT-{uuid.uuid4().hex[:12].upper()}"
        now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        cursor.execute(
            """
            INSERT INTO case_reports (
                report_id, case_id, batch_ref, report_name, report_scope, report_format, status,
                created_by, created_at, generated_at, version_no, file_path, file_name, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                case_id,
                batch_ref,
                report_name,
                report_scope,
                report_format,
                status,
                created_by,
                now,
                now,
                int(version_no or 1),
                str(file_path),
                file_name,
                json.dumps(summary or {}, default=str),
            ),
        )
        return {
            "report_id": report_id,
            "case_id": case_id,
            "batch_ref": batch_ref,
            "report_name": report_name,
            "report_scope": report_scope,
            "report_format": report_format,
            "status": status,
            "created_by": created_by,
            "created_at": now,
            "generated_at": now,
            "version_no": int(version_no or 1),
            "file_path": str(file_path),
            "file_name": file_name,
            "summary": summary or {},
        }

    def list_history(self, cursor, *, case_id=None, limit=100):
        self.ensure_schema(cursor)
        if case_id:
            cursor.execute(
                """
                SELECT report_id, case_id, batch_ref, report_name, report_scope, report_format, status,
                       created_by, created_at, generated_at, version_no, file_path, file_name, summary_json
                FROM case_reports
                WHERE case_id = ?
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (case_id, int(limit)),
            )
        else:
            cursor.execute(
                """
                SELECT report_id, case_id, batch_ref, report_name, report_scope, report_format, status,
                       created_by, created_at, generated_at, version_no, file_path, file_name, summary_json
                FROM case_reports
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (int(limit),),
            )
        rows = cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    def get_report(self, cursor, report_id):
        self.ensure_schema(cursor)
        cursor.execute(
            """
            SELECT report_id, case_id, batch_ref, report_name, report_scope, report_format, status,
                   created_by, created_at, generated_at, version_no, file_path, file_name, summary_json
            FROM case_reports
            WHERE report_id = ?
            """,
            (report_id,),
        )
        row = cursor.fetchone()
        return self._row_to_dict(row) if row else None

    def latest_for_case(self, cursor, case_id):
        rows = self.list_history(cursor, case_id=case_id, limit=1)
        return rows[0] if rows else None

    def _row_to_dict(self, row):
        if not row:
            return None
        return {
            "report_id": row[0],
            "case_id": row[1],
            "batch_ref": row[2],
            "report_name": row[3],
            "report_scope": row[4],
            "report_format": row[5],
            "status": row[6],
            "created_by": row[7],
            "created_at": row[8],
            "generated_at": row[9],
            "version_no": row[10],
            "file_path": row[11],
            "file_name": row[12],
            "summary": json.loads(row[13]) if row[13] else {},
        }
