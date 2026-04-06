/**
 * MLOpsWorkbench.jsx  - Desktop Workbench Orchestrator
 *
 * Single source of truth for the app chrome bar.
 * Left side:  PwC logo · "MLOps Workbench" title
 * Next:       [AutoBuild Workbench] [Expert Workbench]  mode toggle buttons
 * Right side: experiment name · pipeline chip · progress · persona · action icons
 *             (only shown when Expert mode is active)
 */
import PwCLogo from '@assets/PwC_2025_Logo_1.png';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box, Button, Chip, CircularProgress, Divider, IconButton, LinearProgress, Paper,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Drawer, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  AccountTree, Add, Analytics, Article, Build, CheckCircle, ChevronLeft, ChevronRight,
  CloudUpload, Close, Dashboard, DeleteForever, Engineering, Flag, Lock,
  MenuOpen, ModelTraining, Person, PlayArrow, Refresh, Restore, SaveAlt, Settings,
  Tune, ViewSidebar,
} from '@mui/icons-material';

import mlopsApi               from '../services/mlopsApi';
import DataUploadScreen       from '../components/DataUploadScreen';
import MasterDatasetScreen    from '../components/MasterDatasetScreen';
import TargetVariableScreen   from '../components/TargetVariableScreen';
import EDAScreen              from '../components/EDAScreen';
import PreprocessingWorkbench from '../components/PreprocessingWorkbench';
import ModelTrainingPanel     from '../components/ModelTrainingPanel';
import ModelValidationScreen  from '../components/ModelValidationScreen';
import DeploymentDashboard    from '../components/DeploymentDashboard';
import ModelReleaseScreen     from '../components/ModelReleaseScreen';
import RunReport              from '../components/RunReport';
import WorkbenchPipelinesScreen from '../components/WorkbenchPipelinesScreen';
import AmlJourneyGuideDialog  from '../components/AmlJourneyGuideDialog';
import BusinessStaleStepCard  from '../components/BusinessStaleStepCard';
import ExecutiveIntelligenceSummaryDialog from '@components/executive_summary/ExecutiveIntelligenceSummaryDialog';
import { SHOW_STEP_GUARDS } from '../utils/uiFlags';
import { derivePipelineStepCompletion, derivePipelineStepStatuses, getManifestStepState, getScreenState } from '../utils/pipelineState';
import { FCC_THEME as T } from '../theme/fccWorkbenchTheme';
import {
  normalizePreprocessSteps,
  normalizePreprocessSuggestions,
  unwrapApiPayload,
} from '../utils/preprocessingNormalization';
import { useAppContext } from '@context/AppContext';
import { persistWorkbenchView } from '../../../utils/navigationPersistence';

// ── Design Tokens ─────────────────────────────────────────────────────────────
const D = {
  orange:       T.accent,
  orangeHover:  T.accentHover,
  orangeLight:  T.accentSoft,
  chrome:       T.chrome,
  chromeBorder: T.chromeBorder,
  rail:         T.rail,
  railBorder:   T.railBorder,
  railHover:    T.railHover,
  railActive:   T.railActive,
  canvas:       T.canvas,
  panel:        T.panel,
  panelAlt:     T.panelAlt,
  panelMuted:   T.panelMuted,
  border:       T.border,
  textPrimary:  T.textOnDark,
  textMuted:    T.textMutedOnDark,
  textBody:     T.text,
  textSoft:     T.textMuted,
  done:         T.success,
  doneBg:       T.successBg,
  warning:      T.warning,
  warningBg:    T.warningBg,
  error:        T.error,
  locked:       'rgba(255,255,255,0.04)',
  lockedText:   T.textMutedOnDark,
  railW:        260,
  railCollapsedW: 84,
  contextW:     280,
  topH:         48,
};

const ALLOW_LOCKED_NAV = true;
const DEFAULT_EXPERIMENT_NAME = 'Experiment 1';
const DEFAULT_PIPELINE_SESSION_STATE = {
  by_env: {},
  last_env_id: null,
};

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS_KEY = 'mlops.workbench.v2';
const LS_PIPELINE_SESSION_KEY = 'mlops.workbench.pipeline.session.v1';

const lsRead  = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } };
const lsWrite = (patch) => { try { const p = lsRead(); localStorage.setItem(LS_KEY, JSON.stringify({ ...p, ...patch })); } catch { /* ignore */ } };
const lsClear = () => { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } };

const resolvePipelineEnvKey = (envId) => {
  const fallback = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('active_env') : '';
  const raw = String(envId || fallback || 'default').trim();
  return raw || 'default';
};

const readPipelineSessionStore = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_PIPELINE_SESSION_KEY) || '{}');
    return {
      by_env: parsed?.by_env && typeof parsed.by_env === 'object' ? { ...parsed.by_env } : {},
      last_env_id: String(parsed?.last_env_id || '').trim() || null,
    };
  } catch {
    return { ...DEFAULT_PIPELINE_SESSION_STATE };
  }
};

const readLegacyPipelineSession = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_PIPELINE_SESSION_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return null;
    const hasLegacyShape = Object.prototype.hasOwnProperty.call(parsed, 'pipeline_id')
      || Object.prototype.hasOwnProperty.call(parsed, 'name');
    if (!hasLegacyShape) return null;
    return {
      pipeline_id: parsed.pipeline_id || null,
      name: String(parsed.name || '').trim(),
    };
  } catch {
    return null;
  }
};

const readPipelineSession = (envId) => {
  const envKey = resolvePipelineEnvKey(envId);
  const store = readPipelineSessionStore();
  const scoped = store.by_env?.[envKey];
  if (scoped && typeof scoped === 'object') {
    return {
      ...scoped,
      env_id: envKey,
    };
  }
  const legacy = readLegacyPipelineSession();
  if (legacy) {
    return {
      ...legacy,
      workflow_session_id: null,
      env_id: envKey,
    };
  }
  return { env_id: envKey, workflow_session_id: null };
};

const writePipelineSession = (envId, patch) => {
  try {
    const envKey = resolvePipelineEnvKey(envId);
    const store = readPipelineSessionStore();
    store.by_env[envKey] = {
      ...(store.by_env?.[envKey] || {}),
      ...patch,
      env_id: envKey,
    };
    store.last_env_id = envKey;
    localStorage.setItem(LS_PIPELINE_SESSION_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
};

const clearPipelineSession = (envId) => {
  try {
    const envKey = resolvePipelineEnvKey(envId);
    const store = readPipelineSessionStore();
    if (Object.prototype.hasOwnProperty.call(store.by_env, envKey)) {
      delete store.by_env[envKey];
    }
    if (Object.keys(store.by_env).length === 0) {
      localStorage.removeItem(LS_PIPELINE_SESSION_KEY);
      return;
    }
    if (store.last_env_id === envKey) {
      store.last_env_id = Object.keys(store.by_env)[0] || null;
    }
    localStorage.setItem(LS_PIPELINE_SESSION_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
};

const datasetCacheKeyForEnv = (envId) => `mlops.datasets.cache.${resolvePipelineEnvKey(envId)}`;

// ── Step Definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 'data',       label: 'Data Upload',      biz: 'Load Data',         icon: CloudUpload,   desc: 'Upload CSV or Parquet source tables' },
  { id: 'master',     label: 'Master Dataset',   biz: 'Combine Tables',    icon: AccountTree,   desc: 'Join tables into one model-ready dataset' },
  { id: 'target',     label: 'Target Variable',  biz: 'What to Predict',   icon: Flag,          desc: 'Define the outcome to model' },
  { id: 'eda',        label: 'Explore Data',     biz: 'Understand Data',   icon: Analytics,     desc: 'Profile, correlate, and visualise' },
  { id: 'preprocess', label: 'Preprocessing',    biz: 'Clean & Transform', icon: Tune,          desc: 'Impute, encode, engineer features' },
  { id: 'model',      label: 'Model Training',   biz: 'Train Model',       icon: ModelTraining, desc: 'Train and evaluate ML models' },
  { id: 'validation', label: 'Model Validation', biz: 'Validate',          icon: CheckCircle,   desc: 'Event-loss constrained threshold tuning' },
  { id: 'registry',   label: 'Model Release',    biz: 'Release & Deploy',  icon: SaveAlt,       desc: 'Register, govern threshold, and deploy' },
  { id: 'dashboard',  label: 'Live Dashboard',   biz: 'Monitor',           icon: Dashboard,     desc: 'Post-deployment suppression monitoring' },
  { id: 'reports',    label: 'Reports',          biz: 'Reports',           icon: Article,       desc: 'Business run reports and historical comparisons' },
  { id: 'pipelines',  label: 'Pipeline Hub',     biz: 'Pipelines',         icon: AccountTree,   desc: 'Resume, run, and manage saved pipelines' },
];

const VALIDATION_SUBSTEP_LABELS = [
  'Overview',
  'Model Comparison',
  'Threshold Tuning',
  'OOT Validation',
  'Stability & Risks',
  'Summary',
];

const MASTER_SUBSTEP_LABELS = {
  base: 'Choose Base Table',
  tables: 'Select Tables to Join',
  rollup: 'Aggregate Transaction History',
  aggregation: 'Review Aggregations',
  transforms: 'Apply Business Rules',
  labels: 'Define Outcome Labels',
  preview: 'Preview and Build',
};

const TARGET_SUBSTEP_LABELS = [
  'Choose Outcome',
  'Create Outcome',
  'Field Guide',
];

const EDA_SUBSTEP_LABELS = {
  dashboard: 'Dashboard',
  imbalance: 'Alert Imbalance',
  riskscore: 'Risk Score',
  rules: 'Rule Intelligence',
  entity: 'Entity Risk',
  behaviour: 'Behavioural Patterns',
  compliance: 'Compliance Enrichment',
  columns: 'Column Explorer',
  quality: 'Data Quality',
  corr: 'Correlation',
  drivers: 'Drivers',
  advanced: 'Advanced EDA',
  insights: 'Insights',
  explorer: 'Explorer',
};

const MODEL_SUBSTEP_LABELS = [
  'Configure',
  'Check',
  'Train',
  'Evaluate',
  'Business Understanding',
  'Compare',
  'Scoring Ledger',
  'Run Report',
];

const RUN_REF_PREFIX = 'FCC-RUN-';
const toRunRef = (pipelineId) => {
  const id = Number(pipelineId || 0);
  if (!Number.isFinite(id) || id <= 0) return '';
  return `${RUN_REF_PREFIX}${String(id).padStart(5, '0')}`;
};

const normalizeWorkbenchStep = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'data_upload') return 'data';
  if (raw === 'ready') return 'registry';
  return raw;
};

const isWorkbenchStep = (value) => STEPS.some((step) => step.id === value);

const normalizeWorkbenchRunId = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const buildWorkbenchRoute = (pipelineId, stepId = 'pipelines') => {
  const normalizedPipelineId = normalizeWorkbenchRunId(pipelineId);
  if (!normalizedPipelineId) return '/mlops/runs';
  const normalizedStep = normalizeWorkbenchStep(stepId) || 'pipelines';
  return `/mlops/runs/${normalizedPipelineId}/${normalizedStep}`;
};

const deriveWorkflowCheckpoint = ({
  activeStep,
  datasets,
  masterDataset,
  targetColumn,
  edaDone,
  preprocessDataset,
  activeModelRun,
  modelRun,
  validationReport,
  registryEntry,
}) => {
  const currentStep = normalizeWorkbenchStep(activeStep);
  const hasDeployment = String(registryEntry?.deployment_id || '').trim().length > 0;
  const hasRegistry = Boolean(registryEntry);
  const hasValidation = Boolean(validationReport);
  const hasModel = String(activeModelRun?.job_id || modelRun?.job_id || '').trim().length > 0;
  const hasPreprocess = Boolean(preprocessDataset);
  const hasEda = Boolean(edaDone);
  const hasTarget = String(targetColumn || '').trim().length > 0;
  const hasMaster = Boolean(masterDataset);
  const hasData = Array.isArray(datasets) && datasets.length > 0;

  if (hasDeployment && (currentStep === 'dashboard' || currentStep === 'reports')) return 'FCC_DASHBOARD_READY';
  if (hasDeployment) return 'FCC_DEPLOYED';
  if (hasRegistry || currentStep === 'ready') return 'FCC_REGISTRY_READY';
  if (hasValidation) return 'FCC_VALIDATION_READY';
  if (hasModel) return 'FCC_MODEL_READY';
  if (hasPreprocess) return 'FCC_PREPROCESS_READY';
  if (hasEda) return 'FCC_EDA_READY';
  if (hasTarget) return 'FCC_TARGET_READY';
  if (hasMaster) return 'FCC_MASTER_READY';
  if (hasData) return 'FCC_DATA_READY';
  return 'FCC_SESSION_STARTED';
};

const formatDependencyStamp = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
};

const nestedRunId = (value) => {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.job_id
    || value.run_id
    || value.entry?.run_id
    || value.registry_entry?.run_id
    || value.active_model_run?.job_id
    || value.model?.job_id
    || '',
  ).trim();
};

const nestedDeploymentId = (value) => {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.deployment_id
    || value.entry?.deployment_id
    || value.registry_entry?.deployment_id
    || value.deployment?.deployment_id
    || '',
  ).trim();
};

// ── Step Lock Logic ───────────────────────────────────────────────────────────
function stepStatus(id, ctx) {
  const {
    datasets,
    masterDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    modelRun,
    validationReport,
    registryEntry,
    staleSteps = [],
    hasPipelineContext = false,
    savedStepCompletion = {},
    savedStepStatuses = {},
  } = ctx;
  if (id !== 'pipelines' && !hasPipelineContext) return 'locked';
  const explicitStatus = String(savedStepStatuses?.[id] || '').toLowerCase();
  if (explicitStatus === 'completed') return 'done';
  if (explicitStatus === 'invalidated') return 'stale';
  if (explicitStatus === 'blocked') return 'locked';
  if (explicitStatus === 'failed') return 'stale';
  if (explicitStatus === 'in_progress') return 'active';
  const hasData = (datasets || []).length > 0 || Boolean(savedStepCompletion?.data);
  const hasMaster = Boolean(masterDataset) || Boolean(savedStepCompletion?.master);
  const hasTarget = Boolean(String(targetColumn || '').trim()) || Boolean(savedStepCompletion?.target);
  const hasEda = Boolean(edaDone) || Boolean(savedStepCompletion?.eda);
  const hasPreprocess = Boolean(preprocessDataset) || Boolean(savedStepCompletion?.preprocess);
  const hasModel = Boolean(modelRun) || Boolean(savedStepCompletion?.model);
  const hasValidation = Boolean(validationReport) || Boolean(savedStepCompletion?.validation);
  const hasRegistry = Boolean(registryEntry) || Boolean(savedStepCompletion?.registry);
  let baseStatus = 'locked';
  switch (id) {
    case 'data':       baseStatus = hasData ? 'done' : 'active'; break;
    case 'pipelines':  baseStatus = 'active'; break;
    case 'reports':    baseStatus = (hasModel || Boolean(savedStepCompletion?.reports)) ? 'done' : 'active'; break;
    case 'master':     baseStatus = !hasData ? 'locked' : hasMaster ? 'done' : 'active'; break;
    case 'target':     baseStatus = !hasMaster ? 'locked' : hasTarget ? 'done' : 'active'; break;
    case 'eda':        baseStatus = !hasMaster ? 'locked' : hasEda ? 'done' : 'active'; break;
    case 'preprocess': baseStatus = !hasMaster ? 'locked' : hasPreprocess ? 'done' : 'active'; break;
    case 'model':      baseStatus = (!hasPreprocess && !hasMaster) ? 'locked' : hasModel ? 'done' : 'active'; break;
    case 'validation': baseStatus = !hasModel ? 'locked' : hasValidation ? 'done' : 'active'; break;
    case 'registry':   baseStatus = !hasModel ? 'locked' : hasRegistry ? 'done' : 'active'; break;
    case 'ready':      baseStatus = !hasModel ? 'locked' : hasRegistry ? 'done' : 'active'; break;
    case 'dashboard':  baseStatus = !hasModel ? 'locked' : Boolean(savedStepCompletion?.dashboard) ? 'done' : 'active'; break;
    default:           baseStatus = 'locked';
  }
  const staleSet = new Set((staleSteps || []).map((step) => String(step)));
  if (baseStatus === 'done' && staleSet.has(String(id))) return 'stale';
  return baseStatus;
}

const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString());

// ── Mode toggle button (AutoBuild / Expert) ───────────────────────────────────
const ModeButton = ({ icon: Icon, label, active, onClick }) => (
  <Box
    onClick={onClick}
    sx={{
      display: 'flex', alignItems: 'center', gap: 0.75,
      px: 1.5, height: D.topH,
      cursor: 'pointer',
      borderBottom: active ? `2px solid ${D.orange}` : '2px solid transparent',
      color: active ? D.orange : D.textMuted,
      fontSize: 12, fontWeight: active ? 700 : 500,
      transition: 'all 0.15s ease',
      userSelect: 'none',
      '&:hover': { color: active ? D.orange : D.textPrimary, bgcolor: 'rgba(255,255,255,0.04)' },
    }}
  >
    <Icon sx={{ fontSize: 14 }} />
    <span>{label}</span>
  </Box>
);

// ── Context Panel ─────────────────────────────────────────────────────────────
const ContextPanel = ({
  datasets, masterDataset, targetColumn, preprocessDataset,
  modelRun, validationReport, registryEntry, qualityScore, onClose,
  stepStatuses = {}, activeStep = 'data', panelWidth = D.contextW, latestChange = null,
  hasPipelineContext = false,
}) => (
  <Box sx={{
    width: panelWidth, borderLeft: `1px solid ${D.border}`,
    bgcolor: D.panelAlt, display: 'flex', flexDirection: 'column',
    overflowY: 'auto', flexShrink: 0,
  }}>
    <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${D.border}` }}>
      <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 1, color: D.textSoft, fontSize: 10 }}>
        Pipeline Status
      </Typography>
      <IconButton size="small" onClick={onClose} sx={{ p: 0.5 }}>
        <Close sx={{ fontSize: 14, color: D.textSoft }} />
      </IconButton>
    </Box>

    <Box sx={{ p: 2 }}>
      {!hasPipelineContext ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          <Typography sx={{ fontSize: 11.5, color: D.textBody, fontWeight: 700 }}>
            No active pipeline selected
          </Typography>
          <Typography sx={{ fontSize: 11.25, color: D.textBody, mt: 0.35 }}>
            Create or select a run from Pipeline Hub before loading data, reviewing artefacts, or continuing step progress.
          </Typography>
        </Alert>
      ) : (
        <>
          <Typography variant="caption" fontWeight={700} sx={{ color: D.textSoft, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 9 }}>
            Uploaded Datasets ({datasets.length})
          </Typography>
          <Stack spacing={0.75} mt={0.75} mb={2}>
            {datasets.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>No files uploaded yet</Typography>
            ) : datasets.map((d) => (
              <Box key={d.dataset_id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75, bgcolor: D.panel, borderRadius: 0, border: `1px solid ${D.border}` }}>
                <Box>
                  <Typography variant="caption" fontWeight={600} sx={{ color: D.textBody, display: 'block', lineHeight: 1.2 }}>{d.dataset_type}</Typography>
                  <Typography variant="caption" sx={{ color: D.textSoft, fontSize: 10 }}>{fmt(d.row_count)} rows</Typography>
                </Box>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: D.done, flexShrink: 0 }} />
              </Box>
            ))}
          </Stack>

          <Divider sx={{ my: 1.5 }} />

          <Typography variant="caption" fontWeight={700} sx={{ color: D.textSoft, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 9 }}>
            Pipeline Artefacts
          </Typography>
          <Stack spacing={0.75} mt={0.75}>
            {[
              { label: 'Master Dataset', val: masterDataset?.dataset_type || null, hint: masterDataset ? `${fmt(masterDataset.row_count)} rows` : 'Not built', step: 'Step 2' },
              { label: 'Target Variable', val: targetColumn || null, hint: targetColumn ? 'Confirmed' : 'Not set', step: 'Step 3' },
              { label: 'EDA Review', val: stepStatuses?.eda === 'done' ? 'Completed' : null, hint: stepStatuses?.eda === 'done' ? 'Marked complete' : 'Pending', step: 'Step 4' },
              { label: 'Preprocessed', val: preprocessDataset?.dataset_type || null, hint: preprocessDataset ? `${fmt(preprocessDataset.row_count)} rows` : 'Not run', step: 'Step 5' },
              { label: 'Model Run', val: modelRun ? 'Trained' : null, hint: modelRun ? `AUC: ${modelRun.metrics?.roc_auc?.toFixed(3) || modelRun.auc?.toFixed(3) || '-'}` : 'Not trained', step: 'Step 6' },
              { label: 'Validation', val: validationReport ? 'Done' : null, hint: validationReport ? `Threshold ${Number(validationReport.optimal_threshold ?? 0.5).toFixed(2)}` : 'Not run', step: 'Step 7' },
              { label: 'Registry', val: registryEntry ? 'Registered' : null, hint: registryEntry ? String(registryEntry.stage || 'candidate').toUpperCase() : 'Not registered', step: 'Step 8' },
            ].map(({ label, val, hint, step }) => (
              <Box key={label} sx={{ px: 1.5, py: 0.75, bgcolor: D.panel, borderRadius: 0, border: `1px solid ${D.border}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" sx={{ color: D.textSoft, fontSize: 10 }}>{label}</Typography>
                  <Typography variant="caption" sx={{ color: D.textSoft, opacity: 0.7, fontSize: 9 }}>{step}</Typography>
                </Stack>
                <Typography variant="caption" fontWeight={600} sx={{ color: val ? D.textBody : D.textSoft }}>{hint}</Typography>
              </Box>
            ))}
          </Stack>

          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" fontWeight={700} sx={{ color: D.textSoft, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 9 }}>
            Step Completion
          </Typography>
          <Stack spacing={0.7} mt={0.75}>
            {STEPS.filter((s) => s.id !== 'pipelines').map((step) => {
              const status    = stepStatuses?.[step.id] || 'active';
              const isDone    = status === 'done';
              const isLocked  = status === 'locked';
              const isStale   = status === 'stale';
              const isCurrent = activeStep === step.id;
              return (
                <Box key={step.id} sx={{
                  px: 1.25, py: 0.75, borderRadius: 0,
                  border: `1px solid ${isDone ? T.successBorder : isStale ? T.warningBorder : isLocked ? D.border : T.borderStrong}`,
                  bgcolor: isDone ? D.doneBg : isStale ? D.panelMuted : isCurrent ? T.panelAlt : D.panel,
                }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: D.textBody }}>{step.label}</Typography>
                    <Chip size="small"
                      label={isDone ? 'Done' : isStale ? 'Stale' : isLocked ? 'Blocked' : isCurrent ? 'Current' : 'Pending'}
                      sx={{
                        height: 16, fontSize: 9, fontWeight: 700,
                        bgcolor: D.panel,
                        color: isDone ? D.done : isStale ? D.warning : isLocked ? D.textSoft : isCurrent ? D.orange : D.textSoft,
                        border: `1px solid ${isDone ? T.successBorder : isStale ? T.warningBorder : isLocked ? D.border : T.borderStrong}`,
                        borderRadius: 0,
                      }}
                    />
                  </Stack>
                  <Typography sx={{ fontSize: 9.5, color: D.textSoft, lineHeight: 1.25 }}>{step.desc}</Typography>
                </Box>
              );
            })}
          </Stack>

          {latestChange?.message && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" fontWeight={700} sx={{ color: D.textSoft, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 9 }}>
                Change Impact
              </Typography>
              <Alert severity="warning" sx={{ mt: 0.75, py: 0.5, borderRadius: 0 }}>
                {latestChange.message}
              </Alert>
            </>
          )}

          {qualityScore && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" fontWeight={700} sx={{ color: D.textSoft, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 9 }}>
                Data Quality
              </Typography>
              <Box sx={{ mt: 0.75, px: 1.5, py: 1, bgcolor: D.panel, borderRadius: 0, border: `1px solid ${D.border}` }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption" color="text.secondary">Score</Typography>
                  <Typography variant="caption" fontWeight={700} sx={{ color: qualityScore.score >= 80 ? D.done : D.warning }}>
                    {(qualityScore.score || 0).toFixed(0)}/100
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={qualityScore.score || 0}
                  sx={{ borderRadius: 0, height: 5, bgcolor: D.border, '& .MuiLinearProgress-bar': { bgcolor: qualityScore.score >= 80 ? D.done : D.warning, borderRadius: 0 } }}
                />
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  </Box>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN WORKBENCH
// ══════════════════════════════════════════════════════════════════════════════
const MLOpsWorkbench = ({ renderAutoBuild, routeRunId = null, routeStepId = '' }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  const { activeEnv, setActiveTool } = useAppContext();
  const currentEnvId = useMemo(() => resolvePipelineEnvKey(activeEnv), [activeEnv]);
  const normalizedRouteRunId = useMemo(() => normalizeWorkbenchRunId(routeRunId), [routeRunId]);
  const normalizedRouteStep = useMemo(() => normalizeWorkbenchStep(routeStepId), [routeStepId]);
  // ── Read localStorage synchronously on first render ────────────────────────
  const saved              = useMemo(() => lsRead(), []);
  const savedPipelineSession = useMemo(() => readPipelineSession(currentEnvId), [currentEnvId]);

  // ── Mode: 'auto' | 'expert' ───────────────────────────────────────────────
  const [mode,            setMode]            = useState(saved.mode || 'expert');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const modeSwitchTimerRef = useRef(null);
  const journeySaveTimerRef = useRef(null);
  const workflowSaveTimerRef = useRef(null);
  const workflowSessionRef = useRef(null);
  const restoredWorkflowSessionKeyRef = useRef('');
  const workflowPersistencePausedRef = useRef(false);
  const screenStatePersistencePausedRef = useRef(false);
  const autoResumeKeyRef = useRef('');
  const previousEnvIdRef = useRef(currentEnvId);
  const routeResumeRef = useRef('');
  const workflowSessionFetchKeyRef = useRef('');

  const [activeStep,      setActiveStep]      = useState(
    normalizedRouteStep || normalizeWorkbenchStep(saved.activeStep || 'data') || 'data',
  );
  const [persona,         setPersona]         = useState(saved.persona || 'business');
  const [experimentName,  setExperimentName]  = useState(savedPipelineSession.name || DEFAULT_EXPERIMENT_NAME);
  const [railCollapsed,   setRailCollapsed]   = useState(Boolean(saved.railCollapsed));
  const [showContext,     setShowContext]      = useState(true);
  const [mobileRailOpen,  setMobileRailOpen]  = useState(false);
  const [viewportWidth,   setViewportWidth]   = useState(
    typeof window === 'undefined' ? 1600 : window.innerWidth,
  );
  const [resetting,       setResetting]       = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [journeyGuideOpen, setJourneyGuideOpen] = useState(false);
  const [executiveSummaryOpen, setExecutiveSummaryOpen] = useState(false);
  const handleExecutiveModuleOpen = useCallback((cta) => {
    const tool = String(cta?.tool || '').trim().toLowerCase();
    const target = String(cta?.target || '').trim();
    if (!target) return;
    if (tool === 'fcc') {
      setActiveStep(target);
      setExecutiveSummaryOpen(false);
      return;
    }
    if (tool === 'sentinel') {
      persistWorkbenchView({ envId: activeEnv, toolKey: 'investigation' }, target);
      setExecutiveSummaryOpen(false);
      navigate('/investigation');
    }
  }, [activeEnv, navigate]);
  const [pipelineLauncherOpen, setPipelineLauncherOpen] = useState(true);
  const [savedPipelines,  setSavedPipelines]  = useState([]);
  const [savedPipelinesLoaded, setSavedPipelinesLoaded] = useState(false);
  const [activePipelineId,   setActivePipelineId]   = useState(normalizedRouteRunId || savedPipelineSession.pipeline_id || null);
  const [activePipelineName, setActivePipelineName] = useState(savedPipelineSession.name || '');
  const [activePipelineMeta, setActivePipelineMeta] = useState(null);
  const [pipelineSelectionNotice, setPipelineSelectionNotice] = useState('');
  const [createPipelineDialogOpen, setCreatePipelineDialogOpen] = useState(false);
  const [newPipelineName,  setNewPipelineName]  = useState('');
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineError, setNewPipelineError] = useState('');
  const datasetCacheKey = useMemo(() => datasetCacheKeyForEnv(currentEnvId), [currentEnvId]);

  // ── Pipeline state ──────────────────────────────────────────────────────────
  const [datasets,          setDatasets]          = useState([]);
  const [masterDataset,     setMasterDataset]     = useState(null);
  const [targetColumn,      setTargetColumn]      = useState(saved.targetColumn || '');
  const [edaDone,           setEdaDone]           = useState(false);
  const [preprocessDataset, setPreprocessDataset] = useState(null);
  const [building,          setBuilding]          = useState(false);
  const [modelRun,          setModelRun]          = useState(null);
  const [validationReport,  setValidationReport]  = useState(null);
  const [registryEntry,     setRegistryEntry]     = useState(null);
  const [activeModelRun,    setActiveModelRun]    = useState(null);
  const [reportRunId,       setReportRunId]       = useState(saved.reportRunId || '');
  const [masterCurrentStepId, setMasterCurrentStepId] = useState('base');
  const [targetActiveTab, setTargetActiveTab] = useState(0);
  const [edaActiveTab, setEdaActiveTab] = useState('dashboard');
  const [modelActiveTab, setModelActiveTab] = useState(0);
  const [validationActiveTab, setValidationActiveTab] = useState(0);
  const [preprocessPlan,    setPreprocessPlan]    = useState([]);
  const [preprocessSteps,   setPreprocessSteps]   = useState([]);
  const [preprocessPreview, setPreprocessPreview] = useState(null);
  const [qualityScore,      setQualityScore]      = useState(null);

  const handleTargetChange = useCallback((nextTarget, options = {}) => {
    const resolved = String(nextTarget || '').trim();
    const previous = String(targetColumn || '').trim();
    const changed = resolved !== previous;
    setTargetColumn(resolved);
    if (changed && options?.resetDownstream) {
      setEdaDone(false);
      setPreprocessPlan([]);
      setPreprocessSteps([]);
      setPreprocessPreview(null);
      setPreprocessDataset(null);
      setModelRun(null);
      setValidationReport(null);
      setRegistryEntry(null);
      setActiveModelRun(null);
      setQualityScore(null);
      setReportRunId('');
    }
  }, [targetColumn]);

  const handlePreprocessStepsChange = useCallback((nextSteps) => {
    setPreprocessSteps((prev) => {
      const resolved = typeof nextSteps === 'function' ? nextSteps(prev) : nextSteps;
      return normalizePreprocessSteps(resolved || []);
    });
  }, []);

  const compactDatasetSnapshot = useCallback((dataset) => {
    if (!dataset || typeof dataset !== 'object') return null;
    const datasetId = Number(dataset?.dataset_id || 0) || null;
    return {
      dataset_id: datasetId,
      dataset_type: String(dataset?.dataset_type || '').trim() || null,
      name: String(dataset?.name || dataset?.dataset_name || '').trim() || null,
      row_count: Number(dataset?.row_count || dataset?.rows || 0) || 0,
      column_count: Number(dataset?.column_count || (Array.isArray(dataset?.columns) ? dataset.columns.length : 0) || 0) || 0,
      columns: Array.isArray(dataset?.columns) ? dataset.columns : [],
    };
  }, []);

  const compactFeatureImportance = useCallback((items, limit = 15) => {
    if (!Array.isArray(items)) return [];
    return items
      .slice(0, limit)
      .map((item) => ({
        feature: String(item?.feature || item?.name || '').trim(),
        importance: Number(item?.importance ?? item?.score ?? item?.value ?? 0) || 0,
      }))
      .filter((item) => item.feature);
  }, []);

  const compactThresholdTable = useCallback((rows, limit = 60) => {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, limit).map((row) => ({
      threshold: Number(row?.threshold ?? row?.opt_threshold ?? 0) || 0,
      precision: Number(row?.precision ?? 0) || 0,
      recall: Number(row?.recall ?? 0) || 0,
      f1: Number(row?.f1 ?? 0) || 0,
      accuracy: Number(row?.accuracy ?? 0) || 0,
      suppression_rate_pct: Number(row?.suppression_rate_pct ?? row?.suppression_pct ?? 0) || 0,
      event_loss_pct: Number(row?.event_loss_pct ?? 0) || 0,
    }));
  }, []);

  const compactModelRunSnapshot = useCallback((run) => {
    if (!run || typeof run !== 'object' || !run?.job_id) return null;
    const metrics = run?.metrics && typeof run.metrics === 'object' ? run.metrics : {};
    const results = run?.results && typeof run.results === 'object' ? run.results : {};
    const featureImportance = compactFeatureImportance(
      results?.feature_importance || metrics?.feature_importance || run?.feature_importance,
    );
    return {
      job_id: String(run.job_id || '').trim(),
      algorithm: run.algorithm || run.algorithm_id || '',
      algorithm_id: run.algorithm_id || run.algorithm || '',
      auc: run.auc ?? metrics?.roc_auc ?? null,
      threshold: run.threshold ?? metrics?.optimal_threshold ?? null,
      grain: run.grain || metrics?.grain || null,
      metrics: {
        roc_auc: metrics?.roc_auc ?? null,
        pr_auc: metrics?.pr_auc ?? null,
        precision: metrics?.precision ?? null,
        recall: metrics?.recall ?? null,
        f1: metrics?.f1 ?? null,
        accuracy: metrics?.accuracy ?? null,
        balanced_accuracy: metrics?.balanced_accuracy ?? null,
        specificity: metrics?.specificity ?? null,
        suppression_rate_pct: metrics?.suppression_rate_pct ?? null,
        event_loss_pct: metrics?.event_loss_pct ?? null,
        optimal_threshold: metrics?.optimal_threshold ?? run.threshold ?? null,
        confusion_matrix: metrics?.confusion_matrix || null,
        roc_curve: Array.isArray(metrics?.roc_curve) ? metrics.roc_curve.slice(0, 200) : [],
        pr_curve: Array.isArray(metrics?.pr_curve) ? metrics.pr_curve.slice(0, 200) : [],
        threshold_table: compactThresholdTable(metrics?.threshold_table),
      },
      results: {
        summary: results?.summary || null,
        feature_importance: featureImportance,
      },
    };
  }, [compactFeatureImportance, compactThresholdTable]);

  const compactValidationSnapshot = useCallback((report) => {
    if (!report || typeof report !== 'object') return null;
    return {
      job_id: report?.job_id || report?.run_id || activeModelRun?.job_id || modelRun?.job_id || null,
      report_id: report?.report_id || null,
      validation_id: report?.validation_id || null,
      optimal_threshold: report?.optimal_threshold ?? null,
      selected_threshold: report?.selected_threshold ?? report?.locked_threshold ?? report?.optimal_threshold ?? null,
      locked_threshold: report?.locked_threshold ?? report?.selected_threshold ?? report?.optimal_threshold ?? null,
      suppression_rate_pct: report?.suppression_rate_pct ?? null,
      event_loss_pct: report?.event_loss_pct ?? null,
      validation_rows: report?.validation_rows ?? report?.holdout_rows ?? null,
      train_rows: report?.train_rows ?? null,
      split_strategy: report?.split_strategy || report?.validation_split || null,
      threshold_search_method: report?.threshold_search_method || null,
      calibration_used: report?.calibration_used ?? null,
      recommendation: report?.recommendation || null,
      confusion_matrix: report?.confusion_matrix || null,
      metrics: {
        roc_auc: report?.roc_auc ?? report?.metrics?.roc_auc ?? null,
        pr_auc: report?.pr_auc ?? report?.metrics?.pr_auc ?? null,
        precision: report?.precision ?? report?.metrics?.precision ?? null,
        recall: report?.recall ?? report?.metrics?.recall ?? null,
        f1: report?.f1 ?? report?.metrics?.f1 ?? null,
        accuracy: report?.accuracy ?? report?.metrics?.accuracy ?? null,
        balanced_accuracy: report?.balanced_accuracy ?? report?.metrics?.balanced_accuracy ?? null,
        specificity: report?.specificity ?? report?.metrics?.specificity ?? null,
      },
      threshold_table: compactThresholdTable(report?.threshold_table),
      business_summary: report?.business_summary || null,
    };
  }, [activeModelRun?.job_id, compactThresholdTable, modelRun?.job_id]);

  const compactRegistryEntry = useCallback((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    return {
      job_id: entry?.job_id || entry?.run_id || null,
      model_name: entry?.model_name || null,
      stage: entry?.stage || null,
      threshold: entry?.threshold ?? entry?.selected_threshold ?? null,
      deployment_id: entry?.deployment_id || null,
      deployment_status: entry?.deployment_status || null,
      validation_status: entry?.validation_status || null,
      version: entry?.version || null,
      notes: entry?.notes || null,
      updated_at: entry?.updated_at || null,
    };
  }, []);

  const restoreWorkflowRuntimeState = useCallback((session, availableDatasets = []) => {
    const currentState = session?.current_state?.mlops_state || {};
    const stableState = session?.last_stable_state?.mlops_state || {};
    const mlopsState = Object.keys(currentState).length ? currentState : stableState;
    if (!mlopsState || typeof mlopsState !== 'object') return;

    const catalog = Array.isArray(availableDatasets) ? availableDatasets : [];
    const lookupDataset = (candidateId, fallbackSnapshot = null) => {
      const datasetId = Number(candidateId || fallbackSnapshot?.dataset_id || 0) || null;
      if (datasetId) {
        const live = catalog.find((item) => Number(item?.dataset_id || 0) === datasetId);
        if (live) return live;
      }
      return fallbackSnapshot || null;
    };

    const savedDatasets = Array.isArray(mlopsState?.datasets) ? mlopsState.datasets : [];
    if (savedDatasets.length) {
      setDatasets(savedDatasets.map((item) => lookupDataset(item?.dataset_id, item)).filter(Boolean));
    }

    const restoredMaster = lookupDataset(mlopsState?.master_dataset_id, mlopsState?.master_dataset);
    if (restoredMaster) setMasterDataset(restoredMaster);

    const restoredPreprocess = lookupDataset(mlopsState?.preprocess_dataset_id, mlopsState?.preprocess_dataset);
    if (restoredPreprocess) setPreprocessDataset(restoredPreprocess);

    const restoredTarget = String(mlopsState?.target_column || '').trim();
    if (restoredTarget) setTargetColumn(restoredTarget);

    if (Array.isArray(mlopsState?.preprocess_steps)) {
      setPreprocessSteps(normalizePreprocessSteps(mlopsState.preprocess_steps));
    }
    if (Array.isArray(mlopsState?.preprocess_plan)) {
      setPreprocessPlan(normalizePreprocessSuggestions(mlopsState.preprocess_plan));
    }
    if (Object.prototype.hasOwnProperty.call(mlopsState || {}, 'eda_completed')) {
      setEdaDone(Boolean(mlopsState.eda_completed));
    }
    if (mlopsState?.master_state?.currentStepId) {
      setMasterCurrentStepId(String(mlopsState.master_state.currentStepId).trim().toLowerCase());
    }
    if (Number.isInteger(mlopsState?.target_state?.activeTab)) {
      setTargetActiveTab(mlopsState.target_state.activeTab);
    }
    if (mlopsState?.eda_state?.activeTab) {
      setEdaActiveTab(String(mlopsState.eda_state.activeTab).trim().toLowerCase());
    }
    if (Number.isInteger(mlopsState?.model_state?.activeTab)) {
      setModelActiveTab(mlopsState.model_state.activeTab);
    }

    const restoredActiveRun = mlopsState?.active_model_run || null;
    if (restoredActiveRun?.job_id) {
      setActiveModelRun(restoredActiveRun);
      setModelRun({
        job_id: restoredActiveRun.job_id,
        algorithm: restoredActiveRun.algorithm,
        algorithm_id: restoredActiveRun.algorithm_id,
        auc: restoredActiveRun.auc ?? restoredActiveRun.metrics?.roc_auc,
        metrics: restoredActiveRun.metrics || {},
        results: restoredActiveRun.results,
        grain: restoredActiveRun.grain,
        threshold: restoredActiveRun.threshold,
      });
      setReportRunId(String(restoredActiveRun.job_id || '').trim());
    }

    if (mlopsState?.validation_report && typeof mlopsState.validation_report === 'object') {
      setValidationReport(mlopsState.validation_report);
    }
    if (Number.isInteger(mlopsState?.validation_state?.activeTab)) {
      setValidationActiveTab(mlopsState.validation_state.activeTab);
    }
    if (mlopsState?.registry_entry && typeof mlopsState.registry_entry === 'object') {
      setRegistryEntry(mlopsState.registry_entry);
    }

    if (!restoredActiveRun?.job_id) {
      const fallbackJobId = String(
        mlopsState?.validation_report?.job_id
        || mlopsState?.validation_report?.run_id
        || mlopsState?.registry_entry?.job_id
        || mlopsState?.registry_entry?.run_id
        || '',
      ).trim();
      if (fallbackJobId) {
        const fallbackRun = {
          job_id: fallbackJobId,
          algorithm: mlopsState?.registry_entry?.model_name || '',
          threshold: mlopsState?.validation_report?.optimal_threshold ?? mlopsState?.registry_entry?.threshold ?? null,
          metrics: mlopsState?.validation_report?.metrics || {},
        };
        setActiveModelRun(fallbackRun);
        setModelRun({
          job_id: fallbackRun.job_id,
          algorithm: fallbackRun.algorithm,
          algorithm_id: fallbackRun.algorithm,
          auc: fallbackRun.metrics?.roc_auc ?? null,
          metrics: fallbackRun.metrics || {},
          results: null,
          grain: null,
          threshold: fallbackRun.threshold,
        });
        setReportRunId(fallbackJobId);
      }
    }

    const restoredName = String(
      session?.pipeline_name
      || mlopsState?.pipeline_name
      || '',
    ).trim();
    if (restoredName) {
      setActivePipelineName(restoredName);
      setExperimentName((prev) => {
        const current = String(prev || '').trim();
        return current && current !== DEFAULT_EXPERIMENT_NAME ? prev : restoredName;
      });
    }

    const sessionPipelineId = Number(
      session?.pipeline_id
      || mlopsState?.pipeline_id
      || 0,
    ) || null;
    if (sessionPipelineId) {
      setActivePipelineId((prev) => prev || sessionPipelineId);
    }

    const restoredStep = normalizeWorkbenchStep(
      mlopsState?.current_step
      || mlopsState?.preferred_screen
      || session?.current_step
      || '',
    );
    if (restoredStep && STEPS.some((step) => step.id === restoredStep)) {
      setActiveStep((prev) => {
        const current = normalizeWorkbenchStep(prev);
        if (!current || current === 'data' || current === 'pipelines') {
          return restoredStep;
        }
        return prev;
      });
    }
  }, [compactDatasetSnapshot]);

  const resetWorkbenchRuntimeState = useCallback(() => {
    setDatasets([]);
    setMasterDataset(null);
    setTargetColumn('');
    setEdaDone(false);
    setPreprocessDataset(null);
    setBuilding(false);
    setModelRun(null);
    setActiveModelRun(null);
    setValidationReport(null);
    setRegistryEntry(null);
    setReportRunId('');
    setMasterCurrentStepId('base');
    setTargetActiveTab(0);
    setEdaActiveTab('dashboard');
    setModelActiveTab(0);
    setValidationActiveTab(0);
    setPreprocessPlan([]);
    setPreprocessSteps([]);
    setPreprocessPreview(null);
    setQualityScore(null);
    setActiveStep('data');
  }, []);

  const pauseWorkflowPersistence = useCallback(() => {
    workflowPersistencePausedRef.current = true;
    if (workflowSaveTimerRef.current) {
      clearTimeout(workflowSaveTimerRef.current);
      workflowSaveTimerRef.current = null;
    }
  }, []);

  const resumeWorkflowPersistence = useCallback(() => {
    workflowPersistencePausedRef.current = false;
  }, []);

  const pauseScreenStatePersistence = useCallback(() => {
    screenStatePersistencePausedRef.current = true;
    if (journeySaveTimerRef.current) {
      clearTimeout(journeySaveTimerRef.current);
      journeySaveTimerRef.current = null;
    }
  }, []);

  const resumeScreenStatePersistence = useCallback(() => {
    screenStatePersistencePausedRef.current = false;
  }, []);

  const activeRunId = useMemo(
    () => String(activeModelRun?.job_id || modelRun?.job_id || reportRunId || '').trim(),
    [activeModelRun?.job_id, modelRun?.job_id, reportRunId],
  );
  const activeDeploymentId = useMemo(
    () => String(registryEntry?.deployment_id || '').trim(),
    [registryEntry?.deployment_id],
  );
  const hasWorkbenchRuntimeState = useMemo(
    () => Boolean(
      (datasets || []).length
      || masterDataset
      || preprocessDataset
      || activeModelRun?.job_id
      || modelRun?.job_id
      || validationReport
      || registryEntry,
    ),
    [
      datasets,
      masterDataset,
      preprocessDataset,
      activeModelRun?.job_id,
      modelRun?.job_id,
      validationReport,
      registryEntry,
    ],
  );

  useEffect(() => {
    setPreprocessSteps((prev) => normalizePreprocessSteps(prev));
  }, []);

  // ── Persist key state ───────────────────────────────────────────────────────
  useEffect(() => { lsWrite({ mode }); },            [mode]);
  useEffect(() => { lsWrite({ activeStep }); },      [activeStep]);
  useEffect(() => { lsWrite({ persona }); },         [persona]);
  useEffect(() => { lsWrite({ experimentName }); },  [experimentName]);
  useEffect(() => { lsWrite({ railCollapsed }); },   [railCollapsed]);
  useEffect(() => { lsWrite({ targetColumn }); },    [targetColumn]);
  useEffect(() => { lsWrite({ reportRunId }); },     [reportRunId]);
  useEffect(() => () => {
    if (modeSwitchTimerRef.current) {
      clearTimeout(modeSwitchTimerRef.current);
    }
    if (journeySaveTimerRef.current) {
      clearTimeout(journeySaveTimerRef.current);
    }
    if (workflowSaveTimerRef.current) {
      clearTimeout(workflowSaveTimerRef.current);
    }
  }, []);

  const handleModeChange = useCallback((nextMode) => {
    if (!nextMode || nextMode === mode) return;
    if (modeSwitchTimerRef.current) {
      clearTimeout(modeSwitchTimerRef.current);
      modeSwitchTimerRef.current = null;
    }
    if (nextMode === 'auto') {
      setWorkspaceLoading(true);
      modeSwitchTimerRef.current = setTimeout(() => {
        setWorkspaceLoading(false);
        modeSwitchTimerRef.current = null;
      }, 900);
    } else {
      setWorkspaceLoading(false);
    }
    setMode(nextMode);
  }, [mode]);

  useEffect(() => {
    const latestScopedSession = readPipelineSession(currentEnvId);
    const workflowSessionId = String(workflowSessionRef.current?.session_id || latestScopedSession?.workflow_session_id || '').trim();
    if (!activePipelineId && !activePipelineName && !workflowSessionId) {
      clearPipelineSession(currentEnvId);
      return;
    }
    writePipelineSession(currentEnvId, {
      pipeline_id: activePipelineId,
      name: activePipelineName,
      workflow_session_id: workflowSessionId || null,
    });
  }, [activePipelineId, activePipelineName, currentEnvId]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    setShowContext(false);
    setMobileRailOpen(false);
  }, [isMobile]);

  // ── Data hydration ──────────────────────────────────────────────────────────
  const ARTEFACT_TYPES = useMemo(() => new Set([
    'master_dataset', 'master', 'preprocessed_dataset', 'preprocessed',
    'model_output', 'model_dataset', 'scored_dataset', 'feature_store',
  ]), []);

  const hydrateDatasets = useCallback((payload) => {
    const all       = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.datasets) ? payload.datasets : [];
    const rawOnly   = Array.isArray(payload?.raw)       ? payload.raw       : all.filter((d) => !ARTEFACT_TYPES.has(d?.dataset_type));
    const artefacts = Array.isArray(payload?.artefacts) ? payload.artefacts : all.filter((d) =>  ARTEFACT_TYPES.has(d?.dataset_type));
    setDatasets(rawOnly);
    const master = artefacts.find((d) => d.dataset_type === 'master_dataset')
      || artefacts.find((d) => d.dataset_type?.startsWith('master'))
      || rawOnly.find((d) => d.dataset_type === 'master_dataset') || null;
    setMasterDataset(master);
    const prep = artefacts.find((d) => d.dataset_type === 'preprocessed_dataset')
      || artefacts.find((d) => d.dataset_type?.startsWith('preprocessed')) || null;
    setPreprocessDataset(prep);
    return { all, rawOnly, artefacts };
  }, [ARTEFACT_TYPES]);

  const loadDatasets = useCallback(async ({ sync = false } = {}) => {
    try {
      const payload = await mlopsApi.listDatasets(sync ? { sync: '1' } : {});
      const parsed  = hydrateDatasets(payload || {});
      localStorage.setItem(datasetCacheKey, JSON.stringify(payload || {}));
      return parsed;
    } catch (e) {
      console.error('Failed to load datasets', e);
      return { all: [], rawOnly: [], artefacts: [] };
    }
  }, [datasetCacheKey, hydrateDatasets]);

  const loadSavedPipelines = useCallback(async () => {
    setSavedPipelinesLoaded(false);
    try {
      const res  = await mlopsApi.pipelineList();
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setSavedPipelines(rows);
      const scopedWorkflowSessionId = String(readPipelineSession(currentEnvId)?.workflow_session_id || '').trim();
      if (!activePipelineId && !activePipelineName && !scopedWorkflowSessionId) {
        setActivePipelineMeta(null);
        return rows;
      }
      if (activePipelineId) {
        const active = rows.find((row) => Number(row?.pipeline_id) === Number(activePipelineId)) || null;
        if (active) {
          setActivePipelineMeta(active);
          if (String(active.name || '').trim() && String(activePipelineName || '').trim() !== String(active.name || '').trim()) {
            setActivePipelineName(String(active.name || '').trim());
          }
          setPipelineSelectionNotice('');
          return rows;
        }
      }
      const draftWorkflowRun = rows.find((row) => {
        const rowSessionId = String(row?.workflow_session_id || '').trim();
        if (scopedWorkflowSessionId && rowSessionId === scopedWorkflowSessionId) return true;
        if (!row?.pipeline_id && activePipelineName) {
          return String(row?.name || '').trim().toLowerCase() === String(activePipelineName || '').trim().toLowerCase();
        }
        return false;
      }) || null;
      if (draftWorkflowRun) {
        setActivePipelineMeta(draftWorkflowRun);
        setPipelineSelectionNotice('');
        return rows;
      }
      if (!activePipelineId && (activePipelineName || scopedWorkflowSessionId)) {
        const staleLabel = String(activePipelineName || 'previous run').trim();
        pauseWorkflowPersistence();
        localStorage.removeItem(datasetCacheKey);
        resetWorkbenchRuntimeState();
        setActivePipelineId(null);
        setActivePipelineName('');
        setActivePipelineMeta(null);
        workflowSessionRef.current = null;
        autoResumeKeyRef.current = '';
        clearPipelineSession(currentEnvId);
        setPipelineSelectionNotice(
          `Cleared stale local run "${staleLabel}" because it is not saved in environment "${currentEnvId}".`,
        );
        setExperimentName((prev) => {
          const trimmedPrev = String(prev || '').trim();
          return trimmedPrev === staleLabel ? DEFAULT_EXPERIMENT_NAME : prev;
        });
        return rows;
      }
      const staleLabel = String(activePipelineName || toRunRef(activePipelineId) || 'previous run').trim();
      pauseWorkflowPersistence();
      localStorage.removeItem(datasetCacheKey);
      resetWorkbenchRuntimeState();
      setActivePipelineId(null);
      setActivePipelineName('');
      setActivePipelineMeta(null);
      workflowSessionRef.current = null;
      autoResumeKeyRef.current = '';
      clearPipelineSession(currentEnvId);
      setPipelineSelectionNotice(
        `Cleared stale local run "${staleLabel}" because it is not saved in environment "${currentEnvId}".`,
      );
      setExperimentName((prev) => {
        const trimmedPrev = String(prev || '').trim();
        return trimmedPrev === staleLabel ? DEFAULT_EXPERIMENT_NAME : prev;
      });
      return rows;
    } catch {
      setSavedPipelines([]);
      return [];
    } finally {
      setSavedPipelinesLoaded(true);
    }
  }, [activePipelineId, activePipelineName, currentEnvId, datasetCacheKey, pauseWorkflowPersistence, resetWorkbenchRuntimeState]);

  useEffect(() => {
    if (!activePipelineMeta?.pipeline_id) return;
    setSavedPipelines((prev) => {
      const rows = Array.isArray(prev) ? [...prev] : [];
      const idx = rows.findIndex((row) => Number(row?.pipeline_id) === Number(activePipelineMeta.pipeline_id));
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...activePipelineMeta };
        return rows;
      }
      return [activePipelineMeta, ...rows];
    });
  }, [activePipelineMeta]);

  const activeSavedPipeline = useMemo(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return null;
    if (Number(activePipelineMeta?.pipeline_id || 0) === pipelineId) {
      return activePipelineMeta;
    }
    return (savedPipelines || []).find((row) => Number(row?.pipeline_id) === pipelineId) || null;
  }, [activePipelineId, activePipelineMeta, savedPipelines]);

  const validActivePipelineId = useMemo(() => {
    const pipelineId = Number(activeSavedPipeline?.pipeline_id || 0);
    return Number.isFinite(pipelineId) && pipelineId > 0 ? pipelineId : null;
  }, [activeSavedPipeline]);
  const hasPipelineContext = useMemo(() => {
    return Boolean(
      validActivePipelineId
      || String(workflowSessionRef.current?.session_id || '').trim(),
    );
  }, [validActivePipelineId]);
  const scopedWorkflowSessionId = useMemo(
    () => String(readPipelineSession(currentEnvId)?.workflow_session_id || '').trim(),
    [currentEnvId, activePipelineId, activePipelineName],
  );
  const savedPipelinePresenceSignature = useMemo(
    () => JSON.stringify(
      (savedPipelines || []).map((row) => ({
        pipeline_id: Number(row?.pipeline_id || 0) || 0,
        workflow_session_id: String(row?.workflow_session_id || '').trim(),
        name: String(row?.name || '').trim(),
      })),
    ),
    [savedPipelines],
  );

  useEffect(() => {
    if (hasPipelineContext) return;
    setDatasets([]);
    setMasterDataset(null);
    setTargetColumn('');
    setEdaDone(false);
    setPreprocessDataset(null);
    setBuilding(false);
    setModelRun(null);
    setActiveModelRun(null);
    setValidationReport(null);
    setRegistryEntry(null);
    setReportRunId('');
    setPreprocessPlan([]);
    setPreprocessSteps([]);
    setPreprocessPreview(null);
    setQualityScore(null);
  }, [hasPipelineContext]);

  const activatePipeline = useCallback((pipeline, options = {}) => {
    if (!pipeline) return;
    resumeWorkflowPersistence();
    const pid   = Number(pipeline.pipeline_id || pipeline.pipelineId || pipeline.id || 0) || null;
    const pname = String(pipeline.name || '').trim();
    const hasExplicitWorkflowSessionId = (
      Object.prototype.hasOwnProperty.call(pipeline, 'workflow_session_id')
      || Object.prototype.hasOwnProperty.call(pipeline, 'session_id')
    );
    const workflowSessionId = String(
      hasExplicitWorkflowSessionId
        ? (pipeline.workflow_session_id || pipeline.session_id || '')
        : (workflowSessionRef.current?.session_id || '')
    ).trim();
    setActivePipelineId(pid);
    setActivePipelineName(pname);
    setActivePipelineMeta(pipeline || null);
    setPipelineSelectionNotice('');
    if (hasExplicitWorkflowSessionId && !workflowSessionId) {
      workflowSessionRef.current = null;
    }
    writePipelineSession(currentEnvId, {
      pipeline_id: pid,
      name: pname,
      workflow_session_id: workflowSessionId || null,
    });
    if (pname) setExperimentName(pname);
    if (!options?.suppressRouteNavigation) {
      const targetPath = buildWorkbenchRoute(pid, options?.step || activeStep || 'pipelines');
      const currentPath = buildWorkbenchRoute(normalizedRouteRunId, normalizedRouteStep || activeStep || 'pipelines');
      if (targetPath === currentPath) {
        return;
      }
      navigate(targetPath, {
        replace: Boolean(options?.replace),
      });
    }
  }, [
    activeStep,
    currentEnvId,
    navigate,
    normalizedRouteRunId,
    normalizedRouteStep,
    resumeWorkflowPersistence,
  ]);

  const clearActivePipeline = useCallback((options = {}) => {
    pauseWorkflowPersistence();
    setActivePipelineId(null);
    setActivePipelineName('');
    setActivePipelineMeta(null);
    setPipelineSelectionNotice('');
    workflowSessionRef.current = null;
    workflowSessionFetchKeyRef.current = '';
    restoredWorkflowSessionKeyRef.current = '';
    autoResumeKeyRef.current = '';
    clearPipelineSession(currentEnvId);
    routeResumeRef.current = '';
    if (!options?.suppressRouteNavigation) {
      navigate('/mlops/runs', { replace: Boolean(options?.replace) });
    }
  }, [currentEnvId, navigate, pauseWorkflowPersistence]);

  const clearLocalWorkbenchState = useCallback(() => {
    localStorage.removeItem(datasetCacheKey);
    resetWorkbenchRuntimeState();
  }, [datasetCacheKey, resetWorkbenchRuntimeState]);

  const handlePipelineDeleted = useCallback(({ deletedName = '', remainingRuns = [] } = {}) => {
    const activeWorkflowSessionId = String(workflowSessionRef.current?.session_id || '').trim();
    pauseWorkflowPersistence();
    if (activeWorkflowSessionId) {
      mlopsApi.deleteWorkflowSession(activeWorkflowSessionId).catch(() => {});
    }
    clearLocalWorkbenchState();
    clearActivePipeline();
    setExperimentName(DEFAULT_EXPERIMENT_NAME);
    setActiveStep('pipelines');
    setPipelineLauncherOpen(false);
    const deletedLabel = String(deletedName || 'run').trim();
    setPipelineSelectionNotice(
      Array.isArray(remainingRuns) && remainingRuns.length > 0
        ? `Deleted "${deletedLabel}". Select another run or create a new run to continue.`
        : `Deleted "${deletedLabel}". Create a new run, then load data to continue.`,
    );
  }, [clearActivePipeline, clearLocalWorkbenchState, pauseWorkflowPersistence]);

  useEffect(() => {
    if (hasPipelineContext) return;
    setActiveStep((prev) => (prev === 'pipelines' ? prev : 'pipelines'));
  }, [hasPipelineContext]);

  useEffect(() => {
    if (previousEnvIdRef.current === currentEnvId) return;
    previousEnvIdRef.current = currentEnvId;
    const scopedSession = readPipelineSession(currentEnvId);
    const scopedName = String(scopedSession.name || '').trim();
    resetWorkbenchRuntimeState();
    setSavedPipelines([]);
    setSavedPipelinesLoaded(false);
    setActivePipelineMeta(null);
    setActivePipelineId(scopedSession.pipeline_id || null);
    setActivePipelineName(scopedName);
    setPipelineSelectionNotice('');
    setExperimentName(scopedName || DEFAULT_EXPERIMENT_NAME);
    workflowSessionRef.current = null;
    workflowSessionFetchKeyRef.current = '';
    restoredWorkflowSessionKeyRef.current = '';
    autoResumeKeyRef.current = '';
  }, [currentEnvId, resetWorkbenchRuntimeState]);

  useEffect(() => {
    if (!savedPipelinesLoaded) return undefined;
    let active = true;
    (async () => {
      try {
        if (!validActivePipelineId && !scopedWorkflowSessionId) {
          workflowSessionRef.current = null;
          workflowSessionFetchKeyRef.current = '';
          return;
        }
        const fetchKey = `${currentEnvId}::${String(validActivePipelineId || '').trim()}::${scopedWorkflowSessionId}`;
        if (workflowSessionFetchKeyRef.current === fetchKey) {
          return;
        }
        workflowSessionFetchKeyRef.current = fetchKey;
        const params = validActivePipelineId
          ? { pipeline_id: validActivePipelineId }
          : scopedWorkflowSessionId
            ? { session_id: scopedWorkflowSessionId }
            : {};
        const res = await mlopsApi.getWorkflowSession(params);
        if (!active) return;
        const session = res?.session || null;
        workflowSessionRef.current = session || null;
        if (!session) return;
        const restoreKey = `${currentEnvId}::${String(session?.session_id || scopedWorkflowSessionId || validActivePipelineId || 'draft').trim()}`;

        const savedMlopsState = session?.current_state?.mlops_state || session?.last_stable_state?.mlops_state || {};
        const sessionPipelineId = Number(
          session?.pipeline_id
          || savedMlopsState?.pipeline_id
          || session?.current_state?.pipeline_id
          || session?.handoff_summary?.pipeline_id
          || 0,
        ) || null;
        const sessionPipelineName = String(
          session?.pipeline_name
          || savedMlopsState?.pipeline_name
          || session?.current_state?.pipeline_name
          || session?.handoff_summary?.pipeline_name
          || '',
        ).trim();
        const sessionStep = normalizeWorkbenchStep(
          savedMlopsState?.current_step
          || savedMlopsState?.preferred_screen
          || (session?.current_module === 'mlops' ? session?.current_step : ''),
        );
        const sessionPipelineExists = sessionPipelineId
          ? (savedPipelines || []).some((row) => Number(row?.pipeline_id) === Number(sessionPipelineId))
          : false;

        if (!activePipelineId && sessionPipelineId && sessionPipelineExists) {
          setActivePipelineId(sessionPipelineId);
          if (sessionPipelineName) {
            setActivePipelineName(sessionPipelineName);
            setExperimentName((prev) => {
              const current = String(prev || '').trim();
              return current && current !== DEFAULT_EXPERIMENT_NAME ? prev : sessionPipelineName;
            });
          }
          writePipelineSession(currentEnvId, {
            pipeline_id: sessionPipelineId,
            name: sessionPipelineName,
            workflow_session_id: session?.session_id || null,
          });
        } else if (!activePipelineId && sessionPipelineId && !sessionPipelineExists) {
          const staleLabel = String(sessionPipelineName || toRunRef(sessionPipelineId) || 'previous run').trim();
          setPipelineSelectionNotice((prev) => (
            prev || `Skipped stale workflow run "${staleLabel}" because it is not saved in environment "${currentEnvId}".`
          ));
        } else if (!activePipelineId && !sessionPipelineId && sessionPipelineName) {
          setActivePipelineName(sessionPipelineName);
          setExperimentName((prev) => {
            const current = String(prev || '').trim();
            return current && current !== DEFAULT_EXPERIMENT_NAME ? prev : sessionPipelineName;
          });
          writePipelineSession(currentEnvId, {
            pipeline_id: null,
            name: sessionPipelineName,
            workflow_session_id: session?.session_id || null,
          });
        } else if (validActivePipelineId && sessionPipelineName && !String(activePipelineName || '').trim()) {
          setActivePipelineName(sessionPipelineName);
        }

        if (restoredWorkflowSessionKeyRef.current !== restoreKey) {
          restoreWorkflowRuntimeState(session);
          restoredWorkflowSessionKeyRef.current = restoreKey;
        }

        if (sessionStep && STEPS.some((step) => step.id === sessionStep)) {
          setActiveStep((prev) => {
            const current = normalizeWorkbenchStep(prev);
            if (!current || current === 'data' || current === 'pipelines') {
              return sessionStep;
            }
            return prev;
          });
        }
      } catch {
        workflowSessionRef.current = null;
        workflowSessionFetchKeyRef.current = '';
      }
    })();
    return () => {
      active = false;
    };
  }, [
    currentEnvId,
    activePipelineId,
    activePipelineName,
    restoreWorkflowRuntimeState,
    savedPipelinePresenceSignature,
    savedPipelinesLoaded,
    scopedWorkflowSessionId,
    validActivePipelineId,
  ]);

  // ── STARTUP ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cached = localStorage.getItem(datasetCacheKey);
    if (cached) { try { hydrateDatasets(JSON.parse(cached)); } catch { /* stale */ } }
    let alive = true;
    (async () => {
      const first = await loadDatasets({ sync: false });
      if (!alive) return;
      if (workflowSessionRef.current && !restoredWorkflowSessionKeyRef.current) {
        restoreWorkflowRuntimeState(workflowSessionRef.current, first?.all || []);
        restoredWorkflowSessionKeyRef.current = `${currentEnvId}::${String(workflowSessionRef.current?.session_id || 'draft').trim()}`;
      }
      if (!(first?.all?.length > 0)) {
        const second = await loadDatasets({ sync: true });
        if (!alive) return;
        if (workflowSessionRef.current && !restoredWorkflowSessionKeyRef.current) {
          restoreWorkflowRuntimeState(workflowSessionRef.current, second?.all || []);
          restoredWorkflowSessionKeyRef.current = `${currentEnvId}::${String(workflowSessionRef.current?.session_id || 'draft').trim()}`;
        }
      }
    })();
    return () => { alive = false; };
  }, [currentEnvId, datasetCacheKey, hydrateDatasets, loadDatasets, restoreWorkflowRuntimeState]);

  useEffect(() => { loadSavedPipelines(); }, [loadSavedPipelines]);

  useEffect(() => {
    if (!masterDataset) return;
    mlopsApi.preprocessPlan({ dataset_id: masterDataset.dataset_id })
      .then((res) => {
        const payload = unwrapApiPayload(res) || {};
        setPreprocessPlan(normalizePreprocessSuggestions(payload.suggestions || []));
      })
      .catch(() => {});
  }, [masterDataset]);

  useEffect(() => {
    const cols = Array.isArray(masterDataset?.columns) ? masterDataset.columns : [];
    if (!cols.length) return;
    const finalLabelCol = cols.find((c) => String(c).trim().toLowerCase() === 'final_label');
    if (!finalLabelCol) return;

    const current = String(targetColumn || '').trim().toLowerCase();
    const hasCurrent = current && cols.some((c) => String(c).trim().toLowerCase() === current);
    const legacy = new Set(['is_true_pos', 'is_true_positive', 'target', 'label', 'is_tp', 'str_flag']);

    if (!current || !hasCurrent || legacy.has(current)) {
      setTargetColumn(finalLabelCol);
    }
  }, [masterDataset, targetColumn]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const savedDashboardState = useMemo(
    () => getScreenState(activePipelineMeta?.steps, 'dashboard') || null,
    [activePipelineMeta],
  );
  const rawStaleSteps = useMemo(
    () => Array.isArray(activePipelineMeta?.stale_steps) ? activePipelineMeta.stale_steps : [],
    [activePipelineMeta],
  );
  const effectiveStaleSteps = useMemo(() => {
    const next = new Set((rawStaleSteps || []).map((step) => String(step).trim()).filter(Boolean));
    const currentModelJobId = String(activeModelRun?.job_id || modelRun?.job_id || '').trim();
    const validationJobId = String(validationReport?.job_id || validationReport?.run_id || '').trim();
    const registryJobId = nestedRunId(registryEntry);
    const dashboardJobId = nestedRunId(savedDashboardState);
    const registryDeploymentId = nestedDeploymentId(registryEntry);
    const dashboardDeploymentId = nestedDeploymentId(savedDashboardState);
    const validationMatchesModel = Boolean(currentModelJobId && validationJobId && validationJobId === currentModelJobId);
    const registryMatchesModel = Boolean(currentModelJobId && registryJobId && registryJobId === currentModelJobId);
    const dashboardMatchesModel = Boolean(currentModelJobId && dashboardJobId && dashboardJobId === currentModelJobId);
    const deploymentMatches = Boolean(registryDeploymentId && dashboardDeploymentId && registryDeploymentId === dashboardDeploymentId);

    if (validationMatchesModel) next.delete('validation');
    if (currentModelJobId && (validationMatchesModel || Boolean(validationReport) || registryMatchesModel)) next.delete('registry');
    if (registryMatchesModel && (dashboardMatchesModel || deploymentMatches || Boolean(savedDashboardState))) next.delete('dashboard');
    if (currentModelJobId && (validationMatchesModel || registryMatchesModel || String(reportRunId || '').trim() === currentModelJobId)) next.delete('reports');
    return Array.from(next);
  }, [
    rawStaleSteps,
    activeModelRun?.job_id,
    modelRun?.job_id,
    validationReport,
    registryEntry,
    savedDashboardState,
    reportRunId,
  ]);
  const staleStepSet = useMemo(
    () => new Set((effectiveStaleSteps || []).map((step) => String(step))),
    [effectiveStaleSteps],
  );
  const latestDependencyChange = activePipelineMeta?.latest_change || null;
  const staleMessageForStep = useCallback((stepId) => {
    const manifestMessage = getManifestStepState(activeSavedPipeline || activePipelineMeta || {}, stepId)?.invalidated_reason;
    if (manifestMessage) return manifestMessage;
    const direct = activePipelineMeta?.stale_details?.[stepId]?.message;
    if (direct) return direct;
    if (latestDependencyChange?.message) return latestDependencyChange.message;
    return 'This stage is outdated because an upstream step changed. Rerun the dependent stages before continuing.';
  }, [activePipelineMeta, activeSavedPipeline, latestDependencyChange]);
  const savedStepCompletion = useMemo(
    () => derivePipelineStepCompletion(activeSavedPipeline || activePipelineMeta || {}),
    [activePipelineMeta, activeSavedPipeline],
  );
  const savedStepStatuses = useMemo(
    () => derivePipelineStepStatuses(activeSavedPipeline || activePipelineMeta || {}),
    [activePipelineMeta, activeSavedPipeline],
  );

  const stepCtx = useMemo(() => ({
    datasets, masterDataset, targetColumn, edaDone,
    preprocessDataset, modelRun, validationReport, registryEntry, staleSteps: effectiveStaleSteps,
    hasPipelineContext, savedStepCompletion, savedStepStatuses,
  }), [
    datasets,
    masterDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    modelRun,
    validationReport,
    registryEntry,
    effectiveStaleSteps,
    hasPipelineContext,
    savedStepCompletion,
    savedStepStatuses,
  ]);

  const flowSteps      = useMemo(() => STEPS.filter((s) => s.id !== 'pipelines'), []);
  const currentIdx     = STEPS.findIndex((s) => s.id === activeStep);
  const currentStepMeta = currentIdx >= 0 ? STEPS[currentIdx] : null;
  const nextStep       = useMemo(() => {
    if (activeStep === 'pipelines') return null;
    const idx = flowSteps.findIndex((s) => s.id === activeStep);
    return idx >= 0 ? flowSteps[idx + 1] || null : null;
  }, [activeStep, flowSteps]);
  const nextLocked     = nextStep ? stepStatus(nextStep.id, stepCtx) === 'locked' : true;
  const progressSteps  = flowSteps;
  const progressStepIndexMap = useMemo(
    () => Object.fromEntries(progressSteps.map((step, idx) => [step.id, idx])),
    [progressSteps],
  );
  const firstStaleStep = useMemo(
    () => progressSteps.find((step) => staleStepSet.has(step.id)) || null,
    [progressSteps, staleStepSet],
  );
  const firstStaleStepIndex = firstStaleStep ? progressStepIndexMap[firstStaleStep.id] : -1;
  const resolveStepNavigation = useCallback((requestedStepId) => {
    const requested = String(requestedStepId || '').trim();
    if (!requested || requested === 'pipelines' || !firstStaleStep) return requested;
    const requestedIndex = progressStepIndexMap[requested];
    if (requestedIndex == null || requestedIndex < firstStaleStepIndex) return requested;
    return firstStaleStep.id;
  }, [firstStaleStep, firstStaleStepIndex, progressStepIndexMap]);
  const openWorkbenchStep = useCallback((requestedStepId, options = {}) => {
    const requested = normalizeWorkbenchStep(requestedStepId || '');
    const resolvedStep = options?.skipGuardRedirect
      ? requested || 'pipelines'
      : resolveStepNavigation(requested || 'pipelines') || requested || 'pipelines';
    const targetRunId = normalizeWorkbenchRunId(options?.pipelineId || validActivePipelineId || activePipelineId);
    setActiveStep(resolvedStep);
    if (!targetRunId) {
      navigate('/mlops/runs', { replace: Boolean(options?.replace), state: options?.state });
      return;
    }
    navigate(buildWorkbenchRoute(targetRunId, resolvedStep), {
      replace: Boolean(options?.replace),
      state: options?.state,
    });
  }, [activePipelineId, navigate, resolveStepNavigation, validActivePipelineId]);
  const deriveResumeStep = useCallback((pipeline) => {
    const explicit = normalizeWorkbenchStep(
      pipeline?.workflow_manifest?.current_step
      || pipeline?.current_step
      || pipeline?.current_workspace_step
      || pipeline?.workspace_step
      || pipeline?.preferred_screen
      || pipeline?.workflow_session?.current_step
      || '',
    );
    if (explicit && isWorkbenchStep(explicit)) return explicit;
    const statuses = derivePipelineStepStatuses(pipeline || {});
    const firstAttentionStep = flowSteps.find((step) => (
      ['in_progress', 'invalidated', 'failed'].includes(String(statuses?.[step.id] || '').toLowerCase())
    ));
    if (firstAttentionStep) return firstAttentionStep.id;
    const completion = derivePipelineStepCompletion(pipeline || {});
    if (completion.registry) return 'dashboard';
    if (completion.validation) return 'registry';
    if (completion.model) return 'validation';
    if (completion.preprocess) return 'model';
    if (completion.eda) return 'preprocess';
    if (completion.target) return 'eda';
    if (completion.master) return 'target';
    return 'data';
  }, [flowSteps]);
  const openPipelineRoute = useCallback((pipelineRef, options = {}) => {
    const pipelineId = normalizeWorkbenchRunId(pipelineRef?.pipeline_id || pipelineRef || options?.pipelineId);
    if (!pipelineId) {
      navigate('/mlops/runs', { replace: Boolean(options?.replace), state: options?.state });
      return;
    }
    const targetStep = normalizeWorkbenchStep(options?.step || deriveResumeStep(pipelineRef)) || 'pipelines';
    navigate(buildWorkbenchRoute(pipelineId, targetStep), {
      replace: Boolean(options?.replace),
      state: options?.state,
    });
  }, [deriveResumeStep, navigate]);
  const doneCount      = useMemo(() => progressSteps.filter((s) => stepStatus(s.id, stepCtx) === 'done').length, [progressSteps, stepCtx]);
  const progressPct    = Math.round((doneCount / Math.max(progressSteps.length, 1)) * 100);
  const currentFlowIdx = useMemo(() => progressSteps.findIndex((s) => s.id === activeStep), [progressSteps, activeStep]);
  const previousStep = useMemo(
    () => (currentFlowIdx > 0 ? progressSteps[currentFlowIdx - 1] || null : null),
    [currentFlowIdx, progressSteps],
  );
  const isDashboard    = activeStep === 'dashboard';
  const contextMinViewport = activeStep === 'preprocess' || activeStep === 'validation' ? 2000 : 1680;
  const forceRailCollapse = isTablet || viewportWidth < 1320;
  const effectiveRailCollapsed = railCollapsed || forceRailCollapse;
  const showContextPanel = !isMobile && showContext && !isDashboard && viewportWidth >= contextMinViewport;
  const contextPanelWidth = viewportWidth >= 1880 ? D.contextW : 260;
  const releaseWorkflowStep = activeStep === 'registry';
  const stepHeaderLabel = releaseWorkflowStep
    ? 'Model Release, Registry & Deployment'
    : (persona === 'business' ? currentStepMeta?.biz : currentStepMeta?.label);
  const stepHeaderDescription = releaseWorkflowStep
    ? 'Review, register, approve, and deploy AML false positive suppression models.'
    : (currentStepMeta?.desc || 'Continue the current workbench stage.');

  const unfinishedPipelines = useMemo(
    () => (savedPipelines || []).filter((p) => String(p?.run_status || p?.status || 'saved').toLowerCase() !== 'complete'),
    [savedPipelines],
  );

  const defaultResumePipeline = useMemo(() => {
    const scopedWorkflowSessionId = String(readPipelineSession(currentEnvId)?.workflow_session_id || '').trim();
    if (validActivePipelineId) {
      const hit = (savedPipelines || []).find((p) => Number(p.pipeline_id) === Number(validActivePipelineId));
      if (hit) return hit;
    }
    if (scopedWorkflowSessionId) {
      const hit = (savedPipelines || []).find((p) => String(p?.workflow_session_id || '').trim() === scopedWorkflowSessionId);
      if (hit) return hit;
    }
    if (activePipelineName) {
      const hit = (savedPipelines || []).find((p) => String(p?.name || '').trim().toLowerCase() === String(activePipelineName || '').trim().toLowerCase());
      if (hit) return hit;
    }
    return unfinishedPipelines[0] || null;
  }, [activePipelineName, currentEnvId, savedPipelines, unfinishedPipelines, validActivePipelineId]);

  const activeSubstepState = useMemo(() => {
    if (activeStep === 'master') {
      const key = String(masterCurrentStepId || '').trim().toLowerCase();
      return { key, label: MASTER_SUBSTEP_LABELS[key] || '' };
    }
    if (activeStep === 'target') {
      return {
        key: Number.isInteger(targetActiveTab) ? String(targetActiveTab) : '',
        label: TARGET_SUBSTEP_LABELS[targetActiveTab] || '',
      };
    }
    if (activeStep === 'eda') {
      const key = String(edaActiveTab || '').trim().toLowerCase();
      return { key, label: EDA_SUBSTEP_LABELS[key] || '' };
    }
    if (activeStep === 'model') {
      return {
        key: Number.isInteger(modelActiveTab) ? String(modelActiveTab) : '',
        label: MODEL_SUBSTEP_LABELS[modelActiveTab] || '',
      };
    }
    if (activeStep === 'validation') {
      return {
        key: String(validationActiveTab),
        label: VALIDATION_SUBSTEP_LABELS[validationActiveTab] || '',
      };
    }
    return { key: '', label: '' };
  }, [activeStep, edaActiveTab, masterCurrentStepId, modelActiveTab, targetActiveTab, validationActiveTab]);

  const workbenchJourneyState = useMemo(() => ({
    current_step: activeStep,
    current_step_label: STEPS.find((step) => step.id === activeStep)?.label || activeStep,
    current_substep: activeSubstepState.key,
    current_substep_label: activeSubstepState.label,
    completion_pct: progressPct,
    completed_steps: doneCount,
    total_steps: progressSteps.length,
    run_status: progressPct >= 100 ? 'complete' : doneCount > 0 ? 'in_progress' : 'draft',
    persona,
    mode,
  }), [activeStep, activeSubstepState, doneCount, mode, persona, progressPct, progressSteps.length]);

  const workflowCheckpointKey = useMemo(() => deriveWorkflowCheckpoint({
    activeStep,
    datasets,
    masterDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    activeModelRun,
    modelRun,
    validationReport,
    registryEntry,
  }), [
    activeStep,
    datasets,
    masterDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    activeModelRun,
    modelRun,
    validationReport,
    registryEntry,
  ]);
  const workflowStateSnapshot = useMemo(() => ({
    current_step: activeStep,
    current_step_label: STEPS.find((step) => step.id === activeStep)?.label || activeStep,
    preferred_screen: activeStep,
    current_substep: activeSubstepState.key || null,
    current_substep_label: activeSubstepState.label || null,
    pipeline_id: Number(validActivePipelineId || 0) || null,
    pipeline_name: String(activePipelineName || experimentName || '').trim() || null,
    run_id: activeRunId || null,
    deployment_id: activeDeploymentId || null,
    mode,
    persona,
    completion_pct: progressPct,
    completed_steps: doneCount,
    total_steps: progressSteps.length,
    datasets_count: Array.isArray(datasets) ? datasets.length : 0,
    datasets: Array.isArray(datasets) ? datasets.map((dataset) => compactDatasetSnapshot(dataset)).filter(Boolean) : [],
    master_dataset_id: Number(masterDataset?.dataset_id || 0) || null,
    master_dataset: compactDatasetSnapshot(masterDataset),
    preprocess_dataset_id: Number(preprocessDataset?.dataset_id || 0) || null,
    preprocess_dataset: compactDatasetSnapshot(preprocessDataset),
    target_column: String(targetColumn || '').trim() || null,
    master_state: {
      currentStepId: masterCurrentStepId,
      currentStepLabel: MASTER_SUBSTEP_LABELS[masterCurrentStepId] || '',
    },
    target_state: {
      activeTab: targetActiveTab,
      activeTabLabel: TARGET_SUBSTEP_LABELS[targetActiveTab] || '',
    },
    eda_state: {
      activeTab: edaActiveTab,
      activeTabLabel: EDA_SUBSTEP_LABELS[edaActiveTab] || '',
    },
    eda_completed: Boolean(edaDone),
    preprocess_steps: normalizePreprocessSteps(preprocessSteps || []),
    preprocess_plan: normalizePreprocessSuggestions(preprocessPlan || []),
    model_job_id: activeRunId || null,
    active_model_run: compactModelRunSnapshot(activeModelRun),
    model_state: {
      activeTab: modelActiveTab,
      activeTabLabel: MODEL_SUBSTEP_LABELS[modelActiveTab] || '',
    },
    validation_report: compactValidationSnapshot(validationReport),
    validation_report_id: validationReport?.report_id || validationReport?.validation_id || null,
    validation_state: {
      activeTab: validationActiveTab,
      activeTabLabel: VALIDATION_SUBSTEP_LABELS[validationActiveTab] || '',
    },
    registry_entry: compactRegistryEntry(registryEntry),
    registry_stage: registryEntry?.stage || null,
    report_run_id: String(reportRunId || '').trim() || null,
    checkpoint_key: workflowCheckpointKey,
  }), [
    activeStep,
    validActivePipelineId,
    activePipelineName,
    experimentName,
    activeRunId,
    activeDeploymentId,
    mode,
    persona,
    progressPct,
    doneCount,
    progressSteps.length,
    datasets,
    compactDatasetSnapshot,
    masterDataset?.dataset_id,
    masterDataset,
    preprocessDataset?.dataset_id,
    preprocessDataset,
    targetColumn,
    masterCurrentStepId,
    targetActiveTab,
    edaActiveTab,
    edaDone,
    preprocessSteps,
    preprocessPlan,
    activeModelRun,
    compactModelRunSnapshot,
    modelActiveTab,
    compactValidationSnapshot,
    compactRegistryEntry,
    validationReport?.report_id,
    validationReport?.validation_id,
    validationReport,
    validationActiveTab,
    registryEntry,
    registryEntry?.stage,
    reportRunId,
    activeSubstepState,
    workflowCheckpointKey,
  ]);
  const shouldPersistWorkflowSession = useMemo(() => Boolean(
    Number(validActivePipelineId || 0) > 0
    || String(workflowSessionRef.current?.session_id || '').trim()
    || hasWorkbenchRuntimeState
    || String(targetColumn || '').trim()
    || Boolean(edaDone)
    || (Array.isArray(preprocessSteps) && preprocessSteps.length > 0)
    || String(reportRunId || '').trim()
    || String(activeRunId || '').trim()
    || String(activeDeploymentId || '').trim()
    || !['data', 'pipelines'].includes(normalizeWorkbenchStep(activeStep))
  ), [
    validActivePipelineId,
    hasWorkbenchRuntimeState,
    targetColumn,
    edaDone,
    preprocessSteps,
    reportRunId,
    activeRunId,
    activeDeploymentId,
    activeStep,
  ]);
  const shouldMarkWorkflowStable = useMemo(
    () => workflowCheckpointKey !== 'FCC_SESSION_STARTED',
    [workflowCheckpointKey],
  );

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return undefined;
    if (screenStatePersistencePausedRef.current) return undefined;
    if (journeySaveTimerRef.current) clearTimeout(journeySaveTimerRef.current);
    journeySaveTimerRef.current = setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, {
        screen: 'workbench_journey',
        state: workbenchJourneyState,
      })
        .then((res) => {
          const payload = res?.data || res;
          if (payload?.pipeline_id) setActivePipelineMeta(payload);
        })
        .catch(() => {});
    }, 700);
    return () => {
      if (journeySaveTimerRef.current) clearTimeout(journeySaveTimerRef.current);
    };
  }, [validActivePipelineId, workbenchJourneyState]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !activeModelRun?.job_id) return;
    if (screenStatePersistencePausedRef.current) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'model',
      state: {
        job_id: activeModelRun.job_id,
        algorithm: activeModelRun.algorithm || activeModelRun.algorithm_id || '',
        dataset_id: Number(preprocessDataset?.dataset_id || masterDataset?.dataset_id || 0) || null,
        threshold: activeModelRun.threshold ?? null,
        activeTab: modelActiveTab,
        activeTabLabel: MODEL_SUBSTEP_LABELS[modelActiveTab] || '',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [validActivePipelineId, activeModelRun, preprocessDataset?.dataset_id, masterDataset?.dataset_id, modelActiveTab]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return;
    if (!validationReport && activeStep !== 'validation') return;
    if (screenStatePersistencePausedRef.current) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'validation',
      state: {
        job_id: activeModelRun?.job_id || modelRun?.job_id || '',
        optimal_threshold: validationReport?.optimal_threshold ?? null,
        report_id: validationReport?.report_id || validationReport?.validation_id || '',
        activeTab: validationActiveTab,
        activeTabLabel: VALIDATION_SUBSTEP_LABELS[validationActiveTab] || '',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [validActivePipelineId, validationReport, activeModelRun?.job_id, modelRun?.job_id, activeStep, validationActiveTab]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return;
    if (screenStatePersistencePausedRef.current) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'eda',
      state: {
        completed: Boolean(edaDone),
        status: edaDone ? 'completed' : 'in_progress',
        target_column: targetColumn || '',
        viewed_step: activeStep === 'eda',
        activeTab: edaActiveTab,
        activeTabLabel: EDA_SUBSTEP_LABELS[edaActiveTab] || '',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [validActivePipelineId, edaDone, targetColumn, activeStep, edaActiveTab]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !registryEntry) return;
    if (screenStatePersistencePausedRef.current) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'registry',
      state: {
        job_id: activeModelRun?.job_id || modelRun?.job_id || '',
        stage: registryEntry?.stage || 'candidate',
        threshold: registryEntry?.threshold ?? validationReport?.optimal_threshold ?? null,
        deployment_id: registryEntry?.deployment_id || '',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [validActivePipelineId, registryEntry, activeModelRun?.job_id, modelRun?.job_id, validationReport?.optimal_threshold]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    const resolvedPipelineId = Number.isFinite(pipelineId) && pipelineId > 0 ? pipelineId : null;
    if (workflowPersistencePausedRef.current) return undefined;
    if (!shouldPersistWorkflowSession) return undefined;
    if (!hasWorkbenchRuntimeState && pipelineLauncherOpen) return undefined;

    if (workflowSaveTimerRef.current) clearTimeout(workflowSaveTimerRef.current);
    workflowSaveTimerRef.current = setTimeout(() => {
      mlopsApi.saveWorkflowSession({
        session_id: workflowSessionRef.current?.session_id || undefined,
        pipeline_id: resolvedPipelineId,
        pipeline_name: workflowStateSnapshot.pipeline_name || undefined,
        run_id: activeRunId || undefined,
        deployment_id: activeDeploymentId || undefined,
        current_module: 'mlops',
        current_step: activeStep,
        current_state: {
          mlops_state: workflowStateSnapshot,
          pipeline_id: workflowStateSnapshot.pipeline_id,
          pipeline_name: workflowStateSnapshot.pipeline_name,
          run_id: workflowStateSnapshot.run_id,
          deployment_id: workflowStateSnapshot.deployment_id,
          preferred_screen: activeStep,
        },
        last_stable_step: shouldMarkWorkflowStable ? activeStep : undefined,
        last_stable_state: shouldMarkWorkflowStable ? {
          mlops_state: workflowStateSnapshot,
          checkpoint_key: workflowCheckpointKey,
        } : undefined,
        checkpoint_key: workflowCheckpointKey,
        mark_current_stable: shouldMarkWorkflowStable,
        status: activeDeploymentId
          ? 'mlops_live'
          : activeRunId
            ? 'mlops_model_ready'
            : workbenchJourneyState.run_status,
      })
        .then((res) => {
          const session = res?.session || null;
          if (session?.session_id) {
            workflowSessionRef.current = session;
            writePipelineSession(currentEnvId, {
              pipeline_id: resolvedPipelineId,
              name: workflowStateSnapshot.pipeline_name || activePipelineName || experimentName,
              workflow_session_id: session.session_id,
            });
          }
        })
        .catch(() => {});
    }, 650);

    return () => {
      if (workflowSaveTimerRef.current) clearTimeout(workflowSaveTimerRef.current);
    };
  }, [
    activeStep,
    activeRunId,
    activeDeploymentId,
    activePipelineName,
    currentEnvId,
    experimentName,
    pipelineLauncherOpen,
    hasWorkbenchRuntimeState,
    shouldPersistWorkflowSession,
    workflowStateSnapshot,
    workflowCheckpointKey,
    shouldMarkWorkflowStable,
    validActivePipelineId,
    writePipelineSession,
    workbenchJourneyState.run_status,
  ]);

  const guardMessage = useMemo(() => {
    if (!SHOW_STEP_GUARDS) return null;
    const hasData            = (datasets || []).length > 0;
    const hasMaster          = !!masterDataset;
    const hasTarget          = !!targetColumn;
    const hasPreprocess      = !!preprocessDataset;
    const hasModel           = !!modelRun;
    const hasRegistry        = !!registryEntry;
    const hasDatasetForTraining = hasPreprocess || hasMaster;
    switch (activeStep) {
      case 'master':     return hasData    ? null : 'Please complete Step 1 (Load Data) before building a master dataset.';
      case 'target':     return hasMaster  ? null : 'Please complete Step 2 (Combine Tables) before selecting a target.';
      case 'eda':        return hasMaster  ? null : 'Please complete Step 2 (Combine Tables) before exploring data.';
      case 'preprocess': return hasMaster  ? null : 'Please complete Step 2 (Combine Tables) before preprocessing.';
      case 'model':
        if (!hasDatasetForTraining) return 'Please complete Step 2 or Step 5 to prepare a dataset for training.';
        if (!hasTarget) return 'Please complete Step 3 (Target Variable) before training.';
        return null;
      case 'validation': return hasModel   ? null : 'Please complete Step 6 (Train Model) before validation.';
      case 'registry':   return hasModel   ? null : 'Please complete Step 6 (Train Model) before registering.';
      case 'ready':      return hasRegistry ? null : 'Please complete Step 8 (Register Model) before deploy.';
      case 'dashboard':  return (hasRegistry || hasModel) ? null : 'Please complete Step 8 or Step 9 before monitoring.';
      default:           return null;
    }
  }, [activeStep, datasets, masterDataset, targetColumn, preprocessDataset, modelRun, registryEntry]);

  const staleBannerMessage = useMemo(() => {
    const activeDetail = activePipelineMeta?.stale_details?.[activeStep];
    if (activeDetail?.message) return activeDetail.message;
    if (latestDependencyChange?.message) return latestDependencyChange.message;
    return null;
  }, [activePipelineMeta, activeStep, latestDependencyChange]);
  const businessStaleCard = useMemo(() => {
    if (persona !== 'business' || !staleStepSet.has(activeStep)) return null;

    const activeMeta = STEPS.find((step) => step.id === activeStep) || null;
    const activeDetail = activePipelineMeta?.stale_details?.[activeStep] || {};
    const sourceStepId = String(activeDetail?.source_step || latestDependencyChange?.source_step || '').trim();
    const sourceMeta = STEPS.find((step) => step.id === sourceStepId) || null;
    const firstRequiredStep = firstStaleStep || activeMeta;
    const isPrimaryRerunStage = !firstRequiredStep || firstRequiredStep.id === activeStep;

    const currentLabel = activeMeta?.biz || activeMeta?.label || activeStep;
    const sourceLabel = sourceMeta?.biz || sourceMeta?.label || activeDetail?.source_label || 'an upstream step';
    const firstRequiredLabel = firstRequiredStep?.biz || firstRequiredStep?.label || currentLabel;
    const changedAt = formatDependencyStamp(activeDetail?.changed_at || latestDependencyChange?.changed_at);

    const whatChanged = changedAt
      ? `${sourceLabel} was updated on ${changedAt}. The evidence on this page now reflects an older run state.`
      : `${sourceLabel} was updated after this page was completed, so the results shown here no longer align with the latest run inputs.`;

    const whyRerun = isPrimaryRerunStage
      ? `${currentLabel} depends on the earlier ${sourceLabel}. Because that upstream logic changed, this page needs to be refreshed before you rely on the current output or continue to downstream stages.`
      : `${currentLabel} sits downstream of ${firstRequiredLabel}. Until ${firstRequiredLabel} is rerun, this page remains out of date and should not be used for business decisions.`;

    const nextAction = isPrimaryRerunStage
      ? `Review the updated inputs on this page, then rerun ${currentLabel} before moving forward.`
      : `Return to ${firstRequiredLabel}, rerun that stage first, and then come back here once the upstream output is current again.`;

    return {
      currentStepLabel: currentLabel,
      whatChanged,
      whyRerun,
      nextAction,
      actionLabel: isPrimaryRerunStage ? 'Rerun this step' : `Go to ${firstRequiredLabel}`,
      targetStepId: isPrimaryRerunStage ? activeStep : firstRequiredStep?.id || activeStep,
    };
  }, [
    activePipelineMeta,
    activeStep,
    firstStaleStep,
    latestDependencyChange,
    persona,
    staleStepSet,
  ]);
  const autoBuildStaleCard = useMemo(() => {
    if (!firstStaleStep) return null;

    const firstDetail = activePipelineMeta?.stale_details?.[firstStaleStep.id] || {};
    const sourceStepId = String(firstDetail?.source_step || latestDependencyChange?.source_step || '').trim();
    const sourceMeta = STEPS.find((step) => step.id === sourceStepId) || null;
    const sourceLabel = sourceMeta?.biz || sourceMeta?.label || firstDetail?.source_label || 'an upstream step';
    const currentLabel = firstStaleStep.biz || firstStaleStep.label;
    const changedAt = formatDependencyStamp(firstDetail?.changed_at || latestDependencyChange?.changed_at);

    const whatChanged = changedAt
      ? `${sourceLabel} was updated on ${changedAt}. The business summary in this workspace no longer reflects the latest governed run state.`
      : `${sourceLabel} changed after the last saved run state, so the business summary shown here is no longer current.`;

    return {
      currentStepLabel: currentLabel,
      whatChanged,
      whyRerun: `${currentLabel} is the first affected governed stage. Until it is rerun, business summaries and downstream controls remain out of date.`,
      nextAction: `Open ${currentLabel} in the governed workbench, refresh it there, and then return to the business workspace once the run is current again.`,
      actionLabel: `Open ${currentLabel}`,
      targetStepId: firstStaleStep.id,
    };
  }, [activePipelineMeta, firstStaleStep, latestDependencyChange]);
  const primaryCta = useMemo(() => {
    if (firstStaleStep) {
      return {
        label: 'Rerun required',
        detail: persona === 'business' ? firstStaleStep.biz : firstStaleStep.label,
        target: firstStaleStep.id,
        stale: true,
      };
    }
    if (nextStep && !nextLocked) {
      return {
        label: 'Continue',
        detail: persona === 'business' ? nextStep.biz : nextStep.label,
        target: nextStep.id,
        stale: false,
      };
    }
    return null;
  }, [firstStaleStep, nextLocked, nextStep, persona]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleBusinessStaleAction = useCallback(() => {
    if (!businessStaleCard) return;

    const targetStep = resolveStepNavigation(businessStaleCard.targetStepId) || businessStaleCard.targetStepId;
    if (targetStep && targetStep !== activeStep) {
      openWorkbenchStep(targetStep, { skipGuardRedirect: true });
      return;
    }

    const canvas = document.getElementById('fcc-workbench-main-canvas');
    if (canvas) {
      canvas.scrollTo({ top: 320, behavior: 'smooth' });
    }
  }, [activeStep, businessStaleCard, openWorkbenchStep, resolveStepNavigation]);
  const handleAutoBuildStaleAction = useCallback(() => {
    if (!autoBuildStaleCard) return;
    setMode('expert');
    const targetStep = resolveStepNavigation(autoBuildStaleCard.targetStepId) || autoBuildStaleCard.targetStepId;
    if (targetStep) {
      openWorkbenchStep(targetStep, { skipGuardRedirect: true });
    }
  }, [autoBuildStaleCard, openWorkbenchStep, resolveStepNavigation]);

  const handleBuildMaster = useCallback(async ({ name } = {}) => {
    if (!datasets.length) return;
    setBuilding(true);
    try {
      const res   = await mlopsApi.preprocessMasterBuild({ dataset_ids: datasets.map((d) => d.dataset_id), output_name: name || 'master_dataset', master_mode: 'notebook' });
      await loadDatasets();
      const built = res.data?.dataset || res.dataset || res.data || res;
      if (built?.dataset_id) setMasterDataset(built);
    } catch (e) { console.error('Master build failed', e); }
    finally { setBuilding(false); }
  }, [datasets, loadDatasets]);

  const handleMasterBuildComplete = useCallback(async (built) => {
    if (built?.dataset_id) {
      setMasterDataset(built);
    }
    await loadDatasets();
  }, [loadDatasets]);

  const handlePreprocessPreview = useCallback(async () => {
    if (!masterDataset) return;
    try {
      const res = await mlopsApi.preprocessPreview({ dataset_id: masterDataset.dataset_id, steps: preprocessSteps, target_column: targetColumn });
      setPreprocessPreview(res.data || res);
    } catch (e) { console.error(e); }
  }, [masterDataset, preprocessSteps, targetColumn]);

  const handlePreprocessRun = useCallback(async () => {
    if (!masterDataset) return;
    try {
      const res   = await mlopsApi.preprocessRun({ dataset_id: masterDataset.dataset_id, steps: preprocessSteps, target_column: targetColumn });
      const built = res.data?.dataset || res.dataset || res.data || res;
      if (built?.dataset_id) { setPreprocessDataset(built); await loadDatasets(); }
    } catch (e) { console.error(e); }
  }, [masterDataset, preprocessSteps, targetColumn, loadDatasets]);

  const handleSnapshot = async () => {
    try { await mlopsApi.createSnapshot({ experiment_name: experimentName, dataset_ids: datasets.map((d) => d.dataset_id) }); }
    catch (e) { console.error(e); }
  };

  const handleQualityRun = async () => {
    if (!masterDataset) return;
    try { const res = await mlopsApi.qualityScore({ dataset_id: masterDataset.dataset_id }); setQualityScore(res.data || res); }
    catch (e) { console.error(e); }
  };

  const createPipelineRun = useCallback(async (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Run name is required.');
    const freshStep = 'data';
    const payload = {
      name: trimmed,
      dataset_id: 0,
      dataset_ids: [],
      created_by_persona: persona || 'technical',
      steps: [{
        type: 'screen_state',
        screen: 'pipeline_hub',
        state: {
          stage_order: ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry'],
          created_from: 'workbench',
        },
      }],
    };
    const res = await mlopsApi.pipelineSave(payload);
    const savedPipeline = res?.data || res || {};
    const existingSessionId = String(workflowSessionRef.current?.session_id || '').trim();
    if (existingSessionId && savedPipeline?.pipeline_id) {
      const freshWorkflowState = {
        pipeline_id: savedPipeline.pipeline_id,
        pipeline_name: trimmed,
        current_step: freshStep,
        preferred_screen: freshStep,
        datasets: [],
        master_dataset_id: null,
        master_dataset: null,
        target_column: '',
        eda_completed: false,
        master_state: { currentStepId: 'base' },
        target_state: { activeTab: 0 },
        eda_state: { activeTab: 'dashboard' },
        preprocess_state: { activeTab: 0 },
        preprocess_dataset_id: null,
        preprocess_dataset: null,
        preprocess_steps: [],
        preprocess_plan: [],
        model_state: { activeTab: 0 },
        validation_state: { activeTab: 0 },
      };
      try {
        const sessionRes = await mlopsApi.saveWorkflowSession({
          session_id: existingSessionId,
          pipeline_id: savedPipeline.pipeline_id,
          pipeline_name: trimmed,
          current_module: 'mlops',
          current_step: freshStep,
          current_state: {
            mlops_state: {
              ...freshWorkflowState,
              pipeline_id: savedPipeline.pipeline_id,
              pipeline_name: trimmed,
            },
            pipeline_id: savedPipeline.pipeline_id,
            pipeline_name: trimmed,
            preferred_screen: freshStep,
          },
          checkpoint_key: 'FCC_SESSION_STARTED',
          mark_current_stable: false,
          status: 'draft',
        });
        const session = sessionRes?.session || null;
        if (session?.session_id) workflowSessionRef.current = session;
      } catch {
        // Best-effort migration from draft workflow session to saved pipeline session.
      }
    }
    setActiveStep(freshStep);
    activatePipeline({ pipeline_id: savedPipeline.pipeline_id, name: trimmed }, { step: freshStep });
    clearLocalWorkbenchState();
    setExperimentName(trimmed);
    setPipelineLauncherOpen(false);
    await loadSavedPipelines();
    return savedPipeline;
  }, [activatePipeline, clearLocalWorkbenchState, loadSavedPipelines, persona]);

  const handleStartNewPipeline = useCallback(() => {
    setNewPipelineName('');
    setNewPipelineError('');
    setCreatePipelineDialogOpen(true);
    setPipelineLauncherOpen(false);
  }, []);

  const handleConfirmCreatePipeline = useCallback(async () => {
    const trimmed = String(newPipelineName || '').trim();
    if (!trimmed) { setNewPipelineError('Run name is required.'); return; }
    const duplicateName = (savedPipelines || []).some((p) => String(p?.name || '').trim().toLowerCase() === trimmed.toLowerCase());
    if (duplicateName) { setNewPipelineError('Run name already exists. Use a different name to create a fresh run.'); return; }
    setCreatingPipeline(true);
    setNewPipelineError('');
    try {
      await createPipelineRun(trimmed);
      setCreatePipelineDialogOpen(false);
      setNewPipelineName('');
    } catch (e) {
      setNewPipelineError(e?.response?.data?.error || e?.message || 'Failed to create run.');
    } finally {
      setCreatingPipeline(false);
    }
  }, [createPipelineRun, newPipelineName, savedPipelines]);

  const resumePipeline = useCallback(async (pipelineRef, options = {}) => {
    const workflowSessionId = String(
      pipelineRef?.workflow_session_id
      || pipelineRef?.session_id
      || '',
    ).trim();
    const pipelineId = Number(pipelineRef?.pipeline_id || pipelineRef || 0);
    const explicitStep = normalizeWorkbenchStep(options?.preferredStep || '');
    try {
      pauseWorkflowPersistence();
      pauseScreenStatePersistence();
      clearLocalWorkbenchState();
      if (!pipelineId && workflowSessionId) {
        const workflowRes = await mlopsApi.getWorkflowSession({ session_id: workflowSessionId });
        const session = workflowRes?.session || workflowRes?.data?.session || null;
        if (!session) return;
        workflowSessionRef.current = session;
        const sessionPipelineId = Number(session?.pipeline_id || 0) || null;
        const sessionPipelineName = String(session?.pipeline_name || pipelineRef?.name || '').trim();
        setActivePipelineId(sessionPipelineId);
        setActivePipelineName(sessionPipelineName);
        setActivePipelineMeta(pipelineRef || null);
        writePipelineSession(currentEnvId, {
          pipeline_id: sessionPipelineId,
          name: sessionPipelineName,
          workflow_session_id: session.session_id,
        });
        let parsed = await loadDatasets({ sync: false });
        if (!(parsed?.all?.length > 0)) parsed = await loadDatasets({ sync: true });
        restoreWorkflowRuntimeState(session, parsed?.all || []);
        if (explicitStep && isWorkbenchStep(explicitStep)) {
          setActiveStep(explicitStep);
        }
        setPipelineLauncherOpen(false);
        return;
      }
      if (!pipelineId) return;
      const res  = await mlopsApi.pipelineGet(pipelineId);
      const full = res?.data || res;
      activatePipeline(full, { suppressRouteNavigation: true });
      let parsed = await loadDatasets({ sync: false });
      if (!(parsed?.all?.length > 0)) parsed = await loadDatasets({ sync: true });
      const workflowSession = full?.workflow_session || null;
      if (workflowSession?.session_id) {
        workflowSessionRef.current = workflowSession;
        writePipelineSession(currentEnvId, {
          pipeline_id: Number(full?.pipeline_id || pipelineId) || null,
          name: String(full?.name || workflowSession?.pipeline_name || '').trim(),
          workflow_session_id: workflowSession.session_id,
        });
        restoreWorkflowRuntimeState(workflowSession, parsed?.all || []);
      }

      const dataState       = getScreenState(full?.steps, 'data_upload')  || {};
      const masterState     = getScreenState(full?.steps, 'master')       || {};
      const preprocessState = getScreenState(full?.steps, 'preprocess')   || {};
      const edaState        = getScreenState(full?.steps, 'eda')          || {};
      const modelState      = getScreenState(full?.steps, 'model')        || {};
      const targetState     = getScreenState(full?.steps, 'target')       || {};
      const validationState = getScreenState(full?.steps, 'validation')   || {};
      const registryState   = getScreenState(full?.steps, 'registry')     || {};
      const dashboardState  = getScreenState(full?.steps, 'dashboard')    || {};
      const journeyState    = getScreenState(full?.steps, 'workbench_journey') || {};

      if (masterState?.currentStepId) {
        setMasterCurrentStepId(String(masterState.currentStepId).trim().toLowerCase());
      }
      if (Number.isInteger(targetState?.activeTab)) {
        setTargetActiveTab(targetState.activeTab);
      }
      if (edaState?.activeTab) {
        setEdaActiveTab(String(edaState.activeTab).trim().toLowerCase());
      }
      if (Number.isInteger(modelState?.activeTab)) {
        setModelActiveTab(modelState.activeTab);
      }
      if (Number.isInteger(validationState?.activeTab)) {
        setValidationActiveTab(validationState.activeTab);
      }

      const pipelineDatasetIds = new Set(
        (Array.isArray(full?.dataset_ids) ? full.dataset_ids : [])
          .concat(Array.isArray(dataState?.dataset_ids) ? dataState.dataset_ids : [])
          .map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
      );
      if (pipelineDatasetIds.size > 0) {
        setDatasets((parsed?.rawOnly || []).filter((d) => pipelineDatasetIds.has(Number(d?.dataset_id))));
      }

      const allDatasets = parsed?.all || [];
      const firstById   = (ids = []) => {
        for (const rawId of ids) {
          const id  = Number(rawId);
          if (!Number.isFinite(id) || id <= 0) continue;
          const hit = allDatasets.find((d) => Number(d?.dataset_id) === id);
          if (hit) return hit;
        }
        return null;
      };

      const resumedPreprocessed = firstById([preprocessState?.preprocessedDatasetId, preprocessState?.outputDatasetId]);
      if (resumedPreprocessed) setPreprocessDataset(resumedPreprocessed);

      const resumedMaster = firstById([masterState?.builtMasterDatasetId, masterState?.outputDatasetId, preprocessState?.masterDatasetId, full?.output_dataset_id, full?.dataset_id]);
      if (resumedMaster) {
        if (String(resumedMaster?.dataset_type || '').toLowerCase().includes('preprocess')) {
          setPreprocessDataset((prev) => prev || resumedMaster);
        } else {
          setMasterDataset(resumedMaster);
        }
      }

      const restoredTarget = String(targetState?.currentTargetColumn || targetState?.selectedTargetColumn || '').trim();
      if (restoredTarget) setTargetColumn(restoredTarget);
      setEdaDone(Boolean(edaState?.completed || edaState?.done || edaState?.status === 'completed'));
      if (Array.isArray(preprocessState?.steps)) {
        setPreprocessSteps(normalizePreprocessSteps(preprocessState.steps));
      }

      const resumedJourneyStep = normalizeWorkbenchStep(journeyState?.current_step || '');
      const resumedJourneySubstep = String(journeyState?.current_substep || '').trim();
      if (resumedJourneyStep === 'master' && resumedJourneySubstep) {
        setMasterCurrentStepId(resumedJourneySubstep.toLowerCase());
      } else if (resumedJourneyStep === 'target' && resumedJourneySubstep !== '' && Number.isInteger(Number(resumedJourneySubstep))) {
        setTargetActiveTab(Number(resumedJourneySubstep));
      } else if (resumedJourneyStep === 'eda' && resumedJourneySubstep) {
        setEdaActiveTab(resumedJourneySubstep.toLowerCase());
      } else if (resumedJourneyStep === 'model' && resumedJourneySubstep !== '' && Number.isInteger(Number(resumedJourneySubstep))) {
        setModelActiveTab(Number(resumedJourneySubstep));
      } else if (resumedJourneyStep === 'validation' && resumedJourneySubstep !== '' && Number.isInteger(Number(resumedJourneySubstep))) {
        setValidationActiveTab(Number(resumedJourneySubstep));
      }

      const restoredRunId = String(
        modelState?.job_id
        || registryState?.job_id
        || validationState?.job_id
        || dashboardState?.run_id
        || '',
      ).trim();
      if (restoredRunId) {
        let restoredRun = null;
        try {
          const runListRes = await mlopsApi.listTrainingRuns({ limit: 200 });
          const runRows = Array.isArray(runListRes?.data) ? runListRes.data : Array.isArray(runListRes) ? runListRes : [];
          restoredRun = runRows.find((row) => String(row?.job_id || '') === restoredRunId) || null;
        } catch {
          restoredRun = null;
        }

        const thresholdHint = Number(
          registryState?.threshold
          ?? validationState?.optimal_threshold
          ?? dashboardState?.threshold
          ?? modelState?.threshold
          ?? 0.5,
        );
        const normalizedRun = {
          ...(restoredRun || {}),
          job_id: restoredRunId,
          algorithm: restoredRun?.algorithm || modelState?.algorithm || 'saved_run',
          metrics: restoredRun?.metrics || {},
          threshold: Number.isFinite(thresholdHint) ? thresholdHint : 0.5,
          grain: restoredRun?.grain || registryState?.grain || 'alert',
        };
        setActiveModelRun(normalizedRun);
        setModelRun({
          job_id: normalizedRun.job_id,
          algorithm: normalizedRun.algorithm,
          algorithm_id: normalizedRun.algorithm_id,
          auc: normalizedRun.auc ?? normalizedRun.metrics?.roc_auc,
          metrics: normalizedRun.metrics || {},
          results: normalizedRun.results,
          grain: normalizedRun.grain,
          threshold: normalizedRun.threshold,
        });
        setReportRunId(restoredRunId);
      }

      const restoredValidationThreshold = validationState?.optimal_threshold;
      if (restoredValidationThreshold != null || validationState?.report_id) {
        setValidationReport({
          ...validationState,
          job_id: validationState?.job_id || restoredRunId || '',
          optimal_threshold: Number(restoredValidationThreshold ?? dashboardState?.threshold ?? 0.5),
        });
      }

      const restoredDeploymentId = String(
        registryState?.deployment_id
        || dashboardState?.deployment_id
        || '',
      ).trim();
      if (restoredDeploymentId || registryState?.job_id || restoredRunId) {
        const restoredRegistryThreshold = Number(
          registryState?.threshold
          ?? validationState?.optimal_threshold
          ?? dashboardState?.threshold
          ?? 0.5,
        );
        setRegistryEntry({
          ...registryState,
          job_id: registryState?.job_id || restoredRunId || '',
          deployment_id: restoredDeploymentId,
          threshold: Number.isFinite(restoredRegistryThreshold) ? restoredRegistryThreshold : 0.5,
          selected_threshold: Number.isFinite(restoredRegistryThreshold) ? restoredRegistryThreshold : 0.5,
          stage: registryState?.stage || (restoredDeploymentId ? 'DEPLOYED' : 'candidate'),
          grain: registryState?.grain || 'alert',
        });
      }

      const requestedStep = String(
        workflowSession?.current_state?.mlops_state?.current_step
        || workflowSession?.last_stable_state?.mlops_state?.current_step
        || workflowSession?.current_step
        || journeyState?.current_step
        || '',
      ).trim().toLowerCase();
      const normalizedStep = requestedStep === 'data_upload' ? 'data' : requestedStep;
      const resumeStaleStep = flowSteps.find((step) => (full?.stale_steps || []).includes(step.id))?.id || '';
      const completion     = derivePipelineStepCompletion(full || {});
      const pipelineStatus = String(full?.status || '').toLowerCase();
      if (explicitStep && isWorkbenchStep(explicitStep)) setActiveStep(explicitStep);
      else if (normalizedStep && STEPS.some((step) => step.id === normalizedStep)) setActiveStep(normalizedStep);
      else if (resumeStaleStep) setActiveStep(resumeStaleStep);
      else if (['complete', 'completed', 'done'].includes(pipelineStatus)) setActiveStep('pipelines');
      else if (completion.preprocess)   setActiveStep('preprocess');
      else if (completion.eda)          setActiveStep('eda');
      else if (completion.target)       setActiveStep('target');
      else if (completion.master)       setActiveStep('master');
      else                              setActiveStep('data');

      setPipelineLauncherOpen(false);
    } catch (e) { console.error('Failed to resume pipeline', e); }
    finally {
      setTimeout(() => {
        resumeScreenStatePersistence();
        resumeWorkflowPersistence();
      }, 0);
    }
  }, [activatePipeline, clearLocalWorkbenchState, currentEnvId, flowSteps, loadDatasets, pauseScreenStatePersistence, pauseWorkflowPersistence, restoreWorkflowRuntimeState, resumeScreenStatePersistence, resumeWorkflowPersistence]);

  useEffect(() => {
    if (!savedPipelinesLoaded) return;
    if (!normalizedRouteRunId) {
      routeResumeRef.current = '';
      setActiveStep((prev) => (prev === 'pipelines' ? prev : 'pipelines'));
      return;
    }

    const routeKey = `${currentEnvId}:${normalizedRouteRunId}:${normalizedRouteStep || 'pipelines'}`;
    if (Number(validActivePipelineId || 0) !== Number(normalizedRouteRunId)) {
      if (routeResumeRef.current === routeKey) return;
      routeResumeRef.current = routeKey;
      const matchedPipeline = (savedPipelines || []).find(
        (row) => Number(row?.pipeline_id || 0) === Number(normalizedRouteRunId),
      );
      if (!matchedPipeline) {
        routeResumeRef.current = '';
        setPipelineSelectionNotice(
          `Run ${toRunRef(normalizedRouteRunId) || normalizedRouteRunId} is not available in environment "${currentEnvId}".`,
        );
        navigate('/mlops/runs', { replace: true });
        return;
      }
      resumePipeline(matchedPipeline, {
        preferredStep: normalizedRouteStep || 'pipelines',
      }).finally(() => {
        if (routeResumeRef.current === routeKey) {
          routeResumeRef.current = '';
        }
      });
      return;
    }

    routeResumeRef.current = '';
    if (normalizedRouteStep && normalizedRouteStep !== activeStep) {
      setActiveStep(normalizedRouteStep);
    }
  }, [
    activeStep,
    currentEnvId,
    navigate,
    normalizedRouteRunId,
    normalizedRouteStep,
    resumePipeline,
    savedPipelines,
    savedPipelinesLoaded,
    validActivePipelineId,
  ]);

  useEffect(() => {
    if (normalizedRouteRunId) return;
    const pipelineId = Number(validActivePipelineId || 0);
    const resumeTargetId = Number(defaultResumePipeline?.pipeline_id || 0);
    if (!pipelineLauncherOpen || !pipelineId || !resumeTargetId || pipelineId !== resumeTargetId) return;
    if (hasWorkbenchRuntimeState) return;
    const resumeKey = `${currentEnvId}:${pipelineId}`;
    if (autoResumeKeyRef.current === resumeKey) return;
    autoResumeKeyRef.current = resumeKey;
    openPipelineRoute(defaultResumePipeline, { replace: true });
  }, [
    normalizedRouteRunId,
    validActivePipelineId,
    currentEnvId,
    defaultResumePipeline,
    hasWorkbenchRuntimeState,
    openPipelineRoute,
    pipelineLauncherOpen,
  ]);

  const handleReset = useCallback(() => {
    if (resetting) return;
    setResetConfirmOpen(true);
  }, [resetting]);

  const performWorkspaceReset = useCallback(async () => {
    await mlopsApi.resetDatasets({ delete_files: true });
    lsClear();
    clearLocalWorkbenchState();
    setSavedPipelines([]);
    clearActivePipeline();
    setExperimentName(DEFAULT_EXPERIMENT_NAME);
    setPipelineLauncherOpen(false);
    setActiveStep('pipelines');
    setPipelineSelectionNotice('Cleared uploaded data and pipeline state for this environment. Upload files to start a new run.');
    await loadDatasets({ sync: false });
    await loadSavedPipelines();
  }, [clearActivePipeline, clearLocalWorkbenchState, loadDatasets, loadSavedPipelines]);

  const confirmReset = useCallback(async () => {
    setResetting(true);
    try {
      await performWorkspaceReset();
      setResetConfirmOpen(false);
    } finally {
      setResetting(false);
    }
  }, [performWorkspaceReset]);

  const adoptModelRun = useCallback((run, options = {}) => {
    const nextJobId = String(run?.job_id || run?.run_id || '').trim();
    if (!nextJobId) return;
    const previousJobId = String(activeModelRun?.job_id || modelRun?.job_id || '').trim();
    const isNewRun = previousJobId !== nextJobId;
    const nextThreshold = run?.selected_threshold ?? run?.threshold ?? run?.optimal_threshold ?? run?.metrics?.optimal_threshold ?? activeModelRun?.selected_threshold ?? activeModelRun?.threshold;
    const normalizedRun = {
      ...(activeModelRun || {}),
      ...(modelRun || {}),
      ...(run || {}),
      job_id: nextJobId,
      algorithm_id: run?.algorithm_id || run?.algo_id || run?.results?.algorithm || activeModelRun?.algorithm_id,
      algorithm: run?.algorithm || run?.algorithm_display || run?.algorithm_id || run?.algo_id || run?.results?.algorithm || activeModelRun?.algorithm,
      auc: run?.auc ?? run?.results?.metrics?.roc_auc ?? run?.metrics?.roc_auc ?? activeModelRun?.auc,
      metrics: run?.results?.metrics || run?.metrics || activeModelRun?.metrics || {},
      selected_threshold: nextThreshold,
      threshold: nextThreshold,
    };
    setActiveModelRun((prev) => {
      const prevSignature = JSON.stringify({
        job_id: prev?.job_id || '',
        algorithm: prev?.algorithm || '',
        threshold: prev?.selected_threshold ?? prev?.threshold ?? null,
        auc: prev?.auc ?? prev?.metrics?.roc_auc ?? null,
      });
      const nextSignature = JSON.stringify({
        job_id: normalizedRun.job_id,
        algorithm: normalizedRun.algorithm || '',
        threshold: normalizedRun.selected_threshold ?? normalizedRun.threshold ?? null,
        auc: normalizedRun.auc ?? normalizedRun.metrics?.roc_auc ?? null,
      });
      return prevSignature === nextSignature ? prev : normalizedRun;
    });
    setModelRun((prev) => {
      const nextModelRun = {
        job_id: normalizedRun.job_id,
        algorithm: normalizedRun.algorithm,
        algorithm_id: normalizedRun.algorithm_id,
        auc: normalizedRun.auc,
        metrics: normalizedRun.metrics || {},
        results: normalizedRun.results,
        grain: normalizedRun.grain,
        threshold: normalizedRun.selected_threshold ?? normalizedRun.threshold,
        selected_threshold: normalizedRun.selected_threshold ?? normalizedRun.threshold,
      };
      const prevSignature = JSON.stringify({
        job_id: prev?.job_id || '',
        algorithm: prev?.algorithm || '',
        threshold: prev?.selected_threshold ?? prev?.threshold ?? null,
        auc: prev?.auc ?? prev?.metrics?.roc_auc ?? null,
      });
      const nextSignature = JSON.stringify({
        job_id: nextModelRun.job_id,
        algorithm: nextModelRun.algorithm || '',
        threshold: nextModelRun.selected_threshold ?? nextModelRun.threshold ?? null,
        auc: nextModelRun.auc ?? nextModelRun.metrics?.roc_auc ?? null,
      });
      return prevSignature === nextSignature ? prev : nextModelRun;
    });
    setReportRunId(nextJobId);
    if (isNewRun && options.resetDownstream !== false) {
      setValidationReport(null);
      setRegistryEntry(null);
    }
    if (options.nextStep) openWorkbenchStep(options.nextStep, { skipGuardRedirect: true });
  }, [activeModelRun, modelRun, openWorkbenchStep]);

  const handleValidationStateChange = useCallback((report) => {
    if (!report || typeof report !== 'object') return;
    const reportJobId = String(report?.job_id || report?.run_id || activeModelRun?.job_id || modelRun?.job_id || '').trim();
    const selectedThreshold = report?.selected_threshold ?? report?.locked_threshold ?? report?.optimal_threshold ?? null;
    setValidationReport((prev) => ({
      ...(prev || {}),
      ...(report || {}),
      job_id: reportJobId || prev?.job_id || '',
      selected_threshold: selectedThreshold,
      locked_threshold: report?.locked_threshold ?? selectedThreshold,
      metrics: {
        ...(prev?.metrics || {}),
        ...(report?.metrics || {}),
      },
      business_summary: report?.business_summary ?? prev?.business_summary ?? null,
    }));
    if (reportJobId) {
      setReportRunId(reportJobId);
      setActiveModelRun((prev) => {
        const base = { ...(prev || {}) };
        const next = {
          ...base,
          job_id: reportJobId,
          threshold: selectedThreshold ?? base.threshold ?? null,
          selected_threshold: selectedThreshold ?? base.selected_threshold ?? null,
          metrics: {
            ...(base.metrics || {}),
            ...(report?.metrics || {}),
            optimal_threshold: report?.optimal_threshold ?? report?.metrics?.optimal_threshold ?? base.metrics?.optimal_threshold ?? null,
          },
        };
        const prevSignature = JSON.stringify({
          job_id: prev?.job_id || '',
          threshold: prev?.selected_threshold ?? prev?.threshold ?? null,
          optimal_threshold: prev?.metrics?.optimal_threshold ?? null,
          business_summary: prev?.business_summary?.conclusion || prev?.business_summary?.generated_for || '',
        });
        const nextSignature = JSON.stringify({
          job_id: next.job_id,
          threshold: next.selected_threshold ?? next.threshold ?? null,
          optimal_threshold: next.metrics?.optimal_threshold ?? null,
          business_summary: report?.business_summary?.conclusion || report?.business_summary?.generated_for || '',
        });
        return prevSignature === nextSignature ? prev : next;
      });
      setModelRun((prev) => {
        const base = { ...(prev || {}) };
        const next = {
          ...base,
          job_id: reportJobId,
          threshold: selectedThreshold ?? base.threshold ?? null,
          selected_threshold: selectedThreshold ?? base.selected_threshold ?? null,
          metrics: {
            ...(base.metrics || {}),
            ...(report?.metrics || {}),
            optimal_threshold: report?.optimal_threshold ?? report?.metrics?.optimal_threshold ?? base.metrics?.optimal_threshold ?? null,
          },
        };
        const prevSignature = JSON.stringify({
          job_id: prev?.job_id || '',
          threshold: prev?.selected_threshold ?? prev?.threshold ?? null,
          optimal_threshold: prev?.metrics?.optimal_threshold ?? null,
          business_summary: prev?.business_summary?.conclusion || prev?.business_summary?.generated_for || '',
        });
        const nextSignature = JSON.stringify({
          job_id: next.job_id,
          threshold: next.selected_threshold ?? next.threshold ?? null,
          optimal_threshold: next.metrics?.optimal_threshold ?? null,
          business_summary: report?.business_summary?.conclusion || report?.business_summary?.generated_for || '',
        });
        return prevSignature === nextSignature ? prev : next;
      });
    }
  }, [activeModelRun?.job_id, modelRun?.job_id]);

  const handleValidationActiveRunChange = useCallback((run) => {
    adoptModelRun(run, { resetDownstream: false });
  }, [adoptModelRun]);

  const handleModelComplete = useCallback((run, options = {}) => {
    adoptModelRun(run, { resetDownstream: !options?.resumeExisting, nextStep: 'validation' });
  }, [adoptModelRun]);

  const handleRegistered = useCallback((entry) => { setRegistryEntry(entry); }, []);

  const handleEdaComplete = useCallback(() => {
    setEdaDone(true);
    openWorkbenchStep('preprocess', { skipGuardRedirect: true });
  }, [openWorkbenchStep]);

  const handleDeploy = useCallback((deployResult, options = {}) => {
    if (deployResult?.deployment_id) {
      setRegistryEntry((prev) => ({ ...prev, deployment_id: deployResult.deployment_id, threshold: deployResult.threshold ?? prev?.threshold }));
    }
    if (options?.navigateToDashboard) {
      openWorkbenchStep('dashboard', { skipGuardRedirect: true });
    }
  }, [openWorkbenchStep]);

  const handleOpenReport = useCallback((runId) => {
    if (runId != null && String(runId).trim()) setReportRunId(String(runId));
    openWorkbenchStep('reports', { skipGuardRedirect: true });
  }, [openWorkbenchStep]);

  const renderStepRail = (collapsed, onStepSelect) => (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: collapsed ? 1 : 2.5, pt: 1.6, pb: 1.2, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && (
          <Typography sx={{ fontSize: 9, fontWeight: 700, color: D.textMuted, textTransform: 'uppercase', letterSpacing: 1.5 }}>
            ML Pipeline
          </Typography>
        )}
        {!isMobile && (
          <Tooltip title={collapsed ? 'Expand ML pipeline' : 'Collapse ML pipeline'}>
            <IconButton
              size="small"
              onClick={() => setRailCollapsed((v) => !v)}
              disabled={forceRailCollapse}
              sx={{ color: D.textMuted, bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}
            >
              {collapsed ? <ChevronRight sx={{ fontSize: 14 }} /> : <ChevronLeft sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {STEPS.map((step, idx) => {
          const status = stepStatus(step.id, stepCtx);
          const isActive = activeStep === step.id;
          const isLocked = status === 'locked';
          const isStale = status === 'stale';
          const canNavigate = step.id === 'pipelines'
            || (hasPipelineContext && (ALLOW_LOCKED_NAV || !isLocked));
          const isDone = status === 'done';
          const Icon = step.icon;
          return (
            <Box key={step.id}>
              {idx > 0 && (
                <Box sx={{ ml: collapsed ? '41px' : '36px', width: 1.5, height: 12, bgcolor: isDone ? D.done : isStale ? D.warning : 'rgba(255,255,255,0.05)' }} />
              )}
              <Tooltip title={collapsed ? (persona === 'business' ? step.biz : step.label) : ''} placement="right">
                <Box
                  component={motion.div}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.16, delay: idx * 0.015 }}
                  onClick={() => {
                    if (!canNavigate) return;
                    openWorkbenchStep(step.id);
                    onStepSelect?.();
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: collapsed ? 0 : 1.5,
                    px: collapsed ? 1.25 : 2,
                    py: 1.25,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    cursor: canNavigate ? 'pointer' : 'default',
                    bgcolor: isActive ? D.railActive : 'transparent',
                    borderLeft: `3px solid ${isActive ? D.orange : 'transparent'}`,
                    transition: 'all 0.12s ease',
                    '&:hover': canNavigate ? { bgcolor: D.railHover } : {},
                    position: 'relative',
                  }}
                >
                  <Box sx={{
                    width: 28, height: 28, borderRadius: 0, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: isDone ? 'rgba(46,125,50,0.18)' : isStale ? 'rgba(163,111,0,0.18)' : isActive ? 'rgba(208,74,2,0.2)' : isLocked ? D.locked : 'rgba(255,255,255,0.05)',
                      border: `1.5px solid ${isDone ? D.done : isStale ? D.warning : isActive ? D.orange : isLocked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)'}`,
                    }}>
                    {isDone ? <CheckCircle sx={{ fontSize: 14, color: D.done }} />
                      : isStale ? <Refresh sx={{ fontSize: 12, color: D.warning }} />
                      : isLocked ? <Lock sx={{ fontSize: 11, color: D.textMuted }} />
                        : <Icon sx={{ fontSize: 13, color: isActive ? D.orange : D.textMuted }} />}
                  </Box>
                  {!collapsed && (
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: isActive ? 700 : 500, lineHeight: 1.3, color: isLocked ? D.lockedText : isActive ? D.textPrimary : D.textMuted }}>
                        {persona === 'business' ? step.biz : step.label}
                      </Typography>
                      <Typography sx={{ fontSize: 10, lineHeight: 1.3, display: 'block', color: isDone ? D.done : isStale ? D.warning : isLocked ? D.lockedText : D.textMuted }}>
                        {isDone ? 'Done' : isStale ? 'Needs rerun' : isLocked ? 'Blocked' : isActive ? 'Current' : 'Pending'}
                      </Typography>
                    </Box>
                  )}
                  {isActive && !collapsed && (
                    <Box sx={{ position: 'absolute', right: 8, width: 5, height: 5, borderRadius: 0, bgcolor: D.orange }} />
                  )}
                </Box>
              </Tooltip>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ px: collapsed ? 1 : 2.5, py: 2, borderTop: `1px solid ${D.railBorder}` }}>
        {!collapsed && hasPipelineContext && datasets.length > 0 && (
          <Stack spacing={0.4} sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 10, color: D.textMuted }}>{datasets.length} table{datasets.length !== 1 ? 's' : ''} loaded</Typography>
            {masterDataset && <Typography sx={{ fontSize: 10, color: D.textMuted }}>Master: {fmt(masterDataset.row_count)} rows</Typography>}
            {targetColumn && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: D.panel, px: 1, py: 0.25, borderRadius: 0, border: `1px solid ${T.successBorder}` }}>
                <Flag sx={{ fontSize: 9, color: D.done }} />
                <Typography sx={{ fontSize: 10, color: D.done, fontWeight: 600 }}>{targetColumn}</Typography>
              </Box>
            )}
            {activeModelRun && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: D.panel, px: 1, py: 0.25, borderRadius: 0, border: `1px solid ${T.accentBorder}` }}>
                <ModelTraining sx={{ fontSize: 9, color: D.orange }} />
                <Typography sx={{ fontSize: 10, color: D.orange, fontWeight: 600 }}>
                  {(activeModelRun.algorithm || activeModelRun.algorithm_id || '').replace(/_/g, ' ')} AUC{' '}
                  {(activeModelRun.auc ?? activeModelRun.results?.metrics?.roc_auc)?.toFixed(3) ?? '-'}
                </Typography>
              </Box>
            )}
          </Stack>
        )}
        <Button
          size="small" fullWidth variant="outlined"
          startIcon={<DeleteForever sx={{ fontSize: 14 }} />}
          onClick={handleReset} disabled={resetting}
          sx={{
            fontSize: 10, textTransform: 'none', color: D.textMuted,
            borderColor: D.railBorder,
            '&:hover': { borderColor: D.error, color: D.error, bgcolor: 'rgba(180,35,24,0.08)' },
          }}
        >
          {collapsed ? '' : (resetting ? 'Resetting...' : 'Start Fresh')}
        </Button>
      </Box>
    </Box>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{
      height: '100%',
      minHeight: 0,
      width: '100%',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      bgcolor: D.canvas,
      fontFamily: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    }}>

      {/* ══ UNIFIED CHROME BAR ══════════════════════════════════════════════ */}
      <Box component={motion.div} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.22 }}
        sx={{
        minHeight: { xs: 56, md: D.topH }, bgcolor: D.chrome, flexShrink: 0, zIndex: 20,
        borderBottom: `1px solid ${D.chromeBorder}`,
        display: 'flex', alignItems: 'center', px: { xs: 1.25, md: 2 }, gap: 0, flexWrap: 'wrap',
      }}>
        {/* Brand */}
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ flexShrink: 0, mr: 1.25, minWidth: 0 }}>
          {mode === 'expert' && isMobile && (
            <Tooltip title="Open pipeline navigation">
              <IconButton
                size="small"
                onClick={() => setMobileRailOpen(true)}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: 0,
                  color: D.textMuted,
                  border: `1px solid ${D.chromeBorder}`,
                  '&:hover': {
                    color: D.orange,
                    borderColor: D.orange,
                    bgcolor: 'rgba(255,255,255,0.03)',
                  },
                }}
              >
                <MenuOpen sx={{ fontSize: 16, transform: 'rotate(180deg)' }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Back to module selection">
            <IconButton
              size="small"
              onClick={() => {
                setActiveTool(null);
                navigate('/tools', { replace: true, state: { skipRestore: true } });
              }}
              sx={{
                width: 24,
                height: 24,
                borderRadius: 0,
                color: D.textMuted,
                border: `1px solid ${D.chromeBorder}`,
                  '&:hover': {
                    color: D.orange,
                    borderColor: D.orange,
                    bgcolor: 'rgba(255,255,255,0.03)',
                  },
              }}
            >
              <ChevronLeft sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Box component="img" src={PwCLogo} alt="PwC" sx={{ height: 20, width: 'auto' }} />
          <Typography sx={{ fontSize: { xs: 11, md: 12 }, fontWeight: 700, color: D.textPrimary, whiteSpace: 'nowrap' }}>
            FCC Workbench
          </Typography>
        </Stack>

        <Divider orientation="vertical" flexItem sx={{ borderColor: D.chromeBorder, mr: 0.5, display: { xs: 'none', md: 'block' } }} />

        {/* ── Mode toggle buttons ── */}
        <ModeButton
          icon={Person}
          label={isMobile ? 'Business' : 'Business Workspace'}
          active={mode === 'auto'}
          onClick={() => handleModeChange('auto')}
        />
        <ModeButton
          icon={Engineering}
          label={isMobile ? 'Technical' : 'Technical Workspace'}
          active={mode === 'expert'}
          onClick={() => handleModeChange('expert')}
        />

        <Button
          size="small"
          startIcon={<Article sx={{ fontSize: 14 }} />}
          onClick={() => setJourneyGuideOpen(true)}
          sx={{
            ml: 1,
            height: 28,
            px: 1.25,
            fontSize: 11,
            textTransform: 'none',
            borderRadius: 0,
            color: D.textMuted,
            border: `1px solid ${D.chromeBorder}`,
            '&:hover': {
              color: D.textPrimary,
              borderColor: D.orange,
              bgcolor: 'rgba(255,255,255,0.03)',
            },
          }}
        >
          {isMobile ? 'Guide' : 'Journey Guide'}
        </Button>

        <Button
          size="small"
          startIcon={<Analytics sx={{ fontSize: 14 }} />}
          onClick={() => setExecutiveSummaryOpen(true)}
          sx={{
            ml: 0.5,
            height: 28,
            px: 1.25,
            fontSize: 11,
            textTransform: 'none',
            borderRadius: 0,
            color: '#fde68a',
            border: '1px solid rgba(253, 230, 138, 0.38)',
            bgcolor: 'rgba(255,255,255,0.03)',
            '&:hover': {
              color: '#fff7ed',
              borderColor: '#fdba74',
              bgcolor: 'rgba(255,255,255,0.05)',
            },
          }}
        >
          {isMobile ? 'Summary' : 'Executive Summary'}
        </Button>

        {/* ── Expert-only controls (hidden in AutoBuild mode) ── */}
        {mode === 'expert' && (
          <>
            <Divider orientation="vertical" flexItem sx={{ borderColor: D.chromeBorder, mx: 1, display: { xs: 'none', xl: 'block' } }} />

            <TextField
              size="small" value={experimentName} onChange={(e) => setExperimentName(e.target.value)} variant="outlined"
              sx={{
                width: { xs: 132, sm: 160, xl: 180 },
                display: { xs: 'none', sm: 'block' },
                '& .MuiOutlinedInput-root': {
                  height: 28, fontSize: 12,
                  bgcolor: 'rgba(255,255,255,0.03)', color: D.textPrimary, borderRadius: 0,
                  '& fieldset': { borderColor: D.chromeBorder },
                  '&:hover fieldset': { borderColor: D.textMuted },
                  '&.Mui-focused fieldset': { borderColor: D.orange },
                },
                '& input': { py: 0, px: 1.5 },
              }}
            />

            {hasPipelineContext && activePipelineName && (
              <Chip
                size="small"
                label={`Pipeline: ${activePipelineName}`}
                sx={{
                  ml: 1, height: 24, fontSize: 10.5,
                  color: D.orange,
                  bgcolor: 'transparent',
                  border: `1px solid ${T.accentBorder}`,
                  borderRadius: 0,
                  flexShrink: 0,
                  display: { xs: 'none', lg: 'inline-flex' },
                }}
              />
            )}

            <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, maxWidth: 300, mx: 2, display: { xs: 'none', lg: 'flex' } }}>
              <LinearProgress
                variant="determinate" value={progressPct}
                sx={{ flex: 1, height: 4, borderRadius: 0, bgcolor: 'rgba(255,255,255,0.08)', '& .MuiLinearProgress-bar': { bgcolor: D.orange, borderRadius: 0 } }}
              />
              <Typography sx={{ fontSize: 10, color: D.textMuted, flexShrink: 0 }}>{doneCount}/{progressSteps.length}</Typography>
            </Stack>

            <Box sx={{ flex: 1, minWidth: 0 }} />

            <ToggleButtonGroup
              size="small" value={persona} exclusive onChange={(_, v) => v && setPersona(v)}
              sx={{
                display: { xs: 'none', md: 'inline-flex' },
                '& .MuiToggleButton-root': {
                  height: 28, px: 1.5, fontSize: 11, textTransform: 'none',
                  color: D.textMuted, border: `1px solid ${D.chromeBorder}`, borderRadius: 0,
                  '&.Mui-selected': { bgcolor: 'rgba(255,255,255,0.03)', color: D.orange, borderColor: D.orange },
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                },
              }}
            >
              <ToggleButton value="business"><Person sx={{ fontSize: 13, mr: 0.5 }} /> Plain Language</ToggleButton>
              <ToggleButton value="technical"><Settings sx={{ fontSize: 13, mr: 0.5 }} /> Technical Detail</ToggleButton>
            </ToggleButtonGroup>

            <Divider orientation="vertical" flexItem sx={{ borderColor: D.chromeBorder, mx: 1, display: { xs: 'none', md: 'block' } }} />

            <Tooltip title="Reload data from server">
              <IconButton size="small" onClick={() => loadDatasets({ sync: true })} sx={{ color: D.textMuted, borderRadius: 0, '&:hover': { color: D.textPrimary, bgcolor: 'rgba(255,255,255,0.03)' } }}>
                <Refresh sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Save Snapshot">
              <IconButton size="small" onClick={handleSnapshot} sx={{ color: D.textMuted, borderRadius: 0, '&:hover': { color: D.textPrimary, bgcolor: 'rgba(255,255,255,0.03)' } }}>
                <SaveAlt sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Run Quality Check">
              <IconButton size="small" onClick={handleQualityRun} sx={{ color: D.textMuted, borderRadius: 0, '&:hover': { color: D.textPrimary, bgcolor: 'rgba(255,255,255,0.03)' } }}>
                <PlayArrow sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Pipeline Launcher">
              <IconButton size="small" onClick={() => setPipelineLauncherOpen(true)} sx={{ color: D.textMuted, borderRadius: 0, '&:hover': { color: D.textPrimary, bgcolor: 'rgba(255,255,255,0.03)' } }}>
                <AccountTree sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={viewportWidth < contextMinViewport ? 'Status panel is hidden on narrow widths' : showContext ? 'Hide Status Panel' : 'Show Status Panel'}>
              <IconButton size="small" onClick={() => setShowContext((v) => !v)}
                disabled={viewportWidth < contextMinViewport}
                sx={{
                  color: showContextPanel ? D.orange : D.textMuted,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                  '&.Mui-disabled': { color: D.textSoft },
                }}>
                <ViewSidebar sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </>
        )}

        {/* AutoBuild: spacer to fill remaining width */}
        {mode === 'auto' && <Box sx={{ flex: 1 }} />}
      </Box>

      {/* ══ CONTENT AREA ════════════════════════════════════════════════════ */}

      <AnimatePresence mode="wait" initial={false}>
        {workspaceLoading && mode === 'auto' && (
          <Box
            key="business-workspace-loading"
            component={motion.div}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: { xs: 2, md: 3 },
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                width: 'min(560px, 100%)',
                p: { xs: 3, md: 4 },
                borderRadius: 0,
                borderColor: D.border,
                textAlign: 'center',
                bgcolor: D.panelAlt,
              }}
            >
              <Stack spacing={1.5} alignItems="center">
                <CircularProgress size={28} sx={{ color: D.orange }} />
                <Typography sx={{ fontSize: 18, fontWeight: 800, color: D.textBody }}>
                  Loading Business Workspace
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: D.textSoft, maxWidth: 420 }}>
                  Preparing the guided business flow, plain-language readout, and decision-oriented assistant panels.
                </Typography>
              </Stack>
            </Paper>
          </Box>
        )}

        {/* AutoBuild mode */}
        {!workspaceLoading && mode === 'auto' && (
          <Box
            key="auto-mode"
            component={motion.div}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            sx={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', p: { xs: 1, md: 2.5 } }}
          >
            {renderAutoBuild ? renderAutoBuild({
              staleCard: autoBuildStaleCard,
              onStaleAction: handleAutoBuildStaleAction,
              activePipelineId,
            }) : null}
          </Box>
        )}

        {/* Expert mode */}
        {mode === 'expert' && (
          <Box
            key="expert-mode"
            component={motion.div}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            sx={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}
          >

          {!isMobile && (
          <>
          {/* ── LEFT NAV RAIL ── */}
          <Box
            component={motion.div}
            animate={{ width: effectiveRailCollapsed ? D.railCollapsedW : D.railW }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            sx={{
              bgcolor: D.rail,
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              minWidth: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              borderRight: `1px solid ${D.railBorder}`,
            }}
          >
            <Box sx={{ px: effectiveRailCollapsed ? 1 : 2.5, pt: 1.6, pb: 1.2, display: 'flex', alignItems: 'center', justifyContent: effectiveRailCollapsed ? 'center' : 'space-between' }}>
              {!effectiveRailCollapsed && (
                <Typography sx={{ fontSize: 9, fontWeight: 700, color: D.textMuted, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                  ML Pipeline
                </Typography>
              )}
              <Tooltip title={effectiveRailCollapsed ? 'Expand ML pipeline' : 'Collapse ML pipeline'}>
                <IconButton
                  size="small"
                  onClick={() => setRailCollapsed((v) => !v)}
                  disabled={forceRailCollapse}
                  sx={{ color: D.textMuted, bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}
                >
                  {effectiveRailCollapsed ? <ChevronRight sx={{ fontSize: 14 }} /> : <ChevronLeft sx={{ fontSize: 14 }} />}
                </IconButton>
              </Tooltip>
            </Box>

            <Box sx={{ flex: 1 }}>
              {STEPS.map((step, idx) => {
                const status      = stepStatus(step.id, stepCtx);
                const isActive    = activeStep === step.id;
                const isLocked    = status === 'locked';
                const isStale     = status === 'stale';
                const canNavigate = ALLOW_LOCKED_NAV || !isLocked;
                const isDone      = status === 'done';
                const Icon        = step.icon;
                return (
                  <Box key={step.id}>
                    {idx > 0 && (
                      <Box sx={{ ml: effectiveRailCollapsed ? '41px' : '36px', width: 1.5, height: 12, bgcolor: isDone ? D.done : isStale ? D.warning : 'rgba(255,255,255,0.05)' }} />
                    )}
                    <Tooltip title={effectiveRailCollapsed ? (persona === 'business' ? step.biz : step.label) : ''} placement="right">
                      <Box
                        component={motion.div}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.16, delay: idx * 0.015 }}
                        onClick={() => canNavigate && openWorkbenchStep(step.id)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: effectiveRailCollapsed ? 0 : 1.5,
                          px: effectiveRailCollapsed ? 1.25 : 2,
                          py: 1.25,
                          justifyContent: effectiveRailCollapsed ? 'center' : 'flex-start',
                          cursor: canNavigate ? 'pointer' : 'default',
                          bgcolor: isActive ? D.railActive : 'transparent',
                          borderLeft: `3px solid ${isActive ? D.orange : 'transparent'}`,
                          transition: 'all 0.12s ease',
                          '&:hover': canNavigate ? { bgcolor: D.railHover } : {},
                          position: 'relative',
                        }}
                      >
                        <Box sx={{
                          width: 28, height: 28, borderRadius: 0, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor:  isDone ? 'rgba(46,125,50,0.18)' : isStale ? 'rgba(163,111,0,0.18)' : isActive ? 'rgba(208,74,2,0.2)' : isLocked ? D.locked : 'rgba(255,255,255,0.05)',
                          border: `1.5px solid ${isDone ? D.done : isStale ? D.warning : isActive ? D.orange : isLocked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)'}`,
                        }}>
                          {isDone    ? <CheckCircle sx={{ fontSize: 14, color: D.done }} />
                          : isStale  ? <Refresh sx={{ fontSize: 12, color: D.warning }} />
                          : isLocked ? <Lock sx={{ fontSize: 11, color: D.textMuted }} />
                          :            <Icon sx={{ fontSize: 13, color: isActive ? D.orange : D.textMuted }} />}
                        </Box>
                        {!effectiveRailCollapsed && (
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 12.5, fontWeight: isActive ? 700 : 500, lineHeight: 1.3, color: isLocked ? D.lockedText : isActive ? D.textPrimary : D.textMuted }}>
                              {persona === 'business' ? step.biz : step.label}
                            </Typography>
                            <Typography sx={{ fontSize: 10, lineHeight: 1.3, display: 'block', color: isDone ? D.done : isStale ? D.warning : isLocked ? D.lockedText : D.textMuted }}>
                              {isDone ? 'Done' : isStale ? 'Needs rerun' : isLocked ? 'Blocked' : isActive ? 'Current' : 'Pending'}
                            </Typography>
                          </Box>
                        )}
                        {isActive && !effectiveRailCollapsed && (
                          <Box sx={{ position: 'absolute', right: 8, width: 5, height: 5, borderRadius: 0, bgcolor: D.orange }} />
                        )}
                      </Box>
                    </Tooltip>
                  </Box>
                );
              })}
            </Box>

            {/* Rail footer */}
            <Box sx={{ px: effectiveRailCollapsed ? 1 : 2.5, py: 2, borderTop: `1px solid ${D.railBorder}` }}>
              {!effectiveRailCollapsed && datasets.length > 0 && (
                <Stack spacing={0.4} sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 10, color: D.textMuted }}>{datasets.length} table{datasets.length !== 1 ? 's' : ''} loaded</Typography>
                  {masterDataset && <Typography sx={{ fontSize: 10, color: D.textMuted }}>Master: {fmt(masterDataset.row_count)} rows</Typography>}
                  {targetColumn && (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: D.panel, px: 1, py: 0.25, borderRadius: 0, border: `1px solid ${T.successBorder}` }}>
                      <Flag sx={{ fontSize: 9, color: D.done }} />
                      <Typography sx={{ fontSize: 10, color: D.done, fontWeight: 600 }}>{targetColumn}</Typography>
                    </Box>
                  )}
                  {activeModelRun && (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: D.panel, px: 1, py: 0.25, borderRadius: 0, border: `1px solid ${T.accentBorder}` }}>
                      <ModelTraining sx={{ fontSize: 9, color: D.orange }} />
                      <Typography sx={{ fontSize: 10, color: D.orange, fontWeight: 600 }}>
                        {(activeModelRun.algorithm || activeModelRun.algorithm_id || '').replace(/_/g, ' ')} AUC{' '}
                        {(activeModelRun.auc ?? activeModelRun.results?.metrics?.roc_auc)?.toFixed(3) ?? '-'}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}
              <Button
                size="small" fullWidth variant="outlined"
                startIcon={<DeleteForever sx={{ fontSize: 14 }} />}
                onClick={handleReset} disabled={resetting}
                sx={{
                  fontSize: 10, textTransform: 'none', color: D.textMuted,
                  borderColor: D.railBorder,
                  '&:hover': { borderColor: D.error, color: D.error, bgcolor: 'rgba(180,35,24,0.08)' },
                }}
              >
                {effectiveRailCollapsed ? '' : (resetting ? 'Resetting...' : 'Start Fresh')}
              </Button>
            </Box>
          </Box>

          </>
          )}

          {isMobile && (
            <Drawer
              anchor="left"
              variant="temporary"
              open={mobileRailOpen}
              onClose={() => setMobileRailOpen(false)}
              ModalProps={{ keepMounted: true }}
              PaperProps={{
                sx: {
                  width: Math.min(D.railW, Math.round(viewportWidth * 0.82)),
                  maxWidth: '84vw',
                  bgcolor: D.rail,
                  borderRight: `1px solid ${D.railBorder}` ,
                  color: D.textPrimary,
                },
              }}
            >
              {renderStepRail(false, () => setMobileRailOpen(false))}
            </Drawer>
          )}

          {/* ── MAIN CANVAS ── */}
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {!isDashboard && (
              <Box sx={{ px: { xs: 1.5, md: 3 }, py: 1.5, bgcolor: D.panel, borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexShrink: 0, flexWrap: 'wrap' }}>
                <Stack spacing={0.2} sx={{ minWidth: 0, overflow: 'hidden' }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, overflow: 'hidden' }}>
                    <Typography sx={{ fontSize: 10.5, color: D.textSoft, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, display: { xs: 'none', sm: 'block' } }}>
                      {experimentName}
                    </Typography>
                    <ChevronRight sx={{ fontSize: 12, color: D.textSoft, display: { xs: 'none', sm: 'block' } }} />
                    <Typography sx={{ fontSize: 10.5, color: D.orange, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {stepHeaderLabel}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, color: D.textBody, lineHeight: 1.1 }}>
                    {stepHeaderLabel}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: D.textSoft, maxWidth: 760, lineHeight: 1.55, fontWeight: 500 }}>
                    {stepHeaderDescription}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {validActivePipelineId ? (
                    <>
                      <Chip
                        size="small"
                        label={toRunRef(validActivePipelineId)}
                        sx={{
                          height: 22,
                          fontSize: 10,
                          fontWeight: 700,
                          bgcolor: D.panel,
                          color: D.orange,
                          border: `1px solid ${T.accentBorder}`,
                          borderRadius: 0,
                        }}
                      />
                      <Chip
                        size="small"
                        label={`${progressPct}% complete`}
                        sx={{
                          height: 22,
                          fontSize: 10,
                          fontWeight: 700,
                          bgcolor: D.panelAlt,
                          color: D.textBody,
                          border: `1px solid ${D.border}`,
                          borderRadius: 0,
                        }}
                      />
                    </>
                  ) : null}

                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!previousStep}
                    startIcon={<ChevronLeft sx={{ fontSize: 14 }} />}
                    onClick={() => previousStep && openWorkbenchStep(previousStep.id)}
                    sx={{
                      height: 30,
                      px: 1.25,
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: 'none',
                      borderRadius: 0,
                      borderColor: D.border,
                      color: D.textBody,
                    }}
                  >
                    {previousStep ? `Back to ${persona === 'business' ? previousStep.biz : previousStep.label}` : 'Back'}
                  </Button>

                  {primaryCta && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={primaryCta.stale ? <Refresh sx={{ fontSize: 14 }} /> : undefined}
                      endIcon={primaryCta.stale ? undefined : <ChevronRight />}
                      onClick={() => openWorkbenchStep(primaryCta.target)}
                      sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, height: 30, px: 1.35, fontSize: 11.5, fontWeight: 700, textTransform: 'none', borderRadius: 0, boxShadow: 'none' }}
                    >
                      {primaryCta.stale ? `${primaryCta.label}: ${primaryCta.detail}` : `Continue to ${primaryCta.detail}`}
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            <Box id="fcc-workbench-main-canvas" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: activeStep === 'master' ? 'auto' : 'hidden', p: isDashboard ? 0 : activeStep === 'master' ? { xs: 0.5, md: 1 } : { xs: 1, md: 2 } }}>
              {businessStaleCard ? (
                <BusinessStaleStepCard
                  currentStepLabel={businessStaleCard.currentStepLabel}
                  whatChanged={businessStaleCard.whatChanged}
                  whyRerun={businessStaleCard.whyRerun}
                  nextAction={businessStaleCard.nextAction}
                  actionLabel={businessStaleCard.actionLabel}
                  onAction={handleBusinessStaleAction}
                />
              ) : null}
              {!businessStaleCard && staleBannerMessage && <Alert severity="warning" sx={{ mb: 2, borderRadius: 0 }}>{staleBannerMessage}</Alert>}
              {guardMessage && <Alert severity="warning" sx={{ mb: 2, borderRadius: 0 }}>{guardMessage}</Alert>}
              <AnimatePresence mode="wait" initial={false}>
                <Box
                  key={activeStep}
                  component={motion.div}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  {activeStep === 'pipelines' && (
                    <WorkbenchPipelinesScreen
                      persona={persona} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName}
                      onPipelineActivated={activatePipeline} onCreateNewPipeline={handleStartNewPipeline}
                      onPipelineDeleted={handlePipelineDeleted}
                      onResumePipeline={openPipelineRoute} onOpenStep={(stepId, pipeline) => (
                        pipeline
                          ? openPipelineRoute(pipeline, { step: stepId })
                          : openWorkbenchStep(stepId)
                      )}
                      activeEnvironmentName={currentEnvId}
                      selectionNotice={pipelineSelectionNotice}
                      artefacts={{ modelRun, validationReport, registryEntry }}
                    />
                  )}
                  {activeStep === 'data' && (
                    <DataUploadScreen persona={persona} datasets={datasets} onDatasetsRefresh={loadDatasets}
                      activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                      onCreatePipeline={createPipelineRun}
                      onResumePipeline={openPipelineRoute}
                      onWorkspaceReset={performWorkspaceReset}
                    />
                  )}
                  {activeStep === 'master' && (
                    <MasterDatasetScreen persona={persona} datasets={datasets} masterDataset={masterDataset}
                      onBuildComplete={handleMasterBuildComplete} onStepAdvance={(nextStep = 'target') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })} onStepBack={(prevStep = 'data') => openWorkbenchStep(prevStep, { skipGuardRedirect: true })} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                      initialCurrentStepId={masterCurrentStepId}
                      onCurrentStepChange={setMasterCurrentStepId}
                    />
                  )}
                  {activeStep === 'target' && (
                    <TargetVariableScreen persona={persona} masterDataset={masterDataset} targetColumn={targetColumn}
                      onStepAdvance={(nextStep = 'eda') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })}
                      onTargetChange={handleTargetChange} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                      initialActiveTab={targetActiveTab}
                      onActiveTabChange={setTargetActiveTab}
                    />
                  )}
                  {activeStep === 'eda' && (
                    <EDAScreen persona={persona} masterDataset={masterDataset} datasets={datasets} targetColumn={targetColumn} edaDone={edaDone} onEdaDone={handleEdaComplete}
                      initialTab={edaActiveTab}
                      onTabChange={setEdaActiveTab}
                    />
                  )}
                  {activeStep === 'preprocess' && (
                    <PreprocessingWorkbench
                      persona={persona} datasets={datasets} masterDataset={masterDataset} preprocessedDataset={preprocessDataset}
                      targetColumn={targetColumn} suggestions={preprocessPlan} steps={preprocessSteps}
                      onStepsChange={handlePreprocessStepsChange} onPreview={handlePreprocessPreview} onRun={handlePreprocessRun}
                      preview={preprocessPreview} onMasterBuild={handleBuildMaster}
                      activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {activeStep === 'model' && (
                    <ModelTrainingPanel persona={persona} preprocessedDataset={preprocessDataset}
                      masterDataset={masterDataset} targetColumn={targetColumn}
                      onModelComplete={handleModelComplete} onOpenReport={handleOpenReport}
                      initialActiveTab={modelActiveTab}
                      onActiveTabChange={setModelActiveTab}
                    />
                  )}
                  {activeStep === 'validation' && (
                    <ModelValidationScreen persona={persona} jobId={activeModelRun?.job_id || modelRun?.job_id || validationReport?.job_id || validationReport?.run_id || nestedRunId(registryEntry)}
                      datasetId={preprocessDataset?.dataset_id || masterDataset?.dataset_id || null}
                      activeModelRun={activeModelRun || modelRun}
                      validationReport={validationReport}
                      initialActiveTab={validationActiveTab}
                      onActiveTabChange={setValidationActiveTab}
                      onActiveRunChange={handleValidationActiveRunChange}
                      onValidationComplete={handleValidationStateChange}
                      onTrainAnotherModel={() => openWorkbenchStep('model', { skipGuardRedirect: true })}
                      onContinueToRelease={() => openWorkbenchStep('registry', { skipGuardRedirect: true })}
                      actionsDisabled={false}
                      staleWarningMessage={staleStepSet.has('validation') ? staleMessageForStep('validation') : ''}
                    />
                  )}
                  {activeStep === 'registry' && (
                    <ModelReleaseScreen modeStep="registry" persona={persona}
                      uploadedDatasets={datasets} masterDataset={masterDataset}
                      targetColumn={targetColumn} preprocessedDataset={preprocessDataset}
                      activeModelRun={activeModelRun || modelRun} validationReport={validationReport}
                      registryEntry={registryEntry}
                      onRegistered={handleRegistered}
                      onDeploy={handleDeploy}
                      onViewReport={handleOpenReport}
                      onBack={() => openWorkbenchStep('validation', { skipGuardRedirect: true })}
                      actionsDisabled={staleStepSet.has('registry')}
                      actionsMessage={staleMessageForStep('registry')}
                    />
                  )}
                  {activeStep === 'reports' && (
                    <RunReport
                      runId={reportRunId || activeModelRun?.job_id || modelRun?.job_id || ''}
                      pipelineId={validActivePipelineId || null}
                      onRunIdChange={setReportRunId}
                    />
                  )}
                  {activeStep === 'dashboard' && (
                    <DeploymentDashboard persona={persona} activeModelRun={activeModelRun}
                      activePipelineId={validActivePipelineId}
                      activePipelineName={activePipelineName}
                      savedDashboardState={savedDashboardState}
                      validationReport={validationReport} registryEntry={registryEntry} onBack={() => openWorkbenchStep('registry', { skipGuardRedirect: true })}
                      actionsDisabled={staleStepSet.has('dashboard')}
                      actionsMessage={staleMessageForStep('dashboard')}
                    />
                  )}
                </Box>
              </AnimatePresence>
            </Box>
          </Box>

          {/* ── RIGHT CONTEXT PANEL ── */}
          {showContextPanel && (
            <ContextPanel
              datasets={datasets} masterDataset={masterDataset} targetColumn={targetColumn}
              preprocessDataset={preprocessDataset} modelRun={modelRun} validationReport={validationReport}
              registryEntry={registryEntry} qualityScore={qualityScore}
              stepStatuses={Object.fromEntries(STEPS.map((s) => [s.id, stepStatus(s.id, stepCtx)]))}
              activeStep={activeStep} panelWidth={contextPanelWidth} latestChange={latestDependencyChange}
              hasPipelineContext={hasPipelineContext}
              onClose={() => setShowContext(false)}
            />
          )}
        </Box>
      )}
      </AnimatePresence>

      <Dialog open={resetConfirmOpen} onClose={() => !resetting && setResetConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Start Fresh</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography sx={{ fontSize: 13, color: D.textSoft }}>
              Start fresh for this environment?
            </Typography>
            <Alert severity="warning" sx={{ py: 0.5 }}>
              This removes uploaded tables, generated datasets, reports, and saved pipeline progress for this environment.
            </Alert>
            <Typography sx={{ fontSize: 12, color: D.textSoft }}>
              This cannot be undone. You will need to upload the source files again.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25 }}>
          <Button
            variant="text"
            onClick={() => setResetConfirmOpen(false)}
            disabled={resetting}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={confirmReset}
            disabled={resetting}
            sx={{ textTransform: 'none', bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover } }}
          >
            {resetting ? 'Resetting...' : 'Start Fresh'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Pipeline Launcher Dialog ─────────────────────────────────────────── */}
      <Dialog open={pipelineLauncherOpen} onClose={() => setPipelineLauncherOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Continue FCC Run</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography sx={{ fontSize: 13, color: D.textSoft }}>Choose an existing run to resume or create a new run for this workbench session.</Typography>
            {defaultResumePipeline
              ? (
                <Alert severity={String(defaultResumePipeline?.run_status || '').toLowerCase() === 'stale' ? 'warning' : 'info'} sx={{ py: 0.5 }}>
                  {String(defaultResumePipeline?.run_status || '').toLowerCase() === 'stale' ? 'Run needs rerun:' : 'Unfinished run found:'} <strong>{defaultResumePipeline.name}</strong>
                  {defaultResumePipeline.current_step_label ? ` - ${defaultResumePipeline.current_step_label}` : ''}
                  {defaultResumePipeline.latest_change?.message ? ` - ${defaultResumePipeline.latest_change.message}` : ''}
                </Alert>
              )
              : <Alert severity="success" sx={{ py: 0.5 }}>No unfinished run found. Start a new run or review past runs in Run Center.</Alert>
            }
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25 }}>
          <Button variant="contained" startIcon={<Restore sx={{ fontSize: 15 }} />}
            disabled={!defaultResumePipeline}
            onClick={() => defaultResumePipeline && openPipelineRoute(defaultResumePipeline)}
            sx={{ textTransform: 'none', bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover } }}
          >
            Resume Run
          </Button>
          <Button variant="outlined" startIcon={<Add sx={{ fontSize: 15 }} />}
            onClick={handleStartNewPipeline} sx={{ textTransform: 'none' }}
          >
            Start New Run
          </Button>
          <Button variant="text" onClick={() => { setPipelineLauncherOpen(false); openWorkbenchStep('pipelines', { skipGuardRedirect: true }); }} sx={{ textTransform: 'none' }}>
            View Run Center
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create Pipeline Dialog ───────────────────────────────────────────── */}
      <Dialog open={createPipelineDialogOpen} onClose={() => !creatingPipeline && setCreatePipelineDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Name New Run</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.2}>
            <Typography sx={{ fontSize: 12, color: D.textSoft }}>
              Give this FCC run a unique name. A new run always starts with a clean workspace.
            </Typography>
            <TextField size="small" autoFocus label="Run name"
              value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmCreatePipeline(); } }}
            />
            {newPipelineError && <Alert severity="error" sx={{ py: 0.25 }}>{newPipelineError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25 }}>
          <Button variant="text" onClick={() => setCreatePipelineDialogOpen(false)} disabled={creatingPipeline} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleConfirmCreatePipeline} disabled={creatingPipeline}
            sx={{ textTransform: 'none', bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover } }}
          >
            {creatingPipeline ? 'Creating...' : 'Create Run'}
          </Button>
        </DialogActions>
      </Dialog>

      <ExecutiveIntelligenceSummaryDialog
        open={executiveSummaryOpen}
        onClose={() => setExecutiveSummaryOpen(false)}
        onOpenModule={handleExecutiveModuleOpen}
        context={{
          runId: activeRunId || undefined,
          pipelineId: validActivePipelineId || undefined,
          pipelineName: activePipelineName || undefined,
          source: 'fcc',
        }}
      />

      <AmlJourneyGuideDialog
        open={journeyGuideOpen}
        onClose={() => setJourneyGuideOpen(false)}
        onJumpToStep={(stepId) => {
          if (stepId) {
            openWorkbenchStep(stepId, { skipGuardRedirect: true });
          }
          setJourneyGuideOpen(false);
        }}
      />
    </Box>
  );
};

export default MLOpsWorkbench;

