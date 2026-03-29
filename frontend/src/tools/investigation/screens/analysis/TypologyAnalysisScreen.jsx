import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
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

const SummarySection = ({ title, children }) => (
  <Paper variant="outlined" sx={{ p: 1.9, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 14.2, fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
    <Box sx={{ mt: 1 }}>{children}</Box>
  </Paper>
);

const EmptyState = () => (
  <Paper variant="outlined" sx={{ p: 5, borderRadius: 2.5, textAlign: 'center' }}>
    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Select a case to begin typology intelligence assessment</Typography>
    <Typography sx={{ mt: 1.1, fontSize: 13.2, color: '#64748b', maxWidth: 760, mx: 'auto', lineHeight: 1.8 }}>
      This module helps investigators understand whether the visible case behavior aligns with known suspicious patterns such as mule activity, structuring, layering, funnel behavior, pass-through use, or high-risk corridor exposure.
    </Typography>
  </Paper>
);

const TypologyAnalysisScreen = () => {
  const { caseList, loadCaseList, activeCaseId, priorityBuckets, getFilteredCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisMode, setAnalysisMode] = useState('balanced');
  const [usePriorityFilter, setUsePriorityFilter] = useState(true);
  const [centerTab, setCenterTab] = useState('summary');
  const [rightTab, setRightTab] = useState('snapshot');
  const [guideOpen, setGuideOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [assessment, setAssessment] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [analystNotes, setAnalystNotes] = useState('');
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });

  const displayCases = usePriorityFilter && priorityBuckets?.enabled ? getFilteredCaseList() : (caseList || []);

  useEffect(() => {
    loadCaseList();
  }, [loadCaseList]);

  useEffect(() => {
    if (selectedCaseId || !displayCases.length) return;
    const preferred = String(activeCaseId || displayCases[0]?.case_id || displayCases[0]?.caseid || displayCases[0]?.id || '');
    if (preferred) setSelectedCaseId(preferred);
  }, [activeCaseId, displayCases, selectedCaseId]);

  const caseOptions = useMemo(() => (displayCases || []).map((item, index) => {
    const caseId = String(item.case_id || item.caseid || item.id || `CASE-${index}`);
    return {
      value: caseId,
      label: `${caseId}${item.customer_id ? ` | ${item.customer_id}` : ''}`,
    };
  }), [displayCases]);

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
    apiClient.getSavedTypologyAssessment(selectedCaseId)
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

  return (
    <PageContainer
      title="Typology Intelligence"
      subtitle="Assess whether visible case behavior aligns with known AML and fraud patterns using explainable pattern scoring and supporting evidence."
      breadcrumbs={['Analysis', 'Typology Intelligence']}
      actions={(
        <Stack direction="row" spacing={1.1}>
          <Button size="small" variant="outlined" startIcon={<GuideIcon />} onClick={() => setGuideOpen(true)}>Guide</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => assessment && downloadJson(`typology_intelligence_${selectedCaseId}.json`, assessment)} disabled={!assessment}>Export</Button>
          <Button size="small" variant="outlined" startIcon={<AddToReportIcon />} onClick={() => handleSave(true)} disabled={!assessment || saving}>Add to Report</Button>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => runAssessment()} disabled={!selectedCaseId || loading}>Re-run Analysis</Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => handleSave(false)} disabled={!assessment || saving}>Save Assessment</Button>
        </Stack>
      )}
    >
      <Stack spacing={2.5}>
        <TypologySummaryBar summary={assessment?.summary_bar} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '300px minmax(0, 1fr) 340px' }, gap: 2 }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Assessment Controls</Typography>
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Case</InputLabel>
                  <Select value={selectedCaseId} label="Case" onChange={(event) => setSelectedCaseId(event.target.value)}>
                    {caseOptions.map((item) => (
                      <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {priorityBuckets?.enabled ? (
                  <FormControlLabel
                    control={<Checkbox checked={usePriorityFilter} onChange={(event) => setUsePriorityFilter(event.target.checked)} size="small" />}
                    label={<Typography sx={{ fontSize: 12.4, fontWeight: 600 }}>Use current case bucket filter</Typography>}
                  />
                ) : null}

                <FormControl fullWidth size="small">
                  <InputLabel>Analysis Mode</InputLabel>
                  <Select value={analysisMode} label="Analysis Mode" onChange={(event) => setAnalysisMode(event.target.value)}>
                    {ANALYSIS_MODES.map((mode) => (
                      <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Button variant="contained" onClick={() => runAssessment()} disabled={!selectedCaseId || loading}>
                  {loading ? 'Running Assessment...' : 'Run Typology Assessment'}
                </Button>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>What this module helps answer</Typography>
              <Stack spacing={0.8} sx={{ mt: 1.3 }}>
                {[
                  'What suspicious behavioral pattern is visible in the case',
                  'Why the pattern is being detected',
                  'What evidence supports or weakens that view',
                  'How strongly the current case aligns to known typologies',
                  'What the investigator should verify next',
                ].map((item) => (
                  <Typography key={item} sx={{ fontSize: 12.6, color: '#334155', lineHeight: 1.55 }}>{item}</Typography>
                ))}
              </Stack>
            </Paper>
          </Stack>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Tabs value={centerTab} onChange={(_, value) => setCenterTab(value)} sx={{ px: 1.5, pt: 1 }}>
                <Tab value="summary" label="Summary" />
                <Tab value="breakdown" label="Typology Breakdown" />
                <Tab value="evidence" label="Evidence" />
                <Tab value="signals" label="Supporting Signals" />
                <Tab value="guidance" label="Investigator Guidance" />
                <Tab value="history" label="History" />
              </Tabs>
            </Paper>

            {!selectedCaseId && !loading ? <EmptyState /> : null}
            {loading ? (
              <Paper variant="outlined" sx={{ p: 5, borderRadius: 2.5, textAlign: 'center' }}>
                <CircularProgress size={34} />
                <Typography sx={{ mt: 1.5, fontSize: 13.5, color: '#475569' }}>Running typology intelligence assessment...</Typography>
              </Paper>
            ) : null}

            {!loading && assessment ? (
              <>
                {centerTab === 'summary' ? (
                  <Stack spacing={1.4}>
                    <SummarySection title="Typology Assessment Overview">
                      <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>{assessment.summary_sections?.assessment_overview}</Typography>
                    </SummarySection>
                    <SummarySection title="Primary Typology">
                      <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>{assessment.summary_sections?.primary_typology}</Typography>
                    </SummarySection>
                    <SummarySection title="Supporting Typologies">
                      <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>{assessment.summary_sections?.supporting_typologies}</Typography>
                    </SummarySection>
                    <SummarySection title="Why this pattern was detected">
                      <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>{assessment.summary_sections?.why_detected}</Typography>
                    </SummarySection>
                    <SummarySection title="Key evidence and signals">
                      <Stack spacing={0.65}>
                        {(assessment.summary_sections?.key_evidence_and_signals || []).map((item, index) => (
                          <Typography key={`signal-${index}`} sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.6 }}>{item}</Typography>
                        ))}
                      </Stack>
                    </SummarySection>
                    <SummarySection title="Recommended next steps">
                      <Stack spacing={0.65}>
                        {(assessment.summary_sections?.recommended_next_steps || []).map((item, index) => (
                          <Typography key={`step-${index}`} sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.6 }}>{item}</Typography>
                        ))}
                      </Stack>
                    </SummarySection>
                    <SummarySection title="Confidence and limitations">
                      <Stack spacing={0.65}>
                        {(assessment.summary_sections?.confidence_and_limitations || []).map((item, index) => (
                          <Typography key={`limit-${index}`} sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.6 }}>{item}</Typography>
                        ))}
                      </Stack>
                    </SummarySection>
                  </Stack>
                ) : null}
                {centerTab === 'breakdown' ? <TypologyBreakdownTable rows={assessment.typology_rows} /> : null}
                {centerTab === 'evidence' ? <TypologyEvidencePanel rows={assessment.typology_rows} /> : null}
                {centerTab === 'signals' ? <SupportingSignalsPanel groups={assessment.supporting_signals} /> : null}
                {centerTab === 'guidance' ? <InvestigatorGuidancePanel guidance={assessment.investigator_guidance} /> : null}
                {centerTab === 'history' ? (
                  historyLoading ? (
                    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5 }}><CircularProgress size={26} /></Paper>
                  ) : (
                    <TypologyAssessmentHistory rows={historyRows} />
                  )
                ) : null}
              </>
            ) : null}
          </Stack>

          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Tabs value={rightTab} onChange={(_, value) => setRightTab(value)} sx={{ px: 1.5, pt: 1 }}>
                <Tab value="snapshot" label="Case Snapshot" />
                <Tab value="notes" label="Notes" />
                <Tab value="report" label="Report Snippets" />
                <Tab value="limitations" label="Limitations" />
              </Tabs>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, minHeight: 420 }}>
              {rightTab === 'snapshot' ? <TypologyCaseSnapshot snapshot={assessment?.case_snapshot} /> : null}
              {rightTab === 'notes' ? (
                <Stack spacing={1.2}>
                  <Typography sx={{ fontSize: 14.4, fontWeight: 800, color: '#0f172a' }}>Assessment Notes</Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={15}
                    value={analystNotes}
                    onChange={(event) => setAnalystNotes(event.target.value)}
                    placeholder="Capture typology review notes, validation comments, or escalation rationale."
                  />
                </Stack>
              ) : null}
              {rightTab === 'report' ? <TypologyReportSnippetsPanel snippets={assessment?.report_snippets} /> : null}
              {rightTab === 'limitations' ? (
                <Stack spacing={0.8}>
                  {(assessment?.summary_sections?.confidence_and_limitations || [assessment?.limitations_note]).filter(Boolean).map((item, index) => (
                    <Typography key={`limitation-${index}`} sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.65 }}>{item}</Typography>
                  ))}
                </Stack>
              ) : null}
            </Paper>
          </Stack>
        </Box>

        {assessment && assessment.primary_typology?.confidence === 'Limited Evidence' ? (
          <Alert severity="info" sx={{ border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
            Limited evidence is available for the current case. Treat this typology assessment as investigation guidance rather than a decision-ready conclusion.
          </Alert>
        ) : null}
      </Stack>

      <TypologyGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default TypologyAnalysisScreen;
