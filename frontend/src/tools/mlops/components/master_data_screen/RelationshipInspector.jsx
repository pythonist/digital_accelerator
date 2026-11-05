import React from 'react';
import {
  Box, Typography, Chip, Stack, Button, Switch, FormControlLabel, IconButton,
} from '@mui/material';
import { Close, CheckCircle, AccessTime, DeleteOutline } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  red: '#E0301E',
  surface: '#F8F9FB', border: '#DDE2EA',
};

export default function RelationshipInspector({ selectedNode, plan, onClose, onRemoveRelationship, onToggleDeduplication, onConfigureAggregation }) {
  if (!selectedNode) {
    return (
      <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', bgcolor: PwC.surface, px: 1.5, py: 2, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 11.5, color: PwC.mist }}>
          Select a table or connection to inspect relationship details and cardinality safety.
        </Typography>
      </Box>
    );
  }

  const { type, name, data } = selectedNode;
  const typeLabel = { anchor: 'BASE ANCHOR', relationship: 'RELATIONAL ENRICHMENT', aggregation: 'EVENT AGGREGATION', outcome: 'GROUND TRUTH' }[type] || type.toUpperCase();

  return (
    <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', bgcolor: PwC.white, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 0.85, bgcolor: PwC.surface, borderBottom: `1px solid ${PwC.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: PwC.midnight }}>{name.toUpperCase()}</Typography>
          <Chip label={typeLabel} size="small" sx={{ height: 16, fontSize: 8, fontWeight: 700, bgcolor: PwC.tangerineLight, color: '#9A3412', borderRadius: '3px', mt: 0.25 }} />
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ p: 0.25, color: PwC.mist }}>
          <Close sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>

      <Box sx={{ px: 1.5, py: 1.25 }}>
        {/* Anchor */}
        {type === 'anchor' && (
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 11.5, color: PwC.slate, lineHeight: 1.6 }}>
              The <strong>Alerts</strong> dataset is the base anchor grain. Every output row corresponds 1:1 with an alert.
            </Typography>
            <Box sx={{ bgcolor: PwC.surface, border: `1px solid ${PwC.border}`, borderRadius: '4px', px: 1.25, py: 0.75 }}>
              <Typography sx={{ fontSize: 10.5, color: PwC.ash, fontWeight: 600 }}>
                Primary Key: <strong>ALERT_ID</strong>
              </Typography>
              <Typography sx={{ fontSize: 10, color: PwC.mist, mt: 0.25 }}>
                10,472 alerts &bull; 0 duplicates allowed &bull; 100% unique guarantee
              </Typography>
            </Box>
          </Stack>
        )}

        {/* Relationship */}
        {type === 'relationship' && data && (
          <Stack spacing={1}>
            <Box sx={{ bgcolor: PwC.surface, border: `1px solid ${PwC.border}`, borderRadius: '4px', px: 1.25, py: 0.75 }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Relationship Contract
              </Typography>
              <Typography sx={{ fontSize: 11.5, fontFamily: '"Fira Code", monospace', fontWeight: 600, color: PwC.midnight, my: 0.35 }}>
                {data.relationship}
              </Typography>
              <Typography sx={{ fontSize: 10, color: PwC.mist }}>
                Cardinality: <strong>{data.cardinality}</strong> &bull; Match: <strong>100.0%</strong>
              </Typography>
            </Box>

            <Box sx={{
              bgcolor: data.isSafe ? PwC.emeraldLight : '#FEF2F2',
              border: `1px solid ${data.isSafe ? '#A7F3D0' : '#FECACA'}`,
              borderRadius: '4px', px: 1.25, py: 0.6,
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 700, color: data.isSafe ? '#14532D' : '#991B1B' }}>
                Row Impact: {data.impact} ({data.rowsDetail})
              </Typography>
            </Box>

            {data.isSafe && onToggleDeduplication && (
              <FormControlLabel
                control={
                  <Switch defaultChecked onChange={(e) => onToggleDeduplication(data.id, e.target.checked)}
                    sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: PwC.tangerine }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: PwC.tangerine } }} />
                }
                label={<Typography sx={{ fontSize: 10.5, color: PwC.slate, fontWeight: 600 }}>Strict right-side deduplication</Typography>}
              />
            )}

            {onRemoveRelationship && (
              <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutline sx={{ fontSize: 13 }} />}
                onClick={() => onRemoveRelationship(data.id)}
                sx={{ textTransform: 'none', fontWeight: 700, fontSize: 10.5, borderRadius: '4px', py: 0.3 }}>
                Remove from dataset
              </Button>
            )}
          </Stack>
        )}

        {/* Aggregation */}
        {type === 'aggregation' && (
          <Stack spacing={1}>
            <Box sx={{ bgcolor: PwC.emeraldLight, border: '1px solid #A7F3D0', borderRadius: '4px', px: 1.25, py: 0.6 }}>
              <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#14532D' }}>
                120,000 Transactions → 54 Alert-Level Features
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: '#166534', mt: 0.25 }}>
                Rolled up across 7d, 30d, 90d, and 365d pre-alert windows.
              </Typography>
            </Box>

            <Stack spacing={0.5}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <AccessTime sx={{ fontSize: 12, color: PwC.emerald }} />
                <Typography sx={{ fontSize: 10.5, color: PwC.mist }}>Temporal lookback: <strong>TXN_TIMESTAMP &lt; ALERT_DATE</strong></Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <CheckCircle sx={{ fontSize: 12, color: PwC.emerald }} />
                <Typography sx={{ fontSize: 10.5, color: PwC.mist }}>Preserves grain: <strong>1 row = 1 alert (10,472)</strong></Typography>
              </Stack>
            </Stack>

            {onConfigureAggregation && (
              <Button size="small" variant="outlined"
                onClick={onConfigureAggregation}
                sx={{ color: PwC.tangerine, borderColor: PwC.border, textTransform: 'none', fontWeight: 700, fontSize: 10.5, borderRadius: '4px', py: 0.3, '&:hover': { borderColor: PwC.tangerine } }}>
                Configure lookback horizons
              </Button>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
