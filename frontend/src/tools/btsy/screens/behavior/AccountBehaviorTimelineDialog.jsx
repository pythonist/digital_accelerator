import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Grid,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
} from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts';
import btsyApi from '../../services/btsyApi';
import { getWindowIntent } from './windowIntent';

const colors = ['#D04A02', '#0ea5e9', '#10b981', '#6366f1', '#f59e0b', '#ec4899'];

const AccountBehaviorTimelineDialog = ({
  open,
  onClose,
  entityId,
  runs,
  defaultRunIds = [],
}) => {
  const [selectedRunIds, setSelectedRunIds] = useState(defaultRunIds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [series, setSeries] = useState(null);
  const [tab, setTab] = useState('timeline');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');
  const [txData, setTxData] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedRunIds((prev) => (prev && prev.length > 0 ? prev : defaultRunIds));
  }, [open, defaultRunIds]);

  const selectableRuns = useMemo(() => {
    return (runs || []).map((r) => {
      const metric = r.config?.metrics?.[0];
      const window = metric?.window || '—';
      const intent = getWindowIntent(window);
      const label = `${metric?.name || 'metric'} • ${window}${intent ? ` • ${intent}` : ''}`;
      return {
        id: r.behavior_run_id,
        label,
        window,
        metric_name: metric?.name || 'metric',
      };
    });
  }, [runs]);

  const load = async (runIds) => {
    if (!entityId || !runIds || runIds.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await btsyApi.behavior.entityTimeline(runIds, [entityId], 2000);
      if (!res.success) throw new Error(res.error || 'Failed to load timeline');
      setSeries(res.data?.series || {});
    } catch (e) {
      setError(e.message);
      setSeries(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (!entityId) return;
    if (!selectedRunIds || selectedRunIds.length === 0) return;
    load(selectedRunIds);
  }, [open, entityId, selectedRunIds]);

  const chartData = useMemo(() => {
    if (!series || !entityId) return [];
    const byTs = new Map();
    for (const runId of Object.keys(series)) {
      const ent = series?.[runId]?.[String(entityId)];
      const pts = ent?.points || [];
      for (const p of pts) {
        const t = p.as_of_date || '';
        if (!t) continue;
        const ts = Date.parse(t);
        if (!Number.isFinite(ts)) continue;
        if (!byTs.has(ts)) byTs.set(ts, { ts, as_of_date: t });
        byTs.get(ts)[`run_${runId}`] = (p.metric_value == null ? null : Number(p.metric_value));
      }
    }
    return Array.from(byTs.values()).sort((a, b) => Number(a.ts) - Number(b.ts));
  }, [series, entityId]);

  const selectedRunMeta = useMemo(() => {
    const m = new Map(selectableRuns.map((r) => [String(r.id), r]));
    return (selectedRunIds || []).map((rid) => m.get(String(rid))).filter(Boolean);
  }, [selectableRuns, selectedRunIds]);

  const activeRunIdForTx = useMemo(() => {
    const rid = (selectedRunIds || [])[0];
    return rid ? Number(rid) : null;
  }, [selectedRunIds]);

  useEffect(() => {
    const loadTx = async () => {
      if (!open) return;
      if (tab !== 'transactions') return;
      if (!entityId) return;
      if (!activeRunIdForTx) return;
      setTxLoading(true);
      setTxError('');
      try {
        const res = await btsyApi.behavior.accountTransactions(activeRunIdForTx, entityId, lookbackDays, 200, 0);
        if (!res.success) throw new Error(res.error || 'Failed to load transactions');
        setTxData(res.data);
      } catch (e) {
        setTxError(e.message);
        setTxData(null);
      } finally {
        setTxLoading(false);
      }
    };
    loadTx();
  }, [open, tab, entityId, activeRunIdForTx, lookbackDays]);

  const dailyChart = useMemo(() => {
    const rows = txData?.daily || [];
    return rows.map((r) => ({
      day: r.day,
      txn_count: Number(r.txn_count ?? 0),
      total_amount: Number(r.total_amount ?? 0),
    }));
  }, [txData]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>
            View Behaviour Timeline
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Account: <Box component="span" sx={{ fontFamily: 'monospace' }}>{entityId || '—'}</Box>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip label="Exploration only" variant="outlined" />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          This step focuses on behaviour exploration. Alerts and scenario execution frequency are configured in later steps.
        </Alert>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 360 }}>
            <InputLabel>Windows</InputLabel>
            <Select
              multiple
              value={selectedRunIds}
              label="Windows"
              onChange={(e) => setSelectedRunIds(e.target.value)}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {selected.map((rid) => {
                    const meta = selectableRuns.find((r) => String(r.id) === String(rid));
                    return <Chip key={String(rid)} size="small" label={meta?.label || `Run ${rid}`} />;
                  })}
                </Box>
              )}
            >
              {selectableRuns.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ flex: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {selectedRunMeta.map((m, idx) => (
              <Chip key={String(m.id)} label={`${m.window}${getWindowIntent(m.window) ? ` • ${getWindowIntent(m.window)}` : ''}`} sx={{ borderRadius: 1 }} />
            ))}
          </Box>
        </Stack>

        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="timeline" label="Timeline" />
          <Tab value="transactions" label="Transactions" />
        </Tabs>

        {error && tab === 'timeline' && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {tab === 'timeline' && loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6, gap: 2 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading timeline…</Typography>
          </Box>
        )}

        {tab === 'timeline' && !loading && !error && chartData.length === 0 && (
          <Alert severity="warning" variant="outlined">
            No timeline data found for this account and selection.
          </Alert>
        )}

        {tab === 'timeline' && !loading && !error && chartData.length > 0 && (
          <Box sx={{ width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 11 }}
                  stroke="#64748b"
                  tickFormatter={(v) => new Date(v).toLocaleDateString()}
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => Number(v || 0).toLocaleString()} />
                <Tooltip
                  labelFormatter={(v) => new Date(v).toLocaleString()}
                  formatter={(v) => [Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }), 'Behaviour Value']}
                />
                <Legend />
                {selectedRunIds.map((rid, idx) => {
                  const meta = selectableRuns.find((r) => String(r.id) === String(rid));
                  return (
                    <Line
                      key={String(rid)}
                      type="monotone"
                      dataKey={`run_${rid}`}
                      stroke={colors[idx % colors.length]}
                      strokeWidth={2}
                      dot={false}
                      name={meta?.label || `Run ${rid}`}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}

        {tab === 'transactions' && (
          <>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Lookback</InputLabel>
                <Select value={lookbackDays} label="Lookback" onChange={(e) => setLookbackDays(Number(e.target.value))}>
                  <MenuItem value={7}>Last 7 days</MenuItem>
                  <MenuItem value={14}>Last 14 days</MenuItem>
                  <MenuItem value={30}>Last 30 days</MenuItem>
                  <MenuItem value={90}>Last 90 days</MenuItem>
                  <MenuItem value={365}>Last 365 days</MenuItem>
                </Select>
              </FormControl>
              {txData?.summary?.total_txns != null && (
                <Chip variant="outlined" label={`Transactions: ${Number(txData.summary.total_txns).toLocaleString()}`} />
              )}
              {txData?.summary?.active_days != null && (
                <Chip variant="outlined" label={`Active days: ${Number(txData.summary.active_days).toLocaleString()}`} />
              )}
              {txData?.summary?.total_amount != null && (
                <Chip variant="outlined" label={`Total amount: ${Number(txData.summary.total_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
              )}
              {txData?.summary?.midnight_pct != null && (
                <Chip variant="outlined" label={`Midnight %: ${Number(txData.summary.midnight_pct).toFixed(1)}%`} />
              )}
            </Box>

            {txError && <Alert severity="error" sx={{ mb: 2 }}>{txError}</Alert>}
            {txLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, gap: 2 }}>
                <CircularProgress size={24} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading transactions…</Typography>
              </Box>
            )}

            {!txLoading && !txError && dailyChart.length > 0 && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Transaction Count per Day</Typography>
                  <Box sx={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748b" minTickGap={24} />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                        <Tooltip />
                        <Bar dataKey="txn_count" fill="#0ea5e9" opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Transaction Amount per Day</Typography>
                  <Box sx={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748b" minTickGap={24} />
                        <YAxis tick={{ fontSize: 11 }} stroke="#64748b" tickFormatter={(v) => Number(v || 0).toLocaleString()} />
                        <Tooltip formatter={(v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                        <Bar dataKey="total_amount" fill="#D04A02" opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
              </Grid>
            )}

            {!txLoading && !txError && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Transaction History</Typography>
                <TableContainer sx={{ maxHeight: 320, border: '1px solid #e2e8f0' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {Object.keys((txData?.transactions || [])[0] || {}).slice(0, 8).map((k) => (
                          <TableCell key={k}>{k}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(txData?.transactions || []).map((row, idx) => (
                        <TableRow key={idx} hover>
                          {Object.keys((txData?.transactions || [])[0] || {}).slice(0, 8).map((k) => (
                            <TableCell key={k}>{row?.[k] == null ? '—' : String(row[k])}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                      {(txData?.transactions || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ color: 'text.secondary' }}>
                            No transactions found for this lookback.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="outlined" sx={{ textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AccountBehaviorTimelineDialog;
