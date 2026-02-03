import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from "../../services/api";
import { useAppContext } from "../../context/AppContext";

// MUI Imports
import {
  Box,
  Button,
  Container,
  Paper,
  Typography,
  IconButton,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Divider,
  Tab,
  Tabs,
  Tooltip,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert
} from '@mui/material';

// Icons
import {
  PeopleAlt,
  Dns,
  Security,
  TrendingUp,
  ArrowBack,
  Refresh,
  Download,
  CheckCircle,
  Cancel,
  WarningAmber,
  Lock,
  LockOpen,
  AdminPanelSettings,
  Add
} from '@mui/icons-material';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { tenantId, userRole, handleLogout, username } = useAppContext();

  // State
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [environments, setEnvironments] = useState([]);
  
  // Feedback
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', message: '', action: null });

  useEffect(() => {
    if (userRole !== 'TENANT_ADMIN') navigate('/', { replace: true });
    loadData();
  }, [userRole, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, u, e] = await Promise.all([
        apiClient.get('/api/admin/dashboard'),
        apiClient.get('/api/admin/users/list'),
        apiClient.get('/api/admin/environments/list')
      ]);
      setStats(s.stats);
      setUsers(u.users);
      setEnvironments(e.environments);
    } catch (err) {
      setSnackbar({ open: true, message: 'Failed to sync data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLER: Enable/Disable User ---
  const handleUserAction = async (user) => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
    
    const isDeactivating = user.status === 'active';
    try {
      const endpoint = isDeactivating ? '/api/admin/users/disable' : '/api/admin/users/enable';
      await apiClient.post(endpoint, { email: user.email });
      setSnackbar({ open: true, message: `User ${isDeactivating ? 'disabled' : 'enabled'}`, severity: 'success' });
      loadData();
    } catch (err) {
      setSnackbar({ open: true, message: 'Action failed', severity: 'error' });
    }
  };

  const confirmUserAction = (user) => {
    setConfirmDialog({
      open: true,
      title: user.status === 'active' ? 'Revoke User Access?' : 'Restore User Access?',
      message: user.status === 'active' 
        ? `This will immediately disconnect ${user.email} from all active sessions.` 
        : `This will allow ${user.email} to log in again.`,
      action: () => handleUserAction(user),
      isDanger: user.status === 'active'
    });
  };

  // --- HANDLER: Promote/Demote User ---
  const handleRoleChange = async (user, newRole) => {
    if (user.email === username && newRole !== 'TENANT_ADMIN') {
      setSnackbar({ open: true, message: "You cannot demote yourself.", severity: "warning" });
      return;
    }

    try {
      await apiClient.post('/api/admin/users/update-role', { 
        email: user.email, 
        role: newRole 
      });
      setSnackbar({ open: true, message: `User role updated to ${newRole}`, severity: 'success' });
      loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to update role', severity: 'error' });
    }
  };

  // --- Sub-Component: Dense Stat Item ---
  const StatItem = ({ label, value, icon, color }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 1.5 }}>
      <Box sx={{ 
        p: 1, 
        borderRadius: 1, 
        bgcolor: `${color}15`, 
        color: color, 
        display: 'flex',
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        {icon}
      </Box>
      <Box>
        <Typography variant="h6" fontWeight="700" lineHeight={1.1} sx={{ fontSize: '1.1rem' }}>
          {value}
        </Typography>
        <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f8fafc' }}>
      
      {/* --- HEADER --- */}
      <Box sx={{ bgcolor: '#1E1E1E', color: 'white', borderBottom: '1px solid #3D3D3D' }}>
        <Container maxWidth="xl">
          <Box sx={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
              <IconButton size="small" onClick={() => navigate('/')} sx={{ color: 'grey.400', '&:hover': { color: 'white' } }}>
                <ArrowBack fontSize="small" />
              </IconButton>
              
              <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
                ADMIN CONSOLE
              </Typography>
              
              <Divider orientation="vertical" flexItem sx={{ bgcolor: 'grey.800', height: 20, my: 'auto' }} />
              
              <Chip 
                label={tenantId} 
                size="small" 
                sx={{ 
                  bgcolor: 'rgba(208,74,2,0.15)', 
                  color: '#D04A02', 
                  border: '1px solid rgba(208,74,2,0.3)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  height: 24,
                  borderRadius: 1
                }} 
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Box sx={{ textAlign: 'right', display: { xs: 'none', md: 'block' } }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>{userRole}</Typography>
                <Typography variant="caption" sx={{ color: 'grey.500', display: 'block' }}>{username}</Typography>
              </Box>
              <Avatar sx={{ width: 32, height: 32, bgcolor: '#D04A02', fontSize: '0.85rem' }}>
                {username ? username[0].toUpperCase() : 'A'}
              </Avatar>
              <Button 
                onClick={handleLogout}
                sx={{ color: '#f87171', minWidth: 0, fontSize: '0.8rem', fontWeight: 600 }}
              >
                LOGOUT
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* --- SUB-HEADER: TABS --- */}
      <Paper 
        square 
        elevation={0} 
        sx={{ 
          borderBottom: '1px solid', 
          borderColor: 'divider', 
          position: 'sticky', 
          top: 0, 
          zIndex: 10,
          bgcolor: 'white'
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Tabs 
              value={activeTab} 
              onChange={(e, v) => setActiveTab(v)} 
              sx={{ 
                minHeight: 50,
                '& .MuiTab-root': { 
                  minHeight: 50, 
                  fontSize: '0.85rem', 
                  fontWeight: 600,
                  textTransform: 'none',
                  px: 3
                },
                '& .Mui-selected': {
                  color: '#D04A02'
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#D04A02'
                }
              }}
            >
              <Tab icon={<AdminPanelSettings sx={{ fontSize: 18, mr: 1 }} />} iconPosition="start" label="System Overview" />
              <Tab icon={<PeopleAlt sx={{ fontSize: 18, mr: 1 }} />} iconPosition="start" label="User Management" />
              <Tab icon={<Dns sx={{ fontSize: 18, mr: 1 }} />} iconPosition="start" label="Environments" />
            </Tabs>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Refresh Data">
                <IconButton size="small" onClick={loadData}><Refresh /></IconButton>
              </Tooltip>
              <Tooltip title="Download Report">
                <IconButton size="small"><Download /></IconButton>
              </Tooltip>
            </Box>
          </Box>
        </Container>
      </Paper>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1, '& .MuiLinearProgress-bar': { bgcolor: '#D04A02' } }} />}

        {/* --- SYSTEM OVERVIEW TAB --- */}
        {activeTab === 0 && !loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            
            {/* 1. STATUS RIBBON */}
            <Paper 
              variant="outlined" 
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                flexWrap: 'wrap',
                py: 1,
                borderLeft: '4px solid #D04A02', 
                bgcolor: 'white'
              }}
            >
              <StatItem 
                label="Total Users" 
                value={stats?.total_users || 0} 
                icon={<PeopleAlt />} 
                color="#D04A02" 
              />
              <Divider orientation="vertical" flexItem sx={{ height: 40, my: 'auto' }} />
              <StatItem 
                label="Active Sessions" 
                value={stats?.active_sessions || 0} 
                icon={<TrendingUp />} 
                color="#10b981" 
              />
              <Divider orientation="vertical" flexItem sx={{ height: 40, my: 'auto' }} />
              <StatItem 
                label="Environments" 
                value={stats?.total_environments || 0} 
                icon={<Dns />} 
                color="#8b5cf6" 
              />
              <Divider orientation="vertical" flexItem sx={{ height: 40, my: 'auto' }} />
              <StatItem 
                label="MFA Adoption" 
                value={`${Math.round((stats?.mfa_enabled_count / (stats?.total_users || 1)) * 100)}%`} 
                icon={<Security />} 
                color={stats?.mfa_enabled_count < stats?.total_users ? "#f59e0b" : "#10b981"} 
              />
            </Paper>

            {/* 2. RECENT ACTIVITY & USER LIST */}
            <Paper variant="outlined">
              <Box sx={{ 
                px: 2, 
                py: 1.5, 
                borderBottom: '1px solid', 
                borderColor: 'divider', 
                bgcolor: 'grey.50',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <Typography variant="subtitle2" fontWeight="700" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  User Activity & Roles
                </Typography>
                <Button size="small" endIcon={<ArrowBack sx={{ transform: 'rotate(180deg)' }}/>} onClick={() => setActiveTab(1)} sx={{ color: '#D04A02' }}>
                  View All Users
                </Button>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'white' }}>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>USER IDENTITY</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>ROLE</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>STATUS</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>LAST LOGIN</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }} align="right">ACTIONS</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.slice(0, 10).map((user) => (
                      <TableRow key={user.email} hover>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar sx={{ width: 24, height: 24, fontSize: '0.7rem', bgcolor: 'grey.300' }}>
                              {user.email[0].toUpperCase()}
                            </Avatar>
                            <Typography variant="body2" fontWeight="500">{user.email}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={user.role} 
                            size="small" 
                            variant="outlined"
                            sx={{ 
                              borderRadius: 1, 
                              height: 20, 
                              fontSize: '0.65rem', 
                              fontWeight: 600,
                              borderColor: user.role === 'TENANT_ADMIN' ? '#D04A02' : 'default',
                              color: user.role === 'TENANT_ADMIN' ? '#D04A02' : 'default'
                            }} 
                          />
                        </TableCell>
                        <TableCell>
                          {user.status === 'active' ? (
                            <Chip icon={<CheckCircle sx={{ fontSize: '12px !important' }}/>} label="Active" size="small" color="success" variant="outlined" sx={{ borderRadius: 0.5, height: 20, fontSize: '0.7rem' }} />
                          ) : (
                            <Chip icon={<Cancel sx={{ fontSize: '12px !important' }}/>} label="Inactive" size="small" color="default" variant="outlined" sx={{ borderRadius: 0.5, height: 20, fontSize: '0.7rem' }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.secondary' }}>
                          {user.last_login ? new Date(user.last_login * 1000).toLocaleString() : 'Never'}
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                            
                            {/* PROMOTE BUTTON */}
                            {user.role === 'TENANT_USER' && (
                              <Tooltip title="Promote to Admin">
                                <IconButton 
                                  size="small" 
                                  onClick={() => handleRoleChange(user, 'TENANT_ADMIN')}
                                  sx={{ 
                                    color: '#D04A02',
                                    bgcolor: 'rgba(208,74,2,0.1)',
                                    '&:hover': { bgcolor: 'rgba(208,74,2,0.2)' } 
                                  }}
                                >
                                  <AdminPanelSettings fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}

                            {/* DEMOTE BUTTON */}
                            {user.role === 'TENANT_ADMIN' && user.email !== username && (
                              <Tooltip title="Demote to User">
                                <IconButton 
                                  size="small" 
                                  onClick={() => handleRoleChange(user, 'TENANT_USER')}
                                  sx={{ color: 'text.secondary' }}
                                >
                                  <PeopleAlt fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}

                            {/* Enable/Disable Button */}
                            <Tooltip title={user.status === 'active' ? "Disable User" : "Enable User"}>
                              <IconButton size="small" onClick={() => confirmUserAction(user)}>
                                {user.status === 'active' ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            {/* 3. ENVIRONMENTS */}
            <Paper variant="outlined">
              <Box sx={{ 
                px: 2, 
                py: 1.5, 
                borderBottom: '1px solid', 
                borderColor: 'divider', 
                bgcolor: 'grey.50',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <Typography variant="subtitle2" fontWeight="700" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Environment Infrastructure
                </Typography>
                <Button size="small" startIcon={<Add />} variant="contained" sx={{ textTransform: 'none', boxShadow: 'none', bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23F02' } }}>
                  New Environment
                </Button>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'white' }}>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>ENVIRONMENT NAME</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>STAGE</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>DATA TABLES</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>HEALTH</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }} align="right">CREATED</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {environments.map((env) => (
                      <TableRow key={env.name} hover>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Dns sx={{ fontSize: 16, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight="600">{env.name}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ bgcolor: 'grey.100', px: 1, py: 0.5, borderRadius: 0.5, fontWeight: 600 }}>
                            {env.pipeline_stage || 'INITIALIZED'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{env.tables_count}</Typography>
                        </TableCell>
                        <TableCell>
                          {env.is_active ? (
                            <Typography variant="caption" color="success.main" fontWeight="700" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
                              ONLINE
                            </Typography>
                          ) : (
                            <Typography variant="caption" color="text.disabled" fontWeight="700" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'grey.400' }} />
                              OFFLINE
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                          {new Date(env.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {environments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No environments found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

          </Box>
        )}

        {/* --- PLACEHOLDERS FOR OTHER TABS --- */}
        {activeTab === 1 && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">Full User Management Module</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>Extended filter, search, and bulk edit capabilities go here.</Typography>
            <Button variant="outlined" onClick={() => setActiveTab(0)} sx={{ color: '#D04A02', borderColor: '#D04A02' }}>Back to Overview</Button>
          </Paper>
        )}
        {activeTab === 2 && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">Full Environment Manager</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>Detailed infrastructure configuration settings go here.</Typography>
            <Button variant="outlined" onClick={() => setActiveTab(0)} sx={{ color: '#D04A02', borderColor: '#D04A02' }}>Back to Overview</Button>
          </Paper>
        )}

      </Container>

      {/* --- CONFIRMATION DIALOG --- */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog(p => ({ ...p, open: false }))}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {confirmDialog.isDanger ? <WarningAmber color="error" /> : <Security sx={{ color: '#D04A02' }} />}
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{confirmDialog.message}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDialog(p => ({ ...p, open: false }))} color="inherit">Cancel</Button>
          <Button 
            onClick={confirmDialog.action} 
            variant="contained" 
            sx={{
              bgcolor: confirmDialog.isDanger ? 'error.main' : '#D04A02',
              '&:hover': { bgcolor: confirmDialog.isDanger ? 'error.dark' : '#B23F02' }
            }}
            disableElevation
          >
            Confirm Action
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- NOTIFICATIONS --- */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={4000} 
        onClose={() => setSnackbar(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ borderRadius: 1 }}>{snackbar.message}</Alert>
      </Snackbar>

    </Box>
  );
};

export default AdminDashboard;