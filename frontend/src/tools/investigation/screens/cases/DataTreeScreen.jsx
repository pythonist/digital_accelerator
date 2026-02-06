import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Paper, Button, Stack, TextField, InputAdornment, Chip, Alert, Typography, Autocomplete } from '@mui/material';
import { Search as SearchIcon, Hub as NetworkIcon, Refresh as RefreshIcon, Info as InfoIcon, HelpOutline } from '@mui/icons-material';

import apiClient from "@services/api";

// ✅ Layout Components
import PageContainer from "@investigation-layout/PageContainer";
// ✅ Manual Component
import EvidenceLineageManual from "@investigation/components/guide/EvidenceLineageManual";

import EvidenceSummaryPanel from './components/EvidenceSummaryPanel';
import EvidenceTreeView from './components/EvidenceTreeView';
import EvidenceDetailsPanel from './components/EvidenceDetailsPanel';
import { calculateEvidenceMetrics } from './utils/evidenceCalculations';

const DataTreeScreen = () => {
  const [searchId, setSearchId] = useState('');
  const [caseOptions, setCaseOptions] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [treeData, setTreeData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reviewedNodes, setReviewedNodes] = useState(new Set());
  const [flaggedNodes, setFlaggedNodes] = useState(new Set());
  
  // ✅ State for Manual
  const [showManual, setShowManual] = useState(false);

  const loadCases = useCallback(async () => {
    setLoadingCases(true);
    try {
      const scope = await apiClient.getCaseScope();
      const ids = scope?.scope?.case_ids || [];
      if (Array.isArray(ids) && ids.length) {
        setCaseOptions(ids.map((id) => ({ case_id: String(id) })));
        return;
      }
    } catch {
    }

    try {
      const ranked = await apiClient.getRankedCases();
      const xs = ranked?.cases || [];
      if (Array.isArray(xs) && xs.length) {
        setCaseOptions(xs.map((c) => ({ case_id: String(c.case_id), risk_score: c.risk_score, risk_level: c.risk_level })));
        return;
      }
    } catch {
    }

    try {
      const raw = await apiClient.get('/api/v2/case-list');
      if (Array.isArray(raw) && raw.length) {
        setCaseOptions(raw.map((c) => ({ case_id: String(c.case_id ?? c.caseId ?? c.id ?? '') })).filter((c) => c.case_id));
        return;
      }
    } catch {
    }
    setCaseOptions([]);
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const handleSearch = useCallback(async (e) => {
    e?.preventDefault();
    if (!searchId) return;
    
    setLoading(true); 
    setError(null); 
    setTreeData(null); 
    setSelectedNode(null);
    setReviewedNodes(new Set());
    setFlaggedNodes(new Set());
    
    try {
      const res = await apiClient.post('/api/v2/explorer/tree-data', { id: searchId });
      
      if (res && res.id) {
        setTreeData(res);
      } else if (res.error) {
        throw new Error(res.error);
      } else {
        throw new Error("No data found for this ID");
      }
    } catch (err) { 
      setError(err.message || "Failed to load data structure"); 
    } 
    finally { setLoading(false); }
  }, [searchId]);

  const handleNodeSelect = useCallback((node) => {
    setSelectedNode(node);
    if (node.metadata?.is_evidence) {
      setReviewedNodes(prev => new Set([...prev, node.id]));
    }
  }, []);

  const toggleFlag = useCallback((nodeId) => {
    setFlaggedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const evidenceMetrics = calculateEvidenceMetrics(treeData, reviewedNodes);

  const selectedCase = useMemo(() => {
    const id = String(searchId || '');
    if (!id) return null;
    return caseOptions.find((c) => String(c.case_id) === id) || null;
  }, [caseOptions, searchId]);

  return (
    <PageContainer
      title="Evidence Lineage Explorer"
      subtitle="Verify system computations and trace data provenance"
      breadcrumbs={['Investigation', 'Evidence Lineage']}
      actions={
        <Stack direction="row" spacing={1.5}>
          
          {/* ✅ VISIBLE GUIDE BUTTON */}
          <Button 
            variant="outlined" 
            color="secondary"
            startIcon={<HelpOutline />} 
            onClick={() => setShowManual(true)}
            size="small"
            sx={{ fontWeight: 600 }}
          >
            User Guide
          </Button>

          {treeData && (
            <Chip 
              label={`Case: ${searchId}`}
              size="small"
              onDelete={() => {
                setTreeData(null);
                setSelectedNode(null);
                setSearchId('');
              }}
              sx={{ fontWeight: 'bold', fontFamily: 'monospace', bgcolor: '#f5f5f5', height: 28 }}
            />
          )}
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<RefreshIcon />}
            onClick={() => treeData && handleSearch()}
            disabled={!treeData || loading}
          >
            Refresh
          </Button>
          <Button 
            variant="contained" 
            size="small" 
            disableElevation 
            color="primary" 
            startIcon={loading ? null : <NetworkIcon />}
            onClick={handleSearch}
            disabled={!searchId || loading}
            sx={{ fontWeight: '600' }}
          >
            {loading ? 'Tracing...' : 'Trace Evidence'}
          </Button>
        </Stack>
      }
    >
      {/* ✅ Manual Dialog */}
      <EvidenceLineageManual open={showManual} onClose={() => setShowManual(false)} />

      {/* Main Content Area */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          
        {/* PURPOSE BANNER */}
        <Alert 
          severity="info" 
          icon={<InfoIcon fontSize="inherit" />}
          sx={{ border: '1px solid', borderColor: 'info.main' }}
        >
          <strong>Verification Tool:</strong> This shows how the system computed metrics and what data sources were used. 
          It does NOT recommend actions or case dispositions.
        </Alert>

        {/* SEARCH BAR */}
        <Paper elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fafafa' }}>
          <Autocomplete
            fullWidth
            size="small"
            options={caseOptions}
            value={selectedCase}
            inputValue={searchId}
            onInputChange={(_, v) => setSearchId(v)}
            onChange={(_, v) => setSearchId(v?.case_id || '')}
            loading={loadingCases}
            getOptionLabel={(o) => (typeof o === 'string' ? o : String(o?.case_id || ''))}
            isOptionEqualToValue={(o, v) => String(o?.case_id || '') === String(v?.case_id || '')}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={loadingCases ? 'Loading cases…' : 'Select a case…'}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: 'white',
                    '& input': { fontSize: '0.875rem' },
                  },
                }}
              />
            )}
          />
        </Paper>

        {/* Error Alert */}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* EVIDENCE SUMMARY */}
        {evidenceMetrics && (
          <EvidenceSummaryPanel metrics={evidenceMetrics} />
        )}

        {/* MAIN WORKSPACE - Grid */}
        <Box sx={{ 
          display: 'grid',
          gridTemplateColumns: selectedNode ? { xs: '1fr', lg: '2fr 1fr' } : '1fr',
          gap: 2,
          alignItems: 'start'
        }}>
          
          {/* TREE VIEW */}
          <EvidenceTreeView 
            treeData={treeData}
            onNodeSelect={handleNodeSelect}
            selectedNodeId={selectedNode?.id}
            reviewedNodes={reviewedNodes}
            flaggedNodes={flaggedNodes}
          />

          {/* DETAILS PANEL */}
          {selectedNode && (
            <EvidenceDetailsPanel 
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              isFlagged={flaggedNodes.has(selectedNode.id)}
              onToggleFlag={() => toggleFlag(selectedNode.id)}
            />
          )}
        </Box>
      </Box>
    </PageContainer>
  );
};

export default DataTreeScreen;
