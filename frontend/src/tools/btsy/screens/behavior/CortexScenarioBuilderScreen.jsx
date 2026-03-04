import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Alert,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { DataGrid } from '@mui/x-data-grid';
import btsyApi from '../../services/btsyApi';

const defaultGrouping = {
  aggregation_level: 'daily',
  entity_level: 'account',
  transaction_type: 'ALL'
};

const defaultLookback = {
  lookback_days: 10
};

const toTitle = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

const buildColumns = (rows) => {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => ({
    field: key,
    headerName: toTitle(key),
    flex: 1,
    minWidth: 140
  }));
};

const buildRows = (rows) => {
  if (!rows) return [];
  return rows.map((row, idx) => ({
    id: `${idx}-${row.account_id || ''}-${row.customer_id || ''}-${row.transaction_datetime || ''}`,
    ...row
  }));
};

const Metric = ({ label, value }) => (
  <Stack spacing={0.25}>
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
  </Stack>
);

const StageHeader = ({ title, stats, right }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      {stats && (
        <Stack direction="row" spacing={2} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Metric label="Rows" value={(stats.rows || 0).toLocaleString()} />
          <Metric label="Accounts" value={(stats.accounts || 0).toLocaleString()} />
          <Metric label="Customers" value={(stats.customers || 0).toLocaleString()} />
        </Stack>
      )}
    </Box>
    {right}
  </Box>
);

const PreviewGrid = ({ rows }) => {
  const columns = useMemo(() => buildColumns(rows), [rows]);
  const gridRows = useMemo(() => buildRows(rows), [rows]);
  if (columns.length === 0) {
    return (
      <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
        No rows yet.
      </Box>
    );
  }
  return (
    <Box sx={{ height: 360 }}>
      <DataGrid
        rows={gridRows}
        columns={columns}
        density="compact"
        disableRowSelectionOnClick
        pageSizeOptions={[50, 100, 200]}
        initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
      />
    </Box>
  );
};

const CortexScenarioBuilderScreen = ({ calibrationRunId }) => {
  const [universe, setUniverse] = useState(null);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState(null);
  const [availableTypes, setAvailableTypes] = useState([]);
  const [categories, setCategories] = useState({});
  const [expanded, setExpanded] = useState('static');
  const [loadingUniverse, setLoadingUniverse] = useState(false);
  const [selectedThreshold, setSelectedThreshold] = useState(null);

  const [staticState, setStaticState] = useState({ loading: false, stats: null, rows: [] });
  const [groupState, setGroupState] = useState({ loading: false, stats: null, rows: [] });
  const [lookbackState, setLookbackState] = useState({ loading: false, stats: null, rows: [] });
  const [thresholdState, setThresholdState] = useState({ loading: false, stats: null, rows: [], worst: [] });

  const [grouping, setGrouping] = useState(defaultGrouping);
  const [lookback, setLookback] = useState(defaultLookback);

  const [staticFilters, setStaticFilters] = useState({ account_id: '', customer_id: '' });
  const [groupFilters, setGroupFilters] = useState({ account_id: '', customer_id: '' });
  const [lookbackFilters, setLookbackFilters] = useState({ account_id: '', customer_id: '', as_of_date: '' });
  const [thresholdFilters, setThresholdFilters] = useState({ account_id: '', customer_id: '' });

  useEffect(() => {
    const loadSelected = async () => {
      setLoadingUniverse(true);
      setError('');
      try {
        let sel = null;
        const hintUniverseId = sessionStorage.getItem('btsy_selected_universe_id');
        if (hintUniverseId) {
          const res = await btsyApi.universe.getUniverse(hintUniverseId);
          if (res?.success) sel = res.data;
        } else if (calibrationRunId) {
          const res = await btsyApi.universe.getSelected(calibrationRunId);
          if (res?.success) sel = res.data;
        }
        if (!sel && (sessionStorage.getItem(`btsy_active_run_id_text:${sessionStorage.getItem('btsy_env_id') || 'default'}`) || '').trim()) {
          const rid = sessionStorage.getItem(`btsy_active_run_id_text:${sessionStorage.getItem('btsy_env_id') || 'default'}`);
          const res = await btsyApi.universe.getSelected(null, rid);
          if (res?.success) sel = res.data;
        }
        if (!sel) {
          setError('No selected universe found for this run.');
        }
        setUniverse(sel);
      } catch (e) {
        setError(e.message || 'Failed to load selected universe');
      } finally {
        setLoadingUniverse(false);
      }
    };
    loadSelected();
  }, [calibrationRunId]);

  const universeTypes = useMemo(() => {
    const fromFilter = universe?.filter_spec?.types;
    const normalized = Array.isArray(fromFilter) && fromFilter.length
      ? fromFilter.map((t) => String(t).toUpperCase())
      : availableTypes;
    return Array.from(new Set(normalized.filter(Boolean)));
  }, [universe, availableTypes]);

  const allowTxSelect = universeTypes.length > 1;
  const universeTypeLabel = universeTypes.length === 1 ? universeTypes[0] : universeTypes.length > 1 ? universeTypes.join(' + ') : 'UNKNOWN';

  const runStatic = async () => {
    if (!universe?.id) {
      setError('No universe selected. Create or select a universe first.');
      return;
    }
    setStaticState((s) => ({ ...s, loading: true }));
    setError('');
    try {
      const res = await btsyApi.thresholdConstruction.start({
        universe_id: universe.id,
        created_by: 'user',
        limit: 200,
        offset: 0
      });
      if (!res?.success) throw new Error(res?.error || 'Static stage failed');
      const data = res.data || {};
      setRunId(data.run_id || null);
      setAvailableTypes(data.available_transaction_types || []);
      setCategories(data.categories || {});
      setStaticState({ loading: false, stats: data.stats || null, rows: data.preview || [] });
    } catch (e) {
      setStaticState((s) => ({ ...s, loading: false }));
      setError(e.message || 'Static stage failed');
    }
  };

  const runGrouping = async (withFilters = false) => {
    if (!runId) return;
    setGroupState((s) => ({ ...s, loading: true }));
    setError('');
    try {
      const res = await btsyApi.thresholdConstruction.group({
        run_id: runId,
        aggregation_level: grouping.aggregation_level,
        entity_level: grouping.entity_level,
        transaction_type: allowTxSelect ? grouping.transaction_type : universeTypes[0] || 'ALL',
        limit: 200,
        offset: 0,
        account_id: withFilters ? groupFilters.account_id || undefined : undefined,
        customer_id: withFilters ? groupFilters.customer_id || undefined : undefined
      });
      if (!res?.success) throw new Error(res?.error || 'Grouping stage failed');
      const data = res.data || {};
      setGroupState({ loading: false, stats: data.stats || null, rows: data.preview || [] });
    } catch (e) {
      setGroupState((s) => ({ ...s, loading: false }));
      setError(e.message || 'Grouping stage failed');
    }
  };

  const runLookback = async (overrideFilters = null) => {
    if (!runId) return;
    setLookbackState((s) => ({ ...s, loading: true }));
    setError('');
    try {
      const filters = overrideFilters || {};
      const res = await btsyApi.thresholdConstruction.lookback({
        run_id: runId,
        lookback_days: lookback.lookback_days,
        limit: 200,
        offset: 0,
        account_id: filters.account_id || undefined,
        customer_id: filters.customer_id || undefined,
        as_of_date: filters.as_of_date || undefined
      });
      if (!res?.success) throw new Error(res?.error || 'Lookback stage failed');
      const data = res.data || {};
      setLookbackState({ loading: false, stats: data.stats || null, rows: data.preview || [] });
    } catch (e) {
      setLookbackState((s) => ({ ...s, loading: false }));
      setError(e.message || 'Lookback stage failed');
    }
  };

  const runThreshold = async (withFilters = false) => {
    if (!runId) return;
    setThresholdState((s) => ({ ...s, loading: true }));
    setError('');
    try {
      const res = await btsyApi.thresholdConstruction.threshold({
        run_id: runId,
        limit: 200,
        offset: 0,
        account_id: withFilters ? thresholdFilters.account_id || undefined : undefined,
        customer_id: withFilters ? thresholdFilters.customer_id || undefined : undefined
      });
      if (!res?.success) throw new Error(res?.error || 'Threshold stage failed');
      const data = res.data || {};
      setThresholdState({ loading: false, stats: data.stats || null, rows: data.preview || [], worst: data.worst_case || [] });
    } catch (e) {
      setThresholdState((s) => ({ ...s, loading: false }));
      setError(e.message || 'Threshold stage failed');
    }
  };

  const onReconstruct = (row) => {
    const nextFilters = {
      account_id: row.account_id || '',
      customer_id: row.customer_id || '',
      as_of_date: row.transaction_datetime || ''
    };
    setLookbackFilters(nextFilters);
    setExpanded('lookback');
    runLookback(nextFilters);
  };

  const runStaticInspect = async () => {
    if (!runId) return;
    setStaticState((s) => ({ ...s, loading: true }));
    setError('');
    try {
      const res = await btsyApi.thresholdConstruction.start({
        run_id: runId,
        limit: 200,
        offset: 0,
        account_id: staticFilters.account_id || undefined,
        customer_id: staticFilters.customer_id || undefined
      });
      if (!res?.success) throw new Error(res?.error || 'Static inspection failed');
      const data = res.data || {};
      setStaticState((s) => ({ ...s, loading: false, rows: data.preview || [] }));
    } catch (e) {
      setStaticState((s) => ({ ...s, loading: false }));
      setError(e.message || 'Static inspection failed');
    }
  };

  const runGroupInspect = async () => {
    await runGrouping(true);
  };

  const runLookbackInspect = async () => {
    if (!runId) return;
    await runLookback({ ...lookbackFilters });
  };

  const runThresholdInspect = async () => {
    await runThreshold(true);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Threshold Construction Studio</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Transparent, stepwise threshold construction with persistent intermediate datasets.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loadingUniverse && (
        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0, mb: 2 }}>
          <LinearProgress />
        </Paper>
      )}

      {!loadingUniverse && !universe && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Select a transaction universe to proceed.
        </Alert>
      )}

      {universe && (
        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Universe Context</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={8}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label={`Rows: ${(universe.transaction_count || staticState.stats?.rows || 0).toLocaleString()}`} />
                <Chip label={`Accounts: ${(universe.unique_accounts || staticState.stats?.accounts || 0).toLocaleString()}`} />
                <Chip label={`Customers: ${(universe.unique_customers || staticState.stats?.customers || 0).toLocaleString()}`} />
                <Chip label={`Universe: ${universeTypeLabel}`} color="primary" />
                <Chip label={`Date: ${universe.date_range_start || staticState.stats?.date_start || '—'} → ${universe.date_range_end || staticState.stats?.date_end || '—'}`} />
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Categories</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {Object.keys(universe.category_breakdown || categories || {}).length === 0 && (
                  <Chip label="None" size="small" />
                )}
                {Object.entries(universe.category_breakdown || categories || {}).map(([key, value]) => (
                  <Chip key={key} label={`${key}: ${value}`} size="small" />
                ))}
              </Stack>
            </Grid>
          </Grid>
        </Paper>
      )}

      <Accordion expanded={expanded === 'static'} onChange={() => setExpanded(expanded === 'static' ? false : 'static')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <StageHeader title="Static Filtration Output" stats={staticState.stats} right={null} />
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Dataset already filtered by universe selection.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="contained" onClick={runStatic} disabled={staticState.loading}>
                {staticState.loading ? 'Running...' : 'Build Static Output'}
              </Button>
              {staticState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Inspect Specific Entity (Optional)</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Account ID"
                value={staticFilters.account_id}
                onChange={(e) => setStaticFilters((s) => ({ ...s, account_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Customer ID"
                value={staticFilters.customer_id}
                onChange={(e) => setStaticFilters((s) => ({ ...s, customer_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={runStaticInspect} disabled={!runId || staticState.loading}>
                Inspect
              </Button>
              {staticState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <PreviewGrid rows={staticState.rows} />
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'group'} onChange={() => setExpanded(expanded === 'group' ? false : 'group')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <StageHeader
            title="Grouping Stage"
            stats={groupState.stats}
            right={allowTxSelect ? null : <Chip label={`Universe: ${universeTypeLabel}`} />}
          />
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Aggregate by time and entity to create grouped datasets for lookback expansion.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {allowTxSelect && (
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Transaction Type</InputLabel>
                  <Select
                    label="Transaction Type"
                    value={grouping.transaction_type}
                    onChange={(e) => setGrouping((s) => ({ ...s, transaction_type: e.target.value }))}
                  >
                    <MenuItem value="ALL">ALL</MenuItem>
                    {universeTypes.map((t) => (
                      <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Aggregation Level</InputLabel>
                <Select
                  label="Aggregation Level"
                  value={grouping.aggregation_level}
                  onChange={(e) => setGrouping((s) => ({ ...s, aggregation_level: e.target.value }))}
                >
                  <MenuItem value="daily">daily</MenuItem>
                  <MenuItem value="monthly">monthly</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Entity Level</InputLabel>
                <Select
                  label="Entity Level"
                  value={grouping.entity_level}
                  onChange={(e) => setGrouping((s) => ({ ...s, entity_level: e.target.value }))}
                >
                  <MenuItem value="account">account</MenuItem>
                  <MenuItem value="customer">customer</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button variant="contained" onClick={runGrouping} disabled={!runId || groupState.loading}>
                {groupState.loading ? 'Running...' : 'Build Grouped Dataset'}
              </Button>
            </Grid>
          </Grid>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Inspect Specific Entity (Optional)</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Account ID"
                value={groupFilters.account_id}
                onChange={(e) => setGroupFilters((s) => ({ ...s, account_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Customer ID"
                value={groupFilters.customer_id}
                onChange={(e) => setGroupFilters((s) => ({ ...s, customer_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={runGroupInspect} disabled={!runId || groupState.loading}>
                Inspect
              </Button>
              {groupState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <PreviewGrid rows={groupState.rows} />
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'lookback'} onChange={() => setExpanded(expanded === 'lookback' ? false : 'lookback')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <StageHeader title="Lookback Expansion Stage" stats={lookbackState.stats} right={null} />
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Generate lookback-expanded rows for each period based on dynamic lookback days.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Lookback Days"
                type="number"
                value={lookback.lookback_days}
                onChange={(e) => setLookback((s) => ({ ...s, lookback_days: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="contained" onClick={() => runLookback()} disabled={!runId || lookbackState.loading}>
                {lookbackState.loading ? 'Running...' : 'Build Lookback'}
              </Button>
              {lookbackState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Inspect Specific Entity (Optional)</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Account ID"
                value={lookbackFilters.account_id}
                onChange={(e) => setLookbackFilters((s) => ({ ...s, account_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Customer ID"
                value={lookbackFilters.customer_id}
                onChange={(e) => setLookbackFilters((s) => ({ ...s, customer_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="As Of Date"
                value={lookbackFilters.as_of_date}
                onChange={(e) => setLookbackFilters((s) => ({ ...s, as_of_date: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={runLookbackInspect} disabled={!runId || lookbackState.loading}>
                Inspect
              </Button>
              {lookbackState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <PreviewGrid rows={lookbackState.rows} />
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'threshold'} onChange={() => setExpanded(expanded === 'threshold' ? false : 'threshold')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <StageHeader title="Threshold Population Stage" stats={thresholdState.stats} right={null} />
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Aggregate worst-case thresholds and inspect final population before reconstruction.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="contained" onClick={() => runThreshold(false)} disabled={!runId || thresholdState.loading}>
                {thresholdState.loading ? 'Running...' : 'Build Thresholds'}
              </Button>
              {thresholdState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Inspect Specific Entity (Optional)</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Account ID"
                value={thresholdFilters.account_id}
                onChange={(e) => setThresholdFilters((s) => ({ ...s, account_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Customer ID"
                value={thresholdFilters.customer_id}
                onChange={(e) => setThresholdFilters((s) => ({ ...s, customer_id: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={runThresholdInspect} disabled={!runId || thresholdState.loading}>
                Inspect
              </Button>
              {thresholdState.loading && <LinearProgress sx={{ flex: 1 }} />}
            </Grid>
          </Grid>
          <Box sx={{ height: 360 }}>
            <DataGrid
              rows={buildRows(thresholdState.rows)}
              columns={buildColumns(thresholdState.rows)}
              density="compact"
              disableRowSelectionOnClick
              pageSizeOptions={[50, 100, 200]}
              initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
              onRowClick={(params) => setSelectedThreshold(params.row)}
            />
          </Box>
          {selectedThreshold && (
            <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 0, mt: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Reconstruction Panel</Typography>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 1 }}>
                <Chip label={`Account: ${selectedThreshold.account_id || '—'}`} />
                <Chip label={`Customer: ${selectedThreshold.customer_id || '—'}`} />
                <Chip label={`As Of: ${selectedThreshold.transaction_datetime || '—'}`} />
                <Chip label={`Threshold: ${(selectedThreshold.threshold_amt || 0).toLocaleString()}`} />
              </Stack>
              <Button variant="contained" onClick={() => onReconstruct(selectedThreshold)} disabled={!runId}>
                Show Lookback Rows
              </Button>
            </Paper>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Worst Case Population</Typography>
          <PreviewGrid rows={thresholdState.worst} />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default CortexScenarioBuilderScreen;
