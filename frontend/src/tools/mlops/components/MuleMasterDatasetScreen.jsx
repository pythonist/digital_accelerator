import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { CloudDone, Preview, Refresh } from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';

const SURFACE_RADIUS = '6px';

const MODULE_META = [
  { key: 'accounts', title: 'Accounts', description: 'Anchor table. Every output row represents one account.', sourceTypes: ['accounts'], joinSummary: 'Anchor source. No aggregation applied.', featureKey: null },
  { key: 'customer_context', title: 'Customer Context', description: 'Attach customer identity, tenure, geography, and relationship context.', sourceTypes: ['customers'], joinSummary: 'Join customers to accounts by customer_id / party_id, then flatten to account grain.', featureKey: 'customer_context' },
  { key: 'transaction_behavior', title: 'Transaction Behavior', description: 'Aggregate transaction activity into account-level behavior measures.', sourceTypes: ['transactions'], joinSummary: 'Aggregate transactions to account_id before joining into the analytical base.', featureKey: 'transaction_behavior' },
  { key: 'external_signals', title: 'External Signals', description: 'Bring complaints, intelligence feeds, and external risk cues to account grain.', sourceTypes: ['external_signals'], joinSummary: 'Aggregate external observations to account_id and join once per account.', featureKey: 'external_signals' },
  { key: 'device_intelligence', title: 'Device Intelligence', description: 'Roll device, channel, and access behavior into account signals.', sourceTypes: ['device_logs'], joinSummary: 'Collapse device access logs to account_id with device count and shared-access summaries.', featureKey: 'device_intelligence' },
  { key: 'network_intelligence', title: 'Network Intelligence', description: 'Create account-level exposure signals from counterparties and graph relationships.', sourceTypes: ['counterparties', 'graph_nodes', 'graph_edges'], joinSummary: 'Aggregate graph and counterparty structures to account_id to avoid many-to-many joins.', featureKey: 'network_intelligence' },
  { key: 'analytical_base', title: 'Analytical Base', description: 'Persist the final account-level modeling dataset for downstream feature and model work.', sourceTypes: ['accounts', 'customers', 'transactions', 'external_signals', 'device_logs', 'counterparties', 'graph_nodes', 'graph_edges'], joinSummary: 'Single final row per account with deterministic source aggregation.', featureKey: null },
];

const DEFAULT_TOGGLES = {
  customer_context: ['profile', 'geography', 'tenure'],
  transaction_behavior: ['volume', 'velocity', 'mix'],
  external_signals: ['risk_score', 'complaint_flags'],
  device_intelligence: ['device_count', 'shared_access'],
  network_intelligence: ['counterparty_count', 'network_degree'],
};

const prettyLabel = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
const fmtPct = (value) => `${Number(value || 0).toFixed(0)}%`;
const fmtNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : '0';
};
const fmtMetric = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return Math.abs(numeric) >= 1000 ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 }) : numeric.toFixed(2);
};
const parseApiError = (error, fallback) => (
  error?.response?.data?.error
  || error?.response?.data?.message
  || error?.message
  || fallback
);

const displayAssemblyMetric = (value, hasPreview) => {
  if (!hasPreview && (!Number.isFinite(Number(value)) || Number(value) === 0)) return '—';
  return fmtNumber(value || 0);
};

const displayCoverage = (value, hasPreview) => {
  if (!hasPreview && (!Number.isFinite(Number(value)) || Number(value) === 0)) return '—';
  return fmtPct(value || 0);
};

const SourcePill = ({ label }) => (
  <Chip size="small" variant="outlined" label={label} sx={{ borderRadius: SURFACE_RADIUS, fontWeight: 600, bgcolor: '#fff' }} />
);

const SummaryStat = ({ label, value }) => (
  <Box sx={{ minWidth: 128 }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#111827', mt: 0.2 }}>{value}</Typography>
  </Box>
);

const InsightTable = ({ columns = [], rows = [] }) => (
  <TableContainer sx={{ border: '1px solid #D7DCE3', borderRadius: SURFACE_RADIUS, maxHeight: 360 }}>
    <Table size="small" stickyHeader>
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableCell key={column.key} sx={{ fontWeight: 700, bgcolor: '#F7F9FC', borderBottom: '1px solid #D7DCE3', whiteSpace: 'nowrap' }}>
              {column.label}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <TableRow key={`row_${rowIndex}`} hover>
            {columns.map((column) => (
              <TableCell key={`${rowIndex}_${column.key}`} sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '')}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);

const sourceRows = (datasetMap, type) => Number(datasetMap?.[type]?.row_count || 0) || 0;

const buildMasterLogicRows = (datasetMap, summary, hasBuiltMaster) => {
  const finalRows = Number(summary?.estimated_final_rows || summary?.base_rows || 0) || 0;
  const finalCols = Number(summary?.estimated_column_count || 0) || 0;
  return [
    {
      stage: 'Accounts Anchor',
      input_rows: sourceRows(datasetMap, 'accounts'),
      operation: 'Keep one row per account_id as the scoring grain.',
      output_effect: finalRows ? `${fmtNumber(finalRows)} account rows carried forward as the analytical base.` : 'Account rows define the final scoring grain.',
      reason: 'Mule detection is scored at account level, not transaction level.',
    },
    {
      stage: 'Customer Context',
      input_rows: sourceRows(datasetMap, 'customers'),
      operation: 'Join customer identity and tenure fields onto each account, then flatten back to account grain.',
      output_effect: 'No row growth allowed. Customer fields are attached to the existing account rows.',
      reason: 'We enrich each account with customer context without creating many-to-many joins.',
    },
    {
      stage: 'Transaction Behavior',
      input_rows: sourceRows(datasetMap, 'transactions'),
      operation: 'Aggregate raw transactions by account_id into counts, velocity, amount, and mix measures.',
      output_effect: 'Large transaction volumes collapse into one summarized record per account.',
      reason: 'The model learns from behavioral summaries, not from every raw transaction row.',
    },
    {
      stage: 'External Signals',
      input_rows: sourceRows(datasetMap, 'external_signals'),
      operation: 'Aggregate external alerts, complaints, and intelligence to account_id.',
      output_effect: 'External risk cues are attached once per account.',
      reason: 'External observations support the score but should not multiply account rows.',
    },
    {
      stage: 'Device Intelligence',
      input_rows: sourceRows(datasetMap, 'device_logs'),
      operation: 'Aggregate devices, channels, and shared-access patterns to account_id.',
      output_effect: 'Device activity is converted into account-level device risk features.',
      reason: 'Device evidence needs to be summarized into reusable account features.',
    },
    {
      stage: 'Network Intelligence',
      input_rows: sourceRows(datasetMap, 'counterparties') + sourceRows(datasetMap, 'graph_nodes') + sourceRows(datasetMap, 'graph_edges'),
      operation: 'Aggregate counterparty exposure and graph structure into account-level network signals.',
      output_effect: 'Relationship data becomes account-level network summaries instead of raw edge joins.',
      reason: 'This avoids row explosion while preserving ring and exposure patterns.',
    },
    {
      stage: 'Final Analytical Base',
      input_rows: finalRows,
      operation: 'Persist one final row per account with deterministic joins and aggregated signals.',
      output_effect: finalRows && finalCols ? `${fmtNumber(finalRows)} rows x ${fmtNumber(finalCols)} columns${hasBuiltMaster ? ' built for downstream Feature Store and Model Build.' : ' estimated after assembly.'}` : 'One scored row per account for downstream feature and model work.',
      reason: 'The model trains on scored entities, with each row representing the full summarized evidence for one account.',
    },
  ];
};

const ModuleTable = ({ modules, selectedModuleKey, onSelect }) => (
  <TableContainer sx={{ border: '1px solid #D7DCE3', borderRadius: SURFACE_RADIUS }}>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Module</TableCell>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Sources</TableCell>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Assembly Logic</TableCell>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Generated Columns</TableCell>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Row Coverage</TableCell>
          <TableCell sx={{ fontWeight: 700, bgcolor: '#F7F9FC' }}>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {modules.map((module) => {
          const selected = module.key === selectedModuleKey;
          return (
            <TableRow
              key={module.key}
              hover
              selected={selected}
              onClick={() => onSelect(module.key)}
              sx={{ cursor: 'pointer', '& .MuiTableCell-root': { borderBottom: '1px solid #E5E7EB' } }}
            >
              <TableCell sx={{ minWidth: 180 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{module.title}</Typography>
                <Typography sx={{ fontSize: 12, color: '#667085', mt: 0.35 }}>{module.description}</Typography>
              </TableCell>
              <TableCell sx={{ minWidth: 170 }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {(module.sources || []).map((source) => <SourcePill key={`${module.key}_${source}`} label={source} />)}
                </Stack>
              </TableCell>
              <TableCell sx={{ minWidth: 220, fontSize: 12.5, color: '#475467' }}>{module.joinSummary}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{displayAssemblyMetric(module.feature_count, module.hasPreview)}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{displayCoverage(module.coverage_pct, module.hasPreview)}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={module.status || 'Not configured'}
                  color={String(module.status || '').toLowerCase() === 'ready' ? 'success' : 'default'}
                  sx={{ borderRadius: SURFACE_RADIUS, fontWeight: 600 }}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </TableContainer>
);

const MuleMasterDatasetScreen = ({ activePipelineId, datasets = [], onDatasetsRefresh, onBuildComplete }) => {
  const pipelineId = Number(activePipelineId || 0);
  const [configState, setConfigState] = useState(null);
  const [statusState, setStatusState] = useState(null);
  const [previewState, setPreviewState] = useState(null);
  const [selectedModuleKey, setSelectedModuleKey] = useState('accounts');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, severity: 'info', message: '' });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pipelineError, setPipelineError] = useState('');
  const [backendDatasets, setBackendDatasets] = useState([]);

  const showToast = useCallback((message, severity = 'info') => {
    setToast({ open: Boolean(message), severity, message: String(message || '') });
  }, []);

  const closeToast = useCallback(() => {
    setToast((prev) => ({ ...prev, open: false }));
  }, []);

  const refreshBackendDatasets = useCallback(async ({ sync = false } = {}) => {
    if (!pipelineId || typeof onDatasetsRefresh !== 'function') {
      setBackendDatasets([]);
      return [];
    }
    const parsed = await onDatasetsRefresh({ sync, pipelineId });
    const rows = Array.isArray(parsed?.rawOnly) ? parsed.rawOnly : [];
    setBackendDatasets(rows);
    return rows;
  }, [onDatasetsRefresh, pipelineId]);

  const loadStatus = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const pipelineRes = await mlopsApi.pipelineGet(pipelineId);
      const pipeline = pipelineRes?.data || pipelineRes || null;
      const resolvedType = String(pipeline?.pipeline_type || pipeline?.model_family || 'fcc').trim().toLowerCase();
      if (!pipeline?.pipeline_id) {
        throw new Error('This Mule run is not available in backend persistence anymore. Reopen a saved Mule run from Pipeline Hub or create a new one.');
      }
      if (resolvedType !== 'mule') {
        throw new Error(`Pipeline ${pipelineId} is saved as "${resolvedType || 'fcc'}", not "mule". Open the correct Mule run before continuing.`);
      }
      let scopedDatasets = await refreshBackendDatasets({ sync: false });
      if (!(Array.isArray(scopedDatasets) && scopedDatasets.length > 0)) {
        scopedDatasets = await refreshBackendDatasets({ sync: true });
      }
      const [configRes, statusRes] = await Promise.all([
        mlopsApi.muleMasterDatasetConfig(pipelineId),
        mlopsApi.muleMasterDatasetStatus(pipelineId),
      ]);
      setPipelineError('');
      setConfigState((configRes?.data || configRes || {}).config || null);
      setStatusState(statusRes?.data || statusRes || null);
      setBackendDatasets(Array.isArray(scopedDatasets) ? scopedDatasets : []);
    } catch (error) {
      setPipelineError(parseApiError(error, 'Could not load Mule master dataset configuration.'));
      setConfigState(null);
      setStatusState(null);
      setPreviewState(null);
      setPreviewOpen(false);
      setBackendDatasets([]);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, refreshBackendDatasets]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const backendSourceInventory = useMemo(
    () => (Array.isArray(statusState?.source_inventory) ? statusState.source_inventory : []),
    [statusState],
  );

  const visibleDatasets = useMemo(() => {
    if (backendSourceInventory.length > 0) return backendSourceInventory;
    if (Array.isArray(backendDatasets) && backendDatasets.length > 0) return backendDatasets;
    return [];
  }, [backendDatasets, backendSourceInventory]);

  const datasetMap = useMemo(() => {
    const map = {};
    visibleDatasets.forEach((dataset) => {
      const key = String(dataset?.dataset_type || '').trim().toLowerCase();
      if (!key || map[key]) return;
      map[key] = {
        dataset_type: key,
        filename: dataset?.filename || key,
        row_count: Number(dataset?.row_count || 0) || 0,
        column_count: Number(dataset?.column_count || dataset?.columns?.length || 0) || 0,
        columns: Array.isArray(dataset?.columns) ? dataset.columns : [],
      };
    });
    return map;
  }, [visibleDatasets]);

  const outputName = configState?.output_table_name || `mule_abt_${pipelineId || 'draft'}`;
  const summary = previewState?.summary || statusState?.preview_summary || {};
  const insights = previewState?.insights || summary?.insights || {};
  const overview = insights?.overview || {};
  const sourceCount = Math.max(Number(statusState?.sources_loaded || 0) || 0, visibleDatasets.length);
  const backendMasterBuilt = String(statusState?.build_status || '').trim().toLowerCase() === 'built';
  const hasAccountsSource = Boolean(
    statusState?.has_accounts_source
    || statusState?.has_accounts_frame
    || datasetMap.accounts
    || visibleDatasets.some((dataset) => String(dataset?.dataset_type || '').trim().toLowerCase() === 'accounts')
  );
  const canvasBlocked = Boolean(pipelineError);
  const previewBlocked = canvasBlocked || (!hasAccountsSource && !backendMasterBuilt);
  const buildBlocked = canvasBlocked || !hasAccountsSource;

  const isModuleEnabled = useCallback((moduleKey) => {
    const selected = configState?.selected_sources || {};
    if (moduleKey === 'accounts' || moduleKey === 'analytical_base') return true;
    if (moduleKey === 'customer_context') return selected.customers !== false;
    if (moduleKey === 'transaction_behavior') return selected.transactions !== false;
    if (moduleKey === 'external_signals') return selected.external_signals !== false;
    if (moduleKey === 'device_intelligence') return selected.device_logs !== false;
    if (moduleKey === 'network_intelligence') return (selected.counterparties !== false) || (selected.graph !== false);
    return true;
  }, [configState]);

  const modules = useMemo(() => {
    const cards = Array.isArray(previewState?.cards) ? previewState.cards : [];
    const hasPreview = cards.length > 0;
    return MODULE_META.map((meta) => {
      const previewCard = cards.find((card) => card.key === meta.key);
      const sourceEntries = meta.sourceTypes.map((sourceType) => datasetMap[sourceType]).filter(Boolean);
      const featureConfig = configState?.feature_config?.[meta.featureKey] || {};
      const generatedColumns = previewCard?.generated_columns || [];
      return {
        ...meta,
        ...previewCard,
        sources: sourceEntries.length > 0
          ? sourceEntries.map((entry) => entry.filename || entry.dataset_type)
          : meta.sourceTypes,
        feature_count: Number(previewCard?.feature_count || generatedColumns.length || 0) || 0,
        coverage_pct: Number(previewCard?.coverage_pct || 0) || 0,
        status: previewCard?.status || (sourceEntries.length > 0 && isModuleEnabled(meta.key) ? 'Ready' : 'Not configured'),
        generated_columns: generatedColumns,
        hasPreview,
        enabled: isModuleEnabled(meta.key),
        aggregation_windows: Array.isArray(featureConfig.aggregation_windows) ? featureConfig.aggregation_windows : [],
        feature_toggles: Array.isArray(featureConfig.feature_toggles) ? featureConfig.feature_toggles : (DEFAULT_TOGGLES[meta.featureKey] || []),
      };
    });
  }, [configState, datasetMap, isModuleEnabled, previewState]);

  const selectedModule = useMemo(
    () => modules.find((module) => module.key === selectedModuleKey) || modules[0] || null,
    [modules, selectedModuleKey],
  );
  const masterLogicRows = useMemo(
    () => buildMasterLogicRows(datasetMap, summary, String(statusState?.build_status || '').trim().toLowerCase() === 'built'),
    [datasetMap, statusState?.build_status, summary],
  );

  const previewColumns = Array.isArray(previewState?.preview_columns)
    ? previewState.preview_columns
    : Array.isArray(insights?.column_catalog)
      ? insights.column_catalog.map((item) => item.column)
      : Array.isArray(previewState?.sample_rows) && previewState.sample_rows.length > 0
        ? Object.keys(previewState.sample_rows[0] || {})
        : [];
  const previewRows = Array.isArray(previewState?.sample_rows) ? previewState.sample_rows : [];

  useEffect(() => {
    if ((hasAccountsSource || backendMasterBuilt) && /accounts\.csv|no mule source tables|upload the mule source bundle/i.test(String(toast.message || ''))) {
      setToast((prev) => ({ ...prev, open: false, message: '' }));
    }
  }, [backendMasterBuilt, hasAccountsSource, toast.message]);

  const ensureCurrentSources = useCallback(async () => {
    if (hasAccountsSource) {
      return {
        datasets: visibleDatasets,
        hasAccounts: true,
      };
    }
    const refreshed = await refreshBackendDatasets({ sync: true });
    const available = Array.isArray(refreshed) && refreshed.length > 0 ? refreshed : visibleDatasets;
    const availableTypes = new Set(
      available.map((dataset) => String(dataset?.dataset_type || '').trim().toLowerCase()).filter(Boolean),
    );
    if (availableTypes.has('accounts')) {
      return {
        datasets: available,
        hasAccounts: true,
      };
    }
    try {
      const statusRes = await mlopsApi.muleMasterDatasetStatus(pipelineId);
      const liveStatus = statusRes?.data || statusRes || {};
      const liveInventory = Array.isArray(liveStatus?.source_inventory) ? liveStatus.source_inventory : [];
      const liveHasAccounts = Boolean(
        liveStatus?.has_accounts_source
        || liveInventory.some((dataset) => String(dataset?.dataset_type || '').trim().toLowerCase() === 'accounts'),
      );
      if (liveHasAccounts) {
        setStatusState(liveStatus);
        setBackendDatasets(liveInventory);
      } else if (String(liveStatus?.build_status || '').trim().toLowerCase() === 'built') {
        setStatusState(liveStatus);
      }
      return {
        datasets: liveInventory.length > 0 ? liveInventory : available,
        hasAccounts: liveHasAccounts,
        hasBuiltMaster: String(liveStatus?.build_status || '').trim().toLowerCase() === 'built',
      };
    } catch {
      // Fall back to the refreshed dataset view if status reload fails.
    }
    return {
      datasets: available,
      hasAccounts: availableTypes.has('accounts'),
      hasBuiltMaster: backendMasterBuilt,
    };
  }, [backendMasterBuilt, hasAccountsSource, pipelineId, refreshBackendDatasets, visibleDatasets]);

  const openPersistedMasterPreview = useCallback(async (statusPayload = null) => {
    const liveStatus = statusPayload || statusState || {};
    const sourceInventory = Array.isArray(liveStatus?.source_inventory) ? liveStatus.source_inventory : [];
    let masterDataset = sourceInventory.find((dataset) => String(dataset?.dataset_type || '').trim().toLowerCase() === 'master_dataset');
    if (!masterDataset?.dataset_id) {
      const datasetsRes = await mlopsApi.listDatasets({ pipeline_id: pipelineId, pipeline_type: 'mule' });
      const artefacts = Array.isArray(datasetsRes?.artefacts)
        ? datasetsRes.artefacts
        : Array.isArray(datasetsRes?.data)
          ? datasetsRes.data
          : [];
      masterDataset = artefacts.find((dataset) => String(dataset?.dataset_type || '').trim().toLowerCase() === 'master_dataset');
    }
    if (!masterDataset?.dataset_id) {
      throw new Error('No persisted master dataset artifact is attached to this Mule run yet.');
    }

    const rowsRes = await mlopsApi.datasetRows(masterDataset.dataset_id, { sample_rows: 12 });
    const rowsPayload = rowsRes?.data || rowsRes || {};
    const previewRows = Array.isArray(rowsPayload?.preview) ? rowsPayload.preview : [];
    const previewColumns = Array.isArray(rowsPayload?.columns)
      ? rowsPayload.columns
      : (Array.isArray(masterDataset?.columns) ? masterDataset.columns : Object.keys(previewRows[0] || {}));
    const persistedSummary = liveStatus?.latest_build?.summary || liveStatus?.preview_summary || {};

    setStatusState(liveStatus);
    setPreviewState({
      pipeline_id: pipelineId,
      config: liveStatus?.config || configState || null,
      cards: [],
      summary: {
        ...persistedSummary,
        base_rows: Number(persistedSummary?.base_rows || liveStatus?.latest_build?.row_count || masterDataset?.row_count || previewRows.length || 0),
        estimated_final_rows: Number(persistedSummary?.estimated_final_rows || liveStatus?.latest_build?.row_count || masterDataset?.row_count || previewRows.length || 0),
        estimated_column_count: Number(persistedSummary?.estimated_column_count || liveStatus?.latest_build?.column_count || masterDataset?.column_count || previewColumns.length || 0),
        final_dataset_estimate: persistedSummary?.final_dataset_estimate
          || `${fmtNumber(liveStatus?.latest_build?.row_count || masterDataset?.row_count || previewRows.length || 0)} rows x ${fmtNumber(liveStatus?.latest_build?.column_count || masterDataset?.column_count || previewColumns.length || 0)} columns`,
        preview_mode: 'persisted_master_dataset',
      },
      sample_rows: previewRows,
      preview_columns: previewColumns,
      insights: persistedSummary?.insights || {
        overview: {
          row_count: Number(liveStatus?.latest_build?.row_count || masterDataset?.row_count || previewRows.length || 0),
          column_count: Number(liveStatus?.latest_build?.column_count || masterDataset?.column_count || previewColumns.length || 0),
        },
        column_catalog: previewColumns.map((column) => ({
          column,
          source_group: 'analytical_base',
          dtype: '',
          family: 'unknown',
          null_pct: 0,
          unique_count: null,
        })),
        categorical_highlights: [],
        numeric_highlights: [],
      },
    });
    setPreviewOpen(true);
    showToast('Preview loaded from the persisted master dataset for this run.', 'success');
  }, [configState, pipelineId, showToast, statusState]);

  const handlePreview = useCallback(async () => {
    if (!pipelineId || canvasBlocked) return;
    setLoading(true);
    try {
      const sourceState = await ensureCurrentSources();
      if (!sourceState.hasAccounts && !sourceState.hasBuiltMaster) {
        showToast('Upload accounts.csv into this saved Mule run before previewing the analytical assembly.', 'warning');
        await loadStatus();
        return;
      }
      if (!sourceState.hasAccounts && sourceState.hasBuiltMaster) {
        const statusRes = await mlopsApi.muleMasterDatasetStatus(pipelineId);
        await openPersistedMasterPreview(statusRes?.data || statusRes || {});
        return;
      }
      const res = await mlopsApi.muleMasterDatasetPreview(pipelineId);
      setPreviewState(res?.data || res || {});
      setPreviewOpen(true);
      showToast(
        sourceState.hasAccounts
          ? 'Analytical preview refreshed from backend.'
          : 'Preview loaded from the persisted master dataset because raw source files are not currently attached to this run.',
        'success',
      );
    } catch (error) {
      try {
        const fallbackStatusRes = await mlopsApi.muleMasterDatasetStatus(pipelineId);
        const fallbackStatus = fallbackStatusRes?.data || fallbackStatusRes || {};
        if (String(fallbackStatus?.build_status || '').trim().toLowerCase() !== 'built') {
          throw error;
        }
        await openPersistedMasterPreview(fallbackStatus);
      } catch (fallbackError) {
        showToast(parseApiError(fallbackError, parseApiError(error, 'Preview failed.')), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [canvasBlocked, ensureCurrentSources, loadStatus, openPersistedMasterPreview, pipelineId, showToast]);

  const handleBuild = useCallback(async () => {
    if (!pipelineId || canvasBlocked) return;
    setLoading(true);
    try {
      const sourceState = await ensureCurrentSources();
      if (!sourceState.hasAccounts) {
        showToast('Please upload the Mule source bundle into this saved run before building the analytical base.', 'warning');
        await loadStatus();
        return;
      }
      const res = await mlopsApi.muleMasterDatasetBuild(pipelineId, { output_table_name: outputName });
      const payload = res?.data || res || {};
      setPreviewState((prev) => ({ ...(prev || {}), summary: payload.summary, sample_rows: payload.sample_rows }));
      showToast(`Analytical base built as ${payload.output_table_name || outputName}.`, 'success');
      await loadStatus();
      await onDatasetsRefresh?.({ sync: true, pipelineId });
      onBuildComplete?.({
        dataset_id: Number(payload?.summary?.dataset_id || 0) || null,
        dataset_type: 'master_dataset',
        row_count: Number(payload?.row_count || payload?.summary?.estimated_final_rows || 0) || 0,
        column_count: Number(payload?.column_count || payload?.summary?.estimated_column_count || 0) || 0,
        filename: `${payload.output_table_name || outputName}.csv`,
        file_path: payload?.summary?.output_file_path || '',
      });
    } catch (error) {
      showToast(parseApiError(error, 'Build failed.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [canvasBlocked, ensureCurrentSources, loadStatus, onBuildComplete, onDatasetsRefresh, outputName, pipelineId, showToast]);

  const handleModuleToggle = useCallback(async (module, enabled) => {
    if (!pipelineId || !module?.featureKey || canvasBlocked) return;
    const patch = {
      selected_sources: {
        ...(module.key === 'network_intelligence'
          ? { graph: enabled, counterparties: enabled }
          : module.key === 'customer_context'
            ? { customers: enabled }
            : module.key === 'transaction_behavior'
              ? { transactions: enabled }
              : module.key === 'external_signals'
                ? { external_signals: enabled }
                : { device_logs: enabled }),
      },
      feature_config: {
        [module.key]: {
          enabled,
          aggregation_windows: module.aggregation_windows || [],
          feature_toggles: module.feature_toggles || [],
        },
      },
      output_table_name: outputName,
    };
    setLoading(true);
    try {
      const res = await mlopsApi.muleMasterDatasetConfig(pipelineId, patch);
      setConfigState((res?.data || res || {}).config || null);
      showToast(`${module.title} ${enabled ? 'enabled' : 'disabled'} for this run.`, 'success');
      await loadStatus();
    } catch (error) {
      showToast(parseApiError(error, 'Could not update module selection.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [canvasBlocked, loadStatus, outputName, pipelineId, showToast]);

  return (
    <Stack spacing={2}>
      {pipelineError ? (
        <Alert severity="error" sx={{ borderRadius: SURFACE_RADIUS }}>
          {pipelineError}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
        <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={2}>
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 14, color: '#475467' }}>
              Assemble the Mule analytical base by reviewing source modules, validating account-grain joins, and then persisting the final account-level dataset.
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <SummaryStat label="Sources" value={fmtNumber(sourceCount)} />
              <SummaryStat label="Estimated Rows" value={fmtNumber(summary.estimated_final_rows || statusState?.row_count_estimate || 0)} />
              <SummaryStat label="Estimated Columns" value={fmtNumber(summary.estimated_column_count || statusState?.column_count_estimate || 0)} />
              <SummaryStat label="Build Status" value={prettyLabel(statusState?.build_status || 'draft')} />
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap">
            <Button variant="outlined" startIcon={<Refresh />} onClick={() => loadStatus()} disabled={!pipelineId || loading} sx={{ textTransform: 'none', borderRadius: SURFACE_RADIUS }}>
              Refresh
            </Button>
            <Button variant="outlined" startIcon={<Preview />} onClick={handlePreview} disabled={!pipelineId || loading || previewBlocked} sx={{ textTransform: 'none', borderRadius: SURFACE_RADIUS }}>
              Preview Sample & Insights
            </Button>
            <Button variant="contained" startIcon={<CloudDone />} onClick={handleBuild} disabled={!pipelineId || loading || buildBlocked} sx={{ textTransform: 'none', bgcolor: '#D04A02', borderRadius: SURFACE_RADIUS }}>
              {backendMasterBuilt && !hasAccountsSource ? 'Rebuild Needs Raw Sources' : 'Build Dataset'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.65fr) minmax(320px,0.9fr)' }, gap: 2 }}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ borderRadius: SURFACE_RADIUS }}>
            <Box sx={{ p: 1.5, borderBottom: '1px solid #E5E7EB', bgcolor: '#F7F9FC' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Master Dataset Logic</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.4 }}>
                This explains how the raw Mule sources are reduced to one scored row per <strong>account_id</strong>. High-volume tables are not discarded; they are aggregated into account-level features before model training.
              </Typography>
            </Box>
            <InsightTable
              columns={[
                { key: 'stage', label: 'Stage' },
                { key: 'input_rows', label: 'Input Rows', render: (value) => fmtNumber(value) },
                { key: 'operation', label: 'Transformation Logic' },
                { key: 'output_effect', label: 'What Happens to the Data' },
                { key: 'reason', label: 'Why It Is Done This Way' },
              ]}
              rows={masterLogicRows}
            />
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: SURFACE_RADIUS }}>
            <Box sx={{ p: 1.5, borderBottom: '1px solid #E5E7EB', bgcolor: '#F7F9FC' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Assembly Modules</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.4 }}>
                Accounts is the fixed anchor. Every other source is aggregated to <strong>account_id</strong> before joining into the analytical base.
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#667085', mt: 0.6 }}>
                Generated columns = columns this module contributes after preview/build. Row coverage = share of accounts receiving at least one non-null value from that module.
              </Typography>
            </Box>
            <ModuleTable modules={modules} selectedModuleKey={selectedModuleKey} onSelect={setSelectedModuleKey} />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
            <Stack spacing={1.5}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Registered Source Tables</Typography>
              <InsightTable
                columns={[
                  { key: 'dataset_type', label: 'Source', render: (value) => prettyLabel(value) },
                  { key: 'filename', label: 'File' },
                  { key: 'row_count', label: 'Rows', render: (value) => fmtNumber(value) },
                  { key: 'column_count', label: 'Columns', render: (value) => fmtNumber(value) },
                ]}
                rows={visibleDatasets}
              />
            </Stack>
          </Paper>
        </Stack>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
            <Stack spacing={1.25}>
              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                <Box>
                  <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{selectedModule?.title || 'Module Details'}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.35 }}>
                    {selectedModule?.description || 'Select a module to inspect its source coverage and assembly settings.'}
                  </Typography>
                </Box>
                {selectedModule?.featureKey ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: 12, color: '#667085' }}>Include</Typography>
                    <Switch checked={Boolean(selectedModule?.enabled)} onChange={(event) => handleModuleToggle(selectedModule, event.target.checked)} disabled={loading || canvasBlocked} />
                  </Stack>
                ) : null}
              </Stack>
              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Status: ${selectedModule?.status || 'Not configured'}`} size="small" sx={{ borderRadius: SURFACE_RADIUS }} />
                <Chip label={`Coverage: ${fmtPct(selectedModule?.coverage_pct || 0)}`} size="small" sx={{ borderRadius: SURFACE_RADIUS }} />
                <Chip label={`Generated Columns: ${fmtNumber(selectedModule?.feature_count || 0)}`} size="small" sx={{ borderRadius: SURFACE_RADIUS }} />
              </Stack>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4 }}>Source Tables</Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  {(selectedModule?.sources || []).map((source) => <SourcePill key={`${selectedModule?.key}_${source}`} label={source} />)}
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4 }}>Join Strategy</Typography>
                <Typography sx={{ fontSize: 12.5, color: '#475467', mt: 0.5 }}>{selectedModule?.joinSummary}</Typography>
              </Box>
              {selectedModule?.featureKey ? (
                <>
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4 }}>Aggregation Windows</Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                      {(selectedModule?.aggregation_windows || []).length > 0
                        ? selectedModule.aggregation_windows.map((windowValue) => <SourcePill key={`${selectedModule.key}_${windowValue}`} label={`${windowValue}d`} />)
                        : <Chip size="small" label="Backend default" sx={{ borderRadius: SURFACE_RADIUS }} />}
                    </Stack>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4 }}>Feature Families</Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                      {(selectedModule?.feature_toggles || []).map((toggle) => <SourcePill key={`${selectedModule.key}_${toggle}`} label={prettyLabel(toggle)} />)}
                    </Stack>
                  </Box>
                </>
              ) : null}
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4 }}>Generated Columns Preview</Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  {(selectedModule?.generated_columns || []).slice(0, 14).map((column) => <SourcePill key={`${selectedModule?.key}_${column}`} label={column} />)}
                  {(!selectedModule?.generated_columns || selectedModule.generated_columns.length === 0) ? <Chip size="small" label="Run preview or build to inspect generated columns" sx={{ borderRadius: SURFACE_RADIUS }} /> : null}
                </Stack>
              </Box>
              {(selectedModule?.warnings || []).length > 0 ? (
                <Stack spacing={0.75}>
                  {(selectedModule.warnings || []).map((warning) => (
                    <Alert key={warning} severity="warning" sx={{ borderRadius: SURFACE_RADIUS }}>
                      {warning}
                    </Alert>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
            <Stack spacing={1.5}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Build Settings</Typography>
              <TextField
                label="Output dataset name"
                size="small"
                value={outputName}
                disabled={canvasBlocked}
                onChange={(event) => setConfigState((prev) => ({ ...(prev || {}), output_table_name: event.target.value }))}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: SURFACE_RADIUS } }}
              />
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Estimated rows: <strong>{fmtNumber(summary.estimated_final_rows || statusState?.row_count_estimate || 0)}</strong></Typography>
                <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Estimated columns: <strong>{fmtNumber(summary.estimated_column_count || statusState?.column_count_estimate || 0)}</strong></Typography>
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
                Review the source modules, run preview to inspect the assembled sample, then build the analytical base table for Feature Store and downstream model work.
              </Typography>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: SURFACE_RADIUS }}>
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Run Summary</Typography>
              <Divider />
              <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Base rows: <strong>{fmtNumber(summary.base_rows || 0)}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Feature groups active: <strong>{fmtNumber(summary.feature_group_count || 0)}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Data quality status: <strong>{prettyLabel(summary.data_quality_status || statusState?.build_status || 'draft')}</strong></Typography>
              <Typography sx={{ fontSize: 12.5, color: '#475467' }}>Labels attached: <strong>{summary.label_readiness ? 'Yes' : 'No'}</strong></Typography>
              <Divider />
              {(summary.warnings || statusState?.warnings || []).length > 0 ? (
                <Stack spacing={0.75}>
                  {(summary.warnings || statusState?.warnings || []).map((warning) => <Alert key={warning} severity="warning" sx={{ borderRadius: SURFACE_RADIUS }}>{warning}</Alert>)}
                </Stack>
              ) : (
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>No backend warnings for the current assembly plan.</Typography>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Box>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="xl" fullWidth>
        <DialogTitle>Sample Preview & Dataset Insights</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <SummaryStat label="Rows" value={fmtNumber(overview.row_count || summary.estimated_final_rows || 0)} />
              <SummaryStat label="Columns" value={fmtNumber(overview.column_count || summary.estimated_column_count || 0)} />
              <SummaryStat label="Feature Groups" value={fmtNumber(summary.feature_group_count || 0)} />
              <SummaryStat label="Sources Loaded" value={fmtNumber(sourceCount)} />
            </Stack>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: SURFACE_RADIUS }}>
              <Stack spacing={1.25}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Sample Rows</Typography>
                {previewRows.length > 0 ? (
                  <InsightTable columns={previewColumns.slice(0, 18).map((column) => ({ key: column, label: column }))} rows={previewRows.slice(0, 12)} />
                ) : (
                  <Typography sx={{ fontSize: 12.5, color: '#667085' }}>No preview rows yet. Run preview after reviewing the assembly plan.</Typography>
                )}
              </Stack>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 2 }}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: SURFACE_RADIUS }}>
                <Stack spacing={1}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Categorical Variable Insights</Typography>
                  <InsightTable
                    columns={[
                      { key: 'column', label: 'Column' },
                      { key: 'source_group', label: 'Source Group', render: (value) => prettyLabel(value) },
                      { key: 'dtype', label: 'Data Type' },
                      { key: 'distinct_count', label: 'Distinct' },
                      { key: 'null_pct', label: 'Missing %', render: (value) => `${fmtMetric(value)}%` },
                    ]}
                    rows={insights?.categorical_highlights || []}
                  />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: SURFACE_RADIUS }}>
                <Stack spacing={1}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Numerical Variable Insights</Typography>
                  <InsightTable
                    columns={[
                      { key: 'column', label: 'Column' },
                      { key: 'source_group', label: 'Source Group', render: (value) => prettyLabel(value) },
                      { key: 'mean', label: 'Mean', render: (value) => fmtMetric(value) },
                      { key: 'median', label: 'Median', render: (value) => fmtMetric(value) },
                      { key: 'min', label: 'Min', render: (value) => fmtMetric(value) },
                      { key: 'max', label: 'Max', render: (value) => fmtMetric(value) },
                      { key: 'null_pct', label: 'Missing %', render: (value) => `${fmtMetric(value)}%` },
                    ]}
                    rows={insights?.numeric_highlights || []}
                  />
                </Stack>
              </Paper>
            </Box>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: SURFACE_RADIUS }}>
              <Stack spacing={1}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Column Catalog</Typography>
                <InsightTable
                  columns={[
                    { key: 'column', label: 'Column' },
                    { key: 'source_group', label: 'Source Group', render: (value) => prettyLabel(value) },
                    { key: 'family', label: 'Column Family', render: (value) => prettyLabel(value) },
                    { key: 'dtype', label: 'Data Type' },
                    { key: 'unique_count', label: 'Unique Values' },
                    { key: 'null_pct', label: 'Missing %', render: (value) => `${fmtMetric(value)}%` },
                  ]}
                  rows={insights?.column_catalog || []}
                />
              </Stack>
            </Paper>
          </Stack>
        </DialogContent>
      </Dialog>

      <Snackbar open={Boolean(toast.open && toast.message)} autoHideDuration={4200} onClose={(_, reason) => { if (reason === 'clickaway') return; closeToast(); }} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} sx={{ mb: 2, mr: 2 }}>
        <Alert severity={toast.severity || 'info'} variant="filled" onClose={closeToast} sx={{ minWidth: 320, maxWidth: 540, borderRadius: SURFACE_RADIUS, boxShadow: '0 10px 22px rgba(15,23,42,0.14)', alignItems: 'center' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
};

export default MuleMasterDatasetScreen;
