import React from 'react';
import { Chip } from '@mui/material';

const statusColor = {
  generated: 'success',
  processing: 'warning',
  failed: 'error',
};

const ReportStatusIndicator = ({ status }) => (
  <Chip
    size="small"
    label={String(status || 'generated').replace(/_/g, ' ')}
    color={statusColor[String(status || 'generated').toLowerCase()] || 'default'}
    variant="outlined"
    sx={{ fontWeight: 700, textTransform: 'capitalize' }}
  />
);

export default ReportStatusIndicator;
