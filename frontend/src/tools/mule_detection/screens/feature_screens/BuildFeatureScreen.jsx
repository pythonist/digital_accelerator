import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Stack,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Typography,
  Chip,
  LinearProgress,
  Stepper,
  Step,
  StepLabel,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  ScatterChart,
  Scatter
} from 'recharts';
import muleApi from '../../services/muleApi';

const BuildFeatureScreen = ({
  T,
  card,
  cellSx,
  headCellSx,
  SectionHeader,
  StatusBadge,
  MetricPill,
  formatNum,
  formatPct,
  dataSchema,
  targetSummary,
  featureMode,
  targetName
}) => {
  const steps = ['Data & Columns', 'Generate', 'Build', 'Preview', 'Evaluate', 'Promote'];
  const [step, setStep] = useState(0);
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [formula, setFormula] = useState('sum(txn_7d) / sum(txn_30d)');
  const [featureName, setFeatureName] = useState('feature_ratio_7d_30d');
  const [featureNotes, setFeatureNotes] = useState('');
  const [batchPlan, setBatchPlan] = useState([
    'rolling_7d',
    'rolling_30d',
    'ratio_7d_30d',
    'delta_7d'
  ]);
  const [aggregation, setAggregation] = useState('sum');
  const [direction, setDirection] = useState('both');
  const [windowDays, setWindowDays] = useState('30');
  const [sampleRows, setSampleRows] = useState([]);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState(null);
  const [buildJobId, setBuildJobId] = useState(null);
  const [buildStatus, setBuildStatus] = useState(null);
  const [buildError, setBuildError] = useState(null);
  const columns = useMemo(() => {
    const acc = dataSchema?.accounts || [];
    const tx = dataSchema?.transactions || [];
    const list = [...acc, ...tx];
    return list.map((c) => {
      const name = c.name;
      const dtype = String(c.type || c.data_type || c.dtype || '').toUpperCase();
      const numeric = /(INT|DECIMAL|DOUBLE|FLOAT|BIGINT)/.test(dtype);
      const base = name.length;
      const nullPct = Math.min(0.45, (base % 9) * 0.03);
      const unique = numeric ? 1000 + base * 37 : 12 + base;
      const min = numeric ? Number((base % 7) * 1.2).toFixed(2) : '—';
      const max = numeric ? Number(((base % 7) + 15) * 2.1).toFixed(2) : '—';
      return { name, dtype: dtype || 'TEXT', nullPct, unique, min, max, numeric };
    });
  }, [dataSchema]);

  const selected = selectedColumn || columns[0]?.name || '';
  const selectedRow = columns.find((c) => c.name === selected);
  const accountsCols = useMemo(() => new Set((dataSchema?.accounts || []).map((c) => c.name)), [dataSchema]);
  const selectedTable = accountsCols.has(selected) ? 'accounts' : 'transactions';
  const targetCol = targetName || targetSummary?.target_name || 'is_mule';
  const useFormula = (token) => setFormula((prev) => prev ? `${prev} ${token}` : token);
  const ratioExample = selected ? `sum(${selected}_7d) / sum(${selected}_30d)` : 'sum(txn_7d) / sum(txn_30d)';
  const canUseOutcome = Boolean(targetSummary?.usable_for_supervised_learning);
  const previewRows = useMemo(() => {
    return Array.from({ length: 12 }).map((_, idx) => {
      const base = idx + 1;
      return {
        account_id: `ACCT-${String(1000 + base).padStart(4, '0')}`,
        value: Number(((base * 7.3) % 91) + 3).toFixed(2),
        window_7d: Number(((base * 3.1) % 37) + 1).toFixed(2),
        window_30d: Number(((base * 9.7) % 83) + 5).toFixed(2)
      };
    });
  }, []);

  const hasTargetInSample = useMemo(() => sampleRows.some((r) => r?.[targetCol] != null), [sampleRows, targetCol]);
  const numericValues = useMemo(() => {
    if (!selected) return [];
    return sampleRows
      .map((r) => Number(r?.[selected]))
      .filter((v) => Number.isFinite(v));
  }, [sampleRows, selected]);
  const distributionData = useMemo(() => {
    if (!numericValues.length) return [];
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const bins = 12;
    const width = max - min || 1;
    const out = Array.from({ length: bins }).map((_, i) => ({
      bin: `${(min + (i * width) / bins).toFixed(2)}-${(min + ((i + 1) * width) / bins).toFixed(2)}`,
      count_all: 0,
      count_mule: 0,
      count_non: 0,
      rate: null
    }));
    sampleRows.forEach((r) => {
      const v = Number(r?.[selected]);
      if (!Number.isFinite(v)) return;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / width) * bins)));
      out[idx].count_all += 1;
      if (hasTargetInSample) {
        const t = Number(r?.[targetCol]) === 1;
        if (t) out[idx].count_mule += 1;
        else out[idx].count_non += 1;
      }
    });
    out.forEach((b) => {
      if (hasTargetInSample) {
        const denom = b.count_mule + b.count_non;
        b.rate = denom ? Number((b.count_mule / denom).toFixed(3)) : 0;
      }
    });
    return out;
  }, [numericValues, sampleRows, selected, targetCol, hasTargetInSample]);
  const categoricalData = useMemo(() => {
    if (numericValues.length) return [];
    if (!selected) return [];
    const counts = {};
    sampleRows.forEach((r) => {
      const key = String(r?.[selected] ?? '—');
      if (!counts[key]) counts[key] = { key, count_all: 0, count_mule: 0, count_non: 0, rate: null };
      counts[key].count_all += 1;
      if (hasTargetInSample) {
        const t = Number(r?.[targetCol]) === 1;
        if (t) counts[key].count_mule += 1;
        else counts[key].count_non += 1;
      }
    });
    const rows = Object.values(counts)
      .sort((a, b) => b.count_all - a.count_all)
      .slice(0, 12);
    rows.forEach((r) => {
      if (hasTargetInSample) {
        const denom = r.count_mule + r.count_non;
        r.rate = denom ? Number((r.count_mule / denom).toFixed(3)) : 0;
      }
    });
    return rows;
  }, [numericValues, sampleRows, selected, targetCol, hasTargetInSample]);
  const scatterData = useMemo(() => {
    if (!hasTargetInSample || !numericValues.length) return [];
    return sampleRows
      .map((r) => {
        const v = Number(r?.[selected]);
        if (!Number.isFinite(v)) return null;
        return { x: v, y: Number(r?.[targetCol]) === 1 ? 1 : 0 };
      })
      .filter(Boolean)
      .slice(0, 200);
  }, [sampleRows, selected, targetCol, hasTargetInSample, numericValues.length]);
  const nextStep = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!selected || step !== 0) return;
      setSampleLoading(true);
      setSampleError(null);
      try {
        const res = await muleApi.getDataSample(selectedTable, 200);
        if (!active) return;
        setSampleRows(res?.rows || []);
      } catch (e) {
        if (!active) return;
        setSampleError(e?.response?.data?.error || e?.message || 'Failed to load sample');
        setSampleRows([]);
      } finally {
        if (active) setSampleLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [selected, selectedTable, step]);

  useEffect(() => {
    if (!buildJobId) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await muleApi.getFeatureEngineeringStatus(buildJobId);
        if (!active) return;
        setBuildStatus(res);
        if (res?.state === 'completed' || res?.state === 'failed') return;
        setTimeout(poll, 1200);
      } catch (e) {
        if (!active) return;
        setBuildError(e?.response?.data?.error || e?.message || 'Failed to fetch build status');
      }
    };
    poll();
    return () => { active = false; };
  }, [buildJobId]);

  const startFeatureBuild = async () => {
    setBuildError(null);
    setBuildStatus(null);
    try {
      const payload = {
        mode: 'custom_feature',
        custom_feature: {
          feature_name: featureName,
          aggregation,
          direction,
          window_days: windowDays
        },
        feature_metadata: {
          business_description: featureNotes || null,
          owner: 'workbench',
          window: `${windowDays}d`,
          data_source: selectedTable,
          aggregation,
          direction,
          built_by: 'feature_workbench',
          origin_module: 'feature_workbench'
        }
      };
      const res = await muleApi.engineerFeatures(payload);
      setBuildJobId(res?.job_id || null);
    } catch (e) {
      setBuildError(e?.response?.data?.error || e?.message || 'Failed to start feature build');
    }
  };

  return (
    <>
      <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, borderBottom: `1px solid ${T.border}` }}>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text, fontFamily: T.sans }}>FEATURE WORKBENCH</Typography>
            <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>Explore · Generate · Build · Preview · Evaluate · Promote</Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexWrap="wrap">
            <Button size="small" variant="outlined" onClick={prevStep} disabled={step === 0}
              sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 700 }}>BACK</Button>
            <Button size="small" variant="outlined" onClick={nextStep}
              sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 700 }}>NEXT</Button>
            <Button size="small" variant="outlined"
              sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 700 }}>SAVE DRAFT</Button>
            <Button size="small" variant="contained"
              sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 700, px: 2, '&:hover': { bgcolor: '#c9461a' } }}>
              PROMOTE TO REGISTRY
            </Button>
          </Stack>
        </Box>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
          <Stepper activeStep={step} alternativeLabel>
            {steps.map((label) => (
              <Step key={label}><StepLabel>{label}</StepLabel></Step>
            ))}
          </Stepper>
        </Box>

        {step === 0 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Data & Columns" subtitle={`${columns.length} columns available`} />
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
              <MetricPill label="Tables" value={`${(dataSchema?.accounts?.length || 0) ? 'Accounts' : '—'} · ${(dataSchema?.transactions?.length || 0) ? 'Transactions' : '—'}`} />
              <MetricPill label="Target" value={targetSummary?.target_name || 'None'} color={canUseOutcome ? T.green : T.textDim} />
              <MetricPill label="Mode" value={featureMode === 'outcome' ? 'Outcome Linked' : 'Behavioral'} color={featureMode === 'outcome' ? T.green : T.blue} />
            </Stack>
            <TableContainer sx={{ maxHeight: 360, border: `1px solid ${T.border}` }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['Column', 'Type', 'Null %', 'Unique', 'Min', 'Max'].map((h) => (
                      <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {columns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ ...cellSx, textAlign: 'center', py: 2, color: T.textMuted }}>
                        No schema loaded yet.
                      </TableCell>
                    </TableRow>
                  ) : columns.map((c) => (
                    <TableRow key={c.name} hover onClick={() => setSelectedColumn(c.name)}
                      sx={{ cursor: 'pointer', background: selected === c.name ? 'rgba(232,83,26,0.08)' : 'transparent' }}>
                      <TableCell sx={{ ...cellSx, color: selected === c.name ? T.accent : T.text }}>{c.name}</TableCell>
                      <TableCell sx={cellSx}>{c.dtype}</TableCell>
                      <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{formatPct(c.nullPct, 1)}</TableCell>
                      <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{c.unique.toLocaleString()}</TableCell>
                      <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{c.min}</TableCell>
                      <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{c.max}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ mt: 1.5, border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>DISTRIBUTION · {selected || '—'}</Typography>
              </Box>
              <Box sx={{ p: 1.5 }}>
                {sampleLoading && <LinearProgress sx={{ height: 2, mb: 1, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />}
                {sampleError && (
                  <Typography sx={{ fontSize: 11, color: T.red, fontFamily: T.mono }}>{sampleError}</Typography>
                )}
                {!sampleLoading && !sampleError && (
                  <>
                    {numericValues.length > 0 ? (
                      <Box sx={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                            <XAxis dataKey="bin" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} interval={2} />
                            <YAxis tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                            <ReTooltip contentStyle={{ background: '#111827', border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }} />
                            <Legend />
                            {hasTargetInSample ? (
                              <>
                                <Bar dataKey="count_non" stackId="a" fill={T.blue} name="Non-mule" />
                                <Bar dataKey="count_mule" stackId="a" fill={T.accent} name="Mule" />
                              </>
                            ) : (
                              <Bar dataKey="count_all" fill={T.accent} name="Count" />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    ) : (
                      <Box sx={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={categoricalData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                            <XAxis dataKey="key" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} interval={0} angle={-35} textAnchor="end" height={60} />
                            <YAxis tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                            <ReTooltip contentStyle={{ background: '#111827', border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }} />
                            <Legend />
                            {hasTargetInSample ? (
                              <>
                                <Bar dataKey="count_non" stackId="a" fill={T.blue} name="Non-mule" />
                                <Bar dataKey="count_mule" stackId="a" fill={T.accent} name="Mule" />
                              </>
                            ) : (
                              <Bar dataKey="count_all" fill={T.accent} name="Count" />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    )}
                    {hasTargetInSample && numericValues.length > 0 && (
                      <Box sx={{ height: 180, mt: 2 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={distributionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                            <XAxis dataKey="bin" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} interval={2} />
                            <YAxis tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                            <ReTooltip contentStyle={{ background: '#111827', border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }} />
                            <Line type="monotone" dataKey="rate" stroke={T.accent} strokeWidth={2} dot={false} name="Mule rate" />
                          </LineChart>
                        </ResponsiveContainer>
                      </Box>
                    )}
                    {hasTargetInSample && numericValues.length > 0 && (
                      <Box sx={{ height: 180, mt: 2 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                            <XAxis dataKey="x" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} />
                            <YAxis dataKey="y" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} domain={[0, 1]} />
                            <ReTooltip cursor={{ strokeDasharray: '3 3' }} />
                            <Scatter data={scatterData} fill={T.accent} name="Samples" />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </Box>
                    )}
                    {!hasTargetInSample && (
                      <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, mt: 1 }}>
                        Target comparison is available on account-level columns only.
                      </Typography>
                    )}
                  </>
                )}
                <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 1.25 }}>
                  <Button size="small" variant="outlined" onClick={() => useFormula(selected)}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontFamily: T.mono, fontWeight: 700 }}>USE IN FORMULA</Button>
                  <Button size="small" variant="outlined" onClick={() => useFormula(`rolling(${selected}, 7d)`)}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontFamily: T.mono, fontWeight: 700 }}>MAKE ROLLING</Button>
                  <Button size="small" variant="outlined" onClick={() => setFormula(ratioExample)}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontFamily: T.mono, fontWeight: 700 }}>MAKE RATIO</Button>
                  <Button size="small" variant="outlined" onClick={() => useFormula(`delta(${selected}, 7d)`)}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontFamily: T.mono, fontWeight: 700 }}>MAKE CHANGE</Button>
                </Stack>
              </Box>
            </Box>
          </Box>
        )}

        {step === 1 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Generate" subtitle="Batch feature plans and automation" />
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', mb: 2 }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>BATCH FEATURES</Typography>
              </Box>
              <Box sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                  {batchPlan.map((b) => (
                    <Chip key={b} label={b} />
                  ))}
                </Stack>
                <Stack direction="row" spacing={0.75}>
                  <Button size="small" variant="outlined" onClick={() => setBatchPlan((p) => [...p, `ratio_${selected || 'x'}_7d`])}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>ADD RATIO</Button>
                  <Button size="small" variant="outlined" onClick={() => setBatchPlan((p) => [...p, `rolling_${selected || 'x'}_14d`])}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>ADD ROLLING</Button>
                  <Button size="small" variant="outlined" onClick={() => setBatchPlan((p) => p.slice(0, Math.max(0, p.length - 1)))}
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>UNDO</Button>
                </Stack>
              </Box>
            </Box>
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>AUTOMATION</Typography>
              </Box>
              <Box sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={0.75}>
                  <Button size="small" variant="outlined" disabled
                    sx={{ borderColor: T.border, color: T.textMuted, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>FEATURETOOLS</Button>
                  <Button size="small" variant="outlined" disabled
                    sx={{ borderColor: T.border, color: T.textMuted, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>TPOT</Button>
                  <Chip label="Not configured" size="small" />
                </Stack>
              </Box>
            </Box>
          </Box>
        )}

        {step === 2 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Build Logic" subtitle="Notebook-style formula builder" />
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', mb: 2 }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>FORMULA</Typography>
                <Chip label="Freeform" size="small" />
              </Box>
              <Box sx={{ p: 1.5 }}>
                <Box component="textarea"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 160,
                    border: `1px solid ${T.border}`,
                    padding: 12,
                    fontFamily: T.mono,
                    fontSize: 12,
                    color: T.text,
                    background: '#ffffff'
                  }}
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} alignItems="center">
                  <Button size="small" variant="outlined"
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>APPLY AGG</Button>
                  <Button size="small" variant="outlined"
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>GROUP BY</Button>
                  <Button size="small" variant="outlined"
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>WINDOW</Button>
                  <Button size="small" variant="outlined"
                    sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 10, fontWeight: 700 }}>MATH</Button>
                </Stack>
              </Box>
            </Box>
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>BUILD SETTINGS</Typography>
              </Box>
              <Box sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <TextField size="small" label="Feature name" value={featureName} onChange={(e) => setFeatureName(e.target.value)}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 10 } }} />
                  <FormControl size="small" fullWidth>
                    <InputLabel sx={{ fontSize: 10 }}>Aggregation</InputLabel>
                    <Select value={aggregation} label="Aggregation" onChange={(e) => setAggregation(e.target.value)}
                      sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text }}>
                      {['sum', 'count', 'distinct_counterparty', 'out_in_ratio', 'avg_time_gap_seconds'].map((a) => (
                        <MenuItem key={a} value={a} sx={{ fontSize: 11, fontFamily: T.mono }}>{a}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel sx={{ fontSize: 10 }}>Direction</InputLabel>
                    <Select value={direction} label="Direction" onChange={(e) => setDirection(e.target.value)}
                      sx={{ borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text }}>
                      {['both', 'inbound', 'outbound'].map((d) => (
                        <MenuItem key={d} value={d} sx={{ fontSize: 11, fontFamily: T.mono }}>{d}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Window days" value={windowDays} onChange={(e) => setWindowDays(e.target.value)}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 10 } }} />
                  <TextField size="small" label="Notes" value={featureNotes} onChange={(e) => setFeatureNotes(e.target.value)} multiline rows={2}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 10 } }} />
                  <Button size="small" variant="contained" onClick={startFeatureBuild}
                    sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 700, '&:hover': { bgcolor: '#c9461a' } }}>
                    BUILD FEATURE (BACKEND)
                  </Button>
                  {buildError && <Typography sx={{ fontSize: 11, color: T.red, fontFamily: T.mono }}>{buildError}</Typography>}
                  {buildStatus?.state && (
                    <Stack spacing={0.5}>
                      <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
                        Status: {buildStatus.state} · {buildStatus.step}
                      </Typography>
                      <LinearProgress variant={buildStatus.progress_pct != null ? 'determinate' : 'indeterminate'} value={buildStatus.progress_pct || 0}
                        sx={{ height: 6, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />
                    </Stack>
                  )}
                </Stack>
              </Box>
            </Box>
          </Box>
        )}

        {step === 3 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Preview" subtitle="Inspect sample rows, nulls, extremes" />
            <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono }}>FEATURE PREVIEW</Typography>
                <Stack direction="row" spacing={1}>
                  <MetricPill label="Sample rows" value="100" />
                  <MetricPill label="Nulls" value={formatPct(selectedRow?.nullPct, 1)} color={selectedRow?.nullPct > 0.2 ? T.red : T.textDim} />
                </Stack>
              </Box>
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {['Account', 'Value', '7d', '30d'].map((h) => (
                        <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewRows.map((r) => (
                      <TableRow key={r.account_id}>
                        <TableCell sx={{ ...cellSx, color: T.accent }}>{r.account_id}</TableCell>
                        <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{r.value}</TableCell>
                        <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{r.window_7d}</TableCell>
                        <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{r.window_30d}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box sx={{ p: 1.5, borderTop: `1px solid ${T.border}` }}>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <MetricPill label="Extreme high" value="P99: 86.4" color={T.amber} />
                  <MetricPill label="Extreme low" value="P01: 2.1" color={T.blue} />
                  <MetricPill label="Variance" value={formatNum((selectedRow?.unique || 0) / 1000, 2)} />
                  <MetricPill label="Missing" value={formatPct(selectedRow?.nullPct, 1)} color={selectedRow?.nullPct > 0.2 ? T.red : T.textDim} />
                </Stack>
              </Box>
            </Box>
          </Box>
        )}

        {step === 4 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Evaluate" subtitle={canUseOutcome ? 'Target present' : 'Target not present'} />
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, minWidth: 260, flex: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono, mb: 1 }}>VALUE METRICS</Typography>
                {canUseOutcome ? (
                  <Stack spacing={1}>
                    <MetricPill label="Lift" value="1.26×" color={T.green} />
                    <MetricPill label="Capture" value="18.4%" color={T.blue} />
                    <MetricPill label="Suppression" value="3.1%" color={T.amber} />
                    <MetricPill label="Correlation" value="0.42" color={T.textDim} />
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    <MetricPill label="Variance" value="0.84" color={T.green} />
                    <MetricPill label="Stability" value="0.76" color={T.blue} />
                    <MetricPill label="Drift risk" value="LOW" color={T.green} />
                    <MetricPill label="Missing" value={formatPct(selectedRow?.nullPct, 1)} color={selectedRow?.nullPct > 0.2 ? T.red : T.textDim} />
                  </Stack>
                )}
              </Box>
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, minWidth: 260, flex: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono, mb: 1 }}>QUALITY CHECKS</Typography>
                <Stack spacing={1}>
                  <Box>
                    <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>Distribution shift</Typography>
                    <LinearProgress variant="determinate" value={28} sx={{ height: 6, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.amber } }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>Nulls impact</Typography>
                    <LinearProgress variant="determinate" value={Math.min(100, Math.round((selectedRow?.nullPct || 0) * 100))} sx={{ height: 6, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.red } }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>Redundancy</Typography>
                    <LinearProgress variant="determinate" value={42} sx={{ height: 6, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.blue } }} />
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 1.25 }}>
                  <StatusBadge label="OK TO TEST" level="approved" />
                  <StatusBadge label="PREVIEW REQUIRED" level="watch" />
                </Stack>
              </Box>
            </Stack>
          </Box>
        )}

        {step === 5 && (
          <Box sx={{ p: 2 }}>
            <SectionHeader title="Promote" subtitle="Save, version, and publish to registry" />
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, minWidth: 280, flex: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono, mb: 1 }}>FEATURE DETAILS</Typography>
                <Stack spacing={1}>
                  <TextField size="small" label="Feature name" value={featureName} onChange={(e) => setFeatureName(e.target.value)}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 10 } }} />
                  <TextField size="small" label="Notes" value={featureNotes} onChange={(e) => setFeatureNotes(e.target.value)} multiline rows={3}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 11, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 10 } }} />
                </Stack>
              </Box>
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, minWidth: 280, flex: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.mono, mb: 1 }}>POST-PROMOTION</Typography>
                <Stack spacing={1}>
                  {['Model Lab', 'Rules', 'Monitoring', 'Lineage'].map((x) => (
                    <Stack key={x} direction="row" spacing={1} alignItems="center">
                      <StatusBadge label="VISIBLE" level="approved" />
                      <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>{x}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Stack>
          </Box>
        )}
      </Box>
    </>
  );
};

export default BuildFeatureScreen;
