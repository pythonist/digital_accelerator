import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CompareArrows, Refresh } from '@mui/icons-material';
import { V, chartColorForIndex } from './validationTheme';
import { buildCurveGrid, buildRadarData, fmt, normalizeLabel, num, pct } from './validationUtils';
import { SectionCard, SectionTitle, ConfusionMatrixGrid, TableHeader } from './ValidationShared';

const metricGroups = [
  {
    label: 'Discrimination',
    metrics: [
      { key: 'roc_auc', label: 'ROC-AUC' },
      { key: 'average_precision', label: 'PR-AUC' },
      { key: 'gini', label: 'Gini' },
    ],
  },
  {
    label: 'Classification',
    metrics: [
      { key: 'precision', label: 'Precision' },
      { key: 'recall', label: 'Recall' },
      { key: 'f1', label: 'F1' },
      { key: 'accuracy', label: 'Accuracy' },
      { key: 'balanced_accuracy', label: 'Balanced Acc' },
      { key: 'specificity', label: 'Specificity' },
    ],
  },
  {
    label: 'CV',
    metrics: [
      { key: 'cv_auc_mean', label: 'CV AUC' },
      { key: 'cv_auc_std', label: 'CV AUC Std' },
    ],
  },
  {
    label: 'Operational',
    metrics: [
      { key: 'optimal_threshold', label: 'Opt Thresh' },
      { key: 'suppression_rate_pct', label: 'Suppression %' },
      { key: 'event_loss_pct', label: 'Event Loss %' },
    ],
  },
];

const radarMetrics = [
  { key: 'roc_auc', label: 'ROC-AUC' },
  { key: 'average_precision', label: 'PR-AUC' },
  { key: 'f1', label: 'F1' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
  { key: 'balanced_accuracy', label: 'Bal Acc' },
];

const ComparisonTab = ({
  runs,
  selectedJobIds,
  onSelectJobIds,
  compareData,
  loading,
  onCompare,
  onPromoteChampion,
  onArchive,
  onBulkLabel,
}) => {
  const [labelDrafts, setLabelDrafts] = useState({});

  const modelMap = useMemo(() => {
    const map = {};
    (runs || []).forEach((r) => { map[r.job_id] = r; });
    return map;
  }, [runs]);

  const rocGrid = useMemo(
    () => buildCurveGrid(compareData || [], 'roc_curve', 'fpr', 'tpr', 0.02),
    [compareData],
  );
  const prGrid = useMemo(
    () => buildCurveGrid(compareData || [], 'pr_curve', 'recall', 'precision', 0.02),
    [compareData],
  );

  const radarData = useMemo(
    () => buildRadarData(compareData || [], radarMetrics),
    [compareData],
  );

  const applyLabels = async () => {
    const payload = Object.entries(labelDrafts)
      .filter(([, v]) => v && v.trim())
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v.trim() }), {});
    if (Object.keys(payload).length) {
      await onBulkLabel?.(payload);
      setLabelDrafts({});
    }
  };

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
          <SectionTitle
            icon={<CompareArrows sx={{ fontSize: 18, color: V.orange }} />}
            title="Model Comparison"
            subtitle="Compare multiple models across discrimination, classification, and operational metrics."
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Select
              multiple
              size="small"
              value={selectedJobIds}
              onChange={(e) => onSelectJobIds?.(e.target.value)}
              renderValue={(selected) => (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {selected.map((id) => (
                    <Chip key={id} size="small" label={normalizeLabel(modelMap[id])} sx={{ height: 18, fontSize: 9.5 }} />
                  ))}
                </Stack>
              )}
              sx={{ minWidth: 260, fontSize: 12 }}
            >
              {(runs || []).map((run) => (
                <MenuItem key={run.job_id} value={run.job_id}>
                  {normalizeLabel(run)} - {run.algorithm_display || run.algorithm}
                </MenuItem>
              ))}
            </Select>
            <Button
              size="small"
              variant="contained"
              onClick={onCompare}
              disabled={loading || selectedJobIds.length === 0}
              sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
            >
              {loading ? 'Loading...' : 'Apply'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              onClick={onCompare}
              sx={{ textTransform: 'none', borderColor: V.border, color: V.textMuted }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>
          Metrics Comparison Table
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${V.border}`, fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Model
                </th>
                {metricGroups.map((group) => (
                  <th key={group.label} colSpan={group.metrics.length} style={{ textAlign: 'center', padding: '6px 8px', borderBottom: `1px solid ${V.border}`, fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {group.label}
                  </th>
                ))}
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${V.border}`, fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Registry
                </th>
              </tr>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${V.border}` }}> </th>
                {metricGroups.flatMap((group) => group.metrics.map((metric) => (
                  <TableHeader key={`${group.label}-${metric.key}`} text={metric.label} />
                )))}
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${V.border}` }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(compareData || []).map((model, idx) => {
                const metrics = model.metrics || {};
                const label = normalizeLabel(model);
                const color = chartColorForIndex(idx);
                return (
                  <tr key={model.job_id} style={{ borderBottom: `1px solid ${V.border}` }}>
                    <td style={{ padding: '6px 8px', textAlign: 'left' }}>
                      <Stack spacing={0.5}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Box sx={{ width: 6, height: 24, borderRadius: 1, bgcolor: color }} />
                          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>{label}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 10.5, color: V.textMuted }}>{model.algorithm_display || model.algorithm}</Typography>
                        <TextField
                          size="small"
                          placeholder="Edit label"
                          value={labelDrafts[model.job_id] ?? ''}
                          onChange={(e) => setLabelDrafts((p) => ({ ...p, [model.job_id]: e.target.value }))}
                          sx={{ '& .MuiOutlinedInput-root': { fontSize: 11, borderRadius: 1, height: 28 } }}
                        />
                      </Stack>
                    </td>
                    {metricGroups.flatMap((group) => group.metrics.map((metric) => {
                      const raw = metrics[metric.key] ?? model[metric.key];
                      const display = metric.key.includes('pct')
                        ? pct(raw, 2)
                        : metric.key.includes('threshold')
                          ? num(raw, 2)
                          : fmt(raw, 3);
                      return (
                        <td key={`${model.job_id}-${metric.key}`} style={{ textAlign: 'right', padding: '6px 8px', color: V.text }}>
                          {display}
                        </td>
                      );
                    }))}
                    <td style={{ padding: '6px 8px', textAlign: 'left' }}>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => onPromoteChampion?.(model.job_id)}
                          sx={{ height: 24, fontSize: 10.5, bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none' }}
                        >
                          Promote
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => onArchive?.(model.job_id)}
                          sx={{ height: 24, fontSize: 10.5, textTransform: 'none', borderColor: V.border, color: V.textMuted }}
                        >
                          Archive
                        </Button>
                      </Stack>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          <Button
            size="small"
            variant="contained"
            onClick={applyLabels}
            sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
          >
            Apply Labels
          </Button>
          <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>Edit labels and click Apply to save.</Typography>
        </Stack>
      </SectionCard>

      <SectionCard>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>ROC Curves</Typography>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rocGrid.data} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EDF2F7" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {rocGrid.series.map((s, idx) => (
              <Line key={s.id} type="monotone" dataKey={s.id} stroke={chartColorForIndex(idx)} strokeWidth={2} dot={false} name={s.label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>Precision-Recall Curves</Typography>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={prGrid.data} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EDF2F7" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {prGrid.series.map((s, idx) => (
              <Line key={s.id} type="monotone" dataKey={s.id} stroke={chartColorForIndex(idx)} strokeWidth={2} dot={false} name={s.label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
        <SectionCard>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>Radar Comparison</Typography>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fontSize: 10 }} />
              {compareData.map((model, idx) => (
                <Radar
                  key={model.job_id}
                  name={normalizeLabel(model)}
                  dataKey={model.job_id}
                  stroke={chartColorForIndex(idx)}
                  fill={chartColorForIndex(idx)}
                  fillOpacity={0.08}
                />
              ))}
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>Confusion Matrices</Typography>
          <Stack spacing={1.5}>
            {compareData.map((model, idx) => (
              <Paper key={model.job_id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: V.text }}>{normalizeLabel(model)}</Typography>
                  <Chip size="small" label={`Thresh ${num(model.optimal_threshold, 2)}`} sx={{ height: 18, fontSize: 9.5 }} />
                </Stack>
                <ConfusionMatrixGrid cm={model.confusion_matrix} />
              </Paper>
            ))}
          </Stack>
        </SectionCard>
      </Stack>

      <SectionCard>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>Feature Importance (Top Signals)</Typography>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          {compareData.map((model, idx) => {
            const fi = model.feature_importance || [];
            return (
              <Paper key={model.job_id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: '1 1 260px' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: V.text, mb: 1 }}>{normalizeLabel(model)}</Typography>
                {fi.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={fi.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EDF2F7" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="feature" tick={{ fontSize: 10 }} width={90} />
                      <Tooltip />
                      <Bar dataKey="importance" fill={chartColorForIndex(idx)} radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>No feature importance available.</Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      </SectionCard>
    </Stack>
  );
};

export default ComparisonTab;
