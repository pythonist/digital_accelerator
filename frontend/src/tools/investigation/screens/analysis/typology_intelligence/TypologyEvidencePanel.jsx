import React from 'react';
import { Chip, Paper, Stack, Typography } from '@mui/material';

const TypologyEvidencePanel = ({ rows }) => {
  const items = (rows || []).flatMap((row) =>
    (row.evidence || []).map((evidence) => ({
      ...evidence,
      typology_name: row.typology_name,
      confidence: row.confidence,
    })),
  );

  if (!items.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5 }}>
        <Typography sx={{ fontSize: 13.2, color: '#64748b' }}>
          No concrete typology evidence has been collected yet for this case.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1.4}>
      {items.map((item, index) => (
        <Paper key={`${item.typology_name}-${item.signal}-${index}`} variant="outlined" sx={{ p: 1.8, borderRadius: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.6 }}>
            <Typography sx={{ fontSize: 14.2, fontWeight: 800, color: '#0f172a' }}>{item.signal}</Typography>
            <Chip size="small" label={item.typology_name} variant="outlined" />
          </Stack>
          <Typography sx={{ fontSize: 12.6, color: '#475569' }}>Observed value: {item.observed_value}</Typography>
          <Typography sx={{ mt: 0.7, fontSize: 12.7, color: '#334155', lineHeight: 1.6 }}>{item.why_it_matters}</Typography>
          <Typography sx={{ mt: 0.7, fontSize: 11.5, color: '#64748b', textTransform: 'uppercase' }}>
            Source: {String(item.category || '').replaceAll('_', ' ')}
          </Typography>
        </Paper>
      ))}
    </Stack>
  );
};

export default TypologyEvidencePanel;
