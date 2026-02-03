import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Alert,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  Chip,
  TextField,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';
import btsyApi from '../../services/btsyApi';


const ScenarioInteractionAnalysisWorkbench = () => {
  const [alertRuns, setAlertRuns] = useState([]);
  const [selectedAlertRunIds, setSelectedAlertRunIds] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [run, setRun] = useState(null);
  const [tab, setTab] = useState('overlap');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const availableScenarios = useMemo(() => {
    const byId = new Map();
    (alertRuns || []).forEach((r) => {
      byId.set(String(r.alert_run_id), r);
    });
    const selected = (selectedAlertRunIds || []).map((id) => byId.get(String(id))).filter(Boolean);
    const scenarios = Array.from(new Set(selected.map((r) => r.scenario_ref || `AlertRun-${r.alert_run_id}`)));
    return { selected, scenarios };
  }, [alertRuns, selectedAlertRunIds]);

  const canRun = selectedAlertRunIds.length > 0;

  const loadAlertRuns = async () => {
    const res = await btsyApi.operations.listAlertRuns(200);
    if (res.success) {
      setAlertRuns(res.data || []);
      const first = (res.data || [])[0];
      if (first) setSelectedAlertRunIds([String(first.alert_run_id)]);
    }
  };

  useEffect(() => {
    loadAlertRuns();
  }, []);

  const runAnalysis = async () => {
    setBusy(true);
    setError('');
    const payloadIds = selectedAlertRunIds.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
    const res = await btsyApi.operations.runScenarioInteraction(payloadIds, startDate || null, endDate || null, 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to run analysis');
      return;
    }
    setRun(res.data);
    setTab('overlap');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Scenario Interaction Analysis
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Are multiple scenarios creating duplicate effort without increasing coverage?
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Context Lock
              </Typography>

              {alertRuns.length === 0 && (
                <Alert severity="warning">
                  Step-4 alerts required. Run Eligibility & Alert Generation first.
                </Alert>
              )}

              <FormControl fullWidth size="small" disabled={alertRuns.length === 0}>
                <InputLabel>Alert Generation Runs</InputLabel>
                <Select
                  multiple
                  value={selectedAlertRunIds}
                  label="Alert Generation Runs"
                  onChange={(e) => setSelectedAlertRunIds(e.target.value)}
                  renderValue={(selected) => `${selected.length} selected`}
                >
                  {alertRuns.map((r) => (
                    <MenuItem key={r.alert_run_id} value={String(r.alert_run_id)}>
                      {`${r.scenario_ref || 'scenario'} • AlertRun ${r.alert_run_id} • ${r.created_at}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Start date (YYYY-MM-DD)"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <TextField
                size="small"
                label="End date (YYYY-MM-DD)"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />

              <Divider />
              <Stack spacing={1}>
                <Chip label={`Granularity: ${(availableScenarios.selected[0]?.entity_level || 'account').toLowerCase()}`} />
                <Chip label={`Scenarios: ${availableScenarios.scenarios.length}`} />
              </Stack>

              <Divider />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                This analysis evaluates interaction and overlap between scenarios. It does not alter alerts or scenario logic.
              </Typography>

              <Button
                variant="contained"
                sx={{ bgcolor: '#0f172a' }}
                disabled={!canRun || busy}
                onClick={runAnalysis}
              >
                Run Interaction Analysis
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 1 }}>
              <Tab value="overlap" label="Overlap Matrix" />
              <Tab value="redundancy" label="Redundancy Lens" />
              <Tab value="fatigue" label="Fatigue Simulator" />
            </Tabs>
            <Divider />
            <Box sx={{ p: 2 }}>
              {!run && (
                <Alert severity="info">
                  Run analysis to compute scenario overlap and redundancy.
                </Alert>
              )}

              {run && tab === 'overlap' && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Scenario A</TableCell>
                      <TableCell>Scenario B</TableCell>
                      <TableCell align="right">Overlap %</TableCell>
                      <TableCell align="right">Overlap</TableCell>
                      <TableCell align="right">Unique A</TableCell>
                      <TableCell align="right">Unique B</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(run.overlap_matrix || []).map((r) => (
                      <TableRow key={`${r.scenario_a}-${r.scenario_b}`}>
                        <TableCell>{r.scenario_a}</TableCell>
                        <TableCell>{r.scenario_b}</TableCell>
                        <TableCell align="right">{(r.overlap_pct || 0).toFixed(1)}</TableCell>
                        <TableCell align="right">{r.overlap_count}</TableCell>
                        <TableCell align="right">{r.unique_a}</TableCell>
                        <TableCell align="right">{r.unique_b}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {run && tab === 'redundancy' && (
                <>
                  {(run.redundancy_flags || []).length === 0 && (
                    <Alert severity="info">
                      No redundancy flags met the configured thresholds for this run.
                    </Alert>
                  )}
                  {(run.redundancy_flags || []).length > 0 && (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Scenario</TableCell>
                          <TableCell>Overlap With</TableCell>
                          <TableCell>Redundancy</TableCell>
                          <TableCell>Rationale</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(run.redundancy_flags || []).map((r) => (
                          <TableRow key={`${r.scenario_a}-${r.scenario_b}`}>
                            <TableCell>{r.scenario_a}</TableCell>
                            <TableCell>{r.scenario_b}</TableCell>
                            <TableCell>{r.redundancy_level}</TableCell>
                            <TableCell>{r.rationale_text}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}

              {run && tab === 'fatigue' && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell align="right">Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell>Original alerts</TableCell>
                      <TableCell align="right">{run.fatigue_simulation?.original_alerts ?? 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Suppressed duplicates (simulation)</TableCell>
                      <TableCell align="right">{run.fatigue_simulation?.suppressed_alerts ?? 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Reduced alerts</TableCell>
                      <TableCell align="right">{run.fatigue_simulation?.reduced_alerts ?? 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Reduction %</TableCell>
                      <TableCell align="right">{(run.fatigue_simulation?.reduction_pct ?? 0).toFixed(1)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ScenarioInteractionAnalysisWorkbench;

