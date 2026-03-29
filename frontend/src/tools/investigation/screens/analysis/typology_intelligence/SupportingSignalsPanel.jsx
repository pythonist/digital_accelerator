import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

const SupportingSignalsPanel = ({ groups }) => {
  const items = groups || [];
  return (
    <Stack spacing={1.4}>
      {items.map((group) => (
        <Paper key={group.category} variant="outlined" sx={{ p: 1.8, borderRadius: 2.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{group.category}</Typography>
          <Stack spacing={1} sx={{ mt: 1.1 }}>
            {(group.items || []).map((item) => (
              <Stack key={`${group.category}-${item.label}`} spacing={0.25}>
                <Typography sx={{ fontSize: 12.8, fontWeight: 700, color: '#334155' }}>
                  {item.label}: {item.value}
                </Typography>
                <Typography sx={{ fontSize: 12.4, color: '#64748b', lineHeight: 1.55 }}>{item.detail}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
};

export default SupportingSignalsPanel;
