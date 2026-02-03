// frontend/src/tools/calibration/hooks/useCalibrationInsights.js
// FIXED VERSION - Corrected API calls with flat params

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@services/api';

export const useCalibrationInsights = (runId, envId) => {
  const [percentiles, setPercentiles] = useState([]);
  const [histogramData, setHistogramData] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [sliderPercentile, setSliderPercentile] = useState(95);
  const [currentThreshold, setCurrentThreshold] = useState(0);
  const [distributionTable, setDistributionTable] = useState([]);
  const [distributionShape, setDistributionShape] = useState(null);
  const [ladder, setLadder] = useState([]);
  const [comprehensiveImpact, setComprehensiveImpact] = useState(null);
  const [rationale, setRationale] = useState('');
  const [loading, setLoading] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [entityOutcome, setEntityOutcome] = useState(null);
  const [entityLoading, setEntityLoading] = useState(false);

  const impactCache = useRef({});
  const entityCache = useRef({});

  useEffect(() => {
    if (runId) {
      loadInitialData();
    }
  }, [runId]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      console.log('📊 Loading calibration data for run:', runId);
      
      const res = await apiClient.post(`/api/v2/calibration/percentile/${runId}/calculate`, {
        env_id: envId,
        metric: 'amount'
      });
      
      setPercentiles(res.percentiles || []);
      setHistogramData(res.histogram || []);
      
      if (!res.percentiles || res.percentiles.length === 0) {
        console.error('❌ No percentiles returned');
        alert('Error: No aggregated data found. Please complete Step 2 first.');
        return;
      }
      
      // Load metadata
      try {
        const metaRes = await apiClient.get(`/api/v2/calibration/percentile/${runId}/metadata`, {
          params: { env_id: envId }
        });
        setMetadata(metaRes.metadata);
      } catch (err) {
        console.error('⚠️ Metadata load failed:', err);
      }
      
      // Load ladder
      try {
        const ladderRes = await apiClient.get(`/api/v2/calibration/percentile/${runId}/ladder`, {
          params: { metric: 'amount', env_id: envId }
        });
        console.log('📊 Ladder data received:', ladderRes.ladder);
        setLadder(ladderRes.ladder || []);
      } catch (err) {
        console.error('⚠️ Ladder load failed:', err);
      }
      
      // Load distribution shape
      try {
        const shapeRes = await apiClient.get(`/api/v2/calibration/percentile/${runId}/distribution-shape`, {
          params: { metric: 'amount', env_id: envId }
        });
        setDistributionShape(shapeRes.distribution_shape);
      } catch (err) {
        console.error('⚠️ Shape load failed:', err);
      }
      
      // Default to p95
      const p95 = res.percentiles.find(p => p.percentile === 95);
      if (p95) {
        updateSelection(95, p95.threshold);
        await loadComprehensiveImpact(p95.threshold, 95);
        await loadDistributionTable(p95.threshold);
        await loadEntityOutcome(p95.threshold, 95);
      }
    } catch (err) {
      console.error('❌ Failed to load calibration data:', err);
      const errorMsg = err.response?.data?.error || err.message;
      if (errorMsg.includes('aggregation') || errorMsg.includes('Step 2')) {
        alert('Error: Aggregation data not found. Please complete Step 2 first.');
      } else {
        alert(`Error loading calibration data: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateSelection = (pct, val) => {
    setSliderPercentile(pct);
    setCurrentThreshold(val);
  };

  const getThresholdForPercentile = useCallback((pct) => {
    if (!percentiles.length) return 0;
    const exact = percentiles.find(p => p.percentile === pct);
    if (exact) return exact.threshold;
    
    const closest = percentiles.reduce((prev, curr) => 
      Math.abs(curr.percentile - pct) < Math.abs(prev.percentile - pct) ? curr : prev
    );
    return closest.threshold;
  }, [percentiles]);

  const handleSliderChange = useCallback((pct) => {
    const amount = getThresholdForPercentile(pct);
    updateSelection(pct, amount);
  }, [getThresholdForPercentile]);

  const handleSliderCommit = useCallback(async (pct) => {
    const amount = getThresholdForPercentile(pct);
    await loadComprehensiveImpact(amount, pct);
    await loadDistributionTable(amount);
    await loadEntityOutcome(amount, pct);
  }, [getThresholdForPercentile, runId]);

  const loadComprehensiveImpact = async (threshold, percentile) => {
    const cacheKey = `${threshold}_${percentile}`;
    if (impactCache.current[cacheKey]) {
      setComprehensiveImpact(impactCache.current[cacheKey]);
      return;
    }
    
    setImpactLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/impact-comprehensive`,
        { 
          threshold, 
          percentile, 
          metric: 'amount',
          env_id: envId 
        }
      );
      
      setComprehensiveImpact(res);
      impactCache.current[cacheKey] = res;
      
      // Auto-generate rationale
      try {
        const rationaleRes = await apiClient.post(
          `/api/v2/calibration/percentile/${runId}/rationale`,
          { 
            threshold, 
            percentile, 
            metric: 'amount',
            env_id: envId 
          }
        );
        setRationale(rationaleRes.auto_text || '');
      } catch (err) {
        console.error('⚠️ Rationale generation failed:', err);
      }
      
    } catch (err) {
      console.error('❌ Failed to load impact:', err);
    } finally {
      setImpactLoading(false);
    }
  };

  const loadEntityOutcome = async (threshold, percentile) => {
    const cacheKey = `${threshold}_${percentile}`;
    if (entityCache.current[cacheKey]) {
      setEntityOutcome(entityCache.current[cacheKey]);
      return;
    }

    setEntityLoading(true);
    try {
      console.log('📄 Loading entity outcome for threshold:', threshold);
      
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/outcome-impact`,
        { 
          threshold, 
          percentile, 
          metric: 'amount',
          env_id: envId 
        }
      );
      
      console.log('✅ Entity outcome loaded:', res);
      setEntityOutcome(res);
      entityCache.current[cacheKey] = res;
      
    } catch (err) {
      console.error('❌ Failed to load entity outcome:', err);
    } finally {
      setEntityLoading(false);
    }
  };

  const loadDistributionTable = async (threshold) => {
    try {
      // ✅ FIX: Use flat params, not nested params[]
      const res = await apiClient.get(
        `/api/v2/calibration/percentile/${runId}/distribution-table`,
        { 
          params: { 
            metric: 'amount', 
            bins: 50, 
            threshold: threshold,
            env_id: envId
          } 
        }
      );
      setDistributionTable(res.bins || []);
    } catch (err) {
      console.error('❌ Failed to load distribution table:', err);
    }
  };

  const jumpToPercentile = useCallback((pct) => {
    const amount = getThresholdForPercentile(pct);
    updateSelection(pct, amount);
    loadComprehensiveImpact(amount, pct);
    loadDistributionTable(amount);
    loadEntityOutcome(amount, pct);
  }, [getThresholdForPercentile]);

  const refreshLadder = async () => {
    try {
      const res = await apiClient.get(`/api/v2/calibration/percentile/${runId}/ladder`, {
        params: { metric: 'amount', env_id: envId }
      });
      setLadder(res.ladder || []);
    } catch (err) {
      console.error('Failed to refresh ladder:', err);
    }
  };

  return {
    // Data
    percentiles,
    histogramData,
    metadata,
    distributionTable,
    distributionShape,
    ladder,
    comprehensiveImpact,
    rationale,
    entityOutcome,
    
    // Selection
    sliderPercentile,
    currentThreshold,
    
    // Actions
    handleSliderChange,
    handleSliderCommit,
    jumpToPercentile,
    setRationale,
    refreshLadder,
    
    // Loading
    loading,
    impactLoading,
    entityLoading
  };
};