// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/SnapshotContextCard.jsx
import React from 'react';
import { Box, Card, Typography, Grid } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';

/**
 * Displays snapshot context information
 */
const SnapshotContextCard = ({ snapshotInfo }) => {
  if (!snapshotInfo) return null;

  return (
    <Card 
      sx={{ 
        bgcolor: '#f8fafc', 
        border: '1px solid #e2e8f0',
        boxShadow: 'none'
      }}
    >
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <InfoIcon fontSize="small" sx={{ color: '#D04A02' }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Foundation Snapshot Context
          </Typography>
        </Box>
        
        <Grid container spacing={2}>
          <Grid item xs={3}>
            <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Snapshot ID
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', mt: 0.5 }}>
              {snapshotInfo.snapshot_id}
            </Typography>
          </Grid>
          
          <Grid item xs={3}>
            <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Transactions
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
              {snapshotInfo.total_input_rows?.toLocaleString() || 'N/A'}
            </Typography>
          </Grid>
          
          <Grid item xs={3}>
            <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Domains Processed
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
              {snapshotInfo.domains_processed?.join(', ') || 'N/A'}
            </Typography>
          </Grid>
          
          <Grid item xs={3}>
            <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Created
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
              {new Date(snapshotInfo.created_at).toLocaleDateString()}
            </Typography>
          </Grid>
        </Grid>
      </Box>
    </Card>
  );
};

export default SnapshotContextCard;