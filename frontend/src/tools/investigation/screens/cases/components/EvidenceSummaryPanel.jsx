// frontend/src/screens/cases/components/EvidenceSummaryPanel.jsx
import React from 'react';
import { Paper, Stack, Typography, Chip, LinearProgress, Grid, Box } from '@mui/material';
import EvidenceItem from './EvidenceItem';

const EvidenceSummaryPanel = ({ metrics }) => {
  if (!metrics) return null;

  return (
    <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '2px solid #1976d2', flexShrink: 0, bgcolor: 'white' }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" fontWeight="bold">
            Key Evidence Summary
          </Typography>
          <Chip 
            label={`${metrics.reviewed_count} of ${metrics.total_metrics} metrics verified`}
            size="small"
            color="primary"
            sx={{ fontWeight: 'bold' }}
          />
        </Stack>

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            System Conclusion: <strong>{metrics.risk_score}/100 Risk Score</strong> ({metrics.evidence_strength} evidence)
          </Typography>
          <LinearProgress 
            variant="determinate" 
            value={metrics.progress} 
            sx={{ height: 8, borderRadius: 1, mt: 1 }}
          />
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Stack spacing={1}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                Supporting Evidence:
              </Typography>
              <Stack spacing={0.5}>
                <EvidenceItem 
                  status="complete"
                  text={`${metrics.alert_count} alerts detected (${metrics.critical_count} critical severity)`}
                />
                <EvidenceItem 
                  status="complete"
                  text={`$${metrics.total_volume.toLocaleString()} transaction volume`}
                />
                <EvidenceItem 
                  status={metrics.data_completeness === 'COMPLETE' ? 'complete' : 'warning'}
                  text={`Data completeness: ${metrics.data_completeness}`}
                />
              </Stack>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <Stack spacing={1}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                Evidence Strength:
              </Typography>
              <Chip 
                label={metrics.evidence_strength}
                size="small"
                color={
                  metrics.evidence_strength === 'STRONG' ? 'success' :
                  metrics.evidence_strength === 'MODERATE' ? 'warning' : 'error'
                }
                sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}
              />
              <Typography variant="caption" color="text.secondary">
                → Expand nodes below to verify computation logic
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Stack>
    </Paper>
  );
};

export default EvidenceSummaryPanel;