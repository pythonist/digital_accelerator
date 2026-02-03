// frontend/src/tools/mule_detection/screens/MuleAccountScreen.jsx (ENHANCED WITH ML)
import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Chip,
  Stack, Divider, CircularProgress, Alert, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  LinearProgress, Tooltip
} from '@mui/material';
import {
  ArrowBack, AccountBalance, TrendingUp, TrendingDown,
  SwapHoriz, Psychology, Rule, Speed, CheckCircle, Warning
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';

const MuleAccountScreen = ({ accountId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [accountData, setAccountData] = useState(null);
  const [mlPrediction, setMLPrediction] = useState(null);
  const [hasMLModel, setHasMLModel] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    loadAccountData();
  }, [accountId]);

  const loadAccountData = async () => {
    setLoading(true);
    try {
      // Load account details
      const accountResponse = await muleApi.getAccountDetail(accountId);
      setAccountData(accountResponse);

      // Try to load ML prediction
      try {
        const mlResponse = await muleApi.getMLPrediction(accountId);
        if (mlResponse.success) {
          setMLPrediction(mlResponse);
          setHasMLModel(true);
        } else {
          setMLPrediction(null);
          setHasMLModel(false);
        }
      } catch (error) {
        console.log('No ML model available');
        setMLPrediction(null);
        setHasMLModel(false);
      }
    } catch (error) {
      console.error('Failed to load account data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (level) => {
    switch (level?.toUpperCase()) {
      case 'CRITICAL': return '#b91c1c';
      case 'HIGH': return '#d32f2f';
      case 'MEDIUM': return '#ff9800';
      case 'LOW': return '#4caf50';
      default: return '#9e9e9e';
    }
  };

  const loadGraph = async () => {
    setGraphLoading(true);
    try {
      const res = await muleApi.getAccountGraph(accountId, { window_hours: 48, max_hops: 4, amount_tolerance: 0.12 });
      if (res.success) setGraphData(res);
    } catch (e) {
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 3 && !graphData && !graphLoading) {
      loadGraph();
    }
  }, [activeTab, accountId]);

  useEffect(() => {
    if (!graphData?.graph?.nodes?.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const nodes = graphData.graph.nodes;
    const edges = graphData.graph.edges || [];
    const centerId = accountId;

    const center = { x: width / 2, y: height / 2 };
    const others = nodes.filter(n => n.id !== centerId);
    const radius = Math.min(width, height) * 0.35;
    const positions = {};
    positions[centerId] = center;
    others.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(others.length, 1);
      positions[n.id] = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      };
    });

    const maxAmt = edges.reduce((m, e) => Math.max(m, e.total_amount || 0), 0) || 1;

    edges.forEach(e => {
      const p1 = positions[e.source];
      const p2 = positions[e.target];
      if (!p1 || !p2) return;
      const w = 1 + 4 * ((e.total_amount || 0) / maxAmt);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    nodes.forEach(n => {
      const p = positions[n.id];
      if (!p) return;
      const isCenter = n.id === centerId;
      ctx.fillStyle = isCenter ? pwcColors.primary : '#64748b';
      ctx.beginPath();
      ctx.arc(p.x, p.y, isCenter ? 10 : 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = isCenter ? '600 12px system-ui' : '500 10px system-ui';
      ctx.fillText(n.label, p.x + 12, p.y + 4);
    });
  }, [graphData, accountId]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress sx={{ color: pwcColors.primary }} />
      </Box>
    );
  }

  if (!accountData) {
    return (
      <Alert severity="error">Failed to load account data</Alert>
    );
  }

  const { features, patterns, risk, metadata } = accountData;
  const finalRiskScore = mlPrediction ? mlPrediction.hybrid_risk_score : risk.risk_score;
  const finalRiskLevel = mlPrediction ? mlPrediction.final_risk_level : risk.risk_level;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Button
          variant="outlined"
          startIcon={<ArrowBack />}
          onClick={onBack}
          sx={{ borderColor: pwcColors.primary, color: pwcColors.primary }}
        >
          Back
        </Button>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ color: pwcColors.textMain, fontWeight: 600 }}>
            Account Analysis: {accountId}
          </Typography>
        </Box>
        <Chip
          label={finalRiskLevel}
          sx={{
            bgcolor: getRiskColor(finalRiskLevel),
            color: 'white',
            fontWeight: 600,
            fontSize: '0.9rem',
            px: 2
          }}
        />
      </Stack>

      {/* Risk Score Overview */}
      <Grid container spacing={3} mb={3}>
        {/* Hybrid Risk Score (if ML available) */}
        {hasMLModel && mlPrediction && (
          <Grid item xs={12}>
            <Card elevation={0} sx={{ bgcolor: '#f5f5f5' }}>
              <CardContent>
                <Stack direction="row" spacing={3} alignItems="center">
                  <Psychology sx={{ fontSize: 48, color: pwcColors.primary }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="overline" color="text.secondary">
                      Hybrid Risk Score (ML + Patterns)
                    </Typography>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography variant="h3" fontWeight={700} color={getRiskColor(finalRiskLevel)}>
                        {finalRiskScore.toFixed(0)}
                      </Typography>
                      <Typography variant="h6" color="text.secondary">
                        / 100
                      </Typography>
                    </Stack>
                    <LinearProgress 
                      variant="determinate" 
                      value={finalRiskScore} 
                      sx={{ 
                        mt: 1, 
                        height: 8, 
                        borderRadius: 1,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: getRiskColor(finalRiskLevel)
                        }
                      }}
                    />
                  </Box>

                  {/* Agreement Indicator */}
                  <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                    {mlPrediction.agreement ? (
                      <>
                        <CheckCircle sx={{ fontSize: 36, color: '#4caf50' }} />
                        <Typography variant="caption" color="text.secondary" display="block">
                          ML & Patterns Agree
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Warning sx={{ fontSize: 36, color: '#ff9800' }} />
                        <Typography variant="caption" color="text.secondary" display="block">
                          Signals Diverge
                        </Typography>
                      </>
                    )}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* ML vs Pattern Breakdown */}
        {hasMLModel && mlPrediction && (
          <Grid item xs={12} md={6}>
            <Card elevation={0}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <Psychology sx={{ color: pwcColors.primary }} />
                  <Typography variant="subtitle1" fontWeight={600}>
                    ML Prediction
                  </Typography>
                </Stack>
                
                <Box sx={{ mb: 2 }}>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="body2" color="text.secondary">
                      Risk Score
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {mlPrediction.ml_prediction.mule_risk_score.toFixed(1)}
                    </Typography>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={mlPrediction.ml_prediction.mule_risk_score} 
                    sx={{ height: 6, borderRadius: 1 }}
                  />
                </Box>

                <Divider sx={{ my: 2 }} />

                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                      Confidence
                    </Typography>
                    <Typography variant="caption" fontWeight={600}>
                      {mlPrediction.ml_prediction.confidence.toFixed(1)}%
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                      Primary Signal
                    </Typography>
                    <Chip 
                      label={mlPrediction.explanation.primary_signal} 
                      size="small"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Pattern Detection */}
        <Grid item xs={12} md={hasMLModel ? 6 : 12}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <Rule sx={{ color: '#2196f3' }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Pattern Detection
                </Typography>
              </Stack>
              
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" color="text.secondary">
                    Risk Score
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {risk.risk_score}
                  </Typography>
                </Stack>
                <LinearProgress 
                  variant="determinate" 
                  value={risk.risk_score} 
                  sx={{ height: 6, borderRadius: 1, bgcolor: '#e0e0e0' }}
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <Stack spacing={1}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" color="text.secondary">
                    Patterns Detected
                  </Typography>
                  <Typography variant="caption" fontWeight={600}>
                    {patterns.length}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" color="text.secondary">
                    High Severity
                  </Typography>
                  <Typography variant="caption" fontWeight={600} color="error">
                    {patterns.filter(p => p.severity === 'HIGH').length}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
          <Tab label="Features" />
          <Tab label="Patterns" />
          <Tab label="ML Explanation" disabled={!hasMLModel} />
          <Tab label="Money Flow" />
        </Tabs>
      </Box>

      {/* Tab Content */}
      {activeTab === 0 && (
        <Card elevation={0}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Behavioral Features
            </Typography>
            <Grid container spacing={2} mt={1}>
              {/* Flow Features */}
              <Grid item xs={12} md={6}>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Pass-Through Ratio
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {(features.pass_through_ratio * 100).toFixed(1)}%
                    </Typography>
                    <LinearProgress 
                      variant="determinate" 
                      value={features.pass_through_ratio * 100} 
                      sx={{ mt: 1, height: 4, borderRadius: 1 }}
                    />
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Holding Time (hours)
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {features.holding_time_avg.toFixed(1)}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Total Credit
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {formatCurrency(features.total_credit)}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>

              {/* Network Features */}
              <Grid item xs={12} md={6}>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Unique Senders
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {features.unique_senders}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Unique Receivers
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {features.unique_receivers}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Channel Entropy
                    </Typography>
                    <Typography variant="h6" fontWeight={600}>
                      {features.channel_entropy.toFixed(2)}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {activeTab === 1 && (
        <Card elevation={0}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Detected Patterns
            </Typography>
            {patterns.length === 0 ? (
              <Alert severity="success" sx={{ mt: 2 }}>
                No suspicious patterns detected
              </Alert>
            ) : (
              <Stack spacing={2} mt={2}>
                {patterns.map((pattern, idx) => (
                  <Card key={idx} elevation={0} sx={{ bgcolor: '#f5f5f5' }}>
                    <CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Box sx={{ flex: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                            <Typography variant="subtitle2" fontWeight={600}>
                              {pattern.pattern_name}
                            </Typography>
                            <Chip 
                              label={pattern.severity}
                              size="small"
                              sx={{
                                bgcolor: pattern.severity === 'HIGH' ? '#d32f2f' : '#ff9800',
                                color: 'white',
                                fontSize: '0.7rem',
                                height: 20
                              }}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {pattern.evidence}
                          </Typography>
                        </Box>
                        <Typography variant="h6" fontWeight={700} color={pwcColors.primary}>
                          {pattern.score.toFixed(1)}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 2 && hasMLModel && mlPrediction && (
        <Card elevation={0}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              ML Model Explanation
            </Typography>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block" mb={2}>
              Top features contributing to ML prediction (SHAP values)
            </Typography>

            <Stack spacing={2}>
              {mlPrediction.ml_prediction.top_features.slice(0, 5).map((feat, idx) => {
                const contribution = Math.abs(feat.shap_value);
                const maxContribution = Math.max(
                  ...mlPrediction.ml_prediction.top_features.map(f => Math.abs(f.shap_value))
                );
                const percentage = (contribution / maxContribution) * 100;

                return (
                  <Box key={idx}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                      <Typography variant="body2" fontWeight={600}>
                        {feat.feature.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </Typography>
                      <Tooltip title={`SHAP value: ${feat.shap_value.toFixed(3)}`}>
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            color: feat.shap_value > 0 ? '#d32f2f' : '#4caf50',
                            fontWeight: 600
                          }}
                        >
                          {feat.shap_value > 0 ? '↑' : '↓'} {contribution.toFixed(3)}
                        </Typography>
                      </Tooltip>
                    </Stack>
                    <LinearProgress 
                      variant="determinate" 
                      value={percentage} 
                      sx={{ 
                        height: 8, 
                        borderRadius: 1,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: feat.shap_value > 0 ? '#d32f2f' : '#4caf50'
                        }
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      Value: {feat.value.toFixed(2)}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>

            <Alert severity="info" sx={{ mt: 3 }} icon={<Psychology />}>
              <Typography variant="caption">
                <strong>How to Read:</strong> Positive SHAP values (↑ red) increase mule risk. 
                Negative values (↓ green) decrease risk. Larger bars = stronger influence.
              </Typography>
            </Alert>
          </CardContent>
        </Card>
      )}

      {activeTab === 3 && (
        <Card elevation={0}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="subtitle1" fontWeight={600}>
                Money Flow Graph
              </Typography>
              <Button variant="outlined" onClick={loadGraph} disabled={graphLoading}>
                Refresh
              </Button>
            </Stack>

            {graphLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress sx={{ color: pwcColors.primary }} />
              </Box>
            )}

            {!graphLoading && !graphData && (
              <Alert severity="warning">Graph data not available</Alert>
            )}

            {!graphLoading && graphData && (
              <Stack spacing={3}>
                <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1, p: 1 }}>
                  <canvas ref={canvasRef} width={900} height={320} style={{ width: '100%', height: 320 }} />
                </Box>

                <Box>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Circular Indicators
                  </Typography>
                  {(graphData.circular?.cycles?.length > 0 || graphData.circular?.near_cycles?.length > 0) ? (
                    <Stack spacing={1}>
                      {(graphData.circular?.cycles?.length > 0 ? graphData.circular.cycles : graphData.circular.near_cycles).slice(0, 3).map((c, idx) => (
                        <Alert
                          key={idx}
                          severity={graphData.circular?.cycles?.length > 0 ? 'error' : 'warning'}
                        >
                          <Typography variant="body2" fontWeight={600}>
                            {(c.path || []).join(' → ')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Amount: {formatCurrency(c.amount || 0)} · Hops: {c.hops} · Window: {graphData.circular?.parameters?.window_hours}h
                          </Typography>
                          {!!c.reason && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {c.reason}
                            </Typography>
                          )}
                        </Alert>
                      ))}
                    </Stack>
                  ) : (
                    <Alert severity="info">
                      No circular or near-circular flow detected in current window.
                    </Alert>
                  )}
                </Box>

                <Box>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Top Money Flows (Neighborhood)
                  </Typography>
                  <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>From</TableCell>
                          <TableCell>To</TableCell>
                          <TableCell align="right">Txn Count</TableCell>
                          <TableCell align="right">Total Amount (INR)</TableCell>
                          <TableCell>Last Seen</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(graphData.graph?.edges || []).slice(0, 12).map((e, idx) => (
                          <TableRow key={idx} hover>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{e.source}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{e.target}</TableCell>
                            <TableCell align="right">{e.txn_count}</TableCell>
                            <TableCell align="right">{formatCurrency(e.total_amount || 0)}</TableCell>
                            <TableCell>{String(e.last_ts || '').slice(0, 19)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Stack>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default MuleAccountScreen;
