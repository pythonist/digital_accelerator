const safeLower = (value) => String(value || '').trim().toLowerCase();

const asArray = (value) => (Array.isArray(value) ? value : []);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const MANIFEST_STAGE_KEYS = ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry', 'ready', 'dashboard', 'reports'];
const RUN_STATE_TO_STAGE = {
  data_upload: 'data',
  master_dataset: 'master',
  target_definition: 'target',
  explore_data: 'eda',
  feature_store: 'featurestore',
  preprocessing: 'preprocess',
  model_training: 'model',
  validation: 'validation',
  model_release: 'registry',
  deployment_monitoring: 'dashboard',
  reports: 'reports',
};

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const getScreenStateStep = (steps, screenKey) => {
  const key = safeLower(screenKey);
  return asArray(steps).find((step) => (
    safeLower(step?.type) === 'screen_state'
    && safeLower(step?.screen) === key
    && isObject(step?.state)
  )) || null;
};

export const getScreenState = (steps, screenKey) => {
  return getScreenStateStep(steps, screenKey)?.state || null;
};

export const upsertScreenState = (steps, screenKey, state) => {
  const key = safeLower(screenKey);
  const next = asArray(steps).filter((step) => {
    return !(safeLower(step?.type) === 'screen_state' && safeLower(step?.screen) === key);
  });
  next.push({
    type: 'screen_state',
    screen: key,
    state: isObject(state) ? state : {},
  });
  return next;
};

export const mergeDatasetIds = (existingIds, payloadIds, payloadDatasetId) => {
  const merged = new Set();
  asArray(existingIds).forEach((id) => {
    const n = toNumberOrNull(id);
    if (n) merged.add(n);
  });
  asArray(payloadIds).forEach((id) => {
    const n = toNumberOrNull(id);
    if (n) merged.add(n);
  });
  const single = toNumberOrNull(payloadDatasetId);
  if (single) merged.add(single);
  return Array.from(merged);
};

export const mergePipelinePayload = ({
  existingPipeline,
  payload,
  screenKey,
  currentState,
}) => {
  const existing = isObject(existingPipeline) ? existingPipeline : {};
  const next = isObject(payload) ? { ...payload } : {};

  const mergedSteps = upsertScreenState(
    asArray(existing.steps),
    screenKey,
    currentState,
  );

  const payloadSteps = asArray(next.steps).filter((step) => safeLower(step?.type) !== 'screen_state');
  next.steps = [...mergedSteps, ...payloadSteps];

  const mergedDatasetIds = mergeDatasetIds(
    existing.dataset_ids,
    next.dataset_ids,
    next.dataset_id || existing.dataset_id,
  );
  if (mergedDatasetIds.length > 0) {
    next.dataset_ids = mergedDatasetIds;
  }

  next.pipeline_id = toNumberOrNull(next.pipeline_id || existing.pipeline_id);
  if (existing.pipeline_uuid && !next.pipeline_uuid) {
    next.pipeline_uuid = existing.pipeline_uuid;
  }
  next.pipeline_type = next.pipeline_type || existing.pipeline_type || existing.model_family || 'fcc';
  next.model_family = next.model_family || existing.model_family || existing.pipeline_type || next.pipeline_type;
  next.dataset_id = toNumberOrNull(next.dataset_id || existing.dataset_id) || 0;
  next.grain = next.grain || existing.grain || 'transaction';
  next.anchor_dataset_id = toNumberOrNull(next.anchor_dataset_id || existing.anchor_dataset_id);
  next.joins = asArray(next.joins).length ? next.joins : asArray(existing.joins);
  next.transforms = asArray(next.transforms).length ? next.transforms : asArray(existing.transforms);
  next.str_config = isObject(next.str_config) ? next.str_config : (existing.str_config || {});
  next.schedule = isObject(next.schedule) ? next.schedule : (existing.schedule || {});
  next.output_name = next.output_name || existing.output_name || 'master_dataset';
  next.created_by_persona = next.created_by_persona || existing.created_by_persona || 'technical';

  return next;
};

export const findPipelineByName = (pipelines, name) => {
  const needle = safeLower(name);
  if (!needle) return null;
  return asArray(pipelines).find((pipeline) => safeLower(pipeline?.name) === needle) || null;
};

export const getWorkflowManifest = (pipeline) => (
  isObject(pipeline?.workflow_manifest) ? pipeline.workflow_manifest : null
);

export const getManifestStepState = (pipeline, stepKey) => {
  const manifest = getWorkflowManifest(pipeline);
  const key = safeLower(stepKey);
  if (!manifest || !isObject(manifest.steps)) return null;
  const step = manifest.steps[key];
  return isObject(step) ? step : null;
};

export const getRunState = (pipeline) => (
  isObject(pipeline?.run_state) ? pipeline.run_state : null
);

const deriveRunStateStepStatuses = (pipeline) => {
  const runState = getRunState(pipeline);
  const explicitStatuses = isObject(runState?.ui_step_statuses) ? runState.ui_step_statuses : {};
  const statuses = {};
  Object.entries(explicitStatuses).forEach(([stage, status]) => {
    const key = safeLower(stage);
    if (!key) return;
    statuses[key] = safeLower(status) === 'stale' ? 'invalidated' : safeLower(status || 'not_started');
  });

  const steps = isObject(runState?.steps_json) ? runState.steps_json : isObject(runState?.steps) ? runState.steps : {};
  Object.entries(steps).forEach(([stepName, record]) => {
    const stage = RUN_STATE_TO_STAGE[safeLower(stepName)];
    if (!stage || !isObject(record)) return;
    const status = safeLower(record.status || 'not_started');
    statuses[stage] = status === 'stale' ? 'invalidated' : status;
  });

  return Object.keys(statuses).length ? statuses : null;
};

const deriveLegacyPipelineStepCompletion = (pipeline) => {
  const staleSet = new Set(asArray(pipeline?.stale_steps).map((step) => safeLower(step)));
  const steps = asArray(pipeline?.steps);
  const edaState = getScreenState(steps, 'eda');
  const modelState = getScreenState(steps, 'model');
  const validationState = getScreenState(steps, 'validation');
  const registryState = getScreenState(steps, 'registry');
  const dashboardState = getScreenState(steps, 'dashboard');
  const journeyState = getScreenState(steps, 'workbench_journey');
  const has = (screenKey) => Boolean(getScreenState(steps, screenKey));
  const completion = {
    data: has('data_upload'),
    master: has('master'),
    target: has('target'),
    eda: Boolean(edaState?.completed || edaState?.done || edaState?.status === 'completed'),
    preprocess: has('preprocess'),
    model: Boolean(modelState?.job_id || validationState?.job_id || registryState?.job_id || dashboardState?.run_id || has('model')),
    validation: Boolean(validationState?.job_id || validationState?.report_id || has('validation')),
    registry: Boolean(registryState?.job_id || registryState?.deployment_id || has('registry')),
    dashboard: Boolean(dashboardState?.deployment_id || dashboardState?.run_id || has('dashboard')),
    reports: Boolean(journeyState?.run_status === 'complete' || dashboardState?.deployment_id),
  };
  return {
    ...completion,
    staleSet,
  };
};

export const derivePipelineStepStatuses = (pipeline) => {
  const runStateStatuses = deriveRunStateStepStatuses(pipeline);
  if (runStateStatuses) {
    return MANIFEST_STAGE_KEYS.reduce((acc, key) => {
      acc[key] = runStateStatuses[key] || 'not_started';
      return acc;
    }, {});
  }

  const manifest = getWorkflowManifest(pipeline);
  if (manifest && isObject(manifest.steps)) {
    return MANIFEST_STAGE_KEYS.reduce((acc, key) => {
      acc[key] = safeLower(manifest.steps?.[key]?.status || 'not_started');
      return acc;
    }, {});
  }

  const { staleSet, ...completion } = deriveLegacyPipelineStepCompletion(pipeline);
  return MANIFEST_STAGE_KEYS.reduce((acc, key) => {
    if (staleSet.has(key)) acc[key] = 'invalidated';
    else if (completion[key]) acc[key] = 'completed';
    else acc[key] = 'not_started';
    return acc;
  }, {});
};

export const derivePipelineStepCompletion = (pipeline) => {
  const manifestStatuses = derivePipelineStepStatuses(pipeline);
  if (getRunState(pipeline)) {
    return Object.fromEntries(
        MANIFEST_STAGE_KEYS.map((key) => [key, manifestStatuses[key] === 'completed'])
    );
  }
  if (Object.keys(manifestStatuses).length > 0 && getWorkflowManifest(pipeline)) {
    return Object.fromEntries(
        MANIFEST_STAGE_KEYS.map((key) => [key, manifestStatuses[key] === 'completed'])
    );
  }
  const { staleSet, ...completion } = deriveLegacyPipelineStepCompletion(pipeline);
  return completion;
};
