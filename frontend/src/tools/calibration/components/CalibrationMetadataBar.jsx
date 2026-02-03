// frontend/src/tools/calibration/components/CalibrationMetadataBar.jsx
// PwC Professional Design

import React from 'react';
import { Box, Typography, Chip, Stack, Tooltip } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  infoLight: '#F5F9FF'
};

const CalibrationMetadataBar = ({ metadata }) => {
  if (!metadata) return null;
  
  const formatLevel = (level) => {
    if (!level) return 'Unknown';
    return level.replace(/_/g, '-').toLowerCase();
  };
  
  const formatFrequency = (freq) => {
    if (!freq) return 'Unknown';
    return freq.replace(/_/g, ' ');
  };
  
  return (
    <Box 
      sx={{ 
        p: 2.5, 
        bgcolor: PWC_COLORS.infoLight, 
        borderRadius: 1,
        border: `1px solid ${PWC_COLORS.lightGray}`,
        mb: 3
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <Tooltip title="Alert granularity - one alert = one entity at this level">
          <Chip 
            icon={<InfoIcon sx={{ fontSize: '0.875rem', color: PWC_COLORS.orange }} />}
            label={`Alert Grain: ${formatLevel(metadata.level)}`}
            size="small"
            sx={{
              bgcolor: PWC_COLORS.white,
              color: PWC_COLORS.darkGray,
              border: `1px solid ${PWC_COLORS.lightGray}`,
              fontWeight: 500,
              fontSize: '0.813rem',
              height: 28,
              '& .MuiChip-icon': {
                color: PWC_COLORS.orange
              }
            }}
          />
        </Tooltip>
        
        <Chip 
          label={`Aggregation: ${formatFrequency(metadata.frequency)}`}
          size="small"
          sx={{
            bgcolor: PWC_COLORS.white,
            color: PWC_COLORS.darkGray,
            border: `1px solid ${PWC_COLORS.lightGray}`,
            fontWeight: 500,
            fontSize: '0.813rem',
            height: 28
          }}
        />
        
        <Chip 
          label={`Lookback: ${metadata.lookback_days} days`}
          size="small"
          sx={{
            bgcolor: PWC_COLORS.white,
            color: PWC_COLORS.darkGray,
            border: `1px solid ${PWC_COLORS.lightGray}`,
            fontWeight: 500,
            fontSize: '0.813rem',
            height: 28
          }}
        />
        
        <Chip 
          label={`Metrics: ${metadata.metrics || 'amount, count'}`}
          size="small"
          sx={{
            bgcolor: PWC_COLORS.white,
            color: PWC_COLORS.darkGray,
            border: `1px solid ${PWC_COLORS.lightGray}`,
            fontWeight: 500,
            fontSize: '0.813rem',
            height: 28
          }}
        />
        
        <Box sx={{ ml: 'auto !important' }}>
          <Typography 
            variant="caption" 
            sx={{ 
              color: PWC_COLORS.mediumGray,
              fontSize: '0.813rem'
            }}
          >
            You are calibrating: <strong>{formatFrequency(metadata.frequency)}</strong> aggregation at <strong>{formatLevel(metadata.level)}</strong> level
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
};

export default CalibrationMetadataBar;