import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Analytics,
  AutoGraph,
  CompareArrows,
  Hub,
  Insights,
  ModelTraining,
  Settings,
  TableChart,
  Timeline,
} from '@mui/icons-material';

import { WorkbenchMetricGrid, WorkbenchSection } from './MuleWorkbenchChrome';

const TABS = [
  { id: 'configure', label: 'Configure', Icon: Settings },
  { id: 'tuning', label: 'Hyperparameters', Icon: Insights },
  { id: 'train', label: 'Train', Icon: ModelTraining },
  { id: 'evaluate', label: 'Evaluate', Icon: Analytics },
  { id: 'compare', label: 'Compare Runs', Icon: CompareArrows },
  { id: 'ledger', label: 'Scoring Ledger', Icon: TableChart },
  { id: 'report', label: 'Run Report', Icon: Timeline },
];

const TRACKS = [
  { id: 'supervised', label: 'Binary Mule Risk', helper: 'Primary mule vs non-mule supervised track.' },
  { id: 'typology', label: 'Mule Typology', helper: 'Multi-class M1-M5 category modelling track.' },
  { id: 'anomaly', label: 'Anomaly Overlay', helper: 'Unsupervised anomaly and outlier scoring.' },
  { id: 'sequence', label: 'Sequence Models', helper: 'Hazard, HMM, LSTM, and Transformer sequence tracks.' },
  { id: 'graph', label: 'Graph / Ring Analytics', helper: 'Ring structure, device-sharing, fan-in/out, and path analytics.' },
];

const ALGORITHM_GROUPS = {
  supervised: [
    { id: 'logistic_regression', label: 'Logistic Regression', family: 'Interpretable baseline', speed: 'Fast' },
    { id: 'random_forest', label: 'Random Forest', family: 'Tree ensemble', speed: 'Medium' },
    { id: 'gradient_boosting', label: 'Gradient Boosting', family: 'Boosted trees', speed: 'Medium' },
    { id: 'xgboost', label: 'XGBoost', family: 'Boosted trees', speed: 'Medium' },
    { id: 'lightgbm', label: 'LightGBM', family: 'Boosted trees', speed: 'Fast' },
    { id: 'hist_gradient_boosting', label: 'HistGradientBoosting', family: 'Histogram boosting', speed: 'Fast' },
    { id: 'extra_trees', label: 'Extra Trees', family: 'Randomised trees', speed: 'Fast' },
    { id: 'adaboost', label: 'AdaBoost', family: 'Boosting', speed: 'Medium' },
    { id: 'decision_tree', label: 'Decision Tree', family: 'Explainable tree', speed: 'Fast' },
    { id: 'linear_svm', label: 'Linear SVM', family: 'Margin classifier', speed: 'Medium' },
    { id: 'knn', label: 'KNN', family: 'Distance-based', speed: 'Medium' },
    { id: 'naive_bayes', label: 'Naive Bayes', family: 'Probabilistic', speed: 'Fast' },
    { id: 'catboost', label: 'CatBoost', family: 'Categorical boosting', speed: 'Medium' },
    { id: 'mlp_classifier', label: 'MLP Classifier', family: 'Neural network', speed: 'Slow' },
    { id: 'soft_voting_ensemble', label: 'Soft Voting Ensemble', family: 'Hybrid ensemble', speed: 'Slow' },
    { id: 'stacking_ensemble', label: 'Stacking Ensemble', family: 'Meta ensemble', speed: 'Slow' },
  ],
  typology: [
    { id: 'random_forest', label: 'Random Forest', family: 'Multi-class ensemble', speed: 'Medium' },
    { id: 'xgboost', label: 'XGBoost', family: 'Multi-class boosting', speed: 'Medium' },
    { id: 'lightgbm', label: 'LightGBM', family: 'Multi-class boosting', speed: 'Fast' },
    { id: 'extra_trees', label: 'Extra Trees', family: 'Randomised ensemble', speed: 'Fast' },
    { id: 'logistic_regression', label: 'Multinomial Logistic Regression', family: 'Interpretable baseline', speed: 'Fast' },
    { id: 'catboost', label: 'CatBoost', family: 'Categorical boosting', speed: 'Medium' },
  ],
  anomaly: [
    { id: 'isolation_forest', label: 'Isolation Forest', family: 'Tree anomaly', speed: 'Fast' },
    { id: 'local_outlier_factor', label: 'Local Outlier Factor', family: 'Density anomaly', speed: 'Medium' },
    { id: 'one_class_svm', label: 'One-Class SVM', family: 'Boundary anomaly', speed: 'Slow' },
    { id: 'kmeans', label: 'K-Means', family: 'Cluster anomaly', speed: 'Fast' },
    { id: 'gaussian_mixture', label: 'Gaussian Mixture', family: 'Soft clustering', speed: 'Medium' },
    { id: 'dbscan', label: 'DBSCAN', family: 'Density clustering', speed: 'Medium' },
    { id: 'agglomerative_clustering', label: 'Agglomerative Clustering', family: 'Hierarchy clustering', speed: 'Slow' },
    { id: 'tabular_autoencoder', label: 'Tabular Autoencoder', family: 'Neural anomaly', speed: 'Slow' },
  ],
  sequence: [
    { id: 'hazard', label: 'Hazard / Logistic Survival', family: 'Temporal risk transition', speed: 'Fast' },
    { id: 'hmm', label: 'Hidden Markov Model', family: 'Sequence anomaly', speed: 'Medium' },
    { id: 'lstm', label: 'LSTM', family: 'Neural sequence', speed: 'Slow' },
    { id: 'transformer', label: 'Transformer', family: 'Attention sequence', speed: 'Slow' },
  ],
  graph: [
    { id: 'connected_components', label: 'Connected Components', family: 'Cluster structure', speed: 'Fast' },
    { id: 'cycle_detection', label: 'Cycle Detection', family: 'Circular flow', speed: 'Fast' },
    { id: 'shared_device_clusters', label: 'Shared Device Clusters', family: 'Infrastructure linkage', speed: 'Fast' },
    { id: 'shared_beneficiary_clusters', label: 'Shared Beneficiary Clusters', family: 'Beneficiary linkage', speed: 'Fast' },
    { id: 'fan_in_out_analysis', label: 'Fan-In / Fan-Out', family: 'Flow concentration', speed: 'Medium' },
    { id: 'pagerank_centrality', label: 'Centrality Metrics', family: 'Network importance', speed: 'Medium' },
    { id: 'suspicious_path_motifs', label: 'Suspicious Path Motifs', family: 'Pattern search', speed: 'Medium' },
    { id: 'hop_distance_to_suspects', label: 'Hop Distance to Known Suspects', family: 'Propagation proximity', speed: 'Fast' },
  ],
};

const PARAM_DEFS = {
  logistic_regression: [
    { key: 'C', label: 'Regularisation C', min: 0.1, max: 5, step: 0.1, default: 1 },
    { key: 'max_iter', label: 'Max iterations', min: 100, max: 3000, step: 100, default: 1000 },
  ],
  random_forest: [
    { key: 'n_estimators', label: 'Trees', min: 100, max: 1000, step: 50, default: 400 },
    { key: 'max_depth', label: 'Max depth', min: 3, max: 24, step: 1, default: 12 },
    { key: 'min_samples_leaf', label: 'Min samples leaf', min: 1, max: 20, step: 1, default: 4 },
  ],
  gradient_boosting: [
    { key: 'n_estimators', label: 'Boosting rounds', min: 100, max: 800, step: 25, default: 300 },
    { key: 'learning_rate', label: 'Learning rate', min: 0.01, max: 0.3, step: 0.01, default: 0.08 },
    { key: 'max_depth', label: 'Max depth', min: 2, max: 8, step: 1, default: 4 },
  ],
  xgboost: [
    { key: 'n_estimators', label: 'Boosting rounds', min: 100, max: 1200, step: 50, default: 500 },
    { key: 'learning_rate', label: 'Learning rate', min: 0.01, max: 0.3, step: 0.01, default: 0.05 },
    { key: 'max_depth', label: 'Max depth', min: 2, max: 12, step: 1, default: 6 },
    { key: 'subsample', label: 'Row subsample', min: 0.4, max: 1, step: 0.05, default: 0.8 },
  ],
  lightgbm: [
    { key: 'n_estimators', label: 'Boosting rounds', min: 100, max: 1200, step: 50, default: 500 },
    { key: 'learning_rate', label: 'Learning rate', min: 0.01, max: 0.3, step: 0.01, default: 0.05 },
    { key: 'num_leaves', label: 'Num leaves', min: 16, max: 256, step: 8, default: 64 },
  ],
  hist_gradient_boosting: [
    { key: 'max_iter', label: 'Iterations', min: 100, max: 1200, step: 50, default: 400 },
    { key: 'learning_rate', label: 'Learning rate', min: 0.01, max: 0.3, step: 0.01, default: 0.05 },
    { key: 'max_depth', label: 'Max depth', min: 2, max: 12, step: 1, default: 6 },
  ],
  extra_trees: [
    { key: 'n_estimators', label: 'Trees', min: 100, max: 1000, step: 50, default: 500 },
    { key: 'max_depth', label: 'Max depth', min: 3, max: 24, step: 1, default: 14 },
  ],
  catboost: [
    { key: 'iterations', label: 'Iterations', min: 100, max: 1200, step: 50, default: 500 },
    { key: 'learning_rate', label: 'Learning rate', min: 0.01, max: 0.3, step: 0.01, default: 0.05 },
    { key: 'depth', label: 'Tree depth', min: 3, max: 12, step: 1, default: 6 },
  ],
  isolation_forest: [
    { key: 'n_estimators', label: 'Trees', min: 100, max: 800, step: 50, default: 300 },
    { key: 'contamination', label: 'Contamination', min: 0.01, max: 0.4, step: 0.01, default: 0.08 },
  ],
  local_outlier_factor: [
    { key: 'n_neighbors', label: 'Neighbors', min: 5, max: 100, step: 1, default: 25 },
    { key: 'contamination', label: 'Contamination', min: 0.01, max: 0.4, step: 0.01, default: 0.08 },
  ],
  one_class_svm: [
    { key: 'nu', label: 'Nu', min: 0.01, max: 0.5, step: 0.01, default: 0.08 },
    { key: 'gamma', label: 'Gamma', min: 0.001, max: 1, step: 0.001, default: 0.05 },
  ],
  kmeans: [
    { key: 'n_clusters', label: 'Clusters', min: 2, max: 20, step: 1, default: 6 },
  ],
  gaussian_mixture: [
    { key: 'n_components', label: 'Components', min: 2, max: 20, step: 1, default: 6 },
  ],
  dbscan: [
    { key: 'eps', label: 'EPS radius', min: 0.1, max: 5, step: 0.1, default: 0.8 },
    { key: 'min_samples', label: 'Min samples', min: 2, max: 30, step: 1, default: 8 },
  ],
  agglomerative_clustering: [
    { key: 'n_clusters', label: 'Clusters', min: 2, max: 20, step: 1, default: 6 },
  ],
  tabular_autoencoder: [
    { key: 'epochs', label: 'Epochs', min: 10, max: 200, step: 5, default: 50 },
    { key: 'latent_dim', label: 'Latent dimension', min: 4, max: 128, step: 4, default: 24 },
  ],
  hazard: [
    { key: 'lookahead_days', label: 'Prediction horizon days', min: 7, max: 90, step: 1, default: 30 },
  ],
  hmm: [
    { key: 'n_components', label: 'Hidden states', min: 2, max: 12, step: 1, default: 5 },
  ],
  lstm: [
    { key: 'epochs', label: 'Epochs', min: 5, max: 100, step: 5, default: 20 },
    { key: 'hidden_dim', label: 'Hidden dimension', min: 16, max: 256, step: 16, default: 64 },
  ],
  transformer: [
    { key: 'epochs', label: 'Epochs', min: 5, max: 100, step: 5, default: 20 },
    { key: 'd_model', label: 'Model width', min: 16, max: 256, step: 16, default: 64 },
  ],
};

const fmt = (value) => Number(value || 0).toLocaleString();
const toLabel = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const cardButtonSx = {
  textTransform: 'none',
  borderRadius: 2,
  fontWeight: 700,
  boxShadow: 'none',
};

function AlgorithmCard({ item, selected, primary, onToggle, onPrimary }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 2.5,
        bgcolor: selected ? '#FFF7ED' : '#FFFFFF',
        borderColor: selected ? 'rgba(198,90,17,0.26)' : 'rgba(16,24,40,0.10)',
      }}
    >
      <Stack spacing={0.9}>
        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#101828' }}>{item.label}</Typography>
            <Typography sx={{ fontSize: 12, color: '#667085', mt: 0.2 }}>{item.family}</Typography>
          </Box>
          <Chip size="small" label={item.speed} sx={{ height: 22, fontWeight: 700 }} />
        </Stack>
        <Stack direction="row" spacing={0.75}>
          <Button
            size="small"
            variant={selected ? 'contained' : 'outlined'}
            onClick={onToggle}
            sx={{ ...cardButtonSx, bgcolor: selected ? '#C65A11' : undefined, '&:hover': { bgcolor: selected ? '#A64B12' : undefined } }}
          >
            {selected ? 'Selected' : 'Select'}
          </Button>
          <Button
            size="small"
            variant={primary ? 'contained' : 'outlined'}
            onClick={onPrimary}
            disabled={!selected}
            sx={{ ...cardButtonSx, bgcolor: primary ? '#111827' : undefined, '&:hover': { bgcolor: primary ? '#111827' : undefined } }}
          >
            {primary ? 'Primary' : 'Set Primary'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function MuleModelWorkbenchPanel({
  activePipelineName,
  workspace = null,
  trainingDataset = null,
  targetColumn = '',
  modelStatus = null,
  onConfigChange,
  onTrain,
  training = false,
  onOpenReport,
}) {
  const config = modelStatus?.config || {};
  const recentRuns = asArray(modelStatus?.recent_runs);
  const latestRun = modelStatus?.latest_run || recentRuns[0] || null;

  const [activeTab, setActiveTab] = useState(String(config.studio_tab || 'configure'));
  const [focusedAlgorithm, setFocusedAlgorithm] = useState(String(config.supervised_algorithm || 'lightgbm'));
  const [hyperDraft, setHyperDraft] = useState(() => config.hyperparameters || {});
  const [leftRunId, setLeftRunId] = useState('');
  const [rightRunId, setRightRunId] = useState('');

  useEffect(() => {
    setHyperDraft(config.hyperparameters || {});
    if (config.supervised_algorithm) setFocusedAlgorithm(String(config.supervised_algorithm));
    if (config.studio_tab) setActiveTab(String(config.studio_tab));
  }, [config.hyperparameters, config.studio_tab, config.supervised_algorithm]);

  useEffect(() => {
    if (!leftRunId && recentRuns[0]?.run_id) setLeftRunId(String(recentRuns[0].run_id));
    if (!rightRunId && recentRuns[1]?.run_id) setRightRunId(String(recentRuns[1].run_id));
  }, [leftRunId, recentRuns, rightRunId]);

  const selectedAlgorithms = useMemo(() => ({
    supervised: asArray(config.supervised_algorithms).length ? config.supervised_algorithms : [config.supervised_algorithm || 'lightgbm'],
    typology: asArray(config.typology_algorithms).length ? config.typology_algorithms : (config.typology_algorithm ? [config.typology_algorithm] : ['random_forest']),
    anomaly: asArray(config.anomaly_algorithms).length ? config.anomaly_algorithms : (config.anomaly_enabled === false ? [] : ['isolation_forest']),
    sequence: asArray(config.sequence_algorithms).length ? config.sequence_algorithms : ['hazard', 'hmm'],
    graph: asArray(config.graph_analytics).length ? config.graph_analytics : (config.graph_enabled === false ? [] : ['shared_device_clusters', 'cycle_detection']),
  }), [config]);

  const selectedCount = Object.values(selectedAlgorithms).reduce((sum, items) => sum + asArray(items).length, 0);
  const tuningConfig = config.tuning || {};
  const focusParams = PARAM_DEFS[focusedAlgorithm] || [];
  const leftRun = recentRuns.find((run) => String(run.run_id) === String(leftRunId)) || null;
  const rightRun = recentRuns.find((run) => String(run.run_id) === String(rightRunId)) || null;
  const workspaceArtifacts = asArray(workspace?.artifacts).filter((artifact) => String(artifact.stage_name || '').toLowerCase() === 'model_build');

  const summaryMetrics = [
    { label: 'Algorithms Shortlisted', value: fmt(selectedCount), helper: 'Selected across supervised, typology, anomaly, sequence, and graph tracks.' },
    { label: 'Primary Supervised', value: toLabel(config.supervised_algorithm || 'lightgbm'), helper: 'Primary model used for the next backend train action.' },
    { label: 'Recent Runs', value: fmt(recentRuns.length), helper: 'Persisted model-build runs available for comparison.' },
    { label: 'Dataset Rows', value: fmt(trainingDataset?.row_count), helper: 'Rows currently available to model build.' },
  ];

  const toggleAlgorithm = (trackId, algoId) => {
    const current = asArray(selectedAlgorithms[trackId]);
    const exists = current.includes(algoId);
    const next = exists ? current.filter((item) => item !== algoId) : [...current, algoId];
    const patch = {};
    if (trackId === 'supervised') {
      patch.supervised_algorithms = next;
      patch.supervised_algorithm = next[0] || '';
    } else if (trackId === 'typology') {
      patch.typology_algorithms = next;
      patch.typology_algorithm = next[0] || '';
    } else if (trackId === 'anomaly') {
      patch.anomaly_algorithms = next;
      patch.anomaly_enabled = next.length > 0;
    } else if (trackId === 'sequence') {
      patch.sequence_algorithms = next;
    } else if (trackId === 'graph') {
      patch.graph_analytics = next;
      patch.graph_enabled = next.length > 0;
    }
    onConfigChange?.(patch, `Updated ${TRACKS.find((track) => track.id === trackId)?.label || trackId} algorithms.`);
    if (!exists) setFocusedAlgorithm(algoId);
  };

  const setPrimaryAlgorithm = (trackId, algoId) => {
    const current = asArray(selectedAlgorithms[trackId]);
    const reordered = [algoId, ...current.filter((item) => item !== algoId)];
    const patch = {};
    if (trackId === 'supervised') {
      patch.supervised_algorithms = reordered;
      patch.supervised_algorithm = algoId;
    } else if (trackId === 'typology') {
      patch.typology_algorithms = reordered;
      patch.typology_algorithm = algoId;
    }
    onConfigChange?.(patch, `Updated primary ${trackId} algorithm to ${toLabel(algoId)}.`);
    setFocusedAlgorithm(algoId);
  };

  const updateDraftParam = (algoId, key, value) => {
    setHyperDraft((prev) => ({
      ...(prev || {}),
      [algoId]: {
        ...(prev?.[algoId] || {}),
        [key]: value,
      },
    }));
  };

  const saveHyperparameters = () => {
    onConfigChange?.({ hyperparameters: hyperDraft }, `Saved hyperparameters for ${toLabel(focusedAlgorithm)}.`);
  };

  const renderConfigure = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid items={summaryMetrics} />
      {TRACKS.map((track) => (
        <WorkbenchSection
          key={track.id}
          title={track.label}
          description={track.helper}
          action={<Chip size="small" label={`${asArray(selectedAlgorithms[track.id]).length} selected`} />}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
            {(ALGORITHM_GROUPS[track.id] || []).map((item) => {
              const selected = asArray(selectedAlgorithms[track.id]).includes(item.id);
              const primary = asArray(selectedAlgorithms[track.id])[0] === item.id;
              return (
                <AlgorithmCard
                  key={`${track.id}_${item.id}`}
                  item={item}
                  selected={selected}
                  primary={primary}
                  onToggle={() => toggleAlgorithm(track.id, item.id)}
                  onPrimary={() => setPrimaryAlgorithm(track.id, item.id)}
                />
              );
            })}
          </Box>
        </WorkbenchSection>
      ))}
    </Stack>
  );

  const renderTuning = () => (
    <Stack spacing={1.5}>
      <WorkbenchSection
        title="Tuning Controls"
        description="Borrowing the FCC workbench style, Mule now exposes hyperparameter and search controls instead of one-click training only."
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '320px minmax(0, 1fr)' }, gap: 1.5 }}>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828' }}>Search Strategy</Typography>
              <Select
                size="small"
                value={String(tuningConfig.search_strategy || 'manual')}
                onChange={(event) => onConfigChange?.({
                  tuning: { ...tuningConfig, search_strategy: String(event.target.value) },
                }, 'Updated model search strategy.')}
              >
                <MenuItem value="manual">Manual tuning</MenuItem>
                <MenuItem value="grid_search">Grid search</MenuItem>
                <MenuItem value="random_search">Random search</MenuItem>
                <MenuItem value="bayesian">Bayesian search</MenuItem>
              </Select>
              <TextField
                size="small"
                type="number"
                label="CV folds"
                value={Number(tuningConfig.cv_folds || 5)}
                onChange={(event) => onConfigChange?.({
                  tuning: { ...tuningConfig, cv_folds: Number(event.target.value || 5) },
                }, 'Updated cross-validation folds.')}
              />
              <TextField
                size="small"
                type="number"
                label="Max trials"
                value={Number(tuningConfig.max_trials || 20)}
                onChange={(event) => onConfigChange?.({
                  tuning: { ...tuningConfig, max_trials: Number(event.target.value || 20) },
                }, 'Updated tuning trial budget.')}
              />
              <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.65 }}>
                Current focus algorithm: <strong>{toLabel(focusedAlgorithm)}</strong>. Pick any selected algorithm below to tune its parameters.
              </Typography>
            </Stack>
          </Paper>
          <Stack spacing={1.25}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 1 }}>Selected Algorithms</Typography>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                {Object.entries(selectedAlgorithms).flatMap(([trackId, items]) => items.map((algoId) => (
                  <Chip
                    key={`${trackId}_${algoId}`}
                    label={`${toLabel(algoId)} • ${toLabel(trackId)}`}
                    onClick={() => setFocusedAlgorithm(algoId)}
                    color={focusedAlgorithm === algoId ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer', bgcolor: focusedAlgorithm === algoId ? '#C65A11' : undefined, color: focusedAlgorithm === algoId ? '#fff' : undefined }}
                  />
                )))}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 1 }}>
                {toLabel(focusedAlgorithm)} Hyperparameters
              </Typography>
              {focusParams.length ? (
                <Stack spacing={2}>
                  {focusParams.map((param) => {
                    const value = Number(hyperDraft?.[focusedAlgorithm]?.[param.key] ?? param.default);
                    return (
                      <Box key={param.key}>
                        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>{param.label}</Typography>
                          <Typography sx={{ fontSize: 12.5, color: '#667085' }}>{value}</Typography>
                        </Stack>
                        <Slider
                          value={value}
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          onChange={(_, nextValue) => updateDraftParam(focusedAlgorithm, param.key, nextValue)}
                          sx={{ color: '#C65A11' }}
                        />
                      </Box>
                    );
                  })}
                  <Button variant="contained" onClick={saveHyperparameters} sx={{ width: 'fit-content', textTransform: 'none', bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
                    Save Hyperparameters
                  </Button>
                </Stack>
              ) : (
                <Alert severity="info">No explicit parameter editor is defined yet for this algorithm. The selection is still saved into the Mule run configuration.</Alert>
              )}
            </Paper>
          </Stack>
        </Box>
      </WorkbenchSection>
    </Stack>
  );

  const renderTrain = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Training Rows', value: fmt(trainingDataset?.row_count), helper: 'Current training dataset row count.' },
          { label: 'Target', value: targetColumn || 'mule_flag', helper: 'Configured supervised target column.' },
          { label: 'Primary Model', value: toLabel(config.supervised_algorithm || 'lightgbm'), helper: 'Model used when Train is triggered.' },
          { label: 'Track Count', value: fmt(TRACKS.filter((track) => asArray(selectedAlgorithms[track.id]).length > 0).length), helper: 'Number of active modelling tracks.' },
        ]}
      />
      <WorkbenchSection
        title="Training Plan"
        description="The backend train action uses the primary supervised algorithm plus the current Mule run configuration, while the rest of the selected algorithms act as governed shortlist and challenger setup for subsequent runs."
        action={(
          <Button
            variant="contained"
            startIcon={<ModelTraining />}
            onClick={onTrain}
            disabled={training}
            sx={{ textTransform: 'none', bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}
          >
            {training ? 'Training...' : 'Train Mule Workbench'}
          </Button>
        )}
      >
        <Stack spacing={1.1}>
          {TRACKS.map((track) => (
            <Paper key={track.id} variant="outlined" sx={{ p: 1.1, borderRadius: 2, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>{track.label}</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.3 }}>
                {asArray(selectedAlgorithms[track.id]).length
                  ? asArray(selectedAlgorithms[track.id]).map((algoId) => toLabel(algoId)).join(', ')
                  : 'No algorithms selected for this track.'}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </WorkbenchSection>
    </Stack>
  );

  const renderEvaluate = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Latest Run', value: latestRun?.run_id || 'Not trained', helper: 'Most recent persisted model-build run.' },
          { label: 'PR-AUC', value: latestRun?.metrics?.supervised?.pr_auc != null ? Number(latestRun.metrics.supervised.pr_auc).toFixed(3) : 'N/A', helper: 'Primary precision-recall metric.' },
          { label: 'F1', value: latestRun?.metrics?.supervised?.f1 != null ? Number(latestRun.metrics.supervised.f1).toFixed(3) : 'N/A', helper: 'Thresholded evaluation measure.' },
          { label: 'Top-N Capture', value: latestRun?.metrics?.supervised?.top_n_capture != null ? Number(latestRun.metrics.supervised.top_n_capture).toFixed(3) : 'N/A', helper: 'Operational capture measure.' },
        ]}
      />
      <WorkbenchSection title="Champion Snapshot" description="This is the Mule-specific equivalent of the FCC evaluate stage: a clean summary of latest run quality, typology posture, and graph/ring support.">
        {latestRun ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Run Summary</Typography>
              <Stack spacing={0.7}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Run id: <strong>{latestRun.run_id}</strong></Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Output table: <strong>{latestRun.output_table_name || 'N/A'}</strong></Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Typology enabled: <strong>{latestRun.typology_enabled ? 'Yes' : 'No'}</strong></Typography>
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Scoring Quality</Typography>
              <Stack spacing={0.7}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>PR-AUC: <strong>{latestRun.metrics?.supervised?.pr_auc != null ? Number(latestRun.metrics.supervised.pr_auc).toFixed(3) : 'N/A'}</strong></Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>F1: <strong>{latestRun.metrics?.supervised?.f1 != null ? Number(latestRun.metrics.supervised.f1).toFixed(3) : 'N/A'}</strong></Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Top-N capture: <strong>{latestRun.metrics?.supervised?.top_n_capture != null ? Number(latestRun.metrics.supervised.top_n_capture).toFixed(3) : 'N/A'}</strong></Typography>
              </Stack>
            </Paper>
          </Box>
        ) : (
          <Alert severity="info">Train at least one Mule model run to populate the evaluation workspace.</Alert>
        )}
      </WorkbenchSection>
    </Stack>
  );

  const renderCompare = () => (
    <Stack spacing={1.5}>
      <WorkbenchSection title="Run Comparison" description="Select two persisted runs and compare them side by side, similar to the FCC run comparison workflow.">
        {recentRuns.length > 1 ? (
          <Stack spacing={1.25}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <Select size="small" value={leftRunId} onChange={(event) => setLeftRunId(String(event.target.value))} sx={{ minWidth: 220 }}>
                {recentRuns.map((run) => <MenuItem key={`left_${run.run_id}`} value={String(run.run_id)}>Run {run.run_id}</MenuItem>)}
              </Select>
              <Select size="small" value={rightRunId} onChange={(event) => setRightRunId(String(event.target.value))} sx={{ minWidth: 220 }}>
                {recentRuns.map((run) => <MenuItem key={`right_${run.run_id}`} value={String(run.run_id)}>Run {run.run_id}</MenuItem>)}
              </Select>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
              {[leftRun, rightRun].map((run, index) => (
                <Paper key={index} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
                  {run ? (
                    <Stack spacing={0.75}>
                      <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>Run {run.run_id}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Output: <strong>{run.output_table_name || 'N/A'}</strong></Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>PR-AUC: <strong>{run.metrics?.supervised?.pr_auc != null ? Number(run.metrics.supervised.pr_auc).toFixed(3) : 'N/A'}</strong></Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>F1: <strong>{run.metrics?.supervised?.f1 != null ? Number(run.metrics.supervised.f1).toFixed(3) : 'N/A'}</strong></Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Top-N capture: <strong>{run.metrics?.supervised?.top_n_capture != null ? Number(run.metrics.supervised.top_n_capture).toFixed(3) : 'N/A'}</strong></Typography>
                    </Stack>
                  ) : (
                    <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Select a run to compare.</Typography>
                  )}
                </Paper>
              ))}
            </Box>
          </Stack>
        ) : (
          <Alert severity="info">At least two persisted Mule runs are needed before run comparison becomes available.</Alert>
        )}
      </WorkbenchSection>
    </Stack>
  );

  const renderLedger = () => (
    <Stack spacing={1.5}>
      <WorkbenchSection title="Scoring Ledger" description="This is the analyst-facing run ledger: what was trained, what was persisted, and what is available for downstream validation and investigation.">
        {recentRuns.length ? (
          <Stack spacing={1}>
            {recentRuns.map((run) => (
              <Paper key={run.run_id} variant="outlined" sx={{ p: 1.15, borderRadius: 2.25 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#101828' }}>Run {run.run_id}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.25 }}>
                      {run.output_table_name || 'Persisted model output'} • PR-AUC {run.metrics?.supervised?.pr_auc != null ? Number(run.metrics.supervised.pr_auc).toFixed(3) : 'N/A'} • F1 {run.metrics?.supervised?.f1 != null ? Number(run.metrics.supervised.f1).toFixed(3) : 'N/A'}
                    </Typography>
                  </Box>
                  <Chip size="small" label={run.typology_enabled ? 'Typology on' : 'Binary only'} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">No scoring ledger entries are available yet.</Alert>
        )}
      </WorkbenchSection>
    </Stack>
  );

  const renderReport = () => (
    <Stack spacing={1.5}>
      <WorkbenchSection
        title="Run Report"
        description="Model bundle, training configuration, and registered artifacts are summarized here for validation handoff."
        action={(
          <Button
            variant="outlined"
            onClick={() => latestRun?.run_id && onOpenReport?.(latestRun.run_id)}
            disabled={!latestRun?.run_id}
            sx={{ textTransform: 'none' }}
          >
            Open Full Report
          </Button>
        )}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Configuration Summary</Typography>
            <Stack spacing={0.7}>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Pipeline: <strong>{activePipelineName || 'Current Mule run'}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Primary algorithm: <strong>{toLabel(config.supervised_algorithm || 'lightgbm')}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Selected algorithms: <strong>{selectedCount}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Search strategy: <strong>{toLabel(tuningConfig.search_strategy || 'manual')}</strong></Typography>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Registered Artifacts</Typography>
            <Stack spacing={0.75}>
              {workspaceArtifacts.length ? workspaceArtifacts.slice(0, 6).map((artifact) => (
                <Typography key={`${artifact.artifact_id}_${artifact.artifact_type}`} sx={{ fontSize: 12.5, color: '#667085' }}>
                  <strong>{toLabel(artifact.artifact_type)}</strong>: {artifact.storage_ref || 'Registered in backend artifact registry'}
                </Typography>
              )) : (
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>No model-build artifacts are registered yet.</Typography>
              )}
            </Stack>
          </Paper>
        </Box>
      </WorkbenchSection>
    </Stack>
  );

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.35, bgcolor: '#FCFCFD', borderBottom: '1px solid rgba(16,24,40,0.08)' }}>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#101828' }}>Mule Model Workbench</Typography>
          <Typography sx={{ fontSize: 13, color: '#667085', mt: 0.35, lineHeight: 1.7 }}>
            This workbench extends the Mule frontend with a broader algorithm catalog, track-based model design, hyperparameter tuning, and run comparison using the FCC model studio as a reference and the Mule production package as capability guidance.
          </Typography>
        </Box>
        <Tabs
          value={activeTab}
          onChange={(_, nextTab) => {
            setActiveTab(nextTab);
            onConfigChange?.({ studio_tab: nextTab });
          }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 1,
            '& .MuiTabs-indicator': { bgcolor: '#C65A11', height: 3, borderRadius: 999 },
            '& .MuiTab-root': { textTransform: 'none', minHeight: 52, color: '#667085' },
            '& .Mui-selected': { color: '#101828' },
          }}
        >
          {TABS.map(({ id, label, Icon }) => (
            <Tab
              key={id}
              value={id}
              icon={<Icon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label={<Typography sx={{ fontSize: 13, fontWeight: 700 }}>{label}</Typography>}
            />
          ))}
        </Tabs>
      </Paper>

      {activeTab === 'configure' && renderConfigure()}
      {activeTab === 'tuning' && renderTuning()}
      {activeTab === 'train' && renderTrain()}
      {activeTab === 'evaluate' && renderEvaluate()}
      {activeTab === 'compare' && renderCompare()}
      {activeTab === 'ledger' && renderLedger()}
      {activeTab === 'report' && renderReport()}

      <Divider />
      <Alert severity="info" icon={<AutoGraph />}>
        Mule-specific advanced tracks now exposed in the frontend include graph/ring analytics, typology modelling, anomaly overlays, and sequence models. The backend train endpoint still executes the primary supervised run plus persisted config, so challenger algorithms are now stored as run design state and compared across persisted runs.
      </Alert>
    </Stack>
  );
}
