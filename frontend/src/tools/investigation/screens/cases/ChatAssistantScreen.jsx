import React, { useState, useRef, useEffect } from 'react';
import { useAppContext, usePersistentState } from "@context/AppContext";
import apiClient from "@services/api";
import { readInvestigationSettings, subscribeInvestigationSettings } from '../../utils/investigationSettings';

// ✅ Correct Layout Import
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box, Paper, Typography, Stack, IconButton, TextField, Select, MenuItem, FormControl, Chip, CircularProgress, Divider, Avatar, Tooltip
} from '@mui/material';
import {
  Chat as MessageSquareIcon,
  Send as SendIcon,
  Person as UserIcon,
  SmartToy as BotIcon,
  Refresh as RefreshIcon,
  AutoAwesome as SparklesIcon,
  Code as CodeIcon,
  DeleteOutline as DeleteIcon
} from '@mui/icons-material';

const ChatAssistantScreen = () => {
  const { ollamaModels: contextModels } = useAppContext(); 
  const [localModels, setLocalModels] = useState([]);
  const [chatMessages, setChatMessages] = usePersistentState('chat_history', []);
  const [selectedModel, setSelectedModel] = usePersistentState('chat_model', readInvestigationSettings()?.assistant?.preferred_model || readInvestigationSettings()?.global?.default_model || 'llama3.2:1b');
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const availableModels = contextModels.length > 0 ? contextModels : localModels;

  useEffect(() => {
    const applySettings = (latestSettings) => {
      const preferred = latestSettings?.assistant?.preferred_model || latestSettings?.global?.default_model || '';
      if (preferred) {
        setSelectedModel(preferred);
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
          const modelNames = res.data.models
            .map(m => (typeof m === 'string' ? m : m?.name))
            .filter(Boolean);

          if (modelNames.length > 0) {
            setLocalModels(modelNames);
            if (!modelNames.includes(selectedModel)) {
              setSelectedModel(modelNames[0]);
            }
          } else {
            setLocalModels(['llama3.2:1b']);
          }
        }
      } catch (err) {
        console.error('Failed to load models:', err);
        setLocalModels(['llama3.2:1b']);
      }
    };
    fetchModels();
  }, [contextModels, selectedModel, setSelectedModel]);

  useEffect(() => { 
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); 
    }
  }, [chatMessages, isChatLoading]);

  const handleSendMessage = async () => {
    if (!currentMessage.trim()) return;
    
    const userMsg = {
      role: 'user',
      content: currentMessage,
      timestamp: new Date().toISOString()
    };

    setChatMessages(p => [...p, userMsg]);
    setCurrentMessage('');
    setIsChatLoading(true);

    try {
      const history = chatMessages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await apiClient.post('/api/v2/chat/assistant', { 
        message: userMsg.content, 
        model: selectedModel, 
        history 
      });

      const data = res.data || res;

      if (data && data.success) {
        setChatMessages(p => [
          ...p,
          {
            role: 'assistant',
            content: data.response,
            timestamp: data.timestamp || new Date().toISOString()
          }
        ]);
      } else {
        const rawError = data?.error || data?.message || 'Unknown backend error';
        throw new Error(typeof rawError === 'object' ? JSON.stringify(rawError) : rawError);
      }
    } catch (err) {
      setChatMessages(p => [
        ...p,
        {
          role: 'assistant',
          content: `Server Error: ${err.message || 'Connection failed'}`,
          isError: true,
          timestamp: new Date().toISOString()
        }
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
    if (confirm('Clear all chat history?')) {
      setChatMessages([]);
    }
  };

  return (
    <PageContainer
      title="Technical Copilot"
      subtitle="Context: Schema & Source Code"
      breadcrumbs={['Tools', 'Chat Assistant']}
      actions={
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              disabled={availableModels.length === 0}
              sx={{ 
                fontSize: '0.875rem', 
                fontWeight: 600,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e0e0e0' }
              }}
            >
              {availableModels.length > 0 ? (
                availableModels.map(m => (
                  <MenuItem key={m} value={m} sx={{ fontSize: '0.875rem' }}>
                    {m}
                  </MenuItem>
                ))
              ) : (
                <MenuItem value="loading" disabled>Loading Models...</MenuItem>
              )}
            </Select>
          </FormControl>
          {availableModels.length === 0 && <CircularProgress size={16} />}
          <Tooltip title="Clear Chat">
            <IconButton size="small" onClick={clearChat} disabled={chatMessages.length === 0}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      {/* ✅ MAIN CONTENT WRAPPER 
         - height: '100%' forces it to fill PageContainer.
         - overflow: 'hidden' prevents double scrollbars.
         - gap: 2 adds spacing between Chat Area and Input Area.
      */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', gap: 2 }}>
        
        {/* CHAT MESSAGES CONTAINER */}
        <Paper 
          variant="outlined" 
          ref={chatContainerRef}
          sx={{ 
            flex: 1, // Takes up all available space
            overflow: 'auto', // Handles scrolling internally
            p: 2,
            bgcolor: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0 // Allows flex shrink
          }}
        >
          {chatMessages.length === 0 && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
              <Box sx={{ 
                width: 64, 
                height: 64, 
                borderRadius: 2, 
                bgcolor: '#f0f0f0', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                mb: 2,
                border: '2px solid #e0e0e0'
              }}>
                <SparklesIcon sx={{ fontSize: 32, color: '#bdbdbd' }} />
              </Box>
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                Ready to assist with database & code queries
              </Typography>
            </Box>
          )}

          <Stack spacing={2}>
            {chatMessages.map((msg, i) => (
              <Box 
                key={i} 
                sx={{ 
                  display: 'flex', 
                  gap: 1.5,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start'
                }}
              >
                {/* Avatar */}
                <Avatar 
                  sx={{ 
                    width: 32, 
                    height: 32,
                    bgcolor: msg.role === 'user' ? '#1976d2' : '#fff',
                    border: msg.role === 'user' ? 'none' : '1px solid #e0e0e0',
                    color: msg.role === 'user' ? '#fff' : '#616161',
                    flexShrink: 0
                  }}
                >
                  {msg.role === 'user' ? (
                    <UserIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <BotIcon sx={{ fontSize: 18 }} />
                  )}
                </Avatar>

                {/* Message Bubble */}
                <Box sx={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.5,
                      bgcolor: msg.role === 'user' ? '#1976d2' : '#fff',
                      color: msg.role === 'user' ? '#fff' : '#212121',
                      border: msg.role === 'user' ? 'none' : '1px solid #e0e0e0',
                      borderRadius: msg.role === 'user' ? '12px 12px 0 12px' : '12px 12px 12px 0',
                      ...(msg.isError && {
                        bgcolor: '#ffebee',
                        borderColor: '#ef5350',
                        color: '#c62828'
                      })
                    }}
                  >
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        whiteSpace: 'pre-wrap', 
                        lineHeight: 1.6,
                        fontSize: '0.875rem',
                        fontWeight: 500
                      }}
                    >
                      {msg.content}
                    </Typography>
                  </Paper>
                  <Typography 
                    variant="caption" 
                    color="text.secondary" 
                    sx={{ 
                      fontSize: '0.65rem',
                      fontFamily: 'monospace',
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      px: 0.5
                    }}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                </Box>
              </Box>
            ))}

            {/* Loading Indicator */}
            {isChatLoading && (
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: '#fff', border: '1px solid #e0e0e0', flexShrink: 0 }}>
                  <BotIcon sx={{ fontSize: 18, color: '#616161' }} />
                </Avatar>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    bgcolor: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: '12px 12px 12px 0',
                    display: 'flex',
                    gap: 0.75
                  }}
                >
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#1976d2', animation: 'bounce 1s infinite' }} />
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#1976d2', animation: 'bounce 1s infinite 0.15s' }} />
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#1976d2', animation: 'bounce 1s infinite 0.3s' }} />
                </Paper>
              </Box>
            )}
            <div ref={chatEndRef} />
          </Stack>
        </Paper>

        {/* INPUT AREA */}
        <Paper 
          variant="outlined" 
          sx={{ 
            p: 1.5,
            display: 'flex',
            gap: 1.5,
            alignItems: 'flex-end',
            bgcolor: '#fff',
            flexShrink: 0,
            '&:focus-within': {
              borderColor: '#1976d2',
              boxShadow: '0 0 0 1px #1976d2'
            }
          }}
        >
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={currentMessage}
            onChange={e => setCurrentMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type your query here... (Shift+Enter for new line)"
            disabled={isChatLoading}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                fontSize: '0.875rem',
                fontWeight: 500,
                '& textarea': {
                  '&::placeholder': {
                    color: '#9e9e9e',
                    opacity: 1
                  }
                }
              }
            }}
          />
          <IconButton
            onClick={handleSendMessage}
            disabled={!currentMessage.trim() || isChatLoading}
            sx={{
              bgcolor: currentMessage.trim() && !isChatLoading ? '#1976d2' : '#e0e0e0',
              color: '#fff',
              width: 36,
              height: 36,
              flexShrink: 0,
              '&:hover': {
                bgcolor: currentMessage.trim() && !isChatLoading ? '#1565c0' : '#e0e0e0'
              },
              '&.Mui-disabled': {
                bgcolor: '#f5f5f5',
                color: '#bdbdbd'
              }
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Paper>
      </Box>

      {/* Keyframes for loading animation */}
      <style>
        {`
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
          }
        `}
      </style>
    </PageContainer>
  );
};

export default ChatAssistantScreen;
