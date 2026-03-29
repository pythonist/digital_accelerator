import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  applyNodeChanges,
  getBezierPath,
} from 'reactflow';
import 'reactflow/dist/style.css';
import apiClient from '@services/api';

const nodePalette = {
  system: { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  processing: { bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
  outcome: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
  decision: { bg: '#fff1f2', border: '#fda4af', text: '#be123c' },
  risk: { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
};

const FlowNode = ({ data }) => {
  const palette = nodePalette[data?.risk] || nodePalette.system;
  const highlight = Boolean(data?.active);
  const compact = Boolean(data?.compact);
  const kindLabel = data?.kind === 'cluster'
    ? 'Cluster'
    : data?.kind === 'input'
    ? 'Input'
    : data?.kind === 'workspace'
    ? 'Workspace'
    : data?.kind === 'outcome'
    ? 'Outcome'
    : 'Step';
  return (
    <Tooltip title={data?.summary || ''} placement="top">
      <Box
        sx={{
          minWidth: data?.kind === 'cluster' ? (compact ? 230 : 260) : 220,
          maxWidth: data?.kind === 'cluster' ? (compact ? 240 : 280) : 240,
          borderRadius: 2.5,
          border: `1px solid ${highlight ? '#0f172a' : palette.border}`,
          bgcolor: highlight ? '#ffffff' : palette.bg,
          boxShadow: highlight ? '0 12px 28px rgba(15,23,42,0.14)' : '0 4px 12px rgba(15,23,42,0.05)',
          px: compact ? 1.05 : 1.35,
          py: compact ? 0.9 : 1.15,
        }}
      >
        <Handle type="target" position={Position.Left} style={{ background: palette.text, width: 8, height: 8 }} />
        <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: palette.text, textTransform: 'uppercase', letterSpacing: 0.45 }}>
          {kindLabel}
        </Typography>
        <Typography sx={{ mt: 0.45, fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
          {data?.label}
        </Typography>
        {!compact ? (
          <Typography sx={{ mt: 0.6, fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
            {data?.summary}
          </Typography>
        ) : null}
        <Stack spacing={0.45} sx={{ mt: 1 }}>
          {(data?.metrics || []).slice(0, compact ? 1 : 2).map((metric) => (
            <Typography key={`${data?.id}-${metric.label}`} sx={{ fontSize: 11.5, color: '#0f172a', fontWeight: 700 }}>
              {metric.label}: {metric.value}
            </Typography>
          ))}
        </Stack>
        {data?.kind === 'cluster' ? (
          <Typography sx={{ mt: 0.8, fontSize: 11.5, color: '#64748b', fontWeight: 700 }}>
            {data?.expanded ? 'Click to collapse details' : 'Click to expand details'}
          </Typography>
        ) : null}
        <Handle type="source" position={Position.Right} style={{ background: palette.text, width: 8, height: 8 }} />
      </Box>
    </Tooltip>
  );
};

const nodeTypes = {
  flowNode: FlowNode,
};

const edgePalette = {
  normal: { stroke: '#94a3b8', width: 1.6, dot: null, opacity: 0.7, dash: undefined, marker: '#94a3b8' },
  inbound: { stroke: '#2563eb', width: 2.2, dot: '#2563eb', opacity: 0.95, dash: '7 10', marker: '#2563eb' },
  outbound: { stroke: '#f97316', width: 2.4, dot: '#f97316', opacity: 0.95, dash: '7 10', marker: '#f97316' },
  current: { stroke: '#16a34a', width: 3, dot: '#16a34a', opacity: 1, dash: '10 8', marker: '#16a34a' },
  visited: { stroke: '#22c55e', width: 2.2, dot: null, opacity: 0.85, dash: undefined, marker: '#22c55e' },
};

const FlowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  label,
  data,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const palette = edgePalette[data?.state] || edgePalette.normal;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: palette.stroke,
          strokeWidth: palette.width,
          opacity: palette.opacity,
          strokeDasharray: palette.dash,
          strokeLinecap: 'round',
        }}
      />
      {palette.dot ? (
        <circle r="4" fill={palette.dot} opacity="0.95">
          <animateMotion dur={data?.state === 'current' ? '1.15s' : '1.6s'} repeatCount="indefinite" path={edgePath} />
        </circle>
      ) : null}
      {label ? (
        <foreignObject x={labelX - 70} y={labelY - 14} width={140} height={28} requiredExtensions="http://www.w3.org/1999/xhtml">
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              padding: '2px 8px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.94)',
              border: '1px solid #e2e8f0',
              color: '#334155',
              fontSize: '10.5px',
              fontWeight: 700,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.35,
            }}
          >
            {label}
          </div>
        </foreignObject>
      ) : null}
    </>
  );
};

const edgeTypes = {
  flowEdge: FlowEdge,
};

const findNodeById = (views, nodeId) => {
  const allViews = Object.values(views || {});
  for (const view of allViews) {
    const candidates = [...(view?.clusters || []), ...(view?.nodes || [])];
    const match = candidates.find((node) => node.id === nodeId);
    if (match) return match;
  }
  return null;
};

const metricValueFromNode = (views, nodeId, label, fallback) => {
  const node = findNodeById(views, nodeId);
  const metric = (node?.metrics || []).find((item) => item.label === label);
  return metric?.value || fallback;
};

const buildSketchJourneyView = (views) => {
  const alerts = metricValueFromNode(views, 'alert_intake', 'Alerts', '1,941');
  const suppressed = metricValueFromNode(views, 'decision_layer', 'Suppressed', '1,503');
  const threshold = metricValueFromNode(views, 'threshold_optimization', 'Threshold', '0.59');
  const forwarded = metricValueFromNode(views, 'fcc_outcome', 'Forwarded', '438');
  const cases = metricValueFromNode(views, 'case_creation', 'Cases', '64');
  const reviewed = metricValueFromNode(views, 'investigation', 'Reviewed', '4');
  const escalated = metricValueFromNode(views, 'decisioning', 'Escalated', '4');
  const sar = metricValueFromNode(views, 'sar_action', 'SAR', '0');

  const nodes = [
    { id: 'journey_str', kind: 'input', label: 'STR Inputs', summary: 'Upstream STR or rules-based alert feeds enter FCC.', risk: 'system', position: { x: 40, y: 110 }, metrics: [{ label: 'Source', value: 'External monitoring' }] },
    { id: 'journey_txn', kind: 'input', label: 'Transaction Data', summary: 'Transaction records provide behavioral and velocity signals.', risk: 'system', position: { x: 40, y: 250 }, metrics: [{ label: 'Feed', value: 'Customer activity' }] },
    { id: 'journey_cases', kind: 'input', label: 'Case History', summary: 'Historical cases provide prior disposition context.', risk: 'system', position: { x: 40, y: 390 }, metrics: [{ label: 'Reuse', value: 'Decision precedent' }] },
    { id: 'journey_master', kind: 'workspace', label: 'FCC Master Dataset', summary: 'Inputs are unified into a single FCC-ready operating dataset.', risk: 'processing', position: { x: 300, y: 215 }, metrics: [{ label: 'Alerts', value: alerts }] },
    { id: 'journey_eda', kind: 'step', label: 'EDA and Risk Readout', summary: 'FCC explains alert mix, behavioral bands, and population quality.', risk: 'processing', position: { x: 620, y: 125 }, metrics: [{ label: 'Purpose', value: 'Explain alert population' }] },
    { id: 'journey_prep', kind: 'step', label: 'Data Preparation', summary: 'Customer, account, and transaction fields are standardized for decisioning.', risk: 'processing', position: { x: 1010, y: 100 }, metrics: [{ label: 'State', value: 'Standardized' }] },
    { id: 'journey_model', kind: 'step', label: 'Decision Model', summary: 'FCC separates low-value noise from alerts that still need review.', risk: 'processing', position: { x: 1000, y: 290 }, metrics: [{ label: 'Suppressed', value: suppressed }] },
    { id: 'journey_validation', kind: 'step', label: 'Validation', summary: 'Workload reduction and missed-risk controls are checked before release.', risk: 'processing', position: { x: 1350, y: 285 }, metrics: [{ label: 'Threshold', value: threshold }] },
    { id: 'journey_synth', kind: 'step', label: 'Synthetic Data Support', summary: 'Synthetic coverage fills missing investigation context where needed.', risk: 'decision', position: { x: 1250, y: 500 }, metrics: [{ label: 'Support', value: 'History ready' }] },
    { id: 'journey_model_data', kind: 'step', label: 'Model-Ready Evidence', summary: 'Prepared output is packaged for governed suppression and handoff.', risk: 'system', position: { x: 1600, y: 500 }, metrics: [{ label: 'Output', value: 'Bridge package' }] },
    { id: 'journey_split', kind: 'workspace', label: 'Suppressed vs Not Suppressed', summary: 'FCC keeps low-value alerts out of analyst queues and forwards retained workload to Sentinel.', risk: 'outcome', position: { x: 1680, y: 225 }, metrics: [{ label: 'Forwarded', value: forwarded }, { label: 'Suppressed', value: suppressed }] },
    { id: 'journey_case_manager', kind: 'workspace', label: 'Sentinel Case Manager', summary: 'Retained alerts land in Sentinel and become investigation-ready cases.', risk: 'system', position: { x: 2100, y: 380 }, metrics: [{ label: 'Cases', value: cases }] },
    { id: 'journey_graph', kind: 'step', label: 'Graph Analysis', summary: 'Network and linkage analysis supports the investigation view.', risk: 'risk', position: { x: 2550, y: 190 }, metrics: [{ label: 'Focus', value: 'Link analysis' }] },
    { id: 'journey_pack', kind: 'step', label: 'Case Pack', summary: 'Case narrative, alerts, and supporting context are reviewed together.', risk: 'risk', position: { x: 2550, y: 380 }, metrics: [{ label: 'Context', value: 'Evidence pack' }] },
    { id: 'journey_investigation', kind: 'step', label: 'Investigation', summary: 'Investigators validate findings and build the working case narrative.', risk: 'risk', position: { x: 2550, y: 570 }, metrics: [{ label: 'Reviewed', value: reviewed }] },
    { id: 'journey_final', kind: 'workspace', label: 'Final Decision', summary: 'Sentinel consolidates evidence into the final closure or escalation outcome.', risk: 'decision', position: { x: 3020, y: 405 }, metrics: [{ label: 'Escalated', value: escalated }, { label: 'SAR', value: sar }] },
    { id: 'journey_closed', kind: 'outcome', label: 'Closed', summary: 'The case was resolved with no further regulatory action required.', risk: 'outcome', position: { x: 3490, y: 180 }, metrics: [{ label: 'Outcome', value: 'Closed' }] },
    { id: 'journey_escalated', kind: 'outcome', label: 'Escalated', summary: 'The case moved for deeper review or senior sign-off.', risk: 'decision', position: { x: 3520, y: 405 }, metrics: [{ label: 'Route', value: 'L2 / BM / Vigilance' }] },
    { id: 'journey_other', kind: 'outcome', label: 'Other Action', summary: 'Alternative outcomes include SAR drafting, EDD, or reopening.', risk: 'system', position: { x: 3490, y: 630 }, metrics: [{ label: 'Examples', value: 'SAR / EDD / Reopen' }] },
  ];

  const edges = [
    { id: 'journey_str-journey_master', source: 'journey_str', target: 'journey_master', label: 'Alert feed' },
    { id: 'journey_txn-journey_master', source: 'journey_txn', target: 'journey_master', label: 'Behavior data' },
    { id: 'journey_cases-journey_master', source: 'journey_cases', target: 'journey_master', label: 'Case context' },
    { id: 'journey_master-journey_eda', source: 'journey_master', target: 'journey_eda', label: 'Population readout' },
    { id: 'journey_eda-journey_prep', source: 'journey_eda', target: 'journey_prep', label: 'Refined inputs' },
    { id: 'journey_master-journey_model', source: 'journey_master', target: 'journey_model', label: 'Decision features' },
    { id: 'journey_model-journey_validation', source: 'journey_model', target: 'journey_validation', label: 'Governed checks' },
    { id: 'journey_validation-journey_split', source: 'journey_validation', target: 'journey_split', label: 'Decision threshold' },
    { id: 'journey_synth-journey_model_data', source: 'journey_synth', target: 'journey_model_data', label: 'Context enrichment' },
    { id: 'journey_model_data-journey_split', source: 'journey_model_data', target: 'journey_split', label: 'Bridge package' },
    { id: 'journey_split-journey_case_manager', source: 'journey_split', target: 'journey_case_manager', label: `${forwarded} retained cases` },
    { id: 'journey_case_manager-journey_graph', source: 'journey_case_manager', target: 'journey_graph', label: 'Network review' },
    { id: 'journey_case_manager-journey_pack', source: 'journey_case_manager', target: 'journey_pack', label: 'Case context' },
    { id: 'journey_case_manager-journey_investigation', source: 'journey_case_manager', target: 'journey_investigation', label: 'Investigator workbench' },
    { id: 'journey_case_manager-journey_final', source: 'journey_case_manager', target: 'journey_final', label: 'Decision path' },
    { id: 'journey_graph-journey_final', source: 'journey_graph', target: 'journey_final', label: 'Network findings' },
    { id: 'journey_pack-journey_final', source: 'journey_pack', target: 'journey_final', label: 'Case narrative' },
    { id: 'journey_investigation-journey_final', source: 'journey_investigation', target: 'journey_final', label: 'Validated evidence' },
    { id: 'journey_final-journey_closed', source: 'journey_final', target: 'journey_closed', label: 'Close case' },
    { id: 'journey_final-journey_escalated', source: 'journey_final', target: 'journey_escalated', label: 'Escalate review' },
    { id: 'journey_final-journey_other', source: 'journey_final', target: 'journey_other', label: 'Other action' },
  ];

  return {
    clusters: [],
    nodes,
    edges,
    render_mode: 'freeform',
    play_sequence: [
      'journey_str',
      'journey_master',
      'journey_eda',
      'journey_prep',
      'journey_model',
      'journey_validation',
      'journey_synth',
      'journey_model_data',
      'journey_split',
      'journey_case_manager',
      'journey_graph',
      'journey_pack',
      'journey_investigation',
      'journey_final',
      'journey_escalated',
    ],
  };
};

const normalizeGraph = (payload, viewMode, expandedClusters, activeNodeId, playbackState, positionOverrides = {}) => {
  const view = payload?.views?.[viewMode] || {};
  const clusters = Array.isArray(view?.clusters) ? view.clusters : [];
  const nodes = Array.isArray(view?.nodes) ? view.nodes : [];
  const edges = Array.isArray(view?.edges) ? view.edges : [];
  const currentEdgeId = playbackState?.currentEdgeId || '';
  const visitedEdgeIds = new Set(playbackState?.visitedEdgeIds || []);
  const isFreeform = view?.render_mode === 'freeform';

  const visibleIds = new Set();
  const mappedNodes = [];

  clusters.forEach((cluster) => {
    const overriddenPosition = positionOverrides[cluster.id];
    const clusterNode = {
      id: cluster.id,
      type: 'flowNode',
      position: overriddenPosition || cluster.position || { x: 0, y: 0 },
      data: {
        ...cluster,
        kind: 'cluster',
        active: cluster.id === activeNodeId,
        expanded: Boolean(expandedClusters[cluster.id]),
        compact: viewMode === 'system',
      },
      draggable: false,
      selectable: true,
    };
    mappedNodes.push(clusterNode);
    visibleIds.add(cluster.id);
  });

  if (isFreeform) {
    nodes.forEach((node) => {
      const overriddenPosition = positionOverrides[node.id];
      mappedNodes.push({
        id: node.id,
        type: 'flowNode',
        position: overriddenPosition || node.position || { x: 0, y: 0 },
        data: {
          ...node,
          active: node.id === activeNodeId,
        },
        draggable: false,
        selectable: true,
      });
      visibleIds.add(node.id);
    });
  } else if (viewMode === 'system') {
    nodes
      .filter((node) => node.cluster_id && expandedClusters[node.cluster_id])
      .forEach((node) => {
        const overriddenPosition = positionOverrides[node.id];
        mappedNodes.push({
          id: node.id,
          type: 'flowNode',
          position: overriddenPosition || node.position || { x: 0, y: 0 },
          data: {
            ...node,
            kind: 'step',
            active: node.id === activeNodeId,
          },
          draggable: false,
          selectable: true,
        });
        visibleIds.add(node.id);
      });
  }

  const mappedEdges = edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => {
      let state = 'normal';
      if (edge.id === currentEdgeId) {
        state = 'current';
      } else if (visitedEdgeIds.has(edge.id)) {
        state = 'visited';
      } else if (edge.target === activeNodeId) {
        state = 'inbound';
      } else if (edge.source === activeNodeId) {
        state = 'outbound';
      }
      const palette = edgePalette[state] || edgePalette.normal;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'flowEdge',
        markerEnd: { type: MarkerType.ArrowClosed, color: palette.marker },
        data: { state },
      };
    });

  return { nodes: mappedNodes, edges: mappedEdges };
};

const WorkflowGraphDialog = ({ open, onClose, params = {} }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [viewMode, setViewMode] = useState('business');
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [expandedClusters, setExpandedClusters] = useState({});
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [positionOverrides, setPositionOverrides] = useState({});
  const [renderNodes, setRenderNodes] = useState([]);
  const [renderEdges, setRenderEdges] = useState([]);
  const graphPayload = useMemo(() => {
    if (!payload) return null;
    return {
      ...payload,
      views: {
        ...(payload.views || {}),
        journey: buildSketchJourneyView(payload.views || {}),
      },
    };
  }, [payload]);

  const handleViewChange = (nextView) => {
    setPlaying(false);
    setPlayIndex(0);
    setViewMode(nextView);
    const nextViewData = ((graphPayload || {}).views || {})[nextView] || {};
    const firstNode = [...(nextViewData.clusters || []), ...(nextViewData.nodes || [])][0];
    setSelectedNodeId(firstNode?.id || '');
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await apiClient.getExecutiveGraphFlowPayload(params);
        if (!cancelled) {
          const nextPayload = response?.graph_flow_payload || null;
          setPayload(nextPayload);
          const clusters = (((nextPayload || {}).views || {}).system || {}).clusters || [];
          const initialExpanded = Object.fromEntries(clusters.map((cluster) => [cluster.id, false]));
          setExpandedClusters(initialExpanded);
          setSelectedNodeId((((nextPayload || {}).views || {}).business || {}).clusters?.[0]?.id || '');
          setViewMode('business');
          setPlayIndex(0);
          setPlaying(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || 'Unable to load workflow graph.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, params]);

  const currentView = graphPayload?.views?.[viewMode] || {};
  const playSequence = Array.isArray(currentView?.play_sequence)
    ? currentView.play_sequence
    : Array.isArray(graphPayload?.play_sequence)
    ? graphPayload.play_sequence
    : [];
  const activeEdgeSequence = useMemo(
    () => playSequence.slice(1).map((targetId, index) => `${playSequence[index]}-${targetId}`),
    [playSequence],
  );

  useEffect(() => {
    if (!playing || !playSequence.length) return undefined;
    const currentId = playSequence[playIndex];
    setSelectedNodeId(currentId);
    const systemView = graphPayload?.views?.system;
    const matchingNode = (systemView?.nodes || []).find((node) => node.id === currentId);
    if (matchingNode?.cluster_id) {
      setExpandedClusters((prev) => ({ ...prev, [matchingNode.cluster_id]: true }));
    }
    const timer = setTimeout(() => {
      if (playIndex >= playSequence.length - 1) {
        setPlaying(false);
        return;
      }
      setPlayIndex((previous) => previous + 1);
    }, 1100);
    return () => clearTimeout(timer);
  }, [graphPayload, playIndex, playSequence, playing]);

  const activeNodeId = selectedNodeId || playSequence[playIndex] || '';
  const currentEdgeId = playing && playIndex > 0 ? activeEdgeSequence[playIndex - 1] : '';
  const visitedEdgeIds = playing ? activeEdgeSequence.slice(0, Math.max(0, playIndex - 1)) : [];
  const playbackState = useMemo(
    () => ({ currentEdgeId, visitedEdgeIds }),
    [currentEdgeId, visitedEdgeIds],
  );

  const graph = useMemo(
    () => normalizeGraph(
      graphPayload,
      viewMode,
      expandedClusters,
      activeNodeId,
      playbackState,
      positionOverrides[viewMode] || {},
    ),
    [activeNodeId, expandedClusters, graphPayload, playbackState, positionOverrides, viewMode],
  );

  useEffect(() => {
    setRenderNodes(graph.nodes);
    setRenderEdges(graph.edges);
  }, [graph]);

  const selectedNode = useMemo(() => {
    const allNodes = Object.values((graphPayload || {}).views || {}).flatMap((view) => [
      ...(view?.clusters || []),
      ...(view?.nodes || []),
    ]);
    return allNodes.find((node) => node.id === activeNodeId) || null;
  }, [activeNodeId, graphPayload]);

  const handleNodeClick = (_, node) => {
    const nodeId = node?.id;
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    if (node?.data?.kind === 'cluster' && viewMode === 'system') {
      setExpandedClusters((prev) => ({
        ...prev,
        [nodeId]: !prev[nodeId],
      }));
    }
  };

  const handleNodesChange = (changes) => {
    setRenderNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  };

  const handleNodeDragStop = (_, node) => {
    if (!node?.id || !node?.position) return;
    setPositionOverrides((prev) => ({
      ...prev,
      [viewMode]: {
        ...(prev[viewMode] || {}),
        [node.id]: node.position,
      },
    }));
  };

  const togglePlay = () => {
    if (!playSequence.length) return;
    if (!playing) {
      if (viewMode === 'business') {
        setViewMode('system');
      }
      setExpandedClusters((prev) => Object.fromEntries(Object.keys(prev || {}).map((key) => [key, true])));
      setPlayIndex(0);
      setSelectedNodeId(playSequence[0]);
    }
    setPlaying((prev) => !prev);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullWidth PaperProps={{ sx: { width: '92vw', maxWidth: '92vw' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
          <Box>
            <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
              End-to-End AML Flow Graph
            </Typography>
            <Typography sx={{ mt: 0.55, fontSize: 13.5, color: '#64748b' }}>
              Expand clusters to inspect how FCC intelligence, suppression, Sentinel investigation, and final decisioning connect across the same operating flow.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => handleViewChange('business')} variant={viewMode === 'business' ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }}>
              Business View
            </Button>
            <Button onClick={() => handleViewChange('system')} variant={viewMode === 'system' ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }}>
              System View
            </Button>
            <Button onClick={() => handleViewChange('journey')} variant={viewMode === 'journey' ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }}>
              Your Flow
            </Button>
            <Button onClick={togglePlay} variant="outlined" sx={{ textTransform: 'none', borderColor: '#fdba74', color: '#c2410c' }}>
              {playing ? 'Pause Flow' : 'Play Flow'}
            </Button>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={520} />
          </Stack>
        ) : null}
        {!loading && error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && !error && graphPayload ? (
          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2}>
            <Box sx={{ flex: 1, minHeight: 780, borderRadius: 3, border: '1px solid #e2e8f0', overflow: 'hidden', bgcolor: '#f8fafc' }}>
            <Box sx={{ height: 780 }}>
                <ReactFlow
                  nodes={renderNodes}
                  edges={renderEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodeClick={handleNodeClick}
                  onNodesChange={handleNodesChange}
                  onNodeDragStop={handleNodeDragStop}
                  fitView
                  fitViewOptions={{ padding: 0.2, duration: 450 }}
                  minZoom={0.24}
                  maxZoom={1.35}
                  nodesDraggable
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                >
                  <Controls />
                  <Background gap={18} color="#e2e8f0" />
                </ReactFlow>
              </Box>
            </Box>

            <Box sx={{ width: { xs: '100%', xl: 330 }, borderRadius: 3, border: '1px solid #e2e8f0', bgcolor: '#ffffff', p: 2.1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Selected node
              </Typography>
              <Typography sx={{ mt: 1, fontSize: 21, fontWeight: 800, color: '#0f172a' }}>
                {selectedNode?.label || 'Choose a node'}
              </Typography>
              <Typography sx={{ mt: 0.8, fontSize: 13.5, color: '#475569', lineHeight: 1.7 }}>
                {selectedNode?.summary || 'Click a cluster or step to inspect the business meaning, counts, and connected flow.'}
              </Typography>

              <Stack spacing={1} sx={{ mt: 2 }}>
                {(selectedNode?.metrics || []).map((metric) => (
                  <Box key={`${selectedNode?.id}-${metric.label}`} sx={{ borderRadius: 2, border: '1px solid #e2e8f0', bgcolor: '#f8fafc', px: 1.2, py: 1 }}>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.35 }}>
                      {metric.label}
                    </Typography>
                    <Typography sx={{ mt: 0.4, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                      {metric.value}
                    </Typography>
                  </Box>
                ))}
              </Stack>

              <Box sx={{ mt: 2.2, borderRadius: 2.2, bgcolor: '#fff7ed', border: '1px solid #fdba74', px: 1.4, py: 1.2 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#9a3412', lineHeight: 1.6 }}>
                  {viewMode === 'business'
                    ? 'Business View keeps the story simplified for executives. Switch to System View to expand the operating details inside each cluster.'
                    : viewMode === 'journey'
                    ? 'Your Flow turns the whiteboard version into a spaced-out FCC to Sentinel operating map, including Case Manager, investigation branches, and final outcomes.'
                    : 'System View lets you expand each cluster and trace the operating steps, counts, and feedback loops in more detail.'}
                </Typography>
              </Box>

              <Typography sx={{ mt: 1.3, fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
                Drag nodes to spread the layout the way you want during review.
              </Typography>

              <Stack spacing={0.85} sx={{ mt: 1.7 }}>
                {[
                  ['#2563eb', 'Inbound flow into the selected step'],
                  ['#f97316', 'Outbound flow moving to the next step'],
                  ['#16a34a', 'Current play-flow edge being traversed'],
                ].map(([color, text]) => (
                  <Stack key={text} direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 12, height: 12, borderRadius: 99, bgcolor: color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>
                      {text}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default WorkflowGraphDialog;
