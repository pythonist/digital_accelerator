import React, { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, Grid, Card, CardContent, Button, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, LinearProgress, Tabs, Tab, Stack, Divider, IconButton, Tooltip
} from '@mui/material';
import {
  CloudUpload, CompareArrows, CheckCircle, Cancel, Help,
  Download, Refresh, TrendingUp, TrendingDown, Info
} from '@mui/icons-material';
import { useCalibration } from '../context/CalibrationContext';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '../layout/PageContainer';

const ComparisonScreen = () => {
  const { run } = useCalibration();
  const { activeEnv } = useAppContext();

  const [activeTab, setActiveTab] = useState(0);
  const [bankAlertsUploaded, setBankAlertsUploaded] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [comparisonResults, setComparisonResults] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [detailsCategory, setDetailsCategory] = useState('matched');
  const [detailsData, setDetailsData] = useState([]);

  useEffect(() => {
    checkBankAlertsStatus();
  }, [run?.run_id]);

  const checkBankAlertsStatus = async () => {
    if (!run?.run_id) return;
    try {
      const res = await apiClient.get(
        `/api/v2/calibration/comparison/${run.run_id}/status`,
        { params: { env_id: activeEnv } }
      );
      setBankAlertsUploaded(res.uploaded || false);
      if (res.comparison) {
        setComparisonResults(res.comparison);
      }
    } catch (err) {
      console.error("Status check failed", err);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    
    setUploadLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('env_id', activeEnv);

    try {
      const res = await apiClient.postForm(
        `/api/v2/calibration/comparison/${run.run_id}/upload-bank-alerts`,
        formData
      );
      
      setBankAlertsUploaded(true);
      setActiveTab(1); // Move to comparison tab
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleCompare = async () => {
    setComparisonLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/comparison/${run.run_id}/compare`,
        { env_id: activeEnv }
      );
      
      setComparisonResults(res.comparison);
      setActiveTab(1); // Show results
    } catch (err) {
      console.error("Comparison failed", err);
    } finally {
      setComparisonLoading(false);
    }
  };

  const loadDetails = async (category) => {
    setDetailsCategory(category);
    try {
      const res = await apiClient.get(
        `/api/v2/calibration/comparison/${run.run_id}/details`,
        { 
          params: { 
            env_id: activeEnv, 
            category,
            limit: 100 
          } 
        }
      );
      setDetailsData(res.details || []);
    } catch (err) {
      console.error("Details load failed", err);
    }
  };

  useEffect(() => {
    if (activeTab === 2 && comparisonResults) {
      loadDetails(detailsCategory);
    }
  }, [activeTab, detailsCategory]);

  return (
    <PageContainer
      title="Step 5: Bank Alert Comparison (Future Scope)"
      subtitle="Compare tool-generated alerts with actual bank alerts"
    >
      
      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2" fontWeight="bold" gutterBottom>
          Future Scope Feature
        </Typography>
        <Typography variant="caption">
          This feature allows you to validate calibration results against actual bank alerts.
          Upload your bank's alert master file to perform a detailed comparison analysis.
        </Typography>
      </Alert>

      <Paper sx={{ mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(e, v) => setActiveTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label="1. Upload Bank Alerts" icon={<CloudUpload fontSize="small"/>} iconPosition="start" />
          <Tab 
            label="2. Comparison Results" 
            icon={<CompareArrows fontSize="small"/>} 
            iconPosition="start"
            disabled={!bankAlertsUploaded}
          />
          <Tab 
            label="3. Detailed Analysis" 
            icon={<Info fontSize="small"/>} 
            iconPosition="start"
            disabled={!comparisonResults}
          />
        </Tabs>

        {/* TAB 1: UPLOAD */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Upload Bank Alert Master File
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Upload a CSV file containing your bank's alerts. Required columns: alert_id, account_id, alert_date
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom fontWeight="bold">
                      Expected File Format
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Column</TableCell>
                          <TableCell>Description</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell><code>alert_id</code></TableCell>
                          <TableCell>Unique alert identifier</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>account_id</code></TableCell>
                          <TableCell>Account identifier</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>alert_date</code></TableCell>
                          <TableCell>Alert generation date</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell><code>alert_amount</code></TableCell>
                          <TableCell>Transaction amount (optional)</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card 
                  variant="outlined" 
                  sx={{ 
                    height: '100%',
                    bgcolor: bankAlertsUploaded ? 'success.50' : 'background.paper',
                    borderColor: bankAlertsUploaded ? 'success.main' : 'divider'
                  }}
                >
                  <CardContent>
                    <Stack spacing={2}>
                      {bankAlertsUploaded ? (
                        <>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CheckCircle color="success" />
                            <Typography variant="subtitle2" fontWeight="bold">
                              Bank Alerts Uploaded
                            </Typography>
                          </Box>
                          <Button
                            variant="outlined"
                            component="label"
                            fullWidth
                          >
                            Replace File
                            <input
                              type="file"
                              accept=".csv"
                              hidden
                              onChange={(e) => handleFileUpload(e.target.files[0])}
                            />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Typography variant="subtitle2" fontWeight="bold">
                            Upload Alert Master
                          </Typography>
                          {uploadLoading ? (
                            <LinearProgress />
                          ) : (
                            <Button
                              variant="contained"
                              component="label"
                              startIcon={<CloudUpload />}
                              fullWidth
                              size="large"
                            >
                              Select CSV File
                              <input
                                type="file"
                                accept=".csv"
                                hidden
                                onChange={(e) => handleFileUpload(e.target.files[0])}
                              />
                            </Button>
                          )}
                        </>
                      )}

                      {bankAlertsUploaded && (
                        <Button
                          variant="contained"
                          color="primary"
                          fullWidth
                          size="large"
                          onClick={handleCompare}
                          disabled={comparisonLoading}
                          startIcon={comparisonLoading ? <CircularProgress size={20} /> : <CompareArrows />}
                        >
                          {comparisonLoading ? 'Comparing...' : 'Run Comparison'}
                        </Button>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* TAB 2: COMPARISON RESULTS */}
        {activeTab === 1 && comparisonResults && (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Comparison Overview
            </Typography>
            
            {/* Metrics Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={3}>
                <Card sx={{ bgcolor: 'success.50', border: '1px solid', borderColor: 'success.main' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <CheckCircle color="success" fontSize="small" />
                      <Typography variant="caption" color="text.secondary" fontWeight="bold">
                        MATCHED ALERTS
                      </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight="bold" color="success.dark">
                      {comparisonResults.matched_count?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Both tool and bank generated
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ bgcolor: 'warning.50', border: '1px solid', borderColor: 'warning.main' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <TrendingUp color="warning" fontSize="small" />
                      <Typography variant="caption" color="text.secondary" fontWeight="bold">
                        TOOL ONLY
                      </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight="bold" color="warning.dark">
                      {comparisonResults.tool_only_count?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Missed by bank's current rule
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ bgcolor: 'error.50', border: '1px solid', borderColor: 'error.main' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <TrendingDown color="error" fontSize="small" />
                      <Typography variant="caption" color="text.secondary" fontWeight="bold">
                        BANK ONLY
                      </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight="bold" color="error.dark">
                      {comparisonResults.bank_only_count?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Tool would reduce these alerts
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ bgcolor: 'info.50', border: '1px solid', borderColor: 'info.main' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Info color="info" fontSize="small" />
                      <Typography variant="caption" color="text.secondary" fontWeight="bold">
                        TOTAL BANK ALERTS
                      </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight="bold" color="info.dark">
                      {comparisonResults.total_bank_alerts?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Original alert volume
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Performance Metrics */}
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Performance Metrics
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                        Precision (Tool Accuracy)
                      </Typography>
                      <Typography variant="h4" fontWeight="bold" color="primary.main">
                        {comparisonResults.precision}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Of tool alerts, {comparisonResults.precision}% match bank
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                        Recall (Coverage)
                      </Typography>
                      <Typography variant="h4" fontWeight="bold" color="secondary.main">
                        {comparisonResults.recall}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tool catches {comparisonResults.recall}% of bank alerts
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                        F1-Score (Balance)
                      </Typography>
                      <Typography variant="h4" fontWeight="bold" color="success.main">
                        {comparisonResults.f1_score}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Harmonic mean of precision & recall
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Alert Volume Comparison */}
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Alert Volume Impact
                </Typography>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Current Bank Alerts (Monthly)</TableCell>
                      <TableCell align="right">
                        <Chip label={comparisonResults.total_bank_alerts?.toLocaleString()} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Tool Recommended Alerts</TableCell>
                      <TableCell align="right">
                        <Chip 
                          label={comparisonResults.tool_alert_count?.toLocaleString()} 
                          color="primary"
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><strong>Net Change</strong></TableCell>
                      <TableCell align="right">
                        <Chip 
                          label={`${comparisonResults.volume_change > 0 ? '+' : ''}${comparisonResults.volume_change?.toLocaleString()} (${comparisonResults.volume_change_pct}%)`}
                          color={comparisonResults.volume_change < 0 ? 'success' : 'warning'}
                        />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Box sx={{ mt: 3, textAlign: 'right' }}>
              <Button
                variant="contained"
                onClick={() => setActiveTab(2)}
                endIcon={<Info />}
              >
                View Detailed Analysis
              </Button>
            </Box>
          </Box>
        )}

        {/* TAB 3: DETAILED ANALYSIS */}
        {activeTab === 2 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
              <Chip
                label="Matched Alerts"
                onClick={() => loadDetails('matched')}
                color={detailsCategory === 'matched' ? 'success' : 'default'}
                variant={detailsCategory === 'matched' ? 'filled' : 'outlined'}
                clickable
              />
              <Chip
                label="Tool Only (New Detections)"
                onClick={() => loadDetails('tool_only')}
                color={detailsCategory === 'tool_only' ? 'warning' : 'default'}
                variant={detailsCategory === 'tool_only' ? 'filled' : 'outlined'}
                clickable
              />
              <Chip
                label="Bank Only (Reduced Alerts)"
                onClick={() => loadDetails('bank_only')}
                color={detailsCategory === 'bank_only' ? 'error' : 'default'}
                variant={detailsCategory === 'bank_only' ? 'filled' : 'outlined'}
                clickable
              />
            </Box>

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Account ID</TableCell>
                    <TableCell>Alert Date</TableCell>
                    <TableCell>Tool Threshold</TableCell>
                    <TableCell>Bank Threshold</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detailsData.length > 0 ? (
                    detailsData.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.account_id}</TableCell>
                        <TableCell>{row.alert_date}</TableCell>
                        <TableCell>₹{row.tool_threshold?.toLocaleString()}</TableCell>
                        <TableCell>{row.bank_threshold ? `₹${row.bank_threshold.toLocaleString()}` : 'N/A'}</TableCell>
                        <TableCell>₹{row.amount?.toLocaleString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={row.match_type}
                            size="small"
                            color={
                              row.match_type === 'matched' ? 'success' :
                              row.match_type === 'tool_only' ? 'warning' : 'error'
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        No data available
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ mt: 3 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export Detailed Report
              </Button>
            </Box>
          </Box>
        )}
      </Paper>
    </PageContainer>
  );
};

export default ComparisonScreen;