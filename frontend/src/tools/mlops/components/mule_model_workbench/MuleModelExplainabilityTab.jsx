import React from 'react';
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelExplainabilityTab({ data }) {
  const latest = data?.latest_run || {};
  return (
    <Stack spacing={1.5}>
      <WorkbenchSection title="Explainability Method">
        <Typography sx={{ fontSize: 12.5, color: '#475467' }}>
          Explainability source: <strong>{latest.method || 'native_feature_importance'}</strong>. SHAP is used when available; otherwise the workbench falls back to native feature importance and backend-generated rationale text.
        </Typography>
      </WorkbenchSection>
      <WorkbenchSection title="Global Feature Importance">
        <Table size="small">
          <TableHead><TableRow sx={{ bgcolor: '#F8FAFC' }}><TableCell sx={{ fontWeight: 800 }}>Feature</TableCell><TableCell sx={{ fontWeight: 800 }}>Importance</TableCell><TableCell sx={{ fontWeight: 800 }}>Family</TableCell></TableRow></TableHead>
          <TableBody>
            {(latest.global_importance || []).slice(0, 20).map((row) => (
              <TableRow key={row.feature}>
                <TableCell sx={{ fontSize: 12.25 }}>{row.feature}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.importance}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.family}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </WorkbenchSection>
      <WorkbenchSection title="Per-Prediction Rationale">
        {(latest.prediction_rationale || []).slice(0, 12).map((row) => (
          <Typography key={`${row.row_index}_${row.predicted_class}`} sx={{ fontSize: 12.5, color: '#475467' }}>
            {`Row ${row.row_index}: ${row.predicted_class} -> ${row.reason}`}
          </Typography>
        ))}
      </WorkbenchSection>
    </Stack>
  );
}
