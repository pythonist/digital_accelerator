import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const Metric = ({ label, value, accent = '#0f172a' }) => (
  <Paper variant="outlined" sx={{ p: 1.6, borderRadius: 2.5, minWidth: 0 }}>
    <Typography sx={{ fontSize: 11.2, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.2 }}>
      {label}
    </Typography>
    <Typography sx={{ mt: 0.45, fontSize: 16, fontWeight: 800, color: accent, lineHeight: 1.3 }}>
      {value || '-'}
    </Typography>
  </Paper>
);

const TypologySummaryBar = ({ summary }) => {
  const payload = summary || {};
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
      <Metric label="Primary Typology" value={payload.primary_typology} accent="#b45309" />
      <Metric label="Confidence Level" value={payload.confidence_level} accent="#0f766e" />
      <Metric label="Supporting Typologies" value={payload.supporting_typologies} />
      <Metric label="Typology Risk Score" value={payload.typology_risk_score != null ? `${payload.typology_risk_score}` : '-'} accent="#b91c1c" />
      <Metric label="Evidence Strength" value={payload.evidence_strength} />
      <Metric label="Coverage Note" value={payload.coverage_note} />
    </Stack>
  );
};

export default TypologySummaryBar;
