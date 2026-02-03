// frontend/src/tools/calibration/components/aggregation/MissedBehaviorWarning.jsx
import React from 'react';
import { Paper, Typography, Box, Stack, Chip } from '@mui/material';
import { VisibilityOff } from '@mui/icons-material';

const MissedBehaviorWarning = ({ warnings }) => {
  if (!warnings || warnings.length === 0) return null;

  const getSeverityColor = (severity) => {
    if (severity === 'high') return 'error';
    if (severity === 'medium') return 'warning';
    return 'info';
  };

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <VisibilityOff fontSize="small" color="warning" />
        <Typography variant="subtitle2" fontWeight="600">
          What This Aggregation May Miss
        </Typography>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        This configuration may not capture:
      </Typography>

      <Stack spacing={1.5}>
        {warnings.map((warning, idx) => (
          <Box key={idx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Chip 
                label={warning.category} 
                size="small" 
                color={getSeverityColor(warning.severity)}
                variant="outlined"
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
              <Typography variant="body2" fontWeight="500">
                {warning.message}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
              {warning.explanation}
            </Typography>
          </Box>
        ))}
      </Stack>

      <Box sx={{ mt: 1.5, p: 1, bgcolor: 'warning.50', borderRadius: 1 }}>
        <Typography variant="caption" color="warning.dark">
          ⚠️ These are informational - not blockers. Review if critical to your use case.
        </Typography>
      </Box>
    </Paper>
  );
};

export default MissedBehaviorWarning;