import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { appTheme } from '../theme'; // ✅ calibration theme

const MainLayout = ({ children, activeScreen, setActiveScreen }) => {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box sx={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
        <Sidebar
          activeScreen={activeScreen}
          setActiveScreen={setActiveScreen}
        />
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <Header activeScreen={activeScreen} />
          <Box
            component="main"
            sx={{
              flex: 1,
              overflowY: 'auto',
              bgcolor: 'background.default',
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
