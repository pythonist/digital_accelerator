"""
MLOps Migration Tool: Local MLOps state to Supabase PostgreSQL.
Transfers pipeline definitions, runs, step states, artifacts, metrics, and workflow sessions.
"""

import os
import sys
import json
import sqlite3
import argparse
from pathlib import Path
from typing import Dict, List, Any

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from services.supabase_manager import SupabaseManager
from api.tools.mlops.duckdb_manager import get_connection

MLOPS_TABLES = [
    "mlops_pipelines",
    "mlops_pipeline_versions",
    "mlops_pipeline_runs_v2",
    "mlops_pipeline_steps_v2",
    "mlops_workflow_sessions",
    "mlops_pipeline_step_events",
    "mlops_run_state",
    "mlops_run_state_events",
    "mlops_dataset_registry",
    "mlops_snapshots",
    "mlops_targets",
    "mlops_pipeline_artifacts_v2",
    "mlops_pipeline_metrics_v2",
    "mlops_pipeline_asset_links",
    "mlops_model_runs",
    "mlops_model_registry",
    "mlops_model_registry_audit",
    "mlops_deployments",
    "mlops_suppression_ledger",
    "mlops_run_reports",
    "mlops_jobs",
    "mlops_cache",
]


def clean_mlops_row(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    
    json_fields = {
        "steps_json", "pipeline_config_json", "snapshot_json", "runtime_state_json",
        "config_json", "input_refs_json", "output_refs_json", "artifact_refs_json",
        "state_json", "current_state_json", "last_stable_state_json", "case_scope_json",
        "handoff_summary_json", "payload_json", "columns_json", "column_types_json",
        "summary_json", "schema_json", "metrics_json", "metadata_json", "parameters",
        "details", "report_json", "result_json", "suppression_criteria", "feature_columns_json",
        "threshold_metrics_json", "test_truth_json", "test_prob_json", "dag_config", "metrics"
    }

    if table == "mlops_pipelines":
        valid_cols = {
            "pipeline_id", "name", "description", "version", "dag_config",
            "tenant_id", "env_id", "pipeline_type", "model_family",
            "steps_json", "prediction_grain", "lookback_days", "lookforward_days",
            "target_definition_type", "pipeline_config_json", "created_at", "updated_at"
        }
        for k, v in row.items():
            k_low = k.lower()
            if k_low in valid_cols and k_low != "dataset_id":
                if v is None or v == "" or v == "None":
                    cleaned[k_low] = None
                elif hasattr(v, "isoformat"):
                    cleaned[k_low] = v.isoformat()
                elif k_low in ("steps_json", "pipeline_config_json", "dag_config"):
                    cleaned[k_low] = json.loads(v) if isinstance(v, str) else v
                elif k_low == "pipeline_id":
                    cleaned[k_low] = str(v)
                else:
                    cleaned[k_low] = v
        if "name" not in cleaned or not cleaned["name"]:
            cleaned["name"] = f"Pipeline {cleaned.get('pipeline_id', '1')}"
        return cleaned

    if table == "mlops_pipeline_versions":
        valid_cols = {"version_id", "pipeline_id", "version_number", "snapshot_json", "created_by", "created_at"}
        for k, v in row.items():
            k_low = k.lower()
            if k_low in valid_cols:
                if v is None or v == "" or v == "None":
                    cleaned[k_low] = None
                elif hasattr(v, "isoformat"):
                    cleaned[k_low] = v.isoformat()
                elif k_low == "snapshot_json":
                    cleaned[k_low] = json.loads(v) if isinstance(v, str) else v
                elif k_low in ("version_id", "pipeline_id"):
                    cleaned[k_low] = str(v)
                else:
                    cleaned[k_low] = v
        cleaned["version_number"] = int(row.get("version_number") or row.get("version") or row.get("id") or 1)
        if "version_id" not in cleaned or not cleaned["version_id"]:
            cleaned["version_id"] = str(row.get("version_id") or row.get("id") or f"{cleaned.get('pipeline_id', '1')}_v{cleaned['version_number']}")
        return cleaned

    for k, v in row.items():
        k_clean = k.lower()
        if v is None or v == "" or v == "None":
            cleaned[k_clean] = None
        elif hasattr(v, "isoformat"):
            cleaned[k_clean] = v.isoformat()
        elif k_clean in json_fields:
            if isinstance(v, str):
                try:
                    cleaned[k_clean] = json.loads(v)
                except Exception:
                    cleaned[k_clean] = v
            else:
                cleaned[k_clean] = v
        else:
            cleaned[k_clean] = v
    return cleaned


def migrate_mlops(duckdb_path: Optional[str] = None):
    print("=" * 70)
    print("MLOPS MIGRATION TOOL: Local DuckDB/SQLite -> Supabase Cloud (fcip)")
    print("=" * 70)

    manager = SupabaseManager()
    if not manager.is_connected:
        print("[ERROR] Unable to connect to Supabase. Check .env credentials.")
        return

    print("[OK] Connected to Supabase.")

    # Locate DuckDB path
    target_duckdb = duckdb_path
    if not target_duckdb:
        candidates = [
            backend_dir / "data" / "environments" / "fcip_env" / "mlops" / "duckdb" / "mlops.duckdb",
            backend_dir / "data" / "environments" / "fcc_env" / "mlops" / "duckdb" / "mlops.duckdb",
            backend_dir / "data" / "tenants" / "default" / "envs" / "default" / "btsy" / "duckdb" / "calibration_workbench.duckdb"
        ]
        for c in candidates:
            if c.exists():
                target_duckdb = str(c)
                break

    if not target_duckdb or not os.path.exists(target_duckdb):
        print("[WARN] No local MLOps DuckDB found. Supabase is ready for fresh pipeline creation.")
        return

    print(f"Reading from source DuckDB: {target_duckdb}")
    missing_tables = []
    migrated_stats = {}

    try:
        with get_connection(target_duckdb, read_only=True) as conn:
            # Get table names
            duckdb_tables = {
                r[0].lower() for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()
            }

            for table in MLOPS_TABLES:
                if table not in duckdb_tables:
                    continue

                print(f"\nProcessing MLOps table: [{table}]")
                if not manager.table_exists(table):
                    print(f"  [WARN] Table '{table}' does NOT exist in Supabase yet.")
                    missing_tables.append(table)
                    continue

                cursor = conn.execute(f'SELECT * FROM "{table}"')
                col_names = [d[0] for d in cursor.description]
                rows = [dict(zip(col_names, r)) for r in cursor.fetchall()]
                count = len(rows)

                if count == 0:
                    print(f"  [INFO] Table '{table}' is empty locally. Skipped.")
                    continue

                print(f"  Uploading {count:,} rows to Supabase...")
                cleaned = [clean_mlops_row(table, r) for r in rows]
                inserted = manager.insert_batch(table, cleaned, batch_size=200)
                print(f"  [OK] Migrated {inserted:,}/{count:,} rows to Supabase '{table}'")
                migrated_stats[table] = {"source": count, "migrated": inserted}
    except Exception as e:
        print(f"[ERROR] DuckDB extraction error: {e}")

    print("\n" + "=" * 70)
    print("MLOPS MIGRATION SUMMARY")
    print("=" * 70)
    for t, stat in migrated_stats.items():
        print(f"  * {t:<30} : {stat['migrated']:,} / {stat['source']:,} rows synced")

    if missing_tables:
        print("\nACTION REQUIRED IN SUPABASE:")
        print(f"The following {len(missing_tables)} MLOps tables need to be created in your Supabase SQL Editor:")
        print("Missing tables:", ", ".join(missing_tables))
        print(f"\nPlease open your Supabase Dashboard SQL Editor and execute the schema at:")
        print(f"   {backend_dir / 'database' / 'supabase_mlops_schema.sql'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate local MLOps data to Supabase")
    parser.add_argument("--db", type=str, default=None, help="Path to source mlops.duckdb")
    args = parser.parse_args()
    migrate_mlops(args.db)
