// frontend/src/tools/calibration/components/aggregation/MetricBuilderPanel.jsx
import React from 'react';
import { Paper, Typography, Box, Checkbox, FormGroup, FormControlLabel, Chip, Stack } from '@mui/material';
import { Functions } from '@mui/icons-material';

const METRICS = [
  { id: 'sum_amount', label: 'Sum of Amount', desc: 'Total transaction value' },
  { id: 'avg_amount', label: 'Average Amount', desc: 'Mean transaction size' },
  { id: 'max_amount', label: 'Max Amount', desc: 'Largest single transaction' },
  { id: 'count', label: 'Transaction Count', desc: 'Number of transactions' },
  { id: 'velocity', label: 'Velocity', desc: 'Transactions per day' }
];

const MetricBuilderPanel = ({ selectedMetrics, onChange }) => {
  const handleToggle = (metricId) => {
    const newMetrics = selectedMetrics.includes(metricId)
      ? selectedMetrics.filter(m => m !== metricId)
      : [...selectedMetrics, metricId];
    onChange(newMetrics);
  };

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <Functions fontSize="small" color="primary" />
        <Box>
          <Typography variant="subtitle2" fontWeight="600">
            Metrics to Compute
          </Typography>
          <Typography variant="caption" color="text.secondary">
            WHAT to measure?
          </Typography>
        </Box>
      </Box>

      <FormGroup>
        {METRICS.map(metric => (
          <FormControlLabel
            key={metric.id}
            control={
              <Checkbox
                size="small"
                checked={selectedMetrics.includes(metric.id)}
                onChange={() => handleToggle(metric.id)}
              />
            }
            label={
              <Box>
                <Typography variant="body2">{metric.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {metric.desc}
                </Typography>
              </Box>
            }
          />
        ))}
      </FormGroup>

      {selectedMetrics.length === 0 && (
        <Box sx={{ mt: 1, p: 1, bgcolor: 'warning.light', borderRadius: 1 }}>
          <Typography variant="caption" color="warning.dark">
            ⚠️ Select at least one metric
          </Typography>
        </Box>
      )}

      {selectedMetrics.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Selected: {selectedMetrics.length} metric{selectedMetrics.length > 1 ? 's' : ''}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {selectedMetrics.map(m => (
              <Chip
                key={m}
                label={METRICS.find(metric => metric.id === m)?.label}
                size="small"
                color="primary"
                variant="outlined"
              />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};

export default MetricBuilderPanel;