// frontend/src/tools/mule_detection/services/muleApi.js
// Enhanced with async training, model management, and decision engine

const BASE_URL = ''; // Empty string for same-origin requests

const getEnvId = (envId = null) => {
  return envId || localStorage.getItem('activeEnvId') || 'fcip_env';
};

const fetchWithHeaders = async (url, options = {}, envId = null) => {
  const effectiveEnvId = getEnvId(envId);
  
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Environment-ID': effectiveEnvId,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return await response.json();
};

const muleApi = {
  // ==================== DATA UPLOAD ====================
  async uploadData(files, envId = null) {
    const formData = new FormData();
    
    if (files.transactions) {
      formData.append('transactions', files.transactions);
    }
    
    if (files.accounts) {
      formData.append('accounts', files.accounts);
    }
    
    const effectiveEnvId = getEnvId(envId);
    
    const response = await fetch('/api/v2/mule/upload', {
      method: 'POST',
      headers: {
        'X-Environment-ID': effectiveEnvId
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return await response.json();
  },

  // ==================== DATA STATUS ====================
  async getDataStatus(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/status', { method: 'GET' }, envId);
  },

  // ==================== ACCOUNTS ====================
  async getAccounts(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/accounts', { method: 'GET' }, envId);
  },

  async getAccountDetail(accountId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/accounts/${accountId}`, { method: 'GET' }, envId);
  },

  async analyzeFlows(accountId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/accounts/${accountId}/flows`, { method: 'GET' }, envId);
  },
  
  async getAccountGraph(accountId, params = {}, envId = null) {
    const qs = new URLSearchParams(params).toString();
    const url = `/api/v2/mule/accounts/${accountId}/graph${qs ? `?${qs}` : ''}`;
    return await fetchWithHeaders(url, { method: 'GET' }, envId);
  },

  // ==================== PATTERNS ====================
  async detectPatterns(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/patterns', { method: 'GET' }, envId);
  },

  // ==================== INTROSPECTION ====================
  async getIntrospection(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/introspect', { method: 'GET' }, envId);
  },

  // ==================== ASYNC ML TRAINING ====================
  
  // Start training job (returns immediately with job_id)
  async trainMLModel(config = {}, envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/train', {
      method: 'POST',
      body: JSON.stringify(config)
    }, envId);
  },

  // Poll training status
  async getTrainingStatus(jobId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/ml/train/${jobId}/status`, {
      method: 'GET'
    }, envId);
  },

  // Get final training result
  async getTrainingResult(jobId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/ml/train/${jobId}/result`, {
      method: 'GET'
    }, envId);
  },

  // ==================== MODEL MANAGEMENT ====================
  
  // List all models
  async listModels(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/models', {
      method: 'GET'
    }, envId);
  },

  // Get specific model details
  async getModelDetails(modelVersion, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/ml/models/${modelVersion}`, {
      method: 'GET'
    }, envId);
  },

  // Activate model (deployment step)
  async activateModel(modelVersion, envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/models/activate', {
      method: 'POST',
      body: JSON.stringify({ model_version: modelVersion })
    }, envId);
  },

  // ==================== DECISION ENGINE ====================
  
  // Get prediction with Decision Engine
  async getPrediction(accountId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/ml/predict/${accountId}`, {
      method: 'GET'
    }, envId);
  },

  // Get Decision Engine config
  async getDecisionEngineConfig(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/decision-engine/config', {
      method: 'GET'
    }, envId);
  },

  // Update Decision Engine config
  async updateDecisionEngineConfig(config, envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/decision-engine/config', {
      method: 'POST',
      body: JSON.stringify(config)
    }, envId);
  },

  // Simulate Decision Engine
  async simulateDecisionEngine(params, envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/decision-engine/simulate', {
      method: 'POST',
      body: JSON.stringify(params)
    }, envId);
  },

  // ==================== BATCH OPERATIONS ====================
  
  // Batch predict all accounts
  async batchPredict(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/batch-predict', {
      method: 'POST',
      body: JSON.stringify({})
    }, envId);
  },

  // ==================== EXPLAINABILITY ====================
  
  // Get feature importance
  async getFeatureImportance(envId = null) {
    return await fetchWithHeaders('/api/v2/mule/ml/feature-importance', {
      method: 'GET'
    }, envId);
  },

  // Get detailed explanation for account
  async explainPrediction(accountId, envId = null) {
    return await fetchWithHeaders(`/api/v2/mule/ml/explain/${accountId}`, {
      method: 'GET'
    }, envId);
  },

  // ==================== LEGACY ENDPOINTS (backward compatibility) ====================
  
  async getMLModelInfo(envId = null) {
    // This now lists models and returns active one
    const response = await this.listModels(envId);
    const activeModel = response.models?.find(m => m.status === 'ACTIVE');
    
    if (activeModel) {
      return {
        has_model: true,
        model_info: {
          trained_at: activeModel.trained_at,
          training_samples: activeModel.training_samples,
          feature_count: activeModel.feature_count,
          metrics: {
            val_auc: activeModel.auc,
            val_recall: activeModel.recall,
            val_precision: activeModel.precision
          }
        },
        feature_importance: {} // Will be fetched separately if needed
      };
    }
    
    return {
      has_model: false
    };
  },

  async getMLPrediction(accountId, envId = null) {
    // Redirects to new Decision Engine endpoint
    return await this.getPrediction(accountId, envId);
  }
};

export default muleApi;
