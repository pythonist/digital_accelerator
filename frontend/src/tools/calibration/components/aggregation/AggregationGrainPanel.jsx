import React from 'react';
import { Paper, Typography, RadioGroup, FormControlLabel, Radio, Box, Alert } from '@mui/material';
import { DataObject } from '@mui/icons-material';

const AggregationGrainPanel = ({ level, onChange }) => {
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <DataObject fontSize="small" color="primary" />
        <Box>
          <Typography variant="subtitle2" fontWeight="600">
            Grouping Entity
          </Typography>
          <Typography variant="caption" color="text.secondary">
            WHO are we profiling?
          </Typography>
        </Box>
      </Box>

      <RadioGroup value={level} onChange={(e) => onChange(e.target.value)}>
        <FormControlLabel
          value="account"
          control={<Radio size="small" />}
          label={
            <Box>
              <Typography variant="body2" fontWeight="500">Account Level</Typography>
              <Typography variant="caption" color="text.secondary">
                Each account gets its own behavioral profile
              </Typography>
            </Box>
          }
        />
        <FormControlLabel
          value="customer"
          control={<Radio size="small" />}
          label={
            <Box>
              <Typography variant="body2" fontWeight="500">Customer Level</Typography>
              <Typography variant="caption" color="text.secondary">
                Aggregate across all customer accounts
              </Typography>
            </Box>
          }
        />
      </RadioGroup>

      <Alert severity="info" sx={{ mt: 2, py: 0.5 }}>
        <Typography variant="caption">
          Date grouping is automatic. System always groups by <strong>{level}_id</strong> + <strong>transaction_date</strong>.
        </Typography>
      </Alert>
    </Paper>
  );
};

export default AggregationGrainPanel;