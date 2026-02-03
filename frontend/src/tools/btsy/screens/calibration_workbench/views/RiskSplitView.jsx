import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Chip
} from '@mui/material';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import btsyApi from '../../../services/btsyApi';
import { emitGuideEvent } from '../../../guides/guideEvents';

const RiskSplitView = ({ session, aggregateView, selectedBoundaryId: externalSelectedBoundaryId, onBoundarySelected }) => {
  const sessionId = session?.session_id;

  const [strategies, setStrategies] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [selectedBoundaryId, setSelectedBoundaryId] = useState('');
  const [boundaryDetail, setBoundaryDetail] = useState(null);

  const [strategyId, setStrategyId] = useState('');
  const [bufferType, setBufferType] = useState('hard');
  const [bandPct, setBandPct] = useState(2);

  const [stressRows, setStressRows] = useState([]);
  const [borderlineRows, setBorderlineRows] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [entitySeries, setEntitySeries] = useState([]);

  const [overlapA, setOverlapA] = useState('');
  const [overlapB, setOverlapB] = useState('');
  const [overlapResult, setOverlapResult] = useState(null);

  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canOperate = !!sessionId && (session?.status !== 'frozen');

  const refreshStrategies = async () => {
    if (!sessionId) return;
    const res = await btsyApi.threshold.listStrategies(sessionId);
    if (res.success) setStrategies(res.data || []);
  };

  const refreshBoundaries = async () => {
    if (!sessionId) return;
    const res = await btsyApi.risk.listBoundaries(sessionId);
    if (res.success) setBoundaries(res.data || []);
  };

  const loadBoundary = async (boundaryId) => {
    if (!sessionId || !boundaryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.risk.getBoundary(sessionId, boundaryId);
      if (res.success) {
        setBoundaryDetail(res.data);
        setStressRows(res.data?.stress || []);
      } else {
        setError(res.error || 'Failed to load boundary');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    refreshStrategies();
    refreshBoundaries();
  }, [sessionId]);

  useEffect(() => {
    if (externalSelectedBoundaryId === null || externalSelectedBoundaryId === undefined) return;
    setSelectedBoundaryId(String(externalSelectedBoundaryId));
  }, [externalSelectedBoundaryId]);

  useEffect(() => {
    if (!selectedBoundaryId) return;
    loadBoundary(parseInt(selectedBoundaryId, 10));
  }, [selectedBoundaryId]);

  const createBoundary = async () => {
    if (!sessionId || !strategyId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        strategy_id: parseInt(strategyId, 10),
        buffer_type: bufferType,
        buffer_params: (bufferType === 'hard') ? {} : { band_pct: Number(bandPct) }
      };
      const res = await btsyApi.risk.createBoundary(sessionId, payload, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to create boundary');
        return;
      }
      await refreshBoundaries();
      const newBoundaryId = res.data?.created?.boundary_id;
      if (newBoundaryId) {
        setSelectedBoundaryId(String(newBoundaryId));
        if (onBoundarySelected) onBoundarySelected(newBoundaryId);
        emitGuideEvent('RISK_BOUNDARY_CREATED', { sessionId, boundaryId: newBoundaryId });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const stressBoundary = async () => {
    if (!sessionId || !selectedBoundaryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.risk.stressBoundary(sessionId, parseInt(selectedBoundaryId, 10), [-5, -2, -1, 1, 2, 5], 'user');
      if (res.success) setStressRows(res.data || []);
      else setError(res.error || 'Failed to stress boundary');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBorderline = async () => {
    if (!sessionId || !selectedBoundaryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.risk.borderline(sessionId, parseInt(selectedBoundaryId, 10), 60);
      if (res.success) setBorderlineRows(res.data || []);
      else setError(res.error || 'Failed to load borderline entities');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEntity = async (entityId) => {
    if (!sessionId || !entityId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.calibration.getEntityDrilldown(sessionId, entityId);
      if (!res.success) throw new Error(res.error || 'Failed to load entity');
      setEntitySeries(res.data?.series || []);
    } catch (e) {
      setError(e.message);
      setEntitySeries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedEntityId) return;
    loadEntity(selectedEntityId);
  }, [selectedEntityId]);

  const statsByType = useMemo(() => {
    const rows = boundaryDetail?.stats || [];
    const map = new Map();
    rows.forEach((r) => {
      if (!map.has(r.population_type)) map.set(r.population_type, r);
    });
    return {
      ATL: map.get('ATL') || null,
      REVIEW: map.get('REVIEW') || null,
      BTL: map.get('BTL') || null
    };
  }, [boundaryDetail]);

  const boundaryHeader = useMemo(() => {
    const b = boundaryDetail?.boundary || null;
    if (!b) return null;
    const strategy = strategies.find(s => s.strategy_id === b.strategy_id) || null;
    return { ...b, strategyName: strategy?.name || `Strategy ${b.strategy_id}` };
  }, [boundaryDetail, strategies]);

  const histData = useMemo(() => {
    const histogram = aggregateView?.histogram || null;
    const bins = histogram?.bins || 0;
    const rows = histogram?.rows || [];
    const map = new Map(rows.map(r => [r.bucket, r.count]));
    const filled = [];
    if (!bins) return rows.map(r => ({ bucket: r.bucket, count: r.count }));
    for (let i = 0; i <= bins; i += 1) {
      filled.push({ bucket: i, count: map.get(i) || 0 });
    }
    return filled;
  }, [aggregateView]);

  const cumulativeData = useMemo(() => {
    const total = histData.reduce((acc, r) => acc + (r.count || 0), 0);
    let running = 0;
    return histData.map((r) => {
      running += (r.count || 0);
      const pct = total ? (running / total) * 100.0 : 0.0;
      return { bucket: r.bucket, cumulative_pct: pct };
    });
  }, [histData]);

  const boundaryThresholds = useMemo(() => {
    const t = boundaryDetail?.computed?.threshold || null;
    return t ? { lower: t.lower, upper: t.upper, threshold_value: t.threshold_value } : null;
  }, [boundaryDetail]);

  const boundaryBucketLines = useMemo(() => {
    const histogram = aggregateView?.histogram || null;
    const bins = histogram?.bins || 0;
    const minv = histogram?.min;
    const maxv = histogram?.max;
    if (!bins || minv === undefined || maxv === undefined || !boundaryThresholds || maxv === minv) return null;
    const toBucket = (v) => {
      const b = Math.floor(((v - minv) / (maxv - minv)) * bins);
      return Math.max(0, Math.min(bins, b));
    };
    return {
      lowerBucket: toBucket(boundaryThresholds.lower),
      upperBucket: toBucket(boundaryThresholds.upper),
      thresholdBucket: toBucket(boundaryThresholds.threshold_value)
    };
  }, [aggregateView, boundaryThresholds]);

  const computeOverlap = async () => {
    if (!sessionId || !overlapA || !overlapB) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.risk.overlap(sessionId, parseInt(overlapA, 10), parseInt(overlapB, 10), 'user');
      if (res.success) setOverlapResult(res.data);
      else setError(res.error || 'Failed to compute overlap');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveNote = async () => {
    if (!sessionId || !selectedBoundaryId) return;
    const text = note.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.risk.addBoundaryAnnotation(sessionId, parseInt(selectedBoundaryId, 10), text, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to save note');
        return;
      }
      setNote('');
      await loadBoundary(parseInt(selectedBoundaryId, 10));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!session) return null;

  if (!aggregateView?.summary) {
    return (
      <Alert severity="info">
        Step-3.4 reuses the Step-3.1 reduced entity distribution. Apply an aggregation lens first.
      </Alert>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {session?.status === 'frozen' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Session is frozen. Boundary creation and stress tests are disabled.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Risk Population Delineation & Boundary Stress Lab
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
              ATL/BTL is a derived population boundary. This tab exposes fragility rather than hiding it.
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Threshold Strategy</InputLabel>
              <Select
                value={strategyId}
                label="Threshold Strategy"
                onChange={(e) => setStrategyId(e.target.value)}
                disabled={!canOperate}
              >
                {strategies.map((s) => (
                  <MenuItem key={s.strategy_id} value={String(s.strategy_id)}>
                    {`${s.name} • ${s.strategy_type}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Boundary Type</InputLabel>
              <Select
                value={bufferType}
                label="Boundary Type"
                onChange={(e) => setBufferType(e.target.value)}
                disabled={!canOperate}
              >
                <MenuItem value="hard">Hard cutoff</MenuItem>
                <MenuItem value="buffered">Soft buffer (± band)</MenuItem>
                <MenuItem value="gray">Review zone (gray band)</MenuItem>
              </Select>
            </FormControl>

            {bufferType !== 'hard' && (
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Band (%)"
                value={bandPct}
                onChange={(e) => setBandPct(parseFloat(e.target.value || '0'))}
                disabled={!canOperate}
                sx={{ mb: 1 }}
              />
            )}

            <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={createBoundary} disabled={!canOperate || !strategyId || loading} data-guide-id="wb-create-boundary-button">
              Create Boundary
            </Button>
          </Paper>

          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Saved Boundaries</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>Boundary</InputLabel>
              <Select
                value={selectedBoundaryId}
                label="Boundary"
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedBoundaryId(v);
                  if (onBoundarySelected) onBoundarySelected(v ? parseInt(v, 10) : null);
                }}
              >
                {(boundaries || []).map((b) => (
                  <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>
                    {`B-${String(b.boundary_id).padStart(3, '0')} • Strategy ${b.strategy_id} • ${b.buffer_type}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" sx={{ mt: 1 }} onClick={() => refreshBoundaries()} disabled={loading}>
              Refresh
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          {!selectedBoundaryId && (
            <Alert severity="info">
              Create or select a boundary to analyze ATL/BTL composition and fragility.
            </Alert>
          )}

          {selectedBoundaryId && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Boundary Definition</Typography>
                  {boundaryHeader && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      <Chip label={`Boundary: B-${String(boundaryHeader.boundary_id).padStart(3, '0')}`} />
                      <Chip label={`Strategy: ${boundaryHeader.strategyName}`} />
                      <Chip label={`Type: ${boundaryHeader.buffer_type}`} />
                      {boundaryHeader.buffer_params?.band_pct !== undefined && boundaryHeader.buffer_type !== 'hard' && (
                        <Chip label={`Band: ±${Number(boundaryHeader.buffer_params.band_pct).toFixed(2)}%`} />
                      )}
                      {boundaryHeader.aggregation_lens && <Chip label={`Lens: ${boundaryHeader.aggregation_lens}`} />}
                    </Box>
                  )}
                  {boundaryBucketLines && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Distribution With Boundary Band</Typography>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={histData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                          <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          <ReferenceLine x={boundaryBucketLines.lowerBucket} stroke="#64748b" strokeDasharray="3 3" />
                          <ReferenceLine x={boundaryBucketLines.upperBucket} stroke="#0f172a" strokeDasharray="3 3" />
                          <Bar dataKey="count" fill="#D04A02" />
                        </BarChart>
                      </ResponsiveContainer>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Lower/upper band derived from the selected buffer type.
                      </Typography>
                    </Box>
                  )}
                  {cumulativeData.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Cumulative Population Curve</Typography>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={cumulativeData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" domain={[0, 100]} />
                          <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          {boundaryBucketLines && <ReferenceLine x={boundaryBucketLines.upperBucket} stroke="#0f172a" strokeDasharray="3 3" />}
                          <Line type="monotone" dataKey="cumulative_pct" stroke="#0f172a" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Bucketed approximation from the Step-3.1 collapsed histogram.
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Population Composition</Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Population</TableCell>
                          <TableCell align="right">Entities</TableCell>
                          <TableCell align="right">% Pop</TableCell>
                          <TableCell align="right">Median</TableCell>
                          <TableCell align="right">P95</TableCell>
                          <TableCell align="right">P99</TableCell>
                          <TableCell align="right">Volume %</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {['ATL', 'REVIEW', 'BTL'].map((t) => {
                          const r = statsByType[t];
                          if (!r) return null;
                          return (
                            <TableRow key={t}>
                              <TableCell>{t}</TableCell>
                              <TableCell align="right">{(r.entity_count || 0).toLocaleString()}</TableCell>
                              <TableCell align="right">{`${Number(r.population_pct || 0).toFixed(2)}%`}</TableCell>
                              <TableCell align="right">{r.median !== null && r.median !== undefined ? Number(r.median).toLocaleString() : '—'}</TableCell>
                              <TableCell align="right">{r.p95 !== null && r.p95 !== undefined ? Number(r.p95).toLocaleString() : '—'}</TableCell>
                              <TableCell align="right">{r.p99 !== null && r.p99 !== undefined ? Number(r.p99).toLocaleString() : '—'}</TableCell>
                              <TableCell align="right">{`${Number(r.volume_pct || 0).toFixed(2)}%`}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Boundary Fragility / Stress Test</Typography>
                    <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={stressBoundary} disabled={!canOperate || loading}>
                      Stress Boundary
                    </Button>
                  </Box>
                  <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                    This answers: “If I nudge the boundary slightly, do I get a totally different population?” Large churn means your boundary is fragile.
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell align="right">Δ Threshold %</TableCell>
                          <TableCell align="right">Entity churn %</TableCell>
                          <TableCell align="right">Enter %</TableCell>
                          <TableCell align="right">Leave %</TableCell>
                          <TableCell align="right">Volume churn %</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stressRows.map((r) => (
                          <TableRow key={r.delta_pct}>
                            <TableCell align="right">{`${r.delta_pct > 0 ? '+' : ''}${Number(r.delta_pct).toFixed(1)}%`}</TableCell>
                            <TableCell align="right">{r.entity_churn_pct !== null && r.entity_churn_pct !== undefined ? `${Number(r.entity_churn_pct).toFixed(2)}%` : '—'}</TableCell>
                            <TableCell align="right">{r.enter_pct !== null && r.enter_pct !== undefined ? `${Number(r.enter_pct).toFixed(2)}%` : '—'}</TableCell>
                            <TableCell align="right">{r.leave_pct !== null && r.leave_pct !== undefined ? `${Number(r.leave_pct).toFixed(2)}%` : '—'}</TableCell>
                            <TableCell align="right">{r.volume_churn_pct !== null && r.volume_churn_pct !== undefined ? `${Number(r.volume_churn_pct).toFixed(2)}%` : '—'}</TableCell>
                          </TableRow>
                        ))}
                        {stressRows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} sx={{ color: '#64748b' }}>No stress results yet.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Borderline Entity Analysis</Typography>
                    <Button variant="outlined" onClick={loadBorderline} disabled={loading}>
                      Explain Borderline
                    </Button>
                  </Box>
                  <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                    Borderline entities sit close to the boundary. Review them to understand whether the boundary matches intuitive behaviour over time.
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={5}>
                      <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                        <InputLabel>Entity</InputLabel>
                        <Select value={selectedEntityId} label="Entity" onChange={(e) => setSelectedEntityId(e.target.value)}>
                          {borderlineRows.map((r) => (
                            <MenuItem key={r.entity_id} value={r.entity_id}>
                              {`${r.entity_id} • ${Number(r.aggregated_value || 0).toLocaleString()} • ${r.side}`}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Entity</TableCell>
                              <TableCell align="right">Value</TableCell>
                              <TableCell align="right">Side</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {borderlineRows.slice(0, 12).map((r) => (
                              <TableRow key={r.entity_id} onClick={() => setSelectedEntityId(r.entity_id)} sx={{ cursor: 'pointer' }}>
                                <TableCell>{r.entity_id}</TableCell>
                                <TableCell align="right">{Number(r.aggregated_value || 0).toLocaleString()}</TableCell>
                                <TableCell align="right">{r.side}</TableCell>
                              </TableRow>
                            ))}
                            {borderlineRows.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={3} sx={{ color: '#64748b' }}>No borderline entities loaded.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Grid>
                    <Grid item xs={12} md={7}>
                      {selectedEntityId && entitySeries.length > 0 && (
                        <>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Time Series</Typography>
                          <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={entitySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="as_of_date" hide />
                              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                              <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                              {boundaryThresholds && (
                                <>
                                  <ReferenceLine y={boundaryThresholds.lower} stroke="#64748b" strokeDasharray="3 3" />
                                  <ReferenceLine y={boundaryThresholds.upper} stroke="#0f172a" strokeDasharray="3 3" />
                                </>
                              )}
                              <Line type="monotone" dataKey="metric_value" stroke="#D04A02" dot={false} strokeWidth={2} />
                            </LineChart>
                          </ResponsiveContainer>
                          <Typography variant="caption" sx={{ color: '#64748b' }}>
                            Interpretation uses the current aggregation lens (peak vs sustained etc.).
                          </Typography>
                        </>
                      )}
                      {selectedEntityId && entitySeries.length === 0 && (
                        <Alert severity="info">No time series for this entity.</Alert>
                      )}
                      {!selectedEntityId && (
                        <Alert severity="info">Select a borderline entity to inspect its time series.</Alert>
                      )}
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Cross-Boundary Comparison</Typography>
                  <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                    Compare two boundaries to see whether they select the same population. High overlap means the boundaries are effectively equivalent.
                  </Typography>
                  <Grid container spacing={1} sx={{ mb: 1 }}>
                    <Grid item xs={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Boundary A</InputLabel>
                        <Select value={overlapA} label="Boundary A" onChange={(e) => setOverlapA(e.target.value)}>
                          {boundaries.map((b) => (
                            <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>{`B-${String(b.boundary_id).padStart(3, '0')}`}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Boundary B</InputLabel>
                        <Select value={overlapB} label="Boundary B" onChange={(e) => setOverlapB(e.target.value)}>
                          {boundaries.map((b) => (
                            <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>{`B-${String(b.boundary_id).padStart(3, '0')}`}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                  <Button variant="outlined" onClick={computeOverlap} disabled={loading || !overlapA || !overlapB}>
                    Compute Overlap
                  </Button>
                  <Divider sx={{ my: 1.5 }} />
                  {!overlapResult && (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>No overlap computed.</Typography>
                  )}
                  {overlapResult && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      <Chip label={`Overlap: ${Number(overlapResult.overlap_pct || 0).toFixed(2)}%`} />
                      <Chip label={`Jaccard: ${Number(overlapResult.jaccard || 0).toFixed(3)}`} />
                      <Chip label={`Only A: ${(overlapResult.only_a_count || 0).toLocaleString()}`} />
                      <Chip label={`Only B: ${(overlapResult.only_b_count || 0).toLocaleString()}`} />
                      <Chip label={`Intersection: ${(overlapResult.intersection_count || 0).toLocaleString()}`} />
                      <Chip label={`Volume overlap: ${Number(overlapResult.volume_overlap_pct || 0).toFixed(2)}%`} />
                    </Box>
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Governance & Rationale</Typography>
                  <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                    Capture why this boundary was chosen, known weaknesses, and assumptions.
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    label="Boundary rationale"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    sx={{ mb: 1 }}
                  />
                  <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={saveNote} disabled={loading || !note.trim()}>
                    Save Rationale
                  </Button>
                  <Divider sx={{ my: 1.5 }} />
                  {(boundaryDetail?.annotations || []).length === 0 && (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>No rationale notes yet.</Typography>
                  )}
                  {(boundaryDetail?.annotations || []).length > 0 && (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Created</TableCell>
                            <TableCell>By</TableCell>
                            <TableCell>Text</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {boundaryDetail.annotations.map((a) => (
                            <TableRow key={a.annotation_id}>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.created_at}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.created_by || '—'}</TableCell>
                              <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{a.annotation_text}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Paper>
              </Grid>
            </Grid>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default RiskSplitView;
