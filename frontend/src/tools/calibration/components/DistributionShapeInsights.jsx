// frontend/src/tools/calibration/components/DistributionShapeInsights.jsx
// PwC Professional Design

import React from 'react';
import { Box, Typography, Alert, Chip, Stack } from '@mui/material';
import { TrendingUp, TrendingFlat, Warning } from '@mui/icons-material';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  success: '#107C41',
  warning: '#F7941E'
};

const DistributionShapeInsights = ({ shape }) => {
  if (!shape) return null;
  
  const getSkewnessIcon = (skew) => {
    if (skew === null) return <TrendingFlat />;
    if (Math.abs(skew) < 1) return <TrendingFlat />;
    return skew > 0 ? <TrendingUp /> : <TrendingUp style={{ transform: 'scaleX(-1)' }} />;
  };
  
  const getSkewnessLabel = (skew) => {
    if (skew === null) return 'Unknown';
    if (Math.abs(skew) < 0.5) return 'Symmetric';
    if (skew > 2) return 'Heavily Right-Skewed';
    if (skew > 1) return 'Right-Skewed';
    if (skew < -2) return 'Heavily Left-Skewed';
    if (skew < -1) return 'Left-Skewed';
    return 'Slightly Skewed';
  };
  
  const getSeverity = (skew) => {
    if (skew === null) return 'info';
    if (Math.abs(skew) > 2) return 'warning';
    if (Math.abs(skew) > 1) return 'info';
    return 'success';
  };
  
  return (
    <Box>
      <Typography 
        variant="subtitle2" 
        gutterBottom 
        fontWeight={600}
        sx={{ 
          color: PWC_COLORS.darkGray,
          fontSize: '0.938rem',
          mb: 2
        }}
      >
        Distribution Characteristics
      </Typography>
      
      <Stack spacing={2}>
        {/* Skewness */}
        <Alert 
          severity={getSeverity(shape.skewness)} 
          icon={getSkewnessIcon(shape.skewness)}
          sx={{ 
            py: 1,
            border: `1px solid ${PWC_COLORS.lightGray}`,
            '& .MuiAlert-icon': {
              color: PWC_COLORS.orange
            },
            '& .MuiAlert-message': {
              color: PWC_COLORS.darkGray
            }
          }}
        >
          <Box>
            <Typography 
              variant="body2" 
              fontWeight={600}
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.875rem'
              }}
            >
              {getSkewnessLabel(shape.skewness)}
              {shape.skewness !== null && (
                <Chip 
                  label={`Skewness: ${shape.skewness}`} 
                  size="small" 
                  sx={{ 
                    ml: 1.5, 
                    height: 22,
                    fontSize: '0.75rem',
                    bgcolor: PWC_COLORS.lightGray,
                    color: PWC_COLORS.darkGray,
                    fontWeight: 500
                  }}
                />
              )}
            </Typography>
            {shape.heavy_tail && (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.813rem',
                  mt: 0.5,
                  display: 'block'
                }}
              >
                Heavy tail detected: Threshold changes near high percentiles will have large alert impact
              </Typography>
            )}
          </Box>
        </Alert>
        
        {/* Notes */}
        {shape.notes && (
          <Box 
            sx={{ 
              p: 2, 
              bgcolor: '#FAFAFA', 
              borderRadius: 1,
              border: `1px solid ${PWC_COLORS.lightGray}`
            }}
          >
            <Typography 
              variant="caption" 
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.813rem',
                lineHeight: 1.6
              }}
            >
              <strong>What this means:</strong> {shape.notes}
            </Typography>
          </Box>
        )}
        
        {/* Heavy Tail Warning */}
        {shape.heavy_tail && (
          <Box 
            sx={{ 
              p: 2, 
              bgcolor: '#FFF5F0', 
              borderRadius: 1,
              border: `1px solid ${PWC_COLORS.warning}`,
              display: 'flex',
              gap: 1.5,
              alignItems: 'flex-start'
            }}
          >
            <Warning sx={{ color: PWC_COLORS.warning, fontSize: '1.125rem', mt: 0.25 }} />
            <Box>
              <Typography 
                variant="caption" 
                fontWeight={600} 
                sx={{ 
                  color: PWC_COLORS.darkGray,
                  fontSize: '0.813rem',
                  display: 'block',
                  mb: 0.5
                }}
              >
                Tail Sensitivity Warning
              </Typography>
              <Typography 
                variant="caption" 
                display="block" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.813rem',
                  lineHeight: 1.6
                }}
              >
                This distribution has a heavy tail (ratio: {shape.tail_ratio}). 
                Small percentile shifts above p90 may cause large alert swings.
              </Typography>
            </Box>
          </Box>
        )}
        
        {/* Interpretation Help */}
        <Box sx={{ mt: 1 }}>
          <Typography 
            variant="caption" 
            sx={{ 
              color: PWC_COLORS.mediumGray,
              fontSize: '0.813rem',
              fontStyle: 'italic',
              lineHeight: 1.6
            }}
          >
            Right-skewed distributions are common in financial data: most entities are "normal", 
            while a few have extremely high values. This is why percentile-based thresholds work better 
            than fixed amounts.
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
};

export default DistributionShapeInsights;