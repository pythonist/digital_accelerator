import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';
import { WorkbenchStatusBadge, getStageWorkspaceState } from './MuleWorkbenchChrome';
import MulePreprocessingDataOverviewTab from './mule_preprocessing_workbench/MulePreprocessingDataOverviewTab';
import MulePreprocessingTransformTab from './mule_preprocessing_workbench/MulePreprocessingTransformTab';
import MulePreprocessingFeatureBuilderTab from './mule_preprocessing_workbench/MulePreprocessingFeatureBuilderTab';
import MulePreprocessingFeatureSelectionTab from './mule_preprocessing_workbench/MulePreprocessingFeatureSelectionTab';
import MulePreprocessingPipelineRunTab from './mule_preprocessing_workbench/MulePreprocessingPipelineRunTab';
import MulePreprocessingSummaryTab from './mule_preprocessing_workbench/MulePreprocessingSummaryTab';

const TABS = [
  { id: 'overview', label: 'Data Overview' },
  { id: 'transform', label: 'Transform' },
  { id: 'feature_builder', label: 'Feature Builder' },
  { id: 'feature_selection', label: 'Feature Selection' },
  { id: 'pipeline_run', label: 'Pipeline Run' },
  { id: 'summary', label: 'Summary / Traceability' },
];

const panelSx = { borderRadius: 0, boxShadow: 'none', borderColor: 'rgba(15,23,42,0.10)', bgcolor: '#fff' };
const fmt = (value) => Number(value || 0).toLocaleString();

export default function MulePreprocessingStudioScreen({
  activePipelineId,
  activePipelineName,
  workspace = null,
  masterDataset = null,
  featureStoreDataset = null,
  preprocessedDataset = null,
  onDatasetsRefresh,
  onStepAdvance,
}) {
  const pipelineId = Number(activePipelineId || 0);
  const saveRef = useRef('');
  const hydrateSkipRef = useRef(true);
  const [tab, setTab] = useState('overview');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [overviewData, setOverviewData] = useState(null);
  const [transformData, setTransformData] = useState(null);
  const [transformPreview, setTransformPreview] = useState(null);
  const [builderData, setBuilderData] = useState(null);
  const [selectionData, setSelectionData] = useState(null);
  const [runData, setRunData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [customDraft, setCustomDraft] = useState({ feature_name: '', feature_family: 'custom', formula: '', business_meaning: '' });
  const [builderValidation, setBuilderValidation] = useState(null);
  const [saving, setSaving] = useState('');
  const [loadingState, setLoadingState] = useState({
    overview: false,
    transform: false,
    feature_builder: false,
    feature_selection: false,
    pipeline_run: false,
    summary: false,
  });
  const [loadedAt, setLoadedAt] = useState({});

  const canOpen = Boolean(featureStoreDataset || masterDataset);
  const runJob = runData?.latest_job || null;
  const runStatus = String(runJob?.status || '').trim().toLowerCase();
  const runBusy = ['queued', 'in_progress'].includes(runStatus);
  const stageState = getStageWorkspaceState(workspace, 'preprocess');
  const activeTabLoading = Boolean(loadingState?.[tab]);
  const selectionLoading = Boolean(loadingState?.feature_selection);
  const setTabLoading = useCallback((key, next) => {
    setLoadingState((prev) => ({ ...prev, [key]: next }));
    if (!next) {
      setLoadedAt((prev) => ({ ...prev, [key]: Date.now() }));
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('overview', true);
    try {
      const res = await mlopsApi.mulePreprocessingOverview(pipelineId);
      setOverviewData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('overview', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadTransform = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('transform', true);
    try {
      const res = await mlopsApi.mulePreprocessingTransform(pipelineId);
      setTransformData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('transform', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadBuilder = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('feature_builder', true);
    try {
      const res = await mlopsApi.mulePreprocessingFeatureBuilder(pipelineId);
      setBuilderData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('feature_builder', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadSelection = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('feature_selection', true);
    try {
      const res = await mlopsApi.mulePreprocessingFeatureSelection(pipelineId);
      setSelectionData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('feature_selection', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadRun = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('pipeline_run', true);
    try {
      const res = await mlopsApi.mulePreprocessingPipelineRunStatus(pipelineId);
      setRunData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('pipeline_run', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadSummary = useCallback(async () => {
    if (!pipelineId) return;
    setTabLoading('summary', true);
    try {
      const res = await mlopsApi.mulePreprocessingSummary(pipelineId);
      setSummaryData(res?.data?.data || res?.data || res || null);
    } finally {
      setTabLoading('summary', false);
    }
  }, [pipelineId, setTabLoading]);

  const loadActiveTab = useCallback(async () => {
    if (!pipelineId) return;
    if (tab === 'overview') await loadOverview();
    if (tab === 'transform') await loadTransform();
    if (tab === 'feature_builder') await loadBuilder();
    if (tab === 'feature_selection') await loadSelection();
    if (tab === 'pipeline_run') await loadRun();
    if (tab === 'summary') await loadSummary();
  }, [loadBuilder, loadOverview, loadRun, loadSelection, loadSummary, loadTransform, pipelineId, tab]);

  const refreshAll = useCallback(async () => {
    if (!pipelineId) return;
    setRefreshing(true);
    try {
      await Promise.all([loadOverview(), loadTransform(), loadBuilder(), loadSelection(), loadRun(), loadSummary(), onDatasetsRefresh?.({ sync: true, pipelineId })]);
      setMessage('Reloaded Mule preprocessing workbench state from backend persistence.');
    } catch (error) {
      setMessage(error?.message || 'Could not refresh Mule preprocessing workbench state.');
    } finally {
      setRefreshing(false);
    }
  }, [loadBuilder, loadOverview, loadRun, loadSelection, loadSummary, loadTransform, onDatasetsRefresh, pipelineId]);

  useEffect(() => { loadActiveTab(); }, [loadActiveTab]);

  useEffect(() => {
    if (!pipelineId || !runBusy) return undefined;
    const timer = window.setInterval(() => {
      loadRun();
      loadSummary();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadRun, loadSummary, pipelineId, runBusy]);

  const screenState = useMemo(() => ({ tab }), [tab]);
  useEffect(() => {
    if (!pipelineId) return undefined;
    if (hydrateSkipRef.current) {
      hydrateSkipRef.current = false;
      return undefined;
    }
    const sig = JSON.stringify(screenState);
    if (sig === saveRef.current) return undefined;
    const timer = window.setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, { screen: 'mule_preprocess_workbench', state: screenState }).then(() => { saveRef.current = sig; }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [pipelineId, screenState]);

  const transformColumnPatch = useCallback((columnName, patch) => {
    setTransformData((prev) => {
      const next = { ...(prev || {}) };
      const cfg = { ...((next.transform_config || {}).column_settings || {}) };
      cfg[columnName] = { ...(cfg[columnName] || {}), ...(patch || {}) };
      next.transform_config = { ...(next.transform_config || {}), column_settings: cfg };
      next.column_profiles = (next.column_profiles || []).map((row) => row.column_name === columnName ? { ...row, ...(patch.encoding ? { selected_encoding: patch.encoding } : {}), ...(patch.scaling ? { selected_scaling: patch.scaling } : {}), ...(patch.missing_strategy ? { missing_strategy: patch.missing_strategy } : {}) } : row);
      return next;
    });
  }, []);

  const saveTransform = useCallback(async () => {
    if (!pipelineId || !transformData) return;
    setSaving('transform');
    try {
      const res = await mlopsApi.mulePreprocessingTransform(pipelineId, transformData.transform_config || {});
      setTransformData(res?.data?.data || res?.data || res || null);
      await Promise.all([loadSelection(), loadSummary()]);
      setMessage('Saved transform configuration to backend preprocessing state.');
    } catch (error) {
      setMessage(error?.message || 'Could not save transform configuration.');
    } finally {
      setSaving('');
    }
  }, [loadSelection, loadSummary, pipelineId, transformData]);

  const validateTransform = useCallback(async () => {
    if (!pipelineId || !transformData) return;
    const res = await mlopsApi.mulePreprocessingTransformValidate(pipelineId, transformData.transform_config || {});
    const payload = res?.data?.data || res?.data || res || null;
    setMessage(payload?.valid ? 'Transform configuration validated successfully.' : (payload?.warnings || []).join(' | ') || 'Transform validation returned warnings.');
  }, [pipelineId, transformData]);

  const previewTransform = useCallback(async () => {
    if (!pipelineId) return;
    const res = await mlopsApi.mulePreprocessingTransformPreview(pipelineId);
    setTransformPreview(res?.data?.data || res?.data || res || null);
    setMessage('Loaded transform preview sample from backend.');
  }, [pipelineId]);

  const autoConfigureTransform = useCallback(async () => {
    if (!pipelineId) return;
    setSaving('transform_auto');
    try {
      const res = await mlopsApi.mulePreprocessingTransformAuto(pipelineId, {});
      const payload = res?.data?.data || res?.data || res || null;
      setTransformData(payload);
      await Promise.all([loadSelection(), loadSummary()]);
      setMessage(payload?.message || 'Auto-configured transform rules from backend column classification.');
    } catch (error) {
      setMessage(error?.message || 'Could not auto-configure transform rules.');
    } finally {
      setSaving('');
    }
  }, [loadSelection, loadSummary, pipelineId]);

  const toggleBuiltin = useCallback((featureName, checked) => {
    setBuilderData((prev) => {
      const next = { ...(prev || {}) };
      const existing = new Set(next?.feature_builder?.selected_builtin_features || []);
      if (checked) existing.add(featureName); else existing.delete(featureName);
      next.feature_builder = { ...(next.feature_builder || {}), selected_builtin_features: Array.from(existing) };
      next.builtin_features = (next.builtin_features || []).map((row) => row.feature_name === featureName ? { ...row, selected: checked } : row);
      return next;
    });
  }, []);

  const saveBuilder = useCallback(async () => {
    if (!pipelineId || !builderData) return;
    setSaving('builder');
    try {
      const res = await mlopsApi.mulePreprocessingFeatureBuilder(pipelineId, builderData.feature_builder || {});
      setBuilderData(res?.data?.data || res?.data || res || null);
      await Promise.all([loadSelection(), loadSummary()]);
      setMessage('Saved engineered feature builder state to backend persistence.');
    } catch (error) {
      setMessage(error?.message || 'Could not save feature builder state.');
    } finally {
      setSaving('');
    }
  }, [builderData, loadSelection, loadSummary, pipelineId]);

  const validateCustom = useCallback(async () => {
    if (!pipelineId) return;
    const res = await mlopsApi.mulePreprocessingFeatureBuilderValidate(pipelineId, customDraft);
    const payload = res?.data?.data || res?.data || res || null;
    setBuilderValidation(payload);
    setMessage(payload?.message || 'Custom feature validation completed.');
  }, [customDraft, pipelineId]);

  const addCustomFeature = useCallback(() => {
    if (!customDraft.feature_name || !customDraft.formula) return;
    setBuilderData((prev) => {
      const next = { ...(prev || {}) };
      const custom = [...(next?.feature_builder?.custom_features || [])];
      custom.push(customDraft);
      next.feature_builder = { ...(next.feature_builder || {}), custom_features: custom };
      return next;
    });
    setCustomDraft({ feature_name: '', feature_family: 'custom', formula: '', business_meaning: '' });
  }, [customDraft]);

  const saveSelection = useCallback(async () => {
    if (!pipelineId || !selectionData) return;
    setSaving('selection');
    try {
      const res = await mlopsApi.mulePreprocessingFeatureSelection(pipelineId, selectionData.selection_config || {});
      const payload = res?.data?.data || res?.data || res || null;
      setSelectionData(payload);
      await loadSummary();
      setMessage('Saved feature selection rules to backend persistence.');
    } catch (error) {
      setMessage(error?.message || 'Could not save feature selection rules.');
    } finally {
      setSaving('');
    }
  }, [loadSummary, pipelineId, selectionData]);

  const changeSelectionMethod = useCallback((key, checked) => {
    setSelectionData((prev) => ({ ...(prev || {}), selection_config: { ...(prev?.selection_config || {}), methods: { ...((prev?.selection_config || {}).methods || {}), [key]: checked } } }));
  }, []);

  const startPipelineRun = useCallback(async () => {
    if (!pipelineId) return;
    setSaving('run');
    try {
      const res = await mlopsApi.mulePreprocessingPipelineRunStart(pipelineId, {});
      setRunData(res?.data?.data || res?.data || res || null);
      setTab('pipeline_run');
      setMessage('Started Mule preprocessing pipeline run.');
    } catch (error) {
      setMessage(error?.message || 'Could not start Mule preprocessing pipeline run.');
    } finally {
      setSaving('');
    }
  }, [pipelineId]);

  const retryPipelineRun = useCallback(async () => {
    if (!pipelineId) return;
    const res = await mlopsApi.mulePreprocessingPipelineRunRetry(pipelineId, {});
    setRunData(res?.data?.data || res?.data || res || null);
    setMessage('Retried Mule preprocessing pipeline run.');
  }, [pipelineId]);

  const cancelPipelineRun = useCallback(async () => {
    if (!pipelineId) return;
    const res = await mlopsApi.mulePreprocessingPipelineRunCancel(pipelineId, {});
    setRunData(res?.data?.data || res?.data || res || null);
    setMessage('Marked the preprocessing pipeline run as cancelled/stale.');
  }, [pipelineId]);

  const sendToModel = useCallback(async () => {
    await onDatasetsRefresh?.({ sync: true, pipelineId });
    onStepAdvance?.('model');
  }, [onDatasetsRefresh, onStepAdvance, pipelineId]);

  const selectedFeatureCount = (summaryData?.selected_features || selectionData?.selected_features || []).length;
  const headerSourceLabel = overviewData?.dataset_ready
    ? (overviewData?.dataset_summary?.dataset_type || 'feature_store')
    : featureStoreDataset
      ? 'feature_store'
      : masterDataset
        ? 'master_dataset'
        : 'awaiting_feature_store';
  const headerRows = fmt(overviewData?.dataset_summary?.row_count || featureStoreDataset?.row_count || masterDataset?.row_count);
  const headerColumns = fmt(overviewData?.dataset_summary?.column_count || 0);
  const headerStatus = stageState?.status || runJob?.status || summaryData?.traceability?.build_status || 'not_started';
  const statusTone = String(message || '').toLowerCase().includes('could not') ? '#B42318' : '#475467';
  const activeLoadedAt = loadedAt?.[tab];
  const activeLoadedLabel = activeLoadedAt ? new Date(activeLoadedAt).toLocaleTimeString() : '';
  const summaryReady = Boolean(
    summaryData?.latest_run?.dataset_id
    || (summaryData?.artifacts || []).some((artifact) => {
      return String(artifact?.artifact_type || '').trim().toLowerCase() === 'preprocess_dataset_csv'
        && Boolean(artifact?.metadata?.dataset_id || artifact?.metadata?.run_id);
    })
  );

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Paper variant="outlined" sx={{ ...panelSx, p: 1.25 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) auto' }, gap: 1, alignItems: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85, flexWrap: 'wrap' }}>
              <WorkbenchStatusBadge status={headerStatus} />
              <Chip size="small" label={`Input ${headerSourceLabel}`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FBFCFE', color: '#475467', border: '1px solid rgba(15,23,42,0.10)' }} />
              <Chip size="small" label={`${headerRows} rows`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FBFCFE', color: '#475467', border: '1px solid rgba(15,23,42,0.10)' }} />
              <Chip size="small" label={`${headerColumns} columns`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FBFCFE', color: '#475467', border: '1px solid rgba(15,23,42,0.10)' }} />
              <Chip size="small" label={`${fmt(selectedFeatureCount)} selected`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FBFCFE', color: '#475467', border: '1px solid rgba(15,23,42,0.10)' }} />
              {activeTabLoading ? (
                <Chip size="small" icon={<CircularProgress size={12} sx={{ color: '#C65A11 !important' }} />} label={`Loading ${tab.replace(/_/g, ' ')}`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FFF7ED', color: '#C65A11', border: '1px solid rgba(198,90,17,0.20)' }} />
              ) : null}
            </Box>
            {message ? (
              <Typography sx={{ fontSize: 12, color: statusTone, mt: 0.85 }}>
                {message}
              </Typography>
            ) : null}
            {!activeTabLoading && activeLoadedLabel ? (
              <Typography sx={{ fontSize: 11.5, color: '#667085', mt: message ? 0.4 : 0.75 }}>
                Backend state last loaded at {activeLoadedLabel}.
              </Typography>
            ) : null}
            {(!canOpen || overviewData?.dataset_ready === false) ? (
              <Typography sx={{ fontSize: 12, color: '#9A3412', mt: 0.75 }}>
                {overviewData?.message || 'Preprocessing is waiting for the persisted selected Feature Store artifact for this run.'}
              </Typography>
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', xl: 'flex-end' } }}>
            <Button variant="outlined" startIcon={refreshing ? <CircularProgress size={15} /> : <Refresh />} onClick={refreshAll} disabled={refreshing} sx={{ textTransform: 'none', borderRadius: 0 }}>
              Refresh
            </Button>
            {tab === 'pipeline_run' ? (
              <Button variant="contained" onClick={startPipelineRun} disabled={runBusy || saving === 'run'} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
                {runBusy ? 'Running...' : 'Start Pipeline Run'}
              </Button>
            ) : null}
          </Box>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ ...panelSx, px: 1.25 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 44, '& .MuiTabs-indicator': { backgroundColor: '#C65A11', height: 2 }, '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontSize: 13, fontWeight: 700, color: '#667085', px: 1.5 }, '& .Mui-selected': { color: '#101828' } }}>
          {TABS.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
        </Tabs>
      </Paper>

      {tab === 'overview' ? <MulePreprocessingDataOverviewTab data={overviewData} /> : null}
      {tab === 'transform' ? <MulePreprocessingTransformTab data={transformData} preview={transformPreview} onColumnConfigChange={transformColumnPatch} onSave={saveTransform} onValidate={validateTransform} onPreview={previewTransform} onAutoConfigure={autoConfigureTransform} saving={saving === 'transform'} autoBusy={saving === 'transform_auto'} /> : null}
      {tab === 'feature_builder' ? <MulePreprocessingFeatureBuilderTab data={builderData} customDraft={customDraft} onBuiltinToggle={toggleBuiltin} onDraftChange={(patch) => setCustomDraft((prev) => ({ ...prev, ...(patch || {}) }))} onValidateCustom={validateCustom} onAddCustom={addCustomFeature} validation={builderValidation} onSave={saveBuilder} saving={saving === 'builder'} /> : null}
      {tab === 'feature_selection' ? <MulePreprocessingFeatureSelectionTab data={selectionData} methods={selectionData?.selection_config?.methods || {}} onMethodsChange={changeSelectionMethod} onSave={saveSelection} saving={saving === 'selection'} loading={selectionLoading} /> : null}
      {tab === 'pipeline_run' ? <MulePreprocessingPipelineRunTab data={runData} running={runBusy || saving === 'run'} onStart={startPipelineRun} onRetry={retryPipelineRun} onCancel={cancelPipelineRun} /> : null}
      {tab === 'summary' ? <MulePreprocessingSummaryTab data={summaryData} onSendToModel={sendToModel} disabled={!summaryReady} /> : null}
    </Box>
  );
}
