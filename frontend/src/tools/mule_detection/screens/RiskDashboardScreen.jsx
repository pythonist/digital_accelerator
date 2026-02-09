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
  Stack,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Divider
} from '@mui/material';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip } from 'recharts';
import muleApi from '../services/muleApi';
import AccountSelector from '../components/AccountSelector';
import StructuredValue from '../components/StructuredValue';
import { formatInteger, formatNumber, formatPercentFromRatio, formatProbability } from '../utils/formatters';

const RiskDashboardScreen = ({ onAccountSelect }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [queue, setQueue] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [signals, setSignals] = useState([]);
  const [health, setHealth] = useState(null);
  const [filters, setFilters] = useState({});

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pat, sig, h] = await Promise.all([
        muleApi.getPortfolioSummary(),
        muleApi.getEmergingPatterns(),
        muleApi.getTopSignals({ limit: 12 }),
        muleApi.getModelHealth()
      ]);
      setPortfolio(p);
      setPatterns(pat?.patterns || []);
      setSignals(sig?.signals || []);
      setHealth(h?.health || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load risk dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadQueue = async (nextFilters = filters) => {
    try {
      const res = await muleApi.getPriorityQueue(nextFilters);
      setQueue(res?.accounts || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load priority queue');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadQueue();
  }, [filters]);

  const applyFilter = (next) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next };
      Object.keys(merged).forEach((k) => {
        if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
      });
      return merged;
    });
  };

  const clearFilters = () => setFilters({});

  const summary = portfolio?.summary || null;
  const histogram = portfolio?.histogram || [];
  const migration = portfolio?.migration || [];
  const metadata = portfolio?.metadata || {};
  const migrationMatrix = useMemo(() => {
    const levels = ['LOW', 'MEDIUM', 'HIGH'];
    const map = {};
    migration.forEach((m) => {
      map[`${m.from}_${m.to}`] = m.count;
    });
    return { levels, map };
  }, [migration]);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <AccountSelector dense />
                <Button onClick={loadAll} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
                <Chip label={`Data: ${metadata?.data_timestamp || '-'}`} />
                <Chip label={`Model: ${metadata?.model_version || '-'}`} />
                <Chip label={`Features: ${metadata?.feature_version || '-'}`} />
                {Object.keys(filters).length > 0 && (
                  <Button variant="outlined" onClick={clearFilters}>Clear Filters</Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Portfolio Overview"
              subheader="Risk posture, flow, and control signals"
            />
            <CardContent>
              {!summary ? (
                <Typography variant="body2" color="text.secondary">
                  No risk results available.
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={8}>
                    <Grid container spacing={2}>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0} onClick={() => applyFilter({})}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Total Accounts</Typography>
                            <Typography variant="h6">{formatInteger(summary.total_accounts ?? 0)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0} onClick={() => applyFilter({ risk_level: 'HIGH' })}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">High Risk</Typography>
                            <Typography variant="h6">{formatInteger(summary.high_risk_count ?? 0)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0} onClick={() => applyFilter({ risk_level: 'MEDIUM' })}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Medium Risk</Typography>
                            <Typography variant="h6">{formatInteger(summary.medium_risk_count ?? 0)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0} onClick={() => applyFilter({ risk_level: 'LOW' })}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Low Risk</Typography>
                            <Typography variant="h6">{formatInteger(summary.low_risk_count ?? 0)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Net New High</Typography>
                            <Typography variant="h6">{formatInteger(summary.net_new_high_today ?? 0)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Suppression Rate</Typography>
                            <Typography variant="h6">{formatPercentFromRatio(summary.suppression_rate || 0, 1)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Escalation Rate</Typography>
                            <Typography variant="h6">{formatPercentFromRatio(summary.escalation_rate || 0, 1)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Average Risk</Typography>
                            <Typography variant="h6">{formatProbability(summary.average_risk_score || 0, 2)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Card elevation={0}>
                          <CardContent>
                            <Typography variant="caption" color="text.secondary">Max Risk</Typography>
                            <Typography variant="h6">{formatProbability(summary.max_risk_score || 0, 2)}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card elevation={0}>
                      <CardHeader title="Risk Distribution Histogram" />
                      <CardContent sx={{ height: 180 }}>
                        {histogram.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No distribution available.</Typography>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogram}>
                              <XAxis dataKey="start" tickFormatter={(v) => `${v}`} />
                              <YAxis />
                              <ReTooltip />
                              <Bar
                                dataKey="count"
                                fill="#1f2937"
                                onClick={(d) => applyFilter({ min_score: d?.payload?.start, max_score: d?.payload?.end })}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                    <Card elevation={0} sx={{ mt: 2 }}>
                      <CardHeader title="Risk Migration (Previous → Current)" />
                      <CardContent>
                        {migration.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No migration baseline.</Typography>
                        ) : (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell></TableCell>
                                {migrationMatrix.levels.map((lvl) => (
                                  <TableCell key={`to-${lvl}`}>{lvl}</TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {migrationMatrix.levels.map((from) => (
                                <TableRow key={`from-${from}`}>
                                  <TableCell>{from}</TableCell>
                                  {migrationMatrix.levels.map((to) => (
                                    <TableCell
                                      key={`${from}-${to}`}
                                      onClick={() => applyFilter({ risk_level: to })}
                                    >
                                      {formatInteger(migrationMatrix.map[`${from}_${to}`] || 0)}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Priority Action Queue"
              subheader="Accounts requiring immediate triage"
            />
            <CardContent>
              {queue.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No queue items found.</Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Account</TableCell>
                        <TableCell>Current Risk</TableCell>
                        <TableCell>Risk Delta</TableCell>
                        <TableCell>Key Trigger</TableCell>
                        <TableCell>New Counterparties</TableCell>
                        <TableCell>Velocity Change</TableCell>
                        <TableCell>Model Confidence</TableCell>
                        <TableCell>Aging</TableCell>
                        <TableCell>Last Reviewed</TableCell>
                        <TableCell>Tags</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {queue.map((r) => (
                        <TableRow key={r.account_id} hover onClick={() => onAccountSelect && onAccountSelect(r.account_id)}>
                          <TableCell>{r.account_id}</TableCell>
                          <TableCell>{r.risk_level} · {formatProbability(r.hybrid_score || 0, 2)}</TableCell>
                          <TableCell>{formatProbability(r.risk_delta || 0, 2)}</TableCell>
                          <TableCell sx={{ maxWidth: 420 }}>
                            <StructuredValue value={r.key_trigger} inline mode="text" />
                          </TableCell>
                          <TableCell>{r.new_counterparties ?? '-'}</TableCell>
                          <TableCell>{r.velocity_change ?? '-'}</TableCell>
                          <TableCell>{r.model_confidence ?? '-'}</TableCell>
                          <TableCell>{r.aging_days ?? '-'}</TableCell>
                          <TableCell>{r.last_reviewed || '-'}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                              {(r.tags || []).map((t) => (
                                <Chip key={`${r.account_id}-${t}`} label={t} size="small" onClick={(e) => { e.stopPropagation(); applyFilter({ tag: t }); }} />
                              ))}
                            </Stack>
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

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Emerging Risk Panel" subheader="Pattern-level shifts and anomalous bursts" />
            <CardContent>
              {patterns.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No emerging patterns detected.</Typography>
              ) : (
                <Grid container spacing={2}>
                  {patterns.map((p, i) => (
                    <Grid item xs={12} md={6} lg={3} key={`${p.type}-${i}`}>
                      <Card elevation={0}>
                        <CardContent onClick={() => applyFilter(p.filter || {})}>
                          <Typography variant="subtitle2" fontWeight={700}>{p.title}</Typography>
                            <Typography variant="h6">{formatNumber(p.metric ?? 0, { maxFractionDigits: 2 })}</Typography>
                            <Typography variant="caption" color="text.secondary">Δ {formatNumber(p.delta ?? 0, { maxFractionDigits: 2 })}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Top Signal Drivers Today" subheader="Features most associated with portfolio risk" />
            <CardContent>
              {signals.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No signal drivers available.</Typography>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {signals.map((s) => (
                    <Chip
                      key={s.feature}
                      label={`${s.feature} · ${formatProbability(s.score || 0, 2)} · ${formatInteger(s.impacted_accounts || 0)}`}
                      onClick={() => applyFilter({ signal: s.feature })}
                    />
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Model & Rule Health" subheader="Operational risk monitoring and stability" />
            <CardContent>
              {!health ? (
                <Typography variant="body2" color="text.secondary">No health telemetry available.</Typography>
              ) : (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <Chip label={`Score drift: ${formatProbability(health.score_drift || 0, 3)}`} />
                    <Chip label={`Override rate: ${formatPercentFromRatio(health.override_rate || 0, 1)}`} />
                    <Chip label={`False positive: ${formatPercentFromRatio(health.false_positive_rate || 0, 1)}`} />
                    <Chip label={`FP delta: ${formatPercentFromRatio(health.false_positive_delta || 0, 1)}`} />
                    <Chip label={`Data freshness (days): ${formatInteger(health.data_freshness_days ?? '-')}`} />
                  </Stack>
                  <Divider />
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <Chip label={`Rules last run: ${health.pipeline?.rules_last_run || '-'}`} />
                    <Chip label={`ML last run: ${health.pipeline?.ml_last_run || '-'}`} />
                    <Chip label={`Hybrid last run: ${health.pipeline?.hybrid_last_run || '-'}`} />
                  </Stack>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default RiskDashboardScreen;
