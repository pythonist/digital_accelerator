// src/screens/admin/UserManagementScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../services/api';

// MUI Imports
import {
  Box,
  Container,
  Paper,
  Typography,
  IconButton,
  Button,
  Grid,
  Chip,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  LinearProgress,
  Alert,
  AlertTitle,
  Divider,
  Stack
} from '@mui/material';

// Icons
import {
  ArrowBack,
  Shield,
  Phone,
  AccessTime,
  Person,
  Devices,
  Security,
  Refresh
} from '@mui/icons-material';

const UserManagementScreen = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // --- Logic ---
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.get('/api/v2/admin/users');
      setUsers(data.users || []);
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message || 'Failed to sync user registry');
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const isSessionActive = (timestamp) => {
    if (!timestamp) return false;
    const now = Math.floor(Date.now() / 1000);
    return (now - timestamp) < 86400; // 24 hours
  };

  // --- Render Helpers ---
  const SectionHeader = ({ title, count, icon, color }) => (
    <Box sx={{ 
      p: 2, 
      borderBottom: '1px solid', 
      borderColor: 'divider', 
      bgcolor: 'grey.50',
      display: 'flex', 
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {icon}
        <Typography variant="subtitle2" fontWeight="700" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </Typography>
      </Box>
      <Chip label={count} size="small" sx={{ fontWeight: 600, bgcolor: 'white', border: '1px solid', borderColor: 'divider' }} />
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f8fafc' }}>
      
      {/* --- 1. Enterprise Header --- */}
      <Box sx={{ bgcolor: '#0f172a', color: 'white', borderBottom: '1px solid #1e293b' }}>
        <Container maxWidth="xl">
          <Box sx={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton size="small" onClick={() => navigate(-1)} sx={{ color: 'grey.400', '&:hover': { color: 'white' } }}>
                <ArrowBack fontSize="small" />
              </IconButton>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  USER REGISTRY
                </Typography>
                <Typography variant="caption" sx={{ color: 'grey.500', display: 'block' }}>
                  Admin Console / User Detail View
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
               <Button 
                 startIcon={<Refresh />} 
                 onClick={loadData}
                 size="small"
                 sx={{ color: 'grey.400', '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.05)' } }}
               >
                 Refresh Data
               </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* --- 2. Main Content --- */}
      <Container maxWidth="xl" sx={{ py: 3 }}>
        
        {loading && <LinearProgress sx={{ mb: 3, borderRadius: 1 }} />}
        
        {error && (
          <Alert severity="error" variant="filled" sx={{ mb: 3, borderRadius: 1 }}>
             {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          
          {/* LEFT COLUMN: REGISTERED USERS */}
          <Grid item xs={12} lg={7}>
            <Paper variant="outlined" sx={{ height: '100%', borderRadius: 1 }}>
              <SectionHeader 
                title="Registered Accounts" 
                count={users.length} 
                icon={<Person sx={{ fontSize: 18, color: 'primary.main' }} />} 
              />
              
              <Box sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {users.length === 0 && !loading ? (
                   <Box sx={{ p: 4, textAlign: 'center' }}>
                     <Typography color="text.secondary">No users found in registry.</Typography>
                   </Box>
                ) : (
                  <List disablePadding>
                    {users.map((user, idx) => (
                      <React.Fragment key={idx}>
                        <ListItem 
                          alignItems="flex-start" 
                          sx={{ 
                            py: 2, 
                            '&:hover': { bgcolor: '#f8fafc' } 
                          }}
                        >
                          <ListItemAvatar>
                            <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36, fontSize: '0.85rem' }}>
                              {user.email[0].toUpperCase()}
                            </Avatar>
                          </ListItemAvatar>
                          
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                                <Typography variant="subtitle2" fontWeight="700">
                                  {user.email}
                                </Typography>
                                <Chip 
                                  icon={<Shield sx={{ fontSize: '14px !important' }} />} 
                                  label={user.role || 'USER'} 
                                  size="small" 
                                  color="primary" 
                                  variant={user.role === 'TENANT_ADMIN' ? 'filled' : 'outlined'}
                                  sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, borderRadius: 0.5 }}
                                />
                              </Box>
                            }
                            secondary={
                              <Stack spacing={1} mt={1}>
                                <Stack direction="row" spacing={3} alignItems="center">
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                                    <Phone sx={{ fontSize: 14 }} />
                                    <Typography variant="caption">{user.phone || 'N/A'}</Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Security sx={{ fontSize: 14, color: user.disabled ? 'text.disabled' : 'success.main' }} />
                                    <Typography variant="caption" color={user.disabled ? 'text.disabled' : 'success.main'} fontWeight="600">
                                      {user.disabled ? 'Access disabled' : 'Password login'}
                                    </Typography>
                                  </Box>
                                </Stack>
                              </Stack>
                            }
                          />
                          
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <Chip
                              label={user.disabled ? 'DISABLED' : 'ENABLED'}
                              size="small"
                              color={user.disabled ? 'default' : 'success'}
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, borderRadius: 0.5 }}
                            />
                          </Box>
                        </ListItem>
                        {idx < users.length - 1 && <Divider component="li" />}
                      </React.Fragment>
                    ))}
                  </List>
                )}
              </Box>
            </Paper>
          </Grid>

          {/* RIGHT COLUMN: ACTIVE SESSIONS */}
          <Grid item xs={12} lg={5}>
            <Stack spacing={3}>
              <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                <SectionHeader 
                  title="Live Sessions" 
                  count={sessions.length} 
                  icon={<Devices sx={{ fontSize: 18, color: 'success.main' }} />} 
                />
                
                <Box sx={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {sessions.length === 0 && !loading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                      <Devices sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                      <Typography variant="body2" color="text.secondary">No active sessions detected.</Typography>
                    </Box>
                  ) : (
                    <List disablePadding>
                      {sessions.map((session, idx) => {
                        const active = isSessionActive(session.timestamp);
                        return (
                          <React.Fragment key={idx}>
                            <ListItem 
                              sx={{ 
                                bgcolor: active ? 'rgba(16, 185, 129, 0.04)' : 'transparent',
                                py: 1.5 
                              }}
                            >
                              <ListItemText 
                                primary={
                                  <Typography variant="body2" fontWeight="600" sx={{ mb: 0.5 }}>
                                    {session.username}
                                  </Typography>
                                }
                                secondary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                                    <AccessTime sx={{ fontSize: 14 }} />
                                    <Typography variant="caption">Last Seen: {formatTimestamp(session.timestamp)}</Typography>
                                  </Box>
                                }
                              />
                              <Chip 
                                label={active ? 'ONLINE' : 'EXPIRED'} 
                                size="small"
                                color={active ? 'success' : 'default'}
                                variant={active ? 'filled' : 'outlined'}
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.65rem', 
                                  fontWeight: 700, 
                                  borderRadius: 0.5 
                                }}
                              />
                            </ListItem>
                            {idx < sessions.length - 1 && <Divider component="li" />}
                          </React.Fragment>
                        );
                      })}
                    </List>
                  )}
                </Box>
              </Paper>

              {/* SECURITY NOTICE BOX */}
              <Alert 
                severity="info" 
                variant="outlined"
                icon={<Security fontSize="inherit" />}
                sx={{ 
                  bgcolor: '#eff6ff', 
                  borderColor: '#bfdbfe', 
                  '& .MuiAlert-icon': { color: '#2563eb' } 
                }}
              >
                <AlertTitle sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e40af' }}>Security Policy Enforcement</AlertTitle>
                <Typography variant="caption" sx={{ color: '#1e3a8a', lineHeight: 1.5 }}>
                  Password-based access is controlled by tenant administrators. Sessions automatically expire after 24 hours of inactivity, and audit logs are retained for 90 days.
                </Typography>
              </Alert>
            </Stack>
          </Grid>

        </Grid>
      </Container>
    </Box>
  );
};

export default UserManagementScreen;
