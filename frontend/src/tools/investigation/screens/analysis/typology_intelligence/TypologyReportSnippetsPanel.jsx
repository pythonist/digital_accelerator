import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const TypologyReportSnippetsPanel = ({ snippets }) => {
  const items = snippets || [];
  return (
    <Stack spacing={1.2}>
      {items.length ? items.map((item, index) => (
        <Paper key={`snippet-${index}`} variant="outlined" sx={{ p: 1.7, borderRadius: 2.5 }}>
          <Typography sx={{ fontSize: 12.7, color: '#334155', lineHeight: 1.65 }}>{item}</Typography>
        </Paper>
      )) : (
        <Paper variant="outlined" sx={{ p: 1.7, borderRadius: 2.5 }}>
          <Typography sx={{ fontSize: 12.6, color: '#64748b' }}>No report-ready snippet has been prepared yet.</Typography>
        </Paper>
      )}
    </Stack>
  );
};

export default TypologyReportSnippetsPanel;
