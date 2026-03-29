import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from "@services/api";
import { useAppContext } from "@context/AppContext";
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';

// 1. Import Motion Wrappers
import { 
  MotionContainer, 
  MotionItem, 
  FadeIn, 
  ScaleIn 
} from "@components/MotionWrappers/MotionWrappers";

// MUI Imports
import {
  Box,
  Typography,
  Button,
  IconButton,
  OutlinedInput,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Tooltip,
  Divider,
  Snackbar,
  Alert,
  useTheme
} from '@mui/material';

// MUI Icons
import {
  Add as PlusIcon,
  Search as SearchIcon,
  Shield as ShieldIcon,
  ChevronRight as ChevronRightIcon,
  DeleteOutline as TrashIcon,
  Logout as LogoutIcon,
  PersonOutline as UserIcon,
  LockOutlined as LockIcon,
  Close as CloseIcon,
  Dns as ServerIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  MenuOpen as MenuOpenIcon,
  GridView as DashboardIcon,
  WarningAmberRounded as WarningIcon
} from '@mui/icons-material';

const EnvironmentSelectScreen = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const { setActiveEnv, refreshSystemState, handleLogout, userRole } = useAppContext();

  // --- State ---
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Sidebar State
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  
  // Create Dialog State
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
  // Access Modal State
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState(null);

  // Delete Confirmation State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [envToDelete, setEnvToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Snackbar (Notification) State
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // --- PwC Color Palette ---
  const colors = {
    bg: '#F2F2F2',
    sidebar: '#1E1E1E',
    sidebarHover: '#3D3D3D',
    pwcOrange: '#D04A02',
    pwcOrangeHover: '#B23F02',
    textMain: '#1E1E1E',
    textMuted: '#6B7280',
    border: '#E5E7EB',
    surface: '#FFFFFF',
    success: '#059669',
    successBg: '#D1FAE5',
    inactive: '#9CA3AF',
    danger: '#DC2626',
    dangerBg: '#FEF2F2'
  };

  useEffect(() => {
    loadEnvs();
  }, []);

  const showNotification = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadEnvs = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/admin/environments/list');
      if (res.success) setEnvironments(res.environments);
    } catch (err) { 
      console.error(err);
      showNotification("Failed to load environments", "error");
    } 
    finally { setLoading(false); }
  };

  const handleSelect = async (envName) => {
    try {
      const res = await apiClient.post('/api/v2/env/select', { name: envName });
      
      if (res.success) {
        try {
          const ctxRes = await apiClient.post('/api/select-context', { env_id: envName });
          if (ctxRes?.success && ctxRes?.token) {
            localStorage.setItem('auth_token', ctxRes.token);
          }
        } catch (e) {}
        setActiveEnv(envName);
        await refreshSystemState(); 
        navigate('/tools-transition', {
          state: {
            envName,
            source: 'environment-select',
          },
        });
      }
    } catch (error) { 
      showNotification("Error selecting environment: " + error.message, "error");
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newEnvName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiClient.post('/api/v2/env/create', { name: newEnvName });
      if (res.success) {
        setShowCreateDialog(false);
        setNewEnvName('');
        await loadEnvs();
        showNotification("Environment created successfully", "success");
      }
    } catch (e) { 
      showNotification(e.message, "error");
    } 
    finally { setIsCreating(false); }
  };

  const promptDelete = (envName) => {
    setEnvToDelete(envName);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!envToDelete) return;
    setIsDeleting(true);
    try {
      const res = await apiClient.post('/api/v2/env/delete', { name: envToDelete });

      if (res.success) {
        await loadEnvs();
        showNotification(`Workspace ${envToDelete} deleted`, "success");
        setDeleteDialogOpen(false);
      } else {
        showNotification(res.error, "error");
      }
    } catch (e) { 
      showNotification(e.message, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredEnvs = environments.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100%', bgcolor: colors.bg, overflow: 'hidden' }}>
      
      {/* --- SIDEBAR --- */}
      <Box sx={{ 
        width: isSidebarOpen ? 260 : 72, 
        bgcolor: colors.sidebar, 
        color: '#fff',
        transition: 'width 0.3s ease-in-out',
        display: 'flex', 
        flexDirection: 'column',
        flexShrink: 0,
        boxShadow: '4px 0 10px rgba(0,0,0,0.1)',
        zIndex: 20
      }}>
        {/* Logo Area */}
        <Box
          sx={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: isSidebarOpen ? 'space-between' : 'center',
            px: isSidebarOpen ? 2.5 : 0,
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: isSidebarOpen ? 1.5 : 0
            }}
          >
            <Box
              component="img"
              src={SentinelLogo}
              alt="Sentinel"
              sx={{
                width: 28,
                height: 28,
                filter: 'brightness(0) invert(1)'
              }}
            />

            {isSidebarOpen && (
              // Using FadeIn for smoother text appearance
              <FadeIn delay={0.1}>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 700,
                      letterSpacing: '0.22em',
                      color: '#ffffff',
                      userSelect: 'none'
                    }}
                  >
                    FCIP
                  </Typography>
              </FadeIn>
            )}
          </Box>

          {isSidebarOpen && (
            <IconButton
              onClick={() => setSidebarOpen(false)}
              size="small"
              sx={{
                color: colors.textMuted,
                '&:hover': { color: '#fff' }
              }}
            >
              <MenuOpenIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {/* Menu Items */}
        <List sx={{ px: 1.5, py: 2 }}>
          <ListItem disablePadding sx={{ mb: 1 }}>
            <ListItemButton sx={{ minHeight: 44, justifyContent: isSidebarOpen ? 'initial' : 'center', bgcolor: 'rgba(208,74,2,0.15)', borderRadius: 1, px: 2 }}>
              <ListItemIcon sx={{ minWidth: 0, mr: isSidebarOpen ? 2 : 'auto', justifyContent: 'center', color: colors.pwcOrange }}><ServerIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Environments" primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 600 }} sx={{ opacity: isSidebarOpen ? 1 : 0, display: isSidebarOpen ? 'block' : 'none' }} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 1 }}>
            <Tooltip title={!isSidebarOpen ? "Refresh" : ""} placement="right">
              <ListItemButton onClick={loadEnvs} sx={{ minHeight: 44, justifyContent: isSidebarOpen ? 'initial' : 'center', borderRadius: 1, px: 2, color: colors.textMuted, '&:hover': { bgcolor: colors.sidebarHover, color: '#fff' } }}>
                <ListItemIcon sx={{ minWidth: 0, mr: isSidebarOpen ? 2 : 'auto', justifyContent: 'center', color: 'inherit' }}><RefreshIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Refresh List" primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 500 }} sx={{ opacity: isSidebarOpen ? 1 : 0, display: isSidebarOpen ? 'block' : 'none' }} />
              </ListItemButton>
            </Tooltip>
          </ListItem>
        </List>
        <Box sx={{ flex: 1 }} />
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
        {!isSidebarOpen && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><IconButton onClick={() => setSidebarOpen(true)} sx={{ color: colors.textMuted }}><ChevronRightIcon /></IconButton></Box>}
        <Box sx={{ p: isSidebarOpen ? 2 : 1 }}>
          <ListItemButton onClick={() => { handleLogout(); navigate('/login'); }} sx={{ borderRadius: 1, justifyContent: isSidebarOpen ? 'initial' : 'center', color: '#EF4444', '&:hover': { bgcolor: 'rgba(239,68,68,0.1)' }, px: isSidebarOpen ? 2 : 0 }}>
            <ListItemIcon sx={{ minWidth: 0, mr: isSidebarOpen ? 2 : 'auto', justifyContent: 'center', color: 'inherit' }}><LogoutIcon fontSize="small" /></ListItemIcon>
            {isSidebarOpen && <ListItemText primary="Sign Out" primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: 600 }} />}
          </ListItemButton>
        </Box>
      </Box>

      {/* --- MAIN CONTENT (Wrapped in MotionContainer for Staggered Entry) --- */}
      <MotionContainer 
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      >
        
        {/* Header - Staggers in first */}
        <MotionItem>
            <Paper elevation={0} sx={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 4, borderBottom: `1px solid ${colors.border}`, borderRadius: 0, zIndex: 10 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <DashboardIcon sx={{ color: colors.textMuted }} />
                <Typography variant="h6" sx={{ fontWeight: 700, color: colors.textMain }}>Environment Manager</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ textAlign: 'right', mr: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: colors.textMain }}>{userRole || 'Admin'}</Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>Connected</Typography>
                </Box>
                <Box sx={{ width: 32, height: 32, bgcolor: colors.bg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.border}` }}><UserIcon sx={{ fontSize: 18, color: colors.textMuted }} /></Box>
            </Box>
            </Paper>
        </MotionItem>

        {/* Toolbar - Staggers in second */}
        <MotionItem>
            <Box sx={{ px: 4, py: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
            <OutlinedInput size="small" placeholder="Search environments..." value={search} onChange={(e) => setSearch(e.target.value)} startAdornment={<InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: colors.textMuted }}/></InputAdornment>} sx={{ bgcolor: colors.surface, width: 320, fontSize: '0.875rem', borderRadius: 1, '& fieldset': { borderColor: colors.border }, '&:hover fieldset': { borderColor: '#9CA3AF' }, '&.Mui-focused fieldset': { borderColor: colors.pwcOrange } }} />
            <Button startIcon={<FilterIcon />} variant="outlined" sx={{ borderColor: colors.border, color: colors.textMain, textTransform: 'none', fontWeight: 600, bgcolor: colors.surface, '&:hover': { bgcolor: '#F9FAFB', borderColor: '#9CA3AF' } }}>Filter</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => setShowCreateDialog(true)} startIcon={<PlusIcon />} variant="contained" sx={{ bgcolor: colors.pwcOrange, textTransform: 'none', fontWeight: 600, px: 3, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', '&:hover': { bgcolor: colors.pwcOrangeHover } }}>Create Environment</Button>
            </Box>
        </MotionItem>

        {/* Table - Staggers in last */}
        <MotionItem sx={{ flex: 1, px: 4, pb: 4, overflow: 'hidden' }}>
          <TableContainer component={Paper} elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 1, height: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <Table stickyHeader sx={{ minWidth: 650 }}>
              <TableHead>
                <TableRow>
                  {['ENVIRONMENT NAME', 'STATUS', 'CREATED DATE', 'TABLES', 'OWNER', 'ACTIONS'].map((head, i) => (
                    <TableCell key={i} align={head === 'ACTIONS' ? 'right' : 'left'} sx={{ bgcolor: '#F9FAFB', borderBottom: `1px solid ${colors.border}`, color: colors.textMuted, fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.05em' }}>{head}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 10 }}><CircularProgress size={30} sx={{ color: colors.pwcOrange }} /></TableCell></TableRow>
                ) : filteredEnvs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 10 }}><Typography sx={{ color: colors.textMuted }}>No environments found.</Typography></TableCell></TableRow>
                ) : (
                  filteredEnvs.map((env) => (
                    <TableRow key={env.name} hover onClick={() => handleSelect(env.name)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#F3F4F6' }, '& td': { borderBottom: `1px solid ${colors.border}`, py: 1.5 } }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box sx={{ p: 0.5, bgcolor: 'rgba(208,74,2,0.1)', color: colors.pwcOrange, borderRadius: 1 }}><ServerIcon sx={{ fontSize: 18 }} /></Box>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: colors.textMain, fontFamily: 'monospace' }}>{env.name}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.5, borderRadius: 1, bgcolor: env.is_active ? colors.successBg : '#F3F4F6', color: env.is_active ? colors.success : colors.inactive }}>
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', mr: 0.8 }} />
                          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700 }}>{env.is_active ? 'ACTIVE' : 'INACTIVE'}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: colors.textMain }}>{new Date(env.created_at).toLocaleDateString()}</Typography>
                        <Typography variant="caption" sx={{ color: colors.textMuted }}>{new Date(env.created_at).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}</Typography>
                      </TableCell>
                      <TableCell><Typography variant="body2" sx={{ color: colors.textMain, fontWeight: 600 }}>{env.tables_count || 0}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ color: colors.textMuted }}>{env.created_by || 'System'}</Typography></TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                          <Tooltip title="Manage Access">
                            <IconButton onClick={() => { setSelectedEnv(env); setShowAccessModal(true); }} size="small" sx={{ borderRadius: 1, color: colors.textMuted, '&:hover': { color: colors.pwcOrange, bgcolor: 'rgba(208,74,2,0.1)' } }}><LockIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title="Delete Workspace">
                            <IconButton onClick={() => promptDelete(env.name)} size="small" sx={{ borderRadius: 1, color: colors.textMuted, '&:hover': { color: '#EF4444', bgcolor: '#FEF2F2' } }}><TrashIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title="Enter Workspace">
                            <IconButton onClick={() => handleSelect(env.name)} size="small" sx={{ borderRadius: 1, color: colors.pwcOrange, bgcolor: 'rgba(208,74,2,0.1)', '&:hover': { bgcolor: 'rgba(208,74,2,0.2)' } }}><ChevronRightIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </MotionItem>
      </MotionContainer>

      {/* --- CREATE DIALOG --- */}
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <ScaleIn>
            <DialogTitle sx={{ fontWeight: 700, borderBottom: `1px solid ${colors.border}` }}>Create New Environment</DialogTitle>
            <form onSubmit={handleCreate}>
            <DialogContent sx={{ pt: 3 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, color: colors.textMain }}>Environment ID</Typography>
                <OutlinedInput autoFocus fullWidth placeholder="e.g. AUDIT-2024-Q1" value={newEnvName} onChange={(e) => setNewEnvName(e.target.value)} sx={{ borderRadius: 1 }} />
                <Typography variant="caption" sx={{ mt: 1, display: 'block', color: colors.textMuted }}>Create a unique identifier for this investigation workspace.</Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={() => setShowCreateDialog(false)} sx={{ color: colors.textMuted, fontWeight: 600 }}>Cancel</Button>
                <Button type="submit" variant="contained" disabled={isCreating} sx={{ bgcolor: colors.pwcOrange, borderRadius: 1, boxShadow: 'none', '&:hover': { bgcolor: colors.pwcOrangeHover } }}>Create</Button>
            </DialogActions>
            </form>
        </ScaleIn>
      </Dialog>

      {/* --- DELETE CONFIRMATION DIALOG --- */}
      <Dialog 
        open={deleteDialogOpen} 
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <ScaleIn>
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ 
                width: 48, 
                height: 48, 
                borderRadius: '50%', 
                bgcolor: colors.dangerBg, 
                color: colors.danger,
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                mb: 2
            }}>
                <WarningIcon />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Delete Workspace?</Typography>
            <Typography variant="body2" sx={{ color: colors.textMuted, mb: 3 }}>
                Are you sure you want to delete <Typography component="span" fontWeight="bold">{envToDelete}</Typography>? 
                This action cannot be undone and all associated cases/tables will be lost.
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                <Button 
                fullWidth 
                variant="outlined" 
                onClick={() => setDeleteDialogOpen(false)}
                sx={{ borderColor: colors.border, color: colors.textMain, textTransform: 'none' }}
                >
                Cancel
                </Button>
                <Button 
                fullWidth 
                variant="contained" 
                color="error"
                onClick={confirmDelete}
                disabled={isDeleting}
                startIcon={isDeleting ? <CircularProgress size={20} color="inherit" /> : null}
                sx={{ textTransform: 'none', bgcolor: colors.danger, '&:hover': { bgcolor: '#B91C1C' } }}
                >
                {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
            </Box>
            </Box>
        </ScaleIn>
      </Dialog>

      {/* --- ACCESS MODAL --- */}
      <Dialog open={showAccessModal} onClose={() => setShowAccessModal(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <ScaleIn>
            {selectedEnv && (
            <>
                <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Access Control</Typography>
                <IconButton size="small" onClick={() => setShowAccessModal(false)}><CloseIcon fontSize="small"/></IconButton>
                </Box>
                <DialogContent sx={{ p: 0 }}>
                <Box sx={{ px: 3, py: 2, bgcolor: '#F9FAFB', borderBottom: `1px solid ${colors.border}` }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: colors.textMuted }}>TARGET</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedEnv.name}</Typography>
                </Box>
                <List dense>
                    <ListItem>
                    <ListItemIcon><UserIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="admin@sentinel.ai" secondary="Owner • Full Access" />
                    </ListItem>
                    <ListItem button sx={{ mt: 1, justifyContent: 'center', color: colors.pwcOrange }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>+ ADD USER</Typography>
                    </ListItem>
                </List>
                </DialogContent>
            </>
            )}
        </ScaleIn>
      </Dialog>

      {/* --- GLOBAL SNACKBAR --- */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={6000} 
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity} 
          variant="filled" 
          sx={{ width: '100%', borderRadius: 1, boxShadow: 3 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

    </Box>
  );
};

export default EnvironmentSelectScreen;
