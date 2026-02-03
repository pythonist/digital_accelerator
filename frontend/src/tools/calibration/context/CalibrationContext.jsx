// ============================================================================
// frontend/tools/calibration/context/CalibrationContext.jsx
// Complete Calibration Context - LOOP PREVENTION FIX
// ============================================================================
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '@services/api';

const CalibrationContext = createContext();

export const useCalibration = () => {
  const context = useContext(CalibrationContext);
  if (!context) {
    throw new Error('useCalibration must be used within CalibrationProvider');
  }
  return context;
};

export const CalibrationProvider = ({ children, envId, userId }) => {
  // ============================================================================
  // 1. STATE MANAGEMENT
  // ============================================================================
  
  // Core run state
  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 0 State (Data Foundation)
  const [datasets, setDatasets] = useState([]);
  const [joinPlan, setJoinPlan] = useState(null);
  const [savedPlans, setSavedPlans] = useState([]);
  const [step0Complete, setStep0Complete] = useState(false);
  const [validationData, setValidationData] = useState(null);

  // Workflow State (Data cache)
  const [scenarioConfig, setScenarioConfig] = useState(null);
  const [scenarioStats, setScenarioStats] = useState(null);
  const [aggregationConfig, setAggregationConfig] = useState(null);
  const [aggregationStats, setAggregationStats] = useState(null);
  const [percentiles, setPercentiles] = useState([]);
  const [simulations, setSimulations] = useState([]);
  const [selectedThreshold, setSelectedThreshold] = useState(null);

  // Navigation state
  const [currentStep, setCurrentStep] = useState('data_load');
  
  // 🔥 CRITICAL FIX: Prevent navigation loops
  const isNavigatingRef = useRef(false);
  const lastStatusRef = useRef(null);

  // ============================================================================
  // 2. NAVIGATION HELPER - LOOP PREVENTION
  // ============================================================================

  const goToStep = useCallback((step) => {
    if (isNavigatingRef.current) {
      console.log('🚫 [Navigation] Already navigating, ignoring jump to:', step);
      return;
    }
    
    console.log('🧭 [Navigation] Manual jump to:', step);
    isNavigatingRef.current = true;
    
    setCurrentStep(step);
    
    // Reset flag after navigation completes
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 300);
  }, []);

  const determineCurrentStep = useCallback((status) => {
    if (!status || isNavigatingRef.current) {
      return;
    }
    
    // 🔥 FIX: Don't re-navigate if status hasn't changed
    if (status === lastStatusRef.current) {
      console.log(`♻️ [Navigation] Status unchanged (${status}), skipping navigation`);
      return;
    }
    
    lastStatusRef.current = status;
    
    const normalizedStatus = status.toUpperCase();
    const stepMap = {
      'DRAFT': 'scenario',
      'SCENARIO_DEFINED': 'aggregation',
      'POPULATION_CONFIRMED': 'aggregation',
      'AGGREGATED': 'validation',
      'VALIDATED': 'calibration',
      'SIMULATED': 'calibration',
      'THRESHOLD_SELECTED': 'approval',
      'APPROVED': 'summary',
      'REJECTED': 'scenario'
    };
    
    const nextStep = stepMap[normalizedStatus];
    
    if (nextStep && nextStep !== currentStep) {
      console.log(`📍 [Navigation] Status '${status}' → Screen '${nextStep}'`);
      setCurrentStep(nextStep);
    }
  }, [currentStep]);

  // ============================================================================
  // 3. STEP 0 ACTIONS (Data Foundation)
  // ============================================================================

  const loadDatasets = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      setDatasets(response.datasets || []);
      return response.datasets;
    } catch (err) {
      console.error('❌ [Step 0] Failed to load datasets:', err);
    }
  }, [envId]);

  const loadSavedPlans = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/v2/calibration/data/merge/plans', {
        params: { env_id: envId }
      });
      setSavedPlans(response.plans || []);
    } catch (err) {
      console.error('❌ [Step 0] Failed to load plans:', err);
    }
  }, [envId]);

  const checkStep0Readiness = useCallback(async () => {
    console.log('🔍 [Step 0] Checking readiness...');
    try {
      const response = await apiClient.get('/api/v2/calibration/data/readiness', {
        params: { env_id: envId }
      });

      const isReady = response.ready || false;
      setStep0Complete(isReady);
      
      if (response.summary) {
        setValidationData(response);
      }
      
      console.log('✅ [Step 0] Readiness:', isReady ? 'READY' : 'NOT READY');
      return response;
    } catch (err) {
      console.error('❌ [Step 0] Readiness check failed:', err);
    }
  }, [envId]);

  // Init Effects
  useEffect(() => {
    if (envId) {
      console.log('🔔 [CONTEXT] Initializing for Env:', envId);
      loadDatasets();
      loadSavedPlans();
      checkStep0Readiness();
    }
  }, [envId, loadDatasets, loadSavedPlans, checkStep0Readiness]);

  const uploadDataset = useCallback(async (file, datasetName) => {
    console.log('📤 [Step 0] Uploading dataset:', datasetName);
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('env_id', envId);
      if (datasetName) formData.append('dataset_name', datasetName);

      const response = await apiClient.post('/api/v2/calibration/data/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      console.log('✅ [Step 0] Dataset uploaded:', response.dataset_id);
      await loadDatasets();
      await checkStep0Readiness();
      return response;
    } catch (err) {
      console.error('❌ [Step 0] Upload failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId, loadDatasets, checkStep0Readiness]);

  const saveJoinPlan = useCallback(async (planName, chain) => {
    console.log('💾 [Step 0] Saving join plan:', planName);
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post('/api/v2/calibration/data/merge/save', {
        env_id: envId,
        name: planName,
        chain: chain,
        create_view: true
      });

      setJoinPlan({
        plan_id: response.plan_id,
        plan_name: planName,
        chain: chain
      });
      
      console.log('✅ [Step 0] Join plan saved:', response.plan_id);
      await loadSavedPlans();
      await checkStep0Readiness();
      return response;
    } catch (err) {
      console.error('❌ [Step 0] Failed to save join plan:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId, loadSavedPlans, checkStep0Readiness]);

  const loadJoinPlan = useCallback(async (planId) => {
    console.log('🔥 [Step 0] Loading join plan:', planId);
    setLoading(true);
    
    try {
      const response = await apiClient.get(`/api/v2/calibration/data/merge/plan/${planId}`, {
        params: { env_id: envId }
      });
      
      if (response.success && response.plan) {
        setJoinPlan(response.plan);
        console.log('✅ [Step 0] Join plan loaded');
        return response.plan;
      }
      throw new Error('Failed to load plan');
    } catch (err) {
      console.error('❌ [Step 0] Failed to load plan:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId]);

  const previewJoin = useCallback(async (chain) => {
    console.log('🔍 [Step 0] Previewing join...');
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post('/api/v2/calibration/data/merge/preview', {
        env_id: envId,
        chain: chain
      });

      console.log('✅ [Step 0] Preview generated');
      return response;
    } catch (err) {
      console.error('❌ [Step 0] Preview failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId]);

  // ============================================================================
  // 🎯 CRITICAL: Complete Step 0 → Auto-create Run → Move to Step 1
  // ============================================================================
  const completeStep0 = useCallback(async (datasetMapping, joinPlanId = null) => {
    console.log('🎯 [Step 0] Completing Step 0...');
    setLoading(true);
    setError(null);
    
    try {
      const payload = {};
      if (datasetMapping) payload.dataset_mapping = datasetMapping;
      if (joinPlanId) payload.join_plan_id = joinPlanId;

      console.log('📤 [Step 0] Sending payload:', payload);

      const step0Response = await apiClient.post(
        `/api/v2/calibration/data/complete-step0?env_id=${envId}`, 
        payload
      );

      if (!step0Response.success) {
        throw new Error(step0Response.error || 'Failed to complete Step 0');
      }

      setStep0Complete(true);
      console.log('✅ [Step 0] Complete! View created:', step0Response.view_created);
      
      // 2. 🆕 AUTO-CREATE CALIBRATION RUN
      console.log('🆕 [Step 0→1] Auto-creating calibration run...');
      
      const runResponse = await apiClient.post('/api/v2/calibration/run/create', {
        env_id: envId,
        scenario_name: 'New Calibration Scenario'
      });

      const newRun = runResponse.run || runResponse;
      console.log('✅ [Run] Created:', newRun.run_id);
      
      setRunId(newRun.run_id);
      setRun(newRun);
      lastStatusRef.current = newRun.status; // 🔥 FIX: Track initial status
      
      // 3. Navigate to Step 1 (Population Extraction/Scenario)
      console.log('🎯 [Step 0→1] Proceeding to Population Definition (Step 1)');
      goToStep('scenario');
      
      return {
        step0: step0Response,
        run: newRun
      };
      
    } catch (err) {
      console.error('❌ [Step 0] Completion failed:', err);
      setError(err.message || 'Failed to complete Step 0');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId, goToStep]);

  // ============================================================================
  // 4. CORE WORKFLOW ACTIONS (Steps 1-5)
  // ============================================================================

  // 🆕 Create Run (Manual - if user wants to create run separately)
  const createRun = useCallback(async (scenarioName) => {
    console.log('🆕 [Run] Creating new run:', scenarioName);
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post('/api/v2/calibration/run/create', {
        env_id: envId,
        scenario_name: scenarioName
      });

      const newRun = response.run || response;
      console.log('✅ [Run] Created:', newRun.run_id);
      
      setRunId(newRun.run_id);
      setRun(newRun);
      lastStatusRef.current = newRun.status; // 🔥 FIX: Track initial status
      goToStep('scenario');
      
      return newRun;
    } catch (err) {
      console.error('❌ [Run] Creation failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId, goToStep]);

  // Load Run
  const loadRun = useCallback(async (id) => {
    console.log('🔥 [Run] Loading run:', id);
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.get(`/api/v2/calibration/run/${id}`, {
        params: { env_id: envId }
      });

      const loadedRun = response.run || response;
      console.log('✅ [Run] Loaded:', loadedRun.run_id, '| Status:', loadedRun.status);
      
      setRunId(id);
      setRun(loadedRun);
      lastStatusRef.current = loadedRun.status; // 🔥 FIX: Track status on load
      
      if (loadedRun.scenario_config) {
        setScenarioConfig(loadedRun.scenario_config);
      }
      if (loadedRun.aggregation_config) {
        setAggregationConfig(loadedRun.aggregation_config);
      }
      
      determineCurrentStep(loadedRun.status);
      return loadedRun;
    } catch (err) {
      console.error('❌ [Run] Load failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [envId, determineCurrentStep]);

  // Step 1: Save Scenario Config (Optional)
  const saveScenario = useCallback(async (config) => {
    if (!runId) {
      console.error('❌ No run_id available');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(`/api/v2/calibration/population/${runId}/save-config`, {
        ...config,
        env_id: envId
      });
      
      if (response.success) {
        setScenarioConfig(config);
        console.log('✅ Scenario config saved');
      }
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [runId, envId]);

  // Step 1 → Step 2: Confirm Population Filters
  const confirmAndContinue = useCallback(async (filters) => {
    if (!runId) {
      console.error('❌ No run_id available');
      return;
    }
    
    console.log('✅ [Step 1→2] Confirming population filters...');
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post(`/api/v2/calibration/population/${runId}/confirm`, {
        env_id: envId,
        filters: filters
      });
      
      if (response.success) {
        const updatedRun = response.run;
        setRun(updatedRun);
        setScenarioConfig(filters);
        lastStatusRef.current = updatedRun.status; // 🔥 FIX: Update status tracker
        
        // ✅ NO AUTO-NAVIGATION - let screen handle it
        console.log('✅ [Step 1→2] Filters confirmed, ready for manual navigation');
        
        return updatedRun;
      }
    } catch (err) {
      console.error('❌ [Step 1] Confirmation failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [runId, envId]);

  // Step 2 → Step 3: Execute Aggregation
  // Line ~477
const saveAggregation = useCallback(async (config) => {
  if (!runId) {
    console.error('❌ No run_id available');
    return;
  }
  
  console.log('⚙️ [Step 2→3] Executing aggregation...');
  setLoading(true);
  setError(null);
  
  try {
    // ✅ FIX: Send env_id separately, not inside config
    const response = await apiClient.post(`/api/v2/calibration/aggregate/${runId}/run`, {
      env_id: envId,
      aggregation_config: config  // Send config as nested object
    });
    
    if (response.success) {
      setAggregationConfig(config);
      setAggregationStats(response.stats);
      
      // 🔥 FIX: Update run status if returned
      if (response.run) {
        setRun(response.run);
        lastStatusRef.current = response.run.status;
      }
      
      // ✅ NO AUTO-NAVIGATION - let screen handle it
      console.log('✅ [Step 2→3] Aggregation complete, ready for manual navigation');
      
      return response;
    }
  } catch (err) {
    console.error('❌ [Step 2] Aggregation failed:', err);
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
}, [runId, envId]);

  // Step 3: Load Percentiles
  const loadPercentiles = useCallback(async () => {
    if (!runId) return;
    
    try {
      const response = await apiClient.get(`/api/v2/calibration/calibration/${runId}/percentiles`, {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setPercentiles(response.percentiles || []);
      }
    } catch (err) {
      console.error('❌ Failed to load percentiles:', err);
    }
  }, [runId, envId]);

  // Step 3: Simulate Threshold
  const simulateThreshold = useCallback(async (threshold) => {
    if (!runId) return;
    
    setLoading(true);
    try {
      const response = await apiClient.post(`/api/v2/calibration/calibration/${runId}/simulate`, {
        env_id: envId,
        threshold: threshold
      });
      
      if (response.success) {
        setSimulations(prev => [...prev, response.result]);
        return response.result;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [runId, envId]);

  // Step 3 → Step 4: Select Threshold
  // frontend/src/tools/calibration/context/CalibrationContext.jsx

// Find the selectThreshold function (around line 556)

const selectThreshold = useCallback(async (threshold, percentile, alertCount, rationale) => {
  if (!runId) return;
  
  console.log('✅ [Step 3→4] Selecting threshold:', threshold);
  setLoading(true);
  setError(null);
  
  try {
    // ✅ FIX: Use correct endpoint path
    const response = await apiClient.post(
      `/api/v2/calibration/threshold/${runId}/select-threshold`,  // Changed from /calibration/ to /threshold/
      {
        env_id: envId,
        threshold: threshold,
        percentile: percentile,
        alert_count: alertCount,
        rationale: rationale
      }
    );
    
    let updatedRun = response.run || response;
    
    if (!updatedRun || !updatedRun.status) {
      console.warn('⚠️ Response incomplete, reloading run...');
      updatedRun = await loadRun(runId);
    } else {
      setRun(updatedRun);
      lastStatusRef.current = updatedRun.status;
    }
    
    setSelectedThreshold(threshold);
    
    // ✅ Navigate to approval screen
    console.log('✅ [Step 3→4] Threshold selected, navigating to approval');
    goToStep('approval');
    
    return updatedRun;
  } catch (err) {
    console.error('❌ [Step 3] Threshold selection failed:', err);
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
}, [runId, envId, loadRun, goToStep]);

  // Step 4 → Step 5: Approve Run
  const approveRun = useCallback(async (comments) => {
  if (!runId) return;
  
  console.log('✅ [Step 4→5] Approving run...');
  setLoading(true);
  setError(null);
  
  try {
    const response = await apiClient.post(
      `/api/v2/calibration/approval/${runId}/approve`,
      {
        env_id: envId,
        user_id: userId,
        comments
      }
    );
    
    let updatedRun = response.run || response;
    
    if (!updatedRun || !updatedRun.status) {
      console.warn('⚠️ Response incomplete, reloading run...');
      updatedRun = await loadRun(runId);
    } else {
      setRun(updatedRun);
      lastStatusRef.current = updatedRun.status;
    }
    
    // ✅ 🔥 THIS IS THE FIX
    console.log('🧭 [Step 4→5] Navigating to Final Report');
    goToStep('summary');

    return updatedRun;
  } catch (err) {
    console.error('❌ [Step 4] Approval failed:', err);
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
}, [runId, envId, userId, loadRun, goToStep]);


  // Step 4: Reject Run
  const rejectRun = useCallback(async (comments) => {
    if (!runId) return;
    
    console.log('❌ [Step 4] Rejecting run...');
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post(`/api/v2/calibration/approval/${runId}/reject`, {
        env_id: envId,
        user_id: userId,
        comments
      });
      
      let updatedRun = response.run || response;
      
      if (!updatedRun || !updatedRun.status) {
        console.warn('⚠️ Response incomplete, reloading run...');
        updatedRun = await loadRun(runId);
      } else {
        setRun(updatedRun);
        lastStatusRef.current = updatedRun.status; // 🔥 FIX
      }
      
      // ✅ NO AUTO-NAVIGATION
      console.log('✅ [Step 4] Run rejected, ready for manual navigation');
      
      return updatedRun;
    } catch (err) {
      console.error('❌ [Step 4] Rejection failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [runId, envId, userId, loadRun]);

  // Reset Run
  const resetRun = useCallback(() => {
    console.log('🔄 [Reset] Clearing all calibration state');
    setRunId(null);
    setRun(null);
    setScenarioConfig(null);
    setScenarioStats(null);
    setAggregationConfig(null);
    setAggregationStats(null);
    setPercentiles([]);
    setSimulations([]);
    setSelectedThreshold(null);
    setCurrentStep('data_load');
    setError(null);
    lastStatusRef.current = null; // 🔥 FIX: Reset status tracker
    isNavigatingRef.current = false; // 🔥 FIX: Reset nav flag
  }, []);

  // ============================================================================
  // 5. PROVIDER VALUE
  // ============================================================================

  const value = {
    // State
    runId,
    run,
    loading,
    error,
    currentStep,
    scenarioConfig,
    scenarioStats,
    aggregationConfig,
    aggregationStats,
    percentiles,
    simulations,
    selectedThreshold,

    // Step 0 State
    datasets,
    joinPlan,
    savedPlans,
    step0Complete,
    validationData,

    // Actions
    createRun,
    loadRun,
    saveScenario,
    confirmAndContinue,
    saveAggregation,
    loadPercentiles,
    simulateThreshold,
    selectThreshold,
    approveRun,
    rejectRun,
    
    // Step 0 Actions
    uploadDataset,
    loadDatasets,
    saveJoinPlan,
    loadSavedPlans,
    loadJoinPlan,
    previewJoin,
    checkStep0Readiness,
    completeStep0,
    
    // Utilities
    goToStep,
    resetRun,
    setError,
    clearError: () => setError(null)
  };

  return (
    <CalibrationContext.Provider value={value}>
      {children}
    </CalibrationContext.Provider>
  );
};