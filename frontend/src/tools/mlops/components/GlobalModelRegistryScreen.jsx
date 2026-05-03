import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
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
  AccountTree,
  QueryStats,
  TableChart,
  Tune,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';

const D = {
  orange: '#D04A02',
  orangeLight: '#fff1ec',
  green: '#166534',
  greenBg: '#f0fdf4',
  amber: '#b45309',
  amberBg: '#fffbeb',
  red: '#b91c1c',
  redBg: '#fef2f2',
  blue: '#1d4ed8',
  blueBg: '#eff6ff',
  border: '#e2e8f0',
  soft: '#f8fafc',
  muted: '#64748b',
  text: '#1e293b',
  canvas: '#f5f6f8',
};

const unwrap = (res) => {
  const body = res?.data ?? res;
  return body?.data ?? body;
};

const num = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fmt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : '-';
};

const dec = (value, digits = 4) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '-';
};

const pct = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(digits)}%` : '-';
};

const formatRate = (value, digits = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  if (Math.abs(parsed) <= 1) return `${(parsed * 100).toFixed(digits)}%`;
  return `${parsed.toFixed(digits)}%`;
};

const titleCaseKey = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (m) => m.toUpperCase());

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const algorithmLabel = (run = {}) => {
  const display = String(run.algorithm_display || '').trim();
  if (display) return display;
  return String(run.algorithm || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) || 'Unknown';
};

const pipelineLabel = (run = {}) => {
  const name = String(run.pipeline_name || '').trim();
  if (name) return name;
  const pipelineId = num(run.pipeline_id);
  if (pipelineId != null) return `Pipeline ${pipelineId}`;
  return 'Shared workspace';
};

const grainLabel = (grain) => {
  const normalized = String(grain || '').trim().toLowerCase();
  if (normalized === 'case') return 'Case grain';
  if (normalized === 'entity') return 'Entity grain';
  return 'Alert grain';
};

const displayRunRef = (value) => {
  const text = String(value || '').trim();
  if (!text.includes(':')) return text;
  const parts = text.split(':');
  if (parts[0] === 'mule-workbench' || parts[0] === 'mule-build' || parts[0] === 'mule-pipeline') {
    return `pipeline ${parts[1]} / run ${parts[2]}`;
  }
  return parts[parts.length - 1];
};

const isBinaryConfusionMatrix = (value) => (
  Array.isArray(value)
  && value.length === 2
  && Array.isArray(value[0])
  && value[0].length >= 2
  && Array.isArray(value[1])
  && value[1].length >= 2
);

const resolveThreshold = (run = {}) => {
  const metrics = run?.metrics && typeof run.metrics === 'object' ? run.metrics : {};
  return num(
    run.selected_threshold
    ?? run.threshold
    ?? run.optimal_threshold
    ?? metrics.selected_threshold
    ?? metrics.optimal_threshold
    ?? metrics.selected_threshold_row?.threshold,
  );
};

const normalizeRunSummary = (run = {}) => {
  const metrics = run?.metrics && typeof run.metrics === 'object' ? run.metrics : {};
  return {
    jobId: String(run.job_id || run.run_id || '').trim(),
    label: String(run.label || '').trim() || algorithmLabel(run),
    algorithm: algorithmLabel(run),
    pipeline: pipelineLabel(run),
    pipelineId: num(run.pipeline_id),
    trainedAt: String(run.trained_at || '').trim(),
    threshold: resolveThreshold(run),
    auc: num(run.roc_auc ?? metrics.roc_auc),
    f1: num(run.f1 ?? metrics.f1),
    precision: num(run.precision ?? metrics.precision),
    recall: num(run.recall ?? metrics.recall),
    suppressionPct: num(run.suppression_rate_pct ?? metrics.suppression_rate_pct),
    eventLossPct: num(run.event_loss_pct ?? metrics.event_loss_pct),
    grain: String(run.grain || 'alert').trim().toLowerCase() || 'alert',
    sourceType: String(run.source_type || '').trim(),
    raw: run,
  };
};

const normalizeHyperparams = (detail = {}) => {
  const source = detail?.hyperparams && typeof detail.hyperparams === 'object'
    ? detail.hyperparams
    : detail?.training_config && typeof detail.training_config === 'object'
      ? detail.training_config
      : {};

  return Object.entries(source)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 16)
    .map(([key, value]) => ({
      key,
      label: titleCaseKey(key),
      value: String(value),
    }));
};

const normalizeFeatureImportance = (detail = {}) => {
  const candidates = Array.isArray(detail?.feature_importance)
    ? detail.feature_importance
    : detail?.model_internals?.viz_type === 'feature_importance' && Array.isArray(detail?.model_internals?.data)
      ? detail.model_internals.data
      : [];

  const rows = candidates
    .map((item) => ({
      feature: String(item?.feature || item?.name || item?.column || '').trim(),
      value: Math.abs(num(item?.importance ?? item?.score ?? item?.gain ?? item?.weight ?? item?.coef ?? item?.value, 0) || 0),
    }))
    .filter((item) => item.feature && item.value > 0);

  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return rows
    .sort((left, right) => right.value - left.value)
    .slice(0, 12)
    .map((row) => ({
      ...row,
      sharePct: total > 0 ? (row.value / total) * 100 : 0,
    }));
};

const normalizeOperatingMetrics = (raw = null, fallback = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const cm = isBinaryConfusionMatrix(source.confusion_matrix)
    ? source.confusion_matrix
    : isBinaryConfusionMatrix(fallback.confusion_matrix)
      ? fallback.confusion_matrix
      : null;

  const tn = num(source.true_negatives ?? source.tn ?? cm?.[0]?.[0], 0);
  const fp = num(source.false_positives ?? source.fp ?? cm?.[0]?.[1], 0);
  const fn = num(source.false_negatives ?? source.fn ?? cm?.[1]?.[0], 0);
  const tp = num(source.true_positives ?? source.tp ?? cm?.[1]?.[1], 0);
  const totalRows = num(source.total_rows ?? fallback.total_rows, tn + fp + fn + tp);
  const actualTrueEvents = num(source.actual_true_events ?? fallback.actual_true_events, tp + fn);
  const actualNonEvents = num(source.actual_non_events ?? fallback.actual_non_events, tn + fp);
  const precisionRate = num(source.precision ?? fallback.precision, tp + fp > 0 ? tp / (tp + fp) : null);
  const recallRate = num(source.recall ?? fallback.recall, actualTrueEvents > 0 ? tp / actualTrueEvents : null);
  const detectionRatePct = recallRate == null ? null : (Math.abs(recallRate) <= 1 ? recallRate * 100 : recallRate);
  const suppressionPct = num(
    source.suppression_rate_pct ?? fallback.suppression_rate_pct,
    totalRows > 0 ? ((tn + fn) / totalRows) * 100 : null,
  );
  const eventLossPct = num(
    source.event_loss_pct ?? fallback.event_loss_pct,
    actualTrueEvents > 0 ? (fn / actualTrueEvents) * 100 : null,
  );
  const accuracyRate = num(source.accuracy ?? fallback.accuracy, totalRows > 0 ? (tp + tn) / totalRows : null);
  const specificityRate = num(
    source.specificity ?? fallback.specificity,
    actualNonEvents > 0 ? tn / actualNonEvents : null,
  );
  const balancedAccuracyRate = num(
    source.balanced_accuracy ?? fallback.balanced_accuracy,
    recallRate != null && specificityRate != null ? (recallRate + specificityRate) / 2 : null,
  );

  if (totalRows <= 0) return null;

  return {
    threshold: num(source.threshold ?? fallback.threshold),
    totalRows,
    actualTrueEvents,
    actualNonEvents,
    actualTrueEventsEscalated: tp,
    falsePositives: fp,
    correctlySuppressedAlerts: tn,
    missedTrueEvents: fn,
    precisionRate,
    detectionRatePct,
    suppressionPct,
    eventLossPct,
    accuracyRate,
    specificityRate,
    balancedAccuracyRate,
  };
};

const normalizeConfusionMatrixTable = (matrix, labels = []) => {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) return null;
  const normalizedMatrix = matrix
    .map((row) => (Array.isArray(row) ? row.map((value) => num(value, 0) ?? 0) : []))
    .filter((row) => row.length > 0);
  if (normalizedMatrix.length === 0) return null;
  return {
    matrix: normalizedMatrix,
    labels: normalizedMatrix.map((_, index) => String(labels[index] || `Class ${index + 1}`)),
  };
};

const toneFromEventLoss = (value) => {
  if (value == null) return null;
  if (value <= 3) return 'good';
  if (value <= 5) return 'warn';
  return 'bad';
};

const toneFromSuppression = (value) => {
  if (value == null) return null;
  if (value >= 45) return 'good';
  if (value >= 35) return 'warn';
  return null;
};

const StatCard = ({ label, value, sub, tone = null }) => {
  const toneStyles = {
    good: { bg: D.greenBg, color: D.green, border: '#cdebd5' },
    warn: { bg: D.amberBg, color: D.amber, border: '#f4dfba' },
    bad: { bg: D.redBg, color: D.red, border: '#f5d0d0' },
    blue: { bg: D.blueBg, color: D.blue, border: '#cfe0ff' },
    default: { bg: '#fff', color: D.text, border: D.border },
  };
  const styles = toneStyles[tone || 'default'] || toneStyles.default;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.4,
        borderRadius: 2,
        minWidth: 148,
        flex: '1 1 148px',
        bgcolor: styles.bg,
        borderColor: styles.border,
      }}
    >
      <Typography sx={{ fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
        {label}
      </Typography>
      <Typography sx={{ mt: 0.35, fontSize: 18, fontWeight: 800, color: styles.color, fontFamily: 'monospace' }}>
        {value}
      </Typography>
      {sub ? (
        <Typography sx={{ mt: 0.35, fontSize: 11, color: D.muted, lineHeight: 1.45 }}>
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
};

const BusinessMetricBox = ({ title, technical, value, tone = null }) => {
  const toneMap = {
    good: { bg: D.greenBg, color: D.green },
    warn: { bg: D.amberBg, color: D.amber },
    bad: { bg: D.redBg, color: D.red },
    default: { bg: D.soft, color: D.text },
  };
  const styles = toneMap[tone || 'default'] || toneMap.default;

  return (
    <Box
      sx={{
        p: 1.35,
        borderRadius: 2,
        border: `1px solid ${D.border}`,
        bgcolor: styles.bg,
      }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.text }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.25, fontSize: 17, fontWeight: 800, color: styles.color, fontFamily: 'monospace' }}>
        {value}
      </Typography>
      <Typography sx={{ mt: 0.25, fontSize: 10.5, color: D.muted }}>
        {technical}
      </Typography>
    </Box>
  );
};

const OperatingMatrixPanel = ({ title, metrics }) => {
  if (!metrics) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
          {title}
        </Typography>
        <Typography sx={{ mt: 0.6, fontSize: 11.5, color: D.muted }}>
          Operating metrics were not captured for this run snapshot.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
            {title}
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 11.25, color: D.muted }}>
            Business-readable operating outcomes with technical mapping kept visible for model review.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.1} flexWrap="wrap" useFlexGap>
          <StatCard label="Rows Evaluated" value={fmt(metrics.totalRows)} />
          <StatCard label="Actual True Events" value={fmt(metrics.actualTrueEvents)} />
          <StatCard label="True Event Detection Rate" value={pct(metrics.detectionRatePct)} tone="blue" />
          <StatCard label="Suppression Rate" value={pct(metrics.suppressionPct)} tone={toneFromSuppression(metrics.suppressionPct)} />
          <StatCard label="Event Loss" value={pct(metrics.eventLossPct)} tone={toneFromEventLoss(metrics.eventLossPct)} />
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          }}
        >
          <BusinessMetricBox
            title="Actual True Events Escalated"
            technical="Technical: True Positives (TP)"
            value={fmt(metrics.actualTrueEventsEscalated)}
            tone="good"
          />
          <BusinessMetricBox
            title="False Positives"
            technical="Technical: False Positives (FP)"
            value={fmt(metrics.falsePositives)}
            tone="warn"
          />
          <BusinessMetricBox
            title="Correctly Suppressed Alerts"
            technical="Technical: True Negatives (TN)"
            value={fmt(metrics.correctlySuppressedAlerts)}
            tone="good"
          />
          <BusinessMetricBox
            title="Missed True Events"
            technical="Technical: False Negatives (FN)"
            value={fmt(metrics.missedTrueEvents)}
            tone="bad"
          />
        </Box>
      </Stack>
    </Paper>
  );
};

const ConfusionMatrixTablePanel = ({ title, matrixData }) => {
  if (!matrixData) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
          {title}
        </Typography>
        <Typography sx={{ mt: 0.6, fontSize: 11.5, color: D.muted }}>
          A saved confusion matrix is not available for this run snapshot.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.25, fontSize: 11.25, color: D.muted }}>
        Class-by-class prediction counts saved with this run.
      </Typography>
      <Box sx={{ mt: 1.25, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: D.soft }}>
              <th
                style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: 9.5,
                  color: D.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  borderBottom: `1px solid ${D.border}`,
                }}
              >
                Actual Class
              </th>
              {matrixData.labels.map((label) => (
                <th
                  key={`pred-${label}`}
                  style={{
                    padding: '6px 10px',
                    textAlign: 'right',
                    fontSize: 9.5,
                    color: D.muted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    borderBottom: `1px solid ${D.border}`,
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixData.matrix.map((row, rowIndex) => (
              <tr key={`row-${matrixData.labels[rowIndex]}`} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: '7px 10px', fontSize: 11.5, fontWeight: 700, color: D.text }}>
                  {matrixData.labels[rowIndex]}
                </td>
                {row.map((value, colIndex) => (
                  <td
                    key={`cell-${rowIndex}-${colIndex}`}
                    style={{
                      padding: '7px 10px',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color: rowIndex === colIndex ? D.green : D.text,
                      fontWeight: rowIndex === colIndex ? 700 : 400,
                    }}
                  >
                    {fmt(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Paper>
  );
};

const sortRows = (rows, sortBy) => {
  const next = [...rows];
  switch (sortBy) {
    case 'auc_desc':
      return next.sort((a, b) => (b.auc ?? -Infinity) - (a.auc ?? -Infinity));
    case 'event_loss_asc':
      return next.sort((a, b) => (a.eventLossPct ?? Infinity) - (b.eventLossPct ?? Infinity));
    case 'suppression_desc':
      return next.sort((a, b) => (b.suppressionPct ?? -Infinity) - (a.suppressionPct ?? -Infinity));
    case 'algorithm_asc':
      return next.sort((a, b) => a.algorithm.localeCompare(b.algorithm));
    case 'pipeline_asc':
      return next.sort((a, b) => a.pipeline.localeCompare(b.pipeline));
    case 'trained_at_asc':
      return next.sort((a, b) => String(a.trainedAt || '').localeCompare(String(b.trainedAt || '')));
    case 'trained_at_desc':
    default:
      return next.sort((a, b) => String(b.trainedAt || '').localeCompare(String(a.trainedAt || '')));
  }
};

const GlobalModelRegistryScreen = () => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [detailCache, setDetailCache] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [search, setSearch] = useState('');
  const [algorithmFilter, setAlgorithmFilter] = useState('all');
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [sortBy, setSortBy] = useState('trained_at_desc');
  const [detailTab, setDetailTab] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    mlopsApi.listTrainingRuns({ limit: 1000, scope: 'global_registry' })
      .then((res) => {
        if (cancelled) return;
        const rows = unwrap(res);
        const normalized = (Array.isArray(rows) ? rows : [])
          .map(normalizeRunSummary)
          .filter((row) => row.jobId);
        setRuns(normalized);
      })
      .catch((err) => {
        if (cancelled) return;
        setRuns([]);
        setError(err?.response?.data?.error || err?.message || 'Failed to load saved training runs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const algorithmOptions = useMemo(() => [...new Set(runs.map((run) => run.algorithm))].sort(), [runs]);
  const pipelineOptions = useMemo(() => [...new Set(runs.map((run) => run.pipeline))].sort(), [runs]);

  const filteredRuns = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();
    const filtered = runs.filter((run) => {
      if (algorithmFilter !== 'all' && run.algorithm !== algorithmFilter) return false;
      if (pipelineFilter !== 'all' && run.pipeline !== pipelineFilter) return false;
      if (!needle) return true;
      const haystack = [
        run.label,
        run.algorithm,
        run.pipeline,
        run.jobId,
        run.raw?.target_column || '',
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    return sortRows(filtered, sortBy);
  }, [algorithmFilter, pipelineFilter, runs, search, sortBy]);

  useEffect(() => {
    if (!filteredRuns.length) {
      setSelectedJobId('');
      return;
    }
    const currentVisible = filteredRuns.some((run) => run.jobId === selectedJobId);
    if (!currentVisible) {
      setSelectedJobId(filteredRuns[0].jobId);
      setDetailTab(0);
    }
  }, [filteredRuns, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId || detailCache[selectedJobId]) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');

    mlopsApi.modelResults(selectedJobId)
      .then((res) => {
        if (cancelled) return;
        const detail = unwrap(res);
        setDetailCache((prev) => ({ ...prev, [selectedJobId]: detail }));
      })
      .catch((err) => {
        if (cancelled) return;
        setDetailError(err?.response?.data?.error || err?.message || 'Failed to load run detail.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailCache, selectedJobId]);

  const selectedSummary = useMemo(
    () => filteredRuns.find((run) => run.jobId === selectedJobId) || runs.find((run) => run.jobId === selectedJobId) || null,
    [filteredRuns, runs, selectedJobId],
  );

  const selectedDetail = selectedJobId ? detailCache[selectedJobId] || null : null;
  const selectedThreshold = num(
    selectedDetail?.selected_threshold
    ?? selectedSummary?.threshold
    ?? selectedDetail?.metrics?.selected_threshold_row?.threshold
    ?? selectedDetail?.metrics?.optimal_threshold,
  );
  const selectedHyperparams = useMemo(() => normalizeHyperparams(selectedDetail || {}), [selectedDetail]);
  const selectedFeatureImportance = useMemo(() => normalizeFeatureImportance(selectedDetail || {}), [selectedDetail]);
  const selectedTrainMetrics = useMemo(() => normalizeOperatingMetrics(selectedDetail?.train_operating_metrics, {
    total_rows: selectedDetail?.train_rows ?? selectedDetail?.summary?.train_rows,
  }), [selectedDetail]);
  const selectedTestMetrics = useMemo(() => normalizeOperatingMetrics(
    selectedDetail?.test_operating_metrics,
    {
      confusion_matrix: selectedDetail?.confusion_matrix ?? selectedDetail?.metrics?.selected_threshold_row?.confusion_matrix ?? selectedDetail?.metrics?.confusion_matrix,
      total_rows: selectedDetail?.test_rows ?? selectedDetail?.summary?.test_rows,
      suppression_rate_pct: selectedDetail?.suppression_rate_pct ?? selectedDetail?.metrics?.suppression_rate_pct,
      event_loss_pct: selectedDetail?.event_loss_pct ?? selectedDetail?.metrics?.event_loss_pct,
      precision: selectedDetail?.precision ?? selectedDetail?.metrics?.precision,
      recall: selectedDetail?.recall ?? selectedDetail?.metrics?.recall,
      accuracy: selectedDetail?.metrics?.accuracy,
      specificity: selectedDetail?.specificity ?? selectedDetail?.metrics?.specificity,
      balanced_accuracy: selectedDetail?.metrics?.balanced_accuracy,
    },
  ), [selectedDetail]);
  const selectedTrainMatrixTable = useMemo(
    () => normalizeConfusionMatrixTable(
      selectedDetail?.train_confusion_matrix,
      selectedDetail?.train_confusion_matrix_labels ?? selectedDetail?.confusion_matrix_labels ?? [],
    ),
    [selectedDetail],
  );
  const selectedTestMatrixTable = useMemo(
    () => normalizeConfusionMatrixTable(
      selectedDetail?.test_confusion_matrix ?? selectedDetail?.confusion_matrix ?? selectedDetail?.metrics?.confusion_matrix,
      selectedDetail?.confusion_matrix_labels ?? [],
    ),
    [selectedDetail],
  );

  const summaryCards = useMemo(() => {
    const totalRuns = filteredRuns.length;
    const pipelineCount = new Set(filteredRuns.map((run) => run.pipeline)).size;
    const suppressionRows = filteredRuns.filter((run) => run.suppressionPct != null);
    const eventLossRows = filteredRuns.filter((run) => run.eventLossPct != null);
    const avgSuppression = suppressionRows.length
      ? suppressionRows.reduce((sum, run) => sum + run.suppressionPct, 0) / suppressionRows.length
      : null;
    const avgEventLoss = eventLossRows.length
      ? eventLossRows.reduce((sum, run) => sum + run.eventLossPct, 0) / eventLossRows.length
      : null;
    return { totalRuns, pipelineCount, avgSuppression, avgEventLoss };
  }, [filteredRuns]);

  return (
    <Box sx={{ bgcolor: D.canvas, minHeight: '100%', p: { xs: 1, md: 2 } }}>
      <Paper variant="outlined" sx={{ borderRadius: 3, borderColor: D.border, overflow: 'hidden' }}>
        <Box sx={{ px: 2.25, py: 1.75, bgcolor: '#fff', borderBottom: `1px solid ${D.border}` }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={1.1} alignItems="center">
              <TableChart sx={{ fontSize: 18, color: D.orange }} />
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: D.text }}>
                  Global Model Registry
                </Typography>
                <Typography sx={{ fontSize: 11.25, color: D.muted }}>
                  Real training history across saved workbench pipelines and model stores in the current environment.
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`${fmt(summaryCards.totalRuns)} runs`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
              <Chip size="small" label={`${fmt(summaryCards.pipelineCount)} pipelines`} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
              <Chip size="small" label={`Avg suppression ${pct(summaryCards.avgSuppression)}`} sx={{ bgcolor: D.orangeLight, color: D.orange, border: `1px solid #fdba74` }} />
              <Chip size="small" label={`Avg event loss ${pct(summaryCards.avgEventLoss)}`} sx={{ bgcolor: D.blueBg, color: D.blue, border: `1px solid #bfdbfe` }} />
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25}>
                <TextField
                  size="small"
                  label="Search runs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ minWidth: 240 }}
                />
                <Select size="small" value={algorithmFilter} onChange={(e) => setAlgorithmFilter(String(e.target.value))} sx={{ minWidth: 220 }}>
                  <MenuItem value="all">All algorithms</MenuItem>
                  {algorithmOptions.map((algorithm) => (
                    <MenuItem key={algorithm} value={algorithm}>{algorithm}</MenuItem>
                  ))}
                </Select>
                <Select size="small" value={pipelineFilter} onChange={(e) => setPipelineFilter(String(e.target.value))} sx={{ minWidth: 220 }}>
                  <MenuItem value="all">All pipelines</MenuItem>
                  {pipelineOptions.map((pipeline) => (
                    <MenuItem key={pipeline} value={pipeline}>{pipeline}</MenuItem>
                  ))}
                </Select>
                <Select size="small" value={sortBy} onChange={(e) => setSortBy(String(e.target.value))} sx={{ minWidth: 230 }}>
                  <MenuItem value="trained_at_desc">Newest first</MenuItem>
                  <MenuItem value="trained_at_asc">Oldest first</MenuItem>
                  <MenuItem value="auc_desc">Highest ROC-AUC</MenuItem>
                  <MenuItem value="event_loss_asc">Lowest event loss</MenuItem>
                  <MenuItem value="suppression_desc">Highest suppression</MenuItem>
                  <MenuItem value="algorithm_asc">Algorithm A-Z</MenuItem>
                  <MenuItem value="pipeline_asc">Pipeline A-Z</MenuItem>
                </Select>
              </Stack>
            </Paper>

            {error ? <Alert severity="error">{error}</Alert> : null}

            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${D.border}`, bgcolor: '#fff' }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
                  Registry Table
                </Typography>
                <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.2 }}>
                  Click any row to inspect the saved pipeline, operating metrics, hyperparameters, and feature importance for that run.
                </Typography>
              </Box>

              {loading ? (
                <Box sx={{ py: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={26} sx={{ color: D.orange }} />
                </Box>
              ) : filteredRuns.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: 12.5, color: D.muted }}>
                    No completed training runs are available for this environment yet.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: D.soft }}>
                        {['Model', 'Pipeline', 'Trained', 'Threshold', 'AUC', 'F1', 'Precision', 'Recall', 'Suppression', 'Event Loss'].map((heading) => (
                          <th
                            key={heading}
                            style={{
                              padding: '7px 10px',
                              textAlign: heading === 'Model' || heading === 'Pipeline' || heading === 'Trained' ? 'left' : 'right',
                              fontSize: 9.5,
                              color: D.muted,
                              textTransform: 'uppercase',
                              letterSpacing: 0.55,
                              borderBottom: `1px solid ${D.border}`,
                            }}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((run) => {
                        const selected = run.jobId === selectedJobId;
                        return (
                          <tr
                            key={run.jobId}
                            onClick={() => {
                              setSelectedJobId(run.jobId);
                              setDetailTab(0);
                            }}
                            style={{
                              cursor: 'pointer',
                              background: selected ? '#fff7ed' : '#fff',
                              borderBottom: `1px solid ${D.border}`,
                            }}
                          >
                            <td style={{ padding: '8px 10px' }}>
                              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: D.text }}>
                                {run.label}
                              </Typography>
                              <Typography sx={{ fontSize: 10.5, color: D.muted }}>
                                {run.algorithm} · {displayRunRef(run.jobId)}
                              </Typography>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <Typography sx={{ fontSize: 11.5, color: D.text }}>
                                {run.pipeline}
                              </Typography>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <Typography sx={{ fontSize: 11.25, color: D.text }}>
                                {formatDateTime(run.trainedAt)}
                              </Typography>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.threshold, 2)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.orange, fontWeight: 700 }}>{dec(run.auc)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.f1)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.precision)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.recall)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: toneFromSuppression(run.suppressionPct) === 'good' ? D.green : toneFromSuppression(run.suppressionPct) === 'warn' ? D.amber : D.text }}>{pct(run.suppressionPct)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: toneFromEventLoss(run.eventLossPct) === 'good' ? D.green : toneFromEventLoss(run.eventLossPct) === 'warn' ? D.amber : D.red }}>{pct(run.eventLossPct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Box>
              )}
            </Paper>

            {selectedSummary ? (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.4, bgcolor: '#fff', borderBottom: `1px solid ${D.border}` }}>
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ lg: 'center' }}>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: D.text }}>
                        {selectedSummary.label}
                      </Typography>
                      <Typography sx={{ fontSize: 11.25, color: D.muted, mt: 0.25 }}>
                        {selectedSummary.algorithm} · {displayRunRef(selectedSummary.jobId)}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip size="small" icon={<AccountTree sx={{ fontSize: 14 }} />} label={selectedSummary.pipeline} sx={{ bgcolor: '#fff', border: `1px solid ${D.border}` }} />
                      <Chip size="small" icon={<QueryStats sx={{ fontSize: 14 }} />} label={`Threshold ${dec(selectedThreshold, 2)}`} sx={{ bgcolor: D.orangeLight, color: D.orange, border: `1px solid #fdba74` }} />
                      <Chip size="small" icon={<Tune sx={{ fontSize: 14 }} />} label={grainLabel(selectedSummary.grain)} sx={{ bgcolor: D.blueBg, color: D.blue, border: `1px solid #bfdbfe` }} />
                    </Stack>
                  </Stack>
                </Box>

                <Box sx={{ p: 2 }}>
                  {detailError ? <Alert severity="error" sx={{ mb: 1.5 }}>{detailError}</Alert> : null}
                  {detailLoading && !selectedDetail ? (
                    <Box sx={{ py: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CircularProgress size={24} sx={{ color: D.orange }} />
                    </Box>
                  ) : selectedDetail ? (
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={1.1} flexWrap="wrap" useFlexGap>
                        <StatCard label="Train Rows" value={fmt(selectedDetail?.train_rows ?? selectedDetail?.summary?.train_rows)} />
                        <StatCard label="Test Rows" value={fmt(selectedDetail?.test_rows ?? selectedDetail?.summary?.test_rows)} />
                        <StatCard label="ROC-AUC" value={dec(selectedSummary.auc)} tone="blue" />
                        <StatCard label="Suppression" value={pct(selectedSummary.suppressionPct)} tone={toneFromSuppression(selectedSummary.suppressionPct)} />
                        <StatCard label="Event Loss" value={pct(selectedSummary.eventLossPct)} tone={toneFromEventLoss(selectedSummary.eventLossPct)} />
                        <StatCard label="Target Column" value={String(selectedDetail?.target_column || '-')} />
                      </Stack>

                      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                              Run Context
                            </Typography>
                            <Typography sx={{ mt: 0.5, fontSize: 11.5, color: D.text, lineHeight: 1.7 }}>
                              This run was captured from <strong>{selectedSummary.pipeline}</strong> and loaded from saved backend training artefacts for the current environment.
                            </Typography>
                          </Box>
                          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: 10, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                              Trained At
                            </Typography>
                            <Typography sx={{ mt: 0.5, fontSize: 11.5, color: D.text, lineHeight: 1.7 }}>
                              {formatDateTime(selectedDetail?.trained_at || selectedSummary.trainedAt)}
                            </Typography>
                            <Typography sx={{ mt: 0.6, fontSize: 10.75, color: D.muted }}>
                              Pipeline ID: {selectedSummary.pipelineId != null ? selectedSummary.pipelineId : '-'}
                            </Typography>
                          </Box>
                        </Stack>
                      </Paper>

                      <Tabs value={detailTab} onChange={(_, next) => setDetailTab(next)} sx={{ borderBottom: `1px solid ${D.border}` }}>
                        <Tab label="Overview" />
                        <Tab label="Train Matrix" />
                        <Tab label="Test Matrix" />
                        <Tab label="Feature Importance" />
                      </Tabs>

                      {detailTab === 0 && (
                        <Stack spacing={2}>
                          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                            <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55, mb: 1 }}>
                              Hyperparameters
                            </Typography>
                            {selectedHyperparams.length > 0 ? (
                              <Box
                                sx={{
                                  display: 'grid',
                                  gap: 1,
                                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(3, minmax(0, 1fr))' },
                                }}
                              >
                                {selectedHyperparams.map((item) => (
                                  <Box key={item.key} sx={{ p: 1, border: `1px solid ${D.border}`, borderRadius: 1.5, bgcolor: D.soft }}>
                                    <Typography sx={{ fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.45 }}>
                                      {item.label}
                                    </Typography>
                                    <Typography sx={{ mt: 0.35, fontSize: 12, fontWeight: 700, color: D.text, fontFamily: 'monospace' }}>
                                      {item.value}
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ) : (
                              <Typography sx={{ fontSize: 11.5, color: D.muted }}>
                                No saved hyperparameter payload is available for this run.
                              </Typography>
                            )}
                          </Paper>

                          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                            <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55, mb: 1 }}>
                              Holdout Operating Summary
                            </Typography>
                            <Stack direction="row" spacing={1.1} flexWrap="wrap" useFlexGap>
                              <StatCard label="Precision" value={formatRate(selectedTestMetrics?.precisionRate)} />
                              <StatCard label="Recall" value={pct(selectedTestMetrics?.detectionRatePct)} />
                              <StatCard label="Accuracy" value={formatRate(selectedTestMetrics?.accuracyRate)} />
                              <StatCard label="Specificity" value={formatRate(selectedTestMetrics?.specificityRate)} />
                              <StatCard label="Balanced Accuracy" value={formatRate(selectedTestMetrics?.balancedAccuracyRate)} />
                            </Stack>
                          </Paper>
                        </Stack>
                      )}

                      {detailTab === 1 && (
                        selectedTrainMetrics
                          ? <OperatingMatrixPanel title="Training Operating Matrix" metrics={selectedTrainMetrics} />
                          : <ConfusionMatrixTablePanel title="Training Confusion Matrix" matrixData={selectedTrainMatrixTable} />
                      )}
                      {detailTab === 2 && (
                        selectedTestMetrics
                          ? <OperatingMatrixPanel title="Holdout Operating Matrix" metrics={selectedTestMetrics} />
                          : <ConfusionMatrixTablePanel title="Holdout Confusion Matrix" matrixData={selectedTestMatrixTable} />
                      )}

                      {detailTab === 3 && (
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                          <Typography sx={{ fontSize: 11, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.55, mb: 1 }}>
                            Feature Importance
                          </Typography>
                          {selectedFeatureImportance.length > 0 ? (
                            <Box sx={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ background: D.soft }}>
                                    {['Rank', 'Feature', 'Relative Share', 'Raw Score'].map((heading) => (
                                      <th
                                        key={heading}
                                        style={{
                                          padding: '6px 10px',
                                          textAlign: heading === 'Feature' ? 'left' : 'right',
                                          fontSize: 9.5,
                                          color: D.muted,
                                          textTransform: 'uppercase',
                                          letterSpacing: 0.5,
                                          borderBottom: `1px solid ${D.border}`,
                                        }}
                                      >
                                        {heading}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedFeatureImportance.map((item, index) => (
                                    <tr key={`${item.feature}-${index}`} style={{ borderBottom: `1px solid ${D.border}` }}>
                                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.muted }}>{index + 1}</td>
                                      <td style={{ padding: '8px 10px' }}>
                                        <Typography sx={{ fontSize: 11.75, fontWeight: 700, color: D.text, fontFamily: 'monospace' }}>
                                          {item.feature}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 10px' }}>
                                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                                          <Box sx={{ width: 160, maxWidth: '100%', height: 8, borderRadius: 999, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
                                            <Box sx={{ width: `${Math.min(item.sharePct, 100)}%`, height: '100%', bgcolor: index === 0 ? D.orange : '#94a3b8' }} />
                                          </Box>
                                          <Typography sx={{ minWidth: 54, textAlign: 'right', fontSize: 11, fontFamily: 'monospace', color: D.text }}>
                                            {pct(item.sharePct)}
                                          </Typography>
                                        </Stack>
                                      </td>
                                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.muted }}>
                                        {dec(item.value, 6)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </Box>
                          ) : (
                            <Typography sx={{ fontSize: 11.5, color: D.muted }}>
                              No saved feature-importance payload is available for this run.
                            </Typography>
                          )}
                        </Paper>
                      )}
                    </Stack>
                  ) : null}
                </Box>
              </Paper>
            ) : null}
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
};

export default GlobalModelRegistryScreen;
