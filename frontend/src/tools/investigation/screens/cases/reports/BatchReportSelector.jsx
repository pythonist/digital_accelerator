import React from 'react';
import {
  Autocomplete,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const BatchReportSelector = ({ caseOptions, selectedCases, onChange, outputMode, onOutputModeChange, onGenerate, loading }) => (
  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
    <Stack spacing={2}>
      <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a' }}>Batch Export</Typography>
      <Typography sx={{ fontSize: 12.75, color: '#64748b', lineHeight: 1.7 }}>
        Generate one dossier per case or a combined multi-case report for escalation, reviewer handoff, or archival.
      </Typography>

      <Autocomplete
        multiple
        options={caseOptions}
        value={selectedCases}
        onChange={(_, value) => onChange(value)}
        getOptionLabel={(option) => option.label}
        renderInput={(params) => <TextField {...params} size="small" label="Select cases" />}
      />

      <FormControl size="small" sx={{ maxWidth: 260 }}>
        <InputLabel>Batch output</InputLabel>
        <Select
          label="Batch output"
          value={outputMode}
          onChange={(event) => onOutputModeChange(event.target.value)}
        >
          <MenuItem value="separate">One PDF per case</MenuItem>
          <MenuItem value="combined">Combined multi-case report</MenuItem>
        </Select>
      </FormControl>

      <Button variant="contained" onClick={onGenerate} disabled={loading || !selectedCases.length}>
        {loading ? 'Generating Batch...' : 'Generate Batch Reports'}
      </Button>
    </Stack>
  </Paper>
);

export default BatchReportSelector;
