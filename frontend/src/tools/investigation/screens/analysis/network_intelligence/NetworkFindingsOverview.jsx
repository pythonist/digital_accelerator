import React from 'react';
import { Alert, Chip, Paper, Stack, Typography } from '@mui/material';

const tone = {
  high: { fg: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
  medium: { fg: '#9a3412', bg: '#fff7ed', border: '#fed7aa' },
  low: { fg: '#1e3a8a', bg: '#eff6ff', border: '#bfdbfe' },
};

const NetworkFindingsOverview = ({ executiveSummary, findings = [], visibilityNote, assessment }) => (
  <Stack spacing={2}>
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a', mb: 1.1 }}>Executive Network Summary</Typography>
      <Typography sx={{ fontSize: 13.25, lineHeight: 1.8, color: '#334155' }}>
        {executiveSummary || 'Select a case to begin network intelligence analysis.'}
      </Typography>
    </Paper>

    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a', mb: 1.3 }}>Key Network Findings</Typography>
      <Stack spacing={1.2}>
        {findings.length ? findings.map((item, index) => {
          const styles = tone[item.severity] || tone.low;
          return (
            <Paper key={`${item.title}_${index + 1}`} variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: styles.border, backgroundColor: styles.bg }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography sx={{ fontSize: 13.25, fontWeight: 800, color: '#0f172a' }}>{item.title}</Typography>
                <Chip size="small" label={item.severity || 'info'} sx={{ backgroundColor: '#fff', color: styles.fg, border: `1px solid ${styles.border}` }} />
              </Stack>
              <Typography sx={{ mt: 0.8, fontSize: 12.6, color: '#334155', lineHeight: 1.7 }}>
                {item.detail}
              </Typography>
            </Paper>
          );
        }) : (
          <Typography sx={{ fontSize: 12.75, color: '#64748b' }}>No network findings available yet.</Typography>
        )}
      </Stack>
    </Paper>

    <Alert severity="info" sx={{ border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
      <Typography sx={{ fontSize: 12.6, color: '#1e3a8a' }}>
        {assessment || 'Network evidence is still being evaluated.'}
      </Typography>
      <Typography sx={{ mt: 0.5, fontSize: 12.2, color: '#334155' }}>
        {visibilityNote || 'Visibility is limited to currently available bank and investigation data.'}
      </Typography>
    </Alert>
  </Stack>
);

export default NetworkFindingsOverview;
