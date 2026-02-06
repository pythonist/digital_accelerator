// frontend/src/tools/mule_detection/layout/MainLayout.jsx
import React from 'react';
import { Box } from '@mui/material';
import Sidebar from './Sidebar';
import Header from './Header';
import { TOOL_HEADER_HEIGHT } from './layout.constants';
import InvestigationDrawer from '../components/InvestigationDrawer';

const MainLayout = ({ children, activeScreen, setActiveScreen, hasData, hasMLModel, dataStats }) => {
  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: '#fafafa' }}>
      <Sidebar
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        hasData={hasData}
        hasMLModel={hasMLModel}
        dataStats={dataStats}
      />
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: '#fafafa',
          overflow: 'hidden',
          height: '100vh',
          p: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Header hasData={hasData} />
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            height: `calc(100vh - ${TOOL_HEADER_HEIGHT}px)`,
            p: 3,
            bgcolor: '#fafafa'
          }}
        >
          {children}
        </Box>
      </Box>
      <InvestigationDrawer />
    </Box>
  );
};

export default MainLayout;
