import React, { useState, useEffect } from 'react';
import { Box, Alert } from '@mui/material';
import { useAppContext } from '@context/AppContext';
import { CalibrationProvider, useCalibration } from './context/CalibrationContext';
import MainLayout from './layout/Mainlayout';

// ✅ NEW: Import the Step 0 Orchestrator from your new folder
import Step0DataFoundation from './screens/Step0_DataFoundation';

// Import Other Workflow Screens
import ScenarioCatalogScreen from './screens/ScenarioCatalogScreen';
import ScenarioDefinitionScreen from './screens/PopulationExplorerScreen.jsx';
import AggregationScreen from './screens/AggregationScreen';
import ValidationScreen from './screens/ValidationScreen';
import CalibrationScreen from './screens/CalibrationScreen';
import SummaryScreen from './screens/SummaryScreen';
import ComparisonScreen from './screens/ComparisonScreen';
import FinalReportScreen from './screens/FinalReportScreen';
import ApprovalScreen from './screens/ApprovalScreen';

const CalibrationRouter = ({ activeScreen, setActiveScreen }) => {
  const { activeEnv, username } = useAppContext(); 
  const { currentStep, goToStep, runId, run } = useCalibration();

  // Handle Sidebar Clicks (Navigation)
  useEffect(() => {
    // Prevent auto-redirect for setup steps
    if (['data_load', 'data_mapping', 'scenario_catalog', 'comparison'].includes(activeScreen)) return;

    if (runId && activeScreen !== currentStep) {
        goToStep(activeScreen);
    }
  }, [activeScreen, runId, currentStep, goToStep]);

  // Sync sidebar to current step (Auto-advance logic)
  useEffect(() => {
    if (currentStep && 
        !['data_load', 'data_mapping', 'scenario_catalog', 'comparison'].includes(activeScreen) &&
        currentStep !== activeScreen) {
       setActiveScreen(currentStep);
    }
  }, [currentStep, activeScreen, setActiveScreen]);

  const renderScreen = () => {
    switch (activeScreen) {
      // ✅ CASE 1: Step 0 - Data Foundation
      // Replaces the old DataLoadScreen with your new Wizard
      case 'data_load':
        return <Step0DataFoundation envId={activeEnv} userId={username} />;
      
      // ✅ CASE 2: Handle "Schema Mapping" click from sidebar
      // Redirects to the same wizard (since mapping is now Step 3 inside Step 0)
      case 'data_mapping':
        return <Step0DataFoundation envId={activeEnv} userId={username} />;

      // --- Rest of the Workflow (Unchanged) ---
      case 'scenario_catalog':
        return <ScenarioCatalogScreen />; 
      case 'scenario':
        return <ScenarioDefinitionScreen />;
      case 'aggregation':
        return <AggregationScreen />;
      case 'validation':
        return <ValidationScreen />;
      case 'calibration':
        return <CalibrationScreen />;
      
      case 'approval':
        return <ApprovalScreen />;

      case 'summary':
        if (run?.status === 'APPROVED' || run?.status === 'REJECTED' || run?.selected_threshold) {
          return <FinalReportScreen />;
        }
        return <SummaryScreen />;
        
      case 'comparison':
        return <ComparisonScreen />;
        
      default:
        if (!runId) return <ScenarioCatalogScreen />; 
        return <ScenarioDefinitionScreen />;
    }
  };

  return renderScreen();
};

const CalibrationPlatform = () => {
  const { activeEnv, username } = useAppContext();
  const [activeScreen, setActiveScreen] = useState('scenario_catalog'); 

  if (!activeEnv) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">Please select an environment first.</Alert>
      </Box>
    );
  }

  return (
    <CalibrationProvider envId={activeEnv} userId={username}>
      <MainLayout activeScreen={activeScreen} setActiveScreen={setActiveScreen}>
        <Box sx={{ 
          height: '100%', 
          overflow: 'auto', 
          display: 'flex', 
          flexDirection: 'column' 
        }}>
          <CalibrationRouter activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
        </Box>
      </MainLayout>
    </CalibrationProvider>
  );
};

export default CalibrationPlatform;