import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Snackbar,
  Stack,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';

import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import { mergeFccSentinelHandoff } from '../../../../../utils/fccSentinelHandoff';
import CaseQueueKPIBar from './CaseQueueKPIBar';
import CaseQueueFilters from './CaseQueueFilters';
import CaseQueueTable from './CaseQueueTable';
import CaseQueueDetailDrawer from './CaseQueueDetailDrawer';
import CaseQueueBatchActionBar from './CaseQueueBatchActionBar';
import EscalationModal from './EscalationModal';
import { downloadJson, formatDateTime } from './queueUtils';
import {
  readInvestigationSettings,
  subscribeInvestigationSettings,
} from '../../../utils/investigationSettings';

const buildInitialFilters = (settings = readInvestigationSettings()) => ({
  search: '',
  status: '',
  stage: '',
  risk: '',
  escalated_to: '',
  branch: '',
  region: '',
  date_from: '',
  date_to: '',
  saved_view: settings?.case_queue?.default_saved_view || 'All Cases',
  page: 1,
  page_size: settings?.case_queue?.default_page_size || 25,
  sort_by: 'risk_score',
  sort_dir: 'desc',
});

const CaseQueuePage = ({ setActiveTab }) => {
  const [filters, setFilters] = useState(() => buildInitialFilters());
  const [queueData, setQueueData] = useState({ rows: [], kpis: {}, pagination: {}, meta: {} });
  const [loading, setLoading] = useState(true);
  const [detailCaseId, setDetailCaseId] = useState('');
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [batchStatus, setBatchStatus] = useState('');
  const [batchOwner, setBatchOwner] = useState('');
  const [batchRemarks, setBatchRemarks] = useState('');
  const [escalationState, setEscalationState] = useState({ open: false, mode: 'single', caseIds: [], rows: [] });
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });
  const [error, setError] = useState('');
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => {
    const settings = readInvestigationSettings();
    return Math.max(5000, Number(settings?.case_queue?.refresh_interval_seconds || 15) * 1000);
  });

  const selectedRows = useMemo(
    () => queueData.rows.filter((row) => selectedCaseIds.includes(row.case_id)),
    [queueData.rows, selectedCaseIds],
  );

  const fetchQueue = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await apiClient.getCaseQueue(filters);
      setQueueData(response);
      setError('');
      setSelectedCaseIds((previous) => previous.filter((caseId) => (response.rows || []).some((row) => row.case_id === caseId)));
    } catch (queueError) {
      setError(queueError.message || 'Unable to load the case queue.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    const applySettings = (latestSettings) => {
      setRefreshIntervalMs(Math.max(5000, Number(latestSettings?.case_queue?.refresh_interval_seconds || 15) * 1000));
    };
    applySettings(readInvestigationSettings());
    return subscribeInvestigationSettings(applySettings);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchQueue(true);
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshIntervalMs]);

  const loadDetail = async (caseId) => {
    setDetailCaseId(caseId);
    setDetailLoading(true);
    try {
      const response = await apiClient.getCaseQueueDetail(caseId);
      setDetailData(response);
      mergeFccSentinelHandoff({ selected_case_id: caseId, preferred_screen: 'case_queue' });
    } catch (detailError) {
      setFeedback({ open: true, severity: 'error', message: detailError.message || 'Unable to load case detail.' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters((previous) => ({
      ...previous,
      [key]: value,
      page: key === 'page' ? value : 1,
    }));
  };

  const handleToggleAll = (rows) => {
    const rowIds = rows.map((row) => row.case_id);
    const allChecked = rowIds.length > 0 && rowIds.every((caseId) => selectedCaseIds.includes(caseId));
    setSelectedCaseIds(allChecked ? [] : rowIds);
  };

  const handleToggleRow = (caseId) => {
    setSelectedCaseIds((previous) => (
      previous.includes(caseId)
        ? previous.filter((item) => item !== caseId)
        : [...previous, caseId]
    ));
  };

  const handleSort = (column) => {
    const sortKey = column === 'ageing' ? 'ageing' : column === 'last_updated_at' ? 'last_updated' : column;
    setFilters((previous) => ({
      ...previous,
      page: 1,
      sort_by: sortKey,
      sort_dir: previous.sort_by === sortKey && previous.sort_dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const refreshAfterAction = async (message) => {
    await fetchQueue(true);
    if (detailCaseId) {
      await loadDetail(detailCaseId);
    }
    setFeedback({ open: true, severity: 'success', message });
  };

  const handleUpdateStatus = async (status, remarks) => {
    if (!detailCaseId || !status) return;
    try {
      await apiClient.updateCaseQueueStatus(detailCaseId, { new_status: status, remarks });
      await refreshAfterAction(`Case ${detailCaseId} updated to ${status}.`);
    } catch (statusError) {
      setFeedback({ open: true, severity: 'error', message: statusError.message || 'Unable to update case status.' });
    }
  };

  const handleAssignOwner = async (owner, remarks) => {
    if (!detailCaseId || !owner) return;
    try {
      await apiClient.assignCaseQueueOwner(detailCaseId, { owner, remarks });
      await refreshAfterAction(`Owner updated for ${detailCaseId}.`);
    } catch (assignError) {
      setFeedback({ open: true, severity: 'error', message: assignError.message || 'Unable to assign owner.' });
    }
  };

  const handleBatchStatus = async () => {
    if (!selectedCaseIds.length || !batchStatus) return;
    try {
      const result = await apiClient.updateCaseQueueStatusBatch({ case_ids: selectedCaseIds, new_status: batchStatus, remarks: batchRemarks });
      setSelectedCaseIds([]);
      setBatchStatus('');
      setBatchRemarks('');
      await refreshAfterAction(`${(result.updated || []).length} case(s) updated to ${batchStatus}.`);
    } catch (batchError) {
      setFeedback({ open: true, severity: 'error', message: batchError.message || 'Unable to update selected cases.' });
    }
  };

  const handleBatchAssign = async () => {
    if (!selectedCaseIds.length || !batchOwner) return;
    try {
      await Promise.all(selectedCaseIds.map((caseId) => apiClient.assignCaseQueueOwner(caseId, { owner: batchOwner, remarks: batchRemarks })));
      setSelectedCaseIds([]);
      setBatchOwner('');
      setBatchRemarks('');
      await refreshAfterAction('Owner updated for selected cases.');
    } catch (assignError) {
      setFeedback({ open: true, severity: 'error', message: assignError.message || 'Unable to assign selected cases.' });
    }
  };

  const openEscalationModal = (mode, caseIds, rows) => {
    setEscalationState({ open: true, mode, caseIds, rows });
  };

  const handleCasePackOpen = () => {
    if (!detailCaseId) return;
    mergeFccSentinelHandoff({ selected_case_id: detailCaseId, preferred_screen: 'casepack' });
    setActiveTab?.('casepack');
  };

  const handleViewSar = () => {
    if (!detailCaseId) return;
    mergeFccSentinelHandoff({ selected_case_id: detailCaseId, preferred_screen: 'resolution' });
    setActiveTab?.('resolution');
  };

  const handleExportSingle = () => {
    if (!detailCaseId || !detailData) return;
    downloadJson(`case_queue_summary_${detailCaseId}.json`, detailData);
  };

  const handleExportBatch = () => {
    downloadJson(`case_queue_batch_${Date.now()}.json`, {
      exported_at: new Date().toISOString(),
      case_ids: selectedCaseIds,
      rows: selectedRows,
    });
  };

  return (
    <PageContainer
      title="Case Queue"
      subtitle="Operational live worklist for case progression, reviewer escalation, and queue ownership management"
      breadcrumbs={['Resolution', 'Case Queue']}
      actions={(
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => fetchQueue()} disabled={loading}>
          Refresh
        </Button>
      )}
    >
      <Stack spacing={2.25}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <CaseQueueKPIBar kpis={queueData.kpis} />
        <CaseQueueFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onReset={() => setFilters(buildInitialFilters())}
          onRefresh={() => fetchQueue()}
          refreshedAt={formatDateTime(queueData.meta?.refreshed_at)}
          loading={loading}
        />
        <CaseQueueTable
          rows={queueData.rows}
          loading={loading}
          pagination={queueData.pagination || {}}
          selectedCaseIds={selectedCaseIds}
          onToggleAll={handleToggleAll}
          onToggleRow={handleToggleRow}
          onSort={handleSort}
          sortBy={filters.sort_by === 'last_updated' ? 'last_updated_at' : filters.sort_by}
          sortDir={filters.sort_dir}
          onOpenCase={loadDetail}
          onPageChange={(page) => handleFilterChange('page', page)}
          onPageSizeChange={(pageSize) => setFilters((previous) => ({ ...previous, page: 1, page_size: pageSize }))}
        />
        <CaseQueueBatchActionBar
          selectedCount={selectedCaseIds.length}
          statusValue={batchStatus}
          ownerValue={batchOwner}
          remarksValue={batchRemarks}
          onStatusChange={setBatchStatus}
          onOwnerChange={setBatchOwner}
          onRemarksChange={setBatchRemarks}
          onApplyStatus={handleBatchStatus}
          onApplyOwner={handleBatchAssign}
          onEscalate={() => openEscalationModal('batch', selectedCaseIds, selectedRows)}
          onSendMail={() => openEscalationModal('batch', selectedCaseIds, selectedRows)}
          onExport={handleExportBatch}
        />
      </Stack>

      <CaseQueueDetailDrawer
        open={Boolean(detailCaseId)}
        detail={detailData}
        loading={detailLoading}
        onClose={() => {
          setDetailCaseId('');
          setDetailData(null);
        }}
        onUpdateStatus={handleUpdateStatus}
        onAssignOwner={handleAssignOwner}
        onEscalate={() => openEscalationModal('single', [detailCaseId], detailData?.case ? [detailData.case] : [])}
        onOpenCasePack={handleCasePackOpen}
        onViewSar={handleViewSar}
        onSendMail={() => openEscalationModal('single', [detailCaseId], detailData?.case ? [detailData.case] : [])}
        onExportSummary={handleExportSingle}
      />

      <EscalationModal
        open={escalationState.open}
        mode={escalationState.mode}
        caseIds={escalationState.caseIds}
        rows={escalationState.rows}
        onClose={() => setEscalationState({ open: false, mode: 'single', caseIds: [], rows: [] })}
        onSuccess={async () => {
          setSelectedCaseIds([]);
          await refreshAfterAction('Escalation processed successfully.');
        }}
      />

      <Snackbar open={feedback.open} autoHideDuration={5000} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default CaseQueuePage;
