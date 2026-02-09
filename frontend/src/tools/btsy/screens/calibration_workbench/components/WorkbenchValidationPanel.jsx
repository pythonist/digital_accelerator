import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Divider,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  TextField,
  Chip,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import btsyApi from '../../../services/btsyApi';
import { BTSY_GUIDE_EVENT, emitGuideEvent } from '../../../guides/guideEvents';

const WorkbenchValidationPanel = ({
  session,
  selectedBoundaryId,
  onBoundarySelected,
  selectedStrategyId,
  onNavigateToRiskSplit
}) => {
  const sessionId = session?.session_id;
  const behaviorRunId = session?.behavior_run_id;

  const [boundaries, setBoundaries] = useState([]);
  const [internalBoundaryId, setInternalBoundaryId] = useState('');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState(null);
  const [compareAInfo, setCompareAInfo] = useState(null);
  const [compareBInfo, setCompareBInfo] = useState(null);

  const [ksRuns, setKsRuns] = useState([]);
  const [selectedKsRunId, setSelectedKsRunId] = useState('');

  const [latestRun, setLatestRun] = useState(null);
  const [runDetail, setRunDetail] = useState(null);

  const [stressRows, setStressRows] = useState([]);
  const [note, setNote] = useState('');

  const [jEnabled, setJEnabled] = useState(false);
  const [step36Runs, setStep36Runs] = useState([]);
  const [selectedStep36Id, setSelectedStep36Id] = useState('');
  const [latestStep36, setLatestStep36] = useState(null);
  const [step36Detail, setStep36Detail] = useState(null);
  const [step36Stability, setStep36Stability] = useState(null);
  const [stabilityNSamples, setStabilityNSamples] = useState(20);
  const [stabilitySampleFrac, setStabilitySampleFrac] = useState(0.75);
  const [showJCurve, setShowJCurve] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canCompute = !!sessionId && !!behaviorRunId && !!(selectedBoundaryId || internalBoundaryId);

  const resolvedBoundaryId = useMemo(() => {
    const v = selectedBoundaryId || internalBoundaryId;
    if (!v) return '';
    return String(v);
  }, [selectedBoundaryId, internalBoundaryId]);

  const refreshBoundaries = async () => {
    if (!sessionId) return;
    const res = await btsyApi.risk.listBoundaries(sessionId);
    if (res.success) {
      const next = res.data || [];
      setBoundaries(next);
      if (next.length >= 2 && (!compareA || !compareB)) {
        setCompareA(String(next[1].boundary_id));
        setCompareB(String(next[0].boundary_id));
      }
    }
  };

  const refreshKsRuns = async () => {
    if (!sessionId) return;
    const res = await btsyApi.validation.listKsRuns(sessionId);
    if (res.success) setKsRuns(res.data || []);
  };

  const refreshStep36Runs = async () => {
    if (!sessionId) return;
    const res = await btsyApi.validation.listStep36Runs(sessionId);
    if (res.success) setStep36Runs(res.data || []);
  };

  useEffect(() => {
    if (!sessionId) return;
    refreshBoundaries();
    refreshKsRuns();
    refreshStep36Runs();
  }, [sessionId]);

  useEffect(() => {
    const handler = (ev) => {
      const name = ev?.detail?.name;
      const payload = ev?.detail?.payload || {};
      if (name !== 'RISK_BOUNDARY_CREATED') return;
      if (sessionId && payload.sessionId && String(payload.sessionId) !== String(sessionId)) return;
      refreshBoundaries();
      if (payload.boundaryId) {
        const bid = String(payload.boundaryId);
        setInternalBoundaryId(bid);
        if (onBoundarySelected) onBoundarySelected(parseInt(bid, 10));
      }
    };
    window.addEventListener(BTSY_GUIDE_EVENT, handler);
    return () => window.removeEventListener(BTSY_GUIDE_EVENT, handler);
  }, [sessionId, onBoundarySelected]);

  useEffect(() => {
    if (!selectedBoundaryId) return;
    setInternalBoundaryId('');
  }, [selectedBoundaryId]);

  const computeKs = async () => {
    if (!sessionId || !resolvedBoundaryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.createKsRun(sessionId, parseInt(resolvedBoundaryId, 10), 'user');
      if (!res.success) {
        setError(res.error || 'Failed to compute KS');
        return;
      }
      setLatestRun(res.data);
      setRunDetail(null);
      setSelectedKsRunId('');
      setStressRows([]);
      await refreshKsRuns();
      emitGuideEvent('KS_COMPUTED', { sessionId, boundaryId: parseInt(resolvedBoundaryId, 10), ksRunId: res.data?.ks_run_id });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const computeComparison = async () => {
    if (!sessionId || !compareA || !compareB) return;
    setLoading(true);
    setError(null);
    try {
      const [aInfoRes, bInfoRes] = await Promise.all([
        btsyApi.risk.getBoundary(sessionId, parseInt(compareA, 10)),
        btsyApi.risk.getBoundary(sessionId, parseInt(compareB, 10))
      ]);
      if (aInfoRes.success) setCompareAInfo(aInfoRes.data);
      else setCompareAInfo(null);
      if (bInfoRes.success) setCompareBInfo(bInfoRes.data);
      else setCompareBInfo(null);
      const res = await btsyApi.risk.overlap(sessionId, parseInt(compareA, 10), parseInt(compareB, 10), 'user');
      if (!res.success) {
        setError(res.error || 'Failed to compare boundaries');
        return;
      }
      setCompareResult(res.data);
      emitGuideEvent('BOUNDARY_COMPARISON_COMPUTED', { sessionId, boundaryA: parseInt(compareA, 10), boundaryB: parseInt(compareB, 10) });
    } catch (e) {
      setError(e.message || 'Failed to compare boundaries');
    } finally {
      setLoading(false);
    }
  };

  const fmtNum = (v, digits = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  };

  const idLabel = (id) => `B-${String(id).padStart(3, '0')}`;

  const boundaryAnchorText = (info) => {
    if (!info?.boundary) return '—';
    const b = info.boundary;
    const metric = session?.metric_name || 'signal';
    const window = session?.window ? ` ${session.window}` : '';
    const upper = info?.computed?.threshold?.upper;
    const type = b.boundary_type ? ` (${b.boundary_type})` : '';
    const v = upper != null ? fmtNum(upper, 2) : (b.boundary_value != null ? fmtNum(b.boundary_value, 2) : '—');
    return `${metric}${window} ≥ ${v}${type}`;
  };

  const compareExplainer = useMemo(() => {
    if (!compareResult) return null;
    const inter = Number(compareResult.intersection_count || 0);
    const droppedFromNew = Number(compareResult.only_a_count || 0);
    const addedInNew = Number(compareResult.only_b_count || 0);
    const sizeA = inter + droppedFromNew;
    const sizeB = inter + addedInNew;
    const retentionA = sizeA ? (inter / sizeA) * 100.0 : null;
    const retentionB = sizeB ? (inter / sizeB) * 100.0 : null;
    const j = Number(compareResult.jaccard);
    const vol = Number(compareResult.volume_overlap_pct);

    const overlapLine = retentionA != null
      ? (retentionA >= 99.95
        ? 'No previously flagged entities were dropped.'
        : `About ${fmtNum(retentionA, 2)}% of prior ATL entities remain in the new ATL definition.`)
      : 'Overlap cannot be computed.';

    const jLine = Number.isFinite(j)
      ? `About ${fmtNum(j * 100.0, 1)}% of entities are common between the two ATL definitions.`
      : 'Jaccard cannot be computed.';

    const addedLine = addedInNew
      ? `${addedInNew.toLocaleString()} entities are newly classified as ATL under the new boundary. These are newly added investigation candidates.`
      : 'No newly added investigation candidates.';

    const droppedLine = droppedFromNew
      ? `${droppedFromNew.toLocaleString()} entities were removed from ATL under the new boundary.`
      : 'No prior ATL entities were lost.';

    const volLine = Number.isFinite(vol)
      ? (vol >= 50
        ? 'A large share of total transaction volume remains common across both ATL definitions.'
        : 'The new boundary captures significantly more transaction volume.')
      : 'Volume overlap cannot be computed.';

    const interpretation = (() => {
      const action = addedInNew
        ? `adds ${addedInNew.toLocaleString()} higher-activity accounts`
        : 'does not add new accounts';
      const stability = droppedFromNew ? 'but removes some previously flagged accounts' : 'without removing any previously flagged accounts';
      const volumeShift = Number.isFinite(vol) && vol < 50 ? 'materially higher share of total cash volume' : 'similar share of total cash volume';
      return `The revised boundary ${action} ${stability}. This results in a ${volumeShift} being captured, indicating a more aggressive but still stable behavioural definition.`;
    })();

    return {
      sizeA,
      sizeB,
      retentionA,
      retentionB,
      overlapLine,
      jLine,
      addedLine,
      droppedLine,
      volLine,
      interpretation
    };
  }, [compareResult, session]);

  const loadRun = async (ksRunId) => {
    if (!sessionId || !ksRunId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.getKsRun(sessionId, parseInt(ksRunId, 10));
      if (!res.success) {
        setError(res.error || 'Failed to load KS run');
        return;
      }
      setRunDetail(res.data);
      setLatestRun(null);
      setStressRows(res.data?.sensitivity || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const stressKs = async () => {
    const runId = latestRun?.ks_run_id || runDetail?.run?.ks_run_id;
    if (!sessionId || !runId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.stressKsRun(sessionId, runId, [-5, -2, -1, 1, 2, 5], [1.0, 0.5, 0.25], 'user');
      if (!res.success) {
        setError(res.error || 'Failed to stress KS');
        return;
      }
      setStressRows(res.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveNote = async () => {
    const runId = latestRun?.ks_run_id || runDetail?.run?.ks_run_id;
    if (!sessionId || !runId) return;
    const text = note.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.addKsAnnotation(sessionId, runId, text, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to save note');
        return;
      }
      setNote('');
      if (runDetail) await loadRun(runId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const computeStep36 = async () => {
    if (!sessionId || !resolvedBoundaryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.runStep36(sessionId, parseInt(resolvedBoundaryId, 10), 'user');
      if (!res.success) {
        setError(res.error || 'Failed to compute Step-3.6');
        return;
      }
      setLatestStep36(res.data);
      setStep36Detail(null);
      setStep36Stability(null);
      setSelectedStep36Id('');
      await refreshStep36Runs();
      emitGuideEvent('J_COMPUTED', { sessionId, boundaryId: parseInt(resolvedBoundaryId, 10), step36Id: res.data?.step36_id });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStep36 = async (step36Id) => {
    if (!sessionId || !step36Id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.getStep36Run(sessionId, parseInt(step36Id, 10));
      if (!res.success) {
        setError(res.error || 'Failed to load Step-3.6 run');
        return;
      }
      setStep36Detail(res.data);
      setLatestStep36(null);
      setStep36Stability(res.data?.stability || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const computeStep36Stability = async () => {
    const step36Id = latestStep36?.step36_id || step36Detail?.run?.step36_id;
    if (!sessionId || !step36Id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await btsyApi.validation.step36Stability(
        sessionId,
        step36Id,
        Number(stabilityNSamples),
        Number(stabilitySampleFrac),
        'user'
      );
      if (!res.success) {
        setError(res.error || 'Failed to compute stability');
        return;
      }
      setStep36Stability(res.data);
      if (step36Detail) await loadStep36(step36Id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetEvidence = () => {
    setLatestRun(null);
    setRunDetail(null);
    setSelectedKsRunId('');
    setStressRows([]);
    setNote('');
    setLatestStep36(null);
    setStep36Detail(null);
    setSelectedStep36Id('');
    setStep36Stability(null);
    setShowJCurve(false);
  };

  const panelData = runDetail ? {
    ks_run_id: runDetail.run.ks_run_id,
    results: runDetail.results || [],
    checks: runDetail.checks || [],
    cdf: runDetail.cdf || [],
    annotations: runDetail.annotations || []
  } : (latestRun ? {
    ks_run_id: latestRun.ks_run_id,
    results: latestRun.results || [],
    checks: latestRun.checks || [],
    cdf: latestRun.cdf || [],
    annotations: []
  } : null);

  const step36Panel = useMemo(() => {
    if (step36Detail) return step36Detail;
    if (latestStep36) return latestStep36;
    return null;
  }, [step36Detail, latestStep36]);

  const step36Summary = useMemo(() => {
    if (!step36Panel) return null;
    if (step36Panel.run) {
      return {
        max_j: step36Panel.run.max_j,
        interpretation: step36Panel.run.interpretation,
        threshold_percentile: step36Panel.run.threshold_percentile,
        stability_label: step36Panel.stability?.stability_label || null,
        mean_j: step36Panel.stability?.mean_j || null,
        std_j: step36Panel.stability?.std_j || null
      };
    }
    return {
      max_j: step36Panel.result?.max_j,
      interpretation: step36Panel.result?.interpretation,
      threshold_percentile: step36Panel.result?.threshold_percentile,
      stability_label: step36Stability?.stability_label || null,
      mean_j: step36Stability?.mean_j || null,
      std_j: step36Stability?.std_j || null
    };
  }, [step36Panel, step36Stability]);

  const warningChecks = useMemo(() => {
    const rows = panelData?.checks || [];
    return rows.filter(r => (r.status || '').toLowerCase() === 'warning');
  }, [panelData]);

  return (
    <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 0, height: '100%', overflow: 'auto' }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Validation & Separation
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          KS does NOT validate thresholds. KS does NOT prove risk. KS does NOT select scenarios. It only validates behavioural separability without leakage.
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          Context resolver
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Chip label="Behaviour source: Step-2 rows" />
          <Chip label="Split source: Step-3 boundary" />
          <Chip label="Compare: ATL rows vs BTL rows" />
          {selectedStrategyId && <Chip label={`Strategy focus: ${selectedStrategyId}`} />}
        </Box>

        {boundaries.length === 0 && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={(
              <Button color="inherit" size="small" onClick={() => onNavigateToRiskSplit && onNavigateToRiskSplit()}>
                Create boundary using current lens
              </Button>
            )}
          >
            No boundary exists for the selected behaviour + interpretation lens in this session.
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Boundaries
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          A boundary is a behavioural cutoff used to split entities into ATL vs BTL for validation. It is not a risk decision.
        </Typography>
        <TableContainer sx={{ border: '1px solid #e2e8f0', mb: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Boundary</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Strategy</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {boundaries.map((b, idx) => {
                const bid = String(b.boundary_id);
                const selected = bid === String(resolvedBoundaryId || '');
                return (
                  <TableRow
                    key={b.boundary_id}
                    hover
                    selected={selected}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => {
                      setInternalBoundaryId(bid);
                      if (onBoundarySelected) onBoundarySelected(parseInt(bid, 10));
                    }}
                  >
                    <TableCell sx={{ fontWeight: selected ? 700 : 500 }}>
                      {`${idx === 0 ? '★ ' : ''}B-${String(b.boundary_id).padStart(3, '0')}`}
                    </TableCell>
                    <TableCell>{b.buffer_type}</TableCell>
                    <TableCell align="right">{b.strategy_id}</TableCell>
                    <TableCell>{String(b.created_at || '').slice(0, 19)}</TableCell>
                  </TableRow>
                );
              })}
              {boundaries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>No boundaries created.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <InputLabel>Quick switch boundary</InputLabel>
          <Select
            value={resolvedBoundaryId}
            label="Quick switch boundary"
            onChange={(e) => {
              const v = e.target.value;
              setInternalBoundaryId(v);
              if (onBoundarySelected) onBoundarySelected(v ? parseInt(v, 10) : null);
            }}
          >
            {boundaries.map((b) => (
              <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>
                {`B-${String(b.boundary_id).padStart(3, '0')} • Strategy ${b.strategy_id} • ${b.buffer_type}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0, p: 1.5, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            What changed since last boundary
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            Compare two boundaries created under the same behaviour + interpretation lens. This shows churn and overlap.
          </Typography>
          <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 700, mb: 1 }}>
            Boundary Comparison
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Boundary A (previous)</InputLabel>
              <Select
                value={compareA}
                label="Boundary A (previous)"
                onChange={(e) => {
                  setCompareA(e.target.value);
                  setCompareAInfo(null);
                }}
              >
                {boundaries.map((b) => (
                  <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>
                    {`B-${String(b.boundary_id).padStart(3, '0')} • ${b.boundary_type || b.buffer_type || '—'}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Boundary B (current)</InputLabel>
              <Select
                value={compareB}
                label="Boundary B (current)"
                onChange={(e) => {
                  setCompareB(e.target.value);
                  setCompareBInfo(null);
                }}
              >
                {boundaries.map((b) => (
                  <MenuItem key={b.boundary_id} value={String(b.boundary_id)}>
                    {`B-${String(b.boundary_id).padStart(3, '0')} • ${b.boundary_type || b.buffer_type || '—'}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" disabled={!compareA || !compareB || loading} onClick={computeComparison}>
              Compare
            </Button>
          </Box>
          {compareAInfo && compareBInfo && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                A: {idLabel(compareAInfo.boundary.boundary_id)} • {boundaryAnchorText(compareAInfo)}
              </Typography>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                B: {idLabel(compareBInfo.boundary.boundary_id)} • {boundaryAnchorText(compareBInfo)}
              </Typography>
            </Box>
          )}
          {compareResult && (
            <>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Chip label={`Overlap (A retained in B): ${compareExplainer?.retentionA != null ? fmtNum(compareExplainer.retentionA, 2) : '—'}%`} />
                <Chip label={`Jaccard: ${Number.isFinite(Number(compareResult.jaccard)) ? fmtNum(compareResult.jaccard, 3) : '—'}`} />
                <Chip label={`Dropped (A only): ${(compareResult.only_a_count || 0).toLocaleString()}`} />
                <Chip label={`Added (B only): ${(compareResult.only_b_count || 0).toLocaleString()}`} />
                <Chip label={`Volume overlap: ${Number.isFinite(Number(compareResult.volume_overlap_pct)) ? fmtNum(compareResult.volume_overlap_pct, 2) : '—'}%`} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#334155' }}>
                  Overlap: {compareExplainer?.overlapLine || '—'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>
                  Jaccard: {compareExplainer?.jLine || '—'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>
                  Added: {compareExplainer?.addedLine || '—'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>
                  Dropped: {compareExplainer?.droppedLine || '—'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>
                  Volume overlap: {compareExplainer?.volLine || '—'}
                </Typography>
              </Box>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Interpretation
              </Typography>
              <Typography variant="body2" sx={{ color: '#475569', mb: 1 }}>
                {compareExplainer?.interpretation || '—'}
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Downstream Impact
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#475569' }}>
                  KS/J validation will test separability of this new ATL/BTL split.
                </Typography>
                <Typography variant="body2" sx={{ color: '#475569' }}>
                  Advanced analytics will compare ML anomalies against this ATL definition.
                </Typography>
                <Typography variant="body2" sx={{ color: '#475569' }}>
                  Freezing will make this boundary available for calibration and audit-safe reuse.
                </Typography>
              </Box>
            </>
          )}
        </Paper>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Button
            variant="contained"
            sx={{ bgcolor: '#0f172a' }}
            disabled={!canCompute || loading}
            onClick={computeKs}
            data-guide-id="wb-compute-ks-button"
          >
            Compute KS (Step 3.4)
          </Button>
          <Button
            variant="outlined"
            disabled={loading}
            onClick={resetEvidence}
          >
            Reset Evidence
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Saved KS Runs
        </Typography>
        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <InputLabel>KS Run</InputLabel>
          <Select
            value={selectedKsRunId}
            label="KS Run"
            onChange={(e) => {
              const v = e.target.value;
              setSelectedKsRunId(v);
              if (v) loadRun(v);
            }}
          >
            {ksRuns.map((r) => (
              <MenuItem key={r.ks_run_id} value={String(r.ks_run_id)}>
                {`KS-${String(r.ks_run_id).padStart(3, '0')} • B-${String(r.boundary_id).padStart(3, '0')} • ${r.created_at}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={() => refreshKsRuns()} disabled={loading} sx={{ mb: 2 }}>
          Refresh
        </Button>

        {!panelData && (
          <Alert severity="info">
            KS is disabled until a risk boundary is selected.
          </Alert>
        )}

        {panelData && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Focus on: KS value, ATL vs BTL row counts, warnings, and stability under stress.
            </Alert>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              KS Results
            </Typography>

            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Variant</TableCell>
                    <TableCell align="right">KS</TableCell>
                    <TableCell align="right">p-value</TableCell>
                    <TableCell align="right">ATL rows</TableCell>
                    <TableCell align="right">BTL rows</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(panelData.results || []).map((r) => (
                    <TableRow key={r.variant_type}>
                      <TableCell>{r.variant_type}</TableCell>
                      <TableCell align="right">{r.ks_stat !== null && r.ks_stat !== undefined ? Number(r.ks_stat).toFixed(4) : '—'}</TableCell>
                      <TableCell align="right">{r.p_value !== null && r.p_value !== undefined ? Number(r.p_value).toExponential(2) : '—'}</TableCell>
                      <TableCell align="right">{(r.n_atl || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{(r.n_btl || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Distribution Overlap (CDF)
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
              If the ATL and BTL curves are far apart, the split is distinct. If they overlap heavily, the split is weak.
            </Typography>
            {panelData.cdf && panelData.cdf.length > 0 ? (
              <Box sx={{ mb: 2 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={panelData.cdf}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="#64748b" hide />
                    <YAxis tick={{ fontSize: 11 }} stroke="#64748b" domain={[0, 1]} />
                    <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Line type="monotone" dataKey="atl_cdf" stroke="#0f172a" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="btl_cdf" stroke="#D04A02" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
                <Typography variant="caption" sx={{ color: '#64748b' }}>
                  CDF overlay computed on behaviour rows only.
                </Typography>
              </Box>
            ) : (
              <Alert severity="info" sx={{ mb: 2 }}>
                No CDF available for this run.
              </Alert>
            )}

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Leakage & Artefact Checks
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
              These checks flag patterns that can create “fake” separation (leakage, instability, or mechanical artefacts). If you accept warnings, record why.
            </Typography>
            {warningChecks.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Warnings detected. Capture rationale if you accept this KS context.
              </Alert>
            )}
            {(panelData.checks || []).length === 0 && (
              <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>No checks recorded.</Typography>
            )}
            {(panelData.checks || []).length > 0 && (
              <TableContainer sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Check</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Message</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {panelData.checks.map((c, idx) => (
                      <TableRow key={`${c.check_type}_${idx}`}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.check_type}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.status}</TableCell>
                        <TableCell>{c.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                KS Sensitivity & Stability
              </Typography>
              <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={stressKs} disabled={loading}>
                Stress KS
              </Button>
            </Box>
            <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
              This tests how fragile the result is if the boundary shifts or the sample size shrinks. Stable splits change gradually.
            </Typography>
            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Delta</TableCell>
                    <TableCell align="right">KS</TableCell>
                    <TableCell align="right">Shift</TableCell>
                    <TableCell align="right">ATL rows</TableCell>
                    <TableCell align="right">BTL rows</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stressRows.map((r, idx) => (
                    <TableRow key={`${r.delta_type}_${r.delta_value}_${idx}`}>
                      <TableCell>{`${r.delta_type}:${r.delta_value}`}</TableCell>
                      <TableCell align="right">{r.ks_stat !== null && r.ks_stat !== undefined ? Number(r.ks_stat).toFixed(4) : '—'}</TableCell>
                      <TableCell align="right">{r.ks_shift !== null && r.ks_shift !== undefined ? Number(r.ks_shift).toFixed(4) : '—'}</TableCell>
                      <TableCell align="right">{(r.n_atl || 0).toLocaleString()}</TableCell>
                      <TableCell align="right">{(r.n_btl || 0).toLocaleString()}</TableCell>
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

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Analyst Justification
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Why this KS is acceptable / tolerated"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Button variant="contained" sx={{ bgcolor: '#0f172a', mb: 2 }} onClick={saveNote} disabled={loading || !note.trim()}>
              Save Note
            </Button>
          </>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
          KS establishes whether distributions differ. J-Statistic quantifies how strongly they separate.
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Step 3.6 — ATL/BTL Separation Strength (J-Statistic)
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={jEnabled} onChange={(e) => setJEnabled(e.target.checked)} />}
            label="Enable"
            data-guide-id="wb-j-enable-checkbox"
          />
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          ATL/BTL are scenario-derived proxy groups. J-Statistic measures separation strength, not model accuracy or risk.
        </Alert>

        <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
          What to focus on: Max J (higher usually means stronger separation), the “Separation” label, and Stability. If stability is poor, treat the split as fragile.
        </Typography>

        {!jEnabled && (
          <Typography variant="body2" sx={{ color: '#64748b' }}>
            Enable Step 3.6 to compute separation strength on the selected signal.
          </Typography>
        )}

        {jEnabled && (
          <>
            <Button
              variant="contained"
              sx={{ bgcolor: '#0f172a', mb: 2 }}
              disabled={!canCompute || loading}
              onClick={computeStep36}
              data-guide-id="wb-compute-j-button"
            >
              Compute Separation
            </Button>

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Saved Step 3.6 Runs
            </Typography>
            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Run</InputLabel>
              <Select
                value={selectedStep36Id}
                label="Run"
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedStep36Id(v);
                  if (v) loadStep36(v);
                }}
              >
                {step36Runs.map((r) => (
                  <MenuItem key={r.step36_id} value={String(r.step36_id)}>
                    {`J-${String(r.step36_id).padStart(3, '0')} • B-${String(r.boundary_id).padStart(3, '0')} • ${r.signal_name}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={() => refreshStep36Runs()} disabled={loading} sx={{ mb: 2 }}>
              Refresh
            </Button>

            {!step36Summary && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Compute or select a Step 3.6 run.
              </Alert>
            )}

            {step36Summary && (
              <>
                <TableContainer sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell align="right">Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell>Max J</TableCell>
                        <TableCell align="right">{step36Summary.max_j !== null && step36Summary.max_j !== undefined ? Number(step36Summary.max_j).toFixed(4) : '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Separation</TableCell>
                        <TableCell align="right">{step36Summary.interpretation || '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Threshold percentile</TableCell>
                        <TableCell align="right">{step36Summary.threshold_percentile !== null && step36Summary.threshold_percentile !== undefined ? `${Number(step36Summary.threshold_percentile).toFixed(1)}%` : '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Stability</TableCell>
                        <TableCell align="right">{step36Summary.stability_label || '—'}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>

                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Stability Under Subsampling
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                  <TextField
                    size="small"
                    type="number"
                    label="N"
                    value={stabilityNSamples}
                    onChange={(e) => setStabilityNSamples(e.target.value)}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Sample frac"
                    value={stabilitySampleFrac}
                    onChange={(e) => setStabilitySampleFrac(e.target.value)}
                    sx={{ width: 120 }}
                  />
                  <Button variant="contained" sx={{ bgcolor: '#0f172a' }} onClick={computeStep36Stability} disabled={loading}>
                    Recompute Stability
                  </Button>
                </Box>

                {step36Stability && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    <Chip label={`Mean J: ${Number(step36Stability.mean_j || 0).toFixed(4)}`} />
                    <Chip label={`Std: ${Number(step36Stability.std_j || 0).toFixed(4)}`} />
                    <Chip label={`Min: ${Number(step36Stability.min_j || 0).toFixed(4)}`} />
                    <Chip label={`Max: ${Number(step36Stability.max_j || 0).toFixed(4)}`} />
                    <Chip label={`Label: ${step36Stability.stability_label || '—'}`} />
                  </Box>
                )}

                {latestStep36?.curve && latestStep36.curve.length > 0 && (
                  <FormControlLabel
                    control={<Checkbox checked={showJCurve} onChange={(e) => setShowJCurve(e.target.checked)} />}
                    label="Show J-curve"
                    sx={{ mb: 1 }}
                  />
                )}

                {showJCurve && latestStep36?.curve && latestStep36.curve.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={latestStep36.curve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="threshold" hide />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" domain={[-1, 1]} />
                        <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Line type="monotone" dataKey="j" stroke="#0f172a" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                      J(t) = TPR(t) − FPR(t), computed on behaviour rows only.
                    </Typography>
                  </Box>
                )}
              </>
            )}
          </>
        )}
      </Box>
    </Paper>
  );
};

export default WorkbenchValidationPanel;
