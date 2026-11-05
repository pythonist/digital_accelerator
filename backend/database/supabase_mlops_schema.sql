-- ============================================================================
-- Supabase (PostgreSQL) Schema for MLOps Workbench
-- Prefixed: mlops_*
-- High-concurrency state preservation, resumable steps, checkpoints, & telemetry
-- ============================================================================

-- 1. Pipeline Definition & Versioning
CREATE TABLE IF NOT EXISTS mlops_pipelines (
    pipeline_id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_type TEXT DEFAULT 'fcc',
    model_family TEXT,
    dataset_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    steps_json JSONB,
    prediction_grain TEXT,
    lookback_days INTEGER,
    lookforward_days INTEGER,
    target_definition_type TEXT,
    pipeline_config_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_versions (
    version_id TEXT PRIMARY KEY,
    pipeline_id TEXT REFERENCES mlops_pipelines(pipeline_id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot_json JSONB,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Pipeline Execution & Step-by-Step DAG Runs
CREATE TABLE IF NOT EXISTS mlops_pipeline_runs_v2 (
    pipeline_uuid TEXT PRIMARY KEY,
    legacy_pipeline_id INTEGER,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_type TEXT DEFAULT 'fcc',
    model_family TEXT,
    name TEXT,
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'draft', -- draft, running, completed, failed, stale
    pipeline_config_json JSONB,
    runtime_state_json JSONB,
    current_step_code TEXT,
    current_step_order INTEGER,
    created_by_persona TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_run_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_steps_v2 (
    step_id TEXT PRIMARY KEY,
    pipeline_uuid TEXT REFERENCES mlops_pipeline_runs_v2(pipeline_uuid) ON DELETE CASCADE,
    legacy_pipeline_id INTEGER,
    step_order INTEGER,
    step_code TEXT NOT NULL,
    step_name TEXT NOT NULL,
    prev_step_id TEXT,
    status TEXT DEFAULT 'not_started', -- not_started, running, completed, stale, failed
    config_json JSONB,
    input_refs_json JSONB,
    output_refs_json JSONB,
    artifact_refs_json JSONB,
    state_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlops_steps_pipeline ON mlops_pipeline_steps_v2(pipeline_uuid);
CREATE INDEX IF NOT EXISTS idx_mlops_steps_code ON mlops_pipeline_steps_v2(step_code);

-- 3. Resumable Workflow Sessions & Checkpoints (Close & Resume application state)
CREATE TABLE IF NOT EXISTS mlops_workflow_sessions (
    session_id TEXT PRIMARY KEY,
    journey_key TEXT,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_type TEXT DEFAULT 'fcc',
    pipeline_id TEXT,
    pipeline_name TEXT,
    run_id TEXT,
    deployment_id TEXT,
    publish_id TEXT,
    current_module TEXT,
    current_step TEXT,
    current_state_json JSONB,
    last_stable_step TEXT,
    last_stable_state_json JSONB,
    case_scope_json JSONB,
    selected_case_id TEXT,
    handoff_summary_json JSONB,
    checkpoint_key TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_step_events (
    event_id SERIAL PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_id TEXT,
    session_id TEXT,
    screen TEXT,
    step_id TEXT,
    event_type TEXT,
    status TEXT,
    checkpoint_key TEXT,
    state_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_run_state (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_id BIGINT,
    pipeline_uuid TEXT,
    pipeline_name TEXT,
    pipeline_type TEXT DEFAULT 'fcc',
    status TEXT DEFAULT 'running',
    current_step TEXT,
    steps_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS mlops_run_state_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES mlops_run_state(run_id) ON DELETE CASCADE,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_id BIGINT,
    step_name TEXT,
    event_type TEXT,
    status TEXT,
    input_signature TEXT,
    output_signature TEXT,
    payload_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Datasets, Snapshots & Target Definitions
CREATE TABLE IF NOT EXISTS mlops_dataset_registry (
    dataset_id SERIAL PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_type TEXT DEFAULT 'fcc',
    dataset_type TEXT,
    filename TEXT,
    file_path TEXT,
    row_count BIGINT,
    columns_json JSONB,
    column_types_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_snapshots (
    snapshot_id SERIAL PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    name TEXT,
    dataset_id INTEGER,
    payload_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_targets (
    target_id SERIAL PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    dataset_id INTEGER,
    name TEXT,
    strategy TEXT,
    config_json JSONB,
    summary_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Artifacts, Metrics & Models
CREATE TABLE IF NOT EXISTS mlops_pipeline_artifacts_v2 (
    artifact_id TEXT PRIMARY KEY,
    pipeline_uuid TEXT,
    legacy_pipeline_id INTEGER,
    step_id TEXT,
    artifact_type TEXT,
    artifact_role TEXT,
    storage_backend TEXT,
    storage_path TEXT,
    schema_json JSONB,
    row_count INTEGER,
    column_count INTEGER,
    checksum TEXT,
    metrics_json JSONB,
    metadata_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_metrics_v2 (
    metric_id TEXT PRIMARY KEY,
    pipeline_uuid TEXT,
    legacy_pipeline_id INTEGER,
    model_id TEXT,
    metric_name TEXT,
    metric_value NUMERIC,
    metric_group TEXT,
    metrics_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_asset_links (
    link_id SERIAL PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    pipeline_id TEXT,
    asset_kind TEXT,
    asset_id TEXT,
    stage TEXT,
    relation TEXT,
    metadata_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_model_runs (
    run_id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    dataset_id INTEGER,
    target_column TEXT,
    algorithm TEXT,
    feature_columns_json JSONB,
    metrics_json JSONB,
    threshold_metrics_json JSONB,
    test_truth_json JSONB,
    test_prob_json JSONB,
    selected_threshold NUMERIC,
    artifact_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_model_registry (
    model_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT DEFAULT 'staging', -- staging, production, champion, challenger, archived
    framework TEXT,
    metrics JSONB,
    parameters JSONB,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_model_registry_audit (
    id SERIAL PRIMARY KEY,
    model_id TEXT,
    action TEXT,
    actor TEXT,
    details JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Deployments, Monitoring & Reports
CREATE TABLE IF NOT EXISTS mlops_deployments (
    deployment_id TEXT PRIMARY KEY,
    run_id TEXT,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    threshold NUMERIC,
    bundle_path TEXT,
    model_card_path TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_suppression_ledger (
    id SERIAL PRIMARY KEY,
    deployment_id TEXT,
    rule_name TEXT,
    suppression_criteria JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_run_reports (
    report_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    pipeline_id TEXT,
    tenant_id TEXT DEFAULT 'default',
    env_id TEXT DEFAULT 'default',
    report_json JSONB,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    run_type TEXT
);

CREATE TABLE IF NOT EXISTS mlops_jobs (
    job_id TEXT PRIMARY KEY,
    kind TEXT,
    status TEXT,
    payload_json JSONB,
    result_json JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS mlops_cache (
    cache_key TEXT PRIMARY KEY,
    result_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Grant privileges to Supabase roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
