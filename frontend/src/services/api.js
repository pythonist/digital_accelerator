// frontend/src/services/api.js
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

class APIClient {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Auto-inject auth token and active environment
    this.client.interceptors.request.use((config) => {
      // Inject auth token
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Auto-inject active environment
      const activeEnv = this._getActiveEnv();
      if (activeEnv) {
        config.headers['X-Environment-ID'] = activeEnv;
        if (!config.params) config.params = {};
        if (!config.params.env_id) config.params.env_id = activeEnv;
      }

      return config;
    });

    // Response interceptor for auth errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  _getActiveEnv() {
    let env = sessionStorage.getItem('active_env');
    if (!env) {
      const params = new URLSearchParams(window.location.search);
      env = params.get('env');
    }
    return env;
  }

  setActiveEnv(envId) {
    if (envId) {
      sessionStorage.setItem('active_env', envId);
    } else {
      sessionStorage.removeItem('active_env');
    }
  }

  async get(url, params = {}) {
    try {
      const response = await this.client.get(url, { params });
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  async post(url, data = {}, config = {}) {
    try {
      const response = await this.client.post(url, data, config);
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  async postForm(url, formData, config = {}) {
    try {
      const response = await this.client.post(url, formData, {
        ...config, 
        headers: {
          ...config.headers,
          'Content-Type': 'multipart/form-data'
        }
      });
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  async put(url, data = {}) {
    try {
      const response = await this.client.put(url, data);
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  async delete(url) {
    try {
      const response = await this.client.delete(url);
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  async downloadBlob(url, params = {}) {
    try {
      const response = await this.client.get(url, {
        params,
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      throw this._handleError(error);
    }
  }

  _handleError(error) {
    if (error.response) {
      return new Error(error.response.data?.error || error.response.data?.message || 'Request failed');
    } else if (error.request) {
      return new Error('No response from server');
    } else {
      return new Error(error.message || 'Unknown error');
    }
  }

  // ==================== CASE SCOPE MANAGEMENT ====================
  
  async setCaseScope(type, value, runId = null) {
    return this.post('/api/v2/case-scope/set', {
      scope_type: type,
      scope_value: value,
      run_id: runId
    });
  }

  async getCaseScope() {
    return this.get('/api/v2/case-scope/get');
  }

  async clearCaseScope() {
    return this.post('/api/v2/case-scope/clear', {});
  }

  // ==================== FOCUS ENGINE ====================
  
  async runFocusEngine(config = {}) {
    return this.post('/api/v2/focus/run', { config });
  }

  async getFocusInbox() {
    return this.get('/api/v2/focus/inbox');
  }

  async getFocusHistory() {
    return this.get('/api/v2/focus/history');
  }

  async updateCaseBucket(caseIds, bucket, runId = null) {
    return this.post('/api/v2/focus/bucket/update', {
      case_ids: caseIds,
      bucket: bucket,
      run_id: runId
    });
  }

  // ==================== CASE SPECIFIC METHODS ====================
  
  async hydrateCase(caseId, dateWindow = 90) {
    return this.post(`/api/v2/cases/${caseId}/hydrate`, { date_window: dateWindow });
  }

  async getCaseFacts(caseId) {
    return this.get(`/api/v2/case/${caseId}/facts`);
  }

  async getRankedCases() {
    return this.get('/api/v2/cases/ranked');
  }

  async rerankCases() { 
    return this.runFocusEngine(); 
  }

  // ==================== MULE DETECTION ====================
  
  async getMuleDataStatus() {
    return this.get('/api/v2/mule/status');
  }

  async uploadMuleData(files) {
    const formData = new FormData();
    if (files.transactions) formData.append('transactions', files.transactions);
    if (files.accounts) formData.append('accounts', files.accounts);
    return this.postForm('/api/v2/mule/upload', formData);
  }

  async getMuleAccounts() {
    return this.get('/api/v2/mule/accounts');
  }

  async getMuleAccountDetail(accountId) {
    return this.get(`/api/v2/mule/accounts/${accountId}`);
  }

  async analyzeMuleFlows(accountId, params = {}) {
    return this.get(`/api/v2/mule/accounts/${accountId}/flows`, params);
  }

  async detectMulePatterns() {
    return this.get('/api/v2/mule/patterns');
  }

  async getMuleIntrospection() {
    return this.get('/api/v2/mule/introspect');
  }
}

const apiClient = new APIClient();
export default apiClient;