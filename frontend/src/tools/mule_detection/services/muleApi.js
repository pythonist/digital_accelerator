import axios from 'axios';

const getEnvId = (envId = null) => envId || localStorage.getItem('activeEnvId') || 'fcip_env';

const api = axios.create({ baseURL: '' });

api.interceptors.request.use((config) => {
  const envId = getEnvId();
  config.headers = config.headers || {};
  config.headers['X-Environment-ID'] = envId;
  return config;
});

const muleApi = {
  async uploadData(files, envId = null) {
    const formData = new FormData();
    if (files.transactions) formData.append('transactions', files.transactions);
    if (files.accounts) formData.append('accounts', files.accounts);
    const res = await api.post('/api/v2/mule/upload', formData, {
      headers: { 'X-Environment-ID': getEnvId(envId) }
    });
    return res.data;
  },

  async getDataStatus(envId = null) {
    const res = await api.get('/api/v2/mule/status', { headers: { 'X-Environment-ID': getEnvId(envId) } });
    return res.data;
  },

  async getAccounts(params = {}) {
    const res = await api.get('/api/v2/mule/accounts', { params });
    return res.data;
  },

  async getAccountGraph(accountId, params = {}) {
    const res = await api.get(`/api/v2/mule/accounts/${encodeURIComponent(accountId)}/graph`, { params });
    return res.data;
  },

  async getFlowWorkbenchGraph(accountId, params = {}) {
    const res = await api.get(`/api/v2/mule/accounts/${encodeURIComponent(accountId)}/flow-graph`, { params });
    return res.data;
  },

  async getFlowContext(payload = {}) {
    const res = await api.post('/api/v2/mule/accounts/flow-context', payload);
    return res.data;
  },

  async expandFlowWorkbenchGraph(accountId, payload = {}) {
    const res = await api.post(`/api/v2/mule/accounts/${encodeURIComponent(accountId)}/flow-graph/expand`, payload);
    return res.data;
  },

  async getMoneyFlowPatterns(params = {}) {
    const res = await api.get('/api/v2/mule/patterns', { params });
    return res.data;
  },

  async getDataSchema() {
    const res = await api.get('/api/v2/mule/data/schema');
    return res.data;
  },

  async getDataSample(table, limit = 25) {
    const res = await api.get('/api/v2/mule/data/sample', { params: { table, limit } });
    return res.data;
  },

  async getDataProfile() {
    const res = await api.get('/api/v2/mule/data/profile');
    return res.data;
  },

  async engineerFeatures() {
    const res = await api.post('/api/v2/mule/features/engineer', {});
    return res.data;
  },

  async getFeatureEngineeringStatus(jobId) {
    const res = await api.get('/api/v2/mule/features/engineer/status', { params: { job_id: jobId } });
    return res.data;
  },

  async listFeatures() {
    const res = await api.get('/api/v2/mule/features/list');
    return res.data;
  },

  async getAccountFeatures(params = {}) {
    const res = await api.get('/api/v2/mule/features/accounts', { params });
    return res.data;
  },

  async getFeatureDistribution(feature, bins = 20) {
    const res = await api.get('/api/v2/mule/features/distribution', { params: { feature, bins } });
    return res.data;
  },

  async trainModel(payload = {}) {
    const res = await api.post('/api/v2/mule/ml/train-model', payload);
    return res.data;
  },

  async listModels() {
    const res = await api.get('/api/v2/mule/ml/models/list');
    return res.data;
  },

  async inferModel(payload = {}) {
    const res = await api.post('/api/v2/mule/ml/infer-model', payload);
    return res.data;
  },

  async getRulesConfig() {
    const res = await api.get('/api/v2/mule/rules/config');
    return res.data;
  },

  async updateRulesConfig(payload = {}) {
    const res = await api.post('/api/v2/mule/rules/config', payload);
    return res.data;
  },

  async runRules() {
    const res = await api.post('/api/v2/mule/rules/run', {});
    return res.data;
  },

  async getNetworkGraph() {
    const res = await api.get('/api/v2/mule/network/graph');
    return res.data;
  },

  async runNetworkAnalysis(payload = {}) {
    const res = await api.post('/api/v2/mule/network/analyze', payload);
    return res.data;
  },

  async runHybrid(payload = {}) {
    const res = await api.post('/api/v2/mule/risk/hybrid/run', payload);
    return res.data;
  },

  async getLastRun(module) {
    const res = await api.get('/api/v2/mule/runs/last', { params: { module } });
    return res.data;
  },

  async getRiskSummary() {
    const res = await api.get('/api/v2/mule/risk/summary');
    return res.data;
  },

  async getRiskAccounts(params = {}) {
    const res = await api.get('/api/v2/mule/risk/accounts', { params });
    return res.data;
  },

  async getRiskTrend(params = {}) {
    const res = await api.get('/api/v2/mule/risk/trend', { params });
    return res.data;
  },

  async explainShap(accountId) {
    const res = await api.get('/api/v2/mule/explain/shap', { params: { account_id: accountId } });
    return res.data;
  },

  async getAccountSummary(accountId) {
    const res = await api.get(`/api/v2/mule/account/${encodeURIComponent(accountId)}/summary`);
    return res.data;
  }
};

export default muleApi;
