import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Slider,
  Stack,
  Typography,
  Tabs,
  Tab,
  Switch,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  Divider
} from '@mui/material';
import muleApi from '../services/muleApi';

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n)));

const ruleDefs = {
  velocity: [
    { id: 'rapid_fund_movement', title: 'Rapid Fund Movement', desc: 'Funds moving out within 1 hour of receipt' },
    { id: 'transaction_burst', title: 'Transaction Burst', desc: 'More than 10 transactions in 24 hours' },
    { id: 'multi_rail_transfers', title: 'Multi-Rail Transfers', desc: 'Multiple rails in short succession' }
  ],
  recency: [
    { id: 'new_account_flag', title: 'New Account Flag', desc: 'New account with high activity' },
    { id: 'dormant_to_active', title: 'Dormant-to-Active', desc: 'Dormant account suddenly active' },
    { id: 'profile_change_activity', title: 'Profile Change + Activity', desc: 'Profile change near unusual activity' }
  ],
  circularity: [
    { id: 'simple_cycle', title: 'Simple Cycle', desc: 'Two-way / short cycle flow patterns' },
    { id: 'round_tripping', title: 'Round-Tripping', desc: 'Funds return to source within window' },
    { id: 'repeated_loops', title: 'Repeated Loops', desc: 'Multiple similar circular paths' }
  ],
  device: [
    { id: 'shared_device', title: 'Shared Device', desc: 'Device used across multiple accounts' },
    { id: 'device_change_frequency', title: 'Device Change Frequency', desc: 'Frequent device changes' },
    { id: 'ip_vpn_anomalies', title: 'IP/VPN Anomalies', desc: 'Suspicious IP changes or VPN patterns' }
  ]
};

const RuleEngineScreen = () => {
  const [config, setConfig] = useState({
    rule_weights: { velocity: 0.3, recency: 0.2, circularity: 0.3, device: 0.2 },
    rules: { velocity: {}, recency: {}, circularity: {}, device: {} }
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [tab, setTab] = useState('velocity');

  const weightSum = useMemo(() => {
    const w = config?.rule_weights || {};
    return Number(w.velocity || 0) + Number(w.recency || 0) + Number(w.circularity || 0) + Number(w.device || 0);
  }, [config]);

  const load = async () => {
    setError(null);
    try {
      const res = await muleApi.getRulesConfig();
      if (res?.config) setConfig(res.config);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load rule config');
    }
  };

  const loadLast = async () => {
    setError(null);
    try {
      const res = await muleApi.getLastRun('rules');
      if (res?.has_results) {
        setResults(res.result?.accounts || []);
        setSummary(res.result?.summary || null);
        setLastRunAt(res.created_at || null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load last results');
    }
  };

  useEffect(() => {
    load();
    loadLast();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await muleApi.updateRulesConfig(config);
      if (res?.config) setConfig(res.config);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to save rule config');
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await muleApi.runRules();
      setResults(res?.accounts || []);
      setSummary(res?.summary || null);
      setLastRunAt(res?.run_meta?.created_at || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Rules run failed');
    } finally {
      setRunning(false);
    }
  };

  const setWeight = (k) => (_e, v) => {
    setConfig((prev) => ({
      ...prev,
      rule_weights: {
        ...(prev.rule_weights || {}),
        [k]: clamp01(v)
      }
    }));
  };

  const setRuleEnabled = (category, id) => (_e, checked) => {
    setConfig((prev) => ({
      ...prev,
      rules: {
        ...(prev.rules || {}),
        [category]: {
          ...((prev.rules || {})[category] || {}),
          [id]: {
            ...(((prev.rules || {})[category] || {})[id] || {}),
            enabled: Boolean(checked),
            weight: Number((((prev.rules || {})[category] || {})[id] || {}).weight ?? 0.5)
          }
        }
      }
    }));
  };

  const setRuleWeight = (category, id) => (_e, v) => {
    setConfig((prev) => ({
      ...prev,
      rules: {
        ...(prev.rules || {}),
        [category]: {
          ...((prev.rules || {})[category] || {}),
          [id]: {
            ...(((prev.rules || {})[category] || {})[id] || {}),
            enabled: Boolean((((prev.rules || {})[category] || {})[id] || {}).enabled ?? true),
            weight: clamp01(v)
          }
        }
      }
    }));
  };

  const triggersByCat = useMemo(() => summary?.top_triggered_rules_by_category || {}, [summary]);

  return (
    <Box sx={{ p: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardHeader
              title="Rule Engine"
              subheader="Configure rule weights and run detection on stored data"
              action={
                <Stack direction="row" spacing={1}>
                  <Button onClick={loadLast} disabled={running || saving}>Load Last</Button>
                  <Button onClick={load} disabled={running || saving}>Refresh</Button>
                </Stack>
              }
            />
            <CardContent>
              <Stack spacing={2}>
                {summary && (
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip label={`Total: ${summary.total_accounts ?? results.length}`} />
                      <Chip color="error" label={`High: ${summary.high_risk_count ?? 0}`} />
                      <Chip color="warning" label={`Medium: ${summary.medium_risk_count ?? 0}`} />
                      <Chip color="success" label={`Low: ${summary.low_risk_count ?? 0}`} />
                      {lastRunAt && <Chip label={`Last Run: ${new Date(lastRunAt).toLocaleString()}`} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Rules explain risk by listing triggered detectors per account and per-category scores (velocity, recency, circularity, device).
                    </Typography>
                    <Divider />
                  </Stack>
                )}
                <Typography variant="subtitle2">Category Weights</Typography>
                <Box>
                  <Typography variant="caption">Velocity</Typography>
                  <Slider value={Number(config.rule_weights?.velocity || 0)} onChange={setWeight('velocity')} step={0.05} min={0} max={1} />
                </Box>
                <Box>
                  <Typography variant="caption">Recency</Typography>
                  <Slider value={Number(config.rule_weights?.recency || 0)} onChange={setWeight('recency')} step={0.05} min={0} max={1} />
                </Box>
                <Box>
                  <Typography variant="caption">Circularity</Typography>
                  <Slider value={Number(config.rule_weights?.circularity || 0)} onChange={setWeight('circularity')} step={0.05} min={0} max={1} />
                </Box>
                <Box>
                  <Typography variant="caption">Device</Typography>
                  <Slider value={Number(config.rule_weights?.device || 0)} onChange={setWeight('device')} step={0.05} min={0} max={1} />
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label={`Sum: ${weightSum.toFixed(2)}`} />
                  <Button variant="outlined" onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="contained" onClick={run} disabled={running}>
                    {running ? 'Running…' : 'Run Rules'}
                  </Button>
                </Stack>
                <Divider />
                <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth">
                  <Tab value="velocity" label="Velocity" />
                  <Tab value="recency" label="Recency" />
                  <Tab value="circularity" label="Circularity" />
                  <Tab value="device" label="Device" />
                </Tabs>
                <Stack spacing={2}>
                  {(ruleDefs[tab] || []).map((rd) => {
                    const conf = (config.rules?.[tab] || {})[rd.id] || {};
                    const enabled = Boolean(conf.enabled ?? true);
                    const weight = Number(conf.weight ?? 0.5);
                    const triggerCount = Number((triggersByCat?.[tab] || []).find((t) => t.rule === rd.id)?.count || 0);
                    return (
                      <Card key={rd.id} variant="outlined">
                        <CardContent>
                          <Stack spacing={1}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Box>
                                <Typography variant="subtitle2">{rd.title}</Typography>
                                <Typography variant="caption" color="text.secondary">{rd.desc}</Typography>
                              </Box>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Chip size="small" label={`${triggerCount} triggers`} />
                                <Switch checked={enabled} onChange={setRuleEnabled(tab, rd.id)} />
                              </Stack>
                            </Stack>
                            <Typography variant="caption">Weight</Typography>
                            <Slider value={clamp01(weight)} onChange={setRuleWeight(tab, rd.id)} step={0.05} min={0} max={1} disabled={!enabled} />
                          </Stack>
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card>
            <CardHeader title="Rule Results" subheader="Top accounts by rule risk score" />
            <CardContent>
              {results.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Run rules to view results.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Risk Score</TableCell>
                      <TableCell align="right">Velocity</TableCell>
                      <TableCell align="right">Recency</TableCell>
                      <TableCell align="right">Circularity</TableCell>
                      <TableCell align="right">Device</TableCell>
                      <TableCell>Risk</TableCell>
                      <TableCell align="right">Triggered</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {results.slice(0, 100).map((r) => (
                      <TableRow key={r.account_id}>
                        <TableCell>{r.account_id}</TableCell>
                        <TableCell align="right">{Number(r.risk_score || 0).toFixed(3)}</TableCell>
                        <TableCell align="right">{Number(r.rule_scores?.velocity || 0).toFixed(3)}</TableCell>
                        <TableCell align="right">{Number(r.rule_scores?.recency || 0).toFixed(3)}</TableCell>
                        <TableCell align="right">{Number(r.rule_scores?.circularity || 0).toFixed(3)}</TableCell>
                        <TableCell align="right">{Number(r.rule_scores?.device || 0).toFixed(3)}</TableCell>
                        <TableCell>{r.risk_category}</TableCell>
                        <TableCell align="right">{Array.isArray(r.triggered_rules) ? r.triggered_rules.length : 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {Array.isArray(summary?.top_triggered_rules) && summary.top_triggered_rules.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2">Top Triggered Rules</Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rule</TableCell>
                        <TableCell align="right">Count</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.top_triggered_rules.map((t) => (
                        <TableRow key={t.rule}>
                          <TableCell>{t.rule}</TableCell>
                          <TableCell align="right">{t.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default RuleEngineScreen;
