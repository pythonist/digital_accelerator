import React from 'react';
import { Box, Divider, Drawer, Stack, Typography } from '@mui/material';

const sections = [
  {
    title: 'What Network Intelligence Does',
    body: 'This module helps investigators review visible case relationships, identify suspicious structures, understand whether a case is isolated or connected to broader activity, and capture network findings for escalation and reporting.',
  },
  {
    title: 'Why Graph Analytics Matter',
    body: 'Hubs, bridges, clusters, funnels, and path traces can show concentration points, routing entities, and relationship structures that may not be obvious from transaction tables alone.',
  },
  {
    title: 'What Analysts Can Learn',
    body: 'Network review can surface collector accounts, bridge entities, repeated shared counterparties, suspicious clusters, circular movement, and visible links to other alerts or cases.',
  },
  {
    title: 'Visibility May Be Partial',
    body: 'Cross-bank activity is often only partly visible. The module evaluates relationships present in current bank and investigation data and clearly notes when external visibility is limited.',
  },
  {
    title: 'How Findings Support Decisions',
    body: 'Saved findings feed the report workflow and help analysts explain whether network evidence strengthens escalation, remains limited, or does not materially change the case assessment.',
  },
  {
    title: 'Important Limitations',
    body: 'Network similarity does not prove shared intent. Visible graph patterns should be reviewed with transaction context, alert history, case evidence, and analyst judgment.',
  },
];

const NetworkGuideDrawer = ({ open, onClose }) => (
  <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', md: 460 } } }}>
    <Box sx={{ p: 2.5 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Network Intelligence Guide</Typography>
      <Typography sx={{ mt: 0.7, fontSize: 12.6, color: '#64748b' }}>
        Business-friendly guidance for network-based investigation review.
      </Typography>
      <Stack spacing={2} sx={{ mt: 2.2 }}>
        {sections.map((section) => (
          <Box key={section.title}>
            <Typography sx={{ fontSize: 14.2, fontWeight: 800, color: '#0f172a' }}>{section.title}</Typography>
            <Typography sx={{ mt: 0.7, fontSize: 12.7, color: '#334155', lineHeight: 1.75 }}>
              {section.body}
            </Typography>
            <Divider sx={{ mt: 1.8 }} />
          </Box>
        ))}
      </Stack>
    </Box>
  </Drawer>
);

export default NetworkGuideDrawer;
