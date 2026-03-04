import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  DeleteForever,
  DragIndicator,
  PlayArrow,
  Refresh,
  Restore,
  Save,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import {
  derivePipelineStepCompletion,
  getScreenState,
  upsertScreenState,
} from '../utils/pipelineState';

const tone = {
  border: '#e2e8f0',
  bg: '#f8fafc',
  text: '#1e293b',
  muted: '#64748b',
  orange: '#D04A02',
  orangeSoft: '#fff1ec',
  good: '#15803d',
  goodBg: '#f0fdf4',
  warn: '#b45309',
  warnBg: '#fffbeb',
  bad: '#b91c1c',
  badBg: '#fef2f2',
};

const stageCatalog = {
  data: { key: 'data', label: 'Data Upload', stepId: 'data' },
  master: { key: 'master', label: 'Master Dataset', stepId: 'master' },
  target: { key: 'target', label: 'Target Variable', stepId: 'target' },
  preprocess: { key: 'preprocess', label: 'Preprocessing', stepId: 'preprocess' },
  model: { key: 'model', label: 'Model Training', stepId: 'model' },
  validation: { key: 'validation', label: 'Validation', stepId: 'validation' },
  registry: { key: 'registry', label: 'Registry', stepId: 'registry' },
};

const defaultStageOrder = Object.keys(stageCatalog);

const pick = (res) => res?.data ?? res;

const statusTone = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'complete' || key === 'completed' || key === 'done') return { color: tone.good, bg: tone.goodBg, label: 'Complete' };
  if (key === 'failed' || key === 'error') return { color: tone.bad, bg: tone.badBg, label: 'Failed' };
  if (key === 'running') return { color: '#1d4ed8', bg: '#eff6ff', label: 'Running' };
  return { color: tone.warn, bg: tone.warnBg, label: 'In Progress' };
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

const WorkbenchPipelinesScreen = ({
  persona = 'technical',
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
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

  const selected = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => String(p.pipeline_id) === String(selectedPipelineId)) || null;
  }, [pipelines, selectedPipelineId]);

  const effectivePipeline = fullPipeline || selected;
  const completion = useMemo(() => derivePipelineStepCompletion(effectivePipeline || {}), [effectivePipeline]);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await mlopsApi.pipelineList();
      const rows = Array.isArray(pick(res)) ? pick(res) : [];
      setPipelines(rows);
      if (!selectedPipelineId) {
        const preferred = activePipelineId
          ? rows.find((p) => Number(p.pipeline_id) === Number(activePipelineId))
          : rows[0];
        if (preferred?.pipeline_id != null) setSelectedPipelineId(String(preferred.pipeline_id));
      }
    } catch (e) {
      setError(e?.message || 'Failed to load pipelines');
      setPipelines([]);
    } finally {
      setLoading(false);
    }
  }, [activePipelineId, selectedPipelineId]);

  const loadPipelineDetail = useCallback(async (pipelineId) => {
    if (!pipelineId) {
      setFullPipeline(null);
      return;
    }
    setLoadingDetail(true);
    setError('');
    try {
      const res = await mlopsApi.pipelineGet(pipelineId);
      const full = pick(res);
      setFullPipeline(full || null);
      setScheduleDraft(normalizeSchedule(full?.schedule));

      const hubState = getScreenState(full?.steps, 'pipeline_hub') || {};
      const rawOrder = Array.isArray(hubState.stage_order) ? hubState.stage_order : defaultStageOrder;
      const ordered = [
        ...rawOrder.filter((key) => stageCatalog[key]),
        ...defaultStageOrder.filter((key) => !rawOrder.includes(key)),
      ];
      setStageOrder(ordered);
      setOrderDirty(false);
    } catch (e) {
      setError(e?.message || 'Failed to load pipeline details');
      setFullPipeline(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (activePipelineId != null && activePipelineId !== '') {
      setSelectedPipelineId(String(activePipelineId));
    }
  }, [activePipelineId]);

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
    const preprocessState = getScreenState(effectivePipeline?.steps, 'preprocess') || {};
    const pipelineStatus = String(effectivePipeline?.status || '').toLowerCase();
    const pipelineComplete = ['complete', 'completed', 'done'].includes(pipelineStatus);
    const pipelineHasRun = Boolean(effectivePipeline?.last_run_at || effectivePipeline?.output_dataset_id);
    const runSource = pipelineComplete ? 'Pipeline complete' : pipelineHasRun ? 'Last run available' : 'Model not trained';
    const validationSource = pipelineComplete ? 'Validation completed' : 'Validation pending';
    const registrySource = pipelineComplete ? 'Registry completed' : 'Registry pending';

    return {
      data: {
        summary: `${Number(dataState.total_tables || effectivePipeline?.dataset_ids?.length || 0)} tables · ${Number(dataState.total_rows || 0).toLocaleString()} rows`,
        done: completion.data,
      },
      master: {
        summary: `Anchor: ${masterState.anchorType || '-'} · Joins: ${Array.isArray(masterState.joins) ? masterState.joins.length : 0}`,
        done: completion.master,
      },
      target: {
        summary: `Target: ${targetState.currentTargetColumn || targetState.selectedTargetColumn || '-'}`,
        done: completion.target,
      },
      preprocess: {
        summary: `${Array.isArray(preprocessState.steps) ? preprocessState.steps.length : 0} transform steps`,
        done: completion.preprocess,
      },
      model: {
        summary: artefacts?.modelRun
          ? `AUC ${(artefacts.modelRun?.metrics?.roc_auc ?? artefacts.modelRun?.auc ?? 0).toFixed(3)}`
          : runSource,
        done: Boolean(artefacts?.modelRun) || pipelineComplete || pipelineHasRun,
      },
      validation: {
        summary: artefacts?.validationReport
          ? `Threshold ${Number(artefacts.validationReport?.optimal_threshold ?? 0.5).toFixed(2)}`
          : validationSource,
        done: Boolean(artefacts?.validationReport) || pipelineComplete,
      },
      registry: {
        summary: artefacts?.registryEntry
          ? `Stage ${(artefacts.registryEntry?.stage || 'candidate').toUpperCase()}`
          : registrySource,
        done: Boolean(artefacts?.registryEntry) || pipelineComplete,
      },
    };
  }, [effectivePipeline, completion, artefacts]);

  const firstIncompleteStage = useMemo(() => {
    return stageOrder.find((key) => !stageDetails[key]?.done) || null;
  }, [stageOrder, stageDetails]);

  const handleSelect = useCallback((pipeline) => {
    if (!pipeline?.pipeline_id) return;
    setSelectedPipelineId(String(pipeline.pipeline_id));
    onPipelineActivated?.({ pipeline_id: Number(pipeline.pipeline_id), name: String(pipeline.name || '') });
  }, [onPipelineActivated]);

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
      await loadPipelineDetail(fullPipeline.pipeline_id);
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

  const handleResume = useCallback(async () => {
    if (!selected?.pipeline_id) return;
    try {
      const res = await mlopsApi.pipelineGet(selected.pipeline_id);
      onResumePipeline?.(pick(res));
    } catch (e) {
      setError(e?.message || 'Failed to load selected pipeline');
    }
  }, [selected, onResumePipeline]);

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

  const handleDeletePipeline = useCallback(async () => {
    if (!selected?.pipeline_id) return;
    const name = String(selected?.name || `Pipeline ${selected.pipeline_id}`);
    const ok = window.confirm(
      `Delete "${name}" and its generated artefacts? This cannot be undone.`,
    );
    if (!ok) return;

    setDeletingPipeline(true);
    setError('');
    setMessage('');
    try {
      const res = await mlopsApi.pipelineDelete(selected.pipeline_id, {
        delete_artifacts: true,
        delete_files: true,
      });
      const payload = pick(res) || {};
      const deletedArtifacts = Number(payload?.deleted_artifacts_count || 0);
      setMessage(`Deleted "${name}"${deletedArtifacts ? ` · ${deletedArtifacts} artefact(s) removed` : ''}`);
      if (String(activePipelineId || '') === String(selected.pipeline_id)) {
        onPipelineActivated?.({ pipeline_id: null, name: '' });
      }
      setSelectedPipelineId('');
      setFullPipeline(null);
      setRunState(null);
      await loadPipelines();
    } catch (e) {
      setError(e?.message || 'Failed to delete pipeline');
    } finally {
      setDeletingPipeline(false);
    }
  }, [selected, activePipelineId, onPipelineActivated, loadPipelines]);

  const saveSchedule = useCallback(async () => {
    if (!selected?.pipeline_id) return;
    setSavingSchedule(true);
    setError('');
    try {
      await mlopsApi.pipelineSchedule(selected.pipeline_id, scheduleDraft);
      await loadPipelineDetail(selected.pipeline_id);
      await loadPipelines();
    } catch (e) {
      setError(e?.message || 'Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  }, [loadPipelineDetail, loadPipelines, scheduleDraft, selected]);

  const currentStatus = statusTone(selected?.status);

  return (
    <Box sx={{ display: 'flex', gap: 2, height: '100%', minHeight: 0 }}>
      <Paper
        variant="outlined"
        sx={{
          width: 320,
          minWidth: 320,
          borderColor: tone.border,
          borderRadius: 2,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ px: 1.75, py: 1.4, borderBottom: `1px solid ${tone.border}`, bgcolor: tone.bg }}>
          <Stack direction="row" spacing={0.8} alignItems="center">
            <AccountTree sx={{ fontSize: 16, color: tone.orange }} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text }}>
              Saved Pipelines
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 11, color: tone.muted, mt: 0.4 }}>
            Select a pipeline to inspect DAG, finish edits, and re-run.
          </Typography>
        </Box>

        <Stack spacing={1} sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              startIcon={<Add sx={{ fontSize: 14 }} />}
              onClick={onCreateNewPipeline}
              sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' } }}
            >
              New Pipeline
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh sx={{ fontSize: 14 }} />}
              onClick={loadPipelines}
              disabled={loading}
              sx={{ textTransform: 'none' }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1.5 }}>
          {pipelines.length === 0 ? (
            <Alert severity="info" sx={{ py: 0.5 }}>
              No pipelines saved yet. Create one and start adding steps.
            </Alert>
          ) : (
            <Stack spacing={0.8}>
              {pipelines.map((pipeline) => {
                const isSelected = String(pipeline.pipeline_id) === String(selectedPipelineId);
                const st = statusTone(pipeline.status);
                const c = derivePipelineStepCompletion(pipeline || {});
                const doneCount = ['data', 'master', 'target', 'preprocess'].filter((k) => c[k]).length;
                return (
                  <Box
                    key={pipeline.pipeline_id}
                    onClick={() => handleSelect(pipeline)}
                    sx={{
                      p: 1.1,
                      borderRadius: 1.5,
                      border: `1px solid ${isSelected ? tone.orange : tone.border}`,
                      bgcolor: isSelected ? tone.orangeSoft : 'white',
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
                        sx={{ fontSize: 10, bgcolor: st.bg, color: st.color, fontWeight: 700 }}
                      />
                    </Stack>
                    <Typography sx={{ mt: 0.35, fontSize: 10.5, color: tone.muted }}>
                      v{pipeline.version || 1} · {doneCount}/4 core steps saved
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>
      </Paper>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: tone.border }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: tone.text }}>
                {selected?.name || activePipelineName || 'No pipeline selected'}
              </Typography>
              <Typography sx={{ mt: 0.45, fontSize: 12, color: tone.muted }}>
                {persona === 'business'
                  ? 'Review progress, finish incomplete steps, and re-run.'
                  : 'Inspect saved step artefacts, stage order, and scheduler.'}
              </Typography>
            </Box>
            {selected && (
              <Chip
                size="small"
                label={currentStatus.label}
                sx={{ fontSize: 11, fontWeight: 700, bgcolor: currentStatus.bg, color: currentStatus.color }}
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
              sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' } }}
            >
              Edit Pipeline
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleFinishPipeline}
              disabled={!selected}
              sx={{ textTransform: 'none' }}
            >
              {firstIncompleteStage ? 'Finish Incomplete' : 'Run / Schedule'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrow sx={{ fontSize: 14 }} />}
              onClick={handleRun}
              disabled={!selected || running}
              sx={{ textTransform: 'none' }}
            >
              {running ? 'Running...' : 'Re-Run DAG'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DeleteForever sx={{ fontSize: 14 }} />}
              onClick={handleDeletePipeline}
              disabled={!selected || deletingPipeline || running}
              sx={{
                textTransform: 'none',
                color: '#b91c1c',
                borderColor: '#fecaca',
                '&:hover': { borderColor: '#f87171', bgcolor: '#fef2f2' },
              }}
            >
              {deletingPipeline ? 'Deleting...' : 'Delete Pipeline'}
            </Button>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: tone.border }}>
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
              <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minWidth: 1120 }}>
                {stageOrder.map((key, idx) => {
                  const stage = stageCatalog[key];
                  if (!stage) return null;
                  const done = Boolean(stageDetails[key]?.done);
                  return (
                    <React.Fragment key={key}>
                      <Paper
                        variant="outlined"
                        sx={{
                          width: 220,
                          p: 1.2,
                          borderRadius: 1.8,
                          borderColor: done ? '#86efac' : tone.border,
                          bgcolor: done ? tone.goodBg : '#ffffff',
                          flexShrink: 0,
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.4 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: tone.text }}>
                            {stage.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={done ? 'Done' : 'Pending'}
                            sx={{
                              height: 16,
                              fontSize: 9,
                              fontWeight: 700,
                              bgcolor: done ? '#dcfce7' : '#f8fafc',
                              color: done ? '#166534' : '#475569',
                            }}
                          />
                        </Stack>
                        <Typography sx={{ fontSize: 10.5, color: tone.muted, minHeight: 32 }}>
                          {stageDetails[key]?.summary || 'No saved details yet'}
                        </Typography>
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
                        <Typography sx={{ color: '#94a3b8', fontSize: 16, fontWeight: 700 }}>-&gt;</Typography>
                      )}
                    </React.Fragment>
                  );
                })}
              </Stack>
            </Box>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: tone.border }}>
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
              sx={{ textTransform: 'none' }}
            >
              {savingOrder ? 'Saving...' : 'Save Order'}
            </Button>
          </Stack>
          <Stack spacing={0.6}>
            {stageOrder.map((key) => {
              const stage = stageCatalog[key];
              if (!stage) return null;
              const done = Boolean(stageDetails[key]?.done);
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
                    borderRadius: 1.25,
                    border: `1px solid ${dragStageKey === key ? tone.orange : tone.border}`,
                    bgcolor: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: 'grab',
                  }}
                >
                    <DragIndicator sx={{ fontSize: 16, color: '#94a3b8' }} />
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: tone.text, flex: 1 }}>
                    {stage.label}
                  </Typography>
                  <Chip
                    size="small"
                    label={done ? 'Completed' : 'Pending'}
                    sx={{
                      height: 18,
                      fontSize: 9.5,
                      fontWeight: 700,
                      bgcolor: done ? tone.goodBg : '#f8fafc',
                      color: done ? tone.good : '#64748b',
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: tone.border }}>
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
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              {savingSchedule ? 'Saving...' : 'Save Scheduler'}
            </Button>
          </Stack>
        </Paper>

        {runState && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: tone.border }}>
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
              <Box sx={{ mt: 1, maxHeight: 200, overflowY: 'auto', p: 1.2, bgcolor: '#0f172a', borderRadius: 1.5 }}>
                {runState.log.slice(-12).map((line, idx) => (
                  <Typography key={`${idx}_${line}`} sx={{ fontFamily: 'monospace', fontSize: 10.5, color: '#cbd5e1' }}>
                    {line}
                  </Typography>
                ))}
              </Box>
            )}
          </Paper>
        )}

        {message && <Alert severity="success">{message}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    </Box>
  );
};

export default WorkbenchPipelinesScreen;

