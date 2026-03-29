import React from 'react';
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';

const RelationshipMatrixView = ({ rows = [] }) => {
  const headers = rows.map((item) => item.label || item.node_id);
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', mb: 1.25 }}>Relationship Matrix</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Entity</TableCell>
              {headers.map((header) => <TableCell key={header} align="center">{header}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length ? rows.map((row) => (
              <TableRow key={row.node_id}>
                <TableCell sx={{ fontWeight: 700 }}>{row.label || row.node_id}</TableCell>
                {(row.links || []).map((link) => <TableCell key={`${row.node_id}_${link.target_id}`} align="center">{link.score}</TableCell>)}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={Math.max(1, headers.length + 1)} align="center" sx={{ py: 5, color: '#64748b' }}>
                  No relationship matrix available for the current scope.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default RelationshipMatrixView;
