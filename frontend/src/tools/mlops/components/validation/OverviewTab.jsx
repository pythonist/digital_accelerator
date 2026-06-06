import React, { useMemo, useState } from 'react';
import { Box, Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AutoGraph, Flag, Insights, Stars } from '@mui/icons-material';
import { V } from './validationTheme';
import { fmt, num, pct, safeNumber, normalizeLabel } from './validationUtils';
import { RingGauge, KpiBar, SectionTitle, StatCard, MetricBadge, NarrativeBox, SectionCard } from './ValidationShared';

const narrativeCopy = {
  business: {
    title: 'Business Narrative',
    text: 'We are balancing investigation workload with event-loss control. This panel highlights the model that keeps suspicious cases visible while keeping suppression under control.',
  },
  technical: {
    title: 'Technical Narrative',
    text: 'We compare discrimination, calibration, and operational thresholds to recommend a champion model with stable performance and acceptable event-loss constraints.',
  },
};

const healthScore = (metrics = {}) => {
  const auc = safeNumber(metrics.roc_auc, 0);
  const f1 = safeNumber(metrics.f1, 0);
  const el = safeNumber(metrics.event_loss_pct, 0);
  const elScore = Math.max(0, 1 - Math.min(el, 10) / 10);
  return Math.round(((auc * 0.45) + (f1 * 0.35) + (elScore * 0.2)) * 100);
};

const chooseChampion = (runs) => {
  if (!runs?.length) return null;
  return runs.reduce((best, r) => {
    const bm = best?.metrics || {};
    const rm = r?.metrics || {};
    const bScore = (safeNumber(bm.roc_auc, 0) * 0.5) + (safeNumber(bm.f1, 0) * 0.5);
    const rScore = (safeNumber(rm.roc_auc, 0) * 0.5) + (safeNumber(rm.f1, 0) * 0.5);
    return rScore > bScore ? r : best;
  }, runs[0]);
};

const deriveSuppressionRate = (run) => {
  const direct = run?.metrics?.suppression_rate_pct ?? run?.suppression_rate_pct;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);

  const thresholdTable = Array.isArray(run?.threshold_table)
    ? run.threshold_table
    : Array.isArray(run?.metrics?.threshold_table)
      ? run.metrics.threshold_table
      : [];
  const threshold = run?.metrics?.optimal_threshold ?? run?.optimal_threshold ?? run?.selected_threshold ?? run?.threshold;
  if (thresholdTable.length && Number.isFinite(Number(threshold))) {
    const matchedRow = thresholdTable.find((row) => Number(row?.threshold) === Number(threshold));
    const tableRate = matchedRow?.suppression_rate_pct ?? matchedRow?.suppression_rate;
    if (tableRate != null && Number.isFinite(Number(tableRate))) return Number(tableRate);
  }

  const cm = run?.confusion_matrix || run?.metrics?.confusion_matrix;
  const tn = Number(cm?.[0]?.[0] ?? 0);
  const fp = Number(cm?.[0]?.[1] ?? 0);
  const fn = Number(cm?.[1]?.[0] ?? 0);
  const tp = Number(cm?.[1]?.[1] ?? 0);
  const total = tn + fp + fn + tp;
  if (total > 0) {
    return ((tn + fn) / total) * 100;
  }

  return null;
};

const deriveEventLoss = (run) => {
  const direct = run?.metrics?.event_loss_pct ?? run?.event_loss_pct;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);

  const cm = run?.confusion_matrix || run?.metrics?.confusion_matrix;
  const fn = Number(cm?.[1]?.[0] ?? 0);
  const tp = Number(cm?.[1]?.[1] ?? 0);
  const totalEvents = fn + tp;
  if (totalEvents > 0) {
    return (fn / totalEvents) * 100;
  }

  return null;
};

const OverviewTab = ({
  summary,
  runs,
  activeModel,
  onPromoteChampion,
  persona,
  actionsDisabled = false,
}) => {
  const [narrative, setNarrative] = useState(persona === 'technical' ? 'technical' : 'business');
  const champion = summary?.champion || chooseChampion(runs);
  const active = activeModel || (runs?.[0] || null);
  const activeMetrics = active?.metrics || {};
  const activeSuppressionRate = deriveSuppressionRate(active);
  const activeEventLoss = deriveEventLoss(active);
  const activeHealth = healthScore({
    ...activeMetrics,
    event_loss_pct: activeEventLoss ?? activeMetrics.event_loss_pct,
  });
  const recommended = chooseChampion(runs);
  const activeEventLossTone = activeEventLoss == null
    ? 'warn'
    : activeEventLoss <= 5
      ? 'good'
      : activeEventLoss <= 8
        ? 'warn'
        : 'bad';

  const ringCards = [
    { label: 'ROC-AUC', value: activeMetrics.roc_auc, tone: activeMetrics.roc_auc >= 0.8 ? 'good' : activeMetrics.roc_auc >= 0.7 ? 'warn' : 'bad' },
    { label: 'F1 Score', value: activeMetrics.f1, tone: activeMetrics.f1 >= 0.75 ? 'good' : activeMetrics.f1 >= 0.6 ? 'warn' : 'bad' },
    { label: 'Event Loss %', value: activeEventLoss, max: 10, tone: activeEventLossTone, format: (v) => num(v, 2) },
  ];

  const algorithmMix = useMemo(() => {
    const dist = summary?.algorithms || {};
    const total = Object.values(dist).reduce((acc, v) => acc + v, 0) || 1;
    return Object.entries(dist).map(([key, value]) => ({
      label: key.replace(/_/g, ' ').toUpperCase(),
      value: Math.round((value / total) * 100),
    }));
  }, [summary]);

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <SectionTitle
            icon={<Insights sx={{ fontSize: 18, color: V.orange }} />}
            title="Overview"
            subtitle="Health summary, KPIs, and champion recommendation"
          />
          <ToggleButtonGroup
            value={narrative}
            exclusive
            onChange={(_, v) => v && setNarrative(v)}
            size="small"
            sx={{ '& .MuiToggleButton-root.Mui-selected': { bgcolor: `${V.orange}22`, color: V.orange, borderColor: V.orange } }}
          >
            <ToggleButton value="business" sx={{ textTransform: 'none', fontSize: 11.5 }}>Business</ToggleButton>
            <ToggleButton value="technical" sx={{ textTransform: 'none', fontSize: 11.5 }}>Technical</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Box sx={{ mt: 1.5 }}>
          <NarrativeBox title={narrativeCopy[narrative].title} text={narrativeCopy[narrative].text} />
        </Box>
      </SectionCard>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
        <SectionCard>
          <SectionTitle icon={<AutoGraph sx={{ fontSize: 18, color: V.orange }} />} title="Health Scorecards" subtitle="Current model readiness and risk" />
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {ringCards.map((card) => (
              <RingGauge key={card.label} label={card.label} value={card.value} max={card.max || 1} tone={card.tone} format={card.format || ((v) => fmt(v, 3))} />
            ))}
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 160 }}>
              <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Health Score</Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 800, color: activeHealth >= 80 ? V.good : activeHealth >= 60 ? V.warn : V.bad }}>
                {activeHealth}%
              </Typography>
              <Typography sx={{ fontSize: 11, color: V.textMuted }}>Composite of AUC, F1, Event Loss</Typography>
            </Paper>
          </Stack>
          <Box sx={{ mt: 2 }}>
            <SectionTitle icon={<Stars sx={{ fontSize: 16, color: V.orange }} />} title="KPI Bar" subtitle="Operational mix for the active model" />
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <KpiBar label="Suppression Rate" value={activeSuppressionRate} max={100} format={(v) => pct(v, 1)} />
              <KpiBar label="Recall" value={activeMetrics.recall} max={1} />
              <KpiBar label="Precision" value={activeMetrics.precision} max={1} />
              <KpiBar label="Balanced Accuracy" value={activeMetrics.balanced_accuracy} max={1} />
            </Stack>
          </Box>
        </SectionCard>

        <SectionCard>
          <SectionTitle icon={<Flag sx={{ fontSize: 18, color: V.orange }} />} title="Champion Recommendation" subtitle="Suggested champion for promotion" />
          {recommended ? (
            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: V.border }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>
                  {normalizeLabel(recommended)}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
                  {recommended.algorithm_display || recommended.algorithm} | Trained {recommended.trained_at ? String(recommended.trained_at).replace('T', ' ').slice(0, 19) : 'n/a'}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  <MetricBadge label={`AUC ${fmt(recommended.metrics?.roc_auc, 3)}`} tone="good" />
                  <MetricBadge label={`F1 ${fmt(recommended.metrics?.f1, 3)}`} tone="good" />
                  <MetricBadge label={`Event Loss ${pct(recommended.metrics?.event_loss_pct ?? recommended.event_loss_pct, 2)}`} tone={(recommended.metrics?.event_loss_pct ?? recommended.event_loss_pct) <= 5 ? 'good' : 'warn'} />
                </Stack>
              </Paper>
              <Button
                variant="contained"
                onClick={() => onPromoteChampion?.(recommended.job_id)}
                disabled={actionsDisabled}
                sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
              >
                Promote to Champion
              </Button>
              {champion && (
                <Typography sx={{ fontSize: 11.5, color: V.textDim }}>
                  Current champion: {normalizeLabel(champion)}.
                </Typography>
              )}
            </Stack>
          ) : (
            <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>No models available yet.</Typography>
          )}
        </SectionCard>
      </Stack>

      <SectionCard>
        <SectionTitle icon={<AutoGraph sx={{ fontSize: 18, color: V.orange }} />} title="Portfolio Mix" subtitle="Algorithm distribution across runs" />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {algorithmMix.length ? algorithmMix.map((item) => (
            <StatCard key={item.label} label={item.label} value={`${item.value}%`} />
          )) : <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>No run distribution yet.</Typography>}
        </Stack>
      </SectionCard>
    </Stack>
  );
};

export default OverviewTab;
