// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/UniversePreviewDialog.jsx
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Grid,
  Paper,
  Box,
  Divider,
  Chip
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

/**
 * Displays universe preview metrics
 */
const UniversePreviewDialog = ({ open, onClose, metrics }) => {
  if (!metrics) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 0
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleIcon sx={{ color: '#0f172a' }} />
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Universe Created Successfully
          </Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent sx={{ p: 3, mt: 2 }}>
        <Typography variant="body2" sx={{ color: '#64748b', mb: 3 }}>
          Your transaction universe has been created as a draft. Review the metrics below and freeze it when ready.
        </Typography>

        <Grid container spacing={2}>
          {/* Primary Metrics */}
          <Grid item xs={4}>
            <Paper 
              elevation={0}
              sx={{ 
                p: 2.5, 
                bgcolor: '#f8fafc', 
                border: '1px solid #e2e8f0',
                borderRadius: 1,
                textAlign: 'center'
              }}
            >
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#334155', 
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Total Transactions
              </Typography>
              <Typography 
                variant="h4" 
                sx={{ 
                  fontWeight: 700, 
                  color: '#0f172a',
                  mt: 1,
                  fontFamily: 'monospace'
                }}
              >
                {metrics.transaction_count?.toLocaleString()}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={4}>
            <Paper 
              elevation={0}
              sx={{ 
                p: 2.5, 
                bgcolor: '#f8fafc', 
                border: '1px solid #e2e8f0',
                borderRadius: 1,
                textAlign: 'center'
              }}
            >
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#334155', 
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Unique Accounts
              </Typography>
              <Typography 
                variant="h4" 
                sx={{ 
                  fontWeight: 700, 
                  color: '#0f172a',
                  mt: 1,
                  fontFamily: 'monospace'
                }}
              >
                {metrics.unique_accounts?.toLocaleString()}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={4}>
            <Paper 
              elevation={0}
              sx={{ 
                p: 2.5, 
                bgcolor: '#f8fafc', 
                border: '1px solid #e2e8f0',
                borderRadius: 1,
                textAlign: 'center'
              }}
            >
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#334155', 
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Total Amount
              </Typography>
              <Typography 
                variant="h4" 
                sx={{ 
                  fontWeight: 700, 
                  color: '#0f172a',
                  mt: 1,
                  fontFamily: 'monospace',
                  fontSize: '1.75rem'
                }}
              >
                {(metrics.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Typography>
            </Paper>
          </Grid>

          {/* Date Range */}
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: '#1e293b' }}>
                Date Range
              </Typography>
              <Typography variant="body2" sx={{ color: '#475569' }}>
                {metrics.date_range_start && new Date(metrics.date_range_start).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
                {' → '}
                {metrics.date_range_end && new Date(metrics.date_range_end).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Typography>
            </Box>
          </Grid>

          {/* Category Breakdown */}
          {metrics.category_breakdown && Object.keys(metrics.category_breakdown).length > 0 && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: '#1e293b' }}>
                  Category Breakdown
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {Object.entries(metrics.category_breakdown).map(([cat, count]) => (
                    <Chip
                      key={cat}
                      label={`${cat}: ${count.toLocaleString()}`}
                      sx={{
                        bgcolor: '#f1f5f9',
                        color: '#0f172a',
                        fontWeight: 600,
                        '& .MuiChip-label': {
                          fontFamily: 'monospace'
                        }
                      }}
                    />
                  ))}
                </Box>
              </Box>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      
      <DialogActions sx={{ p: 2.5, borderTop: '1px solid #e2e8f0' }}>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{
            bgcolor: '#0f172a',
            '&:hover': { bgcolor: '#111827' },
            fontWeight: 600,
            textTransform: 'none'
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UniversePreviewDialog;
