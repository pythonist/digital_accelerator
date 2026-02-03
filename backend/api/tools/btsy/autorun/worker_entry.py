from __future__ import annotations

import argparse
import json
from pathlib import Path

from api.tools.btsy.autorun.autorun_executor import AutoRunExecutor
from api.tools.btsy.autorun.autorun_models import FrozenConfig, RunContext
from api.tools.btsy.autorun.autorun_registry import AutoRunRegistry
from api.tools.btsy.service import get_btsy_service


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant-id", default="default")
    ap.add_argument("--env-id", default="default")
    ap.add_argument("--run-id", required=True, type=int)
    args = ap.parse_args()

    btsy = get_btsy_service()
    folders = btsy.init_env_structure(args.tenant_id, args.env_id)
    index_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    registry = AutoRunRegistry(index_db)

    run = registry.get_run(int(args.run_id))
    ws = Path(run['workspace_path'])
    frozen_path = ws / "inputs" / "frozen_config.json"
    frozen_json = json.loads(frozen_path.read_text(encoding="utf-8"))
    frozen = FrozenConfig(
        config_id=frozen_json.get('config_id'),
        config_version=frozen_json.get('config_version'),
        behavior_config=frozen_json.get('behavior_config') or {},
        universe_filter_spec=frozen_json.get('universe_filter_spec') or {},
    )

    ctx = RunContext(
        tenant_id=args.tenant_id,
        env_id=args.env_id,
        run_id=int(args.run_id),
        mode=run.get('mode') or 'simulation',
        snapshot_id=run.get('snapshot_id'),
        session_id=int(run.get('session_id') or 0),
        created_by=run.get('created_by') or 'user',
        workspace_path=ws,
        run_db_path=Path(run['run_db_path']),
        universe_db_path=Path(run['universe_db_path']),
        behavior_db_path=Path(run['behavior_db_path']),
        inputs_path=ws / 'inputs',
        outputs_path=ws / 'outputs',
        report_path=ws / 'report',
        logs_path=ws / 'logs',
    )

    executor = AutoRunExecutor(registry, max_workers=1, mode='in_process')
    executor.run_once(ctx, frozen)


if __name__ == "__main__":
    main()

