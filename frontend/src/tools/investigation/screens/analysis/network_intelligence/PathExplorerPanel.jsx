import React, { useMemo, useState } from 'react';
import { Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';

const PathExplorerPanel = ({ graph, precomputedPaths = [] }) => {
  const nodes = graph?.nodes || [];
  const nodeOptions = useMemo(
    () => nodes.map((item) => ({ value: item.id, label: item.label || item.id })),
    [nodes],
  );
  const [startNode, setStartNode] = useState(nodeOptions[0]?.value || '');
  const [endNode, setEndNode] = useState(nodeOptions[1]?.value || '');

  const selectedPath = useMemo(
    () => precomputedPaths.find((item) => item.start === startNode && item.end === endNode)
      || precomputedPaths.find((item) => item.end === endNode)
      || null,
    [precomputedPaths, startNode, endNode],
  );

  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', mb: 1.4 }}>Path Explorer</Typography>
      <Stack spacing={1.4}>
        <FormControl size="small" fullWidth>
          <InputLabel>Start Entity</InputLabel>
          <Select value={startNode} label="Start Entity" onChange={(event) => setStartNode(event.target.value)}>
            {nodeOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel>End Entity</InputLabel>
          <Select value={endNode} label="End Entity" onChange={(event) => setEndNode(event.target.value)}>
            {nodeOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="outlined" disabled={!selectedPath}>Inspect Visible Path</Button>

        {selectedPath ? (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, backgroundColor: '#f8fafc' }}>
            <Typography sx={{ fontSize: 12.8, fontWeight: 700, color: '#0f172a' }}>
              Path Length: {selectedPath.length}
            </Typography>
            <Typography sx={{ mt: 0.75, fontSize: 12.35, lineHeight: 1.7, color: '#334155' }}>
              {(selectedPath.path_labels || []).join('  →  ')}
            </Typography>
          </Paper>
        ) : (
          <Typography sx={{ fontSize: 12.6, color: '#64748b' }}>
            No meaningful visible intermediary path is available for the selected entities.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
};

export default PathExplorerPanel;
