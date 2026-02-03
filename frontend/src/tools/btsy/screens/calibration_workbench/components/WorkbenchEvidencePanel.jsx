import React, { useMemo } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper, Stack, Chip, Button } from '@mui/material';

const WorkbenchEvidencePanel = ({ bottomTab, session, aggregation, aggregateView, events, annotations, selectedBoundaryId }) => {
  const lineageText = useMemo(() => {
    if (!session) return null;
    const parts = [
      `This calibration session is based on behaviour run R-${String(session.behavior_run_id).padStart(3, '0')}.`,
      `Entity level: ${session.entity_level?.toUpperCase()}.`,
      `Metric: ${session.metric_name}.`,
      session.window ? `Window: ${session.window}.` : null,
      aggregation ? `Aggregation lens: entity=${aggregation.entity_collapse}, time=${aggregation.time_lens}, sustained_days=${aggregation.sustained_days}.` : null,
      'Step-3 consumes Step-2 behaviour outputs only. No transactions or rolling logic are recalculated here.'
    ].filter(Boolean);
    return parts.join(' ');
  }, [session, aggregation]);

  const orderedEvents = useMemo(() => {
    const rows = events || [];
    try {
      return rows.slice().sort((a, b) => (a.event_id || 0) - (b.event_id || 0));
    } catch (e) {
      return rows;
    }
  }, [events]);

  const navigate = (screen) => {
    window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen } }));
  };

  const navigateWorkbench = (detail) => {
    window.dispatchEvent(new CustomEvent('btsy:calibration:navigate', { detail: detail || {} }));
  };

  if (bottomTab === 'evidence') {
    if (!aggregateView?.summary) {
      return <Typography variant="body2" sx={{ color: '#64748b' }}>No evidence yet.</Typography>;
    }
    const s = aggregateView.summary;
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Aggregate Summary</Typography>
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Metric</TableCell>
                <TableCell align="right">Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow><TableCell>entities</TableCell><TableCell align="right">{(s.entities || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>min</TableCell><TableCell align="right">{Number(s.min || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>median</TableCell><TableCell align="right">{Number(s.median || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>mean</TableCell><TableCell align="right">{Number(s.mean || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>p90</TableCell><TableCell align="right">{Number(s.p90 || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>p95</TableCell><TableCell align="right">{Number(s.p95 || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>p99</TableCell><TableCell align="right">{Number(s.p99 || 0).toLocaleString()}</TableCell></TableRow>
              <TableRow><TableCell>max</TableCell><TableCell align="right">{Number(s.max || 0).toLocaleString()}</TableCell></TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  if (bottomTab === 'logs') {
    if (!orderedEvents?.length) {
      return <Typography variant="body2" sx={{ color: '#64748b' }}>No events recorded.</Typography>;
    }
    return (
      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Actor</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orderedEvents.map((e) => (
              <TableRow key={e.event_id}>
                <TableCell>{e.created_at}</TableCell>
                <TableCell>{e.event_type}</TableCell>
                <TableCell>{e.created_by || '—'}</TableCell>
                <TableCell sx={{ maxWidth: 520, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>
                  {e.event ? JSON.stringify(e.event) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (bottomTab === 'notes') {
    if (!annotations?.length) {
      return <Typography variant="body2" sx={{ color: '#64748b' }}>No notes yet.</Typography>;
    }
    return (
      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Text</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {annotations.map((a) => (
              <TableRow key={a.annotation_id}>
                <TableCell>{a.created_at}</TableCell>
                <TableCell>{a.annotation_type}</TableCell>
                <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{a.text}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Lineage Snapshot</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        <Chip label={`Transactions → Universe U-${session?.universe_id ? String(session.universe_id).padStart(3, '0') : '—'}`} onClick={() => navigate('universe')} clickable />
        <Chip label={`Behaviour Run R-${session?.behavior_run_id ? String(session.behavior_run_id).padStart(3, '0') : '—'}`} onClick={() => navigate('behavior')} clickable />
        <Chip label={`Step 3 Session S-${session?.session_id ? String(session.session_id).padStart(3, '0') : '—'}`} onClick={() => navigate('calibration')} clickable />
        {aggregation && (
          <Chip
            label={`Lens ${String(aggregation.entity_collapse || 'max').toUpperCase()} • ${String(aggregation.time_lens || 'full').toUpperCase()}`}
            onClick={() => navigateWorkbench({ stage: 'reduce', bottomTab: 'evidence' })}
            clickable
          />
        )}
        {selectedBoundaryId && (
          <Chip
            label={`Boundary B-${String(selectedBoundaryId).padStart(3, '0')}`}
            onClick={() => navigateWorkbench({ stage: 'boundary', boundaryTab: 'split' })}
            clickable
          />
        )}
        <Chip label="Validation" onClick={() => navigateWorkbench({ stage: 'validate' })} clickable />
      </Stack>
      <Typography variant="body2" sx={{ color: '#475569', mb: 1 }}>{lineageText || 'No lineage available.'}</Typography>
      <Button variant="outlined" size="small" onClick={() => navigate('runs')}>
        Go to Calibration Runs
      </Button>
    </Box>
  );
};

export default WorkbenchEvidencePanel;

