import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
} from '@mui/material';
import { Refresh, Psychology } from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';
import {
  MuleStageHeader,
} from './MuleWorkbenchChrome';
import MuleModelValidationTab from './mule_model_workbench/MuleModelValidationTab';
import MuleModelSupervisedTab from './mule_model_workbench/MuleModelSupervisedTab';
import MuleModelSequenceTab from './mule_model_workbench/MuleModelSequenceTab';
import MuleModelGraphTab from './mule_model_workbench/MuleModelGraphTab';
import MuleModelTuningTab from './mule_model_workbench/MuleModelTuningTab';
import MuleModelEvaluationTab from './mule_model_workbench/MuleModelEvaluationTab';
import MuleModelExplainabilityTab from './mule_model_workbench/MuleModelExplainabilityTab';
import MuleModelChampionTab from './mule_model_workbench/MuleModelChampionTab';
import MuleModelDecisionPolicyTab from './mule_model_workbench/MuleModelDecisionPolicyTab';
import MuleModelRunSummaryTab from './mule_model_workbench/MuleModelRunSummaryTab';

const TABS = [
  { id: 'validation', label: 'Validation Check' },
  { id: 'supervised', label: 'Supervised Models' },
  { id: 'sequence', label: 'Sequence Models' },
  { id: 'graph', label: 'Graph Algorithms' },
  { id: 'tuning', label: 'Hyperparameter Tuning' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'explainability', label: 'Explainability' },
  { id: 'champion', label: 'Champion vs Challenger' },
  { id: 'policy', label: 'Decision Policy' },
];

const fmt = (value) => Number(value || 0).toLocaleString();

export default function MuleModelBuildScreen({
  activePipelineId,
  activePipelineName,
  workspace = null,
  preprocessedDataset = null,
  featureStoreDataset = null,
  onDatasetsRefresh,
  onModelComplete,
  onStepAdvance,
}) {
  const pipelineId = Number(activePipelineId || 0);
  const [tab, setTab] = useState('validation');
  const [validationData, setValidationData] = useState(null);
  const [supervisedData, setSupervisedData] = useState(null);
  const [sequenceData, setSequenceData] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [tuningData, setTuningData] = useState(null);
  const [evaluationData, setEvaluationData] = useState(null);
  const [explainabilityData, setExplainabilityData] = useState(null);
  const [championData, setChampionData] = useState(null);
  const [policyData, setPolicyData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState({ tone: 'info', message: '' });

  const pickErrorMessage = useCallback((error, fallback) => {
    return error?.response?.data?.error
      || error?.response?.data?.message
      || error?.message
      || fallback;
  }, []);

  const loadSummary = useCallback(async () => {
    if (!pipelineId) return;
    const response = await mlopsApi.muleModelSummary(pipelineId);
    const payload = response?.data?.data || response?.data || response || null;
    setSummaryData(payload);
    const persistedTab = String(payload?.config?.current_tab || '').trim().toLowerCase();
    if (persistedTab && TABS.some((item) => item.id === persistedTab)) {
      setTab((current) => (current === 'validation' ? persistedTab : current));
    }
  }, [pipelineId]);

  const loadTab = useCallback(async (nextTab) => {
    if (!pipelineId) return;
    if (nextTab === 'validation') {
      const response = await mlopsApi.muleModelValidationCheck(pipelineId);
      setValidationData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'supervised') {
      const response = await mlopsApi.muleModelSupervised(pipelineId);
      setSupervisedData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'sequence') {
      const response = await mlopsApi.muleModelSequence(pipelineId);
      setSequenceData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'graph') {
      const response = await mlopsApi.muleModelGraph(pipelineId);
      setGraphData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'tuning') {
      const response = await mlopsApi.muleModelTuning(pipelineId);
      setTuningData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'evaluation') {
      const response = await mlopsApi.muleModelEvaluation(pipelineId);
      setEvaluationData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'explainability') {
      const response = await mlopsApi.muleModelExplainability(pipelineId);
      setExplainabilityData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'champion') {
      const response = await mlopsApi.muleModelChampion(pipelineId);
      setChampionData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'policy') {
      const response = await mlopsApi.muleModelPolicy(pipelineId);
      setPolicyData(response?.data?.data || response?.data || response || null);
    } else if (nextTab === 'summary') {
      await loadSummary();
    }
  }, [loadSummary, pipelineId]);

  useEffect(() => {
    loadSummary();
    loadTab('validation');
  }, [loadSummary, loadTab]);

  useEffect(() => {
    loadTab(tab);
  }, [loadTab, tab]);

  const saveValidation = useCallback(async (payload) => {
    setBusy('validation');
    try {
      await mlopsApi.muleModelValidationCheck(pipelineId, payload);
      await Promise.all([loadTab('validation'), loadSummary()]);
      setStatus({ tone: 'success', message: 'Saved validation target/split settings.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not save validation settings.') });
    } finally {
      setBusy('');
    }
  }, [loadSummary, loadTab, pickErrorMessage, pipelineId]);

  const saveSupervised = useCallback(async (payload) => {
    setBusy('supervised');
    try {
      await mlopsApi.muleModelSupervised(pipelineId, payload);
      await Promise.all([loadTab('supervised'), loadSummary()]);
      setStatus({ tone: 'success', message: 'Saved model-selection settings.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not save model-selection settings.') });
    } finally {
      setBusy('');
    }
  }, [loadSummary, loadTab, pickErrorMessage, pipelineId]);

  const saveSequence = useCallback(async (payload) => {
    setBusy('sequence');
    try {
      await mlopsApi.muleModelSequence(pipelineId, payload);
      await loadTab('sequence');
      setStatus({ tone: 'success', message: 'Saved sequence-track settings.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not save sequence-track settings.') });
    } finally {
      setBusy('');
    }
  }, [loadTab, pickErrorMessage, pipelineId]);

  const saveGraph = useCallback(async (payload) => {
    setBusy('graph');
    try {
      await mlopsApi.muleModelGraph(pipelineId, payload);
      await loadTab('graph');
      setStatus({ tone: 'success', message: 'Saved graph-track settings.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not save graph-track settings.') });
    } finally {
      setBusy('');
    }
  }, [loadTab, pickErrorMessage, pipelineId]);

  const saveTuning = useCallback(async (payload) => {
    setBusy('tuning');
    try {
      await mlopsApi.muleModelTuning(pipelineId, payload);
      await loadTab('tuning');
      const isCvRun = String(payload?.action || '').toLowerCase() === 'run_cv';
      setStatus({ tone: 'success', message: isCvRun ? 'Cross-validation tuning completed. Review the CV Results tab.' : 'Saved hyperparameter settings.' });
    } catch (error) {
      const isCvRun = String(payload?.action || '').toLowerCase() === 'run_cv';
      setStatus({ tone: 'error', message: pickErrorMessage(error, isCvRun ? 'Cross-validation tuning failed.' : 'Could not save hyperparameter settings.') });
    } finally {
      setBusy('');
    }
  }, [loadTab, pickErrorMessage, pipelineId]);

  const savePolicy = useCallback(async (payload) => {
    setBusy('policy');
    try {
      await mlopsApi.muleModelPolicy(pipelineId, payload);
      await loadTab('policy');
      setStatus({ tone: 'success', message: 'Saved decision-policy settings.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not save decision-policy settings.') });
    } finally {
      setBusy('');
    }
  }, [loadTab, pickErrorMessage, pipelineId]);

  const trainWorkbench = useCallback(async () => {
    if (!pipelineId) return;
    setBusy('train');
    try {
      const response = await mlopsApi.muleModelWorkbenchTrain(pipelineId, {});
      const payload = response?.data?.data || response?.data || response || null;
      onModelComplete?.(payload);
      await onDatasetsRefresh?.({ sync: true, pipelineId });
      await Promise.all([
        loadSummary(),
        loadTab('supervised'),
        loadTab('evaluation'),
        loadTab('explainability'),
        loadTab('champion'),
        loadTab('policy'),
      ]);
      setTab('evaluation');
      setStatus({ tone: 'success', message: 'Model training completed and run artifacts were persisted.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Model training failed. Check Validation Check and Supervised Models for target/split/model settings.') });
    } finally {
      setBusy('');
    }
  }, [loadSummary, loadTab, onDatasetsRefresh, onModelComplete, pickErrorMessage, pipelineId]);

  const promoteChampion = useCallback(async (runId) => {
    if (!pipelineId || !runId) return;
    setBusy('champion');
    try {
      await mlopsApi.muleModelChampion(pipelineId, { run_id: runId });
      await Promise.all([loadTab('champion'), loadSummary()]);
      setStatus({ tone: 'success', message: `Promoted run ${runId} as champion.` });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not promote champion run.') });
    } finally {
      setBusy('');
    }
  }, [loadSummary, loadTab, pickErrorMessage, pipelineId]);

  const refreshAll = useCallback(async () => {
    setBusy('refresh');
    try {
      await Promise.all([loadSummary(), loadTab(tab)]);
      setStatus({ tone: 'info', message: 'Refreshed model-build state from backend persistence.' });
    } catch (error) {
      setStatus({ tone: 'error', message: pickErrorMessage(error, 'Could not refresh model-build state.') });
    } finally {
      setBusy('');
    }
  }, [loadSummary, loadTab, pickErrorMessage, tab]);

  const headerMetrics = useMemo(() => {
    const datasetSummary = validationData?.dataset_summary || {};
    const typologyTraining = validationData?.typology_training || {};
    const latest = summaryData?.latest_run || {};
    const summary = latest.summary || {};
    const datasetType = String(datasetSummary.dataset_type || '').trim().toLowerCase();
    const trainingDatasetLabel = datasetType
      ? datasetType.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : preprocessedDataset?.row_count
      ? 'Preprocessed Dataset'
      : featureStoreDataset?.row_count
      ? 'Feature Store'
      : 'Pending';
    return [
      { label: 'Training Dataset', value: trainingDatasetLabel, helper: 'Model Build uses the latest persisted upstream dataset.', emphasize: true },
      { label: 'Rows', value: fmt(summary.dataset_rows || datasetSummary.row_count || preprocessedDataset?.row_count || featureStoreDataset?.row_count), helper: 'Rows currently in model-build scope.' },
      { label: 'Columns', value: fmt(datasetSummary.column_count || preprocessedDataset?.columns?.length || featureStoreDataset?.columns?.length), helper: 'Columns currently loaded for validation and training.' },
      { label: 'Target', value: summary.target_column || validationData?.target_definition?.derived_name || 'Pending', helper: 'Resolved multiclass training target.' },
      { label: 'Typology Labels', value: fmt(typologyTraining.labeled_rows), helper: typologyTraining.ready ? 'Enough labelled typology rows are available for client-facing category prediction.' : 'Client-facing Mule category prediction is blocked until labelled typology coverage improves.' },
    ];
  }, [featureStoreDataset?.columns?.length, featureStoreDataset?.row_count, preprocessedDataset?.columns?.length, preprocessedDataset?.row_count, summaryData, validationData]);
  const hasCompletedRun = Boolean(summaryData?.latest_run?.run_id);
  const outputReady = Boolean(summaryData?.latest_run?.artifacts?.scored_output_path);

  return (
    <Stack spacing={2}>
      <MuleStageHeader
        title="Model Build"
        description="Use the persisted preprocessing output to configure the Mule model, train supervised and sequence tracks, and move directly into final results once a governed run is ready."
        workspace={workspace}
        stepId="model"
        metrics={headerMetrics}
        showHeading={false}
        showRunControl={false}
        actions={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" startIcon={busy === 'refresh' ? <CircularProgress size={16} /> : <Refresh />} onClick={refreshAll} sx={{ textTransform: 'none', borderRadius: 0 }}>
              Refresh
            </Button>
            {hasCompletedRun ? (
              <Button variant="outlined" onClick={() => onStepAdvance?.('validation')} sx={{ textTransform: 'none', borderRadius: 0 }}>
                {outputReady ? 'Open Final Results' : 'Open Output Stage'}
              </Button>
            ) : null}
            {tab === 'supervised' ? (
              <Button variant="contained" startIcon={busy === 'train' ? <CircularProgress size={16} color="inherit" /> : <Psychology />} onClick={trainWorkbench} disabled={busy === 'train' || !validationData?.ready_for_training} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
                {busy === 'train' ? 'Training...' : 'Run Multiclass Training'}
              </Button>
            ) : null}
          </Stack>
        )}
      />
      {status.message ? (
        <Alert severity={status.tone === 'success' ? 'success' : status.tone === 'error' ? 'error' : 'info'} sx={{ borderRadius: 0 }}>
          {status.message}
        </Alert>
      ) : null}

      <Box sx={{ borderBottom: '1px solid rgba(16,24,40,0.12)' }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontSize: 12.5, fontWeight: 700 } }}>
          {TABS.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
        </Tabs>
      </Box>

      {tab === 'validation' ? <MuleModelValidationTab data={validationData} onSave={saveValidation} saving={busy === 'validation'} /> : null}
      {tab === 'supervised' ? <MuleModelSupervisedTab data={supervisedData} onSave={saveSupervised} onTrain={trainWorkbench} training={busy === 'train'} /> : null}
      {tab === 'sequence' ? <MuleModelSequenceTab data={sequenceData} onSave={saveSequence} saving={busy === 'sequence'} /> : null}
      {tab === 'graph' ? <MuleModelGraphTab data={graphData} onSave={saveGraph} saving={busy === 'graph'} /> : null}
      {tab === 'tuning' ? <MuleModelTuningTab data={tuningData} onSave={saveTuning} saving={busy === 'tuning'} /> : null}
      {tab === 'evaluation' ? <MuleModelEvaluationTab data={evaluationData} /> : null}
      {tab === 'explainability' ? <MuleModelExplainabilityTab data={explainabilityData} /> : null}
      {tab === 'champion' ? <MuleModelChampionTab data={championData} onPromote={promoteChampion} promoting={busy === 'champion'} /> : null}
      {tab === 'policy' ? <MuleModelDecisionPolicyTab data={policyData} onSave={savePolicy} saving={busy === 'policy'} /> : null}
      <MuleModelRunSummaryTab data={summaryData} disabled={!outputReady} onAdvance={() => onStepAdvance?.('validation')} />
    </Stack>
  );
}
