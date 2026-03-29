import React from 'react';
import {
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Refresh, Search } from '@mui/icons-material';

import { CASE_QUEUE_STAGES, CASE_QUEUE_STATUSES, ESCALATION_TARGETS, SAVED_VIEWS } from './queueConfig';

const riskOptions = ['All', 'High', 'Medium', 'Low'];

const CaseQueueFilters = ({
  filters,
  onFilterChange,
  onReset,
  onRefresh,
  refreshedAt,
  loading,
}) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', xl: 'center' }} justifyContent="space-between">
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Queue Filters</Typography>
          <Typography sx={{ mt: 0.35, fontSize: 12.5, color: '#64748b' }}>
            Refine the live worklist by status, stage, risk, routing target, and operational scope.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={onReset}>Reset</Button>
          <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={onRefresh} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {SAVED_VIEWS.map((view) => {
          const active = filters.saved_view === view;
          return (
            <Button
              key={view}
              size="small"
              variant={active ? 'contained' : 'outlined'}
              onClick={() => onFilterChange('saved_view', view)}
              sx={active ? { boxShadow: 'none' } : undefined}
            >
              {view}
            </Button>
          );
        })}
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.25,
        }}
      >
        <TextField
          size="small"
          label="Search cases"
          value={filters.search}
          onChange={(event) => onFilterChange('search', event.target.value)}
          placeholder="Case ID, customer, account, analyst"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: '#94a3b8', fontSize: 18 }} />
              </InputAdornment>
            ),
          }}
        />
        <TextField select size="small" label="Status" value={filters.status} onChange={(event) => onFilterChange('status', event.target.value)}>
          <MenuItem value="">All statuses</MenuItem>
          {CASE_QUEUE_STATUSES.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Stage" value={filters.stage} onChange={(event) => onFilterChange('stage', event.target.value)}>
          <MenuItem value="">All stages</MenuItem>
          {CASE_QUEUE_STAGES.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Risk" value={filters.risk} onChange={(event) => onFilterChange('risk', event.target.value)}>
          {riskOptions.map((value) => <MenuItem key={value} value={value === 'All' ? '' : value}>{value}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Escalation Target" value={filters.escalated_to} onChange={(event) => onFilterChange('escalated_to', event.target.value)}>
          <MenuItem value="">All targets</MenuItem>
          {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Branch" value={filters.branch} onChange={(event) => onFilterChange('branch', event.target.value)} placeholder="BR-001" />
        <TextField size="small" label="Region" value={filters.region} onChange={(event) => onFilterChange('region', event.target.value)} placeholder="North" />
        <TextField size="small" type="date" label="Updated From" value={filters.date_from} onChange={(event) => onFilterChange('date_from', event.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="Updated To" value={filters.date_to} onChange={(event) => onFilterChange('date_to', event.target.value)} InputLabelProps={{ shrink: true }} />
      </Box>

      <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
        Live mode: polling. Last refreshed {refreshedAt || '-'}.
      </Typography>
    </Stack>
  </Paper>
);

export default CaseQueueFilters;
