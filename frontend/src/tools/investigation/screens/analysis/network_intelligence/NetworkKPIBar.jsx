import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const Metric = ({ label, value, emphasize = false }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 1.75,
      borderRadius: 2,
      borderColor: emphasize ? '#f59e0b' : '#d9dde5',
      backgroundColor: emphasize ? '#fffbeb' : '#fff',
      minHeight: 92,
    }}
  >
    <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {label}
    </Typography>
    <Typography sx={{ mt: 0.85, fontSize: emphasize ? 21 : 18, fontWeight: 800, color: '#0f172a' }}>
      {value}
    </Typography>
  </Paper>
);

const NetworkKPIBar = ({ kpis = {} }) => (
  <Stack
    sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))', xl: 'repeat(8, minmax(0, 1fr))' }, gap: 1.5 }}
  >
    <Metric label="Network Risk Score" value={kpis.network_risk_score ?? '-'} emphasize />
    <Metric label="Visible Linked Entities" value={kpis.visible_linked_entities ?? '-'} />
    <Metric label="Suspicious Clusters" value={kpis.suspicious_cluster_count ?? '-'} />
    <Metric label="Hub Entities" value={kpis.hub_entity_count ?? '-'} />
    <Metric label="Bridge Entities" value={kpis.bridge_entity_count ?? '-'} />
    <Metric label="Funnel Pattern" value={kpis.funnel_pattern_flag || '-'} />
    <Metric label="Circular Flow" value={kpis.circular_flow_flag || '-'} />
    <Metric label="Visibility Confidence" value={kpis.visibility_confidence || '-'} />
  </Stack>
);

export default NetworkKPIBar;
