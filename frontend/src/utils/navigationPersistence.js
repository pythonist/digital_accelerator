const STORAGE_KEY = 'fcc.workbench.navigation.v1';

const DEFAULT_STATE = {
  activeEnv: null,
  activeTool: null,
  routes: {},
  views: {},
};

const normalizeKeyPart = (value, fallback) => {
  const raw = String(value ?? '').trim();
  return raw || fallback;
};

const readState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      routes: { ...(parsed?.routes || {}) },
      views: { ...(parsed?.views || {}) },
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
};

const writeState = (nextState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore storage quota and browser privacy mode failures.
  }
};

const updateState = (updater) => {
  const current = readState();
  const next =
    typeof updater === 'function'
      ? updater(current)
      : {
          ...current,
          ...updater,
        };

  writeState({
    ...DEFAULT_STATE,
    ...next,
    routes: { ...(next?.routes || {}) },
    views: { ...(next?.views || {}) },
  });
};

const routeScopeKey = ({ username, envId }) =>
  `${normalizeKeyPart(username, 'anonymous')}::${normalizeKeyPart(envId, 'default')}`;

const viewScopeKey = ({ username, envId, toolKey }) =>
  `${routeScopeKey({ username, envId })}::${normalizeKeyPart(toolKey, 'workspace')}`;

export const readInitialActiveEnv = () => {
  const sessionEnv = sessionStorage.getItem('active_env');
  if (sessionEnv) return sessionEnv;
  return readState().activeEnv || null;
};

export const readInitialActiveTool = () => readState().activeTool || null;

export const persistShellSelection = (selection = {}) => {
  const hasActiveEnv = Object.prototype.hasOwnProperty.call(selection, 'activeEnv');
  const hasActiveTool = Object.prototype.hasOwnProperty.call(selection, 'activeTool');

  updateState((current) => ({
    ...current,
    activeEnv: hasActiveEnv ? selection.activeEnv ?? null : current.activeEnv ?? null,
    activeTool: hasActiveTool ? selection.activeTool ?? null : current.activeTool ?? null,
  }));
};

export const clearShellSelection = () => {
  updateState((current) => ({
    ...current,
    activeEnv: null,
    activeTool: null,
  }));
};

export const readLastRoute = (scope) => {
  const key = routeScopeKey(scope);
  return readState().routes?.[key] || '';
};

export const persistLastRoute = (scope, route) => {
  const nextRoute = String(route || '').trim();
  if (!nextRoute) return;

  const key = routeScopeKey(scope);
  updateState((current) => ({
    ...current,
    activeEnv: scope?.envId ?? current.activeEnv ?? null,
    routes: {
      ...(current.routes || {}),
      [key]: nextRoute,
    },
  }));
};

export const readWorkbenchView = (scope, fallback) => {
  const key = viewScopeKey(scope);
  return readState().views?.[key] || fallback;
};

export const persistWorkbenchView = (scope, view) => {
  const nextView = String(view || '').trim();
  if (!nextView) return;

  const key = viewScopeKey(scope);
  updateState((current) => ({
    ...current,
    views: {
      ...(current.views || {}),
      [key]: nextView,
    },
  }));
};
