import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
  LinearProgress
} from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip } from 'recharts';
import muleApi from '../services/muleApi';
import AccountSelector from '../components/AccountSelector';
import { pwcColors } from '../theme';
import { useMuleStore } from '../store/muleStore';
import { formatInteger, formatNumber, formatPercentFromRatio, formatProbability } from '../utils/formatters';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const levelFromScore = (score, thresholds) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return { label: 'Unknown', color: 'text.secondary' };
  if (n >= Number(thresholds?.high ?? 0.7)) return { label: 'High', color: pwcColors.errorText };
  if (n >= Number(thresholds?.medium ?? 0.4)) return { label: 'Medium', color: pwcColors.warningText };
  return { label: 'Low', color: pwcColors.successText };
};

const deltaLabel = (delta) => {
  const n = Number(delta);
  if (!Number.isFinite(n)) return 'Stable';
  if (n >= 0.05) return 'Rising';
  if (n <= -0.05) return 'Falling';
  return 'Stable';
};

const zLevel = (z) => {
  const n = Math.abs(Number(z));
  if (!Number.isFinite(n)) return 'Unknown';
  if (n >= 2.5) return 'High';
  if (n >= 1.5) return 'Medium';
  return 'Low';
};

const BarRow = ({ title, subtitle, valueLabel, valuePct, color = pwcColors.primary, onClick }) => {
  const pct = Math.round(clamp01(valuePct) * 100);
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1,
        borderRadius: 1,
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { bgcolor: '#f8fafc' } : undefined
      }}
    >
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
          {valueLabel}
        </Typography>
      </Stack>
      <Box sx={{ mt: 0.75, height: 8, borderRadius: 10, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: color }} />
      </Box>
    </Box>
  );
};

const ExplainabilityScreen = () => {
  const { selectedAccountId, openInvestigation } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [thresholds, setThresholds] = useState({ high: 0.7, medium: 0.4 });
  const [explain, setExplain] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);

  const load = async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.explainAccount({ account_id: selectedAccountId, high: thresholds.high, medium: thresholds.medium });
      if (!res?.success) throw new Error(res?.error || 'Explain failed');
      setExplain(res);
      setSelectedDriver(null);
    } catch (e) {
      setExplain(null);
      setError(e?.response?.data?.error || e?.message || 'Failed to load explainability');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedAccountId]);

  const summary = explain?.decision_summary || null;
  const layers = explain?.layers || {};
  const modelMath = layers?.model_math || {};
  const narrative = layers?.behaviour_narrative || [];
  const peerDev = layers?.peer_deviation || [];
  const timeline = layers?.temporal_story || null;
  const network = layers?.network_context || null;
  const justify = layers?.decision_justification || {};
  const counterfactual = justify?.counterfactual || null;

  const contributions = modelMath?.contributions || [];
  const quick = useMemo(() => {
    const riskScore = summary?.risk_score;
    const risk = levelFromScore(riskScore, thresholds);
    const confLevel = String(justify?.confidence?.level || 'unknown');
    const confMap = {
      high: { label: 'High', color: pwcColors.successText },
      medium: { label: 'Medium', color: pwcColors.warningText },
      low: { label: 'Low', color: pwcColors.errorText }
    };
    const conf = confMap[confLevel.toLowerCase()] || { label: confLevel, color: 'text.secondary' };
    const dLabel = deltaLabel(summary?.risk_delta_vs_last);
    return {
      decision: summary?.decision || '-',
      riskLevel: summary?.risk_level || risk.label,
      riskBand: risk,
      confidence: conf,
      trend: dLabel
    };
  }, [justify?.confidence?.level, summary, thresholds]);

  const themeBars = useMemo(() => {
    const t = Array.isArray(summary?.themes) ? summary.themes : [];
    const rows = t
      .map((x) => ({ theme: String(x.theme || 'Theme'), strength: Number(x.strength || 0) }))
      .filter((x) => Number.isFinite(x.strength))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 6);
    const max = rows.reduce((m, r) => Math.max(m, r.strength), 0) || 1;
    return rows.map((r) => ({ ...r, pct: r.strength / max }));
  }, [summary]);

  const topDrivers = useMemo(() => {
    const maxAbsImpact = contributions.reduce((m, r) => Math.max(m, Math.abs(Number(r.impact || 0))), 0) || 1;
    return contributions
      .slice()
      .sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)))
      .slice(0, 12)
      .map((r) => ({
        feature: r.feature,
        family: r.family || 'other',
        impact: Number(r.impact || 0),
        pct: Math.min(1, Math.abs(Number(r.impact || 0)) / maxAbsImpact),
        direction: Number(r.impact || 0) >= 0 ? 'increases risk' : 'reduces risk'
      }));
  }, [contributions]);

  const driverThemes = useMemo(() => {
    const groups = {};
    topDrivers.forEach((d) => {
      const k = String(d.family || 'other');
      if (!groups[k]) groups[k] = [];
      groups[k].push(d);
    });
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => b.pct - a.pct);
    });
    return Object.entries(groups)
      .sort((a, b) => b[1].reduce((s, r) => s + r.pct, 0) - a[1].reduce((s, r) => s + r.pct, 0))
      .slice(0, 4);
  }, [topDrivers]);

  const peerDevTop = useMemo(() => {
    const rows = peerDev
      .slice()
      .sort((a, b) => Math.abs(Number(b.z || 0)) - Math.abs(Number(a.z || 0)))
      .slice(0, 10);
    const maxZ = rows.reduce((m, r) => Math.max(m, Math.abs(Number(r.z || 0))), 0) || 1;
    return rows.map((r) => ({
      ...r,
      z_abs: Math.abs(Number(r.z || 0)),
      z_level: zLevel(r.z),
      pct: Math.min(1, Math.abs(Number(r.z || 0)) / maxZ)
    }));
  }, [peerDev]);
  const contribByFamily = useMemo(() => {
    const groups = {};
    for (const r of contributions) {
      const fam = r.family || 'other';
      if (!groups[fam]) groups[fam] = [];
      groups[fam].push(r);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)));
    }
    return groups;
  }, [contributions]);

  const familyChartData = useMemo(() => {
    const rows = [];
    for (const [fam, items] of Object.entries(contribByFamily)) {
      const pos = items.filter((x) => Number(x.impact || 0) >= 0).reduce((s, x) => s + Math.abs(Number(x.impact || 0)), 0);
      const neg = items.filter((x) => Number(x.impact || 0) < 0).reduce((s, x) => s + Math.abs(Number(x.impact || 0)), 0);
      rows.push({ family: fam, positive: pos, negative: neg, total: pos + neg });
    }
    rows.sort((a, b) => Number(b.total) - Number(a.total));
    return rows;
  }, [contribByFamily]);

  const driverDetail = useMemo(() => {
    if (!selectedDriver) return null;
    return contributions.find((c) => c.feature === selectedDriver) || peerDev.find((d) => d.feature === selectedDriver) || null;
  }, [selectedDriver, contributions, peerDev]);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Explainability Workbench"
              subheader="Behaviour intelligence, peer deviation, temporal story, network context, and decision justification"
              action={
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button onClick={load} disabled={loading || !selectedAccountId}>Refresh</Button>
                  <Button variant="contained" onClick={() => openInvestigation(selectedAccountId)} disabled={!selectedAccountId} sx={{ bgcolor: pwcColors.primary }}>
                    Open Investigation
                  </Button>
                </Stack>
              }
            />
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={4}>
                  <AccountSelector dense />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField size="small" label="High threshold" value={thresholds.high} onChange={(e) => setThresholds({ ...thresholds, high: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField size="small" label="Medium threshold" value={thresholds.medium} onChange={(e) => setThresholds({ ...thresholds, medium: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={4}>
                  {loading ? <LinearProgress /> : null}
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              {!summary ? (
                <Alert severity="info" variant="outlined">
                  Select an account to generate explanation.
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Risk</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 900, color: quick.riskBand.color }}>
                          {quick.riskBand.label}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {quick.riskLevel} · trend {quick.trend}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Decision</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 900 }}>
                          {quick.decision}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {summary?.risk_score == null ? '' : `score ${formatProbability(summary.risk_score, 2)}`}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Confidence</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 900, color: quick.confidence.color }}>
                          {quick.confidence.label}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {summary?.risk_delta_vs_last == null ? '' : `Δ ${formatProbability(summary.risk_delta_vs_last, 2)}`}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
              <Divider sx={{ my: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="text.secondary">Run context</Typography>
                  <Typography variant="body2">{explain?.run?.model_version ? `Model ${explain.run.model_version}` : 'Model -'}</Typography>
                  <Typography variant="body2" color="text.secondary">{explain?.run?.score_timestamp ? `Scored ${explain.run.score_timestamp}` : ''}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="text.secondary">Explainer</Typography>
                  <Typography variant="body2">{modelMath?.method || '-'}</Typography>
                  <Typography variant="body2" color="text.secondary">{modelMath?.status ? `Status ${modelMath.status}` : ''}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Decision Summary" subheader="Plain-English justification suitable for compliance" />
            <CardContent>
              {!summary ? (
                <Typography variant="body2" color="text.secondary">Select an account to generate explanation.</Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={8}>
                    <Stack spacing={1}>
                      {(summary.why || []).map((t, i) => (
                        <Typography key={i} variant="body2">{t}</Typography>
                      ))}
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Card variant="outlined">
                      <CardHeader title="Driver Themes" subheader="Grouped so you can understand in seconds" />
                      <CardContent>
                        {themeBars.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No themes available.</Typography>
                        ) : (
                          <Stack spacing={1}>
                            {themeBars.map((t) => (
                              <BarRow
                                key={t.theme}
                                title={t.theme}
                                subtitle="Theme strength"
                                valueLabel={t.pct >= 0.67 ? 'High' : t.pct >= 0.34 ? 'Medium' : 'Low'}
                                valuePct={t.pct}
                              />
                            ))}
                          </Stack>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card elevation={0}>
                      <CardHeader title="Counterfactual (What-if)" subheader="If key drivers were normal, would score fall?" />
                      <CardContent>
                        {!counterfactual?.has_results ? (
                          <Typography variant="body2" color="text.secondary">No counterfactuals available.</Typography>
                        ) : (
                          <>
                            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                              Baseline score: {formatProbability(counterfactual.baseline_score || 0, 2)}
                            </Typography>
                            <Divider sx={{ my: 1 }} />
                            <Stack spacing={1}>
                              {(counterfactual.what_if || []).slice(0, 6).map((r) => (
                                <BarRow
                                  key={r.feature}
                                  title={r.feature}
                                  subtitle="Δ score if normalized"
                                  valueLabel={formatProbability(r.delta || 0, 2)}
                                  valuePct={Math.min(1, Math.abs(Number(r.delta || 0)) / 0.25)}
                                  color={Number(r.delta || 0) >= 0 ? pwcColors.errorText : pwcColors.successText}
                                  onClick={() => setSelectedDriver(r.feature)}
                                />
                              ))}
                            </Stack>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardHeader title="Behaviour Narrative Engine" subheader="Numbers translated into investigator sentences" />
            <CardContent>
              {narrative.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No narrative available.</Typography>
              ) : (
                <Stack spacing={1.5}>
                  {Object.entries(
                    narrative.reduce((acc, r) => {
                      const k = String(r.theme || 'Other');
                      if (!acc[k]) acc[k] = [];
                      acc[k].push(r);
                      return acc;
                    }, {})
                  ).map(([theme, items]) => (
                    <Box key={theme}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                        {theme}
                      </Typography>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {items.slice(0, 4).map((b, i) => (
                          <Typography key={`${theme}-${i}`} variant="body2" color="text.secondary">
                            {b.text}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={0}>
            <CardHeader title="Peer Deviation View" subheader="How far the account deviates from similar profiles" />
            <CardContent>
              {peerDev.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No peer deviation available.</Typography>
              ) : (
                <Card variant="outlined">
                  <CardHeader title="Top deviations" subheader="Shown as Low / Medium / High" />
                  <CardContent>
                    <Stack spacing={1}>
                      {peerDevTop.map((r) => (
                        <BarRow
                          key={r.feature}
                          title={r.feature}
                          subtitle={`${r.family || 'other'} · value ${r.value == null ? '-' : formatNumber(r.value, { maxFractionDigits: 2 })} vs peer ${r.peer_mean == null ? '-' : formatNumber(r.peer_mean, { maxFractionDigits: 2 })}`}
                          valueLabel={r.z_level}
                          valuePct={r.pct}
                          color={r.z_level === 'High' ? pwcColors.errorText : r.z_level === 'Medium' ? pwcColors.warningText : pwcColors.successText}
                          onClick={() => setSelectedDriver(r.feature)}
                        />
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card elevation={0}>
            <CardHeader title="Feature Contribution (Upgraded)" subheader="Grouped by risk themes, with sign and peer context" />
            <CardContent>
              {contributions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No contribution data available.</Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Card elevation={0}>
                      <CardHeader title="Contribution Families" />
                      <CardContent sx={{ height: 180 }}>
                        {familyChartData.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No family aggregation available.</Typography>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={familyChartData} layout="vertical" margin={{ left: 24 }}>
                              <XAxis type="number" />
                              <YAxis type="category" dataKey="family" width={110} />
                              <ReTooltip />
                              <Bar dataKey="positive" stackId="a" fill={pwcColors.successText} />
                              <Bar dataKey="negative" stackId="a" fill={pwcColors.errorText} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12}>
                    <Card variant="outlined">
                      <CardHeader title="Top drivers by theme" subheader="Bars show strength and direction" />
                      <CardContent>
                        <Stack spacing={2}>
                          {driverThemes.map(([fam, items]) => (
                            <Box key={fam}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 0.5 }}>
                                {fam}
                              </Typography>
                              <Stack spacing={1}>
                                {items.map((d) => (
                                  <BarRow
                                    key={`${fam}-${d.feature}`}
                                    title={d.feature}
                                    subtitle={d.direction}
                                    valueLabel={d.pct >= 0.67 ? 'High' : d.pct >= 0.34 ? 'Medium' : 'Low'}
                                    valuePct={d.pct}
                                    color={d.impact >= 0 ? pwcColors.errorText : pwcColors.successText}
                                    onClick={() => setSelectedDriver(d.feature)}
                                  />
                                ))}
                              </Stack>
                            </Box>
                          ))}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card elevation={0}>
            <CardHeader title="Temporal + Network Context" subheader="Mule pace + links to risky nodes" />
            <CardContent>
              <Stack spacing={2}>
                <Card elevation={0}>
                  <CardHeader title="Timeline Justification" />
                  <CardContent>
                    {!timeline?.has_results ? (
                      <Typography variant="body2" color="text.secondary">No timeline available.</Typography>
                    ) : (
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Window</TableCell>
                            <TableCell>{timeline.window?.start || '-'} → {timeline.window?.end || '-'}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Inflow</TableCell>
                            <TableCell>
                              {formatInteger(timeline.inflow?.count || 0)} tx · {formatNumber(timeline.inflow?.amount || 0, { maxFractionDigits: 0 })}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Outflow</TableCell>
                            <TableCell>
                              {formatInteger(timeline.outflow?.count || 0)} tx · {formatNumber(timeline.outflow?.amount || 0, { maxFractionDigits: 0 })}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Holding time</TableCell>
                            <TableCell>
                              {timeline.holding_time_hours == null ? '-' : `${formatNumber(timeline.holding_time_hours, { maxFractionDigits: 1 })} h`} · {timeline.fast_exit?.flag ? 'Fast exit: Yes' : 'Fast exit: No'}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Beneficiaries</TableCell>
                            <TableCell>
                              {formatInteger(timeline.beneficiaries?.unique || 0)} · new 7d {timeline.beneficiaries?.new_ratio_7d == null ? '-' : formatPercentFromRatio(timeline.beneficiaries?.new_ratio_7d, 0)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Card elevation={0}>
                  <CardHeader title="Network Context" />
                  <CardContent>
                    {!network?.has_results ? (
                      <Typography variant="body2" color="text.secondary">No network context available.</Typography>
                    ) : (
                      <>
                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>
                            Neighbors: {formatInteger(network.neighbor_count || 0)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            High-risk neighbors: {formatInteger(network.risky_neighbors_high || 0)}
                          </Typography>
                        </Stack>
                        <Divider sx={{ my: 1.5 }} />
                        <Stack spacing={1}>
                          {(network.risky_neighbor_examples || []).slice(0, 8).map((n) => (
                            <BarRow
                              key={n.account_id}
                              title={n.account_id}
                              subtitle="High-risk neighbor"
                              valueLabel={levelFromScore(n.risk_score, thresholds).label}
                              valuePct={clamp01(Number(n.risk_score || 0))}
                              color={pwcColors.errorText}
                              onClick={() => openInvestigation(n.account_id)}
                            />
                          ))}
                        </Stack>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card elevation={0}>
                  <CardHeader title="Driver Drilldown" subheader="Click any driver to inspect" />
                  <CardContent>
                    {!driverDetail ? (
                      <Typography variant="body2" color="text.secondary">Select a driver from contributions or peer deviation.</Typography>
                    ) : (
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Feature</TableCell>
                            <TableCell>{driverDetail.feature}</TableCell>
                          </TableRow>
                          {driverDetail.family ? (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Theme</TableCell>
                              <TableCell>{driverDetail.family}</TableCell>
                            </TableRow>
                          ) : null}
                          {driverDetail.z != null ? (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Deviation</TableCell>
                              <TableCell>{zLevel(driverDetail.z)}</TableCell>
                            </TableRow>
                          ) : null}
                          {driverDetail.impact != null ? (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Impact</TableCell>
                              <TableCell>{formatProbability(driverDetail.impact, 2)}</TableCell>
                            </TableRow>
                          ) : null}
                          {driverDetail.value != null || driverDetail.peer_mean != null ? (
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Value vs peer</TableCell>
                              <TableCell>
                                {driverDetail.value == null ? '-' : formatNumber(driverDetail.value, { maxFractionDigits: 2 })} vs {driverDetail.peer_mean == null ? '-' : formatNumber(driverDetail.peer_mean, { maxFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ExplainabilityScreen;
