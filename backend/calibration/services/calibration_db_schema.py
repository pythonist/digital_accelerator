# backend/calibration/calibration_db_schema.py
"""
Calibration Tool Database Schema
Manages all calibration-specific tables separately from investigation DB
"""
import sqlite3
from pathlib import Path
import json
from datetime import datetime

class CalibrationDatabaseManager:
    """
    Dedicated database manager for calibration tool.
    Separate from investigation DB to avoid conflicts.
    """
    
    def __init__(self, db_path="data/calibration/calibration.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()
    
    def connect(self):
        """Create database connection"""
        conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def get_connection(self):
        return self.connect()

    def execute(self, query, params=()):
        conn = self.connect()
        cur = conn.cursor()
        cur.execute(query, params)
        conn.commit()
        conn.close()

    def fetch_all(self, query, params=()):
        conn = self.connect()
        cur = conn.cursor()
        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()
        return rows

    def fetch_one(self, query, params=()):
        conn = self.connect()
        cur = conn.cursor()
        cur.execute(query, params)
        row = cur.fetchone()
        conn.close()
        return row

    def init_schema(self):
        """Initialize all calibration tables"""
        conn = self.connect()
        cursor = conn.cursor()
        
        # ============================================================
        # STEP 0 METADATA TABLES
        # ============================================================
        
        # Upload Statistics
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS upload_statistics (
            stat_id INTEGER PRIMARY KEY AUTOINCREMENT,
            env_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            row_count INTEGER,
            column_count INTEGER,
            columns_json TEXT,
            date_range_start TEXT,
            date_range_end TEXT,
            null_count INTEGER,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(env_id, table_name)
        );
        """)
        
        # Schema Mappings
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_mappings (
            mapping_id INTEGER PRIMARY KEY AUTOINCREMENT,
            env_id TEXT NOT NULL,
            mapping_type TEXT DEFAULT 'golden_source',
            mapping_config TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(env_id, mapping_type)
        );
        """)
        
        # Join Contracts
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS join_contracts (
            contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
            env_id TEXT NOT NULL,
            left_table TEXT NOT NULL,
            right_table TEXT NOT NULL,
            left_key TEXT NOT NULL,
            right_key TEXT NOT NULL,
            join_type TEXT DEFAULT 'LEFT JOIN',
            join_order INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(env_id, left_table, right_table)
        );
        """)
        
        # Join Validation Results
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS join_validation_results (
            validation_id INTEGER PRIMARY KEY AUTOINCREMENT,
            env_id TEXT NOT NULL,
            join_step TEXT NOT NULL,
            total_rows INTEGER,
            matched_rows INTEGER,
            unmatched_rows INTEGER,
            match_rate REAL,
            warning_threshold REAL DEFAULT 80.0,
            has_warning BOOLEAN,
            validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(env_id, join_step)
        );
        """)
        
        # Data Readiness Status
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS data_readiness (
            env_id TEXT PRIMARY KEY,
            transactions_uploaded BOOLEAN DEFAULT 0,
            accounts_uploaded BOOLEAN DEFAULT 0,
            customers_uploaded BOOLEAN DEFAULT 0,
            mapping_completed BOOLEAN DEFAULT 0,
            joins_validated BOOLEAN DEFAULT 0,
            is_ready BOOLEAN DEFAULT 0,
            ready_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
        # ============================================================
        # EXISTING TABLES (STEP 1+)
        # ============================================================
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS calibration_runs (
            run_id TEXT PRIMARY KEY,
            env_id TEXT NOT NULL,
            scenario_name TEXT,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'draft',
            current_step INTEGER DEFAULT 1,
            scenario_config TEXT,
            base_population_count INTEGER,
            aggregation_config TEXT,
            aggregated_population_count INTEGER,
            selected_threshold REAL,
            selected_percentile REAL,
            estimated_alert_count INTEGER,
            approved_by TEXT,
            approved_at TIMESTAMP,
            approval_comment TEXT,
            FOREIGN KEY (env_id) REFERENCES environments(env_id)
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS golden_dataset_cache (
            cache_id TEXT PRIMARY KEY,
            env_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            row_count INTEGER,
            date_range_start TEXT,
            date_range_end TEXT,
            status TEXT DEFAULT 'building',
            file_path TEXT,
            metadata TEXT,
            UNIQUE(env_id)
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS scenario_populations (
            population_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            transaction_count INTEGER,
            account_count INTEGER,
            customer_count INTEGER,
            date_range_start TEXT,
            date_range_end TEXT,
            filters_applied TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS aggregated_populations (
            aggregation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            aggregation_level TEXT,
            lookback_days INTEGER,
            frequency TEXT,
            row_count INTEGER,
            unique_entities INTEGER,
            min_amount REAL,
            max_amount REAL,
            mean_amount REAL,
            median_amount REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS percentile_distributions (
            percentile_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            metric TEXT,
            p50 REAL, p75 REAL, p80 REAL, p85 REAL, p90 REAL, p95 REAL, p97 REAL, p99 REAL,
            computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS threshold_simulations (
            simulation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            metric TEXT,
            threshold_value REAL,
            percentile REAL,
            alerts_triggered INTEGER,
            unique_entities_flagged INTEGER,
            pct_population_flagged REAL,
            high_risk_alerts INTEGER,
            medium_risk_alerts INTEGER,
            low_risk_alerts INTEGER,
            simulated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS calibration_audit_log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT,
            user TEXT,
            action TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bank_alert_comparison (
            comparison_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            bank_alert_count INTEGER,
            tool_alert_count INTEGER,
            common_alerts INTEGER,
            bank_only_alerts INTEGER,
            tool_only_alerts INTEGER,
            comparison_details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
        );
        """)
        
        # Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_env ON calibration_runs(env_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON calibration_runs(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_created ON calibration_runs(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_simulations_run ON threshold_simulations(run_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_run ON calibration_audit_log(run_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_upload_stats ON upload_statistics(env_id, table_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_join_validation ON join_validation_results(env_id)")
        
        conn.commit()
        conn.close()
        print("✅ Calibration database schema initialized")
    
    def log_action(self, run_id, user, action, details=None):
        """Log calibration actions for audit trail"""
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO calibration_audit_log (run_id, user, action, details)
            VALUES (?, ?, ?, ?)
        """, (run_id, user, action, json.dumps(details) if details else None))
        conn.commit()
        conn.close()