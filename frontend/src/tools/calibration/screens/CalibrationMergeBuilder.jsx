import React, { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, Card, CardContent, CardHeader,
  IconButton, Select, MenuItem, Grid, Alert, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, Chip, Stack, Divider, Tooltip, Container
} from '@mui/material';
import {
  AddCircleOutline, Delete, Visibility, Build, ArrowForward,
  Storage, Link as LinkIcon, CheckCircle, Warning
} from '@mui/icons-material';
import { useAppContext } from '@context/AppContext'; // Assuming you have this
import apiClient from '@services/api'; // Use your API client

const CalibrationMergeBuilder = () => {
  const { activeEnv } = useAppContext(); // Get dynamic env_id
  
  // State
  const [tables, setTables] = useState([]);
  const [chain, setChain] = useState([]);
  const [tableColumns, setTableColumns] = useState({});
  const [previewData, setPreviewData] = useState([]);
  const [stats, setStats] = useState({ transactions: 0, accounts: 0, customers: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [buildResult, setBuildResult] = useState(null);

  // Initial Load
  useEffect(() => {
    if (activeEnv) {
      loadTables();
      loadStats();
    }
  }, [activeEnv]);

  // --- API CALLS ---

  const loadTables = async () => {
    try {
      // NOTE: Your backend must have GET /api/v2/calibration/data/tables
      const res = await apiClient.get('/api/v2/calibration/data/tables', { params: { env_id: activeEnv } });
      if (res.success) setTables(res.tables || []);
    } catch (e) {
      console.error('Failed to load tables:', e);
      // Fallback for demo if API missing
      setTables(['transactions', 'accounts', 'customers']);
    }
  };

  const loadStats = async () => {
    try {
      const res = await apiClient.get('/api/v2/calibration/data/stats', { params: { env_id: activeEnv } });
      if (res.success) setStats(res.stats || {});
    } catch (e) { console.error('Failed to load stats:', e); }
  };

  const loadTableColumns = async (tableName) => {
    if (tableColumns[tableName]) return;
    try {
      // NOTE: Your backend must have GET /api/v2/calibration/data/columns
      const res = await apiClient.get('/api/v2/calibration/data/columns', { 
        params: { env_id: activeEnv, table: tableName } 
      });
      if (res.success) {
        setTableColumns(prev => ({ ...prev, [tableName]: data.columns }));
      }
    } catch (e) {
      console.error(`Failed to load columns for ${tableName}`, e);
      // Fallback mocks
      const mocks = {
        transactions: ['transaction_id', 'account_id', 'amount', 'date'],
        accounts: ['account_id', 'customer_id', 'type'],
        customers: ['customer_id', 'name', 'risk']
      };
      setTableColumns(prev => ({ ...prev, [tableName]: mocks[tableName] || [] }));
    }
  };

  // --- HANDLERS ---

  const handleAddTable = async (tableName) => {
    if(!tableName) return;
    await loadTableColumns(tableName);
    
    if (chain.length === 0) {
      setChain([{ table: tableName, id: Date.now() }]);
    } else {
      setChain(prev => [...prev, {
        table: tableName,
        id: Date.now(),
        joinType: 'LEFT JOIN',
        leftKey: '',
        rightKey: ''
      }]);
    }
  };

  const removeTable = (index) => {
    setChain(prev => prev.filter((_, i) => i !== index));
  };

  const updateJoin = (index, field, value) => {
    setChain(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const getCumulativeColumns = (upToIndex) => {
    const cols = [];
    for (let i = 0; i <= upToIndex - 1; i++) {
      const tableName = chain[i].table;
      const tCols = tableColumns[tableName] || [];
      tCols.forEach(col => {
        cols.push({ table: tableName, column: col, display: `${tableName}.${col}` });
      });
    }
    return cols;
  };

  const isChainValid = () => {
    if (chain.length === 0) return false;
    for (let i = 1; i < chain.length; i++) {
      if (!chain[i].leftKey || !chain[i].rightKey) return false;
    }
    return true;
  };

  const handlePreview = async () => {
    setLoading(true); setError(''); setPreviewData([]);
    try {
      const res = await apiClient.post('/api/v2/calibration/data/preview-merge', {
        env_id: activeEnv,
        chain
      });
      if (res.success) {
        setPreviewData(res.preview || []);
        setSuccess(`Preview generated with ${res.preview?.length || 0} rows`);
      } else throw new Error(res.error);
    } catch (e) { setError(e.message || 'Preview failed (Check Backend)'); }
    finally { setLoading(false); }
  };

  const handleBuildGolden = async () => {
    if (!window.confirm('Build Golden Dataset?')) return;
    setLoading(true); setError(''); setBuildResult(null);
    try {
      const res = await apiClient.post('/api/v2/calibration/data/build-golden', {
        env_id: activeEnv,
        chain // NOTE: Standard backend expects 'mapping' not 'chain'
      });
      if (res.success) {
        setBuildResult(res.result);
        setSuccess(`Built: ${res.result.row_count.toLocaleString()} rows`);
        loadStats();
      } else throw new Error(res.error);
    } catch (e) { setError(e.message || 'Build failed'); }
    finally { setLoading(false); }
  };

  // --- RENDER ---

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Paper elevation={0} sx={{ p: 3, mb: 3, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h4" fontWeight="bold">Golden Dataset Builder</Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>Visually merge tables to create the master dataset</Typography>
          </Box>
          <Storage fontSize="large" sx={{ opacity: 0.8 }} />
        </Stack>
      </Paper>

      {/* Alerts */}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Stats Bar */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {Object.entries(stats).map(([key, val]) => (
          <Grid item xs={12} sm={4} key={key}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="caption" color="text.secondary" textTransform="uppercase">{key}</Typography>
                <Typography variant="h5" fontWeight="bold">{val?.toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Builder Area */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3, bgcolor: '#f8f9fa' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h6" fontWeight="bold">Data Flow Chain</Typography>
          <Stack direction="row" spacing={2}>
            <Button 
              variant="outlined" 
              startIcon={<Visibility />} 
              onClick={handlePreview}
              disabled={!isChainValid() || loading}
            >
              Preview
            </Button>
            <Button 
              variant="contained" 
              startIcon={loading ? <LinearProgress sx={{ width: 20 }} /> : <Build />} 
              onClick={handleBuildGolden}
              disabled={!isChainValid() || loading}
            >
              Build Dataset
            </Button>
          </Stack>
        </Stack>

        <Box sx={{ display: 'flex', overflowX: 'auto', pb: 2, gap: 2, alignItems: 'flex-start' }}>
          {/* Empty State */}
          {chain.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center', width: '100%', border: '2px dashed #ccc', borderRadius: 2 }}>
              <Typography color="text.secondary" gutterBottom>Start by adding a base table</Typography>
              <FormControl sx={{ minWidth: 200 }}>
                <InputLabel>Select Base Table</InputLabel>
                <Select
                  value=""
                  label="Select Base Table"
                  onChange={(e) => handleAddTable(e.target.value)}
                >
                  {tables.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
          )}

          {/* Chain Steps */}
          {chain.map((step, idx) => (
            <React.Fragment key={step.id}>
              {idx > 0 && (
                <Box sx={{ pt: 8, color: 'text.secondary' }}>
                  <ArrowForward fontSize="large" />
                </Box>
              )}

              <Card sx={{ 
                minWidth: 280, 
                maxWidth: 320,
                borderTop: `4px solid ${idx === 0 ? '#1976d2' : '#ed6c02'}` 
              }}>
                <CardHeader
                  title={
                    <Typography variant="subtitle2" fontWeight="bold" color={idx === 0 ? 'primary' : 'warning.main'}>
                      {idx === 0 ? 'BASE TABLE' : `JOIN #${idx}`}
                    </Typography>
                  }
                  action={idx > 0 && (
                    <IconButton size="small" color="error" onClick={() => removeTable(idx)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                  sx={{ bgcolor: idx === 0 ? 'primary.50' : 'warning.50', py: 1 }}
                />
                <CardContent>
                  <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Storage fontSize="small" color="action" />
                    <Typography fontWeight="bold">{step.table}</Typography>
                    <Chip label={`${tableColumns[step.table]?.length || 0} cols`} size="small" />
                  </Box>

                  {idx > 0 && (
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Join Type</InputLabel>
                        <Select
                          value={step.joinType}
                          label="Join Type"
                          onChange={(e) => updateJoin(idx, 'joinType', e.target.value)}
                        >
                          <MenuItem value="LEFT JOIN">Left Join</MenuItem>
                          <MenuItem value="INNER JOIN">Inner Join</MenuItem>
                        </Select>
                      </FormControl>

                      <Divider><LinkIcon fontSize="small" sx={{ color: 'text.disabled' }} /></Divider>

                      <FormControl fullWidth size="small">
                        <InputLabel>Left Key (Previous)</InputLabel>
                        <Select
                          value={step.leftKey}
                          label="Left Key (Previous)"
                          onChange={(e) => updateJoin(idx, 'leftKey', e.target.value)}
                        >
                          {getCumulativeColumns(idx).map(c => (
                            <MenuItem key={c.display} value={c.display}>{c.display}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>Right Key ({step.table})</InputLabel>
                        <Select
                          value={step.rightKey}
                          label={`Right Key (${step.table})`}
                          onChange={(e) => updateJoin(idx, 'rightKey', e.target.value)}
                        >
                          {(tableColumns[step.table] || []).map(c => (
                            <MenuItem key={c} value={c}>{c}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </React.Fragment>
          ))}

          {/* Add Button */}
          {chain.length > 0 && (
             <Box sx={{ pt: 8 }}>
               <FormControl size="small" sx={{ minWidth: 150 }}>
                 <InputLabel>Add Table</InputLabel>
                 <Select
                   value=""
                   label="Add Table"
                   onChange={(e) => handleAddTable(e.target.value)}
                 >
                    {tables.filter(t => !chain.find(c => c.table === t)).map(t => (
                      <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                 </Select>
               </FormControl>
             </Box>
          )}
        </Box>
      </Paper>

      {/* Build Result */}
      {buildResult && (
        <Alert severity="success" icon={<CheckCircle fontSize="inherit" />} sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold">Build Complete!</Typography>
          Created dataset with {buildResult.row_count?.toLocaleString()} rows.
        </Alert>
      )}

      {/* Preview Table */}
      {previewData.length > 0 && (
        <Paper variant="outlined">
          <Box sx={{ p: 2, bgcolor: 'grey.100', borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">Preview Results ({previewData.length} rows)</Typography>
          </Box>
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {Object.keys(previewData[0]).map(key => (
                    <TableCell key={key} sx={{ bgcolor: 'grey.50', fontWeight: 'bold' }}>{key}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {previewData.map((row, i) => (
                  <TableRow key={i} hover>
                    {Object.values(row).map((val, j) => (
                      <TableCell key={j}>{val}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Container>
  );
};

export default CalibrationMergeBuilder;