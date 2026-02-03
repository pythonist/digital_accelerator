// frontend/src/tools/calibration/hooks/useATLBTLAnalysis.js
import { useState } from 'react';
import apiClient from '@services/api';

export const useATLBTLAnalysis = (runId, envId) => {
  const [atlBtlSplit, setAtlBtlSplit] = useState(null);
  const [volumeSensitivity, setVolumeSensitivity] = useState(null);
  const [strOverlay, setStrOverlay] = useState(null);
  const [behavioralConcentration, setBehavioralConcentration] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentThreshold, setCurrentThreshold] = useState(null);
  const [btlBandPct, setBtlBandPct] = useState(10);

  const fetchATLBTLAnalysis = async (threshold, bandPct = 10, metric = 'amount') => {
    if (!runId || !threshold) return;

    setLoading(true);
    setCurrentThreshold(threshold);
    setBtlBandPct(bandPct);

    try {
      const body = {
        threshold,
        btl_band_pct: bandPct,
        metric,
        env_id: envId
      };

      // Fetch all ATL/BTL components in parallel
      const [split, sensitivity, str, behavior, narr] = await Promise.all([
        apiClient.post(`/api/v2/calibration/atl-btl/${runId}/atl-btl-split`, body),
        apiClient.post(`/api/v2/calibration/atl-btl/${runId}/volume-sensitivity`, body),
        apiClient.post(`/api/v2/calibration/atl-btl/${runId}/str-overlay`, body),
        apiClient.post(`/api/v2/calibration/atl-btl/${runId}/behavioral-concentration`, body),
        apiClient.post(`/api/v2/calibration/atl-btl/${runId}/narrative`, body)
      ]);

      setAtlBtlSplit(split.success ? split : null);
      setVolumeSensitivity(sensitivity.success ? sensitivity : null);
      setStrOverlay(str.success ? str : null);
      setBehavioralConcentration(behavior.success ? behavior : null);
      setNarrative(narr.success ? narr : null);

    } catch (error) {
      console.error('❌ ATL/BTL analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    atlBtlSplit,
    volumeSensitivity,
    strOverlay,
    behavioralConcentration,
    narrative,
    loading,
    currentThreshold,
    btlBandPct,
    fetchATLBTLAnalysis,
    setBtlBandPct
  };
};