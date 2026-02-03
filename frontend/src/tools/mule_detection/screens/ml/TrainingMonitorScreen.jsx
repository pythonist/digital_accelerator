// frontend/src/tools/mule_detection/screens/ml/TrainingMonitorScreen.jsx
/**
 * Live Training Monitor Screen
 * 
 * Audience: Everyone
 * Purpose: Real-time training visualization and progress
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Alert,
  LinearProgress, CircularProgress, Stack, Chip
} from '@mui/material';
import {
  CheckCircle, Error, HourglassEmpty, TrendingUp,
  Warning, Refresh
} from '@mui/icons-material';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';

const TrainingMonitorScreen = ({ jobId: jobIdProp, navigateTo }) => {
  const jobId = jobIdProp || 'local_sync_completed';
  
  const [jobStatus, setJobStatus] = useState(null);
  const [polling, setPolling] = useState(true);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [finalResult, setFinalResult] = useState(null);

  useEffect(() => {
    if (jobId) {
      pollTrainingStatus();
    }
  }, [jobId]);

  useEffect(() => {
    if (polling && jobId) {
      const interval = setInterval(() => {
        pollTrainingStatus();
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [polling, jobId]);

  const pollTrainingStatus = async () => {
    try {
      const response = await muleApi.getTrainingStatus(jobId);
      
      setJobStatus(response);
      
      // Add to metrics history if available
      if (response.metrics_live) {
        setMetricsHistory(prev => {
          const newMetrics = {
            timestamp: Date.now(),
            ...response.metrics_live
          };
          return [...prev, newMetrics].slice(-50); // Keep last 50 points
        });
      }
      
      // Stop polling if complete or failed
      if (response.status === 'COMPLETED' || response.status === 'FAILED') {
        setPolling(false);
        
        if (response.status === 'COMPLETED') {
          loadFinalResult();
        }
      }
    } catch (error) {
      console.error('Failed to poll status:', error);
      setPolling(false);
    }
  };

  const loadFinalResult = async () => {
    try {
      const response = await muleApi.getTrainingResult(jobId);
      if (response.success) {
        setFinalResult(response.result);
      }
    } catch (error) {
      console.error('Failed to load result:', error);
    }
  };

  const getStatusIcon = () => {
    if (!jobStatus) return <CircularProgress size={24} />;
    
    switch (jobStatus.status) {
      case 'COMPLETED':
        return <CheckCircle sx={{ color: '#4caf50', fontSize: 40 }} />;
      case 'FAILED':
        return <Error sx={{ color: '#f44336', fontSize: 40 }} />;
      case 'RUNNING':
        return <CircularProgress size={40} sx={{ color: pwcColors.primary }} />;
      default:
        return <HourglassEmpty sx={{ color: '#ff9800', fontSize: 40 }} />;
    }
  };

  const getStatusColor = () => {
    if (!jobStatus) return pwcColors.textMuted;
    
    switch (jobStatus.status) {
      case 'COMPLETED': return '#4caf50';
      case 'FAILED': return '#f44336';
      case 'RUNNING': return pwcColors.primary;
      default: return '#ff9800';
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            Training Monitor
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Job ID: {jobId}
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={2}>
          {jobStatus?.status === 'RUNNING' && (
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={pollTrainingStatus}
            >
              Refresh
            </Button>
          )}
          {jobStatus?.status === 'COMPLETED' && (
            <Button
              variant="contained"
              onClick={() => navigateTo?.('ml-overview')}
              sx={{ bgcolor: pwcColors.primary }}
            >
              View Model
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Status Card */}
      <Card elevation={0} sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={3} alignItems="center">
            {getStatusIcon()}
            
            <Box flex={1}>
              <Stack direction="row" spacing={2} alignItems="center" mb={1}>
                <Typography variant="h6" fontWeight={600}>
                  {jobStatus?.status || 'Loading...'}
                </Typography>
                <Chip 
                  label={jobStatus?.stage || 'Initializing'}
                  size="small"
                  sx={{ bgcolor: pwcColors.backgroundLight }}
                />
              </Stack>
              
              {jobStatus?.status === 'RUNNING' && (
                <Box sx={{ mt: 2 }}>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="caption">Progress</Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {jobStatus.progress}%
                    </Typography>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={jobStatus.progress || 0}
                    sx={{ 
                      height: 8, 
                      borderRadius: 1,
                      bgcolor: '#e0e0e0',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getStatusColor()
                      }
                    }}
                  />
                </Box>
              )}
              
              {jobStatus?.status === 'FAILED' && jobStatus.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    {jobStatus.error}
                  </Typography>
                </Alert>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Live Metrics Chart */}
      {metricsHistory.length > 0 && jobStatus?.status === 'RUNNING' && (
        <Card elevation={0} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Live Training Metrics
            </Typography>
            
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                  hide
                />
                <YAxis domain={[0, 1]} />
                <Tooltip 
                  labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                  formatter={(value) => (value * 100).toFixed(1) + '%'}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="train_auc" 
                  stroke="#2196f3" 
                  name="Train AUC"
                  strokeWidth={2}
                  dot={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="val_auc" 
                  stroke={pwcColors.primary} 
                  name="Val AUC"
                  strokeWidth={2}
                  dot={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="val_recall" 
                  stroke="#4caf50" 
                  name="Val Recall"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>

            <Alert severity="info" sx={{ mt: 2 }} icon={<TrendingUp />}>
              <Typography variant="caption">
                Watch for: Val AUC should climb steadily. If Train AUC {">>"} Val AUC, model may be overfitting.
              </Typography>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Final Results */}
      {jobStatus?.status === 'COMPLETED' && finalResult && (
        <>
          <Card elevation={0} sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Training Complete ✓
              </Typography>
              
              <Grid container spacing={2} mt={1}>
                <Grid item xs={6} md={3}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="h4" fontWeight={700} color={pwcColors.primary}>
                      {(finalResult.metrics.val_auc * 100).toFixed(1)}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Validation AUC
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={6} md={3}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="h4" fontWeight={700} color="#4caf50">
                      {(finalResult.metrics.recall * 100).toFixed(1)}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Recall
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={6} md={3}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="h4" fontWeight={700} color="#2196f3">
                      {(finalResult.metrics.precision * 100).toFixed(1)}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Precision
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={6} md={3}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="h4" fontWeight={700} color="#9c27b0">
                      {(finalResult.metrics.f1 * 100).toFixed(1)}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      F1 Score
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Stack spacing={2} mt={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Model Version
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {finalResult.model_version}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Training Samples
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {finalResult.training_samples.toLocaleString()}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Features Used
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {finalResult.feature_count}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          {/* Performance Analysis */}
          <Card elevation={0}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Performance Analysis
              </Typography>
              
              {finalResult.metrics.recall >= 0.90 ? (
                <Alert severity="success" icon={<CheckCircle />}>
                  <Typography variant="body2" fontWeight={600}>
                    Meets AML Target
                  </Typography>
                  <Typography variant="caption">
                    Recall ≥ 90% - Model achieves regulatory standard for mule detection
                  </Typography>
                </Alert>
              ) : (
                <Alert severity="warning" icon={<Warning />}>
                  <Typography variant="body2" fontWeight={600}>
                    Below AML Target
                  </Typography>
                  <Typography variant="caption">
                    Recall &lt; 90% - Consider retraining with adjusted hyperparameters or more data
                  </Typography>
                </Alert>
              )}

              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary" paragraph>
                  <strong>Next Steps:</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary" component="ul" sx={{ pl: 2 }}>
                  <li>Review feature importance to understand key drivers</li>
                  <li>Compare with existing models in Model Comparison</li>
                  <li>Activate model if performance is satisfactory</li>
                  <li>Test on real accounts before full deployment</li>
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {/* Action Buttons */}
      {jobStatus?.status === 'COMPLETED' && (
        <Stack direction="row" spacing={2} mt={3}>
          <Button
            variant="contained"
            onClick={async () => {
              if (finalResult?.model_version) {
                try {
                  await muleApi.activateModel(finalResult.model_version);
                } catch (e) {
                }
              }
              navigateTo?.('ml-overview');
            }}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Use This Model
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigateTo?.('ml-training')}
          >
            Retrain
          </Button>
        </Stack>
      )}

      {jobStatus?.status === 'FAILED' && (
        <Stack direction="row" spacing={2} mt={3}>
          <Button
            variant="contained"
            onClick={() => navigateTo?.('ml-training')}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Try Again
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigateTo?.('ml-overview')}
          >
            Back to Overview
          </Button>
        </Stack>
      )}
    </Box>
  );
};

export default TrainingMonitorScreen;
