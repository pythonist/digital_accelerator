// frontend/src/tools/calibration/components/ExcludedPopulationPanel.jsx
import React from 'react';
import {
  Card, CardContent, Box, Typography, Stack, Divider, Chip, Alert
} from '@mui/material';
import { InfoOutlined, RemoveCircleOutline } from '@mui/icons-material';

const ExcludedPopulationPanel = ({ excluded }) => {
  if (!excluded || (!excluded.by_category && !excluded.total_excluded_transactions)) {
    return null;
  }

  const hasData = excluded.by_category && Object.keys(excluded.by_category).length > 0;

  return (
    <Card variant="outlined" sx={{ mb: 2, border: '1px solid', borderColor: 'divider' }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <RemoveCircleOutline fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="subtitle2" fontWeight="600">
            Excluded Population
          </Typography>
        </Stack>
        <Divider sx={{ mb: 2 }} />

        {hasData ? (
          <>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              What this scenario does not analyze
            </Typography>

            {/* Total Excluded */}
            {excluded.total_excluded_transactions && (
              <Box sx={{ mb: 2, p: 1.5, bgcolor: '#fef3c7', borderRadius: 1, border: '1px solid #fde68a' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Total Excluded Transactions
                </Typography>
                <Typography variant="h6" fontWeight="600" sx={{ color: '#92400e' }}>
                  {excluded.total_excluded_transactions.toLocaleString()}
                </Typography>
              </Box>
            )}

            {/* Transaction Categories */}
            <Typography variant="caption" fontWeight="600" color="text.secondary" display="block" mb={1}>
              Transaction Categories
            </Typography>
            
            <Stack spacing={1.5}>
              {Object.entries(excluded.by_category).map(([category, count]) => (
                <Box key={category}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Typography variant="body2" fontWeight="500">
                      {category}
                    </Typography>
                    <Chip 
                      label={count.toLocaleString()} 
                      size="small" 
                      sx={{ 
                        bgcolor: '#fee2e2', 
                        color: '#991b1b',
                        fontWeight: 600,
                        fontSize: '0.7rem'
                      }} 
                    />
                  </Stack>
                </Box>
              ))}
            </Stack>

            <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 2, py: 0.5 }}>
              <Typography variant="caption">
                Blind Spot Check: Review excluded segments to ensure intentional scoping.
              </Typography>
            </Alert>
          </>
        ) : (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="caption" color="text.secondary">
              No exclusions to display
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default ExcludedPopulationPanel;