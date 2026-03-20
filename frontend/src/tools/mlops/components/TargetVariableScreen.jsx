/**
 * TargetVariableScreen.jsx - Target Variable Workbench
 *
 * Fixes in this version:
 *  1. Encoding bug - replaced all â€" / â€˜ / â€™ / âœ" mojibake with proper Unicode
 *  2. distinct_count now always shows (was showing "-" due to missing column_types fallback)
 *  3. Converted to full workbench style with 3 tabs: Select, Define Rules, Preview
 *  4. STR strategy now clearly explains how str.csv links to the master dataset
 *  5. Shows preprocessing steps that will be applied to the chosen target column
 *  6. ID columns detected and excluded from target candidates automatically
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Paper,
  Select, Stack, Tab, Tabs, TextField, Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesome, CheckCircle, ChevronRight,
  Flag, Info, Lightbulb, Rule, Warning,
} from '@mui/icons-material';
import {
  Bar, BarChart, Cell, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import ScreenPipelineRail from './ScreenPipelineRail';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';
import { FCC_THEME as T } from '../theme/fccWorkbenchTheme';

// ── Design tokens (match workbench) ──────────────────────────────────────────
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const D = {
  orange:      T.accent,
  orangeLight: T.accentSoft,
  border:      T.border,
  text:        T.text,
  muted:       T.textMuted,
  green:       T.success,
  greenBg:     T.successBg,
  red:         T.error,
  redBg:       T.errorBg,
  amber:       T.warning,
  amberBg:     T.panelMuted,
  blue:        T.info,
  blueBg:      T.infoBg,
  infoBorder:  T.infoBorder,
  panel:       T.panel,
  panelAlt:    T.panelAlt,
};

const fmt     = (n) => (n == null ? '-' : Number(n).toLocaleString());
const fmtPct  = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

// ── ID column detection ───────────────────────────────────────────────────────
const ID_PATTERNS = ['_id', 'transaction_id', 'account_id', 'customer_id',
  'case_id', 'alert_id', 'entity_id', 'ref_no', 'uuid', 'guid'];

const isIdColumn = (name = '') => {
  const n = name.toLowerCase();
  return n === 'id'
    || ID_PATTERNS.some((p) => n.includes(p))
    || (n.endsWith('_id') && n.length > 3);
};

// ── Heuristic target scoring ─────────────────────────────────────────────────
const TARGET_KW = [
  'target', 'label', 'final_label', 'flag', 'str', 'sar', 'is_true_pos', 'is_tp',
  'suspicious', 'fraud', 'outcome', 'result', 'positive', 'indicator',
];
const NOTEBOOK_PRIORITY_TARGETS = ['str_label', 'final_label', 'is_true_pos', 'str_flag', 'is_str', 'sar_flag', 'target'];

const LEAKAGE_HIGH = ['case_status', 'resolution', 'sar_filed', 'report_date',
  'closed_by', 'disposition', 'filed'];
const LEAKAGE_MED  = ['risk_score', 'priority', 'investigator', 'resolution_days'];

const scoreColumn = (col) => {
  const name  = String(col?.name || '').toLowerCase();
  const dtype = String(col?.dtype || '').toLowerCase();
  const dist  = Number(col?.distinct_count ?? col?.unique_count ?? col?.unique ?? 0);

  if (isIdColumn(name)) return -100; // never suggest ID columns as target

  let s = 0;
  if (TARGET_KW.some((k) => name.includes(k))) s += 45;
  if (name.startsWith('is_') || name.endsWith('_flag') || name.endsWith('_label')) s += 20;
  if (dtype.includes('bool')) s += 25;
  if (dist === 2) s += 25;
  if (dist > 2 && dist <= 5) s += 10;
  if (dist === 1) s -= 60;
  return Math.max(0, Math.min(100, s));
};

const leakageRisk = (name = '') => {
  const n = name.toLowerCase();
  if (LEAKAGE_HIGH.some((k) => n.includes(k))) return 'high';
  if (LEAKAGE_MED.some((k) => n.includes(k))) return 'medium';
  return 'none';
};

// ── Normalise columns from master dataset ────────────────────────────────────
const normalizeColumns = (masterDataset) => {
  const src = Array.isArray(masterDataset?.columns) ? masterDataset.columns : [];
  return src.map((c) => {
    if (typeof c === 'string') {
      const types = masterDataset?.column_types || {};
      return { name: c, dtype: types[c] || '', distinct_count: null, missing_pct: null };
    }
    return {
      name:           c.name,
      dtype:          c.dtype || c.type || '',
      distinct_count: c.distinct_count ?? c.unique_count ?? c.unique ?? null,
      missing_pct:    c.missing_pct ?? c.null_pct ?? null,
    };
  }).filter((c) => c.name && !isIdColumn(c.name));
};

// ── Column detail extraction from API response ────────────────────────────────
const extractDetail = (payload, selected) => {
  const body = payload?.data || payload || {};
  const fromMap = body?.columns && selected ? body.columns[selected] : null;
  if (fromMap) return fromMap;
  if (body && selected && body[selected]) return body[selected];
  return null;
};

// ── Preprocessing steps that apply to a target column ────────────────────────
const getPreprocessingSteps = (detail) => {
  if (!detail) return [];
  const steps = [];

  const isBinary = (detail.distinct_count ?? 0) <= 2;
  const dtype    = String(detail.dtype || '').toLowerCase();
  const missing  = Number(detail.missing_pct || 0);

  if (missing > 0) {
    steps.push({
      icon: 'IMPUTE',
      label: 'Imputation',
      desc: `${fmtPct(missing)} missing values will be filled (mode for categorical, 0 for binary).`,
      severity: missing > 0.1 ? 'warning' : 'info',
    });
  }

  if (isBinary && dtype.includes('object')) {
    steps.push({
      icon: 'ENC',
      label: 'Binary encoding',
      desc: 'Text values (e.g. "Yes"/"No" or "True"/"False") will be encoded as 0/1.',
      severity: 'info',
    });
  }

  if (!isBinary && dtype.includes('object')) {
    steps.push({
      icon: 'MULTI',
      label: 'Multi-class target',
      desc: 'Target has more than 2 categories. This will be treated as multi-class classification.',
      severity: 'warning',
    });
  }

  steps.push({
    icon: 'EXCL',
    label: 'Excluded from features',
    desc: 'The target column is automatically excluded from model input features during training.',
    severity: 'success',
  });

  steps.push({
    icon: 'CHECK',
    label: 'Class imbalance check',
    desc: 'Class distribution will be evaluated. SMOTE or class weights applied if imbalance > 5:1.',
    severity: 'info',
  });

  return steps;
};

// ── Column Distribution Mini-Chart ────────────────────────────────────────────
const ColumnDetail = ({ colName, detail, loading }) => {
  if (loading) {
    return (
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <CircularProgress size={22} sx={{ color: D.orange }} />
      </Box>
    );
  }
  if (!detail || !colName) return null;

  const distinct   = Number(detail.distinct_count ?? detail.unique_count ?? detail.unique ?? 0);
  const isBinary   = distinct > 0 && distinct <= 2;
  const missingPct = Number(detail.missing_pct ?? detail.null_pct ?? 0);
  const dtype      = String(detail.dtype || 'unknown');

  // Build distribution data
  const distribution = (detail.top_categories || detail.value_counts || [])
    .slice(0, 10)
    .map((r) => ({ label: String(r.value ?? r.label ?? ''), count: Number(r.count || 0) }));

  const total = distribution.reduce((s, r) => s + r.count, 0) || 1;

  const preprocessSteps = getPreprocessingSteps({ ...detail, distinct_count: distinct });

  return (
    <Stack spacing={1.5}>
      {/* Stats row */}
      <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 1, bgcolor: '#fff' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
          <Box>
            <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{colName}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }}>
              <Chip label={dtype} size="small" sx={{ fontSize: 10 }} />
              {isBinary && (
                <Chip label="Binary \u2713" size="small"
                  sx={{ fontSize: 10, bgcolor: D.greenBg, color: D.green, fontWeight: 700 }} />
              )}
            </Stack>
          </Box>
          <Stack direction="row" spacing={2.5}>
            {[
              { k: 'Unique values', v: distinct > 0 ? fmt(distinct) : '\u2014' },
              { k: '% Missing',     v: fmtPct(missingPct) },
            ].map(({ k, v }) => (
              <Box key={k} sx={{ textAlign: 'right' }}>
                <Typography sx={{ fontSize: 10, color: D.muted, display: 'block' }}>{k}</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{v}</Typography>
              </Box>
            ))}
          </Stack>
        </Stack>

        {/* Binary quality badge */}
        {isBinary ? (
          <Alert severity="success" sx={{ py: 0.5, fontSize: 11 }}>
            <strong>"{colName}"</strong> has exactly 2 values \u2014 perfect as a prediction target
            (e.g. 0\u00a0=\u00a0safe, 1\u00a0=\u00a0suspicious).
          </Alert>
        ) : distinct > 2 && distinct <= 5 ? (
          <Alert severity="info" sx={{ py: 0.5, fontSize: 11 }}>
            "{colName}" has {fmt(distinct)} distinct values. This can be used as a multi-class target.
          </Alert>
        ) : distinct > 5 ? (
          <Alert severity="warning" sx={{ py: 0.5, fontSize: 11 }}>
            "{colName}" has {fmt(distinct)} distinct values. Confirm this is a true binary/categorical outcome.
          </Alert>
        ) : null}

        {/* Distribution chart */}
        {distribution.length > 0 && (
          <Box sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: 10, color: D.muted, fontWeight: 700, mb: 0.5 }}>
              Value distribution (top {distribution.length})
            </Typography>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={distribution} margin={{ top: 2, right: 0, left: 0, bottom: 20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 9 }} />
                <RTooltip formatter={(v, _, p) => [
                  `${fmt(v)} (${(v / total * 100).toFixed(1)}%)`, p.payload.label,
                ]} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {distribution.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? D.orange : '#98A2B3'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      {/* Preprocessing steps */}
      {preprocessSteps.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 1, bgcolor: '#fff' }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
            <Rule sx={{ fontSize: 16, color: D.orange }} />
            <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>
              What preprocessing will happen to this column
            </Typography>
          </Stack>
          <Stack spacing={0.75}>
            {preprocessSteps.map((step, i) => (
              <Box key={i} sx={{
                display: 'flex', alignItems: 'flex-start', gap: 1,
                p: 1, borderRadius: 1, bgcolor:
                  step.severity === 'warning' ? D.amberBg :
                  step.severity === 'success' ? D.greenBg : '#f8fafc',
              }}>
                <Typography sx={{ fontSize: 14, flexShrink: 0 }}>{step.icon}</Typography>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 11.5, color: D.text }}>{step.label}</Typography>
                  <Typography sx={{ fontSize: 11, color: D.muted }}>{step.desc}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
};

// ── STR Data Explanation ──────────────────────────────────────────────────────
const STRExplanation = () => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, bgcolor: D.blueBg, borderColor: D.infoBorder || '#d7dee6' }}>
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Info sx={{ color: D.blue, mt: 0.2, fontSize: 18 }} />
      <Box>
        <Typography sx={{ fontWeight: 700, fontSize: 13, color: D.blue, mb: 0.75 }}>
          How case outcomes become the model target
        </Typography>
        <Stack spacing={0.75}>
          {[
            { step: '1', text: 'Rule alerts are raised first. At this stage there is no confirmed label.' },
            { step: '2', text: 'Only alerts escalated to case management receive investigator outcomes (CASE_STATUS).' },
            { step: '3', text: 'Label mapping: CLOSED_SAR_FILED = 1, CLOSED_FALSE_POSITIVE = 0, CLOSED_MONITORING = 0.' },
            { step: '4', text: 'OPEN or no-case alerts remain unlabeled and are excluded from supervised training.' },
            { step: '5', text: 'The model learns from investigator decisions, not from simulator flags or risk score proxies.' },
          ].map(({ step, text }) => (
            <Stack key={step} direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{
                width: 20, height: 20, borderRadius: '50%', bgcolor: D.blue,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.1,
              }}>
                <Typography sx={{ color: 'white', fontSize: 10, fontWeight: 700 }}>{step}</Typography>
              </Box>
              <Typography sx={{ fontSize: 11.5, color: '#1e3a5f', lineHeight: 1.5 }}>{text}</Typography>
            </Stack>
          ))}
        </Stack>
        <Alert severity="warning" sx={{ mt: 1.25, py: 0.5, fontSize: 11 }}>
          Upload `cases.csv` with `CASE_STATUS` to derive realistic labels. Do not treat open or uninvestigated alerts as false positives.
        </Alert>
      </Box>
    </Stack>
  </Paper>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const TargetVariableScreen = ({
  persona,
  masterDataset,
  targetColumn,
  onTargetChange,
  onStepAdvance,
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
}) => {
  const [tab,           setTab]          = useState(0);
  const [strategy,      setStrategy]     = useState('existing');
  const [columns,       setColumns]      = useState([]);
  const [selected,      setSelected]     = useState(targetColumn || '');
  const [detail,        setDetail]       = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving,        setSaving]       = useState(false);
  const [message,       setMessage]      = useState(null);
  const [confirmChangeOpen, setConfirmChangeOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState(null);

  // Load and score columns from master dataset
  useEffect(() => {
    setColumns(normalizeColumns(masterDataset));
  }, [masterDataset]);

  // Auto-select best candidate
  useEffect(() => {
    if (selected) return;
    if (!columns.length) return;

    const explicitNotebookTarget = columns.find((c) =>
      NOTEBOOK_PRIORITY_TARGETS.includes(String(c.name || '').toLowerCase()),
    );
    if (explicitNotebookTarget) {
      setSelected(explicitNotebookTarget.name);
      return;
    }

    const best = [...columns].sort((a, b) => scoreColumn(b) - scoreColumn(a))[0];
    if (best && scoreColumn(best) >= 35) setSelected(best.name);
  }, [columns, selected]);

  // Load column detail when selected changes
  useEffect(() => {
    if (!masterDataset?.dataset_id || !selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    mlopsApi.columnProfile({
      dataset_id: masterDataset.dataset_id,
      columns: [selected],
      sample_rows: 8000,
    })
      .then((res) => { if (alive) setDetail(extractDetail(res, selected)); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setLoadingDetail(false); });
    return () => { alive = false; };
  }, [masterDataset, selected]);

  const scored = useMemo(
    () => columns
      .map((c) => ({ ...c, score: scoreColumn(c), leak: leakageRisk(c.name) }))
      .sort((a, b) => b.score - a.score),
    [columns],
  );

  const topCandidates = useMemo(
    () => scored.filter((c) => c.score >= 35).slice(0, 6),
    [scored],
  );

  const selectionSummary = useMemo(() => {
    if (strategy === 'generate') {
      return {
        tone: 'info',
        title: 'Target will be generated from STR / case outcomes',
        detail: 'The workbench will derive a supervised label from investigator outcomes and write it back into the master dataset.',
      };
    }
    if (strategy === 'none') {
      return {
        tone: 'warning',
        title: 'Target is not set',
        detail: 'Only unsupervised EDA and downstream exploratory workflows will be available until a target is confirmed.',
      };
    }
    if (!selected) return null;

    const isRecommended = topCandidates.some((c) => c.name === selected);
    const current = scored.find((c) => c.name === selected);
    const provenance = selected === targetColumn
      ? 'This is the current target already attached to the master dataset.'
      : isRecommended
        ? 'This column was auto-ranked from the master dataset schema using AML target heuristics.'
        : 'This column was selected manually from the master dataset column list.';

    return {
      tone: current?.leak === 'high' ? 'warning' : 'success',
      title: `Selected source column: ${selected}`,
      detail: `${provenance} Distinct values: ${fmt(current?.distinct_count)}. Dtype: ${current?.dtype || 'unknown'}.`,
    };
  }, [scored, selected, strategy, targetColumn, topCandidates]);

  const targetPipelineState = useMemo(() => ({
    strategy,
    selectedTargetColumn: selected || '',
    activeTab: tab,
    currentTargetColumn: targetColumn || '',
    masterDatasetId: Number(masterDataset?.dataset_id || 0) || null,
  }), [strategy, selected, tab, targetColumn, masterDataset?.dataset_id]);

  const targetSummaryItems = useMemo(() => ([
    `Strategy: ${strategy}`,
    `Selected target: ${selected || '-'}`,
    `Recommended candidates: ${topCandidates.length}`,
    `Current target: ${targetColumn || '-'}`,
  ]), [strategy, selected, topCandidates.length, targetColumn]);

  const handleLoadTargetPipeline = useCallback((state) => {
    if (!state || typeof state !== 'object') return;
    if (typeof state.strategy === 'string') setStrategy(state.strategy);
    if (typeof state.selectedTargetColumn === 'string') setSelected(state.selectedTargetColumn);
    if (Number.isInteger(state.activeTab)) setTab(state.activeTab);
  }, []);

  const buildTargetSavePayload = useCallback(({ name, currentState, datasetId, persona: actor }) => ({
    name,
    dataset_id: Number(datasetId || 0),
    created_by_persona: actor || 'technical',
    steps: [{
      type: 'screen_state',
      screen: 'target',
      state: currentState,
    }],
  }), []);

  const syncResolvedTargetState = useCallback(async (nextTarget, nextStrategy = strategy) => {
    if (!activePipelineId) return;
    const nextState = {
      strategy: nextStrategy,
      selectedTargetColumn: selected || String(nextTarget || '').trim(),
      activeTab: tab,
      currentTargetColumn: String(nextTarget || '').trim(),
      masterDatasetId: Number(masterDataset?.dataset_id || 0) || null,
    };
    try {
      const res = await mlopsApi.pipelineSaveScreenState(activePipelineId, {
        screen: 'target',
        state: nextState,
      });
      const payload = res?.data || res;
      if (payload?.pipeline_id) onPipelineActivated?.(payload);
    } catch (e) {
      console.error('Failed to sync target step state', e);
    }
  }, [activePipelineId, masterDataset?.dataset_id, onPipelineActivated, selected, strategy, tab]);

  const confirmTarget = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setSaving(true);
    setMessage(null);
    try {
      if (strategy === 'none') {
        onTargetChange?.('');
        setMessage({ type: 'info', text: 'Proceeding without target column (unsupervised mode).' });
        await syncResolvedTargetState('', strategy);
        onStepAdvance?.('eda');
        return;
      }

      if (strategy === 'generate') {
        const res = await mlopsApi.generateStr({
          dataset_id: Number(masterDataset?.dataset_id || 0) || undefined,
        });
        const data = res?.data || res;
        const col = data?.target_column || 'str_label';
        if (targetColumn && col && col !== targetColumn) {
          setPendingTarget({
            column: col,
            text: data?.message || `STR target generated. Use "${col}" as your target column.`,
          });
          setConfirmChangeOpen(true);
        } else {
          onTargetChange?.(col, { resetDownstream: false });
          setMessage({
            type: 'success',
            text: data?.message || `STR target generated. Use "${col}" as your target column.`,
          });
          await syncResolvedTargetState(col, strategy);
          onStepAdvance?.('eda');
        }
        return;
      }

      if (!selected) {
        setMessage({ type: 'error', text: 'Select a target column before confirming.' });
        return;
      }

      const res = await mlopsApi.deriveTarget({
        dataset_id: masterDataset.dataset_id,
        strategy: 'existing',
        column: selected,
      });

      const resolved = (res?.data || res)?.target_column || selected;
      if (targetColumn && resolved && resolved !== targetColumn) {
        setPendingTarget({
          column: resolved,
          text: `Target column "${resolved}" confirmed and saved.`,
        });
        setConfirmChangeOpen(true);
      } else {
        onTargetChange?.(resolved, { resetDownstream: false });
        setMessage({ type: 'success', text: `Target column "${resolved}" confirmed and saved.` });
        await syncResolvedTargetState(resolved, strategy);
        onStepAdvance?.('eda');
      }
    } catch (e) {
      setMessage({ type: 'error', text: e?.response?.data?.error || e?.message || 'Failed to confirm target.' });
    } finally {
      setSaving(false);
    }
  }, [masterDataset, strategy, selected, onTargetChange, onStepAdvance, syncResolvedTargetState, targetColumn]);

  const applyPendingTarget = useCallback(async (resetDownstream) => {
    if (!pendingTarget?.column) return;
    onTargetChange?.(pendingTarget.column, { resetDownstream });
    setMessage({
      type: resetDownstream ? 'warning' : 'success',
      text: resetDownstream
        ? `Target switched to "${pendingTarget.column}". Downstream steps were reset.`
        : (pendingTarget.text || `Target column "${pendingTarget.column}" confirmed and saved.`),
    });
    setConfirmChangeOpen(false);
    await syncResolvedTargetState(pendingTarget.column, strategy);
    onStepAdvance?.('eda');
    setPendingTarget(null);
  }, [onTargetChange, onStepAdvance, pendingTarget, strategy, syncResolvedTargetState]);

  if (!masterDataset) {
    return (
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <ScreenPipelineRail
          screenKey="target"
          screenLabel="Target"
          persona={persona}
          datasetId={null}
          currentState={targetPipelineState}
          onLoadState={handleLoadTargetPipeline}
          buildSavePayload={buildTargetSavePayload}
          summaryItems={targetSummaryItems}
          activePipelineId={activePipelineId}
          activePipelineName={activePipelineName}
          onPipelineActivated={onPipelineActivated}
        />
        <Alert severity="warning" sx={{ borderRadius: 2, flex: 1 }}>
          Build the master dataset first (Step 2), then return here to define the target variable.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      <Dialog open={confirmChangeOpen} onClose={() => setConfirmChangeOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 1.25 } }}>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>Reset downstream steps?</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, color: D.muted }}>
            You changed the target from <strong>{targetColumn || '-'}</strong> to{' '}
            <strong>{pendingTarget?.column || '-'}</strong>. Existing EDA, preprocessing, model, and validation outputs may no longer be valid.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25 }}>
          <Button onClick={() => applyPendingTarget(false)} variant="outlined" sx={{ textTransform: 'none', borderRadius: 1 }}>
            Keep downstream
          </Button>
          <Button onClick={() => applyPendingTarget(true)} variant="contained" sx={{ textTransform: 'none', bgcolor: D.orange, '&:hover': { bgcolor: '#b63f00' }, borderRadius: 1 }}>
            Reset downstream
          </Button>
        </DialogActions>
      </Dialog>

      <ScreenPipelineRail
        screenKey="target"
        screenLabel="Target"
        persona={persona}
        datasetId={masterDataset?.dataset_id || null}
        currentState={targetPipelineState}
        onLoadState={handleLoadTargetPipeline}
        buildSavePayload={buildTargetSavePayload}
        summaryItems={targetSummaryItems}
        activePipelineId={activePipelineId}
        activePipelineName={activePipelineName}
        onPipelineActivated={onPipelineActivated}
      />

      <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25, bgcolor: D.panel }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Flag sx={{ color: D.orange, mt: 0.2 }} />
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.4 }}>
              {persona === 'business' ? 'What should the model predict?' : 'Target Variable Configuration'}
            </Typography>
            <Typography sx={{ fontSize: 12, color: D.muted }}>
              {persona === 'business'
                ? 'Choose the column that represents a true AML outcome (SAR filed, true positive). The model learns to predict this.'
                : 'Select the supervised binary label. ID columns are excluded. High-cardinality and leakage-prone fields are flagged.'}
            </Typography>
            {targetColumn && (
              <Chip
                icon={<CheckCircle sx={{ fontSize: 14 }} />}
                label={`Current target: ${targetColumn}`}
                size="small"
                variant="outlined"
                sx={{ mt: 1, bgcolor: '#fff', color: D.green, fontWeight: 700, fontSize: 11, borderColor: D.green }}
              />
            )}
            <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label="1 = True Positive -> Escalate"
                variant="outlined"
                sx={{ fontSize: 10, bgcolor: '#fff', color: D.red, fontWeight: 700, borderColor: D.redBg }}
              />
              <Chip
                size="small"
                label="0 = False Positive -> Suppress"
                variant="outlined"
                sx={{ fontSize: 10, bgcolor: '#fff', color: D.green, fontWeight: 700, borderColor: D.greenBg }}
              />
            </Stack>
            {selectionSummary && (
              <Alert
                severity={selectionSummary.tone}
                sx={{ mt: 1.25, py: 0.4, fontSize: 11.5, alignItems: 'center' }}
              >
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, mb: 0.15 }}>
                  {selectionSummary.title}
                </Typography>
                <Typography sx={{ fontSize: 11, color: D.muted }}>
                  {selectionSummary.detail}
                </Typography>
              </Alert>
            )}
          </Box>
        </Stack>
      </Paper>

      {/* Strategy tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 1.25, overflow: 'hidden', bgcolor: D.panel }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: `1px solid ${D.border}`, bgcolor: D.panelAlt,
            '& .MuiTab-root': { textTransform: 'none', fontSize: 12.5, fontWeight: 600, minHeight: 42 },
            '& .Mui-selected': { color: D.orange },
            '& .MuiTabs-indicator': { bgcolor: D.orange },
          }}>
          <Tab icon={<AutoAwesome sx={{ fontSize: 15 }} />} iconPosition="start" label="Select Column" />
          <Tab icon={<Lightbulb sx={{ fontSize: 15 }} />} iconPosition="start" label="STR / Generate" />
          <Tab icon={<Info sx={{ fontSize: 15 }} />} iconPosition="start" label="ID Column Guide" />
        </Tabs>

        <Box sx={{ p: 2 }}>
          {/* ── Tab 0: Select existing column ── */}
          {tab === 0 && (
            <Stack spacing={2}>
              {/* Top candidates */}
              {topCandidates.length > 0 && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                    <AutoAwesome sx={{ fontSize: 15, color: D.orange }} />
                    <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>Recommended columns</Typography>
                    <Typography sx={{ fontSize: 11, color: D.muted }}>(auto-scored by name, dtype, cardinality)</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {topCandidates.map((c) => (
                      <Chip
                        key={c.name}
                        label={`${c.name} \u2022 score ${c.score}`}
                        onClick={() => setSelected(c.name)}
                        variant={selected === c.name ? 'filled' : 'outlined'}
                        icon={c.leak !== 'none' ? <Warning sx={{ fontSize: 13 }} /> : undefined}
                        sx={{
                          mb: 0.75,
                          bgcolor: selected === c.name ? D.orange : undefined,
                          color:   selected === c.name ? 'white'   : undefined,
                          borderColor: selected === c.name ? D.orange : D.border,
                          fontFamily: 'monospace', fontSize: 11,
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              )}

              {/* Dropdown */}
              <FormControl size="small" fullWidth>
                <InputLabel>Or choose any column</InputLabel>
                <Select value={selected} label="Or choose any column"
                  onChange={(e) => setSelected(e.target.value)}>
                  {scored.map((c) => (
                    <MenuItem key={c.name} value={c.name}>
                      <Stack direction="row" spacing={1} alignItems="center"
                        sx={{ width: '100%', justifyContent: 'space-between' }}>
                        <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c.name}</Typography>
                        <Stack direction="row" spacing={0.5}>
                          <Typography sx={{ fontSize: 10, color: D.muted }}>score {c.score}</Typography>
                          {c.leak !== 'none' && (
                            <Chip label={`leakage: ${c.leak}`} size="small"
                              sx={{ fontSize: 9, height: 16,
                                bgcolor: c.leak === 'high' ? D.redBg  : D.amberBg,
                                color:   c.leak === 'high' ? D.red    : D.amber }} />
                          )}
                        </Stack>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Column detail */}
              <ColumnDetail colName={selected} detail={detail} loading={loadingDetail} />
            </Stack>
          )}

          {/* ── Tab 1: STR / Generate ── */}
          {tab === 1 && (
            <Stack spacing={2}>
              <STRExplanation />

              <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 1, bgcolor: '#fff' }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>
                  Choose a generation strategy
                </Typography>
                <Stack spacing={1}>
                  {[
                    {
                      value: 'existing',
                      label: 'Use existing str_label column',
                      desc: 'The master dataset already has str_label (legacy str_flag also supported).',
                      recommended: true,
                    },
                    {
                      value: 'generate',
                      label: 'Auto-generate from available data',
                      desc: 'Scan uploaded files for SAR/STR indicators and build str_label automatically.',
                      recommended: false,
                    },
                    {
                      value: 'none',
                      label: 'No target (unsupervised)',
                      desc: 'Continue without a target. Only EDA and clustering are available.',
                      recommended: false,
                    },
                  ].map((opt) => (
                    <Paper
                      key={opt.value}
                      variant="outlined"
                      onClick={() => setStrategy(opt.value)}
                      sx={{
                        p: 1.5, borderRadius: 1, cursor: 'pointer',
                        borderColor: strategy === opt.value ? D.orange : D.border,
                        bgcolor: strategy === opt.value ? D.panelAlt : '#fff',
                        '&:hover': { borderColor: D.orange },
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{
                          width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                          bgcolor: strategy === opt.value ? D.orange : D.border,
                          border: `2px solid ${strategy === opt.value ? D.orange : '#94a3b8'}`,
                        }} />
                        <Box>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>{opt.label}</Typography>
                            {opt.recommended && (
                          <Chip label="Recommended" size="small"
                                variant="outlined"
                                sx={{ fontSize: 9, height: 16, bgcolor: '#fff', color: D.green, borderColor: D.greenBg }} />
                            )}
                          </Stack>
                          <Typography sx={{ fontSize: 11, color: D.muted }}>{opt.desc}</Typography>
                        </Box>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Paper>

              {strategy === 'existing' && (
                <Alert severity="info" sx={{ fontSize: 11 }}>
                  Select "str_label" from the column dropdown in the <strong>Select Column</strong> tab.
                </Alert>
              )}
            </Stack>
          )}

          {/* ── Tab 2: ID Column Guide ── */}
          {tab === 2 && (
            <Stack spacing={1.5}>
              <Alert severity="info" sx={{ fontSize: 12 }}>
                <strong>Why are ID columns excluded from model training?</strong>
              </Alert>
              <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
                <Stack spacing={1.25}>
                  {[
                    {
                      icon: 'NO',
                      title: 'No predictive value',
                      desc: 'IDs like account_id, transaction_id, customer_id are unique identifiers. The model cannot generalise from them to unseen records.',
                    },
                    {
                      icon: 'FIT',
                      title: 'Overfitting risk',
                      desc: 'If included, the model memorises which specific IDs are positive rather than learning the actual behavioural patterns.',
                    },
                    {
                      icon: 'MAP',
                      title: 'Retained for case mapping',
                      desc: 'ID columns are kept in the dataset and used after scoring to map predictions back to alerts, cases, and customers.',
                    },
                    {
                      icon: 'NEXT',
                      title: 'What to do',
                      desc: 'Confirm your target column (str_label or similar). During Preprocessing (Step 5), ID columns are automatically dropped from features.',
                    },
                  ].map((item, i) => (
                    <Stack key={i} direction="row" spacing={1.25} alignItems="flex-start">
                      <Typography sx={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</Typography>
                      <Box>
                        <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>{item.title}</Typography>
                        <Typography sx={{ fontSize: 11.5, color: D.muted, lineHeight: 1.5 }}>{item.desc}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Paper>

              {/* Show detected ID columns */}
              {masterDataset?.columns && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 12, mb: 0.75 }}>
                    Detected ID columns in your master dataset
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {(Array.isArray(masterDataset.columns) ? masterDataset.columns : [])
                      .filter((c) => isIdColumn(typeof c === 'string' ? c : c.name))
                      .map((c) => {
                        const name = typeof c === 'string' ? c : c.name;
                        return (
                          <Chip key={name} label={name} size="small"
                            sx={{ fontFamily: 'monospace', fontSize: 10,
                              bgcolor: D.redBg, color: D.red, mb: 0.5 }} />
                        );
                      })}
                    {(Array.isArray(masterDataset.columns) ? masterDataset.columns : [])
                      .filter((c) => !isIdColumn(typeof c === 'string' ? c : c.name)).length === 0 && (
                      <Typography sx={{ fontSize: 11, color: D.muted }}>No ID columns detected.</Typography>
                    )}
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </Box>
      </Paper>

      {/* ── Confirm footer ── */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25, bgcolor: D.panel }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: D.text }}>
              {strategy === 'existing' && selected
                ? `Confirm "${selected}" as target column`
                : strategy === 'generate'
                ? 'Auto-generate target from STR data'
                : 'Continue in unsupervised mode'}
            </Typography>
            {selected && strategy === 'existing' && (
              <Typography sx={{ fontSize: 11, color: D.muted }}>
                This column will be excluded from model features and used as the training label.
              </Typography>
            )}
          </Box>
          <Button
            variant="contained"
            onClick={confirmTarget}
            disabled={canDisable(saving || (strategy === 'existing' && !selected))}
            endIcon={saving
              ? <CircularProgress size={14} sx={{ color: 'white' }} />
              : <ChevronRight />}
            sx={{
              bgcolor: D.orange, '&:hover': { bgcolor: '#b03e02' },
              textTransform: 'none', fontWeight: 700, borderRadius: 1,
            }}
          >
            Confirm Target and Continue
          </Button>
        </Stack>

        {message && (
          <Alert
            severity={message.type === 'error' ? 'error' : message.type === 'info' ? 'info' : 'success'}
            icon={message.type === 'error' ? undefined : <CheckCircle />}
            sx={{ mt: 1.25, fontSize: 12 }}
          >
            {message.text}
          </Alert>
        )}
      </Paper>
      </Stack>
    </Box>
  );
};

export default TargetVariableScreen;
