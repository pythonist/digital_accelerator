import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";
// ✅ Import Manual Component
import TypologyManual from "@investigation/components/guide/TypologyManual";

// MUI Components
import {
  Box, Paper, Typography, Button, Stack, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, CircularProgress, Chip, Alert, IconButton,
  Divider, Card
} from '@mui/material';

// Icons
import {
  MenuBook as BookIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Assessment as ActivityIcon,
  Warning as AlertTriangleIcon,
  Security as ShieldAlertIcon,
  CheckCircle as CheckCircleIcon,
  Description as FileIcon
} from '@mui/icons-material';

const TypologyAnalysisScreen = () => {
  const { caseList, loadCaseList, priorityBuckets, getFilteredCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisResults, setAnalysisResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // ✅ State for Manual
  const [showManual, setShowManual] = useState(false);
  
  // Priority filter toggle
  const [usePriorityFilter, setUsePriorityFilter] = useState(true);

  // Use filtered case list
  const displayCases = usePriorityFilter && priorityBuckets?.enabled
    ? getFilteredCaseList()
    : caseList || [];

  useEffect(() => {
    loadCaseList();
  }, []);

  useEffect(() => {
    if (displayCases.length > 0 && !selectedCaseId) {
      setSelectedCaseId(displayCases[0].case_id || displayCases[0].id);
    }
  }, [displayCases, selectedCaseId]);

  const runAnalysis = async () => {
    if (!selectedCaseId) return;
    setIsLoading(true);
    setError(null);
    setAnalysisResults(null);
    try {
      const res = await apiClient.post('/api/v2/typology/analyze', { case_id: selectedCaseId });
      if (res.error) throw new Error(res.error);
      setAnalysisResults(res);
    } catch (err) {
      setError(err.message || "Analysis failed");
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    const s = severity?.toLowerCase();
    if (s === 'critical') return 'error';
    if (s === 'high') return 'warning';
    if (s === 'medium') return 'info';
    return 'default';
  };

  return (
    <PageContainer
      title="Typology Detector"
      subtitle="Automated AML pattern recognition"
      breadcrumbs={['Analysis', 'Typology']}
      actions={
        <Button
          variant="outlined"
          startIcon={<BookIcon />}
          onClick={() => setShowManual(true)}
          size="small"
          sx={{ fontWeight: 600 }}
        >
          How it Works
        </Button>
      }
    >
      {/* ✅ Render Manual */}
      <TypologyManual open={showManual} onClose={() => setShowManual(false)} />

      {/* ✅ Main Content Wrapper with Fixed Height for scrolling */}
      <Box sx={{ display: 'flex', gap: 3, p: 3, height: 'calc(100vh - 140px)', overflow: 'hidden' }}>
        
        {/* --- LEFT PANEL: Controls (Scrollable) --- */}
        <Box sx={{ width: 350, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" mb={2} color="text.primary">
              Select Case File
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Case ID</InputLabel>
              <Select
                value={selectedCaseId}
                label="Case ID"
                onChange={(e) => setSelectedCaseId(e.target.value)}
                disabled={displayCases.length === 0}
              >
                {displayCases.map((c, i) => {
                   const cid = c.case_id || c.id || `CASE-${i}`;
                   return (
                    <MenuItem key={cid} value={cid}>
                      {cid} ({c.status || 'New'})
                    </MenuItem>
                   );
                })}
                {displayCases.length === 0 && <MenuItem disabled>No cases available</MenuItem>}
              </Select>
            </FormControl>

            {priorityBuckets?.enabled && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={usePriorityFilter}
                      onChange={(e) => setUsePriorityFilter(e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FilterIcon fontSize="small" /> Filter: {priorityBuckets.activeBucket}
                    </Typography>
                  }
                />
                <Typography variant="caption" display="block" color="text.secondary" ml={3.5}>
                  {displayCases.length} of {caseList?.length || 0} cases
                </Typography>
              </Paper>
            )}

            <Button
              fullWidth
              variant="contained"
              onClick={runAnalysis}
              disabled={isLoading || !selectedCaseId}
              startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
              sx={{ py: 1.2, fontWeight: 'bold' }}
            >
              {isLoading ? 'Running Logic...' : 'Run Analysis'}
            </Button>
          </Paper>

          {/* Results Summary */}
          {analysisResults?.summary && (
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, flex: 1 }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, textTransform: 'uppercase' }}>
                <ActivityIcon fontSize="small" /> Analysis Summary
              </Typography>
              <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
                {analysisResults.summary}
              </Typography>

              {analysisResults.missing_fields?.length > 0 && (
                <Alert severity="warning" sx={{ mt: 2 }} icon={<AlertTriangleIcon fontSize="inherit" />}>
                  <Typography variant="subtitle2" fontWeight="bold">Missing Data</Typography>
                  <Typography variant="caption">
                    Could not find columns: {analysisResults.missing_fields.join(", ")}
                  </Typography>
                </Alert>
              )}
            </Paper>
          )}
        </Box>

        {/* --- RIGHT PANEL: Violations (Scrollable) --- */}
        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight="bold" color="text.primary">Detected Violations</Typography>
            {analysisResults && (
              <Chip label={`${analysisResults.violated_rules?.length || 0} alerts`} size="small" sx={{ fontWeight: 'bold' }} />
            )}
          </Box>

          <Box sx={{ flex: 1, p: 3, overflowY: 'auto', bgcolor: 'white' }}>
            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>Error: {error}</Alert>
            )}

            {!analysisResults && !isLoading && !error && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.disabled', opacity: 0.7 }}>
                <ShieldAlertIcon sx={{ fontSize: 64, mb: 2, color: '#cbd5e1' }} />
                <Typography variant="body1">Ready to analyze. Select a case on the left.</Typography>
                {usePriorityFilter && priorityBuckets?.enabled && (
                  <Typography variant="caption" color="primary">Filtered by: {priorityBuckets.activeBucket}</Typography>
                )}
              </Box>
            )}

            {analysisResults?.violated_rules?.length === 0 && (
              <Box sx={{ textAlign: 'center', p: 4, bgcolor: '#ecfdf5', borderRadius: 2, border: '1px dashed #6ee7b7' }}>
                <CheckCircleIcon sx={{ fontSize: 48, color: '#10b981', mb: 2 }} />
                <Typography variant="h6" color="#065f46" fontWeight="bold">Clean Profile</Typography>
                <Typography variant="body2" color="#047857">No standard AML typologies detected.</Typography>
              </Box>
            )}

            <Stack spacing={2}>
              {analysisResults?.violated_rules?.map((violation, i) => (
                <Paper key={i} variant="outlined" sx={{ overflow: 'hidden' }}>
                  <Box sx={{ 
                    px: 2, py: 1.5, 
                    bgcolor: violation.severity === 'Critical' ? '#fef2f2' : violation.severity === 'High' ? '#fff7ed' : '#f0f9ff',
                    borderBottom: '1px solid',
                    borderColor: violation.severity === 'Critical' ? '#fee2e2' : violation.severity === 'High' ? '#ffedd5' : '#e0f2fe',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
                  }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <ShieldAlertIcon fontSize="small" color={getSeverityColor(violation.severity)} />
                      <Typography variant="subtitle2" fontWeight="bold">{violation.name}</Typography>
                    </Stack>
                    <Chip label={violation.severity} size="small" color={getSeverityColor(violation.severity)} sx={{ fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                  </Box>
                  <Box sx={{ p: 2 }}>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {violation.evidence.map((ev, idx) => (
                        <li key={idx}>
                          <Typography variant="body2" color="text.secondary">{ev}</Typography>
                        </li>
                      ))}
                    </ul>
                  </Box>
                </Paper>
              ))}
            </Stack>
          </Box>
        </Paper>
      </Box>
    </PageContainer>
  );
};

export default TypologyAnalysisScreen;