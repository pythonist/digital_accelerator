import React, { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography, Grid, ToggleButton, ToggleButtonGroup, LinearProgress, Button, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, TableContainer } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import btsyApi from '../../services/btsyApi';

const BehaviorQualityPanel = ({ runId }) => {
  const [quality, setQuality] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [scale, setScale] = useState('linear');
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!runId) return;
      const res = await btsyApi.behavior.getQuality(runId);
      if (res.success) setQuality(res.data);
    };
    load();
  }, [runId]);

  useEffect(() => {
    const loadEvidence = async () => {
      if (!runId) return;
      const res = await btsyApi.behavior.getEvidence(runId);
      if (res.success) setEvidence(res.data);
    };
    loadEvidence();
  }, [runId]);

  const heatmap = quality?.heatmap || [];
  const histData = (quality?.histogram || []).map(d => ({ bucket: d.bucket, count: d.count }));
  const maxIntensity = useMemo(() => {
    if (!heatmap.length) return 0;
    return heatmap.reduce((m, c) => Math.max(m, c.intensity || 0), 0);
  }, [heatmap]);

  const heatmapDays = useMemo(() => {
    const set = new Set();
    heatmap.forEach(c => set.add(c.day));
    return Array.from(set).sort();
  }, [heatmap]);

  const heatmapSufficient = useMemo(() => {
    const totalEntities = quality?.coverage?.total_entities || 0;
    const dates = heatmapDays.length;
    const minEntities = 50;
    const minDates = 10;
    if (totalEntities < minEntities || dates < minDates) return false;
    if (heatmap.length < 160) return false;
    return true;
  }, [quality?.coverage?.total_entities, heatmapDays.length, heatmap.length]);

  const insightsByType = useMemo(() => {
    const map = {};
    (evidence?.insights || []).forEach((i) => { map[i.type] = i.text; });
    return map;
  }, [evidence]);

  const distStats = evidence?.snapshots?.distribution_stats?.data || null;
  const coverageStats = evidence?.snapshots?.coverage_stats?.data || null;
  const heatmapStats = evidence?.snapshots?.heatmap_stats?.data || null;
  const diagnostics = evidence?.diagnostics || null;

  const integrityStatus = useMemo(() => {
    if (!diagnostics) return null;
    const nullPct = diagnostics.null_pct || 0;
    const negPct = diagnostics.negative_pct || 0;
    if (nullPct === 0 && negPct === 0) return 'PASSED';
    return 'WARNING';
  }, [diagnostics]);

  if (!runId) return null;
  if (!quality) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Quality Diagnostics</Typography>
      {diagnostics && (
        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Decision Summary</Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>Integrity</TableCell>
                <TableCell>{integrityStatus}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Null %</TableCell>
                <TableCell>{diagnostics.null_pct.toFixed(2)}%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Zero %</TableCell>
                <TableCell>{diagnostics.zero_pct.toFixed(2)}%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Negative %</TableCell>
                <TableCell>{diagnostics.negative_pct.toFixed(2)}%</TableCell>
              </TableRow>
              {diagnostics.ks_vs_prev !== null && diagnostics.ks_vs_prev !== undefined && (
                <TableRow>
                  <TableCell>KS vs Previous</TableCell>
                  <TableCell>{diagnostics.ks_vs_prev.toFixed(3)}</TableCell>
                </TableRow>
              )}
              {diagnostics.coverage_delta_pct !== null && diagnostics.coverage_delta_pct !== undefined && (
                <TableRow>
                  <TableCell>Coverage Δ</TableCell>
                  <TableCell>{diagnostics.coverage_delta_pct.toFixed(2)}%</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>Reusability</TableCell>
                <TableCell>{`${diagnostics.reusability_label} (${diagnostics.reusability_score.toFixed(0)})`}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {insightsByType.lineage && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
              {insightsByType.lineage}
            </Typography>
          )}
        </Paper>
      )}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Distribution Diagnostics</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button size="small" onClick={() => setExpanded('distribution')}>Expand</Button>
                <ToggleButtonGroup
                  size="small"
                  value={scale}
                  exclusive
                  onChange={(_, v) => v && setScale(v)}
                >
                  <ToggleButton value="linear">Linear</ToggleButton>
                  <ToggleButton value="log">Log</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              Shows the spread and tail‑heaviness of the metric values for this run.
            </Typography>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={histData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" scale={scale === 'log' ? 'log' : 'linear'} />
                <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="count" radius={[0,0,0,0]} onClick={(d) => setSelectedBucket(d)}>
                  {histData.map((_, idx) => (<Cell key={idx} fill="#475569" />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {selectedBucket?.payload && (
              <Box sx={{ mt: 1, color: 'text.secondary' }}>
                Selected bucket: {selectedBucket.payload.bucket} | count: {selectedBucket.payload.count}
              </Box>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Entity Coverage</Typography>
              <Button size="small" onClick={() => setExpanded('coverage')}>Expand</Button>
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              Shows how many entities have non‑zero activity and repeat behaviour.
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Non‑zero entities</TableCell>
                  <TableCell>{quality.coverage.nz_entities}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Single observation</TableCell>
                  <TableCell>{quality.coverage.single_obs}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Repeated observation</TableCell>
                  <TableCell>{quality.coverage.repeated_obs}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Total entities</TableCell>
                  <TableCell>{quality.coverage.total_entities}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption">Coverage</Typography>
              <LinearProgress variant="determinate" value={quality.coverage.total_entities ? (quality.coverage.nz_entities / quality.coverage.total_entities) * 100 : 0} />
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Time Density Matrix</Typography>
              <Button size="small" onClick={() => setExpanded('heatmap')}>Expand</Button>
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              Each cell is a time bucket × entity bucket with average metric intensity.
            </Typography>
            {!heatmapSufficient ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Insufficient density at this granularity.
              </Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(32, 1fr)', gap: 1 }}>
                {(quality.heatmap || []).slice(0, 32*30).map((cell, idx) => (
                  <Box
                    key={idx}
                    title={`${cell.day} | bucket ${cell.bucket} | intensity ${cell.intensity.toFixed(2)}`}
                    onClick={() => setSelectedCell(cell)}
                    sx={{
                    height: 12,
                    bgcolor: maxIntensity === 0 ? '#e2e8f0' : `rgba(71, 85, 105, ${Math.max(0.12, cell.intensity / maxIntensity)})`
                  }} />
                ))}
              </Box>
            )}
            {selectedCell && (
              <Box sx={{ mt: 1, color: 'text.secondary' }}>
                Selected cell: {selectedCell.day} | bucket {selectedCell.bucket} | intensity {selectedCell.intensity.toFixed(2)}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={!!expanded} onClose={() => setExpanded(null)} fullWidth maxWidth="md">
        <DialogTitle>
          {expanded === 'distribution' && 'Metric Distribution — Evidence'}
          {expanded === 'coverage' && 'Entity Coverage — Evidence'}
          {expanded === 'heatmap' && 'Time Density Heatmap — Evidence'}
        </DialogTitle>
        <DialogContent dividers>
          {expanded === 'distribution' && (
            <>
              {distStats ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell align="right">Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow><TableCell>count</TableCell><TableCell align="right">{distStats.count?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>min</TableCell><TableCell align="right">{distStats.min?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>max</TableCell><TableCell align="right">{distStats.max?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>mean</TableCell><TableCell align="right">{distStats.mean?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>median</TableCell><TableCell align="right">{distStats.median?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>p90</TableCell><TableCell align="right">{distStats.p90?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>p95</TableCell><TableCell align="right">{distStats.p95?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>p99</TableCell><TableCell align="right">{distStats.p99?.toLocaleString()}</TableCell></TableRow>
                      <TableRow><TableCell>% zeros</TableCell><TableCell align="right">{(distStats.zero_pct || 0).toFixed(2)}%</TableCell></TableRow>
                      <TableRow><TableCell>% mass in top 1%</TableCell><TableCell align="right">{distStats.tail?.top1_mass_pct !== null && distStats.tail?.top1_mass_pct !== undefined ? `${distStats.tail.top1_mass_pct.toFixed(2)}%` : '—'}</TableCell></TableRow>
                      <TableRow><TableCell>% mass in top 5%</TableCell><TableCell align="right">{distStats.tail?.top5_mass_pct !== null && distStats.tail?.top5_mass_pct !== undefined ? `${distStats.tail.top5_mass_pct.toFixed(2)}%` : '—'}</TableCell></TableRow>
                      <TableRow><TableCell>Gini</TableCell><TableCell align="right">{distStats.gini !== null && distStats.gini !== undefined ? distStats.gini.toFixed(3) : '—'}</TableCell></TableRow>
                      <TableRow><TableCell>KS vs prev</TableCell><TableCell align="right">{distStats.ks_vs_prev !== null && distStats.ks_vs_prev !== undefined ? distStats.ks_vs_prev.toFixed(3) : '—'}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: '#64748b' }}>Evidence not available.</Typography>
              )}
              {insightsByType.distribution && (
                <Typography variant="body2" sx={{ mt: 2, color: '#475569' }}>
                  {insightsByType.distribution}
                </Typography>
              )}
            </>
          )}

          {expanded === 'coverage' && (
            <>
              {coverageStats ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Category</TableCell>
                        <TableCell align="right">Count</TableCell>
                        <TableCell align="right">%</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[
                        { label: 'Entities with ≥1 value', key: 'nz_entities' },
                        { label: 'Single observation', key: 'single_obs' },
                        { label: 'Repeated observations', key: 'repeated_obs' },
                        { label: 'Total entities', key: 'total_entities' }
                      ].map((row) => {
                        const total = coverageStats.total_entities || 0;
                        const count = coverageStats[row.key] || 0;
                        const pct = total ? (count / total) * 100 : 0;
                        return (
                          <TableRow key={row.key}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell align="right">{count.toLocaleString()}</TableCell>
                            <TableCell align="right">{row.key === 'total_entities' ? '100.00%' : `${pct.toFixed(2)}%`}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: '#64748b' }}>Evidence not available.</Typography>
              )}
              {insightsByType.coverage && (
                <Typography variant="body2" sx={{ mt: 2, color: '#475569' }}>
                  {insightsByType.coverage}
                </Typography>
              )}
            </>
          )}

          {expanded === 'heatmap' && (
            <>
              <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                Heatmap based on {quality.coverage.total_entities.toLocaleString()} entities × {heatmapDays.length.toLocaleString()} dates
              </Typography>
              {!heatmapSufficient && (
                <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
                  Insufficient density for heatmap at this granularity
                </Typography>
              )}
              {heatmapStats ? (
                <>
                  <TableContainer sx={{ mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Metric</TableCell>
                          <TableCell align="right">Value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow><TableCell>% volume in top 3 days</TableCell><TableCell align="right">{heatmapStats.top3_mass_pct !== null && heatmapStats.top3_mass_pct !== undefined ? `${heatmapStats.top3_mass_pct.toFixed(2)}%` : '—'}</TableCell></TableRow>
                        <TableRow><TableCell>% volume in top 10 days</TableCell><TableCell align="right">{heatmapStats.top10_mass_pct !== null && heatmapStats.top10_mass_pct !== undefined ? `${heatmapStats.top10_mass_pct.toFixed(2)}%` : '—'}</TableCell></TableRow>
                        <TableRow><TableCell>Weekday mass</TableCell><TableCell align="right">{heatmapStats.weekday_vs_weekend?.weekday_mass?.toLocaleString?.() || heatmapStats.weekday_vs_weekend?.weekday_mass || '—'}</TableCell></TableRow>
                        <TableRow><TableCell>Weekend mass</TableCell><TableCell align="right">{heatmapStats.weekday_vs_weekend?.weekend_mass?.toLocaleString?.() || heatmapStats.weekday_vs_weekend?.weekend_mass || '—'}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  {Array.isArray(heatmapStats.top_days) && heatmapStats.top_days.length > 0 && (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Top Dates by Total Value</TableCell>
                            <TableCell align="right">Total</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {heatmapStats.top_days.map((d) => (
                            <TableRow key={d.day}>
                              <TableCell>{d.day}</TableCell>
                              <TableCell align="right">{(d.total_value || 0).toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              ) : (
                <Typography variant="body2" sx={{ color: '#64748b' }}>Evidence not available.</Typography>
              )}
              {insightsByType.time_density && (
                <Typography variant="body2" sx={{ mt: 2, color: '#475569' }}>
                  {insightsByType.time_density}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExpanded(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BehaviorQualityPanel;
