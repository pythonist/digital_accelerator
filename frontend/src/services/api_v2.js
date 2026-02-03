/**
 * Complete API Client for AML Extensions with Authentication
 * File: src/services/api_v2.js
 */

const API_BASE = '/api/v2';

// Helper to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  // ✅ Auto-inject environment
  const activeEnv = sessionStorage.getItem('active_env');
  if (activeEnv) {
    headers['X-Environment-ID'] = activeEnv;
  }
  
  return headers;
};

// Helper to handle responses
const handleResponse = async (res) => {
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// Helper to add env_id to URL
const addEnvToUrl = (url) => {
  const activeEnv = sessionStorage.getItem('active_env');
  if (!activeEnv) return url;
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}env_id=${encodeURIComponent(activeEnv)}`;
};

export const AMLExtensionsAPI = {
  
  // ==================== ✅ CASE SCOPE MANAGEMENT ====================
  
  setCaseScope: (type, value, runId = null) => {
    return fetch(addEnvToUrl(`${API_BASE}/case-scope/set`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ scope_type: type, scope_value: value, run_id: runId })
    }).then(handleResponse);
  },
  
  getCaseScope: () => {
    return fetch(addEnvToUrl(`${API_BASE}/case-scope/get`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  clearCaseScope: () => {
    return fetch(addEnvToUrl(`${API_BASE}/case-scope/clear`), {
      method: 'POST',
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== DATA INGESTION ====================
  
  ingestCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('auth_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    
    return fetch(addEnvToUrl(`${API_BASE}/ingest-csv`), {
      method: 'POST',
      headers: headers,
      body: formData
    }).then(handleResponse);
  },
  
  exportData: (filters, filename) => {
    return fetch(addEnvToUrl(`${API_BASE}/export-data`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ filters, filename })
    }).then(handleResponse);
  },
  
  getDatabaseStats: () => {
    return fetch(addEnvToUrl(`${API_BASE}/db/stats`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  createBackup: () => {
    return fetch(addEnvToUrl(`${API_BASE}/db/backup`), {
      method: 'POST',
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== RULE ENGINE ====================
  
  listRules: () => {
    return fetch(addEnvToUrl(`${API_BASE}/rules/list`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  evaluateAlertRules: (alertId, caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/rules/evaluate-alert`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ alert_id: alertId, case_id: caseId })
    }).then(handleResponse);
  },
  
  evaluateCaseRules: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/rules/evaluate-case`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId })
    }).then(handleResponse);
  },
  
  // ==================== CASE PACKS ====================
  
  getCasePack: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/case-pack/${caseId}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  exportCasePack: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/case-pack/${caseId}/export`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== VECTOR SEARCH / RAG ====================
  
  buildRAGIndex: (forceRebuild = false) => {
    return fetch(addEnvToUrl(`${API_BASE}/rag/build-index`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ force_rebuild: forceRebuild })
    }).then(handleResponse);
  },
  
  findSimilarCases: (caseId, topK = 5) => {
    return fetch(addEnvToUrl(`${API_BASE}/rag/similar-cases`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId, top_k: topK })
    }).then(handleResponse);
  },
  
  searchByText: (query, topK = 5) => {
    return fetch(addEnvToUrl(`${API_BASE}/rag/search-text`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ query, top_k: topK })
    }).then(handleResponse);
  },
  
  // ==================== GRAPH ANALYSIS ====================
  
  buildCaseGraph: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/graph/build-case`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId })
    }).then(handleResponse);
  },
  
  detectCycles: (caseId, maxCycleLength = 5) => {
    return fetch(addEnvToUrl(`${API_BASE}/graph/detect-cycles`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId, max_cycle_length: maxCycleLength })
    }).then(handleResponse);
  },
  
  findKeyPlayers: (caseId, topN = 10) => {
    return fetch(addEnvToUrl(`${API_BASE}/graph/key-players`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId, top_n: topN })
    }).then(handleResponse);
  },
  
  // ==================== TYPOLOGY DETECTION ====================
  
  analyzeCaseTypologies: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/typology/analyze-case`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_id: caseId })
    }).then(handleResponse);
  },
  
  getTypologyReport: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/typology/report/${caseId}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  listTypologies: () => {
    return fetch(addEnvToUrl(`${API_BASE}/typology/list`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== COMPREHENSIVE ANALYSIS ====================
  
  comprehensiveAnalysis: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/analyze/comprehensive/${caseId}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== AUDIT LOG ====================
  
  getAuditLogs: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return fetch(addEnvToUrl(`${API_BASE}/audit/logs?${params.toString()}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  getCaseAuditTrail: (caseId) => {
    return fetch(addEnvToUrl(`${API_BASE}/audit/case/${caseId}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  // ==================== BASELINE ENGINE ====================
  
  buildBaseline: (customerId) => {
    return fetch(addEnvToUrl(`${API_BASE}/baseline/build`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ customer_id: customerId })
    }).then(handleResponse);
  },
  
  getBaseline: (customerId) => {
    return fetch(addEnvToUrl(`${API_BASE}/baseline/${customerId}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  detectDeviations: (customerId, alertIds) => {
    return fetch(addEnvToUrl(`${API_BASE}/baseline/deviations`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ customer_id: customerId, alert_ids: alertIds })
    }).then(handleResponse);
  },
  
  // ==================== ✅ FOCUS ENGINE (UPDATED) ====================
  
  runFocusEngine: (config = {}) => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/run`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ config })
    }).then(handleResponse);
  },

  getFocusInbox: () => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/inbox`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },

  getFocusHistory: () => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/history`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },

  updateCaseBucket: (caseIds, bucket, runId = null) => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/bucket/update`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ case_ids: caseIds, bucket, run_id: runId })
    }).then(handleResponse);
  },
  
  // Legacy aliases
  fetchRankedCases: () => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/inbox`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },

  getRunHistory: () => {
    return fetch(addEnvToUrl(`${API_BASE}/focus/history`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  searchCases: (query) => {
    return fetch(addEnvToUrl(`${API_BASE}/cases/search?q=${encodeURIComponent(query)}`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  hydrateCase: (targetId, dateWindow = 90) => {
    return fetch(addEnvToUrl(`${API_BASE}/cases/${targetId}/hydrate`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ date_window: dateWindow })
    }).then(handleResponse);
  },

  // ==================== THRESHOLD CALIBRATION ====================
  
  getCalibrationBaseline: async (environment) => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/baseline?environment=${encodeURIComponent(environment)}`), {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },
  
  runCalibration: async (payload) => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/run`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  
  submitCalibrationForApproval: async (calibrationRunId, comment = '') => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/submit`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ calibrationRunId, comment })
    });
    return handleResponse(res);
  },
  
  approveCalibration: async (calibrationRunId, comment = '') => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/approve`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ calibrationRunId, comment })
    });
    return handleResponse(res);
  },
  
  getCalibrationHistory: async (environment, limit = 50) => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/history?environment=${encodeURIComponent(environment)}&limit=${limit}`), {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },
  
  rollbackCalibration: async (calibrationRunId) => {
    const res = await fetch(addEnvToUrl(`${API_BASE}/calibration/rollback`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ calibrationRunId })
    });
    return handleResponse(res);
  },
  
  // ==================== SYSTEM INFO ====================
  
  getSystemInfo: () => {
    return fetch(addEnvToUrl(`${API_BASE}/system/info`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  },
  
  healthCheck: () => {
    return fetch(addEnvToUrl(`${API_BASE}/health`), {
      headers: getAuthHeaders()
    }).then(handleResponse);
  }
};

export default AMLExtensionsAPI;