import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import Sidebar from './Sidebar';
import Header from './Header'; 
import { appTheme } from '../theme'; // ✅ Import the shared theme

const MainLayout = ({ children, activeScreen, setActiveScreen }) => {
  return (
    <ThemeProvider theme={appTheme}> {/* ✅ Apply shared theme */}
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
        <Sidebar activeTab={activeScreen} setActiveTab={setActiveScreen} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Header setActiveTab={setActiveScreen} />
          <Box 
            component="main" 
            sx={{ 
              flex: 1, 
              overflowY: 'auto', 
              overflowX: 'hidden',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default MainLayout;