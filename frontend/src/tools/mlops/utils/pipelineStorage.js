const STORAGE_KEY = 'fcc_pipeline_runs';

export const FCC_PIPELINE_STEP_KEYS = [
  'data_upload',
  'master_dataset',
  'target_variable',
  'eda',
  'preprocessing',
  'model_run',
  'validation',
  'registry',
  'live_dashboard',
  'reports',
];

const nowIso = () => new Date().toISOString();

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const defaultStepState = () => ({
  status: 'pending',
  completed_at: null,
  metadata: {},
});

const buildDefaultSteps = () => FCC_PIPELINE_STEP_KEYS.reduce((acc, key) => {
  acc[key] = defaultStepState();
  return acc;
}, {});

const readStore = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStore = (runs) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(runs) ? runs : []));
  } catch {
    // ignore localStorage write failures for demo resilience
  }
};

const normalizePipelineId = (pipelineId) => String(pipelineId || '').trim();
const normalizeText = (value) => String(value || '').trim();

const normalizeScope = (pipelineRef, scope = {}) => {
  const source = isObject(pipelineRef) ? pipelineRef : (isObject(scope) ? scope : {});
  const pipelineId = normalizePipelineId(
    isObject(pipelineRef)
      ? (pipelineRef.pipeline_id || pipelineRef.pipelineId || pipelineRef.id || '')
      : pipelineRef,
  );
  const pipelineUuid = normalizeText(
    source.pipeline_uuid
    || source.pipelineUuid
    || '',
  );
  const envId = normalizeText(
    source.env_id
    || source.environment_id
    || source.envId
    || '',
  );
  const pipelineType = normalizeText(
    source.pipeline_type
    || source.model_family
    || source.pipelineType
    || '',
  ).toLowerCase();
  const pipelineName = normalizeText(
    source.pipeline_name
    || source.pipelineName
    || source.name
    || '',
  );
  const storageKey = envId
    ? (pipelineUuid ? `${envId}::${pipelineUuid}` : `${envId}::${pipelineId}`)
    : (pipelineUuid || pipelineId);
  return {
    pipeline_id: pipelineId,
    pipeline_uuid: pipelineUuid,
    env_id: envId,
    pipeline_type: pipelineType || 'fcc',
    pipeline_name: pipelineName,
    storage_key: storageKey,
  };
};

const matchRunScope = (run, scope) => {
  const runKey = normalizeText(run?._storage_key);
  const scopeKey = normalizeText(scope?.storage_key);
  if (runKey && scopeKey) return runKey === scopeKey;

  const runEnv = normalizeText(run?.env_id);
  const scopeEnv = normalizeText(scope?.env_id);
  if (scopeEnv && runEnv && runEnv !== scopeEnv) return false;
  if (scopeEnv && !runEnv) return false;

  const runUuid = normalizeText(run?.pipeline_uuid);
  const scopeUuid = normalizeText(scope?.pipeline_uuid);
  if (scopeUuid) return runUuid === scopeUuid;

  return normalizePipelineId(run?.pipeline_id) === normalizePipelineId(scope?.pipeline_id);
};

const mergeSteps = (steps) => {
  const next = buildDefaultSteps();
  if (!isObject(steps)) return next;
  FCC_PIPELINE_STEP_KEYS.forEach((key) => {
    if (isObject(steps[key])) {
      next[key] = {
        ...defaultStepState(),
        ...steps[key],
        metadata: isObject(steps[key].metadata) ? steps[key].metadata : {},
      };
    }
  });
  return next;
};

const coerceCompletedSteps = (steps, status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!['complete', 'completed', 'done'].includes(normalizedStatus)) return steps;
  const next = { ...steps };
  FCC_PIPELINE_STEP_KEYS.forEach((key) => {
    next[key] = {
      ...defaultStepState(),
      ...(isObject(next[key]) ? next[key] : {}),
      status: 'done',
      completed_at: next[key]?.completed_at || nowIso(),
      metadata: isObject(next[key]?.metadata) ? next[key].metadata : {},
    };
  });
  return next;
};

const normalizeRun = (run, scope = {}) => {
  const resolvedScope = normalizeScope(run, scope);
  const pipelineId = normalizePipelineId(run?.pipeline_id || resolvedScope.pipeline_id);
  const status = String(run?.status || 'draft').trim() || 'draft';
  return {
    _storage_key: resolvedScope.storage_key || pipelineId,
    pipeline_id: pipelineId,
    pipeline_uuid: resolvedScope.pipeline_uuid || normalizeText(run?.pipeline_uuid),
    env_id: resolvedScope.env_id || normalizeText(run?.env_id),
    pipeline_type: resolvedScope.pipeline_type || normalizeText(run?.pipeline_type || run?.model_family || 'fcc').toLowerCase(),
    pipeline_name: String(run?.pipeline_name || run?.name || resolvedScope.pipeline_name || `FCC Run - ${pipelineId || 'Draft'}`).trim(),
    status,
    created_at: String(run?.created_at || nowIso()).trim(),
    last_updated: String(run?.last_updated || nowIso()).trim(),
    steps: coerceCompletedSteps(mergeSteps(run?.steps), status),
  };
};

const upsertRun = (runs, run, scope = {}) => {
  const normalized = normalizeRun(run, scope);
  const scopeInfo = normalizeScope(normalized, scope);
  if (!scopeInfo.storage_key) return runs;
  const nextRuns = Array.isArray(runs) ? [...runs] : [];
  const existingIndex = nextRuns.findIndex((item) => matchRunScope(item, scopeInfo));
  if (existingIndex >= 0) nextRuns[existingIndex] = normalized;
  else nextRuns.unshift(normalized);
  return nextRuns;
};

export const savePipelineRun = (pipelineRef, fullPipelineObject = {}, scope = {}) => {
  const scopeInfo = normalizeScope(pipelineRef, {
    ...(isObject(fullPipelineObject) ? fullPipelineObject : {}),
    ...(isObject(scope) ? scope : {}),
  });
  if (!scopeInfo.storage_key || !scopeInfo.pipeline_id) return null;
  const currentRuns = readStore();
  const payload = normalizeRun({
    ...fullPipelineObject,
    pipeline_id: scopeInfo.pipeline_id,
    pipeline_uuid: scopeInfo.pipeline_uuid || fullPipelineObject?.pipeline_uuid,
    env_id: scopeInfo.env_id || fullPipelineObject?.env_id,
    pipeline_type: scopeInfo.pipeline_type || fullPipelineObject?.pipeline_type,
    last_updated: nowIso(),
  }, scopeInfo);
  const nextRuns = upsertRun(currentRuns, payload, scopeInfo);
  writeStore(nextRuns);
  return payload;
};

export const updatePipelineStep = (pipelineRef, stepName, stepData = {}, scope = {}) => {
  const scopeInfo = normalizeScope(pipelineRef, scope);
  const normalizedId = normalizePipelineId(scopeInfo.pipeline_id);
  const normalizedStep = String(stepName || '').trim();
  if (!normalizedId || !normalizedStep || !scopeInfo.storage_key) return null;

  const currentRuns = readStore();
  const existing = currentRuns.find((item) => matchRunScope(item, scopeInfo));
  const baseRun = normalizeRun(existing || {
    pipeline_id: normalizedId,
    pipeline_uuid: scopeInfo.pipeline_uuid || null,
    env_id: scopeInfo.env_id || null,
    pipeline_type: scopeInfo.pipeline_type || 'fcc',
    pipeline_name: `FCC Run - ${normalizedId}`,
    status: 'draft',
  }, scopeInfo);

  const previousStep = baseRun.steps[normalizedStep] || defaultStepState();
  const nextStep = {
    ...previousStep,
    ...stepData,
    metadata: {
      ...(isObject(previousStep.metadata) ? previousStep.metadata : {}),
      ...(isObject(stepData.metadata) ? stepData.metadata : {}),
    },
  };

  if (nextStep.status === 'done' && !nextStep.completed_at) {
    nextStep.completed_at = nowIso();
  }

  const nextSteps = {
    ...baseRun.steps,
    [normalizedStep]: nextStep,
  };

  const allDone = FCC_PIPELINE_STEP_KEYS.every((key) => String(nextSteps[key]?.status || '').trim().toLowerCase() === 'done');
  const nextRun = {
    ...baseRun,
    last_updated: nowIso(),
    status: allDone ? 'completed' : (baseRun.status === 'completed' ? 'in_progress' : (stepData.status === 'done' ? 'in_progress' : baseRun.status || 'draft')),
    steps: nextSteps,
  };

  const nextRuns = upsertRun(currentRuns, nextRun, scopeInfo);
  writeStore(nextRuns);
  return nextRun;
};

export const loadPipelineRun = (pipelineRef, scope = {}) => {
  const scopeInfo = normalizeScope(pipelineRef, scope);
  if (!scopeInfo.storage_key || !scopeInfo.pipeline_id) return null;
  const existing = readStore().find((item) => matchRunScope(item, scopeInfo));
  return existing ? normalizeRun(existing, scopeInfo) : null;
};

export const listAllPipelineRuns = (scope = {}) => {
  const scopeInfo = normalizeScope(scope, scope);
  return readStore()
    .filter((run) => (!scopeInfo.env_id ? true : matchRunScope(run, { ...scopeInfo, pipeline_id: run?.pipeline_id, pipeline_uuid: run?.pipeline_uuid })))
    .map((run) => normalizeRun(run));
};

export const isPipelineComplete = (pipelineRef, scope = {}) => {
  const run = loadPipelineRun(pipelineRef, scope);
  if (!run) return false;
  return FCC_PIPELINE_STEP_KEYS.every((key) => String(run.steps?.[key]?.status || '').trim().toLowerCase() === 'done');
};

export const getStepStatus = (pipelineRef, stepName, scope = {}) => {
  const run = loadPipelineRun(pipelineRef, scope);
  if (!run) return 'pending';
  return String(run.steps?.[stepName]?.status || 'pending').trim().toLowerCase();
};
