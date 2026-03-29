import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const NetworkEvidencePanel = ({ items = [] }) => (
  <Stack spacing={1.2}>
    {items.length ? items.map((item, index) => (
      <Paper key={`${item.title}_${index + 1}`} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Typography sx={{ fontSize: 12.9, fontWeight: 800, color: '#0f172a' }}>{item.title}</Typography>
        <Typography sx={{ mt: 0.4, fontSize: 11.9, color: '#d97706', fontWeight: 700 }}>{item.type}</Typography>
        <Typography sx={{ mt: 0.75, fontSize: 12.35, color: '#334155', lineHeight: 1.7 }}>{item.why_it_matters}</Typography>
        <Typography sx={{ mt: 0.7, fontSize: 11.75, color: '#64748b' }}>
          Records: {(item.source_records || []).join(', ') || '-'} | Strength: {item.strength || '-'}
        </Typography>
      </Paper>
    )) : (
      <Typography sx={{ fontSize: 12.6, color: '#64748b' }}>No network evidence items are available yet.</Typography>
    )}
  </Stack>
);

export default NetworkEvidencePanel;
