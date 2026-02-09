import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Slider,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Alert,
  Checkbox,
  IconButton,
  Divider
} from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import btsyApi from '../../../services/btsyApi';
import { emitGuideEvent } from '../../../guides/guideEvents';

const ThresholdSimulationView = ({ session, aggregateView, onStrategySelected }) => {
  const sessionId = session?.session_id;

  const [percentile, setPercentile] = useState(99);
  const [percentilePreview, setPercentilePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [strategyType, setStrategyType] = useState('percentile');
  const [strategyName, setStrategyName] = useState('');
  const [absoluteValue, setAbsoluteValue] = useState('');
  const [topN, setTopN] = useState(500);
  const [capValue, setCapValue] = useState('');

  const [strategies, setStrategies] = useState([]);
  const [impact, setImpact] = useState([]);
  const [overlapSelection, setOverlapSelection] = useState({});
  const [overlapRows, setOverlapRows] = useState([]);
  const [sensitivityStrategyId, setSensitivityStrategyId] = useState('');
  const [sensitivityDelta, setSensitivityDelta] = useState(1);
  const [sensitivityRows, setSensitivityRows] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);

  const canOperate = !!sessionId && (session?.status !== 'frozen');

  const distributionCurve = useMemo(() => {
    const rows = aggregateView?.histogram?.rows || [];
    const bins = aggregateView?.histogram?.bins || 0;
    const map = new Map(rows.map(r => [r.bucket, r.count]));
    const filled = [];
    if (!bins) return rows.map(r => ({ bucket: r.bucket, count: r.count }));
    for (let i = 0; i <= bins; i += 1) {
      filled.push({ bucket: i, count: map.get(i) || 0 });
    }
    return filled;
  }, [aggregateView]);

  const refreshStrategies = async () => {
    if (!sessionId) return;
    const res = await btsyApi.threshold.listStrategies(sessionId);
    if (res.success) setStrategies(res.data || []);
  };

  const refreshImpact = async () => {
    if (!sessionId) return;
    const res = await btsyApi.threshold.impactMatrix(sessionId);
    if (res.success) setImpact(res.data || []);
  };

  useEffect(() => {
    if (!sessionId) return;
    refreshStrategies();
    refreshImpact();
  }, [sessionId]);

  const computePercentilePreview = async (pct) => {
    if (!sessionId) return;
    setPreviewLoading(true);
    try {
      const res = await btsyApi.threshold.percentilePreview(sessionId, pct);
      if (res.success) setPercentilePreview(res.data);
      else setError(res.error || 'Failed to preview percentile');
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      computePercentilePreview(percentile);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionId, percentile]);

  const onSliderCommit = async (_e, v) => {
    if (!sessionId) return;
    const pct = Array.isArray(v) ? v[0] : v;
    await btsyApi.threshold.logEvent(sessionId, 'percentile_slider_committed', { percentile: pct }, 'user');
  };

  const inferredName = useMemo(() => {
    if (!strategyType) return '';
    if (strategyType === 'percentile') return `P${Number(percentile).toFixed(1)}`;
    if (strategyType === 'absolute') return `ABS_${absoluteValue || 'x'}`;
    if (strategyType === 'top_n') return `TOP_${topN || 'n'}`;
    if (strategyType === 'hybrid') return `HYB_P${Number(percentile).toFixed(1)}_CAP_${capValue || 'x'}`;
    return '';
  }, [strategyType, percentile, absoluteValue, topN, capValue]);

  const createStrategy = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const name = (strategyName || inferredName || `strategy_${Date.now()}`).trim();
      let params = {};
      if (strategyType === 'percentile') params = { percentile: Number(percentile) };
      if (strategyType === 'absolute') params = { threshold_value: Number(absoluteValue) };
      if (strategyType === 'top_n') params = { top_n: Number(topN) };
      if (strategyType === 'hybrid') params = { percentile: Number(percentile), cap_value: Number(capValue) };

      const res = await btsyApi.threshold.createStrategy(sessionId, { name, strategy_type: strategyType, params }, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to create strategy');
        return;
      }
      setStrategyName('');
      await refreshStrategies();
      await refreshImpact();
      emitGuideEvent('THRESHOLD_STRATEGY_SAVED', { sessionId, strategyType, name });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteStrategy = async (strategyId) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.threshold.deleteStrategy(sessionId, strategyId, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to delete strategy');
        return;
      }
      await refreshStrategies();
      await refreshImpact();
      setOverlapRows([]);
      setSensitivityRows([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedOverlapIds = useMemo(() => {
    return Object.entries(overlapSelection).filter(([, v]) => v).map(([k]) => parseInt(k, 10));
  }, [overlapSelection]);

  const computeOverlap = async () => {
    if (!sessionId) return;
    if (selectedOverlapIds.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.threshold.overlap(sessionId, selectedOverlapIds, 'user');
      if (res.success) setOverlapRows(res.data || []);
      else setError(res.error || 'Failed to compute overlap');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const computeSensitivity = async () => {
    if (!sessionId || !sensitivityStrategyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.threshold.sensitivity(sessionId, parseInt(sensitivityStrategyId, 10), Number(sensitivityDelta), 'user');
      if (res.success) setSensitivityRows(res.data || []);
      else setError(res.error || 'Failed to compute sensitivity');
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
        Step-3.3 depends on the Step-3.1 reduced entity distribution. Apply an interpretation lens first.
      </Alert>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Percentile Surface</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              Explore risk boundary placement via percentiles. Slider movements are not saved as strategies unless you persist them.
            </Typography>

            <Box sx={{ mb: 2 }}>
              <Slider
                value={percentile}
                min={90}
                max={99.9}
                step={0.1}
                onChange={(_e, v) => setPercentile(Array.isArray(v) ? v[0] : v)}
                onChangeCommitted={onSliderCommit}
                valueLabelDisplay="auto"
                disabled={!canOperate}
              />
            </Box>

            <Grid container spacing={1} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Percentile</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{Number(percentile).toFixed(1)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Threshold value</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {percentilePreview ? Number(percentilePreview.threshold_value || 0).toLocaleString() : '—'}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Entities above</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {percentilePreview ? (percentilePreview.entity_count || 0).toLocaleString() : '—'}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: '#64748b' }}>% population</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {percentilePreview ? `${Number(percentilePreview.population_pct || 0).toFixed(2)}%` : '—'}
                </Typography>
              </Grid>
            </Grid>

            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={distributionCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="count" stroke="#D04A02" fill="#D04A02" fillOpacity={0.15} />
                {percentilePreview && <ReferenceLine x={Math.floor(((percentilePreview.threshold_value - (aggregateView.histogram?.min || 0)) / Math.max(1e-9, (aggregateView.histogram?.max || 1) - (aggregateView.histogram?.min || 0))) * (aggregateView.histogram?.bins || 40))} stroke="#0f172a" strokeDasharray="3 3" />}
              </AreaChart>
            </ResponsiveContainer>
            {previewLoading && (
              <Typography variant="caption" sx={{ color: '#64748b' }}>
                Computing preview…
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Threshold Strategy Manager</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
              Strategies are first-class objects. Multiple hypotheses can coexist without overwriting.
            </Typography>

            <Grid container spacing={1} sx={{ mb: 1 }}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Strategy name"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder={inferredName}
                  disabled={!canOperate}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={!canOperate}>
                  <InputLabel>Type</InputLabel>
                  <Select value={strategyType} label="Type" onChange={(e) => setStrategyType(e.target.value)}>
                    <MenuItem value="percentile">percentile</MenuItem>
                    <MenuItem value="absolute">absolute</MenuItem>
                    <MenuItem value="top_n">top-N</MenuItem>
                    <MenuItem value="hybrid">hybrid (percentile + cap)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                {strategyType === 'absolute' && (
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Threshold value"
                    value={absoluteValue}
                    onChange={(e) => setAbsoluteValue(e.target.value)}
                    disabled={!canOperate}
                  />
                )}
                {strategyType === 'top_n' && (
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Top N"
                    value={topN}
                    onChange={(e) => setTopN(parseInt(e.target.value || '0', 10))}
                    disabled={!canOperate}
                  />
                )}
                {strategyType === 'hybrid' && (
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Cap value"
                    value={capValue}
                    onChange={(e) => setCapValue(e.target.value)}
                    disabled={!canOperate}
                  />
                )}
                {strategyType === 'percentile' && (
                  <TextField
                    fullWidth
                    size="small"
                    label="Percentile"
                    value={Number(percentile).toFixed(1)}
                    disabled
                  />
                )}
              </Grid>
            </Grid>

            <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={createStrategy} disabled={!canOperate || loading} data-guide-id="wb-save-strategy-button">
              Save Strategy
            </Button>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Saved Strategies</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Threshold</TableCell>
                    <TableCell align="right">Entities</TableCell>
                    <TableCell align="right">% Pop</TableCell>
                    <TableCell align="right"></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {strategies.map((s) => (
                    <TableRow
                      key={s.strategy_id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => {
                        if (onStrategySelected) onStrategySelected(s.strategy_id);
                        if (!sensitivityStrategyId) setSensitivityStrategyId(String(s.strategy_id));
                      }}
                    >
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.strategy_type}</TableCell>
                      <TableCell align="right">{s.threshold_value !== null && s.threshold_value !== undefined ? Number(s.threshold_value).toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">{s.entity_count !== null && s.entity_count !== undefined ? s.entity_count.toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">{s.population_pct !== null && s.population_pct !== undefined ? `${Number(s.population_pct).toFixed(2)}%` : '—'}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteStrategy(s.strategy_id); }} disabled={!canOperate}>
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {strategies.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ color: '#64748b' }}>No strategies yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Impact Matrix</Typography>
              <Button variant="outlined" onClick={refreshImpact} disabled={loading}>Recompute</Button>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Strategy</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Threshold</TableCell>
                    <TableCell align="right">Entities</TableCell>
                    <TableCell align="right">% Pop</TableCell>
                    <TableCell align="right">Triggered Median</TableCell>
                    <TableCell align="right">Triggered P99</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {impact.map((r) => (
                    <TableRow key={r.strategy_id}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.strategy_type}</TableCell>
                      <TableCell align="right">{Number(r.threshold_value || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{(r.entity_count || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{`${Number(r.population_pct || 0).toFixed(2)}%`}</TableCell>
                      <TableCell align="right">{r.triggered_median !== null && r.triggered_median !== undefined ? Number(r.triggered_median).toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">{r.triggered_p99 !== null && r.triggered_p99 !== undefined ? Number(r.triggered_p99).toLocaleString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {impact.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ color: '#64748b' }}>No impact results yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Cross-Strategy Comparison</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
              Compare overlap without listing entities. Shows intersection, exclusive populations, overlap %, and Jaccard similarity.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
              {strategies.map((s) => (
                <Box key={s.strategy_id} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Checkbox
                    size="small"
                    checked={!!overlapSelection[s.strategy_id]}
                    onChange={(e) => setOverlapSelection(prev => ({ ...prev, [s.strategy_id]: e.target.checked }))}
                  />
                  <Typography variant="caption">{s.name}</Typography>
                </Box>
              ))}
            </Box>
            <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={computeOverlap} disabled={loading || selectedOverlapIds.length < 2}>
              Compute Overlap
            </Button>
            <Divider sx={{ my: 1.5 }} />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>A</TableCell>
                    <TableCell>B</TableCell>
                    <TableCell align="right">Intersection</TableCell>
                    <TableCell align="right">Only A</TableCell>
                    <TableCell align="right">Only B</TableCell>
                    <TableCell align="right">Overlap %</TableCell>
                    <TableCell align="right">Jaccard</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {overlapRows.map((r, idx) => (
                    <TableRow key={`${r.strategy_a}-${r.strategy_b}-${idx}`}>
                      <TableCell>{r.name_a}</TableCell>
                      <TableCell>{r.name_b}</TableCell>
                      <TableCell align="right">{(r.intersection_count || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{(r.only_a_count || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{(r.only_b_count || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{`${Number(r.overlap_pct || 0).toFixed(2)}%`}</TableCell>
                      <TableCell align="right">{Number(r.jaccard || 0).toFixed(3)}</TableCell>
                    </TableRow>
                  ))}
                  {overlapRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ color: '#64748b' }}>No overlap computed.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Sensitivity & Stability Probe</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
              Tests brittleness by perturbing the threshold locally. For percentile/hybrid, delta is in percentile points.
            </Typography>
            <Grid container spacing={1} sx={{ mb: 1 }}>
              <Grid item xs={8}>
                <FormControl fullWidth size="small">
                  <InputLabel>Strategy</InputLabel>
                  <Select
                    value={sensitivityStrategyId}
                    label="Strategy"
                    onChange={(e) => {
                      const v = e.target.value;
                      setSensitivityStrategyId(v);
                      if (onStrategySelected && v) onStrategySelected(parseInt(v, 10));
                    }}
                  >
                    {strategies.map((s) => (
                      <MenuItem key={s.strategy_id} value={String(s.strategy_id)}>{s.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={4}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Delta"
                  value={sensitivityDelta}
                  onChange={(e) => setSensitivityDelta(e.target.value)}
                />
              </Grid>
            </Grid>
            <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={computeSensitivity} disabled={loading || !sensitivityStrategyId}>
              Test Sensitivity
            </Button>
            <Divider sx={{ my: 1.5 }} />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell align="right">Delta</TableCell>
                    <TableCell align="right">Entity Δ</TableCell>
                    <TableCell align="right">Pop Δ</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sensitivityRows.map((r, idx) => (
                    <TableRow key={idx}>
                      <TableCell align="right">{r.delta}</TableCell>
                      <TableCell align="right">{r.entity_delta}</TableCell>
                      <TableCell align="right">{`${Number(r.pop_delta || 0).toFixed(2)}%`}</TableCell>
                    </TableRow>
                  ))}
                  {sensitivityRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ color: '#64748b' }}>No sensitivity results.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ThresholdSimulationView;
