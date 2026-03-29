import React from 'react';
import { Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';

const SECTIONS = [
  {
    title: 'What typology means',
    body: 'A typology is a suspicious behavioral pattern such as mule activity, structuring, layering, funnel behavior, pass-through activity, or high-risk corridor movement.',
  },
  {
    title: 'What this module does',
    body: 'Typology Intelligence assesses whether visible case behavior aligns with known AML and fraud patterns using structured case signals.',
  },
  {
    title: 'How the assessment works',
    body: 'The module uses transaction behavior, alert profile, customer and account risk, network relationships, and other supporting signals to score multiple typologies and rank the strongest pattern.',
  },
  {
    title: 'Why the result is not a final decision',
    body: 'Typology alignment is an investigation indicator that supports review. It should inform analyst judgment, not replace it.',
  },
  {
    title: 'Why confidence may vary',
    body: 'Confidence can be reduced by synthetic data, partial cross-bank visibility, sparse network evidence, or limited historical comparison support.',
  },
  {
    title: 'How analysts should use the output',
    body: 'Use the assessment to understand suspicious patterns, ask better review questions, guide escalation, and strengthen the final case narrative.',
  },
];

const TypologyGuideDrawer = ({ open, onClose }) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
    <DialogTitle>Typology Intelligence Guide</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        {SECTIONS.map((section) => (
          <Stack key={section.title} spacing={0.6}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{section.title}</Typography>
            <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>{section.body}</Typography>
          </Stack>
        ))}
      </Stack>
    </DialogContent>
  </Dialog>
);

export default TypologyGuideDrawer;
