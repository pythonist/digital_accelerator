import React from 'react';
import { Drawer, Box, Tabs, Tab } from '@mui/material';
import { useMuleStore } from '../store/muleStore';
import InvestigationPanel from './InvestigationPanel';
import InvestigationTimelinePanel from './InvestigationTimelinePanel';
import InvestigationNetworkPanel from './InvestigationNetworkPanel';
import { TOOL_HEADER_HEIGHT } from '../layout/layout.constants';

const InvestigationDrawer = () => {
  const { investigationOpen, closeInvestigation, investigationTab, setInvestigationTab } = useMuleStore();

  return (
    <Drawer
      anchor="right"
      open={investigationOpen}
      onClose={closeInvestigation}
      PaperProps={{
        sx: {
          width: { xs: '100%', md: 560 },
          bgcolor: '#fff',
          top: `${TOOL_HEADER_HEIGHT}px`,
          height: `calc(100% - ${TOOL_HEADER_HEIGHT}px)`,
        },
      }}
    >
      <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
        <Tabs value={investigationTab} onChange={(_e, v) => setInvestigationTab(v)} sx={{ mb: 2 }}>
          <Tab value="explain" label="Explain" />
          <Tab value="timeline" label="Timeline" />
          <Tab value="network" label="Network" />
        </Tabs>
        {investigationTab === 'timeline' ? (
          <InvestigationTimelinePanel />
        ) : investigationTab === 'network' ? (
          <InvestigationNetworkPanel />
        ) : (
          <InvestigationPanel />
        )}
      </Box>
    </Drawer>
  );
};

export default InvestigationDrawer;
