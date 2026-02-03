// frontend/src/tools/calibration/components/aggregation/AggregationHealthCheck.jsx
import React from 'react';
import { Paper, Typography, Box, Stack, Chip } from '@mui/material';
import { CheckCircle, Warning, Info } from '@mui/icons-material';

const StatusIcon = ({ status }) => {
  if (status === 'pass') return <CheckCircle sx={{ color: 'success.main', fontSize: 18 }} />;
  if (status === 'warning') return <Warning sx={{ color: 'warning.main', fontSize: 18 }} />;
  return <Info sx={{ color: 'info.main', fontSize: 18 }} />;
};

const AggregationHealthCheck = ({ checks }) => {
  if (!checks || checks.length === 0) return null;

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warning').length;

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight="600">
          Aggregation Health Check
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {passCount > 0 && (
            <Chip label={`${passCount} Pass`} size="small" color="success" variant="outlined" />
          )}
          {warnCount > 0 && (
            <Chip label={`${warnCount} Warning`} size="small" color="warning" variant="outlined" />
          )}
        </Stack>
      </Box>

      <Stack spacing={1.5}>
        {checks.map((check, idx) => (
          <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Box sx={{ mt: 0.2 }}>
              <StatusIcon status={check.status} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight="500">
                {check.message}
              </Typography>
              {check.detail && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                  {check.detail}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
};

export default AggregationHealthCheck;