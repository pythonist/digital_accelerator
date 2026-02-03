// frontend/src/tools/btsy/layout/MainLayout.jsx
import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { btsyTheme } from '../theme';

const MainLayout = ({ children, activeScreen, setActiveScreen }) => {
  return (
    <ThemeProvider theme={btsyTheme}>
      <CssBaseline />
      <Box sx={{ height: '100dvh', display: 'flex', overflow: 'hidden' }}>
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
          <Header />
          <Box
            component="main"
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
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
