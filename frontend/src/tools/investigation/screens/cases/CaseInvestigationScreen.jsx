// src/tools/investigation/screens/case/CaseInvestigationScreen.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import { mergeFccSentinelHandoff, readFccSentinelHandoff } from '../../../../utils/fccSentinelHandoff';

import PageContainer from '@investigation-layout/PageContainer';
import CopilotManual from '@investigation/components/guide/CopilotManual';
import { FormattedMarkdown } from '@investigation/components/FormattedMarkdown';

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

import {
  AutoAwesome as AutoAwesomeIcon,
  Bolt as BoltIcon,
  Check as CheckIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
  DeleteOutline as DeleteOutlineIcon,
  Description as FileTextIcon,
  ErrorOutline as ErrorIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  FilterList as FilterListIcon,
  HelpOutline,
  Notifications as NotificationsIcon,
  Person as PersonIcon,
  Refresh as RefreshIcon,
  Security as ShieldIcon,
  Send as SendIcon,
  Timeline as TimelineIcon,
  TrendingUp as TrendingUpIcon,
  VerifiedUser as VerifiedIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';

const RISK_TIER_CONFIG = (score) => {
  if (score >= 80) {
    return {
      label: 'HIGH RISK',
      color: '#dc2626',
      bg: '#fef2f2',
      border: '#fecaca',
    };
  }
  if (score >= 40) {
    return {
      label: 'MEDIUM RISK',
      color: '#d97706',
      bg: '#fffbeb',
      border: '#fde68a',
    };
  }
  return {
    label: 'LOW RISK',
    color: '#059669',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  };
};

const CaseInvestigationScreen = () => {
  const {
    caseList,
    loadCaseList,
    caseScope,
    getFilteredCaseList,
  } = useAppContext();

  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    risk: true,
    alerts: true,
    transactions: true,
  });

  const [showManual, setShowManual] = useState(false);

  const chatEndRef = useRef(null);
  const workflowSessionRef = useRef(null);
  const displayCases = getFilteredCaseList();
  const activeHandoff = readFccSentinelHandoff();

  useEffect(() => {
    if (!caseList || caseList.length === 0) loadCaseList();
  }, []);

  useEffect(() => {
    let active = true;
    apiClient.getFccWorkflowSession()
      .then((res) => {
        const session = res?.session || null;
        if (!active || !session) return;
        workflowSessionRef.current = session;
        const restoredCaseId = String(
          session?.selected_case_id
          || session?.current_state?.selected_case_id
          || session?.handoff_summary?.selected_case_id
          || ''
        ).trim();
        if (restoredCaseId) {
          setSelectedCaseId((prev) => prev || restoredCaseId);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const getCaseId = (c) => c.case_id || c.caseid || c.Case_ID || c.id;

  const handleCaseSelect = async (id) => {
    setSelectedCaseId(id);
    setLoading(true);
    setMessages([]);
    setFacts(null);
    mergeFccSentinelHandoff({
      selected_case_id: id,
      preferred_screen: 'investigate',
    });

    apiClient.saveFccWorkflowSession({
      session_id: workflowSessionRef.current?.session_id || activeHandoff?.workflow_session_id || undefined,
      pipeline_id: activeHandoff?.pipeline_id || undefined,
      pipeline_name: activeHandoff?.pipeline_name || undefined,
      run_id: activeHandoff?.run_id || undefined,
      deployment_id: activeHandoff?.deployment_id || undefined,
      publish_id: activeHandoff?.publish_id || undefined,
      current_module: 'investigation',
      current_step: 'investigate',
      current_state: {
        preferred_screen: 'investigate',
        selected_case_id: id,
      },
      selected_case_id: id,
      handoff_summary: activeHandoff || undefined,
      mark_current_stable: true,
      status: 'sentinel_ready',
    }).then((res) => {
      workflowSessionRef.current = res?.session || workflowSessionRef.current;
      if (res?.session?.session_id) {
        mergeFccSentinelHandoff({
          workflow_session_id: res.session.session_id,
          selected_case_id: id,
          preferred_screen: 'investigate',
        });
      }
    }).catch(() => {});

    try {
      const res = await apiClient.get(`/api/v2/case/${id}/facts`);
      if (res.success && res.facts) {
        setFacts(res.facts);
        setMessages([
          {
            role: 'system',
            caseId: id,
            facts: res.facts,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      setMessages([
        {
          role: 'error',
          content: `Failed to load case facts: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || generating) return;

    const userMsg = { role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '', streaming: true, timestamp: new Date() }]);
    setInput('');
    setGenerating(true);
    setStreamStarted(false);

    try {
      const token = localStorage.getItem('auth_token');
      const activeEnv = sessionStorage.getItem('active_env');
      const selectedModel = localStorage.getItem('llm_model');
      const response = await fetch(`/api/v2/case/${selectedCaseId}/copilot/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(activeEnv ? { 'X-Environment-ID': activeEnv } : {}),
          ...(selectedModel ? { 'X-LLM-Model': selectedModel } : {}),
        },
        body: JSON.stringify({ question: text, context: facts }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Unable to start Copilot stream (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const rawEvent of events) {
          const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim());
          if (rawEvent.includes('event: token')) {
            setStreamStarted(true);
            setMessages((prev) => {
              const next = [...prev];
              const index = next.length - 1;
              if (next[index]?.role === 'assistant') {
                next[index] = { ...next[index], content: `${next[index].content || ''}${payload.token || ''}` };
              }
              return next;
            });
          } else if (rawEvent.includes('event: error')) {
            throw new Error(payload.error || 'Copilot stream failed');
          } else if (rawEvent.includes('event: done')) {
            finished = true;
          }
        }
        if (done) finished = true;
      }
      setMessages((prev) => {
        const next = [...prev];
        const index = next.length - 1;
        if (next[index]?.role === 'assistant') next[index] = { ...next[index], streaming: false };
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const index = next.length - 1;
        if (next[index]?.role === 'assistant' && !next[index].content) {
          next[index] = { ...next[index], role: 'error', content: `Error: ${err.message}`, streaming: false };
          return next;
        }
        return [...next, { role: 'error', content: `Error: ${err.message}`, timestamp: new Date() }];
      });
    } finally {
      setGenerating(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleCopy = (text, idx) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleClearChat = () => {
    if (!facts) {
      setMessages([]);
      return;
    }
    setMessages([
      {
        role: 'system',
        caseId: selectedCaseId,
        facts,
        timestamp: new Date(),
      },
    ]);
  };

  const handleExportReport = async () => {
    setExportingReport(true);
    try {
      const handoff = readFccSentinelHandoff();
      const blob = await apiClient.post(
        '/api/v2/case-report/handoff/pdf',
        {
          handoff: handoff || {},
          audience: 'technical',
          strict_min_pages: true,
        },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(handoff?.pipeline_name || selectedCaseId || 'sentinel_handoff').replace(/[^a-zA-Z0-9_-]+/g, '_')}_sentinel_report.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'error',
          content: `Report export failed: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setExportingReport(false);
    }
  };

  useEffect(() => {
    if (!displayCases || displayCases.length === 0) return;
    const selectedStillVisible = displayCases.some((item) => getCaseId(item) === selectedCaseId);
    if (selectedCaseId && selectedStillVisible) return;
    const restoredCaseId = String(
      workflowSessionRef.current?.selected_case_id
      || workflowSessionRef.current?.current_state?.selected_case_id
      || activeHandoff?.selected_case_id
      || ''
    ).trim();
    const preferredVisibleCase = restoredCaseId
      ? displayCases.find((item) => getCaseId(item) === restoredCaseId)
      : null;
    const nextCaseId = getCaseId(preferredVisibleCase || displayCases[0]);
    if (nextCaseId) handleCaseSelect(nextCaseId);
  }, [displayCases, selectedCaseId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const riskScore = Number(facts?.risk?.risk_score || 0);
  const tier = RISK_TIER_CONFIG(riskScore);

  return (
    <>
      <CopilotManual open={showManual} onClose={() => setShowManual(false)} />

      <PageContainer
        title="AI Copilot Investigation"
        subtitle="Evidence-grounded conversational intelligence & forensic case narrative copilot"
        breadcrumbs={['Investigation', 'AI Copilot']}
        actions={(
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Button
              variant="text"
              startIcon={<HelpOutline />}
              onClick={() => setShowManual(true)}
              size="small"
              sx={{ color: '#475569', fontWeight: 600, textTransform: 'none' }}
            >
              Guide
            </Button>

            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

            {selectedCaseId && (
              <Chip
                label={`Case: ${selectedCaseId}`}
                size="small"
                sx={{
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  bgcolor: '#f1f5f9',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  height: 28,
                  fontSize: '0.75rem',
                }}
              />
            )}

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={() => selectedCaseId && handleCaseSelect(selectedCaseId)}
              disabled={!selectedCaseId || loading}
              sx={{
                fontWeight: 600,
                textTransform: 'none',
                borderColor: '#cbd5e1',
                color: '#334155',
                '&:hover': { borderColor: '#94a3b8', bgcolor: '#f8fafc' },
              }}
            >
              Reload
            </Button>

            <Button
              variant="contained"
              size="small"
              disableElevation
              startIcon={<FileTextIcon />}
              disabled={exportingReport || !facts}
              onClick={handleExportReport}
              sx={{
                bgcolor: '#ea580c',
                color: '#ffffff',
                fontWeight: 600,
                textTransform: 'none',
                '&:hover': { bgcolor: '#c2410c' },
              }}
            >
              {exportingReport ? 'Preparing Report...' : 'Export Report'}
            </Button>
          </Stack>
        )}
      >
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', borderRadius: 2, border: '1px solid #e2e8f0', bgcolor: '#ffffff' }}>
          {/* ======================================================== */}
          {/* LEFT SIDEBAR: Case Dossier & Empirical Signals */}
          {/* ======================================================== */}
          <Paper
            elevation={0}
            sx={{
              width: { xs: '100%', md: 290, lg: 320, xl: 350 },
              flexShrink: 0,
              borderRight: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              bgcolor: '#ffffff',
            }}
          >
            {/* Active Case Selector */}
            <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0', bgcolor: '#f8fafc' }}>
              <Typography
                sx={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: '#475569',
                  textTransform: 'uppercase',
                  mb: 1.25,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                }}
              >
                <ShieldIcon sx={{ fontSize: 13, color: '#ea580c' }} />
                Active Investigation Dossier
              </Typography>

              <FormControl fullWidth size="small">
                <Select
                  value={selectedCaseId}
                  onChange={(e) => handleCaseSelect(e.target.value)}
                  displayEmpty
                  sx={{
                    bgcolor: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    borderRadius: 1.5,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#94a3b8' },
                  }}
                >
                  <MenuItem value="">
                    <em>Select active case...</em>
                  </MenuItem>
                  {displayCases.map((c, i) => (
                    <MenuItem key={i} value={getCaseId(c)} sx={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>
                      {getCaseId(c)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Scoped queue subtle metadata badge */}
              {caseScope.type !== 'GLOBAL' && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.25,
                    bgcolor: '#ffffff',
                    borderRadius: 1.5,
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <FilterListIcon sx={{ fontSize: 16, color: '#ea580c' }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                      {activeHandoff?.pipeline_name
                        ? `Retained: ${activeHandoff.pipeline_name}`
                        : 'Scoped FCC Investigation Queue'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.68rem', color: '#64748b' }}>
                      {caseScope.caseCount} cases in active queue
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Case Facts Summary (Scrollable) */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              {!selectedCaseId ? (
                <Box sx={{ py: 6, textAlign: 'center', color: '#64748b' }}>
                  <Typography variant="body2" sx={{ fontSize: '0.82rem' }}>
                    Select an active case from the dropdown above to inspect empirical signals.
                  </Typography>
                </Box>
              ) : !facts && !loading ? (
                <Box sx={{ py: 6, textAlign: 'center', color: '#64748b' }}>
                  <Typography variant="body2" sx={{ fontSize: '0.82rem' }}>
                    No telemetry facts loaded.
                  </Typography>
                </Box>
              ) : loading ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <CircularProgress size={24} sx={{ color: '#ea580c' }} />
                </Box>
              ) : (
                <Stack spacing={2}>
                  {/* Executive Risk Index Card */}
                  <Card variant="outlined" sx={{ borderRadius: 2, borderColor: '#e2e8f0', boxShadow: 'none' }}>
                    <Box
                      onClick={() => toggleSection('risk')}
                      sx={{
                        p: 1.5,
                        bgcolor: '#f8fafc',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: expandedSections.risk ? '1px solid #e2e8f0' : 'none',
                        '&:hover': { bgcolor: '#f1f5f9' },
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        <TimelineIcon sx={{ fontSize: 14, color: tier.color }} />
                        Composite Risk Index
                      </Typography>
                      <IconButton size="small" sx={{ p: 0.25 }}>
                        {expandedSections.risk ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                    </Box>

                    {expandedSections.risk && (
                      <CardContent sx={{ p: 2 }}>
                        {/* Score row */}
                        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                          <Box>
                            <Typography sx={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                              Risk Score
                            </Typography>
                            <Stack direction="row" alignItems="baseline" spacing={0.5}>
                              <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: tier.color, lineHeight: 1 }}>
                                {riskScore}
                              </Typography>
                              <Typography sx={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                                / 100
                              </Typography>
                            </Stack>
                          </Box>

                          <Box sx={{ textAlign: 'right' }}>
                            <Box
                              sx={{
                                px: 1.25,
                                py: 0.5,
                                bgcolor: tier.bg,
                                border: '1px solid',
                                borderColor: tier.border,
                                borderRadius: 1.5,
                                display: 'inline-block',
                              }}
                            >
                              <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: tier.color }}>
                                {tier.label}
                              </Typography>
                            </Box>
                          </Box>
                        </Stack>

                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, Math.max(0, riskScore))}
                          sx={{
                            height: 6,
                            borderRadius: 1,
                            bgcolor: '#e2e8f0',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: tier.color,
                              borderRadius: 1,
                            },
                          }}
                        />

                        {/* KYC & Segment Grid */}
                        <Grid container spacing={1} sx={{ mt: 1.5 }}>
                          <Grid item xs={6}>
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1,
                                textAlign: 'center',
                                bgcolor: '#f8fafc',
                                borderColor: '#e2e8f0',
                                borderRadius: 1.5,
                              }}
                            >
                              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                KYC Status
                              </Typography>
                              <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center" sx={{ mt: 0.25 }}>
                                <VerifiedIcon sx={{ fontSize: 12, color: '#059669' }} />
                                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>
                                  {facts.risk.kyc_status || 'Verified'}
                                </Typography>
                              </Stack>
                            </Paper>
                          </Grid>
                          <Grid item xs={6}>
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1,
                                textAlign: 'center',
                                bgcolor: '#f8fafc',
                                borderColor: '#e2e8f0',
                                borderRadius: 1.5,
                              }}
                            >
                              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                Level
                              </Typography>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a', mt: 0.25, textTransform: 'capitalize' }}>
                                {facts.risk.risk_level || 'Low'}
                              </Typography>
                            </Paper>
                          </Grid>
                        </Grid>

                        {facts.risk.flagged_behaviors?.length > 0 && (
                          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            {facts.risk.flagged_behaviors.map((b, i) => (
                              <Chip
                                key={i}
                                label={b}
                                size="small"
                                icon={<WarningIcon sx={{ fontSize: 13, color: '#dc2626' }} />}
                                sx={{
                                  justifyContent: 'flex-start',
                                  fontSize: '0.68rem',
                                  height: 22,
                                  bgcolor: '#fef2f2',
                                  color: '#991b1b',
                                  border: '1px solid #fecaca',
                                }}
                              />
                            ))}
                          </Box>
                        )}
                      </CardContent>
                    )}
                  </Card>

                  {/* Alert Telemetry Card */}
                  <Card variant="outlined" sx={{ borderRadius: 2, borderColor: '#e2e8f0', boxShadow: 'none' }}>
                    <Box
                      onClick={() => toggleSection('alerts')}
                      sx={{
                        p: 1.5,
                        bgcolor: '#f8fafc',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: expandedSections.alerts ? '1px solid #e2e8f0' : 'none',
                        '&:hover': { bgcolor: '#f1f5f9' },
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        <NotificationsIcon sx={{ fontSize: 14, color: '#64748b' }} />
                        Alert Telemetry
                      </Typography>
                      <IconButton size="small" sx={{ p: 0.25 }}>
                        {expandedSections.alerts ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                    </Box>

                    {expandedSections.alerts && (
                      <CardContent sx={{ p: 2 }}>
                        <Stack spacing={1.25}>
                          <Stack direction="row" justifyContent="space-between" sx={{ pb: 0.75, borderBottom: '1px solid #f1f5f9' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Total Alerts</Typography>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace' }}>
                              {facts.alerts.total_alerts || 0}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" sx={{ pb: 0.75, borderBottom: '1px solid #f1f5f9' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Critical Severity</Typography>
                            <Typography
                              sx={{
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                color: (facts.alerts.critical_alerts || 0) > 0 ? '#dc2626' : '#059669',
                              }}
                            >
                              {facts.alerts.critical_alerts || 0}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Latest Trigger</Typography>
                            <Typography sx={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#334155' }}>
                              {facts.alerts.latest_alert ? new Date(facts.alerts.latest_alert).toLocaleDateString() : 'None'}
                            </Typography>
                          </Stack>
                        </Stack>
                      </CardContent>
                    )}
                  </Card>

                  {/* 30-Day Activity Card */}
                  <Card variant="outlined" sx={{ borderRadius: 2, borderColor: '#e2e8f0', boxShadow: 'none' }}>
                    <Box
                      onClick={() => toggleSection('transactions')}
                      sx={{
                        p: 1.5,
                        bgcolor: '#f8fafc',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: expandedSections.transactions ? '1px solid #e2e8f0' : 'none',
                        '&:hover': { bgcolor: '#f1f5f9' },
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        <TrendingUpIcon sx={{ fontSize: 14, color: '#64748b' }} />
                        30-Day Activity Matrix
                      </Typography>
                      <IconButton size="small" sx={{ p: 0.25 }}>
                        {expandedSections.transactions ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                    </Box>

                    {expandedSections.transactions && (
                      <CardContent sx={{ p: 2 }}>
                        <Stack spacing={1.25}>
                          <Stack direction="row" justifyContent="space-between" sx={{ pb: 0.75, borderBottom: '1px solid #f1f5f9' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Total Volume</Typography>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>
                              ${Number(facts.transactions.total_volume || 0).toLocaleString()}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" sx={{ pb: 0.75, borderBottom: '1px solid #f1f5f9' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Avg Transaction</Typography>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>
                              ${Number(facts.transactions.avg_amount || 0).toFixed(2)}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography sx={{ fontSize: '0.75rem', color: '#64748b' }}>Cash Ratio</Typography>
                            <Typography
                              sx={{
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                color: (facts.transactions.cash_ratio || 0) > 0.3 ? '#dc2626' : '#059669',
                              }}
                            >
                              {((facts.transactions.cash_ratio || 0) * 100).toFixed(1)}%
                            </Typography>
                          </Stack>
                        </Stack>
                      </CardContent>
                    )}
                  </Card>
                </Stack>
              )}
            </Box>
          </Paper>

          {/* ======================================================== */}
          {/* CENTER / RIGHT: Enterprise AML Copilot Workspace */}
          {/* ======================================================== */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#f8fafc' }}>
            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <Stack spacing={2} alignItems="center">
                  <CircularProgress size={42} sx={{ color: '#ea580c' }} />
                  <Typography variant="body2" sx={{ color: '#64748b', fontSize: '0.85rem' }}>
                    Ingesting case telemetry and empirical signals...
                  </Typography>
                </Stack>
              </Box>
            )}

            {!loading && !selectedCaseId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, p: 6 }}>
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    bgcolor: '#ffffff',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
                    mb: 2.5,
                  }}
                >
                  <ShieldIcon sx={{ fontSize: 36, color: '#ea580c' }} />
                </Box>
                <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', mb: 0.5 }}>
                  Select an Investigation Case
                </Typography>
                <Typography sx={{ maxWidth: 460, textAlign: 'center', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  Choose a case from the active queue to activate evidence-grounded AI copilot reasoning, automated SAR drafting, and cross-case pattern analysis.
                </Typography>
                <Button
                  onClick={() => setShowManual(true)}
                  startIcon={<HelpOutline />}
                  variant="outlined"
                  size="small"
                  sx={{ mt: 3, color: '#334155', borderColor: '#cbd5e1', textTransform: 'none', fontWeight: 600 }}
                >
                  Read Copilot User Guide
                </Button>
              </Box>
            )}

            {!loading && selectedCaseId && !facts && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, p: 6 }}>
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    bgcolor: '#fff7ed',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #fed7aa',
                    mb: 2.5,
                  }}
                >
                  <WarningIcon sx={{ fontSize: 36, color: '#ea580c' }} />
                </Box>
                <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', mb: 0.5 }}>
                  Case Telemetry Unavailable
                </Typography>
                <Typography sx={{ maxWidth: 440, textAlign: 'center', color: '#64748b', fontSize: '0.85rem', mb: 3 }}>
                  Unable to load facts for case <strong>{selectedCaseId}</strong>. Verify database connectivity and ensure master case records exist.
                </Typography>
                <Button
                  onClick={() => handleCaseSelect(selectedCaseId)}
                  startIcon={<RefreshIcon />}
                  variant="contained"
                  disableElevation
                  sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 600 }}
                >
                  Retry Loading Case
                </Button>
              </Box>
            )}

            {!loading && selectedCaseId && facts && (
              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Modern Copilot Header Bar */}
                <Box
                  sx={{
                    px: 3,
                    py: 1.5,
                    bgcolor: '#0f172a',
                    color: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #1e293b',
                    flexShrink: 0,
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        bgcolor: 'rgba(234, 88, 12, 0.2)',
                        border: '1px solid rgba(234, 88, 12, 0.4)',
                        borderRadius: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ea580c',
                      }}
                    >
                      <AutoAwesomeIcon sx={{ fontSize: 18 }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1.2 }}>
                        FCIP Copilot Intelligence
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                        Evidence-grounded model • Grounded strictly in empirical case telemetry
                      </Typography>
                    </Box>
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="center">
                    {/* Live model status pill */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.25,
                        py: 0.35,
                        bgcolor: 'rgba(255, 255, 255, 0.08)',
                        borderRadius: 1.5,
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                      }}
                    >
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                        Active: openai.gpt-5.6-luna
                      </Typography>
                    </Box>

                    <Chip
                      label={`${messages.length} ${messages.length === 1 ? 'interaction' : 'interactions'}`}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(255, 255, 255, 0.08)',
                        color: '#cbd5e1',
                        height: 24,
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    />

                    <Tooltip title="Reset conversation session" arrow>
                      <IconButton size="small" onClick={handleClearChat} sx={{ color: '#94a3b8', '&:hover': { color: '#ffffff' } }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>

                {/* Messages Area - SCROLLABLE */}
                <Box sx={{ flex: 1, overflowY: 'auto', p: 3, bgcolor: '#f8fafc' }}>
                  <Stack spacing={2.5}>
                    {messages.map((msg, idx) => {
                      // 1. Initial Intake Dossier Message
                      if (msg.role === 'system') {
                        return (
                          <Paper
                            key={idx}
                            variant="outlined"
                            sx={{
                              p: 2.5,
                              borderRadius: 2,
                              bgcolor: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderLeft: '4px solid #ea580c',
                              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                            }}
                          >
                            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Box
                                  sx={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 1,
                                    bgcolor: '#ecfdf5',
                                    border: '1px solid #a7f3d0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#059669',
                                  }}
                                >
                                  <CheckIcon sx={{ fontSize: 15 }} />
                                </Box>
                                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                                  Case Dossier Ingested: <span style={{ fontFamily: 'monospace' }}>{msg.caseId}</span>
                                </Typography>
                              </Stack>
                              <Typography sx={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                {msg.timestamp?.toLocaleTimeString()}
                              </Typography>
                            </Stack>

                            {/* Summary strip */}
                            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                              <Chip
                                label={`Risk Score: ${msg.facts?.risk?.risk_score ?? 0}/100`}
                                size="small"
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  bgcolor: tier.bg,
                                  color: tier.color,
                                  border: '1px solid',
                                  borderColor: tier.border,
                                  height: 24,
                                }}
                              />
                              <Chip
                                label={`Level: ${msg.facts?.risk?.risk_level || 'Low'}`}
                                size="small"
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  bgcolor: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  height: 24,
                                }}
                              />
                              <Chip
                                label={`KYC: ${msg.facts?.risk?.kyc_status || 'Verified'}`}
                                size="small"
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  bgcolor: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  height: 24,
                                }}
                              />
                              <Chip
                                label={`Alerts: ${msg.facts?.alerts?.total_alerts || 0}`}
                                size="small"
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  bgcolor: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  height: 24,
                                }}
                              />
                            </Stack>

                            <Typography sx={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.6 }}>
                              The Copilot has ingested all telemetry, alerts, and transaction records for this case. Ask any forensic question or select a quick action below to begin your analysis.
                            </Typography>
                          </Paper>
                        );
                      }

                      // 2. User Message
                      if (msg.role === 'user') {
                        return (
                          <Stack key={idx} direction="row" justifyContent="flex-end" spacing={1.5} alignItems="flex-start">
                            <Box sx={{ maxWidth: '78%' }}>
                              <Paper
                                elevation={0}
                                sx={{
                                  p: 2,
                                  bgcolor: '#1e293b',
                                  color: '#ffffff',
                                  borderRadius: '16px 16px 4px 16px',
                                  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)',
                                }}
                              >
                                <Typography sx={{ fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                  {msg.content}
                                </Typography>
                                <Typography
                                  sx={{
                                    mt: 0.75,
                                    fontSize: '0.65rem',
                                    color: 'rgba(255,255,255,0.6)',
                                    textAlign: 'right',
                                  }}
                                >
                                  {msg.timestamp?.toLocaleTimeString()}
                                </Typography>
                              </Paper>
                            </Box>
                            <Box
                              sx={{
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                bgcolor: '#334155',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#ffffff',
                                flexShrink: 0,
                              }}
                            >
                              <PersonIcon sx={{ fontSize: 18 }} />
                            </Box>
                          </Stack>
                        );
                      }

                      // 3. Error Message
                      if (msg.role === 'error') {
                        return (
                          <Stack key={idx} direction="row" spacing={1.5} alignItems="flex-start">
                            <Box
                              sx={{
                                width: 32,
                                height: 32,
                                borderRadius: 1.5,
                                bgcolor: '#fef2f2',
                                border: '1px solid #fecaca',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#dc2626',
                                flexShrink: 0,
                              }}
                            >
                              <ErrorIcon fontSize="small" />
                            </Box>
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 2,
                                bgcolor: '#fef2f2',
                                borderColor: '#fecaca',
                                borderRadius: 2,
                                maxWidth: '78%',
                              }}
                            >
                              <Typography sx={{ fontSize: '0.82rem', color: '#991b1b', lineHeight: 1.5 }}>
                                {msg.content}
                              </Typography>
                              <Typography sx={{ mt: 0.5, fontSize: '0.65rem', color: '#b91c1c' }}>
                                {msg.timestamp?.toLocaleTimeString()}
                              </Typography>
                            </Paper>
                          </Stack>
                        );
                      }

                      // 4. Assistant Copilot Message
                      return (
                        <Stack key={idx} direction="row" spacing={1.5} alignItems="flex-start">
                          <Box
                            sx={{
                              width: 32,
                              height: 32,
                              borderRadius: 1.5,
                              bgcolor: '#0f172a',
                              border: '1px solid #1e293b',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ea580c',
                              flexShrink: 0,
                            }}
                          >
                            <AutoAwesomeIcon sx={{ fontSize: 18 }} />
                          </Box>

                          <Box sx={{ maxWidth: '82%', minWidth: 260 }}>
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 2.5,
                                bgcolor: '#ffffff',
                                borderColor: '#e2e8f0',
                                borderRadius: '16px 16px 16px 4px',
                                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                              }}
                            >
                              {msg.streaming && !msg.content ? (
                                <Stack direction="row" spacing={1.5} alignItems="center">
                                  <CircularProgress size={14} sx={{ color: '#ea580c' }} />
                                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                                    Analyzing case telemetry & synthesizing findings...
                                  </Typography>
                                </Stack>
                              ) : (
                                <FormattedMarkdown content={msg.content} />
                              )}

                              {msg.streaming && msg.content && (
                                <Typography
                                  component="span"
                                  sx={{
                                    display: 'inline-block',
                                    width: 6,
                                    height: 14,
                                    bgcolor: '#ea580c',
                                    ml: 0.5,
                                    animation: 'pulse 1s infinite',
                                    verticalAlign: 'middle',
                                  }}
                                />
                              )}

                              {/* Footer controls */}
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                                sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #f1f5f9' }}
                              >
                                <Typography sx={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                                  {msg.timestamp?.toLocaleTimeString()} • openai.gpt-5.6-luna
                                </Typography>

                                {msg.content && !msg.streaming && (
                                  <Tooltip title={copiedIndex === idx ? 'Copied to clipboard' : 'Copy message text'} arrow>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleCopy(msg.content, idx)}
                                      sx={{ color: '#94a3b8', '&:hover': { color: '#0f172a' }, p: 0.5 }}
                                    >
                                      {copiedIndex === idx ? (
                                        <CheckIcon sx={{ fontSize: 14, color: '#059669' }} />
                                      ) : (
                                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                                      )}
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Stack>
                            </Paper>
                          </Box>
                        </Stack>
                      );
                    })}

                    {generating && !streamStarted && (
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            borderRadius: 1.5,
                            bgcolor: '#0f172a',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ea580c',
                          }}
                        >
                          <AutoAwesomeIcon sx={{ fontSize: 18 }} />
                        </Box>
                        <Paper variant="outlined" sx={{ p: 1.5, px: 2, borderRadius: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0' }}>
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            <CircularProgress size={14} sx={{ color: '#ea580c' }} />
                            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
                              Grounding query in database facts...
                            </Typography>
                          </Stack>
                        </Paper>
                      </Stack>
                    )}
                    <div ref={chatEndRef} />
                  </Stack>
                </Box>

                {/* Quick Actions & Input - FIXED AT BOTTOM */}
                <Box sx={{ borderTop: '1px solid #e2e8f0', bgcolor: '#ffffff', flexShrink: 0 }}>
                  <Box sx={{ px: 2.5, py: 1.25, bgcolor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    <Typography
                      sx={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        letterSpacing: '0.06em',
                        color: '#64748b',
                        textTransform: 'uppercase',
                        mb: 0.75,
                      }}
                    >
                      Investigative Prompt Shortcuts
                    </Typography>
                    <Stack direction="row" spacing={1} overflow="auto" pb={0.5}>
                      {[
                        { label: 'Draft SAR Narrative', icon: FileTextIcon },
                        { label: 'Explain Risk Drivers', icon: TimelineIcon },
                        { label: 'Suggest Next Steps', icon: BoltIcon },
                        { label: 'Compare to Baseline', icon: TrendingUpIcon },
                      ].map((action) => (
                        <Button
                          key={action.label}
                          onClick={() => sendMessage(action.label)}
                          disabled={generating}
                          size="small"
                          variant="outlined"
                          startIcon={<action.icon sx={{ fontSize: 14 }} />}
                          sx={{
                            textTransform: 'none',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            color: '#334155',
                            borderColor: '#cbd5e1',
                            bgcolor: '#ffffff',
                            borderRadius: 1.5,
                            py: 0.4,
                            px: 1.25,
                            '&:hover': {
                              bgcolor: '#f1f5f9',
                              borderColor: '#94a3b8',
                            },
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </Stack>
                  </Box>

                  <Box sx={{ p: 2, px: 2.5 }}>
                    <TextField
                      fullWidth
                      multiline
                      maxRows={4}
                      placeholder="Ask about transaction patterns, alert triggers, typologies, counterparties..."
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage(input);
                        }
                      }}
                      disabled={generating}
                      variant="outlined"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: '#f8fafc',
                          borderRadius: 2,
                          fontSize: '0.85rem',
                          '& fieldset': { borderColor: '#cbd5e1' },
                          '&:hover fieldset': { borderColor: '#94a3b8' },
                          '&.Mui-focused fieldset': { borderColor: '#ea580c' },
                        },
                      }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Button
                              onClick={() => sendMessage(input)}
                              disabled={!input.trim() || generating}
                              variant="contained"
                              size="medium"
                              disableElevation
                              sx={{
                                minWidth: 76,
                                fontWeight: 700,
                                textTransform: 'none',
                                bgcolor: '#ea580c',
                                borderRadius: 1.5,
                                '&:hover': { bgcolor: '#c2410c' },
                              }}
                              endIcon={<SendIcon sx={{ fontSize: 16 }} />}
                            >
                              Send
                            </Button>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{ mt: 0.75, display: 'block', fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center' }}
                    >
                      Press Enter ↵ to send • Shift+Enter for new line • Grounded in empirical case facts
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </PageContainer>
    </>
  );
};

export default CaseInvestigationScreen;
