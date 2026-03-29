import React, { useMemo } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

const nodeTone = {
  case: '#ea580c',
  customer: '#0f766e',
  account: '#2563eb',
  counterparty: '#475569',
  alert: '#7c3aed',
};

const NetworkGraphView = ({ graph, onSelectNode, selectedNodeId }) => {
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
          x: 110 + (columnIndex * 190),
          y: 90 + (rowIndex * 94),
          color: nodeTone[key] || '#64748b',
        };
      });
    });
    return { positions, height: Math.max(420, ...Object.values(positions).map((item) => item.y + 80), 420), width: 980 };
  }, [graph]);

  const links = graph?.links || [];
  const nodes = graph?.nodes || [];

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, overflow: 'auto' }}>
      <Stack direction="row" spacing={2.5} sx={{ mb: 1.5 }}>
        {Object.entries(nodeTone).map(([type, color]) => (
          <Stack key={type} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: 99, backgroundColor: color }} />
            <Typography sx={{ fontSize: 11.5, color: '#475569', textTransform: 'capitalize' }}>{type}</Typography>
          </Stack>
        ))}
      </Stack>
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        {links.map((link, index) => {
          const source = layout.positions[link.source];
          const target = layout.positions[link.target];
          if (!source || !target) return null;
          return (
            <line
              key={`link_${index + 1}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="#cbd5e1"
              strokeWidth={Math.min(4, Math.max(1, Number(link.volume || 0) / 50000))}
            />
          );
        })}
        {nodes.map((node) => {
          const point = layout.positions[node.id];
          if (!point) return null;
          const selected = selectedNodeId === node.id;
          return (
            <g key={node.id} onClick={() => onSelectNode?.(node)} style={{ cursor: 'pointer' }}>
              <circle cx={point.x} cy={point.y} r={selected ? 22 : (node.focal ? 19 : 16)} fill={point.color} opacity={selected ? 1 : 0.92} />
              <text x={point.x} y={point.y + 34} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#0f172a' }}>
                {String(node.label || node.id).slice(0, 22)}
              </text>
            </g>
          );
        })}
      </svg>
    </Paper>
  );
};

export default NetworkGraphView;
