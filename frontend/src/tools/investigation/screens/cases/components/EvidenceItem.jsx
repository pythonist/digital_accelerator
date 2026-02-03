// frontend/src/screens/cases/components/EvidenceItem.jsx
import React from 'react';
import { Stack, Typography } from '@mui/material';
import { CheckCircle as CheckIcon, Warning as AlertTriangleIcon, Close as CloseIcon } from '@mui/icons-material';

const EvidenceItem = ({ status, text }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    {status === 'complete' && <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />}
    {status === 'warning' && <AlertTriangleIcon sx={{ fontSize: 16, color: 'warning.main' }} />}
    {status === 'error' && <CloseIcon sx={{ fontSize: 16, color: 'error.main' }} />}
    <Typography variant="body2" fontSize="0.875rem">
      {text}
    </Typography>
  </Stack>
);

export default EvidenceItem;