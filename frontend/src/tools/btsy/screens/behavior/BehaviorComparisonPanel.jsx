import React, { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography, Grid, FormControl, InputLabel, Select, MenuItem, Alert, Chip, ToggleButtonGroup, ToggleButton, LinearProgress, Tabs, Tab, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TextField, Button } from '@mui/material';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line, Legend } from 'recharts';
import btsyApi from '../../services/btsyApi';
import { getWindowIntent } from './windowIntent';

const BehaviorComparisonPanel = ({ universeId, runs: runsProp = null }) => {
  const [runs, setRuns] = useState([]);
  const [runA, setRunA] = useState(null);
  const [runB, setRunB] = useState(null);
  const [data, setData] = useState(null);
  const [agg, setAgg] = useState('max');
  const [view, setView] = useState('run_compare');
  const [selectedBin, setSelectedBin] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [deltaAgg, setDeltaAgg] = useState('last');
  const [deltaTable, setDeltaTable] = useState(null);
  const [deltaFilters, setDeltaFilters] = useState({ entity_search: '', value_min: '', value_max: '', sort_by: 'delta', sort_dir: 'desc' });
  const [deltaValidation, setDeltaValidation] = useState(null);
  const [deltaValidationError, setDeltaValidationError] = useState('');
  const [deltaValidationLoading, setDeltaValidationLoading] = useState(false);
  const [matrixRunIds, setMatrixRunIds] = useState([]);
  const [matrixAgg, setMatrixAgg] = useState('max');
  const [matrixThreshold, setMatrixThreshold] = useState('');
  const [matrixSortBy, setMatrixSortBy] = useState('volatility');
  const [matrixSortDir, setMatrixSortDir] = useState('desc');
  const [matrixData, setMatrixData] = useState(null);
  const [accountA, setAccountA] = useState('');
  const [accountB, setAccountB] = useState('');
  const [accountRunId, setAccountRunId] = useState('');
  const [accountSeries, setAccountSeries] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [accountDebug, setAccountDebug] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!universeId) return;
      if (runsProp && Array.isArray(runsProp)) {
        setRuns(runsProp);
        return;
      }
      const res = await btsyApi.behavior.listRuns(universeId);
      if (res.success) setRuns(res.data);
    };
    load();
  }, [universeId, runsProp]);

  useEffect(() => {
    const compare = async () => {
      if (!runA || !runB) return;
      const res = await btsyApi.behavior.compareData(runA, runB, agg);
      if (res.success) setData(res.data);
    };
    compare();
  }, [runA, runB, agg]);

  const selectableRuns = runs;
  const sameUniverse = runA && runB && data?.same_universe;
  const sameEntity = runA && runB && data?.same_entity_level;
  const allowed = data?.allowed;
  const runMeta = useMemo(() => new Map((runs || []).map((r) => [String(r.behavior_run_id), r])), [runs]);
  const runALabel = useMemo(() => {
    const r = runMeta.get(String(runA));
    const m = r?.config?.metrics?.[0];
    const w = m?.window || '—';
    const intent = getWindowIntent(w);
    return `${m?.name || 'metric'} • ${w}${intent ? ` • ${intent}` : ''}`;
  }, [runMeta, runA]);
  const runBLabel = useMemo(() => {
    const r = runMeta.get(String(runB));
    const m = r?.config?.metrics?.[0];
    const w = m?.window || '—';
    const intent = getWindowIntent(w);
    return `${m?.name || 'metric'} • ${w}${intent ? ` • ${intent}` : ''}`;
  }, [runMeta, runB]);
  const overlayData = useMemo(() => {
    if (!data?.overlay) return [];
    const mapA = new Map(data.overlay.run_a.map(r => [r.bucket, r.count]));
    const mapB = new Map(data.overlay.run_b.map(r => [r.bucket, r.count]));
    const buckets = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a,b)=>a-b);
    return buckets.map(b => ({
      bucket: b,
      countA: mapA.get(b) || 0,
      countB: mapB.get(b) || 0
    }));
  }, [data]);
  const jaccard = useMemo(() => {
    if (!data?.coverage) return 0;
    const denom = data.coverage.total_a + data.coverage.total_b - data.coverage.both;
    return denom ? (data.coverage.both / denom) * 100 : 0;
  }, [data]);

  const deltaRows = useMemo(() => {
    if (!deltaTable?.rows) return [];
    const ra = String(runA || '');
    const rb = String(runB || '');
    let rows = deltaTable.rows.map((r) => {
      const va = r.values?.[ra]?.metric_value;
      const vb = r.values?.[rb]?.metric_value;
      const delta = (vb ?? 0) - (va ?? 0);
      const asOf = r.values?.[ra]?.as_of_date || r.values?.[rb]?.as_of_date || null;
      return {
        entity_id: r.entity_id,
        as_of_date: asOf,
        value_a: va,
        value_b: vb,
        delta,
      };
    });

    const q = String(deltaFilters.entity_search || '').trim();
    if (q) rows = rows.filter((r) => String(r.entity_id || '').toLowerCase().includes(q.toLowerCase()));
    const vmin = deltaFilters.value_min !== '' ? Number(deltaFilters.value_min) : null;
    const vmax = deltaFilters.value_max !== '' ? Number(deltaFilters.value_max) : null;
    if (vmin != null && !Number.isNaN(vmin)) rows = rows.filter((r) => Number(r.value_b ?? 0) >= vmin);
    if (vmax != null && !Number.isNaN(vmax)) rows = rows.filter((r) => Number(r.value_b ?? 0) <= vmax);

    const dir = deltaFilters.sort_dir === 'asc' ? 1 : -1;
    const key = deltaFilters.sort_by;
    const get = (r) => {
      if (key === 'value_a') return Number(r.value_a ?? 0);
      if (key === 'value_b') return Number(r.value_b ?? 0);
      if (key === 'delta') return Number(r.delta ?? 0);
      return String(r.entity_id || '');
    };
    rows.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'string') return av.localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
    return rows;
  }, [deltaTable, runA, runB, deltaFilters]);

  const matrixRows = useMemo(() => {
    if (!matrixData?.rows || !matrixRunIds || matrixRunIds.length === 0) return [];
    const th = matrixThreshold !== '' ? Number(matrixThreshold) : null;
    let rows = matrixData.rows.map((r) => {
      const row = { entity_id: r.entity_id, values: r.values || {} };
      row.crossed = {};
      const vals = [];
      for (const rid of matrixRunIds) {
        const v = row.values?.[String(rid)]?.metric_value;
        vals.push(Number(v ?? 0));
        row.crossed[String(rid)] = th != null && !Number.isNaN(th) ? Number(v ?? 0) >= th : null;
      }
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const variance = vals.length ? vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length : 0;
      row.volatility = Math.sqrt(variance);
      row.max_value = vals.length ? Math.max(...vals) : 0;
      return row;
    });
    const dir = matrixSortDir === 'asc' ? 1 : -1;
    const key = matrixSortBy;
    rows.sort((a, b) => {
      if (key === 'max_value') return (Number(a.max_value ?? 0) - Number(b.max_value ?? 0)) * dir;
      if (key === 'entity_id') return String(a.entity_id || '').localeCompare(String(b.entity_id || '')) * dir;
      return (Number(a.volatility ?? 0) - Number(b.volatility ?? 0)) * dir;
    });
    return rows;
  }, [matrixData, matrixRunIds, matrixThreshold, matrixSortBy, matrixSortDir]);

  const correlationHigh = useMemo(() => {
    const p = data?.correlation?.pearson;
    const s = data?.correlation?.spearman;
    return typeof p === 'number' && typeof s === 'number' && Math.abs(p) > 0.98 && Math.abs(s) > 0.98;
  }, [data]);

  const deltaDistribution = useMemo(() => {
    if (!data?.points) return [];
    const deltas = data.points.map((p) => (Number(p.x ?? 0) - Number(p.y ?? 0))).filter((v) => Number.isFinite(v));
    if (deltas.length === 0) return [];
    const min = Math.min(...deltas);
    const max = Math.max(...deltas);
    const bins = 20;
    const width = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const d of deltas) {
      const idx = Math.max(0, Math.min(bins - 1, Math.floor((d - min) / width)));
      counts[idx] += 1;
    }
    return counts.map((c, i) => ({
      bucket: i,
      count: c,
    }));
  }, [data]);

  const accountChart = useMemo(() => {
    if (!accountSeries || !accountRunId || !accountA || !accountB) return { timeline: [], hist: [] };
    const runObj = accountSeries?.[String(accountRunId)] || {};
    const aPts = runObj?.[String(accountA)]?.points || [];
    const bPts = runObj?.[String(accountB)]?.points || [];
    const debug = {
      run_id: String(accountRunId),
      a_points: aPts.length,
      b_points: bPts.length,
      a_min_ts: aPts.length ? aPts[0]?.as_of_date : null,
      a_max_ts: aPts.length ? aPts[aPts.length - 1]?.as_of_date : null,
      b_min_ts: bPts.length ? bPts[0]?.as_of_date : null,
      b_max_ts: bPts.length ? bPts[bPts.length - 1]?.as_of_date : null,
    };
    const byTs = new Map();
    for (const p of aPts) {
      if (!p.as_of_date) continue;
      const ts = Date.parse(p.as_of_date);
      if (!Number.isFinite(ts)) continue;
      if (!byTs.has(ts)) byTs.set(ts, { ts, as_of_date: p.as_of_date });
      byTs.get(ts).a = (p.metric_value == null ? null : Number(p.metric_value));
    }
    for (const p of bPts) {
      if (!p.as_of_date) continue;
      const ts = Date.parse(p.as_of_date);
      if (!Number.isFinite(ts)) continue;
      if (!byTs.has(ts)) byTs.set(ts, { ts, as_of_date: p.as_of_date });
      byTs.get(ts).b = (p.metric_value == null ? null : Number(p.metric_value));
    }
    const timeline = Array.from(byTs.values())
      .map((r) => ({
        ...r,
        a: (r.a == null || Number.isNaN(r.a)) ? null : r.a,
        b: (r.b == null || Number.isNaN(r.b)) ? null : r.b,
        delta: ((r.a == null || Number.isNaN(r.a)) ? null : r.a) - ((r.b == null || Number.isNaN(r.b)) ? null : r.b),
      }))
      .sort((x, y) => Number(x.ts) - Number(y.ts));

    const hist = [];
    const values = [
      ...aPts.map((p) => Number(p.metric_value ?? 0)),
      ...bPts.map((p) => Number(p.metric_value ?? 0)),
    ].filter((v) => Number.isFinite(v));
    if (values.length > 0) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const bins = 20;
      const width = (max - min) / bins || 1;
      const countsA = new Array(bins).fill(0);
      const countsB = new Array(bins).fill(0);
      for (const v of aPts.map((p) => Number(p.metric_value ?? 0)).filter((v) => Number.isFinite(v))) {
        const idx = Math.max(0, Math.min(bins - 1, Math.floor((v - min) / width)));
        countsA[idx] += 1;
      }
      for (const v of bPts.map((p) => Number(p.metric_value ?? 0)).filter((v) => Number.isFinite(v))) {
        const idx = Math.max(0, Math.min(bins - 1, Math.floor((v - min) / width)));
        countsB[idx] += 1;
      }
      for (let i = 0; i < bins; i++) {
        hist.push({ bucket: i, countA: countsA[i], countB: countsB[i] });
      }
    }
    return { timeline, hist, debug };
  }, [accountSeries, accountRunId, accountA, accountB]);

  useEffect(() => {
    const loadDelta = async () => {
      if (!runA || !runB) return;
      const res = await btsyApi.behavior.entityValues([runA, runB], deltaAgg, 200, {
        entity_search: deltaFilters.entity_search || null,
        value_min: deltaFilters.value_min !== '' ? deltaFilters.value_min : null,
        value_max: deltaFilters.value_max !== '' ? deltaFilters.value_max : null,
      });
      if (res.success) setDeltaTable(res.data);
    };
    loadDelta();
  }, [runA, runB, deltaAgg]);

  const runComparisonInsight = useMemo(() => {
    const eqPct = deltaValidation?.join_summary?.equal_pct;
    const span = deltaValidation?.universe_time_stats?.median_entity_span_days;
    const medianRows = deltaValidation?.universe_time_stats?.median_entity_rows;
    const midPct = deltaValidation?.universe_time_stats?.midnight_pct;
    if (eqPct == null) return null;
    if (eqPct >= 99.5) {
      return 'Runs are effectively identical across joined rows. This usually indicates either single-day/sparse activity or that both windows produced the same accumulation on this dataset.';
    }
    if (span != null && span < 1) {
      return 'Entity time span is very short. If each account only transacts within a single day, 1D and 14D windows can match.';
    }
    if (midPct != null && midPct > 90) {
      return 'Most timestamps are midnight (date-only). This is not inherently wrong, but it can hide intraday patterns; window differences will come from multi-day activity only.';
    }
    if (medianRows != null && medianRows <= 1) {
      return 'Most entities have <= 1 transaction row. Rolling windows will match because there is nothing to accumulate.';
    }
    return 'Differences should exist if entities have multi-day activity. Use the per-account transaction history to confirm activity across days.';
  }, [deltaValidation]);

  useEffect(() => {
    const loadMatrix = async () => {
      if (!matrixRunIds || matrixRunIds.length === 0) {
        setMatrixData(null);
        return;
      }
      const res = await btsyApi.behavior.entityValues(matrixRunIds, matrixAgg, 50, {});
      if (res.success) setMatrixData(res.data);
    };
    loadMatrix();
  }, [matrixRunIds, matrixAgg]);

  useEffect(() => {
    const loadAccount = async () => {
      setAccountError('');
      setAccountSeries(null);
      setAccountDebug(null);
      if (!accountRunId || !accountA || !accountB) return;
      const res = await btsyApi.behavior.entityTimeline([parseInt(accountRunId, 10)], [accountA, accountB], 2000);
      if (!res.success) {
        setAccountError(res.error || 'Failed to load account comparison');
        return;
      }
      setAccountSeries(res.data?.series || null);
    };
    loadAccount();
  }, [accountRunId, accountA, accountB]);
  
  useEffect(() => {
    if (!accountChart?.debug) return;
    setAccountDebug(accountChart.debug);
  }, [accountChart]);

  return (
    <Box sx={{ mt: 3 }}>
      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Comparison</Typography>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          This comparison is exploratory. It does not represent final alerts.
        </Alert>

        <Tabs value={view} onChange={(_e, v) => setView(v)} sx={{ mb: 2 }}>
          <Tab value="run_compare" label="Run vs Run" />
          <Tab value="delta" label="Behaviour Delta" />
          <Tab value="matrix" label="Window Sensitivity Matrix" />
          <Tab value="account_vs_account" label="Account vs Account" />
        </Tabs>

        {view === 'run_compare' && (
        <>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <FormControl fullWidth size="small">
              <InputLabel>Run A</InputLabel>
              <Select value={runA || ''} label="Run A" onChange={(e) => setRunA(e.target.value)}>
                {selectableRuns.map(r => (
                  <MenuItem key={r.behavior_run_id} value={r.behavior_run_id}>
                    {(r.config?.metrics?.[0]?.name || 'metric')} | {r.entity_level} | {(r.config?.metrics?.[0]?.window || '—')} {getWindowIntent(r.config?.metrics?.[0]?.window) ? `(${getWindowIntent(r.config?.metrics?.[0]?.window)})` : ''} | {new Date(r.started_at).toLocaleString()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2} sx={{ textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#64748b' }}>vs</Typography>
          </Grid>
          <Grid item xs={12} md={5}>
            <FormControl fullWidth size="small">
              <InputLabel>Run B</InputLabel>
              <Select value={runB || ''} label="Run B" onChange={(e) => setRunB(e.target.value)}>
                {selectableRuns.map(r => (
                  <MenuItem key={r.behavior_run_id} value={r.behavior_run_id}>
                    {(r.config?.metrics?.[0]?.name || 'metric')} | {r.entity_level} | {(r.config?.metrics?.[0]?.window || '—')} {getWindowIntent(r.config?.metrics?.[0]?.window) ? `(${getWindowIntent(r.config?.metrics?.[0]?.window)})` : ''} | {new Date(r.started_at).toLocaleString()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <ToggleButtonGroup size="small" value={agg} exclusive onChange={(_, v) => v && setAgg(v)}>
              <ToggleButton value="max">Max</ToggleButton>
              <ToggleButton value="avg">Avg</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>

        <Box sx={{ mt: 2 }}>
          {!allowed && (runA && runB) && (
            <Alert severity="warning">
              Runs must belong to the same universe and entity level to compare.
            </Alert>
          )}
          {allowed && (
            <Box sx={{ color: '#475569', fontSize: '0.9rem', mb: 2 }}>
              Both behaviour runs were computed on the same universe using the same entity level (ACCOUNT).
              This comparison shows whether both configurations capture similar behavioural patterns.
            </Box>
          )}
        </Box>

        {allowed && data && (
          <Grid container spacing={2}>
            {/* Distribution Overlay */}
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Distribution Overlay</Typography>
                <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                  Compares overall spread and tail behaviour between Run A and Run B.
                </Typography>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={overlayData} onClick={(e) => setSelectedBin(e?.activeLabel ?? null)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                    <Tooltip />
                    <Bar dataKey="countA" name="Run A" fill="#0ea5e9" opacity={0.6} />
                    <Bar dataKey="countB" name="Run B" fill="#D04A02" opacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
                {selectedBin !== null && (
                  <Box sx={{ mt: 1, color: '#475569' }}>
                    Selected bucket: {selectedBin} | Run A: {overlayData.find(b => b.bucket === selectedBin)?.countA || 0} | Run B: {overlayData.find(b => b.bucket === selectedBin)?.countB || 0}
                  </Box>
                )}
              </Paper>
            </Grid>

            {/* Coverage Overlap */}
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Entity Coverage Overlap</Typography>
                <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                  Shows how much entity activity overlaps between the two runs.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip label={`Both: ${data.coverage.both}`} color="success" />
                  <Chip label={`Only Run A: ${data.coverage.only_a}`} />
                  <Chip label={`Only Run B: ${data.coverage.only_b}`} />
                  <Chip label={`Overlap rate: ${data.coverage.total_a ? ((data.coverage.both / data.coverage.total_a) * 100).toFixed(1) : 0}% of Run A`} />
                  <Chip label={`Jaccard: ${jaccard.toFixed(1)}%`} />
                </Box>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption">Overlap Density</Typography>
                  <LinearProgress variant="determinate" value={jaccard} />
                </Box>
              </Paper>
            </Grid>

            {/* Correlation Scatter */}
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Correlation Scatter {data.correlation.pearson != null && `(Pearson: ${data.correlation.pearson.toFixed(3)})`} {data.correlation.spearman != null && `(Spearman: ${data.correlation.spearman.toFixed(3)})`}
                </Typography>
                {correlationHigh ? (
                  <>
                    <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                      Both windows rank accounts similarly. Differences arise from accumulation magnitude, not behaviour reordering.
                    </Alert>
                    <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                      Delta distribution (Run B − Run A) shows where accumulation changes magnitude.
                    </Typography>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={deltaDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                        <Tooltip />
                        <Bar dataKey="count" fill="#D04A02" opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <>
                    <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                      Each point is one entity’s aggregated metric from Run A vs Run B.
                    </Typography>
                    <ResponsiveContainer width="100%" height={320}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" dataKey="x" name="Run B" stroke="#64748b" />
                        <YAxis type="number" dataKey="y" name="Run A" stroke="#64748b" />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter data={data.points} fill="#D04A02" onClick={(p) => setSelectedPoint(p)} />
                      </ScatterChart>
                    </ResponsiveContainer>
                    {selectedPoint && (
                      <Box sx={{ mt: 1, color: '#475569' }}>
                        Selected point: Run A {selectedPoint.payload?.y?.toFixed(2)} vs Run B {selectedPoint.payload?.x?.toFixed(2)}
                      </Box>
                    )}
                  </>
                )}
              </Paper>
            </Grid>
          </Grid>
        )}
        </>
        )}

        {view === 'delta' && (
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Delta</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Delta indicates how much additional transactional activity is captured when expanding the lookback window. Large deltas highlight accumulation over time.
            </Typography>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Run A</InputLabel>
                  <Select value={runA || ''} label="Run A" onChange={(e) => setRunA(e.target.value)}>
                    {selectableRuns.map(r => (
                      <MenuItem key={r.behavior_run_id} value={r.behavior_run_id}>
                        {(r.config?.metrics?.[0]?.name || 'metric')} | {(r.config?.metrics?.[0]?.window || '—')} {getWindowIntent(r.config?.metrics?.[0]?.window) ? `(${getWindowIntent(r.config?.metrics?.[0]?.window)})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Run B</InputLabel>
                  <Select value={runB || ''} label="Run B" onChange={(e) => setRunB(e.target.value)}>
                    {selectableRuns.map(r => (
                      <MenuItem key={r.behavior_run_id} value={r.behavior_run_id}>
                        {(r.config?.metrics?.[0]?.name || 'metric')} | {(r.config?.metrics?.[0]?.window || '—')} {getWindowIntent(r.config?.metrics?.[0]?.window) ? `(${getWindowIntent(r.config?.metrics?.[0]?.window)})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>As-of aggregation</InputLabel>
                  <Select value={deltaAgg} label="As-of aggregation" onChange={(e) => setDeltaAgg(e.target.value)}>
                    <MenuItem value="last">Last</MenuItem>
                    <MenuItem value="max">Max</MenuItem>
                    <MenuItem value="avg">Avg</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField size="small" label="Search Account" value={deltaFilters.entity_search} onChange={(e) => setDeltaFilters((p) => ({ ...p, entity_search: e.target.value }))} fullWidth />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField size="small" label="Min Value (Run B)" value={deltaFilters.value_min} onChange={(e) => setDeltaFilters((p) => ({ ...p, value_min: e.target.value }))} fullWidth />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField size="small" label="Max Value (Run B)" value={deltaFilters.value_max} onChange={(e) => setDeltaFilters((p) => ({ ...p, value_max: e.target.value }))} fullWidth />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Sort</InputLabel>
                  <Select value={deltaFilters.sort_by} label="Sort" onChange={(e) => setDeltaFilters((p) => ({ ...p, sort_by: e.target.value }))}>
                    <MenuItem value="value_b">Highest behaviour value</MenuItem>
                    <MenuItem value="delta">Highest delta</MenuItem>
                    <MenuItem value="value_a">Run A value</MenuItem>
                    <MenuItem value="entity_id">Account</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Order</InputLabel>
                  <Select value={deltaFilters.sort_dir} label="Order" onChange={(e) => setDeltaFilters((p) => ({ ...p, sort_dir: e.target.value }))}>
                    <MenuItem value="desc">Desc</MenuItem>
                    <MenuItem value="asc">Asc</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip size="small" variant="outlined" label={`Run A: ${runA ? runALabel : '—'}`} />
                  <Chip size="small" variant="outlined" label={`Run B: ${runB ? runBLabel : '—'}`} />
                  <Box sx={{ flex: 1 }} />
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{ textTransform: 'none' }}
                    disabled={!runA || !runB || deltaValidationLoading}
                    onClick={async () => {
                      setDeltaValidationError('');
                      setDeltaValidationLoading(true);
                      try {
                        const res = await btsyApi.behavior.validateRuns(runA, runB);
                        if (!res.success) throw new Error(res.error || 'Validation failed');
                        setDeltaValidation(res.data);
                      } catch (e) {
                        setDeltaValidationError(e.message);
                        setDeltaValidation(null);
                      } finally {
                        setDeltaValidationLoading(false);
                      }
                    }}
                  >
                    Validate computation
                  </Button>
                </Box>
              </Grid>
            </Grid>

            {deltaValidationLoading && <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>Validating…</Alert>}
            {deltaValidationError && <Alert severity="error" sx={{ mb: 2 }}>{deltaValidationError}</Alert>}
            {deltaValidation && (
              <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Why might Delta be 0?</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                  <Chip size="small" variant="outlined" label={`Equal rows: ${Number(deltaValidation.join_summary?.equal_pct ?? 0).toFixed(2)}%`} />
                  {deltaValidation.universe_time_stats?.distinct_days != null && (
                    <Chip size="small" variant="outlined" label={`Universe days: ${deltaValidation.universe_time_stats.distinct_days}`} />
                  )}
                  {deltaValidation.universe_time_stats?.median_entity_span_days != null && (
                    <Chip size="small" variant="outlined" label={`Median span (days): ${Number(deltaValidation.universe_time_stats.median_entity_span_days).toFixed(1)}`} />
                  )}
                  {deltaValidation.universe_time_stats?.median_entity_rows != null && (
                    <Chip size="small" variant="outlined" label={`Median rows/entity: ${Number(deltaValidation.universe_time_stats.median_entity_rows).toFixed(1)}`} />
                  )}
                  {deltaValidation.universe_time_stats?.midnight_pct != null && (
                    <Chip size="small" variant="outlined" label={`Midnight %: ${Number(deltaValidation.universe_time_stats.midnight_pct).toFixed(1)}%`} />
                  )}
                </Box>
                {runComparisonInsight && (
                  <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
                    {runComparisonInsight}
                  </Alert>
                )}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Check Top Deltas below. If they are all 0 and entity spans are short, it is likely data sparsity rather than a rolling-window bug.
                </Typography>
              </Paper>
            )}

            {(!runA || !runB) && <Alert severity="info">Select two behaviour runs to compute deltas.</Alert>}
            {(runA && runB) && (
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell>As of Date</TableCell>
                      <TableCell align="right">{runALabel}</TableCell>
                      <TableCell align="right">{runBLabel}</TableCell>
                      <TableCell align="right">Delta (Run B − Run A)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deltaRows.map((r) => (
                      <TableRow key={String(r.entity_id)} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.entity_id}</TableCell>
                        <TableCell>{r.as_of_date || '—'}</TableCell>
                        <TableCell align="right">{Number(r.value_a ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell align="right">{Number(r.value_b ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {Number(r.delta ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                    {deltaRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>No rows match the filters.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        )}

        {view === 'matrix' && (
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Window Sensitivity Matrix</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              This matrix shows how behavioural sensitivity changes as the lookback window increases. It does not represent final alerts.
            </Typography>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Windows (runs)</InputLabel>
                  <Select
                    multiple
                    value={matrixRunIds}
                    label="Windows (runs)"
                    onChange={(e) => setMatrixRunIds(e.target.value)}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {selected.map((rid) => {
                          const r = runMeta.get(String(rid));
                          const m = r?.config?.metrics?.[0];
                          const w = m?.window || '—';
                          return <Chip key={String(rid)} size="small" label={`${m?.name || 'metric'} • ${w}`} />;
                        })}
                      </Box>
                    )}
                  >
                    {selectableRuns.map((r) => (
                      <MenuItem key={r.behavior_run_id} value={r.behavior_run_id}>
                        {(r.config?.metrics?.[0]?.name || 'metric')} • {(r.config?.metrics?.[0]?.window || '—')} {getWindowIntent(r.config?.metrics?.[0]?.window) ? `• ${getWindowIntent(r.config?.metrics?.[0]?.window)}` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Aggregation</InputLabel>
                  <Select value={matrixAgg} label="Aggregation" onChange={(e) => setMatrixAgg(e.target.value)}>
                    <MenuItem value="max">Max</MenuItem>
                    <MenuItem value="avg">Avg</MenuItem>
                    <MenuItem value="last">Last</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField size="small" label="Threshold (conceptual)" value={matrixThreshold} onChange={(e) => setMatrixThreshold(e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Sort</InputLabel>
                  <Select value={matrixSortBy} label="Sort" onChange={(e) => setMatrixSortBy(e.target.value)}>
                    <MenuItem value="volatility">Most volatile behaviour</MenuItem>
                    <MenuItem value="max_value">Highest behaviour value</MenuItem>
                    <MenuItem value="entity_id">Account</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Order</InputLabel>
                  <Select value={matrixSortDir} label="Order" onChange={(e) => setMatrixSortDir(e.target.value)}>
                    <MenuItem value="desc">Desc</MenuItem>
                    <MenuItem value="asc">Asc</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {(!matrixRunIds || matrixRunIds.length === 0) && <Alert severity="info">Select multiple windows to view sensitivity.</Alert>}
            {(matrixRunIds && matrixRunIds.length > 0) && (
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      {matrixRunIds.map((rid) => {
                        const r = runMeta.get(String(rid));
                        const w = r?.config?.metrics?.[0]?.window || '—';
                        return (
                          <TableCell key={String(rid)} align="center">
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                              <Box component="span">{`Value @${w}`}</Box>
                              <Box component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>
                                {matrixThreshold !== '' ? `Crossed @${w}` : 'Set threshold to show ✅/❌'}
                              </Box>
                            </Box>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {matrixRows.map((r) => (
                      <TableRow key={String(r.entity_id)} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.entity_id}</TableCell>
                        {matrixRunIds.map((rid) => {
                          const crossed = r.crossed?.[String(rid)];
                          const value = r.values?.[String(rid)]?.metric_value;
                          return (
                            <TableCell key={`${r.entity_id}-${rid}`} align="center">
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                                  {value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </Box>
                                {matrixThreshold !== '' && (
                                  <Box component="span">
                                    {crossed == null ? '—' : (crossed ? '✅' : '❌')}
                                  </Box>
                                )}
                              </Box>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                    {matrixRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={1 + matrixRunIds.length} sx={{ color: 'text.secondary' }}>
                          No data available for selected windows.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        )}

        {view === 'account_vs_account' && (
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Account vs Account Behaviour Comparison</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Compare two accounts under the same behaviour and rolling window. This is exploration only.
            </Typography>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Window (run)</InputLabel>
                  <Select value={accountRunId} label="Window (run)" onChange={(e) => setAccountRunId(e.target.value)}>
                    {selectableRuns.map((r) => {
                      const m = r.config?.metrics?.[0];
                      const w = m?.window || '—';
                      return (
                        <MenuItem key={r.behavior_run_id} value={String(r.behavior_run_id)}>
                          {(m?.name || 'metric')} • {w} {getWindowIntent(w) ? `• ${getWindowIntent(w)}` : ''}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField size="small" label="Account A" value={accountA} onChange={(e) => setAccountA(e.target.value.trim())} fullWidth />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField size="small" label="Account B" value={accountB} onChange={(e) => setAccountB(e.target.value.trim())} fullWidth />
              </Grid>
            </Grid>

            {accountError && <Alert severity="error" sx={{ mb: 2 }}>{accountError}</Alert>}
            {(!accountRunId || !accountA || !accountB) && <Alert severity="info">Select a window and enter two accounts to compare.</Alert>}

            {(accountChart.timeline.length > 0) && (
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Timeline</Typography>
                  {accountDebug && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                      <Chip size="small" variant="outlined" label={`A points: ${accountDebug.a_points}`} />
                      <Chip size="small" variant="outlined" label={`B points: ${accountDebug.b_points}`} />
                    </Box>
                  )}
                  <Box sx={{ width: '100%', height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={accountChart.timeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="ts"
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          tick={{ fontSize: 11 }}
                          stroke="#64748b"
                          tickFormatter={(v) => new Date(v).toLocaleDateString()}
                        />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => Number(v || 0).toLocaleString()} />
                        <Tooltip
                          labelFormatter={(v) => new Date(v).toLocaleString()}
                          formatter={(v) => [Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }), 'Value']}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="a" stroke="#0ea5e9" dot={false} name={`Account A (${accountA})`} />
                        <Line type="monotone" dataKey="b" stroke="#D04A02" dot={false} name={`Account B (${accountB})`} />
                        <Line type="monotone" dataKey="delta" stroke="#10b981" dot={false} name="Delta (A − B)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Distribution</Typography>
                  <Box sx={{ width: '100%', height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={accountChart.hist}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                        <Tooltip />
                        <Bar dataKey="countA" name="Account A" fill="#0ea5e9" opacity={0.6} />
                        <Bar dataKey="countB" name="Account B" fill="#D04A02" opacity={0.6} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
              </Grid>
            )}
          </Paper>
        )}
      </Paper>
    </Box>
  );
};

export default BehaviorComparisonPanel;
