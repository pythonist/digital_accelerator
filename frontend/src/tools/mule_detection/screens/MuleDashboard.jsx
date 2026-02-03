// frontend/src/tools/mule_detection/screens/MuleDashboard.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Stack, Alert, CircularProgress, IconButton, Tooltip,
  Divider, Grid, LinearProgress
} from '@mui/material';
import { 
  TrendingUp, Refresh, CloudUpload, AccountBalance,
  CheckCircle, Warning, FilterList, Search, GetApp,
  Timeline, Assessment, SwapHoriz, ArrowUpward, ArrowDownward
} from '@mui/icons-material';
import muleApi from '../services/muleApi';

const MuleDashboard = ({ onAccountSelect, dataStats, onReupload }) => {
  const [accounts, setAccounts] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('risk_score');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterStatus, setFilterStatus] = useState('all'); // all, flagged, clean

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [accountsRes, patternsRes] = await Promise.all([
        muleApi.getAccounts(),
        muleApi.detectPatterns()
      ]);

      if (accountsRes.success) {
        setAccounts(accountsRes.accounts || []);
      }

      if (patternsRes.success) {
        setPatterns(patternsRes.patterns || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate flagged accounts
  const flaggedAccounts = new Set(patterns.map(p => p.account_id));
  const highRiskCount = accounts.filter(a => ['CRITICAL', 'HIGH'].includes(String(a.risk_level || '').toUpperCase())).length;
  const mediumRiskCount = accounts.filter(a => a.risk_level === 'MEDIUM').length;
  const cleanCount = accounts.length - flaggedAccounts.size;

  // Sorting
  const sortedAccounts = [...accounts].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    
    if (typeof aVal === 'string') {
      return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // Filtering
  const filteredAccounts = sortedAccounts.filter(account => {
    if (filterStatus === 'flagged') return flaggedAccounts.has(account.account_id);
    if (filterStatus === 'clean') return !flaggedAccounts.has(account.account_id);
    return true;
  });

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ArrowUpward sx={{ fontSize: 14, ml: 0.5 }} /> : <ArrowDownward sx={{ fontSize: 14, ml: 0.5 }} />;
  };

  // Colors - Professional Banking Palette
  const colors = {
    bgMain: '#f8f9fa',
    bgCard: '#ffffff',
    border: '#dee2e6',
    textPrimary: '#212529',
    textSecondary: '#6c757d',
    primary: '#0d6efd',
    success: '#198754',
    warning: '#ffc107',
    danger: '#dc3545',
    successBg: '#d1e7dd',
    successText: '#0f5132',
    warningBg: '#fff3cd',
    warningText: '#664d03',
    dangerBg: '#f8d7da',
    dangerText: '#842029',
    infoBg: '#cfe2ff',
    infoText: '#084298'
  };

  return (
    <Box sx={{ bgcolor: colors.bgMain, minHeight: '100vh' }}>
      <Box sx={{ maxWidth: 1600, mx: 'auto', p: 4 }}>
        <Stack spacing={3}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography 
                variant="h4" 
                sx={{ 
                  color: colors.textPrimary, 
                  fontWeight: 600,
                  fontFamily: '"IBM Plex Sans", system-ui, -apple-system, sans-serif',
                  letterSpacing: '-0.02em'
                }}
              >
                Account Analysis Dashboard
              </Typography>
              <Typography 
                variant="body2" 
                sx={{ 
                  color: colors.textSecondary, 
                  mt: 0.5,
                  fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
                }}
              >
                Behavioral pattern detection and risk assessment
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<GetApp />}
                sx={{ 
                  borderColor: colors.border,
                  color: colors.textPrimary,
                  textTransform: 'none',
                  fontWeight: 500,
                  '&:hover': {
                    borderColor: colors.primary,
                    bgcolor: 'transparent'
                  }
                }}
              >
                Export Report
              </Button>
              <Button
                variant="outlined"
                startIcon={<CloudUpload />}
                onClick={onReupload}
                sx={{ 
                  borderColor: colors.border,
                  color: colors.textPrimary,
                  textTransform: 'none',
                  fontWeight: 500,
                  '&:hover': {
                    borderColor: colors.primary,
                    bgcolor: 'transparent'
                  }
                }}
              >
                Re-upload Data
              </Button>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={loadData}
                disabled={loading}
                sx={{ 
                  bgcolor: colors.primary,
                  textTransform: 'none',
                  fontWeight: 500,
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: '#0a58ca',
                    boxShadow: 'none'
                  }
                }}
              >
                Refresh
              </Button>
            </Stack>
          </Box>

          {/* Key Metrics Row */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Card 
                elevation={0} 
                sx={{ 
                  border: `1px solid ${colors.border}`,
                  bgcolor: colors.bgCard,
                  borderRadius: 1
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: colors.textSecondary,
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontSize: '0.7rem'
                        }}
                      >
                        Total Accounts
                      </Typography>
                      <Typography 
                        variant="h3" 
                        sx={{ 
                          fontWeight: 600, 
                          mt: 1,
                          fontFamily: '"IBM Plex Mono", monospace',
                          color: colors.textPrimary
                        }}
                      >
                        {accounts.length}
                      </Typography>
                    </Box>
                    <Box 
                      sx={{ 
                        p: 1.5, 
                        bgcolor: colors.infoBg, 
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <AccountBalance sx={{ color: colors.infoText, fontSize: 24 }} />
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card 
                elevation={0} 
                sx={{ 
                  border: `1px solid ${colors.border}`,
                  bgcolor: colors.bgCard,
                  borderRadius: 1
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: colors.textSecondary,
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontSize: '0.7rem'
                        }}
                      >
                        High Risk
                      </Typography>
                      <Typography 
                        variant="h3" 
                        sx={{ 
                          fontWeight: 600, 
                          mt: 1,
                          fontFamily: '"IBM Plex Mono", monospace',
                          color: colors.danger
                        }}
                      >
                        {highRiskCount}
                      </Typography>
                    </Box>
                    <Box 
                      sx={{ 
                        p: 1.5, 
                        bgcolor: colors.dangerBg, 
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Warning sx={{ color: colors.dangerText, fontSize: 24 }} />
                    </Box>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={(highRiskCount / accounts.length) * 100}
                    sx={{ 
                      mt: 2,
                      height: 4,
                      borderRadius: 2,
                      bgcolor: colors.dangerBg,
                      '& .MuiLinearProgress-bar': {
                        bgcolor: colors.danger,
                        borderRadius: 2
                      }
                    }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card 
                elevation={0} 
                sx={{ 
                  border: `1px solid ${colors.border}`,
                  bgcolor: colors.bgCard,
                  borderRadius: 1
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: colors.textSecondary,
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontSize: '0.7rem'
                        }}
                      >
                        Medium Risk
                      </Typography>
                      <Typography 
                        variant="h3" 
                        sx={{ 
                          fontWeight: 600, 
                          mt: 1,
                          fontFamily: '"IBM Plex Mono", monospace',
                          color: '#fd7e14'
                        }}
                      >
                        {mediumRiskCount}
                      </Typography>
                    </Box>
                    <Box 
                      sx={{ 
                        p: 1.5, 
                        bgcolor: colors.warningBg, 
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Assessment sx={{ color: colors.warningText, fontSize: 24 }} />
                    </Box>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={(mediumRiskCount / accounts.length) * 100}
                    sx={{ 
                      mt: 2,
                      height: 4,
                      borderRadius: 2,
                      bgcolor: colors.warningBg,
                      '& .MuiLinearProgress-bar': {
                        bgcolor: '#fd7e14',
                        borderRadius: 2
                      }
                    }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card 
                elevation={0} 
                sx={{ 
                  border: `1px solid ${colors.border}`,
                  bgcolor: colors.bgCard,
                  borderRadius: 1
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: colors.textSecondary,
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontSize: '0.7rem'
                        }}
                      >
                        Clean Accounts
                      </Typography>
                      <Typography 
                        variant="h3" 
                        sx={{ 
                          fontWeight: 600, 
                          mt: 1,
                          fontFamily: '"IBM Plex Mono", monospace',
                          color: colors.success
                        }}
                      >
                        {cleanCount}
                      </Typography>
                    </Box>
                    <Box 
                      sx={{ 
                        p: 1.5, 
                        bgcolor: colors.successBg, 
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <CheckCircle sx={{ color: colors.successText, fontSize: 24 }} />
                    </Box>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={(cleanCount / accounts.length) * 100}
                    sx={{ 
                      mt: 2,
                      height: 4,
                      borderRadius: 2,
                      bgcolor: colors.successBg,
                      '& .MuiLinearProgress-bar': {
                        bgcolor: colors.success,
                        borderRadius: 2
                      }
                    }}
                  />
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Error Alert */}
          {error && (
            <Alert 
              severity="error" 
              onClose={() => setError(null)}
              sx={{ 
                borderRadius: 1,
                border: `1px solid ${colors.border}`
              }}
            >
              {error}
            </Alert>
          )}

          {/* Accounts Table */}
          <Card 
            elevation={0}
            sx={{ 
              border: `1px solid ${colors.border}`,
              bgcolor: colors.bgCard,
              borderRadius: 1
            }}
          >
            <CardContent sx={{ p: 0 }}>
              {/* Table Header */}
              <Box sx={{ p: 3, pb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography 
                    variant="h6" 
                    sx={{ 
                      fontWeight: 600,
                      color: colors.textPrimary,
                      fontFamily: '"IBM Plex Sans", system-ui, sans-serif'
                    }}
                  >
                    Account Analysis
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant={filterStatus === 'all' ? 'contained' : 'outlined'}
                      onClick={() => setFilterStatus('all')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        bgcolor: filterStatus === 'all' ? colors.primary : 'transparent',
                        color: filterStatus === 'all' ? '#fff' : colors.textSecondary,
                        borderColor: colors.border,
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: filterStatus === 'all' ? '#0a58ca' : colors.bgMain,
                          boxShadow: 'none'
                        }
                      }}
                    >
                      All ({accounts.length})
                    </Button>
                    <Button
                      size="small"
                      variant={filterStatus === 'flagged' ? 'contained' : 'outlined'}
                      onClick={() => setFilterStatus('flagged')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        bgcolor: filterStatus === 'flagged' ? colors.danger : 'transparent',
                        color: filterStatus === 'flagged' ? '#fff' : colors.textSecondary,
                        borderColor: colors.border,
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: filterStatus === 'flagged' ? '#bb2d3b' : colors.bgMain,
                          boxShadow: 'none'
                        }
                      }}
                    >
                      Flagged ({flaggedAccounts.size})
                    </Button>
                    <Button
                      size="small"
                      variant={filterStatus === 'clean' ? 'contained' : 'outlined'}
                      onClick={() => setFilterStatus('clean')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                        bgcolor: filterStatus === 'clean' ? colors.success : 'transparent',
                        color: filterStatus === 'clean' ? '#fff' : colors.textSecondary,
                        borderColor: colors.border,
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: filterStatus === 'clean' ? '#157347' : colors.bgMain,
                          boxShadow: 'none'
                        }
                      }}
                    >
                      Clean ({cleanCount})
                    </Button>
                  </Stack>
                </Stack>
              </Box>

              <Divider />

              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow sx={{ bgcolor: colors.bgMain }}>
                        <TableCell 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => handleSort('account_id')}
                        >
                          <Stack direction="row" alignItems="center">
                            Account ID
                            <SortIcon field="account_id" />
                          </Stack>
                        </TableCell>
                        <TableCell 
                          align="right" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => handleSort('total_credit')}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="flex-end">
                            Total Credit
                            <SortIcon field="total_credit" />
                          </Stack>
                        </TableCell>
                        <TableCell 
                          align="right" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => handleSort('total_debit')}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="flex-end">
                            Total Debit
                            <SortIcon field="total_debit" />
                          </Stack>
                        </TableCell>
                        <TableCell 
                          align="center" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => handleSort('pass_through_ratio')}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="center">
                            Pass-Through %
                            <SortIcon field="pass_through_ratio" />
                          </Stack>
                        </TableCell>
                        <TableCell 
                          align="center" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => handleSort('risk_score')}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="center">
                            Risk Score
                            <SortIcon field="risk_score" />
                          </Stack>
                        </TableCell>
                        <TableCell 
                          align="center" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary
                          }}
                        >
                          Status
                        </TableCell>
                        <TableCell 
                          align="center" 
                          sx={{ 
                            fontWeight: 600, 
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.textSecondary
                          }}
                        >
                          Actions
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredAccounts.map((account) => {
                        const isFlagged = flaggedAccounts.has(account.account_id);
                        const accountPatterns = patterns.filter(p => p.account_id === account.account_id);

                        return (
                          <TableRow 
                            key={account.account_id} 
                            hover
                            sx={{ 
                              cursor: 'pointer',
                              '&:hover': {
                                bgcolor: colors.bgMain
                              }
                            }}
                            onClick={() => onAccountSelect(account.account_id)}
                          >
                            <TableCell>
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  fontFamily: '"IBM Plex Mono", monospace',
                                  fontWeight: 500,
                                  fontSize: '0.875rem'
                                }}
                              >
                                {account.account_id}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography 
                                variant="body2"
                                sx={{ 
                                  fontFamily: '"IBM Plex Mono", monospace',
                                  fontSize: '0.875rem'
                                }}
                              >
                                ₹{(account.total_credit || 0).toLocaleString('en-IN')}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography 
                                variant="body2"
                                sx={{ 
                                  fontFamily: '"IBM Plex Mono", monospace',
                                  fontSize: '0.875rem'
                                }}
                              >
                                ₹{(account.total_debit || 0).toLocaleString('en-IN')}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip 
                                label={`${((account.pass_through_ratio || 0) * 100).toFixed(1)}%`}
                                size="small"
                                sx={{ 
                                  bgcolor: (account.pass_through_ratio || 0) > 0.8 ? colors.dangerBg : colors.successBg,
                                  color: (account.pass_through_ratio || 0) > 0.8 ? colors.dangerText : colors.successText,
                                  fontWeight: 600,
                                  fontFamily: '"IBM Plex Mono", monospace',
                                  fontSize: '0.75rem',
                                  borderRadius: 1
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Chip 
                                label={account.risk_score || 0}
                                size="small"
                                sx={{ 
                                  bgcolor: ['CRITICAL', 'HIGH'].includes(String(account.risk_level || '').toUpperCase()) ? colors.dangerBg : 
                                           account.risk_level === 'MEDIUM' ? colors.warningBg : colors.successBg,
                                  color: ['CRITICAL', 'HIGH'].includes(String(account.risk_level || '').toUpperCase()) ? colors.dangerText : 
                                         account.risk_level === 'MEDIUM' ? colors.warningText : colors.successText,
                                  fontWeight: 600,
                                  fontFamily: '"IBM Plex Mono", monospace',
                                  fontSize: '0.75rem',
                                  borderRadius: 1,
                                  minWidth: 50
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              {isFlagged ? (
                                <Tooltip title={accountPatterns.map(p => p.pattern_name).join(', ')}>
                                  <Chip 
                                    label="FLAGGED" 
                                    size="small"
                                    icon={<Warning sx={{ fontSize: 14 }} />}
                                    sx={{ 
                                      bgcolor: colors.dangerBg,
                                      color: colors.dangerText,
                                      fontWeight: 600,
                                      fontSize: '0.7rem',
                                      letterSpacing: '0.05em',
                                      borderRadius: 1
                                    }}
                                  />
                                </Tooltip>
                              ) : (
                                <Chip 
                                  label="CLEAN" 
                                  size="small"
                                  sx={{ 
                                    bgcolor: colors.successBg,
                                    color: colors.successText,
                                    fontWeight: 600,
                                    fontSize: '0.7rem',
                                    letterSpacing: '0.05em',
                                    borderRadius: 1
                                  }}
                                />
                              )}
                            </TableCell>
                            <TableCell align="center">
                              <Button 
                                size="small" 
                                variant="text"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAccountSelect(account.account_id);
                                }}
                                sx={{ 
                                  color: colors.primary,
                                  textTransform: 'none',
                                  fontWeight: 500,
                                  fontSize: '0.8125rem'
                                }}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </Box>
  );
};

export default MuleDashboard;
