import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Typography,
  Chip,
  Stack,
  Divider
} from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, Legend } from 'recharts';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';
import AccountCard from '../components/AccountCard';

const HybridScoringScreen = ({ onAccountSelect }) => {
  const { selectedAccountId, openInvestigation } = useMuleStore();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [lastRunAt, setLastRunAt] = useState(null);

  const loadLast = async () => {
    setError(null);
    try {
      const res = await muleApi.getLastRun('hybrid');
      if (res?.has_results) {
        setSummary(res.result?.summary || null);
        setAccounts(res.result?.accounts || []);
        setLastRunAt(res.created_at || null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load last run');
    }
  };

  useEffect(() => {
    loadLast();
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await muleApi.runHybrid({ use_trained_model: true });
      setSummary(res.summary || null);
      setAccounts(res.accounts || []);
      setLastRunAt(res.metadata?.run_meta?.created_at || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Hybrid scoring failed');
    } finally {
      setRunning(false);
    }
  };

  const selected = useMemo(() => {
    if (!selectedAccountId) return null;
    return (accounts || []).find((a) => a.account_id === selectedAccountId) || null;
  }, [accounts, selectedAccountId]);

  const breakdown = useMemo(() => {
    if (!selected) return null;
    let weights = { ml: 0.4, rules: 0.3, flow: 0.3 };
    let components = {
      ml: Number(selected.ml_score || 0),
      rules: Number(selected.rule_score || 0),
      flow: Number((selected.money_flow_score ?? selected.network_risk) || 0)
    };
    try {
      const j = JSON.parse(selected.decision_logic || '{}');
      const w = j.weights || {};
      weights = {
        ml: Number(w.ml_weight ?? weights.ml),
        rules: Number(w.rule_weight ?? weights.rules),
        flow: Number(w.money_flow_weight ?? w.network_weight ?? weights.flow)
      };
      const c = (j.components || {});
      components = {
        ml: Number(c.ml ?? components.ml),
        rules: Number(c.rules ?? components.rules),
        flow: Number(c.money_flow ?? c.network ?? components.flow)
      };
    } catch {
      return null;
    }
    const mlC = Math.max(0, weights.ml * components.ml);
    const ruC = Math.max(0, weights.rules * components.rules);
    const flC = Math.max(0, weights.flow * components.flow);
    const total = mlC + ruC + flC;
    if (total <= 0) return null;
    return {
      data: [
        { name: 'ML', value: mlC },
        { name: 'Rules', value: ruC },
        { name: 'Money Flow', value: flC }
      ],
      weights,
      components,
      total
    };
  }, [selected]);

  const colors = { ML: '#0284c7', Rules: '#7c3aed', 'Money Flow': '#16a34a' };

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Hybrid Scoring"
              subheader="Hybrid score = 0.4 ML + 0.3 Rules + 0.3 Money Flow"
              action={
                <Stack direction="row" spacing={1}>
                  <Button onClick={loadLast} disabled={running}>{running ? 'Loading…' : 'Load Last'}</Button>
                  <Button variant="contained" onClick={run} disabled={running}>{running ? 'Running…' : 'Run Hybrid Scoring'}</Button>
                </Stack>
              }
            />
            <CardContent>
              {summary ? (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                  <Chip label={`Total: ${summary.total_accounts ?? 0}`} />
                  <Chip color="error" label={`HIGH: ${summary.high_risk_count ?? 0}`} />
                  <Chip color="warning" label={`MEDIUM: ${summary.medium_risk_count ?? 0}`} />
                  <Chip color="success" label={`LOW: ${summary.low_risk_count ?? 0}`} />
                  <Chip label={`Avg: ${Number(summary.average_risk_score ?? 0).toFixed(3)}`} />
                  <Chip label={`Max: ${Number(summary.max_risk_score ?? 0).toFixed(3)}`} />
                  {lastRunAt && <Chip label={`Last Run: ${new Date(lastRunAt).toLocaleString()}`} />}
                  </Stack>
                  {Array.isArray(summary.methodology) && summary.methodology.length > 0 && (
                    <>
                      <Divider />
                      <Typography variant="caption" color="text.secondary">
                        {summary.methodology.join(' ')}
                      </Typography>
                    </>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Run hybrid scoring to populate risk results.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardHeader title="Selected Account Breakdown" subheader={selectedAccountId || 'Select an account'} />
            <CardContent sx={{ height: 320 }}>
              {!selectedAccountId ? (
                <Typography variant="body2" color="text.secondary">
                  Select an account in the header to see contribution breakdown.
                </Typography>
              ) : !selected ? (
                <Typography variant="body2" color="text.secondary">
                  Run Hybrid Scoring to populate this account.
                </Typography>
              ) : !breakdown ? (
                <Typography variant="body2" color="text.secondary">
                  No breakdown available for this account.
                </Typography>
              ) : (
                <Stack spacing={2} sx={{ height: '100%' }}>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label={`Hybrid: ${Number(selected.hybrid_score || 0).toFixed(3)}`} />
                    <Chip label={`Risk: ${selected.risk_level}`} />
                    <Button variant="outlined" onClick={() => openInvestigation(selected.account_id)}>
                      Investigate
                    </Button>
                  </Stack>
                  <Box sx={{ flex: 1 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={breakdown.data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={2}>
                          {breakdown.data.map((d) => (
                            <Cell key={d.name} fill={colors[d.name] || '#94a3b8'} />
                          ))}
                        </Pie>
                        <Legend />
                        <ReTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card elevation={0} sx={{ height: '100%' }}>
            <CardHeader title="Top Risky Accounts" subheader="Cards for triage and drill-down" />
            <CardContent>
              {accounts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No results yet.</Typography>
              ) : (
                <Grid container spacing={2}>
                  {accounts.slice(0, 12).map((a) => (
                    <Grid item xs={12} sm={6} md={4} key={a.account_id}>
                      <AccountCard
                        account={{
                          account_id: a.account_id,
                          hybrid_score: a.hybrid_score,
                          ml_score: a.ml_score,
                          rule_score: a.rule_score,
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

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="What We Do" subheader="Explainability for investigators" />
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Hybrid scoring combines three independent signals: ML probability, rule-based risk, and account network risk. The donut chart shows weighted contribution to the final decision for the selected account.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default HybridScoringScreen;
