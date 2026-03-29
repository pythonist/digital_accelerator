const safeLower = (value) => String(value || '').trim().toLowerCase();

const asArray = (value) => (Array.isArray(value) ? value : []);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

export const derivePipelineStepCompletion = (pipeline) => {
  const steps = asArray(pipeline?.steps);
  const edaState = getScreenState(steps, 'eda');
  const modelState = getScreenState(steps, 'model');
  const validationState = getScreenState(steps, 'validation');
  const registryState = getScreenState(steps, 'registry');
  const dashboardState = getScreenState(steps, 'dashboard');
  const journeyState = getScreenState(steps, 'workbench_journey');
  const has = (screenKey) => Boolean(getScreenState(steps, screenKey));
  return {
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
};
