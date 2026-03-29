import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Download, Refresh } from '@mui/icons-material';

import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import ReportGeneratorModal from './ReportGeneratorModal';
import ReportPreviewScreen from './ReportPreviewScreen';
import ReportHistoryPage from './ReportHistoryPage';
import BatchReportSelector from './BatchReportSelector';
import ReportStatusIndicator from './ReportStatusIndicator';

const tabFromRoute = {
  case_reports: 'generate',
  report_history: 'history',
  batch_report_export: 'batch',
};

const CaseReportsPage = ({ initialRoute = 'case_reports', onOpenCase }) => {
  const { caseList, loadCaseList, activeCaseId, ollamaModels } = useAppContext();
  const viewMode = tabFromRoute[initialRoute] || 'generate';
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [historyTab, setHistoryTab] = useState(viewMode === 'batch' ? 'batch' : 'history');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [batchCases, setBatchCases] = useState([]);
  const [batchOutputMode, setBatchOutputMode] = useState('separate');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });

  useEffect(() => {
    loadCaseList();
  }, [loadCaseList]);

  useEffect(() => {
    const firstCase = String(activeCaseId || caseList?.[0]?.case_id || caseList?.[0]?.caseid || caseList?.[0]?.id || '');
    if (firstCase && !selectedCaseId) {
      setSelectedCaseId(firstCase);
    }
  }, [activeCaseId, caseList, selectedCaseId]);

  useEffect(() => {
    if (viewMode === 'batch') {
      setHistoryTab('batch');
    } else if (viewMode === 'history') {
      setHistoryTab('history');
    }
  }, [viewMode]);

  const caseOptions = useMemo(
    () => (caseList || []).map((item) => {
      const caseId = String(item.case_id || item.caseid || item.id || '');
      return {
        value: caseId,
        label: `${caseId}${item.customer_id ? ` | ${item.customer_id}` : ''}`,
      };
    }),
    [caseList],
  );

  const availableModels = useMemo(
    () => (ollamaModels || []).map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean),
    [ollamaModels],
  );

  const pageMeta = useMemo(() => {
    if (viewMode === 'history' || viewMode === 'batch') {
      return {
        title: 'Report History',
        subtitle: 'Review generated investigation reports, download prior dossiers, and run batch export from the same workspace.',
        breadcrumbs: ['Resolution', 'Report History'],
      };
    }
    return {
      title: 'Generate Report',
      subtitle: 'Generate an audit-ready investigation dossier for the selected case across the full Sentinel journey.',
      breadcrumbs: ['Resolution', 'Generate Report'],
    };
  }, [viewMode]);

  const fetchHistory = async () => {
    const response = await apiClient.getCaseReportHistory({ limit: 100 });
    setHistoryRows(response.rows || []);
  };

  const fetchLatest = async (caseId) => {
    if (!caseId) return;
    const response = await apiClient.getCaseReports(caseId);
    setLatestReport(response.latest || null);
  };

  useEffect(() => {
    fetchHistory().catch(() => {});
  }, []);

  useEffect(() => {
    fetchLatest(selectedCaseId).catch(() => {});
  }, [selectedCaseId]);

  const downloadReport = async (reportId, fileName = 'case_report.pdf') => {
    const blob = await apiClient.downloadCaseReport(reportId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async ({ model } = {}) => {
    setLoading(true);
    try {
      const response = await apiClient.generateCaseReport({ case_id: selectedCaseId, model });
      setPreview(response.preview || null);
      setLatestReport(response.report || null);
      await fetchHistory();
      setFeedback({ open: true, severity: 'success', message: `Report generated for ${selectedCaseId}.` });
      setReportModalOpen(false);
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to generate report.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBatch = async () => {
    setLoading(true);
    try {
      const response = await apiClient.generateBatchCaseReports({
        case_ids: batchCases.map((item) => item.value),
        output_mode: batchOutputMode,
      });
      await fetchHistory();
      if (response.report?.report_id) {
        await downloadReport(response.report.report_id, response.report.file_name || 'batch_case_report.pdf');
      }
      setFeedback({ open: true, severity: 'success', message: 'Batch report generation completed.' });
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to generate batch reports.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title={pageMeta.title}
      subtitle={pageMeta.subtitle}
      breadcrumbs={pageMeta.breadcrumbs}
      actions={(
        <Stack direction="row" spacing={1.25}>
          <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => { fetchHistory(); fetchLatest(selectedCaseId); }}>
            Refresh
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2.5}>
        {viewMode === 'generate' ? (
          <Stack spacing={2.25}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 280 }}>
                  <InputLabel>Case ID</InputLabel>
                  <Select value={selectedCaseId} label="Case ID" onChange={(event) => setSelectedCaseId(event.target.value)}>
                    {caseOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <Alert severity="info" sx={{ flex: 1, border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
                  Generate a structured investigation dossier that combines case context, evidence, Copilot insight, lineage, similar-case comparison, graph findings, rules, typology signals, and the final resolution record.
                </Alert>
                <Button variant="contained" onClick={() => setReportModalOpen(true)} disabled={!selectedCaseId || loading}>
                  {loading ? 'Generating...' : 'Generate Report'}
                </Button>
              </Stack>
            </Paper>

            {latestReport ? (
              <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a' }}>{latestReport.report_name}</Typography>
                    <ReportStatusIndicator status={latestReport.status} />
                    <Chip size="small" label={`Version ${latestReport.version_no || 1}`} variant="outlined" />
                  </Stack>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={() => downloadReport(latestReport.report_id, latestReport.file_name)}
                  >
                    Download Latest PDF
                  </Button>
                </Stack>
              </Paper>
            ) : null}

            <ReportPreviewScreen preview={preview} />
          </Stack>
        ) : null}

        {viewMode === 'history' || viewMode === 'batch' ? (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Tabs value={historyTab} onChange={(_, value) => setHistoryTab(value)} sx={{ px: 1.5, pt: 1 }}>
                <Tab value="history" label="Report History" />
                <Tab value="batch" label="Batch Export" />
              </Tabs>
            </Paper>

            {historyTab === 'history' ? (
              <ReportHistoryPage
                rows={historyRows}
                onDownload={(reportId) => {
                  const row = historyRows.find((item) => item.report_id === reportId);
                  downloadReport(reportId, row?.file_name || 'case_report.pdf');
                }}
                onOpenCase={(caseId) => {
                  setSelectedCaseId(caseId);
                  onOpenCase?.(caseId);
                }}
              />
            ) : null}

            {historyTab === 'batch' ? (
              <BatchReportSelector
                caseOptions={caseOptions}
                selectedCases={batchCases}
                onChange={setBatchCases}
                outputMode={batchOutputMode}
                onOutputModeChange={setBatchOutputMode}
                onGenerate={handleGenerateBatch}
                loading={loading}
              />
            ) : null}
          </Stack>
        ) : null}
      </Stack>

      <ReportGeneratorModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        caseId={selectedCaseId}
        availableModels={availableModels}
        onGenerate={handleGenerate}
        loading={loading}
      />

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((prev) => ({ ...prev, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((prev) => ({ ...prev, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default CaseReportsPage;
