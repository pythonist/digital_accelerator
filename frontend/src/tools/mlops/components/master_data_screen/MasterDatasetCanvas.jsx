import React from 'react';
import {
  Box, Typography, Button, Chip, Stack,
} from '@mui/material';
import {
  CheckCircle, ArrowForward,
} from '@mui/icons-material';
import MasterDatasetRelationshipsTable from './MasterDatasetRelationshipsTable';
import TransactionSqueezeExplainer from './TransactionSqueezeExplainer';

const PwC = {
  tangerine:      '#D04A02',
  tangerineLight: '#FFF1EC',
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

const TABLE_SPECS = {
  alerts:       { name: 'Alerts',       rows: '10,472',  role: 'Base Anchor Grain',       impact: 'Determines grain (1 row / alert)', transform: 'None', badge: 'ANCHOR' },
  accounts:     { name: 'Accounts',     rows: '12,000',  role: 'Risk Tier & Profile',      impact: 'No change in row count',           transform: 'None', badge: 'N:1' },
  customers:    { name: 'Customers',    rows: '8,000',   role: 'Beneficial Ownership',     impact: 'No change in row count',           transform: 'None', badge: 'N:1' },
  cases:        { name: 'Cases',        rows: '1,571',   role: 'Investigation Dispositions', impact: 'No change in row count',         transform: 'Status mapping', badge: '1:1' },
  transactions: { name: 'Transactions', rows: '120,000', role: 'Historical Event Stream',  impact: 'Squeezed → 10,472',                transform: 'Multi-horizon rollup', badge: 'AGG' },
};

export default function MasterDatasetCanvas({
  plan,
  selectedNode,
  onSelectNode,
  onProceedToReview,
}) {
  if (!plan) return null;

  const targetGrain = plan.target_grain || {};
  const anchorTable = targetGrain.entity_name || 'alerts';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Status Banner — thin seamless strip */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: `1px solid ${PwC.emerald}`,
          borderLeft: `3px solid ${PwC.emerald}`,
          borderRadius: '5px',
          bgcolor: PwC.emeraldLight,
          px: 1.5,
          py: 0.85,
          mb: 2,
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center">
          <CheckCircle sx={{ color: PwC.emerald, fontSize: 15 }} />
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#14532D' }}>
              Safe combination found.
            </Typography>
            <Typography sx={{ fontSize: 10.5, color: '#166534' }}>
              All joins maintain 1 row = 1 alert. Historical transactions summarized with zero lookahead leakage.
            </Typography>
          </Box>
        </Stack>

        {onProceedToReview && (
          <Button
            variant="contained"
            size="small"
            onClick={onProceedToReview}
            endIcon={<ArrowForward sx={{ fontSize: 12 }} />}
            sx={{
              bgcolor: PwC.tangerine,
              '&:hover': { bgcolor: PwC.midnight },
              fontSize: 11,
              fontWeight: 700,
              py: 0.4,
              px: 1.75,
              height: 27,
              textTransform: 'none',
              borderRadius: '4px',
              boxShadow: 'none',
              flexShrink: 0,
            }}
          >
            Review & Build
          </Button>
        )}
      </Box>

      {/* Source Tables — dense seamless table-list, NO cards */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.75 }}>
          Participating Source Tables
        </Typography>

        <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden', bgcolor: PwC.white }}>
          {/* Table Header */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 1.2fr 1.2fr 1fr 60px',
              gap: 0,
              px: 1.5,
              py: 0.6,
              bgcolor: PwC.surface,
              borderBottom: `1px solid ${PwC.border}`,
            }}
          >
            {['Table', 'Rows', 'Role', 'Row Impact', 'Transform', 'Type'].map((h) => (
              <Typography key={h} sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                {h}
              </Typography>
            ))}
          </Box>

          {/* Table Rows */}
          {Object.entries(TABLE_SPECS).map(([key, spec], idx) => {
            const isSelected = selectedNode?.name === key;
            const isLast = idx === Object.keys(TABLE_SPECS).length - 1;
            return (
              <Box
                key={key}
                onClick={() =>
                  onSelectNode &&
                  onSelectNode({
                    type: key === anchorTable ? 'anchor' : key === 'transactions' ? 'aggregation' : 'relationship',
                    name: key,
                  })
                }
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 1.2fr 1.2fr 1fr 60px',
                  gap: 0,
                  px: 1.5,
                  py: 0.75,
                  cursor: 'pointer',
                  bgcolor: isSelected ? PwC.tangerineLight : PwC.white,
                  borderBottom: isLast ? 'none' : `1px solid ${PwC.border}`,
                  borderLeft: isSelected ? `3px solid ${PwC.tangerine}` : '3px solid transparent',
                  transition: 'all 0.1s',
                  '&:hover': { bgcolor: isSelected ? PwC.tangerineLight : PwC.cloud },
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: PwC.midnight }}>{spec.name}</Typography>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: PwC.slate, fontVariantNumeric: 'tabular-nums' }}>{spec.rows}</Typography>
                <Typography sx={{ fontSize: 11, color: PwC.mist }}>{spec.role}</Typography>
                <Typography sx={{ fontSize: 11, color: key === 'transactions' ? PwC.tangerine : PwC.mist, fontWeight: key === 'transactions' ? 600 : 400 }}>
                  {spec.impact}
                </Typography>
                <Typography sx={{ fontSize: 11, color: PwC.mist }}>{spec.transform}</Typography>
                <Chip
                  label={spec.badge}
                  size="small"
                  sx={{
                    height: 17,
                    fontSize: 8.5,
                    fontWeight: 700,
                    borderRadius: '3px',
                    bgcolor: key === anchorTable ? PwC.tangerineLight : key === 'transactions' ? '#FEF3C7' : PwC.cloud,
                    color: key === anchorTable ? '#9A3412' : key === 'transactions' ? '#B45309' : PwC.ash,
                  }}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Transaction Squeeze Explainer */}
      <TransactionSqueezeExplainer rawTxnCount={120000} alertCount={10472} featureCount={54} />

      {/* Relationship Table */}
      <MasterDatasetRelationshipsTable
        onSelectRelationship={(rel) =>
          onSelectNode && onSelectNode({ type: 'relationship', name: rel.to.toLowerCase(), data: rel })
        }
      />
    </Box>
  );
}
