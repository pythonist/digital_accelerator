import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import usePersistedWorkbenchScreen from '../../hooks/usePersistedWorkbenchScreen';
import {
  FCC_SENTINEL_HANDOFF_EVENT,
  clearFccSentinelHandoff,
  persistFccSentinelHandoff,
  readFccSentinelHandoff,
} from '../../utils/fccSentinelHandoff';
import apiClient from '@services/api';
import mlopsApi from '../mlops/services/mlopsApi';

// Layout
import MainLayout from './layout/Mainlayout';

// Data Screens
import DataLoadScreen from './screens/data/DataLoadScreen';
import DataTableScreen from './screens/data/DataTableScreen';
import SmartMergeScreen from './screens/data/SmartMergeScreen';
import AutoBuildScreen from './screens/data/AutoBuildScreen';
import SchemaMapScreen from './screens/data/SchemaMapScreen';
import DynamicDashboardScreen from './screens/data/DynamicDashboardScreen';
import DataCleanScreen from './screens/data/DataCleanScreen';
import MasterDashboardScreen from './screens/data/MasterDashboardScreen';
import ConnectorManagementScreen from './screens/data/ConnectorManagementScreen';
import IngestionHistoryScreen from './screens/data/IngestionHistoryScreen';
import FccBridgeScreen from './screens/bridge/FccBridgeScreen';

// Case Work Screens
import CasePriorityInbox from './screens/cases/CasePriorityInbox';
import CasePackViewer from './screens/cases/CasePackViewer';
import DataTreeScreen from './screens/cases/DataTreeScreen';
import ChatAssistantScreen from './screens/cases/ChatAssistantScreen';
import AgenticInvestigationScreen from './screens/cases/AgenticInvestigationScreen';
import CaseInvestigationScreen from './screens/cases/CaseInvestigationScreen';
import CaseResolutionWorkspace from './screens/cases/CaseResolutionWorkspace';
import CaseRetrievalComparePage from './screens/cases/retrieval_compare/CaseRetrievalComparePage';
import CaseQueuePage from './screens/cases/queue/CaseQueuePage';
import MailConfigurationPage from './screens/cases/queue/MailConfigurationPage';
import EscalationHistoryPage from './screens/cases/queue/EscalationHistoryPage';
import CaseReportsPage from './screens/cases/reports/CaseReportsPage';
import ExecutiveIntelligenceSummaryDialog from '@components/executive_summary/ExecutiveIntelligenceSummaryDialog';

// Analysis Screens
import GraphAnalysisScreen from './screens/analysis/GraphAnalysisScreen';
import RuleEngineScreen from './screens/analysis/RuleEngineScreen';
import TypologyAnalysisScreen from './screens/analysis/TypologyAnalysisScreen';
import BaselineAnalysisScreen from './screens/analysis/BaselineAnalysisScreen';

// Admin Screens
import AuditTrailScreen from '@screens/admin/AuditTrailScreen';
import InvestigationSettingsScreen from '@screens/admin/InvestigationSettingsScreen';

const HandoffPreviewTable = ({ title, preview }) => {
  const columns = Array.isArray(preview?.columns) ? preview.columns : [];
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  if (!columns.length || !rows.length) return null;

  return (
    <Box sx={{ mt: 1.5, borderRadius: 1.5, border: '1px solid #bfdbfe', backgroundColor: '#ffffff', overflow: 'hidden' }}>
      <Typography sx={{ px: 1.5, py: 1, fontSize: 12, fontWeight: 700, color: '#1e3a8a', borderBottom: '1px solid #dbeafe' }}>
        {title}
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: '#f8fbff' }}>
              {columns.map((column) => (
                <th key={column} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.45, borderBottom: '1px solid #e2e8f0' }}>
                  {String(column).replaceAll('_', ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((row, index) => (
              <tr key={`handoff-row-${index}`} style={{ borderBottom: '1px solid #eef2ff' }}>
                {columns.map((column) => (
                  <td key={`${index}-${column}`} style={{ padding: '7px 10px', color: '#0f172a' }}>
                    {row?.[column] == null || row?.[column] === '' ? '-' : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
};

const InvestigationPlatform = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = usePersistedWorkbenchScreen('investigation', 'priority');
  const [handoff, setHandoff] = useState(() => readFccSentinelHandoff());
  const preferredScreenAppliedRef = useRef(false);
  const [reportLoading, setReportLoading] = useState({ fcc: false, sentinel: false });
  const [executiveSummaryOpen, setExecutiveSummaryOpen] = useState(false);

  const downloadBlob = async (blobPromise, filename) => {
    const blob = await blobPromise;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!handoff?.preferred_screen || preferredScreenAppliedRef.current) {
      return;
    }
    preferredScreenAppliedRef.current = true;
    setActiveTab(String(handoff.preferred_screen));
  }, [handoff, setActiveTab]);

  useEffect(() => {
    const handleHandoffUpdate = (event) => {
      setHandoff(event?.detail || readFccSentinelHandoff());
    };
    window.addEventListener(FCC_SENTINEL_HANDOFF_EVENT, handleHandoffUpdate);
    return () => {
      window.removeEventListener(FCC_SENTINEL_HANDOFF_EVENT, handleHandoffUpdate);
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiClient.getFccWorkflowSession();
        const session = res?.session || null;
        const summary = session?.handoff_summary || {};
        const currentState = session?.current_state || {};
        if (!active || !session || (!summary?.publish_id && !summary?.run_id && !session?.publish_id)) {
          return;
        }
        const nextHandoff = {
          ...summary,
          preferred_screen: currentState?.preferred_screen || session?.current_step || summary?.preferred_screen || 'fcc_bridge',
          selected_case_id: session?.selected_case_id || currentState?.selected_case_id || summary?.selected_case_id || null,
          workflow_session_id: session?.session_id || summary?.workflow_session_id || null,
          case_scope: session?.case_scope || summary?.case_scope || null,
        };
        persistFccSentinelHandoff(nextHandoff);
        setHandoff((previous) => ({
          ...(previous || {}),
          ...nextHandoff,
        }));
      } catch {
        // Keep browser state as fallback.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!handoff?.run_id && !handoff?.pipeline_id && !handoff?.publish_id) return undefined;
    const timer = setTimeout(() => {
      apiClient.saveFccWorkflowSession({
        session_id: handoff?.workflow_session_id || undefined,
        pipeline_id: handoff?.pipeline_id || undefined,
        pipeline_name: handoff?.pipeline_name || undefined,
        run_id: handoff?.run_id || undefined,
        deployment_id: handoff?.deployment_id || undefined,
        publish_id: handoff?.publish_id || undefined,
        current_module: 'investigation',
        current_step: activeTab,
        current_state: {
          preferred_screen: activeTab,
          selected_case_id: handoff?.selected_case_id || null,
          run_id: handoff?.run_id || null,
          publish_id: handoff?.publish_id || null,
        },
        selected_case_id: handoff?.selected_case_id || undefined,
        case_scope: handoff?.case_scope || undefined,
        handoff_summary: handoff,
        status: 'sentinel_ready',
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, handoff]);

  const dismissHandoff = () => {
    clearFccSentinelHandoff();
    setHandoff(null);
  };

  const handleExecutiveModuleOpen = (cta) => {
    const tool = String(cta?.tool || '').trim().toLowerCase();
    const target = String(cta?.target || '').trim();
    if (!target) return;
    if (tool === 'sentinel') {
      setActiveTab(target);
      setExecutiveSummaryOpen(false);
      return;
    }
    if (tool === 'fcc') {
      setExecutiveSummaryOpen(false);
      navigate('/mlops');
    }
  };

  const downloadFccReport = async () => {
    if (!handoff?.run_id) return;
    setReportLoading((prev) => ({ ...prev, fcc: true }));
    try {
      await downloadBlob(
        mlopsApi.downloadReportPdf({
          run_id: handoff.run_id,
          pipeline_id: handoff.pipeline_id || undefined,
          strict_min_pages: true,
          audience: 'technical',
        }),
        `${String(handoff.pipeline_name || 'fcc_workbench').replace(/[^a-zA-Z0-9_-]+/g, '_')}_fcc_report.pdf`,
      );
    } finally {
      setReportLoading((prev) => ({ ...prev, fcc: false }));
    }
  };

  const downloadSentinelReport = async () => {
    setReportLoading((prev) => ({ ...prev, sentinel: true }));
    try {
      await downloadBlob(
        apiClient.post(
          '/api/v2/case-report/handoff/pdf',
          {
            handoff: handoff || {},
            audience: 'technical',
            strict_min_pages: true,
          },
          { responseType: 'blob' },
        ),
        `${String(handoff?.pipeline_name || handoff?.publish_label || 'sentinel_handoff').replace(/[^a-zA-Z0-9_-]+/g, '_')}_sentinel_report.pdf`,
      );
    } finally {
      setReportLoading((prev) => ({ ...prev, sentinel: false }));
    }
  };

  const renderScreen = () => {
    switch (activeTab) {
      // Data Management
      case 'load': return <DataLoadScreen setActiveScreen={setActiveTab} />;
      case 'connectors': return <ConnectorManagementScreen />;
      case 'history': return <IngestionHistoryScreen />;
      case 'table': return <DataTableScreen />;
      case 'schema': return <SchemaMapScreen />;
      case 'merge': return <SmartMergeScreen />;
      case 'build': return <AutoBuildScreen />;
      case 'clean': return <DataCleanScreen />;
      case 'dashboard': return <MasterDashboardScreen />;
      case 'dynamic': return <DynamicDashboardScreen />;
      case 'fcc_bridge': return <FccBridgeScreen setActiveScreen={setActiveTab} />;

      // Investigation
      case 'priority': return <CasePriorityInbox setActiveTab={setActiveTab} />;
      case 'casepack': return <CasePackViewer />;
      case 'investigate': return <CaseInvestigationScreen />;
      case 'resolution': return <CaseResolutionWorkspace />;
      case 'retrieval_compare':
      case 'compare':
      case 'vector':
        return <CaseRetrievalComparePage />;
      case 'case_queue': return <CaseQueuePage setActiveTab={setActiveTab} />;
      case 'case_reports': return <CaseReportsPage initialRoute="case_reports" onOpenCase={(caseId) => { setHandoff((prev) => ({ ...(prev || {}), selected_case_id: caseId })); setActiveTab('resolution'); }} />;
      case 'report_history': return <CaseReportsPage initialRoute="report_history" onOpenCase={(caseId) => { setHandoff((prev) => ({ ...(prev || {}), selected_case_id: caseId })); setActiveTab('resolution'); }} />;
      case 'batch_report_export': return <CaseReportsPage initialRoute="batch_report_export" onOpenCase={(caseId) => { setHandoff((prev) => ({ ...(prev || {}), selected_case_id: caseId })); setActiveTab('resolution'); }} />;
      case 'mail_config': return <MailConfigurationPage />;
      case 'escalation_history': return <EscalationHistoryPage />;
      case 'tree': return <DataTreeScreen />;
      case 'chat': return <ChatAssistantScreen />;
      case 'agentic': return <AgenticInvestigationScreen caseId={handoff?.selected_case_id || 'CASE-10024'} />;

      // Analysis
      case 'rules': return <RuleEngineScreen />;
      case 'typology': return <TypologyAnalysisScreen />;
      case 'graph': return <GraphAnalysisScreen />;
      case 'baseline': return <BaselineAnalysisScreen />;

      // System
      case 'audit': return <AuditTrailScreen />;
      case 'settings':
      case 'env_manager':
        return <InvestigationSettingsScreen />;

      default: return <CasePriorityInbox setActiveTab={setActiveTab} />;
    }
  };

  return (
    <MainLayout
      activeScreen={activeTab}
      setActiveScreen={setActiveTab}
      headerActions={(
        <Button
          size="small"
          onClick={() => setExecutiveSummaryOpen(true)}
          sx={{
            textTransform: 'none',
            color: '#fde68a',
            border: '1px solid rgba(253, 230, 138, 0.35)',
            bgcolor: 'rgba(255,255,255,0.04)',
            px: 1.2,
            py: 0.3,
            borderRadius: 999,
            fontSize: '0.7rem',
            fontWeight: 700,
            '&:hover': {
              bgcolor: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(253, 230, 138, 0.6)',
            },
          }}
        >
          Executive Summary
        </Button>
      )}
    >
      {handoff && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Alert
            severity="info"
            sx={{
              borderRadius: 2,
              border: '1px solid #bfdbfe',
              backgroundColor: '#eff6ff',
              alignItems: 'flex-start',
            }}
            action={(
              <Button color="inherit" size="small" onClick={dismissHandoff}>
                Dismiss
              </Button>
            )}
          >
            <Stack spacing={1.5}>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                  FCC retained cases are now open in Sentinel.
                </Typography>
                <Typography sx={{ fontSize: 12, mt: 0.5 }}>
                  FCC scored {Number(handoff?.total_scored || 0).toLocaleString()} unseen records, suppressed {Number(handoff?.suppressed_count || 0).toLocaleString()}, and sent {Number(handoff?.escalated_count || handoff?.imported_alert_count || 0).toLocaleString()} retained cases downstream for investigation.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${Number(handoff?.imported_case_count || 0).toLocaleString()} cases in scope`} size="small" />
                {handoff?.pipeline_name ? <Chip label={`Pipeline ${handoff.pipeline_name}`} size="small" /> : null}
                <Chip label={`Run ${String(handoff?.run_id || '').slice(0, 12) || '-'}`} size="small" />
                <Chip label={`Threshold ${Number(handoff?.threshold || 0).toFixed(2)}`} size="small" />
                {handoff?.requested_row_count ? <Chip label={`${Number(handoff.requested_row_count).toLocaleString()} FCC rows generated`} size="small" /> : null}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button size="small" variant="contained" onClick={() => setActiveTab('casepack')}>
                  Open Case Packs
                </Button>
                <Button size="small" variant="outlined" onClick={() => setActiveTab('investigate')}>
                  Open Case Copilot
                </Button>
                <Button size="small" variant="outlined" onClick={() => setActiveTab('graph')}>
                  Open Graph Analysis
                </Button>
                <Button size="small" variant="outlined" onClick={() => setActiveTab('resolution')}>
                  Open Resolution Workspace
                </Button>
                <Button size="small" variant="outlined" onClick={downloadFccReport} disabled={reportLoading.fcc || !handoff?.run_id}>
                  {reportLoading.fcc ? 'Preparing FCC Report...' : 'Download FCC Report'}
                </Button>
                <Button size="small" variant="outlined" onClick={downloadSentinelReport} disabled={reportLoading.sentinel}>
                  {reportLoading.sentinel ? 'Preparing Sentinel Report...' : 'Download Sentinel Report'}
                </Button>
              </Stack>
              <HandoffPreviewTable title="FCC Synthetic Master Data Table" preview={handoff?.master_data_preview} />
              <HandoffPreviewTable title="FCC Prepared Feature Table" preview={handoff?.prepared_feature_preview} />
              <HandoffPreviewTable title="FCC Prediction Output Table" preview={handoff?.prediction_preview} />
              <HandoffPreviewTable title="Rows Retained Into Sentinel" preview={handoff?.retained_preview} />
            </Stack>
          </Alert>
        </Box>
      )}
      {renderScreen()}
      <ExecutiveIntelligenceSummaryDialog
        open={executiveSummaryOpen}
        onClose={() => setExecutiveSummaryOpen(false)}
        onOpenModule={handleExecutiveModuleOpen}
        context={{
          runId: handoff?.run_id || undefined,
          pipelineId: handoff?.pipeline_id || undefined,
          publishId: handoff?.publish_id || undefined,
          source: 'sentinel',
        }}
      />
    </MainLayout>
  );
};

export default InvestigationPlatform;
