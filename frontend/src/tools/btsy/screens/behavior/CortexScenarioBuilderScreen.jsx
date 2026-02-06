import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  LinearProgress,
  Chip,
  Stack
} from '@mui/material';
import axios from 'axios';
import { useCalibrationRun } from '../../context/CalibrationRunContext';

const API_BASE = '/api/btsy';

const getEnvId = () => sessionStorage.getItem('btsy_env_id') || 'default';
const getHeaders = () => ({ 'X-Environment-ID': getEnvId() });

const defaultConfig = {
  transaction_type: 'DEBIT',
  aggregation_level: 'daily',
  lookback_days: 10
};

const CortexScenarioBuilderScreen = ({ calibrationRunId }) => {
  const [universe, setUniverse] = useState(null);
  const [config, setConfig] = useState(defaultConfig);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [thresholdRows, setThresholdRows] = useState([]);
  const [worstRows, setWorstRows] = useState([]);
  const [monthlyRows, setMonthlyRows] = useState([]);
  const { activeRunLogic } = useCalibrationRun();

  useEffect(() => {
    const loadSelected = async () => {
      try {
        const hintUniverseId = sessionStorage.getItem('btsy_selected_universe_id');
        if (hintUniverseId) {
          const res = await axios.get(
            `${API_BASE}/universe/${hintUniverseId}`,
            { headers: getHeaders() }
          );
          if (res.data?.success) setUniverse(res.data.data);
          return;
        }
        if (calibrationRunId) {
          const res = await axios.get(
            `${API_BASE}/universe/selected?calibration_run_id=${calibrationRunId}`,
            { headers: getHeaders() }
          );
          if (res.data?.success) setUniverse(res.data.data);
        }
      } catch (e) {
        setError('Failed to load selected universe');
      }
    };
    loadSelected();
  }, [calibrationRunId]);

  useEffect(() => {
    if (!activeRunLogic) return;
    setConfig((prev) => ({
      transaction_type: String(activeRunLogic.transaction_type || prev.transaction_type).toUpperCase(),
      aggregation_level: String(activeRunLogic.aggregation_level || prev.aggregation_level).toLowerCase(),
      lookback_days: Number(activeRunLogic.lookback_days ?? prev.lookback_days)
    }));
  }, [activeRunLogic]);

  const runScenario = async () => {
    if (!universe) {
      setError('No universe selected. Create or select a universe first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const payload = {
        universe_id: universe.id,
        config: {
          transaction_type: config.transaction_type,
          aggregation_level: config.aggregation_level,
          lookback_days: parseInt(config.lookback_days, 10)
        },
        created_by: 'user'
      };
      const res = await axios.post(
        `${API_BASE}/cortex/scenario/run`,
        payload,
        { headers: getHeaders() }
      );
      if (!res.data?.success) {
        throw new Error(res.data?.error || 'Scenario run failed');
      }
      const data = res.data.data || {};
      setStats(data.stats || null);
      setThresholdRows(data.threshold_preview || []);
      setWorstRows(data.worst_case_preview || []);
      setMonthlyRows(data.monthly_threshold_preview || []);
    } catch (e) {
      setError(e.message || 'Scenario run failed');
    } finally {
      setLoading(false);
    }
  };

  const runUsingSelectedUniverseForRun = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/cortex/scenario/run-by-run`,
        {
          run_id: (sessionStorage.getItem(`btsy_active_run_id_text:${getEnvId()}`) || ''),
          created_by: 'user',
          config: {
            transaction_type: config.transaction_type,
            aggregation_level: config.aggregation_level,
            lookback_days: parseInt(config.lookback_days, 10)
          }
        },
        { headers: getHeaders() }
      );
      if (res.data?.success) {
        const data = res.data.data || {};
        setStats(data.stats || null);
        setThresholdRows(data.threshold_preview || []);
        setWorstRows(data.worst_case_preview || []);
        setMonthlyRows(data.monthly_threshold_preview || []);
        return;
      }
      // Fallback: load selected universe and run regular scenario
      let sel = null;
      if (calibrationRunId) {
        const g = await axios.get(
          `${API_BASE}/universe/selected?calibration_run_id=${calibrationRunId}`,
          { headers: getHeaders() }
        );
        if (g.data?.success) sel = g.data.data;
      }
      if (!sel && (sessionStorage.getItem(`btsy_active_run_id_text:${getEnvId()}`) || '').trim()) {
        const rid = sessionStorage.getItem(`btsy_active_run_id_text:${getEnvId()}`);
        const g = await axios.get(
          `${API_BASE}/universe/selected?run_id=${encodeURIComponent(String(rid))}`,
          { headers: getHeaders() }
        );
        if (g.data?.success) sel = g.data.data;
      }
      if (!sel) throw new Error('No selected universe found for this run');
      setUniverse(sel);
      const payload = {
        universe_id: sel.id,
        config: {
          transaction_type: config.transaction_type,
          aggregation_level: config.aggregation_level,
          lookback_days: parseInt(config.lookback_days, 10)
        },
        created_by: 'user'
      };
      const r2 = await axios.post(`${API_BASE}/cortex/scenario/run`, payload, { headers: getHeaders() });
      if (!r2.data?.success) throw new Error(r2.data?.error || 'Scenario run failed');
      const data = r2.data.data || {};
      setStats(data.stats || null);
      setThresholdRows(data.threshold_preview || []);
      setWorstRows(data.worst_case_preview || []);
      setMonthlyRows(data.monthly_threshold_preview || []);
    } catch (e) {
      setError(e.message || 'Run-by-run failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Step 2 - Cortex Scenario Builder</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Builds lookback-based thresholds from the frozen transaction universe.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!universe && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Select a universe in Step 1 to proceed.
        </Alert>
      )}

      {universe && (
        <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Selected Universe</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
            <Chip label={universe.universe_name} />
            <Chip label={`Rows: ${(universe.transaction_count || 0).toLocaleString()}`} />
            {universe.unique_accounts && <Chip label={`Accounts: ${universe.unique_accounts}`} />}
          </Stack>
        </Paper>
      )}

      <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Scenario Config</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Transaction Type</InputLabel>
              <Select
                value={config.transaction_type}
                label="Transaction Type"
                onChange={(e) => setConfig({ ...config, transaction_type: e.target.value })}
                disabled={Boolean(activeRunLogic?.locked && activeRunLogic?.transaction_type)}
              >
                <MenuItem value="DEBIT">DEBIT</MenuItem>
                <MenuItem value="CREDIT">CREDIT</MenuItem>
                <MenuItem value="ALL">ALL</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Aggregation Level</InputLabel>
              <Select
                value={config.aggregation_level}
                label="Aggregation Level"
                onChange={(e) => setConfig({ ...config, aggregation_level: e.target.value })}
                disabled={Boolean(activeRunLogic?.locked && activeRunLogic?.aggregation_level)}
              >
                <MenuItem value="daily">daily</MenuItem>
                <MenuItem value="monthly">monthly</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Lookback Days"
              type="number"
              value={config.lookback_days}
              onChange={(e) => setConfig({ ...config, lookback_days: e.target.value })}
              disabled={Boolean(activeRunLogic?.locked && (activeRunLogic?.lookback_days != null))}
            />
          </Grid>
        </Grid>
        <Button
          variant="contained"
          sx={{ bgcolor: '#0f172a', mt: 2 }}
          onClick={runScenario}
          disabled={!universe || loading}
        >
          {loading ? 'Running...' : 'Run Scenario Builder'}
        </Button>
        <Button
          variant="outlined"
          sx={{ ml: 2, mt: 2 }}
          onClick={runUsingSelectedUniverseForRun}
          disabled={loading}
        >
          Use Selected Universe (Active Run)
        </Button>
      </Paper>

      {loading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      {stats && (
        <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Run Stats</Typography>
          <Grid container spacing={1}>
            <Grid item xs={12} md={3}><Chip label={`Input Rows: ${stats.rows_input || 0}`} /></Grid>
            <Grid item xs={12} md={3}><Chip label={`Daily Rows: ${stats.rows_step_daily || 0}`} /></Grid>
            <Grid item xs={12} md={3}><Chip label={`Threshold Rows: ${stats.rows_threshold || 0}`} /></Grid>
            <Grid item xs={12} md={3}><Chip label={`Worst Case Rows: ${stats.rows_worst_case || 0}`} /></Grid>
            {stats.avg_threshold != null && (
              <Grid item xs={12} md={3}><Chip label={`Avg Threshold: ${Number(stats.avg_threshold).toFixed(2)}`} /></Grid>
            )}
            {stats.median_threshold != null && (
              <Grid item xs={12} md={3}><Chip label={`Median Threshold: ${Number(stats.median_threshold).toFixed(2)}`} /></Grid>
            )}
            {stats.max_threshold != null && (
              <Grid item xs={12} md={3}><Chip label={`Max Threshold: ${Number(stats.max_threshold).toFixed(2)}`} /></Grid>
            )}
            {stats.min_threshold != null && (
              <Grid item xs={12} md={3}><Chip label={`Min Threshold: ${Number(stats.min_threshold).toFixed(2)}`} /></Grid>
            )}
          </Grid>
        </Paper>
      )}

      <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Threshold Preview</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>As Of</TableCell>
              <TableCell align="right">Threshold Amt</TableCell>
              <TableCell align="right">Count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {thresholdRows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell sx={{ fontFamily: 'monospace' }}>{row.account_id}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{row.customer_id}</TableCell>
                <TableCell>{row.transaction_datetime}</TableCell>
                <TableCell align="right">{(row.threshold_amt || 0).toLocaleString()}</TableCell>
                <TableCell align="right">{row.trxn_count}</TableCell>
              </TableRow>
            ))}
            {thresholdRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: '#64748b' }}>
                  No rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Worst Case (Top Accounts)</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell align="right">Total Threshold</TableCell>
              <TableCell align="right">Periods</TableCell>
              <TableCell align="right">Total Count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {worstRows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell sx={{ fontFamily: 'monospace' }}>{row.account_id}</TableCell>
                <TableCell align="right">{(row.total_threshold || 0).toLocaleString()}</TableCell>
                <TableCell align="right">{row.count_periods}</TableCell>
                <TableCell align="right">{row.total_trxn_count}</TableCell>
              </TableRow>
            ))}
            {worstRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} sx={{ color: '#64748b' }}>
                  No rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {monthlyRows.length > 0 && (
        <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Monthly Reference Thresholds</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell>Month End</TableCell>
                <TableCell align="right">Threshold Amt</TableCell>
                <TableCell align="right">Count</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {monthlyRows.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{row.account_id}</TableCell>
                  <TableCell>{row.month_last_date}</TableCell>
                  <TableCell align="right">{(row.threshold_amt || 0).toLocaleString()}</TableCell>
                  <TableCell align="right">{row.transaction_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
};

export default CortexScenarioBuilderScreen;
