import json
from datetime import datetime
from typing import Any, Dict, List, Optional


class TypologyHistoryService:
    def ensure_schema(self, cursor):
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS typology_intelligence_results (
                case_id TEXT PRIMARY KEY,
                latest_version INTEGER DEFAULT 0,
                analysis_json TEXT NOT NULL,
                include_in_report INTEGER DEFAULT 1,
                summary_text TEXT,
                primary_typology TEXT,
                confidence TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS typology_intelligence_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                analysis_json TEXT NOT NULL,
                include_in_report INTEGER DEFAULT 1,
                summary_text TEXT,
                primary_typology TEXT,
                confidence TEXT,
                generated_by TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    def _now(self) -> str:
        return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    def load_case_result(self, cursor, case_id: str) -> Optional[Dict[str, Any]]:
        self.ensure_schema(cursor)
        cursor.execute(
            """
            SELECT case_id, latest_version, analysis_json, include_in_report, summary_text, primary_typology, confidence, created_at, updated_at
            FROM typology_intelligence_results
            WHERE case_id = ?
            """,
            (case_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "case_id": row[0],
            "version": row[1],
            "payload": json.loads(row[2]) if row[2] else {},
            "include_in_report": bool(row[3]),
            "summary_text": row[4] or "",
            "primary_typology": row[5] or "",
            "confidence": row[6] or "",
            "created_at": row[7],
            "updated_at": row[8],
        }

    def list_case_history(self, cursor, case_id: str, limit: int = 12) -> List[Dict[str, Any]]:
        self.ensure_schema(cursor)
        cursor.execute(
            """
            SELECT id, case_id, version, include_in_report, summary_text, primary_typology, confidence, generated_by, created_at
            FROM typology_intelligence_history
            WHERE case_id = ?
            ORDER BY version DESC, created_at DESC
            LIMIT ?
            """,
            (case_id, max(1, int(limit or 12))),
        )
        return [
            {
                "id": row[0],
                "case_id": row[1],
                "version": row[2],
                "include_in_report": bool(row[3]),
                "summary_text": row[4] or "",
                "primary_typology": row[5] or "",
                "confidence": row[6] or "",
                "generated_by": row[7] or "system",
                "created_at": row[8],
            }
            for row in cursor.fetchall()
        ]

    def save_case_result(self, cursor, case_id: str, payload: Dict[str, Any], include_in_report: bool = True, generated_by: str = "system") -> Dict[str, Any]:
        self.ensure_schema(cursor)
        current = self.load_case_result(cursor, case_id)
        version = int((current or {}).get("version") or 0) + 1
        now = self._now()
        primary = (payload.get("primary_typology") or {}).get("typology_name") or ""
        confidence = (payload.get("primary_typology") or {}).get("confidence") or ""
        summary_text = ((payload.get("summary_sections") or {}).get("assessment_overview") or "").strip()
        serialized = json.dumps(payload, default=str)
        cursor.execute(
            """
            INSERT INTO typology_intelligence_results (
                case_id, latest_version, analysis_json, include_in_report, summary_text, primary_typology, confidence, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(case_id) DO UPDATE SET
                latest_version = excluded.latest_version,
                analysis_json = excluded.analysis_json,
                include_in_report = excluded.include_in_report,
                summary_text = excluded.summary_text,
                primary_typology = excluded.primary_typology,
                confidence = excluded.confidence,
                updated_at = excluded.updated_at
            """,
            (case_id, version, serialized, 1 if include_in_report else 0, summary_text, primary, confidence, now if not current else current.get("created_at") or now, now),
        )
        cursor.execute(
            """
            INSERT INTO typology_intelligence_history (
                case_id, version, analysis_json, include_in_report, summary_text, primary_typology, confidence, generated_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (case_id, version, serialized, 1 if include_in_report else 0, summary_text, primary, confidence, generated_by, now),
        )
        return self.load_case_result(cursor, case_id)
