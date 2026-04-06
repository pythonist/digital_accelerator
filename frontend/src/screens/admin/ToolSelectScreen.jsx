import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import IconButton from '@mui/material/IconButton';
import {
  Logout,
  ArrowBack,
  AdminPanelSettings,
  Lock,
  Analytics,
  Tune,
  BlurCircular,
  ChevronRight,
  Circle,
  AccountBalance,
  MenuOpen,
  Science,
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext';
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';

const colors = {
  bg: '#F2F2F2',
  sidebar: '#1E1E1E',
  border: '#e0e0e0',
  textPrimary: '#1E1E1E',
  textSecondary: '#6b778c',
  pwcOrange: '#D04A02',
};

const ToolSelectScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeEnv,
    setActiveTool,
    disconnectEnv,
    handleLogout,
    username,
    userRole,
    datasetLoaded,
  } = useAppContext();

  const isAdmin = userRole === 'TENANT_ADMIN';
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!activeEnv) {
      navigate('/environments');
    }
  }, [activeEnv, navigate]);

  useEffect(() => {
    setActiveTool((previousTool) => (previousTool == null ? previousTool : null));
  }, [location.pathname, setActiveTool]);

  const tools = useMemo(() => ([
    {
      key: 'investigation',
      name: 'Sentinel',
      description: 'AI-assisted, human-in-the-loop support for Advanced Analytics',
      icon: Analytics,
      color: '#D04A02',
      requiresData: false,
      path: '/investigation',
    },
    {
      key: 'calibration',
      name: 'Cortex',
      description: 'AI-assisted environment for rule optimization, threshold tuning, scenario simulation, and performance impact analysis',
      icon: Tune,
      color: '#00A152',
      path: '/calibration',
      locked: !activeEnv,
    },
    {
      key: 'mule_detection',
      name: 'Mule Detection Intelligence',
      description: 'Interactive behavioral pattern analysis for money mule detection with flow timeline, pass-through analysis, and real-time recomputation',
      icon: AccountBalance,
      color: '#0284c7',
      path: '/mule',
      locked: !activeEnv,
    },
    {
      key: 'btsy',
      name: 'Cortex V2',
      description: 'Bank Threshold Simulation Tool - data-driven threshold calibration, scenario simulation, and impact analysis for AML rule optimization',
      icon: BlurCircular,
      color: '#D04A02',
      path: '/btsy',
      locked: !activeEnv,
    },
    {
      key: 'mlops',
      name: 'ML Ops Workbench',
      description: 'Feature engineering, training, validation, threshold tuning, deployment monitoring, and model governance in one AML workbench',
      icon: Science,
      color: '#7A4BC2',
      path: '/mlops',
      locked: !activeEnv,
    },
  ]), [activeEnv]);

  const handleToolSelect = (tool) => {
    if (tool.requiresData && !datasetLoaded) return;
    setActiveTool(tool.key);
    navigate(tool.path);
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100%', bgcolor: colors.bg }}>
      <Box
        sx={{
          width: isSidebarOpen ? 260 : 72,
          bgcolor: colors.sidebar,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 0.2s ease',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            p: 3,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Box
            component="img"
            src={SentinelLogo}
            alt="Sentinel"
            sx={{
              width: 28,
              height: 28,
              flexShrink: 0,
              filter: 'brightness(0) invert(1)',
            }}
          />

          {isSidebarOpen && (
            <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1, flex: 1 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 800,
                  lineHeight: 1.1,
                  color: '#ffffff',
                  letterSpacing: '0.22em',
                }}
              >
                FCIP
              </Typography>

              <Typography
                variant="caption"
                sx={{
                  mt: 0.75,
                  color: '#94a3b8',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                }}
              >
                {activeEnv}
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ p: 3 }}>
          {isSidebarOpen && (
            <Typography variant="caption" sx={{ color: '#718096', mb: 0.5, display: 'block', textTransform: 'uppercase', fontSize: '0.7rem' }}>
              Logged in as
            </Typography>
          )}

          {isSidebarOpen && (
            <Typography variant="body2" sx={{ fontWeight: 500, color: '#fff' }}>
              {username}
            </Typography>
          )}

          {isSidebarOpen && (
            <Typography variant="caption" sx={{ color: '#a0aec0' }}>
              {userRole || 'Analyst'}
            </Typography>
          )}
        </Box>

        <Box sx={{ flex: 1 }} />

        <List dense sx={{ px: 2, pb: 2 }}>
          {isAdmin && (
            <ListItemButton onClick={() => navigate('/admin')} sx={{ borderRadius: 1, mb: 0.5, justifyContent: isSidebarOpen ? 'flex-start' : 'center' }}>
              <ListItemIcon sx={{ minWidth: 36, color: '#a0aec0' }}><AdminPanelSettings fontSize="small" /></ListItemIcon>
              {isSidebarOpen && <ListItemText primary="Admin Console" primaryTypographyProps={{ fontSize: '0.85rem', color: '#e2e8f0' }} />}
            </ListItemButton>
          )}

          <ListItemButton onClick={disconnectEnv} sx={{ borderRadius: 1, mb: 0.5, justifyContent: isSidebarOpen ? 'flex-start' : 'center' }}>
            <ListItemIcon sx={{ minWidth: 36, color: '#a0aec0' }}><ArrowBack fontSize="small" /></ListItemIcon>
            {isSidebarOpen && <ListItemText primary="Switch Environment" primaryTypographyProps={{ fontSize: '0.85rem', color: '#e2e8f0' }} />}
          </ListItemButton>

          <ListItemButton onClick={handleLogout} sx={{ borderRadius: 1, justifyContent: isSidebarOpen ? 'flex-start' : 'center' }}>
            <ListItemIcon sx={{ minWidth: 36, color: '#a0aec0' }}><Logout fontSize="small" /></ListItemIcon>
            {isSidebarOpen && <ListItemText primary="Sign Out" primaryTypographyProps={{ fontSize: '0.85rem', color: '#e2e8f0' }} />}
          </ListItemButton>
        </List>

        <IconButton
          onClick={() => setSidebarOpen((v) => !v)}
          sx={{
            position: 'absolute',
            top: '50%',
            right: -12,
            transform: 'translateY(-50%)',
            bgcolor: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)',
            width: 28,
            height: 28,
            '&:hover': { bgcolor: '#111827' },
          }}
        >
          <MenuOpen fontSize="small" sx={{ transform: isSidebarOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s ease' }} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ px: 4, py: 2, bgcolor: '#fff', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', height: 64 }}>
          <Typography variant="h6" sx={{ color: colors.textPrimary, fontWeight: 600 }}>
            Module Selection
          </Typography>
        </Box>

        <Box sx={{ p: 4, overflowY: 'auto' }}>
          <Typography
            variant="body2"
            sx={{
              mb: 2,
              color: colors.textSecondary,
              fontWeight: 500,
            }}
          >
            AVAILABLE MODULES
          </Typography>

          <Grid container spacing={2} alignItems="stretch">
            {tools.map((tool) => {
              const isLocked = tool.locked || (tool.requiresData && !datasetLoaded);
              const Icon = tool.icon;

              return (
                <Grid key={tool.key} size={{ xs: 12, md: 6, lg: 4 }}>
                  <Paper
                    elevation={0}
                    variant="outlined"
                    onClick={() => !isLocked && handleToolSelect(tool)}
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      border: `1px solid ${colors.border}`,
                      borderRadius: '4px',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      bgcolor: isLocked ? '#f9f9f9' : '#fff',
                      opacity: isLocked ? 0.7 : 1,
                      transition: 'border-color 0.2s, background-color 0.2s',
                      '&:hover': !isLocked && {
                        borderColor: tool.color || colors.pwcOrange,
                        bgcolor: '#fafbfc',
                      },
                    }}
                  >
                    <Box
                      sx={{
                        p: 2.5,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2,
                        flex: 1,
                      }}
                    >
                      <Box
                        sx={{
                          mt: 0.5,
                          color: isLocked ? colors.textSecondary : tool.color || colors.pwcOrange,
                        }}
                      >
                        <Icon fontSize="medium" />
                      </Box>

                      <Box sx={{ flex: 1 }}>
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            mb: 0.5,
                          }}
                        >
                          <Typography
                            variant="subtitle2"
                            sx={{
                              fontWeight: 700,
                              color: colors.textPrimary,
                            }}
                          >
                            {tool.name}
                          </Typography>

                          {isLocked ? (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                bgcolor: '#ebecf0',
                                px: 1,
                                py: 0.25,
                                borderRadius: '2px',
                              }}
                            >
                              <Lock sx={{ fontSize: 12, color: colors.textSecondary }} />
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  color: colors.textSecondary,
                                }}
                              >
                                LOCKED
                              </Typography>
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                              }}
                            >
                              <Circle sx={{ fontSize: 8, color: '#36b37e' }} />
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  color: '#36b37e',
                                }}
                              >
                                READY
                              </Typography>
                            </Box>
                          )}
                        </Box>

                        <Typography
                          variant="body2"
                          sx={{
                            color: colors.textSecondary,
                            fontSize: '0.875rem',
                            lineHeight: 1.5,
                          }}
                        >
                          {tool.description}
                        </Typography>
                      </Box>

                      {!isLocked && (
                        <ChevronRight
                          sx={{
                            color: colors.textSecondary,
                            fontSize: 20,
                            mt: 0.5,
                          }}
                        />
                      )}
                    </Box>

                    <Divider />
                    <Box
                      sx={{
                        px: 2.5,
                        py: 1,
                        bgcolor: isLocked ? 'transparent' : '#f4f5f7',
                        display: 'flex',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          color: colors.textSecondary,
                          fontSize: '0.7rem',
                        }}
                      >
                        Open module
                      </Typography>
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      </Box>
    </Box>
  );
};

export default ToolSelectScreen;
