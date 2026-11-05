import React from 'react';
import { Box, Paper, Stack, Typography, Chip, Divider } from '@mui/material';
import { Hub, AccountTree, WarningAmber, Shield, CheckCircle, SyncAlt, FilterAlt } from '@mui/icons-material';

const NetworkKPIBar = ({ kpis = {} }) => {
  const riskScore = Number(kpis.network_risk_score ?? 0);
  const riskColor = riskScore >= 70 ? '#dc2626' : riskScore >= 40 ? '#ea580c' : '#16a34a';
  const riskBg = riskScore >= 70 ? '#fef2f2' : riskScore >= 40 ? '#fff7ed' : '#f0fdf4';

  const isObserved = (val) => String(val || '').toLowerCase().includes('observe');

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: '#ffffff',
        borderColor: '#e2e8f0',
        boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 2.5,
      }}
    >
      {/* 1. Focal Risk Gauge */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 2, borderRight: { xs: 'none', lg: '1px solid #e2e8f0' } }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            bgcolor: riskBg,
            border: `2px solid ${riskColor}`,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Typography sx={{ fontSize: 18, fontWeight: 900, color: riskColor, lineHeight: 1 }}>
            {kpis.network_risk_score ?? '-'}
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Network Risk Score
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: riskColor }}>
            {riskScore >= 70 ? 'High Risk Exposure' : riskScore >= 40 ? 'Moderate Anomaly' : 'Low Risk Flow'}
          </Typography>
        </Box>
      </Box>

      {/* 2. Topological Topology Metrics */}
      <Stack
        direction="row"
        spacing={{ xs: 2, md: 3 }}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ flex: 1, px: { xs: 0, lg: 1 } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Hub sx={{ fontSize: 20, color: '#2563eb' }} />
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Linked Entities
            </Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              {kpis.visible_linked_entities ?? 0}
            </Typography>
          </Box>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ height: 28, my: 'auto' }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccountTree sx={{ fontSize: 20, color: '#ea580c' }} />
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Suspicious Clusters
            </Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              {kpis.suspicious_cluster_count ?? 0}
            </Typography>
          </Box>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ height: 28, my: 'auto' }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#7c3aed' }} />
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Hub / Bridge Entities
            </Typography>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
              {kpis.hub_entity_count ?? 0} <Typography component="span" sx={{ color: '#94a3b8', fontSize: 13 }}>hubs</Typography> · {kpis.bridge_entity_count ?? 0} <Typography component="span" sx={{ color: '#94a3b8', fontSize: 13 }}>bridges</Typography>
            </Typography>
          </Box>
        </Box>
      </Stack>

      {/* 3. Graph Pattern Status Indicators */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ pl: { xs: 0, lg: 2 }, borderLeft: { xs: 'none', lg: '1px solid #e2e8f0' } }}
      >
        <Chip
          icon={isObserved(kpis.funnel_pattern_flag) ? <FilterAlt sx={{ fontSize: 14 }} /> : <CheckCircle sx={{ fontSize: 14 }} />}
          size="small"
          label={`Funnel: ${kpis.funnel_pattern_flag || 'None'}`}
          sx={{
            fontSize: 11,
            fontWeight: 700,
            bgcolor: isObserved(kpis.funnel_pattern_flag) ? '#fff7ed' : '#f8fafc',
            color: isObserved(kpis.funnel_pattern_flag) ? '#c2410c' : '#64748b',
            border: `1px solid ${isObserved(kpis.funnel_pattern_flag) ? '#fed7aa' : '#e2e8f0'}`,
          }}
        />

        <Chip
          icon={isObserved(kpis.circular_flow_flag) ? <SyncAlt sx={{ fontSize: 14 }} /> : <CheckCircle sx={{ fontSize: 14 }} />}
          size="small"
          label={`Circular: ${kpis.circular_flow_flag || 'None'}`}
          sx={{
            fontSize: 11,
            fontWeight: 700,
            bgcolor: isObserved(kpis.circular_flow_flag) ? '#fef2f2' : '#f8fafc',
            color: isObserved(kpis.circular_flow_flag) ? '#dc2626' : '#64748b',
            border: `1px solid ${isObserved(kpis.circular_flow_flag) ? '#fecaca' : '#e2e8f0'}`,
          }}
        />

        <Chip
          icon={<Shield sx={{ fontSize: 14 }} />}
          size="small"
          label={`Confidence: ${kpis.visibility_confidence || 'Moderate'}`}
          sx={{
            fontSize: 11,
            fontWeight: 700,
            bgcolor: '#eff6ff',
            color: '#1e40af',
            border: '1px solid #bfdbfe',
          }}
        />
      </Stack>
    </Paper>
  );
};

export default NetworkKPIBar;
