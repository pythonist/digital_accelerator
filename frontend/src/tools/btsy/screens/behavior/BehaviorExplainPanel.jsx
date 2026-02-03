import React from 'react';
import { Paper, Typography, Box } from '@mui/material';

const BehaviorExplainPanel = ({ universe, config }) => {
  if (!universe || !config) return null;

  const metric = config.metrics?.[0];
  if (!metric) return null;

  const entityLevel = config.entity_level || 'account';
  const entityIdCol = config.entity_id_col || 'account_id';
  const timeCol = config.time_col || 'transaction_datetime';

  return (
    <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2, bgcolor: '#f8fafc' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        What This Does
      </Typography>
      <Typography variant="body2" sx={{ color: '#475569', lineHeight: 1.6 }}>
        This behavior builder computes <strong>{metric.name}</strong> for each <strong>{entityLevel}</strong> in the selected universe.
        The calculation uses a rolling <strong>{metric.window}</strong> window to compute the{' '}
        <strong>{metric.type}</strong> of <strong>{metric.column}</strong> values.
      </Typography>
      <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', display: 'block', mb: 0.5 }}>
          Example:
        </Typography>
        <Typography
        variant="body2"
        sx={{ color: '#475569', fontFamily: 'monospace', fontSize: '0.85rem' }}
      >
        For each transaction, compute a rolling {metric.window}{' '}
        {metric.type}({metric.column}) based on {timeCol}, partitioned by {entityIdCol}.
      </Typography>

      </Box>
      <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: '#64748b' }}>
        The output will contain one row per transaction with the computed behavior value at that point in time.
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#64748b' }}>
        This step is exploratory and analytical. No alerts are generated here.
      </Typography>
    </Paper>
  );
};

export default BehaviorExplainPanel;
