import React, { useState } from 'react';
import {
  AppBar, Toolbar, Typography, Box, IconButton, Tooltip, Avatar,
  Menu, MenuItem, Divider, ListItemIcon, ListItemText,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon, Settings as SettingsIcon, Dns as DnsIcon,
  HelpOutline as HelpOutlineIcon, Person as PersonIcon, Logout as LogoutIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import { TOOL_HEADER_HEIGHT } from './layout.constants';

const Header = ({ setActiveTab }) => {
  const navigate = useNavigate();
  const { username, activeBankName, handleLogout } = useAppContext();
  const [anchorElUser, setAnchorElUser] = useState(null);

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        backgroundColor: '#ea580c',
        height: TOOL_HEADER_HEIGHT, // ✅ Force 36px
        zIndex: (theme) => theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar
        variant="dense"
        disableGutters
        sx={{
          minHeight: TOOL_HEADER_HEIGHT, // ✅ Override default MUI min-height
          height: TOOL_HEADER_HEIGHT,    // ✅ Strict height
          px: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* LEFT: Branding */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Tooltip title="Back to Tools">
            <IconButton
              size="small"
              onClick={() => navigate('/tools', { state: { skipRestore: true } })}
              sx={{ color: 'white', p: 0.5 }} // ✅ Reduced padding
            >
              <ArrowBackIcon sx={{ fontSize: 18 }} /> {/* ✅ Smaller icon */}
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
            <Box component="span" sx={{ opacity: 0.9 }}>Sentinel</Box>
          </Typography>

          {activeBankName && (
            <Box sx={{ display: 'flex', alignItems: 'center', ml: 1, px: 1, py: 0.25, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 }}>
              <DnsIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', mr: 0.5 }} />
              <Typography sx={{ color: 'white', fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600 }}>
                {activeBankName}
              </Typography>
            </Box>
          )}
        </Box>

        {/* RIGHT: Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Help">
            <IconButton size="small" sx={{ color: 'white', p: 0.5 }}>
              <HelpOutlineIcon sx={{ fontSize: 18 }} />
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
                  width: 22, // ✅ Smaller Avatar
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
            <MenuItem onClick={() => setAnchorElUser(null)} dense>
              <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Profile" />
            </MenuItem>
            <MenuItem onClick={() => setAnchorElUser(null)} dense>
              <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Settings" />
            </MenuItem>
            <Divider />
            <MenuItem
              sx={{ color: '#ef4444' }}
              dense
              onClick={async () => {
                setAnchorElUser(null);
                await handleLogout();
                navigate('/login');
              }}
            >
              <ListItemIcon sx={{ color: '#ef4444' }}><LogoutIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Logout" />
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
