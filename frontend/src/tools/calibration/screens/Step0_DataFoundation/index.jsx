// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/index.jsx
// ============================================================================
/**
 * Step 0 Data Foundation - Main Orchestrator
 * Flow: Upload → Schema → Mapping → Merge → Validation
 */
import React, { useState } from 'react';
import { Box, Paper, Typography, Stepper, Step, StepLabel, Alert } from '@mui/material';
import {
  CloudUpload, ViewColumn, Map as MapIcon, MergeType, CheckCircle
} from '@mui/icons-material';

// Sub-screens
import DataUploadScreen from './DataUploadScreen';
import SchemaInspector from './SchemaInspector';
import SchemaMapper from './SchemaMapper';
import MergeOptionSelector from './MergeOptionSelector';
import ReadinessGate from './ReadinessGate';

const STEPS = [
  { id: 'upload', label: 'Upload Data', icon: CloudUpload, component: DataUploadScreen },
  { id: 'schema', label: 'Schema Review', icon: ViewColumn, component: SchemaInspector },
  { id: 'mapping', label: 'Column Mapping', icon: MapIcon, component: SchemaMapper },
  { id: 'merge', label: 'Join Builder', icon: MergeType, component: MergeOptionSelector },
  { id: 'validate', label: 'Validation', icon: CheckCircle, component: ReadinessGate }
];

const Step0DataFoundation = ({ envId, userId }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());

  const handleStepComplete = () => {
    // Mark current step as complete
    const currentStepId = STEPS[activeStep].id;
    setCompletedSteps(prev => new Set([...prev, currentStepId]));
    
    // Auto-advance to next step
    if (activeStep < STEPS.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleStepClick = (index) => {
    // Allow clicking only on completed steps or current step
    if (index <= activeStep || completedSteps.has(STEPS[index].id)) {
      setActiveStep(index);
    }
  };

  const CurrentComponent = STEPS[activeStep].component;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#f8fafc' }}>
      {/* Header with Progress Stepper */}
      <Paper 
        elevation={0} 
        sx={{ 
          px: 4, 
          py: 2.5, 
          borderBottom: '2px solid #e2e8f0',
          bgcolor: '#fff'
        }}
      >
        <Typography 
          variant="h6" 
          sx={{ 
            fontWeight: 700, 
            color: '#0f172a',
            mb: 2.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <CloudUpload sx={{ color: '#ea580c' }} />
          Step 0: Data Foundation
        </Typography>
        
        <Stepper activeStep={activeStep} alternativeLabel>
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isCompleted = completedSteps.has(step.id);
            const isClickable = index <= activeStep || isCompleted;
            
            return (
              <Step key={step.id} completed={isCompleted}>
                <StepLabel
                  onClick={() => isClickable && handleStepClick(index)}
                  sx={{
                    cursor: isClickable ? 'pointer' : 'default',
                    '& .MuiStepLabel-label': {
                      fontSize: '0.875rem',
                      fontWeight: activeStep === index ? 600 : 400,
                      color: isCompleted ? '#10b981' : activeStep === index ? '#ea580c' : '#94a3b8'
                    }
                  }}
                  StepIconComponent={() => (
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: isCompleted ? '#dcfce7' : activeStep === index ? '#fed7aa' : '#f1f5f9',
                        border: `2px solid ${isCompleted ? '#10b981' : activeStep === index ? '#ea580c' : '#cbd5e1'}`
                      }}
                    >
                      {isCompleted ? (
                        <CheckCircle sx={{ color: '#10b981', fontSize: 20 }} />
                      ) : (
                        <StepIcon 
                          sx={{ 
                            fontSize: 20,
                            color: activeStep === index ? '#ea580c' : '#94a3b8'
                          }} 
                        />
                      )}
                    </Box>
                  )}
                >
                  {step.label}
                </StepLabel>
              </Step>
            );
          })}
        </Stepper>
      </Paper>

      {/* Content Area */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {activeStep === 0 && (
          <Alert severity="info" sx={{ mb: 3, bgcolor: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <Typography variant="body2">
              <strong>Getting Started:</strong> Upload your CSV files. The system will automatically 
              infer column types and guide you through mapping and merging.
            </Typography>
          </Alert>
        )}
        
        <CurrentComponent 
          envId={envId} 
          userId={userId}
          onComplete={handleStepComplete}
          completedSteps={Array.from(completedSteps)}
        />
      </Box>
    </Box>
  );
};

export default Step0DataFoundation;