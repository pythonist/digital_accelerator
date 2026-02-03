import React from 'react';
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
  TableBody
} from '@mui/material';
import { 
  BarChart as BarChartIcon,
  AccountBalance as AccountBalanceIcon,
  TrendingUp as TrendingUpIcon,
  DateRange as DateRangeIcon
} from '@mui/icons-material';

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
          onClick={onClose}
          variant="contained"
          sx={{ bgcolor: '#0f172a' }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UniverseDashboardPanel;
