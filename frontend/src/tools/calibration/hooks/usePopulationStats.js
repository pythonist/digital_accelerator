// frontend/src/tools/calibration/hooks/usePopulationStats.js
import { useState, useEffect, useCallback } from 'react';
import apiClient from '@services/api';

export const usePopulationStats = (runId, envId, filters) => {
  const [liveStats, setLiveStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLiveStats = useCallback(async () => {
    if (!runId || !envId) return;

    setLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/population/${runId}/explore`,
        { env_id: envId, filters }
      );
      setLiveStats(res.stats);
    } catch (err) {
      console.error('Live stats failed:', err);
    } finally {
      setLoading(false);
    }
  }, [runId, envId, filters]);

  const fetchEnhancedStats = useCallback(async () => {
    if (!runId || !envId) return;

    try {
      const res = await apiClient.post(
        `/api/v2/calibration/population/${runId}/enhanced-stats`,
        { env_id: envId, filters }
      );
      setEnhancedStats(res.stats);
    } catch (err) {
      console.error('Enhanced stats failed:', err);
    }
  }, [runId, envId, filters]);

  const fetchNarrative = useCallback(async (scenarioName = 'Scenario') => {
    if (!runId) return;

    try {
      const res = await apiClient.post(
        `/api/v2/calibration/population/${runId}/narrative`,
        { scenario_name: scenarioName, filters, stats: liveStats }
      );
      setNarrative(res.narrative);
    } catch (err) {
      console.error('Narrative generation failed:', err);
    }
  }, [runId, filters, liveStats]);

  const fetchPreview = useCallback(async () => {
    if (!runId || !envId) return;

    try {
      const res = await apiClient.post(
        `/api/v2/calibration/population/${runId}/preview`,
        { env_id: envId, filters }
      );
      if (res.success) setPreviewData(res.preview);
    } catch (err) {
      console.error('Preview failed:', err);
    }
  }, [runId, envId, filters]);

  // Auto-fetch on filter change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (runId && envId) {
        fetchLiveStats();
        fetchEnhancedStats();
        fetchPreview();
      }
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [runId, envId, filters]);

  // Fetch narrative when live stats update
  useEffect(() => {
    if (liveStats) {
      fetchNarrative();
    }
  }, [liveStats]);

  return {
    liveStats,
    enhancedStats,
    narrative,
    previewData,
    loading,
    refetch: () => {
      fetchLiveStats();
      fetchEnhancedStats();
      fetchPreview();
    }
  };
};