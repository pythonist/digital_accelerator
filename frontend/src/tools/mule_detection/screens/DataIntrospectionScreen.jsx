// frontend/src/tools/mule_detection/screens/DataIntrospectionScreen.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Grid, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert, CircularProgress, LinearProgress
} from '@mui/material';
import {
  CalendarToday, Assessment, SwapHoriz, Warning, CheckCircle
} from '@mui/icons-material';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';

const DataIntrospectionScreen = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [introspection, setIntrospection] = useState(null);

  useEffect(() => {
    loadIntrospection();
  }, []);

  const loadIntrospection = async () => {
    setLoading(true);
    setError(null);

    try {
      // ✅ FIXED: Use muleApi.getIntrospection() instead of muleApi.get()
      const response = await muleApi.getIntrospection();
      
      if (response.success) {
        setIntrospection(response.introspection);
      } else {
        setError(response.error || 'Failed to load introspection data');
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
        <CircularProgress sx={{ color: pwcColors.primary }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const { 
    total_transactions, 
    total_accounts, 
    date_range, 
    columns, 
    credit_debit_split,
    channel_distribution,
    missing_data
  } = introspection;

  const totalMissing = Object.values(missing_data).reduce((sum, val) => sum + val, 0);
  const dataQuality = totalMissing === 0 ? 100 : ((total_transactions - totalMissing) / total_transactions * 100);

  return (
    <Box sx={{ p: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>
          Dataset Introspection
        </Typography>

        <Alert severity="info" icon={<Assessment />}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Understanding Your Data
          </Typography>
          <Typography variant="caption">
            Review data coverage, quality, and distribution before analysis
          </Typography>
        </Alert>

        {/* Overview Metrics */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Card elevation={0}>
              <CardContent>
                <Stack spacing={1}>
                  <Assessment sx={{ color: pwcColors.primary, fontSize: 32 }} />
                  <Typography variant="h4" fontWeight={700}>
                    {total_transactions.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Total Transactions
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={3}>
            <Card elevation={0}>
              <CardContent>
                <Stack spacing={1}>
                  <Assessment sx={{ color: '#0284c7', fontSize: 32 }} />
                  <Typography variant="h4" fontWeight={700}>
                    {total_accounts.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Unique Accounts
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={3}>
            <Card elevation={0}>
              <CardContent>
                <Stack spacing={1}>
                  <CalendarToday sx={{ color: '#059669', fontSize: 32 }} />
                  <Typography variant="h4" fontWeight={700}>
                    {date_range.days}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Days of Data
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={3}>
            <Card elevation={0}>
              <CardContent>
                <Stack spacing={1}>
                  {dataQuality === 100 ? (
                    <CheckCircle sx={{ color: pwcColors.successText, fontSize: 32 }} />
                  ) : (
                    <Warning sx={{ color: pwcColors.warningText, fontSize: 32 }} />
                  )}
                  <Typography variant="h4" fontWeight={700}>
                    {dataQuality.toFixed(1)}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Data Quality
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Date Range */}
        <Card elevation={0}>
          <CardContent>
            <Typography variant="h6" gutterBottom fontWeight={600}>
              Date Coverage
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">START DATE</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {new Date(date_range.start).toLocaleDateString()}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">END DATE</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {new Date(date_range.end).toLocaleDateString()}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Credit/Debit Split */}
        <Card elevation={0}>
          <CardContent>
            <Typography variant="h6" gutterBottom fontWeight={600}>
              Credit vs Debit Distribution
            </Typography>
            
            <Stack spacing={2}>
              <Box>
                <Stack direction="row" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Credits
                  </Typography>
                  <Typography variant="caption" fontWeight={600}>
                    {credit_debit_split.credit_count.toLocaleString()} txns | ${credit_debit_split.credit_amount.toLocaleString()}
                  </Typography>
                </Stack>
                <LinearProgress 
                  variant="determinate" 
                  value={(credit_debit_split.credit_count / total_transactions) * 100}
                  sx={{ 
                    height: 8, 
                    bgcolor: '#e0e0e0',
                    '& .MuiLinearProgress-bar': { bgcolor: pwcColors.successText }
                  }}
                />
              </Box>

              <Box>
                <Stack direction="row" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Debits
                  </Typography>
                  <Typography variant="caption" fontWeight={600}>
                    {credit_debit_split.debit_count.toLocaleString()} txns | ${credit_debit_split.debit_amount.toLocaleString()}
                  </Typography>
                </Stack>
                <LinearProgress 
                  variant="determinate" 
                  value={(credit_debit_split.debit_count / total_transactions) * 100}
                  sx={{ 
                    height: 8, 
                    bgcolor: '#e0e0e0',
                    '& .MuiLinearProgress-bar': { bgcolor: pwcColors.errorText }
                  }}
                />
              </Box>
            </Stack>

            <Box sx={{ mt: 3, p: 2, bgcolor: '#f8fafc', borderRadius: 1 }}>
              <Stack direction="row" justifyContent="space-around">
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    Credit %
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {((credit_debit_split.credit_count / total_transactions) * 100).toFixed(1)}%
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    Debit %
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {((credit_debit_split.debit_count / total_transactions) * 100).toFixed(1)}%
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    Net Flow
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    ${(credit_debit_split.credit_amount - credit_debit_split.debit_amount).toLocaleString()}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </CardContent>
        </Card>

        {/* Channel Distribution */}
        <Card elevation={0}>
          <CardContent>
            <Typography variant="h6" gutterBottom fontWeight={600}>
              Channel Distribution
            </Typography>
            
            {Object.keys(channel_distribution).length === 0 ? (
              <Alert severity="info">Channel information not available</Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Count</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Percentage</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(channel_distribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([channel, count]) => (
                        <TableRow key={channel} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>
                              {channel}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {count.toLocaleString()}
                          </TableCell>
                          <TableCell align="right">
                            <Chip 
                              label={`${((count / total_transactions) * 100).toFixed(1)}%`}
                              size="small"
                              variant="outlined"
                              sx={{ fontWeight: 600 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* Data Quality */}
        <Card elevation={0}>
          <CardContent>
            <Typography variant="h6" gutterBottom fontWeight={600}>
              Data Quality Assessment
            </Typography>
            
            {totalMissing === 0 ? (
              <Alert severity="success" icon={<CheckCircle />}>
                <Typography variant="body2" fontWeight={600}>
                  Excellent Data Quality
                </Typography>
                <Typography variant="caption">
                  No missing values detected across all columns
                </Typography>
              </Alert>
            ) : (
              <>
                <Alert severity="warning" icon={<Warning />} sx={{ mb: 2 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {totalMissing.toLocaleString()} Missing Values Detected
                  </Typography>
                  <Typography variant="caption">
                    Some columns have incomplete data
                  </Typography>
                </Alert>

                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f8fafc' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Column</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Missing</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Completeness</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(missing_data)
                        .filter(([_, count]) => count > 0)
                        .map(([column, count]) => (
                          <TableRow key={column} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>
                                {column}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="error">
                                {count.toLocaleString()}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Chip 
                                label={`${(((total_transactions - count) / total_transactions) * 100).toFixed(1)}%`}
                                size="small"
                                sx={{ 
                                  bgcolor: count > (total_transactions * 0.1) ? pwcColors.errorBg : pwcColors.warningBg,
                                  color: count > (total_transactions * 0.1) ? pwcColors.errorText : pwcColors.warningText,
                                  fontWeight: 600
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </CardContent>
        </Card>

        {/* Column Schema */}
        <Card elevation={0}>
          <CardContent>
            <Typography variant="h6" gutterBottom fontWeight={600}>
              Column Schema
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {columns.map((col) => (
                <Chip 
                  key={col}
                  label={col}
                  size="small"
                  sx={{ 
                    bgcolor: '#f8fafc',
                    fontFamily: 'monospace',
                    fontWeight: 500
                  }}
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

export default DataIntrospectionScreen;