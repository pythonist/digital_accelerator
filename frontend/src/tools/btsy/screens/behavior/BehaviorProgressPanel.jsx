import React from 'react';
import { Paper, Typography, Box, LinearProgress, Stepper, Step, StepLabel } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

const BehaviorProgressPanel = ({ stage }) => {
  // stage -1: not started
  // stage 0: initializing
  // stage 1: computing
  // stage 2: finalizing
  // stage 4: complete
  
  if (stage < 0) return null;

  const steps = [
    { label: 'Initializing', value: 0 },
    { label: 'Computing Behaviors', value: 1 },
    { label: 'Finalizing', value: 2 },
    { label: 'Complete', value: 4 }
  ];

  const activeStep = stage === 4 ? 3 : Math.min(stage, 2);
  const isComplete = stage === 4;

  return (
    <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2, bgcolor: '#f8fafc' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
        Run Progress
      </Typography>
      
      <Stepper activeStep={activeStep} sx={{ mb: 2 }}>
        {steps.map((step, index) => (
          <Step key={step.label} completed={stage > step.value || isComplete}>
            <StepLabel
              StepIconComponent={() => {
                if (stage > step.value || (isComplete && index === 3)) {
                  return <CheckCircleIcon sx={{ color: '#10b981', fontSize: 24 }} />;
                } else if (stage === step.value) {
                  return <RadioButtonUncheckedIcon sx={{ color: '#D04A02', fontSize: 24 }} />;
                } else {
                  return <RadioButtonUncheckedIcon sx={{ color: '#cbd5e1', fontSize: 24 }} />;
                }
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: stage === step.value ? 700 : 400,
                  color: stage >= step.value ? '#1e293b' : '#94a3b8'
                }}
              >
                {step.label}
              </Typography>
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {!isComplete && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress 
            sx={{ 
              height: 6, 
              borderRadius: 1,
              bgcolor: '#e2e8f0',
              '& .MuiLinearProgress-bar': {
                bgcolor: '#D04A02'
              }
            }} 
          />
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#64748b' }}>
            Processing behavior run...
          </Typography>
        </Box>
      )}

      {isComplete && (
        <Box sx={{ mt: 2, p: 1.5, bgcolor: '#f0fdf4', border: '1px solid #86efac', borderRadius: 1 }}>
          <Typography variant="body2" sx={{ color: '#166534', fontWeight: 600 }}>
            ✓ Behavior run completed successfully
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

export default BehaviorProgressPanel;