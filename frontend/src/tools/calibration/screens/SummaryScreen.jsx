import React, { useState } from 'react';
import { 
  Box, Typography, Card, CardContent, Grid, Button, TextField, Chip, Divider, Alert, Stack
} from '@mui/material';
import { 
  ThumbUp as ApproveIcon, 
  ThumbDown as RejectIcon, 
  Print as PrintIcon 
} from '@mui/icons-material';
import { useCalibration } from '../context/CalibrationContext';
import PageContainer from '../layout/PageContainer';

const SummaryScreen = () => {
  const { run, approveRun, rejectRun, loading } = useCalibration();
  const [comment, setComment] = useState('');
  const [isFinalized, setIsFinalized] = useState(run?.status === 'APPROVED' || run?.status === 'REJECTED');

  const handleApprove = async () => {
    await approveRun(comment);
    setIsFinalized(true);
  };

  const handleReject = async () => {
    await rejectRun(comment);
    setIsFinalized(true);
  };

  return (
    <PageContainer 
      title="Step 5: Summary & Approval" 
      subtitle="Review calibration results and provide final sign-off."
      breadcrumbs={['Calibration', 'Summary']}
    >
      {run?.status === 'APPROVED' && (
        <Alert severity="success" sx={{ mb: 3 }}>
          This calibration run has been APPROVED by {run.approved_by} on {new Date(run.approved_at).toLocaleDateString()}.
        </Alert>
      )}
      
      {run?.status === 'REJECTED' && (
        <Alert severity="error" sx={{ mb: 3 }}>
          This calibration run was REJECTED by {run.approved_by}.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Final Configuration */}
        <Grid item xs={12} md={8}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Calibration Summary</Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={3}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Scenario Name</Typography>
                  <Typography variant="body1" fontWeight="bold">{run?.scenario_name}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Run ID</Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{run?.run_id}</Typography>
                </Grid>
                
                <Grid item xs={12}><Divider /></Grid>

                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Selected Threshold</Typography>
                  <Typography variant="h4" color="primary.main" fontWeight="bold">
                    ${run?.selected_threshold?.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Percentile</Typography>
                  <Typography variant="h4">
                    {run?.selected_percentile ? run.selected_percentile.toFixed(2) : '-'}th
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Est. Alert Volume</Typography>
                  <Typography variant="h4">
                    {run?.alert_count_at_threshold?.toLocaleString()}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Approval Action */}
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Sign-off
              </Typography>
              
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Approval/Rejection Comments"
                placeholder="Enter rationale for this threshold selection..."
                value={run?.approval_comment || comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isFinalized}
                sx={{ mb: 3 }}
              />

              {!isFinalized ? (
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Button 
                      fullWidth 
                      variant="contained" 
                      color="success" 
                      startIcon={<ApproveIcon />}
                      onClick={handleApprove}
                      disabled={loading}
                    >
                      Approve
                    </Button>
                  </Grid>
                  <Grid item xs={6}>
                    <Button 
                      fullWidth 
                      variant="outlined" 
                      color="error" 
                      startIcon={<RejectIcon />}
                      onClick={handleReject}
                      disabled={loading}
                    >
                      Reject
                    </Button>
                  </Grid>
                </Grid>
              ) : (
                <Button fullWidth variant="outlined" startIcon={<PrintIcon />} sx={{ mt: 2 }}>
                  Download Report PDF
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </PageContainer>
  );
};

export default SummaryScreen;