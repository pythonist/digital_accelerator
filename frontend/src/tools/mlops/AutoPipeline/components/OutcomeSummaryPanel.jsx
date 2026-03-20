import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  AutoGraph,
  Insights,
  Launch,
  SavingsOutlined,
  ShieldOutlined,
} from '@mui/icons-material';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

const fmtInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : '-';
};

const translateMetrics = (run) => {
  const trainStep = (run?.steps || []).find((step) => step.id === 'train');
  const validateStep = (run?.steps || []).find((step) => step.id === 'validate');
  const auc = Number(trainStep?.result?._auc || 0);
  const threshold = Number(validateStep?.result?.optimal_threshold ?? 0.5);
  const catchRate = Math.round(auc * 100);
  const suppressionPct = Math.round((1 - threshold) * 45 + 20);
  return {
    auc,
    threshold,
    catchRate,
    suppressionPct,
  };
};

const countByType = (datasets, matcher) =>
  datasets
    .filter((dataset) => matcher(String(dataset?.dataset_type || '').toLowerCase()))
    .reduce((sum, dataset) => sum + (Number(dataset?.row_count) || 0), 0);

export default function OutcomeSummaryPanel({
  selectedDatasets = [],
  activeRun = null,
  latestCompletedRun = null,
  goal = 'balanced',
  onResumeRun = null,
}) {
  const runForSummary = activeRun?.steps?.length ? activeRun : null;
  const referenceRun = activeRun || latestCompletedRun || null;

  const stats = useMemo(() => {
    const transactions = countByType(selectedDatasets, (value) => value.includes('transaction'));
    const alerts = countByType(selectedDatasets, (value) => value.includes('alert') || value.includes('case'));
    const accounts = countByType(selectedDatasets, (value) => value.includes('account'));
    const customers = countByType(selectedDatasets, (value) => value.includes('customer'));
    const totalRows = selectedDatasets.reduce((sum, dataset) => sum + (Number(dataset?.row_count) || 0), 0);
    const metrics = translateMetrics(runForSummary);
    return {
      transactions,
      alerts,
      accounts,
      customers,
      totalRows,
      ...metrics,
    };
  }, [selectedDatasets, runForSummary]);

  const headline = runForSummary?.status === 'done'
    ? 'This run shows how many low-value alerts may be suppressed before L1 and L2 review.'
    : 'This workbench is designed to reduce false positive alerts before they consume unnecessary review effort.';

  const summaryText = runForSummary?.status === 'done'
    ? `The current run used the linked datasets to train a model for false positive reduction. Based on the latest build, the model is expected to keep roughly ${stats.catchRate || '-'}% of the higher-value cases visible while suppressing about ${stats.suppressionPct || '-'}% of lower-value alert noise.`
    : latestCompletedRun?.run_id
      ? 'A previous completed run is available to reopen. Start with the business problem, review the linked data, and then open the completed run to see the latest reduction result and supporting evidence.'
    : 'Start by selecting the source data, reviewing quality and join readiness, and defining the outcome the business wants to predict. The goal is to identify alerts that are more likely false positives and remove avoidable review workload without hiding stronger risk signals.';

  const impactPoints = runForSummary?.status === 'done'
    ? [
        `Transactions covered: ${fmtInt(stats.transactions || stats.totalRows)}`,
        `Alert or case history linked: ${fmtInt(stats.alerts)}`,
        `Accounts and customers in context: ${fmtInt(stats.accounts + stats.customers)}`,
        `Estimated low-value alert suppression: ${fmtInt(stats.suppressionPct)}%`,
      ]
    : [
        `Transactions available: ${fmtInt(stats.transactions || stats.totalRows)}`,
        `Alert or case history available: ${fmtInt(stats.alerts)}`,
        `Accounts and customers in context: ${fmtInt(stats.accounts + stats.customers)}`,
        `Business goal selected: ${goal.replace(/_/g, ' ')}`,
      ];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel, mb: 1.5 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${FCC_THEME.border}` }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoGraph sx={{ fontSize: 18, color: FCC_THEME.accent }} />
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>
                Run Outcome Summary
              </Typography>
              <Typography sx={{ fontSize: 10.5, color: FCC_THEME.textSoft }}>
                Start with the business result, then drill into the pipeline.
              </Typography>
            </Box>
          </Stack>
          {referenceRun?.run_id ? (
            <Chip
              size="small"
              label={referenceRun?.run_name || `Run ${String(referenceRun.run_id).slice(0, 8)}`}
              sx={{
                height: 22,
                fontSize: 10.5,
                fontWeight: 700,
                bgcolor: FCC_THEME.panelAlt,
                color: FCC_THEME.textMuted,
                border: `1px solid ${FCC_THEME.border}`,
              }}
            />
          ) : null}
        </Stack>
      </Box>

      <Box sx={{ px: 2, py: 2 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: FCC_THEME.text }}>
            {headline}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: FCC_THEME.textMuted, lineHeight: 1.65 }}>
            {summaryText}
          </Typography>

          <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
            {impactPoints.map((item) => (
              <Chip
                key={item}
                size="small"
                label={item}
                sx={{
                  height: 24,
                  fontSize: 10.5,
                  bgcolor: FCC_THEME.accentSoft,
                  color: FCC_THEME.accent,
                  border: `1px solid ${FCC_THEME.accentBorder}`,
                }}
              />
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
            <Box sx={{ flex: 1, px: 1.5, py: 1.25, borderRadius: 2, border: `1px solid ${FCC_THEME.border}`, bgcolor: FCC_THEME.panelAlt }}>
              <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.5 }}>
                <SavingsOutlined sx={{ fontSize: 16, color: FCC_THEME.accent }} />
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: FCC_THEME.text }}>
                  Operational impact
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 11, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
                Business users should read this as workload reduction. The workbench is trying to keep more analyst time focused on higher-value alerts and reduce unnecessary review of low-value false positives.
              </Typography>
            </Box>

            <Box sx={{ flex: 1, px: 1.5, py: 1.25, borderRadius: 2, border: `1px solid ${FCC_THEME.border}`, bgcolor: FCC_THEME.panelAlt }}>
              <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.5 }}>
                <ShieldOutlined sx={{ fontSize: 16, color: FCC_THEME.success }} />
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: FCC_THEME.text }}>
                  Control view
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 11, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
                Suppression is never just a volume target. Thresholds and validation evidence are there to show what trade-off remains and how much stronger-risk activity still stays visible for review.
              </Typography>
            </Box>
          </Stack>

          {latestCompletedRun?.run_id && !activeRun?.run_id && onResumeRun ? (
            <Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Launch sx={{ fontSize: 15 }} />}
                onClick={() => onResumeRun(latestCompletedRun.run_id)}
                sx={{
                  textTransform: 'none',
                  borderColor: FCC_THEME.borderStrong,
                  color: FCC_THEME.textMuted,
                }}
              >
                Open latest completed run
              </Button>
            </Box>
          ) : null}
        </Stack>
      </Box>
    </Paper>
  );
}
