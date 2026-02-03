// src/tools/investigation/screens/data/ConnectorManagementScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from "@services/api";

// MUI Imports
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Divider,
  TextField,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Grid,
  Chip,
  LinearProgress,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
  Stack,
  useTheme
} from '@mui/material';

// Icons
import {
  Storage,
  Add,
  Search,
  PlayArrow,
  Science, 
  Delete,
  Save,
  Visibility,
  Refresh,
  Code,
  Dns,
  Link as LinkIcon,
  VpnKey,
  Bolt,
  ArrowBack
} from '@mui/icons-material';

// --- MAIN SCREEN COMPONENT ---
const ConnectorManagementScreen = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  // --- Global State ---
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null); 
  const [filter, setFilter] = useState('');
  
  // Feedback State
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', action: null });

  // --- Initial Load ---
  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v2/connectors');
      setConnectors(res.connectors || []);
    } catch (err) {
      showNotification('Failed to load connector registry', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleDelete = async (id) => {
    setConfirmDialog({ open: false });
    try {
      await apiClient.delete(`/api/v2/connectors/${id}`);
      showNotification('Connector deleted successfully');
      setSelectedId(null);
      loadConnectors();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const confirmDelete = (id) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Connector?',
      message: 'This action is irreversible. Scheduled ingestion tasks for this connector will stop.',
      action: () => handleDelete(id)
    });
  };

  const filteredConnectors = connectors.filter(c => 
    c.name.toLowerCase().includes(filter.toLowerCase()) || 
    c.db_type.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: '#f1f5f9', overflow: 'hidden' }}>
      
      {/* --- LEFT SIDEBAR (REGISTRY LIST) --- */}
      <Paper 
        square 
        elevation={2} 
        sx={{ 
          width: 320, 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          borderRight: '1px solid',
          borderColor: 'divider',
          zIndex: 10
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2, bgcolor: '#0f172a', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Bolt sx={{ color: '#60a5fa' }} />
            <Box>
                <Typography variant="subtitle2" fontWeight="700" letterSpacing={0.5}>CONNECTOR HUB</Typography>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Data Ingestion Sources</Typography>
            </Box>
          </Box>
          <Button 
            fullWidth 
            variant="contained" 
            startIcon={<Add />} 
            onClick={() => setSelectedId('new')}
            sx={{ 
              bgcolor: 'primary.main', 
              fontWeight: 600, 
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { bgcolor: 'primary.dark' }
            }}
          >
            New SQL Connector
          </Button>
        </Box>

        {/* Search */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Filter connectors..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            InputProps={{
              startAdornment: <Search fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />,
            }}
          />
        </Box>

        {/* List */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
             <LinearProgress />
          ) : (
            <List disablePadding>
              {filteredConnectors.map((c) => (
                <React.Fragment key={c.connector_id}>
                  <ListItem disablePadding>
                    <ListItemButton 
                      selected={selectedId === c.connector_id}
                      onClick={() => setSelectedId(c.connector_id)}
                      sx={{ 
                        py: 2,
                        '&.Mui-selected': { bgcolor: 'rgba(59, 130, 246, 0.08)', borderLeft: '4px solid #3b82f6' },
                        '&.Mui-selected:hover': { bgcolor: 'rgba(59, 130, 246, 0.12)' }
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Storage fontSize="small" color={selectedId === c.connector_id ? 'primary' : 'action'} />
                      </ListItemIcon>
                      <ListItemText 
                        primary={
                          <Typography variant="body2" fontWeight="600" noWrap>
                            {c.name}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {c.db_type.toUpperCase()} • {c.host}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
              {filteredConnectors.length === 0 && !loading && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">No connectors found</Typography>
                </Box>
              )}
            </List>
          )}
        </Box>
      </Paper>

      {/* --- RIGHT CONTENT (WORKSPACE) --- */}
      <Box sx={{ flex: 1, height: '100%', overflowY: 'auto', bgcolor: '#f8fafc' }}>
        {selectedId === 'new' ? (
          <ConnectorWorkspace 
            key="new"
            mode="create" 
            onSave={() => {
              loadConnectors();
              setSelectedId(null); 
              showNotification('Connector created');
            }}
            onCancel={() => setSelectedId(null)}
          />
        ) : selectedId ? (
          <ConnectorWorkspace 
            key={selectedId}
            mode="edit" 
            connector={connectors.find(c => c.connector_id === selectedId)}
            onSave={() => {
              loadConnectors();
              showNotification('Connector updated');
            }}
            onDelete={() => confirmDelete(selectedId)}
          />
        ) : (
          <EmptyState />
        )}
      </Box>

      {/* --- DIALOGS --- */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog(p => ({...p, open: false}))}>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(p => ({...p, open: false}))}>Cancel</Button>
          <Button onClick={confirmDialog.action} color="error" variant="contained" autoFocus>Confirm</Button>
        </DialogActions>
      </Dialog>

      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={4000} 
        onClose={() => setSnackbar(p => ({...p, open: false}))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ borderRadius: 1 }}>{snackbar.message}</Alert>
      </Snackbar>

    </Box>
  );
};

// --- SUB-COMPONENT: WORKSPACE (UNIFIED LAYOUT) ---
const ConnectorWorkspace = ({ mode, connector, onSave, onCancel, onDelete }) => {
  const isEdit = mode === 'edit';
  const [activeTab, setActiveTab] = useState(0);
  
  const [formData, setFormData] = useState({
    name: connector?.name || '',
    entity_type: connector?.entity_type || 'transactions',
    db_type: connector?.db_type || 'oracle',
    host: connector?.host || '',
    port: connector?.port || '',
    database: connector?.database || '',
    username: connector?.username || '',
    password: connector?.password || '',
    query: connector?.query || 'SELECT * FROM table WHERE date > SYSDATE - 1'
  });

  const [testing, setTesting] = useState(false);
  const [executing, setExecuting] = useState(false);

  // Handlers
  const handleTest = async () => {
    setTesting(true);
    setTimeout(() => setTesting(false), 1000); 
  };

  const handleExecute = async () => {
    setExecuting(true);
    setTimeout(() => setExecuting(false), 1500);
  };

  const handleSave = () => onSave();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      
      {/* Workspace Header */}
      <Paper square elevation={1} sx={{ px: 3, py: 2, bgcolor: 'white', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6" fontWeight="700">
              {isEdit ? formData.name : 'New Connector Configuration'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isEdit ? `ID: ${connector.connector_id}` : 'Configure connection details and ingestion queries'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {isEdit && (
              <>
                <Button variant="outlined" color="error" startIcon={<Delete />} onClick={onDelete}>
                  Delete
                </Button>
                <Button 
                   variant="contained" 
                   color="success" 
                   startIcon={executing ? <Refresh className="animate-spin"/> : <PlayArrow />} 
                   onClick={handleExecute}
                   disabled={executing}
                >
                  Run Ingestion
                </Button>
              </>
            )}
            <Button variant="contained" startIcon={<Save />} onClick={handleSave}>
              {isEdit ? 'Save Changes' : 'Create Connector'}
            </Button>
          </Box>
        </Box>

        <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ mt: 2, minHeight: 0 }}>
          <Tab label="Configuration" iconPosition="start" icon={<Dns sx={{ fontSize: 16, mb: 0 }} />} sx={{ minHeight: 48 }} />
          {isEdit && <Tab label="Schema Preview" iconPosition="start" icon={<Visibility sx={{ fontSize: 16, mb: 0 }} />} sx={{ minHeight: 48 }} />}
        </Tabs>
      </Paper>

      {/* Content Area */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3, bgcolor: '#f8fafc' }}>
        
        {/* --- TAB 0: CONFIGURATION (UNIFIED SINGLE BOX) --- */}
        {activeTab === 0 && (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            
            {/* SECTION 1: IDENTITY */}
            <Box sx={{ p: 3 }}>
               <Typography variant="subtitle2" fontWeight="700" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1, textTransform: 'uppercase', color: 'text.secondary' }}>
                   <Dns fontSize="small" /> IDENTITY
               </Typography>
               <Grid container spacing={3}>
                   <Grid item xs={12} md={4}>
                      <TextField 
                         fullWidth label="Connector Name" placeholder="e.g. Core Banking Prod"
                         value={formData.name} 
                         onChange={e => setFormData({...formData, name: e.target.value})}
                      />
                   </Grid>
                   <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                         <InputLabel>Entity Type</InputLabel>
                         <Select 
                           value={formData.entity_type} label="Entity Type"
                           onChange={e => setFormData({...formData, entity_type: e.target.value})}
                         >
                           <MenuItem value="transactions">Transactions</MenuItem>
                           <MenuItem value="customers">Customers</MenuItem>
                           <MenuItem value="alerts">Alerts</MenuItem>
                         </Select>
                      </FormControl>
                   </Grid>
                   <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                         <InputLabel>Database Type</InputLabel>
                         <Select 
                           value={formData.db_type} label="Database Type"
                           onChange={e => setFormData({...formData, db_type: e.target.value})}
                         >
                           <MenuItem value="oracle">Oracle</MenuItem>
                           <MenuItem value="sqlserver">SQL Server</MenuItem>
                           <MenuItem value="postgres">PostgreSQL</MenuItem>
                         </Select>
                      </FormControl>
                   </Grid>
               </Grid>
            </Box>

            <Divider />

            {/* SECTION 2: CONNECTION PROFILE */}
            <Box sx={{ p: 3, bgcolor: '#fafafa' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                   <Typography variant="subtitle2" fontWeight="700" sx={{ display: 'flex', alignItems: 'center', gap: 1, textTransform: 'uppercase', color: 'text.secondary' }}>
                      <LinkIcon fontSize="small" /> CONNECTION PROFILE
                   </Typography>
                   <Button 
                      size="small" variant="outlined" 
                      startIcon={testing ? <Refresh className="animate-spin"/> : <Science />} 
                      onClick={handleTest}
                      disabled={testing}
                      sx={{ bgcolor: 'white' }}
                   >
                      Test Connection
                   </Button>
                </Box>
                
                <Grid container spacing={3}>
                   {/* Row 1 */}
                   <Grid item xs={12} md={4}>
                      <TextField 
                        fullWidth label="Host / IP" placeholder="10.x.x.x" 
                        value={formData.host} onChange={e => setFormData({...formData, host: e.target.value})}
                        sx={{ bgcolor: 'white' }}
                      />
                   </Grid>
                   <Grid item xs={12} md={2}>
                      <TextField 
                        fullWidth label="Port" placeholder="1521"
                        value={formData.port} onChange={e => setFormData({...formData, port: e.target.value})}
                        sx={{ bgcolor: 'white' }}
                      />
                   </Grid>
                   <Grid item xs={12} md={6}>
                      <TextField 
                        fullWidth label="Database Name / SID" placeholder="COREDB"
                        value={formData.database} onChange={e => setFormData({...formData, database: e.target.value})}
                        sx={{ bgcolor: 'white' }}
                      />
                   </Grid>
                   
                   {/* Row 2 */}
                   <Grid item xs={12} md={6}>
                      <TextField 
                        fullWidth label="Username" placeholder="read_only_user"
                        value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})}
                        sx={{ bgcolor: 'white' }}
                      />
                   </Grid>
                   <Grid item xs={12} md={6}>
                      <TextField 
                        fullWidth label="Password" type="password" placeholder={isEdit ? "••••••••" : ""} 
                        helperText={isEdit ? "Leave blank to keep existing password" : ""}
                        value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                        InputProps={{ startAdornment: <VpnKey fontSize="small" sx={{ mr: 1, color: 'action.active' }} /> }}
                        sx={{ bgcolor: 'white' }}
                      />
                   </Grid>
                </Grid>
            </Box>

            <Divider />

            {/* SECTION 3: QUERY */}
            <Box sx={{ p: 3 }}>
                <Typography variant="subtitle2" fontWeight="700" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, textTransform: 'uppercase', color: 'text.secondary' }}>
                   <Code fontSize="small" /> INGESTION QUERY
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={8}
                  placeholder="SELECT * FROM table..."
                  value={formData.query}
                  onChange={e => setFormData({...formData, query: e.target.value})}
                  sx={{ 
                    fontFamily: 'monospace', 
                    bgcolor: '#f8fafc',
                    '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.9rem', alignItems: 'flex-start' }
                  }}
                />
                <Alert severity="info" icon={false} sx={{ mt: 2, py: 0, bgcolor: 'transparent', color: 'text.secondary', p: 0 }}>
                   Use standard SQL syntax compliant with the target database. Read-only SELECT permissions recommended.
                </Alert>
            </Box>

          </Paper>
        )}

        {/* --- TAB 1: PREVIEW (Placeholder) --- */}
        {activeTab === 1 && (
           <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              <Typography>Schema Preview requires an active connection.</Typography>
           </Box>
        )}
      </Box>
    </Box>
  );
};

// --- SUB-COMPONENT: EMPTY STATE ---
const EmptyState = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
    <Storage sx={{ fontSize: 64, color: 'action.disabled', mb: 2 }} />
    <Typography variant="h6">No Connector Selected</Typography>
    <Typography variant="body2">Select a connector from the list or create a new one.</Typography>
  </Box>
);

export default ConnectorManagementScreen;