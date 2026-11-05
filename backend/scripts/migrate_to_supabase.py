"""
Migration Tool: SQLite to Supabase PostgreSQL for Sentinel and MLOps.
Safely migrates core financial, investigation, and pipeline data.
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

TARGET_TABLES = [
    "cases",
    "alerts",
    "transactions",
    "accounts",
    "customers",
    "focus_runs",
    "focus_results",
    "active_case_scope",
    "case_queue",
    "case_status_history",
    "fcc_bridge_imports",
    "fcc_scored_entities",
    "master_case_summary",
    "master_cleaned_data",
]


def clean_row_for_supabase(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Cleans data types to match PostgreSQL schema."""
    cleaned = {}
    
    # Specific column extraction for fcc_scored_entities to match standard schema
    if table == "fcc_scored_entities":
        known_cols = {
            "alert_id", "transaction_id", "account_id", "customer_id", "case_id",
            "risk_score", "model_score", "decision", "reason_code", "scored_at",
            "fcc_pipeline_id", "fcc_pipeline_name", "fcc_publish_id", "fcc_publish_label"
        }
        for k, v in row.items():
            k_low = k.lower()
            if k_low in known_cols:
                cleaned[k_low] = None if (v is None or v == "" or v == "None") else v
        return cleaned

    for k, v in row.items():
        k_clean = k.lower()
        
        # Omit autoincrement id column
        if k_clean == "id" and table in ("cases", "alerts", "transactions", "accounts", "customers", "fcc_scored_entities"):
            continue
            
        if table == "active_case_scope":
            if k_clean == "id":
                cleaned["scope_id"] = str(v)
            elif k_clean == "case_ids":
                try:
                    cleaned["payload"] = json.loads(v) if isinstance(v, str) else v
                except Exception:
                    cleaned["payload"] = {"case_ids": v}
            elif k_clean in ("scope_type", "scope_value", "environment_id", "created_at", "updated_at"):
                cleaned[k_clean] = v
            continue

        if v is None or v == "" or v == "None":
            cleaned[k_clean] = None
        elif isinstance(v, str) and (v.startswith("{") or v.startswith("[")):
            try:
                cleaned[k_clean] = json.loads(v)
            except Exception:
                cleaned[k_clean] = v
        else:
            cleaned[k_clean] = v
    return cleaned


def migrate_database(sqlite_path: str):
    print("=" * 70)
    print("AML MIGRATION TOOL: Local SQLite -> Supabase Cloud (fcip)")
    print("=" * 70)
    print(f"Source Database : {sqlite_path}")

    if not os.path.exists(sqlite_path):
        print(f"[ERROR] SQLite source database not found at {sqlite_path}")
        return

    # Initialize Supabase
    manager = SupabaseManager()
    if not manager.is_connected:
        print("[ERROR] Unable to establish Supabase connection. Check your credentials in .env")
        return

    print("[OK] Supabase connection verified.\n")

    # Connect to SQLite
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    available_sqlite_tables = {r[0].lower() for r in cur.fetchall()}

    missing_tables = []
    migrated_stats = {}

    for table in TARGET_TABLES:
        if table.lower() not in available_sqlite_tables:
            continue

        print(f"\nProcessing table: [{table}]")
        
        # Check if table exists in Supabase
        if not manager.table_exists(table):
            print(f"  [WARN] Table '{table}' does NOT exist in Supabase yet.")
            missing_tables.append(table)
            continue

        # Fetch records from SQLite
        cur.execute(f"SELECT * FROM \"{table}\"")
        rows = [dict(r) for r in cur.fetchall()]
        row_count = len(rows)

        if row_count == 0:
            print(f"  [INFO] Table '{table}' is empty in SQLite. Skipped.")
            continue

        print(f"  Uploading {row_count:,} rows to Supabase...")
        cleaned_records = [clean_row_for_supabase(table, r) for r in rows]
        
        inserted = manager.insert_batch(table, cleaned_records, batch_size=500)
        print(f"  [OK] Successfully migrated {inserted:,}/{row_count:,} rows into Supabase '{table}'")
        migrated_stats[table] = {"source": row_count, "migrated": inserted}

    conn.close()

    print("\n" + "=" * 70)
    print("MIGRATION SUMMARY")
    print("=" * 70)
    for t, stat in migrated_stats.items():
        print(f"  * {t:<25} : {stat['migrated']:,} / {stat['source']:,} rows synced")

    if missing_tables:
        print("\nACTION REQUIRED IN SUPABASE:")
        print(f"The following {len(missing_tables)} tables need to be created in your Supabase SQL Editor:")
        print("Missing tables:", ", ".join(missing_tables))
        print(f"\nPlease open your Supabase Dashboard SQL Editor and execute the schema at:")
        print(f"   {backend_dir / 'database' / 'supabase_schema.sql'}")
        print("After running the SQL script, re-run this migration tool to sync all data!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate SQLite AML data to Supabase")
    parser.add_argument("--db", type=str, default="backend/data/environments/fcip_env/database.db", help="Path to source SQLite database")
    args = parser.parse_args()

    target_db = args.db
    if not os.path.exists(target_db):
        # Check alternate relative path
        alt_db = os.path.join(str(backend_dir), "data", "environments", "fcip_env", "database.db")
        if os.path.exists(alt_db):
            target_db = alt_db

    migrate_database(target_db)
