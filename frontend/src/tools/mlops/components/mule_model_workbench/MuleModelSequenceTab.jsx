import React from 'react';
import { Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelSequenceTab({ data, onSave, saving }) {
  const cfg = data?.config || {};
  const toggle = (key) => onSave?.({ ...cfg, [key]: !cfg[key] });
  return (
    <Stack spacing={1.5}>
      <WorkbenchSection title="Sequence Models" description="Sequence overlays add behavioural and temporal context on top of the supervised multiclass core.">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 800 }}>Track</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Kind</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Required inputs</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data?.tracks || []).map((row) => (
              <TableRow key={row.id}>
                <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.label}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.kind}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.status}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{(row.required_columns || []).join(', ')}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>
                  {['hazard', 'hmm', 'lstm', 'transformer'].includes(row.id) ? (
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => toggle(`${row.id}_enabled`.replace('_enabled_enabled', '_enabled'))}
                      disabled={saving}
                      sx={{ textTransform: 'none', borderRadius: 0 }}
                    >
                      {((cfg[`${row.id}_enabled`] ?? (row.id === 'hazard' || row.id === 'hmm'))) ? 'Configured' : 'Enable'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </WorkbenchSection>
      {(data?.latest_run?.tracks || []).length ? (
        <WorkbenchSection title="Latest Sequence Overlay Output">
          {(data.latest_run.tracks || []).map((row) => (
            <Typography key={row.track} sx={{ fontSize: 12.5, color: '#475467' }}>
              {row.track}: {row.status}{row.score_column ? ` -> ${row.score_column}` : ''}{row.reason ? ` | ${row.reason}` : ''}
            </Typography>
          ))}
        </WorkbenchSection>
      ) : null}
    </Stack>
  );
}
