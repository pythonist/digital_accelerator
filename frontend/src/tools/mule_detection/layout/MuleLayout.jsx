// frontend/src/tools/mule_detection/layout/MuleLayout.jsx
import React from 'react';
import {
  Box, AppBar, Toolbar, Typography, IconButton, Chip, Stack,
  Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Divider, Tooltip
} from '@mui/material';
import {
  ArrowBack, CloudUpload, Dashboard, Assessment, 
  Storage, Refresh, Circle
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { pwcColors } from '../theme';

const SIDEBAR_WIDTH = 240;

const MuleLayout = ({ children, hasData, activeScreen, onNavigate, dataStats }) => {
  const navigate = useNavigate();

  const menuItems = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
      icon: <Dashboard />, 
      disabled: !hasData 
    },
    { 
      id: 'upload', 
      label: 'Upload Data', 
      icon: <CloudUpload />, 
      disabled: false 
    },
    { 
      id: 'introspect', 
      label: 'Data Introspection', 
      icon: <Assessment />, 
      disabled: !hasData 
    }
  ];

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100%' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: SIDEBAR_WIDTH,
            boxSizing: 'border-box',
            bgcolor: '#0f172a',
            color: 'white',
            borderRight: '1px solid rgba(255,255,255,0.1)'
          }
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: pwcColors.primary }}>
            Mule Detection
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
            Pattern Intelligence
          </Typography>
        </Box>

        {hasData && dataStats && (
          <Box sx={{ p: 2, bgcolor: 'rgba(234,88,12,0.1)', mx: 2, mt: 2, borderRadius: 1 }}>
            <Stack spacing={0.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Storage sx={{ fontSize: 14, color: pwcColors.primary }} />
                <Typography variant="caption" fontWeight={600}>
                  {dataStats.account_count || 0} Accounts
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem' }}>
                {(dataStats.txn_count || 0).toLocaleString()} Transactions
              </Typography>
            </Stack>
          </Box>
        )}

        <List sx={{ px: 2, pt: 2 }}>
          {menuItems.map((item) => (
            <ListItem key={item.id} disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={item.disabled ? "Upload data first" : ""} placement="right">
                <span style={{ width: '100%' }}>
                  <ListItemButton
                    disabled={item.disabled}
                    selected={activeScreen === item.id}
                    onClick={() => onNavigate(item.id)}
                    sx={{
                      borderRadius: 1,
                      '&.Mui-selected': {
                        bgcolor: 'rgba(234,88,12,0.15)',
                        color: pwcColors.primary,
                        '&:hover': { bgcolor: 'rgba(234,88,12,0.2)' }
                      },
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.05)'
                      }
                    }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText 
                      primary={item.label} 
                      primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
                    />
                  </ListItemButton>
                </span>
              </Tooltip>
            </ListItem>
          ))}
        </List>

        <Box sx={{ flex: 1 }} />
        
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
        
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Circle sx={{ fontSize: 8, color: '#10b981' }} />
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              System Active
            </Typography>
          </Stack>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <AppBar 
          position="static" 
          elevation={0}
          sx={{ 
            bgcolor: pwcColors.primary,
            height: 48
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 48 }}>
            <IconButton 
              edge="start" 
              color="inherit" 
              onClick={() => navigate('/tools', { state: { skipRestore: true } })}
              sx={{ mr: 2 }}
            >
              <ArrowBack />
            </IconButton>
            
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              Mule Detection Intelligence
            </Typography>

            {hasData && (
              <Chip 
                label="Data Loaded"
                size="small"
                icon={<Circle sx={{ fontSize: 10 }} />}
                sx={{ 
                  bgcolor: 'rgba(255,255,255,0.2)', 
                  color: 'white',
                  fontWeight: 600
                }}
              />
            )}
          </Toolbar>
        </AppBar>

        {/* Content Area */}
        <Box sx={{ flex: 1, overflow: 'auto', bgcolor: pwcColors.bg }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default MuleLayout;
