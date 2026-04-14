import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Archive,
  ArrowBack,
  Assessment,
  CheckCircle,
  CloudDownload,
  CloudUpload,
  CompareArrows,
  ExpandLess,
  ExpandMore,
  FactCheck,
  FileDownload,
  History,
  Lock,
  PlayArrow,
  RocketLaunch,
  Save,
  UploadFile,
  Visibility,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

const canDisable = (condition) => !ALLOW_INCOMPLETE_ACTIONS && condition;

const T = {
  orange: '#D04A02',
  orangeHover: '#B93F00',
  orangeSoft: '#FFF3EC',
  border: '#E2E8F0',
  panelSoft: '#F8FAFC',
  text: '#10233D',
  muted: '#5F6C7B',
  dim: '#8A94A5',
  danger: '#C2410C',
  dangerSoft: '#FFF1F0',
  success: '#0F7B48',
  successSoft: '#ECFDF3',
  warning: '#9A6700',
  warningSoft: '#FFF7E6',
  ink: '#233247',
  mono: '"Fira Code","Cascadia Code",monospace',
};

const unwrap = (response) => {
  const base = response?.data ?? response;
  return base?.data ?? base;
};

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampThreshold = (value, fallback = 0.5) => {
  const parsed = num(value);
  const safe = parsed == null ? fallback : parsed;
  return Math.max(0, Math.min(1, safe));
};

const pct = (value, digits = 1) => {
  const parsed = num(value);
  return parsed == null ? '-' : `${parsed.toFixed(digits)}%`;
};

const fmtMetric = (value, digits = 3) => {
  const parsed = num(value);
  return parsed == null ? '-' : parsed.toFixed(digits);
};

const fmtCount = (value) => {
  const parsed = num(value);
  return parsed == null ? '-' : parsed.toLocaleString();
};

const fmtDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const metricsForRun = (run) => run?.results?.metrics || run?.metrics || {};
const resultForRun = (run) => run?.results || run || {};
const thresholdTableForRun = (run) => asArray(metricsForRun(run)?.threshold_table || run?.threshold_table);
const featureNamesForRun = (run) => asArray(resultForRun(run)?.feature_names || run?.feature_names);

const runThreshold = (run) => clampThreshold(
  run?.selected_threshold
  ?? run?.threshold
  ?? run?.optimal_threshold
  ?? run?.hml_low_threshold
  ?? metricsForRun(run)?.optimal_threshold
  ?? metricsForRun(run)?.selected_threshold,
  0.5,
);

const getJobName = (run, registryEntry) =>
  registryEntry?.model_name
  || run?.model_name
  || run?.label
  || run?.algorithm_display
  || run?.algorithm
  || 'Current run';

const formatPipelineRunRef = (pipelineId) => {
  const parsed = Number(pipelineId);
  return Number.isFinite(parsed) && parsed > 0 ? `FCC-RUN-${String(parsed).padStart(5, '0')}` : '';
};

const deriveReleaseModelName = ({ run, registryEntry, pipelineName, pipelineId }) => {
  const explicit = getJobName(run, registryEntry);
  if (explicit && explicit !== 'Current run') return explicit;
  const pipelineLabel = String(pipelineName || '').trim() || formatPipelineRunRef(pipelineId);
  const algorithmLabel = String(run?.algorithm_display || run?.algorithm || '').trim();
  if (pipelineLabel && algorithmLabel) return `${pipelineLabel} ${algorithmLabel}`;
  return pipelineLabel || algorithmLabel || 'Current run';
};

const stageLabel = (stage) => {
  const value = String(stage || '').trim().toLowerCase();
  if (!value) return 'Not Registered';
  if (value === 'candidate') return 'Candidate Registered';
  if (value === 'challenger') return 'Candidate Registered';
  if (value === 'champion') return 'Champion Registered';
  if (value === 'archived') return 'Archived';
  if (value === 'draft') return 'Draft';
  if (value === 'deployed') return 'Deployed';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const statusTone = (value) => {
  const text = String(value || '').toLowerCase();
  if (text.includes('blocked')) return { bg: '#FEF2F2', fg: '#B42318', bd: '#FECACA' };
  if (text.includes('review')) return { bg: T.warningSoft, fg: T.warning, bd: '#F2DFAE' };
  if (text.includes('archived')) return { bg: '#F1F5F9', fg: '#475569', bd: '#CBD5E1' };
  if (text.includes('deployed') || text.includes('ready') || text.includes('champion')) return { bg: T.successSoft, fg: T.success, bd: '#BBF7D0' };
  if (text.includes('candidate') || text.includes('draft')) return { bg: T.orangeSoft, fg: T.orange, bd: '#FED7AA' };
  return { bg: T.panelSoft, fg: T.ink, bd: T.border };
};

const parseReleaseMetadata = (entry, fallbackRun) => {
  const releaseMeta = entry?.validation?.release_metadata || {};
  const tags = asArray(entry?.tags);
  const tagMap = {};
  tags.forEach((tag) => {
    const raw = String(tag || '');
    const idx = raw.indexOf(':');
    if (idx > 0) {
      const key = raw.slice(0, idx).trim().toLowerCase();
      const value = raw.slice(idx + 1).trim();
      if (key && value) tagMap[key] = value;
    }
  });
  const trainedAt = fallbackRun?.trained_at || entry?.updated_at || entry?.created_at;
  const defaultVersion = trainedAt ? `v${new Date(trainedAt).toISOString().slice(0, 10).replace(/-/g, '.')}` : 'v1.0';
  return {
    version: releaseMeta.version || tagMap.version || defaultVersion,
    owner: releaseMeta.owner || releaseMeta.requestor || tagMap.owner || tagMap.requestor || 'Unassigned',
    requestor: releaseMeta.requestor || releaseMeta.owner || tagMap.requestor || tagMap.owner || 'Unassigned',
    registrationNotes: releaseMeta.registrationNotes || entry?.notes || '',
    businessApprovalNotes: releaseMeta.businessApprovalNotes || '',
    technicalApprovalNotes: releaseMeta.technicalApprovalNotes || '',
    deploymentNotes: releaseMeta.deploymentNotes || '',
    approvalState: releaseMeta.approvalState || 'No formal approval gate configured',
    tags,
    safeRegisterWhy: releaseMeta.safeRegisterWhy || '',
    changedVsPrior: releaseMeta.changedVsPrior || '',
    preprocessingVersion: releaseMeta.preprocessingVersion || tagMap.preprocessing || '',
    artifactVersion: releaseMeta.artifactVersion || tagMap.artifact || defaultVersion,
  };
};

const findThresholdRow = (table, threshold) => {
  const rows = asArray(table).filter((row) => num(row?.threshold) != null);
  if (!rows.length) return null;
  return rows.reduce((best, row) => {
    const currentDelta = Math.abs(clampThreshold(row.threshold) - clampThreshold(threshold));
    const bestDelta = Math.abs(clampThreshold(best.threshold) - clampThreshold(threshold));
    return currentDelta < bestDelta ? row : best;
  }, rows[0]);
};

const metricsSnapshot = (run, thresholdOverride) => {
  const metrics = metricsForRun(run);
  const table = thresholdTableForRun(run);
  const threshold = clampThreshold(thresholdOverride ?? runThreshold(run));
  const selectedRow = findThresholdRow(table, threshold);
  const confusion = selectedRow?.confusion_matrix || metrics.confusion_matrix || run?.confusion_matrix || [[0, 0], [0, 0]];
  const tn = Number(confusion?.[0]?.[0] ?? selectedRow?.tn ?? 0);
  const fp = Number(confusion?.[0]?.[1] ?? selectedRow?.fp ?? 0);
  const fn = Number(confusion?.[1]?.[0] ?? selectedRow?.fn ?? 0);
  const tp = Number(confusion?.[1]?.[1] ?? selectedRow?.tp ?? 0);
  return {
    threshold,
    row: selectedRow,
    confusion,
    tn,
    fp,
    fn,
    tp,
    total: Math.max(tn + fp + fn + tp, 0),
    precision: num(selectedRow?.precision) ?? num(run?.precision) ?? num(metrics.precision),
    recall: num(selectedRow?.recall) ?? num(run?.recall) ?? num(metrics.recall),
    f1: num(selectedRow?.f1) ?? num(run?.f1) ?? num(metrics.f1),
    accuracy: num(selectedRow?.accuracy) ?? num(metrics.accuracy),
    specificity: num(selectedRow?.specificity) ?? num(run?.specificity) ?? num(metrics.specificity),
    eventLoss: num(selectedRow?.event_loss_pct ?? selectedRow?.event_loss ?? run?.event_loss_pct ?? metrics.event_loss_pct),
    suppression: num(selectedRow?.suppression_rate_pct ?? selectedRow?.suppression_rate ?? run?.suppression_rate_pct ?? metrics.suppression_rate_pct),
    rocAuc: num(run?.auc) ?? num(metrics.roc_auc),
    prAuc: num(metrics.average_precision),
  };
};

const explanationFromConfusion = ({ tp, tn, fp, fn }) => [
  {
    title: 'Correct escalations',
    label: `${fmtCount(tp)} suspicious cases were correctly sent to investigation`,
    short: 'These are actually suspicious cases, and the model kept them for review (true positive).',
  },
  {
    title: 'Correct suppressions',
    label: `${fmtCount(tn)} low-value alerts were correctly set aside`,
    short: 'These are genuinely low-risk alerts, and the model safely removed them from analyst queues (true negative).',
  },
  {
    title: 'Unnecessary reviews',
    label: `${fmtCount(fp)} alerts would still go to analysts even though they look low-risk`,
    short: 'These are alerts the model kept for review even though they are likely false positives (false positive).',
  },
  {
    title: 'Potential misses',
    label: `${fmtCount(fn)} suspicious cases could be missed at this cutoff`,
    short: 'These are genuinely suspicious cases that would be suppressed by this threshold (false negative).',
  },
];

const guardrailStatus = ({ eventLossPct, maxAllowedEventLossPct, qualityBlocking }) => {
  if (qualityBlocking) return { status: 'Blocked', detail: 'Training quality guard flagged this run for review before release.' };
  if (eventLossPct == null) return { status: 'Review Needed', detail: 'Event-loss evidence is incomplete, so release readiness cannot be confirmed yet.' };
  if (maxAllowedEventLossPct != null && eventLossPct > maxAllowedEventLossPct) {
    return { status: 'Blocked', detail: 'Potential risk miss exceeds the approved AML guardrail.' };
  }
  if (maxAllowedEventLossPct != null && eventLossPct > maxAllowedEventLossPct * 0.8) {
    return { status: 'Review Needed', detail: 'Potential risk miss is still within guardrail, but it is close enough to warrant review.' };
  }
  return { status: 'Safe', detail: 'The selected threshold stays inside the approved event-loss guardrail.' };
};

const recommendationStatus = ({ hasValidation, registryStage, guardrail, currentDeployment }) => {
  if (!hasValidation) return { badge: 'Blocked', reason: 'Validation is incomplete, so release and deployment cannot proceed yet.' };
  if (guardrail.status === 'Blocked') return { badge: 'Blocked', reason: guardrail.detail };
  if (!registryStage) return { badge: 'Ready for Registration', reason: 'Validation is complete and the run is ready to enter the governed registry.' };
  if (currentDeployment?.active) return { badge: 'Deployed', reason: 'This run already has an active production deployment with a locked threshold.' };
  if (guardrail.status === 'Review Needed') return { badge: 'Review Needed', reason: guardrail.detail };
  return { badge: 'Ready for Deployment', reason: 'Registration is in place and guardrails are satisfied for deployment review.' };
};

const resolveCurrentJobId = (activeModelRun, validationReport, registryEntry) => String(
  activeModelRun?.job_id
  || activeModelRun?.run_id
  || validationReport?.job_id
  || validationReport?.run_id
  || registryEntry?.job_id
  || registryEntry?.run_id
  || registryEntry?.entry?.run_id
  || '',
).trim();

const pickDefaultReleaseJobId = ({
  explicitJobId = '',
  trainingRuns = [],
  registryRows = [],
  activeDeployment = null,
}) => {
  const normalizedExplicit = String(explicitJobId || '').trim();
  if (normalizedExplicit) return normalizedExplicit;
  const preferredTrainingRun = (trainingRuns || []).find((row) => Boolean(row?.validation_ready || row?.resume_ready || row?.selected_threshold != null));
  if (preferredTrainingRun?.job_id) return String(preferredTrainingRun.job_id).trim();
  const latestTrainingRun = (trainingRuns || [])[0];
  if (latestTrainingRun?.job_id) return String(latestTrainingRun.job_id).trim();
  const activeDeploymentJobId = String(activeDeployment?.job_id || '').trim();
  if (activeDeploymentJobId) return activeDeploymentJobId;
  const latestRegistryJobId = String((registryRows || [])[0]?.job_id || '').trim();
  return latestRegistryJobId;
};

const buildReleaseBusinessSummaryFallback = ({
  modelName,
  algorithm,
  suppression,
  eventLoss,
  retainedRiskPct,
  threshold,
  recommendation,
  validationStatusText,
  registrationStatusText,
  deploymentStatusText,
}) => ({
  analysis_source: 'deterministic',
  llm_available: false,
  headline: `${modelName || 'This model'} is ${String(recommendation?.badge || validationStatusText || 'ready').toLowerCase()} for the next business review step`,
  executive_summary: `${modelName || 'The selected model'} uses ${algorithm || 'the trained AML scoring approach'} to reduce manual alert review volume. At the current cutoff of ${fmtMetric(threshold, 2)}, it is expected to suppress ${pct(suppression, 1)} of review load while retaining ${pct(retainedRiskPct, 1)} of suspicious-case coverage.`,
  sections: {
    what_we_built: `${modelName || 'This run'} is an AML false-positive suppression model trained to remove lower-value alerts from analyst queues while keeping higher-risk cases in review.`,
    what_we_achieved: `The current release view shows ${pct(suppression, 1)} expected suppression with ${pct(eventLoss, 1)} potential risk miss at the selected threshold.`,
    business_value: `This can reduce manual review effort, shorten queue pressure, and focus investigators on the alerts most likely to need action.`,
    next_step: recommendation?.badge === 'Ready for Registration'
      ? 'The model is ready to be registered so business and technical reviewers can approve the governed release.'
      : recommendation?.badge === 'Ready for Deployment'
        ? 'The model is already registered and can move into deployment review with the selected locked threshold.'
        : recommendation?.reason || 'Review the release evidence and decide the next governed step.',
    caution: recommendation?.reason || `Validation status is ${validationStatusText}, registration status is ${registrationStatusText}, and deployment status is ${deploymentStatusText}.`,
  },
});

const scrollToRef = (ref) => {
  if (ref?.current?.scrollIntoView) {
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

const downloadBlob = (content, filename, type = 'application/json') => {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const ThresholdLockNote = ({ deployedThreshold, deploymentName, deploymentDate }) => (
  <Box sx={{ mt: 1.25, p: 1.5, borderRadius: 2, bgcolor: '#FAFAFA', border: `1px solid ${T.border}` }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      <Lock sx={{ fontSize: 16, color: T.orange }} />
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
        Deployed threshold is locked at {fmtMetric(deployedThreshold, 2)}
      </Typography>
    </Stack>
    <Typography sx={{ fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
      This threshold is locked for the deployed version{deploymentName ? ` ${deploymentName}` : ''}. To change it, create a new release or a new deployment version instead of editing the active deployment in place.
      {deploymentDate ? ` Current version was deployed on ${fmtDate(deploymentDate)}.` : ''}
    </Typography>
  </Box>
);

const EnterpriseSection = ({ title, subtitle, children, action, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden', borderColor: T.border, boxShadow: 'none' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2.5, py: 1.9, bgcolor: '#FCFCFD', borderBottom: open ? `1px solid ${T.border}` : 'none', cursor: 'pointer' }}
        onClick={() => setOpen((value) => !value)}
      >
        <Box>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: T.text }}>{title}</Typography>
          {subtitle ? <Typography sx={{ fontSize: 12, color: T.muted, mt: 0.25 }}>{subtitle}</Typography> : null}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {action}
          <IconButton size="small">{open ? <ExpandLess /> : <ExpandMore />}</IconButton>
        </Stack>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ p: 2.5 }}>{children}</Box>
      </Collapse>
    </Paper>
  );
};

const SummaryCard = ({ label, value, helper, tone = 'default', mono = false }) => {
  const palette = tone === 'critical'
    ? { bg: T.dangerSoft, fg: T.danger, bd: '#FECACA' }
    : tone === 'positive'
      ? { bg: T.successSoft, fg: T.success, bd: '#BBF7D0' }
      : { bg: '#FFFFFF', fg: T.text, bd: T.border };
  return (
    <Box sx={{ p: 1.7, borderRadius: 1.5, border: `1px solid ${palette.bd}`, bgcolor: palette.bg, minHeight: 110 }}>
      <Typography sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.8, color: T.dim, fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography sx={{ mt: 1, fontSize: 23, lineHeight: 1.1, fontWeight: 900, color: palette.fg, fontFamily: mono ? T.mono : 'inherit' }}>
        {value}
      </Typography>
      {helper ? <Typography sx={{ mt: 1, fontSize: 11, color: T.muted, lineHeight: 1.45 }}>{helper}</Typography> : null}
    </Box>
  );
};

const StatusChip = ({ label, value }) => {
  const tone = statusTone(value);
  return (
    <Stack spacing={0.4}>
      <Typography sx={{ fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', color: T.dim, fontWeight: 700 }}>
        {label}
      </Typography>
      <Chip
        size="small"
        label={value}
        sx={{
          height: 26,
          px: 0.8,
          borderRadius: 1.5,
          bgcolor: tone.bg,
          color: tone.fg,
          border: `1px solid ${tone.bd}`,
          fontWeight: 800,
          '& .MuiChip-label': { px: 1.25 },
        }}
      />
    </Stack>
  );
};

const StepCell = ({ title, summary, status, time }) => {
  const tone = statusTone(status);
  return (
    <Box sx={{ minWidth: 200, p: 1.5, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: '#FFF' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.6 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>{title}</Typography>
        <Chip size="small" label={status} sx={{ height: 20, fontSize: 10, bgcolor: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }} />
      </Stack>
      <Typography sx={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>{summary}</Typography>
      {time ? <Typography sx={{ mt: 0.75, fontSize: 10.5, color: T.dim }}>{fmtDate(time)}</Typography> : null}
    </Box>
  );
};

const KeyValueRow = ({ label, value, helper, mono = false, highlight = false }) => (
  <Box sx={{ py: 0.95, borderBottom: `1px solid ${T.border}` }}>
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={2}>
      <Typography sx={{ fontSize: 12, color: T.muted }}>{label}</Typography>
      <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: highlight ? T.orange : T.text, fontFamily: mono ? T.mono : 'inherit', textAlign: 'right' }}>
        {value ?? '-'}
      </Typography>
    </Stack>
    {helper ? <Typography sx={{ mt: 0.35, fontSize: 10.5, color: T.dim, lineHeight: 1.45 }}>{helper}</Typography> : null}
  </Box>
);

const ConfusionExplainCard = ({ snapshot }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 2, borderColor: T.border }}>
    <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text, mb: 1.2 }}>Business-readable decision outcomes</Typography>
    <Stack spacing={1}>
      {explanationFromConfusion(snapshot).map((entry) => (
        <Box key={entry.title} sx={{ p: 1.3, borderRadius: 2, bgcolor: '#FCFCFD', border: `1px solid ${T.border}` }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>{entry.title}</Typography>
          <Typography sx={{ mt: 0.4, fontSize: 12, color: T.ink, lineHeight: 1.55 }}>{entry.label}</Typography>
          <Typography sx={{ mt: 0.45, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{entry.short}</Typography>
        </Box>
      ))}
    </Stack>
  </Paper>
);

const ThresholdTradeoffChart = ({ table, threshold }) => {
  const rows = asArray(table).filter((row) => num(row?.threshold) != null).map((row) => ({
    threshold: clampThreshold(row.threshold),
    suppression: num(row.suppression_rate_pct ?? row.suppression_rate) ?? 0,
    eventLoss: num(row.event_loss_pct ?? row.event_loss) ?? 0,
  }));
  if (!rows.length) {
    return (
      <Box sx={{ minHeight: 220, borderRadius: 2.5, border: `1px dashed ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography sx={{ fontSize: 12, color: T.muted }}>Threshold trade-off data is not available for this run yet.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8EEF5" />
          <XAxis dataKey="threshold" tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fontSize: 10, fill: T.muted }} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: T.muted }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: T.muted }} />
          <RechartsTooltip
            formatter={(value, key) => [pct(value, 1), key === 'suppression' ? 'Review reduction' : 'Potential risk miss']}
            labelFormatter={(value) => `Threshold ${Number(value).toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine x={clampThreshold(threshold)} stroke={T.orange} strokeDasharray="5 3" />
          <Line yAxisId="left" type="monotone" dataKey="suppression" name="Review reduction" stroke="#365F9C" strokeWidth={2.4} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="eventLoss" name="Potential risk miss" stroke="#D36F33" strokeWidth={2.4} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
};

const FeatureImportanceChart = ({ rows, onExplain }) => {
  const data = asArray(rows).map((row, index) => ({
    name: row.display_name || row.feature || row.name || `feature_${index + 1}`,
    importance: Math.max(num(row.importance ?? row.value ?? row.weight) ?? 0, 0),
    raw: row,
  })).slice(0, 15);
  if (!data.length) {
    return (
      <Box sx={{ minHeight: 240, borderRadius: 2.5, border: `1px dashed ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography sx={{ fontSize: 12, color: T.muted }}>Feature importance has not been stored for this run yet.</Typography>
      </Box>
    );
  }
  const maxImportance = Math.max(...data.map((row) => row.importance), 0.01);
  return (
    <Stack spacing={1.5}>
      <Box sx={{ height: Math.max(260, data.length * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EDF2F7" horizontal={false} />
            <XAxis type="number" domain={[0, maxImportance * 1.08]} tick={{ fontSize: 10, fill: T.muted }} />
            <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 10, fill: T.ink }} />
            <RechartsTooltip formatter={(value) => [fmtMetric(value, 4), 'Importance']} />
            <Bar dataKey="importance" fill="#355F9C" radius={[0, 4, 4, 0]} minPointSize={3} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        {data.slice(0, 6).map((row) => (
          <Button key={row.name} size="small" variant="outlined" onClick={() => onExplain?.(row.raw)} sx={{ textTransform: 'none', borderColor: T.border, color: T.orange }}>
            Explain {row.name}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
};

const SmallStat = ({ label, value, helper }) => (
  <Box sx={{ p: 1.45, borderRadius: 2, border: `1px solid ${T.border}`, bgcolor: '#FFF' }}>
    <Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.65, fontWeight: 700 }}>{label}</Typography>
    <Typography sx={{ mt: 0.65, fontSize: 22, fontWeight: 900, color: T.text }}>{value}</Typography>
    {helper ? <Typography sx={{ mt: 0.55, fontSize: 10.5, color: T.muted }}>{helper}</Typography> : null}
  </Box>
);

const DrawerTabPanel = ({ value, index, children }) => {
  if (value !== index) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
};

const ModelReleaseScreen = ({
  persona,
  modeStep,
  uploadedDatasets,
  masterDataset,
  targetColumn,
  preprocessedDataset,
  activeModelRun,
  validationReport,
  registryEntry,
  onRegistered,
  onDeploy,
  onViewReport,
  onBack,
  activePipelineName = '',
  activePipelineId = null,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const currentJobId = resolveCurrentJobId(activeModelRun, validationReport, registryEntry);
  const gatingMessage = actionsMessage || 'This release action is blocked because the current run is outdated. Refresh the upstream stages first.';
  const runDatasetId = Number(preprocessedDataset?.dataset_id || masterDataset?.dataset_id || 0) || null;
  const pipelineRunLabel = String(activePipelineName || '').trim() || formatPipelineRunRef(activePipelineId) || 'Current FCC run';

  const compareRef = useRef(null);
  const auditRef = useRef(null);
  const deployRef = useRef(null);
  const registryRef = useRef(null);
  const importRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [releaseError, setReleaseError] = useState(null);
  const [registryRows, setRegistryRows] = useState([]);
  const [trainingRuns, setTrainingRuns] = useState([]);
  const [selectedReleaseJobId, setSelectedReleaseJobId] = useState(currentJobId || '');
  const [activeDeployment, setActiveDeployment] = useState(null);
  const [deploymentHistory, setDeploymentHistory] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [runDetail, setRunDetail] = useState(null);
  const [validationDetail, setValidationDetail] = useState(null);
  const [businessSummary, setBusinessSummary] = useState(null);
  const [businessSummaryLoading, setBusinessSummaryLoading] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [compareRows, setCompareRows] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState(0);
  const [drawerModel, setDrawerModel] = useState(null);
  const [featureExplainOpen, setFeatureExplainOpen] = useState(false);
  const [featureExplainLoading, setFeatureExplainLoading] = useState(false);
  const [featureExplain, setFeatureExplain] = useState(null);
  const [featureExplainFeature, setFeatureExplainFeature] = useState(null);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [importExpanded, setImportExpanded] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState({ open: false, row: null });

  const [modelName, setModelName] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [lifecycleStage, setLifecycleStage] = useState('candidate');
  const [registrationNotes, setRegistrationNotes] = useState('');
  const [businessApprovalNotes, setBusinessApprovalNotes] = useState('');
  const [technicalApprovalNotes, setTechnicalApprovalNotes] = useState('');
  const [owner, setOwner] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [safeRegisterWhy, setSafeRegisterWhy] = useState('');
  const [changedVsPrior, setChangedVsPrior] = useState('');
  const [registrationThreshold, setRegistrationThreshold] = useState(0.5);
  const [deploymentThreshold, setDeploymentThreshold] = useState(0.5);
  const [deploymentVersionName, setDeploymentVersionName] = useState('');
  const [deploymentNotes, setDeploymentNotes] = useState('');
  const [diffAck, setDiffAck] = useState(false);

  const [testInput, setTestInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState(null);

  const [sandboxFile, setSandboxFile] = useState(null);
  const [sandboxResult, setSandboxResult] = useState(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState('');

  const [importFile, setImportFile] = useState(null);
  const [importName, setImportName] = useState('');
  const [importTarget, setImportTarget] = useState(targetColumn || '');
  const [importStage, setImportStage] = useState('candidate');
  const [importThreshold, setImportThreshold] = useState('0.50');
  const [importNotes, setImportNotes] = useState('');
  const [importError, setImportError] = useState('');
  const [importUploading, setImportUploading] = useState(false);

  const refreshReleaseData = useCallback(async () => {
    setLoading(true);
    setReleaseError(null);
    try {
      const [registryRes, runsRes, activeDepRes, depHistoryRes, auditRes] = await Promise.all([
        mlopsApi.listModelRegistry(),
        mlopsApi.listTrainingRuns({
          limit: 250,
          ...(Number.isFinite(Number(activePipelineId)) && Number(activePipelineId) > 0 ? { pipeline_id: Number(activePipelineId) } : {}),
          ...(runDatasetId ? { dataset_id: runDatasetId } : {}),
        }),
        mlopsApi.getActiveDeployment(),
        mlopsApi.listDeploymentHistory(),
        mlopsApi.registryAuditLog({ limit: 250 }),
      ]);
      setRegistryRows(asArray(unwrap(registryRes)));
      setTrainingRuns(asArray(unwrap(runsRes)));
      setActiveDeployment(unwrap(activeDepRes) || null);
      setDeploymentHistory(asArray(unwrap(depHistoryRes)));
      setAuditRows(asArray(unwrap(auditRes)));
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Failed to load release governance data.');
    } finally {
      setLoading(false);
    }
  }, [activePipelineId, runDatasetId]);

  useEffect(() => {
    refreshReleaseData();
  }, [refreshReleaseData]);

  useEffect(() => {
    const normalizedCurrentJobId = String(currentJobId || '').trim();
    if (!normalizedCurrentJobId) return;
    setSelectedReleaseJobId((prev) => {
      const normalizedPrev = String(prev || '').trim();
      return normalizedPrev === normalizedCurrentJobId ? prev : normalizedCurrentJobId;
    });
  }, [currentJobId]);

  useEffect(() => {
    const nextDefaultJobId = pickDefaultReleaseJobId({
      explicitJobId: currentJobId,
      trainingRuns,
      registryRows,
      activeDeployment,
    });
    if (!nextDefaultJobId) return;
    setSelectedReleaseJobId((prev) => {
      const normalizedPrev = String(prev || '').trim();
      return normalizedPrev === nextDefaultJobId ? prev : nextDefaultJobId;
    });
  }, [activeDeployment, currentJobId, registryRows, trainingRuns]);

  const effectiveCurrentJobId = useMemo(
    () => pickDefaultReleaseJobId({
      explicitJobId: selectedReleaseJobId || currentJobId,
      trainingRuns,
      registryRows,
      activeDeployment,
    }),
    [activeDeployment, currentJobId, registryRows, selectedReleaseJobId, trainingRuns],
  );

  useEffect(() => {
    if (!effectiveCurrentJobId) {
      setRunDetail(null);
      setValidationDetail(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      mlopsApi.modelResults(effectiveCurrentJobId).catch(() => null),
      mlopsApi.validationDetail(effectiveCurrentJobId).catch(() => null),
    ]).then(([detailRes, validationRes]) => {
      if (cancelled) return;
      setRunDetail(unwrap(detailRes) || null);
      setValidationDetail(unwrap(validationRes) || null);
    });
    return () => { cancelled = true; };
  }, [effectiveCurrentJobId]);

  const currentRegistryEntry = useMemo(() => {
    if (resolveCurrentJobId(null, null, registryEntry) === effectiveCurrentJobId) return registryEntry;
    return registryRows.find((row) => String(row.job_id) === effectiveCurrentJobId) || null;
  }, [effectiveCurrentJobId, registryEntry, registryRows]);

  const selectedTrainingRun = useMemo(
    () => trainingRuns.find((row) => String(row?.job_id || '').trim() === String(effectiveCurrentJobId || '').trim()) || null,
    [effectiveCurrentJobId, trainingRuns],
  );

  const activeRun = useMemo(() => {
    if (!effectiveCurrentJobId) return activeModelRun || selectedTrainingRun || null;
    const activeModelMatches = String(activeModelRun?.job_id || '').trim() === String(effectiveCurrentJobId || '').trim();
    return {
      ...(activeModelMatches ? (activeModelRun || {}) : {}),
      ...(selectedTrainingRun || {}),
      ...(runDetail || {}),
      job_id: effectiveCurrentJobId,
      results: runDetail?.results || selectedTrainingRun?.results || (activeModelMatches ? activeModelRun?.results : null),
      metrics: metricsForRun(runDetail || selectedTrainingRun || (activeModelMatches ? activeModelRun : null)),
    };
  }, [activeModelRun, effectiveCurrentJobId, runDetail, selectedTrainingRun]);

  const effectiveValidationReport = useMemo(() => {
    const validationJobId = String(validationReport?.job_id || validationReport?.run_id || '').trim();
    const targetJobId = String(effectiveCurrentJobId || '').trim();
    if (validationJobId && targetJobId && validationJobId === targetJobId) return validationReport;
    return validationDetail || validationReport || null;
  }, [effectiveCurrentJobId, validationDetail, validationReport]);

  const releaseMeta = useMemo(() => parseReleaseMetadata(currentRegistryEntry, activeRun), [activeRun, currentRegistryEntry]);

  useEffect(() => {
    const lockedThreshold = clampThreshold(
      currentRegistryEntry?.selected_threshold
      ?? validationDetail?.selected_threshold
      ?? effectiveValidationReport?.selected_threshold
      ?? runThreshold(activeRun),
      0.5,
    );
    setModelName(currentRegistryEntry?.model_name || deriveReleaseModelName({
      run: activeRun,
      registryEntry: currentRegistryEntry,
      pipelineName: activePipelineName,
      pipelineId: activePipelineId,
    }));
    setVersion(releaseMeta.version || 'v1.0');
    setLifecycleStage(String(currentRegistryEntry?.stage || 'candidate').toLowerCase() || 'candidate');
    setRegistrationNotes(releaseMeta.registrationNotes || '');
    setBusinessApprovalNotes(releaseMeta.businessApprovalNotes || '');
    setTechnicalApprovalNotes(releaseMeta.technicalApprovalNotes || '');
    setOwner(releaseMeta.owner || '');
    setTagsInput(asArray(releaseMeta.tags).join(', '));
    setSafeRegisterWhy(releaseMeta.safeRegisterWhy || '');
    setChangedVsPrior(releaseMeta.changedVsPrior || '');
    setRegistrationThreshold(lockedThreshold);
    setDeploymentThreshold(lockedThreshold);
    setDeploymentVersionName(effectiveCurrentJobId ? `release_${effectiveCurrentJobId.slice(0, 8)}` : 'release_v1');
    setDeploymentNotes(releaseMeta.deploymentNotes || '');
    setImportTarget(targetColumn || activeRun?.target_column || '');
  }, [activePipelineId, activePipelineName, activeRun, effectiveCurrentJobId, currentRegistryEntry, releaseMeta, targetColumn, validationDetail?.selected_threshold, effectiveValidationReport?.selected_threshold]);

  const currentSnapshot = useMemo(() => metricsSnapshot(activeRun, deploymentThreshold), [activeRun, deploymentThreshold]);
  const lockedValidationThreshold = clampThreshold(
    currentRegistryEntry?.selected_threshold
    ?? validationDetail?.selected_threshold
    ?? effectiveValidationReport?.selected_threshold
    ?? runThreshold(activeRun),
    0.5,
  );
  const validationThreshold = clampThreshold(
    validationDetail?.recommended_threshold
    ?? effectiveValidationReport?.optimal_threshold
    ?? activeRun?.metrics?.optimal_threshold
    ?? lockedValidationThreshold,
    lockedValidationThreshold,
  );
  const registeredThreshold = num(currentRegistryEntry?.selected_threshold);

  const currentJobDeployments = useMemo(
    () => deploymentHistory.filter((row) => String(row?.job_id || '') === effectiveCurrentJobId),
    [effectiveCurrentJobId, deploymentHistory],
  );
  const latestCurrentDeployment = currentJobDeployments[0] || null;
  const activeCurrentDeployment = currentJobDeployments.find((row) => row?.active) || null;

  const guardrailLimit = num(currentRegistryEntry?.max_event_loss_pct ?? effectiveValidationReport?.max_event_loss_pct ?? 5) ?? 5;
  const qualityBlocking = Boolean(activeRun?.quality_review?.blocking);
  const guardrail = useMemo(() => guardrailStatus({
    eventLossPct: currentSnapshot.eventLoss,
    maxAllowedEventLossPct: guardrailLimit,
    qualityBlocking,
  }), [currentSnapshot.eventLoss, guardrailLimit, qualityBlocking]);

  const hasValidation = Boolean(effectiveValidationReport?.job_id || validationDetail?.job_id || metricsForRun(activeRun)?.roc_auc != null);
  const recommendation = useMemo(
    () => recommendationStatus({
      hasValidation,
      registryStage: currentRegistryEntry?.stage,
      guardrail,
      currentDeployment: activeCurrentDeployment,
    }),
    [activeCurrentDeployment, currentRegistryEntry?.stage, guardrail, hasValidation],
  );

  const validationStatusText = recommendation.badge === 'Ready for Registration' ? 'Validation Complete' : recommendation.badge;
  const registrationStatusText = stageLabel(currentRegistryEntry?.stage);
  const deploymentStatusText = activeCurrentDeployment?.active
    ? 'Deployed'
    : latestCurrentDeployment
      ? 'Ready for Deployment'
      : currentRegistryEntry
        ? 'Not Deployed'
        : 'Not Registered';

  const currentProductionThreshold = num(activeDeployment?.threshold);
  const lockedThresholdDiffersFromRecommendation = Math.abs(clampThreshold(lockedValidationThreshold) - clampThreshold(validationThreshold)) > 0.0001;
  const deployedThresholdDiffersFromValidation = currentProductionThreshold != null
    && Math.abs(clampThreshold(currentProductionThreshold) - clampThreshold(lockedValidationThreshold)) > 0.0001;
  const deploymentLockedForCurrentVersion = activeCurrentDeployment?.active && currentProductionThreshold != null;
  const approvalsReady = true;
  const deployDisabledReason = !effectiveCurrentJobId
    ? 'Deployment needs a trained model run.'
    : !hasValidation
      ? 'Deployment is blocked until validation is complete.'
      : guardrail.status === 'Blocked'
        ? guardrail.detail
        : !approvalsReady
          ? 'Required approvals are missing.'
          : '';

  const statusPrimaryAction = !currentRegistryEntry
    ? { label: 'Register Model', action: () => scrollToRef(registryRef) }
    : activeCurrentDeployment?.active
      ? { label: 'View Deployment Details', action: () => { setDrawerModel({ ...(currentRegistryEntry || {}), deployment: activeCurrentDeployment }); setDrawerTab(5); setDrawerOpen(true); } }
      : { label: 'Deploy Model', action: () => scrollToRef(deployRef) };

  const releaseSummaryCards = useMemo(() => {
    const businessThresholdLabel = persona === 'business' ? 'Decision Cutoff' : 'Current Threshold';
    const reviewReductionLabel = persona === 'business' ? 'Review Reduction' : 'FP Suppression %';
    const riskMissLabel = persona === 'business' ? 'Potential Risk Miss' : 'Event Loss %';
    const retentionLabel = persona === 'business' ? 'Critical Risk Retention' : 'Case Retention / STR Retention';
    const selectedThreshold = clampThreshold(currentRegistryEntry?.selected_threshold ?? lockedValidationThreshold, lockedValidationThreshold);
    const cards = [
      { label: 'Run ID', value: effectiveCurrentJobId ? effectiveCurrentJobId.slice(0, 12) : '-', helper: effectiveCurrentJobId || 'No active run', mono: true },
      { label: 'Model Name', value: modelName || '-', helper: activeRun?.algorithm_display || activeRun?.algorithm || '' },
      { label: 'Algorithm', value: activeRun?.algorithm_display || activeRun?.algorithm || '-', helper: activeRun?.grain ? `${String(activeRun.grain).toUpperCase()} grain` : '' },
      { label: 'Version', value: version || '-', helper: releaseMeta.artifactVersion ? `Artifact ${releaseMeta.artifactVersion}` : '' },
      { label: 'Validation Status', value: validationStatusText, helper: hasValidation ? 'Threshold evidence captured' : 'Validation not complete yet' },
      { label: 'Registration Status', value: registrationStatusText, helper: currentRegistryEntry ? fmtDate(currentRegistryEntry.updated_at) : 'No registry entry yet' },
      { label: 'Deployment Status', value: deploymentStatusText, helper: activeCurrentDeployment?.deployment_name || latestCurrentDeployment?.deployment_name || 'No deployment version yet' },
      { label: businessThresholdLabel, value: fmtMetric(selectedThreshold, 2), helper: currentRegistryEntry ? 'Current selected threshold' : 'Locked threshold carried from validation', mono: true },
      { label: reviewReductionLabel, value: pct(currentSnapshot.suppression, 1), helper: `${fmtCount(currentSnapshot.tn + currentSnapshot.fn)} alerts set aside`, tone: 'positive' },
      { label: riskMissLabel, value: pct(currentSnapshot.eventLoss, 1), helper: `${fmtCount(currentSnapshot.fn)} suspicious cases could be missed`, tone: guardrail.status === 'Blocked' ? 'critical' : undefined },
      { label: retentionLabel, value: pct(100 - (num(currentSnapshot.eventLoss) ?? 0), 1), helper: `${fmtCount(currentSnapshot.tp)} suspicious cases retained` },
      { label: 'Last Updated', value: fmtDate(currentRegistryEntry?.updated_at || activeRun?.trained_at), helper: 'Latest governed timestamp' },
      { label: 'Owner', value: owner || 'Unassigned', helper: releaseMeta.requestor || 'Set owner during registration' },
    ];
    if (activeCurrentDeployment?.threshold != null) {
      cards.splice(8, 0,
        { label: persona === 'business' ? 'Registered Decision Cutoff' : 'Registered Threshold', value: fmtMetric(selectedThreshold, 2), helper: 'Registry release value', mono: true },
        { label: persona === 'business' ? 'Deployed Decision Cutoff' : 'Deployed Threshold', value: `${fmtMetric(activeCurrentDeployment.threshold, 2)} LOCKED`, helper: 'Locked for the active deployment version', mono: true },
      );
    }
    return cards;
  }, [
    activeCurrentDeployment,
    activeRun,
    effectiveCurrentJobId,
    currentRegistryEntry,
    currentSnapshot.eventLoss,
    currentSnapshot.fn,
    currentSnapshot.suppression,
    currentSnapshot.tn,
    currentSnapshot.tp,
    deploymentStatusText,
    guardrail.status,
    hasValidation,
    modelName,
    owner,
    persona,
    registrationStatusText,
    releaseMeta.artifactVersion,
    releaseMeta.requestor,
    validationStatusText,
    validationThreshold,
    version,
  ]);

  const businessSummaryFallback = useMemo(() => buildReleaseBusinessSummaryFallback({
    modelName,
    algorithm: activeRun?.algorithm_display || activeRun?.algorithm,
    suppression: currentSnapshot.suppression,
    eventLoss: currentSnapshot.eventLoss,
    retainedRiskPct: 100 - (num(currentSnapshot.eventLoss) ?? 0),
    threshold: deploymentThreshold,
    recommendation,
    validationStatusText,
    registrationStatusText,
    deploymentStatusText,
  }), [
    activeRun?.algorithm,
    activeRun?.algorithm_display,
    currentSnapshot.eventLoss,
    currentSnapshot.suppression,
    deploymentStatusText,
    deploymentThreshold,
    modelName,
    recommendation,
    registrationStatusText,
    validationStatusText,
  ]);

  useEffect(() => {
    setBusinessSummary(businessSummaryFallback);
  }, [businessSummaryFallback]);

  useEffect(() => {
    if (!effectiveCurrentJobId) return undefined;
    let cancelled = false;
    setBusinessSummaryLoading(true);
    mlopsApi.releaseBusinessSummary({
      job_id: effectiveCurrentJobId,
      model_name: modelName,
      algorithm: activeRun?.algorithm_display || activeRun?.algorithm || '',
      threshold: deploymentThreshold,
      validation_status: validationStatusText,
      registration_status: registrationStatusText,
      deployment_status: deploymentStatusText,
      recommendation_badge: recommendation?.badge,
      recommendation_reason: recommendation?.reason,
      suppression_pct: currentSnapshot.suppression,
      event_loss_pct: currentSnapshot.eventLoss,
      suspicious_case_retention_pct: 100 - (num(currentSnapshot.eventLoss) ?? 0),
      potential_missed_cases: currentSnapshot.fn,
      alerts_suppressed: currentSnapshot.tn + currentSnapshot.fn,
      alerts_retained: currentSnapshot.tp + currentSnapshot.fp,
      guardrail_limit_pct: guardrailLimit,
      registry_stage: currentRegistryEntry?.stage || '',
    })
      .then((response) => {
        if (cancelled) return;
        const data = unwrap(response);
        if (data && typeof data === 'object') {
          setBusinessSummary({
            ...businessSummaryFallback,
            ...data,
            sections: {
              ...(businessSummaryFallback.sections || {}),
              ...(data.sections || {}),
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setBusinessSummary(businessSummaryFallback);
      })
      .finally(() => {
        if (!cancelled) setBusinessSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeRun?.algorithm,
    activeRun?.algorithm_display,
    businessSummaryFallback,
    effectiveCurrentJobId,
    currentRegistryEntry?.stage,
    currentSnapshot.eventLoss,
    currentSnapshot.fn,
    currentSnapshot.fp,
    currentSnapshot.suppression,
    currentSnapshot.tn,
    currentSnapshot.tp,
    deploymentStatusText,
    deploymentThreshold,
    guardrailLimit,
    modelName,
    recommendation,
    registrationStatusText,
    validationStatusText,
  ]);

  const journeySteps = useMemo(() => {
    const metrics = metricsForRun(activeRun);
    return [
      { title: 'Data Upload', summary: `${asArray(uploadedDatasets).length} table${asArray(uploadedDatasets).length === 1 ? '' : 's'} loaded`, status: asArray(uploadedDatasets).length ? 'Done' : 'Pending' },
      { title: 'Master Dataset', summary: masterDataset ? `${fmtCount(masterDataset.row_count)} rows x ${fmtCount(masterDataset.col_count)} columns` : 'Master dataset not built', status: masterDataset ? 'Done' : 'Pending' },
      { title: 'Target Variable', summary: targetColumn ? `Target selected: ${targetColumn}` : 'Target not selected', status: targetColumn ? 'Done' : 'Pending' },
      { title: 'EDA / Preprocessing', summary: preprocessedDataset ? `${fmtCount(preprocessedDataset.col_count)} features retained after preprocessing` : 'Preprocessing not completed', status: preprocessedDataset ? 'Done' : 'Pending' },
      { title: 'Training', summary: activeRun?.algorithm ? `${activeRun.algorithm} trained with locked validation threshold ${fmtMetric(lockedValidationThreshold, 2)}` : 'Training not completed', status: activeRun?.job_id ? 'Done' : 'Pending', time: activeRun?.trained_at },
      { title: 'Validation', summary: hasValidation ? `ROC-AUC ${fmtMetric(metrics.roc_auc, 3)}, F1 ${fmtMetric(metrics.f1, 3)}, Precision ${fmtMetric(metrics.precision, 3)}, Recall ${fmtMetric(metrics.recall, 3)}` : 'Validation not completed', status: hasValidation ? 'Done' : 'Review Needed' },
      { title: 'Registration', summary: currentRegistryEntry ? stageLabel(currentRegistryEntry.stage) : 'Not Registered', status: currentRegistryEntry ? stageLabel(currentRegistryEntry.stage) : 'Not Registered', time: currentRegistryEntry?.updated_at },
      { title: 'Deployment Ready', summary: recommendation.reason, status: recommendation.badge },
      { title: 'Deployment', summary: activeCurrentDeployment?.active ? `Deployed as ${activeCurrentDeployment.deployment_name || activeCurrentDeployment.deployment_id}` : 'Not deployed', status: activeCurrentDeployment?.active ? 'Deployed' : 'Not Deployed', time: activeCurrentDeployment?.created_at },
    ];
  }, [activeCurrentDeployment, activeRun, currentRegistryEntry, hasValidation, lockedValidationThreshold, masterDataset, preprocessedDataset, recommendation, targetColumn, uploadedDatasets]);

  useEffect(() => {
    const recommended = [];
    if (effectiveCurrentJobId) recommended.push(effectiveCurrentJobId);
    const champion = registryRows.find((row) => String(row?.stage || '').toLowerCase() === 'champion');
    if (champion?.job_id && !recommended.includes(champion.job_id)) recommended.push(champion.job_id);
    const latestCandidate = registryRows.find((row) => ['candidate', 'challenger'].includes(String(row?.stage || '').toLowerCase()));
    if (latestCandidate?.job_id && !recommended.includes(latestCandidate.job_id)) recommended.push(latestCandidate.job_id);
    if (activeDeployment?.job_id && !recommended.includes(activeDeployment.job_id)) recommended.push(activeDeployment.job_id);
    setCompareIds((previous) => previous.length ? previous : recommended.slice(0, 4));
  }, [activeDeployment?.job_id, effectiveCurrentJobId, registryRows]);

  useEffect(() => {
    if (!compareIds.length) {
      setCompareRows([]);
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    mlopsApi.compareRuns({ job_ids: compareIds.slice(0, 5) })
      .then((response) => {
        if (cancelled) return;
        setCompareRows(asArray(unwrap(response)));
      })
      .catch(() => {
        if (!cancelled) setCompareRows([]);
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => { cancelled = true; };
  }, [compareIds]);

  const handleRegisterAction = useCallback(async (stageOverride) => {
    if (!effectiveCurrentJobId) {
      setReleaseError('Select a trained model before registering a release.');
      return;
    }
    if (actionsDisabled) {
      setReleaseError(gatingMessage);
      return;
    }
    const finalStage = String(stageOverride || lifecycleStage || 'candidate').toLowerCase();
    try {
      setLoading(true);
      const validationPayload = {
        ...(effectiveValidationReport || {}),
        release_metadata: {
          version,
          owner,
          requestor: owner,
          registrationNotes,
          businessApprovalNotes,
          technicalApprovalNotes,
          deploymentNotes,
          approvalState: approvalsReady ? 'Not separately gated in this environment' : 'Missing approval',
          safeRegisterWhy,
          changedVsPrior,
          preprocessingVersion: preprocessedDataset?.dataset_id ? `dataset_${preprocessedDataset.dataset_id}` : '',
          artifactVersion: version,
        },
      };
      const tags = tagsInput.split(',').map((item) => item.trim()).filter(Boolean);
      const response = await mlopsApi.registerModel({
        job_id: effectiveCurrentJobId,
        model_name: modelName || deriveReleaseModelName({
          run: activeRun,
          registryEntry: currentRegistryEntry,
          pipelineName: activePipelineName,
          pipelineId: activePipelineId,
        }),
        stage: finalStage,
        selected_threshold: clampThreshold(registrationThreshold, lockedValidationThreshold),
        max_event_loss_pct: guardrailLimit,
        validation: validationPayload,
        notes: registrationNotes,
        tags,
        label: modelName,
        changed_by: owner,
        reason: finalStage === 'draft' ? 'Saved as draft from unified release workflow' : `Registered from unified release workflow as ${finalStage}`,
      });
      const entry = unwrap(response);
      onRegistered?.(entry);
      await refreshReleaseData();
      setReleaseError(null);
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Failed to save the registry entry.');
    } finally {
      setLoading(false);
    }
  }, [actionsDisabled, activePipelineId, activePipelineName, activeRun, approvalsReady, businessApprovalNotes, changedVsPrior, effectiveCurrentJobId, currentRegistryEntry, deploymentNotes, effectiveValidationReport, gatingMessage, guardrailLimit, lifecycleStage, modelName, onRegistered, owner, preprocessedDataset?.dataset_id, refreshReleaseData, registrationNotes, registrationThreshold, safeRegisterWhy, tagsInput, technicalApprovalNotes, validationThreshold, version]);

  const handlePromoteStage = useCallback(async (jobId, nextStage) => {
    if (!jobId) return;
    if (actionsDisabled) {
      setReleaseError(gatingMessage);
      return;
    }
    try {
      if (nextStage === 'champion') {
        await mlopsApi.workbenchChampion({ job_id: jobId, notes: `Promoted from unified release workflow by ${owner || 'release owner'}` });
      } else {
        await mlopsApi.updateRegistryStage(jobId, { stage: nextStage, notes: registrationNotes, changed_by: owner });
      }
      await refreshReleaseData();
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Failed to update lifecycle stage.');
    }
  }, [actionsDisabled, gatingMessage, owner, refreshReleaseData, registrationNotes]);

  const handleArchive = useCallback(async () => {
    if (!archiveDialog.row?.job_id) return;
    if (actionsDisabled) {
      setReleaseError(gatingMessage);
      setArchiveDialog({ open: false, row: null });
      return;
    }
    try {
      await mlopsApi.updateRegistryStage(archiveDialog.row.job_id, {
        stage: 'archived',
        notes: registrationNotes,
        reason: 'Archived from unified release workflow',
        changed_by: owner,
      });
      setArchiveDialog({ open: false, row: null });
      await refreshReleaseData();
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Failed to archive this model.');
    }
  }, [actionsDisabled, archiveDialog.row, gatingMessage, owner, refreshReleaseData, registrationNotes]);

  const handleExportModel = useCallback(async (kind) => {
    if (!effectiveCurrentJobId) return;
    if (actionsDisabled) {
      setReleaseError(gatingMessage);
      return;
    }
    setDownloading(kind);
    try {
      const response = await mlopsApi.exportModel({ job_id: effectiveCurrentJobId });
      const payload = unwrap(response) || {};
      if (kind === 'card' && payload.model_card) {
        downloadBlob(JSON.stringify(payload.model_card, null, 2), `${modelName || 'model'}_card.json`);
      }
      if (kind === 'artifact' && payload.pkl_base64) {
        const binary = atob(payload.pkl_base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), `${modelName || 'model'}.pkl`, 'application/octet-stream');
      }
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Model export failed.');
    } finally {
      setDownloading('');
    }
  }, [actionsDisabled, effectiveCurrentJobId, gatingMessage, modelName]);

  const handleExportDeploymentConfig = useCallback(() => {
    const payload = {
      model_name: modelName,
      version,
      lifecycle_stage: lifecycleStage,
      run_id: effectiveCurrentJobId,
      locked_validation_threshold: lockedValidationThreshold,
      recommended_threshold: validationThreshold,
      registered_threshold: registeredThreshold,
      deployment_threshold: clampThreshold(deploymentThreshold),
      active_production_threshold: currentProductionThreshold,
      deployment_version: deploymentVersionName,
      notes: deploymentNotes,
      active_deployment: activeCurrentDeployment,
    };
    downloadBlob(JSON.stringify(payload, null, 2), `${modelName || 'model'}_deployment_config.json`);
  }, [activeCurrentDeployment, effectiveCurrentJobId, currentProductionThreshold, deploymentNotes, deploymentThreshold, deploymentVersionName, lifecycleStage, lockedValidationThreshold, modelName, registeredThreshold, validationThreshold, version]);

  const handleExportRegistrationMetadata = useCallback(() => {
    const payload = {
      job_id: effectiveCurrentJobId,
      model_name: modelName,
      version,
      owner,
      stage: lifecycleStage,
      registration_threshold: clampThreshold(registrationThreshold),
      registration_notes: registrationNotes,
      business_approval_notes: businessApprovalNotes,
      technical_approval_notes: technicalApprovalNotes,
      tags: tagsInput.split(',').map((item) => item.trim()).filter(Boolean),
      safe_register_why: safeRegisterWhy,
      changed_vs_prior: changedVsPrior,
      registry_entry: currentRegistryEntry,
    };
    downloadBlob(JSON.stringify(payload, null, 2), `${modelName || 'model'}_registration_metadata.json`);
  }, [businessApprovalNotes, changedVsPrior, effectiveCurrentJobId, currentRegistryEntry, lifecycleStage, modelName, owner, registrationNotes, registrationThreshold, safeRegisterWhy, tagsInput, technicalApprovalNotes, version]);

  const executeDeploy = useCallback(async () => {
    if (!effectiveCurrentJobId) return;
    if (actionsDisabled) {
      setReleaseError(gatingMessage);
      return;
    }
    setDeploying(true);
    try {
      if (!currentRegistryEntry) {
        const autoRegisterResponse = await mlopsApi.registerModel({
          job_id: effectiveCurrentJobId,
          model_name: modelName || deriveReleaseModelName({
            run: activeRun,
            registryEntry: currentRegistryEntry,
            pipelineName: activePipelineName,
            pipelineId: activePipelineId,
          }),
          stage: 'candidate',
          selected_threshold: clampThreshold(lockedValidationThreshold, lockedValidationThreshold),
          max_event_loss_pct: guardrailLimit,
          validation: {
            ...(effectiveValidationReport || {}),
            release_metadata: {
              version,
              owner,
              requestor: owner,
              registrationNotes,
              businessApprovalNotes,
              technicalApprovalNotes,
              deploymentNotes,
              artifactVersion: version,
            },
          },
          notes: registrationNotes || 'Auto-registered during deployment from Model Release.',
          tags: tagsInput.split(',').map((item) => item.trim()).filter(Boolean),
          label: modelName,
          changed_by: owner,
          reason: 'Auto-registered as candidate during deployment',
        });
        onRegistered?.(unwrap(autoRegisterResponse));
      }
      const payload = {
        threshold: clampThreshold(deploymentThreshold, lockedValidationThreshold),
        deployment_name: deploymentVersionName || `release_${effectiveCurrentJobId.slice(0, 8)}`,
        notes: deploymentNotes,
        entity_type: String(activeRun?.grain || 'alert'),
        scoring_mode: 'governed_release',
      };
      const response = activeDeployment?.deployment_id
        ? await mlopsApi.swapDeployment({ new_job_id: effectiveCurrentJobId, ...payload })
        : await mlopsApi.deployModel(effectiveCurrentJobId, payload.threshold, payload);
      onDeploy?.(unwrap(response), { navigateToDashboard: false });
      await refreshReleaseData();
      setDeployDialogOpen(false);
      setDiffAck(false);
      setReleaseError(null);
    } catch (error) {
      setReleaseError(error?.response?.data?.error || 'Deployment failed.');
    } finally {
      setDeploying(false);
    }
  }, [actionsDisabled, activeDeployment?.deployment_id, activePipelineId, activePipelineName, activeRun, businessApprovalNotes, effectiveCurrentJobId, currentRegistryEntry, deploymentNotes, deploymentThreshold, deploymentVersionName, effectiveValidationReport, gatingMessage, guardrailLimit, lockedValidationThreshold, modelName, onDeploy, onRegistered, owner, refreshReleaseData, registrationNotes, tagsInput, technicalApprovalNotes, version]);

  const handleScoreSingleRecord = useCallback(async () => {
    if (actionsDisabled) {
      setTestError(gatingMessage);
      return;
    }
    if (!effectiveCurrentJobId) {
      setTestError('Select a model run before scoring a test record.');
      return;
    }
    setTestLoading(true);
    setTestError('');
    try {
      const record = JSON.parse(testInput || '{}');
      const response = await mlopsApi.inferenceExplain({
        run_id: effectiveCurrentJobId,
        record,
        threshold: clampThreshold(deploymentThreshold, lockedValidationThreshold),
        top_n: 8,
      });
      setTestResult(unwrap(response));
    } catch (error) {
      setTestError(error?.message || error?.response?.data?.error || 'Single-record scoring failed.');
    } finally {
      setTestLoading(false);
    }
  }, [actionsDisabled, effectiveCurrentJobId, deploymentThreshold, gatingMessage, lockedValidationThreshold, testInput]);

  const parseCsvRows = useCallback(async (file) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
    if (lines.length < 2) throw new Error('The test file must contain a header row and at least one record.');
    const headers = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((header, index) => {
        const value = cells[index];
        const numeric = Number(value);
        row[header] = Number.isFinite(numeric) && value !== '' ? numeric : value;
      });
      return row;
    });
  }, []);

  const handleSandboxScore = useCallback(async () => {
    if (!sandboxFile) return;
    if (actionsDisabled) {
      setSandboxError(gatingMessage);
      return;
    }
    if (!effectiveCurrentJobId) {
      setSandboxError('Select a model run before sandbox scoring.');
      return;
    }
    setSandboxLoading(true);
    setSandboxError('');
    try {
      const rows = await parseCsvRows(sandboxFile);
      const highThreshold = Math.max(num(activeRun?.hml_high_threshold) ?? 0.65, clampThreshold(deploymentThreshold, lockedValidationThreshold));
      const lowThreshold = clampThreshold(deploymentThreshold, lockedValidationThreshold);
      const response = await mlopsApi.ledgerScore({
        job_id: effectiveCurrentJobId,
        rows,
        grain: String(activeRun?.grain || 'alert'),
        hml_high_threshold: highThreshold,
        hml_low_threshold: lowThreshold,
      });
      const payload = unwrap(response) || {};
      const scoredRows = asArray(payload.scored || payload.rows || payload);
      const enrichedRows = scoredRows.map((row) => {
        const score = num(row?.probability ?? row?.score) ?? 0;
        return { ...row, deployment_decision: score >= lowThreshold ? 'REVIEW' : 'SUPPRESS', applied_threshold: lowThreshold };
      });
      const suppressed = enrichedRows.filter((row) => row.deployment_decision === 'SUPPRESS').length;
      const retained = enrichedRows.length - suppressed;
      const averageScore = enrichedRows.length ? enrichedRows.reduce((sum, row) => sum + (num(row?.probability ?? row?.score) ?? 0), 0) / enrichedRows.length : 0;
      setSandboxResult({
        rows: enrichedRows,
        total: enrichedRows.length,
        suppressed,
        retained,
        averageScore,
        threshold: lowThreshold,
        warnings: suppressed === 0 ? ['No rows would be suppressed with the current deployment threshold.'] : [],
      });
    } catch (error) {
      setSandboxError(error?.response?.data?.error || error?.message || 'Sandbox scoring failed.');
    } finally {
      setSandboxLoading(false);
    }
  }, [actionsDisabled, activeRun?.grain, activeRun?.hml_high_threshold, effectiveCurrentJobId, deploymentThreshold, gatingMessage, lockedValidationThreshold, parseCsvRows, sandboxFile]);

  const handleDownloadSandbox = useCallback(() => {
    if (!sandboxResult?.rows?.length) return;
    const headers = Object.keys(sandboxResult.rows[0]);
    const lines = [
      headers.join(','),
      ...sandboxResult.rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(',')),
    ];
    downloadBlob(lines.join('\n'), `${modelName || 'model'}_sandbox_scores.csv`, 'text/csv');
  }, [modelName, sandboxResult?.rows]);

  const handleImportModel = useCallback(async () => {
    if (!importFile) return;
    if (actionsDisabled) {
      setImportError(gatingMessage);
      return;
    }
    setImportUploading(true);
    setImportError('');
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('model_name', importName || importFile.name.replace(/\.pkl$/i, ''));
      formData.append('target_column', importTarget || targetColumn || '');
      formData.append('stage', importStage);
      formData.append('threshold', importThreshold || '0.50');
      formData.append('notes', importNotes);
      formData.append('changed_by', owner || '');
      const response = await mlopsApi.uploadModelPkl(formData);
      onRegistered?.(unwrap(response)?.registry_entry || unwrap(response));
      setImportExpanded(false);
      setImportFile(null);
      setImportNotes('');
      setImportError('');
      await refreshReleaseData();
    } catch (error) {
      setImportError(error?.response?.data?.error || 'External model import failed.');
    } finally {
      setImportUploading(false);
    }
  }, [actionsDisabled, gatingMessage, importFile, importName, importNotes, importStage, importTarget, importThreshold, onRegistered, owner, refreshReleaseData, targetColumn]);

  const openDetailsDrawer = useCallback((row, nextTab = 0) => {
    const deployment = deploymentHistory.find((item) => String(item?.job_id || '') === String(row?.job_id || '')) || null;
    setDrawerModel({ ...row, deployment });
    setDrawerTab(nextTab);
    setDrawerOpen(true);
  }, [deploymentHistory]);

  const handleExplainFeature = useCallback(async (featureRow) => {
    setFeatureExplainFeature(featureRow);
    setFeatureExplainOpen(true);
    setFeatureExplainLoading(true);
    setFeatureExplain(null);
    try {
      const response = await mlopsApi.validationExplain({
        mode: 'feature_importance',
        feature_name: featureRow?.feature || featureRow?.name,
        importance: num(featureRow?.importance ?? featureRow?.value),
        model_name: modelName,
        algorithm: activeRun?.algorithm,
        threshold: clampThreshold(deploymentThreshold, lockedValidationThreshold),
        business_context: {
          suppression_pct: currentSnapshot.suppression,
          event_loss_pct: currentSnapshot.eventLoss,
        },
      });
      setFeatureExplain(unwrap(response));
    } catch (error) {
      setFeatureExplain({ summary: 'Explanation service is unavailable. Showing grounded context only.', supporting_points: [] });
    } finally {
      setFeatureExplainLoading(false);
    }
  }, [activeRun?.algorithm, currentSnapshot.eventLoss, currentSnapshot.suppression, deploymentThreshold, lockedValidationThreshold, modelName]);

  const comparisonRows = useMemo(() => {
    const registryByJob = new Map(registryRows.map((row) => [String(row.job_id), row]));
    return compareRows.map((row) => {
      const registryRow = registryByJob.get(String(row.job_id));
      const deployment = deploymentHistory.find((item) => String(item?.job_id || '') === String(row.job_id));
      return {
        ...row,
        registry_stage: registryRow?.stage,
        registration_status: stageLabel(registryRow?.stage),
        deployment_status: deployment?.active ? 'Deployed' : deployment ? 'Ready for Deployment' : 'Not Deployed',
        deployed_threshold: num(deployment?.threshold),
        updated_at: registryRow?.updated_at || row?.trained_at,
      };
    });
  }, [compareRows, deploymentHistory, registryRows]);

  const registryHistoryRows = useMemo(() => registryRows.map((row) => {
    const deployments = deploymentHistory.filter((item) => String(item?.job_id || '') === String(row.job_id));
    const latestDeployment = deployments[0] || null;
    const activeForRow = deployments.find((item) => item?.active) || null;
    const meta = parseReleaseMetadata(row, trainingRuns.find((run) => String(run.job_id) === String(row.job_id)));
    return {
      ...row,
      owner: meta.owner,
      version: meta.version,
      validation_status: row?.metrics?.roc_auc != null ? 'Validation Complete' : 'Review Needed',
      approval_status: meta.approvalState || 'Not configured',
      registration_status: stageLabel(row.stage),
      deployment_status: activeForRow?.active ? 'Deployed' : latestDeployment ? 'Ready for Deployment' : 'Not Deployed',
      deployed_threshold: num(latestDeployment?.threshold),
      active_production_threshold: num(activeForRow?.threshold),
      latest_deployment_id: latestDeployment?.deployment_id,
    };
  }), [deploymentHistory, registryRows, trainingRuns]);

  const auditTimelineRows = useMemo(() => {
    const entries = [];
    if (activeRun?.trained_at) {
      entries.push({ at: activeRun.trained_at, kind: 'training', text: `Model training completed for ${modelName || getJobName(activeRun, currentRegistryEntry)} on ${fmtDate(activeRun.trained_at)}.` });
    }
    auditRows.forEach((row) => {
      entries.push({
        at: row.changed_at,
        kind: 'registry',
        text: `Model ${row.model_name || row.job_id} moved from ${stageLabel(row.from_stage)} to ${stageLabel(row.to_stage)} by ${row.changed_by || 'system'} on ${fmtDate(row.changed_at)}${row.reason ? `: ${row.reason}` : ''}.`,
      });
    });
    deploymentHistory.forEach((row) => {
      entries.push({
        at: row.created_at || row.rolled_back_at,
        kind: 'deployment',
        text: row.rolled_back_from
          ? `Deployment ${row.deployment_name || row.deployment_id} was reactivated as a rollback target on ${fmtDate(row.rolled_back_at)} with locked threshold ${fmtMetric(row.threshold, 2)}.`
          : `Model deployed as ${row.deployment_name || row.deployment_id} on ${fmtDate(row.created_at)} with locked threshold ${fmtMetric(row.threshold, 2)}.`,
      });
    });
    if (activeCurrentDeployment?.active && deployedThresholdDiffersFromValidation) {
      entries.push({
        at: new Date().toISOString(),
        kind: 'warning',
        text: `Threshold edit is blocked for the active deployment version. To move from ${fmtMetric(currentProductionThreshold, 2)} to another threshold, create a new deployment version instead.`,
      });
    }
    return entries.sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
  }, [activeCurrentDeployment?.active, activeRun, auditRows, currentProductionThreshold, currentRegistryEntry, deployedThresholdDiffersFromValidation, deploymentHistory, modelName]);

  const chartThresholdTable = thresholdTableForRun(activeRun);
  const featureRows = validationDetail?.feature_importance || activeRun?.feature_importance || activeRun?.model_internals?.data || [];

  const featurePlaceholder = useMemo(() => {
    const sample = Object.fromEntries(featureNamesForRun(activeRun).slice(0, 8).map((name) => [name, 0]));
    return JSON.stringify(sample, null, 2) || '{\n  "feature_1": 0\n}';
  }, [activeRun]);

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.2, borderColor: T.border }}>
        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', xl: 'center' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Button variant="outlined" startIcon={<ArrowBack />} onClick={onBack} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted, minWidth: 150 }}>
              Back to previous stage
            </Button>
            <Button variant="contained" onClick={statusPrimaryAction.action} sx={{ textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, minWidth: 170, fontWeight: 800 }}>
              {statusPrimaryAction.label}
            </Button>
            <Button variant="outlined" startIcon={<CompareArrows />} onClick={() => scrollToRef(compareRef)} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Compare Models
            </Button>
            <Button variant="outlined" startIcon={<Save />} onClick={() => handleRegisterAction('draft')} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Save Draft
            </Button>
            <Button variant="outlined" startIcon={<History />} onClick={() => scrollToRef(auditRef)} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              View Audit Log
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} sx={{ flexWrap: 'wrap' }}>
            <StatusChip label="Validation Status" value={validationStatusText} />
            <StatusChip label="Registration Status" value={registrationStatusText} />
            <StatusChip label="Deployment Status" value={deploymentStatusText} />
          </Stack>
        </Stack>
        {actionsDisabled ? <Alert severity="warning" sx={{ mt: 2, borderRadius: 2 }}>{gatingMessage}</Alert> : null}
        {releaseError ? <Alert severity="error" sx={{ mt: 2, borderRadius: 2 }}>{releaseError}</Alert> : null}
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 0, p: 2.3, borderColor: T.border, bgcolor: '#FFFBF7' }}>
        <Stack spacing={1.4}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between" alignItems={{ md: 'flex-start' }}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase', letterSpacing: 0.9 }}>
                Business Release Summary
              </Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 800, color: T.text, mt: 0.5 }}>
                {businessSummary?.headline || businessSummaryFallback.headline}
              </Typography>
              <Typography sx={{ fontSize: 12.8, color: T.ink, mt: 0.9, lineHeight: 1.7, maxWidth: 1100 }}>
                {businessSummary?.executive_summary || businessSummaryFallback.executive_summary}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
              {businessSummaryLoading ? <CircularProgress size={16} sx={{ color: T.orange }} /> : null}
              <Chip label={businessSummary?.llm_available ? 'AI-assisted summary' : 'Grounded summary'} sx={{ borderRadius: 0, bgcolor: businessSummary?.llm_available ? T.orangeSoft : T.panelSoft, color: businessSummary?.llm_available ? T.orange : T.text, border: `1px solid ${T.border}`, fontWeight: 700 }} />
              <Chip label={recommendation.badge} sx={{ borderRadius: 0, bgcolor: statusTone(recommendation.badge).bg, color: statusTone(recommendation.badge).fg, border: `1px solid ${statusTone(recommendation.badge).bd}`, fontWeight: 800 }} />
            </Stack>
          </Stack>

          <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: T.border, bgcolor: '#fff' }}>
              <Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.7 }}>What We Built</Typography>
              <Typography sx={{ mt: 0.7, fontSize: 12.2, color: T.ink, lineHeight: 1.65 }}>{businessSummary?.sections?.what_we_built || businessSummaryFallback.sections.what_we_built}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: T.border, bgcolor: '#fff' }}>
              <Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.7 }}>What We Achieved</Typography>
              <Typography sx={{ mt: 0.7, fontSize: 12.2, color: T.ink, lineHeight: 1.65 }}>{businessSummary?.sections?.what_we_achieved || businessSummaryFallback.sections.what_we_achieved}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: T.border, bgcolor: '#fff' }}>
              <Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.7 }}>Business Value</Typography>
              <Typography sx={{ mt: 0.7, fontSize: 12.2, color: T.ink, lineHeight: 1.65 }}>{businessSummary?.sections?.business_value || businessSummaryFallback.sections.business_value}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: T.border, bgcolor: '#fff' }}>
              <Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.7 }}>Recommended Next Step</Typography>
              <Typography sx={{ mt: 0.7, fontSize: 12.2, color: T.ink, lineHeight: 1.65 }}>{businessSummary?.sections?.next_step || businessSummaryFallback.sections.next_step}</Typography>
            </Paper>
          </Box>

          <Alert severity={recommendation.badge === 'Blocked' ? 'error' : recommendation.badge === 'Review Needed' ? 'warning' : 'success'} sx={{ borderRadius: 0 }}>
            {businessSummary?.sections?.caution || businessSummaryFallback.sections.caution}
          </Alert>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.2, borderColor: T.border }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: T.text }}>Current model release summary</Typography>
            <Typography sx={{ fontSize: 11.8, color: T.muted, mt: 0.25 }}>
              Review the AML release state, threshold position, registry status, and production trace at a glance.
            </Typography>
          </Box>
          {loading ? <CircularProgress size={18} sx={{ color: T.orange }} /> : null}
        </Stack>
        <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(280px, 420px) 1fr' }, mb: 1.5 }}>
          <Select
            size="small"
            displayEmpty
            value={effectiveCurrentJobId || ''}
            onChange={(event) => {
              setSelectedReleaseJobId(String(event.target.value || '').trim());
              setReleaseError(null);
            }}
          >
            {(trainingRuns || []).map((run) => (
              <MenuItem key={run.job_id} value={run.job_id}>
                {(run.model_name || run.label || run.algorithm_display || run.algorithm || String(run.job_id).slice(0, 8))}
                {` · ${fmtDate(run.trained_at)}`}
              </MenuItem>
            ))}
          </Select>
          <Alert severity={hasValidation ? 'success' : 'warning'} sx={{ borderRadius: 1.5 }}>
            {hasValidation
              ? 'This release is bound to a saved trained model run and can be reopened after restart without retraining.'
              : 'This saved trained model exists, but its validation evidence is incomplete. Open it in Model Validation first if you need a locked threshold before deployment.'}
          </Alert>
        </Box>
        <Box sx={{ display: 'grid', gap: 1.35, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}>
          {releaseSummaryCards.map((card) => (
            <SummaryCard key={`${card.label}-${card.helper}`} label={card.label} value={card.value} helper={card.helper} tone={card.tone} mono={card.mono} />
          ))}
        </Box>
        {activeCurrentDeployment?.threshold != null ? (
          <ThresholdLockNote deployedThreshold={activeCurrentDeployment.threshold} deploymentName={activeCurrentDeployment.deployment_name} deploymentDate={activeCurrentDeployment.created_at} />
        ) : null}
      </Paper>

      <EnterpriseSection title="Pipeline journey and run trace" subtitle="Compact lineage from raw AML inputs to governed release state">
        <Box sx={{ display: 'flex', gap: 1.2, overflowX: 'auto', pb: 0.5 }}>
          {journeySteps.map((step) => (
            <StepCell key={step.title} title={step.title} summary={step.summary} status={step.status} time={step.time} />
          ))}
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Model review and decision support" subtitle="Business and technical evidence for release registration and deployment review">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.1fr 0.9fr' } }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>Business impact summary</Typography>
              <Box sx={{ mt: 1.4, display: 'grid', gap: 1.2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } }}>
                <SmallStat label="Alerts suppressed" value={fmtCount(currentSnapshot.tn + currentSnapshot.fn)} helper="Expected to be removed from manual review" />
                <SmallStat label="Effort saved" value={pct(currentSnapshot.suppression, 1)} helper="Estimated review reduction" />
                <SmallStat label="Remaining alerts" value={fmtCount(currentSnapshot.tp + currentSnapshot.fp)} helper="Still sent to analysts" />
                <SmallStat label="Risk retained" value={pct(100 - (num(currentSnapshot.eventLoss) ?? 0), 1)} helper="Suspicious cases still kept" />
              </Box>
              <Typography sx={{ mt: 1.4, fontSize: 12, color: T.muted, lineHeight: 1.65 }}>
                This AML false-positive suppression model is expected to reduce manual review volume by {pct(currentSnapshot.suppression, 1)} while keeping {pct(100 - (num(currentSnapshot.eventLoss) ?? 0), 1)} of suspicious cases in the analyst workflow at the current threshold.
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>AML guardrails</Typography>
              <Stack spacing={0.5} sx={{ mt: 1.1 }}>
                <KeyValueRow label="Maximum allowed event loss" value={pct(guardrailLimit, 1)} helper="Approved guardrail for suspicious-case misses" />
                <KeyValueRow label="Actual event loss" value={pct(currentSnapshot.eventLoss, 1)} helper="Potential risk miss at the current threshold" highlight={guardrail.status !== 'Safe'} />
                <KeyValueRow label="Case retention / STR retention" value={pct(100 - (num(currentSnapshot.eventLoss) ?? 0), 1)} helper="Overall suspicious-case retention based on holdout outcomes" />
                <KeyValueRow label="Critical segment protection" value="Not segment-tested yet" helper="No segment-specific retention audit is stored for this run yet. Overall suspicious-case retention is shown instead." />
                <KeyValueRow label="Guardrail recommendation" value={guardrail.status} helper={guardrail.detail} highlight={guardrail.status !== 'Safe'} />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border, bgcolor: '#FCFCFD' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>Plain-language recommendation</Typography>
              <Typography sx={{ mt: 1, fontSize: 12.5, lineHeight: 1.7, color: T.ink }}>
                {guardrail.status === 'Safe'
                  ? `This model is expected to reduce manual false-positive review volume by ${pct(currentSnapshot.suppression, 1)} while staying within the approved risk-miss guardrail. It is suitable for ${currentRegistryEntry ? 'deployment review' : 'candidate registration and deployment review'}.`
                  : `${recommendation.reason} Review the threshold and risk trade-off before moving this model into production.`}
              </Typography>
            </Paper>
          </Stack>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>Technical model card</Typography>
              <Stack spacing={0.3} sx={{ mt: 1.1 }}>
                <KeyValueRow label="Algorithm" value={activeRun?.algorithm_display || activeRun?.algorithm || '-'} />
                <KeyValueRow label="ROC-AUC" value={fmtMetric(currentSnapshot.rocAuc, 4)} mono />
                <KeyValueRow label="F1" value={fmtMetric(currentSnapshot.f1, 4)} mono />
                <KeyValueRow label="Precision" value={fmtMetric(currentSnapshot.precision, 4)} mono />
                <KeyValueRow label="Recall" value={fmtMetric(currentSnapshot.recall, 4)} mono />
                <KeyValueRow label="Threshold" value={fmtMetric(deploymentThreshold, 2)} mono highlight />
                <KeyValueRow label="Training rows" value={fmtCount(resultForRun(activeRun)?.train_rows)} />
                <KeyValueRow label="Feature count" value={fmtCount(featureNamesForRun(activeRun).length || resultForRun(activeRun)?.features_used)} />
                <KeyValueRow label="Run / job ID" value={effectiveCurrentJobId || '-'} mono />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>Validation details</Typography>
              <Stack spacing={0.3} sx={{ mt: 1.1 }}>
                <KeyValueRow label="Train / validation split" value={validationDetail?.score_distribution_source === 'stored_scores' ? 'Stored holdout scores available' : 'Random holdout'} helper={validationDetail?.score_distribution_reason || 'Validation detail evidence is sourced from the saved run bundle.'} />
                <KeyValueRow label="Threshold search method" value={effectiveValidationReport?.optimization_mode || 'Max suppression under event-loss guardrail'} />
                <KeyValueRow label="Calibration" value={activeRun?.calibration_used ? 'Calibrated' : 'Not captured'} />
                <KeyValueRow label="Preprocessing pipeline version" value={preprocessedDataset?.dataset_id ? `dataset_${preprocessedDataset.dataset_id}` : releaseMeta.preprocessingVersion || 'Not captured'} mono />
                <KeyValueRow label="Model artifact version" value={releaseMeta.artifactVersion || version} mono />
                <KeyValueRow label="Dataset version / signature" value={masterDataset?.dataset_id ? `master_${masterDataset.dataset_id}` : 'Dataset signature unavailable'} helper={masterDataset ? `${fmtCount(masterDataset.row_count)} rows x ${fmtCount(masterDataset.col_count)} columns` : ''} mono />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text }}>Release recommendation</Typography>
              <Chip label={recommendation.badge} sx={{ mt: 1.2, height: 30, bgcolor: statusTone(recommendation.badge).bg, color: statusTone(recommendation.badge).fg, border: `1px solid ${statusTone(recommendation.badge).bd}`, fontWeight: 800 }} />
              <Typography sx={{ mt: 1.2, fontSize: 12, color: T.ink, lineHeight: 1.65 }}>{recommendation.reason}</Typography>
            </Paper>
          </Stack>
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Model registration and lifecycle" subtitle="Register the trained run into the governed lifecycle before production deployment" action={<Button size="small" onClick={(event) => { event.stopPropagation(); scrollToRef(registryRef); }} sx={{ textTransform: 'none', color: T.orange }}>Jump to form</Button>}>
        <Box ref={registryRef} sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.8fr' } }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Registration form</Typography>
            <Box sx={{ mt: 1.4, display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
              <TextField size="small" label="Model Name" value={modelName} onChange={(event) => setModelName(event.target.value)} />
              <TextField size="small" label="Version" value={version} onChange={(event) => setVersion(event.target.value)} />
              <Select size="small" value={lifecycleStage} onChange={(event) => setLifecycleStage(event.target.value)}>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="candidate">Candidate</MenuItem>
                <MenuItem value="champion">Champion</MenuItem>
                <MenuItem value="archived">Archived</MenuItem>
              </Select>
              <TextField size="small" label="Owner / Requestor" value={owner} onChange={(event) => setOwner(event.target.value)} />
            </Box>

            <Alert severity="info" sx={{ mt: 1.8, borderRadius: 1.5 }}>
              Model Release does not edit thresholds. The locked validation threshold of {fmtMetric(registrationThreshold, 2)} will be carried into registration and deployment unchanged.
            </Alert>

            <Stack spacing={1.2} sx={{ mt: 1.6 }}>
              <TextField size="small" label="Registration Notes" multiline minRows={3} value={registrationNotes} onChange={(event) => setRegistrationNotes(event.target.value)} />
              <TextField size="small" label="Business Approval Notes" multiline minRows={2} value={businessApprovalNotes} onChange={(event) => setBusinessApprovalNotes(event.target.value)} />
              <TextField size="small" label="Technical Approval Notes" multiline minRows={2} value={technicalApprovalNotes} onChange={(event) => setTechnicalApprovalNotes(event.target.value)} />
              <TextField size="small" label="Optional Tags" placeholder="aml, suppression, q1_release" value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1.8 }} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" startIcon={<Save />} onClick={() => handleRegisterAction('draft')} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
                Save Draft
              </Button>
              <Button variant="contained" startIcon={<FactCheck />} onClick={() => handleRegisterAction('candidate')} sx={{ textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
                Register as Candidate
              </Button>
              <Button variant="outlined" startIcon={<CheckCircle />} onClick={() => handlePromoteStage(effectiveCurrentJobId, 'champion')} disabled={!currentRegistryEntry && !effectiveCurrentJobId} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
                Promote to Champion
              </Button>
              <Button variant="outlined" startIcon={<Archive />} onClick={() => setArchiveDialog({ open: true, row: currentRegistryEntry || { job_id: effectiveCurrentJobId, model_name: modelName } })} disabled={!currentRegistryEntry && !effectiveCurrentJobId} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
                Archive Model
              </Button>
            </Stack>
          </Paper>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Run context</Typography>
              <Stack spacing={0.25} sx={{ mt: 1.1 }}>
                <KeyValueRow label="Pipeline run" value={pipelineRunLabel} />
                <KeyValueRow label="Run ID" value={effectiveCurrentJobId || '-'} mono />
                <KeyValueRow label="Training date" value={fmtDate(activeRun?.trained_at)} />
                <KeyValueRow label="Dataset version" value={preprocessedDataset?.dataset_id ? `dataset_${preprocessedDataset.dataset_id}` : masterDataset?.dataset_id ? `master_${masterDataset.dataset_id}` : '-'} mono />
                <KeyValueRow label="Target variable" value={targetColumn || activeRun?.target_column || '-'} />
                <KeyValueRow label="Feature count" value={fmtCount(featureNamesForRun(activeRun).length || resultForRun(activeRun)?.features_used)} />
                <KeyValueRow label="Preprocessing version" value={preprocessedDataset?.dataset_id ? `prep_${preprocessedDataset.dataset_id}` : 'Not captured'} mono />
                <KeyValueRow label="Validation result" value={validationStatusText} />
                <KeyValueRow label="Locked validation threshold" value={fmtMetric(lockedValidationThreshold, 2)} mono />
                <KeyValueRow label="Recommended threshold" value={fmtMetric(validationThreshold, 2)} mono />
                <KeyValueRow label="Already registered before" value={currentRegistryEntry ? 'Yes' : 'No'} />
                <KeyValueRow label="Approval requirement state" value={releaseMeta.approvalState || 'No formal gate configured'} />
                <KeyValueRow label="Deployment eligibility" value={deployDisabledReason ? 'Review Needed' : 'Eligible'} helper={deployDisabledReason || 'Validation is complete. Registration will be created automatically if it is missing.'} />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border, bgcolor: '#FCFCFD' }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Compliance note</Typography>
              <TextField size="small" fullWidth multiline minRows={3} sx={{ mt: 1.1 }} label="Why is this model safe to register?" value={safeRegisterWhy} onChange={(event) => setSafeRegisterWhy(event.target.value)} />
              <TextField size="small" fullWidth multiline minRows={3} sx={{ mt: 1.2 }} label="What changed compared with prior version?" value={changedVsPrior} onChange={(event) => setChangedVsPrior(event.target.value)} />
            </Paper>
          </Stack>
        </Box>
      </EnterpriseSection>
      <EnterpriseSection title="Deployment threshold and release controls" subtitle="The threshold written into production must remain visible, explainable, and immutable per deployment version">
        <Box ref={deployRef} sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.1fr 0.9fr' } }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Threshold governance</Typography>
              {deploymentLockedForCurrentVersion ? (
                <ThresholdLockNote deployedThreshold={currentProductionThreshold} deploymentName={activeCurrentDeployment?.deployment_name} deploymentDate={activeCurrentDeployment?.created_at} />
              ) : (
                <Alert severity="info" sx={{ mt: 1.1, borderRadius: 2 }}>
                  This threshold was finalized in Model Validation and will be written unchanged into the deployed model version.
                </Alert>
              )}
              <Box sx={{ mt: 1.5, display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                <TextField size="small" label="Locked Deployment Threshold" type="number" value={deploymentThreshold} InputProps={{ readOnly: true }} />
                <TextField size="small" label="Deployment Version Name" value={deploymentVersionName} onChange={(event) => setDeploymentVersionName(event.target.value)} />
                <TextField size="small" label="Registered Threshold" value={fmtMetric(registeredThreshold, 2)} InputProps={{ readOnly: true }} />
                <TextField size="small" label="Recommended Threshold" value={fmtMetric(validationThreshold, 2)} InputProps={{ readOnly: true }} />
                <TextField size="small" label="Locked Validation Threshold" value={fmtMetric(lockedValidationThreshold, 2)} InputProps={{ readOnly: true }} />
                <TextField size="small" label="Threshold Lock Status" value={deploymentLockedForCurrentVersion ? 'Locked for active deployment' : 'Locked from validation'} InputProps={{ readOnly: true }} />
                <TextField size="small" label="Effective Production Threshold" value={fmtMetric(currentProductionThreshold ?? deploymentThreshold, 2)} InputProps={{ readOnly: true }} />
              </Box>
              <Stack spacing={0.35} sx={{ mt: 1.3 }}>
                <KeyValueRow label="Guardrail check" value={guardrail.status} helper={guardrail.detail} highlight={guardrail.status !== 'Safe'} />
                <KeyValueRow label="Deployment notes" value={deploymentNotes || 'No notes added yet'} helper="Release notes recorded with the deployment version" />
                <KeyValueRow label="Current active production threshold" value={fmtMetric(currentProductionThreshold, 2)} mono />
              </Stack>
              {lockedThresholdDiffersFromRecommendation ? <Alert severity="info" sx={{ mt: 1.3, borderRadius: 2 }}>The locked validation threshold differs from the recommendation. This is acceptable when the final validation decision was intentionally documented.</Alert> : null}
              {deployedThresholdDiffersFromValidation ? <Alert severity="warning" sx={{ mt: 1.2, borderRadius: 2 }}>The active production threshold differs from the locked validation threshold. Acknowledge this in the deployment confirmation before creating the next deployment version.</Alert> : null}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Metrics preview tied to threshold</Typography>
              <Box sx={{ mt: 1.3, display: 'grid', gap: 1.2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
                <SmallStat label={persona === 'business' ? 'Review reduction' : 'FP Suppression %'} value={pct(currentSnapshot.suppression, 1)} />
                <SmallStat label={persona === 'business' ? 'Potential risk miss' : 'Event Loss %'} value={pct(currentSnapshot.eventLoss, 1)} />
                <SmallStat label={persona === 'business' ? 'Critical risk retained' : 'Case / STR retention'} value={pct(100 - (num(currentSnapshot.eventLoss) ?? 0), 1)} />
                <SmallStat label="Decision volume impact" value={fmtCount(currentSnapshot.tp + currentSnapshot.fp)} helper="Alerts still routed to analysts" />
              </Box>
              <Box sx={{ mt: 1.4 }}>
                <ThresholdTradeoffChart table={chartThresholdTable} threshold={deploymentThreshold} />
              </Box>
            </Paper>
          </Stack>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Threshold comparison row</Typography>
              <Stack spacing={0.35} sx={{ mt: 1 }}>
                <KeyValueRow label="Locked validation threshold" value={fmtMetric(lockedValidationThreshold, 2)} mono />
                <KeyValueRow label="Recommended threshold" value={fmtMetric(validationThreshold, 2)} mono />
                <KeyValueRow label="Registered threshold" value={fmtMetric(registeredThreshold, 2)} mono />
                <KeyValueRow label="Deployment threshold" value={fmtMetric(deploymentThreshold, 2)} mono />
                <KeyValueRow label="Current active production threshold" value={fmtMetric(currentProductionThreshold, 2)} mono />
              </Stack>
              <Typography sx={{ mt: 1.2, fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
                {registeredThreshold != null && currentProductionThreshold != null && Math.abs(registeredThreshold - currentProductionThreshold) < 0.0001 && Math.abs(lockedValidationThreshold - currentProductionThreshold) < 0.0001
                  ? 'Validation, registration, and active production all use the same locked threshold.'
                  : 'Any differences here are intentional release decisions and should remain visible for audit and rollback review.'}
              </Typography>
            </Paper>
            <ConfusionExplainCard snapshot={currentSnapshot} />
          </Stack>
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Pre-deployment testing" subtitle={persona === 'business' ? 'See how the current deployment settings would behave on new data.' : 'Score a test sample using the selected deployment threshold and current registered artifact.'}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 0.9fr' } }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Quick test panel</Typography>
            <Typography sx={{ mt: 0.8, fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
              Paste one record as JSON to preview the score, suppression decision, and feature-level explanation without retraining the model.
            </Typography>
            <TextField multiline minRows={7} fullWidth value={testInput} onChange={(event) => setTestInput(event.target.value)} placeholder={featurePlaceholder} sx={{ mt: 1.3, '& .MuiInputBase-input': { fontFamily: T.mono, fontSize: 11.5 } }} />
            <Button variant="contained" startIcon={testLoading ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <PlayArrow />} onClick={handleScoreSingleRecord} disabled={actionsDisabled || !testInput.trim() || testLoading} sx={{ mt: 1.4, textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
              {testLoading ? 'Scoring preview...' : 'Run quick test'}
            </Button>
            {testError ? <Alert severity="error" sx={{ mt: 1.3, borderRadius: 2 }}>{testError}</Alert> : null}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Test summary</Typography>
            {testResult ? (
              <Stack spacing={1.1} sx={{ mt: 1.2 }}>
                <KeyValueRow label="Rows scored" value="1" />
                <KeyValueRow label="Suppression decision" value={(num(testResult?.score) ?? 0) >= deploymentThreshold ? 'Retained for review' : 'Suppressed'} />
                <KeyValueRow label="Threshold used during test" value={fmtMetric(deploymentThreshold, 2)} mono />
                <KeyValueRow label="Score / confidence" value={fmtMetric(testResult?.score, 4)} mono />
                <KeyValueRow label="Pass / fail status" value={(num(testResult?.score) ?? 0) >= deploymentThreshold ? 'Pass: retained for analyst review' : 'Pass: suppressed by current cutoff'} />
                <Typography sx={{ mt: 0.4, fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
                  Validation notice: this test does not retrain the model. It only previews how the currently selected deployment threshold would behave for this record.
                </Typography>
              </Stack>
            ) : (
              <Box sx={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${T.border}`, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 12, color: T.muted }}>Quick test output will appear here.</Typography>
              </Box>
            )}
          </Paper>
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Score a test file / sandbox scoring" subtitle="Upload CSV data, preview schema fit, score rows, and export exploratory results" defaultOpen={false}>
        <Stack spacing={1.6}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.3} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box onClick={() => !actionsDisabled && document.getElementById('model-release-sandbox-upload')?.click()} sx={{ p: 2, borderRadius: 2.5, border: `1.5px dashed ${sandboxFile ? T.orange : T.border}`, bgcolor: sandboxFile ? T.orangeSoft : '#FCFCFD', cursor: actionsDisabled ? 'not-allowed' : 'pointer', minWidth: 300, flex: 1 }}>
              <input id="model-release-sandbox-upload" type="file" accept=".csv" style={{ display: 'none' }} onChange={(event) => setSandboxFile(event.target.files?.[0] || null)} />
              <Stack direction="row" spacing={1.2} alignItems="center">
                <UploadFile sx={{ color: sandboxFile ? T.orange : T.dim }} />
                <Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: sandboxFile ? T.orange : T.text }}>{sandboxFile ? sandboxFile.name : 'Choose a CSV test file'}</Typography>
                  <Typography sx={{ fontSize: 11, color: T.muted }}>Results remain exploratory and do not alter the production model.</Typography>
                </Box>
              </Stack>
            </Box>
            <Button variant="contained" startIcon={sandboxLoading ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <Assessment />} onClick={handleSandboxScore} disabled={!sandboxFile || sandboxLoading || actionsDisabled} sx={{ textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
              {sandboxLoading ? 'Scoring test file...' : 'Score file'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownload />} onClick={handleDownloadSandbox} disabled={!sandboxResult?.rows?.length} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Download scoring results
            </Button>
          </Stack>
          {sandboxError ? <Alert severity="error" sx={{ borderRadius: 2 }}>{sandboxError}</Alert> : null}
          {sandboxResult ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '0.8fr 1.2fr' } }}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Sandbox summary</Typography>
                <Stack spacing={0.35} sx={{ mt: 1.1 }}>
                  <KeyValueRow label="Rows scored" value={fmtCount(sandboxResult.total)} />
                  <KeyValueRow label="Alerts suppressed" value={fmtCount(sandboxResult.suppressed)} />
                  <KeyValueRow label="Alerts retained" value={fmtCount(sandboxResult.retained)} />
                  <KeyValueRow label="Average score" value={fmtMetric(sandboxResult.averageScore, 4)} mono />
                  <KeyValueRow label="Threshold used" value={fmtMetric(sandboxResult.threshold, 2)} mono />
                  <KeyValueRow label="Result validity" value="Exploratory only" helper="These scores are for pre-deployment inspection and do not alter the production model." />
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Row-level preview</Typography>
                <Box sx={{ mt: 1.2, maxHeight: 320, overflow: 'auto', border: `1px solid ${T.border}`, borderRadius: 2 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC' }}>
                      <tr>
                        {['Entity', 'Probability', 'Decision', 'Threshold'].map((header) => (
                          <th key={header} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sandboxResult.rows.slice(0, 100).map((row, index) => (
                        <tr key={`${row.entity_id || row.ALERT_ID || index}`}>
                          <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, color: T.text }}>{row.entity_id || row.ALERT_ID || row.CASE_ID || `row_${index + 1}`}</td>
                          <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.probability ?? row.score, 4)}</td>
                          <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontWeight: 700, color: row.deployment_decision === 'SUPPRESS' ? T.success : T.orange }}>{row.deployment_decision}</td>
                          <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.applied_threshold, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Paper>
            </Box>
          ) : null}
        </Stack>
      </EnterpriseSection>
      <EnterpriseSection title="Export, approve and deploy" subtitle="Release artifacts, formal review output, and deployment control points">
        <Stack spacing={1.3}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<Visibility />} onClick={() => onViewReport?.(effectiveCurrentJobId)} disabled={!effectiveCurrentJobId} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              View Business Report
            </Button>
            <Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExportModel('card')} disabled={!effectiveCurrentJobId || downloading === 'card'} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Download Model Card
            </Button>
            <Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExportModel('artifact')} disabled={!effectiveCurrentJobId || downloading === 'artifact'} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Download Model Artifact
            </Button>
            <Button variant="outlined" startIcon={<FileDownload />} onClick={handleExportDeploymentConfig} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Download Deployment Configuration
            </Button>
            <Button variant="outlined" startIcon={<FileDownload />} onClick={handleExportRegistrationMetadata} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>
              Export Registration Metadata
            </Button>
            <Button variant="contained" startIcon={<RocketLaunch />} onClick={() => setDeployDialogOpen(true)} disabled={actionsDisabled || canDisable(Boolean(deployDisabledReason))} sx={{ textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
              {activeDeployment?.deployment_id ? 'Create Deployment Version' : 'Deploy Model'}
            </Button>
          </Stack>
          {deployDisabledReason ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{deployDisabledReason}</Alert> : null}
        </Stack>
      </EnterpriseSection>

      <EnterpriseSection title="Model comparison" subtitle="Compare the current run against champion, candidate, and deployed alternatives">
        <Box ref={compareRef}>
          {compareLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} sx={{ color: T.orange }} /></Stack>
          ) : (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1.4 }}>
                {registryRows.slice(0, 8).map((row) => {
                  const checked = compareIds.includes(row.job_id);
                  return (
                    <Chip
                      key={row.job_id}
                      label={`${checked ? 'Selected' : 'Compare'}: ${row.model_name || row.job_id.slice(0, 8)}`}
                      onClick={() => setCompareIds((previous) => {
                        if (previous.includes(row.job_id)) return previous.filter((id) => id !== row.job_id);
                        if (previous.length >= 5) return previous;
                        return [...previous, row.job_id];
                      })}
                      sx={{ bgcolor: checked ? T.orangeSoft : '#FFF', color: checked ? T.orange : T.muted, border: `1px solid ${checked ? '#FED7AA' : T.border}`, cursor: 'pointer' }}
                    />
                  );
                })}
              </Stack>
              {comparisonRows.length ? (
                <Box sx={{ overflow: 'auto', border: `1px solid ${T.border}`, borderRadius: 2.5 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC' }}>
                      <tr>
                        {[
                          persona === 'business' ? 'Release' : 'Model',
                          'AUC', 'Precision', 'Recall', 'F1',
                          persona === 'business' ? 'Review Reduction' : 'FP Suppression %',
                          persona === 'business' ? 'Potential Risk Miss' : 'Event Loss %',
                          persona === 'business' ? 'Critical Risk Retention' : 'Case / STR Retention',
                          'Threshold', 'Stage', 'Registration', 'Deployment', 'Updated',
                        ].map((header) => (
                          <th key={header} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.job_id} onClick={() => openDetailsDrawer(row)} style={{ cursor: 'pointer', background: String(row.job_id) === effectiveCurrentJobId ? '#FFF8F3' : '#FFF' }}>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
                            <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>{row.model_name || row.label || row.job_id.slice(0, 8)}</Typography>
                            <Typography sx={{ fontSize: 10.5, color: T.muted }}>{row.algorithm_display || row.algorithm}</Typography>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.metrics?.roc_auc, 3)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.metrics?.precision, 3)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.metrics?.recall, 3)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.metrics?.f1, 3)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{pct(row.metrics?.suppression_rate_pct, 1)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{pct(row.metrics?.event_loss_pct, 1)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{pct(100 - (num(row.metrics?.event_loss_pct) ?? 0), 1)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.selected_threshold ?? row.optimal_threshold, 2)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{stageLabel(row.registry_stage)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.registration_status}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.deployment_status}</td>
                          <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{fmtDate(row.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              ) : <Alert severity="info" sx={{ borderRadius: 2 }}>Not enough comparable models are available yet. Only governed model runs can be compared in this environment.</Alert>}
            </>
          )}
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Registry history and previous releases" subtitle="Threshold history, lifecycle movements, and release actions">
        <Box sx={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${T.border}`, borderRadius: 2.5 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC', zIndex: 1 }}>
              <tr>
                {['Model Name', 'Version', 'Stage', 'Algorithm', 'Registered Threshold', 'Deployed Threshold', 'Active Production Threshold', 'FP Suppression', 'Event Loss', 'Validation Status', 'Approval Status', 'Registration Status', 'Deployment Status', 'Updated Date', 'Owner', 'Actions'].map((header) => (
                  <th key={header} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registryHistoryRows.map((row) => (
                <tr key={row.job_id}>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, color: T.text, fontWeight: 800 }}>{row.model_name || row.job_id.slice(0, 8)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{row.version}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{stageLabel(row.stage)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.algorithm || '-'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.selected_threshold, 2)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.deployed_threshold, 2)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.active_production_threshold, 2)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{pct(row.metrics?.suppression_rate_pct, 1)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{pct(row.metrics?.event_loss_pct, 1)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.validation_status}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.approval_status}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.registration_status}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.deployment_status}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{fmtDate(row.updated_at)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>{row.owner}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      <Button size="small" onClick={() => openDetailsDrawer(row)} sx={{ textTransform: 'none', minWidth: 0 }}>View Details</Button>
                      <Button size="small" onClick={() => setCompareIds((previous) => previous.includes(row.job_id) ? previous : [...previous.slice(-3), row.job_id])} sx={{ textTransform: 'none', minWidth: 0 }}>Compare</Button>
                      <Button size="small" onClick={() => handlePromoteStage(row.job_id, 'champion')} sx={{ textTransform: 'none', minWidth: 0 }}>Promote</Button>
                      <Button size="small" onClick={() => setArchiveDialog({ open: true, row })} sx={{ textTransform: 'none', minWidth: 0 }}>Archive</Button>
                      <Button size="small" onClick={() => openDetailsDrawer(row, 5)} sx={{ textTransform: 'none', minWidth: 0 }}>View Deployment</Button>
                      <Button size="small" onClick={() => scrollToRef(auditRef)} sx={{ textTransform: 'none', minWidth: 0 }}>View Audit</Button>
                    </Stack>
                  </td>
                </tr>
              ))}
              {!registryHistoryRows.length ? (
                <tr>
                  <td colSpan={16} style={{ padding: '24px 16px' }}>
                    <Alert severity="info" sx={{ borderRadius: 2 }}>
                      This area keeps release governance, threshold history, and deployment traceability for AML suppression models. Register the current run or import an external model to start the governed history.
                    </Alert>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Box>
      </EnterpriseSection>

      <EnterpriseSection title="Audit trail and deployment history" subtitle="Human-readable release and threshold history for compliance, rollback, and review">
        <Box ref={auditRef} sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '0.9fr 1.1fr' } }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Deployment history</Typography>
            <Box sx={{ mt: 1.2, maxHeight: 320, overflow: 'auto', border: `1px solid ${T.border}`, borderRadius: 2 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC' }}>
                  <tr>
                    {['Deployment Version', 'Model', 'Deployed Threshold', 'Status', 'Created', 'Rollback Context'].map((header) => (
                      <th key={header} style={{ textAlign: 'left', padding: '9px 12px', borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deploymentHistory.map((row) => (
                    <tr key={row.deployment_id}>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontWeight: 800, color: T.text }}>{row.deployment_name || row.deployment_id}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}` }}>{row.job_id?.slice(0, 8)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontFamily: T.mono }}>{fmtMetric(row.threshold, 2)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}` }}>{row.active ? 'Active Production' : row.status || 'Inactive'}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}` }}>{fmtDate(row.created_at)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}` }}>{row.previous_deployment_id || row.rolled_back_from || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: T.border }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Audit trail</Typography>
            <Stack spacing={1.1} sx={{ mt: 1.2, maxHeight: 320, overflow: 'auto', pr: 0.4 }}>
              {auditTimelineRows.map((entry, index) => (
                <Box key={`${entry.kind}-${index}`} sx={{ p: 1.3, borderRadius: 2, border: `1px solid ${T.border}`, bgcolor: '#FFF' }}>
                  <Typography sx={{ fontSize: 11, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.6 }}>{entry.kind}</Typography>
                  <Typography sx={{ mt: 0.45, fontSize: 12, color: T.ink, lineHeight: 1.6 }}>{entry.text}</Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Box>
      </EnterpriseSection>
      <EnterpriseSection title="Import external model" subtitle="Bring in a compatible .pkl artifact and register it under the same release governance controls" defaultOpen={false} action={<Button size="small" onClick={(event) => { event.stopPropagation(); setImportExpanded((value) => !value); }} sx={{ textTransform: 'none', color: T.orange }}>{importExpanded ? 'Hide import form' : 'Show import form'}</Button>}>
        <Box ref={importRef}>
          <Collapse in={importExpanded || !registryHistoryRows.length}>
            <Stack spacing={1.4}>
              <Box onClick={() => !actionsDisabled && document.getElementById('model-release-import-upload')?.click()} sx={{ p: 2, borderRadius: 2.5, border: `1.5px dashed ${importFile ? T.orange : T.border}`, bgcolor: importFile ? T.orangeSoft : '#FCFCFD', cursor: actionsDisabled ? 'not-allowed' : 'pointer' }}>
                <input id="model-release-import-upload" type="file" accept=".pkl" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0] || null; setImportFile(file); if (file) setImportName(file.name.replace(/\.pkl$/i, '')); }} />
                <Stack direction="row" spacing={1.2} alignItems="center">
                  <CloudUpload sx={{ color: importFile ? T.orange : T.dim }} />
                  <Box>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: importFile ? T.orange : T.text }}>{importFile ? importFile.name : 'Select a .pkl model artifact'}</Typography>
                    <Typography sx={{ fontSize: 11, color: T.muted }}>The uploaded model will be scored against environment data and registered like any workbench-trained model.</Typography>
                  </Box>
                </Stack>
              </Box>
              <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' } }}>
                <TextField size="small" label="Model Name" value={importName} onChange={(event) => setImportName(event.target.value)} />
                <TextField size="small" label="Target Column" value={importTarget} onChange={(event) => setImportTarget(event.target.value)} />
                <Select size="small" value={importStage} onChange={(event) => setImportStage(event.target.value)}>
                  <MenuItem value="candidate">Candidate</MenuItem>
                  <MenuItem value="challenger">Challenger</MenuItem>
                  <MenuItem value="champion">Champion</MenuItem>
                </Select>
                <TextField size="small" label="Threshold" type="number" value={importThreshold} onChange={(event) => setImportThreshold(event.target.value)} inputProps={{ min: 0, max: 1, step: 0.01 }} />
              </Box>
              <TextField size="small" label="Notes" value={importNotes} onChange={(event) => setImportNotes(event.target.value)} multiline minRows={2} />
              {importError ? <Alert severity="error" sx={{ borderRadius: 2 }}>{importError}</Alert> : null}
              <Button variant="contained" startIcon={importUploading ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <UploadFile />} onClick={handleImportModel} disabled={!importFile || importUploading || actionsDisabled} sx={{ alignSelf: 'flex-start', textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
                {importUploading ? 'Importing model...' : 'Upload, score and register'}
              </Button>
            </Stack>
          </Collapse>
        </Box>
      </EnterpriseSection>

      <Dialog open={deployDialogOpen} onClose={() => setDeployDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 800 }}>Confirm deployment</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={0.8}>
            <KeyValueRow label="Model Name" value={modelName} />
            <KeyValueRow label="Version" value={version} />
            <KeyValueRow label="Lifecycle Stage" value={stageLabel(currentRegistryEntry?.stage || lifecycleStage)} />
            <KeyValueRow label="Registered Threshold" value={fmtMetric(registeredThreshold, 2)} mono />
            <KeyValueRow label="Deployment Threshold" value={fmtMetric(deploymentThreshold, 2)} mono highlight />
            <KeyValueRow label="Expected business impact" value={`${pct(currentSnapshot.suppression, 1)} review reduction / ${pct(currentSnapshot.eventLoss, 1)} potential risk miss`} />
            <KeyValueRow label="Guardrail confirmation" value={guardrail.status} helper={guardrail.detail} />
          </Stack>
          <Alert severity="warning" sx={{ mt: 1.6, borderRadius: 2 }}>
            You are deploying this model with threshold {fmtMetric(deploymentThreshold, 2)}. This threshold will be locked for deployment version {deploymentVersionName || 'new_release_version'}.
          </Alert>
          <TextField size="small" fullWidth multiline minRows={3} sx={{ mt: 1.6 }} label="Deployment notes" value={deploymentNotes} onChange={(event) => setDeploymentNotes(event.target.value)} />
          {deployedThresholdDiffersFromValidation ? (
            <Alert severity="info" sx={{ mt: 1.3, borderRadius: 2 }} onClick={() => setDiffAck((value) => !value)}>
              <strong>{diffAck ? 'Acknowledged.' : 'Acknowledgement required.'}</strong> The deployment threshold differs from the locked validation threshold or active production history.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDeployDialogOpen(false)} sx={{ textTransform: 'none', color: T.muted }}>Cancel</Button>
          <Button variant="contained" startIcon={deploying ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <RocketLaunch />} onClick={executeDeploy} disabled={deploying || (deployedThresholdDiffersFromValidation && !diffAck)} sx={{ textTransform: 'none', bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, fontWeight: 800 }}>
            {deploying ? 'Deploying...' : 'Confirm deploy'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={archiveDialog.open} onClose={() => setArchiveDialog({ open: false, row: null })} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 17, fontWeight: 800 }}>Archive model</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            This will archive {archiveDialog.row?.model_name || archiveDialog.row?.job_id || 'the selected model'} from the governed registry.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setArchiveDialog({ open: false, row: null })} sx={{ textTransform: 'none', color: T.muted }}>Cancel</Button>
          <Button onClick={handleArchive} variant="contained" sx={{ textTransform: 'none', bgcolor: T.ink, '&:hover': { bgcolor: '#162234' } }}>Archive</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={featureExplainOpen} onClose={() => setFeatureExplainOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 17, fontWeight: 800 }}>Explain feature importance: {featureExplainFeature?.feature || featureExplainFeature?.name || 'Feature'}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            Importance {fmtMetric(featureExplainFeature?.importance ?? featureExplainFeature?.value, 4)}.
          </Typography>
          {featureExplainLoading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} sx={{ color: T.orange }} /></Stack> : (
            <Typography sx={{ mt: 1.3, fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>
              {featureExplain?.summary || featureExplain?.business_summary || 'This feature stands out because the fitted model repeatedly found it useful for separating suspicious cases from suppressible alerts in the holdout sample.'}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setFeatureExplainOpen(false)} sx={{ textTransform: 'none', color: T.muted }}>Close</Button>
        </DialogActions>
      </Dialog>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { width: { xs: '100%', md: 540 }, p: 2.5 } }}>
        <Typography sx={{ fontSize: 20, fontWeight: 900, color: T.text }}>{drawerModel?.model_name || drawerModel?.label || drawerModel?.job_id?.slice(0, 8) || 'Model details'}</Typography>
        <Typography sx={{ mt: 0.4, fontSize: 12, color: T.muted }}>{drawerModel?.algorithm_display || drawerModel?.algorithm || ''}</Typography>
        <Tabs value={drawerTab} onChange={(_, value) => setDrawerTab(value)} variant="scrollable" scrollButtons="auto" sx={{ mt: 1.2 }}>
          {['Overview', 'Business Summary', 'Metrics', 'Data & Features', 'Registration', 'Deployment', 'Artifacts', 'Audit Trail'].map((label, index) => <Tab key={label} value={index} label={label} sx={{ textTransform: 'none', minHeight: 40 }} />)}
        </Tabs>
        <DrawerTabPanel value={drawerTab} index={0}><Stack spacing={0.4}><KeyValueRow label="Run ID" value={drawerModel?.job_id || '-'} mono /><KeyValueRow label="Stage" value={stageLabel(drawerModel?.stage || drawerModel?.registry_stage)} /><KeyValueRow label="Validation Status" value={drawerModel?.validation_status || 'Validation Complete'} /><KeyValueRow label="Registered Threshold" value={fmtMetric(drawerModel?.selected_threshold, 2)} mono /><KeyValueRow label="Deployed Threshold" value={fmtMetric(drawerModel?.deployment?.threshold, 2)} mono /></Stack></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={1}><Typography sx={{ fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>This release is designed to reduce false-positive AML review effort while keeping suspicious activity review inside the approved risk boundary.</Typography></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={2}><Stack spacing={0.4}><KeyValueRow label="ROC-AUC" value={fmtMetric(drawerModel?.metrics?.roc_auc, 4)} mono /><KeyValueRow label="Precision" value={fmtMetric(drawerModel?.metrics?.precision, 4)} mono /><KeyValueRow label="Recall" value={fmtMetric(drawerModel?.metrics?.recall, 4)} mono /><KeyValueRow label="F1" value={fmtMetric(drawerModel?.metrics?.f1, 4)} mono /></Stack></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={3}><FeatureImportanceChart rows={drawerModel?.feature_importance || featureRows} onExplain={handleExplainFeature} /></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={4}><Stack spacing={0.4}><KeyValueRow label="Version" value={parseReleaseMetadata(drawerModel, drawerModel).version} /><KeyValueRow label="Owner" value={parseReleaseMetadata(drawerModel, drawerModel).owner} /><KeyValueRow label="Stage" value={stageLabel(drawerModel?.stage)} /><KeyValueRow label="Registered Threshold" value={fmtMetric(drawerModel?.selected_threshold, 2)} mono /></Stack></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={5}><Stack spacing={0.4}><KeyValueRow label="Deployment version" value={drawerModel?.deployment?.deployment_name || drawerModel?.deployment?.deployment_id || '-'} /><KeyValueRow label="Deployed threshold" value={fmtMetric(drawerModel?.deployment?.threshold, 2)} mono highlight /><KeyValueRow label="Lock status" value={drawerModel?.deployment ? 'Locked for this deployment version' : 'No deployment version yet'} /><KeyValueRow label="Deployment date" value={fmtDate(drawerModel?.deployment?.created_at)} /></Stack></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={6}><Stack spacing={1}><Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExportModel('card')} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>Download Model Card</Button><Button variant="outlined" startIcon={<CloudDownload />} onClick={() => handleExportModel('artifact')} sx={{ textTransform: 'none', borderColor: T.border, color: T.muted }}>Download Model Artifact</Button></Stack></DrawerTabPanel>
        <DrawerTabPanel value={drawerTab} index={7}><Stack spacing={1.1}>{auditTimelineRows.slice(0, 12).map((row, index) => <Box key={`${row.kind}-${index}`} sx={{ p: 1.25, borderRadius: 2, border: `1px solid ${T.border}` }}><Typography sx={{ fontSize: 10.5, color: T.dim, textTransform: 'uppercase', letterSpacing: 0.6 }}>{row.kind}</Typography><Typography sx={{ mt: 0.45, fontSize: 11.8, color: T.ink, lineHeight: 1.6 }}>{row.text}</Typography></Box>)}</Stack></DrawerTabPanel>
      </Drawer>
    </Stack>
  );
};

export default ModelReleaseScreen;
