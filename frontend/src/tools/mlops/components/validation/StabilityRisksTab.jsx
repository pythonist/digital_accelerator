import React, { useMemo } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { CheckCircle, ErrorOutline, InfoOutlined, WarningAmber } from '@mui/icons-material';
import { V } from './validationTheme';
import {
  fmt,
  getFeatureImportanceRows,
  normalizeLabel,
  pct,
  safeNumber,
} from './validationUtils';
import { MetricChip, SectionCard, SectionTitle } from './ValidationShared';

const suspiciousFeaturePattern = /(label|target|truth|ground_truth|final_label|rule_triggered)/i;

const statusMeta = {
  good: { label: 'Healthy', color: V.good, bg: V.goodLight },
  warn: { label: 'Watch', color: V.warn, bg: V.warnLight },
  bad: { label: 'Review', color: V.bad, bg: V.badLight },
};

const statusIcon = (status) => {
  if (status === 'good') return <CheckCircle sx={{ fontSize: 16, color: V.good }} />;
  if (status === 'bad') return <ErrorOutline sx={{ fontSize: 16, color: V.bad }} />;
  return <WarningAmber sx={{ fontSize: 16, color: V.warn }} />;
};

const metricStatus = (metric, thresholds, reverse = false, missing = 'warn') => {
  if (metric == null || Number.isNaN(Number(metric))) return missing;
  const value = Number(metric);
  if (!reverse) {
    if (value >= thresholds.good) return 'good';
    if (value >= thresholds.warn) return 'warn';
    return 'bad';
  }
  if (value <= thresholds.good) return 'good';
  if (value <= thresholds.warn) return 'warn';
  return 'bad';
};

const firstFinite = (...values) => values.find((value) => Number.isFinite(Number(value)));

const thresholdRowsForModel = (model) => {
  const candidates = [
    model?.threshold_table,
    model?.metrics?.threshold_table,
    model?.validation?.threshold_table,
  ];
  const rows = candidates.find((value) => Array.isArray(value) && value.length) || [];
  return rows
    .map((row) => ({
      threshold: Number(row?.threshold),
      event_loss_pct: Number(row?.event_loss_pct),
      suppression_rate_pct: Number(row?.suppression_rate_pct),
    }))
    .filter((row) => Number.isFinite(row.threshold));
};

const closestThresholdRow = (rows, threshold) => {
  if (!rows.length || !Number.isFinite(Number(threshold))) return null;
  return rows.reduce((best, row) => (
    Math.abs(Number(row.threshold) - Number(threshold)) < Math.abs(Number(best.threshold) - Number(threshold))
      ? row
      : best
  ), rows[0]);
};

const formatBand = (rows) => {
  if (!rows.length) return 'No safe band found';
  const thresholds = rows
    .map((row) => Number(row.threshold))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!thresholds.length) return 'No safe band found';
  return `${fmt(thresholds[0], 2)} to ${fmt(thresholds[thresholds.length - 1], 2)}`;
};

const methodologyCards = [
  {
    title: 'What this tab is',
    body: 'A rules-based readiness screen. It uses saved validation metrics from the current holdout and cross-validation outputs. It does not yet run live drift monitoring or challenger replays here.',
  },
  {
    title: 'How status is assigned',
    body: 'Each tile shows the measured value, the calculation rule, and the threshold used for Healthy, Watch, or Review. The status is deterministic, not an AI guess.',
  },
  {
    title: 'Why business users should care',
    body: 'The checks answer practical questions: Is ranking strong enough, is fold-to-fold performance stable, is the threshold fragile, and is the model leaning too heavily on one signal or risky proxy?',
  },
];

export const buildChecksForModel = (model) => {
  const metrics = model?.metrics || {};
  const featureRows = getFeatureImportanceRows(model, 15);
  const thresholdRows = thresholdRowsForModel(model);
  const eventLossCap = safeNumber(
    firstFinite(metrics.max_event_loss_pct_constraint, model?.max_event_loss_pct, 5),
    5,
  );
  const auc = firstFinite(metrics.roc_auc, model?.roc_auc);
  const cvStd = firstFinite(metrics.cv_auc_std, metrics.cv_std);
  const topFeatureShare = featureRows[0]?.contribution_pct;
  const topFeatureName = featureRows[0]?.feature_display || 'n/a';
  const leakageSignals = Array.from(new Set([
    ...((Array.isArray(model?.leakage_features) ? model.leakage_features : []).map((value) => String(value || '').trim()).filter(Boolean)),
    ...featureRows
      .filter((row) => suspiciousFeaturePattern.test(String(row?.feature || row?.feature_display || '')))
      .map((row) => row.feature_display),
  ]));
  const safeThresholdRows = thresholdRows.filter((row) => (
    Number.isFinite(Number(row?.event_loss_pct)) && Number(row.event_loss_pct) <= eventLossCap
  ));
  const selectedThreshold = firstFinite(metrics.optimal_threshold, model?.optimal_threshold, model?.selected_threshold);
  const selectedRow = closestThresholdRow(thresholdRows, selectedThreshold);
  const selectedEventLoss = firstFinite(
    selectedRow?.event_loss_pct,
    metrics.event_loss_pct,
    model?.event_loss_pct,
  );
  const selectedSuppression = firstFinite(
    selectedRow?.suppression_rate_pct,
    metrics.suppression_rate_pct,
    model?.suppression_rate_pct,
  );

  const checks = [
    {
      label: 'Ranking strength',
      value: auc == null ? 'n/a' : fmt(auc, 3),
      status: metricStatus(auc, { good: 0.85, warn: 0.75 }),
      formula: 'ROC-AUC on the validation holdout.',
      rule: 'Healthy >= 0.85, Watch 0.75-0.849, Review < 0.75.',
      meaning: 'Higher values mean suspicious cases are ranked ahead of low-value alerts more consistently.',
    },
    {
      label: 'Fold stability',
      value: cvStd == null ? 'n/a' : fmt(cvStd, 3),
      status: metricStatus(cvStd, { good: 0.02, warn: 0.05 }, true),
      formula: 'Standard deviation of AUC across cross-validation folds during training.',
      rule: 'Healthy <= 0.02, Watch 0.021-0.05, Review > 0.05.',
      meaning: 'Lower spread means the model behaves more consistently when the training sample changes.',
    },
    {
      label: 'Feature concentration',
      value: topFeatureShare == null ? 'n/a' : pct(topFeatureShare, 1),
      status: metricStatus(topFeatureShare, { good: 35, warn: 50 }, true),
      formula: 'Top feature importance divided by the visible top-15 importance total.',
      rule: 'Healthy <= 35%, Watch 35-50%, Review > 50%.',
      meaning: `High concentration means the model may be leaning too heavily on one signal. Current top signal: ${topFeatureName}.`,
    },
    {
      label: 'Leakage and proxy scan',
      value: leakageSignals.length ? leakageSignals.join(', ') : 'No risky names detected',
      status: leakageSignals.length ? 'bad' : 'good',
      formula: 'Name-based audit across leakage flags and top visible features.',
      rule: 'Any label, target, truth, or rule-trigger proxy sends the tile to Review.',
      meaning: 'This is a quick governance guardrail to catch signals that may bake policy logic or labels back into the model.',
    },
    {
      label: 'Threshold robustness',
      value: thresholdRows.length ? `${safeThresholdRows.length} safe thresholds` : 'n/a',
      status: thresholdRows.length ? metricStatus(safeThresholdRows.length, { good: 5, warn: 2 }) : 'warn',
      formula: `Count of threshold rows where event loss stays at or below the cap of ${fmt(eventLossCap, 1)}%.`,
      rule: 'Healthy >= 5 safe thresholds, Watch 2-4, Review < 2.',
      meaning: `A wider safe band means the deployed cut-off is less fragile. Current safe band: ${formatBand(safeThresholdRows)}.`,
    },
    {
      label: 'Selected threshold policy fit',
      value: selectedEventLoss == null ? 'n/a' : `${fmt(selectedEventLoss, 2)}% loss | ${pct(selectedSuppression, 1)} suppression`,
      status: metricStatus(selectedEventLoss, { good: eventLossCap, warn: eventLossCap + 2 }, true),
      formula: 'Event loss and suppression at the currently selected operating threshold.',
      rule: `Healthy <= ${fmt(eventLossCap, 1)}% loss, Watch <= ${fmt(eventLossCap + 2, 1)}%, Review above that.`,
      meaning: 'This is the business trade-off at the chosen cut-off: how much queue is removed and how much suspicious activity is missed.',
    },
  ];

  const summary = {
    good: checks.filter((check) => check.status === 'good').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    bad: checks.filter((check) => check.status === 'bad').length,
  };

  return {
    job_id: model?.job_id,
    label: normalizeLabel(model),
    algorithm: model?.algorithm_display || model?.algorithm || 'Model',
    threshold: selectedThreshold,
    eventLossCap,
    checks,
    summary,
  };
};

const StabilityRisksTab = ({ compareData }) => {
  const modelChecks = useMemo(
    () => (compareData || []).map((model) => buildChecksForModel(model)),
    [compareData],
  );

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <SectionTitle title="Stability and Risks" subtitle="Explainable readiness checks with the exact logic shown on screen." />
        <Typography sx={{ fontSize: 11.5, color: V.textMuted, lineHeight: 1.7 }}>
          This screen now tells you how every status is calculated. Each card shows the observed metric, the rule used, and why that rule matters to model risk and AML operations.
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.1, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, mt: 1.5 }}>
          {methodologyCards.map((card) => (
            <Paper key={card.title} variant="outlined" sx={{ p: 1.35, borderRadius: 2, borderColor: V.border, bgcolor: V.panelAlt }}>
              <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.55 }}>
                <InfoOutlined sx={{ fontSize: 15, color: V.orange }} />
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: V.text }}>{card.title}</Typography>
              </Stack>
              <Typography sx={{ fontSize: 10.9, color: V.textMuted, lineHeight: 1.7 }}>
                {card.body}
              </Typography>
            </Paper>
          ))}
        </Box>
      </SectionCard>

      <Stack spacing={2}>
        {modelChecks.map((model) => (
          <SectionCard key={model.job_id}>
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.2}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: V.text }}>{model.label}</Typography>
                  <Typography sx={{ fontSize: 11.25, color: V.textMuted, mt: 0.25 }}>
                    {model.algorithm} | threshold {Number.isFinite(Number(model.threshold)) ? fmt(model.threshold, 2) : 'n/a'} | event-loss cap {fmt(model.eventLossCap, 1)}%
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <MetricChip label={`${model.summary.good} healthy`} tone="good" />
                  <MetricChip label={`${model.summary.warn} watch`} tone="warn" />
                  <MetricChip label={`${model.summary.bad} review`} tone="bad" />
                </Stack>
              </Stack>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.1 }}>
                {model.checks.map((check) => {
                  const meta = statusMeta[check.status] || statusMeta.warn;
                  return (
                    <Paper
                      key={check.label}
                      variant="outlined"
                      sx={{
                        p: 1.25,
                        borderRadius: 2,
                        borderColor: V.border,
                        bgcolor: V.paper,
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Stack direction="row" spacing={0.8} alignItems="center">
                          {statusIcon(check.status)}
                          <Typography sx={{ fontSize: 11.75, fontWeight: 700, color: V.text }}>
                            {check.label}
                          </Typography>
                        </Stack>
                        <Box
                          sx={{
                            px: 1,
                            py: 0.35,
                            borderRadius: 999,
                            bgcolor: meta.bg,
                            color: meta.color,
                            fontSize: 10.5,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {meta.label}
                        </Box>
                      </Stack>

                      <Typography sx={{ fontSize: 17, fontWeight: 800, color: V.text, mt: 1 }}>
                        {check.value}
                      </Typography>

                      <Stack spacing={0.55} sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: 10.8, color: V.textMuted, lineHeight: 1.6 }}>
                          <strong style={{ color: V.text }}>How calculated:</strong> {check.formula}
                        </Typography>
                        <Typography sx={{ fontSize: 10.8, color: V.textMuted, lineHeight: 1.6 }}>
                          <strong style={{ color: V.text }}>Rule used:</strong> {check.rule}
                        </Typography>
                        <Typography sx={{ fontSize: 10.8, color: V.textMuted, lineHeight: 1.6 }}>
                          <strong style={{ color: V.text }}>Why it matters:</strong> {check.meaning}
                        </Typography>
                      </Stack>
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          </SectionCard>
        ))}
      </Stack>
    </Stack>
  );
};

export default StabilityRisksTab;
