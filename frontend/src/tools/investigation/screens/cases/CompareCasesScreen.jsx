import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import { formatNumber } from '@investigation/utils/format';
import PageContainer from '@investigation-layout/PageContainer';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  AutoFixHigh as SparklesIcon,
  CompareArrows as CompareIcon,
  GridView as MatrixIcon,
  Groups as EntityIcon,
  PlayArrow as PlayIcon,
  WarningAmber as AlertIcon,
  AttachMoney as MoneyIcon,
  FilterList as FilterIcon,
  Hub as NetworkIcon,
} from '@mui/icons-material';

const MAX_PORTFOLIO_CASES = 6;

const getCaseId = (item) => String(item?.case_id || item?.caseid || item?.id || '');
const asNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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
    low: '#84cc16',
  };
  return colors[String(severity || '').toLowerCase()] || '#64748b';
};

const findStrongestPair = (matrix) => {
  const seen = new Set();
  let best = null;
  (matrix || []).forEach((row) => {
    (row?.comparisons || []).forEach((cell) => {
      const from = String(row?.case_id || '');
      const to = String(cell?.case_id || '');
      if (!from || !to || from === to) return;
      const pairKey = [from, to].sort().join('|');
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      const similarity = asNumber(cell?.similarity, 0);
      if (!best || similarity > best.similarity) {
        best = { caseA: from, caseB: to, similarity };
      }
    });
  });
  return best;
};

const SelectionSummaryCard = ({ title, body, tone = 'default' }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 2,
      borderRadius: 2,
      borderColor: tone === 'primary' ? '#bfdbfe' : '#e2e8f0',
      backgroundColor: tone === 'primary' ? '#eff6ff' : '#fff',
    }}
  >
    <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#0f172a', mb: 0.75 }}>
      {title}
    </Typography>
    <Typography sx={{ fontSize: 12.5, lineHeight: 1.7, color: '#475569' }}>
      {body}
    </Typography>
  </Paper>
);

const CompareCasesScreen = () => {
  const { caseList, loadCaseList, priorityBuckets, getFilteredCaseList } = useAppContext();
  const [compareMode, setCompareMode] = useState('detailed');
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [selectedPortfolioCases, setSelectedPortfolioCases] = useState([]);
  const [detailedResult, setDetailedResult] = useState(null);
  const [portfolioResult, setPortfolioResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [usePriorityFilter, setUsePriorityFilter] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!caseList.length) loadCaseList();
  }, []);

  const displayCases = useMemo(() => (
    usePriorityFilter && priorityBuckets.enabled ? getFilteredCaseList() : caseList
  ), [usePriorityFilter, priorityBuckets.enabled, getFilteredCaseList, caseList]);

  const caseLookup = useMemo(() => {
    const lookup = new Map();
    displayCases.forEach((item) => lookup.set(getCaseId(item), item));
    return lookup;
  }, [displayCases]);

  const strongestPair = useMemo(
    () => findStrongestPair(portfolioResult?.comparison_matrix),
    [portfolioResult],
  );

  const portfolioCaseSummaries = useMemo(
    () => selectedPortfolioCases.map((caseId) => caseLookup.get(caseId) || { case_id: caseId }),
    [selectedPortfolioCases, caseLookup],
  );

  const runDetailedComparison = async () => {
    if (!selectedA || !selectedB || selectedA === selectedB) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.post('/api/v2/compare/run-analysis', {
        case_a: selectedA,
        case_b: selectedB,
      });
      setDetailedResult(response);
      setPortfolioResult(null);
    } catch (err) {
      setError(err.message || 'Detailed comparison failed.');
    } finally {
      setLoading(false);
    }
  };

  const runPortfolioComparison = async () => {
    if (selectedPortfolioCases.length < 2) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.post('/api/v2/rag/batch-compare', {
        case_ids: selectedPortfolioCases,
        top_k: Math.max(selectedPortfolioCases.length, 5),
      });
      setPortfolioResult(response);
      setDetailedResult(null);
    } catch (err) {
      setError(err.message || 'Portfolio comparison failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = () => {
    if (compareMode === 'portfolio') runPortfolioComparison();
    else runDetailedComparison();
  };

  const handleModeChange = (_, nextMode) => {
    if (!nextMode) return;
    setCompareMode(nextMode);
    setError('');
  };

  const handlePortfolioSelection = (event) => {
    const nextValues = Array.isArray(event.target.value) ? event.target.value : [];
    if (nextValues.length > MAX_PORTFOLIO_CASES) return;
    setSelectedPortfolioCases(nextValues);
  };

  const adoptStrongestPair = () => {
    if (!strongestPair) return;
    setCompareMode('detailed');
    setSelectedA(strongestPair.caseA);
    setSelectedB(strongestPair.caseB);
  };

  const canRunDetailed = Boolean(selectedA && selectedB && selectedA !== selectedB);
  const canRunPortfolio = selectedPortfolioCases.length >= 2;

  return (
    <PageContainer
      title="Case Comparison"
      subtitle="Compare cases either as a forensic pair review or as a multi-case pattern matrix"
      breadcrumbs={['Investigation', 'Case Comparison']}
      actions={(
        <Stack direction="row" spacing={1.5} alignItems="center">
          {priorityBuckets.enabled && (
            <FormControlLabel
              control={<Checkbox checked={usePriorityFilter} onChange={(event) => setUsePriorityFilter(event.target.checked)} size="small" sx={{ py: 0 }} />}
              label={(
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FilterIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption" fontWeight="500">{priorityBuckets.activeBucket}</Typography>
                </Box>
              )}
              sx={{ mr: 1, '& .MuiTypography-root': { fontSize: '0.8rem' } }}
            />
          )}
          <Button
            variant="contained"
            size="small"
            disableElevation
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
            onClick={handleCompare}
            disabled={loading || (compareMode === 'detailed' ? !canRunDetailed : !canRunPortfolio)}
            sx={{ fontWeight: 700 }}
          >
            {loading ? 'Analyzing...' : compareMode === 'detailed' ? 'Compare 2 Cases' : 'Compare Portfolio'}
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive value={compareMode} onChange={handleModeChange} size="small" sx={{ alignSelf: 'flex-start' }}>
              <ToggleButton value="detailed">
                <CompareIcon sx={{ fontSize: 16, mr: 0.75 }} />
                Detailed Compare
              </ToggleButton>
              <ToggleButton value="portfolio">
                <MatrixIcon sx={{ fontSize: 16, mr: 0.75 }} />
                Portfolio Compare
              </ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
              <SelectionSummaryCard
                title="How Detailed Compare Works"
                tone={compareMode === 'detailed' ? 'primary' : 'default'}
                body="Detailed Compare calls the Sentinel compare endpoint and builds two case packs side by side. It compares alerts, transaction volume, customers, counterparties, and an AI narrative for exactly two cases."
              />
              <SelectionSummaryCard
                title="How Portfolio Compare Works"
                tone={compareMode === 'portfolio' ? 'primary' : 'default'}
                body="Portfolio Compare uses vector similarity when the local RAG index is available. If not, it falls back to a hybrid case-pack similarity model using counterparty overlap, alert patterns, transaction channels, entity overlap, and numeric behavior similarity."
              />
              <SelectionSummaryCard
                title="Current Sentinel Rule"
                body="Today, full forensic evidence comparison is limited to two cases at a time. Multi-case comparison is available as a similarity matrix rather than a full side-by-side evidence board for every pair."
              />
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2.25, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 1 }}>
              {compareMode === 'detailed' ? <CompareIcon fontSize="small" /> : <MatrixIcon fontSize="small" />}
              {compareMode === 'detailed' ? 'CASE SELECTION' : 'PORTFOLIO SELECTION'}
            </Typography>
          </Box>

          <Box sx={{ p: 3 }}>
            {compareMode === 'detailed' ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto 1fr' }, gap: 3, alignItems: 'end' }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Case A</InputLabel>
                  <Select value={selectedA} onChange={(event) => setSelectedA(event.target.value)} label="Case A">
                    <MenuItem value="">Select Case...</MenuItem>
                    {displayCases.map((item) => <MenuItem key={getCaseId(item)} value={getCaseId(item)}>{getCaseId(item)}</MenuItem>)}
                  </Select>
                </FormControl>

                <Box sx={{ bgcolor: '#f1f5f9', borderRadius: '50%', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#475569', mx: 'auto' }}>
                  VS
                </Box>

                <FormControl size="small" fullWidth>
                  <InputLabel>Case B</InputLabel>
                  <Select value={selectedB} onChange={(event) => setSelectedB(event.target.value)} label="Case B">
                    <MenuItem value="">Select Case...</MenuItem>
                    {displayCases.map((item) => <MenuItem key={getCaseId(item)} value={getCaseId(item)}>{getCaseId(item)}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>
            ) : (
              <Stack spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Select 2 to 6 Cases</InputLabel>
                  <Select
                    multiple
                    value={selectedPortfolioCases}
                    onChange={handlePortfolioSelection}
                    label="Select 2 to 6 Cases"
                    renderValue={(selected) => (
                      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                        {selected.map((caseId) => <Chip key={caseId} label={caseId} size="small" />)}
                      </Stack>
                    )}
                  >
                    {displayCases.map((item) => {
                      const caseId = getCaseId(item);
                      const disabled = !selectedPortfolioCases.includes(caseId) && selectedPortfolioCases.length >= MAX_PORTFOLIO_CASES;
                      return (
                        <MenuItem key={caseId} value={caseId} disabled={disabled}>
                          <Checkbox checked={selectedPortfolioCases.includes(caseId)} size="small" />
                          {caseId}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
                <Alert severity="info" sx={{ border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
                  Portfolio Compare is meant for 2 to {MAX_PORTFOLIO_CASES} cases. Use it to identify the strongest pair or cluster, then switch to Detailed Compare for a deeper forensic review.
                </Alert>
              </Stack>
            )}

            {usePriorityFilter && priorityBuckets.enabled && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                  Showing <strong>{displayCases.length} cases</strong> from bucket <strong>{priorityBuckets.activeBucket}</strong>.
                </Alert>
              </Box>
            )}
          </Box>
        </Paper>

        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}

        {compareMode === 'detailed' && detailedResult ? (
          <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, borderColor: '#c7d2fe', backgroundColor: '#f8faff' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <SparklesIcon fontSize="small" />
                AI Comparative Insight
              </Typography>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.8, color: '#1f2937' }}>
                {detailedResult?.analysis?.ai_narrative || 'AI comparison narrative is not available.'}
              </Typography>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 220px 1fr' }, gap: 2.5 }}>
              {[detailedResult.case_a, detailedResult.case_b].map((item, index) => (
                <Paper key={item?.id || index} variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, mb: 1.5 }}>
                    {index === 0 ? 'Case A' : 'Case B'}
                  </Typography>
                  <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#0f172a', mb: 2 }}>
                    {item?.id}
                  </Typography>
                  <Stack spacing={1.25}>
                    <Chip label={`Risk ${item?.risk_score ?? 0}`} color={getRiskColor(asNumber(item?.risk_score))} size="small" sx={{ fontWeight: 700, width: 'fit-content' }} />
                    <Typography sx={{ fontSize: 13, color: '#334155' }}>
                      Total Volume: <strong>{formatNumber(item?.volume || 0)}</strong>
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: '#334155' }}>
                      Alerts: <strong>{item?.alert_count ?? item?.alerts?.length ?? 0}</strong>
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: '#334155' }}>
                      Customers: <strong>{item?.customers?.length || 0}</strong>
                    </Typography>
                  </Stack>
                </Paper>
              ))}

              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Similarity
                </Typography>
                <Typography sx={{ mt: 1, fontSize: 34, fontWeight: 800, color: '#2563eb' }}>
                  {Math.round(asNumber(detailedResult?.analysis?.overlap_score, 0))}%
                </Typography>
                <Typography sx={{ mt: 1, fontSize: 12.5, color: '#475569', textAlign: 'center' }}>
                  Based on overlap of linked counterparties detected in the generated case packs.
                </Typography>
              </Paper>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
              <SelectionSummaryCard
                title="Common Counterparties"
                body={(detailedResult?.analysis?.common_counterparties || []).length
                  ? detailedResult.analysis.common_counterparties.join(', ')
                  : 'No common counterparties were identified by the current compare endpoint.'}
              />
              <SelectionSummaryCard
                title="Common Typologies"
                body={(detailedResult?.analysis?.common_typologies || []).length
                  ? detailedResult.analysis.common_typologies.join(', ')
                  : 'No common alert typologies were identified from the current case-pack alerts.'}
              />
              <SelectionSummaryCard
                title="Analyst Guidance"
                body="This view is the better choice when you need exact side-by-side evidence review across alerts, transactions, and entities for a pair of cases."
              />
            </Box>

            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2.25, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AlertIcon fontSize="small" />
                  ACTIVE ALERTS
                </Typography>
              </Box>
              <Box sx={{ p: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
                {[detailedResult.case_a, detailedResult.case_b].map((item, index) => (
                  <Stack key={`alerts_${item?.id || index}`} spacing={1}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>{item?.id}</Typography>
                    {(!item?.alerts || !item.alerts.length) ? (
                      <Typography sx={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No alerts</Typography>
                    ) : (
                      item.alerts.map((alert, alertIndex) => (
                        <Card key={`${item.id}_alert_${alertIndex}`} variant="outlined" sx={{ backgroundColor: '#fff7ed' }}>
                          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#9a3412' }}>
                                {alert.type || alert.alert_type || 'Alert'}
                              </Typography>
                              {alert.severity ? (
                                <Chip
                                  label={alert.severity}
                                  size="small"
                                  sx={{ height: 20, fontSize: '0.68rem', bgcolor: getSeverityColor(alert.severity), color: '#fff', fontWeight: 700 }}
                                />
                              ) : null}
                            </Box>
                            <Typography sx={{ mt: 0.5, fontSize: 12, color: '#64748b' }}>
                              {alert.date || alert.alert_date || 'No date'}
                            </Typography>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </Stack>
                ))}
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2.25, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MoneyIcon fontSize="small" />
                  HIGH-VALUE TRANSACTIONS
                </Typography>
              </Box>
              <Box sx={{ p: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
                {[detailedResult.case_a, detailedResult.case_b].map((item, index) => (
                  <Stack key={`txns_${item?.id || index}`} spacing={1}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>{item?.id}</Typography>
                    {(!item?.transactions || !item.transactions.length) ? (
                      <Typography sx={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No transactions</Typography>
                    ) : (
                      item.transactions.map((txn, txnIndex) => {
                        const amount = txn.amount || txn.amt || txn.transaction_amount || txn.txn_amount || 0;
                        return (
                          <Card key={`${item.id}_txn_${txnIndex}`} variant="outlined" sx={{ backgroundColor: '#f0fdf4' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>
                                  {formatNumber(amount)}
                                </Typography>
                                <Chip label={txn.type || txn.txn_type || 'Transaction'} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.68rem' }} />
                              </Box>
                              <Typography sx={{ mt: 0.5, fontSize: 12, color: '#64748b' }}>
                                {txn.counterparty || txn.beneficiary || 'No counterparty'} {txn.date ? `• ${txn.date}` : ''}
                              </Typography>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                ))}
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2.25, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <EntityIcon fontSize="small" />
                  INVOLVED ENTITIES
                </Typography>
              </Box>
              <Box sx={{ p: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
                {[detailedResult.case_a, detailedResult.case_b].map((item, index) => (
                  <Stack key={`entities_${item?.id || index}`} spacing={1}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>{item?.id}</Typography>
                    {(!item?.customers || !item.customers.length) ? (
                      <Typography sx={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No entities</Typography>
                    ) : (
                      item.customers.map((customer, customerIndex) => {
                        const name = customer.name || Object.values(customer).find((value) => typeof value === 'string' && value.length > 3) || 'Customer';
                        const identifier = customer.id || customer.customer_id || Object.values(customer).find((value) => typeof value === 'string' && /cust|acct|case|u/i.test(value)) || 'ID unavailable';
                        return (
                          <Card key={`${item.id}_cust_${customerIndex}`} variant="outlined" sx={{ backgroundColor: '#eff6ff' }}>
                            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e3a8a' }}>{name}</Typography>
                              <Typography sx={{ mt: 0.5, fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                                {identifier}
                              </Typography>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                ))}
              </Box>
            </Paper>
          </Stack>
        ) : null}

        {compareMode === 'portfolio' && portfolioResult ? (
          <Stack spacing={3}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
              <SelectionSummaryCard
                title="Cases in Matrix"
                tone="primary"
                body={`${selectedPortfolioCases.length} cases are in the current matrix. This compares pattern similarity, not a full evidence dossier for every pair.`}
              />
              <SelectionSummaryCard
                title="Technique Used"
                body={portfolioResult?.methodology_summary
                  || 'Portfolio Compare is using the available similarity engine for this environment.'}
              />
              <SelectionSummaryCard
                title="Strongest Pair"
                body={strongestPair
                  ? `${strongestPair.caseA} and ${strongestPair.caseB} are the closest pair at ${Math.round(strongestPair.similarity * 100)}% similarity.`
                  : 'No strongest pair is available yet.'}
              />
            </Box>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }} justifyContent="space-between">
                <Box>
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    Portfolio Compare
                  </Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#64748b' }}>
                    {portfolioResult?.methodology === 'vector_rag_similarity'
                      ? 'Multi-case comparison is using vector embeddings and cosine similarity over rich case summaries.'
                      : 'Vector RAG is unavailable, so Sentinel is using a hybrid structured similarity fallback built from case-pack features.'}
                  </Typography>
                </Box>
                <Button variant="contained" onClick={adoptStrongestPair} disabled={!strongestPair}>
                  Open Strongest Pair in Detailed Compare
                </Button>
              </Stack>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
              {portfolioCaseSummaries.map((item) => {
                const score = asNumber(item?.risk_score || item?.riskScore, 0);
                return (
                  <Paper key={getCaseId(item)} variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                        {getCaseId(item)}
                      </Typography>
                      <Chip label={`Risk ${score}`} color={getRiskColor(score)} size="small" />
                    </Stack>
                    <Stack spacing={0.75} sx={{ mt: 1.25 }}>
                      <Typography sx={{ fontSize: 12.5, color: '#475569' }}>
                        Alert Count: <strong>{asNumber(item?.alert_count, 0)}</strong>
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#475569' }}>
                        Priority: <strong>{item?.case_priority || item?.priority || 'Not classified'}</strong>
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: '#475569' }}>
                        Linked Cases: <strong>{asNumber(item?.linked_cases_count, 0)}</strong>
                      </Typography>
                    </Stack>
                  </Paper>
                );
              })}
            </Box>

            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2.25, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <NetworkIcon fontSize="small" />
                  SIMILARITY MATRIX
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#fafafa' }}>
                      <TableCell sx={{ fontWeight: 800 }}>Case ID</TableCell>
                      {portfolioResult?.comparison_matrix?.[0]?.comparisons?.map((item) => (
                        <TableCell key={`head_${item.case_id}`} align="center" sx={{ fontWeight: 800 }}>
                          {item.case_id}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(portfolioResult?.comparison_matrix || []).map((row) => (
                      <TableRow key={row.case_id} hover>
                        <TableCell sx={{ fontWeight: 800 }}>{row.case_id}</TableCell>
                        {(row.comparisons || []).map((cell) => {
                          const score = Math.round(asNumber(cell.similarity, 0) * 100);
                          let color = 'default';
                          if (score >= 85) color = 'success';
                          else if (score >= 70) color = 'primary';
                          else if (score >= 50) color = 'warning';
                          return (
                            <TableCell key={`${row.case_id}_${cell.case_id}`} align="center">
                              <Chip label={`${score}%`} color={color} size="small" sx={{ fontWeight: 700, minWidth: 58 }} />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        ) : null}

        {!loading && !detailedResult && !portfolioResult ? (
          <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 6, textAlign: 'center', color: '#64748b' }}>
            <CompareIcon sx={{ fontSize: 52, opacity: 0.35, mb: 2 }} />
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#334155' }}>
              {compareMode === 'detailed' ? 'Select two cases for side-by-side review' : 'Select 2 to 6 cases for portfolio comparison'}
            </Typography>
            <Typography sx={{ mt: 1, fontSize: 13.5 }}>
              {compareMode === 'detailed'
                ? 'Detailed Compare is the Sentinel path for full evidence review across exactly two cases.'
                : 'Portfolio Compare helps narrow a wider set into the most meaningful pair or cluster.'}
            </Typography>
          </Paper>
        ) : null}
      </Stack>
    </PageContainer>
  );
};

export default CompareCasesScreen;
