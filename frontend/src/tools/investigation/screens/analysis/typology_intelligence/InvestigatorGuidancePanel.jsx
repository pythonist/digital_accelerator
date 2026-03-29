import React from 'react';
import { Chip, Paper, Stack, Typography } from '@mui/material';

const Section = ({ title, items }) => (
  <Paper variant="outlined" sx={{ p: 1.8, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
    <Stack spacing={0.65} sx={{ mt: 1 }}>
      {(items || []).map((item, index) => (
        <Typography key={`${title}-${index}`} sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.55 }}>
          {item}
        </Typography>
      ))}
      {!items?.length ? (
        <Typography sx={{ fontSize: 12.6, color: '#64748b' }}>No specific guidance was returned.</Typography>
      ) : null}
    </Stack>
  </Paper>
);

const InvestigatorGuidancePanel = ({ guidance }) => {
  const payload = guidance || {};
  return (
    <Stack spacing={1.4}>
      <Stack direction="row" spacing={1}>
        <Chip label={payload.l2_review_should_be_considered ? 'L2 Review Should Be Considered' : 'L2 Review Not Yet Indicated'} color={payload.l2_review_should_be_considered ? 'warning' : 'default'} size="small" />
        <Chip label={payload.branch_confirmation_may_be_needed ? 'Branch Confirmation May Be Needed' : 'No Immediate Branch Confirmation Flag'} color={payload.branch_confirmation_may_be_needed ? 'info' : 'default'} size="small" />
      </Stack>
      <Section title="What Should Be Verified" items={payload.what_to_verify} />
      <Section title="What Evidence Is Missing" items={payload.what_is_missing} />
      <Section title="What Could Strengthen The Case" items={payload.what_could_strengthen} />
      <Section title="What Could Weaken The Case" items={payload.what_could_weaken} />
      <Paper variant="outlined" sx={{ p: 1.8, borderRadius: 2.5 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Assessment Sufficiency</Typography>
        <Typography sx={{ mt: 1, fontSize: 12.7, color: '#334155', lineHeight: 1.6 }}>{payload.sufficiency_note || 'Analyst validation is still required before this typology should influence closure or escalation.'}</Typography>
      </Paper>
    </Stack>
  );
};

export default InvestigatorGuidancePanel;
