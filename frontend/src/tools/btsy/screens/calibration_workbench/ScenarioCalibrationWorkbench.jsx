import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Tabs,
  Tab,
  Divider,
  Alert,
  Chip,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Button
} from '@mui/material';
import btsyApi from '../../services/btsyApi';
import { emitGuideEvent } from '../../guides/guideEvents';
import WorkbenchLeftPanel from './components/WorkbenchLeftPanel';
import EntityReductionView from './views/EntityReductionView';
import SignalDistributionView from './views/SignalDistributionView';
import ThresholdSimulationView from './views/ThresholdSimulationView';
import RiskSplitView from './views/RiskSplitView';
import WorkbenchEvidencePanel from './components/WorkbenchEvidencePanel';
import WorkbenchValidationPanel from './components/WorkbenchValidationPanel';
import OrchestratedCalibrationRun from './OrchestratedCalibrationRun';
import Step3GuideController from './components/Step3GuideController';
import FinalizeDecisionDialog from './components/FinalizeDecisionDialog';

const ScenarioCalibrationWorkbench = () => {
  const [mode, setMode] = useState('manual');
  const [behaviorRuns, setBehaviorRuns] = useState([]);
  const [selectedBehaviorRunId, setSelectedBehaviorRunId] = useState('');
  const [hintedCortexRunId, setHintedCortexRunId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const [aggregateView, setAggregateView] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [stageTab, setStageTab] = useState('reduce');
  const [boundaryTab, setBoundaryTab] = useState('split');
  const [bottomTab, setBottomTab] = useState('evidence');
  const [selectedBoundaryId, setSelectedBoundaryId] = useState(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [boundariesCount, setBoundariesCount] = useState(0);
  const [ksRunsCount, setKsRunsCount] = useState(0);
  const [step36RunsCount, setStep36RunsCount] = useState(0);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [finalizeSummary, setFinalizeSummary] = useState(null);
  const lastUiEventRef = useRef({});

  const sessionMeta = sessionData?.session || null;
  const aggregationConfig = sessionData?.aggregation || null;
  const runSelectionLocked = !!selectedSessionId;

  const selectedRun = useMemo(() => {
    const rid = parseInt(selectedBehaviorRunId, 10);
    return behaviorRuns.find(r => r.behavior_run_id === rid) || null;
  }, [behaviorRuns, selectedBehaviorRunId]);

  const loadBehaviorRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.behavior.listRuns();
      if (res.success) setBehaviorRuns(res.data || []);
      else setError(res.error || 'Failed to load behaviour runs');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async (behaviorRunId) => {
    if (!behaviorRunId) {
      setSessions([]);
      setSelectedSessionId('');
      setSessionData(null);
      setAggregateView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.calibration.listSessions(behaviorRunId);
      if (res.success) setSessions(res.data || []);
      else setError(res.error || 'Failed to load calibration sessions');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async (sessionId) => {
    if (!sessionId) {
      setSessionData(null);
      setAggregateView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.calibration.getSession(sessionId);
      if (res.success) {
        setSessionData(res.data);
        const aggRes = await btsyApi.calibration.getAggregateView(sessionId, 200);
        if (aggRes.success) setAggregateView(aggRes.data);
      } else {
        setError(res.error || 'Failed to load session');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async () => {
    if (!selectedBehaviorRunId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.calibration.createSession(parseInt(selectedBehaviorRunId, 10), 'user');
      if (!res.success) {
        setError(res.error || 'Failed to create session');
        return;
      }
      await loadSessions(parseInt(selectedBehaviorRunId, 10));
      const newId = res.data?.session?.session_id;
      if (newId) {
        setSelectedSessionId(String(newId));
        setSessionData(res.data);
        emitGuideEvent('CALIBRATION_SESSION_CREATED', { sessionId: newId });
        const aggRes = await btsyApi.calibration.getAggregateView(newId, 200);
        if (aggRes.success) setAggregateView(aggRes.data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFreezeSession = async () => {
    if (!selectedSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.calibration.freezeSession(parseInt(selectedSessionId, 10), 'user');
      if (res.success) setSessionData(res.data);
      else setError(res.error || 'Failed to freeze session');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const logUiEvent = async (eventType, event) => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid) return;
    try {
      await btsyApi.calibration.addEvent(sid, eventType, event || {}, 'user');
    } catch (e) {
      return;
    }
  };

  const openFinalize = async () => {
    if (!selectedSessionId) return;
    logUiEvent('ui_finalize_opened', { session_id: parseInt(selectedSessionId, 10) });
    setFinalizeOpen(true);
    setFinalizeLoading(true);
    setFinalizeError('');
    try {
      const res = await btsyApi.calibration.getFinalizeSummary(
        parseInt(selectedSessionId, 10),
        selectedBoundaryId ? parseInt(selectedBoundaryId, 10) : null
      );
      if (!res.success) {
        setFinalizeError(res.error || 'Failed to load summary');
        setFinalizeSummary(null);
        return;
      }
      setFinalizeSummary(res.data);
    } catch (e) {
      setFinalizeError(e.message || 'Failed to load summary');
      setFinalizeSummary(null);
    } finally {
      setFinalizeLoading(false);
    }
  };

  const freezeFromFinalize = async () => {
    logUiEvent('ui_freeze_confirmed', { session_id: parseInt(selectedSessionId, 10) });
    await handleFreezeSession();
    setFinalizeOpen(false);
  };

  const refreshAggregateView = async () => {
    if (!selectedSessionId) return;
    const aggRes = await btsyApi.calibration.getAggregateView(parseInt(selectedSessionId, 10), 200);
    if (aggRes.success) setAggregateView(aggRes.data);
  };

  useEffect(() => { loadBehaviorRuns(); }, []);
  useEffect(() => {
    const hintedRunId = sessionStorage.getItem('btsy_step3_cortex_run_id');
    if (!hintedRunId) return;
    setHintedCortexRunId(String(hintedRunId));
    sessionStorage.removeItem('btsy_step3_cortex_run_id');
  }, []);
  useEffect(() => {
    if (!behaviorRuns.length) return;
    const hintedRunId = sessionStorage.getItem('btsy_step3_behavior_run_id');
    if (!hintedRunId) return;
    if (String(hintedRunId) === String(selectedBehaviorRunId || '')) {
      sessionStorage.removeItem('btsy_step3_behavior_run_id');
      return;
    }
    setSelectedSessionId('');
    setSessionData(null);
    setAggregateView(null);
    setSelectedBoundaryId(null);
    setSelectedStrategyId(null);
    setSelectedBehaviorRunId(String(hintedRunId));
    setStageTab('reduce');
    sessionStorage.removeItem('btsy_step3_behavior_run_id');
  }, [behaviorRuns, selectedBehaviorRunId]);

  useEffect(() => {
    const handler = (ev) => {
      const detail = ev?.detail || {};
      if (detail.stage) setStageTab(detail.stage);
      if (detail.boundaryTab) setBoundaryTab(detail.boundaryTab);
      if (detail.bottomTab) setBottomTab(detail.bottomTab);
    };
    window.addEventListener('btsy:calibration:navigate', handler);
    return () => window.removeEventListener('btsy:calibration:navigate', handler);
  }, []);

  useEffect(() => {
    if (!selectedBehaviorRunId) return;
    loadSessions(parseInt(selectedBehaviorRunId, 10));
  }, [selectedBehaviorRunId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    loadSession(parseInt(selectedSessionId, 10));
  }, [selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid || !sessionMeta) return;
    const key = `session_selected:${sid}`;
    if (lastUiEventRef.current.session_selected === key) return;
    lastUiEventRef.current.session_selected = key;
    logUiEvent('ui_session_selected', {
      session_id: sid,
      behavior_run_id: sessionMeta.behavior_run_id,
      universe_id: sessionMeta.universe_id,
      entity_level: sessionMeta.entity_level,
      metric_name: sessionMeta.metric_name,
      window: sessionMeta.window
    });
  }, [selectedSessionId, sessionMeta]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid) return;
    const key = `stage:${stageTab}`;
    if (lastUiEventRef.current.stage === key) return;
    lastUiEventRef.current.stage = key;
    logUiEvent('ui_stage_changed', { stage: stageTab });
  }, [stageTab, selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid) return;
    const key = `boundary_tab:${boundaryTab}`;
    if (lastUiEventRef.current.boundary_tab === key) return;
    lastUiEventRef.current.boundary_tab = key;
    logUiEvent('ui_boundary_tab_changed', { tab: boundaryTab });
  }, [boundaryTab, selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid) return;
    const key = `bottom_tab:${bottomTab}`;
    if (lastUiEventRef.current.bottom_tab === key) return;
    lastUiEventRef.current.bottom_tab = key;
    logUiEvent('ui_bottom_tab_changed', { tab: bottomTab });
  }, [bottomTab, selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid || !selectedBoundaryId) return;
    const key = `boundary_selected:${selectedBoundaryId}`;
    if (lastUiEventRef.current.boundary_selected === key) return;
    lastUiEventRef.current.boundary_selected = key;
    logUiEvent('ui_boundary_selected', { boundary_id: selectedBoundaryId });
  }, [selectedBoundaryId, selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid || !selectedStrategyId) return;
    const key = `strategy_selected:${selectedStrategyId}`;
    if (lastUiEventRef.current.strategy_selected === key) return;
    lastUiEventRef.current.strategy_selected = key;
    logUiEvent('ui_strategy_selected', { strategy_id: selectedStrategyId });
  }, [selectedStrategyId, selectedSessionId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    if (!sid) {
      setBoundariesCount(0);
      setKsRunsCount(0);
      setStep36RunsCount(0);
      return;
    }
    (async () => {
      const b = await btsyApi.risk.listBoundaries(sid);
      if (b.success) setBoundariesCount((b.data || []).length);
      const k = await btsyApi.validation.listKsRuns(sid);
      if (k.success) setKsRunsCount((k.data || []).length);
      const j = await btsyApi.validation.listStep36Runs(sid);
      if (j.success) setStep36RunsCount((j.data || []).length);
    })();
  }, [selectedSessionId]);

  const startOrchestrated = () => {
    setMode('orchestrated');
  };

  const openThresholdSimulation = () => {
    setMode('manual');
    setStageTab('boundary');
    setBoundaryTab('threshold');
  };

  const openRiskSplit = () => {
    setMode('manual');
    setStageTab('boundary');
    setBoundaryTab('split');
  };
  const navigateToBehavior = () => {
    window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen: 'behavior' } }));
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Scenario Calibration Workbench
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Step-3 consumes Step-2 signals in a read-only, reproducible flow.
          </Typography>
        </Box>
        <Step3GuideController
          selectedBehaviorRunId={selectedBehaviorRunId}
          selectedSessionId={selectedSessionId}
          aggregationConfig={aggregationConfig}
          strategiesCount={(sessionData?.strategies || []).length}
          boundariesCount={boundariesCount}
          ksRunsCount={ksRunsCount}
          step36RunsCount={step36RunsCount}
        />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      <Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0, mb: 1.5, p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Source Behaviour</Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Run ID</TableCell>
                  <TableCell>{selectedRun?.behavior_run_id || sessionMeta?.behavior_run_id ? `R-${String(selectedRun?.behavior_run_id || sessionMeta?.behavior_run_id).padStart(3, '0')}` : '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Scenario Run</TableCell>
                  <TableCell>{hintedCortexRunId ? `C-${String(hintedCortexRunId).padStart(3, '0')}` : '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Universe</TableCell>
                  <TableCell>{sessionMeta?.universe_id ? `U-${String(sessionMeta.universe_id).padStart(3, '0')}` : '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Entity Level</TableCell>
                  <TableCell>{sessionMeta?.entity_level || selectedRun?.entity_level || '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell>{sessionMeta?.metric_name || selectedRun?.config?.metrics?.[0]?.name || '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Window</TableCell>
                  <TableCell>{sessionMeta?.window || selectedRun?.config?.metrics?.[0]?.window || '—'}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" onClick={navigateToBehavior}>
              Back to Step-2
            </Button>
          </Box>
        </Box>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0, mb: 2 }}>
        <Box sx={{ px: 2, pt: 1 }}>
          <Tabs value={mode} onChange={(_e, v) => setMode(v)}>
            <Tab value="manual" label="Manual" />
            <Tab value="orchestrated" label="Orchestrated" />
          </Tabs>
        </Box>
        <Divider />
        <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label={`Strategies: ${(sessionData?.strategies || []).length}`} />
          <Chip label={`Boundaries: ${boundariesCount}`} />
          <Chip label={`KS: ${ksRunsCount}`} />
          <Chip label={`J: ${step36RunsCount}`} />
          {sessionMeta?.status && <Chip label={`Session: ${sessionMeta.status}`} />}
        </Box>
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Box sx={{ position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
            <WorkbenchLeftPanel
              behaviorRuns={behaviorRuns}
              selectedBehaviorRunId={selectedBehaviorRunId}
              setSelectedBehaviorRunId={(v) => {
                if (runSelectionLocked) return;
                setSelectedBehaviorRunId(v);
                setSelectedSessionId('');
                setSessionData(null);
                setAggregateView(null);
                setSelectedBoundaryId(null);
                setSelectedStrategyId(null);
                setStageTab('reduce');
              }}
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              setSelectedSessionId={setSelectedSessionId}
              onCreateSession={handleCreateSession}
              onFreezeSession={handleFreezeSession}
              onReviewFinalize={openFinalize}
              session={sessionMeta}
              aggregation={aggregationConfig}
              selectedBoundaryId={selectedBoundaryId}
              aggregateView={aggregateView}
              onSessionUpdated={async (nextSession) => {
                setSessionData(nextSession);
                await refreshAggregateView();
              }}
              loading={loading}
              runSelectionLocked={runSelectionLocked}
              onNavigateToBoundary={() => openRiskSplit()}
              onNavigateToValidate={() => setStageTab('validate')}
            />
          </Box>
        </Grid>

        <Grid item xs={12} md={8}>
          {mode === 'orchestrated' && (
            <Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0 }}>
              <Box sx={{ p: 2 }}>
                {!selectedSessionId && (
                  <Alert severity="info">Select a Calibration Session to run orchestration.</Alert>
                )}
                {selectedSessionId && <OrchestratedCalibrationRun sessionId={selectedSessionId} />}
              </Box>
            </Paper>
          )}

          {mode === 'manual' && (
            <Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0 }}>
              <Box sx={{ px: 2, pt: 2 }}>
                <Tabs value={stageTab} onChange={(_e, v) => setStageTab(v)}>
                  <Tab value="reduce" label="Stage 1 — Interpretation Lens" />
                  <Tab value="signal" label="Stage 2 — Understand Signal" />
                  <Tab value="boundary" label="Stage 3 — Define Boundary" />
                  <Tab value="validate" label="Stage 4 — Validate Separation" />
                </Tabs>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                {!selectedRun && (
                  <Alert severity="info">
                    Select a Behaviour Run to enter the workbench.
                  </Alert>
                )}
                {selectedRun && !selectedSessionId && (
                  <Alert severity="info">
                    Create or select a Calibration Session for this run.
                  </Alert>
                )}

                {selectedRun && selectedSessionId && stageTab === 'reduce' && (
                  <>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Interpretation lens collapses Step-2 time-series into one value per entity for comparison and splitting.
                    </Alert>
                    <EntityReductionView session={sessionMeta} aggregateView={aggregateView} />
                  </>
                )}

                {selectedRun && selectedSessionId && stageTab === 'signal' && (
                  <>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Explore distribution, concentration, and stability to understand what the signal is really doing.
                    </Alert>
                    <SignalDistributionView session={sessionMeta} aggregateView={aggregateView} />
                  </>
                )}

                {selectedRun && selectedSessionId && stageTab === 'boundary' && (
                  <>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      A boundary is a cutoff that splits entities into Above the Line (ATL) and Below the Line (BTL). This is a behavioural split for validation, not a risk decision.
                    </Alert>
                    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0, mb: 2 }}>
                      <Box sx={{ px: 2, pt: 1 }}>
                        <Tabs value={boundaryTab} onChange={(_e, v) => setBoundaryTab(v)}>
                          <Tab value="threshold" label="Threshold Simulation" />
                          <Tab value="split" label="Risk Split" />
                        </Tabs>
                      </Box>
                      <Divider />
                      <Box sx={{ p: 2 }}>
                        {boundaryTab === 'threshold' && (
                          <ThresholdSimulationView
                            session={sessionMeta}
                            aggregateView={aggregateView}
                            onStrategySelected={(id) => setSelectedStrategyId(id)}
                          />
                        )}
                        {boundaryTab === 'split' && (
                          <RiskSplitView
                            session={sessionMeta}
                            aggregateView={aggregateView}
                            selectedBoundaryId={selectedBoundaryId}
                            onBoundarySelected={(id) => setSelectedBoundaryId(id)}
                          />
                        )}
                      </Box>
                    </Paper>
                  </>
                )}

                {selectedRun && selectedSessionId && stageTab === 'validate' && (
                  <>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Validation checks whether the boundary separates behaviour meaningfully. It does not prove risk and it does not select scenarios.
                    </Alert>
                    <WorkbenchValidationPanel
                      session={sessionMeta}
                      selectedBoundaryId={selectedBoundaryId}
                      selectedStrategyId={selectedStrategyId}
                      onBoundarySelected={(id) => setSelectedBoundaryId(id)}
                      onNavigateToRiskSplit={openRiskSplit}
                    />
                  </>
                )}
              </Box>
            </Paper>
          )}
        </Grid>
      </Grid>

      <Paper sx={{ mt: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Box sx={{ px: 2, pt: 1 }}>
          <Tabs value={bottomTab} onChange={(_e, v) => setBottomTab(v)}>
            <Tab value="evidence" label="Evidence" />
            <Tab value="logs" label="Logs" />
            <Tab value="notes" label="Notes" />
            <Tab value="lineage" label="Lineage" />
          </Tabs>
        </Box>
        <Divider />
        <Box sx={{ p: 2 }}>
          <WorkbenchEvidencePanel
            bottomTab={bottomTab}
            session={sessionMeta}
            aggregation={aggregationConfig}
            aggregateView={aggregateView}
            events={sessionData?.events || []}
            annotations={sessionData?.annotations || []}
            selectedBoundaryId={selectedBoundaryId}
          />
        </Box>
      </Paper>

      <FinalizeDecisionDialog
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        summary={finalizeSummary}
        loading={finalizeLoading}
        error={finalizeError}
        onFreeze={freezeFromFinalize}
      />
    </Box>
  );
};

export default ScenarioCalibrationWorkbench;
