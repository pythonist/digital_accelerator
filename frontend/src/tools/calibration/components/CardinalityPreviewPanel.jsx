// frontend/src/tools/calibration/components/CardinalityPreviewPanel.jsx
import React from 'react';
import { Card, CardContent, Typography, Grid, Box, Divider } from '@mui/material';

const CardinalityPreviewPanel = ({ cardinality }) => {
  if (!cardinality) return null;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle2" fontWeight="600" gutterBottom>
          Population Shape
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          Distribution characteristics
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Typography variant="caption" color="text.secondary">
              Avg Txn/Account
            </Typography>
            <Typography variant="h6" fontWeight="600">
              {cardinality.avg_txn_per_account}
            </Typography>
          </Grid>
          <Grid item xs={6}>
            <Typography variant="caption" color="text.secondary">
              Max Single Account
            </Typography>
            <Typography variant="h6" fontWeight="600">
              {cardinality.max_txn_single_account}
            </Typography>
          </Grid>
          <Grid item xs={12}>
            <Box
              sx={{
                p: 1.5,
                bgcolor: cardinality.top_1pct_concentration > 40 ? 'warning.50' : 'success.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor: cardinality.top_1pct_concentration > 40 ? 'warning.200' : 'success.200'
              }}
            >
              <Typography variant="caption" fontWeight="600" display="block">
                Top 1% Concentration
              </Typography>
              <Typography
                variant="h5"
                fontWeight="700"
                color={cardinality.top_1pct_concentration > 40 ? 'warning.main' : 'success.main'}
              >
                {cardinality.top_1pct_concentration}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                of transactions from top 1% accounts
              </Typography>
            </Box>
          </Grid>
        </Grid>

        <Box sx={{ mt: 2, p: 1, bgcolor: 'info.50', borderRadius: 1 }}>
          <Typography variant="caption" color="info.dark">
            <strong>Why this matters:</strong> High concentration may indicate skewed aggregation.
            Consider segmenting by account size if concentration exceeds 50%.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default CardinalityPreviewPanel;