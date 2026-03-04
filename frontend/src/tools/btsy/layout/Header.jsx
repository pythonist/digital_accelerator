// frontend/src/tools/btsy/layout/Header.jsx
import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  ListItemText,
} from '@mui/material';


import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@context/AppContext';
import { TOOL_HEADER_HEIGHT } from './layout.constants';

const Header = () => {
  const navigate = useNavigate();
  const { username, activeBankName, handleLogout } = useAppContext();

  const [anchorElUser, setAnchorElUser] = useState(null);

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        backgroundColor: '#D04A02',
        height: TOOL_HEADER_HEIGHT,
        width: '100%',
        zIndex: (theme) => theme.zIndex.drawer + 1,
        borderRadius: 0,
        borderBottom: '1px solid #b83d00',
        flexShrink: 0,
        boxSizing: 'border-box'
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
          <Button
            size="small"
            onClick={() => navigate('/tools')}
            sx={{
              color: 'white',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 1,
              px: 1,
              bgcolor: 'rgba(255,255,255,0.1)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
            }}
          >
            Back
          </Button>
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
              Cortex V2
            </Box>
          </Typography>

          {activeBankName && (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>
                |
              </Typography>
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
            </>
          )}
        </Box>

        {/* RIGHT */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Divider
            orientation="vertical"
            sx={{
              height: 16,
              alignSelf: 'center',
              mx: 0.75,
              borderColor: 'rgba(255,255,255,0.4)',
              borderRightWidth: '1px',
            }}
          />

          <Button
            size="small"
            onClick={(e) => setAnchorElUser(e.currentTarget)}
            sx={{
              color: 'white',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 1,
              px: 1,
              bgcolor: 'rgba(255,255,255,0.08)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
            }}
          >
            <Avatar
              sx={{
                width: 18,
                height: 18,
                bgcolor: 'rgba(255,255,255,0.2)',
                fontSize: '0.65rem',
                fontWeight: 700,
                borderRadius: 0,
                mr: 0.5
              }}
            >
              {username?.[0]?.toUpperCase() || 'U'}
            </Avatar>
            {username || 'User'}
          </Button>

          <Menu
            anchorEl={anchorElUser}
            open={Boolean(anchorElUser)}
            onClose={() => setAnchorElUser(null)}
            PaperProps={{ sx: { minWidth: 160, borderRadius: 0 } }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          >
            <MenuItem onClick={() => setAnchorElUser(null)}>
              <ListItemText primary="Profile" />
            </MenuItem>
            <MenuItem onClick={() => setAnchorElUser(null)}>
              <ListItemText primary="Settings" />
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={async () => {
                setAnchorElUser(null);
                await handleLogout();
                navigate('/login');
              }}
            >
              <ListItemText primary="Sign out" />
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
