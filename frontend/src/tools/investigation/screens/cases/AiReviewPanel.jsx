// frontend/src/screens/cases/AiReviewPanel.jsx
import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, CircularProgress, Alert, List, ListItem,
  ListItemText, ListItemIcon, TextField, IconButton, Stack, Chip, Divider,
  Tooltip
} from '@mui/material';
import {
  HelpOutline as QuestionIcon, AutoAwesome as SparklesIcon, Refresh as RefreshIcon,
  Send as SendIcon, ContentCopy as CopyIcon, NoteAdd as NoteAddIcon,
  Shield as ShieldIcon, CheckCircle as CheckCircleIcon, Gavel as GavelIcon,
  Chat as ChatIcon, FactCheck as FactCheckIcon, ArrowForward as ArrowForwardIcon
} from '@mui/icons-material';
import apiClient from '@services/api';
import FormattedMarkdown from '../../components/FormattedMarkdown';

const QUICK_PROMPTS = [
  { label: '⚡ Check Structuring', query: 'Analyze all transactions for structuring or smurfing just below the $10,000 regulatory reporting limit.' },
  { label: '🏢 Counterparty Exposure', query: 'Who are the top counterparties receiving funds and what is their percentage share of total volume?' },
  { label: '🔄 Pass-Through Velocity', query: 'Calculate the inflow vs outflow velocity. Is there a rapid pass-through or mule account pattern?' },
  { label: '🔍 Inconsistencies vs Profile', query: 'Identify any inconsistencies between the customer profile/occupation and actual transaction volume.' },
  { label: '📋 Summarize for SAR Draft', query: 'Provide a concise, bulleted factual summary of alerted activity suitable for a SAR narrative.' }
];

const AiReviewPanel = ({ caseId }) => {
  // Questions State
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState(null);

  // Copilot Chat State
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `Hello Analyst. I am your AML Intelligence Copilot for **Case ${caseId}**.\n\nI operate under **"AI for Analysis, Human for Decision"** guardrails. I can interrogate raw transactions, calculate velocity metrics, identify structuring patterns, or test risk hypotheses to support your review. What would you like to examine?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [noteNotice, setNoteNotice] = useState('');

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sendingChat]);

  // Generate Regulator Challenge Questions
  const generateQuestions = async () => {
    if (!caseId) return;
    setLoadingQuestions(true);
    setQuestionsError(null);
    try {
      const res = await apiClient.post('/api/v2/llm/review-questions', { case_id: caseId });
      if (res.success && Array.isArray(res.questions)) {
        setQuestions(res.questions);
      } else {
        setQuestionsError(res.error || 'Failed to generate review questions');
      }
    } catch (e) {
      setQuestionsError(e.message || 'AI service unavailable');
    } finally {
      setLoadingQuestions(false);
    }
  };

  // Send Message to Copilot
  const handleSendMessage = async (textToSend) => {
    const query = textToSend || inputMessage;
    if (!query.trim() || sendingChat) return;

    const userMsg = {
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputMessage('');
    setSendingChat(true);

    try {
      const res = await apiClient.post('/api/v2/llm/case-chat', {
        case_id: caseId,
        message: query,
        history: messages.slice(-6)
      });

      if (res.success && res.response) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: res.response,
            model: res.model,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `⚠️ **Analysis unavailable:** ${res.error || 'Could not reach AI engine. Please verify that your local or cloud LLM provider is active.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ **Error executing case inquiry:** ${err.message || 'Server connection error.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setSendingChat(false);
    }
  };

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleSendQuestionToChat = (q) => {
    const prompt = `Analyze the case data to answer this regulatory examination challenge: "${q}"`;
    handleSendMessage(prompt);
  };

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top Banner: Compliance Guardrail Notice */}
      <Paper
        variant="outlined"
        sx={{
          p: 1.75,
          borderRadius: 2,
          bgcolor: '#ffffff',
          borderColor: '#e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: '#f0fdf4', border: '1.5px solid #86efac', display: 'grid', placeItems: 'center' }}>
            <ShieldIcon sx={{ fontSize: 18, color: '#16a34a' }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>
              AI Review & Evidence Copilot • Case {caseId}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
              Principle: <strong>AI for Objective Analysis, Human for Final Disposition</strong>
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            icon={<GavelIcon sx={{ fontSize: '13px !important', color: '#1e40af !important' }} />}
            label="Analyst Decision Required"
            sx={{ bgcolor: '#eff6ff', color: '#1e40af', fontWeight: 700, fontSize: 11, height: 24 }}
          />
          <Chip
            size="small"
            label="Grounded In Case Data"
            sx={{ bgcolor: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', fontSize: 11, height: 24 }}
          />
        </Stack>
      </Paper>

      {/* Main Dual-Pane Studio */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '340px 1fr', xl: '420px 1fr' }, gap: { xs: 1.5, md: 2.5 }, flex: 1, minHeight: 0 }}>
        
        {/* ============================================================ */}
        {/* LEFT PANE: Regulatory Challenge & Analytical Scorecard */}
        {/* ============================================================ */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          
          {/* 1. Regulatory Audit Challenge Questions */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                  Regulator Challenge Matrix
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748b' }}>
                  Audit & exam challenge points
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={loadingQuestions ? <CircularProgress size={13} color="inherit" /> : questions.length > 0 ? <RefreshIcon sx={{ fontSize: 14 }} /> : <SparklesIcon sx={{ fontSize: 14 }} />}
                onClick={generateQuestions}
                disabled={loadingQuestions}
                sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontSize: 11.5, fontWeight: 700 }}
              >
                {loadingQuestions ? 'Analyzing...' : questions.length > 0 ? 'Regenerate' : 'Generate Questions'}
              </Button>
            </Box>

            {questionsError && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{questionsError}</Alert>}

            <Box sx={{ flex: 1, overflowY: 'auto', pr: 0.5 }}>
              {loadingQuestions && (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <CircularProgress size={30} sx={{ color: '#ea580c', mb: 1.5 }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    Formulating Regulatory Challenge Questions
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                    Evaluating transaction spikes and compliance triggers...
                  </Typography>
                </Box>
              )}

              {!loadingQuestions && questions.length === 0 && (
                <Box sx={{ textAlign: 'center', py: 6, color: '#94a3b8' }}>
                  <QuestionIcon sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
                    No Challenge Questions Generated Yet
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mt: 0.5 }}>
                    Click "Generate Questions" to create examiner-level defense points.
                  </Typography>
                </Box>
              )}

              {!loadingQuestions && questions.length > 0 && (
                <Stack spacing={1.5}>
                  {questions.map((q, idx) => (
                    <Box
                      key={`q_${idx}`}
                      sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        bgcolor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        transition: 'all 0.15s ease-in-out',
                        '&:hover': { bgcolor: '#f1f5f9', borderColor: '#cbd5e1' }
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="flex-start">
                        <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: '#ea580c', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0, mt: 0.25 }}>
                          {idx + 1}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b', lineHeight: 1.5 }}>
                            {q}
                          </Typography>
                          <Button
                            size="small"
                            variant="text"
                            endIcon={<ArrowForwardIcon sx={{ fontSize: '13px !important' }} />}
                            onClick={() => handleSendQuestionToChat(q)}
                            sx={{ textTransform: 'none', fontSize: 11, p: 0, mt: 0.75, color: '#2563eb', fontWeight: 700 }}
                          >
                            Analyze with Copilot
                          </Button>
                        </Box>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          </Paper>
        </Box>

        {/* ============================================================ */}
        {/* RIGHT PANE: Interactive Case Copilot (Chat with AI) */}
        {/* ============================================================ */}
        <Paper variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', borderColor: '#e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Chat Header */}
          <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0', bgcolor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <ChatIcon sx={{ color: '#2563eb', fontSize: 20 }} />
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                  AML Case Copilot
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748b' }}>
                  Ask questions about transactions, velocity, counterparties, or red flags
                </Typography>
              </Box>
            </Stack>

            <Chip
              size="small"
              label="Interactive Analyst Mode"
              sx={{ fontSize: 10.5, height: 22, bgcolor: '#ecfdf5', color: '#059669', fontWeight: 700 }}
            />
          </Box>

          {/* Messages Area */}
          <Box sx={{ flex: 1, p: 2.5, overflowY: 'auto', bgcolor: '#fcfcfd', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {messages.map((m, idx) => {
              const isUser = m.role === 'user';
              return (
                <Box
                  key={`msg_${idx}`}
                  sx={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: { xs: '90%', md: '82%' }
                  }}
                >
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: isUser ? '#2563eb' : '#ffffff',
                      color: isUser ? '#ffffff' : '#0f172a',
                      border: isUser ? 'none' : '1px solid #e2e8f0',
                      boxShadow: isUser ? '0 1px 3px rgba(37,99,235,0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  >
                    {isUser ? (
                      <Typography sx={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                        {m.text}
                      </Typography>
                    ) : (
                      <FormattedMarkdown content={m.text} />
                    )}

                    {!isUser && (
                      <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography sx={{ fontSize: 10.5, color: '#94a3b8' }}>
                          {m.timestamp} {m.model ? `• ${m.model}` : ''}
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title={copiedIdx === idx ? 'Copied!' : 'Copy Analysis'}>
                            <IconButton size="small" onClick={() => handleCopy(m.text, idx)} sx={{ p: 0.5, color: '#64748b' }}>
                              <CopyIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}

            {sendingChat && (
              <Box sx={{ alignSelf: 'flex-start', maxWidth: '75%' }}>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <CircularProgress size={16} sx={{ color: '#2563eb' }} />
                  <Typography sx={{ fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
                    Interrogating case data & compiling factual response
                  </Typography>
                  <Box sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
                    <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#2563eb', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                    <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#2563eb', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0.2s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                    <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#2563eb', animation: 'dotPulse 1.2s infinite ease-in-out', animationDelay: '0.4s', '@keyframes dotPulse': { '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: 0.3 }, '40%': { transform: 'scale(1.2)', opacity: 1 } } }} />
                  </Box>
                </Box>
              </Box>
            )}

            <div ref={chatEndRef} />
          </Box>

          {/* Bottom Chat Input */}
          <Box sx={{ p: 2, borderTop: '1px solid #e2e8f0', bgcolor: '#ffffff' }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                fullWidth
                size="small"
                placeholder={`Ask Copilot about Case ${caseId} (e.g. "Check largest transactions", "What are the counterparties?")...`}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={sendingChat}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 1.5,
                    fontSize: 13,
                    bgcolor: '#f8fafc',
                    '& fieldset': { borderColor: '#e2e8f0' },
                    '&:hover fieldset': { borderColor: '#cbd5e1' },
                    '&.Mui-focused fieldset': { borderColor: '#2563eb' }
                  }
                }}
              />
              <Button
                variant="contained"
                endIcon={<SendIcon />}
                onClick={() => handleSendMessage()}
                disabled={!inputMessage.trim() || sendingChat}
                sx={{
                  bgcolor: '#2563eb',
                  '&:hover': { bgcolor: '#1d4ed8' },
                  borderRadius: 1.5,
                  px: 2.5,
                  fontWeight: 700,
                  textTransform: 'none'
                }}
              >
                Send
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default AiReviewPanel;
