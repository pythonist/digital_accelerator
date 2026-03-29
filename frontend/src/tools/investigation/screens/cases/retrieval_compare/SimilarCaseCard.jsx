import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';

import { formatAmount, formatPercent, formatRisk, outcomeTone } from './retrievalCompareUtils';

const SimilarCaseCard = ({ item, selected, onToggle, onCompare }) => {
  const tone = outcomeTone(item.resolution_outcome);
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
      <CardContent sx={{ p: 2.25 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{item.case_id}</Typography>
              <Chip label={formatPercent(item.similarity_score)} size="small" color="primary" sx={{ fontWeight: 700 }} />
              <Chip label={item.dominant_typology || 'Pattern match'} size="small" variant="outlined" />
              <Chip
                label={item.resolution_outcome || 'Outcome unavailable'}
                size="small"
                sx={{ color: tone.fg, backgroundColor: tone.bg, border: `1px solid ${tone.border}`, fontWeight: 700 }}
              />
            </Stack>
            <Typography sx={{ mt: 0.6, fontSize: 12.75, color: '#475569', lineHeight: 1.7 }}>
              Matched because: {(item.matched_because || []).join(' ')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Checkbox checked={selected} onChange={() => onToggle(item.case_id)} />
            <Button variant="outlined" size="small" onClick={() => onCompare(item.case_id)}>
              Compare
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(4, 1fr)' }, gap: 1.25 }}>
          <Box>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Shared Indicators</Typography>
            <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#334155', lineHeight: 1.7 }}>
              {(item.shared_indicators || []).join(' ') || 'No explicit shared indicators were returned.'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Top Matching Features</Typography>
            <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#334155', lineHeight: 1.7 }}>
              {(item.top_matching_features || []).join(', ') || '-'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Key Differences</Typography>
            <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#334155', lineHeight: 1.7 }}>
              {(item.key_differences || []).slice(0, 2).join(' ') || '-'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Case Snapshot</Typography>
            <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#334155', lineHeight: 1.7 }}>
              Risk {formatRisk(item.risk_score)} | {item.severity || '-'} | Branch {item.branch_code || '-'} | Value {formatAmount(item.preview?.transactions?.[0]?.amount || item.preview?.transactions?.[0]?.TXN_AMOUNT || 0)}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default SimilarCaseCard;
