/**
 * autoPilotApi.js
 * Thin API wrapper for the AutoPilot pipeline endpoints.
 * Calls /api/mlops/autopilot/* routes.
 */
import apiClient from '@services/api';

const autoPilotApi = {
  configure: (payload) =>
    apiClient.post('/api/mlops/autopilot/configure', payload),

  run: (payload) =>
    apiClient.post('/api/mlops/autopilot/run', payload),

  status: (runId) =>
    apiClient.get(`/api/mlops/autopilot/status/${runId}`),

  listRuns: () =>
    apiClient.get('/api/mlops/autopilot/runs'),

  cancel: (runId) =>
    apiClient.post(`/api/mlops/autopilot/cancel/${runId}`, {}),

  deploy: (runId, payload) =>
    apiClient.post(`/api/mlops/autopilot/deploy/${runId}`, payload),

  uploadModel: (formData) =>
    apiClient.postForm('/api/mlops/autopilot/upload-model', formData),
};

export default autoPilotApi;
