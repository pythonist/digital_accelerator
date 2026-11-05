import React from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Stack,
} from '@mui/material';
import {
  CheckCircleOutline,
  ArrowForward,
} from '@mui/icons-material';

// ─── PwC Design Tokens (identical to DataUploadScreen) ───────────────────────
const PwC = {
  tangerine:      '#D04A02',
  tangerineMid:   '#E8651A',
  tangerineLight: '#FFF1EC',
  tangerineDim:   '#FCE9DF',
  midnight:       '#151B27',
  slate:          '#24364C',
  ash:            '#334155',
  mist:           '#64748B',
  smoke:          '#E2E8F0',
  cloud:          '#F5F6F8',
  white:          '#FFFFFF',
  emerald:        '#059669',
  emeraldLight:   '#D1FAE5',
  surface:        '#F8F9FB',
  border:         '#DDE2EA',
  borderStrong:   '#C5CDD8',
};

const GRAIN_OPTIONS = [
  { id: 'alerts',       label: 'Alerts',       grain: '1 row = 1 alert',       desc: 'Standard for AML alert suppression and false-positive reduction models.', recommended: true },
  { id: 'accounts',     label: 'Accounts',     grain: '1 row = 1 account',     desc: 'Used for ongoing customer due diligence and account risk rating models.', recommended: false },
  { id: 'customers',    label: 'Customers',    grain: '1 row = 1 customer',    desc: 'Used for entity resolution and customer risk classification.',            recommended: false },
  { id: 'transactions', label: 'Transactions', grain: '1 row = 1 transaction', desc: 'Used for real-time payment fraud and transaction anomaly scoring.',        recommended: false },
];

export default function MasterDatasetEmptyState({ onStartWithAlerts, onCustomGrainSelect }) {
  return (
    <Box sx={{ py: 3, px: 0 }}>
      {/* Section label */}
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.75 }}>
        Master Dataset Definition
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: PwC.midnight, mb: 0.25, letterSpacing: '-0.3px' }}>
        No master dataset yet.
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: PwC.mist, mb: 2.5, lineHeight: 1.55, maxWidth: 520 }}>
        Start by choosing what one row in your master dataset should represent.
      </Typography>

      {/* Recommended: Alerts — seamless bordered row */}
      <Box
        sx={{
          border: `1px solid ${PwC.tangerine}`,
          borderLeft: `3px solid ${PwC.tangerine}`,
          borderRadius: '5px',
          bgcolor: PwC.white,
          px: 2,
          py: 1.5,
          mb: 2.5,
          position: 'relative',
        }}
      >
        <Chip
          label="RECOMMENDED FOR AML"
          size="small"
          sx={{
            position: 'absolute',
            top: -10,
            left: 12,
            height: 18,
            fontSize: 9,
            fontWeight: 800,
            bgcolor: PwC.tangerine,
            color: PwC.white,
            borderRadius: '3px',
            letterSpacing: 0.5,
          }}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: PwC.midnight }}>
              Use Alerts (1 row = 1 alert)
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: PwC.mist, mt: 0.25 }}>
              Automatically joins Accounts, Customers, Cases, and summarizes historical Transactions.
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={onStartWithAlerts}
            endIcon={<ArrowForward sx={{ fontSize: 13 }} />}
            sx={{
              bgcolor: PwC.tangerine,
              '&:hover': { bgcolor: PwC.midnight },
              fontSize: 11.5,
              fontWeight: 700,
              py: 0.55,
              px: 2,
              height: 30,
              textTransform: 'none',
              borderRadius: '4px',
              boxShadow: 'none',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            Use Alerts (Recommended)
          </Button>
        </Stack>

        <Stack direction="row" spacing={2.5} sx={{ mt: 1.25, pt: 1, borderTop: `1px solid ${PwC.border}` }}>
          {[
            'Preserves exact alert decision grain',
            'Automatic anti-fanout transaction rollup',
            'Strict temporal anti-lookahead barrier',
          ].map((txt, i) => (
            <Stack key={i} direction="row" spacing={0.5} alignItems="center">
              <CheckCircleOutline sx={{ fontSize: 13, color: PwC.emerald }} />
              <Typography sx={{ fontSize: 10, color: PwC.slate, fontWeight: 600 }}>{txt}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* Alternative Grain Options */}
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 1 }}>
        Or select an alternative grain
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        {GRAIN_OPTIONS.filter((g) => !g.recommended).map((opt) => (
          <Box
            key={opt.id}
            onClick={() => onCustomGrainSelect && onCustomGrainSelect(opt.id)}
            sx={{
              flex: 1,
              border: `1px solid ${PwC.border}`,
              borderRadius: '5px',
              bgcolor: PwC.white,
              px: 1.5,
              py: 1.25,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
              '&:hover': { borderColor: PwC.tangerine },
            }}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: PwC.midnight }}>{opt.label}</Typography>
            <Typography sx={{ fontSize: 10, fontWeight: 600, color: PwC.tangerine, mb: 0.5 }}>{opt.grain}</Typography>
            <Typography sx={{ fontSize: 10.5, color: PwC.mist, lineHeight: 1.5 }}>{opt.desc}</Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
