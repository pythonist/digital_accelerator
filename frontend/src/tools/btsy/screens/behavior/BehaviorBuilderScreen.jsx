import React, { useEffect, useMemo, useState } from 'react';
import { Box, Grid, Paper, Typography, TextField, Select, MenuItem, FormControl, InputLabel, Button, Alert, Table, TableHead, TableRow, TableCell, TableBody, TablePagination, Tabs, Tab, TableContainer, ToggleButtonGroup, ToggleButton } from '@mui/material';
import btsyApi from '../../services/btsyApi';
import BehaviorQualityPanel from './BehaviorQualityPanel';
import BehaviorExplainPanel from './BehaviorExplainPanel';
import BehaviorProgressPanel from './BehaviorProgressPanel';
import BehaviorTopKPanel from './BehaviorTopKPanel';
import MetricOverTimePanel from './MetricOverTimePanel';
import BehaviorComparisonPanel from './BehaviorComparisonPanel';
import BehaviorSignalIntelligencePanel from './BehaviorSignalIntelligencePanel';
import BehaviorInteractionIntelligencePanel from './BehaviorInteractionIntelligencePanel';
import AccountBehaviorTimelineDialog from './AccountBehaviorTimelineDialog';
import { getWindowIntent } from './windowIntent';

const defaultConfig = {
  entity_level: 'account',
  entity_id_col: 'account_id',
  time_col: 'transaction_datetime',
  metrics: [
    { name: 'cash_1d_sum', type: 'SUM', column: 'transaction_amount', window: '1D' }
  ]
};

const BehaviorBuilderScreen = ({ calibrationRunId }) => {
  const [selectedUniverse, setSelectedUniverse] = useState(null);
  const [config, setConfig] = useState(defaultConfig);
  const [runs, setRuns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [error, setError] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);
  const [stage, setStage] = useState(-1);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [activeTab, setActiveTab] = useState('quality');
  const [previewMode, setPreviewMode] = useState('transactions');
  const [previewFilters, setPreviewFilters] = useState({
    entity_search: '',
    value_min: '',
    value_max: '',
    sort_by: 'as_of_date',
    sort_dir: 'asc',
  });
  const [timeline, setTimeline] = useState({ open: false, entity_id: null });

  const activeWindow = activeRun?.config?.metrics?.[0]?.window || config?.metrics?.[0]?.window;
  const activeWindowIntent = getWindowIntent(activeWindow);

  useEffect(() => {
    const loadSelected = async () => {
      try {
        const hintUniverseId = sessionStorage.getItem('btsy_selected_universe_id');
        if (hintUniverseId) {
          const uni = await btsyApi.universe.getUniverse(parseInt(hintUniverseId, 10));
          if (uni.success) setSelectedUniverse(uni.data);
          else setError(uni.error || 'Failed to load selected universe');
          return;
        }
        if (calibrationRunId) {
          const res = await btsyApi.universe.getSelected(calibrationRunId);
          if (res.success) setSelectedUniverse(res.data);
        }
      } catch (e) { setError(e.message); }
    };
    loadSelected();
  }, [calibrationRunId]);

  const loadRuns = async () => {
    if (!selectedUniverse) return;
    const res = await btsyApi.behavior.listRuns(selectedUniverse.id);
    if (res.success) setRuns(res.data);
  };

  useEffect(() => { loadRuns(); }, [selectedUniverse]);

  const loadPreview = async (runId, limit, offset, mode) => {
    if (!runId) return;
    const m = mode || 'transactions';
    if (m === 'transactions') {
      return btsyApi.behavior.previewRunPagedFiltered(runId, limit, offset, previewFilters);
    }
    if (m === 'entity_last') {
      return btsyApi.behavior.previewRunEntityPaged(runId, 'last', limit, offset, previewFilters);
    }
    if (m === 'entity_max') {
      return btsyApi.behavior.previewRunEntityPaged(runId, 'max', limit, offset, previewFilters);
    }
    if (m === 'entity_avg') {
      return btsyApi.behavior.previewRunEntityPaged(runId, 'avg', limit, offset, previewFilters);
    }
    return btsyApi.behavior.previewRunPagedFiltered(runId, limit, offset, previewFilters);
  };

  const runBehavior = async () => {
    if (!selectedUniverse) { setError('No universe selected'); return; }
    setError(null);
    setStage(0);
    setTimeout(() => setStage(1), 200);
    const res = await btsyApi.behavior.createRun(selectedUniverse.id, config, 'user');
    if (res.success) {
      setStage(2);
      await loadRuns();
      const runId = res.data.behavior_run_id;
      const prev = await loadPreview(runId, rowsPerPage, 0, previewMode);
      if (prev.success) setPreviewRows(prev.data);
      setActiveRunId(runId);
      setPage(0);
      setStage(4);
    } else {
      setError(res.error || 'Failed to run behavior');
    }
  };
  const openCalibrationWorkbench = (runId) => {
    if (!runId) return;
    sessionStorage.setItem('btsy_step3_behavior_run_id', String(runId));
    window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen: 'calibration' } }));
  };

  const handleChangePage = async (_event, newPage) => {
    setPage(newPage);
    if (activeRunId) {
      const prev = await loadPreview(activeRunId, rowsPerPage, newPage * rowsPerPage, previewMode);
      if (prev.success) setPreviewRows(prev.data);
    }
  };
  const handleChangeRowsPerPage = async (event) => {
    const newSize = parseInt(event.target.value, 10);
    setRowsPerPage(newSize);
    setPage(0);
    if (activeRunId) {
      const prev = await loadPreview(activeRunId, newSize, 0, previewMode);
      if (prev.success) setPreviewRows(prev.data);
    }
  };

  const handleViewRun = async (runId) => {
    setActiveRunId(runId);
    setPage(0);
    const prev = await loadPreview(runId, rowsPerPage, 0, previewMode);
    if (prev?.success) setPreviewRows(prev.data);
    setActiveTab('quality');
  };

  useEffect(() => {
    const reloadPreview = async () => {
      if (!activeRunId) return;
      setPage(0);
      const prev = await loadPreview(activeRunId, rowsPerPage, 0, previewMode);
      if (prev?.success) setPreviewRows(prev.data);
    };
    reloadPreview();
  }, [previewMode, previewFilters, rowsPerPage, activeRunId]);

  const activeRun = useMemo(() => runs.find((r) => r.behavior_run_id === activeRunId) || null, [runs, activeRunId]);

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Behaviour Builder</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Explore, understand, and compare behavioural signals before they are used in scenarios. No alerts are generated here.
        </Typography>
      </Box>
      <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
        This step focuses on behaviour analysis. Alerts and scenario execution frequency are configured in later steps.
      </Alert>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {!selectedUniverse && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Select a transaction universe to proceed.
        </Alert>
      )}
      {activeRun && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Run Context</Typography>
          <Grid container spacing={1}>
            <Grid item xs={12} md={2}><Typography variant="caption">Run</Typography><Typography variant="body2">{`R-${String(activeRun.behavior_run_id).padStart(3, '0')}`}</Typography></Grid>
            <Grid item xs={12} md={3}><Typography variant="caption">Entity Level</Typography><Typography variant="body2">{activeRun.entity_level}</Typography></Grid>
            <Grid item xs={12} md={3}><Typography variant="caption">Metric</Typography><Typography variant="body2">{activeRun.config?.metrics?.[0]?.name || 'metric'}</Typography></Grid>
            <Grid item xs={12} md={2}><Typography variant="caption">Window</Typography><Typography variant="body2">{activeRun.config?.metrics?.[0]?.window || '—'}</Typography></Grid>
            <Grid item xs={12} md={2}><Typography variant="caption">Rows</Typography><Typography variant="body2">{(activeRun.total_rows || 0).toLocaleString()}</Typography></Grid>
          </Grid>
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="outlined" size="small" onClick={() => openCalibrationWorkbench(activeRun.behavior_run_id)}>
              Open Calibration Workbench
            </Button>
          </Box>
        </Paper>
      )}
      {selectedUniverse && (
        <BehaviorExplainPanel universe={selectedUniverse} config={config} />
      )}
      {selectedUniverse && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Universe</Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>Universe</TableCell>
                <TableCell>{selectedUniverse.universe_name}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Rows</TableCell>
                <TableCell>{selectedUniverse.transaction_count?.toLocaleString()}</TableCell>
              </TableRow>
              {selectedUniverse.unique_accounts && (
                <TableRow>
                  <TableCell>Entities</TableCell>
                  <TableCell>{selectedUniverse.unique_accounts} accounts</TableCell>
                </TableRow>
              )}
              {selectedUniverse.date_range_start && selectedUniverse.date_range_end && (
                <TableRow>
                  <TableCell>Date Range</TableCell>
                  <TableCell>{`${new Date(selectedUniverse.date_range_start).toLocaleDateString()} → ${new Date(selectedUniverse.date_range_end).toLocaleDateString()}`}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
      <BehaviorProgressPanel stage={stage} />

      {selectedUniverse && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Configuration</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                <InputLabel>Entity Level</InputLabel>
                <Select
                  value={config.entity_level}
                  label="Entity Level"
                  disabled={runs.length > 0}
                  onChange={(e) => {
                    const lvl = e.target.value;
                    const idCol = lvl === 'customer' ? 'customer_id' : 'account_id';
                    setConfig({ ...config, entity_level: lvl, entity_id_col: idCol });
                  }}
                >
                  <MenuItem value="account">account</MenuItem>
                  <MenuItem value="customer">customer</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth size="small" sx={{ mb: 1 }}
                label="Entity ID Column"
                value={config.entity_id_col}
                onChange={(e) => setConfig({ ...config, entity_id_col: e.target.value })}
              />
              <TextField
                fullWidth size="small"
                label="Time Column"
                value={config.time_col}
                onChange={(e) => setConfig({ ...config, time_col: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth size="small" sx={{ mb: 1 }}
                label="Metric Name"
                value={config.metrics[0].name}
                onChange={(e) => setConfig({ ...config, metrics: [{ ...config.metrics[0], name: e.target.value }] })}
              />
              <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                <InputLabel>Metric Type</InputLabel>
                <Select
                  value={config.metrics[0].type}
                  label="Metric Type"
                  onChange={(e) => setConfig({ ...config, metrics: [{ ...config.metrics[0], type: e.target.value }] })}
                >
                  <MenuItem value="SUM">SUM</MenuItem>
                  <MenuItem value="COUNT">COUNT</MenuItem>
                  <MenuItem value="MAX">MAX</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth size="small" sx={{ mb: 1 }}
                label="Column"
                value={config.metrics[0].column}
                onChange={(e) => setConfig({ ...config, metrics: [{ ...config.metrics[0], column: e.target.value }] })}
              />
              <TextField
                fullWidth size="small"
                label="Window"
                value={config.metrics[0].window}
                onChange={(e) => setConfig({ ...config, metrics: [{ ...config.metrics[0], window: e.target.value }] })}
              />
              {getWindowIntent(config.metrics?.[0]?.window) && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                  Intent: {getWindowIntent(config.metrics?.[0]?.window)}
                </Typography>
              )}
            </Grid>
          </Grid>
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            Computing {config.metrics[0].name} = {config.metrics[0].type}({config.metrics[0].column}) per {config.entity_level.toUpperCase()} over {config.metrics[0].window}.
          </Typography>
          <Button variant="contained" sx={{ mt: 1.5 }} onClick={runBehavior} disabled={!selectedUniverse}>
            Run Behaviour
          </Button>
        </Paper>
      )}

      {selectedUniverse && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0, mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Runs</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Run ID</TableCell>
                  <TableCell>Metric</TableCell>
                  <TableCell>Entity</TableCell>
                  <TableCell>Window</TableCell>
                  <TableCell align="right">Rows</TableCell>
                  <TableCell>Run Timestamp</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((r) => (
                  <TableRow
                    key={r.behavior_run_id}
                    hover
                    selected={r.behavior_run_id === activeRunId}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => handleViewRun(r.behavior_run_id)}
                  >
                    <TableCell>{`R-${String(r.behavior_run_id).padStart(3, '0')}`}</TableCell>
                    <TableCell>{r.config?.metrics?.[0]?.name || 'metric'}</TableCell>
                    <TableCell>{r.entity_level}</TableCell>
                    <TableCell>{r.config?.metrics?.[0]?.window || '—'}</TableCell>
                    <TableCell align="right">{(r.total_rows || 0).toLocaleString()}</TableCell>
                    <TableCell>{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={(e) => { e.stopPropagation(); handleViewRun(r.behavior_run_id); }}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
                      No runs available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {selectedUniverse && (
        <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Preview Output</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Behaviour values aligned to transaction timestamps. Rows represent behaviour state at each transaction timestamp using rolling windows.
              </Typography>
            </Box>
          </Box>
          <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="Search Entity"
                value={previewFilters.entity_search}
                onChange={(e) => setPreviewFilters((p) => ({ ...p, entity_search: e.target.value }))}
                sx={{ width: 220 }}
              />
              <TextField
                size="small"
                label="Min Value"
                value={previewFilters.value_min}
                onChange={(e) => setPreviewFilters((p) => ({ ...p, value_min: e.target.value }))}
                sx={{ width: 140 }}
              />
              <TextField
                size="small"
                label="Max Value"
                value={previewFilters.value_max}
                onChange={(e) => setPreviewFilters((p) => ({ ...p, value_max: e.target.value }))}
                sx={{ width: 140 }}
              />
              <FormControl size="small" sx={{ width: 180 }}>
                <InputLabel>Sort</InputLabel>
                <Select
                  value={previewFilters.sort_by}
                  label="Sort"
                  onChange={(e) => setPreviewFilters((p) => ({ ...p, sort_by: e.target.value }))}
                >
                  <MenuItem value="as_of_date">Transaction Timestamp</MenuItem>
                  <MenuItem value="metric_value">Behaviour Value</MenuItem>
                  <MenuItem value="entity_id">Account</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ width: 120 }}>
                <InputLabel>Order</InputLabel>
                <Select
                  value={previewFilters.sort_dir}
                  label="Order"
                  onChange={(e) => setPreviewFilters((p) => ({ ...p, sort_dir: e.target.value }))}
                >
                  <MenuItem value="asc">Asc</MenuItem>
                  <MenuItem value="desc">Desc</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <ToggleButtonGroup
              value={previewMode}
              exclusive
              size="small"
              onChange={(_e, v) => v && setPreviewMode(v)}
            >
              <ToggleButton value="transactions">Transactions</ToggleButton>
              <ToggleButton value="entity_last">Entity (last)</ToggleButton>
              <ToggleButton value="entity_max">Entity (max)</ToggleButton>
              <ToggleButton value="entity_avg">Entity (avg)</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <TableContainer sx={{ maxHeight: 240 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Entity</TableCell>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Metric</TableCell>
                  <TableCell align="right">
                    <Box component="span">Metric Value</Box>
                  </TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{row.entity_id}</TableCell>
                    <TableCell>{row.as_of_date}</TableCell>
                    <TableCell>{row.metric_name}</TableCell>
                    <TableCell align="right">{(row.metric_value ?? 0).toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => setTimeline({ open: true, entity_id: row.entity_id })}
                        sx={{ textTransform: 'none' }}
                      >
                        View Timeline
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {previewRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                      Select a run to view preview rows.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={-1}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            labelRowsPerPage="Rows per page"
          />
        </Paper>
      )}
      <Box sx={{ mt: 2 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
          <Tab label="Behaviour Quality" value="quality" />
          <Tab label="Signal Intelligence" value="intelligence" />
          <Tab label="Behaviour Interaction Intelligence" value="interaction" />
          <Tab label="Behaviour Comparison" value="compare" />
        </Tabs>
      </Box>
      {activeTab === 'quality' && (
        <>
          {activeRunId && <BehaviorQualityPanel runId={activeRunId} />}
          {activeRunId && <MetricOverTimePanel runId={activeRunId} />}
          {activeRunId && <BehaviorTopKPanel runId={activeRunId} onViewTimeline={(entity_id) => setTimeline({ open: true, entity_id })} />}
        </>
      )}
      {activeTab === 'intelligence' && (
        <>
          {activeRunId && <BehaviorSignalIntelligencePanel runId={activeRunId} />}
        </>
      )}
      {activeTab === 'interaction' && (
        <>
          {activeRunId && <BehaviorInteractionIntelligencePanel runId={activeRunId} />}
        </>
      )}
      {activeTab === 'compare' && (
        <BehaviorComparisonPanel universeId={selectedUniverse?.id} runs={runs} />
      )}

      <AccountBehaviorTimelineDialog
        open={timeline.open}
        onClose={() => setTimeline({ open: false, entity_id: null })}
        entityId={timeline.entity_id}
        runs={runs}
        defaultRunIds={activeRunId ? [activeRunId] : []}
      />
    </Box>
  );
};

export default BehaviorBuilderScreen;
