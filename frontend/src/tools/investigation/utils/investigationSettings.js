const STORAGE_KEY = 'fcip_investigation_settings_v1';

export const INVESTIGATION_SETTINGS_UPDATED_EVENT = 'fcip-investigation-settings-updated';

export const defaultInvestigationSettings = {
  global: {
    default_model: '',
    show_guides_by_default: false,
    compact_density: false,
    auto_refresh_live_views: true,
  },
  case_retrieval: {
    default_mode: 'Hybrid Similarity',
    default_top_k: 8,
    default_threshold: 0.35,
    default_weights: {
      behavioral: 0.45,
      typology: 0.25,
      network: 0.20,
      alert: 0.10,
    },
    include_resolved_by_default: true,
    default_outcome_filter: '',
    show_advanced_weighting: false,
  },
  case_resolution: {
    preferred_model: '',
    auto_refresh_on_open: true,
  },
  case_queue: {
    refresh_interval_seconds: 15,
    default_saved_view: 'All Cases',
    default_page_size: 25,
  },
  assistant: {
    preferred_model: '',
    keep_chat_history: true,
  },
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const deepMerge = (base, override) => {
  if (!isObject(base) || !isObject(override)) {
    return override === undefined ? base : override;
  }

  const next = { ...base };
  Object.keys(override).forEach((key) => {
    if (isObject(base[key]) && isObject(override[key])) {
      next[key] = deepMerge(base[key], override[key]);
    } else if (override[key] !== undefined) {
      next[key] = override[key];
    }
  });
  return next;
};

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const readInvestigationSettings = () => {
  if (!canUseStorage()) return defaultInvestigationSettings;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultInvestigationSettings;
    const parsed = JSON.parse(raw);
    return deepMerge(defaultInvestigationSettings, parsed || {});
  } catch {
    return defaultInvestigationSettings;
  }
};

export const saveInvestigationSettings = (settings) => {
  const merged = deepMerge(defaultInvestigationSettings, settings || {});
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(INVESTIGATION_SETTINGS_UPDATED_EVENT, {
      detail: merged,
    }));
  }
  return merged;
};

export const resetInvestigationSettings = () => saveInvestigationSettings(defaultInvestigationSettings);

export const subscribeInvestigationSettings = (handler) => {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => handler(event?.detail || readInvestigationSettings());
  window.addEventListener(INVESTIGATION_SETTINGS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(INVESTIGATION_SETTINGS_UPDATED_EVENT, listener);
};

export const resolveConfiguredModel = (settings, ...fallbacks) => {
  const configured = [
    settings?.case_resolution?.preferred_model,
    settings?.assistant?.preferred_model,
    settings?.global?.default_model,
    ...fallbacks,
  ].find((value) => Boolean(String(value || '').trim()));
  return configured || null;
};
