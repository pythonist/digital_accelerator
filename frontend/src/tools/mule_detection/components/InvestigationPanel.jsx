import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Stack,
  Typography,
  Button,
  Divider,
  Grid,
  Chip,
  Alert
} from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';
import AccountSelector from './AccountSelector';
import RiskChip from './RiskChip';
import { formatProbability } from '../utils/formatters';

const getPrimaryDrivers = ({ shapTop = [], rules = null, flow = null }) => {
  const drivers = [];

  const trig = rules?.triggered_by_category || {};
  if (Array.isArray(trig.velocity) && trig.velocity.length) drivers.push('High transaction velocity');
  if (Array.isArray(trig.circularity) && trig.circularity.length) drivers.push('Circular transactions');
  if (Array.isArray(trig.device) && trig.device.length) drivers.push('Device anomaly');
  if (Array.isArray(trig.recency) && trig.recency.length) drivers.push('New/dormant account activity');

  if (flow?.pass_through?.rate != null && Number(flow.pass_through.rate) >= 0.15) drivers.push('Pass-through behavior (exit within 1 hour)');
  if (Number(flow?.circular_chains?.count || 0) > 0) drivers.push('Circular chain detected');
  if (Number(flow?.multi_hop_chains?.count || 0) > 0) drivers.push('Multi-hop propagation detected');
  if (Number(flow?.velocity_bursts_in_chains?.count || 0) > 0) drivers.push('Velocity burst in chain');

  const shapNames = shapTop.map((t) => String(t.feature || '').toLowerCase());
  if (shapNames.some((n) => n.includes('tx_count') || n.includes('velocity'))) drivers.push('ML: high activity/velocity features');
  if (shapNames.some((n) => n.includes('device') || n.includes('ip'))) drivers.push('ML: device/IP signals');
  if (shapNames.some((n) => n.includes('cycle') || n.includes('circular'))) drivers.push('ML: circularity signals');

  return Array.from(new Set(drivers)).slice(0, 6);
};

const InvestigationPanel = ({ embedded = false }) => {
  const { selectedAccountId, openInvestigation, closeInvestigation } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [accountSummary, setAccountSummary] = useState(null);
  const [shap, setShap] = useState(null);
  const [rulesAccount, setRulesAccount] = useState(null);
  const [mlScore, setMlScore] = useState(null);
  const [flowPatterns, setFlowPatterns] = useState(null);

  const load = async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, shapRes, lastRules, lastMl, flowGraph] = await Promise.all([
        muleApi.getAccountSummary(selectedAccountId),
        muleApi.explainShap(selectedAccountId),
        muleApi.getLastRun('rules'),
        muleApi.getLastRun('ml_inference'),
        muleApi.getAccountGraph(selectedAccountId)
      ]);
      setAccountSummary(summaryRes);
      setShap(shapRes?.success ? shapRes : null);

      const rulesAcc =
        (lastRules?.has_results ? (lastRules.result?.accounts || []).find((a) => a.account_id === selectedAccountId) : null) || null;
      setRulesAccount(rulesAcc);

      setFlowPatterns(flowGraph?.patterns || null);

      const ml =
        (lastMl?.has_results ? (lastMl.result?.predictions || []).find((p) => p.account_id === selectedAccountId) : null) || null;
      setMlScore(ml?.ml_score ?? null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load investigation panel');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedAccountId]);

  const shapData = useMemo(() => {
    const top = shap?.top_features || [];
    const rows = top.map((t) => ({
      feature: t.feature,
      value: Number(t.value || 0)
    }));
    return rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 12);
  }, [shap]);

  const breakdown = useMemo(() => {
    const hybrid = accountSummary?.risk?.hybrid_score;
    const rule = rulesAccount?.risk_score ?? accountSummary?.risk?.pattern_risk_score;
    const ml = mlScore ?? accountSummary?.risk?.ml_risk_score;
    const flow = flowPatterns?.flow_score;
    return {
      hybrid: Number.isFinite(Number(hybrid)) ? Number(hybrid) : null,
      ml: Number.isFinite(Number(ml)) ? Number(ml) : null,
      rule: Number.isFinite(Number(rule)) ? Number(rule) : null,
      flow: Number.isFinite(Number(flow)) ? Number(flow) : null
    };
  }, [accountSummary, rulesAccount, flowPatterns, mlScore]);

  const drivers = useMemo(() => {
    return getPrimaryDrivers({ shapTop: shapData, rules: rulesAccount, flow: flowPatterns });
  }, [shapData, rulesAccount, flowPatterns]);

  const riskLevel = accountSummary?.risk?.risk_level || 'LOW';

  return (
    <Box sx={{ p: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={900}>
            Investigation Panel
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Account-centric explanation and scoring breakdown
          </Typography>
        </Box>
        {!embedded ? (
          <Button variant="outlined" onClick={closeInvestigation}>
            Close
          </Button>
        ) : null}
      </Stack>

      <Stack spacing={1} sx={{ mb: 2 }}>
        <AccountSelector dense />
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          <Chip label={selectedAccountId ? `Selected: ${selectedAccountId}` : 'Select an account'} />
          <RiskChip riskLevel={riskLevel} />
          <Button variant="contained" onClick={() => openInvestigation()} disabled={!selectedAccountId || loading}>
            {loading ? 'Loading…' : 'Refresh Intelligence'}
          </Button>
        </Stack>
      </Stack>

      {!selectedAccountId ? (
        <Typography variant="body2" color="text.secondary">
          Select an account to start investigation.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card elevation={0}>
              <CardHeader title="Feature Importance" subheader="Contribution values for this account" />
              <CardContent sx={{ height: 360 }}>
                {shapData.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Generate explainability by running Explainability or training an XGBoost model.
                  </Typography>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shapData} layout="vertical" margin={{ left: 10, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="feature" width={180} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#ea580c" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card elevation={0}>
              <CardHeader title="Prediction Breakdown" subheader="Why this account is flagged" />
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">ML Score</Typography>
                    <Typography variant="body2" fontWeight={800}>
                      {breakdown.ml != null ? formatProbability(breakdown.ml, 3) : '-'}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">Rule Score</Typography>
                    <Typography variant="body2" fontWeight={800}>
                      {breakdown.rule != null ? formatProbability(breakdown.rule, 3) : '-'}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">Money Flow Score</Typography>
                    <Typography variant="body2" fontWeight={800}>
                      {breakdown.flow != null ? formatProbability(breakdown.flow, 3) : '-'}
                    </Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body1" fontWeight={900}>
                      Final Hybrid Score
                    </Typography>
                    <Typography variant="body1" fontWeight={900}>
                      {breakdown.hybrid != null ? formatProbability(breakdown.hybrid, 3) : '-'}
                    </Typography>
                  </Stack>

                  <Divider sx={{ my: 1 }} />

                  <Typography variant="subtitle2" fontWeight={800}>
                    Primary Drivers
                  </Typography>
                  {drivers.length ? (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {drivers.map((d) => (
                        <Chip key={d} label={d} />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Run Rules + Money Flow Graph + Explainability to populate drivers.
                    </Typography>
                  )}

                  {rulesAccount?.triggered_by_category ? (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="subtitle2" fontWeight={800}>
                        Triggered Rules
                      </Typography>
                      <Stack spacing={1}>
                        {['velocity', 'recency', 'circularity', 'device'].map((k) => (
                          <Stack key={k} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={k.toUpperCase()} />
                            {(rulesAccount.triggered_by_category[k] || []).slice(0, 6).map((r) => (
                              <Chip key={`${k}-${r}`} size="small" variant="outlined" label={r} />
                            ))}
                          </Stack>
                        ))}
                      </Stack>
                    </>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default InvestigationPanel;
