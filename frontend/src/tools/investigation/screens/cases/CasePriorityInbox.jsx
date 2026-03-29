import React, { useState, useEffect } from 'react';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import { mergeFccSentinelHandoff } from '../../../../utils/fccSentinelHandoff';

// ✅ 1. Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";
// ✅ 2. Import New Manual Component
import FocusEngineManual from "@investigation/components/guide/FocusEngineManual";

// MUI Components
import {
  Box, Paper, Typography, Button, Divider, Chip,
  CircularProgress, Alert, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Checkbox, TextField,
  Collapse, IconButton, Stack, Tooltip, ButtonGroup
} from '@mui/material';

// MUI Icons
import {
  PlayArrow, Settings, CheckCircle, ArrowForward,
  History, Layers, Add, Close, FilterList,
  ExpandMore, ExpandLess, ChevronLeft, ChevronRight,
  InfoOutlined 
} from '@mui/icons-material';

const CasePriorityInbox = ({ setActiveTab }) => {
  const { 
    activeEnv, 
    priorityBuckets, 
    activateBucket,
    addBucketToPriority, 
    refreshPriorityBuckets
  } = useAppContext();
  
  const [cases, setCases] = useState([]);
  const [history, setHistory] = useState([]);
  const [meta, setMeta] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  const [viewMode, setViewMode] = useState('queue');
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [error, setError] = useState(null);

  // ✅ New State for Manual
  const [showManual, setShowManual] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  const [config, setConfig] = useState({
    min_score_threshold: 20, 
    lookback_days: 90,
    weights: { critical: 20, high: 10 },
    auto_exclusion: { suppress_score_below: 10 }
  });

  const buckets = priorityBuckets.buckets;
  const activeBucket = priorityBuckets.activeBucket;

  useEffect(() => {
    if (!activeEnv || priorityBuckets.allCases.length > 0) return;
    loadInbox();
  }, [activeEnv, priorityBuckets.allCases.length]);

  useEffect(() => {
    if (!activeEnv) return;
    loadHistory();
  }, [activeEnv]);

  useEffect(() => {
    if (priorityBuckets.allCases.length > 0) {
      setCases(priorityBuckets.allCases);
      setMeta({ 
        run_id: priorityBuckets.lastRunId, 
        run_at: priorityBuckets.lastRunDate 
      });
    }
  }, [priorityBuckets.allCases]);

  const loadInbox = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getFocusInbox();
      if (res.success) {
        setCases(res.cases || []);
        setMeta({ run_id: res.run_id, run_at: res.run_at });
      }
    } catch (err) {
      setError("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await apiClient.getFocusHistory();
      if (res.success) setHistory(res.history);
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const runFocusEngine = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await apiClient.runFocusEngine(config);
      if (res.success) {
        await loadInbox();
        await loadHistory();
        setViewMode('queue');
        refreshPriorityBuckets();
      } else {
        setError(res.error || "Engine run failed");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleBulkMove = async (targetBucket) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setCases(prev => prev.map(c => 
      ids.includes(c.case_id) ? { ...c, bucket: targetBucket } : c
    ));
    setSelectedIds(new Set());

    try {
      await apiClient.updateCaseBucket(ids, targetBucket, meta?.run_id);
      setTimeout(() => refreshPriorityBuckets(), 500);
    } catch (e) {
      setError("Failed to save changes");
    }
  };

  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedCases.length && paginatedCases.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedCases.map(c => c.case_id)));
    }
  };

  const createBucket = () => {
    if (newBucketName && !buckets.includes(newBucketName)) {
      addBucketToPriority(newBucketName);
      activateBucket(newBucketName);
      setNewBucketName('');
      setIsCreatingBucket(false);
    }
  };

  const handleBucketChange = (bucketName) => {
    activateBucket(bucketName);
    setCurrentPage(1);
  };

  const openCaseInvestigation = (caseId) => {
    mergeFccSentinelHandoff({
      selected_case_id: caseId,
      preferred_screen: 'investigate',
    });
    setActiveTab?.('investigate');
  };

  const filteredCases = cases.filter(c => 
    activeBucket === 'All' ? true : c.bucket === activeBucket
  );

  const totalPages = Math.ceil(filteredCases.length / ITEMS_PER_PAGE);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedCases = filteredCases.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  return (
    <PageContainer
      title="Priority Case Inbox" 
      subtitle="Intelligent risk-based work queue"
      breadcrumbs={['System', 'Priority Inbox']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <ButtonGroup variant="contained" disableElevation sx={{ boxShadow: 2 }}>
              <Button 
                onClick={runFocusEngine}
                disabled={isRunning}
                startIcon={isRunning ? <CircularProgress size={16} color="inherit"/> : <PlayArrow />}
                sx={{ fontWeight: 600 }}
              >
                {isRunning ? 'Running...' : 'Run Analysis'}
              </Button>
              <Tooltip title="How does the Focus Engine work?">
                <Button 
                  size="small" 
                  onClick={() => setShowManual(true)}
                  sx={{ px: 1, minWidth: '40px' }}
                >
                  <InfoOutlined fontSize="small" />
                </Button>
              </Tooltip>
          </ButtonGroup>

          <Button 
            onClick={() => setViewMode('queue')} 
            variant={viewMode === 'queue' ? 'contained' : 'outlined'}
            size="small"
            startIcon={<Layers />}
            sx={{ fontWeight: 600 }}
          >
            Queue
          </Button>
          <Button 
            onClick={() => setViewMode('history')} 
            variant={viewMode === 'history' ? 'contained' : 'outlined'}
            size="small"
            startIcon={<History />}
            sx={{ fontWeight: 600 }}
          >
            History
          </Button>
        </Stack>
      }
    >
      {/* ✅ MANUAL COMPONENT */}
      <FocusEngineManual open={showManual} onClose={() => setShowManual(false)} />

      {/* Main Content Area */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* CONFIG PANEL */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box 
            onClick={() => setShowConfig(!showConfig)}
            sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', '&:hover': { bgcolor: 'grey.50' } }}
          >
            <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Settings fontSize="small" /> Engine Configuration
            </Typography>
            <IconButton size="small">
              {showConfig ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>
          
          <Collapse in={showConfig}>
            <Box sx={{ px: 3, pb: 3, borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={2} mt={2}>
                <TextField
                  label="Lookback Days"
                  type="number"
                  size="small"
                  value={config.lookback_days}
                  onChange={e => setConfig({...config, lookback_days: parseInt(e.target.value) || 0})}
                  sx={{ flex: 1 }}
                  helperText="Search window for alerts"
                />
                <TextField
                  label="Min Score Threshold"
                  type="number"
                  size="small"
                  value={config.min_score_threshold}
                  onChange={e => setConfig({...config, min_score_threshold: parseInt(e.target.value) || 0})}
                  sx={{ flex: 1 }}
                  helperText="Score required for 'Monitor' bucket"
                />
                <TextField
                  label="Auto-Suppress Below"
                  type="number"
                  size="small"
                  value={config.auto_exclusion.suppress_score_below}
                  onChange={e => setConfig({...config, auto_exclusion: { suppress_score_below: parseInt(e.target.value) || 0 }})}
                  sx={{ flex: 1 }}
                  helperText="Score < X excluded automatically"
                />
              </Stack>
            </Box>
          </Collapse>
        </Paper>

        {viewMode === 'history' ? (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <TableContainer>
              <Table size="small">
                <TableHead sx={{ bgcolor: 'grey.50' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Run ID</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Executed At</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Cases</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Config</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map(h => (
                    <TableRow key={h.run_id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{h.run_id}</TableCell>
                      <TableCell>{new Date(h.executed_at).toLocaleString()}</TableCell>
                      <TableCell><Chip label={h.case_count} size="small" /></TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>Score ≥ {h.config?.min_score_threshold || 'N/A'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        ) : (
          <>
            {/* BUCKET CONTROLS */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {buckets.map(b => (
                  <Button 
                    key={b}
                    onClick={() => handleBucketChange(b)}
                    variant={activeBucket === b ? 'contained' : 'outlined'}
                    size="small"
                    sx={{ fontWeight: 600 }}
                  >
                    {b} <Chip label={b === 'All' ? cases.length : cases.filter(x => x.bucket === b).length} size="small" sx={{ ml: 1, height: 20 }} />
                  </Button>
                ))}
                
                {isCreatingBucket ? (
                  <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', px: 1.5, gap: 1 }}>
                    <TextField 
                      autoFocus 
                      value={newBucketName} 
                      onChange={e => setNewBucketName(e.target.value)} 
                      onKeyDown={e => e.key === 'Enter' && createBucket()} 
                      placeholder="Bucket Name" 
                      size="small"
                      sx={{ width: 120 }}
                    />
                    <IconButton size="small" onClick={createBucket} color="success"><CheckCircle fontSize="small"/></IconButton>
                    <IconButton size="small" onClick={() => setIsCreatingBucket(false)} color="error"><Close fontSize="small"/></IconButton>
                  </Paper>
                ) : (
                  <Button 
                    onClick={() => setIsCreatingBucket(true)} 
                    variant="outlined"
                    size="small"
                    startIcon={<Add />}
                    sx={{ borderStyle: 'dashed' }}
                  >
                    New Bucket
                  </Button>
                )}
              </Stack>
            </Box>

            {selectedIds.size > 0 && (
              <Alert severity="info" icon={<CheckCircle />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" fontWeight="bold">{selectedIds.size} selected</Typography>
                  <Divider orientation="vertical" flexItem />
                  <Typography variant="caption">Move to:</Typography>
                  {buckets.filter(b => b !== 'All' && b !== activeBucket).map(b => (
                    <Button key={b} onClick={() => handleBulkMove(b)} size="small" variant="outlined">
                      {b}
                    </Button>
                  ))}
                  <Button onClick={() => setSelectedIds(new Set())} size="small">Cancel</Button>
                </Box>
              </Alert>
            )}

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
                  <CircularProgress size={48} />
                </Box>
            ) : filteredCases.length === 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 10 }}>
                  <FilterList sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">Bucket Empty</Typography>
                  <Typography variant="body2" color="text.disabled">No cases in "{activeBucket}"</Typography>
                </Box>
            ) : (
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox 
                            checked={selectedIds.size === paginatedCases.length && paginatedCases.length > 0} 
                            onChange={toggleSelectAll} 
                          />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Case ID</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Source</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Risk Score</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Key Drivers</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Alert Vol</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Bucket</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }} align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedCases.map(c => (
                        <TableRow 
                          key={c.case_id} 
                          hover
                          selected={selectedIds.has(c.case_id)}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox 
                              checked={selectedIds.has(c.case_id)} 
                              onChange={() => toggleSelection(c.case_id)} 
                            />
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{c.case_id}</TableCell>
                          <TableCell>
                            <Stack spacing={0.5}>
                              <Chip
                                label={c.source_pipeline_name || 'Sentinel workspace'}
                                size="small"
                                color={c.source_pipeline_name ? 'primary' : 'default'}
                                variant={c.source_pipeline_name ? 'filled' : 'outlined'}
                                sx={{ maxWidth: 180, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                              />
                              {c.source_publish_label ? (
                                <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 180 }} noWrap>
                                  {c.source_publish_label}
                                </Typography>
                              ) : null}
                              {(c.case_priority || c.historical_frequency) ? (
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                  {c.case_priority ? (
                                    <Chip
                                      label={`Priority ${c.case_priority}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.62rem' }}
                                    />
                                  ) : null}
                                  {c.historical_frequency ? (
                                    <Chip
                                      label={`${c.historical_frequency} history`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.62rem' }}
                                    />
                                  ) : null}
                                </Stack>
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 80, height: 6, bgcolor: 'grey.200', borderRadius: 1, overflow: 'hidden' }}>
                                <Box 
                                  sx={{ 
                                    width: `${c.risk_score}%`, 
                                    height: '100%', 
                                    bgcolor: c.risk_score >= 80 ? 'error.main' : c.risk_score >= 50 ? 'warning.main' : 'primary.main'
                                  }} 
                                />
                              </Box>
                              <Typography variant="body2" fontWeight="bold">{c.risk_score}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.6}>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {(c.reasons?.length ? c.reasons.slice(0, 2) : [c.behavior_context].filter(Boolean)).map((r, i) => (
                                  <Chip key={i} label={r} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                                ))}
                              </Stack>
                              {(c.linked_cases_count || c.prior_alerts_count || c.customer_risk_rating) ? (
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                  {c.customer_risk_rating ? (
                                    <Chip
                                      label={`Customer ${c.customer_risk_rating}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.62rem' }}
                                    />
                                  ) : null}
                                  {c.prior_alerts_count ? (
                                    <Chip
                                      label={`${c.prior_alerts_count} prior alerts`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.62rem' }}
                                    />
                                  ) : null}
                                  {c.linked_cases_count ? (
                                    <Chip
                                      label={`${c.linked_cases_count} linked cases`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.62rem' }}
                                    />
                                  ) : null}
                                </Stack>
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight="bold">{c.alert_count}</Typography>
                            {c.critical_alerts > 0 && <Typography variant="caption" color="error"> ({c.critical_alerts}!)</Typography>}
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={c.bucket} 
                              size="small" 
                              color={c.bucket === 'Priority' ? 'error' : c.bucket === 'Monitor' ? 'warning' : 'default'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button 
                              onClick={() => openCaseInvestigation(c.case_id)}
                              size="small"
                              endIcon={<ArrowForward />}
                              sx={{ textTransform: 'none' }}
                            >
                              Investigate
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {totalPages > 1 && (
                  <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'grey.50' }}>
                    <Typography variant="body2" color="text.secondary">
                      Showing {startIdx + 1}-{Math.min(startIdx + ITEMS_PER_PAGE, filteredCases.length)} of {filteredCases.length}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <IconButton 
                        size="small"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft />
                      </IconButton>
                      <Chip label={`Page ${currentPage} of ${totalPages}`} size="small" />
                      <IconButton 
                        size="small"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        <ChevronRight />
                      </IconButton>
                    </Box>
                  </Box>
                )}
              </Paper>
            )}
          </>
        )}
      </Box>
    </PageContainer>
  );
};
export default CasePriorityInbox;
