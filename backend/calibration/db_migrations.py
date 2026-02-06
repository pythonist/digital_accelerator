# backend/calibration/db_migrations.py
"""
Database Migrations for Calibration Tool
UPDATED: Includes Core Workflow (Step 1-2) + Step 0 Data Foundation
"""
import logging

logger = logging.getLogger(__name__)

def add_core_workflow_tables(conn):
    """
    Migration: Add Core Workflow Tables (Required for Steps 1 & 2)
    Version: 1.0.0 - Core Engine
    
    Creates:
    - calibration_runs: The central state machine for the entire workflow.
    """
    cursor = conn.cursor()
    print("🔧 [Migration] Adding Core Workflow tables...")

    # ==================================================================
    # TABLE 0: calibration_runs (THE SPINE)
    # Stores state for Step 1 (Population) and Step 2 (Aggregation)
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS calibration_runs (
        run_id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        scenario_name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'DRAFT',  -- DRAFT, POPULATION_CONFIRMED, AGGREGATED, etc.
        
        -- Step 1: Population Extraction Data
        population_filters TEXT,      -- JSON: { "segment": "Retail", "date_range": ... }
        population_stats TEXT,        -- JSON: { "total_rows": 50000, "filtered_rows": 12000 }
        
        -- Step 2: Aggregation Data
        aggregation_config TEXT,      -- JSON: { "group_by": ["customer_id"], "metrics": ["sum"] }
        aggregation_stats TEXT,       -- JSON: { "agg_rows": 500, "processing_time": 1.2 }
        
        -- Metadata
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_runs_env_status 
    ON calibration_runs(env_id, status);
    """)

    conn.commit()
    print("✅ [Migration] Core workflow tables created")


def add_step0_data_foundation_tables(conn):
    """
    Migration: Add Step 0 Data Foundation tables
    Version: 3.0.0 - Data Foundation Layer
    """
    cursor = conn.cursor()
    print("🔧 [Migration] Adding Step 0 Data Foundation tables...")
    
    # ==================================================================
    # TABLE 1: datasets
    # Tracks uploaded CSV files
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS datasets (
        dataset_id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        dataset_name TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        table_name TEXT NOT NULL,
        row_count INTEGER DEFAULT 0,
        column_count INTEGER DEFAULT 0,
        file_size_bytes INTEGER DEFAULT 0,
        upload_status TEXT DEFAULT 'pending',
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        replaced_by TEXT,
        is_active INTEGER DEFAULT 1,
        
        UNIQUE(env_id, dataset_name),
        FOREIGN KEY (replaced_by) REFERENCES datasets(dataset_id) ON DELETE SET NULL
    );
    """)
    
    # ==================================================================
    # TABLE 2: schema_metadata
    # Stores inferred types + user overrides
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schema_metadata (
        schema_id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        column_name TEXT NOT NULL,
        inferred_type TEXT NOT NULL,
        user_override_type TEXT,
        null_pct REAL DEFAULT 0,
        unique_pct REAL DEFAULT 0,
        sample_values TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(dataset_id, column_name),
        FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
    );
    """)
    
    # ==================================================================
    # TABLE 3: join_plans
    # Stores user-defined join chains
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS join_plans (
        plan_id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        chain_json TEXT NOT NULL,
        is_sql_mode INTEGER DEFAULT 0,
        sql_query TEXT,
        validated INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(env_id, plan_name)
    );
    """)
    
    # ==================================================================
    # TABLE 4: sql_execution_history
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sql_execution_history (
        execution_id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        sql_query TEXT NOT NULL,
        row_count INTEGER DEFAULT 0,
        execution_time_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # ==================================================================
    # TABLE 5: step_completion_gates
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS step_completion_gates (
        gate_id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        step_name TEXT NOT NULL,
        is_complete INTEGER DEFAULT 0,
        validation_json TEXT,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(env_id, step_name)
    );
    """)
    
    # ==================================================================
    # TABLE 6: golden_dataset_metadata
    # Links Step 0 output to Step 1 input
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS golden_dataset_metadata (
        env_id TEXT PRIMARY KEY,
        source_plan_id TEXT,
        source_datasets TEXT,
        row_count INTEGER DEFAULT 0,
        column_list TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (source_plan_id) REFERENCES join_plans(plan_id) ON DELETE SET NULL
    );
    """)
    
    # ==================================================================
    # TABLE 7: data_readiness (Fix for sqlite3 error)
    # ==================================================================
    cursor.execute("DROP TABLE IF EXISTS data_readiness")
    cursor.execute("""
        CREATE TABLE data_readiness (
            env_id VARCHAR(50) PRIMARY KEY,
            datasets_uploaded BOOLEAN DEFAULT 0,
            schema_confirmed BOOLEAN DEFAULT 0,
            mapping_completed BOOLEAN DEFAULT 0,
            joins_validated BOOLEAN DEFAULT 0,
            is_ready BOOLEAN DEFAULT 0,
            ready_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    conn.commit()
    print("✅ [Migration] Step 0 Data Foundation tables created")

    # ==================================================================
    # TABLE 8: semantic_mappings
    # Used by Step 0 dataset deletion + mapping workflows
    # ==================================================================
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS semantic_mappings (
        mapping_id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        canonical_field TEXT NOT NULL,
        source_column TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(dataset_id, canonical_field),
        FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_semantic_mappings_dataset
    ON semantic_mappings(dataset_id);
    """)

    conn.commit()


def add_percentile_tables(conn):
    """
    Migration: Add percentile and simulation tables (Step 3 & 4)
    """
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS calibration_percentiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        percentile REAL NOT NULL,
        value REAL NOT NULL,
        alert_count INTEGER DEFAULT 0,
        unique_entities INTEGER DEFAULT 0,
        pct_population REAL DEFAULT 0,
        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(run_id, metric_name, percentile),
        FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS threshold_simulations (
        simulation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        threshold_value REAL NOT NULL,
        percentile_label TEXT,
        alerts_triggered INTEGER NOT NULL,
        unique_entities_flagged INTEGER NOT NULL,
        pct_population_flagged REAL NOT NULL,
        high_risk_count INTEGER DEFAULT 0,
        medium_risk_count INTEGER DEFAULT 0,
        low_risk_count INTEGER DEFAULT 0,
        simulated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS selected_thresholds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        threshold_value REAL NOT NULL,
        percentile REAL NOT NULL,
        metric TEXT NOT NULL,
        estimated_alerts INTEGER NOT NULL,
        selected_by TEXT,
        selected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rationale TEXT,
        FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    print("✅ Percentile tables created successfully")


def add_calibration_outcomes_table(conn):
    """
    Migration: Add calibration_outcomes table (Step 4)
    """
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS calibration_outcomes (
        outcome_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        percentile REAL NOT NULL,
        threshold REAL NOT NULL,
        alert_account_ids TEXT,
        alert_customer_ids TEXT,
        summary_json TEXT,
        near_miss_band_json TEXT,
        rationale TEXT,
        approved_by TEXT,
        approved_at TIMESTAMP,
        is_immutable INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    print("✅ calibration_outcomes table created successfully")


def add_str_table(conn):
    """
    Migration: Add STR table for ground truth
    """
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS strs (
        str_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        customer_id TEXT,
        str_filed_date DATE NOT NULL,
        str_amount REAL,
        str_type TEXT,
        investigation_start_date DATE,
        investigation_close_date DATE,
        investigation_outcome TEXT,
        alert_id TEXT,
        scenario_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    conn.commit()
    print("✅ STR table created successfully")


def add_aggregation_cache_table(conn):
    """
    Migration: Add aggregation cache table (Step 2)
    """
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS aggregated_populations_cache (
        run_id TEXT PRIMARY KEY,
        aggregated_df BLOB NOT NULL,
        metadata_json TEXT,
        row_count INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES calibration_runs(run_id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    print("✅ aggregated_populations_cache table created successfully")


def run_migrations(conn):
    """
    Main migration runner
    """
    try:
        print("🔧 Running calibration database migrations...")
        
        # 1. Core Workflow (Must be first for FKs)
        add_core_workflow_tables(conn)
        
        # 2. Step 0 Data Foundation
        add_step0_data_foundation_tables(conn)
        
        # 3. Steps 2, 3, 4
        add_aggregation_cache_table(conn)
        add_percentile_tables(conn)
        add_calibration_outcomes_table(conn)
        add_str_table(conn)
        
        print("✅ All migrations completed successfully")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise
