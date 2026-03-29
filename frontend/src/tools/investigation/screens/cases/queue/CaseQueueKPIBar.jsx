import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

const KPI_CONFIG = [
  { key: 'total_cases', label: 'Total Cases' },
  { key: 'open', label: 'Open' },
  { key: 'in_review', label: 'In Review' },
  { key: 'pending_l2_review', label: 'Pending L2 Review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'awaiting_response', label: 'Awaiting Response' },
  { key: 'sar_recommended', label: 'SAR Recommended' },
  { key: 'closed', label: 'Closed' },
  { key: 'overdue', label: 'Overdue', emphasize: true },
];

const CaseQueueKPIBar = ({ kpis = {} }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(9, 1fr)' },
      gap: 1.25,
    }}
  >
    {KPI_CONFIG.map((item) => (
      <Paper
        key={item.key}
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 2,
          backgroundColor: item.emphasize ? '#fff7ed' : '#ffffff',
          borderColor: item.emphasize ? '#fed7aa' : '#e2e8f0',
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: '#64748b', textTransform: 'uppercase' }}>
          {item.label}
        </Typography>
        <Typography sx={{ mt: 0.7, fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
          {Number(kpis[item.key] || 0).toLocaleString()}
        </Typography>
      </Paper>
    ))}
  </Box>
);

export default CaseQueueKPIBar;
