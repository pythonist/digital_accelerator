import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowDownward,
  ArrowForward,
  ArrowUpward,
  CallMade,
  CallReceived,
} from '@mui/icons-material';

const nodeTone = {
  case: '#ea580c',
  customer: '#0f766e',
  account: '#2563eb',
  counterparty: '#475569',
  alert: '#7c3aed',
};

const fmtCurrency = (num) => {
  const val = Number(num || 0);
  if (!val || Number.isNaN(val)) return '0';
  return Number.isInteger(val)
    ? val.toLocaleString()
    : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const NetworkGraphView = ({ graph, onSelectNode, selectedNodeId }) => {
  const [showAmounts, setShowAmounts] = useState(true);
  const [showArrows, setShowArrows] = useState(true);
  const [hoveredLink, setHoveredLink] = useState(null);

  const layout = useMemo(() => {
    const nodes = graph?.nodes || [];
    const groups = {
      case: nodes.filter((item) => item.type === 'case'),
      customer: nodes.filter((item) => item.type === 'customer'),
      account: nodes.filter((item) => item.type === 'account'),
      counterparty: nodes.filter((item) => item.type === 'counterparty'),
      alert: nodes.filter((item) => item.type === 'alert'),
    };
    const columns = ['case', 'customer', 'account', 'counterparty', 'alert'];
    const positions = {};
    columns.forEach((key, columnIndex) => {
      (groups[key] || []).forEach((node, rowIndex) => {
        positions[node.id] = {
          x: 110 + (columnIndex * 220),
          y: 90 + (rowIndex * 94),
          color: nodeTone[key] || '#64748b',
        };
      });
    });
    const computedHeight = Math.max(460, ...Object.values(positions).map((item) => item.y + 100), 460);
    return {
      positions,
      height: computedHeight,
      width: 1080,
    };
  }, [graph]);

  const links = graph?.links || [];
  const nodes = graph?.nodes || [];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, bgcolor: '#ffffff', overflow: 'hidden' }}>
      {/* ── Top Toolbar & Legend ── */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ pb: 1.5, mb: 1.5, borderBottom: '1px solid #f1f5f9' }}
      >
        {/* Node & Flow Legend */}
        <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Nodes:
          </Typography>
          {Object.entries(nodeTone).map(([type, color]) => (
            <Stack key={type} direction="row" spacing={0.65} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: color }} />
              <Typography sx={{ fontSize: 11.5, color: '#475569', textTransform: 'capitalize', fontWeight: 600 }}>
                {type}
              </Typography>
            </Stack>
          ))}
          <Box sx={{ width: 1, height: 14, bgcolor: '#cbd5e1', mx: 0.5 }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Flows:
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CallMade sx={{ fontSize: 14, color: '#ea580c' }} />
            <Typography sx={{ fontSize: 11.5, color: '#ea580c', fontWeight: 700 }}>
              Outflow (Debit)
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CallReceived sx={{ fontSize: 14, color: '#16a34a' }} />
            <Typography sx={{ fontSize: 11.5, color: '#16a34a', fontWeight: 700 }}>
              Inflow (Credit)
            </Typography>
          </Stack>
        </Stack>

        {/* Display Toggles */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={showAmounts}
                onChange={(e) => setShowAmounts(e.target.checked)}
                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#ea580c' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#ea580c' } }}
              />
            )}
            label={<Typography sx={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>Amounts</Typography>}
          />
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={showArrows}
                onChange={(e) => setShowArrows(e.target.checked)}
                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#ea580c' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#ea580c' } }}
              />
            )}
            label={<Typography sx={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>Flow Arrows</Typography>}
          />
        </Stack>
      </Stack>

      {/* ── SVG Graph Canvas ── */}
      <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '72vh', border: '1px solid #f8fafc', borderRadius: 2, bgcolor: '#fafbfc' }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <defs>
            {/* Outflow Arrowhead (Orange/Red) */}
            <marker id="arrow-outflow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" fill="#ea580c" />
            </marker>
            {/* Inflow Arrowhead (Green) */}
            <marker id="arrow-inflow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" fill="#16a34a" />
            </marker>
            {/* General Relation Arrowhead (Slate) */}
            <marker id="arrow-relation" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M 0 1 L 6 3.5 L 0 6 z" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Render Links */}
          {links.map((link, index) => {
            const source = layout.positions[link.source];
            const target = layout.positions[link.target];
            if (!source || !target) return null;

            const isTxn = link.relationship_type === 'transacted_with' || Number(link.amount || link.volume || 0) > 0;
            const amountVal = Number(link.amount || link.volume || 0);
            const isCredit = String(link.direction || '').toLowerCase().includes('credit')
              || String(link.direction || '').toLowerCase().includes('in');
            const isDebit = !isCredit; // Default transactions are debits/outflows

            // Calculate trimmed endpoints so arrows point clearly at the edge of the node circle
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt((dx * dx) + (dy * dy)) || 1;
            const nodeRadius = 18;

            let startX = source.x;
            let startY = source.y;
            let endX = target.x;
            let endY = target.y;

            if (isCredit) {
              // Flow from Target (Counterparty) -> Source (Account)
              startX = target.x - (dx / dist) * nodeRadius;
              startY = target.y - (dy / dist) * nodeRadius;
              endX = source.x + (dx / dist) * (nodeRadius + 6);
              endY = source.y + (dy / dist) * (nodeRadius + 6);
            } else {
              // Flow from Source (Account) -> Target (Counterparty)
              startX = source.x + (dx / dist) * nodeRadius;
              startY = source.y + (dy / dist) * nodeRadius;
              endX = target.x - (dx / dist) * (nodeRadius + 6);
              endY = target.y - (dy / dist) * (nodeRadius + 6);
            }

            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            const strokeColor = isTxn ? (isCredit ? '#86efac' : '#fdba74') : '#cbd5e1';
            const strokeWidth = isTxn ? Math.min(3.5, Math.max(1.5, amountVal / 60000)) : 1.25;
            const markerId = showArrows ? (isTxn ? (isCredit ? 'url(#arrow-inflow)' : 'url(#arrow-outflow)') : 'url(#arrow-relation)') : undefined;

            return (
              <g
                key={`link_${index + 1}`}
                onMouseEnter={() => setHoveredLink(link)}
                onMouseLeave={() => setHoveredLink(null)}
                style={{ cursor: isTxn ? 'pointer' : 'default' }}
              >
                {/* Visual Line */}
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={isTxn ? undefined : '4 3'}
                  markerEnd={markerId}
                />

                {/* Amount & Direction Badge */}
                {isTxn && showAmounts && amountVal > 0 && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x="-38"
                      y="-11"
                      width="76"
                      height="20"
                      rx="10"
                      fill={isCredit ? '#f0fdf4' : '#fff7ed'}
                      stroke={isCredit ? '#16a34a' : '#ea580c'}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      style={{
                        fontSize: 9.5,
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        fill: isCredit ? '#15803d' : '#c2410c',
                      }}
                    >
                      {isCredit ? '← ' : '→ '}{fmtCurrency(amountVal)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Render Nodes */}
          {nodes.map((node) => {
            const point = layout.positions[node.id];
            if (!point) return null;
            const selected = selectedNodeId === node.id;
            const radius = selected ? 21 : (node.focal ? 18 : 15);

            return (
              <g
                key={node.id}
                onClick={() => onSelectNode?.(node)}
                style={{ cursor: 'pointer' }}
              >
                {/* Halo for focal or selected nodes */}
                {(selected || node.focal) && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={radius + 4}
                    fill="none"
                    stroke={point.color}
                    strokeWidth="2"
                    strokeDasharray={node.focal ? '3 2' : undefined}
                    opacity={0.65}
                  />
                )}

                {/* Main Node Circle */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  fill={point.color}
                  opacity={selected ? 1 : 0.94}
                  style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }}
                />

                {/* Node Label */}
                <text
                  x={point.x}
                  y={point.y + 32}
                  textAnchor="middle"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    fill: '#1e293b',
                    paintOrder: 'stroke',
                    stroke: '#ffffff',
                    strokeWidth: 2.5,
                    strokeLinejoin: 'round',
                  }}
                >
                  {String(node.label || node.id).slice(0, 24)}
                </text>

                {/* Subtitle / Type Tag */}
                <text
                  x={point.x}
                  y={point.y + 44}
                  textAnchor="middle"
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    fill: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                  }}
                >
                  {node.type}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>

      {/* ── Active Hover Info Callout ── */}
      {hoveredLink && hoveredLink.amount > 0 && (
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a' }}>
              Transaction: {hoveredLink.id || 'Selected Flow'}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: hoveredLink.direction?.includes('credit') ? '#16a34a' : '#ea580c', fontWeight: 700 }}>
              Amount: {fmtCurrency(hoveredLink.amount)} ({hoveredLink.direction?.toUpperCase() || 'OUTFLOW'})
            </Typography>
            {hoveredLink.channel && (
              <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
                Channel: <strong>{hoveredLink.channel}</strong>
              </Typography>
            )}
            {hoveredLink.timestamp && (
              <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
                Date: <strong>{new Date(hoveredLink.timestamp).toLocaleDateString()}</strong>
              </Typography>
            )}
            {hoveredLink.beneficiary_country && (
              <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
                Country: <strong>{hoveredLink.beneficiary_country}</strong>
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};

export default NetworkGraphView;
