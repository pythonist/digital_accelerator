import React from 'react';
import { Stack, TextField, Typography } from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MuleModelDecisionPolicyTab({ data, onSave, saving }) {
  const cfg = data?.config || {};
  const bands = cfg.priority_bands || {};
  return (
    <Stack spacing={1.5}>
      <WorkbenchSection title="Decision Policy" description="Define how multiclass model outputs become operational AML actions, priority bands, and routing outcomes.">
        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1}>
          <TextField size="small" type="number" label="Critical" value={bands.critical ?? 0.85} onChange={(event) => onSave?.({ ...cfg, priority_bands: { ...bands, critical: Number(event.target.value || 0.85) } })} sx={{ maxWidth: 160 }} />
          <TextField size="small" type="number" label="High" value={bands.high ?? 0.70} onChange={(event) => onSave?.({ ...cfg, priority_bands: { ...bands, high: Number(event.target.value || 0.70) } })} sx={{ maxWidth: 160 }} />
          <TextField size="small" type="number" label="Medium" value={bands.medium ?? 0.50} onChange={(event) => onSave?.({ ...cfg, priority_bands: { ...bands, medium: Number(event.target.value || 0.50) } })} sx={{ maxWidth: 160 }} />
        </Stack>
        <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.5 }}>
          Final route assignment stays class-aware. The workbench uses class-specific thresholds when configured, otherwise it falls back to the general confidence bands.
        </Typography>
      </WorkbenchSection>
      <WorkbenchSection title="Latest Decision Output">
        {(data?.latest_run?.decisions || []).slice(0, 12).map((row) => (
          <Typography key={`${row.row_index}_${row.predicted_class}`} sx={{ fontSize: 12.5, color: '#475467' }}>
            Row {row.row_index}: {row.predicted_class} | {row.priority_band} | {row.action} | {row.route}
          </Typography>
        ))}
      </WorkbenchSection>
    </Stack>
  );
}

