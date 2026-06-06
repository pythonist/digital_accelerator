/**
 * ModelRegistryPanel.jsx
 * Production-style static AML model registry view.
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
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
  Analytics,
  FactCheck,
  ModelTraining,
  Shield,
  Storage,
  TableChart,
  Transform,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const THRESHOLD_OPTIONS = [0.48, 0.49, 0.50, 0.51, 0.52, 0.53];

const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString());
const pct = (n, digits = 1) => (n == null ? '-' : `${Number(n).toFixed(digits)}%`);
const dec = (n, digits = 4) => (n == null ? '-' : Number(n).toFixed(digits));

const hashString = (value = '') => String(value)
  .split('')
  .reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7);

const buildReviewTimestamp = (seed) => {
  const dayOffset = hashString(`${seed}-day`) % 42;
  const minuteOffset = hashString(`${seed}-time`) % 361;
  const totalMinutes = (11 * 60) + minuteOffset;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const reviewedAt = new Date(Date.UTC(2026, 2, 10 + dayOffset, hour, minute));
  const hours12 = reviewedAt.getUTCHours() % 12 || 12;
  const suffix = reviewedAt.getUTCHours() >= 12 ? 'PM' : 'AM';
  const label = `${String(reviewedAt.getUTCDate()).padStart(2, '0')} ${MONTHS[reviewedAt.getUTCMonth()]} ${reviewedAt.getUTCFullYear()}, ${String(hours12).padStart(2, '0')}:${String(reviewedAt.getUTCMinutes()).padStart(2, '0')} ${suffix}`;

  return {
    label,
    timestamp: reviewedAt.getTime(),
  };
};

const buildThreshold = (seed) => THRESHOLD_OPTIONS[hashString(`${seed}-threshold`) % THRESHOLD_OPTIONS.length];

const buildSplitMetrics = ({
  total,
  tp,
  tn,
  fp,
  fn,
  auc,
  logLoss,
  brier,
  cvAuc = null,
}) => {
  const actualTrueEvents = tp + fn;
  const actualNonEvents = tn + fp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const detectionRate = actualTrueEvents > 0 ? tp / actualTrueEvents : 0;
  const suppressionRate = total > 0 ? (tn + fn) / total : 0;
  const eventLoss = actualTrueEvents > 0 ? fn / actualTrueEvents : 0;
  const f1 = precision + detectionRate > 0
    ? (2 * precision * detectionRate) / (precision + detectionRate)
    : 0;

  return {
    total,
    actualTrueEvents,
    actualNonEvents,
    tp,
    tn,
    fp,
    fn,
    auc,
    logLoss,
    brier,
    cvAuc,
    f1,
    precisionPct: precision * 100,
    detectionPct: detectionRate * 100,
    suppressionPct: suppressionRate * 100,
    eventLossPct: eventLoss * 100,
    escalatedCount: tp + fp,
    suppressedCount: tn + fn,
  };
};

const PIPELINE_STEPS = [
  {
    icon: Storage,
    step: 'Data Ingestion',
    definition: 'Source transaction, alert, customer, and case data prepared for supervised AML modeling.',
  },
  {
    icon: AccountTree,
    step: 'Master Dataset',
    definition: 'Alert-level context assembled so each decision can be reviewed with customer and case lineage.',
  },
  {
    icon: FactCheck,
    step: 'Target Definition',
    definition: 'Historical true-event outcomes mapped to the alert population used for model learning.',
  },
  {
    icon: Analytics,
    step: 'Exploratory Review',
    definition: 'Signal quality, leakage risk, and class imbalance reviewed before tuning candidate models.',
  },
  {
    icon: Transform,
    step: 'Feature Preparation',
    definition: 'Operational AML attributes standardized and prepared for consistent train and test evaluation.',
  },
  {
    icon: ModelTraining,
    step: 'Model Evaluation',
    definition: 'Comparable supervised candidates reviewed against the same business objective and tolerance limits.',
  },
  {
    icon: Shield,
    step: 'Release Governance',
    definition: 'Only candidates with acceptable review-load control and true-event protection move forward for review.',
  },
];

const MODEL_DEFINITIONS = [
  {
    algorithm: 'Random Forest',
    runId: 'd23f8aw09',
    note: 'Bagged tree ensemble tuned to reduce queue volume without pushing missed true events beyond governance tolerance.',
    train: { total: 8420, tp: 605, tn: 6673, fp: 1120, fn: 22, auc: 0.7640, logLoss: 0.2910, brier: 0.0668, cvAuc: 0.7520 },
    test: { total: 2106, tp: 149, tn: 1672, fp: 280, fn: 5, auc: 0.7480, logLoss: 0.3185, brier: 0.0738 },
    hyperparameters: [
      ['n_estimators', '260'],
      ['max_depth', '14'],
      ['max_features', 'sqrt'],
      ['min_samples_leaf', '9'],
      ['class_weight', 'balanced_subsample'],
    ],
    featureImportance: [
      { feature: 'unique_counterparties_30d', share: 14.8 },
      { feature: 'rule_count', share: 13.1 },
      { feature: 'txn_velocity_7d', share: 11.5 },
      { feature: 'counterparty_link_count', share: 10.3 },
      { feature: 'customer_risk_rating', share: 8.9 },
      { feature: 'cross_border_flag', share: 7.6 },
    ],
  },
  {
    algorithm: 'XGBoost',
    runId: '87jk0923k',
    note: 'Gradient boosted tree run focused on stronger ranking quality and lower missed-event risk on the review set.',
    train: { total: 8420, tp: 640, tn: 6972, fp: 790, fn: 18, auc: 0.8240, logLoss: 0.2387, brier: 0.0542, cvAuc: 0.8090 },
    test: { total: 2106, tp: 145, tn: 1759, fp: 198, fn: 4, auc: 0.8120, logLoss: 0.2714, brier: 0.0618 },
    hyperparameters: [
      ['n_estimators', '420'],
      ['learning_rate', '0.05'],
      ['max_depth', '6'],
      ['subsample', '0.82'],
      ['colsample_bytree', '0.79'],
      ['scale_pos_weight', '8.5'],
    ],
    featureImportance: [
      { feature: 'rapid_outflow_count_30d', share: 15.9 },
      { feature: 'counterparty_risk_rating', share: 13.8 },
      { feature: 'txn_velocity_7d', share: 12.4 },
      { feature: 'customer_sanction_flag', share: 10.7 },
      { feature: 'customer_adverse_media_flag', share: 8.8 },
      { feature: 'connected_to_flagged_account_count', share: 7.5 },
    ],
  },
  {
    algorithm: 'Logistic Regression',
    runId: '8sdf9skp2',
    note: 'Linear baseline retained for governance comparison because coefficients are easier to interpret during model review.',
    train: { total: 8420, tp: 584, tn: 6357, fp: 1448, fn: 31, auc: 0.6890, logLoss: 0.3626, brier: 0.0821, cvAuc: 0.6770 },
    test: { total: 2106, tp: 160, tn: 1528, fp: 410, fn: 8, auc: 0.6820, logLoss: 0.3898, brier: 0.0892 },
    hyperparameters: [
      ['penalty', 'l2'],
      ['solver', 'lbfgs'],
      ['C', '0.9'],
      ['class_weight', 'balanced'],
      ['max_iter', '1200'],
    ],
    featureImportance: [
      { feature: 'txn_transaction_amount_mean', share: 14.4 },
      { feature: 'cross_border_flag', share: 12.8 },
      { feature: 'rule_count', share: 11.6 },
      { feature: 'pep_flag', share: 9.7 },
      { feature: 'customer_risk_rating', share: 8.9 },
      { feature: 'kyc_completeness_pct', share: 7.1 },
    ],
  },
  {
    algorithm: 'Gradient Boosting',
    runId: 'sdo8sjw1q',
    note: 'Boosted tree candidate optimized for higher true-event detection while still suppressing low-value alerts.',
    train: { total: 8420, tp: 623, tn: 6867, fp: 910, fn: 20, auc: 0.7980, logLoss: 0.2594, brier: 0.0588, cvAuc: 0.7840 },
    test: { total: 2106, tp: 155, tn: 1690, fp: 255, fn: 6, auc: 0.7860, logLoss: 0.2921, brier: 0.0660 },
    hyperparameters: [
      ['n_estimators', '300'],
      ['learning_rate', '0.05'],
      ['max_depth', '3'],
      ['min_samples_leaf', '28'],
      ['subsample', '0.84'],
    ],
    featureImportance: [
      { feature: 'avg_ip_risk_score', share: 15.2 },
      { feature: 'txn_velocity_7d', share: 13.3 },
      { feature: 'device_signal_count', share: 11.8 },
      { feature: 'customer_adverse_media_flag', share: 9.9 },
      { feature: 'complaint_count_90d', share: 8.4 },
      { feature: 'rule_count', share: 7.0 },
    ],
  },
  {
    algorithm: 'XGBoost',
    runId: 'q1v8m2r6t',
    note: 'Higher-capacity boosted tree run with stronger scoring separation and tighter missed-event control on holdout.',
    train: { total: 8420, tp: 631, tn: 6933, fp: 840, fn: 16, auc: 0.8160, logLoss: 0.2448, brier: 0.0559, cvAuc: 0.8010 },
    test: { total: 2106, tp: 153, tn: 1734, fp: 214, fn: 5, auc: 0.8040, logLoss: 0.2797, brier: 0.0632 },
    hyperparameters: [
      ['n_estimators', '380'],
      ['learning_rate', '0.04'],
      ['max_depth', '5'],
      ['subsample', '0.86'],
      ['colsample_bytree', '0.77'],
      ['min_child_weight', '5'],
    ],
    featureImportance: [
      { feature: 'customer_sanction_flag', share: 15.1 },
      { feature: 'counterparty_risk_rating', share: 13.6 },
      { feature: 'rapid_outflow_count_30d', share: 12.1 },
      { feature: 'customer_risk_rating', share: 10.2 },
      { feature: 'txn_velocity_7d', share: 8.7 },
      { feature: 'connected_to_flagged_account_count', share: 7.9 },
    ],
  },
  {
    algorithm: 'Decision Tree',
    runId: 'k4z9p1w7e',
    note: 'Single-tree challenger retained for clear decision-path review, even though it leaves more noise in the queue.',
    train: { total: 8420, tp: 572, tn: 6323, fp: 1490, fn: 35, auc: 0.7130, logLoss: 0.3471, brier: 0.0793, cvAuc: 0.6990 },
    test: { total: 2106, tp: 137, tn: 1572, fp: 388, fn: 9, auc: 0.7010, logLoss: 0.3824, brier: 0.0876 },
    hyperparameters: [
      ['criterion', 'gini'],
      ['max_depth', '9'],
      ['min_samples_leaf', '18'],
      ['min_samples_split', '70'],
      ['class_weight', 'balanced'],
    ],
    featureImportance: [
      { feature: 'round_amount_ratio_30d', share: 14.9 },
      { feature: 'rule_count', share: 12.7 },
      { feature: 'dormancy_break_flag', share: 11.1 },
      { feature: 'txn_amount_zscore', share: 9.8 },
      { feature: 'cross_border_flag', share: 8.3 },
      { feature: 'pep_flag', share: 6.6 },
    ],
  },
  {
    algorithm: 'Random Forest',
    runId: 's834ad0p1',
    note: 'Alternate forest run calibrated to avoid over-filtering while maintaining acceptable missed-event control.',
    train: { total: 8420, tp: 590, tn: 6553, fp: 1250, fn: 27, auc: 0.7510, logLoss: 0.3036, brier: 0.0702, cvAuc: 0.7390 },
    test: { total: 2106, tp: 141, tn: 1656, fp: 302, fn: 7, auc: 0.7390, logLoss: 0.3277, brier: 0.0756 },
    hyperparameters: [
      ['n_estimators', '320'],
      ['max_depth', '15'],
      ['max_features', '0.55'],
      ['min_samples_leaf', '8'],
      ['bootstrap', 'true'],
    ],
    featureImportance: [
      { feature: 'external_signal_count', share: 14.3 },
      { feature: 'customer_risk_rating', share: 12.9 },
      { feature: 'txn_velocity_7d', share: 11.8 },
      { feature: 'avg_ip_risk_score', share: 10.6 },
      { feature: 'unique_devices_30d', share: 8.5 },
      { feature: 'customer_adverse_media_flag', share: 7.2 },
    ],
  },
  {
    algorithm: 'Logistic Regression',
    runId: 'y7m2c8q4n',
    note: 'Second linear benchmark retained to compare a slightly stricter threshold neighborhood against the primary baseline.',
    train: { total: 8420, tp: 601, tn: 6435, fp: 1360, fn: 24, auc: 0.6980, logLoss: 0.3518, brier: 0.0788, cvAuc: 0.6840 },
    test: { total: 2106, tp: 147, tn: 1621, fp: 332, fn: 6, auc: 0.6940, logLoss: 0.3722, brier: 0.0844 },
    hyperparameters: [
      ['penalty', 'l2'],
      ['solver', 'lbfgs'],
      ['C', '1.1'],
      ['class_weight', 'balanced'],
      ['max_iter', '900'],
    ],
    featureImportance: [
      { feature: 'cross_border_flag', share: 13.9 },
      { feature: 'txn_transaction_amount_mean', share: 12.5 },
      { feature: 'pep_flag', share: 11.1 },
      { feature: 'kyc_completeness_pct', share: 9.6 },
      { feature: 'rule_count', share: 8.2 },
      { feature: 'customer_risk_rating', share: 7.4 },
    ],
  },
  {
    algorithm: 'XGBoost',
    runId: 'h3n8s6p1v',
    note: 'Strong review candidate with balanced alert triage, consistent holdout ranking quality, and stable calibration.',
    train: { total: 8420, tp: 647, tn: 6976, fp: 780, fn: 17, auc: 0.8200, logLoss: 0.2419, brier: 0.0549, cvAuc: 0.8060 },
    test: { total: 2106, tp: 162, tn: 1728, fp: 210, fn: 6, auc: 0.8090, logLoss: 0.2763, brier: 0.0627 },
    hyperparameters: [
      ['n_estimators', '410'],
      ['learning_rate', '0.05'],
      ['max_depth', '6'],
      ['subsample', '0.81'],
      ['colsample_bytree', '0.80'],
      ['reg_lambda', '1.3'],
    ],
    featureImportance: [
      { feature: 'connected_to_flagged_account_count', share: 15.4 },
      { feature: 'counterparty_risk_rating', share: 13.2 },
      { feature: 'customer_sanction_flag', share: 11.5 },
      { feature: 'txn_velocity_7d', share: 10.3 },
      { feature: 'graph_degree', share: 8.7 },
      { feature: 'pep_flag', share: 7.2 },
    ],
  },
  {
    algorithm: 'Gradient Boosting',
    runId: 'r5t9w2k8d',
    note: 'Another boosted-tree candidate reviewed for operational stability and consistent queue reduction during holdout testing.',
    train: { total: 8420, tp: 618, tn: 6853, fp: 930, fn: 19, auc: 0.7920, logLoss: 0.2641, brier: 0.0597, cvAuc: 0.7780 },
    test: { total: 2106, tp: 150, tn: 1705, fp: 246, fn: 5, auc: 0.7910, logLoss: 0.2876, brier: 0.0659 },
    hyperparameters: [
      ['n_estimators', '340'],
      ['learning_rate', '0.04'],
      ['max_depth', '4'],
      ['min_samples_leaf', '24'],
      ['subsample', '0.83'],
    ],
    featureImportance: [
      { feature: 'complaint_count_90d', share: 14.6 },
      { feature: 'avg_ip_risk_score', share: 13.4 },
      { feature: 'rapid_outflow_count_30d', share: 11.7 },
      { feature: 'customer_adverse_media_flag', share: 9.8 },
      { feature: 'counterparty_risk_rating', share: 8.6 },
      { feature: 'rule_count', share: 7.1 },
    ],
  },
];

const MODELS = MODEL_DEFINITIONS.map((definition) => {
  const reviewedAt = buildReviewTimestamp(definition.runId);
  const threshold = buildThreshold(definition.runId);

  return {
    ...definition,
    reviewedAtLabel: reviewedAt.label,
    reviewedAtTimestamp: reviewedAt.timestamp,
    threshold,
    displayName: `${definition.algorithm} (${definition.runId})`,
    trainMetrics: buildSplitMetrics(definition.train),
    testMetrics: buildSplitMetrics(definition.test),
  };
});

const eventLossTone = (value) => {
  if (value == null) return null;
  if (value <= 3.0) return 'green';
  if (value <= 5.0) return 'amber';
  return 'red';
};

const suppressionTone = (value) => {
  if (value == null) return null;
  if (value >= 80) return 'green';
  if (value >= 74) return 'amber';
  return null;
};

const toneText = {
  green: D.green,
  amber: D.amber,
  red: D.red,
};

const toneBg = {
  green: D.greenBg,
  amber: D.amberBg,
  red: D.redBg,
};

const DetailStat = ({ label, value, tone = null }) => (
  <Box
    sx={{
      p: 1.2,
      borderRadius: 1.5,
      border: `1px solid ${tone ? toneBg[tone] : D.border}`,
      bgcolor: tone ? toneBg[tone] : '#fff',
      minWidth: 120,
    }}
  >
    <Typography sx={{ fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 17, fontWeight: 800, color: tone ? toneText[tone] : D.text, mt: 0.3, fontFamily: 'monospace' }}>
      {value}
    </Typography>
  </Box>
);

const SectionLabel = ({ children }) => (
  <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.7, mb: 1 }}>
    {children}
  </Typography>
);

const PipelineSummary = () => (
  <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2, overflow: 'hidden' }}>
    <Box sx={{ px: 2, py: 1.4, borderBottom: `1px solid ${D.border}`, bgcolor: '#fff' }}>
      <Stack direction="row" spacing={1.1} alignItems="center">
        <AccountTree sx={{ fontSize: 17, color: D.orange }} />
        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: D.text }}>
            Pipeline Provenance Summary
          </Typography>
          <Typography sx={{ fontSize: 11, color: D.muted }}>
            Business view of how reviewed model runs were prepared and evaluated before registry comparison.
          </Typography>
        </Box>
      </Stack>
    </Box>
    <Box
      sx={{
        p: 1.5,
        bgcolor: D.soft,
        display: 'grid',
        gap: 1.2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
      }}
    >
      {PIPELINE_STEPS.map((step) => {
        const Icon = step.icon;
        return (
          <Paper key={step.step} variant="outlined" sx={{ p: 1.35, borderRadius: 1.75 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  bgcolor: '#fff',
                  border: `1px solid ${D.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon sx={{ fontSize: 14, color: D.muted }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: D.text }}>
                  {step.step}
                </Typography>
                <Typography sx={{ fontSize: 10.9, color: D.muted, lineHeight: 1.6, mt: 0.35 }}>
                  {step.definition}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        );
      })}
    </Box>
  </Paper>
);

const RegistryTable = ({
  rows,
  selectedRunId,
  onSelect,
  searchText,
  onSearchChange,
  algorithmFilter,
  onAlgorithmFilterChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
}) => {
  const algorithmOptions = useMemo(
    () => Array.from(new Set(MODELS.map((item) => item.algorithm))),
    [],
  );

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.35, borderBottom: `1px solid ${D.border}`, bgcolor: '#fff' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: D.text }}>
          Registry Table
        </Typography>
        <Typography sx={{ fontSize: 11, color: D.muted, mt: 0.2 }}>
          Review window, threshold, holdout quality, and queue impact for each supervised AML candidate.
        </Typography>
      </Box>

      <Box sx={{ px: 2, py: 1.35, borderBottom: `1px solid ${D.border}`, bgcolor: D.soft }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label="Search"
            placeholder="Algorithm or run ID"
            value={searchText}
            onChange={(event) => onSearchChange(event.target.value)}
            sx={{ minWidth: 220 }}
          />
          <Select
            size="small"
            value={algorithmFilter}
            onChange={(event) => onAlgorithmFilterChange(event.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="all">All algorithms</MenuItem>
            {algorithmOptions.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            value={sortField}
            onChange={(event) => onSortFieldChange(event.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="manual">Reviewed order</MenuItem>
            <MenuItem value="reviewedAt">Date</MenuItem>
            <MenuItem value="algorithm">Algorithm</MenuItem>
            <MenuItem value="threshold">Threshold</MenuItem>
            <MenuItem value="auc">AUC</MenuItem>
            <MenuItem value="f1">F1</MenuItem>
            <MenuItem value="precision">Precision</MenuItem>
            <MenuItem value="detection">True event detection rate</MenuItem>
            <MenuItem value="suppression">Review load control</MenuItem>
            <MenuItem value="eventLoss">Missed-event risk</MenuItem>
          </Select>
          <Select
            size="small"
            value={sortDirection}
            onChange={(event) => onSortDirectionChange(event.target.value)}
            disabled={sortField === 'manual'}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="desc">High to low</MenuItem>
            <MenuItem value="asc">Low to high</MenuItem>
          </Select>
          <Chip
            size="small"
            label={`${rows.length} runs shown`}
            sx={{ border: `1px solid ${D.border}`, bgcolor: '#fff', color: D.muted }}
          />
        </Stack>
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: D.soft }}>
              {['#', 'Algorithm', 'Date', 'Threshold', 'AUC', 'F1', 'Precision', 'True Event Detection Rate', 'Missed True Events'].map((header) => (
                <th
                  key={header}
                  style={{
                    padding: '8px 10px',
                    textAlign: ['#', 'Algorithm', 'Date'].includes(header) ? 'left' : 'right',
                    fontSize: 9.5,
                    color: D.muted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontWeight: 700,
                    borderBottom: `1px solid ${D.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((run, index) => {
              const isSelected = run.runId === selectedRunId;
              return (
                <tr
                  key={run.runId}
                  onClick={() => onSelect(run.runId)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: `1px solid ${D.border}`,
                    background: isSelected ? '#fff7ed' : '#fff',
                  }}
                >
                  <td style={{ padding: '9px 10px', color: D.muted, fontSize: 10.5, fontWeight: isSelected ? 700 : 500 }}>
                    {index + 1}
                  </td>
                  <td style={{ padding: '9px 10px', minWidth: 240 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 800, color: D.text }}>
                      {run.displayName}
                    </Typography>
                  </td>
                  <td style={{ padding: '9px 10px', color: D.muted, whiteSpace: 'nowrap' }}>{run.reviewedAtLabel}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.threshold, 2)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.orange, fontWeight: 700 }}>{dec(run.testMetrics.auc)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{dec(run.testMetrics.f1)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{pct(run.testMetrics.precisionPct)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{pct(run.testMetrics.detectionPct)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.red, fontWeight: 700 }}>
                    {fmt(run.testMetrics.fn)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>
    </Paper>
  );
};

const ConfusionMatrixView = ({ splitMetrics, splitLabel }) => {
  const matrixCells = [
    {
      row: 'Actual True Events',
      escalatedTitle: 'True Events Escalated',
      escalatedSubtitle: 'True Positives',
      escalatedValue: splitMetrics.tp,
      setAsideTitle: 'Missed True Events',
      suppressedSubtitle: 'False Negatives',
      setAsideValue: splitMetrics.fn,
    },
    {
      row: 'Actual Non-Events',
      escalatedTitle: 'False Positives',
      escalatedSubtitle: 'Benign Alerts Escalated',
      escalatedValue: splitMetrics.fp,
      setAsideTitle: 'Correctly Set Aside Alerts',
      setAsideSubtitle: 'True Negatives',
      setAsideValue: splitMetrics.tn,
    },
  ];

  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: D.muted, lineHeight: 1.6, mb: 1.2 }}>
        {splitLabel} confusion review shows how many alerts were escalated for review versus safely set aside, using business-friendly AML terminology with the statistical mapping shown under each cell.
      </Typography>

      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: D.soft }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${D.border}` }}>
                Actual outcome
              </th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${D.border}` }}>
                Escalated for review
              </th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${D.border}` }}>
                Set Aside
              </th>
            </tr>
          </thead>
          <tbody>
            {matrixCells.map((row) => (
              <tr key={row.row} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: '10px', minWidth: 170 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: D.text }}>
                    {row.row}
                  </Typography>
                </td>
                <td style={{ padding: '10px', minWidth: 220, background: D.amberBg }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: D.text }}>
                    {row.escalatedTitle}
                  </Typography>
                  <Typography sx={{ fontSize: 10.2, color: D.muted, mt: 0.15 }}>
                    {row.escalatedSubtitle}
                  </Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800, color: D.text, mt: 0.45, fontFamily: 'monospace' }}>
                    {fmt(row.escalatedValue)}
                  </Typography>
                </td>
                <td style={{ padding: '10px', minWidth: 220, background: row.setAsideTitle === 'Missed True Events' ? D.redBg : D.greenBg }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: D.text }}>
                    {row.setAsideTitle}
                  </Typography>
                  <Typography sx={{ fontSize: 10.2, color: D.muted, mt: 0.15 }}>
                    {row.setAsideSubtitle}
                  </Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800, color: row.setAsideTitle === 'Missed True Events' ? D.red : D.green, mt: 0.45, fontFamily: 'monospace' }}>
                    {fmt(row.setAsideValue)}
                  </Typography>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
        <DetailStat label="Actual True Events" value={fmt(splitMetrics.actualTrueEvents)} />
        <DetailStat label="False Positives" value={fmt(splitMetrics.fp)} tone="amber" />
        <DetailStat label="Correctly Set Aside Alerts" value={fmt(splitMetrics.tn)} tone="green" />
        <DetailStat label="Missed True Events" value={fmt(splitMetrics.fn)} tone="red" />
        <DetailStat label="True Event Detection Rate" value={pct(splitMetrics.detectionPct)} tone="green" />
        <DetailStat label="Review Load Control" value={pct(splitMetrics.suppressionPct)} tone={suppressionTone(splitMetrics.suppressionPct)} />
      </Stack>
    </Box>
  );
};

const DetailCard = ({ run }) => {
  const [matrixTab, setMatrixTab] = useState(1);
  const splitMetrics = matrixTab === 0 ? run.trainMetrics : run.testMetrics;
  const splitLabel = matrixTab === 0 ? 'Training set' : 'Holdout test set';
  const featureMax = Math.max(...run.featureImportance.map((item) => item.share));
  const queueShape = [
    { name: 'Escalated', value: run.testMetrics.escalatedCount, fill: D.orange },
    { name: 'Set Aside', value: run.testMetrics.suppressedCount, fill: '#94a3b8' },
  ];

  return (
    <Paper variant="outlined" sx={{ mt: 2, borderRadius: 2.5, overflow: 'hidden', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)' }}>
      <Box sx={{ px: 2.5, py: 1.8, borderBottom: `1px solid ${D.border}`, bgcolor: '#fff' }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ lg: 'center' }}>
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: D.text }}>
              {run.displayName}
            </Typography>
            <Typography sx={{ fontSize: 11.2, color: D.muted, lineHeight: 1.6, mt: 0.45 }}>
              {run.note}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`Reviewed ${run.reviewedAtLabel}`} sx={{ border: `1px solid ${D.border}`, bgcolor: '#fff' }} />
            <Chip size="small" label={`Threshold ${dec(run.threshold, 2)}`} sx={{ border: `1px solid #fdba74`, bgcolor: D.orangeLight, color: D.orange }} />
            <Chip size="small" label={`Algorithm ${run.algorithm}`} sx={{ border: `1px solid ${D.border}`, bgcolor: '#fff' }} />
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ px: 2.5, py: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <DetailStat label="Holdout AUC" value={dec(run.testMetrics.auc)} />
          <DetailStat label="Holdout F1" value={dec(run.testMetrics.f1)} />
          <DetailStat label="Precision" value={pct(run.testMetrics.precisionPct)} />
          <DetailStat label="True Event Detection Rate" value={pct(run.testMetrics.detectionPct)} tone="green" />
          <DetailStat label="Review Load Control" value={pct(run.testMetrics.suppressionPct)} tone={suppressionTone(run.testMetrics.suppressionPct)} />
          <DetailStat label="Missed True Events %" value={pct(run.testMetrics.eventLossPct)} tone={eventLossTone(run.testMetrics.eventLossPct)} />
        </Stack>

        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', xl: '0.9fr 1.1fr' }, mt: 2 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <SectionLabel>Hyperparameters Used</SectionLabel>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: D.soft }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${D.border}` }}>
                      Parameter
                    </th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9.5, color: D.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${D.border}` }}>
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {run.hyperparameters.map(([key, value]) => (
                    <tr key={key} style={{ borderBottom: `1px solid ${D.border}` }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: D.text }}>{key}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: D.muted }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <SectionLabel>Train and Holdout Snapshot</SectionLabel>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: D.soft }}>
                    {['Metric', 'Train', 'Test'].map((header, index) => (
                      <th
                        key={header}
                        style={{
                          padding: '6px 10px',
                          textAlign: index === 0 ? 'left' : 'right',
                          fontSize: 9.5,
                          color: D.muted,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          borderBottom: `1px solid ${D.border}`,
                        }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['AUC', dec(run.trainMetrics.auc), dec(run.testMetrics.auc)],
                    ['F1', dec(run.trainMetrics.f1), dec(run.testMetrics.f1)],
                    ['Precision', pct(run.trainMetrics.precisionPct), pct(run.testMetrics.precisionPct)],
                    ['True Event Detection Rate', pct(run.trainMetrics.detectionPct), pct(run.testMetrics.detectionPct)],
                    ['Review Load Control', pct(run.trainMetrics.suppressionPct), pct(run.testMetrics.suppressionPct)],
                    ['Missed True Events %', pct(run.trainMetrics.eventLossPct), pct(run.testMetrics.eventLossPct)],
                    ['Alerts Escalated', fmt(run.trainMetrics.escalatedCount), fmt(run.testMetrics.escalatedCount)],
                    ['Alerts Set Aside', fmt(run.trainMetrics.suppressedCount), fmt(run.testMetrics.suppressedCount)],
                  ].map(([label, trainValue, testValue], index) => (
                    <tr key={label} style={{ borderBottom: `1px solid ${D.border}`, background: index % 2 === 0 ? '#fff' : '#fafbfd' }}>
                      <td style={{ padding: '6px 10px', color: D.text, fontWeight: 600 }}>{label}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.text }}>{trainValue}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: label === 'Missed True Events %' ? toneText[eventLossTone(run.testMetrics.eventLossPct)] || D.text : D.text, fontWeight: label === 'Missed True Events %' ? 700 : 400 }}>{testValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>
        </Box>

        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' }, mt: 2 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <SectionLabel>Train and Test Confusion Matrix</SectionLabel>
            <Tabs
              value={matrixTab}
              onChange={(_, value) => setMatrixTab(value)}
              textColor="inherit"
              TabIndicatorProps={{ style: { backgroundColor: D.orange } }}
              sx={{ mb: 1.25, '& .MuiTab-root': { textTransform: 'none', fontSize: 11.5, minHeight: 36, fontWeight: 700 } }}
            >
              <Tab label="Train" />
              <Tab label="Test" />
            </Tabs>
            <ConfusionMatrixView splitMetrics={splitMetrics} splitLabel={splitLabel} />
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <SectionLabel>Holdout Queue Shape</SectionLabel>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={queueShape} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <RTooltip formatter={(value) => fmt(value)} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                  {queueShape.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Typography sx={{ fontSize: 10.8, color: D.muted, lineHeight: 1.6 }}>
              Holdout queue shape shows how much alert volume remains with investigators after low-signal triage is applied.
            </Typography>
          </Paper>
        </Box>

        <Paper variant="outlined" sx={{ mt: 2, borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1.15, borderBottom: `1px solid ${D.border}`, bgcolor: '#fff' }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: D.text }}>
              Feature Ranking
            </Typography>
            <Typography sx={{ fontSize: 10.8, color: D.muted, mt: 0.25 }}>
              Gain-share labels show actual relative contribution for the leading AML features used by this run.
            </Typography>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: D.soft }}>
                  {['Rank', 'Feature', 'Gain Share', 'Visual'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '6px 10px',
                        textAlign: header === 'Gain Share' ? 'right' : 'left',
                        fontSize: 9.5,
                        color: D.muted,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        borderBottom: `1px solid ${D.border}`,
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.featureImportance.map((item, index) => (
                  <tr key={item.feature} style={{ borderBottom: `1px solid ${D.border}` }}>
                    <td style={{ padding: '6px 10px', width: 48, color: D.muted, fontFamily: 'monospace' }}>{index + 1}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: D.text, minWidth: 220 }}>{item.feature}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: D.text, width: 110 }}>{pct(item.share)}</td>
                    <td style={{ padding: '6px 10px', minWidth: 220 }}>
                      <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
                        <Box
                          sx={{
                            width: `${(item.share / featureMax) * 100}%`,
                            height: '100%',
                            bgcolor: index === 0 ? D.orange : '#94a3b8',
                          }}
                        />
                      </Box>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </Paper>
      </Box>
    </Paper>
  );
};

const ModelRegistryPanel = ({ activeRunId = '' }) => {
  const [searchText, setSearchText] = useState('');
  const [algorithmFilter, setAlgorithmFilter] = useState('all');
  const [sortField, setSortField] = useState('manual');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRunId, setSelectedRunId] = useState(
    MODELS.some((item) => item.runId === activeRunId) ? activeRunId : MODELS[0].runId,
  );

  const filteredRows = useMemo(() => {
    let rows = [...MODELS];

    if (algorithmFilter !== 'all') {
      rows = rows.filter((row) => row.algorithm === algorithmFilter);
    }

    if (searchText.trim()) {
      const pattern = searchText.trim().toLowerCase();
      rows = rows.filter((row) => (
        row.displayName.toLowerCase().includes(pattern)
        || row.runId.toLowerCase().includes(pattern)
        || row.algorithm.toLowerCase().includes(pattern)
      ));
    }

    if (sortField !== 'manual') {
      const direction = sortDirection === 'asc' ? 1 : -1;
      rows.sort((left, right) => {
        const sortMap = {
          reviewedAt: [left.reviewedAtTimestamp, right.reviewedAtTimestamp],
          algorithm: [left.displayName.toLowerCase(), right.displayName.toLowerCase()],
          threshold: [left.threshold, right.threshold],
          auc: [left.testMetrics.auc, right.testMetrics.auc],
          f1: [left.testMetrics.f1, right.testMetrics.f1],
          precision: [left.testMetrics.precisionPct, right.testMetrics.precisionPct],
          detection: [left.testMetrics.detectionPct, right.testMetrics.detectionPct],
          suppression: [left.testMetrics.suppressionPct, right.testMetrics.suppressionPct],
          eventLoss: [left.testMetrics.eventLossPct, right.testMetrics.eventLossPct],
        };

        const values = sortMap[sortField];
        if (!values) return 0;

        const [leftValue, rightValue] = values;
        if (leftValue < rightValue) return -1 * direction;
        if (leftValue > rightValue) return 1 * direction;
        return 0;
      });
    }

    return rows;
  }, [algorithmFilter, searchText, sortDirection, sortField]);

  const selectedRun = useMemo(
    () => filteredRows.find((row) => row.runId === selectedRunId) || filteredRows[0] || MODELS[0],
    [filteredRows, selectedRunId],
  );

  return (
    <Box sx={{ bgcolor: D.canvas, minHeight: '100%' }}>
      <Box sx={{ px: 3, py: 1.75, bgcolor: '#fff', borderBottom: `1px solid ${D.border}` }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <TableChart sx={{ fontSize: 18, color: D.orange }} />
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: D.text }}>
              Model Registry
            </Typography>
            <Typography sx={{ fontSize: 11, color: D.muted }}>
              Reviewed supervised AML candidates with randomized review timestamps, threshold variation near 0.50, and business-readable train/test diagnostics
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label="Mar-Apr 2026 review window" sx={{ bgcolor: '#f8fafc', color: D.muted, border: `1px solid ${D.border}`, fontWeight: 600, fontSize: 10 }} />
          <Chip size="small" label="10 registry runs" sx={{ bgcolor: '#f8fafc', color: D.muted, border: `1px solid ${D.border}`, fontWeight: 600, fontSize: 10 }} />
        </Stack>
      </Box>

      <Box sx={{ px: 3, pt: 2.5, pb: 3 }}>
        <Paper variant="outlined" sx={{ p: 1.6, borderRadius: 2, mb: 2, bgcolor: '#fff' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: D.text }}>
            Registry overview
          </Typography>
          <Typography sx={{ fontSize: 11, color: D.muted, lineHeight: 1.7, mt: 0.35 }}>
            This view is structured like an internal AML monitoring screen: unsorted reviewed runs, operational thresholds clustered near 0.50, holdout performance, and business-readable confusion outcomes for train and test review.
          </Typography>
        </Paper>

        <PipelineSummary />

        <RegistryTable
          rows={filteredRows}
          selectedRunId={selectedRun.runId}
          onSelect={setSelectedRunId}
          searchText={searchText}
          onSearchChange={setSearchText}
          algorithmFilter={algorithmFilter}
          onAlgorithmFilterChange={setAlgorithmFilter}
          sortField={sortField}
          onSortFieldChange={setSortField}
          sortDirection={sortDirection}
          onSortDirectionChange={setSortDirection}
        />

        {selectedRun && <DetailCard run={selectedRun} />}
      </Box>
    </Box>
  );
};

export default ModelRegistryPanel;
