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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow
} from '@mui/material';
import btsyApi from '../../services/btsyApi';


const STRAlignmentValidationWorkbench = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [context, setContext] = useState(null);
  const [selectedAlertRunId, setSelectedAlertRunId] = useState('');
  const [alignmentRuns, setAlignmentRuns] = useState([]);
  const [selectedAlignmentRunId, setSelectedAlignmentRunId] = useState('');
  const [alignmentRun, setAlignmentRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;

  const alertRuns = useMemo(() => context?.alert_runs || [], [context]);
  const selectedAlertRun = useMemo(
    () => alertRuns.find((r) => String(r.alert_run_id) === String(selectedAlertRunId)) || null,
    [alertRuns, selectedAlertRunId]
  );

  const canRun = Boolean(
    sid &&
      context?.ready &&
      selectedAlertRunId
  );

  const loadSessions = async () => {
    const res = await btsyApi.calibration.listSessions();
    if (res.success) setSessions(res.data || []);
  };

  const loadContext = async (sessionId) => {
    setError('');
    const [ctxRes, runsRes] = await Promise.all([
      btsyApi.validation.getStrAlignmentContext(sessionId),
      btsyApi.validation.listStrAlignmentRuns(sessionId),
    ]);
    if (ctxRes.success) {
      setContext(ctxRes.data);
      const firstAlert = (ctxRes.data?.alert_runs || [])[0];
      setSelectedAlertRunId(firstAlert ? String(firstAlert.alert_run_id) : '');
    } else {
      setContext(null);
      setError(ctxRes.error || 'Failed to load STR alignment context');
    }
    if (runsRes.success) {
      setAlignmentRuns(runsRes.data || []);
      const firstRun = (runsRes.data || [])[0];
      setSelectedAlignmentRunId(firstRun ? String(firstRun.str_alignment_run_id) : '');
    } else {
      setAlignmentRuns([]);
      setSelectedAlignmentRunId('');
    }
  };

  const loadAlignmentRun = async (runId) => {
    if (!runId) {
      setAlignmentRun(null);
      return;
    }
    const res = await btsyApi.validation.getStrAlignmentRun(parseInt(runId, 10));
    if (res.success) setAlignmentRun(res.data);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!sid) {
      setContext(null);
      setSelectedAlertRunId('');
      setAlignmentRuns([]);
      setSelectedAlignmentRunId('');
      setAlignmentRun(null);
      return;
    }
    loadContext(sid);
  }, [sid]);

  useEffect(() => {
    if (!selectedAlignmentRunId) {
      setAlignmentRun(null);
      return;
    }
    loadAlignmentRun(selectedAlignmentRunId);
  }, [selectedAlignmentRunId]);

  const runAlignment = async () => {
    if (!sid || !selectedAlertRunId) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.validation.createStrAlignmentRun(sid, parseInt(selectedAlertRunId, 10), 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to run STR alignment');
      return;
    }
    const runId = res.data?.run?.str_alignment_run_id;
    setAlignmentRun(res.data);
    const listRes = await btsyApi.validation.listStrAlignmentRuns(sid);
    if (listRes.success) setAlignmentRuns(listRes.data || []);
    if (runId) setSelectedAlignmentRunId(String(runId));
  };

  const classifyMissed = async () => {
    const runId = alignmentRun?.run?.str_alignment_run_id;
    if (!runId) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.validation.classifyMissedStrs(runId, 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to classify missed STRs');
      return;
    }
    sessionStorage.setItem('btsy_validation_session_id', String(sid || ''));
    sessionStorage.setItem('btsy_missed_str_run_id', String(res.data?.run?.missed_run_id || ''));
    sessionStorage.setItem('btsy_next_screen', 'validation_missed_str');
    window.location.reload();
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          STR Alignment & Validation
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Step-5 aligns Step-4 alerts to STR outcomes. This is retrospective only and does not change risk policy or thresholds.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Context Lock
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>Calibration Session</InputLabel>
                <Select value={selectedSessionId} label="Calibration Session" onChange={(e) => setSelectedSessionId(e.target.value)}>
                  {sessions.map((s) => (
                    <MenuItem key={s.session_id} value={String(s.session_id)}>
                      {`Session ${s.session_id} • ${s.metric_name}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {!context?.ready && sid && (
                <Alert severity="warning">
                  Missing required context: {(context?.missing || []).join(', ') || 'alert_run'}
                </Alert>
              )}

              <FormControl fullWidth size="small" disabled={!sid || !(context?.alert_runs || []).length}>
                <InputLabel>Alert Generation Run</InputLabel>
                <Select value={selectedAlertRunId} label="Alert Generation Run" onChange={(e) => setSelectedAlertRunId(e.target.value)}>
                  {alertRuns.map((r) => (
                    <MenuItem key={r.alert_run_id} value={String(r.alert_run_id)}>
                      {`AlertRun ${r.alert_run_id} • Boundary ${r.boundary_id} • Threshold ${r.threshold_value}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Divider />
              <Stack spacing={1}>
                {context?.session?.metric_name && <Chip label={`Scenario metric: ${context.session.metric_name}`} />}
                {context?.session?.entity_level && <Chip label={`Entity level: ${context.session.entity_level}`} />}
                {selectedAlertRun && <Chip label={`Threshold: ${selectedAlertRun.threshold_value}`} />}
                {context?.str_window?.min && <Chip label={`STR window: ${context.str_window.min} → ${context.str_window.max || '—'}`} />}
                {context?.temporal_rule && <Chip label={`Temporal rule: ${context.temporal_rule}`} />}
              </Stack>

              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                This analysis classifies why certain STRs had no prior alerts. It does not re-evaluate risk or policy.
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Run STR Alignment
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Aligns STR filings to Step-4 entities under the temporal rule. STRs are used only in this step.
                </Typography>
                <Button variant="contained" sx={{ bgcolor: '#0f172a', width: 260 }} disabled={!canRun || busy} onClick={runAlignment}>
                  Run STR Alignment
                </Button>
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Alignment Summary
                </Typography>
                <FormControl fullWidth size="small" disabled={!sid || alignmentRuns.length === 0}>
                  <InputLabel>Alignment Run</InputLabel>
                  <Select
                    value={selectedAlignmentRunId}
                    label="Alignment Run"
                    onChange={(e) => setSelectedAlignmentRunId(e.target.value)}
                  >
                    {alignmentRuns.map((r) => (
                      <MenuItem key={r.str_alignment_run_id} value={String(r.str_alignment_run_id)}>
                        {`Run ${r.str_alignment_run_id} • AlertRun ${r.alert_run_id} • ${r.created_at}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {!alignmentRun && (
                  <Alert severity="info">
                    Run STR Alignment to generate a replayable Step-5 record.
                  </Alert>
                )}

                {alignmentRun && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell align="right">Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell>Total STRs</TableCell>
                        <TableCell align="right">{alignmentRun.summary?.total_str ?? 0}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Captured STRs</TableCell>
                        <TableCell align="right">{alignmentRun.summary?.captured_str ?? 0}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Missed STRs</TableCell>
                        <TableCell align="right">{alignmentRun.summary?.missed_str ?? 0}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}

                <Divider />
                <Button variant="outlined" disabled={!alignmentRun || busy} onClick={classifyMissed} sx={{ width: 260 }}>
                  Classify Missed STRs
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default STRAlignmentValidationWorkbench;

