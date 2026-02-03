// frontend/src/tools/calibration/components/KSStatisticsPanel.jsx
// PwC Professional Design

import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Grid,
  Alert,
  CircularProgress,
  Chip,
  Divider
} from '@mui/material';
import { TrendingUp as TrendingUpIcon } from '@mui/icons-material';

import KSInterpretationBadge from './KSInterpretationBadge';
import KSCDFComparisonChart from './KSCDFComparisonChart';
import KSSensitivityCurve from './KSSensitivityCurve';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  success: '#107C41'
};

const KSStatisticsPanel = ({ 
  ksStatistic, 
  ksSensitivity,
  cdfData,
  ksNarrative,
  loading,
  currentThreshold,
  currentPercentile
}) => {
  
  if (!ksStatistic && !loading) {
    return (
      <Box>
        <Typography 
          variant="h6"
          sx={{ 
            color: PWC_COLORS.darkGray,
            fontSize: '1rem',
            fontWeight: 600,
            mb: 2
          }}
        >
          KS Statistics
        </Typography>
        <Alert 
          severity="info"
          sx={{
            border: `1px solid ${PWC_COLORS.lightGray}`,
            '& .MuiAlert-icon': {
              color: PWC_COLORS.orange
            },
            '& .MuiAlert-message': {
              color: PWC_COLORS.darkGray,
              fontSize: '0.875rem'
            }
          }}
        >
          Adjust threshold to compute Kolmogorov-Smirnov separation statistics.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <TrendingUpIcon sx={{ color: PWC_COLORS.orange, fontSize: '1.25rem' }} />
          <Typography 
            variant="h6"
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '1rem',
              fontWeight: 600,
              letterSpacing: '-0.01em'
            }}
          >
            KS Distribution Separation
          </Typography>
        </Box>
        
        {loading && <CircularProgress size={20} sx={{ color: PWC_COLORS.orange }} />}
      </Box>

      {/* Explainer */}
      <Alert 
        severity="info" 
        sx={{ 
          mb: 3,
          border: `1px solid ${PWC_COLORS.lightGray}`,
          '& .MuiAlert-icon': {
            color: PWC_COLORS.orange
          },
          '& .MuiAlert-message': {
            color: PWC_COLORS.darkGray
          }
        }}
      >
        <Typography 
          variant="body2"
          sx={{ fontSize: '0.875rem', lineHeight: 1.6 }}
        >
          <strong>What is KS?</strong> Measures how different the alerted population is from 
          the suppressed population. Higher KS = clearer behavioral separation at this threshold.
        </Typography>
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={5}>
          <CircularProgress sx={{ color: PWC_COLORS.orange }} />
        </Box>
      ) : (
        <>
          <Grid container spacing={3}>
            {/* KS Value & Interpretation */}
            <Grid item xs={12} md={6}>
              <KSInterpretationBadge 
                ksStatistic={ksStatistic}
                narrative={ksNarrative}
              />
            </Grid>

            {/* Population Splits */}
            <Grid item xs={12} md={6}>
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
                  Population Split at ₹{currentThreshold?.toLocaleString()}
                </Typography>
                
                <Box display="flex" gap={3} mt={2}>
                  <Box>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: PWC_COLORS.mediumGray,
                        fontSize: '0.813rem',
                        display: 'block',
                        mb: 0.5
                      }}
                    >
                      Alerted
                    </Typography>
                    <Typography 
                      variant="h6" 
                      sx={{ 
                        color: PWC_COLORS.error,
                        fontWeight: 600,
                        fontSize: '1.5rem'
                      }}
                    >
                      {ksStatistic?.populations?.alerted_size?.toLocaleString() || 0}
                    </Typography>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: PWC_COLORS.mediumGray,
                        fontSize: '0.75rem'
                      }}
                    >
                      ({ksStatistic?.populations?.alerted_pct || 0}% of population)
                    </Typography>
                  </Box>
                  
                  <Divider orientation="vertical" flexItem />
                  
                  <Box>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: PWC_COLORS.mediumGray,
                        fontSize: '0.813rem',
                        display: 'block',
                        mb: 0.5
                      }}
                    >
                      Suppressed
                    </Typography>
                    <Typography 
                      variant="h6" 
                      sx={{ 
                        color: PWC_COLORS.success,
                        fontWeight: 600,
                        fontSize: '1.5rem'
                      }}
                    >
                      {ksStatistic?.populations?.suppressed_size?.toLocaleString() || 0}
                    </Typography>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: PWC_COLORS.mediumGray,
                        fontSize: '0.75rem'
                      }}
                    >
                      ({(100 - (ksStatistic?.populations?.alerted_pct || 0)).toFixed(2)}% of population)
                    </Typography>
                  </Box>
                </Box>

                {ksStatistic?.max_separation_point && (
                  <Box mt={2}>
                    <Chip 
                      label={`Max Separation at ₹${ksStatistic.max_separation_point.toLocaleString()}`}
                      size="small"
                      sx={{
                        bgcolor: PWC_COLORS.lightGray,
                        color: PWC_COLORS.darkGray,
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        height: 24
                      }}
                    />
                  </Box>
                )}
              </Box>
            </Grid>

            {/* CDF Comparison Chart */}
            {cdfData && (
              <Grid item xs={12}>
                <KSCDFComparisonChart 
                  cdfData={cdfData}
                  threshold={currentThreshold}
                />
              </Grid>
            )}

            {/* KS Sensitivity Curve */}
            {ksSensitivity && (
              <Grid item xs={12}>
                <KSSensitivityCurve 
                  sensitivityData={ksSensitivity}
                  currentPercentile={currentPercentile}
                />
              </Grid>
            )}
          </Grid>
        </>
      )}
    </Box>
  );
};

export default KSStatisticsPanel;