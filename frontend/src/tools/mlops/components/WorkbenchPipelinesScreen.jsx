import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  ContentCopy,
  DeleteForever,
  DragIndicator,
  DriveFileRenameOutline,
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
  getScreenState,
  upsertScreenState,
} from '../utils/pipelineState';

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
  const current = String(row?.current_step || '').trim().toLowerCase();
  if (current) return workflowStepLabels[current] || row?.current_step_label || current.replace(/_/g, ' ');
  const idx = Math.max(0, Math.min(Number(row?.completed_steps || 0), historyStepOrder.length - 1));
  return workflowStepLabels[historyStepOrder[idx]] || '-';
};
const lastCompletedStepLabel = (row) => {
  if (isComplete(row)) return row?.current_step_label || workflowStepLabels[String(row?.current_step || '').trim().toLowerCase()] || 'Reports';
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
  const [renameDialog, setRenameDialog] = useState({ open: false, value: '', saving: false, error: '' });
  const [searchText, setSearchText] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');

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
  const workflowState = effectivePipeline?.workflow_session?.current_state?.mlops_state || {};
  const staleStepSet = useMemo(
    () => new Set((effectivePipeline?.stale_steps || []).map((step) => String(step))),
    [effectivePipeline],
  );
  const completion = useMemo(() => derivePipelineStepCompletion(effectivePipeline || {}), [effectivePipeline]);
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
      return matchesSearch(row, searchText);
    });
  }, [persona, pipelines, scopeFilter, searchText, statusFilter]);
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
      const firstOpenable = rows[0] || null;
      const preferred = activePipelineId
        ? rows.find((p) => Number(p.pipeline_id) === Number(activePipelineId))
        : rows.find((p) => runKey(p) === String(selectedPipelineId))
          || rows.find((p) => String(p?.name || '').trim().toLowerCase() === String(activePipelineName || '').trim().toLowerCase())
          || firstOpenable;
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
    const firstOpenable = pipelines[0] || null;
    setSelectedPipelineId((prev) => {
      if (prev && pipelines.some((pipeline) => runKey(pipeline) === String(prev))) return prev;
      return firstOpenable ? runKey(firstOpenable) : '';
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
        summary: artefacts?.modelRun || workflowState?.active_model_run
          ? `AUC ${Number(artefacts?.modelRun?.metrics?.roc_auc ?? artefacts?.modelRun?.auc ?? workflowState?.active_model_run?.metrics?.roc_auc ?? workflowState?.active_model_run?.auc ?? 0).toFixed(3)}`
          : runSource,
        done: Boolean(artefacts?.modelRun || workflowState?.active_model_run?.job_id) || pipelineComplete || pipelineHasRun,
      },
      validation: {
        summary: artefacts?.validationReport || workflowState?.validation_report
          ? `Threshold ${Number(artefacts?.validationReport?.optimal_threshold ?? workflowState?.validation_report?.optimal_threshold ?? 0.5).toFixed(2)}`
          : validationSource,
        done: Boolean(artefacts?.validationReport || workflowState?.validation_report) || pipelineComplete,
      },
      registry: {
        summary: artefacts?.registryEntry || workflowState?.registry_entry
          ? `Stage ${String(artefacts?.registryEntry?.stage || workflowState?.registry_entry?.stage || 'candidate').toUpperCase()}`
          : registrySource,
        done: Boolean(artefacts?.registryEntry || workflowState?.registry_entry) || pipelineComplete,
      },
    };
  }, [effectivePipeline, completion, artefacts, workflowState]);

  const stageVisualStates = useMemo(() => {
    const next = {};
    stageOrder.forEach((key) => {
      const stepId = String(stageCatalog[key]?.stepId || key);
      if (staleStepSet.has(stepId)) next[key] = 'stale';
      else if (stageDetails[key]?.done) next[key] = 'done';
      else next[key] = 'pending';
    });
    return next;
  }, [stageDetails, stageOrder, staleStepSet]);

  const latestChange = effectivePipeline?.latest_change || null;
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
      name: String(src.name || ''),
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

  const openDeleteDialog = useCallback(() => {
    if (!selected?.pipeline_id && !selected?.workflow_session_id) return;
    setDeleteDialogOpen(true);
  }, [selected]);

  const closeDeleteDialog = useCallback(() => {
    if (deletingPipeline) return;
    setDeleteDialogOpen(false);
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
        });
        const payload = pick(res) || {};
        const deletedArtifacts = Number(payload?.deleted_artifacts_count || 0);
        const deletedSessions = Number(payload?.deleted_workflow_sessions_count || 0);
        setMessage(
          `Deleted "${name}"`
          + `${deletedArtifacts ? ` · ${deletedArtifacts} artefact(s) removed` : ''}`
          + `${deletedSessions ? ` · ${deletedSessions} workflow session(s) cleared` : ''}`,
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
        remainingRuns: Array.isArray(remainingRows) ? remainingRows : [],
      }));
      setSelectedPipelineId('');
      setFullPipeline(null);
      setRunState(null);
    } catch (e) {
      setError(e?.message || 'Failed to delete pipeline');
    } finally {
      setDeletingPipeline(false);
    }
  }, [loadPipelines, onPipelineDeleted, selected]);

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

  const currentStatus = statusTone(effectivePipeline?.run_status || effectivePipeline?.status || selected?.run_status || selected?.status);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      <Paper variant="outlined" sx={{ borderColor: tone.border, borderRadius: 0, overflow: 'hidden' }}>
        <Box sx={{ px: 1.75, py: 1.4, borderBottom: `1px solid ${tone.border}`, bgcolor: tone.bg }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.2} flexWrap="wrap">
            <Box>
              <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
                <AccountTree sx={{ fontSize: 16, color: tone.orange }} />
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text }}>
                  Pipeline History & Resume
                </Typography>
                <Chip
                  size="small"
                  label={activeEnvironmentName ? `Env ${activeEnvironmentName}` : 'Env not set'}
                  sx={{
                    height: 20,
                    fontSize: 10,
                    bgcolor: '#ffffff',
                    color: tone.muted,
                    border: `1px solid ${tone.border}`,
                    borderRadius: 0,
                  }}
                />
                <Chip
                  size="small"
                  label={`${pipelines.length} tracked run${pipelines.length === 1 ? '' : 's'}`}
                  sx={{
                    height: 20,
                    fontSize: 10,
                    bgcolor: '#ffffff',
                    color: tone.muted,
                    border: `1px solid ${tone.border}`,
                    borderRadius: 0,
                  }}
                />
              </Stack>
              <Typography sx={{ fontSize: 11, color: tone.muted, mt: 0.45 }}>
                Create, track, resume, and manage FCC pipeline runs without losing step progress after restart.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                startIcon={<Add sx={{ fontSize: 14 }} />}
                onClick={onCreateNewPipeline}
                sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' }, borderRadius: 0 }}
              >
                New Run
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Refresh sx={{ fontSize: 14 }} />}
                onClick={loadPipelines}
                disabled={loading}
                sx={{ textTransform: 'none', borderRadius: 0 }}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ p: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1, mb: 1.5 }}>
            {summaryCards.map((card) => (
              <Box key={card.key} sx={{ border: `1px solid ${tone.border}`, bgcolor: '#ffffff', px: 1.25, py: 1.15 }}>
                <Typography sx={{ fontSize: 10.5, color: tone.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                  {card.label}
                </Typography>
                <Typography sx={{ fontSize: 24, fontWeight: 800, color: tone.text, mt: 0.3 }}>
                  {card.value}
                </Typography>
              </Box>
            ))}
          </Box>
          {selectionNotice && (
            <Alert severity="warning" sx={{ mb: 1.2, py: 0.5, borderRadius: 0 }}>
              {selectionNotice}
            </Alert>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.9fr 0.9fr' }, gap: 1, mb: 1.5 }}>
            <TextField
              size="small"
              label="Search runs"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by pipeline, run ID, owner, or step"
            />
            <FormControl size="small">
              <InputLabel>Scope</InputLabel>
              <Select value={scopeFilter} label="Scope" onChange={(e) => setScopeFilter(String(e.target.value))}>
                <MenuItem value="all">All runs</MenuItem>
                <MenuItem value="mine">My runs</MenuItem>
                <MenuItem value="team">Team runs</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(String(e.target.value))}>
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
            <Alert severity="info" sx={{ py: 0.5 }}>
              {activeEnvironmentName
                ? `No saved FCC runs were found in environment "${activeEnvironmentName}".`
                : 'No saved FCC runs were found for the current environment.'}
            </Alert>
          ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
                <thead>
                  <tr style={{ background: '#faf7f4' }}>
                    {['Pipeline Name', 'Run ID', 'Created By', 'Owner', 'Created On', 'Last Updated', 'Current Step', 'Progress %', 'Status', 'Last Completed Step', 'Next Pending Step', 'Environment', 'Actions'].map((label) => (
                      <th
                        key={label}
                        style={{
                          padding: '10px 12px',
                          textAlign: 'left',
                          fontSize: 10.5,
                          letterSpacing: 0.5,
                          textTransform: 'uppercase',
                          color: '#6b7280',
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
                        }}
                      >
                        <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>{pipeline.name}</div>
                          <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3 }}>{pipeline.pipeline_id != null ? `Pipeline ${pipeline.pipeline_id}` : 'Draft workflow session'}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{pipeline.run_ref || pipeline.run_id || '-'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{pipeline.created_by_label || pipeline.created_by_persona || '-'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{ownerLabel(pipeline)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{formatDateTime(pipeline.created_at)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{formatDateTime(pipeline.last_active_at || pipeline.updated_at)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827' }}>{pipeline.workspace_step_label || pipeline.current_step_label || '-'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{progressNumber(pipeline)}%</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              border: `1px solid ${st.color}`,
                              color: st.color,
                              fontSize: 10.5,
                              fontWeight: 700,
                              background: '#ffffff',
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827' }}>{lastCompletedStepLabel(pipeline)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827' }}>{nextPendingStepLabel(pipeline)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: '#111827', whiteSpace: 'nowrap' }}>{activeEnvironmentName || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <Stack direction="row" spacing={0.6}>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleViewPipeline(pipeline); }} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>View</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleResume(pipeline); }} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>Resume</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); openRenameDialog(pipeline); }} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>Rename</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleClonePipeline(pipeline); }} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>Clone</Button>
                            <Button size="small" variant="text" onClick={(e) => { e.stopPropagation(); handleArchivePipeline(pipeline); }} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>Archive</Button>
                          </Stack>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredPipelines.length && (
                    <tr>
                      <td colSpan={13} style={{ padding: '14px 12px', fontSize: 12, color: '#6b7280' }}>
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
        <Paper
          variant="outlined"
            sx={{
              width: { xs: '100%', xl: 320 },
              minWidth: { xs: 0, xl: 320 },
              borderColor: tone.border,
              borderRadius: 0,
              display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ px: 1.75, py: 1.4, borderBottom: `1px solid ${tone.border}`, bgcolor: tone.bg }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text }}>
              Run Details Drawer
            </Typography>
            <Typography sx={{ fontSize: 11, color: tone.muted, mt: 0.4 }}>
              Review the selected run metadata, last checkpoint, and resume point before reopening the pipeline.
            </Typography>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1.5 }}>
            {pipelines.length === 0 ? (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Select or create a run to view FCC pipeline details.
              </Alert>
            ) : (
              <Stack spacing={0.8}>
                {pipelines.map((pipeline) => {
                  if (!filteredPipelines.some((row) => runKey(row) === runKey(pipeline))) return null;
                  const isSelected = runKey(pipeline) === String(selectedPipelineId);
                  const st = statusTone(pipeline.run_status || pipeline.workflow_status || pipeline.status);
                  const staleCount = Array.isArray(pipeline.stale_steps) ? pipeline.stale_steps.length : 0;
                  return (
                    <Box
                      key={pipeline.manager_key || pipeline.pipeline_id || pipeline.workflow_session_id || pipeline.run_ref || pipeline.name}
                      onClick={() => handleSelect(pipeline)}
                      sx={{
                        p: 1.1,
                        borderRadius: 0,
                        border: `1px solid ${isSelected ? tone.orange : staleCount ? T.warningBorder : tone.border}`,
                        bgcolor: '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text }}>
                          {pipeline.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={st.label}
                          sx={{ fontSize: 10, bgcolor: st.bg, color: st.color, fontWeight: 700, border: `1px solid ${st.color}`, borderRadius: 0 }}
                        />
                      </Stack>
                      <Typography sx={{ mt: 0.35, fontSize: 10.5, color: tone.muted }}>
                        {pipeline.run_ref || `FCC-RUN-${pipeline.pipeline_id}`} - {pipeline.steps_completed_display || `${pipeline.completed_steps || 0}/${pipeline.total_steps || 0}`} steps
                      </Typography>
                      <Typography sx={{ mt: 0.15, fontSize: 10.5, color: tone.muted }}>
                        {pipeline.current_workspace || 'FCC'} - {pipeline.workspace_step_label || pipeline.current_step_label || 'Load Data'}
                      </Typography>
                      {staleCount > 0 && (
                        <Typography sx={{ mt: 0.45, fontSize: 10.25, color: tone.warn, fontWeight: 600 }}>
                          {staleCount} saved stage{staleCount === 1 ? '' : 's'} need rerun
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Paper>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, borderColor: tone.border }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: tone.text }}>
                {selected?.name || activePipelineName || 'No run selected'}
              </Typography>
              <Typography sx={{ mt: 0.45, fontSize: 12, color: tone.muted }}>
                {persona === 'business'
                  ? 'Review the outcome of this run, resume where it stopped, or finish pending stages.'
                  : 'Inspect saved step artefacts, exact run progress, stage order, and scheduler.'}
              </Typography>
              {selected && (
                <Typography sx={{ mt: 0.45, fontSize: 11, color: tone.muted }}>
                  {(selected.run_ref || `FCC-RUN-${selected.pipeline_id}`)}
                  {selected.current_step_label ? ` - ${selected.current_step_label}` : ''}
                  {selected.current_substep_label ? ` > ${selected.current_substep_label}` : ''}
                  {selected.completion_pct != null ? ` - ${selected.completion_pct}% complete` : ''}
                </Typography>
              )}
            </Box>
            {selected && (
              <Chip
                size="small"
                label={currentStatus.label}
                sx={{ fontSize: 11, fontWeight: 700, bgcolor: currentStatus.bg, color: currentStatus.color, border: `1px solid ${currentStatus.color}`, borderRadius: 0 }}
              />
            )}
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<Restore sx={{ fontSize: 14 }} />}
              onClick={handleResume}
              disabled={!selected}
              sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' }, borderRadius: 0 }}
            >
              Resume Run
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleFinishPipeline}
              disabled={!selected}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {firstIncompleteStage ? 'Finish Pending Stages' : 'Run / Schedule'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrow sx={{ fontSize: 14 }} />}
              onClick={handleRun}
              disabled={!selected || running}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {running ? 'Running...' : 'Re-Run DAG'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DriveFileRenameOutline sx={{ fontSize: 14 }} />}
              onClick={() => openRenameDialog()}
              disabled={!selected}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              Rename Run
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopy sx={{ fontSize: 14 }} />}
              onClick={() => handleClonePipeline()}
              disabled={!selected || cloningPipeline}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {cloningPipeline ? 'Cloning...' : 'Clone Run'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ArchiveOutlined sx={{ fontSize: 14 }} />}
              onClick={() => handleArchivePipeline()}
              disabled={!selected || archivingPipeline}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {archivingPipeline ? 'Archiving...' : 'Archive'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<VisibilityOutlined sx={{ fontSize: 14 }} />}
              onClick={() => handleViewPipeline()}
              disabled={!selected}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              Open Read Only
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
                borderColor: T.errorBorder,
                '&:hover': { borderColor: tone.bad, bgcolor: tone.badBg },
                borderRadius: 0,
              }}
            >
              {deletingPipeline ? 'Deleting...' : 'Delete Pipeline'}
            </Button>
          </Stack>
          {latestChange?.message && (
            <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 0 }}>
              <Typography sx={{ fontSize: 11.5, color: tone.text, fontWeight: 600 }}>
                Change impact
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: tone.text, mt: 0.4 }}>
              {latestChange.message}
              </Typography>
              {impactedStepLabels.length > 0 && (
                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  {impactedStepLabels.map((label) => (
                    <Chip
                      key={label}
                      size="small"
                      label={label}
                      sx={{ fontSize: 10, bgcolor: '#fff', color: tone.warn, fontWeight: 700, border: `1px solid ${tone.warn}`, borderRadius: 0 }}
                    />
                  ))}
                </Stack>
              )}
            </Alert>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, borderColor: tone.border }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 1 }}>
            Run Trace & Resume Context
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1, mb: 1.5 }}>
            {[
              ['Created by', selected ? ownerLabel(selected) : '-'],
              ['Last completed step', selected ? lastCompletedStepLabel(selected) : '-'],
              ['Next pending step', selected ? nextPendingStepLabel(selected) : '-'],
              ['Resume ready', selected ? (isArchived(selected) ? 'No - archived' : 'Yes') : '-'],
            ].map(([label, value]) => (
              <Box key={label} sx={{ border: `1px solid ${tone.border}`, bgcolor: '#ffffff', px: 1.1, py: 0.95 }}>
                <Typography sx={{ fontSize: 10.25, color: tone.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text, mt: 0.3 }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 1.1 }}>
            DAG View (Saved Steps)
          </Typography>
          {loadingDetail && (
            <Typography sx={{ fontSize: 11.5, color: tone.muted }}>
              Loading pipeline details...
            </Typography>
          )}
          {!loadingDetail && (
            <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
              <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minWidth: { xs: 860, lg: 1120 } }}>
                {stageOrder.map((key, idx) => {
                  const stage = stageCatalog[key];
                  if (!stage) return null;
                  const visualState = stageVisualStates[key] || 'pending';
                  const done = visualState === 'done';
                  const stale = visualState === 'stale';
                  return (
                    <React.Fragment key={key}>
                      <Paper
                        variant="outlined"
                          sx={{
                            width: { xs: 188, lg: 220 },
                            p: 1.2,
                            borderRadius: 0,
                          borderColor: stale ? T.warningBorder : done ? T.successBorder : tone.border,
                          bgcolor: '#ffffff',
                          flexShrink: 0,
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.4 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: tone.text }}>
                            {stage.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={stale ? 'Needs rerun' : done ? 'Done' : 'Pending'}
                            sx={{
                              height: 16,
                              fontSize: 9,
                              fontWeight: 700,
                              bgcolor: '#fff',
                              color: stale ? tone.warn : done ? tone.good : tone.muted,
                              border: `1px solid ${stale ? tone.warn : done ? tone.good : tone.border}`,
                              borderRadius: 0,
                            }}
                          />
                        </Stack>
                        <Typography sx={{ fontSize: 10.5, color: tone.muted, minHeight: 32 }}>
                          {stageDetails[key]?.summary || 'No saved details yet'}
                        </Typography>
                        {stale && (
                          <Typography sx={{ mt: 0.45, fontSize: 10.25, color: tone.warn, minHeight: 28 }}>
                            Outdated after an upstream change. Open this step and rerun it.
                          </Typography>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => onOpenStep?.(stage.stepId)}
                          sx={{ mt: 0.5, px: 0, minWidth: 0, textTransform: 'none', fontSize: 10.5 }}
                        >
                          Open Step
                        </Button>
                      </Paper>
                      {idx < stageOrder.length - 1 && (
                        <Typography sx={{ color: tone.muted, fontSize: 16, fontWeight: 700 }}>-&gt;</Typography>
                      )}
                    </React.Fragment>
                  );
                })}
              </Stack>
            </Box>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, borderColor: tone.border }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text }}>
              Run Order (Drag to Reorder)
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Save sx={{ fontSize: 14 }} />}
              onClick={saveStageOrder}
              disabled={!selected || !orderDirty || savingOrder}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {savingOrder ? 'Saving...' : 'Save Order'}
            </Button>
          </Stack>
          <Stack spacing={0.6}>
            {stageOrder.map((key) => {
              const stage = stageCatalog[key];
              if (!stage) return null;
              const visualState = stageVisualStates[key] || 'pending';
              const done = visualState === 'done';
              const stale = visualState === 'stale';
              return (
                <Box
                  key={`order_${key}`}
                  draggable
                  onDragStart={() => handleDragStart(key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(key)}
                  sx={{
                    px: 1.1,
                    py: 0.8,
                    borderRadius: 0,
                    border: `1px solid ${dragStageKey === key ? tone.orange : tone.border}`,
                    bgcolor: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: 'grab',
                  }}
                >
                    <DragIndicator sx={{ fontSize: 16, color: tone.muted }} />
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: tone.text, flex: 1 }}>
                    {stage.label}
                  </Typography>
                  <Chip
                    size="small"
                    label={stale ? 'Needs rerun' : done ? 'Completed' : 'Pending'}
                    sx={{
                      height: 18,
                      fontSize: 9.5,
                      fontWeight: 700,
                      bgcolor: '#ffffff',
                      color: stale ? tone.warn : done ? tone.good : tone.muted,
                      border: `1px solid ${stale ? tone.warn : done ? tone.good : tone.border}`,
                      borderRadius: 0,
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, borderColor: tone.border }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 1 }}>
            Scheduler (Airflow Style)
          </Typography>
          <Stack spacing={1.1}>
            <FormControlLabel
              control={(
                <Switch
                  size="small"
                  checked={scheduleDraft.enabled}
                  onChange={(e) => setScheduleDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
              )}
              label="Enable schedule"
            />

            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Frequency</InputLabel>
                <Select
                  value={scheduleDraft.frequency}
                  label="Frequency"
                  onChange={(e) => setScheduleDraft((prev) => ({ ...prev, frequency: String(e.target.value) }))}
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
                />
              )}

              {scheduleDraft.frequency === 'weekly' && (
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Day</InputLabel>
                  <Select
                    value={scheduleDraft.day}
                    label="Day"
                    onChange={(e) => setScheduleDraft((prev) => ({ ...prev, day: String(e.target.value) }))}
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
              label="Trigger when new data is uploaded"
            />

            <Button
              size="small"
              variant="outlined"
              startIcon={<Save sx={{ fontSize: 14 }} />}
              onClick={saveSchedule}
              disabled={!selected || savingSchedule}
              sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: 0 }}
            >
              {savingSchedule ? 'Saving...' : 'Save Scheduler'}
            </Button>
          </Stack>
        </Paper>

        {runState && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 0, borderColor: tone.border }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: tone.text, mb: 0.6 }}>
              Last Run Status
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: tone.muted }}>
              Run ID: {runState.run_id || '-'} · Status: {String(runState.status || '-').toUpperCase()}
            </Typography>
            {runState.error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {runState.error}
              </Alert>
            )}
            {Array.isArray(runState.log) && runState.log.length > 0 && (
              <Box sx={{ mt: 1, maxHeight: 200, overflowY: 'auto', p: 1.2, bgcolor: '#0f172a', borderRadius: 0 }}>
                {runState.log.slice(-12).map((line, idx) => (
                  <Typography key={`${idx}_${line}`} sx={{ fontFamily: 'monospace', fontSize: 10.5, color: '#cbd5e1' }}>
                    {line}
                  </Typography>
                ))}
              </Box>
            )}
          </Paper>
        )}

        {message && <Alert severity="success" sx={{ borderRadius: 0 }}>{message}</Alert>}
        {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}
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
        maxWidth="xs"
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
              : 'This removes the tracked workflow session draft for this run from the FCC run center.'}
          </Typography>
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
            disabled={deletingPipeline}
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

