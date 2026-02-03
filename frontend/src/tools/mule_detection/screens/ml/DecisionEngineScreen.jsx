// frontend/src/tools/mule_detection/screens/ml/DecisionEngineScreen.jsx
/**
 * Decision Engine Configuration Screen
 * 
 * Audience: Ops / Compliance / Risk Managers
 * Purpose: Configure and simulate ML + Pattern fusion logic
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Alert,
  Slider, Stack, Divider, TextField, Switch, FormControlLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip
} from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';

import {
  Speed, TuneOutlined, Psychology, Rule, Warning,
  PlayArrow, Save, Refresh
} from '@mui/icons-material';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';

const DecisionEngineScreen = () => {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({
    ml_weight: 0.6,
    pattern_weight: 0.4,
    confidence_threshold: 0.5,
    high_threshold: 65,
    medium_threshold: 35
  });
  
  const [originalConfig, setOriginalConfig] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Simulation state
  const [simulating, setSimulating] = useState(false);
  const [testScenarios, setTestScenarios] = useState([
    {
      id: 1,
      name: "ML + Patterns Agree (High Risk)",
      ml_score: 85,
      ml_confidence: 90,
      pattern_score: 80,
      patterns: [
        { severity: 'HIGH', pattern_name: 'High Pass-Through' },
        { severity: 'MEDIUM', pattern_name: 'Rapid Velocity' }
      ]
    },
    {
      id: 2,
      name: "ML High, Patterns Low",
      ml_score: 75,
      ml_confidence: 85,
      pattern_score: 30,
      patterns: []
    },
    {
      id: 3,
      name: "Pattern Override (2 HIGH)",
      ml_score: 45,
      ml_confidence: 60,
      pattern_score: 70,
      patterns: [
        { severity: 'HIGH', pattern_name: 'High Pass-Through' },
        { severity: 'HIGH', pattern_name: 'Channel Switching' }
      ]
    },
    {
      id: 4,
      name: "Low ML Confidence",
      ml_score: 80,
      ml_confidence: 35,
      pattern_score: 55,
      patterns: [
        { severity: 'MEDIUM', pattern_name: 'Dormancy Pattern' }
      ]
    }
  ]);
  
  const [simulationResults, setSimulationResults] = useState([]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (originalConfig) {
      const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
      setHasChanges(changed);
    }
  }, [config, originalConfig]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await muleApi.getDecisionEngineConfig();
      if (response.success) {
        setConfig(response.config);
        setOriginalConfig(response.config);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const response = await muleApi.updateDecisionEngineConfig(config);
      if (response.success) {
        setOriginalConfig(config);
        setHasChanges(false);
        alert('Configuration saved successfully');
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration');
    }
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const results = [];
      
      for (const scenario of testScenarios) {
        const response = await muleApi.simulateDecisionEngine({
          config: config,
          ml_score: scenario.ml_score,
          ml_confidence: scenario.ml_confidence,
          pattern_score: scenario.pattern_score,
          patterns: scenario.patterns
        });
        
        if (response.success) {
          results.push({
            scenario: scenario.name,
            ...response.decision
          });
        }
      }
      
      setSimulationResults(results);
    } catch (error) {
      console.error('Simulation failed:', error);
    } finally {
      setSimulating(false);
    }
  };

  const handleReset = () => {
    setConfig(originalConfig);
  };

  const getRiskColor = (level) => {
    switch (level) {
      case 'HIGH': return '#f44336';
      case 'MEDIUM': return '#ff9800';
      default: return '#4caf50';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  // Validate weights sum to 1.0
  const weightsValid = Math.abs((config.ml_weight + config.pattern_weight) - 1.0) < 0.001;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            Decision Engine Configuration
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure how ML and Pattern detection are combined
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={2}>
          {hasChanges && (
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={handleReset}
            >
              Reset
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSaveConfig}
            disabled={!hasChanges || !weightsValid}
            sx={{ bgcolor: pwcColors.primary }}
          >
            Save Configuration
          </Button>
        </Stack>
      </Stack>

      {/* Warning Banner */}
      <Alert severity="warning" sx={{ mb: 3 }} icon={<Warning />}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          Production Impact Warning
        </Typography>
        <Typography variant="caption">
          Changes to these settings affect all mule risk predictions immediately after saving. 
          Always test with simulation before deploying to production.
        </Typography>
      </Alert>

      <Grid container spacing={3}>
        {/* Score Fusion Configuration */}
        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <Speed sx={{ color: pwcColors.primary }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Score Fusion Weights
                </Typography>
              </Stack>

              {!weightsValid && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  Weights must sum to 1.0
                </Alert>
              )}

              <Stack spacing={3}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Psychology sx={{ fontSize: 20, color: pwcColors.primary }} />
                      <Typography variant="body2">ML Weight</Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={600}>
                      {(config.ml_weight * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.ml_weight}
                    onChange={(e, val) => setConfig(prev => ({
                      ...prev,
                      ml_weight: val,
                      pattern_weight: 1 - val
                    }))}
                    min={0}
                    max={1}
                    step={0.05}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Rule sx={{ fontSize: 20, color: '#2196f3' }} />
                      <Typography variant="body2">Pattern Weight</Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={600}>
                      {(config.pattern_weight * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.pattern_weight}
                    disabled
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                </Box>
              </Stack>

              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="caption">
                  <strong>AML Best Practice:</strong> 60/40 split (ML/Pattern) balances 
                  learned behavior with explainable rules.
                </Typography>
              </Alert>
            </CardContent>
          </Card>
        </Grid>

        {/* Thresholds Configuration */}
        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <TuneOutlined sx={{ color: pwcColors.primary }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Risk Thresholds
                </Typography>
              </Stack>

              <Stack spacing={3}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="body2">ML Confidence Threshold</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {(config.confidence_threshold * 100).toFixed(0)}%
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.confidence_threshold}
                    onChange={(e, val) => setConfig(prev => ({ ...prev, confidence_threshold: val }))}
                    min={0.3}
                    max={0.8}
                    step={0.05}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(val) => `${(val * 100).toFixed(0)}%`}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Below this confidence, patterns are weighted higher
                  </Typography>
                </Box>

                <Divider />

                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="body2">HIGH Risk Threshold</Typography>
                    <Typography variant="body2" fontWeight={600} color="#f44336">
                      {config.high_threshold}
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.high_threshold}
                    onChange={(e, val) => setConfig(prev => ({ ...prev, high_threshold: val }))}
                    min={60}
                    max={80}
                    step={5}
                    marks
                    valueLabelDisplay="auto"
                  />
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="body2">MEDIUM Risk Threshold</Typography>
                    <Typography variant="body2" fontWeight={600} color="#ff9800">
                      {config.medium_threshold}
                    </Typography>
                  </Stack>
                  <Slider
                    value={config.medium_threshold}
                    onChange={(e, val) => setConfig(prev => ({ ...prev, medium_threshold: val }))}
                    min={25}
                    max={50}
                    step={5}
                    marks
                    valueLabelDisplay="auto"
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Decision Logic Rules */}
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Decision Logic Rules
              </Typography>
              
              <Grid container spacing={2} mt={1}>
                <Grid item xs={12} md={4}>
                  <Box sx={{ p: 2, bgcolor: '#fff3e0', borderRadius: 1, borderLeft: '4px solid #ff9800' }}>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      Rule 1: Pattern Override
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      IF 2+ HIGH-severity patterns detected:<br />
                      → Force risk ≥ 75 (HIGH)<br />
                      → Ignore ML score<br />
                      → Reason: "PATTERN OVERRIDE"
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={{ p: 2, bgcolor: '#e3f2fd', borderRadius: 1, borderLeft: '4px solid #2196f3' }}>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      Rule 2: Low ML Confidence
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      IF ML confidence &lt; {(config.confidence_threshold * 100).toFixed(0)}%:<br />
                      → Pattern weight = 70%<br />
                      → ML weight = 30%<br />
                      → Reason: "LOW ML CONFIDENCE"
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={{ p: 2, bgcolor: '#f3e5f5', borderRadius: 1, borderLeft: '4px solid #9c27b0' }}>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      Rule 3: Hybrid Fusion
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      ELSE:<br />
                      → ML: {(config.ml_weight * 100).toFixed(0)}%, Pattern: {(config.pattern_weight * 100).toFixed(0)}%<br />
                      → Boost if ML & patterns agree<br />
                      → Reason: "HYBRID FUSION"
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Simulation */}
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Test Scenarios
                </Typography>
                <Button
                  variant="contained"
                  startIcon={simulating ? <CircularProgress size={20} color="inherit" /> : <PlayArrow />}
                  onClick={handleSimulate}
                  disabled={simulating}
                  sx={{ bgcolor: pwcColors.primary }}
                >
                  Run Simulation
                </Button>
              </Stack>

              <Typography variant="caption" color="text.secondary" gutterBottom display="block" mb={2}>
                Test your configuration against common scenarios before deploying
              </Typography>

              {simulationResults.length > 0 && (
                <TableContainer component={Paper} sx={{ mt: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                        <TableCell><strong>Scenario</strong></TableCell>
                        <TableCell><strong>ML Score</strong></TableCell>
                        <TableCell><strong>Pattern Score</strong></TableCell>
                        <TableCell><strong>Final Score</strong></TableCell>
                        <TableCell><strong>Risk Level</strong></TableCell>
                        <TableCell><strong>Decision Logic</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {simulationResults.map((result, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{result.scenario}</TableCell>
                          <TableCell>{result.ml_contribution?.toFixed(0)}</TableCell>
                          <TableCell>{result.pattern_contribution?.toFixed(0)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {result.final_risk_score?.toFixed(0)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={result.final_risk_level}
                              size="small"
                              sx={{ 
                                bgcolor: getRiskColor(result.final_risk_level),
                                color: 'white',
                                fontWeight: 600
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {result.decision_logic}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* AML Compliance Note */}
      <Alert severity="info" sx={{ mt: 3 }} icon={<Psychology />}>
        <Typography variant="body2">
          <strong>Why Decision Engine Matters for AML:</strong>
        </Typography>
        <Typography variant="caption" display="block" mt={1}>
          Regulators require explainable decisions. Pure ML is a black box. Pure patterns miss evolving tactics.
          The Decision Engine gives you:<br />
          • Transparent logic auditors can review<br />
          • Pattern overrides when rules trigger<br />
          • ML learning when patterns don't capture new behavior<br />
          • Configurable weights for your risk appetite
        </Typography>
      </Alert>
    </Box>
  );
};

export default DecisionEngineScreen;