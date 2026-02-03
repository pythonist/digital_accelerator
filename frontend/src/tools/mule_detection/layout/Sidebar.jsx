// frontend/src/tools/mule_detection/layout/Sidebar.jsx (UPDATED WITH ML SUBMENU)
import React, { useState } from 'react';
import SentinelLogo from '@assets/PwC_2025_Logo.svg';
import {
  Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Box, Typography, IconButton, Tooltip, alpha, Chip, Divider, Collapse
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  CloudUpload, Dashboard, Assessment, Storage, Psychology,
  Circle as StepIcon, ChevronLeft, ChevronRight, ExpandLess, ExpandMore,
  Visibility, Settings, Speed, TrendingUp
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext';

const DRAWER_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

const StyledDrawer = styled(Drawer, { 
  shouldForwardProp: (prop) => prop !== 'open' 
})(({ theme, open }) => ({
  width: open ? DRAWER_WIDTH : COLLAPSED_WIDTH,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  '& .MuiDrawer-paper': {
    position: 'relative',
    height: '100%',
    overflow: 'visible',
    width: open ? DRAWER_WIDTH : COLLAPSED_WIDTH,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRight: `1px solid ${alpha('#fff', 0.1)}`,
    zIndex: 10,
  },
}));

const menuItems = [
  { 
    id: 'dashboard', 
    label: 'Dashboard', 
    icon: <Dashboard fontSize="small" />, 
    requiresData: true 
  },
  { 
    id: 'upload', 
    label: 'Upload Data', 
    icon: <CloudUpload fontSize="small" />, 
    requiresData: false 
  },
  { 
    id: 'introspect', 
    label: 'Data Introspection', 
    icon: <Assessment fontSize="small" />, 
    requiresData: true 
  },
  {
    type: 'divider',
    label: 'ML LAYER'
  },
  { 
    id: 'ml-parent',
    label: 'ML Intelligence', 
    icon: <Psychology fontSize="small" />, 
    requiresData: true,
    badge: true,
    hasSubmenu: true,
    submenu: [
      {
        id: 'ml-overview',
        label: 'Overview',
        icon: <Visibility fontSize="small" />,
        requiresData: true
      },
      {
        id: 'ml-training',
        label: 'Training',
        icon: <Settings fontSize="small" />,
        requiresData: true
      },
      {
        id: 'ml-monitor',
        label: 'Monitor',
        icon: <TrendingUp fontSize="small" />,
        requiresData: true
      },
      {
        id: 'ml-decision',
        label: 'Decision Engine',
        icon: <Speed fontSize="small" />,
        requiresData: true
      }
    ]
  }
];

const Sidebar = ({ activeScreen, setActiveScreen, hasData, hasMLModel, dataStats }) => {
  const { activeBankName } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mlSubmenuOpen, setMlSubmenuOpen] = useState(true); // ML submenu expanded by default

  const isItemAccessible = (item) => {
    return !item.requiresData || hasData;
  };

  const handleItemClick = (itemId, hasSubmenu) => {
    if (hasSubmenu) {
      setMlSubmenuOpen(!mlSubmenuOpen);
    } else {
      // Helper to find item recursively
      const findItem = (items) => {
        for (const item of items) {
          if (item.id === itemId) return item;
          if (item.submenu) {
            const found = findItem(item.submenu);
            if (found) return found;
          }
        }
        return null;
      };

      const item = findItem(menuItems);
      if (item && isItemAccessible(item)) {
        setActiveScreen(itemId);
      }
    }
  };

  const getBadgeForItem = (item) => {
    if (item.id === 'ml-parent' && item.badge) {
      return hasMLModel ? 'ACTIVE' : 'NEW';
    }
    return null;
  };

  const getBadgeColor = (item) => {
    if (item.id === 'ml-parent') {
      return hasMLModel ? '#22c55e' : '#ea580c';
    }
    return '#ea580c';
  };

  return (
    <StyledDrawer variant="permanent" open={!isCollapsed}>
      {/* Collapse Toggle Button */}
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
          onClick={() => setIsCollapsed(!isCollapsed)}
          sx={{
            bgcolor: '#1e293b',
            color: '#e5e7eb',
            border: '1px solid #334155',
            width: 24,
            height: 24,
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            '&:hover': {
              bgcolor: '#334155',
              color: '#ffffff',
            },
          }}
        >
          {isCollapsed ? <ChevronRight sx={{ fontSize: 14 }} /> : <ChevronLeft sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      {/* Logo Section */}
      <Box
        sx={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          px: isCollapsed ? 2 : 3,
          borderBottom: '1px solid',
          borderColor: alpha('#fff', 0.1),
          mb: 1
        }}
      >
        <Box component="img" src={SentinelLogo} alt="Sentinel" sx={{ width: 28, height: 28, filter: 'brightness(0) invert(1)' }} />

        {!isCollapsed && (
          <Box sx={{ ml: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 800,
                fontSize: '0.9rem',
                lineHeight: 1,
                color: '#f8fafc',
                letterSpacing: '0.22em'
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
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: 'monospace',
                display: 'block'
              }}
            >
              {activeBankName || 'ENV'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Data Status Card */}
      {!isCollapsed && hasData && dataStats && (
        <Box sx={{ px: 2, py: 1, mb: 1 }}>
          <Box sx={{ 
            p: 1.5, 
            borderRadius: 1, 
            bgcolor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid',
            borderColor: 'rgba(16, 185, 129, 0.3)'
          }}>
            <Typography variant="caption" sx={{ 
              color: '#10b981', 
              fontWeight: 600,
              fontSize: '0.7rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}>
              <Storage sx={{ fontSize: 14 }} />
              {dataStats.account_count || 0} Accounts
            </Typography>
            <Typography variant="caption" sx={{ 
              color: '#94a3b8', 
              fontSize: '0.65rem',
              display: 'block',
              mt: 0.5
            }}>
              {(dataStats.txn_count || 0).toLocaleString()} Transactions
            </Typography>
            
            {/* ML Status Indicator */}
            {hasMLModel && (
              <Box sx={{ 
                mt: 1, 
                pt: 1, 
                borderTop: '1px solid rgba(16, 185, 129, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5
              }}>
                <Psychology sx={{ fontSize: 14, color: '#ea580c' }} />
                <Typography variant="caption" sx={{ 
                  color: '#ea580c', 
                  fontWeight: 600,
                  fontSize: '0.7rem'
                }}>
                  ML Active
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Menu Items */}
      <Box sx={{ 
        overflowY: 'auto', 
        overflowX: 'hidden', 
        flex: 1,
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: '4px' }
      }}>
        <List disablePadding sx={{ px: 1.5 }}>
          {menuItems.map((item, index) => {
            // Handle divider
            if (item.type === 'divider') {
              return (
                <Box key={`divider-${index}`} sx={{ my: 2 }}>
                  {!isCollapsed && (
                    <Divider 
                      sx={{ 
                        borderColor: alpha('#fff', 0.1),
                        '&::before, &::after': {
                          borderColor: alpha('#fff', 0.1)
                        }
                      }}
                    >
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: '#64748b', 
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          letterSpacing: '0.05em',
                          px: 1
                        }}
                      >
                        {item.label}
                      </Typography>
                    </Divider>
                  )}
                  {isCollapsed && (
                    <Box sx={{ 
                      height: '1px', 
                      bgcolor: alpha('#fff', 0.1),
                      mx: 1
                    }} />
                  )}
                </Box>
              );
            }

            // Handle menu items with submenu
            if (item.hasSubmenu) {
              const isAccessible = isItemAccessible(item);
              const badge = getBadgeForItem(item);
              const badgeColor = getBadgeColor(item);
              const isAnySubmenuActive = item.submenu.some(sub => activeScreen === sub.id);

              return (
                <React.Fragment key={item.id}>
                  <ListItem disablePadding sx={{ display: 'block', mb: 0.5 }}>
                    <Tooltip 
                      title={isCollapsed ? (!isAccessible ? "Upload data first" : item.label) : ""} 
                      placement="right" 
                      arrow
                    >
                      <span>
                        <ListItemButton
                          disabled={!isAccessible}
                          onClick={() => handleItemClick(item.id, true)}
                          sx={{
                            minHeight: 36,
                            justifyContent: isCollapsed ? 'center' : 'initial',
                            px: 2.5,
                            borderRadius: 1,
                            transition: 'all 0.15s ease',
                            color: isAnySubmenuActive ? '#fb923c' : '#94a3b8',
                            bgcolor: isAnySubmenuActive ? 'rgba(234, 88, 12, 0.08)' : 'transparent',
                            '&:hover': {
                              bgcolor: 'rgba(255, 255, 255, 0.03)',
                              color: '#cbd5e1'
                            },
                            ...(!isAccessible && {
                              opacity: 0.4
                            })
                          }}
                        >
                          <ListItemIcon
                            sx={{
                              minWidth: 0,
                              mr: isCollapsed ? 0 : 2,
                              justifyContent: 'center',
                              color: 'inherit',
                              '& .MuiSvgIcon-root': { fontSize: 18 }
                            }}
                          >
                            {item.icon}
                          </ListItemIcon>
                          
                          {!isCollapsed && (
                            <>
                              <ListItemText 
                                primary={item.label} 
                                primaryTypographyProps={{ 
                                  fontSize: '0.8125rem',
                                  fontWeight: isAnySubmenuActive ? 500 : 400
                                }}
                              />
                              
                              {badge && (
                                <Chip
                                  label={badge}
                                  size="small"
                                  sx={{
                                    height: 18,
                                    fontSize: '0.625rem',
                                    fontWeight: 600,
                                    bgcolor: badgeColor,
                                    color: 'white',
                                    mr: 1,
                                    '& .MuiChip-label': {
                                      px: 1
                                    }
                                  }}
                                />
                              )}
                              
                              {mlSubmenuOpen ? <ExpandLess /> : <ExpandMore />}
                            </>
                          )}
                        </ListItemButton>
                      </span>
                    </Tooltip>
                  </ListItem>

                  {/* Submenu Items */}
                  {!isCollapsed && (
                    <Collapse in={mlSubmenuOpen} timeout="auto" unmountOnExit>
                      <List disablePadding>
                        {item.submenu.map((subItem) => {
                          const isActive = activeScreen === subItem.id;
                          const isSubAccessible = isItemAccessible(subItem);

                          return (
                            <ListItem key={subItem.id} disablePadding sx={{ display: 'block' }}>
                              <ListItemButton
                                disabled={!isSubAccessible}
                                onClick={() => handleItemClick(subItem.id, false)}
                                sx={{
                                  minHeight: 32,
                                  pl: 6,
                                  pr: 2.5,
                                  borderRadius: 1,
                                  transition: 'all 0.15s ease',
                                  ...(isActive && {
                                    bgcolor: 'rgba(234, 88, 12, 0.15)',
                                    color: '#fb923c',
                                  }),
                                  ...(!isActive && {
                                    color: '#94a3b8',
                                    '&:hover': {
                                      bgcolor: 'rgba(255, 255, 255, 0.03)',
                                      color: '#cbd5e1'
                                    }
                                  }),
                                  ...(!isSubAccessible && {
                                    opacity: 0.4
                                  })
                                }}
                              >
                                <ListItemIcon
                                  sx={{
                                    minWidth: 0,
                                    mr: 1.5,
                                    color: 'inherit',
                                    '& .MuiSvgIcon-root': { fontSize: 16 }
                                  }}
                                >
                                  {subItem.icon}
                                </ListItemIcon>
                                
                                <ListItemText 
                                  primary={subItem.label} 
                                  primaryTypographyProps={{ 
                                    fontSize: '0.75rem',
                                    fontWeight: isActive ? 500 : 400
                                  }}
                                />
                                
                                {isActive && (
                                  <StepIcon sx={{ fontSize: 8, color: '#ea580c' }} />
                                )}
                              </ListItemButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    </Collapse>
                  )}
                </React.Fragment>
              );
            }

            // Handle regular menu items
            const isActive = activeScreen === item.id;
            const isAccessible = isItemAccessible(item);

            return (
              <ListItem key={item.id} disablePadding sx={{ display: 'block', mb: 0.5 }}>
                <Tooltip 
                  title={isCollapsed ? (!isAccessible ? "Upload data first" : item.label) : ""} 
                  placement="right" 
                  arrow
                >
                  <span>
                    <ListItemButton
                      disabled={!isAccessible}
                      onClick={() => handleItemClick(item.id, false)}
                      sx={{
                        minHeight: 36,
                        justifyContent: isCollapsed ? 'center' : 'initial',
                        px: 2.5,
                        borderRadius: 1,
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        
                        ...(isActive && {
                          bgcolor: 'rgba(234, 88, 12, 0.12)',
                          color: '#fb923c',
                          '&:before': {
                            content: '""',
                            position: 'absolute',
                            left: -6,
                            top: '12%',
                            height: '76%',
                            width: '3px',
                            borderRadius: '0 4px 4px 0',
                            backgroundColor: '#ea580c',
                            display: isCollapsed ? 'none' : 'block'
                          }
                        }),

                        ...(!isActive && {
                          color: '#94a3b8',
                          '&:hover': {
                            bgcolor: 'rgba(255, 255, 255, 0.03)',
                            color: '#cbd5e1'
                          }
                        }),

                        ...(!isAccessible && {
                          opacity: 0.4
                        })
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          mr: isCollapsed ? 0 : 2,
                          justifyContent: 'center',
                          color: 'inherit',
                          '& .MuiSvgIcon-root': { fontSize: 18 }
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      
                      <ListItemText 
                        primary={item.label} 
                        primaryTypographyProps={{ 
                          fontSize: '0.8125rem',
                          fontWeight: isActive ? 500 : 400
                        }}
                        sx={{ opacity: isCollapsed ? 0 : 1 }} 
                      />
                      
                      {isActive && !isCollapsed && (
                        <StepIcon sx={{ fontSize: 10, color: '#ea580c', ml: 'auto' }} />
                      )}
                    </ListItemButton>
                  </span>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {/* Status Footer */}
      <Box sx={{ 
        p: 2,
        borderTop: '1px solid',
        borderColor: alpha('#fff', 0.1),
        bgcolor: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        alignItems: 'center',
        gap: 1.5
      }}>
        <Box sx={{ 
          width: 6, 
          height: 6, 
          borderRadius: '50%', 
          bgcolor: '#22c55e'
        }} />
        {!isCollapsed && (
          <Box>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.6875rem', display: 'block', fontWeight: 400 }}>
              System Status
            </Typography>
            <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 500, fontSize: '0.75rem' }}>
              Active
            </Typography>
          </Box>
        )}
      </Box>
    </StyledDrawer>
  );
};

export default Sidebar;
