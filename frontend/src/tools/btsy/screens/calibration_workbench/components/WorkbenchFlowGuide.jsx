import React, { useMemo } from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';

const WorkbenchFlowGuide = ({
  selectedBehaviorRunId,
  selectedSessionId,
  aggregation,
  strategiesCount,
  boundariesCount,
  ksRunsCount,
  step36RunsCount
}) => {
  const status = useMemo(() => {
    const hasRun = !!selectedBehaviorRunId;
    const hasSession = !!selectedSessionId;
    const hasAgg = !!aggregation;
    const hasStrategies = (strategiesCount || 0) > 0;
    const hasBoundaries = (boundariesCount || 0) > 0;
    const hasKs = (ksRunsCount || 0) > 0;
    const hasJ = (step36RunsCount || 0) > 0;
    return { hasRun, hasSession, hasAgg, hasStrategies, hasBoundaries, hasKs, hasJ };
  }, [selectedBehaviorRunId, selectedSessionId, aggregation, strategiesCount, boundariesCount, ksRunsCount, step36RunsCount]);

  const chip = (label, ok) => (
    <Chip
      key={label}
      label={label}
      sx={{
        bgcolor: ok ? '#0f172a' : '#f1f5f9',
        color: ok ? '#ffffff' : '#0f172a',
        borderRadius: 0
      }}
      size="small"
    />
  );

  return (
    <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Workbench Flow & Unlocks
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
        Follow this order. Each step unlocks the next validation layer.
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {chip('1) Select Behaviour Run', status.hasRun)}
        {chip('2) Create/Select Calibration Session', status.hasSession)}
        {chip('3.1) Set Interpretation Lens', status.hasAgg)}
        {chip('3.3) Save Threshold Strategies', status.hasStrategies)}
        {chip('3.3) Create Risk Boundary (ATL/BTL)', status.hasBoundaries)}
        {chip('3.4) Run KS Validation', status.hasKs)}
        {chip('3.5) Stress Boundary (Fragility)', status.hasBoundaries)}
        {chip('3.6) Run J Separation Strength', status.hasJ)}
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" sx={{ color: '#64748b' }}>
          If you cannot compute KS/J, select a boundary in Risk Split first.
        </Typography>
      </Box>
    </Paper>
  );
};

export default WorkbenchFlowGuide;
