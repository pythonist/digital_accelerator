// frontend/src/tools/mule_detection/MulePlatform.jsx
import React, { useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useAppContext } from '@context/AppContext';
import { muleTheme } from './theme';
import { useMuleStore } from './store/muleStore';
import usePersistedWorkbenchScreen from '../../hooks/usePersistedWorkbenchScreen';

// Layout
import MainLayout from './layout/MainLayout';

// Screens
import MuleUploadScreen from './screens/MuleUploadScreen';
import MuleDashboard from './screens/MuleDashboard';
import DataIntrospectionScreen from './screens/DataIntrospectionScreen';
import FeatureStoreScreen from './screens/FeatureStoreScreen';
import FeatureExplorerScreen from './screens/FeatureExplorerScreen';
import ModelInferenceScreen from './screens/ml/ModelInferenceScreen';
import ModelLabScreen from './screens/ml/ModelLabScreen';
import FeatureEngineeringScreen from './screens/FeatureEngineeringScreen';
import TrainModelScreen from './screens/TrainModelScreen';
import RuleEngineScreen from './screens/RuleEngineScreen';
import HybridScoringScreen from './screens/HybridScoringScreen';
import NetworkGraphScreen from './screens/NetworkGraphScreen';
import PatternAnalysisScreen from './screens/PatternAnalysisScreen';
import ExplainabilityScreen from './screens/ExplainabilityScreen';
import RiskDashboardScreen from './screens/RiskDashboardScreen';

const MulePlatform = () => {
  const { activeEnv } = useAppContext();
  
  const [activeScreen, setActiveScreen] = usePersistedWorkbenchScreen('mule_detection', 'upload');
  const { hasData, hasModel, dataStats, loadingStatus, refreshStatus, setEnvId, loadAccounts, setSelectedAccountId, openInvestigation } = useMuleStore();

  // Set environment ID in localStorage for API calls
  useEffect(() => {
    if (activeEnv) {
      setEnvId(activeEnv);
    }
  }, [activeEnv, setEnvId]);

  useEffect(() => {
    refreshStatus();
  }, [activeEnv, refreshStatus]);

  useEffect(() => {
    if (!hasData) return;
    loadAccounts();
  }, [hasData, loadAccounts]);

  const handleUploadComplete = async () => {
    await refreshStatus();
    setActiveScreen('account-analysis');
  };

  const handleAccountSelect = (accountId) => {
    setSelectedAccountId(accountId);
    openInvestigation(accountId);
  };

  const handleNavigate = (screen) => {
    setActiveScreen(screen);
  };

  const renderScreen = () => {
    switch (activeScreen) {
      case 'upload':
        return (
          <MuleUploadScreen 
            onUploadComplete={handleUploadComplete}
            loading={loadingStatus}
          />
        );
      
      case 'account-analysis':
        return (
          <MuleDashboard 
            onAccountSelect={handleAccountSelect}
            dataStats={dataStats}
            onReupload={() => setActiveScreen('upload')}
          />
        );
      
      case 'data-introspection':
        return <DataIntrospectionScreen />;
      
      case 'feature-engineering':
        return <FeatureEngineeringScreen />;

      case 'feature-store':
        return <FeatureStoreScreen />;

      case 'feature-explorer':
        return <FeatureExplorerScreen />;

      case 'train-model':
        return <ModelLabScreen />;

      case 'train-model-legacy':
        return <TrainModelScreen />;

      case 'inference':
        return <ModelInferenceScreen />;
      
      case 'rule-engine':
        return <RuleEngineScreen />;

      case 'hybrid-scoring':
        return <HybridScoringScreen onAccountSelect={handleAccountSelect} />;

      case 'network-graph':
        return <NetworkGraphScreen />;

      case 'pattern-analysis':
        return <PatternAnalysisScreen onAccountSelect={handleAccountSelect} />;

      case 'explainability':
        return <ExplainabilityScreen />;

      case 'risk-dashboard':
        return <RiskDashboardScreen onAccountSelect={handleAccountSelect} />;
      
      default:
        return hasData ? (
          <MuleDashboard 
            onAccountSelect={handleAccountSelect}
            dataStats={dataStats}
            onReupload={() => setActiveScreen('upload')}
          />
        ) : (
          <MuleUploadScreen 
            onUploadComplete={handleUploadComplete}
            loading={loadingStatus}
          />
        );
    }
  };

  return (
    <ThemeProvider theme={muleTheme}>
      <CssBaseline />
      <MainLayout 
        activeScreen={activeScreen}
        setActiveScreen={handleNavigate}
        hasData={hasData}
        hasMLModel={hasModel}
        dataStats={dataStats}
      >
        {renderScreen()}
      </MainLayout>
    </ThemeProvider>
  );
};

export default MulePlatform;
