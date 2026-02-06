import React from 'react';
import { Chip } from '@mui/material';

const riskColor = (risk) => {
  const r = String(risk || '').toUpperCase();
  if (r === 'HIGH') return { bgcolor: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' };
  if (r === 'MEDIUM') return { bgcolor: '#ffedd5', color: '#9a3412', borderColor: '#fed7aa' };
  return { bgcolor: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' };
};

const RiskChip = ({ riskLevel }) => {
  const s = riskColor(riskLevel);
  return (
    <Chip
      size="small"
      label={String(riskLevel || 'LOW').toUpperCase()}
      sx={{
        bgcolor: s.bgcolor,
        color: s.color,
        border: '1px solid',
        borderColor: s.borderColor,
        fontWeight: 700
      }}
    />
  );
};

export default RiskChip;

