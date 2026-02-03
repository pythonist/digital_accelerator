// frontend/src/tools/calibration/components/aggregation/SnapshotExplainer.jsx
import React from 'react';
import { Paper, Typography, Box, Grid, Divider } from '@mui/material';
import { AccountTree } from '@mui/icons-material';

const SnapshotExplainer = ({ snapshot }) => {
  if (!snapshot) return null;

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <AccountTree fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight="600">
          Sample Snapshot Breakdown
        </Typography>
      </Box>

      <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, mb: 1.5 }}>
        <Typography variant="body2" fontWeight="600" gutterBottom>
          {snapshot.entity_id}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          on {snapshot.anchor_date}
        </Typography>
      </Box>

      <Grid container spacing={1.5}>
        <Grid item xs={12}>
          <Typography variant="caption" color="text.secondary">Window Period</Typography>
          <Typography variant="body2" fontWeight="500">
            {snapshot.window_start} → {snapshot.window_end}
          </Typography>
        </Grid>

        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Included Transactions</Typography>
          <Typography variant="h6" fontWeight="600" color="primary.main">
            {snapshot.included_transactions || 0}
          </Typography>
        </Grid>

        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Total Amount</Typography>
          <Typography variant="h6" fontWeight="600" color="primary.main">
            {snapshot.total_amount 
              ? `$${snapshot.total_amount.toLocaleString(undefined, {maximumFractionDigits: 0})}`
              : 'N/A'
            }
          </Typography>
        </Grid>

        {snapshot.avg_amount && (
          <Grid item xs={12}>
            <Divider sx={{ my: 0.5 }} />
            <Typography variant="caption" color="text.secondary">Avg Transaction</Typography>
            <Typography variant="body2">
              ${snapshot.avg_amount.toLocaleString(undefined, {maximumFractionDigits: 2})}
            </Typography>
          </Grid>
        )}
      </Grid>

      <Box sx={{ mt: 1.5, p: 1, bgcolor: 'info.50', borderRadius: 1 }}>
        <Typography variant="caption" color="info.dark">
          ℹ️ This represents a typical behavioral snapshot produced by your configuration
        </Typography>
      </Box>
    </Paper>
  );
};

export default SnapshotExplainer;