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
  Card,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  Rule as RuleIcon,
  Layers as LayersIcon,
  Security as ShieldIcon,
  Settings as SettingsIcon,
  GpsFixed as TargetIcon,
  Timeline as ActivityIcon,
  CheckCircle as CheckCircleIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ChevronDownIcon,
  BarChart as BarChart3Icon,
  Bolt as ZapIcon,
  HelpOutline,
  Psychology as BrainIcon,
  VerifiedUser as VerifiedIcon,
  Info as InfoIcon,
  Close as XIcon,
} from '@mui/icons-material';

const SURFACE_SX = {
  borderRadius: 0,
  boxShadow: 'none',
};

const getSeverityColor = (severity) => {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'critical') return 'error';
  if (normalized === 'high') return 'warning';
  if (normalized === 'medium') return 'info';
  return 'success';
};

const extractRuleFields = (conditions = []) => {
  if (!Array.isArray(conditions)) return [];
  return Array.from(new Set(conditions.map((item) => String(item?.field || '').trim()).filter(Boolean)));
};

const formatAmount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `INR ${numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const SummaryMetric = ({ label, value, valueColor = '#0f172a', valueSize = 16 }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <Typography sx={{ fontSize: 12.5, color: '#64748b' }}>{label}</Typography>
    <Typography sx={{ fontSize: valueSize, fontWeight: 800, color: valueColor }}>{value}</Typography>
  </Box>
);

const SectionBlock = ({ title, subtitle, icon, children }) => (
  <Box>
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
      {icon}
      <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
    </Stack>
    <Typography sx={{ mb: 1.75, fontSize: 13, color: '#64748b' }}>{subtitle}</Typography>
    {children}
  </Box>
);

const ExplanationModal = ({ open, onClose, item }) => (
  <Box
    sx={{
      position: 'fixed',
      inset: 0,
      zIndex: 1300,
      bgcolor: 'rgba(15, 23, 42, 0.42)',
      display: open ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      p: 4,
      backdropFilter: 'blur(6px)',
    }}
  >
    <Paper sx={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 0 }}>
      <Box sx={{ p: 2, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f8fafc' }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Detection Logic</Typography>
        <IconButton onClick={onClose} sx={{ borderRadius: 0 }}>
          <XIcon />
        </IconButton>
      </Box>
      <Box sx={{ p: 3, overflowY: 'auto' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{item?.name}</Typography>
        <Typography sx={{ mt: 1, fontSize: 14, color: '#475569', lineHeight: 1.8 }}>
          {item?.description || 'No description was returned for this finding.'}
        </Typography>
      </Box>
    </Paper>
  </Box>
);

const RuleEngineScreen = () => {
  const { caseList, loadCaseList } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [analysisResults, setAnalysisResults] = useState(null);
  const [ruleCatalog, setRuleCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});
  const [showRuleManager, setShowRuleManager] = useState(false);
  const [showExplanationFor, setShowExplanationFor] = useState(null);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [showManual, setShowManual] = useState(false);

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
        const aSeverity = severityWeight[a.severity || a.Severity] || 0;
        const bSeverity = severityWeight[b.severity || b.Severity] || 0;
        if (bSeverity !== aSeverity) return bSeverity - aSeverity;
        const aAlerts = a.alert_count || a.Alert_Count || (a.alerts ? a.alerts.length : 0) || 0;
        const bAlerts = b.alert_count || b.Alert_Count || (b.alerts ? b.alerts.length : 0) || 0;
        return bAlerts - aAlerts;
      })[0];
      const id = priorityCase?.case_id || priorityCase?.Case_ID || priorityCase?.id || priorityCase?.ID;
      if (id) {
        const normalizedId = String(id);
        setSelectedCaseId(normalizedId);
        setTimeout(() => runAnalysis(normalizedId), 400);
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
      const firstImportant = (response?.violations || []).find((item) => ['Critical', 'High'].includes(item?.severity));
      setExpandedItems(firstImportant?.id ? { [firstImportant.id]: true } : {});
    } catch (analysisError) {
      console.error(analysisError);
      setError('Failed to connect to the risk analysis engine. Please check the backend connection.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCase = useMemo(
    () => caseList.find((item) => String(item.case_id || item.Case_ID || item.id || item.ID || '') === String(selectedCaseId)),
    [caseList, selectedCaseId],
  );

  const selectionReason = useMemo(() => {
    if (!selectedCase || !autoSelectEnabled) return null;
    const alerts = selectedCase.alert_count || selectedCase.Alert_Count || (selectedCase.alerts ? selectedCase.alerts.length : 0) || 0;
    const severity = selectedCase.severity || selectedCase.Severity || 'Unknown';
    return [
      `Severity level: ${severity}`,
      `${alerts} active alerts pending review`,
      'Automatically prioritized based on risk indicators',
    ];
  }, [autoSelectEnabled, selectedCase]);

  const ruleCatalogById = useMemo(
    () => new Map(ruleCatalog.map((rule) => [String(rule.id || '').trim(), rule])),
    [ruleCatalog],
  );

  const allViolations = useMemo(() => {
    const items = Array.isArray(analysisResults?.violations) ? analysisResults.violations : [];
    if (filterSeverity === 'all') return items;
    return items.filter((item) => String(item?.severity || '').toLowerCase() === filterSeverity);
  }, [analysisResults, filterSeverity]);

  const allViolationIds = useMemo(
    () => new Set((analysisResults?.violations || []).map((item) => String(item?.id || '').trim()).filter(Boolean)),
    [analysisResults],
  );

  const triggeredRules = useMemo(
    () => allViolations.filter((item) => !String(item?.id || '').startsWith('TYPO_')),
    [allViolations],
  );

  const triggeredTypologies = useMemo(
    () => allViolations.filter((item) => String(item?.id || '').startsWith('TYPO_')),
    [allViolations],
  );

  const cleanRules = useMemo(
    () => ruleCatalog
      .filter((rule) => rule?.enabled !== false)
      .filter((rule) => !allViolationIds.has(String(rule?.id || '').trim()))
      .filter((rule) => filterSeverity === 'all' || String(rule?.severity || '').toLowerCase() === filterSeverity),
    [allViolationIds, filterSeverity, ruleCatalog],
  );

  const riskScoreColor = useMemo(() => {
    const score = Number(analysisResults?.risk_score || 0);
    if (score >= 75) return 'error.main';
    if (score >= 50) return 'warning.main';
    if (score >= 25) return 'info.main';
    return 'success.main';
  }, [analysisResults?.risk_score]);

  const renderViolationCards = (items) => items.map((violation) => {
    const isExpanded = !!expandedItems[violation.id];
    const isTypology = String(violation?.id || '').startsWith('TYPO_');
    const ruleDefinition = ruleCatalogById.get(String(violation?.id || '').trim()) || null;
    const ruleFields = extractRuleFields(ruleDefinition?.conditions);
    const examples = Array.isArray(violation?.examples) ? violation.examples : [];

    return (
      <Card key={violation.id} variant="outlined" sx={{ borderRadius: 0, boxShadow: 'none' }}>
        <Box
          onClick={() => toggleExpand(violation.id)}
          sx={{ p: 2.25, cursor: 'pointer', bgcolor: isExpanded ? '#fafafa' : '#fff', '&:hover': { bgcolor: '#f8fafc' } }}
        >
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <IconButton size="small" sx={{ mt: 0.25, p: 0.25, borderRadius: 0 }}>
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </IconButton>
            <Box sx={{ mt: 0.4 }}>
              {isTypology ? <LayersIcon sx={{ color: 'secondary.main', fontSize: 20 }} /> : <RuleIcon sx={{ color: 'primary.main', fontSize: 20 }} />}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{violation.name}</Typography>
                <Chip label={violation.severity} size="small" color={getSeverityColor(violation.severity)} sx={{ borderRadius: 0, fontWeight: 700 }} />
                {isTypology ? (
                  <Chip label="Typology" size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />
                ) : (
                  <Chip label="Rule Triggered" size="small" sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#eef2ff', color: '#1d4ed8' }} />
                )}
                {!isTypology && ruleFields.length > 0 && (
                  <Chip label={`Fields: ${ruleFields.join(', ')}`} size="small" sx={{ borderRadius: 0, fontWeight: 600, maxWidth: 420 }} />
                )}
              </Stack>
              <Typography sx={{ fontSize: 13.5, color: '#475569', lineHeight: 1.7 }}>
                {violation.description || 'No description was returned for this finding.'}
              </Typography>
            </Box>
            <Box sx={{ minWidth: 120, textAlign: 'right' }}>
              <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{violation.match_count || 0}</Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: '#64748b' }}>Matches</Typography>
              <Typography sx={{ mt: 0.5, fontSize: 12.5, fontWeight: 700, color: '#1d4ed8' }}>{formatAmount(violation.total_value)}</Typography>
            </Box>
          </Stack>
        </Box>
        <Collapse in={isExpanded}>
          <Divider />
          <Box sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 0, bgcolor: '#f8fafc' }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.45, color: '#475569' }}>Category</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>{violation.category || 'General'}</Typography>
                  {!isTypology && (
                    <>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.45, color: '#475569', ml: 1 }}>Applies to</Typography>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                        {ruleFields.length > 0 ? ruleFields.join(', ') : 'No explicit fields declared'}
                      </Typography>
                    </>
                  )}
                </Stack>
              </Paper>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={isTypology ? 'Behavioral pattern' : 'Configured rule'} size="small" icon={isTypology ? <LayersIcon /> : <ShieldIcon />} sx={{ borderRadius: 0, fontWeight: 700 }} />
                {ruleDefinition?.logic && <Chip label={`Logic ${ruleDefinition.logic}`} size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />}
                {ruleDefinition?.conditions?.length ? (
                  <Chip label={`${ruleDefinition.conditions.length} condition(s)`} size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />
                ) : null}
              </Stack>
              {examples.length > 0 && (
                <Paper variant="outlined" sx={{ borderRadius: 0, overflow: 'hidden' }}>
                  <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>Evidence snapshot</Typography>
                  </Box>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead style={{ background: '#f8fafc' }}>
                        <tr>
                          <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Date</th>
                          <th style={{ padding: '10px', textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>Amount</th>
                          <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Type</th>
                          <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Counterparty / Channel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {examples.map((example, index) => (
                          <tr key={`${violation.id}-evidence-${index}`}>
                            <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>
                              {example.date || example.txn_date || example.created_at || '-'}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>
                              {formatAmount(example.amount || example.txn_amount)}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>{example.type || example.dr_cr || '-'}</td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #f1f5f9' }}>
                              {example.party || example.counterparty || example.channel || example.mode || 'Unknown'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </Paper>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={<InfoIcon />}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowExplanationFor({ ...violation, ruleDefinition, ruleFields });
                }}
                sx={{ alignSelf: 'flex-start', borderRadius: 0, fontWeight: 700 }}
              >
                Show Detection Logic
              </Button>
            </Stack>
          </Box>
        </Collapse>
      </Card>
    );
  });

  return (
    <PageContainer
      title="Risk Intelligence Hub"
      subtitle="Unified rules and typology analysis"
      breadcrumbs={['Analysis', 'Risk Hub']}
      actions={(
        <Stack direction="row" spacing={1.5}>
          <Button variant="text" startIcon={<HelpOutline />} onClick={() => setShowManual(true)} size="small" sx={{ color: 'text.secondary', fontWeight: 700, borderRadius: 0 }}>
            Rule Guide
          </Button>
          <Button variant="outlined" size="small" onClick={() => setAutoSelectEnabled((prev) => !prev)} startIcon={<ZapIcon />} color={autoSelectEnabled ? 'primary' : 'inherit'} sx={{ fontWeight: 700, borderRadius: 0 }}>
            Smart Select
          </Button>
          <Button variant="contained" size="small" onClick={() => setShowRuleManager(true)} startIcon={<SettingsIcon />} sx={{ fontWeight: 700, borderRadius: 0 }}>
            Manage Rules
          </Button>
        </Stack>
      )}
    >
      <RuleEngineManual open={showManual} onClose={() => setShowManual(false)} />
      <Box sx={{ display: 'flex', gap: 3, height: 'calc(100vh - 220px)', minHeight: 540 }}>
        <Stack spacing={3} sx={{ width: 320, flexShrink: 0, overflowY: 'auto', pr: 0.5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, ...SURFACE_SX }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.55 }}>
                Case Selection
              </Typography>
              {autoSelectEnabled && <Chip label="AUTO" size="small" color="primary" sx={{ borderRadius: 0, fontWeight: 700 }} />}
            </Box>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <Select value={selectedCaseId} onChange={(e) => setSelectedCaseId(e.target.value)} displayEmpty sx={{ borderRadius: 0 }}>
                <MenuItem value="" disabled>Choose case</MenuItem>
                {caseList.map((item, index) => {
                  const id = item.case_id || item.Case_ID || item.id || item.ID || `UNKNOWN-${index}`;
                  const alerts = item.alert_count || item.Alert_Count || (item.alerts ? item.alerts.length : 0) || 0;
                  const severity = item.severity || item.Severity || 'Unknown';
                  return (
                    <MenuItem key={`${id}-${index}`} value={String(id)}>
                      <Typography variant="body2" noWrap>{id} | {severity} | {alerts} alerts</Typography>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            <Button fullWidth variant="contained" size="large" onClick={() => runAnalysis()} disabled={loading || !selectedCaseId} startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />} sx={{ fontWeight: 800, borderRadius: 0 }}>
              {loading ? 'Running Analysis...' : 'Run Analysis'}
            </Button>
          </Paper>
          {selectionReason && (
            <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#eef2ff', borderColor: '#c7d2fe', ...SURFACE_SX }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <TargetIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'primary.dark' }}>Why This Case?</Typography>
              </Box>
              <Stack spacing={1}>
                {selectionReason.map((factor) => (
                  <Box key={factor} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <ChevronRightIcon sx={{ fontSize: 16, color: 'primary.main', mt: 0.2 }} />
                    <Typography sx={{ fontSize: 12.5, color: 'primary.dark' }}>{factor}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
          {analysisResults && (
            <Paper variant="outlined" sx={{ p: 2.5, ...SURFACE_SX }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <BarChart3Icon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Analysis Summary</Typography>
              </Box>
              <Stack spacing={1.75}>
                <SummaryMetric label="Transactions scanned" value={analysisResults.row_count || 0} />
                <Divider />
                <SummaryMetric label="Triggered findings" value={analysisResults.violations?.length || 0} valueColor="#b91c1c" />
                <Divider />
                <SummaryMetric label="Risk score" value={analysisResults.risk_score || 0} valueColor={riskScoreColor} valueSize={30} />
                <Divider />
                <SummaryMetric label="Rules tested" value={analysisResults.analysis_summary?.rules_tested || 0} />
              </Stack>
              {(analysisResults.missing_columns || []).length > 0 && (
                <Alert severity="warning" sx={{ mt: 2, borderRadius: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>Missing data fields</Typography>
                  <Typography sx={{ fontSize: 12.5 }}>{(analysisResults.missing_columns || []).join(', ')}</Typography>
                </Alert>
              )}
            </Paper>
          )}
        </Stack>
        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...SURFACE_SX }}>
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <ShieldIcon sx={{ color: 'primary.main' }} />
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Detection Results</Typography>
            </Box>
            <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <Select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} sx={{ bgcolor: '#fff', borderRadius: 0, fontSize: 13 }}>
                  <MenuItem value="all">All severities</MenuItem>
                  <MenuItem value="critical">Critical only</MenuItem>
                  <MenuItem value="high">High only</MenuItem>
                  <MenuItem value="medium">Medium only</MenuItem>
                  <MenuItem value="low">Low only</MenuItem>
                </Select>
              </FormControl>
              <Chip label={`Triggered rules ${triggeredRules.length}`} size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />
              <Chip label={`Typologies ${triggeredTypologies.length}`} size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />
              <Chip label={`Clean rules ${cleanRules.length}`} size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />
              {rulesLoading && <Chip label="Refreshing rule coverage" size="small" sx={{ borderRadius: 0, fontWeight: 700 }} />}
            </Stack>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 3, bgcolor: '#fff' }}>
            {loading && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                <ActivityIcon sx={{ fontSize: 48, mb: 2, color: 'primary.main' }} />
                <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Running comprehensive analysis...</Typography>
                <Typography sx={{ fontSize: 13, color: '#64748b' }}>Scanning configured rules, typologies, and evidence snapshots.</Typography>
              </Box>
            )}
            {error && !loading && (
              <Alert severity="error" variant="outlined" sx={{ mb: 2, borderRadius: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 800 }}>Analysis failed</Typography>
                <Typography sx={{ fontSize: 13.5 }}>{error}</Typography>
              </Alert>
            )}
            {!loading && !analysisResults && !error && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.disabled', border: '2px dashed #e2e8f0', borderRadius: 0 }}>
                <BrainIcon sx={{ fontSize: 60, mb: 2, opacity: 0.22 }} />
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#334155' }}>Ready to analyze</Typography>
                <Typography sx={{ fontSize: 13.5, color: '#64748b' }}>Select a case and run analysis to review triggered rules and clean controls.</Typography>
              </Box>
            )}
            {!loading && analysisResults && allViolations.length === 0 && (
              <Box sx={{ borderRadius: 0, bgcolor: '#f0fdf4', border: '1px solid #bbf7d0', p: 6, textAlign: 'center' }}>
                <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#166534' }}>Clean Profile</Typography>
                <Typography sx={{ fontSize: 15, color: '#166534' }}>No violations detected in {analysisResults.row_count} transactions.</Typography>
              </Box>
            )}
            {!loading && analysisResults && (
              <Stack spacing={3}>
                {triggeredRules.length > 0 && (
                  <SectionBlock title="Triggered Rules" subtitle="Rules that fired on the selected case and need analyst attention." icon={<RuleIcon sx={{ color: '#1d4ed8', fontSize: 18 }} />}>
                    <Stack spacing={2}>{renderViolationCards(triggeredRules)}</Stack>
                  </SectionBlock>
                )}
                {triggeredTypologies.length > 0 && (
                  <SectionBlock title="Triggered Typologies" subtitle="Behavioral patterns that were detected across the case activity." icon={<LayersIcon sx={{ color: '#7c3aed', fontSize: 18 }} />}>
                    <Stack spacing={2}>{renderViolationCards(triggeredTypologies)}</Stack>
                  </SectionBlock>
                )}
                {cleanRules.length > 0 && (
                  <SectionBlock title="Rules Reviewed And Passed" subtitle="Enabled rules that were evaluated and did not trigger for this case." icon={<VerifiedIcon sx={{ color: '#166534', fontSize: 18 }} />}>
                    <Stack spacing={1.5}>
                      {cleanRules.map((rule) => {
                        const fields = extractRuleFields(rule.conditions);
                        return (
                          <Paper key={rule.id} variant="outlined" sx={{ p: 2, borderRadius: 0, bgcolor: '#fbfffc' }}>
                            <Box sx={{ flex: 1 }}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                                <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a' }}>{rule.name || rule.id}</Typography>
                                <Chip label="Clean" size="small" color="success" sx={{ borderRadius: 0, fontWeight: 700 }} />
                                <Chip label={rule.severity || 'Medium'} size="small" color={getSeverityColor(rule.severity)} sx={{ borderRadius: 0, fontWeight: 700 }} />
                              </Stack>
                              <Typography sx={{ fontSize: 13.2, color: '#475569', lineHeight: 1.7 }}>
                                {rule.description || 'No description provided.'}
                              </Typography>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                                {fields.map((field) => (
                                  <Chip key={`${rule.id}-${field}`} label={field} size="small" sx={{ borderRadius: 0, fontWeight: 600 }} />
                                ))}
                                {rule.logic && <Chip label={`Logic ${rule.logic}`} size="small" sx={{ borderRadius: 0, fontWeight: 600 }} />}
                                {Array.isArray(rule.conditions) && <Chip label={`${rule.conditions.length} condition(s)`} size="small" sx={{ borderRadius: 0, fontWeight: 600 }} />}
                              </Stack>
                            </Box>
                          </Paper>
                        );
                      })}
                    </Stack>
                  </SectionBlock>
                )}
              </Stack>
            )}
          </Box>
        </Paper>
      </Box>
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
      {showExplanationFor && (
        <ExplanationModal open={Boolean(showExplanationFor)} onClose={() => setShowExplanationFor(null)} item={showExplanationFor} />
      )}
    </PageContainer>
  );
};

export default RuleEngineScreen;
