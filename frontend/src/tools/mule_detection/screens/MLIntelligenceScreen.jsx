// frontend/src/tools/mule_detection/screens/MLIntelligenceScreen.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Alert,
  Chip, LinearProgress, CircularProgress, Stack, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import {
  Psychology, TrendingUp, Speed, Check, Warning,
  Refresh, PlayArrow, CloudUpload
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';

const MLIntelligenceScreen = () => {
  const [modelInfo, setModelInfo] = useState(null);
  const [hasModel, setHasModel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [trainDialog, setTrainDialog] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(null);
  const [featureImportance, setFeatureImportance] = useState([]);

  useEffect(() => {
    loadModelInfo();
  }, []);

  const loadModelInfo = async () => {
    setLoading(true);
    try {
      const response = await muleApi.getMLModelInfo();
      
      if (response.has_model) {
        setHasModel(true);
        setModelInfo(response.model_info);
        
        // Extract feature importance
        if (response.feature_importance) {
          const importanceArray = Object.entries(response.feature_importance)
            .map(([feature, importance]) => ({
              feature: formatFeatureName(feature),
              importance: importance
            }))
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 10);
          
          setFeatureImportance(importanceArray);
        }
      } else {
        setHasModel(false);
      }
    } catch (error) {
      console.error('Failed to load model info:', error);
      setHasModel(false);
    } finally {
      setLoading(false);
    }
  };

  const handleTrainModel = async () => {
    setTraining(true);
    setTrainDialog(false);
    setTrainingProgress({ status: 'Preparing dataset...', progress: 20 });

    try {
      setTimeout(() => setTrainingProgress({ status: 'Training model...', progress: 50 }), 1000);
      
      const response = await muleApi.trainMLModel({
        validation_split: 0.2
      });

      if (response.success) {
        setTrainingProgress({ status: 'Training complete!', progress: 100 });
        
        setTimeout(() => {
          setTraining(false);
          setTrainingProgress(null);
          loadModelInfo();
        }, 1500);
      }
    } catch (error) {
      console.error('Training failed:', error);
      setTraining(false);
      setTrainingProgress(null);
    }
  };

  const formatFeatureName = (name) => {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getHealthColor = (status) => {
    switch (status) {
      case 'HEALTHY': return '#4caf50';
      case 'DEGRADED': return '#ff9800';
      default: return '#f44336';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress sx={{ color: pwcColors.primary }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            ML Intelligence Layer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Production-grade machine learning for mule detection
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={2}>
          {hasModel && (
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={loadModelInfo}
              sx={{ borderColor: pwcColors.primary, color: pwcColors.primary }}
            >
              Refresh
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={training ? <CircularProgress size={20} color="inherit" /> : <PlayArrow />}
            onClick={() => setTrainDialog(true)}
            disabled={training}
            sx={{ bgcolor: pwcColors.primary, '&:hover': { bgcolor: '#c14a0a' } }}
          >
            {hasModel ? 'Retrain Model' : 'Train Model'}
          </Button>
        </Stack>
      </Stack>

      {/* Training Progress */}
      {training && trainingProgress && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600}>
              {trainingProgress.status}
            </Typography>
            <LinearProgress 
              variant="determinate" 
              value={trainingProgress.progress} 
              sx={{ height: 6, borderRadius: 1 }}
            />
          </Stack>
        </Alert>
      )}

      {/* No Model State */}
      {!hasModel && !training && (
        <Card elevation={0} sx={{ textAlign: 'center', py: 8 }}>
          <Psychology sx={{ fontSize: 80, color: pwcColors.textMuted, mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No ML Model Trained
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}>
            Train a machine learning model to complement pattern detection with learned mule behavior. 
            The model requires labeled data (is_mule column in accounts.csv).
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrow />}
            onClick={() => setTrainDialog(true)}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Train First Model
          </Button>
        </Card>
      )}

      {/* Model Dashboard */}
      {hasModel && modelInfo && (
        <Grid container spacing={3}>
          {/* Model Status Card */}
          <Grid item xs={12} md={4}>
            <Card elevation={0}>
              <CardContent>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="overline" color="text.secondary">
                      Model Status
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1} mt={1}>
                      <Check sx={{ color: getHealthColor('HEALTHY') }} />
                      <Typography variant="h6" fontWeight={600}>
                        Active & Healthy
                      </Typography>
                    </Stack>
                  </Box>

                  <Divider />

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Trained At
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {new Date(modelInfo.trained_at).toLocaleString()}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Training Samples
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {modelInfo.training_samples?.toLocaleString()}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Features Used
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {modelInfo.feature_count}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Performance Metrics */}
          <Grid item xs={12} md={8}>
            <Card elevation={0}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Performance Metrics
                </Typography>
                
                <Grid container spacing={2} mt={1}>
                  <Grid item xs={6} md={3}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color={pwcColors.primary}>
                        {(modelInfo.metrics?.val_auc * 100).toFixed(1)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Validation AUC
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={6} md={3}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="#4caf50">
                        {(modelInfo.metrics?.val_recall * 100).toFixed(1)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Recall
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={6} md={3}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="#2196f3">
                        {(modelInfo.metrics?.val_precision * 100).toFixed(1)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Precision
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid item xs={6} md={3}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <Typography variant="h4" fontWeight={700} color="#9c27b0">
                        {(modelInfo.metrics?.val_f1 * 100).toFixed(1)}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        F1 Score
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>

                <Alert severity="info" sx={{ mt: 2 }} icon={<TrendingUp />}>
                  <Typography variant="caption">
                    <strong>AML Focus:</strong> Model optimized for high recall (90%+) to minimize false negatives.
                    Precision balanced to manage analyst workload.
                  </Typography>
                </Alert>
              </CardContent>
            </Card>
          </Grid>

          {/* Feature Importance */}
          <Grid item xs={12}>
            <Card elevation={0}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Top Feature Importance
                </Typography>
                <Typography variant="caption" color="text.secondary" gutterBottom display="block" mb={2}>
                  Features that contribute most to mule detection decisions
                </Typography>

                {featureImportance.length > 0 && (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={featureImportance} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="feature" type="category" width={150} />
                      <Tooltip />
                      <Bar dataKey="importance" fill={pwcColors.primary} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* ML Insights */}
          <Grid item xs={12}>
            <Card elevation={0} sx={{ bgcolor: '#fff3e0' }}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Warning sx={{ color: '#ff9800', mt: 0.5 }} />
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      Why Hybrid (ML + Patterns) is Best for AML
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • <strong>Patterns alone</strong> are rigid and miss evolving mule tactics<br />
                      • <strong>ML alone</strong> is a black box and hard to explain to regulators<br />
                      • <strong>Hybrid approach</strong> combines explainable rules with learned behavior for highest detection with transparency
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Train Model Dialog */}
      <Dialog open={trainDialog} onClose={() => setTrainDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Train ML Model</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Training requires labeled data with an <code>is_mule</code> column in accounts.csv
          </Alert>
          
          <Typography variant="body2" color="text.secondary" paragraph>
            The model will:
          </Typography>
          <Typography variant="body2" color="text.secondary" component="ul" sx={{ pl: 2 }}>
            <li>Learn from existing feature patterns</li>
            <li>Optimize for high recall (90%+ mule detection)</li>
            <li>Balance precision to manage false positives</li>
            <li>Provide SHAP explanations for predictions</li>
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Training typically takes 30-60 seconds depending on dataset size.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrainDialog(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleTrainModel}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Start Training
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MLIntelligenceScreen;