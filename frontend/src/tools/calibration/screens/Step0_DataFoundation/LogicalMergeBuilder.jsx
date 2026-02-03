// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/LogicalMergeBuilder.jsx
// ============================================================================
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, IconButton, 
  Select, MenuItem, FormControl, InputLabel, Stack, Chip, 
  Alert, CircularProgress, Grid, Paper, Divider,
  Drawer, List, ListItem, ListItemText, Dialog, DialogTitle, 
  DialogContent, DialogActions, TextField
} from '@mui/material';
import {
  AddCircleOutline, Delete, Save, 
  TableChart, Visibility, ArrowForward, CallMerge, 
  History, Restore, Add
} from '@mui/icons-material';
import apiClient from '@services/api';

import { MotionContainer, MotionItem } from "@components/MotionWrappers/MotionWrappers";
import { PageTransition } from "@components/MotionWrappers/MotionWrappers";

// --- VISUALIZATION COMPONENT ---
const JoinVisualizer = ({ joinType, leftTable, rightTable }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px dashed #cbd5e1', height: '100%', justifyContent: 'center' }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary">VISUALIZATION</Typography>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 1 }}>
        <Chip label={leftTable || 'Previous'} size="small" variant="outlined" sx={{ maxWidth: 100 }} />
        <ArrowForward fontSize="small" color="action" />
        <Chip label={joinType || 'Join'} color="primary" size="small" />
        <ArrowForward fontSize="small" color="action" />
        <Chip label={rightTable || 'New'} size="small" variant="outlined" sx={{ maxWidth: 100 }} />
      </Stack>
    </Box>
  );
};

const LogicalMergeBuilder = ({ envId, onComplete }) => {
  // --- STATE ---
  const [datasets, setDatasets] = useState([]);
  const [schemas, setSchemas] = useState({}); 
  const [chain, setChain] = useState([]); 
  
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  
  // Template State
  const [savedPlans, setSavedPlans] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  
  // Save Dialog State
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [planName, setPlanName] = useState('Calibration Logic');

  // --- INITIALIZATION ---
  useEffect(() => {
    loadDatasets();
    loadSavedPlans();
  }, [envId]);

  // --- API CALLS ---
  const loadDatasets = async () => {
    try {
      const res = await apiClient.get('/api/v2/calibration/data/datasets', { params: { env_id: envId } });
      if (res.success) setDatasets(res.datasets || []);
    } catch (err) { console.error(err); }
  };

  const loadSavedPlans = async () => {
    try {
      const res = await apiClient.get('/api/v2/calibration/data/merge/plans', { params: { env_id: envId } });
      if (res.success) setSavedPlans(res.plans || []);
    } catch (err) { console.error("Failed to load plans", err); }
  };

  const getColumns = async (datasetId) => {
    if (schemas[datasetId]) return schemas[datasetId];
    try {
      const response = await apiClient.get(`/api/v2/calibration/data/schema/${datasetId}`, { params: { env_id: envId } });
      if (response.success) {
        setSchemas(prev => ({ ...prev, [datasetId]: response.columns }));
        return response.columns;
      }
    } catch (e) { console.error(e); }
    return [];
  };

  // --- TEMPLATE ACTIONS ---
  const handleRestorePlan = async (plan) => {
    if (!window.confirm(`Load template "${plan.plan_name}"? Current unsaved changes will be lost.`)) return;
    
    setLoadingPlan(true);
    try {
      setChain(plan.chain);
      setIsHistoryOpen(false);
      // Pre-load schemas for all datasets in the restored chain
      for (const step of plan.chain) {
        if (step.dataset_id) await getColumns(step.dataset_id);
      }
    } catch (e) {
      alert('Failed to load template: ' + e.message);
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleDeletePlan = async (planId) => {
    if (!window.confirm("Delete this saved template?")) return;
    try {
      await apiClient.delete(`/api/v2/calibration/data/merge/plan/${planId}`, { params: { env_id: envId } });
      loadSavedPlans();
    } catch (e) { alert(e.message); }
  };

  // --- BUILDER LOGIC ---
  const getAvailableDatasets = () => datasets;

  const handleSetBase = async (id) => {
    await getColumns(id);
    setChain([{ id: Date.now(), type: 'BASE', dataset_id: id, alias: 't0' }]);
    setPreviewData(null);
  };

  const handleAddJoin = () => {
    setChain(prev => [...prev, { id: Date.now(), type: 'JOIN', join_type: 'LEFT JOIN', dataset_id: '', left_on: '', right_on: '', alias: `t${prev.length}` }]);
  };

  const updateStep = async (index, field, value) => {
    const newChain = [...chain];
    newChain[index][field] = value;
    if (field === 'dataset_id' && value) {
      await getColumns(value);
      newChain[index].right_on = ''; 
    }
    setChain(newChain);
  };

  const removeStep = (index) => {
    const newChain = chain.filter((_, i) => i !== index);
    const reIndexed = newChain.map((step, i) => ({ ...step, alias: `t${i}` }));
    setChain(reIndexed);
  };

  const getLeftOptions = (currentIndex) => {
    let options = [];
    for (let i = 0; i < currentIndex; i++) {
      const step = chain[i];
      if (!step.dataset_id) continue;
      const cols = schemas[step.dataset_id] || [];
      const dsName = datasets.find(d => d.id === step.dataset_id)?.name || step.alias;
      options = [...options, ...cols.map(c => ({ value: `${step.alias}.${c.name}`, label: `${dsName}.${c.name}`, type: c.type }))];
    }
    return options;
  };

  // --- PREVIEW & SAVE ---
  const handlePreview = async () => {
    if (chain.length === 0) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const response = await apiClient.post('/api/v2/calibration/data/merge/preview', { env_id: envId, chain: chain });
      if (response.success) setPreviewData(response.preview);
      else setError(response.error);
    } catch (err) { setError(err.message); } 
    finally { setPreviewLoading(false); }
  };

  const handleOpenSaveDialog = () => {
    setSaveDialogOpen(true);
  };

  const handleSave = async () => {
    if (chain.length === 0) return;
    if (!planName.trim()) {
      setError('Please enter a plan name');
      return;
    }

    setSaving(true);
    setSaveDialogOpen(false);
    
    try {
      const response = await apiClient.post('/api/v2/calibration/data/merge/save', {
        env_id: envId,
        chain: chain,
        name: planName,
        create_view: true 
      });
      
      if (response.success) {
        await loadSavedPlans();
        if (onComplete) onComplete();
      } else {
        setError(response.error || "Save failed.");
      }
    } catch (err) { setError(err.message); } 
    finally { setSaving(false); }
  };

  // --- RENDER HELPERS ---
  const renderPlanDescription = (planChain) => {
    if (!planChain || planChain.length === 0) return "Empty Plan";
    const base = datasets.find(d => d.id === planChain[0].dataset_id)?.name || "Unknown";
    const joins = planChain.slice(1).map(step => {
      const dsName = datasets.find(d => d.id === step.dataset_id)?.name || "Unknown";
      return ` + ${dsName}`;
    });
    return (
      <Box>
        <Typography variant="body2" fontWeight={500}>{base}</Typography>
        {joins.map((j, i) => (
          <Typography key={i} variant="caption" display="block" color="text.secondary" sx={{ ml: 1 }}>
            {j}
          </Typography>
        ))}
      </Box>
    );
  };

  // 1. EMPTY STATE
  if (chain.length === 0) {
    return (
      <PageTransition>
        <Box sx={{ maxWidth: 1400, mx: 'auto', p: 2 }}>
          <MotionContainer>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
               <Alert severity="info" variant="outlined" sx={{ flex: 1, mr: 2 }}>
                 <Typography variant="subtitle2" fontWeight={600}>Start Building</Typography>
                 <Typography variant="body2">Select a base dataset below, or load a previous template.</Typography>
               </Alert>
               <Button startIcon={<History />} onClick={() => setIsHistoryOpen(true)} variant="outlined">
                 Load Template
               </Button>
            </Box>
            
            <Grid container spacing={2}>
              {datasets.map(ds => (
                <Grid item xs={12} sm={6} md={4} key={ds.id}>
                  <MotionItem>
                    <Card 
                      sx={{ 
                        cursor: 'pointer', border: '1px solid #e2e8f0',
                        '&:hover': { borderColor: '#D04A02', boxShadow: 3, transform: 'translateY(-2px)' },
                        transition: 'all 0.2s'
                      }} 
                      onClick={() => handleSetBase(ds.id)}
                    >
                      <CardContent>
                        <Stack direction="row" spacing={2} alignItems="center">
                          <TableChart sx={{ color: '#D04A02' }} />
                          <Box>
                            <Typography variant="subtitle2" fontWeight={600}>{ds.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{ds.row_count?.toLocaleString()} rows</Typography>
                          </Box>
                        </Stack>
                      </CardContent>
                    </Card>
                  </MotionItem>
                </Grid>
              ))}
            </Grid>
          </MotionContainer>

          <Drawer anchor="right" open={isHistoryOpen} onClose={() => setIsHistoryOpen(false)}>
            <Box sx={{ width: 350, p: 2 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Saved Templates</Typography>
              <Divider sx={{ mb: 2 }} />
              {savedPlans.length === 0 && <Typography variant="body2" color="text.secondary">No saved templates.</Typography>}
              <List>
                {savedPlans.map(plan => (
                  <Paper key={plan.plan_id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                    <ListItem alignItems="flex-start">
                      <ListItemText 
                        primary={plan.plan_name} 
                        secondary={renderPlanDescription(plan.chain)}
                        primaryTypographyProps={{ fontWeight: 600, color: '#D04A02' }}
                      />
                    </ListItem>
                    <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ bgcolor: '#f8fafc', p: 1, borderTop: '1px solid #e2e8f0' }}>
                      <Button size="small" color="error" onClick={() => handleDeletePlan(plan.plan_id)}>Delete</Button>
                      <Button size="small" variant="contained" startIcon={<Restore />} onClick={() => handleRestorePlan(plan)} sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23D01' } }}>Load</Button>
                    </Stack>
                  </Paper>
                ))}
              </List>
            </Box>
          </Drawer>
        </Box>
      </PageTransition>
    );
  }

  // 2. MAIN BUILDER WITH FIXED SCROLLABLE PREVIEW
  return (
    <PageTransition>
      <Box sx={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h6" fontWeight={600}>Configure Join</Typography>
            <Button startIcon={<History />} size="small" onClick={() => setIsHistoryOpen(true)} variant="outlined">Templates</Button>
            
            {previewData?.metrics && (
              <Chip 
                label={`Result: ${previewData.metrics.output_cols} Cols (+${previewData.metrics.added_cols})`} 
                size="small" 
                color="success" 
                variant="outlined" 
              />
            )}
          </Stack>

          <Stack direction="row" spacing={2}>
            <Button 
              variant="outlined" 
              startIcon={previewLoading ? <CircularProgress size={16} /> : <Visibility />} 
              onClick={handlePreview} 
              disabled={previewLoading}
            >
              Preview
            </Button>
            <Button 
              variant="contained" 
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />} 
              onClick={handleOpenSaveDialog} 
              disabled={saving} 
              sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23D01' }, fontWeight: 600 }}
            >
              {saving ? 'Processing...' : 'Save & Continue'}
            </Button>
          </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* Chain Builder - Scrollable */}
        <Box sx={{ flex: '0 0 auto', overflowY: 'auto', mb: 2, maxHeight: '40vh', pr: 1 }}>
          <MotionContainer>
            {chain.map((step, index) => {
              const ds = datasets.find(d => d.id === step.dataset_id);
              const rightCols = schemas[step.dataset_id] || [];
              
              return (
                <MotionItem key={step.id}>
                  <Box sx={{ mb: 3, position: 'relative' }}>
                    {index > 0 && <Box sx={{ height: 24, borderLeft: '2px dashed #cbd5e1', ml: 4, my: -1 }} />}
                    <Paper sx={{ p: 0, border: '1px solid #e2e8f0', borderLeft: index === 0 ? '4px solid #D04A02' : '4px solid #64748b', overflow: 'hidden' }}>
                      
                      {/* Step Header */}
                      <Box sx={{ bgcolor: '#f8fafc', px: 2, py: 1, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Chip label={index === 0 ? "BASE" : step.join_type} color={index === 0 ? "primary" : "default"} size="small" sx={{ fontWeight: 600 }} />
                            <Typography variant="subtitle2" fontWeight={600}>{ds ? ds.name : "Select Dataset..."}</Typography>
                        </Stack>
                        {index > 0 && <IconButton size="small" color="error" onClick={() => removeStep(index)}><Delete fontSize="small" /></IconButton>}
                      </Box>

                      {/* Step Content */}
                      {index > 0 && (
                        <Grid container>
                          <Grid item xs={12} md={8} sx={{ p: 2 }}>
                            <Stack spacing={2}>
                                {/* Row 1: Join Type & Dataset */}
                                <Stack direction="row" spacing={2}>
                                  <FormControl fullWidth size="small">
                                    <InputLabel>Join Type</InputLabel>
                                    <Select value={step.join_type} label="Join Type" onChange={(e) => updateStep(index, 'join_type', e.target.value)}>
                                      <MenuItem value="LEFT JOIN">Left Join</MenuItem>
                                      <MenuItem value="INNER JOIN">Inner Join</MenuItem>
                                      <MenuItem value="RIGHT JOIN">Right Join</MenuItem>
                                      <MenuItem value="FULL OUTER JOIN">Full Outer Join</MenuItem>
                                    </Select>
                                  </FormControl>
                                  <FormControl fullWidth size="small">
                                    <InputLabel>Join With Table</InputLabel>
                                    <Select value={step.dataset_id} label="Join With Table" onChange={(e) => updateStep(index, 'dataset_id', e.target.value)}>
                                      {getAvailableDatasets().map(d => (
                                        <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Stack>
                                
                                {/* Row 2: Keys */}
                                <Stack direction="row" spacing={2} alignItems="center" sx={{ bgcolor: '#fff7ed', p: 1.5, borderRadius: 1, border: '1px solid #ffedd5' }}>
                                  <CallMerge fontSize="small" sx={{ color: '#D04A02' }} />
                                  <FormControl fullWidth size="small">
                                    <Select displayEmpty value={step.left_on} onChange={(e) => updateStep(index, 'left_on', e.target.value)} renderValue={(selected) => selected || <em>Left Column</em>}>
                                      {getLeftOptions(index).map(opt => (<MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>))}
                                    </Select>
                                  </FormControl>
                                  <Typography fontWeight={700}>=</Typography>
                                  <FormControl fullWidth size="small">
                                    <Select displayEmpty value={step.right_on} onChange={(e) => updateStep(index, 'right_on', e.target.value)} disabled={!step.dataset_id} renderValue={(selected) => selected || <em>Right Column</em>}>
                                      {rightCols.map(c => (<MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>))}
                                    </Select>
                                  </FormControl>
                                </Stack>
                            </Stack>
                          </Grid>
                          
                          {/* Visualizer Panel */}
                          <Grid item xs={12} md={4} sx={{ borderLeft: '1px solid #e2e8f0', p: 2 }}>
                            <JoinVisualizer joinType={step.join_type} leftTable="Result" rightTable={ds ? ds.name : "?"} />
                          </Grid>
                        </Grid>
                      )}
                    </Paper>
                  </Box>
                </MotionItem>
              );
            })}
          </MotionContainer>
          <Button startIcon={<AddCircleOutline />} onClick={handleAddJoin} variant="outlined" fullWidth sx={{ borderStyle: 'dashed', py: 1.5 }}>Add Join Step</Button>
        </Box>

        {previewData?.warnings && previewData.warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={600}>Potential Data Issue Detected:</Typography>
            {previewData.warnings.map((w, i) => (
              <Typography key={i} variant="body2">{w.message}</Typography>
            ))}
          </Alert>
        )}

        {/* 3. PREVIEW TABLE - FIXED SCROLLABLE LAYOUT */}
        {previewData && (
          <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 2 }}>
            <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
               <Typography variant="caption" fontWeight={600} color="text.secondary">
                 PREVIEW ({previewData.rows?.length} rows)
               </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: '100%', width: 'max-content' }}>
                <thead>
                  <tr>{previewData.columns.map((c, idx) => (
                    <th key={`${c}-${idx}`} style={{ 
                      textAlign: 'left', padding: '12px 16px', 
                      borderBottom: '2px solid #e2e8f0', backgroundColor: '#f1f5f9', 
                      whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 10,
                      fontWeight: 600, color: '#475569'
                    }}>
                      {c}
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {previewData.rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      {previewData.columns.map((c, idx) => (
                        <td key={`${c}-${idx}`} style={{ padding: '8px 16px', whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: '#334155' }}>
                          {r[c] !== null ? String(r[c]) : <span style={{color: '#cbd5e1'}}>null</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Paper>
        )}

        {/* Save Dialog */}
        <Dialog 
          open={saveDialogOpen} 
          onClose={() => setSaveDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Save Join Plan</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Plan Name"
              fullWidth
              variant="outlined"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              sx={{ mt: 2 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              This name will be used to identify your join configuration.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleSave} 
              variant="contained"
              sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23D01' } }}
            >
              Save & Continue
            </Button>
          </DialogActions>
        </Dialog>

        {/* Drawer for History (in Main View) */}
        <Drawer anchor="right" open={isHistoryOpen} onClose={() => setIsHistoryOpen(false)}>
            <Box sx={{ width: 350, p: 2 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>Saved Templates</Typography>
              <Divider sx={{ mb: 2 }} />
              {savedPlans.length === 0 && <Typography variant="body2" color="text.secondary">No saved templates.</Typography>}
              <List>
                {savedPlans.map(plan => (
                  <Paper key={plan.plan_id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                    <ListItem alignItems="flex-start">
                      <ListItemText 
                        primary={plan.plan_name}
                        secondary={renderPlanDescription(plan.chain)}
                        primaryTypographyProps={{ fontWeight: 600, color: '#D04A02' }}
                      />
                    </ListItem>
                    <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ bgcolor: '#f8fafc', p: 1, borderTop: '1px solid #e2e8f0' }}>
                      <Button size="small" color="error" onClick={() => handleDeletePlan(plan.plan_id)}>Delete</Button>
                      <Button size="small" variant="contained" startIcon={<Restore />} onClick={() => handleRestorePlan(plan)} sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23D01' } }}>Load</Button>
                    </Stack>
                  </Paper>
                ))}
              </List>
            </Box>
        </Drawer>

      </Box>
    </PageTransition>
  );
};

export default LogicalMergeBuilder;