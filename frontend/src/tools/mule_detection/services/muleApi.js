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

  async getDataOnboardingProfile() {
    const res = await api.get('/api/v2/mule/data/onboarding/profile');
    return res.data;
  },
  async getDataOnboardingValidate() {
    const res = await api.get('/api/v2/mule/data/onboarding/validate');
    return res.data;
  },
  async getDataOnboardingMissingness() {
    const res = await api.get('/api/v2/mule/data/onboarding/missingness');
    return res.data;
  },
  async getDataOnboardingCardinality() {
    const res = await api.get('/api/v2/mule/data/onboarding/cardinality');
    return res.data;
  },
  async getDataOnboardingIntegrity() {
    const res = await api.get('/api/v2/mule/data/onboarding/integrity');
    return res.data;
  },
  async getDataOnboardingTimeSanity() {
    const res = await api.get('/api/v2/mule/data/onboarding/time-sanity');
    return res.data;
  },
  async getDataOnboardingDistribution(bins = 20) {
    const res = await api.get('/api/v2/mule/data/onboarding/distribution', { params: { bins } });
    return res.data;
  },
  async getDataOnboardingLineage() {
    const res = await api.get('/api/v2/mule/data/onboarding/lineage');
    return res.data;
  },
  async getDataForensicsReport(limit = 20000) {
    const res = await api.get('/api/v2/mule/data/forensics/report', { params: { limit } });
    return res.data;
  },
  async getAccountBehaviorProfile(accountId) {
    const res = await api.get(`/api/v2/mule/accounts/${encodeURIComponent(accountId)}/behavior`);
    return res.data;
  },
  async getRiskSignalPreview() {
    const res = await api.get('/api/v2/mule/risk/signal-preview');
    return res.data;
  },
  async engineerFeatures(payload = {}) {
    const res = await api.post('/api/v2/mule/features/engineer', payload);
    return res.data;
  },

  async getFeatureEngineeringStatus(jobId) {
    const params = jobId ? { job_id: jobId } : undefined;
    const res = await api.get('/api/v2/mule/features/engineer/status', params ? { params } : undefined);
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
  async getFeatureRunsHistory(params = {}) {
    const res = await api.get('/api/v2/mule/runs/history', { params });
    return res.data;
  },
  async getFeatureRunDetails(run_id) {
    const res = await api.get('/api/v2/mule/runs/details', { params: { run_id } });
    return res.data;
  },
  async getFeaturesCatalog() {
    const res = await api.get('/api/v2/mule/features/catalog');
    return res.data;
  },
  async getFeatureProfile(feature, run_id) {
    const res = await api.get('/api/v2/mule/features/profile', { params: { feature, run_id } });
    return res.data;
  },
  async getFeatureDrift(feature) {
    const res = await api.get('/api/v2/mule/features/drift', { params: { feature } });
    return res.data;
  },
  async getFeatureLeakage(feature) {
    const res = await api.get('/api/v2/mule/features/leakage', { params: { feature } });
    return res.data;
  },
  async compareFeatures(feature, left_run, right_run) {
    const res = await api.get('/api/v2/mule/features/compare', { params: { feature, left_run, right_run } });
    return res.data;
  },
  async approveFeature(payload = {}) {
    const res = await api.post('/api/v2/mule/features/approve', payload);
    return res.data;
  },
  async getFeatureLineage(feature) {
    const res = await api.get('/api/v2/mule/features/lineage', { params: { feature } });
    return res.data;
  },
  async createExperiment(payload = {}) {
    const res = await api.post('/api/v2/mule/experiments/create', payload);
    return res.data;
  },
  async listExperiments(params = {}) {
    const res = await api.get('/api/v2/mule/experiments/list', { params });
    return res.data;
  },
  async getEligibleFeatures(payload = {}) {
    const res = await api.post('/api/v2/mule/features/eligible', payload);
    return res.data;
  },
  async runValidation(payload = {}) {
    const res = await api.post('/api/v2/mule/validation/run', payload);
    return res.data;
  },
  async runTraining(payload = {}) {
    const res = await api.post('/api/v2/mule/training/run', payload);
    return res.data;
  },
  async getModelWorkbenchMetrics(params = {}) {
    const res = await api.get('/api/v2/mule/metrics', { params });
    return res.data;
  },
  async getGlobalExplain(params = {}) {
    const res = await api.get('/api/v2/mule/explain/global', { params });
    return res.data;
  },
  async getLocalExplain(params = {}) {
    const res = await api.get('/api/v2/mule/explain/local', { params });
    return res.data;
  },
  async runBiasChecks(payload = {}) {
    const res = await api.post('/api/v2/mule/bias', payload);
    return res.data;
  },
  async compareModels(payload = {}) {
    const res = await api.post('/api/v2/mule/compare', payload);
    return res.data;
  },
  async approveModel(payload = {}) {
    const res = await api.post('/api/v2/mule/approve', payload);
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
  async deleteModel(model_version) {
    const res = await api.post('/api/v2/mule/ml/models/delete', { model_version });
    return res.data;
  },

  async inferModel(payload = {}) {
    const res = await api.post('/api/v2/mule/ml/infer-model', payload);
    return res.data;
  },
  async getInferenceRunContext(params = {}) {
    const res = await api.get('/api/v2/mule/run/context', { params });
    return res.data;
  },
  async getInferencePortfolioOutcome(params = {}) {
    const res = await api.get('/api/v2/mule/portfolio/outcome', { params });
    return res.data;
  },
  async getInferenceAccountsPrioritized(params = {}) {
    const res = await api.get('/api/v2/mule/accounts/prioritized', { params });
    return res.data;
  },
  async getInferenceAccountsMovement(params = {}) {
    const res = await api.get('/api/v2/mule/accounts/movement', { params });
    return res.data;
  },
  async getInferencePortfolioPatterns() {
    const res = await api.get('/api/v2/mule/portfolio/patterns');
    return res.data;
  },
  async getInferenceSuppressionConfidence(params = {}) {
    const res = await api.get('/api/v2/mule/suppression/confidence', { params });
    return res.data;
  },
  async getInferenceRoleClassification(params = {}) {
    const res = await api.get('/api/v2/mule/role/classification', { params });
    return res.data;
  },
  async assignInferenceAccounts(payload = {}) {
    const res = await api.post('/api/v2/mule/accounts/assign', payload);
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
  async getPortfolioSummary() {
    const res = await api.get('/api/v2/mule/portfolio/summary');
    return res.data;
  },
  async getPortfolioMigration() {
    const res = await api.get('/api/v2/mule/portfolio/migration');
    return res.data;
  },
  async getPriorityQueue(params = {}) {
    const res = await api.get('/api/v2/mule/queue/priority', { params });
    return res.data;
  },
  async getEmergingPatterns() {
    const res = await api.get('/api/v2/mule/patterns/emerging');
    return res.data;
  },
  async getTopSignals(params = {}) {
    const res = await api.get('/api/v2/mule/signals/top', { params });
    return res.data;
  },
  async getModelHealth() {
    const res = await api.get('/api/v2/mule/model/health');
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
  async explainAccount(params = {}) {
    const res = await api.get('/api/v2/mule/explain/account', { params });
    return res.data;
  },

  async getAccountSummary(accountId) {
    const res = await api.get(`/api/v2/mule/account/${encodeURIComponent(accountId)}/summary`);
    return res.data;
  }
};

export default muleApi;
