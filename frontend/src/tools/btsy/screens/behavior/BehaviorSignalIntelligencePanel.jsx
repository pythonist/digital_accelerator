import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Stack
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const formatPct = (v) => `${Number(v || 0).toFixed(2)}%`;

const BehaviorSignalIntelligencePanel = ({ runId }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!runId) return;
      setError(null);
      const res = await btsyApi.behavior.getSignalIntelligence(runId);
      if (res?.success) {
        setData(res.data || null);
      } else {
        setError(res?.error || 'Failed to load signal intelligence');
      }
    };
    load();
  }, [runId]);

  const warnings = data?.noise_warnings || [];
  const compositionKeys = useMemo(() => Object.keys(data?.population_composition || {}), [data]);
  if (!runId) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Signal Intelligence</Typography>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {!data && !error && <Alert severity="info">Loading signal diagnostics.</Alert>}

      {data && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Auto Insights</Typography>
            <Stack spacing={1}>
              {(data.insights || []).map((i, idx) => (
                <Alert key={`${i.type}-${idx}`} severity="info" variant="outlined">{i.text}</Alert>
              ))}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Distribution Nature</Typography>
            <Table size="small" sx={{ mb: 1 }}>
              <TableBody>
                <TableRow>
                  <TableCell>Label</TableCell>
                  <TableCell>{data.distribution_nature?.label || 'n/a'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Gini</TableCell>
                  <TableCell>{Number(data.distribution_nature?.stats?.gini || 0).toFixed(3)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Zero %</TableCell>
                  <TableCell>{formatPct(data.distribution_nature?.stats?.zero_pct)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>P95</TableCell>
                  <TableCell>{Number(data.distribution_nature?.stats?.p95 || 0).toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>P99</TableCell>
                  <TableCell>{Number(data.distribution_nature?.stats?.p99 || 0).toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {data.distribution_nature?.text}
            </Typography>
          </Paper>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Dominance</Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Top 1</TableCell>
                      <TableCell>{formatPct(data.dominance?.top1_pct)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Top 5</TableCell>
                      <TableCell>{formatPct(data.dominance?.top5_pct)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Top 10</TableCell>
                      <TableCell>{formatPct(data.dominance?.top10_pct)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Stability</Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Daily CV</TableCell>
                      <TableCell>{Number(data.stability?.day_cv || 0).toFixed(2)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Monthly CV</TableCell>
                      <TableCell>{Number(data.stability?.month_cv || 0).toFixed(2)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Label</TableCell>
                      <TableCell>{data.stability?.label || 'n/a'}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Activity Pattern</Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>One‑time</TableCell>
                      <TableCell>{formatPct(data.activity_pattern?.one_time_pct)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Repeat</TableCell>
                      <TableCell>{formatPct(data.activity_pattern?.repeat_pct)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Sustained</TableCell>
                      <TableCell>{formatPct(data.activity_pattern?.sustained_pct)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Label</TableCell>
                      <TableCell>{data.activity_pattern?.label || 'n/a'}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Entity Variability</Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Median max/median</TableCell>
                      <TableCell>{Number(data.entity_variability?.median_ratio || 0).toFixed(2)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>P90 max/median</TableCell>
                      <TableCell>{Number(data.entity_variability?.p90_ratio || 0).toFixed(2)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Spikes ≥ 5x</TableCell>
                      <TableCell>{formatPct(data.entity_variability?.spike_pct)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
          </Grid>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Sensitivity Preview</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Percentile</TableCell>
                  <TableCell align="right">Cutoff</TableCell>
                  <TableCell align="right">Entities</TableCell>
                  <TableCell align="right">Entity %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data.sensitivity?.points || []).map((p, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{Math.round(p.percentile * 100)}%</TableCell>
                    <TableCell align="right">{Number(p.cutoff || 0).toLocaleString()}</TableCell>
                    <TableCell align="right">{p.entity_count}</TableCell>
                    <TableCell align="right">{formatPct(p.entity_pct)}</TableCell>
                  </TableRow>
                ))}
                {(!data.sensitivity?.points || data.sensitivity.points.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>
                      No sensitivity data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Noise & Health Indicators</Typography>
            {warnings.length === 0 && <Alert severity="info" variant="outlined">No warnings detected.</Alert>}
            {warnings.length > 0 && (
              <Table size="small">
                <TableBody>
                  {warnings.map((w) => (
                    <TableRow key={w}>
                      <TableCell>{w}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Peak Concentration</Typography>
            <Table size="small" sx={{ mb: 1 }}>
              <TableBody>
                <TableRow>
                  <TableCell>Top 3 mass</TableCell>
                  <TableCell>{formatPct(data.peak_concentration?.top3_mass_pct)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Top 10 mass</TableCell>
                  <TableCell>{formatPct(data.peak_concentration?.top10_mass_pct)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Top Day</TableCell>
                  <TableCell align="right">Total Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data.peak_concentration?.top_days || []).map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{d.day}</TableCell>
                    <TableCell align="right">{Number(d.total_value || 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {(!data.peak_concentration?.top_days || data.peak_concentration.top_days.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={2} sx={{ color: 'text.secondary' }}>
                      No peak concentration data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Population Composition</Typography>
            {compositionKeys.length === 0 && (
              <Alert severity="info" variant="outlined">No composition fields found in snapshot data.</Alert>
            )}
            {compositionKeys.map((key) => (
              <Box key={key} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{key}</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Group</TableCell>
                      <TableCell align="right">Entity %</TableCell>
                      <TableCell align="right">Mass %</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data.population_composition[key] || []).map((r, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{String(r.key)}</TableCell>
                        <TableCell align="right">{formatPct(r.entity_pct)}</TableCell>
                        <TableCell align="right">{formatPct(r.mass_pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Run Drift</Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Previous Run</TableCell>
                  <TableCell>{data.run_drift?.prev_run_id || 'n/a'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>KS vs Previous</TableCell>
                  <TableCell>{data.run_drift?.ks_vs_prev != null ? Number(data.run_drift.ks_vs_prev).toFixed(3) : 'n/a'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Δ Gini</TableCell>
                  <TableCell>{Number(data.run_drift?.delta_gini || 0).toFixed(3)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Δ P95</TableCell>
                  <TableCell>{Number(data.run_drift?.delta_p95 || 0).toFixed(2)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Δ P99</TableCell>
                  <TableCell>{Number(data.run_drift?.delta_p99 || 0).toFixed(2)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Δ Zero %</TableCell>
                  <TableCell>{Number(data.run_drift?.delta_zero_pct || 0).toFixed(2)}%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Δ Top1 %</TableCell>
                  <TableCell>{Number(data.run_drift?.delta_top1_mass_pct || 0).toFixed(2)}%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}
    </Box>
  );
};

export default BehaviorSignalIntelligencePanel;
