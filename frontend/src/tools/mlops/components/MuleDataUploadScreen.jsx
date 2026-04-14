import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  CloudUpload,
  Close,
  Refresh,
  Search,
  UploadFile,
  Visibility,
} from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';

const DEFAULT_BUNDLE_PATH = 'E:\\VS CODE Backup\\Trae\\AI_AML_tool\\data_generation_scripts\\mule_data\\mule_output';
const SURFACE_RADIUS = '6px';
const DEFAULT_INSPECTOR_WIDTH = 480;
const MIN_INSPECTOR_WIDTH = 260;
const MIN_MAIN_PANEL_WIDTH = 520;

const MULE_SOURCE_LIBRARY = [
  { type: 'accounts', label: 'Accounts', required: true, description: 'Base account table. Every Mule row is anchored here.' },
  { type: 'customers', label: 'Customers', required: true, description: 'Customer and identity context linked onto each account.' },
  { type: 'transactions', label: 'Transactions', required: true, description: 'Raw transaction activity used to create behavior and velocity signals.' },
  { type: 'counterparties', label: 'Counterparties', required: false, description: 'Counterparty network and concentration context.' },
  { type: 'device_logs', label: 'Device Logs', required: false, description: 'Device, IP, and digital access signals.' },
  { type: 'external_signals', label: 'External Signals', required: false, description: 'Complaints, risk indicators, and external intelligence.' },
  { type: 'graph_nodes', label: 'Graph Nodes', required: false, description: 'Network node data used for Mule ring analytics.' },
  { type: 'graph_edges', label: 'Graph Edges', required: false, description: 'Relationship edges used for graph/ring analysis.' },
  { type: 'account_daily_summary', label: 'Account Daily Summary', required: false, description: 'Account-level rollups already prepared at daily grain.' },
  { type: 'mule_labels', label: 'Mule Labels', required: false, description: 'Known Mule outcomes for supervised learning.' },
  { type: 'mule_typology', label: 'Mule Typology', required: false, description: 'Mule category labels such as M1-M5 for multi-class output.' },
];

const REQUIRED_SOURCE_TYPES = new Set(MULE_SOURCE_LIBRARY.filter((item) => item.required).map((item) => item.type));

const toApiData = (payload) => payload?.data || payload || {};
const formatNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : '0';
};
const formatPct = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return `${(numeric * (numeric <= 1 ? 100 : 1)).toFixed(numeric <= 1 ? 1 : 0)}%`;
};
const formatQuality = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Profiling';
  return `${Math.round(numeric)}/100`;
};
const sourceLabel = (type) => MULE_SOURCE_LIBRARY.find((item) => item.type === type)?.label || type;
const normalizeFileStem = (name = '') => String(name || '').replace(/\.(csv|parquet)$/i, '').trim().toLowerCase();

const autoDetectMuleSourceType = (filename = '') => {
  const stem = normalizeFileStem(filename);
  const direct = MULE_SOURCE_LIBRARY.find((item) => item.type === stem);
  if (direct) return direct.type;
  if (stem.includes('account') && stem.includes('summary')) return 'account_daily_summary';
  if (stem.includes('device')) return 'device_logs';
  if (stem.includes('external')) return 'external_signals';
  if (stem.includes('graph') && stem.includes('node')) return 'graph_nodes';
  if (stem.includes('graph') && stem.includes('edge')) return 'graph_edges';
  if (stem.includes('counterpart')) return 'counterparties';
  if (stem.includes('typology')) return 'mule_typology';
  if (stem.includes('label')) return 'mule_labels';
  if (stem.includes('transaction')) return 'transactions';
  if (stem.includes('customer')) return 'customers';
  if (stem === 'accounts' || stem.startsWith('account_') || stem.startsWith('accounts_')) return 'accounts';
  return '';
};

const profileColumnsToRows = (profile) => {
  const columns = profile?.columns || {};
  return Object.entries(columns).map(([name, meta]) => ({
    name,
    dtype: String(meta?.dtype || ''),
    null_pct: Number(meta?.null_pct),
    unique_count: Number(meta?.unique_count),
    sample_value: meta?.sample_value ?? '',
  }));
};

const SourceStat = ({ label, value, helper }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: SURFACE_RADIUS, minWidth: 0 }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#7A8699', textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#151B27', mt: 0.25 }}>
      {value}
    </Typography>
    {helper ? <Typography sx={{ fontSize: 12, color: '#556070', mt: 0.4 }}>{helper}</Typography> : null}
  </Paper>
);

const SourceInspectorPanel = ({ open, onClose, dataset, loading, preview, profile, width }) => {
  if (!dataset) return null;
  const previewRows = Array.isArray(preview?.preview) ? preview.preview : [];
  const previewColumns = Array.isArray(preview?.columns) ? preview.columns : [];
  const columnRows = useMemo(() => profileColumnsToRows(profile), [profile]);

  return (
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: SURFACE_RADIUS,
          alignSelf: 'stretch',
          width: '100%',
          maxWidth: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          opacity: open ? 1 : 0,
          transform: open ? 'translateX(0)' : 'translateX(24px)',
          transition: 'opacity 180ms ease, transform 220ms ease',
          pointerEvents: open ? 'auto' : 'none',
          boxShadow: '0 10px 28px rgba(15,23,42,0.14)',
          minWidth: 0,
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#151B27' }}>
              {sourceLabel(dataset?.dataset_type)}
            </Typography>
            <Typography sx={{ fontSize: 13, color: '#556070', mt: 0.4 }}>
              {dataset?.filename || 'No file attached'}
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
            <Close />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
          <Chip label={`Rows: ${formatNumber(dataset?.row_count)}`} variant="outlined" />
          <Chip label={`Columns: ${Array.isArray(dataset?.columns) ? dataset.columns.length : 0}`} variant="outlined" />
          <Chip label={`Quality: ${formatQuality(profile?.quality_score)}`} variant="outlined" />
          <Chip label={`Profiled: ${profile ? 'Yes' : 'Pending'}`} color={profile ? 'success' : 'default'} variant="outlined" />
        </Stack>

        {loading ? (
          <Stack spacing={1.25} sx={{ mt: 2.5, flex: 1 }}>
            <LinearProgress />
            <Typography sx={{ fontSize: 13, color: '#556070' }}>
              Loading sample rows and profiling details from the backend...
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 2.5, minHeight: 0, overflowY: 'auto', pr: 0.5, flex: 1 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <SourceStat label="Total Rows" value={formatNumber(dataset?.row_count)} />
              <SourceStat label="Total Columns" value={formatNumber(profile?.total_columns || dataset?.columns?.length || 0)} />
              <SourceStat label="Missing %" value={formatPct(profile?.overall_missing_pct)} />
              <SourceStat label="Duplicate %" value={formatPct(profile?.duplicate_pct)} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <SourceStat label="Numeric Columns" value={formatNumber(profile?.numeric_columns || 0)} />
              <SourceStat label="Categorical Columns" value={formatNumber(profile?.categorical_columns || 0)} />
              <SourceStat label="Quality Score" value={formatQuality(profile?.quality_score)} />
              <SourceStat label="Rows Sampled" value={formatNumber(preview?.sample_row_count || previewRows.length)} />
            </Stack>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#151B27', mb: 1 }}>Sample Data</Typography>
              <TableContainer sx={{ maxHeight: 260, border: '1px solid #E5E7EB', borderRadius: 2 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {previewColumns.map((column) => (
                        <TableCell key={column} sx={{ fontWeight: 800, whiteSpace: 'nowrap', bgcolor: '#F8F9FB' }}>{column}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewRows.length > 0 ? previewRows.map((row, index) => (
                      <TableRow key={`row_${index}`} hover>
                        {previewColumns.map((column) => (
                          <TableCell key={`${index}_${column}`} sx={{ fontSize: 12, color: '#151B27', whiteSpace: 'nowrap' }}>
                            {String(row?.[column] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={Math.max(previewColumns.length, 1)} sx={{ fontSize: 12.5, color: '#556070' }}>
                          No sample rows available yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#151B27', mb: 1 }}>Column Profiling</Typography>
              <TableContainer sx={{ maxHeight: 320, border: '1px solid #E5E7EB', borderRadius: 2 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Column</TableCell>
                      <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Null %</TableCell>
                      <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Unique</TableCell>
                      <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Sample</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {columnRows.length > 0 ? columnRows.map((row) => (
                      <TableRow key={row.name} hover>
                        <TableCell sx={{ fontSize: 12, fontWeight: 700, color: '#151B27' }}>{row.name}</TableCell>
                        <TableCell sx={{ fontSize: 12, color: '#556070' }}>{row.dtype || 'unknown'}</TableCell>
                        <TableCell sx={{ fontSize: 12, color: '#556070' }}>{formatPct(row.null_pct)}</TableCell>
                        <TableCell sx={{ fontSize: 12, color: '#556070' }}>{formatNumber(row.unique_count)}</TableCell>
                        <TableCell sx={{ fontSize: 12, color: '#556070', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(row.sample_value ?? '')}
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ fontSize: 12.5, color: '#556070' }}>
                          Profiling is still being generated for this source.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        )}
      </Paper>
  );
};

const MuleDataUploadScreen = ({ activePipelineId, datasets = [], onDatasetsRefresh }) => {
  const pipelineId = Number(activePipelineId || 0);
  const [bundlePath, setBundlePath] = useState(DEFAULT_BUNDLE_PATH);
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [uploadingByType, setUploadingByType] = useState({});
  const [bundleImporting, setBundleImporting] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorDataset, setInspectorDataset] = useState(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorPreview, setInspectorPreview] = useState(null);
  const [inspectorProfile, setInspectorProfile] = useState(null);
  const [inspectorWidth, setInspectorWidth] = useState(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [searchText, setSearchText] = useState('');
  const singleUploadInputRef = useRef(null);
  const bulkUploadInputRef = useRef(null);
  const pendingSourceTypeRef = useRef('');
  const desktopWorkspaceRef = useRef(null);
  const resizingInspectorRef = useRef(false);

  const notify = useCallback((message, severity = 'info') => {
    setToast({ open: true, message, severity });
  }, []);

  const fallbackOverview = useMemo(() => {
    const muleDatasets = (datasets || [])
      .filter((dataset) => MULE_SOURCE_LIBRARY.some((item) => item.type === String(dataset?.dataset_type || '').trim().toLowerCase()))
      .sort((left, right) => Number(right?.dataset_id || 0) - Number(left?.dataset_id || 0));
    const byType = new Map();
    muleDatasets.forEach((dataset) => {
      const dtype = String(dataset?.dataset_type || '').trim().toLowerCase();
      if (!byType.has(dtype)) byType.set(dtype, []);
      byType.get(dtype).push(dataset);
    });
    const sourceSlots = MULE_SOURCE_LIBRARY.map((spec) => {
      const versions = byType.get(spec.type) || [];
      return {
        ...spec,
        loaded: versions.length > 0,
        versions: versions.length,
        latest_dataset: versions[0] || null,
        profile: versions[0]?.profile || null,
      };
    });
    const loadedSources = sourceSlots.filter((item) => item.loaded).map((item) => ({
      ...(item.latest_dataset || {}),
      profile: item.profile,
      versions: item.versions,
    }));
    return {
      source_slots: sourceSlots,
      loaded_sources: loadedSources,
      summary: {
        tables_loaded: loadedSources.length,
        source_slots_loaded: loadedSources.length,
        required_loaded: sourceSlots.filter((item) => item.required && item.loaded).length,
        required_total: MULE_SOURCE_LIBRARY.filter((item) => item.required).length,
        total_rows: loadedSources.reduce((sum, item) => sum + Number(item?.row_count || 0), 0),
        total_columns: loadedSources.reduce((sum, item) => sum + Number(item?.columns?.length || 0), 0),
      },
    };
  }, [datasets]);

  const refreshOverview = useCallback(async (sync = false) => {
    if (!pipelineId) return;
    setLoadingOverview(true);
    try {
      if (sync) {
        await onDatasetsRefresh?.({ sync: true });
      }
      const res = await mlopsApi.muleUploadSources(pipelineId);
      setOverview(toApiData(res));
    } catch {
      setOverview(null);
    } finally {
      setLoadingOverview(false);
    }
  }, [onDatasetsRefresh, pipelineId]);

  useEffect(() => {
    if (!pipelineId) return undefined;
    refreshOverview(false);
    return undefined;
  }, [pipelineId, refreshOverview]);

  const effectiveOverview = overview || fallbackOverview;
  const sourceSlots = Array.isArray(effectiveOverview?.source_slots) ? effectiveOverview.source_slots : [];
  const summary = effectiveOverview?.summary || {};

  const filteredSlots = useMemo(() => {
    const term = String(searchText || '').trim().toLowerCase();
    if (!term) return sourceSlots;
    return sourceSlots.filter((slot) => {
      const haystack = [slot.label, slot.type, slot.latest_dataset?.filename, slot.description].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [searchText, sourceSlots]);

  const missingRequired = useMemo(
    () => sourceSlots.filter((slot) => slot.required && !slot.loaded),
    [sourceSlots],
  );

  const uploadOneFile = useCallback(async (datasetType, file) => {
    if (!pipelineId || !file) return;
    setUploadingByType((prev) => ({ ...prev, [datasetType]: true }));
    try {
      await mlopsApi.uploadDataset(datasetType, file, {
        pipeline_id: pipelineId,
        pipeline_type: 'mule',
      });
      await refreshOverview(true);
      notify(`${sourceLabel(datasetType)} uploaded successfully.`, 'success');
    } catch (error) {
      notify(error?.message || `Failed to upload ${datasetType}.`, 'error');
    } finally {
      setUploadingByType((prev) => ({ ...prev, [datasetType]: false }));
    }
  }, [notify, pipelineId, refreshOverview]);

  const handleImportBundle = useCallback(async () => {
    if (!pipelineId) return;
    setBundleImporting(true);
    try {
      const res = await mlopsApi.muleImportBundle(pipelineId, { bundle_path: bundlePath });
      const payload = toApiData(res);
      await refreshOverview(true);
      notify(`Imported ${formatNumber(payload?.imported_count || 0)} Mule source tables into this run.`, 'success');
    } catch (error) {
      notify(error?.message || 'Failed to import Mule bundle.', 'error');
    } finally {
      setBundleImporting(false);
    }
  }, [bundlePath, notify, pipelineId, refreshOverview]);

  const openSourceUpload = useCallback((datasetType) => {
    pendingSourceTypeRef.current = datasetType;
    if (singleUploadInputRef.current) {
      singleUploadInputRef.current.value = '';
      singleUploadInputRef.current.click();
    }
  }, []);

  const handleSingleFilePicked = useCallback(async (event) => {
    const file = event.target.files?.[0];
    const datasetType = pendingSourceTypeRef.current;
    pendingSourceTypeRef.current = '';
    if (!file || !datasetType) return;
    await uploadOneFile(datasetType, file);
  }, [uploadOneFile]);

  const handleBulkFilesPicked = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    for (const file of files) {
      const datasetType = autoDetectMuleSourceType(file.name);
      if (!datasetType) {
        notify(`Could not auto-detect Mule source type for ${file.name}. Upload that file from the specific source row instead.`, 'warning');
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await uploadOneFile(datasetType, file);
    }
  }, [notify, uploadOneFile]);

  const openInspector = useCallback(async (dataset) => {
    if (!dataset?.dataset_id) return;
    setInspectorDataset(dataset);
    setInspectorOpen(true);
    setInspectorLoading(true);
    try {
      const [previewRes, cachedProfileRes] = await Promise.all([
        mlopsApi.datasetRows(dataset.dataset_id, { sample_rows: 12 }),
        mlopsApi.getDatasetProfile(dataset.dataset_id).catch(() => null),
      ]);
      let profilePayload = toApiData(cachedProfileRes);
      if (!profilePayload || Object.keys(profilePayload || {}).length === 0) {
        const profileRes = await mlopsApi.profileMetadata({ dataset_id: dataset.dataset_id, sample_rows: 8000 });
        profilePayload = toApiData(profileRes);
      }
      setInspectorPreview(toApiData(previewRes));
      setInspectorProfile(profilePayload);
    } catch (error) {
      notify(error?.message || 'Could not load source details.', 'error');
      setInspectorPreview(null);
      setInspectorProfile(null);
    } finally {
      setInspectorLoading(false);
    }
  }, [notify]);

  const clearInspector = useCallback(() => {
    setInspectorOpen(false);
    setInspectorDataset(null);
    setInspectorPreview(null);
    setInspectorProfile(null);
  }, []);

  useEffect(() => {
    if (!desktopWorkspaceRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries?.[0]?.contentRect?.width || 0;
      setWorkspaceWidth(width);
    });
    observer.observe(desktopWorkspaceRef.current);
    return () => observer.disconnect();
  }, []);

  const maxInspectorWidth = useMemo(() => {
    if (!workspaceWidth) return DEFAULT_INSPECTOR_WIDTH;
    return Math.max(MIN_INSPECTOR_WIDTH, workspaceWidth - MIN_MAIN_PANEL_WIDTH);
  }, [workspaceWidth]);

  const effectiveInspectorWidth = useMemo(() => {
    if (inspectorWidth) {
      return Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxInspectorWidth, inspectorWidth));
    }
    if (!workspaceWidth) return DEFAULT_INSPECTOR_WIDTH;
    return Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxInspectorWidth, workspaceWidth / 2));
  }, [inspectorWidth, maxInspectorWidth, workspaceWidth]);

  const startInspectorResize = useCallback((event) => {
    event.preventDefault();
    resizingInspectorRef.current = true;
  }, []);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!resizingInspectorRef.current || !desktopWorkspaceRef.current) return;
      const bounds = desktopWorkspaceRef.current.getBoundingClientRect();
      const nextWidth = bounds.right - event.clientX;
      const clampedWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxInspectorWidth, nextWidth));
      setInspectorWidth(clampedWidth);
    };

    const stopResize = () => {
      resizingInspectorRef.current = false;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('mouseleave', stopResize);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('mouseleave', stopResize);
    };
  }, [maxInspectorWidth]);

  return (
    <>
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
          <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={2}>
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 14, color: '#556070' }}>
                Register Mule source tables for this run. You can import the full bundle in one step or upload individual files and inspect each source before moving into Master Dataset.
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <SourceStat label="Required Loaded" value={`${summary.required_loaded || 0}/${summary.required_total || REQUIRED_SOURCE_TYPES.size}`} helper="Accounts, customers, transactions" />
                <SourceStat label="Source Tables" value={formatNumber(summary.tables_loaded || 0)} helper="Persisted to this run" />
                <SourceStat label="Total Rows" value={formatNumber(summary.total_rows || 0)} helper="Across current Mule sources" />
                <SourceStat label="Anchor Grain" value="Account" helper="One account is the downstream key" />
              </Stack>
            </Stack>
            <Button
              variant="outlined"
              startIcon={loadingOverview ? <CircularProgress size={16} /> : <Refresh />}
              onClick={() => refreshOverview(true)}
              sx={{ textTransform: 'none', alignSelf: { xs: 'flex-start', xl: 'flex-start' }, borderRadius: SURFACE_RADIUS }}
            >
              Refresh
            </Button>
          </Stack>
        </Paper>

        <Box sx={{ px: 0.25, py: 0.5, borderBottom: '1px solid #E5E7EB' }}>
          <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={1.25} alignItems={{ xl: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#151B27' }}>
                Source Registration
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: '#556070', mt: 0.2 }}>
                Import the full Mule bundle in one operation, or upload individual source files below.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ minWidth: { xl: 620 } }}>
              <TextField
                fullWidth
                size="small"
                label="Bundle path"
                value={bundlePath}
                onChange={(event) => setBundlePath(event.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: SURFACE_RADIUS } }}
              />
              <Button variant="outlined" onClick={() => setBundlePath(DEFAULT_BUNDLE_PATH)} sx={{ textTransform: 'none', borderRadius: SURFACE_RADIUS, whiteSpace: 'nowrap' }}>
                Reset Path
              </Button>
              <Button
                variant="contained"
                startIcon={bundleImporting ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
                onClick={handleImportBundle}
                disabled={bundleImporting}
                sx={{ textTransform: 'none', bgcolor: '#D04A02', borderRadius: SURFACE_RADIUS, whiteSpace: 'nowrap' }}
              >
                Import Mule Bundle
              </Button>
            </Stack>
          </Stack>
        </Box>

        <Box
          ref={desktopWorkspaceRef}
          sx={{
            position: 'relative',
            minHeight: inspectorOpen && inspectorDataset ? { xl: 520 } : 'auto',
            display: { xs: 'block', xl: 'grid' },
            gridTemplateColumns: {
              xl: inspectorOpen && inspectorDataset
                ? `minmax(0, 1fr) ${effectiveInspectorWidth}px`
                : 'minmax(0, 1fr)',
            },
            gap: { xl: 2 },
            alignItems: { xl: 'stretch' },
            transition: 'grid-template-columns 220ms ease',
          }}
        >
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: SURFACE_RADIUS,
            minWidth: 0,
            height: '100%',
          }}
        >
            <Stack spacing={1.5}>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#151B27' }}>
                Manual Source Upload
              </Typography>
              <Typography sx={{ fontSize: 13, color: '#556070' }}>
                Upload individual Mule source files into this run, or bulk-pick files and let the workbench auto-detect source types.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<UploadFile />}
                onClick={() => {
                  if (bulkUploadInputRef.current) {
                    bulkUploadInputRef.current.value = '';
                    bulkUploadInputRef.current.click();
                  }
                }}
                sx={{ textTransform: 'none', alignSelf: 'flex-start', borderRadius: SURFACE_RADIUS }}
              >
                Upload Multiple Files
              </Button>
              <Stack spacing={1}>
                {MULE_SOURCE_LIBRARY.map((source) => {
                  const slot = sourceSlots.find((item) => item.type === source.type) || source;
                  const busy = Boolean(uploadingByType[source.type]);
                  const latest = slot.latest_dataset;
                  return (
                    <Paper
                      key={source.type}
                      variant="outlined"
                      sx={{ p: 1.1, borderRadius: SURFACE_RADIUS, borderColor: source.required && !slot.loaded ? '#F59E0B' : '#E5E7EB' }}
                    >
                      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#151B27' }}>
                              {source.label}
                            </Typography>
                            <Chip size="small" label={source.required ? 'Required' : 'Optional'} color={source.required ? 'warning' : 'default'} variant="outlined" sx={{ borderRadius: SURFACE_RADIUS }} />
                            <Chip size="small" label={slot.loaded ? 'Loaded' : 'Missing'} color={slot.loaded ? 'success' : 'default'} variant="outlined" sx={{ borderRadius: SURFACE_RADIUS }} />
                          </Stack>
                          <Typography sx={{ fontSize: 12.5, color: '#556070', mt: 0.45 }}>
                            {source.description}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: '#7A8699', mt: 0.55 }}>
                            {latest?.filename ? `${latest.filename} • ${formatNumber(latest.row_count)} rows` : 'No file uploaded for this source yet'}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {latest?.dataset_id ? (
                            <IconButton onClick={() => openInspector(latest)} sx={{ border: '1px solid #E5E7EB', borderRadius: SURFACE_RADIUS }}>
                              <Visibility fontSize="small" />
                            </IconButton>
                          ) : null}
                          <Button
                            variant={slot.loaded ? 'outlined' : 'contained'}
                            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <UploadFile />}
                            onClick={() => openSourceUpload(source.type)}
                            disabled={busy}
                            sx={{ textTransform: 'none', borderRadius: SURFACE_RADIUS, ...(slot.loaded ? {} : { bgcolor: '#D04A02' }) }}
                          >
                            {slot.loaded ? 'Replace' : 'Upload'}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </Stack>
        </Paper>
        <Box
          sx={{
            display: { xs: 'none', xl: 'block' },
            position: 'relative',
            minWidth: 0,
            height: '100%',
            pointerEvents: inspectorOpen && inspectorDataset ? 'auto' : 'none',
          }}
        >
          {inspectorOpen && inspectorDataset ? (
            <Box
              onMouseDown={startInspectorResize}
              sx={{
                position: 'absolute',
                left: -7,
                top: 0,
                width: 14,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 4,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 16,
                  bottom: 16,
                  left: 6,
                  width: 2,
                  borderRadius: 999,
                  bgcolor: '#D6DDE6',
                },
                '&:hover::before': {
                  bgcolor: '#D04A02',
                },
              }}
            />
          ) : null}
          <SourceInspectorPanel
            open={Boolean(inspectorOpen && inspectorDataset)}
            onClose={clearInspector}
            dataset={inspectorDataset}
            loading={inspectorLoading}
            preview={inspectorPreview}
            profile={inspectorProfile}
            width={effectiveInspectorWidth}
          />
        </Box>
        </Box>

        {missingRequired.length > 0 ? (
          <Alert severity="info" sx={{ borderRadius: SURFACE_RADIUS }}>
            Upload the required Mule sources first: <strong>{missingRequired.map((item) => item.label).join(', ')}</strong>.
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ lg: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#151B27' }}>
                Registered Source Tables
              </Typography>
              <Typography sx={{ fontSize: 13, color: '#556070', mt: 0.4 }}>
                Inspect persisted source tables, sample rows, and lightweight profiling before moving into Master Dataset.
              </Typography>
            </Box>
            <TextField
              size="small"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search source tables"
              sx={{ minWidth: { xs: '100%', md: 280 }, '& .MuiOutlinedInput-root': { borderRadius: SURFACE_RADIUS } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Stack>

          <TableContainer sx={{ mt: 1.75, border: '1px solid #E5E7EB', borderRadius: SURFACE_RADIUS }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>File</TableCell>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Rows</TableCell>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Columns</TableCell>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Quality</TableCell>
                  <TableCell sx={{ fontWeight: 800, bgcolor: '#F8F9FB' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSlots.map((slot) => {
                  const dataset = slot.latest_dataset;
                  const profile = slot.profile || {};
                  return (
                    <TableRow key={slot.type} hover>
                      <TableCell sx={{ minWidth: 180 }}>
                        <Stack spacing={0.4}>
                          <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#151B27' }}>{slot.label}</Typography>
                          <Typography sx={{ fontSize: 11.5, color: '#7A8699' }}>{slot.type}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#556070', maxWidth: 260 }}>{dataset?.filename || 'No file uploaded'}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#151B27' }}>{dataset ? formatNumber(dataset.row_count) : '0'}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#151B27' }}>{dataset ? formatNumber(dataset.columns?.length || profile?.total_columns || 0) : '0'}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#151B27' }}>{dataset ? formatQuality(profile?.quality_score) : 'N/A'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={slot.loaded ? 'Loaded' : (slot.required ? 'Required' : 'Optional')}
                          color={slot.loaded ? 'success' : (slot.required ? 'warning' : 'default')}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredSlots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ fontSize: 12.5, color: '#556070' }}>
                      No Mule source tables match the current search.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>

      <input ref={singleUploadInputRef} type="file" accept=".csv,.parquet" style={{ display: 'none' }} onChange={handleSingleFilePicked} />
      <input ref={bulkUploadInputRef} type="file" accept=".csv,.parquet" multiple style={{ display: 'none' }} onChange={handleBulkFilesPicked} />

      <Snackbar
        open={Boolean(toast.open && toast.message)}
        autoHideDuration={3600}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          setToast((prev) => ({ ...prev, open: false }));
        }}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mb: 2, mr: 2 }}
      >
        <Alert
          severity={toast.severity || 'info'}
          variant="filled"
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
          sx={{ borderRadius: SURFACE_RADIUS, alignItems: 'center' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>

      <Box sx={{ display: { xs: 'block', xl: 'none' } }}>
          <SourceInspectorPanel
            open={Boolean(inspectorOpen && inspectorDataset)}
            onClose={clearInspector}
            dataset={inspectorDataset}
            loading={inspectorLoading}
            preview={inspectorPreview}
            profile={inspectorProfile}
            width={effectiveInspectorWidth}
          />
        </Box>
    </>
  );
};

export default MuleDataUploadScreen;
