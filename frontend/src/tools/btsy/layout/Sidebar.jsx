// frontend/src/tools/btsy/layout/Sidebar.jsx
import React, { useState } from 'react';
import SentinelLogo from '@assets/PwC_2025_Logo.svg';
import {
  Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Divider, Box, Typography, IconButton, Tooltip, Collapse, alpha
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  CloudUpload as CloudUploadIcon,
  PlayArrow as PlayArrowIcon,
  Tune as TuneIcon,
  Inventory2Outlined as InventoryIcon,
  Psychology as PsychologyIcon,
  Assessment as AssessmentIcon,
  Notifications as NotificationsIcon,
  VerifiedUser as VerifiedUserIcon,
  SearchOff as SearchOffIcon,
  Timeline as TimelineIcon,
  WorkOutline as WorkOutlineIcon,
  Science as ScienceIcon,
  ChevronLeft,
  ChevronRight,
  ExpandLess,
  ExpandMore,
  FiberManualRecord,
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext';
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './layout.constants';

const StyledDrawer = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== 'open'
})(({ theme, open }) => ({
  width: open ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  '& .MuiDrawer-paper': {
    position: 'relative',
    height: '100%',
    overflow: 'visible',
    width: open ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRight: `1px solid ${alpha('#fff', 0.1)}`,
    zIndex: 10,
    borderRadius: 0
  },
}));

const GroupHeader = styled(ListItemButton)(({ theme }) => ({
  backgroundColor: 'transparent',
  paddingTop: theme.spacing(1.5),
  paddingBottom: theme.spacing(1),
  paddingLeft: theme.spacing(3),
  paddingRight: theme.spacing(2.5),
  minHeight: 32,
  '&:hover': {
    backgroundColor: alpha('#fff', 0.05),
  },
}));

const menuSections = [
  {
    key: 'FOUNDATION',
    label: 'Data Foundation',
    items: [
      { id: 'foundation', label: 'Foundation', icon: <CloudUploadIcon /> },
    ]
  },
  {
    key: 'CALIBRATION',
    label: 'Calibration',
    items: [
      { id: 'runs', label: 'Calibration Runs', icon: <PlayArrowIcon /> },
      { id: 'scenarios', label: 'Scenarios', icon: <AssessmentIcon /> },
      { id: 'universe', label: 'Transaction Universe', icon: <InventoryIcon /> },
      { id: 'behavior', label: 'Cortex Scenario Builder', icon: <PsychologyIcon /> },
      { id: 'calibration', label: 'Scenario Workbench', icon: <TuneIcon /> },
    ]
  },
  {
    key: 'ALERTING',
    label: 'Alerting',
    items: [
      { id: 'alerting_eligibility', label: 'Eligibility & Alert Generation', icon: <NotificationsIcon /> },
    ]
  },
  {
    key: 'VALIDATION',
    label: 'Validation',
    items: [
      { id: 'validation_str_alignment', label: 'STR Alignment & Validation', icon: <VerifiedUserIcon /> },
      { id: 'validation_missed_str', label: 'Missed STR Analysis', icon: <SearchOffIcon /> },
    ]
  },
  {
    key: 'OPS_INTELLIGENCE',
    label: 'Operations Intelligence',
    items: [
      { id: 'ops_scenario_interaction', label: 'Scenario Interaction Analysis', icon: <TimelineIcon /> },
      { id: 'ops_workload', label: 'Analyst Workload Simulation', icon: <WorkOutlineIcon /> },
    ]
  },
  {
    key: 'ADVANCED',
    label: 'Advanced Analysis',
    items: [
      { id: 'ml_validation', label: 'ML Validation Workbench', icon: <ScienceIcon /> },
    ]
  }
];

const Sidebar = ({ activeScreen, setActiveScreen }) => {
  const { activeBankName } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState({
    FOUNDATION: true,
    CALIBRATION: true,
    ALERTING: true,
    VALIDATION: true,
    OPS_INTELLIGENCE: true,
    ADVANCED: true,
  });

  const handleGroupToggle = (key) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleScreenChange = (screenId) => {
    setActiveScreen(screenId);
  };

  return (
    <StyledDrawer variant="permanent" open={!isCollapsed}>
      {/* Toggle Button */}
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

      {/* Logo Header */}
      <Box
        sx={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          px: isCollapsed ? 2 : 3,
          borderBottom: '1px solid',
          borderColor: alpha('#fff', 0.1),
          mb: 0.5
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

      {/* Menu Sections */}
      <Box sx={{
        overflowY: 'auto',
        overflowX: 'hidden',
        flex: 1,
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: '4px' }
      }}>
        <List disablePadding sx={{ py: 0.5 }}>
          {menuSections.map((section) => (
            <React.Fragment key={section.key}>
              {!isCollapsed && section.label && (
                <GroupHeader onClick={() => handleGroupToggle(section.key)}>
                  <ListItemText
                    primary={section.label}
                    primaryTypographyProps={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.05em',
                      color: '#64748b',
                      textTransform: 'uppercase'
                    }}
                  />
                  {openGroups[section.key] ?
                    <ExpandLess sx={{ fontSize: 18, color: '#64748b' }} /> :
                    <ExpandMore sx={{ fontSize: 18, color: '#64748b' }} />
                  }
                </GroupHeader>
              )}

              <Collapse in={isCollapsed ? true : openGroups[section.key]} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {section.items.map((item) => {
                    const isActive = activeScreen === item.id;

                    return (
                      <ListItem key={item.id} disablePadding sx={{ display: 'block' }}>
                        <Tooltip
                          title={isCollapsed ? item.label : ""}
                          placement="right"
                          arrow
                        >
                          <ListItemButton
                            onClick={() => handleScreenChange(item.id)}
                            sx={{
                              minHeight: 40,
                              justifyContent: isCollapsed ? 'center' : 'initial',
                              pl: 3,
                              pr: 2,
                              py: 1.25,
                              mx: 1.5,
                              my: 0.25,
                              borderRadius: '6px',
                              transition: 'all 0.15s ease',

                              ...(isActive && {
                                bgcolor: 'rgba(208, 74, 2, 0.12)',
                                color: '#fb923c',
                                '&:before': {
                                  content: '""',
                                  position: 'absolute',
                                  left: -6,
                                  top: '20%',
                                  height: '60%',
                                  width: '3px',
                                  borderRadius: '0 2px 2px 0',
                                  backgroundColor: '#D04A02',
                                  display: isCollapsed ? 'none' : 'block'
                                }
                              }),

                              ...(!isActive && {
                                color: '#94a3b8',
                                '&:hover': {
                                  bgcolor: 'rgba(255, 255, 255, 0.05)',
                                  color: '#cbd5e1'
                                }
                              }),
                            }}
                          >
                            <ListItemIcon
                              sx={{
                                minWidth: 0,
                                mr: isCollapsed ? 0 : 2.5,
                                justifyContent: 'center',
                                alignSelf: 'flex-start',
                                mt: 0.25,
                                color: 'inherit',
                                '& .MuiSvgIcon-root': { 
                                  fontSize: 20
                                }
                              }}
                            >
                              {item.icon}
                            </ListItemIcon>

                            <ListItemText
                              primary={item.label}
                              primaryTypographyProps={{
                                fontSize: '0.8125rem',
                                fontWeight: isActive ? 500 : 400,
                                lineHeight: 1.4,
                                whiteSpace: 'normal',
                                wordBreak: 'break-word'
                              }}
                              sx={{ 
                                opacity: isCollapsed ? 0 : 1,
                                m: 0
                              }}
                            />

                            {isActive && !isCollapsed && (
                              <FiberManualRecord sx={{ fontSize: 8, color: '#D04A02', ml: 'auto' }} />
                            )}
                          </ListItemButton>
                        </Tooltip>
                      </ListItem>
                    );
                  })}
                </List>
              </Collapse>

              {isCollapsed && <Divider sx={{ my: 1, borderColor: alpha('#fff', 0.1), mx: 2 }} />}
            </React.Fragment>
          ))}
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
          bgcolor: '#22c55e',
          boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)'
        }} />
        {!isCollapsed && (
          <Box>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.6875rem', display: 'block', fontWeight: 500, letterSpacing: '0.03em' }}>
              System Status
            </Typography>
            <Typography variant="caption" sx={{ color: '#22c55e', fontWeight: 600, fontSize: '0.75rem' }}>
              READY
            </Typography>
          </Box>
        )}
      </Box>
    </StyledDrawer>
  );
};

export default Sidebar;
