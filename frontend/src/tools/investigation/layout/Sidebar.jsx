// tools/investigation/layout/Sidebar.jsx
import React, { useState } from 'react';
import { 
  Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Divider, 
  IconButton, Box, Typography, Tooltip, Collapse, alpha
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { useAppContext } from "@context/AppContext";
import SentinelLogo from '@assets/PwC_2025_Logo.svg';
import { DRAWER_WIDTH, DRAWER_COLLAPSED_WIDTH } from './layout.constants';

// MUI Icons
import { 
  ChevronLeft, ChevronRight, UploadFile, TableChart, Explore, AutoAwesome, Hub, 
  AutoFixHigh, CleaningServices, Dashboard as DashboardIcon, Description, Search, 
  ContentCopy, Chat, AccountTree, MenuBook, Warning, TrendingUp, Psychology, 
  Security, Settings, Storage, History, Inbox, ExpandLess, ExpandMore  
} from '@mui/icons-material';

// Styled Drawer for Flexbox Layout
const StyledDrawer = styled(Drawer, { 
  shouldForwardProp: (prop) => prop !== 'open' 
})(({ theme, open }) => ({
  width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  '& .MuiDrawer-paper': {
    position: 'relative', 
    height: '100%',       
    // ✅ FIX 1: Allow overflow so the button can stick out
    overflow: 'visible', 
    width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRight: `1px solid ${alpha('#fff', 0.1)}`,
  },
}));

const GroupHeader = styled(ListItemButton)(({ theme }) => ({
  backgroundColor: 'transparent',
  paddingTop: theme.spacing(2.5),
  paddingBottom: theme.spacing(1.5),
  '&:hover': { backgroundColor: alpha('#fff', 0.05) },
}));

const Sidebar = ({ activeTab, setActiveTab }) => {
  const { datasetLoaded, activeBankName } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [openGroups, setOpenGroups] = useState({
    "DATA MANAGEMENT": true,
    "PRIORITY QUEUE": true,
    "INVESTIGATION": true,
    "ANALYSIS": true,
    "SYSTEM": true
  });

  const handleGroupToggle = (label) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isEnabled = (item) => {
    if (item.requiresData && !datasetLoaded) return false;
    return true;
  };

  const navGroups = [
    {
      label: "DATA MANAGEMENT",
      items: [
        { id: 'load', label: 'Load Data', icon: <UploadFile fontSize="small" /> },
        // { id: 'connectors', label: 'Data Connectors', icon: <Storage fontSize="small" /> },
        { id: 'history', label: 'Ingestion History', icon: <History fontSize="small" />, requiresData: true },
        { id: 'table', label: 'Data Viewer', icon: <TableChart fontSize="small" />, requiresData: true },
        { id: 'dynamic', label: 'Discovery', icon: <Explore fontSize="small" />, requiresData: true },
        { id: 'merge', label: 'Create Data', icon: <AutoAwesome fontSize="small" /> },
        { id: 'schema', label: 'Schema Map', icon: <Hub fontSize="small" /> },
        { id: 'build', label: 'AI Auto-Master', icon: <AutoFixHigh fontSize="small" />, requiresData: true },
        { id: 'clean', label: 'Data Cleaning', icon: <CleaningServices fontSize="small" />, requiresData: true },
        { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon fontSize="small" />, requiresData: true },
      ]
    },
    {
      label: "PRIORITY QUEUE",
      items: [
        { id: 'priority', label: 'Priority Inbox', icon: <Inbox fontSize="small" />, requiresData: true, highlight: true },
      ]
    },
    {
      label: "INVESTIGATION",
      items: [
        { id: 'casepack', label: 'Case Packs', icon: <Description fontSize="small" />, requiresData: true },
        { id: 'investigate', label: 'Copilot Investigation', icon: <Search fontSize="small" />, requiresData: true },
        { id: 'tree', label: 'Lineage Explorer', icon: <AccountTree fontSize="small" />, requiresData: true },
        { id: 'compare', label: 'Compare', icon: <ContentCopy fontSize="small" />, requiresData: true },
        { id: 'chat', label: 'AI Assistant', icon: <Chat fontSize="small" /> },
      ]
    },
    {
      label: "ANALYSIS",
      items: [
        { id: 'graph', label: 'Graph Analysis', icon: <AccountTree fontSize="small" />, requiresData: true },
        { id: 'rules', label: 'Rule Engine', icon: <MenuBook fontSize="small" />, requiresData: true },
        { id: 'typology', label: 'Typology', icon: <Warning fontSize="small" />, requiresData: true },
        { id: 'baseline', label: 'Baseline', icon: <TrendingUp fontSize="small" />, requiresData: true },
        { id: 'vector', label: 'Vector Search', icon: <Psychology fontSize="small" />, requiresData: true },
      ]
    },
    {
      label: "SYSTEM",
      items: [
        { id: 'audit', label: 'Audit Trail', icon: <Security fontSize="small" /> },
        { id: 'env_manager', label: 'Environments', icon: <Settings fontSize="small" /> },
      ]
    },
  ];

  return (
    <StyledDrawer variant="permanent" open={!isCollapsed}>
      
      {/* Sidebar Toggle Button - Remains outside the scroll wrapper */}
      <Box sx={{ position: 'absolute', top: '50%', right: -12, transform: 'translateY(-50%)', zIndex: 1300 }}>
        <IconButton
          size="small"
          onClick={() => setIsCollapsed(!isCollapsed)}
          sx={{
            bgcolor: '#1e293b', color: '#e5e7eb', border: '1px solid #334155', width: 26, height: 26,
            '&:hover': { bgcolor: '#334155', color: '#ffffff', transform: 'scale(1.05)' },
          }}
        >
          {isCollapsed ? <ChevronRight sx={{ fontSize: 16 }} /> : <ChevronLeft sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>

      {/* ✅ FIX 2: Content Wrapper - Handles scrolling and clipping internally */}
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        overflowX: 'hidden', 
        overflowY: 'auto',
        '&::-webkit-scrollbar': { width: '4px' }, 
        '&::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: '4px' }
      }}>

        {/* Header */}
        <Box sx={{ height: 64, display: 'flex', alignItems: 'center', px: isCollapsed ? 2 : 3, borderBottom: '1px solid', borderColor: alpha('#fff', 0.1), mb: 1, flexShrink: 0 }}>
          <Box component="img" src={SentinelLogo} alt="Sentinel" sx={{ width: 28, height: 28, flexShrink: 0, filter: 'brightness(0) invert(1)' }} />
          {!isCollapsed && (
            <Box sx={{ ml: 2, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1, color: '#f8fafc', letterSpacing: '0.22em' }}>FCIP</Typography>

              <Typography variant="caption" sx={{ mt: 0.4, color: '#94a3b8', fontSize: '0.675rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'monospace', fontWeight: 600 }}>{activeBankName || 'ENV'}</Typography>
            </Box>
          )}
        </Box>

        {/* Navigation List */}
        <Box sx={{ flex: 1 }}>
          {navGroups.map((group) => (
            <List key={group.label} disablePadding>
              {!isCollapsed && (
                <GroupHeader onClick={() => handleGroupToggle(group.label)}>
                  <ListItemText primary={group.label} primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '1px', color: '#94a3b8' }} />
                  {openGroups[group.label] ? <ExpandLess sx={{ fontSize: 18, color: '#94a3b8' }} /> : <ExpandMore sx={{ fontSize: 18, color: '#94a3b8' }} />}
                </GroupHeader>
              )}
              {isCollapsed && <Divider sx={{ my: 1.5, borderColor: alpha('#fff', 0.1), mx: 2 }} />}
              <Collapse in={isCollapsed ? true : openGroups[group.label]} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {group.items.map((item) => {
                    const active = activeTab === item.id;
                    const enabled = isEnabled(item);
                    return (
                      <ListItem key={item.id} disablePadding sx={{ display: 'block', mb: 0.5 }}>
                        <Tooltip title={isCollapsed ? (!enabled && item.requiresData ? "Requires Data" : item.label) : ""} placement="right" arrow>
                          <span>
                            <ListItemButton
                              disabled={!enabled}
                              onClick={() => enabled && setActiveTab(item.id)}
                              sx={{
                                minHeight: 36, justifyContent: isCollapsed ? 'center' : 'initial', px: 2.5, mx: 1.5, borderRadius: 1.5,
                                transition: 'all 0.15s ease',
                                ...(active && { bgcolor: item.highlight ? 'rgba(249, 115, 22, 0.15)' : 'rgba(59, 130, 246, 0.15)', color: item.highlight ? '#fb923c' : '#f8fafc', fontWeight: 600 }),
                                ...(!active && { color: '#94a3b8', '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.03)', color: '#cbd5e1' } })
                              }}
                            >
                              <ListItemIcon sx={{ minWidth: 0, mr: isCollapsed ? 0 : 2, justifyContent: 'center', color: 'inherit', '& .MuiSvgIcon-root': { fontSize: 18 } }}>
                                {item.icon}
                              </ListItemIcon>
                              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.8rem', fontWeight: active ? 600 : 400 }} sx={{ opacity: isCollapsed ? 0 : 1 }} />
                              {item.highlight && !isCollapsed && enabled && !active && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#f97316', ml: 'auto' }} />}
                            </ListItemButton>
                          </span>
                        </Tooltip>
                      </ListItem>
                    );
                  })}
                </List>
              </Collapse>
            </List>
          ))}
        </Box>

        {/* Footer */}
        {datasetLoaded && (
          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: alpha('#fff', 0.1), bgcolor: 'rgba(15, 23, 42, 0.5)', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start', alignItems: 'center', flexShrink: 0 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#34d399', boxShadow: '0 0 8px rgba(52, 211, 153, 0.4)' }} />
            {!isCollapsed && <Typography variant="caption" sx={{ ml: 1.5, color: '#94a3b8', fontWeight: 500 }}>Data Active</Typography>}
          </Box>
        )}
      </Box>
    </StyledDrawer>
  );
};

export default Sidebar;
