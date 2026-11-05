import React from 'react';
import { Box, Chip, Divider, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';

const TypologyEvidencePanel = ({ rows }) => {
  const items = (rows || []).flatMap((row) =>
    (row.evidence || []).map((evidence) => ({
      ...evidence,
      typology_name: row.typology_name,
      confidence: row.confidence,
    }))
  );

  if (!items.length) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 13.5, color: '#64748b' }}>
          No concrete typology evidence signals collected for this case.
        </Typography>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5 }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { bgcolor: '#f8fafc', color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' } }}>
            <TableCell sx={{ minWidth: 160 }}>Typology & Category</TableCell>
            <TableCell sx={{ minWidth: 200 }}>Observed Signal</TableCell>
            <TableCell sx={{ width: 140 }}>Observed Value</TableCell>
            <TableCell sx={{ minWidth: 260 }}>Investigative Relevance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={index} hover sx={{ '& td': { fontSize: 12.5, py: 1.25 } }}>
              <TableCell>
                <Stack spacing={0.3}>
                  <Typography sx={{ fontWeight: 700, color: '#0f172a' }}>
                    {item.typology_name}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>
                    {String(item.category || '').replaceAll('_', ' ')}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#1e293b' }}>
                {item.signal}
              </TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                {item.observed_value}
              </TableCell>
              <TableCell sx={{ color: '#475569', lineHeight: 1.5 }}>
                {item.why_it_matters}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default TypologyEvidencePanel;
