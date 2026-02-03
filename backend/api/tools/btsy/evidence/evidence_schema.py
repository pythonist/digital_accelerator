from __future__ import annotations


CORE_TABLE_DDL = [
    """
    CREATE TABLE IF NOT EXISTS calibration_run (
      run_id INTEGER PRIMARY KEY,
      scenario_id TEXT,
      mode TEXT,
      snapshot_id TEXT,
      config_hash TEXT,
      engine_version TEXT,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      status TEXT,
      triggered_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS calibration_step_run (
      run_id INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      step_name TEXT,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      status TEXT,
      input_tables TEXT,
      output_tables TEXT,
      config_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS calibration_step_artifact (
      run_id INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      table_name TEXT,
      metadata_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS calibration_inference (
      run_id INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      inference_type TEXT NOT NULL,
      input_metrics_json TEXT,
      inference_text TEXT NOT NULL,
      generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
]


SUPPORT_TABLE_DDL = [
    """
    CREATE TABLE IF NOT EXISTS calibration_metric (
      run_id INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      metric_value DOUBLE,
      metric_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS calibration_chart_series (
      run_id INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      chart_key TEXT NOT NULL,
      series_key TEXT NOT NULL,
      x_value TEXT,
      y_value DOUBLE,
      metadata_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
]

