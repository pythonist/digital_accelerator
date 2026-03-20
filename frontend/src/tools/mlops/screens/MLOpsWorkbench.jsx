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
import ModelRegistryScreen    from '../components/ModelRegistryScreen';
import ModelReadyScreen       from '../components/ModelReadyScreen';
import DeploymentDashboard    from '../components/DeploymentDashboard';
import RunReport              from '../components/RunReport';
import WorkbenchPipelinesScreen from '../components/WorkbenchPipelinesScreen';
import BusinessStaleStepCard  from '../components/BusinessStaleStepCard';
import { SHOW_STEP_GUARDS } from '../utils/uiFlags';
import { derivePipelineStepCompletion, getScreenState } from '../utils/pipelineState';
import { FCC_THEME as T } from '../theme/fccWorkbenchTheme';
import {
  normalizePreprocessSteps,
  normalizePreprocessSuggestions,
  unwrapApiPayload,
} from '../utils/preprocessingNormalization';

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

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS_KEY = 'mlops.workbench.v2';
const LS_PIPELINE_SESSION_KEY = 'mlops.workbench.pipeline.session.v1';

const lsRead  = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } };
const lsWrite = (patch) => { try { const p = lsRead(); localStorage.setItem(LS_KEY, JSON.stringify({ ...p, ...patch })); } catch { /* ignore */ } };
const lsClear = () => { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } };

const readPipelineSession  = () => { try { return JSON.parse(localStorage.getItem(LS_PIPELINE_SESSION_KEY) || '{}'); } catch { return {}; } };
const writePipelineSession = (patch) => { try { const p = readPipelineSession(); localStorage.setItem(LS_PIPELINE_SESSION_KEY, JSON.stringify({ ...p, ...patch })); } catch { /* ignore */ } };
const clearPipelineSession = () => { try { localStorage.removeItem(LS_PIPELINE_SESSION_KEY); } catch { /* ignore */ } };

// ── Step Definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 'data',       label: 'Data Upload',      biz: 'Load Data',         icon: CloudUpload,   desc: 'Upload CSV or Parquet source tables' },
  { id: 'master',     label: 'Master Dataset',   biz: 'Combine Tables',    icon: AccountTree,   desc: 'Join tables into one model-ready dataset' },
  { id: 'target',     label: 'Target Variable',  biz: 'What to Predict',   icon: Flag,          desc: 'Define the outcome to model' },
  { id: 'eda',        label: 'Explore Data',     biz: 'Understand Data',   icon: Analytics,     desc: 'Profile, correlate, and visualise' },
  { id: 'preprocess', label: 'Preprocessing',    biz: 'Clean & Transform', icon: Tune,          desc: 'Impute, encode, engineer features' },
  { id: 'model',      label: 'Model Training',   biz: 'Train Model',       icon: ModelTraining, desc: 'Train and evaluate ML models' },
  { id: 'validation', label: 'Model Validation', biz: 'Validate',          icon: CheckCircle,   desc: 'Event-loss constrained threshold tuning' },
  { id: 'registry',   label: 'Model Registry',   biz: 'Register Model',    icon: SaveAlt,       desc: 'Candidate/champion lifecycle' },
  { id: 'ready',      label: 'Model Ready',      biz: 'Deploy',            icon: Build,         desc: 'Export artefacts and deploy' },
  { id: 'dashboard',  label: 'Live Dashboard',   biz: 'Monitor',           icon: Dashboard,     desc: 'Post-deployment suppression monitoring' },
  { id: 'reports',    label: 'Reports',          biz: 'Reports',           icon: Article,       desc: 'Business run reports and historical comparisons' },
  { id: 'pipelines',  label: 'Pipeline Hub',     biz: 'Pipelines',         icon: AccountTree,   desc: 'Resume, run, and manage saved pipelines' },
];

const RUN_REF_PREFIX = 'FCC-RUN-';
const toRunRef = (pipelineId) => {
  const id = Number(pipelineId || 0);
  if (!Number.isFinite(id) || id <= 0) return '';
  return `${RUN_REF_PREFIX}${String(id).padStart(5, '0')}`;
};

const formatDependencyStamp = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
};

// ── Step Lock Logic ───────────────────────────────────────────────────────────
function stepStatus(id, ctx) {
  const { datasets, masterDataset, targetColumn, edaDone, preprocessDataset, modelRun, validationReport, registryEntry, staleSteps = [] } = ctx;
  const hasData = (datasets || []).length > 0;
  let baseStatus = 'locked';
  switch (id) {
    case 'data':       baseStatus = hasData ? 'done' : 'active'; break;
    case 'pipelines':  baseStatus = 'active'; break;
    case 'reports':    baseStatus = modelRun ? 'done' : 'active'; break;
    case 'master':     baseStatus = !hasData ? 'locked' : masterDataset ? 'done' : 'active'; break;
    case 'target':     baseStatus = !masterDataset ? 'locked' : targetColumn ? 'done' : 'active'; break;
    case 'eda':        baseStatus = !masterDataset ? 'locked' : edaDone ? 'done' : 'active'; break;
    case 'preprocess': baseStatus = !masterDataset ? 'locked' : preprocessDataset ? 'done' : 'active'; break;
    case 'model':      baseStatus = (!preprocessDataset && !masterDataset) ? 'locked' : modelRun ? 'done' : 'active'; break;
    case 'validation': baseStatus = !modelRun ? 'locked' : validationReport ? 'done' : 'active'; break;
    case 'registry':   baseStatus = !modelRun ? 'locked' : registryEntry ? 'done' : 'active'; break;
    case 'ready':      baseStatus = !modelRun ? 'locked' : registryEntry ? 'done' : 'active'; break;
    case 'dashboard':  baseStatus = !modelRun ? 'locked' : 'active'; break;
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
          { label: 'Master Dataset',  val: masterDataset?.dataset_type || null,    hint: masterDataset     ? `${fmt(masterDataset.row_count)} rows`                                               : 'Not built',      step: 'Step 2' },
          { label: 'Target Variable', val: targetColumn || null,                    hint: targetColumn      ? 'Confirmed'                                                                          : 'Not set',        step: 'Step 3' },
          { label: 'Preprocessed',    val: preprocessDataset?.dataset_type || null, hint: preprocessDataset ? `${fmt(preprocessDataset.row_count)} rows`                                          : 'Not run',        step: 'Step 5' },
          { label: 'Model Run',       val: modelRun ? 'Trained' : null,             hint: modelRun          ? `AUC: ${modelRun.metrics?.roc_auc?.toFixed(3) || modelRun.auc?.toFixed(3) || '-'}` : 'Not trained',    step: 'Step 6' },
          { label: 'Validation',      val: validationReport ? 'Done' : null,        hint: validationReport  ? `Threshold ${Number(validationReport.optimal_threshold ?? 0.5).toFixed(2)}`         : 'Not run',        step: 'Step 7' },
          { label: 'Registry',        val: registryEntry ? 'Registered' : null,     hint: registryEntry     ? String(registryEntry.stage || 'candidate').toUpperCase()                            : 'Not registered', step: 'Step 8' },
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
                    color:   isDone ? D.done : isStale ? D.warning : isLocked ? D.textSoft : isCurrent ? D.orange : D.textSoft,
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
            <LinearProgress variant="determinate" value={qualityScore.score || 0}
              sx={{ borderRadius: 0, height: 5, bgcolor: D.border, '& .MuiLinearProgress-bar': { bgcolor: qualityScore.score >= 80 ? D.done : D.warning, borderRadius: 0 } }}
            />
          </Box>
        </>
      )}
    </Box>
  </Box>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN WORKBENCH
// ══════════════════════════════════════════════════════════════════════════════
const MLOpsWorkbench = ({ renderAutoBuild }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  // ── Read localStorage synchronously on first render ────────────────────────
  const saved              = useMemo(() => lsRead(), []);
  const savedPipelineSession = useMemo(() => readPipelineSession(), []);

  // ── Mode: 'auto' | 'expert' ───────────────────────────────────────────────
  const [mode,            setMode]            = useState(saved.mode || 'expert');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const modeSwitchTimerRef = useRef(null);
  const journeySaveTimerRef = useRef(null);

  const [activeStep,      setActiveStep]      = useState(saved.activeStep || 'data');
  const [persona,         setPersona]         = useState(saved.persona || 'business');
  const [experimentName,  setExperimentName]  = useState(saved.experimentName || 'Experiment 1');
  const [railCollapsed,   setRailCollapsed]   = useState(Boolean(saved.railCollapsed));
  const [showContext,     setShowContext]      = useState(true);
  const [mobileRailOpen,  setMobileRailOpen]  = useState(false);
  const [viewportWidth,   setViewportWidth]   = useState(
    typeof window === 'undefined' ? 1600 : window.innerWidth,
  );
  const [resetting,       setResetting]       = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [pipelineLauncherOpen, setPipelineLauncherOpen] = useState(true);
  const [savedPipelines,  setSavedPipelines]  = useState([]);
  const [activePipelineId,   setActivePipelineId]   = useState(savedPipelineSession.pipeline_id || null);
  const [activePipelineName, setActivePipelineName] = useState(savedPipelineSession.name || '');
  const [activePipelineMeta, setActivePipelineMeta] = useState(null);
  const [createPipelineDialogOpen, setCreatePipelineDialogOpen] = useState(false);
  const [newPipelineName,  setNewPipelineName]  = useState('');
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineError, setNewPipelineError] = useState('');

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
    if (!activePipelineId && !activePipelineName) return;
    writePipelineSession({ pipeline_id: activePipelineId, name: activePipelineName });
  }, [activePipelineId, activePipelineName]);
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
      localStorage.setItem('mlops.datasets.cache', JSON.stringify(payload || {}));
      return parsed;
    } catch (e) {
      console.error('Failed to load datasets', e);
      return { all: [], rawOnly: [], artefacts: [] };
    }
  }, [hydrateDatasets]);

  const loadSavedPipelines = useCallback(async () => {
    try {
      const res  = await mlopsApi.pipelineList();
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setSavedPipelines(rows);
      if (activePipelineId) {
        const active = rows.find((row) => Number(row?.pipeline_id) === Number(activePipelineId)) || null;
        if (active) setActivePipelineMeta(active);
      }
      return rows;
    } catch {
      setSavedPipelines([]);
      return [];
    }
  }, [activePipelineId]);

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

  const activatePipeline = useCallback((pipeline) => {
    if (!pipeline) return;
    const pid   = Number(pipeline.pipeline_id || pipeline.pipelineId || pipeline.id || 0) || null;
    const pname = String(pipeline.name || '').trim();
    setActivePipelineId(pid);
    setActivePipelineName(pname);
    setActivePipelineMeta(pipeline || null);
    writePipelineSession({ pipeline_id: pid, name: pname });
    if (pname) setExperimentName(pname);
  }, []);

  const clearActivePipeline = useCallback(() => {
    setActivePipelineId(null);
    setActivePipelineName('');
    setActivePipelineMeta(null);
    clearPipelineSession();
  }, []);

  const clearLocalWorkbenchState = useCallback(() => {
    localStorage.removeItem('mlops.datasets.cache');
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
    setActiveStep('data');
  }, []);

  // ── STARTUP ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cached = localStorage.getItem('mlops.datasets.cache');
    if (cached) { try { hydrateDatasets(JSON.parse(cached)); } catch { /* stale */ } }
    let alive = true;
    (async () => {
      const first = await loadDatasets({ sync: false });
      if (!alive) return;
      if (!(first?.all?.length > 0)) await loadDatasets({ sync: true });
    })();
    return () => { alive = false; };
  }, [hydrateDatasets, loadDatasets]);

  useEffect(() => { loadSavedPipelines(); }, [loadSavedPipelines]);
  useEffect(() => { if (!activePipelineId) return; loadSavedPipelines(); }, [activePipelineId, loadSavedPipelines]);

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
  const staleSteps = useMemo(
    () => Array.isArray(activePipelineMeta?.stale_steps) ? activePipelineMeta.stale_steps : [],
    [activePipelineMeta],
  );
  const staleStepSet = useMemo(
    () => new Set((staleSteps || []).map((step) => String(step))),
    [staleSteps],
  );
  const latestDependencyChange = activePipelineMeta?.latest_change || null;
  const staleMessageForStep = useCallback((stepId) => {
    const direct = activePipelineMeta?.stale_details?.[stepId]?.message;
    if (direct) return direct;
    if (latestDependencyChange?.message) return latestDependencyChange.message;
    return 'This stage is outdated because an upstream step changed. Rerun the dependent stages before continuing.';
  }, [activePipelineMeta, latestDependencyChange]);

  const stepCtx = useMemo(() => ({
    datasets, masterDataset, targetColumn, edaDone,
    preprocessDataset, modelRun, validationReport, registryEntry, staleSteps,
  }), [datasets, masterDataset, targetColumn, edaDone, preprocessDataset, modelRun, validationReport, registryEntry, staleSteps]);

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
  const doneCount      = useMemo(() => progressSteps.filter((s) => stepStatus(s.id, stepCtx) === 'done').length, [progressSteps, stepCtx]);
  const progressPct    = Math.round((doneCount / Math.max(progressSteps.length, 1)) * 100);
  const currentFlowIdx = useMemo(() => progressSteps.findIndex((s) => s.id === activeStep), [progressSteps, activeStep]);
  const isDashboard    = activeStep === 'dashboard';
  const contextMinViewport = 1680;
  const forceRailCollapse = isTablet || viewportWidth < 1320;
  const effectiveRailCollapsed = railCollapsed || forceRailCollapse;
  const showContextPanel = !isMobile && showContext && !isDashboard && viewportWidth >= contextMinViewport;
  const contextPanelWidth = viewportWidth >= 1880 ? D.contextW : 260;

  const unfinishedPipelines = useMemo(
    () => (savedPipelines || []).filter((p) => String(p?.run_status || p?.status || 'saved').toLowerCase() !== 'complete'),
    [savedPipelines],
  );

  const defaultResumePipeline = useMemo(() => {
    if (activePipelineId) {
      const hit = (savedPipelines || []).find((p) => Number(p.pipeline_id) === Number(activePipelineId));
      if (hit) return hit;
    }
    return unfinishedPipelines[0] || null;
  }, [activePipelineId, savedPipelines, unfinishedPipelines]);

  const workbenchJourneyState = useMemo(() => ({
    current_step: activeStep,
    current_step_label: STEPS.find((step) => step.id === activeStep)?.label || activeStep,
    completion_pct: progressPct,
    completed_steps: doneCount,
    total_steps: progressSteps.length,
    run_status: progressPct >= 100 ? 'complete' : doneCount > 0 ? 'in_progress' : 'draft',
    persona,
    mode,
  }), [activeStep, doneCount, mode, persona, progressPct, progressSteps.length]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return undefined;
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
  }, [activePipelineId, workbenchJourneyState]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !activeModelRun?.job_id) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'model',
      state: {
        job_id: activeModelRun.job_id,
        algorithm: activeModelRun.algorithm || activeModelRun.algorithm_id || '',
        dataset_id: Number(preprocessDataset?.dataset_id || masterDataset?.dataset_id || 0) || null,
        threshold: activeModelRun.threshold ?? null,
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [activePipelineId, activeModelRun, preprocessDataset?.dataset_id, masterDataset?.dataset_id]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !validationReport) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'validation',
      state: {
        job_id: activeModelRun?.job_id || modelRun?.job_id || '',
        optimal_threshold: validationReport?.optimal_threshold ?? null,
        report_id: validationReport?.report_id || validationReport?.validation_id || '',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [activePipelineId, validationReport, activeModelRun?.job_id, modelRun?.job_id]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) return;
    mlopsApi.pipelineSaveScreenState(pipelineId, {
      screen: 'eda',
      state: {
        completed: Boolean(edaDone),
        status: edaDone ? 'completed' : 'in_progress',
        target_column: targetColumn || '',
        viewed_step: activeStep === 'eda',
      },
    })
      .then((res) => {
        const payload = res?.data || res;
        if (payload?.pipeline_id) setActivePipelineMeta(payload);
      })
      .catch(() => {});
  }, [activePipelineId, edaDone, targetColumn, activeStep]);

  useEffect(() => {
    const pipelineId = Number(activePipelineId || 0);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !registryEntry) return;
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
  }, [activePipelineId, registryEntry, activeModelRun?.job_id, modelRun?.job_id, validationReport?.optimal_threshold]);

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
      setActiveStep(targetStep);
      return;
    }

    const canvas = document.getElementById('fcc-workbench-main-canvas');
    if (canvas) {
      canvas.scrollTo({ top: 320, behavior: 'smooth' });
    }
  }, [activeStep, businessStaleCard, resolveStepNavigation]);
  const handleAutoBuildStaleAction = useCallback(() => {
    if (!autoBuildStaleCard) return;
    setMode('expert');
    const targetStep = resolveStepNavigation(autoBuildStaleCard.targetStepId) || autoBuildStaleCard.targetStepId;
    if (targetStep) {
      setActiveStep(targetStep);
    }
  }, [autoBuildStaleCard, resolveStepNavigation]);

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
      const payload = {
        name: trimmed, dataset_id: 0, dataset_ids: [],
        created_by_persona: persona || 'technical',
        steps: [{ type: 'screen_state', screen: 'pipeline_hub', state: { stage_order: ['data', 'master', 'target', 'preprocess', 'model', 'validation', 'registry'], created_from: 'workbench' } }],
      };
      const res           = await mlopsApi.pipelineSave(payload);
      const savedPipeline = res?.data || res || {};
      activatePipeline({ pipeline_id: savedPipeline.pipeline_id, name: trimmed });
      clearLocalWorkbenchState();
      setExperimentName(trimmed);
      await loadSavedPipelines();
      setCreatePipelineDialogOpen(false);
      setNewPipelineName('');
      setPipelineLauncherOpen(false);
    } catch (e) {
      setNewPipelineError(e?.response?.data?.error || e?.message || 'Failed to create run.');
    } finally {
      setCreatingPipeline(false);
    }
  }, [activatePipeline, clearLocalWorkbenchState, loadSavedPipelines, newPipelineName, persona, savedPipelines]);

  const resumePipeline = useCallback(async (pipelineRef) => {
    const pipelineId = Number(pipelineRef?.pipeline_id || pipelineRef || 0);
    if (!pipelineId) return;
    try {
      clearLocalWorkbenchState();
      const res  = await mlopsApi.pipelineGet(pipelineId);
      const full = res?.data || res;
      activatePipeline(full);
      let parsed = await loadDatasets({ sync: false });
      if (!(parsed?.all?.length > 0)) parsed = await loadDatasets({ sync: true });

      const dataState       = getScreenState(full?.steps, 'data_upload')  || {};
      const masterState     = getScreenState(full?.steps, 'master')       || {};
      const preprocessState = getScreenState(full?.steps, 'preprocess')   || {};
      const edaState        = getScreenState(full?.steps, 'eda')          || {};
      const journeyState    = getScreenState(full?.steps, 'workbench_journey') || {};

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

      const targetState    = getScreenState(full?.steps, 'target');
      const restoredTarget = String(targetState?.currentTargetColumn || targetState?.selectedTargetColumn || '').trim();
      if (restoredTarget) setTargetColumn(restoredTarget);
      setEdaDone(Boolean(edaState?.completed || edaState?.done || edaState?.status === 'completed'));
      if (Array.isArray(preprocessState?.steps)) {
        setPreprocessSteps(normalizePreprocessSteps(preprocessState.steps));
      }

      const requestedStep = String(journeyState?.current_step || '').trim().toLowerCase();
      const normalizedStep = requestedStep === 'data_upload' ? 'data' : requestedStep;
      const resumeStaleStep = flowSteps.find((step) => (full?.stale_steps || []).includes(step.id))?.id || '';
      const completion     = derivePipelineStepCompletion(full || {});
      const pipelineStatus = String(full?.status || '').toLowerCase();
      if (resumeStaleStep) setActiveStep(resumeStaleStep);
      else if (normalizedStep && STEPS.some((step) => step.id === normalizedStep)) setActiveStep(normalizedStep);
      else if (['complete', 'completed', 'done'].includes(pipelineStatus)) setActiveStep('pipelines');
      else if (completion.preprocess)   setActiveStep('preprocess');
      else if (completion.eda)          setActiveStep('eda');
      else if (completion.target)       setActiveStep('target');
      else if (completion.master)       setActiveStep('master');
      else                              setActiveStep('data');

      setPipelineLauncherOpen(false);
    } catch (e) { console.error('Failed to resume pipeline', e); }
  }, [activatePipeline, clearLocalWorkbenchState, flowSteps, loadDatasets]);

  const handleReset = useCallback(() => {
    if (resetting) return;
    setResetConfirmOpen(true);
  }, [resetting]);

  const confirmReset = useCallback(async () => {
    setResetting(true);
    try {
      try { await mlopsApi.resetDatasets({ delete_files: false }); } catch { /* ignore */ }
      lsClear();
      clearLocalWorkbenchState();
      setSavedPipelines([]);
      clearActivePipeline();
      await loadDatasets({ sync: true });
      await loadSavedPipelines();
      setResetConfirmOpen(false);
    } finally {
      setResetting(false);
    }
  }, [clearActivePipeline, clearLocalWorkbenchState, loadDatasets, loadSavedPipelines]);

  const adoptModelRun = useCallback((run, options = {}) => {
    const nextJobId = String(run?.job_id || run?.run_id || '').trim();
    if (!nextJobId) return;
    const previousJobId = String(activeModelRun?.job_id || modelRun?.job_id || '').trim();
    const isNewRun = previousJobId !== nextJobId;
    const normalizedRun = {
      ...(activeModelRun || {}),
      ...(modelRun || {}),
      ...(run || {}),
      job_id: nextJobId,
      algorithm_id: run?.algorithm_id || run?.algo_id || run?.results?.algorithm || activeModelRun?.algorithm_id,
      algorithm: run?.algorithm || run?.algorithm_display || run?.algorithm_id || run?.algo_id || run?.results?.algorithm || activeModelRun?.algorithm,
      auc: run?.auc ?? run?.results?.metrics?.roc_auc ?? run?.metrics?.roc_auc ?? activeModelRun?.auc,
      metrics: run?.results?.metrics || run?.metrics || activeModelRun?.metrics || {},
    };
    setActiveModelRun(normalizedRun);
    setModelRun({
      job_id: normalizedRun.job_id,
      algorithm: normalizedRun.algorithm,
      algorithm_id: normalizedRun.algorithm_id,
      auc: normalizedRun.auc,
      metrics: normalizedRun.metrics || {},
      results: normalizedRun.results,
      grain: normalizedRun.grain,
      threshold: normalizedRun.threshold,
    });
    setReportRunId(nextJobId);
    if (isNewRun && options.resetDownstream !== false) {
      setValidationReport(null);
      setRegistryEntry(null);
    }
    if (options.nextStep) setActiveStep(options.nextStep);
  }, [activeModelRun, modelRun]);

  const handleModelComplete = useCallback((run) => {
    adoptModelRun(run, { resetDownstream: true, nextStep: 'validation' });
  }, [adoptModelRun]);

  const handleRegistered = useCallback((entry) => { setRegistryEntry(entry); }, []);

  const handleEdaComplete = useCallback(() => {
    setEdaDone(true);
    setActiveStep('preprocess');
  }, []);

  const handleDeploy = useCallback((deployResult) => {
    if (deployResult?.deployment_id) {
      setRegistryEntry((prev) => ({ ...prev, deployment_id: deployResult.deployment_id, threshold: deployResult.threshold ?? prev?.threshold }));
    }
    setActiveStep('dashboard');
  }, []);

  const handleOpenReport = useCallback((runId) => {
    if (runId != null && String(runId).trim()) setReportRunId(String(runId));
    setActiveStep('reports');
  }, []);

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
          const canNavigate = ALLOW_LOCKED_NAV || !isLocked;
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
                    setActiveStep(resolveStepNavigation(step.id) || step.id);
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
        {!collapsed && datasets.length > 0 && (
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
    <Box sx={{ height: '100%', minHeight: 0, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: D.canvas }}>

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
              onClick={() => navigate('/tools')}
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

            {activePipelineName && (
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
                        onClick={() => canNavigate && setActiveStep(resolveStepNavigation(step.id) || step.id)}
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
                    <Typography sx={{ fontSize: 10, color: D.textSoft, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, display: { xs: 'none', sm: 'block' } }}>
                      {experimentName}
                    </Typography>
                    <ChevronRight sx={{ fontSize: 12, color: D.textSoft, display: { xs: 'none', sm: 'block' } }} />
                    <Typography sx={{ fontSize: 10, color: D.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {persona === 'business' ? currentStepMeta?.biz : currentStepMeta?.label}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 800, color: D.textBody, lineHeight: 1.1 }}>
                    {persona === 'business' ? currentStepMeta?.biz : currentStepMeta?.label}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: D.textSoft, maxWidth: 760, lineHeight: 1.5 }}>
                    {currentStepMeta?.desc || 'Continue the current workbench stage.'}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {activePipelineId ? (
                    <>
                      <Chip
                        size="small"
                        label={toRunRef(activePipelineId)}
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

                  {primaryCta && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={primaryCta.stale ? <Refresh sx={{ fontSize: 14 }} /> : undefined}
                      endIcon={primaryCta.stale ? undefined : <ChevronRight />}
                      onClick={() => setActiveStep(resolveStepNavigation(primaryCta.target) || primaryCta.target)}
                      sx={{ bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover }, height: 28, fontSize: 11, textTransform: 'none', borderRadius: 0, boxShadow: 'none' }}
                    >
                      {primaryCta.label}: {primaryCta.detail}
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            <Box id="fcc-workbench-main-canvas" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: isDashboard ? 0 : activeStep === 'master' ? { xs: 0.5, md: 1 } : { xs: 1, md: 2 } }}>
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
                      persona={persona} activePipelineId={activePipelineId} activePipelineName={activePipelineName}
                      onPipelineActivated={activatePipeline} onCreateNewPipeline={handleStartNewPipeline}
                      onResumePipeline={resumePipeline} onOpenStep={setActiveStep}
                      artefacts={{ modelRun, validationReport, registryEntry }}
                    />
                  )}
                  {activeStep === 'data' && (
                    <DataUploadScreen persona={persona} datasets={datasets} onDatasetsRefresh={loadDatasets}
                      activePipelineId={activePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {activeStep === 'master' && (
                    <MasterDatasetScreen persona={persona} datasets={datasets} masterDataset={masterDataset}
                      onBuildComplete={loadDatasets} activePipelineId={activePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {activeStep === 'target' && (
                    <TargetVariableScreen persona={persona} masterDataset={masterDataset} targetColumn={targetColumn}
                      onStepAdvance={(nextStep = 'eda') => setActiveStep(nextStep)}
                      onTargetChange={handleTargetChange} activePipelineId={activePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {activeStep === 'eda' && (
                    <EDAScreen persona={persona} masterDataset={masterDataset} datasets={datasets} targetColumn={targetColumn} edaDone={edaDone} onEdaDone={handleEdaComplete} />
                  )}
                  {activeStep === 'preprocess' && (
                    <PreprocessingWorkbench
                      persona={persona} datasets={datasets} masterDataset={masterDataset} preprocessedDataset={preprocessDataset}
                      targetColumn={targetColumn} suggestions={preprocessPlan} steps={preprocessSteps}
                      onStepsChange={handlePreprocessStepsChange} onPreview={handlePreprocessPreview} onRun={handlePreprocessRun}
                      preview={preprocessPreview} onMasterBuild={handleBuildMaster}
                      activePipelineId={activePipelineId} activePipelineName={activePipelineName} onPipelineActivated={activatePipeline}
                    />
                  )}
                  {activeStep === 'model' && (
                    <ModelTrainingPanel persona={persona} preprocessedDataset={preprocessDataset}
                      masterDataset={masterDataset} targetColumn={targetColumn}
                      onModelComplete={handleModelComplete} onOpenReport={handleOpenReport}
                    />
                  )}
                  {activeStep === 'validation' && (
                    <ModelValidationScreen persona={persona} jobId={activeModelRun?.job_id || modelRun?.job_id}
                      activeModelRun={activeModelRun}
                      onActiveRunChange={(run) => adoptModelRun(run, { resetDownstream: true })}
                      onValidationComplete={setValidationReport}
                      actionsDisabled={staleStepSet.has('validation')}
                      actionsMessage={staleMessageForStep('validation')}
                    />
                  )}
                  {activeStep === 'registry' && (
                    <ModelRegistryScreen jobId={activeModelRun?.job_id || modelRun?.job_id}
                      activeModelRun={activeModelRun} validationReport={validationReport} onRegistered={handleRegistered}
                      actionsDisabled={staleStepSet.has('registry')}
                      actionsMessage={staleMessageForStep('registry')}
                    />
                  )}
                  {activeStep === 'ready' && (
                    <ModelReadyScreen persona={persona} uploadedDatasets={datasets} masterDataset={masterDataset}
                      targetColumn={targetColumn} preprocessedDataset={preprocessDataset}
                      activeModelRun={activeModelRun} onDeploy={handleDeploy} onViewReport={handleOpenReport}
                      actionsDisabled={staleStepSet.has('ready')}
                      actionsMessage={staleMessageForStep('ready')}
                    />
                  )}
                  {activeStep === 'reports' && (
                    <RunReport runId={reportRunId || activeModelRun?.job_id || modelRun?.job_id || ''} onRunIdChange={setReportRunId} />
                  )}
                  {activeStep === 'dashboard' && (
                    <DeploymentDashboard persona={persona} activeModelRun={activeModelRun}
                      validationReport={validationReport} registryEntry={registryEntry} onBack={() => setActiveStep('ready')}
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
              activeStep={activeStep} panelWidth={contextPanelWidth} latestChange={latestDependencyChange} onClose={() => setShowContext(false)}
            />
          )}
        </Box>
      )}
      </AnimatePresence>

      <Dialog open={resetConfirmOpen} onClose={() => !resetting && setResetConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Reset Pipeline State</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography sx={{ fontSize: 13, color: D.textSoft }}>
              Start fresh for this environment?
            </Typography>
            <Alert severity="warning" sx={{ py: 0.5 }}>
              This clears pipeline progress, selected datasets, and local workbench state.
            </Alert>
            <Typography sx={{ fontSize: 12, color: D.textSoft }}>
              Raw uploaded files are kept on disk.
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
            onClick={() => defaultResumePipeline && resumePipeline(defaultResumePipeline)}
            sx={{ textTransform: 'none', bgcolor: D.orange, '&:hover': { bgcolor: D.orangeHover } }}
          >
            Resume Run
          </Button>
          <Button variant="outlined" startIcon={<Add sx={{ fontSize: 15 }} />}
            onClick={handleStartNewPipeline} sx={{ textTransform: 'none' }}
          >
            Start New Run
          </Button>
          <Button variant="text" onClick={() => { setPipelineLauncherOpen(false); setActiveStep('pipelines'); }} sx={{ textTransform: 'none' }}>
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
    </Box>
  );
};

export default MLOpsWorkbench;

