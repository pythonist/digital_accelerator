// frontend/src/tools/calibration/components/FilterDependencyWarnings.jsx
import React from 'react';
import { Alert, Box, Typography, Stack } from '@mui/material';
import { Warning, Info } from '@mui/icons-material';

const FilterDependencyWarnings = ({ warnings }) => {
  if (!warnings || warnings.length === 0) return null;

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'WARNING':
        return <Warning />;
      case 'ADVISORY':
      default:
        return <Info />;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'WARNING':
        return 'warning';
      case 'ADVISORY':
      default:
        return 'info';
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Stack spacing={1}>
        {warnings.map((warning, idx) => (
          <Alert
            key={idx}
            severity={getSeverityColor(warning.severity)}
            icon={getSeverityIcon(warning.severity)}
            sx={{ py: 1 }}
          >
            <Typography variant="body2" fontWeight="600">
              {warning.message}
            </Typography>
            {warning.recommendation && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                💡 {warning.recommendation}
              </Typography>
            )}
          </Alert>
        ))}
      </Stack>
    </Box>
  );
};

export default FilterDependencyWarnings;