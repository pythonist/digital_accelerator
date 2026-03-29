const FCC_SENTINEL_HANDOFF_KEY = 'fcc.sentinel.handoff.v1';
const FCC_SENTINEL_HANDOFF_EVENT = 'fcc-sentinel-handoff-updated';

const emitFccSentinelHandoffUpdate = (payload) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FCC_SENTINEL_HANDOFF_EVENT, { detail: payload || null }));
};

export const readFccSentinelHandoff = () => {
  try {
    const raw = sessionStorage.getItem(FCC_SENTINEL_HANDOFF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

export const persistFccSentinelHandoff = (payload) => {
  try {
    const nextPayload = {
      ...payload,
      created_at: payload?.created_at || new Date().toISOString(),
    };
    sessionStorage.setItem(
      FCC_SENTINEL_HANDOFF_KEY,
      JSON.stringify(nextPayload),
    );
    emitFccSentinelHandoffUpdate(nextPayload);
  } catch (error) {
    // Best-effort only.
  }
};

export const mergeFccSentinelHandoff = (patch) => {
  const current = readFccSentinelHandoff() || {};
  const nextPayload = {
    ...current,
    ...(patch || {}),
    created_at: current?.created_at || new Date().toISOString(),
  };
  persistFccSentinelHandoff(nextPayload);
  return nextPayload;
};

export const clearFccSentinelHandoff = () => {
  try {
    sessionStorage.removeItem(FCC_SENTINEL_HANDOFF_KEY);
    emitFccSentinelHandoffUpdate(null);
  } catch (error) {
    // Best-effort only.
  }
};

export { FCC_SENTINEL_HANDOFF_EVENT, FCC_SENTINEL_HANDOFF_KEY };
