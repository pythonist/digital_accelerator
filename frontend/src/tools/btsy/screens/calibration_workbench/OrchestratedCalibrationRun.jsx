import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const statusColor = (status) => {
  const s = (status || '').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'warning') return 'warning';
  if (s === 'failed') return 'error';
  if (s === 'running') return 'info';
  return 'default';
};

const OrchestratedCalibrationRun = ({ sessionId }) => {
  const sid = sessionId ? parseInt(sessionId, 10) : null;
  const [runs, setRuns] = useState([]);
  const [baselineRunId, setBaselineRunId] = useState('');
  const [percentile, setPercentile] = useState('99');
  const [bufferType, setBufferType] = useState('hard');
  const [bandPct, setBandPct] = useState('2');
  const [activeOcrRunId, setActiveOcrRunId] = useState('');
  const [activeRun, setActiveRun] = useState(null);
  const [approved, setApproved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finalBoundaryId = useMemo(() => {
    const v =
      activeRun?.run?.final_boundary_id ??
      activeRun?.final_boundary?.boundary_id ??
      activeRun?.report?.report?.results?.boundary_id ??
      null;
    if (v == null) return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  }, [activeRun]);

  const refreshRuns = async () => {
    if (!sid) return;
    const res = await btsyApi.orchestrated.listRuns(sid);
    if (res.success) setRuns(res.data || []);
  };

  const refreshApproved = async () => {
    if (!sid) return;
    const res = await btsyApi.orchestrated.getApprovedBoundary(sid);
    if (res.success) setApproved(res.data);
  };

  const refreshActive = async (runId) => {
    if (!sid || !runId) return;
    const res = await btsyApi.orchestrated.getRun(sid, parseInt(runId, 10));
    if (res.success) setActiveRun(res.data);
  };

  useEffect(() => {
    setRuns([]);
    setBaselineRunId('');
    setActiveOcrRunId('');
    setActiveRun(null);
    setApproved(null);
    setError('');
    if (!sid) return;
    refreshRuns();
    refreshApproved();
  }, [sid]);

  useEffect(() => {
    if (!sid || !activeOcrRunId) return;
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await btsyApi.orchestrated.getRun(sid, parseInt(activeOcrRunId, 10));
        if (!cancelled && res.success) {
          setActiveRun(res.data);
          const st = (res.data?.run?.status || '').toLowerCase();
          if (st === 'completed' || st === 'failed') {
            refreshRuns();
            refreshApproved();
            return;
          }
        }
      } finally {
        inFlight = false;
      }
      if (!cancelled) setTimeout(tick, 3000);
    };

    tick();
    return () => { cancelled = true; };
  }, [sid, activeOcrRunId]);

  const config = useMemo(() => {
    const pct = parseFloat(percentile || '99');
    const bp = parseFloat(bandPct || '2');
    return {
      percentile: isNaN(pct) ? 99 : pct,
      buffer_type: bufferType,
      buffer_params: bufferType === 'hard' ? {} : { band_pct: isNaN(bp) ? 2 : bp }
    };
  }, [percentile, bufferType, bandPct]);

  const canRun = Boolean(sid);

  const startRun = async () => {
    if (!sid) return;
    setBusy(true);
    setError('');
    const base = baselineRunId ? parseInt(baselineRunId, 10) : null;
    const res = await btsyApi.orchestrated.createRun(sid, config, base, 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to create orchestrated run');
      return;
    }
    const id = res.data?.run?.ocr_run_id;
    if (id) setActiveOcrRunId(String(id));
  };

  const approveBoundary = async () => {
    if (!sid || !activeOcrRunId) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.orchestrated.approveBoundary(sid, parseInt(activeOcrRunId, 10), 'user');
    setBusy(false);
    if (res.success) {
      setApproved(res.data);
      refreshRuns();
      refreshApproved();
      refreshActive(activeOcrRunId);
    }
    else setError(res.error || 'Failed to approve boundary');
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!sid && (
        <Alert severity="info">
          Select a Calibration Session. Orchestrated runs execute the full Step-3 methodology and generate a documented boundary.
        </Alert>
      )}

      {sid && (
        <Stack spacing={2}>
          <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Orchestrated Run — Setup
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
                This will execute the full calibration methodology (Steps 3.1–3.6) and generate a documented boundary. No auto-tuning. No silent boundary changes. Analyst approval required.
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="Percentile"
                  size="small"
                  value={percentile}
                  onChange={(e) => setPercentile(e.target.value)}
                  sx={{ width: 160 }}
                />
                <FormControl size="small" sx={{ width: 220 }}>
                  <InputLabel>Buffer Type</InputLabel>
                  <Select value={bufferType} label="Buffer Type" onChange={(e) => setBufferType(e.target.value)}>
                    <MenuItem value="hard">Hard cutoff</MenuItem>
                    <MenuItem value="buffered">Soft buffer (± band)</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label="Band (%)"
                  size="small"
                  value={bandPct}
                  onChange={(e) => setBandPct(e.target.value)}
                  disabled={bufferType === 'hard'}
                  sx={{ width: 160 }}
                />
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Comparison Baseline</InputLabel>
                  <Select value={baselineRunId} label="Comparison Baseline" onChange={(e) => setBaselineRunId(e.target.value)}>
                    <MenuItem value="">None</MenuItem>
                    {runs.map((r) => (
                      <MenuItem key={r.ocr_run_id} value={String(r.ocr_run_id)}>
                        {`OCR-${String(r.ocr_run_id).padStart(3, '0')} • ${r.status}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button variant="contained" sx={{ bgcolor: '#0f172a', whiteSpace: 'nowrap' }} onClick={startRun} disabled={!canRun || busy}>
                  Execute Orchestrated Run
                </Button>
              </Stack>
            </Box>
          </Paper>

          <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Execution Timeline
              </Typography>
              {!activeRun && (
                <Alert severity="info">
                  Start a run to see the step-by-step timeline with pass/warn indicators.
                </Alert>
              )}
              {activeRun && (
                <>
                  <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
                    <Chip label={`Run: OCR-${String(activeRun.run.ocr_run_id).padStart(3, '0')}`} />
                    <Chip label={`Status: ${activeRun.run.status}`} color={statusColor(activeRun.run.status)} />
                    {activeRun.run.final_boundary_id && <Chip label={`Final Boundary: ${activeRun.run.final_boundary_id}`} />}
                    {activeRun.run.approved_boundary_id && <Chip label={`Approved: ${activeRun.run.approved_boundary_id}`} color="success" />}
                  </Stack>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Step</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activeRun.steps.map((s) => (
                        <TableRow key={s.step_key}>
                          <TableCell>{s.metrics?.title || s.step_key}</TableCell>
                          <TableCell>
                            <Chip label={s.status} size="small" color={statusColor(s.status)} sx={{ borderRadius: 0 }} />
                          </TableCell>
                          <TableCell>{s.warning_text || s.error_text || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </Box>
          </Paper>

          <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Auto-Generated Calibration Summary
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
                This summary is generated from the orchestrated run steps. Manual Mode remains available to reproduce and inspect each step.
              </Typography>
              {activeRun?.report?.report && (
                <>
                  <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
                    <Chip label={`Warnings: ${(activeRun.report.report.warnings || []).length}`} color={(activeRun.report.report.warnings || []).length ? 'warning' : 'success'} />
                    <Chip label="Orchestrated runs execute predefined methodology" />
                    <Chip label="Analyst approval required" />
                  </Stack>
                  {(activeRun.report.report.warnings || []).length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Warnings</Typography>
                      <Stack spacing={1}>
                        {activeRun.report.report.warnings.map((w, idx) => (
                          <Alert key={idx} severity="warning">
                            {w.message}
                          </Alert>
                        ))}
                      </Stack>
                    </Box>
                  )}
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell>Boundary</TableCell>
                        <TableCell>{activeRun.report.report.results?.boundary_id ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Threshold</TableCell>
                        <TableCell>{activeRun.report.report.results?.threshold_value ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>ATL Count</TableCell>
                        <TableCell>{activeRun.report.report.results?.atl_count ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>KS (full)</TableCell>
                        <TableCell>{activeRun.report.report.results?.ks_stat_full ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Max J</TableCell>
                        <TableCell>{activeRun.report.report.results?.max_j ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>J Stability</TableCell>
                        <TableCell>{activeRun.report.report.results?.j_stability_label ?? '—'}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              )}
              {!activeRun?.report?.report && (
                <Alert severity="info">
                  Summary appears after the orchestrated run completes.
                </Alert>
              )}
            </Box>
          </Paper>

          <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Final Boundary Object
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
                Approve boundary for downstream use. Until approved, Step-4 and ML Validation remain locked.
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
                {approved?.approved && (
                  <Chip
                    label={`Approved Boundary: ${approved.boundary_id} (OCR-${String(approved.ocr_run_id).padStart(3, '0')})`}
                    color="success"
                  />
                )}
                {!approved?.approved && <Chip label="No approved boundary yet" color="warning" />}
              </Stack>
              {activeRun?.final_boundary && (
                <Table size="small" sx={{ mb: 2 }}>
                  <TableBody>
                    <TableRow>
                      <TableCell>Boundary ID</TableCell>
                      <TableCell>{activeRun.final_boundary.boundary_id}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Threshold</TableCell>
                      <TableCell>{activeRun.final_boundary.threshold_value}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>ATL Count</TableCell>
                      <TableCell>{activeRun.final_boundary.atl_count}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              <Button
                variant="contained"
                onClick={approveBoundary}
                disabled={!finalBoundaryId || busy || (approved?.approved && approved.boundary_id === finalBoundaryId)}
              >
                Approve Boundary for Downstream Use
              </Button>
            </Box>
          </Paper>
        </Stack>
      )}
    </Box>
  );
};

export default OrchestratedCalibrationRun;
