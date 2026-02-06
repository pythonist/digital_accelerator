import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Stack,
  Typography,
  LinearProgress,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Grid
} from '@mui/material';
import {
  Build as BuildIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassEmpty as HourglassEmptyIcon,
  PlayArrow as PlayArrowIcon,
  Engineering as EngineeringIcon
} from '@mui/icons-material';
import muleApi from '../services/muleApi';

const FeatureEngineeringScreen = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPoll();
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const start = await muleApi.engineerFeatures();
      if (!start?.success) {
        throw new Error(start?.error || 'Failed to start feature engineering');
      }
      const jobId = start.job_id;
      setStatus({ ...start, step: 'queued', message: 'Queued' });
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const s = await muleApi.getFeatureEngineeringStatus(jobId);
          if (s?.success) setStatus(s);
          if (s?.state === 'completed') {
            clearPoll();
            setLoading(false);
          }
          if (s?.state === 'failed') {
            clearPoll();
            setLoading(false);
            setError(s?.error || 'Feature engineering failed');
          }
        } catch (e) {
          clearPoll();
          setLoading(false);
          setError(e?.response?.data?.error || e?.message || 'Failed to fetch status');
        }
      }, 1000);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Feature engineering failed');
      setLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (!status?.state) return <HourglassEmptyIcon />;
    if (status.state === 'completed') return <CheckCircleIcon color="success" />;
    if (status.state === 'failed') return <ErrorIcon color="error" />;
    return <HourglassEmptyIcon color="primary" />;
  };

  const getStatusColor = () => {
    if (!status?.state) return 'default';
    if (status.state === 'completed') return 'success';
    if (status.state === 'failed') return 'error';
    if (status.state === 'running') return 'primary';
    return 'default';
  };

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white'
            }}
          >
            <CardHeader
              avatar={<EngineeringIcon sx={{ fontSize: 48 }} />}
              title={
                <Typography variant="h5" fontWeight={700}>
                  Feature Engineering
                </Typography>
              }
              subheader={
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                  Compute account-level features from uploaded transaction data
                </Typography>
              }
            />
            <CardContent>
              <Stack spacing={3}>
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                  <Button
                    variant="contained"
                    size="large"
                    onClick={run}
                    disabled={loading || status?.state === 'running'}
                    startIcon={<PlayArrowIcon />}
                    sx={{
                      bgcolor: 'rgba(255,255,255,0.2)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' },
                      backdropFilter: 'blur(10px)'
                    }}
                  >
                    {status?.state === 'running' ? 'Running…' : 'Run Feature Engineering'}
                  </Button>
                  {status?.state && (
                    <Chip
                      icon={getStatusIcon()}
                      label={`${status.state.toUpperCase()}${status.step ? ` · ${status.step}` : ''}${status.message ? ` · ${status.message}` : ''}`}
                      color={getStatusColor()}
                      sx={{
                        fontWeight: 600,
                        bgcolor: 'rgba(255,255,255,0.2)',
                        color: 'white'
                      }}
                    />
                  )}
                </Stack>

                {status?.state === 'running' && (
                  <Box>
                    <LinearProgress
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: 'rgba(255,255,255,0.2)',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: 'rgba(255,255,255,0.8)'
                        }
                      }}
                    />
                  </Box>
                )}

                {status?.state === 'completed' && status?.result && (
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3,
                      bgcolor: 'rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(10px)',
                      borderRadius: 2
                    }}
                  >
                    <Stack direction="row" spacing={3} justifyContent="center">
                      <Box textAlign="center">
                        <Typography variant="h3" fontWeight={700}>
                          {status.result.accounts?.toLocaleString()}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                          Accounts Processed
                        </Typography>
                      </Box>
                      <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.3)' }} />
                      <Box textAlign="center">
                        <Typography variant="h3" fontWeight={700}>
                          {status.result.features?.toLocaleString()}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                          Features Generated
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card elevation={2}>
            <CardHeader
              title="What Happens?"
              titleTypographyProps={{ fontWeight: 600, variant: 'h6' }}
            />
            <Divider />
            <CardContent>
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <BuildIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Aggregate Patterns"
                    secondary="Count, sum, avg transactions per account"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <BuildIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Behavioral Features"
                    secondary="Velocity, frequency, and timing patterns"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <BuildIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Network Metrics"
                    secondary="Graph centrality and connectivity"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <BuildIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Risk Indicators"
                    secondary="Circularity, device sharing, anomalies"
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Alert severity="info" icon={<EngineeringIcon />}>
            <Typography variant="body2" fontWeight={600}>
              Feature engineering is the foundation for ML and pattern detection
            </Typography>
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              This process creates 100+ behavioral, network, and risk features that power both rule-based
              detection and machine learning models. Run this step whenever you upload new data.
            </Typography>
          </Alert>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeatureEngineeringScreen;