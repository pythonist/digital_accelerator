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
  LinearProgress
} from '@mui/material';
import axios from 'axios';
import btsyApi from '../../services/btsyApi';
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
  const [runId, setRunId] = useState(null);
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
      setRunId(data.run_id || null);
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

      const runIdText = (sessionStorage.getItem(`btsy_active_run_id_text:${getEnvId()}`) || '').trim();
      let scenarioRunId = null;
      if (runIdText) {
        try {
          const scenarioRes = await axios.post(
            `${API_BASE}/cortex/scenario/run-by-run`,
            {
              run_id: runIdText,
              created_by: 'user',
              config: {
                transaction_type: config.transaction_type,
                aggregation_level: config.aggregation_level,
                lookback_days: parseInt(config.lookback_days, 10)
              }
            },
            { headers: getHeaders() }
          );
          if (scenarioRes.data?.success) {
            const data = scenarioRes.data.data || {};
            scenarioRunId = data.run_id || null;
            setRunId(data.run_id || null);
            setStats(data.stats || null);
            setThresholdRows(data.threshold_preview || []);
            setWorstRows(data.worst_case_preview || []);
            setMonthlyRows(data.monthly_threshold_preview || []);
          }
        } catch {}
      }

      if (!scenarioRunId) {
        const scenarioRes = await axios.post(
          `${API_BASE}/cortex/scenario/run`,
          {
            universe_id: sel.id,
            config: {
              transaction_type: config.transaction_type,
              aggregation_level: config.aggregation_level,
              lookback_days: parseInt(config.lookback_days, 10)
            },
            created_by: 'user'
          },
          { headers: getHeaders() }
        );
        if (!scenarioRes.data?.success) {
          throw new Error(scenarioRes.data?.error || 'Scenario run failed');
        }
        const data = scenarioRes.data.data || {};
        scenarioRunId = data.run_id || null;
        setRunId(data.run_id || null);
        setStats(data.stats || null);
        setThresholdRows(data.threshold_preview || []);
        setWorstRows(data.worst_case_preview || []);
        setMonthlyRows(data.monthly_threshold_preview || []);
      }

      if (scenarioRunId != null) {
        sessionStorage.setItem('btsy_step3_cortex_run_id', String(scenarioRunId));
      }

      const behaviorConfig = {
        entity_level: 'account',
        entity_id_col: 'account_id',
        time_col: 'transaction_datetime',
        metrics: [
          {
            name: 'cash_1d_sum',
            type: 'SUM',
            column: 'transaction_amount',
            window: config.aggregation_level === 'monthly' ? '1M' : '1D'
          }
        ]
      };
      const res = await btsyApi.behavior.createRun(sel.id, behaviorConfig, 'user');
      if (!res?.success) throw new Error(res?.error || 'Failed to create behavior run');
      const behaviorRunId = res.data?.behavior_run_id;
      if (!behaviorRunId) throw new Error('Behavior run id missing');
      sessionStorage.setItem('btsy_step3_behavior_run_id', String(behaviorRunId));
      window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen: 'calibration' } }));
    } catch (e) {
      setError(e.message || 'Run-by-run failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Step 2 — Cortex Scenario Builder</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Builds lookback-based thresholds from the frozen transaction universe.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {!universe && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Select a transaction universe to proceed.
        </Alert>
      )}

      {universe && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Selected Universe</Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>Universe</TableCell>
                <TableCell>{universe.universe_name}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Rows</TableCell>
                <TableCell>{(universe.transaction_count || 0).toLocaleString()}</TableCell>
              </TableRow>
              {universe.unique_accounts && (
                <TableRow>
                  <TableCell>Accounts</TableCell>
                  <TableCell>{universe.unique_accounts}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Scenario Configuration</Typography>
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
          sx={{ mt: 1.5 }}
          onClick={runScenario}
          disabled={!universe || loading}
        >
          {loading ? 'Running...' : 'Run Scenario Builder'}
        </Button>
        <Button
          variant="outlined"
          sx={{ ml: 2, mt: 1.5 }}
          onClick={runUsingSelectedUniverseForRun}
          disabled={loading}
        >
          Use Selected Universe (Active Run)
        </Button>
      </Paper>

      {loading && (
        <Box sx={{ mb: 1.5 }}>
          <LinearProgress />
        </Box>
      )}

      {stats && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Run Statistics</Typography>
          <Grid container spacing={1}>
            <Grid item xs={12}>
              <Table size="small">
                <TableBody>
                  <TableRow><TableCell>Input rows</TableCell><TableCell>{stats.rows_input || 0}</TableCell></TableRow>
                  <TableRow><TableCell>Daily rows</TableCell><TableCell>{stats.rows_step_daily || 0}</TableCell></TableRow>
                  <TableRow><TableCell>Threshold rows</TableCell><TableCell>{stats.rows_threshold || 0}</TableCell></TableRow>
                  <TableRow><TableCell>Worst case rows</TableCell><TableCell>{stats.rows_worst_case || 0}</TableCell></TableRow>
                  {stats.avg_threshold != null && (
                    <TableRow><TableCell>Average threshold</TableCell><TableCell>{Number(stats.avg_threshold).toFixed(2)}</TableCell></TableRow>
                  )}
                  {stats.median_threshold != null && (
                    <TableRow><TableCell>Median threshold</TableCell><TableCell>{Number(stats.median_threshold).toFixed(2)}</TableCell></TableRow>
                  )}
                  {stats.max_threshold != null && (
                    <TableRow><TableCell>Max threshold</TableCell><TableCell>{Number(stats.max_threshold).toFixed(2)}</TableCell></TableRow>
                  )}
                  {stats.min_threshold != null && (
                    <TableRow><TableCell>Min threshold</TableCell><TableCell>{Number(stats.min_threshold).toFixed(2)}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Grid>
          </Grid>
        </Paper>
      )}

      <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Threshold Preview</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>As Of</TableCell>
              <TableCell align="right">Threshold Amt</TableCell>
              <TableCell align="right">Count</TableCell>
              <TableCell align="right">Actions</TableCell>
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
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!runId}
                    onClick={() => {
                      const payload = {
                        behavior_run_id: runId,
                        entity_id: row.account_id,
                        as_of_date: row.transaction_datetime,
                        entity_level: 'account'
                      };
                      sessionStorage.setItem('btsy_behavior_recon_payload', JSON.stringify(payload));
                      window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen: 'behavior_reconstruction' } }));
                    }}
                  >
                    Reconstruct
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {thresholdRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Worst Case (Top Accounts)</Typography>
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
                <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>
                  No rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {monthlyRows.length > 0 && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Monthly Reference Thresholds</Typography>
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
