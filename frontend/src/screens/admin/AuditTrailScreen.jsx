// src/tools/investigation/screens/system/AuditTrailScreen.jsx
import React, { useMemo, useState, useEffect } from 'react';
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";

// MUI Imports
import {
  Box, Paper, Typography, TextField, Button, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, Stack,
  CircularProgress, Alert, Grid, InputAdornment, Tooltip, Tabs, Tab, Select, MenuItem, Divider
} from '@mui/material';

// MUI Icons
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as ErrorIcon,
  Info as InfoIcon,
  History as HistoryIcon,
  FilterList as FilterIcon
} from '@mui/icons-material';

const AuditTrailScreen = () => {
  const [filters, setFilters] = useState({ user: '', action: '', entity_type: '', entity_id: '' });
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionEvents, setSessionEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchLogs(); fetchSessions(); }, []);

  const fetchLogs = async () => {
    setIsLoading(true); 
    setError(null);
    try {
      const res = await apiClient.post('/api/v2/audit/get-trail', filters);
      setLogs(res?.logs || []);
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get('/api/v2/audit/session/list', { limit: 100 });
      if (res?.success) {
        setSessions(res.sessions || []);
        if (!selectedSessionId && Array.isArray(res.sessions) && res.sessions.length) {
          setSelectedSessionId(String(res.sessions[0].session_id));
        }
      }
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!selectedSessionId) {
        setSessionEvents([]);
        return;
      }
      try {
        const res = await apiClient.get(`/api/v2/audit/session/timeline/${encodeURIComponent(selectedSessionId)}`);
        if (res?.success) setSessionEvents(res.events || []);
        else setSessionEvents([]);
      } catch {
        setSessionEvents([]);
      }
    };
    load();
  }, [selectedSessionId]);

  const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const sessionSummary = useMemo(() => {
    const s = sessions.find((x) => String(x.session_id) === String(selectedSessionId));
    return s || null;
  }, [sessions, selectedSessionId]);

  return (
    <PageContainer 
      title="System Audit Trail" 
      subtitle="Track user activity, security events, and system modifications"
      breadcrumbs={['System', 'Audit Logs']}
      actions={
        <Button 
          variant="outlined" 
          size="small" 
          startIcon={<RefreshIcon />} 
          onClick={() => { fetchLogs(); fetchSessions(); }}
          disabled={isLoading}
          sx={{ fontWeight: 600 }}
        >
          Refresh Logs
        </Button>
      }
    >
      {/* Main Content Area - Fixed height for scrolling */}
      <Box sx={{ height: 'calc(100vh - 140px)', p: 3, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
            <Tab label="Logs" />
            <Tab label="Sessions" />
          </Tabs>
        </Paper>
        
        {activeTab === 0 && (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <FilterIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
              FILTER CRITERIA
            </Typography>
          </Box>

          <form onSubmit={(e) => { e.preventDefault(); fetchLogs(); }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="User / Email"
                  name="user"
                  value={filters.user}
                  onChange={handleFilterChange}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Action Type"
                  name="action"
                  value={filters.action}
                  onChange={handleFilterChange}
                  placeholder="e.g. login, update"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="Entity Type"
                  name="entity_type"
                  value={filters.entity_type}
                  onChange={handleFilterChange}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="Entity ID"
                  name="entity_id"
                  value={filters.entity_id}
                  onChange={handleFilterChange}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <Button 
                  fullWidth 
                  type="submit" 
                  variant="contained" 
                  disabled={isLoading}
                  sx={{ height: 40, fontWeight: 'bold' }}
                >
                  {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Search Logs'}
                </Button>
              </Grid>
            </Grid>
          </form>
        </Paper>
        )}

        {/* Results Table (Scrollable) */}
        <Paper 
          variant="outlined" 
          sx={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            borderRadius: 2
          }}
        >
          {error && (
            <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>
          )}

          {activeTab === 0 ? (
            <TableContainer sx={{ flex: 1, overflowY: 'auto' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 180 }}>Timestamp</TableCell>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 200 }}>User</TableCell>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 180 }}>Action</TableCell>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 200 }}>Target Entity</TableCell>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 140 }}>IP Address</TableCell>
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold' }}>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ height: 200 }}>
                      <CircularProgress />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Retrieving audit trail...</Typography>
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ height: 200 }}>
                      <HistoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                      <Typography variant="body2" color="text.secondary">No logs found matching your criteria</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {log.user}
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={log.action} 
                          size="small" 
                          color="primary" 
                          variant="outlined" 
                          sx={{ fontWeight: 'bold', fontSize: '0.75rem', height: 24 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                          {log.entity_type} 
                          {log.entity_id && <Typography component="span" color="text.secondary" sx={{ fontSize: '0.75rem' }}> ({log.entity_id})</Typography>}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {log.ip_address || 'N/A'}
                      </TableCell>
                      <TableCell>
                        <AuditDetailView action={log.action} details={log.details} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          ) : (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden', flex: 1 }}>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Typography variant="caption" fontWeight="bold" color="text.secondary">Session</Typography>
                <Select
                  size="small"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  sx={{ minWidth: 320 }}
                >
                  {sessions.map((s) => (
                    <MenuItem key={s.session_id} value={String(s.session_id)}>
                      {String(s.session_id)} · {s.user} · {s.event_count} events
                    </MenuItem>
                  ))}
                </Select>
                {sessionSummary && (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={`User: ${sessionSummary.user}`} />
                    <Chip size="small" label={`Started: ${new Date(sessionSummary.started_at).toLocaleString()}`} />
                    <Chip size="small" label={`Ended: ${new Date(sessionSummary.ended_at).toLocaleString()}`} />
                  </Stack>
                )}
              </Stack>
              <Divider />
              <TableContainer sx={{ flex: 1, overflowY: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 180 }}>Timestamp</TableCell>
                      <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold', width: 180 }}>Event</TableCell>
                      <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold' }}>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sessionEvents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} align="center" sx={{ height: 200 }}>
                          <HistoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                          <Typography variant="body2" color="text.secondary">No session events</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sessionEvents.map((log) => (
                        <TableRow key={log.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {new Date(log.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Chip label={log.action} size="small" color="primary" variant="outlined" sx={{ fontWeight: 'bold', fontSize: '0.75rem', height: 24 }} />
                          </TableCell>
                          <TableCell>
                            <AuditDetailView action={log.action} details={log.details} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </Paper>

      </Box>
    </PageContainer>
  );
};

// Sub-component for parsing details
const AuditDetailView = ({ action, details }) => {
  let data = {};
  let isJson = false;

  try { 
    data = typeof details === 'string' ? JSON.parse(details) : details; 
    isJson = true;
  } catch (e) { 
    data = details; 
  }

  // Login Specific
  if (typeof action === 'string' && action.toLowerCase().includes('login')) {
    const success = data.success === true || data.success === 'true';
    return (
      <Chip 
        icon={success ? <CheckCircleIcon /> : <ErrorIcon />}
        label={success ? 'Success' : 'Failed'}
        color={success ? 'success' : 'error'}
        size="small"
        sx={{ height: 20, fontSize: '0.7rem' }}
      />
    );
  }

  // JSON Preview
  if (isJson && typeof data === 'object') {
    const preview = JSON.stringify(data).slice(0, 60);
    return (
      <Tooltip title={<pre style={{ fontSize: '0.7rem' }}>{JSON.stringify(data, null, 2)}</pre>} arrow placement="left">
        <Typography variant="caption" sx={{ fontFamily: 'monospace', cursor: 'help', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <InfoIcon sx={{ fontSize: 14 }} /> {preview}{preview.length >= 60 ? '...' : ''}
        </Typography>
      </Tooltip>
    );
  }

  // String Fallback
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {String(details)}
    </Typography>
  );
};

export default AuditTrailScreen;
