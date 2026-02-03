import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Paper, Typography, Grid, FormControl, InputLabel, Select, MenuItem,
  Button, Card, CardContent, RadioGroup, FormControlLabel, Radio, TextField,
  LinearProgress, Alert, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  Divider, Tabs, Tab, Switch, FormGroup
} from '@mui/material';
import {
  DataObject, FilterAlt, Functions
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '../layout/PageContainer';
import { PageTransition, MotionContainer, MotionItem } from "@components/MotionWrappers/MotionWrappers";

// ✅ Keep ALL components
import AggregationHealthCheck from '../components/aggregation/AggregationHealthCheck';
import SnapshotExplainer from '../components/aggregation/SnapshotExplainer';
import MissedBehaviorWarning from '../components/aggregation/MissedBehaviorWarning';
import CalibrationRiskHints from '../components/aggregation/CalibrationRiskHints';
import SQLQueryViewer from '../components/aggregation/SQLQueryViewer';
import CompressionFlowCard from '../components/aggregation/CompressionFlowCard';
import TimeSeriesPreview from '../components/aggregation/TimeSeriesPreview';
import CoverageChart from '../components/aggregation/CoverageChart';
import AggregationNarrative from '../components/aggregation/AggregationNarrative';

// ✅ Live Update Indicator - Subtle
const LiveUpdatePulse = ({ isUpdating }) => (
  <Box sx={{ position: 'relative', width: 8, height: 8, display: 'inline-block', ml: 1 }}>
    <Box sx={{
      width: 8, 
      height: 8, 
      borderRadius: '50%',
      bgcolor: isUpdating ? '#16a34a' : 'grey.300',
      transition: 'all 0.3s ease',
      ...(isUpdating && { 
        animation: 'pulse 1.5s ease-in-out infinite',
        '@keyframes pulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 }
        }
      })
    }} />
  </Box>
);

// ✅ Config Card - Professional
const ConfigCard = ({ title, subtitle, icon, children }) => (
  <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
      {icon && <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>}
      <Box>
        <Typography variant="subtitle2" fontWeight={500}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      </Box>
    </Stack>
    {children}
  </Paper>
);

const AggregationScreen = () => {
  const { run, saveAggregation, loading, error, currentStep, goToStep } = useCalibration();
  const { activeEnv } = useAppContext();
  
  const [config, setConfig] = useState({
    level: 'account',
    lookback_value: 30,
    lookback_unit: 'days',
    frequency: 'daily',
    metrics: ['sum_amount', 'count'],
    filter_history: true
  });

  const [liveStats, setLiveStats] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  
  const updateTimeoutRef = useRef(null);
  const isNavigatingRef = useRef(false);

  const fetchLivePreview = useCallback(async () => {
    if (!run?.run_id || !activeEnv || isNavigatingRef.current) return;
    
    setPreviewLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/aggregate/${run.run_id}/preview`,
        { env_id: activeEnv, aggregation_config: config }
      );
      setLiveStats(res);
    } catch (err) {
      console.error('Preview error:', err);
    } finally {
      setPreviewLoading(false);
      setIsUpdating(false);
    }
  }, [run?.run_id, activeEnv, config]);

  useEffect(() => {
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    setIsUpdating(true);
    
    updateTimeoutRef.current = setTimeout(() => {
      fetchLivePreview();
    }, 600);
    
    return () => clearTimeout(updateTimeoutRef.current);
  }, [fetchLivePreview]);

  const handleConfigChange = (field, value) => {
    if (isNavigatingRef.current) return;
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleConfirmAggregation = async () => {
    if (isNavigatingRef.current) {
      console.log('[AggregationScreen] Already navigating, ignoring');
      return;
    }

    isNavigatingRef.current = true;
    console.log('[AggregationScreen] Confirming aggregation');

    try {
      await saveAggregation(config);
      
      // Wait for state to settle before navigating
      setTimeout(() => {
        goToStep('validation');
      }, 100);
    } catch (err) {
      console.error('Aggregation failed:', err);
      isNavigatingRef.current = false;
    }
  };

  const generateSqlPreview = () => {
    const entity = config.level === 'customer' ? 'customer_id' : 'account_id';
    const lookback = config.lookback_unit === 'days' ? config.lookback_value : 
                     config.lookback_unit === 'weeks' ? config.lookback_value * 7 : 
                     config.lookback_value * 30;
    const historyFilter = config.filter_history 
      ? "\n  AND t.category = v1_meta.category" 
      : "";
    
    return `-- Step 2: Deduplicate + Rolling Window
SELECT 
  d.${entity}, 
  d.alert_date,
  SUM(t.amount) as agg_${lookback}d_amount,
  COUNT(*) as agg_${lookback}d_count
FROM (
  SELECT DISTINCT
    ${entity},
    transaction_date AS alert_date
  FROM v1
) d
JOIN transactions t 
  ON t.${entity} = d.${entity}${historyFilter}
  AND t.date BETWEEN 
      d.alert_date - INTERVAL '${lookback - 1}' DAY
      AND d.alert_date
GROUP BY d.${entity}, d.alert_date;`;
  };

  // Check if we should render this screen
  if (currentStep !== 'aggregation') {
    console.log('[AggregationScreen] Not on aggregation step, unmounting');
    return null;
  }

  return (
    <PageTransition>
      <PageContainer>
        
        {/* Header */}
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
            <Box sx={{ 
              width: 40, 
              height: 40, 
              borderRadius: 1, 
              bgcolor: 'primary.main', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              color: 'white', 
              fontWeight: 500,
              fontSize: '1.125rem'
            }}>
              2
            </Box>
            <Box>
              <Typography variant="h5" fontWeight={500}>Aggregation Logic</Typography>
              <Typography variant="body2" color="text.secondary">Configure behavioral summarization</Typography>
            </Box>
          </Stack>
        </Box>

        <Grid container spacing={3}>
          
          {/* LEFT: CONTROLS */}
          <Grid item xs={12} md={5}>
            <MotionContainer>
              
              <MotionItem>
                <ConfigCard 
                  title="1. Grouping Entity" 
                  subtitle="WHO are we profiling?" 
                  icon={<DataObject fontSize="small" />}
                >
                  <RadioGroup value={config.level} onChange={(e) => handleConfigChange('level', e.target.value)}>
                    <FormControlLabel 
                      value="account" 
                      control={<Radio size="small"/>} 
                      label={<Typography variant="body2">Account Level</Typography>} 
                    />
                    <FormControlLabel 
                      value="customer" 
                      control={<Radio size="small"/>} 
                      label={<Typography variant="body2">Customer Level</Typography>} 
                    />
                  </RadioGroup>
                </ConfigCard>
              </MotionItem>

              <MotionItem>
                <ConfigCard 
                  title="2. Transaction Scope" 
                  subtitle="WHAT transactions?" 
                  icon={<FilterAlt fontSize="small" />}
                >
                  <FormGroup>
                    <FormControlLabel 
                      control={
                        <Switch 
                          checked={config.filter_history} 
                          onChange={(e) => handleConfigChange('filter_history', e.target.checked)} 
                          size="small" 
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" fontWeight={500}>Match Step 1 Filters</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Aggregate only matching transactions
                          </Typography>
                        </Box>
                      }
                    />
                  </FormGroup>
                  {config.filter_history ? (
                    <Alert severity="info" variant="outlined" sx={{ mt: 1.5, py: 0.5 }}>
                      <Typography variant="caption">Aggregating matching transactions only</Typography>
                    </Alert>
                  ) : (
                    <Alert severity="warning" variant="outlined" sx={{ mt: 1.5, py: 0.5 }}>
                      <Typography variant="caption">Aggregating ALL transaction types</Typography>
                    </Alert>
                  )}
                </ConfigCard>
              </MotionItem>

              <MotionItem>
                <ConfigCard 
                  title="3. Window & Metrics" 
                  subtitle="Time horizon" 
                  icon={<Functions fontSize="small" />}
                >
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={6}>
                      <TextField 
                        label="Lookback" 
                        type="number" 
                        size="small" 
                        fullWidth 
                        value={config.lookback_value} 
                        onChange={(e) => handleConfigChange('lookback_value', parseInt(e.target.value) || 1)} 
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Unit</InputLabel>
                        <Select 
                          value={config.lookback_unit} 
                          label="Unit" 
                          onChange={(e) => handleConfigChange('lookback_unit', e.target.value)}
                        >
                          <MenuItem value="days">Days</MenuItem>
                          <MenuItem value="weeks">Weeks</MenuItem>
                          <MenuItem value="months">Months</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                  
                  <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mb: 2 }}>
                    {[7, 14, 30, 90].map(d => (
                      <Chip 
                        key={d} 
                        label={`${d}d`} 
                        size="small" 
                        onClick={() => {
                          handleConfigChange('lookback_value', d); 
                          handleConfigChange('lookback_unit', 'days');
                        }} 
                        variant={config.lookback_value === d && config.lookback_unit === 'days' ? "filled" : "outlined"}
                      />
                    ))}
                  </Stack>
                  
                  <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                    <InputLabel>Frequency</InputLabel>
                    <Select 
                      value={config.frequency} 
                      label="Frequency" 
                      onChange={(e) => handleConfigChange('frequency', e.target.value)}
                    >
                      <MenuItem value="daily">Daily</MenuItem>
                      <MenuItem value="weekly">Weekly</MenuItem>
                      <MenuItem value="28day">28-Day Rolling</MenuItem>
                      <MenuItem value="monthly">Monthly</MenuItem>
                      <MenuItem value="quarterly">Quarterly</MenuItem>
                    </Select>
                  </FormControl>
                  
                  <FormControl fullWidth size="small">
                    <InputLabel>Metrics</InputLabel>
                    <Select 
                      multiple 
                      value={config.metrics} 
                      label="Metrics" 
                      onChange={(e) => handleConfigChange('metrics', e.target.value)}
                      renderValue={(s) => s.map(m => m.replace('_', ' ')).join(', ').toUpperCase()}
                    >
                      <MenuItem value="sum_amount">Sum Amount</MenuItem>
                      <MenuItem value="avg_amount">Avg Amount</MenuItem>
                      <MenuItem value="max_amount">Max Amount</MenuItem>
                      <MenuItem value="count">Count</MenuItem>
                      <MenuItem value="velocity">Velocity</MenuItem>
                    </Select>
                  </FormControl>
                </ConfigCard>
              </MotionItem>

              {/* ✅ SQL Query Viewer - Keep */}
              <MotionItem>
                <SQLQueryViewer sqlQuery={generateSqlPreview()} />
              </MotionItem>
              
              {/* ✅ Aggregation Narrative - Keep */}
              {liveStats?.narrative && (
                <MotionItem>
                  <AggregationNarrative narrative={liveStats.narrative} />
                </MotionItem>
              )}

            </MotionContainer>
          </Grid>

          {/* RIGHT: PREVIEW + ALL INSIGHTS */}
          <Grid item xs={12} md={7}>
            <MotionContainer>
              
              {/* Loading */}
              {previewLoading && (
                <MotionItem>
                  <Box>
                    <LinearProgress sx={{ height: 2 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Updating preview...
                    </Typography>
                  </Box>
                </MotionItem>
              )}
              
              {/* ✅ 1. Compression Flow - Keep */}
              {liveStats?.compression_flow && (
                <MotionItem>
                  <CompressionFlowCard data={liveStats} />
                </MotionItem>
              )}
              
              {/* ✅ 2. Health Check - Keep */}
              {liveStats?.health_checks && liveStats.health_checks.length > 0 && (
                <MotionItem>
                  <AggregationHealthCheck checks={liveStats.health_checks} />
                </MotionItem>
              )}
              
              {/* ✅ 3. Time Series Preview - Keep */}
              {liveStats?.visuals?.time_series_sample && liveStats.visuals.time_series_sample.length > 0 && (
                <MotionItem>
                  <TimeSeriesPreview data={liveStats} />
                </MotionItem>
              )}
              
              {/* ✅ 4. Coverage Chart - Keep */}
              {liveStats?.visuals?.coverage_chart && liveStats.visuals.coverage_chart.length > 0 && (
                <MotionItem>
                  <CoverageChart data={liveStats} />
                </MotionItem>
              )}
              
              {/* ✅ 5. Snapshot Explainer - Keep */}
              {liveStats?.snapshot_explainer && (
                <MotionItem>
                  <SnapshotExplainer snapshot={liveStats.snapshot_explainer} />
                </MotionItem>
              )}
              
              {/* ✅ 6. Missed Behavior Warnings - Keep */}
              {liveStats?.missed_warnings && liveStats.missed_warnings.length > 0 && (
                <MotionItem>
                  <MissedBehaviorWarning warnings={liveStats.missed_warnings} />
                </MotionItem>
              )}
              
              {/* ✅ 7. Calibration Risk Hints - Keep */}
              {liveStats?.calibration_risks && liveStats.calibration_risks.length > 0 && (
                <MotionItem>
                  <CalibrationRiskHints risks={liveStats.calibration_risks} />
                </MotionItem>
              )}

              {/* ✅ 8. Data Preview Table */}
              <MotionItem>
                <Card variant="outlined">
                  <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 2 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Stack direction="row" alignItems="center">
                        <Typography variant="h6" fontWeight={500}>Preview</Typography>
                        <LiveUpdatePulse isUpdating={isUpdating} />
                      </Stack>
                      <Stack direction="row" spacing={1}>
                        <Chip 
                          label={`${liveStats?.output_rows?.toLocaleString() || 0} rows`} 
                          size="small" 
                          variant="outlined"
                        />
                        {liveStats?.sample_rows?.[0] && (
                          <Chip 
                            label={`${Object.keys(liveStats.sample_rows[0]).filter(k => 
                              !k.toLowerCase().includes('transaction_id') && k.toLowerCase() !== 'id'
                            ).length} cols`}
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </Stack>
                    <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ minHeight: 40 }}>
                      <Tab label="Data Sample" sx={{ minHeight: 40, textTransform: 'none' }} />
                      <Tab label="Statistics" sx={{ minHeight: 40, textTransform: 'none' }} />
                    </Tabs>
                  </Box>

                  <CardContent sx={{ p: 0, minHeight: 300 }}>
                    {activeTab === 0 && liveStats?.sample_rows && liveStats.sample_rows.length > 0 && (
                      <Box sx={{ overflowX: 'auto' }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              {Object.keys(liveStats.sample_rows[0] || {}).map(k => {
                                if (k.toLowerCase().includes('transaction_id') || k.toLowerCase() === 'id') return null;
                                const isAggCol = k.startsWith('agg_') || k.startsWith('avg_') || k.startsWith('max_');
                                return (
                                  <TableCell 
                                    key={k} 
                                    sx={{ 
                                      fontWeight: 500, 
                                      fontSize: '0.75rem', 
                                      bgcolor: isAggCol ? '#fff5f0' : 'grey.50',
                                      color: isAggCol ? 'primary.main' : 'text.primary',
                                      whiteSpace: 'nowrap'
                                    }}
                                  >
                                    {k.toUpperCase().replace(/_/g, ' ')}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {liveStats.sample_rows.map((row, i) => (
                              <TableRow key={i} hover>
                                {Object.entries(row).map(([key, v], idx) => {
                                  if (key.toLowerCase().includes('transaction_id') || key.toLowerCase() === 'id') return null;
                                  let displayValue = v;
                                  if (typeof v === 'number') {
                                    displayValue = v > 1000 ? v.toLocaleString(undefined, {maximumFractionDigits: 2}) : 
                                                  v % 1 !== 0 ? v.toFixed(2) : v;
                                  }
                                  return (
                                    <TableCell key={idx} sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                      {displayValue}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    )}

                    {activeTab === 0 && (!liveStats?.sample_rows || liveStats.sample_rows.length === 0) && (
                      <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          Configure aggregation to see preview
                        </Typography>
                      </Box>
                    )}

                    {activeTab === 1 && liveStats && (
                      <Box p={3}>
                        <Grid container spacing={3}>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">Input Rows (v1)</Typography>
                            <Typography variant="h6" fontWeight={500}>
                              {liveStats.input_rows?.toLocaleString() || 0}
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">Output Rows (v2)</Typography>
                            <Typography variant="h6" fontWeight={500}>
                              {liveStats.output_rows?.toLocaleString() || 0}
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">Compression Ratio</Typography>
                            <Typography variant="h6" fontWeight={500} color="primary.main">
                              {liveStats.compression_ratio || 0}x
                            </Typography>
                          </Grid>
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">Unique Entities</Typography>
                            <Typography variant="h6" fontWeight={500}>
                              {liveStats.unique_entities?.toLocaleString() || 0}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    )}
                  </CardContent>
                  
                  <Divider />
                  <Box p={2}>
                    <Button 
                      variant="contained" 
                      fullWidth 
                      onClick={handleConfirmAggregation} 
                      disabled={loading || !liveStats?.output_rows || isNavigatingRef.current}
                    >
                      {loading || isNavigatingRef.current ? 'Processing...' : 'Confirm Aggregation'}
                    </Button>
                  </Box>
                </Card>
              </MotionItem>

            </MotionContainer>
          </Grid>

        </Grid>
      </PageContainer>
    </PageTransition>
  );
};

export default AggregationScreen;