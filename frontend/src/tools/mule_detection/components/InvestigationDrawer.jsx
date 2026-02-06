import React from 'react';
import { Drawer, Box } from '@mui/material';
import { useMuleStore } from '../store/muleStore';
import InvestigationPanel from './InvestigationPanel';

const InvestigationDrawer = () => {
  const { investigationOpen, closeInvestigation } = useMuleStore();

  return (
    <Drawer
      anchor="right"
      open={investigationOpen}
      onClose={closeInvestigation}
      PaperProps={{ sx: { width: { xs: '100%', md: 560 }, bgcolor: '#fff' } }}
    >
      <Box sx={{ height: '100%', overflow: 'auto' }}>
        <InvestigationPanel />
      </Box>
    </Drawer>
  );
};

export default InvestigationDrawer;

