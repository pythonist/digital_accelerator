import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Collapse,
  Button,
  Chip,
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
  AccountTree,
  ChevronLeft,
  ChevronRight,
  CompareArrows,
  Refresh,
  Save,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import {
  findPipelineByName,
  getScreenState,
  mergePipelinePayload,
} from '../utils/pipelineState';

const tone = {
  border: '#e2e8f0',
  bg: '#f8fafc',
  text: '#1f2937',
  muted: '#64748b',
  orange: '#D04A02',
  orangeSoft: '#fff1ec',
  good: '#166534',
  goodBg: '#f0fdf4',
  warn: '#b45309',
  warnBg: '#fffbeb',
};

const pick = (res) => res?.data ?? res;

const safeString = (v) => String(v || '').trim().toLowerCase();

const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
      }, {});
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(sortObject(value ?? {}));

const topLevelDiff = (left, right) => {
  const a = left && typeof left === 'object' ? left : {};
  const b = right && typeof right === 'object' ? right : {};
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  return keys.filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
};

const deriveMasterFallback = (pipeline) => {
  if (!pipeline || typeof pipeline !== 'object') return null;
  const hasMasterFields = Array.isArray(pipeline.joins) || Array.isArray(pipeline.transforms) || pipeline.grain;
  if (!hasMasterFields) return null;
  return {
    grain: pipeline.grain || 'alert',
    joins: Array.isArray(pipeline.joins) ? pipeline.joins : [],
    transforms: Array.isArray(pipeline.transforms) ? pipeline.transforms : [],
    strMode: pipeline.str_config?.policy || 'detect',
    replacementLabelColumn: pipeline.str_config?.replacement_label_column || '',
    outputName: pipeline.output_name || 'master_dataset',
  };
};

const getStateFromPipeline = (pipeline, screenKey) => {
  const fromSteps = getScreenState(pipeline?.steps, screenKey);
  if (fromSteps) return fromSteps;
  if (safeString(screenKey) === 'master') return deriveMasterFallback(pipeline);
  return null;
};

const ScreenPipelineRail = ({
  screenKey,
  screenLabel,
  persona = 'technical',
  datasetId = null,
  currentState = {},
  onLoadState,
  buildSavePayload,
  summaryItems = [],
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
  sticky = true,
}) => {
  const [name, setName] = useState(activePipelineName || `${screenLabel} Pipeline`);
  const [pipelines, setPipelines] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [comparePipelineId, setComparePipelineId] = useState('');
  const [compareDiffKeys, setCompareDiffKeys] = useState([]);
  const [baselineJson, setBaselineJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (activePipelineName) {
      setName(activePipelineName);
    }
  }, [activePipelineName]);

  useEffect(() => {
    if (activePipelineId != null && activePipelineId !== '') {
      setSelectedPipelineId(String(activePipelineId));
    }
  }, [activePipelineId]);

  const currentJson = useMemo(() => stableStringify(currentState), [currentState]);
  const unsavedChanges = Boolean(baselineJson) && baselineJson !== currentJson;

  const pipelineList = useMemo(() => {
    const key = safeString(screenKey);
    return pipelines.filter((p) => {
      const hasMarker = Boolean(getScreenState(p.steps, key));
      if (hasMarker) return true;
      return key === 'master';
    });
  }, [pipelines, screenKey]);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await mlopsApi.pipelineList(datasetId || undefined);
      const payload = pick(res);
      const rows = Array.isArray(payload) ? payload : [];
      setPipelines(rows);
    } catch (e) {
      setError(e?.message || 'Failed to load saved pipelines');
      setPipelines([]);
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (!comparePipelineId) {
      setCompareDiffKeys([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await mlopsApi.pipelineGet(comparePipelineId);
        const payload = pick(res);
        const compareState = getStateFromPipeline(payload, screenKey);
        if (!alive || !compareState) {
          if (alive) setCompareDiffKeys([]);
          return;
        }
        setCompareDiffKeys(topLevelDiff(currentState, compareState));
      } catch {
        if (alive) setCompareDiffKeys([]);
      }
    })();
    return () => { alive = false; };
  }, [comparePipelineId, currentState, screenKey]);

  const handleSave = useCallback(async () => {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      setError('Pipeline name is required');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = buildSavePayload
        ? buildSavePayload({
            name: trimmed,
            currentState,
            datasetId,
            persona,
            screenKey,
          })
        : {
            name: trimmed,
            dataset_id: Number(datasetId || 0),
            steps: [{ type: 'screen_state', screen: screenKey, state: currentState }],
            created_by_persona: persona,
          };

      let mergedPayload = { ...payload, name: trimmed };
      const selectedId = selectedPipelineId || (activePipelineId != null ? String(activePipelineId) : '');
      const fromName = findPipelineByName(pipelines, trimmed);
      const mergeSourceId = selectedId || (fromName ? String(fromName.pipeline_id) : '');

      if (mergeSourceId) {
        try {
          const existingRes = await mlopsApi.pipelineGet(mergeSourceId);
          const existingPipeline = pick(existingRes);
          mergedPayload = mergePipelinePayload({
            existingPipeline,
            payload: mergedPayload,
            screenKey,
            currentState,
          });
        } catch {
          // If lookup fails, keep save path forward-compatible.
        }
      }

      const res = await mlopsApi.pipelineSave(mergedPayload);
      const result = pick(res);
      const savedId = String(result?.pipeline_id || '');
      if (savedId) setSelectedPipelineId(savedId);
      if (savedId) {
        onPipelineActivated?.({
          pipeline_id: Number(savedId),
          name: trimmed,
        });
      }
      setBaselineJson(currentJson);
      setMessage(`Saved as "${trimmed}"`);
      await loadPipelines();
    } catch (e) {
      setError(e?.message || 'Failed to save pipeline');
    } finally {
      setSaving(false);
    }
  }, [
    name,
    buildSavePayload,
    currentState,
    datasetId,
    persona,
    screenKey,
    currentJson,
    loadPipelines,
    selectedPipelineId,
    activePipelineId,
    pipelines,
    onPipelineActivated,
  ]);

  const handleLoad = useCallback(async () => {
    if (!selectedPipelineId) return;
    setError('');
    setMessage('');
    try {
      const res = await mlopsApi.pipelineGet(selectedPipelineId);
      const payload = pick(res);
      const nextState = getStateFromPipeline(payload, screenKey);
      if (!nextState) {
        setError('Selected pipeline does not contain a state for this screen');
        return;
      }
      onLoadState?.(nextState, payload);
      onPipelineActivated?.({
        pipeline_id: Number(payload?.pipeline_id || selectedPipelineId),
        name: payload?.name || '',
      });
      setBaselineJson(stableStringify(nextState));
      setMessage(`Loaded "${payload?.name || 'pipeline'}"`);
    } catch (e) {
      setError(e?.message || 'Failed to load pipeline');
    }
  }, [selectedPipelineId, screenKey, onLoadState, onPipelineActivated]);

  return (
    <Paper
      variant="outlined"
      sx={{
        width: collapsed ? 52 : 300,
        minWidth: collapsed ? 52 : 300,
        borderColor: tone.border,
        borderRadius: 2,
        alignSelf: 'flex-start',
        position: sticky ? 'sticky' : 'static',
        top: sticky ? 8 : 'auto',
        overflow: 'hidden',
        transition: 'width 0.15s ease',
      }}
    >
      <Box sx={{ px: 1.25, py: 1, borderBottom: `1px solid ${tone.border}`, bgcolor: tone.bg }}>
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={0.75} alignItems="center">
            <AccountTree sx={{ fontSize: 15, color: tone.orange }} />
            {!collapsed && (
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: tone.text }}>
                {screenLabel} Pipelines
              </Typography>
            )}
          </Stack>
          <IconButton size="small" onClick={() => setCollapsed((v) => !v)} sx={{ p: 0.4 }}>
            {collapsed
              ? <ChevronRight sx={{ fontSize: 16, color: tone.muted }} />
              : <ChevronLeft sx={{ fontSize: 16, color: tone.muted }} />}
          </IconButton>
        </Stack>
        {!collapsed && (
          <>
            <Typography sx={{ fontSize: 11, color: tone.muted, mt: 0.3 }}>
              Save, reload, and compare versions for this screen.
            </Typography>
            {activePipelineName && (
              <Chip
                size="small"
                label={`Active: ${activePipelineName}`}
                sx={{
                  mt: 0.8,
                  fontSize: 10.5,
                  bgcolor: tone.goodBg,
                  color: tone.good,
                  fontWeight: 700,
                }}
              />
            )}
          </>
        )}
      </Box>

      <Collapse in={!collapsed} orientation="horizontal">
      <Stack spacing={1.1} sx={{ p: 1.5, width: 300 }}>
        <TextField
          size="small"
          label="Pipeline name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            startIcon={<Save sx={{ fontSize: 14 }} />}
            onClick={handleSave}
            disabled={saving}
            sx={{ textTransform: 'none', bgcolor: tone.orange, '&:hover': { bgcolor: '#b83d00' } }}
          >
            {saving ? 'Saving...' : 'Save'}
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

        <FormControl size="small" fullWidth>
          <InputLabel>Saved pipelines</InputLabel>
          <Select
            value={selectedPipelineId}
            label="Saved pipelines"
            onChange={(e) => setSelectedPipelineId(String(e.target.value))}
          >
            {pipelineList.map((p) => (
              <MenuItem key={p.pipeline_id} value={String(p.pipeline_id)}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          size="small"
          variant="outlined"
          onClick={handleLoad}
          disabled={!selectedPipelineId}
          sx={{ textTransform: 'none' }}
        >
          Load selected pipeline
        </Button>

        <FormControl size="small" fullWidth>
          <InputLabel>Compare with</InputLabel>
          <Select
            value={comparePipelineId}
            label="Compare with"
            onChange={(e) => setComparePipelineId(String(e.target.value))}
          >
            <MenuItem value="">None</MenuItem>
            {pipelineList.map((p) => (
              <MenuItem key={`cmp_${p.pipeline_id}`} value={String(p.pipeline_id)}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {unsavedChanges && (
          <Chip
            size="small"
            label="Unsaved changes"
            sx={{ alignSelf: 'flex-start', bgcolor: tone.warnBg, color: tone.warn, fontWeight: 700 }}
          />
        )}

        {compareDiffKeys.length > 0 && (
          <Stack spacing={0.5} sx={{ p: 1, borderRadius: 1.25, bgcolor: tone.orangeSoft }}>
            <Stack direction="row" spacing={0.6} alignItems="center">
              <CompareArrows sx={{ fontSize: 13, color: tone.orange }} />
              <Typography sx={{ fontSize: 11, color: tone.text, fontWeight: 700 }}>
                Differences ({compareDiffKeys.length})
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 10.5, color: tone.muted }}>
              {compareDiffKeys.slice(0, 6).join(', ')}
            </Typography>
          </Stack>
        )}

        {summaryItems.length > 0 && (
          <Stack spacing={0.4} sx={{ p: 1, borderRadius: 1.25, bgcolor: '#ffffff', border: `1px solid ${tone.border}` }}>
            <Typography sx={{ fontSize: 10, color: tone.muted, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.6 }}>
              Current Plan
            </Typography>
            {summaryItems.slice(0, 6).map((line, idx) => (
              <Typography key={`${idx}_${line}`} sx={{ fontSize: 11, color: tone.text }}>
                {line}
              </Typography>
            ))}
          </Stack>
        )}

        {message && <Alert severity="success" sx={{ py: 0.25 }}>{message}</Alert>}
        {error && <Alert severity="error" sx={{ py: 0.25 }}>{error}</Alert>}
      </Stack>
      </Collapse>
    </Paper>
  );
};

export default ScreenPipelineRail;
