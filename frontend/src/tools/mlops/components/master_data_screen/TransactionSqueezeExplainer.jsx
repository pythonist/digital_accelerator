import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';
import { ArrowForward, AccessTime } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  surface: '#F8F9FB', border: '#DDE2EA',
};

export default function TransactionSqueezeExplainer({ rawTxnCount = 120000, alertCount = 10472, featureCount = 54 }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
            Transaction Attachment Strategy
          </Typography>
          <Chip label="ANTI-FANOUT" size="small" sx={{ height: 16, fontSize: 8, fontWeight: 700, bgcolor: PwC.tangerineLight, color: '#9A3412', borderRadius: '3px' }} />
        </Stack>
        <Chip label="ZERO DATA LEAKAGE" size="small" sx={{ height: 17, fontSize: 8, fontWeight: 700, bgcolor: PwC.emeraldLight, color: PwC.emerald, borderRadius: '3px' }} />
      </Stack>

      <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', bgcolor: PwC.white, overflow: 'hidden' }}>
        {/* Explanation Text */}
        <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${PwC.border}` }}>
          <Typography sx={{ fontSize: 11.5, color: PwC.slate, lineHeight: 1.6 }}>
            <strong>Multiple transactions belong to the same account.</strong> Directly joining transactions
            would expand {alertCount.toLocaleString()} alerts into ~{rawTxnCount.toLocaleString()} rows, violating the primary grain.
            To preserve <strong>1 row = 1 alert</strong>, the system summarizes transaction history strictly before each alert timestamp.
          </Typography>
        </Box>

        {/* Flow Steps — dense horizontal layout */}
        <Box sx={{ px: 1.5, py: 1, bgcolor: PwC.surface }}>
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems="center" justifyContent="space-between" spacing={1.5}>
            {/* Step 1 */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Raw Transactions
              </Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: PwC.midnight, my: 0.15 }}>
                {rawTxnCount.toLocaleString()}
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>Unaggregated Events</Typography>
            </Box>

            <ArrowForward sx={{ color: PwC.smoke, fontSize: 16, display: { xs: 'none', md: 'block' } }} />

            {/* Step 2 */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.tangerine, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Temporal Squeeze
              </Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: PwC.tangerine, my: 0.15 }}>
                7d, 30d, 90d, 365d
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>Pre-Alert Lookback</Typography>
            </Box>

            <ArrowForward sx={{ color: PwC.smoke, fontSize: 16, display: { xs: 'none', md: 'block' } }} />

            {/* Step 3 */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.tangerine, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Alert Features
              </Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: PwC.tangerine, my: 0.15 }}>
                +{featureCount}
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>Velocity, Spikes, Flow</Typography>
            </Box>

            <ArrowForward sx={{ color: PwC.smoke, fontSize: 16, display: { xs: 'none', md: 'block' } }} />

            {/* Step 4 */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.emerald, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Final Grain
              </Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: PwC.midnight, my: 0.15 }}>
                {alertCount.toLocaleString()}
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.emerald, fontWeight: 600 }}>1 row / alert (0 duplicates)</Typography>
            </Box>
          </Stack>
        </Box>

        {/* Footer notes */}
        <Stack direction="row" spacing={3} sx={{ px: 1.5, py: 0.75, borderTop: `1px solid ${PwC.border}` }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <AccessTime sx={{ fontSize: 11, color: PwC.emerald }} />
            <Typography sx={{ fontSize: 10, color: PwC.mist }}>
              <strong>Anti-lookahead:</strong> Only pre-alert transactions included.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: PwC.emerald, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, color: PwC.mist }}>
              <strong>Preserves primary key:</strong> No row duplication.
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
