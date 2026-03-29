import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import {
  AppsRounded,
  ArrowForwardRounded,
  HubOutlined,
  ShieldOutlined,
} from '@mui/icons-material';
import { motion, useReducedMotion } from 'framer-motion';
import { useAppContext } from '@context/AppContext';

const MotionBox = motion(Box);

const TRANSITION_STEPS = [
  {
    label: 'Secure workspace context',
    description: 'Applying the selected FCC environment and user session.',
    icon: ShieldOutlined,
  },
  {
    label: 'Load module catalog',
    description: 'Retrieving the available analytics and investigation workspaces.',
    icon: AppsRounded,
  },
  {
    label: 'Prepare guided handoff',
    description: 'Opening module selection with the active environment already bound.',
    icon: HubOutlined,
  },
];

const palette = {
  canvas: '#F3F4F6',
  panel: '#FFFFFF',
  ink: '#111827',
  muted: '#6B7280',
  line: '#E5E7EB',
  accent: '#D04A02',
  accentSoft: 'rgba(208, 74, 2, 0.10)',
  accentGlow: 'rgba(208, 74, 2, 0.18)',
  chrome: '#1F2937',
};

const EnvironmentModuleTransitionScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const { activeEnv, username } = useAppContext();

  const envLabel = useMemo(
    () => String(location.state?.envName || activeEnv || '').trim(),
    [activeEnv, location.state]
  );

  useEffect(() => {
    if (!envLabel) {
      navigate('/environments', { replace: true });
      return undefined;
    }

    const timer = window.setTimeout(() => {
      navigate('/tools', {
        replace: true,
        state: {
          envName: envLabel,
          source: 'environment-transition',
        },
      });
    }, prefersReducedMotion ? 220 : 1150);

    return () => window.clearTimeout(timer);
  }, [envLabel, navigate, prefersReducedMotion]);

  const containerAnimation = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: palette.canvas,
        backgroundImage: `
          radial-gradient(circle at top left, rgba(208, 74, 2, 0.08), transparent 30%),
          linear-gradient(135deg, #f8fafc 0%, #f3f4f6 55%, #eef2f7 100%)
        `,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 6 },
      }}
    >
      <MotionBox
        {...containerAnimation}
        sx={{
          width: '100%',
          maxWidth: 760,
          border: `1px solid ${palette.line}`,
          bgcolor: palette.panel,
          boxShadow: `0 24px 60px ${palette.accentGlow}`,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: 6,
            background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.chrome} 100%)`,
          }}
        />

        <Stack spacing={4} sx={{ p: { xs: 3, md: 5 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
            <Box>
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: palette.accent,
                  mb: 1,
                }}
              >
                FCC Workbench
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: 28, md: 34 },
                  lineHeight: 1.1,
                  fontWeight: 700,
                  color: palette.ink,
                  mb: 1,
                }}
              >
                Preparing module selection
              </Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.7, color: palette.muted, maxWidth: 560 }}>
                We are carrying the selected environment into the shared workspace so the next screen opens with the correct business context already applied.
              </Typography>
            </Box>

            <Chip
              label={envLabel || 'Environment'}
              sx={{
                px: 1,
                height: 32,
                fontSize: 12,
                fontWeight: 700,
                bgcolor: palette.accentSoft,
                color: palette.accent,
                border: `1px solid rgba(208, 74, 2, 0.22)`,
              }}
            />
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr' },
              gap: 2,
            }}
          >
            <Box
              sx={{
                border: `1px solid ${palette.line}`,
                bgcolor: '#FCFCFD',
                p: 2.5,
              }}
            >
              <Stack spacing={2}>
                {TRANSITION_STEPS.map((step, index) => {
                  const StepIcon = step.icon;
                  return (
                    <MotionBox
                      key={step.label}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }}
                      animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0 }}
                      transition={prefersReducedMotion ? undefined : { delay: 0.08 * index, duration: 0.35 }}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '44px 1fr',
                        gap: 1.5,
                        alignItems: 'start',
                      }}
                    >
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: index === 2 ? palette.accentSoft : '#F8FAFC',
                          border: `1px solid ${index === 2 ? 'rgba(208, 74, 2, 0.22)' : palette.line}`,
                        }}
                      >
                        <StepIcon sx={{ fontSize: 20, color: index === 2 ? palette.accent : palette.chrome }} />
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 14, fontWeight: 700, color: palette.ink }}>
                          {step.label}
                        </Typography>
                        <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, color: palette.muted, mt: 0.35 }}>
                          {step.description}
                        </Typography>
                      </Box>
                    </MotionBox>
                  );
                })}
              </Stack>
            </Box>

            <Box
              sx={{
                border: `1px solid ${palette.line}`,
                bgcolor: '#F8FAFC',
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.muted, mb: 1.5 }}>
                  Handoff Summary
                </Typography>
                <Stack spacing={1.25}>
                  <Box>
                    <Typography sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: palette.muted }}>
                      Active environment
                    </Typography>
                    <Typography sx={{ fontSize: 15, fontWeight: 700, color: palette.ink }}>
                      {envLabel}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: palette.muted }}>
                      Session owner
                    </Typography>
                    <Typography sx={{ fontSize: 15, fontWeight: 700, color: palette.ink }}>
                      {username || 'Current user'}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 12, color: palette.muted, mb: 1 }}>
                  Opening module selection
                </Typography>
                <Box
                  sx={{
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    bgcolor: '#E2E8F0',
                  }}
                >
                  <MotionBox
                    initial={prefersReducedMotion ? false : { width: '24%' }}
                    animate={prefersReducedMotion ? { width: '100%' } : { width: '100%' }}
                    transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.95, ease: 'easeOut' }}
                    sx={{
                      height: '100%',
                      borderRadius: 999,
                      background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.chrome} 100%)`,
                    }}
                  />
                </Box>
              </Box>
            </Box>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
            <Typography sx={{ fontSize: 12.5, color: palette.muted }}>
              Transitioning from environment management to module selection.
            </Typography>
            <Button
              variant="text"
              endIcon={<ArrowForwardRounded />}
              onClick={() => navigate('/tools', { replace: true })}
              sx={{
                alignSelf: { xs: 'flex-start', sm: 'center' },
                textTransform: 'none',
                color: palette.accent,
                fontWeight: 700,
              }}
            >
              Continue now
            </Button>
          </Stack>
        </Stack>
      </MotionBox>
    </Box>
  );
};

export default EnvironmentModuleTransitionScreen;
