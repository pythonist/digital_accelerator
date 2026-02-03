import { useState, useCallback } from 'react';
import AMLExtensionsAPI from "@services/api_v2";

/**
 * useCalibrationState Hook
 * 
 * Manages calibration session state:
 * - Baseline (frozen reference)
 * - Active scenario (under construction)
 * - Scenario results (computed metrics)
 * - Approval workflow state
 * - Risk appetite constraints
 * - Calibration history
 */

export const useCalibrationState = (environment) => {
  // BASELINE (frozen, immutable)
  const [baseline, setBaseline] = useState(null);
  const [baselineLoading, setBaselineLoading] = useState(false);

  // ACTIVE SCENARIO (under construction)
  const [scenario, setScenario] = useState(null);
  const [scenarioResults, setScenarioResults] = useState(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);

  // RISK APPETITE (governance bounds)
  const [riskAppetite, setRiskAppetite] = useState({
    maxAcceptableLossPercent: 2.0,
    minHighRiskCustomerFloor: 95.0,
    maxInvestigatorLoadIncrease: 15.0,
  });

  // APPROVAL WORKFLOW
  const [approval, setApproval] = useState({
    status: 'draft', // draft | submitted | approved | rejected | live
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    comments: [],
  });

  // CALIBRATION HISTORY
  const [calibrationRuns, setCalibrationRuns] = useState([]);

  // UTILITY
  const [isDirty, setIsDirty] = useState(false);

  // =========================================================================
  // BASELINE MANAGEMENT
  // =========================================================================

  const loadBaseline = useCallback(async (env) => {
    const envToLoad = env || environment;
    if (!envToLoad) return;
    setBaselineLoading(true);
    try {
      const data = await AMLExtensionsAPI.getCalibrationBaseline(envToLoad);
      setBaseline(data);
    } catch (err) {
      console.error('Failed to load baseline:', err);
    } finally {
      setBaselineLoading(false);
    }
  }, [environment]);

  // =========================================================================
  // SCENARIO MANAGEMENT
  // =========================================================================

  const createScenario = useCallback((name) => {
    if (!baseline) throw new Error('Baseline not loaded');
    
    setScenario({
      id: `scenario_${Date.now()}`,
      name,
      baselineId: environment,
      createdAt: new Date().toISOString(),
      thresholdOverrides: {},
      segmentation: {
        product: null,
        rule: null,
        geography: null,
        riskTier: null,
      },
    });
    setScenarioResults(null);
    setIsDirty(true);
  }, [baseline, environment]);

  const setThresholdOverride = useCallback((segmentKey, newThreshold) => {
    if (!scenario) throw new Error('No active scenario');
    
    setScenario(prev => ({
      ...prev,
      thresholdOverrides: {
        ...prev.thresholdOverrides,
        [segmentKey]: newThreshold,
      },
    }));
    setIsDirty(true);
  }, [scenario]);

  const setSegmentationFilter = useCallback((filter) => {
    if (!scenario) throw new Error('No active scenario');
    
    setScenario(prev => ({
      ...prev,
      segmentation: { ...prev.segmentation, ...filter },
    }));
    setIsDirty(true);
  }, [scenario]);

  const discardScenario = useCallback(() => {
    setScenario(null);
    setScenarioResults(null);
    setIsDirty(false);
  }, []);

  // =========================================================================
  // CALIBRATION EXECUTION
  // =========================================================================

  const runCalibration = useCallback(async () => {
    if (!scenario) throw new Error('No active scenario');
    if (!baseline) throw new Error('Baseline not loaded');

    setScenarioLoading(true);
    try {
      const payload = {
        baselineEnvironment: environment,
        runName: scenario.name,
        candidateThresholds: scenario.thresholdOverrides,
        lookbackDays: 180,
        segmentation: scenario.segmentation,
        riskAppetite: riskAppetite,
      };

      const results = await AMLExtensionsAPI.runCalibration(payload);
      
      setScenarioResults({
        scenarioId: scenario.id,
        ranAt: new Date().toISOString(),
        baselineMetrics: baseline.metrics,
        scenarioMetrics: results.metrics || {},
        impact: results.impact || {},
        riskAssessment: results.riskAssessment || { status: 'unknown' },
        segmentBreakdown: results.segmentBreakdown || {},
      });

      setIsDirty(false);
    } catch (err) {
      console.error('Calibration run error:', err);
      throw err;
    } finally {
      setScenarioLoading(false);
    }
  }, [scenario, baseline, environment, riskAppetite]);

  // =========================================================================
  // APPROVAL WORKFLOW
  // =========================================================================

  const submitForApproval = useCallback(async (submitterName) => {
    if (!scenario || !scenarioResults) {
      throw new Error('Cannot submit: scenario incomplete');
    }

    try {
      const result = await AMLExtensionsAPI.submitCalibrationForApproval(
        scenario.id,
        `Submitted by ${submitterName}`
      );

      setApproval({
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        submittedBy: submitterName,
        approvedAt: null,
        approvedBy: null,
        comments: [],
      });

      return result;
    } catch (err) {
      console.error('Approval submission error:', err);
      throw err;
    }
  }, [scenario, scenarioResults]);

  const approveCalibration = useCallback(async (approverName, comment) => {
    if (approval.status !== 'submitted') {
      throw new Error('Can only approve submitted calibrations');
    }

    try {
      const result = await AMLExtensionsAPI.approveCalibration(
        scenario.id,
        comment
      );

      setApproval(prev => ({
        ...prev,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: approverName,
      }));

      return result;
    } catch (err) {
      console.error('Approval error:', err);
      throw err;
    }
  }, [approval, scenario]);

  // =========================================================================
  // HISTORY & ROLLBACK
  // =========================================================================

  const loadCalibrationHistory = useCallback(async (env) => {
    const envToLoad = env || environment;
    if (!envToLoad) return;
    try {
      const runs = await AMLExtensionsAPI.getCalibrationHistory(envToLoad, 50);
      setCalibrationRuns(Array.isArray(runs) ? runs : []);
    } catch (err) {
      console.error('History load error:', err);
    }
  }, [environment]);

  const rollbackToRun = useCallback(async (calibrationRunId) => {
    try {
      const result = await AMLExtensionsAPI.rollbackCalibration(calibrationRunId);
      // Reload baseline after rollback
      await loadBaseline();
      return result;
    } catch (err) {
      console.error('Rollback error:', err);
      throw err;
    }
  }, [loadBaseline]);

  // =========================================================================
  // RETURN STATE & METHODS
  // =========================================================================

  return {
    // Baseline
    baseline,
    baselineLoading,
    loadBaseline,

    // Scenario
    scenario,
    scenarioResults,
    scenarioLoading,
    createScenario,
    setThresholdOverride,
    setSegmentationFilter,
    discardScenario,
    runCalibration,

    // Approval
    approval,
    submitForApproval,
    approveCalibration,

    // Risk Appetite
    riskAppetite,
    setRiskAppetite,

    // History
    calibrationRuns,
    loadCalibrationHistory,
    rollbackToRun,

    // Utility
    isDirty,
  };
};

export default useCalibrationState;