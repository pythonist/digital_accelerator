import React from 'react';
import { Paper, Typography, Box, LinearProgress, Table, TableHead, TableRow, TableCell, TableBody } from '@mui/material';

const BehaviorProgressPanel = ({ stage }) => {
  if (stage < 0) return null;

  const steps = [
    { label: 'Initializing', value: 0 },
    { label: 'Computing Behaviors', value: 1 },
    { label: 'Finalizing', value: 2 },
    { label: 'Complete', value: 4 }
  ];

  const isComplete = stage === 4;
  const statusFor = (value) => {
    if (stage === 4) return value === 4 ? 'Complete' : 'Done';
    if (stage < value) return 'Pending';
    if (stage === value) return 'Active';
    return 'Done';
  };

  return (
    <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Run Progress
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Stage</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {steps.map((step) => (
            <TableRow key={step.label}>
              <TableCell>{step.label}</TableCell>
              <TableCell>{statusFor(step.value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {!isComplete && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress sx={{ height: 6, bgcolor: '#e2e8f0' }} />
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
            Processing run.
          </Typography>
        </Box>
      )}
      {isComplete && (
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
          Run completed.
        </Typography>
      )}
    </Paper>
  );
};

export default BehaviorProgressPanel;
