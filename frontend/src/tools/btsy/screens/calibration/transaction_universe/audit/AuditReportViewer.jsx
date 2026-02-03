// frontend/src/tools/btsy/screens/calibration/audit/AuditReportViewer.jsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  Typography,
  Button,
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent,
  Grid,
  Paper,
  Chip,
  Divider,
  Alert
} from '@mui/material';
import {
  Article as ArticleIcon,
  Download as DownloadIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Create as CreateIcon,
  Lock as LockIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import btsyApi from '../../../services/btsyApi';

/**
 * Comprehensive audit report viewer
 */
const AuditReportViewer = ({ calibrationRunId }) => {
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAuditData();
  }, [calibrationRunId]);

  const loadAuditData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await btsyApi.audit.getFullAudit(calibrationRunId);
      if (response.success) {
        setAuditData(response.data);
      }
    } catch (err) {
      console.error('Failed to load audit data:', err);
      setError('Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const response = await btsyApi.audit.exportAuditReport(calibrationRunId);
      if (response.success) {
        // Create downloadable JSON
        const dataStr = JSON.stringify(response.data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `calibration_audit_${calibrationRunId}_${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to export audit:', err);
      alert('Failed to export audit report');
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'create':
        return <CreateIcon />;
      case 'freeze':
        return <LockIcon />;
      case 'delete':
        return <DeleteIcon />;
      default:
        return <RadioButtonUncheckedIcon />;
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'create':
        return 'primary';
      case 'freeze':
        return 'success';
      case 'delete':
        return 'error';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading audit data...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  }

  if (!auditData) {
    return null;
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#1e293b', mb: 1 }}>
            Calibration Audit Report
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b' }}>
            Complete audit trail for Calibration Run #{calibrationRunId}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          onClick={handleExport}
          sx={{
            bgcolor: '#D04A02',
            '&:hover': { bgcolor: '#b13f02' },
            fontWeight: 600,
            textTransform: 'none'
          }}
        >
          Export Report
        </Button>
      </Box>

      {/* Summary Statistics */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={3}>
          <Paper 
            elevation={0}
            sx={{ 
              p: 2.5, 
              bgcolor: '#eff6ff', 
              border: '1px solid #93c5fd',
              borderRadius: 2,
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: '#1e40af', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Steps
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#2563eb', mt: 1, fontFamily: 'monospace' }}>
              {auditData.steps?.length || 0}
            </Typography>
          </Paper>
        </Grid>
        
        <Grid item xs={3}>
          <Paper 
            elevation={0}
            sx={{ 
              p: 2.5, 
              bgcolor: '#f0fdf4', 
              border: '1px solid #86efac',
              borderRadius: 2,
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: '#15803d', fontWeight: 600, textTransform: 'uppercase' }}>
              Completed Steps
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#16a34a', mt: 1, fontFamily: 'monospace' }}>
              {auditData.steps?.filter(s => s.status === 'completed').length || 0}
            </Typography>
          </Paper>
        </Grid>
        
        <Grid item xs={3}>
          <Paper 
            elevation={0}
            sx={{ 
              p: 2.5, 
              bgcolor: '#fef3c7', 
              border: '1px solid #fcd34d',
              borderRadius: 2,
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Actions
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#d97706', mt: 1, fontFamily: 'monospace' }}>
              {auditData.timeline?.length || 0}
            </Typography>
          </Paper>
        </Grid>
        
        <Grid item xs={3}>
          <Paper 
            elevation={0}
            sx={{ 
              p: 2.5, 
              bgcolor: '#f5f3ff', 
              border: '1px solid #c4b5fd',
              borderRadius: 2,
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: '#6d28d9', fontWeight: 600, textTransform: 'uppercase' }}>
              Duration
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#7c3aed', mt: 1, fontFamily: 'monospace', fontSize: '1.5rem' }}>
              {(auditData.steps?.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60).toFixed(1)}m
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Step Summaries */}
      <Card sx={{ mb: 4 }}>
        <Box sx={{ p: 2.5, borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Step Summary
          </Typography>
        </Box>
        <Box sx={{ p: 2.5 }}>
          {auditData.steps?.map((step, index) => (
            <Box key={index} sx={{ mb: 3, pb: 3, borderBottom: index < auditData.steps.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
                {step.status === 'completed' ? (
                  <CheckCircleIcon sx={{ color: '#16a34a' }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ color: '#94a3b8' }} />
                )}
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1e293b' }}>
                  {step.step_name}
                </Typography>
                <Chip
                  label={step.status}
                  size="small"
                  sx={{
                    bgcolor: step.status === 'completed' ? '#dcfce7' : '#f1f5f9',
                    color: step.status === 'completed' ? '#15803d' : '#475569',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}
                />
                {step.duration_seconds && (
                  <Chip
                    label={`${step.duration_seconds.toFixed(2)}s`}
                    size="small"
                    sx={{ bgcolor: '#e0e7ff', color: '#3730a3', fontFamily: 'monospace' }}
                  />
                )}
              </Box>
              
              <Grid container spacing={2}>
                {step.input_metrics && (
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                      Input Metrics:
                    </Typography>
                    <Paper elevation={0} sx={{ p: 1, mt: 0.5, bgcolor: '#f8fafc', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {JSON.stringify(step.input_metrics, null, 2)}
                    </Paper>
                  </Grid>
                )}
                
                {step.output_metrics && (
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                      Output Metrics:
                    </Typography>
                    <Paper elevation={0} sx={{ p: 1, mt: 0.5, bgcolor: '#f8fafc', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {JSON.stringify(step.output_metrics, null, 2)}
                    </Paper>
                  </Grid>
                )}
              </Grid>
            </Box>
          ))}
        </Box>
      </Card>

      {/* Action Timeline */}
      <Card>
        <Box sx={{ p: 2.5, borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Action Timeline
          </Typography>
        </Box>
        <Box sx={{ p: 2.5 }}>
          <Timeline position="right">
            {auditData.timeline?.map((action, index) => (
              <TimelineItem key={index}>
                <TimelineOppositeContent sx={{ flex: 0.3, pt: 1.5 }}>
                  <Typography variant="caption" sx={{ color: '#64748b', fontFamily: 'monospace' }}>
                    {new Date(action.timestamp).toLocaleString()}
                  </Typography>
                </TimelineOppositeContent>
                
                <TimelineSeparator>
                  <TimelineDot color={getActionColor(action.action)}>
                    {getActionIcon(action.action)}
                  </TimelineDot>
                  {index < auditData.timeline.length - 1 && <TimelineConnector />}
                </TimelineSeparator>
                
                <TimelineContent>
                  <Paper elevation={0} sx={{ p: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b', mb: 0.5 }}>
                      {action.action.toUpperCase()} {action.entity_type}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                      {action.step_name} • {action.performed_by}
                    </Typography>
                    {action.metrics && (
                      <Box sx={{ mt: 1, p: 1, bgcolor: 'white', borderRadius: 1, fontSize: '0.7rem', fontFamily: 'monospace' }}>
                        {JSON.stringify(action.metrics, null, 2)}
                      </Box>
                    )}
                  </Paper>
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </Box>
      </Card>
    </Box>
  );
};

export default AuditReportViewer;