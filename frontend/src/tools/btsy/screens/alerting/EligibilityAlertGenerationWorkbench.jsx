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
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const EligibilityAlertGenerationWorkbench = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [context, setContext] = useState(null);
  const [preview, setPreview] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [activeTab, setActiveTab] = useState('alerts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sid = selectedSessionId ? parseInt(selectedSessionId, 10) : null;

  const canPreview = Boolean(context?.approved);
  const canGenerate = Boolean(preview && canPreview);
  const hasRuns = runs.length > 0;

  const policyCards = useMemo(() => (context?.rules || []), [context]);

  const loadSessions = async () => {
    const res = await btsyApi.calibration.listSessions();
    if (res.success) setSessions(res.data || []);
  };

  const loadContext = async (sessionId) => {
    setError('');
    setPreview(null);
    setGenerated(null);
    const [ctxRes, listRes] = await Promise.all([
      btsyApi.alerting.getContext(sessionId),
      btsyApi.alerting.listRuns(sessionId)
    ]);
    if (ctxRes.success) setContext(ctxRes.data);
    if (listRes.success) setRuns(listRes.data || []);
    const firstRun = (listRes.data || [])[0];
    setSelectedRunId(firstRun ? String(firstRun.alert_run_id) : '');
  };

  const loadRun = async (sessionId, runId) => {
    if (!sessionId || !runId) {
      setGenerated(null);
      return;
    }
    const res = await btsyApi.alerting.getRun(sessionId, runId);
    if (res.success) setGenerated(res.data);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!sid) {
      setContext(null);
      setPreview(null);
      setGenerated(null);
      setRuns([]);
      setSelectedRunId('');
      return;
    }
    loadContext(sid);
  }, [sid]);

  useEffect(() => {
    if (!sid || !selectedRunId) return;
    loadRun(sid, parseInt(selectedRunId, 10));
  }, [sid, selectedRunId]);

  const handlePreview = async () => {
    if (!sid) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.alerting.preview(sid);
    setBusy(false);
    if (res.success) setPreview(res.data);
    else setError(res.error || 'Failed to preview');
  };

  const handleGenerate = async () => {
    if (!sid) return;
    setBusy(true);
    setError('');
    const res = await btsyApi.alerting.generate(sid);
    setBusy(false);
    if (res.success) {
      setGenerated(res.data);
      const listRes = await btsyApi.alerting.listRuns(sid);
      if (listRes.success) setRuns(listRes.data || []);
      setSelectedRunId(String(res.data?.run?.alert_run_id || ''));
      setActiveTab('alerts');
    } else {
      setError(res.error || 'Failed to generate alerts');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Eligibility & Alert Generation
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Step-4 applies eligibility policy to already-identified risky entities. It does not redefine risk or thresholds.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Policy Context
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

              {!context?.approved && (
                <Alert severity="warning">
                  Step-4 is available only after an approved final boundary exists (Orchestrated Run → Approve Boundary).
                </Alert>
              )}

              {context?.approved && (
                <Stack spacing={1}>
                  <Chip label={`Boundary: ${context.boundary_id}`} />
                  <Chip label={`Threshold: ${context.threshold_value}`} />
                  <Chip label={`ATL entering Step-4: ${context.atl_count}`} />
                  {context.entity_level && <Chip label={`Entity level: ${context.entity_level}`} />}
                </Stack>
              )}

              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                You are now applying eligibility policy to risky behaviour. This does not change risk classification.
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Eligibility Rules
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Rules are executed as readable policy checks with full traceability. They do not change Step-3 risk.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {policyCards.map((r) => (
                    <Chip key={r.rule_id} label={r.title} />
                  ))}
                </Stack>
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Preview Impact
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Preview must be completed before generating operational alerts.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button variant="outlined" onClick={handlePreview} disabled={!canPreview || busy}>
                    Preview Alerts
                  </Button>
                  <Button variant="contained" onClick={handleGenerate} disabled={!canGenerate || busy}>
                    Generate Operational Alerts
                  </Button>
                </Stack>

                {preview && (
                  <>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip label={`ATL total: ${preview.counts.atl_total}`} />
                      <Chip label={`Eligible: ${preview.counts.eligible_total}`} color="success" />
                      <Chip label={`Suppressed: ${preview.counts.suppressed_total}`} color="warning" />
                    </Stack>

                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
                      Suppression Attribution
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Rule</TableCell>
                          <TableCell>Suppressed</TableCell>
                          <TableCell>% Impact</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(preview.suppression_attribution || []).map((r) => (
                          <TableRow key={r.rule_id}>
                            <TableCell>{r.rule_id}</TableCell>
                            <TableCell>{r.suppressed_count}</TableCell>
                            <TableCell>{r.suppressed_pct.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Box sx={{ px: 2, pt: 1 }}>
                <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
                  <Tab value="alerts" label="Alerts Generated" />
                  <Tab value="trace" label="Eligibility Decision Trace" />
                  <Tab value="impact" label="Suppression Attribution" />
                  <Tab value="whatif" label="What-If Policy Simulator" disabled={!hasRuns} />
                </Tabs>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <FormControl fullWidth size="small" disabled={!sid || runs.length === 0}>
                    <InputLabel>Alert Runs</InputLabel>
                    <Select value={selectedRunId} label="Alert Runs" onChange={(e) => setSelectedRunId(e.target.value)}>
                      {runs.map((r) => (
                        <MenuItem key={r.alert_run_id} value={String(r.alert_run_id)}>
                          {`Run ${r.alert_run_id} • ${r.status}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {activeTab === 'alerts' && (
                    <>
                      {!generated && <Alert severity="info">Generate alerts to see operational output.</Alert>}
                      {generated && (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Alert ID</TableCell>
                              <TableCell>Entity</TableCell>
                              <TableCell>Account</TableCell>
                              <TableCell>Customer</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(generated.alerts || []).map((a) => (
                              <TableRow key={a.alert_id}>
                                <TableCell>{a.alert_id}</TableCell>
                                <TableCell>{a.entity_id}</TableCell>
                                <TableCell>{a.account_id || '—'}</TableCell>
                                <TableCell>{a.customer_id || '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}

                  {activeTab === 'trace' && (
                    <>
                      {!generated && <Alert severity="info">Run generation persists full rule-by-rule decisions.</Alert>}
                      {generated && (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Entity</TableCell>
                              <TableCell>Rule</TableCell>
                              <TableCell>Result</TableCell>
                              <TableCell>Reason</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(generated.eligibility_decisions || []).slice(0, 300).map((d, idx) => (
                              <TableRow key={`${d.entity_id}-${d.rule_id}-${idx}`}>
                                <TableCell>{d.entity_id}</TableCell>
                                <TableCell>{d.rule_id}</TableCell>
                                <TableCell>{d.rule_result}</TableCell>
                                <TableCell>{d.rule_reason || '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}

                  {activeTab === 'impact' && (
                    <>
                      {!generated && <Alert severity="info">Suppression attribution appears after first run.</Alert>}
                      {generated && (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Rule</TableCell>
                              <TableCell>Suppressed</TableCell>
                              <TableCell>% Impact</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(generated.suppression_attribution || []).map((r) => (
                              <TableRow key={r.rule_id}>
                                <TableCell>{r.rule_id}</TableCell>
                                <TableCell>{r.suppressed_count}</TableCell>
                                <TableCell>{r.suppressed_pct.toFixed(1)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}

                  {activeTab === 'whatif' && (
                    <Alert severity="info">
                      Simulation mode is read-only and has no operational impact.
                    </Alert>
                  )}
                </Stack>
              </Box>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default EligibilityAlertGenerationWorkbench;
