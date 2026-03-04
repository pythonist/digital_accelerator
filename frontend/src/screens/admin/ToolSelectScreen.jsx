import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  Divider,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AccountBalance,
  AdminPanelSettings,
  Analytics,
  ArrowBack,
  ChevronRight,
  Circle,
  Lock,
  Logout,
  MenuOpen,
  Science,
  Tune,
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext';
import {
  FadeIn,
  MotionContainer,
  MotionItem,
} from '@components/MotionWrappers/MotionWrappers';
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';

const COLORS = {
  canvas: '#eef2f7',
  panel: '#ffffff',
  sidebar: '#0f172a',
  sidebarBorder: 'rgba(255,255,255,0.10)',
  text: '#162033',
  muted: '#64748b',
  border: '#d9e2ec',
  shadow: '0 18px 48px rgba(15, 23, 42, 0.10)',
  orange: '#D04A02',
};

const TOOL_CARD_MIN_HEIGHT = 240;

const ToolSelectScreen = () => {
  const navigate = useNavigate();
  const {
    activeEnv,
    setActiveTool,
    disconnectEnv,
    handleLogout,
    username,
    userRole,
    datasetLoaded,
    refreshSystemState,
  } = useAppContext();

  const isAdmin = userRole === 'TENANT_ADMIN';
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!activeEnv) {
      navigate('/environments');
      return;
    }
    refreshSystemState();
  }, [activeEnv, navigate, refreshSystemState]);

  const tools = useMemo(() => ([
    {
      key: 'investigation',
      name: 'Sentinel',
      description: 'AI-assisted, human-in-the-loop investigation workspace for prioritization, review, and operational case handling.',
      icon: Analytics,
      color: '#D04A02',
      requiresData: false,
      path: '/investigation',
      badge: 'Core',
    },
    {
      key: 'calibration',
      name: 'Cortex',
      description: 'Rule optimization, threshold tuning, scenario simulation, and performance impact analysis in one decisioning workbench.',
      icon: Tune,
      color: '#00A152',
      path: '/calibration',
      locked: !activeEnv,
      badge: 'Optimization',
    },
    {
      key: 'mule_detection',
      name: 'Mule Detection Intelligence',
      description: 'Behavioral pattern analysis for mule detection with timeline tracing, pass-through analytics, and recomputation.',
      icon: AccountBalance,
      color: '#0284c7',
      path: '/mule',
      locked: !activeEnv,
      badge: 'Network Analysis',
    },
    {
      key: 'btsy',
      name: 'BTSY',
      description: 'Bank Threshold Simulation workspace for controlled threshold calibration, impact modeling, and supervisory tuning.',
      icon: Circle,
      color: '#D04A02',
      path: '/btsy',
      locked: !activeEnv,
      badge: 'Simulation',
    },
    {
      key: 'mlops',
      name: 'ML Ops Workbench',
      description: 'Feature engineering, training, validation, threshold tuning, and deployment readiness for AML models.',
      icon: Science,
      color: '#7A4BC2',
      path: '/mlops',
      locked: !activeEnv,
      badge: 'Model Ops',
    },
  ]), [activeEnv]);

  const readyCount = tools.filter((tool) => !(tool.locked || (tool.requiresData && !datasetLoaded))).length;

  const handleToolSelect = (tool) => {
    if (tool.requiresData && !datasetLoaded) return;
    setActiveTool(tool.key);
    navigate(tool.path);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        bgcolor: COLORS.canvas,
        background: 'radial-gradient(circle at top left, #ffffff 0%, #eef2f7 48%, #e6ebf2 100%)',
      }}
    >
      <Box
        sx={{
          width: isSidebarOpen ? 280 : 78,
          bgcolor: COLORS.sidebar,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 180ms ease',
          position: 'relative',
          borderRight: `1px solid ${COLORS.sidebarBorder}`,
          boxShadow: '18px 0 42px rgba(2, 6, 23, 0.22)',
          zIndex: 2,
        }}
      >
        <FadeIn duration={0.35}>
          <Box
            sx={{
              p: 3,
              borderBottom: `1px solid ${COLORS.sidebarBorder}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              minHeight: 86,
            }}
          >
            <Box
              component="img"
              src={SentinelLogo}
              alt="FCIP"
              sx={{
                width: 28,
                height: 28,
                flexShrink: 0,
                filter: 'brightness(0) invert(1)',
              }}
            />
            {isSidebarOpen && (
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontWeight: 800,
                    color: '#ffffff',
                    letterSpacing: '0.22em',
                    lineHeight: 1.1,
                  }}
                >
                  FCIP
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    mt: 0.75,
                    display: 'block',
                    color: '#94a3b8',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                >
                  {activeEnv}
                </Typography>
              </Box>
            )}
          </Box>
        </FadeIn>

        <FadeIn delay={0.05} duration={0.35}>
          <Box sx={{ px: 3, py: 2.5 }}>
            {isSidebarOpen && (
              <>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#7c8aa5',
                    display: 'block',
                    textTransform: 'uppercase',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  Workspace
                </Typography>
                <Typography sx={{ mt: 0.9, fontWeight: 700, color: '#f8fafc' }}>
                  {username}
                </Typography>
                <Typography variant="caption" sx={{ color: '#a8b4c8' }}>
                  {userRole || 'Analyst'}
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    p: 1.25,
                    borderRadius: 2,
                    bgcolor: alpha('#ffffff', 0.05),
                    border: `1px solid ${alpha('#ffffff', 0.08)}`,
                  }}
                >
                  <Typography sx={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700 }}>
                    Active environment
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.35 }}>
                    {activeEnv}
                  </Typography>
                </Box>
              </>
            )}
          </Box>
        </FadeIn>

        <Box sx={{ flex: 1 }} />

        <List dense sx={{ px: 2, pb: 2 }}>
          {isAdmin && (
            <ListItemButton
              onClick={() => navigate('/admin')}
              sx={{
                borderRadius: 1.5,
                mb: 0.75,
                justifyContent: isSidebarOpen ? 'flex-start' : 'center',
                '&:hover': { bgcolor: alpha('#ffffff', 0.08) },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: '#cbd5e1' }}>
                <AdminPanelSettings fontSize="small" />
              </ListItemIcon>
              {isSidebarOpen && (
                <ListItemText
                  primary="Admin Console"
                  primaryTypographyProps={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: 600 }}
                />
              )}
            </ListItemButton>
          )}

          <ListItemButton
            onClick={disconnectEnv}
            sx={{
              borderRadius: 1.5,
              mb: 0.75,
              justifyContent: isSidebarOpen ? 'flex-start' : 'center',
              '&:hover': { bgcolor: alpha('#ffffff', 0.08) },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: '#cbd5e1' }}>
              <ArrowBack fontSize="small" />
            </ListItemIcon>
            {isSidebarOpen && (
              <ListItemText
                primary="Switch Environment"
                primaryTypographyProps={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: 600 }}
              />
            )}
          </ListItemButton>

          <ListItemButton
            onClick={handleLogout}
            sx={{
              borderRadius: 1.5,
              justifyContent: isSidebarOpen ? 'flex-start' : 'center',
              '&:hover': { bgcolor: alpha('#ffffff', 0.08) },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: '#cbd5e1' }}>
              <Logout fontSize="small" />
            </ListItemIcon>
            {isSidebarOpen && (
              <ListItemText
                primary="Sign Out"
                primaryTypographyProps={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: 600 }}
              />
            )}
          </ListItemButton>
        </List>

        <IconButton
          onClick={() => setSidebarOpen((value) => !value)}
          sx={{
            position: 'absolute',
            top: '50%',
            right: -12,
            transform: 'translateY(-50%)',
            bgcolor: '#182234',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)',
            width: 28,
            height: 28,
            boxShadow: '0 8px 16px rgba(2, 6, 23, 0.30)',
            '&:hover': { bgcolor: '#22324a' },
          }}
        >
          <MenuOpen
            fontSize="small"
            sx={{
              transform: isSidebarOpen ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.2s ease',
            }}
          />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <FadeIn duration={0.35}>
          <Box
            sx={{
              px: { xs: 2.5, md: 4 },
              py: 2.5,
              bgcolor: alpha('#ffffff', 0.72),
              backdropFilter: 'blur(14px)',
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: COLORS.muted, textTransform: 'uppercase' }}>
              Module Selection
            </Typography>
            <Typography sx={{ mt: 0.6, fontSize: { xs: 24, md: 30 }, fontWeight: 800, color: COLORS.text }}>
              Choose the workspace for this environment
            </Typography>
            <Typography sx={{ mt: 1, maxWidth: 880, fontSize: 14, color: COLORS.muted, lineHeight: 1.7 }}>
              Each module runs against the currently selected environment. UI transitions now follow the same animation language used in login and environment selection, and ready modules open directly into their workbench.
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label={`${readyCount} modules ready`}
                sx={{
                  bgcolor: '#ffffff',
                  color: COLORS.text,
                  border: `1px solid ${COLORS.border}`,
                  fontWeight: 700,
                }}
              />
              <Chip
                label={`Environment: ${activeEnv}`}
                sx={{
                  bgcolor: alpha(COLORS.orange, 0.08),
                  color: COLORS.orange,
                  border: `1px solid ${alpha(COLORS.orange, 0.14)}`,
                  fontWeight: 700,
                }}
              />
            </Box>
          </Box>
        </FadeIn>

        <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2.5, md: 4 }, py: 3.5 }}>
          <FadeIn delay={0.08} duration={0.35}>
            <Paper
              variant="outlined"
              sx={{
                mb: 3,
                p: 2.25,
                borderRadius: 3,
                borderColor: COLORS.border,
                bgcolor: alpha('#ffffff', 0.78),
                boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: COLORS.muted, textTransform: 'uppercase' }}>
                Available Modules
              </Typography>
              <Typography sx={{ mt: 0.75, fontSize: 14, color: COLORS.muted, lineHeight: 1.7 }}>
                Select the module that matches the workflow you want to run next. Locked modules require an active environment before navigation.
              </Typography>
            </Paper>
          </FadeIn>

          <MotionContainer>
            <Grid container spacing={2.25} alignItems="stretch">
              {tools.map((tool) => {
                const isLocked = tool.locked || (tool.requiresData && !datasetLoaded);
                const Icon = tool.icon;

                return (
                  <Grid key={tool.key} size={{ xs: 12, md: 6, xl: 4 }}>
                    <MotionItem sx={{ height: '100%' }}>
                      <Paper
                        elevation={0}
                        variant="outlined"
                        onClick={() => !isLocked && handleToolSelect(tool)}
                        sx={{
                          height: '100%',
                          minHeight: TOOL_CARD_MIN_HEIGHT,
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: 3,
                          overflow: 'hidden',
                          cursor: isLocked ? 'not-allowed' : 'pointer',
                          bgcolor: COLORS.panel,
                          borderColor: alpha(tool.color, 0.20),
                          opacity: isLocked ? 0.72 : 1,
                          boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)',
                          transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
                          '&:hover': !isLocked && {
                            transform: 'translateY(-4px)',
                            borderColor: tool.color,
                            boxShadow: `0 20px 40px ${alpha(tool.color, 0.18)}`,
                          },
                        }}
                      >
                        <Box sx={{ height: 5, bgcolor: tool.color }} />
                        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.25 }}>
                            <Box
                              sx={{
                                width: 52,
                                height: 52,
                                borderRadius: tool.key === 'btsy' ? '50%' : 2.5,
                                bgcolor: alpha(tool.color, 0.10),
                                color: tool.color,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: `1px solid ${alpha(tool.color, 0.16)}`,
                                flexShrink: 0,
                              }}
                            >
                              <Icon sx={{ fontSize: tool.key === 'btsy' ? 20 : 24 }} />
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <Chip
                                size="small"
                                label={tool.badge}
                                sx={{
                                  bgcolor: alpha(tool.color, 0.08),
                                  color: tool.color,
                                  fontWeight: 700,
                                  border: `1px solid ${alpha(tool.color, 0.14)}`,
                                }}
                              />
                              {isLocked ? (
                                <Chip
                                  size="small"
                                  icon={<Lock sx={{ fontSize: '0.85rem !important' }} />}
                                  label="Locked"
                                  sx={{ bgcolor: '#f3f4f6', color: COLORS.muted, fontWeight: 700 }}
                                />
                              ) : (
                                <Chip
                                  size="small"
                                  label="Ready"
                                  sx={{ bgcolor: '#edf9f1', color: '#166534', fontWeight: 700 }}
                                />
                              )}
                            </Box>
                          </Box>

                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>
                              {tool.name}
                            </Typography>
                            <Typography sx={{ mt: 1.1, fontSize: 13.5, color: COLORS.muted, lineHeight: 1.7 }}>
                              {tool.description}
                            </Typography>
                          </Box>

                          <Divider />

                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontSize: 12, color: COLORS.muted, fontWeight: 600 }}>
                              {isLocked ? 'Activate an environment to continue' : 'Open workspace'}
                            </Typography>
                            {!isLocked && (
                              <Box
                                sx={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  bgcolor: alpha(tool.color, 0.10),
                                  color: tool.color,
                                }}
                              >
                                <ChevronRight sx={{ fontSize: 20 }} />
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </Paper>
                    </MotionItem>
                  </Grid>
                );
              })}
            </Grid>
          </MotionContainer>
        </Box>
      </Box>
    </Box>
  );
};

export default ToolSelectScreen;
