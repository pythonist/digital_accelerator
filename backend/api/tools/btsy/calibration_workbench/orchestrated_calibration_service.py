from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
import json
import threading
import traceback

from api.tools.btsy.duckdb_pool import duckdb_pool
from api.tools.btsy.calibration_workbench.calibration_workbench_service import CalibrationWorkbenchService
from api.tools.btsy.threshold_simulation.threshold_simulation_service import ThresholdSimulationService
from api.tools.btsy.risk_population.risk_population_service import RiskPopulationService
from api.tools.btsy.validation.ks_validation_service import KSValidationService
from api.tools.btsy.validation.j_statistic_service import JStatisticService


class OrchestratedCalibrationService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_orchestrated_runs (
                  ocr_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  baseline_ocr_run_id INTEGER,
                  status TEXT NOT NULL,
                  config_json TEXT NOT NULL,
                  warnings_json TEXT,
                  error_text TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  started_at TIMESTAMP,
                  finished_at TIMESTAMP,
                  final_boundary_id INTEGER,
                  approved_boundary_id INTEGER,
                  approved_by TEXT,
                  approved_at TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_step_outputs (
                  ocr_run_id INTEGER NOT NULL,
                  step_key TEXT NOT NULL,
                  step_order INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  metrics_json TEXT,
                  artifact_json TEXT,
                  warning_text TEXT,
                  error_text TEXT,
                  started_at TIMESTAMP,
                  finished_at TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_boundary_final (
                  ocr_run_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  threshold_value DOUBLE,
                  atl_count INTEGER,
                  stability_flags_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_intermediate_report (
                  ocr_run_id INTEGER NOT NULL,
                  report_json TEXT NOT NULL,
                  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_frozen_risk_entities (
                  session_id INTEGER NOT NULL,
                  ocr_run_id INTEGER,
                  boundary_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  aggregated_value DOUBLE,
                  atl_flag BOOLEAN NOT NULL,
                  frozen_by TEXT,
                  frozen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_frozen_risk_session_boundary ON calibration_frozen_risk_entities(session_id, boundary_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_frozen_risk_boundary_atl ON calibration_frozen_risk_entities(boundary_id, atl_flag)")

    def _next_id(self, conn, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _init_steps(self, ocr_run_id: int):
        steps = [
            ('step_3_1_population', 31, 'Step 3.1 — Population validated'),
            ('step_3_2_aggregation', 32, 'Step 3.2 — Behaviour aggregated'),
            ('step_3_3_boundary', 33, 'Step 3.3 — Boundary constructed'),
            ('step_3_4_ks', 34, 'Step 3.4 — KS validation'),
            ('step_3_5_stress', 35, 'Step 3.5 — Stress testing'),
            ('step_3_6_j', 36, 'Step 3.6 — J-Statistic separation'),
            ('final_report', 90, 'Intermediate Calibration Report'),
            ('final_boundary', 99, 'Final Boundary Object'),
        ]
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("DELETE FROM calibration_step_outputs WHERE ocr_run_id = ?", [ocr_run_id])
            for step_key, step_order, title in steps:
                conn.execute("""
                    INSERT INTO calibration_step_outputs (
                      ocr_run_id, step_key, step_order, status, metrics_json, artifact_json
                    ) VALUES (?, ?, ?, 'pending', ?, ?)
                """, [ocr_run_id, step_key, int(step_order), json.dumps({'title': title}), json.dumps({})])

    def _update_step(self, ocr_run_id: int, step_key: str, status: str, metrics: Optional[Dict] = None, artifact: Optional[Dict] = None, warning_text: Optional[str] = None, error_text: Optional[str] = None):
        with duckdb_pool.connection(self.db_path) as conn:
            current = conn.execute("""
                SELECT metrics_json, artifact_json, started_at
                FROM calibration_step_outputs
                WHERE ocr_run_id = ? AND step_key = ?
            """, [ocr_run_id, step_key]).fetchone()
            prior_metrics = json.loads(current[0]) if current and current[0] else {}
            prior_artifact = json.loads(current[1]) if current and current[1] else {}
            started_at = current[2] if current else None
            if status == 'running' and not started_at:
                started_at = datetime.utcnow()
            finished_at = datetime.utcnow() if status in ('completed', 'warning', 'failed') else None
            merged_metrics = {**prior_metrics, **(metrics or {})}
            merged_artifact = {**prior_artifact, **(artifact or {})}
            conn.execute("""
                UPDATE calibration_step_outputs
                SET status = ?,
                    metrics_json = ?,
                    artifact_json = ?,
                    warning_text = ?,
                    error_text = ?,
                    started_at = COALESCE(started_at, ?),
                    finished_at = COALESCE(finished_at, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE ocr_run_id = ? AND step_key = ?
            """, [
                status,
                json.dumps(merged_metrics),
                json.dumps(merged_artifact),
                warning_text,
                error_text,
                started_at,
                finished_at,
                ocr_run_id,
                step_key
            ])

    def create_run(self, session_id: int, config: Dict, baseline_ocr_run_id: Optional[int], created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            ocr_run_id = self._next_id(conn, "calibration_orchestrated_runs", "ocr_run_id")
            conn.execute("""
                INSERT INTO calibration_orchestrated_runs (
                  ocr_run_id, session_id, baseline_ocr_run_id, status, config_json, created_by
                ) VALUES (?, ?, ?, 'queued', ?, ?)
            """, [int(ocr_run_id), int(session_id), int(baseline_ocr_run_id) if baseline_ocr_run_id else None, json.dumps(config or {}), created_by])
        self._init_steps(int(ocr_run_id))
        return self.get_run(int(ocr_run_id))

    def list_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT ocr_run_id, session_id, baseline_ocr_run_id, status, created_by, created_at, started_at, finished_at, final_boundary_id, approved_boundary_id, approved_at
                FROM calibration_orchestrated_runs
                WHERE session_id = ?
                ORDER BY ocr_run_id DESC
                LIMIT 200
            """, [session_id]).fetchall()
        return [{
            'ocr_run_id': int(r[0]),
            'session_id': int(r[1]),
            'baseline_ocr_run_id': int(r[2]) if r[2] is not None else None,
            'status': r[3],
            'created_by': r[4],
            'created_at': str(r[5]),
            'started_at': str(r[6]) if r[6] is not None else None,
            'finished_at': str(r[7]) if r[7] is not None else None,
            'final_boundary_id': int(r[8]) if r[8] is not None else None,
            'approved_boundary_id': int(r[9]) if r[9] is not None else None,
            'approved_at': str(r[10]) if r[10] is not None else None,
        } for r in rows]

    def get_run(self, ocr_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            r = conn.execute("""
                SELECT ocr_run_id, session_id, baseline_ocr_run_id, status, config_json, warnings_json, error_text,
                       created_by, created_at, started_at, finished_at, final_boundary_id, approved_boundary_id, approved_by, approved_at
                FROM calibration_orchestrated_runs
                WHERE ocr_run_id = ?
            """, [ocr_run_id]).fetchone()
            if not r:
                raise ValueError("Orchestrated run not found")
            steps = conn.execute("""
                SELECT step_key, step_order, status, metrics_json, artifact_json, warning_text, error_text, started_at, finished_at, updated_at
                FROM calibration_step_outputs
                WHERE ocr_run_id = ?
                ORDER BY step_order ASC
            """, [ocr_run_id]).fetchall()
            report = conn.execute("""
                SELECT report_json, generated_at
                FROM calibration_intermediate_report
                WHERE ocr_run_id = ?
                ORDER BY generated_at DESC
                LIMIT 1
            """, [ocr_run_id]).fetchone()
            boundary = conn.execute("""
                SELECT boundary_id, threshold_value, atl_count, stability_flags_json, created_at
                FROM calibration_boundary_final
                WHERE ocr_run_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, [ocr_run_id]).fetchone()

        return {
            'run': {
                'ocr_run_id': int(r[0]),
                'session_id': int(r[1]),
                'baseline_ocr_run_id': int(r[2]) if r[2] is not None else None,
                'status': r[3],
                'config': json.loads(r[4]) if r[4] else {},
                'warnings': json.loads(r[5]) if r[5] else [],
                'error': r[6],
                'created_by': r[7],
                'created_at': str(r[8]),
                'started_at': str(r[9]) if r[9] is not None else None,
                'finished_at': str(r[10]) if r[10] is not None else None,
                'final_boundary_id': int(r[11]) if r[11] is not None else None,
                'approved_boundary_id': int(r[12]) if r[12] is not None else None,
                'approved_by': r[13],
                'approved_at': str(r[14]) if r[14] is not None else None
            },
            'steps': [{
                'step_key': s[0],
                'step_order': int(s[1]),
                'status': s[2],
                'metrics': json.loads(s[3]) if s[3] else {},
                'artifact': json.loads(s[4]) if s[4] else {},
                'warning_text': s[5],
                'error_text': s[6],
                'started_at': str(s[7]) if s[7] is not None else None,
                'finished_at': str(s[8]) if s[8] is not None else None,
                'updated_at': str(s[9]) if s[9] is not None else None
            } for s in steps],
            'final_boundary': None if not boundary else {
                'boundary_id': int(boundary[0]),
                'threshold_value': float(boundary[1]) if boundary[1] is not None else None,
                'atl_count': int(boundary[2]) if boundary[2] is not None else None,
                'stability_flags': json.loads(boundary[3]) if boundary[3] else {},
                'created_at': str(boundary[4])
            },
            'report': None if not report else {
                'report': json.loads(report[0]) if report[0] else {},
                'generated_at': str(report[1])
            }
        }

    def get_approved_boundary(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT ocr_run_id, approved_boundary_id, approved_by, approved_at
                FROM calibration_orchestrated_runs
                WHERE session_id = ? AND approved_boundary_id IS NOT NULL
                ORDER BY approved_at DESC NULLS LAST, ocr_run_id DESC
                LIMIT 1
            """, [session_id]).fetchone()
        if not row:
            return {'approved': False}
        return {
            'approved': True,
            'ocr_run_id': int(row[0]),
            'boundary_id': int(row[1]),
            'approved_by': row[2],
            'approved_at': str(row[3]) if row[3] is not None else None
        }

    def approve_boundary(self, session_id: int, ocr_run_id: int, approved_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            r = conn.execute("""
                SELECT session_id, final_boundary_id
                FROM calibration_orchestrated_runs
                WHERE ocr_run_id = ?
            """, [ocr_run_id]).fetchone()
            if not r or int(r[0]) != int(session_id):
                raise ValueError("Orchestrated run not found for session")
            final_boundary_id = int(r[1]) if r[1] is not None else None
            if not final_boundary_id:
                raise ValueError("No final boundary available to approve")
            conn.execute("""
                UPDATE calibration_orchestrated_runs
                SET approved_boundary_id = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP
                WHERE ocr_run_id = ?
            """, [int(final_boundary_id), approved_by, int(ocr_run_id)])
        return self.get_approved_boundary(session_id)

    def approve_and_freeze_boundary(self, behavior_db_path: Path, session_id: int, ocr_run_id: int, approved_by: Optional[str]) -> Dict:
        approved = self.approve_boundary(session_id, ocr_run_id, approved_by)
        boundary_id = int(approved['boundary_id'])
        self.freeze_step3_risk_output(behavior_db_path, session_id, ocr_run_id, boundary_id, approved_by)
        return approved

    def _get_session_meta(self, conn, session_id: int) -> Dict:
        s = conn.execute("""
            SELECT behavior_run_id, metric_name, window_spec, entity_level
            FROM calibration_sessions
            WHERE session_id = ?
        """, [session_id]).fetchone()
        if not s:
            raise ValueError("Session not found")
        agg = conn.execute("""
            SELECT entity_collapse, time_lens, sustained_days
            FROM aggregation_configs
            WHERE session_id = ?
        """, [session_id]).fetchone()
        return {
            'behavior_run_id': int(s[0]),
            'signal_name': s[1],
            'window': s[2],
            'entity_level': s[3],
            'entity_collapse': (agg[0] if agg else 'max'),
            'time_lens': (agg[1] if agg else 'full'),
            'sustained_days': int(agg[2]) if agg and agg[2] is not None else 3
        }

    def _get_boundary_thresholds(self, conn, session_id: int, boundary_id: int) -> Dict:
        b = conn.execute("""
            SELECT strategy_id, buffer_type, buffer_params_json
            FROM risk_boundary_definitions
            WHERE session_id = ? AND boundary_id = ?
        """, [session_id, boundary_id]).fetchone()
        if not b:
            raise ValueError("Boundary not found")
        s = conn.execute("""
            SELECT threshold_value
            FROM threshold_strategies
            WHERE session_id = ? AND strategy_id = ?
        """, [session_id, int(b[0])]).fetchone()
        if not s:
            raise ValueError("Boundary strategy not found")
        threshold_value = float(s[0] or 0.0)
        bt = (b[1] or 'hard').lower()
        params = json.loads(b[2]) if b[2] else {}
        if bt == 'hard':
            return {'threshold_value': threshold_value, 'lower': threshold_value, 'upper': threshold_value}
        band_pct = float((params or {}).get('band_pct', 2.0))
        band_pct = max(0.0, min(50.0, band_pct))
        lower = threshold_value * (1.0 - band_pct / 100.0)
        upper = threshold_value * (1.0 + band_pct / 100.0)
        return {'threshold_value': threshold_value, 'lower': float(lower), 'upper': float(upper)}

    def _agg_query(self, meta: Dict) -> str:
        behavior_run_id = int(meta['behavior_run_id'])
        signal_name = meta.get('signal_name') or ''
        entity_collapse = (meta.get('entity_collapse') or 'max').lower()
        time_lens = (meta.get('time_lens') or 'full').lower()
        sustained_days = int(meta.get('sustained_days') or 3)

        metric_filter = f"behavior_run_id = {behavior_run_id}"
        if signal_name:
            metric_filter += " AND metric_name = '" + signal_name.replace("'", "''") + "'"

        if time_lens == 'full':
            base = f"""
                SELECT entity_id, as_of_date, metric_value
                FROM behavior.behavior_table
                WHERE {metric_filter}
            """
        else:
            base = f"""
                SELECT entity_id, date_trunc('day', as_of_date) AS as_of_date, MAX(metric_value) AS metric_value
                FROM behavior.behavior_table
                WHERE {metric_filter}
                GROUP BY entity_id, as_of_date
            """

        if time_lens in ('rolling_peak', 'sustained'):
            n = max(1, sustained_days)
            base = f"""
                WITH daily AS ({base}),
                w AS (
                  SELECT
                    entity_id,
                    as_of_date,
                    metric_value,
                    SUM(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_sum,
                    AVG(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_avg,
                    MIN(CASE WHEN metric_value != 0 THEN 1 ELSE 0 END) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS all_non_zero
                  FROM daily
                )
                SELECT
                  entity_id,
                  as_of_date,
                  CASE
                    WHEN '{time_lens}' = 'rolling_peak' THEN roll_sum
                    WHEN '{time_lens}' = 'sustained' THEN CASE WHEN all_non_zero = 1 THEN roll_avg ELSE NULL END
                    ELSE metric_value
                  END AS metric_value
                FROM w
            """

        if entity_collapse == 'max':
            return f"SELECT entity_id, MAX(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'avg':
            return f"SELECT entity_id, AVG(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'p95':
            return f"SELECT entity_id, quantile(metric_value, 0.95) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'last':
            return f"SELECT entity_id, max_by(metric_value, as_of_date) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        raise ValueError("Unsupported entity collapse method")

    def freeze_step3_risk_output(self, behavior_db_path: Path, session_id: int, ocr_run_id: int, boundary_id: int, frozen_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            meta = self._get_session_meta(conn, session_id)
            th = self._get_boundary_thresholds(conn, session_id, boundary_id)
            upper = float(th['upper'])
            conn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
            q = self._agg_query(meta)
            rows = conn.execute(f"""
                WITH agg AS ({q})
                SELECT entity_id, aggregated_value
                FROM agg
                WHERE aggregated_value >= {upper}
            """).fetchall()
            conn.execute("DELETE FROM calibration_frozen_risk_entities WHERE session_id = ? AND boundary_id = ?", [session_id, boundary_id])
            if rows:
                out = [(int(session_id), int(ocr_run_id), int(boundary_id), r[0], float(r[1] or 0.0), True, frozen_by) for r in rows]
                conn.executemany("""
                    INSERT INTO calibration_frozen_risk_entities (
                      session_id, ocr_run_id, boundary_id, entity_id, aggregated_value, atl_flag, frozen_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, out)

    def start_async(self, ocr_run_id: int, behavior_db_path: Path):
        t = threading.Thread(target=self._execute_run, args=(ocr_run_id, behavior_db_path), daemon=True)
        t.start()

    def _set_run_status(self, ocr_run_id: int, status: str, warnings: Optional[List[Dict]] = None, error_text: Optional[str] = None, final_boundary_id: Optional[int] = None):
        with duckdb_pool.connection(self.db_path) as conn:
            fields = []
            params: List[Any] = []
            fields.append("status = ?"); params.append(status)
            if warnings is not None:
                fields.append("warnings_json = ?"); params.append(json.dumps(warnings))
            if error_text is not None:
                fields.append("error_text = ?"); params.append(error_text)
            if status == 'running':
                fields.append("started_at = COALESCE(started_at, CURRENT_TIMESTAMP)")
            if status in ('completed', 'failed'):
                fields.append("finished_at = CURRENT_TIMESTAMP")
            if final_boundary_id is not None:
                fields.append("final_boundary_id = ?"); params.append(int(final_boundary_id))
            params.append(int(ocr_run_id))
            conn.execute(f"UPDATE calibration_orchestrated_runs SET {', '.join(fields)} WHERE ocr_run_id = ?", params)

    def reconcile_stalled_run(self, ocr_run_id: int, stall_after_seconds: int = 180):
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT status, started_at
                FROM calibration_orchestrated_runs
                WHERE ocr_run_id = ?
            """, [int(ocr_run_id)]).fetchone()
            if not row:
                return
            status = (row[0] or '').lower()
            started_at = row[1]
            if status != 'running' or started_at is None:
                return
            last_step_update = conn.execute("""
                SELECT MAX(updated_at)
                FROM calibration_step_outputs
                WHERE ocr_run_id = ?
            """, [int(ocr_run_id)]).fetchone()[0]

            age = conn.execute("SELECT datediff('second', ?, CURRENT_TIMESTAMP)", [started_at]).fetchone()[0]
            age = int(age or 0)
            if age < int(stall_after_seconds):
                return
            if last_step_update is not None and last_step_update > started_at:
                return

            conn.execute("""
                UPDATE calibration_orchestrated_runs
                SET status = 'failed',
                    error_text = COALESCE(error_text, 'Orchestrated run stalled (no step progress).'),
                    finished_at = CURRENT_TIMESTAMP
                WHERE ocr_run_id = ? AND status = 'running'
            """, [int(ocr_run_id)])
            conn.execute("""
                UPDATE calibration_step_outputs
                SET status = 'failed',
                    error_text = COALESCE(error_text, 'Run stalled before starting steps.'),
                    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                WHERE ocr_run_id = ? AND status = 'pending'
            """, [int(ocr_run_id)])

    def _baseline_metrics(self, baseline_ocr_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            steps = conn.execute("""
                SELECT step_key, metrics_json
                FROM calibration_step_outputs
                WHERE ocr_run_id = ?
            """, [baseline_ocr_run_id]).fetchall()
        out = {}
        for k, mj in steps:
            out[k] = json.loads(mj) if mj else {}
        return out

    def _execute_run(self, ocr_run_id: int, behavior_db_path: Path):
        warnings: List[Dict] = []
        try:
            run = self.get_run(ocr_run_id)
            session_id = int(run['run']['session_id'])
            cfg = run['run']['config'] or {}
            baseline = run['run']['baseline_ocr_run_id']
            baseline_metrics = self._baseline_metrics(int(baseline)) if baseline else {}

            self._set_run_status(ocr_run_id, 'running')

            workbench = CalibrationWorkbenchService(self.db_path)
            threshold = ThresholdSimulationService(self.db_path)
            risk = RiskPopulationService(self.db_path)
            ks = KSValidationService(self.db_path)
            jsvc = JStatisticService(self.db_path)
            session_blob = workbench.get_session(session_id)
            session_meta = session_blob.get('session') or {}
            aggregation = session_blob.get('aggregation') or {}

            self._update_step(ocr_run_id, 'step_3_1_population', 'running')
            agg_view = workbench.get_aggregate_view(behavior_db_path, session_id, limit_entities=200)
            n = int(agg_view.get('summary', {}).get('n') or 0)
            if n < 100:
                warnings.append({'step': '3.1', 'type': 'low_population', 'message': f'Low entity population (n={n}).'})
                self._update_step(ocr_run_id, 'step_3_1_population', 'warning', metrics={'n_entities': n}, warning_text='Low population size.')
            else:
                self._update_step(ocr_run_id, 'step_3_1_population', 'completed', metrics={'n_entities': n})

            self._update_step(ocr_run_id, 'step_3_2_aggregation', 'running')
            self._update_step(
                ocr_run_id,
                'step_3_2_aggregation',
                'completed',
                metrics={
                    'entity_collapse': aggregation.get('entity_collapse'),
                    'time_lens': aggregation.get('time_lens'),
                    'sustained_days': aggregation.get('sustained_days'),
                }
            )

            pct = float(cfg.get('percentile') or 99.0)
            pct = max(50.0, min(99.9, pct))
            buffer_type = cfg.get('buffer_type') or 'hard'
            buffer_params = cfg.get('buffer_params') or {}
            if buffer_type != 'hard':
                band_pct = float(buffer_params.get('band_pct', 2.0))
                buffer_params['band_pct'] = max(0.0, min(50.0, band_pct))

            self._update_step(ocr_run_id, 'step_3_3_boundary', 'running')
            strategy = threshold.create_strategy(behavior_db_path, session_id, f"OCR Percentile {pct}", 'percentile', {'percentile': pct}, cfg.get('created_by'))
            strategy_id = int(strategy['strategy_id'])
            boundary_created = risk.create_boundary(behavior_db_path, session_id, strategy_id, buffer_type, buffer_params, cfg.get('created_by'))
            boundary_id = int(boundary_created['boundary_id'])
            boundary_detail = risk.compute_boundary_stats(behavior_db_path, session_id, boundary_id, cfg.get('created_by'))
            atl_count = int(boundary_detail.get('atl', {}).get('entity_count') or 0)
            threshold_value = float(boundary_detail.get('threshold', {}).get('threshold_value') or boundary_detail.get('threshold', {}).get('upper') or 0.0)
            self._update_step(
                ocr_run_id,
                'step_3_3_boundary',
                'completed',
                metrics={'strategy_id': strategy_id, 'boundary_id': boundary_id, 'threshold_value': threshold_value, 'atl_count': atl_count},
                artifact={'boundary': boundary_detail}
            )

            self._update_step(ocr_run_id, 'step_3_4_ks', 'running')
            ks_run = ks.create_run(behavior_db_path, session_id, boundary_id, cfg.get('created_by'))
            full = next((r for r in (ks_run.get('results') or []) if r.get('variant_type') == 'full'), None)
            ks_stat = float(full.get('ks_stat')) if full and full.get('ks_stat') is not None else None
            self._update_step(ocr_run_id, 'step_3_4_ks', 'completed', metrics={'ks_run_id': int(ks_run['ks_run_id']), 'ks_stat_full': ks_stat}, artifact={'ks': ks_run})

            if baseline_metrics.get('step_3_4_ks', {}).get('ks_stat_full') is not None and ks_stat is not None:
                prev = float(baseline_metrics['step_3_4_ks']['ks_stat_full'])
                if ks_stat < prev:
                    warnings.append({'step': '3.4', 'type': 'ks_regression', 'message': f'KS lower than baseline ({ks_stat:.4f} < {prev:.4f}).'})
                    self._update_step(ocr_run_id, 'step_3_4_ks', 'warning', metrics={'ks_run_id': int(ks_run['ks_run_id']), 'ks_stat_full': ks_stat}, warning_text='KS lower than baseline.')

            self._update_step(ocr_run_id, 'step_3_5_stress', 'running')
            stress = risk.stress_boundary(behavior_db_path, session_id, boundary_id, cfg.get('stress_deltas_pct') or [-5, -2, -1, 1, 2, 5], cfg.get('created_by'))
            max_churn = max([float(r.get('entity_churn_pct') or 0.0) for r in stress]) if stress else 0.0
            if max_churn > 25.0:
                warnings.append({'step': '3.5', 'type': 'stress_fragile', 'message': f'High churn under stress (max {max_churn:.1f}%).'})
                self._update_step(ocr_run_id, 'step_3_5_stress', 'warning', metrics={'max_entity_churn_pct': max_churn}, artifact={'stress': stress}, warning_text='Boundary fragile under stress.')
            else:
                self._update_step(ocr_run_id, 'step_3_5_stress', 'completed', metrics={'max_entity_churn_pct': max_churn}, artifact={'stress': stress})

            self._update_step(ocr_run_id, 'step_3_6_j', 'running')
            step36 = jsvc.compute_step36(behavior_db_path, session_id, boundary_id, cfg.get('created_by'))
            stability = jsvc.compute_stability(behavior_db_path, session_id, int(step36['step36_id']), int(cfg.get('stability_n_samples') or 20), float(cfg.get('stability_sample_frac') or 0.75), cfg.get('created_by'))
            max_j = float(step36['result']['max_j']) if step36 and step36.get('result') else None
            stability_label = stability.get('stability_label')
            if stability_label in ('sensitive', 'fragile'):
                warnings.append({'step': '3.6', 'type': 'j_unstable', 'message': f'J stability is {stability_label}.'})
                self._update_step(
                    ocr_run_id,
                    'step_3_6_j',
                    'warning',
                    metrics={'step36_id': int(step36['step36_id']), 'max_j': max_j, 'stability_label': stability_label},
                    artifact={'step36': step36, 'stability': stability},
                    warning_text='J stability indicates sensitivity.'
                )
            else:
                self._update_step(
                    ocr_run_id,
                    'step_3_6_j',
                    'completed',
                    metrics={'step36_id': int(step36['step36_id']), 'max_j': max_j, 'stability_label': stability_label},
                    artifact={'step36': step36, 'stability': stability}
                )

            if baseline_metrics.get('step_3_6_j', {}).get('max_j') is not None and max_j is not None:
                prev_j = float(baseline_metrics['step_3_6_j']['max_j'])
                if max_j < prev_j:
                    warnings.append({'step': '3.6', 'type': 'j_regression', 'message': f'Max J lower than baseline ({max_j:.4f} < {prev_j:.4f}).'})

            report = {
                'title': 'Intermediate Calibration Summary',
                'generated_at': datetime.utcnow().isoformat(),
                'data_used': {
                    'session_id': session_id,
                    'behavior_run_id': session_meta.get('behavior_run_id'),
                    'metric_name': session_meta.get('metric_name'),
                    'entity_level': session_meta.get('entity_level'),
                    'window': session_meta.get('window')
                },
                'steps_executed': [
                    '3.1 Population checks',
                    '3.2 Behaviour aggregation',
                    '3.3 Boundary construction',
                    '3.4 KS validation',
                    '3.5 Stress testing',
                    '3.6 J-Statistic separation'
                ],
                'results': {
                    'boundary_id': boundary_id,
                    'threshold_value': threshold_value,
                    'atl_count': atl_count,
                    'ks_stat_full': ks_stat,
                    'max_j': max_j,
                    'j_stability_label': stability_label
                },
                'warnings': warnings,
                'reproducibility': {
                    'manual_mode_note': 'An analyst can manually reproduce any step using Manual Mode in the Scenario Workbench.'
                },
                'disclaimer': 'Orchestrated runs execute predefined methodology. Analysts remain responsible for interpretation and approval.'
            }

            self._update_step(ocr_run_id, 'final_report', 'running')
            with duckdb_pool.connection(self.db_path) as conn:
                conn.execute("DELETE FROM calibration_intermediate_report WHERE ocr_run_id = ?", [ocr_run_id])
                conn.execute("INSERT INTO calibration_intermediate_report (ocr_run_id, report_json) VALUES (?, ?)", [ocr_run_id, json.dumps(report)])
            self._update_step(ocr_run_id, 'final_report', 'completed', metrics={'warnings_count': len(warnings)})

            self._update_step(ocr_run_id, 'final_boundary', 'running')
            flags = {
                'ks_regression': any(w.get('type') == 'ks_regression' for w in warnings),
                'stress_fragile': any(w.get('type') == 'stress_fragile' for w in warnings),
                'j_unstable': any(w.get('type') == 'j_unstable' for w in warnings)
            }
            with duckdb_pool.connection(self.db_path) as conn:
                conn.execute("DELETE FROM calibration_boundary_final WHERE ocr_run_id = ?", [ocr_run_id])
                conn.execute("""
                    INSERT INTO calibration_boundary_final (ocr_run_id, boundary_id, threshold_value, atl_count, stability_flags_json)
                    VALUES (?, ?, ?, ?, ?)
                """, [ocr_run_id, boundary_id, threshold_value, atl_count, json.dumps(flags)])
            self._update_step(ocr_run_id, 'final_boundary', 'completed', metrics={'boundary_id': boundary_id})

            self._set_run_status(ocr_run_id, 'completed', warnings=warnings, final_boundary_id=boundary_id)
        except Exception as e:
            err = str(e)
            tb = traceback.format_exc()
            try:
                self._set_run_status(ocr_run_id, 'failed', warnings=warnings, error_text=err)
                self._update_step(ocr_run_id, 'final_boundary', 'failed', error_text=err)
            except Exception:
                pass
            _ = tb
