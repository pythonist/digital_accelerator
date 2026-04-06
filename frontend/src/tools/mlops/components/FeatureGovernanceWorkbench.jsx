import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoFixHigh,
  CheckCircle,
  Close,
  ErrorOutline,
  InfoOutlined,
  RuleFolder,
  WarningAmber,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import { unwrapApiPayload } from '../utils/preprocessingNormalization';

const T = {
  orange: '#D04A02',
  orangeLight: '#f8f4ef',
  border: '#d9e1ea',
  surface: '#ffffff',
  surfaceAlt: '#f7f8f9',
  text: '#0f172a',
  textMuted: '#64748b',
  success: '#166534',
  successBg: '#eef8f0',
  successBorder: '#cfe7d4',
  warn: '#b45309',
  warnBg: '#fff7ed',
  warnBorder: '#f5d0a6',
  danger: '#b91c1c',
  dangerBg: '#fff1f2',
  dangerBorder: '#fecdd3',
  info: '#1d4ed8',
  infoBg: '#eff6ff',
  weakBg: '#f1f5f9',
  weakBorder: '#cbd5e1',
};

const QUICK_TECHNIQUE_IDS = [
  'information_gain',
  'information_value',
  'chi_square',
  'ks_statistic',
  'roc_auc_univariate',
  'variance_threshold',
  'correlation_filter',
  'vif_multicollinearity',
];

const CORE_TECHNIQUES = [
  {
    id: 'information_gain',
    label: 'Information Gain',
    family: 'Signal strength',
    scope: 'score',
    roles: ['numeric', 'binary', 'categorical'],
    description: 'Best overall supervised ranking when a target exists.',
    useWhen: 'Use this first when you want one overall ranking of which approved-safe fields seem most useful against the target.',
    caution: 'A high score here does not approve a feature if leakage or timing checks fail.',
  },
  {
    id: 'chi_square',
    label: 'Chi-Square',
    family: 'Categorical test',
    scope: 'score',
    roles: ['categorical', 'binary'],
    description: 'Checks how strongly a categorical feature is linked to the target.',
    useWhen: 'Use this for categorical fields such as risk bands, flags, or grouped rule categories.',
    caution: 'Only meaningful for categorical features and still subject to leakage and alert-time checks.',
  },
  {
    id: 'information_value',
    label: 'Information Value',
    family: 'Scorecard',
    scope: 'score',
    roles: ['numeric', 'categorical', 'binary'],
    description: 'Measures separation strength in scorecard-style binary problems.',
    useWhen: 'Use this when you want an AML-friendly scorecard view of whether a feature separates positive and negative cases.',
    caution: 'Strong IV can still come from target-adjacent or post-outcome fields.',
  },
  {
    id: 'variance_threshold',
    label: 'Variance Threshold',
    family: 'Unsupervised filter',
    scope: 'filter',
    roles: ['numeric', 'binary'],
    description: 'Finds near-constant numeric features.',
    useWhen: 'Use this early to remove fields that barely change and add almost no usable signal.',
    caution: 'It only checks spread, not leakage or business validity.',
  },
  {
    id: 'correlation_filter',
    label: 'Correlation Filter',
    family: 'Redundancy filter',
    scope: 'filter',
    roles: ['numeric', 'binary'],
    description: 'Finds features that move almost the same way as another feature.',
    useWhen: 'Use this after ranking to drop duplicate numeric signals and keep the cleaner representative.',
    caution: 'Correlation does not prove leakage; it only shows duplication or overlap.',
  },
  {
    id: 'vif_multicollinearity',
    label: 'Variance Inflation Factor',
    family: 'Multicollinearity',
    scope: 'filter',
    roles: ['numeric', 'binary'],
    description: 'Checks whether a feature is overly explained by the rest.',
    useWhen: 'Use this when several numeric features seem to repeat one another and you want a more stable training set.',
    caution: 'VIF is a redundancy tool, not a target-signal tool.',
  },
  {
    id: 'ks_statistic',
    label: 'KS Statistic',
    family: 'Class separation',
    scope: 'score',
    roles: ['numeric', 'binary'],
    description: 'Measures how differently positive and negative distributions behave.',
    useWhen: 'Use this for numeric features when you want to see whether the two classes separate cleanly.',
    caution: 'Separation alone is not enough if the field is unavailable at scoring time.',
  },
  {
    id: 'roc_auc_univariate',
    label: 'Univariate ROC AUC',
    family: 'Ranking',
    scope: 'score',
    roles: ['numeric', 'binary'],
    description: 'Shows how well a single feature ranks the target by itself.',
    useWhen: 'Use this for a quick single-feature ranking quality check.',
    caution: 'Near-perfect univariate AUC is often a leakage warning sign in AML workflows.',
  },
];

const TECHNIQUE_MAP = Object.fromEntries(CORE_TECHNIQUES.map((tech) => [tech.id, tech]));
const TECHNIQUE_QUESTION_LABELS = {
  information_gain: 'How useful is this for spotting money laundering?',
  vif_multicollinearity: 'Is this column saying the same thing as another column?',
  chi_square: 'Does this pattern behave differently for real vs fake alerts?',
  permutation_importance: 'How much worse does the model get if we remove this?',
  shap_importance: 'How much does this push the model toward flagging an alert?',
  variance_threshold: 'Does this column actually change between customers?',
  fisher_score: 'Does this field separate suspicious and non-suspicious alerts clearly?',
  anova_f_score: 'Does this field vary across real and false alerts in a meaningful way?',
  point_biserial_abs: 'Does this numeric field move with the final alert outcome?',
  ks_statistic: 'Do the two alert groups show different value patterns here?',
  correlation_filter: 'Is this feature mostly duplicating another one?',
  pearson_abs: 'Does this field move in line with the final alert outcome?',
  spearman_abs: 'Does this field rise or fall consistently with the final alert outcome?',
  cramers_v: 'Is this categorical field strongly linked to the final alert outcome?',
};

const CONSENSUS_TIER_META = {
  gold: {
    label: 'Gold',
    businessLabel: 'Strong agreement',
    businessText: 'All selected techniques agreed this feature should stay in play.',
    technicalText: 'Supported by every selected technique.',
    bg: '#fff5d9',
    border: '#f5c451',
    color: '#8a5a00',
  },
  silver: {
    label: 'Silver',
    businessLabel: 'Good agreement',
    businessText: 'Several selected techniques supported this feature, but not every one.',
    technicalText: 'Supported by more than half of the selected techniques.',
    bg: '#eef3f8',
    border: '#c5d2de',
    color: '#385170',
  },
  bronze: {
    label: 'Bronze',
    businessLabel: 'Limited agreement',
    businessText: 'Only a few selected techniques supported this feature.',
    technicalText: 'Supported by one or a small minority of the selected techniques.',
    bg: '#fdf2e7',
    border: '#efc4a3',
    color: '#98562d',
  },
  out: {
    label: 'Out',
    businessLabel: 'No support',
    businessText: 'None of the selected techniques supported this feature.',
    technicalText: 'Supported by zero selected techniques.',
    bg: '#f8fafc',
    border: '#d9e1ea',
    color: '#475569',
  },
};

const consensusTierKey = (supportCount, techniqueCount) => {
  const total = Math.max(1, Number(techniqueCount) || 0);
  const support = Math.max(0, Number(supportCount) || 0);
  const silverFloor = Math.max(2, Math.ceil(total / 2));
  if (support >= total) return 'gold';
  if (support >= silverFloor) return 'silver';
  if (support > 0) return 'bronze';
  return 'out';
};

const DECISION_META = {
  approved: {
    label: 'Approved',
    shortLabel: 'Selected',
    bg: T.successBg,
    border: T.successBorder,
    color: T.success,
    helper: 'Safe operational feature',
  },
  needs_review: {
    label: 'Needs review',
    shortLabel: 'Review',
    bg: T.warnBg,
    border: T.warnBorder,
    color: T.warn,
    helper: 'Useful but still needs a human check',
  },
  blocked_leakage: {
    label: 'Leakage / target proxy blocked',
    shortLabel: 'Blocked',
    bg: T.dangerBg,
    border: T.dangerBorder,
    color: T.danger,
    helper: 'Too close to the answer',
  },
  blocked_post_outcome: {
    label: 'Post-outcome / future info blocked',
    shortLabel: 'Blocked',
    bg: '#fff7f7',
    border: '#f9c9c9',
    color: T.danger,
    helper: 'Known only later in the workflow',
  },
  weak_redundant: {
    label: 'Weak / redundant',
    shortLabel: 'Excluded',
    bg: T.weakBg,
    border: T.weakBorder,
    color: '#334155',
    helper: 'Adds little stable value',
  },
};

const BUCKETS = [
  {
    id: 'approved',
    title: 'Approved Operational Features',
    description: 'Operationally safe and ready to flow into training.',
  },
  {
    id: 'needs_review',
    title: 'Needs Review',
    description: 'Potentially useful, but still needs human confirmation.',
  },
  {
    id: 'blocked_leakage',
    title: 'Leakage / Target Proxy Blocked',
    description: 'Too close to the answer or derived from the outcome.',
  },
  {
    id: 'blocked_post_outcome',
    title: 'Post-Outcome / Future Information Blocked',
    description: 'Known only after analyst action, investigation, or later workflow events.',
  },
  {
    id: 'weak_redundant',
    title: 'Redundant / Weak Features',
    description: 'Repeats another signal or adds too little stable value.',
  },
];

const ScrollArea = ({ children, height = 320, sx = {} }) => (
  <Box
    sx={{
      minHeight: 0,
      maxHeight: height,
      overflowY: 'auto',
      overflowX: 'hidden',
      pr: 0.5,
      '&::-webkit-scrollbar': { width: 8, height: 8 },
      '&::-webkit-scrollbar-thumb': { background: '#cbd5e1', borderRadius: 999 },
      '&::-webkit-scrollbar-track': { background: '#f8fafc' },
      ...sx,
    }}>
    {children}
  </Box>
);

const SectionCard = ({ eyebrow, title, subtitle, action, children }) => (
  <Paper
    elevation={0}
    sx={{
      borderRadius: 2.25,
      border: `1px solid ${T.border}`,
      bgcolor: T.surface,
      overflow: 'hidden',
    }}>
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="flex-start"
      spacing={1.5}
      sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          {eyebrow}
        </Typography>
        <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.text }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.35 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  </Paper>
);

const safeLower = (value) => String(value || '').trim().toLowerCase();
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const pct = (value, digits = 0) => {
  const parsed = num(value);
  if (parsed == null) return '-';
  const normalized = parsed > 1 ? parsed : parsed * 100;
  return `${normalized.toFixed(digits)}%`;
};
const fmtScore = (value, digits = 4) => {
  const parsed = num(value);
  return parsed == null ? '-' : parsed.toFixed(digits);
};
const clip = (value, max = 42) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const humanize = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
const unique = (items = []) => Array.from(new Set(items.filter(Boolean)));
const toColumnName = (column) => {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object') return String(column.name || column.column || column.field || '').trim();
  return '';
};
const normalizeColumns = (columns = []) => (Array.isArray(columns) ? columns : [])
  .map((column) => toColumnName(column))
  .filter(Boolean);
const normalizeColumnTypes = (...sources) => {
  const merged = {};
  sources.forEach((source) => {
    const types = source?.column_types || {};
    Object.entries(types).forEach(([key, value]) => {
      if (key && value != null) merged[key] = value;
    });
    (Array.isArray(source?.columns) ? source.columns : []).forEach((column) => {
      if (column && typeof column === 'object') {
        const name = toColumnName(column);
        if (name) merged[name] = column.dtype || column.type || column.data_type || merged[name] || 'object';
      }
    });
  });
  return merged;
};
const inferRole = (dtype = 'object') => {
  const token = safeLower(dtype);
  if (token.includes('date') || token.includes('time')) return 'datetime';
  if (token.includes('bool')) return 'binary';
  if (
    token.includes('int')
    || token.includes('float')
    || token.includes('double')
    || token.includes('decimal')
    || token.includes('numeric')
    || token.includes('real')
  ) return 'numeric';
  return 'categorical';
};
const isLikelyId = (name = '') => {
  const token = safeLower(name);
  return (
    token.endsWith('_id')
    || token === 'id'
    || token.includes('account id')
    || token.includes('customer id')
    || token.includes('case id')
    || token.includes('alert id')
    || token.includes('txn id')
  );
};
const inferFeatureFamily = (name = '') => {
  const token = safeLower(name);
  if (token.includes('risk') || token.includes('kyc')) return 'Risk / KYC';
  if (token.includes('sar') || token.includes('str')) return 'SAR / STR';
  if (token.includes('txn') || token.includes('transaction') || token.includes('amount') || token.includes('balance')) return 'Transaction behavior';
  if (token.includes('rule') || token.includes('alert')) return 'Alert context';
  if (token.includes('customer') || token.includes('account')) return 'Customer / account';
  if (token.includes('case') || token.includes('analyst') || token.includes('docs') || token.includes('contact')) return 'Investigation workflow';
  return 'General';
};
const featureMeaning = (feature = '') => {
  const token = safeLower(feature);
  if (token.includes('risk') || token.includes('kyc')) return 'A customer, KYC, or compliance risk signal available around the alert.';
  if (token.includes('txn') || token.includes('transaction') || token.includes('amount') || token.includes('balance')) return 'A transaction behavior signal showing how money moved before the alert.';
  if (token.includes('rule') || token.includes('alert')) return 'An alert-context signal describing why this case entered review.';
  if (token.includes('case') || token.includes('analyst') || token.includes('docs') || token.includes('contact')) return 'An investigation-workflow signal that may only appear after analysts begin working the case.';
  if (token.includes('sar') || token.includes('str')) return 'A SAR / STR related field that is often dangerously close to the final outcome.';
  return 'A structured field that may help separate low-value alerts from riskier ones if it is safe at decision time.';
};
const inferSourceTable = (feature, datasets = [], masterDataset = null) => {
  const sources = Array.isArray(datasets) ? datasets : [];
  for (const dataset of sources) {
    const names = new Set(normalizeColumns(dataset?.columns));
    if (names.has(feature)) {
      return String(dataset?.name || dataset?.dataset_name || dataset?.table_name || 'Source table');
    }
  }
  return String(masterDataset?.name || masterDataset?.dataset_name || 'Master dataset');
};
const riskLevelFromProfile = (profile) => {
  if (
    profile?.direct_target_leakage
    || profile?.target_proxy_risk
    || profile?.post_outcome_risk
    || profile?.future_information_risk
    || profile?.analyst_action_risk
    || profile?.decision === 'blocked_leakage'
    || profile?.decision === 'blocked_post_outcome'
  ) return 'high';
  if (
    profile?.redundant_risk
    || profile?.weak_signal_risk
    || profile?.low_variance_risk
    || (num(profile?.vif) != null && Number(profile.vif) >= 5)
  ) return 'medium';
  return 'low';
};
const availabilityLabel = (profile, persona) => {
  if (profile?.available_at_decision_time === true) {
    return safeLower(persona) === 'technical' ? 'Available at alert decision time' : 'Known when the alert fires';
  }
  if (profile?.available_at_decision_time === false) {
    return safeLower(persona) === 'technical' ? 'Not available at alert decision time' : 'Known only later';
  }
  return safeLower(persona) === 'technical' ? 'Needs timing review' : 'Availability needs review';
};
const bucketDescription = (decision) => DECISION_META[decision]?.helper || 'Needs review';
const isBlockedDecision = (decision) => decision === 'blocked_leakage' || decision === 'blocked_post_outcome';
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const techniqueQuestionLabel = (technique) => (
  TECHNIQUE_QUESTION_LABELS[String(technique?.id || '')]
  || technique?.business_question
  || `What does ${String(technique?.label || 'this check').toLowerCase()} tell us?`
);

const businessStrengthLevel = (profile) => {
  const raw = clamp01(profile?.scoreNorm ?? profile?.primaryScore ?? (
    profile?.decision === 'approved' ? 0.82 : profile?.decision === 'needs_review' ? 0.56 : 0.24
  ));
  return Math.max(1, Math.min(5, Math.round(raw * 4) + 1));
};

const businessStrengthLabel = (level) => (
  level >= 5 ? 'Very strong'
    : level >= 4 ? 'Strong'
      : level >= 3 ? 'Useful'
        : level >= 2 ? 'Limited'
          : 'Weak'
);

const businessUniquenessLabel = (profile) => {
  const vifValue = num(profile?.vif);
  const corrValue = num(profile?.maxPartnerCorrelation);
  if (vifValue != null && vifValue >= 10) return 'Low uniqueness';
  if (corrValue != null && corrValue >= 0.9) return 'Low uniqueness';
  if (vifValue != null && vifValue >= 5) return 'Some overlap';
  if (corrValue != null && corrValue >= 0.75) return 'Some overlap';
  return 'Very unique';
};

const businessSafetyLabel = (profile) => {
  if (profile?.available_at_decision_time === true && profile?.leakageRisk === 'low') return 'Available when alert fires';
  if (profile?.available_at_decision_time === false) return 'Only known after investigation';
  return 'Needs confirmation';
};

const businessSafetyTone = (profile) => {
  if (profile?.available_at_decision_time === true && profile?.leakageRisk === 'low') return DECISION_META.approved;
  if (profile?.available_at_decision_time === false) return DECISION_META.blocked_post_outcome;
  return DECISION_META.needs_review;
};

const whatHighValuesMean = (feature = '') => {
  const token = safeLower(feature);
  if (token.includes('cash')) return 'Higher values mean more of the customer or account activity is concentrated in cash movement.';
  if (token.includes('ratio') || token.includes('rate') || token.includes('pct') || token.includes('percent')) return 'Higher values mean this pattern is happening more often or takes a larger share of activity.';
  if (token.includes('count') || token.includes('volume') || token.includes('frequency') || token.includes('txn')) return 'Higher values mean more events or transactions happened in the review window.';
  if (token.includes('amount') || token.includes('balance')) return 'Higher values mean larger money movement or balance exposure was present around the alert.';
  if (token.includes('risk') || token.includes('score')) return 'Higher values mean the customer, account, or alert looked riskier before investigation began.';
  if (token.includes('flag') || token.includes('pep') || token.includes('adverse') || token.includes('sanction')) return 'A high value means the customer matched that risk flag or screening signal.';
  if (token.includes('days') || token.includes('age') || token.includes('tenure')) return 'Higher values mean the condition lasted longer or the customer relationship is more established.';
  return 'Higher values mean more of the underlying behaviour or condition captured by this field.';
};

const amlRelevance = (feature = '') => {
  const token = safeLower(feature);
  if (token.includes('cash')) return 'Cash-heavy behaviour is a common AML concern because it is harder to trace and often appears in structuring and layering patterns.';
  if (token.includes('risk') || token.includes('pep') || token.includes('adverse') || token.includes('sanction') || token.includes('watchlist')) return 'This helps the model recognise customers or alerts that already carry higher inherent compliance risk.';
  if (token.includes('txn') || token.includes('transaction') || token.includes('amount') || token.includes('velocity') || token.includes('count')) return 'Transaction behaviour is often the clearest early signal that an alert deserves analyst attention.';
  if (token.includes('rule') || token.includes('alert')) return 'This captures why the alert fired, which can help distinguish weak alerts from alerts that historically led to escalation.';
  if (token.includes('country') || token.includes('geo') || token.includes('correspondent')) return 'Geography and correspondent relationships often change the money-laundering risk profile materially.';
  return 'If this field is available at alert time, it may help the model separate low-value false positives from alerts that deserve review.';
};

const riskIfIncludedWrongly = (profile) => {
  if (profile?.decision === 'blocked_leakage') {
    return 'If included, the model would learn the answer itself instead of learning real AML behaviour, leading to false confidence and weak production performance.';
  }
  if (profile?.decision === 'blocked_post_outcome') {
    return 'If included, the model would rely on information that only appears after investigation starts, which is unfair and impossible to reproduce when the alert first fires.';
  }
  if (profile?.decision === 'weak_redundant') {
    return 'If included, this field would add noise or duplicate another stronger signal, making the model harder to govern and explain.';
  }
  if (profile?.decision === 'needs_review') {
    return 'If included without confirmation, the team could accidentally allow a timing issue, a policy bias, or a feature that is not stable in production.';
  }
  return 'If used carefully, this field adds operational context without depending on downstream investigation outcomes.';
};

const businessVerdictText = (decision) => {
  if (decision === 'approved') return 'Approved for training';
  if (decision === 'needs_review') return 'Needs your input';
  if (isBlockedDecision(decision)) return 'Blocked from training';
  return 'Hold back from training';
};

const healthNarrative = ({ approved = 0, blocked = 0, review = 0 }) => {
  if (blocked === 0 && review === 0) return 'Your feature set looks clean. No obvious leakage issues are standing in the way of training.';
  if (blocked > 0 && review === 0) return 'Strong guardrails are working. Risky or delayed fields were caught before they could enter training.';
  if (review > 0 && blocked === 0) return 'The feature set looks promising, but a few business checks are still needed before sign-off.';
  return 'The feature set has usable AML signals, but some columns still need sign-off or should stay out of the model.';
};

const businessBlockDecision = (profile) => {
  if (profile?.available_at_decision_time === false) return 'blocked_post_outcome';
  if (profile?.leakageRisk === 'high') return 'blocked_leakage';
  return 'weak_redundant';
};

const BarMeter = ({ level = 3, color = T.orange }) => (
  <Stack direction="row" spacing={0.4}>
    {[1, 2, 3, 4, 5].map((slot) => (
      <Box
        key={slot}
        sx={{
          width: 18,
          height: 8,
          borderRadius: 999,
          bgcolor: slot <= level ? color : '#e2e8f0',
        }}
      />
    ))}
  </Stack>
);

const buildFallbackInventory = ({ masterDataset, datasets, targetColumn }) => {
  const sourceRows = [
    ...(Array.isArray(masterDataset?.preview) ? masterDataset.preview : []),
    ...(Array.isArray(masterDataset?.rows) ? masterDataset.rows : []),
    ...(Array.isArray(masterDataset?.preview_rows) ? masterDataset.preview_rows : []),
  ];
  const rowColumns = sourceRows.length ? Object.keys(sourceRows[0] || {}) : [];
  const allColumns = unique([
    ...normalizeColumns(masterDataset?.columns),
    ...normalizeColumns(masterDataset?.schema?.columns_detail),
    ...rowColumns,
    ...((Array.isArray(datasets) ? datasets : []).flatMap((dataset) => normalizeColumns(dataset?.columns))),
  ]);
  const typeLookup = normalizeColumnTypes(masterDataset, ...(Array.isArray(datasets) ? datasets : []));

  return allColumns
    .filter((feature) => feature && feature !== targetColumn && !isLikelyId(feature))
    .map((feature) => ({
      name: feature,
      role: inferRole(typeLookup[feature]),
      dtype: typeLookup[feature] || 'object',
      missing_pct: 0,
      distinct_count: 0,
      sample_values: [],
      top_categories: [],
    }));
};

const buildFallbackProfiles = (inventory = [], datasets = [], masterDataset = null) => {
  return inventory.map((item, index) => {
    const feature = String(item?.name || '');
    const token = safeLower(feature);
    const directTargetLeakage = /\b(str label|sar label|target|final label|outcome)\b/.test(token);
    const targetProxyRisk = /\b(prior sar|prior str|sar rate|str rate|filed sar|filed str)\b/.test(token);
    const postOutcomeRisk = /\b(case status|resolution|resolved|closure|closed|status after)\b/.test(token);
    const analystActionRisk = /\b(analyst|docs requested|customer contacted|contacted|edd triggered|reviewed|review outcome)\b/.test(token);
    const futureInformationRisk = /\b(days to close|after review|future|next 30d|post)\b/.test(token);
    const lowVarianceRisk = /\b(label|flag)\b/.test(token) ? false : index > 15;
    const redundantRisk = /\b(score|band|rate)\b/.test(token) && index > 9;

    let decision = 'approved';
    let reason = 'This field looks operationally safe and useful enough to flow into model training.';
    if (directTargetLeakage || (targetProxyRisk && /\b(label|sar|str)\b/.test(token))) {
      decision = 'blocked_leakage';
      reason = 'This field is too close to the answer or derived from the target outcome.';
    } else if (postOutcomeRisk || analystActionRisk || futureInformationRisk || targetProxyRisk) {
      decision = 'blocked_post_outcome';
      reason = 'This field is not reliably available at alert-decision time or depends on later investigation activity.';
    } else if (redundantRisk || lowVarianceRisk) {
      decision = 'weak_redundant';
      reason = redundantRisk
        ? 'This field overlaps heavily with other features and is a weak governance choice for training.'
        : 'This field looks weak or unstable in the current sample and is excluded by default.';
    } else if (index > 12) {
      decision = 'needs_review';
      reason = 'This field is not clearly unsafe, but it still needs a human review before approval.';
    }

    const businessExplanation = decision === 'approved'
      ? 'Safe to use at alert time and helpful for separating low-value reviews from riskier cases.'
      : decision === 'needs_review'
        ? 'Potentially useful, but the team should confirm it is available at decision time and not unfairly close to the answer.'
        : decision === 'blocked_leakage'
          ? 'Too close to the answer. Using it would make the model look unrealistically strong and untrustworthy in production.'
          : decision === 'blocked_post_outcome'
            ? 'Known only after investigation or later in the workflow, so it is not fair to use when deciding which alerts to suppress.'
            : 'Does not add enough stable value on top of other fields, so it is excluded from the governed feature set.';

    return {
      feature,
      role: item?.role || inferRole(item?.dtype),
      dtype: item?.dtype || item?.role || 'object',
      feature_family: inferFeatureFamily(feature),
      decision,
      decision_label: DECISION_META[decision]?.label || humanize(decision),
      decision_reason: reason,
      selected_for_training: decision === 'approved',
      needs_override_for_training: decision !== 'approved',
      available_at_decision_time: !(postOutcomeRisk || analystActionRisk || futureInformationRisk || targetProxyRisk),
      timing_classification: postOutcomeRisk || analystActionRisk || futureInformationRisk ? 'post_outcome' : 'alert_time',
      missing_pct: 0,
      distinct_count: 0,
      sample_values: [],
      top_categories: [],
      primary_score: Number(Math.max(0.12, 0.92 - (index * 0.045)).toFixed(4)),
      score_norm: Number(Math.max(0.05, 0.94 - (index * 0.04)).toFixed(4)),
      rank_position: index + 1,
      information_gain: Number(Math.max(0.02, 0.4 - (index * 0.015)).toFixed(4)),
      information_value: Number(Math.max(0.01, 0.55 - (index * 0.02)).toFixed(4)),
      iv_strength: index < 6 ? 'medium' : 'low',
      vif: redundantRisk ? Number((5 + (index * 0.2)).toFixed(2)) : null,
      max_partner_correlation: redundantRisk ? Number((0.88 - (index * 0.01)).toFixed(2)) : null,
      firewall_flags: [
        ...(directTargetLeakage ? ['Direct target leakage'] : []),
        ...(targetProxyRisk ? ['Target proxy risk'] : []),
        ...(postOutcomeRisk ? ['Post-outcome field'] : []),
        ...(analystActionRisk ? ['Analyst action / investigation step'] : []),
        ...(futureInformationRisk ? ['Future information'] : []),
        ...(redundantRisk ? ['Redundant with another feature'] : []),
        ...(lowVarianceRisk ? ['Low variation'] : []),
      ],
      direct_target_leakage: directTargetLeakage,
      target_proxy_risk: targetProxyRisk,
      post_outcome_risk: postOutcomeRisk,
      future_information_risk: futureInformationRisk,
      analyst_action_risk: analystActionRisk,
      redundant_risk: redundantRisk,
      weak_signal_risk: decision === 'needs_review',
      low_variance_risk: lowVarianceRisk,
      business_explanation: businessExplanation,
      technical_explanation: reason,
      evidence: [
        `Fallback source-table guess: ${inferSourceTable(feature, datasets, masterDataset)}`,
        decision === 'approved' ? 'No obvious leakage keywords were detected.' : reason,
      ],
    };
  });
};

const buildFallbackTechniqueResults = (profiles = []) => {
  const scoreRows = [...profiles]
    .sort((left, right) => (num(right.primary_score ?? right.score_norm) || 0) - (num(left.primary_score ?? left.score_norm) || 0))
    .map((profile) => ({
      feature: profile.feature,
      role: profile.role,
      score: profile.primary_score ?? profile.score_norm ?? null,
      rank_value: profile.primary_score ?? profile.score_norm ?? null,
      missing_pct: profile.missing_pct,
      sample_values: profile.sample_values || [],
      reason: profile.decision_reason,
    }));

  const categoricalRows = scoreRows.filter((row) => ['categorical', 'binary'].includes(safeLower(row.role)));
  const leakageRows = profiles
    .filter((profile) => profile.decision === 'blocked_leakage')
    .map((profile) => ({
      feature: profile.feature,
      role: profile.role,
      score: 1,
      reason: profile.decision_reason,
    }));
  const varianceRows = profiles
    .filter((profile) => profile.low_variance_risk)
    .map((profile) => ({
      feature: profile.feature,
      role: profile.role,
      score: 0,
      reason: profile.decision_reason,
    }));
  const correlationRows = profiles
    .filter((profile) => profile.redundant_risk)
    .map((profile) => ({
      feature: profile.feature,
      role: profile.role,
      score: profile.max_partner_correlation ?? profile.vif ?? 0,
      reason: profile.decision_reason,
    }));
  const vifRows = profiles
    .filter((profile) => num(profile.vif) != null || profile.redundant_risk)
    .map((profile) => ({
      feature: profile.feature,
      role: profile.role,
      score: profile.vif ?? 0,
      reason: profile.decision_reason,
    }));

  return {
    information_gain: { rows: scoreRows, suggested_keep: profiles.filter((profile) => profile.decision === 'approved').map((profile) => profile.feature) },
    information_value: { rows: scoreRows, suggested_keep: profiles.filter((profile) => profile.decision === 'approved').map((profile) => profile.feature) },
    chi_square: { rows: categoricalRows, suggested_keep: categoricalRows.map((row) => row.feature) },
    variance_threshold: { rows: varianceRows, suggested_drop: varianceRows.map((row) => row.feature) },
    correlation_filter: { rows: correlationRows, suggested_drop: correlationRows.map((row) => row.feature) },
    vif_multicollinearity: { rows: vifRows, suggested_drop: vifRows.map((row) => row.feature) },
    leakage_name_scan: { rows: leakageRows, suggested_drop: leakageRows.map((row) => row.feature) },
  };
};

const buildFallbackPayload = ({ masterDataset, datasets, targetColumn }) => {
  const inventory = buildFallbackInventory({ masterDataset, datasets, targetColumn });
  const profiles = buildFallbackProfiles(inventory, datasets, masterDataset);
  const decisionCounts = profiles.reduce((acc, profile) => {
    acc[profile.decision] = (acc[profile.decision] || 0) + 1;
    return acc;
  }, {});

  return {
    columns: inventory,
    governance_profiles: profiles,
    available_techniques: CORE_TECHNIQUES,
    technique_results: buildFallbackTechniqueResults(profiles),
    recommended_supervised_metric: targetColumn ? 'information_gain' : 'variance_threshold',
    recommended_supervised_reason: targetColumn
      ? 'Start with Information Gain for the overall supervised ranking, then use Chi-Square for categorical fields and Correlation / VIF to remove duplicates.'
      : 'No target is defined, so start with variance and redundancy filters.',
    default_technique_id: targetColumn ? 'information_gain' : 'variance_threshold',
    governance_summary: {
      business_summary: `${decisionCounts.approved || 0} features look safe, ${(decisionCounts.blocked_leakage || 0) + (decisionCounts.blocked_post_outcome || 0)} are blocked for leakage or timing reasons, and ${decisionCounts.needs_review || 0} still need a review.`,
      technical_summary: 'Fallback governance view is active. It uses column-name rules, timing rules, and simple redundancy heuristics until a richer backend payload is available.',
      counts: {
        total_features: profiles.length,
        approved: decisionCounts.approved || 0,
        needs_review: decisionCounts.needs_review || 0,
        blocked_leakage: decisionCounts.blocked_leakage || 0,
        blocked_post_outcome: decisionCounts.blocked_post_outcome || 0,
        weak_redundant: decisionCounts.weak_redundant || 0,
      },
    },
    firewall: {
      checks: [
        {
          id: 'direct_target_leakage',
          label: 'Direct target leakage',
          count: profiles.filter((profile) => profile.direct_target_leakage).length,
          examples: profiles.filter((profile) => profile.direct_target_leakage).slice(0, 6).map((profile) => profile.feature),
          description: 'Fields that directly encode the answer.',
        },
        {
          id: 'target_proxy_risk',
          label: 'Target proxy risk',
          count: profiles.filter((profile) => profile.target_proxy_risk).length,
          examples: profiles.filter((profile) => profile.target_proxy_risk).slice(0, 6).map((profile) => profile.feature),
          description: 'Outcome-linked or target-adjacent fields such as prior SAR / STR rate.',
        },
        {
          id: 'post_outcome_risk',
          label: 'Post-investigation fields',
          count: profiles.filter((profile) => profile.post_outcome_risk || profile.analyst_action_risk).length,
          examples: profiles.filter((profile) => profile.post_outcome_risk || profile.analyst_action_risk).slice(0, 6).map((profile) => profile.feature),
          description: 'Only known after analyst or investigator action.',
        },
        {
          id: 'future_information_risk',
          label: 'Future information',
          count: profiles.filter((profile) => profile.future_information_risk).length,
          examples: profiles.filter((profile) => profile.future_information_risk).slice(0, 6).map((profile) => profile.feature),
          description: 'Information that would not exist when the alert is first scored.',
        },
      ],
      blocked_count: profiles.filter((profile) => isBlockedDecision(profile.decision)).length,
      review_count: profiles.filter((profile) => profile.decision === 'needs_review').length,
    },
    approved_feature_set: profiles
      .filter((profile) => profile.decision === 'approved')
      .map((profile) => ({
        feature: profile.feature,
        feature_family: profile.feature_family,
        approval_reason: profile.decision_reason,
      })),
    excluded_feature_set: profiles
      .filter((profile) => profile.decision !== 'approved')
      .map((profile) => ({
        feature: profile.feature,
        feature_family: profile.feature_family,
        exclusion_reason: profile.decision_reason,
        decision: profile.decision,
      })),
    default_training_columns: profiles.filter((profile) => profile.decision === 'approved').map((profile) => profile.feature),
    default_excluded_columns: profiles.filter((profile) => profile.decision !== 'approved').map((profile) => profile.feature),
  };
};

const normalizeWorkbench = ({ payload, fallback, datasets, masterDataset, overrides }) => {
  const merged = {
    ...fallback,
    ...(payload || {}),
    columns: Array.isArray(payload?.columns) && payload.columns.length ? payload.columns : fallback.columns,
    governance_profiles: Array.isArray(payload?.governance_profiles) && payload.governance_profiles.length
      ? payload.governance_profiles
      : fallback.governance_profiles,
    available_techniques: Array.isArray(payload?.available_techniques) && payload.available_techniques.length
      ? payload.available_techniques.map((tech) => ({ ...TECHNIQUE_MAP[tech.id], ...tech }))
      : fallback.available_techniques,
    technique_results: {
      ...(fallback.technique_results || {}),
      ...(payload?.technique_results || {}),
    },
    governance_summary: {
      ...(fallback.governance_summary || {}),
      ...(payload?.governance_summary || {}),
      counts: {
        ...(fallback.governance_summary?.counts || {}),
        ...(payload?.governance_summary?.counts || {}),
      },
    },
    firewall: {
      ...(fallback.firewall || {}),
      ...(payload?.firewall || {}),
      checks: Array.isArray(payload?.firewall?.checks) && payload.firewall.checks.length
        ? payload.firewall.checks
        : fallback.firewall?.checks || [],
    },
  };

  const profiles = (Array.isArray(merged.governance_profiles) ? merged.governance_profiles : []).map((profile, index) => {
    const feature = String(profile?.feature || profile?.name || '');
    const override = overrides?.[feature];
    const decision = override?.decision || String(profile?.decision || 'needs_review');
    const defaultReason = String(profile?.decision_reason || profile?.reason || 'Needs review.');
    return {
      ...profile,
      feature,
      sourceTable: inferSourceTable(feature, datasets, masterDataset),
      featureType: String(profile?.role || profile?.dtype || 'unknown'),
      decision,
      decisionReason: override?.reason || defaultReason,
      decisionLabel: DECISION_META[decision]?.label || String(profile?.decision_label || humanize(decision)),
      selectedForTraining: decision === 'approved',
      isOverridden: Boolean(override),
      businessExplanation: override?.reason || String(profile?.business_explanation || defaultReason),
      technicalExplanation: override?.reason || String(profile?.technical_explanation || defaultReason),
      evidence: Array.isArray(profile?.evidence) && profile.evidence.length ? profile.evidence : [defaultReason],
      featureFamily: String(profile?.feature_family || inferFeatureFamily(feature)),
      displayName: humanize(feature),
      leakageRisk: riskLevelFromProfile({ ...profile, decision }),
      rankPosition: num(profile?.rank_position),
      primaryScore: num(profile?.primary_score),
      scoreNorm: clamp01(profile?.score_norm),
      missingPct: num(profile?.missing_pct) || 0,
      vif: num(profile?.vif),
      maxPartnerCorrelation: num(profile?.max_partner_correlation),
      sampleValues: Array.isArray(profile?.sample_values) ? profile.sample_values : [],
      topCategories: Array.isArray(profile?.top_categories) ? profile.top_categories : [],
      sourceRank: index + 1,
    };
  });

  return { ...merged, profiles };
};

const groupBySourceTable = (items = []) => {
  const grouped = {};
  items.forEach((item) => {
    const source = item.sourceTable || 'Unknown source';
    if (!grouped[source]) grouped[source] = [];
    grouped[source].push(item);
  });
  return Object.entries(grouped).map(([source, values]) => ({
    source,
    values: values.sort((left, right) => String(left.feature).localeCompare(String(right.feature))),
  }));
};

const BusinessFeatureCard = ({ profile, onOpenReview }) => {
  const verdictMeta = DECISION_META[profile.decision] || DECISION_META.needs_review;
  const safetyMeta = businessSafetyTone(profile);
  const strengthLevel = businessStrengthLevel(profile);

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2,
        border: `1px solid ${verdictMeta.border}`,
        bgcolor: '#fff',
        p: 1.4,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.05,
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: T.text }}>
            {profile.displayName}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.2 }}>
            {profile.sourceTable} • {profile.featureFamily}
          </Typography>
        </Box>
        <Chip
          label={businessVerdictText(profile.decision)}
          size="small"
          sx={{ bgcolor: verdictMeta.bg, color: verdictMeta.color, fontWeight: 700 }}
        />
      </Stack>

      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
          What it is
        </Typography>
        <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.3 }}>
          {featureMeaning(profile.feature)}
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
          What high values mean
        </Typography>
        <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.3 }}>
          {whatHighValuesMean(profile.feature)}
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
          AML relevance
        </Typography>
        <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.3 }}>
          {amlRelevance(profile.feature)}
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
          Risk if included wrongly
        </Typography>
        <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.3 }}>
          {riskIfIncludedWrongly(profile)}
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
        <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 0.9, bgcolor: T.surfaceAlt }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase' }}>
            Strength
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.55 }}>
            <BarMeter level={strengthLevel} color={T.orange} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>
              {businessStrengthLabel(strengthLevel)}
            </Typography>
          </Stack>
        </Paper>
        <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 0.9, bgcolor: T.surfaceAlt }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase' }}>
            Safety
          </Typography>
          <Chip
            label={businessSafetyLabel(profile)}
            size="small"
            sx={{ mt: 0.55, bgcolor: safetyMeta.bg, color: safetyMeta.color, fontWeight: 700 }}
          />
          <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.55 }}>
            {businessUniquenessLabel(profile)}
          </Typography>
        </Paper>
      </Box>

      <Paper elevation={0} sx={{ border: `1px solid ${verdictMeta.border}`, borderRadius: 1.5, p: 0.95, bgcolor: verdictMeta.bg }}>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: verdictMeta.color, textTransform: 'uppercase' }}>
          Business verdict
        </Typography>
        <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.35 }}>
          {profile.businessExplanation}
        </Typography>
      </Paper>

      <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
        <Button
          variant="outlined"
          size="small"
          onClick={() => onOpenReview?.(profile.feature)}
          sx={{ borderColor: T.border, color: T.text }}
        >
          Review feature
        </Button>
      </Stack>
    </Paper>
  );
};

const FeatureGovernanceWorkbench = ({
  masterDataset,
  datasets,
  steps = [],
  onStepsChange,
  targetColumn,
  persona = 'business',
}) => {
  const datasetId = masterDataset?.dataset_id || masterDataset?.id || masterDataset?.datasetId || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rawPayload, setRawPayload] = useState(null);
  const [activeBucket, setActiveBucket] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [techniqueId, setTechniqueId] = useState('');
  const [comparisonTechniqueIds, setComparisonTechniqueIds] = useState([]);
  const [comparisonMinSupport, setComparisonMinSupport] = useState(2);
  const [includeReviewInConsensus, setIncludeReviewInConsensus] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [techniqueResultsDialogOpen, setTechniqueResultsDialogOpen] = useState(false);
  const [comparisonMatrixDialogOpen, setComparisonMatrixDialogOpen] = useState(false);
  const [applyFeedback, setApplyFeedback] = useState(null);
  const [overrideNote, setOverrideNote] = useState('');
  const [overrides, setOverrides] = useState({});
  const [viewMode, setViewMode] = useState(safeLower(persona) === 'technical' ? 'technical' : 'business');

  const fallbackPayload = useMemo(() => (
    buildFallbackPayload({ masterDataset, datasets, targetColumn })
  ), [masterDataset, datasets, targetColumn]);

  const load = useCallback(async () => {
    const inlineDataset = masterDataset && typeof masterDataset === 'object' ? masterDataset : null;
    const hasInlineDataset = Boolean(
      inlineDataset && (inlineDataset.file_path || inlineDataset.path || inlineDataset.source_path),
    );
    if (!datasetId && !hasInlineDataset) {
      setRawPayload(fallbackPayload);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await mlopsApi.featureSelectionWorkbench({
        dataset_id: datasetId,
        dataset: inlineDataset,
        target_column: targetColumn,
        sample_rows: 10000,
        top_n: 20,
        var_threshold: 0.01,
        corr_threshold: 0.95,
      });
      const payload = unwrapApiPayload(response);
      setRawPayload(payload && typeof payload === 'object' ? payload : fallbackPayload);
    } catch (err) {
      setRawPayload(fallbackPayload);
      setError(err?.message || 'Feature selection workbench failed. Showing the saved fallback view instead.');
    } finally {
      setLoading(false);
    }
  }, [datasetId, fallbackPayload, masterDataset, targetColumn]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setViewMode(safeLower(persona) === 'technical' ? 'technical' : 'business');
  }, [persona]);

  const workbench = useMemo(() => (
    normalizeWorkbench({
      payload: rawPayload,
      fallback: fallbackPayload,
      datasets,
      masterDataset,
      overrides,
    })
  ), [datasets, fallbackPayload, masterDataset, overrides, rawPayload]);

  const techniqueCatalog = useMemo(() => {
    const source = Array.isArray(workbench?.available_techniques) && workbench.available_techniques.length
      ? workbench.available_techniques
      : CORE_TECHNIQUES;
    return source.map((tech) => {
      const merged = { ...TECHNIQUE_MAP[tech.id], ...tech };
      return {
        ...merged,
        businessQuestion: techniqueQuestionLabel(merged),
      };
    });
  }, [workbench?.available_techniques]);

  const fallbackTechniqueResults = useMemo(
    () => buildFallbackTechniqueResults(workbench?.profiles || []),
    [workbench?.profiles],
  );

  const techniqueResults = useMemo(() => ({
    ...fallbackTechniqueResults,
    ...(workbench?.technique_results || {}),
  }), [fallbackTechniqueResults, workbench?.technique_results]);

  const recommendedTechniqueId = String(
    workbench?.default_technique_id
    || workbench?.recommended_supervised_metric
    || (targetColumn ? 'information_gain' : 'variance_threshold')
  );

  useEffect(() => {
    if (!techniqueCatalog.length) return;
    const validIds = new Set(techniqueCatalog.map((tech) => String(tech.id)));
    if (!techniqueId || !validIds.has(techniqueId)) {
      setTechniqueId(validIds.has(recommendedTechniqueId) ? recommendedTechniqueId : String(techniqueCatalog[0].id));
    }
  }, [recommendedTechniqueId, techniqueCatalog, techniqueId]);

  useEffect(() => {
    if (!techniqueCatalog.length) return;
    const validIds = new Set(techniqueCatalog.map((tech) => String(tech.id)));
    setComparisonTechniqueIds((prev) => {
      const next = prev.filter((id) => validIds.has(String(id)));
      if (next.length) return next;
      const defaults = unique([
        validIds.has(recommendedTechniqueId) ? recommendedTechniqueId : null,
        validIds.has('information_value') ? 'information_value' : null,
        validIds.has('vif_multicollinearity') ? 'vif_multicollinearity' : null,
        validIds.has('chi_square') ? 'chi_square' : null,
        validIds.has('ks_statistic') ? 'ks_statistic' : null,
      ]).slice(0, 4);
      return defaults.length ? defaults : [String(techniqueCatalog[0].id)];
    });
  }, [recommendedTechniqueId, techniqueCatalog]);

  const profiles = workbench?.profiles || [];

  useEffect(() => {
    if (!profiles.length) {
      setSelectedFeature('');
      return;
    }
    if (!selectedFeature || !profiles.some((profile) => profile.feature === selectedFeature)) {
      const preferred = profiles.find((profile) => profile.decision === 'approved') || profiles[0];
      setSelectedFeature(preferred.feature);
    }
  }, [profiles, selectedFeature]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.feature === selectedFeature) || null,
    [profiles, selectedFeature],
  );

  useEffect(() => {
    if (!selectedProfile) {
      setOverrideNote('');
      return;
    }
    const current = overrides[selectedProfile.feature];
    setOverrideNote(current?.reason || '');
  }, [overrides, selectedProfile]);

  const counts = workbench?.governance_summary?.counts || {};
  const summaryCards = [
    { label: 'Total features', value: counts.total_features || profiles.length, meta: 'Reviewed for training suitability' },
    { label: 'Approved', value: counts.approved || profiles.filter((profile) => profile.decision === 'approved').length, meta: 'Safe to flow into model training' },
    { label: 'Needs review', value: counts.needs_review || profiles.filter((profile) => profile.decision === 'needs_review').length, meta: 'Hold until a human confirms it' },
    { label: 'Blocked as leakage', value: counts.blocked_leakage || profiles.filter((profile) => profile.decision === 'blocked_leakage').length, meta: 'Too close to the answer' },
    { label: 'Blocked as post-outcome / not available', value: counts.blocked_post_outcome || profiles.filter((profile) => profile.decision === 'blocked_post_outcome').length, meta: 'Known only later in the workflow' },
    { label: 'Weak / redundant', value: counts.weak_redundant || profiles.filter((profile) => profile.decision === 'weak_redundant').length, meta: 'Repeats another field or adds too little' },
  ];
  const approvedCount = counts.approved || profiles.filter((profile) => profile.decision === 'approved').length;
  const reviewCount = counts.needs_review || profiles.filter((profile) => profile.decision === 'needs_review').length;
  const blockedCount = (counts.blocked_leakage || profiles.filter((profile) => profile.decision === 'blocked_leakage').length)
    + (counts.blocked_post_outcome || profiles.filter((profile) => profile.decision === 'blocked_post_outcome').length)
    + (counts.weak_redundant || profiles.filter((profile) => profile.decision === 'weak_redundant').length);
  const isBusinessView = viewMode === 'business';
  const businessSummaryCards = [
    { label: 'Approved for training', value: approvedCount, meta: 'Safe to flow into the model now' },
    { label: 'Blocked', value: blockedCount, meta: 'Would introduce leakage, timing issues, or unnecessary duplication' },
    { label: 'Need your sign-off', value: reviewCount, meta: 'Business input is still needed before training' },
  ];
  const healthSummary = healthNarrative({ approved: approvedCount, blocked: blockedCount, review: reviewCount });
  const profileLookup = useMemo(
    () => Object.fromEntries(profiles.map((profile) => [profile.feature, profile])),
    [profiles],
  );

  const sourceOptions = useMemo(
    () => ['all', ...unique(profiles.map((profile) => profile.sourceTable))],
    [profiles],
  );

  const visibleProfiles = useMemo(() => {
    const needle = safeLower(search);
    return profiles.filter((profile) => {
      if (activeBucket !== 'all' && profile.decision !== activeBucket) return false;
      if (sourceFilter !== 'all' && profile.sourceTable !== sourceFilter) return false;
      if (riskFilter !== 'all' && profile.leakageRisk !== riskFilter) return false;
      if (stateFilter === 'selected' && profile.decision !== 'approved') return false;
      if (stateFilter === 'review' && profile.decision !== 'needs_review') return false;
      if (stateFilter === 'blocked' && !isBlockedDecision(profile.decision)) return false;
      if (stateFilter === 'excluded' && profile.decision === 'approved') return false;
      if (!needle) return true;
      return [
        profile.feature,
        profile.displayName,
        profile.sourceTable,
        profile.featureFamily,
        profile.decisionReason,
        profile.businessExplanation,
        profile.technicalExplanation,
      ].some((value) => safeLower(value).includes(needle));
    });
  }, [activeBucket, profiles, riskFilter, search, sourceFilter, stateFilter]);

  const techniqueLookup = useMemo(
    () => Object.fromEntries(techniqueCatalog.map((tech) => [String(tech.id), tech])),
    [techniqueCatalog],
  );
  const activeTechnique = techniqueLookup[techniqueId] || techniqueLookup[recommendedTechniqueId] || techniqueCatalog[0] || null;
  const activeTechniqueRows = useMemo(() => {
    const payload = techniqueResults?.[activeTechnique?.id] || {};
    return Array.isArray(payload?.rows) ? payload.rows : [];
  }, [activeTechnique?.id, techniqueResults]);
  const activeTechniqueTopRows = useMemo(() => (
    activeTechniqueRows
      .slice(0, 6)
      .map((row, index) => {
        const feature = String(row?.feature || '');
        const profile = profileLookup[feature] || null;
        return {
          id: `${activeTechnique?.id || 'tech'}_${feature || index}`,
          feature,
          displayName: profile?.displayName || humanize(feature || `Feature ${index + 1}`),
          decisionLabel: profile?.decisionLabel || 'Needs review',
          businessExplanation: profile?.businessExplanation || featureMeaning(feature),
          technicalExplanation: profile?.technicalExplanation || String(row?.reason || activeTechnique?.description || '-'),
          scoreText: fmtScore(row?.score ?? row?.rank_value, 4),
        };
      })
      .filter((row) => row.feature)
  ), [activeTechnique?.description, activeTechnique?.id, activeTechniqueRows, profileLookup]);
  const activeTechniqueMessage = techniqueResults?.[activeTechnique?.id]?.message || '';
  const quickTechniques = useMemo(() => {
    const curated = QUICK_TECHNIQUE_IDS.map((id) => techniqueLookup[id]).filter(Boolean);
    const fallback = techniqueCatalog.slice(0, 8);
    return unique([...(curated || []), ...(fallback || [])].map((tech) => tech?.id))
      .map((id) => techniqueLookup[id])
      .filter(Boolean)
      .slice(0, 8);
  }, [techniqueCatalog, techniqueLookup]);
  const allFeatureNames = useMemo(() => profiles.map((profile) => profile.feature).filter(Boolean), [profiles]);

  const getTechniqueKeepFeatures = useCallback((techId) => {
    const tech = techniqueLookup[String(techId)];
    const payload = techniqueResults?.[String(techId)] || {};
    if (!tech) return [];
    if (tech.scope === 'filter') {
      const drops = new Set(
        [
          ...(Array.isArray(payload?.suggested_drop) ? payload.suggested_drop : []),
          ...((Array.isArray(payload?.rows) ? payload.rows : []).map((row) => String(row?.feature || '')).filter(Boolean)),
        ],
      );
      return allFeatureNames.filter((feature) => !drops.has(feature));
    }
    const keep = Array.isArray(payload?.suggested_keep) && payload.suggested_keep.length
      ? payload.suggested_keep
      : (Array.isArray(payload?.rows) ? payload.rows.map((row) => String(row?.feature || '')).filter(Boolean) : []);
    return unique(keep);
  }, [allFeatureNames, techniqueLookup, techniqueResults]);

  useEffect(() => {
    const maxSupport = Math.max(1, comparisonTechniqueIds.length);
    setComparisonMinSupport((prev) => {
      if (!comparisonTechniqueIds.length) return 1;
      if (prev > maxSupport) return maxSupport;
      if (prev < 1) return 1;
      return prev;
    });
  }, [comparisonTechniqueIds]);

  const comparisonTechniqueSummaries = useMemo(() => (
    comparisonTechniqueIds.map((id) => {
      const payload = techniqueResults?.[String(id)] || {};
      const keepFeatures = getTechniqueKeepFeatures(id);
      const flaggedRows = Array.isArray(payload?.rows) ? payload.rows : [];
      const scoredRows = Array.isArray(payload?.scored_rows) && payload.scored_rows.length
        ? payload.scored_rows
        : flaggedRows;
      const scoreMap = {};
      scoredRows.forEach((row, index) => {
        const feature = String(row?.feature || '');
        if (!feature || scoreMap[feature]) return;
        scoreMap[feature] = {
          score: num(row?.score ?? row?.rank_value),
          reason: String(row?.reason || ''),
          rank: index + 1,
        };
      });
      return {
        id,
        label: techniqueLookup[String(id)]?.label || String(id),
        scope: techniqueLookup[String(id)]?.scope || payload?.scope || 'score',
        keepFeatures,
        keepSet: new Set(keepFeatures),
        flaggedSet: new Set(flaggedRows.map((row) => String(row?.feature || '')).filter(Boolean)),
        scoreMap,
        count: keepFeatures.length,
        topN: Array.isArray(payload?.suggested_keep) ? payload.suggested_keep.length : 0,
      };
    })
  ), [comparisonTechniqueIds, getTechniqueKeepFeatures, techniqueLookup]);

  const backendTechniqueAudit = useMemo(() => {
    const auditSource = Array.isArray(workbench?.available_techniques) ? workbench.available_techniques : [];
    const scoreCount = auditSource.filter((tech) => String(tech?.scope || '') === 'score').length;
    const filterCount = auditSource.filter((tech) => String(tech?.scope || '') === 'filter').length;
    return {
      livePayload: Boolean(rawPayload && rawPayload !== fallbackPayload && rawPayload?.technique_results),
      totalCount: auditSource.length,
      scoreCount,
      filterCount,
      topN: Number(workbench?.thresholds?.top_n) || 20,
      missingFamilies: [
        'Wrapper search like RFECV / forward-selection',
        'Embedded model methods like L1 / Elastic Net',
        'Tree explainers such as SHAP / permutation importance',
        'All-relevant selection such as Boruta / mRMR',
      ],
    };
  }, [fallbackPayload, rawPayload, workbench?.available_techniques, workbench?.thresholds?.top_n]);

  const comparisonMatrixRows = useMemo(() => {
    if (!comparisonTechniqueSummaries.length) return [];
    const techniqueCount = comparisonTechniqueSummaries.length;
    return profiles
      .map((profile) => {
        const techniqueCells = comparisonTechniqueSummaries.map((summary) => {
          const feature = profile.feature;
          const metric = summary.scoreMap?.[feature] || null;
          const isSupported = summary.keepSet.has(feature);
          const isFlagged = summary.flaggedSet.has(feature);
          const rawScore = metric?.score;
          const decimals = summary.id === 'vif_multicollinearity' ? 2 : 4;
          const scoreText = rawScore != null
            ? fmtScore(rawScore, decimals)
            : (summary.scope === 'filter'
              ? (isFlagged ? 'Flagged' : isSupported ? 'Pass' : '-')
              : (isSupported ? 'Selected' : '-'));
          const businessText = summary.scope === 'filter'
            ? (isFlagged
              ? `${summary.label} flagged this feature for review or removal.`
              : `${summary.label} let this feature pass its filter check.`)
            : (isSupported
              ? `${summary.label} placed this feature inside its kept shortlist.`
              : `${summary.label} did not place this feature inside its kept shortlist.`);
          const technicalText = metric?.reason
            || (summary.scope === 'filter'
              ? (isFlagged ? 'Flagged by the filter threshold.' : 'Not flagged by this filter.')
              : 'Not selected into the technique shortlist.');
          return {
            id: summary.id,
            label: summary.label,
            scope: summary.scope,
            isSupported,
            isFlagged,
            score: rawScore,
            scoreText,
            businessText,
            technicalText,
            rank: metric?.rank || null,
          };
        });
        const matchedTechniques = techniqueCells.filter((cell) => cell.isSupported).map((cell) => cell.id);
        const supportCount = matchedTechniques.length;
        const tierKey = consensusTierKey(supportCount, techniqueCount);
        const tierMeta = CONSENSUS_TIER_META[tierKey];
        const eligible = supportCount >= Math.max(1, comparisonMinSupport);
        const downstreamReady = eligible && (
          profile.decision === 'approved'
          || (includeReviewInConsensus && profile.decision === 'needs_review')
        );
        return {
          ...profile,
          techniqueCells,
          matchedTechniques,
          supportCount,
          techniqueCount,
          tierKey,
          tierMeta,
          eligible,
          downstreamReady,
          businessConsensusText: `${tierMeta.businessText} ${profile.businessExplanation}`,
          technicalConsensusText: `${supportCount}/${techniqueCount} selected technique${techniqueCount === 1 ? '' : 's'} supported this feature. ${tierMeta.technicalText} Governance verdict: ${profile.decisionLabel}.`,
        };
      })
      .filter((profile) => profile.supportCount > 0)
      .sort((left, right) => (
        (right.supportCount - left.supportCount)
        || ((right.primaryScore || 0) - (left.primaryScore || 0))
        || String(left.feature).localeCompare(String(right.feature))
      ));
  }, [comparisonMinSupport, comparisonTechniqueSummaries, includeReviewInConsensus, profiles]);

  const consensusFeatureRows = useMemo(
    () => comparisonMatrixRows.filter((profile) => profile.eligible),
    [comparisonMatrixRows],
  );

  const consensusDownstreamFeatures = consensusFeatureRows.filter((profile) => profile.downstreamReady);
  const consensusReviewFeatures = consensusFeatureRows.filter((profile) => profile.decision === 'needs_review' && !profile.downstreamReady);
  const consensusBlockedFeatures = consensusFeatureRows.filter((profile) => !profile.downstreamReady && profile.decision !== 'needs_review');
  const consensusTierCounts = useMemo(() => ({
    gold: comparisonMatrixRows.filter((profile) => profile.tierKey === 'gold').length,
    silver: comparisonMatrixRows.filter((profile) => profile.tierKey === 'silver').length,
    bronze: comparisonMatrixRows.filter((profile) => profile.tierKey === 'bronze').length,
  }), [comparisonMatrixRows]);
  const matrixPreviewRows = comparisonMatrixRows.slice(0, 12);

  const applyDecision = (decision, customReason = '') => {
    if (!selectedProfile) return;
    const defaultReason = decision === 'approved'
      ? 'Approved by reviewer because it is considered safe and useful at alert time.'
      : decision === 'needs_review'
        ? 'Needs a human review before it can be approved for model training.'
        : decision === 'blocked_leakage'
          ? 'Blocked as leakage because it is too close to the answer or the target outcome.'
          : decision === 'blocked_post_outcome'
            ? 'Blocked because the field is only known later in the workflow and is not safe at alert time.'
            : 'Excluded because it is weak or redundant relative to stronger approved features.';
    setOverrides((prev) => ({
      ...prev,
      [selectedProfile.feature]: {
        decision,
        reason: customReason.trim() || defaultReason,
      },
    }));
  };

  const clearDecisionOverride = () => {
    if (!selectedProfile) return;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedProfile.feature];
      return next;
    });
  };

  const approvedProfiles = profiles.filter((profile) => profile.decision === 'approved');
  const excludedProfiles = profiles.filter((profile) => profile.decision !== 'approved');
  const appliedGovernanceStep = (Array.isArray(steps) ? steps : []).find((step) => (
    step?.type === 'drop_columns'
    && ['feature_governance_default_exclusions', 'feature_governance_consensus_exclusions'].includes(String(step?.reason || ''))
  ));
  const appliedGovernanceMode = String(appliedGovernanceStep?.reason || '').includes('consensus')
    ? 'Common-selected feature set'
    : appliedGovernanceStep
      ? 'Governed approved feature set'
      : '';
  const appliedGovernanceExcludedCount = Array.isArray(appliedGovernanceStep?.columns)
    ? appliedGovernanceStep.columns.length
    : 0;
  const appliedGovernanceKeptCount = Math.max(0, profiles.length - appliedGovernanceExcludedCount);

  const applyGovernedFeatureSet = () => {
    const nextExcluded = excludedProfiles.map((profile) => profile.feature).filter(Boolean);
    const preservedSteps = (Array.isArray(steps) ? steps : []).filter((step) => !(
      step?.type === 'drop_columns'
      && ['feature_governance_default_exclusions', 'feature_governance_consensus_exclusions'].includes(String(step?.reason || ''))
    ));
    const nextSteps = nextExcluded.length
      ? [...preservedSteps, { type: 'drop_columns', columns: nextExcluded, reason: 'feature_governance_default_exclusions' }]
      : preservedSteps;
    onStepsChange(nextSteps);
    setApplyFeedback({
      tone: 'success',
      message: `Approved feature set applied. ${approvedProfiles.length} feature${approvedProfiles.length === 1 ? '' : 's'} will flow into training and ${nextExcluded.length} feature${nextExcluded.length === 1 ? '' : 's'} are now excluded in preprocessing.`,
    });
  };

  const applyConsensusFeatureSet = () => {
    const keepSet = new Set(consensusDownstreamFeatures.map((profile) => profile.feature));
    const nextExcluded = profiles
      .filter((profile) => !keepSet.has(profile.feature))
      .map((profile) => profile.feature)
      .filter(Boolean);
    const preservedSteps = (Array.isArray(steps) ? steps : []).filter((step) => !(
      step?.type === 'drop_columns'
      && ['feature_governance_default_exclusions', 'feature_governance_consensus_exclusions'].includes(String(step?.reason || ''))
    ));
    const nextSteps = nextExcluded.length
      ? [...preservedSteps, { type: 'drop_columns', columns: nextExcluded, reason: 'feature_governance_consensus_exclusions' }]
      : preservedSteps;
    onStepsChange(nextSteps);
    setApplyFeedback({
      tone: 'success',
      message: `Common-selected feature set applied. ${consensusDownstreamFeatures.length} shared feature${consensusDownstreamFeatures.length === 1 ? '' : 's'} are now flowing forward and ${nextExcluded.length} remaining feature${nextExcluded.length === 1 ? '' : 's'} are excluded in the preprocessing pipeline.`,
    });
  };

  useEffect(() => {
    if (!applyFeedback) return undefined;
    const timer = window.setTimeout(() => setApplyFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [applyFeedback]);

  const groupedApproved = groupBySourceTable(approvedProfiles);
  const groupedExcluded = groupBySourceTable(excludedProfiles);
  const firewallChecks = Array.isArray(workbench?.firewall?.checks) ? workbench.firewall.checks : [];
  const highRiskProfiles = profiles.filter((profile) => profile.leakageRisk === 'high');
  const businessMode = safeLower(persona) !== 'technical';
  const reviewQueue = profiles.filter((profile) => profile.decision === 'needs_review');
  const selectedMeta = selectedProfile ? DECISION_META[selectedProfile.decision] : null;
  const selectedVisibleIndex = selectedFeature
    ? visibleProfiles.findIndex((profile) => profile.feature === selectedFeature)
    : -1;
  const visibleReviewCount = visibleProfiles.length;
  const businessReviewQueue = reviewQueue.slice(0, 3);
  const businessVisibleProfiles = visibleProfiles;

  const openFeatureReview = (feature) => {
    if (feature) setSelectedFeature(feature);
    setReviewModalOpen(true);
  };

  const jumpToReviewIndex = (offset) => {
    if (!visibleProfiles.length) return;
    const currentIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0;
    const nextIndex = Math.max(0, Math.min(visibleProfiles.length - 1, currentIndex + offset));
    setSelectedFeature(visibleProfiles[nextIndex].feature);
  };

  const exportBusinessSummary = useCallback(() => {
    const popup = window.open('', '_blank', 'width=980,height=760');
    if (!popup) return;

    const reviewItems = businessReviewQueue.map((profile) => `
      <li><strong>${escapeHtml(profile.displayName)}</strong>: ${escapeHtml(profile.businessExplanation)}</li>
    `).join('');
    const featureCards = profiles.map((profile) => `
      <div class="feature-card">
        <div class="feature-title">${escapeHtml(profile.displayName)}</div>
        <div class="feature-verdict">${escapeHtml(businessVerdictText(profile.decision))}</div>
        <p><strong>What it is:</strong> ${escapeHtml(featureMeaning(profile.feature))}</p>
        <p><strong>What high values mean:</strong> ${escapeHtml(whatHighValuesMean(profile.feature))}</p>
        <p><strong>AML relevance:</strong> ${escapeHtml(amlRelevance(profile.feature))}</p>
        <p><strong>Risk if included wrongly:</strong> ${escapeHtml(riskIfIncludedWrongly(profile))}</p>
        <p><strong>Safety:</strong> ${escapeHtml(businessSafetyLabel(profile))}</p>
      </div>
    `).join('');

    popup.document.write(`
      <html>
        <head>
          <title>Feature Governance Summary</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 28px; color: #172033; }
            h1 { font-size: 24px; margin: 0 0 6px; }
            h2 { font-size: 16px; margin: 20px 0 8px; }
            p, li { font-size: 12px; line-height: 1.5; }
            .meta { color: #556070; margin-bottom: 16px; }
            .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
            .summary-card { border: 1px solid #d9e1ea; border-radius: 10px; padding: 12px; }
            .summary-label { font-size: 11px; text-transform: uppercase; color: #d04a02; font-weight: 700; }
            .summary-value { font-size: 28px; font-weight: 700; margin-top: 6px; }
            .feature-card { border: 1px solid #d9e1ea; border-radius: 10px; padding: 12px; margin-bottom: 10px; break-inside: avoid; }
            .feature-title { font-size: 14px; font-weight: 700; }
            .feature-verdict { font-size: 11px; color: #556070; text-transform: uppercase; margin-top: 4px; }
            @media print {
              body { margin: 18px; }
              .feature-card { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>Feature Governance Summary</h1>
          <div class="meta">Business view for compliance sign-off. Written without statistical tables.</div>
          <div class="summary-grid">
            <div class="summary-card"><div class="summary-label">Approved</div><div class="summary-value">${approvedCount}</div><p>Safe to flow into model training now.</p></div>
            <div class="summary-card"><div class="summary-label">Blocked</div><div class="summary-value">${blockedCount}</div><p>Would introduce leakage, timing issues, or unnecessary duplication.</p></div>
            <div class="summary-card"><div class="summary-label">Need sign-off</div><div class="summary-value">${reviewCount}</div><p>Business review is still required.</p></div>
          </div>
          <p><strong>Overall health:</strong> ${escapeHtml(healthSummary)}</p>
          <h2>Features needing business input</h2>
          <ul>${reviewItems || '<li>No open review items.</li>'}</ul>
          <h2>Feature-by-feature sign-off notes</h2>
          ${featureCards}
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  }, [approvedCount, blockedCount, businessReviewQueue, healthSummary, profiles, reviewCount]);

  return (
    <Stack spacing={2}>
      <SectionCard
        eyebrow="Header + Summary"
        title="Feature Governance & Selection"
        subtitle={isBusinessView
          ? 'Review each field in plain English before it is allowed into model training.'
          : 'Review and approve safe features before model training.'}
        action={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={0.7}>
              <Chip
                clickable
                onClick={() => setViewMode('business')}
                label="Business View"
                sx={{
                  bgcolor: isBusinessView ? T.orangeLight : T.surfaceAlt,
                  color: isBusinessView ? T.orange : T.text,
                  border: `1px solid ${isBusinessView ? T.orange : T.border}`,
                  fontWeight: 700,
                }}
              />
              <Chip
                clickable
                onClick={() => setViewMode('technical')}
                label="Technical View"
                sx={{
                  bgcolor: !isBusinessView ? T.orangeLight : T.surfaceAlt,
                  color: !isBusinessView ? T.orange : T.text,
                  border: `1px solid ${!isBusinessView ? T.orange : T.border}`,
                  fontWeight: 700,
                }}
              />
            </Stack>
            {isBusinessView && (
              <Button
                variant="outlined"
                onClick={exportBusinessSummary}
                sx={{ borderColor: T.border, color: T.text }}
              >
                Export Sign-Off PDF
              </Button>
            )}
          </Stack>
        )}>
        <Stack spacing={1.5}>
          <Alert severity="warning" icon={<WarningAmber />} sx={{ borderRadius: 1.75, fontSize: 12 }}>
            This step happens before model training. It keeps leaky, delayed, biased, and low-value fields out of the AML false-positive suppression model.
          </Alert>
          {isBusinessView ? (
            <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.75, fontSize: 12 }}>
              Business view hides statistical jargon. It shows what each field means, whether it is safe when the alert fires, and whether it should be approved for training.
            </Alert>
          ) : (
            <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.75, fontSize: 12 }}>
              High predictive power alone is never enough. A feature must also be available at alert time, operationally valid, and not too close to the answer.
            </Alert>
          )}
          {error && (
            <Alert severity="error" icon={<ErrorOutline />} sx={{ borderRadius: 1.75, fontSize: 12 }}>
              {error}
            </Alert>
          )}
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: isBusinessView
                ? '1fr'
                : '1fr',
              '@media (min-width: 1880px)': isBusinessView
                ? {}
                : { gridTemplateColumns: 'minmax(420px, 0.95fr) minmax(760px, 1.45fr)' },
              alignItems: 'stretch',
            }}
          >
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 2, p: 1.5, bgcolor: T.surfaceAlt, minWidth: 0 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text, mb: 1 }}>
                {isBusinessView ? 'Business sign-off summary' : 'Leakage and readiness summary'}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: isBusinessView
                    ? { xs: '1fr', md: 'repeat(auto-fit, minmax(170px, 1fr))' }
                    : 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 1,
                }}
              >
                {(isBusinessView ? businessSummaryCards : summaryCards).map((card) => (
                  <Paper key={card.label} elevation={0} sx={{ borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: '#fff', p: 1.1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.orange, textTransform: 'uppercase', lineHeight: 1.2, wordBreak: 'break-word' }}>
                      {card.label}
                    </Typography>
                    <Typography sx={{ fontSize: { xs: 24, lg: 26 }, fontWeight: 800, color: T.text, lineHeight: 1.1, mt: 0.35 }}>
                      {card.value}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.35 }}>
                      {card.meta}
                    </Typography>
                  </Paper>
                ))}
              </Box>
              {isBusinessView && (
                <Paper elevation={0} sx={{ mt: 1, borderRadius: 1.5, border: `1px solid ${T.successBorder}`, bgcolor: T.successBg, p: 1.1 }}>
                  <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.success, textTransform: 'uppercase' }}>
                    Overall health
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: T.text, mt: 0.35 }}>
                    {healthSummary}
                  </Typography>
                </Paper>
              )}
            </Paper>

            {!isBusinessView && (
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 2, p: 1.5, bgcolor: '#fff', minWidth: 0 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                    Feature selection techniques used
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.25 }}>
                    Pick the technique here, see what it does, and review the scored or flagged features without leaving the governance screen.
                  </Typography>
                </Box>
                {activeTechnique && (
                  <Chip
                    label={`Recommended now: ${techniqueLookup[recommendedTechniqueId]?.label || activeTechnique.label}`}
                    size="small"
                    sx={{ bgcolor: T.successBg, color: T.success, fontWeight: 700 }}
                  />
                )}
              </Stack>

              <Alert severity="success" icon={<AutoFixHigh />} sx={{ mb: 1, borderRadius: 1.5, fontSize: 11.5 }}>
                Start with <strong>{techniqueLookup[recommendedTechniqueId]?.label || 'Information Gain'}</strong>. Use <strong>Chi-Square</strong> for categorical fields, <strong>Variance Threshold</strong> for near-constant numeric fields, and <strong>Correlation Filter / VIF</strong> for duplicate numeric signals.
              </Alert>

              <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                {quickTechniques.map((tech) => (
                  <Chip
                    key={tech.id}
                    label={tech.label}
                    clickable
                    onClick={() => setTechniqueId(String(tech.id))}
                    sx={{
                      bgcolor: techniqueId === tech.id ? T.orangeLight : T.surfaceAlt,
                      color: techniqueId === tech.id ? T.orange : T.text,
                      border: `1px solid ${techniqueId === tech.id ? T.orange : T.border}`,
                      fontWeight: 700,
                    }}
                  />
                ))}
              </Stack>
              <Typography sx={{ fontSize: 11, color: T.textMuted, mb: 1 }}>
                Quick chips show the shortlist. All {techniqueCatalog.length} technique{techniqueCatalog.length === 1 ? '' : 's'} returned by the backend can still be chosen from the selector below.
              </Typography>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{ mb: 1, minWidth: 0 }}>
                <FormControl size="small" sx={{ minWidth: { xs: '100%', lg: 280 }, flexShrink: 0 }}>
                  <InputLabel>Technique</InputLabel>
                  <Select value={techniqueId} label="Technique" onChange={(event) => setTechniqueId(String(event.target.value))} sx={{ fontSize: 12 }}>
                    {techniqueCatalog.map((tech) => (
                      <MenuItem key={tech.id} value={tech.id}>{tech.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {activeTechnique && (
                  <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1, flex: 1, minWidth: 0, bgcolor: T.surfaceAlt }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                      Plain-language question
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: T.text, mt: 0.35 }}>
                      {activeTechnique.businessQuestion}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.55 }}>
                      Technical method: <strong>{activeTechnique.label}</strong>. {activeTechnique.useWhen || activeTechnique.description}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.35 }}>
                      <strong>Watch-out:</strong> {activeTechnique.caution || 'Governance still overrides score-only evidence.'}
                    </Typography>
                  </Paper>
                )}
              </Stack>

              <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, bgcolor: T.surfaceAlt }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${T.border}` }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                    Technique results
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!activeTechniqueRows.length}
                      onClick={() => setTechniqueResultsDialogOpen(true)}
                      sx={{ textTransform: 'none', borderColor: T.border, color: T.text, fontWeight: 700 }}
                    >
                      Open full list
                    </Button>
                    <Chip label={`${activeTechniqueRows.length} row${activeTechniqueRows.length === 1 ? '' : 's'}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                  </Stack>
                </Stack>
                {!!activeTechniqueTopRows.length && (
                  <Box sx={{ px: 1, pt: 1, display: 'grid', gap: 0.9, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                    {activeTechniqueTopRows.slice(0, 4).map((row) => (
                      <Paper key={row.id} elevation={0} sx={{ borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: '#fff', p: 1 }}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography sx={{ fontSize: 12.25, fontWeight: 800, color: T.text }}>
                            {row.displayName}
                          </Typography>
                          <Chip label={row.scoreText} size="small" sx={{ bgcolor: T.orangeLight, color: T.orange, fontWeight: 700 }} />
                        </Stack>
                        <Typography sx={{ fontSize: 10.5, color: T.textMuted, textTransform: 'uppercase', mt: 0.45 }}>
                          Plain-English reason
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: T.text, mt: 0.2, lineHeight: 1.55 }}>
                          {clip(row.businessExplanation, 125)}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: T.textMuted, textTransform: 'uppercase', mt: 0.7 }}>
                          Technical reason
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.2, lineHeight: 1.5 }}>
                          {clip(row.technicalExplanation, 125)}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                )}
                <ScrollArea height={165} sx={{ px: 0.75, py: 0.4 }}>
                  {loading ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 4 }}>
                      <CircularProgress size={24} sx={{ color: T.orange }} />
                    </Stack>
                  ) : activeTechniqueRows.length ? (
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <Box component="thead">
                        <Box component="tr">
                          {['Feature', 'Score', 'Why this row appears'].map((header) => (
                            <Box key={header} component="th" sx={{ textAlign: 'left', fontSize: 10.5, color: T.textMuted, px: 1, py: 0.7, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, bgcolor: T.surfaceAlt, zIndex: 1 }}>
                              {header}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                      <Box component="tbody">
                        {activeTechniqueRows.slice(0, 10).map((row, index) => (
                          <Box component="tr" key={`${activeTechnique?.id || 'tech'}-${row.feature || index}`}>
                            <Box component="td" sx={{ px: 1, py: 0.8, borderBottom: `1px solid ${T.border}`, fontWeight: 700 }}>
                              {humanize(row.feature || '-')}
                            </Box>
                            <Box component="td" sx={{ px: 1, py: 0.8, borderBottom: `1px solid ${T.border}`, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                              {fmtScore(row.score ?? row.rank_value, 4)}
                            </Box>
                            <Box component="td" sx={{ px: 1, py: 0.8, borderBottom: `1px solid ${T.border}`, color: T.textMuted }}>
                              {clip(row.reason || activeTechnique?.description || '-', 92)}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    <Alert severity="info" icon={<InfoOutlined />} sx={{ m: 1, borderRadius: 1.5, fontSize: 11.5 }}>
                      {activeTechniqueMessage || 'No specific rows were returned for this technique on the current feature set. The technique is still available, but nothing was flagged strongly enough to list here.'}
                    </Alert>
                  )}
                </ScrollArea>
                {activeTechniqueRows.length > 10 && (
                  <Typography sx={{ px: 1.25, pb: 1, fontSize: 10.8, color: T.textMuted }}>
                    Showing the top 10 rows here to keep the page compact. Use <strong>Open full list</strong> for the full technique result set.
                  </Typography>
                )}
              </Paper>

              <Paper elevation={0} sx={{ mt: 1, border: `1px solid ${T.border}`, borderRadius: 1.5, bgcolor: '#fff' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${T.border}` }}>
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                      Comparative vote matrix and downstream feature set
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.2 }}>
                      Choose as many techniques as you want, compare them side by side, then keep only the features that earn enough support under your vote rule.
                    </Typography>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                    <Button
                      variant="outlined"
                      disabled={!comparisonMatrixRows.length}
                      onClick={() => setComparisonMatrixDialogOpen(true)}
                      sx={{ textTransform: 'none', borderColor: T.border, color: T.text, fontWeight: 700 }}
                    >
                      Open full vote matrix
                    </Button>
                    <Button
                      variant="contained"
                      disabled={!consensusDownstreamFeatures.length}
                      onClick={applyConsensusFeatureSet}
                      sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}>
                      {consensusDownstreamFeatures.length
                        ? `Apply current vote set (${consensusDownstreamFeatures.length})`
                        : 'Apply current vote set'}
                    </Button>
                  </Stack>
                </Stack>

                <Box sx={{ p: 1.25 }}>
                  {applyFeedback && (
                    <Alert
                      severity={applyFeedback.tone || 'success'}
                      icon={<CheckCircle />}
                      sx={{ mb: 1.1, borderRadius: 1.5, fontSize: 11.5 }}
                    >
                      {applyFeedback.message}
                    </Alert>
                  )}
                  {appliedGovernanceStep && (
                    <Alert severity="success" icon={<CheckCircle />} sx={{ mb: 1.1, borderRadius: 1.5, fontSize: 11.5 }}>
                      {appliedGovernanceMode} is currently active in the preprocessing pipeline. {appliedGovernanceKeptCount} feature{appliedGovernanceKeptCount === 1 ? '' : 's'} are flowing forward and {appliedGovernanceExcludedCount} feature{appliedGovernanceExcludedCount === 1 ? '' : 's'} are being removed by the governed drop-columns step.
                    </Alert>
                  )}

                  <Alert
                    severity={backendTechniqueAudit.livePayload ? 'info' : 'warning'}
                    icon={<InfoOutlined />}
                    sx={{ mb: 1.1, borderRadius: 1.5, fontSize: 11.5 }}
                  >
                    Backend audit: {backendTechniqueAudit.livePayload ? 'live' : 'fallback'} payload currently exposes {backendTechniqueAudit.totalCount} real technique{backendTechniqueAudit.totalCount === 1 ? '' : 's'} for this screen ({backendTechniqueAudit.scoreCount} score-based + {backendTechniqueAudit.filterCount} filter-based). The current payload still does not compute {backendTechniqueAudit.missingFamilies.join(', ')}.
                  </Alert>

                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{ mb: 1.1 }}>
                    <FormControl size="small" sx={{ minWidth: 320 }}>
                      <InputLabel>Compare techniques</InputLabel>
                      <Select
                        multiple
                        value={comparisonTechniqueIds}
                        label="Compare techniques"
                        onChange={(event) => setComparisonTechniqueIds(
                          Array.isArray(event.target.value)
                            ? event.target.value.map((value) => String(value))
                            : []
                        )}
                        renderValue={(selected) => (selected || []).map((id) => techniqueLookup[String(id)]?.label || String(id)).join(', ')}
                        sx={{ fontSize: 12 }}>
                        {techniqueCatalog.map((tech) => (
                          <MenuItem key={tech.id} value={String(tech.id)}>
                            {tech.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Keep if supported by</InputLabel>
                      <Select
                        value={String(Math.max(1, comparisonMinSupport))}
                        label="Keep if supported by"
                        onChange={(event) => setComparisonMinSupport(Math.max(1, Number(event.target.value) || 1))}
                        sx={{ fontSize: 12 }}>
                        {Array.from({ length: Math.max(1, comparisonTechniqueIds.length) }, (_, index) => index + 1).map((count) => (
                          <MenuItem key={`support-${count}`} value={String(count)}>
                            At least {count} technique{count === 1 ? '' : 's'}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
                      <Chip
                        clickable
                        onClick={() => setIncludeReviewInConsensus(false)}
                        label="Approved only"
                        sx={{
                          bgcolor: includeReviewInConsensus ? T.surfaceAlt : T.orangeLight,
                          color: includeReviewInConsensus ? T.text : T.orange,
                          border: `1px solid ${includeReviewInConsensus ? T.border : T.orange}`,
                          fontWeight: 700,
                        }}
                      />
                      <Chip
                        clickable
                        onClick={() => setIncludeReviewInConsensus(true)}
                        label="Approved + review"
                        sx={{
                          bgcolor: includeReviewInConsensus ? T.orangeLight : T.surfaceAlt,
                          color: includeReviewInConsensus ? T.orange : T.text,
                          border: `1px solid ${includeReviewInConsensus ? T.orange : T.border}`,
                          fontWeight: 700,
                        }}
                      />
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mb: 1.1 }}>
                    {comparisonTechniqueSummaries.map((summary) => (
                      <Chip
                        key={`summary-${summary.id}`}
                        label={`${summary.label}: ${summary.count}`}
                        size="small"
                        sx={{ bgcolor: T.surfaceAlt, border: `1px solid ${T.border}` }}
                      />
                    ))}
                    <Chip label={`Gold: ${consensusTierCounts.gold}`} size="small" sx={{ bgcolor: CONSENSUS_TIER_META.gold.bg, color: CONSENSUS_TIER_META.gold.color, fontWeight: 700 }} />
                    <Chip label={`Silver: ${consensusTierCounts.silver}`} size="small" sx={{ bgcolor: CONSENSUS_TIER_META.silver.bg, color: CONSENSUS_TIER_META.silver.color, fontWeight: 700 }} />
                    <Chip label={`Bronze: ${consensusTierCounts.bronze}`} size="small" sx={{ bgcolor: CONSENSUS_TIER_META.bronze.bg, color: CONSENSUS_TIER_META.bronze.color, fontWeight: 700 }} />
                    <Chip label={`Current vote set: ${consensusFeatureRows.length}`} size="small" sx={{ bgcolor: T.infoBg, color: T.info, fontWeight: 700 }} />
                    <Chip label={`Flowing downstream: ${consensusDownstreamFeatures.length}`} size="small" sx={{ bgcolor: T.successBg, color: T.success, fontWeight: 700 }} />
                  </Stack>

                  {!!comparisonTechniqueSummaries.length && (
                    <Paper elevation={0} sx={{ mb: 1.1, border: `1px solid ${T.border}`, borderRadius: 1.25, p: 1, bgcolor: T.surfaceAlt }}>
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' } }}>
                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                            Vote logic
                          </Typography>
                          <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.45 }}>
                            Gold means all selected techniques supported the feature. Silver means several selected techniques supported it. Bronze means only one or a small minority supported it.
                          </Typography>
                          <Typography sx={{ fontSize: 11.25, color: T.textMuted, mt: 0.55 }}>
                            The current downstream rule keeps features supported by at least {comparisonMinSupport} selected technique{comparisonMinSupport === 1 ? '' : 's'} and then checks whether governance still approves them for alert-time use.
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                            Technical note
                          </Typography>
                          <Typography sx={{ fontSize: 11.25, color: T.textMuted, mt: 0.45, lineHeight: 1.6 }}>
                            Score techniques contribute shortlist votes from their backend top-{backendTechniqueAudit.topN} keep set. Filter techniques contribute pass or flagged votes from the backend filter output. Selected techniques: {comparisonTechniqueSummaries.map((summary) => summary.label).join(', ')}.
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  )}

                  <Paper elevation={0} sx={{ mb: 1.1, border: `1px solid ${T.border}`, borderRadius: 1.25, overflow: 'hidden' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.9, bgcolor: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                      <Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                          Comparative vote matrix
                        </Typography>
                        <Typography sx={{ fontSize: 10.8, color: T.textMuted, mt: 0.2 }}>
                          Each selected technique gets its own column. Gold, Silver, and Bronze are assigned from the total support count.
                        </Typography>
                      </Box>
                      <Chip label={`${comparisonMatrixRows.length} voted feature${comparisonMatrixRows.length === 1 ? '' : 's'}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                    </Stack>
                    {comparisonTechniqueSummaries.length ? (
                      <Box sx={{ overflowX: 'auto' }}>
                        <Box component="table" sx={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', fontSize: 12 }}>
                          <Box component="thead">
                            <Box component="tr">
                              {['Feature', 'Tier', 'Votes', ...comparisonTechniqueSummaries.map((summary) => summary.label)].map((header) => (
                                <Box
                                  key={`matrix-head-${header}`}
                                  component="th"
                                  sx={{
                                    textAlign: 'left',
                                    fontSize: 10.5,
                                    color: T.textMuted,
                                    px: 1,
                                    py: 0.8,
                                    borderBottom: `1px solid ${T.border}`,
                                    bgcolor: '#fff',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {header}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                          <Box component="tbody">
                            {matrixPreviewRows.map((profile) => (
                              <Box component="tr" key={`matrix-row-${profile.feature}`}>
                                <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, minWidth: 300, verticalAlign: 'top' }}>
                                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                                    {profile.displayName}
                                  </Typography>
                                  <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.2, lineHeight: 1.55 }}>
                                    Plain English: {clip(profile.businessConsensusText, 170)}
                                  </Typography>
                                  <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.35, lineHeight: 1.5 }}>
                                    Technical: {clip(profile.technicalConsensusText, 170)}
                                  </Typography>
                                </Box>
                                <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                  <Chip
                                    label={profile.tierMeta.label}
                                    size="small"
                                    sx={{
                                      bgcolor: profile.tierMeta.bg,
                                      color: profile.tierMeta.color,
                                      border: `1px solid ${profile.tierMeta.border}`,
                                      fontWeight: 700,
                                    }}
                                  />
                                  <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45 }}>
                                    {profile.tierMeta.businessLabel}
                                  </Typography>
                                </Box>
                                <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                                    {profile.supportCount}/{profile.techniqueCount}
                                  </Typography>
                                  <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.35 }}>
                                    {profile.downstreamReady ? 'Flows if applied' : profile.eligible ? 'Blocked by governance' : 'Below vote rule'}
                                  </Typography>
                                </Box>
                                {profile.techniqueCells.map((cell) => (
                                  <Box
                                    key={`matrix-cell-${profile.feature}-${cell.id}`}
                                    component="td"
                                    sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, minWidth: 128, verticalAlign: 'top' }}
                                  >
                                    <Chip
                                      label={cell.scoreText}
                                      size="small"
                                      sx={{
                                        bgcolor: cell.isSupported ? T.successBg : cell.isFlagged ? T.warnBg : T.surfaceAlt,
                                        color: cell.isSupported ? T.success : cell.isFlagged ? T.warn : T.textMuted,
                                        border: `1px solid ${cell.isSupported ? T.successBorder : cell.isFlagged ? T.warnBorder : T.border}`,
                                        fontWeight: 700,
                                      }}
                                    />
                                    <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45, lineHeight: 1.45 }}>
                                      {clip(cell.scope === 'filter' ? cell.businessText : cell.technicalText, 82)}
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      </Box>
                    ) : (
                      <Alert severity="info" icon={<InfoOutlined />} sx={{ m: 1.25, borderRadius: 1.5, fontSize: 11.5 }}>
                        Choose at least one technique to build the vote matrix.
                      </Alert>
                    )}
                    {comparisonMatrixRows.length > matrixPreviewRows.length && (
                      <Typography sx={{ px: 1.25, py: 0.8, fontSize: 10.8, color: T.textMuted, borderTop: `1px solid ${T.border}` }}>
                        Showing the first {matrixPreviewRows.length} voted rows here. Use <strong>Open full vote matrix</strong> for the complete comparison.
                      </Typography>
                    )}
                  </Paper>

                  <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
                    <Paper elevation={0} sx={{ border: `1px solid ${T.successBorder}`, borderRadius: 1.25, overflow: 'hidden' }}>
                      <Box sx={{ px: 1, py: 0.85, bgcolor: T.successBg, borderBottom: `1px solid ${T.successBorder}` }}>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: T.success }}>
                          Flowing downstream now
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.15 }}>
                          These are the common features from the chosen techniques that will be kept for training when you apply the consensus set.
                        </Typography>
                      </Box>
                      <ScrollArea height={180} sx={{ p: 1 }}>
                        {consensusDownstreamFeatures.length ? (
                          <Stack spacing={0.75}>
                            {consensusDownstreamFeatures.map((profile) => (
                              <Paper key={`consensus-keep-${profile.feature}`} elevation={0} sx={{ border: `1px solid ${T.successBorder}`, borderRadius: 1.2, p: 0.9 }}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                                  {profile.displayName}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.2 }}>
                                  Supported by {profile.supportCount} technique{profile.supportCount === 1 ? '' : 's'} · {profile.matchedTechniques.map((id) => techniqueLookup[id]?.label || id).join(', ')}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                        ) : (
                          <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                            No common downstream features yet. Add more techniques or reduce the support threshold.
                          </Alert>
                        )}
                      </ScrollArea>
                    </Paper>

                    <Paper elevation={0} sx={{ border: `1px solid ${T.warnBorder}`, borderRadius: 1.25, overflow: 'hidden' }}>
                      <Box sx={{ px: 1, py: 0.85, bgcolor: T.warnBg, borderBottom: `1px solid ${T.warnBorder}` }}>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: T.warn }}>
                          Common features that still need attention
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.15 }}>
                          These were common across techniques too, but governance still marks them for review or exclusion.
                        </Typography>
                      </Box>
                      <ScrollArea height={180} sx={{ p: 1 }}>
                        {[...consensusReviewFeatures, ...consensusBlockedFeatures].length ? (
                          <Stack spacing={0.75}>
                            {[...consensusReviewFeatures, ...consensusBlockedFeatures].map((profile) => (
                              <Paper
                                key={`consensus-review-${profile.feature}`}
                                elevation={0}
                                sx={{
                                  border: `1px solid ${profile.decision === 'needs_review' ? T.warnBorder : T.dangerBorder}`,
                                  borderRadius: 1.2,
                                  p: 0.9,
                                  bgcolor: profile.decision === 'needs_review' ? '#fffdf8' : T.dangerBg,
                                }}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                                  {profile.displayName}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.2 }}>
                                  {profile.decisionLabel} · {profile.matchedTechniques.map((id) => techniqueLookup[id]?.label || id).join(', ')}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                        ) : (
                          <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                            No common features are currently blocked or waiting for review.
                          </Alert>
                        )}
                      </ScrollArea>
                    </Paper>
                  </Box>
                </Box>
              </Paper>
              <Dialog
                open={comparisonMatrixDialogOpen}
                onClose={() => setComparisonMatrixDialogOpen(false)}
                fullWidth
                maxWidth="xl"
              >
                <DialogTitle sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                    <Box>
                      <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.text }}>
                        Comparative vote matrix
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.35 }}>
                        Gold means every selected technique supported the feature. Silver means several did. Bronze means only a few did.
                      </Typography>
                    </Box>
                    <IconButton onClick={() => setComparisonMatrixDialogOpen(false)} size="small">
                      <Close fontSize="small" />
                    </IconButton>
                  </Stack>
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                  {comparisonTechniqueSummaries.length ? (
                    <Box sx={{ overflowX: 'auto' }}>
                      <Box component="table" sx={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 12 }}>
                        <Box component="thead">
                          <Box component="tr">
                            {['Feature', 'Governance', 'Tier', 'Votes', ...comparisonTechniqueSummaries.map((summary) => summary.label)].map((header) => (
                              <Box
                                key={`dialog-matrix-head-${header}`}
                                component="th"
                                sx={{
                                  textAlign: 'left',
                                  fontSize: 10.5,
                                  color: T.textMuted,
                                  px: 1,
                                  py: 0.85,
                                  borderBottom: `1px solid ${T.border}`,
                                  position: 'sticky',
                                  top: 0,
                                  bgcolor: '#fff',
                                  zIndex: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {header}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                        <Box component="tbody">
                          {comparisonMatrixRows.map((profile) => (
                            <Box component="tr" key={`dialog-matrix-row-${profile.feature}`}>
                              <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, minWidth: 260, verticalAlign: 'top' }}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                                  {profile.displayName}
                                </Typography>
                                <Typography sx={{ fontSize: 10.75, color: T.textMuted, mt: 0.25 }}>
                                  {profile.sourceTable} · {profile.featureFamily}
                                </Typography>
                                <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45, lineHeight: 1.5 }}>
                                  {profile.businessConsensusText}
                                </Typography>
                              </Box>
                              <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top', minWidth: 200 }}>
                                <Chip
                                  label={profile.decisionLabel}
                                  size="small"
                                  sx={{
                                    bgcolor: DECISION_META[profile.decision]?.bg || T.surfaceAlt,
                                    color: DECISION_META[profile.decision]?.color || T.text,
                                    border: `1px solid ${DECISION_META[profile.decision]?.border || T.border}`,
                                    fontWeight: 700,
                                  }}
                                />
                                <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45, lineHeight: 1.45 }}>
                                  {profile.technicalConsensusText}
                                </Typography>
                              </Box>
                              <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                <Chip
                                  label={profile.tierMeta.label}
                                  size="small"
                                  sx={{
                                    bgcolor: profile.tierMeta.bg,
                                    color: profile.tierMeta.color,
                                    border: `1px solid ${profile.tierMeta.border}`,
                                    fontWeight: 700,
                                  }}
                                />
                                <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45 }}>
                                  {profile.tierMeta.businessLabel}
                                </Typography>
                              </Box>
                              <Box component="td" sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                                  {profile.supportCount}/{profile.techniqueCount}
                                </Typography>
                                <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.35 }}>
                                  {profile.downstreamReady ? 'Ready to flow' : profile.eligible ? 'Governance blocked' : 'Below vote rule'}
                                </Typography>
                              </Box>
                              {profile.techniqueCells.map((cell) => (
                                <Box
                                  key={`dialog-matrix-cell-${profile.feature}-${cell.id}`}
                                  component="td"
                                  sx={{ px: 1, py: 0.9, borderBottom: `1px solid ${T.border}`, minWidth: 140, verticalAlign: 'top' }}
                                >
                                  <Chip
                                    label={cell.scoreText}
                                    size="small"
                                    sx={{
                                      bgcolor: cell.isSupported ? T.successBg : cell.isFlagged ? T.warnBg : T.surfaceAlt,
                                      color: cell.isSupported ? T.success : cell.isFlagged ? T.warn : T.textMuted,
                                      border: `1px solid ${cell.isSupported ? T.successBorder : cell.isFlagged ? T.warnBorder : T.border}`,
                                      fontWeight: 700,
                                    }}
                                  />
                                  <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.45, lineHeight: 1.45 }}>
                                    {cell.businessText}
                                  </Typography>
                                  <Typography sx={{ fontSize: 10.25, color: T.textMuted, mt: 0.3, lineHeight: 1.4 }}>
                                    {clip(cell.technicalText, 88)}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  ) : (
                    <Alert severity="info" icon={<InfoOutlined />} sx={{ m: 2, borderRadius: 1.5, fontSize: 11.5 }}>
                      Choose at least one technique to build the vote matrix.
                    </Alert>
                  )}
                </DialogContent>
              </Dialog>
              <Dialog
                open={techniqueResultsDialogOpen}
                onClose={() => setTechniqueResultsDialogOpen(false)}
                fullWidth
                maxWidth="lg"
              >
                <DialogTitle sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                    <Box>
                      <Typography sx={{ fontSize: 18, fontWeight: 800, color: T.text }}>
                        {activeTechnique?.label || 'Technique'} results
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.35 }}>
                        {activeTechnique?.businessQuestion || 'Review the full feature ranking and supporting explanation for this technique.'}
                      </Typography>
                    </Box>
                    <IconButton onClick={() => setTechniqueResultsDialogOpen(false)} size="small">
                      <Close fontSize="small" />
                    </IconButton>
                  </Stack>
                </DialogTitle>
                <DialogContent sx={{ p: 2 }}>
                  {!!activeTechniqueTopRows.length && (
                    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, mb: 1.5 }}>
                      {activeTechniqueTopRows.map((row) => (
                        <Paper key={`dialog-${row.id}`} elevation={0} sx={{ borderRadius: 1.5, border: `1px solid ${T.border}`, p: 1.1, bgcolor: T.surfaceAlt }}>
                          <Stack direction="row" justifyContent="space-between" spacing={1}>
                            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                              {row.displayName}
                            </Typography>
                            <Chip label={row.scoreText} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
                          </Stack>
                          <Typography sx={{ fontSize: 11, color: T.text, mt: 0.6, lineHeight: 1.55 }}>
                            {row.businessExplanation}
                          </Typography>
                          <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 0.55, lineHeight: 1.5 }}>
                            {row.technicalExplanation}
                          </Typography>
                        </Paper>
                      ))}
                    </Box>
                  )}
                  {activeTechniqueRows.length ? (
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <Box component="thead">
                        <Box component="tr">
                          {['Feature', 'Score', 'Why this row appears'].map((header) => (
                            <Box key={`dialog-head-${header}`} component="th" sx={{ textAlign: 'left', fontSize: 10.5, color: T.textMuted, px: 1, py: 0.8, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, bgcolor: '#fff', zIndex: 1 }}>
                              {header}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                      <Box component="tbody">
                        {activeTechniqueRows.map((row, index) => (
                          <Box component="tr" key={`dialog-row-${activeTechnique?.id || 'tech'}-${row.feature || index}`}>
                            <Box component="td" sx={{ px: 1, py: 0.85, borderBottom: `1px solid ${T.border}`, fontWeight: 700 }}>
                              {humanize(row.feature || '-')}
                            </Box>
                            <Box component="td" sx={{ px: 1, py: 0.85, borderBottom: `1px solid ${T.border}`, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                              {fmtScore(row.score ?? row.rank_value, 4)}
                            </Box>
                            <Box component="td" sx={{ px: 1, py: 0.85, borderBottom: `1px solid ${T.border}`, color: T.textMuted }}>
                              {row.reason || activeTechnique?.description || '-'}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                      {activeTechniqueMessage || 'No rows are available for this technique yet.'}
                    </Alert>
                  )}
                </DialogContent>
              </Dialog>
            </Paper>
            )}
          </Box>
        </Stack>
      </SectionCard>

      {!isBusinessView && (
      <>
      <SectionCard
        eyebrow="Decision Buckets"
        title="Decision buckets"
        subtitle="Use the buckets first. A highly predictive field is still blocked if it is too close to the answer or not available when the alert is scored.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' }, gap: 1 }}>
          {BUCKETS.map((bucket) => {
            const meta = DECISION_META[bucket.id];
            const count = profiles.filter((profile) => profile.decision === bucket.id).length;
            const isActive = activeBucket === bucket.id;
            return (
              <Paper
                key={bucket.id}
                onClick={() => setActiveBucket((prev) => (prev === bucket.id ? 'all' : bucket.id))}
                elevation={0}
                sx={{
                  borderRadius: 1.75,
                  border: `1px solid ${isActive ? meta.border : T.border}`,
                  bgcolor: isActive ? meta.bg : '#fff',
                  p: 1.2,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  '&:hover': { borderColor: meta.border, transform: 'translateY(-1px)' },
                }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.text, minHeight: 34 }}>
                  {bucket.title}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.textMuted, minHeight: 36, mt: 0.45 }}>
                  {bucket.description}
                </Typography>
                <Typography sx={{ fontSize: 30, fontWeight: 800, color: meta.color, mt: 0.7 }}>
                  {count}
                </Typography>
              </Paper>
            );
          })}
        </Box>
      </SectionCard>

      <SectionCard
        eyebrow="Main Feature Review Workbench"
        title="Review, explain, and decide"
        subtitle="Select a feature from the list, then open the guided review modal to inspect evidence and make the decision one feature at a time.">
        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            gridTemplateColumns: { xs: '1fr', xl: '1.35fr 0.9fr' },
            minHeight: { xs: 'auto', xl: '44vh' },
          }}>
          <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ px: 1.25, py: 1, borderBottom: `1px solid ${T.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                Feature inventory
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} sx={{ mt: 1 }}>
                <TextField
                  size="small"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search feature, reason, or source"
                  sx={{ flex: 1, '& input': { fontSize: 12 } }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Source table</InputLabel>
                  <Select value={sourceFilter} label="Source table" onChange={(event) => setSourceFilter(String(event.target.value))} sx={{ fontSize: 12 }}>
                    {sourceOptions.map((source) => (
                      <MenuItem key={source} value={source}>{source === 'all' ? 'All sources' : source}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Status</InputLabel>
                  <Select value={stateFilter} label="Status" onChange={(event) => setStateFilter(String(event.target.value))} sx={{ fontSize: 12 }}>
                    <MenuItem value="all">All states</MenuItem>
                    <MenuItem value="selected">Selected</MenuItem>
                    <MenuItem value="review">Needs review</MenuItem>
                    <MenuItem value="blocked">Blocked</MenuItem>
                    <MenuItem value="excluded">Excluded</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>Leakage risk</InputLabel>
                  <Select value={riskFilter} label="Leakage risk" onChange={(event) => setRiskFilter(String(event.target.value))} sx={{ fontSize: 12 }}>
                    <MenuItem value="all">All risk</MenuItem>
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            </Box>
            <ScrollArea height="100%" sx={{ p: 1 }}>
              <Stack spacing={0.85}>
                {visibleProfiles.map((profile) => {
                  const meta = DECISION_META[profile.decision];
                  const selected = profile.feature === selectedFeature;
                  return (
                    <Paper
                      key={profile.feature}
                      onClick={() => setSelectedFeature(profile.feature)}
                      elevation={0}
                      sx={{
                        borderRadius: 1.5,
                        border: `1px solid ${selected ? meta.border : T.border}`,
                        bgcolor: selected ? meta.bg : '#fff',
                        p: 1.05,
                        cursor: 'pointer',
                      }}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {profile.displayName}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: T.textMuted, mt: 0.25 }}>
                            {profile.sourceTable} · {humanize(profile.featureType)}
                          </Typography>
                        </Box>
                        <Stack alignItems="flex-end" spacing={0.5}>
                          <Chip label={meta.shortLabel} size="small" sx={{ bgcolor: meta.bg, color: meta.color, fontWeight: 700 }} />
                          <Chip
                            label={`${profile.leakageRisk} risk`}
                            size="small"
                            sx={{
                              bgcolor: profile.leakageRisk === 'high' ? T.dangerBg : profile.leakageRisk === 'medium' ? T.warnBg : T.successBg,
                              color: profile.leakageRisk === 'high' ? T.danger : profile.leakageRisk === 'medium' ? T.warn : T.success,
                              fontWeight: 700,
                            }}
                          />
                          <Button
                            size="small"
                            variant={selected ? 'contained' : 'outlined'}
                            onClick={(event) => {
                              event.stopPropagation();
                              openFeatureReview(profile.feature);
                            }}
                            sx={{
                              minWidth: 84,
                              fontSize: 11,
                              py: 0.1,
                              ...(selected
                                ? { bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }
                                : { borderColor: T.border, color: T.text }),
                            }}>
                            Review
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })}
                {!visibleProfiles.length && (
                  <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                    No features match the current filters.
                  </Alert>
                )}
              </Stack>
            </ScrollArea>
          </Paper>

          <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ px: 1.25, py: 1, borderBottom: `1px solid ${T.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                Review queue
              </Typography>
            </Box>
            <ScrollArea height="100%" sx={{ p: 1.25 }}>
              {selectedProfile ? (
                <Stack spacing={1}>
                  <Paper elevation={0} sx={{ border: `1px solid ${selectedMeta?.border || T.border}`, borderRadius: 1.5, p: 1.1, bgcolor: selectedMeta?.bg || '#fff' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                      Selected for review
                    </Typography>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: T.text, mt: 0.45 }}>
                      {selectedProfile.displayName}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.25 }}>
                      {selectedProfile.sourceTable} · {humanize(selectedProfile.featureType)} · {selectedProfile.featureFamily}
                    </Typography>
                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                      <Chip label={selectedProfile.decisionLabel} size="small" sx={{ bgcolor: selectedMeta?.bg, color: selectedMeta?.color, fontWeight: 700 }} />
                      <Chip label={availabilityLabel(selectedProfile, persona)} size="small" sx={{ bgcolor: T.infoBg, color: T.info, fontWeight: 700 }} />
                      <Chip label={`${selectedProfile.leakageRisk} risk`} size="small" sx={{ bgcolor: T.surfaceAlt, color: T.text, fontWeight: 700 }} />
                    </Stack>
                  </Paper>

                  <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.1 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                      Current decision reason
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: T.text, mt: 0.45 }}>
                      {selectedProfile.decisionReason}
                    </Typography>
                  </Paper>

                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.9 }}>
                    <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1 }}>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                        Visible rows
                      </Typography>
                      <Typography sx={{ fontSize: 22, fontWeight: 800, color: T.text, mt: 0.35 }}>
                        {visibleReviewCount}
                      </Typography>
                    </Paper>
                    <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1 }}>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                        Needs review
                      </Typography>
                      <Typography sx={{ fontSize: 22, fontWeight: 800, color: T.text, mt: 0.35 }}>
                        {reviewQueue.length}
                      </Typography>
                    </Paper>
                  </Box>

                  <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                    <Button
                      variant="contained"
                      onClick={() => openFeatureReview(selectedProfile.feature)}
                      sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}>
                      Open review modal
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={selectedVisibleIndex <= 0}
                      onClick={() => jumpToReviewIndex(-1)}>
                      Previous
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleProfiles.length - 1}
                      onClick={() => jumpToReviewIndex(1)}>
                      Next
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                  Select a feature from the inventory to see its decision summary.
                </Alert>
              )}
            </ScrollArea>
          </Paper>
        </Box>
      </SectionCard>

      <Dialog
        open={reviewModalOpen && Boolean(selectedProfile)}
        onClose={() => setReviewModalOpen(false)}
        fullWidth
        maxWidth="lg">
        <DialogTitle sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Feature Review
              </Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 800, color: T.text }}>
                {selectedProfile?.displayName || 'Review feature'}
              </Typography>
              <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.25 }}>
                Review one feature at a time, then move to the next without scrolling the whole page.
              </Typography>
            </Box>
            <IconButton onClick={() => setReviewModalOpen(false)} size="small">
              <Close />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {selectedProfile && (
            <Box sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                <Chip label={selectedProfile.decisionLabel} size="small" sx={{ bgcolor: selectedMeta?.bg, color: selectedMeta?.color, fontWeight: 700 }} />
                <Chip label={isBusinessView ? businessSafetyLabel(selectedProfile) : availabilityLabel(selectedProfile, persona)} size="small" sx={{ bgcolor: T.infoBg, color: T.info, fontWeight: 700 }} />
                <Chip label={isBusinessView ? businessUniquenessLabel(selectedProfile) : `${selectedProfile.leakageRisk} leakage risk`} size="small" sx={{ bgcolor: T.surfaceAlt, color: T.text, fontWeight: 700 }} />
                {!isBusinessView && selectedProfile.rankPosition != null && <Chip label={`Rank ${selectedProfile.rankPosition}`} size="small" sx={{ bgcolor: T.surfaceAlt, color: T.text }} />}
              </Stack>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.25 }}>
                <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.25 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                    Decision summary
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: T.text, mt: 0.55 }}>
                    {selectedProfile.decisionReason}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted, mt: 0.8 }}>
                    {selectedProfile.businessExplanation}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted, mt: 0.8 }}>
                    {featureMeaning(selectedProfile.feature)}
                  </Typography>
                </Paper>

                <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.25 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                    {isBusinessView ? 'Business interpretation' : 'Technical evidence'}
                  </Typography>
                  {isBusinessView ? (
                    <Stack spacing={0.7} sx={{ mt: 0.55 }}>
                      <Typography sx={{ fontSize: 12.5, color: T.text }}>
                        <strong>What high values mean:</strong> {whatHighValuesMean(selectedProfile.feature)}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: T.text }}>
                        <strong>AML relevance:</strong> {amlRelevance(selectedProfile.feature)}
                      </Typography>
                    </Stack>
                  ) : (
                    <Stack spacing={0.5} sx={{ mt: 0.55 }}>
                      {selectedProfile.primaryScore != null && (
                        <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                          Primary score: <strong>{fmtScore(selectedProfile.primaryScore, 4)}</strong>
                        </Typography>
                      )}
                      {selectedProfile.information_gain != null && (
                        <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                          Information gain: <strong>{fmtScore(selectedProfile.information_gain, 4)}</strong>
                        </Typography>
                      )}
                      {selectedProfile.information_value != null && (
                        <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                          Information value: <strong>{fmtScore(selectedProfile.information_value, 4)}</strong>
                        </Typography>
                      )}
                      {selectedProfile.vif != null && (
                        <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                          VIF: <strong>{fmtScore(selectedProfile.vif, 2)}</strong>
                        </Typography>
                      )}
                      {selectedProfile.maxPartnerCorrelation != null && (
                        <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                          Max partner correlation: <strong>{fmtScore(selectedProfile.maxPartnerCorrelation, 2)}</strong>
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Paper>

                <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.25 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                    {isBusinessView ? 'Risk if included wrongly' : 'Evidence and checks'}
                  </Typography>
                  {isBusinessView ? (
                    <Typography sx={{ fontSize: 12.5, color: T.text, mt: 0.55 }}>
                      {riskIfIncludedWrongly(selectedProfile)}
                    </Typography>
                  ) : (
                    <ScrollArea height={180} sx={{ mt: 0.7 }}>
                      <Stack spacing={0.55}>
                      {(selectedProfile.evidence || []).slice(0, 10).map((item, index) => (
                        <Typography key={`${selectedProfile.feature}-modal-evidence-${index}`} sx={{ fontSize: 12, color: T.textMuted }}>
                          • {item}
                        </Typography>
                      ))}
                      </Stack>
                    </ScrollArea>
                  )}
                </Paper>

                <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.25 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                    Actions
                  </Typography>
                  <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 0.7 }}>
                    <Button size="small" variant="contained" onClick={() => applyDecision('approved', overrideNote)} sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}>
                      {isBusinessView ? 'Yes - approve' : 'Approve'}
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => applyDecision('needs_review', overrideNote)} sx={{ borderColor: T.warnBorder, color: T.warn }}>
                      {isBusinessView ? 'Ask analyst' : 'Mark review'}
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => applyDecision(isBusinessView ? businessBlockDecision(selectedProfile) : 'blocked_leakage', overrideNote)} sx={{ borderColor: T.dangerBorder, color: T.danger }}>
                      {isBusinessView ? 'No - block' : 'Block as leakage'}
                    </Button>
                    {!isBusinessView && (
                      <Button size="small" variant="outlined" onClick={() => applyDecision('weak_redundant', overrideNote || 'Excluded because it is weak or redundant relative to stronger approved features.')} sx={{ borderColor: T.weakBorder, color: '#334155' }}>
                        Exclude as weak
                      </Button>
                    )}
                    {!isBusinessView && (
                      <Button size="small" variant="outlined" onClick={() => applyDecision('weak_redundant', overrideNote || 'Excluded as redundant because another approved feature already covers this signal.')} sx={{ borderColor: T.weakBorder, color: '#334155' }}>
                        Exclude as redundant
                      </Button>
                    )}
                  </Stack>

                  <TextField
                    multiline
                    minRows={3}
                    size="small"
                    fullWidth
                    value={overrideNote}
                    onChange={(event) => setOverrideNote(event.target.value)}
                    placeholder={isBusinessView
                      ? 'Optional note for compliance sign-off. Example: Not used for retail alerts because coverage is incomplete.'
                      : 'Override with reason. Example: Approved after confirming the field is available at alert time and not sourced from downstream investigation workflow.'}
                    sx={{ mt: 1, '& textarea': { fontSize: 12 } }}
                  />

                  <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                    <Button size="small" variant="outlined" onClick={() => applyDecision(selectedProfile.decision, overrideNote)} disabled={!overrideNote.trim()}>
                      Save override note
                    </Button>
                    <Button size="small" variant="text" onClick={clearDecisionOverride} disabled={!selectedProfile.isOverridden}>
                      Reset to system decision
                    </Button>
                  </Stack>
                </Paper>
              </Box>

              <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mt: 1.5 }}>
                <Button
                  variant="outlined"
                  disabled={selectedVisibleIndex <= 0}
                  onClick={() => jumpToReviewIndex(-1)}>
                  Previous feature
                </Button>
                <Button
                  variant="outlined"
                  disabled={selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleProfiles.length - 1}
                  onClick={() => jumpToReviewIndex(1)}>
                  Next feature
                </Button>
              </Stack>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <SectionCard
        eyebrow="Feature Explanation Panel"
        title="Explain the selected feature"
        subtitle="This answers what the field means, why it was kept or rejected, and whether it is fair to use at alert decision time.">
        {selectedProfile ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.75, p: 1.25 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                What this feature means
              </Typography>
              <Typography sx={{ fontSize: 13, color: T.text, mt: 0.55 }}>
                {featureMeaning(selectedProfile.feature)}
              </Typography>
            </Paper>
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.75, p: 1.25 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                Why it was selected or not selected
              </Typography>
              <Typography sx={{ fontSize: 13, color: T.text, mt: 0.55 }}>
                {selectedProfile.decisionReason}
              </Typography>
            </Paper>
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.75, p: 1.25 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                Decision-time availability
              </Typography>
              <Typography sx={{ fontSize: 13, color: T.text, mt: 0.55 }}>
                {availabilityLabel(selectedProfile, persona)}
              </Typography>
              <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 0.55 }}>
                {selectedProfile.available_at_decision_time === true
                  ? businessMode
                    ? 'This field looks available at the moment the alert is scored.'
                    : 'The field is classified as available at alert-decision time.'
                  : businessMode
                    ? 'This field is known only later, so it should not drive suppression decisions.'
                    : 'The field is classified as delayed or post-outcome and should not be used in real-time scoring.'}
              </Typography>
            </Paper>
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.75, p: 1.25 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                Technical evidence
              </Typography>
              <Stack spacing={0.45} sx={{ mt: 0.55 }}>
                {selectedProfile.primaryScore != null && (
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                    Primary score: <strong>{fmtScore(selectedProfile.primaryScore, 4)}</strong>
                  </Typography>
                )}
                {selectedProfile.information_gain != null && (
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                    Information gain: <strong>{fmtScore(selectedProfile.information_gain, 4)}</strong>
                  </Typography>
                )}
                {selectedProfile.information_value != null && (
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                    Information value: <strong>{fmtScore(selectedProfile.information_value, 4)}</strong>
                  </Typography>
                )}
                {selectedProfile.vif != null && (
                  <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                    VIF: <strong>{fmtScore(selectedProfile.vif, 2)}</strong>
                  </Typography>
                )}
                <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                  Leakage risk: <strong>{selectedProfile.leakageRisk}</strong>
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: T.textMuted }}>
                  Missingness: <strong>{pct(selectedProfile.missingPct, 0)}</strong>
                </Typography>
              </Stack>
            </Paper>
            <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.75, p: 1.25, gridColumn: { xs: 'auto', lg: '1 / span 2' } }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                Plain-language explanation
              </Typography>
              <Typography sx={{ fontSize: 13, color: T.text, mt: 0.55 }}>
                {selectedProfile.businessExplanation}
              </Typography>
              {!businessMode && (
                <Typography sx={{ fontSize: 12.5, color: T.textMuted, mt: 0.8 }}>
                  Technical detail: {selectedProfile.technicalExplanation}
                </Typography>
              )}
            </Paper>
          </Box>
        ) : (
          <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
            Select a feature above to explain why it was kept, reviewed, or blocked.
          </Alert>
        )}
      </SectionCard>

      <SectionCard
        eyebrow="Leakage & Availability Firewall"
        title="Leakage and operational-availability firewall"
        subtitle="A highly predictive feature is not automatically a valid feature. If it is leaky or unavailable at scoring time, it must be blocked or heavily reviewed.">
        <Stack spacing={1.25}>
          <Alert severity="warning" icon={<RuleFolder />} sx={{ borderRadius: 1.75, fontSize: 11.75 }}>
            Policy statement: features such as STR label, prior SAR / STR rate, case status, resolution days, analyst risk score, docs requested, customer contacted, EDD triggered, and downstream linked-case counts must be blocked or reviewed if they are not truly available at alert time.
          </Alert>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
            {firewallChecks.map((check) => (
              <Paper key={check.id} elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, p: 1.1 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                  {check.label}
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: Number(check.count || 0) > 0 ? T.danger : T.success, mt: 0.5 }}>
                  {check.count || 0}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.25 }}>
                  {check.description}
                </Typography>
                {!!(check.examples || []).length && (
                  <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                    {(check.examples || []).slice(0, 4).map((example) => (
                      <Chip key={`${check.id}-${example}`} label={humanize(example)} size="small" sx={{ bgcolor: T.surfaceAlt, border: `1px solid ${T.border}` }} />
                    ))}
                  </Stack>
                )}
              </Paper>
            ))}
          </Box>

          <Paper elevation={0} sx={{ border: `1px solid ${T.border}`, borderRadius: 1.5, bgcolor: T.surfaceAlt }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.2, py: 1, borderBottom: `1px solid ${T.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                High-risk features currently flagged
              </Typography>
              <Chip label={`${highRiskProfiles.length} high-risk feature${highRiskProfiles.length === 1 ? '' : 's'}`} size="small" sx={{ bgcolor: '#fff', border: `1px solid ${T.border}` }} />
            </Stack>
            <ScrollArea height={220} sx={{ p: 1 }}>
              {highRiskProfiles.length ? (
                <Stack spacing={0.8}>
                  {highRiskProfiles.map((profile) => (
                    <Paper key={profile.feature} elevation={0} sx={{ border: `1px solid ${T.dangerBorder}`, borderRadius: 1.25, p: 1, bgcolor: T.dangerBg }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>
                        {profile.displayName}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.25 }}>
                        {profile.decisionReason}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                  No high-risk features are currently flagged in the visible payload.
                </Alert>
              )}
            </ScrollArea>
          </Paper>
        </Stack>
      </SectionCard>
      </>
      )}

      {isBusinessView && (
        <>
          <SectionCard
            eyebrow="Your Input Needed"
            title="Features that need your sign-off"
            subtitle="Review the ambiguous fields first. Approve them, block them, or send them back to an analyst for a closer check.">
            <Stack spacing={1.1}>
              {businessReviewQueue.length ? businessReviewQueue.map((profile) => (
                <Paper key={`review-${profile.feature}`} elevation={0} sx={{ border: `1px solid ${T.warnBorder}`, borderRadius: 1.8, p: 1.2, bgcolor: '#fffdf8' }}>
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.2} justifyContent="space-between">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>
                        {profile.displayName}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.25 }}>
                        {profile.sourceTable} • {profile.featureFamily}
                      </Typography>
                      <Typography sx={{ fontSize: 12.25, color: T.text, mt: 0.8 }}>
                        {profile.businessExplanation}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="center">
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => {
                          setSelectedFeature(profile.feature);
                          applyDecision('approved', 'Approved in business view after confirming the field is appropriate for alert-time training.');
                        }}
                        sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}
                      >
                        Yes
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedFeature(profile.feature);
                          applyDecision(businessBlockDecision(profile), 'Blocked in business view because the field is not appropriate for governed alert-time training.');
                        }}
                        sx={{ borderColor: T.dangerBorder, color: T.danger }}
                      >
                        No
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedFeature(profile.feature);
                          openFeatureReview(profile.feature);
                        }}
                        sx={{ borderColor: T.warnBorder, color: T.warn }}
                      >
                        Ask analyst
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )) : (
                <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                  No features currently need business sign-off.
                </Alert>
              )}
            </Stack>
          </SectionCard>

          <SectionCard
            eyebrow="Business Review"
            title="Feature verdict cards"
            subtitle="Every card explains what the field measures, why it matters for AML, whether it is safe at alert time, and the final business verdict.">
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8}>
                <TextField
                  size="small"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search feature, reason, or source"
                  sx={{ flex: 1, '& input': { fontSize: 12 } }}
                />
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Decision</InputLabel>
                  <Select value={activeBucket} label="Decision" onChange={(event) => setActiveBucket(String(event.target.value))} sx={{ fontSize: 12 }}>
                    <MenuItem value="all">All verdicts</MenuItem>
                    {BUCKETS.map((bucket) => (
                      <MenuItem key={bucket.id} value={bucket.id}>{bucket.title}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel>Source table</InputLabel>
                  <Select value={sourceFilter} label="Source table" onChange={(event) => setSourceFilter(String(event.target.value))} sx={{ fontSize: 12 }}>
                    {sourceOptions.map((source) => (
                      <MenuItem key={source} value={source}>{source === 'all' ? 'All sources' : source}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Box sx={{ display: 'grid', gap: 1.1, gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' } }}>
                {businessVisibleProfiles.map((profile) => (
                  <BusinessFeatureCard key={`business-card-${profile.feature}`} profile={profile} onOpenReview={openFeatureReview} />
                ))}
              </Box>

              {!businessVisibleProfiles.length && (
                <Alert severity="info" icon={<InfoOutlined />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                  No features match the current business filters.
                </Alert>
              )}
            </Stack>
          </SectionCard>
        </>
      )}

      {isBusinessView && (
        <Dialog
          open={reviewModalOpen && Boolean(selectedProfile)}
          onClose={() => setReviewModalOpen(false)}
          fullWidth
          maxWidth="md"
        >
          <DialogTitle sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${T.border}` }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                  Business Feature Review
                </Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 800, color: T.text }}>
                  {selectedProfile?.displayName || 'Review feature'}
                </Typography>
              </Box>
              <IconButton onClick={() => setReviewModalOpen(false)} size="small">
                <Close />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent sx={{ p: 2 }}>
            {selectedProfile && (
              <Stack spacing={1.1}>
                <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
                  <Chip label={businessVerdictText(selectedProfile.decision)} size="small" sx={{ bgcolor: selectedMeta?.bg, color: selectedMeta?.color, fontWeight: 700 }} />
                  <Chip label={businessSafetyLabel(selectedProfile)} size="small" sx={{ bgcolor: T.infoBg, color: T.info, fontWeight: 700 }} />
                  <Chip label={businessUniquenessLabel(selectedProfile)} size="small" sx={{ bgcolor: T.surfaceAlt, color: T.text, fontWeight: 700 }} />
                </Stack>
                <BusinessFeatureCard profile={selectedProfile} onOpenReview={null} />
                <Paper elevation={0} sx={{ border: `1px solid ${T.warnBorder}`, borderRadius: 1.6, p: 1.1, bgcolor: '#fffdf8' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: T.orange, textTransform: 'uppercase' }}>
                    Actions
                  </Typography>
                  <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => applyDecision('approved', overrideNote || 'Approved in business view after domain confirmation.')}
                      sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}
                    >
                      Yes - approve
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => applyDecision(businessBlockDecision(selectedProfile), overrideNote || 'Blocked in business view after business review.')}
                      sx={{ borderColor: T.dangerBorder, color: T.danger }}
                    >
                      No - block
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => applyDecision('needs_review', overrideNote || 'Escalated for analyst review from business view.')}
                      sx={{ borderColor: T.warnBorder, color: T.warn }}
                    >
                      Ask analyst
                    </Button>
                  </Stack>
                  <TextField
                    multiline
                    minRows={3}
                    size="small"
                    fullWidth
                    value={overrideNote}
                    onChange={(event) => setOverrideNote(event.target.value)}
                    placeholder="Optional note for compliance sign-off."
                    sx={{ mt: 1, '& textarea': { fontSize: 12 } }}
                  />
                </Paper>
              </Stack>
            )}
          </DialogContent>
        </Dialog>
      )}

      <SectionCard
        eyebrow="Final Output for Training"
        title="Approved feature set and excluded feature audit"
        subtitle={isBusinessView
          ? 'This is the final sign-off pack: what goes into training, what stays out, and why.'
          : 'Only approved features should flow into model training. The output panels below scroll internally so you can review more columns without extending the whole page.'}
        action={
          <Button
            variant="contained"
            onClick={applyGovernedFeatureSet}
            disabled={!profiles.length}
            sx={{ bgcolor: T.orange, '&:hover': { bgcolor: '#b33f02' } }}>
            {isBusinessView ? 'Apply Approved Feature Set' : 'Apply governed feature set'}
          </Button>
        }>
        <Stack spacing={1.2}>
          <Alert severity={approvedProfiles.length ? 'success' : 'warning'} icon={approvedProfiles.length ? <CheckCircle /> : <WarningAmber />} sx={{ borderRadius: 1.75, fontSize: 11.75 }}>
            {approvedProfiles.length} approved features are ready for model training.
            {appliedGovernanceStep
              ? ` A governed drop-columns step is already in the pipeline covering ${(appliedGovernanceStep?.columns || []).length} excluded feature${(appliedGovernanceStep?.columns || []).length === 1 ? '' : 's'}.`
              : ' Click "Apply governed feature set" to write the current exclusions into the preprocessing pipeline.'}
          </Alert>

          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <Paper elevation={0} sx={{ border: `1px solid ${T.successBorder}`, borderRadius: 1.75, overflow: 'hidden' }}>
              <Box sx={{ px: 1.2, py: 1, bgcolor: T.successBg, borderBottom: `1px solid ${T.successBorder}` }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.success }}>
                  Approved Feature Set
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.2 }}>
                  Only these features will go to model training.
                </Typography>
              </Box>
              <ScrollArea height={280} sx={{ p: 1 }}>
                {groupedApproved.length ? (
                  <Stack spacing={1}>
                    {groupedApproved.map((group) => (
                      <Paper key={`approved-${group.source}`} elevation={0} sx={{ border: `1px solid ${T.successBorder}`, borderRadius: 1.25, p: 1 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                          {group.source}
                        </Typography>
                        <Stack spacing={0.55} sx={{ mt: 0.7 }}>
                          {group.values.map((item) => (
                            <Box key={`approved-${item.feature}`} sx={{ borderBottom: `1px solid ${T.border}`, pb: 0.6, '&:last-child': { borderBottom: 'none', pb: 0 } }}>
                              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                                {item.displayName}
                              </Typography>
                              <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                                {item.decisionReason}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="warning" icon={<WarningAmber />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                    No approved features are available yet. Review the blocked and review buckets before training.
                  </Alert>
                )}
              </ScrollArea>
            </Paper>

            <Paper elevation={0} sx={{ border: `1px solid ${T.dangerBorder}`, borderRadius: 1.75, overflow: 'hidden' }}>
              <Box sx={{ px: 1.2, py: 1, bgcolor: T.dangerBg, borderBottom: `1px solid ${T.dangerBorder}` }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: T.danger }}>
                  Excluded / Blocked Features
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: T.textMuted, mt: 0.2 }}>
                  This makes it easy to explain why risky fields like STR label or prior SAR rate were not allowed through.
                </Typography>
              </Box>
              <ScrollArea height={280} sx={{ p: 1 }}>
                {groupedExcluded.length ? (
                  <Stack spacing={1}>
                    {groupedExcluded.map((group) => (
                      <Paper key={`excluded-${group.source}`} elevation={0} sx={{ border: `1px solid ${T.dangerBorder}`, borderRadius: 1.25, p: 1 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: T.text }}>
                          {group.source}
                        </Typography>
                        <Stack spacing={0.55} sx={{ mt: 0.7 }}>
                          {group.values.map((item) => (
                            <Box key={`excluded-${item.feature}`} sx={{ borderBottom: `1px solid ${T.border}`, pb: 0.6, '&:last-child': { borderBottom: 'none', pb: 0 } }}>
                              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                                {item.displayName}
                              </Typography>
                              <Typography sx={{ fontSize: 11.5, color: T.textMuted }}>
                                {item.decisionReason}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 1.5, fontSize: 11.5 }}>
                    No blocked or excluded features are currently present.
                  </Alert>
                )}
              </ScrollArea>
            </Paper>
          </Box>
        </Stack>
      </SectionCard>
    </Stack>
  );
};

export default FeatureGovernanceWorkbench;
