import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AppBar,
  Avatar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  Collapse,
  alpha,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  ArrowBack,
  ChevronLeft,
  ChevronRight,
  Dns,
  ExpandLess,
  ExpandMore,
  HelpOutline,
  Logout,
  Person,
  Settings,
} from '@mui/icons-material';
import SentinelLogo from '@assets/PwC_2025_Logo.svg';

const HEADER_HEIGHT = 36;
const DRAWER_WIDTH = 280;
const DRAWER_COLLAPSED_WIDTH = 72;

const StyledDrawer = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})(({ theme, open }) => ({
  width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  '& .MuiDrawer-paper': {
    position: 'relative',
    height: '100%',
    overflow: 'visible',
    width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    background: 'linear-gradient(180deg, #0f172a 0%, #111827 42%, #162133 100%)',
    color: '#f8fafc',
    borderRight: `1px solid ${alpha('#fff', 0.1)}`,
    zIndex: 10,
    boxShadow: '18px 0 40px rgba(15, 23, 42, 0.26)',
  },
}));

const GroupHeader = styled(ListItemButton)(({ theme }) => ({
  backgroundColor: 'transparent',
  paddingTop: theme.spacing(2.5),
  paddingBottom: theme.spacing(1.5),
  '&:hover': {
    backgroundColor: alpha('#fff', 0.05),
  },
}));

const SharedWorkbenchLayout = ({
  children,
  moduleLabel,
  activeScreen,
  setActiveScreen,
  sections,
  username,
  activeEnvironment,
  onBackToTools,
  onLogout,
  accentColor = '#cbd5e1',
  navShape = 'rounded',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [anchorElUser, setAnchorElUser] = useState(null);
  const isSharp = navShape === 'sharp';

  const initialGroups = useMemo(() => {
    const seed = {};
    for (const section of sections || []) {
      seed[section.key] = true;
    }
    return seed;
  }, [sections]);
  const [openGroups, setOpenGroups] = useState(initialGroups);

  const handleGroupToggle = (key) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleItemClick = (item) => {
    if (item?.disabled) return;
    setActiveScreen(item.id);
  };

  const activeItemLabel = useMemo(() => {
    for (const section of sections || []) {
      const found = (section.items || []).find((item) => item.id === activeScreen);
      if (found) return found.label;
    }
    return '';
  }, [activeScreen, sections]);

  return (
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <CssBaseline />

      <StyledDrawer variant="permanent" open={!isCollapsed}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            right: -12,
            transform: 'translateY(-50%)',
            zIndex: 1300,
          }}
        >
          <IconButton
            size="small"
            onClick={() => setIsCollapsed((prev) => !prev)}
            sx={{
              bgcolor: '#182234',
              color: '#e5e7eb',
              border: '1px solid #334155',
              width: 24,
              height: 24,
              boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
              '&:hover': {
                bgcolor: '#22324a',
                color: '#ffffff',
              },
            }}
          >
            {isCollapsed ? <ChevronRight sx={{ fontSize: 14 }} /> : <ChevronLeft sx={{ fontSize: 14 }} />}
          </IconButton>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
            '&::-webkit-scrollbar': { width: '4px' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: '4px' },
          }}
        >
          <Box
            component={motion.div}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            sx={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              px: isCollapsed ? 2 : 3,
              borderBottom: '1px solid',
              borderColor: alpha('#fff', 0.1),
              mb: 1,
              flexShrink: 0,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0))',
            }}
          >
            <Box
              component="img"
              src={SentinelLogo}
              alt="FCIP"
              sx={{ width: 28, height: 28, filter: 'brightness(0) invert(1)' }}
            />
            {!isCollapsed && (
              <Box sx={{ ml: 2, display: 'flex', flexDirection: 'column' }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 800,
                    lineHeight: 1,
                    color: '#f8fafc',
                    letterSpacing: '0.22em',
                  }}
                >
                  FCIP
                </Typography>

                <Typography
                  variant="caption"
                  sx={{
                    mt: 0.4,
                    color: '#94a3b8',
                    fontSize: '0.675rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                  }}
                >
                  {activeEnvironment || 'Workspace'}
                </Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ flex: 1 }}>
            {(sections || []).map((section, sectionIndex) => (
              <Box
                key={section.key}
                component={motion.div}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, delay: sectionIndex * 0.04 }}
              >
              <List disablePadding>
                {!isCollapsed && (
                  <GroupHeader onClick={() => handleGroupToggle(section.key)}>
                    <ListItemText
                      primary={section.label}
                      primaryTypographyProps={{
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        letterSpacing: '1px',
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                      }}
                    />
                    {openGroups[section.key] ? (
                      <ExpandLess sx={{ fontSize: 18, color: '#94a3b8' }} />
                    ) : (
                      <ExpandMore sx={{ fontSize: 18, color: '#94a3b8' }} />
                    )}
                  </GroupHeader>
                )}

                {isCollapsed && <Divider sx={{ my: 1.5, borderColor: alpha('#fff', 0.1), mx: 2 }} />}

                <Collapse in={isCollapsed ? true : !!openGroups[section.key]} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {(section.items || []).map((item) => {
                      const active = activeScreen === item.id;
                      const disabled = !!item.disabled;
                      const IconComp = item.icon;
                      return (
                        <ListItem
                          key={item.id}
                          disablePadding
                          sx={{ display: 'block', mb: isSharp ? 0.35 : 0.5 }}
                          component={motion.li}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: sectionIndex * 0.04 }}
                        >
                          <Tooltip title={isCollapsed ? item.label : ''} placement="right" arrow>
                            <span>
                              <ListItemButton
                                disabled={disabled}
                                onClick={() => handleItemClick(item)}
                                sx={{
                                  minHeight: 36,
                                  justifyContent: isCollapsed ? 'center' : 'initial',
                                  px: 2.5,
                                  py: 0.75,
                                  mx: 1.5,
                                  borderRadius: isSharp ? 1 : 2,
                                  transition: 'all 0.18s ease',
                                  position: 'relative',
                                  ...(active && {
                                    bgcolor: item.highlight ? alpha('#f59e0b', 0.16) : alpha(accentColor, isSharp ? 0.18 : 0.14),
                                    color: '#f8fafc',
                                    fontWeight: 600,
                                    boxShadow: isSharp
                                      ? `inset 0 0 0 1px ${alpha(accentColor, 0.24)}`
                                      : 'inset 0 0 0 1px rgba(255,255,255,0.05)',
                                    '&::before': {
                                      content: '""',
                                      position: 'absolute',
                                      left: 8,
                                      top: 8,
                                      bottom: 8,
                                      width: 3,
                                      borderRadius: isSharp ? 1 : 999,
                                      bgcolor: item.highlight ? '#f59e0b' : accentColor,
                                    },
                                  }),
                                  ...(!active && {
                                    color: '#94a3b8',
                                    '&:hover': {
                                      bgcolor: alpha(accentColor, isSharp ? 0.1 : 0.08),
                                      color: '#e2e8f0',
                                      transform: `translateX(${isSharp ? 1 : 2}px)`,
                                    },
                                  }),
                                }}
                              >
                                <ListItemIcon
                                  sx={{
                                    minWidth: 0,
                                    mr: isCollapsed ? 0 : 2,
                                    justifyContent: 'center',
                                    color: 'inherit !important',
                                    '& .MuiSvgIcon-root': {
                                      fontSize: 18,
                                      color: 'inherit !important',
                                    },
                                  }}
                                >
                                  {IconComp ? <IconComp fontSize="small" /> : null}
                                </ListItemIcon>
                                <ListItemText
                                  primary={item.label}
                                  primaryTypographyProps={{
                                    fontSize: '0.8rem',
                                    fontWeight: active ? 600 : 400,
                                    lineHeight: 1.2,
                                    whiteSpace: 'normal',
                                    overflow: 'visible',
                                    textOverflow: 'clip',
                                    wordBreak: 'break-word',
                                  }}
                                  sx={{ opacity: isCollapsed ? 0 : 1 }}
                                />
                              </ListItemButton>
                            </span>
                          </Tooltip>
                        </ListItem>
                      );
                    })}
                  </List>
                </Collapse>
              </List>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              p: 2,
              borderTop: '1px solid',
              borderColor: alpha('#fff', 0.1),
              bgcolor: 'rgba(15, 23, 42, 0.5)',
              display: 'flex',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.6875rem', fontWeight: 500 }}>
              {isCollapsed ? 'Ready' : 'Workspace Status: Ready'}
            </Typography>
          </Box>
        </Box>
      </StyledDrawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar
          position="static"
          elevation={0}
          sx={{
            background: 'linear-gradient(90deg, #111827 0%, #172032 60%, #1d2738 100%)',
            height: HEADER_HEIGHT,
            width: '100%',
            zIndex: (theme) => theme.zIndex.drawer + 1,
            borderRadius: 0,
            boxShadow: 'none',
            overflow: 'hidden',
            borderBottom: `1px solid ${alpha('#0f172a', 0.08)}`,
          }}
        >
          <Toolbar
            variant="dense"
            disableGutters
            sx={{
              minHeight: HEADER_HEIGHT,
              height: HEADER_HEIGHT,
              px: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <Tooltip title="Back to Tools">
                <IconButton size="small" onClick={onBackToTools} sx={{ color: 'white', p: 0.5 }}>
                  <ArrowBack sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>

              <Typography
                sx={{
                  color: 'white',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  lineHeight: 1,
                  userSelect: 'none',
                }}
              >
                <Box component="span" sx={{ fontWeight: 800, letterSpacing: 1.5 }}>FCIP</Box>
                <Box component="span" sx={{ mx: 1, opacity: 0.5 }}>|</Box>
                <Box component="span" sx={{ opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis' }}>{moduleLabel}</Box>
              </Typography>

              {activeEnvironment && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    ml: 1,
                    px: 1,
                    py: 0.25,
                    bgcolor: 'rgba(255,255,255,0.1)',
                    borderRadius: 1,
                  }}
                >
                  <Dns sx={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', mr: 0.5 }} />
                  <Typography sx={{ color: 'white', fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600 }}>
                    {activeEnvironment}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              {!isCollapsed && activeItemLabel && (
                <Box
                  sx={{
                    display: { xs: 'none', md: 'flex' },
                    alignItems: 'center',
                    px: 1.2,
                    py: 0.45,
                    borderRadius: 999,
                    bgcolor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    maxWidth: 260,
                  }}
                >
                  <Typography
                    sx={{
                      color: '#cbd5e1',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {activeItemLabel}
                  </Typography>
                </Box>
              )}

              <Tooltip title="Help">
                <IconButton size="small" sx={{ color: 'white', p: 0.5 }}>
                  <HelpOutline sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>

              <Divider orientation="vertical" sx={{ height: 14, bgcolor: 'rgba(255,255,255,0.3)' }} />

              <Tooltip title="Account">
                <IconButton
                  size="small"
                  onClick={(e) => setAnchorElUser(e.currentTarget)}
                  sx={{ color: 'white', p: 0.5 }}
                >
                  <Avatar
                    sx={{
                      width: 22,
                      height: 22,
                      bgcolor: 'rgba(255,255,255,0.2)',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                    }}
                  >
                    {username?.[0]?.toUpperCase() || 'U'}
                  </Avatar>
                </IconButton>
              </Tooltip>

              <Menu
                anchorEl={anchorElUser}
                open={Boolean(anchorElUser)}
                onClose={() => setAnchorElUser(null)}
                PaperProps={{ sx: { minWidth: 160, borderRadius: 1, mt: 1 } }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              >
                <MenuItem onClick={() => setAnchorElUser(null)}>
                  <ListItemIcon><Person fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Profile" />
                </MenuItem>
                <MenuItem onClick={() => setAnchorElUser(null)}>
                  <ListItemIcon><Settings fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Settings" />
                </MenuItem>
                <Divider />
                <MenuItem
                  sx={{ color: '#ef4444' }}
                  onClick={async () => {
                    setAnchorElUser(null);
                    if (onLogout) await onLogout();
                  }}
                >
                  <ListItemIcon sx={{ color: '#ef4444' }}><Logout fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Logout" />
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <Box
              key={String(activeScreen || moduleLabel || 'workspace')}
              component={motion.div}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              sx={{ minHeight: '100%' }}
            >
              {children}
            </Box>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  );
};

export default SharedWorkbenchLayout;
