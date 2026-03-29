// src/tools/investigation/screens/analysis/BaselineAnalysisScreen.jsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";
import { formatNumber, toNumber } from "@investigation/utils/format";
import { mergeCaseResolutionModule } from '../../utils/caseResolutionStore';

import PageContainer from "@investigation-layout/PageContainer";
import {
  Box, Button, Card, CardContent, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Chip, CircularProgress, TextField, Tabs, Tab, Divider, Alert, List, ListItem, ListItemText, Collapse, Tooltip, Grid, Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';

import {
  TrendingUp as TrendingUpIcon, CheckCircle as CheckCircleIcon, MenuBook as BookOpenIcon, Close as CloseIcon, ShowChart as ActivityIcon, ArrowForward as ArrowRightIcon, Warning as AlertTriangleIcon, Security as ShieldIcon, GpsFixed as TargetIcon, People as UsersIcon, AccessTime as ClockIcon, TrendingDown as TrendingDownIcon, BarChart as BarChart3Icon, Bolt as ZapIcon, Error as AlertCircleIcon, Info as InfoIcon, ExpandMore as ChevronDownIcon, ExpandLess as ChevronUpIcon, Description as FileTextIcon, CalendarToday as CalendarIcon, AttachMoney as DollarSignIcon, ArrowUpward as ArrowUpRightIcon, ArrowDownward as ArrowDownRightIcon, CompareArrows as GitCompareIcon, Visibility as EyeIcon, Download as DownloadIcon, Refresh as RefreshCwIcon, Layers as LayersIcon, Hub as NetworkIcon, PieChart as PieChartIcon, Help as HelpCircleIcon, Assessment as FileBarChartIcon, Search as SearchIcon, FilterList as FilterIcon
} from '@mui/icons-material';

const BaselineAnalysisScreen = () => {
  const { caseList, loadCaseList } = useAppContext();
  
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisMode, setAnalysisMode] = useState('comprehensive');
  const [viewMode, setViewMode] = useState(0);
  
  const [results, setResults] = useState(null);
  const [customerHistory, setCustomerHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [showManual, setShowManual] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({});

  useEffect(() => { 
    if (caseList.length === 0) {
      loadCaseList(); 
    }
  }, []);

  useEffect(() => { 
    if (caseList.length > 0 && !selectedCaseId) {
      const firstCase = caseList[0];
      setSelectedCaseId(firstCase.case_id || firstCase.caseid || firstCase.id);
    }
  }, [caseList]);

  const runAnalysis = async () => {
    if (!selectedCaseId) return;
    
    setIsLoading(true); 
    setError(null); 
    setResults(null);
    setCustomerHistory([]);
    
    try {
      const res = await apiClient.post('/api/v2/analysis/baseline/detect-deviations', { 
        case_id: selectedCaseId,
        analysis_mode: analysisMode
      });
      
      if (res.error) throw new Error(res.error);
      
      setResults(res);
      mergeCaseResolutionModule(selectedCaseId, 'baseline', {
        analysis_mode: analysisMode,
        deviations: Array.isArray(res?.deviations) ? res.deviations.slice(0, 12) : [],
        deviation_score: res?.deviation_score,
        deviation_level: res?.deviation_level,
        baseline_summary: res?.baseline_summary || null,
        current_summary: res?.current_summary || null,
        insights: Array.isArray(res?.insights) ? res.insights.slice(0, 8) : [],
        customer_id: res?.customer_id || null,
      });
      
      if (res.customer_id) {
        try {
          const historyRes = await apiClient.get(`/api/v2/analysis/baseline/customer-history/${res.customer_id}`);
          if (historyRes.history) {
            setCustomerHistory(historyRes.history);
            mergeCaseResolutionModule(selectedCaseId, 'baseline', {
              customer_history: Array.isArray(historyRes.history) ? historyRes.history.slice(0, 12) : [],
            });
          }
        } catch (e) {
          console.warn('Historical data fetch failed silently:', e);
        }
      }
      
    } catch (err) { 
      console.error("Analysis Execution Error:", err);
      setError(err.message || 'Statistical analysis service failed. Please contact IT support.'); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const exportResults = () => {
    if (!results) return;
    
    const exportData = {
      meta: {
        generated_at: new Date().toISOString(),
        environment: "production",
        version: "2.4.0"
      },
      context: {
        case_id: results.case_id,
        customer_id: results.customer_id,
        analyst_action: "manual_export"
      },
      metrics: {
        deviation_score: results.deviation_score,
        deviation_level: results.deviation_level,
      },
      data: {
        deviations: results.deviations,
        baseline_summary: results.baseline_summary,
        current_summary: results.current_summary
      }
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AML_Baseline_Report_${results.case_id}_${Date.now()}.json`;
    a.click();
  };

  const getSeverityColor = (severity) => {
    switch(severity?.toLowerCase()) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      case 'medium': return 'info';
      case 'low': return 'success';
      default: return 'default';
    }
  };

  const deviationsByCategory = results?.deviations?.reduce((acc, dev) => {
    const category = dev.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(dev);
    return acc;
  }, {}) || {};

  const getCaseId = (item) => item.case_id || item.caseid || item.id || 'ERR_NO_ID';

  return (
    <PageContainer
      title="Baseline Analysis" 
      subtitle="Statistical deviation detection & behavioral profiling"
      breadcrumbs={['Analysis', 'Baseline']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Button 
            variant="text" 
            size="small" 
            color="secondary" 
            startIcon={<BookOpenIcon />} 
            onClick={() => setShowManual(true)}
          >
            Methodology
          </Button>
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<DownloadIcon />} 
            onClick={exportResults}
            disabled={!results}
          >
            Export
          </Button>
          <Button 
            variant="contained" 
            size="small" 
            disableElevation 
            color="primary" 
            startIcon={isLoading ? <CircularProgress size={16} color="inherit"/> : <ActivityIcon />}
            onClick={runAnalysis}
            disabled={isLoading || !selectedCaseId}
            sx={{ fontWeight: '600' }}
          >
            {isLoading ? 'Processing...' : 'Run Analysis'}
          </Button>
        </Stack>
      }
    >
      {/* MAIN CONTENT AREA - No extra padding, flex container */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 180px)' }}>
        
        {/* LEFT SIDEBAR: Configuration & History */}
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
              <FilterIcon sx={{ fontSize: 14 }} />
              Analysis Parameters
            </Typography>
            
            <Stack spacing={2.5}>
              <FormControl size="small" fullWidth>
                <InputLabel>Target Case ID</InputLabel>
                <Select 
                  value={selectedCaseId} 
                  onChange={e => setSelectedCaseId(e.target.value)}
                  label="Target Case ID"
                >
                  {caseList.map((c, idx) => (
                    <MenuItem key={idx} value={getCaseId(c)}>
                      {getCaseId(c)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', mb: 1.5, display: 'block' }}>
                  Scanning Depth
                </Typography>
                <Stack spacing={1}>
                  <AnalysisModeCard 
                    active={analysisMode === 'quick'} 
                    onClick={() => setAnalysisMode('quick')}
                    label="Quick Scan"
                    desc="Heuristic Check"
                    icon={ZapIcon}
                  />
                  <AnalysisModeCard 
                    active={analysisMode === 'comprehensive'} 
                    onClick={() => setAnalysisMode('comprehensive')}
                    label="Comprehensive"
                    desc="Full Statistical Model"
                    icon={LayersIcon}
                  />
                  <AnalysisModeCard 
                    active={analysisMode === 'deep'} 
                    onClick={() => setAnalysisMode('deep')}
                    label="Deep Dive"
                    desc="Peer Group & Network"
                    icon={NetworkIcon}
                  />
                </Stack>
              </Box>
            </Stack>
          </Box>

          {/* Historical Logs */}
          {customerHistory.length > 0 && (
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
              <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ClockIcon sx={{ fontSize: 14 }} />
                  Previous Scans
                </Typography>
                <Chip label={customerHistory.length} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
              </Box>
              <List sx={{ py: 0 }}>
                {customerHistory.slice(0, 8).map((item, idx) => (
                  <ListItem 
                    key={idx} 
                    divider
                    sx={{ 
                      py: 1.5, 
                      cursor: 'pointer',
                      '&:hover': { bgcolor: '#f5f5f5' }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="caption" fontWeight="600">
                            {new Date(item.analysis_date).toLocaleDateString()}
                          </Typography>
                          <ScoreBadge level={item.deviation_level} score={item.deviation_score} />
                        </Stack>
                      }
                      secondary={
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
                          ID: {item.analysis_id || 'N/A'}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {/* Severity Legend */}
          <Paper 
            elevation={0}
            sx={{ 
              m: 2, 
              mt: 'auto',
              p: 2, 
              bgcolor: '#1a1a1a',
              color: '#e0e0e0',
              borderRadius: 2
            }}
          >
            <Typography variant="caption" fontWeight="bold" sx={{ textTransform: 'uppercase', fontSize: '0.65rem', mb: 2, display: 'block', color: '#9e9e9e' }}>
              Risk Scoring Legend
            </Typography>
            <Stack spacing={1.5}>
              <LegendItem color="#ef5350" label="Critical (75-100)" desc="Immediate Escalation" />
              <LegendItem color="#ff9800" label="High (50-74)" desc="Enhanced Due Diligence" />
              <LegendItem color="#fdd835" label="Medium (25-49)" desc="Standard Review" />
              <LegendItem color="#66bb6a" label="Low (0-24)" desc="Normal Behavior" />
            </Stack>
          </Paper>
        </Paper>

        {/* CENTER/RIGHT: Main Analysis View */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#f5f7fa' }}>
          
          {/* Error State */}
          {error && (
            <Box sx={{ position: 'absolute', inset: 0, zIndex: 50, bgcolor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
              <Card sx={{ maxWidth: 480, textAlign: 'center' }} elevation={4}>
                <CardContent sx={{ p: 4 }}>
                  <Box sx={{ width: 56, height: 56, bgcolor: '#ffebee', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3 }}>
                    <AlertCircleIcon sx={{ fontSize: 32, color: 'error.main' }} />
                  </Box>
                  <Typography variant="h6" fontWeight="bold" gutterBottom>
                    Analysis Failed
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
                    {error}
                  </Typography>
                  <Button 
                    variant="contained" 
                    color="error"
                    onClick={() => setError(null)}
                  >
                    Dismiss & Retry
                  </Button>
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Empty State */}
          {!results && !isLoading && !error && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, p: 6 }}>
              <Box sx={{ width: 80, height: 80, bgcolor: '#f5f5f5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e0e0e0', mb: 3 }}>
                <FileBarChartIcon sx={{ fontSize: 40, color: '#bdbdbd' }} />
              </Box>
              <Typography variant="h6" fontWeight="600" color="text.primary" gutterBottom>
                Awaiting Input
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
                Select a case identifier from the configuration panel to initiate the statistical baseline comparison model.
              </Typography>
            </Box>
          )}

          {/* Loading State */}
          {isLoading && (
            <Box sx={{ position: 'absolute', inset: 0, zIndex: 40, bgcolor: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={40} sx={{ mb: 3 }} />
              <Typography variant="body1" fontWeight="600" gutterBottom>
                Processing Transactional History...
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Calculating standard deviations & Z-Scores
              </Typography>
            </Box>
          )}

          {/* Results Content */}
          {results && !isLoading && (
            <>
              {/* Tabs Header */}
              <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#fff', px: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Tabs value={viewMode} onChange={(e, v) => setViewMode(v)} sx={{ minHeight: 48 }}>
                  <Tab 
                    label="Executive Summary" 
                    icon={<PieChartIcon fontSize="small" />} 
                    iconPosition="start"
                    sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                  />
                  <Tab 
                    label="Line Item Details" 
                    icon={<FileTextIcon fontSize="small" />} 
                    iconPosition="start"
                    sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                  />
                  <Tab 
                    label="AI Findings" 
                    icon={<ShieldIcon fontSize="small" />} 
                    iconPosition="start"
                    sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                  />
                </Tabs>

                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
                      Analysis Subject
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace', display: 'block' }}>
                      {results.customer_id}
                    </Typography>
                  </Box>
                  {results.peer_comparison && (
                    <Tooltip title="Peer Comparison Active">
                      <Box sx={{ width: 36, height: 36, bgcolor: '#f3e5f5', color: '#9c27b0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e1bee7' }}>
                        <UsersIcon sx={{ fontSize: 18 }} />
                      </Box>
                    </Tooltip>
                  )}
                </Stack>
              </Box>

              {/* Scrollable Content */}
              <Box sx={{ flexGrow: 1, overflowY: 'auto', bgcolor: '#fafafa', p: 4 }}>
                
                {/* Tab Panel 0: Overview */}
                {viewMode === 0 && (
                  <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
                    <Stack spacing={4}>
                      
                      {/* Risk Scorecard */}
                      <RiskScorecard results={results} />

                      {/* Deviations */}
                      <Box>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3, pb: 1.5, borderBottom: '2px solid #e0e0e0' }}>
                          <Typography variant="subtitle1" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <AlertTriangleIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                            Deviation Inventory
                          </Typography>
                          <Chip 
                            label={`${results.deviations?.length || 0} Records`} 
                            size="small" 
                            sx={{ fontWeight: 'bold', bgcolor: '#f5f5f5' }}
                          />
                        </Stack>

                        {results.deviations?.length === 0 ? (
                          <Card sx={{ border: '2px dashed #e0e0e0' }}>
                            <CardContent sx={{ py: 8, textAlign: 'center' }}>
                              <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main', opacity: 0.8, mb: 2 }} />
                              <Typography variant="body1" fontWeight="600" gutterBottom>
                                No Material Deviations
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Transactional behavior remains within 2σ (Standard Deviations) of the baseline.
                              </Typography>
                            </CardContent>
                          </Card>
                        ) : (
                          <Stack spacing={2}>
                            {Object.entries(deviationsByCategory).map(([category, devs]) => {
                              const isExpanded = expandedCategories[category];
                              const hasCritical = devs.some(d => d.severity === 'critical');
                              const hasHigh = devs.some(d => d.severity === 'high');
                              
                              return (
                                <Accordion 
                                  key={category}
                                  expanded={isExpanded}
                                  onChange={() => toggleCategory(category)}
                                  sx={{ 
                                    border: '1px solid #e0e0e0',
                                    '&:before': { display: 'none' },
                                    boxShadow: isExpanded ? 2 : 0
                                  }}
                                >
                                  <AccordionSummary expandIcon={<ChevronDownIcon />}>
                                    <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%', pr: 2 }}>
                                      <Box sx={{ 
                                        width: 4, 
                                        height: 36, 
                                        borderRadius: 1,
                                        bgcolor: hasCritical ? 'error.main' : hasHigh ? 'warning.main' : 'primary.main'
                                      }} />
                                      <Box sx={{ flexGrow: 1 }}>
                                        <Typography variant="body2" fontWeight="bold">
                                          {category}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                                          {devs.length} Exception{devs.length !== 1 ? 's' : ''}
                                        </Typography>
                                      </Box>
                                      {hasCritical && (
                                        <Chip 
                                          label="Critical Found" 
                                          color="error" 
                                          size="small" 
                                          sx={{ height: 22, fontSize: '0.65rem', fontWeight: 'bold' }}
                                        />
                                      )}
                                    </Stack>
                                  </AccordionSummary>
                                  <AccordionDetails sx={{ bgcolor: '#fafafa', pt: 0 }}>
                                    <Stack spacing={2}>
                                      {devs.map((dev, idx) => (
                                        <DeviationCard key={idx} deviation={dev} getSeverityColor={getSeverityColor} />
                                      ))}
                                    </Stack>
                                  </AccordionDetails>
                                </Accordion>
                              );
                            })}
                          </Stack>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                )}

                {/* Tab Panel 1: Detailed */}
                {viewMode === 1 && (
                  <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        Full Exception Log
                      </Typography>
                      <Button size="small" variant="text" color="primary">
                        Download CSV
                      </Button>
                    </Stack>
                    <Stack spacing={2}>
                      {results.deviations?.map((dev, idx) => (
                        <DeviationCard key={idx} deviation={dev} detailed getSeverityColor={getSeverityColor} />
                      ))}
                    </Stack>
                  </Box>
                )}

                {/* Tab Panel 2: Insights */}
                {viewMode === 2 && (
                  <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
                    <Stack spacing={4}>
                      
                      {/* AI Header */}
                      <Paper 
                        elevation={3}
                        sx={{ 
                          background: 'linear-gradient(135deg, #1a237e 0%, #311b92 100%)',
                          color: 'white',
                          p: 4,
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <Box sx={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: '50%', filter: 'blur(60px)' }} />
                        <Box sx={{ position: 'relative', zIndex: 1 }}>
                          <Typography variant="h6" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                            <ZapIcon sx={{ color: '#fdd835' }} />
                            Automated Investigator Findings
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)', maxWidth: 700, lineHeight: 1.7 }}>
                            The system has correlated statistical deviations with known AML typologies. 
                            Please review the generated insights below for SAR narrative construction.
                          </Typography>
                        </Box>
                      </Paper>

                      {/* Insights */}
                      <Stack spacing={2}>
                        {results.insights?.length === 0 ? (
                          <Card variant="outlined" sx={{ border: '2px dashed #e0e0e0' }}>
                            <CardContent sx={{ py: 6, textAlign: 'center' }}>
                              <InfoIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 2, opacity: 0.5 }} />
                              <Typography variant="body2" color="text.secondary">
                                No specific typological patterns matched for insights generation.
                              </Typography>
                            </CardContent>
                          </Card>
                        ) : (
                          results.insights?.map((insight, idx) => (
                            <InsightCard key={idx} insight={insight} />
                          ))
                        )}
                      </Stack>

                      {/* Recommendations */}
                      <Card variant="outlined">
                        <CardContent sx={{ p: 3 }}>
                          <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, pb: 2, borderBottom: '1px solid #e0e0e0' }}>
                            <CheckCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                            Protocol Recommendations
                          </Typography>
                          <Stack spacing={2}>
                            {results.deviation_level === 'Critical' ? (
                              <>
                                <RecommendationStep step="01" text="Escalate case to Senior Investigator (L2) immediately." critical />
                                <RecommendationStep step="02" text="Initiate temporary account freeze pending EDD documentation." critical />
                                <RecommendationStep step="03" text="Prepare draft SAR filing for review within 24 hours." critical />
                              </>
                            ) : (
                              <>
                                <RecommendationStep step="01" text="Review individual transaction patterns for business legitimacy." />
                                <RecommendationStep step="02" text="Check public records for adverse media on counter-parties." />
                              </>
                            )}
                          </Stack>
                        </CardContent>
                      </Card>
                    </Stack>
                  </Box>
                )}

              </Box>
            </>
          )}
        </Box>

      </Box>

      {/* Methodology Modal */}
      <MethodologyModal open={showManual} onClose={() => setShowManual(false)} />

    </PageContainer>
  );
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const AnalysisModeCard = ({ active, onClick, label, desc, icon: Icon }) => (
  <Card 
    onClick={onClick}
    variant={active ? 'elevation' : 'outlined'}
    elevation={active ? 2 : 0}
    sx={{ 
      cursor: 'pointer',
      border: active ? '2px solid' : '1px solid',
      borderColor: active ? 'primary.main' : 'divider',
      bgcolor: active ? 'primary.50' : 'white',
      transition: 'all 0.2s',
      '&:hover': { 
        borderColor: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? 'primary.50' : '#fafafa'
      }
    }}
  >
    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Icon sx={{ fontSize: 18, color: active ? 'primary.main' : 'text.disabled', mt: 0.25 }} />
      <Box>
        <Typography variant="body2" fontWeight="bold" color={active ? 'primary.main' : 'text.primary'}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          {desc}
        </Typography>
      </Box>
    </CardContent>
  </Card>
);

const ScoreBadge = ({ level, score }) => {
  const getColor = () => {
    if (level === 'Critical') return 'error';
    if (level === 'High') return 'warning';
    if (level === 'Medium') return 'info';
    if (level === 'Low') return 'success';
    return 'default';
  };

  return (
    <Chip 
      label={score} 
      color={getColor()} 
      size="small" 
      sx={{ 
        fontFamily: 'monospace', 
        fontWeight: 'bold',
        height: 20,
        fontSize: '0.7rem'
      }}
    />
  );
};

const LegendItem = ({ color, label, desc }) => (
  <Stack direction="row" spacing={1.5} alignItems="center">
    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
    <Box sx={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
      <Typography variant="caption" sx={{ color: '#e0e0e0', display: 'block' }}>
        {label}
      </Typography>
    </Box>
  </Stack>
);

const RiskScorecard = ({ results }) => {
  const getScoreColor = (score) => {
    if (score >= 75) return 'error.main';
    if (score >= 50) return 'warning.main';
    if (score >= 25) return 'info.main';
    return 'primary.main';
  };

  return (
    <Card elevation={1}>
      <CardContent sx={{ p: 4 }}>
        <Grid container spacing={4} alignItems="center">
          
          {/* Left: Summary */}
          <Grid item xs={12} md={8}>
            <Stack spacing={3}>
              <Box>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="h6" fontWeight="bold">
                    Composite Risk Assessment
                  </Typography>
                  <Chip 
                    label={`${results.deviation_level} Level`}
                    color={results.deviation_level === 'Critical' ? 'error' : results.deviation_level === 'High' ? 'warning' : 'default'}
                    size="small"
                    sx={{ fontWeight: 'bold', fontSize: '0.7rem', textTransform: 'uppercase' }}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 600, lineHeight: 1.6 }}>
                  Comparison of recent activity ({results.current_summary.transaction_count} txns) against 
                  a {results.baseline_summary.date_range.split(' ')[0]} day moving average baseline.
                </Typography>
              </Box>

              <Grid container spacing={4}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                    Baseline Average
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="baseline">
                    <Typography variant="h5" fontWeight="600">
                      {formatNumber(
                        (toNumber(results.baseline_summary.total_volume) ?? 0) /
                          Math.max(1, toNumber(results.baseline_summary.transaction_count) ?? 0),
                        { decimals: 2 }
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      / txn
                    </Typography>
                  </Stack>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ pl: 3, borderLeft: '1px solid #e0e0e0' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                      Current Average
                    </Typography>
                    <Stack direction="row" spacing={0.5} alignItems="baseline">
                      <Typography variant="h5" fontWeight="bold">
                        {formatNumber(
                          (toNumber(results.current_summary.total_volume) ?? 0) /
                            Math.max(1, toNumber(results.current_summary.transaction_count) ?? 0),
                          { decimals: 2 }
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        / txn
                      </Typography>
                    </Stack>
                  </Box>
                </Grid>
              </Grid>
            </Stack>
          </Grid>

          {/* Right: Score Gauge */}
          <Grid item xs={12} md={4}>
            <Paper 
              elevation={0}
              sx={{ 
                bgcolor: '#fafafa',
                border: '1px solid #e0e0e0',
                p: 3,
                textAlign: 'center',
                borderRadius: 2
              }}
            >
              <Typography variant="h2" fontWeight="bold" sx={{ color: getScoreColor(results.deviation_score), mb: 0.5 }}>
                {results.deviation_score}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: 1.5 }}>
                Anomaly Score
              </Typography>
              <LinearProgress 
                variant="determinate" 
                value={results.deviation_score} 
                sx={{ 
                  mt: 2, 
                  height: 6, 
                  borderRadius: 1,
                  bgcolor: '#e0e0e0',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: getScoreColor(results.deviation_score)
                  }
                }}
              />
            </Paper>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

const DeviationCard = ({ deviation, detailed = false, getSeverityColor }) => {
  const severityColor = getSeverityColor(deviation.severity);

  return (
    <Card variant="outlined" sx={{ position: 'relative', overflow: 'visible', '&:hover': { boxShadow: 2 } }}>
      <Box sx={{ 
        position: 'absolute', 
        left: 0, 
        top: 0, 
        bottom: 0, 
        width: 4, 
        bgcolor: `${severityColor}.main`,
        borderRadius: '4px 0 0 4px'
      }} />
      <CardContent sx={{ pl: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip 
                label={deviation.severity}
                color={severityColor}
                size="small"
                sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase' }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {deviation.category}
              </Typography>
            </Stack>
            <Typography variant="body2" fontWeight="bold">
              {deviation.type?.replace(/_/g, ' ')}
            </Typography>
          </Box>
          <Typography variant="body2" fontWeight="bold" color={`${severityColor}.main`}>
            +{deviation.score} pts
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>
          {deviation.message}
        </Typography>

        <Paper elevation={0} sx={{ bgcolor: '#fafafa', p: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                Baseline (180d)
              </Typography>
              <Typography variant="body2" fontWeight="600" sx={{ fontFamily: 'monospace' }}>
                {deviation.baseline_value}
              </Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                Current (30d)
              </Typography>
              <Typography variant="body2" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>
                {deviation.current_value}
              </Typography>
            </Grid>
            {deviation.change_pct !== null && (
              <Grid item xs={4}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                  Variance
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {deviation.change_pct > 0 ? <ArrowUpRightIcon fontSize="small" color="error" /> : <ArrowDownRightIcon fontSize="small" color="success" />}
                  <Typography variant="body2" fontWeight="bold" color={deviation.change_pct > 0 ? 'error.main' : 'success.main'} sx={{ fontFamily: 'monospace' }}>
                    {Math.abs(deviation.change_pct)}%
                  </Typography>
                </Stack>
              </Grid>
            )}
          </Grid>
        </Paper>

        {detailed && deviation.investigator_note && (
          <Alert severity="info" sx={{ mt: 2, fontSize: '0.85rem' }}>
            <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 0.5 }}>
              System Annotation:
            </Typography>
            {deviation.investigator_note}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

const InsightCard = ({ insight }) => {
  const getSeverity = () => {
    if (insight.type === 'critical') return 'error';
    if (insight.type === 'warning') return 'warning';
    return 'info';
  };

  return (
    <Alert 
      severity={getSeverity()} 
      variant="outlined"
      sx={{ 
        border: 2,
        '& .MuiAlert-message': { width: '100%' }
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Typography variant="body2" fontWeight="bold">
          {insight.message}
        </Typography>
        {insight.category && (
          <Chip 
            label={insight.category}
            size="small"
            sx={{ 
              height: 20, 
              fontSize: '0.65rem', 
              fontWeight: 'bold',
              textTransform: 'uppercase',
              borderRadius: 1
            }}
          />
        )}
      </Stack>
      <Paper elevation={0} sx={{ bgcolor: 'background.paper', p: 1.5, border: '1px solid rgba(0,0,0,0.06)' }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
          <strong>Suggested Action:</strong> {insight.action}
        </Typography>
      </Paper>
    </Alert>
  );
};

const RecommendationStep = ({ step, text, critical }) => (
  <Stack direction="row" spacing={2} alignItems="flex-start">
    <Typography 
      variant="caption" 
      fontWeight="bold" 
      sx={{ 
        fontFamily: 'monospace',
        color: critical ? 'error.main' : 'text.secondary',
        fontSize: '0.85rem'
      }}
    >
      {step}
    </Typography>
    <Typography variant="body2" color={critical ? 'error.main' : 'text.primary'} sx={{ flex: 1 }}>
      {text}
    </Typography>
  </Stack>
);

const MethodologyModal = ({ open, onClose }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <BookOpenIcon sx={{ fontSize: 28, color: 'primary.main' }} />
              <Typography variant="h6" fontWeight="bold">
                Standard Operating Procedure: Baseline Analysis
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', textTransform: 'uppercase', mt: 0.5, display: 'block' }}>
              Doc Ref: SOP-AML-2025-BL • Revision 4.2
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: 4 }}>
        <Stack spacing={4}>
          
          {/* Section 1 */}
          <Box>
            <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ borderBottom: '2px solid #e0e0e0', pb: 1 }}>
              1.0 Conceptual Framework
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph sx={{ lineHeight: 1.7 }}>
              Baseline Analysis is a quantitative method used to identify potential money laundering activity by comparing a subject's 
              current transactional behavior against a historically established "norm" or baseline. This system utilizes a 
              rolling window approach to ensure that the baseline evolves with legitimate changes in customer behavior while 
              flagging sudden, statistically significant aberrations.
            </Typography>
            <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
              <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 0.5 }}>
                Regulatory Context:
              </Typography>
              This methodology supports compliance with FFIEC BSA/AML Examination Manual 
              requirements regarding "Automated Transaction Monitoring Systems" and the identification of unusual activity 
              that warrants Suspicious Activity Report (SAR) filing under 31 CFR 1020.320.
            </Alert>
          </Box>

          {/* Section 2 */}
          <Box>
            <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ borderBottom: '2px solid #e0e0e0', pb: 1 }}>
              2.0 Statistical Methodology
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  2.1 Z-Score Calculation
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph sx={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
                  The core anomaly detection engine utilizes the Standard Score (Z-Score) formula to normalize deviations across 
                  different transaction types (wires, ACH, cash).
                </Typography>
                <Paper elevation={0} sx={{ bgcolor: '#f5f5f5', p: 2, fontFamily: 'monospace', fontSize: '0.85rem', border: '1px solid #e0e0e0' }}>
                  Z = (x - μ) / σ
                  <br/><br/>
                  Where:
                  <br/>x = Current Period Value
                  <br/>μ = Baseline Mean (180-day)
                  <br/>σ = Baseline Standard Deviation
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  2.2 Threshold Triggers
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemText 
                      primary={<Typography variant="body2" fontWeight="600">Warning (Z &gt; 2.0)</Typography>}
                      secondary={<Typography variant="caption" color="text.secondary">Indicates value is in the 95th percentile of variance. Triggers a "Medium" severity alert.</Typography>}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText 
                      primary={<Typography variant="body2" fontWeight="600">Critical (Z &gt; 3.0)</Typography>}
                      secondary={<Typography variant="caption" color="text.secondary">Indicates value is in the 99.7th percentile (3-sigma event). Triggers a "Critical" severity alert.</Typography>}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText 
                      primary={<Typography variant="body2" fontWeight="600">Velocity Bias</Typography>}
                      secondary={<Typography variant="caption" color="text.secondary">Rapid accumulation of funds (high velocity) applies a 1.5x multiplier to the raw Z-Score.</Typography>}
                    />
                  </ListItem>
                </List>
              </Grid>
            </Grid>
          </Box>

          {/* Section 3 */}
          <Box>
            <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ borderBottom: '2px solid #e0e0e0', pb: 1, mb: 3 }}>
              3.0 Detection Vectors
            </Typography>
            <Grid container spacing={2}>
              {[
                { icon: DollarSignIcon, title: 'Amount Spikes', code: 'VEC-01', desc: 'Single transactions exceeding 3σ of historical max.' },
                { icon: TrendingUpIcon, title: 'Velocity Bursts', code: 'VEC-02', desc: 'High frequency of transactions within a <24h window.' },
                { icon: NetworkIcon, title: 'Counterparty Risk', code: 'VEC-03', desc: 'Flow of funds to previously unseen or high-risk entities.' },
                { icon: ClockIcon, title: 'Temporal Anomalies', code: 'VEC-04', desc: 'Activity occurring during non-standard business hours.' },
                { icon: GitCompareIcon, title: 'Channel Shifts', code: 'VEC-05', desc: 'Sudden migration from traceable (ACH) to opaque (Cash/Wire) channels.' },
                { icon: UsersIcon, title: 'Peer Outliers', code: 'VEC-06', desc: 'Deviation >50% from established peer group median.' }
              ].map((item, idx) => (
                <Grid item xs={12} sm={6} key={idx}>
                  <Card variant="outlined">
                    <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', p: 2, '&:last-child': { pb: 2 } }}>
                      <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1 }}>
                        <item.icon sx={{ fontSize: 20, color: 'text.secondary' }} />
                      </Box>
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" fontWeight="bold">
                            {item.title}
                          </Typography>
                          <Chip 
                            label={item.code} 
                            size="small" 
                            sx={{ 
                              height: 18, 
                              fontSize: '0.65rem', 
                              fontFamily: 'monospace', 
                              bgcolor: '#f5f5f5' 
                            }} 
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                          {item.desc}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* Section 4 */}
          <Box>
            <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ borderBottom: '2px solid #e0e0e0', pb: 1 }}>
              4.0 Composite Risk Scoring Model
            </Typography>
            <Paper elevation={0} sx={{ bgcolor: '#fafafa', p: 3, border: '1px solid #e0e0e0' }}>
              <Typography variant="body2" color="text.secondary" paragraph sx={{ lineHeight: 1.7 }}>
                The final "Deviation Score" (0-100) is a weighted aggregate of all active vectors. It is not a probability of guilt, 
                but a probability of <em>anomalous behavior requiring explanation</em>.
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <RiskMatrixCard range="75-100" label="Critical" severity="error" desc="Immediate SAR Filing Review" />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <RiskMatrixCard range="50-74" label="High" severity="warning" desc="EDD / Document Request" />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <RiskMatrixCard range="25-49" label="Medium" severity="info" desc="Analyst Review Queue" />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <RiskMatrixCard range="0-24" label="Low" severity="success" desc="Automated Clearing" />
                </Grid>
              </Grid>
            </Paper>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ bgcolor: '#fafafa', borderTop: '1px solid #e0e0e0', p: 3 }}>
        <Typography variant="caption" color="text.disabled" sx={{ flex: 1, fontStyle: 'italic' }}>
          Last Updated: Q4 2025 Compliance Review
        </Typography>
        <Button variant="contained" onClick={onClose} sx={{ fontWeight: 'bold' }}>
          Acknowledge & Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RiskMatrixCard = ({ range, label, severity, desc }) => (
  <Card variant="outlined" sx={{ textAlign: 'center' }}>
    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
      <Typography variant="h6" fontWeight="bold" color={`${severity}.main`} gutterBottom>
        {range}
      </Typography>
      <Typography variant="caption" fontWeight="bold" sx={{ textTransform: 'uppercase', display: 'block', mb: 1 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
        {desc}
      </Typography>
    </CardContent>
  </Card>
);

export default BaselineAnalysisScreen;
