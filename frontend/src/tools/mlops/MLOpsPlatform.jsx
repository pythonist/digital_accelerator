import React, { useEffect, useMemo, useState } from 'react';
import { Box, Alert } from '@mui/material';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import MLOpsWorkbench from './screens/MLOpsWorkbench';
import AutoPipelineScreen from './AutoPipeline/AutoPipelineScreen';
import mlopsApi from './services/mlopsApi';

const PIPELINE_ARTEFACT_TYPES = new Set([
  'master_dataset', 'master', 'preprocessed_dataset', 'preprocessed',
  'model_output', 'model_dataset', 'scored_dataset', 'feature_store',
]);

const RUN_ROUTE_STEP_IDS = new Set([
  'data',
  'master',
  'target',
  'eda',
  'preprocess',
  'model',
  'validation',
  'registry',
  'dashboard',
  'reports',
  'pipelines',
]);

const normalizeRouteRunId = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeRouteStepId = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'data_upload') return 'data';
  if (raw === 'ready') return 'registry';
  return RUN_ROUTE_STEP_IDS.has(raw) ? raw : '';
};

const WorkbenchRouteShell = ({ datasets, masterDataset, routeGlobalView = '' }) => {
  const { runId, stepId } = useParams();
  const routeRunId = useMemo(() => normalizeRouteRunId(runId), [runId]);
  const routeStepId = useMemo(() => normalizeRouteStepId(stepId), [stepId]);

  return (
    <MLOpsWorkbench
      routeRunId={routeRunId}
      routeStepId={routeStepId}
      routeGlobalView={routeGlobalView}
      renderAutoBuild={(workbenchContext = {}) => (
        <AutoPipelineScreen
          datasets={datasets}
          masterDataset={masterDataset}
          {...workbenchContext}
        />
      )}
    />
  );
};

const RunIndexRedirect = () => {
  const { runId } = useParams();
  const normalizedRunId = normalizeRouteRunId(runId);
  if (!normalizedRunId) {
    return <Navigate to="/mlops/runs" replace />;
  }
  return <Navigate to={`/mlops/runs/${normalizedRunId}/pipelines`} replace />;
};

const MLOpsPlatform = () => {
  const { activeEnv } = useAppContext();
  const [datasets, setDatasets] = useState([]);
  const [masterDataset, setMasterDataset] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!activeEnv) return;
      try {
        const payload = await mlopsApi.listDatasets();
        if (!mounted) return;
        const all = Array.isArray(payload?.data) ? payload.data : [];
        const raw = Array.isArray(payload?.raw)
          ? payload.raw
          : all.filter((d) => !PIPELINE_ARTEFACT_TYPES.has(String(d?.dataset_type || '').toLowerCase()));
        const artefacts = Array.isArray(payload?.artefacts)
          ? payload.artefacts
          : all.filter((d) => PIPELINE_ARTEFACT_TYPES.has(String(d?.dataset_type || '').toLowerCase()));
        const master =
          artefacts.find((d) => d?.dataset_type === 'master_dataset') ||
          artefacts.find((d) => String(d?.dataset_type || '').startsWith('master')) ||
          raw[0] || null;
        setDatasets(raw);
        setMasterDataset(master);
      } catch {
        if (!mounted) return;
        setDatasets([]);
        setMasterDataset(null);
      }
    };
    load();
    return () => { mounted = false; };
  }, [activeEnv]);

  if (!activeEnv) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">Please select an environment first.</Alert>
      </Box>
    );
  }

  // MLOpsWorkbench owns the entire chrome bar including the mode toggle buttons.
  // AutoPipelineScreen is injected as a render prop so the workbench can
  // display it when AutoBuild mode is selected.
  return (
    <Box sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Routes>
        <Route index element={<Navigate to="runs" replace />} />
        <Route path="runs" element={<WorkbenchRouteShell datasets={datasets} masterDataset={masterDataset} />} />
        <Route path="runs/:runId" element={<RunIndexRedirect />} />
        <Route path="runs/:runId/:stepId" element={<WorkbenchRouteShell datasets={datasets} masterDataset={masterDataset} />} />
        <Route path="registry" element={<WorkbenchRouteShell datasets={datasets} masterDataset={masterDataset} routeGlobalView="registry" />} />
        <Route path="*" element={<Navigate to="runs" replace />} />
      </Routes>
    </Box>
  );
};

export default MLOpsPlatform;
