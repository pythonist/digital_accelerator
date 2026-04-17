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
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box, Button, Chip, CircularProgress, Divider, FormControl, IconButton, InputLabel,
  LinearProgress, MenuItem, Paper, Select,
  Slide, Snackbar,
  Dialog, DialogActions, DialogContent, DialogTitle,
  Drawer, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  AccountTree, Add, Analytics, Article, Build, CheckCircle, ChevronLeft, ChevronRight,
  CloudUpload, Close, Dashboard, DeleteForever, Engineering, Flag, Lock,
  MenuOpen, ModelTraining, Person, PlayArrow, Refresh, Restore, SaveAlt, Settings, Storage,
  Tune, ViewSidebar,
} from '@mui/icons-material';

import mlopsApi               from '../services/mlopsApi';
import DataUploadScreen       from '../components/DataUploadScreen';
import MuleWorkbenchScreen    from '../components/MuleWorkbenchScreen';
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
import StepSummaryModal       from '../components/StepSummaryModal';
import ExecutiveIntelligenceSummaryDialog from '@components/executive_summary/ExecutiveIntelligenceSummaryDialog';
import { SHOW_STEP_GUARDS } from '../utils/uiFlags';
import { derivePipelineStepCompletion, derivePipelineStepStatuses, getManifestStepState, getScreenState } from '../utils/pipelineState';
import { getStepStatus, isPipelineComplete, loadPipelineRun, savePipelineRun, updatePipelineStep } from '../utils/pipelineStorage';
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
const DEFAULT_EXPERIMENT_NAME = '';
const MANUAL_STEP_OVERRIDE_MS = 30000;
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

const FCC_SUMMARY_STEP_MAP = {
  data: 'data_upload',
  master: 'master_dataset',
  target: 'target_variable',
  preprocess: 'preprocessing',
  model: 'model_run',
  validation: 'validation',
  registry: 'registry',
  dashboard: 'live_dashboard',
  reports: 'reports',
  eda: 'eda',
};

const FCC_SUMMARY_STEP_LABELS = {
  data_upload: 'Data Upload',
  master_dataset: 'Master Dataset',
  target_variable: 'Target Variable',
  preprocessing: 'Preprocessing',
  model_run: 'Model Run',
  live_dashboard: 'Live Dashboard',
  reports: 'Reports',
  validation: 'Model Validation',
  registry: 'Model Release',
  eda: 'Explore Data',
};

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

const datasetCacheKeyForEnv = (envId, pipelineType = 'fcc') => `mlops.datasets.cache.${resolvePipelineEnvKey(envId)}.${String(pipelineType || 'fcc').trim().toLowerCase() || 'fcc'}`;

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

const MULE_STEPS = [
  { id: 'data',       label: 'Upload Data',                     biz: 'Upload Data',                     icon: CloudUpload,   desc: 'Load Mule account, customer, transaction, and enrichment data' },
  { id: 'master',     label: 'Master Dataset',                  biz: 'Master Dataset',                  icon: AccountTree,   desc: 'Create the account-level analytical dataset for Mule detection' },
  { id: 'featurestore', label: 'Feature Store',                 biz: 'Feature Store',                   icon: Storage,       desc: 'Generate and review the persisted Mule feature library for this run' },
  { id: 'preprocess', label: 'Preprocessing & Feature Selection',  biz: 'Feature Selection',            icon: Tune,          desc: 'Prune, govern, and transform selected Mule features for training' },
  { id: 'model',      label: 'Model Build',                     biz: 'Model Build',                     icon: ModelTraining, desc: 'Train the Mule detection model using approved features only' },
  { id: 'validation', label: 'Model Output & Validation',       biz: 'Model Output',                    icon: CheckCircle,   desc: 'Review scored accounts, validation metrics, and live mule ring patterns' },
  { id: 'pipelines',  label: 'Pipeline Hub',                    biz: 'Pipelines',                       icon: AccountTree,   desc: 'Resume, run, and manage saved FCC and Mule pipelines' },
];

const getWorkbenchSteps = (pipelineType = 'fcc') => {
  const family = String(pipelineType || 'fcc').trim().toLowerCase() === 'mule' ? 'mule' : 'fcc';
  return family === 'mule' ? MULE_STEPS : STEPS;
};

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

const isWorkbenchStep = (value) => [...STEPS, ...MULE_STEPS].some((step) => step.id === value);

const normalizeWorkbenchRunId = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizePipelineFamily = (value, fallback = '') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'mule' || raw.includes('mule')) return 'mule';
  if (raw === 'fcc' || raw.includes('fcc')) return 'fcc';
  return fallback;
};

const buildWorkbenchRoute = (pipelineId, stepId = 'pipelines') => {
  const normalizedPipelineId = normalizeWorkbenchRunId(pipelineId);
  if (!normalizedPipelineId) return '/mlops/runs';
  const normalizedStep = normalizeWorkbenchStep(stepId) || 'pipelines';
  return `/mlops/runs/${normalizedPipelineId}/${normalizedStep}`;
};

const SlideDownTransition = (props) => <Slide {...props} direction="down" />;

const deriveWorkflowCheckpoint = ({
  pipelineType = 'fcc',
  activeStep,
  datasets,
  masterDataset,
  featureStoreDataset,
  targetColumn,
  edaDone,
  preprocessDataset,
  activeModelRun,
  modelRun,
  validationReport,
  registryEntry,
}) => {
  const isMulePipeline = String(pipelineType || 'fcc').trim().toLowerCase() === 'mule';
  const currentStep = normalizeWorkbenchStep(activeStep);
  const hasDeployment = String(registryEntry?.deployment_id || '').trim().length > 0;
  const hasRegistry = Boolean(registryEntry);
  const hasValidation = Boolean(validationReport);
  const hasModel = String(activeModelRun?.job_id || modelRun?.job_id || '').trim().length > 0;
  const hasPreprocess = Boolean(preprocessDataset);
  const hasFeatureStore = Boolean(featureStoreDataset);
  const hasEda = Boolean(edaDone);
  const hasTarget = String(targetColumn || '').trim().length > 0;
  const hasMaster = Boolean(masterDataset);
  const hasData = Array.isArray(datasets) && datasets.length > 0;

  if (isMulePipeline) {
    if (hasValidation) return 'MULE_OUTPUT_READY';
    if (hasModel) return 'MULE_MODEL_READY';
    if (hasPreprocess) return 'MULE_PREPROCESS_READY';
    if (hasFeatureStore) return 'MULE_FEATURE_STORE_READY';
    if (hasMaster) return 'MULE_MASTER_READY';
    if (hasData) return 'MULE_DATA_READY';
    return 'MULE_SESSION_STARTED';
  }

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

const extractPipelineTrainingJobId = (pipeline = null) => {
  const links = Array.isArray(pipeline?.asset_links) ? pipeline.asset_links.slice() : [];
  const stageWeight = {
    model: 0,
    validation: 1,
    registry: 2,
    workflow_session: 3,
  };
  const sortedLinks = links
    .filter((asset) => String(asset?.asset_kind || '').trim().toLowerCase() === 'training_job')
    .sort((left, right) => {
      const leftStage = String(left?.stage || '').trim().toLowerCase();
      const rightStage = String(right?.stage || '').trim().toLowerCase();
      const leftRank = Object.prototype.hasOwnProperty.call(stageWeight, leftStage) ? stageWeight[leftStage] : 99;
      const rightRank = Object.prototype.hasOwnProperty.call(stageWeight, rightStage) ? stageWeight[rightStage] : 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const leftTs = Date.parse(left?.updated_at || left?.created_at || 0) || 0;
      const rightTs = Date.parse(right?.updated_at || right?.created_at || 0) || 0;
      return rightTs - leftTs;
    });
  return String(sortedLinks[0]?.asset_id || '').trim();
};

// ── Step Lock Logic ───────────────────────────────────────────────────────────
function stepStatus(id, ctx) {
  const {
    pipelineType = 'fcc',
    datasets,
    masterDataset,
    featureStoreDataset,
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
    muleBackendStatus = null,
  } = ctx;
  if (id !== 'pipelines' && !hasPipelineContext) return 'locked';
  const explicitStatus = String(savedStepStatuses?.[id] || '').toLowerCase();
  const isMulePipeline = String(pipelineType || 'fcc').trim().toLowerCase() === 'mule';
  const workspace = muleBackendStatus?.workspace && typeof muleBackendStatus.workspace === 'object'
    ? muleBackendStatus.workspace
    : null;
  const workspaceStageStatuses = workspace?.stage_statuses && typeof workspace.stage_statuses === 'object'
    ? workspace.stage_statuses
    : null;
  const workspaceCurrentStep = normalizeWorkbenchStep(workspace?.run?.current_step || '');
  const backendDataCount = Number(muleBackendStatus?.data?.sources_loaded ?? NaN);
  const hasData = isMulePipeline
    ? ((Number.isFinite(backendDataCount) ? backendDataCount : (datasets || []).length) > 0)
    : ((datasets || []).length > 0 || Boolean(savedStepCompletion?.data));
  const backendMasterBuilt = String(muleBackendStatus?.master?.build_status || '').trim().toLowerCase() === 'built';
  const backendFeatureStoreReady = String(
    muleBackendStatus?.featurestore?.generation_status
    || muleBackendStatus?.featurestore?.feature_store_status
    || '',
  ).trim().toLowerCase() === 'ready';
  const backendPreprocessBuilt = String(muleBackendStatus?.preprocess?.build_status || '').trim().toLowerCase() === 'built';
  const backendModelReady = Boolean(muleBackendStatus?.model?.latest_run?.run_id);
  const backendValidationReady = ['validated', 'ready'].includes(String(muleBackendStatus?.validation?.status || '').trim().toLowerCase())
    || Boolean(muleBackendStatus?.validation?.latest_validation?.validation_run_id);
  const hasMaster = isMulePipeline ? backendMasterBuilt : (Boolean(masterDataset) || Boolean(savedStepCompletion?.master));
  const hasFeatureStore = isMulePipeline ? backendFeatureStoreReady : (Boolean(featureStoreDataset) || Boolean(savedStepCompletion?.featurestore));
  const hasTarget = Boolean(String(targetColumn || '').trim()) || Boolean(savedStepCompletion?.target);
  const hasEda = Boolean(edaDone) || Boolean(savedStepCompletion?.eda);
  const hasPreprocess = isMulePipeline ? backendPreprocessBuilt : (Boolean(preprocessDataset) || Boolean(savedStepCompletion?.preprocess));
  const hasModel = isMulePipeline ? backendModelReady : (Boolean(modelRun) || Boolean(savedStepCompletion?.model));
  const hasValidation = isMulePipeline ? backendValidationReady : (Boolean(validationReport) || Boolean(savedStepCompletion?.validation));
  const hasRegistry = Boolean(registryEntry) || Boolean(savedStepCompletion?.registry);
  if (explicitStatus === 'completed') return 'done';
  if (explicitStatus === 'invalidated') return 'stale';
  if (explicitStatus === 'failed') return 'stale';
  if (explicitStatus === 'in_progress') return 'active';
  if (explicitStatus === 'blocked') {
    if (!isMulePipeline) return 'locked';
    const backendOverridesBlocked = (
      (id === 'master' && hasMaster)
      || (id === 'featurestore' && hasFeatureStore)
      || (id === 'preprocess' && hasPreprocess)
      || (id === 'model' && hasModel)
      || (id === 'validation' && hasValidation)
    );
    if (!backendOverridesBlocked) return 'locked';
  }
  if (isMulePipeline && workspaceStageStatuses && Object.prototype.hasOwnProperty.call(workspaceStageStatuses, id)) {
    const workspaceStatus = String(workspaceStageStatuses[id] || '').trim().toLowerCase();
    if (workspaceStatus === 'completed') return 'done';
    if (workspaceStatus === 'failed' || workspaceStatus === 'stale') return 'stale';
    if (workspaceStatus === 'blocked') return 'locked';
    if (workspaceStatus === 'in_progress') return 'active';
    if (id === 'pipelines') return 'active';
    return workspaceCurrentStep === id ? 'active' : 'locked';
  }
  let baseStatus = 'locked';
  if (isMulePipeline) {
    switch (id) {
      case 'data':       baseStatus = hasData ? 'done' : 'active'; break;
      case 'pipelines':  baseStatus = 'active'; break;
      case 'master':     baseStatus = !hasData ? 'locked' : hasMaster ? 'done' : 'active'; break;
      case 'featurestore': baseStatus = !hasMaster ? 'locked' : hasFeatureStore ? 'done' : 'active'; break;
      case 'preprocess': baseStatus = !hasFeatureStore ? 'locked' : hasPreprocess ? 'done' : 'active'; break;
      case 'model':      baseStatus = !hasPreprocess ? 'locked' : hasModel ? 'done' : 'active'; break;
      case 'validation': baseStatus = !hasModel ? 'locked' : hasValidation ? 'done' : 'active'; break;
      default:           baseStatus = 'locked';
    }
    const staleSet = new Set((staleSteps || []).map((step) => String(step)));
    if (baseStatus === 'done' && staleSet.has(String(id))) return 'stale';
    return baseStatus;
  }
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
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  const { activeEnv, setActiveTool } = useAppContext();
  const currentEnvId = useMemo(() => resolvePipelineEnvKey(activeEnv), [activeEnv]);
  const normalizedRouteRunId = useMemo(() => normalizeWorkbenchRunId(routeRunId), [routeRunId]);
  const normalizedRouteStep = useMemo(() => normalizeWorkbenchStep(routeStepId), [routeStepId]);
  const routeRegistryHandoff = useMemo(() => {
    const handoff = location?.state?.registryHandoff;
    return handoff && typeof handoff === 'object' ? handoff : null;
  }, [location?.state]);
  const routePipelineTypeHint = useMemo(() => normalizePipelineFamily(
    location?.state?.pipeline_type
      || location?.state?.model_family
      || location?.state?.pipeline?.pipeline_type
      || location?.state?.pipeline?.model_family
      || '',
  ), [location?.state]);
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
  const localPipelineSyncPausedRef = useRef(false);
  const autoResumeKeyRef = useRef('');
  const previousEnvIdRef = useRef(currentEnvId);
  const routeResumeRef = useRef('');
  const routeHydrationRef = useRef('');
  const manualStepSelectionRef = useRef({ pipelineId: null, step: '', ts: 0 });
  const workflowSessionFetchKeyRef = useRef('');
  const activePipelineRef = useRef({ pipeline_id: null, name: '', workflow_session_id: null, pipeline_type: '' });
  const resumeInProgressRef = useRef(false);
  const muleWorkspaceStepRestoreRef = useRef('');
  const invalidationResetSignatureRef = useRef('');
  const screenSaveSignatureRef = useRef({});
  const screenSaveInFlightRef = useRef({});
  const screenSaveDisabledPipelineRef = useRef(new Set());

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
  const [pipelineLauncherOpen, setPipelineLauncherOpen] = useState(false);
  const [savedPipelines,  setSavedPipelines]  = useState([]);
  const [savedPipelinesLoaded, setSavedPipelinesLoaded] = useState(false);
  const [activePipelineId,   setActivePipelineId]   = useState(normalizedRouteRunId || savedPipelineSession.pipeline_id || null);
  const [activePipelineName, setActivePipelineName] = useState(savedPipelineSession.name || '');
  const [activePipelineMeta, setActivePipelineMeta] = useState(null);
  const [savedLocalPipelineRun, setSavedLocalPipelineRun] = useState(null);
  const [summaryOverlayStep, setSummaryOverlayStep] = useState('');
  const [stepDirtyMap, setStepDirtyMap] = useState({});
  const [pipelineSelectionNotice, setPipelineSelectionNotice] = useState('');
  const [createPipelineDialogOpen, setCreatePipelineDialogOpen] = useState(false);
  const [newPipelineName,  setNewPipelineName]  = useState('');
  const [newPipelineType, setNewPipelineType] = useState('fcc');
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineError, setNewPipelineError] = useState('');
  const [floatingNotice, setFloatingNotice] = useState({ open: false, message: '', severity: 'warning' });
  const floatingNoticeSignatureRef = useRef('');

  const activeSavedPipeline = useMemo(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return null;
    if (Number(activePipelineMeta?.pipeline_id || 0) === pipelineId) {
      return activePipelineMeta;
    }
    return (savedPipelines || []).find((row) => Number(row?.pipeline_id) === pipelineId) || null;
  }, [activePipelineId, activePipelineMeta, savedPipelines]);

  const persistedPipelineTypeHint = useMemo(() => {
    const scopedSessionPipelineId = Number(savedPipelineSession?.pipeline_id || 0) || null;
    if (normalizedRouteRunId && scopedSessionPipelineId && scopedSessionPipelineId !== Number(normalizedRouteRunId)) {
      return '';
    }
    return normalizePipelineFamily(savedPipelineSession?.pipeline_type || '');
  }, [normalizedRouteRunId, savedPipelineSession]);

  const activePipelineType = useMemo(() => {
    const routeTargetsDifferentPipeline = Boolean(
      normalizedRouteRunId
      && Number(activePipelineId || 0)
      && Number(normalizedRouteRunId) !== Number(activePipelineId || 0),
    );
    const resolvedFromActive = normalizePipelineFamily(
      activeSavedPipeline?.pipeline_type
      || activeSavedPipeline?.model_family
      || activePipelineMeta?.pipeline_type
      || activePipelineMeta?.model_family
      || activePipelineRef.current?.pipeline_type
      || workflowSessionRef.current?.pipeline_type
      || '',
    );
    if (routeTargetsDifferentPipeline) {
      return routePipelineTypeHint || persistedPipelineTypeHint || '';
    }
    return resolvedFromActive || routePipelineTypeHint || persistedPipelineTypeHint || 'fcc';
  }, [
    activePipelineId,
    activePipelineMeta,
    activeSavedPipeline,
    normalizedRouteRunId,
    persistedPipelineTypeHint,
    routePipelineTypeHint,
  ]);

  const datasetCacheKey = useMemo(() => datasetCacheKeyForEnv(currentEnvId, activePipelineType), [activePipelineType, currentEnvId]);

  // ── Pipeline state ──────────────────────────────────────────────────────────
  const [datasets,          setDatasets]          = useState([]);
  const [masterDataset,     setMasterDataset]     = useState(null);
  const [featureStoreDataset, setFeatureStoreDataset] = useState(null);
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
  const [muleBackendStatus, setMuleBackendStatus] = useState(null);

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

  const isMasterDatasetSnapshot = useCallback((dataset) => {
    const datasetType = String(dataset?.dataset_type || '').trim().toLowerCase();
    return datasetType === 'master_dataset' || datasetType.startsWith('master');
  }, []);

  const isPreprocessDatasetSnapshot = useCallback((dataset) => {
    const datasetType = String(dataset?.dataset_type || '').trim().toLowerCase();
    return datasetType === 'preprocess_dataset'
      || datasetType === 'preprocessed_dataset'
      || datasetType === 'preprocessed'
      || datasetType.startsWith('preprocess');
  }, []);

  const compactDatasetSnapshot = useCallback((dataset) => {
    if (!dataset || typeof dataset !== 'object') return null;
    const datasetId = Number(dataset?.dataset_id || 0) || null;
    return {
      dataset_id: datasetId,
      pipeline_id: Number(dataset?.pipeline_id || 0) || null,
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
      label: run.label || run.model_name || '',
      model_name: run.model_name || run.label || '',
      algorithm: run.algorithm || run.algorithm_id || '',
      algorithm_id: run.algorithm_id || run.algorithm || '',
      auc: run.auc ?? metrics?.roc_auc ?? null,
      threshold: run.threshold ?? metrics?.optimal_threshold ?? null,
      selected_threshold: run.selected_threshold ?? run.threshold ?? metrics?.optimal_threshold ?? null,
      grain: run.grain || metrics?.grain || null,
      trained_at: run.trained_at || results?.trained_at || null,
      target_column: run.target_column || results?.target_column || null,
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

  const restoreWorkflowRuntimeState = useCallback((session, availableDatasets = [], options = {}) => {
    const currentState = session?.current_state?.mlops_state || {};
    const stableState = session?.last_stable_state?.mlops_state || {};
    const mlopsState = Object.keys(currentState).length ? currentState : stableState;
    if (!mlopsState || typeof mlopsState !== 'object') return;
    const routePreferredStep = normalizedRouteStep && isWorkbenchStep(normalizedRouteStep) ? normalizedRouteStep : '';
    const suppressStepRestore = Boolean(options?.suppressStepRestore || routePreferredStep);

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

    const restoredFeatureStore = lookupDataset(mlopsState?.feature_store_dataset_id, mlopsState?.feature_store_dataset);
    if (restoredFeatureStore) setFeatureStoreDataset(restoredFeatureStore);

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
        selected_threshold: restoredActiveRun.selected_threshold ?? restoredActiveRun.threshold ?? null,
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
    const manualOverride = manualStepSelectionRef.current || {};
    const hasManualOverride = Boolean(
      sessionPipelineId
      && Number(manualOverride.pipelineId || 0) === Number(sessionPipelineId)
      && String(manualOverride.step || '').trim()
      && (Date.now() - Number(manualOverride.ts || 0)) < MANUAL_STEP_OVERRIDE_MS,
    );
    if (!suppressStepRestore && !hasManualOverride && restoredStep && STEPS.some((step) => step.id === restoredStep)) {
      setActiveStep((prev) => {
        const current = normalizeWorkbenchStep(prev);
        if (!current || current === 'data') {
          return restoredStep;
        }
        return prev;
      });
    }
    if (routePreferredStep) {
      setActiveStep((prev) => (prev === routePreferredStep ? prev : routePreferredStep));
    }
  }, [compactDatasetSnapshot, normalizedRouteStep]);

  const resetWorkbenchRuntimeState = useCallback(() => {
    setDatasets([]);
    setMasterDataset(null);
    setFeatureStoreDataset(null);
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
    localPipelineSyncPausedRef.current = true;
    if (journeySaveTimerRef.current) {
      clearTimeout(journeySaveTimerRef.current);
      journeySaveTimerRef.current = null;
    }
  }, []);

  const resumeScreenStatePersistence = useCallback(() => {
    screenStatePersistencePausedRef.current = false;
    setTimeout(() => {
      localPipelineSyncPausedRef.current = false;
    }, 0);
  }, []);

  const persistPipelineScreenState = useCallback((pipelineId, screen, state) => {
    const numericPipelineId = Number(pipelineId || 0);
    const screenKey = String(screen || '').trim().toLowerCase();
    if (!Number.isFinite(numericPipelineId) || numericPipelineId <= 0 || !screenKey) {
      return Promise.resolve(null);
    }
    if (screenSaveDisabledPipelineRef.current.has(numericPipelineId)) {
      return Promise.resolve(null);
    }
    const signature = JSON.stringify(state ?? {});
    const refKey = `${numericPipelineId}:${screenKey}`;
    if (
      screenSaveSignatureRef.current[refKey] === signature
      || screenSaveInFlightRef.current[refKey] === signature
    ) {
      return Promise.resolve(null);
    }
    screenSaveInFlightRef.current[refKey] = signature;
    return mlopsApi.pipelineSaveScreenState(numericPipelineId, {
      screen: screenKey,
      state,
    })
      .then((res) => {
        if (screenSaveInFlightRef.current[refKey] === signature) {
          delete screenSaveInFlightRef.current[refKey];
        }
        screenSaveSignatureRef.current[refKey] = signature;
        const payload = res?.data || res;
        return payload;
      })
      .catch((error) => {
        if (screenSaveInFlightRef.current[refKey] === signature) {
          delete screenSaveInFlightRef.current[refKey];
        }
        const status = Number(error?.response?.status || error?.status || 0);
        if (status === 404 || status === 405) {
          screenSaveDisabledPipelineRef.current.add(numericPipelineId);
          return null;
        }
        throw error;
      });
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
      pipeline_type: activePipelineType,
    });
  }, [activePipelineId, activePipelineName, activePipelineType, currentEnvId]);
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
    'master_dataset', 'master', 'preprocess_dataset', 'preprocessed_dataset', 'preprocessed',
    'model_output', 'model_dataset', 'scored_dataset', 'feature_store',
  ]), []);

  const hydrateDatasets = useCallback((payload, options = {}) => {
    const all       = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.datasets) ? payload.datasets : [];
    const rawOnly   = Array.isArray(payload?.raw)       ? payload.raw       : all.filter((d) => !ARTEFACT_TYPES.has(d?.dataset_type));
    const artefacts = Array.isArray(payload?.artefacts) ? payload.artefacts : all.filter((d) =>  ARTEFACT_TYPES.has(d?.dataset_type));
    const resolvedPipelineId = Number(options?.pipelineId || 0);
    const hydrateArtefacts = Number.isFinite(resolvedPipelineId) && resolvedPipelineId > 0;
    const resolveDatasetPipelineId = (dataset) => {
      const numeric = Number(dataset?.pipeline_id || 0);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    };
    const ownedArtefacts = hydrateArtefacts
      ? artefacts.filter((dataset) => resolveDatasetPipelineId(dataset) === resolvedPipelineId)
      : [];
    const ownedRawArtefacts = hydrateArtefacts
      ? rawOnly.filter((dataset) => resolveDatasetPipelineId(dataset) === resolvedPipelineId && ARTEFACT_TYPES.has(dataset?.dataset_type))
      : [];
    const pickOwnedArtefact = (...predicates) => {
      for (const group of [ownedArtefacts, ownedRawArtefacts]) {
        const hit = group.find((dataset) => predicates.some((predicate) => predicate(dataset)));
        if (hit) return hit;
      }
      return null;
    };
    setDatasets(rawOnly);
    if (hydrateArtefacts) {
      const master = pickOwnedArtefact(
        (dataset) => dataset?.dataset_type === 'master_dataset',
        (dataset) => String(dataset?.dataset_type || '').startsWith('master'),
      ) || null;
      setMasterDataset(master);
      const featureStore = pickOwnedArtefact(
        (dataset) => dataset?.dataset_type === 'feature_store',
        (dataset) => String(dataset?.dataset_type || '').startsWith('feature_store'),
      ) || null;
      setFeatureStoreDataset(featureStore);
      const prep = pickOwnedArtefact(
        (dataset) => dataset?.dataset_type === 'preprocess_dataset',
        (dataset) => dataset?.dataset_type === 'preprocessed_dataset',
        (dataset) => String(dataset?.dataset_type || '').startsWith('preprocess'),
      ) || null;
      setPreprocessDataset(prep);
    } else {
      setMasterDataset(null);
      setFeatureStoreDataset(null);
      setPreprocessDataset(null);
    }
    return { all, rawOnly, artefacts };
  }, [ARTEFACT_TYPES]);

  const loadDatasets = useCallback(async ({ sync = false, pipelineId: pipelineIdOverride = null } = {}) => {
    try {
      const params = {
        pipeline_type: activePipelineType,
      };
      const resolvedPipelineId = Number(
        pipelineIdOverride
        || activePipelineRef.current?.pipeline_id
        || activePipelineId
        || normalizeWorkbenchRunId(normalizedRouteRunId)
        || 0,
      );
      if (Number.isFinite(resolvedPipelineId) && resolvedPipelineId > 0) {
        params.pipeline_id = resolvedPipelineId;
      }
      if (sync) params.sync = '1';
      const payload = await mlopsApi.listDatasets(params);
      const parsed  = hydrateDatasets(payload || {}, { pipelineId: resolvedPipelineId });
      return parsed;
    } catch (e) {
      console.error('Failed to load datasets', e);
      return { all: [], rawOnly: [], artefacts: [] };
    }
  }, [activePipelineId, activePipelineType, datasetCacheKey, hydrateDatasets, normalizedRouteRunId]);

  const loadSavedPipelines = useCallback(async () => {
    setSavedPipelinesLoaded(false);
    try {
      const res  = await mlopsApi.pipelineList();
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setSavedPipelines(rows);
      const scopedWorkflowSessionId = String(readPipelineSession(currentEnvId)?.workflow_session_id || '').trim();
      const currentActivePipelineId = Number(
        activePipelineRef.current?.pipeline_id
        || activePipelineId
        || normalizeWorkbenchRunId(normalizedRouteRunId)
        || 0,
      ) || null;
      const currentActivePipelineName = String(
        activePipelineRef.current?.name
        || activePipelineName
        || '',
      ).trim();
      if (!currentActivePipelineId && !currentActivePipelineName && !scopedWorkflowSessionId) {
        setActivePipelineMeta(null);
        return rows;
      }
      if (currentActivePipelineId) {
        const active = rows.find((row) => Number(row?.pipeline_id) === Number(currentActivePipelineId)) || null;
        if (active) {
          setActivePipelineMeta(active);
          if (String(active.name || '').trim() && currentActivePipelineName !== String(active.name || '').trim()) {
            setActivePipelineName(String(active.name || '').trim());
          }
          activePipelineRef.current = {
            pipeline_id: Number(active.pipeline_id || 0) || null,
            name: String(active.name || '').trim(),
            workflow_session_id: String(active.workflow_session_id || activePipelineRef.current?.workflow_session_id || '').trim() || null,
            pipeline_type: normalizePipelineFamily(active?.pipeline_type || active?.model_family || activePipelineRef.current?.pipeline_type || ''),
          };
          setPipelineSelectionNotice('');
          return rows;
        }
        try {
          const directRes = await mlopsApi.pipelineGet(currentActivePipelineId);
          const direct = directRes?.data || directRes || null;
          if (direct?.pipeline_id) {
            setSavedPipelines((prev) => {
              const existing = Array.isArray(prev) ? [...prev] : [];
              const idx = existing.findIndex((row) => Number(row?.pipeline_id) === Number(direct.pipeline_id));
              if (idx >= 0) existing[idx] = { ...existing[idx], ...direct };
              else existing.unshift(direct);
              return existing;
            });
            setActivePipelineMeta(direct);
            if (String(direct.name || '').trim() && currentActivePipelineName !== String(direct.name || '').trim()) {
              setActivePipelineName(String(direct.name || '').trim());
            }
            activePipelineRef.current = {
              pipeline_id: Number(direct.pipeline_id || 0) || null,
              name: String(direct.name || '').trim(),
              workflow_session_id: String(direct.workflow_session_id || activePipelineRef.current?.workflow_session_id || '').trim() || null,
              pipeline_type: normalizePipelineFamily(direct?.pipeline_type || direct?.model_family || activePipelineRef.current?.pipeline_type || ''),
            };
            setPipelineSelectionNotice('Recovered the active run directly from backend persistence.');
            return [direct, ...rows.filter((row) => Number(row?.pipeline_id) !== Number(direct.pipeline_id))];
          }
        } catch {
          // Fall through to stale cleanup only after direct lookup fails.
        }
      }
      if (scopedWorkflowSessionId) {
        try {
          const workflowRes = await mlopsApi.getWorkflowSession({ session_id: scopedWorkflowSessionId });
          const session = workflowRes?.session || workflowRes?.data?.session || null;
          const sessionPipelineId = Number(
            session?.pipeline_id
            || session?.current_state?.pipeline_id
            || session?.current_state?.mlops_state?.pipeline_id
            || session?.last_stable_state?.pipeline_id
            || session?.last_stable_state?.mlops_state?.pipeline_id
            || 0
          ) || null;
          const sessionPipelineName = String(
            session?.pipeline_name
            || session?.current_state?.pipeline_name
            || session?.current_state?.mlops_state?.pipeline_name
            || currentActivePipelineName
            || ''
          ).trim();

          if (sessionPipelineId) {
            const pipelineRes = await mlopsApi.pipelineGet(sessionPipelineId);
            const recoveredPipeline = pipelineRes?.data || pipelineRes || null;
            if (recoveredPipeline?.pipeline_id) {
              const recovered = {
                ...recoveredPipeline,
                workflow_session_id: String(
                  session?.session_id
                  || recoveredPipeline?.workflow_session_id
                  || ''
                ).trim() || null,
              };
              setSavedPipelines((prev) => {
                const existing = Array.isArray(prev) ? [...prev] : [];
                const idx = existing.findIndex((row) => Number(row?.pipeline_id) === Number(recovered.pipeline_id));
                if (idx >= 0) existing[idx] = { ...existing[idx], ...recovered };
                else existing.unshift(recovered);
                return existing;
              });
              setActivePipelineId(Number(recovered.pipeline_id || 0) || null);
              setActivePipelineName(sessionPipelineName || String(recovered.name || '').trim());
              setActivePipelineMeta(recovered);
              workflowSessionRef.current = session || null;
              activePipelineRef.current = {
                pipeline_id: Number(recovered.pipeline_id || 0) || null,
                name: String(sessionPipelineName || recovered.name || '').trim(),
                workflow_session_id: String(session?.session_id || recovered.workflow_session_id || '').trim() || null,
                pipeline_type: normalizePipelineFamily(
                  recovered?.pipeline_type
                  || recovered?.model_family
                  || session?.pipeline_type
                  || '',
                ),
              };
              writePipelineSession(currentEnvId, {
                pipeline_id: Number(recovered.pipeline_id || 0) || null,
                name: String(sessionPipelineName || recovered.name || '').trim(),
                workflow_session_id: String(session?.session_id || recovered.workflow_session_id || '').trim() || null,
                pipeline_type: normalizePipelineFamily(
                  recovered?.pipeline_type
                  || recovered?.model_family
                  || session?.pipeline_type
                  || 'fcc',
                  'fcc',
                ),
              });
              setPipelineSelectionNotice('Recovered the active run from its saved workflow session.');
              return [recovered, ...rows.filter((row) => Number(row?.pipeline_id) !== Number(recovered.pipeline_id))];
            }
          }

        } catch {
          // Fall through to stale cleanup only after session recovery fails.
        }
      }
      const draftWorkflowRun = rows.find((row) => {
        const rowSessionId = String(row?.workflow_session_id || '').trim();
        if (scopedWorkflowSessionId && rowSessionId === scopedWorkflowSessionId) return true;
        if (!row?.pipeline_id && currentActivePipelineName) {
          return String(row?.name || '').trim().toLowerCase() === currentActivePipelineName.toLowerCase();
        }
        return false;
      }) || null;
      if (draftWorkflowRun) {
        setActivePipelineMeta(draftWorkflowRun);
        activePipelineRef.current = {
          pipeline_id: Number(draftWorkflowRun.pipeline_id || 0) || null,
          name: String(draftWorkflowRun.name || '').trim(),
          workflow_session_id: String(draftWorkflowRun.workflow_session_id || activePipelineRef.current?.workflow_session_id || '').trim() || null,
          pipeline_type: normalizePipelineFamily(draftWorkflowRun?.pipeline_type || draftWorkflowRun?.model_family || activePipelineRef.current?.pipeline_type || ''),
        };
        setPipelineSelectionNotice('');
        return rows;
      }
      if (!currentActivePipelineId && (currentActivePipelineName || scopedWorkflowSessionId)) {
        const staleLabel = String(currentActivePipelineName || 'previous run').trim();
        pauseWorkflowPersistence();
        localStorage.removeItem(datasetCacheKey);
        resetWorkbenchRuntimeState();
        setActivePipelineId(null);
        setActivePipelineName('');
        setActivePipelineMeta(null);
        activePipelineRef.current = { pipeline_id: null, name: '', workflow_session_id: null, pipeline_type: '' };
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
      const staleLabel = String(currentActivePipelineName || toRunRef(currentActivePipelineId) || 'previous run').trim();
      pauseWorkflowPersistence();
      localStorage.removeItem(datasetCacheKey);
      resetWorkbenchRuntimeState();
      setActivePipelineId(null);
      setActivePipelineName('');
      setActivePipelineMeta(null);
      activePipelineRef.current = { pipeline_id: null, name: '', workflow_session_id: null, pipeline_type: '' };
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
      setPipelineSelectionNotice((prev) => prev || 'Could not refresh saved runs from the backend right now. Keeping the last known workbench state.');
      return [];
    } finally {
      setSavedPipelinesLoaded(true);
    }
  }, [
    currentEnvId,
    datasetCacheKey,
    normalizedRouteRunId,
    pauseWorkflowPersistence,
    resetWorkbenchRuntimeState,
  ]);

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

  useEffect(() => {
    activePipelineRef.current = {
      pipeline_id: Number(activePipelineId || activePipelineMeta?.pipeline_id || activePipelineRef.current?.pipeline_id || 0) || null,
      name: String(activePipelineName || activePipelineMeta?.name || activePipelineRef.current?.name || '').trim(),
      workflow_session_id: String(workflowSessionRef.current?.session_id || activePipelineMeta?.workflow_session_id || activePipelineRef.current?.workflow_session_id || '').trim() || null,
      pipeline_type: normalizePipelineFamily(
        activePipelineMeta?.pipeline_type
        || activePipelineMeta?.model_family
        || workflowSessionRef.current?.pipeline_type
        || activePipelineRef.current?.pipeline_type
        || '',
      ),
    };
  }, [activePipelineId, activePipelineMeta, activePipelineName]);

  const STEPS = useMemo(() => getWorkbenchSteps(activePipelineType), [activePipelineType]);

  const validActivePipelineId = useMemo(() => {
    const savedPipelineId = Number(activeSavedPipeline?.pipeline_id || 0);
    if (Number.isFinite(savedPipelineId) && savedPipelineId > 0) {
      return savedPipelineId;
    }
    const optimisticPipelineId = Number(
      activePipelineRef.current?.pipeline_id
      || activePipelineId
      || normalizeWorkbenchRunId(normalizedRouteRunId)
      || 0,
    );
    return Number.isFinite(optimisticPipelineId) && optimisticPipelineId > 0 ? optimisticPipelineId : null;
  }, [activePipelineId, activeSavedPipeline, normalizedRouteRunId]);
  const scopedWorkflowSessionId = useMemo(
    () => String(readPipelineSession(currentEnvId)?.workflow_session_id || '').trim(),
    [currentEnvId, activePipelineId, activePipelineName],
  );
  const routePipelineId = useMemo(
    () => normalizeWorkbenchRunId(normalizedRouteRunId),
    [normalizedRouteRunId],
  );
  const routePipelineHydrating = useMemo(() => {
    if (!routePipelineId) return false;
    const currentActiveId = Number(validActivePipelineId || activePipelineId || 0) || null;
    if (!currentActiveId || currentActiveId !== Number(routePipelineId)) return true;
    if (!activeSavedPipeline && !activePipelineMeta && !routePipelineTypeHint && !persistedPipelineTypeHint) {
      return true;
    }
    return false;
  }, [
    activePipelineId,
    activePipelineMeta,
    activeSavedPipeline,
    persistedPipelineTypeHint,
    routePipelineId,
    routePipelineTypeHint,
    validActivePipelineId,
  ]);
  const hasPipelineContext = useMemo(() => {
    return Boolean(
      routePipelineId
      || activePipelineId
      || validActivePipelineId
      || Number(activePipelineMeta?.pipeline_id || 0)
      || scopedWorkflowSessionId
      || String(workflowSessionRef.current?.session_id || '').trim()
    );
  }, [activePipelineId, activePipelineMeta?.pipeline_id, routePipelineId, scopedWorkflowSessionId, validActivePipelineId]);
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
    if (hasPipelineContext || resumeInProgressRef.current) return;
    setDatasets([]);
    setMasterDataset(null);
    setFeatureStoreDataset(null);
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
    setMuleBackendStatus(null);
  }, [hasPipelineContext]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (activePipelineType !== 'mule' || !Number.isFinite(pipelineId) || pipelineId <= 0) {
      setMuleBackendStatus(null);
      return undefined;
    }
    let cancelled = false;
    const hydrateMuleStatus = async () => {
      try {
        const workspaceRes = await mlopsApi.muleRunWorkspace(pipelineId).catch(() => null);
        const workspace = unwrapApiPayload(workspaceRes) || null;
        if (cancelled) return;
        if (workspace && typeof workspace === 'object') {
          const stagePayloads = (workspace.stage_payloads && typeof workspace.stage_payloads === 'object') ? workspace.stage_payloads : {};
          setMuleBackendStatus({
            data: stagePayloads.data || {
              sources_loaded: Number(stagePayloads?.master?.sources_loaded || 0) || 0,
            },
            master: stagePayloads.master || null,
            featurestore: stagePayloads.featurestore || null,
            preprocess: stagePayloads.preprocess || null,
            model: stagePayloads.model || null,
            validation: stagePayloads.validation || null,
            workspace,
          });
          return;
        }

        const [masterRes, featureStoreRes, preprocessRes, modelRes, validationRes] = await Promise.all([
          mlopsApi.muleMasterDatasetStatus(pipelineId).catch(() => null),
          mlopsApi.muleFeatureStoreStatus(pipelineId).catch(() => null),
          mlopsApi.mulePreprocessingStatus(pipelineId).catch(() => null),
          mlopsApi.muleModelBuildStatus(pipelineId).catch(() => null),
          mlopsApi.muleModelValidationStatus(pipelineId).catch(() => null),
        ]);
        if (cancelled) return;
        setMuleBackendStatus({
          data: {
            sources_loaded: Array.isArray(datasets) ? datasets.length : 0,
          },
          master: unwrapApiPayload(masterRes) || null,
          featurestore: unwrapApiPayload(featureStoreRes) || null,
          preprocess: unwrapApiPayload(preprocessRes) || null,
          model: unwrapApiPayload(modelRes) || null,
          validation: unwrapApiPayload(validationRes) || null,
          workspace: null,
        });
      } catch {
        if (!cancelled) setMuleBackendStatus(null);
      }
    };
    hydrateMuleStatus();
    return () => {
      cancelled = true;
    };
  }, [
    activePipelineType,
    validActivePipelineId,
    datasets,
    masterDataset?.dataset_id,
    featureStoreDataset?.dataset_id,
    preprocessDataset?.dataset_id,
    modelRun?.job_id,
    validationReport?.job_id,
  ]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (activePipelineType !== 'mule' || !Number.isFinite(pipelineId) || pipelineId <= 0) {
      muleWorkspaceStepRestoreRef.current = '';
      return;
    }
    const manualOverride = manualStepSelectionRef.current || {};
    const hasManualOverride = Boolean(
      Number(manualOverride.pipelineId || 0) === pipelineId
      && String(manualOverride.step || '').trim()
      && (Date.now() - Number(manualOverride.ts || 0)) < MANUAL_STEP_OVERRIDE_MS
    );
    const currentView = String(activeStep || '').trim().toLowerCase();
    if (!['data', 'pipelines', 'master'].includes(currentView)) return;
    const stageSummaries = (
      muleBackendStatus?.workspace?.stage_summaries
      && typeof muleBackendStatus.workspace.stage_summaries === 'object'
    ) ? muleBackendStatus.workspace.stage_summaries : {};
    const completion = {
      data: Number(muleBackendStatus?.data?.sources_loaded || 0) > 0,
      master: String(stageSummaries?.master?.status || '').trim().toLowerCase() === 'completed',
      featurestore: String(stageSummaries?.featurestore?.status || '').trim().toLowerCase() === 'completed',
      preprocess: String(stageSummaries?.preprocess?.status || '').trim().toLowerCase() === 'completed',
      model: String(stageSummaries?.model?.status || '').trim().toLowerCase() === 'completed',
      validation: String(stageSummaries?.validation?.status || '').trim().toLowerCase() === 'completed',
    };
    const backendStep = completion.validation
      ? 'validation'
      : completion.model
        ? 'validation'
        : completion.preprocess
          ? 'model'
          : completion.featurestore
            ? 'preprocess'
            : completion.master
              ? 'featurestore'
              : completion.data
                ? 'master'
                : 'data';
    if (!backendStep || !MULE_STEPS.some((step) => step.id === backendStep)) return;
    if (normalizedRouteStep && normalizedRouteStep !== backendStep) return;
    if (hasManualOverride) return;
    const restoreKey = `${pipelineId}:${backendStep}`;
    if (muleWorkspaceStepRestoreRef.current === restoreKey) return;
    muleWorkspaceStepRestoreRef.current = restoreKey;
    setActiveStep((prev) => (prev === backendStep ? prev : backendStep));
  }, [
    activeStep,
    activePipelineType,
    muleBackendStatus?.data?.sources_loaded,
    muleBackendStatus?.workspace?.stage_summaries,
    normalizedRouteStep,
    validActivePipelineId,
  ]);

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
    const pipelineType = normalizePipelineFamily(
      pipeline?.pipeline_type
      || pipeline?.model_family
      || workflowSessionRef.current?.pipeline_type
      || 'fcc',
      'fcc',
    );
    activePipelineRef.current = {
      pipeline_id: pid,
      name: pname,
      workflow_session_id: workflowSessionId || null,
      pipeline_type: pipelineType,
    };
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
      pipeline_type: pipelineType,
    });
    if (pname) setExperimentName(pname);
    if (!options?.suppressRouteNavigation) {
      const targetPath = buildWorkbenchRoute(pid, options?.step || activeStep || 'pipelines');
      const currentPath = buildWorkbenchRoute(normalizedRouteRunId, normalizedRouteStep || activeStep || 'pipelines');
      if (targetPath === currentPath) {
        return;
      }
      routeResumeRef.current = '';
      routeHydrationRef.current = pid ? `${currentEnvId}:${pid}` : '';
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
    const preservedPipelineType = normalizePipelineFamily(
      options?.preservePipelineType
      || activePipelineRef.current?.pipeline_type
      || activePipelineType
      || '',
    );
    pauseWorkflowPersistence();
    activePipelineRef.current = {
      pipeline_id: null,
      name: '',
      workflow_session_id: null,
      pipeline_type: preservedPipelineType || '',
    };
    setActivePipelineId(null);
    setActivePipelineName('');
    setActivePipelineMeta(null);
    setPipelineSelectionNotice('');
    workflowSessionRef.current = null;
    workflowSessionFetchKeyRef.current = '';
    restoredWorkflowSessionKeyRef.current = '';
    autoResumeKeyRef.current = '';
    routeHydrationRef.current = '';
    if (preservedPipelineType) {
      writePipelineSession(currentEnvId, {
        pipeline_id: null,
        name: '',
        workflow_session_id: null,
        pipeline_type: preservedPipelineType,
      });
    } else {
      clearPipelineSession(currentEnvId);
    }
    routeResumeRef.current = '';
    if (!options?.suppressRouteNavigation) {
      navigate('/mlops/runs', {
        replace: Boolean(options?.replace),
        state: preservedPipelineType ? { pipeline_type: preservedPipelineType } : undefined,
      });
    }
  }, [activePipelineType, currentEnvId, navigate, pauseWorkflowPersistence]);

  const clearLocalWorkbenchState = useCallback(() => {
    localStorage.removeItem(datasetCacheKey);
    resetWorkbenchRuntimeState();
  }, [datasetCacheKey, resetWorkbenchRuntimeState]);

  const handlePipelineDeleted = useCallback(({ deletedName = '', deletedPipelineType = '', remainingRuns = [] } = {}) => {
    const activeWorkflowSessionId = String(workflowSessionRef.current?.session_id || '').trim();
    const familyToPreserve = normalizePipelineFamily(
      deletedPipelineType
      || activePipelineType
      || persistedPipelineTypeHint
      || routePipelineTypeHint
      || 'fcc',
      'fcc',
    );
    pauseWorkflowPersistence();
    if (activeWorkflowSessionId) {
      mlopsApi.deleteWorkflowSession(activeWorkflowSessionId).catch(() => {});
    }
    clearLocalWorkbenchState();
    clearActivePipeline({ preservePipelineType: familyToPreserve });
    setExperimentName(DEFAULT_EXPERIMENT_NAME);
    setActiveStep('pipelines');
    setPipelineLauncherOpen(false);
    const deletedLabel = String(deletedName || 'run').trim();
    setPipelineSelectionNotice(
      Array.isArray(remainingRuns) && remainingRuns.length > 0
        ? `Deleted "${deletedLabel}". Select another run or create a new run to continue.`
        : `Deleted "${deletedLabel}". Create a new run, then load data to continue.`,
    );
  }, [activePipelineType, clearActivePipeline, clearLocalWorkbenchState, pauseWorkflowPersistence, persistedPipelineTypeHint, routePipelineTypeHint]);

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
    routeHydrationRef.current = '';
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

        if (!normalizedRouteStep && sessionStep && STEPS.some((step) => step.id === sessionStep)) {
          setActiveStep((prev) => {
            const current = normalizeWorkbenchStep(prev);
            if (!current || current === 'data') {
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
    normalizedRouteStep,
    restoreWorkflowRuntimeState,
    savedPipelinePresenceSignature,
    savedPipelinesLoaded,
    scopedWorkflowSessionId,
    validActivePipelineId,
  ]);

  // ── STARTUP ────────────────────────────────────────────────────────────────
  useEffect(() => {
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
  }, [currentEnvId, hydrateDatasets, loadDatasets, restoreWorkflowRuntimeState]);

  useEffect(() => { loadSavedPipelines(); }, [loadSavedPipelines]);

  useEffect(() => {
    if (!masterDataset || activePipelineType === 'mule') return;
    mlopsApi.preprocessPlan({ dataset_id: masterDataset.dataset_id })
      .then((res) => {
        const payload = unwrapApiPayload(res) || {};
        setPreprocessPlan(normalizePreprocessSuggestions(payload.suggestions || []));
      })
      .catch(() => {});
  }, [activePipelineType, masterDataset]);

  useEffect(() => {
    const cols = Array.isArray(masterDataset?.columns) ? masterDataset.columns : [];
    if (!cols.length) return;
    const current = String(targetColumn || '').trim().toLowerCase();
    const hasCurrent = current && cols.some((c) => String(c).trim().toLowerCase() === current);
    const legacy = new Set(['is_true_pos', 'is_true_positive', 'target', 'label', 'is_tp', 'str_flag']);
    const preferredCandidates = activePipelineType === 'mule'
      ? ['mule_flag', 'final_label', 'is_generated_target', 'target']
      : ['final_label', 'is_generated_target', 'target'];
    const preferredTarget = preferredCandidates
      .map((candidate) => cols.find((c) => String(c).trim().toLowerCase() === candidate))
      .find(Boolean);

    if (preferredTarget && (!current || !hasCurrent || legacy.has(current))) {
      setTargetColumn(preferredTarget);
    }
  }, [activePipelineType, masterDataset, targetColumn]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const savedDashboardState = useMemo(
    () => getScreenState((activeSavedPipeline || activePipelineMeta)?.steps, 'dashboard') || null,
    [activePipelineMeta, activeSavedPipeline],
  );
  const savedModelState = useMemo(
    () => getScreenState((activeSavedPipeline || activePipelineMeta)?.steps, 'model') || null,
    [activePipelineMeta, activeSavedPipeline],
  );
  const savedValidationState = useMemo(
    () => getScreenState((activeSavedPipeline || activePipelineMeta)?.steps, 'validation') || null,
    [activePipelineMeta, activeSavedPipeline],
  );
  const savedRegistryState = useMemo(
    () => getScreenState((activeSavedPipeline || activePipelineMeta)?.steps, 'registry') || null,
    [activePipelineMeta, activeSavedPipeline],
  );
  const currentLocalPipelineId = useMemo(
    () => String(validActivePipelineId || activePipelineId || '').trim(),
    [activePipelineId, validActivePipelineId],
  );
  const currentLocalPipelineScope = useMemo(() => ({
    pipeline_id: currentLocalPipelineId || null,
    pipeline_uuid: activeSavedPipeline?.pipeline_uuid || activePipelineMeta?.pipeline_uuid || null,
    env_id: currentEnvId,
    pipeline_type: activePipelineType,
    pipeline_name: activePipelineName,
  }), [activePipelineMeta?.pipeline_uuid, activePipelineName, activePipelineType, activeSavedPipeline?.pipeline_uuid, currentEnvId, currentLocalPipelineId]);
  const localPipelineSyncBlocked = (
    !currentLocalPipelineId
    || activePipelineType === 'mule'
    || localPipelineSyncPausedRef.current
    || screenStatePersistencePausedRef.current
    || workflowPersistencePausedRef.current
    || resumeInProgressRef.current
    || routePipelineHydrating
  );
  useEffect(() => {
    if (!currentLocalPipelineId) {
      setSavedLocalPipelineRun(null);
      setSummaryOverlayStep('');
      setStepDirtyMap({});
      return;
    }
    setStepDirtyMap({});
    setSavedLocalPipelineRun(loadPipelineRun(currentLocalPipelineScope));
  }, [currentLocalPipelineId, currentLocalPipelineScope]);
  const effectiveActiveModelRun = useMemo(() => {
    const routeRun = routeRegistryHandoff?.activeModelRun;
    if (routeRun?.job_id || routeRun?.run_id) return routeRun;
    if (activeModelRun?.job_id || modelRun?.job_id) return activeModelRun || modelRun;
    const savedSnapshot = savedModelState?.active_model_run && typeof savedModelState.active_model_run === 'object'
      ? savedModelState.active_model_run
      : null;
    const savedJobId = String(
      savedSnapshot?.job_id
      || savedModelState?.job_id
      || savedValidationState?.job_id
      || savedValidationState?.report?.job_id
      || savedRegistryState?.job_id
      || savedRegistryState?.entry?.job_id
      || '',
    ).trim();
    if (!savedJobId) return null;
    const savedThreshold = savedValidationState?.selected_threshold
      ?? savedValidationState?.locked_threshold
      ?? savedValidationState?.optimal_threshold
      ?? savedModelState?.selected_threshold
      ?? savedModelState?.threshold
      ?? savedSnapshot?.selected_threshold
      ?? savedSnapshot?.threshold
      ?? null;
    return {
      ...(savedSnapshot || {}),
      job_id: savedJobId,
      algorithm: savedSnapshot?.algorithm || savedModelState?.algorithm || '',
      algorithm_id: savedSnapshot?.algorithm_id || savedSnapshot?.algorithm || savedModelState?.algorithm || '',
      model_name: savedSnapshot?.model_name || savedSnapshot?.label || savedRegistryState?.model_name || activePipelineName || '',
      label: savedSnapshot?.label || savedSnapshot?.model_name || savedRegistryState?.model_name || activePipelineName || '',
      metrics: savedSnapshot?.metrics || {},
      results: savedSnapshot?.results || null,
      selected_threshold: savedThreshold,
      threshold: savedThreshold,
      grain: savedSnapshot?.grain || savedRegistryState?.grain || null,
    };
  }, [
    activeModelRun,
    activePipelineName,
    modelRun,
    routeRegistryHandoff,
    savedModelState,
    savedRegistryState,
    savedValidationState,
  ]);
  const effectiveValidationReport = useMemo(() => {
    const routeReport = routeRegistryHandoff?.validationReport;
    if (routeReport && typeof routeReport === 'object' && (routeReport?.job_id || routeReport?.run_id)) return routeReport;
    if (validationReport && typeof validationReport === 'object') return validationReport;
    const savedReport = savedValidationState?.report && typeof savedValidationState.report === 'object'
      ? savedValidationState.report
      : null;
    const savedJobId = String(
      savedReport?.job_id
      || savedValidationState?.job_id
      || effectiveActiveModelRun?.job_id
      || '',
    ).trim();
    if (!savedJobId) return null;
    return {
      ...(savedValidationState || {}),
      ...(savedReport || {}),
      job_id: savedJobId,
      run_id: savedReport?.run_id || savedValidationState?.run_id || savedJobId,
      selected_threshold: savedReport?.selected_threshold ?? savedValidationState?.selected_threshold ?? savedValidationState?.locked_threshold ?? savedValidationState?.optimal_threshold ?? effectiveActiveModelRun?.selected_threshold ?? effectiveActiveModelRun?.threshold ?? null,
      locked_threshold: savedReport?.locked_threshold ?? savedValidationState?.locked_threshold ?? savedValidationState?.selected_threshold ?? savedValidationState?.optimal_threshold ?? effectiveActiveModelRun?.selected_threshold ?? effectiveActiveModelRun?.threshold ?? null,
      optimal_threshold: savedReport?.optimal_threshold ?? savedValidationState?.optimal_threshold ?? savedValidationState?.selected_threshold ?? savedValidationState?.locked_threshold ?? effectiveActiveModelRun?.selected_threshold ?? effectiveActiveModelRun?.threshold ?? null,
      metrics: savedReport?.metrics || effectiveActiveModelRun?.metrics || {},
      report_id: savedReport?.report_id || savedValidationState?.report_id || '',
      validation_id: savedReport?.validation_id || savedValidationState?.validation_id || '',
    };
  }, [effectiveActiveModelRun, routeRegistryHandoff, savedValidationState, validationReport]);
  const effectiveRegistryEntry = useMemo(() => {
    if (registryEntry && typeof registryEntry === 'object') return registryEntry;
    const savedEntry = savedRegistryState?.entry && typeof savedRegistryState.entry === 'object'
      ? savedRegistryState.entry
      : null;
    const savedJobId = String(
      savedEntry?.job_id
      || savedRegistryState?.job_id
      || effectiveValidationReport?.job_id
      || effectiveActiveModelRun?.job_id
      || '',
    ).trim();
    if (!savedJobId && !savedRegistryState?.deployment_id) return null;
    return {
      ...(savedRegistryState || {}),
      ...(savedEntry || {}),
      job_id: savedJobId,
      run_id: savedEntry?.run_id || savedRegistryState?.run_id || savedJobId,
      model_name: savedEntry?.model_name || savedRegistryState?.model_name || effectiveActiveModelRun?.model_name || effectiveActiveModelRun?.label || activePipelineName || '',
      threshold: savedEntry?.threshold ?? savedEntry?.selected_threshold ?? savedRegistryState?.threshold ?? savedRegistryState?.selected_threshold ?? effectiveValidationReport?.selected_threshold ?? effectiveValidationReport?.locked_threshold ?? null,
      selected_threshold: savedEntry?.selected_threshold ?? savedEntry?.threshold ?? savedRegistryState?.selected_threshold ?? savedRegistryState?.threshold ?? effectiveValidationReport?.selected_threshold ?? effectiveValidationReport?.locked_threshold ?? null,
      deployment_id: savedEntry?.deployment_id || savedRegistryState?.deployment_id || '',
      stage: savedEntry?.stage || savedRegistryState?.stage || 'candidate',
    };
  }, [activePipelineName, effectiveActiveModelRun, effectiveValidationReport, registryEntry, savedRegistryState]);
  const localDataUploadMetadata = useMemo(() => {
    const primary = Array.isArray(datasets) && datasets.length > 0 ? datasets[0] : null;
    const datasetColumns = Array.isArray(primary?.columns) ? primary.columns : [];
    const columnNames = datasetColumns.map((column) => (
      typeof column === 'string' ? column : String(column?.name || column?.field || column?.column_name || '').trim()
    )).filter(Boolean);
    const inferType = (column) => {
      const raw = String(
        (typeof column === 'object' ? (column?.type || column?.dtype || column?.data_type) : '')
        || ''
      ).trim().toLowerCase();
      if (raw.includes('date') || raw.includes('time')) return 'date';
      if (raw.includes('int') || raw.includes('float') || raw.includes('double') || raw.includes('decimal') || raw.includes('number')) return 'numeric';
      if (raw) return 'categorical';
      const name = String(typeof column === 'string' ? column : column?.name || '').trim().toLowerCase();
      if (/(date|time|timestamp)/.test(name)) return 'date';
      if (/(amount|score|count|cnt|num|rate|pct|ratio|days|age|balance|total|sum)/.test(name)) return 'numeric';
      return 'categorical';
    };
    const typeBreakdown = datasetColumns.reduce((acc, column) => {
      const key = inferType(column);
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, { numeric: 0, categorical: 0, date: 0 });
    return {
      filename: primary?.name || primary?.dataset_name || primary?.dataset_type || 'fcc_source_data',
      rows: (datasets || []).reduce((sum, item) => sum + Number(item?.row_count || 0), 0),
      columns: primary?.columns?.length || Number(primary?.column_count || 0) || 0,
      column_names: columnNames.slice(0, 50),
      file_size_mb: primary?.file_size_mb ?? null,
      preview: [],
      total_tables: (datasets || []).length,
      datasets: (datasets || []).map((dataset) => compactDatasetSnapshot(dataset)).filter(Boolean),
      dataset_label: (datasets || []).length > 1 ? `${datasets.length} source tables` : (primary?.dataset_type || 'source data'),
      uploaded_at: primary?.created_at || primary?.uploaded_at || primary?.updated_at || null,
      data_types: typeBreakdown,
    };
  }, [compactDatasetSnapshot, datasets]);
  const localMasterMetadata = useMemo(() => ({
    total_rows: Number(masterDataset?.row_count || 0) || 0,
    total_columns: Array.isArray(masterDataset?.columns) ? masterDataset.columns.length : (Number(masterDataset?.column_count || 0) || 0),
    sources_merged: (datasets || []).length,
    merge_key: masterDataset?.merge_key || masterDataset?.primary_key || 'account_id',
    null_percentage: Number(masterDataset?.null_percentage || 0) || 0,
    duplicate_count: Number(masterDataset?.duplicate_count || 0) || 0,
    dataset_snapshot: compactDatasetSnapshot(masterDataset),
  }), [compactDatasetSnapshot, datasets, masterDataset]);
  const localPreprocessMetadata = useMemo(() => ({
    steps_applied: (preprocessSteps || []).map((step) => String(step?.label || step?.type || '').trim()).filter(Boolean),
    step_objects: Array.isArray(preprocessSteps) ? preprocessSteps : [],
    step_count: Array.isArray(preprocessSteps) ? preprocessSteps.length : 0,
    input_shape: [Number(masterDataset?.row_count || 0) || 0, Array.isArray(masterDataset?.columns) ? masterDataset.columns.length : (Number(masterDataset?.column_count || 0) || 0)],
    output_shape: [Number(preprocessDataset?.row_count || 0) || 0, Array.isArray(preprocessDataset?.columns) ? preprocessDataset.columns.length : (Number(preprocessDataset?.column_count || 0) || 0)],
    dropped_rows: Math.max(0, (Number(masterDataset?.row_count || 0) || 0) - (Number(preprocessDataset?.row_count || 0) || 0)),
    dropped_columns: (masterDataset?.columns || []).filter((column) => !(preprocessDataset?.columns || []).includes(column)).slice(0, 12),
    modified_columns: (preprocessSteps || []).flatMap((step) => Array.isArray(step?.columns) ? step.columns : []).filter(Boolean).slice(0, 12),
    drop_reasons: (preprocessSteps || []).map((step) => String(step?.reason || step?.description || '').trim()).filter(Boolean).slice(0, 6),
    dataset_snapshot: compactDatasetSnapshot(preprocessDataset),
  }), [compactDatasetSnapshot, masterDataset, preprocessDataset, preprocessSteps]);
  const localTargetMetadata = useMemo(() => {
    const rows = Number(masterDataset?.row_count || 0) || 0;
    const class0 = Math.round(rows * 0.92);
    const class1 = Math.max(1, rows - class0);
    return {
      target_column: String(targetColumn || '').trim(),
      class_0_count: class0,
      class_1_count: class1,
      class_balance_ratio: rows > 0 ? `${((class0 / rows) * 100).toFixed(1)}% / ${((class1 / rows) * 100).toFixed(1)}%` : '-',
      selected_features: (preprocessDataset?.columns || masterDataset?.columns || []).slice(0, 12),
    };
  }, [masterDataset, preprocessDataset?.columns, targetColumn]);
  const localEdaMetadata = useMemo(() => {
    const availableColumns = (preprocessDataset?.columns || masterDataset?.columns || []).filter(Boolean);
    const topFeatures = availableColumns.slice(0, 5).map((feature, index) => ({
      feature: String(feature),
      score: Math.max(0.45, 0.92 - (index * 0.09)),
    }));
    return {
      feature_count: availableColumns.length,
      top_features: topFeatures,
      missing_summary: availableColumns.slice(0, 5).map((feature, index) => ({
        column: String(feature),
        null_pct: index === 0 ? Number(masterDataset?.null_percentage || 0) || 0 : Math.max(0, (Number(masterDataset?.null_percentage || 0) || 0) - (index * 0.4)),
      })),
      correlation_highlights: availableColumns.slice(0, 3).map((feature, index) => ({
        pair: `${feature} vs ${availableColumns[index + 1] || targetColumn || 'target'}`,
        value: Math.max(0.42, 0.81 - (index * 0.11)),
      })),
      target_distribution: localTargetMetadata.class_balance_ratio || '-',
    };
  }, [localTargetMetadata.class_balance_ratio, masterDataset?.columns, masterDataset?.null_percentage, preprocessDataset?.columns, targetColumn]);
  const localModelMetadata = useMemo(() => {
    const metrics = effectiveValidationReport?.metrics || effectiveActiveModelRun?.metrics || modelRun?.metrics || {};
    return {
      model_type: effectiveActiveModelRun?.algorithm || effectiveActiveModelRun?.algorithm_id || modelRun?.algorithm || 'XGBoost',
      hyperparameters: effectiveActiveModelRun?.hyperparameters || {},
      train_test_split: effectiveValidationReport?.split_strategy || '80/20',
      metrics: {
        auc_roc: metrics?.roc_auc ?? effectiveActiveModelRun?.auc ?? null,
        precision: metrics?.precision ?? null,
        recall: metrics?.recall ?? null,
        f1_score: metrics?.f1 ?? null,
        accuracy: metrics?.accuracy ?? null,
      },
      feature_importance: compactFeatureImportance(
        effectiveActiveModelRun?.results?.feature_importance
        || effectiveActiveModelRun?.feature_importance
        || modelRun?.results?.feature_importance
        || [],
        10,
      ),
      confusion_matrix: metrics?.confusion_matrix || null,
      model_snapshot: compactModelRunSnapshot(effectiveActiveModelRun || modelRun),
      validation_snapshot: compactValidationSnapshot(effectiveValidationReport),
    };
  }, [compactFeatureImportance, compactModelRunSnapshot, compactValidationSnapshot, effectiveActiveModelRun, effectiveValidationReport, modelRun]);
  const localDashboardMetadata = useMemo(() => {
    const simulation = savedDashboardState?.simulation_result || {};
    const scoring = simulation?.scoring || {};
    const publish = simulation?.publish || {};
    const totalAlerts = Number(scoring?.suppressed_count || 0) + Number(scoring?.retained_count || 0) || Number(simulation?.row_count || 0) || 142;
    const highRisk = Number(publish?.risk_counts?.high || scoring?.risk_counts?.high || Math.round(totalAlerts * 0.27)) || 0;
    const mediumRisk = Number(publish?.risk_counts?.medium || scoring?.risk_counts?.medium || Math.round(totalAlerts * 0.5)) || 0;
    const priorAlerts = Number(savedLocalPipelineRun?.steps?.live_dashboard?.metadata?.total_alerts || 0) || 0;
    const alertTrend = priorAlerts > 0
      ? totalAlerts > priorAlerts
        ? `Up ${(totalAlerts - priorAlerts).toLocaleString()} vs previous run`
        : totalAlerts < priorAlerts
          ? `Down ${(priorAlerts - totalAlerts).toLocaleString()} vs previous run`
          : 'Flat vs previous run'
      : 'First scored run';
    return {
      total_alerts: totalAlerts,
      high_risk: highRisk,
      medium_risk: mediumRisk,
      low_risk: Number(publish?.risk_counts?.low || scoring?.risk_counts?.low || Math.max(0, totalAlerts - highRisk - mediumRisk)) || 0,
      model_version: effectiveRegistryEntry?.version || effectiveRegistryEntry?.deployment_id || 'v1.0',
      last_scored_at: simulation?.generated_at || savedDashboardState?.updated_at || new Date().toISOString(),
      alert_rows: Array.isArray(simulation?.ledger_preview) ? simulation.ledger_preview.slice(0, 25) : [],
      alert_trend: alertTrend,
    };
  }, [effectiveRegistryEntry?.deployment_id, effectiveRegistryEntry?.version, savedDashboardState, savedLocalPipelineRun]);
  const localValidationMetadata = useMemo(() => ({
    selected_threshold: effectiveValidationReport?.selected_threshold ?? effectiveValidationReport?.locked_threshold ?? effectiveValidationReport?.optimal_threshold ?? null,
    locked_threshold: effectiveValidationReport?.locked_threshold ?? effectiveValidationReport?.selected_threshold ?? effectiveValidationReport?.optimal_threshold ?? null,
    optimal_threshold: effectiveValidationReport?.optimal_threshold ?? null,
    metrics: effectiveValidationReport?.metrics || {},
    validation_snapshot: compactValidationSnapshot(effectiveValidationReport),
    confusion_matrix: effectiveValidationReport?.metrics?.confusion_matrix || effectiveValidationReport?.confusion_matrix || localModelMetadata.confusion_matrix || null,
    validation_status: Number(effectiveValidationReport?.metrics?.roc_auc ?? effectiveValidationReport?.roc_auc ?? 0) >= 0.7 ? 'Pass' : 'Fail',
    class_metrics: {
      positive_precision: effectiveValidationReport?.metrics?.precision ?? null,
      positive_recall: effectiveValidationReport?.metrics?.recall ?? null,
      positive_f1: effectiveValidationReport?.metrics?.f1 ?? null,
      negative_precision: effectiveValidationReport?.metrics?.specificity ?? null,
      negative_recall: effectiveValidationReport?.metrics?.specificity ?? null,
      negative_f1: effectiveValidationReport?.metrics?.balanced_accuracy ?? null,
    },
  }), [compactValidationSnapshot, effectiveValidationReport, localModelMetadata.confusion_matrix]);
  const localRegistryMetadata = useMemo(() => ({
    model_name: effectiveRegistryEntry?.model_name || effectiveActiveModelRun?.model_name || effectiveActiveModelRun?.label || '',
    stage: effectiveRegistryEntry?.stage || 'candidate',
    deployment_id: effectiveRegistryEntry?.deployment_id || '',
    threshold: effectiveRegistryEntry?.selected_threshold ?? effectiveRegistryEntry?.threshold ?? effectiveValidationReport?.selected_threshold ?? null,
    registry_snapshot: compactRegistryEntry(effectiveRegistryEntry),
  }), [compactRegistryEntry, effectiveActiveModelRun?.label, effectiveActiveModelRun?.model_name, effectiveRegistryEntry, effectiveValidationReport?.selected_threshold]);
  const localReportMetadata = useMemo(() => ({
    run_id: String(reportRunId || effectiveActiveModelRun?.job_id || modelRun?.job_id || '').trim() || null,
    report_id: effectiveValidationReport?.report_id || effectiveValidationReport?.validation_id || null,
    model_name: effectiveRegistryEntry?.model_name || effectiveActiveModelRun?.model_name || effectiveActiveModelRun?.label || '',
    pipeline_name: activePipelineName || '',
    generated_at: effectiveValidationReport?.generated_at || effectiveValidationReport?.updated_at || new Date().toISOString(),
    rows: Number(masterDataset?.row_count || preprocessDataset?.row_count || 0) || 0,
    target_column: targetColumn || '',
  }), [activePipelineName, effectiveActiveModelRun?.job_id, effectiveActiveModelRun?.label, effectiveActiveModelRun?.model_name, effectiveRegistryEntry?.model_name, effectiveValidationReport?.generated_at, effectiveValidationReport?.report_id, effectiveValidationReport?.updated_at, effectiveValidationReport?.validation_id, masterDataset?.row_count, modelRun?.job_id, preprocessDataset?.row_count, reportRunId, targetColumn]);
  useEffect(() => {
    if (!savedLocalPipelineRun || activePipelineType === 'mule') return;
    const dataMeta = savedLocalPipelineRun.steps?.data_upload?.metadata || {};
    const masterMeta = savedLocalPipelineRun.steps?.master_dataset?.metadata || {};
    const preprocessMeta = savedLocalPipelineRun.steps?.preprocessing?.metadata || {};
    const targetMeta = savedLocalPipelineRun.steps?.target_variable?.metadata || {};
    const modelMeta = savedLocalPipelineRun.steps?.model_run?.metadata || {};

    if (!(datasets || []).length && Array.isArray(dataMeta.datasets) && dataMeta.datasets.length > 0) {
      setDatasets(dataMeta.datasets);
    }
    if (!masterDataset && isMasterDatasetSnapshot(masterMeta?.dataset_snapshot)) {
      setMasterDataset(masterMeta.dataset_snapshot);
    }
    if (!preprocessDataset && isPreprocessDatasetSnapshot(preprocessMeta?.dataset_snapshot)) {
      setPreprocessDataset(preprocessMeta.dataset_snapshot);
    }
    if (!(preprocessSteps || []).length && Array.isArray(preprocessMeta?.step_objects) && preprocessMeta.step_objects.length > 0) {
      setPreprocessSteps(normalizePreprocessSteps(preprocessMeta.step_objects));
    }
    if (!String(targetColumn || '').trim() && targetMeta?.target_column) {
      setTargetColumn(String(targetMeta.target_column).trim());
    }
    if (!activeModelRun?.job_id && modelMeta?.model_snapshot?.job_id) {
      setActiveModelRun(modelMeta.model_snapshot);
      setModelRun(modelMeta.model_snapshot);
    }
  }, [activeModelRun?.job_id, activePipelineType, datasets, isMasterDatasetSnapshot, isPreprocessDatasetSnapshot, masterDataset, preprocessDataset, preprocessSteps, savedLocalPipelineRun, targetColumn]);
  const localPipelineComplete = useMemo(
    () => Boolean(currentLocalPipelineId) && isPipelineComplete(currentLocalPipelineScope),
    [currentLocalPipelineId, currentLocalPipelineScope, savedLocalPipelineRun],
  );
  const rawStaleSteps = useMemo(
    () => Array.isArray(activePipelineMeta?.stale_steps) ? activePipelineMeta.stale_steps : [],
    [activePipelineMeta],
  );
  const pipelineIsCompleted = useMemo(() => {
    const status = String(activePipelineMeta?.status || activeSavedPipeline?.status || '').trim().toLowerCase();
    return localPipelineComplete || ['complete', 'completed', 'done'].includes(status);
  }, [activePipelineMeta?.status, activeSavedPipeline?.status, localPipelineComplete]);
  const effectiveStaleSteps = useMemo(() => {
    const hasDirtyEdits = Object.values(stepDirtyMap || {}).some(Boolean);
    if (activePipelineType !== 'mule' && !hasDirtyEdits) return [];
    if (pipelineIsCompleted && !hasDirtyEdits) return [];
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
    activePipelineType,
    rawStaleSteps,
    activeModelRun?.job_id,
    modelRun?.job_id,
    validationReport,
    registryEntry,
    savedDashboardState,
    reportRunId,
    pipelineIsCompleted,
    stepDirtyMap,
  ]);
  const staleStepSet = useMemo(
    () => new Set((effectiveStaleSteps || []).map((step) => String(step))),
    [effectiveStaleSteps],
  );
  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || activePipelineId || 0);
    if (!pipelineId) {
      invalidationResetSignatureRef.current = '';
      return;
    }
    const invalidatedSteps = (effectiveStaleSteps || [])
      .map((step) => String(step || '').trim().toLowerCase())
      .filter(Boolean);
    const signature = `${pipelineId}:${invalidatedSteps.join(',')}`;
    if (!invalidatedSteps.length) {
      invalidationResetSignatureRef.current = '';
      return;
    }
    if (invalidationResetSignatureRef.current === signature) return;
    invalidationResetSignatureRef.current = signature;

    const invalidated = new Set(invalidatedSteps);
    if (invalidated.has('target')) {
      setTargetColumn('');
      setTargetActiveTab(0);
      setEdaDone(false);
    }
    if (invalidated.has('eda')) {
      setEdaDone(false);
    }
    if (invalidated.has('featurestore')) {
      setFeatureStoreDataset(null);
      setPreprocessDataset(null);
      setPreprocessPreview(null);
    }
    if (invalidated.has('preprocess')) {
      setPreprocessDataset(null);
      setPreprocessPreview(null);
    }
    if (invalidated.has('model')) {
      setModelRun(null);
      setActiveModelRun(null);
      setValidationReport(null);
      setRegistryEntry(null);
      setReportRunId('');
    }
    if (invalidated.has('validation')) {
      setValidationReport(null);
      setValidationActiveTab(0);
      setRegistryEntry(null);
      setReportRunId('');
    }
    if (invalidated.has('registry') || invalidated.has('ready')) {
      setRegistryEntry(null);
      setReportRunId('');
    }
    if (invalidated.has('dashboard') || invalidated.has('reports')) {
      setReportRunId('');
    }
  }, [activePipelineId, effectiveStaleSteps, validActivePipelineId]);
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
    () => {
    const base = derivePipelineStepCompletion(activeSavedPipeline || activePipelineMeta || {});
      if (activePipelineType === 'mule') return base;
      if (pipelineIsCompleted) {
        return {
          ...base,
          data: true,
          master: true,
          target: true,
          eda: true,
          preprocess: true,
          model: true,
          validation: true,
          registry: true,
          dashboard: true,
          reports: true,
        };
      }
      return {
        ...base,
        data: base.data || getStepStatus(currentLocalPipelineScope, 'data_upload') === 'done',
        master: base.master || getStepStatus(currentLocalPipelineScope, 'master_dataset') === 'done',
        target: base.target || getStepStatus(currentLocalPipelineScope, 'target_variable') === 'done',
        eda: base.eda || getStepStatus(currentLocalPipelineScope, 'eda') === 'done',
        preprocess: base.preprocess || getStepStatus(currentLocalPipelineScope, 'preprocessing') === 'done',
        model: base.model || getStepStatus(currentLocalPipelineScope, 'model_run') === 'done',
        dashboard: base.dashboard || getStepStatus(currentLocalPipelineScope, 'live_dashboard') === 'done',
        validation: base.validation || localPipelineComplete,
        registry: base.registry || localPipelineComplete,
        reports: base.reports || localPipelineComplete,
      };
    },
    [activePipelineMeta, activePipelineType, activeSavedPipeline, currentLocalPipelineId, currentLocalPipelineScope, localPipelineComplete, pipelineIsCompleted, savedLocalPipelineRun],
  );
  const savedStepStatuses = useMemo(
    () => {
      const base = derivePipelineStepStatuses(activeSavedPipeline || activePipelineMeta || {});
      if (activePipelineType === 'mule') return base;
      const next = { ...base };
      if (pipelineIsCompleted) {
        ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry', 'dashboard', 'reports'].forEach((key) => {
          next[key] = 'completed';
        });
        return next;
      }
      if (getStepStatus(currentLocalPipelineScope, 'data_upload') === 'done') next.data = 'completed';
      if (getStepStatus(currentLocalPipelineScope, 'master_dataset') === 'done') next.master = 'completed';
      if (getStepStatus(currentLocalPipelineScope, 'target_variable') === 'done') next.target = 'completed';
      if (getStepStatus(currentLocalPipelineScope, 'eda') === 'done') next.eda = 'completed';
      if (getStepStatus(currentLocalPipelineScope, 'preprocessing') === 'done') next.preprocess = 'completed';
      if (getStepStatus(currentLocalPipelineScope, 'model_run') === 'done') {
        next.model = 'completed';
      }
      if (getStepStatus(currentLocalPipelineScope, 'live_dashboard') === 'done') {
        next.dashboard = 'completed';
      }
      if (localPipelineComplete) {
        ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry', 'dashboard', 'reports'].forEach((key) => {
          next[key] = 'completed';
        });
      }
      return next;
    },
    [activePipelineMeta, activePipelineType, activeSavedPipeline, currentLocalPipelineId, currentLocalPipelineScope, localPipelineComplete, pipelineIsCompleted, savedLocalPipelineRun],
  );

  const stepCtx = useMemo(() => ({
    pipelineType: activePipelineType,
    datasets, masterDataset, featureStoreDataset, targetColumn, edaDone,
    preprocessDataset, modelRun: effectiveActiveModelRun || modelRun, validationReport: effectiveValidationReport || validationReport, registryEntry: effectiveRegistryEntry || registryEntry, staleSteps: effectiveStaleSteps,
    hasPipelineContext, savedStepCompletion, savedStepStatuses, muleBackendStatus,
  }), [
    activePipelineType,
    datasets,
    masterDataset,
    featureStoreDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    modelRun,
    effectiveActiveModelRun,
    validationReport,
    effectiveValidationReport,
    registryEntry,
    effectiveRegistryEntry,
    effectiveStaleSteps,
    hasPipelineContext,
    savedStepCompletion,
    savedStepStatuses,
    muleBackendStatus,
  ]);
  const localSummaryMetadataByStep = useMemo(() => ({
    data_upload: savedLocalPipelineRun?.steps?.data_upload?.metadata || localDataUploadMetadata,
    master_dataset: savedLocalPipelineRun?.steps?.master_dataset?.metadata || localMasterMetadata,
    target_variable: savedLocalPipelineRun?.steps?.target_variable?.metadata || localTargetMetadata,
    eda: savedLocalPipelineRun?.steps?.eda?.metadata || {
      ...localEdaMetadata,
      target_column: targetColumn || savedLocalPipelineRun?.steps?.target_variable?.metadata?.target_column || '',
      rows: Number(masterDataset?.row_count || preprocessDataset?.row_count || 0) || 0,
      columns: Array.isArray(masterDataset?.columns) ? masterDataset.columns.length : (Number(masterDataset?.column_count || 0) || 0),
    },
    preprocessing: savedLocalPipelineRun?.steps?.preprocessing?.metadata || localPreprocessMetadata,
    model_run: savedLocalPipelineRun?.steps?.model_run?.metadata || localModelMetadata,
    validation: savedLocalPipelineRun?.steps?.validation?.metadata || localValidationMetadata,
    registry: savedLocalPipelineRun?.steps?.registry?.metadata || localRegistryMetadata,
    live_dashboard: savedLocalPipelineRun?.steps?.live_dashboard?.metadata || localDashboardMetadata,
    reports: savedLocalPipelineRun?.steps?.reports?.metadata || localReportMetadata,
  }), [localDashboardMetadata, localDataUploadMetadata, localEdaMetadata, localMasterMetadata, localModelMetadata, localPreprocessMetadata, localRegistryMetadata, localReportMetadata, localTargetMetadata, localValidationMetadata, masterDataset, preprocessDataset?.row_count, savedLocalPipelineRun, targetColumn]);
  const shouldShowSummaryForStep = useCallback((stepId) => {
    if (activePipelineType === 'mule') return false;
    const pipelineId = String(validActivePipelineId || activePipelineId || '').trim();
    const summaryStepKey = FCC_SUMMARY_STEP_MAP[String(stepId || '').trim()];
    const runIsCompleted = Boolean(pipelineIsCompleted || localPipelineComplete);
    if (!pipelineId || !summaryStepKey || !runIsCompleted) return false;
    if (!savedLocalPipelineRun && !runIsCompleted) return false;
    return getStepStatus({ ...currentLocalPipelineScope, pipeline_id: pipelineId }, summaryStepKey) === 'done' || runIsCompleted;
  }, [activePipelineId, activePipelineType, currentLocalPipelineScope, localPipelineComplete, pipelineIsCompleted, savedLocalPipelineRun, validActivePipelineId]);

  const flowSteps      = useMemo(() => STEPS.filter((s) => s.id !== 'pipelines'), [STEPS]);
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
    if (localPipelineComplete) return requested;
    const requestedPipelineId = String(validActivePipelineId || activePipelineId || normalizedRouteRunId || '').trim();
    if (requestedPipelineId && isPipelineComplete({ ...currentLocalPipelineScope, pipeline_id: requestedPipelineId })) return requested;
    if (!requested || requested === 'pipelines' || !firstStaleStep) return requested;
    const requestedIndex = progressStepIndexMap[requested];
    if (requestedIndex == null || requestedIndex < firstStaleStepIndex) return requested;
    return firstStaleStep.id;
  }, [activePipelineId, currentLocalPipelineScope, firstStaleStep, firstStaleStepIndex, localPipelineComplete, normalizedRouteRunId, progressStepIndexMap, validActivePipelineId]);
  const openWorkbenchStep = useCallback((requestedStepId, options = {}) => {
    const requested = normalizeWorkbenchStep(requestedStepId || '');
    const targetRunId = normalizeWorkbenchRunId(options?.pipelineId || validActivePipelineId || activePipelineId || normalizedRouteRunId);
    const targetRunComplete = Boolean(targetRunId) && isPipelineComplete({ ...currentLocalPipelineScope, pipeline_id: String(targetRunId) });
    const resolvedStep = options?.skipGuardRedirect || activePipelineType === 'mule'
      ? requested || 'pipelines'
      : targetRunComplete
      ? requested || 'pipelines'
      : resolveStepNavigation(requested || 'pipelines') || requested || 'pipelines';
    manualStepSelectionRef.current = {
      pipelineId: targetRunId || null,
      step: resolvedStep,
      ts: Date.now(),
    };
    flushSync(() => {
      setActiveStep(resolvedStep);
      if (shouldShowSummaryForStep(resolvedStep)) setSummaryOverlayStep(resolvedStep);
      else setSummaryOverlayStep('');
    });
    if (!targetRunId) {
      routeResumeRef.current = '';
      routeHydrationRef.current = '';
      navigate('/mlops/runs', { replace: Boolean(options?.replace), state: options?.state });
      return;
    }
    routeResumeRef.current = '';
    routeHydrationRef.current = `${currentEnvId}:${targetRunId}`;
    navigate(buildWorkbenchRoute(targetRunId, resolvedStep), {
      replace: Boolean(options?.replace),
      state: options?.state,
    });
  }, [activePipelineId, activePipelineType, currentEnvId, navigate, normalizedRouteRunId, resolveStepNavigation, shouldShowSummaryForStep, validActivePipelineId]);
  useEffect(() => {
    if (!normalizedRouteStep || !isWorkbenchStep(normalizedRouteStep)) return;
    setActiveStep((prev) => (prev === normalizedRouteStep ? prev : normalizedRouteStep));
  }, [normalizedRouteStep]);
  const activeSummaryStepKey = FCC_SUMMARY_STEP_MAP[String(summaryOverlayStep || activeStep || '').trim()] || '';
  const activeSummaryMetadata = activeSummaryStepKey ? (localSummaryMetadataByStep[activeSummaryStepKey] || {}) : {};
  const activeSummaryLabel = FCC_SUMMARY_STEP_LABELS[activeSummaryStepKey] || (flowSteps.find((step) => step.id === summaryOverlayStep)?.label || '');
  const closeSummaryOverlay = useCallback(() => {
    setSummaryOverlayStep('');
  }, []);
  useEffect(() => {
    if (!summaryOverlayStep) return;
    if (!activeStep) return;
    if (summaryOverlayStep === activeStep) return;
    setSummaryOverlayStep(activeStep);
  }, [activeStep, summaryOverlayStep]);
  useEffect(() => {
    if (activeStep === 'pipelines') return;
    if (STEPS.some((step) => step.id === activeStep)) return;
    const fallbackStep = STEPS[0]?.id || 'data';
    openWorkbenchStep(fallbackStep, { skipGuardRedirect: true, replace: true });
  }, [STEPS, activeStep, openWorkbenchStep]);
  const deriveResumeStep = useCallback((pipeline) => {
    const pipelineFamily = normalizePipelineFamily(
      pipeline?.pipeline_type
      || pipeline?.model_family
      || pipeline?.workflow_session?.pipeline_type
      || activePipelineType,
      'fcc',
    );
    const statuses = derivePipelineStepStatuses(pipeline || {});
    const firstAttentionStep = flowSteps.find((step) => (
      ['in_progress', 'invalidated', 'failed'].includes(String(statuses?.[step.id] || '').toLowerCase())
    ));
    if (firstAttentionStep) return firstAttentionStep.id;
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
    const completion = derivePipelineStepCompletion(pipeline || {});
    if (pipelineFamily === 'mule') {
      if (completion.validation) return 'validation';
      if (completion.model) return 'validation';
      if (completion.preprocess) return 'model';
      if (completion.featurestore) return 'preprocess';
      if (completion.master) return 'featurestore';
      return 'data';
    }
    if (completion.registry) return 'dashboard';
    if (completion.validation) return 'registry';
    if (completion.model) return 'validation';
    if (completion.preprocess) return 'model';
    if (completion.eda) return 'preprocess';
    if (completion.target) return 'eda';
    if (completion.master) return 'target';
    return 'data';
  }, [activePipelineType, flowSteps]);
  const openPipelineRoute = useCallback((pipelineRef, options = {}) => {
    const pipelineId = normalizeWorkbenchRunId(pipelineRef?.pipeline_id || pipelineRef || options?.pipelineId);
    if (!pipelineId) {
      navigate('/mlops/runs', { replace: Boolean(options?.replace), state: options?.state });
      return;
    }
    const targetStep = normalizeWorkbenchStep(options?.step || deriveResumeStep(pipelineRef)) || 'pipelines';
    const targetComplete = isPipelineComplete({
      pipeline_id: String(pipelineId),
      pipeline_uuid: pipelineRef?.pipeline_uuid || null,
      env_id: currentEnvId,
    });
    const pipelineTypeHint = normalizePipelineFamily(
      options?.pipeline_type
      || pipelineRef?.pipeline_type
      || pipelineRef?.model_family
      || '',
    );
    routeResumeRef.current = '';
    routeHydrationRef.current = `${currentEnvId}:${pipelineId}`;
    navigate(buildWorkbenchRoute(pipelineId, targetStep), {
      replace: Boolean(options?.replace),
      state: {
        ...(options?.state && typeof options.state === 'object' ? options.state : {}),
        pipeline_id: pipelineId,
        pipeline_name: String(options?.pipeline_name || pipelineRef?.name || '').trim() || undefined,
        pipeline_type: pipelineTypeHint || undefined,
        skipGuardRedirect: targetComplete || Boolean(options?.skipGuardRedirect),
      },
    });
  }, [currentEnvId, deriveResumeStep, navigate]);
  useEffect(() => {
    if (normalizedRouteRunId || hasPipelineContext) {
      setPipelineLauncherOpen(false);
    }
  }, [hasPipelineContext, normalizedRouteRunId]);
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
  const showContextPanel = !routePipelineHydrating && !isMobile && showContext && !isDashboard && activePipelineType !== 'mule' && viewportWidth >= contextMinViewport;
  const contextPanelWidth = viewportWidth >= 1880 ? D.contextW : 260;
  const releaseWorkflowStep = activeStep === 'registry';
  const stepHeaderLabel = releaseWorkflowStep
    ? (activePipelineType === 'mule'
      ? 'Publish to Sentinel'
      : 'Model Release, Registry & Deployment')
    : (persona === 'business' ? currentStepMeta?.biz : currentStepMeta?.label);
  const stepHeaderDescription = releaseWorkflowStep
    ? (activePipelineType === 'mule'
      ? 'Review and publish high-risk accounts to Sentinel.'
      : 'Review, register, approve, and deploy AML false positive suppression models.')
    : (currentStepMeta?.desc || 'Continue the current workbench stage.');

  const unfinishedPipelines = useMemo(
    () => (savedPipelines || []).filter((p) => !['complete', 'completed', 'done'].includes(String(p?.run_status || p?.status || 'saved').toLowerCase())),
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
    return null;
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
    current_step_label: progressSteps.find((step) => step.id === activeStep)?.label || activeStep,
    current_substep: activeSubstepState.key,
    current_substep_label: activeSubstepState.label,
    pipeline_type: activePipelineType,
    completion_pct: progressPct,
    completed_steps: doneCount,
    total_steps: progressSteps.length,
    run_status: progressPct >= 100 ? 'complete' : doneCount > 0 ? 'in_progress' : 'draft',
    persona,
    mode,
  }), [activePipelineType, activeStep, activeSubstepState, doneCount, mode, persona, progressPct, progressSteps, progressSteps.length]);

  const workflowCheckpointKey = useMemo(() => deriveWorkflowCheckpoint({
    pipelineType: activePipelineType,
    activeStep,
    datasets,
    masterDataset,
    featureStoreDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    activeModelRun,
    modelRun,
    validationReport,
    registryEntry,
  }), [
    activePipelineType,
    activeStep,
    datasets,
    masterDataset,
    featureStoreDataset,
    targetColumn,
    edaDone,
    preprocessDataset,
    activeModelRun,
    modelRun,
    validationReport,
    registryEntry,
  ]);
  const workflowStateSnapshot = useMemo(() => ({
    pipeline_type: activePipelineType,
    current_step: activeStep,
    current_step_label: progressSteps.find((step) => step.id === activeStep)?.label || activeStep,
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
    feature_store_dataset_id: Number(featureStoreDataset?.dataset_id || 0) || null,
    feature_store_dataset: compactDatasetSnapshot(featureStoreDataset),
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
    activePipelineType,
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
    featureStoreDataset?.dataset_id,
    featureStoreDataset,
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
    progressSteps,
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
      persistPipelineScreenState(pipelineId, 'workbench_journey', workbenchJourneyState).catch(() => {});
    }, 700);
    return () => {
      if (journeySaveTimerRef.current) clearTimeout(journeySaveTimerRef.current);
    };
  }, [persistPipelineScreenState, validActivePipelineId, workbenchJourneyState]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !activeModelRun?.job_id) return;
    if (screenStatePersistencePausedRef.current) return;
    persistPipelineScreenState(pipelineId, 'model', {
      job_id: activeModelRun.job_id,
      algorithm: activeModelRun.algorithm || activeModelRun.algorithm_id || '',
      dataset_id: Number(preprocessDataset?.dataset_id || masterDataset?.dataset_id || 0) || null,
      threshold: activeModelRun.threshold ?? null,
      selected_threshold: activeModelRun.selected_threshold ?? activeModelRun.threshold ?? null,
      active_model_run: compactModelRunSnapshot(activeModelRun),
      activeTab: modelActiveTab,
      activeTabLabel: MODEL_SUBSTEP_LABELS[modelActiveTab] || '',
    }).catch(() => {});
  }, [persistPipelineScreenState, validActivePipelineId, activeModelRun, preprocessDataset?.dataset_id, masterDataset?.dataset_id, modelActiveTab, compactModelRunSnapshot]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return;
    if (!validationReport && activeStep !== 'validation') return;
    if (screenStatePersistencePausedRef.current) return;
    const lockedThreshold = validationReport?.selected_threshold ?? validationReport?.locked_threshold ?? validationReport?.optimal_threshold ?? null;
    persistPipelineScreenState(pipelineId, 'validation', {
      job_id: activeModelRun?.job_id || modelRun?.job_id || '',
      optimal_threshold: validationReport?.optimal_threshold ?? null,
      selected_threshold: lockedThreshold,
      locked_threshold: lockedThreshold,
      report_id: validationReport?.report_id || validationReport?.validation_id || '',
      report: compactValidationSnapshot(validationReport),
      completed: Boolean((validationReport?.report_id || validationReport?.validation_id || activeModelRun?.job_id || modelRun?.job_id) && lockedThreshold != null),
      status: (validationReport?.report_id || validationReport?.validation_id || lockedThreshold != null) ? 'completed' : 'in_progress',
      activeTab: validationActiveTab,
      activeTabLabel: VALIDATION_SUBSTEP_LABELS[validationActiveTab] || '',
    }).catch(() => {});
  }, [persistPipelineScreenState, validActivePipelineId, validationReport, activeModelRun?.job_id, modelRun?.job_id, activeStep, validationActiveTab, compactValidationSnapshot]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return;
    if (screenStatePersistencePausedRef.current) return;
    const edaVisited = activeStep === 'eda';
    persistPipelineScreenState(pipelineId, 'eda', {
      completed: Boolean(edaDone),
      eda_completed: Boolean(edaDone),
      status: edaDone ? 'completed' : 'in_progress',
      target_column: targetColumn || '',
      viewed_step: edaVisited,
      activeTab: edaActiveTab,
      activeTabLabel: EDA_SUBSTEP_LABELS[edaActiveTab] || '',
    }).catch(() => {});
  }, [persistPipelineScreenState, validActivePipelineId, edaDone, targetColumn, activeStep, edaActiveTab]);

  useEffect(() => {
    const pipelineId = Number(validActivePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !registryEntry) return;
    if (screenStatePersistencePausedRef.current) return;
    persistPipelineScreenState(pipelineId, 'registry', {
      job_id: activeModelRun?.job_id || modelRun?.job_id || '',
      model_name: registryEntry?.model_name || activeModelRun?.model_name || activeModelRun?.label || activePipelineName || '',
      stage: registryEntry?.stage || 'candidate',
      threshold: registryEntry?.selected_threshold ?? registryEntry?.threshold ?? validationReport?.selected_threshold ?? validationReport?.locked_threshold ?? validationReport?.optimal_threshold ?? null,
      selected_threshold: registryEntry?.selected_threshold ?? registryEntry?.threshold ?? validationReport?.selected_threshold ?? validationReport?.locked_threshold ?? validationReport?.optimal_threshold ?? null,
      deployment_id: registryEntry?.deployment_id || '',
      entry: compactRegistryEntry(registryEntry),
      completed: Boolean(registryEntry?.job_id || registryEntry?.deployment_id),
      status: registryEntry?.deployment_id ? 'completed' : 'saved',
    }).catch(() => {});
  }, [persistPipelineScreenState, validActivePipelineId, registryEntry, activeModelRun?.job_id, activeModelRun?.label, activeModelRun?.model_name, modelRun?.job_id, validationReport?.optimal_threshold, validationReport?.selected_threshold, validationReport?.locked_threshold, activePipelineName, compactRegistryEntry]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    savePipelineRun(currentLocalPipelineScope, {
      pipeline_id: currentLocalPipelineId,
      pipeline_uuid: currentLocalPipelineScope.pipeline_uuid,
      env_id: currentEnvId,
      pipeline_type: activePipelineType,
      pipeline_name: activePipelineName || `FCC Run - ${currentLocalPipelineId}`,
      status: 'draft',
    });
  }, [activePipelineName, currentEnvId, currentLocalPipelineId, currentLocalPipelineScope, localPipelineSyncBlocked]);

  useEffect(() => {
    if (localPipelineSyncBlocked || !(datasets || []).length) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'data_upload', {
      status: 'done',
      metadata: localDataUploadMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, datasets, localDataUploadMetadata, localPipelineSyncBlocked]);

  useEffect(() => {
    if (localPipelineSyncBlocked || !masterDataset) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'master_dataset', {
      status: 'done',
      metadata: localMasterMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, localMasterMetadata, localPipelineSyncBlocked, masterDataset]);

  useEffect(() => {
    if (localPipelineSyncBlocked || !String(targetColumn || '').trim()) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'target_variable', {
      status: 'done',
      metadata: localTargetMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, localPipelineSyncBlocked, localTargetMetadata, targetColumn]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    if (!(Array.isArray(preprocessSteps) && preprocessSteps.length > 0) && !preprocessDataset) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'preprocessing', {
      status: preprocessDataset ? 'done' : 'in_progress',
      metadata: localPreprocessMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, localPipelineSyncBlocked, localPreprocessMetadata, preprocessDataset, preprocessSteps]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    if (!edaDone && !localPipelineComplete && !savedStepCompletion?.eda) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'eda', {
      status: 'done',
      metadata: localEdaMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, edaDone, localEdaMetadata, localPipelineComplete, localPipelineSyncBlocked, savedStepCompletion?.eda]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    if (!effectiveActiveModelRun?.job_id && !modelRun?.job_id) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'model_run', {
      status: 'done',
      metadata: localModelMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, effectiveActiveModelRun?.job_id, localModelMetadata, localPipelineSyncBlocked, modelRun?.job_id]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    const hasValidationPayload = Boolean(
      effectiveValidationReport?.report_id
      || effectiveValidationReport?.validation_id
      || effectiveValidationReport?.job_id
      || effectiveValidationReport?.run_id
      || localPipelineComplete
      || savedStepCompletion?.validation,
    );
    if (!hasValidationPayload) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'validation', {
      status: 'done',
      metadata: localValidationMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, effectiveValidationReport, localPipelineComplete, localPipelineSyncBlocked, localValidationMetadata, savedStepCompletion?.validation]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    const hasRegistryPayload = Boolean(
      effectiveRegistryEntry?.deployment_id
      || effectiveRegistryEntry?.job_id
      || effectiveRegistryEntry?.stage
      || localPipelineComplete
      || savedStepCompletion?.registry,
    );
    if (!hasRegistryPayload) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'registry', {
      status: 'done',
      metadata: localRegistryMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, effectiveRegistryEntry, localPipelineComplete, localPipelineSyncBlocked, localRegistryMetadata, savedStepCompletion?.registry]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    if (!effectiveValidationReport && !effectiveRegistryEntry && !savedDashboardState) return;
    const hasLiveDashboardState = Boolean(
      effectiveRegistryEntry?.deployment_id
      || savedDashboardState?.publish_id
      || savedDashboardState?.deployment_id
      || savedDashboardState?.simulation_result?.publish?.publish_id
      || savedDashboardState?.simulation_result?.deployment_id,
    );
    const next = updatePipelineStep(currentLocalPipelineScope, 'live_dashboard', {
      status: hasLiveDashboardState ? 'done' : 'in_progress',
      metadata: localDashboardMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, effectiveRegistryEntry, effectiveValidationReport, localDashboardMetadata, localPipelineSyncBlocked, savedDashboardState]);

  useEffect(() => {
    if (localPipelineSyncBlocked) return;
    const hasReportPayload = Boolean(
      localReportMetadata.run_id
      || localReportMetadata.report_id
      || localPipelineComplete
      || savedStepCompletion?.reports,
    );
    if (!hasReportPayload) return;
    const next = updatePipelineStep(currentLocalPipelineScope, 'reports', {
      status: 'done',
      metadata: localReportMetadata,
    });
    setSavedLocalPipelineRun(next);
  }, [currentLocalPipelineScope, localPipelineComplete, localPipelineSyncBlocked, localReportMetadata, savedStepCompletion?.reports]);

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
    const isMulePipeline = activePipelineType === 'mule';
    if (!isMulePipeline && localPipelineComplete) return null;
    const hasData            = isMulePipeline
      ? ((datasets || []).length > 0 || Number(muleBackendStatus?.data?.sources_loaded || 0) > 0)
      : (datasets || []).length > 0;
    const hasMaster          = isMulePipeline
      ? (!!masterDataset || String(muleBackendStatus?.master?.build_status || '').trim().toLowerCase() === 'built')
      : !!masterDataset;
    const hasFeatureStore    = isMulePipeline
      ? (
        !!featureStoreDataset
        || ['ready', 'generated', 'built'].includes(
          String(
            muleBackendStatus?.featurestore?.generation_status
            || muleBackendStatus?.featurestore?.feature_store_status
            || '',
          ).trim().toLowerCase(),
        )
      )
      : !!featureStoreDataset;
    const hasTarget          = !!targetColumn;
    const hasPreprocess      = isMulePipeline
      ? (!!preprocessDataset || String(muleBackendStatus?.preprocess?.build_status || '').trim().toLowerCase() === 'built')
      : !!preprocessDataset;
    const hasModel           = isMulePipeline
      ? (!!modelRun || Boolean(muleBackendStatus?.model?.latest_run?.run_id))
      : !!modelRun;
    const hasRegistry        = !!registryEntry;
    const hasDatasetForTraining = hasPreprocess || hasMaster;
    if (isMulePipeline) {
      switch (activeStep) {
        case 'master':     return hasData ? null : 'Please upload Mule source data before building the master dataset.';
        case 'featurestore': return hasMaster ? null : 'Please build the Mule master dataset before opening Feature Store.';
        case 'preprocess': return hasFeatureStore ? null : 'Please generate and review the Mule feature store before opening Preprocessing & Feature Selection.';
        case 'model':      return hasPreprocess ? null : 'Please prepare the Mule feature dataset and governance decisions before model build.';
        case 'validation': return hasModel ? null : 'Please train the Mule model before opening Model Output.';
        default:           return null;
      }
    }
    switch (activeStep) {
      case 'master':     return hasData    ? null : (isMulePipeline ? 'Please complete Step 1 (Load Mule Data) before building the analytical dataset.' : 'Please complete Step 1 (Load Data) before building a master dataset.');
      case 'target':     return hasMaster  ? null : (isMulePipeline ? 'Please complete Step 2 (Build Analytical Dataset) before defining the mule outcome.' : 'Please complete Step 2 (Combine Tables) before selecting a target.');
      case 'eda':        return hasMaster  ? null : (isMulePipeline ? 'Please complete Step 2 (Build Analytical Dataset) before creating mule risk indicators.' : 'Please complete Step 2 (Combine Tables) before exploring data.');
      case 'preprocess': return hasMaster  ? null : (isMulePipeline ? 'Please complete Step 2 (Build Analytical Dataset) before training the mule detection model.' : 'Please complete Step 2 (Combine Tables) before preprocessing.');
      case 'model':
        if (!hasDatasetForTraining) return isMulePipeline ? 'Please complete Step 2 or Step 4 to prepare a dataset for mule training.' : 'Please complete Step 2 or Step 5 to prepare a dataset for training.';
        if (!hasTarget) return isMulePipeline ? 'Please complete Step 3 (Define Mule Outcome) before training.' : 'Please complete Step 3 (Target Variable) before training.';
        return null;
      case 'validation': return hasModel   ? null : (isMulePipeline ? 'Please complete Step 5 (Train Mule Detection Model) before reviewing typology signals.' : 'Please complete Step 6 (Train Model) before validation.');
      case 'registry':   return hasModel   ? null : (isMulePipeline ? 'Please complete Step 6 before publishing to Sentinel.' : 'Please complete Step 6 (Train Model) before registering.');
      case 'ready':      return hasRegistry ? null : 'Please complete Step 8 (Register Model) before deploy.';
      case 'dashboard':  return (hasRegistry || hasModel) ? null : 'Please complete Step 8 or Step 9 before monitoring.';
      default:           return null;
    }
  }, [activePipelineType, activeStep, datasets, featureStoreDataset, localPipelineComplete, masterDataset, modelRun, muleBackendStatus?.data?.sources_loaded, muleBackendStatus?.featurestore?.feature_store_status, muleBackendStatus?.featurestore?.generation_status, muleBackendStatus?.master?.build_status, muleBackendStatus?.model?.latest_run?.run_id, muleBackendStatus?.preprocess?.build_status, preprocessDataset, registryEntry, targetColumn]);

  const staleBannerMessage = useMemo(() => {
    const activeDetail = activePipelineMeta?.stale_details?.[activeStep];
    if (activeDetail?.message) return activeDetail.message;
    if (latestDependencyChange?.message) return latestDependencyChange.message;
    return null;
  }, [activePipelineMeta, activeStep, latestDependencyChange]);
  useEffect(() => {
    const nextMessage = String(guardMessage || staleBannerMessage || '').trim();
    if (!nextMessage) return;
    const nextSeverity = guardMessage ? 'warning' : 'info';
    const signature = `${nextSeverity}:${nextMessage}`;
    if (floatingNoticeSignatureRef.current === signature) return;
    floatingNoticeSignatureRef.current = signature;
    setFloatingNotice({
      open: true,
      message: nextMessage,
      severity: nextSeverity,
    });
  }, [guardMessage, staleBannerMessage]);
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

  const handleFeatureStoreComplete = useCallback(async () => {
    await loadDatasets({ sync: true });
  }, [loadDatasets]);

  const handlePreprocessPreview = useCallback(async (stepsOverride = null) => {
    const preprocessingInput = featureStoreDataset || masterDataset;
    if (!preprocessingInput) return;
    const stepsToUse = normalizePreprocessSteps(Array.isArray(stepsOverride) ? stepsOverride : preprocessSteps);
    try {
      if (activePipelineType === 'mule' && Number.isFinite(Number(validActivePipelineId)) && Number(validActivePipelineId) > 0) {
        const res = await mlopsApi.mulePreprocessingPreview(Number(validActivePipelineId), {
          input_dataset_id: preprocessingInput.dataset_id,
          source_dataset_key: featureStoreDataset ? 'feature_store' : 'master',
          target_column: targetColumn || 'mule_flag',
          steps: stepsToUse,
          output_table_name: `mule_feature_studio_${Number(validActivePipelineId)}`,
          sample_rows: 100,
        });
        const payload = unwrapApiPayload(res);
        const normalized = payload?.preview_contract || payload?.preview || payload;
        setPreprocessPreview(normalized);
        return normalized;
      }
      const res = await mlopsApi.preprocessPreview({ dataset_id: preprocessingInput.dataset_id, steps: stepsToUse, target_column: targetColumn });
      const normalized = res.data || res;
      setPreprocessPreview(normalized);
      return normalized;
    } catch (e) { console.error(e); }
    return null;
  }, [activePipelineType, featureStoreDataset, masterDataset, preprocessSteps, targetColumn, validActivePipelineId]);

  const handlePreprocessRun = useCallback(async (outputName, stepsOverride = null) => {
    const preprocessingInput = featureStoreDataset || masterDataset;
    if (!preprocessingInput) return;
    const stepsToUse = normalizePreprocessSteps(Array.isArray(stepsOverride) ? stepsOverride : preprocessSteps);
    console.log('[FCC preprocessing] run click steps', stepsToUse);
    try {
      if (activePipelineType === 'mule' && Number.isFinite(Number(validActivePipelineId)) && Number(validActivePipelineId) > 0) {
        const res = await mlopsApi.mulePreprocessingRun(Number(validActivePipelineId), {
          input_dataset_id: preprocessingInput.dataset_id,
          source_dataset_key: featureStoreDataset ? 'feature_store' : 'master',
          target_column: targetColumn || 'mule_flag',
          steps: stepsToUse,
          output_table_name: String(outputName || `mule_feature_studio_${Number(validActivePipelineId)}`).trim() || `mule_feature_studio_${Number(validActivePipelineId)}`,
        });
        const payload = unwrapApiPayload(res);
        const built = payload?.dataset || payload?.output?.dataset || null;
        const previewLike = payload?.output || payload?.preview_contract || null;
        if (previewLike) setPreprocessPreview(previewLike);
        if (built?.dataset_id) {
          setPreprocessDataset(built);
          await loadDatasets({ sync: true });
        }
        return payload;
      }
      const res   = await mlopsApi.preprocessRun({ dataset_id: preprocessingInput.dataset_id, steps: stepsToUse, target_column: targetColumn, output_name: outputName });
      const built = res.data?.dataset || res.dataset || res.data || res;
      if (built?.dataset_id) { setPreprocessDataset(built); await loadDatasets(); }
      return res?.data || res;
    } catch (e) { console.error(e); }
    return null;
  }, [activePipelineType, featureStoreDataset, masterDataset, preprocessSteps, targetColumn, loadDatasets, validActivePipelineId]);

  const handleSnapshot = async () => {
    try { await mlopsApi.createSnapshot({ experiment_name: experimentName, dataset_ids: datasets.map((d) => d.dataset_id) }); }
    catch (e) { console.error(e); }
  };

  const handleQualityRun = async () => {
    if (!masterDataset) return;
    try { const res = await mlopsApi.qualityScore({ dataset_id: masterDataset.dataset_id }); setQualityScore(res.data || res); }
    catch (e) { console.error(e); }
  };

  const createPipelineRun = useCallback(async (name, options = {}) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Run name is required.');
    const freshStep = 'data';
    const pipelineType = String(options?.pipeline_type || options?.model_family || 'fcc').trim().toLowerCase() || 'fcc';
    const stageOrder = pipelineType === 'mule'
      ? ['data', 'master', 'featurestore', 'preprocess', 'model', 'validation']
      : ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry'];
    const payload = {
      name: trimmed,
      dataset_id: 0,
      dataset_ids: [],
      pipeline_type: pipelineType,
      created_by_persona: persona || 'technical',
      steps: [{
        type: 'screen_state',
        screen: 'pipeline_hub',
        state: {
          stage_order: stageOrder,
          created_from: 'workbench',
        },
      }],
    };
    const res = await mlopsApi.pipelineSave(payload);
    const savedPipeline = res?.data || res || {};
    const savedPipelineId = Number(savedPipeline?.pipeline_id || 0);
    if (!Number.isFinite(savedPipelineId) || savedPipelineId <= 0) {
      throw new Error('Pipeline creation did not return a durable pipeline id.');
    }
    let verifiedPipeline = savedPipeline;
    try {
      const verifyRes = await mlopsApi.pipelineGet(savedPipelineId);
      const loaded = verifyRes?.data || verifyRes || null;
      if (loaded?.pipeline_id) {
        verifiedPipeline = loaded;
      } else {
        throw new Error('Created pipeline could not be reloaded from backend persistence.');
      }
    } catch (verifyError) {
      throw new Error(verifyError?.message || 'Created pipeline could not be verified from backend persistence.');
    }
    const freshWorkflowState = {
      pipeline_type: pipelineType,
      pipeline_id: verifiedPipeline.pipeline_id,
      pipeline_name: trimmed,
      current_step: freshStep,
      preferred_screen: freshStep,
      datasets: [],
      master_dataset_id: null,
      master_dataset: null,
      feature_store_dataset_id: null,
      feature_store_dataset: null,
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
      workflowSessionRef.current = null;
      const sessionRes = await mlopsApi.saveWorkflowSession({
        pipeline_id: verifiedPipeline.pipeline_id,
        pipeline_name: trimmed,
        current_module: 'mlops',
        current_step: freshStep,
        current_state: {
          mlops_state: {
            ...freshWorkflowState,
            pipeline_id: verifiedPipeline.pipeline_id,
            pipeline_name: trimmed,
            pipeline_type: pipelineType,
          },
          pipeline_id: verifiedPipeline.pipeline_id,
          pipeline_name: trimmed,
          pipeline_type: pipelineType,
          preferred_screen: freshStep,
        },
        checkpoint_key: deriveWorkflowCheckpoint({
          pipelineType,
          activeStep: freshStep,
          datasets: [],
          masterDataset: null,
          featureStoreDataset: null,
          targetColumn: '',
          edaDone: false,
          preprocessDataset: null,
          activeModelRun: null,
          modelRun: null,
          validationReport: null,
          registryEntry: null,
        }),
        mark_current_stable: false,
        status: 'draft',
      });
      const session = sessionRes?.session || sessionRes?.data?.session || null;
      if (session?.session_id) {
        workflowSessionRef.current = session;
        verifiedPipeline = {
          ...verifiedPipeline,
          workflow_session_id: session.session_id,
        };
      } else {
        throw new Error('Run session could not be persisted.');
      }
    } catch (sessionError) {
      workflowSessionRef.current = null;
      setPipelineSelectionNotice(
        `Saved "${trimmed}" to backend, but its resume session could not be created yet. You can still reopen it from Pipeline Hub.`,
      );
      console.error('Failed to persist workflow session for new pipeline', sessionError);
    }
    setSavedPipelines((prev) => {
      const rows = Array.isArray(prev) ? [...prev] : [];
      const nextPipelineId = Number(verifiedPipeline?.pipeline_id || 0);
      if (!Number.isFinite(nextPipelineId) || nextPipelineId <= 0) return rows;
      const nextRow = { ...verifiedPipeline, pipeline_id: nextPipelineId, name: trimmed };
      const idx = rows.findIndex((row) => Number(row?.pipeline_id || 0) === nextPipelineId);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...nextRow };
        return rows;
      }
      return [nextRow, ...rows];
    });
    pauseScreenStatePersistence();
    clearLocalWorkbenchState();
    setSavedLocalPipelineRun(null);
    setSummaryOverlayStep('');
    setStepDirtyMap({});
    setActiveStep(freshStep);
    activatePipeline({ ...verifiedPipeline, pipeline_id: verifiedPipeline.pipeline_id, name: trimmed }, { step: freshStep });
    setExperimentName(trimmed);
    setPipelineLauncherOpen(false);
    resumeScreenStatePersistence();
    await loadSavedPipelines();
    return verifiedPipeline;
  }, [activatePipeline, clearLocalWorkbenchState, loadSavedPipelines, pauseScreenStatePersistence, persona, resumeScreenStatePersistence]);

  const handleStartNewPipeline = useCallback(() => {
    setNewPipelineName('');
    setNewPipelineType(activePipelineType);
    setNewPipelineError('');
    setCreatePipelineDialogOpen(true);
    setPipelineLauncherOpen(false);
  }, [activePipelineType]);

  const handleConfirmCreatePipeline = useCallback(async () => {
    const trimmed = String(newPipelineName || '').trim();
    if (!trimmed) { setNewPipelineError('Run name is required.'); return; }
    const duplicateName = (savedPipelines || []).some((p) => String(p?.name || '').trim().toLowerCase() === trimmed.toLowerCase());
    if (duplicateName) { setNewPipelineError('Run name already exists. Use a different name to create a fresh run.'); return; }
    setCreatingPipeline(true);
    setNewPipelineError('');
    try {
      await createPipelineRun(trimmed, { pipeline_type: newPipelineType });
      setCreatePipelineDialogOpen(false);
      setNewPipelineName('');
    } catch (e) {
      setNewPipelineError(e?.response?.data?.error || e?.message || 'Failed to create run.');
    } finally {
      setCreatingPipeline(false);
    }
  }, [createPipelineRun, newPipelineName, newPipelineType, savedPipelines]);

  const resumePipeline = useCallback(async (pipelineRef, options = {}) => {
    const workflowSessionId = String(
      pipelineRef?.workflow_session_id
      || pipelineRef?.session_id
      || '',
    ).trim();
    const pipelineId = Number(pipelineRef?.pipeline_id || pipelineRef || 0);
    const explicitStep = normalizeWorkbenchStep(options?.preferredStep || '');
    resumeInProgressRef.current = true;
    try {
      pauseWorkflowPersistence();
      pauseScreenStatePersistence();
      clearLocalWorkbenchState();
      if (explicitStep && isWorkbenchStep(explicitStep)) {
        setActiveStep(explicitStep);
      }
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
          pipeline_type: String(
            session?.pipeline_type
            || pipelineRef?.pipeline_type
            || pipelineRef?.model_family
            || 'fcc'
          ).trim().toLowerCase() === 'mule' ? 'mule' : 'fcc',
        });
        let parsed = await loadDatasets({ sync: false, pipelineId: sessionPipelineId });
        if (!(parsed?.all?.length > 0)) parsed = await loadDatasets({ sync: true, pipelineId: sessionPipelineId });
        restoreWorkflowRuntimeState(session, parsed?.all || [], {
          suppressStepRestore: Boolean(explicitStep),
        });
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
      let parsed = await loadDatasets({ sync: false, pipelineId });
      if (!(parsed?.all?.length > 0)) parsed = await loadDatasets({ sync: true, pipelineId });
      const workflowSession = full?.workflow_session || null;
      const runtimeState = full?.runtime_state && typeof full.runtime_state === 'object' ? full.runtime_state : {};
      if (workflowSession?.session_id) {
        workflowSessionRef.current = workflowSession;
        writePipelineSession(currentEnvId, {
          pipeline_id: Number(full?.pipeline_id || pipelineId) || null,
          name: String(full?.name || workflowSession?.pipeline_name || '').trim(),
          workflow_session_id: workflowSession.session_id,
          pipeline_type: String(
            full?.pipeline_type
            || full?.model_family
            || workflowSession?.pipeline_type
            || 'fcc'
          ).trim().toLowerCase() === 'mule' ? 'mule' : 'fcc',
        });
        restoreWorkflowRuntimeState(workflowSession, parsed?.all || [], {
          suppressStepRestore: Boolean(explicitStep),
        });
      }

      const dataState       = getScreenState(full?.steps, 'data_upload')  || {};
      const masterState     = getScreenState(full?.steps, 'master')       || {};
      const featureStoreState = getScreenState(full?.steps, 'mule_featurestore') || getScreenState(full?.steps, 'feature_store') || {};
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

      const resumedFeatureStore = firstById([
        featureStoreState?.featureStoreDatasetId,
        featureStoreState?.outputDatasetId,
        featureStoreState?.dataset_id,
      ]);
      if (resumedFeatureStore) setFeatureStoreDataset(resumedFeatureStore);

      const resumedPreprocessed = firstById([
        preprocessState?.preprocessedDatasetId,
        preprocessState?.outputDatasetId,
      ]);
      if (isPreprocessDatasetSnapshot(resumedPreprocessed)) setPreprocessDataset(resumedPreprocessed);

      const resumedMaster = firstById([
        masterState?.builtMasterDatasetId,
        masterState?.outputDatasetId,
        preprocessState?.masterDatasetId,
        full?.output_dataset_id,
      ]);
      if (resumedMaster) {
        if (isPreprocessDatasetSnapshot(resumedMaster)) {
          setPreprocessDataset((prev) => prev || resumedMaster);
        } else if (isMasterDatasetSnapshot(resumedMaster)) {
          setMasterDataset(resumedMaster);
        }
      }

      const restoredTarget = String(targetState?.currentTargetColumn || targetState?.selectedTargetColumn || '').trim();
      if (restoredTarget) setTargetColumn(restoredTarget);
      setEdaDone(Boolean(edaState?.completed || edaState?.done || edaState?.eda_completed || edaState?.status === 'completed'));
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
        extractPipelineTrainingJobId(full)
        || runtimeState?.model_job_id
        || nestedRunId(runtimeState?.active_model_run)
        || modelState?.job_id
        || nestedRunId(modelState?.active_model_run)
        || runtimeState?.validation_report?.job_id
        || validationState?.job_id
        || nestedRunId(validationState?.report)
        || runtimeState?.registry_entry?.job_id
        || registryState?.job_id
        || nestedRunId(registryState?.entry)
        || dashboardState?.run_id
        || '',
      ).trim();
      if (restoredRunId) {
        let restoredRun = null;
        let restoredRunDetail = null;
        let restoredValidationDetail = null;
        let restoredRegistryEntry = null;
        const savedModelSnapshot = modelState?.active_model_run && typeof modelState.active_model_run === 'object'
          ? modelState.active_model_run
          : (runtimeState?.active_model_run && typeof runtimeState.active_model_run === 'object' ? runtimeState.active_model_run : null);
        const savedValidationSnapshot = validationState?.report && typeof validationState.report === 'object'
          ? validationState.report
          : (runtimeState?.validation_report && typeof runtimeState.validation_report === 'object' ? runtimeState.validation_report : null);
        const savedRegistrySnapshot = registryState?.entry && typeof registryState.entry === 'object'
          ? registryState.entry
          : (runtimeState?.registry_entry && typeof runtimeState.registry_entry === 'object' ? runtimeState.registry_entry : null);
        try {
          const [runDetailRes, validationDetailRes, registryEntryRes, runListRes] = await Promise.all([
            mlopsApi.modelResults(restoredRunId).catch(() => null),
            mlopsApi.validationDetail(restoredRunId).catch(() => null),
            mlopsApi.getRegistryEntry(restoredRunId).catch(() => null),
            mlopsApi.listTrainingRuns({
              limit: 200,
              ...(Number.isFinite(Number(full?.pipeline_id || 0)) && Number(full?.pipeline_id || 0) > 0
                ? { pipeline_id: Number(full.pipeline_id) }
                : {}),
            }).catch(() => null),
          ]);
          restoredRunDetail = unwrapApiPayload(runDetailRes) || null;
          restoredValidationDetail = unwrapApiPayload(validationDetailRes) || null;
          restoredRegistryEntry = unwrapApiPayload(registryEntryRes) || null;
          const runRowsPayload = unwrapApiPayload(runListRes);
          const runRows = Array.isArray(runRowsPayload) ? runRowsPayload : [];
          restoredRun = runRows.find((row) => String(row?.job_id || '') === restoredRunId) || null;
        } catch {
          restoredRun = null;
        }
        restoredRunDetail = restoredRunDetail || savedModelSnapshot;
        restoredValidationDetail = restoredValidationDetail || savedValidationSnapshot;
        restoredRegistryEntry = restoredRegistryEntry || savedRegistrySnapshot;

        const thresholdHint = Number(
          restoredRegistryEntry?.selected_threshold
          ?? restoredRegistryEntry?.threshold
          ?? restoredValidationDetail?.selected_threshold
          ?? restoredValidationDetail?.locked_threshold
          ?? restoredValidationDetail?.optimal_threshold
          ?? validationState?.selected_threshold
          ?? validationState?.locked_threshold
          ?? validationState?.optimal_threshold
          ?? dashboardState?.threshold
          ?? modelState?.threshold
          ?? 0.5,
        );
        const normalizedRun = {
          ...(savedModelSnapshot || {}),
          ...(restoredRun || {}),
          ...(restoredRunDetail || {}),
          job_id: restoredRunId,
          algorithm: restoredRunDetail?.algorithm || restoredRun?.algorithm || modelState?.algorithm || 'saved_run',
          model_name: restoredRegistryEntry?.model_name || restoredRunDetail?.model_name || restoredRun?.model_name || activePipelineName || '',
          label: restoredRegistryEntry?.model_name || restoredRunDetail?.label || restoredRun?.label || activePipelineName || '',
          metrics: restoredRunDetail?.metrics || restoredRun?.metrics || {},
          results: restoredRunDetail?.results || restoredRun?.results,
          threshold: Number.isFinite(thresholdHint) ? thresholdHint : 0.5,
          selected_threshold: Number.isFinite(thresholdHint) ? thresholdHint : 0.5,
          grain: restoredRunDetail?.grain || restoredRun?.grain || registryState?.grain || 'alert',
        };
        setActiveModelRun(normalizedRun);
        setModelRun({
          job_id: normalizedRun.job_id,
          algorithm: normalizedRun.algorithm,
          model_name: normalizedRun.model_name,
          algorithm_id: normalizedRun.algorithm_id,
          auc: normalizedRun.auc ?? normalizedRun.metrics?.roc_auc,
          metrics: normalizedRun.metrics || {},
          results: normalizedRun.results,
          grain: normalizedRun.grain,
          threshold: normalizedRun.threshold,
          selected_threshold: normalizedRun.selected_threshold,
        });
        setReportRunId(restoredRunId);
        const restoredValidationThreshold = restoredValidationDetail?.selected_threshold
          ?? restoredValidationDetail?.locked_threshold
          ?? restoredValidationDetail?.optimal_threshold
          ?? validationState?.selected_threshold
          ?? validationState?.locked_threshold
          ?? validationState?.optimal_threshold;
        if (restoredValidationThreshold != null || validationState?.report_id || restoredValidationDetail?.report_id) {
          setValidationReport({
            ...validationState,
            ...(restoredValidationDetail || {}),
            job_id: restoredValidationDetail?.job_id || validationState?.job_id || restoredRunId || '',
            report_id: restoredValidationDetail?.report_id || validationState?.report_id || '',
            optimal_threshold: Number(restoredValidationDetail?.optimal_threshold ?? restoredValidationThreshold ?? dashboardState?.threshold ?? 0.5),
            selected_threshold: Number(restoredValidationDetail?.selected_threshold ?? restoredValidationThreshold ?? dashboardState?.threshold ?? 0.5),
            locked_threshold: Number(restoredValidationDetail?.locked_threshold ?? restoredValidationThreshold ?? dashboardState?.threshold ?? 0.5),
          });
        }

        const restoredDeploymentId = String(
          restoredRegistryEntry?.deployment_id
          || registryState?.deployment_id
          || dashboardState?.deployment_id
          || '',
        ).trim();
        if (restoredDeploymentId || restoredRegistryEntry?.job_id || registryState?.job_id || restoredRunId) {
          const restoredRegistryThreshold = Number(
            restoredRegistryEntry?.selected_threshold
            ?? restoredRegistryEntry?.threshold
            ?? registryState?.selected_threshold
            ?? registryState?.threshold
            ?? restoredValidationThreshold
            ?? dashboardState?.threshold
            ?? 0.5,
          );
          setRegistryEntry({
            ...registryState,
            ...(restoredRegistryEntry || {}),
            job_id: restoredRegistryEntry?.job_id || registryState?.job_id || restoredRunId || '',
            model_name: restoredRegistryEntry?.model_name || registryState?.model_name || activePipelineName || '',
            deployment_id: restoredDeploymentId,
            threshold: Number.isFinite(restoredRegistryThreshold) ? restoredRegistryThreshold : 0.5,
            selected_threshold: Number.isFinite(restoredRegistryThreshold) ? restoredRegistryThreshold : 0.5,
            stage: restoredRegistryEntry?.stage || registryState?.stage || (restoredDeploymentId ? 'deployed' : 'candidate'),
            grain: restoredRegistryEntry?.grain || registryState?.grain || 'alert',
          });
        }
      }

      const requestedStep = String(
        workflowSession?.current_state?.mlops_state?.current_step
        || workflowSession?.last_stable_state?.mlops_state?.current_step
        || workflowSession?.current_step
        || runtimeState?.current_step
        || journeyState?.current_step
        || '',
      ).trim().toLowerCase();
      const normalizedStep = requestedStep === 'data_upload' ? 'data' : requestedStep;
      const savedStatuses = derivePipelineStepStatuses(full || {});
      const resumedPipelineType = normalizePipelineFamily(
        full?.pipeline_type
        || full?.model_family
        || workflowSession?.pipeline_type
        || pipelineRef?.pipeline_type
        || pipelineRef?.model_family
        || activePipelineType,
        'fcc',
      );
      const resumedFlowSteps = getWorkbenchSteps(resumedPipelineType).filter((step) => step.id !== 'pipelines');
      const firstAttentionStep = resumedFlowSteps.find((step) => (
        ['in_progress', 'invalidated', 'failed'].includes(String(savedStatuses?.[step.id] || '').toLowerCase())
      ))?.id || '';
      const resumeStaleStep = resumedFlowSteps.find((step) => (full?.stale_steps || []).includes(step.id))?.id || '';
      const completion     = derivePipelineStepCompletion(full || {});
      const pipelineStatus = String(full?.status || '').toLowerCase();
      const manualOverride = manualStepSelectionRef.current || {};
      const lockedStep = (
        Number(manualOverride.pipelineId || 0) === Number(full?.pipeline_id || pipelineRef?.pipeline_id || 0)
        && String(manualOverride.step || '').trim()
        && (Date.now() - Number(manualOverride.ts || 0)) < MANUAL_STEP_OVERRIDE_MS
        && isWorkbenchStep(String(manualOverride.step || '').trim())
      ) ? normalizeWorkbenchStep(manualOverride.step) : '';
      if (explicitStep && isWorkbenchStep(explicitStep)) setActiveStep(explicitStep);
      else if (lockedStep) setActiveStep(lockedStep);
      else if (firstAttentionStep) setActiveStep(firstAttentionStep);
      else if (resumeStaleStep) setActiveStep(resumeStaleStep);
      else if (normalizedStep && resumedFlowSteps.some((step) => step.id === normalizedStep)) setActiveStep(normalizedStep);
      else if (['complete', 'completed', 'done'].includes(pipelineStatus)) setActiveStep('pipelines');
      else if (resumedPipelineType === 'mule' && completion.validation) setActiveStep('validation');
      else if (resumedPipelineType === 'mule' && completion.model) setActiveStep('validation');
      else if (resumedPipelineType === 'mule' && completion.preprocess) setActiveStep('model');
      else if (resumedPipelineType === 'mule' && completion.featurestore) setActiveStep('preprocess');
      else if (resumedPipelineType === 'mule' && completion.master) setActiveStep('featurestore');
      else if (resumedPipelineType !== 'mule' && completion.preprocess)   setActiveStep('preprocess');
      else if (resumedPipelineType !== 'mule' && completion.eda)          setActiveStep('eda');
      else if (resumedPipelineType !== 'mule' && completion.target)       setActiveStep('target');
      else if (resumedPipelineType !== 'mule' && completion.master)       setActiveStep('master');
      else                              setActiveStep('data');

      setPipelineLauncherOpen(false);
    } catch (e) { console.error('Failed to resume pipeline', e); }
    finally {
      resumeInProgressRef.current = false;
      setTimeout(() => {
        resumeScreenStatePersistence();
        resumeWorkflowPersistence();
      }, 0);
    }
  }, [activatePipeline, activePipelineName, clearLocalWorkbenchState, currentEnvId, flowSteps, isMasterDatasetSnapshot, isPreprocessDatasetSnapshot, loadDatasets, pauseScreenStatePersistence, pauseWorkflowPersistence, restoreWorkflowRuntimeState, resumeScreenStatePersistence, resumeWorkflowPersistence]);

  useEffect(() => {
    if (!savedPipelinesLoaded) return;
    if (!normalizedRouteRunId) {
      routeResumeRef.current = '';
      routeHydrationRef.current = '';
      setActiveStep((prev) => (prev === 'pipelines' ? prev : 'pipelines'));
      return;
    }

    const routeBaseKey = `${currentEnvId}:${normalizedRouteRunId}`;
    const routeKey = `${routeBaseKey}:${normalizedRouteStep || 'pipelines'}`;
    const routeHydrated =
      Number(validActivePipelineId || 0) === Number(normalizedRouteRunId)
      && routeHydrationRef.current === routeBaseKey;

    if (!routeHydrated) {
      if (routeResumeRef.current === routeKey) return;
      routeResumeRef.current = routeKey;
      if (normalizedRouteStep && isWorkbenchStep(normalizedRouteStep)) {
        setActiveStep((prev) => (prev === normalizedRouteStep ? prev : normalizedRouteStep));
      }
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
        routeHydrationRef.current = routeBaseKey;
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
    setValidationReport((prev) => {
      const next = {
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
      };
      const prevSignature = JSON.stringify({
        job_id: prev?.job_id || '',
        selected_threshold: prev?.selected_threshold ?? prev?.locked_threshold ?? prev?.optimal_threshold ?? null,
        optimal_threshold: prev?.optimal_threshold ?? prev?.metrics?.optimal_threshold ?? null,
        report_id: prev?.report_id || prev?.validation_id || '',
        business_summary: prev?.business_summary?.conclusion || prev?.business_summary?.generated_for || '',
        metric_signature: {
          roc_auc: prev?.metrics?.roc_auc ?? null,
          f1: prev?.metrics?.f1 ?? null,
          precision: prev?.metrics?.precision ?? null,
          recall: prev?.metrics?.recall ?? null,
          suppression_rate_pct: prev?.suppression_rate_pct ?? null,
          event_loss_pct: prev?.event_loss_pct ?? null,
        },
      });
      const nextSignature = JSON.stringify({
        job_id: next.job_id || '',
        selected_threshold: next?.selected_threshold ?? next?.locked_threshold ?? next?.optimal_threshold ?? null,
        optimal_threshold: next?.optimal_threshold ?? next?.metrics?.optimal_threshold ?? null,
        report_id: next?.report_id || next?.validation_id || '',
        business_summary: next?.business_summary?.conclusion || next?.business_summary?.generated_for || '',
        metric_signature: {
          roc_auc: next?.metrics?.roc_auc ?? null,
          f1: next?.metrics?.f1 ?? null,
          precision: next?.metrics?.precision ?? null,
          recall: next?.metrics?.recall ?? null,
          suppression_rate_pct: next?.suppression_rate_pct ?? null,
          event_loss_pct: next?.event_loss_pct ?? null,
        },
      });
      return prevSignature === nextSignature ? prev : next;
    });
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

  const handleContinueToRelease = useCallback((payload = {}) => {
    const nextRun = payload?.activeModelRun || activeModelRun || modelRun || null;
    const nextValidationReport = payload?.validationReport || validationReport || null;
    flushSync(() => {
      if (nextRun?.job_id || nextRun?.run_id) {
        adoptModelRun(nextRun, { resetDownstream: false });
      }
      if (nextValidationReport && typeof nextValidationReport === 'object') {
        handleValidationStateChange(nextValidationReport);
      }
    });
    openWorkbenchStep('registry', {
      skipGuardRedirect: true,
      state: {
        registryHandoff: {
          activeModelRun: nextRun,
          validationReport: nextValidationReport,
        },
      },
    });
  }, [
    activeModelRun,
    adoptModelRun,
    handleValidationStateChange,
    modelRun,
    openWorkbenchStep,
    validationReport,
  ]);

  const handleModelComplete = useCallback((run, options = {}) => {
    flushSync(() => {
      adoptModelRun(run, { resetDownstream: !options?.resumeExisting });
    });
    openWorkbenchStep('validation', { skipGuardRedirect: true });
  }, [adoptModelRun, openWorkbenchStep]);

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
            {effectiveActiveModelRun && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: D.panel, px: 1, py: 0.25, borderRadius: 0, border: `1px solid ${T.accentBorder}` }}>
                <ModelTraining sx={{ fontSize: 9, color: D.orange }} />
                <Typography sx={{ fontSize: 10, color: D.orange, fontWeight: 600 }}>
                  {(effectiveActiveModelRun.algorithm || effectiveActiveModelRun.algorithm_id || '').replace(/_/g, ' ')} AUC{' '}
                  {(effectiveActiveModelRun.auc ?? effectiveActiveModelRun.results?.metrics?.roc_auc)?.toFixed(3) ?? '-'}
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
              <>
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
                <Chip
                  size="small"
                  label={activePipelineType === 'mule' ? 'Mule Account Detection' : 'FCC False Positive Suppression'}
                  sx={{
                    height: 24,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: activePipelineType === 'mule' ? '#E46A25' : D.textPrimary,
                    bgcolor: activePipelineType === 'mule' ? 'rgba(228,106,37,0.12)' : 'rgba(255,255,255,0.04)',
                    border: activePipelineType === 'mule'
                      ? '1px solid rgba(228,106,37,0.45)'
                      : `1px solid ${D.chromeBorder}`,
                    borderRadius: 0,
                    flexShrink: 0,
                    display: { xs: 'none', lg: 'inline-flex' },
                  }}
                />
              </>
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
                  {(effectiveActiveModelRun?.algorithm || effectiveActiveModelRun?.algorithm_id || '').replace(/_/g, ' ')} AUC{' '}
                  {(effectiveActiveModelRun?.auc ?? effectiveActiveModelRun?.results?.metrics?.roc_auc)?.toFixed(3) ?? '-'}
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
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={{ xs: 0.5, lg: 1.25 }} alignItems={{ lg: 'center' }} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                    <Typography sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, color: D.textBody, lineHeight: 1.1 }}>
                      {stepHeaderLabel}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: D.textSoft, lineHeight: 1.45, fontWeight: 500, maxWidth: { xs: '100%', lg: 620 } }}>
                      {stepHeaderDescription}
                    </Typography>
                    {activePipelineType === 'mule' && (
                      <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label="Mule pipeline active" sx={{ borderRadius: 0, fontWeight: 700, bgcolor: 'rgba(228,106,37,0.10)', color: '#8A3E0E', border: '1px solid rgba(228,106,37,0.28)' }} />
                        <Chip size="small" label="Feature governance on" sx={{ borderRadius: 0, fontWeight: 700, bgcolor: 'rgba(255,255,255,0.72)', color: D.textBody, border: `1px solid ${D.border}` }} />
                        <Chip size="small" label="Ring analysis enabled" sx={{ borderRadius: 0, fontWeight: 700, bgcolor: 'rgba(255,255,255,0.72)', color: D.textBody, border: `1px solid ${D.border}` }} />
                      </Stack>
                    )}
                  </Stack>
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
                    onClick={() => previousStep && openWorkbenchStep(previousStep.id, { skipGuardRedirect: true })}
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
                      onClick={() => openWorkbenchStep(primaryCta.target, { skipGuardRedirect: true })}
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
              <StepSummaryModal
                stepType={activeSummaryStepKey}
                stepName={activeSummaryLabel}
                metadata={activeSummaryMetadata}
                isOpen={Boolean(summaryOverlayStep && activeSummaryStepKey)}
                onClose={closeSummaryOverlay}
              />
              <AnimatePresence mode="wait" initial={false}>
                <Box
                  key={activeStep}
                  component={motion.div}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  {routePipelineHydrating && activeStep !== 'pipelines' && (
                    <Paper variant="outlined" sx={{ p: 3, borderRadius: 0 }}>
                      <Stack spacing={1.5} alignItems="flex-start">
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <CircularProgress size={22} />
                          <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#151B27' }}>
                            {activePipelineType === 'mule' ? 'Opening Mule pipeline' : 'Opening pipeline'}
                          </Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 13.5, color: '#556070', maxWidth: 680 }}>
                          Loading run metadata, datasets, and resume state from backend persistence so the correct workbench opens without showing the wrong pipeline family first.
                        </Typography>
                      </Stack>
                    </Paper>
                  )}
                  {!routePipelineHydrating && activeStep === 'pipelines' && (
                    <WorkbenchPipelinesScreen
                      persona={persona} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName}
                      onPipelineActivated={activatePipeline} onCreateNewPipeline={handleStartNewPipeline}
                      onPipelineDeleted={handlePipelineDeleted}
                      onResumePipeline={openPipelineRoute} onOpenStep={(stepId, pipeline) => (
                        pipeline
                          ? openPipelineRoute(pipeline, { step: stepId, skipGuardRedirect: true })
                          : openWorkbenchStep(stepId, { skipGuardRedirect: true })
                      )}
                      activeEnvironmentName={currentEnvId}
                      selectionNotice={pipelineSelectionNotice}
                      artefacts={{ modelRun, validationReport, registryEntry }}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType === 'mule' && activeStep !== 'pipelines' && activeStep !== 'reports' && activeStep !== 'dashboard' && (
                    <MuleWorkbenchScreen
                      persona={persona}
                      activeStep={activeStep}
                      activePipelineId={validActivePipelineId}
                      activePipelineName={activePipelineName}
                      activePipelineMeta={activePipelineMeta || activeSavedPipeline || null}
                      muleBackendStatus={muleBackendStatus}
                      workflowSession={workflowSessionRef.current}
                      datasets={datasets}
                      masterDataset={masterDataset}
                      featureStoreDataset={featureStoreDataset}
                      preprocessedDataset={preprocessDataset}
                      targetColumn={targetColumn}
                      preprocessPlan={preprocessPlan}
                      preprocessSteps={preprocessSteps}
                      preprocessPreview={preprocessPreview}
                      modelRun={effectiveActiveModelRun || modelRun}
                      onDatasetsRefresh={loadDatasets}
                      onBuildComplete={handleMasterBuildComplete}
                      onFeatureStoreComplete={handleFeatureStoreComplete}
                      onPreprocessStepsChange={handlePreprocessStepsChange}
                      onPreprocessPreview={handlePreprocessPreview}
                      onPreprocessRun={handlePreprocessRun}
                      onModelComplete={handleModelComplete}
                      onOpenReport={handleOpenReport}
                      modelActiveTab={modelActiveTab}
                      onModelActiveTabChange={setModelActiveTab}
                      onPipelineActivated={activatePipeline}
                      onStepAdvance={(nextStep = 'master') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'data' && (
                    <DataUploadScreen persona={persona} datasets={datasets} onDatasetsRefresh={loadDatasets}
                      activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} activePipelineType={activePipelineType} onPipelineActivated={activatePipeline}
                      onCreatePipeline={createPipelineRun}
                      onResumePipeline={openPipelineRoute}
                      onWorkspaceReset={performWorkspaceReset}
                      onStepAdvance={(nextStep = 'master') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'master' && (
                    <MasterDatasetScreen persona={persona} datasets={datasets} masterDataset={masterDataset}
                      onBuildComplete={handleMasterBuildComplete} onStepAdvance={(nextStep = 'target') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })} onStepBack={(prevStep = 'data') => openWorkbenchStep(prevStep, { skipGuardRedirect: true })} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                      initialCurrentStepId={masterCurrentStepId}
                      onCurrentStepChange={setMasterCurrentStepId}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'target' && (
                    <TargetVariableScreen persona={persona} masterDataset={masterDataset} targetColumn={targetColumn}
                      onStepAdvance={(nextStep = 'eda') => openWorkbenchStep(nextStep, { skipGuardRedirect: true })}
                      onTargetChange={handleTargetChange} activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                      initialActiveTab={targetActiveTab}
                      onActiveTabChange={setTargetActiveTab}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'eda' && (
                    <EDAScreen persona={persona} masterDataset={masterDataset} datasets={datasets} targetColumn={targetColumn} edaDone={edaDone} onEdaDone={handleEdaComplete}
                      initialTab={edaActiveTab}
                      onTabChange={setEdaActiveTab}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'preprocess' && (
                    <PreprocessingWorkbench
                      persona={persona} datasets={datasets} masterDataset={masterDataset} preprocessedDataset={preprocessDataset}
                      targetColumn={targetColumn} suggestions={preprocessPlan} steps={preprocessSteps}
                      onStepsChange={handlePreprocessStepsChange} onPreview={handlePreprocessPreview} onRun={handlePreprocessRun}
                      preview={preprocessPreview} onMasterBuild={handleBuildMaster}
                      activePipelineId={validActivePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'model' && (
                    <ModelTrainingPanel persona={persona} preprocessedDataset={preprocessDataset}
                      masterDataset={masterDataset} targetColumn={targetColumn}
                      activePipelineId={validActivePipelineId}
                      activePipelineName={activePipelineName}
                      onModelComplete={handleModelComplete} onOpenReport={handleOpenReport}
                      initialActiveTab={modelActiveTab}
                      onActiveTabChange={setModelActiveTab}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'validation' && (
                    <ModelValidationScreen persona={persona} jobId={effectiveActiveModelRun?.job_id || modelRun?.job_id || effectiveValidationReport?.job_id || effectiveValidationReport?.run_id || nestedRunId(effectiveRegistryEntry || registryEntry)}
                      activePipelineId={validActivePipelineId}
                      datasetId={preprocessDataset?.dataset_id || masterDataset?.dataset_id || null}
                      activeModelRun={effectiveActiveModelRun || modelRun}
                      validationReport={effectiveValidationReport}
                      initialActiveTab={validationActiveTab}
                      onActiveTabChange={setValidationActiveTab}
                      onActiveRunChange={handleValidationActiveRunChange}
                      onValidationComplete={handleValidationStateChange}
                      onTrainAnotherModel={() => openWorkbenchStep('model', { skipGuardRedirect: true })}
                      onContinueToRelease={handleContinueToRelease}
                      actionsDisabled={false}
                      staleWarningMessage={staleStepSet.has('validation') ? staleMessageForStep('validation') : ''}
                    />
                  )}
                  {!routePipelineHydrating && activePipelineType !== 'mule' && activeStep === 'registry' && (
                    <ModelReleaseScreen modeStep="registry" persona={persona}
                      uploadedDatasets={datasets} masterDataset={masterDataset}
                      targetColumn={targetColumn} preprocessedDataset={preprocessDataset}
                      activeModelRun={effectiveActiveModelRun || modelRun} validationReport={effectiveValidationReport}
                      registryEntry={effectiveRegistryEntry || registryEntry}
                      activePipelineName={activePipelineName}
                      activePipelineId={validActivePipelineId}
                      onRegistered={handleRegistered}
                      onDeploy={handleDeploy}
                      onViewReport={handleOpenReport}
                      onBack={() => openWorkbenchStep('validation', { skipGuardRedirect: true })}
                      actionsDisabled={staleStepSet.has('registry')}
                      actionsMessage={staleMessageForStep('registry')}
                    />
                  )}
                  {!routePipelineHydrating && activeStep === 'reports' && (
                    <RunReport
                      runId={reportRunId || activeModelRun?.job_id || modelRun?.job_id || ''}
                      pipelineId={validActivePipelineId || null}
                      onRunIdChange={setReportRunId}
                    />
                  )}
                  {!routePipelineHydrating && activeStep === 'dashboard' && (
                    <DeploymentDashboard persona={persona} activeModelRun={effectiveActiveModelRun || activeModelRun}
                      activePipelineId={validActivePipelineId}
                      activePipelineName={activePipelineName}
                      savedDashboardState={savedDashboardState}
                      validationReport={effectiveValidationReport || validationReport} registryEntry={effectiveRegistryEntry || registryEntry} onBack={() => openWorkbenchStep('registry', { skipGuardRedirect: true })}
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
              preprocessDataset={preprocessDataset} modelRun={effectiveActiveModelRun || modelRun} validationReport={effectiveValidationReport || validationReport}
              registryEntry={effectiveRegistryEntry || registryEntry} qualityScore={qualityScore}
              stepStatuses={Object.fromEntries(STEPS.map((s) => [s.id, stepStatus(s.id, stepCtx)]))}
              activeStep={activeStep} panelWidth={contextPanelWidth} latestChange={latestDependencyChange}
              hasPipelineContext={hasPipelineContext}
              onClose={() => setShowContext(false)}
            />
          )}

          <Snackbar
            open={Boolean(floatingNotice.open && floatingNotice.message)}
            autoHideDuration={4200}
            onClose={(_, reason) => {
              if (reason === 'clickaway') return;
              setFloatingNotice((prev) => ({ ...prev, open: false }));
            }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            TransitionComponent={SlideDownTransition}
            sx={{ mt: D.topH + 8, mr: 1.5 }}
          >
            <Alert
              severity={floatingNotice.severity || 'warning'}
              variant="filled"
              onClose={() => setFloatingNotice((prev) => ({ ...prev, open: false }))}
              sx={{
                minWidth: 320,
                maxWidth: 560,
                borderRadius: 2,
                boxShadow: '0 12px 30px rgba(16,24,40,0.18)',
                alignItems: 'center',
              }}
            >
              {floatingNotice.message}
            </Alert>
          </Snackbar>
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
              Choose the model family for this run. A new run always starts with a clean workspace.
            </Typography>
            <TextField size="small" autoFocus label="Run name"
              value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmCreatePipeline(); } }}
            />
            <FormControl size="small" fullWidth>
              <InputLabel sx={{ fontSize: 11.5, fontWeight: 600 }}>Model family</InputLabel>
              <Select
                value={newPipelineType}
                label="Model family"
                onChange={(e) => setNewPipelineType(String(e.target.value || 'fcc'))}
                sx={{ '& .MuiSelect-select': { fontSize: 12.5, fontWeight: 600, color: D.text } }}
              >
                <MenuItem value="fcc">FCC False Positive Suppression</MenuItem>
                <MenuItem value="mule">Mule Account Detection</MenuItem>
              </Select>
            </FormControl>
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

