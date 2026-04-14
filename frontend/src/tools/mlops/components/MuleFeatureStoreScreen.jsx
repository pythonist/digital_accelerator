import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowForward, ExpandMore, Refresh, Storage } from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';
import { WorkbenchSection, WorkbenchStatusBadge, getStageArtifacts, getStageWorkspaceState } from './MuleWorkbenchChrome';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'execution', label: 'Generate' },
  { id: 'configuration', label: 'Feature Catalogue' },
  { id: 'summary', label: 'Summary / Traceability' },
];
const EXEC_STEPS = ['Validate configuration', 'Load source bundle', 'Normalize inputs', 'Build governed modules', 'Compile catalog', 'Persist artifacts'];
const panelSx = { borderRadius: 0, boxShadow: 'none', borderColor: 'rgba(15,23,42,0.10)', bgcolor: '#fff' };
const fmt = (v) => Number(v || 0).toLocaleString();
const txt = (v) => String(v || '').trim();
const low = (v) => txt(v).toLowerCase();
const arr = (v) => (Array.isArray(v) ? v : []);
const when = (v) => {
  if (!v) return 'Not available';
  try { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)); } catch { return String(v); }
};
const dur = (s) => {
  const n = Math.max(0, Math.round(Number(s || 0)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const cats = (value) => {
  const out = [];
  (Array.isArray(value) ? value : [value]).forEach((item) => {
    String(item || '').split(/[,/|]/).map((p) => p.trim().toUpperCase()).filter(Boolean).forEach((p) => {
      if (/^M\d+$/.test(p) && !out.includes(p)) out.push(p);
    });
  });
  return out;
};
const list = (value) => {
  const out = [];
  arr(value).forEach((item) => {
    const v = txt(item);
    if (v && !out.includes(v)) out.push(v);
  });
  return out;
};
const execStatus = (status, done, busy) => {
  const s = low(status);
  if (busy) return 'running';
  if (done || ['ready', 'generated', 'built', 'completed'].includes(s)) return 'completed';
  if (['failed', 'error'].includes(s)) return 'failed';
  if (['queued', 'pending'].includes(s)) return 'queued';
  if (['running', 'in_progress', 'preview', 'generating', 'validating'].includes(s)) return 'in_progress';
  if (s === 'stale') return 'stale';
  return 'not_started';
};

export default function MuleFeatureStoreScreen({
  activePipelineId,
  activePipelineName,
  workspace = null,
  masterDataset = null,
  featureStoreDataset = null,
  onDatasetsRefresh,
  onFeatureStoreComplete,
  onStepAdvance,
}) {
  const pipelineId = Number(activePipelineId || 0);
  const saveRef = useRef('');
  const hydrateSkipRef = useRef(true);
  const [statusData, setStatusData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [expandedModule, setExpandedModule] = useState('');
  const [detailFeature, setDetailFeature] = useState(null);
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [requestedAt, setRequestedAt] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [featureType, setFeatureType] = useState('');
  const [sourceTable, setSourceTable] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  const stageState = useMemo(() => getStageWorkspaceState(workspace, 'featurestore') || null, [workspace]);
  const workspaceArtifacts = useMemo(() => getStageArtifacts(workspace, 'featurestore'), [workspace]);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!pipelineId) return;
    if (!silent) setRefreshing(true);
    try {
      const res = await mlopsApi.muleFeatureStoreStatus(pipelineId);
      const payload = res?.data || res || null;
      setStatusData(payload);
      if (!selectionDirty || silent) setSelectedFeatures(arr(payload?.selected_features));
      const first = arr(payload?.module_summaries)[0]?.module_key || '';
      setExpandedModule((prev) => prev || String(first || ''));
      if (silent && ['ready', 'generated', 'built', 'completed', 'failed', 'error'].includes(low(payload?.generation_status))) setGenerating(false);
    } catch (error) {
      setMessage(error?.response?.data?.error || error?.message || 'Could not load the Mule feature store.');
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [pipelineId, selectionDirty]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const screenState = useMemo(() => ({ tab, expandedModule, search, category, featureType, sourceTable, selectedOnly }), [tab, expandedModule, search, category, featureType, sourceTable, selectedOnly]);
  useEffect(() => {
    if (!pipelineId) return undefined;
    if (hydrateSkipRef.current) { hydrateSkipRef.current = false; return undefined; }
    const sig = JSON.stringify(screenState);
    if (sig === saveRef.current) return undefined;
    const timer = window.setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, { screen: 'mule_featurestore', state: screenState }).then(() => { saveRef.current = sig; }).catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pipelineId, screenState]);
  const catalog = useMemo(() => arr(statusData?.feature_catalog).map((r) => ({
    ...r,
    mule_categories: cats(r?.mule_categories),
    source_tables: list(r?.source_tables),
    raw_variables: list(r?.raw_variables),
    feature_type: txt(r?.feature_type || r?.data_type || 'calculated'),
  })), [statusData?.feature_catalog]);
  const modules = useMemo(() => arr(statusData?.module_summaries), [statusData?.module_summaries]);
  const selectedSet = useMemo(() => new Set(selectedFeatures), [selectedFeatures]);
  const generated = ['ready', 'generated', 'built', 'completed'].includes(low(statusData?.generation_status));
  const latestJob = statusData?.latest_job || (low(workspace?.latest_job?.stage_name) === 'feature_store' ? workspace.latest_job : null);
  const artifacts = arr(statusData?.stage_artifacts).length ? arr(statusData?.stage_artifacts) : workspaceArtifacts;
  const logs = useMemo(() => {
    if (Array.isArray(latestJob?.logs?.entries)) return latestJob.logs.entries;
    if (latestJob?.logs && typeof latestJob.logs === 'object' && Object.keys(latestJob.logs).length) return [latestJob.logs];
    return [];
  }, [latestJob]);
  const status = execStatus(latestJob?.status || statusData?.generation_status || stageState?.status, generated, generating);
  const progress = Math.max(0, Math.min(100, Number(latestJob?.progress_pct || (generated ? 100 : 0))));
  const startAt = latestJob?.started_at || requestedAt || statusData?.generated_at || workspace?.run?.updated_at;
  const endAt = latestJob?.finished_at || (generated ? statusData?.generated_at : '');
  const elapsed = useMemo(() => {
    const s = startAt ? new Date(startAt).getTime() : 0;
    const e = endAt ? new Date(endAt).getTime() : Date.now();
    return !s || Number.isNaN(s) || Number.isNaN(e) || e < s ? 0 : (e - s) / 1000;
  }, [endAt, startAt]);
  const totalRecords = Number(latestJob?.logs?.records_total || statusData?.generation_metadata?.master_dataset_rows || statusData?.latest_run?.row_count || masterDataset?.row_count || 0);
  const processedRecords = Number(latestJob?.logs?.records_processed || (generated ? totalRecords : 0));
  const totalSteps = Number(latestJob?.logs?.total_steps || EXEC_STEPS.length);
  const currentStep = Number(latestJob?.logs?.current_step_index || (generated ? totalSteps : 1));
  const eta = progress > 0 && progress < 100 && elapsed > 0 ? Math.round((elapsed * (100 - progress)) / progress) : Number(latestJob?.logs?.estimated_runtime_seconds || statusData?.generation_metadata?.estimated_runtime_seconds || 0);
  const currentTask = txt(latestJob?.logs?.current_task || (generated ? 'Feature-store artifact ready for downstream reuse' : 'Awaiting generation'));
  const currentModule = txt(latestJob?.logs?.current_module || (generated ? 'Persisted output' : 'No module running'));
  const heartbeat = latestJob?.logs?.heartbeat_ts || latestJob?.updated_at || workspace?.run?.updated_at;
  const canOpenCatalogue = generated;
  const canOpenSummary = generated;
  const canContinueDownstream = generated && selectedFeatures.length > 0 && !saving;

  useEffect(() => {
    if (!pipelineId) return undefined;
    if (!(generating || ['in_progress', 'queued'].includes(status))) return undefined;
    const timer = window.setInterval(() => { loadStatus({ silent: true }); }, 2500);
    return () => window.clearInterval(timer);
  }, [generating, loadStatus, pipelineId, status]);

  const filtered = useMemo(() => {
    const q = low(search);
    return catalog.filter((row) => {
      const hay = [row.feature_name, row.business_definition, row.formula, row.logic_summary, row.feature_group, row.feature_type, ...arr(row.raw_variables), ...arr(row.source_tables)].join(' ').toLowerCase();
      return (!q || hay.includes(q)) && (!category || row.mule_categories.includes(category)) && (!featureType || low(row.feature_type) === low(featureType)) && (!sourceTable || row.source_tables.includes(sourceTable)) && (!selectedOnly || selectedSet.has(row.feature_name));
    });
  }, [catalog, category, featureType, search, selectedOnly, selectedSet, sourceTable]);

  const rowsByModule = useMemo(() => {
    const out = {};
    filtered.forEach((row) => {
      const key = txt(row.module_key);
      if (!out[key]) out[key] = [];
      out[key].push(row);
    });
    return out;
  }, [filtered]);

  const visibleModules = useMemo(() => {
    const hasFilter = Boolean(search || category || featureType || sourceTable || selectedOnly);
    const kept = modules.filter((m) => (rowsByModule[m.module_key] || []).length > 0 || !hasFilter);
    return kept.length ? kept : modules;
  }, [category, featureType, modules, rowsByModule, search, selectedOnly, sourceTable]);
  useEffect(() => {
    if (!visibleModules.length) return;
    if (expandedModule && !visibleModules.some((m) => m.module_key === expandedModule)) {
      setExpandedModule(txt(visibleModules[0]?.module_key));
      setDetailFeature(null);
    }
  }, [expandedModule, visibleModules]);
  useEffect(() => {
    if (tab === 'configuration' && !canOpenCatalogue) {
      setTab(['in_progress', 'queued'].includes(status) || generating ? 'execution' : 'overview');
    }
    if (tab === 'summary' && !canOpenSummary) {
      setTab(['in_progress', 'queued'].includes(status) || generating ? 'execution' : 'overview');
    }
  }, [canOpenCatalogue, canOpenSummary, generating, status, tab]);

  const currentModuleRows = rowsByModule[expandedModule] || [];
  const detail = detailFeature || currentModuleRows[0] || null;
  const categoryOptions = useMemo(() => Array.from(new Set(catalog.flatMap((r) => r.mule_categories))).sort(), [catalog]);
  const typeOptions = useMemo(() => Array.from(new Set(catalog.map((r) => txt(r.feature_type)).filter(Boolean))).sort(), [catalog]);
  const sourceOptions = useMemo(() => Array.from(new Set(catalog.flatMap((r) => r.source_tables))).sort(), [catalog]);
  const selectionByModule = visibleModules.map((m) => ({ name: m.module_name, total: (rowsByModule[m.module_key] || []).length, selected: (rowsByModule[m.module_key] || []).filter((r) => selectedSet.has(r.feature_name)).length })).filter((r) => r.total > 0);
  const warnings = arr(workspace?.warnings);
  const blockers = arr(workspace?.blockers);
  const leakageBlocked = catalog.filter((r) => r.training_eligible === false).length;

  const saveSelection = useCallback(async (next, notify = true) => {
    if (!pipelineId) return;
    setSaving(true);
    try {
      const res = await mlopsApi.muleFeatureStoreConfig(pipelineId, { selected_features: next });
      const payload = res?.data || res || null;
      setStatusData((prev) => ({ ...(prev || {}), ...(payload || {}) }));
      setSelectedFeatures(arr(payload?.selected_features).length ? arr(payload.selected_features) : next);
      setSelectionDirty(false);
      await onDatasetsRefresh?.({ sync: true, pipelineId });
      await onFeatureStoreComplete?.();
      if (notify) setMessage(`Saved ${next.length} governed features for this Mule run.`);
    } catch (error) {
      setMessage(error?.response?.data?.error || error?.message || 'Could not save the selected Mule features.');
    } finally {
      setSaving(false);
    }
  }, [onDatasetsRefresh, onFeatureStoreComplete, pipelineId]);

  const generate = useCallback(async () => {
    if (!pipelineId) return;
    setGenerating(true);
    setRequestedAt(new Date().toISOString());
    setTab('execution');
    try {
      const res = await mlopsApi.muleFeatureStoreGenerate(pipelineId, { regenerate: generated });
      const payload = res?.data || res || null;
      setStatusData(payload);
      setSelectedFeatures(arr(payload?.selected_features));
      setSelectionDirty(false);
      await onDatasetsRefresh?.({ sync: true, pipelineId });
      await onFeatureStoreComplete?.();
      setMessage(generated ? 'Feature Store regenerated from persisted backend inputs.' : 'Feature Store generated and stored for downstream Mule stages.');
    } catch (error) {
      setMessage(error?.response?.data?.error || error?.message || 'Could not generate the Mule feature store.');
    } finally {
      setGenerating(false);
    }
  }, [generated, onDatasetsRefresh, onFeatureStoreComplete, pipelineId]);

  const toggleFeature = (name, checked) => {
    setSelectedFeatures((prev) => checked ? Array.from(new Set([...prev, name])) : prev.filter((v) => v !== name));
    setSelectionDirty(true);
  };
  const includeModule = (moduleKey) => {
    const merged = new Set(selectedFeatures);
    (rowsByModule[moduleKey] || []).forEach((row) => merged.add(row.feature_name));
    setSelectedFeatures(Array.from(merged));
    setSelectionDirty(true);
  };
  const excludeModule = (moduleKey) => {
    const blocked = new Set((rowsByModule[moduleKey] || []).map((row) => row.feature_name));
    setSelectedFeatures((prev) => prev.filter((v) => !blocked.has(v)));
    setSelectionDirty(true);
  };
  const continueNext = async () => { await saveSelection(selectedFeatures, false); onStepAdvance?.('preprocess'); };
  const summaryLine = `Features: ${fmt(statusData?.total_features)} | Selected: ${fmt(selectedFeatures.length)} | Modules selected: ${fmt(selectionByModule.filter((r) => r.selected > 0).length)} | Status: ${generated ? 'Ready' : (txt(statusData?.generation_status) || 'Not generated')} | Downstream: ${featureStoreDataset || generated ? 'Ready for preprocessing' : 'Awaiting generation'}`;
  return (
    <Stack spacing={1.5}>
      {message ? <Alert severity="info" onClose={() => setMessage('')}>{message}</Alert> : null}
      <Paper variant="outlined" sx={{ ...panelSx, p: 1 }}>
        <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" alignItems={{ xl: 'flex-start' }} spacing={1}>
          <Stack spacing={0.45} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, color: '#101828', lineHeight: 1.55, fontWeight: 700, maxWidth: 860 }}>
              Review the persisted feature library, choose which features should move into preprocessing, and regenerate this stage only when the stored feature artifact genuinely needs to change.
            </Typography>
            <Typography sx={{ fontSize: 12.15, color: '#667085', lineHeight: 1.5 }}>
              The generated feature store is reused downstream for this run until you explicitly regenerate it.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent={{ xl: 'flex-end' }} alignItems="center">
            <Box sx={{ px: 1, py: 0.55, border: '1px solid rgba(15,23,42,0.10)', borderRadius: 0 }}>
              <Typography sx={{ fontSize: 11, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.5 }}>Run</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>{pipelineId ? `MULE-RUN-${String(pipelineId).padStart(4, '0')}` : 'Run unavailable'}</Typography>
            </Box>
            <WorkbenchStatusBadge status={status} label={generated ? 'Completed' : undefined} />
            <Button variant="outlined" startIcon={<Refresh />} onClick={() => loadStatus()} disabled={refreshing || generating} sx={{ textTransform: 'none', borderRadius: 0 }}>Refresh</Button>
            {tab === 'overview' ? (
              <Button variant="contained" startIcon={refreshing || generating ? <CircularProgress size={14} color="inherit" /> : <Storage />} onClick={generate} disabled={refreshing || generating} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>{refreshing || generating ? 'Running...' : generated ? 'Regenerate Feature Store' : 'Generate Feature Store'}</Button>
            ) : null}
            {tab === 'configuration' ? (
              <Button variant="outlined" onClick={() => saveSelection(selectedFeatures)} disabled={saving} sx={{ textTransform: 'none', borderRadius: 0 }}>{saving ? 'Saving...' : 'Save Selection'}</Button>
            ) : null}
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ ...panelSx, px: 1.25 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 44, '& .MuiTabs-indicator': { backgroundColor: '#C65A11', height: 2 }, '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontSize: 13, fontWeight: 700, color: '#667085', px: 1.5 }, '& .Mui-selected': { color: '#101828' } }}>
          {TABS.map((v) => <Tab key={v.id} value={v.id} label={v.label} disabled={(v.id === 'configuration' && !canOpenCatalogue) || (v.id === 'summary' && !canOpenSummary)} />)}
        </Tabs>
      </Paper>

      {tab === 'overview' ? (
        <Stack spacing={1.5}>
          <Paper variant="outlined" sx={{ ...panelSx, p: 1.5 }}>
            <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={1}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#101828' }}>{summaryLine}</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>{statusData?.reuse_available ? 'Feature-store artifact already exists for this run and should be reused downstream until you explicitly regenerate.' : 'No persisted feature-store artifact exists yet for this run.'}</Typography>
            </Stack>
          </Paper>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.55fr) minmax(320px,0.95fr)' }, gap: 1.5 }}>
            <WorkbenchSection title="What this step does" sx={{ ...panelSx, p: 1.5 }}>
              <Typography sx={{ fontSize: 12.75, color: '#475467', lineHeight: 1.75 }}>This step assembles the governed mule feature library used in downstream preprocessing and model training. It does not train a model. It generates account-level behavioural, counterparty, cross-channel, and graph/network features, stores them once for the run, and exposes the selected artifact to the next stage.</Typography>
              <Divider />
              <Typography sx={{ fontSize: 12.25, color: '#667085' }}>Source tables: {(statusData?.source_tables || []).join(', ') || 'Registered run artifacts'}</Typography>
            </WorkbenchSection>
            <WorkbenchSection title="Run Metadata" sx={{ ...panelSx, p: 1.5 }}>
              {[['Run name', activePipelineName || `Pipeline ${pipelineId}`], ['Current step', workspace?.run?.current_step_label || 'Feature Store'], ['Run status', workspace?.run?.status || status], ['Last updated', when(workspace?.run?.updated_at || statusData?.generated_at)], ['Dataset size', masterDataset ? `${fmt(masterDataset.row_count)} rows` : `${fmt(totalRecords)} records`], ['Expected runtime', dur(statusData?.generation_metadata?.estimated_runtime_seconds || latestJob?.logs?.estimated_runtime_seconds)]].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" sx={{ mb: 0.9 }}><Typography sx={{ fontSize: 12.25, color: '#667085' }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right' }}>{value}</Typography></Stack>)}
            </WorkbenchSection>
          </Box>
        </Stack>
      ) : null}

      {tab === 'configuration' ? (
        <Stack spacing={1.5}>
          {!generated ? <Alert severity="info">Generate the feature store first. The catalogue opens only after the feature library has been built for this run.</Alert> : null}
          <Paper variant="outlined" sx={{ ...panelSx, p: 1.5 }}>
            <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1}>
              <TextField fullWidth size="small" label="Search features, definitions, formulas, or source columns" value={search} onChange={(e) => setSearch(e.target.value)} />
              <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>Mule category</InputLabel><Select value={category} label="Mule category" onChange={(e) => setCategory(e.target.value)}><MenuItem value="">All</MenuItem>{categoryOptions.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</Select></FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel>Feature type</InputLabel><Select value={featureType} label="Feature type" onChange={(e) => setFeatureType(e.target.value)}><MenuItem value="">All</MenuItem>{typeOptions.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</Select></FormControl>
              <FormControl size="small" sx={{ minWidth: 170 }}><InputLabel>Source table</InputLabel><Select value={sourceTable} label="Source table" onChange={(e) => setSourceTable(e.target.value)}><MenuItem value="">All</MenuItem>{sourceOptions.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</Select></FormControl>
              <Stack direction="row" spacing={1} alignItems="center"><Switch checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} /><Typography sx={{ fontSize: 12.5, color: '#475467', whiteSpace: 'nowrap' }}>Selected only</Typography></Stack>
            </Stack>
          </Paper>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.8fr) minmax(340px,0.85fr)' }, gap: 1.5 }}>
              <TableContainer component={Paper} variant="outlined" sx={{ ...panelSx }}>
                <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Module</TableCell><TableCell sx={{ fontWeight: 800 }}>Business Scope</TableCell><TableCell sx={{ fontWeight: 800 }}>Features</TableCell><TableCell sx={{ fontWeight: 800 }}>Selected</TableCell><TableCell sx={{ fontWeight: 800 }}>Status</TableCell></TableRow></TableHead>
                <TableBody>{visibleModules.map((module) => {const rows = rowsByModule[module.module_key] || []; const selected = rows.filter((row) => selectedSet.has(row.feature_name)).length; const open = expandedModule === module.module_key; return <React.Fragment key={module.module_key}><TableRow hover onClick={() => { setExpandedModule((prev) => prev === module.module_key ? '' : module.module_key); setDetailFeature(null); }} sx={{ cursor: 'pointer' }}><TableCell sx={{ minWidth: 240 }}><Stack direction="row" spacing={1} alignItems="center"><ExpandMore sx={{ fontSize: 18, color: '#667085', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 120ms ease' }} /><Box><Typography sx={{ fontSize: 12.75, fontWeight: 800, color: '#101828' }}>{module.module_name}</Typography><Typography sx={{ fontSize: 11.5, color: '#667085' }}>{arr(module.mule_categories).join(', ') || 'General mule coverage'}</Typography></Box></Stack></TableCell><TableCell sx={{ fontSize: 12.25, color: '#475467', maxWidth: 420 }}>{module.summary}</TableCell><TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{fmt(rows.length)}</TableCell><TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{fmt(selected)}</TableCell><TableCell sx={{ fontSize: 12.25, fontWeight: 700, color: selected ? '#0F5F44' : '#8A5A00' }}>{rows.length ? (selected ? 'Configured' : 'Review required') : 'No visible rows'}</TableCell></TableRow>{open ? <TableRow><TableCell colSpan={5} sx={{ p: 0 }}><Box sx={{ p: 0.85, bgcolor: '#FCFCFD' }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 0.65 }}><Typography sx={{ fontSize: 12, color: '#667085' }}>Review the visible module features and choose which ones should flow into preprocessing.</Typography><Stack direction="row" spacing={1}><Button size="small" variant="outlined" sx={{ borderRadius: 0, textTransform: 'none' }} onClick={() => includeModule(module.module_key)}>Include visible</Button><Button size="small" variant="outlined" sx={{ borderRadius: 0, textTransform: 'none' }} onClick={() => excludeModule(module.module_key)}>Exclude visible</Button></Stack></Stack><Table size="small"><TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Include</TableCell><TableCell sx={{ fontWeight: 800 }}>Feature</TableCell><TableCell sx={{ fontWeight: 800 }}>Definition</TableCell><TableCell sx={{ fontWeight: 800 }}>Source Columns</TableCell><TableCell sx={{ fontWeight: 800 }}>Formula / Logic</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.feature_name} hover onClick={() => setDetailFeature(row)} sx={{ cursor: 'pointer' }}><TableCell onClick={(e) => e.stopPropagation()} sx={{ width: 64 }}><Checkbox size="small" checked={selectedSet.has(row.feature_name)} onChange={(e) => toggleFeature(row.feature_name, e.target.checked)} /></TableCell><TableCell sx={{ minWidth: 220 }}><Typography sx={{ fontSize: 12.25, fontWeight: 800, color: '#101828' }}>{row.feature_name}</Typography><Typography sx={{ fontSize: 11.5, color: '#667085' }}>{row.feature_type}</Typography></TableCell><TableCell sx={{ maxWidth: 300, fontSize: 12.1, color: '#475467' }}>{row.business_definition || row.logic_summary}</TableCell><TableCell sx={{ maxWidth: 250, fontSize: 12.1, color: '#475467' }}>{arr(row.raw_variables).join(', ') || 'Derived account-level aggregates'}</TableCell><TableCell sx={{ maxWidth: 380 }}><Typography sx={{ fontSize: 12.1, fontWeight: 700, color: '#101828' }}>{row.formula || 'Governed feature logic'}</Typography><Typography sx={{ fontSize: 11.5, color: '#667085', mt: 0.35 }}>{row.logic_summary || 'Business derivation summary unavailable.'}</Typography></TableCell></TableRow>)}</TableBody></Table></Box></TableCell></TableRow> : null}</React.Fragment>;})}</TableBody>
              </Table>
            </TableContainer>
            <Stack spacing={1.5}>
              <WorkbenchSection title="Selection Summary" sx={{ ...panelSx, p: 1.5 }}>
                {[['Selected features', fmt(selectedFeatures.length)], ['Visible features', fmt(filtered.length)], ['Selected modules', fmt(selectionByModule.filter((r) => r.selected > 0).length)], ['Persisted output', statusData?.reuse_available ? 'Yes' : 'No']].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" sx={{ mb: 0.9 }}><Typography sx={{ fontSize: 12.25, color: '#667085' }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>{value}</Typography></Stack>)}
                <Divider />
                {selectionByModule.slice(0, 8).map((row) => <Stack key={row.name} direction="row" justifyContent="space-between" sx={{ mb: 0.6 }}><Typography sx={{ fontSize: 12, color: '#475467' }}>{row.name}</Typography><Typography sx={{ fontSize: 12, fontWeight: 700, color: '#101828' }}>{row.selected}/{row.total}</Typography></Stack>)}
                <Divider />
                <Typography sx={{ fontSize: 12.1, color: '#667085' }}>Save the governed selection here. The downstream confirmation appears only in the final summary tab.</Typography>
              </WorkbenchSection>
              <WorkbenchSection title="Feature Detail" sx={{ ...panelSx, p: 1.5 }}>
                {detail ? <><Typography sx={{ fontSize: 16, fontWeight: 800, color: '#101828' }}>{detail.feature_name}</Typography><Typography sx={{ fontSize: 12.25, color: '#475467', mt: 0.6 }}>{detail.business_definition || detail.logic_summary}</Typography><Divider sx={{ my: 1 }} />{[['Module', detail.module_name], ['Mule categories', arr(detail.mule_categories).join(', ') || 'General'], ['Source tables', arr(detail.source_tables).join(', ') || 'Run artifacts'], ['Source columns', arr(detail.raw_variables).join(', ') || 'Derived account-level aggregates'], ['Formula', detail.formula || 'Governed feature calculation'], ['Logic', detail.logic_summary || 'Business derivation summary unavailable.']].map(([label, value]) => <Typography key={label} sx={{ fontSize: 12.25, color: '#667085', mb: 0.75 }}>{label}: <strong style={{ color: '#101828' }}>{value}</strong></Typography>)}</> : <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Select a feature row to inspect lineage, formula, and business logic.</Typography>}
              </WorkbenchSection>
            </Stack>
          </Box>
        </Stack>
      ) : null}
      {tab === 'execution' ? (
        <Stack spacing={1.5}>
          <Paper variant="outlined" sx={{ ...panelSx, p: 1.25 }}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={1}>
                <Box><Stack direction="row" spacing={1} alignItems="center"><WorkbenchStatusBadge status={status} /><Typography sx={{ fontSize: 14, fontWeight: 700, color: '#101828' }}>{Math.round(progress)}% complete</Typography></Stack><Typography sx={{ fontSize: 12.75, color: '#475467', mt: 0.45 }}>Current task: {currentTask}</Typography><Typography sx={{ fontSize: 12.25, color: '#667085' }}>Current module: {currentModule}</Typography></Box>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>{[['Step', `${Math.min(currentStep, totalSteps)} of ${totalSteps}`], ['Elapsed', dur(elapsed)], ['ETA', status === 'in_progress' ? dur(eta) : '00:00'], ['Processed', `${fmt(processedRecords)} / ${fmt(totalRecords)}`]].map(([label, value]) => <Box key={label}><Typography sx={{ fontSize: 11.5, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography><Typography sx={{ fontSize: 12.75, fontWeight: 700, color: '#101828' }}>{value}</Typography></Box>)}</Stack>
              </Stack>
              <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 0, bgcolor: 'rgba(15,23,42,0.08)', '& .MuiLinearProgress-bar': { bgcolor: '#C65A11' } }} />
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ ...panelSx, p: 1.25 }}><Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>{[['Records', fmt(totalRecords)], ['Modules selected', fmt(selectionByModule.filter((r) => r.selected > 0).length || modules.length)], ['Estimated runtime', dur(statusData?.generation_metadata?.estimated_runtime_seconds || latestJob?.logs?.estimated_runtime_seconds)], ['Expected features', fmt(statusData?.total_features)]].map(([label, value]) => <Typography key={label} sx={{ fontSize: 12.5, color: '#475467' }}>{label}: <strong style={{ color: '#101828' }}>{value}</strong></Typography>)}</Stack></Paper>
          {status === 'failed' ? <Alert severity="error">{txt(stageState?.error?.message || latestJob?.logs?.message || 'Feature-store generation failed.')}</Alert> : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.2fr) minmax(320px,0.8fr)' }, gap: 1.5 }}>
            <WorkbenchSection title="Execution Timeline" sx={{ ...panelSx, p: 1.5 }}>{EXEC_STEPS.map((label, i) => {const n = i + 1; const stepState = status === 'failed' && n === currentStep ? 'failed' : n < currentStep || status === 'completed' ? 'completed' : n === currentStep && ['in_progress', 'queued'].includes(status) ? 'in_progress' : 'not_started'; return <Paper key={label} variant="outlined" sx={{ p: 1, borderRadius: 0, mb: 0.8, bgcolor: stepState === 'in_progress' ? '#FFF7ED' : '#fff', borderColor: stepState === 'in_progress' ? 'rgba(198,90,17,0.24)' : 'rgba(15,23,42,0.08)' }}><Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>{label}</Typography><Typography sx={{ fontSize: 12, fontWeight: 700, color: stepState === 'completed' ? '#0F5F44' : stepState === 'failed' ? '#B42318' : stepState === 'in_progress' ? '#C65A11' : '#667085' }}>{stepState === 'completed' ? 'Completed' : stepState === 'failed' ? 'Failed' : stepState === 'in_progress' ? 'Running' : 'Pending'}</Typography></Stack></Paper>;})}</WorkbenchSection>
            <WorkbenchSection title="Run Diagnostics" sx={{ ...panelSx, p: 1.5 }}>{[['Runtime estimate', dur(statusData?.generation_metadata?.estimated_runtime_seconds || latestJob?.logs?.estimated_runtime_seconds)], ['Current output path', statusData?.feature_store_path || statusData?.full_feature_store_path || 'Not materialized'], ['Heartbeat', when(heartbeat)], ['Persisted reuse', statusData?.reuse_available ? 'Available' : 'Not yet available']].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.9, gap: 1.5 }}><Typography sx={{ fontSize: 12.25, color: '#667085', minWidth: 120 }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right', maxWidth: 260, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value}</Typography></Stack>)}{warnings.length ? <><Divider />{warnings.slice(0, 4).map((w) => <Typography key={w} sx={{ fontSize: 12.25, color: '#8A5A00', mt: 0.7 }}>{w}</Typography>)}</> : null}</WorkbenchSection>
          </Box>
          <Paper variant="outlined" sx={{ ...panelSx }}><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1.1, borderBottom: '1px solid rgba(15,23,42,0.08)' }}><Typography sx={{ fontSize: 13.25, fontWeight: 800, color: '#101828' }}>Run Activity</Typography><Button size="small" variant="outlined" sx={{ borderRadius: 0, textTransform: 'none' }} onClick={() => loadStatus()}>Refresh logs</Button></Stack><Box sx={{ maxHeight: 320, overflowY: 'auto' }}>{logs.length ? logs.map((entry, i) => {const color = low(entry.level || entry.status) === 'error' ? '#B42318' : low(entry.level || entry.status) === 'warning' ? '#8A5A00' : '#155EEF'; return <Box key={`${entry.ts || 'ts'}_${i}`} sx={{ px: 1.5, py: 1.05, borderBottom: i === logs.length - 1 ? 'none' : '1px solid rgba(15,23,42,0.06)' }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between"><Typography sx={{ fontSize: 12.25, fontWeight: 700, color }}>{entry.current_task || entry.message || entry.status || 'Execution update'}</Typography><Typography sx={{ fontSize: 11.5, color: '#667085' }}>{when(entry.ts)}</Typography></Stack><Typography sx={{ fontSize: 12, color: '#475467', mt: 0.35 }}>{entry.message || 'No message supplied by backend.'}</Typography></Box>;}) : <Typography sx={{ px: 1.5, py: 2, fontSize: 12.5, color: '#667085' }}>No execution activity has been recorded yet for this run.</Typography>}</Box></Paper>
        </Stack>
      ) : null}

      {tab === 'summary' ? (
        <Stack spacing={1.5}>
          {!generated ? <Alert severity="info">Finish feature generation first. The final summary opens only after the feature-store artifact is available.</Alert> : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0,1fr))' }, gap: 1.5 }}>
            <WorkbenchSection title="Selection Summary" sx={{ ...panelSx, p: 1.5 }}>
              {[['Final selected features', fmt(selectedFeatures.length)], ['Selected modules', fmt(selectionByModule.filter((r) => r.selected > 0).length)], ['Excluded features', fmt(Math.max(Number(statusData?.total_features || 0) - selectedFeatures.length, 0))], ['Preprocessing readiness', featureStoreDataset || generated ? 'Ready to proceed' : 'Blocked until generation completes'], ['Registered dataset', featureStoreDataset?.dataset_id || statusData?.latest_run?.dataset_id || 'Not registered']].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.9, gap: 1.5 }}><Typography sx={{ fontSize: 12.25, color: '#667085', minWidth: 130 }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right', maxWidth: 260, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value}</Typography></Stack>)}
              <Divider />
              <Typography sx={{ fontSize: 12.4, color: '#475467', mt: 0.9 }}>This is the governed feature set that will move downstream into preprocessing.</Typography>
              {blockers.length ? <>{blockers.map((b) => <Typography key={b} sx={{ fontSize: 12.25, color: '#B42318', mt: 0.7 }}>{b}</Typography>)}</> : null}
            </WorkbenchSection>
            <WorkbenchSection title="Traceability" sx={{ ...panelSx, p: 1.5 }}>
              <Typography sx={{ fontSize: 12.25, color: '#667085', mb: 1 }}>This records who generated the feature set, when it ran, which logic version produced it, and what exclusions or warnings were applied.</Typography>
              {[['Triggered by', workspace?.run?.user_id || 'system'], ['Started', when(startAt)], ['Completed', when(endAt || statusData?.generated_at)], ['Feature logic version', statusData?.schema_version || 'mule_feature_store_v1'], ['Generated from scripts', arr(statusData?.generation_metadata?.generated_from_scripts).join(', ') || 'Stored feature generation service']].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.9, gap: 1.5 }}><Typography sx={{ fontSize: 12.25, color: '#667085', minWidth: 130 }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right', maxWidth: 260, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value}</Typography></Stack>)}
            </WorkbenchSection>
          </Box>
          <WorkbenchSection title="Generated Artifacts" sx={{ ...panelSx, p: 1.5 }}><TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 0 }}><Table size="small"><TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Artifact</TableCell><TableCell sx={{ fontWeight: 800 }}>Status</TableCell><TableCell sx={{ fontWeight: 800 }}>Path / Reference</TableCell><TableCell sx={{ fontWeight: 800 }}>Version</TableCell><TableCell sx={{ fontWeight: 800 }}>Created</TableCell></TableRow></TableHead><TableBody>{artifacts.length ? artifacts.map((a) => <TableRow key={`${a.artifact_id}_${a.artifact_type}`}><TableCell sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>{a.artifact_type}</TableCell><TableCell sx={{ fontSize: 12.25, fontWeight: 700, color: '#0F5F44' }}>Available</TableCell><TableCell sx={{ fontSize: 12.1, color: '#475467', maxWidth: 420 }}>{a.storage_ref || 'Registered in artifact registry'}</TableCell><TableCell sx={{ fontSize: 12.1 }}>{a.version || 1}</TableCell><TableCell sx={{ fontSize: 12.1 }}>{when(a.created_at)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5}><Typography sx={{ fontSize: 12.5, color: '#667085' }}>No persisted feature-store artifacts are registered yet.</Typography></TableCell></TableRow>}</TableBody></Table></TableContainer></WorkbenchSection>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0,1fr))' }, gap: 1.5 }}>
            <WorkbenchSection title="Selection Governance" sx={{ ...panelSx, p: 1.5 }}>{[['Source tables', fmt(arr(statusData?.source_tables).length)], ['Module count', fmt(modules.length)], ['Leakage-blocked features', fmt(leakageBlocked)], ['Excluded features', fmt(Math.max(Number(statusData?.total_features || 0) - selectedFeatures.length, 0))]].map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" sx={{ mb: 0.9 }}><Typography sx={{ fontSize: 12.25, color: '#667085' }}>{label}</Typography><Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>{value}</Typography></Stack>)}<Divider />{warnings.length ? warnings.map((w) => <Typography key={w} sx={{ fontSize: 12.25, color: '#8A5A00', mt: 0.7 }}>{w}</Typography>) : <Typography sx={{ fontSize: 12.25, color: '#475467', mt: 0.7 }}>No additional governance warnings were recorded for this feature-store run.</Typography>}</WorkbenchSection>
          </Box>
          <WorkbenchSection title="Module-Level Selection Counts" sx={{ ...panelSx, p: 1.5 }}><TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 0 }}><Table size="small"><TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Module</TableCell><TableCell sx={{ fontWeight: 800 }}>Available</TableCell><TableCell sx={{ fontWeight: 800 }}>Selected</TableCell><TableCell sx={{ fontWeight: 800 }}>Categories</TableCell><TableCell sx={{ fontWeight: 800 }}>Source tables</TableCell></TableRow></TableHead><TableBody>{modules.map((m) => <TableRow key={m.module_key}><TableCell sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>{m.module_name}</TableCell><TableCell sx={{ fontSize: 12.1 }}>{fmt(m.feature_count)}</TableCell><TableCell sx={{ fontSize: 12.1 }}>{fmt(m.selected_features_count)}</TableCell><TableCell sx={{ fontSize: 12.1, color: '#475467' }}>{arr(m.mule_categories).join(', ') || 'General'}</TableCell><TableCell sx={{ fontSize: 12.1, color: '#475467' }}>{arr(m.source_tables).join(', ')}</TableCell></TableRow>)}</TableBody></Table></TableContainer></WorkbenchSection>
          <Paper variant="outlined" sx={{ ...panelSx, p: 1.25 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1}>
              <Typography sx={{ fontSize: 12.5, color: '#475467' }}>When you are satisfied with this governed feature selection, save it and send it downstream to preprocessing.</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="outlined" onClick={() => saveSelection(selectedFeatures)} disabled={saving} sx={{ textTransform: 'none', borderRadius: 0 }}>{saving ? 'Saving...' : 'Save Selection'}</Button>
                <Button variant="contained" endIcon={<ArrowForward />} onClick={continueNext} disabled={!canContinueDownstream} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>Save Selection and Continue</Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      ) : null}
    </Stack>
  );
}
