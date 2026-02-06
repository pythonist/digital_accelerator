// frontend/src/tools/mule_detection/layout/Sidebar_Final.jsx
// Complete sidebar with all ML Intelligence screens
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
  Visibility, Settings, Speed, TrendingUp, AutoAwesome, Science,
  CompareArrows, BubbleChart, AccountTree
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
    type: 'divider',
    label: 'DATA MODULE'
  },
  { 
    id: 'upload', 
    label: 'Upload Data', 
    icon: <CloudUpload fontSize="small" />, 
    requiresData: false 
  },
  { 
    id: 'data-introspection', 
    label: 'Data Introspection', 
    icon: <Assessment fontSize="small" />, 
    requiresData: true 
  },
  {
    type: 'divider',
    label: 'ACCOUNT ANALYSIS'
  },
  {
    id: 'account-analysis',
    label: 'Account Analysis',
    icon: <Dashboard fontSize="small" />,
    requiresData: true
  },
  {
    id: 'risk-dashboard',
    label: 'Risk Dashboard',
    icon: <TrendingUp fontSize="small" />,
    requiresData: true
  },
  {
    type: 'divider',
    label: 'ML PIPELINE'
  },
  {
    id: 'feature-engineering',
    label: 'Feature Engineering',
    icon: <Science fontSize="small" />,
    requiresData: true
  },
  {
    id: 'feature-store',
    label: 'Feature Store',
    icon: <Storage fontSize="small" />,
    requiresData: true
  },
  {
    id: 'feature-explorer',
    label: 'Feature Explorer',
    icon: <Visibility fontSize="small" />,
    requiresData: true
  },
  {
    id: 'train-model',
    label: 'Train Model',
    icon: <Settings fontSize="small" />,
    requiresData: true
  },
  {
    id: 'inference',
    label: 'Inference',
    icon: <Speed fontSize="small" />,
    requiresData: true
  },
  {
    id: 'explainability',
    label: 'Explainability (SHAP)',
    icon: <Psychology fontSize="small" />,
    requiresData: true
  },
  {
    type: 'divider',
    label: 'RULES & NETWORK'
  },
  {
    id: 'rule-engine',
    label: 'Rule Engine',
    icon: <CompareArrows fontSize="small" />,
    requiresData: true
  },
  {
    id: 'hybrid-scoring',
    label: 'Hybrid Scoring',
    icon: <TrendingUp fontSize="small" />,
    requiresData: true
  },
  {
    id: 'network-graph',
    label: 'Network Graph (3D)',
    icon: <AccountTree fontSize="small" />,
    requiresData: true
  },
  {
    id: 'pattern-analysis',
    label: 'Pattern Analysis',
    icon: <BubbleChart fontSize="small" />,
    requiresData: true
  }
];

const Sidebar = ({ activeScreen, setActiveScreen, hasData, hasMLModel, dataStats }) => {
  const { activeBankName } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mlSubmenuOpen, setMlSubmenuOpen] = useState(true);

  const isItemAccessible = (item) => {
    return !item.requiresData || hasData;
  };

  const handleItemClick = (itemId, hasSubmenu) => {
    if (hasSubmenu) {
      setMlSubmenuOpen(!mlSubmenuOpen);
    } else {
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
    if (item.id === 'ml-parent' && item.badge && hasMLModel) {
      return 'ACTIVE';
    }
    return null;
  };

  const getBadgeColor = (item) => {
    if (item.id === 'ml-parent') {
      return '#22c55e';
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
              Mule Detection
            </Typography>
          </Box>
        )}
      </Box>

      {/* Environment Info */}
      {!isCollapsed && dataStats && (
        <Box sx={{ px: 2.5, py: 1.5, mb: 1 }}>
          <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, mb: 0.5, display: 'block' }}>
            ENVIRONMENT
          </Typography>
          <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.75rem', display: 'block', mb: 0.5 }}>
            {activeBankName || 'FCIP'}
          </Typography>
          
          {dataStats.num_accounts && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Chip 
                label={`${dataStats.num_accounts} accounts`}
                size="small"
                sx={{ 
                  height: 20, 
                  fontSize: '0.65rem', 
                  bgcolor: 'rgba(59, 130, 246, 0.15)', 
                  color: '#60a5fa',
                  '& .MuiChip-label': { px: 1 }
                }} 
              />
              {hasMLModel && (
                <Chip 
                  label="ML Active"
                  size="small"
                  sx={{ 
                    height: 20, 
                    fontSize: '0.65rem', 
                    bgcolor: 'rgba(34, 197, 94, 0.15)', 
                    color: '#4ade80',
                    '& .MuiChip-label': { px: 1 }
                  }} 
                />
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Main Navigation */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', px: 1.5 }}>
        <List sx={{ py: 0 }}>
          {menuItems.map((item, index) => {
            // Handle dividers
            if (item.type === 'divider') {
              return (
                <React.Fragment key={`divider-${index}`}>
                  {!isCollapsed && (
                    <Box sx={{ px: 1, pt: 2, pb: 1 }}>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: '#64748b', 
                          fontWeight: 700, 
                          fontSize: '0.65rem',
                          letterSpacing: '0.1em'
                        }}
                      >
                        {item.label}
                      </Typography>
                    </Box>
                  )}
                  {isCollapsed && <Divider sx={{ my: 1, borderColor: alpha('#fff', 0.05) }} />}
                </React.Fragment>
              );
            }

            // Handle submenu parent
            if (item.hasSubmenu) {
              const isAnySubmenuActive = item.submenu?.some(sub => activeScreen === sub.id);
              const badge = getBadgeForItem(item);
              const badgeColor = getBadgeColor(item);

              return (
                <React.Fragment key={item.id}>
                  <ListItem disablePadding sx={{ display: 'block', mb: 0.5 }}>
                    <Tooltip 
                      title={isCollapsed ? (!isItemAccessible(item) ? "Upload data first" : item.label) : ""} 
                      placement="right" 
                      arrow
                    >
                      <span>
                        <ListItemButton
                          disabled={!isItemAccessible(item)}
                          onClick={() => handleItemClick(item.id, true)}
                          sx={{
                            minHeight: 36,
                            justifyContent: isCollapsed ? 'center' : 'initial',
                            px: 2.5,
                            borderRadius: 1,
                            transition: 'all 0.15s ease',
                            
                            ...(isAnySubmenuActive && {
                              bgcolor: 'rgba(234, 88, 12, 0.08)',
                              color: '#fb923c',
                            }),

                            ...(!isAnySubmenuActive && {
                              color: '#94a3b8',
                              '&:hover': {
                                bgcolor: 'rgba(255, 255, 255, 0.03)',
                                color: '#cbd5e1'
                              }
                            }),

                            ...(!isItemAccessible(item) && {
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
