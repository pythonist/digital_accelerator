// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/UniverseFooterActions.jsx
import React from 'react';
import { Box, Button, Alert } from '@mui/material';

/**
 * Footer actions for proceeding to next step
 */
const UniverseFooterActions = ({ hasFrozenUniverse, onProceed }) => {
  if (!hasFrozenUniverse) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Freeze at least one universe to proceed to the next step. Frozen universes are immutable and ensure 
        consistency throughout the calibration process.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
      <Button
        variant="contained"
        onClick={onProceed}
      >
        Proceed to Step 2: Behaviour Definition
      </Button>
    </Box>
  );
};

export default UniverseFooterActions;
