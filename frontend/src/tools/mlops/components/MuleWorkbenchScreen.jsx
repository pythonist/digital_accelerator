import React, { useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowForward } from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';
import MuleDataUploadScreen from './MuleDataUploadScreen';
import MuleMasterDatasetScreen from './MuleMasterDatasetScreen';
import MuleFeatureStoreScreen from './MuleFeatureStoreScreen';
import MulePreprocessingStudioScreen from './MulePreprocessingStudioScreen';
import MuleModelBuildScreen from './MuleModelBuildScreen';
import MuleModelOutputScreen from './MuleModelOutputScreen';

const MULE_SOURCE_TYPES = [
  'accounts',
  'customers',
  'transactions',
  'counterparties',
  'device_logs',
  'external_signals',
  'graph_nodes',
  'graph_edges',
  'account_daily_summary',
  'mule_labels',
  'mule_typology',
];

const STEP_TITLES = {
  data: 'Upload Data',
  master: 'Master Dataset',
  featurestore: 'Feature Store',
  preprocess: 'Preprocessing & Feature Selection',
  model: 'Model Build',
  validation: 'Model Output & Validation',
};

const NEXT_STEP = {
  data: 'master',
  master: 'featurestore',
  featurestore: 'preprocess',
  preprocess: 'model',
  model: 'validation',
};

const safeJson = (value, fallback = {}) => (value && typeof value === 'object' ? value : fallback);
const signature = (value) => JSON.stringify(value ?? {});

function usePersistedScreenState(pipelineId, screen, state, enabled = true) {
  const signatureRef = useRef('');
  const inFlightRef = useRef('');
  const timerRef = useRef(null);

  useEffect(() => {
    const pid = Number(pipelineId || 0);
    if (!enabled || !Number.isFinite(pid) || pid <= 0 || !screen) return undefined;
    const nextSignature = signature(state);
    if (nextSignature === signatureRef.current || nextSignature === inFlightRef.current) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      inFlightRef.current = nextSignature;
      mlopsApi.pipelineSaveScreenState(pid, { screen, state })
        .then(() => { signatureRef.current = nextSignature; })
        .catch(() => {})
        .finally(() => {
          if (inFlightRef.current === nextSignature) inFlightRef.current = '';
        });
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, pipelineId, screen, state]);
}

const STEP_REQUIREMENTS = {
  data: 'Upload at least one Mule source before continuing.',
  master: 'Build the Mule master dataset before continuing to preprocessing.',
  featurestore: 'Generate the Mule feature store after the master dataset is built.',
  preprocess: 'Run preprocessing and save a model-ready dataset before opening Model Studio.',
  model: 'Train or resume a Mule model run before opening Model Output & Validation.',
};

const StepFooter = ({ activeStep, canAdvance, blockReason, onStepAdvance }) => {
  const nextStep = NEXT_STEP[activeStep];
  if (!nextStep || !onStepAdvance || activeStep === 'featurestore' || activeStep === 'preprocess' || activeStep === 'model') return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2.5, bgcolor: '#FBFCFE', borderColor: 'rgba(21,27,39,0.10)' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ md: 'center' }}>
        <Typography sx={{ fontSize: 13, color: '#556070' }}>
          {canAdvance
            ? <>When you are satisfied with this stage, continue to <strong>{STEP_TITLES[nextStep]}</strong>.</>
            : (blockReason || STEP_REQUIREMENTS[activeStep] || 'Complete this stage before continuing.')}
        </Typography>
        <Button
          variant="contained"
          endIcon={<ArrowForward />}
          onClick={() => onStepAdvance(nextStep)}
          disabled={!canAdvance}
          sx={{ textTransform: 'none', bgcolor: '#D04A02' }}
        >
          Continue to {STEP_TITLES[nextStep]}
        </Button>
      </Stack>
    </Paper>
  );
};

const MuleWorkbenchScreen = ({
  persona = 'technical',
  activeStep,
  activePipelineId,
  activePipelineName,
  activePipelineMeta,
  muleBackendStatus = null,
  datasets = [],
  masterDataset = null,
  featureStoreDataset = null,
  preprocessedDataset = null,
  targetColumn = '',
  preprocessPlan = [],
  preprocessSteps = [],
  preprocessPreview = null,
  modelRun = null,
  onDatasetsRefresh,
  onBuildComplete,
  onFeatureStoreComplete,
  onPreprocessStepsChange,
  onPreprocessPreview,
  onPreprocessRun,
  onModelComplete,
  onOpenReport,
  modelActiveTab = 0,
  onModelActiveTabChange,
  onPipelineActivated,
  onStepAdvance,
}) => {
  const pipelineId = Number(activePipelineId || 0);
  const sourceDatasetOptions = useMemo(
    () => (datasets || []).filter((dataset) => MULE_SOURCE_TYPES.includes(String(dataset?.dataset_type || '').trim().toLowerCase())),
    [datasets],
  );
  const workspace = muleBackendStatus?.workspace || null;
  const backendDataLoaded = Number(muleBackendStatus?.data?.sources_loaded || 0) > 0;
  const backendMasterBuilt = String(muleBackendStatus?.master?.build_status || '').trim().toLowerCase() === 'built';
  const backendFeatureStoreReady = ['ready', 'generated', 'built'].includes(
    String(
      muleBackendStatus?.featurestore?.generation_status
      || muleBackendStatus?.featurestore?.feature_store_status
      || '',
    ).trim().toLowerCase(),
  );
  const backendPreprocessBuilt = String(muleBackendStatus?.preprocess?.build_status || '').trim().toLowerCase() === 'built';
  const backendModelReady = Boolean(muleBackendStatus?.model?.latest_run?.run_id || modelRun?.run_id || modelRun?.job_id);
  const canAdvance = useMemo(() => {
    switch (activeStep) {
      case 'data':
        return sourceDatasetOptions.length > 0 || backendDataLoaded;
      case 'master':
        return Boolean(masterDataset) || backendMasterBuilt;
      case 'featurestore':
        return Boolean(featureStoreDataset) || backendFeatureStoreReady;
      case 'preprocess':
        return Boolean(preprocessedDataset) || backendPreprocessBuilt;
      case 'model':
        return backendModelReady;
      default:
        return true;
    }
  }, [
    activeStep,
    backendDataLoaded,
    backendFeatureStoreReady,
    backendMasterBuilt,
    backendModelReady,
    backendPreprocessBuilt,
    featureStoreDataset,
    masterDataset,
    preprocessedDataset,
    sourceDatasetOptions.length,
  ]);
  const blockReason = useMemo(() => {
    if (canAdvance) return '';
    switch (activeStep) {
      case 'data':
        return 'Upload the Mule sources for this run first so the analytical dataset can be assembled from real account, customer, transaction, and network data.';
      case 'master':
        return 'The analytical base table is still not built. Stay on Master Dataset, review the assembly, and build it before moving into the Feature Store.';
      case 'featurestore':
        return 'The Mule feature store has not been generated yet. Generate and review the stored feature library before moving into preprocessing and feature selection.';
      case 'preprocess':
        return 'Preprocessing has not produced a saved model-ready dataset yet. Run the governed preprocessing and feature selection workbench first so the model studio has an approved input.';
      case 'model':
        return 'No Mule training run has completed yet. Train or restore a model run before opening Model Output & Validation.';
      default:
        return '';
    }
  }, [activeStep, canAdvance]);

  usePersistedScreenState(
    pipelineId,
    `mule_${activeStep}`,
    {
      current_screen: activeStep,
      source_dataset_ids: sourceDatasetOptions
        .map((dataset) => Number(dataset?.dataset_id))
        .filter((value) => Number.isFinite(value) && value > 0),
    },
    pipelineId > 0,
  );
  const dataScreen = (
    <MuleDataUploadScreen
      activePipelineId={pipelineId}
      datasets={datasets}
      onDatasetsRefresh={onDatasetsRefresh}
    />
  );

  let content = dataScreen;
  if (activeStep === 'master') {
    content = (
      <MuleMasterDatasetScreen
        activePipelineId={pipelineId}
        activePipelineMeta={activePipelineMeta}
        datasets={datasets}
        onDatasetsRefresh={onDatasetsRefresh}
        onBuildComplete={onBuildComplete}
      />
    );
  } else if (activeStep === 'featurestore') {
    content = (
      <MuleFeatureStoreScreen
        activePipelineId={pipelineId}
        activePipelineName={activePipelineName}
        workspace={workspace}
        masterDataset={masterDataset}
        featureStoreDataset={featureStoreDataset}
        onDatasetsRefresh={onDatasetsRefresh}
        onFeatureStoreComplete={onFeatureStoreComplete}
        onStepAdvance={onStepAdvance}
      />
    );
  } else if (activeStep === 'preprocess') {
    content = (
      <MulePreprocessingStudioScreen
        persona={persona}
        activePipelineId={pipelineId}
        activePipelineName={activePipelineName}
        workspace={workspace}
        datasets={datasets}
        masterDataset={masterDataset}
        featureStoreDataset={featureStoreDataset}
        preprocessedDataset={preprocessedDataset}
        targetColumn={targetColumn}
        suggestions={preprocessPlan}
        steps={preprocessSteps}
        preview={preprocessPreview}
        onStepsChange={onPreprocessStepsChange}
        onPreview={onPreprocessPreview}
        onRun={onPreprocessRun}
        onPipelineActivated={onPipelineActivated}
        onDatasetsRefresh={onDatasetsRefresh}
        onFeatureStoreComplete={onFeatureStoreComplete}
        onStepAdvance={onStepAdvance}
      />
    );
  } else if (activeStep === 'model') {
    content = (
      <MuleModelBuildScreen
        persona={persona}
        activePipelineId={pipelineId}
        activePipelineName={activePipelineName}
        workspace={workspace}
        masterDataset={masterDataset}
        featureStoreDataset={featureStoreDataset}
        preprocessedDataset={preprocessedDataset}
        targetColumn={targetColumn}
        modelRun={modelRun}
        onModelComplete={onModelComplete}
        onOpenReport={onOpenReport}
        initialActiveTab={modelActiveTab}
        onActiveTabChange={onModelActiveTabChange}
        onDatasetsRefresh={onDatasetsRefresh}
        onStepAdvance={onStepAdvance}
      />
    );
  } else if (activeStep === 'validation') {
    content = <MuleModelOutputScreen activePipelineId={pipelineId} workspace={workspace} />;
  }

  return (
    <>
      <Stack spacing={2.25}>
        {content}
        <StepFooter activeStep={activeStep} canAdvance={canAdvance} blockReason={blockReason} onStepAdvance={onStepAdvance} />
      </Stack>
    </>
  );
};

export default MuleWorkbenchScreen;
