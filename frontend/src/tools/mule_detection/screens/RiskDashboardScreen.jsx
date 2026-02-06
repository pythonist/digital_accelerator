import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Typography,
  Stack,
  Chip
} from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import muleApi from '../services/muleApi';
import AccountCard from '../components/AccountCard';
import AccountSelector from '../components/AccountSelector';

const RiskDashboardScreen = ({ onAccountSelect }) => {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [trend, setTrend] = useState([]);
  const [autoRan, setAutoRan] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await muleApi.getRiskSummary();
      if (!s?.has_results) {
        setSummary(null);
        setAccounts([]);
        setTrend([]);
        if (!autoRan) {
          setAutoRan(true);
          try {
            await muleApi.runHybrid({ use_trained_model: true });
            const s2 = await muleApi.getRiskSummary();
            if (!s2?.has_results) return;
            setSummary(s2.summary || null);
            const a2 = await muleApi.getRiskAccounts({ risk_level: 'HIGH', limit: 200 });
            setAccounts(a2.accounts || []);
            const t2 = await muleApi.getRiskTrend({ granularity: 'week', periods: 12 });
            setTrend(t2.trend || []);
          } catch {
            return;
          }
        }
        return;
      }
      setSummary(s.summary || null);
      const a = await muleApi.getRiskAccounts({ risk_level: 'HIGH', limit: 200 });
      setAccounts(a.accounts || []);
      const t = await muleApi.getRiskTrend({ granularity: 'week', periods: 12 });
      setTrend(t.trend || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load risk dashboard');
    } finally {
      setLoading(false);
    }
  };

  const runHybrid = async () => {
    setRunning(true);
    setError(null);
    try {
      await muleApi.runHybrid({ use_trained_model: true });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Hybrid scoring failed');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pieData = summary
    ? [
        { name: 'HIGH', value: Number(summary.high_risk_count || 0) },
        { name: 'MEDIUM', value: Number(summary.medium_risk_count || 0) },
        { name: 'LOW', value: Number(summary.low_risk_count || 0) }
      ]
    : [];
  const pieColors = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e' };

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <AccountSelector dense />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Risk Dashboard"
              subheader="Investigator command center: monitor risk and triage accounts"
              action={
                <Stack direction="row" spacing={1}>
                  <Button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
                  <Button variant="contained" onClick={runHybrid} disabled={running}>
                    {running ? 'Running…' : 'Run Hybrid Scoring'}
                  </Button>
                </Stack>
              }
            />
            <CardContent>
              {!summary ? (
                <Typography variant="body2" color="text.secondary">
                  No risk results found. Run Hybrid Scoring to generate scores.
                </Typography>
              ) : (
                <Stack direction="row" spacing={2} flexWrap="wrap">
                  <Chip label={`Total: ${summary.total_accounts ?? 0}`} />
                  <Chip label={`HIGH: ${summary.high_risk_count ?? 0}`} sx={{ bgcolor: 'rgba(239,68,68,0.12)', color: '#991b1b' }} />
                  <Chip label={`MEDIUM: ${summary.medium_risk_count ?? 0}`} sx={{ bgcolor: 'rgba(245,158,11,0.16)', color: '#9a3412' }} />
                  <Chip label={`LOW: ${summary.low_risk_count ?? 0}`} sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#166534' }} />
                  <Chip label={`Avg: ${Number(summary.average_risk_score ?? 0).toFixed(3)}`} />
                  <Chip label={`Max: ${Number(summary.max_risk_score ?? 0).toFixed(3)}`} />
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardHeader title="Risk Distribution" subheader="Current risk bucket breakdown" />
            <CardContent sx={{ height: 320 }}>
              {pieData.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Run Hybrid Scoring to populate distribution.
                </Typography>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} innerRadius={55} paddingAngle={2}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={pieColors[entry.name] || '#94a3b8'} />
                      ))}
                    </Pie>
                    <ReTooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardHeader title="Weekly Trend" subheader="Risk volume over time" />
            <CardContent sx={{ height: 320 }}>
              {trend.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Run Hybrid Scoring to populate trend.
                </Typography>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tickFormatter={(v) => String(v).slice(0, 10)} />
                    <YAxis />
                    <ReTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="medium" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="low" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Investigation Queue" subheader="Top high-risk accounts (cards)" />
            <CardContent>
              {accounts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No high-risk accounts.
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  {accounts.slice(0, 10).map((a) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={a.account_id}>
                      <AccountCard
                        account={{
                          account_id: a.account_id,
                          hybrid_score: a.hybrid_score,
                          ml_score: a.ml_risk_score,
                          rule_score: a.pattern_risk_score,
                          risk_level: a.risk_level
                        }}
                        onInvestigate={(id) => onAccountSelect && onAccountSelect(id)}
                      />
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default RiskDashboardScreen;
