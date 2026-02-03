from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool
from api.tools.btsy.evidence.evidence_schema import CORE_TABLE_DDL, SUPPORT_TABLE_DDL


def _stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class StepSpec:
    step_id: str
    step_name: str
    inference_type: str


DEFAULT_ENGINE_VERSION = "btsy_autorun_engine_v1"


class CalibrationEvidenceStore:
    def __init__(self, run_db_path: Path):
        self.run_db_path = run_db_path

    def ensure_schema(self) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            for ddl in CORE_TABLE_DDL:
                conn.execute(ddl)
            for ddl in SUPPORT_TABLE_DDL:
                conn.execute(ddl)

    def upsert_run(
        self,
        *,
        run_id: int,
        scenario_id: Optional[str],
        mode: str,
        snapshot_id: Optional[str],
        config_obj: Dict[str, Any],
        status: str,
        triggered_by: Optional[str],
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        engine_version: str = DEFAULT_ENGINE_VERSION,
    ) -> str:
        config_hash = _sha256_hex(_stable_json(config_obj or {}))
        with duckdb_pool.connection(self.run_db_path) as conn:
            existing = conn.execute(
                "SELECT run_id FROM calibration_run WHERE run_id = ?",
                [int(run_id)],
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE calibration_run
                    SET scenario_id = ?,
                        mode = ?,
                        snapshot_id = ?,
                        config_hash = ?,
                        engine_version = ?,
                        started_at = COALESCE(started_at, ?),
                        completed_at = COALESCE(?, completed_at),
                        status = ?,
                        triggered_by = ?
                    WHERE run_id = ?
                    """,
                    [
                        scenario_id,
                        mode,
                        snapshot_id,
                        config_hash,
                        engine_version,
                        started_at,
                        completed_at,
                        status,
                        triggered_by,
                        int(run_id),
                    ],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO calibration_run (
                      run_id, scenario_id, mode, snapshot_id, config_hash, engine_version,
                      started_at, completed_at, status, triggered_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        int(run_id),
                        scenario_id,
                        mode,
                        snapshot_id,
                        config_hash,
                        engine_version,
                        started_at,
                        completed_at,
                        status,
                        triggered_by,
                    ],
                )
        return config_hash

    def mark_run_started(self, run_id: int) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                "UPDATE calibration_run SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP), status = COALESCE(status, 'RUNNING') WHERE run_id = ?",
                [int(run_id)],
            )

    def mark_run_completed(self, run_id: int, status: str) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                "UPDATE calibration_run SET completed_at = CURRENT_TIMESTAMP, status = ? WHERE run_id = ?",
                [status, int(run_id)],
            )

    def start_step(
        self,
        *,
        run_id: int,
        step_id: str,
        step_name: str,
        status: str = "RUNNING",
        input_tables: Optional[List[str]] = None,
        output_tables: Optional[List[str]] = None,
        config_obj: Optional[Dict[str, Any]] = None,
    ) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                """
                INSERT INTO calibration_step_run (
                  run_id, step_id, step_name, started_at, status, input_tables, output_tables, config_json
                ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
                """,
                [
                    int(run_id),
                    step_id,
                    step_name,
                    status,
                    _stable_json(input_tables or []),
                    _stable_json(output_tables or []),
                    _stable_json(config_obj or {}),
                ],
            )

    def complete_step(
        self,
        *,
        run_id: int,
        step_id: str,
        status: str,
        input_tables: Optional[List[str]] = None,
        output_tables: Optional[List[str]] = None,
        config_obj: Optional[Dict[str, Any]] = None,
    ) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                """
                UPDATE calibration_step_run
                SET completed_at = CURRENT_TIMESTAMP,
                    status = ?,
                    input_tables = ?,
                    output_tables = ?,
                    config_json = ?
                WHERE run_id = ? AND step_id = ?
                  AND started_at = (
                    SELECT MAX(started_at) FROM calibration_step_run WHERE run_id = ? AND step_id = ?
                  )
                """,
                [
                    status,
                    _stable_json(input_tables or []),
                    _stable_json(output_tables or []),
                    _stable_json(config_obj or {}),
                    int(run_id),
                    step_id,
                    int(run_id),
                    step_id,
                ],
            )

    def register_artifact(
        self,
        *,
        run_id: int,
        step_id: str,
        artifact_type: str,
        artifact_key: str,
        table_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                """
                INSERT INTO calibration_step_artifact (
                  run_id, step_id, artifact_type, artifact_key, table_name, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    int(run_id),
                    step_id,
                    artifact_type,
                    artifact_key,
                    table_name,
                    _stable_json(metadata or {}),
                ],
            )

    def insert_metrics(
        self,
        *,
        run_id: int,
        step_id: str,
        metrics: Dict[str, Any],
    ) -> None:
        rows = []
        for k, v in (metrics or {}).items():
            metric_value = None
            metric_json = None
            if isinstance(v, (int, float)) and v is not None:
                metric_value = float(v)
                metric_json = None
            else:
                metric_value = None
                metric_json = _stable_json(v)
            rows.append([int(run_id), step_id, str(k), metric_value, metric_json])
        if not rows:
            return
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.executemany(
                """
                INSERT INTO calibration_metric (run_id, step_id, metric_key, metric_value, metric_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )

    def insert_chart_series(
        self,
        *,
        run_id: int,
        step_id: str,
        chart_key: str,
        series_key: str,
        points: Iterable[Dict[str, Any]],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        md = _stable_json(metadata or {})
        rows = []
        for p in points or []:
            x = p.get("x")
            y = p.get("y")
            rows.append([int(run_id), step_id, chart_key, series_key, None if x is None else str(x), None if y is None else float(y), md])
        if not rows:
            return
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.executemany(
                """
                INSERT INTO calibration_chart_series (
                  run_id, step_id, chart_key, series_key, x_value, y_value, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def store_inference(
        self,
        *,
        run_id: int,
        step_id: str,
        inference_type: str,
        input_metrics: Optional[Dict[str, Any]],
        inference_text: str,
    ) -> None:
        with duckdb_pool.connection(self.run_db_path) as conn:
            conn.execute(
                """
                INSERT INTO calibration_inference (
                  run_id, step_id, inference_type, input_metrics_json, inference_text
                ) VALUES (?, ?, ?, ?, ?)
                """,
                [
                    int(run_id),
                    step_id,
                    inference_type,
                    _stable_json(input_metrics or {}),
                    inference_text,
                ],
            )

    def create_table_from_rows(
        self,
        *,
        conn: duckdb.DuckDBPyConnection,
        table_name: str,
        columns: List[str],
        rows: List[List[Any]],
    ) -> None:
        if not columns:
            raise ValueError("columns required")
        col_sql = ", ".join([f"{c} TEXT" for c in columns])
        conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({col_sql})")
        if rows:
            placeholders = ", ".join(["?"] * len(columns))
            conn.executemany(f"INSERT INTO {table_name} VALUES ({placeholders})", rows)

