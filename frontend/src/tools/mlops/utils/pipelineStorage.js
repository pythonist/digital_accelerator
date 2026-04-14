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

const normalizeRun = (run) => {
  const pipelineId = normalizePipelineId(run?.pipeline_id);
  const status = String(run?.status || 'draft').trim() || 'draft';
  return {
    pipeline_id: pipelineId,
    pipeline_name: String(run?.pipeline_name || run?.name || `FCC Run - ${pipelineId || 'Draft'}`).trim(),
    status,
    created_at: String(run?.created_at || nowIso()).trim(),
    last_updated: String(run?.last_updated || nowIso()).trim(),
    steps: coerceCompletedSteps(mergeSteps(run?.steps), status),
  };
};

const upsertRun = (runs, run) => {
  const normalized = normalizeRun(run);
  const pipelineId = normalizePipelineId(normalized.pipeline_id);
  if (!pipelineId) return runs;
  const nextRuns = Array.isArray(runs) ? [...runs] : [];
  const existingIndex = nextRuns.findIndex((item) => normalizePipelineId(item?.pipeline_id) === pipelineId);
  if (existingIndex >= 0) nextRuns[existingIndex] = normalized;
  else nextRuns.unshift(normalized);
  return nextRuns;
};

export const savePipelineRun = (pipelineId, fullPipelineObject = {}) => {
  const normalizedId = normalizePipelineId(pipelineId || fullPipelineObject?.pipeline_id);
  if (!normalizedId) return null;
  const currentRuns = readStore();
  const payload = normalizeRun({
    ...fullPipelineObject,
    pipeline_id: normalizedId,
    last_updated: nowIso(),
  });
  const nextRuns = upsertRun(currentRuns, payload);
  writeStore(nextRuns);
  return payload;
};

export const updatePipelineStep = (pipelineId, stepName, stepData = {}) => {
  const normalizedId = normalizePipelineId(pipelineId);
  const normalizedStep = String(stepName || '').trim();
  if (!normalizedId || !normalizedStep) return null;

  const currentRuns = readStore();
  const existing = currentRuns.find((item) => normalizePipelineId(item?.pipeline_id) === normalizedId);
  const baseRun = normalizeRun(existing || {
    pipeline_id: normalizedId,
    pipeline_name: `FCC Run - ${normalizedId}`,
    status: 'draft',
  });

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

  const nextRuns = upsertRun(currentRuns, nextRun);
  writeStore(nextRuns);
  return nextRun;
};

export const loadPipelineRun = (pipelineId) => {
  const normalizedId = normalizePipelineId(pipelineId);
  if (!normalizedId) return null;
  const existing = readStore().find((item) => normalizePipelineId(item?.pipeline_id) === normalizedId);
  return existing ? normalizeRun(existing) : null;
};

export const listAllPipelineRuns = () => readStore().map((run) => normalizeRun(run));

export const isPipelineComplete = (pipelineId) => {
  const run = loadPipelineRun(pipelineId);
  if (!run) return false;
  return FCC_PIPELINE_STEP_KEYS.every((key) => String(run.steps?.[key]?.status || '').trim().toLowerCase() === 'done');
};

export const getStepStatus = (pipelineId, stepName) => {
  const run = loadPipelineRun(pipelineId);
  if (!run) return 'pending';
  return String(run.steps?.[stepName]?.status || 'pending').trim().toLowerCase();
};
