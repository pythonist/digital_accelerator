import React from 'react';
import { Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';

const statusColor = (status) => {
  if (status === 'Primary') return 'warning';
  if (status === 'Supporting') return 'info';
  if (status === 'Weak Signal') return 'default';
  if (status === 'Not Enough Evidence') return 'default';
  return 'default';
};

const TypologyBreakdownTable = ({ rows }) => {
  const items = rows || [];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead sx={{ backgroundColor: '#fff7ed' }}>
            <TableRow>
              <TableCell>Typology Name</TableCell>
              <TableCell>Score</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Why it matched</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.typology_id} hover>
                <TableCell sx={{ fontWeight: 700, color: '#0f172a' }}>{item.typology_name}</TableCell>
                <TableCell>{Math.round((item.score || 0) * 100)}</TableCell>
                <TableCell>{item.confidence}</TableCell>
                <TableCell><Chip size="small" label={item.status} color={statusColor(item.status)} variant={item.status === 'Primary' ? 'filled' : 'outlined'} /></TableCell>
                <TableCell>
                  <Stack spacing={0.35}>
                    {item.evidence?.slice(0, 2)?.map((evidence) => (
                      <Typography key={`${item.typology_id}-${evidence.signal}`} sx={{ fontSize: 12.2, color: '#334155' }}>
                        {evidence.signal}: {evidence.why_it_matters}
                      </Typography>
                    ))}
                    {!item.evidence?.length ? (
                      <Typography sx={{ fontSize: 12.2, color: '#64748b' }}>{item.weak_reason}</Typography>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default TypologyBreakdownTable;
