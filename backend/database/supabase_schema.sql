-- ============================================================================
-- Supabase (PostgreSQL) Schema for AML Investigation System
-- Modules: Core Entities, Sentinel Investigation, MLOps
-- ============================================================================

-- 1. Core Financial & Entity Tables
CREATE TABLE IF NOT EXISTS cases (
    id SERIAL PRIMARY KEY,
    case_id TEXT UNIQUE NOT NULL,
    alert_id TEXT,
    investigator_id TEXT,
    priority TEXT,
    case_status TEXT,
    resolution_days NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    case_open_date TEXT,
    analyst_risk_score NUMERIC,
    docs_requested TEXT,
    customer_contacted TEXT,
    edd_triggered TEXT,
    linked_cases_count INTEGER,
    case_date TEXT,
    case_risk TEXT,
    alert_type TEXT,
    risk_rating TEXT,
    customer_name TEXT,
    customer_id TEXT,
    account_id TEXT,
    risk_score NUMERIC,
    status TEXT,
    fcc_source_run_id TEXT,
    fcc_source_batch_id TEXT,
    fcc_deployment_id TEXT,
    fcc_decision TEXT,
    fcc_reason_code TEXT,
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT,
    fcc_publish_label TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_case_id ON cases(case_id);
CREATE INDEX IF NOT EXISTS idx_cases_customer_id ON cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    alert_id TEXT UNIQUE NOT NULL,
    transaction_id TEXT,
    account_id TEXT,
    rule_triggered TEXT,
    risk_score NUMERIC,
    alert_date TEXT,
    is_true_pos BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acct_alert_count INTEGER,
    alert_hour INTEGER,
    alert_is_weekend BOOLEAN,
    rule_risk_profile NUMERIC,
    case_id TEXT,
    customer_id TEXT,
    alert_score NUMERIC,
    alert_type TEXT,
    amount NUMERIC,
    severity TEXT,
    status TEXT,
    fcc_score NUMERIC,
    fcc_decision TEXT,
    fcc_reason_code TEXT,
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_alert_id ON alerts(alert_id);
CREATE INDEX IF NOT EXISTS idx_alerts_case_id ON alerts(case_id);
CREATE INDEX IF NOT EXISTS idx_alerts_account_id ON alerts(account_id);

CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    transaction_id TEXT UNIQUE NOT NULL,
    account_id TEXT,
    txn_timestamp TIMESTAMP WITH TIME ZONE,
    txn_type TEXT,
    txn_amount NUMERIC,
    currency TEXT,
    narrative TEXT,
    beneficiary_country TEXT,
    channel TEXT,
    ip_address TEXT,
    is_typology BOOLEAN,
    typology_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    txn_hour INTEGER,
    txn_direction TEXT,
    txn_day_of_week TEXT,
    is_weekend BOOLEAN,
    is_off_hours BOOLEAN,
    customer_id TEXT,
    case_id TEXT,
    txn_date TEXT,
    country TEXT,
    counterparty_account TEXT,
    amount NUMERIC,
    direction TEXT,
    fcc_score NUMERIC,
    fcc_decision TEXT,
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_txn_id ON transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);

CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    account_id TEXT UNIQUE NOT NULL,
    customer_id TEXT,
    account_type TEXT,
    account_status TEXT,
    open_date TEXT,
    current_balance NUMERIC,
    currency TEXT,
    num_signatories INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expected_monthly_txn NUMERIC,
    account_risk_rating TEXT,
    num_linked_accounts INTEGER,
    debit_card_issued BOOLEAN,
    internet_banking BOOLEAN,
    account_risk TEXT,
    case_id TEXT,
    risk_rating TEXT,
    status TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_account_id ON accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_customer_id ON accounts(customer_id);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    customer_id TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    nationality TEXT,
    occupation TEXT,
    income_bracket TEXT,
    customer_risk_rating NUMERIC,
    pep_flag BOOLEAN,
    sanction_hit BOOLEAN,
    adverse_media_flag BOOLEAN,
    kyc_completeness_pct NUMERIC,
    days_since_kyc INTEGER,
    onboarding_channel TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    years_as_customer NUMERIC,
    num_products_held INTEGER,
    fatf_high_risk_nationality BOOLEAN,
    cdd_tier TEXT,
    kyc_review_overdue BOOLEAN,
    last_transaction_days_ago INTEGER,
    correspondent_bank_flag BOOLEAN,
    shell_co_indicator BOOLEAN,
    avg_txn NUMERIC,
    state TEXT,
    customer_type TEXT,
    kyc_risk TEXT,
    case_id TEXT,
    risk_rating TEXT,
    segment TEXT,
    country TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_cust_id ON customers(customer_id);

-- 2. Sentinel Investigation Tables
CREATE TABLE IF NOT EXISTS active_case_scope (
    scope_id TEXT PRIMARY KEY,
    case_id TEXT,
    environment_id TEXT,
    set_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    payload JSONB
);

CREATE TABLE IF NOT EXISTS focus_runs (
    run_id TEXT PRIMARY KEY,
    run_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    configuration JSONB,
    total_cases INTEGER,
    included_cases INTEGER,
    excluded_cases INTEGER,
    status TEXT
);

CREATE TABLE IF NOT EXISTS focus_results (
    result_id TEXT PRIMARY KEY,
    run_id TEXT,
    entity_key TEXT,
    entity_type TEXT,
    risk_score NUMERIC,
    bucket TEXT,
    reasons JSONB,
    is_included BOOLEAN,
    alert_count INTEGER,
    critical_count INTEGER,
    last_alert_date TEXT,
    alert_vector JSONB
);

CREATE TABLE IF NOT EXISTS case_queue (
    queue_id TEXT PRIMARY KEY,
    case_id TEXT,
    assigned_to TEXT,
    priority TEXT,
    status TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_status_history (
    id SERIAL PRIMARY KEY,
    case_id TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    changed_by TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    comment TEXT
);

CREATE TABLE IF NOT EXISTS fcc_bridge_imports (
    import_id TEXT PRIMARY KEY,
    publish_id TEXT,
    source_env_id TEXT,
    target_env_id TEXT,
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    run_id TEXT,
    deployment_id TEXT,
    pipeline_id TEXT,
    pipeline_name TEXT,
    publish_label TEXT,
    imported_rows INTEGER,
    replace_existing INTEGER,
    merge_existing INTEGER,
    prepare_investigation_context INTEGER,
    context_profile TEXT,
    source_pipeline_deleted INTEGER,
    source_pipeline_deleted_at TEXT,
    source_pipeline_deleted_reason TEXT,
    generation_mode TEXT
);

CREATE TABLE IF NOT EXISTS fcc_scored_entities (
    id SERIAL PRIMARY KEY,
    alert_id TEXT,
    transaction_id TEXT,
    account_id TEXT,
    customer_id TEXT,
    case_id TEXT,
    risk_score NUMERIC,
    model_score NUMERIC,
    decision TEXT,
    reason_code TEXT,
    top_features JSONB,
    scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT,
    fcc_publish_label TEXT
);

CREATE TABLE IF NOT EXISTS master_case_summary (
    case_id TEXT PRIMARY KEY,
    alert_type TEXT,
    created_at TEXT,
    risk_rating TEXT,
    customer_name TEXT,
    customer_id TEXT,
    account_id TEXT,
    risk_score NUMERIC,
    status TEXT,
    fcc_source_run_id TEXT,
    fcc_source_batch_id TEXT,
    fcc_deployment_id TEXT,
    fcc_decision TEXT,
    fcc_reason_code TEXT,
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT,
    fcc_publish_label TEXT
);

CREATE TABLE IF NOT EXISTS master_cleaned_data (
    case_id TEXT PRIMARY KEY,
    alert_type TEXT,
    created_at TEXT,
    risk_rating TEXT,
    customer_name TEXT,
    customer_id TEXT,
    account_id TEXT,
    risk_score NUMERIC,
    status TEXT,
    fcc_source_run_id TEXT,
    fcc_source_batch_id TEXT,
    fcc_deployment_id TEXT,
    fcc_decision TEXT,
    fcc_reason_code TEXT,
    fcc_pipeline_id TEXT,
    fcc_pipeline_name TEXT,
    fcc_publish_id TEXT,
    fcc_publish_label TEXT
);

-- 3. MLOps Tables
CREATE TABLE IF NOT EXISTS mlops_pipelines (
    pipeline_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT,
    dag_config JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_pipeline_runs (
    run_id TEXT PRIMARY KEY,
    pipeline_id TEXT,
    status TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    metrics JSONB,
    logs TEXT
);

CREATE TABLE IF NOT EXISTS model_registry (
    model_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT, -- staging, production, archived
    framework TEXT,
    metrics JSONB,
    parameters JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlops_drift_log (
    id SERIAL PRIMARY KEY,
    deployment_id TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    feature_drift_score NUMERIC,
    concept_drift_score NUMERIC,
    details JSONB
);

-- Grant permissions to Supabase roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
