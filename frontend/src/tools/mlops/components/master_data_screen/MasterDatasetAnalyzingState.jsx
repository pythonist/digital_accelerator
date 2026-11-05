import React from 'react';
import { Box, Typography, Stack, CircularProgress } from '@mui/material';
import { CheckCircle, RadioButtonChecked } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02',
  midnight:  '#151B27',
  slate:     '#24364C',
  ash:       '#334155',
  mist:      '#64748B',
  smoke:     '#E2E8F0',
  white:     '#FFFFFF',
  emerald:   '#059669',
  border:    '#DDE2EA',
};

export default function MasterDatasetAnalyzingState() {
  const steps = [
    { label: 'Alerts identified (10,472 records as base anchor grain)', done: true },
    { label: 'Account relationship found (alerts.account_id = accounts.account_id)', done: true },
    { label: 'Customer relationship found (accounts.customer_id = customers.customer_id)', done: true },
    { label: 'Checking transaction history and temporal anti-leakage barrier...', done: false, active: true },
  ];

  return (
    <Box sx={{ py: 4, maxWidth: 560 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2.5 }}>
        <CircularProgress size={18} sx={{ color: PwC.tangerine }} />
        <Box>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: PwC.midnight }}>
            Analyzing your data...
          </Typography>
          <Typography sx={{ fontSize: 11, color: PwC.mist }}>
            Evaluating join safety, cardinality fan-out risk, and temporal barriers.
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={1.25}>
        {steps.map((s, idx) => (
          <Stack key={idx} direction="row" spacing={1} alignItems="center">
            {s.done ? (
              <CheckCircle sx={{ color: PwC.emerald, fontSize: 15 }} />
            ) : s.active ? (
              <RadioButtonChecked sx={{ color: PwC.tangerine, fontSize: 15 }} />
            ) : (
              <Box sx={{ width: 13, height: 13, borderRadius: '50%', border: `2px solid ${PwC.smoke}` }} />
            )}
            <Typography
              sx={{
                fontSize: 12,
                color: s.done ? PwC.slate : s.active ? PwC.tangerine : PwC.mist,
                fontWeight: s.active ? 700 : 500,
              }}
            >
              {s.label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
