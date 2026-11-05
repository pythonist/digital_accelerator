import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.master_dataset_version_manager import MasterDatasetVersionManager

def test_workflow_dependencies():
    env_root = Path(__file__).resolve().parent / "data" / "environments" / "test_env_routes"
    db_path = env_root / "mlops" / "duckdb" / "mlops.duckdb"

    svc = MLOpsWorkbenchService(db_path)
    tenant_id = "default"
    env_id = "test_env_routes"

    print("=" * 70)
    print("TESTING MASTER DATASET VERSION WORKFLOW DEPENDENCY ENGINE")
    print("=" * 70)

    # 1. Sync / Register datasets from data directory
    data_dir = env_root / "data"
    synced = []
    for csv_f in data_dir.glob("*.csv"):
        dtype = csv_f.stem.lower()
        reg = svc.register_dataset(tenant_id, env_id, dtype, csv_f.name, csv_f)
        synced.append(reg)
    print(f"1. Registered {len(synced)} source datasets in workspace registry")

    # 2. Build a fresh Master Dataset Version
    plan = svc.plan_master_dataset(tenant_id, env_id, synced)
    build_result = svc.build_master_dataset_from_plan(
        tenant_id=tenant_id,
        env_id=env_id,
        plan=plan,
        datasets=synced,
        output_name="master_aml_lifecycle",
        version_tag="v1.0.0",
    )
    ver_id = build_result["dataset_version_id"]
    print(f"2. Published Master Dataset Version: {ver_id}")

    # 3. Check freshness on newly built version (MUST BE FRESH)
    freshness = svc.check_master_dataset_version_freshness(tenant_id, env_id, ver_id)
    print(f"3. Freshness Check (Fresh build): is_fresh={freshness['is_fresh']}, is_outdated={freshness['is_outdated']}")
    assert freshness["is_fresh"] is True, f"Expected version to be fresh, got reasons: {freshness.get('stale_reasons')}"

    # 4. Validate downstream stages can execute against this fresh version
    for stage in ["target", "eda", "preprocess", "model", "validation", "registry", "ready"]:
        check = svc.validate_downstream_can_execute(
            tenant_id=tenant_id,
            env_id=env_id,
            stage_name=stage,
            dataset_version_id=ver_id,
        )
        assert check["can_execute"] is True, f"Expected stage {stage} to be executable"
    print("4. Verified ALL 7 downstream stages (Target, EDA, Preprocess, Model, Validation, Registry, Ready) can execute!")

    # 5. Plan divergence test
    altered_plan = {
        "target_grain": {"entity_name": "customers"}, # altered!
        "sources": [{"table_name": "alerts"}],
    }
    plan_div = svc.check_master_dataset_version_freshness(
        tenant_id=tenant_id,
        env_id=env_id,
        dataset_version_id=ver_id,
        current_plan=altered_plan,
    )
    print(f"5. Plan Divergence Test: is_outdated={plan_div['is_outdated']}, reasons={plan_div['stale_reasons']}")
    assert plan_div["is_outdated"] is True

    # 6. Source dataset mutation test: modify transactions.csv
    txn_file = env_root / "data" / "transactions.csv"
    with open(txn_file, "a") as f:
        f.write("\nTXN_MUTATION_999999,ACC_1,100.0,2026-08-27 12:00:00,WIRE,EUR,OUT,DE,TEST,TEST,0,0,0,0,0,0\n")

    # Check freshness after source mutation (MUST BE OUTDATED)
    stale_check = svc.check_master_dataset_version_freshness(tenant_id, env_id, ver_id)
    print(f"6. Source Mutation Test (Modified transactions.csv):")
    print(f"   is_fresh={stale_check['is_fresh']}, is_outdated={stale_check['is_outdated']}")
    print(f"   Stale reasons: {stale_check['stale_reasons']}")
    assert stale_check["is_outdated"] is True, "Expected version to be marked outdated after source dataset modified"
    assert any("transactions" in r for r in stale_check["stale_reasons"])

    # 7. Validate downstream execution is PREVENTED / BLOCKED when master version is stale
    blocked_check = svc.validate_downstream_can_execute(
        tenant_id=tenant_id,
        env_id=env_id,
        stage_name="preprocess",
        dataset_version_id=ver_id,
    )
    print(f"7. Blocked Downstream Stage Execution Check:")
    print(f"   can_execute={blocked_check['can_execute']}, error_code={blocked_check['error_code']}")
    print(f"   Blocked message: {blocked_check['message']}")
    assert blocked_check["can_execute"] is False, "Expected downstream execution to be blocked"
    assert blocked_check["error_code"] == "STALE_MASTER_VERSION"

    print("=" * 70)
    print("[SUCCESS] Full Master Dataset Version & Downstream Dependency lifecycle verified!")
    print("=" * 70)

if __name__ == "__main__":
    test_workflow_dependencies()
