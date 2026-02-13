import os
import time
import threading
from pathlib import Path
import duckdb

_schema_lock = threading.Lock()
_schema_ensured = set()
_connect_locks = {}
_connect_locks_guard = threading.Lock()


def _get_connect_lock(db_key: str) -> threading.Lock:
    with _connect_locks_guard:
        lock = _connect_locks.get(db_key)
        if lock is None:
            lock = threading.Lock()
            _connect_locks[db_key] = lock
        return lock

class MuleDetectionDBService:
    def __init__(self, base_env_path: str = "data/environments"):
        self.base_env_path = Path(base_env_path)
        self._singleton = None

    def init_env_structure(self, env_id: str):
        root = self.base_env_path / env_id / "mule_detection"
        paths = {
            "root": root,
            "duckdb_dir": root / "duckdb",
            "duckdb": root / "duckdb" / "mule_detection.duckdb",
            "models_dir": root / "ml_models"
        }
        paths["root"].mkdir(parents=True, exist_ok=True)
        paths["duckdb_dir"].mkdir(parents=True, exist_ok=True)
        paths["models_dir"].mkdir(parents=True, exist_ok=True)
        self.ensure_schema(paths["duckdb"])
        return paths

    def ensure_schema(self, db_path: Path):
        db_key = str(db_path)
        if db_key in _schema_ensured:
            return

        with _schema_lock:
            if db_key in _schema_ensured:
                return
            with _get_connect_lock(db_key):
                conn = duckdb.connect(str(db_path))
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_transactions_raw (
                        txn_id TEXT,
                        account_id TEXT,
                        txn_timestamp TIMESTAMP,
                        amount DOUBLE,
                        direction TEXT,
                        counterparty_account TEXT,
                        counterparty_bank TEXT,
                        channel TEXT,
                        txn_type TEXT,
                        is_suspicious BOOLEAN,
                        mule_pattern TEXT,
                        hour INTEGER,
                        day_of_week INTEGER,
                        is_weekend BOOLEAN,
                        is_night BOOLEAN,
                        device_id TEXT,
                        ip_address TEXT,
                        geo_location TEXT,
                        balance_after DOUBLE,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_accounts_raw (
                        account_id TEXT,
                        customer_id TEXT,
                        account_open_date TIMESTAMP,
                        customer_type TEXT,
                        risk_rating TEXT,
                        occupation TEXT,
                        expected_turnover DOUBLE,
                        is_mule BOOLEAN,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_uploads (
                        upload_id TEXT,
                        environment_id TEXT,
                        uploaded_at TIMESTAMP,
                        txn_file_name TEXT,
                        accounts_file_name TEXT,
                        txn_row_count BIGINT,
                        accounts_row_count BIGINT,
                        txn_schema_json TEXT,
                        accounts_schema_json TEXT,
                        dataset_version TEXT,
                        uploader TEXT,
                        source_ip TEXT,
                        checksum_txn TEXT,
                        checksum_acc TEXT
                    )
                """)
                for col, dtype in [
                    ("dataset_version", "TEXT"),
                    ("uploader", "TEXT"),
                    ("source_ip", "TEXT"),
                    ("checksum_txn", "TEXT"),
                    ("checksum_acc", "TEXT"),
                ]:
                    try:
                        conn.execute(f"ALTER TABLE mule_uploads ADD COLUMN {col} {dtype}")
                    except Exception:
                        pass
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_account_features (
                        account_id TEXT,
                        environment_id TEXT,
                        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_feature_governance (
                        feature_name TEXT,
                        version TEXT,
                        environment_id TEXT,
                        status TEXT,
                        owner TEXT,
                        comment TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_target_governance (
                        target_name TEXT,
                        environment_id TEXT,
                        description TEXT,
                        source_system TEXT,
                        approved_by TEXT,
                        owner TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_typology_registry (
                        typology TEXT,
                        environment_id TEXT,
                        description TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_feature_metadata (
                        feature_name TEXT,
                        environment_id TEXT,
                        typology TEXT,
                        business_description TEXT,
                        expected_risk_direction TEXT,
                        owner TEXT,
                        window_spec TEXT,
                        data_source TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                for col, dtype in [
                    ("window_spec", "TEXT"),
                    ("entity_level", "TEXT"),
                    ("aggregation", "TEXT"),
                    ("direction", "TEXT"),
                    ("transformation_sql", "TEXT"),
                    ("origin_module", "TEXT"),
                    ("built_by", "TEXT"),
                    ("code_location", "TEXT"),
                ]:
                    try:
                        conn.execute(f"ALTER TABLE mule_feature_metadata ADD COLUMN {col} {dtype}")
                    except Exception:
                        pass
                try:
                    conn.execute('UPDATE mule_feature_metadata SET window_spec = "window" WHERE window_spec IS NULL')
                except Exception:
                    pass
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_feature_profiles (
                        run_id TEXT,
                        feature_name TEXT,
                        environment_id TEXT,
                        missing_pct DOUBLE,
                        mean DOUBLE,
                        std DOUBLE,
                        min DOUBLE,
                        p25 DOUBLE,
                        p50 DOUBLE,
                        p75 DOUBLE,
                        max DOUBLE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_feature_bins (
                        run_id TEXT,
                        feature_name TEXT,
                        environment_id TEXT,
                        bin_start DOUBLE,
                        bin_end DOUBLE,
                        count BIGINT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_models (
                        model_version TEXT,
                        model_path TEXT,
                        trained_at TIMESTAMP,
                        algorithm TEXT,
                        training_samples INTEGER,
                        feature_count INTEGER,
                        auc DOUBLE,
                        recall DOUBLE,
                        precision DOUBLE,
                        f1 DOUBLE,
                        status TEXT,
                        active BOOLEAN,
                        environment_id TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_ml_experiments (
                        experiment_id TEXT,
                        name TEXT,
                        objective TEXT,
                        owner TEXT,
                        dataset_version TEXT,
                        feature_set_version TEXT,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_ml_experiment_runs (
                        run_id TEXT,
                        experiment_id TEXT,
                        stage TEXT,
                        status TEXT,
                        config_json TEXT,
                        result_json TEXT,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_ml_model_approvals (
                        approval_id TEXT,
                        model_version TEXT,
                        experiment_id TEXT,
                        reviewer TEXT,
                        decision TEXT,
                        comments TEXT,
                        valid_until TIMESTAMP,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_risk_scores (
                        id BIGINT,
                        account_id TEXT,
                        hybrid_score DOUBLE,
                        risk_level TEXT,
                        ml_risk_score DOUBLE,
                        pattern_risk_score DOUBLE,
                        confidence DOUBLE,
                        decision_logic TEXT,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_ml_scores (
                        account_id TEXT,
                        ml_score DOUBLE,
                        model_version TEXT,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_inference_assignments (
                        account_id TEXT,
                        investigator TEXT,
                        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        environment_id TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_jobs (
                        job_id TEXT,
                        job_type TEXT,
                        state TEXT,
                        step TEXT,
                        message TEXT,
                        processed_accounts BIGINT,
                        total_accounts BIGINT,
                        progress_pct DOUBLE,
                        payload_json TEXT,
                        result_json TEXT,
                        error TEXT,
                        environment_id TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_mule_jobs_env_type_state
                    ON mule_jobs(environment_id, job_type, state, created_at)
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_rule_config (
                        environment_id TEXT PRIMARY KEY,
                        config_json TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS mule_module_runs (
                        run_id TEXT,
                        environment_id TEXT,
                        module TEXT,
                        data_version TEXT,
                        config_version TEXT,
                        summary_json TEXT,
                        result_json TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_mule_module_runs_env_mod
                    ON mule_module_runs(environment_id, module, created_at)
                """)

                legacy_suffix = str(int(time.time()))
                for obj_name in ["mule_transactions", "mule_accounts"]:
                    row = conn.execute(
                        """
                        SELECT table_type
                        FROM information_schema.tables
                        WHERE table_schema = 'main' AND table_name = ?
                        """,
                        [obj_name],
                    ).fetchone()
                    if row:
                        table_type = str(row[0] or "")
                        if table_type.upper() != "VIEW":
                            conn.execute(f"ALTER TABLE {obj_name} RENAME TO {obj_name}_legacy_{legacy_suffix}")
                        else:
                            conn.execute(f"DROP VIEW IF EXISTS {obj_name}")

                conn.execute("""
                    CREATE OR REPLACE VIEW mule_transactions AS
                    SELECT
                        txn_id AS transaction_id,
                        account_id,
                        txn_timestamp AS timestamp,
                        amount,
                        direction,
                        txn_type AS transaction_type,
                        counterparty_account,
                        counterparty_bank AS counterparty_name,
                        balance_after,
                        channel,
                        device_id,
                        ip_address,
                        geo_location,
                        is_suspicious,
                        mule_pattern,
                        hour,
                        day_of_week,
                        is_weekend,
                        is_night,
                        environment_id,
                        created_at
                    FROM mule_transactions_raw
                """)
                conn.execute("""
                    CREATE OR REPLACE VIEW mule_accounts AS
                    SELECT
                        account_id,
                        customer_id,
                        account_open_date,
                        customer_type,
                        risk_rating,
                        occupation,
                        expected_turnover,
                        is_mule,
                        environment_id,
                        created_at
                    FROM mule_accounts_raw
                """)
            finally:
                conn.close()

            _schema_ensured.add(db_key)

    def connect(self, env_id: str, read_only: bool = False):
        paths = self.init_env_structure(env_id)
        db_key = str(paths["duckdb"])
        last_err = None
        for attempt in range(12):
            with _get_connect_lock(db_key):
                try:
                    conn = duckdb.connect(str(paths["duckdb"]), read_only=bool(read_only))
                    return conn, paths
                except Exception as e:
                    last_err = e
            msg = str(last_err or "")
            if "being used by another process" in msg or "Cannot open file" in msg:
                time.sleep(min(0.75, 0.05 * (attempt + 1) ** 2))
                continue
            raise last_err
        raise last_err

_svc = None

def get_md_db_service():
    global _svc
    if _svc is None:
        _svc = MuleDetectionDBService()
    return _svc
