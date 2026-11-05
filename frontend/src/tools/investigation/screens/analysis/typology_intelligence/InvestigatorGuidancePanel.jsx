import React from 'react';
import { Box, Chip, Divider, Stack, Typography } from '@mui/material';
import {
  HelpOutline as HelpIcon,
  Search as SearchIcon,
  TrendingUp as StrengthenIcon,
  TrendingDown as WeakenIcon,
  VerifiedUser as SufficiencyIcon,
} from '@mui/icons-material';

const GuidanceSection = ({ title, icon, items }) => (
  <Box>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      {icon}
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{title}</Typography>
    </Stack>
    <Stack spacing={0.65} sx={{ pl: 3 }}>
      {(items || []).map((item, index) => (
        <Typography key={`${title}-${index}`} sx={{ fontSize: 12.8, color: '#334155', lineHeight: 1.6 }}>
          • {item}
        </Typography>
      ))}
      {!items?.length && (
        <Typography sx={{ fontSize: 12.5, color: '#94a3b8' }}>No specific criteria recorded.</Typography>
      )}
    </Stack>
  </Box>
);

const InvestigatorGuidancePanel = ({ guidance }) => {
  const payload = guidance || {};
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1}>
        <Chip
          label={payload.l2_review_should_be_considered ? 'L2 Review Recommended' : 'L2 Review Not Indicated'}
          size="small"
          sx={{
            fontWeight: 700,
            fontSize: 11.5,
            bgcolor: payload.l2_review_should_be_considered ? '#fffbeb' : '#f8fafc',
            color: payload.l2_review_should_be_considered ? '#92400e' : '#475569',
            border: '1px solid',
            borderColor: payload.l2_review_should_be_considered ? '#fde68a' : '#e2e8f0',
          }}
        />
        <Chip
          label={payload.branch_confirmation_may_be_needed ? 'Branch Verification Needed' : 'No Branch Flag'}
          size="small"
          sx={{
            fontWeight: 700,
            fontSize: 11.5,
            bgcolor: payload.branch_confirmation_may_be_needed ? '#eff6ff' : '#f8fafc',
            color: payload.branch_confirmation_may_be_needed ? '#1e40af' : '#475569',
            border: '1px solid',
            borderColor: payload.branch_confirmation_may_be_needed ? '#bfdbfe' : '#e2e8f0',
          }}
        />
      </Stack>

      <GuidanceSection
        title="Items To Verify"
        icon={<SearchIcon sx={{ fontSize: 18, color: '#2563eb' }} />}
        items={payload.what_to_verify}
      />
      <Divider sx={{ borderColor: '#f1f5f9' }} />

      <GuidanceSection
        title="Missing Evidence & Information Gaps"
        icon={<HelpIcon sx={{ fontSize: 18, color: '#ea580c' }} />}
        items={payload.what_is_missing}
      />
      <Divider sx={{ borderColor: '#f1f5f9' }} />

      <GuidanceSection
        title="Factors That Could Strengthen Case Suspicion"
        icon={<StrengthenIcon sx={{ fontSize: 18, color: '#dc2626' }} />}
        items={payload.what_could_strengthen}
      />
      <Divider sx={{ borderColor: '#f1f5f9' }} />

      <GuidanceSection
        title="Factors That Could Weaken Suspicion"
        icon={<WeakenIcon sx={{ fontSize: 18, color: '#16a34a' }} />}
        items={payload.what_could_weaken}
      />
      <Divider sx={{ borderColor: '#f1f5f9' }} />

      <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1.5, border: '1px solid #e2e8f0' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <SufficiencyIcon sx={{ fontSize: 16, color: '#475569' }} />
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#334155', textTransform: 'uppercase' }}>
            Assessment Sufficiency Standard
          </Typography>
        </Stack>
        <Typography sx={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
          {payload.sufficiency_note ||
            'Analyst substantiation is required before this typology assessment should influence filing or closure.'}
        </Typography>
      </Box>
    </Stack>
  );
};

export default InvestigatorGuidancePanel;
