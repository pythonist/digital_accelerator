// ============================================================================
// COMPONENT 1: DatasetSelector.jsx
// ============================================================================
import React from 'react';
import {
  Box, Typography, Select, MenuItem, FormControl, InputLabel, Chip
} from '@mui/material';
import { Storage } from '@mui/icons-material';

export const DatasetSelector = ({ datasets, selectedDataset, onSelectDataset }) => {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#0f172a' }}>
        Select Dataset to Inspect
      </Typography>
      <FormControl fullWidth size="small">
        <InputLabel>Dataset</InputLabel>
        <Select
          value={selectedDataset || ''}
          onChange={(e) => onSelectDataset(e.target.value)}
          label="Dataset"
        >
          {datasets.map((ds) => (
            <MenuItem key={ds.id} value={ds.id}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Storage fontSize="small" sx={{ color: '#64748b' }} />
                  <Typography variant="body2" fontWeight={600}>{ds.name}</Typography>
                </Box>
                <Chip 
                  label={`${ds.row_count.toLocaleString()} rows`}
                  size="small"
                  sx={{ bgcolor: '#dbeafe', color: '#1e40af', height: 20, fontSize: '0.7rem' }}
                />
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};

export default DatasetSelector;