import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  AddTask as AddToReportIcon,
  Download as DownloadIcon,
  HelpOutline as GuideIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
} from '@mui/icons-material';

import { useAppContext } from '@context/AppContext';
import PageContainer from '@investigation-layout/PageContainer';
import apiClient from '@services/api';
import { mergeCaseResolutionModule } from '../../utils/caseResolutionStore';
import GraphScopeControls from './network_intelligence/GraphScopeControls';
import NetworkEvidencePanel from './network_intelligence/NetworkEvidencePanel';
import NetworkFindingsOverview from './network_intelligence/NetworkFindingsOverview';
import NetworkGraphView from './network_intelligence/NetworkGraphView';
import NetworkGuideDrawer from './network_intelligence/NetworkGuideDrawer';
import NetworkKPIBar from './network_intelligence/NetworkKPIBar';
import NetworkReportSnippetsPanel from './network_intelligence/NetworkReportSnippetsPanel';
import NetworkTimelineView from './network_intelligence/NetworkTimelineView';
import PathExplorerPanel from './network_intelligence/PathExplorerPanel';
import RelationshipMatrixView from './network_intelligence/RelationshipMatrixView';

const initialFilters = {
  max_hops: 2,
  time_window_days: 90,
  min_amount: 0,
  entity_focus: 'all',
  only_high_risk: false,
};

const downloadJson = (fileName, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const EmptyState = () => (
  <Paper variant="outlined" sx={{ p: 5, borderRadius: 2.5, textAlign: 'center' }}>
    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Select a case to begin network intelligence analysis</Typography>
    <Typography sx={{ mt: 1.1, fontSize: 13.2, color: '#64748b', maxWidth: 780, mx: 'auto', lineHeight: 1.8 }}>
      This module helps investigators detect visible hubs, bridges, shared counterparties, suspicious clusters, funnel structures, path connections, and network-based reasons to escalate a case.
    </Typography>
  </Paper>
);

const GraphAnalysisScreen = () => {
  const { caseList, loadCaseList, activeCaseId } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [centerTab, setCenterTab] = useState('findings');
  const [rightTab, setRightTab] = useState('evidence');
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [analystNotes, setAnalystNotes] = useState('');
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });
  const [result, setResult] = useState(null);

  useEffect(() => {
    loadCaseList();
  }, [loadCaseList]);

  useEffect(() => {
    if (selectedCaseId || !caseList.length) return;
    const preferred = String(activeCaseId || caseList?.[0]?.case_id || caseList?.[0]?.caseid || caseList?.[0]?.id || '');
    if (preferred) setSelectedCaseId(preferred);
  }, [activeCaseId, caseList, selectedCaseId]);

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

  const runAnalysis = async (caseId = selectedCaseId, nextFilters = filters) => {
    if (!caseId) return;
    setLoading(true);
    try {
      const response = await apiClient.analyzeNetworkIntelligence(caseId, nextFilters);
      setResult(response);
      setAnalystNotes(response.saved?.payload?.analyst_notes || '');
      mergeCaseResolutionModule(caseId, 'graph', {
        narrative: response.executive_summary,
        report_payload: response.report_payload,
        findings: response.findings,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to run network intelligence.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedCaseId) return;
    apiClient.getSavedNetworkIntelligence(selectedCaseId)
      .then((response) => {
        if (response.saved?.payload) {
          setResult(response.saved.payload);
          setAnalystNotes(response.saved.payload.analyst_notes || '');
        } else {
          runAnalysis(selectedCaseId, filters);
        }
      })
      .catch(() => runAnalysis(selectedCaseId, filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  const handleSave = async (includeInReport = true) => {
    if (!selectedCaseId || !result) return;
    setSaving(true);
    try {
      const payload = {
        ...result,
        analyst_notes: analystNotes,
      };
      await apiClient.saveNetworkIntelligence(selectedCaseId, payload, includeInReport);
      mergeCaseResolutionModule(selectedCaseId, 'graph', {
        narrative: result.executive_summary,
        report_payload: result.report_payload,
        findings: result.findings,
        analyst_notes: analystNotes,
        updated_at: new Date().toISOString(),
      });
      setFeedback({
        open: true,
        severity: 'success',
        message: includeInReport ? 'Network findings saved and added to report context.' : 'Network findings saved for this case.',
      });
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to save network findings.' });
    } finally {
      setSaving(false);
    }
  };

  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode || !result?.graph?.nodes) return null;
    return result.graph.nodes.find((item) => item.id === selectedNode.id) || selectedNode;
  }, [result, selectedNode]);

  return (
    <PageContainer
      title="Network Intelligence"
      subtitle="Analyze visible case relationships, suspicious structures, and network-based risk signals using graph analytics and explainable findings."
      breadcrumbs={['Analysis', 'Network Intelligence']}
      actions={(
        <Stack direction="row" spacing={1.1}>
          <Button size="small" variant="outlined" startIcon={<GuideIcon />} onClick={() => setGuideOpen(true)}>Guide</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => result && downloadJson(`network_intelligence_${selectedCaseId}.json`, result)} disabled={!result}>Export</Button>
          <Button size="small" variant="outlined" startIcon={<AddToReportIcon />} onClick={() => handleSave(true)} disabled={!result || saving}>Add to Report</Button>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => runAnalysis()} disabled={!selectedCaseId || loading}>Re-run Analysis</Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => handleSave(false)} disabled={!result || saving}>Save Findings</Button>
        </Stack>
      )}
    >
      <Stack spacing={2.5}>
        <NetworkKPIBar kpis={result?.kpis || {}} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '300px minmax(0, 1fr) 340px' }, gap: 2 }}>
          <GraphScopeControls
            caseOptions={caseOptions}
            selectedCaseId={selectedCaseId}
            onCaseChange={setSelectedCaseId}
            filters={filters}
            onFilterChange={(key, value) => setFilters((previous) => ({ ...previous, [key]: value }))}
            onRun={() => runAnalysis()}
            loading={loading}
          />

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Tabs value={centerTab} onChange={(_, value) => setCenterTab(value)} sx={{ px: 1.5, pt: 1 }}>
                <Tab value="findings" label="Findings" />
                <Tab value="graph" label="Network Graph" />
                <Tab value="timeline" label="Timeline" />
                <Tab value="matrix" label="Relationship Matrix" />
                <Tab value="paths" label="Path Explorer" />
              </Tabs>
            </Paper>

            {!selectedCaseId && !loading ? <EmptyState /> : null}
            {loading ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2.5, textAlign: 'center' }}>
                <CircularProgress size={34} />
                <Typography sx={{ mt: 1.5, fontSize: 13.5, color: '#475569' }}>Running network intelligence analysis...</Typography>
              </Paper>
            ) : null}

            {!loading && selectedCaseId && result ? (
              <>
                {centerTab === 'findings' ? (
                  <NetworkFindingsOverview
                    executiveSummary={result.executive_summary}
                    findings={result.findings}
                    visibilityNote={result.report_payload?.visibility_limitations}
                    assessment={result.report_payload?.network_risk_assessment?.assessment}
                  />
                ) : null}
                {centerTab === 'graph' ? (
                  <NetworkGraphView graph={result.graph} selectedNodeId={selectedNode?.id} onSelectNode={setSelectedNode} />
                ) : null}
                {centerTab === 'timeline' ? <NetworkTimelineView rows={result.timeline || []} /> : null}
                {centerTab === 'matrix' ? <RelationshipMatrixView rows={result.relationship_matrix || []} /> : null}
                {centerTab === 'paths' ? <PathExplorerPanel graph={result.graph} precomputedPaths={result.analytics?.shortest_paths || []} /> : null}
              </>
            ) : null}
          </Stack>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Tabs value={rightTab} onChange={(_, value) => setRightTab(value)} sx={{ px: 1.5, pt: 1 }}>
                <Tab value="evidence" label="Evidence" />
                <Tab value="details" label="Details" />
                <Tab value="notes" label="Notes" />
                <Tab value="report" label="Report Snippets" />
              </Tabs>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, minHeight: 420 }}>
              {rightTab === 'evidence' ? <NetworkEvidencePanel items={result?.evidence || []} /> : null}

              {rightTab === 'details' ? (
                selectedNodeDetails ? (
                  <Stack spacing={1}>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{selectedNodeDetails.label || selectedNodeDetails.id}</Typography>
                    {Object.entries(selectedNodeDetails).map(([key, value]) => (
                      <Typography key={key} sx={{ fontSize: 12.4, color: '#334155' }}>
                        <strong>{key}:</strong> {Array.isArray(value) ? value.join(', ') : String(value)}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: 12.75, color: '#64748b' }}>
                    Select a node in the Network Graph tab to inspect attributes, transaction counts, risk metadata, and visible relationships.
                  </Typography>
                )
              ) : null}

              {rightTab === 'notes' ? (
                <Stack spacing={1.25}>
                  <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a' }}>Analyst Notes</Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={14}
                    value={analystNotes}
                    onChange={(event) => setAnalystNotes(event.target.value)}
                    placeholder="Capture network review notes, visibility limitations, escalation rationale, or path-based observations."
                  />
                </Stack>
              ) : null}

              {rightTab === 'report' ? <NetworkReportSnippetsPanel snippets={result?.report_snippets || []} /> : null}
            </Paper>
          </Stack>
        </Box>

        {result && !result.graph?.nodes?.length ? (
          <Alert severity="info" sx={{ border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
            Limited visible network evidence for this case. No strong cluster, hub, or path-based signal was detected in the available data.
          </Alert>
        ) : null}
      </Stack>

      <NetworkGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default GraphAnalysisScreen;
