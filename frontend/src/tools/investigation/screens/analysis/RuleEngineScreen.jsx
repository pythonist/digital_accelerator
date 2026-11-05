import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import RuleEditor from './RuleEditor';
import RuleEngineManual from '@investigation/components/guide/RuleEngineManual';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  Rule as RuleIcon,
  Layers as LayersIcon,
  Shield as ShieldIcon,
  Settings as SettingsIcon,
  GpsFixed as TargetIcon,
  Timeline as ActivityIcon,
  CheckCircleOutline as CheckCircleIcon,
  ErrorOutline as ErrorIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  BarChart as BarChartIcon,
  Bolt as ZapIcon,
  HelpOutline,
  InfoOutlined as InfoIcon,
  Close as CloseIcon,
  FilterList as FilterListIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';

const formatAmount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '-';
  return `₹${numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const getSeverityBadgeStyle = (severity) => {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') {
    return { bgcolor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontWeight: 700 };
  }
  if (s === 'high') {
    return { bgcolor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', fontWeight: 700 };
  }
  if (s === 'medium') {
    return { bgcolor: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', fontWeight: 600 };
  }
  return { bgcolor: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', fontWeight: 600 };
};

const formatLogicExpression = (rule) => {
  if (!rule.conditions || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    return rule.description || 'Heuristic Evaluation Pattern';
  }
  const opWord = ` ${rule.logic || 'AND'} `;
  return rule.conditions
    .map((c) => {
      const field = c.field || 'field';
      const op = c.operator || '=';
      const val =
        typeof c.value === 'number'
          ? c.value >= 1000
            ? `₹${c.value.toLocaleString('en-IN')}`
            : c.value
          : `'${c.value}'`;
      return `${field} ${op} ${val}`;
    })
    .join(opWord);
};

const RuleEngineScreen = () => {
  const { caseList, loadCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisResults, setAnalysisResults] = useState(null);
  const [ruleCatalog, setRuleCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const [showRuleManager, setShowRuleManager] = useState(false);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
  const [showManual, setShowManual] = useState(false);

  // Table Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'triggered', 'passed'
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all', 'critical', 'high', 'medium', 'low'

  useEffect(() => {
    if (caseList.length === 0) {
      loadCaseList();
    }
  }, [caseList.length, loadCaseList]);

  useEffect(() => {
    loadRuleCatalog();
  }, []);

  useEffect(() => {
    if (autoSelectEnabled && caseList.length > 0 && !selectedCaseId) {
      const priorityCase = [...caseList].sort((a, b) => {
        const severityWeight = { Critical: 4, High: 3, Medium: 2, Low: 1 };
        const aSeverity = severityWeight[a.severity || a.Severity || a.risk_rating || a.priority] || 0;
        const bSeverity = severityWeight[b.severity || b.Severity || b.risk_rating || b.priority] || 0;
        if (bSeverity !== aSeverity) return bSeverity - aSeverity;
        const aAlerts = a.alert_count || a.Alert_Count || (a.alerts ? a.alerts.length : 0) || 0;
        const bAlerts = b.alert_count || b.Alert_Count || (b.alerts ? b.alerts.length : 0) || 0;
        return bAlerts - aAlerts;
      })[0];
      const id = priorityCase?.case_id || priorityCase?.Case_ID || priorityCase?.id || priorityCase?.ID;
      if (id) {
        const normalizedId = String(id);
        setSelectedCaseId(normalizedId);
        setTimeout(() => runAnalysis(normalizedId), 300);
      }
    }
  }, [autoSelectEnabled, caseList, selectedCaseId]);

  const loadRuleCatalog = async () => {
    setRulesLoading(true);
    try {
      const response = await apiClient.get('/api/v2/rules');
      setRuleCatalog(Array.isArray(response?.rules) ? response.rules : []);
    } catch (catalogError) {
      console.error('Failed to load rule catalog', catalogError);
      setRuleCatalog([]);
    } finally {
      setRulesLoading(false);
    }
  };

  const runAnalysis = async (caseId = selectedCaseId) => {
    if (!caseId) return;
    setLoading(true);
    setAnalysisResults(null);
    setError(null);
    try {
      const response = await apiClient.post('/api/v2/risk-intelligence/analyze', { case_id: caseId });
      if (response?.error || response?.status === 'no_data') {
        setError(response?.message || response?.error || 'No data found for this case');
        return;
      }
      setAnalysisResults(response);
      // Automatically expand first triggered violation if any
      const violations = response?.violations || [];
      if (violations.length > 0) {
        setExpandedRows({ [violations[0].id]: true });
      } else {
        setExpandedRows({});
      }
    } catch (analysisError) {
      console.error(analysisError);
      setError('Failed to connect to the risk analysis engine. Please verify backend service.');
    } finally {
      setLoading(false);
    }
  };

  const toggleRowExpand = (id) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCase = useMemo(
    () => caseList.find((item) => String(item.case_id || item.Case_ID || item.id || item.ID || '') === String(selectedCaseId)),
    [caseList, selectedCaseId],
  );

  const selectedCaseSeverity = useMemo(() => {
    if (!selectedCase) return 'Low';
    return selectedCase.severity || selectedCase.Severity || selectedCase.risk_rating || selectedCase.priority || 'Low';
  }, [selectedCase]);

  // Build Unified Rules Matrix (combines configured rules + triggered typology violations)
  const unifiedRulesMatrix = useMemo(() => {
    const violations = Array.isArray(analysisResults?.violations) ? analysisResults.violations : [];
    const violationMap = new Map(violations.map((v) => [String(v.id || '').trim(), v]));

    // 1. Map all enabled catalog rules
    const catalogRows = (ruleCatalog || [])
      .filter((r) => r.enabled !== false)
      .map((rule) => {
        const ruleId = String(rule.id || '').trim();
        const violation = violationMap.get(ruleId);
        const isTriggered = Boolean(violation);

        return {
          id: ruleId,
          name: rule.name || ruleId,
          description: rule.description || '',
          category: rule.category || 'Rule',
          logic: rule.logic || 'AND',
          conditions: rule.conditions || [],
          configuredSeverity: rule.severity || 'Medium',
          isTypology: false,
          outcome: isTriggered ? 'TRIGGERED' : 'PASSED',
          matchCount: violation?.match_count || 0,
          triggeredValue: violation?.total_value || 0,
          examples: violation?.examples || [],
          explanation: violation?.explanation || null,
        };
      });

    // 2. Add any standalone typology violations that are not in the rule catalog
    const catalogIdSet = new Set(catalogRows.map((r) => r.id));
    const standaloneTypologies = violations
      .filter((v) => !catalogIdSet.has(String(v.id || '').trim()))
      .map((v) => ({
        id: v.id,
        name: v.name || v.id,
        description: v.description || '',
        category: v.category || 'Typology',
        logic: 'HEURISTIC',
        conditions: [],
        configuredSeverity: v.severity || 'High',
        isTypology: true,
        outcome: 'TRIGGERED',
        matchCount: v.match_count || 0,
        triggeredValue: v.total_value || 0,
        examples: v.examples || [],
        explanation: v.explanation || null,
      }));

    return [...catalogRows, ...standaloneTypologies];
  }, [ruleCatalog, analysisResults]);

  // Filtered Rows for Table Display
  const filteredRows = useMemo(() => {
    return unifiedRulesMatrix.filter((row) => {
      // 1. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = row.name.toLowerCase().includes(q);
        const matchesId = row.id.toLowerCase().includes(q);
        const matchesDesc = row.description.toLowerCase().includes(q);
        const matchesCat = row.category.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesDesc && !matchesCat) return false;
      }

      // 2. Status Outcome Filter
      if (statusFilter === 'triggered' && row.outcome !== 'TRIGGERED') return false;
      if (statusFilter === 'passed' && row.outcome !== 'PASSED') return false;

      // 3. Severity Filter
      if (severityFilter !== 'all' && String(row.configuredSeverity).toLowerCase() !== severityFilter) {
        return false;
      }

      return true;
    });
  }, [unifiedRulesMatrix, searchQuery, statusFilter, severityFilter]);

  const triggeredCount = useMemo(() => unifiedRulesMatrix.filter((r) => r.outcome === 'TRIGGERED').length, [unifiedRulesMatrix]);
  const passedCount = useMemo(() => unifiedRulesMatrix.filter((r) => r.outcome === 'PASSED').length, [unifiedRulesMatrix]);

  return (
    <PageContainer
      title="Risk Intelligence Hub"
      subtitle="Deterministic rule evaluation and transaction-level pattern verification"
      breadcrumbs={['Analysis', 'Risk Hub']}
      actions={(
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="text"
            startIcon={<HelpOutline />}
            onClick={() => setShowManual(true)}
            size="small"
            sx={{ color: 'text.secondary', fontWeight: 700, borderRadius: 1 }}
          >
            Rule Guide
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setAutoSelectEnabled((prev) => !prev)}
            startIcon={<ZapIcon />}
            color={autoSelectEnabled ? 'primary' : 'inherit'}
            sx={{ fontWeight: 700, borderRadius: 1 }}
          >
            Smart Select: {autoSelectEnabled ? 'ON' : 'OFF'}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => setShowRuleManager(true)}
            startIcon={<SettingsIcon />}
            sx={{ fontWeight: 700, borderRadius: 1 }}
          >
            Manage Rules
          </Button>
        </Stack>
      )}
    >
      <RuleEngineManual open={showManual} onClose={() => setShowManual(false)} />

      <Box sx={{ display: 'flex', gap: 2.5, height: 'calc(100vh - 190px)', minHeight: 580 }}>
        {/* ========================================================================= */}
        {/* LEFT COLUMN: CASE SELECTION & CONTEXT TELEMETRY                           */}
        {/* ========================================================================= */}
        <Stack spacing={2} sx={{ width: 310, flexShrink: 0, overflowY: 'auto' }}>
          {/* Case Selector Card */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: 1.5,
              bgcolor: '#ffffff',
              borderColor: '#e2e8f0',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Active Investigation Case
              </Typography>
              {autoSelectEnabled && (
                <Chip label="AUTO" size="small" sx={{ height: 18, fontSize: 10, bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} />
              )}
            </Box>

            <FormControl fullWidth size="small" sx={{ mb: 1.75 }}>
              <Select
                value={selectedCaseId}
                onChange={(e) => {
                  setSelectedCaseId(e.target.value);
                  runAnalysis(e.target.value);
                }}
                displayEmpty
                sx={{ borderRadius: 1, fontSize: 13, bgcolor: '#f8fafc' }}
              >
                <MenuItem value="" disabled>Choose case</MenuItem>
                {caseList.map((item, index) => {
                  const id = item.case_id || item.Case_ID || item.id || item.ID || `CASE-${index}`;
                  const alerts = item.alert_count || item.Alert_Count || (item.alerts ? item.alerts.length : 0) || 0;
                  const severity = item.severity || item.Severity || item.risk_rating || item.priority || 'Low';
                  return (
                    <MenuItem key={`${id}-${index}`} value={String(id)}>
                      <Typography variant="body2" sx={{ fontSize: 13 }} noWrap>
                        {id} • {severity} ({alerts} alerts)
                      </Typography>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            <Button
              fullWidth
              variant="contained"
              size="medium"
              onClick={() => runAnalysis()}
              disabled={loading || !selectedCaseId}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon sx={{ fontSize: 18 }} />}
              sx={{
                fontWeight: 700,
                borderRadius: 1,
                textTransform: 'none',
                boxShadow: 'none',
                bgcolor: '#0f172a',
                '&:hover': { bgcolor: '#1e293b' },
              }}
            >
              {loading ? 'Evaluating Rules...' : 'Run Evaluation'}
            </Button>
          </Paper>

          {/* Case Telemetry Summary */}
          {analysisResults && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 1.5,
                bgcolor: '#ffffff',
                borderColor: '#e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5 }}>
                Evaluation Telemetry
              </Typography>

              <Stack spacing={1.25}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Transactions Scanned</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    {analysisResults.row_count || 0} txns
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Rules Evaluated</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    {unifiedRulesMatrix.length} controls
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Triggered Exceptions</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: triggeredCount > 0 ? '#dc2626' : '#16a34a' }}>
                    {triggeredCount} {triggeredCount === 1 ? 'rule' : 'rules'}
                  </Typography>
                </Box>
                <Divider sx={{ borderColor: '#f1f5f9' }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 12, color: '#64748b' }}>Case Baseline Risk</Typography>
                  <Chip
                    label={selectedCaseSeverity}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: 11,
                      ...getSeverityBadgeStyle(selectedCaseSeverity),
                    }}
                  />
                </Box>
              </Stack>
            </Paper>
          )}

          {/* Regulatory Context Note */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: 1.5,
              bgcolor: '#f8fafc',
              borderColor: '#e2e8f0',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <InfoIcon sx={{ fontSize: 16, color: '#475569' }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Evaluation Standard
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.6 }}>
              Rules are evaluated deterministically against all transactions linked to {selectedCaseId || 'the selected case'}.
              Configured severities define control criticality, while the outcome confirms case compliance.
            </Typography>
          </Paper>
        </Stack>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: PROFESSIONAL AUDIT-READY MATRIX TABLE                       */}
        {/* ========================================================================= */}
        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 1.5,
            bgcolor: '#ffffff',
            borderColor: '#e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* Table Header & Controls Bar */}
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: '1px solid #e2e8f0',
              bgcolor: '#f8fafc',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            {/* Left: Search & Filter Tabs */}
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                placeholder="Search rule or condition..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 16, color: '#94a3b8' }} />
                    </InputAdornment>
                  ),
                  sx: {
                    height: 32,
                    fontSize: 12.5,
                    bgcolor: '#ffffff',
                    width: 220,
                    borderRadius: 1,
                  },
                }}
              />

              {/* Status Outcome Filter Chips */}
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip
                  label={`All Rules (${unifiedRulesMatrix.length})`}
                  size="small"
                  onClick={() => setStatusFilter('all')}
                  sx={{
                    height: 26,
                    fontSize: 11.5,
                    fontWeight: statusFilter === 'all' ? 700 : 500,
                    bgcolor: statusFilter === 'all' ? '#0f172a' : '#ffffff',
                    color: statusFilter === 'all' ? '#ffffff' : '#475569',
                    border: '1px solid #cbd5e1',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: statusFilter === 'all' ? '#1e293b' : '#f1f5f9' },
                  }}
                />
                <Chip
                  label={`Triggered (${triggeredCount})`}
                  size="small"
                  onClick={() => setStatusFilter('triggered')}
                  sx={{
                    height: 26,
                    fontSize: 11.5,
                    fontWeight: statusFilter === 'triggered' ? 700 : 500,
                    bgcolor: statusFilter === 'triggered' ? '#dc2626' : '#ffffff',
                    color: statusFilter === 'triggered' ? '#ffffff' : triggeredCount > 0 ? '#dc2626' : '#64748b',
                    border: '1px solid',
                    borderColor: statusFilter === 'triggered' ? '#dc2626' : triggeredCount > 0 ? '#fca5a5' : '#cbd5e1',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: statusFilter === 'triggered' ? '#b91c1c' : '#fef2f2' },
                  }}
                />
                <Chip
                  label={`Passed / Clean (${passedCount})`}
                  size="small"
                  onClick={() => setStatusFilter('passed')}
                  sx={{
                    height: 26,
                    fontSize: 11.5,
                    fontWeight: statusFilter === 'passed' ? 700 : 500,
                    bgcolor: statusFilter === 'passed' ? '#16a34a' : '#ffffff',
                    color: statusFilter === 'passed' ? '#ffffff' : '#16a34a',
                    border: '1px solid',
                    borderColor: statusFilter === 'passed' ? '#16a34a' : '#86efac',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: statusFilter === 'passed' ? '#15803d' : '#f0fdf4' },
                  }}
                />
              </Stack>
            </Stack>

            {/* Right: Severity Filter */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>Severity:</Typography>
              <Select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                size="small"
                sx={{
                  height: 28,
                  fontSize: 12,
                  bgcolor: '#ffffff',
                  borderRadius: 1,
                  minWidth: 120,
                }}
              >
                <MenuItem value="all">All Severities</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </Stack>
          </Box>

          {/* Table Content Area */}
          <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: '#ffffff' }}>
            {loading ? (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6 }}>
                <CircularProgress size={32} sx={{ color: '#0f172a', mb: 2 }} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  Evaluating Rules & Typologies...
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#64748b', mt: 0.5 }}>
                  Cross-referencing {selectedCaseId} ledger records with configured AML detection criteria.
                </Typography>
              </Box>
            ) : error ? (
              <Box sx={{ p: 3 }}>
                <Alert severity="error" variant="outlined" sx={{ borderRadius: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Analysis Error</Typography>
                  <Typography sx={{ fontSize: 12.5 }}>{error}</Typography>
                </Alert>
              </Box>
            ) : filteredRows.length === 0 ? (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6 }}>
                <ShieldIcon sx={{ fontSize: 40, color: '#cbd5e1', mb: 1.5 }} />
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>
                  No matching rules found
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#64748b', mt: 0.5 }}>
                  Adjust your search keyword or clear filters to view available evaluation rules.
                </Typography>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: '100%' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { bgcolor: '#f8fafc', color: '#475569', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #e2e8f0', py: 1.2 } }}>
                      <TableCell sx={{ width: 140 }}>Case Outcome</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>Rule & Description</TableCell>
                      <TableCell sx={{ minWidth: 260 }}>Evaluated Logic & Conditions</TableCell>
                      <TableCell sx={{ width: 130 }}>Configured Severity</TableCell>
                      <TableCell sx={{ width: 130, textAlign: 'right' }}>Triggered Value</TableCell>
                      <TableCell sx={{ width: 90, textAlign: 'center' }}>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredRows.map((row) => {
                      const isExpanded = Boolean(expandedRows[row.id]);
                      const isTriggered = row.outcome === 'TRIGGERED';

                      return (
                        <React.Fragment key={row.id}>
                          <TableRow
                            hover
                            onClick={() => toggleRowExpand(row.id)}
                            sx={{
                              cursor: 'pointer',
                              bgcolor: isExpanded ? '#f8fafc' : isTriggered ? '#fffafa' : '#ffffff',
                              '&:hover': { bgcolor: isTriggered ? '#fef2f2' : '#f8fafc' },
                              '& td': { borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9', py: 1.25 },
                            }}
                          >
                            {/* Column 1: Case Outcome */}
                            <TableCell>
                              {isTriggered ? (
                                <Chip
                                  label={`Triggered (${row.matchCount})`}
                                  size="small"
                                  sx={{
                                    height: 22,
                                    fontSize: 11,
                                    bgcolor: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                    fontWeight: 700,
                                  }}
                                />
                              ) : (
                                <Chip
                                  label="Clean (0)"
                                  size="small"
                                  sx={{
                                    height: 22,
                                    fontSize: 11,
                                    bgcolor: '#f8fafc',
                                    color: '#15803d',
                                    border: '1px solid #dcfce7',
                                    fontWeight: 600,
                                  }}
                                />
                              )}
                            </TableCell>

                            {/* Column 2: Rule Name & Description */}
                            <TableCell>
                              <Stack spacing={0.3}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                                    {row.name}
                                  </Typography>
                                  <Chip
                                    label={row.id}
                                    size="small"
                                    sx={{
                                      height: 18,
                                      fontSize: 10,
                                      fontFamily: 'monospace',
                                      bgcolor: '#f1f5f9',
                                      color: '#475569',
                                      borderRadius: 0.5,
                                    }}
                                  />
                                </Stack>
                                <Typography sx={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4 }}>
                                  {row.description || 'Standard transaction surveillance control.'}
                                </Typography>
                              </Stack>
                            </TableCell>

                            {/* Column 3: Evaluated Logic Expression */}
                            <TableCell>
                              <Typography
                                sx={{
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: '#334155',
                                  bgcolor: '#f8fafc',
                                  p: '4px 8px',
                                  borderRadius: 1,
                                  border: '1px solid #e2e8f0',
                                  display: 'inline-block',
                                  maxWidth: 340,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={formatLogicExpression(row)}
                              >
                                {formatLogicExpression(row)}
                              </Typography>
                            </TableCell>

                            {/* Column 4: Configured Rule Severity */}
                            <TableCell>
                              <Chip
                                label={row.configuredSeverity}
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: 11,
                                  ...getSeverityBadgeStyle(row.configuredSeverity),
                                }}
                              />
                            </TableCell>

                            {/* Column 5: Triggered Exposure */}
                            <TableCell sx={{ textAlign: 'right' }}>
                              <Typography sx={{ fontSize: 12.5, fontWeight: isTriggered ? 700 : 500, color: isTriggered ? '#b91c1c' : '#64748b' }}>
                                {formatAmount(row.triggeredValue)}
                              </Typography>
                            </TableCell>

                            {/* Column 6: Expand/Action Button */}
                            <TableCell sx={{ textAlign: 'center' }}>
                              <IconButton size="small" sx={{ p: 0.5, color: '#64748b' }}>
                                {isExpanded ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
                              </IconButton>
                            </TableCell>
                          </TableRow>

                          {/* Expanded Evidence & Logic Drawer Row */}
                          <TableRow>
                            <TableCell colSpan={6} sx={{ p: 0, borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none' }}>
                              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                <Box sx={{ p: 2.5, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                                  <Stack spacing={2}>
                                    {/* Parameter Summary Bar */}
                                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                                      <Box>
                                        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                          Category
                                        </Typography>
                                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                                          {row.category}
                                        </Typography>
                                      </Box>
                                      <Divider orientation="vertical" flexItem sx={{ height: 24, my: 'auto' }} />

                                      <Box>
                                        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                          Evaluation Logic
                                        </Typography>
                                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                                          {row.logic} Operator ({row.conditions?.length || 0} criteria)
                                        </Typography>
                                      </Box>
                                      <Divider orientation="vertical" flexItem sx={{ height: 24, my: 'auto' }} />

                                      <Box>
                                        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                          Case Evaluation Result
                                        </Typography>
                                        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: isTriggered ? '#b91c1c' : '#15803d' }}>
                                          {isTriggered
                                            ? `Triggered: ${row.matchCount} transaction(s) met criteria (${formatAmount(row.triggeredValue)})`
                                            : `Passed: 0 transactions breached the ${formatLogicExpression(row)} threshold.`}
                                        </Typography>
                                      </Box>
                                    </Box>

                                    {/* Explanation Rationale if Triggered */}
                                    {row.explanation && (
                                      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, bgcolor: '#ffffff', borderColor: '#e2e8f0' }}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', mb: 0.5 }}>
                                          Detection Rationale
                                        </Typography>
                                        <Typography sx={{ fontSize: 12.5, color: '#1e293b' }}>
                                          {row.explanation.why_flagged || row.explanation.trigger_logic || 'Trigger criteria substantiated by underlying ledger activity.'}
                                        </Typography>
                                      </Paper>
                                    )}

                                    {/* Evidence Transaction Snapshot (if Triggered) */}
                                    {isTriggered && Array.isArray(row.examples) && row.examples.length > 0 && (
                                      <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden', borderColor: '#e2e8f0' }}>
                                        <Box sx={{ px: 2, py: 1, bgcolor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#334155', textTransform: 'uppercase' }}>
                                            Triggering Evidence Snapshot ({row.examples.length} shown)
                                          </Typography>
                                        </Box>
                                        <Table size="small">
                                          <TableHead>
                                            <TableRow sx={{ '& th': { bgcolor: '#ffffff', fontSize: 11, fontWeight: 700, color: '#64748b' } }}>
                                              <TableCell>Date</TableCell>
                                              <TableCell sx={{ textAlign: 'right' }}>Amount</TableCell>
                                              <TableCell>Type / Flow</TableCell>
                                              <TableCell>Counterparty / Narrative</TableCell>
                                            </TableRow>
                                          </TableHead>
                                          <TableBody>
                                            {row.examples.map((ex, idx) => (
                                              <TableRow key={idx} sx={{ '& td': { fontSize: 12, py: 0.75 } }}>
                                                <TableCell sx={{ fontFamily: 'monospace' }}>
                                                  {ex.date || ex.txn_date || ex.created_at || '-'}
                                                </TableCell>
                                                <TableCell sx={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                                  {formatAmount(ex.amount || ex.txn_amount)}
                                                </TableCell>
                                                <TableCell>{ex.type || ex.dr_cr || ex.direction || '-'}</TableCell>
                                                <TableCell>
                                                  {ex.party || ex.counterparty || ex.channel || ex.narrative || '-'}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </Paper>
                                    )}
                                  </Stack>
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Paper>
      </Box>

      {/* Rule Manager Modal */}
      <RuleEditor
        isOpen={showRuleManager}
        onClose={() => setShowRuleManager(false)}
        onRulesSaved={() => {
          loadRuleCatalog();
          if (analysisResults) {
            runAnalysis();
          }
        }}
      />
    </PageContainer>
  );
};

export default RuleEngineScreen;
