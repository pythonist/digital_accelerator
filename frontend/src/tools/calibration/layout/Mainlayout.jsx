import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import { useCalibration } from '../context/CalibrationContext';
import SharedWorkbenchLayout from '../../shared/layout/SharedWorkbenchLayout';
import { getCalibrationNavigationSections } from './navigationConfig';
import { appTheme } from '../theme';

const MainLayout = ({ children, activeScreen, setActiveScreen }) => {
  const navigate = useNavigate();
  const { username, activeBankName, activeEnv, handleLogout } = useAppContext();
  const { currentStep, run, step0Complete } = useCalibration();

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SharedWorkbenchLayout
        moduleLabel="Calibration Workbench"
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        sections={getCalibrationNavigationSections({
          step0Complete,
          runReady: Boolean(run),
          currentStep,
        })}
        username={username}
        activeEnvironment={activeBankName || activeEnv}
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
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            bgcolor: 'background.default',
          }}
        >
          {children}
        </Box>
      </SharedWorkbenchLayout>
    </ThemeProvider>
  );
};

export default MainLayout;
