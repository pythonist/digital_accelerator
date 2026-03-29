import React from 'react';
import {
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

const ComparisonSelectionBar = ({ baseCaseId, selectedCaseIds, onCompare, comparing }) => (
  <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2.5, borderColor: '#cbd5e1', backgroundColor: '#fff' }}>
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', lg: 'center' }} justifyContent="space-between">
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
        <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Comparison Set</Typography>
        <Chip label={`Base ${baseCaseId || '-'}`} size="small" color="primary" />
        {selectedCaseIds.map((caseId) => <Chip key={caseId} label={caseId} size="small" variant="outlined" />)}
      </Stack>
      <Button variant="contained" onClick={onCompare} disabled={comparing || !baseCaseId || selectedCaseIds.length < 1}>
        {comparing ? 'Preparing Comparison...' : selectedCaseIds.length > 1 ? 'Open Portfolio Compare' : 'Open Detailed Compare'}
      </Button>
    </Stack>
  </Paper>
);

export default ComparisonSelectionBar;
