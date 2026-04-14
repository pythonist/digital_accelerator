import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  AccountTree,
  Hub,
  Insights,
  PlayArrow,
  Refresh,
} from '@mui/icons-material';
import ForceGraph2D from 'react-force-graph-2d';

import mlopsApi from '../services/mlopsApi';
import {
  MuleStageHeader,
  WorkbenchMetricGrid,
  WorkbenchSection,
} from './MuleWorkbenchChrome';

const RESULT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'multiclass', label: 'Multiclass Results' },
  { id: 'sequence', label: 'Sequence Results' },
  { id: 'graph', label: 'Graph Results' },
  { id: 'accounts', label: 'Scored Accounts' },
];

const CATEGORY_KEYS = ['pass_through_mule', 'layering_mule', 'cash_out_mule', 'recruiter_mule', 'M1', 'M2', 'M3', 'M4', 'M5'];
const CATEGORY_LABELS = {
  pass_through_mule: 'Pass-Through',
  layering_mule: 'Layering',
  cash_out_mule: 'Cash-Out',
  recruiter_mule: 'Recruiter',
  M1: 'M1',
  M2: 'M2',
  M3: 'M3',
  M4: 'M4',
  M5: 'M5',
};

const asProbability = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const safeJson = (value, fallback) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatCategoryLabel = (value) => CATEGORY_LABELS[value] || String(value || 'Unclassified').replace(/_/g, ' ');

const extractCategoryProbabilities = (row = {}) => {
  const fromJson = safeJson(row.category_probabilities_json || row.typology_probabilities_json || row.category_probabilities, {});
  const entries = [];
  const pushEntry = (key, rawValue) => {
    const probability = asProbability(rawValue);
    if (!key || !Number.isFinite(probability)) return;
    entries.push({
      key: String(key),
      label: formatCategoryLabel(key),
      probability,
    });
  };

  if (fromJson && typeof fromJson === 'object' && !Array.isArray(fromJson)) {
    Object.entries(fromJson).forEach(([key, value]) => pushEntry(key, value));
  }

  Object.entries(row || {}).forEach(([key, value]) => {
    const lowered = String(key || '').trim().toLowerCase();
    if (!lowered.startsWith('category_prob_')) return;
    pushEntry(String(key).slice('category_prob_'.length), value);
  });

  CATEGORY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(row || {}, key)) pushEntry(key, row[key]);
  });

  const deduped = new Map();
  entries.forEach((entry) => {
    const existing = deduped.get(entry.key);
    if (!existing || entry.probability > existing.probability) deduped.set(entry.key, entry);
  });

  const resolved = Array.from(deduped.values()).sort((left, right) => right.probability - left.probability);
  if (!resolved.length && row.predicted_mule_category) {
    return [{
      key: String(row.predicted_mule_category),
      label: formatCategoryLabel(row.predicted_mule_category),
      probability: asProbability(row.typology_confidence || row.model_confidence || 0),
    }];
  }
  return resolved;
};

const summarizeCategoryMix = (rows = []) => {
  const aggregate = new Map();
  let rowsWithCategories = 0;
  rows.forEach((row) => {
    const probabilities = extractCategoryProbabilities(row);
    if (!probabilities.length) return;
    rowsWithCategories += 1;
    probabilities.forEach((item) => {
      const current = aggregate.get(item.key) || { key: item.key, label: item.label, total: 0, count: 0, topRankCount: 0 };
      current.total += item.probability;
      current.count += 1;
      aggregate.set(item.key, current);
    });
    const top = probabilities[0];
    if (top) {
      const current = aggregate.get(top.key);
      if (current) current.topRankCount += 1;
    }
  });
  return Array.from(aggregate.values())
    .map((item) => ({
      ...item,
      avgProbability: item.count ? item.total / item.count : 0,
      topRankShare: rowsWithCategories ? item.topRankCount / rowsWithCategories : 0,
    }))
    .sort((left, right) => right.topRankCount - left.topRankCount || right.avgProbability - left.avgProbability);
};

const ProbabilityList = ({ items = [], compact = false }) => {
  if (!items.length) {
    return (
      <Typography sx={{ fontSize: compact ? 12 : 12.5, color: '#667085' }}>
        Category probabilities will appear here once typology predictions are available.
      </Typography>
    );
  }
  return (
    <Stack spacing={compact ? 0.75 : 1}>
      {items.map((item) => (
        <Box key={item.key}>
          <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.4 }}>
            <Typography sx={{ fontSize: compact ? 12 : 12.5, fontWeight: 700, color: '#101828' }}>
              {item.label}
            </Typography>
            <Typography sx={{ fontSize: compact ? 12 : 12.5, color: '#667085' }}>
              {(item.probability * 100).toFixed(1)}%
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={item.probability * 100}
            sx={{
              height: compact ? 7 : 8,
              borderRadius: 999,
              bgcolor: 'rgba(21,27,39,0.08)',
              '& .MuiLinearProgress-bar': { bgcolor: '#C65A11' },
            }}
          />
        </Box>
      ))}
    </Stack>
  );
};

const RowPreview = ({ row }) => {
  const probabilities = extractCategoryProbabilities(row);
  const topCategory = probabilities[0] || null;
  return (
    <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#FFFFFF' }}>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#101828' }}>
              {row.account_id || row.row_id || 'Sample account'}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.35 }}>
              Predicted category: <strong>{topCategory?.label || row.predicted_mule_category || row.predicted_mule_typology || 'Not enabled'}</strong>
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'repeat(3, minmax(110px, 1fr))' }, gap: 0.8, minWidth: { md: 330 } }}>
            <Paper variant="outlined" sx={{ p: 0.9, borderRadius: 0, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 11, color: '#98A2B3', textTransform: 'uppercase', letterSpacing: 0.55 }}>Risk score</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>{Number(row.mule_risk_score || 0).toFixed(3)}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 0.9, borderRadius: 0, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 11, color: '#98A2B3', textTransform: 'uppercase', letterSpacing: 0.55 }}>Risk band</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>{row.risk_band || 'N/A'}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 0.9, borderRadius: 0, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 11, color: '#98A2B3', textTransform: 'uppercase', letterSpacing: 0.55 }}>Graph cluster</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>{row.graph_cluster_id || 'None'}</Typography>
            </Paper>
          </Box>
        </Stack>
        <ProbabilityList items={probabilities.slice(0, 4)} compact />
        <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
          Supporting signals: <strong>{row.supporting_signals || 'Not available'}</strong>
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: '#101828', lineHeight: 1.65 }}>
          {row.investigator_explanation || 'No investigator explanation available yet.'}
        </Typography>
      </Stack>
    </Paper>
  );
};

const ClusterCard = ({ cluster }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FFFFFF' }}>
    <Stack spacing={0.8}>
      <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>{cluster.cluster_id}</Typography>
      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Accounts: <strong>{cluster.account_count || 0}</strong></Typography>
      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Average model score: <strong>{Number(cluster.avg_model_score || 0).toFixed(3)}</strong></Typography>
      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
        Suspicious nodes: <strong>{cluster.suspicious_nodes || 0}</strong> | Suspicious edges: <strong>{cluster.suspicious_edges || 0}</strong>
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
        Pattern tags: <strong>{(cluster.pattern_tags || []).join(', ') || 'linked activity'}</strong>
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
        Sample accounts: <strong>{(cluster.sample_accounts || []).join(', ') || 'Not available'}</strong>
      </Typography>
    </Stack>
  </Paper>
);

const formatMetric = (value, digits = 3) => {
  if (value == null || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toFixed(digits);
};
const fmt = (value) => Number(value || 0).toLocaleString();

const nodeColor = (node) => {
  if (node.node_type === 'account') {
    if (node.risk_band_output === 'High Risk' || Number(node.predicted_mule_flag || 0) === 1) return '#C65A11';
    if (node.risk_band_output === 'Medium Risk' || Number(node.mule_risk_score || 0) >= 0.45) return '#C79B2E';
    return '#3C7A89';
  }
  if (Number(node.mule_flag_if_applicable || 0) === 1) return '#B23A48';
  if (node.node_type === 'device') return '#5F6D7A';
  if (node.node_type === 'ip') return '#7C8EA0';
  return '#8C98A4';
};

const MuleModelOutputScreen = ({ activePipelineId, workspace = null }) => {
  const pipelineId = Number(activePipelineId || 0);
  const [resultTab, setResultTab] = useState('overview');
  const [statusState, setStatusState] = useState(null);
  const [governanceState, setGovernanceState] = useState(null);
  const [validationState, setValidationState] = useState(null);
  const [graphState, setGraphState] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadState = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const [modelRes, preprocessingRes, validationRes, graphRes] = await Promise.all([
        mlopsApi.muleModelBuildStatus(pipelineId),
        mlopsApi.mulePreprocessingStatus(pipelineId),
        mlopsApi.muleModelValidationStatus(pipelineId),
        mlopsApi.muleModelValidationGraph(pipelineId),
      ]);
      setStatusState((modelRes?.data || modelRes || null));
      setGovernanceState((preprocessingRes?.data || preprocessingRes || null)?.feature_governance || null);
      setValidationState((validationRes?.data || validationRes || null));
      setGraphState((graphRes?.data || graphRes || null));
    } catch (error) {
      setMessage(error?.message || 'Could not load Mule model output.');
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const runValidation = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const validationRes = await mlopsApi.muleModelValidationRun(pipelineId);
      setValidationState((validationRes?.data || validationRes || null));
      const graphRes = await mlopsApi.muleModelValidationGraph(pipelineId);
      setGraphState((graphRes?.data || graphRes || null));
      setMessage('Mule validation completed and the ring-analysis snapshot was stored in the backend.');
    } catch (error) {
      setMessage(error?.message || 'Could not run Mule validation.');
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  const latestRun = statusState?.latest_run || null;
  const sampleOutputs = statusState?.sample_outputs || [];
  const topSample = sampleOutputs[0] || {};
  const approvedCount = governanceState?.approved_features?.length || statusState?.approved_features?.length || 0;
  const blockedCount = governanceState?.blocked_features?.length || statusState?.blocked_features?.length || 0;
  const metrics = latestRun?.metrics || {};
  const validation = validationState?.latest_validation || null;
  const validationSummary = validation?.summary || {};
  const graphSummary = validation?.graph_summary || graphState?.graph_summary || metrics.graph || {};
  const graphPayload = graphState?.graph_payload || validationState?.graph_payload || { nodes: [], links: [], clusters: [], focus_cluster_id: '', truncated: false };
  const topAccounts = validationSummary?.top_accounts || sampleOutputs || [];
  const warnings = validationSummary?.warnings || [];
  const topSampleProbabilities = useMemo(() => extractCategoryProbabilities(topSample), [topSample]);
  const categoryMix = useMemo(() => summarizeCategoryMix(topAccounts), [topAccounts]);
  const leadCategory = categoryMix[0] || topSampleProbabilities[0] || null;
  const typologyCoverage = validationSummary.typology_prediction_coverage != null
    ? asProbability(validationSummary.typology_prediction_coverage)
    : (topAccounts.length
      ? topAccounts.filter((row) => extractCategoryProbabilities(row).length > 0).length / topAccounts.length
      : 0);

  const graphData = useMemo(() => ({
    nodes: Array.isArray(graphPayload?.nodes) ? graphPayload.nodes.map((node) => ({ ...node })) : [],
    links: Array.isArray(graphPayload?.links) ? graphPayload.links.map((link) => ({ ...link })) : [],
  }), [graphPayload]);

  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    return graphData.nodes.find((node) => node.id === selectedNode.id) || selectedNode;
  }, [graphData.nodes, selectedNode]);

  const graphClusters = graphPayload?.clusters || [];
  const canRunValidation = Boolean(latestRun?.run_id);
  const sequenceTracks = Array.isArray(latestRun?.sequence?.tracks) ? latestRun.sequence.tracks : [];
  const headerMetrics = [
    { label: 'Validation Status', value: validationState?.status === 'validated' ? 'Persisted' : validationState?.status === 'preview' ? 'Preview' : 'Pending', helper: 'Backend validation snapshot state.', emphasize: true },
    { label: 'Approved Features', value: fmt(approvedCount), helper: 'Governed signals feeding model output.' },
    { label: 'Blocked Features', value: fmt(blockedCount), helper: 'Held-out signals excluded from training scope.' },
    { label: 'Model Run', value: latestRun?.run_id || 'Pending', helper: 'Current persisted model build run backing this screen.' },
  ];

  return (
    <Stack spacing={2.25}>
      <MuleStageHeader
        title="Model Output & Validation"
        description="Review the final Mule model results. This stage is the client-facing result view for multiclass predictions, sequence overlays, graph intelligence, and scored accounts."
        workspace={workspace}
        stepId="validation"
        metrics={headerMetrics}
        showRunControl={false}
        actions={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<Refresh />} onClick={loadState} disabled={loading} sx={{ textTransform: 'none' }}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<PlayArrow />} onClick={runValidation} disabled={!canRunValidation || loading} sx={{ textTransform: 'none', bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
              Run Validation
            </Button>
          </Stack>
        )}
      />

      {message ? <Alert severity="info" onClose={() => setMessage('')}>{message}</Alert> : null}
      {validationState?.status === 'preview' ? (
        <Alert severity="info">
          The current validation view is a live preview from backend data. Run validation to persist this snapshot and its graph artifact for future reloads.
        </Alert>
      ) : null}
      {!latestRun ? (
        <Alert severity="warning">
          Complete the Mule Model Build stage first. Validation and live ring analysis need a scored Mule output dataset.
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert severity="warning">
          {warnings[0]}
        </Alert>
      ) : null}

      <Box sx={{ borderBottom: '1px solid rgba(16,24,40,0.12)' }}>
        <Tabs value={resultTab} onChange={(_, value) => setResultTab(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontSize: 12.5, fontWeight: 700 } }}>
          {RESULT_TABS.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
        </Tabs>
      </Box>

      {resultTab === 'overview' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <WorkbenchMetricGrid
            items={[
              { label: 'Top Mule Category', value: leadCategory?.label || topSample.predicted_mule_category || topSample.predicted_mule_typology || 'Not enabled', helper: 'Most likely mule category in the current output view.', emphasize: true },
              { label: 'Category Confidence', value: leadCategory ? `${(leadCategory.probability * 100).toFixed(1)}%` : 'N/A', helper: 'Confidence for the current lead category.' },
              { label: 'Category Coverage', value: `${(typologyCoverage * 100).toFixed(1)}%`, helper: 'Share of scored accounts with category probabilities.' },
              { label: 'Lead Risk Score', value: topSample.mule_risk_score != null ? Number(topSample.mule_risk_score).toFixed(3) : 'N/A', helper: 'Binary risk remains available as a secondary review signal.' },
            ]}
          />

          <WorkbenchMetricGrid
            items={[
              { label: 'Scored Accounts', value: validationSummary.total_accounts_scored ?? sampleOutputs.length ?? 'N/A', helper: 'Accounts in the current validation snapshot.' },
              { label: 'PR-AUC', value: formatMetric(validationSummary.pr_auc), helper: 'Precision-recall area under curve.' },
              { label: 'F1 Score', value: formatMetric(validationSummary.f1), helper: 'Thresholded model balance.' },
              { label: 'Top-N Capture', value: formatMetric(validationSummary.top_n_capture), helper: 'Known mule capture inside the review queue.' },
            ]}
          />

          <WorkbenchMetricGrid
            items={[
              { label: 'High Risk', value: validationSummary.high_risk_count ?? 'N/A', helper: 'Accounts above the high-risk cutoff.' },
              { label: 'Medium Risk', value: validationSummary.medium_risk_count ?? 'N/A', helper: 'Accounts in the review band.' },
              { label: 'Low Risk', value: validationSummary.low_risk_count ?? 'N/A', helper: 'Accounts below the review threshold.' },
              { label: 'Event Loss', value: formatMetric(validationSummary.event_loss_rate), helper: 'Missed known mules at the current threshold.' },
            ]}
          />

          <WorkbenchSection title="Result Snapshot" description="A compact summary of what the backend has already persisted for this Mule run.">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FBFCFE' }}>
                <Stack spacing={0.7}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828' }}>Multiclass Model</Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Run ID: <strong>{latestRun?.run_id || 'Pending'}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Approved features: <strong>{fmt(approvedCount)}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Blocked features: <strong>{fmt(blockedCount)}</strong></Typography>
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FBFCFE' }}>
                <Stack spacing={0.7}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828' }}>Sequence and Graph</Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Sequence tracks: <strong>{fmt(sequenceTracks.length)}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Ring clusters: <strong>{graphSummary.rings_detected ?? 'N/A'}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Validation run: <strong>{validation?.validation_run_id || validation?.run_id || 'Not persisted'}</strong></Typography>
                </Stack>
              </Paper>
            </Box>
          </WorkbenchSection>
        </Box>
      ) : null}

      {resultTab === 'multiclass' ? (
        <WorkbenchSection title="Multiclass Classification Results" description="Review typology concentration at both portfolio level and individual-account level.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.1fr) minmax(0, 1fr)' }, gap: 1.5 }}>
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 1 }}>
              Lead category distribution
            </Typography>
            {categoryMix.length > 0 ? (
              <Stack spacing={1}>
                {categoryMix.slice(0, 5).map((item) => (
                  <Box key={item.key}>
                    <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.45 }}>
                      <Typography sx={{ fontSize: 12.5, color: '#101828', fontWeight: 700 }}>
                        {item.label}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                        Lead in {(item.topRankShare * 100).toFixed(1)}% of preview rows
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={item.topRankShare * 100}
                      sx={{
                        height: 8,
                        borderRadius: 999,
                        bgcolor: 'rgba(21,27,39,0.08)',
                        '& .MuiLinearProgress-bar': { bgcolor: '#C65A11' },
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                Category probabilities will appear once typology-enabled scoring is available for this Mule run.
              </Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 1 }}>
              Current account probability stack
            </Typography>
            <ProbabilityList items={topSampleProbabilities.slice(0, 5)} />
          </Paper>
        </Box>
        </WorkbenchSection>
      ) : null}

      {resultTab === 'sequence' ? (
        <WorkbenchSection title="Sequence Model Results" description="Sequence overlays add behavioural context on top of the multiclass core. This view shows which tracks are active and what the backend persisted for them.">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            {sequenceTracks.length ? sequenceTracks.map((track) => (
              <Paper key={track.track || track.label} variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FBFCFE' }}>
                <Stack spacing={0.7}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#101828' }}>
                    {track.track || track.label}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                    Status: <strong>{track.status || 'pending'}</strong>
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                    Kind: <strong>{track.kind || 'sequence'}</strong>
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                    Score column: <strong>{track.score_column || 'Not produced'}</strong>
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.6 }}>
                    {track.reason || `Required columns: ${(track.required_columns || []).join(', ') || 'Not listed'}`}
                  </Typography>
                </Stack>
              </Paper>
            )) : (
              <Typography sx={{ fontSize: 13, color: '#667085' }}>
                Train the Mule model first to populate sequence-track results.
              </Typography>
            )}
          </Box>
        </WorkbenchSection>
      ) : null}

      {resultTab === 'graph' ? (
        <>
          <WorkbenchSection title="Graph and Ring Results" description="This graph is rendered from uploaded Mule graph tables and device linkage data. The workbench persists the validation graph snapshot for reload and review.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.8fr) minmax(320px, 0.9fr)' }, gap: 1.5 }}>
          <Paper variant="outlined" sx={{ borderRadius: 0, overflow: 'hidden', minHeight: 460 }}>
            {graphData.nodes.length > 0 ? (
              <ForceGraph2D
                graphData={graphData}
                backgroundColor="#FFFFFF"
                nodeRelSize={7}
                cooldownTicks={70}
                linkDirectionalParticles={(link) => (link?.suspicious_link_flag ? 2 : 0)}
                linkDirectionalParticleWidth={(link) => (link?.suspicious_link_flag ? 2 : 0)}
                linkColor={(link) => (link?.suspicious_link_flag ? '#C65A11' : '#AEB8C2')}
                nodeCanvasObject={(node, ctx, globalScale) => {
                  const label = node.entity_id || node.id;
                  const fontSize = Math.max(9, 12 / globalScale);
                  const radius = node.is_account ? 7 : 4.5;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.fillStyle = nodeColor(node);
                  ctx.fill();
                  if (node.cluster_id === graphPayload.focus_cluster_id) {
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#101828';
                    ctx.stroke();
                  }
                  if (globalScale >= 1.2 || node.is_account) {
                    ctx.font = `${fontSize}px Sans-Serif`;
                    ctx.fillStyle = '#101828';
                    ctx.fillText(label, node.x + radius + 2, node.y + radius + 1);
                  }
                }}
                onNodeClick={setSelectedNode}
              />
            ) : (
              <Stack justifyContent="center" alignItems="center" sx={{ minHeight: 460, px: 3 }}>
                <Typography sx={{ fontSize: 13, color: '#667085', textAlign: 'center' }}>
                  Run Mule validation after model build to load the live ring network from your uploaded graph data.
                </Typography>
              </Stack>
            )}
          </Paper>

          <Stack spacing={1.5}>
            <WorkbenchMetricGrid
              items={[
                { label: 'Rings Detected', value: graphSummary.rings_detected ?? 'N/A', helper: 'Suspicious clusters surfaced in the current graph.' },
                { label: 'Max Cluster Size', value: graphSummary.max_cluster_size ?? 'N/A', helper: 'Largest connected ring in the validation snapshot.' },
                { label: 'Shared Devices', value: graphSummary.accounts_with_shared_devices ?? 'N/A', helper: 'Accounts tied by shared-device evidence.' },
              ]}
            />

            <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828' }}>Selected Node</Typography>
              {selectedNodeDetails ? (
                <Stack spacing={0.65} sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}><strong>{selectedNodeDetails.display_name || selectedNodeDetails.label || selectedNodeDetails.id}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Cluster: <strong>{selectedNodeDetails.cluster_id || 'None'}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Node type: <strong>{selectedNodeDetails.node_type || 'entity'}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Risk band: <strong>{selectedNodeDetails.risk_band_output || selectedNodeDetails.risk_band || 'N/A'}</strong></Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Model score: <strong>{formatMetric(selectedNodeDetails.mule_risk_score)}</strong></Typography>
                </Stack>
              ) : (
                <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 1 }}>
                  Select a node in the graph to inspect its cluster and risk context.
                </Typography>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 1 }}>Graph Legend</Typography>
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}><strong style={{ color: '#C65A11' }}>Orange accounts</strong> are high-risk or predicted mule accounts.</Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}><strong style={{ color: '#C79B2E' }}>Amber accounts</strong> are medium-risk accounts near the review cutoff.</Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}><strong style={{ color: '#B23A48' }}>Red non-account nodes</strong> carry suspicious graph flags from the source data.</Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}><strong>Highlighted particles</strong> show suspicious links flagged in the graph edge data.</Typography>
              </Stack>
            </Paper>
          </Stack>
        </Box>
          </WorkbenchSection>

          <WorkbenchSection title="Top Ring Clusters" description="These clusters summarize the most suspicious graph-connected mule structures detected in the current validation view.">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
              {graphClusters.length > 0 ? graphClusters.map((cluster) => (
                <ClusterCard key={cluster.cluster_id} cluster={cluster} />
              )) : (
                <Typography sx={{ fontSize: 13, color: '#667085' }}>
                  Run validation to summarize the most suspicious graph-connected Mule clusters.
                </Typography>
              )}
            </Box>
          </WorkbenchSection>
        </>
      ) : null}

      {resultTab === 'accounts' ? (
        <WorkbenchSection title="Scored Account Preview" description="Use the scored ledger to inspect predicted category, probability stack, supporting signals, and the investigator-facing narrative for top accounts.">
        <Stack spacing={1.5}>
          {topAccounts.length > 0 ? topAccounts.slice(0, 8).map((row, index) => (
            <RowPreview key={`${row.account_id || row.row_id || 'row'}_${index}`} row={row} />
          )) : (
            <Typography sx={{ fontSize: 13, color: '#667085' }}>
              Train the Mule model to populate scored output, typology predictions, top drivers, and investigator explanations.
            </Typography>
          )}
        </Stack>
        </WorkbenchSection>
      ) : null}

      <WorkbenchSection title="Backend Persistence" description="Validation snapshots are persisted in the backend so model output, validation metrics, and live ring views survive refresh and restart.">
        <Typography sx={{ fontSize: 13, color: '#667085', lineHeight: 1.7 }}>
          This model output is sourced from <strong>{approvedCount}</strong> approved Mule features only. Target labels, typology labels, target-derived fields, and post-outcome fields remain outside the training feature scope.
        </Typography>
      </WorkbenchSection>
    </Stack>
  );
};

export default MuleModelOutputScreen;
