import React from 'react';
import {
  Box, Typography, Chip, Stack, Button, Radio,
} from '@mui/material';
import { CheckCircle, ArrowForward } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  surface: '#F8F9FB', border: '#DDE2EA',
};

const GRAIN_OPTIONS = [
  {
    id: 'alerts', label: 'Alert', title: '1 Row = 1 Alert Decision', recommended: true,
    desc: 'Models alert-level disposition decisions. Links account KYC, case records, pre-alert transaction behaviors, and regulatory STR filings.',
    reasons: ['Preserves 1-row-per-alert grain (ALERT_ID uniqueness)', 'Enables pre-alert multi-horizon feature rollups without data leakage', 'Directly optimizes false positive reduction and investigator triage'],
    targetKey: 'ALERT_ID', features: '54+ Pre-Alert Velocity & Structuring Features',
  },
  {
    id: 'accounts', label: 'Account', title: '1 Row = 1 Bank Account', recommended: false,
    desc: 'Models cumulative account-level risk. Aggregates lifetime alerts, transaction velocity, and beneficial owner relationships.',
    reasons: ['Focuses on account dormancy & risk tiering', 'Requires aggregating alerts to account grain'],
    targetKey: 'ACCOUNT_ID', features: 'Lifetime flow volumes & dormancy metrics',
  },
  {
    id: 'customers', label: 'Customer / Entity', title: '1 Row = 1 Beneficial Owner', recommended: false,
    desc: 'Models multi-account entity network risk. Merges customer KYC profiles with aggregated account behaviors.',
    reasons: ['Customer onboarding risk & PEP / Adverse Media scoring', 'Requires hierarchical aggregation across linked accounts'],
    targetKey: 'CUSTOMER_ID', features: 'Network centrality & multi-account volumes',
  },
  {
    id: 'transactions', label: 'Transaction', title: '1 Row = 1 Event Transaction', recommended: false,
    desc: 'Models instantaneous payment fraud & sanctions screening at millisecond authorization grain.',
    reasons: ['Focuses on immediate payment block/allow rules', 'High row volume (120,000+ events per batch)'],
    targetKey: 'TRANSACTION_ID', features: 'Sub-second velocity & channel anomalies',
  },
];

export default function MasterGrainIntentSelector({ selectedGrain = 'alerts', onSelectGrain, onConfirmIntent, loading = false }) {
  return (
    <Box sx={{ py: 2, px: 0 }}>
      {/* Header */}
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.5 }}>
        Step 1: Intent & Grain Definition
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: PwC.midnight, mb: 0.25, letterSpacing: '-0.3px' }}>
        What should one row represent?
      </Typography>
      <Typography sx={{ fontSize: 12, color: PwC.mist, mb: 2, maxWidth: 580 }}>
        Your primary grain determines how source datasets are combined, how event streams are aggregated, and guarantees deterministic uniqueness.
      </Typography>

      {/* Options Grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 3 }}>
        {GRAIN_OPTIONS.map((opt) => {
          const isSelected = (selectedGrain || 'alerts') === opt.id;
          return (
            <Box
              key={opt.id}
              onClick={() => onSelectGrain && onSelectGrain(opt.id)}
              sx={{
                border: `1px solid ${isSelected ? PwC.tangerine : PwC.border}`,
                borderLeft: isSelected ? `3px solid ${PwC.tangerine}` : `1px solid ${isSelected ? PwC.tangerine : PwC.border}`,
                borderRadius: '5px',
                bgcolor: isSelected ? PwC.tangerineLight : PwC.white,
                px: 1.5,
                py: 1.25,
                cursor: 'pointer',
                transition: 'all 0.1s',
                '&:hover': { borderColor: PwC.tangerine },
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.75 }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: PwC.midnight }}>{opt.label}</Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 600, color: PwC.tangerine }}>{opt.title}</Typography>
                </Box>
                <Radio
                  checked={isSelected}
                  value={opt.id}
                  name="grain-selector"
                  sx={{ p: 0, color: PwC.smoke, '&.Mui-checked': { color: PwC.tangerine } }}
                  size="small"
                />
              </Stack>

              <Typography sx={{ fontSize: 11, color: PwC.mist, lineHeight: 1.5, mb: 1 }}>{opt.desc}</Typography>

              <Stack spacing={0.4} sx={{ mb: 1 }}>
                {opt.reasons.map((r, i) => (
                  <Stack key={i} direction="row" spacing={0.5} alignItems="flex-start">
                    <CheckCircle sx={{ fontSize: 11, color: PwC.emerald, mt: '2px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 10, color: PwC.slate, lineHeight: 1.45 }}>{r}</Typography>
                  </Stack>
                ))}
              </Stack>

              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ pt: 0.75, borderTop: `1px solid ${PwC.border}` }}>
                <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>
                  Primary Key: <strong>{opt.targetKey}</strong>
                </Typography>
                {opt.recommended && (
                  <Chip label="Recommended" size="small" sx={{ height: 16, fontSize: 8, fontWeight: 700, bgcolor: PwC.tangerine, color: PwC.white, borderRadius: '3px' }} />
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>

      {/* Confirm */}
      <Button
        variant="contained"
        onClick={onConfirmIntent}
        disabled={loading}
        endIcon={<ArrowForward sx={{ fontSize: 13 }} />}
        sx={{
          bgcolor: PwC.tangerine,
          '&:hover': { bgcolor: PwC.midnight },
          fontSize: 12,
          fontWeight: 800,
          py: 0.65,
          px: 3.5,
          height: 34,
          textTransform: 'none',
          borderRadius: '4px',
          boxShadow: 'none',
        }}
      >
        {loading ? 'Analyzing Datasets...' : 'Confirm Intent & Generate Visual Plan'}
      </Button>
    </Box>
  );
}
