// src/tools/investigation/screens/case/CompareCasesScreen.jsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";
import {
  Box, Button, Paper, Stack, Typography, FormControl, InputLabel, 
  Select, MenuItem, Checkbox, FormControlLabel, Chip, Card, CardContent,
  CircularProgress, Divider, Alert,
} from '@mui/material';

import {
  AutoFixHigh as SparklesIcon,
  CompareArrows as CompareIcon,
  PlayArrow as PlayIcon,
  TrendingUp as TrendingUpIcon,
  Warning as AlertIcon,
  AttachMoney as MoneyIcon,
  People as PeopleIcon,
  Storage as DatabaseIcon, // ✅ Fixed: 'Database' is often 'Storage' in MUI
  FilterList as FilterIcon
} from '@mui/icons-material';

const CompareCasesScreen = () => {
  const { priorityBuckets, getFilteredCaseList } = useAppContext();
  
  const [cases, setCases] = useState([]);
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [usePriorityFilter, setUsePriorityFilter] = useState(true);
  
  const displayCases = usePriorityFilter && priorityBuckets.enabled 
    ? getFilteredCaseList() 
    : cases;

  useEffect(() => { loadCases(); }, []);

  const loadCases = async () => {
    try {
      const res = await apiClient.get('/api/v2/case-list');
      setCases(res || []);
    } catch (e) { console.error(e); }
  };

  const runComparison = async () => {
    if (!selectedA || !selectedB) return;
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/compare/run-analysis', {
        case_a: selectedA,
        case_b: selectedB
      });
      setResult(res);
    } catch (e) { 
      console.error(e);
      alert("Comparison failed. Please try again.");
    }
    setLoading(false);
  };

  const getRiskColor = (score) => {
    if (score >= 80) return 'error';
    if (score >= 60) return 'warning';
    return 'success';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: '#dc2626',
      high: '#f97316',
      medium: '#f59e0b',
      low: '#84cc16'
    };
    return colors[severity] || '#6b7280';
  };

  return (
    <PageContainer 
      title="Case Comparison" 
      subtitle="Side-by-side forensic analysis"
      breadcrumbs={['Investigation', 'Case Comparison']}
      actions={
        <Stack direction="row" spacing={1.5} alignItems="center">
          {priorityBuckets.enabled && (
            <FormControlLabel
              control={
                <Checkbox 
                  checked={usePriorityFilter}
                  onChange={(e) => setUsePriorityFilter(e.target.checked)}
                  size="small"
                  sx={{ py: 0 }}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FilterIcon sx={{ fontSize: 14 }}/>
                  <Typography variant="caption" fontWeight="500">
                    {priorityBuckets.activeBucket}
                  </Typography>
                </Box>
              }
              sx={{ mr: 1, '& .MuiTypography-root': { fontSize: '0.8rem' } }}
            />
          )}
          <Button 
            variant="contained" 
            size="small" 
            disableElevation 
            color="primary"
            startIcon={loading ? <CircularProgress size={16} color="inherit"/> : <PlayIcon />}
            onClick={runComparison} 
            disabled={loading || !selectedA || !selectedB}
            sx={{ fontWeight: '600' }}
          >
            {loading ? 'Analyzing...' : 'Compare'}
          </Button>
        </Stack>
      }
    >
      {/* MAIN CONTENT */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        {/* CASE SELECTION */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CompareIcon fontSize="small" /> CASE SELECTION
            </Typography>
          </Box>
          <Box sx={{ p: 3, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 3, alignItems: 'end' }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Case A</InputLabel>
              <Select 
                value={selectedA} 
                onChange={e => setSelectedA(e.target.value)}
                label="Case A"
              >
                <MenuItem value="">Select Case...</MenuItem>
                {displayCases.map(c => (
                  <MenuItem key={c.case_id} value={c.case_id}>{c.case_id}</MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Box sx={{ 
              bgcolor: '#f0f0f0', 
              borderRadius: '50%', 
              width: 48, 
              height: 48, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              fontWeight: 'bold',
              color: '#666',
              fontSize: '1.1rem'
            }}>
              VS
            </Box>
            
            <FormControl size="small" fullWidth>
              <InputLabel>Case B</InputLabel>
              <Select 
                value={selectedB} 
                onChange={e => setSelectedB(e.target.value)}
                label="Case B"
              >
                <MenuItem value="">Select Case...</MenuItem>
                {displayCases.map(c => (
                  <MenuItem key={c.case_id} value={c.case_id}>{c.case_id}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Filter Status */}
          {usePriorityFilter && priorityBuckets.enabled && (
            <Box sx={{ px: 3, pb: 2 }}>
              <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="caption">
                    Showing <strong>{displayCases.length} cases</strong> from bucket: <strong>{priorityBuckets.activeBucket}</strong>
                  </Typography>
                  <Button 
                    size="small" 
                    onClick={() => setUsePriorityFilter(false)}
                    sx={{ fontSize: '0.7rem', py: 0, minWidth: 'auto' }}
                  >
                    Show All
                  </Button>
                </Box>
              </Alert>
            </Box>
          )}
        </Paper>

        {/* RESULTS */}
        {result && (
          <>
            {/* AI INSIGHT */}
            <Paper 
              variant="outlined" 
              sx={{ 
                borderRadius: 2, 
                overflow: 'hidden',
                border: '1px solid #c7d2fe'
              }}
            >
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#eef2ff', borderBottom: '1px solid #c7d2fe' }}>
                <Typography variant="subtitle2" fontWeight="bold" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SparklesIcon fontSize="small" /> AI COMPARATIVE INSIGHT
                </Typography>
              </Box>
              <Box sx={{ p: 3, bgcolor: '#f5f7ff' }}>
                <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.7 }}>
                  {result.analysis.ai_narrative}
                </Typography>
              </Box>
            </Paper>

            {/* METRICS COMPARISON */}
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TrendingUpIcon fontSize="small" /> KEY METRICS
                </Typography>
              </Box>
              <Box sx={{ p: 3, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 3 }}>
                {/* Case A Metrics */}
                <Card variant="outlined">
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="overline" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 2 }}>
                      {result.case_a.id}
                    </Typography>
                    <Stack spacing={2}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Risk Score</Typography>
                        <Chip 
                          label={result.case_a.risk_score} 
                          color={getRiskColor(result.case_a.risk_score)}
                          size="small"
                          sx={{ fontWeight: 'bold', minWidth: 50 }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Total Volume</Typography>
                        <Typography variant="body2" fontWeight="bold">
                          ${result.case_a.volume.toLocaleString()}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Alerts</Typography>
                        <Typography variant="body2" fontWeight="bold">
                          {result.case_a.alerts?.length || 0}
                        </Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>

                {/* Similarity Score */}
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  minWidth: 120
                }}>
                  <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ mb: 1 }}>
                    SIMILARITY
                  </Typography>
                  <Box sx={{ 
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <CircularProgress 
                      variant="determinate" 
                      value={result.analysis.overlap_score} 
                      size={80}
                      thickness={5}
                      sx={{ color: result.analysis.overlap_score > 60 ? '#2196f3' : '#94a3b8' }}
                    />
                    <Typography 
                      variant="h5" 
                      fontWeight="bold" 
                      color="primary"
                      sx={{ position: 'absolute' }}
                    >
                      {result.analysis.overlap_score}%
                    </Typography>
                  </Box>
                </Box>

                {/* Case B Metrics */}
                <Card variant="outlined">
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="overline" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 2 }}>
                      {result.case_b.id}
                    </Typography>
                    <Stack spacing={2}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Risk Score</Typography>
                        <Chip 
                          label={result.case_b.risk_score} 
                          color={getRiskColor(result.case_b.risk_score)}
                          size="small"
                          sx={{ fontWeight: 'bold', minWidth: 50 }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Total Volume</Typography>
                        <Typography variant="body2" fontWeight="bold">
                          ${result.case_b.volume.toLocaleString()}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Alerts</Typography>
                        <Typography variant="body2" fontWeight="bold">
                          {result.case_b.alerts?.length || 0}
                        </Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Box>
            </Paper>

            {/* DETAILED COMPARISON */}
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DatabaseIcon fontSize="small" /> DETAILED EVIDENCE
                </Typography>
              </Box>

              {/* Alerts Comparison */}
              <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <AlertIcon sx={{ fontSize: 16, color: '#dc2626' }} />
                  <Typography variant="body2" fontWeight="bold">Active Alerts</Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2px 1fr', gap: 2 }}>
                  {/* Case A Alerts */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_a.id}
                    </Typography>
                    {(!result.case_a.alerts || result.case_a.alerts.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No alerts
                      </Typography>
                    ) : (
                      result.case_a.alerts.map((alert, i) => (
                        <Card key={i} variant="outlined" sx={{ bgcolor: '#fef2f2' }}>
                          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="body2" fontWeight="600" color="#dc2626">
                                {alert.type || 'Alert'}
                              </Typography>
                              {alert.severity && (
                                <Chip 
                                  label={alert.severity} 
                                  size="small" 
                                  sx={{ 
                                    height: 18, 
                                    fontSize: '0.65rem',
                                    bgcolor: getSeverityColor(alert.severity),
                                    color: 'white',
                                    fontWeight: 'bold'
                                  }}
                                />
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                              {alert.date || 'No Date'}
                            </Typography>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </Stack>

                  <Divider orientation="vertical" flexItem />

                  {/* Case B Alerts */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_b.id}
                    </Typography>
                    {(!result.case_b.alerts || result.case_b.alerts.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No alerts
                      </Typography>
                    ) : (
                      result.case_b.alerts.map((alert, i) => (
                        <Card key={i} variant="outlined" sx={{ bgcolor: '#fef2f2' }}>
                          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="body2" fontWeight="600" color="#dc2626">
                                {alert.type || 'Alert'}
                              </Typography>
                              {alert.severity && (
                                <Chip 
                                  label={alert.severity} 
                                  size="small" 
                                  sx={{ 
                                    height: 18, 
                                    fontSize: '0.65rem',
                                    bgcolor: getSeverityColor(alert.severity),
                                    color: 'white',
                                    fontWeight: 'bold'
                                  }}
                                />
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                              {alert.date || 'No Date'}
                            </Typography>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </Stack>
                </Box>
              </Box>

              {/* Transactions Comparison */}
              <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <MoneyIcon sx={{ fontSize: 16, color: '#16a34a' }} />
                  <Typography variant="body2" fontWeight="bold">High-Value Transactions</Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2px 1fr', gap: 2 }}>
                  {/* Case A Transactions */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_a.id}
                    </Typography>
                    {(!result.case_a.transactions || result.case_a.transactions.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No transactions
                      </Typography>
                    ) : (
                      result.case_a.transactions.map((txn, i) => {
                        const amt = txn.amount || txn.amt || 0;
                        return (
                          <Card key={i} variant="outlined" sx={{ bgcolor: '#f0fdf4' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="body2" fontWeight="bold" color="#16a34a">
                                  ${parseFloat(amt).toLocaleString()}
                                </Typography>
                                <Chip 
                                  label={txn.type || 'Trf'} 
                                  size="small" 
                                  variant="outlined" 
                                  sx={{ height: 18, fontSize: '0.65rem' }} 
                                />
                              </Box>
                              {txn.counterparty && (
                                <Typography variant="caption" color="text.secondary">
                                  {txn.counterparty} {txn.date ? `• ${txn.date}` : ''}
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>

                  <Divider orientation="vertical" flexItem />

                  {/* Case B Transactions */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_b.id}
                    </Typography>
                    {(!result.case_b.transactions || result.case_b.transactions.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No transactions
                      </Typography>
                    ) : (
                      result.case_b.transactions.map((txn, i) => {
                        const amt = txn.amount || txn.amt || 0;
                        return (
                          <Card key={i} variant="outlined" sx={{ bgcolor: '#f0fdf4' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="body2" fontWeight="bold" color="#16a34a">
                                  ${parseFloat(amt).toLocaleString()}
                                </Typography>
                                <Chip 
                                  label={txn.type || 'Trf'} 
                                  size="small" 
                                  variant="outlined" 
                                  sx={{ height: 18, fontSize: '0.65rem' }} 
                                />
                              </Box>
                              {txn.counterparty && (
                                <Typography variant="caption" color="text.secondary">
                                  {txn.counterparty} {txn.date ? `• ${txn.date}` : ''}
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Box>
              </Box>

              {/* Entities Comparison */}
              <Box sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <PeopleIcon sx={{ fontSize: 16, color: '#2563eb' }} />
                  <Typography variant="body2" fontWeight="bold">Involved Entities</Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2px 1fr', gap: 2 }}>
                  {/* Case A Entities */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_a.id}
                    </Typography>
                    {(!result.case_a.customers || result.case_a.customers.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No entities
                      </Typography>
                    ) : (
                      result.case_a.customers.map((cust, i) => {
                        const name = cust.name || Object.values(cust).find(v => typeof v === 'string' && v.length > 3 && !v.includes('Cust')) || 'Customer';
                        const id = cust.id || Object.values(cust).find(v => typeof v === 'string' && (v.includes('Cust') || v.includes('U'))) || 'ID';
                        return (
                          <Card key={i} variant="outlined" sx={{ bgcolor: '#eff6ff' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="body2" fontWeight="600">
                                  {name}
                                </Typography>
                                {cust.risk && (
                                  <Chip 
                                    label={cust.risk} 
                                    size="small" 
                                    color={cust.risk === 'high' ? 'error' : cust.risk === 'medium' ? 'warning' : 'success'}
                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                  />
                                )}
                              </Box>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {id}
                              </Typography>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>

                  <Divider orientation="vertical" flexItem />

                  {/* Case B Entities */}
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ px: 1 }}>
                      {result.case_b.id}
                    </Typography>
                    {(!result.case_b.customers || result.case_b.customers.length === 0) ? (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2, fontStyle: 'italic' }}>
                        No entities
                      </Typography>
                    ) : (
                      result.case_b.customers.map((cust, i) => {
                        const name = cust.name || Object.values(cust).find(v => typeof v === 'string' && v.length > 3 && !v.includes('Cust')) || 'Customer';
                        const id = cust.id || Object.values(cust).find(v => typeof v === 'string' && (v.includes('Cust') || v.includes('U'))) || 'ID';
                        return (
                          <Card key={i} variant="outlined" sx={{ bgcolor: '#eff6ff' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="body2" fontWeight="600">
                                  {name}
                                </Typography>
                                {cust.risk && (
                                  <Chip 
                                    label={cust.risk} 
                                    size="small" 
                                    color={cust.risk === 'high' ? 'error' : cust.risk === 'medium' ? 'warning' : 'success'}
                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                  />
                                )}
                              </Box>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {id}
                              </Typography>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Box>
              </Box>
            </Paper>
          </>
        )}

        {/* Empty State */}
        {!result && !loading && (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            minHeight: 400,
            color: 'text.secondary'
          }}>
            <CompareIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
            <Typography variant="h6" color="text.secondary" fontWeight="500">
              Select two cases to compare
            </Typography>
            <Typography variant="body2" color="text.disabled">
              Choose cases from the dropdowns above to view detailed comparison
            </Typography>
          </Box>
        )}
      </Box>
    </PageContainer>
  );
};

export default CompareCasesScreen;