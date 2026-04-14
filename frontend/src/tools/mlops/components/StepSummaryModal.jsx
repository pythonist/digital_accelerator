import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowForward, Close } from '@mui/icons-material';

const fmt = (value) => {
  const n = Number(value);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(value || '-');
};

const dec = (value, digits = 3) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
};

const pct = (value, digits = 1, alreadyPercent = false) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const normalized = alreadyPercent ? n : n * 100;
  return `${normalized.toFixed(digits)}%`;
};

const parseBalance = (ratio) => {
  const raw = String(ratio || '').trim();
  const parts = raw.split('/').map((part) => part.trim());
  return {
    left: parts[0] || '-',
    right: parts[1] || '-',
  };
};

const cardValueColor = (tone) => {
  if (tone === 'green') return '#3B6D11';
  if (tone === 'blue') return '#185FA5';
  if (tone === 'amber') return '#854F0B';
  if (tone === 'red') return '#B42318';
  return '#111827';
};

const StatGrid = ({ stats = [] }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
    {stats.filter(Boolean).map((stat) => (
      <Box
        key={stat.label}
        sx={{
          bgcolor: '#F8FAFC',
          border: '1px solid #E5E7EB',
          borderRadius: 1.5,
          px: 1.5,
          py: 1.25,
        }}
      >
        <Typography sx={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6B7280' }}>
          {stat.label}
        </Typography>
        <Typography sx={{ mt: 0.35, fontSize: 20, fontWeight: 800, color: cardValueColor(stat.tone) }}>
          {stat.value}
        </Typography>
      </Box>
    ))}
  </Box>
);

const TagRow = ({ tags = [] }) => (
  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
    {tags.filter(Boolean).map((tag) => (
      <Chip
        key={String(tag)}
        label={String(tag)}
        size="small"
        sx={{
          bgcolor: '#F8FAFC',
          border: '1px solid #E5E7EB',
          color: '#374151',
          fontWeight: 600,
          height: 24,
        }}
      />
    ))}
  </Stack>
);

const ConfusionMatrix = ({ matrix }) => {
  const rows = Array.isArray(matrix) ? matrix : [];
  const values = [
    { label: 'True Positive', value: fmt(rows?.[1]?.[1]), bg: '#EAF3DE', color: '#27500A' },
    { label: 'False Negative', value: fmt(rows?.[1]?.[0]), bg: '#FAEEDA', color: '#633806' },
    { label: 'False Positive', value: fmt(rows?.[0]?.[1]), bg: '#FCEBEB', color: '#791F1F' },
    { label: 'True Negative', value: fmt(rows?.[0]?.[0]), bg: '#EAF3DE', color: '#27500A' },
  ];

  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: '#6B7280', mb: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Confusion Matrix
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
        {values.map((item) => (
          <Box key={item.label} sx={{ bgcolor: item.bg, color: item.color, borderRadius: 1.5, px: 1.25, py: 1.1 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, opacity: 0.8 }}>
              {item.label}
            </Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 800, mt: 0.3 }}>
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const RiskBars = ({ metadata = {} }) => {
  const high = Number(metadata.high_risk || 0);
  const medium = Number(metadata.medium_risk || 0);
  const low = Number(metadata.low_risk || 0);
  const total = Math.max(1, high + medium + low);
  const rows = [
    { label: 'High', value: high, color: '#BA7517' },
    { label: 'Medium', value: medium, color: '#378ADD' },
    { label: 'Low', value: low, color: '#639922' },
  ];

  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: '#6B7280', mb: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Alert Risk Breakdown
      </Typography>
      <Stack spacing={0.9}>
        {rows.map((row) => (
          <Stack key={row.label} direction="row" spacing={1} alignItems="center">
            <Typography sx={{ width: 58, fontSize: 12, color: '#374151' }}>{row.label}</Typography>
            <Box sx={{ flex: 1, height: 8, bgcolor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
              <Box sx={{ width: `${(row.value / total) * 100}%`, minWidth: row.value > 0 ? 8 : 0, height: '100%', bgcolor: row.color, borderRadius: 999 }} />
            </Box>
            <Typography sx={{ minWidth: 28, fontSize: 12, color: '#374151', textAlign: 'right' }}>{fmt(row.value)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};

const buildView = (stepType, metadata = {}) => {
  const type = String(stepType || '').trim().toLowerCase();

  if (type === 'data_upload') {
    const typeBreakdown = metadata.data_types || {};
    return {
      heading: 'Data upload summary',
      badge: { label: metadata.dataset_label || 'FCC source data', bg: '#E6F1FB', color: '#185FA5' },
      summary: `You uploaded ${metadata.filename || 'fcc_source_data.csv'} with ${fmt(metadata.rows)} rows and ${fmt(metadata.columns)} columns. This raw data is the foundation of your FCC pipeline.`,
      stats: [
        { label: 'Total rows', value: fmt(metadata.rows) },
        { label: 'Columns', value: fmt(metadata.columns), tone: 'blue' },
        { label: 'File size', value: metadata.file_size_mb != null ? `${metadata.file_size_mb} MB` : '-', tone: 'amber' },
        { label: 'Upload date', value: metadata.uploaded_at ? new Date(metadata.uploaded_at).toLocaleDateString() : '-' },
      ],
      tags: metadata.column_names || [],
      footer: (
        <StatGrid
          stats={[
            { label: 'Numeric', value: fmt(typeBreakdown.numeric || 0) },
            { label: 'Categorical', value: fmt(typeBreakdown.categorical || 0) },
            { label: 'Date', value: fmt(typeBreakdown.date || 0) },
            { label: 'Tables', value: fmt(metadata.total_tables || 1), tone: 'blue' },
          ]}
        />
      ),
    };
  }

  if (type === 'preprocessing') {
    return {
      heading: 'Preprocessing summary',
      badge: { label: `${fmt(metadata.step_count ?? metadata.steps_applied?.length ?? 0)} steps applied`, bg: '#E6F1FB', color: '#185FA5' },
      summary: `${fmt(metadata.step_count ?? metadata.steps_applied?.length ?? 0)} preprocessing steps were applied. ${fmt(metadata.dropped_rows || 0)} rows were removed. Output: ${fmt(metadata.output_shape?.[0])} rows x ${fmt(metadata.output_shape?.[1])} columns.`,
      stats: [
        { label: 'Input rows', value: fmt(metadata.input_shape?.[0]) },
        { label: 'Output rows', value: fmt(metadata.output_shape?.[0]), tone: 'green' },
        { label: 'Rows dropped', value: fmt(metadata.dropped_rows || 0), tone: 'amber' },
        { label: 'Cols dropped', value: fmt((metadata.dropped_columns || []).length) },
      ],
      tags: [
        ...(metadata.steps_applied || []),
        ...((metadata.modified_columns || []).slice(0, 4).map((column) => `Modified: ${column}`)),
      ].slice(0, 8),
    };
  }

  if (type === 'eda') {
    return {
      heading: 'EDA summary',
      badge: { label: 'Exploratory analysis', bg: '#EEEDFE', color: '#534AB7' },
      summary: `${fmt(metadata.feature_count || metadata.columns || 0)} features were analyzed. The top signals were ${(metadata.top_features || []).slice(0, 3).map((item) => item.feature).filter(Boolean).join(', ') || 'not recorded'}. Target distribution: ${metadata.target_distribution || '-'}.`,
      stats: [
        { label: 'Features', value: fmt(metadata.feature_count || metadata.columns || 0) },
        { label: 'Rows analysed', value: fmt(metadata.rows || 0), tone: 'blue' },
        { label: 'High-corr pairs', value: fmt((metadata.correlation_highlights || []).length), tone: 'amber' },
        { label: 'Null features', value: fmt((metadata.missing_summary || []).filter((item) => Number(item?.null_pct || 0) > 0).length) },
      ],
      tags: (metadata.top_features || []).map((item) => `${item.feature}${item.score != null ? ` (${dec(item.score, 2)})` : ''}`),
      footer: (
        <Stack spacing={1.25}>
          <Typography sx={{ fontSize: 11, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Correlation Highlights
          </Typography>
          <TagRow tags={(metadata.correlation_highlights || []).map((item) => `${item.pair}: ${dec(item.value, 2)}`)} />
        </Stack>
      ),
    };
  }

  if (type === 'master_dataset') {
    return {
      heading: 'Master dataset summary',
      badge: { label: `${fmt(metadata.sources_merged || 0)} sources merged`, bg: '#E1F5EE', color: '#0F6E56' },
      summary: `Your master dataset contains ${fmt(metadata.total_rows)} rows and ${fmt(metadata.total_columns)} columns. It was built by merging ${fmt(metadata.sources_merged || 0)} source tables using ${metadata.merge_key || 'account_id'} as the join key.`,
      stats: [
        { label: 'Rows', value: fmt(metadata.total_rows), tone: 'green' },
        { label: 'Columns', value: fmt(metadata.total_columns) },
        { label: 'Sources merged', value: fmt(metadata.sources_merged || 0), tone: 'blue' },
        { label: 'Merge key', value: metadata.merge_key || 'account_id' },
        { label: 'Null %', value: pct(metadata.null_percentage || 0, 1, true), tone: 'amber' },
        { label: 'Duplicates', value: fmt(metadata.duplicate_count || 0), tone: 'green' },
      ],
      tags: [],
    };
  }

  if (type === 'target_variable') {
    const balance = parseBalance(metadata.class_balance_ratio);
    return {
      heading: 'Target variable summary',
      badge: { label: metadata.target_column || 'Target', bg: '#FAEEDA', color: '#633806' },
      summary: `The model is trained to predict ${metadata.target_column || 'the selected target'}. Class balance is ${metadata.class_balance_ratio || '-'}, and ${fmt((metadata.selected_features || []).length)} features were selected for training.`,
      stats: [
        { label: 'Fraud cases', value: fmt(metadata.class_1_count || 0), tone: 'amber' },
        { label: 'Non-fraud', value: fmt(metadata.class_0_count || 0), tone: 'green' },
        { label: 'Positive ratio', value: balance.right, tone: 'amber' },
        { label: 'Features', value: fmt((metadata.selected_features || []).length), tone: 'blue' },
      ],
      tags: metadata.selected_features || [],
    };
  }

  if (type === 'model_run') {
    const metrics = metadata.metrics || {};
    return {
      heading: 'Model run summary',
      badge: { label: metadata.model_type || 'Model trained', bg: '#E6F1FB', color: '#185FA5' },
      summary: `${metadata.model_type || 'Model'} trained on ${metadata.train_test_split || 'saved split'}. AUC-ROC: ${dec(metrics.auc_roc)}. Top feature: ${(metadata.feature_importance || [])[0]?.feature || 'not recorded'}.`,
      stats: [
        { label: 'AUC-ROC', value: dec(metrics.auc_roc), tone: 'green' },
        { label: 'Precision', value: dec(metrics.precision), tone: 'green' },
        { label: 'Recall', value: dec(metrics.recall) },
        { label: 'F1 score', value: dec(metrics.f1_score) },
      ],
      tags: [
        metadata.model_type,
        metadata.train_test_split,
        ...Object.entries(metadata.hyperparameters || {}).slice(0, 4).map(([key, value]) => `${key}: ${value}`),
      ],
    };
  }

  if (type === 'validation') {
    const metrics = metadata.metrics || {};
    return {
      heading: 'Model validation summary',
      badge: {
        label: `${metadata.validation_status || 'Validation'}${metadata.selected_threshold != null ? ` · Threshold ${dec(metadata.selected_threshold, 2)}` : ''}`,
        bg: String(metadata.validation_status || '').toLowerCase() === 'pass' ? '#EAF3DE' : '#FCEBEB',
        color: String(metadata.validation_status || '').toLowerCase() === 'pass' ? '#3B6D11' : '#B42318',
      },
      summary: `Model validation ${String(metadata.validation_status || '').toLowerCase() === 'pass' ? 'passed' : 'completed'}. ROC AUC is ${dec(metrics.roc_auc)} and the retained decision threshold is ${dec(metadata.selected_threshold ?? metadata.locked_threshold, 2)}.`,
      stats: [
        { label: 'ROC AUC', value: dec(metrics.roc_auc), tone: 'green' },
        { label: 'Precision', value: dec(metrics.precision) },
        { label: 'Recall', value: dec(metrics.recall) },
        { label: 'F1 score', value: dec(metrics.f1) },
      ],
      tags: [
        metadata.validation_status || 'Validation',
        `Threshold: ${dec(metadata.selected_threshold ?? metadata.locked_threshold, 2)}`,
        metrics.pr_auc != null ? `PR AUC: ${dec(metrics.pr_auc)}` : null,
      ],
      footer: <ConfusionMatrix matrix={metadata.confusion_matrix} />,
    };
  }

  if (type === 'registry') {
    return {
      heading: 'Model release summary',
      badge: { label: String(metadata.stage || 'candidate').toUpperCase(), bg: '#FAEEDA', color: '#633806' },
      summary: `${metadata.model_name || 'Selected model'} is registered for release at stage ${String(metadata.stage || 'candidate').toUpperCase()}. ${metadata.deployment_id ? `Deployment ${metadata.deployment_id} is active.` : 'No deployment has been activated yet.'}`,
      stats: [
        { label: 'Model', value: metadata.model_name || '-' },
        { label: 'Stage', value: String(metadata.stage || 'candidate').toUpperCase(), tone: 'blue' },
        { label: 'Threshold', value: dec(metadata.threshold, 2) },
        { label: 'Deployment', value: metadata.deployment_id || 'Not deployed', tone: metadata.deployment_id ? 'green' : 'amber' },
      ],
      tags: [metadata.model_name, metadata.deployment_id].filter(Boolean),
    };
  }

  if (type === 'live_dashboard') {
    return {
      heading: 'Live dashboard summary',
      badge: { label: `Active · ${metadata.model_version || 'v1.0'}`, bg: '#E6F1FB', color: '#185FA5' },
      summary: `Live scoring is active. ${fmt(metadata.total_alerts || 0)} alerts were generated in the latest run. High risk alerts: ${fmt(metadata.high_risk || 0)}. Last scored at ${metadata.last_scored_at ? new Date(metadata.last_scored_at).toLocaleString() : '-'}.`,
      stats: [
        { label: 'Total alerts', value: fmt(metadata.total_alerts || 0) },
        { label: 'High risk', value: fmt(metadata.high_risk || 0), tone: 'amber' },
        { label: 'Medium risk', value: fmt(metadata.medium_risk || 0), tone: 'blue' },
        { label: 'Low risk', value: fmt(metadata.low_risk || 0), tone: 'green' },
      ],
      tags: [
        metadata.model_version || null,
        metadata.last_scored_at ? `Last scored: ${new Date(metadata.last_scored_at).toLocaleTimeString()}` : null,
        metadata.alert_trend ? `Trend: ${metadata.alert_trend}` : null,
      ],
      footer: <RiskBars metadata={metadata} />,
    };
  }

  if (type === 'reports') {
    return {
      heading: 'Reports summary',
      badge: { label: 'Business report', bg: '#E6F1FB', color: '#185FA5' },
      summary: `Run reporting is available for ${metadata.model_name || 'this pipeline'}. Report ${metadata.report_id || '-'} was generated on ${metadata.generated_at ? new Date(metadata.generated_at).toLocaleString() : '-'}.`,
      stats: [
        { label: 'Run ID', value: metadata.run_id || '-' },
        { label: 'Report ID', value: metadata.report_id || '-' },
        { label: 'Model', value: metadata.model_name || '-' },
        { label: 'Generated', value: metadata.generated_at ? new Date(metadata.generated_at).toLocaleDateString() : '-' },
      ],
      tags: [metadata.pipeline_name, metadata.model_name].filter(Boolean),
    };
  }

  return {
    heading: 'Saved step summary',
    badge: { label: 'Saved run', bg: '#F3F4F6', color: '#374151' },
    summary: 'Saved pipeline details are available for this FCC step.',
    stats: [],
    tags: [],
  };
};

export default function StepSummaryModal({
  stepType = '',
  stepName = '',
  metadata = {},
  isOpen = false,
  onClose,
}) {
  const view = useMemo(() => buildView(stepType, metadata), [metadata, stepType]);

  return (
    <Dialog
      open={Boolean(isOpen)}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 'min(680px, calc(100vw - 48px))',
          maxWidth: 680,
          borderRadius: 3,
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(15, 23, 42, 0.24)',
        },
      }}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(15, 23, 42, 0.22)',
          backdropFilter: 'blur(8px)',
        },
      }}
    >
      <DialogContent sx={{ p: 0, bgcolor: '#ffffff' }}>
        <Box sx={{ px: 3, pt: 2.5, pb: 1.8, background: 'linear-gradient(180deg, #FFF7ED 0%, #FFFFFF 100%)' }}>
          <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#D04A02', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Saved Pipeline Summary
              </Typography>
              <Typography sx={{ mt: 0.5, fontSize: 18, fontWeight: 800, color: '#111827' }}>
                {stepName || view.heading}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small" sx={{ color: '#6B7280' }}>
              <Close fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ px: 3, pb: 3 }}>
          <Stack spacing={2}>
            <Chip
              label={view.badge.label}
              size="small"
              sx={{
                alignSelf: 'flex-start',
                mt: 0.5,
                bgcolor: view.badge.bg,
                color: view.badge.color,
                fontWeight: 700,
              }}
            />

            <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: '#4B5563' }}>
              {view.summary}
            </Typography>

            {!!view.stats?.length && <StatGrid stats={view.stats} />}
            {!!view.footer && view.footer}
            {!!view.tags?.length && <TagRow tags={view.tags} />}

            <Box sx={{ pt: 0.5 }}>
              <Button
                variant="contained"
                endIcon={<ArrowForward />}
                onClick={onClose}
                sx={{
                  bgcolor: '#D04A02',
                  '&:hover': { bgcolor: '#A63B00' },
                  textTransform: 'none',
                  borderRadius: 1.5,
                  fontWeight: 700,
                  boxShadow: 'none',
                }}
              >
                View Details
              </Button>
            </Box>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
