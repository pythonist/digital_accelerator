import React from 'react';
import { Box, Card, CardContent, Stack, Typography, Button, Divider } from '@mui/material';
import RiskChip from './RiskChip';

const Metric = ({ label, value }) => (
  <Box sx={{ minWidth: 110 }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={700}>
      {value}
    </Typography>
  </Box>
);

const fmt = (v, digits = 3) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
};

const AccountCard = ({ account, onInvestigate }) => {
  const id = account?.account_id;
  return (
    <Card elevation={0} sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>
              {id}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {account?.customer_type ? `Customer: ${account.customer_type}` : 'Account intelligence'}
            </Typography>
          </Box>
          <RiskChip riskLevel={account?.risk_level || account?.risk || 'LOW'} />
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Metric label="Tx (24h)" value={fmt(account?.tx_count_24h ?? account?.tx_count ?? account?.tx_24h, 0)} />
          <Metric label="In/Out" value={fmt(account?.in_out_ratio, 3)} />
          <Metric label="Accounts/Device" value={fmt(account?.accounts_per_device, 2)} />
          <Metric label="Rule Score" value={fmt(account?.rule_score ?? account?.pattern_risk_score, 3)} />
          <Metric label="ML Score" value={fmt(account?.ml_score ?? account?.ml_risk_score, 3)} />
          <Metric label="Hybrid" value={fmt(account?.hybrid_score, 3)} />
        </Stack>

        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={() => onInvestigate && onInvestigate(id)} disabled={!id}>
            Investigate
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default AccountCard;

