// frontend/src/tools/btsy/components/StepNavigation.jsx
import React from 'react';
import { Box, Stepper, Step, StepLabel, StepButton } from '@mui/material';

const FOUNDATION_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Schema Mapping' },
  { id: 'types', label: 'Data Types' },
  { id: 'normalization', label: 'Normalization' },
  { id: 'summary', label: 'Summary' },
];

const StepNavigation = ({ activeStep, onStepClick, completedSteps }) => {
  const activeIndex = FOUNDATION_STEPS.findIndex(s => s.id === activeStep);

  return (
    <Box sx={{ width: '100%', mb: 3 }}>
      <Stepper activeStep={activeIndex} alternativeLabel>
        {FOUNDATION_STEPS.map((step, index) => {
          const isCompleted = completedSteps.includes(step.id);
          const isActive = step.id === activeStep;
          const canNavigate = index <= activeIndex || isCompleted;

          return (
            <Step key={step.id} completed={isCompleted}>
              <StepButton
                onClick={() => canNavigate && onStepClick(step.id)}
                disabled={!canNavigate}
              >
                <StepLabel
                  sx={{
                    '& .MuiStepLabel-label': {
                      fontSize: { xs: '0.75rem', sm: '0.875rem' },
                      fontWeight: isActive ? 600 : 400,
                    }
                  }}
                >
                  {step.label}
                </StepLabel>
              </StepButton>
            </Step>
          );
        })}
      </Stepper>
    </Box>
  );
};

export default StepNavigation;
