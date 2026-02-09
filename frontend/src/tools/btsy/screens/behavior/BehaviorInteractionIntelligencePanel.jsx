import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Alert,
  Grid,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  Button,
  ToggleButtonGroup,
  ToggleButton
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const pct = (v) => `${Number(v || 0).toFixed(2)}%`;

const BehaviorInteractionIntelligencePanel = ({ runId }) => {
  const [overview, setOverview] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [population, setPopulation] = useState(null);
  const [recurring, setRecurring] = useState(null);
  const [entityId, setEntityId] = useState('');
  const [footprint, setFootprint] = useState(null);
  const [error, setError] = useState(null);
  const [matrixView, setMatrixView] = useState('table');

  useEffect(() => {
    const load = async () => {
      if (!runId) return;
      setError(null);
      const [ov, mx, pop, rec] = await Promise.all([
        btsyApi.behavior.getOverlapOverview(runId),
        btsyApi.behavior.getOverlapMatrix(runId),
        btsyApi.behavior.getOverlapPopulation(runId),
        btsyApi.behavior.getOverlapRecurring(runId)
      ]);
      if (ov?.success) setOverview(ov.data);
      if (mx?.success) setMatrix(mx.data);
      if (pop?.success) setPopulation(pop.data);
      if (rec?.success) setRecurring(rec.data);
      if (!ov?.success || !mx?.success || !pop?.success || !rec?.success) {
        setError(ov?.error || mx?.error || pop?.error || rec?.error || 'Failed to load overlap intelligence');
      }
    };
    load();
  }, [runId]);

  const matrixMap = useMemo(() => {
    const m = {};
    if (!matrix?.matrix) return m;
    matrix.matrix.forEach((r) => {
      const key = `${r.run_a}:${r.run_b}`;
      m[key] = r;
      const key2 = `${r.run_b}:${r.run_a}`;
      m[key2] = {
        ...r,
        shared_pct_a: r.shared_pct_b,
        shared_pct_b: r.shared_pct_a
      };
    });
    return m;
  }, [matrix]);

  const isolationText = useMemo(() => {
    const rows = overview?.overview || [];
    if (!rows.length) return 'No overlap data available.';
    const top = rows[0];
    if ((top.shared_pct_this || 0) < 5) {
      return 'This behaviour has limited interaction with others.';
    }
    return 'This behaviour frequently co-exists with multiple signals.';
  }, [overview]);

  const handleFootprint = async () => {
    if (!entityId || !runId) return;
    const res = await btsyApi.behavior.getEntityFootprint(runId, entityId);
    if (res?.success) {
      setFootprint(res.data || null);
    } else {
      setError(res?.error || 'Failed to load entity footprint');
    }
  };

  if (!runId) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Interaction Intelligence</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!overview && !error && <Alert severity="info">Loading interaction intelligence...</Alert>}

      {overview && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Alert severity="info" variant="outlined">
              Entities in this behaviour are also present in other independently computed behaviours. No prioritisation or risk interpretation is applied here. This view is intended to support investigative awareness only.
            </Alert>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Behaviour Overlap Overview</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Other Behaviour</TableCell>
                  <TableCell align="right">Shared Entities</TableCell>
                  <TableCell align="right">% Overlap (This)</TableCell>
                  <TableCell align="right">% Overlap (Other)</TableCell>
                  <TableCell align="right">Shared Periods</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(overview.overview || []).map((r) => (
                  <TableRow key={r.other_run_id}>
                    <TableCell>{r.other_metric_name || `Run ${r.other_run_id}`}</TableCell>
                    <TableCell align="right">{r.shared_entities}</TableCell>
                    <TableCell align="right">{pct(r.shared_pct_this)}</TableCell>
                    <TableCell align="right">{pct(r.shared_pct_other)}</TableCell>
                    <TableCell align="right">{r.shared_periods}</TableCell>
                  </TableRow>
                ))}
                {(!overview.overview || overview.overview.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ color: '#64748b' }}>
                      No overlaps detected.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Isolation vs Connectedness</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{isolationText}</Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Pairwise Matrix</Typography>
              <ToggleButtonGroup size="small" value={matrixView} exclusive onChange={(_, v) => v && setMatrixView(v)}>
                <ToggleButton value="table">Table</ToggleButton>
                <ToggleButton value="heat">Heat</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {matrix?.runs && matrix.runs.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Run</TableCell>
                    {matrix.runs.map((r) => (
                      <TableCell key={r.run_id} align="right">{r.metric_name || `R${r.run_id}`}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {matrix.runs.map((row) => (
                    <TableRow key={row.run_id}>
                      <TableCell>{row.metric_name || `R${row.run_id}`}</TableCell>
                      {matrix.runs.map((col) => {
                        if (row.run_id === col.run_id) {
                          return <TableCell key={col.run_id} align="right">—</TableCell>;
                        }
                        const cell = matrixMap[`${row.run_id}:${col.run_id}`];
                        const value = cell ? cell.shared_entities : 0;
                        const intensity = matrixView === 'heat' ? Math.min(0.8, value / 1000) : 0;
                        return (
                          <TableCell
                            key={col.run_id}
                            align="right"
                            sx={matrixView === 'heat' ? { backgroundColor: `rgba(71,85,105,${intensity})`, color: intensity > 0.4 ? '#fff' : '#111' } : {}}
                          >
                            {value}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" sx={{ color: '#64748b' }}>No matrix data.</Typography>
            )}
          </Paper>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Population Interaction Stats</Typography>
                {population && (
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell>Only here</TableCell>
                        <TableCell>{population.only_here}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>In two</TableCell>
                        <TableCell>{population.in_two}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>In three or more</TableCell>
                        <TableCell>{population.in_three_plus}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Total</TableCell>
                        <TableCell>{population.total}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Recurring Pairs</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Pair</TableCell>
                      <TableCell align="right">Shared</TableCell>
                      <TableCell align="right">% A</TableCell>
                      <TableCell align="right">% B</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(recurring?.pairs || []).map((p, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{`${p.metric_a || `R${p.run_a}`} × ${p.metric_b || `R${p.run_b}`}`}</TableCell>
                        <TableCell align="right">{p.shared_entities}</TableCell>
                        <TableCell align="right">{pct(p.shared_pct_a)}</TableCell>
                        <TableCell align="right">{pct(p.shared_pct_b)}</TableCell>
                      </TableRow>
                    ))}
                    {(!recurring?.pairs || recurring.pairs.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ color: '#64748b' }}>
                          No pairs yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
          </Grid>

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Entity Behaviour Portfolio</Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                label="Entity ID"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              />
              <Button variant="outlined" onClick={handleFootprint}>Load</Button>
            </Box>
            {footprint && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Behaviour</TableCell>
                    <TableCell>Window</TableCell>
                    <TableCell>First Seen</TableCell>
                    <TableCell>Last Seen</TableCell>
                    <TableCell align="right">Active Days</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(footprint.footprint || []).map((r, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{r.metric_name || `R${r.behavior_run_id}`}</TableCell>
                      <TableCell>{r.window || '—'}</TableCell>
                      <TableCell>{r.first_seen || '—'}</TableCell>
                      <TableCell>{r.last_seen || '—'}</TableCell>
                      <TableCell align="right">{r.active_days}</TableCell>
                    </TableRow>
                  ))}
                  {(!footprint.footprint || footprint.footprint.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ color: '#64748b' }}>
                        Entity not found in this universe.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Paper>

          {footprint && (
            <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Time-Aligned Interaction</Typography>
              {(footprint.footprint || []).map((r, idx) => (
                <Box key={idx} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2">{r.metric_name || `R${r.behavior_run_id}`}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {(r.activity_dates || []).slice(0, 50).join(', ')}
                    {(r.activity_dates || []).length > 50 ? ' …' : ''}
                  </Typography>
                </Box>
              ))}
            </Paper>
          )}
        </Box>
      )}
    </Box>
  );
};

export default BehaviorInteractionIntelligencePanel;
