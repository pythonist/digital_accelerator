// frontend/src/tools/calibration/hooks/useKSAnalysis.js
import { useState } from 'react';
import apiClient from '@services/api';

export const useKSAnalysis = (runId, envId) => {
  const [ksStatistic, setKsStatistic] = useState(null);
  const [ksSensitivity, setKsSensitivity] = useState(null);
  const [cdfData, setCdfData] = useState(null);
  const [ksNarrative, setKsNarrative] = useState(null);
  const [ksLoading, setKsLoading] = useState(false);
  const [cdfLoading, setCdfLoading] = useState(false);

  const handleThresholdChange = async (threshold, percentile, metric = 'amount') => {
    if (!runId || !threshold) return;

    setKsLoading(true);

    try {
      const body = {
        threshold,
        metric,
        env_id: envId
      };

      // Fetch KS statistic with narrative
      const ksRes = await apiClient.post(
        `/api/v2/calibration/ks/${runId}/ks-narrative`,
        body
      );

      setKsStatistic(ksRes.ks_result || null);
      setKsNarrative(ksRes.narrative || null);

      // Fetch KS sensitivity curve
      const sensitivityRes = await apiClient.get(
        `/api/v2/calibration/ks/${runId}/ks-sensitivity`,
        { params: { metric, env_id: envId } }
      );

      setKsSensitivity(sensitivityRes || null);

    } catch (error) {
      console.error('❌ KS analysis failed:', error);
    } finally {
      setKsLoading(false);
    }

    // Fetch CDF comparison
    setCdfLoading(true);
    try {
      const cdfRes = await apiClient.post(
        `/api/v2/calibration/ks/${runId}/ks-cdf`,
        {
          threshold,
          metric,
          points: 100,
          env_id: envId
        }
      );

      setCdfData(cdfRes || null);

    } catch (error) {
      console.error('❌ CDF data failed:', error);
    } finally {
      setCdfLoading(false);
    }
  };

  return {
    ksStatistic,
    ksSensitivity,
    cdfData,
    ksNarrative,
    ksLoading,
    cdfLoading,
    handleThresholdChange
  };
};