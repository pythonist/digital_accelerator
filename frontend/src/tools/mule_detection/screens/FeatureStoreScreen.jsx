import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Stack,
  TextField,
  Button,
  Typography,
  Grid,
  Chip,
  Divider
} from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import muleApi from '../services/muleApi';

const categorize = (name) => {
  const n = String(name || '').toLowerCase();
  if (n.includes('kyc') || n.includes('age') || n.includes('occupation') || n.includes('income')) return 'KYC';
  if (n.includes('device') || n.includes('ip') || n.includes('vpn')) return 'Device';
  if (n.includes('centrality') || n.includes('pagerank') || n.includes('community') || n.includes('clustering') || n.includes('degree')) return 'Network';
  if (n.includes('cycle') || n.includes('circular') || n.includes('round_trip') || n.includes('loop')) return 'Circularity';
  return 'Behavior';
};

const describe = (name) => {
  const n = String(name || '');
  const l = n.toLowerCase();
  if (l.includes('ratio')) return { desc: 'Ratio feature capturing proportional behavior.', formula: 'Derived ratio between two aggregates.', why: 'Mules often show extreme ratios (rapid pass-through or retention).' };
  if (l.includes('count_24h') || l.includes('tx_count_24h') || l.includes('txn_count_24h'))
    return { desc: 'Transaction count over a recent 24h window.', formula: 'count(transactions in last 24h)', why: 'High velocity is a classic mule signal.' };
  if (l.includes('in_out') || l.includes('pass_through'))
    return { desc: 'Inbound vs outbound flow balance.', formula: 'outbound / inbound', why: 'Mules often pass funds through quickly with low retention.' };
  if (l.includes('accounts_per_device'))
    return { desc: 'Accounts sharing the same device.', formula: 'distinct(accounts) per device_id', why: 'Shared devices often indicate coordinated mule rings.' };
  if (l.includes('centrality') || l.includes('pagerank'))
    return { desc: 'Graph centrality measure for network position.', formula: 'graph centrality', why: 'Hubs/bridges can coordinate or intermediate mule flows.' };
  return { desc: 'Engineered behavioral feature.', formula: 'engineered from transactions/accounts', why: 'Helps model and rules detect mule-like patterns.' };
};

const FeatureStoreScreen = () => {
  const [loading, setLoading] = useState(false);
  const [features, setFeatures] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [dist, setDist] = useState(null);
  const [loadingDist, setLoadingDist] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.listFeatures();
      setFeatures(res.features || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load features');
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features;
    return features.filter((f) => String(f.name).toLowerCase().includes(q) || String(f.type).toLowerCase().includes(q));
  }, [features, query]);

  useEffect(() => {
    if (selectedFeature) return;
    if (filtered.length) setSelectedFeature(filtered[0].name);
  }, [filtered, selectedFeature]);

  const grouped = useMemo(() => {
    const out = { KYC: [], Behavior: [], Network: [], Device: [], Circularity: [] };
    for (const f of filtered) {
      const c = categorize(f.name);
      (out[c] || (out[c] = [])).push(f);
    }
    return out;
  }, [filtered]);

  const loadDist = async (name) => {
    if (!name) return;
    setLoadingDist(true);
    setDist(null);
    try {
      const res = await muleApi.getFeatureDistribution(name, 20);
      setDist(res);
    } catch {
      setDist(null);
    } finally {
      setLoadingDist(false);
    }
  };

  useEffect(() => {
    loadDist(selectedFeature);
  }, [selectedFeature]);

  const chartData = useMemo(() => {
    if (!dist) return [];
    if (dist?.mode === 'categorical') {
      const cats = dist?.categories || [];
      return cats.map((c) => ({ label: String(c.value), count: c.count }));
    }
    const bins = dist?.bins || [];
    return bins.map((b) => ({ label: `${Number(b.start).toFixed(2)}-${Number(b.end).toFixed(2)}`, count: b.count }));
  }, [dist]);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card elevation={0}>
            <CardHeader
              title="Feature Store"
              subheader="Search and preview engineered features"
              action={<Button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>}
            />
            <CardContent>
              <Stack spacing={2}>
                <TextField size="small" label="Search" value={query} onChange={(e) => setQuery(e.target.value)} fullWidth />
                {filtered.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No features found. Run Feature Engineering first.
                  </Typography>
                ) : (
                  <Stack spacing={2}>
                    {Object.entries(grouped).map(([cat, list]) => (
                      <Box key={cat}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                          <Typography variant="subtitle2" fontWeight={900}>{cat}</Typography>
                          <Chip size="small" label={`${list.length}`} />
                        </Stack>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {list.slice(0, 30).map((f) => (
                            <Chip
                              key={f.name}
                              label={f.name}
                              onClick={() => setSelectedFeature(f.name)}
                              variant={selectedFeature === f.name ? 'filled' : 'outlined'}
                              sx={{ cursor: 'pointer' }}
                            />
                          ))}
                        </Stack>
                        <Divider sx={{ mt: 2 }} />
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardHeader title="Feature Preview" subheader={selectedFeature || 'Select a feature'} />
            <CardContent>
              {!selectedFeature ? (
                <Typography variant="body2" color="text.secondary">
                  Select a feature to view description, formula, and distribution.
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Stack spacing={1}>
                      <Chip label={`Category: ${categorize(selectedFeature)}`} />
                      <Typography variant="subtitle2" fontWeight={900}>Description</Typography>
                      <Typography variant="body2" color="text.secondary">{describe(selectedFeature).desc}</Typography>
                      <Typography variant="subtitle2" fontWeight={900}>Formula</Typography>
                      <Typography variant="body2" color="text.secondary">{describe(selectedFeature).formula}</Typography>
                      <Typography variant="subtitle2" fontWeight={900}>Why Important</Typography>
                      <Typography variant="body2" color="text.secondary">{describe(selectedFeature).why}</Typography>
                      {dist?.success ? (
                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                          <Chip label={`Count: ${dist.stats?.count ?? 0}`} />
                          <Chip label={`Nulls: ${dist.stats?.nulls ?? 0}`} />
                          {dist.mode === 'categorical' ? <Chip label={`Unique: ${dist.stats?.unique ?? 0}`} /> : null}
                        </Stack>
                      ) : null}
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Box sx={{ height: 300 }}>
                      {loadingDist ? (
                        <Typography variant="body2" color="text.secondary">Loading distribution…</Typography>
                      ) : chartData.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No distribution available.</Typography>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" hide />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="count" fill="#0284c7" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </Box>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeatureStoreScreen;
