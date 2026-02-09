import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Stack,
  Button,
  Divider,
  Paper,
  Chip,
  LinearProgress,
  Alert,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Tooltip,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';

const formatNum = (v, digits = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
};

const interpretKs = (ks) => {
  const x = Number(ks);
  if (!Number.isFinite(x)) return '—';
  if (x >= 0.4) return 'Strong';
  if (x >= 0.25) return 'Moderate';
  return 'Weak';
};

const TabPanel = ({ value, index, children }) => {
  if (value !== index) return null;
  return <Box sx={{ p: 2 }}>{children}</Box>;
};

const FinalizeDecisionDialog = ({
  open,
  onClose,
  summary,
  loading,
  error,
  onFreeze,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const s = summary?.session || null;
  const br = summary?.behavior_run || null;
  const agg = summary?.aggregation || null;
  const av = summary?.aggregate_view || null;
  const boundary = summary?.selected_boundary || null;
  const ks = summary?.ks || null;
  const step36 = summary?.step36 || null;
  const events = summary?.events || [];
  const boundaryComparison = summary?.boundary_comparison || null;
  const strategies = summary?.strategies || [];
  const allBoundaries = summary?.boundaries || [];

  const boundaryComputed = boundary?.computed || null;
  const boundaryMeta = boundary?.boundary || null;
  const boundaryStats = boundary?.stats || [];
  const atlStats = boundaryStats.find((x) => x.population_type === 'ATL') || null;
  const btlStats = boundaryStats.find((x) => x.population_type === 'BTL') || null;

  const ksFull = useMemo(() => {
    const rows = ks?.results || [];
    return rows.find((r) => r.variant_type === 'full') || rows[0] || null;
  }, [ks]);

  const boundaryStrategy = useMemo(() => {
    const sid = boundaryMeta?.strategy_id;
    if (!sid) return null;
    return (strategies || []).find((x) => Number(x.strategy_id) === Number(sid)) || null;
  }, [boundaryMeta, strategies]);

  const boundaryById = useMemo(() => {
    const map = new Map();
    (allBoundaries || []).forEach((b) => {
      if (b && b.boundary_id != null) map.set(Number(b.boundary_id), b);
    });
    return map;
  }, [allBoundaries]);

  const comparisonExplainer = useMemo(() => {
    if (!boundaryComparison) return null;
    const inter = Number(boundaryComparison.intersection_count || 0);
    const dropped = Number(boundaryComparison.only_a_count || 0);
    const added = Number(boundaryComparison.only_b_count || 0);
    const sizeA = inter + dropped;
    const sizeB = inter + added;
    const retainedA = sizeA ? (inter / sizeA) * 100.0 : null;
    const j = Number(boundaryComparison.jaccard);
    const vol = Number(boundaryComparison.volume_overlap_pct);

    const overlapText = retainedA != null && retainedA >= 99.95
      ? 'No previously flagged entities were dropped.'
      : retainedA != null
        ? `About ${formatNum(retainedA, 2)}% of prior ATL entities remain in the new ATL definition.`
        : 'Overlap cannot be computed.';

    const jText = Number.isFinite(j)
      ? `About ${formatNum(j * 100.0, 1)}% of entities are common between the two ATL definitions.`
      : 'Jaccard cannot be computed.';

    const addedText = added
      ? `${added.toLocaleString()} entities are newly classified as ATL under the new boundary. These are newly added investigation candidates.`
      : 'No newly added investigation candidates.';

    const droppedText = dropped
      ? `${dropped.toLocaleString()} entities were removed from ATL under the new boundary.`
      : 'No prior ATL entities were lost.';

    const volText = Number.isFinite(vol) && vol < 50
      ? 'The new boundary captures significantly more transaction volume.'
      : Number.isFinite(vol)
        ? 'A large share of total transaction volume remains common across both ATL definitions.'
        : 'Volume overlap cannot be computed.';

    const interpretation = (() => {
      const addClause = added ? `by adding ${added.toLocaleString()} higher-activity accounts` : 'without adding new accounts';
      const dropClause = dropped ? `while removing ${dropped.toLocaleString()} previously flagged accounts` : 'without removing any previously flagged accounts';
      const volumeClause = Number.isFinite(vol) && vol < 50 ? 'materially higher share of total cash volume being captured' : 'similar share of total cash volume being captured';
      return `The revised boundary increases ATL coverage ${addClause} ${dropClause}. This results in a ${volumeClause}, indicating a more aggressive but still stable behavioural definition.`;
    })();

    return {
      ids: { a: Number(boundaryComparison.boundary_a), b: Number(boundaryComparison.boundary_b) },
      retainedA,
      overlapText,
      jText,
      addedText,
      droppedText,
      volText,
      interpretation
    };
  }, [boundaryComparison]);

  const anchorBoundaryText = useMemo(() => {
    if (!comparisonExplainer) return null;
    const metric = s?.metric_name || br?.metric?.name || 'signal';
    const window = s?.window || br?.metric?.window;
    const win = window ? ` ${window}` : '';
    const a = boundaryById.get(comparisonExplainer.ids.a);
    const b = boundaryById.get(comparisonExplainer.ids.b);
    const aType = a?.boundary_type ? ` (${a.boundary_type})` : '';
    const bType = b?.boundary_type ? ` (${b.boundary_type})` : '';
    const aVal = a?.boundary_value != null ? formatNum(a.boundary_value, 2) : '—';
    const bVal = b?.boundary_value != null ? formatNum(b.boundary_value, 2) : '—';
    return {
      a: `A (previous): Peak${win} ${metric} ≥ ${aVal}${aType}`,
      b: `B (current): Peak${win} ${metric} ≥ ${bVal}${bType}`
    };
  }, [comparisonExplainer, boundaryById, s, br, formatNum]);

  const lensText = useMemo(() => {
    if (!agg) return '—';
    const e = String(agg.entity_collapse || 'max').toUpperCase();
    const t = String(agg.time_lens || 'full').toUpperCase();
    const n = agg.sustained_days;
    if (String(agg.time_lens) === 'sustained') return `${e} • ${t} • N=${n}`;
    return `${e} • ${t}`;
  }, [agg]);

  const boundaryStatement = useMemo(() => {
    if (!boundaryMeta || !boundaryComputed) return null;
    const val = boundaryComputed.threshold_value ?? boundaryMeta.boundary_value;
    const pct = atlStats?.population_pct;
    const atlN = atlStats?.entity_count;
    const btlN = btlStats?.entity_count;
    return {
      value: val,
      pct,
      atlN,
      btlN,
    };
  }, [boundaryMeta, boundaryComputed, atlStats, btlStats]);

  const behaviorPlainEnglish = useMemo(() => {
    if (!s) return null;
    const metricName = s.metric_name || br?.metric?.name || 'metric';
    const window = s.window || br?.metric?.window || '—';
    const entity = (s.entity_level || br?.entity_level || 'entity').toLowerCase();
    return `This session evaluates ${metricName} behaviour at the ${entity} level using a ${window} window.`;
  }, [s, br]);

  const finalStatement = useMemo(() => {
    if (!boundaryStatement || !s) return null;
    const entity = (s.entity_level || 'entity').toLowerCase();
    const metricName = s.metric_name || br?.metric?.name || 'metric';
    const window = s.window || br?.metric?.window || '—';
    const v = formatNum(boundaryStatement.value, 2);
    const pct = boundaryStatement.pct !== undefined && boundaryStatement.pct !== null ? formatNum(boundaryStatement.pct, 2) : null;
    const atlN = boundaryStatement.atlN !== undefined && boundaryStatement.atlN !== null ? formatNum(boundaryStatement.atlN) : null;
    return `For each ${entity}, peak ${window} ${metricName} above ${v} defines ATL${pct ? ` (~${pct}%)` : ''}${atlN ? ` (${atlN} entities)` : ''}.`;
  }, [boundaryStatement, s, br]);

  const freezeDisabled = !summary?.ready_to_freeze || String(s?.status || '').toLowerCase() === 'frozen';

  const statusLabel = useMemo(() => {
    if (!s) return '—';
    if (String(s.status || '').toLowerCase() === 'frozen') return 'Frozen';
    return summary?.ready_to_freeze ? 'Ready to Freeze' : 'Draft';
  }, [s, summary]);

  const boundaryLockValue = useMemo(() => {
    if (boundaryComputed?.threshold?.upper != null) return boundaryComputed.threshold.upper;
    if (boundaryMeta?.boundary_value != null) return boundaryMeta.boundary_value;
    return null;
  }, [boundaryComputed, boundaryMeta]);

  const contextSnapshot = useMemo(() => {
    return {
      session_id: s?.session_id ?? null,
      behavior_run_id: s?.behavior_run_id ?? null,
      universe_id: s?.universe_id ?? null,
      entity_level: s?.entity_level ?? null,
      metric: s?.metric_name ?? br?.metric?.name ?? null,
      window: s?.window ?? br?.metric?.window ?? null,
      lens: agg ? { entity: agg.entity_collapse, time: agg.time_lens, sustained_days: agg.sustained_days } : null,
      boundary: boundaryMeta
        ? {
          boundary_id: boundaryMeta.boundary_id,
          boundary_type: boundaryMeta.boundary_type,
          boundary_value: boundaryLockValue,
          atl_pct: atlStats?.population_pct ?? null,
        }
        : null
    };
  }, [s, br, agg, boundaryMeta, boundaryLockValue, atlStats]);

  const decisionCards = useMemo(() => {
    const out = [];
    out.push({
      step: 'Step 3.1 — Interpretation Lens',
      rows: [
        `Lens: ${lensText}`,
        `Entities reduced: ${formatNum(av?.summary?.entities)}`,
        `Range: ${formatNum(av?.summary?.min, 2)} → ${formatNum(av?.summary?.max, 2)}`,
        `P95: ${formatNum(av?.summary?.p95, 2)}`
      ]
    });
    out.push({
      step: 'Step 3.2 — Signal Distribution',
      rows: [
        'Signal distribution confirms tail behaviour and concentration before selecting a cutoff.',
      ]
    });
    out.push({
      step: 'Step 3.3 — Threshold Simulation',
      rows: boundaryStrategy
        ? [
          `Strategy: ${boundaryStrategy.name || `Strategy ${boundaryStrategy.strategy_id}`}`,
          `Type: ${boundaryStrategy.strategy_type || '—'}`,
          `Candidate: ${formatNum(boundaryStrategy.threshold_value, 2)}`,
          `Coverage: ${boundaryStrategy.population_pct != null ? `${formatNum(boundaryStrategy.population_pct, 2)}%` : '—'}`
        ]
        : ['No saved strategy is currently linked to the selected boundary.']
    });
    out.push({
      step: 'Step 3.4 — Boundary Creation',
      rows: boundaryMeta
        ? [
          `Boundary: B-${String(boundaryMeta.boundary_id).padStart(3, '0')} • ${boundaryMeta.boundary_type || '—'}`,
          `Value: ${boundaryLockValue != null ? formatNum(boundaryLockValue, 2) : '—'}`,
          `ATL: ${atlStats?.population_pct != null ? `${formatNum(atlStats.population_pct, 2)}%` : '—'} (${atlStats?.entity_count != null ? formatNum(atlStats.entity_count) : '—'} entities)`,
          `BTL: ${btlStats?.entity_count != null ? formatNum(btlStats.entity_count) : '—'} entities`
        ]
        : ['No boundary selected for this lens in this session.']
    });
    out.push({
      step: 'Step 3.5 — KS Validation',
      rows: ksFull
        ? [
          `KS: ${formatNum(ksFull.ks_stat, 3)} • Separation: ${interpretKs(ksFull.ks_stat)}`,
          `n(ATL): ${formatNum(ksFull.n_atl)} • n(BTL): ${formatNum(ksFull.n_btl)}`
        ]
        : ['No KS validation run recorded.']
    });
    out.push({
      step: 'Step 3.6 — J Statistic (optional)',
      rows: step36?.run
        ? [
          `J: ${formatNum(step36.run.max_j, 3)} • Strength: ${step36.interpretation?.label || '—'}`,
          `Stability: ${step36.stability?.stability_label || '—'}`
        ]
        : ['Not run.']
    });
    return out;
  }, [lensText, av, boundaryStrategy, boundaryMeta, boundaryLockValue, atlStats, btlStats, ksFull, step36]);

  const uiTraceRows = useMemo(() => {
    const rows = Array.isArray(events) ? events.slice() : [];
    rows.sort((a, b) => Number(a?.event_id || 0) - Number(b?.event_id || 0));

    let stage = 'reduce';
    let boundaryTab = 'threshold';

    const stepName = (st, bt) => {
      if (st === 'reduce') return { step: 'Step 3.1', name: 'Interpretation Lens' };
      if (st === 'signal') return { step: 'Step 3.2', name: 'Signal Distribution' };
      if (st === 'boundary') {
        if (bt === 'threshold') return { step: 'Step 3.3', name: 'Threshold Simulation' };
        return { step: 'Step 3.4', name: 'Boundary Creation' };
      }
      if (st === 'validate') return { step: 'Step 3.5', name: 'Validation' };
      return { step: 'Step 3', name: 'Workbench' };
    };

    const toRow = (e) => {
      const et = String(e?.event_type || '');
      const payload = e?.event || {};

      if (et === 'ui_stage_changed') stage = payload.stage || stage;
      if (et === 'ui_boundary_tab_changed') boundaryTab = payload.tab || boundaryTab;

      const ctx = stepName(stage, boundaryTab);

      const map = () => {
        if (et === 'ui_stage_changed') {
          const label = payload.stage === 'reduce' ? 'Reduce' : payload.stage === 'signal' ? 'Signal' : payload.stage === 'boundary' ? 'Define Boundary' : payload.stage === 'validate' ? 'Validate' : payload.stage;
          return { action: `Switched to “${label}” tab`, meaning: `User moved to ${ctx.name}.` };
        }
        if (et === 'ui_boundary_tab_changed') {
          const label = payload.tab === 'threshold' ? 'Threshold Simulation' : payload.tab === 'split' ? 'Risk Split' : payload.tab;
          const sub = payload.tab === 'threshold' ? 'Threshold Simulation' : 'Boundary Creation';
          return { action: `Opened “${label}”`, meaning: `User moved into Step ${sub === 'Threshold Simulation' ? '3.3' : '3.4'} context.` };
        }
        if (et === 'ui_bottom_tab_changed') {
          const label = payload.tab === 'evidence' ? 'Evidence' : payload.tab === 'logs' ? 'Logs' : payload.tab === 'notes' ? 'Notes' : payload.tab === 'lineage' ? 'Lineage' : payload.tab;
          return { action: `Switched evidence view to “${label}”`, meaning: `User reviewed supporting material during ${ctx.step} — ${ctx.name}.` };
        }
        if (et === 'ui_strategy_selected') {
          return { action: `Selected strategy ${payload.strategy_id || '—'}`, meaning: 'User focused threshold simulation on a specific strategy.' };
        }
        if (et === 'ui_boundary_selected') {
          return { action: `Selected boundary ${payload.boundary_id || '—'}`, meaning: 'User selected the boundary object used for ATL/BTL split.' };
        }
        if (et === 'ui_finalize_opened') {
          return { action: 'Opened Review & Finalize', meaning: 'User requested a decision audit before freezing.' };
        }
        if (et === 'aggregation_updated') {
          return { action: 'System saved interpretation lens', meaning: `Lens persisted: ${payload.aggregation_lens || '—'}.` };
        }
        if (et === 'strategy_added') {
          return { action: 'System saved strategy', meaning: `Strategy ${payload.strategy_id || '—'} created for threshold simulation.` };
        }
        if (et === 'risk_boundary_created') {
          return { action: 'System created boundary', meaning: `Boundary ${payload.boundary_id || '—'} created under current lens.` };
        }
        if (et === 'ks_validation_completed') {
          return { action: 'System computed KS', meaning: `KS run ${payload.ks_run_id || '—'} computed for the ATL/BTL split.` };
        }
        if (et === 'ks_validation_blocked') {
          return { action: 'System blocked KS', meaning: 'Boundary produced empty ATL or BTL population.' };
        }
        if (et === 'STEP_3_6_RUN') {
          return { action: 'System computed J statistic', meaning: `J run ${payload.step36_id || '—'} computed for this boundary.` };
        }
        if (et === 'STEP_3_6_STABILITY') {
          return { action: 'System computed J stability', meaning: `Stability: ${payload.stability_label || '—'}.` };
        }
        if (et === 'session_frozen' || et === 'ui_freeze_confirmed') {
          return { action: 'Freeze confirmed', meaning: 'User locked this session for audit safety.' };
        }
        if (et.startsWith('ui_')) {
          return { action: et.replace('ui_', '').replace(/_/g, ' '), meaning: 'User interaction recorded.' };
        }
        return null;
      };

      const mapped = map();
      if (!mapped) return null;

      const derivedStep = (() => {
        if (et === 'ui_finalize_opened' || et === 'ui_freeze_confirmed' || et === 'session_frozen') return { step: 'Final', name: 'Final Validation' };
        if (et === 'session_created' || et === 'ui_session_selected') return { step: 'Session', name: 'Session Overview' };
        return ctx;
      })();

      return {
        id: e?.event_id || `${e?.created_at}-${et}`,
        time: String(e?.created_at || '').slice(0, 19) || '—',
        step: derivedStep.step,
        stepName: derivedStep.name,
        action: mapped.action,
        meaning: mapped.meaning,
        actor: e?.created_by || '—',
        context: payload
      };
    };

    return rows.map(toRow).filter(Boolean);
  }, [events]);

  const onUiRowClick = (row) => {
    if (!row) return;
    if (row.step === 'Session') setActiveTab(0);
    else if (row.step === 'Final') setActiveTab(3);
    else if (String(row.step || '').startsWith('Step')) setActiveTab(1);
    else setActiveTab(2);
  };

  const readiness = useMemo(() => {
    const aggOk = !!agg;
    const boundaryOk = !!boundaryMeta;
    const ksOk = !!ksFull;
    const stability = String(step36?.stability?.stability_label || '');
    const stabilityOk = !stability || stability === 'stable' || stability === 'sensitive';
    return {
      aggregation: aggOk,
      boundary: boundaryOk,
      ks: ksOk,
      stability: stabilityOk,
      stabilityLabel: stability || 'unknown',
      mlOptional: true
    };
  }, [agg, boundaryMeta, ksFull, step36]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 0 } }}>
      <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          Review & Finalize
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Lock meaning, not clicks. This is the behavioural decision you are about to freeze.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

        {!loading && !error && (
          <>
            <Box sx={{ px: 2, pt: 1 }}>
              <Tabs
                value={activeTab}
                onChange={(_e, v) => setActiveTab(v)}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="Session Overview" />
                <Tab label="Decision Trace" />
                <Tab label="UI Trace" />
                <Tab label="Final Validation" />
              </Tabs>
            </Box>
            <Divider />

            <TabPanel value={activeTab} index={0}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Session Overview
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                  <Chip label={s ? `Session: S-${String(s.session_id).padStart(3, '0')}` : 'Session: —'} />
                  <Chip label={s ? `Behaviour Run: BR-${String(s.behavior_run_id).padStart(3, '0')}` : 'Behaviour Run: —'} />
                  <Chip label={s ? `Entity: ${s.entity_level}` : 'Entity: —'} />
                  <Chip label={`Status: ${statusLabel}`} />
                </Stack>

                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Context Lock
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                  <Chip label={s?.behavior_run_id != null ? `Behaviour Run: BR-${String(s.behavior_run_id).padStart(3, '0')}` : 'Behaviour Run: —'} />
                  <Chip label={`Metric: ${s?.metric_name || br?.metric?.name || '—'}`} />
                  <Chip label={`Lens: ${lensText}`} />
                  <Chip label={`Boundary: ${boundaryMeta?.boundary_type || '—'} · ${boundaryLockValue != null ? formatNum(boundaryLockValue, 2) : '—'}`} />
                  <Chip label={`Status: ${statusLabel}`} />
                </Stack>

                {behaviorPlainEnglish && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {behaviorPlainEnglish}
                  </Typography>
                )}
              </Paper>
            </TabPanel>

            <TabPanel value={activeTab} index={1}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                Decision Trace is the executive summary of what was decided by step.
              </Typography>
              {decisionCards.map((card) => (
                <Accordion key={card.step} defaultExpanded={card.step === 'Step 3.4 — Boundary Creation'}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{card.step}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={0.5}>
                      {card.rows.map((r) => (
                        <Typography key={r} variant="body2" sx={{ color: 'text.secondary' }}>
                          {r}
                        </Typography>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </TabPanel>

            <TabPanel value={activeTab} index={2}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                UI Trace explains how the user arrived at the decision by mapping interactions to calibration steps.
              </Typography>

              <Accordion defaultExpanded={false}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    System Context Snapshot
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(contextSnapshot, null, 2)}
                  </Box>
                </AccordionDetails>
              </Accordion>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 0, mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Step</TableCell>
                      <TableCell>UI Action</TableCell>
                      <TableCell>Meaning</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {uiTraceRows.map((r) => (
                      <TableRow
                        key={r.id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => onUiRowClick(r)}
                      >
                        <TableCell>{r.time}</TableCell>
                        <TableCell>
                          <Tooltip title={`This interaction occurred during ${r.step} — ${r.stepName}`}>
                            <Box component="span">{r.step}</Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell>{r.action}</TableCell>
                        <TableCell sx={{ maxWidth: 520, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.meaning}
                        </TableCell>
                      </TableRow>
                    ))}
                    {uiTraceRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>
                          No UI events recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </TabPanel>

            <TabPanel value={activeTab} index={3}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Final Behavioural Statement
                </Typography>
                {!finalStatement && (
                  <Alert severity="warning">
                    Missing boundary or computed stats. Create/select a boundary for the current interpretation lens.
                  </Alert>
                )}
                {finalStatement && (
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {finalStatement}
                  </Typography>
                )}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Boundary Change Summary
                </Typography>
                {!boundaryComparison && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    No boundary comparison available for this session.
                  </Typography>
                )}
                {boundaryComparison && (
                  <>
                    {anchorBoundaryText && (
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{anchorBoundaryText.a}</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{anchorBoundaryText.b}</Typography>
                      </Box>
                    )}
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                      <Chip label={`Overlap: ${comparisonExplainer?.retainedA != null ? `${formatNum(comparisonExplainer.retainedA, 2)}%` : '—'}`} />
                      <Chip label={`Jaccard: ${formatNum(boundaryComparison.jaccard, 3)}`} />
                      <Chip label={`Added: ${formatNum(boundaryComparison.only_b_count)}`} />
                      <Chip label={`Dropped: ${formatNum(boundaryComparison.only_a_count)}`} />
                      <Chip label={`Volume overlap: ${formatNum(boundaryComparison.volume_overlap_pct, 2)}%`} />
                    </Stack>
                    {comparisonExplainer && (
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0.5 }}>
                        <Typography variant="body2" sx={{ color: '#334155' }}>
                          Overlap → {comparisonExplainer.overlapText}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#334155' }}>
                          Jaccard → {comparisonExplainer.jText}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#334155' }}>
                          Added → {comparisonExplainer.addedText}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#334155' }}>
                          Dropped → {comparisonExplainer.droppedText}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#334155' }}>
                          Volume overlap → {comparisonExplainer.volText}
                        </Typography>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Interpretation
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {comparisonExplainer.interpretation}
                        </Typography>
                      </Box>
                    )}
                  </>
                )}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Freeze Readiness Checklist
                </Typography>
                <Stack spacing={0.5}>
                  <FormControlLabel control={<Checkbox checked={readiness.aggregation} />} label="Interpretation lens set" />
                  <FormControlLabel control={<Checkbox checked={readiness.boundary} />} label="Boundary created" />
                  <FormControlLabel control={<Checkbox checked={readiness.ks} />} label="KS validation run" />
                  <FormControlLabel control={<Checkbox checked={readiness.stability} />} label={`Stability acceptable (${readiness.stabilityLabel})`} />
                  <FormControlLabel control={<Checkbox checked />} label="ML evidence optional (not required)" />
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Freeze Target
                </Typography>
                <Stack spacing={0.5} sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    You are freezing Boundary ID: {boundaryMeta?.boundary_id != null ? `B-${String(boundaryMeta.boundary_id).padStart(3, '0')}` : '—'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Behaviour run: {s?.behavior_run_id != null ? `R-${String(s.behavior_run_id).padStart(3, '0')}` : '—'} • Lens: {lensText}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Boundary value: {boundaryLockValue != null ? formatNum(boundaryLockValue, 2) : '—'} • ATL: {atlStats?.population_pct != null ? `${formatNum(atlStats.population_pct, 2)}%` : '—'}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button variant="outlined" onClick={() => setActiveTab(1)}>
                    Go back and adjust Step 3
                  </Button>
                  <Button variant="contained" onClick={onFreeze} disabled={freezeDisabled}>
                    Freeze Session
                  </Button>
                </Stack>
              </Paper>
            </TabPanel>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FinalizeDecisionDialog;
