import React from 'react';
import { Box, Typography, Chip, Stack, Tooltip, IconButton } from '@mui/material';
import { CheckCircle, ErrorOutline, InfoOutlined } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  red: '#E0301E', roseLight: '#FFE4E6',
  surface: '#F8F9FB', border: '#DDE2EA',
};

const DEFAULT_RELATIONSHIPS = [
  { id: 'rel_accounts',  from: 'Alerts',    to: 'Accounts',                relationship: 'alerts.account_id = accounts.account_id',     cardinality: 'Many-to-one',  impact: 'No change',    rowsDetail: '10,472 → 10,472', isSafe: true },
  { id: 'rel_customers', from: 'Accounts',  to: 'Customers',               relationship: 'accounts.customer_id = customers.customer_id', cardinality: 'Many-to-one',  impact: 'No change',    rowsDetail: '10,472 → 10,472', isSafe: true },
  { id: 'rel_cases',     from: 'Alerts',    to: 'Cases',                   relationship: 'alerts.alert_id = cases.alert_id',             cardinality: 'One-to-one',   impact: 'No change',    rowsDetail: '10,472 → 10,472', isSafe: true },
  { id: 'rel_str',       from: 'Alerts',    to: 'STR / SAR',               relationship: 'alerts.alert_id = str.alert_id',               cardinality: 'One-to-many',  impact: 'No change',    rowsDetail: '10,472 → 10,472', isSafe: true },
  { id: 'rel_txns_raw',  from: 'Accounts',  to: 'Transactions (Direct)',   relationship: 'accounts.account_id = txn.account_id',         cardinality: 'One-to-many',  impact: 'Row increase', rowsDetail: '10,472 → ~120,280', isSafe: false,
    reason: 'Multiple transactions belong to the same account. Direct join would destroy the 1-row-per-alert grain. Pre-alert temporal aggregation is applied instead.' },
];

export default function MasterDatasetRelationshipsTable({ relationships = DEFAULT_RELATIONSHIPS, onSelectRelationship }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
          Relationship Cardinality & Row Impact
        </Typography>
        <Chip label="ALL CONTRACTS VERIFIED" size="small" sx={{ height: 17, fontSize: 8, fontWeight: 700, bgcolor: PwC.emeraldLight, color: PwC.emerald, borderRadius: '3px' }} />
      </Stack>

      <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden', bgcolor: PwC.white }}>
        {/* Header */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1.6fr 0.8fr 1fr 100px', px: 1.5, py: 0.55, bgcolor: PwC.surface, borderBottom: `1px solid ${PwC.border}` }}>
          {['From', 'To', 'Relationship Key', 'Cardinality', 'Row Impact', 'Safety'].map((h) => (
            <Typography key={h} sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              {h}
            </Typography>
          ))}
        </Box>

        {/* Rows */}
        {relationships.map((rel, idx) => (
          <Box
            key={rel.id}
            onClick={() => onSelectRelationship && onSelectRelationship(rel)}
            sx={{
              display: 'grid',
              gridTemplateColumns: '0.7fr 1fr 1.6fr 0.8fr 1fr 100px',
              px: 1.5,
              py: 0.7,
              cursor: 'pointer',
              bgcolor: rel.isSafe ? PwC.white : '#FFFBEB',
              borderBottom: idx < relationships.length - 1 ? `1px solid ${PwC.border}` : 'none',
              transition: 'background 0.1s',
              '&:hover': { bgcolor: rel.isSafe ? PwC.cloud : '#FEF3C7' },
            }}
          >
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: PwC.midnight }}>{rel.from}</Typography>
            <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: PwC.slate }}>{rel.to}</Typography>
            <Typography sx={{ fontSize: 10.5, fontFamily: '"Fira Code", "Cascadia Code", monospace', color: PwC.mist }}>{rel.relationship}</Typography>
            <Typography sx={{ fontSize: 11, color: PwC.mist }}>{rel.cardinality}</Typography>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: rel.isSafe ? PwC.slate : PwC.red }}>{rel.impact}</Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>{rel.rowsDetail}</Typography>
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {rel.isSafe ? (
                <Chip
                  icon={<CheckCircle sx={{ fontSize: '11px !important', color: `${PwC.emerald} !important` }} />}
                  label="Safe"
                  size="small"
                  sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: PwC.emeraldLight, color: PwC.emerald, borderRadius: '3px' }}
                />
              ) : (
                <Chip
                  icon={<ErrorOutline sx={{ fontSize: '11px !important', color: `${PwC.red} !important` }} />}
                  label="Blocked"
                  size="small"
                  sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: PwC.roseLight, color: PwC.red, borderRadius: '3px' }}
                />
              )}
              {rel.reason && (
                <Tooltip title={rel.reason} arrow placement="top">
                  <IconButton size="small" sx={{ p: 0.15, color: PwC.mist }}>
                    <InfoOutlined sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
