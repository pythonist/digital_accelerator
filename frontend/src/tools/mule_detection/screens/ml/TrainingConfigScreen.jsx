// frontend/src/tools/mule_detection/screens/ml/TrainingConfigScreen.jsx
/**
 * Training Configuration Screen
 * 
 * Audience: Power users / Data scientists
 * Purpose: Configure and start model training
 */

import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Alert,
  TextField, Slider, FormControl, InputLabel, Select, MenuItem,
  Stack, Divider, Chip, Switch, FormControlLabel
} from '@mui/material';
import {
  PlayArrow, Info, TuneOutlined, DataUsage
} from '@mui/icons-material';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';

const TrainingConfigScreen = ({ navigateTo, onTrainingStarted }) => {
  const [training, setTraining] = useState(false);
  
  // Configuration state
  const [config, setConfig] = useState({
    algorithm: 'lightgbm',
    
    // Data split
    trainSplit: 0.7,
    valSplit: 0.2,
    testSplit: 0.1,
    
    // Optimization target
    objective: 'recall',
    recallTarget: 0.90,
    
    // Hyperparameters
    maxDepth: 6,
    numLeaves: 31,
    learningRate: 0.05,
    nEstimators: 300,
    scalePosWeight: 8,
    
    // Advanced
    useEarlyStopping: true,
    cvFolds: 5,
    randomSeed: 42
  });

  const handleSliderChange = (field) => (event, newValue) => {
    if (field === 'trainSplit') {
      const remaining = 1 - newValue;
      setConfig(prev => ({
        ...prev,
        trainSplit: newValue,
        valSplit: remaining * 0.67,
        testSplit: remaining * 0.33
      }));
    } else {
      setConfig(prev => ({ ...prev, [field]: newValue }));
    }
  };

  const handleStartTraining = async () => {
    setTraining(true);
    
    try {
      // Build API config
      const trainingConfig = {
        algorithm: config.algorithm,
        data_split: {
          train: config.trainSplit,
          validation: config.valSplit,
          test: config.testSplit
        },
        hyperparameters: {
          max_depth: config.maxDepth,
          num_leaves: config.numLeaves,
          learning_rate: config.learningRate,
          n_estimators: config.nEstimators,
          scale_pos_weight: config.scalePosWeight
        },
        objective: config.objective,
        recall_target: config.recallTarget,
        random_seed: config.randomSeed
      };
      
      // Start training job
      const response = await muleApi.trainMLModel(trainingConfig);
      
      if (response.success) {
        onTrainingStarted?.(response.job_id);
      }
    } catch (error) {
      console.error('Training failed:', error);
      setTraining(false);
    }
  };

  const totalSplit = config.trainSplit + config.valSplit + config.testSplit;
  const splitValid = Math.abs(totalSplit - 1.0) < 0.001;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            Train ML Model
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure hyperparameters and data splits
          </Typography>
        </Box>
        
        <Button
          variant="text"
          onClick={() => navigateTo?.('ml-overview')}
        >
          ← Back to Overview
        </Button>
      </Stack>

      {/* Prerequisites Check */}
      <Alert severity="info" sx={{ mb: 3 }} icon={<Info />}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          Training Requirements
        </Typography>
        <Typography variant="caption" component="div">
          • accounts.csv must contain <code>is_mule</code> column (1 = mule, 0 = normal)<br />
          • Recommended minimum: 100 labeled examples<br />
          • Class imbalance is handled automatically
        </Typography>
      </Alert>

      <Grid container spacing={3}>
        {/* Algorithm Selection */}
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Algorithm
              </Typography>
              
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>Model Algorithm</InputLabel>
                <Select
                  value={config.algorithm}
                  label="Model Algorithm"
                  onChange={(e) => setConfig(prev => ({ ...prev, algorithm: e.target.value }))}
                >
                  <MenuItem value="lightgbm">
                    <Stack>
                      <Typography variant="body2" fontWeight={600}>LightGBM</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Fast, efficient, handles imbalance well (Recommended)
                      </Typography>
                    </Stack>
                  </MenuItem>
                  <MenuItem value="xgboost" disabled>
                    <Stack>
                      <Typography variant="body2">XGBoost</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Coming soon
                      </Typography>
                    </Stack>
                  </MenuItem>
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        </Grid>

        {/* Data Split */}
        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Data Split
                </Typography>
                {!splitValid && (
                  <Chip 
                    label="Invalid split" 
                    size="small" 
                    color="error"
                  />
                )}
              </Stack>
              
              <Stack spacing={3}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="caption">Training Set</Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {(config.trainSplit * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.trainSplit}
                    onChange={handleSliderChange('trainSplit')}
                    min={0.5}
                    max={0.8}
                    step={0.05}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="caption">Validation Set</Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {(config.valSplit * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.valSplit}
                    disabled
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="caption">Test Set</Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {(config.testSplit * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.testSplit}
                    disabled
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                </Box>
              </Stack>

              <Alert severity="info" sx={{ mt: 2 }} icon={<DataUsage />}>
                <Typography variant="caption">
                  Validation/Test splits auto-adjust to maintain total 100%
                </Typography>
              </Alert>
            </CardContent>
          </Card>
        </Grid>

        {/* Optimization Target */}
        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Optimization Target
              </Typography>
              
              <FormControl fullWidth sx={{ mt: 2, mb: 2 }}>
                <InputLabel>Primary Metric</InputLabel>
                <Select
                  value={config.objective}
                  label="Primary Metric"
                  onChange={(e) => setConfig(prev => ({ ...prev, objective: e.target.value }))}
                >
                  <MenuItem value="recall">
                    <Stack>
                      <Typography variant="body2" fontWeight={600}>Recall (AML Standard)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Maximize mule detection, minimize false negatives
                      </Typography>
                    </Stack>
                  </MenuItem>
                  <MenuItem value="f2">
                    <Stack>
                      <Typography variant="body2">F2 Score</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Balance recall (weighted 2x) with precision
                      </Typography>
                    </Stack>
                  </MenuItem>
                  <MenuItem value="auc">
                    <Stack>
                      <Typography variant="body2">AUC</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Overall discriminative power
                      </Typography>
                    </Stack>
                  </MenuItem>
                </Select>
              </FormControl>

              {config.objective === 'recall' && (
                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="caption">Recall Target</Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {(config.recallTarget * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.recallTarget}
                    onChange={handleSliderChange('recallTarget')}
                    min={0.85}
                    max={0.99}
                    step={0.01}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    <Typography variant="caption">
                      AML regulators typically require 90%+ recall (mule detection rate)
                    </Typography>
                  </Alert>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Hyperparameters */}
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <TuneOutlined />
                <Typography variant="subtitle1" fontWeight={600}>
                  Hyperparameters
                </Typography>
              </Stack>

              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Max Depth"
                    type="number"
                    value={config.maxDepth}
                    onChange={(e) => setConfig(prev => ({ ...prev, maxDepth: parseInt(e.target.value) }))}
                    fullWidth
                    helperText="Tree depth (3-10). Higher = more complex"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Num Leaves"
                    type="number"
                    value={config.numLeaves}
                    onChange={(e) => setConfig(prev => ({ ...prev, numLeaves: parseInt(e.target.value) }))}
                    fullWidth
                    helperText="Number of leaves (10-50)"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Learning Rate"
                    type="number"
                    value={config.learningRate}
                    onChange={(e) => setConfig(prev => ({ ...prev, learningRate: parseFloat(e.target.value) }))}
                    fullWidth
                    inputProps={{ step: 0.01, min: 0.01, max: 0.3 }}
                    helperText="Step size (0.01-0.3). Lower = slower but more stable"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="N Estimators"
                    type="number"
                    value={config.nEstimators}
                    onChange={(e) => setConfig(prev => ({ ...prev, nEstimators: parseInt(e.target.value) }))}
                    fullWidth
                    helperText="Number of trees (100-500)"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Scale Pos Weight"
                    type="number"
                    value={config.scalePosWeight}
                    onChange={(e) => setConfig(prev => ({ ...prev, scalePosWeight: parseFloat(e.target.value) }))}
                    fullWidth
                    helperText="Class imbalance weight (typical: 5-10)"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Random Seed"
                    type="number"
                    value={config.randomSeed}
                    onChange={(e) => setConfig(prev => ({ ...prev, randomSeed: parseInt(e.target.value) }))}
                    fullWidth
                    helperText="For reproducibility"
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={config.useEarlyStopping}
                    onChange={(e) => setConfig(prev => ({ ...prev, useEarlyStopping: e.target.checked }))}
                  />
                }
                label={
                  <Stack>
                    <Typography variant="body2">Early Stopping</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Stop if validation performance degrades
                    </Typography>
                  </Stack>
                }
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Training Action */}
      <Card elevation={0} sx={{ mt: 3, bgcolor: pwcColors.backgroundLight }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                Ready to Train
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Training typically takes 30-90 seconds
              </Typography>
            </Box>
            
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayArrow />}
              onClick={handleStartTraining}
              disabled={training || !splitValid}
              sx={{ 
                bgcolor: pwcColors.primary,
                px: 4,
                '&:hover': { bgcolor: '#c14a0a' }
              }}
            >
              {training ? 'Starting...' : 'Start Training'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default TrainingConfigScreen;
