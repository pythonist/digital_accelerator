// frontend/src/tools/btsy/layout/MainLayout.jsx
import React from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import { btsyTheme } from '../theme';
import SharedWorkbenchLayout from '../../shared/layout/SharedWorkbenchLayout';
import { btsyNavigationSections } from './navigationConfig';

const MainLayout = ({ children, activeScreen, setActiveScreen }) => {
  const navigate = useNavigate();
  const { username, activeBankName, activeEnv, handleLogout } = useAppContext();

  return (
    <ThemeProvider theme={btsyTheme}>
      <CssBaseline />
      <SharedWorkbenchLayout
        moduleLabel="Cortex V2"
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        sections={btsyNavigationSections}
        accentColor="#D04A02"
        navShape="sharp"
        username={username}
        activeEnvironment={activeBankName || activeEnv}
        onBackToTools={() => navigate('/tools')}
        onLogout={async () => {
          await handleLogout();
          navigate('/login');
        }}
      >
        {children}
      </SharedWorkbenchLayout>
    </ThemeProvider>
  );
};

export default MainLayout;
