// frontend/src/tools/calibration/hooks/useAggregation.js
import { useState, useEffect, useCallback } from 'react';
import apiClient from '@services/api';

/**
 * Custom hook for aggregation operations
 * Handles preview, execution, and state management
 */
export const useAggregation = (runId, envId) => {
  const [config, setConfig] = useState({
    level: 'account',
    time_grain: 'daily',
    lookback_value: 30,
    lookback_unit: 'days',
    frequency: 'daily',
    metrics: ['sum_amount', 'count'],
    filter_history: true
  });

  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch preview with debouncing
  const fetchPreview = useCallback(async () => {
    if (!runId || !envId) return;

    setPreviewLoading(true);
    setError(null);

    try {
      const response = await apiClient.post(
        `/api/v2/calibration/aggregate/${runId}/preview`,
        { env_id: envId, aggregation_config: config }
      );
      setPreviewData(response);
    } catch (err) {
      setError(err.message || 'Preview failed');
      console.error('Preview error:', err);
    } finally {
      setPreviewLoading(false);
    }
  }, [runId, envId, config]);

  // Execute aggregation
  const executeAggregation = useCallback(async () => {
    if (!runId || !envId) return null;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post(
        `/api/v2/calibration/aggregate/${runId}/execute`,
        { env_id: envId, aggregation_config: config }
      );
      return response;
    } catch (err) {
      setError(err.message || 'Execution failed');
      console.error('Execution error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [runId, envId, config]);

  // Update config field
  const updateConfig = useCallback((field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  // Update multiple config fields
  const updateConfigBatch = useCallback((updates) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Reset config to defaults
  const resetConfig = useCallback(() => {
    setConfig({
      level: 'account',
      time_grain: 'daily',
      lookback_value: 30,
      lookback_unit: 'days',
      frequency: 'daily',
      metrics: ['sum_amount', 'count'],
      filter_history: true
    });
  }, []);

  return {
    // State
    config,
    previewData,
    loading,
    previewLoading,
    error,

    // Actions
    updateConfig,
    updateConfigBatch,
    resetConfig,
    fetchPreview,
    executeAggregation,

    // Utilities
    clearError: () => setError(null)
  };
};

export default useAggregation;