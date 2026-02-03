import React, { useState, useEffect } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";

// ✅ 1. NEW ARCHITECTURE IMPORT
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box, Paper, Typography, Button, Stack, Chip, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select,
  MenuItem, FormControl, InputLabel, IconButton, Divider, List, ListItem,
  ListItemText, Card, CardContent, Tabs, Tab, Tooltip, Badge
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon, Save as SaveIcon, Delete as DeleteIcon,
  Edit as EditIcon, WaterDrop as DropletIcon, AutoFixHigh as WandIcon,
  Calculate as CalculatorIcon, Close as CloseIcon, 
  ArrowForward as ArrowForwardIcon, Refresh as RefreshIcon, 
  TableChart as TableIcon
} from '@mui/icons-material';

const DataCleanScreen = () => {
  const [registry, setRegistry] = useState([]);
  const [viewMode, setViewMode] = useState('select');
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [metadata, setMetadata] = useState({ columns: [], total_rows: 0 });
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [modalData, setModalData] = useState({});
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => { loadRegistry(); }, []);

  const loadRegistry = async () => {
    try {
      const data = await apiClient.get('/api/v2/merge/registry');
      if (Array.isArray(data)) setRegistry(data);
    } catch (e) { console.error(e); }
  };

  const handleSelectDataset = (dataset) => {
    setSelectedDataset(dataset);
    setViewMode('clean');
    refreshTableData(dataset.table_name);
  };

  const refreshTableData = async (tableName) => {
    setLoading(true);
    try {
      const metaRes = await apiClient.post('/api/v2/clean/columns', { table: tableName });
      if (metaRes.columns) setMetadata(metaRes);

      const prevRes = await apiClient.post('/api/v2/db/query-table', { table: tableName, page: 1, rowsPerPage: 20 });
      if (prevRes.success) setPreview(prevRes.data);
    } catch (e) { 
      setNotification({ type: 'error', msg: 'Failed to load data' }); 
    } finally { 
      setLoading(false); 
    }
  };

  // Actions
  const initDropColumn = (colName) => {
    setModalData({ col: colName });
    setActiveModal('delete_confirm');
  };

  const executeDropColumn = async () => {
    if (!selectedDataset || !modalData.col) return;
    setLoading(true);
    try {
      await apiClient.post('/api/v2/clean/drop-column', {
        table: selectedDataset.table_name,
        column: modalData.col
      });
      setNotification({ type: 'success', msg: `Dropped column: ${modalData.col}` });
      setActiveModal(null);
      await refreshTableData(selectedDataset.table_name);
    } catch (e) {
      setNotification({ type: 'error', msg: e.message || "Failed to drop column" });
      setLoading(false);
    }
  };

  const executeRename = async (renames) => {
    setLoading(true);
    try {
      await apiClient.post('/api/v2/clean/rename-batch', {
        table: selectedDataset.table_name,
        renames: renames
      });
      setNotification({ type: 'success', msg: "Columns renamed successfully" });
      setActiveModal(null);
      await refreshTableData(selectedDataset.table_name);
    } catch (e) {
      setNotification({ type: 'error', msg: e.message || "Rename failed" });
      setLoading(false);
    }
  };

  const executeFillNulls = async (column, strategy, value) => {
    setLoading(true);
    try {
      await apiClient.post('/api/v2/clean/fill-nulls', {
        table: selectedDataset.table_name,
        column,
        strategy,
        value
      });
      setNotification({ type: 'success', msg: `Filled nulls in ${column}` });
      setActiveModal(null);
      await refreshTableData(selectedDataset.table_name);
    } catch (e) {
      setNotification({ type: 'error', msg: e.message || "Imputation failed" });
      setLoading(false);
    }
  };

  const executeAddFeature = async (name, expr) => {
    setLoading(true);
    try {
      await apiClient.post('/api/v2/clean/add-feature', {
        table: selectedDataset.table_name,
        name: name,
        expression: expr
      });
      setNotification({ type: 'success', msg: `Created feature: ${name}` });
      setActiveModal(null);
      await refreshTableData(selectedDataset.table_name);
    } catch (e) {
      setNotification({ type: 'error', msg: e.message || "Feature creation failed" });
      setLoading(false);
    }
  };

  const handleAutoType = async () => {
    setLoading(true);
    try {
      await apiClient.post('/api/v2/clean/auto-type', { table: selectedDataset.table_name });
      setNotification({ type: 'success', msg: `Type conversion complete` });
      await refreshTableData(selectedDataset.table_name);
    } catch (e) {
      setNotification({ type: 'error', msg: "Auto-type failed" });
      setLoading(false);
    }
  };

  const executeCommit = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/clean/commit-master', {
        source_table: selectedDataset.table_name
      });
      if (res.success) {
        setNotification({ type: 'success', msg: "Master Data Saved Successfully!" });
        setActiveModal(null);
      } else {
        throw new Error(res.error);
      }
    } catch (e) {
      setNotification({ type: 'error', msg: e.message || "Commit failed" });
    } finally {
      setLoading(false);
    }
  };

  // --- VIEW 1: DATASET SELECTION ---
  if (viewMode === 'select') {
    return (
      <PageContainer 
        title="Data Cleaning & Engineering" 
        subtitle="Select a dataset to begin transformation"
        breadcrumbs={['System', 'Cleaning']}
      >
        <Box sx={{ maxWidth: 900, mx: 'auto' }}>
            {registry.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <TableIcon sx={{ fontSize: 64, color: '#cbd5e1', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>No datasets found</Typography>
                <Typography variant="body2" color="text.disabled">Create datasets in Data Management first</Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {registry.map(ds => (
                  <Card
                    key={ds.id}
                    variant="outlined"
                    onClick={() => handleSelectDataset(ds)}
                    sx={{
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: 'primary.main', boxShadow: 2 }
                    }}
                  >
                    <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 3 }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" fontWeight="700" gutterBottom>{ds.display_name}</Typography>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <Chip
                            label={ds.table_name}
                            size="small"
                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 20, bgcolor: '#f5f5f5' }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {ds.row_count.toLocaleString()} rows
                          </Typography>
                        </Stack>
                      </Box>
                      <ArrowForwardIcon sx={{ color: 'primary.main' }} />
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
        </Box>
      </PageContainer>
    );
  }

  // --- VIEW 2: CLEANING EDITOR ---
  return (
    <PageContainer 
      title={`Cleaning: ${selectedDataset?.display_name}`}
      subtitle="Transform and engineer features"
      breadcrumbs={['System', 'Cleaning', 'Editor']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" size="small" startIcon={<ArrowBackIcon />} onClick={() => setViewMode('select')} sx={{ fontWeight: 600 }}>
            Back
          </Button>
          <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={() => setActiveModal('rename')} sx={{ fontWeight: 600 }}>
            Rename
          </Button>
          <Button variant="outlined" size="small" startIcon={<CalculatorIcon />} onClick={() => setActiveModal('feature')} sx={{ fontWeight: 600 }}>
            Add Feature
          </Button>
          <Button variant="outlined" size="small" startIcon={<WandIcon />} onClick={handleAutoType} disabled={loading} sx={{ fontWeight: 600 }}>
            Auto-Type
          </Button>
          <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={() => setActiveModal('confirm')} disabled={loading} sx={{ fontWeight: 600 }}>
            Finalize Master
          </Button>
        </Stack>
      }
    >
      {/* Notification */}
      {notification && (
        <Alert
          severity={notification.type}
          onClose={() => setNotification(null)}
          sx={{ mb: 2, borderRadius: 2 }}
        >
          {notification.msg}
        </Alert>
      )}

      {/* Main Content Body */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        
        {/* Tabs for Advanced Features */}
        <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
          <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa' }}>
            <Tab label="Basic Cleaning" sx={{ fontWeight: 600, textTransform: 'none' }} />
            <Tab 
              label={
                // <Badge badgeContent="Soon" color="secondary" sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: 14, minWidth: 14 } }}>
                  <Box>Normalization</Box>
                // </Badge>
              } 
              disabled 
              sx={{ fontWeight: 600, textTransform: 'none' }} 
            />
            <Tab 
              label={
                // <Badge badgeContent="Soon" color="secondary" sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: 14, minWidth: 14 } }}>
                  <Box>Encoding</Box>
                // </Badge>
              } 
              disabled 
              sx={{ fontWeight: 600, textTransform: 'none' }} 
            />
          </Tabs>
        </Paper>

        {/* Main Grid: Height calculated to fit within PageContainer padding */}
        <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 280px)', minHeight: 400 }}>
          
          {/* Left: Column List */}
          <Paper variant="outlined" sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Columns ({metadata.columns.length})
              </Typography>
              <Chip label={`${metadata.total_rows.toLocaleString()} rows`} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }} />
            </Box>
            
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
              <List dense disablePadding>
                {metadata.columns.map((col, idx) => (
                  <React.Fragment key={col.name}>
                    <ListItem
                      sx={{
                        py: 1.5,
                        '&:hover': { bgcolor: '#f8fafc' },
                        '&:hover .action-buttons': { opacity: 1 }
                      }}
                    >
                      <ListItemText
                        primary={
                          <Typography variant="body2" fontWeight="600" noWrap title={col.name}>
                            {col.name}
                          </Typography>
                        }
                        secondary={
                          <Stack direction="row" spacing={0.5} mt={0.5}>
                            <Chip
                              label={col.inferred_type}
                              size="small"
                              sx={{ height: 16, fontSize: '0.65rem', textTransform: 'uppercase', bgcolor: '#f5f5f5', fontWeight: 700 }}
                            />
                            {col.missing_count > 0 && (
                              <Chip
                                label={`${col.missing_pct}% Null`}
                                size="small"
                                sx={{ height: 16, fontSize: '0.65rem', bgcolor: '#fee2e2', color: '#991b1b', fontWeight: 700 }}
                              />
                            )}
                          </Stack>
                        }
                      />
                      <Stack direction="row" spacing={0.5} className="action-buttons" sx={{ opacity: 0, transition: 'opacity 0.2s' }}>
                        <Tooltip title="Fill Nulls">
                          <IconButton
                            size="small"
                            onClick={() => { setModalData({ col: col.name }); setActiveModal('nulls'); }}
                            sx={{ '&:hover': { bgcolor: '#dbeafe', color: 'primary.main' } }}
                          >
                            <DropletIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Drop Column">
                          <IconButton
                            size="small"
                            onClick={() => initDropColumn(col.name)}
                            sx={{ '&:hover': { bgcolor: '#fee2e2', color: 'error.main' } }}
                          >
                            <DeleteIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </ListItem>
                    {idx < metadata.columns.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            </Box>
          </Paper>

          {/* Right: Data Preview */}
          <Paper variant="outlined" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Data Preview ({preview.length} of {metadata.total_rows.toLocaleString()} Rows)
              </Typography>
              <Tooltip title="Refresh Preview">
                <IconButton size="small" onClick={() => refreshTableData(selectedDataset.table_name)} disabled={loading}>
                  <RefreshIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            
            <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'auto', minHeight: 0 }}>
              {loading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      {metadata.columns.map(c => (
                        <th key={c.name} style={{ padding: '12px', textAlign: 'left', backgroundColor: '#fafafa', borderBottom: '2px solid #e0e0e0', fontWeight: 700, color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: 120 }}>
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        {metadata.columns.map(c => (
                          <td key={c.name} style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f8fafc', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row[c.name] === null || row[c.name] === '' ? (
                              <span style={{ color: '#cbd5e1', fontStyle: 'italic', fontSize: '0.75rem' }}>null</span>
                            ) : (
                              String(row[c.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Box>
          </Paper>
        </Box>
      </Box>

      {/* Modals */}
      {activeModal && (
        <Dialog
          open={Boolean(activeModal)}
          onClose={() => setActiveModal(null)}
          maxWidth="sm"
          fullWidth
          PaperProps={{ sx: { borderRadius: 2 } }}
        >
          <DialogTitle sx={{ bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 2 }}>
            <Typography variant="h6" fontWeight="700">
              {activeModal === 'delete_confirm' && 'Confirm Deletion'}
              {activeModal === 'rename' && 'Batch Rename Columns'}
              {activeModal === 'feature' && 'Add New Feature'}
              {activeModal === 'nulls' && `Handle Nulls: ${modalData.col}`}
              {activeModal === 'confirm' && 'Final Verification'}
            </Typography>
            <IconButton size="small" onClick={() => setActiveModal(null)}>
              <CloseIcon />
            </IconButton>
          </DialogTitle>

          <DialogContent sx={{ pt: 3 }}>
            {activeModal === 'delete_confirm' && (
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ width: 56, height: 56, bgcolor: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                  <DeleteIcon sx={{ fontSize: 28, color: 'error.main' }} />
                </Box>
                <Typography variant="h6" fontWeight="700" gutterBottom>Delete Column?</Typography>
                <Typography variant="body2" color="text.secondary" mb={3}>
                  Are you sure you want to remove <strong>{modalData.col}</strong>? This cannot be undone.
                </Typography>
              </Box>
            )}

            {activeModal === 'rename' && <RenameForm columns={metadata.columns} onSave={executeRename} />}
            {activeModal === 'nulls' && <NullForm column={modalData.col} onSave={executeFillNulls} />}
            {activeModal === 'feature' && <FeatureForm onSave={executeAddFeature} existingCols={metadata.columns.map(c => c.name)} />}

            {activeModal === 'confirm' && (
              <Box>
                <Alert severity="success" sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" fontWeight="700" gutterBottom>Ready to Commit?</Typography>
                  <Typography variant="body2">
                    This will save the current dataset as <strong>master_cleaned_data</strong>. All subsequent analysis will use this version.
                  </Typography>
                </Alert>
              </Box>
            )}
          </DialogContent>

          <DialogActions sx={{ p: 2.5, borderTop: '1px solid #e0e0e0', bgcolor: '#fafafa' }}>
            {activeModal === 'delete_confirm' && (
              <>
                <Button onClick={() => setActiveModal(null)} variant="outlined" sx={{ fontWeight: 600 }}>Cancel</Button>
                <Button onClick={executeDropColumn} variant="contained" color="error" sx={{ fontWeight: 700 }}>Yes, Delete</Button>
              </>
            )}
            {activeModal === 'confirm' && (
              <>
                <Button onClick={() => setActiveModal(null)} variant="outlined" sx={{ fontWeight: 600 }}>Cancel</Button>
                <Button onClick={executeCommit} variant="contained" disabled={loading} sx={{ fontWeight: 700 }}>
                  {loading ? 'Saving...' : 'Confirm & Save Master'}
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}
    </PageContainer>
  );
};

// Sub Components
const RenameForm = ({ columns, onSave }) => {
  const [renames, setRenames] = useState({});
  
  const handleChange = (old, newName) => {
    setRenames(prev => {
      const next = { ...prev };
      if (newName && newName !== old) {
        next[old] = newName;
      } else {
        delete next[old];
      }
      return next;
    });
  };

  return (
    <Box>
      <Box sx={{ maxHeight: 300, overflowY: 'auto', mb: 3 }}>
        <Stack spacing={1.5}>
          {columns.map(col => (
            <Stack key={col.name} direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" sx={{ width: 140, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                {col.name}
              </Typography>
              <ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              <TextField
                size="small"
                placeholder={col.name}
                onChange={(e) => handleChange(col.name, e.target.value)}
                fullWidth
                sx={{ '& .MuiInputBase-input': { fontSize: '0.875rem' } }}
              />
            </Stack>
          ))}
        </Stack>
      </Box>
      <Button fullWidth variant="contained" onClick={() => onSave(renames)} disabled={Object.keys(renames).length === 0} sx={{ fontWeight: 700 }}>
        Apply Renames ({Object.keys(renames).length})
      </Button>
    </Box>
  );
};

const NullForm = ({ column, onSave }) => {
  const [strategy, setStrategy] = useState('value');
  const [val, setVal] = useState('0');

  return (
    <Box>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Strategy</InputLabel>
        <Select value={strategy} onChange={e => setStrategy(e.target.value)} label="Strategy">
          <MenuItem value="value">Fill with Specific Value</MenuItem>
          <MenuItem value="mean">Fill with Mean (Numeric)</MenuItem>
          <MenuItem value="mode">Fill with Mode (Frequent)</MenuItem>
        </Select>
      </FormControl>

      {strategy === 'value' && (
        <TextField
          fullWidth
          label="Value"
          value={val}
          onChange={e => setVal(e.target.value)}
          sx={{ mb: 2 }}
        />
      )}

      <Button fullWidth variant="contained" onClick={() => onSave(column, strategy, val)} sx={{ fontWeight: 700 }}>
        Fix Nulls
      </Button>
    </Box>
  );
};

const FeatureForm = ({ onSave, existingCols }) => {
  const [name, setName] = useState('');
  const [expr, setExpr] = useState('');

  return (
    <Box>
      <TextField
        fullWidth
        label="New Column Name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g., total_risk_score"
        sx={{ mb: 2 }}
      />
      
      <TextField
        fullWidth
        label="Formula (Pandas Syntax)"
        value={expr}
        onChange={e => setExpr(e.target.value)}
        placeholder="e.g., amount * 0.18"
        multiline
        rows={4}
        sx={{ mb: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' } }}
      />
      
      <Typography variant="caption" color="text.secondary" display="block" mb={2}>
        Available columns: {existingCols.slice(0, 3).join(', ')}...
      </Typography>

      <Button fullWidth variant="contained" onClick={() => onSave(name, expr)} disabled={!name || !expr} sx={{ fontWeight: 700 }}>
        Create Feature
      </Button>
    </Box>
  );
};

export default DataCleanScreen;