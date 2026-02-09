import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';
import StructuredValue from '../components/StructuredValue';
import { formatInteger, formatNumber, formatPercentFromRatio, formatProbability } from '../utils/formatters';

const riskColor = (level) => {
  const v = String(level || '').toUpperCase();
  if (v === 'HIGH') return '#d32f2f';
  if (v === 'MEDIUM') return '#ff9800';
  if (v === 'LOW') return '#4caf50';
  return '#9e9e9e';
};

const MuleAccountScreen = ({ accountId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [behavior, setBehavior] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, beh] = await Promise.all([
        muleApi.getAccountSummary(accountId),
        muleApi.getAccountBehaviorProfile(accountId)
      ]);
      setData(res);
      setBehavior(beh);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load account');
      setData(null);
      setBehavior(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountId) load();
  }, [accountId]);

  const features = data?.features || {};
  const transactions = data?.transactions || [];

  const keyFeatures = useMemo(() => {
    const keys = [
      'tx_count_24h',
      'in_out_ratio',
      'pass_through_ratio',
      'degree_centrality',
      'clustering_coefficient',
      'accounts_per_device',
      'days_since_account_open'
    ];
    const out = [];
    for (const k of keys) {
      if (features?.[k] !== undefined) out.push({ k, v: features[k] });
    }
    return out;
  }, [features]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress sx={{ color: pwcColors.primary }} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={2}>
        <Button
          variant="outlined"
          startIcon={<ArrowBack />}
          onClick={onBack}
          sx={{ borderColor: pwcColors.primary, color: pwcColors.primary }}
        >
          Back
        </Button>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Account: {accountId}
        </Typography>
        {data?.risk && (
          <Chip
            label={`${data.risk.risk_level} · ${formatProbability(data.risk.hybrid_score || 0, 3)}`}
            sx={{ bgcolor: riskColor(data.risk.risk_level), color: 'white' }}
          />
        )}
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardHeader title="Account Profile" />
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="body2">Customer: {data?.account?.customer_id || '-'}</Typography>
                <Typography variant="body2">Type: {data?.account?.customer_type || '-'}</Typography>
                <Typography variant="body2">Risk Rating: {data?.account?.risk_rating || '-'}</Typography>
                <Typography variant="body2">Occupation: {data?.account?.occupation || '-'}</Typography>
                <Typography variant="body2">Expected Turnover: {formatNumber(data?.account?.expected_turnover ?? '-')}</Typography>
                <Typography variant="body2">Is Mule (label): {String(data?.account?.is_mule ?? '-')}</Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card>
            <CardHeader title="Key Features" subheader="Engineered from stored data" action={<Button onClick={load}>Refresh</Button>} />
            <CardContent>
              {keyFeatures.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No engineered features found for this account. Run Feature Engineering first.
                </Typography>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {keyFeatures.map((f) => (
                    <Chip key={f.k} label={`${f.k}: ${Number.isFinite(Number(f.v)) ? formatNumber(Number(f.v), { maxFractionDigits: 3 }) : String(f.v)}`} />
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardHeader title="Entity Behaviour Profiler" subheader="Rhythm, diversity, device spread, and peers" />
            <CardContent>
              {!behavior?.success ? (
                <Typography variant="body2" color="text.secondary">Behaviour profile not available.</Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>Rhythm</Typography>
                      <Chip label={`Transactions: ${formatInteger(behavior.rhythm?.tx_count ?? 0)}`} />
                      <Chip label={`Active days: ${formatInteger(behavior.rhythm?.active_days ?? 0)}`} />
                      <Chip label={`Avg/day: ${formatNumber(behavior.rhythm?.avg_per_day ?? 0, { maxFractionDigits: 2 })}`} />
                      <Chip label={`Peak/day: ${formatInteger(behavior.rhythm?.peak_day ?? 0)}`} />
                      <Chip label={`Avg gap (min): ${formatNumber(behavior.rhythm?.avg_gap_minutes ?? 0, { maxFractionDigits: 1 })}`} />
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>Counterparty Diversity</Typography>
                      <Chip label={`Counterparties: ${formatInteger(behavior.counterparty_diversity?.counterparties ?? 0)}`} />
                      <Chip label={`Banks: ${formatInteger(behavior.counterparty_diversity?.banks ?? 0)}`} />
                      <StructuredValue value={behavior.counterparty_diversity?.top_counterparties || {}} inline mode="integer" />
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>Device Spread</Typography>
                      <Chip label={`Devices: ${formatInteger(behavior.device_spread?.devices ?? 0)}`} />
                      <Chip label={`IPs: ${formatInteger(behavior.device_spread?.ip_addresses ?? 0)}`} />
                      <Typography variant="subtitle2" fontWeight={700}>Channel Mix</Typography>
                      <StructuredValue value={behavior.channel_mix || {}} inline mode="integer" />
                    </Stack>
                  </Grid>
                  <Grid item xs={12}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>Peer Comparison (percentile)</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        <Chip label={`Tx count: ${formatPercentFromRatio(behavior.peer_comparison?.tx_count_pct ?? 0, 0)}`} />
                        <Chip label={`Avg amount: ${formatPercentFromRatio(behavior.peer_comparison?.avg_amount_pct ?? 0, 0)}`} />
                        <Chip label={`Counterparties: ${formatPercentFromRatio(behavior.peer_comparison?.cp_count_pct ?? 0, 0)}`} />
                        <Chip label={`Devices: ${formatPercentFromRatio(behavior.peer_comparison?.device_count_pct ?? 0, 0)}`} />
                      </Stack>
                    </Stack>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardHeader title="Recent Transactions" subheader="Latest 200 rows for this account" />
            <CardContent>
              {transactions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No transactions found.</Typography>
              ) : (
                <Box sx={{ overflow: 'auto', maxHeight: 420 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>txn_id</TableCell>
                        <TableCell>txn_timestamp</TableCell>
                        <TableCell align="right">amount</TableCell>
                        <TableCell>direction</TableCell>
                        <TableCell>counterparty_account</TableCell>
                        <TableCell>counterparty_bank</TableCell>
                        <TableCell>channel</TableCell>
                        <TableCell>txn_type</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {transactions.slice(0, 200).map((t, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{t.txn_id}</TableCell>
                          <TableCell>{String(t.txn_timestamp || '')}</TableCell>
                          <TableCell align="right">{formatNumber(t.amount || 0, { minFractionDigits: 2, maxFractionDigits: 2 })}</TableCell>
                          <TableCell>{t.direction}</TableCell>
                          <TableCell>{t.counterparty_account}</TableCell>
                          <TableCell>{t.counterparty_bank}</TableCell>
                          <TableCell>{t.channel}</TableCell>
                          <TableCell>{t.txn_type}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MuleAccountScreen;
