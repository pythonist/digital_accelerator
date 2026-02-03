// frontend/src/tools/mule_detection/MulePlatform.jsx
import React, { useState, useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useAppContext } from '@context/AppContext';
import { muleTheme } from './theme';
import muleApi from './services/muleApi';

// Layout
import MainLayout from './layout/MainLayout';

// Screens
import MuleUploadScreen from './screens/MuleUploadScreen';
import MuleDashboard from './screens/MuleDashboard';
import MuleAccountScreen from './screens/MuleAccountScreen';
import DataIntrospectionScreen from './screens/DataIntrospectionScreen';

// NEW ML Screens (modular architecture)
import MLOverviewScreen from './screens/ml/MLOverviewScreen';
import TrainingConfigScreen from './screens/ml/TrainingConfigScreen';
import TrainingMonitorScreen from './screens/ml/TrainingMonitorScreen';
import DecisionEngineScreen from './screens/ml/DecisionEngineScreen';

const MulePlatform = () => {
  const { activeEnv } = useAppContext();
  
  const [activeScreen, setActiveScreen] = useState('upload');
  const [hasData, setHasData] = useState(false);
  const [hasMLModel, setHasMLModel] = useState(false);
  const [dataStats, setDataStats] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mlTrainingJobId, setMlTrainingJobId] = useState(null);

  // Set environment ID in localStorage for API calls
  useEffect(() => {
    if (activeEnv?.id) {
      localStorage.setItem('activeEnvId', activeEnv.id);
      console.log('Environment ID set:', activeEnv.id);
    }
  }, [activeEnv]);

  useEffect(() => {
    checkDataStatus();
  }, [activeEnv]);

  const checkDataStatus = async () => {
    setLoading(true);
    try {
      const response = await muleApi.getDataStatus();
      
      if (response.has_data) {
        setHasData(true);
        setDataStats(response.stats);
        setHasMLModel(response.has_ml_model || false);
        
        // Only auto-navigate if we're on upload screen
        if (activeScreen === 'upload') {
          setActiveScreen('dashboard');
        }
      } else {
        setHasData(false);
        setHasMLModel(false);
        setActiveScreen('upload');
      }
    } catch (error) {
      console.error('Failed to check data status:', error);
      setHasData(false);
      setHasMLModel(false);
      setActiveScreen('upload');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = async () => {
    await checkDataStatus();
  };

  const handleAccountSelect = (accountId) => {
    setSelectedAccount(accountId);
    setActiveScreen('account');
  };

  const handleBackToDashboard = () => {
    setSelectedAccount(null);
    setActiveScreen('dashboard');
  };

  const handleNavigate = (screen) => {
    if (screen === 'account') {
      return; // Don't allow direct navigation to account screen
    }
    setActiveScreen(screen);
    setSelectedAccount(null);
  };

  const renderScreen = () => {
    switch (activeScreen) {
      case 'upload':
        return (
          <MuleUploadScreen 
            onUploadComplete={handleUploadComplete}
            loading={loading}
          />
        );
      
      case 'dashboard':
        return (
          <MuleDashboard 
            onAccountSelect={handleAccountSelect}
            dataStats={dataStats}
            onReupload={() => setActiveScreen('upload')}
          />
        );
      
      case 'account':
        return (
          <MuleAccountScreen 
            accountId={selectedAccount}
            onBack={handleBackToDashboard}
          />
        );
      
      case 'introspect':
        return <DataIntrospectionScreen />;
      
      // NEW ML SCREENS
      case 'ml-overview':
        return <MLOverviewScreen navigateTo={handleNavigate} />;
      
      case 'ml-training':
        return (
          <TrainingConfigScreen
            navigateTo={handleNavigate}
            onTrainingStarted={(jobId) => {
              setMlTrainingJobId(jobId);
              setActiveScreen('ml-monitor');
            }}
          />
        );
      
      case 'ml-monitor':
        return (
          <TrainingMonitorScreen
            navigateTo={handleNavigate}
            jobId={mlTrainingJobId || 'local_sync_completed'}
          />
        );
      
      case 'ml-decision':
        return <DecisionEngineScreen />;
      
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
            loading={loading}
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
        hasMLModel={hasMLModel}
        dataStats={dataStats}
      >
        {renderScreen()}
      </MainLayout>
    </ThemeProvider>
  );
};

export default MulePlatform;
