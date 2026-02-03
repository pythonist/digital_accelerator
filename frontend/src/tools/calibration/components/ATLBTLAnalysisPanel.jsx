// frontend/src/tools/calibration/components/ATLBTLAnalysisPanel.jsx
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
  Divider,
  Paper
} from '@mui/material';
import {
  TrendingDown as TrendingDownIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

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

const ATLBTLAnalysisPanel = ({ 
  atlBtlSplit, 
  volumeSensitivity,
  strOverlay,
  narrative,
  loading 
}) => {
  
  if (!atlBtlSplit && !loading) {
    return (
      <Box>
        <Typography 
          variant="h6" 
          gutterBottom
          sx={{ 
            color: PWC_COLORS.darkGray,
            fontSize: '1rem',
            fontWeight: 600,
            mb: 2
          }}
        >
          ATL / BTL Analysis
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
          Adjust threshold to compute Above-the-Line / Below-the-Line analysis.
        </Alert>
      </Box>
    );
  }

  const chartData = atlBtlSplit ? [
    { 
      zone: 'ATL (Alerted)', 
      count: atlBtlSplit.atl?.count || 0,
      pct: atlBtlSplit.atl?.pct_population || 0,
      color: PWC_COLORS.error
    },
    { 
      zone: 'BTL (Near-Miss)', 
      count: atlBtlSplit.btl?.count || 0,
      pct: atlBtlSplit.btl?.pct_population || 0,
      color: PWC_COLORS.warning
    },
    { 
      zone: 'Far Below', 
      count: atlBtlSplit.far_below?.count || 0,
      pct: atlBtlSplit.far_below?.pct_population || 0,
      color: PWC_COLORS.success
    }
  ] : [];

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Box 
          sx={{ 
            bgcolor: PWC_COLORS.white, 
            p: 1.5, 
            border: `1px solid ${PWC_COLORS.lightGray}`,
            borderRadius: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        >
          <Typography 
            variant="caption" 
            display="block"
            sx={{ 
              fontWeight: 600,
              color: PWC_COLORS.darkGray,
              fontSize: '0.813rem',
              mb: 0.5
            }}
          >
            {data.zone}
          </Typography>
          <Typography 
            variant="caption" 
            display="block"
            sx={{ 
              color: PWC_COLORS.mediumGray,
              fontSize: '0.75rem'
            }}
          >
            Count: {data.count.toLocaleString()}
          </Typography>
          <Typography 
            variant="caption" 
            display="block"
            sx={{ 
              color: PWC_COLORS.mediumGray,
              fontSize: '0.75rem'
            }}
          >
            {data.pct.toFixed(1)}% of population
          </Typography>
        </Box>
      );
    }
    return null;
  };

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <TrendingDownIcon sx={{ color: PWC_COLORS.orange, fontSize: '1.25rem' }} />
          <Typography 
            variant="h6"
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '1rem',
              fontWeight: 600,
              letterSpacing: '-0.01em'
            }}
          >
            ATL / BTL Analysis
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
          }
        }}
      >
        <Typography 
          variant="body2"
          sx={{ 
            color: PWC_COLORS.darkGray,
            fontSize: '0.875rem',
            lineHeight: 1.6
          }}
        >
          <strong>Why ATL/BTL?</strong> Banks must justify "why not lower the threshold?" 
          This analysis shows incremental workload vs. risk capture if threshold is reduced.
        </Typography>
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={5}>
          <CircularProgress sx={{ color: PWC_COLORS.orange }} />
        </Box>
      ) : (
        <>
          <Grid container spacing={3}>
            {/* Population Split Chart */}
            <Grid item xs={12} md={6}>
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
                Population Split
              </Typography>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PWC_COLORS.lightGray} />
                  <XAxis 
                    dataKey="zone" 
                    tick={{ fontSize: 11, fill: PWC_COLORS.mediumGray }} 
                  />
                  <YAxis tick={{ fontSize: 11, fill: PWC_COLORS.mediumGray }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {atlBtlSplit?.btl_band && (
                <Box 
                  mt={2}
                  sx={{ 
                    p: 1.5,
                    bgcolor: '#FAFAFA',
                    borderRadius: 1,
                    border: `1px solid ${PWC_COLORS.lightGray}`
                  }}
                >
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      color: PWC_COLORS.mediumGray,
                      fontSize: '0.813rem'
                    }}
                  >
                    BTL Band: ₹{atlBtlSplit.btl_band.lower.toLocaleString()} - 
                    ₹{atlBtlSplit.btl_band.upper.toLocaleString()} 
                    ({atlBtlSplit.btl_band.pct}% below threshold)
                  </Typography>
                </Box>
              )}
            </Grid>

            {/* Volume Sensitivity */}
            <Grid item xs={12} md={6}>
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
                Incremental Alert Impact
              </Typography>
              
              {volumeSensitivity && (
                <Box>
                  <Paper 
                    variant="outlined" 
                    sx={{ 
                      p: 2.5, 
                      mb: 2, 
                      bgcolor: '#FFF9F0',
                      border: `1px solid ${PWC_COLORS.warning}`,
                      borderRadius: 1
                    }}
                  >
                    <Typography 
                      variant="body2" 
                      gutterBottom
                      sx={{ 
                        color: PWC_COLORS.darkGray,
                        fontSize: '0.875rem',
                        mb: 1
                      }}
                    >
                      If threshold lowered to BTL lower bound:
                    </Typography>
                    <Typography 
                      variant="h4" 
                      fontWeight={700}
                      sx={{ 
                        color: PWC_COLORS.error,
                        mb: 0.5
                      }}
                    >
                      +{volumeSensitivity.if_lowered_to_btl_lower?.incremental_alerts?.toLocaleString() || 0}
                    </Typography>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: PWC_COLORS.mediumGray,
                        fontSize: '0.813rem'
                      }}
                    >
                      additional alerts (+{volumeSensitivity.if_lowered_to_btl_lower?.pct_increase?.toFixed(1) || 0}%)
                    </Typography>
                  </Paper>

                  <Chip 
                    label={`Workload Impact: ${volumeSensitivity.workload_impact || 'N/A'}`}
                    size="small"
                    sx={{
                      bgcolor: 
                        volumeSensitivity.workload_impact === 'MINIMAL' ? '#F0F8F4' :
                        volumeSensitivity.workload_impact === 'MODERATE' ? '#FFF9F0' : '#FFF5F5',
                      color:
                        volumeSensitivity.workload_impact === 'MINIMAL' ? PWC_COLORS.success :
                        volumeSensitivity.workload_impact === 'MODERATE' ? PWC_COLORS.warning : PWC_COLORS.error,
                      border: `1px solid ${
                        volumeSensitivity.workload_impact === 'MINIMAL' ? PWC_COLORS.success :
                        volumeSensitivity.workload_impact === 'MODERATE' ? PWC_COLORS.warning : PWC_COLORS.error
                      }`,
                      fontWeight: 500,
                      fontSize: '0.75rem',
                      height: 24
                    }}
                  />
                </Box>
              )}
            </Grid>

            {/* STR Overlay */}
            {strOverlay && (
              <Grid item xs={12}>
                <Divider sx={{ my: 2, borderColor: PWC_COLORS.lightGray }} />
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
                  STR Capture Analysis (Read-Only)
                </Typography>
                
                <Grid container spacing={2}>
                  <Grid item xs={4}>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        textAlign: 'center',
                        border: `1px solid ${PWC_COLORS.lightGray}`,
                        boxShadow: 'none'
                      }}
                    >
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.813rem',
                          display: 'block',
                          mb: 0.5
                        }}
                      >
                        ATL STRs
                      </Typography>
                      <Typography 
                        variant="h5" 
                        sx={{ 
                          color: PWC_COLORS.error,
                          fontWeight: 600
                        }}
                      >
                        {strOverlay.atl_str?.total_strs || 0}
                      </Typography>
                      <Typography 
                        variant="caption"
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.75rem'
                        }}
                      >
                        {strOverlay.atl_str?.str_pct?.toFixed(1) || 0}%
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid item xs={4}>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        textAlign: 'center',
                        border: `1px solid ${PWC_COLORS.lightGray}`,
                        boxShadow: 'none'
                      }}
                    >
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.813rem',
                          display: 'block',
                          mb: 0.5
                        }}
                      >
                        BTL Additional STRs
                      </Typography>
                      <Typography 
                        variant="h5" 
                        sx={{ 
                          color: PWC_COLORS.warning,
                          fontWeight: 600
                        }}
                      >
                        {strOverlay.btl_str?.total_strs || 0}
                      </Typography>
                      <Typography 
                        variant="caption"
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.75rem'
                        }}
                      >
                        {strOverlay.btl_str?.str_pct?.toFixed(1) || 0}%
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid item xs={4}>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        textAlign: 'center',
                        border: `1px solid ${PWC_COLORS.lightGray}`,
                        boxShadow: 'none'
                      }}
                    >
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.813rem',
                          display: 'block',
                          mb: 0.5
                        }}
                      >
                        Total Period STRs
                      </Typography>
                      <Typography 
                        variant="h5"
                        sx={{ 
                          color: PWC_COLORS.darkGray,
                          fontWeight: 600
                        }}
                      >
                        {strOverlay.total_strs_in_period || 0}
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>

                <Alert 
                  severity="info" 
                  sx={{ 
                    mt: 2,
                    border: `1px solid ${PWC_COLORS.lightGray}`,
                    '& .MuiAlert-icon': {
                      color: PWC_COLORS.orange
                    }
                  }}
                >
                  <Typography 
                    variant="body2"
                    sx={{ 
                      color: PWC_COLORS.darkGray,
                      fontSize: '0.875rem'
                    }}
                  >
                    {strOverlay.conclusion}
                  </Typography>
                </Alert>
              </Grid>
            )}

            {/* Governance Narrative */}
            {narrative && (
              <Grid item xs={12}>
                <Divider sx={{ my: 2, borderColor: PWC_COLORS.lightGray }} />
                <Paper 
                  variant="outlined" 
                  sx={{ 
                    p: 2.5, 
                    bgcolor: '#FAFAFA',
                    border: `1px solid ${PWC_COLORS.lightGray}`,
                    borderRadius: 1
                  }}
                >
                  <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
                    <WarningIcon sx={{ color: PWC_COLORS.warning, fontSize: '1.125rem' }} />
                    <Typography 
                      variant="subtitle2" 
                      fontWeight={600}
                      sx={{ 
                        color: PWC_COLORS.darkGray,
                        fontSize: '0.938rem'
                      }}
                    >
                      Threshold Justification
                    </Typography>
                  </Box>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: PWC_COLORS.mediumGray,
                      fontSize: '0.875rem',
                      whiteSpace: 'pre-line',
                      lineHeight: 1.6
                    }}
                  >
                    {narrative.narrative}
                  </Typography>
                </Paper>
              </Grid>
            )}
          </Grid>
        </>
      )}
    </Box>
  );
};

export default ATLBTLAnalysisPanel;