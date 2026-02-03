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
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  List,
  ListItem,
  ListItemText
} from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import btsyApi from '../../services/btsyApi';


const MissedSTRAnalysisWorkbench = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(sessionStorage.getItem('btsy_validation_session_id') || '');
  const [context, setContext] = useState(null);
  const [alignmentRuns, setAlignmentRuns] = useState([]);
  const [selectedAlignmentRunId, setSelectedAlignmentRunId] = useState('');
  const [alignmentRun, setAlignmentRun] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [missedRun, setMissedRun] = useState(null);
  const [selectedRootCause, setSelectedRootCause] = useState('');
  const [tab, setTab] = useState('diagnostics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;

  const chartData = useMemo(() => {
    const metrics = missedRun?.metrics || [];
    return metrics.map((m) => ({
      root_cause_code: m.root_cause_code,
      count: m.count,
    }));
  }, [missedRun]);

  const loadSessions = async () => {
    const res = await btsyApi.calibration.listSessions();
    if (res.success) setSessions(res.data || []);
  };

  const loadSessionData = async (sessionId) => {
    setError('');
    setContext(null);
    setAlignmentRuns([]);
    setSelectedAlignmentRunId('');
    setAlignmentRun(null);
    setDiagnostics(null);
    setMissedRun(null);
    const [ctxRes, listRes] = await Promise.all([
      btsyApi.validation.getStrAlignmentContext(sessionId),
      btsyApi.validation.listStrAlignmentRuns(sessionId),
    ]);
    if (ctxRes.success) setContext(ctxRes.data);
    if (listRes.success) {
      setAlignmentRuns(listRes.data || []);
      const firstRun = (listRes.data || [])[0];
      setSelectedAlignmentRunId(firstRun ? String(firstRun.str_alignment_run_id) : '');
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

  const loadDiagnostics = async (runId) => {
    if (!runId) {
      setDiagnostics(null);
      return;
    }
    const res = await btsyApi.validation.getStrAlignmentDiagnostics(parseInt(runId, 10));
    if (res.success) setDiagnostics(res.data);
  };

  const loadMissedRun = async (missedRunId, rootCauseCode = '') => {
    if (!missedRunId) return;
    const res = await btsyApi.validation.getMissedStrRun(parseInt(missedRunId, 10), rootCauseCode || null, 500, 0);
    if (res.success) setMissedRun(res.data);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!sid) return;
    loadSessionData(sid);
  }, [sid]);

  useEffect(() => {
    if (!selectedAlignmentRunId) return;
    loadAlignmentRun(selectedAlignmentRunId);
    loadDiagnostics(selectedAlignmentRunId);
    const stored = sessionStorage.getItem('btsy_missed_str_run_id');
    if (stored) {
      setSelectedRootCause('');
      loadMissedRun(stored, '');
    } else {
      setMissedRun(null);
    }
  }, [selectedAlignmentRunId]);

  const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString());
  const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

  const classify = async () => {
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
    const mrid = res.data?.run?.missed_run_id;
    sessionStorage.setItem('btsy_missed_str_run_id', String(mrid || ''));
    setSelectedRootCause('');
    setMissedRun(res.data);
  };

  const rootCauseOptions = useMemo(() => {
    const ms = missedRun?.metrics || [];
    return ms.map((m) => m.root_cause_code);
  }, [missedRun]);

  const onRootCauseChange = async (v) => {
    setSelectedRootCause(v);
    const mrid = missedRun?.run?.missed_run_id;
    if (!mrid) return;
    await loadMissedRun(mrid, v);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Missed STR Analysis
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          When an STR was filed, why did our system not generate an alert beforehand?
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

              <FormControl fullWidth size="small" disabled={!sid || alignmentRuns.length === 0}>
                <InputLabel>STR Alignment Run</InputLabel>
                <Select value={selectedAlignmentRunId} label="STR Alignment Run" onChange={(e) => setSelectedAlignmentRunId(e.target.value)}>
                  {alignmentRuns.map((r) => (
                    <MenuItem key={r.str_alignment_run_id} value={String(r.str_alignment_run_id)}>
                      {`Run ${r.str_alignment_run_id} • AlertRun ${r.alert_run_id}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {sid && alignmentRuns.length === 0 && (
                <Alert severity="warning">
                  Step-5 alignment run required. Run STR Alignment first.
                </Alert>
              )}

              <Divider />
              <Stack spacing={1}>
                {context?.session?.metric_name && <Chip label={`Scenario metric: ${context.session.metric_name}`} />}
                {context?.session?.entity_level && <Chip label={`Entity level: ${context.session.entity_level}`} />}
                {alignmentRun?.run?.alert_run_id && <Chip label={`AlertRun: ${alignmentRun.run.alert_run_id}`} />}
                {alignmentRun?.run?.threshold_value != null && <Chip label={`Threshold: ${alignmentRun.run.threshold_value}`} />}
                {context?.str_window?.min && <Chip label={`STR window: ${context.str_window.min} → ${context.str_window.max || '—'}`} />}
                {alignmentRun?.run?.temporal_rule && <Chip label={`Temporal rule: ${alignmentRun.run.temporal_rule}`} />}
              </Stack>

              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                This analysis explains why STRs were missed. It does not re-evaluate risk or policy.
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Root-Cause Classification Engine
                </Typography>
                <Button variant="contained" sx={{ bgcolor: '#0f172a' }} disabled={!alignmentRun || busy} onClick={classify}>
                  Classify Missed STRs
                </Button>
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 1 }}>
                <Tab value="diagnostics" label="Diagnostics" />
                <Tab value="summary" label="Summary" />
                <Tab value="distribution" label="Distribution" />
                <Tab value="drilldown" label="Drill-down" />
              </Tabs>
              <Divider />
              <Box sx={{ p: 2 }}>
                {tab === 'diagnostics' && (
                  <>
                    {!diagnostics && (
                      <Alert severity="info">
                        Select an STR alignment run to view diagnostics.
                      </Alert>
                    )}
                    {diagnostics && (
                      <Stack spacing={2}>
                        <Alert severity="info" variant="outlined">
                          {diagnostics.guardrail}
                        </Alert>

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                              <Stack spacing={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  STR–Alert Join Diagnostics
                                </Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  Entity join key: {diagnostics.join_key?.entity_key || '—'} → alerts.{diagnostics.join_key?.alerts_entity_column || 'entity_id'}
                                </Typography>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell>Total STR accounts</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_alert_join_diagnostics?.str_accounts_total)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>STR accounts matched to alerts</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_alert_join_diagnostics?.str_accounts_matched_to_alerts)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>STR accounts unmatched</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_alert_join_diagnostics?.str_accounts_unmatched)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Join key null rows</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_alert_join_diagnostics?.null_entity_id_rows)}</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </Stack>
                            </Paper>
                          </Grid>

                          <Grid item xs={12} md={6}>
                            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                              <Stack spacing={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  Temporal Alignment Validation
                                </Typography>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell>Alert date range</TableCell>
                                      <TableCell align="right">
                                        {diagnostics.temporal_alignment?.min_alert_date || '—'} → {diagnostics.temporal_alignment?.max_alert_date || '—'}
                                      </TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>STR filed date range</TableCell>
                                      <TableCell align="right">
                                        {diagnostics.temporal_alignment?.min_str_filed_date || '—'} → {diagnostics.temporal_alignment?.max_str_filed_date || '—'}
                                      </TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>% STRs where alert_date ≤ str_filed_date</TableCell>
                                      <TableCell align="right">
                                        {fmtPct(diagnostics.temporal_alignment?.pct_strs_alert_le_str_filed)}
                                      </TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Comparable pairs</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.temporal_alignment?.comparable_pairs)}</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                                {(diagnostics.temporal_alignment?.issues || []).length > 0 && (
                                  <>
                                    <Divider />
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      Detected issues
                                    </Typography>
                                    <List dense sx={{ py: 0 }}>
                                      {(diagnostics.temporal_alignment.issues || []).map((it) => (
                                        <ListItem key={it} sx={{ py: 0.25 }}>
                                          <ListItemText primaryTypographyProps={{ variant: 'body2', sx: { color: 'text.secondary' } }} primary={it} />
                                        </ListItem>
                                      ))}
                                    </List>
                                  </>
                                )}
                              </Stack>
                            </Paper>
                          </Grid>

                          <Grid item xs={12} md={6}>
                            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                              <Stack spacing={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  Universe Clarity
                                </Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  Alignment performed on: {diagnostics.universe?.alignment_performed_on || '—'}
                                </Typography>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell>All alerts (rows)</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.universe?.alert_rows)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>All alerts (entities)</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.universe?.alert_entities)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Pre-threshold (breached entities total)</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.universe?.breached_entities_total)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Post-threshold (breached within alert universe)</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.universe?.breached_entities_in_alert_universe)}</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </Stack>
                            </Paper>
                          </Grid>

                          <Grid item xs={12} md={6}>
                            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                              <Stack spacing={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  STR Metrics
                                </Typography>
                                <Table size="small">
                                  <TableBody>
                                    <TableRow>
                                      <TableCell>Total STRs</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_metrics?.total_str)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Captured STRs</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_metrics?.captured_str)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>Missed STRs</TableCell>
                                      <TableCell align="right">{fmtInt(diagnostics.str_metrics?.missed_str)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>STR capture rate (%)</TableCell>
                                      <TableCell align="right">{fmtPct(diagnostics.str_metrics?.str_capture_rate_pct)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell>STR alert rate (%)</TableCell>
                                      <TableCell align="right">{fmtPct(diagnostics.str_metrics?.str_alert_rate_pct)}</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </Stack>
                            </Paper>
                          </Grid>

                          <Grid item xs={12}>
                            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                              <Stack spacing={1.25}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  Root-Cause Classification (Missed STRs)
                                </Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  These categories explain missed STRs due to data alignment, timing, threshold choice, or scenario blind spots.
                                </Typography>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Category</TableCell>
                                      <TableCell align="right">Count</TableCell>
                                      <TableCell align="right">%</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {(diagnostics.missed_root_cause_rollup?.categories || []).map((c) => (
                                      <TableRow key={c.category}>
                                        <TableCell>{c.category}</TableCell>
                                        <TableCell align="right">{fmtInt(c.count)}</TableCell>
                                        <TableCell align="right">{fmtPct(c.percentage)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Stack>
                            </Paper>
                          </Grid>
                        </Grid>
                      </Stack>
                    )}
                  </>
                )}

                {tab === 'summary' && (
                  <>
                    {!alignmentRun && (
                      <Alert severity="info">
                        Select an STR alignment run to view summary.
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
                          <TableRow>
                            <TableCell>STR capture rate (%)</TableCell>
                            <TableCell align="right">{fmtPct(alignmentRun.summary?.capture_rate)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Join key (entity)</TableCell>
                            <TableCell align="right">{diagnostics?.join_key?.entity_key || '—'}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </>
                )}

                {tab === 'distribution' && (
                  <>
                    {!missedRun && (
                      <Alert severity="info">
                        Run classification to view root-cause distribution.
                      </Alert>
                    )}
                    {missedRun && (
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="root_cause_code" tick={{ fontSize: 11 }} interval={0} height={80} />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="count" fill="#D04A02" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </>
                )}

                {tab === 'drilldown' && (
                  <>
                    {!missedRun && (
                      <Alert severity="info">
                        Run classification to drill into missed STRs.
                      </Alert>
                    )}
                    {missedRun && (
                      <Stack spacing={1.5}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                          <FormControl size="small" sx={{ width: 320 }}>
                            <InputLabel>Root Cause</InputLabel>
                            <Select
                              value={selectedRootCause}
                              label="Root Cause"
                              onChange={(e) => onRootCauseChange(e.target.value)}
                            >
                              <MenuItem value="">All</MenuItem>
                              {rootCauseOptions.map((c) => (
                                <MenuItem key={c} value={c}>{c}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            Click a category to focus the missed STR list.
                          </Typography>
                        </Stack>

                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>STR</TableCell>
                              <TableCell>Account</TableCell>
                              <TableCell>Entity</TableCell>
                              <TableCell>STR Filed</TableCell>
                              <TableCell>Boundary Cross</TableCell>
                              <TableCell>Root Cause</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(missedRun.rows || []).map((r) => (
                              <TableRow key={`${r.str_id}-${r.entity_id}`}>
                                <TableCell>{`STR-${String(r.str_id).padStart(4, '0')}`}</TableCell>
                                <TableCell>{r.account_id || '—'}</TableCell>
                                <TableCell>{r.entity_id || '—'}</TableCell>
                                <TableCell>{r.str_filed_date || '—'}</TableCell>
                                <TableCell>{r.breach_date || '—'}</TableCell>
                                <TableCell>
                                  <Stack spacing={0.5}>
                                    <Typography variant="body2">{r.root_cause_code}</Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                      {r.explanation_text}
                                    </Typography>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Stack>
                    )}
                  </>
                )}
              </Box>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MissedSTRAnalysisWorkbench;
