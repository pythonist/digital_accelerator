import React, { useMemo, useState } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Button, 
  Box, 
  Typography, 
  Grid, 
  Paper,
  Divider,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField
} from '@mui/material';
import { 
  BarChart as BarChartIcon,
  AccountBalance as AccountBalanceIcon,
  TrendingUp as TrendingUpIcon,
  DateRange as DateRangeIcon
} from '@mui/icons-material';
import btsyApi from '../../../../services/btsyApi';

const StatCard = ({ icon: Icon, label, value, color = '#334155' }) => (
  <Paper 
    sx={{ 
      p: 2, 
      border: '1px solid #e2e8f0', 
      borderRadius: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 2
    }}
  >
    <Box 
      sx={{ 
        width: 48, 
        height: 48, 
        borderRadius: 1, 
        bgcolor: `${color}12`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Icon sx={{ color, fontSize: 24 }} />
    </Box>
    <Box sx={{ flex: 1 }}>
      <Typography variant="body2" sx={{ color: '#64748b', fontSize: '0.75rem', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e293b' }}>
        {value}
      </Typography>
    </Box>
  </Paper>
);

const UniverseDashboardPanel = ({ stats, onClose }) => {
  if (!stats) return null;
  const universeId = stats.universe_id ?? stats.universeId ?? stats.id ?? null;
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [thresholdLoading, setThresholdLoading] = useState(false);
  const [thresholdError, setThresholdError] = useState(null);
  const [thresholdData, setThresholdData] = useState(null);
  const [thresholdCompareData, setThresholdCompareData] = useState(null);
  const [thresholdConfig, setThresholdConfig] = useState({
    transaction_type: 'ALL',
    schedule: 'daily',
    aggregation_level: 'daily',
    lookback_days: 10,
    account_id: ''
  });
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareLookbackDays, setCompareLookbackDays] = useState(7);

  const formatNumber = (num, digits = 0) => {
    if (num === null || num === undefined) return '—';
    const n = Number(num);
    if (!Number.isFinite(n)) return String(num);
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  };

  const formatAmount = (num) => formatNumber(num, 2);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };

  const totalTx = stats.total_transactions ?? stats.transaction_count;
  const uniqueEntities = stats.unique_accounts ?? stats.unique_entities;
  const dateStart = stats.date_range?.min_date ?? stats.date_range_start;
  const dateEnd = stats.date_range?.max_date ?? stats.date_range_end;
  const amountMin = stats.amount_range?.min ?? stats.min_amount;
  const amountMax = stats.amount_range?.max ?? stats.max_amount;
  const amountAvg = stats.amount_range?.avg ?? stats.avg_amount;
  const amountMedian = stats.amount_range?.median ?? stats.median_amount;
  const coveragePct = stats.coverage_percentage ?? stats.coverage_pct;

  const categoryDist = stats.category_distribution || {};
  const topCategories = Object.entries(categoryDist).slice(0, 10);
  const catMax = topCategories.length ? Math.max(...topCategories.map(([, c]) => Number(c) || 0)) : 0;

  const topAccounts = stats.top_accounts?.by_amount || [];
  const topTxns = stats.top_transactions || [];
  const percentiles = stats.amount_percentiles || {};

  const thresholdSummary = useMemo(() => {
    if (!thresholdData) return null;
    const s = thresholdData.statistics || {};
    return {
      uniqueAccounts: s.unique_accounts,
      totalPeriods: s.total_periods,
      avg: s.avg_threshold,
      median: s.median_threshold,
      max: s.max_threshold,
      min: s.min_threshold,
      std: s.std_threshold
    };
  }, [thresholdData]);

  const runThresholds = async () => {
    if (!universeId) return;
    try {
      setThresholdError(null);
      setThresholdLoading(true);
      const accountId = String(thresholdConfig.account_id || '').trim();
      const basePayload = {
        transaction_type: thresholdConfig.transaction_type,
        schedule: thresholdConfig.schedule,
        aggregation_level: thresholdConfig.aggregation_level,
        lookback_days: Number(thresholdConfig.lookback_days),
        account_id: accountId || undefined,
        limit_threshold_rows: 200,
        limit_monthly_rows: 200
      };

      if (compareEnabled) {
        if (!accountId) {
          setThresholdError('Account ID is required for comparison');
          setThresholdData(null);
          setThresholdCompareData(null);
          return;
        }

        const [resA, resB] = await Promise.all([
          btsyApi.universe.computeThresholds(universeId, basePayload),
          btsyApi.universe.computeThresholds(universeId, {
            ...basePayload,
            lookback_days: Number(compareLookbackDays)
          })
        ]);

        if (resA?.success && resB?.success) {
          setThresholdData(resA.data);
          setThresholdCompareData(resB.data);
        } else {
          setThresholdError(resA?.error || resB?.error || 'Failed to compute thresholds');
        }
      } else {
        const res = await btsyApi.universe.computeThresholds(universeId, basePayload);
        if (res?.success) {
          setThresholdData(res.data);
          setThresholdCompareData(null);
        } else {
          setThresholdError(res?.error || 'Failed to compute thresholds');
        }
      }
    } catch (e) {
      setThresholdError(e?.response?.data?.error || e?.message || 'Failed to compute thresholds');
    } finally {
      setThresholdLoading(false);
    }
  };

  return (
    <Dialog 
      open={true} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 0 }
      }}
    >
      <DialogTitle sx={{ bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Universe Statistics
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
          {stats.universe_name || 'Transaction Universe Overview'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
            Overview
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <StatCard
                icon={BarChartIcon}
                label="Total Transactions"
                value={formatNumber(totalTx)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <StatCard
                icon={AccountBalanceIcon}
                label="Unique Entities"
                value={formatNumber(uniqueEntities)}
              />
            </Grid>
            <Grid item xs={12}>
              <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Coverage
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569' }}>
                    {coveragePct === null || coveragePct === undefined ? '—' : `${formatNumber(coveragePct, 2)}%`}
                  </Typography>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, Number(coveragePct || 0)))} />
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </Box>

        {(dateStart || dateEnd) && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Time Period
            </Typography>
            <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <DateRangeIcon sx={{ color: '#64748b', fontSize: 20 }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Date Range
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                {formatDate(dateStart)} → {formatDate(dateEnd)}
              </Typography>
            </Paper>
          </Box>
        )}

        {(amountMin !== undefined || amountMax !== undefined || amountAvg !== undefined) && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Amount Summary
            </Typography>
            <Grid container spacing={2}>
              {amountAvg !== undefined && (
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Average Amount
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                      {formatAmount(amountAvg)}
                    </Typography>
                  </Paper>
                </Grid>
              )}
              {amountMedian !== undefined && (
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Median Amount
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatAmount(amountMedian)}
                    </Typography>
                  </Paper>
                </Grid>
              )}
              {amountMax !== undefined && (
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Maximum Amount
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatAmount(amountMax)}
                    </Typography>
                  </Paper>
                </Grid>
              )}
              {amountMin !== undefined && (
                <Grid item xs={12} sm={6}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Minimum Amount
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatAmount(amountMin)}
                    </Typography>
                  </Paper>
                </Grid>
              )}
            </Grid>
          </Box>
        )}

        {Object.keys(percentiles || {}).length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Amount Percentiles
            </Typography>
            <Grid container spacing={2}>
              {['p50', 'p90', 'p95', 'p97', 'p99'].map((k) => (
                <Grid item xs={12} sm={4} md={2.4} key={k}>
                  <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b' }}>{k.toUpperCase()}</Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {formatAmount(percentiles[k])}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {topCategories.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Category Distribution (Top)
            </Typography>
            <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Stack spacing={1.25}>
                {topCategories.map(([k, c]) => (
                  <Box key={k}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{k}</Typography>
                      <Typography variant="body2" sx={{ color: '#475569' }}>{formatNumber(c)}</Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={catMax ? (Number(c) / catMax) * 100 : 0}
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Box>
        )}

        {topAccounts.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Top Accounts (by Amount)
            </Typography>
            <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Account</TableCell>
                    <TableCell align="right">Txns</TableCell>
                    <TableCell align="right">Total Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {topAccounts.slice(0, 8).map((r, idx) => (
                    <TableRow key={`${r.account_id}-${idx}`}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{r.account_id}</TableCell>
                      <TableCell align="right">{formatNumber(r.txn_count)}</TableCell>
                      <TableCell align="right">{formatAmount(r.total_amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Box>
        )}

        {topTxns.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              Top Transactions
            </Typography>
            <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Account</TableCell>
                    <TableCell>Datetime</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {topTxns.slice(0, 8).map((r, idx) => (
                    <TableRow key={`${r.account_id}-${idx}`}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{r.account_id}</TableCell>
                      <TableCell>{String(r.transaction_datetime || '').slice(0, 19)}</TableCell>
                      <TableCell>{r.transaction_category || ''}</TableCell>
                      <TableCell>{r.transaction_type || ''}</TableCell>
                      <TableCell align="right">{formatAmount(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid #e2e8f0' }}>
        <Button
          onClick={() => {
            setThresholdOpen(true);
            if (!thresholdData) runThresholds();
          }}
          variant="outlined"
          disabled={!universeId}
        >
          Compute Thresholds
        </Button>
        <Button 
          onClick={onClose}
          variant="contained"
          sx={{ bgcolor: '#0f172a' }}
        >
          Close
        </Button>
      </DialogActions>

      <Dialog
        open={thresholdOpen}
        onClose={() => setThresholdOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { borderRadius: 0 } }}
      >
        <DialogTitle sx={{ bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Threshold Analysis
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
            Lookback thresholds computed from the selected universe
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          <Stack spacing={2}>
            {thresholdError && (
              <Alert severity="error" onClose={() => setThresholdError(null)}>
                {thresholdError}
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Schedule</InputLabel>
                  <Select
                    label="Schedule"
                    value={thresholdConfig.schedule}
                    onChange={(e) => setThresholdConfig((p) => ({ ...p, schedule: e.target.value }))}
                  >
                    <MenuItem value="daily">daily</MenuItem>
                    <MenuItem value="monthly">monthly</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Transaction Type</InputLabel>
                  <Select
                    label="Transaction Type"
                    value={thresholdConfig.transaction_type}
                    onChange={(e) => setThresholdConfig((p) => ({ ...p, transaction_type: e.target.value }))}
                  >
                    <MenuItem value="ALL">ALL</MenuItem>
                    <MenuItem value="DEBIT">DEBIT</MenuItem>
                    <MenuItem value="CREDIT">CREDIT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Aggregation</InputLabel>
                  <Select
                    label="Aggregation"
                    value={thresholdConfig.aggregation_level}
                    onChange={(e) => setThresholdConfig((p) => ({ ...p, aggregation_level: e.target.value }))}
                  >
                    <MenuItem value="daily">daily</MenuItem>
                    <MenuItem value="monthly">monthly</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Lookback Days"
                  type="number"
                  value={thresholdConfig.lookback_days}
                  onChange={(e) => setThresholdConfig((p) => ({ ...p, lookback_days: e.target.value }))}
                  inputProps={{ min: 1, step: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Account ID (optional)"
                  value={thresholdConfig.account_id}
                  onChange={(e) => setThresholdConfig((p) => ({ ...p, account_id: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ height: '100%' }}>
                  <FormControlLabel
                    control={<Switch checked={compareEnabled} onChange={(e) => setCompareEnabled(e.target.checked)} />}
                    label="Compare"
                  />
                  <TextField
                    size="small"
                    label="Compare Lookback"
                    type="number"
                    value={compareLookbackDays}
                    onChange={(e) => setCompareLookbackDays(e.target.value)}
                    disabled={!compareEnabled}
                    inputProps={{ min: 1, step: 1 }}
                  />
                </Stack>
              </Grid>
            </Grid>

            <Box>
              <Button variant="contained" onClick={runThresholds} disabled={thresholdLoading || !universeId}>
                Run
              </Button>
              {thresholdLoading && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress />
                </Box>
              )}
            </Box>

            {thresholdSummary && (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Unique Accounts
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatNumber(thresholdSummary.uniqueAccounts)}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Total Periods
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatNumber(thresholdSummary.totalPeriods)}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 0.5 }}>
                      Max Threshold
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {formatAmount(thresholdSummary.max)}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            )}

            {compareEnabled && thresholdData?.series?.length > 0 && thresholdCompareData?.series?.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Comparison ({thresholdConfig.lookback_days}d vs {compareLookbackDays}d)
                </Typography>
                <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">{thresholdConfig.lookback_days}d</TableCell>
                        <TableCell align="right">{compareLookbackDays}d</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(() => {
                        const keyA = thresholdConfig.schedule === 'monthly' ? 'month_last_date' : 'transaction_datetime';
                        const mapA = new Map((thresholdData.series || []).map((r) => [r[keyA], r]));
                        const mapB = new Map((thresholdCompareData.series || []).map((r) => [r[keyA], r]));
                        const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
                        return keys.slice(0, 200).map((k) => {
                          const a = mapA.get(k);
                          const b = mapB.get(k);
                          return (
                            <TableRow key={String(k)}>
                              <TableCell>{formatDate(k)}</TableCell>
                              <TableCell align="right">{formatAmount(a?.threshold_amt)}</TableCell>
                              <TableCell align="right">{formatAmount(b?.threshold_amt)}</TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </Paper>
              </Box>
            )}

            {thresholdData && !compareEnabled && (
              (() => {
                const schedule = thresholdData?.config?.schedule || thresholdConfig.schedule;
                const rows = schedule === 'monthly'
                  ? thresholdData?.monthly_threshold?.rows
                  : thresholdData?.threshold_table?.rows;
                if (!rows || rows.length === 0) return null;
                return (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      {thresholdData?.config?.account_id ? 'Threshold Series' : 'Top Threshold Rows'}
                    </Typography>
                    <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 1, overflow: 'hidden' }}>
                      <Table size="small">
                        <TableHead sx={{ bgcolor: '#f8fafc' }}>
                          <TableRow>
                            <TableCell>Account</TableCell>
                            {schedule === 'daily' && <TableCell>Customer</TableCell>}
                            <TableCell>Date</TableCell>
                            <TableCell align="right">Threshold</TableCell>
                            <TableCell align="right">{schedule === 'monthly' ? 'Count' : 'Count'}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.slice(0, 200).map((r, idx) => (
                            <TableRow key={idx}>
                              <TableCell sx={{ fontFamily: 'monospace' }}>{r.account_id}</TableCell>
                              {schedule === 'daily' && <TableCell sx={{ fontFamily: 'monospace' }}>{r.customer_id}</TableCell>}
                              <TableCell>
                                {schedule === 'monthly'
                                  ? formatDate(r.month_last_date)
                                  : formatDate(r.transaction_datetime)}
                              </TableCell>
                              <TableCell align="right">{formatAmount(r.threshold_amt)}</TableCell>
                              <TableCell align="right">
                                {schedule === 'monthly'
                                  ? formatNumber(r.transaction_count)
                                  : formatNumber(r.trxn_count)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                );
              })()
            )}

            {thresholdData?.worst_case?.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Worst Case Accounts
                </Typography>
                <Paper sx={{ border: '1px solid #e2e8f0', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell>Account</TableCell>
                        <TableCell align="right">Total Threshold</TableCell>
                        <TableCell align="right">Periods</TableCell>
                        <TableCell align="right">Total Txn Count</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {thresholdData.worst_case.map((r, idx) => (
                        <TableRow key={idx}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{r.account_id}</TableCell>
                          <TableCell align="right">{formatAmount(r.total_threshold)}</TableCell>
                          <TableCell align="right">{formatNumber(r.count_periods)}</TableCell>
                          <TableCell align="right">{formatNumber(r.total_trxn_count)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </Box>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2, borderTop: '1px solid #e2e8f0' }}>
          <Button
            onClick={() => setThresholdOpen(false)}
            variant="contained"
            sx={{ bgcolor: '#0f172a' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default UniverseDashboardPanel;
