// frontend/src/tools/calibration/components/aggregation/LookbackFrequencyPanel.jsx
import React from 'react';
import {
  Paper, Typography, Box, Grid, TextField, Select, MenuItem,
  FormControl, InputLabel, Chip, Stack, Switch, FormControlLabel, Alert
} from '@mui/material';
import { AccessTime } from '@mui/icons-material';

const PRESETS = [
  { label: '1d', value: 1, unit: 'days' },
  { label: '2d', value: 2, unit: 'days' },
  { label: '5d', value: 5, unit: 'days' },
  { label: '7d', value: 7, unit: 'days' },
  { label: '10d', value: 10, unit: 'days' },
  { label: '14d', value: 14, unit: 'days' },
  { label: '30d', value: 30, unit: 'days' },
  { label: '90d', value: 90, unit: 'days' }
];

const LookbackFrequencyPanel = ({ config, onChange }) => {
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <AccessTime fontSize="small" color="primary" />
        <Box>
          <Typography variant="subtitle2" fontWeight="600">
            Time Window & Frequency
          </Typography>
          <Typography variant="caption" color="text.secondary">
            WHEN to look back and how often?
          </Typography>
        </Box>
      </Box>

      {/* Lookback Window */}
      <Typography variant="caption" fontWeight="600" sx={{ display: 'block', mb: 1 }}>
        Lookback Window
      </Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6}>
          <TextField
            label="Value"
            type="number"
            size="small"
            fullWidth
            value={config.lookback_value || 30}
            onChange={(e) => onChange('lookback_value', parseInt(e.target.value) || 1)}
            inputProps={{ min: 1 }}
          />
        </Grid>
        <Grid item xs={6}>
          <FormControl fullWidth size="small">
            <InputLabel>Unit</InputLabel>
            <Select
              value={config.lookback_unit || 'days'}
              label="Unit"
              onChange={(e) => onChange('lookback_unit', e.target.value)}
            >
              <MenuItem value="days">Days</MenuItem>
              <MenuItem value="weeks">Weeks</MenuItem>
              <MenuItem value="months">Months</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 2, gap: 0.5 }}>
        {PRESETS.map(preset => (
          <Chip
            key={preset.label}
            label={preset.label}
            size="small"
            onClick={() => {
              onChange('lookback_value', preset.value);
              onChange('lookback_unit', preset.unit);
            }}
            color={
              config.lookback_value === preset.value && config.lookback_unit === preset.unit
                ? 'primary'
                : 'default'
            }
            variant={
              config.lookback_value === preset.value && config.lookback_unit === preset.unit
                ? 'filled'
                : 'outlined'
            }
          />
        ))}
      </Stack>

      {/* Frequency */}
      <Typography variant="caption" fontWeight="600" sx={{ display: 'block', mb: 1 }}>
        Output Frequency
      </Typography>
      <FormControl fullWidth size="small" sx={{ mb: 2 }}>
        <InputLabel>Frequency</InputLabel>
        <Select
          value={config.frequency || 'daily'}
          label="Frequency"
          onChange={(e) => onChange('frequency', e.target.value)}
        >
          <MenuItem value="daily">Daily Snapshots</MenuItem>
          <MenuItem value="weekly">Weekly Snapshots</MenuItem>
          <MenuItem value="28day">28-Day Rolling</MenuItem>
          <MenuItem value="monthly">Monthly Snapshots</MenuItem>
          <MenuItem value="quarterly">Quarterly Snapshots</MenuItem>
        </Select>
      </FormControl>

      {/* Transaction Scope */}
      <Typography variant="caption" fontWeight="600" sx={{ display: 'block', mb: 1 }}>
        Transaction Scope
      </Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={config.filter_history !== false}
            onChange={(e) => onChange('filter_history', e.target.checked)}
          />
        }
        label={
          <Box>
            <Typography variant="body2">Match Step 1 Filters</Typography>
            <Typography variant="caption" color="text.secondary">
              If Step 1 filtered "CASH only", aggregate CASH transactions only
            </Typography>
          </Box>
        }
      />

      {!config.filter_history && (
        <Alert severity="warning" sx={{ mt: 1.5, py: 0.5 }}>
          <Typography variant="caption">
            Aggregating <strong>ALL</strong> transaction types regardless of Step 1 trigger
          </Typography>
        </Alert>
      )}
      
      {config.filter_history && (
        <Alert severity="info" sx={{ mt: 1.5, py: 0.5 }}>
          <Typography variant="caption">
            ✅ Aggregating only transactions matching Step 1 criteria
          </Typography>
        </Alert>
      )}
    </Paper>
  );
};

export default LookbackFrequencyPanel;