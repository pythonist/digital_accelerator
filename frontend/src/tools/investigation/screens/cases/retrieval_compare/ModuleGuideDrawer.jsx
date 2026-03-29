import React from 'react';
import {
  Box,
  Drawer,
  Stack,
  Typography,
} from '@mui/material';

const ModuleGuideDrawer = ({ open, onClose, guide }) => (
  <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', lg: 520 } } }}>
    <Box sx={{ px: 2.5, py: 2.25 }}>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>
        {guide?.title || 'Case Retrieval and Compare'}
      </Typography>
      <Typography sx={{ mt: 0.65, fontSize: 13, color: '#64748b', lineHeight: 1.7 }}>
        Business guide for Similar Cases retrieval, comparison, and historical precedent review.
      </Typography>
      <Stack spacing={2.25} sx={{ mt: 2.5 }}>
        {(guide?.sections || []).map((section) => (
          <Box key={section.heading}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {section.heading}
            </Typography>
            <Typography sx={{ mt: 0.9, fontSize: 13.25, color: '#334155', lineHeight: 1.8 }}>
              {section.body}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  </Drawer>
);

export default ModuleGuideDrawer;
