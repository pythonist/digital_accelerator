import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import SharedWorkbenchLayout from '../../shared/layout/SharedWorkbenchLayout';
import { getInvestigationNavigationSections } from './navigationConfig';
import { appTheme } from '../theme';
import { readFccSentinelHandoff } from '../../../utils/fccSentinelHandoff';

const MainLayout = ({ children, activeScreen, setActiveScreen, headerActions = null }) => {
  const navigate = useNavigate();
  const { datasetLoaded, caseList, priorityBuckets, username, activeBankName, activeEnv, handleLogout } = useAppContext();
  const handoff = readFccSentinelHandoff();
  const hasFccBridgeSession = Boolean(
    handoff?.publish_id
    || handoff?.run_id
    || handoff?.workflow_session_id
    || handoff?.imported_case_count,
  );
  const hasInvestigationData = Boolean(
    datasetLoaded
    || (Array.isArray(caseList) && caseList.length > 0)
    || (Array.isArray(priorityBuckets?.allCases) && priorityBuckets.allCases.length > 0)
    || hasFccBridgeSession,
  );

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SharedWorkbenchLayout
        moduleLabel="Investigation Workbench"
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        sections={getInvestigationNavigationSections(hasInvestigationData)}
        username={username}
        activeEnvironment={activeBankName || activeEnv}
        headerActions={headerActions}
        onOpenSettings={() => setActiveScreen('settings')}
        onBackToTools={() => navigate('/tools', { state: { skipRestore: true } })}
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
