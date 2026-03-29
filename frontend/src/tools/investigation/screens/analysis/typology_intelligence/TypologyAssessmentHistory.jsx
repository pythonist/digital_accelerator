import React from 'react';
import { Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';

const TypologyAssessmentHistory = ({ rows }) => {
  const items = rows || [];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead sx={{ backgroundColor: '#fff7ed' }}>
            <TableRow>
              <TableCell>Version</TableCell>
              <TableCell>Assessment Date</TableCell>
              <TableCell>Primary Typology</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell>Saved Summary</TableCell>
              <TableCell>Added To Report</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length ? items.map((item) => (
              <TableRow key={item.id || item.version} hover>
                <TableCell>{`v${item.version}`}</TableCell>
                <TableCell>{item.created_at || '-'}</TableCell>
                <TableCell>{item.primary_typology || '-'}</TableCell>
                <TableCell>{item.confidence || '-'}</TableCell>
                <TableCell>{item.summary_text || '-'}</TableCell>
                <TableCell><Chip size="small" label={item.include_in_report ? 'Included' : 'Saved Only'} variant="outlined" /></TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6}>No saved typology assessment history exists for this case yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default TypologyAssessmentHistory;
