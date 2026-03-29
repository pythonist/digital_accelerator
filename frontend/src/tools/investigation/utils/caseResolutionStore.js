export const CASE_RESOLUTION_EVENT = 'sentinel:case-resolution:update';

const STORAGE_KEY = 'sentinel.case_resolution.workspace.v1';

const getEnvId = () => {
  try {
    return sessionStorage.getItem('active_env') || 'default';
  } catch {
    return 'default';
  }
};

const emitUpdate = (detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CASE_RESOLUTION_EVENT, { detail }));
};

const readRoot = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeRoot = (next) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next || {}));
  } catch {
    // Ignore storage quota/read-only issues and keep UI responsive.
  }
};

export const readCaseResolutionCase = (caseId) => {
  const envId = getEnvId();
  const root = readRoot();
  const envStore = root?.[envId] || {};
  return envStore?.[String(caseId || '').trim()] || null;
};

export const mergeCaseResolutionModule = (caseId, moduleKey, payload) => {
  const normalizedCaseId = String(caseId || '').trim();
  const normalizedModuleKey = String(moduleKey || '').trim();
  if (!normalizedCaseId || !normalizedModuleKey || !payload || typeof payload !== 'object') {
    return null;
  }

  const envId = getEnvId();
  const root = readRoot();
  const envStore = { ...(root?.[envId] || {}) };
  const currentCase = envStore[normalizedCaseId] || {
    case_id: normalizedCaseId,
    modules: {},
    updated_at: null,
  };

  const nextModule = {
    ...(currentCase.modules?.[normalizedModuleKey] || {}),
    ...payload,
    updated_at: new Date().toISOString(),
  };

  const nextCase = {
    ...currentCase,
    case_id: normalizedCaseId,
    modules: {
      ...(currentCase.modules || {}),
      [normalizedModuleKey]: nextModule,
    },
    updated_at: new Date().toISOString(),
  };

  envStore[normalizedCaseId] = nextCase;
  writeRoot({
    ...root,
    [envId]: envStore,
  });
  emitUpdate({
    env_id: envId,
    case_id: normalizedCaseId,
    module_key: normalizedModuleKey,
    snapshot: nextCase,
  });
  return nextCase;
};

export const clearCaseResolutionCase = (caseId) => {
  const normalizedCaseId = String(caseId || '').trim();
  if (!normalizedCaseId) return;
  const envId = getEnvId();
  const root = readRoot();
  const envStore = { ...(root?.[envId] || {}) };
  delete envStore[normalizedCaseId];
  writeRoot({
    ...root,
    [envId]: envStore,
  });
  emitUpdate({
    env_id: envId,
    case_id: normalizedCaseId,
    cleared: true,
  });
};
