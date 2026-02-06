import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Stack,
  Typography,
  TextField,
  MenuItem,
  Button,
  Chip,
  Divider,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Skeleton
} from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import {
  Explore as ExploreIcon,
  TrendingUp as TrendingUpIcon,
  Refresh as RefreshIcon,
  ShowChart as ShowChartIcon,
  Analytics as AnalyticsIcon
} from '@mui/icons-material';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';

const FeatureExplorerScreen = () => {
  const { openInvestigation } = useMuleStore();
  const [features, setFeatures] = useState([]);
  const [selected, setSelected] = useState('');
  const [dist, setDist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [topAccounts, setTopAccounts] = useState([]);
  const [corr, setCorr] = useState(null);

  const loadFeatures = async () => {
    setError(null);
    try {
      const res = await muleApi.listFeatures();
      const list = res.features || [];
      setFeatures(list);
      if (!selected && list.length) setSelected(list[0].name);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load features');
    }
  };

  const loadDist = async (featureName) => {
    if (!featureName) return;
    setLoading(true);
    setError(null);
    setDist(null);
    try {
      const res = await muleApi.getFeatureDistribution(featureName, 20);
      setDist(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load distribution');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeatures();
  }, []);

  useEffect(() => {
    loadDist(selected);
  }, [selected]);

  const loadTopAndCorrelation = async (featureName) => {
    if (!featureName) return;
    try {
      const res = await muleApi.getAccountFeatures({ limit: 2000 });
      const rows = res.accounts || [];
      const pairs = [];
      const targets = [];
      for (const r of rows) {
        const x = Number(r?.[featureName]);
        if (!Number.isFinite(x)) continue;
        const y = Number(r?.hybrid_score ?? r?.ml_score ?? r?.risk_score ?? r?.risk_score_label);
        if (Number.isFinite(y)) targets.push([x, y]);
        pairs.push({
          account_id: r.account_id,
          value: x,
          hybrid_score: r.hybrid_score,
          ml_score: r.ml_score,
          risk_level: r.risk_level
        });
      }
      pairs.sort((a, b) => b.value - a.value);
      setTopAccounts(pairs.slice(0, 10));

      if (targets.length < 10) {
        setCorr(null);
        return;
      }
      const xs = targets.map((t) => t[0]);
      const ys = targets.map((t) => t[1]);
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < xs.length; i += 1) {
        const a = xs[i] - mx;
        const b = ys[i] - my;
        num += a * b;
        dx += a * a;
        dy += b * b;
      }
      const den = Math.sqrt(dx * dy);
      setCorr(den > 0 ? num / den : null);
    } catch {
      setTopAccounts([]);
      setCorr(null);
    }
  };

  useEffect(() => {
    loadTopAndCorrelation(selected);
  }, [selected]);

  const chartData = useMemo(() => {
    if (dist?.mode === 'categorical') {
      const cats = dist?.categories || [];
      return cats.map((c) => ({
        label: String(c.value),
        count: c.count
      }));
    }
    const bins = dist?.bins || [];
    return bins.map((b) => ({
      label: `${Number(b.start).toFixed(2)}`,
      count: b.count
    }));
  }, [dist]);

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left Sidebar */}
        <Grid item xs={12} md={4}>
          <Card elevation={2}>
            <CardHeader
              avatar={<ExploreIcon color="primary" sx={{ fontSize: 32 }} />}
              title="Feature Explorer"
              subheader="Analyze feature distributions"
              titleTypographyProps={{ fontWeight: 700 }}
            />
            <Divider />
            <CardContent>
              <Stack spacing={3}>
                <TextField
                  select
                  fullWidth
                  label="Select Feature"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={features.length === 0}
                  variant="outlined"
                >
                  {features.length === 0 ? (
                    <MenuItem value="">No features available</MenuItem>
                  ) : (
                    features.map((f) => (
                      <MenuItem key={f.name} value={f.name}>
                        {f.name}
                      </MenuItem>
                    ))
                  )}
                </TextField>

                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => loadDist(selected)}
                  disabled={loading || !selected}
                  startIcon={<RefreshIcon />}
                >
                  {loading ? 'Loading…' : 'Refresh Distribution'}
                </Button>

                {dist?.success && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                      Statistics
                    </Typography>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption">Count:</Typography>
                        <Chip size="small" label={dist.stats?.count ?? 0} />
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption">Nulls:</Typography>
                        <Chip size="small" label={dist.stats?.nulls ?? 0} />
                      </Stack>
                      {dist.mode === 'categorical' ? (
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption">Unique:</Typography>
                          <Chip size="small" label={dist.stats?.unique ?? 0} />
                        </Stack>
                      ) : (
                        <>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption">Min:</Typography>
                            <Chip size="small" label={Number(dist.stats?.min ?? 0).toFixed(3)} />
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption">Max:</Typography>
                            <Chip size="small" label={Number(dist.stats?.max ?? 0).toFixed(3)} />
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption">Average:</Typography>
                            <Chip size="small" label={Number(dist.stats?.avg ?? 0).toFixed(3)} />
                          </Stack>
                        </>
                      )}
                      <Divider />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption">Risk Correlation:</Typography>
                        <Chip
                          size="small"
                          icon={<TrendingUpIcon />}
                          label={corr == null ? '-' : corr.toFixed(3)}
                          color={corr && Math.abs(corr) > 0.5 ? 'primary' : 'default'}
                        />
                      </Stack>
                    </Stack>
                  </Paper>
                )}

                {features.length === 0 && (
                  <Alert severity="info" icon={<AnalyticsIcon />}>
                    No engineered features found. Run Feature Engineering first.
                  </Alert>
                )}

                <Divider />

                <Box>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Top Accounts by Feature Value
                  </Typography>
                  {topAccounts.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Run Feature Engineering to enable ranking.
                    </Typography>
                  ) : (
                    <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                      {topAccounts.map((a, idx) => (
                        <ListItem key={a.account_id} disablePadding>
                          <ListItemButton onClick={() => openInvestigation(a.account_id)}>
                            <ListItemText
                              primary={
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography variant="body2" fontWeight={600}>
                                    #{idx + 1} {a.account_id}
                                  </Typography>
                                  <Chip
                                    size="small"
                                    label={Number(a.value).toFixed(3)}
                                    color="primary"
                                    variant="outlined"
                                  />
                                </Stack>
                              }
                              secondary={
                                a.risk_level ? `Risk: ${a.risk_level}` : 'No risk data'
                              }
                            />
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Main Chart Area */}
        <Grid item xs={12} md={8}>
          <Card elevation={2} sx={{ height: '100%', minHeight: 600 }}>
            <CardHeader
              avatar={<ShowChartIcon color="secondary" sx={{ fontSize: 32 }} />}
              title="Distribution Chart"
              subheader={selected || 'Select a feature to visualize'}
              titleTypographyProps={{ fontWeight: 700 }}
            />
            <Divider />
            <CardContent sx={{ height: 520 }}>
              {loading ? (
                <Stack spacing={2} sx={{ height: '100%', justifyContent: 'center' }}>
                  <Skeleton variant="rectangular" height={60} />
                  <Skeleton variant="rectangular" height={200} />
                  <Skeleton variant="rectangular" height={60} />
                </Stack>
              ) : chartData.length === 0 ? (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <ShowChartIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">
                    Select a feature to view its distribution
                  </Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  {dist?.mode === 'categorical' ? (
                    <BarChart data={chartData} layout="vertical" margin={{ left: 120, right: 20, top: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="label" width={100} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#667eea" name="Count" />
                    </BarChart>
                  ) : (
                    <BarChart data={chartData} margin={{ left: 20, right: 20, top: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#764ba2" name="Frequency" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeatureExplorerScreen;