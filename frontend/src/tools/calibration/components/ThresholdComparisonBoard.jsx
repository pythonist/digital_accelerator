// EXTEND: frontend/src/tools/calibration/components/ThresholdComparisonBoard.jsx
// Add STR capture columns (optional enhancement)

import React, { useState, useEffect } from 'react';
import {
  Paper, Table, TableBody, TableCell, TableHead, TableRow,
  Box, Typography, Button, IconButton, Tooltip, Chip,
  LinearProgress, Stack
} from '@mui/material';
import {
  PushPin as PinIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CheckCircle,
  Cancel
} from '@mui/icons-material';
import apiClient from '@services/api';

const ThresholdComparisonBoard = ({ 
  currentScenario, 
  loading,
  runId, // NEW: Pass runId to load STR data
  onPin,
  onJumpToScenario
}) => {
  const [pinnedScenarios, setPinnedScenarios] = useState([]);
  const [strData, setStrData] = useState({}); // NEW: Cache STR evaluations
  
  // NEW: Load STR evaluation when scenario changes
  useEffect(() => {
    if (currentScenario?.threshold && runId) {
      loadSTREvaluation(currentScenario.threshold, 'current');
    }
  }, [currentScenario?.threshold, runId]);
  
  const loadSTREvaluation = async (threshold, scenarioId) => {
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/str-evaluation`,
        { threshold, metric: 'amount' }
      );
      
      setStrData(prev => ({
        ...prev,
        [scenarioId]: {
          captured: res.captured_strs || 0,
          missed: res.missed_strs || 0,
          capture_rate: res.capture_rate || 0
        }
      }));
    } catch (err) {
      console.warn('STR data not available:', err);
    }
  };
  
  const handlePin = async () => {
    if (!currentScenario || !currentScenario.alerts_triggered) return;
    
    const entitySummary = currentScenario.summary || {};
    const scenarioId = Date.now();
    
    const scenario = {
      id: scenarioId,
      label: `p${currentScenario.percentile}`,
      percentile: currentScenario.percentile,
      threshold: currentScenario.threshold,
      alerts: currentScenario.alerts_triggered,
      pct_pop: (currentScenario.pct_population || 0).toFixed(1),
      alerted_accounts: entitySummary.alerted_accounts || 0,
      alerted_customers: entitySummary.alerted_customers || 0,
      sensitivity: currentScenario.sensitivity?.alerts_per_1pct,
      confidence: currentScenario.confidence?.level,
      pinned_at: new Date().toLocaleTimeString()
    };
    
    setPinnedScenarios(prev => [...prev.slice(-4), scenario]);
    
    // Load STR data for pinned scenario
    await loadSTREvaluation(scenario.threshold, scenarioId);
    
    if (onPin) onPin(scenario);
  };
  
  const handleDelete = (id) => {
    setPinnedScenarios(prev => prev.filter(s => s.id !== id));
    setStrData(prev => {
      const newData = {...prev};
      delete newData[id];
      return newData;
    });
  };
  
  const handleJump = (scenario) => {
    if (onJumpToScenario) {
      onJumpToScenario(scenario.percentile);
    }
  };
  
  const calculateDelta = (current, previous) => {
    if (!previous) return null;
    const delta = previous - current;
    const deltaPct = ((delta / previous) * 100).toFixed(1);
    return { delta, deltaPct };
  };
  
  const entitySummary = currentScenario?.summary || {};
  const allScenarios = [
    currentScenario && currentScenario.threshold && {
      id: 'current',
      label: `p${currentScenario.percentile} (Live)`,
      percentile: currentScenario.percentile,
      threshold: currentScenario.threshold,
      alerts: currentScenario.alerts_triggered,
      pct_pop: currentScenario.pct_population ? currentScenario.pct_population.toFixed(1) : '0.0',
      alerted_accounts: entitySummary.alerted_accounts || 0,
      alerted_customers: entitySummary.alerted_customers || 0,
      sensitivity: currentScenario.sensitivity?.alerts_per_1pct,
      confidence: currentScenario.confidence?.level,
      isCurrent: true
    },
    ...pinnedScenarios
  ].filter(Boolean);
  
  return (
    <Paper sx={{ p: 0, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
      {/* Header */}
      <Box sx={{ 
        p: 2, 
        bgcolor: '#FAFAFA', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid #E0E0E0'
      }}>
        <Box>
          <Typography variant="subtitle2" fontWeight="bold">
            Scenario Comparison Board
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Compare entity impact and STR capture side-by-side
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Clear all pinned scenarios">
            <IconButton 
              size="small" 
              onClick={() => {
                setPinnedScenarios([]);
                setStrData({});
              }}
              disabled={pinnedScenarios.length === 0}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button 
            startIcon={<PinIcon />} 
            size="small" 
            variant="outlined" 
            onClick={handlePin}
            disabled={loading || !currentScenario}
          >
            Pin Current
          </Button>
        </Stack>
      </Box>
      
      {/* Table */}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, minWidth: 120 }}>Scenario</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Percentile</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Threshold</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Alerts</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#FFF9E6' }}>Accounts</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#FFF9E6' }}>Δ Accts %</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#FFEBEE' }}>Customers</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#FFEBEE' }}>Δ Custs %</TableCell>
              {/* NEW: STR Columns */}
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#E8F5E9' }}>STR Captured</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, bgcolor: '#FFCDD2' }}>STR Missed</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>% Pop</TableCell>
              <TableCell align="center" sx={{ fontWeight: 600 }}>Sensitivity</TableCell>
              <TableCell align="center" sx={{ fontWeight: 600 }}>Confidence</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {allScenarios.map((scenario, idx) => {
              const prevScenario = idx > 0 ? allScenarios[idx - 1] : null;
              const deltaAccounts = calculateDelta(scenario.alerted_accounts, prevScenario?.alerted_accounts);
              const deltaCustomers = calculateDelta(scenario.alerted_customers, prevScenario?.alerted_customers);
              
              // Get STR data for this scenario
              const str = strData[scenario.id] || {};
              
              return (
                <TableRow 
                  key={scenario.id}
                  selected={scenario.isCurrent}
                  hover={!scenario.isCurrent}
                  onClick={() => !scenario.isCurrent && handleJump(scenario)}
                  sx={{ 
                    cursor: scenario.isCurrent ? 'default' : 'pointer',
                    bgcolor: scenario.isCurrent ? '#F5F9FF' : 'inherit'
                  }}
                >
                  <TableCell>
                    <Typography 
                      variant="body2" 
                      fontWeight={scenario.isCurrent ? 'bold' : 'normal'}
                      color={scenario.isCurrent ? 'primary.main' : 'text.primary'}
                    >
                      {scenario.label}
                    </Typography>
                    {scenario.pinned_at && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {scenario.pinned_at}
                      </Typography>
                    )}
                  </TableCell>
                  
                  <TableCell>p{scenario.percentile}</TableCell>
                  
                  <TableCell align="right">
                    ₹{scenario.threshold ? scenario.threshold.toLocaleString() : '-'}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {loading && scenario.isCurrent ? (
                      <LinearProgress sx={{ width: 50 }} />
                    ) : (
                      scenario.alerts ? scenario.alerts.toLocaleString() : '-'
                    )}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ bgcolor: '#FFF9E6', fontWeight: 600 }}>
                    {scenario.alerted_accounts?.toLocaleString() || '0'}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ bgcolor: '#FFF9E6' }}>
                    {deltaAccounts ? (
                      <Typography 
                        variant="body2" 
                        color={deltaAccounts.delta > 0 ? 'success.main' : 'error.main'}
                        fontWeight={500}
                      >
                        {deltaAccounts.delta > 0 ? '-' : '+'}{Math.abs(deltaAccounts.deltaPct)}%
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ bgcolor: '#FFEBEE', fontWeight: 600 }}>
                    {scenario.alerted_customers?.toLocaleString() || '0'}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ bgcolor: '#FFEBEE' }}>
                    {deltaCustomers ? (
                      <Typography 
                        variant="body2" 
                        color={deltaCustomers.delta > 0 ? 'success.main' : 'error.main'}
                        fontWeight={500}
                      >
                        {deltaCustomers.delta > 0 ? '-' : '+'}{Math.abs(deltaCustomers.deltaPct)}%
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  {/* NEW: STR Captured */}
                  <TableCell align="right" sx={{ bgcolor: '#E8F5E9' }}>
                    {str.captured !== undefined ? (
                      <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5}>
                        <CheckCircle sx={{ fontSize: 14, color: '#4CAF50' }} />
                        <Typography variant="body2" fontWeight={600}>
                          {str.captured}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  {/* NEW: STR Missed */}
                  <TableCell align="right" sx={{ bgcolor: '#FFCDD2' }}>
                    {str.missed !== undefined ? (
                      <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5}>
                        <Cancel sx={{ fontSize: 14, color: '#F44336' }} />
                        <Typography variant="body2" fontWeight={600}>
                          {str.missed}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell align="right">{scenario.pct_pop}%</TableCell>
                  
                  <TableCell align="center">
                    {scenario.sensitivity ? (
                      <Chip
                        label={`±${scenario.sensitivity}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.7rem', height: 22 }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell align="center">
                    {scenario.confidence ? (
                      <Chip
                        label={scenario.confidence}
                        size="small"
                        color={
                          scenario.confidence === 'HIGH' ? 'success' :
                          scenario.confidence === 'MEDIUM' ? 'warning' : 'default'
                        }
                        sx={{ fontSize: '0.7rem', height: 22 }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell>
                    {!scenario.isCurrent && (
                      <IconButton 
                        size="small" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(scenario.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            
            {allScenarios.length === 0 && (
              <TableRow>
                <TableCell colSpan={14} align="center" sx={{ py: 3 }}>
                  {loading ? (
                    <Box>
                      <LinearProgress sx={{ mb: 2 }} />
                      <Typography variant="caption" color="text.secondary">
                        Loading scenario data...
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary" fontStyle="italic">
                      Move the slider to generate scenarios, then click "Pin Current"
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      
      {/* Footer Help */}
      <Box sx={{ p: 1.5, bgcolor: '#FAFAFA', borderTop: '1px solid #E0E0E0' }}>
        <Typography variant="caption" color="text.secondary">
          <strong>Entity + STR Comparison:</strong> Yellow = accounts, Red = customers, Green = captured STRs, Light Red = missed STRs.
          STR data is post-investigation ground truth used for evaluation only.
        </Typography>
      </Box>
    </Paper>
  );
};

export default ThresholdComparisonBoard;