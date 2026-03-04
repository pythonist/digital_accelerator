from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
import threading
import traceback
from typing import Dict, Optional

import duckdb
import subprocess
import sys
import os

from api.tools.btsy.autorun.autorun_models import FrozenConfig, RunContext
from api.tools.btsy.autorun.autorun_registry import AutoRunRegistry
from api.tools.btsy.calibration_workbench.calibration_workbench_service import CalibrationWorkbenchService
from api.tools.btsy.calibration_workbench.orchestrated_calibration_service import OrchestratedCalibrationService
from api.tools.btsy.alerting.eligibility_alert_service import EligibilityAlertService
from api.tools.btsy.validation.str_alignment_service import STRAlignmentService
from api.tools.btsy.operations_intelligence.operations_intelligence_service import OperationsIntelligenceService, WorkloadConfig
from api.tools.btsy.transaction_universe.transaction_universe_service import TransactionUniverseService
from api.tools.btsy.behavior.behavior_service import BehaviorService
from api.tools.btsy.duckdb_pool import duckdb_pool
from api.tools.btsy.evidence.evidence_store import CalibrationEvidenceStore
from api.tools.btsy.evidence.inference_service import ControlledInferenceService
from api.tools.btsy.reporting.advanced_report.generator import BTSYAdvancedReportGenerator
from api.tools.btsy.snapshot_manager import SnapshotManager

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


class AutoRunExecutor:
    def __init__(self, registry: AutoRunRegistry, max_workers: int = 2, mode: str = 'subprocess', python_executable: Optional[str] = None):
        self.registry = registry
        self.mode = mode
        self.python_executable = python_executable
        self._pool = ThreadPoolExecutor(max_workers=max(1, int(max_workers)))
        self._inflight = set()
        self._lock = threading.Lock()

    def enqueue(self, ctx: RunContext, frozen: FrozenConfig):
        with self._lock:
            self._inflight.add(int(ctx.run_id))
        self.registry.update_status(ctx.run_id, 'QUEUED', progress_pct=0.0, current_step='QUEUED')
        self.registry.add_event(ctx.run_id, 'QUEUED', {'ctx': ctx.as_dict()})
        if (self.mode or '').lower() == 'subprocess':
            pid = self._spawn_worker_process(ctx)
            self.registry.add_event(ctx.run_id, 'WORKER_STARTED', {'pid': pid})
            return
        self._pool.submit(self._execute_run, ctx, frozen)

    def run_once(self, ctx: RunContext, frozen: FrozenConfig):
        self._execute_run(ctx, frozen)

    def _spawn_worker_process(self, ctx: RunContext) -> int:
        backend_root = Path(__file__).resolve().parents[4]
        venv_py = backend_root / '.venv' / 'Scripts' / 'python.exe'
        py = self.python_executable or (str(venv_py) if venv_py.exists() else sys.executable)
        env = os.environ.copy()
        env['PYTHONPATH'] = str(backend_root)
        cmd = [
            py,
            "-m",
            "api.tools.btsy.autorun.worker_entry",
            "--tenant-id",
            ctx.tenant_id,
            "--env-id",
            ctx.env_id,
            "--run-id",
            str(int(ctx.run_id)),
        ]
        ctx.logs_path.mkdir(parents=True, exist_ok=True)
        out_path = ctx.logs_path / 'worker.out.log'
        err_path = ctx.logs_path / 'worker.err.log'
        out_f = open(out_path, 'ab', buffering=0)
        err_f = open(err_path, 'ab', buffering=0)
        p = subprocess.Popen(
            cmd,
            cwd=str(backend_root),
            env=env,
            stdout=out_f,
            stderr=err_f,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        try:
            out_f.close()
        except Exception:
            pass
        try:
            err_f.close()
        except Exception:
            pass
        return int(p.pid)

    def _log(self, ctx: RunContext, msg: str):
        ctx.logs_path.mkdir(parents=True, exist_ok=True)
        p = ctx.logs_path / 'run.log'
        ts = datetime.utcnow().isoformat()
        with open(p, 'a', encoding='utf-8') as f:
            f.write(f"{ts} {msg}\n")

    def _update(self, ctx: RunContext, step: str, pct: float):
        self.registry.update_status(ctx.run_id, 'RUNNING', progress_pct=float(pct), current_step=step, started=True)
        self.registry.add_event(ctx.run_id, 'PROGRESS', {'step': step, 'progress_pct': float(pct)})
        self._log(ctx, f"[{pct:.0f}%] {step}")

    def _ensure_run_db_schema(self, ctx: RunContext, frozen: FrozenConfig):
        with duckdb_pool.connection(ctx.run_db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS run_metadata (
                  run_id INTEGER,
                  env_id TEXT,
                  snapshot_id TEXT,
                  session_id INTEGER,
                  mode TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS run_frozen_config (
                  run_id INTEGER,
                  config_id TEXT,
                  config_version TEXT,
                  config_json TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS run_step_outputs (
                  run_id INTEGER,
                  step_id TEXT,
                  step_order INTEGER,
                  status TEXT,
                  output_type TEXT,
                  storage_ref TEXT,
                  record_count INTEGER,
                  summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("DELETE FROM run_metadata WHERE run_id = ?", [int(ctx.run_id)])
            conn.execute("DELETE FROM run_frozen_config WHERE run_id = ?", [int(ctx.run_id)])
            conn.execute("""
                INSERT INTO run_metadata (run_id, env_id, snapshot_id, session_id, mode, created_by)
                VALUES (?, ?, ?, ?, ?, ?)
            """, [int(ctx.run_id), ctx.env_id, ctx.snapshot_id, int(ctx.session_id), ctx.mode, ctx.created_by])
            conn.execute("""
                INSERT INTO run_frozen_config (run_id, config_id, config_version, config_json)
                VALUES (?, ?, ?, ?)
            """, [int(ctx.run_id), frozen.config_id, frozen.config_version, json.dumps(frozen.as_dict())])
        ev = CalibrationEvidenceStore(ctx.run_db_path)
        ev.ensure_schema()
        ev.upsert_run(
            run_id=int(ctx.run_id),
            scenario_id=frozen.config_id,
            mode=ctx.mode,
            snapshot_id=ctx.snapshot_id,
            config_obj=frozen.as_dict(),
            status="CREATED",
            triggered_by=ctx.created_by,
        )

    def _step_data_foundation(self, ctx: RunContext, frozen: FrozenConfig, env_folders: Dict) -> Dict:
        mgr = SnapshotManager(env_folders['duckdb'] / 'snapshots.duckdb')
        snap = mgr.get_snapshot(str(ctx.snapshot_id))
        tx_path = None
        if snap:
            for d in (snap.get('domains') or []):
                if d.get('domain') == 'transactions' and d.get('normalized_file_path'):
                    tx_path = Path(d['normalized_file_path'])
                    break
        if tx_path is None:
            tx_path = env_folders['normalized'] / str(ctx.snapshot_id) / 'transactions.parquet'
        if not tx_path.exists():
            raise ValueError("Normalized transactions parquet missing")

        tx = str(tx_path).replace("'", "''")
        conn = duckdb.connect()
        try:
            conn.execute(f"CREATE OR REPLACE VIEW tx AS SELECT * FROM read_parquet('{tx}')")
            cols = conn.execute("PRAGMA table_info('tx')").fetchall()
            col_names = [c[1] for c in (cols or [])]
            col_set = {str(x) for x in col_names}
            total = int(conn.execute("SELECT COUNT(1) FROM tx").fetchone()[0] or 0)
            missing = []
            if "account_id" not in col_set:
                missing.append("account_id")
            if "customer_id" not in col_set:
                missing.append("customer_id")
            if "transaction_datetime" not in col_set:
                missing.append("transaction_datetime")

            unique_accounts_sql = "COUNT(DISTINCT CAST(account_id AS VARCHAR))" if "account_id" in col_set else "0"
            unique_customers_sql = "COUNT(DISTINCT CAST(customer_id AS VARCHAR))" if "customer_id" in col_set else "0"
            date_start_sql = "MIN(TRY_CAST(transaction_datetime AS TIMESTAMP))" if "transaction_datetime" in col_set else "NULL"
            date_end_sql = "MAX(TRY_CAST(transaction_datetime AS TIMESTAMP))" if "transaction_datetime" in col_set else "NULL"

            metrics = conn.execute(f"""
                SELECT
                  COUNT(1) AS transaction_count,
                  {unique_accounts_sql} AS unique_accounts,
                  {unique_customers_sql} AS unique_customers,
                  {date_start_sql} AS date_range_start,
                  {date_end_sql} AS date_range_end
                FROM tx
            """).fetchone()
            overall = {
                'transaction_count': int(metrics[0] or 0) if metrics else 0,
                'unique_accounts': int(metrics[1] or 0) if metrics else 0,
                'unique_customers': int(metrics[2] or 0) if metrics else 0,
                'date_range_start': str(metrics[3]) if metrics and metrics[3] is not None else None,
                'date_range_end': str(metrics[4]) if metrics and metrics[4] is not None else None,
                'column_count': int(len(cols or [])),
                'missing_required_columns': missing,
            }

            col_rows = []
            if cols:
                null_exprs = []
                idx_to_col = {}
                for i, c in enumerate(cols):
                    col_name = c[1]
                    safe_col = str(col_name).replace('"', '""')
                    alias = f"n_{i}"
                    idx_to_col[i] = col_name
                    null_exprs.append(f'SUM(CASE WHEN "{safe_col}" IS NULL THEN 1 ELSE 0 END) AS {alias}')
                null_row = conn.execute(f"SELECT {', '.join(null_exprs)} FROM tx").fetchone()
                for i, c in enumerate(cols):
                    col_name = c[1]
                    col_type = c[2]
                    nc = int(null_row[i] or 0) if null_row else 0
                    npct = (float(nc) / float(total)) if total > 0 else 0.0
                    col_rows.append((int(ctx.run_id), col_name, col_type, int(nc), float(npct)))
        finally:
            conn.close()

        with duckdb_pool.connection(ctx.run_db_path) as out:
            out.execute("""
                CREATE TABLE IF NOT EXISTS evidence_step0_overall (
                  run_id INTEGER,
                  transaction_count BIGINT,
                  unique_accounts BIGINT,
                  unique_customers BIGINT,
                  date_range_start TIMESTAMP,
                  date_range_end TIMESTAMP,
                  column_count INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            out.execute("DELETE FROM evidence_step0_overall WHERE run_id = ?", [int(ctx.run_id)])
            out.execute("""
                INSERT INTO evidence_step0_overall (
                  run_id, transaction_count, unique_accounts, unique_customers, date_range_start, date_range_end, column_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                int(ctx.run_id),
                int(overall['transaction_count']),
                int(overall['unique_accounts']),
                int(overall['unique_customers']),
                overall['date_range_start'],
                overall['date_range_end'],
                int(overall['column_count']),
            ])
            out.execute("""
                CREATE TABLE IF NOT EXISTS evidence_step0_column_profile (
                  run_id INTEGER,
                  column_name TEXT,
                  data_type TEXT,
                  null_count BIGINT,
                  null_pct DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            out.execute("DELETE FROM evidence_step0_column_profile WHERE run_id = ?", [int(ctx.run_id)])
            if col_rows:
                out.executemany(
                    "INSERT INTO evidence_step0_column_profile (run_id, column_name, data_type, null_count, null_pct) VALUES (?, ?, ?, ?, ?)",
                    col_rows,
                )

        ev = CalibrationEvidenceStore(ctx.run_db_path)
        ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_0", metrics=overall)
        ev.register_artifact(
            run_id=int(ctx.run_id),
            step_id="STEP_0",
            artifact_type="table",
            artifact_key="data_foundation_overall",
            table_name="evidence_step0_overall",
            metadata={'source_parquet': str(tx_path)},
        )
        ev.register_artifact(
            run_id=int(ctx.run_id),
            step_id="STEP_0",
            artifact_type="table",
            artifact_key="data_foundation_column_profile",
            table_name="evidence_step0_column_profile",
            metadata={'source_parquet': str(tx_path)},
        )
        return overall

    def _register_output(self, ctx: RunContext, step_id: str, step_order: int, status: str, output_type: str, storage_ref: str, record_count: int, summary: Dict):
        with duckdb_pool.connection(ctx.run_db_path) as conn:
            conn.execute("""
                INSERT INTO run_step_outputs (
                  run_id, step_id, step_order, status, output_type, storage_ref, record_count, summary_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                int(ctx.run_id),
                step_id,
                int(step_order),
                status,
                output_type,
                storage_ref,
                int(record_count or 0),
                json.dumps(summary or {})
            ])

    def _export_parquet(self, sql: str, out_path: Path, conn: duckdb.DuckDBPyConnection) -> int:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out = str(out_path).replace("'", "''")
        cnt = conn.execute(f"SELECT COUNT(1) FROM ({sql}) t").fetchone()
        n = int(cnt[0] or 0) if cnt else 0
        conn.execute(f"COPY ({sql}) TO '{out}' (FORMAT PARQUET)")
        return n

    def _step_universe(self, ctx: RunContext, frozen: FrozenConfig, env_folders: Dict) -> int:
        mgr = SnapshotManager(env_folders['duckdb'] / 'snapshots.duckdb')
        snap = mgr.get_snapshot(str(ctx.snapshot_id))
        tx_path = None
        if snap:
            for d in (snap.get('domains') or []):
                if d.get('domain') == 'transactions' and d.get('normalized_file_path'):
                    tx_path = Path(d['normalized_file_path'])
                    break
        if tx_path is None:
            tx_path = env_folders['normalized'] / str(ctx.snapshot_id) / 'transactions.parquet'
        if not tx_path.exists():
            raise ValueError("Normalized transactions parquet missing")

        fs = frozen.universe_filter_spec or {}
        where = ["1=1"]
        if fs.get('types'):
            types = [str(x).replace("'", "''") for x in fs.get('types') or []]
            if types:
                where.append("transaction_type IN (" + ",".join([f"'{t}'" for t in types]) + ")")
        if fs.get('categories'):
            cats = [str(x).replace("'", "''") for x in fs.get('categories') or []]
            if cats:
                where.append("transaction_category IN (" + ",".join([f"'{c}'" for c in cats]) + ")")
        if fs.get('amount_min') is not None:
            where.append(f"TRY_CAST(transaction_amount AS DOUBLE) >= {float(fs.get('amount_min'))}")
        if fs.get('amount_max') is not None:
            where.append(f"TRY_CAST(transaction_amount AS DOUBLE) <= {float(fs.get('amount_max'))}")
        if fs.get('date_start'):
            ds = str(fs.get('date_start')).replace("'", "''")
            where.append(f"TRY_CAST(transaction_datetime AS TIMESTAMP) >= TRY_CAST('{ds}' AS TIMESTAMP)")
        if fs.get('date_end'):
            de = str(fs.get('date_end')).replace("'", "''")
            where.append(f"TRY_CAST(transaction_datetime AS TIMESTAMP) <= TRY_CAST('{de}' AS TIMESTAMP)")

        tx = str(tx_path).replace("'", "''")
        sql = f"SELECT * FROM read_parquet('{tx}') WHERE {' AND '.join(where)}"

        conn = duckdb.connect()
        try:
            out_path = ctx.outputs_path / 'universe.parquet'
            n = self._export_parquet(sql, out_path, conn)
            if n == 0:
                raise ValueError("Universe filter produced zero rows")
            metrics = conn.execute(f"""
                SELECT
                  COUNT(1) AS transaction_count,
                  COUNT(DISTINCT CAST(account_id AS VARCHAR)) AS unique_accounts,
                  COUNT(DISTINCT CAST(customer_id AS VARCHAR)) AS unique_customers,
                  MIN(TRY_CAST(transaction_datetime AS TIMESTAMP)) AS date_range_start,
                  MAX(TRY_CAST(transaction_datetime AS TIMESTAMP)) AS date_range_end,
                  SUM(TRY_CAST(transaction_amount AS DOUBLE)) AS total_amount
                FROM ({sql}) t
            """).fetchone()
            summary = {
                'transaction_count': int(metrics[0] or 0),
                'unique_accounts': int(metrics[1] or 0),
                'unique_customers': int(metrics[2] or 0),
                'date_range_start': str(metrics[3]) if metrics and metrics[3] is not None else None,
                'date_range_end': str(metrics[4]) if metrics and metrics[4] is not None else None,
                'total_amount': float(metrics[5] or 0.0) if metrics else 0.0,
            }
        finally:
            conn.close()

        TransactionUniverseService(ctx.universe_db_path, env_folders['snapshots'])
        uconn = duckdb.connect(str(ctx.universe_db_path))
        try:
            uconn.execute("INSERT INTO transaction_universe_runs (calibration_run_id, snapshot_id, universe_name, filter_spec, spec_hash, transaction_count, unique_accounts, unique_customers, date_range_start, date_range_end, category_breakdown, total_amount, avg_amount, min_amount, max_amount, status, created_by, parquet_path, parquet_hash, parquet_size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'frozen', ?, ?, ?, ?)", [
                int(ctx.run_id),
                ctx.snapshot_id,
                f"AutoRun Universe {ctx.run_id}",
                json.dumps(fs),
                'autorun',
                int(summary['transaction_count']),
                int(summary['unique_accounts']),
                int(summary['unique_customers']),
                summary['date_range_start'],
                summary['date_range_end'],
                json.dumps({}),
                float(summary['total_amount']),
                0.0,
                0.0,
                0.0,
                ctx.created_by,
                str(ctx.outputs_path / 'universe.parquet'),
                '',
                int((ctx.outputs_path / 'universe.parquet').stat().st_size),
            ])
            universe_id = int(uconn.execute("SELECT MAX(id) FROM transaction_universe_runs").fetchone()[0])
        finally:
            uconn.close()

        self._register_output(ctx, 'UNIVERSE', 10, 'completed', 'parquet', str(ctx.outputs_path / 'universe.parquet'), n, summary)
        return universe_id

    def _step_behavior(self, ctx: RunContext, frozen: FrozenConfig, universe_id: int) -> int:
        bsvc = BehaviorService(ctx.behavior_db_path, ctx.workspace_path)
        res = bsvc.create_behavior_run(universe_id=universe_id, config=frozen.behavior_config, created_by=ctx.created_by, universe_db_path=ctx.universe_db_path)
        behavior_run_id = int(res['behavior_run_id'])

        bconn = duckdb.connect(str(ctx.behavior_db_path))
        try:
            n = self._export_parquet(
                f"SELECT entity_id, as_of_date, metric_name, metric_value, metric_type, window_spec FROM behavior_table WHERE behavior_run_id = {behavior_run_id}",
                ctx.outputs_path / 'behavior.parquet',
                bconn
            )
        finally:
            bconn.close()

        self._register_output(ctx, 'BEHAVIOR', 20, 'completed', 'parquet', str(ctx.outputs_path / 'behavior.parquet'), n, {'behavior_run_id': behavior_run_id, **res})
        return behavior_run_id

    def _step_calibration(self, ctx: RunContext, behavior_run_id: int) -> Dict:
        workbench = CalibrationWorkbenchService(ctx.run_db_path)
        session = workbench.create_session(ctx.behavior_db_path, behavior_run_id, ctx.created_by)
        session_id = int(session['session']['session_id'])

        ocr = OrchestratedCalibrationService(ctx.run_db_path)
        ocr_run = ocr.create_run(session_id, {'created_by': ctx.created_by}, baseline_ocr_run_id=None, created_by=ctx.created_by)
        ocr_id = int(ocr_run['run']['ocr_run_id'])
        ocr._execute_run(ocr_id, ctx.behavior_db_path)
        approved = ocr.approve_and_freeze_boundary(ctx.behavior_db_path, session_id, ocr_id, ctx.created_by)

        final = ocr.get_run(ocr_id)
        self._register_output(ctx, 'CALIBRATION', 30, 'completed', 'duckdb', 'calibration_orchestrated_runs', 1, {
            'session_id': session_id,
            'ocr_run_id': ocr_id,
            'approved_boundary_id': approved.get('boundary_id'),
            'threshold_value': (final.get('final_boundary') or {}).get('threshold_value'),
        })
        return {'session_id': session_id, 'ocr_run_id': ocr_id, 'approved_boundary_id': int(approved.get('boundary_id'))}

    def _step_alert_generation(self, ctx: RunContext, env_folders: Dict) -> Dict:
        svc = EligibilityAlertService(
            ctx.run_db_path,
            env_folders['duckdb'] / 'universes.duckdb',
            env_folders['duckdb'] / 'snapshots.duckdb',
            env_folders['normalized'],
        )
        result = svc.generate(ctx.behavior_db_path, ctx.session_id, ctx.created_by)
        alert_run_id = int(result['run']['alert_run_id'])

        with duckdb_pool.connection(ctx.run_db_path) as conn:
            n = self._export_parquet(
                f"SELECT alert_id, entity_id, account_id, customer_id, alert_date, scenario_ref, threshold_value FROM alerts WHERE alert_run_id = {alert_run_id}",
                ctx.outputs_path / 'alerts.parquet',
                conn
            )
        self._register_output(ctx, 'ALERTS', 40, 'completed', 'parquet', str(ctx.outputs_path / 'alerts.parquet'), n, {'alert_run_id': alert_run_id})
        return {'alert_run_id': alert_run_id}

    def _step_str_alignment(self, ctx: RunContext, alert_run_id: int, env_folders: Dict) -> Dict:
        svc = STRAlignmentService(
            ctx.run_db_path,
            env_folders['duckdb'] / 'universes.duckdb',
            env_folders['duckdb'] / 'snapshots.duckdb',
            env_folders['normalized'],
        )
        ar = svc.create_alignment_run(ctx.behavior_db_path, ctx.session_id, alert_run_id, ctx.created_by)
        align_id = int(ar['run']['str_alignment_run_id'])
        missed = svc.classify_missed(ctx.behavior_db_path, align_id, ctx.created_by)
        missed_run_id = int(missed['run']['missed_run_id'])

        with duckdb_pool.connection(ctx.run_db_path) as conn:
            _ = self._export_parquet(
                f"SELECT root_cause_code, count, percentage FROM missed_str_metrics WHERE missed_run_id = {missed_run_id}",
                ctx.outputs_path / 'str_metrics.parquet',
                conn
            )
        self._register_output(ctx, 'STR_ALIGNMENT', 50, 'completed', 'parquet', str(ctx.outputs_path / 'str_metrics.parquet'), 0, {
            'str_alignment_run_id': align_id,
            'missed_run_id': missed_run_id,
            'summary': ar.get('summary') or {},
        })
        return {'str_alignment_run_id': align_id, 'missed_run_id': missed_run_id, 'summary': ar.get('summary') or {}}

    def _step_ops_intelligence(self, ctx: RunContext, alert_run_id: int) -> Dict:
        ops = OperationsIntelligenceService(ctx.run_db_path)
        inter = ops.run_scenario_interaction([alert_run_id], None, None, ctx.created_by)
        wcfg = WorkloadConfig(analysts=10, alerts_per_analyst=15, sla_days=3)
        wl = ops.run_workload_simulation([alert_run_id], None, None, wcfg, ctx.created_by)

        with duckdb_pool.connection(ctx.run_db_path) as conn:
            _ = self._export_parquet(
                f"SELECT as_of_date, alerts_generated, capacity, excess, backlog FROM workload_simulation_results WHERE run_id = {int(wl['run']['run_id'])}",
                ctx.outputs_path / 'ops_metrics.parquet',
                conn
            )
        self._register_output(ctx, 'OPS_INTELLIGENCE', 60, 'completed', 'parquet', str(ctx.outputs_path / 'ops_metrics.parquet'), 0, {
            'scenario_interaction_run_id': inter['run']['run_id'],
            'workload_run_id': wl['run']['run_id'],
        })
        return {'scenario_interaction': inter, 'workload': wl}

    def _chart_to_image(self, fig, out_path: Path) -> str:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=160, bbox_inches='tight')
        plt.close(fig)
        return str(out_path)

    def _generate_pdf(self, ctx: RunContext, summary: Dict) -> str:
        pdf_path = ctx.report_path / "calibration_report_advanced.pdf"
        gen = BTSYAdvancedReportGenerator(ctx.run_db_path)
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        return gen.generate_pdf(run_id=int(ctx.run_id), output_path=pdf_path)

    def _execute_run(self, ctx: RunContext, frozen: FrozenConfig):
        try:
            from api.tools.btsy.service import get_btsy_service
            btsy = get_btsy_service()
            env_folders = btsy.init_env_structure(ctx.tenant_id, ctx.env_id)
            normalized_folder = env_folders['normalized']

            self._ensure_run_db_schema(ctx, frozen)
            ev = CalibrationEvidenceStore(ctx.run_db_path)
            ev.mark_run_started(int(ctx.run_id))
            infer = ControlledInferenceService(ctx.run_db_path)

            self._update(ctx, 'STEP_0_DATA_FOUNDATION', 5)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_0", step_name="Data Foundation", config_obj={})
            try:
                _ = self._step_data_foundation(ctx, frozen, env_folders)
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_0", inference_type="data_quality")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_0", status="COMPLETED", config_obj={})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_0", status="FAILED", config_obj={})
                raise

            self._update(ctx, 'STEP_1_UNIVERSE', 10)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_1", step_name="Universe Definition", config_obj=frozen.universe_filter_spec or {})
            try:
                universe_id = self._step_universe(ctx, frozen, env_folders)
                universe_summary = self._get_step_summary(ctx, 'UNIVERSE')
                ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_1", metrics=universe_summary or {})
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_1",
                    artifact_type="table",
                    artifact_key="universe_parquet",
                    table_name=None,
                    metadata={'parquet_path': str(ctx.outputs_path / 'universe.parquet')},
                )
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_1", inference_type="population")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_1", status="COMPLETED", config_obj=frozen.universe_filter_spec or {})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_1", status="FAILED", config_obj=frozen.universe_filter_spec or {})
                raise

            self._update(ctx, 'STEP_2_BEHAVIOR', 25)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_2", step_name="Behavioural Aggregation", config_obj=frozen.behavior_config or {})
            try:
                behavior_run_id = self._step_behavior(ctx, frozen, universe_id)
                bconn = duckdb.connect(str(ctx.behavior_db_path))
                try:
                    b_row = bconn.execute(
                        "SELECT COUNT(1) AS n, COUNT(DISTINCT metric_name) AS m FROM behavior_table WHERE behavior_run_id = ?",
                        [int(behavior_run_id)],
                    ).fetchone()
                    beh_metrics = {
                        "behavior_run_id": int(behavior_run_id),
                        "behavior_rows": int((b_row[0] or 0) if b_row else 0),
                        "behavior_metric_count": int((b_row[1] or 0) if b_row else 0),
                    }
                finally:
                    bconn.close()
                ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_2", metrics=beh_metrics)
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_2",
                    artifact_type="table",
                    artifact_key="behavior_parquet",
                    table_name=None,
                    metadata={'parquet_path': str(ctx.outputs_path / 'behavior.parquet'), 'behavior_run_id': int(behavior_run_id)},
                )
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_2", inference_type="behaviour")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_2", status="COMPLETED", config_obj=frozen.behavior_config or {})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_2", status="FAILED", config_obj=frozen.behavior_config or {})
                raise

            self._update(ctx, 'STEP_3_CALIBRATION', 50)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_3", step_name="Calibration Workbench", config_obj={})
            try:
                cal = self._step_calibration(ctx, behavior_run_id)
                ctx.session_id = int(cal['session_id'])
                with duckdb_pool.connection(ctx.run_db_path) as conn:
                    bf = conn.execute(
                        """
                        SELECT boundary_id, threshold_value, atl_count
                        FROM calibration_boundary_final
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    ).fetchone()
                    try:
                        cands = conn.execute("SELECT COUNT(1) FROM calibration_boundary_candidates").fetchone()
                        cand_count = int(cands[0] or 0) if cands else 0
                    except Exception:
                        try:
                            cands2 = conn.execute("SELECT COUNT(1) FROM threshold_strategies WHERE session_id = ?", [int(ctx.session_id)]).fetchone()
                            cand_count = int(cands2[0] or 0) if cands2 else 0
                        except Exception:
                            cand_count = 0
                cal_metrics = {
                    "session_id": int(cal["session_id"]),
                    "ocr_run_id": int(cal["ocr_run_id"]),
                    "final_boundary_id": int(bf[0]) if bf else None,
                    "final_threshold_value": float(bf[1]) if bf and bf[1] is not None else None,
                    "final_atl_count": int(bf[2]) if bf else None,
                    "candidate_boundary_count": int(cand_count),
                }
                ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_3", metrics=cal_metrics)
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_3",
                    artifact_type="table",
                    artifact_key="calibration_orchestrated_runs",
                    table_name="calibration_orchestrated_runs",
                    metadata={'session_id': int(cal['session_id']), 'ocr_run_id': int(cal['ocr_run_id'])},
                )
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_3", inference_type="calibration")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_3", status="COMPLETED", config_obj={})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_3", status="FAILED", config_obj={})
                raise

            self._update(ctx, 'STEP_4_ALERT_GENERATION', 70)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_4", step_name="Alerting & Validation", config_obj={})
            try:
                ar = self._step_alert_generation(ctx, env_folders)
                with duckdb_pool.connection(ctx.run_db_path) as conn:
                    ac = conn.execute("SELECT COUNT(1) FROM alerts WHERE alert_run_id = ?", [int(ar["alert_run_id"])]).fetchone()
                ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_4", metrics={"alert_run_id": int(ar["alert_run_id"]), "alert_count": int(ac[0] or 0) if ac else 0})
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_4",
                    artifact_type="table",
                    artifact_key="alerts_parquet",
                    table_name=None,
                    metadata={'parquet_path': str(ctx.outputs_path / 'alerts.parquet'), 'alert_run_id': int(ar['alert_run_id'])},
                )
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_4", inference_type="calibration")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_4", status="COMPLETED", config_obj={})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_4", status="FAILED", config_obj={})
                raise

            self._update(ctx, 'STEP_5_STR_ALIGNMENT', 85)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_5", step_name="STR Alignment & Validation", config_obj={})
            try:
                sr = self._step_str_alignment(ctx, int(ar['alert_run_id']), env_folders)
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_5",
                    artifact_type="table",
                    artifact_key="str_metrics_parquet",
                    table_name=None,
                    metadata={'parquet_path': str(ctx.outputs_path / 'str_metrics.parquet'), 'missed_run_id': int(sr['missed_run_id'])},
                )
                ev.insert_metrics(run_id=int(ctx.run_id), step_id="STEP_5", metrics=sr.get('summary') or {})
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_5", inference_type="calibration")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_5", status="COMPLETED", config_obj={})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_5", status="FAILED", config_obj={})
                raise

            self._update(ctx, 'STEP_6_OPS_INTELLIGENCE', 95)
            ev.start_step(run_id=int(ctx.run_id), step_id="STEP_6", step_name="Operational Intelligence", config_obj={'analysts': 10, 'alerts_per_analyst': 15, 'sla_days': 3})
            try:
                ops = self._step_ops_intelligence(ctx, int(ar['alert_run_id']))
                wl_run_id = int((((ops or {}).get("workload") or {}).get("run") or {}).get("run_id") or 0)
                ev.insert_metrics(
                    run_id=int(ctx.run_id),
                    step_id="STEP_6",
                    metrics={"workload_run_id": wl_run_id, "analysts": 10, "alerts_per_analyst": 15, "sla_days": 3},
                )
                ev.register_artifact(
                    run_id=int(ctx.run_id),
                    step_id="STEP_6",
                    artifact_type="table",
                    artifact_key="ops_metrics_parquet",
                    table_name=None,
                    metadata={'parquet_path': str(ctx.outputs_path / 'ops_metrics.parquet')},
                )
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_6", inference_type="ops")
                infer.generate_and_store(run_id=int(ctx.run_id), step_id="STEP_6", inference_type="governance")
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_6", status="COMPLETED", config_obj={'analysts': 10, 'alerts_per_analyst': 15, 'sla_days': 3})
            except Exception:
                ev.complete_step(run_id=int(ctx.run_id), step_id="STEP_6", status="FAILED", config_obj={'analysts': 10, 'alerts_per_analyst': 15, 'sla_days': 3})
                raise

            with duckdb_pool.connection(ctx.run_db_path) as conn:
                cal_boundary = conn.execute("""
                    SELECT boundary_id, threshold_value, atl_count
                    FROM calibration_boundary_final
                    ORDER BY created_at DESC
                    LIMIT 1
                """).fetchone()
                alert_cnt = conn.execute("SELECT COUNT(1) FROM alerts").fetchone()
            universe_summary = self._get_step_summary(ctx, 'UNIVERSE')
            summary = {
                'run_id': int(ctx.run_id),
                'snapshot_id': ctx.snapshot_id,
                'config_id': frozen.config_id,
                'config_version': frozen.config_version,
                'behavior_config': frozen.behavior_config,
                'universe': universe_summary,
                'calibration': {
                    'boundary_id': int(cal_boundary[0]) if cal_boundary else None,
                    'threshold_value': float(cal_boundary[1]) if cal_boundary and cal_boundary[1] is not None else None,
                    'atl_count': int(cal_boundary[2]) if cal_boundary else None,
                },
                'alerts': {
                    'alert_count': int(alert_cnt[0] or 0) if alert_cnt else 0,
                    'alert_run_id': int(ar['alert_run_id']),
                },
                'str': {
                    **(sr.get('summary') or {}),
                },
                'ops': {
                    'analysts': 10,
                    'alerts_per_analyst': 15,
                    'sla_days': 3,
                }
            }
            (ctx.outputs_path / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')

            self._update(ctx, 'STEP_7_REPORT', 98)
            pdf = self._generate_pdf(ctx, summary)

            self.registry.update_status(ctx.run_id, 'COMPLETED', progress_pct=100.0, current_step='COMPLETED', finished=True, report_pdf_path=pdf, summary_json=summary)
            self.registry.add_event(ctx.run_id, 'COMPLETED', {'report_pdf_path': pdf})
            self._log(ctx, "COMPLETED")
            ev.mark_run_completed(int(ctx.run_id), "COMPLETED")
        except Exception as e:
            err = str(e)
            tb = traceback.format_exc()
            try:
                self.registry.update_status(ctx.run_id, 'FAILED', progress_pct=None, current_step='FAILED', finished=True, error_text=err)
                self.registry.add_event(ctx.run_id, 'FAILED', {'error': err})
                self._log(ctx, f"FAILED: {err}\n{tb}")
            except Exception:
                pass
            try:
                ev = CalibrationEvidenceStore(ctx.run_db_path)
                ev.mark_run_completed(int(ctx.run_id), "FAILED")
            except Exception:
                pass
        finally:
            with self._lock:
                self._inflight.discard(int(ctx.run_id))

    def _get_step_summary(self, ctx: RunContext, step_id: str) -> Dict:
        with duckdb_pool.connection(ctx.run_db_path) as conn:
            row = conn.execute("""
                SELECT summary_json
                FROM run_step_outputs
                WHERE run_id = ? AND step_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, [int(ctx.run_id), step_id]).fetchone()
        return json.loads(row[0]) if row and row[0] else {}
