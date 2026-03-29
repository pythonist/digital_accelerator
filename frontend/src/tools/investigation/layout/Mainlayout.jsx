import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import SharedWorkbenchLayout from '../../shared/layout/SharedWorkbenchLayout';
import { getInvestigationNavigationSections } from './navigationConfig';
import { appTheme } from '../theme';

const MainLayout = ({ children, activeScreen, setActiveScreen, headerActions = null }) => {
  const navigate = useNavigate();
  const { datasetLoaded, username, activeBankName, activeEnv, handleLogout } = useAppContext();

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SharedWorkbenchLayout
        moduleLabel="Investigation Workbench"
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        sections={getInvestigationNavigationSections(datasetLoaded)}
        username={username}
        activeEnvironment={activeBankName || activeEnv}
        headerActions={headerActions}
        onBackToTools={() => navigate('/tools')}
        onLogout={async () => {
          await handleLogout();
          navigate('/login');
        }}
      >
        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </Box>
      </SharedWorkbenchLayout>
    </ThemeProvider>
  );
};

export default MainLayout;
