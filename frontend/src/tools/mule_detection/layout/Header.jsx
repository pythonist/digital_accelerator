// frontend/src/tools/mule_detection/layout/Header.jsx
import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
  Chip,
} from '@mui/material';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SettingsIcon from '@mui/icons-material/Settings';
import DnsIcon from '@mui/icons-material/Dns';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ViewListIcon from '@mui/icons-material/ViewList';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import Circle from '@mui/icons-material/Circle';

import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import { TOOL_HEADER_HEIGHT } from './layout.constants';
import { useMuleStore } from '../store/muleStore';

const Header = ({ hasData }) => {
  const navigate = useNavigate();
  const { username, activeBankName, handleLogout } = useAppContext();
  const [anchorElUser, setAnchorElUser] = useState(null);
  const { openModelRegistry } = useMuleStore();

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        backgroundColor: '#ea580c',
        height: TOOL_HEADER_HEIGHT,
        width: '100%',
        zIndex: (theme) => theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar
        variant="dense"
        disableGutters
        sx={{
          height: TOOL_HEADER_HEIGHT,
          minHeight: TOOL_HEADER_HEIGHT,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* LEFT */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Tooltip title="Back to Tools">
            <IconButton
              size="small"
              onClick={() => navigate('/tools', { state: { skipRestore: true } })}
              sx={{ color: 'white' }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Typography
            sx={{
              color: 'white',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: 0.8,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
            }}
          >
            <Box component="span" sx={{ fontWeight: 700, letterSpacing: 2 }}>
              FCIP
            </Box>
            <Box component="span" sx={{ mx: 1, opacity: 0.6 }}>
              |
            </Box>
            <Box component="span" sx={{ fontWeight: 500, opacity: 0.9 }}>
              Mule Detection
            </Box>
          </Typography>

          {activeBankName && (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>
                |
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <DnsIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }} />
                <Typography
                  sx={{
                    color: 'white',
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {activeBankName}
                </Typography>
              </Box>
            </>
          )}
        </Box>

        {/* RIGHT */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {hasData && (
            <Chip 
              label="Data Loaded"
              size="small"
              icon={<Circle sx={{ fontSize: 10 }} />}
              sx={{ 
                bgcolor: 'rgba(255,255,255,0.2)', 
                color: 'white',
                fontWeight: 600,
                height: 20,
                fontSize: '0.65rem',
                mr: 1
              }}
            />
          )}

          <Tooltip title="Help">
            <IconButton size="small" sx={{ color: 'white' }}>
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Model Registry">
            <IconButton size="small" onClick={openModelRegistry} sx={{ color: 'white' }}>
              <ViewListIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider
            orientation="vertical"
            sx={{
              height: 16,
              alignSelf: 'center',
              mx: 0.75,
              borderColor: 'rgba(255,255,255,0.6)',
              borderRightWidth: '2px',
            }}
          />

          <Tooltip title="Account">
            <IconButton
              size="small"
              onClick={(e) => setAnchorElUser(e.currentTarget)}
              sx={{ color: 'white' }}
            >
              <Avatar
                sx={{
                  width: 20,
                  height: 20,
                  bgcolor: 'rgba(255,255,255,0.2)',
                  fontSize: '0.7rem',
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
            PaperProps={{ sx: { minWidth: 160, borderRadius: 1 } }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          >
            <MenuItem onClick={() => setAnchorElUser(null)}>
              <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Profile" />
            </MenuItem>
            <MenuItem onClick={() => setAnchorElUser(null)}>
              <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Settings" />
            </MenuItem>
            <Divider />
            <MenuItem
              sx={{ color: '#ef4444' }}
              onClick={async () => {
                setAnchorElUser(null);
                await handleLogout();
                navigate('/login');
              }}
            >
              <ListItemIcon sx={{ color: '#ef4444' }}>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Logout" />
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
