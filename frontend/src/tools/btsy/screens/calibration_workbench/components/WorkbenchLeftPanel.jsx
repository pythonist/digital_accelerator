import React, { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  TextField,
  Stack,
  Alert,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Chip
} from '@mui/material';
import btsyApi from '../../../services/btsyApi';
import { emitGuideEvent } from '../../../guides/guideEvents';

const WorkbenchLeftPanel = ({
  behaviorRuns,
  selectedBehaviorRunId,
  setSelectedBehaviorRunId,
  sessions,
  selectedSessionId,
  setSelectedSessionId,
  onCreateSession,
  onFreezeSession,
  onReviewFinalize,
  session,
  aggregation,
  selectedBoundaryId,
  sessionData,
  aggregateView,
  onSessionUpdated,
  loading,
  onNavigateToBoundary,
  onNavigateToValidate
}) => {
  const [entityCollapse, setEntityCollapse] = useState('max');
  const [timeLens, setTimeLens] = useState('full');
  const [sustainedDays, setSustainedDays] = useState(3);
  const [runQuery, setRunQuery] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');

  const runOptions = useMemo(() => behaviorRuns || [], [behaviorRuns]);
  const runOptionsReady = useMemo(
    () => (runOptions || []).filter(r => r.data_ready !== false),
    [runOptions]
  );
  const sessionOptions = useMemo(() => sessions || [], [sessions]);

  const canOperate = !!selectedSessionId && (sessionData?.session?.status !== 'frozen');
  const frozen = sessionData?.session?.status === 'frozen';

  const selectedRun = useMemo(() => {
    const rid = selectedBehaviorRunId ? parseInt(selectedBehaviorRunId, 10) : null;
    if (!rid) return null;
    return (runOptionsReady || []).find((r) => r.behavior_run_id === rid) || null;
  }, [runOptionsReady, selectedBehaviorRunId]);

  const recentRunId = useMemo(() => {
    const rows = (runOptionsReady || []).slice().sort((a, b) => (b.behavior_run_id || 0) - (a.behavior_run_id || 0));
    return rows[0]?.behavior_run_id || null;
  }, [runOptionsReady]);

  const recentSessionId = useMemo(() => {
    const rows = (sessionOptions || []).slice().sort((a, b) => (b.session_id || 0) - (a.session_id || 0));
    return rows[0]?.session_id || null;
  }, [sessionOptions]);

  const filteredRuns = useMemo(() => {
    const q = String(runQuery || '').trim().toLowerCase();
    if (!q) return runOptionsReady || [];
    return (runOptionsReady || []).filter((r) => {
      const metric = r.config?.metrics?.[0]?.name || '';
      const window = r.config?.metrics?.[0]?.window || '';
      return (
        String(r.behavior_run_id || '').includes(q) ||
        String(metric).toLowerCase().includes(q) ||
        String(window).toLowerCase().includes(q) ||
        String(r.entity_level || '').toLowerCase().includes(q)
      );
    });
  }, [runOptionsReady, runQuery]);

  const filteredSessions = useMemo(() => {
    const q = String(sessionQuery || '').trim().toLowerCase();
    if (!q) return sessionOptions || [];
    return (sessionOptions || []).filter((s) => {
      return (
        String(s.session_id || '').includes(q) ||
        String(s.metric_name || '').toLowerCase().includes(q) ||
        String(s.status || '').toLowerCase().includes(q)
      );
    });
  }, [sessionOptions, sessionQuery]);

  const lensCardsEntity = [
    { key: 'max', title: 'MAX', desc: 'Peak observed value. Best for spikes and bursts.' },
    { key: 'last', title: 'LAST', desc: 'Most recent state. Best for current posture.' },
    { key: 'avg', title: 'AVG', desc: 'Sustained average. Best for persistent behaviour.' },
    { key: 'p95', title: 'P95', desc: 'Upper-normal activity. Best for stable high tail.' },
  ];

  const lensCardsTime = [
    { key: 'full', title: 'WHOLE RANGE', desc: 'Use the full time range for aggregation.' },
    { key: 'worst_day', title: 'WORST DAY', desc: 'Focus on the most extreme day.' },
    { key: 'rolling_peak', title: 'ROLLING PEAK', desc: 'Peak over rolling window.' },
    { key: 'sustained', title: 'SUSTAINED', desc: 'Require repeated behaviour across N days.' },
  ];

  const lensSummary = useMemo(() => {
    const e = lensCardsEntity.find((x) => x.key === entityCollapse);
    const t = lensCardsTime.find((x) => x.key === timeLens);
    if (!e || !t) return '';
    return `${e.title} • ${t.title}`;
  }, [entityCollapse, timeLens]);

  const applyAggregation = async () => {
    if (!selectedSessionId) return;
    const res = await btsyApi.calibration.setAggregation(parseInt(selectedSessionId, 10), {
      entity_collapse: entityCollapse,
      time_lens: timeLens,
      sustained_days: sustainedDays
    }, 'user');
    if (res.success) {
      onSessionUpdated(res.data);
      emitGuideEvent('AGGREGATION_APPLIED', { sessionId: parseInt(selectedSessionId, 10) });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Current Context</Typography>
        <Stack spacing={0.75}>
          {!selectedRun && (
            <Alert severity="info">Select a behaviour run to begin.</Alert>
          )}
          {selectedRun && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Behaviour: ${selectedRun.config?.metrics?.[0]?.name || 'metric'}`} />
              <Chip label={`Entity: ${selectedRun.entity_level || '—'}`} />
              <Chip label={`Window: ${selectedRun.config?.metrics?.[0]?.window || '—'}`} />
              {session?.status && <Chip label={`Session: ${session.status}`} />}
              {aggregation?.entity_collapse && aggregation?.time_lens && (
                <Chip label={`Lens: ${String(aggregation.entity_collapse).toUpperCase()} • ${String(aggregation.time_lens).toUpperCase()}`} />
              )}
              {selectedBoundaryId && <Chip label={`Boundary: B-${String(selectedBoundaryId).padStart(3, '0')}`} />}
            </Box>
          )}
          {selectedRun && !selectedSessionId && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Select or create a calibration session to persist strategies, boundaries, and validation.
            </Typography>
          )}
          {selectedRun && selectedSessionId && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              This session stores your lens, boundaries, and validation evidence.
            </Typography>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" disabled={!selectedSessionId || loading || frozen} onClick={() => onNavigateToBoundary && onNavigateToBoundary()}>
              Define Boundary
            </Button>
            <Button variant="outlined" disabled={!selectedSessionId || loading} onClick={() => onNavigateToValidate && onNavigateToValidate()}>
              Validate
            </Button>
            <Button
              variant="contained"
              disabled={!selectedSessionId || loading || frozen}
              onClick={() => (onReviewFinalize ? onReviewFinalize() : onFreezeSession && onFreezeSession())}
            >
              Review & Finalize
            </Button>
          </Stack>
          {frozen && (
            <Alert severity="info">
              Session is frozen. Lens and boundary creation are locked for audit safety.
            </Alert>
          )}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Behaviour Selection</Typography>
        <FormControl fullWidth size="small" sx={{ mb: 1 }} data-guide-id="wb-behavior-run-select">
          <InputLabel>Quick switch</InputLabel>
          <Select value={selectedBehaviorRunId} label="Quick switch" onChange={(e) => setSelectedBehaviorRunId(e.target.value)}>
            {runOptionsReady.map((r) => (
              <MenuItem key={r.behavior_run_id} value={String(r.behavior_run_id)}>
                {`R-${String(r.behavior_run_id).padStart(3, '0')} • ${r.config?.metrics?.[0]?.name || 'metric'} • ${r.entity_level} • ${r.config?.metrics?.[0]?.window || '—'}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          value={runQuery}
          onChange={(e) => setRunQuery(e.target.value)}
          placeholder="Search behaviour runs"
          fullWidth
          sx={{ mb: 1 }}
        />
        <TableContainer sx={{ maxHeight: 220, border: '1px solid', borderColor: 'divider' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Behaviour</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Window</TableCell>
                <TableCell align="right">Rows</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRuns.map((r) => {
                const rid = String(r.behavior_run_id);
                const metric = r.config?.metrics?.[0]?.name || 'metric';
                const window = r.config?.metrics?.[0]?.window || '—';
                const selected = rid === String(selectedBehaviorRunId || '');
                return (
                  <TableRow
                    key={r.behavior_run_id}
                    hover
                    selected={selected}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setSelectedBehaviorRunId(String(r.behavior_run_id))}
                  >
                    <TableCell sx={{ fontWeight: selected ? 700 : 500 }}>
                      {`${r.behavior_run_id === recentRunId ? '★ ' : ''}${metric}`}
                    </TableCell>
                    <TableCell>{r.entity_level}</TableCell>
                    <TableCell>{window}</TableCell>
                    <TableCell align="right">{(r.data_rows ?? r.total_rows ?? 0).toLocaleString?.() || (r.data_rows ?? r.total_rows ?? 0)}</TableCell>
                  </TableRow>
                );
              })}
              {filteredRuns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>No runs.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Calibration Sessions</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button fullWidth variant="contained" disabled={!selectedBehaviorRunId || loading} onClick={onCreateSession} data-guide-id="wb-new-session-button">
            Create Session
          </Button>
        </Stack>
        <TextField
          size="small"
          value={sessionQuery}
          onChange={(e) => setSessionQuery(e.target.value)}
          placeholder="Search sessions"
          fullWidth
          sx={{ mb: 1 }}
          disabled={!selectedBehaviorRunId}
        />
        <TableContainer sx={{ maxHeight: 220, border: '1px solid', borderColor: 'divider' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Session</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Metric</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredSessions.map((s) => {
                const sid = String(s.session_id);
                const selected = sid === String(selectedSessionId || '');
                return (
                  <TableRow
                    key={s.session_id}
                    hover
                    selected={selected}
                    sx={{ cursor: selectedBehaviorRunId ? 'pointer' : 'default' }}
                    onClick={() => selectedBehaviorRunId && setSelectedSessionId(String(s.session_id))}
                  >
                    <TableCell sx={{ fontWeight: selected ? 700 : 500 }}>
                      {`${s.session_id === recentSessionId ? '★ ' : ''}S-${String(s.session_id).padStart(3, '0')}`}
                    </TableCell>
                    <TableCell>{s.status}</TableCell>
                    <TableCell align="right">{s.metric_name}</TableCell>
                  </TableRow>
                );
              })}
              {filteredSessions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>No sessions.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0 }} data-guide-id="wb-aggregation-panel">
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Aggregation Lens</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          Converts transaction-level behaviour into one value per entity so entities can be compared and split.
        </Typography>

        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Per Entity</Typography>
        <Stack spacing={1} sx={{ mt: 0.5, mb: 1 }}>
          {lensCardsEntity.map((c) => (
            <Paper
              key={c.key}
              elevation={0}
              sx={{
                p: 1.25,
                border: '1px solid',
                borderColor: entityCollapse === c.key ? 'text.primary' : 'divider',
                borderRadius: 0,
                cursor: frozen ? 'not-allowed' : 'pointer',
                opacity: frozen ? 0.6 : 1
              }}
              onClick={() => !frozen && setEntityCollapse(c.key)}
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.title}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.desc}</Typography>
            </Paper>
          ))}
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Across Time</Typography>
        <Stack spacing={1} sx={{ mt: 0.5, mb: 1 }}>
          {lensCardsTime.map((c) => (
            <Paper
              key={c.key}
              elevation={0}
              sx={{
                p: 1.25,
                border: '1px solid',
                borderColor: timeLens === c.key ? 'text.primary' : 'divider',
                borderRadius: 0,
                cursor: frozen ? 'not-allowed' : 'pointer',
                opacity: frozen ? 0.6 : 1
              }}
              onClick={() => !frozen && setTimeLens(c.key)}
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.title}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.desc}</Typography>
            </Paper>
          ))}
        </Stack>

        <TextField
          fullWidth
          size="small"
          type="number"
          label="Sustained N (days)"
          value={sustainedDays}
          onChange={(e) => setSustainedDays(parseInt(e.target.value || '3', 10))}
          disabled={!canOperate || timeLens !== 'sustained'}
          sx={{ mb: 1 }}
        />

        <Button fullWidth variant="outlined" disabled={!canOperate || frozen} onClick={applyAggregation} data-guide-id="wb-apply-aggregation-button">
          Apply Lens
        </Button>

        {!!lensSummary && (
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
            Selected: {lensSummary}
          </Typography>
        )}

        {aggregateView?.summary && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Output Preview</Typography>
            <TableContainer sx={{ border: '1px solid', borderColor: 'divider' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Entity</TableCell>
                    <TableCell align="right">Aggregated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(aggregateView.top_entities || []).slice(0, 5).map((r) => (
                    <TableRow key={r.entity_id}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{r.entity_id}</TableCell>
                      <TableCell align="right">{Number(r.aggregated_value || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {(aggregateView.top_entities || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} sx={{ color: 'text.secondary' }}>No data.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Entities: ${Number(aggregateView.summary.entities || 0).toLocaleString()}`} />
              <Chip label={`Min: ${Number(aggregateView.summary.min || 0).toLocaleString()}`} />
              <Chip label={`Max: ${Number(aggregateView.summary.max || 0).toLocaleString()}`} />
              <Chip label={`P95: ${Number(aggregateView.summary.p95 || 0).toLocaleString()}`} />
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default WorkbenchLeftPanel;
