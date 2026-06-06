/**
 * PreprocessingWorkbench.jsx  -  Full Production Preprocessing & Feature Engineering Workbench
 *
 * Props (match MLOpsWorkbench.jsx usage exactly):
 *   suggestions       []       auto-plan chips from preprocessPlan API
 *   steps             []       current pipeline steps (controlled)
 *   onStepsChange     fn       update pipeline
 *   onPreview         fn       trigger preprocessPreview
 *   onRun             fn       trigger preprocessRun
 *   preview           {}       preview result from parent
 *   onMasterBuild     fn       trigger master build
 *   datasets          []       uploaded source datasets (for lineage and source-table context)
 *   masterDataset     {}       master_dataset object (passed from MLOpsWorkbench)
 *   preprocessedDataset {}     preprocessed dataset object (after Run)
 *   targetColumn      string   target col from Step 3
 *   persona           string   'business' | 'technical'
 *   onComplete        fn       called after successful run with result dataset
 *
 * Backend step types (exactly what apply_preprocessing() handles):
 *   imputation, encoding_label, encoding_onehot, encoding_ordinal,
 *   encoding_frequency, scaling_standard, scaling_minmax, scaling_robust,
 *   normalize_l2, feature_polynomial, feature_interaction, feature_ratio,
 *   feature_aggregation, datetime_extract, text_features
 *
 * Feature selection generates drop_columns steps (no new backend type needed).
 *
 * Tabs:
 *   1. PLAN       auto-detected issues → one-click apply + manual step builder
 *   2. ENGINEER   AML domain templates + custom feature engineering form
 *   3. SELECT     leakage / variance / correlation / MI-importance filter
 *   4. PREVIEW    before↔after schema diff, column delta, 100-row sample table
 *   5. RUN        pipeline summary, output name, terminal log, save/load pipelines
 *
 * Right sidebar: live pipeline list, reorder, remove, save/load named pipelines.
 *
 * CHANGES vs original:
 *   - All emoji icons replaced with Material UI icons (professional look)
 *   - StepChip icon renders MUI SvgIcon instead of emoji character
 *   - Tab labels use icon + text via MUI Tab iconPosition="start"
 *   - SelectTab panel headers use MUI icons
 *   - AML_TEMPLATES use MUI icon refs instead of emoji strings
 *   - EngineerTab missing-column chips use Chip + HighlightOff icon
 *   - RunTab log terminal retains monospace; status icons swapped
 *   - Success / error states use MUI icons throughout
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider,
  Dialog, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper,
  Select, Slider, Stack, Tab, Tabs, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  Add,
  AutoFixHigh,
  Build,           // wrench - cleaning / imputation
  CheckCircle,
  Close,
  Code,            // polynomial / text
  CompareArrows,   // ratio / interaction
  DataObject,      // encoding
  Delete,
  DragIndicator,
  FolderOpen,
  Functions,       // aggregation
  HighlightOff,
  KeyboardArrowDown,
  KeyboardArrowUp,
  Link,            // interaction / feature link
  LinearScale,     // scaling / normalize
  MemoryOutlined,  // ML / model
  Percent,         // frequency encoding
  PlayArrow,
  QueryStats,      // importance / MI
  Refresh,
  Rule,            // variance threshold
  Save,
  ScatterPlot,     // correlation
  Settings,
  ShowChart,       // ratio / signal
  Shuffle,         // remove duplicates
  SortByAlpha,     // label encoding
  TableChart,      // preview
  Today,           // datetime
  TrendingUp,      // polynomial / velocity
  Insights,
  InfoOutlined,
  Warning,
  WorkspacePremium, // AML templates badge
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import PreprocessingBeforeAfter from './PreprocessingBeforeAfter';
import FeatureGovernanceWorkbench from './FeatureGovernanceWorkbench';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';
import {
  findPipelineByName,
  getScreenState,
  mergePipelinePayload,
} from '../utils/pipelineState';
import {
  normalizePreprocessSuggestions,
  unwrapApiPayload,
} from '../utils/preprocessingNormalization';

// ─── Design tokens (matches PwC / workbench palette) ─────────────────────────
const T = {
  orange:       '#D04A02',
  orangeHov:    '#b03e02',
  orangeLight:  '#f8f6f3',
  border:       '#e2e8f0',
  surface:      '#f7f8f9',
  textPri:      '#0f172a',
  textSec:      '#64748b',
  textDim:      '#94a3b8',
  done:         '#22c55e',
  doneBg:       '#f7faf7',
  doneBorder:   '#cfe2d2',
  warn:         '#f59e0b',
  warnBg:       '#faf7f2',
  warnBorder:   '#e7d8bf',
  danger:       '#ef4444',
  dangerBg:     '#faf4f4',
  dangerBorder: '#e8d3d6',
  infoBg:       '#f5f7f9',
  infoBorder:   '#d9e1ea',
  bgClean:      '#f7f8f9',
  bgEncode:     '#f7f8f9',
  bgScale:      '#f7f8f9',
  bgFeat:       '#f7f8f9',
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt  = n  => n == null ? '-' : Number(n).toLocaleString();
const fmtF = (v, d = 3) => v == null ? '-' : Number(v).toFixed(d);
const clip = (s, n = 20) => String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || '');
const isNumDtype = t => /int|float|double|decimal|numeric|real|number/.test((t || '').toLowerCase());
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;
const pct = (v, d = 1) => v == null ? 'â€”' : `${(Number(v) * 100).toFixed(d)}%`;
const summarizeColumns = (cols = [], limit = 4) => {
  if (!Array.isArray(cols) || cols.length === 0) return 'No columns';
  const head = cols.slice(0, limit).join(', ');
  return cols.length > limit ? `${head}, +${cols.length - limit} more` : head;
};

const FEATURE_SELECTION_TECHNIQUES = [
  { id: 'leakage_name_scan', label: 'Leakage Name Scan', family: 'Leakage', scope: 'filter', description: 'Flags post-event columns using AML outcome keywords.' },
  { id: 'leakage_target_corr', label: 'Leakage Target Correlation', family: 'Leakage', scope: 'filter', description: 'Flags near-perfect correlations with the target.' },
  { id: 'variance_threshold', label: 'Variance Threshold', family: 'Unsupervised', scope: 'filter', description: 'Removes near-constant numeric columns.' },
  { id: 'mean_abs_deviation', label: 'Mean Absolute Deviation', family: 'Unsupervised', scope: 'filter', description: 'Finds low-spread columns even when variance is small.' },
  { id: 'dispersion_ratio', label: 'Dispersion Ratio', family: 'Unsupervised', scope: 'filter', description: 'Checks whether values move enough relative to their magnitude.' },
  { id: 'correlation_filter', label: 'Correlation Filter', family: 'Unsupervised', scope: 'filter', description: 'Drops one feature from highly correlated pairs.' },
  { id: 'information_gain', label: 'Information Gain', family: 'Information Theory', scope: 'score', description: 'Mutual information between feature and binary target.' },
  { id: 'information_value', label: 'Weight of Evidence / Information Value', family: 'Scorecard', scope: 'score', description: 'WoE / IV strength for binary AML modelling.' },
  { id: 'uncertainty_coefficient', label: 'Uncertainty Coefficient', family: 'Information Theory', scope: 'score', description: 'Normalised information gain against target entropy.' },
  { id: 'pearson_abs', label: 'Pearson |r|', family: 'Correlation', scope: 'score', description: 'Absolute linear association with the target.' },
  { id: 'spearman_abs', label: 'Spearman |rho|', family: 'Correlation', scope: 'score', description: 'Rank correlation for monotonic effects.' },
  { id: 'kendall_abs', label: 'Kendall |tau|', family: 'Correlation', scope: 'score', description: 'Rank-order agreement with the target.' },
  { id: 'point_biserial_abs', label: 'Point-Biserial |r|', family: 'Correlation', scope: 'score', description: 'Binary-target correlation specialised for numeric features.' },
  { id: 'fisher_score', label: 'Fisher Score', family: 'Class Separation', scope: 'score', description: 'Difference in class means versus within-class spread.' },
  { id: 'anova_f_score', label: 'ANOVA F Score', family: 'Hypothesis Test', scope: 'score', description: 'Between-class versus within-class variance ratio.' },
  { id: 't_statistic_abs', label: 'Welch |t|', family: 'Hypothesis Test', scope: 'score', description: 'Absolute Welch t-statistic between positive and negative classes.' },
  { id: 'ks_statistic', label: 'KS Statistic', family: 'Distribution Test', scope: 'score', description: 'Maximum distance between class distributions.' },
  { id: 'roc_auc_univariate', label: 'Univariate ROC AUC', family: 'Ranking', scope: 'score', description: 'Single-feature discrimination quality.' },
  { id: 'gini_gain', label: 'Univariate Gini', family: 'Ranking', scope: 'score', description: 'Scaled ROC AUC for quick ordering.' },
  { id: 'chi_square', label: 'Chi-Square', family: 'Categorical Test', scope: 'score', description: 'Categorical dependence between feature and target.' },
  { id: 'likelihood_ratio', label: 'Likelihood Ratio G', family: 'Categorical Test', scope: 'score', description: 'Log-likelihood dependence test for categories.' },
  { id: 'cramers_v', label: "Cramer's V", family: 'Categorical Association', scope: 'score', description: 'Normalised categorical association strength.' },
  { id: 'target_rate_range', label: 'Target Rate Range', family: 'Segmentation', scope: 'score', description: 'Spread between weakest and strongest segment event rates.' },
  { id: 'target_rate_lift', label: 'Top Segment Lift', family: 'Segmentation', scope: 'score', description: 'Best segment event rate divided by the overall event rate.' },
  { id: 'event_rate_std', label: 'Event Rate Volatility', family: 'Segmentation', scope: 'score', description: 'Standard deviation of segment event rates.' },
  { id: 'woe_peak_abs', label: 'Weight of Evidence Peak', family: 'Scorecard', scope: 'score', description: 'Largest absolute WoE swing across bins or categories.' },
  { id: 'missingness_delta', label: 'Missingness Delta', family: 'Data Quality Signal', scope: 'score', description: 'Difference in target rate between missing and non-missing rows.' },
];
const FEATURE_SELECTION_TECHNIQUE_MAP = Object.fromEntries(
  FEATURE_SELECTION_TECHNIQUES.map((tech) => [tech.id, tech])
);

const PREPROCESS_TAB_GUIDES = {
  0: {
    title: 'Clean and Transform',
    subtitle: 'Review quality issues and choose deterministic preprocessing actions before model training.',
    note: 'This stage is rules-based and statistics-driven. It prepares data for modelling using sklearn-style transformations. No generative AI is making feature or cleaning decisions here.',
  },
  1: {
    title: 'Preprocessing Builder',
    subtitle: 'Assemble reusable transformation steps, inspect affected columns, and shape a governed preprocessing pipeline.',
    note: 'Builder actions create deterministic pipeline steps such as imputation, encoding, scaling, and feature rules.',
  },
  2: {
    title: 'AML Feature Engineering',
    subtitle: 'Add domain-specific behavioural signals that help separate low-value alerts from more actionable ones.',
    note: 'These are engineered features derived from data logic and AML heuristics, not from a generative model.',
  },
  3: {
    title: 'Feature Governance & Selection',
    subtitle: 'Review and approve safe features before model training, with explicit buckets for approved, review, leakage, post-outcome, and redundant fields.',
    note: 'No predictive model is trained here. This workbench blocks leakage, target proxies, post-investigation fields, and weak or redundant features before they reach AML model training.',
  },
  4: {
    title: 'Run the Preprocessing Pipeline',
    subtitle: 'Execute the approved transformation plan on the full dataset and save the model-ready output.',
    note: 'Running this stage applies the deterministic preprocessing graph to the full dataset and persists the output for model training.',
  },
};

const MULE_PREPROCESS_TAB_GUIDES = {
  0: {
    title: 'Clean and Prepare',
    subtitle: 'Review account-level data quality issues and choose deterministic preprocessing actions before mule model training.',
    note: 'This stage is rules-based and statistics-driven. It prepares account-level Mule data using deterministic preprocessing steps and governed feature logic.',
  },
  1: {
    title: 'Preprocessing Builder',
    subtitle: 'Assemble reusable transformation steps, inspect affected columns, and shape a governed Mule preprocessing pipeline.',
    note: 'Builder actions create deterministic pipeline steps such as imputation, encoding, scaling, and feature-safe transformations.',
  },
  2: {
    title: 'Mule Signal Engineering',
    subtitle: 'Add behavioural account-risk signals that help separate normal activity from mule-like behaviour.',
    note: 'These are engineered features derived from data logic and Mule heuristics, not from a generative model.',
  },
  3: {
    title: 'Feature Governance & Selection',
    subtitle: 'Review and approve safe account-level signals before model training, with explicit buckets for approved, review, leakage, post-outcome, and redundant fields.',
    note: 'No predictive model is trained here. This workbench blocks leakage, target proxies, post-outcome fields, and weak or redundant variables before they reach Mule model training.',
  },
  4: {
    title: 'Run the Preprocessing Pipeline',
    subtitle: 'Execute the approved Mule transformation plan on the full dataset and save the model-ready output.',
    note: 'Running this stage applies the deterministic preprocessing graph to the full Mule dataset and persists the output for model training.',
  },
};

const AML_TEMPLATE_EXPLAINERS = {
  'Cash Intensity Ratio': {
    summary: 'Measures how cash-heavy the activity is relative to the overall transaction footprint.',
    calculation: 'cash_txn_count divided by txn_count, with the ratio interpreted as the share of activity driven by cash behaviour.',
    why: 'Cash-heavy patterns often align with structuring, cash placement, or other monitoring scenarios where false positives and genuine risk behave differently.',
  },
  'Velocity Ratio': {
    summary: 'Measures how extreme the largest transaction is compared with the account or customer average.',
    calculation: 'max_txn_amount divided by avg_txn_amount.',
    why: 'A very high ratio can reveal sudden spikes that do not fit the normal pattern for the customer or account.',
  },
  'Balance-to-TXN Ratio': {
    summary: 'Compares available balance with normal transaction size.',
    calculation: 'CURRENT_BALANCE divided by avg_txn_amount.',
    why: 'This helps flag unusual balance context, such as high-value movement on low-balance profiles or vice versa.',
  },
  'PEP × Risk Score': {
    summary: 'Combines PEP status with customer risk level into one stronger interaction signal.',
    calculation: 'PEP_FLAG multiplied by CUSTOMER_RISK_RATING.',
    why: 'A single control can be weak on its own, but the interaction often captures higher-risk cases more clearly.',
  },
  'Offshore × Risk': {
    summary: 'Combines offshore activity with general risk score.',
    calculation: 'offshore_txn_count multiplied by RISK_SCORE.',
    why: 'This helps highlight customers whose offshore exposure is material only when paired with other risk indicators.',
  },
  'TXN Amount² (Polynomial)': {
    summary: 'Captures nonlinear threshold behaviour in transaction amount.',
    calculation: 'Creates a second-order term from TXN_AMOUNT so the model can learn curved relationships instead of only straight-line effects.',
    why: 'Some thresholds matter more at higher values, and a polynomial term helps the model capture that pattern.',
  },
  'Mean TXN by Account Type': {
    summary: 'Creates a peer-style benchmark by account type.',
    calculation: 'Average TXN_AMOUNT grouped by ACCOUNT_TYPE.',
    why: 'It helps compare each record against the normal amount level for that account category.',
  },
  'Std TXN by Customer Risk': {
    summary: 'Measures transaction volatility within customer risk bands.',
    calculation: 'Standard deviation of TXN_AMOUNT grouped by CUSTOMER_RISK_RATING.',
    why: 'Higher volatility in certain bands may indicate more unstable or suspicious behaviour patterns.',
  },
  'Extract Alert Date Parts': {
    summary: 'Breaks a date into reusable calendar signals.',
    calculation: 'Extracts year, month, day of week, and hour from ALERT_DATE.',
    why: 'Time-based patterns such as weekend or off-hours activity often matter for AML scenarios.',
  },
  'Narrative Text Features': {
    summary: 'Converts free text into simple deterministic text statistics.',
    calculation: 'Creates length, word count, and digit-presence features from NARRATIVE.',
    why: 'These features can help surface structured hints without introducing a full text model.',
  },
  'Frequency Encode Account Type': {
    summary: 'Encodes how common each account type is in the current dataset.',
    calculation: 'Replaces ACCOUNT_TYPE with its frequency count.',
    why: 'This is useful when raw categories are too many or too sparse for direct modelling.',
  },
  'Frequency Encode Country': {
    summary: 'Encodes how common each country value is in the current dataset.',
    calculation: 'Replaces COUNTRY_OF_ORIGIN with its frequency count.',
    why: 'This helps convert a wide categorical field into a stable numeric signal.',
  },
};

const FEATURE_SELECTION_EXPLAINERS = {
  information_gain: {
    plain: 'Measures how much knowing this column reduces uncertainty about the outcome.',
    why: 'Useful as a default ranking because it captures both numeric and categorical signal without assuming straight-line behaviour.',
    business: 'A higher score means the column does a better job separating likely false positives from more actionable alerts.',
  },
  information_value: {
    plain: 'Measures how strongly a column separates the two classes using scorecard-style bins.',
    why: 'Common in risk and AML scorecards because it is intuitive and stable for ranked features.',
    business: 'A higher IV usually means the feature is strong enough to include in a governed decisioning model.',
  },
  chi_square: {
    plain: 'Checks whether category differences are meaningfully linked to the target.',
    why: 'Best for categorical variables such as account type, country, or status.',
    business: 'Use it to confirm that business categories are not flat and actually behave differently against the target.',
  },
  pearson_abs: {
    plain: 'Measures straight-line relationship strength between a numeric feature and the target.',
    why: 'Fast way to screen numeric signals, especially when you expect roughly linear separation.',
    business: 'Good for checking whether higher or lower values consistently align with real alerts.',
  },
  spearman_abs: {
    plain: 'Measures whether the target tends to rise or fall consistently as the feature rank changes.',
    why: 'Useful when the relationship is monotonic but not perfectly linear.',
    business: 'Helpful when “more” of something generally means more risk, even if the effect is not smooth.',
  },
  ks_statistic: {
    plain: 'Measures how far apart the two class distributions are.',
    why: 'Strong for checking whether a single numeric feature separates the classes cleanly.',
    business: 'A larger KS means the feature does a better job keeping low-value alerts and actionable alerts apart.',
  },
};

const FEATURE_DECISION_STYLES = {
  keep: {
    label: 'Keep',
    color: '#166534',
    border: '#86efac',
    bg: '#f0fdf4',
  },
  review: {
    label: 'Review',
    color: '#9a3412',
    border: '#fdba74',
    bg: '#fff7ed',
  },
  drop: {
    label: 'Exclude',
    color: '#991b1b',
    border: '#fecaca',
    bg: '#fef2f2',
  },
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const humanizeFeatureName = (value = '') => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\btxn\b/gi, 'Transaction')
  .replace(/\bstr\b/gi, 'STR')
  .replace(/\bsar\b/gi, 'SAR')
  .replace(/\bpep\b/gi, 'PEP')
  .replace(/\bkyc\b/gi, 'KYC')
  .replace(/\bid\b/gi, 'ID')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (m) => m.toUpperCase());

const featureRoleLabel = (role = '') => {
  const value = String(role || '').toLowerCase();
  if (value === 'numeric' || value === 'binary') return 'Numeric signal';
  if (value === 'categorical') return 'Category signal';
  if (value === 'text') return 'Text-derived signal';
  return 'General field';
};

const inferFeatureBusinessMeaning = (column = '', role = '') => {
  const key = String(column || '').toLowerCase();
  if (key.includes('cash')) return 'Captures how cash-driven the customer or account behaviour appears.';
  if (key.includes('amount') || key.includes('amt')) return 'Describes transaction value patterns and unusual movement size.';
  if (key.includes('risk')) return 'Represents an upstream risk indicator or band already used in monitoring.';
  if (key.includes('country') || key.includes('geo') || key.includes('jurisdiction')) return 'Describes geographic exposure that may influence AML relevance.';
  if (key.includes('account')) return 'Represents account-type, account-behaviour, or account-relationship context.';
  if (key.includes('customer') || key.includes('party') || key.includes('counterparty')) return 'Represents customer or relationship context that may affect alert quality.';
  if (key.includes('date') || key.includes('time') || key.includes('hour') || key.includes('day')) return 'Represents timing behaviour such as recency, weekday, or time-of-day patterns.';
  if (key.includes('flag') || key.includes('hit') || key.includes('pep') || key.includes('sanction')) return 'Represents a rule, screening, or control flag that may shift alert priority.';
  if (key.includes('ratio') || key.includes('share') || key.includes('pct')) return 'Summarises a relative behaviour pattern instead of a raw count.';
  if (key.includes('count') || key.includes('freq') || key.includes('volume')) return 'Measures how often a behaviour occurs in the observed period.';
  if (key.includes('score')) return 'Represents a scored risk or prioritisation signal from upstream logic.';
  if (String(role || '').toLowerCase() === 'categorical') return 'Describes a business segment or operating category that may behave differently across alerts.';
  if (String(role || '').toLowerCase() === 'numeric') return 'Measures the size, frequency, or intensity of behaviour that may help separate alert outcomes.';
  return 'Provides operational context that may or may not help distinguish low-value and actionable alerts.';
};

const featureInterpretabilityLabel = (role = '', distinctCount = 0) => {
  const value = String(role || '').toLowerCase();
  if (value === 'categorical' && Number(distinctCount || 0) <= 20) return 'High';
  if (value === 'numeric') return 'Medium';
  if (value === 'text') return 'Low';
  return 'Medium';
};

const featureQualityLabel = (missingPct = 0, unstable = false) => {
  const missing = Number(missingPct || 0);
  if (missing >= 0.6) return 'Poor';
  if (missing >= 0.25 || unstable) return 'Warning';
  return 'Good';
};

const LIKELY_ID_REGEX = /(^id$|_id$|^id_|alert_id|transaction_id|txn_id|account_id|customer_id|case_id|investigator_id|mapping_id|ucic|reference_id)/i;
const DATE_TIME_REGEX = /(date|time|timestamp|filed|opened|closed|created|updated|hour|month|year)/i;

const humanizeTableName = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown source';
  return raw
    .replace(/_/g, ' ')
    .replace(/\btxn\b/gi, 'transaction')
    .replace(/\bstr\b/gi, 'STR')
    .replace(/\bsar\b/gi, 'SAR')
    .replace(/\bpep\b/gi, 'PEP')
    .replace(/\bkyc\b/gi, 'KYC')
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

const isLikelyIdColumn = (name = '') => LIKELY_ID_REGEX.test(String(name || '').trim());

const inferBuilderSemanticType = (name = '', dtype = '', stats = null) => {
  const lower = String(name || '').toLowerCase();
  const dataType = String(dtype || '').toLowerCase();
  if (isLikelyIdColumn(lower)) return 'Identifier';
  if (DATE_TIME_REGEX.test(lower) || /date|time/.test(dataType)) return 'Date / time';
  if (/flag|hit|pep|sanction|watchlist|is_/.test(lower)) return 'Risk / control flag';
  if (/country|state|city|geo|jurisdiction/.test(lower)) return 'Geography';
  if (/account|product|segment|type|channel|rule/.test(lower)) return 'Business category';
  if (/amount|balance|score|count|ratio|volume|value|limit|age/.test(lower)) return 'Numeric behaviour';
  if (/description|narrative|remarks|comment/.test(lower)) return 'Narrative text';
  if ((stats?.numeric_parse_ratio || 0) >= 0.85 || isNumDtype(dtype)) return 'Numeric behaviour';
  return 'General attribute';
};

const parseBuilderPairs = (pairsRaw = '') => String(pairsRaw || '')
  .split(',')
  .map((pair) => {
    const [a, b] = String(pair || '').split(':').map((item) => item.trim());
    return { a, b };
  })
  .filter((pair) => pair.a && pair.b);

const buildColumnCatalog = ({
  availableCols = [],
  colTypes = {},
  datasets = [],
  masterDataset = null,
  targetColumn = '',
  statsMap = {},
}) => {
  const uploadedDatasets = Array.isArray(datasets) ? datasets : [];
  const targetKey = String(targetColumn || '').trim().toLowerCase();
  return availableCols.map((name) => {
    const stats = statsMap?.[name] || {};
    const sourceTables = uploadedDatasets
      .filter((dataset) => Array.isArray(dataset?.columns) && dataset.columns.includes(name))
      .map((dataset) => String(dataset.dataset_type || '').trim())
      .filter(Boolean);
    const isTarget = targetKey && String(name || '').trim().toLowerCase() === targetKey;
    const isId = isLikelyIdColumn(name);
    const isDerived = sourceTables.length === 0 && !isTarget;
    const tags = [];
    if (sourceTables.length > 0) tags.push('Source Table');
    if (sourceTables.length > 1) tags.push('Joined Table');
    if (sourceTables.length === 0) tags.push('Master Table');
    if (isDerived) tags.push('Derived Column');
    if (isTarget) tags.push('Target Column');
    if (isId) tags.push('ID Column');

    const sampleValues = Array.isArray(stats?.sample_values) && stats.sample_values.length
      ? stats.sample_values.slice(0, 4)
      : Array.isArray(stats?.top_categories)
      ? stats.top_categories.slice(0, 4).map((item) => String(item?.value ?? '').trim()).filter(Boolean)
      : [];

    const primaryTable = sourceTables[0] || masterDataset?.dataset_type || 'master_dataset';
    return {
      name,
      dtype: String(colTypes?.[name] || stats?.dtype || 'unknown'),
      table: primaryTable,
      tables: sourceTables.length ? sourceTables : [primaryTable],
      tableLabel: sourceTables.length > 1
        ? `${humanizeTableName(primaryTable)} +${sourceTables.length - 1}`
        : humanizeTableName(primaryTable),
      semanticType: inferBuilderSemanticType(name, colTypes?.[name] || stats?.dtype || '', stats),
      missingPct: Number(stats?.missing_pct || 0),
      distinctCount: Number(stats?.distinct_count || 0),
      sampleValues,
      businessMeaning: inferFeatureBusinessMeaning(name, inferBuilderSemanticType(name, colTypes?.[name] || stats?.dtype || '', stats)),
      tags,
      isTarget,
      isId,
      isDerived,
      description: sampleValues.length
        ? sampleValues.join(', ')
        : 'No sampled values are available yet.',
    };
  });
};

const BUILDER_OPERATION_GUIDES = {
  imputation: {
    title: 'Fill missing values',
    what: 'Replace blank cells using a deterministic fill strategy such as mean, median, mode, or a fixed value.',
    when: 'Use when the field is important enough to keep, but missing values would block training or distort scoring.',
    output: 'Updates the selected column in place. No new column is created.',
  },
  drop_duplicates: {
    title: 'Remove duplicate rows',
    what: 'Drops repeated records that should represent the same business event.',
    when: 'Use when duplicate rows inflate volume, counts, or downstream event rates.',
    output: 'Reduces row count in the working dataset.',
  },
  encoding_label: {
    title: 'Convert categories to numeric labels',
    what: 'Turns each category into a numeric code so the modelling pipeline can consume it.',
    when: 'Use for low-to-medium-cardinality categories when ordered meaning is not important.',
    output: 'Updates the selected column in place.',
  },
  encoding_onehot: {
    title: 'Create one column per category',
    what: 'Expands each category into separate yes-or-no indicator columns.',
    when: 'Use when the category set is small and you want the model to treat each value independently.',
    output: 'Creates multiple indicator columns from the selected input field.',
  },
  encoding_ordinal: {
    title: 'Apply ordered category encoding',
    what: 'Maps categories to an explicit business order such as low, medium, high.',
    when: 'Use when the business meaning has a true ranking that should be preserved numerically.',
    output: 'Updates the selected column in place.',
  },
  encoding_frequency: {
    title: 'Replace category with frequency',
    what: 'Substitutes each category with how often it appears in the current dataset.',
    when: 'Use when categories are too many or too sparse for direct one-hot encoding.',
    output: 'Creates a frequency-based numeric version of the selected category.',
  },
  scaling_standard: {
    title: 'Standardise numeric scale',
    what: 'Centers numeric fields and rescales them so large-value columns do not dominate.',
    when: 'Use when numeric columns are on very different scales and the model is scale-sensitive.',
    output: 'Updates the selected numeric columns in place.',
  },
  scaling_minmax: {
    title: 'Compress values into a 0 to 1 range',
    what: 'Moves numeric values into a common bounded scale.',
    when: 'Use when the model or downstream comparison benefits from fixed numeric bounds.',
    output: 'Updates the selected numeric columns in place.',
  },
  scaling_robust: {
    title: 'Scale while reducing outlier influence',
    what: 'Rescales fields using robust statistics instead of raw mean and variance.',
    when: 'Use when large outliers are expected and should not dominate the transformation.',
    output: 'Updates the selected numeric columns in place.',
  },
  normalize_l2: {
    title: 'Normalise row magnitude',
    what: 'Rescales values so each record has comparable overall vector size.',
    when: 'Use when distance-based methods or comparisons should focus on pattern, not raw magnitude.',
    output: 'Updates the selected numeric columns in place.',
  },
  feature_ratio: {
    title: 'Create a ratio feature',
    what: 'Divides one field by another to express relative behaviour instead of raw counts or amounts.',
    when: 'Use when a proportion is more meaningful than either input column alone.',
    output: 'Creates a new derived column for each A:B pair.',
  },
  feature_interaction: {
    title: 'Create an interaction feature',
    what: 'Combines two fields multiplicatively to capture joint behaviour.',
    when: 'Use when the combination of two signals matters more than either one on its own.',
    output: 'Creates a new derived column for each selected pair.',
  },
  feature_polynomial: {
    title: 'Create nonlinear numeric terms',
    what: 'Adds squared or higher-order versions of a numeric feature.',
    when: 'Use when the business effect accelerates or bends instead of changing in a straight line.',
    output: 'Creates one or more power-based derived columns.',
  },
  feature_aggregation: {
    title: 'Summarise a value within a group',
    what: 'Calculates metrics like mean, sum, count, or standard deviation inside a selected business grouping.',
    when: 'Use when the record should be compared against its peer group, such as account type or risk band.',
    output: 'Creates a new grouped summary column such as avg transaction amount by account type.',
  },
  datetime_extract: {
    title: 'Break a timestamp into reusable parts',
    what: 'Extracts year, month, day-of-week, or hour from a date field.',
    when: 'Use when timing patterns may explain alert quality or operational behaviour.',
    output: 'Creates several new date-part columns.',
  },
  text_features: {
    title: 'Create simple text-derived features',
    what: 'Generates deterministic text statistics such as length, word count, or digit presence.',
    when: 'Use when you want basic narrative structure without introducing a text model.',
    output: 'Creates multiple derived columns from the selected text field.',
  },
};

const describeBuilderOutput = ({ type, cols = [], cfg = {} }) => {
  if (type === 'drop_duplicates') {
    return { input: 'Current working dataset', transform: 'Duplicate removal rule', output: 'Cleaner row set with duplicates removed' };
  }
  if (type === 'feature_ratio') {
    const pairs = parseBuilderPairs(cfg.pairsRaw);
    return {
      input: pairs.length ? pairs.map((pair) => `${pair.a} and ${pair.b}`).join(', ') : 'Choose two related columns',
      transform: 'Ratio logic',
      output: pairs.length ? pairs.map((pair) => `${pair.a}_div_${pair.b}`).join(', ') : 'A_div_B derived field',
    };
  }
  if (type === 'feature_interaction') {
    const pairs = parseBuilderPairs(cfg.pairsRaw);
    return {
      input: pairs.length ? pairs.map((pair) => `${pair.a} and ${pair.b}`).join(', ') : 'Choose two complementary signals',
      transform: 'Interaction logic',
      output: pairs.length ? pairs.map((pair) => `${pair.a}_x_${pair.b}`).join(', ') : 'A_x_B derived field',
    };
  }
  if (type === 'feature_aggregation') {
    return {
      input: cfg.groupTarget && cfg.groupBy ? `${cfg.groupTarget} grouped by ${cfg.groupBy}` : 'Select a grouping field and numeric target',
      transform: `${cfg.agg || 'mean'} aggregation`,
      output: cfg.groupTarget && cfg.groupBy ? `${cfg.groupTarget}_${cfg.agg || 'mean'}_by_${cfg.groupBy}` : 'grouped_summary_feature',
    };
  }
  if (type === 'feature_polynomial') {
    return {
      input: cols.length ? cols.join(', ') : 'Select one or more numeric columns',
      transform: `Polynomial expansion (degree ${cfg.degree || 2})`,
      output: cols.length ? cols.map((col) => `${col}_pow2`).join(', ') : 'col_pow2',
    };
  }
  if (type === 'datetime_extract') {
    return {
      input: cols.length ? cols.join(', ') : 'Select a date column',
      transform: 'Date part extraction',
      output: cols.length ? cols.map((col) => `${col}_year, ${col}_month, ${col}_dayofweek`).join(' | ') : 'date_part_columns',
    };
  }
  if (type === 'text_features') {
    return {
      input: cols.length ? cols.join(', ') : 'Select a text column',
      transform: 'Deterministic text statistics',
      output: cols.length ? cols.map((col) => `${col}_length, ${col}_word_count`).join(' | ') : 'text_feature_columns',
    };
  }
  if (type.startsWith('encoding_')) {
    return {
      input: cols.length ? cols.join(', ') : 'Select one or more categorical columns',
      transform: stepMeta(type).label,
      output: type === 'encoding_onehot' ? 'Multiple indicator columns' : 'Encoded column values',
    };
  }
  return {
    input: cols.length ? cols.join(', ') : 'Select one or more columns',
    transform: stepMeta(type).label,
    output: 'Updated model-ready fields',
  };
};

const validateBuilderStep = ({ type, cols = [], cfg = {}, targetColumn = '' }) => {
  const warnings = [];
  const errors = [];
  const pairs = parseBuilderPairs(cfg.pairsRaw);
  const selected = [...cols];
  if (cfg.groupBy) selected.push(cfg.groupBy);
  if (cfg.groupTarget) selected.push(cfg.groupTarget);
  pairs.forEach((pair) => {
    selected.push(pair.a, pair.b);
    if (pair.a === pair.b) {
      errors.push(`Pair ${pair.a}:${pair.b} repeats the same column. Choose two different fields.`);
    }
  });

  if (targetColumn && selected.some((name) => String(name || '').trim().toLowerCase() === String(targetColumn).trim().toLowerCase())) {
    warnings.push('The target column is part of this transformation. That is usually unsafe for model inputs and can create leakage.');
  }

  if (type === 'feature_aggregation' && isLikelyIdColumn(cfg.groupTarget)) {
    errors.push('Do not aggregate an ID-like column. IDs should identify records, not be averaged or summed.');
  }

  if (['scaling_standard', 'scaling_minmax', 'scaling_robust', 'normalize_l2', 'feature_polynomial'].includes(type) && cols.some(isLikelyIdColumn)) {
    warnings.push('One or more selected columns look like identifiers. Scaling or polynomial transforms on IDs usually add noise instead of signal.');
  }

  if (['feature_ratio', 'feature_interaction'].includes(type) && pairs.some((pair) => isLikelyIdColumn(pair.a) || isLikelyIdColumn(pair.b))) {
    warnings.push('A selected pair contains an ID-like field. Interaction and ratio features should usually use behavioural values, not identifiers.');
  }

  return { warnings, errors };
};

// ─── Step taxonomy ────────────────────────────────────────────────────────────
// icon: MUI component reference (not emoji)
const STEPS = {
  mapping_id:          { cat: 'select', Icon: DragIndicator, label: 'Mapping ID',         bg: T.infoBg   },
  tag_mapping_id:      { cat: 'select', Icon: DragIndicator, label: 'Tag Mapping ID',     bg: T.infoBg   },
  keep_mapping:        { cat: 'select', Icon: DragIndicator, label: 'Keep Mapping',       bg: T.infoBg   },
  imputation:          { cat: 'clean',  Icon: Build,          label: 'Imputation',          bg: T.bgClean  },
  drop_duplicates:     { cat: 'clean',  Icon: Shuffle,        label: 'Remove Duplicates',   bg: T.bgClean  },
  encoding_label:      { cat: 'encode', Icon: SortByAlpha,    label: 'Label Encoding',      bg: T.bgEncode },
  encoding_onehot:     { cat: 'encode', Icon: DataObject,     label: 'One-Hot Encoding',    bg: T.bgEncode },
  encoding_ordinal:    { cat: 'encode', Icon: LinearScale,    label: 'Ordinal Encoding',    bg: T.bgEncode },
  encoding_frequency:  { cat: 'encode', Icon: Percent,        label: 'Frequency Encoding',  bg: T.bgEncode },
  scaling_standard:    { cat: 'scale',  Icon: LinearScale,    label: 'Standard Scaler',     bg: T.bgScale  },
  scaling_minmax:      { cat: 'scale',  Icon: ShowChart,      label: 'Min-Max Scaler',      bg: T.bgScale  },
  scaling_robust:      { cat: 'scale',  Icon: Rule,           label: 'Robust Scaler',       bg: T.bgScale  },
  normalize_l2:        { cat: 'scale',  Icon: Functions,      label: 'L2 Normalize',        bg: T.bgScale  },
  feature_ratio:       { cat: 'feat',   Icon: CompareArrows,  label: 'Ratio Feature',       bg: T.bgFeat   },
  feature_interaction: { cat: 'feat',   Icon: Link,           label: 'Interaction Term',    bg: T.bgFeat   },
  feature_polynomial:  { cat: 'feat',   Icon: TrendingUp,     label: 'Polynomial Features', bg: T.bgFeat   },
  feature_aggregation: { cat: 'feat',   Icon: Functions,      label: 'Group Aggregation',   bg: T.bgFeat   },
  datetime_extract:    { cat: 'feat',   Icon: Today,          label: 'Datetime Extract',    bg: T.bgFeat   },
  text_features:       { cat: 'feat',   Icon: Code,           label: 'Text Features',       bg: T.bgFeat   },
  drop_columns:        { cat: 'select', Icon: Delete,         label: 'Drop Columns',        bg: T.dangerBg },
};

const stepMeta = t => STEPS[t] || { cat: 'clean', Icon: Settings, label: t, bg: T.bgClean };

const STEP_RUNTIME_HINTS = {
  mapping_id: { tier: 'Instant', estimate: '<1s', color: T.done, bg: T.doneBg, note: 'Metadata mapping marker only.' },
  tag_mapping_id: { tier: 'Instant', estimate: '<1s', color: T.done, bg: T.doneBg, note: 'Traceability tag marker only.' },
  keep_mapping: { tier: 'Instant', estimate: '<1s', color: T.done, bg: T.doneBg, note: 'Keeps mapping columns for traceability.' },
  drop_columns: { tier: 'Instant', estimate: '<1s', color: T.done, bg: T.doneBg, note: 'Column removal is usually very fast.' },
  imputation: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Depends on row count and selected columns.' },
  drop_duplicates: { tier: 'Medium', estimate: '3-10s', color: T.warn, bg: T.warnBg, note: 'Scans rows for duplicates.' },
  encoding_label: { tier: 'Fast', estimate: '1-4s', color: T.info, bg: T.infoBg, note: 'Maps categories to integers.' },
  encoding_frequency: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Counts category frequency per selected column.' },
  encoding_ordinal: { tier: 'Fast', estimate: '1-4s', color: T.info, bg: T.infoBg, note: 'Applies configured category order.' },
  encoding_onehot: { tier: 'Can be slow', estimate: '5s+', color: T.warn, bg: T.warnBg, note: 'High-cardinality columns can expand many features.' },
  scaling_standard: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Numeric vector calculation.' },
  scaling_minmax: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Numeric vector calculation.' },
  scaling_robust: { tier: 'Medium', estimate: '3-8s', color: T.warn, bg: T.warnBg, note: 'Quantile calculation can take longer.' },
  normalize_l2: { tier: 'Medium', estimate: '3-8s', color: T.warn, bg: T.warnBg, note: 'Vector normalization over selected columns.' },
  feature_ratio: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Creates simple ratio features.' },
  feature_interaction: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Creates simple pairwise products.' },
  feature_polynomial: { tier: 'Medium', estimate: '3-8s', color: T.warn, bg: T.warnBg, note: 'Adds powers for selected numeric columns.' },
  feature_aggregation: { tier: 'Can be slow', estimate: '5s+', color: T.warn, bg: T.warnBg, note: 'Group-by aggregation over the full master data.' },
  datetime_extract: { tier: 'Fast', estimate: '1-5s', color: T.info, bg: T.infoBg, note: 'Parses dates and creates calendar fields.' },
  text_features: { tier: 'Medium', estimate: '3-8s', color: T.warn, bg: T.warnBg, note: 'String processing on full text columns.' },
};

const stepRuntimeHint = (type) => STEP_RUNTIME_HINTS[String(type || '').toLowerCase()] || {
  tier: 'Medium',
  estimate: '3-8s',
  color: T.warn,
  bg: T.warnBg,
  note: 'Runtime depends on selected rows and columns.',
};

const fmtDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
};

const CLEAN_ENCODE_TYPES  = ['mapping_id','tag_mapping_id','keep_mapping','imputation','drop_duplicates','encoding_label','encoding_onehot','encoding_ordinal','encoding_frequency'];
const SCALE_TYPES         = ['scaling_standard','scaling_minmax','scaling_robust','normalize_l2'];
const FEAT_ENG_TYPES      = ['feature_ratio','feature_interaction','feature_polynomial','feature_aggregation','datetime_extract','text_features'];

const IMPUTATION_STRATS   = ['mean','median','mode','constant','ffill','bfill','interpolate','knn','mice'];
const AGG_OPS             = ['mean','median','sum','std','min','max','count','nunique'];

// ─── Shared UI atoms ─────────────────────────────────────────────────────────
const Spinner = ({ label }) => (
  <Box sx={{ py: 6, textAlign: 'center' }}>
    <CircularProgress size={28} sx={{ color: T.orange, mb: 1.5, display: 'block', mx: 'auto' }} />
    <Typography variant="body2" color="text.secondary">{label || 'Loading…'}</Typography>
  </Box>
);

const Card = ({ children, sx = {}, accent }) => (
  <Paper variant="outlined" sx={{
    p: 2, borderRadius: 0,
    borderColor: accent === 'orange' ? T.orange : accent === 'green' ? T.doneBorder
               : accent === 'red'    ? T.dangerBorder : T.border,
    bgcolor: 'white', ...sx,
  }}>
    {children}
  </Paper>
);

const SLabel = ({ children, sx = {} }) => (
  <Typography variant="caption" sx={{
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8,
    fontSize: 10, color: T.textSec, display: 'block', mb: 0.75, ...sx,
  }}>
    {children}
  </Typography>
);

const OBtn = ({ children, onClick, disabled, icon, variant = 'contained', size = 'small', sx = {} }) => (
  <Button size={size} variant={variant} startIcon={icon} onClick={onClick} disabled={canDisable(disabled)} sx={{
    textTransform: 'none', fontWeight: 600, borderRadius: 0, boxShadow: 'none',
    ...(variant === 'contained'
      ? { bgcolor: T.orange, color: 'white',
          '&:hover': { bgcolor: T.orangeHov },
          '&.Mui-disabled': { bgcolor: '#fed7b8', color: 'white' } }
      : { borderColor: T.orange, color: T.orange, '&:hover': { bgcolor: T.orangeLight } }),
    ...sx,
  }}>
    {children}
  </Button>
);

// ─── Pipeline step chip (used in sidebar) ────────────────────────────────────
const StepChip = ({ step, idx, total, onRemove, onMove }) => {
  const m = stepMeta(step.type);
  const StepIcon = m.Icon;
  const colStr = [
    step.columns?.length ? step.columns.slice(0, 3).join(', ') + (step.columns.length > 3 ? '…' : '') : '',
    step.strategy,
    step.pairs?.length ? `${step.pairs.length} pair(s)` : '',
    step.group_by ? `${step.agg || 'mean'}(${step.target}) by ${step.group_by}` : '',
    step.reason,
  ].filter(Boolean).join(' · ');

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      px: 1.5, py: 0.9, borderRadius: 1.5,
      bgcolor: m.bg, border: `1px solid ${T.border}`,
      transition: 'box-shadow 0.1s',
      '&:hover': { boxShadow: '0 2px 6px rgba(0,0,0,0.07)' },
    }}>
      <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: T.orange, flexShrink: 0,
                 display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ color: 'white', fontSize: 9.5, fontWeight: 700 }}>{idx + 1}</Typography>
      </Box>
      <StepIcon sx={{ fontSize: 14, color: T.textSec, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 11.5, lineHeight: 1.2 }}>{m.label}</Typography>
        <Typography variant="caption" sx={{ fontSize: 9.5, color: T.textSec, fontFamily: 'monospace' }} noWrap>
          {colStr}
        </Typography>
      </Box>
      <IconButton size="small" onClick={() => onMove(idx, idx - 1)} disabled={canDisable(idx === 0)}
        sx={{ p: 0.3, '&.Mui-disabled': { opacity: 0.2 } }}>
        <KeyboardArrowUp sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton size="small" onClick={() => onMove(idx, idx + 1)} disabled={canDisable(idx === total - 1)}
        sx={{ p: 0.3, '&.Mui-disabled': { opacity: 0.2 } }}>
        <KeyboardArrowDown sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton size="small" onClick={() => onRemove(idx)}
        sx={{ p: 0.3, color: T.danger, '&:hover': { bgcolor: T.dangerBg } }}>
        <Close sx={{ fontSize: 13 }} />
      </IconButton>
    </Box>
  );
};

// ─── Pipeline sidebar ─────────────────────────────────────────────────────────
const PipelineSidebar = ({
  steps,
  onRemove,
  onMove,
  onClear,
  onLoad,
  onLoadState,
  masterDataset,
  preprocessedDataset,
  activeTab = 0,
  visitedTabs = [],
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
}) => {
  const [saveName,   setSaveName]   = useState(activePipelineName || '');
  const [saveOk,     setSaveOk]     = useState(false);
  const [pipelines,  setPipelines]  = useState([]);
  const [loadOpen,   setLoadOpen]   = useState(false);
  const [loadErr,    setLoadErr]    = useState('');
  const hydratedPipelineRef = useRef('');
  const autosaveTimerRef = useRef(null);
  const hydratingRef = useRef(false);
  const skipAutosaveRef = useRef(false);

  useEffect(() => {
    if (activePipelineName) {
      setSaveName(activePipelineName);
    }
  }, [activePipelineName]);

  const preprocessScreenState = useMemo(() => ({
    steps,
    activeTab,
    visitedTabs: Array.isArray(visitedTabs) ? Array.from(new Set(visitedTabs.filter((value) => Number.isInteger(value)))) : [],
    masterDatasetId: Number(masterDataset?.dataset_id || 0) || null,
    preprocessedDatasetId: Number(preprocessedDataset?.dataset_id || 0) || null,
  }), [activeTab, masterDataset?.dataset_id, preprocessedDataset?.dataset_id, steps, visitedTabs]);

  const buildPreprocessPayload = useCallback((nameValue) => ({
    name: nameValue,
    dataset_id: Number(masterDataset?.dataset_id || 0),
    transforms: steps,
    created_by_persona: 'technical',
    steps: [{
      type: 'screen_state',
      screen: 'preprocess',
      state: preprocessScreenState,
    }],
  }), [masterDataset?.dataset_id, preprocessScreenState, steps]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  const save = async () => {
    if (!saveName.trim() || !steps.length || !masterDataset?.dataset_id) return;
    try {
      const trimmed = saveName.trim();
      let payload = buildPreprocessPayload(trimmed);
      const selectedByName = findPipelineByName(pipelines, trimmed);
      const mergeSourceId = activePipelineId || selectedByName?.pipeline_id || null;

      if (mergeSourceId) {
        try {
          const existingRes = await mlopsApi.pipelineGet(mergeSourceId);
          const existing = existingRes?.data || existingRes;
          payload = mergePipelinePayload({
            existingPipeline: existing,
            payload,
            screenKey: 'preprocess',
            currentState: preprocessScreenState,
          });
          payload.transforms = steps;
        } catch {
          // fallback to new payload save
        }
      }

      const savedRes = await mlopsApi.pipelineSave(payload);
      const saved = savedRes?.data || savedRes;
      const savedId = Number(saved?.pipeline_id || 0);
      if (savedId > 0) {
        try {
          const fullRes = await mlopsApi.pipelineGet(savedId);
          const full = fullRes?.data || fullRes;
          onPipelineActivated?.(full?.pipeline_id ? full : {
            pipeline_id: savedId,
            name: trimmed,
          });
        } catch {
          onPipelineActivated?.({
            pipeline_id: savedId,
            name: trimmed,
          });
        }
      }
      setSaveOk(true); setTimeout(() => setSaveOk(false), 2200);
    } catch (e) { console.error(e); }
  };

  const fetchPipelines = async () => {
    if (!masterDataset?.dataset_id && !activePipelineId) return;
    try {
      const res = await mlopsApi.pipelineList(masterDataset?.dataset_id || undefined);
      setPipelines(res?.data || res || []);
      setLoadErr('');
    } catch (e) { setLoadErr('Failed to load pipelines'); }
    setLoadOpen(v => !v);
  };

  const extractLoadedSteps = useCallback((pipeline) => {
    const fromScreen = getScreenState(pipeline?.steps, 'preprocess');
    if (Array.isArray(fromScreen?.steps)) return fromScreen.steps;

    const nonScreen = (Array.isArray(pipeline?.steps) ? pipeline.steps : []).filter((step) => {
      return String(step?.type || '').toLowerCase() !== 'screen_state';
    });
    if (nonScreen.length > 0) return nonScreen;

    if (Array.isArray(pipeline?.transforms)) return pipeline.transforms;
    return [];
  }, []);

  const extractLoadedState = useCallback((pipeline) => {
    const fromScreen = getScreenState(pipeline?.steps, 'preprocess') || {};
    const loadedSteps = extractLoadedSteps(pipeline);
    const nextActiveTab = Number.isInteger(fromScreen?.activeTab) ? fromScreen.activeTab : null;
    const nextVisitedTabs = Array.isArray(fromScreen?.visitedTabs)
      ? Array.from(new Set(fromScreen.visitedTabs.filter((value) => Number.isInteger(value))))
      : [];
    return {
      steps: loadedSteps,
      activeTab: nextActiveTab,
      visitedTabs: nextVisitedTabs,
    };
  }, [extractLoadedSteps]);

  useEffect(() => {
    const pipelineId = activePipelineId != null && activePipelineId !== '' ? String(activePipelineId) : '';
    if (!pipelineId || hydratedPipelineRef.current === pipelineId) return;

    let alive = true;
    hydratingRef.current = true;
    (async () => {
      try {
        const fullRes = await mlopsApi.pipelineGet(pipelineId);
        const full = fullRes?.data || fullRes;
        const loaded = extractLoadedState(full);
        if (!alive) return;
        skipAutosaveRef.current = true;
        onLoadState?.(loaded);
        hydratedPipelineRef.current = pipelineId;
      } catch (e) {
        if (!alive) return;
        setLoadErr(e?.message || 'Failed to restore preprocessing state');
      } finally {
        if (alive) hydratingRef.current = false;
      }
    })();

    return () => {
      alive = false;
      hydratingRef.current = false;
    };
  }, [activePipelineId, extractLoadedState, onLoadState]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return undefined;
    if (hydratingRef.current) return undefined;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return undefined;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, {
        screen: 'preprocess',
        state: preprocessScreenState,
      })
        .then((res) => {
          const payload = res?.data || res;
          if (payload?.pipeline_id) onPipelineActivated?.(payload);
        })
        .catch(() => {});
    }, 900);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [activePipelineId, onPipelineActivated, preprocessScreenState]);

  const handleLoadPipeline = useCallback(async (pipelineId) => {
    try {
      const fullRes = await mlopsApi.pipelineGet(pipelineId);
      const full = fullRes?.data || fullRes;
      const loaded = extractLoadedState(full);
      onLoadState?.(loaded);
      onLoad?.(loaded?.steps || []);
      onPipelineActivated?.(full?.pipeline_id ? full : {
        pipeline_id: Number(full?.pipeline_id || pipelineId),
        name: String(full?.name || ''),
      });
      setLoadOpen(false);
      setLoadErr('');
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load pipeline');
    }
  }, [extractLoadedState, onLoad, onLoadState, onPipelineActivated]);

  const counts = useMemo(() => {
    const c = { clean: 0, encode: 0, scale: 0, feat: 0, select: 0 };
    steps.forEach(s => { const cat = stepMeta(s.type).cat; if (c[cat] !== undefined) c[cat]++; });
    return c;
  }, [steps]);

  return (
    <Box sx={{
      width: 264, flexShrink: 0, borderLeft: `1px solid ${T.border}`,
      bgcolor: T.surface, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}`,
                 display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Settings sx={{ fontSize: 14, color: T.orange }} />
          <Typography sx={{ fontWeight: 700, fontSize: 11.5, color: T.textSec,
                           textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Pipeline
          </Typography>
          <Box sx={{ px: 0.8, py: 0.1, bgcolor: T.orange, borderRadius: '20px' }}>
            <Typography sx={{ fontSize: 10, color: 'white', fontWeight: 700 }}>{steps.length}</Typography>
          </Box>
        </Stack>
        {activePipelineName && (
          <Chip
            size="small"
            label={`Active: ${activePipelineName}`}
            sx={{ fontSize: 9.5, bgcolor: T.doneBg, color: '#166534', fontWeight: 700 }}
          />
        )}
        {steps.length > 0 && (
          <Button size="small" onClick={onClear}
            sx={{ fontSize: 10, textTransform: 'none', color: T.danger, p: 0.25, minWidth: 0 }}>
            Clear all
          </Button>
        )}
      </Box>

      {/* Category summary chips */}
      {steps.length > 0 && (
        <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}`,
                   display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {[['clean','Clean',T.bgClean],['encode','Encode',T.bgEncode],
            ['scale','Scale',T.bgScale],['feat','Feat Eng',T.bgFeat],
            ['select','Selection',T.dangerBg]
          ].filter(([k]) => counts[k] > 0).map(([k, label, bg]) => (
            <Chip key={k} label={`${label}: ${counts[k]}`} size="small"
              sx={{ fontSize: 9, height: 18, bgcolor: bg, fontWeight: 600 }} />
          ))}
        </Box>
      )}

      {/* Step list */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.25 }}>
        {steps.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Settings sx={{ fontSize: 30, color: '#e2e8f0', mb: 1 }} />
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
              No steps yet.<br />Add from tabs on the left.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={0.6}>
            {steps.map((s, i) => (
              <StepChip key={i} step={s} idx={i} total={steps.length}
                onRemove={onRemove} onMove={onMove} />
            ))}
          </Stack>
        )}
      </Box>

      {/* Save / Load */}
      <Box sx={{ borderTop: `1px solid ${T.border}`, p: 1.5 }}>
        <SLabel>Save pipeline</SLabel>
        <Stack direction="row" spacing={0.75} sx={{ mb: 1 }}>
          <TextField size="small" placeholder="Pipeline name…" value={saveName}
            onChange={e => setSaveName(e.target.value)}
            sx={{ flex: 1, '& input': { fontSize: 12 } }} />
          <Tooltip title={saveOk ? 'Saved!' : 'Save pipeline'}>
            <span>
              <IconButton size="small" onClick={save}
                disabled={canDisable(!saveName.trim() || !steps.length)}
                sx={{
                  bgcolor: saveOk ? T.doneBg : T.orangeLight,
                  color:   saveOk ? T.done   : T.orange,
                  border:  `1px solid ${saveOk ? T.doneBorder : '#fdd8c4'}`,
                  borderRadius: '8px', transition: 'all 0.2s',
                }}>
                {saveOk ? <CheckCircle sx={{ fontSize: 16 }} /> : <Save sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Button fullWidth size="small" variant="outlined"
          startIcon={<FolderOpen sx={{ fontSize: 14 }} />} onClick={fetchPipelines}
          sx={{ textTransform: 'none', fontSize: 11, borderColor: T.border, color: T.textSec,
                '&:hover': { borderColor: T.orange, color: T.orange } }}>
          Load saved pipeline
        </Button>

        {loadErr && <Alert severity="error" sx={{ mt: 1, py: 0.4, fontSize: 10 }}>{loadErr}</Alert>}
        {loadOpen && (
          <Box sx={{ mt: 1 }}>
            {pipelines.length === 0
              ? <Alert severity="info" sx={{ py: 0.4, fontSize: 10 }}>No saved pipelines yet</Alert>
              : pipelines.map(p => (
                <Box key={p.pipeline_id}
                  onClick={() => { handleLoadPipeline(p.pipeline_id); }}
                  sx={{ px: 1.25, py: 0.75, mb: 0.5, bgcolor: 'white', borderRadius: 1.5,
                         border: `1px solid ${T.border}`, cursor: 'pointer',
                         '&:hover': { borderColor: T.orange } }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {p.steps?.length || 0} steps · {new Date(p.updated_at).toLocaleDateString()}
                  </Typography>
                </Box>
              ))
            }
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP FORM
// ═══════════════════════════════════════════════════════════════════════════════
const StepForm = ({
  availableCols = [],
  colTypes = {},
  onAdd,
  targetColumn = '',
  initialCat = 'clean',
  columnCatalog = [],
  onFocusColumn,
}) => {
  const [cat, setCat] = useState(initialCat);
  const [type, setType] = useState(() => {
    if (initialCat === 'scale') return 'scaling_standard';
    if (initialCat === 'feat') return 'feature_ratio';
    return 'imputation';
  });
  const [cols, setCols] = useState([]);
  const [cfg, setCfg] = useState({
    strategy: 'median', constVal: 'unknown',
    degree: '2', pairsRaw: '',
    groupBy: '', groupTarget: '', agg: 'mean',
    ordinalOrder: 'low,medium,high',
  });

  const typesForCat = cat === 'scale' ? SCALE_TYPES : cat === 'feat' ? FEAT_ENG_TYPES : CLEAN_ENCODE_TYPES;
  const numCols = availableCols.filter((c) => isNumDtype(colTypes[c] || ''));
  const set = (key) => (value) => setCfg((prev) => ({ ...prev, [key]: value }));
  const needsCols = !['drop_duplicates', 'feature_ratio', 'feature_interaction', 'feature_aggregation'].includes(type);
  const pairs = useMemo(() => parseBuilderPairs(cfg.pairsRaw), [cfg.pairsRaw]);
  const colsOk = !needsCols || cols.length > 0;
  const pairsOk = pairs.length > 0;
  const aggOk = cfg.groupBy && cfg.groupTarget;
  const validation = useMemo(
    () => validateBuilderStep({ type, cols, cfg, targetColumn }),
    [cfg, cols, targetColumn, type],
  );
  const canAdd = (() => {
    if (validation.errors.length > 0) return false;
    if (['feature_ratio', 'feature_interaction'].includes(type)) return pairsOk;
    if (type === 'feature_aggregation') return aggOk;
    return colsOk;
  })();

  const columnMap = useMemo(() => {
    const map = new Map();
    (columnCatalog || []).forEach((item) => map.set(item.name, item));
    return map;
  }, [columnCatalog]);

  const selectedColumnCards = useMemo(
    () => cols.map((name) => columnMap.get(name)).filter(Boolean),
    [cols, columnMap],
  );
  const guide = BUILDER_OPERATION_GUIDES[type] || {
    title: stepMeta(type).label,
    what: 'Apply a deterministic preprocessing or feature-building rule.',
    when: 'Use when this logic improves downstream model readiness.',
    output: 'Creates or updates model-ready fields.',
  };
  const flow = useMemo(
    () => describeBuilderOutput({ type, cols, cfg }),
    [cfg, cols, type],
  );

  const buildPayload = () => {
    const base = { type, columns: cols };
    switch (type) {
      case 'imputation':
        return {
          ...base,
          strategy: cfg.strategy,
          value: cfg.strategy === 'constant' ? cfg.constVal : null,
          k: cfg.strategy === 'knn' ? 5 : undefined,
          iterations: cfg.strategy === 'mice' ? 3 : undefined,
        };
      case 'feature_polynomial':
        return { ...base, degree: parseInt(cfg.degree, 10) || 2 };
      case 'feature_ratio':
      case 'feature_interaction':
        return { ...base, columns: [], pairs };
      case 'feature_aggregation':
        return { type, columns: [], group_by: cfg.groupBy, target: cfg.groupTarget, agg: cfg.agg };
      case 'encoding_ordinal':
        return { ...base, order: cfg.ordinalOrder.split(',').map((item) => item.trim()).filter(Boolean) };
      default:
        return base;
    }
  };

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(buildPayload());
    setCols([]);
    if (type === 'feature_ratio' || type === 'feature_interaction') setCfg((prev) => ({ ...prev, pairsRaw: '' }));
  };

  const focusColumn = (name) => {
    if (name && typeof onFocusColumn === 'function') onFocusColumn(name);
  };

  const CAT_TABS = [
    { id: 'clean', Icon: Build, label: 'Clean & Encode' },
    { id: 'scale', Icon: LinearScale, label: 'Scaling' },
    { id: 'feat', Icon: TrendingUp, label: 'Feature Engineering' },
  ];

  return (
    <Card sx={{ bgcolor: 'white' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} sx={{ mb: 1.5 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18, color: T.textPri }}>Build a transformation</Typography>
          <Typography sx={{ fontSize: 12, color: T.textSec, mt: 0.4, maxWidth: 780, lineHeight: 1.7 }}>
            Create derived fields, encodings, aggregations, scaling rules, and reusable preprocessing logic before model training.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
          <Chip label={`Operation: ${guide.title}`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.accentBorder}`, color: T.orange, borderRadius: 0 }} />
          {targetColumn && (
            <Chip label={`Target in scope: ${targetColumn}`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.infoBorder}`, color: T.textPri, borderRadius: 0 }} />
          )}
          <OBtn icon={<Add sx={{ fontSize: 14 }} />} onClick={handleAdd} disabled={!canAdd}>
            Add to pipeline
          </OBtn>
        </Stack>
      </Stack>

      <Alert severity="info" icon={<InfoOutlined />} sx={{ mb: 1.5, borderRadius: 0, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
        <Typography sx={{ fontSize: 12, color: T.textPri, lineHeight: 1.65 }}>
          This builder is rule-based and statistical. It does not use predictive modelling or generative AI unless that is explicitly enabled somewhere else in the workflow.
        </Typography>
      </Alert>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '220px minmax(0, 1fr)' }, gap: 1.75, mb: 1.6 }}>
        <Box>
          <SLabel>Transformation family</SLabel>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {CAT_TABS.map((item) => {
              const CatIcon = item.Icon;
              const isActive = cat === item.id;
              return (
                <Button
                  key={item.id}
                  size="small"
                  variant={isActive ? 'contained' : 'outlined'}
                  startIcon={<CatIcon sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    setCat(item.id);
                    setType(item.id === 'scale' ? 'scaling_standard' : item.id === 'feat' ? 'feature_ratio' : 'imputation');
                    setCols([]);
                  }}
                  sx={{
                    textTransform: 'none',
                    fontSize: 12,
                    px: 1.5,
                    py: 0.6,
                    borderRadius: 0,
                    boxShadow: 'none',
                    ...(isActive
                      ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHov } }
                      : { borderColor: T.border, color: T.textSec, bgcolor: 'white', '&:hover': { borderColor: T.orange, color: T.orange, bgcolor: 'white' } }),
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '240px minmax(0, 1fr)' }, gap: 1.25 }}>
          <Box>
            <SLabel>Transformation type</SLabel>
            <Select
              size="small"
              fullWidth
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setCols([]);
              }}
              sx={{ fontSize: 12.5, bgcolor: 'white' }}
            >
              {typesForCat.map((item) => {
                const meta = stepMeta(item);
                const MetaIcon = meta.Icon;
                return (
                  <MenuItem key={item} value={item}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <MetaIcon sx={{ fontSize: 16, color: T.textSec, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{meta.label}</Typography>
                    </Stack>
                  </MenuItem>
                );
              })}
            </Select>
          </Box>
          <Box sx={{ p: 1.1, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.textPri }}>{guide.title}</Typography>
            <Typography sx={{ fontSize: 11.25, color: T.textSec, mt: 0.5, lineHeight: 1.6 }}>
              {guide.what}
            </Typography>
            <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.55 }}>
              <strong>When to use:</strong> {guide.when}
            </Typography>
            <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.35 }}>
              <strong>Output:</strong> {guide.output}
            </Typography>
          </Box>
        </Box>
      </Box>

      {needsCols && (
        <Box sx={{ mb: 1.6 }}>
          <SLabel>Columns in scope</SLabel>
          <Select
            size="small"
            fullWidth
            multiple
            value={cols}
            onChange={(e) => setCols(e.target.value)}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((value) => {
                  const meta = columnMap.get(value);
                  return (
                    <Chip
                      key={value}
                      label={clip(value, 18)}
                      size="small"
                      onClick={(evt) => {
                        evt.stopPropagation();
                        focusColumn(value);
                      }}
                      sx={{ fontFamily: 'monospace', fontSize: 9, height: 20, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }}
                    />
                  );
                })}
              </Box>
            )}
            sx={{ fontSize: 12, bgcolor: 'white' }}
          >
            {(columnCatalog.length ? columnCatalog : availableCols.map((name) => ({ name, tableLabel: humanizeTableName('master_dataset'), semanticType: inferBuilderSemanticType(name, colTypes?.[name] || '') }))).map((item) => (
              <MenuItem key={item.name} value={item.name}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.name}</Typography>
                    <Typography sx={{ fontSize: 10, color: T.textSec }}>{item.tableLabel}</Typography>
                  </Box>
                  <Chip label={item.semanticType} size="small" sx={{ height: 16, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                </Stack>
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}

      <Box sx={{ mb: 1.6 }}>
        {type === 'imputation' && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel sx={{ fontSize: 12 }}>Strategy</InputLabel>
              <Select label="Strategy" value={cfg.strategy} onChange={(e) => set('strategy')(e.target.value)} sx={{ fontSize: 12, bgcolor: 'white' }}>
                {IMPUTATION_STRATS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
            {cfg.strategy === 'constant' && (
              <TextField size="small" label="Fill value" value={cfg.constVal} onChange={(e) => set('constVal')(e.target.value)} sx={{ width: 140 }} />
            )}
            {['knn', 'mice'].includes(cfg.strategy) && (
              <Alert severity="info" sx={{ py: 0.4, fontSize: 10.5, flex: 1, alignSelf: 'center', borderRadius: 0 }}>
                {cfg.strategy === 'knn' ? 'Uses a nearest-neighbour approximation on sampled rows.' : 'Uses iterative chained estimation for missing values.'}
              </Alert>
            )}
          </Stack>
        )}

        {type === 'feature_polynomial' && (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <TextField
              size="small"
              label="Degree"
              type="number"
              value={cfg.degree}
              onChange={(e) => set('degree')(e.target.value)}
              sx={{ width: 110 }}
              inputProps={{ min: 2, max: 5 }}
            />
            <Typography variant="caption" color="text.secondary">
              Creates additional power-based terms such as <code>{cols[0] || 'column'}_pow2</code>.
            </Typography>
          </Stack>
        )}

        {['feature_ratio', 'feature_interaction'].includes(type) && (
          <Box>
            <SLabel>Column pairs (A:B)</SLabel>
            <TextField
              size="small"
              fullWidth
              value={cfg.pairsRaw}
              onChange={(e) => set('pairsRaw')(e.target.value)}
              placeholder="cash_txn_count:txn_count, txn_amount:avg_balance"
              sx={{ '& input': { fontFamily: 'monospace', fontSize: 12 } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mt: 0.5, display: 'block' }}>
              Enter reusable business pairs. Click any selected column chip above to inspect it in the explorer.
            </Typography>
          </Box>
        )}

        {type === 'feature_aggregation' && (
          <Stack direction="row" spacing={1.25} flexWrap="wrap" gap={1} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel sx={{ fontSize: 12 }}>Grouping column</InputLabel>
              <Select label="Grouping column" value={cfg.groupBy} onChange={(e) => set('groupBy')(e.target.value)} sx={{ fontSize: 12, bgcolor: 'white' }}>
                {availableCols.map((column) => <MenuItem key={column} value={column}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{column}</span></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel sx={{ fontSize: 12 }}>Value to summarise</InputLabel>
              <Select label="Value to summarise" value={cfg.groupTarget} onChange={(e) => set('groupTarget')(e.target.value)} sx={{ fontSize: 12, bgcolor: 'white' }}>
                {numCols.map((column) => <MenuItem key={column} value={column}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{column}</span></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel sx={{ fontSize: 12 }}>Statistic</InputLabel>
              <Select label="Statistic" value={cfg.agg} onChange={(e) => set('agg')(e.target.value)} sx={{ fontSize: 12, bgcolor: 'white' }}>
                {AGG_OPS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
              </Select>
            </FormControl>
            <Box sx={{ px: 1.1, py: 0.9, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
              <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Grouping context
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.35 }}>
                {cfg.groupTarget && cfg.groupBy ? `${cfg.agg} of ${cfg.groupTarget} inside each ${cfg.groupBy} group` : 'Pick a grouping column and a numeric value to summarise.'}
              </Typography>
            </Box>
          </Stack>
        )}

        {type === 'encoding_ordinal' && (
          <TextField
            size="small"
            fullWidth
            label="Category order, from low to high"
            value={cfg.ordinalOrder}
            onChange={(e) => set('ordinalOrder')(e.target.value)}
            placeholder="low,medium,high"
          />
        )}
      </Box>

      {validation.errors.map((message) => (
        <Alert key={message} severity="error" sx={{ mb: 1, borderRadius: 0 }}>
          {message}
        </Alert>
      ))}
      {validation.warnings.map((message) => (
        <Alert key={message} severity="warning" sx={{ mb: 1, borderRadius: 0 }}>
          {message}
        </Alert>
      ))}

      <Box sx={{ p: 1.2, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
        <SLabel sx={{ mb: 1 }}>Input → transformation → output</SLabel>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr auto 1fr auto 1fr' }, gap: 1, alignItems: 'stretch' }}>
          <Box sx={{ p: 1, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
            <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.35 }}>Input</Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.35 }}>{flow.input}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textSec }}>→</Box>
          <Box sx={{ p: 1, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
            <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.35 }}>Transformation</Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.35 }}>{flow.transform}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textSec }}>→</Box>
          <Box sx={{ p: 1, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
            <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.35 }}>Output</Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.35, fontFamily: 'monospace' }}>{flow.output}</Typography>
          </Box>
        </Box>
      </Box>

      {!canAdd && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, fontSize: 10.5 }}>
          {validation.errors.length > 0
            ? 'Resolve the blocking issue above before adding this step.'
            : ['feature_ratio', 'feature_interaction'].includes(type)
            ? 'Enter at least one A:B pair to create a feature.'
            : type === 'feature_aggregation'
            ? 'Set the grouping column and numeric value before adding the aggregation.'
            : 'Select at least one column to continue.'}
        </Typography>
      )}

      {selectedColumnCards.length > 0 && (
        <Box sx={{ mt: 1.2 }}>
          <SLabel>Selected column context</SLabel>
          <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', rowGap: 0.6 }}>
            {selectedColumnCards.map((item) => (
              <Chip
                key={`selected_${item.name}`}
                label={`${item.name} • ${item.tableLabel}`}
                size="small"
                onClick={() => focusColumn(item.name)}
                sx={{ height: 20, fontSize: 9, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 - PLAN
// ═══════════════════════════════════════════════════════════════════════════════
const PlanTab = ({ masterDataset, suggestions, steps, onStepsChange }) => {
  const [local,   setLocal]   = useState(normalizePreprocessSuggestions(suggestions || []));
  const [loading, setLoading] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanStats, setScanStats] = useState({ rows: null, columns: null });
  const [applied, setApplied] = useState(new Set());

  const rescan = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setLoading(true);
    setScanError('');
    try {
      const res = await mlopsApi.preprocessPlan({ dataset_id: masterDataset.dataset_id, sample_rows: 1500 });
      const payload = unwrapApiPayload(res) || {};
      setLocal(normalizePreprocessSuggestions(payload.suggestions || []));
      setScanStats({
        rows: payload.rows_analyzed ?? payload.row_count ?? null,
        columns: payload.columns_analyzed ?? payload.column_count ?? null,
      });
      setApplied(new Set());
      setScanComplete(true);
    } catch (e) {
      console.error(e);
      setScanError(e?.message || 'Backend scan failed.');
      setScanComplete(false);
    }
    finally { setLoading(false); }
  }, [masterDataset?.dataset_id]);

  useEffect(() => {
    const normalized = normalizePreprocessSuggestions(suggestions || []);
    setLocal(normalized);
    if (normalized.length > 0) setScanComplete(true);
  }, [suggestions]);

  useEffect(() => {
    setScanComplete(false);
    setScanError('');
    setScanStats({ rows: null, columns: null });
    setApplied(new Set());
    if (masterDataset?.dataset_id) {
      rescan();
    }
  }, [masterDataset?.dataset_id, rescan]);

  const applyOne = (s, idx) => {
    onStepsChange([...steps, s]);
    setApplied(p => new Set([...p, idx]));
  };

  const applyAll = () => {
    const unapplied = local.filter((_, i) => !applied.has(i));
    if (!unapplied.length) return;
    onStepsChange([...steps, ...unapplied]);
    setApplied(new Set(local.map((_, i) => i)));
  };

  const availableCols = masterDataset?.columns || [];
  const rowCount = Number(scanStats.rows ?? masterDataset?.row_count ?? 0);
  const scannedColumnCount = Number(scanStats.columns ?? availableCols.length);
  const hasDataset = Boolean(masterDataset?.dataset_id);
  const hasScanMetadata = hasDataset && (rowCount > 0 || scannedColumnCount > 0);
  const showScanWaiting = !loading && local.length === 0 && (!scanComplete || !hasScanMetadata);
  const scanSubtitle = loading
    ? `Backend scan running on ${hasScanMetadata ? `${fmt(rowCount)} rows and ${fmt(scannedColumnCount)} columns` : 'the selected master dataset'}...`
    : scanComplete && hasScanMetadata
      ? `Scanned ${fmt(rowCount)} rows - ${fmt(scannedColumnCount)} columns for nulls, dtypes, cardinality`
      : hasDataset
        ? 'Backend scan is preparing dataset metadata. Results will appear here after rows and columns are available.'
        : 'Waiting for a master dataset before scanning quality issues.';
  const pendingCount = local.filter((_, i) => !applied.has(i)).length;

  return (
    <Stack spacing={2.5}>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.2 }}>Auto-Detected Issues</Typography>
            <Typography variant="caption" color="text.secondary">
              {scanSubtitle}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75}>
            <OBtn variant="outlined" icon={<Refresh sx={{ fontSize: 13 }} />} onClick={rescan} disabled={canDisable(loading)}>
              Rescan
            </OBtn>
            {pendingCount > 0 && (
              <OBtn icon={<AutoFixHigh sx={{ fontSize: 13 }} />} onClick={applyAll}>
                Apply all ({pendingCount})
              </OBtn>
            )}
          </Stack>
        </Stack>

        {loading && <Spinner label="Scanning dataset…" />}

        {scanError && (
          <Alert severity="error" icon={<Warning />} sx={{ borderRadius: 2, mb: 1 }}>
            {scanError}
          </Alert>
        )}

        {showScanWaiting && (
          <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ borderRadius: 2 }}>
            Backend scan is still loading. Waiting for valid row and column metadata before showing issue results.
          </Alert>
        )}

        {!loading && !showScanWaiting && scanComplete && local.length === 0 && (
          <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 2 }}>
            <strong>No issues detected.</strong> Dataset looks clean. Use the Builder tab if you still want to add custom cleaning, encoding, scaling, or feature-engineering steps.
          </Alert>
        )}

        {!loading && local.length > 0 && (
          <Stack spacing={0.75}>
            {local.map((s, i) => {
              const m    = stepMeta(s.type);
              const MIcon = m.Icon;
              const done = applied.has(i);
              return (
                <Box key={i} sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  p: 1.5, borderRadius: 1.5, transition: 'all 0.15s',
                  bgcolor: done ? T.doneBg : 'white',
                  border: `1px solid ${done ? T.doneBorder : T.border}`,
                }}>
                  <MIcon sx={{ fontSize: 18, color: done ? T.done : T.textSec, flexShrink: 0 }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 12.5 }}>{m.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                      {s.explanation}
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.8, rowGap: 0.5 }}>
                      <Chip
                        label={`${s.column_count || s.columns?.length || 0} column${(s.column_count || s.columns?.length || 0) === 1 ? '' : 's'}`}
                        size="small"
                        sx={{ height: 18, fontSize: 9, bgcolor: T.surface, border: `1px solid ${T.border}` }}
                      />
                      {s.strategy && (
                        <Chip
                          label={`strategy: ${s.strategy}`}
                          size="small"
                          sx={{ height: 18, fontSize: 9, bgcolor: T.infoBg, color: '#1d4ed8' }}
                        />
                      )}
                      {s.mapping_only && (
                        <Chip
                          label="mapping only"
                          size="small"
                          sx={{ height: 18, fontSize: 9, bgcolor: T.warnBg, color: '#b45309' }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.4} flexWrap="wrap" sx={{ mt: 0.8, rowGap: 0.4 }}>
                      {(s.column_preview || s.columns || []).slice(0, 6).map((col) => (
                        <Chip
                          key={`${i}-${col}`}
                          label={clip(col, 18)}
                          size="small"
                          sx={{ height: 18, fontSize: 9, fontFamily: 'monospace', bgcolor: 'white', border: `1px solid ${T.border}` }}
                        />
                      ))}
                      {(s.columns?.length || 0) > 6 && (
                        <Chip
                          label={`+${s.columns.length - 6} more`}
                          size="small"
                          sx={{ height: 18, fontSize: 9, bgcolor: T.surface }}
                        />
                      )}
                    </Stack>
                  </Box>
                  <Chip label={s.type.replace(/_/g, ' ')} size="small"
                    sx={{ fontFamily: 'monospace', fontSize: 9, bgcolor: m.bg, flexShrink: 0 }} />
                  {done
                    ? <CheckCircle sx={{ fontSize: 18, color: T.done, flexShrink: 0 }} />
                    : <OBtn onClick={() => applyOne(s, i)}>Apply</OBtn>}
                </Box>
              );
            })}
          </Stack>
        )}
      </Card>

      <Alert severity="info" icon={<Build />} sx={{ borderRadius: 2, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
        <Typography fontWeight={700} sx={{ fontSize: 13, mb: 0.25 }}>Grouped planning is enabled</Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Repetitive single-column actions are now collapsed into shared steps. Review the recommended groups here, then move to the Builder tab for custom workbench-style step design{scannedColumnCount ? ` across ${fmt(scannedColumnCount)} available columns.` : ' after column metadata is available.'}
        </Typography>
      </Alert>
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
const BuilderTab = ({ masterDataset, datasets = [], steps, onStepsChange, targetColumn }) => {
  const availableCols = masterDataset?.columns || [];
  const colTypes = masterDataset?.column_types || {};
  const [activeCol, setActiveCol] = useState('');
  const [statsMap, setStatsMap] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [tableFilter, setTableFilter] = useState('all');
  const [detailOpen, setDetailOpen] = useState(false);

  const loadStats = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setStatsLoading(true);
    setStatsErr('');
    try {
      const res = await mlopsApi.variableStats({ dataset_id: masterDataset.dataset_id, sample_rows: 8000 });
      const payload = unwrapApiPayload(res) || {};
      setStatsMap(payload.columns || {});
    } catch (e) {
      console.error(e);
      setStatsErr('Unable to load column metadata for the builder.');
    } finally {
      setStatsLoading(false);
    }
  }, [masterDataset?.dataset_id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const loadPreview = useCallback(async () => {
    if (!masterDataset?.dataset_id || !activeCol) {
      setPreviewRows([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await mlopsApi.datasetRows(masterDataset.dataset_id, { sample_rows: 8, columns: activeCol });
      const payload = unwrapApiPayload(res) || {};
      setPreviewRows(Array.isArray(payload.preview) ? payload.preview : (Array.isArray(payload.rows) ? payload.rows : []));
    } catch (e) {
      console.error(e);
      setPreviewRows([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [activeCol, masterDataset?.dataset_id]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const columnCatalog = useMemo(
    () => buildColumnCatalog({
      availableCols,
      colTypes,
      datasets,
      masterDataset,
      targetColumn,
      statsMap,
    }),
    [availableCols, colTypes, datasets, masterDataset, statsMap, targetColumn],
  );

  const tableOptions = useMemo(() => {
    const options = Array.from(new Set(columnCatalog.map((item) => item.table))).filter(Boolean);
    return options.sort((a, b) => a.localeCompare(b));
  }, [columnCatalog]);

  const filteredColumns = useMemo(() => {
    const search = String(searchText || '').trim().toLowerCase();
    return columnCatalog.filter((item) => {
      const matchesTable = tableFilter === 'all' || item.table === tableFilter;
      const matchesSearch = !search
        || item.name.toLowerCase().includes(search)
        || item.tableLabel.toLowerCase().includes(search)
        || item.semanticType.toLowerCase().includes(search);
      return matchesTable && matchesSearch;
    });
  }, [columnCatalog, searchText, tableFilter]);

  useEffect(() => {
    if (filteredColumns.length === 0) {
      setActiveCol('');
      return;
    }
    if (!activeCol || !filteredColumns.some((item) => item.name === activeCol)) {
      setActiveCol(filteredColumns[0].name);
    }
  }, [activeCol, filteredColumns]);

  const groupedColumns = useMemo(() => {
    const groups = new Map();
    filteredColumns.forEach((item) => {
      const key = item.tableLabel || 'Other';
      const bucket = groups.get(key) || [];
      bucket.push(item);
      groups.set(key, bucket);
    });
    return Array.from(groups.entries());
  }, [filteredColumns]);

  const activeMeta = useMemo(
    () => columnCatalog.find((item) => item.name === activeCol) || null,
    [activeCol, columnCatalog],
  );
  const activeStats = activeMeta ? statsMap?.[activeMeta.name] || null : null;
  const topCategories = Array.isArray(activeStats?.top_categories) ? activeStats.top_categories.slice(0, 6) : [];
  const isNumericColumn = activeMeta
    ? isNumDtype(activeMeta.dtype || '') || Number(activeStats?.numeric_parse_ratio || 0) >= 0.85
    : false;

  return (
    <Stack spacing={2.5}>
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 18, color: T.textPri }}>Feature Engineering and Custom Builder</Typography>
            <Typography sx={{ fontSize: 12, color: T.textSec, mt: 0.45, maxWidth: 860, lineHeight: 1.7 }}>
              Build derived fields, aggregations, encodings, scaling rules, and reusable preprocessing steps before modelling. Every new field stays traceable to the source columns and table context you used to create it.
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
            <Chip label={`Active dataset: ${humanizeTableName(masterDataset?.dataset_type || 'master_dataset')}`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
            <Chip label={`${availableCols.length} columns in scope`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
            {targetColumn && (
              <Chip label={`Target linked: ${targetColumn}`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.infoBorder}`, borderRadius: 0 }} />
            )}
          </Stack>
        </Stack>
        <Alert severity="info" icon={<Code />} sx={{ mt: 1.25, borderRadius: 0, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
          This screen is rule-based and statistics-assisted. It does not use a predictive model or generative AI to create features unless a separate optional mode explicitly says so.
        </Alert>
      </Card>

      <Card sx={{ p: 1.5 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.2} justifyContent="space-between">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flexWrap: 'wrap', flex: 1 }}>
            <TextField
              size="small"
              label="Search columns or tables"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              sx={{ minWidth: 220 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Filter by table</InputLabel>
              <Select label="Filter by table" value={tableFilter} onChange={(e) => setTableFilter(String(e.target.value))}>
                <MenuItem value="all">All source tables</MenuItem>
                {tableOptions.map((table) => (
                  <MenuItem key={table} value={table}>{humanizeTableName(table)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <OBtn variant="outlined" icon={<Refresh sx={{ fontSize: 13 }} />} onClick={loadStats} disabled={statsLoading}>
              Refresh metadata
            </OBtn>
            <OBtn variant="outlined" icon={<InfoOutlined sx={{ fontSize: 13 }} />} onClick={() => setDetailOpen(true)} disabled={!activeMeta}>
              Open column details
            </OBtn>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            <Chip label={`${filteredColumns.length} visible`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
            <Chip label={`${tableOptions.length} table groups`} size="small" sx={{ bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
          </Stack>
        </Stack>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.05fr 0.95fr' }, gap: 2 }}>
        <StepForm
          availableCols={availableCols}
          colTypes={colTypes}
          onAdd={(step) => onStepsChange([...steps, step])}
          targetColumn={targetColumn}
          initialCat="clean"
          columnCatalog={columnCatalog}
          onFocusColumn={setActiveCol}
        />

        <Stack spacing={2}>
          <Card>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.1 }}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Column Explorer</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  Browse the current master dataset, grouped by source table and annotated with lineage, quality, and business meaning.
                </Typography>
              </Box>
              {activeMeta && (
                <Chip label={`${activeMeta.name}`} size="small" sx={{ fontSize: 9, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
              )}
            </Stack>

            {statsLoading && <Spinner label="Loading column metadata..." />}
            {!statsLoading && statsErr && <Alert severity="error" sx={{ borderRadius: 0 }}>{statsErr}</Alert>}
            {!statsLoading && !statsErr && filteredColumns.length === 0 && (
              <Alert severity="info" sx={{ borderRadius: 0 }}>No columns match the current search and table filter.</Alert>
            )}

            {!statsLoading && !statsErr && filteredColumns.length > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) minmax(360px, 1fr)' }, gap: 1.25 }}>
                <Box sx={{ maxHeight: 520, overflowY: 'auto', border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                  {groupedColumns.map(([groupLabel, items]) => (
                    <Box key={groupLabel} sx={{ borderBottom: `1px solid ${T.border}` }}>
                      <Box sx={{ px: 1.1, py: 0.75, bgcolor: T.surface, borderBottom: `1px solid ${T.border}` }}>
                        <Typography sx={{ fontSize: 10.5, color: T.textSec, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.45 }}>
                          {groupLabel} ({items.length})
                        </Typography>
                      </Box>
                      {items.map((item) => (
                        <Box
                          key={`builder_col_${item.name}`}
                          onClick={() => setActiveCol(item.name)}
                          onDoubleClick={() => {
                            setActiveCol(item.name);
                            setDetailOpen(true);
                          }}
                          sx={{
                            px: 1.1,
                            py: 1,
                            cursor: 'pointer',
                            borderBottom: `1px solid ${T.border}`,
                            bgcolor: activeCol === item.name ? T.surface : 'white',
                            '&:hover': { bgcolor: T.surface },
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontFamily: 'monospace', fontSize: 12.25, fontWeight: 700, color: T.textPri }}>
                                {item.name}
                              </Typography>
                              <Typography sx={{ fontSize: 10.5, color: T.textSec, mt: 0.2 }}>
                                {item.tableLabel} • {item.dtype} • {item.semanticType}
                              </Typography>
                              <Typography sx={{ fontSize: 10.5, color: T.textSec, mt: 0.35, lineHeight: 1.5 }}>
                                {item.businessMeaning}
                              </Typography>
                            </Box>
                            <Stack spacing={0.35} alignItems="flex-end" sx={{ flexShrink: 0 }}>
                              <Typography sx={{ fontSize: 10, color: T.textSec }}>missing {pct(item.missingPct, 1)}</Typography>
                              <Typography sx={{ fontSize: 10, color: T.textSec }}>distinct {fmt(item.distinctCount)}</Typography>
                            </Stack>
                          </Stack>
                          <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap', rowGap: 0.45, mt: 0.8 }}>
                            {item.tags.map((tag) => (
                              <Tooltip key={`${item.name}_${tag}`} title={`Lineage tag: ${tag}`}>
                                <Chip label={tag} size="small" sx={{ height: 18, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                              </Tooltip>
                            ))}
                          </Stack>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>

                {!activeMeta ? (
                  <Alert severity="info" sx={{ borderRadius: 0 }}>Select a column to inspect its lineage, quality, and sample values.</Alert>
                ) : (
                  <Box sx={{ border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                    <Box sx={{ px: 1.2, py: 1, borderBottom: `1px solid ${T.border}`, bgcolor: T.surface }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 700, color: T.textPri }}>{activeMeta.name}</Typography>
                      <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.25 }}>
                        {activeMeta.tableLabel} • {activeMeta.dtype} • {activeMeta.semanticType}
                      </Typography>
                    </Box>
                    <Box sx={{ p: 1.2 }}>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1 }}>
                        {activeMeta.tags.map((tag) => (
                          <Tooltip key={`active_${tag}`} title={`Origin or control tag: ${tag}`}>
                            <Chip label={tag} size="small" sx={{ height: 18, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                          </Tooltip>
                        ))}
                      </Stack>

                      <Typography sx={{ fontSize: 11.5, color: T.textPri, lineHeight: 1.6 }}>
                        {activeMeta.businessMeaning}
                      </Typography>

                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.8, mt: 1.2 }}>
                        {[
                          ['Source table', activeMeta.tables.map(humanizeTableName).join(', ')],
                          ['Missing', pct(activeMeta.missingPct, 1)],
                          ['Distinct values', fmt(activeMeta.distinctCount)],
                          ['Business type', activeMeta.semanticType],
                        ].map(([label, value]) => (
                          <Box key={label} sx={{ p: 0.9, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
                            <Typography variant="caption" sx={{ fontSize: 10, color: T.textSec }}>{label}</Typography>
                            <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.25 }}>{value}</Typography>
                          </Box>
                        ))}
                      </Box>

                      <Divider sx={{ my: 1.2 }} />

                      <SLabel>Sample values</SLabel>
                      {previewLoading ? (
                        <Spinner label="Loading sample values..." />
                      ) : previewRows.length === 0 ? (
                        <Alert severity="info" sx={{ borderRadius: 0 }}>No sample rows are available for this column.</Alert>
                      ) : (
                        <Box sx={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ background: '#f8fafc' }}>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: T.textSec, borderBottom: `1px solid ${T.border}` }}>Row</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: T.textSec, borderBottom: `1px solid ${T.border}` }}>{activeMeta.name}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row, idx) => (
                                <tr key={`${activeMeta.name}_${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: T.textSec }}>{idx + 1}</td>
                                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{String(row?.[activeMeta.name] ?? '-')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </Box>
                      )}

                      {isNumericColumn && activeStats ? (
                        <>
                          <Divider sx={{ my: 1.2 }} />
                          <SLabel>Numeric profile</SLabel>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.8 }}>
                            {[
                              ['Min', fmtF(activeStats.min)],
                              ['Max', fmtF(activeStats.max)],
                              ['Mean', fmtF(activeStats.mean)],
                              ['Skewness', fmtF(activeStats.skewness)],
                              ['Variance', fmtF(activeStats.variance, 5)],
                              ['Dispersion', fmtF(activeStats.dispersion_ratio, 4)],
                            ].map(([label, value]) => (
                              <Box key={label} sx={{ p: 0.9, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                                <Typography variant="caption" sx={{ fontSize: 10, color: T.textSec }}>{label}</Typography>
                                <Typography sx={{ fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700 }}>{value}</Typography>
                              </Box>
                            ))}
                          </Box>
                        </>
                      ) : (
                        <>
                          <Divider sx={{ my: 1.2 }} />
                          <SLabel>Top categories</SLabel>
                          {topCategories.length === 0 ? (
                            <Alert severity="info" sx={{ borderRadius: 0 }}>No category profile is available for this column yet.</Alert>
                          ) : (
                            <Stack spacing={0.55}>
                              {topCategories.map((item) => (
                                <Stack key={`${activeMeta.name}_${item.value}`} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 0.8, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
                                  <Typography sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>{clip(item.value, 22)}</Typography>
                                  <Typography variant="caption" sx={{ fontSize: 10.5, color: T.textSec }}>{fmt(item.count)}</Typography>
                                </Stack>
                              ))}
                            </Stack>
                          )}
                        </>
                      )}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
          </Card>
        </Stack>
      </Box>

      <Dialog open={detailOpen && !!activeMeta} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, borderBottom: `1px solid ${T.border}` }}>
          {activeMeta?.name || 'Column details'}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {activeMeta && (
            <Box sx={{ p: 2, display: 'grid', gap: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7 }}>
                {activeMeta.businessMeaning}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                <Box sx={{ p: 1.1, border: `1px solid ${T.border}` }}>
                  <Typography variant="caption" sx={{ color: T.textSec }}>Column origin</Typography>
                  <Typography sx={{ fontSize: 12, color: T.textPri, mt: 0.3 }}>
                    {activeMeta.tables.map(humanizeTableName).join(', ')}
                  </Typography>
                </Box>
                <Box sx={{ p: 1.1, border: `1px solid ${T.border}` }}>
                  <Typography variant="caption" sx={{ color: T.textSec }}>Lineage tags</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.4, flexWrap: 'wrap', rowGap: 0.5 }}>
                    {activeMeta.tags.map((tag) => (
                      <Chip key={`modal_${tag}`} label={tag} size="small" sx={{ height: 18, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                    ))}
                  </Stack>
                </Box>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
                {[
                  ['Data type', activeMeta.dtype],
                  ['Semantic type', activeMeta.semanticType],
                  ['Missing', pct(activeMeta.missingPct, 1)],
                  ['Distinct', fmt(activeMeta.distinctCount)],
                ].map(([label, value]) => (
                  <Box key={`modal_${label}`} sx={{ p: 1, border: `1px solid ${T.border}`, bgcolor: T.surface }}>
                    <Typography variant="caption" sx={{ color: T.textSec }}>{label}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.25 }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ p: 1.1, border: `1px solid ${T.border}` }}>
                <Typography variant="caption" sx={{ color: T.textSec }}>Sample values</Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textPri, mt: 0.35, lineHeight: 1.7 }}>
                  {(activeMeta.sampleValues && activeMeta.sampleValues.length ? activeMeta.sampleValues : ['No sampled values available']).join(', ')}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
};

// TAB 2 - ENGINEER
// ═══════════════════════════════════════════════════════════════════════════════

// AML templates - icon is a MUI component ref, not emoji
const AML_TEMPLATES = [
  {
    label: 'Cash Intensity Ratio',    Icon: ShowChart,
    desc:  'cash_txn_count ÷ txn_count - primary structuring signal',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'cash_txn_count', b: 'txn_count' }] },
    req:   ['cash_txn_count', 'txn_count'],
  },
  {
    label: 'Velocity Ratio',          Icon: TrendingUp,
    desc:  'max_txn_amount ÷ avg_txn_amount - detects sudden transaction spikes',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'max_txn_amount', b: 'avg_txn_amount' }] },
    req:   ['max_txn_amount', 'avg_txn_amount'],
  },
  {
    label: 'Balance-to-TXN Ratio',   Icon: CompareArrows,
    desc:  'CURRENT_BALANCE ÷ avg_txn_amount - unusual balance context',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'CURRENT_BALANCE', b: 'avg_txn_amount' }] },
    req:   ['CURRENT_BALANCE', 'avg_txn_amount'],
  },
  {
    label: 'PEP × Risk Score',        Icon: Warning,
    desc:  'PEP_FLAG × CUSTOMER_RISK_RATING - multiplicative risk signal',
    step:  { type: 'feature_interaction', columns: [], pairs: [{ a: 'PEP_FLAG', b: 'CUSTOMER_RISK_RATING' }] },
    req:   ['PEP_FLAG', 'CUSTOMER_RISK_RATING'],
  },
  {
    label: 'Offshore × Risk',         Icon: Link,
    desc:  'offshore_txn_count × RISK_SCORE - combined offshore-risk signal',
    step:  { type: 'feature_interaction', columns: [], pairs: [{ a: 'offshore_txn_count', b: 'RISK_SCORE' }] },
    req:   ['offshore_txn_count', 'RISK_SCORE'],
  },
  {
    label: 'TXN Amount² (Polynomial)', Icon: Functions,
    desc:  'Captures nonlinear threshold effects in transaction amount',
    step:  { type: 'feature_polynomial', columns: ['TXN_AMOUNT'], degree: 2 },
    req:   ['TXN_AMOUNT'],
  },
  {
    label: 'Mean TXN by Account Type', Icon: QueryStats,
    desc:  'mean(TXN_AMOUNT) grouped by ACCOUNT_TYPE',
    step:  { type: 'feature_aggregation', columns: [], group_by: 'ACCOUNT_TYPE', target: 'TXN_AMOUNT', agg: 'mean' },
    req:   ['ACCOUNT_TYPE', 'TXN_AMOUNT'],
  },
  {
    label: 'Std TXN by Customer Risk', Icon: ScatterPlot,
    desc:  'std(TXN_AMOUNT) grouped by CUSTOMER_RISK_RATING - volatility by risk band',
    step:  { type: 'feature_aggregation', columns: [], group_by: 'CUSTOMER_RISK_RATING', target: 'TXN_AMOUNT', agg: 'std' },
    req:   ['CUSTOMER_RISK_RATING', 'TXN_AMOUNT'],
  },
  {
    label: 'Extract Alert Date Parts', Icon: Today,
    desc:  'Year, month, day-of-week, hour from ALERT_DATE',
    step:  { type: 'datetime_extract', columns: ['ALERT_DATE'] },
    req:   ['ALERT_DATE'],
  },
  {
    label: 'Narrative Text Features', Icon: Code,
    desc:  'Length, word count, has_digit from NARRATIVE column',
    step:  { type: 'text_features', columns: ['NARRATIVE'] },
    req:   ['NARRATIVE'],
  },
  {
    label: 'Frequency Encode Account Type', Icon: Percent,
    desc:  'Replace ACCOUNT_TYPE with its frequency count - cardinality signal',
    step:  { type: 'encoding_frequency', columns: ['ACCOUNT_TYPE'] },
    req:   ['ACCOUNT_TYPE'],
  },
  {
    label: 'Frequency Encode Country', Icon: Percent,
    desc:  'Replace COUNTRY_OF_ORIGIN with frequency count',
    step:  { type: 'encoding_frequency', columns: ['COUNTRY_OF_ORIGIN'] },
    req:   ['COUNTRY_OF_ORIGIN'],
  },
];

const EngineerTab = ({ masterDataset, steps, onStepsChange, targetColumn, onOpenBuilder, pipelineVariant = 'fcc' }) => {
  const isMuleVariant = String(pipelineVariant || 'fcc').trim().toLowerCase() === 'mule';
  const availableCols = masterDataset?.columns || [];
  const availableCount = AML_TEMPLATES.filter(t => t.req.every(c => availableCols.includes(c))).length;
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  return (
    <Stack spacing={2.5}>
      <Card sx={{ bgcolor: '#fff' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 18, color: T.textPri }}>{isMuleVariant ? 'Mule signal engineering' : 'AML feature engineering'}</Typography>
            <Typography sx={{ fontSize: 12, color: T.textSec, mt: 0.45, maxWidth: 820, lineHeight: 1.7 }}>
              {isMuleVariant
                ? 'Create reusable account-risk signals before model training. These features are built from deterministic formulas, aggregations, and encodings so the team can explain exactly how each field is calculated.'
                : 'Create reusable behavioural signals before model training. These features are built from deterministic formulas, aggregations, and encodings so the team can explain exactly how each field is calculated.'}
            </Typography>
          </Box>
          <Chip
            label={targetColumn ? `Target linked: ${targetColumn}` : 'Target optional at this stage'}
            size="small"
            sx={{ alignSelf: 'flex-start', fontSize: 10, bgcolor: T.surface, color: T.textPri }}
          />
        </Stack>
        <Alert severity="info" icon={<MemoryOutlined />} sx={{ mt: 1.25, borderRadius: 2, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
          This stage is not generative AI. It uses deterministic feature rules and preprocessing logic. New columns appear in Preview immediately, and the trained model uses them later only if you keep them.
        </Alert>
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <WorkspacePremium sx={{ fontSize: 18, color: T.orange }} />
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{isMuleVariant ? 'Mule Signal Templates' : 'AML Domain Templates'}</Typography>
              <Tooltip title="Explain how these templates are defined">
                <IconButton size="small" onClick={() => setSelectedTemplate({ label: isMuleVariant ? 'Mule Signal Templates' : 'AML Domain Templates' })} sx={{ color: T.textSec }}>
                  <InfoOutlined sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {isMuleVariant ? 'Pre-built account-risk signals for mule detection' : 'Pre-built features for false-positive suppression'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip
              label={`${availableCount} / ${AML_TEMPLATES.length} available`}
              size="small"
              sx={{ fontSize: 10, bgcolor: T.orangeLight, color: T.orange }}
            />
            <OBtn variant="outlined" size="small" onClick={onOpenBuilder}>
              Build custom feature
            </OBtn>
          </Stack>
        </Stack>

        <Box sx={{ mb: 1.4, p: 1.15, borderRadius: 1.5, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
          <Typography sx={{ fontSize: 11.5, color: T.textSec, lineHeight: 1.7 }}>
            {isMuleVariant
              ? 'Templates are defined from Mule heuristics and simple formulas such as ratios, interactions, aggregations, and date parts. Click the info icon on any template to see what it means, how it is calculated, and why it can help detect mule-like behaviour.'
              : 'Templates are defined from AML heuristics and simple formulas such as ratios, interactions, aggregations, and date parts. Click the info icon on any template to see what it means, how it is calculated, and why it can help reduce false positives.'}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 1.25 }}>
          {AML_TEMPLATES.map((t, i) => {
            const TIcon  = t.Icon;
            const canUse = t.req.every(c => availableCols.includes(c));
            const added  = steps.some(s => JSON.stringify(s) === JSON.stringify(t.step));
            const miss   = t.req.filter(c => !availableCols.includes(c));
            const explainer = AML_TEMPLATE_EXPLAINERS[t.label] || {
              summary: 'Reusable AML feature template.',
              calculation: t.desc,
              why: 'Helps create a model-ready behavioural signal from the current dataset.',
            };
            return (
              <Box key={i} sx={{
                p: 1.5, borderRadius: 1.5, transition: 'all 0.12s',
                border: `1px solid ${added ? T.doneBorder : T.border}`,
                bgcolor: added ? T.doneBg : canUse ? 'white' : T.surface,
                opacity: canUse ? 1 : 0.55,
                '&:hover': canUse && !added ? { borderColor: T.orange } : {},
              }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={0.5}>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.4 }}>
                      <TIcon sx={{ fontSize: 16, color: added ? T.done : T.orange, flexShrink: 0 }} />
                      <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>{t.label}</Typography>
                      <Tooltip title="Explain this template">
                        <IconButton size="small" onClick={() => setSelectedTemplate(t)} sx={{ color: T.textSec, ml: 'auto' }}>
                          <InfoOutlined sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>
                      {explainer.summary}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block', mt: 0.35 }}>
                      Formula: {explainer.calculation}
                    </Typography>
                    {!canUse && (
                      <Stack direction="row" spacing={0.4} flexWrap="wrap" sx={{ mt: 0.5 }}>
                        <HighlightOff sx={{ fontSize: 11, color: T.danger, alignSelf: 'center' }} />
                        <Typography variant="caption" sx={{ fontSize: 9, color: T.danger }}>
                          Missing: {miss.join(', ')}
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                  {added
                    ? <CheckCircle sx={{ fontSize: 18, color: T.done, flexShrink: 0 }} />
                    : <OBtn size="small" disabled={canDisable(!canUse)}
                        onClick={() => onStepsChange([...steps, t.step])}>
                        Add
                      </OBtn>}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Card>

      <Alert severity="info" icon={<Code />} sx={{ borderRadius: 2, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
        Need a feature that is not listed here? Use Builder to create your own deterministic rule, aggregation, ratio, encoding, or interaction and add it to the pipeline.
      </Alert>

      <Dialog open={Boolean(selectedTemplate)} onClose={() => setSelectedTemplate(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>
          {selectedTemplate?.label === 'AML Domain Templates' ? 'How AML templates are defined' : selectedTemplate?.label}
        </DialogTitle>
        <DialogContent dividers>
          {selectedTemplate?.label === 'AML Domain Templates' ? (
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7 }}>
                These templates are deterministic AML feature patterns. They are defined from ratios, interactions, aggregation logic, and date-derived signals that are commonly useful in false-positive reduction.
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7 }}>
                They are not generated by GenAI and they are not learned by the model at this stage. The model only sees the resulting engineered columns later if you keep them in the pipeline.
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7 }}>
                If your team needs a bank-specific feature, use Builder to create it and keep the formula under explicit governance.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1.25}>
              <Box>
                <Typography sx={{ fontSize: 10, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>What it means</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: T.textPri, mt: 0.25 }}>
                  {(AML_TEMPLATE_EXPLAINERS[selectedTemplate?.label] || {}).summary || selectedTemplate?.desc}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 10, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>How it is calculated</Typography>
                <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7, mt: 0.25 }}>
                  {(AML_TEMPLATE_EXPLAINERS[selectedTemplate?.label] || {}).calculation || selectedTemplate?.desc}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 10, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>Why it helps</Typography>
                <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7, mt: 0.25 }}>
                  {(AML_TEMPLATE_EXPLAINERS[selectedTemplate?.label] || {}).why || 'This creates a reusable behavioural feature that can improve separation between low-value and actionable alerts.'}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 10, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>Required inputs</Typography>
                <Typography sx={{ fontSize: 12.5, color: T.textSec, lineHeight: 1.7, mt: 0.25 }}>
                  {(selectedTemplate?.req || []).join(', ') || 'No required columns listed'}
                </Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 - SELECT
// ═══════════════════════════════════════════════════════════════════════════════
const fallbackFeatureColumnName = (raw) => {
  if (typeof raw === 'string') return String(raw).trim();
  if (raw && typeof raw === 'object') {
    return String(raw.name || raw.column || raw.col || '').trim();
  }
  return '';
};

const fallbackFeatureIsId = (name) => {
  const col = String(name || '').trim().toLowerCase();
  if (!col) return false;
  if (['alert_id', 'transaction_id', 'account_id', 'customer_id', 'case_id', 'investigator_id'].includes(col)) return true;
  return /(^|_)(id|uuid|guid|key|ref|num|nbr|no)$/.test(col);
};

const fallbackFeatureRole = (name) => {
  const col = String(name || '').trim().toLowerCase();
  if (fallbackFeatureIsId(col)) return { role: 'id', dtype: 'object', is_id: true };
  if (/(date|time|timestamp|created|updated|open_date|close_date|alert_date)/.test(col)) {
    return { role: 'timestamp', dtype: 'datetime64[ns]', is_id: false };
  }
  if (/(^is_|_is_|_flag$|_flag_|flag|pep|sanction|weekend|triggered|contacted|requested|issued|active|banking|hit$)/.test(col)) {
    return { role: 'binary', dtype: 'int64', is_id: false };
  }
  if (/(score|amount|balance|days|hour|count|cnt|pct|ratio|volume|vol|avg|max|min|std|age|risk|tier|priority|linked|products|years)/.test(col)) {
    return { role: 'numeric', dtype: 'float64', is_id: false };
  }
  return { role: 'categorical', dtype: 'object', is_id: false };
};

const buildFeatureScreeningFallback = ({ masterDataset, targetColumn, topN, varThresh, corrThresh }) => {
  const rawColumns = Array.isArray(masterDataset?.columns) ? masterDataset.columns : [];
  const normalizedColumns = rawColumns
    .map((raw) => {
      const name = fallbackFeatureColumnName(raw);
      if (!name || String(name).toLowerCase() === String(targetColumn || '').toLowerCase()) return null;
      const inferred = fallbackFeatureRole(name);
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        name,
        role: source.role || inferred.role,
        dtype: source.dtype || inferred.dtype,
        is_id: typeof source.is_id === 'boolean' ? source.is_id : inferred.is_id,
        missing_pct: Number(source.missing_pct || 0),
        distinct_count: Number(source.distinct_count || 0),
        sample_values: Array.isArray(source.sample_values) ? source.sample_values : [],
      };
    })
    .filter(Boolean);

  if (!normalizedColumns.length) return null;

  return {
    target_column: targetColumn || null,
    rows_analyzed: Number(masterDataset?.row_count || 0),
    candidate_columns: normalizedColumns.filter((column) => !column.is_id).length,
    columns: normalizedColumns,
    available_techniques: FEATURE_SELECTION_TECHNIQUES,
    technique_results: {},
    recommended_supervised_metric: null,
    recommended_supervised_reason: null,
    recommended_filters: [],
    default_technique_id: 'information_gain',
    thresholds: {
      variance_threshold: Number(varThresh || 0.01),
      corr_threshold: Number(corrThresh || 0.95),
      top_n: Number(topN || 20),
    },
    ranked_feature_count: 0,
    __fallback_reason: 'The statistical screening service did not return a full payload, so FCC is showing a schema-first review from the current master dataset instead of blocking the workflow.',
  };
};

const SelectTab = ({ masterDataset, steps, onStepsChange, targetColumn }) => {
  const [data,       setData]       = useState(null);
  const [errors,     setErrors]     = useState({});
  const [loading,    setLoading]    = useState(false);
  const [varThresh,  setVarThresh]  = useState(0.01);
  const [corrThresh, setCorrThresh] = useState(0.95);
  const [topN,       setTopN]       = useState(20);
  const [scoreMetric, setScoreMetric] = useState('information_gain');
  const [activeTechniqueId, setActiveTechniqueId] = useState('');
  const [selectedWorkbenchCols, setSelectedWorkbenchCols] = useState([]);
  const [columnQuery, setColumnQuery] = useState('');
  const [showFilterTechniques, setShowFilterTechniques] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [scoreSelectionMode, setScoreSelectionMode] = useState('keep');
  const [viewMode, setViewMode] = useState('business');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [featureDetail, setFeatureDetail] = useState(null);
  const [featureDetailLoading, setFeatureDetailLoading] = useState(false);
  const [featureDetailError, setFeatureDetailError] = useState('');

  const load = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setLoading(true);
    try {
      const response = await mlopsApi.featureSelectionWorkbench({
        dataset_id: masterDataset.dataset_id,
        target_column: targetColumn,
        sample_rows: 2500,
        top_n: topN,
        var_threshold: varThresh,
        corr_threshold: corrThresh,
      });
      const payload = unwrapApiPayload(response);
      const fallbackPayload = buildFeatureScreeningFallback({
        masterDataset,
        targetColumn,
        topN,
        varThresh,
        corrThresh,
      });
      let resolvedPayload = payload;
      if (!payload || typeof payload !== 'object') {
        resolvedPayload = fallbackPayload;
      } else if ((!Array.isArray(payload?.columns) || !payload.columns.length) && fallbackPayload) {
        resolvedPayload = {
          ...fallbackPayload,
          ...payload,
          columns: fallbackPayload.columns,
          available_techniques: Array.isArray(payload?.available_techniques) && payload.available_techniques.length
            ? payload.available_techniques
            : fallbackPayload.available_techniques,
          technique_results: payload?.technique_results || fallbackPayload.technique_results,
          default_technique_id: payload?.default_technique_id || fallbackPayload.default_technique_id,
          thresholds: payload?.thresholds || fallbackPayload.thresholds,
          __fallback_reason: fallbackPayload.__fallback_reason,
        };
      }
      if (!resolvedPayload || typeof resolvedPayload !== 'object') {
        throw new Error('Feature screening returned no payload. Refresh the analysis and confirm the selected target is valid.');
      }
      const nextData = { workbench: resolvedPayload };
      setData(nextData);
      setErrors({});
      if (nextData?.workbench?.recommended_supervised_metric) {
        setScoreMetric(String(nextData.workbench.recommended_supervised_metric));
      }
      if (nextData?.workbench?.default_technique_id) {
        setActiveTechniqueId(String(nextData.workbench.default_technique_id));
      }
    } catch (e) {
      console.error(e);
      const fallbackPayload = buildFeatureScreeningFallback({
        masterDataset,
        targetColumn,
        topN,
        varThresh,
        corrThresh,
      });
      if (fallbackPayload) {
        setData({ workbench: fallbackPayload });
        setErrors({});
        setActiveTechniqueId(String(fallbackPayload.default_technique_id || 'information_gain'));
      } else {
        setData({ workbench: null });
        setErrors({ workbench: e?.message || 'Feature-selection workbench failed' });
      }
    } finally { setLoading(false); }
  }, [corrThresh, masterDataset, masterDataset?.dataset_id, targetColumn, topN, varThresh]);

  useEffect(() => { load(); }, [masterDataset?.dataset_id, targetColumn]); // refresh uses latest thresholds on demand

  const addDropStep = (cols, reason) => {
    if (!cols.length) return;
    onStepsChange([...steps, { type: 'drop_columns', columns: cols, reason }]);
  };

  const toggleWorkbenchColumn = (column) => {
    setSelectedWorkbenchCols((prev) => (
      prev.includes(column)
        ? prev.filter((item) => item !== column)
        : [...prev, column]
    ));
  };

  const applyWorkbenchSelection = () => {
    if (!activeTechnique || !applyColumns.length) return;
    if (activeTechniqueScope === 'score' && scoreSelectionMode === 'keep' && !selectedWorkbenchCols.length) return;
    addDropStep(applyColumns, applyReason);
  };

  const asNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const workbenchPayload = data?.workbench || {};
  const backendTechniques = Array.isArray(workbenchPayload?.available_techniques)
    ? workbenchPayload.available_techniques.map((tech) => ({ ...FEATURE_SELECTION_TECHNIQUE_MAP[tech.id], ...tech }))
    : [];
  const techniqueCatalog = backendTechniques.length ? backendTechniques : FEATURE_SELECTION_TECHNIQUES;
  const techniqueLookup = Object.fromEntries(techniqueCatalog.map((tech) => [tech.id, tech]));
  const visibleTechniqueCatalog = techniqueCatalog.filter((tech) => (
    tech.scope === 'score' || showFilterTechniques || tech.id === activeTechniqueId
  ));
  const scoreMetricOptions = techniqueCatalog.filter((tech) => tech.scope === 'score');
  const scoreMetricLookup = Object.fromEntries(scoreMetricOptions.map((tech) => [tech.id, tech]));
  const recommendedMetric = String(workbenchPayload?.recommended_supervised_metric || '');
  const recommendedMetricId = scoreMetricLookup[recommendedMetric]
    ? recommendedMetric
    : (scoreMetricOptions[0]?.id || 'information_gain');
  const effectiveScoreMetric = scoreMetricLookup[scoreMetric] ? scoreMetric : recommendedMetricId;
  const techniqueResults = workbenchPayload?.technique_results || {};
  const effectiveScoreResult = techniqueResults?.[effectiveScoreMetric] || {};
  const scoreRowsRaw = Array.isArray(effectiveScoreResult?.rows) ? effectiveScoreResult.rows : [];
  const miAll = scoreRowsRaw
    .map((row) => ({
      ...row,
      feature: String(row?.feature || row?.column || ''),
      dtype: String(row?.dtype || row?.role || ''),
      rank_value: asNumber(row?.score ?? row?.value),
    }))
    .filter((row) => row.feature && row.rank_value != null && row.feature !== targetColumn)
    .sort((a, b) => (b.rank_value ?? 0) - (a.rank_value ?? 0));
  const topNMax = Math.max(1, Math.min(60, miAll.length || 1));
  const safeTopN = Math.min(topN, topNMax);
  const miDrop = miAll.slice(safeTopN).map((d) => d.feature);

  useEffect(() => {
    if (topN !== safeTopN) {
      setTopN(safeTopN);
    }
  }, [safeTopN, topN]);

  const existingDropReasons = new Set(steps.filter(s => s.type === 'drop_columns').map(s => s.reason));

  const activeTechnique = techniqueLookup[activeTechniqueId]
    || scoreMetricLookup[effectiveScoreMetric]
    || FEATURE_SELECTION_TECHNIQUE_MAP[effectiveScoreMetric]
    || null;
  const recommendedTechnique = scoreMetricLookup[recommendedMetricId] || techniqueLookup[recommendedMetricId] || FEATURE_SELECTION_TECHNIQUE_MAP[recommendedMetricId] || null;
  const scoreCoverage = asNumber(effectiveScoreResult?.coverage);
  const columnInventory = Array.isArray(workbenchPayload?.columns) ? workbenchPayload.columns : [];
  const columnInventoryLookup = Object.fromEntries(columnInventory.map((item) => [item.name, item]));
  const activeTechniqueResult = activeTechnique?.id ? (techniqueResults?.[activeTechnique.id] || {}) : {};
  const activeTechniqueRows = Array.isArray(activeTechniqueResult?.rows) ? activeTechniqueResult.rows : [];
  const activeTechniqueScope = activeTechnique?.scope || 'score';
  const scoreKeepCols = Array.isArray(activeTechniqueResult?.suggested_keep)
    ? activeTechniqueResult.suggested_keep
    : miAll.slice(0, safeTopN).map((row) => row.feature);
  const scoreDropCols = Array.isArray(activeTechniqueResult?.suggested_drop)
    ? activeTechniqueResult.suggested_drop
    : miDrop;
  const activeTechniqueRecommendedCols = activeTechniqueScope === 'score'
    ? (scoreSelectionMode === 'keep' ? scoreKeepCols : scoreDropCols)
    : (Array.isArray(activeTechniqueResult?.suggested_drop) ? activeTechniqueResult.suggested_drop : []);
  const selectedWorkbenchSet = new Set(selectedWorkbenchCols);
  const filteredTechniqueRows = activeTechniqueRows.filter((row) => {
    const feature = String(row?.feature || '');
    if (showSelectedOnly && !selectedWorkbenchSet.has(feature)) return false;
    const needle = String(columnQuery || '').trim().toLowerCase();
    if (!needle) return true;
    const featureNeedle = feature.toLowerCase();
    const reason = String(row?.reason || '').toLowerCase();
    return featureNeedle.includes(needle) || reason.includes(needle);
  });
  const applyReason = activeTechniqueScope === 'score'
    ? `score_${activeTechnique?.id}_${scoreSelectionMode}`
    : String(activeTechnique?.id || '');
  const applyColumns = activeTechniqueScope === 'score' && scoreSelectionMode === 'keep'
    ? activeTechniqueRows
        .map((row) => String(row?.feature || ''))
        .filter((feature) => feature && !selectedWorkbenchSet.has(feature))
    : selectedWorkbenchCols;
  const selectedColumnsSummary = summarizeColumns(selectedWorkbenchCols, 6);
  const applyButtonLabel = activeTechniqueScope === 'score' && scoreSelectionMode === 'keep'
    ? `Apply keep selection (${selectedWorkbenchCols.length})`
    : `Apply drop selection (${applyColumns.length})`;
  const activeTechniqueGuide = FEATURE_SELECTION_EXPLAINERS[activeTechnique?.id] || null;
  const scoreMetricLabel = FEATURE_SELECTION_TECHNIQUE_MAP[effectiveScoreMetric]?.label || activeTechnique?.label || 'Recommended screening metric';
  const scoreRowLookup = useMemo(
    () => Object.fromEntries(miAll.map((row, idx) => [row.feature, { ...row, rank_position: idx + 1 }])),
    [miAll],
  );
  const leakageNameRows = Array.isArray(techniqueResults?.leakage_name_scan?.rows) ? techniqueResults.leakage_name_scan.rows : [];
  const leakageCorrRows = Array.isArray(techniqueResults?.leakage_target_corr?.rows) ? techniqueResults.leakage_target_corr.rows : [];
  const varianceRows = Array.isArray(techniqueResults?.variance_threshold?.rows) ? techniqueResults.variance_threshold.rows : [];
  const madRows = Array.isArray(techniqueResults?.mean_abs_deviation?.rows) ? techniqueResults.mean_abs_deviation.rows : [];
  const dispersionRows = Array.isArray(techniqueResults?.dispersion_ratio?.rows) ? techniqueResults.dispersion_ratio.rows : [];
  const correlationRows = Array.isArray(techniqueResults?.correlation_filter?.rows) ? techniqueResults.correlation_filter.rows : [];

  useEffect(() => {
    if (activeTechniqueId && techniqueLookup[activeTechniqueId]) return;
    if (recommendedMetricId) {
      setActiveTechniqueId(recommendedMetricId);
      return;
    }
    if (techniqueCatalog[0]?.id) {
      setActiveTechniqueId(String(techniqueCatalog[0].id));
    }
  }, [activeTechniqueId, recommendedMetricId, techniqueCatalog, techniqueLookup]);

  useEffect(() => {
    setSelectedWorkbenchCols(activeTechniqueRecommendedCols || []);
    setShowSelectedOnly(false);
  }, [activeTechniqueId, activeTechniqueRecommendedCols, scoreSelectionMode]);

  useEffect(() => {
    if (!scoreMetricLookup[effectiveScoreMetric]) return;
    setActiveTechniqueId((prev) => {
      if (!prev) return effectiveScoreMetric;
      const prevScope = techniqueLookup[prev]?.scope;
      return prevScope === 'score' ? effectiveScoreMetric : prev;
    });
  }, [effectiveScoreMetric, scoreMetricLookup, techniqueLookup]);

  const featureProfiles = useMemo(() => {
    const leakageByName = new Set(leakageNameRows.map((row) => String(row?.feature || '')));
    const leakageByTarget = new Set(leakageCorrRows.map((row) => String(row?.feature || '')));
    const lowVarianceSet = new Set(varianceRows.map((row) => String(row?.feature || '')));
    const lowMadSet = new Set(madRows.map((row) => String(row?.feature || '')));
    const lowDispersionSet = new Set(dispersionRows.map((row) => String(row?.feature || '')));
    const redundancySet = new Set(correlationRows.map((row) => String(row?.feature || '')));
    const redundancyPartners = Object.fromEntries(
      correlationRows.map((row) => [
        String(row?.feature || ''),
        Array.isArray(row?.partners) ? row.partners : [],
      ]),
    );
    const rankedScores = miAll.map((row) => Number(row.rank_value)).filter((value) => Number.isFinite(value));
    const minScore = rankedScores.length ? Math.min(...rankedScores) : 0;
    const maxScore = rankedScores.length ? Math.max(...rankedScores) : 0;
    const denominator = maxScore - minScore;
    const totalRows = Number(workbenchPayload?.rows_analyzed || 0);

    return columnInventory
      .filter((item) => !item?.is_id)
      .map((item) => {
        const feature = String(item?.name || '');
        const scoreRow = scoreRowLookup[feature] || null;
        const rawScore = Number(scoreRow?.rank_value);
        const hasScore = Number.isFinite(rawScore);
        const scoreNorm = hasScore
          ? (denominator <= 0 ? 1 : clamp01((rawScore - minScore) / denominator))
          : 0;
        const rankPosition = Number(scoreRow?.rank_position || 0);
        const isTopRank = rankPosition > 0 && rankPosition <= safeTopN;
        const missingPct = Number(item?.missing_pct || 0);
        const distinctCount = Number(item?.distinct_count || 0);
        const uniqueRatio = totalRows > 0 ? clamp01(distinctCount / totalRows) : 0;
        const hasLeakage = leakageByName.has(feature) || leakageByTarget.has(feature);
        const hasRedundancy = redundancySet.has(feature);
        const hasLowVariance = lowVarianceSet.has(feature) || lowMadSet.has(feature) || lowDispersionSet.has(feature);
        const signalBand = !targetColumn
          ? 'Awaiting target definition'
          : !hasScore
            ? 'No clear signal'
            : (isTopRank || scoreNorm >= 0.68)
              ? 'Strong signal'
              : scoreNorm >= 0.4
                ? 'Moderate signal'
                : scoreNorm >= 0.18
                  ? 'Weak signal'
                  : 'No clear signal';
        const qualityLabel = featureQualityLabel(missingPct, hasLowVariance);
        let recommendation = 'review';
        if (hasLeakage) {
          recommendation = 'drop';
        } else if (hasRedundancy && !isTopRank) {
          recommendation = 'drop';
        } else if (targetColumn && hasScore && (isTopRank || scoreNorm >= 0.68) && qualityLabel === 'Good') {
          recommendation = 'keep';
        } else if (!targetColumn && !hasLeakage && !hasRedundancy && qualityLabel !== 'Poor') {
          recommendation = 'review';
        } else if (qualityLabel === 'Poor') {
          recommendation = 'review';
        }
        const businessMeaning = inferFeatureBusinessMeaning(feature, item?.role);
        const evidence = [];
        if (targetColumn) {
          if (hasScore) {
            evidence.push(`Estimated relationship strength with the target is ${signalBand.toLowerCase()} using ${scoreMetricLabel}.`);
          } else {
            evidence.push('No supervised score is available for this field under the current target setup.');
          }
        } else {
          evidence.push('Supervised screening is not available until a target column is defined.');
        }
        if (isTopRank) {
          evidence.push(`This field sits inside the current top ${safeTopN} ranking cut.`);
        }
        if (hasRedundancy) {
          const partnerText = (redundancyPartners[feature] || [])
            .slice(0, 2)
            .map((partner) => String(partner?.feature || ''))
            .filter(Boolean)
            .join(', ');
          evidence.push(partnerText
            ? `It overlaps heavily with ${partnerText}.`
            : 'It overlaps heavily with another high-correlation field.');
        }
        if (hasLeakage) {
          evidence.push('Its name or target relationship suggests leakage risk, so it should not be trusted for model training.');
        }
        if (missingPct >= 0.25) {
          evidence.push(`${pct(missingPct, 0)} of rows are missing, which weakens operational stability.`);
        }
        if (hasLowVariance) {
          evidence.push('The field shows limited spread, so it may add little new information on its own.');
        }
        if (!evidence.length) {
          evidence.push('This field needs manual review before it is either kept or excluded.');
        }
        const issueTags = [];
        if (hasLeakage) issueTags.push('Potential leakage');
        if (hasRedundancy) issueTags.push('Likely redundant');
        if (hasLowVariance) issueTags.push('Low variation');
        if (missingPct >= 0.25) issueTags.push('High missingness');
        if (signalBand === 'Weak signal' || signalBand === 'No clear signal') issueTags.push('Weak signal');
        return {
          feature,
          displayName: humanizeFeatureName(feature),
          role: item?.role || scoreRow?.role || scoreRow?.dtype || 'unknown',
          dtype: item?.dtype || scoreRow?.dtype || item?.role || 'unknown',
          recommendation,
          recommendationLabel: FEATURE_DECISION_STYLES[recommendation]?.label || 'Review',
          signalBand,
          hasLeakage,
          hasRedundancy,
          hasLowVariance,
          weakSignal: signalBand === 'Weak signal' || signalBand === 'No clear signal',
          qualityLabel,
          interpretabilityLabel: featureInterpretabilityLabel(item?.role, distinctCount),
          businessMeaning,
          score: hasScore ? rawScore : null,
          scoreNorm,
          scorePct: Math.round(scoreNorm * 100),
          rankPosition: rankPosition || null,
          missingPct,
          distinctCount,
          uniqueRatio,
          sampleValues: Array.isArray(item?.sample_values) ? item.sample_values : [],
          topCategories: Array.isArray(item?.top_categories) ? item.top_categories : [],
          evidence,
          issueTags,
        };
      })
      .sort((left, right) => {
        const decisionOrder = { keep: 0, review: 1, drop: 2 };
        const leftOrder = decisionOrder[left.recommendation] ?? 3;
        const rightOrder = decisionOrder[right.recommendation] ?? 3;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        if ((right.scoreNorm || 0) !== (left.scoreNorm || 0)) return (right.scoreNorm || 0) - (left.scoreNorm || 0);
        return (left.missingPct || 0) - (right.missingPct || 0);
      });
  }, [
    columnInventory,
    correlationRows,
    leakageCorrRows,
    leakageNameRows,
    madRows,
    miAll,
    safeTopN,
    scoreMetricLabel,
    scoreRowLookup,
    targetColumn,
    techniqueResults,
    varianceRows,
    dispersionRows,
    workbenchPayload?.rows_analyzed,
  ]);
  const fallbackFeatureProfiles = useMemo(() => (
    columnInventory
      .filter((item) => !item?.is_id && String(item?.name || '') !== String(targetColumn || ''))
      .slice(0, 24)
      .map((item, idx) => {
        const feature = String(item?.name || '');
        const missingPct = Number(item?.missing_pct || 0);
        const distinctCount = Number(item?.distinct_count || 0);
        const proxyScorePct = Math.max(12, Math.min(55, Math.round((1 - missingPct) * 45) + Math.max(0, 10 - idx)));
        return {
          feature,
          displayName: humanizeFeatureName(feature),
          role: item?.role || 'unknown',
          dtype: item?.dtype || item?.role || 'unknown',
          recommendation: 'review',
          recommendationLabel: FEATURE_DECISION_STYLES.review?.label || 'Review',
          signalBand: targetColumn ? 'No clear signal' : 'Awaiting target definition',
          hasLeakage: false,
          hasRedundancy: false,
          hasLowVariance: false,
          weakSignal: true,
          qualityLabel: featureQualityLabel(missingPct, false),
          interpretabilityLabel: featureInterpretabilityLabel(item?.role, distinctCount),
          businessMeaning: inferFeatureBusinessMeaning(feature, item?.role),
          score: proxyScorePct / 100,
          scoreNorm: proxyScorePct / 100,
          scorePct: proxyScorePct,
          rankPosition: idx + 1,
          missingPct,
          distinctCount,
          uniqueRatio: 0,
          sampleValues: Array.isArray(item?.sample_values) ? item.sample_values : [],
          topCategories: Array.isArray(item?.top_categories) ? item.top_categories : [],
          evidence: [
            targetColumn
              ? 'Supervised ranking is not available yet for this field, so the screen is showing a quality-first fallback review.'
              : 'A target column is required before supervised feature usefulness can be ranked.',
            missingPct >= 0.25
              ? `${pct(missingPct, 0)} of rows are missing, which should be reviewed before training.`
              : 'Coverage looks stable enough to keep reviewing this field.',
          ],
          issueTags: ['Fallback review'],
        };
      })
  ), [columnInventory, targetColumn]);
  const displayFeatureProfiles = featureProfiles.length ? featureProfiles : fallbackFeatureProfiles;

  const featureProfileLookup = useMemo(
    () => Object.fromEntries(displayFeatureProfiles.map((profile) => [profile.feature, profile])),
    [displayFeatureProfiles],
  );
  const summaryCounts = useMemo(() => ({
    keep: displayFeatureProfiles.filter((profile) => profile.recommendation === 'keep').length,
    review: displayFeatureProfiles.filter((profile) => profile.recommendation === 'review').length,
    redundant: displayFeatureProfiles.filter((profile) => profile.hasRedundancy).length,
    risk: displayFeatureProfiles.filter((profile) => profile.hasLeakage).length,
    weak: displayFeatureProfiles.filter((profile) => profile.weakSignal).length,
  }), [displayFeatureProfiles]);
  const leaderboardData = useMemo(
    () => displayFeatureProfiles
      .filter((profile) => profile.score != null || profile.recommendation === 'drop')
      .slice(0, 12),
    [displayFeatureProfiles],
  );
  const signalBandData = useMemo(() => {
    const order = ['Strong signal', 'Moderate signal', 'Weak signal', 'No clear signal', 'Awaiting target definition'];
    return order
      .map((label) => ({
        band: label,
        count: displayFeatureProfiles.filter((profile) => profile.signalBand === label).length,
      }))
      .filter((item) => item.count > 0);
  }, [displayFeatureProfiles]);
  const qualityRiskMatrix = useMemo(
    () => displayFeatureProfiles.slice(0, 18).map((profile) => ({
      feature: profile.displayName,
      usefulness: profile.scorePct || 0,
      qualityRisk: Math.round(((profile.missingPct || 0) + (profile.hasLowVariance ? 0.2 : 0) + (profile.hasRedundancy ? 0.1 : 0)) * 100),
      weight: profile.rankPosition ? Math.max(20 - profile.rankPosition, 4) : 6,
      recommendation: profile.recommendation,
    })),
    [displayFeatureProfiles],
  );
  const bucketGroups = useMemo(() => ([
    {
      key: 'keep',
      title: 'Strong business signal',
      description: 'Fields that look useful enough to keep moving forward.',
      items: displayFeatureProfiles.filter((profile) => profile.recommendation === 'keep').slice(0, 8),
      tone: FEATURE_DECISION_STYLES.keep,
    },
    {
      key: 'review',
      title: 'Needs review',
      description: 'Fields with some value but a quality, coverage, or consistency caveat.',
      items: displayFeatureProfiles.filter((profile) => profile.recommendation === 'review').slice(0, 8),
      tone: FEATURE_DECISION_STYLES.review,
    },
    {
      key: 'redundant',
      title: 'Likely redundant',
      description: 'Fields that overlap heavily with other columns and may not add new information.',
      items: displayFeatureProfiles.filter((profile) => profile.hasRedundancy).slice(0, 8),
      tone: { color: '#1d4ed8', border: '#bfdbfe', bg: '#eff6ff' },
    },
    {
      key: 'risk',
      title: 'Potential leakage or risk',
      description: 'Fields that look post-outcome, suspiciously perfect, or unsafe to rely on.',
      items: displayFeatureProfiles.filter((profile) => profile.hasLeakage).slice(0, 8),
      tone: FEATURE_DECISION_STYLES.drop,
    },
    {
      key: 'weak',
      title: 'Weak or noisy',
      description: 'Fields that show little signal or unstable behaviour in the current sample.',
      items: displayFeatureProfiles.filter((profile) => profile.weakSignal || profile.hasLowVariance).slice(0, 8),
      tone: { color: T.textSec, border: T.border, bg: T.surface },
    },
  ]), [displayFeatureProfiles]);
  const selectedProfile = featureProfileLookup[selectedFeature] || displayFeatureProfiles[0] || null;
  const selectedFeatureBins = Array.isArray(featureDetail?.woe_bins) ? featureDetail.woe_bins : [];
  const analysisHealth = useMemo(() => {
    const candidateColumns = columnInventory.filter((item) => !item?.is_id).length;
    if (workbenchPayload?.__fallback_reason) {
      return {
        severity: 'info',
        title: 'Showing a schema-first fallback review',
        detail: workbenchPayload.__fallback_reason,
      };
    }
    if (!columnInventory.length) {
      return {
        severity: 'warning',
        title: 'Feature screening returned no schema payload',
        detail: 'Refresh the analysis. If the problem continues, confirm that the current master dataset and target are loaded correctly.',
      };
    }
    if (!featureProfiles.length && fallbackFeatureProfiles.length) {
      return {
        severity: 'info',
        title: 'Showing a fallback quality-first review',
        detail: 'Supervised scores are not available for the current target or payload, so the charts below are using coverage and stability proxies until the target-aligned analysis returns.',
      };
    }
    if (targetColumn && !miAll.length) {
      return {
        severity: 'info',
        title: 'No supervised ranking was returned for the current target',
        detail: 'The screen still shows quality and risk diagnostics, but target-linked ranking needs a target column with usable labelled rows.',
      };
    }
    if (!candidateColumns) {
      return {
        severity: 'warning',
        title: 'No candidate feature columns remain after identifier filtering',
        detail: 'Most fields are currently classified as identifiers or excluded columns. Review the source dataset and the target mapping before training.',
      };
    }
    return null;
  }, [columnInventory, fallbackFeatureProfiles.length, featureProfiles.length, miAll.length, targetColumn]);
  const selectedFeatureEvidence = useMemo(() => {
    if (!selectedProfile) return [];
    return [
      { label: 'Recommendation', value: selectedProfile.recommendationLabel },
      { label: 'Signal band', value: selectedProfile.signalBand },
      { label: 'Missingness', value: pct(selectedProfile.missingPct, 0) },
      { label: 'Distinct values', value: fmt(selectedProfile.distinctCount) },
      { label: 'Interpretability', value: selectedProfile.interpretabilityLabel },
      { label: 'Assessment style', value: 'Statistical and rule-assisted only' },
    ];
  }, [selectedProfile]);

  useEffect(() => {
    if (!displayFeatureProfiles.length) {
      setSelectedFeature('');
      return;
    }
    if (!selectedFeature || !featureProfileLookup[selectedFeature]) {
      setSelectedFeature(displayFeatureProfiles[0].feature);
    }
  }, [featureProfileLookup, displayFeatureProfiles, selectedFeature]);

  useEffect(() => {
    let cancelled = false;
    if (!masterDataset?.dataset_id || !targetColumn || !selectedFeature) {
      setFeatureDetail(null);
      setFeatureDetailError('');
      return undefined;
    }
    const hydrate = async () => {
      setFeatureDetailLoading(true);
      setFeatureDetailError('');
      try {
        const response = await mlopsApi.featureTarget({
          dataset_id: masterDataset.dataset_id,
          target_column: targetColumn,
          columns: [selectedFeature],
          sample_rows: 12000,
        });
        if (cancelled) return;
        const payload = unwrapApiPayload(response) || {};
        const detail = Array.isArray(payload?.features) ? payload.features[0] : null;
        setFeatureDetail(detail || null);
      } catch (error) {
        if (cancelled) return;
        setFeatureDetail(null);
        setFeatureDetailError(error?.message || 'Feature detail could not be loaded');
      } finally {
        if (!cancelled) setFeatureDetailLoading(false);
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [masterDataset?.dataset_id, selectedFeature, targetColumn]);

  return (
    <Stack spacing={2}>
      <Alert
        severity={targetColumn ? 'success' : 'info'}
        icon={targetColumn ? <CheckCircle /> : <Warning />}
        sx={{ borderRadius: 2 }}>
        <Typography fontWeight={700} sx={{ fontSize: 13, mb: 0.2 }}>
          {targetColumn ? `Feature usefulness assessment for ${targetColumn}` : 'Feature usefulness assessment before modelling'}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          {targetColumn
            ? 'This step screens columns before any model is trained and helps you decide what to keep, review, or exclude using statistical evidence.'
            : 'Set the target in the earlier step to unlock supervised screening. Until then, this step focuses on quality, redundancy, and leakage risk.'}
        </Typography>
      </Alert>

      <Card accent="orange" sx={{ p: 0 }}>
        <Box sx={{ p: 2.1, borderBottom: `1px solid ${T.border}` }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 20, color: T.textPri }}>
                Feature Screening and Selection
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: T.textSec, mt: 0.45, lineHeight: 1.75, maxWidth: 920 }}>
                Review which columns appear useful, redundant, unstable, or risky using statistical evidence before any model is trained.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={viewMode}
                onChange={(_, value) => value && setViewMode(value)}
                sx={{
                  '& .MuiToggleButton-root': {
                    px: 1.3,
                    py: 0.45,
                    textTransform: 'none',
                    fontSize: 11.5,
                    color: T.textSec,
                    borderColor: T.border,
                  },
                  '& .Mui-selected': {
                    bgcolor: T.orangeLight,
                    color: T.orange,
                    borderColor: '#f3b797',
                  },
                }}>
                <ToggleButton value="business">Business view</ToggleButton>
                <ToggleButton value="technical">Technical view</ToggleButton>
              </ToggleButtonGroup>
              <OBtn variant="outlined" icon={<Refresh sx={{ fontSize: 13 }} />} onClick={load} disabled={canDisable(loading)}>
                {loading ? 'Running analysis...' : 'Refresh analysis'}
              </OBtn>
            </Stack>
          </Stack>
          <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 1.35, borderRadius: 1.5, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
            <Typography sx={{ fontSize: 12.2, color: T.textPri, lineHeight: 1.7 }}>
              This step is statistical and rule-assisted. No predictive model or generative AI is used to score columns here.
            </Typography>
          </Alert>
          {analysisHealth && (
            <Alert severity={analysisHealth.severity} sx={{ mt: 1.1, borderRadius: 1.5 }}>
              <Typography sx={{ fontSize: 12.2, fontWeight: 700, mb: 0.3 }}>{analysisHealth.title}</Typography>
              <Typography sx={{ fontSize: 11.8, lineHeight: 1.7 }}>{analysisHealth.detail}</Typography>
            </Alert>
          )}
        </Box>

        <Box sx={{ p: 2.1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1 }}>
            {[
              { key: 'keep', label: 'Recommended to keep', value: summaryCounts.keep, tone: FEATURE_DECISION_STYLES.keep },
              { key: 'review', label: 'Needs review', value: summaryCounts.review, tone: FEATURE_DECISION_STYLES.review },
              { key: 'redundant', label: 'Likely redundant', value: summaryCounts.redundant, tone: { color: '#1d4ed8', border: '#bfdbfe', bg: '#eff6ff' } },
              { key: 'risk', label: 'Potential leakage / risk', value: summaryCounts.risk, tone: FEATURE_DECISION_STYLES.drop },
              { key: 'weak', label: 'Weak signal', value: summaryCounts.weak, tone: { color: T.textSec, border: T.border, bg: T.surface } },
            ].map((item) => (
              <Box key={item.key} sx={{ p: 1.35, borderRadius: 0, border: `1px solid ${T.border}`, borderTop: `2px solid ${item.tone.color}`, bgcolor: 'white' }}>
                <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                  {item.label}
                </Typography>
                <Typography sx={{ fontSize: 26, fontWeight: 800, color: item.tone.color, lineHeight: 1.1, mt: 0.35 }}>
                  {fmt(item.value)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Card>

      {!loading && !errors.workbench && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.1fr) minmax(340px, 0.9fr)' }, gap: 2 }}>
          <Card sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${T.border}` }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: T.textPri }}>
                Decision summary
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: T.textSec, mt: 0.35 }}>
                Start with decision buckets, not formulas. This view highlights which fields look useful, risky, or noisy before modelling.
              </Typography>
            </Box>
            <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.15fr 0.85fr' }, gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.8, mb: 1 }}>
                  Feature leaderboard
                </Typography>
                <Box sx={{ height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leaderboardData} layout="vertical" margin={{ top: 4, right: 18, left: 12, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis
                        type="category"
                        dataKey="displayName"
                        width={160}
                        tick={{ fontSize: 10.5, fill: '#334155' }}
                      />
                      <RTooltip
                        formatter={(value, _, payload) => [`${value}%`, payload?.payload?.recommendationLabel || 'Recommendation']}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="scorePct" radius={[0, 6, 6, 0]} name="Estimated usefulness">
                        {leaderboardData.map((entry) => (
                          <Cell
                            key={entry.feature}
                            fill={entry.recommendation === 'keep' ? '#22c55e' : entry.recommendation === 'drop' ? '#ef4444' : '#f59e0b'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
                <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.9, lineHeight: 1.7 }}>
                  Estimated relationship strength with target
                  {targetColumn ? `, measured using ${scoreMetricLabel}` : ''}.
                  The method stays underneath the evidence, not in front of the decision.
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.8, mb: 1 }}>
                  Signal bands
                </Typography>
                <Box sx={{ height: 170 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={signalBandData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                      <XAxis dataKey="band" tick={{ fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={48} />
                      <YAxis tick={{ fontSize: 10.5, fill: '#64748b' }} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#D04A02" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>

                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.8, mt: 1.5, mb: 1 }}>
                  Usefulness versus quality risk
                </Typography>
                <Box sx={{ height: 170 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 4, right: 8, left: -6, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                      <XAxis type="number" dataKey="usefulness" name="Usefulness" unit="%" tick={{ fontSize: 10 }} />
                      <YAxis type="number" dataKey="qualityRisk" name="Quality risk" unit="%" tick={{ fontSize: 10 }} />
                      <ZAxis type="number" dataKey="weight" range={[60, 320]} />
                      <RTooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Scatter data={qualityRiskMatrix}>
                        {qualityRiskMatrix.map((entry) => (
                          <Cell
                            key={entry.feature}
                            fill={entry.recommendation === 'keep' ? '#22c55e' : entry.recommendation === 'drop' ? '#ef4444' : '#f59e0b'}
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
            </Box>
          </Card>

          <Card sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${T.border}` }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: T.textPri }}>
                Why this column is recommended
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: T.textSec, mt: 0.35 }}>
                Click any field below to see the business meaning, risk notes, and statistical evidence that support the recommendation.
              </Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1.4 }}>
                {displayFeatureProfiles.slice(0, 16).map((profile) => (
                  <Chip
                    key={profile.feature}
                    label={profile.displayName}
                    onClick={() => setSelectedFeature(profile.feature)}
                    sx={{
                      borderRadius: 0,
                      bgcolor: 'white',
                      color: selectedProfile?.feature === profile.feature ? T.orange : T.textPri,
                      border: `1px solid ${selectedProfile?.feature === profile.feature ? T.orange : T.border}`,
                      fontWeight: selectedProfile?.feature === profile.feature ? 700 : 500,
                    }}
                  />
                ))}
              </Stack>

              {selectedProfile ? (
                <Stack spacing={1.4}>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                    <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.textPri }}>
                      {selectedProfile.displayName}
                    </Typography>
                    <Chip
                      label={selectedProfile.recommendationLabel}
                      size="small"
                      sx={{
                        bgcolor: FEATURE_DECISION_STYLES[selectedProfile.recommendation]?.bg,
                        color: FEATURE_DECISION_STYLES[selectedProfile.recommendation]?.color,
                        border: `1px solid ${FEATURE_DECISION_STYLES[selectedProfile.recommendation]?.border}`,
                        fontWeight: 700,
                      }}
                    />
                    <Chip label={selectedProfile.signalBand} size="small" sx={{ bgcolor: T.surface, color: T.textSec }} />
                    <Chip label={featureRoleLabel(selectedProfile.role)} size="small" sx={{ bgcolor: T.infoBg, color: '#1d4ed8' }} />
                  </Stack>

                  <Box sx={{ p: 1.35, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                    <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                      Business meaning
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: T.textPri, lineHeight: 1.75, mt: 0.35 }}>
                      {selectedProfile.businessMeaning}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1 }}>
                    {selectedFeatureEvidence.map((item) => (
                      <Box key={item.label} sx={{ p: 1.1, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                        <Typography sx={{ fontSize: 10, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                          {item.label}
                        </Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.textPri, mt: 0.35 }}>
                          {item.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>

                  <Box sx={{ p: 1.35, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                    <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7, mb: 0.7 }}>
                      Why this may matter
                    </Typography>
                    <Stack spacing={0.65}>
                      {selectedProfile.evidence.map((line) => (
                        <Typography key={line} sx={{ fontSize: 12.1, color: T.textPri, lineHeight: 1.7 }}>
                          {line}
                        </Typography>
                      ))}
                    </Stack>
                  </Box>

                  {featureDetailLoading && (
                    <Typography sx={{ fontSize: 12, color: T.textSec }}>
                      Loading detailed separation evidence...
                    </Typography>
                  )}
                  {!!featureDetailError && (
                    <Alert severity="info" sx={{ borderRadius: 1.5 }}>
                      {featureDetailError}
                    </Alert>
                  )}

                  {!featureDetailLoading && selectedFeatureBins.length > 0 && (
                    <Box sx={{ p: 1.35, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                      <Typography sx={{ fontSize: 10.5, color: T.textSec, textTransform: 'uppercase', letterSpacing: 0.7, mb: 0.9 }}>
                        Target separation preview
                      </Typography>
                      <Box sx={{ height: 240 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={selectedFeatureBins} margin={{ top: 4, right: 16, left: -12, bottom: 6 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                            <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
                            <YAxis yAxisId="count" tick={{ fontSize: 10 }} />
                            <YAxis yAxisId="rate" orientation="right" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} tick={{ fontSize: 10 }} />
                            <RTooltip formatter={(value, name) => {
                              if (name === 'Target positive rate') return [pct(value, 1), name];
                              return [fmt(value), name];
                            }} />
                            <Legend />
                            <Bar yAxisId="count" dataKey="pos" fill="#D04A02" name="Actionable / positive" radius={[4, 4, 0, 0]} />
                            <Bar yAxisId="count" dataKey="neg" fill="#CBD5E1" name="Likely false positive / negative" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="rate" type="monotone" dataKey="tp_rate" stroke="#0f172a" strokeWidth={2} name="Target positive rate" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Box>
                      <Typography sx={{ fontSize: 11.2, color: T.textSec, mt: 0.7, lineHeight: 1.7 }}>
                        This shows how the target event rate shifts across bins of the selected field. Clear separation usually means the column is more useful for downstream modelling.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              ) : (
                <Typography sx={{ fontSize: 12, color: T.textSec }}>
                  No feature evidence is available yet.
                </Typography>
              )}
            </Box>
          </Card>
        </Box>
      )}

      {!loading && !errors.workbench && (
        <Card sx={{ p: 0, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${T.border}` }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: T.textPri }}>
              Decision buckets
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textSec, mt: 0.35 }}>
              Use these groups to understand which columns look helpful, overlapping, risky, or noisy before touching technical method details.
            </Typography>
          </Box>
          <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
            {bucketGroups.map((group) => (
              <Box key={group.key} sx={{ p: 1.25, borderRadius: 0, border: `1px solid ${T.border}`, borderTop: `2px solid ${group.tone.color}`, bgcolor: 'white' }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: group.tone.color }}>
                  {group.title}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.35, lineHeight: 1.65 }}>
                  {group.description}
                </Typography>
                <Stack spacing={0.65} sx={{ mt: 1 }}>
                  {group.items.length ? group.items.map((profile) => (
                    <Box
                      key={`${group.key}-${profile.feature}`}
                      onClick={() => setSelectedFeature(profile.feature)}
                      sx={{
                        p: 0.95,
                        borderRadius: 0,
                        bgcolor: 'white',
                        border: `1px solid ${selectedProfile?.feature === profile.feature ? T.orange : T.border}`,
                        cursor: 'pointer',
                      }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: T.textPri }}>
                        {profile.displayName}
                      </Typography>
                      <Typography sx={{ fontSize: 10.6, color: T.textSec, mt: 0.25, lineHeight: 1.55 }}>
                        {profile.evidence[0]}
                      </Typography>
                    </Box>
                  )) : (
                    <Typography sx={{ fontSize: 11, color: T.textSec }}>
                      Nothing in this group for the current dataset.
                    </Typography>
                  )}
                </Stack>
              </Box>
            ))}
          </Box>
        </Card>
      )}

      {viewMode === 'business' && (
        <Alert severity="info" icon={<Insights />} sx={{ borderRadius: 0 }}>
          Switch to Technical view if you want to inspect the exact statistical method, thresholds, raw scores, and grouped drop-step controls.
        </Alert>
      )}

      {loading && <Spinner label="Running selection analysis..." />}

      {!loading && errors.workbench && (
        <Alert severity="error" icon={<Warning />} sx={{ py: 0.5, fontSize: 11 }}>
          {errors.workbench}
        </Alert>
      )}

      {viewMode === 'technical' && (
        <>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.1 }} flexWrap="wrap" rowGap={1}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>Technical method library</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
              The methods below explain how the evidence is computed. Use them when you want exact scoring logic, thresholds, or grouped apply controls.
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexWrap="wrap">
            {recommendedTechnique && (
              <Chip
                label={`Best default: ${recommendedTechnique.label}`}
                size="small"
                sx={{ fontSize: 9.5, bgcolor: T.doneBg, color: '#166534', fontWeight: 700 }}
              />
            )}
            <OBtn
              variant="outlined"
              size="small"
              onClick={() => {
                setActiveTechniqueId(recommendedMetricId);
                setScoreMetric(recommendedMetricId);
              }}>
              Use recommended
            </OBtn>
            <OBtn variant="outlined" size="small" onClick={() => setShowFilterTechniques((prev) => !prev)}>
              {showFilterTechniques ? 'Hide filter scans' : 'Show filter scans'}
            </OBtn>
          </Stack>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1 }}>
          {visibleTechniqueCatalog.map((tech) => {
            const techResult = techniqueResults?.[tech.id] || {};
            const isActive = activeTechniqueId === tech.id;
            const rowCount = Array.isArray(techResult?.rows) ? techResult.rows.length : 0;
            return (
              <Box
                key={tech.id}
                onClick={() => {
                  setActiveTechniqueId(String(tech.id));
                  if (tech.scope === 'score') setScoreMetric(String(tech.id));
                }}
                sx={{
                  p: 1,
                  borderRadius: 1.25,
                  border: `1px solid ${isActive ? T.orange : T.border}`,
                  bgcolor: isActive ? T.orangeLight : (tech.scope === 'filter' ? T.surface : 'white'),
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 6px 18px rgba(208,74,2,0.10)' : 'none',
                  '&:hover': { borderColor: T.orange, transform: 'translateY(-1px)' },
                }}>
                <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mb: 0.4 }} flexWrap="wrap">
                  <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>{tech.label}</Typography>
                  <Chip label={tech.family || tech.scope} size="small" sx={{ height: 16, fontSize: 8.5, bgcolor: T.infoBg, color: '#1d4ed8' }} />
                  {rowCount > 0 && (
                    <Chip label={`${rowCount}`} size="small" sx={{ height: 16, fontSize: 8.5, bgcolor: T.doneBg, color: T.done }} />
                  )}
                  {recommendedTechnique?.id === tech.id && (
                    <Chip label="Recommended" size="small" sx={{ height: 16, fontSize: 8.5, bgcolor: T.doneBg, color: '#166534' }} />
                  )}
                </Stack>
                <Typography variant="caption" sx={{ fontSize: 10, color: T.textSec }}>
                  {tech.description}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Card>

      {!loading && activeTechnique && (
        <Card accent="orange">
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.1 }} flexWrap="wrap" rowGap={1}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{activeTechnique.label} Workbench</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                Only the selected technique is shown here. Review the ranked columns, then keep or remove them in one grouped preprocessing step.
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.75} flexWrap="wrap">
              <Chip
                label={activeTechnique.scope === 'score' ? 'Supervised' : 'Filter'}
                size="small"
                sx={{ fontSize: 9.5, bgcolor: activeTechnique.scope === 'score' ? T.orangeLight : T.surface, color: T.orange }}
              />
              {activeTechniqueResult?.selected_count != null && (
                <Chip
                  label={`${activeTechniqueResult.selected_count} candidate${activeTechniqueResult.selected_count === 1 ? '' : 's'}`}
                  size="small"
                  sx={{ fontSize: 9.5, bgcolor: T.infoBg, color: '#1d4ed8' }}
                />
              )}
            </Stack>
          </Stack>

          {recommendedTechnique && activeTechnique.scope === 'score' && (
            <Alert severity="success" icon={<CheckCircle />} sx={{ mb: 1.1, py: 0.4, fontSize: 10.5 }}>
              Recommended technique: <strong>{recommendedTechnique.label}</strong>
              {workbenchPayload?.recommended_supervised_reason ? ` - ${workbenchPayload.recommended_supervised_reason}` : ''}
            </Alert>
          )}

          {activeTechniqueResult?.message && (
            <Alert severity={activeTechnique.scope === 'score' && !targetColumn ? 'warning' : 'info'} sx={{ mb: 1.1, py: 0.4, fontSize: 10.5 }}>
              {activeTechniqueResult.message}
              {activeTechnique.scope === 'score' && workbenchPayload?.recommended_supervised_reason
                ? ` ${workbenchPayload.recommended_supervised_reason}`
                : ''}
            </Alert>
          )}

          {activeTechnique.scope === 'score' && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 1.2 }}>
              <FormControl size="small" sx={{ minWidth: 300 }}>
                <InputLabel>Technique</InputLabel>
                <Select
                  label="Technique"
                  value={effectiveScoreMetric}
                  onChange={(e) => setScoreMetric(String(e.target.value))}
                  sx={{ fontSize: 12 }}>
                  {scoreMetricOptions.map((tech) => (
                    <MenuItem key={tech.id} value={tech.id}>{tech.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={0.75}>
                <OBtn
                  variant={scoreSelectionMode === 'keep' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setScoreSelectionMode('keep')}>
                  Keep selected
                </OBtn>
                <OBtn
                  variant={scoreSelectionMode === 'drop' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setScoreSelectionMode('drop')}>
                  Drop selected
                </OBtn>
              </Stack>
              {scoreCoverage != null && (
                <Chip
                  label={`Coverage ${pct(scoreCoverage, 0)}`}
                  size="small"
                  sx={{ fontSize: 9.5, bgcolor: T.surface, color: T.textSec }}
                />
              )}
            </Stack>
          )}

          {(activeTechnique.id === 'variance_threshold' || activeTechnique.id === 'correlation_filter') && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 1.2 }}>
              {activeTechnique.id === 'variance_threshold' && (
                <>
                  <Typography variant="caption" sx={{ fontSize: 11, flexShrink: 0 }}>Variance threshold</Typography>
                  <Slider value={varThresh} min={0} max={0.1} step={0.005}
                    onChange={(_, value) => setVarThresh(value)} sx={{ color: T.orange, maxWidth: 220 }} />
                  <Chip label={varThresh.toFixed(3)} size="small" sx={{ fontFamily: 'monospace', fontSize: 10 }} />
                </>
              )}
              {activeTechnique.id === 'correlation_filter' && (
                <>
                  <Typography variant="caption" sx={{ fontSize: 11, flexShrink: 0 }}>|r| threshold</Typography>
                  <Slider value={corrThresh} min={0.7} max={1} step={0.025}
                    onChange={(_, value) => setCorrThresh(value)} sx={{ color: T.orange, maxWidth: 220 }} />
                  <Chip label={corrThresh.toFixed(2)} size="small" sx={{ fontFamily: 'monospace', fontSize: 10 }} />
                </>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                Change the threshold and refresh analysis to recalculate the flagged columns.
              </Typography>
            </Stack>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 1.2 }}>
            <TextField
              size="small"
              placeholder="Search columns or reasons"
              value={columnQuery}
              onChange={(e) => setColumnQuery(e.target.value)}
              sx={{ minWidth: 260, '& input': { fontSize: 12 } }}
            />
            {activeTechnique.scope === 'score' && (
              <>
                <Typography variant="caption" sx={{ fontSize: 11, flexShrink: 0 }}>Keep top:</Typography>
                <Slider value={safeTopN} min={1} max={topNMax} step={1}
                  onChange={(_, v) => setTopN(v)} sx={{ flex: 1, color: T.orange, maxWidth: 240 }} />
                <Chip label={`${safeTopN} / ${miAll.length || 0}`} size="small" sx={{ fontFamily: 'monospace', fontSize: 10 }} />
              </>
            )}
            <OBtn variant="outlined" onClick={() => setSelectedWorkbenchCols(activeTechniqueRecommendedCols || [])}>
              Select recommended
            </OBtn>
            <OBtn variant="outlined" onClick={() => setSelectedWorkbenchCols(filteredTechniqueRows.map((row) => row.feature).filter(Boolean))}>
              Select visible
            </OBtn>
            <OBtn variant="outlined" onClick={() => setShowSelectedOnly((prev) => !prev)}>
              {showSelectedOnly ? 'Show all rows' : 'Show selected only'}
            </OBtn>
            <OBtn variant="outlined" onClick={() => setSelectedWorkbenchCols([])}>
              Clear
            </OBtn>
            <OBtn
              onClick={applyWorkbenchSelection}
              disabled={
                !applyColumns.length
                || existingDropReasons.has(applyReason)
                || (activeTechnique.scope === 'score' && scoreSelectionMode === 'keep' && !selectedWorkbenchCols.length)
              }>
              {applyButtonLabel}
            </OBtn>
          </Stack>

          {selectedWorkbenchCols.length > 0 && (
            <Alert severity="success" icon={<CheckCircle />} sx={{ mb: 1.1, py: 0.4, fontSize: 10.5 }}>
              Selected columns: <strong>{selectedColumnsSummary}</strong>
              {activeTechnique.scope === 'score' && scoreSelectionMode === 'keep'
                ? ` | applying this keeps ${selectedWorkbenchCols.length} ranked columns and removes ${applyColumns.length} unselected ranked columns in one grouped step.`
                : ` | applying this removes ${applyColumns.length} columns in one grouped step.`}
            </Alert>
          )}

          {filteredTechniqueRows.length === 0 ? (
            <Alert severity="info" icon={<Warning />} sx={{ py: 0.5, fontSize: 11 }}>
              {activeTechnique.scope === 'score'
                ? 'No ranked features are available for this technique on the current target.'
                : 'No columns were flagged by this filter on the current thresholds.'}
            </Alert>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Pick', 'Column', 'Role', 'Score', 'Missing', 'Sample values', 'Why'].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: T.textSec, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTechniqueRows.slice(0, 40).map((row) => {
                    const feature = String(row?.feature || '');
                    const meta = columnInventoryLookup[feature] || {};
                    const selected = selectedWorkbenchSet.has(feature);
                    const sampleValues = Array.isArray(row?.sample_values) && row.sample_values.length
                      ? row.sample_values
                      : (Array.isArray(meta?.sample_values) ? meta.sample_values : []);
                    return (
                      <tr key={`${activeTechnique.id}-${feature}`} style={{ borderBottom: `1px solid ${T.border}`, background: selected ? T.orangeLight : 'transparent' }}>
                        <td style={{ padding: '4px 8px' }}>
                          <Checkbox
                            size="small"
                            checked={selected}
                            onChange={() => toggleWorkbenchColumn(feature)}
                            sx={{ p: 0.2 }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{clip(feature, 28)}</td>
                        <td style={{ padding: '6px 8px' }}>{row?.role || meta?.role || row?.dtype || 'unknown'}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{fmtF(row?.score ?? row?.rank_value, 6)}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{pct(row?.missing_pct ?? meta?.missing_pct, 0)}</td>
                        <td style={{ padding: '6px 8px', fontSize: 10, color: T.textSec }}>
                          {sampleValues.length ? sampleValues.slice(0, 3).join(', ') : '-'}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: 10.5, color: T.textSec }}>
                          {clip(row?.reason || activeTechnique.description, 72)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredTechniqueRows.length > 40 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8, fontSize: 10 }}>
                  Showing the first 40 rows. Use search to narrow the selection before applying.
                </Typography>
              )}
            </Box>
          )}
        </Card>
      )}
        </>
      )}

      {steps.some(s => s.type === 'drop_columns') && (
        <Card>
          <SLabel>Feature selection steps in pipeline</SLabel>
          <Stack spacing={0.6}>
            {steps.map((s, i) => s.type !== 'drop_columns' ? null : (
              <Box key={i} sx={{ p: 1.25, bgcolor: T.dangerBg, borderRadius: 1.5, border: `1px solid ${T.dangerBorder}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                      Drop {s.columns?.length} columns · reason: <em>{s.reason || 'manual'}</em>
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 9.5, color: T.textSec }}>
                      {s.columns?.slice(0, 6).join(', ')}{(s.columns?.length || 0) > 6 ? '…' : ''}
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={() => onStepsChange(steps.filter((_, j) => j !== i))}
                    sx={{ color: T.danger }}>
                    <Delete sx={{ fontSize: 15 }} />
                  </IconButton>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 - PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
const PreviewTab = ({
  masterDataset,
  preprocessedDataset,
  targetColumn,
  steps,
  onPreview,
  preview: parentPreview,
  persona,
}) => {
  const [localPreview, setLocalPreview] = useState(parentPreview || null);
  const [loading,      setLoading]      = useState(false);
  const [err,          setErr]          = useState(null);
  const [columnDialog, setColumnDialog] = useState(null);

  const run = useCallback(async () => {
    if (!masterDataset?.dataset_id || !steps.length) return;
    setLoading(true); setErr(null);
    try {
      let payload = null;
      if (onPreview) {
        payload = await onPreview(steps);
      } else {
        const res = await mlopsApi.preprocessPreview({
          dataset_id: masterDataset.dataset_id,
          dataset: masterDataset,
          steps,
          sample_rows: 25,
          target_column: targetColumn,
        });
        payload = res?.data || res;
      }
      if (!payload) throw new Error('Preview returned no result.');
      setLocalPreview(payload);
    } catch (e) { setErr(e?.message || 'Preview failed'); }
    finally { setLoading(false); }
  }, [masterDataset?.dataset_id, steps, targetColumn, onPreview]);

  const pv          = localPreview || parentPreview;
  const beforeCols  = masterDataset?.columns || [];
  const afterCols   = pv?.columns || [];
  const newCols     = afterCols.filter(c => !beforeCols.includes(c));
  const removedCols = beforeCols.filter(c => !afterCols.includes(c));
  const rows        = pv?.preview || [];
  const columnDialogConfig = columnDialog === 'new'
    ? {
      title: 'New engineered columns',
      subtitle: 'These columns are created by the current preprocessing plan and will be available to model training after the full run.',
      items: newCols,
      tone: 'success',
      chipBg: '#dcfce7',
      chipColor: '#166534',
    }
    : columnDialog === 'removed'
      ? {
        title: 'Dropped columns',
        subtitle: 'These columns are removed by the current preprocessing and governance plan before model training.',
        items: removedCols,
        tone: 'error',
        chipBg: '#fee2e2',
        chipColor: T.danger,
      }
      : null;
  const columnSummaryCards = [
    {
      key: 'new',
      title: 'New engineered columns',
      helper: 'Fresh business-ready columns created by the current plan.',
      empty: 'No new engineered columns in this preview.',
      items: newCols,
      buttonLabel: 'View all engineered columns',
      chipBg: '#dcfce7',
      chipColor: '#166534',
      borderColor: T.doneBorder,
      bg: T.doneBg,
    },
    {
      key: 'removed',
      title: 'Dropped columns',
      helper: 'Columns removed by governance, cleanup, or preprocessing logic.',
      empty: 'No columns are being dropped in this preview.',
      items: removedCols,
      buttonLabel: 'View all dropped columns',
      chipBg: '#fee2e2',
      chipColor: T.danger,
      borderColor: T.dangerBorder,
      bg: T.dangerBg,
    },
  ].filter((card) => card.items.length > 0);

  if (!steps.length) return (
    <Alert severity="info" icon={<TableChart />} sx={{ borderRadius: 2 }}>
      Add at least one step from the Plan, Engineer, or Select tabs, then preview the transformation here.
    </Alert>
  );

  return (
    <Stack spacing={2.5}>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Transformation Preview</Typography>
            <Typography variant="caption" color="text.secondary">
              Runs {steps.length} step{steps.length > 1 ? 's' : ''} on 25 sample rows.
              Full {fmt(masterDataset?.row_count)}-row run happens in the Run tab.
            </Typography>
          </Box>
          <OBtn
            icon={loading ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <TableChart sx={{ fontSize: 14 }} />}
            onClick={run} disabled={canDisable(loading)}>
            {loading ? 'Running…' : 'Run Preview'}
          </OBtn>
        </Stack>
      </Card>

      {err && <Alert severity="error" sx={{ borderRadius: 2 }}>{err}</Alert>}
      {loading && <Spinner label="Applying pipeline to 25 rows. If this takes more than 12 seconds, the request will stop and the Flask console will show the active stage." />}

      {pv && !loading && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
            {[
              { k: 'Columns before', v: fmt(beforeCols.length),  color: T.textPri },
              { k: 'Columns after',  v: fmt(afterCols.length),   color: afterCols.length !== beforeCols.length ? T.orange : T.textPri },
              { k: 'New features',   v: `+${newCols.length}`,     color: newCols.length > 0 ? T.done : T.textDim },
              { k: 'Dropped',        v: `-${removedCols.length}`, color: removedCols.length > 0 ? T.danger : T.textDim },
            ].map(({ k, v, color }) => (
              <Box key={k} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>{k}</Typography>
                <Typography sx={{ fontWeight: 800, fontSize: 22, color, lineHeight: 1.1 }}>{v}</Typography>
              </Box>
            ))}
          </Box>

          <Alert severity="info" sx={{ borderRadius: 1.5 }}>
            Use this preview to confirm the current run order before the full preprocessing run. A safe AML pattern is: clean obvious data issues first, create business features next, then encode model-only fields, and keep final feature selection as the last pruning step.
          </Alert>

          {!!columnSummaryCards.length && (
            <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
              {columnSummaryCards.map((card) => (
                <Card key={card.key} sx={{ bgcolor: card.bg, borderColor: card.borderColor }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box>
                      <SLabel>{card.title}</SLabel>
                      <Typography sx={{ fontSize: 11, color: T.textSec, mt: 0.4, lineHeight: 1.65 }}>
                        {card.helper}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setColumnDialog(card.key)}
                      sx={{ textTransform: 'none', borderRadius: 1.25, borderColor: T.border, color: T.textPri, fontWeight: 700 }}
                    >
                      {card.buttonLabel} ({card.items.length})
                    </Button>
                  </Stack>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 1 }}>
                    {card.items.slice(0, 14).map((c) => (
                      <Chip
                        key={`${card.key}-${c}`}
                        label={c}
                        size="small"
                        sx={{ fontFamily: 'monospace', fontSize: 9.5, bgcolor: card.chipBg, color: card.chipColor }}
                      />
                    ))}
                    {card.items.length > 14 && (
                      <Chip
                        label={`+${card.items.length - 14} more`}
                        size="small"
                        sx={{ fontSize: 9.5, bgcolor: 'white', border: `1px solid ${T.border}`, color: T.textSec }}
                      />
                    )}
                  </Box>
                </Card>
              ))}
            </Box>
          )}

          {rows.length > 0 && (
            <Card>
              <SLabel>Sample - {rows.length} rows × {afterCols.length} columns (first 18 shown)</SLabel>
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                      {afterCols.slice(0, 18).map(c => (
                        <th key={c} style={{
                          padding: '5px 10px', textAlign: 'left', whiteSpace: 'nowrap',
                          color:      newCols.includes(c) ? T.done : T.textSec,
                          fontWeight: newCols.includes(c) ? 700 : 600,
                          fontFamily: 'monospace', fontSize: 10,
                          background: newCols.includes(c) ? T.doneBg : 'white',
                        }}>
                          {clip(c, 18)}{newCols.includes(c) ? ' *' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 12).map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? T.surface : 'white', borderBottom: `1px solid ${T.border}` }}>
                        {afterCols.slice(0, 18).map(c => (
                          <td key={c} style={{
                            padding: '4px 10px', fontFamily: 'monospace', fontSize: 10,
                            color:      newCols.includes(c) ? '#166534' : T.textPri,
                            fontWeight: newCols.includes(c) ? 600 : 400,
                          }}>
                            {row[c] == null
                              ? <span style={{ color: '#cbd5e1' }}>null</span>
                              : String(row[c]).slice(0, 20)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {afterCols.length > 18 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontSize: 10 }}>
                    + {afterCols.length - 18} more columns not shown. All saved on full run.
                  </Typography>
                )}
              </Box>
            </Card>
          )}
        </>
      )}

      {!pv && !loading && !err && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <TableChart sx={{ fontSize: 44, color: '#e2e8f0', mb: 1.5 }} />
          <Typography color="text.secondary">Click "Run Preview" to see the transformation output</Typography>
        </Box>
      )}

      <Divider />

      <PreprocessingBeforeAfter
        masterDataset={masterDataset}
        preprocessedDataset={preprocessedDataset}
        preview={pv}
        persona={persona}
      />

      <Dialog open={Boolean(columnDialogConfig)} onClose={() => setColumnDialog(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800, borderBottom: `1px solid ${T.border}` }}>
          {columnDialogConfig?.title || 'Columns'}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 2 }}>
          {columnDialogConfig?.subtitle && (
            <Typography sx={{ fontSize: 12, color: T.textSec, lineHeight: 1.7, mb: 1.5 }}>
              {columnDialogConfig.subtitle}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7 }}>
            {(columnDialogConfig?.items || []).map((column) => (
              <Chip
                key={`${columnDialog}-${column}`}
                label={column}
                size="small"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  bgcolor: columnDialogConfig?.chipBg || 'white',
                  color: columnDialogConfig?.chipColor || T.textPri,
                }}
              />
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 - RUN
// ═══════════════════════════════════════════════════════════════════════════════
const RunTab = ({ masterDataset, steps, targetColumn, preview, onRun, onComplete, activePipelineId = null }) => {
  const [outputName, setOutputName] = useState('preprocessed_dataset');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const [tracePayload, setTracePayload] = useState(null);
  const [activeStage, setActiveStage] = useState('');
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const laneMeta = {
    clean:  { label: 'Cleaning', bg: T.bgClean, border: '#bfdbfe' },
    encode: { label: 'Encoding', bg: T.bgEncode, border: '#bbf7d0' },
    scale:  { label: 'Scaling', bg: T.bgScale, border: '#ddd6fe' },
    feat:   { label: 'Feature Engineering', bg: T.bgFeat, border: '#fed7aa' },
    select: { label: 'Selection / Drop', bg: T.dangerBg, border: '#fecdd3' },
  };

  const inferAffectedColumns = useCallback((stepLike) => {
    const cols = [];
    (stepLike?.columns || []).forEach((col) => {
      if (typeof col === 'string' && col) cols.push(col);
    });
    (stepLike?.pairs || []).forEach((pair) => {
      if (!pair || typeof pair !== 'object') return;
      ['a', 'b'].forEach((key) => {
        const value = pair[key];
        if (typeof value === 'string' && value) cols.push(value);
      });
    });
    ['group_by', 'target'].forEach((key) => {
      const value = stepLike?.[key];
      if (typeof value === 'string' && value) cols.push(value);
    });
    return Array.from(new Set(cols));
  }, []);

  const readTrace = useCallback((payloadLike) => {
    const root = payloadLike?.data || payloadLike;
    const trace = root?.trace || root?.output?.trace || null;
    if (!trace || !Array.isArray(trace?.steps) || trace.steps.length === 0) return null;
    return trace;
  }, []);

  const hasAppliedTrace = useMemo(() => (
    Array.isArray(tracePayload?.steps) && tracePayload.steps.some((s) => s?.status === 'applied')
  ), [tracePayload]);
  const plannedTraceSteps = useMemo(
    () => steps.map((s, i) => {
      const affected = inferAffectedColumns(s);
      return {
        step_index: i + 1,
        step_type: String(s?.type || ''),
        label: stepMeta(s?.type).label,
        category: stepMeta(s?.type).cat,
        status: 'planned',
        affected_columns: affected,
        affected_columns_count: affected.length,
        before_rows: null,
        after_rows: null,
        row_delta: null,
        before_columns_count: null,
        after_columns_count: null,
        col_delta: null,
        added_columns_count: null,
        dropped_columns_count: null,
        added_columns_sample: [],
        dropped_columns_sample: [],
        notes: s?.strategy ? [`strategy=${s.strategy}`] : [],
        runtime_hint: stepRuntimeHint(s?.type),
      };
    }),
    [inferAffectedColumns, steps],
  );

  useEffect(() => {
    setTracePayload(null);
    setActiveStage('');
    setRunStartedAt(null);
    setElapsedSeconds(0);
  }, [masterDataset?.dataset_id, steps, targetColumn]);

  useEffect(() => {
    if (!running || !runStartedAt) return undefined;
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [runStartedAt, running]);

  useEffect(() => {
    const previewTrace = readTrace(preview);
    if (previewTrace && !hasAppliedTrace) {
      setTracePayload(previewTrace);
    }
  }, [hasAppliedTrace, preview, readTrace]);

  const traceSteps = useMemo(() => {
    const fromApi = tracePayload?.steps;
    return Array.isArray(fromApi) && fromApi.length ? fromApi : plannedTraceSteps;
  }, [tracePayload, plannedTraceSteps]);

  const laneOrder = useMemo(() => ['clean', 'encode', 'scale', 'feat', 'select'], []);

  const laneSteps = useMemo(() => {
    const grouped = { clean: [], encode: [], scale: [], feat: [], select: [] };
    traceSteps.forEach((step) => {
      const type = step?.step_type || step?.type || '';
      const fallbackCat = stepMeta(type).cat;
      const cat = laneMeta[step?.category] ? step.category : fallbackCat;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(step);
    });
    return grouped;
  }, [traceSteps]);

  const traceSummary = useMemo(() => {
    if (tracePayload?.summary) return tracePayload.summary;
    const inputRows = Number(masterDataset?.row_count ?? 0);
    const inputColumns = Array.isArray(masterDataset?.columns)
      ? masterDataset.columns.length
      : Number(masterDataset?.column_count || 0);
    const outputRows = Number(done?.row_count ?? inputRows);
    const outputColumns = Array.isArray(done?.columns) ? done.columns.length : null;
    return {
      input_rows: inputRows,
      output_rows: outputRows,
      row_delta: outputRows - inputRows,
      input_columns: inputColumns || null,
      output_columns: outputColumns,
      column_delta: inputColumns && outputColumns != null ? outputColumns - inputColumns : null,
      total_steps: steps.length,
      applied_steps: done ? steps.length : 0,
      categories: [],
    };
  }, [done, masterDataset, steps.length, tracePayload]);

  const categorySummary = useMemo(() => {
    if (Array.isArray(tracePayload?.summary?.categories) && tracePayload.summary.categories.length) {
      return tracePayload.summary.categories;
    }
    return laneOrder
      .map((cat) => {
        const items = laneSteps[cat] || [];
        if (!items.length) return null;
        const hasMeasured = items.some((s) => (
          s?.status === 'applied'
          || s?.before_columns_count != null
          || s?.after_columns_count != null
          || s?.added_columns_count != null
          || s?.dropped_columns_count != null
        ));
        return {
          category: cat,
          label: laneMeta[cat]?.label || cat,
          steps: items.length,
          applied_steps: items.filter((s) => s?.status === 'applied').length,
          added_columns: hasMeasured ? items.reduce((acc, s) => acc + Number(s?.added_columns_count || 0), 0) : null,
          dropped_columns: hasMeasured ? items.reduce((acc, s) => acc + Number(s?.dropped_columns_count || 0), 0) : null,
        };
      })
      .filter(Boolean);
  }, [laneMeta, laneOrder, laneSteps, tracePayload]);

  const visibleLanes = useMemo(
    () => laneOrder.filter((cat) => (laneSteps[cat] || []).length > 0),
    [laneOrder, laneSteps],
  );

  const stageCards = useMemo(() => {
    const cats = (visibleLanes.length ? visibleLanes : laneOrder);
    return cats.map((cat) => {
      const items = laneSteps[cat] || [];
      const first = items[0] || {};
      const last = items[items.length - 1] || {};
      const hasMeasuredStats = items.some((s) => (
        s?.status === 'applied'
        || s?.before_columns_count != null
        || s?.after_columns_count != null
        || s?.added_columns_count != null
        || s?.dropped_columns_count != null
      ));
      const affectedSet = new Set();
      items.forEach((step) => {
        const cols = Array.isArray(step?.affected_columns) && step.affected_columns.length
          ? step.affected_columns
          : inferAffectedColumns(step);
        cols.forEach((col) => affectedSet.add(String(col)));
      });
      const addedColumnsRaw = items.reduce((acc, s) => acc + Number(s?.added_columns_count || 0), 0);
      const droppedColumnsRaw = items.reduce((acc, s) => acc + Number(s?.dropped_columns_count || 0), 0);
      const addedColumns = hasMeasuredStats ? addedColumnsRaw : null;
      const droppedColumns = hasMeasuredStats ? droppedColumnsRaw : null;
      const beforeCols = first?.before_columns_count ?? null;
      const afterCols = last?.after_columns_count ?? null;
      const colDelta = (beforeCols != null && afterCols != null)
        ? (Number(afterCols) - Number(beforeCols))
        : (hasMeasuredStats ? (addedColumnsRaw - droppedColumnsRaw) : null);
      return {
        category: cat,
        label: laneMeta[cat]?.label || cat,
        steps: items.length,
        appliedSteps: items.filter((s) => s?.status === 'applied').length,
        addedColumns,
        droppedColumns,
        beforeCols,
        afterCols,
        colDelta,
        affectedColumns: Array.from(affectedSet),
      };
    });
  }, [inferAffectedColumns, laneMeta, laneOrder, laneSteps, visibleLanes]);

  const activeStageSteps = useMemo(
    () => (activeStage ? (laneSteps[activeStage] || []) : []),
    [activeStage, laneSteps],
  );

  const fmtDelta = (value) => {
    if (value == null || Number.isNaN(Number(value))) return '-';
    const n = Number(value);
    return `${n > 0 ? '+' : ''}${n.toLocaleString()}`;
  };

  const fmtTransition = (before, after) => {
    if (before == null && after == null) return 'n/a';
    return `${fmt(before)} -> ${fmt(after)}`;
  };

  const fmtAddDrop = (added, dropped) => {
    if (added == null && dropped == null) return 'n/a';
    return `+${fmt(added || 0)} / -${fmt(dropped || 0)}`;
  };

  const executionLedgerRows = useMemo(
    () => traceSteps.map((step, idx) => {
      const meta = stepMeta(step?.step_type || step?.type || '');
      const affected = Array.isArray(step?.affected_columns) && step.affected_columns.length
        ? step.affected_columns
        : inferAffectedColumns(step);
      const runtime = step?.runtime_hint || stepRuntimeHint(step?.step_type || step?.type || '');
      const durationText = step?.duration_label
        || (step?.duration_ms != null
          ? (Number(step.duration_ms) >= 1000 ? `${(Number(step.duration_ms) / 1000).toFixed(2)}s` : `${Math.round(Number(step.duration_ms))}ms`)
          : '');
      return {
        stage: laneMeta[step?.category]?.label || laneMeta[meta.cat]?.label || 'Transformation',
        label: step?.label || meta.label,
        status: step?.status === 'applied' ? 'Applied' : (step?.status || 'Planned'),
        index: step?.step_index || idx + 1,
        runtime,
        speedText: durationText ? `${durationText} actual` : `${runtime.tier} (${runtime.estimate})`,
        affectedText: affected.length ? affected.join(', ') : '-',
        notesText: Array.isArray(step?.notes) && step.notes.length ? step.notes.join(' | ') : '-',
      };
    }),
    [inferAffectedColumns, laneMeta, traceSteps],
  );

  const slowExecutionRows = useMemo(
    () => executionLedgerRows.filter((row) => ['Can be slow', 'Medium'].includes(row?.runtime?.tier)).slice(0, 4),
    [executionLedgerRows],
  );

  const runningLogRows = useMemo(
    () => executionLedgerRows.map((row) => ({
      ...row,
      message: `${row.label} | ${row.speedText} | ${row.affectedText === '-' ? 'all relevant columns' : clip(row.affectedText, 70)}`,
    })),
    [executionLedgerRows],
  );

  const run = async () => {
    if (!masterDataset?.dataset_id || !steps.length) return;
    setRunning(true);
    const started = Date.now();
    setRunStartedAt(started);
    setElapsedSeconds(0);
    setDone(null);
    setErr(null);
    setTracePayload(null);
    try {
      const payload = {
        dataset_id: masterDataset.dataset_id,
        steps,
        output_name: outputName,
      };
      if (activePipelineId) payload.pipeline_id = activePipelineId;
      if (targetColumn) payload.target_column = targetColumn;
      let result = null;
      if (onRun) {
        result = await onRun(outputName, steps);
      } else {
        const res = await mlopsApi.preprocessRun(payload);
        result = res?.data || res;
      }
      if (!result) throw new Error('Preprocessing run returned no result.');
      const ds = result?.dataset || result;
      const trace = result?.output?.trace || result?.trace || null;
      setTracePayload(trace);
      setDone(ds);
      if (onComplete) onComplete(ds);
    } catch (e) {
      setErr(e?.message || 'Pipeline failed');
    } finally {
      setRunning(false);
    }
  };

  const runDisabled = (typeof canDisable === 'function')
    ? canDisable(running || !steps.length)
    : (running || !steps.length);

  if (!steps.length) return (
    <Alert severity="warning" icon={<Warning />} sx={{ borderRadius: 0 }}>
      No steps added. Add cleaning, engineering, or selection steps before running.
    </Alert>
  );

  return (
    <Stack spacing={2.5}>
      <Card accent={done ? 'green' : 'orange'}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
          {done
            ? <CheckCircle sx={{ fontSize: 22, color: T.done }} />
            : <PlayArrow sx={{ fontSize: 22, color: T.orange }} />}
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
            {done ? 'Pipeline Complete' : 'Ready to Execute'}
          </Typography>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1 }}>
          <Box sx={{ p: 1.5, borderRadius: 0, bgcolor: 'white', border: `1px solid ${T.accentBorder}`, borderTop: `2px solid ${T.orange}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Total steps</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 24, color: T.orange, lineHeight: 1.1 }}>{fmt(traceSummary?.total_steps || steps.length)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 0, bgcolor: 'white', border: `1px solid ${T.doneBorder}`, borderTop: `2px solid ${T.done}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Input rows</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 24, color: T.done, lineHeight: 1.1 }}>{fmt(traceSummary?.input_rows ?? masterDataset?.row_count)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 0, bgcolor: 'white', border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Input columns</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.input_columns)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 0, bgcolor: 'white', border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Output columns</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.output_columns)}</Typography>
            <Typography variant="caption" sx={{ color: T.textSec }}>delta {fmtDelta(traceSummary?.column_delta)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 0, bgcolor: 'white', border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Applied steps</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.applied_steps)}</Typography>
          </Box>
        </Box>
      </Card>

      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 1.4 }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: T.text }}>
              Execution Checklist
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: T.textSec, mt: 0.3 }}>
              Transformation ledger with execution status, runtime hints, and affected fields.
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${fmt(executionLedgerRows.length)} stage${executionLedgerRows.length === 1 ? '' : 's'}`}
            sx={{ height: 24, fontSize: 10.5, fontWeight: 700, bgcolor: T.surface, border: `1px solid ${T.border}` }}
          />
        </Stack>
        <Box
          sx={{
            overflowX: 'auto',
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            bgcolor: '#fff',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: 780 }}>
            <thead>
              <tr style={{ background: '#111827' }}>
                {['#', 'Stage', 'Transformation', 'Speed / duration', 'Status', 'Substeps / affected columns'].map((header) => (
                  <th
                    key={header}
                    style={{
                      padding: '10px 12px',
                      textAlign: 'left',
                      fontSize: 10.25,
                      fontWeight: 800,
                      color: '#ffffff',
                      textTransform: 'uppercase',
                      letterSpacing: 0.55,
                      borderBottom: `1px solid #111827`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {executionLedgerRows.map((row) => (
                <tr key={`ledger-${row.index}`} style={{ verticalAlign: 'top' }}>
                  <td style={{ padding: '11px 12px', fontFamily: 'monospace', color: T.textSec, width: 56, borderBottom: `1px solid ${T.border}` }}>{row.index}</td>
                  <td style={{ padding: '11px 12px', width: 150, borderBottom: `1px solid ${T.border}` }}>
                    <Box sx={{ display: 'inline-flex', px: 1, py: 0.35, borderRadius: 0, bgcolor: '#f8fafc', border: `1px solid ${T.border}` }}>
                      <Typography sx={{ fontSize: 11.25, fontWeight: 800, color: T.text }}>{row.stage}</Typography>
                    </Box>
                  </td>
                  <td style={{ padding: '11px 12px', width: 210, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text, lineHeight: 1.35 }}>{row.label}</Typography>
                  </td>
                  <td style={{ padding: '11px 12px', width: 150, borderBottom: `1px solid ${T.border}` }}>
                    <Chip
                      size="small"
                      label={row.speedText}
                      sx={{
                        height: 22,
                        fontSize: 10,
                        fontWeight: 800,
                        bgcolor: row.runtime?.bg || T.surface,
                        color: row.runtime?.color || T.textSec,
                        border: `1px solid ${T.border}`,
                      }}
                    />
                  </td>
                  <td style={{ padding: '11px 12px', width: 110, borderBottom: `1px solid ${T.border}` }}>
                    <Chip
                      size="small"
                      label={row.status}
                      sx={{
                        height: 22,
                        fontSize: 10,
                        fontWeight: 800,
                        bgcolor: row.status === 'Applied' ? T.doneBg : T.surface,
                        color: row.status === 'Applied' ? T.done : T.textSec,
                        border: `1px solid ${row.status === 'Applied' ? T.doneBorder : T.border}`,
                      }}
                    />
                  </td>
                  <td style={{ padding: '11px 12px', minWidth: 320, borderBottom: `1px solid ${T.border}` }}>
                    <Typography sx={{ fontSize: 11.25, color: T.text, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.6 }}>
                      {row.affectedText}
                    </Typography>
                    {row.notesText !== '-' && (
                      <Typography sx={{ fontSize: 10.75, color: T.textSec, mt: 0.55, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.55 }}>
                        {row.notesText}
                      </Typography>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Card>

      <Card>
        <SLabel>Logical Preprocessing Diagram</SLabel>
        <Box
          sx={{
            maxHeight: 320,
            overflow: 'auto',
            pr: 0.75,
            overscrollBehavior: 'contain',
            '&::-webkit-scrollbar': { width: 8, height: 8 },
            '&::-webkit-scrollbar-thumb': { background: '#cbd5e1', borderRadius: 0 },
            '&::-webkit-scrollbar-track': { background: '#f8fafc' },
          }}
        >
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', xl: '220px 1fr 220px' },
            gap: 1.25,
            alignItems: 'start',
          }}>
            <Box sx={{ p: 1.25, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 12, mb: 0.4 }}>Input Dataset</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{masterDataset?.dataset_type || 'master_dataset'}</Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10.5 }}>
                {fmt(traceSummary?.input_rows ?? masterDataset?.row_count)} rows
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10.5, display: 'block' }}>
                {fmt(traceSummary?.input_columns)} cols
              </Typography>
            </Box>

            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
              gap: 1,
            }}>
              {stageCards.map((stage) => (
                <Box
                  key={stage.category}
                  sx={{
                    border: `1px solid ${laneMeta[stage.category]?.border || T.border}`,
                    borderRadius: 0,
                    bgcolor: 'white',
                    p: 1,
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>{stage.label}</Typography>
                    <Chip
                      size="small"
                      label={`${stage.steps} step${stage.steps > 1 ? 's' : ''}`}
                      sx={{ height: 18, fontSize: 9, bgcolor: 'white', border: `1px solid ${T.border}` }}
                    />
                  </Stack>

                  <Typography variant="caption" sx={{ display: 'block', color: T.textSec, fontFamily: 'monospace', fontSize: 9.5 }}>
                    cols: {fmtTransition(stage.beforeCols, stage.afterCols)} (delta {fmtDelta(stage.colDelta)})
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: T.textSec, fontFamily: 'monospace', fontSize: 9.5 }}>
                    {fmtAddDrop(stage.addedColumns, stage.droppedColumns)} columns
                  </Typography>

                  {stage.affectedColumns.length > 0 && (
                    <Stack direction="row" spacing={0.4} sx={{ flexWrap: 'wrap', rowGap: 0.4, my: 0.6 }}>
                      {stage.affectedColumns.slice(0, 4).map((col) => (
                        <Chip key={`${stage.category}-${col}`} size="small" label={clip(col, 14)} sx={{ height: 16, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                      ))}
                      {stage.affectedColumns.length > 4 && (
                        <Chip size="small" label={`+${stage.affectedColumns.length - 4} more`} sx={{ height: 16, fontSize: 8.5, bgcolor: 'white', border: `1px solid ${T.border}`, borderRadius: 0 }} />
                      )}
                    </Stack>
                  )}

                  <OBtn
                    variant="outlined"
                    icon={<TableChart sx={{ fontSize: 13 }} />}
                    onClick={() => setActiveStage(stage.category)}
                    sx={{ mt: 0.4, height: 26, fontSize: 10.5, px: 1.2 }}
                  >
                    View steps
                  </OBtn>
                </Box>
              ))}
            </Box>

            <Box sx={{ p: 1.25, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: '#f8fafc' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 12, mb: 0.4 }}>Output Dataset</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {done?.dataset_type || outputName}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10.5 }}>
                {fmt(traceSummary?.output_rows)} rows
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10.5, display: 'block' }}>
                {fmt(traceSummary?.output_columns)} cols
              </Typography>
              <Typography variant="caption" sx={{ color: T.textSec, fontSize: 10 }}>
                Column delta: {fmtDelta(traceSummary?.column_delta)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Card>

      <Dialog open={Boolean(activeStage)} onClose={() => setActiveStage('')} fullWidth maxWidth="lg">
        <DialogTitle sx={{ fontSize: 14, fontWeight: 700 }}>
          {laneMeta[activeStage]?.label || 'Stage'} transformations
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['#', 'Transformation', 'Status', 'Affected columns'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontSize: 10,
                        fontWeight: 700,
                        color: T.textSec,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeStageSteps.map((step, idx) => {
                  const meta = stepMeta(step?.step_type || step?.type || '');
                  const affected = Array.isArray(step?.affected_columns) && step.affected_columns.length
                    ? step.affected_columns
                    : inferAffectedColumns(step);
                  return (
                    <tr key={`${activeStage}-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: T.textSec }}>{step?.step_index || idx + 1}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{step?.label || meta.label}</Typography>
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <Chip
                          size="small"
                          label={step?.status === 'applied' ? 'Applied' : (step?.status || 'Planned')}
                          sx={{ height: 18, fontSize: 9, bgcolor: step?.status === 'applied' ? T.doneBg : T.surface }}
                        />
                      </td>
                      <td style={{ padding: '7px 10px', minWidth: 260 }}>
                        <Typography sx={{ fontSize: 11, color: T.textSec }}>
                          <Box
                            component="span"
                            sx={{
                              display: 'block',
                              maxHeight: 58,
                              overflowY: 'auto',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.55,
                              pr: 0.5,
                              '&::-webkit-scrollbar': { width: 6 },
                              '&::-webkit-scrollbar-thumb': { background: '#cbd5e1', borderRadius: 0 },
                            }}
                          >
                            {affected.slice(0, 8).join(', ') || '-'}{affected.length > 8 ? ` +${affected.length - 8} more` : ''}
                          </Box>
                        </Typography>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        </DialogContent>
      </Dialog>

      <Card>
        <SLabel>Transformation Impact By Category</SLabel>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1 }}>
          {categorySummary.map((cat) => (
            <Box key={cat.category} sx={{ p: 1.2, borderRadius: 0, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>{cat.label}</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: T.textSec }}>
                steps: {fmt(cat.steps)} | applied: {fmt(cat.applied_steps)}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: T.textSec }}>
                {cat.added_columns == null && cat.dropped_columns == null
                  ? 'column impact: n/a'
                  : `+cols: ${fmt(cat.added_columns)} | -cols: ${fmt(cat.dropped_columns)}`}
              </Typography>
            </Box>
          ))}
        </Box>
      </Card>

      {!done && (
        <>
          <Card>
            <SLabel>Output dataset name</SLabel>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                size="small"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase())}
                sx={{ flex: 1, '& input': { fontFamily: 'monospace', fontSize: 13 } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Registered as preprocessed_dataset. Available in Step 6 (Model Training).
              </Typography>
            </Stack>
          </Card>

          <Box sx={{ textAlign: 'center', py: 1 }}>
            <Button
              variant="contained"
              size="large"
              onClick={run}
              disabled={runDisabled}
              startIcon={running ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <PlayArrow sx={{ fontSize: 22 }} />}
              sx={{
                bgcolor: T.orange,
                '&:hover': { bgcolor: T.orangeHov },
                '&.Mui-disabled': { bgcolor: '#fed7b8', color: 'white' },
                px: 5,
                py: 1.5,
                fontSize: 15.5,
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: 0,
                boxShadow: 'none',
              }}
            >
              {running ? 'Running pipeline...' : `Run ${steps.length}-step pipeline`}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Full run applies the selected preprocessing steps to {fmt(masterDataset?.row_count)} rows and saves the model-ready output.
            </Typography>
          </Box>
        </>
      )}

      {running && (
        <Card accent="orange" sx={{ bgcolor: '#0f172a', color: '#e5e7eb' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between" sx={{ mb: 1.2 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} sx={{ color: T.orange }} />
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
                  Executing preprocessing pipeline ({steps.length} steps)
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: '#cbd5e1' }}>
                  Elapsed {fmtDuration(elapsedSeconds)}. The backend is applying the full run to {fmt(masterDataset?.row_count)} master rows.
                </Typography>
              </Box>
            </Stack>
            {!!slowExecutionRows.length && (
              <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                {slowExecutionRows.map((row) => (
                  <Chip
                    key={`slow-${row.index}`}
                    label={`${row.label}: ${row.runtime?.tier}`}
                    size="small"
                    sx={{ bgcolor: row.runtime?.bg || T.warnBg, color: row.runtime?.color || T.warn, fontWeight: 800 }}
                  />
                ))}
              </Stack>
            )}
          </Stack>
          <Box sx={{ border: '1px solid #334155', bgcolor: '#020617', maxHeight: 210, overflow: 'auto', p: 1, fontFamily: 'monospace' }}>
            {runningLogRows.map((row) => (
              <Box key={`run-log-${row.index}`} sx={{ display: 'grid', gridTemplateColumns: '42px 96px 1fr', gap: 1, py: 0.35, borderBottom: '1px solid rgba(148, 163, 184, 0.15)' }}>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
                  #{row.index}
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: row.runtime?.color || '#cbd5e1', fontWeight: 800 }}>
                  {row.runtime?.tier || 'Step'}
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                  {row.message}
                </Typography>
              </Box>
            ))}
            <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: '#fbbf24', mt: 0.8 }}>
              [{fmtDuration(elapsedSeconds)}] Waiting for backend trace. Actual per-step durations will appear in the checklist after completion.
            </Typography>
          </Box>
        </Card>
      )}

      {done && !err && (
        <Card accent="green" sx={{ bgcolor: T.doneBg }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <CheckCircle sx={{ fontSize: 42, color: T.done }} />
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 16, color: '#166534', mb: 0.3 }}>
                Dataset ready for modelling
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{done.dataset_type || outputName}</strong> saved | {fmt(done.row_count)} rows | {fmt((done.columns || []).length)} columns.
                Proceed to Step 6 to train your model.
              </Typography>
            </Box>
          </Stack>
        </Card>
      )}

      {err && <Alert severity="error" icon={<Warning />} sx={{ borderRadius: 0 }}>{err}</Alert>}
    </Stack>
  );
};

const PreprocessingWorkbench = ({
  suggestions    = [],
  steps          = [],
  onStepsChange,
  onPreview,
  onRun,
  preview,
  onMasterBuild,
  datasets       = [],
  masterDataset  = null,
  preprocessedDataset = null,
  targetColumn   = '',
  persona        = 'technical',
  onComplete,
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
  pipelineVariant = 'fcc',
}) => {
  const isMuleVariant = String(pipelineVariant || 'fcc').trim().toLowerCase() === 'mule';
  const [tab, setTab] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([0]));

  useEffect(() => {
    setVisitedTabs((prev) => {
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  const activeGuideMap = isMuleVariant ? MULE_PREPROCESS_TAB_GUIDES : PREPROCESS_TAB_GUIDES;
  const activeGuide = activeGuideMap[tab] || activeGuideMap[4] || activeGuideMap[0];
  const completedTabIndexes = useMemo(() => {
    const done = new Set();
    if (visitedTabs.has(0) || (Array.isArray(steps) && steps.length)) {
      done.add(0);
    }
    const hasBuilderWork = (steps || []).some((step) => {
      const type = String(step?.type || '').toLowerCase();
      return Boolean(type) && !type.startsWith('feature_') && !['datetime_extract', 'text_features'].includes(type);
    });
    const hasEngineerWork = (steps || []).some((step) => String(step?.type || '').toLowerCase().startsWith('feature_') || ['datetime_extract', 'text_features'].includes(String(step?.type || '').toLowerCase()));
    if (visitedTabs.has(1) || hasBuilderWork) {
      done.add(1);
    }
    if (visitedTabs.has(2) || hasEngineerWork) {
      done.add(2);
    }
    if (visitedTabs.has(3) || (Array.isArray(steps) && steps.length > 0)) done.add(3);
    if (preprocessedDataset?.dataset_id) done.add(4);
    return done;
  }, [preprocessedDataset, steps, visitedTabs]);

  const removeStep = idx     => onStepsChange(steps.filter((_, i) => i !== idx));
  const moveStep   = (a, b) => {
    const arr = [...steps];
    [arr[a], arr[b]] = [arr[b], arr[a]];
    onStepsChange(arr);
  };

  
  // Tab definitions - MUI icons + labels, no emoji
  const TAB_DEFS = [
    { Icon: Build,      label: 'Plan',      biz: 'Fix Issues', tip: 'Auto-detected cleaning issues and grouped recommendations' },
    { Icon: Code,       label: 'Builder',   biz: 'Builder',    tip: 'Custom preprocessing workbench with column explorer' },
    { Icon: TrendingUp, label: 'Engineer',  biz: isMuleVariant ? 'Mule Signals' : 'Add Features', tip: isMuleVariant ? 'Mule signal templates + reusable feature engineering' : 'AML domain templates + reusable feature engineering' },
    { Icon: QueryStats, label: 'Governance', biz: 'Feature Review', tip: 'Governed feature approval, leakage blocking, timing checks, and redundancy review' },
    { Icon: PlayArrow,  label: 'Run',       biz: 'Run',         tip: 'Execute pipeline on full dataset' },
  ];

  useEffect(() => {
    if (tab >= TAB_DEFS.length) {
      setTab(TAB_DEFS.length - 1);
    }
  }, [tab, TAB_DEFS.length]);

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Main content ── */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ px: 2.5, pt: 2.2, pb: 1.6, borderBottom: `1px solid ${T.border}`, bgcolor: 'white', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10, color: T.textSec, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            How this stage works
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: T.textSec, mt: 0.45, maxWidth: 920, lineHeight: 1.7 }}>
            {activeGuide.subtitle}
          </Typography>
          <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 1.2, borderRadius: 0, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
            <Typography sx={{ fontSize: 12, color: T.textPri, lineHeight: 1.65 }}>
              {activeGuide.note}
            </Typography>
          </Alert>
        </Box>

        {/* Tab bar */}
        <Box sx={{ borderBottom: `1px solid ${T.border}`, bgcolor: 'white', flexShrink: 0 }}>
          <Tabs
            value={tab} onChange={(_, v) => setTab(v)}
            sx={{
              '& .MuiTab-root': {
                textTransform: 'none', fontSize: 13, minHeight: 46,
                px: 2.5, fontWeight: 500, color: T.textSec,
              },
              '& .Mui-selected': { color: `${T.orange} !important`, fontWeight: 700 },
              '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3, borderRadius: 0 },
            }}>
            {TAB_DEFS.map((t, i) => {
              const TIcon = t.Icon;
              return (
                <Tooltip key={i} title={t.tip} placement="bottom">
                  <Tab label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <TIcon sx={{ fontSize: 15 }} />
                      <span>{persona === 'business' ? t.biz : t.label}</span>
                      {completedTabIndexes.has(i) && (
                        <CheckCircle sx={{ fontSize: 13, color: T.done }} />
                      )}
                      {i === TAB_DEFS.length - 1 && steps.length > 0 && (
                        <Box sx={{ px: 0.75, py: 0.1, bgcolor: 'white', border: `1px solid ${tab === TAB_DEFS.length - 1 ? T.orange : T.accentBorder}`, borderRadius: 0 }}>
                          <Typography sx={{ fontSize: 9.5, color: T.orange, fontWeight: 700 }}>
                            {steps.length}
                          </Typography>
                        </Box>
                      )}
                    </Stack>
                  } />
                </Tooltip>
              );
            })}
          </Tabs>
        </Box>

        {/* Tab content */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            p: 2.5,
            pr: 1.75,
            '&::-webkit-scrollbar': { width: 8, height: 8 },
            '&::-webkit-scrollbar-thumb': { background: '#cbd5e1', borderRadius: 0 },
            '&::-webkit-scrollbar-track': { background: '#f8fafc' },
          }}
        >
          {tab === 0 && (
            <PlanTab
              masterDataset={masterDataset}
              suggestions={suggestions}
              steps={steps}
              onStepsChange={onStepsChange}
            />
          )}
          {tab === 1 && (
            <BuilderTab
              masterDataset={masterDataset}
              datasets={datasets}
              steps={steps}
              onStepsChange={onStepsChange}
              targetColumn={targetColumn}
            />
          )}
          {tab === 2 && (
            <EngineerTab
              masterDataset={masterDataset}
              steps={steps}
              onStepsChange={onStepsChange}
              targetColumn={targetColumn}
              onOpenBuilder={() => setTab(1)}
              pipelineVariant={pipelineVariant}
            />
          )}
          {tab === 3 && (
            <FeatureGovernanceWorkbench
              masterDataset={masterDataset}
              datasets={datasets}
              steps={steps}
              onStepsChange={onStepsChange}
              targetColumn={targetColumn}
              persona={persona}
            />
          )}
          {tab === 4 && (
            <RunTab
              masterDataset={masterDataset}
              steps={steps}
              targetColumn={targetColumn}
              preview={preview}
              onRun={onRun}
              onComplete={onComplete}
              activePipelineId={activePipelineId}
            />
          )}
        </Box>
      </Box>

      {/* ── Right sidebar ── */}
      <PipelineSidebar
        steps={steps}
        onRemove={removeStep}
        onMove={moveStep}
        onClear={() => onStepsChange([])}
        onLoad={loaded => onStepsChange(loaded || [])}
        onLoadState={(loaded) => {
          onStepsChange(loaded?.steps || []);
          if (Number.isInteger(loaded?.activeTab)) setTab(Math.min(Math.max(loaded.activeTab, 0), TAB_DEFS.length - 1));
          if (Array.isArray(loaded?.visitedTabs) && loaded.visitedTabs.length > 0) {
            setVisitedTabs(new Set(loaded.visitedTabs.filter((value) => Number.isInteger(value))));
          }
        }}
        masterDataset={masterDataset}
        preprocessedDataset={preprocessedDataset}
        activeTab={tab}
        visitedTabs={Array.from(visitedTabs)}
        activePipelineId={activePipelineId}
        activePipelineName={activePipelineName}
        onPipelineActivated={onPipelineActivated}
      />
    </Box>
  );
};

export default PreprocessingWorkbench;
