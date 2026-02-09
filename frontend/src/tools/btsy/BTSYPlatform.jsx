// frontend/src/tools/btsy/BTSYPlatform.jsx
import React, { useState } from 'react';
import { Box, Alert } from '@mui/material';
import { useAppContext } from '@context/AppContext';
import MainLayout from './layout/MainLayout';
import FoundationHomeScreen from './screens/FoundationHomeScreen';
import AutoRunCalibrationRunsScreen from './screens/autorun/AutoRunCalibrationRunsScreen';
import TransactionUniverseScreen from './screens/calibration/transaction_universe/TransactionUniverseScreen';
import { SnapshotProvider, useSnapshot } from './context/SnapshotContext';
import { CalibrationRunProvider, useCalibrationRun } from './context/CalibrationRunContext';
import CortexScenarioBuilderScreen from './screens/behavior/CortexScenarioBuilderScreen';
import BehaviorReconstructionScreen from './screens/behavior/BehaviorReconstructionScreen';
import ScenarioCalibrationWorkbench from './screens/calibration_workbench/ScenarioCalibrationWorkbench';
import MLValidationWorkbench from './screens/advanced_analysis/MLValidationWorkbench';
import EligibilityAlertGenerationWorkbench from './screens/alerting/EligibilityAlertGenerationWorkbench';
import STRAlignmentValidationWorkbench from './screens/validation/STRAlignmentValidationWorkbench';
import MissedSTRAnalysisWorkbench from './screens/validation/MissedSTRAnalysisWorkbench';
import ScenarioInteractionAnalysisWorkbench from './screens/operations_intelligence/ScenarioInteractionAnalysisWorkbench';
import AnalystWorkloadSimulationWorkbench from './screens/operations_intelligence/AnalystWorkloadSimulationWorkbench';
import ScenarioWorkbenchScreen from './screens/scenarios/ScenarioWorkbenchScreen';

// Placeholder screens for future development
const PlaceholderScreen = ({ title }) => (
  <Box sx={{ p: 4 }}>
    <Alert severity="info">
      <strong>{title}</strong> - Coming Soon
    </Alert>
  </Box>
);

const BTSYRouterInner = ({ activeScreen, setActiveScreen }) => {
  const { activeSnapshot } = useSnapshot();
  const { activeCalibrationRunId } = useCalibrationRun();

  switch (activeScreen) {
    case 'foundation':
      return (
        <FoundationHomeScreen onProceedToRuns={() => setActiveScreen('runs')} />
      );
      
    case 'runs':
      return <AutoRunCalibrationRunsScreen />;
      
    case 'universe':
      if (!activeCalibrationRunId) {
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="warning" sx={{ mb: 3 }}>
              Please create a calibration run first from the "Calibration Runs" screen.
            </Alert>
          </Box>
        );
      }
      return (
        <Box sx={{ p: 3 }}>
          <TransactionUniverseScreen
            calibrationRunId={parseInt(activeCalibrationRunId, 10)}
            snapshotId={activeSnapshot?.snapshot_id}
            onComplete={() => setActiveScreen('runs')}
            navigateTo={(screen) => setActiveScreen(screen)}
          />
        </Box>
      );
      
    case 'behavior':
      return (
        <CortexScenarioBuilderScreen calibrationRunId={activeCalibrationRunId ? parseInt(activeCalibrationRunId, 10) : null} />
      );
    case 'behavior_reconstruction':
      return <BehaviorReconstructionScreen />;
      
    case 'calibration':
      return <ScenarioCalibrationWorkbench />;

    case 'scenarios':
      return <ScenarioWorkbenchScreen />;
      
    case 'ml_validation':
      return <MLValidationWorkbench />;

    case 'alerting_eligibility':
      return <EligibilityAlertGenerationWorkbench />;

    case 'validation_str_alignment':
      return <STRAlignmentValidationWorkbench />;

    case 'validation_missed_str':
      return <MissedSTRAnalysisWorkbench />;
      
    case 'ops_scenario_interaction':
      return <ScenarioInteractionAnalysisWorkbench />;

    case 'ops_workload':
      return <AnalystWorkloadSimulationWorkbench />;

    case 'analysis':
      return <PlaceholderScreen title="Impact Analysis" />;
      
    case 'comparison':
      return <PlaceholderScreen title="Scenario Comparison" />;
      
    default:
      return <FoundationHomeScreen onProceedToRuns={() => setActiveScreen('runs')} />;
  }
};

const BTSYPlatform = () => {
  const { activeEnv } = useAppContext();
  const [activeScreen, setActiveScreen] = useState('foundation');
  
  // Auto-navigate if a hint is set
  React.useEffect(() => {
    const next = sessionStorage.getItem('btsy_next_screen');
    if (next) {
      setActiveScreen(next);
      sessionStorage.removeItem('btsy_next_screen');
    }
  }, []);

  React.useEffect(() => {
    if (typeof activeEnv === 'string' && activeEnv.trim()) {
      sessionStorage.setItem('btsy_env_id', activeEnv);
    }
  }, [activeEnv]);

  React.useEffect(() => {
    const handler = (ev) => {
      const screen = ev?.detail?.screen;
      if (typeof screen === 'string' && screen.trim()) {
        setActiveScreen(screen);
      }
    };
    window.addEventListener('btsy:navigate', handler);
    return () => window.removeEventListener('btsy:navigate', handler);
  }, []);

  if (!activeEnv) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">Please select an environment first.</Alert>
      </Box>
    );
  }

  return (
    <SnapshotProvider>
      <CalibrationRunProvider>
        <MainLayout activeScreen={activeScreen} setActiveScreen={setActiveScreen}>
          <BTSYRouterInner 
            activeScreen={activeScreen} 
            setActiveScreen={setActiveScreen} 
          />
        </MainLayout>
      </CalibrationRunProvider>
    </SnapshotProvider>
  );
};

export default BTSYPlatform;
