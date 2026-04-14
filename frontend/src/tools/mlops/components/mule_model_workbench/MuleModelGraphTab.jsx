import React from 'react';
import { Button, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelGraphTab({ data, onSave, saving }) {
  const cfg = data?.config || {};
  const selected = new Set(cfg.algorithms || []);
  const toggle = (algorithmId) => {
    const next = new Set(selected);
    if (next.has(algorithmId)) next.delete(algorithmId);
    else next.add(algorithmId);
    onSave?.({ ...cfg, algorithms: Array.from(next) });
  };
  return (
    <WorkbenchSection title="Graph Algorithms" description="Review graph-enriched columns and choose which network analytics stay in scope for the Mule scoring stack.">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: '#F8FAFC' }}>
            <TableCell sx={{ fontWeight: 800 }}>Algorithm</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Feature column</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Coverage</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Description</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data?.rows || []).map((row) => (
            <TableRow key={row.algorithm_id}>
              <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.algorithm_id}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.column_name}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.coverage_pct}%</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.description}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>
                <Button size="small" variant={selected.has(row.algorithm_id) ? 'contained' : 'outlined'} onClick={() => toggle(row.algorithm_id)} disabled={saving || !row.available} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: selected.has(row.algorithm_id) ? '#111827' : undefined }}>
                  {selected.has(row.algorithm_id) ? 'Selected' : 'Select'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </WorkbenchSection>
  );
}
