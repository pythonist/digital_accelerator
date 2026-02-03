import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";
import RuleEditor from './RuleEditor';
// ✅ Import Manual Component
import RuleEngineManual from "@investigation/components/guide/RuleEngineManual";

// MUI Imports
import {
  Box, Paper, Typography, Button, IconButton, Select, MenuItem, 
  Stack, Chip, Divider, CircularProgress, Alert,
  Card, FormControl, Collapse
} from '@mui/material';

// MUI Icons
import { 
  Security as ShieldIcon, 
  Warning as AlertTriangleIcon, 
  Timeline as ActivityIcon, 
  CheckCircle as CheckCircleIcon, 
  Search as SearchIcon, 
  ExpandMore as ChevronDownIcon, 
  ChevronRight as ChevronRightIcon, 
  Description as FileTextIcon, 
  Settings as SettingsIcon, 
  BarChart as BarChart3Icon, 
  Layers as LayersIcon,
  Close as XIcon, 
  Bolt as ZapIcon, 
  GpsFixed as TargetIcon, 
  Psychology as BrainIcon,
  HelpOutline,
  Info as InfoIcon
} from '@mui/icons-material';

const RuleEngineScreen = () => {
  const { caseList, loadCaseList } = useAppContext();
  
  // State Management
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisResults, setAnalysisResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // UI State
  const [expandedItems, setExpandedItems] = useState({});
  const [showRuleManager, setShowRuleManager] = useState(false);
  const [showExplanationFor, setShowExplanationFor] = useState(null);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [viewMode, setViewMode] = useState('combined'); // combined, rules-only, typologies-only
  
  // ✅ Manual State
  const [showManual, setShowManual] = useState(false);

  // Load cases on mount
  useEffect(() => {
    if (caseList.length === 0) loadCaseList();
  }, []);

  // Smart auto-selection
  useEffect(() => {
    if (autoSelectEnabled && caseList.length > 0 && !selectedCaseId) {
      const priorityCase = [...caseList].sort((a, b) => {
        const severityWeight = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
        const aSeverity = severityWeight[a.severity || a.Severity] || 0;
        const bSeverity = severityWeight[b.severity || b.Severity] || 0;
        if (bSeverity !== aSeverity) return bSeverity - aSeverity;
        const aAlerts = a.alert_count || a.Alert_Count || (a.alerts ? a.alerts.length : 0) || 0;
        const bAlerts = b.alert_count || b.Alert_Count || (b.alerts ? b.alerts.length : 0) || 0;
        return bAlerts - aAlerts;
      })[0];
      
      const id = priorityCase.case_id || priorityCase.Case_ID || priorityCase.id || priorityCase.ID;
      if (id) {
        setSelectedCaseId(String(id));
        // Small delay to allow UI render before fetch
        setTimeout(() => runAnalysis(String(id)), 500);
      }
    }
  }, [caseList, autoSelectEnabled]);

  const runAnalysis = async (caseId = selectedCaseId) => {
    if (!caseId) return;
    
    setLoading(true);
    setAnalysisResults(null);
    setError(null);
    
    try {
      const res = await apiClient.post('/api/v2/risk-intelligence/analyze', { 
        case_id: caseId 
      });
      
      if (res.error || res.status === 'no_data') {
        setError(res.message || res.error || 'No data found for this case');
      } else {
        setAnalysisResults(res);
        // Auto-expand first critical/high item
        if (res.violations && res.violations.length > 0) {
          const firstCritical = res.violations.find(v => 
            v.severity === 'Critical' || v.severity === 'High'
          );
          if (firstCritical) {
            setExpandedItems({ [firstCritical.id]: true });
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError('Failed to connect to analysis engine. Please check backend connection.');
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    const s = severity?.toLowerCase();
    if (s === 'critical') return 'error';
    if (s === 'high') return 'warning';
    if (s === 'medium') return 'info';
    return 'success'; // or primary for low
  };

  const toggleExpand = (id) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getSelectionReason = () => {
    if (!selectedCase || !autoSelectEnabled) return null;
    
    const alerts = selectedCase.alert_count || selectedCase.Alert_Count || (selectedCase.alerts ? selectedCase.alerts.length : 0) || 0;
    const severity = selectedCase.severity || selectedCase.Severity || 'Unknown';
    
    return {
      severity,
      alert_count: alerts,
      factors: [
        `Severity Level: ${severity}`,
        `${alerts} active alert${alerts !== 1 ? 's' : ''} pending review`,
        'Automatically prioritized based on risk indicators'
      ]
    };
  };

  const selectedCase = caseList.find(c => {
    const caseId = String(c.case_id || c.Case_ID || c.id || c.ID || '');
    return caseId === String(selectedCaseId);
  });

  const filteredViolations = () => {
    if (!analysisResults?.violations) return [];
    
    let filtered = analysisResults.violations;
    
    if (filterSeverity !== 'all') {
      filtered = filtered.filter(v => 
        v.severity.toLowerCase() === filterSeverity.toLowerCase()
      );
    }
    
    if (viewMode === 'rules-only') {
      filtered = filtered.filter(v => !v.id.startsWith('TYPO_'));
    } else if (viewMode === 'typologies-only') {
      filtered = filtered.filter(v => v.id.startsWith('TYPO_'));
    }
    
    return filtered;
  };

  const getRiskScoreColor = (score) => {
    if (score >= 75) return 'error.main';
    if (score >= 50) return 'warning.main';
    if (score >= 25) return 'info.main';
    return 'success.main';
  };

  const violations = filteredViolations();

  return (
    <PageContainer 
      title="Risk Intelligence Hub" 
      subtitle="Unified Rules & Typology Analysis"
      breadcrumbs={['Analysis', 'Risk Hub']}
      actions={
        <Stack direction="row" spacing={1.5}>
          {/* ✅ Guide Button */}
          <Button 
              variant="text" 
              startIcon={<HelpOutline />} 
              onClick={() => setShowManual(true)}
              size="small"
              sx={{ color: 'text.secondary', fontWeight: 600 }}
          >
              Rule Guide
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setAutoSelectEnabled(!autoSelectEnabled)}
            startIcon={<ZapIcon />}
            color={autoSelectEnabled ? "primary" : "inherit"}
            sx={{ fontWeight: 600, borderColor: autoSelectEnabled ? 'primary.main' : 'divider' }}
          >
            Smart Select
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => setShowRuleManager(true)}
            startIcon={<SettingsIcon />}
            sx={{ fontWeight: 600 }}
          >
            Manage Rules
          </Button>
        </Stack>
      }
    >
      {/* ✅ Render Manual */}
      <RuleEngineManual open={showManual} onClose={() => setShowManual(false)} />

      {/* Main Content Flex Container */}
      {/* Fixed height calculation prevents double scrollbars */}
      <Box sx={{ display: 'flex', gap: 3, height: 'calc(100vh - 220px)', minHeight: 500 }}>
        
        {/* LEFT SIDEBAR (Fixed Width) */}
        <Stack spacing={3} sx={{ width: 320, flexShrink: 0, overflowY: 'auto' }}>
          
          {/* Case Selector */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Case Selection
              </Typography>
              {autoSelectEnabled && (
                <Chip label="AUTO" size="small" color="primary" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} />
              )}
            </Box>
            
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <Select 
                value={selectedCaseId} 
                onChange={(e) => setSelectedCaseId(e.target.value)}
                displayEmpty
              >
                <MenuItem value="" disabled>-- Select Case --</MenuItem>
                {caseList.map((c, i) => {
                  const id = c.case_id || c.Case_ID || c.id || c.ID || `UNKNOWN-${i}`;
                  const alerts = c.alert_count || c.Alert_Count || (c.alerts ? c.alerts.length : 0) || 0;
                  const severity = c.severity || c.Severity || 'Unknown';
                  const customer = c.customer_name || c.Customer_Name || c.customer || c.Customer || '';
                  
                  return (
                    <MenuItem key={i} value={String(id)}>
                      <Typography variant="body2" noWrap>
                        {id} | {severity} | {alerts} Alerts {customer && `| ${customer}`}
                      </Typography>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            <Button 
              fullWidth 
              variant="contained" 
              size="large" 
              onClick={() => runAnalysis()}
              disabled={loading || !selectedCaseId}
              startIcon={loading ? <CircularProgress size={20} color="inherit"/> : <SearchIcon />}
              sx={{ fontWeight: 'bold', background: 'linear-gradient(to right, #2563eb, #1d4ed8)' }}
            >
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </Paper>

          {/* Smart Selection Info */}
          {autoSelectEnabled && selectedCase && getSelectionReason() && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#eef2ff', borderColor: '#c7d2fe' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <TargetIcon sx={{ fontSize: 18, color: 'primary.main' }}/>
                <Typography variant="subtitle2" fontWeight="bold" color="primary.dark">Why This Case?</Typography>
              </Box>
              <Stack spacing={1}>
                {getSelectionReason().factors.map((factor, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <ChevronRightIcon sx={{ fontSize: 16, color: 'primary.main', mt: 0.25 }}/>
                    <Typography variant="caption" color="primary.dark" sx={{ fontSize: '0.75rem' }}>{factor}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

          {/* Analysis Summary */}
          {analysisResults && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <BarChart3Icon sx={{ fontSize: 18, color: 'text.secondary' }}/>
                <Typography variant="subtitle2" fontWeight="bold" color="text.primary">Analysis Summary</Typography>
              </Box>
              
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" color="text.secondary">Transactions Scanned</Typography>
                  <Typography variant="body2" fontWeight="bold">{analysisResults.row_count || 0}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" color="text.secondary">Violations Found</Typography>
                  <Typography variant="body2" fontWeight="bold" color="error.main">{analysisResults.violations?.length || 0}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary">Risk Score</Typography>
                  <Typography variant="h5" fontWeight="bold" color={getRiskScoreColor(analysisResults.risk_score || 0)}>
                    {analysisResults.risk_score || 0}
                  </Typography>
                </Box>

                {analysisResults.missing_columns && analysisResults.missing_columns.length > 0 && (
                  <Alert severity="warning" icon={<AlertTriangleIcon fontSize="inherit" />} sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight="bold" display="block">Missing Data Fields</Typography>
                    {analysisResults.missing_columns.join(', ')}
                  </Alert>
                )}
              </Stack>
            </Paper>
          )}
        </Stack>

        {/* RIGHT PANEL (Scrollable Content) */}
        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
          
          {/* Header */}
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <ShieldIcon sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle1" fontWeight="bold">Detection Results</Typography>
            </Box>

            {analysisResults && violations.length > 0 && (
              <Stack direction="row" spacing={2}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <Select
                    value={filterSeverity}
                    onChange={(e) => setFilterSeverity(e.target.value)}
                    sx={{ fontSize: '0.8rem', bgcolor: 'white' }}
                  >
                    <MenuItem value="all">All Severities</MenuItem>
                    <MenuItem value="critical">Critical Only</MenuItem>
                    <MenuItem value="high">High Only</MenuItem>
                    <MenuItem value="medium">Medium Only</MenuItem>
                    <MenuItem value="low">Low Only</MenuItem>
                  </Select>
                </FormControl>
                
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <Select
                    value={viewMode}
                    onChange={(e) => setViewMode(e.target.value)}
                    sx={{ fontSize: '0.8rem', bgcolor: 'white' }}
                  >
                    <MenuItem value="combined">All Findings</MenuItem>
                    <MenuItem value="rules-only">Rules Only</MenuItem>
                    <MenuItem value="typologies-only">Typologies Only</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}
          </Box>

          {/* Results Area */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 3, bgcolor: '#fff' }}>
            
            {loading && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                <ActivityIcon sx={{ fontSize: 48, mb: 2, color: 'primary.main', animation: 'spin 2s linear infinite' }} />
                <Typography variant="body1" fontWeight="500">Running comprehensive analysis...</Typography>
                <Typography variant="caption">Scanning rules & detecting typologies</Typography>
              </Box>
            )}

            {error && !loading && (
              <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold">Analysis Failed</Typography>
                <Typography variant="body2">{error}</Typography>
                <Button size="small" color="error" onClick={() => setError(null)} sx={{ mt: 1 }}>Dismiss & Retry</Button>
              </Alert>
            )}

            {!loading && !analysisResults && !error && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.disabled', border: '2px dashed #e0e0e0', borderRadius: 2 }}>
                <BrainIcon sx={{ fontSize: 64, mb: 2, opacity: 0.2 }} />
                <Typography variant="h6" color="text.secondary">Ready to analyze</Typography>
                <Typography variant="body2">Select a case and click "Run Analysis"</Typography>
              </Box>
            )}

            {!loading && analysisResults && violations.length === 0 && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#f0fdf4', borderRadius: 2 }}>
                <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
                <Typography variant="h6" color="success.dark">Clean Profile</Typography>
                <Typography variant="body2" color="success.dark">No violations detected in {analysisResults.row_count} transactions</Typography>
              </Box>
            )}

            {!loading && violations.length > 0 && (
              <Stack spacing={2}>
                {violations.map((violation) => {
                  const isExpanded = expandedItems[violation.id];
                  const isTypology = violation.id.startsWith('TYPO_');
                  
                  return (
                    <Card key={violation.id} variant="outlined" sx={{ '&:hover': { boxShadow: 2 } }}>
                      <Box 
                        onClick={() => toggleExpand(violation.id)}
                        sx={{ p: 2, cursor: 'pointer', bgcolor: isExpanded ? '#fafafa' : 'white', '&:hover': { bgcolor: '#f8fafc' } }}
                      >
                        <Stack direction="row" alignItems="center" spacing={2}>
                          <IconButton size="small" sx={{ p: 0.5 }}>
                            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          </IconButton>
                          
                          <Box sx={{ flexShrink: 0 }}>
                            {isTypology ? <LayersIcon sx={{ color: 'secondary.main' }} /> : <ShieldIcon sx={{ color: 'primary.main' }} />}
                          </Box>

                          <Box sx={{ flex: 1 }}>
                            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                              <Typography variant="subtitle1" fontWeight="bold">{violation.name}</Typography>
                              <Chip 
                                label={violation.severity} 
                                size="small" 
                                color={getSeverityColor(violation.severity)}
                                sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} 
                              />
                              {isTypology && (
                                <Chip label="TYPOLOGY" size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'secondary.light', color: 'secondary.contrastText', fontWeight: 'bold' }} />
                              )}
                            </Stack>
                            <Typography variant="body2" color="text.secondary">{violation.description}</Typography>
                          </Box>

                          <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="h6" fontWeight="bold">{violation.match_count}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 'bold' }}>Matches</Typography>
                            {violation.total_value && (
                              <Typography variant="caption" display="block" color="primary.main" fontWeight="bold">
                                ₹{violation.total_value.toLocaleString('en-IN')}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </Box>

                      <Collapse in={isExpanded}>
                        <Divider />
                        <Box sx={{ bgcolor: 'white' }}>
                          <Box sx={{ px: 3, py: 1.5, bgcolor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                            <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                              Category: {violation.category}
                            </Typography>
                          </Box>
                          
                          {violation.examples && violation.examples.length > 0 && (
                            <Box sx={{ p: 3 }}>
                              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FileTextIcon fontSize="small"/> Transaction Evidence ({violation.examples.length} shown)
                              </Typography>
                              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                  <thead style={{ backgroundColor: '#f8fafc' }}>
                                    <tr>
                                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold' }}>Date</th>
                                      <th style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>Amount</th>
                                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold' }}>Type</th>
                                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold' }}>Party / Channel</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {violation.examples.map((ex, i) => (
                                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                                          {ex.date || ex.txn_date || ex.created_at || '-'}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                                          ₹{(ex.amount || ex.txn_amount || 0).toLocaleString('en-IN')}
                                        </td>
                                        <td style={{ padding: '8px' }}>
                                          <Chip 
                                            label={ex.type || ex.dr_cr || '-'} 
                                            size="small" 
                                            sx={{ 
                                              height: 20, fontSize: '0.65rem', fontWeight: 'bold',
                                              bgcolor: String(ex.type || '').toLowerCase().includes('credit') ? '#e8f5e9' : '#ffebee',
                                              color: String(ex.type || '').toLowerCase().includes('credit') ? '#2e7d32' : '#c62828'
                                            }} 
                                          />
                                        </td>
                                        <td style={{ padding: '8px' }}>
                                          {ex.party || ex.counterparty || ex.channel || ex.mode || 'Unknown'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </Paper>
                            </Box>
                          )}

                          <Box sx={{ px: 3, pb: 3 }}>
                            <Button 
                              size="small" 
                              variant="outlined" 
                              startIcon={<InfoIcon />}
                              onClick={(e) => { e.stopPropagation(); setShowExplanationFor(violation); }}
                            >
                              Show Detection Logic
                            </Button>
                          </Box>
                        </Box>
                      </Collapse>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Paper>
      </Box>

      {/* Rule Editor Modal */}
      <RuleEditor 
        isOpen={showRuleManager}
        onClose={() => setShowRuleManager(false)}
        onRulesSaved={() => {
          if (analysisResults) {
            runAnalysis();
          }
        }}
      />

      {/* Explanation Modal */}
      {showExplanationFor && (
        <ExplanationModal 
            open={Boolean(showExplanationFor)} 
            onClose={() => setShowExplanationFor(null)} 
            item={showExplanationFor} 
        />
      )}
    </PageContainer>
  );
};

// --- Helper Components ---
const ExplanationModal = ({ open, onClose, item }) => (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 1300, bgcolor: 'rgba(0,0,0,0.5)', display: open ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Paper sx={{ width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f8fafc' }}>
                <Typography variant="h6" fontWeight="bold">Detection Logic</Typography>
                <IconButton onClick={onClose}><XIcon /></IconButton>
            </Box>
            <Box sx={{ p: 3, overflowY: 'auto' }}>
                <Typography variant="h6" fontWeight="bold" gutterBottom>{item.name}</Typography>
                <Typography variant="body2" color="text.secondary" paragraph>{item.description}</Typography>
                
                <Paper variant="outlined" sx={{ p: 2, bgcolor: '#e3f2fd', mb: 2, borderColor: '#90caf9' }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="primary" gutterBottom>Detection Criteria</Typography>
                    <Typography variant="body2" color="primary.dark">
                        This {item.id.startsWith('TYPO_') ? 'typology' : 'rule'} was triggered because the system found <strong>{item.match_count} transactions</strong> that matched the defined pattern.
                    </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fff3e0', mb: 2, borderColor: '#ffcc80' }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="warning.dark" gutterBottom>Why This Matters</Typography>
                    <Typography variant="body2" color="warning.dark">
                        {item.id.startsWith('TYPO_') 
                            ? "Typologies represent complex behavioral patterns that indicate potential money laundering or financial crime." 
                            : "Rules are threshold-based checks that flag transactions meeting specific criteria configured based on risk appetite."}
                    </Typography>
                </Paper>
            </Box>
        </Paper>
    </Box>
);

export default RuleEngineScreen;