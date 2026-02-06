// src/tools/investigation/screens/case/CaseInvestigationScreen.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Import Layout Components
// import PageContainer from "@investigation/components/PageContainer"; 
// import PageContainer from "@investigation/components/PageContainer";
import PageContainer from "@investigation-layout/PageContainer";
// ✅ Import Manual Component
import CopilotManual from "@investigation/components/guide/CopilotManual";

import {
  Box, Paper, Typography, Button, Select, MenuItem, FormControl, CircularProgress, 
  Card, CardContent, Grid, Chip, TextField, InputAdornment, Stack, IconButton, 
  LinearProgress, Divider, Tooltip
} from '@mui/material';

import {
  Security as ShieldIcon, TrendingUp as TrendingUpIcon, Send as SendIcon, 
  Refresh as RefreshIcon, Info as InfoIcon, Warning as WarningIcon, 
  SmartToy as SmartToyIcon, Person as PersonIcon, AttachMoney as MoneyIcon, 
  Timeline as TimelineIcon, Notifications as NotificationsIcon, 
  Description as FileTextIcon, CheckCircle as CheckCircleIcon, 
  Error as ErrorIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, 
  Bolt as BoltIcon, TableChart as TableChartIcon,
  HelpOutline // ✅ Icon for Guide
} from '@mui/icons-material';

// --- Markdown Component to fix raw text ---
const MarkdownResponse = ({ content }) => {
  if (!content) return null;

  // 1. Split by newlines to handle paragraphs/lists
  const lines = content.split('\n');
  
  return (
    <Box sx={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'text.primary' }}>
      {lines.map((line, i) => {
        // Handle Bullet Points
        if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
          const text = line.replace(/^[\*\-]\s+/, '');
          return (
            <Box key={i} sx={{ display: 'flex', gap: 1, ml: 1, mb: 0.5 }}>
              <Typography component="span" sx={{ color: 'text.secondary' }}>•</Typography>
              <Typography component="span" sx={{ fontWeight: text.includes('**') ? 600 : 400 }}>
                {parseBold(text)}
              </Typography>
            </Box>
          );
        }
        
        // Handle Headers
        if (line.trim().startsWith('**') && line.trim().endsWith('**') && line.length < 50) {
           return <Typography key={i} variant="subtitle2" sx={{ mt: 2, mb: 1, color: 'primary.dark', fontWeight: 'bold' }}>{line.replace(/\*\*/g, '')}</Typography>;
        }

        // Handle Empty Lines
        if (!line.trim()) return <Box key={i} sx={{ height: 8 }} />;

        // Standard Text with Bold parsing
        return (
          <Typography key={i} component="p" sx={{ mb: 0.5 }}>
            {parseBold(line)}
          </Typography>
        );
      })}
    </Box>
  );
};

// Helper to parse **bold** text inside a line
const parseBold = (text) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};


// --- MAIN SCREEN ---
const CaseInvestigationScreen = () => {
  const { 
    caseList, 
    loadCaseList, 
    caseScope,
    getFilteredCaseList 
  } = useAppContext();
  
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    risk: true,
    alerts: true,
    transactions: true
  });
  
  // ✅ State for Manual visibility
  const [showManual, setShowManual] = useState(false);
  
  const chatEndRef = useRef(null);
  const displayCases = getFilteredCaseList();

  useEffect(() => {
    if (!caseList || caseList.length === 0) loadCaseList();
  }, []);

  const getCaseId = (c) => c.case_id || c.caseid || c.Case_ID || c.id;

  const handleCaseSelect = async (id) => {
    setSelectedCaseId(id);
    setLoading(true);
    setMessages([]);
    setFacts(null);
    
    try {
      const res = await apiClient.get(`/api/v2/case/${id}/facts`);
      if (res.success && res.facts) {
        setFacts(res.facts);
        setMessages([{
          role: 'system',
          content: `Case ${id} loaded. Risk Score: ${res.facts.risk.risk_score}/100. Ready to assist.`,
          timestamp: new Date()
        }]);
      }
    } catch (err) {
      console.error(err);
      setMessages([{
        role: 'error',
        content: `Failed to load case: ${err.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || generating) return;
    
    const userMsg = { role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setGenerating(true);

    try {
      const res = await apiClient.post(`/api/v2/case/${selectedCaseId}/copilot`, {
        question: text,
        context: facts
      });
      
      if (res.success) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: res.response,
          timestamp: new Date()
        }]);
      } else {
        throw new Error(res.error || 'Failed to generate response');
      }
    } catch (err) {
      setMessages(prev => [...prev, { 
        role: 'error', 
        content: `Error: ${err.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setGenerating(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      {/* ✅ FIXED: Manual component placed outside PageContainer for guaranteed visibility */}
      <CopilotManual open={showManual} onClose={() => setShowManual(false)} />

      <PageContainer
          header={
              <PageContainer 
                  title="Investigation Copilot" 
                  subtitle="Deterministic Analysis + AI Assistant"
                  actions={
                  <Stack direction="row" spacing={1.5} alignItems="center">
                      
                      {/* ✅ Copilot Guide Button */}
                      <Button 
                        variant="text" 
                        startIcon={<HelpOutline />} 
                        onClick={() => setShowManual(true)}
                        size="small"
                        sx={{ color: 'text.secondary', fontWeight: 600 }}
                      >
                        Guide
                      </Button>
                      
                      <Divider orientation="vertical" flexItem variant="middle" />

                      {selectedCaseId && (
                      <Chip 
                          label={`Case: ${selectedCaseId}`}
                          size="small"
                          sx={{ fontWeight: 'bold', fontFamily: 'monospace', bgcolor: '#f5f5f5', height: 28 }}
                      />
                      )}
                      <Button 
                      variant="outlined" 
                      size="small" 
                      startIcon={<RefreshIcon />}
                      onClick={() => selectedCaseId && handleCaseSelect(selectedCaseId)}
                      disabled={!selectedCaseId || loading}
                      sx={{ fontWeight: 600 }}
                      >
                      Reload
                      </Button>
                      <Button 
                      variant="contained" 
                      size="small" 
                      disableElevation 
                      color="primary" 
                      startIcon={<FileTextIcon />}
                      disabled={!facts}
                      sx={{ fontWeight: '600' }}
                      >
                      Export Report
                      </Button>
                  </Stack>
                  }
              />
          }
      >
        {/* ✅ Main Content Area */}
        <Box sx={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
          
          {/* LEFT SIDEBAR: Case Selector & Facts */}
          <Paper 
            elevation={0} 
            sx={{ 
              width: 340, 
              flexShrink: 0, 
              borderRight: '1px solid #e0e0e0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              bgcolor: '#fff'
            }}
          >
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa' }}>
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ShieldIcon sx={{ fontSize: 14 }} />
                Active Case
              </Typography>
              
              <FormControl fullWidth size="small">
                <Select 
                  value={selectedCaseId} 
                  onChange={(e) => handleCaseSelect(e.target.value)}
                  displayEmpty
                  sx={{ bgcolor: 'white' }}
                >
                  <MenuItem value="">
                    <em>Select case...</em>
                  </MenuItem>
                  {displayCases.map((c, i) => (
                    <MenuItem key={i} value={getCaseId(c)}>
                      {getCaseId(c)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {caseScope.type !== 'GLOBAL' && (
                <Paper 
                  variant="outlined" 
                  sx={{ 
                    mt: 2, 
                    p: 1.5, 
                    bgcolor: '#e3f2fd', 
                    borderColor: '#90caf9',
                    border: '2px solid'
                  }}
                >
                  <Typography variant="caption" fontWeight="bold" color="primary.main" display="block">
                    {caseScope.value}
                  </Typography>
                  <Typography variant="caption" color="primary.dark">
                    {caseScope.caseCount} cases in scope
                  </Typography>
                </Paper>
              )}
            </Box>

            {/* Case Facts Summary (Scrollable) */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              {!selectedCaseId ? (
                  <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      <Typography variant="body2">Select a case to view facts.</Typography>
                  </Box>
              ) : !facts && !loading ? (
                  <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      <Typography variant="body2">No facts loaded.</Typography>
                  </Box>
              ) : loading ? (
                  <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
              ) : (
                  <Stack spacing={2}>
                      {/* Risk Summary */}
                      <Card variant="outlined" sx={{ border: '2px solid #e0e0e0' }}>
                          <Box 
                          onClick={() => toggleSection('risk')}
                          sx={{ 
                              p: 1.5, bgcolor: '#fafafa', cursor: 'pointer',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              '&:hover': { bgcolor: '#f5f5f5' }
                          }}
                          >
                          <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TimelineIcon sx={{ fontSize: 14 }} /> Risk Profile
                          </Typography>
                          <IconButton size="small">{expandedSections.risk ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
                          </Box>
                          {expandedSections.risk && (
                          <CardContent sx={{ p: 2, pt: 1 }}>
                              <Grid container spacing={1.5}>
                              <Grid item xs={12}>
                                  <Paper elevation={0} sx={{ p: 2, textAlign: 'center', border: '2px solid', borderColor: facts.risk.risk_score > 80 ? 'error.main' : facts.risk.risk_score > 50 ? 'warning.main' : 'success.main', bgcolor: facts.risk.risk_score > 80 ? '#ffebee' : facts.risk.risk_score > 50 ? '#fff3e0' : '#e8f5e9' }}>
                                  <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>Risk Score</Typography>
                                  <Typography variant="h3" fontWeight="bold" color={facts.risk.risk_score > 80 ? 'error.main' : facts.risk.risk_score > 50 ? 'warning.main' : 'success.main'} sx={{ lineHeight: 1.2 }}>{facts.risk.risk_score}</Typography>
                                  <LinearProgress variant="determinate" value={facts.risk.risk_score} sx={{ mt: 1, height: 6, borderRadius: 1, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: facts.risk.risk_score > 80 ? 'error.main' : facts.risk.risk_score > 50 ? 'warning.main' : 'success.main' } }} />
                                  </Paper>
                              </Grid>
                              <Grid item xs={6}>
                                  <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', bgcolor: '#fafafa' }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Level</Typography>
                                  <Typography variant="body2" fontWeight="bold">{facts.risk.risk_level}</Typography>
                                  </Paper>
                              </Grid>
                              <Grid item xs={6}>
                                  <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', bgcolor: '#fafafa' }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 'bold' }}>KYC</Typography>
                                  <Typography variant="body2" fontWeight="bold">{facts.risk.kyc_status}</Typography>
                                  </Paper>
                              </Grid>
                              </Grid>
                              {facts.risk.flagged_behaviors?.length > 0 && (
                              <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  {facts.risk.flagged_behaviors.map((b, i) => (
                                  <Chip key={i} label={b} size="small" color="error" icon={<WarningIcon />} sx={{ justifyContent: 'flex-start', fontSize: '0.7rem', height: 24 }} />
                                  ))}
                              </Box>
                              )}
                          </CardContent>
                          )}
                      </Card>

                      {/* Alerts */}
                      <Card variant="outlined" sx={{ border: '2px solid #e0e0e0' }}>
                          <Box 
                          onClick={() => toggleSection('alerts')}
                          sx={{ 
                              p: 1.5, bgcolor: '#fafafa', cursor: 'pointer',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              '&:hover': { bgcolor: '#f5f5f5' }
                          }}
                          >
                          <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <NotificationsIcon sx={{ fontSize: 14 }} /> Alert History
                          </Typography>
                          <IconButton size="small">{expandedSections.alerts ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
                          </Box>
                          {expandedSections.alerts && (
                          <CardContent sx={{ p: 2, pt: 1 }}>
                              <Stack spacing={1.5}>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #e0e0e0' }}>
                                  <Typography variant="caption" color="text.secondary">Total Alerts</Typography>
                                  <Typography variant="body2" fontWeight="bold">{facts.alerts.total_alerts}</Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #e0e0e0' }}>
                                  <Typography variant="caption" color="text.secondary">Critical</Typography>
                                  <Typography variant="body2" fontWeight="bold" color="error.main">{facts.alerts.critical_alerts}</Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between">
                                  <Typography variant="caption" color="text.secondary">Latest Alert</Typography>
                                  <Typography variant="caption" fontFamily="monospace" fontWeight="600">{new Date(facts.alerts.latest_alert).toLocaleDateString()}</Typography>
                              </Stack>
                              </Stack>
                          </CardContent>
                          )}
                      </Card>

                      {/* Transactions */}
                      <Card variant="outlined" sx={{ border: '2px solid #e0e0e0' }}>
                          <Box 
                          onClick={() => toggleSection('transactions')}
                          sx={{ 
                              p: 1.5, bgcolor: '#fafafa', cursor: 'pointer',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              '&:hover': { bgcolor: '#f5f5f5' }
                          }}
                          >
                          <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TrendingUpIcon sx={{ fontSize: 14 }} /> 30-Day Activity
                          </Typography>
                          <IconButton size="small">{expandedSections.transactions ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
                          </Box>
                          {expandedSections.transactions && (
                          <CardContent sx={{ p: 2, pt: 1 }}>
                              <Stack spacing={1.5}>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #e0e0e0' }}>
                                  <Typography variant="caption" color="text.secondary">Total Volume</Typography>
                                  <Typography variant="body2" fontWeight="bold" fontFamily="monospace">{Number(facts.transactions.total_volume || 0).toLocaleString()}</Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" sx={{ pb: 1, borderBottom: '1px solid #e0e0e0' }}>
                                  <Typography variant="caption" color="text.secondary">Avg Transaction</Typography>
                                  <Typography variant="body2" fontWeight="bold" fontFamily="monospace">{Number(facts.transactions.avg_amount || 0).toFixed(2)}</Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between">
                                  <Typography variant="caption" color="text.secondary">Cash Ratio</Typography>
                                  <Typography variant="body2" fontWeight="bold" fontFamily="monospace" color={facts.transactions.cash_ratio > 0.3 ? 'error.main' : 'success.main'}>{(facts.transactions.cash_ratio * 100).toFixed(1)}%</Typography>
                              </Stack>
                              </Stack>
                          </CardContent>
                          )}
                      </Card>
                  </Stack>
              )}
            </Box>
          </Paper>

          {/* CENTER/RIGHT: Copilot Interface */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#f5f7fa' }}>
            
            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <Stack spacing={2} alignItems="center">
                  <CircularProgress size={48} />
                  <Typography variant="body2" color="text.secondary">Loading case data...</Typography>
                </Stack>
              </Box>
            )}

            {!loading && !selectedCaseId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, p: 6 }}>
                <Box sx={{ width: 80, height: 80, bgcolor: '#f5f5f5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e0e0e0', mb: 3 }}>
                  <ShieldIcon sx={{ fontSize: 40, color: '#bdbdbd' }} />
                </Box>
                <Typography variant="h6" fontWeight="600" color="text.primary" gutterBottom>Select a Case to Begin</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>Copilot will analyze deterministic facts and provide AI-assisted investigation support.</Typography>
                <Button onClick={() => setShowManual(true)} startIcon={<HelpOutline />} sx={{ mt: 3 }} variant="outlined">Read User Guide</Button>
              </Box>
            )}

            {!loading && selectedCaseId && facts && (
              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                
                {/* Chat Header */}
                <Box sx={{ p: 2, background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e40af', flexShrink: 0 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box sx={{ width: 36, height: 36, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SmartToyIcon /></Box>
                    <Box>
                      <Typography variant="subtitle2" fontWeight="bold">AI Copilot</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>Powered by LLaMA 3.2</Typography>
                    </Box>
                  </Stack>
                  <Chip label={`${messages.length} messages`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'white', height: 24, fontSize: '0.7rem', fontWeight: 'bold' }} />
                </Box>

                {/* Messages Area - SCROLLABLE */}
                <Box sx={{ flex: 1, overflowY: 'auto', p: 3, bgcolor: '#fafafa' }}>
                  <Stack spacing={2}>
                    {messages.map((msg, idx) => (
                      <Stack key={idx} direction={msg.role === 'user' ? 'row-reverse' : 'row'} spacing={1.5} alignItems="flex-start">
                        <Box sx={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, bgcolor: msg.role === 'user' ? '#1976d2' : msg.role === 'system' ? '#388e3c' : msg.role === 'error' ? '#d32f2f' : '#424242', color: 'white', border: '2px solid', borderColor: msg.role === 'user' ? '#1565c0' : msg.role === 'system' ? '#2e7d32' : msg.role === 'error' ? '#c62828' : '#212121' }}>
                          {msg.role === 'user' ? <PersonIcon fontSize="small" /> : msg.role === 'error' ? <ErrorIcon fontSize="small" /> : msg.role === 'system' ? <CheckCircleIcon fontSize="small" /> : <SmartToyIcon fontSize="small" />}
                        </Box>
                        <Box sx={{ maxWidth: '75%', minWidth: 200 }}>
                          <Paper elevation={msg.role === 'user' ? 2 : 0} variant={msg.role === 'user' ? 'elevation' : 'outlined'} sx={{ p: 2, bgcolor: msg.role === 'user' ? '#1976d2' : msg.role === 'system' ? '#e8f5e9' : msg.role === 'error' ? '#ffebee' : 'white', color: msg.role === 'user' ? 'white' : 'text.primary', borderWidth: 2, borderColor: msg.role === 'system' ? '#81c784' : msg.role === 'error' ? '#e57373' : '#e0e0e0' }}>
                            
                            {/* Use Markdown Component here */}
                            {msg.role === 'user' ? (
                              <Typography variant="body2" sx={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
                            ) : (
                              <MarkdownResponse content={msg.content} />
                            )}
                            
                            <Typography variant="caption" sx={{ mt: 1, display: 'block', opacity: 0.7, fontSize: '0.65rem', color: msg.role === 'user' ? 'rgba(255,255,255,0.9)' : 'text.secondary' }}>{msg.timestamp?.toLocaleTimeString()}</Typography>
                          </Paper>
                        </Box>
                      </Stack>
                    ))}
                    
                    {generating && (
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box sx={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#424242', color: 'white', border: '2px solid #212121' }}><SmartToyIcon fontSize="small" /></Box>
                        <Paper variant="outlined" sx={{ p: 2, borderWidth: 2, borderColor: '#e0e0e0' }}>
                          <Stack direction="row" spacing={0.5}><CircularProgress size={8} /><CircularProgress size={8} /><CircularProgress size={8} /></Stack>
                        </Paper>
                      </Stack>
                    )}
                    <div ref={chatEndRef}/>
                  </Stack>
                </Box>

                {/* Quick Actions & Input - FIXED AT BOTTOM */}
                <Box sx={{ borderTop: '1px solid #e0e0e0', bgcolor: 'white', flexShrink: 0 }}>
                  <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', fontSize: '0.65rem', px: 0.5 }}>Quick Actions</Typography>
                      <Stack direction="row" spacing={1} overflow="auto" pb={0.5} px={0.5}>
                          {[{ label: 'Draft SAR Narrative', icon: FileTextIcon }, { label: 'Explain Risk Drivers', icon: TimelineIcon }, { label: 'Suggest Next Steps', icon: BoltIcon }, { label: 'Compare to Baseline', icon: TrendingUpIcon }].map(action => (
                              <Button key={action.label} onClick={() => sendMessage(action.label)} disabled={generating} size="small" variant="outlined" startIcon={<action.icon fontSize="small" />} sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{action.label}</Button>
                          ))}
                      </Stack>
                  </Box>
                  <Box sx={{ p: 2 }}>
                      <TextField
                          fullWidth multiline maxRows={3} placeholder="Ask about this case..." value={input} onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                          disabled={generating} variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fafafa', '& fieldset': { borderWidth: 1 } } }}
                          InputProps={{
                              endAdornment: (
                                  <InputAdornment position="end">
                                      <Button onClick={() => sendMessage(input)} disabled={!input.trim() || generating} variant="contained" size="medium" sx={{ minWidth: 80, fontWeight: 'bold', boxShadow: 1 }} endIcon={<SendIcon />}>Send</Button>
                                  </InputAdornment>
                              )
                          }}
                      />
                      <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block', fontSize: '0.7rem', textAlign: 'center' }}>Press Enter to send, Shift+Enter for new line</Typography>
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
