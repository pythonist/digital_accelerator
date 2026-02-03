import React, { useMemo } from 'react';
import { Box, Paper, Typography, Button, Chip, Stack } from '@mui/material';

const WorkbenchContextBar = ({ session, aggregation, onFreeze, loading }) => {
  const summary = useMemo(() => {
    if (!session) return null;
    const parts = [
      `Behaviour Run R-${String(session.behavior_run_id).padStart(3, '0')}`,
      `${session.entity_level?.toUpperCase()}`,
      session.metric_name,
      session.window ? `Window ${session.window}` : null
    ].filter(Boolean);
    return parts.join(' • ');
  }, [session]);

  return (
    <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Context</Typography>
          <Typography variant="body2" sx={{ color: '#64748b' }}>
            {summary || 'No session selected'}
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
            When you are satisfied with the boundary and validation, freeze the session to lock choices for downstream steps.
          </Typography>
          {aggregation && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Chip label={`Entity lens: ${aggregation.entity_collapse}`} size="small" />
              <Chip label={`Time lens: ${aggregation.time_lens}`} size="small" />
              <Chip label={`Sustained N: ${aggregation.sustained_days}`} size="small" />
            </Stack>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" disabled={!session || loading} onClick={onFreeze}>
            Freeze Session
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default WorkbenchContextBar;

