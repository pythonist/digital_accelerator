/**
 * DeploymentDashboard.jsx
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Post-deployment monitoring dashboard for the AML MLOps Workbench.
 *
 * Business view  â€” Plain English: what is being suppressed, how many alerts
 *                  vs cases, is event loss under control, what changed week
 *                  over week.
 *
 * Technical view â€” Model lineage DAG, AUC/F1/Precision/Recall, drift PSI,
 *                  suppression ledger table with scores and top features.
 *
 * Props
 * â”€â”€â”€â”€â”€
 *   persona         'business' | 'technical'
 *   activeModelRun  Full run object from ModelTrainingPanel
 *   validationReport Validation result object
 *   registryEntry   Registry row (has deployment_id, threshold, stage)
 *   onBack          () => void â€” go back to pipeline
 *
 * Design tokens: dark chrome top bar, PwC orange (#D04A02), white cards.
 * No emojis. MUI icons only.
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccountTree,
  ArrowBack,
  ArrowForward,
  Assessment,
  BarChart,
  CheckCircle,
  Close,
  CloudDone,
  Download,
  ErrorOutline,
  Gavel,
  Info,
  Notifications,
  NotificationsOff,
  QueryStats,
  Refresh,
  Shield,
  TableChart,
  Timeline,
  WarningAmber,
} from '@mui/icons-material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';
import { useAppContext } from '../../../context/AppContext';
import { persistFccSentinelHandoff } from '../../../utils/fccSentinelHandoff';

// â”€â”€ Design tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const D = {
  orange:      '#D04A02',
  orangeHover: '#b83d00',
  orangeLight: '#fff1ec',
  green:       '#166534',
  greenLight:  '#f3faf6',
  amber:       '#b45309',
  amberLight:  '#fffbeb',
  red:         '#b91c1c',
  redLight:    '#fef6f6',
  blue:        '#1d4ed8',
  blueLight:   '#f3f7ff',
  border:      '#e2e8f0',
  borderSoft:  '#edf2f7',
  muted:       '#64748b',
  text:        '#1e293b',
  canvas:      '#f5f6f8',
};

const DEPLOYMENT_TAB = {
  LIVE: 0,
  MONITORING: 1,
  DRIFT: 2,
  LEDGER: 3,
  LINEAGE: 4,
};

// â”€â”€ Tiny helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EMPTY_VALUE = '-';
const fmt = (n, options = { maximumFractionDigits: 0 }) => {
  const value = Number(n);
  return (n == null || Number.isNaN(value)) ? EMPTY_VALUE : value.toLocaleString(undefined, options);
};
const pct = (n, digits = 1) => {
  const value = Number(n);
  return (n == null || Number.isNaN(value)) ? EMPTY_VALUE : `${value.toFixed(digits)}%`;
};
const dec = (n, d = 4) => {
  const value = Number(n);
  return (n == null || Number.isNaN(value)) ? EMPTY_VALUE : value.toFixed(d);
};

const unwrap = (res) => {
  const body = res?.data ?? res;
  return body?.data ?? body;
};

const runDisplayLabel = (run = {}) => {
  const label = String(run?.label || '').trim();
  const algo = String(run?.algorithm_display || run?.algorithm || '').replace(/_/g, ' ');
  const shortId = String(run?.job_id || '').slice(0, 8);
  if (label && shortId) return `${label} (${shortId})`;
  if (label) return label;
  if (algo && shortId) return `${algo} (${shortId})`;
  if (algo) return algo;
  if (shortId) return shortId;
  return 'Model run';
};

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const titleCaseKey = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (m) => m.toUpperCase());

const runQualityFlags = (run = {}) => Array.isArray(run?.quality_flags) ? run.quality_flags : [];

const deriveEventLossFromRunMeta = (runMeta = {}) => {
  const metrics = runMeta?.metrics || runMeta?.results?.metrics || {};
  const thresholdRows = Array.isArray(metrics?.threshold_table) ? metrics.threshold_table : [];
  const preferredRow = thresholdRows.find((row) => row?.recommended || row?.is_optimal) || thresholdRows[2] || thresholdRows[0] || null;
  if (preferredRow?.event_loss_pct != null && !Number.isNaN(Number(preferredRow.event_loss_pct))) {
    return Number(preferredRow.event_loss_pct);
  }
  if (runMeta?.results?.hml_summary?.total_event_loss_pct != null && !Number.isNaN(Number(runMeta.results.hml_summary.total_event_loss_pct))) {
    return Number(runMeta.results.hml_summary.total_event_loss_pct);
  }
  return null;
};

const buildLiveBatchRecord = (data, previous = null) => {
  const prev = previous || {};
  const ingested = num(data?.scoring?.total);
  const suppressed = num(data?.scoring?.suppressed);
  const escalated = num(data?.scoring?.escalated);
  const knownPositiveRows = num(
    data?.label_summary?.evaluation_positive_rows ?? data?.label_summary?.n_positive,
  );
  const chunkLoss = data?.scoring?.event_loss_pct == null ? null : num(data?.scoring?.event_loss_pct);
  const tick = num(prev.tick) + 1;
  const cumulativeKnownPositive = num(prev.cumulative_known_positive_rows) + knownPositiveRows;
  const cumulativeSuppressed = num(prev.cumulative_suppressed) + suppressed;
  const cumulativeEscalated = num(prev.cumulative_escalated) + escalated;
  const cumulativeIngested = num(prev.cumulative_ingested) + ingested;
  const cumulativeMissed = num(prev.cumulative_missed_positive_rows)
    + Math.round((knownPositiveRows * num(chunkLoss, 0)) / 100);

  return {
    tick,
    batch_label: `B${String(tick).padStart(2, '0')}`,
    ingested,
    transformed: ingested,
    predicted: ingested,
    escalated,
    suppressed,
    avg_score: data?.scoring?.avg_score == null ? null : num(data?.scoring?.avg_score),
    event_loss_pct: chunkLoss,
    known_positive_rows: knownPositiveRows,
    cumulative_ingested: cumulativeIngested,
    cumulative_transformed: cumulativeIngested,
    cumulative_predicted: cumulativeIngested,
    cumulative_escalated: cumulativeEscalated,
    cumulative_suppressed: cumulativeSuppressed,
    cumulative_known_positive_rows: cumulativeKnownPositive,
    cumulative_missed_positive_rows: cumulativeMissed,
    cumulative_event_loss_pct: cumulativeKnownPositive > 0
      ? Number(((100 * cumulativeMissed) / cumulativeKnownPositive).toFixed(2))
      : null,
  };
};

// â”€â”€ Stat Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const StatCard = ({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
  loading = false,
  tooltip,
}) => {
  const colours = {
    good:    { bg: '#fff', border: '#cce3d4', text: D.text },
    warn:    { bg: '#fff', border: '#f2e5c2', text: D.text },
    bad:     { bg: '#fff', border: '#f0cdcd', text: D.text },
    default: { bg: '#fff', border: D.border,  text: D.text },
    blue:    { bg: '#fff', border: '#cbd9f3', text: D.text },
  };
  const c = colours[tone] || colours.default;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.9,
        borderRadius: 3,
        minWidth: 150,
        flex: '1 1 150px',
        bgcolor: c.bg,
        borderColor: c.border,
        position: 'relative',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)',
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 16px 32px rgba(15, 23, 42, 0.08)',
        },
      }}
    >
      {Icon && (
        <Icon sx={{ fontSize: 18, color: c.text, mb: 0.75, opacity: 0.82 }} />
      )}
      <Typography sx={{ fontSize: 10.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={80} height={28} />
      ) : (
        <Typography sx={{ fontSize: 19, fontWeight: 800, color: c.text, lineHeight: 1.2, mt: 0.35, fontFamily: '"IBM Plex Sans", "Inter", sans-serif' }}>
          {value}
        </Typography>
      )}
      {sub && (
        <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.4, lineHeight: 1.45 }}>
          {sub}
        </Typography>
      )}
      {tooltip && (
        <Tooltip title={tooltip} placement="top">
          <Info sx={{ fontSize: 13, color: D.muted, position: 'absolute', top: 10, right: 10 }} />
        </Tooltip>
      )}
    </Paper>
  );
};

// â”€â”€ Section header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SectionHead = ({ icon: Icon, title, sub }) => (
  <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
    {Icon && <Icon sx={{ fontSize: 18, color: D.orange }} />}
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: D.text }}>{title}</Typography>
      {sub && <Typography sx={{ fontSize: 11.5, color: D.muted }}>{sub}</Typography>}
    </Box>
  </Stack>
);

// â”€â”€ Business "What is my model doing-" explanation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BusinessExplainer = ({ alertVsCase, drift, modelGrain = 'alert' }) => {
  const grain = modelGrain === 'case' ? 'case' : 'alert';
  const row = alertVsCase?.[grain];
  const driftPct = drift?.suppression_drift_pct ?? 0;
  const driftTone = Math.abs(driftPct) <= 3 ? 'good' : Math.abs(driftPct) <= 8 ? 'warn' : 'bad';

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: D.border }}>
      <SectionHead icon={Shield} title="What is the model doing?" />
      <Stack spacing={2}>

        {/* Grain-level explanation */}
        <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, border: `1px solid ${D.borderSoft}`, borderLeft: `3px solid ${D.blue}` }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={0.75}>
            {grain === 'case'
              ? <Gavel sx={{ fontSize: 18, color: D.blue }} />
              : <Notifications sx={{ fontSize: 18, color: D.blue }} />}
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.blue }}>
              {grain === 'case' ? 'Case-Level Suppression' : 'Alert-Level Suppression'}
            </Typography>
          </Stack>
          {grain === 'case' ? (
            <Typography sx={{ fontSize: 12, color: D.text, lineHeight: 1.7 }}>
              The model reviews investigation <strong>cases</strong> only. Out of{' '}
              <strong>{fmt(row?.total)}</strong> cases scored, the model suppressed{' '}
              <strong>{fmt(row?.suppressed)}</strong> (
              <strong>{pct(row?.suppression_rate)}</strong>). The remaining{' '}
              <strong>{fmt(row?.escalated)}</strong> were escalated for investigator action.
              No alert-level decisions are shown for this case-grain model.
            </Typography>
          ) : (
            <Typography sx={{ fontSize: 12, color: D.text, lineHeight: 1.7 }}>
              The model reviews individual <strong>transaction alerts</strong> only. Out of{' '}
              <strong>{fmt(row?.total)}</strong> alerts scored, the model suppressed{' '}
              <strong>{fmt(row?.suppressed)}</strong> (
              <strong>{pct(row?.suppression_rate)}</strong>) due to insufficient suspicious signal.
              The remaining <strong>{fmt(row?.escalated)}</strong> were escalated for analyst review.
              No case-level decisions are shown for this alert-grain model.
            </Typography>
          )}
        </Box>

        {/* Drift */}
        <Box
          sx={{
            p: 2,
            bgcolor: '#fff',
            borderRadius: 2,
            border: `1px solid ${D.borderSoft}`,
            borderLeft: `3px solid ${driftTone === 'good' ? D.green : driftTone === 'warn' ? D.amber : D.red}`,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1} mb={0.75}>
            <Timeline sx={{ fontSize: 18, color: driftTone === 'good' ? D.green : driftTone === 'warn' ? D.amber : D.red }} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
              Week-over-Week Change
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 12, color: D.text, lineHeight: 1.7 }}>
            The suppression rate has{' '}
            {Math.abs(driftPct) < 0.5
              ? 'remained stable'
              : driftPct > 0
              ? `increased by ${driftPct.toFixed(1)} percentage points`
              : `decreased by ${Math.abs(driftPct).toFixed(1)} percentage points`}{' '}
            since deployment.{' '}
            {driftTone === 'good'
              ? 'This is within the acceptable monitoring band - no action required.'
              : driftTone === 'warn'
                ? 'This warrants attention. Consider reviewing whether incoming alert patterns have shifted.'
                : 'This drift is significant. Escalate to the model risk team for investigation.'}
          </Typography>
        </Box>

      </Stack>
    </Paper>
  );
};

// â”€â”€ Model Lineage DAG (visual flow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LineageDAG = ({ nodes = [], edges = [] }) => {
  const typeStyle = {
    data:       { bg: '#fff', border: '#cbd9f3', icon: 'â¬¡', color: D.blue },
    transform:  { bg: '#fff', border: D.border, icon: 'â¬¡', color: D.muted },
    model:      { bg: '#fff', border: '#f2d2c3', icon: 'â¬¡', color: D.orange },
    validation: { bg: '#fff', border: '#cce3d4', icon: 'â¬¡', color: D.green },
    decision:   { bg: '#fff', border: '#f2e5c2', icon: 'â¬¡', color: D.amber },
    deploy:     { bg: '#fff', border: '#f2d2c3', icon: 'â¬¡', color: D.orange },
    output:     { bg: '#fff', border: '#cce3d4', icon: 'â¬¡', color: D.green },
  };

  return (
    <Box sx={{ overflowX: 'auto', pb: 1 }}>
      <Stack direction="row" alignItems="center" spacing={0} sx={{ minWidth: 900 }}>
        {nodes.map((node, i) => {
          const s = typeStyle[node.type] || typeStyle.data;
          const edge = edges[i];
          return (
            <React.Fragment key={node.id}>
              <Box
                sx={{
                  bgcolor: s.bg,
                  border: `1.5px solid ${s.border}`,
                  borderRadius: 2,
                  px: 1.5,
                  py: 1.25,
                  minWidth: 140,
                  maxWidth: 160,
                  flexShrink: 0,
                }}
              >
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {node.type}
                </Typography>
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: D.text, mt: 0.25, lineHeight: 1.3 }}>
                  {node.label}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: D.muted, mt: 0.5, lineHeight: 1.4 }}>
                  {node.detail}
                </Typography>
                {node.status === 'active' && (
                  <Box sx={{
                    mt: 0.75, display: 'inline-flex', alignItems: 'center', gap: 0.4,
                    bgcolor: D.greenLight, borderRadius: 1, px: 0.75, py: 0.25,
                  }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: D.green }} />
                    <Typography sx={{ fontSize: 9.5, color: D.green, fontWeight: 700 }}>LIVE</Typography>
                  </Box>
                )}
              </Box>
              {edge && (
                <Stack alignItems="center" sx={{ px: 0.5, flexShrink: 0 }}>
                  <Typography sx={{ fontSize: 9, color: D.muted, whiteSpace: 'nowrap', mb: 0.25 }}>
                    {edge.label}
                  </Typography>
                  <ArrowForward sx={{ fontSize: 16, color: D.muted }} />
                </Stack>
              )}
            </React.Fragment>
          );
        })}
      </Stack>
    </Box>
  );
};

// â”€â”€ Suppression Ledger Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LedgerTable = ({ rows = [], loading }) => {
  const COLS = [
    { key: 'entity_id',     label: 'Entity ID',   align: 'left'  },
    { key: 'entity_type',   label: 'Level',       align: 'left'  },
    { key: 'model_score',   label: 'Score',       align: 'right' },
    { key: 'decision',      label: 'Decision',    align: 'left'  },
    { key: 'threshold',     label: 'Threshold',   align: 'right' },
    { key: 'reason_code',   label: 'Reason',      align: 'left'  },
    { key: 'top_features',  label: 'Top Drivers', align: 'left'  },
    { key: 'scored_at',     label: 'Scored At',   align: 'left'  },
  ];

  if (loading) {
    return (
      <Stack spacing={0.75}>
        {[...Array(6)].map((_, i) => <Skeleton key={i} height={36} />)}
      </Stack>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align,
                  padding: '6px 10px',
                  borderBottom: `1px solid ${D.border}`,
                  fontSize: 10,
                  color: D.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const suppressed = row.decision === 'suppressed';
            return (
              <tr key={row.record_id} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11.5 }}>
                  {row.entity_id}
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <Chip
                    label={row.entity_type === 'case' ? 'CASE LEVEL' : 'ALERT LEVEL'}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: 10,
                      fontWeight: 700,
                      bgcolor: row.entity_type === 'alert' ? D.blueLight : D.greenLight,
                      color: row.entity_type === 'alert' ? D.blue : D.green,
                    }}
                  />
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: row.model_score >= row.threshold ? D.red : D.green,
                    }}
                  >
                    {dec(row.model_score, 3)}
                  </Typography>
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <Box sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    bgcolor: suppressed ? D.greenLight : D.redLight,
                    borderRadius: 1, px: 0.75, py: 0.25,
                  }}>
                      {suppressed
                        ? <NotificationsOff sx={{ fontSize: 12, color: D.green }} />
                        : <Notifications sx={{ fontSize: 12, color: D.red }} />
                      }
                    <Typography sx={{
                      fontSize: 10.5, fontWeight: 700,
                      color: suppressed ? D.green : D.red,
                    }}>
                      {suppressed ? 'Suppressed' : 'Escalated'}
                    </Typography>
                  </Box>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: D.muted }}>
                  {dec(row.threshold, 2)}
                </td>
                <td style={{ padding: '7px 10px', color: D.muted, maxWidth: 280 }}>
                  <Typography sx={{ fontSize: 11, color: D.muted, lineHeight: 1.4 }}>
                    {row.reason_code}
                  </Typography>
                </td>
                <td style={{ padding: '7px 10px', color: D.muted, maxWidth: 280 }}>
                  <Typography sx={{ fontSize: 11, color: D.muted, lineHeight: 1.4 }}>
                    {(row.top_features || [])
                      .slice(0, 2)
                      .map((f) => `${f.feature}${f.contribution != null ? ` (${dec(f.contribution, 3)})` : ''}`)
                      .join(', ') || '-'}
                  </Typography>
                </td>
                <td style={{ padding: '7px 10px', color: D.muted, whiteSpace: 'nowrap' }}>
                  <Typography sx={{ fontSize: 11, fontFamily: 'monospace' }}>
                    {String(row.scored_at).slice(0, 19).replace('T', ' ')}
                  </Typography>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: D.muted, fontSize: 12 }}>
                No records found. Score a batch first.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Box>
  );
};

// â”€â”€ Score Batch Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LiveStageStrip = ({ stages = [] }) => (
  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} useFlexGap>
    {(stages || []).map((s, idx) => (
      <Box
        key={`${s.stage}-${idx}`}
        sx={{
          flex: 1,
          minWidth: 170,
          p: 1.25,
          border: `1px solid ${D.border}`,
          borderRadius: 1.5,
          bgcolor: '#fff',
        }}
      >
        <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {s.status || 'done'}
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: D.text, fontWeight: 700, mt: 0.25 }}>
          {s.stage}
        </Typography>
        <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.4, lineHeight: 1.45 }}>
          {s.detail}
        </Typography>
      </Box>
    ))}
  </Stack>
);

const InvestigatorQueueTable = ({ rows = [] }) => (
  <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 360 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {[
            'Alert ID',
            'Case ID',
            'Entity',
            'Model',
            'Threshold',
            'Score',
            'Decision',
            'Reason',
            'Scored At',
          ].map((h) => (
            <th
              key={h}
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                borderBottom: `1px solid ${D.border}`,
                fontSize: 10,
                color: D.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(rows || []).slice(0, 40).map((r, idx) => (
          <tr key={`${r.entity_id}-${idx}`} style={{ borderBottom: `1px solid ${D.borderSoft}` }}>
            <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{r.alert_id || '-'}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{r.case_id || '-'}</td>
            <td style={{ padding: '6px 8px' }}>{String(r.entity_type || '').toUpperCase()}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{String(r.model_run_id || '').slice(0, 10)}</td>
            <td style={{ padding: '6px 8px' }}>{dec(r.threshold, 2)}</td>
            <td style={{ padding: '6px 8px' }}>{dec(r.score, 4)}</td>
            <td style={{ padding: '6px 8px' }}>{String(r.decision || '').toUpperCase()}</td>
            <td style={{ padding: '6px 8px', color: D.muted }}>{r.reason || '-'}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>
              {String(r.scored_at || '').slice(0, 19).replace('T', ' ')}
            </td>
          </tr>
        ))}
        {(!rows || rows.length === 0) && (
          <tr>
            <td colSpan={9} style={{ padding: 16, textAlign: 'center', color: D.muted }}>
              Run simulation to populate investigator queue.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </Box>
);

const PreviewTable = ({
  columns = [],
  rows = [],
  emptyMessage = 'No rows available.',
}) => {
  const renderValue = (column, value) => {
    if (value == null || value === '') return EMPTY_VALUE;
    const columnKey = String(column || '').toLowerCase();
    if (columnKey === 'decision') {
      const isEscalated = String(value).toLowerCase() === 'escalated';
      return (
        <Chip
          label={isEscalated ? 'Escalated' : 'Suppressed'}
          size="small"
          sx={{
            height: 20,
            fontSize: 10,
            fontWeight: 700,
            bgcolor: isEscalated ? D.redLight : D.greenLight,
            color: isEscalated ? D.red : D.green,
          }}
        />
      );
    }
    if (columnKey === 'queue_target') {
      return (
        <Chip
          label={String(value).replace(/_/g, ' ')}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: 10 }}
        />
      );
    }
    if (columnKey.includes('score') || columnKey.includes('threshold')) {
      return dec(value, columnKey.includes('threshold') ? 2 : 4);
    }
    if (columnKey.includes('amount')) {
      return fmt(value, { maximumFractionDigits: 2 });
    }
    if (columnKey.includes('date') || columnKey.endsWith('_at')) {
      return String(value).slice(0, 19).replace('T', ' ');
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? fmt(value) : dec(value, 2);
    }
    return String(value);
  };

  return (
    <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 360 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {(columns || []).map((column) => (
              <th
                key={column}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: `1px solid ${D.border}`,
                  fontSize: 10,
                  color: D.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  whiteSpace: 'nowrap',
                }}
              >
                {titleCaseKey(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row, index) => (
            <tr key={`preview-${index}`} style={{ borderBottom: `1px solid ${D.borderSoft}` }}>
              {(columns || []).map((column) => (
                <td key={`${index}-${column}`} style={{ padding: '6px 8px', color: D.text, whiteSpace: 'nowrap' }}>
                  {renderValue(column, row?.[column])}
                </td>
              ))}
            </tr>
          ))}
          {(!rows || rows.length === 0) && (
            <tr>
              <td colSpan={Math.max(columns.length, 1)} style={{ padding: 18, textAlign: 'center', color: D.muted }}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Box>
  );
};

const ScoreBatchDialog = ({
  open,
  onClose,
  deploymentId,
  runId,
  threshold,
  onScored,
  modelGrain = 'alert',
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const normalizedGrain = modelGrain === 'case' ? 'case' : 'alert';
  const [raw, setRaw] = useState(() => JSON.stringify(
    normalizedGrain === 'case'
      ? [
        { entity_id: 'CSE-100', entity_type: 'case', amount: 75000, cross_border: 1, velocity_7d: 12 },
        { entity_id: 'CSE-101', entity_type: 'case', amount: 40500, cross_border: 0, velocity_7d: 7 },
      ]
      : [
        { entity_id: 'ALT-001', entity_type: 'alert', amount: 15000, cross_border: 1, velocity_7d: 3 },
        { entity_id: 'ALT-002', entity_type: 'alert', amount: 850, cross_border: 0, velocity_7d: 1 },
      ],
    null,
    2,
  ));
  const [entityType, setEntityType] = useState(normalizedGrain);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const gatingMessage = actionsMessage || 'Deployment actions are blocked because this run is outdated. Rerun the upstream stages first.';

  useEffect(() => {
    setEntityType(normalizedGrain);
  }, [normalizedGrain]);

  const handleScore = async () => {
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = JSON.parse(raw);
      const res = await mlopsApi.scoreBatch({
        deployment_id: deploymentId,
        run_id: runId,
        entity_type: entityType,
        threshold: threshold,
        records,
      });
      onScored(unwrap(res));
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Score batch failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Score a New Batch</Typography>
        <IconButton size="small" onClick={onClose}><Close sx={{ fontSize: 16 }} /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Chip
              size="small"
              color="default"
              variant="outlined"
              label={`Model Grain: ${normalizedGrain.toUpperCase()}`}
            />
            <Typography sx={{ fontSize: 12, color: D.muted }}>
              Threshold: <strong>{dec(threshold, 2)}</strong> | Run: <strong>{String(runId).slice(0, 12)}...</strong>
            </Typography>
          </Stack>
          <TextField
            multiline
            minRows={10}
            maxRows={20}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            label="Records JSON array"
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={handleScore}
            disabled={actionsDisabled || canDisable(loading)}
            sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontWeight: 700 }}
          >
            {loading ? 'Scoring...' : 'Score Batch'}
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DeploymentDashboard = ({
  persona = 'business',
  activeModelRun,
  activePipelineId = null,
  activePipelineName = '',
  savedDashboardState = null,
  validationReport,
  registryEntry,
  onBack,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const navigate = useNavigate();
  const {
    activeEnv,
    loadCaseList,
    refreshPriorityBuckets,
    setActiveTool,
    setCaseScopeRemote,
  } = useAppContext();
  const propDeploymentId = registryEntry?.deployment_id || '';
  const propRunId = activeModelRun?.job_id || registryEntry?.job_id || '';
  const propThreshold = Number(
    registryEntry?.selected_threshold
    || registryEntry?.threshold
    || validationReport?.optimal_threshold
    || activeModelRun?.threshold
    || 0.5,
  );
  const propGrain = String(
    activeModelRun?.grain
    || registryEntry?.grain
    || activeModelRun?.model_grain
    || 'alert',
  ).toLowerCase() === 'case' ? 'case' : 'alert';
  const gatingMessage = actionsMessage || 'Deployment actions are blocked because this run is outdated. Rerun the upstream stages first.';
  const savedRunId = String(savedDashboardState?.run_id || '').trim();
  const savedDeploymentId = String(savedDashboardState?.deployment_id || '').trim();
  const savedThreshold = Number(savedDashboardState?.threshold ?? propThreshold ?? 0.5);
  const hasSavedPipelineBinding = Boolean(
    activePipelineId && (savedRunId || savedDeploymentId || savedDashboardState?.simulation_result),
  );

  const [activeDeployment, setActiveDeployment] = useState(() => (
    propDeploymentId
      ? {
        deployment_id: propDeploymentId,
        job_id: propRunId || registryEntry?.job_id || '',
        threshold: propThreshold,
        grain: propGrain,
        stage: registryEntry?.stage || 'DEPLOYED',
      }
      : savedDeploymentId
        ? {
          deployment_id: savedDeploymentId,
          job_id: savedRunId,
          threshold: savedThreshold,
          grain: propGrain,
          stage: 'PIPELINE_SAVED',
        }
      : null
  ));
  const [runOptions, setRunOptions] = useState([]);
  const [runOptionsLoading, setRunOptionsLoading] = useState(false);
  const [runOptionsError, setRunOptionsError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(
    propRunId || savedRunId,
  );
  const [selectedThreshold, setSelectedThreshold] = useState(
    propDeploymentId ? propThreshold : savedThreshold,
  );
  const [switchingDeployment, setSwitchingDeployment] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const deploymentId = activeDeployment?.deployment_id || '';
  const runId = selectedRunId || activeDeployment?.job_id || propRunId || '';
  const selectedRunMeta = useMemo(
    () => runOptions.find((r) => String(r?.job_id || '') === String(runId || '')) || activeModelRun || null,
    [runOptions, runId, activeModelRun],
  );
  const modelGrain = String(
    selectedRunMeta?.grain
    || selectedRunMeta?.model_grain
    || activeDeployment?.grain
    || propGrain
    || 'alert',
  ).toLowerCase() === 'case' ? 'case' : 'alert';
  const grainLabel = modelGrain === 'case' ? 'Case' : 'Alert';
  const threshold = Number(
    activeDeployment?.threshold
    || selectedThreshold
    || propThreshold
    || 0.5,
  );

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [tab, setTab] = useState(DEPLOYMENT_TAB.LIVE);
  const [kpiSummary, setKpiSummary]       = useState(null);
  const [drift, setDrift]               = useState(null);
  const [alertVsCase, setAlertVsCase]   = useState(null);
  const [ledger, setLedger]             = useState(null);
  const [lineage, setLineage]           = useState(null);
  const [loading, setLoading]           = useState({});
  const [errors, setErrors]             = useState({});
  const [scoreBatchOpen, setScoreBatchOpen] = useState(false);
  const [publishingToSentinel, setPublishingToSentinel] = useState(false);
  const [openingSentinel, setOpeningSentinel] = useState(false);
  const [publishNotice, setPublishNotice] = useState(null);
  const [ledgerFilter, setLedgerFilter] = useState({ entity_type: modelGrain, decision: '' });
  const [inferRaw, setInferRaw] = useState(
    JSON.stringify(
      {
        amount: 15000,
        cross_border: 1,
        velocity_7d: 4,
        rule_triggered: 1,
      },
      null,
      2,
    ),
  );
  const [inferResult, setInferResult] = useState(null);
  const [inferError, setInferError] = useState(null);
  const [inferLoading, setInferLoading] = useState(false);
  const [simConfig, setSimConfig] = useState({
    simulation_mode: 'synthetic_pipeline',
    auto_optimize_threshold: false,
    persist_to_ledger: false,
    max_event_loss_pct: 5,
    scenario: 'steady',
    batch_size: 20,
    stream_interval_sec: 4,
    compare_runs: '',
  });
  const [simResult, setSimResult] = useState(() => (
    savedDashboardState?.simulation_result && typeof savedDashboardState.simulation_result === 'object'
      ? savedDashboardState.simulation_result
      : null
  ));
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(null);
  const [simProgressIndex, setSimProgressIndex] = useState(0);
  const [streamingActive, setStreamingActive] = useState(false);
  const [simBatchHistory, setSimBatchHistory] = useState([]);
  const [streamQueueRows, setStreamQueueRows] = useState([]);
  const [lastStreamAt, setLastStreamAt] = useState(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(30);
  const simLoopBusyRef = useRef(false);

  const setLoad = (key, val) => setLoading((p) => ({ ...p, [key]: val }));
  const setErr  = (key, val) => setErrors((p)  => ({ ...p, [key]: val }));
  const simProgressSteps = useMemo(() => ([
    'Loading model artifact',
    'Aligning feature transformations',
    'Scoring unseen entities',
    'Evaluating suppression and event loss',
    'Building investigator queue output',
  ]), []);

  useEffect(() => {
    if (!propDeploymentId) return;
    setActiveDeployment((prev) => {
      if (prev?.deployment_id === propDeploymentId && prev?.job_id === propRunId) return prev;
      return {
        deployment_id: propDeploymentId,
        job_id: propRunId || registryEntry?.job_id || '',
        threshold: propThreshold,
        grain: propGrain,
        stage: registryEntry?.stage || 'DEPLOYED',
      };
    });
  }, [propDeploymentId, propRunId, propThreshold, propGrain, registryEntry?.job_id, registryEntry?.stage]);

  useEffect(() => {
    let alive = true;
    setBootstrapping(true);
    setRunOptionsLoading(true);
    setRunOptionsError(null);
    (async () => {
      try {
        const [runsRes, activeRes] = await Promise.allSettled([
          mlopsApi.listTrainingRuns({ limit: 200 }),
          mlopsApi.getActiveDeployment(),
        ]);

        if (!alive) return;

        if (runsRes.status === 'fulfilled') {
          const rows = unwrap(runsRes.value);
          setRunOptions(Array.isArray(rows) ? rows : []);
        } else {
          setRunOptions([]);
          setRunOptionsError('Failed to load model runs');
        }

        if (activeRes.status === 'fulfilled') {
          const active = unwrap(activeRes.value);
          if (active?.deployment_id && !hasSavedPipelineBinding) {
            setActiveDeployment(active);
            setSelectedRunId(String(active.job_id || ''));
            setSelectedThreshold(Number(active.threshold ?? propThreshold ?? 0.5));
          }
        } else if (!propDeploymentId && !hasSavedPipelineBinding) {
          setRunOptionsError((prev) => prev || 'No active deployment found. Select a model run and activate deployment.');
        }
      } finally {
        if (alive) {
          setBootstrapping(false);
          setRunOptionsLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [hasSavedPipelineBinding, propDeploymentId, propThreshold]);

  useEffect(() => {
    if (!selectedRunId && activeDeployment?.job_id) {
      setSelectedRunId(String(activeDeployment.job_id));
    }
  }, [selectedRunId, activeDeployment?.job_id]);

  useEffect(() => {
    if (!selectedRunId && savedRunId) {
      setSelectedRunId(savedRunId);
    }
  }, [savedRunId, selectedRunId]);

  useEffect(() => {
    if (!savedDeploymentId || propDeploymentId) return;
    setActiveDeployment((prev) => {
      if (prev?.deployment_id === savedDeploymentId && prev?.job_id === savedRunId) {
        return prev;
      }
      return {
        deployment_id: savedDeploymentId,
        job_id: savedRunId,
        threshold: savedThreshold,
        grain: propGrain,
        stage: 'PIPELINE_SAVED',
      };
    });
  }, [propDeploymentId, propGrain, savedDeploymentId, savedRunId, savedThreshold]);

  useEffect(() => {
    if (!selectedRunId && runOptions.length > 0) {
      setSelectedRunId(String(runOptions[0]?.job_id || ''));
    }
  }, [selectedRunId, runOptions]);

  useEffect(() => {
    if (activeDeployment?.threshold == null) return;
    setSelectedThreshold(Number(activeDeployment.threshold));
  }, [activeDeployment?.threshold]);

  useEffect(() => {
    const savedSimulation = savedDashboardState?.simulation_result;
    if (!savedSimulation || typeof savedSimulation !== 'object') return;
    const savedThreshold = Number(
      savedSimulation?.scoring?.threshold_applied
      ?? savedSimulation?.scoring?.threshold
      ?? threshold
      ?? 0.5,
    );
    if (Number.isFinite(savedThreshold) && Math.abs(savedThreshold - Number(threshold || 0.5)) > 0.0001) {
      return;
    }
    const currentBatchId = String(simResult?.scoring?.batch_id || '').trim();
    const savedBatchId = String(savedSimulation?.scoring?.batch_id || '').trim();
    if (currentBatchId && savedBatchId && currentBatchId === savedBatchId) return;
    if (simResult && !savedBatchId) return;
    setSimResult(savedSimulation);
  }, [savedDashboardState?.simulation_result, simResult, threshold]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return undefined;
    if (!runId && !deploymentId && !simResult) return undefined;

    const timer = setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, {
        screen: 'dashboard',
        state: {
          pipeline_id: activePipelineId || null,
          pipeline_name: activePipelineName || '',
          run_id: runId || null,
          deployment_id: deploymentId || null,
          threshold,
          batch_id: simResult?.scoring?.batch_id || null,
          publish_id: simResult?.publish_id || savedDashboardState?.publish_id || null,
          publish_label: simResult?.publish_label || savedDashboardState?.publish_label || null,
          simulation_result: simResult || null,
        },
      }).catch(() => {});
    }, 500);

    return () => clearTimeout(timer);
  }, [
    activePipelineId,
    activePipelineName,
    deploymentId,
    runId,
    threshold,
    simResult,
    savedDashboardState?.publish_id,
    savedDashboardState?.publish_label,
  ]);

  useEffect(() => {
    setLedgerFilter((prev) => ({ ...prev, entity_type: modelGrain }));
  }, [modelGrain]);

  useEffect(() => {
    if (!simLoading) {
      setSimProgressIndex(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setSimProgressIndex((prev) => Math.min(prev + 1, simProgressSteps.length - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [simLoading, simProgressSteps.length]);

  // â”€â”€ Data fetchers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchKpis = useCallback(async () => {
    if (!deploymentId) return;
    setLoad('kpis', true);
    setErr('kpis', null);
    try {
      const res = await mlopsApi.deploymentKpis({
        deployment_id: deploymentId,
        run_id: runId || null,
        model_grain: modelGrain,
        n_weeks: 8,
        include_simulation: false,
      });
      setKpiSummary(unwrap(res));
    } catch (e) {
      setErr('kpis', e?.response?.data?.error || 'Failed to load KPI summary');
      setKpiSummary(null);
    } finally {
      setLoad('kpis', false);
    }
  }, [deploymentId, runId, modelGrain]);

  const fetchDrift = useCallback(async () => {
    if (!deploymentId) return;
    setLoad('drift', true); setErr('drift', null);
    try {
      const res = await mlopsApi.deploymentDrift({
        deployment_id: deploymentId,
        run_id: runId || null,
        model_grain: modelGrain,
        include_simulation: false,
      });
      setDrift(unwrap(res));
    } catch (e) {
      setErr('drift', e?.response?.data?.error || 'Failed to load drift stats');
    } finally {
      setLoad('drift', false);
    }
  }, [deploymentId, runId, modelGrain]);

  const fetchAlertVsCase = useCallback(async () => {
    if (!deploymentId) return;
    setLoad('avc', true); setErr('avc', null);
    try {
      const res = await mlopsApi.alertVsCase({
        deployment_id: deploymentId,
        run_id: runId || null,
        model_grain: modelGrain,
        include_simulation: false,
      });
      setAlertVsCase(unwrap(res));
    } catch (e) {
      setErr('avc', e?.response?.data?.error || 'Failed to load alert/case split');
      setAlertVsCase({
        model_grain: modelGrain,
        [modelGrain]: {
          entity_type: modelGrain,
          total: 0,
          suppressed: 0,
          escalated: 0,
          suppression_rate: 0,
          avg_score: 0,
          first_scored: '-',
          last_scored: '-',
        },
      });
    } finally {
      setLoad('avc', false);
    }
  }, [deploymentId, runId, modelGrain]);

  const fetchLedger = useCallback(async () => {
    if (!deploymentId) return;
    setLoad('ledger', true); setErr('ledger', null);
    try {
      const params = new URLSearchParams({
        deployment_id: deploymentId,
        limit: 100,
        ...(runId ? { run_id: runId } : {}),
        entity_type: ledgerFilter.entity_type || modelGrain,
        ...(ledgerFilter.decision ? { decision: ledgerFilter.decision } : {}),
      });
      const res = await mlopsApi.suppressionLedger(params.toString(), { include_simulation: false });
      setLedger(unwrap(res));
    } catch (e) {
      setErr('ledger', e?.response?.data?.error || 'Failed to load ledger');
    } finally {
      setLoad('ledger', false);
    }
  }, [deploymentId, runId, modelGrain, ledgerFilter]);

  const fetchLineage = useCallback(async () => {
    if (!runId) return;
    setLoad('lineage', true); setErr('lineage', null);
    try {
      const res = await mlopsApi.modelLineage({
        run_id: runId,
        deployment_id: deploymentId,
        run_meta: { ...(activeModelRun || {}), grain: modelGrain },
      });
      setLineage(unwrap(res));
    } catch (e) {
      setErr('lineage', e?.response?.data?.error || 'Failed to load lineage');
    } finally {
      setLoad('lineage', false);
    }
  }, [runId, deploymentId, activeModelRun, modelGrain]);

  const runInferenceExplain = useCallback(async () => {
    if (!runId) return;
    if (actionsDisabled) {
      setInferError(gatingMessage);
      return;
    }
    setInferLoading(true);
    setInferError(null);
    try {
      const record = JSON.parse(inferRaw || '{}');
      const res = await mlopsApi.inferenceExplain({
        run_id: runId,
        record,
        threshold,
        top_n: 8,
      });
      setInferResult(unwrap(res));
    } catch (e) {
      setInferError(e?.response?.data?.error || e?.message || 'Failed to run inference explain');
    } finally {
      setInferLoading(false);
    }
  }, [actionsDisabled, gatingMessage, runId, inferRaw, threshold]);

  const appendStreamBatch = useCallback((data) => {
    setSimBatchHistory((prev) => {
      const nextRecord = buildLiveBatchRecord(data, prev[prev.length - 1] || null);
      return [...prev, nextRecord].slice(-40);
    });
    setStreamQueueRows((prev) => ([...(data?.investigator_queue || []), ...prev]).slice(0, 150));
    setLastStreamAt(new Date().toISOString());
  }, []);

  const executeLiveSimulation = useCallback(async ({
    batchSizeOverride = null,
    compareRunIdsOverride = null,
    seedOverride = null,
    simulationModeOverride = null,
    persistToLedgerOverride = null,
    autoOptimizeThresholdOverride = null,
  } = {}) => {
    const compareRunIds = Array.isArray(compareRunIdsOverride)
      ? compareRunIdsOverride
      : String(simConfig.compare_runs || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const res = await mlopsApi.liveSimulate({
      deployment_id: deploymentId,
      run_id: runId,
      pipeline_id: activePipelineId,
      pipeline_name: activePipelineName,
      threshold,
      simulation_mode: simulationModeOverride || simConfig.simulation_mode,
      persist_to_ledger: persistToLedgerOverride == null
        ? !!simConfig.persist_to_ledger
        : !!persistToLedgerOverride,
      auto_optimize_threshold: false,
      max_event_loss_pct: Number(simConfig.max_event_loss_pct || 5),
      scenario: simConfig.scenario,
      batch_size: Number((batchSizeOverride ?? simConfig.batch_size) || 20),
      compare_run_ids: compareRunIds,
      ...(seedOverride != null ? { seed: seedOverride } : {}),
    });
    return unwrap(res);
  }, [activePipelineId, activePipelineName, deploymentId, runId, threshold, simConfig]);

  const runLiveSimulation = useCallback(async () => {
    if (!deploymentId || !runId) return;
    if (actionsDisabled) {
      setSimError(gatingMessage);
      return;
    }
    setStreamingActive(false);
    setSimBatchHistory([]);
    setStreamQueueRows([]);
    setLastStreamAt(null);
    setSimLoading(true);
    setSimError(null);
    try {
      const data = await executeLiveSimulation();
      setSimResult(data);
      if (simConfig.persist_to_ledger) {
        fetchKpis();
        fetchDrift();
        fetchAlertVsCase();
        fetchLedger();
      }
    } catch (e) {
      setSimError(e?.response?.data?.error || e?.message || 'Failed to run live simulation');
    } finally {
      setSimLoading(false);
    }
  }, [actionsDisabled, gatingMessage, deploymentId, runId, simConfig.persist_to_ledger, executeLiveSimulation, fetchKpis, fetchAlertVsCase, fetchDrift, fetchLedger]);

  const seedDeploymentLedger = useCallback(async (nextDeploymentId, nextRunId, nextThreshold) => {
    if (!nextDeploymentId || !nextRunId) return null;
    const res = await mlopsApi.liveSimulate({
      deployment_id: nextDeploymentId,
      run_id: nextRunId,
      threshold: Number(nextThreshold || 0.5),
      simulation_mode: 'synthetic_pipeline',
      persist_to_ledger: true,
      auto_optimize_threshold: false,
      max_event_loss_pct: Number(simConfig.max_event_loss_pct || 5),
      scenario: simConfig.scenario || 'steady',
      batch_size: Number(simConfig.batch_size || 20),
      compare_run_ids: [],
    });
    return unwrap(res);
  }, [simConfig.batch_size, simConfig.max_event_loss_pct, simConfig.scenario]);

  const activateSelectedDeployment = useCallback(async () => {
    if (!selectedRunId) return;
    if (actionsDisabled) {
      setSwitchError(gatingMessage);
      return;
    }
    setSwitchingDeployment(true);
    setSwitchError(null);
    try {
      const res = await mlopsApi.swapDeployment({
        new_job_id: selectedRunId,
        threshold: Number(selectedThreshold || threshold || 0.5),
        deployment_name: `dashboard_${String(selectedRunId).slice(0, 8)}`,
        entity_type: modelGrain,
      });
      const dep = unwrap(res);
      setActiveDeployment(dep || null);
      setSimResult(null);
      if (dep?.deployment_id) {
        const seeded = await seedDeploymentLedger(
          dep.deployment_id,
          selectedRunId,
          Number(selectedThreshold || threshold || 0.5),
        );
        if (seeded) {
          setSimResult(seeded);
          appendStreamBatch(seeded);
        }
      }
      await Promise.all([fetchKpis(), fetchDrift(), fetchAlertVsCase()]);
      if (tab === DEPLOYMENT_TAB.LEDGER) await fetchLedger();
      if (tab === DEPLOYMENT_TAB.LINEAGE) await fetchLineage();
    } catch (e) {
      setSwitchError(e?.response?.data?.error || e?.message || 'Failed to activate selected model deployment');
    } finally {
      setSwitchingDeployment(false);
    }
  }, [
    actionsDisabled,
    gatingMessage,
    selectedRunId,
    selectedThreshold,
    threshold,
    modelGrain,
    seedDeploymentLedger,
    appendStreamBatch,
    fetchKpis,
    fetchDrift,
    fetchAlertVsCase,
    fetchLedger,
    fetchLineage,
    tab,
  ]);

  useEffect(() => {
    fetchKpis();
    fetchDrift();
    fetchAlertVsCase();
  }, [fetchKpis, fetchDrift, fetchAlertVsCase]);

  useEffect(() => {
    if (tab === DEPLOYMENT_TAB.LEDGER) fetchLedger();
  }, [tab, fetchLedger]);

  useEffect(() => {
    if (tab === DEPLOYMENT_TAB.LINEAGE) fetchLineage();
  }, [tab, fetchLineage]);

  useEffect(() => {
    if (!autoRefreshEnabled || !deploymentId || !runId) return undefined;
    const intervalMs = Math.max(5, Number(autoRefreshSeconds) || 30) * 1000;
    const timer = setInterval(() => {
      fetchKpis();
      fetchDrift();
      fetchAlertVsCase();
      if (tab === DEPLOYMENT_TAB.LEDGER) fetchLedger();
      if (tab === DEPLOYMENT_TAB.LINEAGE) fetchLineage();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [
    autoRefreshEnabled,
    autoRefreshSeconds,
    deploymentId,
    runId,
    tab,
    fetchKpis,
    fetchDrift,
    fetchAlertVsCase,
    fetchLedger,
    fetchLineage,
  ]);

  useEffect(() => {
    if (!streamingActive || !deploymentId || !runId) return undefined;
    let cancelled = false;
    const intervalMs = Math.max(2, Number(simConfig.stream_interval_sec) || 4) * 1000;

    const runStreamCycle = async () => {
      if (cancelled || simLoopBusyRef.current) return;
      simLoopBusyRef.current = true;
      setSimLoading(true);
      setSimError(null);
      try {
        const data = await executeLiveSimulation({
          batchSizeOverride: Number(simConfig.batch_size || 20),
          compareRunIdsOverride: [],
          seedOverride: Date.now() % 1000000,
        });
        if (cancelled) return;
        setSimResult(data);
        appendStreamBatch(data);
        if (simConfig.persist_to_ledger) {
          fetchKpis();
          fetchDrift();
          fetchAlertVsCase();
          if (tab === DEPLOYMENT_TAB.LEDGER) fetchLedger();
        }
      } catch (e) {
        if (!cancelled) {
          setSimError(e?.response?.data?.error || e?.message || 'Failed to run live simulation');
        }
      } finally {
        simLoopBusyRef.current = false;
        if (!cancelled) setSimLoading(false);
      }
    };

    runStreamCycle();
    const timer = setInterval(runStreamCycle, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      simLoopBusyRef.current = false;
    };
  }, [
    streamingActive,
    deploymentId,
    runId,
    simConfig.stream_interval_sec,
    simConfig.batch_size,
    simConfig.persist_to_ledger,
    executeLiveSimulation,
    appendStreamBatch,
    fetchKpis,
    fetchDrift,
    fetchAlertVsCase,
    fetchLedger,
    tab,
  ]);

  // â”€â”€ Derived metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const metrics = selectedRunMeta?.metrics || selectedRunMeta?.results?.metrics || activeModelRun?.metrics || {};
  const avcReady = !!alertVsCase && !loading.avc;
  const grainRow = avcReady ? (alertVsCase?.[modelGrain] || null) : null;
  const totalSuppressed = kpiSummary?.total_suppressed ?? grainRow?.suppressed ?? null;
  const totalScored = kpiSummary?.total_scored ?? grainRow?.total ?? null;
  const totalEscalated = kpiSummary?.total_escalated ?? grainRow?.escalated ?? null;
  const productionReady = Number(totalScored || 0) > 0;
  const overallSupprRate = kpiSummary?.suppression_rate_pct != null
    ? Number(kpiSummary.suppression_rate_pct)
    : ((totalScored != null && totalScored > 0 && totalSuppressed != null)
      ? (100 * totalSuppressed / totalScored)
      : null);
  const latestEventLoss = kpiSummary?.latest_event_loss_pct
    ?? drift?.windows?.[drift?.windows?.length - 1]?.event_loss_pct
    ?? deriveEventLossFromRunMeta(selectedRunMeta || activeModelRun || {});
  const estimatedHoursSaved = (totalSuppressed != null && totalSuppressed > 0) ? (totalSuppressed * 12) / 60 : null; // 12 min analyst review baseline

  const driftWindows = drift?.windows || [];
  const suppressionDriftPct = kpiSummary?.suppression_drift_pct ?? drift?.suppression_drift_pct ?? 0;
  const driftTone = Math.abs(suppressionDriftPct) <= 3 ? 'good'
    : Math.abs(suppressionDriftPct) <= 8 ? 'warn' : 'bad';
  const kpiError = errors.kpis || errors.avc || errors.drift || null;
  const liveQueue = simResult?.investigator_queue || [];
  const simOOT = simResult?.oot_validation || null;
  const simLabelledRows = simResult?.label_summary?.evaluation_labelled_rows
    ?? simResult?.label_summary?.labelled_rows
    ?? null;
  const simPositiveRows = simResult?.label_summary?.evaluation_positive_rows
    ?? simResult?.label_summary?.n_positive
    ?? null;
  const simExcludedRows = simResult?.label_summary?.excluded_rows ?? null;
  const simEventLossBasis = simResult?.label_summary?.event_loss_basis || 'estimated_labels';
  const simEventLossDefined = simResult?.label_summary?.evaluation_event_loss_defined != null
    ? !!simResult?.label_summary?.evaluation_event_loss_defined
    : Number(simPositiveRows || 0) > 0;
  const simEventLossValue = simEventLossDefined
    ? simResult?.scoring?.event_loss_pct
    : null;
  const simPersistedToLedger = !!(simResult?.persisted_to_ledger || simResult?.scoring?.persisted_to_ledger);
  const simFlow = simResult?.flow_stream || [];
  const simThresholdApplied = simResult?.scoring?.threshold_applied ?? simResult?.scoring?.threshold ?? threshold;
  const simHasOOT = !!simOOT?.defined;
  const effectiveSimFlow = simBatchHistory.length > 0 ? simBatchHistory : simFlow;
  const effectiveLiveQueue = streamQueueRows.length > 0 ? streamQueueRows : liveQueue;
  const streamSummary = simBatchHistory.length > 0 ? simBatchHistory[simBatchHistory.length - 1] : null;
  const simHealth = simResult?.simulation_health || null;
  const simHealthFlags = Array.isArray(simHealth?.flags) ? simHealth.flags : [];
  const simLeakageFeatures = Array.isArray(simHealth?.leakage_features) ? simHealth.leakage_features : [];
  const simPreviewTables = simResult?.preview_tables || {};
  const simMasterPreview = simPreviewTables?.master_data || { columns: [], rows: [] };
  const simPreparedPreview = simPreviewTables?.prepared_features || { columns: [], rows: [] };
  const simPredictionPreview = simPreviewTables?.prediction_output || { columns: [], rows: [] };
  const simRetainedPreview = simPreviewTables?.retained_queue || { columns: [], rows: [] };
  const simSuppressedPreview = simPreviewTables?.suppressed_queue || { columns: [], rows: [] };
  const liveRunModeLabel = streamingActive ? 'Continuous stream' : 'Single batch';
  const effectiveLiveGenerated = streamSummary?.ingested ?? simResult?.scoring?.total ?? null;
  const effectiveLiveSuppressed = streamSummary?.suppressed ?? simResult?.scoring?.suppressed ?? null;
  const effectiveLiveEscalated = streamSummary?.escalated ?? simResult?.scoring?.escalated ?? null;
  const effectiveLiveSuppressionRate = streamSummary
    ? (num(streamSummary.ingested) > 0 ? (100 * num(streamSummary.suppressed)) / num(streamSummary.ingested) : null)
    : simResult?.scoring?.suppression_rate;
  const usingLiveHeadlineMetrics = tab === DEPLOYMENT_TAB.LIVE && Number(effectiveLiveGenerated || 0) > 0;
  const headlineScored = usingLiveHeadlineMetrics ? effectiveLiveGenerated : totalScored;
  const headlineSuppressed = usingLiveHeadlineMetrics ? effectiveLiveSuppressed : totalSuppressed;
  const headlineEscalated = usingLiveHeadlineMetrics ? effectiveLiveEscalated : totalEscalated;
  const headlineSuppressionRate = usingLiveHeadlineMetrics ? effectiveLiveSuppressionRate : overallSupprRate;
  const headlineEventLoss = usingLiveHeadlineMetrics ? simEventLossValue : latestEventLoss;
  const headlineReady = Number(headlineScored || 0) > 0;
  const liveDecisionFlow = useMemo(() => ([
    {
      key: 'generated',
      title: 'Incoming alert-like batch',
      detail: 'Synthetic unseen records generated inside FCC to mimic fresh operational volume.',
      count: effectiveLiveGenerated,
      value: fmt(effectiveLiveGenerated),
      tone: D.blue,
      sub: simResult?.source?.dataset || 'synthetic source',
    },
    {
      key: 'scored',
      title: 'Scored by FCC model',
      detail: 'Records aligned to the trained feature layout and scored at the approved operating threshold.',
      count: streamSummary?.predicted ?? simResult?.scoring?.total ?? effectiveLiveGenerated,
      value: fmt(streamSummary?.predicted ?? simResult?.scoring?.total ?? effectiveLiveGenerated),
      tone: '#5b21b6',
      sub: `Threshold ${dec(simThresholdApplied, 2)}`,
    },
    {
      key: 'suppressed',
      title: 'Suppressed in FCC',
      detail: 'Lower-signal alerts stopped before investigator review to reduce false-positive workload.',
      count: effectiveLiveSuppressed,
      value: fmt(effectiveLiveSuppressed),
      tone: D.green,
      sub: effectiveLiveSuppressionRate == null ? 'Suppression pending' : pct(effectiveLiveSuppressionRate),
    },
    {
      key: 'retained',
      title: 'Retained for Sentinel',
      detail: 'Higher-risk alerts or cases preserved for downstream investigation in Sentinel.',
      count: effectiveLiveEscalated,
      value: fmt(effectiveLiveEscalated),
      tone: D.orange,
      sub: effectiveLiveEscalated > 0 ? 'Ready for handoff' : 'No retained queue yet',
    },
  ]), [
    effectiveLiveEscalated,
    effectiveLiveGenerated,
    effectiveLiveSuppressed,
    effectiveLiveSuppressionRate,
    simResult?.scoring?.total,
    simResult?.source?.dataset,
    simThresholdApplied,
    streamSummary?.predicted,
  ]);
  const liveDecisionBars = useMemo(() => (
    liveDecisionFlow.map((item) => ({
      stage: item.title.replace(' alert-like batch', ''),
      count: num(item.count, 0),
      fill: item.tone,
    }))
  ), [liveDecisionFlow]);
  const deploymentTabMeta = useMemo(() => ([
    {
      key: DEPLOYMENT_TAB.LIVE,
      title: 'Live Simulation',
      subtitle: 'Simulate new unseen alert-like batches, score them in FCC, suppress low-signal volume, and show what reaches Sentinel.',
    },
    {
      key: DEPLOYMENT_TAB.MONITORING,
      title: 'Deployment Monitoring',
      subtitle: 'Track business-facing operational KPIs after scoring has happened and understand ongoing analyst workload reduction.',
    },
    {
      key: DEPLOYMENT_TAB.DRIFT,
      title: 'Drift & Trends',
      subtitle: 'Watch for changes in incoming alert behavior, score distributions, and suppression patterns over time.',
    },
    {
      key: DEPLOYMENT_TAB.LEDGER,
      title: 'Suppression Ledger',
      subtitle: 'Review the detailed audit trail of which entities were scored, suppressed, retained, and why.',
    },
    {
      key: DEPLOYMENT_TAB.LINEAGE,
      title: 'Model Lineage',
      subtitle: 'Trace which training run, validation threshold, preprocessing logic, and deployment record produced the live outcome.',
    },
  ]), []);
  const activeTabMeta = deploymentTabMeta.find((item) => item.key === tab) || deploymentTabMeta[0];
  const selectedRunFlags = runQualityFlags(selectedRunMeta);
  const selectedRunLeakage = Array.isArray(selectedRunMeta?.leakage_features) ? selectedRunMeta.leakage_features : [];
  const recommendedDemoRun = useMemo(
    () => (runOptions || []).find((run) => !runQualityFlags(run).includes('label_leakage_features_present')) || null,
    [runOptions],
  );

  const publishRetainedQueue = useCallback(async ({ batchId = null, publishLabel = null } = {}) => {
    if (!deploymentId || !runId) return;
    setPublishingToSentinel(true);
    setPublishNotice(null);
    try {
      const res = await mlopsApi.publishToSentinel({
        ...(batchId ? { batch_id: batchId } : {}),
        deployment_id: deploymentId,
        run_id: runId,
        ...(activePipelineId ? { pipeline_id: activePipelineId } : {}),
        ...(activePipelineName ? { pipeline_name: activePipelineName } : {}),
        ...(publishLabel ? { publish_label: publishLabel } : {}),
      });
      const body = unwrap(res);
      const payload = body?.publish || body || {};
      setPublishNotice({
        severity: 'success',
        message: `Published ${fmt(payload?.published_rows)} retained ${grainLabel.toLowerCase()} records to Sentinel package ${String(payload?.publish_id || '').slice(0, 12)}.`,
      });
      return payload;
    } catch (err) {
      setPublishNotice({
        severity: 'error',
        message: err?.message || 'Failed to publish retained FCC queue to Sentinel.',
      });
      throw err;
    } finally {
      setPublishingToSentinel(false);
    }
  }, [activePipelineId, activePipelineName, deploymentId, grainLabel, runId]);

  const openSentinelCaseManager = useCallback(async () => {
    if (!deploymentId || !runId) return;
    if (actionsDisabled) {
      setPublishNotice({
        severity: 'warning',
        message: gatingMessage,
      });
      return;
    }

    setOpeningSentinel(true);
    setPublishNotice(null);

    try {
      const handoffRes = await mlopsApi.handoffToSentinel({
        deployment_id: deploymentId,
        run_id: runId,
        batch_id: simResult?.scoring?.batch_id || undefined,
        threshold: simThresholdApplied ?? threshold,
        simulation_mode: 'synthetic_pipeline',
        persist_to_ledger: true,
        auto_optimize_threshold: false,
        scenario: simConfig.scenario,
        batch_size: Number(simResult?.scoring?.total || simConfig.batch_size || 20),
        compare_run_ids: [],
        seed: simResult?.scoring?.batch_id ? undefined : (Date.now() % 1000000),
        pipeline_id: activePipelineId || undefined,
        pipeline_name: activePipelineName || undefined,
        preferred_screen: 'fcc_bridge',
        replace_existing: true,
        merge_existing: false,
        rerank_after_import: true,
        force_refresh: false,
      });
      const handoffBody = unwrap(handoffRes);
      const handoffPayload = handoffBody?.handoff || handoffBody?.workflow_session?.handoff_summary || {};
      const workflowSession = handoffBody?.workflow_session || null;
      const simulation = handoffBody?.simulation || null;
      if (simulation) {
        setSimResult(simulation);
        appendStreamBatch(simulation);
      }
      await Promise.all([fetchKpis(), fetchDrift(), fetchAlertVsCase(), fetchLedger(), loadCaseList(true), refreshPriorityBuckets()]);

      persistFccSentinelHandoff({
        ...handoffPayload,
        preferred_screen: handoffPayload?.preferred_screen || 'fcc_bridge',
        pipeline_id: handoffPayload?.pipeline_id ?? activePipelineId ?? null,
        pipeline_name: handoffPayload?.pipeline_name ?? activePipelineName ?? null,
        run_id: handoffPayload?.run_id ?? runId,
        deployment_id: handoffPayload?.deployment_id ?? deploymentId,
        workflow_session_id: workflowSession?.session_id || handoffPayload?.workflow_session_id || null,
      });

      setPublishNotice({
        severity: 'success',
        message: handoffBody?.reused
          ? `Reopened Sentinel from saved FCC handoff ${String(handoffPayload?.publish_id || '').slice(0, 12)}.`
          : `Opened Sentinel with ${fmt(handoffPayload?.imported_case_count)} retained ${grainLabel.toLowerCase()} records from FCC package ${String(handoffPayload?.publish_id || '').slice(0, 12)}.`,
      });

      setActiveTool('investigation');
      navigate('/investigation');
    } catch (err) {
      setPublishNotice({
        severity: 'error',
        message: err?.message || 'Failed to open Sentinel with FCC retained cases.',
      });
    } finally {
      setOpeningSentinel(false);
    }
  }, [
    actionsDisabled,
    activeEnv,
    activePipelineId,
    activePipelineName,
    appendStreamBatch,
    deploymentId,
    fetchAlertVsCase,
    fetchDrift,
    fetchKpis,
    fetchLedger,
    gatingMessage,
    loadCaseList,
    navigate,
    refreshPriorityBuckets,
    runId,
    simConfig.scenario,
    simResult,
    simThresholdApplied,
    setActiveTool,
    simConfig.batch_size,
    threshold,
  ]);

  // â”€â”€ Download report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const downloadReport = async () => {
    if (!runId) return;
    try {
      const blob = await mlopsApi.downloadReportPdf({
        run_id: runId,
        pipeline_id: activePipelineId || undefined,
        strict_min_pages: true,
        audience: 'technical',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(activePipelineName || 'fcc_workbench').replace(/[^a-zA-Z0-9_-]+/g, '_')}_fcc_report.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPublishNotice({
        severity: 'error',
        message: err?.message || 'Failed to download the FCC report.',
      });
    }
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <Box sx={{ bgcolor: D.canvas, minHeight: '100%', p: 0 }}>

      {/* Header bar */}
      <Box sx={{
        px: 3, py: 1.5,
        bgcolor: '#fff',
        borderBottom: `1px solid ${D.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          {onBack && (
            <IconButton size="small" onClick={onBack}>
              <ArrowBack sx={{ fontSize: 18, color: D.muted }} />
            </IconButton>
          )}
          <CloudDone sx={{ fontSize: 22, color: D.orange }} />
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: D.text }}>
              Deployment Dashboard
            </Typography>
            <Typography sx={{ fontSize: 11, color: D.muted }}>
              {deploymentId
                ? `${activePipelineName ? `${activePipelineName} | ` : ''}Deployment ${deploymentId.slice(0, 12)}... - Threshold ${dec(threshold, 2)}`
                : 'No active deployment selected'}
            </Typography>
          </Box>
          {activePipelineName ? (
            <Chip
              label={`Pipeline ${activePipelineName}`}
              size="small"
              sx={{ bgcolor: D.blueLight, color: D.blue, border: `1px solid ${D.border}` }}
            />
          ) : null}
          <Chip
            label={String(activeDeployment?.status || activeDeployment?.stage || registryEntry?.stage || 'DEPLOYED').toUpperCase()}
            size="small"
            sx={{
              bgcolor: deploymentId ? D.greenLight : '#f8fafc',
              color: deploymentId ? D.green : D.muted,
              fontWeight: 700,
              fontSize: 10,
              height: 22,
            }}
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Refresh sx={{ fontSize: 15 }} />}
            onClick={() => { fetchKpis(); fetchDrift(); fetchAlertVsCase(); }}
            disabled={canDisable(!deploymentId || !runId || bootstrapping)}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            Refresh
          </Button>
          <Select
            size="small"
            value={String(autoRefreshSeconds)}
            onChange={(e) => setAutoRefreshSeconds(Number(e.target.value || 30))}
            disabled={canDisable(!deploymentId || !runId)}
            sx={{ minWidth: 102, fontSize: 12 }}
          >
            <MenuItem value="15">15s</MenuItem>
            <MenuItem value="30">30s</MenuItem>
            <MenuItem value="60">60s</MenuItem>
          </Select>
          <Button
            size="small"
            variant={autoRefreshEnabled ? 'contained' : 'outlined'}
            onClick={() => setAutoRefreshEnabled((prev) => !prev)}
            disabled={canDisable(!deploymentId || !runId)}
            sx={{
              textTransform: 'none',
              fontSize: 12,
              bgcolor: autoRefreshEnabled ? D.orange : undefined,
              '&:hover': autoRefreshEnabled ? { bgcolor: D.orangeHover } : undefined,
            }}
          >
            {autoRefreshEnabled ? `Auto ${autoRefreshSeconds}s` : 'Auto Off'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<BarChart sx={{ fontSize: 15 }} />}
            onClick={() => setScoreBatchOpen(true)}
            disabled={actionsDisabled || canDisable(!deploymentId || !runId)}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            Score Batch
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ArrowForward sx={{ fontSize: 15 }} />}
            onClick={publishRetainedQueue}
            disabled={publishingToSentinel || actionsDisabled || canDisable(!deploymentId || !runId)}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            {publishingToSentinel ? 'Publishing...' : 'Send To Sentinel'}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={openingSentinel ? <CircularProgress size={14} color="inherit" /> : <ArrowForward sx={{ fontSize: 15 }} />}
            onClick={openSentinelCaseManager}
            disabled={openingSentinel || publishingToSentinel || actionsDisabled || canDisable(!deploymentId || !runId)}
            sx={{ bgcolor: D.blue, '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontSize: 12, fontWeight: 700 }}
          >
            {openingSentinel ? 'Opening Sentinel...' : 'Open Case Manager Sentinel'}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<Download sx={{ fontSize: 15 }} />}
            onClick={downloadReport}
            disabled={canDisable(!deploymentId || !runId)}
            sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontSize: 12, fontWeight: 700 }}
          >
            Export JSON Snapshot
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: 3, pt: 1.75 }}>
        {actionsDisabled && (
          <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>
            {gatingMessage}
          </Alert>
        )}
        {publishNotice && (
          <Alert severity={publishNotice.severity} sx={{ mb: 1.5, borderRadius: 2 }}>
            {publishNotice.message}
          </Alert>
        )}
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: 3,
            borderColor: D.border,
            bgcolor: '#ffffffcc',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Stack spacing={1.25}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ lg: 'center' }}>
              <Box sx={{ minWidth: 280 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: D.text }}>
                  Model / Deployment Selection
                </Typography>
                <Typography sx={{ fontSize: 11, color: D.muted }}>
                  Choose which trained run to activate and monitor on this dashboard.
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ width: '100%' }}>
                <Select
                  size="small"
                  value={selectedRunId}
                  onChange={(e) => setSelectedRunId(String(e.target.value || ''))}
                  sx={{ minWidth: 260, fontSize: 12, flex: 1 }}
                  disabled={canDisable(runOptionsLoading || switchingDeployment)}
                  displayEmpty
                >
                  <MenuItem value="">
                    <em>Select model run</em>
                  </MenuItem>
                  {(runOptions || []).map((run) => (
                    <MenuItem key={run.job_id} value={run.job_id}>
                      {runDisplayLabel(run)}
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  size="small"
                  type="number"
                  label="Deployment threshold"
                  value={selectedThreshold}
                  onChange={(e) => setSelectedThreshold(e.target.value)}
                  sx={{ width: 170 }}
                  inputProps={{ min: 0, max: 1, step: 0.01 }}
                  disabled
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={activateSelectedDeployment}
                  disabled={actionsDisabled || canDisable(!selectedRunId || switchingDeployment)}
                  sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontWeight: 700, minWidth: 190 }}
                >
                  {switchingDeployment ? 'Activating...' : 'Activate Deployment'}
                </Button>
              </Stack>
            </Stack>
            {bootstrapping && <Skeleton height={22} />}
            {runOptionsError && <Alert severity="warning">{runOptionsError}</Alert>}
            {switchError && <Alert severity="error">{switchError}</Alert>}
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              The deployment threshold is locked from Model Release and remains immutable downstream. To change it, run validation and create a new approved release rather than editing live FCC scoring.
            </Alert>
            {selectedRunFlags.includes('label_leakage_features_present') && (
              <Alert
                severity="warning"
                sx={{ borderRadius: 2 }}
                action={recommendedDemoRun ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      setSelectedRunId(String(recommendedDemoRun.job_id || ''));
                      setSelectedThreshold(Number(
                        recommendedDemoRun.selected_threshold
                        ?? recommendedDemoRun.optimal_threshold
                        ?? threshold
                        ?? 0.5,
                      ));
                    }}
                  >
                    Use Demo-Safe Suggestion
                  </Button>
                ) : undefined}
              >
                The selected run uses label-like training features{selectedRunLeakage.length > 0 ? ` (${selectedRunLeakage.join(', ')})` : ''},
                so unseen-batch simulation metrics are not trustworthy for a business demo.
                {recommendedDemoRun ? ` Suggested run: ${runDisplayLabel(recommendedDemoRun)}.` : ''}
              </Alert>
            )}
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              <strong>Live Simulation</strong> is the primary FCC deployment sandbox for client demos and unseen-batch testing.
              <strong> Deployment Monitoring</strong> stays focused on production-style KPI tracking after scoring has happened, and
              <strong> Persist to ledger</strong> controls whether simulated retained rows are written into the operational ledger.
            </Alert>
          </Stack>
        </Paper>
      </Box>

      {/* KPI strip */}
      <Box sx={{ px: 3, py: 2 }}>
        {kpiError && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  fetchKpis();
                  fetchDrift();
                  fetchAlertVsCase();
                }}
              >
                Retry
              </Button>
            )}
          >
            KPI feed error: {kpiError}
          </Alert>
        )}
        <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
          <StatCard
            icon={NotificationsOff}
            label={usingLiveHeadlineMetrics ? 'Current Batch Suppressed' : 'Production Suppressed'}
            value={headlineReady ? fmt(headlineSuppressed) : '-'}
            sub={headlineReady ? `of ${fmt(headlineScored)} scored` : 'No production-scored rows yet'}
            tone="default"
            loading={loading.kpis || loading.avc || bootstrapping}
            tooltip={`${grainLabel} entities the model decided not to escalate`}
          />
          <StatCard
            icon={Shield}
            label={usingLiveHeadlineMetrics ? 'Current Batch Suppression Rate' : 'Production Suppression Rate'}
            value={headlineReady ? pct(headlineSuppressionRate) : '-'}
            sub={headlineReady ? `${grainLabel.toLowerCase()}-grain model` : 'Run the live simulation tab for unseen-batch scoring'}
            tone="default"
            loading={loading.kpis || loading.avc || bootstrapping}
          />
          <StatCard
            icon={modelGrain === 'case' ? Gavel : Notifications}
            label={usingLiveHeadlineMetrics ? `Current ${grainLabel} Retained` : `Production ${grainLabel} Suppression`}
            value={headlineReady ? (usingLiveHeadlineMetrics ? fmt(headlineEscalated) : pct(kpiSummary?.suppression_rate_pct ?? grainRow?.suppression_rate)) : '-'}
            sub={headlineReady
              ? (usingLiveHeadlineMetrics
                ? `${fmt(headlineEscalated)} ${modelGrain === 'case' ? 'cases' : 'alerts'} retained for Sentinel at threshold ${dec(simThresholdApplied, 2)}`
                : `${fmt(kpiSummary?.total_suppressed ?? grainRow?.suppressed)} ${modelGrain === 'case' ? 'cases' : 'alerts'} suppressed`)
              : 'Production view only'}
            tone="default"
            loading={loading.kpis || loading.avc || bootstrapping}
          />
          <StatCard
            icon={Timeline}
            label="Suppression Drift"
            value={(kpiSummary || drift) ? `${suppressionDriftPct > 0 ? '+' : ''}${dec(suppressionDriftPct, 1)}pp` : '-'}
            sub="since deployment (8-week)"
            tone={driftTone}
            loading={loading.kpis || loading.drift || bootstrapping}
            tooltip="Change in suppression rate from first to latest monitoring window"
          />
          <StatCard
            icon={Assessment}
            label="ROC-AUC"
            value={dec(metrics.roc_auc)}
            sub="on held-out test set"
            tone={metrics.roc_auc >= 0.6 ? 'default' : 'warn'}
          />
          <StatCard
            icon={QueryStats}
            label={usingLiveHeadlineMetrics ? 'Current Batch Event Loss' : 'Latest Production Event Loss'}
            value={headlineReady ? pct(headlineEventLoss) : '-'}
            sub={headlineReady
              ? (usingLiveHeadlineMetrics
                ? (simEventLossDefined ? 'estimated missed true SARs on current batch' : 'event loss unavailable for current batch')
                : 'missed true SARs (latest week)')
              : 'Shown when production-scored outcomes exist'}
            tone={
              (!headlineReady || headlineEventLoss == null)
                ? 'warn'
                : ((headlineEventLoss ?? 0) <= 5 ? 'good' : 'bad')
            }
            loading={loading.kpis || loading.drift || bootstrapping}
            tooltip="Percentage of true suspicious activity reports the model suppressed (ideally < 5%)"
          />
        </Stack>
      </Box>

      {/* Tabs */}
      <Box sx={{ px: 3, bgcolor: '#fff', borderBottom: `1px solid ${D.border}` }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          textColor="inherit"
          TabIndicatorProps={{ style: { backgroundColor: D.orange } }}
          sx={{ '& .MuiTab-root': { fontSize: 12, textTransform: 'none', minHeight: 42, fontWeight: 600 } }}
        >
          <Tab label="Live Simulation" icon={<CloudDone sx={{ fontSize: 15 }} />} iconPosition="start" />
          <Tab label="Deployment Monitoring" icon={<Shield sx={{ fontSize: 15 }} />} iconPosition="start" />
          <Tab label="Drift & Trends" icon={<Timeline sx={{ fontSize: 15 }} />} iconPosition="start" />
          <Tab label="Suppression Ledger" icon={<Assessment sx={{ fontSize: 15 }} />} iconPosition="start" />
          <Tab label="Model Lineage" icon={<AccountTree sx={{ fontSize: 15 }} />} iconPosition="start" />
        </Tabs>
      </Box>

      <Box sx={{ px: 3, py: 2.5 }}>
        <Paper
          variant="outlined"
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            borderColor: D.border,
            bgcolor: '#ffffffcc',
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: D.text }}>
                {activeTabMeta?.title}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: D.muted, mt: 0.25 }}>
                {activeTabMeta?.subtitle}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`Deployment ${deploymentId ? String(deploymentId).slice(0, 12) : 'not active'}`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
              <Chip size="small" label={`Model ${runDisplayLabel(selectedRunMeta || activeModelRun || {})}`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
              <Chip size="small" label={`Approved threshold ${dec(threshold, 2)}`} sx={{ bgcolor: D.orangeLight, color: D.orange, border: `1px solid #fdba74` }} />
            </Stack>
          </Stack>
        </Paper>

        {!deploymentId && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No active deployment is selected. Choose a model run above and click <strong>Activate Deployment</strong> to start monitoring.
          </Alert>
        )}

        {/* â”€â”€ Tab 0: Business Overview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {tab === DEPLOYMENT_TAB.MONITORING && (
          <Stack spacing={2.5}>
            {errors.avc && <Alert severity="warning">{errors.avc}</Alert>}
            {!loading.avc && Number(totalScored || 0) === 0 && (
              <Alert severity="info">
                No production-scored records yet for this deployment. Use <strong>Score Batch</strong> to score real
                incoming rows. Live simulation is tracked separately.
              </Alert>
            )}

            <BusinessExplainer alertVsCase={alertVsCase} drift={drift} modelGrain={modelGrain} />

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Shield}
                title="Business Outcome Snapshot"
                sub="What business objective is being achieved in production"
              />
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                <StatCard
                  label="Analyst Workload Reduced"
            value={pct(overallSupprRate)}
                  sub={`${fmt(totalSuppressed)} entities auto-suppressed`}
                  tone="default"
                />
                <StatCard
                  label="Escalations Prioritized"
                  value={fmt(totalEscalated)}
                  sub={`${modelGrain === 'case' ? 'cases' : 'alerts'} routed to investigators`}
                  tone="default"
                />
                <StatCard
                  label="Estimated Review Hours Saved"
                  value={estimatedHoursSaved != null ? `${dec(estimatedHoursSaved, 0)}h` : '-'}
                  sub="based on 12 min per manual review"
                  tone="default"
                />
                <StatCard
                  label="Latest Event Loss"
                  value={pct(latestEventLoss)}
                  sub="must remain within policy limit"
                  tone={latestEventLoss == null ? 'warn' : ((latestEventLoss ?? 0) <= 5 ? 'good' : 'bad')}
                />
              </Stack>
              <Typography sx={{ fontSize: 12, color: D.text, lineHeight: 1.7, mt: 1.5 }}>
                Business purpose: reduce investigator noise while preserving true suspicious activity capture.
                Current deployment is suppressing low-signal {modelGrain}-level volume and concentrating analyst attention on higher-risk escalations.
              </Typography>
            </Paper>

            {/* Grain-level suppression bar chart */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={BarChart}
                title={`${grainLabel} Suppression Breakdown`}
                sub={persona === 'business'
                  ? `This ${modelGrain}-grain model scores ${modelGrain}s only.`
                  : `Suppressed vs escalated ${modelGrain}-level decisions for this deployment.`}
              />
              {loading.avc ? (
                <Skeleton height={240} />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ReBarChart
                    data={[
                      {
                        name: grainLabel,
                        Suppressed: grainRow?.suppressed || 0,
                        Escalated:  grainRow?.escalated  || 0,
                      },
                    ]}
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="Suppressed" fill={D.green}  radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Escalated"  fill={D.orange} radius={[3, 3, 0, 0]} />
                  </ReBarChart>
                </ResponsiveContainer>
              )}
              <Stack direction="row" spacing={2} mt={1.5}>
                {[
                  { label: `${grainLabel} Suppression Rate`, value: pct(grainRow?.suppression_rate), tone: 'blue' },
                  { label: `${grainLabel} Avg Score`, value: dec(grainRow?.avg_score, 3), tone: 'default' },
                ].map((c) => (
                  <StatCard key={c.label} label={c.label} value={c.value} tone={c.tone} loading={loading.avc} />
                ))}
              </Stack>
            </Paper>

            {/* Business decision rule explanation */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: D.orangeLight, borderColor: '#fdba74' }}>
              <SectionHead icon={Info} title="How decisions are made" />
              <Typography sx={{ fontSize: 12.5, color: D.text, lineHeight: 1.8 }}>
                Every {modelGrain} entity is scored between <strong>0.0 and 1.0</strong> - the probability
                the activity is suspicious. If the score is <strong>below the threshold
                of {dec(threshold, 2)}</strong>, the model suppresses the entity (no analyst review
                needed). If the score is <strong>at or above {dec(threshold, 2)}</strong>, the entity
                is escalated for analyst review. This threshold was selected to keep event
                loss (missed true SARs) under the agreed regulatory limit.
              </Typography>
              <Stack direction="row" spacing={1.5} mt={1.5} flexWrap="wrap" useFlexGap>
                <Box sx={{ px: 1.5, py: 0.75, bgcolor: '#fff', borderRadius: 1.5, border: `1px solid ${D.border}`, borderLeft: `3px solid ${D.green}` }}>
                  <Typography sx={{ fontSize: 11.5, color: D.text, fontWeight: 700 }}>
                    Score &lt; {dec(threshold, 2)} then SUPPRESSED (no review)
                  </Typography>
                </Box>
                <Box sx={{ px: 1.5, py: 0.75, bgcolor: '#fff', borderRadius: 1.5, border: `1px solid ${D.border}`, borderLeft: `3px solid ${D.red}` }}>
                  <Typography sx={{ fontSize: 11.5, color: D.text, fontWeight: 700 }}>
                    Score {'>='} {dec(threshold, 2)} then ESCALATED (analyst reviews)
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Stack>
        )}

        {/* â”€â”€ Tab 1: Drift & Trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {tab === DEPLOYMENT_TAB.DRIFT && (
          <Stack spacing={2.5}>
            {errors.drift && <Alert severity="error">{errors.drift}</Alert>}

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Timeline}
                title="Suppression Rate - Week over Week"
                sub={persona === 'business'
                  ? `Is the model consistently suppressing the right volume of ${modelGrain}s over time?`
                  : 'Suppression rate and event-loss trend across monitoring windows (PSI logged where available)'}
              />
              {loading.drift ? (
                <Skeleton height={260} />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={driftWindows} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                    <defs>
                      <linearGradient id="suppGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={D.green} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={D.green} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={D.red} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={D.red} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <RTooltip />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="suppression_rate"
                      stroke={D.green}
                      fill="url(#suppGrad)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Suppression Rate %"
                    />
                    <Area
                      type="monotone"
                      dataKey="event_loss_pct"
                      stroke={D.red}
                      fill="url(#lossGrad)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Event Loss %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={BarChart}
                title={`${grainLabel} Volume - Weekly`}
                sub={`Number of ${modelGrain} entities scored per monitoring window`}
              />
              {loading.drift ? (
                <Skeleton height={220} />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ReBarChart data={driftWindows} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Legend />
                    {modelGrain === 'case' ? (
                      <Bar dataKey="case_count" fill={D.green} name="Cases" radius={[2, 2, 0, 0]} />
                    ) : (
                      <Bar dataKey="alert_count" fill={D.blue} name="Alerts" radius={[2, 2, 0, 0]} />
                    )}
                  </ReBarChart>
                </ResponsiveContainer>
              )}
            </Paper>

            {/* Drift table */}
            {!loading.drift && driftWindows.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, overflowX: 'auto' }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text, mb: 1 }}>
                  Monitoring Window Detail
                </Typography>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Week', 'Suppression %', 'Event Loss %', `${grainLabel}s`, 'PSI'].map((h) => (
                        <th key={h} style={{
                          textAlign: 'right', padding: '5px 10px',
                          borderBottom: `1px solid ${D.border}`,
                          fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {driftWindows.map((w, i) => {
                      const isLast = i === driftWindows.length - 1;
                      return (
                        <tr key={w.week} style={{
                          background: isLast ? D.orangeLight : 'transparent',
                          borderBottom: `1px solid ${D.border}`,
                        }}>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: isLast ? 700 : 400 }}>{w.week}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: D.green, fontWeight: 600 }}>{pct(w.suppression_rate)}</td>
                          <td style={{
                            padding: '5px 10px',
                            textAlign: 'right',
                            color: w.event_loss_pct == null ? D.muted : ((w.event_loss_pct ?? 0) <= 5 ? D.green : D.red),
                          }}>{pct(w.event_loss_pct)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>{fmt(modelGrain === 'case' ? w.case_count : w.alert_count)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: w.psi != null && w.psi > 0.25 ? D.red : D.muted }}>
                            {w.psi != null ? dec(w.psi, 4) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Paper>
            )}
          </Stack>
        )}

        {/* â”€â”€ Tab 2: Suppression Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {tab === DEPLOYMENT_TAB.LEDGER && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
                <SectionHead
                  icon={Assessment}
                  title="Suppression Ledger"
                  sub={`Every ${modelGrain} entity the model has scored - with decision, score, and reason`}
                />
                <Stack direction="row" spacing={1}>
                  <Select
                    size="small"
                    value={ledgerFilter.entity_type}
                    onChange={(e) => setLedgerFilter((p) => ({ ...p, entity_type: e.target.value }))}
                    displayEmpty
                    disabled
                    sx={{ minWidth: 130, fontSize: 12 }}
                  >
                    <MenuItem value={modelGrain}>{grainLabel}s</MenuItem>
                  </Select>
                  <Select
                    size="small"
                    value={ledgerFilter.decision}
                    onChange={(e) => setLedgerFilter((p) => ({ ...p, decision: e.target.value }))}
                    displayEmpty
                    sx={{ minWidth: 140, fontSize: 12 }}
                  >
                    <MenuItem value="">All decisions</MenuItem>
                    <MenuItem value="suppressed">Suppressed</MenuItem>
                    <MenuItem value="escalated">Escalated</MenuItem>
                  </Select>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={fetchLedger}
                    startIcon={<Refresh sx={{ fontSize: 14 }} />}
                    sx={{ textTransform: 'none', fontSize: 12 }}
                  >
                    Reload
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setScoreBatchOpen(true)}
                    disabled={actionsDisabled || canDisable(!deploymentId || !runId)}
                    sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontSize: 12, fontWeight: 700 }}
                  >
                    Score New Batch
                  </Button>
                </Stack>
              </Stack>
              {errors.ledger && <Alert severity="error" sx={{ mt: 1 }}>{errors.ledger}</Alert>}
              <Typography sx={{ fontSize: 11.5, color: D.muted, mt: 1, mb: 1.5 }}>
                {ledger?.total_count != null ? `${ledger.total_count} records total` : ''}{' '}
                {(ledger?.rows?.length ?? 0) > 0 ? `- showing ${ledger.rows.length}` : ''}
              </Typography>
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${grainLabel}-level suppression: ${pct(grainRow?.suppression_rate)} (${fmt(grainRow?.suppressed)} / ${fmt(grainRow?.total)})`}
                />
              </Stack>
              <LedgerTable rows={ledger?.rows || []} loading={loading.ledger} />
            </Paper>
          </Stack>
        )}

        {/* Live Pipeline */}
        {tab === DEPLOYMENT_TAB.LIVE && (
          <Stack spacing={2}>
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 3,
                borderColor: D.border,
                bgcolor: '#ffffffcc',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.04)',
              }}
            >
              <Stack spacing={1.75}>
                <SectionHead
                  icon={CloudDone}
                  title="Live Simulation"
                  sub="Simulate how newly arriving alert-like FCC records would be scored, suppressed, and handed to Sentinel before investigator review."
                />
                <Typography sx={{ fontSize: 12, color: D.text, lineHeight: 1.75 }}>
                  This operating view tells the post-training story of the FCC Workbench. Because real-time client traffic is not available yet,
                  the workbench generates synthetic unseen batches, scores them with the deployed false-positive suppression model inside FCC,
                  suppresses likely low-value alerts, and passes the retained queue to Sentinel for investigator review.
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Pipeline ${activePipelineName || 'FCC simulation'}`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
                  <Chip size="small" label={`Model ${runDisplayLabel(selectedRunMeta || activeModelRun || {})}`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
                  <Chip size="small" label={`Approved threshold ${dec(simThresholdApplied, 2)}`} sx={{ bgcolor: D.orangeLight, color: D.orange, border: `1px solid #fdba74` }} />
                  <Chip size="small" label={`Run mode ${liveRunModeLabel}`} sx={{ bgcolor: D.blueLight, color: D.blue, border: `1px solid #bfdbfe` }} />
                  <Chip size="small" label={simPersistedToLedger ? 'Ledger persistence ON' : 'Ledger persistence OFF'} sx={{ bgcolor: simPersistedToLedger ? '#fff7ed' : '#fff', color: simPersistedToLedger ? D.amber : D.text, border: `1px solid ${simPersistedToLedger ? '#fdba74' : D.border}` }} />
                </Stack>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Timeline}
                title="Simulation Controls"
                sub="Choose how synthetic unseen volume should be generated, then run a single batch or a continuous stream."
              />
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.25,
                  gridTemplateColumns: { xs: '1fr', lg: '1.4fr 0.9fr 0.9fr 1fr 1fr auto auto' },
                  alignItems: 'start',
                }}
              >
                <Select
                  size="small"
                  value={simConfig.simulation_mode}
                  onChange={(e) => setSimConfig((p) => ({ ...p, simulation_mode: e.target.value }))}
                  sx={{ minWidth: 240 }}
                >
                  <MenuItem value="synthetic_pipeline">Synthetic full pipeline (recommended)</MenuItem>
                  <MenuItem value="source_batch">Raw source batch (legacy)</MenuItem>
                </Select>
                <Select
                  size="small"
                  value={simConfig.scenario}
                  onChange={(e) => setSimConfig((p) => ({ ...p, scenario: e.target.value }))}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="steady">Steady flow</MenuItem>
                  <MenuItem value="noisy">Noisy alert mix</MenuItem>
                  <MenuItem value="drifted">Shifted behavior</MenuItem>
                  <MenuItem value="bad_data">Data quality stress</MenuItem>
                </Select>
                <TextField
                  size="small"
                  type="number"
                  label="Rows to generate"
                  value={simConfig.batch_size}
                  onChange={(e) => setSimConfig((p) => ({ ...p, batch_size: e.target.value }))}
                  sx={{ minWidth: 130 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Stream interval (sec)"
                  value={simConfig.stream_interval_sec}
                  onChange={(e) => setSimConfig((p) => ({ ...p, stream_interval_sec: e.target.value }))}
                  sx={{ minWidth: 150 }}
                />
                <TextField
                  size="small"
                  label="Compare to previous runs"
                  placeholder="Optional run IDs"
                  value={simConfig.compare_runs}
                  onChange={(e) => setSimConfig((p) => ({ ...p, compare_runs: e.target.value }))}
                  sx={{ minWidth: 220 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={runLiveSimulation}
                  disabled={actionsDisabled || canDisable(!runId || !deploymentId || simLoading)}
                  sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontWeight: 700, height: 36, minWidth: 140 }}
                >
                  {simLoading ? 'Running...' : 'Run single batch'}
                </Button>
                <Button
                  size="small"
                  variant={streamingActive ? 'outlined' : 'contained'}
                  onClick={() => {
                    if (streamingActive) {
                      setStreamingActive(false);
                      return;
                    }
                    setSimError(null);
                    setSimBatchHistory([]);
                    setStreamQueueRows([]);
                    setLastStreamAt(null);
                    setStreamingActive(true);
                  }}
                  disabled={actionsDisabled || canDisable(!runId || !deploymentId)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    height: 36,
                    minWidth: 150,
                    borderColor: D.border,
                    color: streamingActive ? D.text : '#fff',
                    bgcolor: streamingActive ? '#fff' : D.blue,
                    '&:hover': streamingActive ? { borderColor: D.blue, bgcolor: D.blueLight } : { bgcolor: '#1e40af' },
                  }}
                >
                  {streamingActive ? 'Stop live stream' : 'Start live stream'}
                </Button>
              </Box>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} useFlexGap mt={1.25}>
                <Select
                  size="small"
                  value={simConfig.persist_to_ledger ? 'yes' : 'no'}
                  onChange={(e) => setSimConfig((p) => ({ ...p, persist_to_ledger: e.target.value === 'yes' }))}
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="no">Do not persist simulation to ledger</MenuItem>
                  <MenuItem value="yes">Persist retained queue to ledger</MenuItem>
                </Select>
                <Alert severity="info" sx={{ minWidth: 360, flex: 1 }}>
                  Live simulation and Sentinel handoff always use the locked approved threshold {dec(threshold, 2)}. If new unseen data suggests a different cutoff, take that back into validation and release governance.
                </Alert>
              </Stack>
              <Alert severity="info" sx={{ mt: 1.25 }}>
                Use <strong>Run single batch</strong> for a demo snapshot, or <strong>Start live stream</strong> to generate recurring micro-batches and watch the operational flow update over time.
              </Alert>
              {streamingActive && (
                <Alert severity="success" sx={{ mt: 1.25 }}>
                  Live stream active: {simBatchHistory.length} batch{simBatchHistory.length !== 1 ? 'es' : ''} generated.
                  Latest update {lastStreamAt ? new Date(lastStreamAt).toLocaleTimeString() : 'in progress'}.
                </Alert>
              )}
              {simError && <Alert severity="error" sx={{ mt: 1.25 }}>{simError}</Alert>}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Shield}
                title="This Run Summary"
                sub="Business-readable outcome from the current unseen batch or live stream."
              />
              {!simResult && !simLoading && (
                <Alert severity="info" sx={{ mb: 1.25 }}>
                  No simulation has been run yet. Configure the generation settings above, then run a batch to preview how FCC would reduce false-positive workload before Sentinel review.
                </Alert>
              )}
              {simLoading && (
                <Alert severity="info" sx={{ mb: 1.25 }}>
                  Backend progress: {simProgressSteps[simProgressIndex] || 'Running simulation'}
                </Alert>
              )}
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                <StatCard label="Rows generated" value={fmt(effectiveLiveGenerated)} sub={simResult?.source?.dataset || 'synthetic unseen batch'} tone="default" loading={simLoading && !simResult} />
                <StatCard label="Rows scored" value={fmt(streamSummary?.predicted ?? simResult?.scoring?.total)} sub={`${grainLabel} scoring inside FCC`} tone="default" loading={simLoading} />
                <StatCard label="Suppressed alerts" value={fmt(effectiveLiveSuppressed)} sub="low-signal volume stopped in FCC" tone="good" loading={simLoading} />
                <StatCard label="Retained for Sentinel" value={fmt(effectiveLiveEscalated)} sub="queue handed to investigators" tone={effectiveLiveEscalated > 0 ? 'warn' : 'default'} loading={simLoading} />
                <StatCard label="Suppression rate" value={pct(effectiveLiveSuppressionRate)} sub="false-positive workload reduced" tone="default" loading={simLoading} />
                <StatCard label="Threshold used" value={dec(simThresholdApplied, 2)} sub="locked release threshold carried downstream" tone="default" loading={simLoading} />
                <StatCard label="Run mode" value={liveRunModeLabel} sub={streamingActive ? `${fmt(simBatchHistory.length)} batches generated` : 'single-run preview'} tone="blue" loading={simLoading && !simResult} />
                <StatCard label="Known event loss" value={pct(streamSummary?.cumulative_event_loss_pct ?? simEventLossValue)} sub={simEventLossDefined ? `${fmt(simPositiveRows)} known positives observed` : 'awaiting labelled positives'} tone={simHealth?.status === 'error' ? 'warn' : (!simEventLossDefined ? 'warn' : (((streamSummary?.cumulative_event_loss_pct ?? simEventLossValue) ?? 0) <= 5 ? 'good' : 'bad'))} loading={simLoading} />
              </Stack>
              <Typography sx={{ mt: 1.25, fontSize: 11.5, color: D.muted }}>
                FCC scoring, retained queue generation, and Sentinel handoff all use the same locked threshold {dec(simThresholdApplied, 2)} from Model Release.
              </Typography>
              {simHealth && simHealth?.messages?.length > 0 && (
                <Alert severity={simHealth.status === 'error' ? 'error' : 'warning'} sx={{ mt: 1.25, borderRadius: 2 }}>
                  <strong>
                    {simHealth.status === 'error' ? 'Selected run is not demo-safe on unseen data.' : 'Simulation completed with quality warnings.'}
                  </strong>{' '}
                  {simHealth.messages[0]}
                  {simLeakageFeatures.length > 0 ? ` Leakage features detected: ${simLeakageFeatures.join(', ')}.` : ''}
                </Alert>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={ArrowForward}
                title="FCC Decision Flow"
                sub="Operational path from incoming unseen batch to FCC suppression and Sentinel handoff."
              />
              <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', xl: '1.35fr 0.9fr' } }}>
                <Box>
                  <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' } }}>
                    {liveDecisionFlow.map((item, idx) => (
                      <Box
                        key={item.key}
                        sx={{
                          p: 1.6,
                          borderRadius: 2,
                          border: `1px solid ${D.border}`,
                          bgcolor: '#fff',
                          boxShadow: '0 8px 18px rgba(15, 23, 42, 0.03)',
                        }}
                      >
                        <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                          Step {idx + 1}
                        </Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 800, color: D.text, mt: 0.35 }}>
                          {item.title}
                        </Typography>
                        <Typography sx={{ fontSize: 24, fontWeight: 800, color: item.tone, mt: 0.75 }}>
                          {item.value}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.3 }}>
                          {item.sub}
                        </Typography>
                        <Typography sx={{ fontSize: 11.25, color: D.text, mt: 0.9, lineHeight: 1.55 }}>
                          {item.detail}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ mt: 1.5 }}>
                    <LiveStageStrip
                      stages={
                        simResult?.pipeline_stages
                        || (simLoading
                          ? simProgressSteps.map((s, idx) => ({
                            stage: s,
                            status: idx < simProgressIndex ? 'done' : idx === simProgressIndex ? 'running' : 'pending',
                            detail: idx === simProgressIndex ? 'processing...' : '',
                          }))
                          : [])
                      }
                    />
                  </Box>
                </Box>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: D.border }}>
                  <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55, mb: 0.75 }}>
                    Current batch shape
                  </Typography>
                  {simLoading ? (
                    <Skeleton height={260} />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <ReBarChart data={liveDecisionBars} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="stage" tick={{ fontSize: 10 }} interval={0} angle={-10} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RTooltip />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {liveDecisionBars.map((row) => (
                            <Cell key={row.stage} fill={row.fill} />
                          ))}
                        </Bar>
                      </ReBarChart>
                    </ResponsiveContainer>
                  )}
                </Paper>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Notifications}
                title="Sentinel Handoff"
                sub="Show what FCC sent forward, what investigators will see next, and whether the run was persisted for audit."
              />
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', xl: '0.95fr 1.3fr' } }}>
                <Stack spacing={1.25}>
                  <Box sx={{ p: 1.6, borderRadius: 2, border: `1px solid ${D.border}`, bgcolor: '#fff' }}>
                    <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                      What Sentinel receives
                    </Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: D.orange, mt: 0.45 }}>
                      {fmt(effectiveLiveEscalated)}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: D.text, lineHeight: 1.6, mt: 0.65 }}>
                      Retained {grainLabel.toLowerCase()} records leave FCC and become the investigator-facing queue in Sentinel. Suppressed rows remain inside FCC and do not reach case management.
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1.6, borderRadius: 2, border: `1px solid ${D.border}`, bgcolor: '#fff' }}>
                    <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                      Operational write-back
                    </Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: simPersistedToLedger ? D.amber : D.green, mt: 0.45 }}>
                      {simPersistedToLedger ? 'Persisted' : 'Simulation only'}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: D.text, lineHeight: 1.6, mt: 0.65 }}>
                      {simPersistedToLedger
                        ? 'Retained rows were appended to the suppression ledger so the run can be audited later.'
                        : 'No production-style write occurred. This keeps the run safe for demos and scenario walkthroughs.'}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => publishRetainedQueue({
                        batchId: simResult?.scoring?.batch_id || null,
                        publishLabel: 'live_simulation',
                      })}
                      disabled={actionsDisabled || canDisable(!deploymentId || !runId || publishingToSentinel || effectiveLiveEscalated <= 0)}
                      sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontWeight: 700 }}
                    >
                      {publishingToSentinel ? 'Sending...' : 'Send retained queue to Sentinel'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={openSentinelCaseManager}
                      disabled={actionsDisabled || canDisable(!deploymentId || !runId || openingSentinel)}
                      sx={{ textTransform: 'none', fontWeight: 700, borderColor: D.blue, color: D.blue }}
                    >
                      {openingSentinel ? 'Opening...' : 'Open Sentinel case manager'}
                    </Button>
                  </Stack>
                  {publishNotice && <Alert severity={publishNotice.severity}>{publishNotice.message}</Alert>}
                </Stack>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: D.border }}>
                  <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55, mb: 1 }}>
                    Retained queue preview
                  </Typography>
                  <InvestigatorQueueTable rows={effectiveLiveQueue} />
                </Paper>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Assessment}
                title="Detailed Evidence"
                sub="Use the preview tables below when you need to explain how the unseen batch was built, scored, retained, or suppressed."
              />
              <Typography sx={{ fontSize: 11.5, color: D.muted }}>
                Start with the run summary and FCC decision flow for business conversations, then use the detailed tables below for walkthroughs, evidence, and audit support.
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Notifications}
                title="Step 1. Synthetic Master Data"
                sub="FCC creates the business-facing synthetic master records that mimic alert, customer, account, and case context"
              />
              <PreviewTable
                columns={simMasterPreview.columns || []}
                rows={simMasterPreview.rows || []}
                emptyMessage="Run simulation to generate synthetic FCC master data."
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={TableChart}
                title="Step 2. Model-Ready FCC Features"
                sub="The master data is then prepared with the same model-aligned preprocessing and feature layout used during FCC training"
              />
              <PreviewTable
                columns={simPreparedPreview.columns || []}
                rows={simPreparedPreview.rows || []}
                emptyMessage="Run simulation to preview the model-ready FCC feature set."
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={QueryStats}
                title="Step 3. FCC Prediction Output"
                sub="The generated unseen FCC rows after model scoring, thresholding, and final FCC decision"
              />
              <PreviewTable
                columns={simPredictionPreview.columns || []}
                rows={simPredictionPreview.rows || []}
                emptyMessage="Run simulation to view scored prediction output."
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={ArrowForward}
                title="Step 4. Retained Queue For Sentinel"
                sub="Only the rows not suppressed by FCC flow downstream to Sentinel"
              />
              <PreviewTable
                columns={simRetainedPreview.columns || []}
                rows={simRetainedPreview.rows || []}
                emptyMessage={simResult
                  ? 'This simulation retained no rows for Sentinel. Review the model health warning above before demoing the handoff.'
                  : 'Run simulation to preview the Sentinel handoff queue.'}
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={NotificationsOff}
                title="Stopped In FCC"
                sub="These rows were stopped in FCC and do not flow to Sentinel"
              />
              <PreviewTable
                columns={simSuppressedPreview.columns || []}
                rows={simSuppressedPreview.rows || []}
                emptyMessage="Run simulation to inspect suppressed FCC rows."
              />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Assessment}
                title="OOT Validation Snapshot"
                sub="Out-of-time validation on unseen simulation batch using known labels"
              />
              {simLoading ? (
                <Skeleton height={240} />
              ) : simHealth?.status === 'error' ? (
                <Alert severity="warning">
                  OOT validation is intentionally de-emphasized for this run because the unseen-batch scoring health check failed.
                  {simLeakageFeatures.length > 0 ? ` Leakage features detected: ${simLeakageFeatures.join(', ')}.` : ''}
                </Alert>
              ) : simHasOOT ? (
                <Stack spacing={1.75}>
                  <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                    <StatCard label="ROC-AUC" value={simOOT?.roc_auc == null ? '-' : dec(simOOT.roc_auc, 4)} />
                    <StatCard label="PR-AUC" value={simOOT?.pr_auc == null ? '-' : dec(simOOT.pr_auc, 4)} />
                    <StatCard label="Precision" value={dec(simOOT?.precision, 4)} />
                    <StatCard label="Recall" value={dec(simOOT?.recall, 4)} />
                    <StatCard label="F1 Score" value={dec(simOOT?.f1, 4)} />
                    <StatCard label="Event Loss %" value={pct(simOOT?.event_loss_pct)} tone={(simOOT?.event_loss_pct ?? 0) <= 5 ? 'good' : 'bad'} />
                  </Stack>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                      <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 1 }}>
                        Confusion Matrix
                      </Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        {[
                          { label: 'TN', value: simOOT?.confusion_matrix?.[0]?.[0] ?? 0, color: '#f8fafc' },
                          { label: 'FP', value: simOOT?.confusion_matrix?.[0]?.[1] ?? 0, color: '#fff7ed' },
                          { label: 'FN', value: simOOT?.confusion_matrix?.[1]?.[0] ?? 0, color: '#fef2f2' },
                          { label: 'TP', value: simOOT?.confusion_matrix?.[1]?.[1] ?? 0, color: '#ecfdf3' },
                        ].map((cell) => (
                          <Box key={cell.label} sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${D.border}`, bgcolor: cell.color }}>
                            <Typography sx={{ fontSize: 10, color: D.muted }}>{cell.label}</Typography>
                            <Typography sx={{ fontSize: 18, fontWeight: 800, color: D.text }}>{fmt(cell.value)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                      <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 1 }}>
                        ROC Curve
                      </Typography>
                      <ResponsiveContainer width="100%" height={170}>
                        <LineChart data={simOOT?.roc_curve || []} margin={{ top: 4, right: 12, left: -12, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="fpr" tick={{ fontSize: 10 }} />
                          <YAxis dataKey="tpr" tick={{ fontSize: 10 }} />
                          <RTooltip formatter={(v) => dec(v, 4)} />
                          <Line type="monotone" dataKey="tpr" stroke={D.orange} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                      <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 1 }}>
                        Precision-Recall Curve
                      </Typography>
                      <ResponsiveContainer width="100%" height={170}>
                        <LineChart data={simOOT?.pr_curve || []} margin={{ top: 4, right: 12, left: -12, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="recall" tick={{ fontSize: 10 }} />
                          <YAxis dataKey="precision" tick={{ fontSize: 10 }} />
                          <RTooltip formatter={(v) => dec(v, 4)} />
                          <Line type="monotone" dataKey="precision" stroke={D.blue} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Paper>
                  </Stack>
                  <Typography sx={{ fontSize: 11.5, color: D.muted }}>
                    This OOT panel uses only known labels available in the unseen batch ({fmt(simOOT?.known_rows)} rows).
                    It validates whether suppression gains are achieved without excessive event loss.
                  </Typography>
                </Stack>
              ) : (
                <Alert severity="info">
                  OOT validation metrics are not available for this run yet. Run simulation with labelled synthetic pipeline data.
                </Alert>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Timeline}
                title="Historical Comparison & Diagnostics"
                sub="Use these views to compare batches over time, review stream stability, and diagnose operational behavior."
              />
              <Typography sx={{ fontSize: 11.5, color: D.muted }}>
                The micro-batch chart below becomes meaningful once multiple batches have been generated. For a single batch, use the FCC decision flow view above because it shows the current operational split more clearly.
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={BarChart}
                title="Live Flow Stream"
                sub="Micro-batch view of ingest -> transform -> predict -> queue"
              />
              {simLoading ? (
                <Skeleton height={260} />
              ) : effectiveSimFlow.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={effectiveSimFlow} margin={{ top: 8, right: 16, left: 6, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="batch_label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Legend />
                      <Line type="monotone" dataKey="cumulative_ingested" name="Ingested" stroke={D.blue} strokeWidth={2.6} dot={effectiveSimFlow.length <= 8} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="cumulative_transformed" name="Transformed" stroke="#0f766e" strokeWidth={2.6} dot={effectiveSimFlow.length <= 8} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="cumulative_predicted" name="Predicted" stroke="#7c3aed" strokeWidth={2.6} dot={effectiveSimFlow.length <= 8} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="cumulative_escalated" name="Escalated" stroke={D.orange} strokeWidth={2.6} dot={effectiveSimFlow.length <= 8} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="cumulative_suppressed" name="Suppressed" stroke={D.green} strokeWidth={2.6} dot={effectiveSimFlow.length <= 8} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>

                  <Box sx={{ overflowX: 'auto', mt: 1.25 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                      <thead>
                        <tr>
                          {['Tick', 'Ingested', 'Transformed', 'Predicted', 'Escalated', 'Suppressed', 'Known +', 'Chunk Loss %', 'Cumulative Loss %'].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: 'right',
                                padding: '5px 8px',
                                borderBottom: `1px solid ${D.border}`,
                                fontSize: 10,
                                color: D.muted,
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveSimFlow.slice(-24).map((row) => (
                          <tr key={`flow-${row.tick}`} style={{ borderBottom: `1px solid ${D.borderSoft}` }}>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{row.batch_label}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(row.ingested)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(row.transformed)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(row.predicted)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: D.orange }}>{fmt(row.escalated)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: D.green }}>{fmt(row.suppressed)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(row.known_positive_rows)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: (row.event_loss_pct ?? 0) <= 5 ? D.green : D.red }}>
                              {pct(row.event_loss_pct)}
                            </td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: (row.cumulative_event_loss_pct ?? 0) <= 5 ? D.green : D.red }}>
                              {pct(row.cumulative_event_loss_pct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </>
              ) : (
                <Alert severity="info">Run simulation to view live flow stream.</Alert>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={Assessment}
                title="Detailed Investigator Queue Evidence"
                sub="Full row-level alert/case preview with model, threshold, score, decision, and reason"
              />
              <InvestigatorQueueTable rows={effectiveLiveQueue} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={QueryStats}
                title="Model Comparison On Same Unseen Batch"
                sub="Compare deployed run against alternate runs with identical incoming data"
              />
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Run ID', 'Primary', 'Avg Score', 'Suppression %', 'Event Loss %', 'Status'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '6px 8px',
                            borderBottom: `1px solid ${D.border}`,
                            fontSize: 10,
                            color: D.muted,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(simResult?.comparison || []).map((row, idx) => (
                      <tr key={`${row.run_id}-${idx}`} style={{ borderBottom: `1px solid ${D.borderSoft}` }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>
                          {String(row.run_id || '').slice(0, 20)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{row.is_primary ? 'Yes' : 'No'}</td>
                        <td style={{ padding: '6px 8px' }}>{row.avg_score == null ? '-' : dec(row.avg_score, 4)}</td>
                        <td style={{ padding: '6px 8px' }}>{row.suppression_rate == null ? '-' : pct(row.suppression_rate)}</td>
                        <td style={{ padding: '6px 8px' }}>{row.event_loss_pct == null ? '-' : pct(row.event_loss_pct)}</td>
                        <td style={{ padding: '6px 8px', color: row.error ? D.red : D.text }}>{row.error || 'OK'}</td>
                      </tr>
                    ))}
                    {(!simResult?.comparison || simResult.comparison.length === 0) && (
                      <tr>
                        <td colSpan={6} style={{ padding: 16, textAlign: 'center', color: D.muted }}>
                          Run simulation to compare model behavior.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Box>
            </Paper>
          </Stack>
        )}

        {tab === DEPLOYMENT_TAB.LINEAGE && (
          <Stack spacing={2.5}>
            {errors.lineage && <Alert severity="error">{errors.lineage}</Alert>}

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={AccountTree}
                title="Model Build Story"
                sub={persona === 'business'
                  ? 'End-to-end view of how this model was built - from your raw data to the live deployment'
                  : 'Model lineage DAG: data provenance -> preprocessing -> training -> validation -> deployment'}
              />
              {loading.lineage ? (
                <Skeleton height={140} />
              ) : lineage?.nodes?.length > 0 ? (
                <LineageDAG nodes={lineage.nodes} edges={lineage.edges} />
              ) : (
                <Box
                  sx={{ p: 3, textAlign: 'center', color: D.muted, bgcolor: '#f8fafc', borderRadius: 2 }}
                >
                  <AccountTree sx={{ fontSize: 36, color: D.muted, mb: 1 }} />
                  <Typography sx={{ fontSize: 12 }}>
                    Click Refresh to load the model lineage for run {runId.slice(0, 12) || '-'}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={fetchLineage}
                    sx={{ mt: 1.5, textTransform: 'none' }}
                  >
                    Load Lineage
                  </Button>
                </Box>
              )}
            </Paper>

            {/* Model metrics grid */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={QueryStats}
                title="Model Performance Summary"
                sub={persona === 'business'
                  ? 'How well does the model distinguish suspicious from normal activity?'
                  : 'Held-out test set performance metrics - used to certify the model before deployment'}
              />
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                {(lineage?.summary_cards || [
                  { label: 'Algorithm',    value: String(activeModelRun?.algorithm || '-').replace(/_/g, ' '), tone: 'default' },
                  { label: 'ROC-AUC',      value: dec(metrics.roc_auc),          tone: metrics.roc_auc >= 0.75 ? 'good' : 'warn' },
                  { label: 'F1 Score',     value: dec(metrics.f1),                tone: 'default' },
                  { label: 'Precision',    value: dec(metrics.precision),          tone: 'default' },
                  { label: 'Recall',       value: dec(metrics.recall),             tone: 'default' },
                  { label: 'CV AUC Mean',  value: dec(metrics.cv_auc_mean),       tone: 'default' },
                  { label: 'Features Used', value: String(activeModelRun?.features_used || '-'), tone: 'default' },
                  { label: 'Training Rows', value: fmt(activeModelRun?.train_rows),              tone: 'default' },
                  { label: 'Threshold',    value: dec(threshold, 2),               tone: 'default' },
                ]).map((c) => (
                  <StatCard key={c.label} label={c.label} value={c.value} tone={c.tone} />
                ))}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <SectionHead
                icon={QueryStats}
                title="Inference Explainability (SHAP/LIME)"
                sub="Score a single record and inspect local explanation drivers"
              />
              <Stack spacing={1.25}>
                <TextField
                  multiline
                  minRows={7}
                  value={inferRaw}
                  onChange={(e) => setInferRaw(e.target.value)}
                  label="Record JSON"
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                  fullWidth
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="contained"
                    onClick={runInferenceExplain}
                    disabled={actionsDisabled || canDisable(!runId || inferLoading)}
                    sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, textTransform: 'none', fontWeight: 700 }}
                  >
                    {inferLoading ? 'Running...' : 'Run Inference Explain'}
                  </Button>
                  {inferResult && (
                    <Typography sx={{ fontSize: 12, color: D.text }}>
                      Score: <strong>{dec(inferResult.score, 4)}</strong> | Decision: <strong>{String(inferResult.decision || '').toUpperCase()}</strong>
                    </Typography>
                  )}
                </Stack>

                {inferError && <Alert severity="error">{inferError}</Alert>}

                {inferResult && (
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.5 }}>
                        SHAP ({inferResult?.shap?.method || 'proxy'})
                      </Typography>
                      <Box sx={{ border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1 }}>
                        {(inferResult?.shap?.features || []).slice(0, 8).map((row, idx) => (
                          <Typography key={`${row.feature}-${idx}`} sx={{ fontSize: 11.5, color: D.text, py: 0.25 }}>
                            {row.feature}: {dec(row.shap_value, 4)}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.5 }}>
                        LIME ({inferResult?.lime?.method || 'proxy'})
                      </Typography>
                      <Box sx={{ border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1 }}>
                        {(inferResult?.lime?.features || []).slice(0, 8).map((row, idx) => (
                          <Typography key={`${row.feature}-${idx}`} sx={{ fontSize: 11.5, color: D.text, py: 0.25 }}>
                            {row.feature}: {dec(row.weight, 4)}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  </Stack>
                )}
              </Stack>
            </Paper>

            {/* What the model learned â€” business explainer */}
            {persona === 'business' && (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <SectionHead icon={Info} title="What did the model learn-" />
                <Stack spacing={1.5}>
                  <Typography sx={{ fontSize: 12.5, color: D.text, lineHeight: 1.8 }}>
                    The model was trained on <strong>{fmt(activeModelRun?.train_rows)}</strong> historical
                    records where analysts had already determined which activity was suspicious (the{' '}
                    <em>{activeModelRun?.target_column || 'target column'}</em>). It learned patterns
                    across <strong>{activeModelRun?.features_used || '-'}</strong> different data points -
                    such as transaction amounts, counterparty geography, account velocity, and
                    customer risk profile.
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: D.text, lineHeight: 1.8 }}>
                    A ROC-AUC of <strong>{dec(metrics.roc_auc)}</strong> means the model correctly
                    ranks a truly suspicious case above a genuinely safe one{' '}
                    <strong>{Math.round((metrics.roc_auc || 0.5) * 100)}% of the time</strong> -
                    compared with 50% for random chance. The threshold of{' '}
                    <strong>{dec(threshold, 2)}</strong> was then tuned to balance suppression
                    volume against the agreed maximum event-loss tolerance.
                  </Typography>
                </Stack>
              </Paper>
            )}
          </Stack>
        )}

      </Box>

      {/* Score Batch Dialog */}
      <ScoreBatchDialog
        open={scoreBatchOpen}
        onClose={() => setScoreBatchOpen(false)}
        deploymentId={deploymentId}
        runId={runId}
        threshold={threshold}
        modelGrain={modelGrain}
        actionsDisabled={actionsDisabled}
        actionsMessage={gatingMessage}
        onScored={(result) => {
          fetchAlertVsCase();
          fetchLedger();
          fetchDrift();
        }}
      />
    </Box>
  );
};

export default DeploymentDashboard;

