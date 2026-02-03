import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Alert,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  Chip,
  LinearProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Tabs,
  Tab
} from '@mui/material';
import btsyApi from '../../services/btsyApi';
import { useSnapshot } from '../../context/SnapshotContext';
import { useCalibrationRun } from '../../context/CalibrationRunContext';


const AutoRunCalibrationRunsScreen = () => {
  const { activeSnapshot } = useSnapshot();
  const { activeCalibrationRunId, setActiveCalibrationRunId } = useCalibrationRun();
  const [modeTab, setModeTab] = useState('manual');
  const [manualRuns, setManualRuns] = useState([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runDetail, setRunDetail] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('progress');

  const snapshotId = activeSnapshot?.snapshot_id || '';

  const selectedRun = useMemo(() => {
    const rid = selectedRunId ? parseInt(selectedRunId, 10) : null;
    if (!rid) return null;
    return (runs || []).find((r) => r.run_id === rid) || null;
  }, [runs, selectedRunId]);

  const loadSessions = async () => {
    const res = await btsyApi.calibration.listSessions();
    if (res.success) {
      setSessions(res.data || []);
      const first = (res.data || [])[0];
      if (first && !selectedSessionId) setSelectedSessionId(String(first.session_id));
    }
  };

  const loadManualRuns = async () => {
    const res = await btsyApi.calibrationRuns.listRuns(200);
    if (res.success) setManualRuns(res.data || []);
  };

  const loadRuns = async () => {
    const res = await btsyApi.autoRun.listRuns(200);
    if (res.success) setRuns(res.data || []);
  };

  const loadRunDetail = async (runId) => {
    const res = await btsyApi.autoRun.getRun(runId);
    if (res.success) setRunDetail(res.data);
  };

  const loadLog = async (runId) => {
    const res = await btsyApi.autoRun.getLog(runId, 250);
    if (res.success) setLogLines(res.data?.lines || []);
  };

  useEffect(() => {
    loadSessions();
    loadRuns();
    loadManualRuns();
    const id = setInterval(() => {
      loadRuns();
      loadManualRuns();
      if (selectedRunId) {
        const rid = parseInt(selectedRunId, 10);
        if (Number.isFinite(rid)) {
          loadRunDetail(rid);
          loadLog(rid);
        }
      }
    }, 2000);
    return () => clearInterval(id);
  }, [selectedRunId]);

  const canRun = Boolean(snapshotId && selectedSessionId);

  const canCreateManual = Boolean(snapshotId);

  const createManualRun = async () => {
    if (!snapshotId) return;
    setManualBusy(true);
    setError('');
    try {
      const res = await btsyApi.calibrationRuns.createRun(snapshotId, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to create calibration run');
        return;
      }
      const id = res.data?.calibration_run_id;
      if (id) {
        await setActiveCalibrationRunId(String(id));
      }
      await loadManualRuns();
    } finally {
      setManualBusy(false);
    }
  };

  const createRun = async () => {
    if (!snapshotId || !selectedSessionId) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.autoRun.createRun(snapshotId, parseInt(selectedSessionId, 10), 'simulation', 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to create run');
      return;
    }
    await loadRuns();
    const newId = res.data?.run_id;
    if (newId) {
      setSelectedRunId(String(newId));
      setTab('progress');
      await loadRunDetail(newId);
      await loadLog(newId);
    }
  };

  const downloadReport = async () => {
    const rid = selectedRunId ? parseInt(selectedRunId, 10) : null;
    if (!rid) return;
    setBusy(true);
    setError('');
    try {
      const response = await btsyApi.autoRun.downloadReport(rid);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError('Failed to download report');
    } finally {
      setBusy(false);
    }
  };

  if (selectedRunId) {
    const pct = Math.max(0, Math.min(100, Number(runDetail?.progress_pct ?? selectedRun?.progress_pct ?? 0)));
    const status = runDetail?.status || selectedRun?.status || '';
    const currentStep = runDetail?.current_step || selectedRun?.current_step || '';
    const summary = runDetail?.summary || {};
    const reportAvailable = Boolean(runDetail?.report_pdf_path);

    return (
      <Box sx={{ p: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Button variant="outlined" onClick={() => { setSelectedRunId(''); setRunDetail(null); setLogLines([]); }}>
            Back
          </Button>
          <Stack spacing={0.25}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Calibration Run {selectedRunId}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Live progress view — the run executes sequentially and is read-only.
            </Typography>
          </Stack>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`Status: ${status}`} />
              <Chip label={`Progress: ${pct.toFixed(0)}%`} />
              {currentStep && <Chip label={`Step: ${currentStep}`} />}
              {summary?.config_id && <Chip label={`Config: ${summary.config_id}`} />}
              {summary?.config_version && <Chip label={`Version: ${summary.config_version}`} />}
              {snapshotId && <Chip label={`Snapshot: ${snapshotId}`} />}
            </Stack>
            <LinearProgress variant="determinate" value={pct} />
            <Divider />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" sx={{ bgcolor: '#0f172a' }} disabled={!reportAvailable || busy} onClick={downloadReport}>
                Open PDF Report
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 1 }}>
            <Tab value="progress" label="Progress" />
            <Tab value="summary" label="Final Summary" />
            <Tab value="logs" label="Logs" />
          </Tabs>
          <Divider />
          <Box sx={{ p: 2 }}>
            {tab === 'progress' && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Event</TableCell>
                    <TableCell>Details</TableCell>
                    <TableCell>Time</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(runDetail?.events || []).slice().reverse().slice(0, 50).reverse().map((e, idx) => (
                    <TableRow key={`${e.created_at}-${idx}`}>
                      <TableCell>{e.event_type}</TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {JSON.stringify(e.event)}
                        </Typography>
                      </TableCell>
                      <TableCell>{e.created_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {tab === 'summary' && (
              <>
                {status !== 'COMPLETED' && (
                  <Alert severity="info">
                    Final summary is available after completion.
                  </Alert>
                )}
                {status === 'COMPLETED' && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                          Run Metadata
                        </Typography>
                        <Stack spacing={0.75}>
                          <Typography variant="body2">{`Mode: ${summary.mode || 'simulation'}`}</Typography>
                          <Typography variant="body2">{`Snapshot: ${summary.snapshot_id || snapshotId}`}</Typography>
                          <Typography variant="body2">{`Config: ${summary.config_id || ''}`}</Typography>
                          <Typography variant="body2">{`Version: ${summary.config_version || ''}`}</Typography>
                        </Stack>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                          Alert Volume & STR Capture
                        </Typography>
                        <Stack spacing={0.75}>
                          <Typography variant="body2">{`Alerts: ${summary.alerts?.alert_count ?? ''}`}</Typography>
                          <Typography variant="body2">{`STR capture rate (%): ${summary.str?.capture_rate ?? ''}`}</Typography>
                          <Typography variant="body2">{`Missed STRs: ${summary.str?.missed_str ?? ''}`}</Typography>
                        </Stack>
                      </Paper>
                    </Grid>
                  </Grid>
                )}
              </>
            )}

            {tab === 'logs' && (
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Run Log (tail)
                </Typography>
                <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {(logLines || []).join('\n') || 'No log output yet.'}
                </Box>
              </Paper>
            )}
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Calibration Runs
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Create a calibration_run_id for step-wise work, or run Auto-Run for end-to-end execution.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Tabs value={modeTab} onChange={(_e, v) => setModeTab(v)} sx={{ px: 1 }}>
          <Tab value="manual" label="Manual (Step-Wise)" />
          <Tab value="autorun" label="Auto-Run" />
        </Tabs>
        <Divider />
        {modeTab === 'manual' && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Stack spacing={1.5}>
                    {!snapshotId && (
                      <Alert severity="warning">
                        Select a snapshot first (Data Foundation → Snapshot Selection).
                      </Alert>
                    )}
                    {snapshotId && (
                      <Stack spacing={1}>
                        <Chip label={`Snapshot: ${snapshotId}`} />
                      </Stack>
                    )}
                    <Divider />
                    <Button variant="contained" sx={{ bgcolor: '#0f172a' }} disabled={!canCreateManual || manualBusy} onClick={createManualRun}>
                      Create Calibration Run ID
                    </Button>
                    {activeCalibrationRunId && (
                      <Alert severity="success">
                        Active calibration_run_id: {activeCalibrationRunId}
                      </Alert>
                    )}
                  </Stack>
                </Paper>
              </Grid>
              <Grid item xs={12} md={8}>
                <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Box sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      Manual Runs
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Run</TableCell>
                          <TableCell>Snapshot</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Active</TableCell>
                          <TableCell>Created</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(manualRuns || []).map((r) => (
                          <TableRow
                            key={r.calibration_run_id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={async () => {
                              await setActiveCalibrationRunId(String(r.calibration_run_id));
                              await loadManualRuns();
                            }}
                          >
                            <TableCell>{r.calibration_run_id}</TableCell>
                            <TableCell>{r.snapshot_id}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>{r.active ? 'Yes' : ''}</TableCell>
                            <TableCell>{r.created_at}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {(manualRuns || []).length === 0 && (
                      <Alert severity="info" sx={{ mt: 2 }}>
                        No manual runs yet. Create one to unlock Universe and step-wise workflow.
                      </Alert>
                    )}
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </Paper>

      {modeTab !== 'autorun' ? null : (
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              {!snapshotId && (
                <Alert severity="warning">
                  Select a snapshot first (Data Foundation → Snapshot Selection).
                </Alert>
              )}
              {snapshotId && (
                <Stack spacing={1}>
                  <Chip label={`Snapshot: ${snapshotId}`} />
                </Stack>
              )}

              <FormControl fullWidth size="small" disabled={sessions.length === 0}>
                <InputLabel>Scenario Config (Session)</InputLabel>
                <Select value={selectedSessionId} label="Scenario Config (Session)" onChange={(e) => setSelectedSessionId(e.target.value)}>
                  {sessions.map((s) => (
                    <MenuItem key={s.session_id} value={String(s.session_id)}>
                      {`Session ${s.session_id} • ${s.metric_name} • ${s.entity_level}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Auto-Run v1 is a deterministic execution spine. It does not do batch search, resume, or comparisons.
              </Typography>
              <Button variant="contained" sx={{ bgcolor: '#0f172a' }} disabled={!canRun || busy} onClick={createRun}>
                Run Simulation
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Runs
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Run</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Progress</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>Config</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(runs || []).map((r) => (
                    <TableRow
                      key={r.run_id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={async () => {
                        setSelectedRunId(String(r.run_id));
                        setTab('progress');
                        await loadRunDetail(r.run_id);
                        await loadLog(r.run_id);
                      }}
                    >
                      <TableCell>{r.run_id}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell align="right">{(r.progress_pct ?? 0).toFixed(0)}%</TableCell>
                      <TableCell>{r.current_step}</TableCell>
                      <TableCell>{r.config_id}</TableCell>
                      <TableCell>{r.created_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(runs || []).length === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  No runs yet. Create one to start the pipeline.
                </Alert>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
      )}
    </Box>
  );
};

export default AutoRunCalibrationRunsScreen;
