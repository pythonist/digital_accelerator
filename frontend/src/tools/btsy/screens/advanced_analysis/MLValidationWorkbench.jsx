import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Typography, Grid, Button, Stack, Divider, Chip, TextField, Table,
  TableBody, TableCell, TableHead, TableRow, FormControl, Select, MenuItem, InputLabel, Alert,
  Tabs, Tab, Slider, ToggleButtonGroup, ToggleButton, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useSnapshot } from '../../context/SnapshotContext';
import btsyApi from '../../services/btsyApi';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ScatterChart,
  Scatter
} from 'recharts';

const MLValidationWorkbench = () => {
  const { activeSnapshot } = useSnapshot();
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const [boundaries, setBoundaries] = useState([]);
  const [selectedBoundaryId, setSelectedBoundaryId] = useState('');
  const [approvedBoundary, setApprovedBoundary] = useState(null);
  const [trainingMode, setTrainingMode] = useState('BTL');
  const [trainingPreview, setTrainingPreview] = useState(null);
  const [preview, setPreview] = useState(null);
  const [algoTab, setAlgoTab] = useState(0);
  const [stateMessage, setStateMessage] = useState('');
  const [stateSeverity, setStateSeverity] = useState('info');

  const [ifParams, setIfParams] = useState({
    n_estimators: 200,
    contamination: 0.05,
    max_samples: 'auto',
    random_state: 42
  });
  const [ifDirty, setIfDirty] = useState(false);
  const [ifRunning, setIfRunning] = useState(false);

  const [dbscanParams, setDbscanParams] = useState({
    eps: 0.5,
    min_samples: 10
  });
  const [dbscanDirty, setDbscanDirty] = useState(false);
  const [dbscanRunning, setDbscanRunning] = useState(false);
  const [dbscanPreview, setDbscanPreview] = useState(null);
  const [dbscanRuns, setDbscanRuns] = useState([]);
  const [selectedDbscanRunId, setSelectedDbscanRunId] = useState('');
  const [selectedDbscanRun, setSelectedDbscanRun] = useState(null);

  const [ifAnalystNote, setIfAnalystNote] = useState('');
  const [ifSupportLevel, setIfSupportLevel] = useState('');
  const [ifLimitations, setIfLimitations] = useState('');
  const [dbAnalystNote, setDbAnalystNote] = useState('');
  const [dbSupportLevel, setDbSupportLevel] = useState('');
  const [dbLimitations, setDbLimitations] = useState('');

  const [dbscanColorMode, setDbscanColorMode] = useState('cluster');
  const [crossCompare, setCrossCompare] = useState(null);
  const [recommendationPack, setRecommendationPack] = useState(null);
  const [savedRuns, setSavedRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRun, setSelectedRun] = useState(null);
  const [cbpEntityId, setCbpEntityId] = useState('');
  const [bandLow, setBandLow] = useState('90');
  const [bandHigh, setBandHigh] = useState('95');
  const [cbpResult, setCbpResult] = useState(null);
  const [coverage, setCoverage] = useState([]);
  const [edt, setEdt] = useState([]);
  const [reportSection, setReportSection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const unlockMl = Boolean(approvedBoundary?.approved);
  const unlockCbp = savedRuns.length > 0;
  const unlockScm = savedRuns.length > 0;
  const unlockEdt = sessions.length > 1;

  const context = useMemo(() => {
    const session = sessionData?.session || {};
    const aggregation = sessionData?.aggregation || {};
    return {
      population: activeSnapshot?.snapshot_id ? `Step-1 Snapshot • ${activeSnapshot.snapshot_id}` : 'Step-1 Snapshot • Pending',
      features: session.metric_name ? `Step-2 Behaviour • ${session.metric_name}` : 'Step-2 Behaviour Aggregates',
      aggregation: aggregation.entity_collapse ? `${aggregation.entity_collapse} • ${aggregation.time_lens}` : 'Aggregation Pending',
      window: session.window || 'Window Pending',
      training: trainingMode === 'BTL' ? 'BTL Only' : 'Full Population'
    };
  }, [activeSnapshot, sessionData, trainingMode]);

  const canRun = Boolean(selectedSessionId && selectedBoundaryId && unlockMl);
  const canIfSave = Boolean(preview && ifAnalystNote && ifSupportLevel && canRun);
  const canDbscanSave = Boolean(dbscanPreview && dbAnalystNote && dbSupportLevel && canRun);

  const loadSessions = async () => {
    const res = await btsyApi.calibration.listSessions();
    if (res.success) setSessions(res.data || []);
  };

  const loadSessionDetails = async (sessionId) => {
    const [sessionRes, boundariesRes, runsRes, approvedRes, dbscanRunsRes] = await Promise.all([
      btsyApi.calibration.getSession(sessionId),
      btsyApi.risk.listBoundaries(sessionId),
      btsyApi.mlValidation.listRuns(sessionId),
      btsyApi.orchestrated.getApprovedBoundary(sessionId),
      btsyApi.mlValidation.listDbscanRuns(sessionId)
    ]);
    if (sessionRes.success) setSessionData(sessionRes.data);
    if (boundariesRes.success) setBoundaries(boundariesRes.data || []);
    if (runsRes.success) setSavedRuns(runsRes.data || []);
    if (approvedRes.success) setApprovedBoundary(approvedRes.data);
    if (dbscanRunsRes.success) setDbscanRuns(dbscanRunsRes.data || []);
    const approvedId = approvedRes.success && approvedRes.data?.approved ? String(approvedRes.data.boundary_id) : '';
    setSelectedBoundaryId(approvedId);
    const firstRun = (runsRes.data || [])[0];
    setSelectedRunId(firstRun ? String(firstRun.ml_run_id) : '');
    const firstDb = (dbscanRunsRes.data || [])[0];
    setSelectedDbscanRunId(firstDb ? String(firstDb.dbscan_run_id) : '');
    setPreview(null);
    setDbscanPreview(null);
    setCrossCompare(null);
    setRecommendationPack(null);
    setIfDirty(false);
    setDbscanDirty(false);
    setStateMessage(`Loaded session ${sessionId}. Select an algorithm lens to generate evidence.`);
    setStateSeverity('info');
  };

  const loadRunDetails = async (sessionId, runId) => {
    if (!sessionId || !runId) {
      setSelectedRun(null);
      return;
    }
    const res = await btsyApi.mlValidation.getRun(sessionId, runId);
    if (res.success) setSelectedRun(res.data);
  };

  useEffect(() => { loadSessions(); }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionData(null);
      setBoundaries([]);
      setSavedRuns([]);
      setSelectedBoundaryId('');
      setSelectedRunId('');
      setApprovedBoundary(null);
      return;
    }
    loadSessionDetails(parseInt(selectedSessionId, 10));
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !selectedRunId) {
      setSelectedRun(null);
      return;
    }
    loadRunDetails(parseInt(selectedSessionId, 10), parseInt(selectedRunId, 10));
  }, [selectedSessionId, selectedRunId]);

  useEffect(() => {
    const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;
    const rid = selectedDbscanRunId ? parseInt(selectedDbscanRunId, 10) : null;
    if (!sid || !rid) {
      setSelectedDbscanRun(null);
      return;
    }
    (async () => {
      const res = await btsyApi.mlValidation.getDbscanRun(sid, rid);
      if (res.success) setSelectedDbscanRun(res.data);
    })();
  }, [selectedSessionId, selectedDbscanRunId]);

  useEffect(() => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl) return;
    setTrainingPreview(null);
    handleTrainingPreview();
  }, [selectedSessionId, selectedBoundaryId, unlockMl]);

  useEffect(() => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl) return;
    setIfDirty(true);
    setPreview(null);
    setStateMessage('Isolation Forest parameters changed. Previous output invalidated; re-running preview…');
    setStateSeverity('warning');
    const t = setTimeout(() => runIfPreview(), 600);
    return () => clearTimeout(t);
  }, [selectedSessionId, selectedBoundaryId, unlockMl, trainingMode, ifParams.n_estimators, ifParams.contamination, ifParams.max_samples, ifParams.random_state]);

  useEffect(() => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl) return;
    setDbscanDirty(true);
    setDbscanPreview(null);
    setStateMessage('DBSCAN parameters changed. Previous output invalidated; re-running preview…');
    setStateSeverity('warning');
    const t = setTimeout(() => runDbscanPreview(), 700);
    return () => clearTimeout(t);
  }, [selectedSessionId, selectedBoundaryId, unlockMl, dbscanParams.eps, dbscanParams.min_samples]);

  const handleTrainingPreview = async () => {
    if (!canRun) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.mlValidation.trainingPreview(parseInt(selectedSessionId, 10), parseInt(selectedBoundaryId, 10), trainingMode);
    setBusy(false);
    if (res.success) {
      setTrainingPreview(res.data);
      const counts = res.data?.counts || {};
      const total = Number(counts.total || 0);
      const atl = Number(counts.atl || 0);
      const base = total > 0 ? Math.max(0.001, Math.min(0.5, atl / total)) : 0.05;
      setIfParams((p) => ({ ...p, contamination: Number(base.toFixed(4)) }));
      setStateMessage('Training population computed. Contamination initialized to match Step-3 ATL share.');
      setStateSeverity('success');
    }
    else setError(res.error || 'Failed to preview training population');
  };

  const runIfPreview = async (reason = '') => {
    if (!canRun) return;
    setIfRunning(true);
    setError('');
    setStateMessage(reason || 'Running Isolation Forest preview…');
    setStateSeverity('info');
    const res = await btsyApi.mlValidation.preview(
      parseInt(selectedSessionId, 10),
      parseInt(selectedBoundaryId, 10),
      trainingMode,
      ifParams
    );
    setIfRunning(false);
    if (res.success) {
      setPreview(res.data);
      setIfDirty(false);
      setStateMessage('Isolation Forest evidence updated. Review charts and Step-3 comparison.');
      setStateSeverity('success');
    } else {
      setError(res.error || 'Failed to run preview');
      setStateMessage('Isolation Forest preview failed. Fix inputs and retry.');
      setStateSeverity('error');
    }
  };

  const handleIfSave = async () => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl || !preview) return;
    if (!ifAnalystNote || !ifSupportLevel) return;
    setBusy(true);
    setError('');
    const payload = {
      boundary_id: parseInt(selectedBoundaryId, 10),
      training_mode: trainingMode,
      params: ifParams,
      analyst_note: ifAnalystNote,
      support_level: ifSupportLevel,
      limitations: ifLimitations
    };
    const res = await btsyApi.mlValidation.saveRun(parseInt(selectedSessionId, 10), payload);
    setBusy(false);
    if (res.success) {
      setStateMessage('Isolation Forest run saved. Downstream comparisons and reports are now available.');
      setStateSeverity('success');
      setIfAnalystNote('');
      setIfSupportLevel('');
      setIfLimitations('');
      await loadSessionDetails(parseInt(selectedSessionId, 10));
    } else {
      setError(res.error || 'Failed to save evidence');
      setStateMessage('Save failed. Evidence not persisted.');
      setStateSeverity('error');
    }
  };

  const runDbscanPreview = async (reason = '') => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl) return;
    setDbscanRunning(true);
    setError('');
    setStateMessage(reason || 'Running DBSCAN preview…');
    setStateSeverity('info');
    const res = await btsyApi.mlValidation.dbscanPreview(
      parseInt(selectedSessionId, 10),
      parseInt(selectedBoundaryId, 10),
      dbscanParams.eps,
      dbscanParams.min_samples
    );
    setDbscanRunning(false);
    if (res.success) {
      setDbscanPreview(res.data);
      setDbscanDirty(false);
      setStateMessage('DBSCAN evidence updated. Review clusters, noise, and Step-3 alignment.');
      setStateSeverity('success');
    } else {
      setError(res.error || 'Failed to run DBSCAN preview');
      setStateMessage('DBSCAN preview failed. Fix inputs and retry.');
      setStateSeverity('error');
    }
  };

  const handleDbscanSave = async () => {
    if (!selectedSessionId || !selectedBoundaryId || !unlockMl || !dbscanPreview) return;
    if (!dbAnalystNote || !dbSupportLevel) return;
    setBusy(true);
    setError('');
    const payload = {
      boundary_id: parseInt(selectedBoundaryId, 10),
      eps: dbscanParams.eps,
      min_samples: dbscanParams.min_samples,
      analyst_note: dbAnalystNote,
      support_level: dbSupportLevel,
      limitations: dbLimitations
    };
    const res = await btsyApi.mlValidation.dbscanSaveRun(parseInt(selectedSessionId, 10), payload);
    setBusy(false);
    if (res.success) {
      setStateMessage('DBSCAN run saved. Clusters are now persisted for audit and reporting.');
      setStateSeverity('success');
      setDbAnalystNote('');
      setDbSupportLevel('');
      setDbLimitations('');
      await loadSessionDetails(parseInt(selectedSessionId, 10));
    } else {
      setError(res.error || 'Failed to save DBSCAN evidence');
      setStateMessage('Save failed. Evidence not persisted.');
      setStateSeverity('error');
    }
  };

  const handleDeleteRun = async () => {
    if (!selectedSessionId || !selectedRunId) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.mlValidation.deleteRun(parseInt(selectedSessionId, 10), parseInt(selectedRunId, 10));
    setBusy(false);
    if (res.success) {
      await loadSessionDetails(parseInt(selectedSessionId, 10));
    } else {
      setError(res.error || 'Failed to delete run');
    }
  };

  const handleCoverage = async () => {
    if (!selectedSessionId || !selectedRunId) return;
    const res = await btsyApi.mlValidation.coverageMap(parseInt(selectedSessionId, 10), parseInt(selectedRunId, 10));
    if (res.success) setCoverage(res.data || []);
  };

  const handleCbp = async () => {
    if (!selectedSessionId || !selectedBoundaryId) return;
    const params = { boundary_id: parseInt(selectedBoundaryId, 10) };
    if (cbpEntityId) {
      params.entity_id = cbpEntityId;
    } else {
      params.band_low = bandLow;
      params.band_high = bandHigh;
    }
    const res = await btsyApi.mlValidation.cbp(parseInt(selectedSessionId, 10), params);
    if (res.success) setCbpResult(res.data);
  };

  const handleEdt = async () => {
    if (!selectedSessionId) return;
    const res = await btsyApi.mlValidation.edt(parseInt(selectedSessionId, 10));
    if (res.success) setEdt(res.data || []);
  };

  const handleReport = async () => {
    if (!selectedSessionId || !selectedRunId) return;
    const res = await btsyApi.mlValidation.report(parseInt(selectedSessionId, 10), parseInt(selectedRunId, 10));
    if (res.success) setReportSection(res.data);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ML Validation Workbench
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Goal of Advanced Analytics: Validate whether Step-3 ATL entities are genuinely anomalous, discover blind spots, and stress-test boundary robustness. This does NOT change alerts automatically.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Context Panel
              </Typography>
              <Stack spacing={1}>
                <FormControl fullWidth size="small">
                  <InputLabel>Calibration Session</InputLabel>
                  <Select
                    value={selectedSessionId}
                    label="Calibration Session"
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                  >
                    {sessions.map((s) => (
                      <MenuItem key={s.session_id} value={String(s.session_id)}>
                        {`Session ${s.session_id} • ${s.metric_name}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small" disabled={!unlockMl || Boolean(approvedBoundary?.approved)}>
                  <InputLabel>Step-3 Boundary</InputLabel>
                  <Select
                    value={selectedBoundaryId}
                    label="Step-3 Boundary"
                    onChange={(e) => setSelectedBoundaryId(e.target.value)}
                  >
                    {boundaries.map((b) => (
                      <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>
                        {`B-${String(b.boundary_id).padStart(3, '0')} • ${b.buffer_type}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {!unlockMl && (
                  <Alert severity="warning">
                    Approve a final boundary from the Orchestrated Run to unlock ML validation.
                  </Alert>
                )}
                {approvedBoundary?.approved && (
                  <Alert severity="success">
                    {`Approved Boundary: ${approvedBoundary.boundary_id} (OCR-${String(approvedBoundary.ocr_run_id).padStart(3, '0')})`}
                  </Alert>
                )}
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Population Source</Typography>
                  <Typography variant="body2">{context.population}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Behaviour Features</Typography>
                  <Typography variant="body2">{context.features}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Aggregation Level</Typography>
                  <Typography variant="body2">{context.aggregation}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Time Window</Typography>
                  <Typography variant="body2">{context.window}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Training Population</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    {['BTL', 'FULL'].map((mode) => (
                      <Chip
                        key={mode}
                        label={mode === 'BTL' ? 'BTL Only' : 'Full Population'}
                        size="small"
                        color={trainingMode === mode ? 'primary' : 'default'}
                        onClick={() => setTrainingMode(mode)}
                        sx={{ borderRadius: 0 }}
                      />
                    ))}
                  </Stack>
                </Box>
              </Stack>
              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                This analysis helps validate whether ATL entities appear behaviourally abnormal relative to baseline populations. No alerts or thresholds will be changed.
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={2}>
            {stateMessage && <Alert severity={stateSeverity} sx={{ borderRadius: 0 }}>{stateMessage}</Alert>}
            <Paper elevation={0} sx={{ p: 0, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Box sx={{ px: 2, pt: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Algorithm Playground
                </Typography>
                <Tabs value={algoTab} onChange={(_e, v) => setAlgoTab(v)} variant="scrollable" scrollButtons="auto">
                  <Tab label="Isolation Forest" />
                  <Tab label="DBSCAN" />
                  <Tab label="Cross-Algorithm" />
                  <Tab label="Recommendation Pack" />
                </Tabs>
              </Box>
              <Divider />

              {algoTab === 0 && (
                <Box sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Isolation Forest produces an anomaly score per entity and agreement metrics vs Step-3. It does not choose a threshold.
                    </Typography>

                    <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Hyperparameters
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>n_estimators</Typography>
                          <Slider
                            value={ifParams.n_estimators}
                            min={50}
                            max={2000}
                            step={50}
                            onChange={(_e, v) => setIfParams((p) => ({ ...p, n_estimators: v }))}
                            disabled={!canRun}
                          />
                          <TextField
                            size="small"
                            fullWidth
                            value={ifParams.n_estimators}
                            onChange={(e) => setIfParams((p) => ({ ...p, n_estimators: parseInt(e.target.value || '0', 10) || 0 }))}
                            disabled={!canRun}
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>contamination</Typography>
                          <Slider
                            value={Number(ifParams.contamination)}
                            min={0.001}
                            max={0.2}
                            step={0.001}
                            onChange={(_e, v) => setIfParams((p) => ({ ...p, contamination: Number(v) }))}
                            disabled={!canRun}
                          />
                          <TextField
                            size="small"
                            fullWidth
                            value={ifParams.contamination}
                            onChange={(e) => setIfParams((p) => ({ ...p, contamination: Number(e.target.value) }))}
                            disabled={!canRun}
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            label="max_samples (auto | int | 0-1)"
                            size="small"
                            fullWidth
                            value={ifParams.max_samples}
                            onChange={(e) => setIfParams((p) => ({ ...p, max_samples: e.target.value }))}
                            disabled={!canRun}
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            label="random_state"
                            size="small"
                            fullWidth
                            value={ifParams.random_state}
                            onChange={(e) => setIfParams((p) => ({ ...p, random_state: parseInt(e.target.value || '0', 10) || 0 }))}
                            disabled={!canRun}
                          />
                        </Grid>
                      </Grid>
                    </Paper>

                    {(ifDirty || ifRunning) && (
                      <Alert severity="warning" sx={{ borderRadius: 0 }}>
                        Isolation Forest output is invalidated and re-computing. Charts will update automatically.
                      </Alert>
                    )}

                    {preview && (
                      <>
                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            Score Distribution (ATL vs BTL)
                          </Typography>
                          <Box sx={{ height: 240 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={preview.hist?.bins || []}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="x" type="number" />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Area type="monotone" dataKey="atl_density" name="ATL density" stroke="#ef4444" fill="#fecaca" />
                                <Area type="monotone" dataKey="btl_density" name="BTL density" stroke="#2563eb" fill="#bfdbfe" />
                                {preview.model?.step3_equivalent_score_line != null && (
                                  <ReferenceLine
                                    x={preview.model.step3_equivalent_score_line}
                                    stroke="#0f172a"
                                    strokeDasharray="6 6"
                                    label="Step-3 equivalent top-k"
                                  />
                                )}
                              </AreaChart>
                            </ResponsiveContainer>
                          </Box>
                          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                            The vertical marker is the Isolation Forest score cutoff that would select the same number of entities as Step-3 ATL (for comparison only).
                          </Typography>
                        </Paper>

                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            Tail Alignment Chart
                          </Typography>
                          <Box sx={{ height: 240 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart
                                data={(preview.tails || []).map((t) => ({
                                  tail_pct: t.tail_pct,
                                  atl_tail_pct: t.atl_tail_pct,
                                  baseline_pct: t.tail_pct
                                }))}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="tail_pct" tickFormatter={(v) => `${v}%`} />
                                <YAxis tickFormatter={(v) => `${v}%`} />
                                <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                                <Legend />
                                <Line type="monotone" dataKey="atl_tail_pct" name="% ATL inside tail" stroke="#ef4444" />
                                <Line type="monotone" dataKey="baseline_pct" name="Random baseline" stroke="#64748b" strokeDasharray="4 4" />
                              </LineChart>
                            </ResponsiveContainer>
                          </Box>
                          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                            If %ATL in tail is above baseline, ATL entities concentrate in the anomaly tail more than random expectation.
                          </Typography>
                        </Paper>

                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            Step-3 Comparison (Evidence Only)
                          </Typography>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Metric</TableCell>
                                <TableCell>Step-3</TableCell>
                                <TableCell>Isolation Forest</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              <TableRow>
                                <TableCell>ATL Size</TableCell>
                                <TableCell>{preview.comparison?.step3_atl_size}</TableCell>
                                <TableCell>{preview.comparison?.if_topk_size}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell>Overlap %</TableCell>
                                <TableCell>—</TableCell>
                                <TableCell>{Number(preview.comparison?.overlap_pct || 0).toFixed(2)}%</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell>Missed ATL</TableCell>
                                <TableCell>—</TableCell>
                                <TableCell>{preview.comparison?.missed_atl}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell>Extra Noise</TableCell>
                                <TableCell>—</TableCell>
                                <TableCell>{preview.comparison?.extra_noise}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                          <Typography variant="body2" sx={{ color: '#475569', mt: 1 }}>
                            The model supports Step-3 when overlap is high and missed ATL is low. Extra noise represents entities IF ranks as anomalous but Step-3 does not classify as ATL.
                          </Typography>
                        </Paper>
                      </>
                    )}

                    <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Save Isolation Forest as Evidence
                      </Typography>
                      <TextField
                        label="Analyst Interpretation"
                        placeholder="Deterministic evidence summary + your investigation note."
                        multiline
                        minRows={3}
                        fullWidth
                        value={ifAnalystNote}
                        onChange={(e) => setIfAnalystNote(e.target.value)}
                        disabled={!canRun}
                      />
                      <Stack direction="row" spacing={2} sx={{ mt: 2 }} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 220 }} disabled={!canRun}>
                          <InputLabel>Support Level</InputLabel>
                          <Select value={ifSupportLevel} label="Support Level" onChange={(e) => setIfSupportLevel(e.target.value)}>
                            <MenuItem value="supports">Supports Step-3</MenuItem>
                            <MenuItem value="neutral">Neutral</MenuItem>
                            <MenuItem value="contradicts">Contradicts Step-3</MenuItem>
                          </Select>
                        </FormControl>
                        <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={handleIfSave} disabled={!canIfSave || busy}>
                          Save IF Run
                        </Button>
                        <Button variant="text" color="error" onClick={handleDeleteRun} disabled={!selectedRunId || busy}>
                          Delete Selected IF Run
                        </Button>
                      </Stack>
                      <TextField
                        label="Known Limitations"
                        multiline
                        minRows={2}
                        fullWidth
                        value={ifLimitations}
                        onChange={(e) => setIfLimitations(e.target.value)}
                        disabled={!canRun}
                        sx={{ mt: 2 }}
                      />
                      <Accordion sx={{ mt: 2 }} defaultExpanded={false}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Saved Isolation Forest Runs</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <FormControl fullWidth size="small">
                            <InputLabel>Saved Runs</InputLabel>
                            <Select value={selectedRunId} label="Saved Runs" onChange={(e) => setSelectedRunId(e.target.value)}>
                              {savedRuns.map((r) => (
                                <MenuItem key={r.ml_run_id} value={String(r.ml_run_id)}>
                                  {`Run ${r.ml_run_id} • ${r.training_mode}`}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {selectedRun && (
                            <Table size="small" sx={{ mt: 2 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Run</TableCell>
                                  <TableCell>Mode</TableCell>
                                  <TableCell>ATL Count</TableCell>
                                  <TableCell>BTL Count</TableCell>
                                  <TableCell>Verdict</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                <TableRow>
                                  <TableCell>{selectedRun.run.ml_run_id}</TableCell>
                                  <TableCell>{selectedRun.run.training_mode}</TableCell>
                                  <TableCell>{selectedRun.counts.atl}</TableCell>
                                  <TableCell>{selectedRun.counts.btl}</TableCell>
                                  <TableCell>{selectedRun.evidence?.support_level || '—'}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    </Paper>
                  </Stack>
                </Box>
              )}

              {algoTab === 1 && (
                <Box sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Alert severity="info" sx={{ borderRadius: 0 }}>
                      DBSCAN identifies dense behavioural clusters and isolates sparse behaviour. Used to detect structuring, archetypes, and non-thresholdable risk.
                    </Alert>

                    <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Parameters
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>eps</Typography>
                          <Slider
                            value={dbscanParams.eps}
                            min={0.05}
                            max={5}
                            step={0.05}
                            onChange={(_e, v) => setDbscanParams((p) => ({ ...p, eps: Number(v) }))}
                            disabled={!canRun}
                          />
                          <TextField size="small" fullWidth value={dbscanParams.eps} onChange={(e) => setDbscanParams((p) => ({ ...p, eps: Number(e.target.value) }))} disabled={!canRun} />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>min_samples</Typography>
                          <Slider
                            value={dbscanParams.min_samples}
                            min={2}
                            max={80}
                            step={1}
                            onChange={(_e, v) => setDbscanParams((p) => ({ ...p, min_samples: Number(v) }))}
                            disabled={!canRun}
                          />
                          <TextField size="small" fullWidth value={dbscanParams.min_samples} onChange={(e) => setDbscanParams((p) => ({ ...p, min_samples: parseInt(e.target.value || '0', 10) || 0 }))} disabled={!canRun} />
                        </Grid>
                      </Grid>
                      {dbscanPreview?.model?.eps_suggestion && (
                        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                          k-distance eps suggestion (guided): q90 {dbscanPreview.model.eps_suggestion.q90?.toFixed?.(3) ?? '—'} • q95 {dbscanPreview.model.eps_suggestion.q95?.toFixed?.(3) ?? '—'} • q99 {dbscanPreview.model.eps_suggestion.q99?.toFixed?.(3) ?? '—'}
                        </Typography>
                      )}
                    </Paper>

                    {(dbscanDirty || dbscanRunning) && (
                      <Alert severity="warning" sx={{ borderRadius: 0 }}>
                        DBSCAN output is invalidated and re-computing. Charts will update automatically.
                      </Alert>
                    )}

                    {dbscanPreview && (
                      <>
                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            k-distance Plot (eps suggestion)
                          </Typography>
                          <Box sx={{ height: 240 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={dbscanPreview.k_distance?.points || []}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="rank" />
                                <YAxis />
                                <Tooltip />
                                <Line type="monotone" dataKey="distance" stroke="#0f172a" dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </Box>
                        </Paper>

                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              2D Projection (PCA)
                            </Typography>
                            <ToggleButtonGroup
                              size="small"
                              value={dbscanColorMode}
                              exclusive
                              onChange={(_e, v) => v && setDbscanColorMode(v)}
                            >
                              <ToggleButton value="cluster">Cluster</ToggleButton>
                              <ToggleButton value="population">ATL/BTL</ToggleButton>
                              <ToggleButton value="noise">Noise</ToggleButton>
                            </ToggleButtonGroup>
                          </Stack>
                          <Box sx={{ height: 320 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ScatterChart>
                                <CartesianGrid />
                                <XAxis dataKey="pc1" type="number" name="PC1" />
                                <YAxis dataKey="pc2" type="number" name="PC2" />
                                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                {dbscanColorMode === 'population' && (
                                  <>
                                    <Scatter name="ATL" data={(dbscanPreview.points || []).filter((p) => p.population_label === 'ATL')} fill="#ef4444" />
                                    <Scatter name="BTL" data={(dbscanPreview.points || []).filter((p) => p.population_label === 'BTL')} fill="#2563eb" />
                                  </>
                                )}
                                {dbscanColorMode === 'noise' && (
                                  <>
                                    <Scatter name="Noise" data={(dbscanPreview.points || []).filter((p) => p.is_noise)} fill="#0f172a" />
                                    <Scatter name="Clustered" data={(dbscanPreview.points || []).filter((p) => !p.is_noise)} fill="#94a3b8" />
                                  </>
                                )}
                                {dbscanColorMode === 'cluster' && (
                                  <>
                                    <Scatter name="Noise" data={(dbscanPreview.points || []).filter((p) => p.cluster_id === -1)} fill="#0f172a" />
                                    <Scatter name="Clusters" data={(dbscanPreview.points || []).filter((p) => p.cluster_id !== -1)} fill="#22c55e" />
                                  </>
                                )}
                              </ScatterChart>
                            </ResponsiveContainer>
                          </Box>
                        </Paper>

                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            Cluster Summary
                          </Typography>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Cluster</TableCell>
                                <TableCell>Size</TableCell>
                                <TableCell>% ATL</TableCell>
                                <TableCell>Interpretation</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(dbscanPreview.clusters || []).map((c) => (
                                <TableRow key={c.cluster_id}>
                                  <TableCell>{c.cluster_id}</TableCell>
                                  <TableCell>{c.cluster_size}</TableCell>
                                  <TableCell>{Number(c.atl_pct || 0).toFixed(2)}%</TableCell>
                                  <TableCell>{c.interpretation_label}</TableCell>
                                </TableRow>
                              ))}
                              {(dbscanPreview.clusters || []).length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>No clusters formed at current parameters.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                          <Typography variant="body2" sx={{ color: '#475569', mt: 1 }}>
                            {dbscanPreview.interpretation}
                          </Typography>
                        </Paper>

                        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            DBSCAN vs Step-3 Comparison
                          </Typography>
                          {(() => {
                            const pts = dbscanPreview.points || [];
                            const atlTotal = pts.filter((p) => p.population_label === 'ATL').length;
                            const atlNoise = pts.filter((p) => p.population_label === 'ATL' && p.is_noise).length;
                            const atlNoisePct = atlTotal ? (atlNoise / atlTotal) * 100.0 : 0.0;
                            const aligning = (dbscanPreview.clusters || []).filter((c) => Number(c.atl_pct || 0) >= 50);
                            const blindSpots = atlNoise > 0
                              ? 'Some Step-3 ATL entities appear as DBSCAN noise (sparse behaviour).'
                              : 'Step-3 ATL entities are mostly clusterable at these parameters.';
                            const alignText = aligning.length
                              ? `Clusters aligning with ATL: ${aligning.map((c) => c.cluster_id).join(', ')}`
                              : 'No clusters align strongly with ATL at these parameters.';
                            return (
                              <>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Metric</TableCell>
                                      <TableCell>Step-3</TableCell>
                                      <TableCell>DBSCAN</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    <TableRow>
                                      <TableCell>ATL Size</TableCell>
                                      <TableCell>{atlTotal}</TableCell>
                                      <TableCell>—</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>ATL in Noise</TableCell>
                                      <TableCell>—</TableCell>
                                      <TableCell>{`${atlNoise} (${atlNoisePct.toFixed(2)}%)`}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>ATL-aligned clusters</TableCell>
                                      <TableCell>—</TableCell>
                                      <TableCell>{aligning.length}</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                                <Typography variant="body2" sx={{ color: '#475569', mt: 1 }}>
                                  {blindSpots} {alignText}
                                </Typography>
                              </>
                            );
                          })()}
                        </Paper>
                      </>
                    )}

                    <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Save DBSCAN as Evidence
                      </Typography>
                      <TextField
                        label="Analyst Interpretation"
                        multiline
                        minRows={3}
                        fullWidth
                        value={dbAnalystNote}
                        onChange={(e) => setDbAnalystNote(e.target.value)}
                        disabled={!canRun}
                      />
                      <Stack direction="row" spacing={2} sx={{ mt: 2 }} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 220 }} disabled={!canRun}>
                          <InputLabel>Support Level</InputLabel>
                          <Select value={dbSupportLevel} label="Support Level" onChange={(e) => setDbSupportLevel(e.target.value)}>
                            <MenuItem value="supports">Supports Step-3</MenuItem>
                            <MenuItem value="neutral">Neutral</MenuItem>
                            <MenuItem value="contradicts">Contradicts Step-3</MenuItem>
                          </Select>
                        </FormControl>
                        <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={handleDbscanSave} disabled={!canDbscanSave || busy}>
                          Save DBSCAN Run
                        </Button>
                      </Stack>
                      <TextField
                        label="Known Limitations"
                        multiline
                        minRows={2}
                        fullWidth
                        value={dbLimitations}
                        onChange={(e) => setDbLimitations(e.target.value)}
                        disabled={!canRun}
                        sx={{ mt: 2 }}
                      />
                      <Accordion sx={{ mt: 2 }} defaultExpanded={false}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Saved DBSCAN Runs</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <FormControl fullWidth size="small">
                            <InputLabel>Saved DBSCAN Runs</InputLabel>
                            <Select value={selectedDbscanRunId} label="Saved DBSCAN Runs" onChange={(e) => setSelectedDbscanRunId(e.target.value)}>
                              {dbscanRuns.map((r) => (
                                <MenuItem key={r.dbscan_run_id} value={String(r.dbscan_run_id)}>
                                  {`Run ${r.dbscan_run_id} • eps=${r.eps} • min=${r.min_samples}`}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {selectedDbscanRun?.run && (
                            <Table size="small" sx={{ mt: 2 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Run</TableCell>
                                  <TableCell>eps</TableCell>
                                  <TableCell>min_samples</TableCell>
                                  <TableCell>Verdict</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                <TableRow>
                                  <TableCell>{selectedDbscanRun.run.dbscan_run_id}</TableCell>
                                  <TableCell>{selectedDbscanRun.run.eps}</TableCell>
                                  <TableCell>{selectedDbscanRun.run.min_samples}</TableCell>
                                  <TableCell>{selectedDbscanRun.evidence?.support_level || '—'}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    </Paper>
                  </Stack>
                </Box>
              )}

              {algoTab === 2 && (
                <Box sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Entity-level cross-algorithm comparison for investigation: Step-3 label vs IF score vs DBSCAN structure.
                    </Typography>
                    <Button
                      variant="outlined"
                      onClick={async () => {
                        if (!selectedSessionId) return;
                        const res = await btsyApi.mlValidation.crossCompare(parseInt(selectedSessionId, 10));
                        if (res.success) setCrossCompare(res.data);
                      }}
                      disabled={!selectedSessionId}
                    >
                      Refresh Cross-Algorithm View
                    </Button>
                    {crossCompare?.rows?.length > 0 ? (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Entity</TableCell>
                            <TableCell>Step-3</TableCell>
                            <TableCell>IF Score</TableCell>
                            <TableCell>IF %</TableCell>
                            <TableCell>DBSCAN</TableCell>
                            <TableCell>Noise</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {crossCompare.rows.slice(0, 200).map((r) => (
                            <TableRow key={r.entity_id}>
                              <TableCell>{r.entity_id}</TableCell>
                              <TableCell>{r.step3 || '—'}</TableCell>
                              <TableCell>{r.if_score != null ? Number(r.if_score).toFixed(4) : '—'}</TableCell>
                              <TableCell>{r.if_percentile != null ? `${Number(r.if_percentile).toFixed(1)}%` : '—'}</TableCell>
                              <TableCell>{r.dbscan_cluster != null ? r.dbscan_cluster : '—'}</TableCell>
                              <TableCell>{r.dbscan_noise != null ? String(r.dbscan_noise) : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Alert severity="warning" sx={{ borderRadius: 0 }}>
                        No cross-algorithm data yet. Save at least one IF run or DBSCAN run in this session.
                      </Alert>
                    )}
                  </Stack>
                </Box>
              )}

              {algoTab === 3 && (
                <Box sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Advanced Analytics Summary produces a Recommendation Pack. Nothing is enforced automatically.
                    </Typography>
                    <Button
                      variant="contained"
                      sx={{ bgcolor: '#0f172a', alignSelf: 'flex-start' }}
                      onClick={async () => {
                        if (!selectedSessionId) return;
                        const res = await btsyApi.mlValidation.recommendationPack(parseInt(selectedSessionId, 10));
                        if (res.success) setRecommendationPack(res.data);
                      }}
                      disabled={!selectedSessionId}
                    >
                      Generate Recommendation Pack (Save)
                    </Button>
                    {recommendationPack && (
                      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                          Advanced Analytics Summary
                        </Typography>
                        <Stack spacing={0.5} sx={{ mb: 1 }}>
                          {(recommendationPack.summary_lines || []).map((l) => (
                            <Typography key={l} variant="body2" sx={{ color: '#334155' }}>{l}</Typography>
                          ))}
                        </Stack>
                        <Divider sx={{ my: 1.5 }} />
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                          Optional next actions
                        </Typography>
                        <Stack spacing={0.5}>
                          {(recommendationPack.optional_next_actions || []).map((a) => (
                            <Typography key={a} variant="body2" sx={{ color: '#475569' }}>{a}</Typography>
                          ))}
                          {(recommendationPack.optional_next_actions || []).length === 0 && (
                            <Typography variant="body2" sx={{ color: '#475569' }}>No suggested next actions.</Typography>
                          )}
                        </Stack>
                        <Divider sx={{ my: 1.5 }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {recommendationPack.disclaimer}
                        </Typography>
                      </Paper>
                    )}
                  </Stack>
                </Box>
              )}
            </Paper>
          </Stack>
        </Grid>

        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Advanced Evidence Features
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, height: '100%' }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Counterfactual Boundary Probe
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Unlocks after first saved ML evidence
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Identify the smallest behavioural changes that would flip ATL/BTL classification.
                    </Typography>
                    <TextField
                      label="Entity ID (optional)"
                      size="small"
                      value={cbpEntityId}
                      onChange={(e) => setCbpEntityId(e.target.value)}
                      disabled={!unlockCbp}
                    />
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="Band Low %"
                        size="small"
                        value={bandLow}
                        onChange={(e) => setBandLow(e.target.value)}
                        disabled={!unlockCbp || Boolean(cbpEntityId)}
                      />
                      <TextField
                        label="Band High %"
                        size="small"
                        value={bandHigh}
                        onChange={(e) => setBandHigh(e.target.value)}
                        disabled={!unlockCbp || Boolean(cbpEntityId)}
                      />
                    </Stack>
                    <Button variant="outlined" onClick={handleCbp} disabled={!unlockCbp}>
                      Run Probe
                    </Button>
                    {cbpResult && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Metric</TableCell>
                            <TableCell>Direction</TableCell>
                            <TableCell>Delta %</TableCell>
                            <TableCell>Outcome</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {cbpResult.results.slice(0, 6).map((r) => (
                            <TableRow key={r.metric_name}>
                              <TableCell>{r.metric_name}</TableCell>
                              <TableCell>{r.direction}</TableCell>
                              <TableCell>{r.delta_pct.toFixed(2)}%</TableCell>
                              <TableCell>{r.outcome}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Stack>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, height: '100%' }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Scenario Coverage Map
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Unlocks after Isolation Forest save
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Reveal anomalous behaviour bands not covered by the current scenario.
                    </Typography>
                    <Button variant="outlined" onClick={handleCoverage} disabled={!unlockScm}>
                      Generate Coverage Map
                    </Button>
                    {coverage.length > 0 && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Band</TableCell>
                            <TableCell>ATL %</TableCell>
                            <TableCell>Coverage</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {coverage.map((c) => (
                            <TableRow key={c.band}>
                              <TableCell>{c.band}</TableCell>
                              <TableCell>{c.atl_pct.toFixed(1)}%</TableCell>
                              <TableCell>{c.blind_spot ? 'Blind Spot' : 'Covered'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Stack>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, height: '100%' }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Evidence Drift Timeline
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Unlocks after multiple calibration sessions
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Track evidence quality trends before alert volume shifts.
                    </Typography>
                    <Button variant="outlined" onClick={handleEdt} disabled={!unlockEdt}>
                      Load Timeline
                    </Button>
                    {edt.length > 0 && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Session</TableCell>
                            <TableCell>KS</TableCell>
                            <TableCell>J</TableCell>
                            <TableCell>ATL Score</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {edt.map((e) => (
                            <TableRow key={e.session_id}>
                              <TableCell>{e.session_id}</TableCell>
                              <TableCell>{e.ks_stat?.toFixed(3) ?? '—'}</TableCell>
                              <TableCell>{e.max_j?.toFixed(3) ?? '—'}</TableCell>
                              <TableCell>{e.atl_mean_score?.toFixed(3) ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Reporting & Audit
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Generate the optional PDF section for ML validation evidence.
              </Typography>
              <Button variant="outlined" onClick={handleReport} disabled={!selectedRunId}>
                Generate Report Section
              </Button>
              {reportSection && (
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Section</TableCell>
                      <TableCell>{reportSection.title}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Method</TableCell>
                      <TableCell>{reportSection.method}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Training</TableCell>
                      <TableCell>{reportSection.training_population}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Disclaimer</TableCell>
                      <TableCell>{reportSection.disclaimer}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MLValidationWorkbench;
