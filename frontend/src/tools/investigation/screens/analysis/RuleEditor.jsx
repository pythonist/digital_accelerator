import React, { useState, useEffect } from 'react';
import apiClient from "@services/api";

import {
  Dialog, DialogTitle, DialogContent,
  Button, IconButton, Stack, Typography, Box,
  TextField, Select, MenuItem, FormControl, InputLabel,
  ToggleButton, ToggleButtonGroup, Chip, CircularProgress,
  Alert, Paper, Collapse, Divider
} from '@mui/material';

import {
  Close as CloseIcon,
  Save as SaveIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Code as CodeIcon,
  Security as ShieldIcon,
  Visibility as EyeIcon,
  VisibilityOff as EyeOffIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';

const RuleEditor = ({ isOpen, onClose, onRulesSaved }) => {
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // UI State
  const [viewMode, setViewMode] = useState('visual'); // visual or json
  const [editingRule, setEditingRule] = useState(null); // 'new' or ruleId
  const [expandedRules, setExpandedRules] = useState({});
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    severity: 'Medium',
    category: 'General',
    enabled: true,
    logic: 'AND',
    conditions: []
  });

  useEffect(() => {
    if (isOpen) {
      loadRules();
    }
  }, [isOpen]);

  const loadRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/api/v2/rules');
      const rulesObj = {};
      
      if (Array.isArray(res.rules)) {
        res.rules.forEach(rule => { rulesObj[rule.id] = rule; });
      } else if (res.rules) {
        Object.assign(rulesObj, res.rules);
      } else {
         // Fallback if response structure differs
         Object.assign(rulesObj, res);
      }
      
      setRules(rulesObj);
      setJsonText(JSON.stringify(rulesObj, null, 2));
    } catch (err) {
      setError('Failed to load rules: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ✅ FIX: Synchronization when switching tabs
  const handleViewModeChange = (event, newMode) => {
    if (!newMode || newMode === viewMode) return;

    if (newMode === 'visual') {
      // Switching TO Visual: Validate JSON first
      try {
        const parsed = JSON.parse(jsonText);
        setRules(parsed);
        setJsonError(null);
        setViewMode('visual');
      } catch (e) {
        setJsonError("Invalid JSON. Fix errors before switching to Visual mode.");
      }
    } else {
      // Switching TO JSON: Serialize current object
      setJsonText(JSON.stringify(rules, null, 2));
      setJsonError(null);
      setViewMode('json');
    }
  };

  const saveRules = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setJsonError(null);
    
    try {
      let rulesToSave = rules;
      
      // If saving from JSON mode, ensure it parses
      if (viewMode === 'json') {
        try {
          rulesToSave = JSON.parse(jsonText);
        } catch (parseErr) {
          setJsonError('Cannot save: Invalid JSON syntax.');
          setSaving(false);
          return;
        }
      }

      // Simple validation
      for (const [ruleId, rule] of Object.entries(rulesToSave)) {
        if (!rule.name) throw new Error(`Rule ${ruleId} is missing a name`);
        if (!Array.isArray(rule.conditions)) throw new Error(`Rule ${ruleId} has invalid conditions`);
      }

      const res = await apiClient.post('/api/v2/rules/bulk-update', { 
        rules: rulesToSave 
      });
      
      if (res.success) {
        setSuccess('Rules saved successfully!');
        setRules(rulesToSave);
        setJsonText(JSON.stringify(rulesToSave, null, 2));
        if (onRulesSaved) onRulesSaved();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(res.error || 'Failed to save rules');
      }
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = (ruleId) => {
    if (!window.confirm(`Delete rule "${rules[ruleId].name}"?`)) return;
    
    const updatedRules = { ...rules };
    delete updatedRules[ruleId];
    
    setRules(updatedRules);
    setJsonText(JSON.stringify(updatedRules, null, 2));
  };

  const toggleRule = (ruleId) => {
    const updatedRules = {
      ...rules,
      [ruleId]: {
        ...rules[ruleId],
        enabled: !rules[ruleId].enabled
      }
    };
    setRules(updatedRules);
    setJsonText(JSON.stringify(updatedRules, null, 2));
  };

  const startEditRule = (ruleId) => {
    const rule = rules[ruleId];
    setFormData({
      id: ruleId,
      name: rule.name || '',
      description: rule.description || '',
      severity: rule.severity || 'Medium',
      category: rule.category || 'General',
      enabled: rule.enabled !== false, // Default to true if undefined
      logic: rule.logic || 'AND',
      conditions: rule.conditions ? [...rule.conditions] : []
    });
    setEditingRule(ruleId);
  };

  const startCreateRule = () => {
    setFormData({
      id: `RULE_${Object.keys(rules).length + 1}`,
      name: '',
      description: '',
      severity: 'Medium',
      category: 'General',
      enabled: true,
      logic: 'AND',
      conditions: []
    });
    setEditingRule('new');
  };

  const saveFormRule = () => {
    if (!formData.name.trim()) { alert('Rule name is required'); return; }
    if (!formData.id.trim()) { alert('Rule ID is required'); return; }
    
    // Validate Conditions
    if (formData.conditions.length === 0) { 
      // Optional: Allow saving without conditions but warn, or block. Blocking here.
      alert('At least one condition is required'); 
      return; 
    }

    const updatedRules = {
      ...rules,
      [formData.id]: {
        name: formData.name,
        description: formData.description,
        severity: formData.severity,
        category: formData.category,
        enabled: formData.enabled,
        logic: formData.logic,
        conditions: formData.conditions
      }
    };

    setRules(updatedRules);
    setJsonText(JSON.stringify(updatedRules, null, 2));
    setEditingRule(null);
  };

  // --- Condition Logic ---

  const addCondition = () => {
    setFormData({
      ...formData,
      conditions: [
        ...formData.conditions,
        { field: 'amount', operator: '>', value: 0 }
      ]
    });
  };

  const updateCondition = (index, field, value) => {
    const updated = [...formData.conditions];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, conditions: updated });
  };

  const removeCondition = (index) => {
    setFormData({
      ...formData,
      conditions: formData.conditions.filter((_, i) => i !== index)
    });
  };

  const getSeverityColor = (severity) => {
    const s = severity?.toLowerCase();
    if (s === 'critical') return 'error';
    if (s === 'high') return 'warning';
    if (s === 'medium') return 'info';
    return 'success';
  };

  // --- FORM RENDERER ---
  const renderRuleForm = () => (
    <Box sx={{ p: 2 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2}>
            <TextField
                label="Rule ID"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value.toUpperCase().replace(/\s/g, '_') })}
                disabled={editingRule !== 'new'}
                fullWidth
                size="small"
                helperText="Unique Identifier (e.g., HIGH_RISK_TXN)"
            />
            <TextField
                label="Rule Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                fullWidth
                size="small"
            />
        </Stack>
        
        <TextField
          label="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          fullWidth
          multiline
          rows={2}
          size="small"
        />
        
        <Stack direction="row" spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>Severity</InputLabel>
            <Select
              value={formData.severity}
              onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
              label="Severity"
            >
              <MenuItem value="Critical">Critical</MenuItem>
              <MenuItem value="High">High</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="Low">Low</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            fullWidth
            size="small"
          />
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ width: 150 }}>
            <InputLabel>Logic</InputLabel>
            <Select
              value={formData.logic}
              onChange={(e) => setFormData({ ...formData, logic: e.target.value })}
              label="Logic"
            >
              <MenuItem value="AND">AND (All)</MenuItem>
              <MenuItem value="OR">OR (Any)</MenuItem>
            </Select>
          </FormControl>
          
          <Button 
            variant={formData.enabled ? "outlined" : "contained"}
            color={formData.enabled ? "success" : "inherit"}
            onClick={() => setFormData({ ...formData, enabled: !formData.enabled })}
            startIcon={formData.enabled ? <EyeIcon /> : <EyeOffIcon />}
            sx={{ flex: 1 }}
          >
            {formData.enabled ? 'Rule Enabled' : 'Rule Disabled'}
          </Button>
        </Stack>

        <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 1, border: '1px solid #e0e0e0' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="subtitle2" fontWeight="bold">Conditions</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addCondition} variant="contained" disableElevation>
                Add Condition
            </Button>
          </Stack>
          <Stack spacing={1}>
            {formData.conditions.map((cond, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'white' }}>
                <FormControl size="small" sx={{ width: 140 }}>
                  <InputLabel>Field</InputLabel>
                  <Select label="Field" value={cond.field} onChange={(e) => updateCondition(idx, 'field', e.target.value)}>
                    {['amount', 'date', 'type', 'channel', 'party', 'country', 'status', 'risk_score'].map(f => (
                      <MenuItem key={f} value={f}>{f}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <FormControl size="small" sx={{ width: 120 }}>
                  <Select value={cond.operator} onChange={(e) => updateCondition(idx, 'operator', e.target.value)}>
                    {['>', '<', '>=', '<=', '==', '!=', 'contains', 'in'].map(op => (
                      <MenuItem key={op} value={op}>{op}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                {/* ✅ FIX: Robust Input Handling for Decimals/Strings */}
                <TextField 
                  size="small" 
                  fullWidth 
                  placeholder="Value"
                  value={cond.value}
                  onChange={(e) => {
                     const val = e.target.value;
                     // Heuristic: If it looks like a number and isn't a partial decimal input (e.g. "1."), cast it.
                     const num = Number(val);
                     if (!isNaN(num) && val.trim() !== '' && !val.endsWith('.')) {
                        updateCondition(idx, 'value', num);
                     } else {
                        updateCondition(idx, 'value', val);
                     }
                  }}
                />
                
                <IconButton size="small" color="error" onClick={() => removeCondition(idx)}>
                    <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
            {formData.conditions.length === 0 && (
                <Alert severity="warning" sx={{ py: 0 }}>At least one condition is needed.</Alert>
            )}
          </Stack>
        </Box>
      </Stack>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button onClick={() => setEditingRule(null)} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={saveFormRule} startIcon={<SaveIcon />} disabled={saving}>
            {saving ? 'Saving...' : 'Confirm Changes'}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f8fafc', borderBottom: 1, borderColor: 'divider', py: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SettingsIcon color="primary" />
          <Typography variant="h6" fontWeight="bold">Rule Configuration Manager</Typography>
        </Box>
        <IconButton onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={handleViewModeChange}
          size="small"
          disabled={!!editingRule}
        >
          <ToggleButton value="visual"><ShieldIcon fontSize="small" sx={{ mr: 1 }} /> Visual</ToggleButton>
          <ToggleButton value="json"><CodeIcon fontSize="small" sx={{ mr: 1 }} /> JSON</ToggleButton>
        </ToggleButtonGroup>

        <Stack direction="row" spacing={1}>
           {viewMode === 'visual' && !editingRule && (
             <Button variant="contained" color="success" size="small" startIcon={<AddIcon />} onClick={startCreateRule}>
                New Rule
             </Button>
           )}
           <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={loadRules} disabled={loading || !!editingRule}>
             Reload
           </Button>
           <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={saveRules} disabled={saving || !!editingRule}>
             Save All
           </Button>
        </Stack>
      </Box>

      {/* Messages */}
      {(error || success || jsonError) && (
        <Box sx={{ px: 3, pt: 2 }}>
           {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
           {jsonError && <Alert severity="error" onClose={() => setJsonError(null)}>{jsonError}</Alert>}
           {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
        </Box>
      )}

      <DialogContent sx={{ p: 0, height: 600, display: 'flex', flexDirection: 'column' }}>
        {editingRule ? (
          // Editing Form Overlay
          <Box sx={{ width: '100%', maxWidth: 800, mx: 'auto', mt: 2, pb: 4 }}>
             {renderRuleForm()}
          </Box>
        ) : (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                <CircularProgress />
              </Box>
            ) : viewMode === 'visual' ? (
              <Box sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
                <Stack spacing={2}>
                  {Object.keys(rules).length === 0 && (
                      <Box textAlign="center" py={5} color="text.secondary">
                          <Typography>No rules found. Create one or load defaults.</Typography>
                      </Box>
                  )}
                  {Object.entries(rules).map(([ruleId, rule]) => (
                    <Paper key={ruleId} variant="outlined">
                      <Box 
                        sx={{ p: 2, display: 'flex', alignItems: 'flex-start', cursor: 'pointer', bgcolor: expandedRules[ruleId] ? '#f8fafc' : 'white', transition: '0.2s' }}
                        onClick={() => setExpandedRules(prev => ({ ...prev, [ruleId]: !prev[ruleId] }))}
                      >
                         <Box sx={{ mr: 1, mt: 0.5, color: 'text.secondary' }}>
                             {expandedRules[ruleId] ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                         </Box>

                         <Box sx={{ flex: 1 }}>
                           <Stack direction="row" spacing={1} alignItems="center" mb={1} flexWrap="wrap" gap={0.5}>
                             <Typography variant="subtitle1" fontWeight="bold">{rule.name}</Typography>
                             <Chip label={rule.severity} color={getSeverityColor(rule.severity)} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                             <Chip label={rule.category} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                             <Chip 
                               label={rule.enabled ? 'ACTIVE' : 'INACTIVE'} 
                               size="small" 
                               color={rule.enabled ? 'success' : 'default'} 
                               variant={rule.enabled ? 'filled' : 'outlined'} 
                               onClick={(e) => { e.stopPropagation(); toggleRule(ruleId); }}
                               sx={{ height: 20, fontSize: '0.7rem', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
                             />
                           </Stack>
                           <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.8 }}>{rule.description}</Typography>
                         </Box>
                         
                         <Stack direction="row" spacing={1}>
                           <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); startEditRule(ruleId); }}>
                               <EditIcon fontSize="small" />
                           </IconButton>
                           <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteRule(ruleId); }}>
                               <DeleteIcon fontSize="small" />
                           </IconButton>
                         </Stack>
                      </Box>
                      
                      <Collapse in={expandedRules[ruleId]}>
                        <Divider />
                        <Box sx={{ p: 2, bgcolor: '#f1f5f9' }}>
                           <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                                <Typography variant="caption" fontWeight="bold" color="text.secondary">LOGIC: </Typography>
                                <Chip label={rule.logic} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
                           </Stack>
                           {rule.conditions?.map((c, i) => (
                             <Typography key={i} variant="body2" fontFamily="monospace" sx={{ ml: 0, mt: 0.5, display: 'flex', alignItems: 'center' }}>
                               <Box component="span" sx={{ color: 'primary.main', minWidth: 80 }}>{c.field}</Box> 
                               <Box component="span" sx={{ fontWeight: 'bold', px: 1 }}>{c.operator}</Box> 
                               <Box component="span" sx={{ color: 'success.dark' }}>{JSON.stringify(c.value)}</Box>
                             </Typography>
                           ))}
                        </Box>
                      </Collapse>
                    </Paper>
                  ))}
                </Stack>
              </Box>
            ) : (
              <Box sx={{ p: 0, flex: 1, display: 'flex', flexDirection: 'column', bgcolor: '#1e1e1e' }}>
                <textarea 
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  style={{ 
                      width: '100%', 
                      height: '100%', 
                      padding: '16px', 
                      fontFamily: '"Fira Code", monospace', 
                      fontSize: '14px',
                      border: 'none', 
                      resize: 'none', 
                      backgroundColor: 'transparent', 
                      color: '#e0e0e0',
                      outline: 'none',
                      lineHeight: 1.5
                  }}
                  spellCheck="false"
                />
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RuleEditor;