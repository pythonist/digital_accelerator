// frontend/src/tools/calibration/components/aggregation/CalibrationRiskHints.jsx
import React from 'react';
import { Paper, Typography, Box, Stack, Chip } from '@mui/material';
import { TrendingUp } from '@mui/icons-material';

const CalibrationRiskHints = ({ risks }) => {
  if (!risks || risks.length === 0) return null;

  const getStabilityColor = (stability) => {
    if (stability === 'stable') return 'success';
    if (stability === 'moderate' || stability === 'bursty') return 'warning';
    return 'error';
  };

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <TrendingUp fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight="600">
          Calibration Risk Preview
        </Typography>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Informational - no thresholds applied
      </Typography>

      <Stack spacing={2}>
        {risks.map((risk, idx) => (
          <Box key={idx}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" fontWeight="600">
                {risk.metric}
              </Typography>
              <Chip 
                label={risk.stability}
                size="small"
                color={getStabilityColor(risk.stability)}
                variant="outlined"
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {risk.detail}
            </Typography>
            <Box sx={{ p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="caption" fontWeight="500">
                📊 {risk.calibration_impact}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
};

export default CalibrationRiskHints;