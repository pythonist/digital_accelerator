import React from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  Refresh,
  SyncProblemOutlined,
} from '@mui/icons-material';
import { FCC_THEME } from '../theme/fccWorkbenchTheme';

const SectionRow = ({ label, children, borderTop = false }) => (
  <Box
    sx={{
      px: 2,
      py: 1.5,
      borderTop: borderTop ? `1px solid ${FCC_THEME.border}` : 'none',
    }}
  >
    <Typography
      sx={{
        fontSize: 10,
        fontWeight: 700,
        color: FCC_THEME.textSoft,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        mb: 0.65,
      }}
    >
      {label}
    </Typography>
    <Typography sx={{ fontSize: 12, color: FCC_THEME.textMuted, lineHeight: 1.65 }}>
      {children}
    </Typography>
  </Box>
);

export default function BusinessStaleStepCard({
  currentStepLabel = 'This step',
  whatChanged = '',
  whyRerun = '',
  nextAction = '',
  actionLabel = 'Rerun this step',
  onAction = null,
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 2,
        borderRadius: 0,
        borderColor: FCC_THEME.borderStrong,
        bgcolor: FCC_THEME.panel,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          px: 2,
          py: 1.5,
          bgcolor: FCC_THEME.panel,
          borderBottom: `1px solid ${FCC_THEME.border}`,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            width: 4,
            bgcolor: FCC_THEME.accent,
          }}
        />
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <SyncProblemOutlined sx={{ fontSize: 18, color: FCC_THEME.accent, mt: '1px' }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: 10,
                fontWeight: 700,
                color: FCC_THEME.accent,
                textTransform: 'uppercase',
                letterSpacing: 0.7,
                mb: 0.4,
              }}
            >
              Rerun required
            </Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: FCC_THEME.text }}>
              {currentStepLabel} is out of date
            </Typography>
            <Typography sx={{ fontSize: 11.25, color: FCC_THEME.textMuted, lineHeight: 1.6, mt: 0.6 }}>
              Review the change below before relying on this page.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <SectionRow label="What changed">
        {whatChanged}
      </SectionRow>

      <SectionRow label="Why this step must be rerun" borderTop>
        {whyRerun}
      </SectionRow>

      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderTop: `1px solid ${FCC_THEME.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 700,
              color: FCC_THEME.textSoft,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              mb: 0.45,
            }}
          >
            Next action
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
            {nextAction}
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<Refresh sx={{ fontSize: 15 }} />}
          onClick={onAction}
          data-stale-card-action="true"
          sx={{
            textTransform: 'none',
            bgcolor: FCC_THEME.accent,
            '&:hover': { bgcolor: FCC_THEME.accentHover },
            boxShadow: 'none',
            whiteSpace: 'nowrap',
            borderRadius: 0,
          }}
        >
          {actionLabel}
        </Button>
      </Box>
    </Paper>
  );
}
