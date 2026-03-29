import React from 'react';
import {
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

const GraphScopeControls = ({
  caseOptions = [],
  selectedCaseId,
  onCaseChange,
  filters,
  onFilterChange,
  onRun,
  loading,
}) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
    <Stack spacing={1.5}>
      <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Scope Controls</Typography>
      <FormControl size="small" fullWidth>
        <InputLabel>Case</InputLabel>
        <Select value={selectedCaseId || ''} label="Case" onChange={(event) => onCaseChange(event.target.value)}>
          {caseOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField
        size="small"
        type="number"
        label="Depth / Hops"
        value={filters.max_hops}
        onChange={(event) => onFilterChange('max_hops', Number(event.target.value) || 2)}
      />
      <TextField
        size="small"
        type="number"
        label="Time Window (Days)"
        value={filters.time_window_days}
        onChange={(event) => onFilterChange('time_window_days', Number(event.target.value) || 90)}
      />
      <TextField
        size="small"
        type="number"
        label="Minimum Amount"
        value={filters.min_amount}
        onChange={(event) => onFilterChange('min_amount', Number(event.target.value) || 0)}
      />
      <FormControl size="small" fullWidth>
        <InputLabel>Entity Focus</InputLabel>
        <Select value={filters.entity_focus} label="Entity Focus" onChange={(event) => onFilterChange('entity_focus', event.target.value)}>
          <MenuItem value="all">All Visible Entities</MenuItem>
          <MenuItem value="accounts">Accounts Only</MenuItem>
          <MenuItem value="counterparties">Counterparties Only</MenuItem>
          <MenuItem value="alerts">Alerts and Cases</MenuItem>
        </Select>
      </FormControl>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{ fontSize: 12.5, color: '#334155' }}>Only flagged or high-risk entities</Typography>
        <Switch checked={Boolean(filters.only_high_risk)} onChange={(event) => onFilterChange('only_high_risk', event.target.checked)} />
      </Stack>
      <Button variant="contained" onClick={onRun} disabled={!selectedCaseId || loading}>
        {loading ? 'Running...' : 'Re-run Analysis'}
      </Button>
    </Stack>
  </Paper>
);

export default GraphScopeControls;
