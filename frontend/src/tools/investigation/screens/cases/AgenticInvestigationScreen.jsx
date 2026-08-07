import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Paper, Button,
  List, ListItem, ListItemButton, ListItemText, Chip,
  CircularProgress, Alert, Stack, Accordion, AccordionSummary, AccordionDetails,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
  PlayArrow, Stop, CheckCircle, RadioButtonUnchecked,
  ExpandMore, FiberManualRecord, ShowChart, AttachMoney, Bolt,
  Terminal, ListAlt, Psychology, Description as DescriptionIcon,
  FactCheck, ReportProblem, ArrowForward, HelpOutline, PersonOutline,
  Download, AccountTree, ViewList
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import apiClient from '@services/api';
import PageContainer from '../../layout/PageContainer';

import { useAppContext } from '@context/AppContext';
import { readInvestigationSettings, subscribeInvestigationSettings } from '../../utils/investigationSettings';

// ---- Design tokens, lifted from the existing Case Packs / Priority Inbox screens ----
const ACCENT = '#e8590c';        // PwC orange — primary actions / active tab underline
const BORDER = '#e5e7eb';        // hairline border used on every card
const TEXT_PRIMARY = '#0f172a';
const TEXT_SECONDARY = '#475569';
const SURFACE = '#ffffff';
const SURFACE_MUTED = '#f8fafc';

const cleanMarkdown = (text) => {
  if (!text) return '';
  let cleaned = text.replace(/^#+(?=[^\s#])/gm, (match) => match + ' ');
  cleaned = cleaned.replace(/^(\d+\.\s+[A-Z].*)$/gm, '### $1');
  cleaned = cleaned.replace(/^([A-Z][a-z]+(?: [A-Z][a-z]+)* Summary.*)$/gm, '### $1');
  cleaned = cleaned.replace(/([^\n])\n(\s*\|)/g, '$1\n\n$2');
  return cleaned;
};

const RISK_COLOR = (score) => {
  if (score >= 80) return '#dc2626';
  if (score >= 50) return '#e8590c';
  if (score >= 25) return '#d97706';
  return '#16a34a';
};

const LEVEL_DOT = {
  running: '#2563eb',
  success: '#16a34a',
  error: '#dc2626',
  info: TEXT_SECONDARY,
};

const SEVERITY_STYLE = {
  critical: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  high: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
  medium: { bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  low: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
};

const PRIORITY_STYLE = {
  high: { bg: '#fef2f2', text: '#dc2626' },
  medium: { bg: '#fffbeb', text: '#b45309' },
  low: { bg: SURFACE_MUTED, text: TEXT_SECONDARY },
};

const sectionLabelSx = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: TEXT_SECONDARY,
  textTransform: 'uppercase',
};

const cardSx = {
  border: `1px solid ${BORDER}`,
  borderRadius: 1,
  bgcolor: SURFACE,
  boxShadow: 'none',
};

const TABS = [
  { key: 'analysis', label: 'Analysis Table', icon: ViewList },
  { key: 'overview', label: 'Overview', icon: ShowChart },
  { key: 'log', label: 'Live Log', icon: Terminal },
  { key: 'plan', label: 'Plan', icon: ListAlt },
  { key: 'findings', label: 'Findings', icon: FactCheck },
  { key: 'memory', label: 'Memory', icon: Psychology },
  { key: 'documents', label: 'Documents', icon: DescriptionIcon },
];

const AgenticInvestigationScreen = ({ caseId: initialCaseId }) => {
  const { caseList, ollamaModels } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId || '');
  const [selectedModel, setSelectedModel] = useState(() => (
    readInvestigationSettings()?.assistant?.preferred_model
    || readInvestigationSettings()?.global?.default_model
    || localStorage.getItem('llm_model')
    || 'chatgpt'
  ));
  const [status, setStatus] = useState('not_started');
  const [session, setSession] = useState(null);
  const [plan, setPlan] = useState([]);
  const [memory, setMemory] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [findings, setFindings] = useState(null);
  const [toolLogs, setToolLogs] = useState([]);
  const [llmLogs, setLlmLogs] = useState([]);
  const [trace, setTrace] = useState(null);
  const [selectedStep, setSelectedStep] = useState(null);
  const [activeTab, setActiveTab] = useState('analysis');
  const [recentSessions, setRecentSessions] = useState([]);

  const consoleRef = useRef(null);

  useEffect(() => subscribeInvestigationSettings((next) => {
    const preferred = next?.assistant?.preferred_model || next?.global?.default_model;
    if (preferred && status !== 'running') setSelectedModel(preferred);
  }), [status]);

  const fetchStatus = async () => {
    if (!selectedCaseId) return;
    try {
      const res = await apiClient.get(`/api/v2/agentic/status/${selectedCaseId}`);
      if (res.status !== 'not_started') {
        setStatus(res.session.status);
        setSession(res.session);
        setPlan(res.plan || []);
        setMemory(res.memory || null);
        setDocuments(res.documents || []);
        setFindings(res.findings || null);
        setToolLogs(res.tool_logs || []);
        setLlmLogs(res.llm_logs || []);
        setTrace(res.trace || null);
      }
    } catch (e) {
      console.error('Failed to fetch agentic status', e);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      fetchStatus();
    }
  }, [selectedCaseId]);

  useEffect(() => {
    const fetchSessions = () => {
      apiClient.get('/api/v2/agentic/sessions')
        .then(res => setRecentSessions(res))
        .catch(e => console.error('Failed to fetch recent sessions', e));
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status === 'running' && selectedCaseId) {
      const evtSource = new EventSource(`/api/v2/agentic/stream/${selectedCaseId}`);

      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === 'completed' || data.status === 'failed') {
          setStatus(data.status);
          evtSource.close();
          fetchStatus();
        } else {
          setActivities(prev => [...prev, data]);
          fetchStatus();
        }
      };

      evtSource.onerror = (err) => {
        console.error('EventSource failed:', err);
        evtSource.close();
      };

      return () => evtSource.close();
    }
  }, [status, selectedCaseId]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [activities]);

  const handleStart = async () => {
    try {
      await apiClient.post('/api/v2/agentic/start', { case_id: selectedCaseId, selected_model: selectedModel });
      setStatus('running');
      setActivities([]);
      setTrace(null);
      setActiveTab('log');
      fetchStatus();
    } catch (e) {
      console.error('Full error object:', e);
      alert(`Failed to start investigation: ${e.response?.data?.error || e.message}`);
    }
  };

  const currentStepLabel = session?.current_step || 'Awaiting initialization';
  const riskScore = session?.risk_score || 0;
  const completedSteps = plan.filter(s => s.status === 'completed').length;
  const totalSteps = plan.length || 1;
  const needsRealRun = Boolean(trace?.legacy_or_incomplete);
  const evidenceCount = needsRealRun ? 0 : (findings?.evidence_items?.length || toolLogs.filter(row => row.status === 'success').length || 0);

  const handleDownloadDocument = async (doc) => {
    try {
      const blob = await apiClient.downloadBlob(`/api/v2/agentic/document/${doc.id}/pdf`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(doc.doc_type || 'agentic_document').replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Unable to download document: ${e.message}`);
    }
  };

  return (
    <PageContainer
      title="Agentic Investigation"
      subtitle="Autonomous AI investigation orchestrated by ChatGPT and Nemotron"
      breadcrumbs={['Investigation', 'Agentic Workflow']}
      actions={<Box />}
    >
      <Box sx={{ ...cardSx, overflow: 'hidden' }}>

        {/* Header strip — case identity, status, risk, primary action */}
        <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <select
              value={selectedCaseId}
              onChange={(e) => {
                setSelectedCaseId(e.target.value);
                setStatus('not_started');
                setSession(null);
                setPlan([]);
                setMemory(null);
                setDocuments([]);
                setActivities([]);
                setFindings(null);
                setToolLogs([]);
                setLlmLogs([]);
                setTrace(null);
                setActiveTab('overview');
              }}
              disabled={status === 'running'}
              style={{
                padding: '8px 32px 8px 12px',
                backgroundColor: TEXT_PRIMARY,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.85rem',
                fontWeight: 600,
                outline: 'none',
                cursor: status === 'running' ? 'default' : 'pointer',
              }}
            >
              <option value="" disabled>Select a case...</option>
              {caseList && caseList.length > 0 ? (
                caseList.map((c) => (
                  <option key={c.case_id} value={c.case_id}>{c.case_id}</option>
                ))
              ) : null}
            </select>


              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={status === 'running'}
                style={{
                  padding: '8px 32px 8px 12px',
                  backgroundColor: SURFACE_MUTED,
                  color: TEXT_PRIMARY,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 4,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: status === 'running' ? 'default' : 'pointer',
                }}
              >
                {(ollamaModels || []).map((item) => {
                  const id = typeof item === 'string' ? item : item?.id || item?.name;
                  const label = typeof item === 'string' ? item : item?.label || item?.name;
                  return id ? <option key={id} value={id}>{label}</option> : null;
                })}
                {!ollamaModels?.length ? (
                  <>
                    <option value="chatgpt">OpenAI · gpt-4o-mini</option>
                    <option value="nemotron">OpenRouter · Nemotron</option>
                  </>
                ) : null}
              </select>

              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1.2 }}>
                  Case {selectedCaseId || 'Unselected'}
                </Typography>
                {selectedCaseId && (
                  <Chip
                    label={status.replace('_', ' ').toUpperCase()}
                    size="small"
                    sx={{
                      height: 20,
                      mt: 0.5,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      borderRadius: 0.5,
                      bgcolor: status === 'failed' ? '#fef2f2' : status === 'completed' ? '#f0fdf4' : status === 'running' ? '#eff6ff' : SURFACE_MUTED,
                      color: status === 'failed' ? '#dc2626' : status === 'completed' ? '#16a34a' : status === 'running' ? '#2563eb' : ACCENT,
                      border: `1px solid ${status === 'failed' ? '#fecaca' : status === 'completed' ? '#bbf7d0' : status === 'running' ? '#bfdbfe' : '#fed7aa'}`,
                    }}
                  />
                )}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {status !== 'not_started' && (
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={sectionLabelSx}>Risk score</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, color: riskScore ? RISK_COLOR(riskScore) : TEXT_PRIMARY, lineHeight: 1.2 }}>
                    {riskScore || '—'}
                  </Typography>
                </Box>
              )}

              {(status === 'not_started' || status === 'failed' || status === 'completed') && (
                <Button
                  variant="contained"
                  startIcon={<PlayArrow />}
                  onClick={handleStart}
                  disabled={!selectedCaseId}
                  sx={{
                    bgcolor: ACCENT,
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                    '&:hover': { bgcolor: '#c94a0a', boxShadow: 'none' },
                  }}
                >
                  {needsRealRun ? 'Run Real AI Investigation' : status === 'completed' ? 'Run Again' : status === 'failed' ? 'Run Again' : 'Run Investigation'}
                </Button>
              )}
              {status === 'running' && (
                <Button
                  variant="outlined"
                  startIcon={<Stop />}
                  sx={{
                    color: '#dc2626',
                    borderColor: '#dc2626',
                    textTransform: 'none',
                    fontWeight: 600,
                    '&:hover': { borderColor: '#dc2626', bgcolor: '#fef2f2' },
                  }}
                >
                  Stop
                </Button>
              )}
            </Box>
          </Box>

          {/* Tab bar — same visual pattern as the Case Packs OVERVIEW/EVIDENCE/LEDGER row */}
          <Box sx={{ display: 'flex', gap: 0.5, px: 2.5, borderTop: `1px solid ${BORDER}` }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <Box
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    px: 1.5, py: 1.5,
                    cursor: 'pointer',
                    borderBottom: active ? `2px solid ${ACCENT}` : '2px solid transparent',
                    mb: '-1px',
                  }}
                >
                  <Icon sx={{ fontSize: 17, color: active ? ACCENT : TEXT_SECONDARY }} />
                  <Typography sx={{
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: active ? ACCENT : TEXT_SECONDARY,
                  }}>
                    {tab.label}
                  </Typography>
                  {tab.key === 'plan' && plan.length > 0 && !needsRealRun && (
                    <Chip
                      label={`${completedSteps}/${totalSteps}`}
                      size="small"
                      sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: SURFACE_MUTED, color: TEXT_SECONDARY }}
                    />
                  )}
                  {tab.key === 'findings' && findings?.findings?.length > 0 && (
                    <Chip
                      label={findings.findings.length}
                      size="small"
                      sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: SURFACE_MUTED, color: TEXT_SECONDARY }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>

          <Box sx={{ borderTop: `1px solid ${BORDER}`, p: 2.5, minHeight: 420 }}>
            {needsRealRun && activeTab !== 'analysis' && (
              <Alert
                severity="warning"
                sx={{ mb: 2, borderRadius: 0.5 }}
                action={
                  <Button color="inherit" size="small" onClick={handleStart} startIcon={<PlayArrow />}>
                    Run now
                  </Button>
                }
              >
                This completed session is a legacy or incomplete run. It has {trace?.llm_call_count || 0} recorded LLM calls,
                {` ${trace?.findings_count || 0}`} structured findings, and {trace?.document_count || 0} old documents.
                Run a real AI investigation to generate ChatGPT/Nemotron traces, evidence-backed findings, and full reports.
              </Alert>
            )}

            {/* ---------------- ANALYSIS TABLE ---------------- */}
            {activeTab === 'analysis' && (
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: TEXT_PRIMARY, mb: 3 }}>
                  Recent Agentic Investigations
                </Typography>
                
                {recentSessions.length === 0 ? (
                  <Alert severity="info">No recent agentic investigations found. Select a case from the dropdown above to begin.</Alert>
                ) : (
                  <TableContainer component={Paper} sx={{ ...cardSx, border: `1px solid ${BORDER}` }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: SURFACE_MUTED }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>CASE ID</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>STATUS</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>RISK SCORE</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>LLM MODEL</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>STARTED</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', color: TEXT_SECONDARY }}>COMPLETED</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {recentSessions.map(sess => (
                          <TableRow 
                            key={sess.id} 
                            hover 
                            onClick={() => {
                              setSelectedCaseId(sess.case_id);
                              setActiveTab('overview');
                            }}
                            sx={{ cursor: 'pointer', '&:last-child td, &:last-child th': { border: 0 } }}
                          >
                            <TableCell sx={{ fontWeight: 600, color: TEXT_PRIMARY }}>
                              {sess.case_id}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={sess.status.replace('_', ' ').toUpperCase()}
                                size="small"
                                sx={{
                                  height: 22,
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  borderRadius: 1,
                                  bgcolor: sess.status === 'failed' ? '#fef2f2' : sess.status === 'completed' ? '#f0fdf4' : sess.status === 'running' ? '#eff6ff' : SURFACE_MUTED,
                                  color: sess.status === 'failed' ? '#dc2626' : sess.status === 'completed' ? '#16a34a' : sess.status === 'running' ? '#2563eb' : ACCENT,
                                  border: `1px solid ${sess.status === 'failed' ? '#fecaca' : sess.status === 'completed' ? '#bbf7d0' : sess.status === 'running' ? '#bfdbfe' : '#fed7aa'}`,
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, color: sess.risk_score ? RISK_COLOR(sess.risk_score) : TEXT_SECONDARY }}>
                              {sess.risk_score != null ? sess.risk_score.toFixed(0) : '—'}
                            </TableCell>
                            <TableCell sx={{ fontSize: '0.8rem', color: TEXT_SECONDARY }}>
                              {sess.model || '—'}
                            </TableCell>
                            <TableCell sx={{ fontSize: '0.8rem', color: TEXT_SECONDARY }}>
                              {sess.start_time ? new Date(sess.start_time).toLocaleString() : '—'}
                            </TableCell>
                            <TableCell sx={{ fontSize: '0.8rem', color: TEXT_SECONDARY }}>
                              {sess.end_time ? new Date(sess.end_time).toLocaleString() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            )}

            {/* ---------------- OVERVIEW ---------------- */}
            {activeTab === 'overview' && (
              <Box>
                {status === 'not_started' ? (
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>
                      No investigation has been run for this case yet.
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={3}>

                    {/* Stat row — single bordered strip, divided not boxed */}
                    <Box sx={{ ...cardSx, display: 'flex', flexWrap: 'wrap' }}>
                      <Box sx={{ flex: '1 1 180px', p: 2, borderRight: { xs: 'none', sm: `1px solid ${BORDER}` } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <CheckCircle sx={{ fontSize: 15, color: '#16a34a' }} />
                          <Typography sx={sectionLabelSx}>Steps complete</Typography>
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {needsRealRun ? 'Run Analysis' : `${completedSteps} / ${totalSteps}`}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: '1 1 180px', p: 2, borderRight: { xs: 'none', sm: `1px solid ${BORDER}` } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <Bolt sx={{ fontSize: 15, color: '#2563eb' }} />
                          <Typography sx={sectionLabelSx}>Confidence</Typography>
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {session?.confidence ? `${session.confidence}%` : '—'}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: '1 1 180px', p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <FactCheck sx={{ fontSize: 15, color: TEXT_SECONDARY }} />
                          <Typography sx={sectionLabelSx}>Findings identified</Typography>
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {findings?.findings?.length ?? '—'}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: '1 1 180px', p: 2, borderLeft: { xs: 'none', sm: `1px solid ${BORDER}` } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <AccountTree sx={{ fontSize: 15, color: TEXT_SECONDARY }} />
                          <Typography sx={sectionLabelSx}>Evidence collected</Typography>
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {evidenceCount || '—'}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: '1 1 180px', p: 2, borderLeft: { xs: 'none', sm: `1px solid ${BORDER}` } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                          <Psychology sx={{ fontSize: 15, color: TEXT_SECONDARY }} />
                          <Typography sx={sectionLabelSx}>LLM calls</Typography>
                        </Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {llmLogs.length || '—'}
                        </Typography>
                      </Box>

                      {riskScore > 0 && (
                        <Box sx={{ flex: '1 1 220px', p: 2, borderLeft: { xs: 'none', sm: `1px solid ${BORDER}` } }}>
                          <Typography sx={sectionLabelSx}>Risk score</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                            <Typography variant="h5" sx={{ fontWeight: 700, color: RISK_COLOR(riskScore) }}>
                              {riskScore}
                            </Typography>
                            <Box sx={{ flex: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={riskScore}
                                sx={{
                                  height: 5, borderRadius: 3, bgcolor: SURFACE_MUTED,
                                  '& .MuiLinearProgress-bar': { bgcolor: RISK_COLOR(riskScore), borderRadius: 3 },
                                }}
                              />
                            </Box>
                          </Box>
                        </Box>
                      )}
                    </Box>

                    {/* Highest-severity findings — quiet list, not another box-with-icon */}
                    {findings?.findings?.some(f => f.severity === 'critical' || f.severity === 'high') && (
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
                          <Typography sx={sectionLabelSx}>Highest-severity findings</Typography>
                          <Button
                            size="small"
                            onClick={() => setActiveTab('findings')}
                            endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
                            sx={{ textTransform: 'none', fontSize: '0.75rem', color: ACCENT, minWidth: 0, p: 0 }}
                          >
                            View all
                          </Button>
                        </Box>
                        <Stack spacing={0}>
                          {findings.findings
                            .filter(f => f.severity === 'critical' || f.severity === 'high')
                            .slice(0, 3)
                            .map((f, i, arr) => {
                              const sev = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.medium;
                              return (
                                <Box
                                  key={i}
                                  sx={{
                                    display: 'flex', alignItems: 'center', gap: 1.25,
                                    py: 1.1,
                                    borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none',
                                  }}
                                >
                                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: sev.text, flexShrink: 0 }} />
                                  <Typography variant="body2" sx={{ color: TEXT_PRIMARY, fontWeight: 600, flex: 1 }}>{f.title}</Typography>
                                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', color: sev.text, textTransform: 'uppercase' }}>
                                    {f.severity}
                                  </Typography>
                                </Box>
                                );
                              })}
                          </Stack>
                        </Box>
                      )}

                      {/* Risk Assessment Basis */}
                      {findings?.risk_drivers?.length > 0 && (
                        <Box sx={{ mt: 3 }}>
                          <Typography sx={sectionLabelSx}>Risk Assessment Basis</Typography>
                          <Stack spacing={1.25} sx={{ mt: 1.25 }}>
                            {findings.risk_drivers.map((d, i) => (
                              <Paper key={i} sx={{ ...cardSx, p: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <ReportProblem sx={{ fontSize: 16, color: ACCENT }} />
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>{d.driver}</Typography>
                                </Box>
                                <Typography variant="body2" sx={{ color: TEXT_SECONDARY, lineHeight: 1.6, mb: 1, ml: 3 }}>
                                  {d.explanation}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                        </Box>
                      )}

                    {status === 'running' && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={14} thickness={5} sx={{ color: ACCENT }} />
                        <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>{currentStepLabel}</Typography>
                      </Box>
                    )}
                  </Stack>
                )}
              </Box>
            )}

            {/* ---------------- LIVE LOG ---------------- */}
            {activeTab === 'log' && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Typography sx={sectionLabelSx}>Live investigation log</Typography>
                  {status === 'running' && (
                    <Chip
                      icon={<FiberManualRecord sx={{ fontSize: '10px !important', color: '#2563eb' }} />}
                      label="Running"
                      size="small"
                      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}
                    />
                  )}
                </Box>
                <Box ref={consoleRef} sx={{ ...cardSx, maxHeight: 480, overflowY: 'auto' }}>
                  {activities.length === 0 && status === 'not_started' && (
                    <Typography variant="body2" sx={{ color: TEXT_SECONDARY, p: 2 }}>Awaiting initialization.</Typography>
                  )}
                  {activities.map((act, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, px: 2, py: 1, borderBottom: `1px solid ${BORDER}` }}>
                      <Box sx={{ mt: '6px', width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: LEVEL_DOT[act.level] || TEXT_SECONDARY }} />
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', mt: '1px' }}>
                        {new Date(act.timestamp).toLocaleTimeString()}
                      </Typography>
                      <Typography variant="body2" sx={{ color: TEXT_PRIMARY, fontWeight: act.level === 'running' ? 600 : 400 }}>
                        {act.message}
                      </Typography>
                    </Box>
                  ))}
                  {status === 'running' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25 }}>
                      <CircularProgress size={12} thickness={5} sx={{ color: ACCENT }} />
                      <Typography variant="caption" sx={{ color: TEXT_SECONDARY }}>{currentStepLabel}</Typography>
                    </Box>
                  )}
                </Box>
                {!needsRealRun && toolLogs.length > 0 && (
                  <Box sx={{ mt: 2.5 }}>
                    <Typography sx={{ ...sectionLabelSx, mb: 1.25 }}>Tool execution evidence</Typography>
                    <Stack spacing={1}>
                      {toolLogs.map((row) => (
                        <Paper key={row.id} sx={{ ...cardSx, p: 1.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mb: 0.75 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>
                              {String(row.tool_name || '').replace(/_/g, ' ')}
                            </Typography>
                            <Chip
                              label={(row.status || 'unknown').toUpperCase()}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                bgcolor: row.status === 'success' ? '#f0fdf4' : '#fef2f2',
                                color: row.status === 'success' ? '#16a34a' : '#dc2626',
                              }}
                            />
                          </Box>
                          <Box sx={{ color: TEXT_SECONDARY, typography: 'caption', '& p': { mt: 0, mb: 1 }, '& ul, & ol': { mt: 0, mb: 1, pl: 2 }, '& h1, & h2, & h3': { color: TEXT_PRIMARY, fontWeight: 700, mt: 1.5, mb: 0.5, fontSize: '0.85rem' } }}>
                            <ReactMarkdown>
                              {row.summary || 'No summary captured.'}
                            </ReactMarkdown>
                          </Box>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Box>
            )}

            {/* ---------------- PLAN ---------------- */}
            {activeTab === 'plan' && (
              <Box>
                <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>Investigation plan</Typography>
                {plan.length === 0 && status !== 'not_started' && <CircularProgress size={18} sx={{ color: ACCENT }} />}
                {plan.length === 0 && status === 'not_started' && (
                  <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>
                    The plan will be generated when the investigation starts.
                  </Typography>
                )}
                <List dense disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {plan.map((step, idx) => (
                    <ListItem key={step.id} disablePadding>
                      <ListItemButton
                        onClick={() => setSelectedStep(step)}
                        sx={{
                          px: 1.5, py: 1.25, borderRadius: 0.5,
                          border: `1px solid ${step.status === 'running' ? '#bfdbfe' : BORDER}`,
                          bgcolor: step.status === 'running' ? '#eff6ff' : SURFACE,
                          '&:hover': { bgcolor: SURFACE_MUTED },
                        }}
                      >
                        <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center' }}>
                          {step.status === 'completed' ? (
                            <CheckCircle sx={{ fontSize: 19, color: '#16a34a' }} />
                          ) : step.status === 'running' ? (
                            <CircularProgress size={17} sx={{ color: ACCENT }} />
                          ) : (
                            <RadioButtonUnchecked sx={{ fontSize: 19, color: '#cbd5e1' }} />
                          )}
                        </Box>
                        <ListItemText
                          primary={`${idx + 1}. ${step.action_name}`}
                          secondary={step.description}
                          primaryTypographyProps={{ variant: 'body2', fontWeight: 600, color: TEXT_PRIMARY }}
                          secondaryTypographyProps={{ variant: 'caption', color: TEXT_SECONDARY }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* ---------------- FINDINGS ---------------- */}
            {activeTab === 'findings' && (
              <Box>
                {!findings ? (
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>
                      {needsRealRun
                        ? 'This session did not record real LLM findings. Run a real AI investigation to generate structured findings.'
                        : status === 'completed'
                        ? 'No structured findings were produced for this investigation.'
                        : 'Findings are produced once the investigation completes.'}
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={3.5}>

                    {/* Findings */}
                    <Box>
                      <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                        Findings {findings.findings?.length ? `(${findings.findings.length})` : ''}
                      </Typography>
                      {!findings.findings?.length ? (
                        <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>No findings extracted.</Typography>
                      ) : (
                        <Stack spacing={1.25}>
                          {findings.findings.map((f, i) => {
                            const sev = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.medium;
                            return (
                              <Paper key={i} sx={{ ...cardSx, p: 2, borderLeft: `3px solid ${sev.text}` }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, mb: 0.75 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>{f.title}</Typography>
                                  <Chip
                                    label={(f.severity || 'medium').toUpperCase()}
                                    size="small"
                                    sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, flexShrink: 0, bgcolor: sev.bg, color: sev.text, border: `1px solid ${sev.border}` }}
                                  />
                                </Box>
                                <Typography variant="body2" sx={{ color: TEXT_PRIMARY, lineHeight: 1.6, mb: 1.25 }}>
                                  {f.detail}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  <Chip
                                    label={f.source_tool}
                                    size="small"
                                    sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, bgcolor: SURFACE_MUTED, color: TEXT_SECONDARY }}
                                  />
                                  {f.evidence && (
                                    <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontStyle: 'italic' }}>
                                      "{f.evidence}"
                                    </Typography>
                                  )}
                                </Box>
                              </Paper>
                            );
                          })}
                        </Stack>
                      )}
                    </Box>

                    {/* Evidence */}
                    {findings.evidence_items?.length > 0 && (
                      <Box>
                        <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                          Evidence cards ({findings.evidence_items.length})
                        </Typography>
                        <Stack spacing={1}>
                          {findings.evidence_items.map((item, i) => (
                            <Paper key={i} sx={{ ...cardSx, p: 2 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 0.75 }}>
                                <Chip
                                  label={item.source_tool || 'Evidence'}
                                  size="small"
                                  sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, bgcolor: SURFACE_MUTED, color: TEXT_SECONDARY }}
                                />
                                {item.confidence != null && (
                                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontWeight: 700 }}>
                                    {item.confidence}% confidence
                                  </Typography>
                                )}
                              </Box>
                              <Typography variant="body2" sx={{ color: TEXT_PRIMARY, lineHeight: 1.6 }}>
                                {item.evidence}
                              </Typography>
                              {item.record_id && (
                                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, display: 'block', mt: 0.75 }}>
                                  Record: {item.record_id}
                                </Typography>
                              )}
                            </Paper>
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {/* Risk drivers */}
                    <Box>
                      <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                        Risk drivers {findings.risk_drivers?.length ? `(${findings.risk_drivers.length})` : ''}
                      </Typography>
                      {!findings.risk_drivers?.length ? (
                        <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>No risk drivers extracted.</Typography>
                      ) : (
                        <Stack spacing={1.25}>
                          {findings.risk_drivers.map((d, i) => (
                            <Paper key={i} sx={{ ...cardSx, p: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <ReportProblem sx={{ fontSize: 16, color: ACCENT }} />
                                <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>{d.driver}</Typography>
                              </Box>
                              <Typography variant="body2" sx={{ color: TEXT_SECONDARY, lineHeight: 1.6, mb: 1, ml: 3 }}>
                                {d.explanation}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', ml: 3 }}>
                                <Chip
                                  label={d.source_tool}
                                  size="small"
                                  sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, bgcolor: SURFACE_MUTED, color: TEXT_SECONDARY }}
                                />
                                {d.evidence && (
                                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontStyle: 'italic' }}>
                                    "{d.evidence}"
                                  </Typography>
                                )}
                              </Box>
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </Box>

                    {/* Recommendations */}
                    <Box>
                      <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                        Recommended actions {findings.recommendations?.length ? `(${findings.recommendations.length})` : ''}
                      </Typography>
                      {!findings.recommendations?.length ? (
                        <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>No recommendations extracted.</Typography>
                      ) : (
                        <Stack spacing={1}>
                          {findings.recommendations.map((r, i) => {
                            const pri = PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.medium;
                            return (
                              <Paper key={i} sx={{ ...cardSx, p: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600, color: TEXT_PRIMARY, flex: 1 }}>
                                    {r.action}
                                  </Typography>
                                  <Chip
                                    label={(r.priority || 'medium').toUpperCase()}
                                    size="small"
                                    sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, flexShrink: 0, bgcolor: pri.bg, color: pri.text }}
                                  />
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
                                  <PersonOutline sx={{ fontSize: 15, color: TEXT_SECONDARY }} />
                                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontWeight: 600 }}>{r.owner}</Typography>
                                </Box>
                                {r.rationale && (
                                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, display: 'block', mt: 0.5, lineHeight: 1.5 }}>
                                    {r.rationale}
                                  </Typography>
                                )}
                              </Paper>
                            );
                          })}
                        </Stack>
                      )}
                    </Box>

                    {/* Open questions */}
                    {findings.open_questions?.length > 0 && (
                      <Box>
                        <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                          Open questions ({findings.open_questions.length})
                        </Typography>
                        <Stack spacing={1.25}>
                          {findings.open_questions.map((q, i) => (
                            <Paper key={i} sx={{ ...cardSx, p: 2, bgcolor: SURFACE_MUTED }}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <HelpOutline sx={{ fontSize: 17, color: TEXT_SECONDARY, mt: 0.1, flexShrink: 0 }} />
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 600, color: TEXT_PRIMARY }}>{q.question}</Typography>
                                  {q.why_it_matters && (
                                    <Typography variant="caption" sx={{ color: TEXT_SECONDARY, display: 'block', mt: 0.5 }}>
                                      Why it matters: {q.why_it_matters}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                            </Paper>
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {findings.timeline?.length > 0 && (
                      <Box>
                        <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>
                          Investigation timeline ({findings.timeline.length})
                        </Typography>
                        <Stack spacing={0}>
                          {findings.timeline.map((item, i) => (
                            <Box
                              key={i}
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: '160px 1fr' },
                                gap: 1.5,
                                py: 1.25,
                                borderBottom: i < findings.timeline.length - 1 ? `1px solid ${BORDER}` : 'none',
                              }}
                            >
                              <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontVariantNumeric: 'tabular-nums' }}>
                                {item.timestamp || '-'}
                              </Typography>
                              <Box>
                                <Typography variant="body2" sx={{ color: TEXT_PRIMARY, fontWeight: 600 }}>
                                  {item.event}
                                </Typography>
                                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, display: 'block', mt: 0.25 }}>
                                  {item.source_tool || 'evidence'}{item.evidence ? ` - ${item.evidence}` : ''}
                                </Typography>
                              </Box>
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    )}

                  </Stack>
                )}
              </Box>
            )}

            {/* ---------------- MEMORY ---------------- */}
            {activeTab === 'memory' && (
              <Box>
                <Typography sx={sectionLabelSx}>Cumulative memory</Typography>
                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, display: 'block', mt: 0.5, mb: 1.5 }}>
                  Live summary of evidence collected across all tools.
                </Typography>
                <Box sx={{
                  bgcolor: SURFACE_MUTED, border: `1px solid ${BORDER}`, p: 2, borderRadius: 0.5,
                  minHeight: 300, color: TEXT_SECONDARY, typography: 'body2',
                  '& p': { mt: 0, mb: 1.5, lineHeight: 1.7 }, '& ul, & ol': { mt: 0, mb: 1.5, pl: 2, lineHeight: 1.7 },
                  '& h1, & h2, & h3': { color: TEXT_PRIMARY, fontWeight: 700, mt: 2.5, mb: 1 }
                }}>
                  {memory ? <ReactMarkdown>{memory.memory_text}</ReactMarkdown> : 'Memory is empty.'}
                </Box>
                {llmLogs.length > 0 && (
                  <Box sx={{ mt: 2.5 }}>
                    <Typography sx={{ ...sectionLabelSx, mb: 1.25 }}>LLM activity</Typography>
                    <Stack spacing={1}>
                      {llmLogs.map((row) => (
                        <Paper key={row.id} sx={{ ...cardSx, p: 1.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>
                              {row.stage}
                            </Typography>
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY }}>
                              {row.provider} / {row.model}
                            </Typography>
                          </Box>
                          {row.metadata?.latency_ms != null && (
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY }}>
                              {row.metadata.latency_ms} ms · {row.metadata.prompt_chars || 0} prompt chars · {row.metadata.response_chars || 0} response chars
                            </Typography>
                          )}
                          {(row.prompt_preview || row.response_preview) && (
                            <Accordion sx={{ mt: 1, border: `1px solid ${BORDER}`, boxShadow: 'none', '&:before': { display: 'none' } }} disableGutters>
                              <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>
                                  Prompt and response trace
                                </Typography>
                              </AccordionSummary>
                              <AccordionDetails sx={{ borderTop: `1px solid ${BORDER}`, p: 1.5 }}>
                                <Typography sx={{ ...sectionLabelSx, mb: 0.75 }}>Prompt</Typography>
                                <Box sx={{ bgcolor: SURFACE_MUTED, p: 1.25, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                                  {row.prompt_preview || 'Prompt not captured.'}
                                </Box>
                                <Typography sx={{ ...sectionLabelSx, mt: 1.5, mb: 0.75 }}>Response</Typography>
                                <Box sx={{ bgcolor: SURFACE_MUTED, p: 1.25, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                                  {row.response_preview || 'Response not captured.'}
                                </Box>
                              </AccordionDetails>
                            </Accordion>
                          )}
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Box>
            )}

            {/* ---------------- DOCUMENTS ---------------- */}
            {activeTab === 'documents' && (
              <Box>
                <Typography sx={{ ...sectionLabelSx, mb: 1.5 }}>Generated documents</Typography>
                {documents.length === 0 ? (
                  <Typography variant="body2" sx={{ color: TEXT_SECONDARY }}>
                    {needsRealRun
                      ? 'Legacy placeholder documents are hidden. Run a real AI investigation to generate full downloadable reports.'
                      : 'Documents will appear here once the investigation completes.'}
                  </Typography>
                ) : (
                  <Stack spacing={1.25}>
                    {documents.map((doc) => (
                      <Accordion key={doc.id} sx={{ ...cardSx, '&:before': { display: 'none' } }} disableGutters>
                        <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 1 } }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, width: '100%', pr: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: TEXT_PRIMARY }}>{doc.doc_type}</Typography>
                            <Button
                              size="small"
                              startIcon={<Download sx={{ fontSize: 15 }} />}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDownloadDocument(doc);
                              }}
                              sx={{ textTransform: 'none', color: ACCENT, fontWeight: 600 }}
                            >
                              PDF
                            </Button>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails sx={{ borderTop: `1px solid ${BORDER}`, p: 2.5 }}>
                            <Box sx={{
                              color: TEXT_PRIMARY, typography: 'body2',
                              '& p': { mt: 0, mb: 1.5, lineHeight: 1.7 }, '& ul, & ol': { mt: 0, mb: 1.5, pl: 2.5, lineHeight: 1.7 },
                              '& h1, & h2, & h3, & h4': { 
                                color: '#fff', 
                                bgcolor: ACCENT, 
                                fontWeight: 700, 
                                mt: 3, 
                                mb: 1.5, 
                                p: 1, 
                                borderRadius: 0.5 
                              },
                              '& h1': { fontSize: '1.25rem' }, '& h2': { fontSize: '1.1rem' }, '& h3': { fontSize: '0.95rem' },
                              '& hr': { my: 2, borderColor: BORDER },
                              '& table': { width: '100%', borderCollapse: 'collapse', mb: 2 },
                              '& th, & td': { border: `1px solid ${BORDER}`, p: 1, textAlign: 'left' },
                              '& th': { bgcolor: SURFACE_MUTED, fontWeight: 700 }
                            }}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanMarkdown(doc.content)}</ReactMarkdown>
                            </Box>
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

          </Box>
        </Box>

      {/* Step detail dialog */}
      <Dialog open={Boolean(selectedStep)} onClose={() => setSelectedStep(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 1 } }}>
        <DialogTitle sx={{ borderBottom: `1px solid ${BORDER}`, fontWeight: 700 }}>
          {selectedStep?.action_name}
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Typography sx={sectionLabelSx}>Description</Typography>
          <Typography variant="body2" sx={{ mb: 2.5, mt: 0.5 }}>{selectedStep?.description}</Typography>

          <Typography sx={sectionLabelSx}>Status</Typography>
          <Box sx={{ mt: 0.75, mb: 2.5 }}>
            <Chip
              label={selectedStep?.status?.toUpperCase()}
              size="small"
              sx={{
                fontWeight: 700, fontSize: '0.7rem',
                bgcolor: selectedStep?.status === 'completed' ? '#f0fdf4' : '#eff6ff',
                color: selectedStep?.status === 'completed' ? '#16a34a' : '#2563eb',
                border: `1px solid ${selectedStep?.status === 'completed' ? '#bbf7d0' : '#bfdbfe'}`,
              }}
            />
          </Box>

          <Typography sx={sectionLabelSx}>Agent findings</Typography>
          <Box sx={{
            mt: 0.75, p: 1.5, bgcolor: SURFACE_MUTED, border: `1px solid ${BORDER}`,
            borderRadius: 0.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
            fontSize: '0.8rem', lineHeight: 1.6,
          }}>
            {selectedStep?.result_summary || 'No findings recorded yet.'}
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${BORDER}`, p: 2 }}>
          <Button onClick={() => setSelectedStep(null)} sx={{ textTransform: 'none', color: TEXT_PRIMARY }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};

export default AgenticInvestigationScreen;
