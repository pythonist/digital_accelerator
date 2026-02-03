import React, { useState, useEffect } from 'react';
import {
  Box, Button, Card, CardContent, Divider, Typography, 
  TextField, Alert, Stack, LinearProgress, Chip, Grid
} from '@mui/material';
import {
  CheckCircle, Cancel, Lock, Info
} from '@mui/icons-material';
import { useCalibration } from "../context/CalibrationContext";
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '../layout/PageContainer';

const ApprovalScreen = () => {
  // ✅ Get approveRun and rejectRun from context (handles navigation automatically)
  const { run, runId, loadRun, approveRun, rejectRun } = useCalibration();
  const { activeEnv, currentUser } = useAppContext();
  
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rationale, setRationale] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isApproved = run?.status === 'approved';
  const isRejected = run?.status === 'rejected';
  const isLocked = isApproved || isRejected;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  // Load run if we have runId but no run object
  useEffect(() => {
    console.log('🔍 [Approval] Screen mounted with:', { 
      runId, 
      hasRun: !!run, 
      runStatus: run?.status 
    });

    if (runId && !run) {
      console.log('🔄 [Approval] Loading run from runId:', runId);
      loadRun(runId);
    }
  }, [runId, run, loadRun]);

  // Fetch report data when runId is available
  useEffect(() => {
    if (!runId) {
      console.log('⚠️ [Approval] No runId available');
      return;
    }

    console.log('📊 [Approval] Fetching report data for runId:', runId);
    fetchReportData();
  }, [runId, activeEnv]);

  // ============================================================================
  // DATA LOADING
  // ============================================================================
  
  const fetchReportData = async () => {
    setLoading(true);
    try {
      console.log('🔍 [Approval] API Call:', `/api/v2/calibration/report/${runId}/full`);
      
      const res = await apiClient.get(
        `/api/v2/calibration/report/${runId}/full`,
        { params: { env_id: activeEnv } }
      );
      
      console.log('✅ [Approval] Report data loaded');
      setReportData(res.report);
      
      // Pre-fill rationale if exists
      if (res.report?.governance?.approval_comment) {
        setRationale(res.report.governance.approval_comment);
        console.log('✓ [Approval] Pre-filled existing rationale');
      }
    } catch (err) {
      console.error("❌ [Approval] Failed to load report data:", err);
      console.error("Error details:", err.response?.data);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // APPROVAL ACTIONS
  // ============================================================================
  
  /**
   * Approve calibration - uses context method which auto-navigates to summary
   */
  const handleApprove = async () => {
    if (!rationale.trim()) {
      alert("Please provide a rationale for approval");
      return;
    }

    console.log('✅ [Approval] Approving run with rationale');
    setActionLoading(true);
    
    try {
      // ✅ Use context's approveRun - it handles navigation automatically
      await approveRun(rationale);
      
      // Refresh data
      await loadRun(runId);
      await fetchReportData();
      
      console.log('✅ [Approval] Run approved successfully');
      console.log('🔄 [Navigation] Context will navigate to: summary');
      
      alert("✅ Calibration approved and locked!");
      
    } catch (err) {
      console.error("❌ [Approval] Approval failed:", err);
      alert(`Approval failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Reject calibration - uses context method which auto-navigates to scenario
   */
  const handleReject = async () => {
    if (!rationale.trim()) {
      alert("Please provide a reason for rejection");
      return;
    }

    console.log('❌ [Approval] Rejecting run with reason');
    setActionLoading(true);
    
    try {
      // ✅ Use context's rejectRun - it handles navigation automatically
      await rejectRun(rationale);
      
      // Refresh data
      await loadRun(runId);
      await fetchReportData();
      
      console.log('✅ [Approval] Run rejected successfully');
      console.log('🔄 [Navigation] Context will navigate to: scenario');
      
      alert("❌ Calibration rejected");
      
    } catch (err) {
      console.error("❌ [Approval] Rejection failed:", err);
      alert(`Rejection failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  
  if (loading) {
    return (
      <PageContainer title="Approval & Governance">
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <LinearProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Loading calibration summary...
          </Typography>
        </Box>
      </PageContainer>
    );
  }

  if (!reportData) {
    return (
      <PageContainer title="Approval & Governance">
        <Alert severity="warning">
          Report data not available. RunId: {runId || 'undefined'}
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer 
      title={isLocked ? "Calibration Report (Locked)" : "Calibration Approval"} 
      subtitle="Final review and governance sign-off"
    >
      <Stack spacing={3}>
        
        {/* Status Banner */}
        {isApproved && (
          <Alert severity="success" icon={<Lock />} variant="filled">
            <Typography variant="body2">
              <strong>APPROVED</strong> by {run.approved_by} on {new Date(run.approved_at).toLocaleDateString()}
            </Typography>
            <Typography variant="caption">
              This calibration is immutable and ready for production deployment.
            </Typography>
          </Alert>
        )}
        
        {isRejected && (
          <Alert severity="error" variant="filled">
            <Typography variant="body2">
              <strong>REJECTED:</strong> {run.approval_comment}
            </Typography>
            <Typography variant="caption">
              Please recalibrate and resubmit.
            </Typography>
          </Alert>
        )}

        {/* Calibration Summary */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Calibration Summary
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">
                  SCENARIO
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {reportData.meta?.scenario}
                </Typography>
              </Grid>
              
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">
                  SELECTED THRESHOLD
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  ₹{reportData.threshold_analysis?.selected_threshold?.toLocaleString()}
                </Typography>
                <Chip 
                  label={`p${reportData.threshold_analysis?.selected_percentile}`} 
                  size="small" 
                  color="primary"
                  sx={{ mt: 0.5 }}
                />
              </Grid>
              
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">
                  ESTIMATED IMPACT
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {reportData.threshold_analysis?.estimated_alerts?.toLocaleString()} alerts/mo
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  ({reportData.threshold_analysis?.pct_flagged}% of population)
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Evidence Summary */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Calibration Evidence
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Stack spacing={2}>
              {/* Data Foundation */}
              <Box>
                <Typography variant="subtitle2" color="primary">
                  Step 0: Data Foundation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {reportData.data_foundation?.total_transactions?.toLocaleString()} transactions loaded with {reportData.data_foundation?.account_match_rate}% account match rate
                </Typography>
              </Box>
              
              {/* Scenario Definition */}
              <Box>
                <Typography variant="subtitle2" color="primary">
                  Step 1: Scenario Definition
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Applied {reportData.scenario_analysis?.filters_applied?.length || 0} filters, reducing population from {reportData.scenario_analysis?.original_count?.toLocaleString()} to {reportData.scenario_analysis?.final_count?.toLocaleString()} ({reportData.scenario_analysis?.reduction_pct}% reduction)
                </Typography>
              </Box>
              
              {/* Aggregation */}
              <Box>
                <Typography variant="subtitle2" color="primary">
                  Step 2: Aggregation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Transformed {reportData.aggregation_analysis?.input_rows?.toLocaleString()} transactions into {reportData.aggregation_analysis?.output_rows?.toLocaleString()} behavioral aggregates ({reportData.aggregation_analysis?.compression_ratio}:1 compression)
                </Typography>
              </Box>
              
              {/* Threshold Selection */}
              <Box>
                <Typography variant="subtitle2" color="primary">
                  Step 3: Threshold Calibration
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Selected {reportData.threshold_analysis?.selected_percentile}th percentile threshold using {reportData.threshold_analysis?.selection_method}
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Governance Panel */}
        <Card sx={{ 
          border: '2px solid', 
          borderColor: isLocked ? 'grey.300' : 'primary.main',
          bgcolor: isLocked ? 'grey.50' : 'primary.50'
        }}>
          <CardContent>
            <Typography variant="h6" gutterBottom color={isLocked ? 'text.primary' : 'primary.main'}>
              {isLocked ? "Approval Record" : "Governance Decision"}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Box mb={3}>
              <Typography variant="subtitle2" gutterBottom>
                Decision Rationale & Comments
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={4}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                disabled={isLocked}
                placeholder="Explain why this threshold should be approved (e.g., 'Aligned with risk appetite and regulatory requirements')"
                sx={{ bgcolor: 'background.paper' }}
              />
            </Box>

            {!isLocked ? (
              <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button 
                  variant="outlined" 
                  color="error" 
                  startIcon={<Cancel />}
                  onClick={handleReject}
                  disabled={actionLoading || !rationale.trim()}
                >
                  Reject
                </Button>
                <Button 
                  variant="contained" 
                  color="primary" 
                  startIcon={<CheckCircle />}
                  onClick={handleApprove}
                  disabled={actionLoading || !rationale.trim()}
                >
                  {actionLoading ? 'Processing...' : 'Approve & Lock'}
                </Button>
              </Stack>
            ) : (
              <Alert severity="info" icon={<Info />}>
                <Typography variant="body2">
                  This calibration is locked. To make changes, create a new calibration run.
                </Typography>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Why This Matters */}
        {!isLocked && (
          <Card variant="outlined" sx={{ bgcolor: 'warning.50', borderColor: 'warning.main' }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                📋 Why Approval Matters
              </Typography>
              <Typography variant="body2" component="div">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Creates immutable audit trail for regulators</li>
                  <li>Establishes accountability for threshold decisions</li>
                  <li>Documents business rationale for model governance</li>
                  <li>Locks configuration to prevent unauthorized changes</li>
                </ul>
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>
    </PageContainer>
  );
};

export default ApprovalScreen;