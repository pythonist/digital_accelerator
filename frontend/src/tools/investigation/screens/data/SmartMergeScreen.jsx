import React, { useState, useEffect, useRef } from 'react';
import { usePersistentState } from "@context/AppContext"; 
import apiClient from "@services/api"; 

// ✅ Correct Layout Import
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box, Button, Card, CardContent, FormControl, IconButton, InputLabel, Menu, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Chip, CircularProgress, List, ListItem, ListItemIcon, ListItemText, Fade, LinearProgress, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField
} from '@mui/material';

import {
  AutoFixHigh as WandIcon, ArrowForward as ArrowRightIcon, Add as PlusIcon, Storage as DatabaseIcon, PlayArrow as PlayIcon, Save as SaveIcon, Bolt as ZapIcon, Layers as LayersIcon, Close as CloseIcon, AccessTime as ClockIcon, Error as ErrorIcon, Info as InfoIcon, Check as CheckIcon, ViewList as ListIcon, Delete as DeleteIcon, Visibility as VisibilityIcon
} from '@mui/icons-material';

const SOURCE_COLORS = {
  alerts: { bg: '#fff3e0', label: 'Alerts', border: '#ff9800' },
  transactions: { bg: '#e8f5e9', label: 'Transactions', border: '#4caf50' },
  customers: { bg: '#e3f2fd', label: 'Customers', border: '#2196f3' },
  accounts: { bg: '#f3e5f5', label: 'Accounts', border: '#9c27b0' },
  sanctions: { bg: '#fce4ec', label: 'Sanctions', border: '#e91e63' },
  cases: { bg: '#fff9c4', label: 'Cases', border: '#fbc02d' },
  default: { bg: '#f5f5f5', label: 'Other', border: '#9e9e9e' }
};

const SmartMergeScreen = () => {
  const [chain, setChain] = usePersistentState('merge_chain', []);
  const [aiSuggestions, setAiSuggestions] = usePersistentState('merge_aiSuggestions', []);
  const [availableTables, setAvailableTables] = useState([]);
  const [cumulativeKeys, setCumulativeKeys] = useState([]); 
  const [currentTableKeys, setCurrentTableKeys] = useState({});
  const [registry, setRegistry] = useState([]);
  const [previewData, setPreviewData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [buildLogs, setBuildLogs] = useState([]);
  const [buildInProgress, setBuildInProgress] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDatasetName, setSaveDatasetName] = useState('');
  const [lastBuiltTable, setLastBuiltTable] = useState(null);
  const [customSaveOpen, setCustomSaveOpen] = useState(false);
  const [customDatasetName, setCustomDatasetName] = useState('My Custom Build');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  
  const openMenu = Boolean(anchorEl);
  const logsEndRef = useRef(null);

  const getSourceTables = () => {
    if (!previewData.length) return [];
    const sources = new Set();
    previewData.forEach(row => { if (row.__source) sources.add(row.__source); });
    return Array.from(sources);
  };

  useEffect(() => { loadTables(); loadRegistry(); }, []);
  
  useEffect(() => {
    if (buildLogs.length > 0 && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs]);

  useEffect(() => {
    const updateCumulative = async () => {
      if (chain.length === 0) return;
      const tableList = chain.map(c => c.table);
      try {
        const keys = await apiClient.post('/api/v2/merge/cumulative-keys', { tables: tableList });
        setCumulativeKeys(keys || []);
      } catch (e) { console.error("Key fetch failed", e); }
    };
    updateCumulative();
  }, [chain.length]);

  const loadTables = async () => {
    try {
      const data = await apiClient.get('/api/v2/merge/tables');
      const tables = data.filter(t => !['sqlite_sequence', 'system_master_registry'].includes(t) && !t.startsWith('master_'));
      setAvailableTables(tables);
      if (chain.length === 0 && tables.includes('alerts')) { handleTableAdd('alerts'); }
    } catch (e) { console.error(e); }
  };

  const loadRegistry = async () => {
    try { const data = await apiClient.get('/api/v2/merge/registry'); setRegistry(data || []); }
    catch(e) { console.error("Registry load failed", e); }
  };

  const handleTableAdd = async (tableName) => {
    const keys = await apiClient.post('/api/v2/merge/keys', { table: tableName });
    setCurrentTableKeys(prev => ({ ...prev, [tableName]: keys }));
    if (chain.length === 0) {
      setChain([{ table: tableName, id: Date.now() }]);
    } else {
      const prevTable = chain[chain.length - 1].table;
      if (!currentTableKeys[prevTable]) {
        const prevKeys = await apiClient.post('/api/v2/merge/keys', { table: prevTable });
        setCurrentTableKeys(prev => ({ ...prev, [prevTable]: prevKeys }));
      }
      setChain(prev => [...prev, { table: tableName, id: Date.now(), join_type: 'LEFT JOIN', left_on: '', right_on: '', risk: null }]);
    }
    setAnchorEl(null);
  };

  const handleAIRecommend = async () => {
    setAnalyzing(true); setSaveStatus(null);
    try {
      let payload = {};
      if (chain.length > 0) payload.left_table = chain[chain.length - 1].table;
      const res = await apiClient.post('/api/v2/merge/ai-recommend', payload);
      if (res.success) {
        if (res.suggestions.length > 0) setAiSuggestions(res.suggestions);
        else setSaveStatus("No obvious join keys found.");
      }
    } catch (err) { setSaveStatus("AI service failed."); } 
    finally { setAnalyzing(false); }
  };

  const updateStep = (index, field, value) => {
    const newChain = [...chain]; newChain[index][field] = value; setChain(newChain);
  };

  const removeStep = (index) => {
    const newChain = [...chain]; newChain.splice(index, 1); setChain(newChain);
  };

  const runPreview = async () => {
    setLoading(true); setBuildLogs([]); setSaveStatus(null);
    try {
      const res = await apiClient.post('/api/v2/merge/preview', { chain });
      if (res.success) setPreviewData(res.data);
      else setSaveStatus(`❌ Error: ${res.error || 'Preview failed'}`);
    } catch (e) { setSaveStatus(`❌ Error: ${e.message}`); }
    setLoading(false);
  };

  const handleSaveCustom = () => {
    setCustomDatasetName('My Custom Build');
    setCustomSaveOpen(true);
  };

  const confirmSaveCustom = async () => {
    const name = (customDatasetName || '').trim();
    if (!name) {
      setSaveStatus("Please enter a dataset name.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/merge/commit', { chain, name });
      if (res.success) {
        setSaveStatus(`✅ Saved: ${res.message || name}`);
        await loadRegistry();
        setCustomSaveOpen(false);
      } else {
        setSaveStatus(`❌ Error: ${res.error || 'Save failed'}`);
      }
    } catch (e) {
      setSaveStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const buildUnifiedView = async () => {
    setLoading(true); setBuildInProgress(true); setSaveStatus(null); setBuildLogs([]);
    
    try {
      const res = await apiClient.post('/api/v2/merge/build-aml-master', { target: 'master_unified' });
      if (res.logs) setBuildLogs(res.logs);
      if (res.success) {
        setSaveStatus(`✅ Created: ${res.version} (${res.rows} rows)`);
        setLastBuiltTable(res.table);
        await loadRegistry();
        const previewRes = await apiClient.post('/api/v2/db/query-table', { table: res.table, page: 1, rowsPerPage: 10 });
        if (previewRes.success) setPreviewData(previewRes.data);
      } else { setSaveStatus("❌ Error: " + res.error); }
    } catch (e) { setSaveStatus("❌ Error: " + e.message); }
    finally { setLoading(false); setBuildInProgress(false); }
  };

  const handleSaveUnifiedView = () => {
    if (!lastBuiltTable) { setSaveStatus("No unified view to save. Please build one first."); return; }
    setSaveDatasetName(`Unified_${new Date().toISOString().split('T')[0]}`);
    setSaveDialogOpen(true);
  };

  const confirmSaveUnifiedView = async () => {
    if (!saveDatasetName.trim()) { setSaveStatus("Please enter a dataset name."); return; }
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/merge/save-unified', { source_table: lastBuiltTable, name: saveDatasetName });
      if (res.success) {
        setSaveStatus(`✅ Saved as: ${saveDatasetName}`);
        await loadRegistry();
        setSaveDialogOpen(false);
        setSaveDatasetName('');
      } else { setSaveStatus(`❌ Error: ${res.error || 'Save failed'}`); }
    } catch (e) { setSaveStatus(`❌ Error: ${e.message}`); }
    setLoading(false);
  };

  const handleDeleteDataset = async (id) => {
    if (buildInProgress) { setSaveStatus("Cannot delete dataset while build is in progress."); return; }
    setDeleteTargetId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteDataset = async () => {
    if (!deleteTargetId) return;
    setLoading(true);
    try {
      const res = await apiClient.post('/api/v2/merge/delete', { id: deleteTargetId });
      if (res.success) {
        setSaveStatus("✅ Deleted dataset");
        await loadRegistry();
      } else {
        setSaveStatus(`❌ Error: ${res.error || 'Delete failed'}`);
      }
    } catch (e) {
      setSaveStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setDeleteTargetId(null);
    }
  };

  const handleViewDataset = async (tableName) => {
    try {
      const res = await apiClient.post('/api/v2/db/query-table', { table: tableName, page: 1, rowsPerPage: 20 });
      if (res.success) setPreviewData(res.data);
      else setSaveStatus("Failed to load dataset preview.");
    } catch (e) { setSaveStatus("Failed to load dataset preview."); }
  };

  return (
    <PageContainer
      title="Data Harmonization"
      subtitle="Build and merge unified investigation datasets"
      breadcrumbs={['System', 'Data Merge']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Button variant="text" size="small" color="secondary" startIcon={analyzing ? <CircularProgress size={16} color="inherit"/> : <WandIcon />} onClick={handleAIRecommend} disabled={analyzing || buildInProgress}>Auto-Join</Button>
          <Button variant="outlined" size="small" startIcon={<PlayIcon />} onClick={runPreview} disabled={loading || buildInProgress}>Preview</Button>
          <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handleSaveCustom} disabled={loading || chain.length < 2 || buildInProgress}>Save Custom</Button>
          <Button variant="contained" size="small" disableElevation color="primary" startIcon={buildInProgress ? <CircularProgress size={16} color="inherit"/> : <ZapIcon />} onClick={buildUnifiedView} disabled={loading || buildInProgress} sx={{ fontWeight: '600' }}>Build Master</Button>
          <Button variant="outlined" size="small" color="success" startIcon={<SaveIcon />} onClick={handleSaveUnifiedView} disabled={loading || !lastBuiltTable || buildInProgress}>Save Unified</Button>
        </Stack>
      }
    >
      {/* Content Area - Fixed Layout */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <Dialog open={customSaveOpen} onClose={() => setCustomSaveOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Save Custom Dataset</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              fullWidth
              label="Dataset name"
              value={customDatasetName}
              onChange={(e) => setCustomDatasetName(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCustomSaveOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={confirmSaveCustom} disabled={loading}>Save</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Delete Dataset</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              This will remove the dataset from the registry and drop its table.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={confirmDeleteDataset} disabled={loading}>Delete</Button>
          </DialogActions>
        </Dialog>
        
        {/* Scrollable Content Wrapper */}
        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pb: 6 }}>
          
          {/* AI Suggestions */}
          {aiSuggestions.length > 0 && (
            <Fade in>
              <Paper elevation={0} sx={{ mb: 3, p: 2, bgcolor: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2" fontWeight="bold" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WandIcon fontSize="small" /> Recommended Joins
                  </Typography>
                  <IconButton size="small" onClick={() => setAiSuggestions([])}><CloseIcon fontSize="small" /></IconButton>
                </Stack>
                <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1 }}>
                  {aiSuggestions.map((sugg, i) => (
                    <Card key={i} variant="outlined" sx={{ minWidth: 240, cursor: 'pointer', '&:hover': { borderColor: 'primary.main', bgcolor: '#fff' } }}>
                      <CardContent sx={{ p: '12px !important' }}>
                        <Chip label={`${sugg.confidence}%`} size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem', mb: 1 }} />
                        <Typography variant="body2" fontWeight="600">{sugg.left_table} → {sugg.right_table}</Typography>
                        <Typography variant="caption" color="text.secondary">via {sugg.left_column}</Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </Paper>
            </Fade>
          )}

          {/* Chain Builder */}
          <Paper variant="outlined" sx={{ p: 0, mb: 3, borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #eee', bgcolor: '#fafafa' }}>
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LayersIcon fontSize="small" /> DATA FLOW CHAIN
              </Typography>
            </Box>
            <Box sx={{ p: 3, overflowX: 'auto', minHeight: 260, display: 'flex', alignItems: 'flex-start' }}>
              {chain.length === 0 && (
                <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 5, opacity: 0.6 }}>
                  <DatabaseIcon sx={{ fontSize: 48, color: '#ccc', mb: 2 }} />
                  <Typography variant="body1" fontWeight="500">Start your data chain</Typography>
                  <FormControl size="small" sx={{ mt: 2, width: 200 }}>
                    <InputLabel>Select Base Table</InputLabel>
                    <Select value="" label="Select Base Table" onChange={(e) => handleTableAdd(e.target.value)}>
                      {availableTables.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>
              )}
              {chain.map((step, idx) => (
                <React.Fragment key={step.id}>
                  {idx > 0 && <Box sx={{ mx: 1, mt: 5 }}><ArrowRightIcon color="action" /></Box>}
                  <Card elevation={idx === 0 ? 3 : 1} sx={{ width: idx === 0 ? 220 : 280, flexShrink: 0, border: idx === 0 ? '1px solid #1976d2' : '1px solid #e0e0e0' }}>
                    <Box sx={{ bgcolor: idx === 0 ? '#e3f2fd' : '#f5f5f5', p: 1.5, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
                      <Typography variant="caption" fontWeight="bold" color={idx === 0 ? "primary" : "text.secondary"}>{idx === 0 ? "BASE SOURCE" : "JOIN OPERATION"}</Typography>
                      <IconButton size="small" onClick={() => removeStep(idx)} disabled={buildInProgress}><CloseIcon fontSize="small" /></IconButton>
                    </Box>
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                        <DatabaseIcon fontSize="small" color={idx === 0 ? "primary" : "action"} />
                        <Typography variant="subtitle2" fontWeight="bold">{step.table}</Typography>
                      </Stack>
                      {idx > 0 && (
                        <Stack spacing={1.5}>
                          <Select variant="standard" disableUnderline value={step.join_type} onChange={e => updateStep(idx, 'join_type', e.target.value)} disabled={buildInProgress} sx={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'secondary.main', mb: 1 }}>
                            <MenuItem value="LEFT JOIN">LEFT JOIN</MenuItem>
                            <MenuItem value="INNER JOIN">INNER JOIN</MenuItem>
                          </Select>
                          <Select displayEmpty value={step.left_on} size="small" onChange={e => updateStep(idx, 'left_on', e.target.value)} disabled={buildInProgress} sx={{ fontSize: '0.85rem' }}>
                            <MenuItem value="" disabled>Key from Chain...</MenuItem>
                            {cumulativeKeys.filter(k => !k.startsWith(step.table)).map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                          </Select>
                          <Select displayEmpty value={step.right_on} size="small" onChange={e => updateStep(idx, 'right_on', e.target.value)} disabled={buildInProgress} sx={{ fontSize: '0.85rem' }}>
                            <MenuItem value="" disabled>Key from {step.table}...</MenuItem>
                            {currentTableKeys[step.table]?.map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                          </Select>
                        </Stack>
                      )}
                    </CardContent>
                  </Card>
                </React.Fragment>
              ))}
              {chain.length > 0 && (
                <Box sx={{ ml: 2, alignSelf: 'center' }}>
                  <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} disabled={buildInProgress} sx={{ border: '2px dashed #ccc', width: 48, height: 48 }}><PlusIcon /></IconButton>
                  <Menu anchorEl={anchorEl} open={openMenu} onClose={() => setAnchorEl(null)}>
                    {availableTables.filter(t => !chain.find(c => c.table === t)).map(t => (
                      <MenuItem key={t} onClick={() => handleTableAdd(t)}><DatabaseIcon fontSize="small" sx={{ mr: 1 }} /> {t}</MenuItem>
                    ))}
                  </Menu>
                </Box>
              )}
            </Box>
          </Paper>

          {/* Build Logs */}
          {buildLogs.length > 0 && (
            <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden', borderRadius: 2, border: '1px solid #b2dfdb' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#e0f2f1', borderBottom: '1px solid #b2dfdb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {buildInProgress && <CircularProgress size={16} color="success" />}
                  {!buildInProgress && <CheckIcon fontSize="small" color="success" />}
                  <Typography variant="subtitle2" fontWeight="bold" color="text.primary">Unified Build Process</Typography>
                </Box>
                {buildInProgress && <Typography variant="caption" color="text.secondary">Running...</Typography>}
                {!buildInProgress && buildLogs.length > 0 && <Typography variant="caption" color="success.main" fontWeight="bold">Completed</Typography>}
              </Box>
              {buildInProgress && <LinearProgress color="success" sx={{ height: 2 }} />}
              <List dense sx={{ maxHeight: 300, overflowY: 'auto', py: 0, bgcolor: '#fff' }}>
                {buildLogs.map((log, i) => (
                  <ListItem key={i} divider>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {(!log.status || log.status === 'success') && <CheckIcon fontSize="small" color="success" />}
                      {log.status === 'warning' && <ErrorIcon fontSize="small" color="warning" />}
                      {log.status === 'error' && <ErrorIcon fontSize="small" color="error" />}
                      {log.status === 'info' && <InfoIcon fontSize="small" color="primary" />}
                    </ListItemIcon>
                    <ListItemText primary={<Typography variant="body2" fontWeight="600">{log.step}</Typography>} secondary={log.message} />
                    <Typography variant="caption" color="text.disabled">{log.time}</Typography>
                  </ListItem>
                ))}
                <div ref={logsEndRef} />
              </List>
            </Paper>
          )}

          {/* Preview Table */}
          <Paper variant="outlined" sx={{ mb: 3, borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fff' }}>
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ListIcon fontSize="small" /> DATA PREVIEW
              </Typography>
              {saveStatus && <Chip label={saveStatus} color="success" size="small" variant="outlined" />}
            </Box>

            {previewData.length > 0 && getSourceTables().length > 0 && (
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ mr: 1 }}>SOURCE LEGEND:</Typography>
                {getSourceTables().map(source => {
                  const colorConfig = SOURCE_COLORS[source] || SOURCE_COLORS.default;
                  return (
                    <Chip key={source} label={colorConfig.label} size="small" sx={{ bgcolor: colorConfig.bg, border: `2px solid ${colorConfig.border}`, fontWeight: 'bold', fontSize: '0.7rem', height: 24 }} />
                  );
                })}
              </Box>
            )}

            <TableContainer sx={{ maxHeight: 500 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {previewData.length > 0 && Object.keys(previewData[0]).map(k => (
                      <TableCell key={k} sx={{ bgcolor: '#fafafa', fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{k}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewData.length > 0 ? (
                    previewData.map((row, i) => {
                      const colorConfig = SOURCE_COLORS[row.__source] || SOURCE_COLORS.default;
                      return (
                        <TableRow key={i} hover sx={{ bgcolor: colorConfig.bg, borderLeft: `4px solid ${colorConfig.border}`, '&:hover': { bgcolor: colorConfig.bg, filter: 'brightness(0.95)' } }}>
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j} sx={{ whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.8rem' }}>
                              {v !== null && v !== undefined ? String(v) : '—'}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} align="center" sx={{ py: 8, color: 'text.disabled' }}>
                        <LayersIcon sx={{ fontSize: 40, mb: 1, opacity: 0.5 }} /><br/>
                        No data generated yet. Click 'Preview' to test your join.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Registry Table */}
          <Box>
            <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ClockIcon fontSize="small" /> Saved Datasets
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#fafafa' }}>
                    <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Dataset Name</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>Table Name</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', width: '12%' }}>Rows</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '18%' }}>Created</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold', width: '5%' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {registry.length > 0 ? (
                    registry.map((item) => (
                      <TableRow key={item.id} hover>
                        <TableCell><Typography variant="body2" fontWeight="600">{item.display_name}</Typography></TableCell>
                        <TableCell><Chip label={item.type === 'unified' ? 'UNIFIED' : 'CUSTOM'} color={item.type === 'unified' ? 'success' : 'primary'} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} /></TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{item.table_name}</Typography></TableCell>
                        <TableCell align="right"><Typography variant="body2">{item.row_count.toLocaleString()}</Typography></TableCell>
                        <TableCell><Typography variant="caption" color="text.secondary">{item.created_at}</Typography></TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={0.5} justifyContent="center">
                            <Tooltip title="View Preview"><IconButton size="small" onClick={() => handleViewDataset(item.table_name)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title={buildInProgress ? "Cannot delete during build" : "Delete Dataset"}>
                              <span><IconButton size="small" color="error" onClick={() => handleDeleteDataset(item.id)} disabled={buildInProgress}><DeleteIcon fontSize="small" /></IconButton></span>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                        <DatabaseIcon sx={{ fontSize: 32, mb: 1, opacity: 0.5 }} /><br/>
                        No saved datasets yet. Create your first unified view.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

        </Box>
      </Box>

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Save Unified View</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="Dataset Name" type="text" fullWidth variant="outlined" value={saveDatasetName} onChange={(e) => setSaveDatasetName(e.target.value)} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button onClick={confirmSaveUnifiedView} variant="contained" disabled={loading}>Save</Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};

export default SmartMergeScreen;
