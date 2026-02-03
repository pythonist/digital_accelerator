// frontend/src/tools/calibration/components/aggregation/AggregationNarrative.jsx
import React from 'react';
import { Paper, Typography, Box, Alert, Chip, Stack } from '@mui/material';
import { Description, Lightbulb, Warning } from '@mui/icons-material';

const AggregationNarrative = ({ narrative }) => {
  if (!narrative) return null;

  const { intent, use_case_hints, warnings } = narrative;

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
        <Description fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight="600">
          Configuration Explanation
        </Typography>
      </Box>

      {/* Intent */}
      {intent && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'primary.50', borderRadius: 1, borderLeft: '3px solid', borderColor: 'primary.main' }}>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            {intent}
          </Typography>
        </Box>
      )}

      {/* Use Case Hints */}
      {use_case_hints && use_case_hints.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
            <Lightbulb fontSize="small" sx={{ color: 'info.main' }} />
            <Typography variant="caption" fontWeight="600" color="info.main">
              USE CASE INSIGHTS
            </Typography>
          </Box>
          <Stack spacing={0.5}>
            {use_case_hints.map((hint, idx) => (
              <Typography key={idx} variant="caption" sx={{ display: 'block', pl: 1, color: 'text.secondary' }}>
                • {hint}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
            <Warning fontSize="small" sx={{ color: 'warning.main' }} />
            <Typography variant="caption" fontWeight="600" color="warning.main">
              CONFIGURATION NOTES
            </Typography>
          </Box>
          <Stack spacing={1}>
            {warnings.map((warning, idx) => (
              <Alert
                key={idx}
                severity={warning.severity || 'info'}
                sx={{ py: 0.5 }}
              >
                <Typography variant="caption">{warning.message}</Typography>
              </Alert>
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};

export default AggregationNarrative;