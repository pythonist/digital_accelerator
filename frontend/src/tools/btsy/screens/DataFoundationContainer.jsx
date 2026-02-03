// frontend/src/tools/btsy/screens/DataFoundationContainer.jsx
import React, { useState } from 'react';
import { Box } from '@mui/material';
import StepNavigation from '../components/StepNavigation';
import DataUploadStep from './foundation/DataUploadStep';
import SchemaMappingStep from './foundation/SchemaMappingStep';
import DataTypeReviewStep from './foundation/DataTypeReviewStep';
import NormalizationStep from './foundation/NormalizationStep';
import SummaryStep from './foundation/SummaryStep';
import { useSnapshot } from '../context/SnapshotContext';

const DataFoundationContainer = ({ onProceed, onBackToSnapshots }) => {
  const [activeStep, setActiveStep] = useState('upload');
  const [completedSteps, setCompletedSteps] = useState([]);
  const { draftSnapshot, activeSnapshot } = useSnapshot();

  const handleStepClick = (stepId) => {
    setActiveStep(stepId);
  };

  const handleStepComplete = (stepId) => {
    if (!completedSteps.includes(stepId)) {
      setCompletedSteps(prev => [...prev, stepId]);
    }
    
    // Auto-advance to next step
    const steps = ['upload', 'mapping', 'types', 'normalization', 'summary'];
    const currentIndex = steps.indexOf(stepId);
    if (currentIndex < steps.length - 1) {
      setActiveStep(steps[currentIndex + 1]);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 'upload':
        return <DataUploadStep onComplete={() => handleStepComplete('upload')} />;
      case 'mapping':
        return <SchemaMappingStep onComplete={() => handleStepComplete('mapping')} />;
      case 'types':
        return <DataTypeReviewStep onComplete={() => handleStepComplete('types')} />;
      case 'normalization':
        return <NormalizationStep onComplete={() => handleStepComplete('normalization')} />;
      case 'summary':
        return (
          <SummaryStep 
            onComplete={() => {
              handleStepComplete('summary');
              // After snapshot creation, the context will lock foundation
            }} 
            onProceed={onProceed}
            draftSnapshot={draftSnapshot || activeSnapshot}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <StepNavigation
        activeStep={activeStep}
        onStepClick={handleStepClick}
        completedSteps={completedSteps}
      />
      {renderStep()}
    </Box>
  );
};

export default DataFoundationContainer;
