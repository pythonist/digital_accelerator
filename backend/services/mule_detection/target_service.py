import hashlib
from datetime import datetime

import duckdb

from services.mule_detection.db_service import get_md_db_service


def _now_iso() -> str:
    return datetime.now().isoformat()


def _sha16(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


class TargetService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        return self.md_db.connect(self.env_id)

    def _resolve_target_column(self, conn: duckdb.DuckDBPyConnection, target_name: str | None):
        cols_df = conn.execute("PRAGMA table_info('mule_accounts_raw')").df()
        col_names = cols_df["name"].tolist() if len(cols_df) else []
        if target_name:
            return target_name if target_name in col_names else None
        return "is_mule" if "is_mule" in col_names else None

    def _get_target_governance(self, conn: duckdb.DuckDBPyConnection, target_name: str) -> dict:
        row = conn.execute(
            """
            SELECT description, source_system, approved_by, owner, updated_at
            FROM mule_target_governance
            WHERE environment_id = ? AND target_name = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            [self.env_id, target_name],
        ).fetchone()
        if not row:
            return {}
        description, source_system, approved_by, owner, updated_at = row
        return {
            "description": description,
            "source_system": source_system,
            "approved_by": approved_by,
            "owner": owner,
            "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at),
        }

    def target_summary(self, target_name: str = "is_mule") -> dict:
        conn, _paths = self._conn()
        try:
            target_col = self._resolve_target_column(conn, target_name)
            if not target_col:
                return {"usable_for_supervised_learning": False, "target_name": target_name}
            col_sql = f'"{target_col}"'
            population = int(
                conn.execute(
                    "SELECT COUNT(DISTINCT account_id) FROM mule_accounts_raw WHERE environment_id = ?",
                    [self.env_id],
                ).fetchone()[0]
                or 0
            )

            has_label = False
            positives = 0
            negatives = 0
            try:
                labeled_total = int(
                    conn.execute(
                        f"""
                        SELECT COUNT(DISTINCT account_id)
                        FROM mule_accounts_raw
                        WHERE environment_id = ? AND {col_sql} IS NOT NULL
                        """,
                        [self.env_id],
                    ).fetchone()[0]
                    or 0
                )
                has_label = labeled_total > 0
                if has_label:
                    positives = int(
                        conn.execute(
                            f"""
                            SELECT COUNT(DISTINCT account_id)
                            FROM mule_accounts_raw
                            WHERE environment_id = ? AND CAST({col_sql} AS INTEGER) = 1
                            """,
                            [self.env_id],
                        ).fetchone()[0]
                        or 0
                    )
                    negatives = int(
                        conn.execute(
                            f"""
                            SELECT COUNT(DISTINCT account_id)
                            FROM mule_accounts_raw
                            WHERE environment_id = ? AND CAST({col_sql} AS INTEGER) = 0
                            """,
                            [self.env_id],
                        ).fetchone()[0]
                        or 0
                    )
            except Exception:
                has_label = False

            if not has_label:
                return {"usable_for_supervised_learning": False, "target_name": target_name}

            coverage_row = conn.execute(
                """
                SELECT MIN(txn_timestamp), MAX(txn_timestamp)
                FROM mule_transactions_raw
                WHERE environment_id = ?
                """,
                [self.env_id],
            ).fetchone()
            coverage_start, coverage_end = (coverage_row or [None, None])[:2]

            upload_row = conn.execute(
                """
                SELECT MAX(uploaded_at)
                FROM mule_uploads
                WHERE environment_id = ?
                """,
                [self.env_id],
            ).fetchone()
            last_refresh = upload_row[0] if upload_row else None

            gov = self._get_target_governance(conn, target_name)
            description = gov.get("description") or "Confirmed mule based on investigation closure"
            source_system = gov.get("source_system") or "case_management"
            approved_by = gov.get("approved_by") or "Model Risk"

            labeled_total = positives + negatives
            positive_rate = (float(positives) / float(labeled_total)) if labeled_total else 0.0

            version_payload = {
                "target_name": target_name,
                "population": population,
                "positives": positives,
                "negatives": negatives,
                "coverage_start": coverage_start.isoformat() if hasattr(coverage_start, "isoformat") else str(coverage_start),
                "coverage_end": coverage_end.isoformat() if hasattr(coverage_end, "isoformat") else str(coverage_end),
                "source_system": source_system,
                "last_refresh": last_refresh.isoformat() if hasattr(last_refresh, "isoformat") else str(last_refresh),
                "approved_by": approved_by,
            }
            version = _sha16(str(version_payload))

            return {
                "target_name": target_name,
                "description": description,
                "population": population,
                "positives": positives,
                "negatives": negatives,
                "positive_rate": positive_rate,
                "coverage_start": coverage_start.isoformat() if hasattr(coverage_start, "isoformat") else (str(coverage_start) if coverage_start else None),
                "coverage_end": coverage_end.isoformat() if hasattr(coverage_end, "isoformat") else (str(coverage_end) if coverage_end else None),
                "source_system": source_system,
                "last_refresh": last_refresh.isoformat() if hasattr(last_refresh, "isoformat") else (str(last_refresh) if last_refresh else None),
                "version": version,
                "approved_by": approved_by,
                "usable_for_supervised_learning": True,
                "owner": gov.get("owner"),
            }
        finally:
            conn.close()
