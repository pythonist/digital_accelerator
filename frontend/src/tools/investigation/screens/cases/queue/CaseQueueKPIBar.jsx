import React from 'react';
import { Box, Paper, Stack, Typography, Chip, Divider } from '@mui/material';
import { Inbox, CheckCircleOutline, Warning, Schedule, AssignmentTurnedIn, ErrorOutline, HelpOutline } from '@mui/icons-material';

const STATUS_ITEMS = [
  { key: 'open', label: 'Open', color: '#2563eb', bg: '#eff6ff' },
  { key: 'in_review', label: 'In Review', color: '#0284c7', bg: '#f0f9ff' },
  { key: 'pending_l2_review', label: 'Pending L2', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'escalated', label: 'Escalated', color: '#ea580c', bg: '#fff7ed' },
  { key: 'awaiting_response', label: 'Awaiting Response', color: '#d97706', bg: '#fffbeb' },
  { key: 'sar_recommended', label: 'SAR Recommended', color: '#dc2626', bg: '#fef2f2' },
  { key: 'closed', label: 'Closed', color: '#16a34a', bg: '#f0fdf4' },
];

const CaseQueueKPIBar = ({ kpis = {} }) => {
  const total = Number(kpis.total_cases || 0);
  const overdue = Number(kpis.overdue || 0);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: '#ffffff',
        borderColor: '#e2e8f0',
        boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 2,
      }}
    >
      {/* 1. Total Worklist Volume */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 2, borderRight: { xs: 'none', lg: '1px solid #e2e8f0' } }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            bgcolor: '#0f172a',
            color: '#ffffff',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Inbox sx={{ fontSize: 22 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Total Queue Cases
          </Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
            {total.toLocaleString()}
          </Typography>
        </Box>
      </Box>

      {/* 2. Pipeline Status Flow */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ flex: 1, px: { xs: 0, lg: 1 } }}
      >
        {STATUS_ITEMS.map((item) => {
          const count = Number(kpis[item.key] || 0);
          const hasCount = count > 0;
          return (
            <Box
              key={item.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.6,
                borderRadius: 1.5,
                bgcolor: hasCount ? item.bg : '#f8fafc',
                border: `1px solid ${hasCount ? item.color + '40' : '#e2e8f0'}`,
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: hasCount ? item.color : '#64748b' }}>
                {item.label}:
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: hasCount ? item.color : '#94a3b8' }}>
                {count.toLocaleString()}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      {/* 3. Action / Overdue SLA Alert */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          pl: { xs: 0, lg: 2 },
          borderLeft: { xs: 'none', lg: '1px solid #e2e8f0' },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            bgcolor: overdue > 0 ? '#fff7ed' : '#f0fdf4',
            border: `1.5px solid ${overdue > 0 ? '#fed7aa' : '#bbf7d0'}`,
            borderRadius: 2,
          }}
        >
          {overdue > 0 ? <Warning sx={{ color: '#ea580c', fontSize: 18 }} /> : <CheckCircleOutline sx={{ color: '#16a34a', fontSize: 18 }} />}
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 800, color: overdue > 0 ? '#9a3412' : '#166534', textTransform: 'uppercase' }}>
              Overdue SLA
            </Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 900, color: overdue > 0 ? '#c2410c' : '#15803d', lineHeight: 1 }}>
              {overdue.toLocaleString()} cases
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default CaseQueueKPIBar;
