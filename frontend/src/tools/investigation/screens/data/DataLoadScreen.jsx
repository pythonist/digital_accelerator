// src/tools/investigation/screens/data/DataLoadScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ Layout Import
import PageContainer from "@investigation-layout/PageContainer";

// MUI Components
import {
  Box, Paper, Typography, Button, Stack, Tabs, Tab,
  IconButton, Alert, Divider, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  CircularProgress, Tooltip, Grid, TextField, Select, MenuItem,
  FormControl, InputLabel, List, ListItem, ListItemButton, 
  ListItemText, ListItemIcon, Dialog, DialogTitle, DialogContent, 
  DialogContentText, DialogActions, Snackbar, FormControlLabel, Switch
} from '@mui/material';

// Icons
import {
  CloudUpload as CloudUploadIcon, 
  Storage as StorageIcon, 
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon, 
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon, 
  Settings as SettingsIcon,
  NotificationsActive as AlertIcon,
  ReceiptLong as TransactionIcon,
  AccountBalance as AccountIcon,
  FolderSpecial as CaseIcon,
  Person as CustomerIcon,
  TableChart as TableIcon,
  DeleteForever as PurgeIcon,
  Bolt, Add, Search, Science, Save, Visibility, Code, Dns, 
  Link as LinkIcon, VpnKey, History as HistoryIcon
} from '@mui/icons-material';

const DataLoadScreen = ({ setActiveScreen }) => {
  const navigate = useNavigate();
  const { setDatasetLoaded, checkDatasetStatus, loadCaseList } = useAppContext();
  
  const [activeIngestTab, setActiveIngestTab] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [existingStats, setExistingStats] = useState(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // 1. Initial Data Load
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setIsLoadingStats(true);
    try {
      const response = await apiClient.get('/api/v2/db/stats');
      if (response.success && response.stats) {
        // Check if any table has rows
        const hasData = Object.values(response.stats).some(count => count > 0);
        setExistingStats(hasData ? response.stats : null);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleCompletion = async () => {
    try {
      await apiClient.post('/api/v2/cases/rerank');
      setDatasetLoaded(true);
      await checkDatasetStatus(); 
      await loadCaseList();
      await fetchStats(); 
    } catch (err) {
      console.warn("Status update warning:", err);
    }
  };

  const handleImportCompletion = async ({
    message = 'FCC package imported successfully.',
    importedIntoActiveEnv = false,
  } = {}) => {
    try {
      if (importedIntoActiveEnv) {
        setDatasetLoaded(true);
        await checkDatasetStatus();
        await loadCaseList();
        await fetchStats();
      }
      setSnackbar({ open: true, message, severity: 'success' });
    } catch (err) {
      console.warn("Import refresh warning:", err);
      setSnackbar({ open: true, message, severity: 'success' });
    }
  };

  const handlePurge = async () => {
    setPurgeOpen(true);
  };

  const confirmPurge = async () => {
    try {
      await apiClient.post('/api/v2/db/purge');
      setExistingStats(null);
      setDatasetLoaded(false);
      await checkDatasetStatus();
      await fetchStats();
      setSnackbar({ open: true, message: 'Data purged', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: `Failed to purge data: ${err.message}`, severity: 'error' });
    } finally {
      setPurgeOpen(false);
    }
  };

  return (
    <PageContainer 
      title="Data Ingestion Hub" 
      subtitle="Configure sources and monitor pipelines"
      breadcrumbs={['System', 'Ingestion']}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', overflow: 'hidden' }}>
        <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Purge & Re-upload</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This will delete all current data in the active environment.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPurgeOpen(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={confirmPurge}>Purge</Button>
          </DialogActions>
        </Dialog>
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          message={snackbar.message}
        />
        
        {/* ✅ TABS: Always Visible */}
        <Box sx={{ px: 3, borderBottom: '1px solid #e0e0e0', bgcolor: 'white', flexShrink: 0 }}>
          <Tabs value={activeIngestTab} onChange={(e, v) => setActiveIngestTab(v)} sx={{ minHeight: 48 }}>
            <Tab 
                icon={<CloudUploadIcon fontSize="small" />} 
                iconPosition="start" 
                label="File Upload" 
                sx={{ minHeight: 48, fontWeight: 'bold', fontSize: '0.85rem', textTransform: 'none', mr: 2 }} 
            />
            <Tab 
                icon={<StorageIcon fontSize="small" />} 
                iconPosition="start" 
                label="SQL Connectors" 
                sx={{ minHeight: 48, fontWeight: 'bold', fontSize: '0.85rem', textTransform: 'none' }} 
            />
            <Tab
                icon={<LinkIcon fontSize="small" />}
                iconPosition="start"
                label="FCC Bridge"
                sx={{ minHeight: 48, fontWeight: 'bold', fontSize: '0.85rem', textTransform: 'none', ml: 2 }}
            />
          </Tabs>
        </Box>

        {/* Tab Content Areas */}
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          
          {/* --- TAB 0: FILE UPLOAD (LOGIC HANDLED HERE) --- */}
          {activeIngestTab === 0 && (
            <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
              {isLoadingStats ? (
                 <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
              ) : existingStats ? (
                 // If data exists, show Snapshot View
                 <SnapshotPanel 
                    stats={existingStats} 
                    onPurge={handlePurge} 
                    navigate={navigate} 
                    setActiveScreen={setActiveScreen}
                 />
              ) : (
                 // If no data, show Upload Panel
                 <CsvIngestionPanel onComplete={handleCompletion} />
              )}
            </Box>
          )}

          {/* --- TAB 1: SQL CONNECTORS --- */}
          {activeIngestTab === 1 && (
            <ConnectorManagerPanel onSyncComplete={handleCompletion} />
          )}

          {activeIngestTab === 2 && (
            <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
              <FccPublishedRunsPanel onImportComplete={handleImportCompletion} />
            </Box>
          )}
        </Box>
      </Box>
    </PageContainer>
  );
};

// ============================================================================
// SUB-COMPONENT 1: SNAPSHOT PANEL (Data Already Exists)
// ============================================================================
const SnapshotPanel = ({ stats, onPurge, navigate, setActiveScreen }) => {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', height: '100%' }}>
          <Stack spacing={3} sx={{ maxWidth: 800, width: '100%' }}>
            
            <Alert severity="success" variant="filled" sx={{ mb: 2 }}>
                Active Environment: Data is loaded and ready for analysis.
            </Alert>

            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ p: 2, bgcolor: '#f8fafc', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                    <TableIcon color="primary" /> Current Data Snapshot
                </Typography>
                <Button variant="outlined" color="error" size="small" startIcon={<PurgeIcon />} onClick={onPurge}>
                    Purge & Re-upload
                </Button>
              </Box>
              
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Dataset / Table</strong></TableCell>
                      <TableCell align="right"><strong>Row Count</strong></TableCell>
                      <TableCell align="right"><strong>Status</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[
                        { key: 'alerts', label: 'Alerts', icon: <AlertIcon fontSize="small" color="action" /> },
                        { key: 'transactions', label: 'Transactions', icon: <TransactionIcon fontSize="small" color="action" /> },
                        { key: 'accounts', label: 'Accounts', icon: <AccountIcon fontSize="small" color="action" /> },
                        { key: 'cases', label: 'Cases', icon: <CaseIcon fontSize="small" color="action" /> },
                        { key: 'customers', label: 'Customers', icon: <CustomerIcon fontSize="small" color="action" /> },
                    ].map((row) => {
                        const count = stats ? (stats[row.key] || 0) : 0;
                        return (
                            <TableRow key={row.key} hover>
                                <TableCell>
                                    <Stack direction="row" spacing={2} alignItems="center">
                                        {row.icon}
                                        <Typography variant="body2" fontWeight="500">{row.label}</Typography>
                                    </Stack>
                                </TableCell>
                                <TableCell align="right">
                                    <Chip label={count.toLocaleString()} size="small" sx={{ minWidth: 60, fontWeight: 'bold' }} variant={count > 0 ? "filled" : "outlined"} />
                                </TableCell>
                                <TableCell align="right">
                                    {count > 0 ? (
                                        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5} color="success.main">
                                            <CheckCircleIcon fontSize="small" /> <Typography variant="caption" fontWeight="bold">Ingested</Typography>
                                        </Box>
                                    ) : (
                                        <Typography variant="caption" color="text.secondary">Empty</Typography>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Box display="flex" justifyContent="flex-end" gap={2}>
                 {/* ✅ Navigation to Ingestion History */}
                 <Button
                   variant="contained"
                   size="large"
                   startIcon={<HistoryIcon />}
                   onClick={() => {
                     if (setActiveScreen) setActiveScreen('history');
                     else navigate('/investigation/history');
                   }}
                 >
                    View Ingestion History
                 </Button>
            </Box>
          </Stack>
        </Box>
    );
};

// ============================================================================
// SUB-COMPONENT 2: CSV INGESTION PANEL (Upload New Data)
// ============================================================================
const CsvIngestionPanel = ({ onComplete }) => {
  const [files, setFiles] = useState({});
  const [statusMap, setStatusMap] = useState({});
  const [globalError, setGlobalError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileSlots = [
    { key: 'alerts', label: 'Alerts', required: true, desc: 'Primary alert records', icon: <AlertIcon />, color: '#fff3e0' },
    { key: 'transactions', label: 'Transactions', required: false, desc: 'Transaction history logs', icon: <TransactionIcon />, color: '#e8f5e9' },
    { key: 'accounts', label: 'Accounts', required: false, desc: 'KYC & Account profiles', icon: <AccountIcon />, color: '#e3f2fd' },
    { key: 'cases', label: 'Cases', required: false, desc: 'Historical case decisions', icon: <CaseIcon />, color: '#f3e5f5' },
    { key: 'customers', label: 'Customers', required: false, desc: 'Customer entity details', icon: <CustomerIcon />, color: '#fce4ec' },
  ];

  const handleFileSelect = (key, e) => {
    if (e.target.files[0]) {
      setFiles(prev => ({ ...prev, [key]: e.target.files[0] }));
      setStatusMap(prev => ({ ...prev, [key]: 'ready' }));
      setGlobalError(null);
    }
  };

  const handleDragDrop = (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    const newFiles = { ...files };
    const newStatus = { ...statusMap };
    droppedFiles.forEach(file => {
      const name = file.name.toLowerCase();
      if (name.includes('alert')) { newFiles.alerts = file; newStatus.alerts = 'ready'; }
      else if (name.includes('trans')) { newFiles.transactions = file; newStatus.transactions = 'ready'; }
      else if (name.includes('account')) { newFiles.accounts = file; newStatus.accounts = 'ready'; }
      else if (name.includes('case')) { newFiles.cases = file; newStatus.cases = 'ready'; }
      else if (name.includes('cust')) { newFiles.customers = file; newStatus.customers = 'ready'; }
    });
    setFiles(newFiles);
    setStatusMap(newStatus);
  };

  const handleStartUpload = async () => {
    if (!files.alerts) {
      setGlobalError("Missing Required File: Alerts.csv is mandatory.");
      return;
    }

    setIsUploading(true);
    setGlobalError(null);
    setUploadProgress(0);

    const formData = new FormData();
    Object.keys(files).forEach((key) => {
      formData.append(key, files[key]);
    });

    try {
      const response = await apiClient.postForm('/api/v2/ingest-multi-csv', formData, {
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      if (response.success) {
         setUploadProgress(100);
         setTimeout(() => {
            setIsUploading(false);
            onComplete(); 
         }, 500);
      } else {
         throw new Error(response.error || "Ingestion failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      setIsUploading(false);
      setGlobalError(error.message || "Failed to upload data.");
    }
  };

  const totalFiles = Object.keys(files).length;
  const totalSize = Object.values(files).reduce((sum, f) => sum + (f?.size || 0), 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
      {/* Left Panel: Files */}
      <Box sx={{ flex: 1 }}>
        <Paper
          variant="outlined"
          sx={{
            p: 4, mb: 3, border: '2px dashed #cbd5e1', borderRadius: 2, bgcolor: '#f8fafc',
            textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
            '&:hover': { borderColor: 'primary.main', bgcolor: '#f0f7ff' }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDragDrop}
        >
          <CloudUploadIcon sx={{ fontSize: 56, color: '#94a3b8', mb: 2 }} />
          <Typography variant="h6" fontWeight="600" color="text.primary" gutterBottom>Drag & Drop CSV Files</Typography>
          <Typography variant="body2" color="text.secondary">Auto-maps files like <strong>alerts.csv</strong>, etc.</Typography>
        </Paper>

        <Stack spacing={1.5}>
          {fileSlots.map((slot) => {
            const file = files[slot.key];
            const status = statusMap[slot.key];
            return (
              <Paper key={slot.key} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', borderColor: file ? 'primary.main' : '#e0e0e0', bgcolor: file ? slot.color : '#fafafa' }}>
                <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
                   {status === 'success' ? <CheckCircleIcon color="success" /> : slot.icon}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight="700">{slot.label} {slot.required && <Chip label="Required" size="small" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} color="error" />}</Typography>
                  <Typography variant="caption" color="text.secondary">{file ? file.name : slot.desc}</Typography>
                </Box>
                <Box>
                  {file ? (
                    <IconButton size="small" onClick={() => { const n = {...files}; delete n[slot.key]; setFiles(n); }}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                  ) : (
                    <Button component="label" size="small" variant="outlined" sx={{ fontSize: '0.75rem' }}>
                        Select<input type="file" hidden accept=".csv" onChange={(e) => handleFileSelect(slot.key, e)} />
                    </Button>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Stack>
      </Box>

      {/* Right Panel: Summary */}
      <Box sx={{ width: { xs: '100%', md: 320 } }}>
        <Paper variant="outlined" sx={{ p: 3, bgcolor: '#fafafa', height: '100%' }}>
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ mb: 2 }}>INGESTION SUMMARY</Typography>
            {globalError && <Alert severity="error" sx={{ mb: 2 }}>{globalError}</Alert>}
            
            <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'white' }}>
                <Box display="flex" justifyContent="space-between"><Typography variant="caption">Files</Typography><Typography variant="caption" fontWeight="bold">{totalFiles}</Typography></Box>
                <Divider sx={{ my: 1 }} />
                <Box display="flex" justifyContent="space-between"><Typography variant="caption">Size</Typography><Typography variant="caption" fontWeight="bold">{(totalSize/1024).toFixed(1)} KB</Typography></Box>
            </Paper>

            {isUploading && <LinearProgress variant="determinate" value={uploadProgress} sx={{ mb: 2, height: 8, borderRadius: 1 }} />}

            <Box mt={2}>
                <Button fullWidth variant="contained" disabled={isUploading || !files.alerts} onClick={handleStartUpload}>
                    {isUploading ? "Processing..." : "Start Ingestion"}
                </Button>
            </Box>
        </Paper>
      </Box>
    </Box>
  );
};

// ============================================================================
// SUB-COMPONENT 3: CONNECTOR MANAGER (Merged Feature)
// ============================================================================
const ConnectorManagerPanel = ({ onSyncComplete }) => {
  // Global State
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null); 
  const [filter, setFilter] = useState('');
  
  // Feedback State
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', action: null });

  // Initial Load
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
      message: 'This action is irreversible.',
      action: () => handleDelete(id)
    });
  };

  const filteredConnectors = connectors.filter(c => 
    c.name.toLowerCase().includes(filter.toLowerCase()) || 
    c.db_type.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: '#f1f5f9', overflow: 'hidden' }}>
      
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
                        <StorageIcon fontSize="small" color={selectedId === c.connector_id ? 'primary' : 'action'} />
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
            onSyncComplete={onSyncComplete}
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

// --- WORKSPACE COMPONENT ---
const ConnectorWorkspace = ({ mode, connector, onSave, onCancel, onDelete, onSyncComplete }) => {
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
    try {
      // In a real app, you might pass connector.connector_id
      const res = await apiClient.post(`/api/v2/connectors/${connector.connector_id}/sync`);
      if (res.success) {
        alert("Ingestion Started");
        if (onSyncComplete) onSyncComplete();
      }
    } catch(e) {
      alert("Sync Mock: Ingestion Triggered (Simulated)");
      if (onSyncComplete) onSyncComplete();
    } finally {
      setExecuting(false);
    }
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
                <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>
                  Delete
                </Button>
                <Button 
                   variant="contained" 
                   color="success" 
                   startIcon={executing ? <RefreshIcon className="animate-spin"/> : <PlayArrowIcon />} 
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
                      startIcon={testing ? <RefreshIcon className="animate-spin"/> : <Science />} 
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

// --- EMPTY STATE ---
const EmptyState = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
    <StorageIcon sx={{ fontSize: 64, color: 'action.disabled', mb: 2 }} />
    <Typography variant="h6">No Connector Selected</Typography>
    <Typography variant="body2">Select a connector from the list or create a new one.</Typography>
  </Box>
);

const FccPublishedRunsPanel = ({ onImportComplete }) => {
  const { activeEnv, availableEnvironments, loadAvailableEnvironments, userRole } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [importingId, setImportingId] = useState('');
  const [targetMode, setTargetMode] = useState(userRole === 'TENANT_ADMIN' ? 'new' : 'existing');
  const [targetEnvId, setTargetEnvId] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);

  const canCreateEnvironment = userRole === 'TENANT_ADMIN';
  const environmentOptions = Array.isArray(availableEnvironments)
    ? [...availableEnvironments].filter(Boolean).sort((left, right) => String(left).localeCompare(String(right)))
    : [];

  useEffect(() => {
    loadAvailableEnvironments();
  }, [loadAvailableEnvironments]);

  useEffect(() => {
    if (!canCreateEnvironment && targetMode === 'new') {
      setTargetMode('existing');
    }
  }, [canCreateEnvironment, targetMode]);

  useEffect(() => {
    if (canCreateEnvironment && targetMode !== 'new' && !targetEnvId) {
      setTargetMode('new');
    }
  }, [canCreateEnvironment, targetEnvId, targetMode]);

  useEffect(() => {
    if (!canCreateEnvironment || newEnvName.trim()) {
      return;
    }
    const baseName = String(activeEnv || 'sentinel')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sentinel';
    const suffix = String(Date.now()).slice(-4);
    setNewEnvName(`${baseName}_fcc_bridge_${suffix}`);
  }, [activeEnv, canCreateEnvironment, newEnvName]);

  const loadPublishedRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listFccPublishedRuns();
      setRows(res?.published || []);
    } catch (err) {
      setError(err.message || 'Failed to load FCC bridge packages.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublishedRuns();
  }, []);

  const resolveTargetEnvId = () => {
    if (targetMode === 'new') {
      return String(newEnvName || '').trim();
    }
    return String(targetEnvId || '').trim();
  };

  const ensureTargetEnvironment = async (candidateEnvId) => {
    const envName = String(candidateEnvId || '').trim();
    if (!envName) {
      throw new Error('Choose a target Sentinel workspace before importing.');
    }
    if (targetMode !== 'new') {
      return envName;
    }
    if (!canCreateEnvironment) {
      throw new Error('Only tenant administrators can create a fresh Sentinel workspace.');
    }
    if (environmentOptions.includes(envName)) {
      return envName;
    }
    await apiClient.post('/api/v2/env/create', { name: envName });
    await loadAvailableEnvironments();
    return envName;
  };

  const handleImport = async (publishId) => {
    setImportingId(String(publishId || ''));
    setError(null);
    try {
      const requestedTargetEnv = resolveTargetEnvId();
      const ensuredTargetEnv = await ensureTargetEnvironment(requestedTargetEnv);
      const res = await apiClient.importFccPublishedRun({
        publish_id: publishId,
        target_env_id: ensuredTargetEnv,
        replace_existing: targetMode === 'existing' ? replaceExisting : false,
        rerank_after_import: true,
      });
      const imported = res?.import || {};
      const importedTargetEnv = String(imported.target_env_id || ensuredTargetEnv || '').trim();
      const importedIntoActiveEnv = Boolean(importedTargetEnv && activeEnv && importedTargetEnv === String(activeEnv));
      const packageLabel = String(imported.publish_id || publishId).slice(0, 12);
      const successMessage = importedIntoActiveEnv
        ? `Imported FCC package ${packageLabel} into the active Sentinel workspace.`
        : `Imported FCC package ${packageLabel} into workspace ${importedTargetEnv}. Switch to that workspace to start investigation.`;
      await onImportComplete(
        { message: successMessage, importedIntoActiveEnv },
      );
      await loadAvailableEnvironments();
      await loadPublishedRuns();
    } catch (err) {
      setError(err.message || 'Failed to import FCC bridge package.');
    } finally {
      setImportingId('');
    }
  };

  const selectedTargetEnv = resolveTargetEnvId();
  const importDestinationReady = Boolean(selectedTargetEnv);
  const isCurrentWorkspaceSelected = targetMode === 'existing' && Boolean(targetEnvId) && String(targetEnvId) === String(activeEnv || '');

  return (
    <Stack spacing={3} sx={{ maxWidth: 1040 }}>
      <Alert severity="info" variant="outlined">
        Import a retained FCC queue into Sentinel. Recommended path: send it into a fresh investigation workspace so the current analyst queue stays untouched.
      </Alert>

      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>FCC Published Runs</Typography>
          <Typography variant="body2" color="text.secondary">
            Use this when FCC has already scored a batch and you want Sentinel to investigate only the retained queue.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadPublishedRuns} disabled={loading}>
          Refresh
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Import Destination
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Packages are read from the current workspace and then copied into the Sentinel workspace you choose below.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <Chip
              label={`Current workspace: ${activeEnv || 'Not selected'}`}
              variant="outlined"
              size="small"
            />
            <Chip
              label={`Destination: ${selectedTargetEnv || 'Choose workspace'}`}
              color={selectedTargetEnv ? 'primary' : 'default'}
              variant={selectedTargetEnv ? 'filled' : 'outlined'}
              size="small"
            />
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel id="fcc-bridge-destination-mode-label">Destination type</InputLabel>
            <Select
              labelId="fcc-bridge-destination-mode-label"
              label="Destination type"
              value={targetMode}
              onChange={(event) => {
                setTargetMode(event.target.value);
                setReplaceExisting(false);
              }}
            >
              <MenuItem value="new" disabled={!canCreateEnvironment}>
                Create fresh workspace (recommended)
              </MenuItem>
              <MenuItem value="existing">Use existing workspace</MenuItem>
            </Select>
          </FormControl>

          {targetMode === 'new' ? (
            <TextField
              fullWidth
              size="small"
              label="New Sentinel workspace name"
              value={newEnvName}
              onChange={(event) => setNewEnvName(event.target.value)}
              disabled={!canCreateEnvironment}
              helperText={
                canCreateEnvironment
                  ? 'This workspace will be created automatically when you import the FCC package.'
                  : 'Tenant administrator access is required to create a fresh investigation workspace.'
              }
            />
          ) : (
            <Stack spacing={1.25}>
              <FormControl fullWidth size="small">
                <InputLabel id="fcc-bridge-target-env-label">Target workspace</InputLabel>
                <Select
                  labelId="fcc-bridge-target-env-label"
                  label="Target workspace"
                  value={targetEnvId}
                  onChange={(event) => setTargetEnvId(event.target.value)}
                >
                  <MenuItem value="">
                    <em>Select a workspace</em>
                  </MenuItem>
                  {environmentOptions.map((envName) => (
                    <MenuItem key={envName} value={envName}>
                      {envName}
                      {envName === activeEnv ? ' (Active)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={replaceExisting}
                    onChange={(event) => setReplaceExisting(event.target.checked)}
                  />
                }
                label="Replace investigation data in the selected workspace"
              />
              <Typography variant="caption" color="text.secondary">
                Leave replacement off to protect an existing workspace. Use a fresh workspace whenever possible.
              </Typography>
            </Stack>
          )}

          {!canCreateEnvironment && targetMode === 'existing' && environmentOptions.length === 0 && (
            <Alert severity="warning" variant="outlined">
              No Sentinel workspaces are available yet. Ask a tenant administrator to create one before importing an FCC package.
            </Alert>
          )}

          {isCurrentWorkspaceSelected && !replaceExisting && (
            <Alert severity="warning" variant="outlined">
              You selected the active Sentinel workspace. Keep this safe by switching to a fresh workspace, or explicitly enable replacement if you want to overwrite the current investigation data.
            </Alert>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ p: 5, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No FCC bridge packages are available yet. Publish a retained batch from the FCC Deployment Dashboard first.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Publish</TableCell>
                  <TableCell>Run</TableCell>
                  <TableCell align="right">Rows</TableCell>
                  <TableCell align="right">Threshold</TableCell>
                  <TableCell>Published</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.publish_id} hover>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {row.publish_label || row.publish_id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {String(row.publish_id || '').slice(0, 12)}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{String(row.run_id || '').slice(0, 12) || 'N/A'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Chip label={Number(row.published_rows || 0).toLocaleString()} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {row.threshold == null ? '-' : Number(row.threshold).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.published_at || '-'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleImport(row.publish_id)}
                        disabled={importingId === row.publish_id || !importDestinationReady}
                      >
                        {importingId === row.publish_id
                          ? 'Importing...'
                          : importDestinationReady
                            ? 'Import To Selected Workspace'
                            : 'Choose Destination'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  );
};

export default DataLoadScreen;
