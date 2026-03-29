import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const formatTs = (value) => {
  if (!value) return 'Undated';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const NetworkTimelineView = ({ rows = [] }) => (
  <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', mb: 1.5 }}>Network Timeline</Typography>
    <Stack spacing={1.15}>
      {rows.length ? rows.slice(0, 12).map((item, index) => (
        <Paper key={`timeline_${index + 1}`} variant="outlined" sx={{ p: 1.35, borderRadius: 2 }}>
          <Typography sx={{ fontSize: 12.8, fontWeight: 700, color: '#0f172a' }}>
            {item.account_id || '-'} to {item.counterparty || '-'}
          </Typography>
          <Typography sx={{ mt: 0.4, fontSize: 12.1, color: '#475569' }}>
            {formatTs(item.txn_timestamp)} | {item.txn_type || 'Movement'} | {Number(item.amount || 0).toLocaleString()}
          </Typography>
        </Paper>
      )) : (
        <Typography sx={{ fontSize: 12.75, color: '#64748b' }}>No timeline events available for the current case scope.</Typography>
      )}
    </Stack>
  </Paper>
);

export default NetworkTimelineView;
