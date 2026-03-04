import React, { useMemo } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { CheckCircle, ErrorOutline, WarningAmber } from '@mui/icons-material';
import { V } from './validationTheme';
import { fmt, normalizeLabel, safeNumber } from './validationUtils';
import { SectionCard, SectionTitle } from './ValidationShared';

const statusIcon = (status) => {
  if (status === 'good') return <CheckCircle sx={{ fontSize: 16, color: V.good }} />;
  if (status === 'bad') return <ErrorOutline sx={{ fontSize: 16, color: V.bad }} />;
  return <WarningAmber sx={{ fontSize: 16, color: V.warn }} />;
};

const checkStatus = (metric, thresholds, reverse = false) => {
  if (metric == null || Number.isNaN(metric)) return 'warn';
  if (!reverse) {
    if (metric >= thresholds.good) return 'good';
    if (metric >= thresholds.warn) return 'warn';
    return 'bad';
  }
  if (metric <= thresholds.good) return 'good';
  if (metric <= thresholds.warn) return 'warn';
  return 'bad';
};

const StabilityRisksTab = ({ compareData }) => {
  const checks = useMemo(() => {
    return (compareData || []).map((model) => {
      const m = model.metrics || {};
      const auc = safeNumber(m.roc_auc, 0);
      const f1 = safeNumber(m.f1, 0);
      const cvStd = safeNumber(m.cv_auc_std, NaN);
      const topFeature = (model.feature_importance || [])[0];
      const topImp = safeNumber(topFeature?.importance, NaN);
      const topName = String(topFeature?.feature || '');
      const eventLoss = safeNumber(model.event_loss_pct ?? m.event_loss_pct, NaN);
      const gap = Math.max(0, auc - f1);

      return {
        job_id: model.job_id,
        label: normalizeLabel(model),
        checks: [
          {
            label: 'Discrimination (ROC-AUC)',
            value: fmt(auc, 3),
            status: checkStatus(auc, { good: 0.8, warn: 0.7 }),
            note: 'Higher is better.',
          },
          {
            label: 'CV Stability (AUC Std)',
            value: cvStd ? fmt(cvStd, 3) : 'n/a',
            status: checkStatus(cvStd, { good: 0.02, warn: 0.05 }, true),
            note: 'Lower variance is more stable.',
          },
          {
            label: 'Feature Concentration',
            value: topImp ? fmt(topImp, 3) : 'n/a',
            status: checkStatus(topImp, { good: 0.35, warn: 0.5 }, true),
            note: 'Top feature should not dominate.',
          },
          {
            label: 'RULE_TRIGGERED Leakage',
            value: topName.includes('RULE') ? 'Detected' : 'Clear',
            status: topName.includes('RULE') ? 'bad' : 'good',
            note: 'Rule-derived fields risk leakage.',
          },
          {
            label: 'AUC vs F1 Gap',
            value: fmt(gap, 3),
            status: checkStatus(gap, { good: 0.2, warn: 0.3 }, true),
            note: 'Large gaps suggest threshold issues.',
          },
          {
            label: 'Event Loss Constraint',
            value: eventLoss ? `${fmt(eventLoss, 2)}%` : 'n/a',
            status: checkStatus(eventLoss, { good: 5, warn: 8 }, true),
            note: 'Must stay under policy cap.',
          },
        ],
      };
    });
  }, [compareData]);

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <SectionTitle title="Stability and Risks" subtitle="Automated checks per model for audit readiness." />
        <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
          Each check highlights risk areas that can impact AML compliance, investigator workload, or regulatory exposure.
        </Typography>
      </SectionCard>

      <Stack spacing={2}>
        {checks.map((model) => (
          <SectionCard key={model.job_id}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>{model.label}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
              {model.checks.map((check) => (
                <Paper key={check.label} variant="outlined" sx={{ p: 1.2, borderRadius: 2, borderColor: V.border }}>
                  <Stack direction="row" spacing={0.8} alignItems="center" mb={0.5}>
                    {statusIcon(check.status)}
                    <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: V.text }}>{check.label}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>{check.value}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: V.textMuted }}>{check.note}</Typography>
                </Paper>
              ))}
            </Box>
          </SectionCard>
        ))}
      </Stack>
    </Stack>
  );
};

export default StabilityRisksTab;
