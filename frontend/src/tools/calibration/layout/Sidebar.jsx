import React, { useState } from 'react';
import SentinelLogo from '@assets/PwC_2025_logo.svg';
import {
  Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Divider, Box, Typography, IconButton, Tooltip, Collapse, alpha
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  CloudUpload as DataIcon, ViewColumn as MapIcon, FilterAlt as ScenarioIcon,
  Functions as AggregateIcon, CheckCircle as ValidateIcon, Tune as CalibrateIcon,
  Gavel as ApprovalIcon, Description as ReportIcon, CompareArrows as CompareIcon,
  Circle as StepIcon, ChevronLeft, ChevronRight, ExpandLess, ExpandMore,
  Lock as LockIcon
} from '@mui/icons-material';
import { useCalibration } from '../context/CalibrationContext';
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

const GroupHeader = styled(ListItemButton)(({ theme }) => ({
  backgroundColor: 'transparent',
  paddingTop: theme.spacing(2.5),
  paddingBottom: theme.spacing(1.5),
  '&:hover': {
    backgroundColor: alpha('#fff', 0.05),
  },
}));

const steps = [
  { id: 'data_load', label: 'Data Foundation', icon: <DataIcon fontSize="small" />, alwaysAccessible: true, section: 'setup', isStep0: true },
  // { id: 'data_mapping', label: 'Schema Mapping', icon: <MapIcon fontSize="small" />, alwaysAccessible: true, section: 'setup', isStep0: true },
  
  { id: 'scenario', label: 'Population Extraction', icon: <ScenarioIcon fontSize="small" />, section: 'workflow' },
  { id: 'aggregation', label: 'Aggregation', icon: <AggregateIcon fontSize="small" />, section: 'workflow' },
  { id: 'validation', label: 'Validation', icon: <ValidateIcon fontSize="small" />, section: 'workflow' },
  { id: 'calibration', label: 'Calibration', icon: <CalibrateIcon fontSize="small" />, section: 'workflow' },
  { id: 'approval', label: 'Governance Approval', icon: <ApprovalIcon fontSize="small" />, section: 'workflow' },
  { id: 'summary', label: 'Final Report', icon: <ReportIcon fontSize="small" />, section: 'workflow' },
  { id: 'comparison', label: 'Bank Comparison', icon: <CompareIcon fontSize="small" />, badge: 'Future', section: 'future' }
];

const Sidebar = ({ activeScreen, setActiveScreen }) => {
  const { currentStep, goToStep, run, runId, step0Complete } = useCalibration();
  const { activeBankName } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState({
    "SETUP": true,
    "WORKFLOW": true,
    "FUTURE": true
  });

  const handleGroupToggle = (label) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isStepAccessible = (step) => {
  // Step 0 steps are always accessible
  if (step.isStep0) {
    return true;
  }
  
  // Comparison screen - accessible if run exists
  if (step.id === 'comparison') {
    return !!run;
  }
  
  // ✅ FIX: Check step0Complete FIRST before anything else
  if (!step0Complete && !step.isStep0) {
    console.log(`🔒 [SIDEBAR] Step "${step.label}" locked - Step 0 not complete`);
    console.log(`   step0Complete: ${step0Complete}`);
    return false;
  }
  
  // If no run created yet, only allow scenario step
  if (!run) {
    const accessible = step.id === 'scenario';
    console.log(`🔍 [SIDEBAR] No run - Step "${step.label}" accessible: ${accessible}`);
    return accessible;
  }
  
  // Check progression within workflow
  const stepOrder = ['scenario', 'aggregation', 'validation', 'calibration', 'approval', 'summary'];
  const currentIndex = stepOrder.indexOf(currentStep);
  const stepIndex = stepOrder.indexOf(step.id);
  
  // If step not in order, it's accessible
  if (stepIndex === -1) {
    return true;
  }
  
  // Can access current step and all previous steps
  const accessible = stepIndex <= currentIndex;
  
  console.log(`🔍 [SIDEBAR] Step "${step.label}": current=${currentIndex}, step=${stepIndex}, accessible=${accessible}`);
  
  return accessible;
};

  const handleStepClick = (stepId) => {
    const step = steps.find(s => s.id === stepId);
    if (!step.isStep0 && !step0Complete) {
      return;
    }

    if ((stepId === 'approval' || stepId === 'summary') && !runId) {
      return;
    }

    if (setActiveScreen) {
      setActiveScreen(stepId);
    } else {
      goToStep(stepId);
    }
  };

  const setupSteps = steps.filter(s => s.section === 'setup');
  const workflowSteps = steps.filter(s => s.section === 'workflow');
  const futureSteps = steps.filter(s => s.section === 'future');

  const renderStepGroup = (groupSteps, groupLabel, groupKey) => (
    <>
      {!isCollapsed && (
        <GroupHeader onClick={() => handleGroupToggle(groupKey)}>
          <ListItemText 
            primary={groupLabel} 
            primaryTypographyProps={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.5px',
              color: '#94a3b8',
              textTransform: 'uppercase'
            }}
          />
          {openGroups[groupKey] ? 
            <ExpandLess sx={{ fontSize: 16, color: '#64748b' }} /> : 
            <ExpandMore sx={{ fontSize: 16, color: '#64748b' }} />
          }
        </GroupHeader>
      )}

      <Collapse in={isCollapsed ? true : openGroups[groupKey]} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {groupSteps.map((step) => {
            const isActive = activeScreen === step.id || currentStep === step.id;
            const isAccessible = isStepAccessible(step);
            const isLocked = !step.isStep0 && !step0Complete;

            return (
              <ListItem key={step.id} disablePadding sx={{ display: 'block', mb: 0.5 }}>
                <Tooltip 
                  title={
                    isCollapsed 
                      ? (isLocked ? "Complete Data Foundation first" : !isAccessible ? "Complete previous steps" : step.label)
                      : ""
                  } 
                  placement="right" 
                  arrow
                >
                  <span>
                    <ListItemButton
                      disabled={!isAccessible}
                      onClick={() => isAccessible && handleStepClick(step.id)}
                      sx={{
                        minHeight: 36,
                        justifyContent: isCollapsed ? 'center' : 'initial',
                        px: 2.5,
                        mx: 1.5,
                        borderRadius: 1,
                        transition: 'all 0.15s ease',
                        
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
                        {step.icon}
                      </ListItemIcon>
                      
                      <ListItemText 
                        primary={step.label} 
                        primaryTypographyProps={{ 
                          fontSize: '0.8125rem',
                          fontWeight: isActive ? 500 : 400
                        }}
                        sx={{ opacity: isCollapsed ? 0 : 1 }} 
                      />
                      
                      {isActive && !isCollapsed && !step.badge && (
                        <StepIcon sx={{ fontSize: 10, color: '#ea580c', ml: 'auto' }} />
                      )}
                      
                      {isLocked && !isCollapsed && (
                        <LockIcon sx={{ fontSize: 14, color: '#ea580c', ml: 'auto' }} />
                      )}
                    </ListItemButton>
                  </span>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>
      </Collapse>
    </>
  );

  return (
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

      {!isCollapsed && (
        <Box sx={{ px: 2, py: 1, mb: 1 }}>
          <Box sx={{ 
            p: 1.5, 
            borderRadius: 1, 
            bgcolor: step0Complete ? 'rgba(16, 185, 129, 0.1)' : 'rgba(251, 146, 60, 0.1)',
            border: '1px solid',
            borderColor: step0Complete ? 'rgba(16, 185, 129, 0.3)' : 'rgba(251, 146, 60, 0.3)'
          }}>
            <Typography variant="caption" sx={{ 
              color: step0Complete ? '#10b981' : '#fb923c', 
              fontWeight: 600,
              fontSize: '0.7rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}>
              {step0Complete ? '✓' : '◯'} Data Foundation
            </Typography>
            <Typography variant="caption" sx={{ 
              color: '#94a3b8', 
              fontSize: '0.65rem',
              display: 'block',
              mt: 0.5
            }}>
              {step0Complete ? 'Ready for calibration' : 'Upload & map data'}
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ 
        overflowY: 'auto', 
        overflowX: 'hidden', 
        flex: 1,
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: '4px' }
      }}>
        <List disablePadding>
          {renderStepGroup(setupSteps, 'Data Foundation', 'SETUP')}
          {isCollapsed && <Divider sx={{ my: 1.5, borderColor: alpha('#fff', 0.1), mx: 2 }} />}
          {renderStepGroup(workflowSteps, 'Calibration Workflow', 'WORKFLOW')}
          {isCollapsed && <Divider sx={{ my: 1.5, borderColor: alpha('#fff', 0.1), mx: 2 }} />}
          {renderStepGroup(futureSteps, 'Bank Related', 'FUTURE')}
        </List>
      </Box>

      {run && (
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
            bgcolor: run.status === 'APPROVED' ? '#22c55e' : '#fb923c'
          }} />
          {!isCollapsed && (
            <Box>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.6875rem', display: 'block', fontWeight: 400 }}>
                Run Status
              </Typography>
              <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 500, fontSize: '0.75rem' }}>
                {run.status ? run.status.replace(/_/g, ' ') : 'LOADING...'}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </StyledDrawer>
  );
};

export default Sidebar;
