import React from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';

import { WorkbenchSection, WorkbenchStatusBadge } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();

export default function MulePreprocessingPipelineRunTab({
  data,
  running,
  onStart,
  onRetry,
  onCancel,
}) {
  const job = data?.latest_job || null;
  const logs = job?.logs || {};
  const timeline = logs?.timeline || [];
  const status = job?.status || 'not_started';
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WorkbenchStatusBadge status={status} />
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{Math.round(Number(job?.progress_pct || 0))}% complete</Typography>
            </Box>
            <Typography sx={{ fontSize: 12.25, color: '#667085', mt: 0.45 }}>
              Current task: <strong>{logs?.current_task || 'Awaiting execution'}</strong>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={onStart} disabled={running} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>{running ? 'Running...' : 'Start Pipeline Run'}</Button>
            <Button variant="outlined" onClick={onRetry} sx={{ textTransform: 'none', borderRadius: 0 }}>Retry</Button>
            <Button variant="outlined" onClick={onCancel} sx={{ textTransform: 'none', borderRadius: 0 }}>Cancel</Button>
          </Box>
        </Box>
        <LinearProgress variant="determinate" value={Number(job?.progress_pct || 0)} sx={{ mt: 1.2, height: 8, borderRadius: 0, bgcolor: 'rgba(15,23,42,0.08)', '& .MuiLinearProgress-bar': { bgcolor: '#C65A11' } }} />
      </Paper>
      {status === 'failed' && logs?.message ? <Alert severity="error">{logs.message}</Alert> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Execution Timeline">
          {(timeline || []).length ? timeline.map((row) => (
            <Paper key={`${row.step}_${row.progress_pct}`} variant="outlined" sx={{ p: 1, borderRadius: 0, mb: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.step}</Typography>
                <Typography sx={{ fontSize: 12.1, color: '#667085' }}>{row.status}</Typography>
              </Box>
              <Typography sx={{ fontSize: 12.1, color: '#475467', mt: 0.4 }}>{row.detail}</Typography>
            </Paper>
          )) : <Typography sx={{ fontSize: 12.25, color: '#667085' }}>No run has started yet.</Typography>}
        </WorkbenchSection>
        <WorkbenchSection title="Run Diagnostics">
          {[
            ['Processed records', `${fmt(logs.records_processed)} / ${fmt(logs.records_total)}`],
            ['Current step', `${logs.current_step_index || 0} / ${logs.total_steps || 0}`],
            ['Heartbeat', logs.heartbeat_ts || 'Not available'],
            ['Latest run', data?.latest_run?.output_table_name || 'Not created'],
          ].map(([label, value]) => (
            <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, gap: 1 }}>
              <Typography sx={{ fontSize: 12.25, color: '#667085' }}>{label}</Typography>
              <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right' }}>{value}</Typography>
            </Box>
          ))}
        </WorkbenchSection>
      </Box>
    </Box>
  );
}
