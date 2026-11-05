import React, { useState, useRef, useEffect } from 'react';
import { useAppContext, usePersistentState } from "@context/AppContext";
import apiClient from "@services/api";
import { readInvestigationSettings, subscribeInvestigationSettings } from '../../utils/investigationSettings';
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box,
  Paper,
  Typography,
  Stack,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Chip,
  CircularProgress,
  Divider,
  Avatar,
  Tooltip,
} from '@mui/material';
import {
  Send as SendIcon,
  Person as UserIcon,
  SmartToy as BotIcon,
  AutoAwesome as SparklesIcon,
  DeleteOutline as DeleteIcon,
  Storage as DatabaseIcon,
  Security as SecurityIcon,
  HelpOutline as QueryIcon,
  Description as DocumentIcon,
} from '@mui/icons-material';

const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const normalizeModelName = (value) => {
  const text = String(value || '').trim();
  return text || DEFAULT_AI_MODEL;
};

const SUGGESTED_QUERIES = [
  {
    icon: <SecurityIcon sx={{ fontSize: 16, color: '#2563eb' }} />,
    title: 'Explain Rule R006',
    prompt: 'Can you explain the detection logic and threshold parameters for rule R006_HIGH_RISK_DEST?',
  },
  {
    icon: <DatabaseIcon sx={{ fontSize: 16, color: '#7c3aed' }} />,
    title: 'Inspect Table Schema',
    prompt: 'What columns and entity keys are present in the transactions and cases database tables?',
  },
  {
    icon: <QueryIcon sx={{ fontSize: 16, color: '#059669' }} />,
    title: 'Pass-Through Logic',
    prompt: 'How is the velocity spike and pass-through account drain ratio calculated from credit and debit flows?',
  },
  {
    icon: <DocumentIcon sx={{ fontSize: 16, color: '#d97706' }} />,
    title: 'SAR Narrative Structure',
    prompt: 'What mandatory sections are required for an audit-defensible Suspicious Activity Report (SAR) narrative?',
  },
];

const ChatAssistantScreen = () => {
  const { ollamaModels: contextModels } = useAppContext();
  const [localModels, setLocalModels] = useState([]);
  const [chatMessages, setChatMessages] = usePersistentState('chat_history', []);
  const [selectedModel, setSelectedModel] = usePersistentState(
    'chat_model',
    normalizeModelName(readInvestigationSettings()?.assistant?.preferred_model || readInvestigationSettings()?.global?.default_model)
  );
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const availableModels = Array.from(
    new Set(
      (contextModels.length > 0 ? contextModels : localModels)
        .filter((model) => model?.available !== false)
        .map((model) => {
          if (typeof model === 'string') return normalizeModelName(model);
          return normalizeModelName(model?.name || model?.id);
        })
        .filter(Boolean)
    )
  );
  const normalizedSelectedModel = normalizeModelName(selectedModel);
  const activeModel = availableModels.includes(normalizedSelectedModel)
    ? normalizedSelectedModel
    : availableModels[0] || normalizedSelectedModel;

  useEffect(() => {
    const normalized = normalizeModelName(selectedModel);
    if (normalized !== selectedModel) {
      setSelectedModel(normalized);
    }
  }, [selectedModel, setSelectedModel]);

  useEffect(() => {
    const applySettings = (latestSettings) => {
      const preferred = latestSettings?.assistant?.preferred_model || latestSettings?.global?.default_model || '';
      if (preferred) {
        setSelectedModel(normalizeModelName(preferred));
      }
      if (!latestSettings?.assistant?.keep_chat_history) {
        setChatMessages([]);
      }
    };
    applySettings(readInvestigationSettings());
    return subscribeInvestigationSettings(applySettings);
  }, [setChatMessages, setSelectedModel]);

  useEffect(() => {
    const fetchModels = async () => {
      if (contextModels.length > 0) return;
      try {
        const res = await apiClient.get('/api/v2/llm/models');
        if (res.data?.success && Array.isArray(res.data.models)) {
          const modelNames = res.data.models.map((m) => (typeof m === 'string' ? m : m?.name)).filter(Boolean);

          if (modelNames.length > 0) {
            setLocalModels(modelNames);
            if (!modelNames.includes(selectedModel)) {
              const backendDefault = res.data.default_model;
              if (backendDefault && modelNames.includes(backendDefault)) {
                setSelectedModel(backendDefault);
              } else {
                setSelectedModel(modelNames[0]);
              }
            }
          } else {
            setLocalModels([DEFAULT_AI_MODEL]);
          }
        }
      } catch (err) {
        console.error('Failed to load models:', err);
        setLocalModels([DEFAULT_AI_MODEL]);
      }
    };
    fetchModels();
  }, [contextModels, selectedModel, setSelectedModel]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [chatMessages, isChatLoading]);

  const handleSendMessage = async (customPrompt = null) => {
    const textToSend = typeof customPrompt === 'string' ? customPrompt : currentMessage;
    if (!textToSend || !textToSend.trim()) return;

    const userMsg = {
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toISOString(),
    };

    setChatMessages((p) => [...p, userMsg]);
    if (!customPrompt) setCurrentMessage('');
    setIsChatLoading(true);

    try {
      const history = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await apiClient.post('/api/v2/chat/assistant', {
        message: userMsg.content,
        model: activeModel,
        history,
      });

      const data = res.data || res;

      if (data && data.success) {
        setChatMessages((p) => [
          ...p,
          {
            role: 'assistant',
            content: data.response,
            timestamp: data.timestamp || new Date().toISOString(),
          },
        ]);
      } else {
        const rawError = data?.error || data?.message || 'Server returned an unhandled error response.';
        throw new Error(typeof rawError === 'object' ? JSON.stringify(rawError) : rawError);
      }
    } catch (err) {
      setChatMessages((p) => [
        ...p,
        {
          role: 'assistant',
          content: `Error: ${err.message || 'Failed to connect to assistant service.'}`,
          isError: true,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    if (window.confirm('Clear current chat conversation?')) {
      setChatMessages([]);
    }
  };

  return (
    <PageContainer
      title="Technical Copilot"
      subtitle="Context-aware investigation assistant for database schema, detection algorithms, and SQL logic"
      breadcrumbs={['Tools', 'Chat Assistant']}
      actions={(
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <Select
              value={availableModels.length > 0 ? activeModel : 'loading'}
              onChange={(e) => setSelectedModel(normalizeModelName(e.target.value))}
              disabled={availableModels.length === 0}
              sx={{
                height: 32,
                fontSize: 12.5,
                fontWeight: 600,
                bgcolor: '#ffffff',
                borderRadius: 1,
              }}
            >
              {availableModels.length > 0 ? (
                availableModels.map((m) => (
                  <MenuItem key={m} value={m} sx={{ fontSize: 12.5 }}>
                    {m}
                  </MenuItem>
                ))
              ) : (
                <MenuItem value="loading" disabled>Loading Models...</MenuItem>
              )}
            </Select>
          </FormControl>
          {availableModels.length === 0 && <CircularProgress size={16} />}
          <Tooltip title="Clear Chat History">
            <IconButton size="small" onClick={clearChat} disabled={chatMessages.length === 0} sx={{ color: '#64748b' }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    >
      {/* Full Viewport Height Container (Fills entire screen without bottom white space) */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 170px)',
          minHeight: 560,
          bgcolor: '#ffffff',
          borderRadius: 1.5,
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {/* Chat History Canvas (Scrollable Viewport) */}
        <Box
          ref={chatContainerRef}
          sx={{
            flex: 1,
            overflowY: 'auto',
            p: { xs: 2, md: 3 },
            bgcolor: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {chatMessages.length === 0 ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                maxWidth: 720,
                mx: 'auto',
                width: '100%',
                py: 4,
              }}
            >
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                }}
              >
                <SparklesIcon sx={{ fontSize: 28, color: '#0f172a' }} />
              </Box>

              <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#0f172a', mb: 0.5 }}>
                AML Technical Copilot
              </Typography>
              <Typography sx={{ fontSize: 13, color: '#64748b', textAlign: 'center', maxWidth: 540, mb: 4, lineHeight: 1.6 }}>
                Query transaction schemas, regulatory rule thresholds, behavioral typology formulas, or draft investigative narratives.
              </Typography>

              {/* Starter Query Suggestion Grid */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1.5,
                  width: '100%',
                }}
              >
                {SUGGESTED_QUERIES.map((item, idx) => (
                  <Paper
                    key={idx}
                    variant="outlined"
                    onClick={() => handleSendMessage(item.prompt)}
                    sx={{
                      p: 1.75,
                      borderRadius: 1.5,
                      bgcolor: '#ffffff',
                      borderColor: '#e2e8f0',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        borderColor: '#94a3b8',
                        bgcolor: '#f1f5f9',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                      },
                    }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.5 }}>
                      {item.icon}
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {item.title}
                      </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
                      {item.prompt}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Box>
          ) : (
            <Box sx={{ maxWidth: 860, width: '100%', mx: 'auto' }}>
              <Stack spacing={2.5}>
                {chatMessages.map((msg, i) => {
                  const isUser = msg.role === 'user';
                  return (
                    <Box
                      key={i}
                      sx={{
                        display: 'flex',
                        gap: 1.5,
                        flexDirection: isUser ? 'row-reverse' : 'row',
                        alignItems: 'flex-start',
                      }}
                    >
                      {/* Avatar */}
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: isUser ? '#0f172a' : '#ffffff',
                          border: isUser ? 'none' : '1px solid #e2e8f0',
                          color: isUser ? '#ffffff' : '#0f172a',
                          flexShrink: 0,
                          fontSize: 14,
                        }}
                      >
                        {isUser ? <UserIcon sx={{ fontSize: 18 }} /> : <BotIcon sx={{ fontSize: 18 }} />}
                      </Avatar>

                      {/* Message Bubble */}
                      <Box sx={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            bgcolor: isUser ? '#0f172a' : '#ffffff',
                            color: isUser ? '#ffffff' : '#0f172a',
                            border: isUser ? 'none' : '1px solid #e2e8f0',
                            borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                            boxShadow: isUser ? 'none' : '0 1px 3px rgba(0,0,0,0.02)',
                            ...(msg.isError && {
                              bgcolor: '#fef2f2',
                              borderColor: '#fca5a5',
                              color: '#991b1b',
                            }),
                          }}
                        >
                          <Typography
                            sx={{
                              whiteSpace: 'pre-wrap',
                              lineHeight: 1.65,
                              fontSize: 13.5,
                              fontWeight: isUser ? 500 : 400,
                              fontFamily: 'inherit',
                            }}
                          >
                            {msg.content}
                          </Typography>
                        </Paper>

                        <Typography
                          sx={{
                            fontSize: 10.5,
                            color: '#94a3b8',
                            alignSelf: isUser ? 'flex-end' : 'flex-start',
                            px: 0.5,
                          }}
                        >
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}

                {/* Loading / Generating Indicator */}
                {isChatLoading && (
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                    <Avatar sx={{ width: 32, height: 32, bgcolor: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                      <BotIcon sx={{ fontSize: 18 }} />
                    </Avatar>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.75,
                        bgcolor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px 12px 12px 2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                      }}
                    >
                      <CircularProgress size={14} sx={{ color: '#0f172a' }} />
                      <Typography sx={{ fontSize: 12.5, color: '#64748b' }}>
                        Analyzing context with {activeModel}...
                      </Typography>
                    </Paper>
                  </Box>
                )}
                <div ref={chatEndRef} />
              </Stack>
            </Box>
          )}
        </Box>

        {/* Pinned Bottom Input Bar (Always Anchored at Base of Screen) */}
        <Box
          sx={{
            p: 2,
            bgcolor: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Box sx={{ maxWidth: 860, width: '100%', mx: 'auto' }}>
            <Paper
              variant="outlined"
              sx={{
                p: '8px 12px',
                display: 'flex',
                gap: 1.5,
                alignItems: 'flex-end',
                bgcolor: '#f8fafc',
                borderColor: '#cbd5e1',
                borderRadius: 1.5,
                transition: 'all 0.15s ease',
                '&:focus-within': {
                  borderColor: '#0f172a',
                  bgcolor: '#ffffff',
                  boxShadow: '0 0 0 1px #0f172a',
                },
              }}
            >
              <TextField
                fullWidth
                multiline
                maxRows={5}
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask about transaction data, typology formulas, or SQL queries... (Shift+Enter for newline)"
                disabled={isChatLoading}
                variant="standard"
                InputProps={{
                  disableUnderline: true,
                  sx: {
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: '#0f172a',
                    '& textarea': {
                      '&::placeholder': {
                        color: '#94a3b8',
                        opacity: 1,
                      },
                    },
                  },
                }}
              />

              <IconButton
                onClick={() => handleSendMessage()}
                disabled={!currentMessage.trim() || isChatLoading}
                sx={{
                  bgcolor: currentMessage.trim() && !isChatLoading ? '#0f172a' : '#e2e8f0',
                  color: '#ffffff',
                  width: 32,
                  height: 32,
                  borderRadius: 1,
                  flexShrink: 0,
                  '&:hover': {
                    bgcolor: currentMessage.trim() && !isChatLoading ? '#1e293b' : '#e2e8f0',
                  },
                  '&.Mui-disabled': {
                    bgcolor: '#f1f5f9',
                    color: '#cbd5e1',
                  },
                }}
              >
                <SendIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.75, px: 0.5 }}>
              <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                Active Model: <Box component="span" sx={{ fontWeight: 600, color: '#475569' }}>{activeModel}</Box>
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                Press <Box component="kbd" sx={{ bgcolor: '#f1f5f9', px: 0.5, py: 0.2, borderRadius: 0.5, border: '1px solid #e2e8f0' }}>Enter</Box> to send
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </PageContainer>
  );
};

export default ChatAssistantScreen;
