// frontend/src/tools/calibration/components/aggregation/SQLQueryViewer.jsx
import React, { useState } from 'react';
import { Paper, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Code, ContentCopy, Check } from '@mui/icons-material';

const SQLQueryViewer = ({ sqlQuery }) => {
  const [copied, setCopied] = useState(false);

  if (!sqlQuery) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlQuery);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Code fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight="600">
            SQL Equivalent
          </Typography>
        </Box>
        <Tooltip title={copied ? "Copied!" : "Copy SQL"}>
          <IconButton size="small" onClick={handleCopy}>
            {copied ? <Check fontSize="small" color="success" /> : <ContentCopy fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ 
        p: 1.5, 
        bgcolor: '#1e293b', 
        color: '#94a3b8', 
        fontFamily: 'monospace', 
        fontSize: '0.75rem',
        borderRadius: 1,
        overflowX: 'auto'
      }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{sqlQuery}</pre>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        This query represents the logical aggregation performed by the engine
      </Typography>
    </Paper>
  );
};

export default SQLQueryViewer;