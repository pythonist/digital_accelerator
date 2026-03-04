/**
 * PreprocessingWorkbench.jsx  —  Full Production Preprocessing & Feature Engineering Workbench
 *
 * Props (match MLOpsWorkbench.jsx usage exactly):
 *   suggestions       []       auto-plan chips from preprocessPlan API
 *   steps             []       current pipeline steps (controlled)
 *   onStepsChange     fn       update pipeline
 *   onPreview         fn       trigger preprocessPreview
 *   onRun             fn       trigger preprocessRun
 *   preview           {}       preview result from parent
 *   onMasterBuild     fn       trigger master build
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider,
  Dialog, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper,
  Select, Slider, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  Add,
  AutoFixHigh,
  Build,           // wrench — cleaning / imputation
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
  Warning,
  WorkspacePremium, // AML templates badge
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import PreprocessingBeforeAfter from './PreprocessingBeforeAfter';
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
  orangeLight:  '#fef2ee',
  border:       '#e2e8f0',
  surface:      '#f8fafc',
  textPri:      '#0f172a',
  textSec:      '#64748b',
  textDim:      '#94a3b8',
  done:         '#22c55e',
  doneBg:       '#f0fdf4',
  doneBorder:   '#86efac',
  warn:         '#f59e0b',
  warnBg:       '#fffbeb',
  warnBorder:   '#fde68a',
  danger:       '#ef4444',
  dangerBg:     '#fff1f2',
  dangerBorder: '#fecdd3',
  infoBg:       '#eff6ff',
  infoBorder:   '#bae6fd',
  bgClean:      '#dbeafe',
  bgEncode:     '#dcfce7',
  bgScale:      '#ede9fe',
  bgFeat:       '#fff7ed',
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt  = n  => n == null ? '—' : Number(n).toLocaleString();
const fmtF = (v, d = 3) => v == null ? '—' : Number(v).toFixed(d);
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
    p: 2, borderRadius: 2,
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
    textTransform: 'none', fontWeight: 600, borderRadius: '8px', boxShadow: 'none',
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
  masterDataset,
  preprocessedDataset,
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
}) => {
  const [saveName,   setSaveName]   = useState(activePipelineName || '');
  const [saveOk,     setSaveOk]     = useState(false);
  const [pipelines,  setPipelines]  = useState([]);
  const [loadOpen,   setLoadOpen]   = useState(false);
  const [loadErr,    setLoadErr]    = useState('');

  useEffect(() => {
    if (activePipelineName) {
      setSaveName(activePipelineName);
    }
  }, [activePipelineName]);

  const buildPreprocessPayload = useCallback((nameValue) => ({
    name: nameValue,
    dataset_id: Number(masterDataset?.dataset_id || 0),
    transforms: steps,
    created_by_persona: 'technical',
    steps: [{
      type: 'screen_state',
      screen: 'preprocess',
      state: {
        steps,
        masterDatasetId: Number(masterDataset?.dataset_id || 0) || null,
        preprocessedDatasetId: Number(preprocessedDataset?.dataset_id || 0) || null,
      },
    }],
  }), [masterDataset?.dataset_id, preprocessedDataset?.dataset_id, steps]);

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
            currentState: { steps },
          });
          payload.transforms = steps;
        } catch {
          // fallback to new payload save
        }
      }

      const savedRes = await mlopsApi.pipelineSave(payload);
      const saved = savedRes?.data || savedRes;
      onPipelineActivated?.({
        pipeline_id: Number(saved?.pipeline_id || 0),
        name: trimmed,
      });
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

  const handleLoadPipeline = useCallback(async (pipelineId) => {
    try {
      const fullRes = await mlopsApi.pipelineGet(pipelineId);
      const full = fullRes?.data || fullRes;
      const loadedSteps = extractLoadedSteps(full);
      onLoad(loadedSteps || []);
      onPipelineActivated?.({
        pipeline_id: Number(full?.pipeline_id || pipelineId),
        name: String(full?.name || ''),
      });
      setLoadOpen(false);
      setLoadErr('');
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load pipeline');
    }
  }, [extractLoadedSteps, onLoad, onPipelineActivated]);

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
const StepForm = ({ availableCols = [], colTypes = {}, onAdd, targetColumn = '', initialCat = 'clean' }) => {
  const [cat,  setCat]  = useState(initialCat);
  const [type, setType] = useState(() => {
    if (initialCat === 'scale') return 'scaling_standard';
    if (initialCat === 'feat')  return 'feature_ratio';
    return 'imputation';
  });
  const [cols, setCols] = useState([]);
  const [cfg,  setCfg]  = useState({
    strategy: 'median', constVal: 'unknown',
    degree: '2', pairsRaw: '',
    groupBy: '', groupTarget: '', agg: 'mean',
    ordinalOrder: 'low,medium,high',
  });

  const typesForCat = cat === 'scale' ? SCALE_TYPES : cat === 'feat' ? FEAT_ENG_TYPES : CLEAN_ENCODE_TYPES;
  const numCols     = availableCols.filter(c => isNumDtype(colTypes[c] || ''));

  const set = k => v => setCfg(p => ({ ...p, [k]: v }));

  const needsCols = !['drop_duplicates','feature_ratio','feature_interaction','feature_aggregation'].includes(type);
  const colsOk    = !needsCols || cols.length > 0;
  const pairsOk   = (cfg.pairsRaw || '').includes(':');
  const aggOk     = cfg.groupBy && cfg.groupTarget;
  const canAdd = (() => {
    if (['feature_ratio','feature_interaction'].includes(type)) return pairsOk;
    if (type === 'feature_aggregation') return aggOk;
    return colsOk;
  })();

  const buildPayload = () => {
    const base = { type, columns: cols };
    switch (type) {
      case 'imputation':
        return {
          ...base, strategy: cfg.strategy,
          value: cfg.strategy === 'constant' ? cfg.constVal : null,
          k: cfg.strategy === 'knn' ? 5 : undefined,
          iterations: cfg.strategy === 'mice' ? 3 : undefined,
        };
      case 'feature_polynomial':
        return { ...base, degree: parseInt(cfg.degree) || 2 };
      case 'feature_ratio':
      case 'feature_interaction':
        return {
          ...base, columns: [],
          pairs: cfg.pairsRaw.split(',').map(p => {
            const [a, b] = p.split(':').map(s => s.trim()); return { a, b };
          }).filter(p => p.a && p.b),
        };
      case 'feature_aggregation':
        return { type, columns: [], group_by: cfg.groupBy, target: cfg.groupTarget, agg: cfg.agg };
      case 'encoding_ordinal':
        return { ...base, order: cfg.ordinalOrder.split(',').map(s => s.trim()).filter(Boolean) };
      default:
        return base;
    }
  };

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(buildPayload());
    setCols([]);
  };

  // Category tab buttons with icons
  const CAT_TABS = [
    { id: 'clean', Icon: Build,       label: 'Clean & Encode' },
    { id: 'scale', Icon: LinearScale, label: 'Scaling' },
    { id: 'feat',  Icon: TrendingUp,  label: 'Feature Eng.' },
  ];

  return (
    <Card sx={{ bgcolor: T.surface }}>
      {/* Category tabs */}
      <Stack direction="row" spacing={0.5} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.5 }}>
        {CAT_TABS.map(c => {
          const CatIcon = c.Icon;
          return (
            <Button key={c.id} size="small"
              variant={cat === c.id ? 'contained' : 'outlined'}
              startIcon={<CatIcon sx={{ fontSize: 14 }} />}
              onClick={() => {
                setCat(c.id);
                setType(c.id === 'scale' ? 'scaling_standard' : c.id === 'feat' ? 'feature_ratio' : 'imputation');
                setCols([]);
              }}
              sx={{
                textTransform: 'none', fontSize: 12, px: 1.5, py: 0.6, borderRadius: '8px', boxShadow: 'none',
                ...(cat === c.id
                  ? { bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHov } }
                  : { borderColor: T.border, color: T.textSec, '&:hover': { borderColor: T.orange, color: T.orange } }),
              }}>
              {c.label}
            </Button>
          );
        })}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 1.75, mb: 2 }}>
        {/* Step type */}
        <Box>
          <SLabel>Step type</SLabel>
          <Select size="small" fullWidth value={type}
            onChange={e => { setType(e.target.value); setCols([]); }} sx={{ fontSize: 12.5 }}>
            {typesForCat.map(t => {
              const m = stepMeta(t);
              const TIcon = m.Icon;
              return (
                <MenuItem key={t} value={t}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TIcon sx={{ fontSize: 16, color: T.textSec, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{m.label}</Typography>
                  </Stack>
                </MenuItem>
              );
            })}
          </Select>
        </Box>

        {/* Column picker */}
        {needsCols && (
          <Box>
            <SLabel>Columns</SLabel>
            <Select size="small" fullWidth multiple value={cols}
              onChange={e => setCols(e.target.value)}
              renderValue={sel => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                  {sel.map(v => (
                    <Chip key={v} label={clip(v, 16)} size="small"
                      sx={{ fontFamily: 'monospace', fontSize: 9, height: 18 }} />
                  ))}
                </Box>
              )}
              sx={{ fontSize: 12, maxHeight: 200 }}>
              {availableCols.map(c => (
                <MenuItem key={c} value={c}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</Typography>
                    <Chip label={isNumDtype(colTypes[c] || '') ? 'num' : 'cat'} size="small"
                      sx={{ height: 14, fontSize: 9,
                           bgcolor: isNumDtype(colTypes[c] || '') ? '#dbeafe' : '#dcfce7' }} />
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </Box>
        )}
      </Box>

      {/* Step-specific config */}
      <Box sx={{ mb: 2 }}>
        {type === 'imputation' && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap" gap={1} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel sx={{ fontSize: 12 }}>Strategy</InputLabel>
              <Select label="Strategy" value={cfg.strategy}
                onChange={e => set('strategy')(e.target.value)} sx={{ fontSize: 12 }}>
                {IMPUTATION_STRATS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            {cfg.strategy === 'constant' && (
              <TextField size="small" label="Fill value" value={cfg.constVal}
                onChange={e => set('constVal')(e.target.value)} sx={{ width: 140 }} />
            )}
            {['knn','mice'].includes(cfg.strategy) && (
              <Alert severity="info" sx={{ py: 0.4, fontSize: 10.5, flex: 1, alignSelf: 'center' }}>
                {cfg.strategy === 'knn' ? 'k = 5, max 1 500 sample rows' : 'MICE — 3 iterations'}
              </Alert>
            )}
          </Stack>
        )}

        {type === 'feature_polynomial' && (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField size="small" label="Degree" type="number" value={cfg.degree}
              onChange={e => set('degree')(e.target.value)} sx={{ width: 110 }}
              inputProps={{ min: 2, max: 5 }} />
            <Typography variant="caption" color="text.secondary">
              Creates col_pow2…col_pow{cfg.degree || 2} for each selected column
            </Typography>
          </Stack>
        )}

        {['feature_ratio','feature_interaction'].includes(type) && (
          <Box>
            <SLabel>Column pairs (A:B, C:D)</SLabel>
            <TextField size="small" fullWidth value={cfg.pairsRaw}
              onChange={e => set('pairsRaw')(e.target.value)}
              placeholder="cash_txn_count:txn_count, txn_amount:avg_balance"
              sx={{ '& input': { fontFamily: 'monospace', fontSize: 12 } }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mt: 0.5, display: 'block' }}>
              {type === 'feature_ratio' ? 'Creates: A_div_B' : 'Creates: A_x_B'} for each pair
            </Typography>
          </Box>
        )}

        {type === 'feature_aggregation' && (
          <Stack direction="row" spacing={1.25} flexWrap="wrap" gap={1} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel sx={{ fontSize: 12 }}>Group by</InputLabel>
              <Select label="Group by" value={cfg.groupBy}
                onChange={e => set('groupBy')(e.target.value)} sx={{ fontSize: 12 }}>
                {availableCols.map(c => <MenuItem key={c} value={c}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</span></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel sx={{ fontSize: 12 }}>Numeric target</InputLabel>
              <Select label="Numeric target" value={cfg.groupTarget}
                onChange={e => set('groupTarget')(e.target.value)} sx={{ fontSize: 12 }}>
                {numCols.map(c => <MenuItem key={c} value={c}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</span></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel sx={{ fontSize: 12 }}>Aggregation</InputLabel>
              <Select label="Aggregation" value={cfg.agg}
                onChange={e => set('agg')(e.target.value)} sx={{ fontSize: 12 }}>
                {AGG_OPS.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, alignSelf: 'center' }}>
              → <code style={{ fontFamily: 'monospace' }}>{cfg.groupTarget || 'col'}_{cfg.agg}_by_{cfg.groupBy || 'group'}</code>
            </Typography>
          </Stack>
        )}

        {type === 'encoding_ordinal' && (
          <TextField size="small" fullWidth
            label="Category order — low→high, comma-separated"
            value={cfg.ordinalOrder}
            onChange={e => set('ordinalOrder')(e.target.value)}
            placeholder="low,medium,high" />
        )}
      </Box>

      <OBtn icon={<Add sx={{ fontSize: 14 }} />} onClick={handleAdd} disabled={canDisable(!canAdd)}>
        Add to pipeline
      </OBtn>
      {!canAdd && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5, fontSize: 10 }}>
          {(['feature_ratio','feature_interaction'].includes(type)) ? 'Enter A:B pairs first'
           : type === 'feature_aggregation' ? 'Set group-by and target column'
           : 'Select at least one column'}
        </Typography>
      )}
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — PLAN
// ═══════════════════════════════════════════════════════════════════════════════
const PlanTab = ({ masterDataset, suggestions, steps, onStepsChange }) => {
  const [local,   setLocal]   = useState(normalizePreprocessSuggestions(suggestions || []));
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(new Set());

  const rescan = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setLoading(true);
    try {
      const res = await mlopsApi.preprocessPlan({ dataset_id: masterDataset.dataset_id, sample_rows: 5000 });
      const payload = unwrapApiPayload(res) || {};
      setLocal(normalizePreprocessSuggestions(payload.suggestions || []));
      setApplied(new Set());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [masterDataset?.dataset_id]);

  useEffect(() => { setLocal(normalizePreprocessSuggestions(suggestions || [])); }, [suggestions]);

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
  const pendingCount = local.filter((_, i) => !applied.has(i)).length;

  return (
    <Stack spacing={2.5}>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.2 }}>Auto-Detected Issues</Typography>
            <Typography variant="caption" color="text.secondary">
              Scanned {fmt(masterDataset?.row_count)} rows · {fmt(availableCols.length)} columns for nulls, dtypes, cardinality
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

        {!loading && local.length === 0 && (
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
          Repetitive single-column actions are now collapsed into shared steps. Review the recommended groups here, then move to the Builder tab for custom workbench-style step design across {fmt(availableCols.length)} available columns.
        </Typography>
      </Alert>
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
const BuilderTab = ({ masterDataset, steps, onStepsChange, targetColumn }) => {
  const availableCols = masterDataset?.columns || [];
  const colTypes = masterDataset?.column_types || {};
  const [activeCol, setActiveCol] = useState('');
  const [statsMap, setStatsMap] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (availableCols.length === 0) {
      setActiveCol('');
      return;
    }
    if (!activeCol || !availableCols.includes(activeCol)) {
      setActiveCol(availableCols[0]);
    }
  }, [activeCol, availableCols]);

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

  const activeStats = statsMap?.[activeCol] || null;
  const topCategories = Array.isArray(activeStats?.top_categories) ? activeStats.top_categories.slice(0, 6) : [];
  const isNumericColumn = isNumDtype(colTypes?.[activeCol] || '') || Number(activeStats?.numeric_parse_ratio || 0) >= 0.85;

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" icon={<Code />} sx={{ borderRadius: 2, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
        <Typography fontWeight={700} sx={{ fontSize: 13, mb: 0.25 }}>Custom Builder Workbench</Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Build reusable cleaning, encoding, scaling, and feature-engineering steps with full column context.
          {targetColumn
            ? ` Target "${targetColumn}" is active, so you can design features here and validate them in Select.`
            : ' A target is optional here; you can still prepare the pipeline before supervised selection.'}
        </Typography>
      </Alert>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.9fr' }, gap: 2 }}>
        <Box>
          <StepForm
            availableCols={availableCols}
            colTypes={colTypes}
            onAdd={step => onStepsChange([...steps, step])}
            targetColumn={targetColumn}
            initialCat="clean"
          />
        </Box>

        <Stack spacing={2}>
          <Card>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.2 }}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>Column Explorer</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  Inspect available fields, value patterns, and sample data before building a step.
                </Typography>
              </Box>
              <OBtn variant="outlined" icon={<Refresh sx={{ fontSize: 13 }} />} onClick={loadStats} disabled={canDisable(statsLoading)}>
                Refresh
              </OBtn>
            </Stack>

            {statsLoading && <Spinner label="Loading column metadata..." />}
            {!statsLoading && statsErr && <Alert severity="error" sx={{ borderRadius: 2 }}>{statsErr}</Alert>}
            {!statsLoading && !statsErr && (
              <Stack spacing={1.4}>
                <FormControl size="small" fullWidth>
                  <InputLabel sx={{ fontSize: 12 }}>Inspect column</InputLabel>
                  <Select
                    label="Inspect column"
                    value={activeCol}
                    onChange={(e) => setActiveCol(String(e.target.value))}
                    sx={{ fontSize: 12 }}
                  >
                    {availableCols.map((col) => (
                      <MenuItem key={col} value={col}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>{col}</Typography>
                          <Chip
                            label={isNumDtype(colTypes?.[col] || '') ? 'num' : 'cat'}
                            size="small"
                            sx={{ height: 14, fontSize: 9, bgcolor: isNumDtype(colTypes?.[col] || '') ? '#dbeafe' : '#dcfce7' }}
                          />
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {!activeStats ? (
                  <Alert severity="info" sx={{ borderRadius: 2 }}>Pick a column to inspect it here.</Alert>
                ) : (
                  <>
                    <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ rowGap: 0.6 }}>
                      <Chip label={`dtype: ${activeStats.dtype || colTypes?.[activeCol] || 'unknown'}`} size="small" sx={{ height: 18, fontSize: 9, fontFamily: 'monospace', bgcolor: T.surface }} />
                      <Chip label={`missing: ${pct(activeStats.missing_pct, 1)}`} size="small" sx={{ height: 18, fontSize: 9, bgcolor: T.warnBg, color: '#b45309' }} />
                      <Chip label={`distinct: ${fmt(activeStats.distinct_count)}`} size="small" sx={{ height: 18, fontSize: 9, bgcolor: T.infoBg, color: '#1d4ed8' }} />
                      {activeStats.numeric_parse_ratio != null && Number(activeStats.numeric_parse_ratio) > 0 && (
                        <Chip label={`numeric parse: ${pct(activeStats.numeric_parse_ratio, 0)}`} size="small" sx={{ height: 18, fontSize: 9, bgcolor: T.surface }} />
                      )}
                    </Stack>

                    {isNumericColumn ? (
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                        {[
                          ['Min', fmtF(activeStats.min)],
                          ['Max', fmtF(activeStats.max)],
                          ['Mean', fmtF(activeStats.mean)],
                          ['Variance', fmtF(activeStats.variance, 5)],
                          ['MAD', fmtF(activeStats.mean_abs_deviation, 5)],
                          ['Dispersion', fmtF(activeStats.dispersion_ratio, 4)],
                        ].map(([label, value]) => (
                          <Box key={label} sx={{ p: 1.1, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
                            <Typography variant="caption" sx={{ fontSize: 10, color: T.textSec }}>{label}</Typography>
                            <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 700 }}>{value}</Typography>
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Box>
                        <SLabel>Top values</SLabel>
                        {topCategories.length === 0 ? (
                          <Alert severity="info" sx={{ py: 0.4, fontSize: 11 }}>No category profile is available for this column yet.</Alert>
                        ) : (
                          <Stack spacing={0.55}>
                            {topCategories.map((item) => (
                              <Stack key={`${activeCol}-${item.value}`} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 0.8, borderRadius: 1.25, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
                                <Typography sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>{clip(item.value, 22)}</Typography>
                                <Typography variant="caption" sx={{ fontSize: 10.5, color: T.textSec }}>{fmt(item.count)}</Typography>
                              </Stack>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    )}
                  </>
                )}
              </Stack>
            )}
          </Card>

          <Card>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>Sample Values</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  Quick preview of live values for the selected column.
                </Typography>
              </Box>
              <Chip label={activeCol ? summarizeColumns([activeCol], 1) : 'No column'} size="small" sx={{ fontSize: 9, bgcolor: T.surface }} />
            </Stack>

            {previewLoading ? (
              <Spinner label="Loading sample values..." />
            ) : previewRows.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 2 }}>No sample rows are available for this column.</Alert>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: T.textSec, borderBottom: `1px solid ${T.border}` }}>Row</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: T.textSec, borderBottom: `1px solid ${T.border}` }}>{activeCol || 'Value'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={`${activeCol}-${idx}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: T.textSec }}>{idx + 1}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{String(row?.[activeCol] ?? 'â€”')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}
          </Card>
        </Stack>
      </Box>
    </Stack>
  );
};

// TAB 2 — ENGINEER
// ═══════════════════════════════════════════════════════════════════════════════

// AML templates — icon is a MUI component ref, not emoji
const AML_TEMPLATES = [
  {
    label: 'Cash Intensity Ratio',    Icon: ShowChart,
    desc:  'cash_txn_count ÷ txn_count — primary structuring signal',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'cash_txn_count', b: 'txn_count' }] },
    req:   ['cash_txn_count', 'txn_count'],
  },
  {
    label: 'Velocity Ratio',          Icon: TrendingUp,
    desc:  'max_txn_amount ÷ avg_txn_amount — detects sudden transaction spikes',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'max_txn_amount', b: 'avg_txn_amount' }] },
    req:   ['max_txn_amount', 'avg_txn_amount'],
  },
  {
    label: 'Balance-to-TXN Ratio',   Icon: CompareArrows,
    desc:  'CURRENT_BALANCE ÷ avg_txn_amount — unusual balance context',
    step:  { type: 'feature_ratio', columns: [], pairs: [{ a: 'CURRENT_BALANCE', b: 'avg_txn_amount' }] },
    req:   ['CURRENT_BALANCE', 'avg_txn_amount'],
  },
  {
    label: 'PEP × Risk Score',        Icon: Warning,
    desc:  'PEP_FLAG × CUSTOMER_RISK_RATING — multiplicative risk signal',
    step:  { type: 'feature_interaction', columns: [], pairs: [{ a: 'PEP_FLAG', b: 'CUSTOMER_RISK_RATING' }] },
    req:   ['PEP_FLAG', 'CUSTOMER_RISK_RATING'],
  },
  {
    label: 'Offshore × Risk',         Icon: Link,
    desc:  'offshore_txn_count × RISK_SCORE — combined offshore-risk signal',
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
    desc:  'std(TXN_AMOUNT) grouped by CUSTOMER_RISK_RATING — volatility by risk band',
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
    desc:  'Replace ACCOUNT_TYPE with its frequency count — cardinality signal',
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

const EngineerTab = ({ masterDataset, steps, onStepsChange, targetColumn }) => {
  const availableCols = masterDataset?.columns || [];
  const availableCount = AML_TEMPLATES.filter(t => t.req.every(c => availableCols.includes(c))).length;

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" icon={<MemoryOutlined />} sx={{ borderRadius: 2, bgcolor: T.infoBg, border: `1px solid ${T.infoBorder}` }}>
        <Typography fontWeight={700} sx={{ mb: 0.3, fontSize: 13 }}>Feature Engineering</Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Transform raw columns into higher-signal representations.
          These steps run <strong>before</strong> encoding/scaling in the pipeline.
          New columns appear in the Preview tab immediately.
          {targetColumn
            ? ` Target "${targetColumn}" is set — supervised importance scoring is available in Feature Selection.`
            : ' No target set yet — all engineering features are still available.'}
        </Typography>
      </Alert>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <WorkspacePremium sx={{ fontSize: 18, color: T.orange }} />
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>AML Domain Templates</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Pre-built features for false-positive suppression
            </Typography>
          </Box>
          <Chip
            label={`${availableCount} / ${AML_TEMPLATES.length} available`}
            size="small"
            sx={{ fontSize: 10, bgcolor: T.orangeLight, color: T.orange }}
          />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 1.25 }}>
          {AML_TEMPLATES.map((t, i) => {
            const TIcon  = t.Icon;
            const canUse = t.req.every(c => availableCols.includes(c));
            const added  = steps.some(s => JSON.stringify(s) === JSON.stringify(t.step));
            const miss   = t.req.filter(c => !availableCols.includes(c));
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
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>
                      {t.desc}
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
        Custom feature engineering now lives in the dedicated Builder tab, where you can inspect column values and metadata while designing steps. This screen stays focused on reusable AML templates.
      </Alert>
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — SELECT
// ═══════════════════════════════════════════════════════════════════════════════
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

  const load = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setLoading(true);
    try {
      const response = await mlopsApi.featureSelectionWorkbench({
        dataset_id: masterDataset.dataset_id,
        target_column: targetColumn,
        sample_rows: 8000,
        top_n: topN,
        var_threshold: varThresh,
        corr_threshold: corrThresh,
      });
      const nextData = { workbench: unwrapApiPayload(response) };
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
      setData({ workbench: null });
      setErrors({ workbench: e?.message || 'Feature-selection workbench failed' });
    } finally { setLoading(false); }
  }, [corrThresh, masterDataset?.dataset_id, targetColumn, topN, varThresh]);

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

  const panels = [];


  return (
    <Stack spacing={2}>
      <Alert
        severity={targetColumn ? 'success' : 'info'}
        icon={targetColumn ? <CheckCircle /> : <Warning />}
        sx={{ borderRadius: 2 }}>
        <Typography fontWeight={700} sx={{ fontSize: 13, mb: 0.2 }}>
          {targetColumn ? `Feature selection - target: ${targetColumn}` : 'Feature selection library'}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          {targetColumn
            ? 'The workbench starts with the best supervised technique and keeps leakage or correlation scans hidden until you open them.'
            : 'Score-based techniques stay front and center here. Set a target in Step 3 to unlock supervised ranking and recommendations.'}
        </Typography>
      </Alert>

      <Stack direction="row" justifyContent="flex-end">
        <OBtn variant="outlined" icon={<Refresh sx={{ fontSize: 13 }} />} onClick={load} disabled={canDisable(loading)}>
          {loading ? 'Running analysis...' : 'Refresh analysis'}
        </OBtn>
      </Stack>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.1 }} flexWrap="wrap" rowGap={1}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>Feature Selection Library</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
              Choose one technique, inspect its ranked columns, and apply one grouped keep or drop decision from the workbench.
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

      {loading && <Spinner label="Running selection analysis..." />}

      {!loading && errors.workbench && (
        <Alert severity="error" icon={<Warning />} sx={{ py: 0.5, fontSize: 11 }}>
          {errors.workbench}
        </Alert>
      )}

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

      {!loading && panels.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 2 }}>
          {panels.map(p => {
            const PIcon = p.Icon;
            return (
              <Card key={p.id} sx={{ opacity: p.supervised && !targetColumn ? 0.7 : 1 }}>
                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1.5 }}>
                  <PIcon sx={{ fontSize: 20, color: T.orange, flexShrink: 0, mt: 0.2 }} />
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.2 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{p.title}</Typography>
                      {p.supervised && (
                        <Chip label="supervised" size="small"
                          sx={{ fontSize: 9, height: 16, bgcolor: T.orangeLight, color: T.orange }} />
                      )}
                      {p.badge != null && (
                        <Chip
                          label={p.badge === 0 ? 'None found' : `${p.badge} found`}
                          size="small"
                          sx={{ fontSize: 9, height: 16,
                                bgcolor: p.badge === 0 ? T.doneBg : T.warnBg,
                                color:   p.badge === 0 ? T.done   : T.warn }}
                        />
                      )}
                      {existingDropReasons.has(p.id) && (
                        <Chip label="Applied" size="small"
                          sx={{ fontSize: 9, height: 16, bgcolor: T.doneBg, color: T.done }} />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                      {p.desc}
                    </Typography>
                  </Box>
                </Stack>
                {p.body()}
              </Card>
            );
          })}
        </Box>
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
// TAB 4 — PREVIEW
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

  const run = useCallback(async () => {
    if (!masterDataset?.dataset_id || !steps.length) return;
    setLoading(true); setErr(null);
    try {
      if (onPreview) onPreview(steps);
      const res = await mlopsApi.preprocessPreview({
        dataset_id: masterDataset.dataset_id,
        steps,
        sample_rows: 100,
        target_column: targetColumn,
      });
      setLocalPreview(res?.data || res);
    } catch (e) { setErr(e?.message || 'Preview failed'); }
    finally { setLoading(false); }
  }, [masterDataset?.dataset_id, steps, targetColumn, onPreview]);

  const pv          = localPreview || parentPreview;
  const beforeCols  = masterDataset?.columns || [];
  const afterCols   = pv?.columns || [];
  const newCols     = afterCols.filter(c => !beforeCols.includes(c));
  const removedCols = beforeCols.filter(c => !afterCols.includes(c));
  const rows        = pv?.preview || [];

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
              Runs {steps.length} step{steps.length > 1 ? 's' : ''} on 100 sample rows.
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
      {loading && <Spinner label="Applying pipeline to 100 rows…" />}

      {pv && !loading && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.25 }}>
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

          {newCols.length > 0 && (
            <Card sx={{ bgcolor: T.doneBg, borderColor: T.doneBorder }}>
              <SLabel>New engineered columns</SLabel>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                {newCols.map(c => (
                  <Chip key={c} label={c} size="small"
                    sx={{ fontFamily: 'monospace', fontSize: 9.5, bgcolor: '#dcfce7', color: '#166534' }} />
                ))}
              </Box>
            </Card>
          )}

          {removedCols.length > 0 && (
            <Card sx={{ bgcolor: T.dangerBg, borderColor: T.dangerBorder }}>
              <SLabel>Dropped columns</SLabel>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                {removedCols.map(c => (
                  <Chip key={c} label={c} size="small"
                    sx={{ fontFamily: 'monospace', fontSize: 9.5, bgcolor: '#fee2e2', color: T.danger }} />
                ))}
              </Box>
            </Card>
          )}

          {rows.length > 0 && (
            <Card>
              <SLabel>Sample — {rows.length} rows × {afterCols.length} columns (first 18 shown)</SLabel>
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
    </Stack>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — RUN
// ═══════════════════════════════════════════════════════════════════════════════
const RunTab = ({ masterDataset, steps, targetColumn, preview, onRun, onComplete }) => {
  const [outputName, setOutputName] = useState('preprocessed_dataset');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const [tracePayload, setTracePayload] = useState(null);
  const [traceHydrating, setTraceHydrating] = useState(false);
  const [activeStage, setActiveStage] = useState('');

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
  const traceStepCount = useMemo(
    () => (Array.isArray(tracePayload?.steps) ? tracePayload.steps.length : 0),
    [tracePayload],
  );

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
      };
    }),
    [inferAffectedColumns, steps],
  );

  useEffect(() => {
    setTracePayload(null);
    setActiveStage('');
  }, [masterDataset?.dataset_id, steps, targetColumn]);

  useEffect(() => {
    const previewTrace = readTrace(preview);
    if (previewTrace && !hasAppliedTrace) {
      setTracePayload(previewTrace);
    }
  }, [hasAppliedTrace, preview, readTrace]);

  useEffect(() => {
    let cancelled = false;
    if (!masterDataset?.dataset_id || !steps.length || hasAppliedTrace) return undefined;

    if (traceStepCount > 0) return undefined;

    const loadTrace = async () => {
      setTraceHydrating(true);
      try {
        const res = await mlopsApi.preprocessPreview({
          dataset_id: masterDataset.dataset_id,
          steps,
          sample_rows: 100,
          target_column: targetColumn,
        });
        if (cancelled) return;
        const inferred = readTrace(res);
        if (inferred) setTracePayload(inferred);
      } catch (_) {
        // Keep UI usable with planned steps if trace hydration fails.
      } finally {
        if (!cancelled) setTraceHydrating(false);
      }
    };

    loadTrace();
    return () => { cancelled = true; };
  }, [hasAppliedTrace, masterDataset?.dataset_id, readTrace, steps, targetColumn, traceStepCount]);

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

  const run = async () => {
    if (!masterDataset?.dataset_id || !steps.length) return;
    setRunning(true);
    setDone(null);
    setErr(null);
    setTracePayload(null);
    try {
      const payload = {
        dataset_id: masterDataset.dataset_id,
        steps,
        output_name: outputName,
      };
      if (targetColumn) payload.target_column = targetColumn;
      const res = await mlopsApi.preprocessRun(payload);
      const result = res?.data || res;
      const ds = result?.dataset || result;
      const trace = result?.output?.trace || result?.trace || null;
      setTracePayload(trace);
      setDone(ds);
      if (onRun) onRun(outputName, steps);
      if (onComplete) onComplete(ds);
    } catch (e) {
      setErr(e?.message || 'Pipeline failed');
    } finally {
      setRunning(false);
    }
  };

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

  const runDisabled = (typeof canDisable === 'function')
    ? canDisable(running || !steps.length)
    : (running || !steps.length);

  if (!steps.length) return (
    <Alert severity="warning" icon={<Warning />} sx={{ borderRadius: 2 }}>
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
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.orangeLight, border: '1px solid #fdd8c4' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Total steps</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 24, color: T.orange, lineHeight: 1.1 }}>{fmt(traceSummary?.total_steps || steps.length)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.doneBg, border: `1px solid ${T.doneBorder}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Input rows</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 24, color: T.done, lineHeight: 1.1 }}>{fmt(traceSummary?.input_rows ?? masterDataset?.row_count)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Input columns</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.input_columns)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Output columns</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.output_columns)}</Typography>
            <Typography variant="caption" sx={{ color: T.textSec }}>delta {fmtDelta(traceSummary?.column_delta)}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: T.surface, border: `1px solid ${T.border}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Applied steps</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{fmt(traceSummary?.applied_steps)}</Typography>
          </Box>
        </Box>
      </Card>

      <Card>
        <SLabel>Logical Preprocessing Diagram</SLabel>
        {traceHydrating && !running && (
          <Typography variant="caption" sx={{ color: T.textSec, display: 'block', mb: 1 }}>
            Computing transformation metrics from preview trace...
          </Typography>
        )}
        <Box sx={{ maxHeight: 380, overflow: 'auto', pr: 0.25 }}>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', xl: '220px 1fr 220px' },
            gap: 1.25,
            alignItems: 'start',
          }}>
            <Box sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: '#f8fafc' }}>
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
                    borderRadius: 1.5,
                    bgcolor: laneMeta[stage.category]?.bg || 'white',
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
                        <Chip key={`${stage.category}-${col}`} size="small" label={clip(col, 14)} sx={{ height: 16, fontSize: 8.5, bgcolor: T.infoBg }} />
                      ))}
                      {stage.affectedColumns.length > 4 && (
                        <Chip size="small" label={`+${stage.affectedColumns.length - 4} more`} sx={{ height: 16, fontSize: 8.5, bgcolor: T.surface }} />
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

            <Box sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: '#f8fafc' }}>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['#', 'Transformation', 'Status', 'Rows', 'Columns', '+/-', 'Affected columns'].map((h) => (
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
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: T.textSec }}>
                        {fmtTransition(step?.before_rows, step?.after_rows)}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: T.textSec }}>
                        {fmtTransition(step?.before_columns_count, step?.after_columns_count)}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: T.textSec }}>
                        {fmtAddDrop(step?.added_columns_count, step?.dropped_columns_count)}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <Typography sx={{ fontSize: 11, color: T.textSec }}>
                          {affected.slice(0, 8).join(', ') || '-'}{affected.length > 8 ? ` +${affected.length - 8} more` : ''}
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
            <Box key={cat.category} sx={{ p: 1.2, borderRadius: 1.25, border: `1px solid ${T.border}`, bgcolor: 'white' }}>
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
                borderRadius: '12px',
                boxShadow: 'none',
              }}
            >
              {running ? 'Running pipeline...' : `Run ${steps.length}-step pipeline`}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Processes all {fmt(masterDataset?.row_count)} rows | output saved as {outputName}
            </Typography>
          </Box>
        </>
      )}

      {running && (
        <Card sx={{ bgcolor: '#f8fafc' }}>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 11.5, color: T.textSec }}>
            Executing preprocessing pipeline ({steps.length} steps)...
          </Typography>
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

      {err && <Alert severity="error" icon={<Warning />} sx={{ borderRadius: 2 }}>{err}</Alert>}
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
  masterDataset  = null,
  preprocessedDataset = null,
  targetColumn   = '',
  persona        = 'technical',
  onComplete,
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
}) => {
  const [tab, setTab] = useState(0);

  const removeStep = idx     => onStepsChange(steps.filter((_, i) => i !== idx));
  const moveStep   = (a, b) => {
    const arr = [...steps];
    [arr[a], arr[b]] = [arr[b], arr[a]];
    onStepsChange(arr);
  };

  
  // Tab definitions — MUI icons + labels, no emoji
  const TAB_DEFS = [
    { Icon: Build,      label: 'Plan',      biz: 'Fix Issues', tip: 'Auto-detected cleaning issues and grouped recommendations' },
    { Icon: Code,       label: 'Builder',   biz: 'Builder',    tip: 'Custom preprocessing workbench with column explorer' },
    { Icon: TrendingUp, label: 'Engineer',  biz: 'Add Features', tip: 'AML domain templates + reusable feature engineering' },
    { Icon: QueryStats, label: 'Select',    biz: 'Filter Cols', tip: 'Leakage removal, variance, correlation, and advanced feature selection' },
    { Icon: TableChart, label: 'Preview',   biz: 'Preview',     tip: 'Before/after schema diff + 100-row sample table' },
    { Icon: PlayArrow,  label: 'Run',       biz: 'Run',         tip: 'Execute pipeline on full dataset' },
  ];

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Main content ── */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
              '& .MuiTabs-indicator': { bgcolor: T.orange, height: 3, borderRadius: '3px 3px 0 0' },
            }}>
            {TAB_DEFS.map((t, i) => {
              const TIcon = t.Icon;
              return (
                <Tooltip key={i} title={t.tip} placement="bottom">
                  <Tab label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <TIcon sx={{ fontSize: 15 }} />
                      <span>{persona === 'business' ? t.biz : t.label}</span>
                      {i === TAB_DEFS.length - 1 && steps.length > 0 && (
                        <Box sx={{ px: 0.75, py: 0.1, bgcolor: tab === TAB_DEFS.length - 1 ? T.orange : T.orangeLight, borderRadius: '20px' }}>
                          <Typography sx={{ fontSize: 9.5, color: tab === TAB_DEFS.length - 1 ? 'white' : T.orange, fontWeight: 700 }}>
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
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
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
            />
          )}
          {tab === 3 && (
            <SelectTab
              masterDataset={masterDataset}
              steps={steps}
              onStepsChange={onStepsChange}
              targetColumn={targetColumn}
            />
          )}
          {tab === 4 && (
            <PreviewTab
              masterDataset={masterDataset}
              preprocessedDataset={preprocessedDataset}
              targetColumn={targetColumn}
              steps={steps}
              onPreview={onPreview}
              preview={preview}
              persona={persona}
            />
          )}
          {tab === 5 && (
            <RunTab
              masterDataset={masterDataset}
              steps={steps}
              targetColumn={targetColumn}
              preview={preview}
              onRun={onRun}
              onComplete={onComplete}
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
        masterDataset={masterDataset}
        preprocessedDataset={preprocessedDataset}
        activePipelineId={activePipelineId}
        activePipelineName={activePipelineName}
        onPipelineActivated={onPipelineActivated}
      />
    </Box>
  );
};

export default PreprocessingWorkbench;
