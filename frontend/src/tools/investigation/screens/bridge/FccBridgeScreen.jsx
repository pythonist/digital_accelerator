import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import { clearFccSentinelHandoff, mergeFccSentinelHandoff } from '../../../../utils/fccSentinelHandoff';
import PageContainer from '@investigation-layout/PageContainer';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  AutoAwesome,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  SyncAlt,
} from '@mui/icons-material';

const formatThreshold = (value) => {
  if (value == null || value === '') return '-';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
};

const FccBridgeScreen = ({ setActiveScreen }) => {
  const {
    activeEnv,
    setDatasetLoaded,
    checkDatasetStatus,
    loadCaseList,
    refreshPriorityBuckets,
    setCaseScopeRemote,
  } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [importingId, setImportingId] = useState('');
  const [clearingQueue, setClearingQueue] = useState(false);
  const [prepareInvestigationContext, setPrepareInvestigationContext] = useState(true);
  const [pendingImportRow, setPendingImportRow] = useState(null);
  const [generationMode, setGenerationMode] = useState('default');

  const hasActiveWorkspace = Boolean(String(activeEnv || '').trim());

  const loadPublishedRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listFccPublishedRuns();
      setRows(Array.isArray(res?.published) ? res.published : []);
    } catch (err) {
      setError(err.message || 'Failed to load FCC bridge packages.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublishedRuns();
  }, []);

  const readinessSummary = useMemo(
    () =>
      prepareInvestigationContext
        ? 'Imported alerts will arrive investigation-ready with linked history, account context, prior activity, and counterparty signals.'
        : 'Imported alerts will keep the published FCC package exactly as-is without extra investigation context.',
    [prepareInvestigationContext],
  );

  const openImportDialog = (row) => {
    setPendingImportRow(row || null);
    setGenerationMode('default');
  };

  const closeImportDialog = () => {
    if (importingId) return;
    setPendingImportRow(null);
  };

  const handleImport = async (row, selectedGenerationMode = 'default') => {
    const publishId = String(row?.publish_id || '').trim();
    if (!publishId || !hasActiveWorkspace) return;
    const shouldPrepareContext = selectedGenerationMode === 'advanced' && prepareInvestigationContext;
    setImportingId(publishId);
    setError(null);
    setSuccessMessage('');
    try {
      const res = await apiClient.importFccPublishedRun({
        publish_id: publishId,
        target_env_id: activeEnv,
        merge_existing: false,
        replace_existing: true,
        rerank_after_import: true,
        prepare_investigation_context: shouldPrepareContext,
        context_profile: 'balanced',
        generation_mode: selectedGenerationMode,
      });
      const imported = res?.import || {};
      const importedCases = Number(imported?.imported_case_count || 0).toLocaleString();
      const importedAlerts = Number(imported?.imported_alert_count || 0).toLocaleString();
      const sourceRows = Number(imported?.source_published_rows || row?.published_rows || 0).toLocaleString();
      const sourcePublishedCases = Number(imported?.source_published_case_count || row?.table_counts?.cases || 0).toLocaleString();
      const importedCaseIds = Array.isArray(imported?.imported_case_ids) ? imported.imported_case_ids : [];
      setDatasetLoaded(true);
      await checkDatasetStatus();
      if (importedCaseIds.length) {
        await setCaseScopeRemote('CUSTOM', importedCaseIds, imported?.focus_result?.run_id || null);
      }
      await loadCaseList(true);
      await refreshPriorityBuckets();
      mergeFccSentinelHandoff({
        source: 'fcc_bridge',
        handoff_type: 'fcc_to_sentinel',
        preferred_screen: 'fcc_bridge',
        env_id: activeEnv,
        publish_id: publishId,
        publish_label: row?.publish_label || row?.label || null,
        pipeline_id: row?.pipeline_id || null,
        pipeline_name: row?.pipeline_name || null,
        run_id: row?.run_id || null,
        deployment_id: row?.deployment_id || null,
        imported_case_ids: importedCaseIds,
        imported_case_count: Number(imported?.imported_case_count || importedCaseIds.length || 0),
        imported_alert_count: Number(imported?.imported_alert_count || 0),
        generation_mode: imported?.generation_mode || selectedGenerationMode,
        selected_case_id: importedCaseIds[0] || null,
      });
      apiClient.saveFccWorkflowSession({
        pipeline_id: row?.pipeline_id || undefined,
        pipeline_name: row?.pipeline_name || undefined,
        run_id: row?.run_id || undefined,
        deployment_id: row?.deployment_id || undefined,
        publish_id: publishId,
        current_module: 'investigation',
        current_step: 'fcc_bridge',
        current_state: {
          preferred_screen: 'fcc_bridge',
          selected_case_id: importedCaseIds[0] || null,
          run_id: row?.run_id || null,
          publish_id: publishId,
        },
        selected_case_id: importedCaseIds[0] || undefined,
        handoff_summary: {
          source: 'fcc_bridge',
          preferred_screen: 'fcc_bridge',
          publish_id: publishId,
          pipeline_id: row?.pipeline_id || null,
          pipeline_name: row?.pipeline_name || null,
          run_id: row?.run_id || null,
          deployment_id: row?.deployment_id || null,
          imported_case_ids: importedCaseIds,
          imported_case_count: Number(imported?.imported_case_count || importedCaseIds.length || 0),
          imported_alert_count: Number(imported?.imported_alert_count || 0),
          generation_mode: imported?.generation_mode || selectedGenerationMode,
          selected_case_id: importedCaseIds[0] || null,
        },
        status: 'sentinel_ready',
      }).catch(() => {});
      setActiveScreen?.('fcc_bridge');
      setSuccessMessage(
        `Imported ${importedCases} Sentinel cases and ${importedAlerts} alerts from ${sourceRows} FCC retained rows into shared workspace ${activeEnv}. Published case count: ${sourcePublishedCases}. Mode: ${selectedGenerationMode === 'advanced' ? 'Advanced' : 'Default'}.`,
      );
      await loadPublishedRuns();
    } catch (err) {
      setError(err.message || 'Failed to import FCC bridge package.');
    } finally {
      setImportingId('');
      setPendingImportRow(null);
    }
  };

  const handleClearImportedQueue = async () => {
    if (!hasActiveWorkspace) return;
    setClearingQueue(true);
    setError(null);
    setSuccessMessage('');
    try {
      await apiClient.clearFccImportedQueue({
        target_env_id: activeEnv,
      });
      setDatasetLoaded(false);
      await checkDatasetStatus();
      await setCaseScopeRemote('GLOBAL', null);
      await loadCaseList(true);
      await refreshPriorityBuckets();
      clearFccSentinelHandoff();
      setSuccessMessage(`Cleared the imported FCC investigation queue from shared workspace ${activeEnv}. You can now import a new retained run.`);
    } catch (err) {
      setError(err.message || 'Failed to clear the imported FCC queue.');
    } finally {
      setClearingQueue(false);
    }
  };

  return (
    <PageContainer
      title="FCC Bridge"
      subtitle="Bring FCC-retained runs into the shared Sentinel investigation workflow"
      breadcrumbs={['FCC Workflow', 'Sentinel Bridge']}
      actions={(
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadPublishedRuns} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={handleClearImportedQueue}
            disabled={!hasActiveWorkspace || clearingQueue}
          >
            {clearingQueue ? 'Clearing...' : 'Delete Imported Queue'}
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={3} sx={{ width: '100%' }}>
        {!hasActiveWorkspace && (
          <Alert
            severity="warning"
            action={(
              <Button color="inherit" size="small" onClick={() => setActiveScreen?.('settings')}>
                Open Settings
              </Button>
            )}
          >
            Select a Sentinel workspace before using FCC Bridge. Use Settings to control Sentinel defaults and review the current workspace context.
          </Alert>
        )}

        {successMessage ? (
          <Alert severity="success" onClose={() => setSuccessMessage('')}>
            {successMessage}
          </Alert>
        ) : null}

        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
          <Stack spacing={2.5}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', lg: 'center' }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Shared FCC-Sentinel Context
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  FCC-published runs are imported into the active Sentinel workspace so the same pipeline, run, and publish lineage stays intact end to end.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
                  The downstream queue can be reset explicitly before importing a new FCC retained run.
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Chip
                  icon={<SyncAlt sx={{ fontSize: 16 }} />}
                  label={`Shared workspace: ${activeEnv || 'Not selected'}`}
                  color={hasActiveWorkspace ? 'primary' : 'default'}
                  variant={hasActiveWorkspace ? 'filled' : 'outlined'}
                  size="small"
                />
                <Chip
                  icon={<AutoAwesome sx={{ fontSize: 16 }} />}
                  label={prepareInvestigationContext ? 'Investigation Ready' : 'Published Package Only'}
                  color={prepareInvestigationContext ? 'success' : 'default'}
                  variant="outlined"
                  size="small"
                />
              </Stack>
            </Stack>

            <Alert severity="info" variant="outlined">
              FCC Bridge is scoped to the shared workflow. It does not create a separate workspace or environment during import.
            </Alert>

            <Paper
              variant="outlined"
              sx={{
                borderRadius: 2,
                p: 2,
                backgroundColor: prepareInvestigationContext ? '#f8fafc' : '#fcfcfd',
                borderColor: prepareInvestigationContext ? '#cbd5e1' : 'divider',
              }}
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <SettingsIcon fontSize="small" color="action" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Investigation Readiness
                  </Typography>
                </Stack>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={prepareInvestigationContext}
                      onChange={(event) => setPrepareInvestigationContext(event.target.checked)}
                    />
                  )}
                  label="Prepare Investigation Context"
                />
                <Typography variant="body2" color="text.secondary">
                  {readinessSummary}
                </Typography>
              </Stack>
            </Paper>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', width: '100%' }}>
          {loading ? (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={30} />
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ p: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No FCC published runs are available yet. Publish a retained queue from the FCC Deployment Dashboard first.
              </Typography>
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: 420 }}>
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f8fafc' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Published Run</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Pipeline</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>FCC Run</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Rows</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Threshold</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Published</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const publishId = String(row.publish_id || '');
                    const isImporting = importingId === publishId;
                    return (
                      <TableRow key={publishId} hover>
                        <TableCell>
                          <Stack spacing={0.35}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {row.publish_label || publishId}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {publishId.slice(0, 14)}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                      <Stack spacing={0.35}>
                            <Typography variant="body2">
                              {row.pipeline_name || 'FCC Pipeline'}
                            </Typography>
                            {row.pipeline_id ? (
                              <Typography variant="caption" color="text.secondary">
                                {String(row.pipeline_id)}
                              </Typography>
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {String(row.run_id || '').slice(0, 14) || 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                            <Chip label={`${Number(row.published_rows || 0).toLocaleString()} retained`} size="small" />
                            <Chip label={`${Number(row.table_counts?.cases || 0).toLocaleString()} cases`} size="small" variant="outlined" />
                            <Chip label={`${Number(row.table_counts?.alerts || 0).toLocaleString()} alerts`} size="small" variant="outlined" />
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">{formatThreshold(row.threshold)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{row.published_at || '-'}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            variant="contained"
                            size="small"
                            disabled={!hasActiveWorkspace || isImporting}
                            onClick={() => openImportDialog(row)}
                          >
                            {isImporting ? 'Importing...' : 'Import Into Shared Workspace'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>

        {rows.some((row) => Number(row?.published_rows || 0) !== Number(row?.table_counts?.alerts || 0)) ? (
          <Alert severity="warning" variant="outlined">
            One or more FCC bridge packages have retained-row counts that do not match the generated alert count. The bridge now exposes both counts so the handoff can be reviewed before demo use.
          </Alert>
        ) : null}
      </Stack>

      <Dialog open={Boolean(pendingImportRow)} onClose={closeImportDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          Import FCC Package
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.2}>
            <Alert severity="info" variant="outlined">
              Importing again will rebuild the Sentinel workspace for this published run and replace the current imported queue.
            </Alert>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Select how the Sentinel investigation data should be generated.
              </Typography>
            </Box>
            <RadioGroup
              value={generationMode}
              onChange={(event) => setGenerationMode(event.target.value)}
            >
              <Stack spacing={1.5}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    borderColor: generationMode === 'default' ? 'primary.main' : 'divider',
                    backgroundColor: generationMode === 'default' ? '#f8fafc' : 'background.paper',
                  }}
                >
                  <FormControlLabel
                    value="default"
                    control={<Radio />}
                    label={(
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Default
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Uses the original compact FCC package shape with one primary transaction per retained alert.
                        </Typography>
                      </Box>
                    )}
                  />
                </Paper>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    borderColor: generationMode === 'advanced' ? 'primary.main' : 'divider',
                    backgroundColor: generationMode === 'advanced' ? '#f8fafc' : 'background.paper',
                  }}
                >
                  <FormControlLabel
                    value="advanced"
                    control={<Radio />}
                    label={(
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Advanced
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Rebuilds richer Sentinel context with varied transaction timelines, counterparties, countries, and rule-aligned activity.
                        </Typography>
                      </Box>
                    )}
                  />
                </Paper>
              </Stack>
            </RadioGroup>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeImportDialog} disabled={Boolean(importingId)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!pendingImportRow || Boolean(importingId)}
            onClick={() => handleImport(pendingImportRow, generationMode)}
          >
            {importingId ? 'Importing...' : 'Import Selected Mode'}
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};

export default FccBridgeScreen;
