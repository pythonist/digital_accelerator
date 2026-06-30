// frontend/src/services/api.js
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const TRACE_API_PREFIXES = ['/api/mlops', '/api/eda', '/api/model-training', '/api/deployment-dashboard'];
const TRACE_API_CALLS = Boolean(import.meta.env.DEV);

const shouldTraceApi = (url = '') => TRACE_API_CALLS && TRACE_API_PREFIXES.some((prefix) => String(url || '').startsWith(prefix));

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

      // Inject chosen LLM model
      const llmModel = localStorage.getItem('llm_model');
      if (llmModel) {
        config.headers['X-LLM-Model'] = llmModel;
      }

      const isFormData = typeof FormData !== 'undefined' && config?.data instanceof FormData;
      if (isFormData && config.headers) {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
        if (typeof config.headers.set === 'function') {
          try {
            config.headers.set('Content-Type', undefined);
            config.headers.set('content-type', undefined);
          } catch {
            // Ignore AxiosHeaders variants that do not support set/undefined cleanly.
          }
        }
      }

      if (shouldTraceApi(config.url)) {
        console.debug('[API START]', (config.method || 'get').toUpperCase(), config.url, {
          params: config.params || {},
          env: activeEnv || null,
        });
      }

      return config;
    });

    // Response interceptor for auth errors
    this.client.interceptors.response.use(
      (response) => {
        if (shouldTraceApi(response?.config?.url)) {
          console.debug('[API DONE]', (response?.config?.method || 'get').toUpperCase(), response?.config?.url, response?.status);
        }
        return response;
      },
      (error) => {
        if (shouldTraceApi(error?.config?.url)) {
          console.error('[API FAIL]', (error?.config?.method || 'get').toUpperCase(), error?.config?.url, error?.message);
        }
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

  _getSessionId() {
    let sid = sessionStorage.getItem('session_id');
    if (!sid) {
      const rand = Math.random().toString(16).slice(2);
      sid = `S_${Date.now()}_${rand}`;
      sessionStorage.setItem('session_id', sid);
    }
    return sid;
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

  async logSessionEvent(event) {
    const payload = { ...(event || {}), session_id: (event && event.session_id) || this._getSessionId() };
    try {
      return await this.post('/api/v2/audit/session/event', payload);
    } catch {
      return null;
    }
  }

  async postForm(url, formData, config = {}) {
    try {
      const headers = { ...(config.headers || {}) };
      delete headers['Content-Type'];
      delete headers['content-type'];
      headers['Content-Type'] = 'multipart/form-data';
      const response = await this.client.post(url, formData, {
        ...config,
        headers,
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

  async patch(url, data = {}) {
    try {
      const response = await this.client.patch(url, data);
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
    } else if (error.code === 'ECONNABORTED') {
      return new Error('Request timed out while the backend was still working. Check the Flask console for the active step log.');
    } else if (error.request) {
      return new Error('Backend connection failed. If Flask is running, check whether this route printed an [API START] log.');
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

  async getCaseResolutionSupportFile(caseId) {
    return this.get(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/support-file`);
  }

  async saveCaseResolutionSupportFile(caseId, supportFile) {
    return this.post(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/support-file`, {
      support_file: supportFile,
    });
  }

  async generateCaseResolutionInvestigationSummary(caseId, supportFile, model = null) {
    const payload = {
      support_file: supportFile,
      model,
    };
    try {
      const response = await this.client.post(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/investigation-summary`, payload);
      return response.data;
    } catch (error) {
      if (error.response?.status === 405) {
        const retry = await this.client.post(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/generate-investigation-summary`, payload);
        return retry.data;
      }
      throw this._handleError(error);
    }
  }

  async getExecutiveIntelligenceSummary(params = {}) {
    return this.get('/api/v2/executive-summary', params || {});
  }

  async getExecutiveGraphFlowPayload(params = {}) {
    return this.get('/api/v2/executive-summary/graph-flow', params || {});
  }

  async generateCaseResolutionSarDraft(caseId, supportFile, model = null) {
    const payload = {
      support_file: supportFile,
      model,
    };
    try {
      const response = await this.client.post(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/sar-draft`, payload);
      return response.data;
    } catch (error) {
      if (error.response?.status === 405) {
        const retry = await this.client.post(`/api/v2/case-resolution/${encodeURIComponent(caseId)}/draft-sar`, payload);
        return retry.data;
      }
      throw this._handleError(error);
    }
  }

  async analyzeNetworkIntelligence(caseId, filters = {}) {
    return this.post('/api/v2/analysis/network-intelligence/analyze', {
      case_id: caseId,
      filters,
    });
  }

  async getSavedNetworkIntelligence(caseId) {
    return this.get(`/api/v2/analysis/network-intelligence/${encodeURIComponent(caseId)}`);
  }

  async saveNetworkIntelligence(caseId, payload, includeInReport = true) {
    return this.post('/api/v2/analysis/network-intelligence/save', {
      case_id: caseId,
      payload,
      include_in_report: includeInReport,
    });
  }

  async getTypologyGuide() {
    return this.get('/api/v2/typology/guide');
  }

  async analyzeTypologyIntelligence(caseId, options = {}) {
    return this.post('/api/v2/typology/analyze', {
      case_id: caseId,
      options,
    });
  }

  async getSavedTypologyAssessment(caseId) {
    return this.get(`/api/v2/typology/${encodeURIComponent(caseId)}`);
  }

  async saveTypologyAssessment(caseId, payload, includeInReport = true, generatedBy = 'analyst') {
    return this.post('/api/v2/typology/save', {
      case_id: caseId,
      payload,
      include_in_report: includeInReport,
      generated_by: generatedBy,
    });
  }

  async getTypologyAssessmentHistory(caseId, params = {}) {
    return this.get(`/api/v2/typology/history/${encodeURIComponent(caseId)}`, params);
  }

  async getRankedCases() {
    return this.get('/api/v2/cases/ranked');
  }

  async rerankCases() { 
    return this.runFocusEngine(); 
  }

  async listFccScoredBatches(params = {}) {
    return this.get('/api/v2/fcc-bridge/scored-batches', params);
  }

  async publishFccBatch(payload = {}) {
    return this.post('/api/v2/fcc-bridge/publish', payload);
  }

  async listFccPublishedRuns(params = {}) {
    return this.get('/api/v2/fcc-bridge/published', params);
  }

  async importFccPublishedRun(payload = {}) {
    return this.post('/api/v2/fcc-bridge/import', payload);
  }

  async deleteFccPublishedRun(publishId, payload = {}) {
    return this.post(`/api/v2/fcc-bridge/published/${encodeURIComponent(String(publishId || ''))}/delete`, payload);
  }

  async clearFccImportedQueue(payload = {}) {
    return this.post('/api/v2/fcc-bridge/imported-queue/reset', payload);
  }

  async getFccWorkflowSession(params = {}) {
    return this.get('/api/v2/fcc-workflow/session', params);
  }

  async saveFccWorkflowSession(payload = {}) {
    return this.post('/api/v2/fcc-workflow/session', payload);
  }

  async deleteFccWorkflowSession(sessionId) {
    return this.delete(`/api/v2/fcc-workflow/session/${sessionId}`);
  }

  async handoffFccToSentinel(payload = {}) {
    return this.post('/api/deployment-dashboard/handoff-sentinel', payload);
  }

  async getCaseQueue(params = {}) {
    return this.get('/api/v2/case-queue', params);
  }

  async getCaseQueueDetail(caseId) {
    return this.get(`/api/v2/case-queue/${encodeURIComponent(caseId)}`);
  }

  async updateCaseQueueStatus(caseId, payload = {}) {
    return this.patch(`/api/v2/case-queue/${encodeURIComponent(caseId)}/status`, payload);
  }

  async updateCaseQueueStatusBatch(payload = {}) {
    return this.post('/api/v2/case-queue/batch/status', payload);
  }

  async assignCaseQueueOwner(caseId, payload = {}) {
    return this.patch(`/api/v2/case-queue/${encodeURIComponent(caseId)}/assign`, payload);
  }

  async previewEscalation(payload = {}) {
    return this.post('/api/v2/escalations/preview', payload);
  }

  async escalateSingleCase(payload = {}) {
    return this.post('/api/v2/escalations/single', payload);
  }

  async escalateCaseBatch(payload = {}) {
    return this.post('/api/v2/escalations/batch', payload);
  }

  async getEscalationHistory(params = {}) {
    return this.get('/api/v2/escalations/history', params);
  }

  async getCaseRetrievalGuide() {
    return this.get('/api/v2/case-retrieval/guide');
  }

  async getCaseRetrievalIndexStatus() {
    return this.get('/api/v2/case-retrieval/index-status');
  }

  async rebuildCaseRetrievalIndex(payload = {}) {
    return this.post('/api/v2/case-retrieval/rebuild-index', payload);
  }

  async retrieveSimilarCases(payload = {}) {
    try {
      return await this.post('/api/v2/case-retrieval/similar', payload);
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('method not allowed')) {
        throw error;
      }
      return this.get('/api/v2/case-retrieval/similar', {
        base_case_id: payload?.base_case_id,
        mode: payload?.mode,
        top_k: payload?.top_k,
        threshold: payload?.threshold,
        weights: JSON.stringify(payload?.weights || {}),
        filters: JSON.stringify(payload?.filters || {}),
      });
    }
  }

  async compareRetrievedCases(payload = {}) {
    return this.post('/api/v2/case-retrieval/compare', payload);
  }

  async getMailRecipients(params = {}) {
    return this.get('/api/v2/mail-config/recipients', params);
  }

  async createMailRecipient(payload = {}) {
    return this.post('/api/v2/mail-config/recipients', payload);
  }

  async updateMailRecipient(recipientId, payload = {}) {
    return this.put(`/api/v2/mail-config/recipients/${recipientId}`, payload);
  }

  async deleteMailRecipient(recipientId) {
    return this.delete(`/api/v2/mail-config/recipients/${recipientId}`);
  }

  async getMailRoutingRules() {
    return this.get('/api/v2/mail-config/rules');
  }

  async createMailRoutingRule(payload = {}) {
    return this.post('/api/v2/mail-config/rules', payload);
  }

  async getMailTemplates() {
    return this.get('/api/v2/mail-config/templates');
  }

  async createMailTemplate(payload = {}) {
    return this.post('/api/v2/mail-config/templates', payload);
  }

  async testMailConfiguration(payload = {}) {
    return this.post('/api/v2/mail-config/test-mail', payload);
  }

  async getMailboxMessages(params = {}) {
    return this.get('/api/v2/mail/messages', params);
  }

  async sendMailboxMessage(payload = {}) {
    return this.post('/api/v2/mail/send', payload);
  }

  async recordMailboxReply(payload = {}) {
    return this.post('/api/v2/mail/reply', payload);
  }

  async generateCaseReport(payload = {}) {
    return this.post('/api/v2/reports/generate', payload);
  }

  async generateBatchCaseReports(payload = {}) {
    return this.post('/api/v2/reports/generate-batch', payload);
  }

  async getCaseReports(caseId, params = {}) {
    return this.get(`/api/v2/reports/${encodeURIComponent(caseId)}`, params);
  }

  async getCaseReportHistory(params = {}) {
    return this.get('/api/v2/reports/history', params);
  }

  async downloadCaseReport(reportId) {
    return this.downloadBlob(`/api/v2/reports/download/${encodeURIComponent(reportId)}`);
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
