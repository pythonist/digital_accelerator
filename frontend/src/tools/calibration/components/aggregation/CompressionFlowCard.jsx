// frontend/src/tools/calibration/components/aggregation/CompressionFlowCard.jsx
import React from 'react';
import { Paper, Typography, Box, Stack } from '@mui/material';
import { ArrowForward, CompareArrows } from '@mui/icons-material';

const CompressionFlowCard = ({ data }) => {
  if (!data) return null;

  const { input, output, compression_ratio } = data.compression_flow || {};

  const getCompressionColor = (ratio) => {
    if (ratio > 20) return 'error.main';
    if (ratio > 10) return 'warning.main';
    if (ratio > 2) return 'success.main';
    return 'info.main';
  };

  const getCompressionLabel = (ratio) => {
    if (ratio > 20) return 'Very High Compression';
    if (ratio > 10) return 'High Compression';
    if (ratio > 2) return 'Good Compression';
    return 'Low Compression';
  };

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
        <CompareArrows fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight="600">
          Aggregation Flow
        </Typography>
      </Box>

      <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between">
        {/* Input */}
        <Box sx={{ flex: 1, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Input (v1)
          </Typography>
          <Typography variant="h4" fontWeight="700" color="primary.main">
            {input?.rows?.toLocaleString() || 0}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {input?.unique_entities?.toLocaleString() || 0} entities
          </Typography>
        </Box>

        {/* Arrow */}
        <ArrowForward sx={{ color: 'text.secondary', fontSize: 32 }} />

        {/* Output */}
        <Box sx={{ flex: 1, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Output (v2)
          </Typography>
          <Typography variant="h4" fontWeight="700" color="secondary.main">
            {output?.rows?.toLocaleString() || 0}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {output?.unique_entities?.toLocaleString() || 0} entities
          </Typography>
        </Box>
      </Stack>

      {/* Compression Ratio */}
      <Box
        sx={{
          mt: 2,
          p: 1.5,
          bgcolor: 'grey.50',
          borderRadius: 1,
          textAlign: 'center'
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Compression Ratio
        </Typography>
        <Typography
          variant="h5"
          fontWeight="700"
          sx={{ color: getCompressionColor(compression_ratio) }}
        >
          {compression_ratio}x
        </Typography>
        <Typography variant="caption" sx={{ color: getCompressionColor(compression_ratio) }}>
          {getCompressionLabel(compression_ratio)}
        </Typography>
      </Box>
    </Paper>
  );
};

export default CompressionFlowCard;