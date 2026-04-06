/**
 * mlopsApi.js - AML MLOps Workbench API Client  (Enhanced v3)
 *
 * All existing endpoints preserved for full backward compatibility.
 *
 * New in v3 (Model Training Step 6):
 *   trainModel()        - now accepts grain, hml_high_threshold, hml_low_threshold
 *   hmlRescore()        - re-apply HML band thresholds without retraining
 *   modelInternals()    - tree nodes / coefficients / learning curve per job
 *   ledgerScore()       - score a batch of raw rows and write to scoring ledger
 *   listLedger()        - query scoring ledger with filters + pagination
 */

import apiClient from '@services/api';

const mlopsApi = {

  // ── Dataset management ──────────────────────────────────────────────────────
  uploadDataset: async (datasetType, file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const pipelineId = Number(options?.pipeline_id || 0);
    if (Number.isFinite(pipelineId) && pipelineId > 0) {
      formData.append('pipeline_id', String(pipelineId));
    }
    return apiClient.postForm(`/api/mlops/upload/${encodeURIComponent(String(datasetType))}`, formData);
  },
  listDatasets: async (params = {}) => {
    return apiClient.get('/api/mlops/datasets', params);
  },
  getDataset: async (datasetId) => {
    return apiClient.get(`/api/mlops/datasets/${datasetId}`);
  },
  datasetRows: async (datasetId, params = {}) => {
    return apiClient.get(`/api/mlops/datasets/${datasetId}/rows`, params);
  },
  deleteDataset: async (datasetId) => {
    return apiClient.post(`/api/mlops/datasets/${datasetId}/delete`, {});
  },
  resetDatasets: async (payload = {}) => {
    const query = { delete_files: payload?.delete_files ? 'true' : 'false' };
    const attempts = [
      () => apiClient.get('/api/mlops/datasets/reset', query),
      () => apiClient.post('/api/mlops/datasets/reset', payload),
      () => apiClient.put('/api/mlops/datasets/reset', payload),
    ];
    let lastError = null;
    for (const call of attempts) {
      try {
        return await call();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Reset failed');
  },

  // ── EDA ─────────────────────────────────────────────────────────────────────
  variableStats: async (payload) => {
    return apiClient.post('/api/mlops/variables/stats', payload);
  },
  missingAnalysis: async (payload) => {
    return apiClient.post('/api/eda/missing', payload);
  },
  correlation: async (payload) => {
    return apiClient.post('/api/eda/correlation', payload);
  },
  outliers: async (payload) => {
    return apiClient.post('/api/eda/outliers', payload);
  },
  duplicates: async (payload) => {
    return apiClient.post('/api/eda/duplicates', payload);
  },
  insights: async (payload) => {
    return apiClient.post('/api/eda/insights', payload);
  },

  // ── Metadata ─────────────────────────────────────────────────────────────────
  /**
   * Enhanced profile - returns:
   *   business_narrative, flag_rate, coverage_pct,
   *   unique_entity_count, data_freshness_days, business_signals
   */
  profileMetadata: async (payload) => {
    return apiClient.post('/api/mlops/metadata/profile', payload);
  },

  /**
   * Enhanced schema preview - per-column:
   *   cardinality_ratio, temporal_gaps_detected
   * Top-level: join_key_candidates
   */
  schemaPreview: async (payload) => {
    return apiClient.post('/api/mlops/metadata/schema-preview', payload);
  },

  joinGraph: async (payload) => {
    return apiClient.post('/api/mlops/metadata/join-graph', payload);
  },
  businessBrief: async (payload) => {
    return apiClient.post('/api/mlops/business/brief', payload);
  },

  // ── EDA Advanced ─────────────────────────────────────────────────────────────
  edaOverview: async (payload) => {
    return apiClient.post('/api/eda/overview', payload);
  },
  columnProfile: async (payload) => {
    return apiClient.post('/api/eda/column-profile', payload);
  },
  qualityScore: async (payload) => {
    return apiClient.post('/api/eda/quality-score', payload);
  },
  featureTarget: async (payload) => {
    return apiClient.post('/api/eda/feature-target', payload);
  },
  featureSelectionWorkbench: async (payload) => {
    return apiClient.post('/api/eda/feature-selection-workbench', payload);
  },
  leakageChecks: async (payload) => {
    return apiClient.post('/api/eda/leakage', payload);
  },
  pairplot: async (payload) => {
    return apiClient.post('/api/eda/pairplot', payload);
  },
  interactionHeatmap: async (payload) => {
    return apiClient.post('/api/eda/interaction-heatmap', payload);
  },
  bivariateCategorical: async (payload) => {
    return apiClient.post('/api/eda/bivariate-categorical', payload);
  },
  segmentTarget: async (payload) => {
    return apiClient.post('/api/eda/segment-target', payload);
  },
  timeTrend: async (payload) => {
    return apiClient.post('/api/eda/time-trend', payload);
  },
  distributionCompare: async (payload) => {
    return apiClient.post('/api/eda/distribution-compare', payload);
  },

  // ── Target Variable ───────────────────────────────────────────────────────────
  edaChartExplain: async (payload) => {
    const attempts = [
      '/api/eda/ai-chart-explain',
      '/api/eda/ai-chart-explain/',
      '/api/mlops/ai-chart-explain',
      '/api/mlops/ai-chart-explain/',
    ];
    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const path = attempts[index];
      try {
        return await apiClient.post(path, payload);
      } catch (error) {
        lastError = error;
        const msg = String(error?.message || '').toLowerCase();
        const retriable = msg.includes('method not allowed') || msg.includes('not found');
        if (!retriable || index === attempts.length - 1) {
          throw error;
        }
      }
    }
    throw lastError || new Error('EDA chart explanation failed');
  },

  detectTarget: async (payload) => {
    return apiClient.post('/api/mlops/target/detect', payload);
  },
  deriveTarget: async (payload) => {
    return apiClient.post('/api/mlops/target/derive', payload);
  },
  generateStr: async (payload = {}) => {
    return apiClient.post('/api/mlops/target/generate-str', payload || {});
  },
  saveStrRules: async (payload) => {
    return apiClient.post('/api/mlops/target/str-rules', payload);
  },

  // ── Preprocessing ─────────────────────────────────────────────────────────────
  preprocessPlan: async (payload) => {
    return apiClient.post('/api/mlops/preprocess/plan', payload);
  },
  preprocessPreview: async (payload) => {
    return apiClient.post('/api/mlops/preprocess/preview', payload);
  },
  preprocessRun: async (payload) => {
    return apiClient.post('/api/mlops/preprocess/run', payload);
  },
  preprocessMasterBuild: async (payload) => {
    return apiClient.post('/api/mlops/preprocess/master-build', payload);
  },
  masterPreview: async (payload) => {
    return apiClient.post('/api/mlops/preprocess/master-preview', payload);
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────────

  /**
   * Save a full pipeline definition.
   *
   * Payload: {
   *   name, description?, grain, anchor_dataset_id, dataset_ids,
   *   joins, transforms, str_config, schedule, output_name, version,
   *   created_by_persona
   * }
   */
  pipelineSave: async (payload) => {
    return apiClient.post('/api/mlops/pipeline/save', payload);
  },

  /** Trigger an async pipeline run. Returns { job_id } with 202. */
  pipelineRun: async (pipelineId, options = {}) => {
    return apiClient.post(`/api/mlops/pipeline/${pipelineId}/run`, options);
  },

  /** Poll pipeline run status. */
  pipelineRunStatus: async (pipelineId, runId = null) => {
    const qs = runId ? `?run_id=${runId}` : '';
    return apiClient.get(`/api/mlops/pipeline/${pipelineId}/status${qs}`);
  },

  /** List saved pipelines for an anchor dataset (or all). */
  pipelineList: async (datasetId) => {
    return apiClient.get('/api/mlops/pipeline/list', { dataset_id: datasetId });
  },

  /** Load one saved pipeline definition. */
  pipelineGet: async (pipelineId) => {
    return apiClient.get(`/api/mlops/pipeline/${pipelineId}`);
  },

  /** Fetch the canonical workflow manifest for one FCC run. */
  pipelineManifest: async (pipelineId) => {
    return apiClient.get(`/api/mlops/pipeline/${pipelineId}/manifest`);
  },

  /** Rename one saved pipeline without creating a duplicate. */
  pipelineRename: async (pipelineId, name) => {
    return apiClient.post(`/api/mlops/pipeline/${pipelineId}/rename`, { name });
  },

  /** Save lightweight screen state for autosave and resume. */
  pipelineSaveScreenState: async (pipelineId, payload) => {
    return apiClient.post(`/api/mlops/pipeline/${pipelineId}/screen-state`, payload);
  },

  /** Fetch pipeline version history. */
  pipelineVersions: async (pipelineId) => {
    return apiClient.get(`/api/mlops/pipeline/${pipelineId}/versions`);
  },

  /** Set or update schedule for a pipeline. */
  pipelineSchedule: async (pipelineId, schedule) => {
    return apiClient.post(`/api/mlops/pipeline/${pipelineId}/schedule`, schedule);
  },

  /** Delete one pipeline and (optionally) its generated artefacts. */
  pipelineDeleteImpact: async (pipelineId) => {
    return apiClient.get(`/api/mlops/pipeline/${pipelineId}/delete-impact`);
  },

  /** Delete one pipeline and (optionally) its generated artefacts. */
  pipelineDelete: async (pipelineId, options = {}) => {
    const params = new URLSearchParams();
    if (Object.prototype.hasOwnProperty.call(options, 'delete_artifacts')) {
      params.set('delete_artifacts', options.delete_artifacts ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'delete_files')) {
      params.set('delete_files', options.delete_files ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'sentinel_action')) {
      params.set('sentinel_action', String(options.sentinel_action || 'keep'));
    }
    const qs = params.toString();
    return apiClient.delete(`/api/mlops/pipeline/${pipelineId}${qs ? `?${qs}` : ''}`);
  },

  /** Legacy pipeline preview (unchanged). */
  pipelinePreview: async (payload) => {
    return apiClient.post('/api/mlops/pipeline/preview', payload);
  },

  // ── Jobs & Snapshots ──────────────────────────────────────────────────────────
  createSnapshot: async (payload) => {
    return apiClient.post('/api/mlops/snapshots/create', payload);
  },
  listSnapshots: async () => {
    return apiClient.get('/api/mlops/snapshots');
  },

  // ── Model Training (Step 6) ───────────────────────────────────────────────────

  /**
   * Submit a model training job.
   *
   * Payload (all existing fields unchanged):
   *   dataset_id      int      required
   *   target_column   str      optional (auto-detected)
   *   algorithm       str      default "random_forest"
   *   hyperparams     object   default {}
   *   test_size       float    default 0.2
   *   cv_folds        int      default 5
   *   stratify        bool     default true
   *   random_state    int      default 42
   *
   * New v3 fields (all optional):
   *   grain               "alert" | "case"   default "alert"
   *     - "alert":  1 row = 1 AML alert.  Target = IS_TRUE_POS.   ID = ALERT_ID.
   *     - "case":   1 row = 1 case file.  Target = CASE_STATUS.   ID = CASE_ID.
   *   hml_high_threshold  float  default 0.65
   *     - P(TP) ≥ this → HIGH  (immediate escalation)
   *   hml_low_threshold   float  default 0.35
   *     - P(TP) < this → LOW   (auto-suppress)
   *     - Between low and high → MEDIUM (human review queue)
   *
   * Returns: { job_id, status: "pending", grain, hml_high_threshold, hml_low_threshold }
   */
  trainModel: async (payload) => {
    return apiClient.post('/api/model-training/train', payload);
  },

  trainingWorkbenchPreview: async (payload) => {
    return apiClient.post('/api/model-training/workbench/preview', payload);
  },

  /** Poll training job status. */
  jobStatus: async (jobId) => {
    return apiClient.get(`/api/model-training/status/${jobId}`);
  },

  /**
   * Get full training results for a completed job.
   *
   * Result now includes:
   *   grain               "alert" | "case"
   *   id_column           "ALERT_ID" | "CASE_ID"
   *   hml_high_threshold  float
   *   hml_low_threshold   float
   *   hml_summary         { high, medium, low, total_event_loss_pct, ... }
   *   model_internals     { viz_type, data, description }
   *   metrics             { roc_auc, f1, ..., threshold_table, roc_curve, pr_curve }
   *   feature_importance  [{ feature, importance }]
   *   feature_diagnostics { dropped_id_columns, ... }
   */
  modelResults: async (jobId) => {
    return apiClient.get(`/api/model-training/results/${jobId}`);
  },

  /**
   * Re-apply a binary classification threshold (no retraining).
   * Returns updated confusion_matrix, precision, recall, f1, accuracy, specificity,
   * balanced_accuracy, suppression_rate_pct, event_loss_pct.
   */
  thresholdScore: async (payload) => {
    return apiClient.post('/api/model-training/threshold', payload);
  },

  /**
   * Re-apply HML band thresholds to stored test-set predictions (no retraining).
   *
   * Body:  { job_id, high_threshold, low_threshold }
   * Returns: hml_summary with per-band counts + event_loss_pct
   *
   * Use this to live-preview the effect of moving the HIGH/LOW sliders in the
   * Evaluate tab without submitting a new training job.
   */
  hmlRescore: async (payload) => {
    return apiClient.post('/api/model-training/hml/rescore', payload);
  },

  /**
   * Get model internals for a completed training run.
   *
   * Returns algorithm-specific visualization data:
   *
   *   decision_tree       → viz_type: "tree"
   *     data: [{ node_id, depth, is_leaf, feature, threshold, samples,
   *              majority, label, left_child, right_child }]
   *
   *   logistic_regression / linear_svm / naive_bayes → viz_type: "coefficients"
   *     data: [{ feature, coef }]   (sorted by |coef| descending)
   *
   *   gradient_boosting / xgboost / lightgbm / adaboost → viz_type: "learning_curve"
   *     data: [{ round, train, val }]
   *
   *   random_forest / extra_trees / knn / hist_gradient_boosting →
   *     viz_type: "feature_importance"
   *     data: [{ feature, importance }]   (normalised, sum = 1)
   */
  modelInternals: async (jobId) => {
    return apiClient.get(`/api/model-training/internals/${jobId}`);
  },

  /**
   * Score a batch of raw alert/case records using a trained model and
   * write every result to the scoring ledger for audit purposes.
   *
   * Body:
   *   job_id              str    required  (training job whose model to use)
   *   rows                array  required  (raw records including ID column)
   *   grain               str    "alert" | "case"  default "alert"
   *   hml_high_threshold  float  default 0.65
   *   hml_low_threshold   float  default 0.35
   *
   * The ID column (ALERT_ID / CASE_ID) is extracted BEFORE inference and
   * re-attached AFTER - it is NEVER passed to the model as a feature.
   *
   * Returns:
   *   scored      array  [{ entity_id, probability, hml_decision, ... }]
   *   hml_counts  object { HIGH: n, MEDIUM: n, LOW: n }
   *   total_scored int
   */
  ledgerScore: async (payload) => {
    return apiClient.post('/api/model-training/ledger/score', payload);
  },

  /**
   * Query the scoring ledger with optional filters and pagination.
   *
   * Params (all optional):
   *   job_id        Filter to one training run
   *   grain         "alert" | "case"
   *   hml_decision  "HIGH" | "MEDIUM" | "LOW"
   *   entity_id     Substring search on ALERT_ID / CASE_ID
   *   limit         Max rows (default 200, max 2000)
   *   offset        Pagination offset (default 0)
   *
   * Returns:
   *   rows   array  [{ ledger_id, job_id, entity_id, probability,
   *                    hml_decision, model_version, scored_at, ... }]
   *   total  int    total matching rows (for pagination)
   */
  listLedger: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined))
    ).toString();
    return apiClient.get(`/api/model-training/ledger${qs ? '?' + qs : ''}`);
  },

  /** Run + retrieve the validation optimisation report. */
  validationReport: async (payload) => {
    return apiClient.post('/api/model-training/validation/report', payload);
  },

  /** Multi-model validation compare for workbench. */
  validationCompare: async (payload) => {
    return apiClient.post('/api/model-training/validation/compare', payload);
  },

  /** Compact validation visuals for score distribution and richer dashboards. */
  validationDetail: async (jobId, params = {}) => {
    return apiClient.get(`/api/model-training/validation/detail/${jobId}`, params);
  },

  /** Deterministic-first validation explanation with optional local LLM rewrite. */
  validationExplain: async (payload) => {
    return apiClient.post('/api/model-training/validation/explain', payload);
  },

  /** Business-first release summary with optional local LLM rewrite. */
  releaseBusinessSummary: async (payload) => {
    return apiClient.post('/api/model-training/release/business-summary', payload);
  },

  /** List all training runs (optionally filtered by dataset_id). */
  listTrainingRuns: async (params = {}) => {
    return apiClient.get('/api/model-training/runs', params);
  },

  /** List all registered models. */
  listModelRegistry: async () => {
    return apiClient.get('/api/model-training/registry');
  },

  /** Upload an external .pkl model and register it in the model registry. */
  uploadModelPkl: async (formData) => {
    return apiClient.postForm('/api/model-training/registry/upload-pkl', formData);
  },

  /** Fetch model registry stage-change audit history. */
  registryAuditLog: async (params = {}) => {
    return apiClient.get('/api/model-training/registry/audit-log', params);
  },

  /**
   * Register a completed model in the registry.
   *
   * Body (all existing fields unchanged + new v3):
   *   job_id, model_name, stage, selected_threshold, max_event_loss_pct,
   *   validation, tags, notes
   *   grain, hml_high_threshold, hml_low_threshold   (new v3, optional)
   */
  registerModel: async (payload) => {
    return apiClient.post('/api/model-training/registry/register', payload);
  },

  /** Promote / demote a registry entry. */
  updateRegistryStage: async (jobId, payload) => {
    return apiClient.post(`/api/model-training/registry/${jobId}/stage`, payload);
  },

  /** PUT-style stage update contract compatibility. */
  updateRegistryStagePut: async (payload) => {
    return apiClient.put('/api/model-training/registry/stage', payload);
  },

  /** Export model card + base64-encoded pkl artefact. */
  exportModel: async (payload) => {
    return apiClient.post('/api/model-training/export', payload);
  },

  /** Side-by-side comparison of multiple training runs. */
  compareRuns: async (payload) => {
    return apiClient.post('/api/model-training/compare', payload);
  },

  /** Workbench summary for validation overview. */
  workbenchSummary: async () => {
    return apiClient.get('/api/model-training/workbench/summary');
  },

  /** Promote a model to champion (demotes current champion). */
  workbenchChampion: async (payload) => {
    return apiClient.post('/api/model-training/workbench/champion', payload);
  },

  /** Bulk label mapping for workbench display names. */
  workbenchBulkLabel: async (payload) => {
    return apiClient.post('/api/model-training/workbench/bulk-label', payload);
  },

  /** Fetch label map for workbench. */
  workbenchLabels: async () => {
    return apiClient.get('/api/model-training/workbench/labels');
  },

  /**
   * Deploy a trained model.
   * Response now includes grain, hml_high_threshold, hml_low_threshold, id_column.
   */
  deployModel: async (jobId, threshold, extras = {}) => {
    return apiClient.post('/api/model-training/deploy', { job_id: jobId, threshold, ...extras });
  },

  /** Current active deployment for this environment. */
  getActiveDeployment: async () => {
    return apiClient.get('/api/model-training/deployments/active');
  },

  /** Deployment version history for this environment. */
  listDeploymentHistory: async () => {
    return apiClient.get('/api/model-training/deployments/history');
  },

  /** Swap active deployment to a new model run. */
  swapDeployment: async (payload) => {
    return apiClient.post('/api/model-training/deployments/swap', payload);
  },

  /** Roll back active deployment to previous deployment. */
  rollbackDeployment: async (payload = {}) => {
    return apiClient.post('/api/model-training/deployments/rollback', payload);
  },

  /** Dataset before/after preprocessing preview. */
  preprocessBeforeAfter: async (params) => {
    return apiClient.get('/api/model-training/preprocess/before-after', params);
  },

  // -- Run Reports --
  generateReport: async (payload) => {
    return apiClient.post('/api/mlops/report/generate', payload);
  },
  getReport: async (runId) => {
    return apiClient.get(`/api/mlops/report/${encodeURIComponent(String(runId))}`);
  },
  listReports: async (params = {}) => {
    return apiClient.get('/api/mlops/reports', params);
  },
  compareReports: async (runIdA, runIdB) => {
    return apiClient.get('/api/mlops/reports/compare', {
      run_id_a: runIdA,
      run_id_b: runIdB,
    });
  },
  downloadReportPdf: async (payload) => {
    return apiClient.post('/api/mlops/report/pdf', payload, { responseType: 'blob' });
  },

  // ── Legacy model endpoints (backward compatibility) ────────────────────────────
  evaluateModel: async (payload) => {
    return apiClient.post('/api/mlops/model/evaluate', payload);
  },
  tuneModelThreshold: async (payload) => {
    return apiClient.post('/api/mlops/model/threshold-tune', payload);
  },
  listModelRuns: async (datasetId = null) => {
    if (datasetId == null) return apiClient.get('/api/mlops/model/runs');
    return apiClient.get('/api/mlops/model/runs', { dataset_id: datasetId });
  },
  getModelRun: async (runId) => {
    return apiClient.get(`/api/mlops/model/runs/${runId}`);
  },

  // ── Deployment Dashboard (Step 10) ─────────────────────────────────────────────
  scoreBatch: async (payload) => {
    return apiClient.post('/api/deployment-dashboard/score-batch', payload);
  },
  publishToSentinel: async (payload = {}) => {
    return apiClient.publishFccBatch(payload);
  },
  importSentinelPublishedRun: async (payload = {}) => {
    return apiClient.importFccPublishedRun(payload);
  },
  listScoredBatches: async (params = {}) => {
    return apiClient.listFccScoredBatches(params);
  },
  listSentinelPublishedRuns: async (params = {}) => {
    return apiClient.listFccPublishedRuns(params);
  },
  getWorkflowSession: async (params = {}) => {
    return apiClient.getFccWorkflowSession(params);
  },
  saveWorkflowSession: async (payload = {}) => {
    return apiClient.saveFccWorkflowSession(payload);
  },
  deleteWorkflowSession: async (sessionId) => {
    return apiClient.deleteFccWorkflowSession(sessionId);
  },
  handoffToSentinel: async (payload = {}) => {
    return apiClient.handoffFccToSentinel(payload);
  },
  liveSimulate: async (payload) => {
    return apiClient.post('/api/deployment-dashboard/live-simulate', payload);
  },
  deploymentKpis: async ({
    deployment_id,
    run_id = null,
    model_grain = null,
    n_weeks = 8,
    include_simulation = false,
  }) => {
    const params = new URLSearchParams({
      deployment_id,
      n_weeks: String(n_weeks),
      include_simulation: include_simulation ? '1' : '0',
    });
    if (run_id) params.set('run_id', String(run_id));
    if (model_grain) params.set('model_grain', String(model_grain));
    return apiClient.get(`/api/deployment-dashboard/kpis?${params.toString()}`);
  },
  suppressionLedger: async (queryString, options = {}) => {
    const params = new URLSearchParams(queryString || '');
    if (Object.prototype.hasOwnProperty.call(options, 'include_simulation')) {
      params.set('include_simulation', options.include_simulation ? '1' : '0');
    }
    return apiClient.get(`/api/deployment-dashboard/ledger?${params.toString()}`);
  },
  deploymentDrift: async ({
    deployment_id,
    n_weeks = 8,
    run_id = null,
    model_grain = null,
    include_simulation = false,
  }) => {
    const params = new URLSearchParams({
      deployment_id,
      n_weeks: String(n_weeks),
      include_simulation: include_simulation ? '1' : '0',
    });
    if (run_id) params.set('run_id', String(run_id));
    if (model_grain) params.set('model_grain', String(model_grain));
    return apiClient.get(`/api/deployment-dashboard/drift?${params.toString()}`);
  },
  modelLineage: async (payload) => {
    return apiClient.post('/api/deployment-dashboard/model-lineage', payload);
  },
  alertVsCase: async ({
    deployment_id,
    run_id = null,
    model_grain = null,
    include_simulation = false,
  }) => {
    const params = new URLSearchParams({
      deployment_id,
      include_simulation: include_simulation ? '1' : '0',
    });
    if (run_id) params.set('run_id', String(run_id));
    if (model_grain) params.set('model_grain', String(model_grain));
    return apiClient.get(`/api/deployment-dashboard/alert-vs-case?${params.toString()}`);
  },
  eventLossTrend: async ({
    deployment_id,
    n_weeks = 8,
    run_id = null,
    model_grain = null,
    include_simulation = false,
  }) => {
    const params = new URLSearchParams({
      deployment_id,
      n_weeks: String(n_weeks),
      include_simulation: include_simulation ? '1' : '0',
    });
    if (run_id) params.set('run_id', String(run_id));
    if (model_grain) params.set('model_grain', String(model_grain));
    return apiClient.get(`/api/deployment-dashboard/event-loss-trend?${params.toString()}`);
  },
  inferenceExplain: async (payload) => {
    return apiClient.post('/api/deployment-dashboard/inference-explain', payload);
  },

};

export default mlopsApi;
