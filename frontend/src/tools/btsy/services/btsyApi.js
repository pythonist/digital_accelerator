// frontend/src/tools/btsy/services/btsyApi.js
import axios from 'axios';

const API_BASE = '/api/btsy';

axios.defaults.timeout = 30000;
const UPLOAD_TIMEOUT_MS = 0;

// Get environment ID from context or session
const getEnvId = () => {
  return sessionStorage.getItem('btsy_env_id') || 'default';
};

const getHeaders = () => ({
  'X-Environment-ID': getEnvId()
});

const btsyApi = {
  // Upload endpoints
  upload: {
    uploadDomain: async (domain, file) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(
        `${API_BASE}/upload/${domain}`,
        formData,
        {
          headers: {
            ...getHeaders(),
            'Content-Type': 'multipart/form-data'
          },
          timeout: UPLOAD_TIMEOUT_MS
        }
      );
      return response.data;
    },
    
    getStatus: async () => {
      const response = await axios.get(
        `${API_BASE}/status?t=${Date.now()}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    clearDomain: async (domain) => {
      const response = await axios.delete(
        `${API_BASE}/clear/${domain}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    clearAll: async () => {
      const response = await axios.delete(
        `${API_BASE}/clear-all?confirm_reset=true`,
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Profiling endpoints
  profiling: {
    profileDomain: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/profile/${domain}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    profileAll: async () => {
      const response = await axios.get(
        `${API_BASE}/profile/all`,
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Schema mapping endpoints
  mapping: {
    detectMapping: async (domain) => {
      const response = await axios.post(
        `${API_BASE}/detect/${domain}`,
        {},
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getMappingState: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/state/${domain}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    updateFieldMapping: async (domain, data) => {
      const response = await axios.put(
        `${API_BASE}/update/${domain}`,
        data,
        { headers: getHeaders() }
      );
      return response.data;
    },
    // --- ADD THIS FUNCTION ---
    confirmVerification: async (domain) => {
      const response = await axios.post(
        `${API_BASE}/verify/${domain}`, // Ensure this matches your backend route
        {},
        { headers: getHeaders() }
      );
      return response.data;
    },
    validateMapping: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/validate/${domain}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    finalizeMapping: async (domain) => {
      const response = await axios.post(
        `${API_BASE}/finalize/${domain}`,
        {},
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Normalization endpoints
  normalization: {
    normalizeDomain: async (domain) => {
      const response = await axios.post(
        `${API_BASE}/normalize/${domain}`,
        {},
        { headers: getHeaders() }
      );
      return response.data;
    },

    startNormalization: async (domain, { resume = false } = {}) => {
      const response = await axios.post(
        `${API_BASE}/normalize/start/${encodeURIComponent(String(domain))}`,
        { resume: Boolean(resume) },
        { headers: getHeaders() }
      );
      return response.data;
    },

    getNormalizationProgress: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/normalize/progress/${encodeURIComponent(String(domain))}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getNormalizationResult: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/result/${domain}`,
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Snapshot endpoints
  snapshot: {
    createSnapshot: async (frozenBy, { snapshotId = null, snapshotName = null } = {}) => {
      const response = await axios.post(
        `${API_BASE}/snapshot/create`,
        { frozen_by: frozenBy, snapshot_id: snapshotId, snapshot_name: snapshotName },
        { headers: getHeaders() }
      );
      return response.data;
    },
    createDraft: async (snapshotName, createdBy = 'user') => {
      const response = await axios.post(
        `${API_BASE}/snapshot/draft`,
        { snapshot_name: snapshotName, created_by: createdBy },
        { headers: getHeaders() }
      );
      return response.data;
    },
    renameSnapshot: async (snapshotId, snapshotName) => {
      const response = await axios.patch(
        `${API_BASE}/snapshot/${encodeURIComponent(String(snapshotId))}/rename`,
        { snapshot_name: snapshotName },
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    listSnapshots: async () => {
      const response = await axios.get(
        `${API_BASE}/snapshot/list`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getSnapshot: async (snapshotId) => {
      const response = await axios.get(
        `${API_BASE}/snapshot/${snapshotId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    verifySnapshot: async (snapshotId) => {
      const response = await axios.post(
        `${API_BASE}/snapshot/${snapshotId}/verify`,
        {},
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  extensions: {
    list: async (snapshotId, entityScope = null) => {
      const params = new URLSearchParams();
      if (entityScope) params.append('entity_scope', entityScope);
      const response = await axios.get(
        `${API_BASE}/extensions/${encodeURIComponent(String(snapshotId))}?${params.toString()}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    update: async (snapshotId, entityScope, sourceColumnName, patch) => {
      const response = await axios.patch(
        `${API_BASE}/extensions/${encodeURIComponent(String(snapshotId))}/${encodeURIComponent(String(entityScope))}/${encodeURIComponent(String(sourceColumnName))}`,
        patch || {},
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  dtypes: {
    getPlan: async (domain) => {
      const response = await axios.get(
        `${API_BASE}/dtypes/plan/${encodeURIComponent(String(domain))}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    validate: async (domain, payload) => {
      const response = await axios.post(
        `${API_BASE}/dtypes/validate/${encodeURIComponent(String(domain))}`,
        payload || {},
        { headers: getHeaders() }
      );
      return response.data;
    },
    lock: async (domain, payload) => {
      const response = await axios.post(
        `${API_BASE}/dtypes/lock/${encodeURIComponent(String(domain))}`,
        payload || {},
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  behaviour: {
    reconstruct: async ({ behavior_run_id, entity_id, as_of_date, entity_level = 'account', created_by = 'user' }) => {
      const response = await axios.post(
        `/api/behaviour/reconstruct`,
        {
          behavior_run_id,
          entity_id,
          as_of_date,
          entity_level,
          created_by
        },
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Transaction Universe endpoints
  universe: {
    getFoundationSummary: async (snapshotId) => {
      const response = await axios.get(
        `${API_BASE}/universe/foundation/${encodeURIComponent(String(snapshotId))}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    getMergedPreview: async (snapshotId, limit = 10) => {
      const response = await axios.get(
        `${API_BASE}/universe/merged-preview/${encodeURIComponent(String(snapshotId))}?limit=${encodeURIComponent(String(limit))}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    getDataStatistics: async (snapshotId) => {
      const response = await axios.get(
        `${API_BASE}/universe/data-statistics/${snapshotId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getFilteredStatistics: async (snapshotId, filters) => {
      const response = await axios.post(
        `${API_BASE}/universe/filtered-statistics/${snapshotId}`,
        filters,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    createUniverse: async (data) => {
      const response = await axios.post(
        `${API_BASE}/universe/create`,
        data,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    listUniverses: async (calibrationRunId, filters = {}) => {
      const params = new URLSearchParams();
      
      if (calibrationRunId) {
        params.append('calibration_run_id', calibrationRunId);
      }
      
      if (filters.snapshot_id) {
        params.append('snapshot_id', filters.snapshot_id);
      }
      
      if (filters.status) {
        params.append('status', filters.status);
      }
      
      const response = await axios.get(
        `${API_BASE}/universe/list?${params.toString()}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    listUniverseHistory: async (calibrationRunId, snapshotId, status, limit = 50) => {
      const params = new URLSearchParams();
      if (calibrationRunId) params.append('calibration_run_id', calibrationRunId);
      if (snapshotId) params.append('snapshot_id', snapshotId);
      if (status) params.append('status', status);
      if (limit) params.append('limit', limit);
      const response = await axios.get(
        `${API_BASE}/universe/history?${params.toString()}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    selectUniverse: async (universeId, reason) => {
      const response = await axios.post(
        `${API_BASE}/universe/${universeId}/select`,
        { reason },
        { headers: getHeaders() }
      );
      return response.data;
    },
    getSelected: async (calibrationRunId, runIdText = null) => {
      if (runIdText && String(runIdText).trim()) {
        const response = await axios.get(
          `${API_BASE}/universe/selected?run_id=${encodeURIComponent(String(runIdText))}`,
          { headers: getHeaders() }
        );
        return response.data;
      }
      const response = await axios.get(
        `${API_BASE}/universe/selected?calibration_run_id=${calibrationRunId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getUniverse: async (universeId) => {
      const response = await axios.get(
        `${API_BASE}/universe/${universeId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getUniverseStats: async (universeId) => {
      const response = await axios.get(
        `${API_BASE}/universe/${universeId}/stats`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    freezeUniverse: async (universeId, frozenBy) => {
      const response = await axios.post(
        `${API_BASE}/universe/${universeId}/freeze`,
        { frozen_by: frozenBy },
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    deleteUniverse: async (universeId) => {
      const response = await axios.delete(
        `${API_BASE}/universe/${universeId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    previewUniverse: async (universeId, limit = 100) => {
      const response = await axios.get(
        `${API_BASE}/universe/${universeId}/preview?limit=${limit}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    computeThresholds: async (universeId, payload) => {
      const response = await axios.post(
        `${API_BASE}/universe/${universeId}/thresholds`,
        payload || {},
        { headers: getHeaders() }
      );
      return response.data;
    }
  },

  // Audit Trail endpoints
  audit: {
    getStepAudit: async (calibrationRunId, stepName) => {
      const response = await axios.get(
        `${API_BASE}/audit/calibration/${calibrationRunId}/step/${stepName}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    getFullAudit: async (calibrationRunId) => {
      const response = await axios.get(
        `${API_BASE}/audit/calibration/${calibrationRunId}`,
        { headers: getHeaders() }
      );
      return response.data;
    },
    
    exportAuditReport: async (calibrationRunId) => {
      const response = await axios.get(
        `${API_BASE}/audit/calibration/${calibrationRunId}/export`,
        { 
          headers: getHeaders(),
          responseType: 'blob'
        }
      );
      return response.data;
    }
  }
};

// Behavior endpoints
btsyApi.behavior = {
  createRun: async (universeId, config, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/behavior/run/create`,
      { universe_id: universeId, config, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (universeId) => {
    const response = await axios.get(
      `${API_BASE}/behavior/runs/list${universeId ? `?universe_id=${universeId}` : ''}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  previewRun: async (runId, limit = 100) => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/preview?limit=${limit}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
  ,
  previewRunPaged: async (runId, limit = 50, offset = 0) => {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    q.set('offset', String(offset));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/preview?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  previewRunPagedFiltered: async (runId, limit = 50, offset = 0, filters = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    q.set('offset', String(offset));
    if (filters.entity_search) q.set('entity_search', String(filters.entity_search));
    if (filters.value_min != null && String(filters.value_min) !== '') q.set('value_min', String(filters.value_min));
    if (filters.value_max != null && String(filters.value_max) !== '') q.set('value_max', String(filters.value_max));
    if (filters.sort_by) q.set('sort_by', String(filters.sort_by));
    if (filters.sort_dir) q.set('sort_dir', String(filters.sort_dir));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/preview?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  previewRunEntityPaged: async (runId, agg = 'last', limit = 50, offset = 0, filters = {}) => {
    const q = new URLSearchParams();
    q.set('agg', String(agg || 'last'));
    q.set('limit', String(limit));
    q.set('offset', String(offset));
    if (filters.entity_search) q.set('entity_search', String(filters.entity_search));
    if (filters.value_min != null && String(filters.value_min) !== '') q.set('value_min', String(filters.value_min));
    if (filters.value_max != null && String(filters.value_max) !== '') q.set('value_max', String(filters.value_max));
    if (filters.sort_by) q.set('sort_by', String(filters.sort_by));
    if (filters.sort_dir) q.set('sort_dir', String(filters.sort_dir));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/preview_entity?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  entityValues: async (runIds, agg = 'max', limit = 200, filters = {}) => {
    const q = new URLSearchParams();
    q.set('run_ids', (runIds || []).join(','));
    q.set('agg', String(agg || 'max'));
    q.set('limit', String(limit));
    if (filters.entity_search) q.set('entity_search', String(filters.entity_search));
    if (filters.value_min != null && String(filters.value_min) !== '') q.set('value_min', String(filters.value_min));
    if (filters.value_max != null && String(filters.value_max) !== '') q.set('value_max', String(filters.value_max));
    const response = await axios.get(
      `${API_BASE}/behavior/entity/values?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  entityTimeline: async (runIds, entityIds, points = 2000) => {
    const q = new URLSearchParams();
    q.set('run_ids', (runIds || []).join(','));
    q.set('entity_ids', (entityIds || []).join(','));
    q.set('points', String(points));
    const response = await axios.get(
      `${API_BASE}/behavior/entity/timeline?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  validateRuns: async (runA, runB, entityId = null) => {
    const q = new URLSearchParams();
    q.set('run_a', String(runA));
    q.set('run_b', String(runB));
    if (entityId) q.set('entity_id', String(entityId));
    const response = await axios.get(
      `${API_BASE}/behavior/runs/validate?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  accountTransactions: async (runId, entityId, lookbackDays = 30, limit = 200, offset = 0) => {
    const q = new URLSearchParams();
    q.set('lookback_days', String(lookbackDays));
    q.set('limit', String(limit));
    q.set('offset', String(offset));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/account/${encodeURIComponent(String(entityId))}/transactions?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getQuality: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/quality`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getEvidence: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/evidence`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getSignalIntelligence: async (runId, compareRunId = null) => {
    const q = new URLSearchParams();
    if (compareRunId) q.set('compare_run_id', String(compareRunId));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/signal_intelligence${q.toString() ? `?${q.toString()}` : ''}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getOverlapOverview: async (runId, createdBy = 'user') => {
    const q = new URLSearchParams();
    if (createdBy) q.set('created_by', String(createdBy));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/overlap/overview?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getOverlapMatrix: async (runId, createdBy = 'user') => {
    const q = new URLSearchParams();
    if (createdBy) q.set('created_by', String(createdBy));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/overlap/matrix?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getOverlapPopulation: async (runId, createdBy = 'user') => {
    const q = new URLSearchParams();
    if (createdBy) q.set('created_by', String(createdBy));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/overlap/population?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getOverlapRecurring: async (runId, limit = 10, createdBy = 'user') => {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    if (createdBy) q.set('created_by', String(createdBy));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/overlap/recurring?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getEntityFootprint: async (runId, entityId, createdBy = 'user') => {
    const q = new URLSearchParams();
    if (createdBy) q.set('created_by', String(createdBy));
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/overlap/entity/${encodeURIComponent(String(entityId))}?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  exportRun: async (runId, format = 'parquet') => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/export?format=${format}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  topEntities: async (runId, k = 20) => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/top/entities?k=${k}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  medianByDay: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/behavior/run/${runId}/aggregate/median_by_day`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  compareData: async (runA, runB, agg = 'max') => {
    const response = await axios.get(
      `${API_BASE}/behavior/compare/data?run_a=${runA}&run_b=${runB}&agg=${agg}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.calibration = {
  createSession: async (behaviorRunId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/create`,
      { behavior_run_id: behaviorRunId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listSessions: async (behaviorRunId) => {
    const query = behaviorRunId ? `?behavior_run_id=${behaviorRunId}` : '';
    const response = await axios.get(
      `${API_BASE}/calibration/session/list${query}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getSession: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  freezeSession: async (sessionId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/freeze`,
      { created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  setAggregation: async (sessionId, config, createdBy = 'user') => {
    const response = await axios.put(
      `${API_BASE}/calibration/session/${sessionId}/aggregation`,
      { ...config, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getAggregateView: async (sessionId, limitEntities = 200) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/aggregate_view?limit_entities=${limitEntities}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  addStrategy: async (sessionId, strategy, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/strategy`,
      { ...strategy, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  addAnnotation: async (sessionId, annotation, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/annotation`,
      { ...annotation, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  addEvent: async (sessionId, eventType, event = {}, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/event`,
      { event_type: eventType, event, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getEntityDrilldown: async (sessionId, entityId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/entity/${encodeURIComponent(entityId)}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getFinalizeSummary: async (sessionId, boundaryId = null) => {
    const query = boundaryId ? `?boundary_id=${encodeURIComponent(String(boundaryId))}` : '';
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/finalize/summary${query}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.signal = {
  compute: async (sessionId, view, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/signal/compute`,
      { view: view || {}, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  logEvent: async (sessionId, eventType, params, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/signal/event`,
      { event_type: eventType, params: params || {}, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  saveState: async (sessionId, name, state, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/signal/state/save`,
      { name, state: state || {}, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listStates: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/signal/state/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getState: async (stateId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/signal/state/${stateId}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.threshold = {
  percentilePreview: async (sessionId, percentile) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/threshold/percentile_preview?percentile=${encodeURIComponent(percentile)}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  listStrategies: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/threshold/strategy/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  createStrategy: async (sessionId, payload, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/threshold/strategy/create`,
      { ...payload, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  deleteStrategy: async (sessionId, strategyId, createdBy = 'user') => {
    const response = await axios.delete(
      `${API_BASE}/calibration/session/${sessionId}/threshold/strategy/${strategyId}`,
      { headers: getHeaders(), data: { created_by: createdBy } }
    );
    return response.data;
  },
  impactMatrix: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/threshold/impact_matrix`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  overlap: async (sessionId, strategyIds, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/threshold/overlap`,
      { strategy_ids: strategyIds, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  sensitivity: async (sessionId, strategyId, delta = 1, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/threshold/sensitivity`,
      { strategy_id: strategyId, delta, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  logEvent: async (sessionId, eventType, params, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/threshold/event`,
      { event_type: eventType, params: params || {}, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.risk = {
  createBoundary: async (sessionId, payload, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/create`,
      { ...payload, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listBoundaries: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getBoundary: async (sessionId, boundaryId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/${boundaryId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  stressBoundary: async (sessionId, boundaryId, deltasPct = [-5, -2, -1, 1, 2, 5], createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/${boundaryId}/stress`,
      { deltas_pct: deltasPct, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  borderline: async (sessionId, boundaryId, limit = 50) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/${boundaryId}/borderline?limit=${encodeURIComponent(limit)}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  overlap: async (sessionId, boundaryA, boundaryB, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/risk/overlap`,
      { boundary_a: boundaryA, boundary_b: boundaryB, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  addBoundaryAnnotation: async (sessionId, boundaryId, text, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/risk/boundary/${boundaryId}/annotation`,
      { annotation_text: text, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.mlValidation = {
  trainingPreview: async (sessionId, boundaryId, trainingMode = 'BTL') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/training_preview`,
      { boundary_id: boundaryId, training_mode: trainingMode },
      { headers: getHeaders() }
    );
    return response.data;
  },
  preview: async (sessionId, boundaryId, trainingMode = 'BTL', params = null) => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/preview`,
      { boundary_id: boundaryId, training_mode: trainingMode, params: params || {} },
      { headers: getHeaders() }
    );
    return response.data;
  },
  saveRun: async (sessionId, payload, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/run/save`,
      { ...payload, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  dbscanPreview: async (sessionId, boundaryId, eps, minSamples) => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/dbscan/preview`,
      { boundary_id: boundaryId, eps, min_samples: minSamples },
      { headers: getHeaders() }
    );
    return response.data;
  },
  dbscanSaveRun: async (sessionId, payload, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/dbscan/run/save`,
      { ...payload, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listDbscanRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/dbscan/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getDbscanRun: async (sessionId, runId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/dbscan/run/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  deleteDbscanRun: async (sessionId, runId, createdBy = 'user') => {
    const response = await axios.delete(
      `${API_BASE}/calibration/session/${sessionId}/ml/dbscan/run/${runId}`,
      { headers: getHeaders(), data: { created_by: createdBy } }
    );
    return response.data;
  },
  crossCompare: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/cross_compare`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  recommendationPack: async (sessionId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/recommendation_pack`,
      { created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getRun: async (sessionId, runId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/run/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  deleteRun: async (sessionId, runId, createdBy = 'user') => {
    const response = await axios.delete(
      `${API_BASE}/calibration/session/${sessionId}/ml/run/${runId}`,
      { headers: getHeaders(), data: { created_by: createdBy } }
    );
    return response.data;
  },
  coverageMap: async (sessionId, runId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/coverage?run_id=${encodeURIComponent(runId)}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  cbp: async (sessionId, params) => {
    const query = new URLSearchParams(params);
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/cbp?${query.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  edt: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/ml/edt`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  report: async (sessionId, runId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/ml/report`,
      { ml_run_id: runId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.orchestrated = {
  createRun: async (sessionId, config, baselineOcrRunId = null, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/orchestrated/run/create`,
      { config: config || {}, baseline_ocr_run_id: baselineOcrRunId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/orchestrated/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getRun: async (sessionId, ocrRunId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/orchestrated/run/${ocrRunId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getApprovedBoundary: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/orchestrated/approved`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  approveBoundary: async (sessionId, ocrRunId, approvedBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/orchestrated/run/${ocrRunId}/approve`,
      { approved_by: approvedBy },
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.alerting = {
  getContext: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/alerting/context`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  preview: async (sessionId, payload = {}) => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/alerting/preview`,
      payload,
      { headers: getHeaders() }
    );
    return response.data;
  },
  generate: async (sessionId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/alerting/run/generate`,
      { created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/alerting/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getRun: async (sessionId, alertRunId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/alerting/run/${alertRunId}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.validation = {
  createKsRun: async (sessionId, boundaryId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/ks/run/create`,
      { boundary_id: boundaryId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listKsRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/ks/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getKsRun: async (sessionId, ksRunId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/ks/run/${ksRunId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  stressKsRun: async (sessionId, ksRunId, deltasPct = [-5, -2, -1, 1, 2, 5], subsampleFracs = [1.0, 0.5, 0.25], createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/ks/run/${ksRunId}/stress`,
      { deltas_pct: deltasPct, subsample_fracs: subsampleFracs, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  addKsAnnotation: async (sessionId, ksRunId, analystNote, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/ks/run/${ksRunId}/annotation`,
      { analyst_note: analystNote, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  runStep36: async (sessionId, boundaryId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/step36/run`,
      { boundary_id: boundaryId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listStep36Runs: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/step36/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getStep36Run: async (sessionId, step36Id) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/step36/run/${step36Id}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  step36Stability: async (sessionId, step36Id, nSamples = 20, sampleFrac = 0.75, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/step36/run/${step36Id}/stability`,
      { n_samples: nSamples, sample_frac: sampleFrac, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getStrAlignmentContext: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/str_alignment/context`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  listStrAlignmentRuns: async (sessionId) => {
    const response = await axios.get(
      `${API_BASE}/calibration/session/${sessionId}/validation/str_alignment/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  createStrAlignmentRun: async (sessionId, alertRunId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/calibration/session/${sessionId}/validation/str_alignment/run/create`,
      { alert_run_id: alertRunId, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getStrAlignmentRun: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/validation/str_alignment/run/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getStrAlignmentDiagnostics: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/validation/str_alignment/run/${runId}/diagnostics`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  classifyMissedStrs: async (runId, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/validation/str_alignment/run/${runId}/missed/classify`,
      { created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getMissedStrRun: async (missedRunId, rootCauseCode = null, limit = 200, offset = 0) => {
    const q = new URLSearchParams();
    if (rootCauseCode) q.set('root_cause_code', rootCauseCode);
    q.set('limit', String(limit));
    q.set('offset', String(offset));
    const response = await axios.get(
      `${API_BASE}/validation/missed_str/run/${missedRunId}?${q.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.operations = {
  listAlertRuns: async (limit = 200) => {
    const response = await axios.get(
      `${API_BASE}/operations/alert_runs/list?limit=${encodeURIComponent(String(limit))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  listScenarioInteractionRuns: async () => {
    const response = await axios.get(
      `${API_BASE}/operations/scenario_interaction/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  runScenarioInteraction: async (alertRunIds, startDate = null, endDate = null, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/operations/scenario_interaction/run`,
      { alert_run_ids: alertRunIds || [], start_date: startDate, end_date: endDate, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getScenarioInteractionRun: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/operations/scenario_interaction/run/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  listWorkloadRuns: async () => {
    const response = await axios.get(
      `${API_BASE}/operations/workload/run/list`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  runWorkload: async (alertRunIds, config, startDate = null, endDate = null, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/operations/workload/run`,
      { alert_run_ids: alertRunIds || [], start_date: startDate, end_date: endDate, config: config || {}, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  getWorkloadRun: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/operations/workload/run/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
};

btsyApi.autoRun = {
  createRun: async (snapshotId, sessionId, mode = 'simulation', createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/auto_run/calibration_runs`,
      { snapshot_id: snapshotId, session_id: sessionId, mode, created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (limit = 200) => {
    const response = await axios.get(
      `${API_BASE}/auto_run/calibration_runs?limit=${encodeURIComponent(String(limit))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getRun: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/auto_run/calibration_runs/${runId}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getLog: async (runId, tail = 200) => {
    const response = await axios.get(
      `${API_BASE}/auto_run/calibration_runs/${runId}/log?tail=${encodeURIComponent(String(tail))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  reportUrl: (runId) => `${API_BASE}/auto_run/calibration_runs/${runId}/report`,
  downloadReport: async (runId) => {
    const response = await axios.get(
      `${API_BASE}/auto_run/calibration_runs/${runId}/report`,
      { headers: getHeaders(), responseType: 'blob' }
    );
    return response;
  },
};

btsyApi.calibrationRuns = {
  createRun: async (snapshotId, createdBy = 'user', notes = null, logicConfig = null) => {
    const response = await axios.post(
      `${API_BASE}/calibration/run/create`,
      { snapshot_id: snapshotId, created_by: createdBy, notes, logic_config: logicConfig || {} },
      { headers: getHeaders() }
    );
    return response.data;
  },
  listRuns: async (limit = 200) => {
    const response = await axios.get(
      `${API_BASE}/calibration/run/list?limit=${encodeURIComponent(String(limit))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  getRun: async (runIdOrNum) => {
    const response = await axios.get(
      `${API_BASE}/calibration/run/${encodeURIComponent(String(runIdOrNum))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  activateRun: async (runIdOrNum) => {
    const response = await axios.post(
      `${API_BASE}/calibration/run/${encodeURIComponent(String(runIdOrNum))}/activate`,
      {},
      { headers: getHeaders() }
    );
    return response.data;
  },
  getActive: async () => {
    const response = await axios.get(
      `${API_BASE}/calibration/run/active`,
      { headers: getHeaders() }
    );
    return response.data;
  }
};

btsyApi.scenarios = {
  list: async (ownership = null, status = 'ACTIVE') => {
    const params = new URLSearchParams();
    if (ownership) params.append('ownership', ownership);
    if (status) params.append('status', status);
    const response = await axios.get(
      `${API_BASE}/scenario/list?${params.toString()}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  runByRun: async (runIdText, createdBy = 'user', config = null) => {
    const response = await axios.post(
      `${API_BASE}/cortex/scenario/run-by-run`,
      { run_id: runIdText, created_by: createdBy, config: config || {} },
      { headers: getHeaders() }
    );
    return response.data;
  },
  get: async (scenarioId) => {
    const response = await axios.get(
      `${API_BASE}/scenario/${encodeURIComponent(String(scenarioId))}`,
      { headers: getHeaders() }
    );
    return response.data;
  },
  create: async (scenario, createdBy = 'user') => {
    const response = await axios.post(
      `${API_BASE}/scenario/create`,
      { ...(scenario || {}), created_by: createdBy },
      { headers: getHeaders() }
    );
    return response.data;
  }
};

export default btsyApi;
