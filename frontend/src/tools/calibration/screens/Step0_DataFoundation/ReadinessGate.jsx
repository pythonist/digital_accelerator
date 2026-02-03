// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/ReadinessGate.jsx
// ============================================================================
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Alert, Stack,
  List, ListItem, ListItemIcon, ListItemText, CircularProgress,
  Chip, Divider, Dialog, DialogContent, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, LinearProgress, Grid
} from '@mui/material';
import {
  CheckCircle, Warning, Info, Error as ErrorIcon, ArrowForward,
  CloudUpload, Refresh, Storage, AccountTree, Assessment,TableChart
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import apiClient from '@services/api';
import { useCalibration } from '../../context/CalibrationContext';

const ReadinessGate = ({ envId, onComplete }) => {
  const [validationData, setValidationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  
  const { completeStep0, goToStep } = useCalibration();

  useEffect(() => {
    loadValidationData();
  }, [envId]);

  const loadValidationData = async () => {
    console.log('🔍 [VALIDATION] Loading validation data...');
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/v2/calibration/data/validation/preview', {
        params: { env_id: envId }
      });

      console.log('✅ [VALIDATION] Data loaded:', response);
      setValidationData(response);
    } catch (err) {
      console.error('❌ [VALIDATION] Load failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteStep0 = async () => {
    console.log('🎯 [VALIDATION] Completing Step 0...');
    setCompleting(true);
    setError(null);

    try {
      const activePlan = validationData?.active_plan;
      
      if (!activePlan) {
        throw new Error('No active join plan found. Please create a join plan first.');
      }

      console.log('📊 [VALIDATION] Using plan ID:', activePlan.plan_id);

      const response = await completeStep0(null, activePlan.plan_id);
      
      console.log('✅ [VALIDATION] Step 0 complete:', response);
      
      setShowSuccessDialog(true);
      
    } catch (err) {
      console.error('❌ [VALIDATION] Completion failed:', err);
      setError(err.message || 'Failed to complete Step 0');
      alert(`Failed to complete Step 0: ${err.message}`);
    } finally {
      setCompleting(false);
    }
  };

  const handleProceedToStep1 = () => {
    console.log('🚀 [VALIDATION] Proceeding to Step 1...');
    setShowSuccessDialog(false);
    
    // The completeStep0 function already navigates to 'scenario', 
    // so we don't need to call goToStep again here.
    // Just trigger the onComplete callback if provided
    if (onComplete) {
      onComplete();
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
        <CircularProgress size={48} sx={{ color: '#D04A02' }} />
        <Typography variant="body2" sx={{ mt: 2, color: '#64748b' }}>
          Validating data foundation...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" action={
        <Button color="inherit" size="small" onClick={loadValidationData}>
          Retry
        </Button>
      }>
        {error}
      </Alert>
    );
  }

  const { readiness, active_plan, summary, datasets } = validationData || {};
  const { ready, checks, blockers, warnings, recommendations } = readiness || {};

  return (
    <Box>
      {/* Overall Status Banner */}
      <Card 
        component={motion.div}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        elevation={0}
        sx={{ 
          mb: 3,
          bgcolor: ready ? '#ecfdf5' : '#fef3c7',
          border: `2px solid ${ready ? '#10b981' : '#f59e0b'}`,
          borderRadius: 2
        }}
      >
        <CardContent>
          <Stack direction="row" spacing={3} alignItems="center">
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: ready ? '#10b981' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {ready ? (
                <CheckCircle sx={{ fontSize: 32, color: '#ffffff' }} />
              ) : (
                <Warning sx={{ fontSize: 32, color: '#ffffff' }} />
              )}
            </Box>
            
            <Box sx={{ flex: 1 }}>
              <Typography variant="h5" fontWeight={600} sx={{ color: ready ? '#065f46' : '#92400e' }}>
                {ready ? 'Data Foundation Complete' : 'Action Required'}
              </Typography>
              <Typography variant="body2" sx={{ color: ready ? '#047857' : '#b45309', mt: 0.5 }}>
                {ready 
                  ? 'All validation checks passed. Ready to proceed to calibration workflow.'
                  : 'Please complete the following requirements before proceeding.'}
              </Typography>
            </Box>

            {ready && (
              <Button
                variant="contained"
                size="large"
                endIcon={<ArrowForward />}
                onClick={handleCompleteStep0}
                disabled={completing}
                sx={{
                  bgcolor: '#D04A02',
                  '&:hover': { bgcolor: '#B23D01' },
                  px: 4,
                  py: 1.5,
                  fontWeight: 600
                }}
              >
                {completing ? 'Processing...' : 'Proceed to Population Exploration'}
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card 
        component={motion.div}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        sx={{ mb: 3 }} 
        elevation={0}
      >
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom sx={{ color: '#1e293b' }}>
            Data Foundation Summary
          </Typography>
          
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Storage sx={{ fontSize: 20, color: '#D04A02' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={500}>
                    Datasets Uploaded
                  </Typography>
                </Stack>
                <Typography variant="h4" fontWeight={700} sx={{ color: '#D04A02' }}>
                  {summary?.datasets || 0}
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Assessment sx={{ fontSize: 20, color: '#0284c7' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={500}>
                    Total Rows
                  </Typography>
                </Stack>
                <Typography variant="h4" fontWeight={700} sx={{ color: '#0284c7' }}>
                  {(summary?.total_rows || 0).toLocaleString()}
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TableChart sx={{ fontSize: 20, color: '#059669' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={500}>
                    Total Columns
                  </Typography>
                </Stack>
                <Typography variant="h4" fontWeight={700} sx={{ color: '#059669' }}>
                  {summary?.total_columns || 0}
                </Typography>
              </Stack>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <AccountTree sx={{ fontSize: 20, color: '#7c3aed' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={500}>
                    Join Plans
                  </Typography>
                </Stack>
                <Typography variant="h4" fontWeight={700} sx={{ color: '#7c3aed' }}>
                  {summary?.join_plans || 0}
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Join Configuration */}
      {active_plan && (
        <Card 
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          sx={{ mb: 3 }}
          elevation={0}
        >
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom sx={{ color: '#1e293b' }}>
              Join Configuration
            </Typography>
            
            <Box sx={{ mt: 2, p: 2, bgcolor: '#f8fafc', borderRadius: 1, border: '1px solid #e2e8f0' }}>
              <Typography variant="subtitle2" fontWeight={600} mb={2} sx={{ color: '#475569' }}>
                {active_plan.plan_name}
              </Typography>
              
              {active_plan.chain && active_plan.chain.map((step, index) => (
                <Box 
                  key={index}
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 2, 
                    mb: 1.5,
                    pl: index * 2
                  }}
                >
                  {index === 0 ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Storage sx={{ fontSize: 16, color: '#64748b' }} />
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', color: '#334155', fontWeight: 500 }}>
                        Base: {datasets?.find(d => d.id === step.dataset_id)?.name || 'Dataset'}
                      </Typography>
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <ArrowForward sx={{ fontSize: 16, color: '#64748b' }} />
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', color: '#334155' }}>
                        <Box component="span" sx={{ fontWeight: 600, color: '#D04A02' }}>
                          {step.join_type}
                        </Box>
                        {' '}{datasets?.find(d => d.id === step.dataset_id)?.name || 'Dataset'}
                        {step.left_on && (
                          <Box component="span" sx={{ color: '#64748b' }}>
                            {' '}ON {step.left_on} = {step.right_on}
                          </Box>
                        )}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Validation Checks */}
      <Card 
        component={motion.div}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        sx={{ mb: 3 }} 
        elevation={0}
      >
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom sx={{ color: '#1e293b' }}>
            Validation Checks
          </Typography>

          <List>
            {Object.entries(checks || {}).map(([key, value], index) => (
              <React.Fragment key={key}>
                {index > 0 && <Divider variant="inset" component="li" />}
                <ListItem>
                  <ListItemIcon>
                    {value ? (
                      <CheckCircle sx={{ color: '#10b981' }} />
                    ) : (
                      <ErrorIcon sx={{ color: '#ef4444' }} />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    secondary={value ? 'Complete' : 'Incomplete'}
                    primaryTypographyProps={{ fontWeight: 600, color: '#334155' }}
                    secondaryTypographyProps={{ color: value ? '#059669' : '#dc2626' }}
                  />
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        </CardContent>
      </Card>

      {/* Data Preview */}
      {active_plan?.preview && (
        <Card 
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          elevation={0}
        >
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom sx={{ color: '#1e293b' }}>
              Logical View Preview
            </Typography>
            
            <TableContainer sx={{ maxHeight: 400, mt: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {active_plan.preview.columns.slice(0, 10).map((col, i) => (
                      <TableCell 
                        key={i} 
                        sx={{ 
                          fontWeight: 600, 
                          bgcolor: '#f8fafc',
                          borderBottom: '2px solid #e2e8f0',
                          color: '#475569'
                        }}
                      >
                        {col}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {active_plan.preview.rows.slice(0, 10).map((row, i) => (
                    <TableRow key={i} hover>
                      {active_plan.preview.columns.slice(0, 10).map((col, j) => (
                        <TableCell 
                          key={j} 
                          sx={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.75rem',
                            color: '#334155'
                          }}
                        >
                          {String(row[col] || '').substring(0, 30)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Warnings & Blockers */}
      {blockers && blockers.length > 0 && (
        <Alert severity="error" sx={{ mt: 3 }} icon={<ErrorIcon />}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Blockers
          </Typography>
          <List dense>
            {blockers.map((blocker, i) => (
              <ListItem key={i} sx={{ py: 0 }}>
                <ListItemText primary={`• ${blocker}`} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      {warnings && warnings.length > 0 && (
        <Alert severity="warning" sx={{ mt: 3 }} icon={<Warning />}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Warnings
          </Typography>
          <List dense>
            {warnings.map((warning, i) => (
              <ListItem key={i} sx={{ py: 0 }}>
                <ListItemText primary={`• ${warning}`} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      {/* Refresh Button */}
      <Box sx={{ textAlign: 'center', mt: 4 }}>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={loadValidationData}
          sx={{ borderColor: '#cbd5e1', color: '#64748b' }}
        >
          Refresh Validation
        </Button>
      </Box>

      {/* Success Dialog */}
      <Dialog
        open={showSuccessDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            border: '1px solid #e2e8f0'
          }
        }}
      >
        <AnimatePresence>
          {showSuccessDialog && (
            <DialogContent sx={{ p: 4 }}>
              <Box
                component={motion.div}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                sx={{
                  textAlign: 'center'
                }}
              >
                <Box
                  component={motion.div}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                  sx={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    bgcolor: '#ecfdf5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                    mb: 3
                  }}
                >
                  <CheckCircle sx={{ fontSize: 48, color: '#10b981' }} />
                </Box>

                <Typography variant="h4" sx={{ color: '#1e293b', fontWeight: 700, mb: 1 }}>
                  Success!
                </Typography>
                <Typography variant="body1" sx={{ color: '#64748b', mb: 4 }}>
                  Step 0 complete. Calibration workflow is now unlocked.
                </Typography>

                <Button
                  variant="contained"
                  size="large"
                  endIcon={<ArrowForward />}
                  onClick={handleProceedToStep1}
                  sx={{
                    bgcolor: '#D04A02',
                    '&:hover': { bgcolor: '#B23D01' },
                    px: 6,
                    py: 1.5,
                    fontWeight: 600
                  }}
                >
                  Proceed to Population Extraction
                </Button>
              </Box>
            </DialogContent>
          )}
        </AnimatePresence>
      </Dialog>
    </Box>
  );
};

export default ReadinessGate;