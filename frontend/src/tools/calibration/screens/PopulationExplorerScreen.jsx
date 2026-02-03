// frontend/src/tools/calibration/screens/PopulationExplorerScreen.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, Grid, TextField, MenuItem, Select, 
  FormControl, InputLabel, Chip, Stack, Button, Divider,
  Accordion, AccordionSummary, AccordionDetails, Alert, Table, 
  TableBody, TableCell, TableHead, CircularProgress, TableRow, 
  Collapse, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import {
  ExpandMore, InfoOutlined, TableChart, CheckCircle, ArrowForward,
  Category as CategoryIcon, Person as PersonIcon, AccountBalance as AccountIcon,
  Code as CodeIcon, Clear as ClearIcon, Visibility as VisibilityIcon,
  Timeline as TimelineIcon, Download as DownloadIcon
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import apiClient from '@services/api';
import { useAppContext } from '@context/AppContext';
import PageContainer from '../layout/PageContainer';
import { motion } from 'framer-motion';
import { PageTransition } from '@components/LoadingAnimations';

// Import components
import PopulationImpactPanel from '../components/PopulationImpactPanel';
import CardinalityPreviewPanel from '../components/CardinalityPreviewPanel';
import ExcludedPopulationPanel from '../components/ExcludedPopulationPanel';
import PopulationNarrativeBox from '../components/PopulationNarrativeBox';
import FilterDependencyWarnings from '../components/FilterDependencyWarnings';

const TOOL_HEADER_HEIGHT = 56;

// SQL QUERY VIEWER DIALOG
const SQLQueryDialog = ({ open, onClose, filters, liveStats }) => {
  const [activeTab, setActiveTab] = useState(0);
  
  const generateSQL = () => {
    const whereClauses = [];
    
    if (filters.transaction_filters.transaction_category?.length > 0) {
      whereClauses.push(`transaction_category IN ('${filters.transaction_filters.transaction_category.join("', '")}')`);
    }
    if (filters.transaction_filters.transaction_direction?.length > 0) {
      whereClauses.push(`transaction_direction IN ('${filters.transaction_filters.transaction_direction.join("', '")}')`);
    }
    if (filters.transaction_filters.min_amount) {
      whereClauses.push(`transaction_amount >= ${filters.transaction_filters.min_amount}`);
    }
    if (filters.transaction_filters.max_amount) {
      whereClauses.push(`transaction_amount <= ${filters.transaction_filters.max_amount}`);
    }
    if (filters.customer_filters.customer_risk_rating?.length > 0) {
      whereClauses.push(`customer_risk_rating IN ('${filters.customer_filters.customer_risk_rating.join("', '")}')`);
    }
    if (filters.customer_filters.pep_flag) {
      whereClauses.push(`pep_flag = '${filters.customer_filters.pep_flag}'`);
    }
    if (filters.account_filters.account_status?.length > 0) {
      whereClauses.push(`account_status IN ('${filters.account_filters.account_status.join("', '")}')`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE\n  ${whereClauses.join('\n  AND ')}` : '-- No filters applied';
    
    return `SELECT 
  t.*,
  c.customer_risk_rating,
  c.customer_type,
  c.pep_flag,
  a.account_status,
  a.account_type
FROM transactions t
LEFT JOIN accounts a 
  ON t.account_id = a.account_id
LEFT JOIN customers c 
  ON a.customer_id = c.customer_id
${whereClause}`;
  };

  const executionPlan = [
    { step: 1, action: 'Base Population', count: liveStats?.original_count || 0, description: 'All transactions in dataset' },
    ...(filters.transaction_filters.transaction_category?.length > 0 ? [{
      step: 2, 
      action: 'Category Filter', 
      count: Math.round((liveStats?.filtered_count || 0) * 1.2),
      description: `Filter by ${filters.transaction_filters.transaction_category.join(', ')}`
    }] : []),
    ...(filters.customer_filters.customer_risk_rating?.length > 0 ? [{
      step: 3, 
      action: 'Risk Rating Filter',
      count: liveStats?.filtered_count || 0,
      description: `Filter by risk: ${filters.customer_filters.customer_risk_rating.join(', ')}`
    }] : []),
    { 
      step: 'Final', 
      action: 'Filtered Population', 
      count: liveStats?.filtered_count || 0, 
      description: 'Final result set',
      final: true
    }
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={2} alignItems="center">
          <CodeIcon color="primary" />
          <Box>
            <Typography variant="h6" fontWeight="600">Query Execution Details</Typography>
            <Typography variant="caption" color="text.secondary">
              SQL representation and execution plan
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      
      <DialogContent>
        <Stack spacing={2}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={2}>
              <Button
                size="small"
                variant={activeTab === 0 ? 'contained' : 'text'}
                onClick={() => setActiveTab(0)}
                startIcon={<CodeIcon />}
              >
                SQL Query
              </Button>
              <Button
                size="small"
                variant={activeTab === 1 ? 'contained' : 'text'}
                onClick={() => setActiveTab(1)}
                startIcon={<TimelineIcon />}
              >
                Execution Plan
              </Button>
            </Stack>
          </Box>

          {activeTab === 0 && (
            <Paper 
              variant="outlined" 
              sx={{ 
                p: 2, 
                bgcolor: 'grey.900',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                color: '#61dafb',
                overflow: 'auto',
                maxHeight: 400
              }}
            >
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {generateSQL()}
              </pre>
            </Paper>
          )}

          {activeTab === 1 && (
            <Stack spacing={1.5}>
              {executionPlan.map((step, idx) => (
                <Box key={idx}>
                  <Paper 
                    variant="outlined"
                    sx={{ 
                      p: 2,
                      bgcolor: step.final ? 'primary.50' : 'grey.50',
                      borderColor: step.final ? 'primary.main' : 'divider'
                    }}
                  >
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Box 
                        sx={{ 
                          width: 32, 
                          height: 32,
                          borderRadius: '50%',
                          bgcolor: step.final ? 'primary.main' : 'grey.300',
                          color: step.final ? 'white' : 'grey.700',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.85rem'
                        }}
                      >
                        {step.step}
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="600">
                          {step.action}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {step.description}
                        </Typography>
                      </Box>
                      <Typography variant="h6" fontWeight="700" color={step.final ? 'primary.main' : 'text.primary'}>
                        {step.count.toLocaleString()}
                      </Typography>
                    </Stack>
                  </Paper>
                  {idx < executionPlan.length - 1 && (
                    <Box sx={{ width: 2, height: 16, bgcolor: 'grey.300', ml: 2 }} />
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button 
          variant="contained" 
          startIcon={<DownloadIcon />}
          onClick={() => {
            const blob = new Blob([generateSQL()], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'population_query.sql';
            a.click();
          }}
        >
          Export SQL
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// CONTEXT HEADER
const ContextHeader = () => (
  <Box sx={{ mb: 3 }}>
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '1.1rem' }}>
        1
      </Box>
      <Box>
        <Typography variant="h5" fontWeight="700" color="text.primary">Population Definition</Typography>
        <Typography variant="body2" color="text.secondary">Define transaction universe for scenario analysis</Typography>
      </Box>
    </Stack>
    <Alert severity="info" icon={<InfoOutlined />} sx={{ bgcolor: 'info.50', border: '1px solid', borderColor: 'info.200', '& .MuiAlert-icon': { color: 'info.main' } }}>
      <Typography variant="body2">
        Filters define the base population for threshold calibration. Only matching transactions will be aggregated in subsequent steps.
      </Typography>
    </Alert>
  </Box>
);

// FILTER SECTION
const FilterSection = ({ title, subtitle, icon, children, defaultExpanded = true }) => (
  <Accordion defaultExpanded={defaultExpanded} variant="outlined" sx={{ mb: 1.5, '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', boxShadow: 'none', '&.Mui-expanded': { margin: '0 0 12px 0' } }}>
    <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 56, '&.Mui-expanded': { minHeight: 56 }, '& .MuiAccordionSummary-content': { margin: '12px 0', '&.Mui-expanded': { margin: '12px 0' } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: 'grey.100', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1" fontWeight="600">{title}</Typography>
          <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
        </Box>
      </Box>
    </AccordionSummary>
    <AccordionDetails sx={{ pt: 0, pb: 2 }}>{children}</AccordionDetails>
  </Accordion>
);

// MAIN COMPONENT
const PopulationExplorerScreen = () => {
  const { run, confirmAndContinue, goToStep, currentStep } = useCalibration();
  const { activeEnv } = useAppContext();

  // ✅ FIX: Declare ALL state at the top
  const [filters, setFilters] = useState({
    transaction_filters: { transaction_category: [], transaction_direction: [], min_amount: '', max_amount: '' },
    customer_filters: { customer_risk_rating: [], customer_type: [], pep_flag: '' },
    account_filters: { account_status: [], account_type: [] }
  });
  
  const [availableFilters, setAvailableFilters] = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  
  // ✅ FIX: Add missing state variable
  const [sqlDialogOpen, setSqlDialogOpen] = useState(false);
  
  const hasLoadedFiltersRef = useRef(false);
  const isMountedRef = useRef(true);
  const isNavigatingRef = useRef(false);

  // ✅ FIX: Move conditional rendering AFTER all hooks
  useEffect(() => {
    isMountedRef.current = true;

    const loadFilters = async () => {
      if (!activeEnv || !run?.run_id || hasLoadedFiltersRef.current) {
        return;
      }

      console.log('[PopulationScreen] Loading filter options (ONCE)');
      hasLoadedFiltersRef.current = true;

      try {
        const res = await apiClient.get(
          `/api/v2/calibration/population/${run.run_id}/filter-options`,
          { params: { env_id: activeEnv } }
        );
        
        if (isMountedRef.current) {
          setAvailableFilters(res.filters);
        }
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    };

    loadFilters();

    return () => {
      isMountedRef.current = false;
      hasLoadedFiltersRef.current = false;
    };
  }, [activeEnv, run?.run_id]);

  // Auto-fetch stats when filters change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (run?.run_id && activeEnv && !isNavigatingRef.current) {
        fetchLiveStats();
      }
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [filters, run?.run_id, activeEnv, showPreview]);

  const fetchLiveStats = async () => {
    if (isNavigatingRef.current) return;
    
    setLoading(true);
    try {
      const [statsRes, enhancedRes, narrativeRes, previewRes] = await Promise.all([
        apiClient.post(`/api/v2/calibration/population/${run.run_id}/explore`, { 
          env_id: activeEnv, 
          filters 
        }),
        apiClient.post(`/api/v2/calibration/population/${run.run_id}/enhanced-stats`, { 
          env_id: activeEnv, 
          filters 
        }),
        apiClient.post(`/api/v2/calibration/population/${run.run_id}/narrative`, { 
          scenario_name: run.scenario_name || 'Scenario',
          filters,
          stats: liveStats
        }),
        showPreview ? apiClient.post(`/api/v2/calibration/population/${run.run_id}/preview`, { 
          env_id: activeEnv, 
          filters 
        }) : Promise.resolve(null)
      ]);

      if (isMountedRef.current && !isNavigatingRef.current) {
        setLiveStats(statsRes.stats);
        setEnhancedStats(enhancedRes.stats);
        setNarrative(narrativeRes.narrative);
        if (previewRes) setPreviewData(previewRes.preview);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleFilterChange = (section, field, value) => {
    if (isNavigatingRef.current) return;
    setFilters(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  };

  const handleClearFilters = () => {
    if (isNavigatingRef.current) return;
    setFilters({
      transaction_filters: { transaction_category: [], transaction_direction: [], min_amount: '', max_amount: '' },
      customer_filters: { customer_risk_rating: [], customer_type: [], pep_flag: '' },
      account_filters: { account_status: [], account_type: [] }
    });
  };

  // ✅ FIX: Prevent multiple simultaneous navigations
  const handleProceed = async () => {
    if (isNavigatingRef.current) {
      console.log('[PopulationScreen] Already navigating, ignoring click');
      return;
    }

    isNavigatingRef.current = true;
    console.log('[PopulationScreen] Starting proceed action');

    try {
      await confirmAndContinue(filters);
      
      // Small delay before navigation to allow state to settle
      setTimeout(() => {
        goToStep('aggregation');
      }, 100);
    } catch (err) {
      console.error('Failed to confirm:', err);
      isNavigatingRef.current = false;
    }
  };

  const hasActiveFilters = Object.values(filters).some(group => 
    Object.values(group).some(val => Array.isArray(val) ? val.length > 0 : !!val)
  );

  // ✅ NOW check if we should render
  if (currentStep !== 'scenario') {
    console.log('[PopulationScreen] Not on scenario step, unmounting');
    return null;
  }

  return (
    <PageTransition>
      <PageContainer sx={{ pt: `${TOOL_HEADER_HEIGHT + 24}px`, pb: 3 }}>
        <SQLQueryDialog 
          open={sqlDialogOpen} 
          onClose={() => setSqlDialogOpen(false)} 
          filters={filters} 
          liveStats={liveStats} 
        />
        
        <ContextHeader />

        {narrative && <PopulationNarrativeBox narrative={narrative} />}

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Button size="small" startIcon={<ClearIcon />} onClick={handleClearFilters} disabled={!hasActiveFilters}>Clear Filters</Button>
              <Button size="small" startIcon={<CodeIcon />} onClick={() => setSqlDialogOpen(true)}>View SQL</Button>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<VisibilityIcon />} onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? 'Hide' : 'Show'} Preview
              </Button>
            </Stack>
            
            <FilterSection title="Transaction Attributes" subtitle="Filter by transaction characteristics" icon={<CategoryIcon color="primary" fontSize="small" />}>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Category</InputLabel>
                    <Select multiple value={filters.transaction_filters.transaction_category} onChange={(e) => handleFilterChange('transaction_filters', 'transaction_category', e.target.value)} renderValue={(s) => <Box sx={{display:'flex', flexWrap: 'wrap', gap:0.5}}>{s.map(v => <Chip key={v} label={v} size="small"/>)}</Box>}>
                      {availableFilters?.transaction_categories?.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Direction</InputLabel>
                    <Select multiple value={filters.transaction_filters.transaction_direction} onChange={(e) => handleFilterChange('transaction_filters', 'transaction_direction', e.target.value)} renderValue={(s) => <Box sx={{display:'flex', flexWrap: 'wrap', gap:0.5}}>{s.map(v => <Chip key={v} label={v} size="small"/>)}</Box>}>
                      <MenuItem value="DEBIT">Debit</MenuItem>
                      <MenuItem value="CREDIT">Credit</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={2}>
                  <TextField fullWidth size="small" label="Min Amount" type="number" value={filters.transaction_filters.min_amount} onChange={(e) => handleFilterChange('transaction_filters', 'min_amount', e.target.value)} />
                </Grid>
                <Grid item xs={2}>
                  <TextField fullWidth size="small" label="Max Amount" type="number" value={filters.transaction_filters.max_amount} onChange={(e) => handleFilterChange('transaction_filters', 'max_amount', e.target.value)} />
                </Grid>
              </Grid>
            </FilterSection>

            <FilterSection title="Customer Risk Profile" subtitle="Risk indicators and customer attributes" icon={<PersonIcon color="secondary" fontSize="small" />}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Risk Rating</InputLabel>
                    <Select multiple value={filters.customer_filters.customer_risk_rating} onChange={(e) => handleFilterChange('customer_filters', 'customer_risk_rating', e.target.value)} renderValue={(s) => <Box sx={{display:'flex', flexWrap: 'wrap', gap:0.5}}>{s.map(v => <Chip key={v} label={v} size="small"/>)}</Box>}>
                      {availableFilters?.risk_ratings?.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>PEP Flag</InputLabel>
                    <Select value={filters.customer_filters.pep_flag} onChange={(e) => handleFilterChange('customer_filters', 'pep_flag', e.target.value)}>
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="Y">PEP Only</MenuItem>
                      <MenuItem value="N">Non-PEP Only</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </FilterSection>

            <FilterSection title="Account Status" subtitle="Account type and status filters" icon={<AccountIcon color="info" fontSize="small" />} defaultExpanded={false}>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Account Status</InputLabel>
                    <Select multiple value={filters.account_filters.account_status} onChange={(e) => handleFilterChange('account_filters', 'account_status', e.target.value)} renderValue={(s) => <Box sx={{display:'flex', flexWrap: 'wrap', gap:0.5}}>{s.map(v => <Chip key={v} label={v} size="small"/>)}</Box>}>
                      {availableFilters?.account_statuses?.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </FilterSection>

            <Collapse in={showPreview}>
              <Box sx={{ mt: 3 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
                  <TableChart color="primary" fontSize="small" />
                  <Typography variant="subtitle2" fontWeight="600">Sample Preview</Typography>
                  <Chip label="Live Query" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem', borderColor: 'primary.main', color: 'primary.main' }} />
                </Stack>
                <Paper variant="outlined" sx={{ overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                  {previewData ? (
                    <Box sx={{ overflow: 'auto', maxHeight: 300 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {previewData.columns.slice(0, 8).map(col => (
                              <TableCell key={col} sx={{ fontWeight: 600, bgcolor: 'grey.50', fontSize: '0.75rem', py: 1, borderBottom: '2px solid', borderColor: 'divider' }}>
                                {col}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {previewData.rows.map((row, i) => (
                            <TableRow key={i} hover>
                              {previewData.columns.slice(0, 8).map(col => (
                                <TableCell key={col} sx={{ fontSize: '0.75rem', py: 1 }}>{row[col]}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  ) : (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                      <CircularProgress size={24} />
                      <Typography variant="caption" display="block" sx={{ mt: 1.5 }} color="text.secondary">Loading sample data...</Typography>
                    </Box>
                  )}
                </Paper>
              </Box>
            </Collapse>
          </Grid>

          <Grid item xs={12} md={4}>
            <PopulationImpactPanel 
              liveStats={liveStats} 
              loading={loading}
              onViewSQL={() => setSqlDialogOpen(true)}
            />
            
            {enhancedStats?.warnings && (
              <FilterDependencyWarnings warnings={enhancedStats.warnings} />
            )}
            
            {enhancedStats?.cardinality && (
              <CardinalityPreviewPanel cardinality={enhancedStats.cardinality} />
            )}
            
            {enhancedStats?.excluded_summary && (
              <ExcludedPopulationPanel excluded={enhancedStats.excluded_summary} />
            )}
            
            <Paper sx={{ p: 2.5, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200' }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.5 }}>
                <CheckCircle sx={{ fontSize: 20, color: 'success.main', mt: 0.25 }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight="600" color="success.900">Ready to Proceed</Typography>
                  <Typography variant="caption" color="success.800" sx={{ mt: 0.5, display: 'block' }}>Population defined · Next: Aggregation rules</Typography>
                </Box>
              </Stack>
              <Button 
                variant="contained" 
                color="success" 
                fullWidth 
                endIcon={<ArrowForward />} 
                onClick={handleProceed}
                disabled={isNavigatingRef.current}
                sx={{ mt: 1.5, py: 1.25, fontWeight: 600 }}
              >
                {isNavigatingRef.current ? 'Processing...' : 'Proceed to Aggregation'}
              </Button>
            </Paper>
          </Grid>
        </Grid>
      </PageContainer>
    </PageTransition>
  );
};

export default PopulationExplorerScreen;