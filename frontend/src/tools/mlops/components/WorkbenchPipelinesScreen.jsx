import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccountTree,
  Add,
  ArchiveOutlined,
  ArrowForward,
  ContentCopy,
  DeleteForever,
  DragIndicator,
  DriveFileRenameOutline,
  ExpandLess,
  ExpandMore,
  PlayArrow,
  Refresh,
  Restore,
  Save,
  VisibilityOutlined,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import { FCC_THEME as T } from '../theme/fccWorkbenchTheme';
import {
  derivePipelineStepCompletion,
  derivePipelineStepStatuses,
  getManifestStepState,
  getWorkflowManifest,
  getScreenState,
  upsertScreenState,
} from '../utils/pipelineState';
import { getStepStatus, isPipelineComplete, loadPipelineRun } from '../utils/pipelineStorage';

const tone = {
  border: T.border,
  bg: T.page,
  text: T.text,
  muted: T.textMuted,
  orange: T.accent,
  orangeSoft: T.accentSoft,
  good: T.success,
  goodBg: T.successBg,
  warn: T.warning,
  warnBg: T.warningBg,
  bad: T.error,
  badBg: T.errorBg,
};

const stageCatalog = {
  data: { key: 'data', label: 'Data Upload', stepId: 'data' },
  master: { key: 'master', label: 'Master Dataset', stepId: 'master' },
  target: { key: 'target', label: 'Target Variable', stepId: 'target' },
  eda: { key: 'eda', label: 'Explore Data', stepId: 'eda' },
  preprocess: { key: 'preprocess', label: 'Preprocessing', stepId: 'preprocess' },
  model: { key: 'model', label: 'Model Training', stepId: 'model' },
  validation: { key: 'validation', label: 'Validation', stepId: 'validation' },
  registry: { key: 'registry', label: 'Registry', stepId: 'registry' },
};

const defaultStageOrder = Object.keys(stageCatalog);
const workflowStepLabels = {
  data: 'Load Data',
  master: 'Master Dataset',
  target: 'Target Definition',
  eda: 'Explore Data',
  preprocess: 'Feature Preparation',
  model: 'Model Development',
  validation: 'Validation',
  registry: 'Registry',
  ready: 'Deployment Readiness',
  dashboard: 'Monitoring',
  reports: 'Reports',
};
const historyStepOrder = ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry', 'dashboard', 'reports'];
const fccStorageStepMap = {
  data: 'data_upload',
  master: 'master_dataset',
  target: 'target_variable',
  eda: 'eda',
  preprocess: 'preprocessing',
  model: 'model_run',
  validation: 'validation',
  registry: 'registry',
  dashboard: 'live_dashboard',
  reports: 'reports',
};

const pick = (res) => res?.data ?? res;
const cloneDeepSafe = (value) => {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
};
const patchSessionPayloadObject = (
  value,
  {
    pipelineId,
    pipelineName,
    clearRuntimeIds = false,
  } = {},
) => {
  const next = cloneDeepSafe(value);
  const apply = (target) => {
    if (!target || typeof target !== 'object') return;
    if (pipelineName !== undefined) target.pipeline_name = pipelineName;
    if (pipelineId !== undefined) {
      if (pipelineId == null || pipelineId === '') delete target.pipeline_id;
      else target.pipeline_id = pipelineId;
    }
    if (clearRuntimeIds) {
      delete target.run_id;
      delete target.deployment_id;
      delete target.publish_id;
      delete target.workflow_session_id;
      delete target.session_id;
    }
  };
  apply(next);
  if (next.mlops_state && typeof next.mlops_state === 'object') apply(next.mlops_state);
  return next;
};
const runKey = (row) => String(
  row?.manager_key
  || (row?.workflow_session_id ? `workflow::${row.workflow_session_id}` : '')
  || (row?.pipeline_id != null ? `pipeline::${row.pipeline_id}` : '')
  || row?.run_ref
  || row?.name
  || ''
);
const selectionKeyFor = ({ pipelineId = null, workflowSessionId = '' } = {}) => {
  const sessionId = String(workflowSessionId || '').trim();
  if (sessionId) return `workflow::${sessionId}`;
  if (pipelineId != null && pipelineId !== '') return `pipeline::${pipelineId}`;
  return '';
};
const buildCloneName = (name) => `${String(name || 'Pipeline').trim()} Copy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const normalizeStageOrder = (rawOrder) => {
  const cleaned = Array.isArray(rawOrder)
    ? rawOrder.filter((key, idx, arr) => stageCatalog[key] && arr.indexOf(key) === idx)
    : [];
  if (!cleaned.includes('eda')) {
    const targetIndex = cleaned.indexOf('target');
    const preprocessIndex = cleaned.indexOf('preprocess');
    if (targetIndex >= 0) cleaned.splice(targetIndex + 1, 0, 'eda');
    else if (preprocessIndex >= 0) cleaned.splice(preprocessIndex, 0, 'eda');
    else cleaned.push('eda');
  }
  defaultStageOrder.forEach((key) => {
    if (!cleaned.includes(key)) cleaned.push(key);
  });
  return cleaned;
};

const statusTone = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'archived') return { color: tone.muted, bg: '#ffffff', label: 'Archived' };
  if (key === 'stale' || key === 'needs_rerun' || key === 'needs-rerun') {
    return { color: tone.warn, bg: '#ffffff', label: 'Needs rerun' };
  }
  if (key === 'complete' || key === 'completed' || key === 'done') return { color: tone.good, bg: '#ffffff', label: 'Complete' };
  if (key === 'failed' || key === 'error') return { color: tone.bad, bg: '#ffffff', label: 'Failed' };
  if (key === 'draft') return { color: tone.muted, bg: '#ffffff', label: 'Draft' };
  if (key === 'running') return { color: tone.orange, bg: '#ffffff', label: 'Running' };
  return { color: tone.warn, bg: '#ffffff', label: 'In Progress' };
};

const normalizeSchedule = (raw) => {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(base.enabled),
    frequency: String(base.frequency || 'daily'),
    time: String(base.time || '09:00'),
    day: String(base.day || 'monday'),
    cron: String(base.cron || ''),
    trigger_on_upload: Boolean(base.trigger_on_upload),
  };
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const pipelineFamilyKey = (row) => String(row?.pipeline_type || row?.model_family || 'fcc').trim().toLowerCase() === 'mule' ? 'mule' : 'fcc';
const pipelineFamilyLabel = (row) => pipelineFamilyKey(row) === 'mule' ? 'Mule Account Detection' : 'FCC False Positive Suppression';
const pipelineFamilyShort = (row) => pipelineFamilyKey(row) === 'mule' ? 'Mule' : 'FCC';
const pipelineRunRef = (row) => row?.run_ref || `${pipelineFamilyKey(row).toUpperCase()}-RUN-${row?.pipeline_id ?? 'draft'}`;
const pipelineWorkspaceLabel = (row) => row?.current_workspace || pipelineFamilyShort(row);

const statusKey = (row) => String(row?.run_status || row?.workflow_status || row?.status || 'draft').toLowerCase();
const ownerLabel = (row) => String(row?.created_by_label || row?.owner || row?.created_by_persona || 'technical').trim() || 'technical';
const progressNumber = (row) => {
  const value = Number(row?.completion_pct ?? 0);
  if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  const completed = Number(row?.completed_steps || 0);
  const total = Number(row?.total_steps || 10) || 10;
  return Math.max(0, Math.min(100, Math.round((completed / Math.max(total, 1)) * 100)));
};
const isComplete = (row) => ['complete', 'completed', 'done'].includes(statusKey(row));
const isFailed = (row) => ['failed', 'error'].includes(statusKey(row));
const isArchived = (row) => statusKey(row) === 'archived';
const nextPendingStepLabel = (row) => {
  if (isComplete(row)) return '-';
  const explicitStatuses = derivePipelineStepStatuses(row || {});
  const firstOpenStep = historyStepOrder.find((step) => {
    const status = String(explicitStatuses?.[step] || '').toLowerCase();
    return status && status !== 'completed';
  });
  if (firstOpenStep) return workflowStepLabels[firstOpenStep] || firstOpenStep;
  const current = String(row?.current_step || '').trim().toLowerCase();
  if (current) return workflowStepLabels[current] || row?.current_step_label || current.replace(/_/g, ' ');
  const idx = Math.max(0, Math.min(Number(row?.completed_steps || 0), historyStepOrder.length - 1));
  return workflowStepLabels[historyStepOrder[idx]] || '-';
};
const lastCompletedStepLabel = (row) => {
  if (isComplete(row)) return row?.current_step_label || workflowStepLabels[String(row?.current_step || '').trim().toLowerCase()] || 'Reports';
  const explicitStatuses = derivePipelineStepStatuses(row || {});
  const completedStages = historyStepOrder.filter((step) => String(explicitStatuses?.[step] || '').toLowerCase() === 'completed');
  if (completedStages.length > 0) {
    const stepKey = completedStages[completedStages.length - 1];
    return workflowStepLabels[stepKey] || stepKey;
  }
  const completed = Math.max(0, Number(row?.completed_steps || 0) - 1);
  if (completed < 0) return '-';
  const stepKey = historyStepOrder[Math.min(completed, historyStepOrder.length - 1)];
  return stepKey ? workflowStepLabels[stepKey] || stepKey : '-';
};
const matchesSearch = (row, search) => {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    row?.name,
    row?.run_ref,
    row?.run_id,
    row?.current_step_label,
    row?.workspace_step_label,
    ownerLabel(row),
  ].join(' ').toLowerCase().includes(needle);
};

const deriveFccSavedRunState = (row, envId = '') => {
  if (pipelineFamilyKey(row) !== 'fcc') return null;
  const pipelineScope = {
    pipeline_id: Number(row?.pipeline_id || 0) || null,
    pipeline_uuid: row?.pipeline_uuid || null,
    env_id: envId || row?.env_id || '',
  };
  if (!pipelineScope.pipeline_id) return null;
  const savedRun = loadPipelineRun(pipelineScope);
  if (!savedRun) return null;
  const complete = isPipelineComplete(pipelineScope);
  const completion = historyStepOrder.reduce((acc, stepId) => {
    const storageKey = fccStorageStepMap[stepId];
    if (complete) {
      acc[stepId] = true;
      return acc;
    }
    acc[stepId] = storageKey ? getStepStatus(pipelineScope, storageKey) === 'done' : false;
    return acc;
  }, {});
  const statuses = historyStepOrder.reduce((acc, stepId) => {
    acc[stepId] = completion[stepId] ? 'completed' : 'not_started';
    return acc;
  }, {});
  const doneCount = historyStepOrder.filter((stepId) => completion[stepId]).length;
  return {
    savedRun,
    complete,
    completion,
    statuses,
    doneCount,
    totalCount: historyStepOrder.length,
    staleCount: 0,
    runStatus: complete ? 'completed' : String(row?.run_status || row?.workflow_status || row?.status || 'draft').toLowerCase(),
  };
};

const WorkbenchPipelinesScreen = ({
  persona = 'technical',
  activePipelineId = null,
  activePipelineName = '',
  activeEnvironmentName = '',
  selectionNotice = '',
  onPipelineActivated,
  onPipelineDeleted,
  onCreateNewPipeline,
  onResumePipeline,
  onOpenStep,
  artefacts = {},
}) => {
  const [pipelines, setPipelines] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [fullPipeline, setFullPipeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [running, setRunning] = useState(false);
  const [runState, setRunState] = useState(null);
  const pollRef = useRef(null);

  const [stageOrder, setStageOrder] = useState(defaultStageOrder);
  const [dragStageKey, setDragStageKey] = useState('');
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const [scheduleDraft, setScheduleDraft] = useState(normalizeSchedule({}));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deletingPipeline, setDeletingPipeline] = useState(false);
  const [cloningPipeline, setCloningPipeline] = useState(false);
  const [archivingPipeline, setArchivingPipeline] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleteImpactError, setDeleteImpactError] = useState('');
  const [deleteSentinelAction, setDeleteSentinelAction] = useState('keep');
  const [renameDialog, setRenameDialog] = useState({ open: false, value: '', saving: false, error: '' });
  const [searchText, setSearchText] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [familyFilter, setFamilyFilter] = useState('all');
  const [dagExpanded, setDagExpanded] = useState(false);

  const selected = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => runKey(p) === String(selectedPipelineId)) || null;
  }, [pipelines, selectedPipelineId]);
  const findPipelineRow = useCallback((selection) => {
    const needle = String(selection || '').trim();
    if (!needle) return null;
    return pipelines.find((item) => (
      runKey(item) === needle
      || String(item?.pipeline_id ?? '') === needle
      || String(item?.workflow_session_id ?? '') === needle
      || String(item?.session_id ?? '') === needle
    )) || null;
  }, [pipelines]);

  const effectivePipeline = fullPipeline || selected;
  const savedPipelineState = useMemo(
    () => deriveFccSavedRunState(effectivePipeline || {}, activeEnvironmentName),
    [activeEnvironmentName, effectivePipeline],
  );
  const workflowManifest = useMemo(() => getWorkflowManifest(effectivePipeline), [effectivePipeline]);
  const workflowState = effectivePipeline?.workflow_session?.current_state?.mlops_state || {};
  const scopedArtefacts = useMemo(() => {
    const selectedPipelineId = Number(effectivePipeline?.pipeline_id || 0) || null;
    const currentPipelineId = Number(activePipelineId || 0) || null;
    if (!selectedPipelineId || !currentPipelineId || selectedPipelineId !== currentPipelineId) {
      return {};
    }
    return artefacts || {};
  }, [activePipelineId, artefacts, effectivePipeline?.pipeline_id]);
  const staleStepSet = useMemo(
    () => new Set(savedPipelineState?.complete ? [] : (effectivePipeline?.stale_steps || []).map((step) => String(step))),
    [effectivePipeline, savedPipelineState],
  );
  const completion = useMemo(() => {
    if (savedPipelineState?.completion) return savedPipelineState.completion;
    return derivePipelineStepCompletion(effectivePipeline || {});
  }, [effectivePipeline, savedPipelineState]);
  const explicitStepStatuses = useMemo(() => {
    if (savedPipelineState?.statuses) return savedPipelineState.statuses;
    return derivePipelineStepStatuses(effectivePipeline || {});
  }, [effectivePipeline, savedPipelineState]);
  const filteredPipelines = useMemo(() => {
    return (pipelines || []).filter((row) => {
      const mine = ownerLabel(row).toLowerCase() === String(persona || '').toLowerCase();
      if (scopeFilter === 'mine' && !mine) return false;
      if (scopeFilter === 'team' && mine) return false;
      if (statusFilter === 'active' && (isComplete(row) || isFailed(row) || isArchived(row))) return false;
      if (statusFilter === 'completed' && !isComplete(row)) return false;
      if (statusFilter === 'failed' && !isFailed(row)) return false;
      if (statusFilter === 'draft' && statusKey(row) !== 'draft') return false;
      if (statusFilter === 'archived' && !isArchived(row)) return false;
      if (familyFilter !== 'all' && pipelineFamilyKey(row) !== familyFilter) return false;
      return matchesSearch(row, searchText);
    });
  }, [familyFilter, persona, pipelines, scopeFilter, searchText, statusFilter]);
  const summaryCards = useMemo(() => {
    const mineMatcher = String(persona || '').toLowerCase();
    const all = pipelines || [];
    return [
      {
        key: 'my_active',
        label: 'My Active Runs',
        value: all.filter((row) => ownerLabel(row).toLowerCase() === mineMatcher && !isComplete(row) && !isFailed(row) && !isArchived(row)).length,
      },
      {
        key: 'team_runs',
        label: 'Team Runs',
        value: all.filter((row) => ownerLabel(row).toLowerCase() !== mineMatcher).length,
      },
      {
        key: 'completed',
        label: 'Completed Runs',
        value: all.filter((row) => isComplete(row)).length,
      },
      {
        key: 'failed',
        label: 'Failed Runs',
        value: all.filter((row) => isFailed(row)).length,
      },
      {
        key: 'pending_review',
        label: 'Pending Review Runs',
        value: all.filter((row) => !isComplete(row) && !isFailed(row) && ['validation', 'registry'].includes(String(row?.current_step || '').trim().toLowerCase())).length,
      },
    ];
  }, [persona, pipelines]);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await mlopsApi.pipelineList();
      const rows = Array.isArray(pick(res)) ? pick(res) : [];
      setPipelines(rows);
      const preferred = activePipelineId
        ? rows.find((p) => Number(p.pipeline_id) === Number(activePipelineId))
        : rows.find((p) => runKey(p) === String(selectedPipelineId))
          || rows.find((p) => String(p?.name || '').trim().toLowerCase() === String(activePipelineName || '').trim().toLowerCase());
      if (preferred) {
        setSelectedPipelineId(runKey(preferred));
      } else {
        setSelectedPipelineId('');
        setFullPipeline(null);
      }
      return rows;
    } catch (e) {
      setError(e?.message || 'Failed to load pipelines');
      setPipelines([]);
      setSelectedPipelineId('');
      return [];
    } finally {
      setLoading(false);
    }
  }, [activePipelineId, activePipelineName, selectedPipelineId]);

  const loadPipelineDetail = useCallback(async (selectedKey) => {
    if (!selectedKey) {
      setFullPipeline(null);
      return;
    }
    const row = findPipelineRow(selectedKey);
    if (!row) {
      setFullPipeline(null);
      return;
    }
    setLoadingDetail(true);
    setError('');
    try {
      let full = row;
      if (row?.pipeline_id != null) {
        const res = await mlopsApi.pipelineGet(row.pipeline_id);
        full = pick(res) || row;
      } else if (row?.workflow_session_id) {
        const res = await mlopsApi.getWorkflowSession({ session_id: row.workflow_session_id });
        const session = res?.session || res?.data?.session || null;
        full = { ...row, workflow_session: session };
      }
      setFullPipeline(full || null);
      setScheduleDraft(normalizeSchedule(full?.schedule));

      const hubState = getScreenState(full?.steps, 'pipeline_hub') || {};
      const rawOrder = Array.isArray(hubState.stage_order) ? hubState.stage_order : defaultStageOrder;
      const ordered = normalizeStageOrder(rawOrder);
      setStageOrder(ordered);
      setOrderDirty(false);
    } catch (e) {
      setError(e?.message || 'Failed to load pipeline details');
      setFullPipeline(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [findPipelineRow]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (activePipelineId != null && activePipelineId !== '') {
      const byId = pipelines.find((pipeline) => Number(pipeline?.pipeline_id) === Number(activePipelineId));
      setSelectedPipelineId(byId ? runKey(byId) : String(activePipelineId));
      return;
    }
    setSelectedPipelineId((prev) => {
      if (prev && pipelines.some((pipeline) => runKey(pipeline) === String(prev))) return prev;
      return '';
    });
  }, [activePipelineId, pipelines]);

  useEffect(() => {
    loadPipelineDetail(selectedPipelineId);
  }, [selectedPipelineId, loadPipelineDetail]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stageDetails = useMemo(() => {
    const dataState = getScreenState(effectivePipeline?.steps, 'data_upload') || {};
    const masterState = getScreenState(effectivePipeline?.steps, 'master') || {};
    const targetState = getScreenState(effectivePipeline?.steps, 'target') || {};
    const edaState = getScreenState(effectivePipeline?.steps, 'eda') || {};
    const preprocessState = getScreenState(effectivePipeline?.steps, 'preprocess') || {};
    const pipelineStatus = String(effectivePipeline?.status || '').toLowerCase();
    const pipelineComplete = ['complete', 'completed', 'done'].includes(pipelineStatus);
    const pipelineHasRun = Boolean(effectivePipeline?.last_run_at || effectivePipeline?.output_dataset_id);
    const runSource = pipelineComplete ? 'Pipeline complete' : pipelineHasRun ? 'Last run available' : 'Model not trained';
    const validationSource = pipelineComplete ? 'Validation completed' : 'Validation pending';
    const registrySource = pipelineComplete ? 'Registry completed' : 'Registry pending';

    return {
      data: {
        summary: `${Number(dataState.total_tables || workflowState?.datasets_count || effectivePipeline?.dataset_ids?.length || 0)} tables - ${Number(dataState.total_rows || workflowState?.master_dataset?.row_count || 0).toLocaleString()} rows`,
        done: completion.data || Boolean(workflowState?.datasets_count),
      },
      master: {
        summary: `Anchor: ${masterState.anchorType || workflowState?.master_dataset?.dataset_type || '-'} - Rows: ${Number(workflowState?.master_dataset?.row_count || 0).toLocaleString() || '-'}`,
        done: completion.master || Boolean(workflowState?.master_dataset_id || workflowState?.master_dataset?.dataset_id),
      },
      target: {
        summary: `Target: ${targetState.currentTargetColumn || targetState.selectedTargetColumn || workflowState?.target_column || '-'}`,
        done: completion.target || Boolean(workflowState?.target_column),
      },
      eda: {
        summary: completion.eda || workflowState?.eda_completed
          ? `Marked complete${targetState.currentTargetColumn || targetState.selectedTargetColumn || workflowState?.target_column ? ` · Target ${targetState.currentTargetColumn || targetState.selectedTargetColumn || workflowState?.target_column}` : ''}`
          : `Status: ${String(edaState.status || 'pending').replace(/_/g, ' ')}`,
        done: completion.eda || Boolean(workflowState?.eda_completed),
      },
      preprocess: {
        summary: `${Array.isArray(preprocessState.steps) ? preprocessState.steps.length : (Array.isArray(workflowState?.preprocess_steps) ? workflowState.preprocess_steps.length : 0)} transform steps`,
        done: completion.preprocess || Boolean(workflowState?.preprocess_dataset_id || workflowState?.preprocess_dataset?.dataset_id || (Array.isArray(workflowState?.preprocess_steps) && workflowState.preprocess_steps.length)),
      },
      model: {
        summary: scopedArtefacts?.modelRun || workflowState?.active_model_run
          ? `AUC ${Number(scopedArtefacts?.modelRun?.metrics?.roc_auc ?? scopedArtefacts?.modelRun?.auc ?? workflowState?.active_model_run?.metrics?.roc_auc ?? workflowState?.active_model_run?.auc ?? 0).toFixed(3)}`
          : runSource,
        done: Boolean(scopedArtefacts?.modelRun || workflowState?.active_model_run?.job_id) || pipelineComplete || pipelineHasRun,
      },
      validation: {
        summary: scopedArtefacts?.validationReport || workflowState?.validation_report
          ? `Threshold ${Number(scopedArtefacts?.validationReport?.optimal_threshold ?? workflowState?.validation_report?.optimal_threshold ?? 0.5).toFixed(2)}`
          : validationSource,
        done: Boolean(scopedArtefacts?.validationReport || workflowState?.validation_report) || pipelineComplete,
      },
      registry: {
        summary: scopedArtefacts?.registryEntry || workflowState?.registry_entry
          ? `Stage ${String(scopedArtefacts?.registryEntry?.stage || workflowState?.registry_entry?.stage || 'candidate').toUpperCase()}`
          : registrySource,
        done: Boolean(scopedArtefacts?.registryEntry || workflowState?.registry_entry) || pipelineComplete,
      },
    };
  }, [completion, effectivePipeline, scopedArtefacts, workflowState]);

  const stageVisualStates = useMemo(() => {
    const next = {};
    stageOrder.forEach((key) => {
      const stepId = String(stageCatalog[key]?.stepId || key);
      const manifestStatus = String(explicitStepStatuses[stepId] || '').toLowerCase();
      if (manifestStatus === 'completed') next[key] = 'done';
      else if (manifestStatus === 'invalidated') next[key] = 'stale';
      else if (manifestStatus === 'blocked') next[key] = 'blocked';
      else if (manifestStatus === 'failed') next[key] = 'failed';
      else if (manifestStatus === 'in_progress') next[key] = 'in_progress';
      else if (staleStepSet.has(stepId)) next[key] = 'stale';
      else if (stageDetails[key]?.done) next[key] = 'done';
      else next[key] = 'pending';
    });
    return next;
  }, [explicitStepStatuses, stageDetails, stageOrder, staleStepSet]);

  const latestChange = savedPipelineState?.complete ? null : (workflowManifest?.latest_change || effectivePipeline?.latest_change || null);
  const manifestInconsistencies = savedPipelineState?.complete
    ? []
    : (Array.isArray(workflowManifest?.inconsistencies) ? workflowManifest.inconsistencies : []);
  const impactedStepLabels = useMemo(() => {
    const impacted = Array.isArray(latestChange?.impacted_steps) ? latestChange.impacted_steps : [];
    return impacted
      .map((step) => workflowStepLabels[String(step)] || String(step || '').replace(/_/g, ' ').trim())
      .filter(Boolean);
  }, [latestChange]);

  const firstIncompleteStage = useMemo(() => {
    return stageOrder.find((key) => stageVisualStates[key] !== 'done') || null;
  }, [stageOrder, stageVisualStates]);

  const handleSelect = useCallback((pipeline) => {
    if (!pipeline) return;
    setSelectedPipelineId(runKey(pipeline));
    onPipelineActivated?.({
      pipeline_id: pipeline?.pipeline_id != null ? Number(pipeline.pipeline_id) : null,
      name: String(pipeline.name || ''),
      workflow_session_id: pipeline?.workflow_session_id || null,
    });
  }, [onPipelineActivated]);

  const handleViewPipeline = useCallback(async (pipeline = selected) => {
    if (!pipeline) return;
    setError('');
    handleSelect(pipeline);
    try {
      await loadPipelineDetail(runKey(pipeline));
    } catch (e) {
      setError(e?.message || 'Failed to load selected run');
    }
  }, [handleSelect, loadPipelineDetail, selected]);

  const buildSavePayload = useCallback((nextSteps) => {
    const src = fullPipeline || {};
    return {
      pipeline_id: src.pipeline_id != null ? Number(src.pipeline_id) : null,
      pipeline_uuid: src.pipeline_uuid || null,
      name: String(src.name || ''),
      pipeline_type: src.pipeline_type || src.model_family || 'fcc',
      model_family: src.model_family || src.pipeline_type || null,
      dataset_id: Number(src.dataset_id || 0),
      grain: src.grain || 'transaction',
      anchor_dataset_id: src.anchor_dataset_id || null,
      dataset_ids: Array.isArray(src.dataset_ids) ? src.dataset_ids : [],
      joins: Array.isArray(src.joins) ? src.joins : [],
      transforms: Array.isArray(src.transforms) ? src.transforms : [],
      str_config: src.str_config || {},
      schedule: src.schedule || {},
      output_name: src.output_name || 'master_dataset',
      created_by_persona: src.created_by_persona || 'technical',
      steps: nextSteps,
    };
  }, [fullPipeline]);

  const saveStageOrder = useCallback(async () => {
    if (!fullPipeline?.pipeline_id) return;
    setSavingOrder(true);
    setError('');
    try {
      const hubState = getScreenState(fullPipeline.steps, 'pipeline_hub') || {};
      const nextSteps = upsertScreenState(fullPipeline.steps, 'pipeline_hub', {
        ...hubState,
        stage_order: stageOrder,
      });
      await mlopsApi.pipelineSave(buildSavePayload(nextSteps));
      await loadPipelines();
      await loadPipelineDetail(runKey(fullPipeline));
      setOrderDirty(false);
    } catch (e) {
      setError(e?.message || 'Failed to save stage order');
    } finally {
      setSavingOrder(false);
    }
  }, [buildSavePayload, fullPipeline, loadPipelineDetail, loadPipelines, stageOrder]);

  const handleDragStart = useCallback((key) => setDragStageKey(key), []);

  const handleDrop = useCallback((targetKey) => {
    if (!dragStageKey || dragStageKey === targetKey) return;
    const srcIndex = stageOrder.indexOf(dragStageKey);
    const dstIndex = stageOrder.indexOf(targetKey);
    if (srcIndex < 0 || dstIndex < 0) return;

    const next = [...stageOrder];
    const [moved] = next.splice(srcIndex, 1);
    next.splice(dstIndex, 0, moved);
    setStageOrder(next);
    setOrderDirty(true);
    setDragStageKey('');
  }, [dragStageKey, stageOrder]);

  const handleResume = useCallback(async (pipeline = selected) => {
    if (!pipeline) return;
    try {
      if (pipeline?.pipeline_id != null) {
        const res = await mlopsApi.pipelineGet(pipeline.pipeline_id);
        onResumePipeline?.(pick(res));
        return;
      }
      onResumePipeline?.(pipeline);
    } catch (e) {
      setError(e?.message || 'Failed to load selected pipeline');
    }
  }, [onResumePipeline, selected]);

  const handleClonePipeline = useCallback(async (pipeline = selected) => {
    if (!pipeline) return;
    setCloningPipeline(true);
    setError('');
    setMessage('');
    try {
      let cloneSelection = null;
      if (pipeline?.pipeline_id != null) {
        const res = await mlopsApi.pipelineGet(pipeline.pipeline_id);
        const detail = pick(res) || pipeline;
        const cloneName = buildCloneName(detail?.name || 'Pipeline');
        const savedRes = await mlopsApi.pipelineSave({
          name: cloneName,
          pipeline_type: detail?.pipeline_type || detail?.model_family || 'fcc',
          model_family: detail?.model_family || detail?.pipeline_type || null,
          dataset_id: Number(detail?.dataset_id || 0) || null,
          grain: detail?.grain || 'transaction',
          anchor_dataset_id: detail?.anchor_dataset_id || null,
          dataset_ids: Array.isArray(detail?.dataset_ids) ? detail.dataset_ids : [],
          joins: Array.isArray(detail?.joins) ? detail.joins : [],
          transforms: Array.isArray(detail?.transforms) ? detail.transforms : [],
          str_config: detail?.str_config || {},
          schedule: detail?.schedule || {},
          output_name: detail?.output_name || 'master_dataset',
          created_by_persona: detail?.created_by_persona || persona,
          steps: Array.isArray(detail?.steps) ? detail.steps : [],
        });
        const saved = pick(savedRes) || {};
        const clonedPipelineId = Number(saved?.pipeline_id || 0) || null;
        let clonedSessionId = '';
        let sourceSession = detail?.workflow_session || null;
        if (!sourceSession && pipeline?.workflow_session_id) {
          const sourceSessionRes = await mlopsApi.getWorkflowSession({ session_id: pipeline.workflow_session_id });
          sourceSession = sourceSessionRes?.session || sourceSessionRes?.data?.session || null;
        }
        if (sourceSession && clonedPipelineId) {
          const sessionRes = await mlopsApi.saveWorkflowSession({
            pipeline_id: clonedPipelineId,
            pipeline_name: cloneName,
            current_module: sourceSession?.current_module || pipeline?.current_module || 'mlops',
            current_step: sourceSession?.current_step || pipeline?.current_step || 'data',
            current_state: patchSessionPayloadObject(sourceSession?.current_state, {
              pipelineId: clonedPipelineId,
              pipelineName: cloneName,
              clearRuntimeIds: true,
            }),
            last_stable_step: sourceSession?.last_stable_step || pipeline?.current_step || 'data',
            last_stable_state: patchSessionPayloadObject(sourceSession?.last_stable_state, {
              pipelineId: clonedPipelineId,
              pipelineName: cloneName,
              clearRuntimeIds: true,
            }),
            case_scope: cloneDeepSafe(sourceSession?.case_scope),
            handoff_summary: patchSessionPayloadObject(sourceSession?.handoff_summary, {
              pipelineId: clonedPipelineId,
              pipelineName: cloneName,
              clearRuntimeIds: true,
            }),
            selected_case_id: sourceSession?.selected_case_id || undefined,
            status: 'draft',
          });
          clonedSessionId = String(sessionRes?.session?.session_id || sessionRes?.data?.session?.session_id || '').trim();
        }
        cloneSelection = {
          pipeline_id: clonedPipelineId,
          name: cloneName,
          workflow_session_id: clonedSessionId || null,
        };
        setMessage(`Cloned "${detail?.name || 'Pipeline'}" as "${cloneName}".`);
      } else {
        const sessionRes = pipeline?.workflow_session_id
          ? await mlopsApi.getWorkflowSession({ session_id: pipeline.workflow_session_id })
          : null;
        const session = sessionRes?.session || sessionRes?.data?.session || pipeline?.workflow_session || null;
        const mlopsState = session?.current_state?.mlops_state || {};
        const cloneName = buildCloneName(pipeline?.name || 'Draft run');
        const savedSessionRes = await mlopsApi.saveWorkflowSession({
          pipeline_name: cloneName,
          current_module: 'mlops',
          current_step: mlopsState?.current_step || pipeline?.current_step || 'data',
          current_state: {
            ...patchSessionPayloadObject(session?.current_state, {
              pipelineId: null,
              pipelineName: cloneName,
              clearRuntimeIds: true,
            }),
            mlops_state: patchSessionPayloadObject(mlopsState, {
              pipelineId: null,
              pipelineName: cloneName,
              clearRuntimeIds: true,
            }),
          },
          last_stable_step: session?.last_stable_step || pipeline?.current_step || 'data',
          last_stable_state: patchSessionPayloadObject(session?.last_stable_state, {
            pipelineId: null,
            pipelineName: cloneName,
            clearRuntimeIds: true,
          }),
          case_scope: cloneDeepSafe(session?.case_scope),
          handoff_summary: patchSessionPayloadObject(session?.handoff_summary, {
            pipelineId: null,
            pipelineName: cloneName,
            clearRuntimeIds: true,
          }),
          status: 'draft',
        });
        const savedSession = savedSessionRes?.session || savedSessionRes?.data?.session || null;
        cloneSelection = {
          pipeline_id: null,
          name: cloneName,
          workflow_session_id: savedSession?.session_id || null,
        };
        setMessage(`Cloned draft run as "${cloneName}".`);
      }
      await loadPipelines();
      if (cloneSelection) {
        const nextKey = selectionKeyFor({
          pipelineId: cloneSelection.pipeline_id,
          workflowSessionId: cloneSelection.workflow_session_id,
        });
        if (nextKey) setSelectedPipelineId(nextKey);
        onPipelineActivated?.(cloneSelection);
      }
    } catch (e) {
      setError(e?.message || 'Failed to clone pipeline run');
    } finally {
      setCloningPipeline(false);
    }
  }, [loadPipelines, onPipelineActivated, persona, selected]);

  const handleArchivePipeline = useCallback(async (pipeline = selected) => {
    if (!pipeline) return;
    setArchivingPipeline(true);
    setError('');
    setMessage('');
    try {
      const sessionRes = pipeline?.workflow_session_id
        ? await mlopsApi.getWorkflowSession({ session_id: pipeline.workflow_session_id })
        : null;
      const session = sessionRes?.session || pipeline?.workflow_session || null;
      const mlopsState = session?.current_state?.mlops_state || {};
      await mlopsApi.saveWorkflowSession({
        session_id: session?.session_id || pipeline?.workflow_session_id || undefined,
        pipeline_id: pipeline?.pipeline_id ?? undefined,
        pipeline_name: pipeline?.name || session?.pipeline_name || 'Pipeline',
        run_id: pipeline?.run_id || session?.run_id || undefined,
        deployment_id: pipeline?.deployment_id || session?.deployment_id || undefined,
        current_module: pipeline?.current_module || session?.current_module || 'mlops',
        current_step: pipeline?.current_step || session?.current_step || 'data',
        current_state: session?.current_state || {
          mlops_state: {
            pipeline_name: pipeline?.name || session?.pipeline_name || 'Pipeline',
            current_step: pipeline?.current_step || 'data',
            completion_pct: pipeline?.completion_pct || 0,
            completed_steps: pipeline?.completed_steps || 0,
            total_steps: pipeline?.total_steps || 10,
            persona: pipeline?.created_by_persona || persona,
          },
        },
        last_stable_step: session?.last_stable_step || pipeline?.current_step || mlopsState?.current_step || 'data',
        last_stable_state: session?.last_stable_state || {},
        checkpoint_key: session?.checkpoint_key || pipeline?.last_checkpoint_key || undefined,
        status: 'archived',
      });
      setMessage(`Archived "${pipeline?.name || 'pipeline run'}".`);
      await loadPipelines();
    } catch (e) {
      setError(e?.message || 'Failed to archive pipeline run');
    } finally {
      setArchivingPipeline(false);
    }
  }, [loadPipelines, persona, selected]);

  const handleFinishPipeline = useCallback(async () => {
    if (!onOpenStep) return;
    if (firstIncompleteStage) {
      onOpenStep(firstIncompleteStage);
      return;
    }
    setError('Pipeline is complete. Use Re-Run DAG or Scheduler below.');
  }, [firstIncompleteStage, onOpenStep]);

  const handleRun = useCallback(async () => {
    if (!selected?.pipeline_id) return;
    setRunning(true);
    setError('');
    setRunState(null);
    try {
      const runRes = await mlopsApi.pipelineRun(selected.pipeline_id);
      const runId = runRes?.run_id || runRes?.data?.run_id || null;
      if (!runId) throw new Error('Pipeline run did not return run_id');
      setRunState({ run_id: runId, status: 'pending', log: [] });

      const poll = async () => {
        try {
          const statusRes = await mlopsApi.pipelineRunStatus(selected.pipeline_id, runId);
          const next = pick(statusRes)?.data || pick(statusRes) || {};
          setRunState(next);
          const st = String(next?.status || '').toLowerCase();
          if (['complete', 'completed', 'failed', 'error'].includes(st)) {
            if (pollRef.current) clearInterval(pollRef.current);
            setRunning(false);
            loadPipelines();
          }
        } catch (pollErr) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          setError(pollErr?.message || 'Failed while polling run status');
        }
      };

      await poll();
      pollRef.current = setInterval(poll, 2000);
    } catch (e) {
      setRunning(false);
      setError(e?.message || 'Failed to start pipeline run');
    }
  }, [selected, loadPipelines]);

  const openDeleteDialog = useCallback(async () => {
    if (!selected?.pipeline_id && !selected?.workflow_session_id) return;
    setDeleteImpact(null);
    setDeleteImpactError('');
    setDeleteSentinelAction('keep');
    setDeleteDialogOpen(true);
    if (selected?.pipeline_id == null) return;
    setDeleteImpactLoading(true);
    try {
      const res = await mlopsApi.pipelineDeleteImpact(selected.pipeline_id);
      const impact = pick(res) || {};
      setDeleteImpact(impact);
      const purgeAllowed = Boolean(impact?.sentinel_purge_allowed);
      setDeleteSentinelAction(purgeAllowed ? 'purge_imported_queue' : 'keep');
    } catch (e) {
      setDeleteImpactError(e?.message || 'Failed to inspect Sentinel impact');
    } finally {
      setDeleteImpactLoading(false);
    }
  }, [selected]);

  const closeDeleteDialog = useCallback(() => {
    if (deletingPipeline) return;
    setDeleteDialogOpen(false);
    setDeleteImpact(null);
    setDeleteImpactLoading(false);
    setDeleteImpactError('');
    setDeleteSentinelAction('keep');
  }, [deletingPipeline]);

  const handleDeletePipeline = useCallback(async () => {
    if (!selected?.pipeline_id && !selected?.workflow_session_id) return;
    const name = String(selected?.name || `Pipeline ${selected.pipeline_id || selected.workflow_session_id}`);
    setDeleteDialogOpen(false);
    setDeletingPipeline(true);
    setError('');
    setMessage('');
    try {
      if (selected?.pipeline_id != null) {
        const res = await mlopsApi.pipelineDelete(selected.pipeline_id, {
          delete_artifacts: true,
          delete_files: true,
          sentinel_action: deleteSentinelAction,
        });
        const payload = pick(res) || {};
        const deletedArtifacts = Number(payload?.deleted_artifacts_count || 0);
        const deletedSessions = Number(payload?.deleted_workflow_sessions_count || 0);
        const sentinelPurged = Number(payload?.sentinel_purged_imports_count || 0);
        const sentinelMarked = Number(payload?.sentinel_imports_marked?.updated_import_count || 0);
        setMessage(
          `Deleted "${name}"`
          + `${deletedArtifacts ? ` · ${deletedArtifacts} artefact(s) removed` : ''}`
          + `${deletedSessions ? ` · ${deletedSessions} workflow session(s) cleared` : ''}`
          + `${sentinelPurged ? ` · ${sentinelPurged} Sentinel import batch(es) removed` : ''}`
          + `${!sentinelPurged && sentinelMarked ? ` · ${sentinelMarked} Sentinel import record(s) marked as deleted in FCC` : ''}`,
        );
      } else if (selected?.workflow_session_id) {
        await mlopsApi.deleteWorkflowSession(selected.workflow_session_id);
        setMessage(`Deleted "${name}".`);
      }
      const remainingRows = await loadPipelines();
      await Promise.resolve(onPipelineDeleted?.({
        deletedPipelineId: selected?.pipeline_id != null ? Number(selected.pipeline_id) : null,
        deletedWorkflowSessionId: String(selected?.workflow_session_id || '').trim() || null,
        deletedName: name,
        deletedPipelineType: pipelineFamilyKey(selected),
        remainingRuns: Array.isArray(remainingRows) ? remainingRows : [],
      }));
      setSelectedPipelineId('');
      setFullPipeline(null);
      setRunState(null);
      setDeleteImpact(null);
      setDeleteImpactError('');
      setDeleteSentinelAction('keep');
    } catch (e) {
      setError(e?.message || 'Failed to delete pipeline');
    } finally {
      setDeletingPipeline(false);
    }
  }, [deleteSentinelAction, loadPipelines, onPipelineDeleted, selected]);

  const openRenameDialog = useCallback((pipeline = selected) => {
    if (!pipeline) return;
    setRenameDialog({
      open: true,
      value: String(pipeline?.name || ''),
      saving: false,
      error: '',
    });
  }, [selected]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialog((prev) => (
      prev.saving
        ? prev
        : { open: false, value: '', saving: false, error: '' }
    ));
  }, []);

  const handleRenamePipeline = useCallback(async () => {
    if (!selected) return;
    const nextName = String(renameDialog.value || '').trim();
    if (!nextName) {
      setRenameDialog((prev) => ({ ...prev, error: 'Run name is required.' }));
      return;
    }
    const duplicate = pipelines.some((row) => (
      runKey(row) !== runKey(selected)
      && String(row?.name || '').trim().toLowerCase() === nextName.toLowerCase()
    ));
    if (duplicate) {
      setRenameDialog((prev) => ({ ...prev, error: 'Run name already exists. Use a different name.' }));
      return;
    }

    setRenameDialog((prev) => ({ ...prev, saving: true, error: '' }));
    setError('');
    setMessage('');
    try {
      if (selected?.pipeline_id != null) {
        await mlopsApi.pipelineRename(selected.pipeline_id, nextName);
        if (selected?.workflow_session_id) {
          const sessionRes = await mlopsApi.getWorkflowSession({ session_id: selected.workflow_session_id });
          const session = sessionRes?.session || sessionRes?.data?.session || null;
          if (session) {
            await mlopsApi.saveWorkflowSession({
              session_id: selected.workflow_session_id,
              pipeline_id: selected.pipeline_id,
              pipeline_name: nextName,
              run_id: session?.run_id || undefined,
              deployment_id: session?.deployment_id || undefined,
              publish_id: session?.publish_id || undefined,
              current_module: session?.current_module || selected?.current_module || 'mlops',
              current_step: session?.current_step || selected?.current_step || 'data',
              current_state: patchSessionPayloadObject(session?.current_state, {
                pipelineId: selected.pipeline_id,
                pipelineName: nextName,
              }),
              last_stable_step: session?.last_stable_step || undefined,
              last_stable_state: patchSessionPayloadObject(session?.last_stable_state, {
                pipelineId: selected.pipeline_id,
                pipelineName: nextName,
              }),
              case_scope: cloneDeepSafe(session?.case_scope),
              handoff_summary: patchSessionPayloadObject(session?.handoff_summary, {
                pipelineId: selected.pipeline_id,
                pipelineName: nextName,
              }),
              checkpoint_key: session?.checkpoint_key || undefined,
              selected_case_id: session?.selected_case_id || selected?.selected_case_id || undefined,
              status: session?.status || selected?.workflow_status || selected?.status || 'draft',
            });
          }
        }
      } else if (selected?.workflow_session_id) {
        const sessionRes = await mlopsApi.getWorkflowSession({ session_id: selected.workflow_session_id });
        const session = sessionRes?.session || sessionRes?.data?.session || null;
        await mlopsApi.saveWorkflowSession({
          session_id: selected.workflow_session_id,
          pipeline_id: session?.pipeline_id ?? undefined,
          pipeline_name: nextName,
          run_id: session?.run_id || undefined,
          deployment_id: session?.deployment_id || undefined,
          publish_id: session?.publish_id || undefined,
          current_module: session?.current_module || selected?.current_module || 'mlops',
          current_step: session?.current_step || selected?.current_step || 'data',
          current_state: patchSessionPayloadObject(session?.current_state, {
            pipelineName: nextName,
          }),
          last_stable_step: session?.last_stable_step || undefined,
          last_stable_state: patchSessionPayloadObject(session?.last_stable_state, {
            pipelineName: nextName,
          }),
          case_scope: cloneDeepSafe(session?.case_scope),
          handoff_summary: patchSessionPayloadObject(session?.handoff_summary, {
            pipelineName: nextName,
          }),
          checkpoint_key: session?.checkpoint_key || undefined,
          selected_case_id: session?.selected_case_id || selected?.selected_case_id || undefined,
          status: session?.status || selected?.workflow_status || selected?.status || 'draft',
        });
      }

      setRenameDialog({ open: false, value: '', saving: false, error: '' });
      setMessage(`Renamed "${selected?.name || 'run'}" to "${nextName}".`);
      await loadPipelines();
      const nextKey = selectionKeyFor({
        pipelineId: selected?.pipeline_id,
        workflowSessionId: selected?.workflow_session_id,
      });
      if (nextKey) setSelectedPipelineId(nextKey);
      onPipelineActivated?.({
        pipeline_id: selected?.pipeline_id != null ? Number(selected.pipeline_id) : null,
        name: nextName,
        workflow_session_id: selected?.workflow_session_id || null,
      });
    } catch (e) {
      setRenameDialog((prev) => ({
        ...prev,
        saving: false,
        error: e?.message || 'Failed to rename run',
      }));
    }
  }, [loadPipelines, onPipelineActivated, pipelines, renameDialog.value, selected]);

  const saveSchedule = useCallback(async () => {
    if (!selected?.pipeline_id) return;
    setSavingSchedule(true);
    setError('');
    try {
      await mlopsApi.pipelineSchedule(selected.pipeline_id, scheduleDraft);
      await loadPipelineDetail(runKey(selected));
      await loadPipelines();
    } catch (e) {
      setError(e?.message || 'Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  }, [loadPipelineDetail, loadPipelines, scheduleDraft, selected]);

  const currentStatus = statusTone(savedPipelineState?.runStatus || effectivePipeline?.run_status || effectivePipeline?.status || selected?.run_status || selected?.status);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      <Paper variant="outlined" sx={{ borderColor: tone.border, borderRadius: 2, overflow: 'hidden', bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
        <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid #fed7aa', bgcolor: '#fff7ed' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} flexWrap="wrap">
            <Stack direction="row" spacing={1.2} alignItems="center" flexWrap="wrap">
              <Box sx={{ bgcolor: tone.orange, color: '#ffffff', p: 0.6, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AccountTree sx={{ fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#c2410c', letterSpacing: '-0.01em' }}>
                Pipeline History & Resume
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                startIcon={<Add sx={{ fontSize: 15 }} />}
                onClick={onCreateNewPipeline}
                sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' }, borderRadius: '6px', fontWeight: 600, px: 2 }}
              >
                New Run
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Refresh sx={{ fontSize: 15 }} />}
                onClick={loadPipelines}
                disabled={loading}
                sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text, bgcolor: '#ffffff' }}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ p: 2.5 }}>
          {selectionNotice && (
            <Alert severity="warning" sx={{ mb: 2, py: 0.5, borderRadius: '6px' }}>
              {selectionNotice}
            </Alert>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr 0.8fr 0.8fr' }, gap: 1.5, mb: 2 }}>
            <TextField
              size="small"
              label="Search runs"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by pipeline, run ID, owner, or step"
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
            />
            <FormControl size="small">
              <InputLabel>Scope</InputLabel>
              <Select value={scopeFilter} label="Scope" onChange={(e) => setScopeFilter(String(e.target.value))} sx={{ borderRadius: '6px' }}>
                <MenuItem value="all">All runs</MenuItem>
                <MenuItem value="mine">My runs</MenuItem>
                <MenuItem value="team">Team runs</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>Family</InputLabel>
              <Select value={familyFilter} label="Family" onChange={(e) => setFamilyFilter(String(e.target.value))} sx={{ borderRadius: '6px' }}>
                <MenuItem value="all">All families</MenuItem>
                <MenuItem value="fcc">FCC</MenuItem>
                <MenuItem value="mule">Mule</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(String(e.target.value))} sx={{ borderRadius: '6px' }}>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="archived">Archived</MenuItem>
                <MenuItem value="all">All statuses</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {pipelines.length === 0 ? (
            <Alert severity="info" sx={{ py: 0.5, borderRadius: '6px' }}>
              {activeEnvironmentName
                ? `No saved pipeline runs were found in environment "${activeEnvironmentName}".`
                : 'No saved pipeline runs were found for the current environment.'}
            </Alert>
          ) : (
              <Box sx={{ overflowX: 'auto', border: `1px solid ${tone.border}`, borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Pipeline Name', 'Family', 'Run ID', 'Created By', 'Owner', 'Created On', 'Last Updated', 'Current Step', 'Progress %', 'Status', 'Last Completed Step', 'Next Pending Step', 'Environment', 'Actions'].map((label) => (
                      <th
                        key={label}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: 11,
                          letterSpacing: 0.3,
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          color: '#64748b',
                          borderBottom: `1px solid ${tone.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPipelines.map((pipeline) => {
                    const isSelected = runKey(pipeline) === String(selectedPipelineId);
                    const st = statusTone(pipeline.run_status || pipeline.workflow_status || pipeline.status);
                    return (
                      <tr
                        key={pipeline.manager_key || pipeline.pipeline_id || pipeline.workflow_session_id || pipeline.run_ref || pipeline.name}
                        onClick={() => handleSelect(pipeline)}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? '#fff7ed' : '#ffffff',
                          borderBottom: `1px solid ${tone.border}`,
                          transition: 'background 0.12s ease',
                        }}
                      >
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{pipeline.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{pipeline.pipeline_id != null ? `Pipeline ${pipeline.pipeline_id}` : 'Draft workflow session'}</div>
                        </td>
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: `1px solid ${pipelineFamilyKey(pipeline) === 'mule' ? '#fdba74' : tone.border}`,
                              color: pipelineFamilyKey(pipeline) === 'mule' ? tone.orange : tone.text,
                              background: pipelineFamilyKey(pipeline) === 'mule' ? '#fff7ed' : '#f8fafc',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {pipelineFamilyShort(pipeline)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{pipelineRunRef(pipeline) || pipeline.run_id || '-'}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap' }}>{pipeline.created_by_label || pipeline.created_by_persona || '-'}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap' }}>{ownerLabel(pipeline)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{formatDateTime(pipeline.created_at)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{formatDateTime(pipeline.last_active_at || pipeline.updated_at)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#0f172a', fontWeight: 500 }}>{pipeline.workspace_step_label || pipeline.current_step_label || '-'}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>{progressNumber(pipeline)}%</td>
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: '9999px',
                              border: `1px solid ${st.color}40`,
                              color: st.color,
                              fontSize: 11,
                              fontWeight: 600,
                              background: st.bg,
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{lastCompletedStepLabel(pipeline)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>{nextPendingStepLabel(pipeline)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{activeEnvironmentName || '-'}</td>
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <Stack direction="row" spacing={0.5}>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleViewPipeline(pipeline); }} sx={{ minWidth: 0, px: 1, textTransform: 'none', borderRadius: '4px', fontSize: 11.5 }}>View</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleResume(pipeline); }} sx={{ minWidth: 0, px: 1, textTransform: 'none', color: tone.orange, fontWeight: 600, borderRadius: '4px', fontSize: 11.5 }}>Resume</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); openRenameDialog(pipeline); }} sx={{ minWidth: 0, px: 1, textTransform: 'none', borderRadius: '4px', fontSize: 11.5 }}>Rename</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleClonePipeline(pipeline); }} sx={{ minWidth: 0, px: 1, textTransform: 'none', borderRadius: '4px', fontSize: 11.5 }}>Clone</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleArchivePipeline(pipeline); }} sx={{ minWidth: 0, px: 1, textTransform: 'none', borderRadius: '4px', fontSize: 11.5 }}>Archive</Button>
                          </Stack>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredPipelines.length && (
                    <tr>
                      <td colSpan={14} style={{ padding: '24px 14px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
                        No pipeline runs match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Box>
          )}
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
        {/* Run Details Drawer */}
        <Paper
          variant="outlined"
          sx={{
            width: { xs: '100%', xl: 320 },
            minWidth: { xs: 0, xl: 320 },
            borderColor: tone.border,
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            bgcolor: '#ffffff',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #fed7aa', bgcolor: '#fff7ed', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone.orange }} />
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Run Details Drawer
            </Typography>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1.5 }}>
            {pipelines.length === 0 ? (
              <Alert severity="info" sx={{ py: 0.5, borderRadius: '6px' }}>
                Select or create a run to view pipeline details.
              </Alert>
            ) : (
              <Stack spacing={1}>
                {pipelines.map((pipeline) => {
                  if (!filteredPipelines.some((row) => runKey(row) === runKey(pipeline))) return null;
                  const isSelected = runKey(pipeline) === String(selectedPipelineId);
                  const savedState = deriveFccSavedRunState(pipeline);
                  const st = statusTone(savedState?.runStatus || pipeline.run_status || pipeline.workflow_status || pipeline.status);
                  const stepsDisplay = savedState
                    ? `${savedState.doneCount}/${savedState.totalCount}`
                    : (pipeline.steps_completed_display || `${pipeline.completed_steps || 0}/${pipeline.total_steps || 0}`);
                  return (
                    <Box
                      key={pipeline.manager_key || pipeline.pipeline_id || pipeline.workflow_session_id || pipeline.run_ref || pipeline.name}
                      onClick={() => handleSelect(pipeline)}
                      sx={{
                        p: 1.5,
                        borderRadius: '8px',
                        border: `1px solid ${isSelected ? tone.orange : '#e2e8f0'}`,
                        borderLeft: isSelected ? `5px solid ${tone.orange}` : '1px solid #e2e8f0',
                        bgcolor: isSelected ? '#fff7ed' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        '&:hover': {
                          bgcolor: isSelected ? '#fff7ed' : '#f8fafc',
                          borderColor: isSelected ? tone.orange : '#cbd5e1',
                        },
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ fontSize: 13.5, fontWeight: isSelected ? 800 : 700, color: isSelected ? '#c2410c' : tone.text }}>
                          {pipeline.name}
                        </Typography>
                        {isSelected && (
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: tone.orange }}>
                              Selected
                            </Typography>
                            <ArrowForward sx={{ fontSize: 14, color: tone.orange }} />
                          </Stack>
                        )}
                      </Stack>
                      <Typography sx={{ mt: 0.5, fontSize: 11.5, color: '#64748b' }}>
                        {pipelineFamilyShort(pipeline)} · {st.label} · {stepsDisplay} steps
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Paper>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {/* Main Action Bar */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: tone.border, bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap">
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: selected ? tone.orange : '#94a3b8' }} />
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: tone.text, letterSpacing: '-0.01em' }}>
                  {selected?.name || activePipelineName || 'No run selected'}
                </Typography>
                {selected && (
                  <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600, bgcolor: '#f8fafc', px: 1, py: 0.3, borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    Active Configuration
                  </Typography>
                )}
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Restore sx={{ fontSize: 16 }} />}
                  onClick={handleResume}
                  disabled={!selected}
                  sx={{
                    textTransform: 'none',
                    bgcolor: tone.orange,
                    '&:hover': { bgcolor: '#b83d00' },
                    borderRadius: '6px',
                    fontWeight: 700,
                    px: 2.5,
                    py: 0.8,
                    fontSize: 13,
                    boxShadow: '0 2px 4px rgba(234, 88, 12, 0.25)',
                  }}
                >
                  Resume Run
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AccountTree sx={{ fontSize: 15 }} />}
                  endIcon={dagExpanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                  onClick={() => setDagExpanded(!dagExpanded)}
                  disabled={!selected}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    borderColor: dagExpanded ? tone.orange : tone.border,
                    color: dagExpanded ? tone.orange : tone.text,
                    bgcolor: dagExpanded ? '#fff7ed' : '#ffffff',
                  }}
                >
                  {dagExpanded ? 'Hide DAG & Workflow' : 'Show DAG & Execution Workflow'}
                </Button>
              </Stack>
            </Stack>

            <Divider sx={{ my: 2, borderColor: '#f1f5f9' }} />

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, mr: 0.5 }}>
                Run Options:
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DriveFileRenameOutline sx={{ fontSize: 14 }} />}
                onClick={() => openRenameDialog()}
                disabled={!selected}
                sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text, fontSize: 12 }}
              >
                Rename
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopy sx={{ fontSize: 14 }} />}
                onClick={() => handleClonePipeline()}
                disabled={!selected || cloningPipeline}
                sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text, fontSize: 12 }}
              >
                {cloningPipeline ? 'Cloning...' : 'Clone'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArchiveOutlined sx={{ fontSize: 14 }} />}
                onClick={() => handleArchivePipeline()}
                disabled={!selected || archivingPipeline}
                sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text, fontSize: 12 }}
              >
                {archivingPipeline ? 'Archiving...' : 'Archive'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<VisibilityOutlined sx={{ fontSize: 14 }} />}
                onClick={() => handleViewPipeline()}
                disabled={!selected}
                sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text, fontSize: 12 }}
              >
                View
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DeleteForever sx={{ fontSize: 14 }} />}
                onClick={openDeleteDialog}
                disabled={!selected || deletingPipeline || running}
                sx={{
                  textTransform: 'none',
                  color: tone.bad,
                  borderColor: '#fecaca',
                  '&:hover': { borderColor: tone.bad, bgcolor: '#fef2f2' },
                  borderRadius: '6px',
                  fontWeight: 500,
                  fontSize: 12,
                }}
              >
                {deletingPipeline ? 'Deleting...' : 'Delete'}
              </Button>
            </Stack>

            {manifestInconsistencies.length > 0 && (
              <Alert severity="error" sx={{ mt: 2, borderRadius: '6px' }}>
                <Typography sx={{ fontSize: 12, color: tone.text, fontWeight: 600 }}>
                  Run consistency issue
                </Typography>
                <Typography sx={{ fontSize: 12, color: tone.text, mt: 0.3 }}>
                  {manifestInconsistencies[0]?.reason || 'This run has contradictory checkpoint state and should be repaired before resume.'}
                </Typography>
              </Alert>
            )}
          </Paper>

          {/* Expandable DAG & Execution Workflow section */}
          <Collapse in={dagExpanded}>
            <Stack spacing={2}>
              {/* DAG View */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: tone.border, bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 1.5 }}>
                  DAG View (Saved Steps)
                </Typography>
                {loadingDetail && (
                  <Typography sx={{ fontSize: 12, color: tone.muted }}>
                    Loading pipeline details...
                  </Typography>
                )}
                {!loadingDetail && (
                  <Box sx={{ overflowX: 'auto', pb: 1 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: { xs: 860, lg: 1120 } }}>
                      {stageOrder.map((key, idx) => {
                        const stage = stageCatalog[key];
                        if (!stage) return null;
                        const visualState = stageVisualStates[key] || 'pending';
                        const done = visualState === 'done';
                        const stale = visualState === 'stale';
                        const blocked = visualState === 'blocked';
                        const failed = visualState === 'failed';
                        const running = visualState === 'in_progress';
                        return (
                          <React.Fragment key={key}>
                            <Paper
                              variant="outlined"
                              sx={{
                                width: { xs: 180, lg: 200 },
                                p: 1.5,
                                borderRadius: '8px',
                                borderColor: failed ? '#fca5a5' : stale ? '#fde68a' : done ? '#bbf7d0' : tone.border,
                                bgcolor: done ? '#f0fdf4' : stale ? '#fffbeb' : '#ffffff',
                                flexShrink: 0,
                                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
                              }}
                            >
                              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text }}>
                                  {stage.label}
                                </Typography>
                                <Typography sx={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: failed ? tone.bad : stale ? tone.warn : done ? tone.good : tone.muted,
                                }}>
                                  {failed ? 'Failed' : stale ? 'Needs rerun' : done ? 'Done' : blocked ? 'Blocked' : running ? 'In progress' : 'Pending'}
                                </Typography>
                              </Stack>
                              <Typography sx={{ fontSize: 11, color: tone.muted, minHeight: 28, lineHeight: 1.3 }}>
                                {stageDetails[key]?.summary || 'No saved details yet'}
                              </Typography>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => onOpenStep?.(stage.stepId, selected || effectivePipeline || null)}
                                sx={{ mt: 0.75, px: 0, minWidth: 0, textTransform: 'none', fontSize: 11, fontWeight: 600, color: tone.orange }}
                              >
                                Open Step &rarr;
                              </Button>
                            </Paper>
                            {idx < stageOrder.length - 1 && (
                              <Typography sx={{ color: '#cbd5e1', fontSize: 16, fontWeight: 700 }}>&rarr;</Typography>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </Paper>

              {/* Run Order */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: tone.border, bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text }}>
                    Run Order (Drag to Reorder)
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Save sx={{ fontSize: 14 }} />}
                    onClick={saveStageOrder}
                    disabled={!selected || !orderDirty || savingOrder}
                    sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text }}
                  >
                    {savingOrder ? 'Saving...' : 'Save Order'}
                  </Button>
                </Stack>
                <Stack spacing={0.8}>
                  {stageOrder.map((key) => {
                    const stage = stageCatalog[key];
                    if (!stage) return null;
                    const visualState = stageVisualStates[key] || 'pending';
                    const done = visualState === 'done';
                    const stale = visualState === 'stale';
                    const blocked = visualState === 'blocked';
                    const failed = visualState === 'failed';
                    const running = visualState === 'in_progress';
                    return (
                      <Box
                        key={`order_${key}`}
                        draggable
                        onDragStart={() => handleDragStart(key)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(key)}
                        sx={{
                          px: 1.5,
                          py: 1,
                          borderRadius: '6px',
                          border: `1px solid ${dragStageKey === key ? tone.orange : tone.border}`,
                          bgcolor: dragStageKey === key ? '#fff7ed' : '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.25,
                          cursor: 'grab',
                          transition: 'all 0.12s ease',
                          '&:hover': {
                            bgcolor: '#f8fafc',
                          },
                        }}
                      >
                        <DragIndicator sx={{ fontSize: 16, color: '#94a3b8' }} />
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: tone.text, flex: 1 }}>
                          {stage.label}
                        </Typography>
                        <Typography sx={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: failed ? tone.bad : stale ? tone.warn : done ? tone.good : tone.muted,
                        }}>
                          {failed ? 'Failed' : stale ? 'Needs rerun' : done ? 'Completed' : blocked ? 'Blocked' : running ? 'In progress' : 'Pending'}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              </Paper>

              {/* Scheduler */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: tone.border, bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 1.5 }}>
                  Scheduler (Automated Triggers)
                </Typography>
                <Stack spacing={1.5}>
                  <FormControlLabel
                    control={(
                      <Switch
                        size="small"
                        checked={scheduleDraft.enabled}
                        onChange={(e) => setScheduleDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                      />
                    )}
                    label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Enable schedule</Typography>}
                  />

                  <Stack direction="row" spacing={1.5}>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel>Frequency</InputLabel>
                      <Select
                        value={scheduleDraft.frequency}
                        label="Frequency"
                        onChange={(e) => setScheduleDraft((prev) => ({ ...prev, frequency: String(e.target.value) }))}
                        sx={{ borderRadius: '6px' }}
                      >
                        <MenuItem value="daily">Daily</MenuItem>
                        <MenuItem value="weekly">Weekly</MenuItem>
                        <MenuItem value="cron">Cron</MenuItem>
                      </Select>
                    </FormControl>

                    {scheduleDraft.frequency !== 'cron' && (
                      <TextField
                        size="small"
                        type="time"
                        label="Time"
                        value={scheduleDraft.time}
                        onChange={(e) => setScheduleDraft((prev) => ({ ...prev, time: e.target.value }))}
                        InputLabelProps={{ shrink: true }}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
                      />
                    )}

                    {scheduleDraft.frequency === 'weekly' && (
                      <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Day</InputLabel>
                        <Select
                          value={scheduleDraft.day}
                          label="Day"
                          onChange={(e) => setScheduleDraft((prev) => ({ ...prev, day: String(e.target.value) }))}
                          sx={{ borderRadius: '6px' }}
                        >
                          <MenuItem value="monday">Monday</MenuItem>
                          <MenuItem value="tuesday">Tuesday</MenuItem>
                          <MenuItem value="wednesday">Wednesday</MenuItem>
                          <MenuItem value="thursday">Thursday</MenuItem>
                          <MenuItem value="friday">Friday</MenuItem>
                          <MenuItem value="saturday">Saturday</MenuItem>
                          <MenuItem value="sunday">Sunday</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  </Stack>

                  {scheduleDraft.frequency === 'cron' && (
                    <TextField
                      size="small"
                      label="Cron expression"
                      value={scheduleDraft.cron}
                      onChange={(e) => setScheduleDraft((prev) => ({ ...prev, cron: e.target.value }))}
                      placeholder="0 9 * * 1-5"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
                    />
                  )}

                  <FormControlLabel
                    control={(
                      <Switch
                        size="small"
                        checked={scheduleDraft.trigger_on_upload}
                        onChange={(e) => setScheduleDraft((prev) => ({ ...prev, trigger_on_upload: e.target.checked }))}
                      />
                    )}
                    label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Trigger when new data is uploaded</Typography>}
                  />

                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Save sx={{ fontSize: 14 }} />}
                    onClick={saveSchedule}
                    disabled={!selected || savingSchedule}
                    sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: '6px', fontWeight: 500, borderColor: tone.border, color: tone.text }}
                  >
                    {savingSchedule ? 'Saving...' : 'Save Scheduler'}
                  </Button>
                </Stack>
              </Paper>
            </Stack>
          </Collapse>

          {runState && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: tone.border, bgcolor: '#ffffff', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 0.6 }}>
                Last Run Status
              </Typography>
              <Typography sx={{ fontSize: 12, color: tone.muted }}>
                Run ID: {runState.run_id || '-'} · Status: {String(runState.status || '-').toUpperCase()}
              </Typography>
              {runState.error && (
                <Alert severity="error" sx={{ mt: 1, borderRadius: '6px' }}>
                  {runState.error}
                </Alert>
              )}
              {Array.isArray(runState.log) && runState.log.length > 0 && (
                <Box sx={{ mt: 1, maxHeight: 200, overflowY: 'auto', p: 1.5, bgcolor: '#0f172a', borderRadius: '6px' }}>
                  {runState.log.slice(-12).map((line, idx) => (
                    <Typography key={`${idx}_${line}`} sx={{ fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1' }}>
                      {line}
                    </Typography>
                  ))}
                </Box>
              )}
            </Paper>
          )}

          {message && <Alert severity="success" sx={{ borderRadius: '6px' }}>{message}</Alert>}
          {error && <Alert severity="error" sx={{ borderRadius: '6px' }}>{error}</Alert>}
        </Box>
      </Box>
      <Dialog
        open={renameDialog.open}
        onClose={closeRenameDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Rename Run</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Run name"
            value={renameDialog.value}
            onChange={(event) => setRenameDialog((prev) => ({ ...prev, value: event.target.value, error: '' }))}
            error={Boolean(renameDialog.error)}
            helperText={renameDialog.error || ' '}
            disabled={renameDialog.saving}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRenameDialog} disabled={renameDialog.saving} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button onClick={handleRenamePipeline} disabled={renameDialog.saving} variant="contained" sx={{ textTransform: 'none' }}>
            {renameDialog.saving ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: 2.5,
            border: `1px solid ${tone.border}`,
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.18)',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${tone.border}` }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              sx={{
                width: 38,
                height: 38,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: tone.badBg,
                color: tone.bad,
              }}
            >
              <DeleteForever sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: tone.text }}>
                Delete Run
              </Typography>
              <Typography sx={{ mt: 0.35, fontSize: 11.5, color: tone.muted }}>
                This action cannot be undone.
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2.5, py: 2.25 }}>
          <Typography sx={{ fontSize: 13, color: tone.text, lineHeight: 1.65 }}>
            Delete <strong>"{selected?.name || 'this run'}"</strong> and its generated artefacts?
          </Typography>
          <Typography sx={{ mt: 1.15, fontSize: 11.5, color: tone.muted, lineHeight: 1.65 }}>
            {selected?.pipeline_id != null
              ? 'This removes the saved pipeline, linked workflow session records, and any generated artefacts tracked against it.'
              : 'This removes the tracked workflow session draft for this run from the shared pipeline hub.'}
          </Typography>
          {selected?.pipeline_id != null ? (
            <Stack spacing={1.2} sx={{ mt: 1.75 }}>
              {deleteImpactLoading ? (
                <Alert severity="info" sx={{ borderRadius: 1.75 }}>
                  Checking whether this run was published or imported into Sentinel.
                </Alert>
              ) : null}
              {deleteImpactError ? (
                <Alert severity="warning" sx={{ borderRadius: 1.75 }}>
                  {deleteImpactError}
                </Alert>
              ) : null}
              {!deleteImpactLoading && !deleteImpactError && deleteImpact ? (
                <>
                  {deleteImpact.state === 'not_published' ? (
                    <Alert severity="info" sx={{ borderRadius: 1.75 }}>
                      This run was not published to Sentinel. Deleting it only removes workbench-side data.
                    </Alert>
                  ) : null}
                  {deleteImpact.state === 'published_only' ? (
                    <Alert severity="info" sx={{ borderRadius: 1.75 }}>
                      This run was published, but no Sentinel environment has imported it yet.
                    </Alert>
                  ) : null}
                  {deleteImpact.state === 'imported_no_activity' ? (
                    <Alert severity="warning" sx={{ borderRadius: 1.75 }}>
                      This run was imported into Sentinel, but no analyst activity was found. You can keep Sentinel for traceability or remove the untouched intake.
                    </Alert>
                  ) : null}
                  {deleteImpact.state === 'imported_with_activity' ? (
                    <Alert severity="error" sx={{ borderRadius: 1.75 }}>
                      This run already has downstream Sentinel activity. The workbench run can be deleted, but Sentinel cases and audit history must be kept.
                    </Alert>
                  ) : null}
                  <Box
                    sx={{
                      border: `1px solid ${tone.border}`,
                      borderRadius: 1.75,
                      p: 1.5,
                      bgcolor: '#fff',
                    }}
                  >
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`${Number(deleteImpact?.published_package_count || 0)} published package(s)`} />
                      <Chip size="small" label={`${Number(deleteImpact?.linked_import_count || 0)} Sentinel import(s)`} />
                      <Chip size="small" label={`${Number(deleteImpact?.linked_target_env_count || 0)} target env(s)`} />
                    </Stack>
                    {Array.isArray(deleteImpact?.linked_imports) && deleteImpact.linked_imports.length > 0 ? (
                      <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                        {deleteImpact.linked_imports.slice(0, 3).map((item) => (
                          <Box key={`${item.publish_id}-${item.target_env_id}`} sx={{ fontSize: 11.5, color: tone.muted }}>
                            <strong style={{ color: tone.text }}>{item.target_env_id || 'Sentinel env'}</strong>
                            {` · ${Number(item.imported_case_count || 0)} case(s) · ${Number(item.imported_alert_count || 0)} alert(s)`}
                            {item?.analyst_activity?.has_activity ? ' · analyst activity detected' : ' · no analyst activity'}
                          </Box>
                        ))}
                        {deleteImpact.linked_imports.length > 3 ? (
                          <Typography sx={{ fontSize: 11.5, color: tone.muted }}>
                            +{deleteImpact.linked_imports.length - 3} more linked import(s)
                          </Typography>
                        ) : null}
                      </Stack>
                    ) : null}
                  </Box>
                  {Number(deleteImpact?.linked_import_count || 0) > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel id="fcc-delete-sentinel-action-label">Sentinel handling</InputLabel>
                      <Select
                        labelId="fcc-delete-sentinel-action-label"
                        value={deleteSentinelAction}
                        label="Sentinel handling"
                        onChange={(event) => setDeleteSentinelAction(String(event.target.value || 'keep'))}
                      >
                        <MenuItem value="keep">
                          Delete workbench run only and keep Sentinel history
                        </MenuItem>
                        <MenuItem
                          value="purge_imported_queue"
                          disabled={!Boolean(deleteImpact?.sentinel_purge_allowed)}
                        >
                          Delete workbench run and remove untouched Sentinel intake
                        </MenuItem>
                      </Select>
                    </FormControl>
                  ) : null}
                </>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.75, borderTop: `1px solid ${tone.border}` }}>
          <Button
            onClick={closeDeleteDialog}
            disabled={deletingPipeline}
            variant="outlined"
            sx={{ textTransform: 'none', borderRadius: 1.5 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeletePipeline}
            disabled={deletingPipeline || deleteImpactLoading}
            variant="contained"
            sx={{
              textTransform: 'none',
              borderRadius: 1.5,
              bgcolor: tone.bad,
              '&:hover': { bgcolor: '#b42318' },
            }}
          >
            {deletingPipeline ? 'Deleting...' : 'Delete Run'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkbenchPipelinesScreen;

