from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import duckdb

from api.tools.btsy.autorun.autorun_executor import AutoRunExecutor
from api.tools.btsy.autorun.autorun_models import FrozenConfig, RunContext
from api.tools.btsy.autorun.autorun_registry import AutoRunRegistry
from api.tools.btsy.duckdb_pool import duckdb_pool


class AutoRunService:
    def __init__(self, env_folders: Dict, registry: AutoRunRegistry, executor: AutoRunExecutor, tenant_id: str, env_id: str):
        self.folders = env_folders
        self.registry = registry
        self.executor = executor
        self.tenant_id = tenant_id
        self.env_id = env_id

    def _env_db_paths(self) -> Tuple[Path, Path, Path]:
        workbench_db = self.folders['duckdb'] / 'calibration_workbench.duckdb'
        behavior_db = self.folders['duckdb'] / 'behavior.duckdb'
        universe_db = self.folders['duckdb'] / 'universes.duckdb'
        return workbench_db, behavior_db, universe_db

    def _load_env_config(self, session_id: int) -> Tuple[str, Dict, Dict, str]:
        workbench_db, behavior_db, universe_db = self._env_db_paths()

        with duckdb_pool.connection(workbench_db) as conn:
            s = conn.execute("""
                SELECT behavior_run_id, universe_id, metric_name, entity_level
                FROM calibration_sessions
                WHERE session_id = ?
            """, [int(session_id)]).fetchone()
            if not s:
                raise ValueError("Session not found")
            behavior_run_id = int(s[0])
            universe_id = int(s[1])
            metric_name = s[2] or 'scenario'
            entity_level = (s[3] or 'account').lower()

        bconn = duckdb.connect(str(behavior_db))
        try:
            b = bconn.execute("""
                SELECT config_json
                FROM behavior_runs
                WHERE behavior_run_id = ?
            """, [int(behavior_run_id)]).fetchone()
            if not b:
                raise ValueError("Behavior run not found for session")
            behavior_config = json.loads(b[0]) if b[0] else {}
        finally:
            bconn.close()

        uconn = duckdb.connect(str(universe_db))
        try:
            u = uconn.execute("""
                SELECT filter_spec, snapshot_id
                FROM transaction_universe_runs
                WHERE id = ?
            """, [int(universe_id)]).fetchone()
            if not u:
                raise ValueError("Universe not found for session")
            filter_spec = json.loads(u[0]) if u[0] else {}
            snapshot_id = u[1]
        finally:
            uconn.close()

        config_id = f"S-{int(session_id)}:{metric_name}"
        cfg_blob = json.dumps({'behavior_config': behavior_config, 'filter_spec': filter_spec}, sort_keys=True)
        cfg_hash = hashlib.sha256(cfg_blob.encode()).hexdigest()[:12]
        config_version = f"v{cfg_hash}"

        if entity_level and isinstance(behavior_config, dict):
            behavior_config.setdefault('entity_level', entity_level)

        return snapshot_id, behavior_config, filter_spec, config_id + "|" + config_version

    def create_run(self, snapshot_id: str, session_id: int, mode: str = 'simulation', created_by: str = 'user') -> Dict:
        if not snapshot_id:
            raise ValueError("snapshot_id required")

        env_snapshot_id, behavior_config, filter_spec, config_tag = self._load_env_config(int(session_id))
        config_id, config_version = config_tag.split("|", 1)
        _ = env_snapshot_id

        runs_root = self.folders['root'] / 'calibration_runs'
        runs_root.mkdir(parents=True, exist_ok=True)

        placeholder_workspace = runs_root / 'PENDING'
        placeholder_workspace.mkdir(parents=True, exist_ok=True)

        run_db_path = placeholder_workspace / 'run.duckdb'
        behavior_db_path = placeholder_workspace / 'behavior.duckdb'
        universe_db_path = placeholder_workspace / 'universe.duckdb'

        run_id = self.registry.create_run(
            env_id=self.env_id,
            snapshot_id=snapshot_id,
            session_id=int(session_id),
            config_id=config_id,
            config_version=config_version,
            mode=mode,
            created_by=created_by,
            workspace_path=placeholder_workspace,
            run_db_path=run_db_path,
            behavior_db_path=behavior_db_path,
            universe_db_path=universe_db_path,
        )

        workspace = runs_root / str(run_id)
        workspace.mkdir(parents=True, exist_ok=True)
        (workspace / 'duckdb').mkdir(parents=True, exist_ok=True)
        (workspace / 'inputs').mkdir(parents=True, exist_ok=True)
        (workspace / 'outputs').mkdir(parents=True, exist_ok=True)
        (workspace / 'report').mkdir(parents=True, exist_ok=True)
        (workspace / 'logs').mkdir(parents=True, exist_ok=True)

        run_db_path = workspace / 'duckdb' / 'run.duckdb'
        behavior_db_path = workspace / 'duckdb' / 'behavior.duckdb'
        universe_db_path = workspace / 'duckdb' / 'universe.duckdb'

        self.registry.update_status(
            run_id,
            status='CREATED',
            progress_pct=0.0,
            current_step='CREATED',
            report_pdf_path=None,
            summary_json={
                'config_id': config_id,
                'config_version': config_version,
            },
        )
        self.registry.add_event(run_id, 'CREATED', {'snapshot_id': snapshot_id, 'session_id': int(session_id), 'config_id': config_id, 'config_version': config_version})

        with duckdb_pool.connection(self.registry.db_path) as conn:
            conn.execute("""
                UPDATE auto_calibration_runs
                SET workspace_path = ?, run_db_path = ?, behavior_db_path = ?, universe_db_path = ?
                WHERE run_id = ?
            """, [str(workspace), str(run_db_path), str(behavior_db_path), str(universe_db_path), int(run_id)])

        frozen = FrozenConfig(
            config_id=config_id,
            config_version=config_version,
            behavior_config=behavior_config,
            universe_filter_spec=filter_spec,
        )

        ctx = RunContext(
            tenant_id=self.tenant_id,
            env_id=self.env_id,
            run_id=int(run_id),
            mode=mode,
            snapshot_id=snapshot_id,
            session_id=int(session_id),
            created_by=created_by,
            workspace_path=workspace,
            run_db_path=run_db_path,
            universe_db_path=universe_db_path,
            behavior_db_path=behavior_db_path,
            inputs_path=workspace / 'inputs',
            outputs_path=workspace / 'outputs',
            report_path=workspace / 'report',
            logs_path=workspace / 'logs',
        )

        (ctx.inputs_path / 'frozen_config.json').write_text(json.dumps(frozen.as_dict(), indent=2), encoding='utf-8')

        self.executor.enqueue(ctx, frozen)
        return {'run_id': int(run_id)}

    def list_runs(self, limit: int = 200) -> List[Dict]:
        return self.registry.list_runs(limit=limit)

    def get_run(self, run_id: int) -> Dict:
        return self.registry.get_run(int(run_id))
