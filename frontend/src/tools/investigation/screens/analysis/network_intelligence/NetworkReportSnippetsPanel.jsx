import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const NetworkReportSnippetsPanel = ({ snippets = [] }) => (
  <Stack spacing={1.15}>
    {snippets.length ? snippets.map((snippet, index) => (
      <Paper key={`snippet_${index + 1}`} variant="outlined" sx={{ p: 1.45, borderRadius: 2 }}>
        <Typography sx={{ fontSize: 12.45, color: '#334155', lineHeight: 1.7 }}>
          {snippet}
        </Typography>
      </Paper>
    )) : (
      <Typography sx={{ fontSize: 12.6, color: '#64748b' }}>Report-ready network snippets will appear here after analysis.</Typography>
    )}
  </Stack>
);

export default NetworkReportSnippetsPanel;
