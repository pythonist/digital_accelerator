import React from 'react';
import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

import { WorkbenchMetricGrid, WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelEvaluationTab({ data }) {
  const metrics = data?.latest_run || {};
  const confusion = metrics.confusion_matrix || [];
  return (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid items={[
        { label: 'Macro F1', value: metrics.macro_f1 ?? 'N/A', helper: 'Primary multiclass quality measure.', emphasize: true },
        { label: 'Weighted F1', value: metrics.weighted_f1 ?? 'N/A', helper: 'Support-weighted multiclass quality.' },
        { label: 'Top-2 Accuracy', value: metrics.top_2_accuracy ?? 'N/A', helper: 'Correct class appears in top 2 probabilities.' },
        { label: 'Top-3 Accuracy', value: metrics.top_3_accuracy ?? 'N/A', helper: 'Correct class appears in top 3 probabilities.' },
      ]} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Per-Class Metrics">
          <Table size="small">
            <TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Class</TableCell><TableCell sx={{ fontWeight: 800 }}>Precision</TableCell><TableCell sx={{ fontWeight: 800 }}>Recall</TableCell><TableCell sx={{ fontWeight: 800 }}>F1</TableCell><TableCell sx={{ fontWeight: 800 }}>Support</TableCell></TableRow></TableHead>
            <TableBody>
              {(metrics.per_class_metrics || []).map((row) => (
                <TableRow key={row.class_name}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.class_name}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.precision}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.recall}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.f1}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.support}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
        <WorkbenchSection title="Confusion Matrix">
          <Table size="small">
            <TableBody>
              {confusion.map((row, rowIndex) => (
                <TableRow key={`cm_${rowIndex}`}>
                  {row.map((value, colIndex) => (
                    <TableCell key={`cm_${rowIndex}_${colIndex}`} sx={{ fontSize: 12.25 }}>{value}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
      </Box>
      <WorkbenchSection title="Monthly Backtest / Stability">
        {(metrics.monthly_backtest || []).map((row) => (
          <Typography key={row.month} sx={{ fontSize: 12.5, color: '#475467' }}>
            {row.month}: {row.row_count} rows | Macro F1 {row.macro_f1} | Weighted F1 {row.weighted_f1}
          </Typography>
        ))}
      </WorkbenchSection>
    </Stack>
  );
}

