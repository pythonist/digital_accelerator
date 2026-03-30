import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import SharedWorkbenchLayout from '../../shared/layout/SharedWorkbenchLayout';
import { getMuleNavigationSections } from './navigationConfig';
import { muleTheme } from '../theme';
import InvestigationDrawer from '../components/InvestigationDrawer';
import ModelRegistryDrawer from '../components/ModelRegistryDrawer';
import OutcomeIntelligenceBanner from '../components/OutcomeIntelligenceBanner';

const MainLayout = ({ children, activeScreen, setActiveScreen, hasData }) => {
  const navigate = useNavigate();
  const { username, activeBankName, activeEnv, handleLogout } = useAppContext();

  return (
    <ThemeProvider theme={muleTheme}>
      <CssBaseline />
      <SharedWorkbenchLayout
        moduleLabel="Mule Detection Workbench"
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        sections={getMuleNavigationSections(hasData)}
        username={username}
        activeEnvironment={activeBankName || activeEnv}
        onBackToTools={() => navigate('/tools', { state: { skipRestore: true } })}
        onLogout={async () => {
          await handleLogout();
          navigate('/login');
        }}
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            p: { xs: 2, md: 3 },
            bgcolor: 'transparent',
          }}
        >
          <OutcomeIntelligenceBanner />
          {children}
        </Box>
      </SharedWorkbenchLayout>
      <InvestigationDrawer />
      <ModelRegistryDrawer />
    </ThemeProvider>
  );
};

export default MainLayout;
