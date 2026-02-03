import React, { useState, useEffect } from 'react';
import { useAppContext, usePersistentState } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box, Button, Card, CardContent, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Chip, CircularProgress, Fade, LinearProgress, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Slider, Tabs, Tab, Divider, Alert
} from '@mui/material';

import {
  Search as SearchIcon, Refresh as RefreshIcon, TrendingUp as TrendingUpIcon, FilterList as FilterIcon, Download as DownloadIcon, Share as ShareIcon, Lightbulb as LightbulbIcon, HelpOutline as HelpIcon, Settings as SettingsIcon, Close as CloseIcon, Psychology as BrainIcon, Check as CheckIcon, Error as ErrorIcon, Visibility as VisibilityIcon, VisibilityOff as VisibilityOffIcon, MenuBook as BookIcon, CompareArrows as CompareIcon, AutoAwesome as SparklesIcon, Description as FileTextIcon, Info as InfoIcon
} from '@mui/icons-material';
import StorageIcon from '@mui/icons-material/Storage';

const VectorSearchScreen = () => {
  const { caseList, loadCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = usePersistentState('vec_caseId', '');
  const [textQuery, setTextQuery] = usePersistentState('vec_query', '');
  const [searchResults, setSearchResults] = usePersistentState('vec_results', null);
  const [topK, setTopK] = useState(5);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexStatus, setIndexStatus] = useState(null);
  const [showHowTo, setShowHowTo] = useState(false);
  const [searchMode, setSearchMode] = useState('case'); // 'case' or 'text'
  const [filterThreshold, setFilterThreshold] = useState(0);
  const [indexMetrics, setIndexMetrics] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBatchCases, setSelectedBatchCases] = useState([]);
  const [comparisonResults, setComparisonResults] = useState(null);
  const [expandedResults, setExpandedResults] = useState({});
  const [explanations, setExplanations] = useState({});
  const [analyzingIds, setAnalyzingIds] = useState({});

  const getCaseId = (item) => item.caseid || item.case_id || item.Case_ID || item.id || 'Unknown';

  useEffect(() => { 
    if (!caseList || caseList.length === 0) loadCaseList(); 
  }, []);
  
  useEffect(() => {
    if (caseList && caseList.length > 0 && !selectedCaseId) {
      setSelectedCaseId(getCaseId(caseList[0]));
    }
  }, [caseList]);

  useEffect(() => {
    loadIndexMetrics();
  }, []);

  const loadIndexMetrics = async () => {
    try {
      const res = await apiClient.get('/api/v2/rag/index-status');
      setIndexMetrics(res);
    } catch (err) {
      console.error('Failed to load index metrics:', err);
    }
  };

  const handleBuildIndex = async () => {
    setIsIndexing(true); 
    setIndexStatus(null);
    try {
      const res = await apiClient.post('/api/v2/rag/build-index', { force_rebuild: true });
      setIndexStatus({
        type: 'success',
        message: `Index Rebuilt: ${res.case_count} cases processed in ${res.dimension}D space.`
      });
      await loadIndexMetrics();
    } catch (err) { 
      setIndexStatus({
        type: 'error',
        message: `Error: ${err.message}`
      });
    } 
    finally { setIsIndexing(false); }
  };

  const handleSearch = async (mode) => {
    setIsLoading(true); 
    setSearchResults(null);
    setComparisonResults(null);
    setExpandedResults({});
    setExplanations({});
    try {
      let res;
      if (mode === 'case') {
        res = await apiClient.post('/api/v2/rag/similar-cases', { 
          case_id: selectedCaseId, 
          top_k: topK 
        });
        setSearchResults(res.similar_cases || []);
      } else {
        res = await apiClient.post('/api/v2/rag/search-text', { 
          query: textQuery, 
          top_k: topK 
        });
        setSearchResults(res.results || []);
      }
    } catch (err) { 
      console.error(err);
      setSearchResults([]);
    } 
    finally { setIsLoading(false); }
  };

  const handleBatchCompare = async () => {
    if (selectedBatchCases.length < 2) return;
    setIsLoading(true);
    setExpandedResults({});
    setExplanations({});
    try {
      const res = await apiClient.post('/api/v2/rag/batch-compare', {
        case_ids: selectedBatchCases,
        top_k: topK
      });
      setComparisonResults(res.comparison_matrix);
    } catch (err) {
      console.error(err);
    }
    finally { setIsLoading(false); }
  };

  const toggleBatchCase = (caseId) => {
    setSelectedBatchCases(prev => 
      prev.includes(caseId) 
        ? prev.filter(id => id !== caseId)
        : [...prev, caseId]
    );
  };

  const exportResults = () => {
    if (!searchResults) return;
    const data = JSON.stringify(searchResults, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector_search_${Date.now()}.json`;
    a.click();
  };

  const handleAnalyze = async (resultCaseId, idx) => {
    setAnalyzingIds(prev => ({ ...prev, [idx]: true }));
    try {
      const res = await apiClient.post('/api/v2/rag/explain', {
        case_id_1: selectedCaseId,
        case_id_2: resultCaseId,
        similarity_score: searchResults[idx].similarity_score
      });
      setExplanations(prev => ({ ...prev, [idx]: res.explanation || "Analysis completed." }));
    } catch (e) { 
      console.error('Explanation error:', e);
      setExplanations(prev => ({ ...prev, [idx]: "Could not generate explanation." }));
    }
    finally { 
      setAnalyzingIds(prev => ({ ...prev, [idx]: false }));
    }
  };

  const toggleExpanded = (idx) => {
    setExpandedResults(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const filteredResults = searchResults?.filter(r => r.similarity_score >= filterThreshold / 100) || [];

  const exampleQueries = [
    "High volume cash structuring with rapid movement",
    "Shell company with minimal operational activity",
    "Sudden large wire transfers to high-risk jurisdictions"
  ];

  return (
    <PageContainer 
      title="Semantic Case Search" 
      subtitle="AI-powered pattern discovery using vector embeddings"
      breadcrumbs={['Investigation', 'Vector Search']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Button 
            variant="text" 
            size="small" 
            color="secondary" 
            startIcon={<BookIcon />} 
            onClick={() => setShowHowTo(true)}
          >
            Guide
          </Button>
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={isIndexing ? <CircularProgress size={16} color="inherit"/> : <RefreshIcon />} 
            onClick={handleBuildIndex} 
            disabled={isIndexing}
          >
            Rebuild Index
          </Button>
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<DownloadIcon />} 
            onClick={exportResults} 
            disabled={!filteredResults.length}
          >
            Export
          </Button>
          <Button 
            variant="contained" 
            size="small" 
            disableElevation 
            color="primary" 
            startIcon={isLoading ? <CircularProgress size={16} color="inherit"/> : <SearchIcon />} 
            onClick={() => handleSearch(searchMode)} 
            disabled={isLoading || (searchMode === 'case' && !selectedCaseId) || (searchMode === 'text' && !textQuery.trim())}
            sx={{ fontWeight: '600' }}
          >
            Search
          </Button>
        </Stack>
      }
    >
      {/* ✅ Fixed Layout: Content Wrapper with proper height calc */}
      <Box sx={{ height: 'calc(100vh - 140px)', overflowY: 'auto', overflowX: 'hidden', p: 3, pb: 6 }}>
        
        {/* Index Status & Metrics */}
        {indexMetrics && (
          <Fade in>
            <Paper elevation={0} sx={{ mb: 3, p: 2, bgcolor: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StorageIcon fontSize="small" /> Vector Index Status 
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    FAISS Inner Product (Cosine Similarity)
                  </Typography>
                </Box>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="bold" color="primary.main">
                      {indexMetrics.total_vectors || 0}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Vectors</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="bold" color="primary.main">
                      {indexMetrics.embedding_dim || 768}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Dimensions</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight="600">
                      {indexMetrics.last_updated || 'Never'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Last Build</Typography>
                  </Box>
                </Stack>
              </Stack>
              {indexStatus && (
                <Alert 
                  severity={indexStatus.type === 'success' ? 'success' : 'error'} 
                  sx={{ mt: 2 }}
                  onClose={() => setIndexStatus(null)}
                >
                  {indexStatus.message}
                </Alert>
              )}
            </Paper>
          </Fade>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '380px 1fr' }, gap: 3 }}>
          
          {/* LEFT PANEL: Search Controls */}
          <Box>
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SettingsIcon fontSize="small" /> SEARCH CONFIGURATION
                </Typography>
              </Box>

              <CardContent sx={{ p: 2 }}>
                
                {/* Mode Tabs */}
                <Tabs 
                  value={searchMode} 
                  onChange={(e, v) => setSearchMode(v)} 
                  variant="fullWidth" 
                  sx={{ mb: 3, bgcolor: '#f5f5f5', borderRadius: 1, minHeight: 36 }}
                >
                  <Tab 
                    value="case" 
                    label="Case Match" 
                    icon={<SearchIcon fontSize="small" />} 
                    iconPosition="start"
                    sx={{ minHeight: 36, py: 0.5, fontSize: '0.85rem', fontWeight: 'bold' }}
                  />
                  <Tab 
                    value="text" 
                    label="Hypothesis" 
                    icon={<BrainIcon fontSize="small" />} 
                    iconPosition="start"
                    sx={{ minHeight: 36, py: 0.5, fontSize: '0.85rem', fontWeight: 'bold' }}
                  />
                </Tabs>

                {/* Top K Slider */}
                <Box sx={{ mb: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <TrendingUpIcon fontSize="small" /> Result Limit (Top K)
                    </Typography>
                    <Chip label={topK} color="primary" size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                  </Stack>
                  <Slider
                    value={topK}
                    onChange={(e, v) => setTopK(v)}
                    min={1}
                    max={20}
                    step={1}
                    marks
                    size="small"
                    valueLabelDisplay="auto"
                  />
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>Precision</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>Recall</Typography>
                  </Stack>
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Min Similarity Filter */}
                <Box sx={{ mb: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FilterIcon fontSize="small" /> Min. Similarity
                    </Typography>
                    <Chip label={`${filterThreshold}%`} color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                  </Stack>
                  <Slider
                    value={filterThreshold}
                    onChange={(e, v) => setFilterThreshold(v)}
                    min={0}
                    max={95}
                    step={5}
                    size="small"
                    valueLabelDisplay="auto"
                    color="warning"
                  />
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Batch Mode Toggle */}
                {searchMode === 'case' && (
                  <Box sx={{ mb: 3 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <input 
                        type="checkbox" 
                        id="batch-mode"
                        checked={batchMode}
                        onChange={e => setBatchMode(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: '#1976d2' }}
                      />
                      <label htmlFor="batch-mode" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', flex: 1 }}>
                        Batch Comparison Mode
                      </label>
                      <Tooltip title="Compare multiple cases at once">
                        <InfoIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </Tooltip>
                    </Stack>
                  </Box>
                )}

                {/* Case Selection */}
                {searchMode === 'case' && !batchMode && (
                  <Box>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block" mb={1}>
                      FIND SIMILAR CASES
                    </Typography>
                    <FormControl fullWidth size="small">
                      <InputLabel>Select Target Case</InputLabel>
                      <Select 
                        value={selectedCaseId} 
                        onChange={e => setSelectedCaseId(e.target.value)}
                        label="Select Target Case"
                      >
                        {(caseList || []).map((c, i) => (
                          <MenuItem key={i} value={getCaseId(c)}>{getCaseId(c)}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                )}

                {/* Batch Selection */}
                {searchMode === 'case' && batchMode && (
                  <Box>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block" mb={1}>
                      BATCH COMPARISON ({selectedBatchCases.length} selected)
                    </Typography>
                    <Paper variant="outlined" sx={{ maxHeight: 240, overflowY: 'auto', p: 1, bgcolor: '#fafafa' }}>
                      <Stack spacing={0.5}>
                        {(caseList || []).slice(0, 20).map((c, i) => {
                          const caseId = getCaseId(c);
                          const isSelected = selectedBatchCases.includes(caseId);
                          return (
                            <Box 
                              key={i}
                              onClick={() => toggleBatchCase(caseId)}
                              sx={{ 
                                p: 1, 
                                bgcolor: isSelected ? '#e3f2fd' : '#fff',
                                border: isSelected ? '2px solid #1976d2' : '1px solid #e0e0e0',
                                borderRadius: 1,
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: isSelected ? 600 : 400,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                transition: 'all 0.2s',
                                '&:hover': { bgcolor: isSelected ? '#e3f2fd' : '#f5f5f5' }
                              }}
                            >
                              <Box sx={{ 
                                width: 16, 
                                height: 16, 
                                borderRadius: '3px',
                                border: isSelected ? 'none' : '2px solid #ccc',
                                bgcolor: isSelected ? '#1976d2' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}>
                                {isSelected && <CheckIcon sx={{ fontSize: 12, color: '#fff' }} />}
                              </Box>
                              {caseId}
                            </Box>
                          );
                        })}
                      </Stack>
                    </Paper>
                    <Button 
                      fullWidth
                      variant="contained"
                      color="secondary"
                      startIcon={<CompareIcon />}
                      onClick={handleBatchCompare}
                      disabled={isLoading || selectedBatchCases.length < 2}
                      sx={{ mt: 2, fontWeight: 'bold' }}
                    >
                      Compare Selected
                    </Button>
                  </Box>
                )}

                {/* Hypothesis Search */}
                {searchMode === 'text' && (
                  <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block">
                        HYPOTHESIS QUERY
                      </Typography>
                      <Tooltip title="Click for examples">
                        <IconButton size="small" onClick={() => setShowHowTo(true)}>
                          <HelpIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    
                    <Stack spacing={1} mb={2}>
                      {exampleQueries.map((example, idx) => (
                        <Button
                          key={idx}
                          onClick={() => setTextQuery(example)}
                          size="small"
                          variant="outlined"
                          sx={{ 
                            justifyContent: 'flex-start', 
                            textAlign: 'left', 
                            fontSize: '0.7rem',
                            py: 0.75,
                            px: 1.5,
                            borderColor: '#e0e0e0',
                            color: 'text.secondary',
                            textTransform: 'none',
                            '&:hover': { bgcolor: '#f5f5f5', borderColor: '#1976d2' }
                          }}
                          startIcon={<LightbulbIcon sx={{ fontSize: 14 }} />}
                        >
                          {example}
                        </Button>
                      ))}
                    </Stack>

                    <TextField
                      fullWidth
                      multiline
                      rows={4}
                      value={textQuery}
                      onChange={e => setTextQuery(e.target.value)}
                      placeholder="Describe the pattern you're looking for in natural language..."
                      variant="outlined"
                      size="small"
                      sx={{ bgcolor: '#fafafa' }}
                    />
                  </Box>
                )}

              </CardContent>
            </Paper>
          </Box>

          {/* RIGHT PANEL: Results */}
          <Box>
            <Paper variant="outlined" sx={{ borderRadius: 2, minHeight: 600 }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#fff', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold" color="text.primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SparklesIcon fontSize="small" color="primary" /> INVESTIGATION RESULTS
                  </Typography>
                  {filteredResults.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Showing {filteredResults.length} of {searchResults?.length || 0} matches
                      {filterThreshold > 0 && ` (≥${filterThreshold}% similarity)`}
                    </Typography>
                  )}
                </Box>
                {filteredResults.length > 0 && (
                  <Stack direction="row" spacing={1}>
                    <Tooltip title="Share Results">
                      <IconButton size="small"><ShareIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Box>

              <Box sx={{ p: 3 }}>
                {/* Loading State */}
                {isLoading && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 12 }}>
                    <CircularProgress size={48} sx={{ mb: 3 }} />
                    <Typography variant="body1" fontWeight="600" color="text.secondary" mb={1}>
                      Calculating Vector Distances... 
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      Analyzing {topK} nearest neighbors in {indexMetrics?.embedding_dim || 768}D space
                    </Typography>
                  </Box>
                )}

                {/* Empty State */}
                {!isLoading && searchResults && searchResults.length === 0 && (
                  <Box sx={{ textAlign: 'center', py: 12 }}>
                    <ErrorIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2, opacity: 0.5 }} />
                    <Typography variant="body1" fontWeight="600" color="text.secondary" mb={1}>
                      No matches found
                    </Typography>
                    <Typography variant="body2" color="text.disabled">
                      Try adjusting your search parameters or lowering the similarity threshold.
                    </Typography>
                  </Box>
                )}

                {/* Results List */}
                {!isLoading && filteredResults.length > 0 && !comparisonResults && (
                  <Stack spacing={2}>
                    {filteredResults.map((result, idx) => {
                      const scorePercent = Math.round(result.similarity_score * 100);
                      let chipColor = 'default';
                      let chipLabel = 'Match';
                      
                      if (scorePercent > 85) { chipColor = 'success'; chipLabel = 'High Match'; }
                      else if (scorePercent > 70) { chipColor = 'primary'; chipLabel = 'Good Match'; }
                      else if (scorePercent > 50) { chipColor = 'warning'; chipLabel = 'Moderate'; }

                      return (
                        <Card key={idx} variant="outlined" sx={{ '&:hover': { boxShadow: 2 } }}>
                          <CardContent sx={{ p: 2 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ 
                                  width: 36, 
                                  height: 36, 
                                  bgcolor: scorePercent > 85 ? '#e8f5e9' : scorePercent > 70 ? '#e3f2fd' : '#fff3e0',
                                  borderRadius: 1.5,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 'bold',
                                  fontSize: '0.9rem',
                                  border: '2px solid',
                                  borderColor: scorePercent > 85 ? '#4caf50' : scorePercent > 70 ? '#2196f3' : '#ff9800'
                                }}>
                                  #{idx + 1}
                                </Box>
                                <Box>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="subtitle1" fontWeight="bold">
                                      {result.case_id}
                                    </Typography>
                                    {scorePercent > 80 && (
                                      <Chip 
                                        label={chipLabel} 
                                        color={chipColor} 
                                        size="small" 
                                        sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                      />
                                    )}
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <FileTextIcon sx={{ fontSize: 12 }} /> Semantic Pattern Match
                                  </Typography>
                                </Box>
                              </Box>

                              <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="h5" fontWeight="bold" color={
                                  scorePercent > 85 ? 'success.main' : scorePercent > 70 ? 'primary.main' : scorePercent > 50 ? 'warning.main' : 'text.secondary'
                                }>
                                  {scorePercent}%
                                </Typography>
                                <Typography variant="caption" color="text.disabled" sx={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>
                                  Similarity
                                </Typography>
                              </Box>
                            </Stack>

                            <LinearProgress 
                              variant="determinate" 
                              value={scorePercent} 
                              sx={{ 
                                height: 6, 
                                borderRadius: 1, 
                                mb: 2,
                                bgcolor: '#f5f5f5',
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: scorePercent > 85 ? '#4caf50' : scorePercent > 70 ? '#2196f3' : '#ff9800'
                                }
                              }} 
                            />

                            <Paper 
                              variant="outlined" 
                              sx={{ 
                                p: 1.5, 
                                bgcolor: '#fafafa', 
                                mb: 2,
                                maxHeight: expandedResults[idx] ? 'none' : 60,
                                overflow: 'hidden',
                                position: 'relative'
                              }}
                            >
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.6 }}>
                                {result.summary || "No vector summary data available."}
                              </Typography>
                            </Paper>

                            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                              <Button
                                size="small"
                                onClick={() => toggleExpanded(idx)}
                                startIcon={expandedResults[idx] ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                sx={{ fontSize: '0.75rem' }}
                              >
                                {expandedResults[idx] ? 'Show Less' : 'Show More'}
                              </Button>

                              {!explanations[idx] ? (
                                <Button
                                  size="small"
                                  onClick={() => handleAnalyze(result.case_id, idx)}
                                  disabled={analyzingIds[idx]}
                                  startIcon={analyzingIds[idx] ? <CircularProgress size={14} /> : <BrainIcon />}
                                  color="primary"
                                  sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}
                                >
                                  {analyzingIds[idx] ? 'Analyzing...' : 'Explain Match'}
                                </Button>
                              ) : null}
                            </Stack>

                            {explanations[idx] && (
                              <Fade in>
                                <Alert 
                                  severity="info" 
                                  icon={<SparklesIcon />}
                                  sx={{ mt: 2, bgcolor: '#e3f2fd', '& .MuiAlert-message': { fontSize: '0.85rem' } }}
                                >
                                  <Typography variant="subtitle2" fontWeight="bold" mb={0.5}>
                                    AI Pattern Analysis
                                  </Typography>
                                  {explanations[idx]}
                                </Alert>
                              </Fade>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Stack>
                )}

                {/* Comparison Matrix */}
                {!isLoading && comparisonResults && (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#fafafa' }}>
                          <TableCell sx={{ fontWeight: 'bold' }}>Case ID</TableCell>
                          {comparisonResults[0]?.comparisons?.map((c, i) => (
                            <TableCell key={i} align="center" sx={{ fontWeight: 'bold' }}>
                              {c.case_id}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {comparisonResults.map((row, i) => (
                          <TableRow key={i} hover>
                            <TableCell sx={{ fontWeight: 'bold' }}>{row.case_id}</TableCell>
                            {row.comparisons?.map((cell, j) => {
                              const score = Math.round(cell.similarity * 100);
                              let color = 'default';
                              if (score > 85) color = 'success';
                              else if (score > 70) color = 'primary';
                              else if (score > 50) color = 'warning';
                              
                              return (
                                <TableCell key={j} align="center">
                                  <Chip 
                                    label={`${score}%`} 
                                    color={color} 
                                    size="small" 
                                    sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                
                {/* Initial State */}
                {!isLoading && !searchResults && (
                  <Box sx={{ textAlign: 'center', py: 12 }}>
                    <SearchIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2, opacity: 0.5 }} />
                    <Typography variant="body1" fontWeight="600" color="text.secondary" mb={1}>
                      Ready to Search
                    </Typography>
                    <Typography variant="body2" color="text.disabled" mb={3}>
                      Select a case or enter a hypothesis to discover patterns.
                    </Typography>
                    <Button
                      variant="outlined"
                      onClick={() => setShowHowTo(true)}
                      startIcon={<BookIcon />}
                    >
                      View Guide
                    </Button>
                  </Box>
                )}
              </Box>
            </Paper>
          </Box>

        </Box>
      </Box>

      {/* How-To Guide Dialog */}
      <Dialog 
        open={showHowTo} 
        onClose={() => setShowHowTo(false)} 
        maxWidth="md" 
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', gap: 1 }}>
          <BookIcon /> How to Use Vector Search
          <Box sx={{ flexGrow: 1 }} />
          <IconButton onClick={() => setShowHowTo(false)} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Master semantic pattern discovery with AI embeddings and vector similarity search.
            </Typography>
            
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                1. Case Match Mode
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Select a target case to find similar cases based on semantic patterns and content similarity.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                2. Hypothesis Mode
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Describe patterns in natural language to discover cases matching your hypothesis.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                3. Batch Comparison
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enable batch mode to compare multiple cases simultaneously and generate a similarity matrix.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                4. Understanding Results
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Similarity scores above 85% indicate high matches. Use "Explain Match" to understand the AI's reasoning.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHowTo(false)} variant="contained">
            Got It
          </Button>
        </DialogActions>
      </Dialog>

    </PageContainer>
  );
};

export default VectorSearchScreen;