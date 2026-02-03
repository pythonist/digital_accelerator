// frontend/src/tools/calibration/components/PopulationImpactPanel.jsx
import React from 'react';
import {
  Card, CardContent, Box, Typography, Stack, Divider,
  LinearProgress, Skeleton, Grid, IconButton, Tooltip, Alert
} from '@mui/material';
import {
  TrendingDown, Code as CodeIcon, Warning as WarningIcon
} from '@mui/icons-material';

const PopulationImpactPanel = ({ liveStats, loading, onViewSQL }) => {
  return (
    <Card variant="outlined" sx={{ mb: 2, border: '1px solid', borderColor: 'divider' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TrendingDown color="primary" fontSize="small" />
            <Typography variant="subtitle2" fontWeight="600">
              Population Impact
            </Typography>
          </Stack>
          {onViewSQL && (
            <Tooltip title="View SQL Query">
              <IconButton size="small" onClick={onViewSQL}>
                <CodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Divider sx={{ mb: 2 }} />

        {loading ? (
          <Stack spacing={1.5}>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} variant="rectangular" width="100%" height={40} sx={{ borderRadius: 1 }} />
            ))}
          </Stack>
        ) : liveStats ? (
          <Stack spacing={2.5}>
            {/* Base Population */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Base Population
              </Typography>
              <Typography variant="h6" fontWeight="600">
                {liveStats.original_count?.toLocaleString() || '-'}
              </Typography>
            </Box>

            {/* Filtered Population */}
            <Box
              sx={{
                p: 2,
                bgcolor: 'primary.50',
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'primary.100'
              }}
            >
              <Typography
                variant="caption"
                color="primary.main"
                fontWeight="600"
                sx={{ mb: 0.5, display: 'block' }}
              >
                Filtered Population
              </Typography>
              <Typography variant="h4" color="primary.main" fontWeight="700">
                {liveStats.filtered_count?.toLocaleString() || '-'}
              </Typography>
            </Box>

            {/* Reduction Progress */}
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Population Reduction
                </Typography>
                <Typography variant="caption" fontWeight="600">
                  {liveStats.reduction_pct}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={liveStats.reduction_pct}
                color={liveStats.reduction_pct > 80 ? 'warning' : 'primary'}
                sx={{ height: 6, borderRadius: 3, bgcolor: 'grey.100' }}
              />
            </Box>

            {/* High Reduction Warning */}
            {liveStats.reduction_pct > 90 && (
              <Alert severity="warning" icon={<WarningIcon />} sx={{ py: 0.5 }}>
                <Typography variant="caption">
                  High reduction rate - verify filters are correct
                </Typography>
              </Alert>
            )}

            <Divider />

            {/* Entity Counts */}
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Customers
                </Typography>
                <Typography variant="h6" fontWeight="600">
                  {liveStats.unique_customers?.toLocaleString() || 'N/A'}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Accounts
                </Typography>
                <Typography variant="h6" fontWeight="600">
                  {liveStats.unique_accounts?.toLocaleString() || 'N/A'}
                </Typography>
              </Grid>
            </Grid>

            {/* Date Range */}
            {liveStats.date_range_start && liveStats.date_range_end && (
              <>
                <Divider />
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Date Coverage
                  </Typography>
                  <Typography variant="body2" fontWeight="600">
                    {new Date(liveStats.date_range_start).toLocaleDateString()} -{' '}
                    {new Date(liveStats.date_range_end).toLocaleDateString()}
                  </Typography>
                </Box>
              </>
            )}
          </Stack>
        ) : (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Apply filters to see impact
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default PopulationImpactPanel;