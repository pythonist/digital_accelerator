"""
Smoke test for the MLOps AutoBuild workbench pipeline.

Usage:
  python scripts/mlops_workbench_smoke.py --env e2e_smoke_ba792b71 --target CASE_STATUS
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.tools.mlops import autopilot_routes
from api.tools.mlops.path_utils import resolve_env_root


def _discover_dataset_ids(env_root: Path) -> list[int]:
    db = env_root / "mlops" / "duckdb" / "mlops.duckdb"
    with duckdb.connect(str(db)) as conn:
        rows = conn.execute(
            """
            SELECT dataset_id, dataset_type
            FROM mlops_dataset_registry
            ORDER BY dataset_id
            """
        ).fetchall()
    blocked = {"master_dataset", "preprocessed_dataset", "model_output", "model_dataset", "scored_dataset", "feature_store"}
    return [int(dataset_id) for dataset_id, dataset_type in rows if str(dataset_type or "").strip().lower() not in blocked]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, help="Environment id")
    parser.add_argument("--tenant", default="default", help="Tenant id")
    parser.add_argument("--target", default="CASE_STATUS", help="Requested target column")
    parser.add_argument("--goal", default="balanced", help="Business goal")
    args = parser.parse_args()

    env_root = resolve_env_root(args.env, args.tenant, create_if_missing=False)
    dataset_ids = _discover_dataset_ids(env_root)
    if not dataset_ids:
        raise SystemExit("No source datasets available for smoke test")

    run = autopilot_routes._make_run(
        env_id=args.env,
        tenant_id=args.tenant,
        env_root=env_root,
        config={
            "dataset_ids": dataset_ids,
            "target_column": args.target,
            "business_goal": args.goal,
            "description": "mlops_workbench_smoke",
        },
    )
    run_id = str(run["run_id"])
    autopilot_routes._run_pipeline(run_id, env_root)
    final = autopilot_routes._get_run_copy(run_id, env_root) or {}

    print(f"run_id={run_id}")
    print(f"status={final.get('status')}")
    print(f"error={final.get('error')}")
    for step in final.get("steps", []):
        print(f"{step.get('id')}: {step.get('status')} :: {step.get('message')}")
    print(f"artifacts={final.get('artifacts')}")

    return 0 if str(final.get("status")) == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
