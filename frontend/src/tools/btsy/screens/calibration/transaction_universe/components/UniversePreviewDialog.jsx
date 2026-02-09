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
  Box,
  Divider,
  Table,
  TableBody,
  TableRow,
  TableCell
} from '@mui/material';

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
      <DialogTitle sx={{ borderBottom: '1px solid #e2e8f0' }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Universe Created
        </Typography>
      </DialogTitle>
      
      <DialogContent sx={{ p: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Your transaction universe has been created as a draft. Review the metrics below and freeze it when ready.
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Total transactions</TableCell>
                  <TableCell>{metrics.transaction_count?.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Unique accounts</TableCell>
                  <TableCell>{metrics.unique_accounts?.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Total amount</TableCell>
                  <TableCell>{(metrics.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Date range</TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Grid>

          {metrics.category_breakdown && Object.keys(metrics.category_breakdown).length > 0 && (
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Category Breakdown</Typography>
              <Table size="small">
                <TableBody>
                  {Object.entries(metrics.category_breakdown).map(([cat, count]) => (
                    <TableRow key={cat}>
                      <TableCell>{cat}</TableCell>
                      <TableCell>{count.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      
      <DialogActions sx={{ p: 1.5, borderTop: '1px solid #e2e8f0' }}>
        <Button
          onClick={onClose}
          variant="contained"
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UniversePreviewDialog;
