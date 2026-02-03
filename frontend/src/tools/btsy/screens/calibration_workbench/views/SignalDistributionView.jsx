import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Divider
} from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import btsyApi from '../../../services/btsyApi';

const defaultView = {
  scale: 'linear',
  bins: 40,
  population: { mode: 'full', pct: 5 },
  winsorize: { enabled: false, low_pct: 1, high_pct: 99 },
  time_slice: 'whole'
};

const SignalDistributionView = ({ session, aggregateView }) => {
  const [view, setView] = useState(defaultView);
  const [report, setReport] = useState(null);
  const [states, setStates] = useState([]);
  const [selectedStateId, setSelectedStateId] = useState('');
  const [stateName, setStateName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);

  const sessionId = session?.session_id;

  const histogram = useMemo(() => report?.chart || null, [report]);
  const bins = histogram?.bins || 0;
  const minv = histogram?.min || 0;
  const maxv = histogram?.max || 0;

  const histData = useMemo(() => {
    const rows = histogram?.rows || [];
    const map = new Map(rows.map(r => [r.bucket, r.count]));
    const filled = [];
    if (!bins) {
      rows.forEach(r => filled.push({ bucket: r.bucket, count: r.count, count_log: (r.count || 0) + 1 }));
      return filled;
    }
    for (let i = 0; i <= bins; i += 1) {
      const c = map.get(i) || 0;
      filled.push({ bucket: i, count: c, count_log: c + 1 });
    }
    return filled;
  }, [histogram, bins]);

  const loadStates = async () => {
    if (!sessionId) return;
    const res = await btsyApi.signal.listStates(sessionId);
    if (res.success) setStates(res.data || []);
  };

  const compute = async (nextView) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.signal.compute(sessionId, nextView, 'user');
      if (res.success) setReport(res.data);
      else setError(res.error || 'Failed to compute signal report');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const emitEvent = async (eventType, params) => {
    if (!sessionId) return;
    await btsyApi.signal.logEvent(sessionId, eventType, params, 'user');
  };

  useEffect(() => {
    if (!sessionId) return;
    loadStates();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await emitEvent('view_changed', { view });
      await compute(view);
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionId, view]);

  const saveState = async () => {
    if (!sessionId) return;
    const name = stateName.trim();
    if (!name) return;
    const res = await btsyApi.signal.saveState(sessionId, name, { view }, 'user');
    if (res.success) {
      setStateName('');
      await loadStates();
    } else {
      setError(res.error || 'Failed to save state');
    }
  };

  const loadState = async () => {
    if (!selectedStateId) return;
    const res = await btsyApi.signal.getState(parseInt(selectedStateId, 10));
    if (res.success) {
      const nextView = res.data?.state?.view || defaultView;
      setView(nextView);
    } else {
      setError(res.error || 'Failed to load state');
    }
  };

  if (!session) return null;

  if (!aggregateView?.summary) {
    return (
      <Alert severity="info">
        Step-3.2 analyses Step-3.1 outputs. Apply an aggregation lens first.
      </Alert>
    );
  }

  if (report?.status === 'empty') {
    return (
      <Alert severity="warning">
        {report.hint || report.reason || 'No signal distribution available for this selection.'}
      </Alert>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Step-3.2 Controls</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
              Signal distribution and stability analysis only. No thresholds applied here.
            </Typography>

            <Typography variant="caption" sx={{ color: '#64748b' }}>Scale</Typography>
            <ToggleButtonGroup
              size="small"
              value={view.scale}
              exclusive
              sx={{ mt: 0.5, mb: 2, flexWrap: 'wrap' }}
              onChange={(_e, v) => v && setView(prev => ({ ...prev, scale: v }))}
            >
              <ToggleButton value="linear">Linear</ToggleButton>
              <ToggleButton value="log">Log</ToggleButton>
            </ToggleButtonGroup>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Population</InputLabel>
              <Select
                value={view.population.mode}
                label="Population"
                onChange={(e) => setView(prev => ({ ...prev, population: { ...prev.population, mode: e.target.value } }))}
              >
                <MenuItem value="full">Full population</MenuItem>
                <MenuItem value="top">Top X%</MenuItem>
                <MenuItem value="bottom">Bottom X%</MenuItem>
              </Select>
            </FormControl>

            {view.population.mode !== 'full' && (
              <TextField
                fullWidth
                size="small"
                type="number"
                label="X (%)"
                value={view.population.pct}
                onChange={(e) => setView(prev => ({ ...prev, population: { ...prev.population, pct: parseFloat(e.target.value || '0') } }))}
                sx={{ mb: 2 }}
              />
            )}

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Time Slice</InputLabel>
              <Select
                value={view.time_slice}
                label="Time Slice"
                onChange={(e) => setView(prev => ({ ...prev, time_slice: e.target.value }))}
              >
                <MenuItem value="whole">Whole range</MenuItem>
                <MenuItem value="early">Early period</MenuItem>
                <MenuItem value="late">Late period</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              size="small"
              type="number"
              label="Histogram bins"
              value={view.bins}
              onChange={(e) => setView(prev => ({ ...prev, bins: parseInt(e.target.value || '40', 10) }))}
              sx={{ mb: 2 }}
            />

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>State Snapshots</Typography>
            <TextField
              fullWidth
              size="small"
              label="Name this state"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Button fullWidth variant="contained" sx={{ bgcolor: '#0f172a', mb: 2 }} onClick={saveState} disabled={loading}>
              Save State
            </Button>

            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Saved States</InputLabel>
              <Select
                value={selectedStateId}
                label="Saved States"
                onChange={(e) => setSelectedStateId(e.target.value)}
              >
                {(states || []).map((s) => (
                  <MenuItem key={s.state_id} value={String(s.state_id)}>
                    {`${s.name} • ${s.created_at}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button fullWidth variant="outlined" onClick={loadState} disabled={!selectedStateId || loading}>
              Load State
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Distribution Characterisation</Typography>
                <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                  Evaluates whether the reduced entity signal is structurally meaningful and calibratable.
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={histData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="#64748b"
                      scale={view.scale === 'log' ? 'log' : 'linear'}
                      domain={view.scale === 'log' ? [1, 'auto'] : [0, 'auto']}
                    />
                    <Tooltip
                      labelStyle={{ color: '#1e293b' }}
                      contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(val, _name, props) => {
                        const c = props?.payload?.count;
                        return [c, 'count'];
                      }}
                    />
                    <Bar dataKey={view.scale === 'log' ? 'count_log' : 'count'} fill="#D04A02" />
                  </BarChart>
                </ResponsiveContainer>
                {histogram && (
                  <Typography variant="caption" sx={{ color: '#64748b' }}>
                    Bucket scale: [{Number(minv || 0).toLocaleString()} → {Number(maxv || 0).toLocaleString()}] across {bins} bins
                  </Typography>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Computed Evidence</Typography>
                {!report && (
                  <Typography variant="body2" sx={{ color: '#64748b' }}>
                    Computing…
                  </Typography>
                )}
                {report && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Distribution</Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableBody>
                            <TableRow><TableCell>entities</TableCell><TableCell align="right">{(report.distribution.entities || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>median</TableCell><TableCell align="right">{Number(report.distribution.median || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>p90</TableCell><TableCell align="right">{Number(report.distribution.p90 || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>p95</TableCell><TableCell align="right">{Number(report.distribution.p95 || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>p97</TableCell><TableCell align="right">{Number(report.distribution.p97 || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>p99</TableCell><TableCell align="right">{Number(report.distribution.p99 || 0).toLocaleString()}</TableCell></TableRow>
                            <TableRow><TableCell>top 1% mass</TableCell><TableCell align="right">{Number(report.distribution.tail?.top1_mass_pct || 0).toFixed(2)}%</TableCell></TableRow>
                            <TableRow><TableCell>top 5% mass</TableCell><TableCell align="right">{Number(report.distribution.tail?.top5_mass_pct || 0).toFixed(2)}%</TableCell></TableRow>
                            <TableRow><TableCell>gini</TableCell><TableCell align="right">{report.distribution.gini !== null && report.distribution.gini !== undefined ? Number(report.distribution.gini).toFixed(3) : '—'}</TableCell></TableRow>
                            <TableRow><TableCell>skewness</TableCell><TableCell align="right">{report.distribution.skewness !== null && report.distribution.skewness !== undefined ? Number(report.distribution.skewness).toFixed(3) : '—'}</TableCell></TableRow>
                            <TableRow><TableCell>kurtosis</TableCell><TableCell align="right">{report.distribution.kurtosis !== null && report.distribution.kurtosis !== undefined ? Number(report.distribution.kurtosis).toFixed(3) : '—'}</TableCell></TableRow>
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Tail & Stability</Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableBody>
                            <TableRow><TableCell>tail type</TableCell><TableCell align="right">{report.tail.tail_type}</TableCell></TableRow>
                            <TableRow><TableCell>smoothness score</TableCell><TableCell align="right">{Number(report.tail.smoothness_score || 0).toFixed(3)}</TableCell></TableRow>
                            <TableRow><TableCell>KS vs uniform tail</TableCell><TableCell align="right">{report.tail.ks_uniform_tail !== null && report.tail.ks_uniform_tail !== undefined ? Number(report.tail.ks_uniform_tail).toFixed(3) : '—'}</TableCell></TableRow>
                            <TableRow><TableCell>early vs late KS</TableCell><TableCell align="right">{report.temporal.ks_early_late !== null && report.temporal.ks_early_late !== undefined ? Number(report.temporal.ks_early_late).toFixed(3) : '—'}</TableCell></TableRow>
                            <TableRow><TableCell>median shift</TableCell><TableCell align="right">{report.temporal.median_shift !== null && report.temporal.median_shift !== undefined ? Number(report.temporal.median_shift).toLocaleString() : '—'}</TableCell></TableRow>
                            <TableRow><TableCell>tail shift (p95)</TableCell><TableCell align="right">{report.temporal.tail_shift !== null && report.temporal.tail_shift !== undefined ? Number(report.temporal.tail_shift).toLocaleString() : '—'}</TableCell></TableRow>
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="caption" sx={{ color: '#64748b' }}>
                          Breakpoints: {(report.tail.breakpoints || []).length}
                        </Typography>
                      </Box>
                    </Grid>

                    <Grid item xs={12}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Entity Contribution</Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Segment</TableCell>
                              <TableCell align="right">Entities</TableCell>
                              <TableCell align="right">Contribution</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(report.entity_contribution.segments || []).map((s) => (
                              <TableRow key={s.segment}>
                                <TableCell>{s.segment}</TableCell>
                                <TableCell align="right">{(s.entity_count || 0).toLocaleString()}</TableCell>
                                <TableCell align="right">{Number(s.contribution_pct || 0).toFixed(2)}%</TableCell>
                              </TableRow>
                            ))}
                            {(report.entity_contribution.segments || []).length === 0 && (
                              <TableRow>
                                <TableCell colSpan={3} sx={{ color: '#64748b' }}>No contribution segments computed.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Grid>
                  </Grid>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SignalDistributionView;
