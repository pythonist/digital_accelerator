// frontend/src/tools/mule_detection/screens/ml/MLOverviewScreen.jsx
/**
 * ML Overview Screen
 * 
 * Audience: Product / Compliance / Analysts
 * Purpose: High-level model status and health
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Alert,
  Chip, Stack, CircularProgress, Divider
} from '@mui/material';
import {
  Psychology, CheckCircle, Warning, TrendingUp, Speed,
  Settings, CompareArrows, Science
} from '@mui/icons-material';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';

const MLOverviewScreen = ({ navigateTo }) => {
  const [loading, setLoading] = useState(true);
  const [activeModel, setActiveModel] = useState(null);
  const [modelHealth, setModelHealth] = useState(null);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    setLoading(true);
    try {
      // Get active model
      const modelsResponse = await muleApi.listModels();
      const active = modelsResponse.models?.find(m => m.status === 'ACTIVE');
      
      if (active) {
        setActiveModel(active);
        
        // Determine health
        const health = determineHealth(active);
        setModelHealth(health);
      }
    } catch (error) {
      console.error('Failed to load overview:', error);
    } finally {
      setLoading(false);
    }
  };

  const determineHealth = (model) => {
    const recall = model.recall;
    const auc = model.auc;
    
    if (recall >= 0.90 && auc >= 0.80) {
      return {
        status: 'HEALTHY',
        color: '#4caf50',
        icon: CheckCircle,
        message: 'Model performing within AML targets'
      };
    } else if (recall >= 0.85 || auc >= 0.75) {
      return {
        status: 'DEGRADED',
        color: '#ff9800',
        icon: Warning,
        message: 'Model performance below optimal - consider retraining'
      };
    } else {
      return {
        status: 'CRITICAL',
        color: '#f44336',
        icon: Warning,
        message: 'Model performance critically low - retrain immediately'
      };
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress sx={{ color: pwcColors.primary }} />
      </Box>
    );
  }

  if (!activeModel) {
    return (
      <Box sx={{ p: 3 }}>
        <Card elevation={0} sx={{ textAlign: 'center', py: 8 }}>
          <Psychology sx={{ fontSize: 80, color: pwcColors.textMuted, mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Active ML Model
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}>
            Train and activate a machine learning model to enhance mule detection with learned behavior patterns.
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigateTo?.('ml-training')}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Train First Model
          </Button>
        </Card>
      </Box>
    );
  }

  const HealthIcon = modelHealth.icon;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            ML Intelligence Overview
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Active model status and performance
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            startIcon={<Settings />}
            onClick={() => navigateTo?.('ml-training')}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Train New Model
          </Button>
        </Stack>
      </Stack>

      {/* Model Health Card */}
      <Card elevation={0} sx={{ mb: 3, borderLeft: `4px solid ${modelHealth.color}` }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <HealthIcon sx={{ fontSize: 40, color: modelHealth.color }} />
            <Box flex={1}>
              <Typography variant="h6" fontWeight={600}>
                {modelHealth.status}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {modelHealth.message}
              </Typography>
            </Box>
            <Chip 
              label={activeModel.model_version}
              sx={{ 
                bgcolor: pwcColors.backgroundLight,
                fontWeight: 600,
                fontSize: '0.9rem'
              }}
            />
          </Stack>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={3}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Algorithm
                </Typography>
                <Typography variant="h6" fontWeight={600}>
                  {activeModel.algorithm.toUpperCase()}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Recall (Mule Detection)
                </Typography>
                <Typography variant="h6" fontWeight={600} color={activeModel.recall >= 0.90 ? '#4caf50' : '#ff9800'}>
                  {(activeModel.recall * 100).toFixed(1)}%
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Precision
                </Typography>
                <Typography variant="h6" fontWeight={600}>
                  {(activeModel.precision * 100).toFixed(1)}%
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  AUC
                </Typography>
                <Typography variant="h6" fontWeight={600}>
                  {(activeModel.auc * 100).toFixed(1)}%
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Model Info */}
      <Card elevation={0}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Model Information
          </Typography>
          
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Trained At
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {new Date(activeModel.trained_at).toLocaleString()}
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Training Samples
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {activeModel.training_samples?.toLocaleString()}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Grid container spacing={2} mt={2}>
        <Grid item xs={12} md={4}>
          <Card 
            elevation={0} 
            sx={{ 
              cursor: 'pointer', 
              '&:hover': { boxShadow: 2 },
              transition: 'box-shadow 0.3s'
            }}
            onClick={() => navigateTo?.('ml-decision')}
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Science sx={{ fontSize: 32, color: pwcColors.primary }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Feature Importance
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    View what drives predictions
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card 
            elevation={0} 
            sx={{ 
              cursor: 'pointer', 
              '&:hover': { boxShadow: 2 },
              transition: 'box-shadow 0.3s'
            }}
            onClick={() => navigateTo?.('ml-decision')}
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Speed sx={{ fontSize: 32, color: pwcColors.primary }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Decision Engine
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Configure ML + Pattern fusion
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card 
            elevation={0} 
            sx={{ 
              cursor: 'pointer', 
              '&:hover': { boxShadow: 2 },
              transition: 'box-shadow 0.3s'
            }}
            onClick={() => navigateTo?.('ml-monitor')}
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <TrendingUp sx={{ fontSize: 32, color: pwcColors.primary }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Live Monitoring
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Track model performance
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* AML Context */}
      <Alert severity="info" sx={{ mt: 3 }} icon={<Psychology />}>
        <Typography variant="body2">
          <strong>Hybrid Approach Best Practice:</strong> This ML model complements pattern detection, 
          not replaces it. The Decision Engine ensures patterns can override ML when high-severity 
          rules are triggered, maintaining explainability for regulatory compliance.
        </Typography>
      </Alert>
    </Box>
  );
};

export default MLOverviewScreen;
