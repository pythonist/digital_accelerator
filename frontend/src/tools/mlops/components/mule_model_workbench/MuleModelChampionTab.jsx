import React from 'react';
import { Button, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelChampionTab({ data, onPromote, promoting }) {
  return (
    <WorkbenchSection title="Champion vs Challenger" description="Compare persisted model runs side by side and promote the best governed candidate to champion.">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: '#F8FAFC' }}>
            <TableCell sx={{ fontWeight: 800 }}>Run</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Champion</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Model</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Macro F1</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Weighted F1</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Created</TableCell>
            <TableCell sx={{ fontWeight: 800 }}>Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data?.runs || []).map((row) => (
            <TableRow key={row.run_id}>
              <TableCell sx={{ fontSize: 12.25 }}>Run {row.run_id}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.is_champion ? 'Yes' : 'No'}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.summary?.champion_model || '-'}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.evaluation?.macro_f1 ?? '-'}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.evaluation?.weighted_f1 ?? '-'}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>{row.created_at || '-'}</TableCell>
              <TableCell sx={{ fontSize: 12.25 }}>
                <Button size="small" variant="outlined" disabled={promoting || row.is_champion} onClick={() => onPromote?.(row.run_id)} sx={{ textTransform: 'none', borderRadius: 0 }}>
                  {row.is_champion ? 'Current Champion' : 'Promote'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </WorkbenchSection>
  );
}

