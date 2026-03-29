import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const Row = ({ label, value }) => (
  <Stack spacing={0.25}>
    <Typography sx={{ fontSize: 10.8, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: 13.2, fontWeight: 700, color: '#0f172a' }}>{value || '-'}</Typography>
  </Stack>
);

const TypologyCaseSnapshot = ({ snapshot }) => {
  const item = snapshot || {};
  return (
    <Paper variant="outlined" sx={{ p: 1.9, borderRadius: 2.5 }}>
      <Stack spacing={1.3}>
        <Row label="Case ID" value={item.case_id} />
        <Row label="Customer" value={item.customer} />
        <Row label="Customer ID" value={item.customer_id} />
        <Row label="Account ID" value={item.account_id} />
        <Row label="Alert Count" value={item.alert_count} />
        <Row label="Total Suspicious Amount" value={item.total_suspicious_amount} />
        <Row label="Risk Score" value={item.risk_score} />
        <Row label="Severity" value={item.severity} />
        <Row label="Status" value={item.status} />
        <Row label="Assigned Analyst" value={item.assigned_analyst} />
        <Row label="Linked Entities" value={item.linked_entities} />
      </Stack>
    </Paper>
  );
};

export default TypologyCaseSnapshot;
