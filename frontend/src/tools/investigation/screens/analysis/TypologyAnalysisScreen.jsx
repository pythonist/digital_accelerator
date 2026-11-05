import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
  Security as ShieldIcon,
  Psychology as BrainIcon,
  CheckCircleOutline as CheckIcon,
  ArrowForward as ArrowIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';

import { useAppContext } from '@context/AppContext';
import PageContainer from '@investigation-layout/PageContainer';
import apiClient from '@services/api';
import { mergeCaseResolutionModule } from '../../utils/caseResolutionStore';
import InvestigatorGuidancePanel from './typology_intelligence/InvestigatorGuidancePanel';
import SupportingSignalsPanel from './typology_intelligence/SupportingSignalsPanel';
import TypologyAssessmentHistory from './typology_intelligence/TypologyAssessmentHistory';
import TypologyBreakdownTable from './typology_intelligence/TypologyBreakdownTable';
import TypologyCaseSnapshot from './typology_intelligence/TypologyCaseSnapshot';
import TypologyEvidencePanel from './typology_intelligence/TypologyEvidencePanel';
import TypologyGuideDrawer from './typology_intelligence/TypologyGuideDrawer';
import TypologyReportSnippetsPanel from './typology_intelligence/TypologyReportSnippetsPanel';
import TypologySummaryBar from './typology_intelligence/TypologySummaryBar';

const ANALYSIS_MODES = [
  { value: 'balanced', label: 'Balanced Review' },
  { value: 'evidence-led', label: 'Evidence-Led Review' },
  { value: 'escalation-sensitive', label: 'Escalation-Sensitive Review' },
];

const downloadJson = (fileName, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const TypologyAnalysisScreen = () => {
  const { caseList, loadCaseList, activeCaseId, priorityBuckets, getFilteredCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisMode, setAnalysisMode] = useState('balanced');
  const [usePriorityFilter, setUsePriorityFilter] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [guideOpen, setGuideOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [assessment, setAssessment] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [analystNotes, setAnalystNotes] = useState('');
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });

  const displayCases = usePriorityFilter && priorityBuckets?.enabled ? getFilteredCaseList() : caseList || [];

  useEffect(() => {
    loadCaseList();
  }, [loadCaseList]);

  useEffect(() => {
    if (selectedCaseId || !displayCases.length) return;
    const preferred = String(activeCaseId || displayCases[0]?.case_id || displayCases[0]?.caseid || displayCases[0]?.id || '');
    if (preferred) setSelectedCaseId(preferred);
  }, [activeCaseId, displayCases, selectedCaseId]);

  const caseOptions = useMemo(
    () =>
      (displayCases || []).map((item, index) => {
        const caseId = String(item.case_id || item.caseid || item.id || `CASE-${index}`);
        return {
          value: caseId,
          label: `${caseId}${item.customer_id ? ` | ${item.customer_id}` : ''}`,
        };
      }),
    [displayCases]
  );

  const loadHistory = async (caseId) => {
    if (!caseId) return;
    setHistoryLoading(true);
    try {
      const response = await apiClient.getTypologyAssessmentHistory(caseId, { limit: 12 });
      setHistoryRows(response.history || []);
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const mergeIntoResolution = (caseId, payload) => {
    mergeCaseResolutionModule(caseId, 'typology', {
      narrative: payload?.summary_sections?.assessment_overview,
      report_payload: payload?.report_payload,
      primary_typology: payload?.primary_typology,
      updated_at: new Date().toISOString(),
    });
  };

  const runAssessment = async (caseId = selectedCaseId, mode = analysisMode) => {
    if (!caseId) return;
    setLoading(true);
    try {
      const response = await apiClient.analyzeTypologyIntelligence(caseId, { analysis_mode: mode });
      setAssessment(response);
      setAnalystNotes(response.analyst_notes || '');
      mergeIntoResolution(caseId, response);
      await loadHistory(caseId);
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to run typology assessment.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedCaseId) return;
    apiClient
      .getSavedTypologyAssessment(selectedCaseId)
      .then(async (response) => {
        if (response.saved?.payload) {
          setAssessment(response.saved.payload);
          setAnalystNotes(response.saved.payload.analyst_notes || '');
          mergeIntoResolution(selectedCaseId, response.saved.payload);
        } else {
          await runAssessment(selectedCaseId, analysisMode);
        }
        await loadHistory(selectedCaseId);
      })
      .catch(() => runAssessment(selectedCaseId, analysisMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId]);

  const handleSave = async (includeInReport = false) => {
    if (!selectedCaseId || !assessment) return;
    setSaving(true);
    try {
      const payload = { ...assessment, analyst_notes: analystNotes };
      const response = await apiClient.saveTypologyAssessment(selectedCaseId, payload, includeInReport);
      if (response.saved?.payload) {
        setAssessment(response.saved.payload);
        setAnalystNotes(response.saved.payload.analyst_notes || analystNotes);
        mergeIntoResolution(selectedCaseId, response.saved.payload);
      }
      await loadHistory(selectedCaseId);
      setFeedback({
        open: true,
        severity: 'success',
        message: includeInReport ? 'Typology assessment saved and added to report context.' : 'Typology assessment saved for this case.',
      });
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to save typology assessment.' });
    } finally {
      setSaving(false);
    }
  };

  const snapshot = assessment?.case_snapshot || {};

  return (
    <PageContainer
      title="Typology Intelligence"
      subtitle="Assess whether visible case behavior aligns with known AML and fraud patterns using explainable pattern scoring"
      breadcrumbs={['Analysis', 'Typology Intelligence']}
      actions={(
        <Stack direction="row" spacing={1.25}>
          <Button size="small" variant="text" startIcon={<GuideIcon />} onClick={() => setGuideOpen(true)} sx={{ color: '#475569', fontWeight: 700 }}>
            Guide
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => assessment && downloadJson(`typology_intelligence_${selectedCaseId}.json`, assessment)}
            disabled={!assessment}
            sx={{ fontWeight: 600, borderRadius: 1 }}
          >
            Export
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddToReportIcon />}
            onClick={() => handleSave(true)}
            disabled={!assessment || saving}
            sx={{ fontWeight: 600, borderRadius: 1 }}
          >
            Add to Report
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => runAssessment()}
            disabled={!selectedCaseId || loading}
            sx={{ fontWeight: 600, borderRadius: 1 }}
          >
            Re-run
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => handleSave(false)}
            disabled={!assessment || saving}
            sx={{ fontWeight: 700, borderRadius: 1, bgcolor: '#0f172a', '&:hover': { bgcolor: '#1e293b' } }}
          >
            Save Assessment
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2}>
        {/* Consolidated Executive Telemetry Strip */}
        <TypologySummaryBar summary={assessment?.summary_bar} />

        {/* 2-Column High-Density Workbench */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '300px minmax(0, 1fr)' }, gap: 2 }}>
          {/* LEFT COLUMN: Controls & Compact Case Snapshot */}
          <Stack spacing={2}>
            {/* Assessment Controls */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 1.5,
                bgcolor: '#ffffff',
                borderColor: '#e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5 }}>
                Assessment Controls
              </Typography>

              <Stack spacing={1.5}>
                <FormControl fullWidth size="small">
                  <InputLabel>Case Record</InputLabel>
                  <Select
                    value={selectedCaseId}
                    label="Case Record"
                    onChange={(event) => setSelectedCaseId(event.target.value)}
                    sx={{ borderRadius: 1, fontSize: 13, bgcolor: '#f8fafc' }}
                  >
                    {caseOptions.map((item) => (
                      <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {priorityBuckets?.enabled && (
                  <FormControlLabel
                    control={<Checkbox checked={usePriorityFilter} onChange={(event) => setUsePriorityFilter(event.target.checked)} size="small" />}
                    label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Use priority bucket filter</Typography>}
                  />
                )}

                <FormControl fullWidth size="small">
                  <InputLabel>Analysis Mode</InputLabel>
                  <Select
                    value={analysisMode}
                    label="Analysis Mode"
                    onChange={(event) => setAnalysisMode(event.target.value)}
                    sx={{ borderRadius: 1, fontSize: 13, bgcolor: '#f8fafc' }}
                  >
                    {ANALYSIS_MODES.map((mode) => (
                      <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => runAssessment()}
                  disabled={!selectedCaseId || loading}
                  sx={{
                    fontWeight: 700,
                    borderRadius: 1,
                    bgcolor: '#0f172a',
                    '&:hover': { bgcolor: '#1e293b' },
                    textTransform: 'none',
                    py: 0.8,
                  }}
                >
                  {loading ? 'Evaluating Patterns...' : 'Run Typology Assessment'}
                </Button>
              </Stack>
            </Paper>

            {/* Integrated Case Snapshot (No nested floating squares) */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 1.5,
                bgcolor: '#ffffff',
                borderColor: '#e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5 }}>
                Entity Profile Snapshot
              </Typography>

              <Stack spacing={1.25}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Case ID</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                    {snapshot.case_id || selectedCaseId || '-'}
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Customer</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                    {snapshot.customer || snapshot.customer_id || '-'}
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Account ID</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>
                    {snapshot.account_id || '-'}
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Suspicious Volume</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>
                    {snapshot.total_suspicious_amount != null
                      ? `₹${Number(snapshot.total_suspicious_amount).toLocaleString('en-IN')}`
                      : '-'}
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Active Alerts</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: snapshot.alert_count > 0 ? '#dc2626' : '#16a34a' }}>
                    {snapshot.alert_count || 0} alert(s)
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Baseline Risk</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                    {snapshot.severity || 'Low'} ({snapshot.risk_score || 0})
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Stack>

          {/* RIGHT COLUMN: Seamless Studio Workbench */}
          <Paper
            variant="outlined"
            sx={{
              borderRadius: 1.5,
              bgcolor: '#ffffff',
              borderColor: '#e2e8f0',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              minHeight: 580,
            }}
          >
            {/* Header Tabs Bar */}
            <Box sx={{ borderBottom: '1px solid #e2e8f0', bgcolor: '#f8fafc', px: 2 }}>
              <Tabs
                value={activeTab}
                onChange={(_, val) => setActiveTab(val)}
                sx={{
                  minHeight: 44,
                  '& .MuiTab-root': {
                    minHeight: 44,
                    fontSize: 12.5,
                    fontWeight: 700,
                    textTransform: 'none',
                    py: 1,
                  },
                }}
              >
                <Tab value="summary" label="Assessment Brief" />
                <Tab value="breakdown" label="Typology Matrix" />
                <Tab value="evidence" label="Forensic Evidence" />
                <Tab value="signals" label="Supporting Signals" />
                <Tab value="guidance" label="Investigator Guidance" />
                <Tab value="notes" label="Analyst Notes" />
                <Tab value="history" label="Audit History" />
              </Tabs>
            </Box>

            {/* Studio Canvas Area */}
            <Box sx={{ p: 3, flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <Box sx={{ py: 10, textAlign: 'center' }}>
                  <CircularProgress size={32} sx={{ color: '#0f172a', mb: 2 }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                    Analyzing Behavioral Patterns...
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: '#64748b', mt: 0.5 }}>
                    Evaluating rapid movement, structuring heuristics, mule retention ratios, and corridor exposures.
                  </Typography>
                </Box>
              ) : !assessment ? (
                <Box sx={{ py: 10, textAlign: 'center' }}>
                  <BrainIcon sx={{ fontSize: 44, color: '#cbd5e1', mb: 1.5 }} />
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    Ready for Typology Intelligence
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: '#64748b', maxWidth: 480, mx: 'auto', mt: 0.5 }}>
                    Select an active investigation case and run assessment to evaluate transaction behavioral alignment.
                  </Typography>
                </Box>
              ) : (
                <>
                  {/* TAB 1: Unified Assessment Brief (Zero nested square boxes) */}
                  {activeTab === 'summary' && (
                    <Stack spacing={3}>
                      {/* Section 1: Executive Assessment Narrative */}
                      <Box>
                        <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1 }}>
                          Executive Synthesis
                        </Typography>
                        <Typography sx={{ fontSize: 13.5, color: '#1e293b', lineHeight: 1.75 }}>
                          {assessment.summary_sections?.assessment_overview ||
                            'Assessment synthesized based on current transaction, alert, and counterparty evidence.'}
                        </Typography>
                      </Box>
                      <Divider sx={{ borderColor: '#f1f5f9' }} />

                      {/* Section 2: Pattern Identification & Detection Rationale */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>
                            Primary Identified Typology
                          </Typography>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', mb: 0.5 }}>
                            {assessment.summary_sections?.primary_typology || 'Standard Profile'}
                          </Typography>
                          <Typography sx={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
                            Supporting: {assessment.summary_sections?.supporting_typologies || 'None Detected'}
                          </Typography>
                        </Box>

                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.75 }}>
                            Detection Rationale
                          </Typography>
                          <Typography sx={{ fontSize: 12.5, color: '#334155', lineHeight: 1.65 }}>
                            {assessment.summary_sections?.why_detected ||
                              'Behavioral signals aligned with known suspicious typology rules.'}
                          </Typography>
                        </Box>
                      </Box>
                      <Divider sx={{ borderColor: '#f1f5f9' }} />

                      {/* Section 3: Key Evidence Signals */}
                      <Box>
                        <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.25 }}>
                          Substantiating Forensic Signals
                        </Typography>
                        <Stack spacing={0.85}>
                          {(assessment.summary_sections?.key_evidence_and_signals || []).map((item, index) => (
                            <Stack key={`signal-${index}`} direction="row" spacing={1.25} alignItems="flex-start">
                              <CheckIcon sx={{ fontSize: 16, color: '#16a34a', mt: 0.3, flexShrink: 0 }} />
                              <Typography sx={{ fontSize: 12.8, color: '#1e293b', lineHeight: 1.5 }}>
                                {item}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                      <Divider sx={{ borderColor: '#f1f5f9' }} />

                      {/* Section 4: Recommended Next Steps */}
                      <Box>
                        <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.25 }}>
                          Recommended Investigative Next Steps
                        </Typography>
                        <Stack spacing={0.85}>
                          {(assessment.summary_sections?.recommended_next_steps || []).map((item, index) => (
                            <Stack key={`step-${index}`} direction="row" spacing={1.25} alignItems="flex-start">
                              <ArrowIcon sx={{ fontSize: 15, color: '#2563eb', mt: 0.3, flexShrink: 0 }} />
                              <Typography sx={{ fontSize: 12.8, color: '#1e293b', lineHeight: 1.5 }}>
                                {item}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                      <Divider sx={{ borderColor: '#f1f5f9' }} />

                      {/* Section 5: Confidence & Limitations Note */}
                      <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1.5, border: '1px solid #e2e8f0' }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>
                          Confidence & Data Governance Scope
                        </Typography>
                        <Stack spacing={0.5}>
                          {(assessment.summary_sections?.confidence_and_limitations || []).map((item, index) => (
                            <Typography key={`limit-${index}`} sx={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>
                              • {item}
                            </Typography>
                          ))}
                        </Stack>
                      </Box>
                    </Stack>
                  )}

                  {/* TAB 2: Typology Matrix & Breakdown Table */}
                  {activeTab === 'breakdown' && <TypologyBreakdownTable rows={assessment.typology_rows} />}

                  {/* TAB 3: Forensic Evidence Panel */}
                  {activeTab === 'evidence' && <TypologyEvidencePanel rows={assessment.typology_rows} />}

                  {/* TAB 4: Supporting Signals */}
                  {activeTab === 'signals' && <SupportingSignalsPanel groups={assessment.supporting_signals} />}

                  {/* TAB 5: Investigator Guidance */}
                  {activeTab === 'guidance' && <InvestigatorGuidancePanel guidance={assessment.investigator_guidance} />}

                  {/* TAB 6: Analyst Notes */}
                  {activeTab === 'notes' && (
                    <Stack spacing={1.5}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        Investigator Review Notes & Assessment Rationale
                      </Typography>
                      <TextField
                        fullWidth
                        multiline
                        minRows={14}
                        value={analystNotes}
                        onChange={(e) => setAnalystNotes(e.target.value)}
                        placeholder="Document observations, customer business validation, counterparty justifications, or escalation decisions..."
                        sx={{
                          bgcolor: '#f8fafc',
                          borderRadius: 1,
                          '& textarea': { fontSize: 13 },
                        }}
                      />
                      <Button
                        variant="contained"
                        onClick={() => handleSave(false)}
                        disabled={saving}
                        sx={{ alignSelf: 'flex-start', fontWeight: 700, borderRadius: 1, bgcolor: '#0f172a', textTransform: 'none' }}
                      >
                        {saving ? 'Saving Notes...' : 'Save Notes'}
                      </Button>
                    </Stack>
                  )}

                  {/* TAB 7: Historical Audit Log */}
                  {activeTab === 'history' && (
                    historyLoading ? (
                      <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                    ) : (
                      <TypologyAssessmentHistory rows={historyRows} />
                    )
                  )}
                </>
              )}
            </Box>
          </Paper>
        </Box>
      </Stack>

      <TypologyGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((prev) => ({ ...prev, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((prev) => ({ ...prev, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default TypologyAnalysisScreen;
