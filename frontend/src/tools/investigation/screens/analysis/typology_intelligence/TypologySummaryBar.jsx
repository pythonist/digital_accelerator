import React from 'react';
import { Box, Chip, Divider, Paper, Stack, Typography } from '@mui/material';

const getConfidenceChip = (confidence) => {
  const c = String(confidence || '').toLowerCase();
  if (c.includes('high')) return { bgcolor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' };
  if (c.includes('mod') || c.includes('med')) return { bgcolor: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' };
  return { bgcolor: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' };
};

const TypologySummaryBar = ({ summary }) => {
  const payload = summary || {};
  const riskScore = payload.typology_risk_score != null ? Number(payload.typology_risk_score) : null;
  const scoreColor = riskScore && riskScore >= 70 ? '#b91c1c' : riskScore && riskScore >= 40 ? '#b45309' : '#15803d';

  return (
    <Paper
      variant="outlined"
      sx={{
        p: '12px 20px',
        borderRadius: 1.5,
        bgcolor: '#ffffff',
        borderColor: '#e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={{ xs: 2, lg: 3 }}
        alignItems={{ xs: 'flex-start', lg: 'center' }}
        justifyContent="space-between"
        divider={<Divider orientation="vertical" flexItem sx={{ height: 28, my: 'auto', borderColor: '#e2e8f0', display: { xs: 'none', lg: 'block' } }} />}
      >
        {/* Primary Typology */}
        <Box sx={{ minWidth: 180 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5 }}>
            Primary Typology
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
            {payload.primary_typology || 'Unclassified Pattern'}
          </Typography>
        </Box>

        {/* Confidence Level */}
        <Box sx={{ minWidth: 140 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5, mb: 0.4 }}>
            Confidence Level
          </Typography>
          <Chip
            size="small"
            label={payload.confidence_level || 'Moderate'}
            sx={{
              height: 20,
              fontSize: 11,
              fontWeight: 700,
              ...getConfidenceChip(payload.confidence_level),
            }}
          />
        </Box>

        {/* Supporting Typologies */}
        <Box sx={{ minWidth: 160 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5 }}>
            Supporting Pattern
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 13, fontWeight: 700, color: '#334155' }} noWrap>
            {payload.supporting_typologies || 'None Detected'}
          </Typography>
        </Box>

        {/* Typology Risk Score */}
        <Box sx={{ minWidth: 130 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5 }}>
            Typology Score
          </Typography>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mt: 0.25 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
              {riskScore != null ? riskScore : '-'}
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>/ 100</Typography>
          </Stack>
        </Box>

        {/* Evidence Strength */}
        <Box sx={{ minWidth: 130 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5 }}>
            Evidence Strength
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            {payload.evidence_strength || 'Substantiated'}
          </Typography>
        </Box>

        {/* Coverage Note */}
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: 0.5 }}>
            Coverage Note
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 11.5, color: '#64748b', lineHeight: 1.3 }} noWrap title={payload.coverage_note}>
            {payload.coverage_note || 'Structured case, alert, and counterparty evidence.'}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

export default TypologySummaryBar;
