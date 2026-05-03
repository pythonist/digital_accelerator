import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowForward, CheckCircle } from '@mui/icons-material';

const fmt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '-';
};

const pct = (value, digits = 1) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '-';
};

const dec = (value, digits = 3) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
};

const buildSummaryLines = (stepKey, metadata = {}) => {
  switch (String(stepKey || '').trim().toLowerCase()) {
    case 'data_upload':
      return [
        `You uploaded ${metadata.filename || metadata.dataset_label || 'the FCC source data'} with ${fmt(metadata.rows)} rows and ${fmt(metadata.columns)} columns.`,
        `File size: ${metadata.file_size_mb ?? '-'} MB. This data forms the foundation of your FCC pipeline.`,
      ];
    case 'preprocessing':
      return [
        `${fmt(metadata.step_count ?? metadata.steps_applied?.length)} preprocessing steps were applied to your data.`,
        `${fmt(metadata.dropped_rows)} rows were removed. Output: ${fmt(metadata.output_shape?.[0])} rows x ${fmt(metadata.output_shape?.[1])} columns.`,
        `Steps applied: ${(metadata.steps_applied || []).join(', ') || 'No steps recorded'}.`,
      ];
    case 'master_dataset':
      return [
        `Your master dataset contains ${fmt(metadata.total_rows)} rows and ${fmt(metadata.total_columns)} columns.`,
        `Merged from ${fmt(metadata.sources_merged)} data sources using ${metadata.merge_key || 'the configured join key'} as the join key.`,
        `Null rate: ${pct(metadata.null_percentage)}. Duplicate count: ${fmt(metadata.duplicate_count)}.`,
      ];
    case 'target_variable':
      return [
        `The model is trained to predict ${metadata.target_column || 'the selected outcome'}.`,
        `Positive class: ${fmt(metadata.class_1_count)}. Negative class: ${fmt(metadata.class_0_count)}. Balance: ${metadata.class_balance_ratio || '-'} .`,
        `${fmt(metadata.selected_features?.length)} features were selected for training.`,
      ];
    case 'model_run':
      return [
        `Model: ${metadata.model_type || metadata.algorithm || 'Saved FCC model'} | AUC-ROC: ${dec(metadata.metrics?.auc_roc ?? metadata.auc_roc)} | Precision: ${dec(metadata.metrics?.precision ?? metadata.precision)}.`,
        `Recall: ${dec(metadata.metrics?.recall ?? metadata.recall)} | F1 Score: ${dec(metadata.metrics?.f1_score ?? metadata.f1_score)}.`,
        `Top predictor: ${metadata.feature_importance?.[0]?.feature || 'Not recorded'} (${pct((metadata.feature_importance?.[0]?.importance || 0) * 100, 1)}).`,
      ];
    case 'live_dashboard':
      return [
        `Live scoring is active. ${fmt(metadata.total_alerts)} alerts were generated for this saved run.`,
        `High Risk: ${fmt(metadata.high_risk)} | Medium: ${fmt(metadata.medium_risk)} | Low: ${fmt(metadata.low_risk)}.`,
        `Model version ${metadata.model_version || 'v1.0'} last scored at ${metadata.last_scored_at || metadata.scored_at || '-'}.`,
      ];
    case 'reports':
      return [
        `The FCC reporting pack is available for this saved pipeline run.`,
        `Report run: ${metadata.run_id || metadata.report_id || '-'} | Model: ${metadata.model_name || 'Saved FCC model'}.`,
        `Open the full report view to review the business summary, validation evidence, and historical comparisons.`,
      ];
    case 'eda':
      return [
        `The FCC exploration step profiled the saved dataset for quality, imbalance, and risk patterns.`,
        `Target column: ${metadata.target_column || '-'} | Rows analysed: ${fmt(metadata.rows)} | Columns analysed: ${fmt(metadata.columns)}.`,
      ];
    case 'validation':
      return [
        `Validation evidence was already captured for this saved run.`,
        `Locked threshold: ${dec(metadata.selected_threshold ?? metadata.locked_threshold ?? metadata.optimal_threshold, 2)} | AUC-ROC: ${dec(metadata.metrics?.roc_auc, 3)}.`,
      ];
    case 'registry':
      return [
        `This saved run was prepared for release and deployment governance.`,
        `Model: ${metadata.model_name || '-'} | Stage: ${metadata.stage || '-'} | Deployment: ${metadata.deployment_id || 'Not deployed'}.`,
      ];
    default:
      return [
        'This step was already completed in the selected FCC pipeline run.',
        'The saved configuration and outputs are ready to view in full detail.',
      ];
  }
};

const buildHighlights = (stepKey, metadata = {}) => {
  switch (String(stepKey || '').trim().toLowerCase()) {
    case 'data_upload':
      return [
        ['Rows', fmt(metadata.rows)],
        ['Columns', fmt(metadata.columns)],
        ['Sources', fmt(metadata.total_tables ?? metadata.source_count ?? 1)],
      ];
    case 'preprocessing':
      return [
        ['Steps Applied', fmt(metadata.step_count ?? metadata.steps_applied?.length)],
        ['Output Rows', fmt(metadata.output_shape?.[0])],
        ['Output Columns', fmt(metadata.output_shape?.[1])],
      ];
    case 'master_dataset':
      return [
        ['Rows', fmt(metadata.total_rows)],
        ['Columns', fmt(metadata.total_columns)],
        ['Sources Merged', fmt(metadata.sources_merged)],
      ];
    case 'target_variable':
      return [
        ['Target', metadata.target_column || '-'],
        ['Positive Class', fmt(metadata.class_1_count)],
        ['Negative Class', fmt(metadata.class_0_count)],
      ];
    case 'model_run':
      return [
        ['Model', metadata.model_type || metadata.algorithm || '-'],
        ['AUC-ROC', dec(metadata.metrics?.auc_roc ?? metadata.auc_roc)],
        ['F1 Score', dec(metadata.metrics?.f1_score ?? metadata.f1_score)],
      ];
    case 'live_dashboard':
      return [
        ['Total Alerts', fmt(metadata.total_alerts)],
        ['High Risk', fmt(metadata.high_risk)],
        ['Medium Risk', fmt(metadata.medium_risk)],
      ];
    case 'reports':
      return [
        ['Run ID', metadata.run_id || '-'],
        ['Report ID', metadata.report_id || '-'],
        ['Model', metadata.model_name || '-'],
      ];
    default:
      return [];
  }
};

export default function PipelineSummaryCard({
  stepKey = '',
  stepName = '',
  metadata = {},
  onClose,
  isVisible = false,
}) {
  const lines = useMemo(() => buildSummaryLines(stepKey, metadata), [metadata, stepKey]);
  const highlights = useMemo(() => buildHighlights(stepKey, metadata), [metadata, stepKey]);

  return (
    <Dialog open={Boolean(isVisible)} fullScreen PaperProps={{ sx: { bgcolor: '#f6f7f8' } }}>
      <DialogContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 3, md: 6 } }}>
        <Box sx={{ width: '100%', maxWidth: 920, bgcolor: 'white', border: '1px solid #e2e8f0', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.12)', p: { xs: 3, md: 5 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.2} alignItems="center">
              <CheckCircle sx={{ color: '#166534', fontSize: 28 }} />
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Saved Pipeline Summary
                </Typography>
                <Typography sx={{ fontSize: { xs: 24, md: 32 }, fontWeight: 800, color: '#111827', lineHeight: 1.15 }}>
                  {stepName || 'Pipeline Step'}
                </Typography>
              </Box>
            </Stack>

            <Stack spacing={1.15}>
              {lines.map((line) => (
                <Typography key={line} sx={{ fontSize: { xs: 15, md: 17 }, lineHeight: 1.8, color: '#374151' }}>
                  {line}
                </Typography>
              ))}
            </Stack>

            {highlights.length > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1.2 }}>
                {highlights.map(([label, value]) => (
                  <Box key={label} sx={{ border: '1px solid #e5e7eb', bgcolor: '#fbfcfd', p: 1.5 }}>
                    <Typography sx={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 800, color: '#6b7280' }}>
                      {label}
                    </Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#111827', mt: 0.3 }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Box>
              <Button
                variant="contained"
                endIcon={<ArrowForward />}
                onClick={onClose}
                sx={{
                  bgcolor: '#D04A02',
                  '&:hover': { bgcolor: '#A63B00' },
                  textTransform: 'none',
                  fontWeight: 700,
                  px: 2.5,
                  py: 1.1,
                  borderRadius: 0,
                  boxShadow: 'none',
                }}
              >
                View Full Details
              </Button>
            </Box>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
