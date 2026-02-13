import React from 'react';
import {
  Box,
  Button,
  Stack,
  LinearProgress,
  Grid,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Collapse
} from '@mui/material';

const AutoBuildFeatureScreen = ({
  T,
  card,
  cellSx,
  headCellSx,
  SectionHeader,
  MetricPill,
  StatusBadge,
  loading,
  status,
  pipelineOpen,
  setPipelineOpen,
  config,
  setConfig,
  estimation,
  requestRun,
  openEntryGate,
  runState,
  runStateLevel,
  durationFromStatus,
  runs,
  openRunDetail
}) => (
  <>
    <Grid container spacing={0} sx={{ borderBottom: `1px solid ${T.border}` }}>
      <Grid item xs={12}>
        <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
          <SectionHeader
            title="Pipeline Controls"
            subtitle="Configure · Run · Monitor"
            onToggle={() => setPipelineOpen((p) => !p)}
            right={
              <Stack direction="row" spacing={0.75}>
                <Button size="small" variant="outlined" disabled={loading} onClick={() => openEntryGate({ action: 'wizard' })}
                  sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 900, px: 1.5, py: 0.6 }}>
                  CREATE NEW FEATURE
                </Button>
                <Button size="small" variant="contained" disabled={loading} onClick={() => requestRun('run')}
                  sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 700, px: 2, py: 0.6, '&:hover': { bgcolor: '#c9461a' }, '&:disabled': { bgcolor: 'rgba(232,83,26,0.3)', color: T.textMuted } }}>
                  RUN
                </Button>
                <Button size="small" variant="outlined" disabled={loading} onClick={() => requestRun('dry_run')}
                  sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 700, px: 1.5, py: 0.6 }}>
                  DRY RUN
                </Button>
                <Button size="small" variant="outlined" disabled={loading} onClick={() => requestRun('incremental')}
                  sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 11, fontWeight: 700, px: 1.5, py: 0.6 }}>
                  INCREMENTAL
                </Button>
                <StatusBadge label={runState.toUpperCase()} level={runStateLevel} />
              </Stack>
            }
          />

          {(status?.state === 'running' || status?.state === 'queued') && (
            <LinearProgress
              variant={typeof status?.progress_pct === 'number' ? 'determinate' : 'indeterminate'}
              value={typeof status?.progress_pct === 'number' ? status.progress_pct : 0}
              sx={{ height: 4, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }}
            />
          )}

          <Collapse in={pipelineOpen}>
            <Box sx={{ p: 2, borderTop: `1px solid ${T.border}` }}>
              <Grid container spacing={1.5}>
              {[
                ['Dataset version', 'dataset_version'], ['Population', 'population'],
                ['Reference date', 'reference_date'], ['Triggered by', 'triggered_by'],
                ['Lookback definitions', 'lookback'], ['Transaction scope', 'transaction_scope'],
                ['Segmentation', 'segmentation'], ['Recompute families', 'families'],
              ].map(([label, key]) => (
                <Grid item xs={12} sm={6} md={3} key={key}>
                  <TextField size="small" label={label} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} fullWidth
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    InputLabelProps={{ sx: { fontSize: 11, fontFamily: T.sans } }}
                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border }, '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: T.borderBright } }}
                  />
                </Grid>
              ))}
            </Grid>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
              <MetricPill label="Est. accounts" value={estimation.accounts ? Number(estimation.accounts).toLocaleString() : '—'} />
              <MetricPill label="Est. runtime" value={estimation.estRuntimeSec ? `~${estimation.estRuntimeSec}s` : '—'} />
              <MetricPill label="Compute load" value={estimation.impact || '—'} color={estimation.impact === 'HIGH' ? T.red : estimation.impact === 'MEDIUM' ? T.amber : T.green} />
              <MetricPill label="Status msg" value={status?.message?.slice(0, 40) || 'Idle'} />
              {durationFromStatus != null && <MetricPill label="Duration" value={`${durationFromStatus}s`} />}
              {status?.result?.dataset_version && <MetricPill label="Output dataset" value={status.result.dataset_version.slice(0, 18)} />}
            </Stack>
            </Box>
          </Collapse>
        </Box>
      </Grid>
    </Grid>

    <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
      <SectionHeader
        title="Run History"
        subtitle="Operational lineage · click row for full report"
        right={<span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{runs.length} runs</span>}
      />
      <TableContainer sx={{ maxHeight: 320, background: T.surface }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {['Run ID', 'Type', 'Triggered By', 'Timestamp', 'Input Version', 'Output Version', 'Duration', 'Features', 'Status', 'Failures'].map((h) => (
                <TableCell key={h} sx={headCellSx}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} sx={{ ...cellSx, textAlign: 'center', py: 3, color: T.textMuted }}>
                  No feature engineering runs found. Click RUN to start the pipeline.
                </TableCell>
              </TableRow>
            ) : runs.map((r) => (
              <TableRow key={r.run_id} hover onClick={() => openRunDetail(r.run_id)}
                sx={{ cursor: 'pointer', '&:hover': { background: 'rgba(255,255,255,0.025)' } }}>
                <TableCell sx={{ ...cellSx, color: T.accent }}>{String(r.run_id).slice(0, 18)}</TableCell>
                <TableCell sx={cellSx}>{r.run_type || '—'}</TableCell>
                <TableCell sx={cellSx}>{r.triggered_by || '—'}</TableCell>
                <TableCell sx={{ ...cellSx, fontSize: 10, color: T.textMuted }}>{String(r.timestamp || '').slice(0, 16)}</TableCell>
                <TableCell sx={{ ...cellSx, fontSize: 10 }}>{String(r.input_version || '—').slice(0, 16)}</TableCell>
                <TableCell sx={{ ...cellSx, fontSize: 10 }}>{String(r.output_version || r.dataset_version || '—').slice(0, 16)}</TableCell>
                <TableCell sx={cellSx}>{r.duration_seconds != null ? `${r.duration_seconds}s` : '—'}</TableCell>
                <TableCell sx={{ ...cellSx, color: T.green }}>{r.features_produced ?? '—'}</TableCell>
                <TableCell sx={cellSx}>
                  <StatusBadge label={(r.status || 'success').toUpperCase()} level={r.status === 'failed' ? 'danger' : 'approved'} />
                </TableCell>
                <TableCell sx={{ ...cellSx, color: (r.failures ?? 0) > 0 ? T.red : T.textMuted }}>{r.failures ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  </>
);

export default AutoBuildFeatureScreen;
