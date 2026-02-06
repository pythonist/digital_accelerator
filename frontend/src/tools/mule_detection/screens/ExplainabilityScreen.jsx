import React from 'react';
import { Box } from '@mui/material';
import InvestigationPanel from '../components/InvestigationPanel';

const ExplainabilityScreen = () => {
  return (
    <Box sx={{ p: 0 }}>
      <InvestigationPanel embedded />
    </Box>
  );
};

export default ExplainabilityScreen;
