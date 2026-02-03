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
  TextField,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import btsyApi from '../../services/btsyApi';


const AnalystWorkloadSimulationWorkbench = () => {
  const [alertRuns, setAlertRuns] = useState([]);
  const [selectedAlertRunIds, setSelectedAlertRunIds] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [analysts, setAnalysts] = useState('10');
  const [alertsPerAnalyst, setAlertsPerAnalyst] = useState('15');
  const [slaDays, setSlaDays] = useState('3');
  const [run, setRun] = useState(null);
  const [tab, setTab] = useState('daily');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canRun = selectedAlertRunIds.length > 0;

  const chartData = useMemo(() => {
    const rows = run?.daily || [];
    return rows.map((r) => ({
      date: r.date,
      alerts: r.alerts_generated,
      capacity: r.capacity,
      backlog: r.backlog,
    }));
  }, [run]);

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

  const runSimulation = async () => {
    setBusy(true);
    setError('');
    const payloadIds = selectedAlertRunIds.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
    const cfg = {
      analysts: parseInt(analysts, 10),
      alerts_per_analyst: parseInt(alertsPerAnalyst, 10),
      sla_days: parseInt(slaDays, 10),
    };
    const res = await btsyApi.operations.runWorkload(payloadIds, cfg, startDate || null, endDate || null, 'user');
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Failed to run simulation');
      return;
    }
    setRun(res.data);
    setTab('daily');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Analyst Workload Simulation
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Can our analysts realistically handle the alerts we generate?
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Capacity Configuration
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
                label="Analysts available"
                value={analysts}
                onChange={(e) => setAnalysts(e.target.value)}
              />
              <TextField
                size="small"
                label="Avg alerts per analyst per day"
                value={alertsPerAnalyst}
                onChange={(e) => setAlertsPerAnalyst(e.target.value)}
              />
              <TextField
                size="small"
                label="SLA target (days)"
                value={slaDays}
                onChange={(e) => setSlaDays(e.target.value)}
              />

              <Divider />
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
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                These parameters reflect operational assumptions, not system logic.
              </Typography>

              <Button
                variant="contained"
                sx={{ bgcolor: '#0f172a' }}
                disabled={!canRun || busy}
                onClick={runSimulation}
              >
                Run Workload Simulation
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ px: 1 }}>
              <Tab value="daily" label="Alerts per Day" />
              <Tab value="backlog" label="Backlog Projection" />
              <Tab value="contrib" label="Scenario Contribution" />
            </Tabs>
            <Divider />
            <Box sx={{ p: 2 }}>
              {!run && (
                <Alert severity="info">
                  Run simulation to view daily load, capacity, and backlog risk.
                </Alert>
              )}

              {run && tab === 'daily' && (
                <Stack spacing={2}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">Alerts</TableCell>
                        <TableCell align="right">Capacity</TableCell>
                        <TableCell align="right">Excess</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(run.daily || []).map((r) => (
                        <TableRow key={r.date}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell align="right">{r.alerts_generated}</TableCell>
                          <TableCell align="right">{r.capacity}</TableCell>
                          <TableCell align="right">{r.excess}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="alerts" stroke="#D04A02" dot={false} />
                      <Line type="monotone" dataKey="capacity" stroke="#0f172a" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Stack>
              )}

              {run && tab === 'backlog' && (
                <Stack spacing={2}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">New Alerts</TableCell>
                        <TableCell align="right">Capacity</TableCell>
                        <TableCell align="right">Backlog</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(run.daily || []).map((r) => (
                        <TableRow key={r.date}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell align="right">{r.alerts_generated}</TableCell>
                          <TableCell align="right">{r.capacity}</TableCell>
                          <TableCell align="right">{r.backlog}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="backlog" stroke="#D04A02" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Stack>
              )}

              {run && tab === 'contrib' && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Scenario</TableCell>
                      <TableCell align="right">Alerts</TableCell>
                      <TableCell align="right">% Load</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(run.scenario_contrib || []).map((r) => (
                      <TableRow key={r.scenario_ref}>
                        <TableCell>{r.scenario_ref}</TableCell>
                        <TableCell align="right">{r.alerts}</TableCell>
                        <TableCell align="right">{(r.pct_load || 0).toFixed(1)}</TableCell>
                      </TableRow>
                    ))}
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

export default AnalystWorkloadSimulationWorkbench;

