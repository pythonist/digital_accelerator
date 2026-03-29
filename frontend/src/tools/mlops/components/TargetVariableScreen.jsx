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
  Select, Stack, Tab, Tabs, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
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

const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString());
const fmtPct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
const normalizeToken = (value = '') => String(value || '').trim().toLowerCase();
const unwrapApiPayload = (payload) => payload?.data?.data || payload?.data || payload || {};

// ── ID column detection ───────────────────────────────────────────────────────
const ID_PATTERNS = ['_id', 'transaction_id', 'account_id', 'customer_id',
  'case_id', 'alert_id', 'entity_id', 'ref_no', 'uuid', 'guid'];
const OUTCOME_PRIORITY_COLUMNS = ['is_true_pos', 'final_label', 'str_label', 'is_generated_target', 'target'];
const DERIVED_OUTCOME_PATTERNS = ['is_true_pos', 'final_label', 'str_label', 'is_generated_target', 'target'];
const CASE_DECISION_PATTERNS = ['case_status', 'case_disposition', 'disposition', 'resolution', 'outcome', 'sar_filed', 'str_filed'];
const RISK_INDICATOR_PATTERNS = [
  'pep', 'adverse', 'media', 'correspondent', 'risk', 'sanction',
  'watchlist', 'high_risk', 'country', 'geo', 'segment', 'customer_type',
  'account_type', 'occupation', 'rule_score', 'alert_score',
];
const POSITIVE_OUTCOME_TOKENS = new Set([
  '1', 'true', 'yes', 'y', 'sar filed', 'sar_filed',
  'closed_sar_filed', 'true_positive', 'escalated', 'escalation', 'confirmed escalation',
]);
const NEGATIVE_OUTCOME_TOKENS = new Set([
  '0', 'false', 'no', 'n', 'false_positive', 'closed_false_positive',
  'closed monitoring', 'closed_monitoring', 'monitoring', 'monitoring closure',
]);
const OPEN_OUTCOME_TOKENS = new Set([
  '', '(missing)', 'missing', 'nan', 'null', 'none', 'open',
  'unresolved', 'pending', 'in progress', 'unknown',
]);

const isIdColumn = (name = '') => {
  const n = normalizeToken(name);
  return n === 'id'
    || ID_PATTERNS.some((p) => n.includes(p))
    || (n.endsWith('_id') && n.length > 3);
};

const isDerivedOutcomeColumn = (name = '') => {
  const token = normalizeToken(name);
  return DERIVED_OUTCOME_PATTERNS.some((pattern) => token.includes(pattern));
};

const isCaseDecisionColumn = (name = '', detected = null) => {
  const token = normalizeToken(name);
  return Boolean(detected?.is_label_source) || CASE_DECISION_PATTERNS.some((pattern) => token.includes(pattern));
};

const isRiskIndicatorColumn = (name = '') => {
  const token = normalizeToken(name);
  if (!token || isIdColumn(token) || isDerivedOutcomeColumn(token) || isCaseDecisionColumn(token)) return false;
  return RISK_INDICATOR_PATTERNS.some((pattern) => token.includes(pattern));
};

const FIELD_ROLE_META = {
  system_outcome: {
    label: 'System-created outcome',
    description: 'Final Yes/No investigation outcome used for learning.',
    chipSx: { bgcolor: D.greenBg, color: D.green, borderColor: D.green },
  },
  case_decision_source: {
    label: 'Case decision source',
    description: 'Read by the system and converted into the final learning outcome.',
    chipSx: { bgcolor: D.blueBg, color: D.blue, borderColor: D.infoBorder },
  },
  risk_indicator: {
    label: 'Risk indicator',
    description: 'Useful as context or predictor, not as the final investigation outcome.',
    chipSx: { bgcolor: D.amberBg, color: D.amber, borderColor: '#d4b483' },
  },
  candidate: {
    label: 'Review field',
    description: 'Available in the master dataset, but not clearly a final case decision.',
    chipSx: { bgcolor: '#f8fafc', color: D.text, borderColor: D.border },
  },
};

const getFieldRole = (column, detected = null) => {
  const name = String(column?.name || '');
  if (isDerivedOutcomeColumn(name)) return 'system_outcome';
  if (isCaseDecisionColumn(name, detected)) return 'case_decision_source';
  if (isRiskIndicatorColumn(name)) return 'risk_indicator';
  if ((detected?.score ?? scoreColumn(column)) >= 35) return 'candidate';
  return 'candidate';
};

const getFieldRoleMeta = (role) => FIELD_ROLE_META[role] || FIELD_ROLE_META.candidate;

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
  const n = normalizeToken(name);
  if (LEAKAGE_HIGH.some((k) => n.includes(k))) return 'high';
  if (LEAKAGE_MED.some((k) => n.includes(k))) return 'medium';
  return 'none';
};

const summarizeOutcomeCounts = (detail) => {
  if (!detail) return null;

  const valueCounts = (detail.top_categories || detail.value_counts || []).map((row) => ({
    value: normalizeToken(row?.value ?? row?.label ?? ''),
    count: Number(row?.count || 0),
  }));

  let escalated = 0;
  let closedWithoutSar = 0;
  let openOrNotUsed = Number(detail.missing_count || detail.null_count || 0);
  let mappedAny = false;

  valueCounts.forEach(({ value, count }) => {
    if (POSITIVE_OUTCOME_TOKENS.has(value)) {
      escalated += count;
      mappedAny = true;
      return;
    }
    if (NEGATIVE_OUTCOME_TOKENS.has(value)) {
      closedWithoutSar += count;
      mappedAny = true;
      return;
    }
    if (OPEN_OUTCOME_TOKENS.has(value)) {
      openOrNotUsed += count;
      mappedAny = true;
    }
  });

  if (!mappedAny && Number(detail.distinct_count || 0) <= 2) {
    valueCounts.forEach(({ value, count }) => {
      if (value === '1') escalated += count;
      if (value === '0') closedWithoutSar += count;
    });
  }

  const alertsWithFinalDecision = escalated + closedWithoutSar;
  const totalRows = Number(detail.total_count || detail.rows_analyzed || (alertsWithFinalDecision + openOrNotUsed) || 0);

  if (!alertsWithFinalDecision && !openOrNotUsed && !totalRows) return null;

  return {
    alertsWithFinalDecision,
    escalated,
    closedWithoutSar,
    openOrNotUsed: Math.max(openOrNotUsed, totalRows - alertsWithFinalDecision),
    totalRows,
  };
};

const buildOutcomeMetaFromResponse = (payload, fallbackColumn = '') => {
  const data = unwrapApiPayload(payload);
  if (!data || typeof data !== 'object') return null;
  const positiveCount = Number(data.n_positive || 0);
  const negativeCount = Number(data.n_negative || 0);
  const labelledCount = data.n_labelled ?? (positiveCount + negativeCount);
  return {
    targetColumn: String(data.target_column || fallbackColumn || '').trim(),
    derivedColumn: String(data.derived_column || data.target_column || fallbackColumn || '').trim(),
    sourceColumn: String(data.source_column || 'CASE_STATUS').trim(),
    alertsWithFinalDecision: Number(labelledCount || 0),
    escalated: positiveCount,
    closedWithoutSar: negativeCount,
    openOrNotUsed: Number(data.n_excluded ?? data.n_null ?? 0),
    totalRows: Number(data.n_total ?? data.total_rows ?? 0),
    strategy: String(data.strategy || '').trim(),
    warning: data.warning || null,
  };
};

const getPreviewCellText = (value) => {
  if (value == null || value === '') return '-';
  const text = String(value);
  return text.length > 36 ? `${text.slice(0, 33)}...` : text;
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
  onPipelineActivated,
  initialActiveTab = 0,
  onActiveTabChange,
}) => {
  const [tab,           setTab]          = useState(initialActiveTab);
  const [strategy,      setStrategy]     = useState('existing');
  const [columns,       setColumns]      = useState([]);
  const [selected,      setSelected]     = useState(targetColumn || '');
  const [detail,        setDetail]       = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving,        setSaving]       = useState(false);
  const [message,       setMessage]      = useState(null);
  const [confirmChangeOpen, setConfirmChangeOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState(null);
  const [candidateCatalog, setCandidateCatalog] = useState([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewColumns, setPreviewColumns] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [outcomeMeta, setOutcomeMeta] = useState(null);
  const completedTabs = useMemo(() => {
    const done = new Set();
    if (tab > 0 || selected || targetColumn) done.add(0);
    if (tab > 1 || targetColumn) done.add(1);
    if (targetColumn) done.add(2);
    return done;
  }, [selected, tab, targetColumn]);

  useEffect(() => {
    if (!Number.isInteger(initialActiveTab)) return;
    setTab((prev) => (prev === initialActiveTab ? prev : initialActiveTab));
  }, [initialActiveTab]);

  useEffect(() => {
    onActiveTabChange?.(tab);
  }, [onActiveTabChange, tab]);

  // Load and score columns from master dataset
  useEffect(() => {
    setColumns(normalizeColumns(masterDataset));
  }, [masterDataset]);

  useEffect(() => {
    if (!masterDataset?.dataset_id) {
      setCandidateCatalog([]);
      return;
    }
    let alive = true;
    setCandidateLoading(true);
    mlopsApi.detectTarget({ dataset_id: masterDataset.dataset_id })
      .then((res) => {
        if (!alive) return;
        const payload = unwrapApiPayload(res);
        setCandidateCatalog(Array.isArray(payload?.candidates) ? payload.candidates : []);
      })
      .catch(() => {
        if (alive) setCandidateCatalog([]);
      })
      .finally(() => {
        if (alive) setCandidateLoading(false);
      });
    return () => { alive = false; };
  }, [masterDataset?.dataset_id]);

  useEffect(() => {
    if (!masterDataset?.dataset_id) {
      setPreviewRows([]);
      setPreviewColumns([]);
      return;
    }
    let alive = true;
    setPreviewLoading(true);
    mlopsApi.datasetRows(masterDataset.dataset_id, { sample_rows: 6 })
      .then((res) => {
        if (!alive) return;
        const payload = unwrapApiPayload(res) || {};
        const rows = Array.isArray(payload.preview) ? payload.preview : (Array.isArray(payload.rows) ? payload.rows : []);
        const apiColumns = Array.isArray(payload.columns)
          ? payload.columns
            .map((column) => (typeof column === 'string' ? column : String(column?.name || column?.column || '').trim()))
            .filter(Boolean)
          : [];
        const previewKeys = rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : []));
        setPreviewRows(rows);
        setPreviewColumns(apiColumns.length ? apiColumns : Array.from(new Set(previewKeys)));
      })
      .catch(() => {
        if (!alive) return;
        setPreviewRows([]);
        setPreviewColumns([]);
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => { alive = false; };
  }, [masterDataset?.dataset_id]);

  const detectedCandidateMap = useMemo(() => candidateCatalog.reduce((acc, item) => {
    const name = String(item?.name || '').trim();
    if (name) acc[name] = item;
    return acc;
  }, {}), [candidateCatalog]);

  // Auto-select best candidate
  useEffect(() => {
    if (selected) return;
    if (!columns.length) return;

    const detectedOutcome = candidateCatalog.find((c) => isDerivedOutcomeColumn(c?.name));
    if (detectedOutcome?.name && columns.some((col) => col.name === detectedOutcome.name)) {
      setSelected(detectedOutcome.name);
      return;
    }

    const detectedRecommended = candidateCatalog.find((c) => c?.is_recommended && columns.some((col) => col.name === c.name));
    if (detectedRecommended?.name) {
      setSelected(detectedRecommended.name);
      return;
    }

    const explicitNotebookTarget = columns.find((c) =>
      NOTEBOOK_PRIORITY_TARGETS.includes(String(c.name || '').toLowerCase()),
    );
    if (explicitNotebookTarget) {
      setSelected(explicitNotebookTarget.name);
      return;
    }

    const best = [...columns].sort((a, b) => scoreColumn(b) - scoreColumn(a))[0];
    if (best && scoreColumn(best) >= 35) setSelected(best.name);
  }, [candidateCatalog, columns, selected]);

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
      .map((c) => {
        const detected = detectedCandidateMap[c.name] || null;
        return {
          ...c,
          score: Number(detected?.score ?? scoreColumn(c)),
          leak: String(detected?.leakage_risk || leakageRisk(c.name)),
          distinct_count: detected?.unique_count ?? c.distinct_count,
          missing_pct: detected?.null_pct ?? c.missing_pct,
          is_label_source: Boolean(detected?.is_label_source),
          is_recommended: Boolean(detected?.is_recommended),
          label_source_hint: detected?.label_source_hint || null,
        };
      })
      .sort((a, b) => b.score - a.score),
    [columns, detectedCandidateMap],
  );

  const topCandidates = useMemo(
    () => scored
      .filter((c) => c.score >= 35 || c.is_label_source || isDerivedOutcomeColumn(c.name))
      .slice(0, 6),
    [scored],
  );

  const selectedCandidate = useMemo(
    () => scored.find((column) => column.name === selected) || null,
    [scored, selected],
  );

  const selectedFieldRole = useMemo(
    () => getFieldRole(selectedCandidate || { name: selected }, selectedCandidate),
    [selected, selectedCandidate],
  );

  const selectedFieldRoleMeta = useMemo(
    () => getFieldRoleMeta(selectedFieldRole),
    [selectedFieldRole],
  );

  const outcomeSummary = useMemo(() => {
    const profileSummary = summarizeOutcomeCounts(detail);
    if (profileSummary) {
      return {
        targetColumn: selected,
        sourceColumn: isDerivedOutcomeColumn(selected) ? 'CASE_STATUS' : selected,
        derivedColumn: isDerivedOutcomeColumn(selected) ? selected : '',
        ...profileSummary,
      };
    }
    return outcomeMeta?.targetColumn === selected ? outcomeMeta : null;
  }, [detail, outcomeMeta, selected]);

  const labelColumns = useMemo(() => {
    const detectedLabels = scored
      .filter((column) => {
        const role = getFieldRole(column, column);
        return role === 'system_outcome' || role === 'case_decision_source';
      })
      .map((column) => column.name);
    return Array.from(new Set([
      ...(selected ? [selected] : []),
      ...detectedLabels,
    ]));
  }, [scored, selected]);

  const previewVisibleColumns = useMemo(() => {
    const sourceColumns = previewColumns.length
      ? previewColumns
      : (previewRows[0] && typeof previewRows[0] === 'object' ? Object.keys(previewRows[0]) : []);
    const highlighted = sourceColumns.filter((column) => labelColumns.includes(column));
    const supporting = sourceColumns.filter((column) => !highlighted.includes(column)).slice(0, Math.max(0, 6 - highlighted.length));
    return [...highlighted, ...supporting].slice(0, 6);
  }, [labelColumns, previewColumns, previewRows]);

  const guideRows = useMemo(() => [...scored]
    .sort((left, right) => {
      const roleWeight = (column) => {
        const role = getFieldRole(column, column);
        if (role === 'system_outcome') return 0;
        if (role === 'case_decision_source') return 1;
        if (role === 'risk_indicator') return 2;
        return 3;
      };
      const roleDiff = roleWeight(left) - roleWeight(right);
      if (roleDiff !== 0) return roleDiff;
      return (right.score || 0) - (left.score || 0);
    })
    .slice(0, 10), [scored]);

  const selectionSummary = useMemo(() => {
    if (strategy === 'generate') {
      return {
        tone: 'info',
        title: 'System-created outcome will be built from completed case decisions',
        detail: 'The system will match alerts to cases, read the final decision, convert it to Yes / No, and leave open or unresolved cases out for now.',
      };
    }
    if (strategy === 'none') {
      return {
        tone: 'warning',
        title: 'No confirmed investigation outcome has been selected',
        detail: 'Only exploratory analysis will be available until an investigation outcome is confirmed.',
      };
    }
    if (!selected) return null;

    const current = selectedCandidate;
    const provenance = selectedFieldRole === 'system_outcome'
      ? 'This is the final Yes / No investigation outcome created by the system after the master dataset step.'
      : selectedFieldRole === 'case_decision_source'
        ? 'This field contains case decisions. The system reads it and converts it into the final learning outcome.'
        : selectedFieldRole === 'risk_indicator'
          ? 'This looks like a risk indicator or predictor, not the final confirmed investigation outcome.'
          : selected === targetColumn
            ? 'This is the current outcome already attached to the master dataset.'
            : 'This field was selected from the master dataset column list.';

    return {
      tone: selectedFieldRole === 'risk_indicator' || current?.leak === 'high' ? 'warning' : 'success',
      title: `Outcome used for learning: ${selected}`,
      detail: `${provenance} Distinct values: ${fmt(current?.distinct_count)}. Dtype: ${current?.dtype || 'unknown'}.`,
    };
  }, [selected, selectedCandidate, selectedFieldRole, strategy, targetColumn]);

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
        const meta = buildOutcomeMetaFromResponse(res, col);
        if (meta) setOutcomeMeta(meta);
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
      const meta = buildOutcomeMetaFromResponse(res, resolved);
      if (meta) setOutcomeMeta(meta);
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
        <Alert severity="warning" sx={{ borderRadius: 2, flex: 1 }}>
          Build the master dataset first, then return here to confirm which completed investigation outcome the system should learn from.
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

      <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.25, bgcolor: D.panel }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Flag sx={{ color: D.orange, mt: 0.2 }} />
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.4 }}>
              {persona === 'business' ? 'Which investigation outcome should the system learn from?' : 'Investigation Outcome Configuration'}
            </Typography>
            <Typography sx={{ fontSize: 12, color: D.muted }}>
              {persona === 'business'
                ? 'This step explains how the final learning outcome is created after the master dataset is built. Choose the system-created outcome or the case decision field it comes from.'
                : 'Confirm the final investigation outcome used for learning. The screen highlights system-created labels, case decision sources, and fields that should remain predictors only.'}
            </Typography>
            {targetColumn && (
              <Chip
                icon={<CheckCircle sx={{ fontSize: 14 }} />}
                label={`Current outcome: ${targetColumn}`}
                size="small"
                variant="outlined"
                sx={{ mt: 1, bgcolor: '#fff', color: D.green, fontWeight: 700, fontSize: 11, borderColor: D.green }}
              />
            )}
            <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label="Yes = SAR filed / confirmed escalation"
                variant="outlined"
                sx={{ fontSize: 10, bgcolor: '#fff', color: D.red, fontWeight: 700, borderColor: D.redBg }}
              />
              <Chip
                size="small"
                label="No = False positive / monitoring closure"
                variant="outlined"
                sx={{ fontSize: 10, bgcolor: '#fff', color: D.green, fontWeight: 700, borderColor: D.greenBg }}
              />
              <Chip
                size="small"
                label="Not used yet = Open or unresolved"
                variant="outlined"
                sx={{ fontSize: 10, bgcolor: '#fff', color: D.blue, fontWeight: 700, borderColor: D.infoBorder }}
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
          {[
            { icon: <AutoAwesome sx={{ fontSize: 15 }} />, label: 'Choose Outcome' },
            { icon: <Lightbulb sx={{ fontSize: 15 }} />, label: 'Create Outcome' },
            { icon: <Info sx={{ fontSize: 15 }} />, label: 'Field Guide' },
          ].map((item, idx) => (
            <Tab
              key={item.label}
              icon={item.icon}
              iconPosition="start"
              label={(
                <Stack direction="row" spacing={0.65} alignItems="center">
                  <span>{item.label}</span>
                  {completedTabs.has(idx) && (
                    <CheckCircle sx={{ fontSize: 13, color: D.green }} />
                  )}
                </Stack>
              )}
            />
          ))}
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
                    <Typography sx={{ fontSize: 11, color: D.muted }}>
                      {candidateLoading ? '(refreshing from master dataset...)' : '(ranked from the master dataset and case outcome lineage)'}
                    </Typography>
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
                <InputLabel>Review another field</InputLabel>
                <Select value={selected} label="Review another field"
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

              {selected && (
                <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 1, bgcolor: '#fff' }}>
                  <Stack spacing={1.15}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                      <Box>
                        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                          {selectedFieldRole === 'risk_indicator' ? 'Field review' : 'Derived investigation outcome'}
                        </Typography>
                        <Typography sx={{ fontSize: 11.25, color: D.muted, mt: 0.35 }}>
                          The system matches alerts to cases, reads the final case decision, and converts it into a simple Yes / No outcome for learning.
                        </Typography>
                      </Box>
                      <Chip
                        label={selectedFieldRoleMeta.label}
                        size="small"
                        variant="outlined"
                        sx={{
                          fontWeight: 700,
                          fontSize: 10.5,
                          borderWidth: 1,
                          ...selectedFieldRoleMeta.chipSx,
                        }}
                      />
                    </Stack>

                    <Typography sx={{ fontSize: 11.25, color: D.text }}>
                      Created from alerts and case decisions after the master dataset is built.
                    </Typography>
                    <Chip
                      label={`Lineage: ALERT_ID → CASE_STATUS → ${selectedFieldRole === 'system_outcome' ? selected : 'FINAL_LABEL'}`}
                      size="small"
                      variant="outlined"
                      sx={{ alignSelf: 'flex-start', fontFamily: 'monospace', fontSize: 10.5, bgcolor: '#fff' }}
                    />

                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label="Yes = led to SAR filing or confirmed escalation" sx={{ bgcolor: D.redBg, color: D.red, fontSize: 10.5 }} />
                      <Chip size="small" label="No = closed as false positive or monitoring" sx={{ bgcolor: D.greenBg, color: D.green, fontSize: 10.5 }} />
                      <Chip size="small" label="Not used yet = case still open or unresolved" sx={{ bgcolor: D.blueBg, color: D.blue, fontSize: 10.5 }} />
                    </Stack>

                    {outcomeSummary && (
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, minmax(0, 1fr))' } }}>
                        {[
                          { label: 'Alerts with final decision', value: fmt(outcomeSummary.alertsWithFinalDecision) },
                          { label: 'Escalated / SAR filed', value: fmt(outcomeSummary.escalated) },
                          { label: 'Closed without SAR', value: fmt(outcomeSummary.closedWithoutSar) },
                          { label: 'Open / not used', value: fmt(outcomeSummary.openOrNotUsed) },
                        ].map((item) => (
                          <Paper key={item.label} variant="outlined" sx={{ p: 1, borderRadius: 1, bgcolor: D.panelAlt }}>
                            <Typography sx={{ fontSize: 10, color: D.muted, fontWeight: 700 }}>{item.label}</Typography>
                            <Typography sx={{ fontWeight: 800, fontSize: 20, mt: 0.3 }}>{item.value}</Typography>
                          </Paper>
                        ))}
                      </Box>
                    )}

                    <Alert severity={selectedFieldRole === 'risk_indicator' ? 'warning' : 'info'} sx={{ py: 0.45, fontSize: 11 }}>
                      {selectedFieldRole === 'risk_indicator'
                        ? 'This field looks like a customer or risk indicator, not a final investigation outcome. Fields like PEP, adverse media, or correspondent bank flags should stay as predictors, not the outcome used for learning.'
                        : 'Only alerts with a completed case decision are used. Open, unresolved, or missing case outcomes are not used yet.'}
                    </Alert>
                  </Stack>
                </Paper>
              )}

              {/* Column detail */}
              <ColumnDetail colName={selected} detail={detail} loading={loadingDetail} />

              <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden', bgcolor: '#fff' }}>
                <Box sx={{ px: 1.5, py: 1.15, borderBottom: `1px solid ${D.border}`, bgcolor: D.panelAlt }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>
                    Outcome field guide
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.3 }}>
                    Outcome fields are highlighted first. Customer and risk indicators stay secondary because they help explain alerts but are not the final investigation outcome.
                  </Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 320 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {['Field', 'How it is used', 'Why it matters here'].map((header) => (
                          <TableCell key={header} sx={{ fontSize: 10.5, fontWeight: 800, color: D.muted, bgcolor: D.panelAlt }}>
                            {header}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {guideRows.map((row) => {
                        const role = getFieldRole(row, row);
                        const roleMeta = getFieldRoleMeta(role);
                        const highlight = role === 'system_outcome' || role === 'case_decision_source';
                        const explanation = role === 'system_outcome'
                          ? 'Used as the final Yes / No outcome for learning.'
                          : role === 'case_decision_source'
                            ? 'Read from the case record and converted into the final learning outcome.'
                            : role === 'risk_indicator'
                              ? 'Customer or alert indicator only. Helpful for prediction, not the final outcome.'
                              : 'Review whether this is truly a completed case decision before using it as an outcome.';
                        return (
                          <TableRow
                            key={row.name}
                            hover
                            selected={row.name === selected}
                            sx={{
                              '& td': {
                                bgcolor: row.name === selected ? D.orangeLight : (highlight ? '#f8fbff' : '#fff'),
                              },
                            }}>
                            <TableCell sx={{ minWidth: 200 }}>
                              <Stack spacing={0.5}>
                                <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11.5 }}>
                                  {row.name}
                                </Typography>
                                <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                                  <Chip
                                    size="small"
                                    label={roleMeta.label}
                                    variant="outlined"
                                    sx={{ fontSize: 9.5, height: 20, ...roleMeta.chipSx }}
                                  />
                                  {row.name === selected && (
                                    <Chip size="small" label="Selected" sx={{ fontSize: 9.5, height: 20, bgcolor: D.orange, color: '#fff' }} />
                                  )}
                                </Stack>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ width: 220 }}>
                              <Typography sx={{ fontSize: 11, color: D.text }}>{roleMeta.description}</Typography>
                            </TableCell>
                            <TableCell sx={{ minWidth: 260 }}>
                              <Typography sx={{ fontSize: 11, color: D.muted }}>{row.label_source_hint || explanation}</Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden', bgcolor: '#fff' }}>
                <Box sx={{ px: 1.5, py: 1.15, borderBottom: `1px solid ${D.border}`, bgcolor: D.panelAlt }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>
                    Master dataset sample
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.3 }}>
                    Highlighted columns show the investigation outcome lineage inside the master dataset preview.
                  </Typography>
                </Box>
                {previewLoading ? (
                  <Box sx={{ py: 2.5, textAlign: 'center' }}>
                    <CircularProgress size={22} sx={{ color: D.orange }} />
                  </Box>
                ) : previewVisibleColumns.length && previewRows.length ? (
                  <TableContainer sx={{ maxHeight: 320 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {previewVisibleColumns.map((column) => {
                            const highlighted = labelColumns.includes(column);
                            return (
                              <TableCell
                                key={column}
                                sx={{
                                  fontFamily: 'monospace',
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  bgcolor: highlighted ? D.blueBg : D.panelAlt,
                                  color: highlighted ? D.blue : D.text,
                                  borderBottom: `1px solid ${highlighted ? D.infoBorder : D.border}`,
                                }}>
                                {column}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewRows.slice(0, 6).map((row, index) => (
                          <TableRow key={`preview-row-${index}`} hover>
                            {previewVisibleColumns.map((column) => {
                              const highlighted = labelColumns.includes(column);
                              return (
                                <TableCell
                                  key={`preview-cell-${index}-${column}`}
                                  sx={{
                                    fontSize: 11,
                                    bgcolor: highlighted ? '#f8fbff' : '#fff',
                                    fontFamily: highlighted ? 'monospace' : 'inherit',
                                  }}>
                                  {getPreviewCellText(row?.[column])}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info" sx={{ m: 1.25, fontSize: 11.5 }}>
                    Preview rows are not available yet for this master dataset.
                  </Alert>
                )}
              </Paper>
            </Stack>
          )}

          {/* ── Tab 1: STR / Generate ── */}
          {tab === 1 && (
            <Stack spacing={2}>
              <STRExplanation />

              <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 1, bgcolor: '#fff' }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>
                  Choose how the outcome should be created
                </Typography>
                <Stack spacing={1}>
                  {[
                    {
                      value: 'existing',
                      label: 'Use an existing system-created outcome column',
                      desc: 'Best when the master dataset already includes FINAL_LABEL, IS_TRUE_POS, or STR_LABEL.',
                      recommended: true,
                    },
                    {
                      value: 'generate',
                      label: 'Create the outcome from case decisions',
                      desc: 'Match alerts to cases, read the final case decision, and create the Yes / No learning outcome automatically.',
                      recommended: false,
                    },
                    {
                      value: 'none',
                      label: 'Continue without a confirmed outcome',
                      desc: 'Continue without a final investigation outcome. Only exploratory analysis will be available.',
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
                  Select the existing final outcome field from the <strong>Choose Outcome</strong> tab.
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
                ? `Confirm "${selected}" as the investigation outcome`
                : strategy === 'generate'
                ? 'Create the system outcome from case decisions'
                : 'Continue without a confirmed outcome'}
            </Typography>
            {selected && strategy === 'existing' && (
              <Typography sx={{ fontSize: 11, color: D.muted }}>
                This field will be treated as the outcome used for learning and excluded from predictor features.
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
            Confirm Outcome and Continue
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
