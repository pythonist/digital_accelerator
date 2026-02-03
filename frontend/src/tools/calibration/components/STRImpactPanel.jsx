// frontend/src/tools/calibration/components/STRImpactPanel.jsx
// PwC Professional Design

import React, { useState, useEffect } from 'react';
import {
  Card, CardContent, Box, Typography, Grid, LinearProgress,
  Alert, Stack, Chip, Divider, Button, Collapse
} from '@mui/material';
import {
  CheckCircle, Cancel, Warning, Info, ExpandMore, ExpandLess
} from '@mui/icons-material';
import apiClient from '@services/api';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  errorLight: '#FFF5F5',
  success: '#107C41',
  successLight: '#F0F8F4',
  warning: '#F7941E',
  warningLight: '#FFF9F0',
  infoLight: '#F5F9FF'
};

const STRImpactPanel = ({ runId, threshold, metric = 'amount' }) => {
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [missedDetails, setMissedDetails] = useState(null);
  
  useEffect(() => {
    if (runId && threshold) {
      loadEvaluation();
    }
  }, [runId, threshold]);
  
  const loadEvaluation = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/str-evaluation`,
        { threshold, metric }
      );
      
      setEvaluation(res);
      
    } catch (err) {
      console.error('Failed to load STR evaluation:', err);
      
      if (err.response?.data?.error?.includes('strs')) {
        setEvaluation({
          note: 'STR data not available for this run',
          total_strs: 0
        });
      }
    } finally {
      setLoading(false);
    }
  };
  
  const loadMissedDetails = async () => {
    if (!evaluation || evaluation.missed_strs === 0) return;
    
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/str-missed-details`,
        { threshold, metric, limit: 50 }
      );
      
      setMissedDetails(res);
      setExpanded(true);
      
    } catch (err) {
      console.error('Failed to load missed STR details:', err);
    }
  };
  
  if (loading && !evaluation) {
    return (
      <Card 
        variant="outlined"
        sx={{ 
          border: `1px solid ${PWC_COLORS.lightGray}`,
          boxShadow: 'none'
        }}
      >
        <CardContent>
          <Typography 
            variant="subtitle2" 
            gutterBottom
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '0.938rem',
              fontWeight: 600
            }}
          >
            STR Capture Evaluation
          </Typography>
          <LinearProgress sx={{ '& .MuiLinearProgress-bar': { bgcolor: PWC_COLORS.orange } }} />
        </CardContent>
      </Card>
    );
  }
  
  if (!evaluation || evaluation.total_strs === 0) {
    return (
      <Card 
        variant="outlined"
        sx={{ 
          border: `1px solid ${PWC_COLORS.lightGray}`,
          boxShadow: 'none'
        }}
      >
        <CardContent>
          <Typography 
            variant="subtitle2" 
            gutterBottom
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '0.938rem',
              fontWeight: 600,
              mb: 2
            }}
          >
            STR Capture Evaluation
          </Typography>
          <Alert 
            severity="info" 
            icon={<Info sx={{ color: PWC_COLORS.orange }} />}
            sx={{
              border: `1px solid ${PWC_COLORS.lightGray}`,
              '& .MuiAlert-message': {
                color: PWC_COLORS.darkGray,
                fontSize: '0.875rem'
              }
            }}
          >
            {evaluation?.note || 'No STR data available for this calibration period'}
          </Alert>
        </CardContent>
      </Card>
    );
  }
  
  const captureRate = evaluation.capture_rate || 0;
  const precision = evaluation.precision || 0;
  
  const getCaptureColor = (rate) => {
    if (rate >= 90) return PWC_COLORS.success;
    if (rate >= 70) return PWC_COLORS.warning;
    return PWC_COLORS.error;
  };
  
  return (
    <Card 
      variant="outlined" 
      sx={{ 
        borderTop: `3px solid ${evaluation.missed_strs > 0 ? PWC_COLORS.error : PWC_COLORS.success}`,
        border: `1px solid ${PWC_COLORS.lightGray}`,
        boxShadow: 'none'
      }}
    >
      <CardContent>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography 
              variant="subtitle2" 
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                mb: 0.5
              }}
            >
              STR CAPTURE EVALUATION
            </Typography>
            <Typography 
              variant="caption" 
              sx={{ 
                color: PWC_COLORS.mediumGray,
                fontSize: '0.813rem'
              }}
            >
              Ground truth overlay (post-investigation)
            </Typography>
          </Box>
          <Chip 
            label="Read-Only" 
            size="small" 
            sx={{
              bgcolor: PWC_COLORS.infoLight,
              color: PWC_COLORS.orange,
              border: `1px solid ${PWC_COLORS.orange}`,
              fontWeight: 500,
              fontSize: '0.75rem',
              height: 24
            }}
          />
        </Stack>
        
        {/* Key Metrics Grid */}
        <Grid container spacing={2} mb={2}>
          {/* Total STRs */}
          <Grid item xs={6}>
            <Box 
              sx={{ 
                p: 1.5, 
                bgcolor: PWC_COLORS.infoLight, 
                borderRadius: 1, 
                border: `1px solid ${PWC_COLORS.lightGray}`
              }}
            >
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray, 
                  display: 'block', 
                  mb: 0.5,
                  fontSize: '0.75rem'
                }}
              >
                Total STRs (Period)
              </Typography>
              <Typography 
                variant="h5" 
                fontWeight={700}
                sx={{ color: PWC_COLORS.darkGray }}
              >
                {evaluation.total_strs.toLocaleString()}
              </Typography>
            </Box>
          </Grid>
          
          {/* Captured STRs */}
          <Grid item xs={6}>
            <Box 
              sx={{ 
                p: 1.5, 
                bgcolor: PWC_COLORS.successLight, 
                borderRadius: 1, 
                border: `1px solid ${PWC_COLORS.success}`
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                <CheckCircle sx={{ fontSize: 14, color: PWC_COLORS.success }} />
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: PWC_COLORS.mediumGray,
                    fontSize: '0.75rem'
                  }}
                >
                  Captured STRs
                </Typography>
              </Stack>
              <Typography 
                variant="h5" 
                fontWeight={700}
                sx={{ color: PWC_COLORS.success }}
              >
                {evaluation.captured_strs.toLocaleString()}
              </Typography>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.75rem'
                }}
              >
                {captureRate}% capture rate
              </Typography>
            </Box>
          </Grid>
          
          {/* Missed STRs */}
          <Grid item xs={6}>
            <Box 
              sx={{ 
                p: 1.5, 
                bgcolor: PWC_COLORS.errorLight, 
                borderRadius: 1, 
                border: `1px solid ${PWC_COLORS.error}`
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                <Cancel sx={{ fontSize: 14, color: PWC_COLORS.error }} />
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: PWC_COLORS.mediumGray,
                    fontSize: '0.75rem'
                  }}
                >
                  Missed STRs
                </Typography>
              </Stack>
              <Typography 
                variant="h5" 
                fontWeight={700}
                sx={{ color: PWC_COLORS.error }}
              >
                {evaluation.missed_strs.toLocaleString()}
              </Typography>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.75rem'
                }}
              >
                {(100 - captureRate).toFixed(1)}% missed
              </Typography>
            </Box>
          </Grid>
          
          {/* False Positives */}
          <Grid item xs={6}>
            <Box 
              sx={{ 
                p: 1.5, 
                bgcolor: PWC_COLORS.warningLight, 
                borderRadius: 1, 
                border: `1px solid ${PWC_COLORS.warning}`
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                <Warning sx={{ fontSize: 14, color: PWC_COLORS.warning }} />
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: PWC_COLORS.mediumGray,
                    fontSize: '0.75rem'
                  }}
                >
                  False Positives
                </Typography>
              </Stack>
              <Typography 
                variant="h5" 
                fontWeight={700}
                sx={{ color: PWC_COLORS.warning }}
              >
                {evaluation.false_positives.toLocaleString()}
              </Typography>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.75rem'
                }}
              >
                {precision.toFixed(1)}% precision
              </Typography>
            </Box>
          </Grid>
        </Grid>
        
        {/* Capture Rate Bar */}
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
            <Typography 
              variant="caption" 
              fontWeight={600}
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.813rem'
              }}
            >
              STR Capture Rate
            </Typography>
            <Chip 
              label={`${captureRate}%`} 
              size="small" 
              sx={{
                bgcolor: 
                  captureRate >= 90 ? PWC_COLORS.successLight : 
                  captureRate >= 70 ? PWC_COLORS.warningLight : PWC_COLORS.errorLight,
                color: getCaptureColor(captureRate),
                border: `1px solid ${getCaptureColor(captureRate)}`,
                fontWeight: 600,
                fontSize: '0.75rem',
                height: 24
              }}
            />
          </Stack>
          <LinearProgress 
            variant="determinate" 
            value={captureRate} 
            sx={{ 
              height: 8, 
              borderRadius: 4,
              bgcolor: PWC_COLORS.lightGray,
              '& .MuiLinearProgress-bar': {
                bgcolor: getCaptureColor(captureRate)
              }
            }}
          />
        </Box>
        
        <Divider sx={{ my: 2, borderColor: PWC_COLORS.lightGray }} />
        
        {/* Missed STRs Details (Expandable) */}
        {evaluation.missed_strs > 0 && (
          <>
            <Button
              fullWidth
              size="small"
              variant="outlined"
              endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
              onClick={() => {
                if (!missedDetails) {
                  loadMissedDetails();
                } else {
                  setExpanded(!expanded);
                }
              }}
              sx={{
                textTransform: 'none',
                color: PWC_COLORS.error,
                borderColor: PWC_COLORS.error,
                fontWeight: 500,
                fontSize: '0.875rem',
                '&:hover': {
                  borderColor: PWC_COLORS.error,
                  bgcolor: PWC_COLORS.errorLight
                }
              }}
            >
              View {evaluation.missed_strs} Missed STR Accounts
            </Button>
            
            <Collapse in={expanded}>
              {missedDetails && (
                <Box sx={{ mt: 2, maxHeight: 300, overflow: 'auto' }}>
                  <Alert 
                    severity="error" 
                    icon={<Warning sx={{ color: PWC_COLORS.error }} />} 
                    sx={{ 
                      mb: 2,
                      border: `1px solid ${PWC_COLORS.error}`,
                      '& .MuiAlert-message': {
                        color: PWC_COLORS.darkGray
                      }
                    }}
                  >
                    <Typography 
                      variant="caption" 
                      fontWeight={600} 
                      display="block"
                      sx={{ 
                        fontSize: '0.813rem',
                        mb: 0.5
                      }}
                    >
                      SUPPRESSION RISK
                    </Typography>
                    <Typography 
                      variant="caption"
                      sx={{ fontSize: '0.813rem' }}
                    >
                      These accounts filed STRs but fell below your threshold.
                      They were suppressed by calibration.
                    </Typography>
                  </Alert>
                  
                  <Stack spacing={1}>
                    {missedDetails.records.map((record, idx) => (
                      <Box 
                        key={idx}
                        sx={{ 
                          p: 1.5, 
                          bgcolor: PWC_COLORS.warningLight, 
                          borderRadius: 1, 
                          border: `1px solid ${PWC_COLORS.warning}`
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" mb={0.5}>
                          <Typography 
                            variant="caption" 
                            fontWeight={600}
                            sx={{ 
                              fontSize: '0.813rem',
                              color: PWC_COLORS.darkGray
                            }}
                          >
                            {record.account_id}
                          </Typography>
                          <Chip 
                            label={record.risk_rating || 'N/A'} 
                            size="small" 
                            sx={{ 
                              height: 20, 
                              fontSize: '0.688rem',
                              bgcolor: PWC_COLORS.white,
                              border: `1px solid ${PWC_COLORS.lightGray}`
                            }}
                          />
                        </Stack>
                        <Grid container spacing={1}>
                          <Grid item xs={6}>
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                color: PWC_COLORS.mediumGray,
                                fontSize: '0.75rem'
                              }}
                            >
                              Aggregated Value
                            </Typography>
                            <Typography 
                              variant="body2" 
                              fontWeight={600}
                              sx={{ 
                                fontSize: '0.875rem',
                                color: PWC_COLORS.darkGray
                              }}
                            >
                              ₹{record.aggregated_value.toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                color: PWC_COLORS.mediumGray,
                                fontSize: '0.75rem'
                              }}
                            >
                              Distance from Threshold
                            </Typography>
                            <Typography 
                              variant="body2" 
                              fontWeight={600}
                              sx={{ 
                                fontSize: '0.875rem',
                                color: PWC_COLORS.error
                              }}
                            >
                              {record.distance_pct.toFixed(1)}% below
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Collapse>
          </>
        )}
        
        {/* Info Footer */}
        <Box 
          sx={{ 
            mt: 2, 
            p: 1.5, 
            bgcolor: PWC_COLORS.infoLight, 
            borderRadius: 1,
            border: `1px solid ${PWC_COLORS.lightGray}`
          }}
        >
          <Typography 
            variant="caption" 
            sx={{ 
              color: PWC_COLORS.darkGray, 
              display: 'block', 
              fontWeight: 500,
              fontSize: '0.813rem',
              lineHeight: 1.6
            }}
          >
            <strong>What is STR evaluation?</strong> STRs (Suspicious Transaction Reports) are filed 
            after investigation. This panel shows which STRs your threshold would have captured 
            if applied during this period. Missed STRs indicate suppression risk.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default STRImpactPanel;