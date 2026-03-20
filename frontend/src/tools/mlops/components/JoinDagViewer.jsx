/**
 * JoinDagViewer.jsx
 *
 * Drop-in visual DAG for the MasterDatasetScreen.
 * Shows the join pipeline as a left-to-right node graph with:
 *   - Row count on each node
 *   - Edge labels: key used, join type, coverage %, matched rows
 *   - Color-coded health: green (>80%), amber (50-80%), red (<50%)
 *   - Anchor node highlighted
 *   - Animated flow pulse on edges
 *
 * Usage (add to MasterDatasetScreen after the "Construction pipeline" section):
 *
 *   import JoinDagViewer from './JoinDagViewer';
 *
 *   <JoinDagViewer
 *     datasets={datasets}
 *     joins={joins}
 *     anchorType={anchorDatasetType}
 *     impactRows={rowImpact?.steps || []}   // from build result
 *     masterRowCount={masterRowCount}        // from build result
 *   />
 *
 * Props:
 *   datasets      - array of { dataset_type, row_count, ... }
 *   joins         - array of { left, right, key, join_type, enabled, matched_rows? }
 *   anchorType    - string, e.g. "alerts"
 *   impactRows    - array from _build_master_from_datasets impact output
 *   masterRowCount- final row count of built master
 */

import React, { useMemo, useRef, useState } from 'react';
import { Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import {
  AccountTree,
  CheckCircleOutline,
  ErrorOutline,
  WarningAmberOutlined,
} from '@mui/icons-material';

// ── Design tokens (match workbench) ────────────────────────────────────────────
const C = {
  orange:     '#D04A02',
  orangeSoft: '#fff1ec',
  border:     '#e2e8f0',
  text:       '#1e293b',
  muted:      '#64748b',
  bg:         '#f8fafc',
  green:      '#16a34a',
  greenBg:    '#dcfce7',
  amber:      '#b45309',
  amberBg:    '#fef3c7',
  red:        '#dc2626',
  redBg:      '#fee2e2',
  blue:       '#1d4ed8',
  blueBg:     '#dbeafe',
  nodeW:      148,
  nodeH:      72,
  hGap:       110,   // horizontal gap between node columns
  vGap:       20,    // vertical gap between nodes in same column
  padX:       28,
  padY:       28,
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt  = (n) => (n == null ? '-' : Number(n).toLocaleString());
const fmtK = (n) => {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const toNum = (n, fallback = 0) => {
  const value = Number(n);
  return Number.isFinite(value) ? value : fallback;
};
const signed = (n) => {
  const value = toNum(n, 0);
  if (value > 0) return `+${fmt(value)}`;
  if (value < 0) return `-${fmt(Math.abs(value))}`;
  return '0';
};

const coverageColor = (pct) => {
  if (pct == null) return C.muted;
  if (pct >= 80)   return C.green;
  if (pct >= 50)   return C.amber;
  return C.red;
};

const coverageBg = (pct) => {
  if (pct == null) return '#f1f5f9';
  if (pct >= 80)   return C.greenBg;
  if (pct >= 50)   return C.amberBg;
  return C.redBg;
};

const joinTypeColor = (jt) => ({
  left:  C.blue,
  inner: C.green,
  right: '#7c3aed',
  outer: C.amber,
})[jt?.toLowerCase()] || C.muted;

const JOIN_TYPE_LABELS = {
  left:  'LEFT',
  inner: 'INNER',
  right: 'RIGHT',
  outer: 'FULL',
};

const normalizeImpactRows = (impactRows = []) => (
  (impactRows || [])
    .map((row, idx) => {
      const beforeRows = toNum(row.before_rows ?? row.rows_before, 0);
      const afterRows = toNum(row.after_rows ?? row.rows_after, 0);
      const matchedRows = toNum(row.matched_rows, 0);
      const coveragePct = row.coverage_pct == null
        ? (beforeRows > 0 ? (matchedRows / beforeRows) * 100 : null)
        : toNum(row.coverage_pct, null);

      return {
        step: toNum(row.step ?? row.idx, idx + 1),
        source: row.source || row.right || '',
        fromSource: row.from_source || row.left || '',
        key: row.join_key || row.key || '-',
        joinType: String(row.join_type || 'left').toLowerCase(),
        beforeRows,
        afterRows,
        matchedRows,
        coveragePct,
        nullImpactPct: row.null_impact_pct == null ? null : toNum(row.null_impact_pct, 0),
      };
    })
    .filter((row) => row.source)
);

// ── Layout engine ──────────────────────────────────────────────────────────────
/**
 * Topological sort of nodes into columns (BFS from anchor).
 * Returns: { nodes: [{id, col, row, x, y, ...}], edges: [{...}] }
 */
function buildLayout(datasets, joins, anchorType, impactRows = [], masterRowCount) {
  const safe = (s) => String(s || '').trim().toLowerCase();
  const anchor = safe(anchorType);

  // Build adjacency from enabled joins
  const enabledJoins = (joins || []).filter((j) => j.enabled !== false);

  // Collect all node ids that are actually referenced
  const nodeIds = new Set([anchor]);
  enabledJoins.forEach((j) => {
    nodeIds.add(safe(j.left));
    nodeIds.add(safe(j.right));
  });

  // BFS from anchor to assign columns
  const colOf  = { [anchor]: 0 };
  const queue  = [anchor];
  const visited = new Set([anchor]);

  while (queue.length) {
    const cur = queue.shift();
    const col = colOf[cur];
    enabledJoins.forEach((j) => {
      const l = safe(j.left);
      const r = safe(j.right);
      let next = null;
      if (l === cur && !visited.has(r)) next = r;
      if (r === cur && !visited.has(l)) next = l;
      if (next) {
        colOf[next] = col + 1;
        visited.add(next);
        queue.push(next);
      }
    });
  }

  // Any unreachable node gets pushed to a side column
  nodeIds.forEach((id) => {
    if (!(id in colOf)) colOf[id] = Math.max(...Object.values(colOf)) + 1;
  });

  // Group by column
  const cols = {};
  Object.entries(colOf).forEach(([id, col]) => {
    if (!cols[col]) cols[col] = [];
    cols[col].push(id);
  });

  // Find dataset meta
  const dsByType = {};
  (datasets || []).forEach((d) => {
    dsByType[safe(d.dataset_type)] = d;
  });

  // Impact lookup by source name
  const impactBySource = {};
  normalizeImpactRows(impactRows).forEach((imp) => {
    impactBySource[safe(imp.source || '')] = imp;
  });

  // Assign x/y
  const nodes = [];
  const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
  colNums.forEach((colNum) => {
    const ids = cols[colNum];
    ids.forEach((id, rowIdx) => {
      const ds   = dsByType[id] || {};
      const imp  = impactBySource[id];
      nodes.push({
        id,
        col:        colNum,
        row:        rowIdx,
        x:          C.padX + colNum * (C.nodeW + C.hGap),
        y:          C.padY + rowIdx * (C.nodeH + C.vGap),
        isAnchor:   id === anchor,
        isMaster:   false,
        rowCount:   ds.row_count ?? null,
        datasetType: ds.dataset_type || id,
        coverage:   imp ? imp.coveragePct : null,
        matchedRows: imp ? imp.matchedRows : null,
        nullImpact: imp ? imp.nullImpactPct : null,
      });
    });
  });

  // Add a "MASTER" sink node in the rightmost column + 1
  const maxCol  = Math.max(...nodes.map((n) => n.col));
  const masterX = C.padX + (maxCol + 1) * (C.nodeW + C.hGap);
  const masterY = C.padY;
  const anchorNode = nodes.find((n) => n.isAnchor);
  nodes.push({
    id:         '__master__',
    col:        maxCol + 1,
    row:        0,
    x:          masterX,
    y:          masterY,
    isAnchor:   false,
    isMaster:   true,
    rowCount:   masterRowCount ?? anchorNode?.rowCount ?? null,
    datasetType: 'MASTER DATASET',
    coverage:   null,
    matchedRows: null,
    nullImpact: null,
  });

  // Build edges
  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });

  const edges = enabledJoins
    .map((j) => {
      const l = safe(j.left);
      const r = safe(j.right);
      const src = nodeMap[l];
      const tgt = nodeMap[r];
      if (!src || !tgt) return null;
      // Direction: lower col → higher col
      const [from, to] = src.col <= tgt.col ? [src, tgt] : [tgt, src];
      const imp = impactBySource[to.id];
      return {
        id:         `${j.id || j.left}_${j.right}`,
        from,
        to,
        key:        j.key,
        joinType:   j.join_type || 'left',
        coverage:   imp?.coveragePct ?? null,
        matchedRows: imp?.matchedRows ?? null,
      };
    })
    .filter(Boolean);

  // Add a final edge from anchor to master
  if (anchorNode) {
    edges.push({
      id:         '__master_edge__',
      from:       anchorNode,
      to:         nodeMap['__master__'],
      key:        null,
      joinType:   null,
      coverage:   100,
      matchedRows: masterRowCount ?? anchorNode.rowCount,
      isMasterEdge: true,
    });
  }

  // Canvas size
  const maxX = Math.max(...nodes.map((n) => n.x)) + C.nodeW + C.padX;
  const maxY = Math.max(...nodes.map((n) => n.y)) + C.nodeH + C.padY;

  return { nodes, edges, width: maxX, height: maxY };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DagNode({ node, selected, onClick }) {
  const bgColor = node.isMaster
    ? C.orange
    : node.isAnchor
    ? '#0f172a'
    : '#ffffff';
  const textColor = (node.isMaster || node.isAnchor) ? '#fff' : C.text;
  const borderColor = selected ? C.orange
    : node.isMaster  ? C.orange
    : node.isAnchor  ? '#0f172a'
    : C.border;

  const covPct = node.coverage;
  const indicator =
    covPct == null ? null
    : covPct >= 80 ? <CheckCircleOutline sx={{ fontSize: 11, color: C.green }} />
    : covPct >= 50 ? <WarningAmberOutlined sx={{ fontSize: 11, color: C.amber }} />
    : <ErrorOutline sx={{ fontSize: 11, color: C.red }} />;

  return (
    <Tooltip
      title={
        node.isMaster || node.isAnchor ? '' : (
          <Box sx={{ fontSize: 12, lineHeight: 1.6 }}>
            <b>{node.datasetType}</b><br />
            Rows: {fmt(node.rowCount)}<br />
            {covPct != null && <>Coverage: {covPct.toFixed(1)}%<br /></>}
            {node.matchedRows != null && <>Matched: {fmt(node.matchedRows)}<br /></>}
            {node.nullImpact != null && <>Null impact: {node.nullImpact.toFixed(1)}%</>}
          </Box>
        )
      }
      placement="top"
      arrow
    >
      <g
        onClick={() => onClick(node)}
        style={{ cursor: 'pointer' }}
        transform={`translate(${node.x}, ${node.y})`}
      >
        {/* Shadow */}
        <rect
          x={2} y={2}
          width={C.nodeW} height={C.nodeH}
          rx={8}
          fill="rgba(0,0,0,0.06)"
        />
        {/* Node body */}
        <rect
          width={C.nodeW} height={C.nodeH}
          rx={8}
          fill={bgColor}
          stroke={borderColor}
          strokeWidth={selected ? 2 : 1.5}
        />
        {/* Coverage bar (bottom strip) */}
        {covPct != null && !node.isMaster && (
          <>
            <rect
              x={0} y={C.nodeH - 5}
              width={C.nodeW} height={5}
              rx={0}
              style={{ borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}
              fill="#e2e8f0"
            />
            <rect
              x={0} y={C.nodeH - 5}
              width={C.nodeW * covPct / 100} height={5}
              fill={coverageColor(covPct)}
            />
          </>
        )}
        {/* Label */}
        <text
          x={C.nodeW / 2}
          y={node.isMaster || node.isAnchor ? 26 : 22}
          textAnchor="middle"
          fill={textColor}
          style={{
            fontSize: node.isMaster ? 11 : 11.5,
            fontWeight: 700,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
          }}
        >
          {String(node.datasetType).toUpperCase()}
        </text>
        {/* Row count */}
        <text
          x={C.nodeW / 2}
          y={node.isMaster || node.isAnchor ? 44 : 40}
          textAnchor="middle"
          fill={node.isMaster || node.isAnchor ? 'rgba(255,255,255,0.75)' : C.muted}
          style={{ fontSize: 11, fontFamily: 'sans-serif' }}
        >
          {fmtK(node.rowCount)} rows
        </text>
        {/* Coverage badge */}
        {covPct != null && (
          <text
            x={C.nodeW / 2}
            y={58}
            textAnchor="middle"
            fill={coverageColor(covPct)}
            style={{ fontSize: 10, fontFamily: 'sans-serif', fontWeight: 600 }}
          >
            {covPct.toFixed(0)}% coverage
          </text>
        )}
        {/* Anchor star */}
        {node.isAnchor && (
          <text
            x={C.nodeW - 10} y={14}
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
            style={{ fontSize: 10 }}
          >
            ⚓
          </text>
        )}
      </g>
    </Tooltip>
  );
}

function DagEdge({ edge, svgId }) {
  // Elbow path: from right-center of source to left-center of target
  const x1 = edge.from.x + C.nodeW;
  const y1 = edge.from.y + C.nodeH / 2;
  const x2 = edge.to.x;
  const y2 = edge.to.y + C.nodeH / 2;
  const midX = (x1 + x2) / 2;

  const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  const cov   = edge.coverage;
  const edgeColor = edge.isMasterEdge ? C.orange : coverageColor(cov);
  const gradId = `grad-${svgId}-${edge.id}`;
  const animId = `anim-${svgId}-${edge.id}`;

  const labelX = midX;
  const labelY = Math.min(y1, y2) - 6;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor={edgeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={edgeColor} stopOpacity="1" />
        </linearGradient>
        {/* Animated dot along path */}
        <circle id={animId} r={3} fill={edgeColor} opacity="0.85" />
      </defs>

      {/* Backdrop (wider, faint) */}
      <path
        d={pathD}
        fill="none"
        stroke={edgeColor}
        strokeWidth={6}
        strokeOpacity={0.08}
      />
      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={edge.isMasterEdge ? 2.5 : 2}
        strokeDasharray={edge.isMasterEdge ? 'none' : '6 3'}
      />
      {/* Arrowhead */}
      <polygon
        points={`${x2},${y2} ${x2 - 8},${y2 - 4} ${x2 - 8},${y2 + 4}`}
        fill={edgeColor}
        opacity="0.8"
      />

      {/* Edge label group */}
      {!edge.isMasterEdge && (edge.key || cov != null) && (
        <g>
          <rect
            x={labelX - 36} y={labelY - 12}
            width={72} height={15}
            rx={4}
            fill="white"
            stroke={C.border}
            strokeWidth={1}
          />
          <text
            x={labelX} y={labelY - 2}
            textAnchor="middle"
            fill={C.text}
            style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 600 }}
          >
            {edge.key ? String(edge.key).replace(/_id$/i, '_id') : ''}
          </text>
        </g>
      )}

      {/* Join type pill */}
      {!edge.isMasterEdge && edge.joinType && (
        <g>
          <rect
            x={labelX - 18} y={labelY + 5}
            width={36} height={12}
            rx={3}
            fill={joinTypeColor(edge.joinType)}
            opacity={0.15}
          />
          <text
            x={labelX} y={labelY + 14}
            textAnchor="middle"
            fill={joinTypeColor(edge.joinType)}
            style={{ fontSize: 8.5, fontFamily: 'sans-serif', fontWeight: 700 }}
          >
            {JOIN_TYPE_LABELS[edge.joinType?.toLowerCase()] || edge.joinType?.toUpperCase()}
          </text>
        </g>
      )}
    </g>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────
function Legend() {
  const items = [
    { color: '#0f172a', label: 'Anchor (base grain)' },
    { color: C.orange,  label: 'Master output' },
    { color: C.green,   label: '≥80% coverage' },
    { color: C.amber,   label: '50–80% coverage' },
    { color: C.red,     label: '<50% coverage' },
  ];
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
      {items.map(({ color, label }) => (
        <Stack key={label} direction="row" alignItems="center" spacing={0.6}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
          <Typography sx={{ fontSize: 10.5, color: C.muted }}>{label}</Typography>
        </Stack>
      ))}
      <Stack direction="row" alignItems="center" spacing={0.6}>
        <Box sx={{ width: 18, height: 2, bgcolor: C.blue, opacity: 0.5, borderTop: '1px dashed' + C.blue }} />
        <Typography sx={{ fontSize: 10.5, color: C.muted }}>LEFT join</Typography>
      </Stack>
    </Stack>
  );
}

// ── Selected edge inspector ────────────────────────────────────────────────────
function EdgeInspector({ edge }) {
  if (!edge) return null;
  const cov = edge.coverage;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fafafa', mt: 1.5 }}
    >
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: C.text, mb: 0.75 }}>
        Join inspector - {String(edge.from.id).toUpperCase()} → {String(edge.to.id).toUpperCase()}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        {[
          { label: 'Key',          value: edge.key || '-' },
          { label: 'Join type',    value: JOIN_TYPE_LABELS[edge.joinType?.toLowerCase()] || edge.joinType },
          { label: 'Matched rows', value: fmt(edge.matchedRows) },
          { label: 'Coverage',     value: cov != null ? `${cov.toFixed(1)}%` : '-',
            color: coverageColor(cov), bg: coverageBg(cov) },
        ].map(({ label, value, color, bg }) => (
          <Box
            key={label}
            sx={{ px: 1.25, py: 0.6, borderRadius: 1, bgcolor: bg || '#f1f5f9',
                  border: `1px solid ${C.border}` }}
          >
            <Typography sx={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {label}
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: color || C.text }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

// ── Grain advice banner ─────────────────────────────────────────────────────────
function GrainAdvice({ anchorType, datasets }) {
  const safe = (s) => String(s || '').trim().toLowerCase();
  const anchor = safe(anchorType);
  const hasAlerts = (datasets || []).some((d) => safe(d.dataset_type) === 'alerts');
  const hasTransactions = (datasets || []).some((d) => safe(d.dataset_type) === 'transactions');

  if (!hasAlerts) return null;
  if (anchor === 'alerts') {
    return (
      <Stack direction="row" spacing={1} alignItems="center"
        sx={{ px: 1.5, py: 1, borderRadius: 1.5, bgcolor: '#f0fdf4',
              border: '1px solid #bbf7d0', mb: 1.5 }}>
        <CheckCircleOutline sx={{ fontSize: 16, color: C.green }} />
        <Typography sx={{ fontSize: 12, color: '#166534' }}>
          <b>Correct grain.</b> Using <code>alerts</code> as anchor - each master row = one alert decision.
          Master dataset will have ~{fmtK((datasets.find((d) => safe(d.dataset_type) === 'alerts'))?.row_count)} rows (same as alerts).
        </Typography>
      </Stack>
    );
  }
  if (anchor === 'transactions' && hasAlerts) {
    return (
      <Stack direction="row" spacing={1} alignItems="flex-start"
        sx={{ px: 1.5, py: 1, borderRadius: 1.5, bgcolor: '#fef3c7',
              border: '1px solid #fcd34d', mb: 1.5 }}>
        <WarningAmberOutlined sx={{ fontSize: 16, color: C.amber, mt: 0.1 }} />
        <Box>
          <Typography sx={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>
            Wrong grain for AML FP suppression.
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: '#92400e' }}>
            Using <code>transactions</code> as anchor will produce ~{fmtK((datasets.find((d) => safe(d.dataset_type) === 'transactions'))?.row_count)} rows,
            but only ~{fmtK((datasets.find((d) => safe(d.dataset_type) === 'alerts'))?.row_count)} will have a label.
            The rest will be unlabelled noise. Switch anchor to <b>alerts</b> - your master will correctly have one row per alert decision.
          </Typography>
        </Box>
      </Stack>
    );
  }
  return null;
}

const buildRowMathAudit = ({
  datasets = [],
  anchorType = '',
  impactRows = [],
  masterRowCount = null,
  labelSummary = null,
  rollupAudit = [],
  aggregatedJoinSteps = [],
}) => {
  const byType = {};
  (datasets || []).forEach((ds) => {
    byType[String(ds.dataset_type || '').trim().toLowerCase()] = ds;
  });

  const steps = normalizeImpactRows(impactRows).sort((a, b) => a.step - b.step);
  const anchorKey = String(anchorType || '').trim().toLowerCase();
  const anchorRows = toNum(
    byType[anchorKey]?.row_count
      ?? steps[0]?.beforeRows
      ?? labelSummary?.n_total
      ?? masterRowCount,
    0,
  );

  const rollups = (rollupAudit || [])
    .map((rollup, idx) => {
      const sourceRows = toNum(rollup.sourceRows, 0);
      const summaryRows = toNum(rollup.summaryRows, 0);
      const compressedRows = Math.max(sourceRows - summaryRows, 0);
      return {
        id: `${String(rollup.eventTable || 'event').toLowerCase()}_${idx}`,
        eventTable: rollup.eventTable || `event_${idx + 1}`,
        key: rollup.key || 'account_id',
        sourceRows,
        summaryRows,
        compressedRows,
      };
    })
    .filter((row) => row.sourceRows > 0 || row.summaryRows > 0);
  const aggregatedCount = (aggregatedJoinSteps || []).filter((step) => Boolean(step?.was_aggregated)).length
    || (aggregatedJoinSteps || []).length;

  const joinTimeline = steps.map((step, idx) => {
    const deltaRows = step.afterRows - step.beforeRows;
    const droppedRows = Math.max(step.beforeRows - step.afterRows, 0);
    const isInner = step.joinType === 'inner';
    const isLeft = step.joinType === 'left';
    return {
      id: `join_${idx + 1}`,
      label: `${JOIN_TYPE_LABELS[step.joinType] || String(step.joinType || 'left').toUpperCase()} join: ${step.source} on ${step.key || '-'}`,
      beforeRows: step.beforeRows,
      afterRows: step.afterRows,
      deltaRows,
      droppedRows,
      reason: isInner
        ? `${fmt(droppedRows)} rows were removed because INNER join keeps only matched keys.`
        : isLeft
        ? `${fmt(Math.max(step.beforeRows - step.matchedRows, 0))} unmatched rows were retained with null enrichment columns.`
        : `Join changed rows by ${signed(deltaRows)} because of join cardinality.`,
    };
  });

  const rowsAfterJoins = joinTimeline.length ? joinTimeline[joinTimeline.length - 1].afterRows : anchorRows;
  const totalForLabel = toNum(labelSummary?.n_total, rowsAfterJoins);
  const labelledRows = toNum(labelSummary?.n_labelled, masterRowCount ?? totalForLabel);
  const excludedRows = toNum(labelSummary?.n_excluded, Math.max(totalForLabel - labelledRows, 0));
  const finalRows = toNum(masterRowCount, labelledRows || rowsAfterJoins || anchorRows);

  const timeline = [
    {
      id: 'anchor',
      label: `Anchor rows (${anchorType || 'alerts'})`,
      beforeRows: anchorRows,
      afterRows: anchorRows,
      deltaRows: 0,
      reason: 'Every downstream step starts from this base grain.',
    },
  ];

  rollups.forEach((rollup, idx) => {
    timeline.push({
      id: `rollup_${idx + 1}`,
      label: `${rollup.eventTable} rollup on ${rollup.key}`,
      beforeRows: rollup.sourceRows,
      afterRows: rollup.summaryRows,
      deltaRows: rollup.summaryRows - rollup.sourceRows,
      reason: `${fmt(rollup.compressedRows)} repeated event rows were collapsed before join.`,
    });
  });

  timeline.push(...joinTimeline);

  if (totalForLabel > 0 || excludedRows > 0) {
    timeline.push({
      id: 'label',
      label: 'Label eligibility (str_label)',
      beforeRows: totalForLabel,
      afterRows: labelledRows,
      deltaRows: labelledRows - totalForLabel,
      reason: `${fmt(excludedRows)} rows had no reliable label signal (no STR link and no closed case outcome).`,
    });
  }

  timeline.push({
    id: 'final',
    label: 'Final master dataset rows',
    beforeRows: finalRows,
    afterRows: finalRows,
    deltaRows: 0,
    reason: 'Final output size used for training.',
  });

  const innerJoinDrops = joinTimeline
    .filter((row) => String(row.label || '').startsWith('INNER'))
    .reduce((sum, row) => sum + toNum(row.droppedRows, 0), 0);

  const importantDrop = innerJoinDrops > 0
    ? {
      ok: false,
      title: 'Important rows dropped by INNER joins',
      text: `${fmt(innerJoinDrops)} anchor rows were removed by INNER joins. Validate whether this was intentional.`,
    }
    : {
      ok: true,
      title: 'No anchor rows dropped during joins',
      text: 'LEFT joins preserve anchor rows; unmatched records only add nulls in joined columns.',
    };

  return {
    anchorRows,
    finalRows,
    totalRollupCompressed: rollups.reduce((sum, row) => sum + row.compressedRows, 0),
    excludedRows,
    aggregatedCount,
    timeline,
    importantDrop,
  };
};

function RowMathAudit({ audit }) {
  if (!audit) return null;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, mt: 1.5, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${C.border}`, bgcolor: '#f8fafc' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: C.text }}>
          Row math audit (plain English)
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: C.muted, mt: 0.25 }}>
          Exact before/after row counts for squeeze, join, and label steps.
        </Typography>
      </Box>

      <Box sx={{ p: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={`anchor ${fmt(audit.anchorRows)}`} sx={{ bgcolor: C.blueBg, color: C.blue, fontSize: 10 }} />
          <Chip size="small" label={`final ${fmt(audit.finalRows)}`} sx={{ bgcolor: C.orangeSoft, color: C.orange, fontSize: 10 }} />
          <Chip size="small" label={`rollup compressed ${fmt(audit.totalRollupCompressed)}`} sx={{ fontSize: 10 }} />
          <Chip size="small" label={`${fmt(audit.aggregatedCount)} aggregated joins`} sx={{ fontSize: 10 }} />
          <Chip size="small" label={`label excluded ${fmt(audit.excludedRows)}`} sx={{ fontSize: 10 }} />
        </Stack>

        <Box sx={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Step', 'Operation', 'Before', 'After', 'Change', 'Reason'].map((head) => (
                  <th
                    key={head}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: `1px solid ${C.border}`,
                      fontSize: 10,
                      color: C.muted,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(audit.timeline || []).map((row, idx) => {
                const delta = toNum(row.deltaRows, 0);
                const deltaColor = delta < 0 ? C.red : delta > 0 ? C.green : C.muted;
                return (
                  <tr key={row.id} style={{ background: idx % 2 ? '#f8fafc' : '#fff' }}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text, verticalAlign: 'top' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text, fontWeight: 700, verticalAlign: 'top' }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text, verticalAlign: 'top' }}>{fmt(row.beforeRows)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text, verticalAlign: 'top' }}>{fmt(row.afterRows)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: deltaColor, fontWeight: 700, verticalAlign: 'top' }}>{signed(row.deltaRows)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 10.5, color: C.text, lineHeight: 1.35, verticalAlign: 'top' }}>{row.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>

        <Box
          sx={{
            mt: 1,
            border: `1px solid ${audit.importantDrop.ok ? '#86efac' : '#fdba74'}`,
            borderRadius: 1,
            p: 1,
            bgcolor: audit.importantDrop.ok ? '#f0fdf4' : '#fff7ed',
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 800, color: audit.importantDrop.ok ? '#166534' : '#9a3412' }}>
            {audit.importantDrop.title}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: audit.importantDrop.ok ? '#166534' : '#9a3412', mt: 0.25 }}>
            {audit.importantDrop.text}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
let _idCounter = 0;

export default function JoinDagViewer({
  datasets     = [],
  joins        = [],
  anchorType   = '',
  impactRows   = [],
  masterRowCount = null,
  labelSummary = null,
  rollupAudit = [],
  aggregatedJoinSteps = [],
}) {
  const [svgId]           = useState(() => `dag-${_idCounter++}`);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const containerRef      = useRef(null);

  const { nodes, edges, width, height } = useMemo(
    () => buildLayout(datasets, joins, anchorType, impactRows, masterRowCount),
    [datasets, joins, anchorType, impactRows, masterRowCount],
  );
  const audit = useMemo(
    () => buildRowMathAudit({
      datasets,
      anchorType,
      impactRows,
      masterRowCount,
      labelSummary,
      rollupAudit,
      aggregatedJoinSteps,
    }),
    [datasets, anchorType, impactRows, masterRowCount, labelSummary, rollupAudit, aggregatedJoinSteps],
  );

  const enabledJoinCount = (joins || []).filter((j) => j.enabled !== false).length;

  const handleEdgeClick = (edge) => {
    setSelectedEdge((prev) => prev?.id === edge.id ? null : edge);
    setSelectedNode(null);
  };
  const handleNodeClick = (node) => {
    setSelectedNode((prev) => prev?.id === node.id ? null : node);
    setSelectedEdge(null);
  };

  if (!datasets.length && !joins.length) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 3, textAlign: 'center' }}>
        <AccountTree sx={{ fontSize: 36, color: C.muted, mb: 1 }} />
        <Typography sx={{ fontSize: 13, color: C.muted }}>
          Upload datasets and configure joins to see the pipeline DAG.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, bgcolor: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <AccountTree sx={{ fontSize: 16, color: C.orange }} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
              Join pipeline - visual DAG
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Chip
              size="small"
              label={`${nodes.filter((n) => !n.isMaster).length} datasets`}
              sx={{ fontSize: 10, bgcolor: C.blueBg, color: C.blue }}
            />
            <Chip
              size="small"
              label={`${enabledJoinCount} joins`}
              sx={{ fontSize: 10 }}
            />
            {masterRowCount != null && (
              <Chip
                size="small"
                label={`${fmtK(masterRowCount)} master rows`}
                sx={{ fontSize: 10, bgcolor: '#fff1ec', color: C.orange }}
              />
            )}
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: 1.75 }}>
        {/* Grain advice */}
        <GrainAdvice anchorType={anchorType} datasets={datasets} />

        {/* Legend */}
        <Box sx={{ mb: 1.5 }}>
          <Legend />
        </Box>

        {/* SVG canvas */}
        <Box
          ref={containerRef}
          sx={{
            overflowX: 'auto',
            overflowY: 'visible',
            pb: 0.5,
            border: `1px solid ${C.border}`,
            borderRadius: 1.5,
            bgcolor: '#fafbfc',
          }}
        >
          <svg
            width={width}
            height={height}
            style={{ display: 'block', minWidth: width }}
          >
            {/* Grid dots */}
            <defs>
              <pattern id={`dot-${svgId}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#e2e8f0" />
              </pattern>
            </defs>
            <rect width={width} height={height} fill={`url(#dot-${svgId})`} />

            {/* Edges (below nodes) */}
            {edges.map((edge) => (
              <g
                key={edge.id}
                onClick={() => handleEdgeClick(edge)}
                style={{ cursor: 'pointer' }}
              >
                <DagEdge edge={edge} svgId={svgId} />
              </g>
            ))}

            {/* Nodes */}
            {nodes.map((node) => (
              <DagNode
                key={node.id}
                node={node}
                selected={selectedNode?.id === node.id}
                onClick={handleNodeClick}
              />
            ))}
          </svg>
        </Box>

        {/* Edge inspector (shown when an edge is clicked) */}
        {selectedEdge && !selectedEdge.isMasterEdge && (
          <EdgeInspector edge={selectedEdge} />
        )}

        {/* Node inspector (shown when a node is clicked) */}
        {selectedNode && !selectedNode.isMaster && (
          <Paper
            variant="outlined"
            sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fafafa', mt: 1.5 }}
          >
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: C.text, mb: 0.75 }}>
              Dataset inspector - {String(selectedNode.datasetType).toUpperCase()}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              {[
                { label: 'Row count',   value: fmt(selectedNode.rowCount) },
                { label: 'Role',        value: selectedNode.isAnchor ? 'Anchor (base grain)' : 'Joined dimension' },
                { label: 'Coverage',    value: selectedNode.coverage != null ? `${selectedNode.coverage.toFixed(1)}%` : '-',
                  color: coverageColor(selectedNode.coverage), bg: coverageBg(selectedNode.coverage) },
                { label: 'Matched rows', value: fmt(selectedNode.matchedRows) },
              ].map(({ label, value, color, bg }) => (
                <Box
                  key={label}
                  sx={{ px: 1.25, py: 0.6, borderRadius: 1,
                        bgcolor: bg || '#f1f5f9', border: `1px solid ${C.border}` }}
                >
                  <Typography sx={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {label}
                  </Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: color || C.text }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}

        <RowMathAudit audit={audit} />
      </Box>
    </Paper>
  );
}
