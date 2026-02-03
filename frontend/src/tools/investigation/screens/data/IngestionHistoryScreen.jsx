// src/tools/investigation/screens/data/IngestionHistoryScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from "@services/api";
import PageContainer from "@investigation-layout/PageContainer"; 

// MUI Imports
import {
  Box, Paper, Typography, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Grid, Stack, Tabs, Tab,
  CircularProgress, useTheme
} from '@mui/material';

// MUI Icons
import {
  ArrowBack as ArrowBackIcon, Refresh as RefreshIcon, Storage as DatabaseIcon,
  CloudUpload as UploadIcon, CheckCircle as CheckCircleIcon, Cancel as ErrorIcon,
  AccessTime as ClockIcon, History as HistoryIcon, Description as FileIcon
} from '@mui/icons-material';

const IngestionHistoryScreen = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  
  // --- State ---
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  // --- Theme ---
  const colors = {
    primary: '#ea580c',
    secondary: '#2d2d2d',
    bg: '#f2f2f2',
    surface: '#ffffff',
    textMain: '#1a1a1a',
    textMuted: '#5e5e5e',
    border: '#e0e0e0',
    successBg: '#ecfdf5',
    successText: '#047857',
    errorBg: '#fef2f2',
    errorText: '#b91c1c'
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    await loadHistory();
    setLoading(false);
  };

  const loadHistory = async () => {
    try {
      // ✅ CALLING REAL ENDPOINT
      const res = await apiClient.get('/api/v2/ingestion/history');
      
      const historyItems = res.history || [];
      setHistory(historyItems);
      
      // ✅ CALCULATE REAL STATS ON THE FLY
      calculateStats(historyItems);

    } catch (err) { 
        console.error('Failed to load history:', err); 
    }
  };

  const calculateStats = (items) => {
      const uniqueEntities = new Set(items.map(i => i.entity_type));
      const successCount = items.filter(i => i.status === 'success').length;
      const connectorCount = items.filter(i => i.type === 'sql').length;

      setStats({
          total_connectors: connectorCount, // or total distinct sources
          success_count: successCount,
          entity_count: uniqueEntities.size,
          last_run: items.length > 0 ? items[0].timestamp : null
      });
  };

  const handleTabChange = (event, newValue) => setActiveTab(newValue);

  const getFilteredHistory = () => {
    if (activeTab === 0) return history;
    if (activeTab === 1) return history.filter(h => h.type === 'csv');
    if (activeTab === 2) return history.filter(h => h.type === 'sql');
    return history;
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Unknown';
    try {
        return new Date(isoString).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
        });
    } catch(e) { return isoString; }
  };

  const filteredHistory = getFilteredHistory();

  return (
    <PageContainer 
      title="Ingestion Audit Trail" 
      subtitle="Comprehensive log of all data loading operations and connector executions"
      breadcrumbs={['Data Management', 'History']}
      actions={
        <Button 
          variant="outlined" 
          size="small"
          startIcon={<RefreshIcon />} 
          onClick={loadData}
          sx={{ fontWeight: 600, borderColor: colors.border, color: colors.textMain }}
        >
          Refresh Log
        </Button>
      }
    >
      <Box sx={{ pb: 4 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>

          {/* --- STATS OVERVIEW --- */}
          {stats && (
            <Grid container spacing={3} sx={{ mb: 4 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2.5, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fff7ed', color: colors.primary }}>
                    <DatabaseIcon />
                  </Box>
                  <Box>
                    <Typography variant="h5" fontWeight={700} color={colors.textMain}>{stats.total_connectors}</Typography>
                    <Typography variant="caption" color={colors.textMuted} fontWeight={600} textTransform="uppercase">SQL Runs</Typography>
                  </Box>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2.5, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: colors.successBg, color: colors.successText }}>
                    <CheckCircleIcon />
                  </Box>
                  <Box>
                    <Typography variant="h5" fontWeight={700} color={colors.textMain}>{stats.success_count}</Typography>
                    <Typography variant="caption" color={colors.textMuted} fontWeight={600} textTransform="uppercase">Successful Ops</Typography>
                  </Box>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2.5, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f3f4f6', color: colors.textMain }}>
                    <ClockIcon />
                  </Box>
                  <Box>
                    <Typography variant="body1" fontWeight={700} color={colors.textMain} noWrap sx={{ maxWidth: 120 }}>
                      {stats.last_run ? formatDate(stats.last_run).split(',')[0] : 'N/A'}
                    </Typography>
                    <Typography variant="caption" color={colors.textMuted} fontWeight={600} textTransform="uppercase">Last Activity</Typography>
                  </Box>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2.5, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fef2f2', color: colors.errorText }}>
                    <FileIcon />
                  </Box>
                  <Box>
                    <Typography variant="h5" fontWeight={700} color={colors.textMain}>{stats.entity_count}</Typography>
                    <Typography variant="caption" color={colors.textMuted} fontWeight={600} textTransform="uppercase">Entity Types</Typography>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* --- MAIN DATA GRID --- */}
          <Paper elevation={0} sx={{ border: `1px solid ${colors.border}`, borderRadius: 2, overflow: 'hidden' }}>
            
            <Box sx={{ px: 2, borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#FAFAFA' }}>
              <Tabs 
                value={activeTab} 
                onChange={handleTabChange} 
                TabIndicatorProps={{ style: { backgroundColor: colors.primary } }}
                sx={{ 
                  minHeight: 56,
                  '& .Mui-selected': { color: `${colors.primary} !important`, fontWeight: 700 }
                }}
              >
                <Tab label="All Activity" sx={{ textTransform: 'none', fontWeight: 500, color: colors.textMuted }} />
                <Tab label="CSV Uploads" icon={<UploadIcon fontSize="small" sx={{mr:1}}/>} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 500, color: colors.textMuted }} />
                <Tab label="SQL Jobs" icon={<DatabaseIcon fontSize="small" sx={{mr:1}}/>} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 500, color: colors.textMuted }} />
              </Tabs>

              <Button 
                startIcon={<ArrowBackIcon />} 
                onClick={() => navigate('/investigation/data-load')} 
                size="small" 
                sx={{ textTransform: 'none', color: colors.textMuted, '&:hover': { color: colors.textMain } }}
              >
                Back to Ingestion
              </Button>
            </Box>

            <TableContainer>
              <Table sx={{ minWidth: 650 }}>
                <TableHead sx={{ bgcolor: '#F8FAFC' }}>
                  <TableRow>
                    {['Operation / Source', 'Entity Type', 'Method', 'Status', 'Timestamp', 'Rows'].map((head, idx) => (
                        <TableCell 
                            key={head} 
                            align={idx === 5 ? 'right' : 'left'}
                            sx={{ color: colors.textMuted, fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', py: 2 }}
                        >
                            {head}
                        </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                        <CircularProgress size={32} sx={{ color: colors.primary }} />
                        <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>Retrieving audit logs...</Typography>
                      </TableCell>
                    </TableRow>
                  ) : filteredHistory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                        <HistoryIcon sx={{ fontSize: 48, color: colors.border, mb: 1 }} />
                        <Typography variant="h6" color={colors.textMain}>No History Found</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredHistory.map((row) => (
                      <TableRow key={row.id} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                        <TableCell component="th" scope="row">
                          <Stack direction="row" spacing={2} alignItems="center">
                            <Box sx={{ 
                              p: 1, 
                              borderRadius: '50%', 
                              bgcolor: row.type === 'sql' ? '#fff7ed' : '#ecfdf5', 
                              color: row.type === 'sql' ? colors.primary : colors.successText 
                            }}>
                              {row.type === 'sql' ? <DatabaseIcon fontSize="small" /> : <UploadIcon fontSize="small" />}
                            </Box>
                            <Box>
                              <Typography variant="body2" fontWeight={600} color={colors.textMain}>{row.name}</Typography>
                              <Typography variant="caption" color={colors.textMuted}>{row.source}</Typography>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                            <Chip 
                              label={row.entity_type} 
                              size="small" 
                              sx={{ bgcolor: '#F3F4F6', color: '#4B5563', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', borderRadius: 1 }} 
                            />
                        </TableCell>
                        <TableCell>
                            <Typography variant="body2" color={colors.textMuted} sx={{ textTransform: 'capitalize' }}>
                              {row.type === 'sql' ? 'Connector Sync' : 'File Upload'}
                            </Typography>
                        </TableCell>
                        <TableCell>
                          {row.status === 'success' ? (
                            <Chip icon={<CheckCircleIcon style={{fontSize: 16}} />} label="Success" size="small" sx={{ bgcolor: colors.successBg, color: colors.successText, fontWeight: 600, border: 'none' }} />
                          ) : (
                            <Chip icon={<ErrorIcon style={{fontSize: 16}} />} label="Failed" size="small" sx={{ bgcolor: colors.errorBg, color: colors.errorText, fontWeight: 600, border: 'none' }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <ClockIcon sx={{ fontSize: 16, color: colors.textMuted }} />
                            <Typography variant="body2" color={colors.textMuted}>{formatDate(row.timestamp)}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600} color={colors.textMain} sx={{ fontFamily: 'monospace' }}>
                            {row.rows ? row.rows.toLocaleString() : '-'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>
      </Box>
    </PageContainer>
  );
};

export default IngestionHistoryScreen;