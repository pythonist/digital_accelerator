// frontend/src/tools/btsy/layout/Sidebar.jsx
import React, { useState } from 'react';
import SentinelLogo from '@assets/PwC_2025_Logo.svg';
import {
  Drawer, List, ListItem, ListItemButton, ListItemText,
  Divider, Box, Typography, IconButton, Tooltip, Collapse, alpha
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  ChevronLeft,
  ChevronRight,
  ExpandLess,
  ExpandMore,
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
    backgroundColor: '#0b1b3a',
    color: '#f8fafc',
    borderRight: `1px solid ${alpha('#D04A02', 0.35)}`,
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
    backgroundColor: alpha('#D04A02', 0.16),
  },
}));

const menuSections = [
  {
    key: 'FOUNDATION',
    label: 'Data Foundation',
    items: [
      { id: 'foundation', label: 'Foundation' },
    ]
  },
  {
    key: 'CALIBRATION',
    label: 'Calibration',
    items: [
      { id: 'runs', label: 'Calibration Runs' },
      { id: 'scenarios', label: 'Scenarios' },
      { id: 'universe', label: 'Transaction Universe' },
      { id: 'behavior', label: 'Cortex Scenario Builder' },
      { id: 'calibration', label: 'Scenario Workbench' },
    ]
  },
  {
    key: 'ALERTING',
    label: 'Alerting',
    items: [
      { id: 'alerting_eligibility', label: 'Eligibility & Alert Generation' },
    ]
  },
  {
    key: 'VALIDATION',
    label: 'Validation',
    items: [
      { id: 'validation_str_alignment', label: 'STR Alignment & Validation' },
      { id: 'validation_missed_str', label: 'Missed STR Analysis' },
    ]
  },
  {
    key: 'OPS_INTELLIGENCE',
    label: 'Operations Intelligence',
    items: [
      { id: 'ops_scenario_interaction', label: 'Scenario Interaction Analysis' },
      { id: 'ops_workload', label: 'Analyst Workload Simulation' },
    ]
  },
  {
    key: 'ADVANCED',
    label: 'Advanced Analysis',
    items: [
      { id: 'ml_validation', label: 'ML Validation Workbench' },
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
            bgcolor: '#D04A02',
            color: '#ffffff',
            border: '1px solid #b83d00',
            width: 24,
            height: 24,
            boxShadow: 'none',
            '&:hover': {
              bgcolor: '#b83d00',
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
          borderColor: alpha('#D04A02', 0.35),
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
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' }
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
                      color: '#f8b28e',
                      textTransform: 'uppercase'
                    }}
                  />
                  {openGroups[section.key] ?
                    <ExpandLess sx={{ fontSize: 18, color: '#f8b28e' }} /> :
                    <ExpandMore sx={{ fontSize: 18, color: '#f8b28e' }} />
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
                              borderRadius: '2px',
                              transition: 'all 0.15s ease',

                              ...(isActive && {
                                bgcolor: 'rgba(208, 74, 2, 0.24)',
                                color: '#fff',
                                borderLeft: '2px solid #D04A02',
                              }),

                              ...(!isActive && {
                                color: '#94a3b8',
                                '&:hover': {
                                  bgcolor: 'rgba(208, 74, 2, 0.14)',
                                  color: '#ffffff'
                                }
                              }),
                            }}
                          >
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
        p: 1.5,
        borderTop: '1px solid',
        borderColor: alpha('#D04A02', 0.35),
        bgcolor: 'rgba(11, 27, 58, 0.85)',
        display: 'flex',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        alignItems: 'center',
      }}>
        {!isCollapsed && (
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.03em' }}>
            System Status: Ready
          </Typography>
        )}
      </Box>
    </StyledDrawer>
  );
};

export default Sidebar;
