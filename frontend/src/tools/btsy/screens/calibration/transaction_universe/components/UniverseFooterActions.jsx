// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/UniverseFooterActions.jsx
import React from 'react';
import { Box, Button, Alert } from '@mui/material';
import { CheckCircle as CheckCircleIcon, Info as InfoIcon } from '@mui/icons-material';

/**
 * Footer actions for proceeding to next step
 */
const UniverseFooterActions = ({ hasFrozenUniverse, onProceed }) => {
  if (!hasFrozenUniverse) {
    return (
      <Alert 
        severity="info" 
        icon={<InfoIcon />}
        sx={{ mt: 3, bgcolor: '#eff6ff', border: '1px solid #bfdbfe' }}
      >
        Freeze at least one universe to proceed to the next step. Frozen universes are immutable and ensure 
        consistency throughout the calibration process.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
      <Button
        variant="contained"
        size="large"
        onClick={onProceed}
        startIcon={<CheckCircleIcon />}
        sx={{
          bgcolor: '#16a34a',
          '&:hover': { bgcolor: '#15803d' },
          fontWeight: 600,
          textTransform: 'none',
          px: 4,
          py: 1.5,
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
        }}
      >
        Proceed to Step 2: Behaviour Definition
      </Button>
    </Box>
  );
};

export default UniverseFooterActions;