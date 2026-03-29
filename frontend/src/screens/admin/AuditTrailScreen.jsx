// src/tools/investigation/screens/system/AuditTrailScreen.jsx
import React, { useMemo, useState, useEffect } from 'react';
import apiClient from "@services/api";

// ✅ Import Layout Components
import PageContainer from "@investigation-layout/PageContainer";

// MUI Imports
import {
  Box, Paper, Typography, TextField, Button, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, Stack,
  CircularProgress, Alert, Grid, InputAdornment, Tabs, Tab, Select, MenuItem, Divider,
  Dialog, DialogTitle, DialogContent, IconButton
} from '@mui/material';

// MUI Icons
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as ErrorIcon,
  History as HistoryIcon,
  FilterList as FilterIcon,
  VisibilityOutlined as ViewIcon,
  Close as CloseIcon,
} from '@mui/icons-material';

const prettifyKey = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '-') : date.toLocaleString();
};

const formatDuration = (ms) => {
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 0) return '';
  const seconds = Math.round(total / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const normalizeDetails = (details) => {
  try {
    return typeof details === 'string' ? JSON.parse(details) : details;
  } catch {
    return details;
  }
};

const stringifyValue = (value) => {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) return value.join(' / ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${prettifyKey(key)}: ${stringifyValue(item)}`).join(', ');
  return String(value);
};

const buildAuditNarrative = (action, details) => {
  const normalizedAction = String(action || '').toLowerCase();
  const data = normalizeDetails(details);
  const objectData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const breadcrumbs = Array.isArray(objectData.breadcrumbs) ? objectData.breadcrumbs.filter(Boolean) : [];
  const screenName = objectData.screen || breadcrumbs[breadcrumbs.length - 1] || objectData.path || objectData.entity_id;
  const durationText = formatDuration(objectData.duration_ms);

  if (normalizedAction.includes('screen_visited')) {
    return {
      headline: `Opened ${screenName || 'screen'}`,
      secondary: breadcrumbs.length ? `Navigation path: ${breadcrumbs.join(' / ')}` : (objectData.path ? `Path: ${objectData.path}` : 'Screen visit recorded'),
      fields: objectData,
    };
  }

  if (normalizedAction.includes('screen_left')) {
    return {
      headline: `Left ${screenName || 'screen'}`,
      secondary: durationText ? `Time spent on screen: ${durationText}` : 'Screen exit recorded',
      fields: objectData,
    };
  }

  if (normalizedAction.includes('login')) {
    const success = objectData.success === true || objectData.success === 'true';
    return {
      headline: success ? 'Login succeeded' : 'Login failed',
      secondary: objectData.reason ? `Reason: ${objectData.reason}` : 'Authentication event recorded',
      fields: objectData,
    };
  }

  if (normalizedAction.includes('logout')) {
    return {
      headline: 'User logged out',
      secondary: objectData.path ? `Path: ${objectData.path}` : 'Logout event recorded',
      fields: objectData,
    };
  }

  if (normalizedAction.includes('status')) {
    const oldStatus = objectData.old_status || objectData.from_status;
    const newStatus = objectData.new_status || objectData.to_status;
    return {
      headline: oldStatus && newStatus ? `Status changed from ${oldStatus} to ${newStatus}` : 'Status updated',
      secondary: objectData.remarks || objectData.reason || 'Case workflow update recorded',
      fields: objectData,
    };
  }

  if (normalizedAction.includes('escalat')) {
    return {
      headline: `Escalated to ${objectData.recipient_role || objectData.target_role || objectData.escalation_level || 'reviewer'}`,
      secondary: objectData.recipient_email ? `Recipient: ${objectData.recipient_email}` : (objectData.remarks || 'Escalation action recorded'),
      fields: objectData,
    };
  }

  if (normalizedAction.includes('mail')) {
    return {
      headline: `Mail ${objectData.status || objectData.send_status || 'event'} recorded`,
      secondary: objectData.recipient_email ? `Recipient: ${objectData.recipient_email}` : (objectData.subject || 'Notification activity recorded'),
      fields: objectData,
    };
  }

  const prioritizedKeys = ['remarks', 'reason', 'path', 'screen', 'recipient_email', 'subject'];
  const firstUsefulKey = prioritizedKeys.find((key) => objectData[key]);
  return {
    headline: prettifyKey(action || 'Audit Event'),
    secondary: firstUsefulKey ? `${prettifyKey(firstUsefulKey)}: ${stringifyValue(objectData[firstUsefulKey])}` : (typeof data === 'string' ? data : 'Audit event recorded'),
    fields: objectData,
  };
};

const AuditTrailScreen = () => {
  const [filters, setFilters] = useState({ user: '', action: '', entity_type: '', entity_id: '' });
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionEvents, setSessionEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detailDialog, setDetailDialog] = useState({ open: false, title: '', action: '', timestamp: '', details: {} });

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
      <Box sx={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>

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
                  <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold' }}>Activity Summary</TableCell>
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
                        <AuditDetailView
                          action={log.action}
                          details={log.details}
                          timestamp={log.timestamp}
                          onOpenDetails={(payload) => setDetailDialog({
                            open: true,
                            title: 'Audit Event Detail',
                            ...payload,
                          })}
                        />
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
                      <TableCell sx={{ bgcolor: '#fafafa', fontWeight: 'bold' }}>Activity Summary</TableCell>
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
                            <AuditDetailView
                              action={log.action}
                              details={log.details}
                              timestamp={log.timestamp}
                              onOpenDetails={(payload) => setDetailDialog({
                                open: true,
                                title: 'Session Event Detail',
                                ...payload,
                              })}
                            />
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
        <AuditDetailDialog
          open={detailDialog.open}
          title={detailDialog.title}
          action={detailDialog.action}
          timestamp={detailDialog.timestamp}
          details={detailDialog.details}
          onClose={() => setDetailDialog({ open: false, title: '', action: '', timestamp: '', details: {} })}
        />
      </Box>
    </PageContainer>
  );
};

const AuditDetailView = ({ action, details, timestamp, onOpenDetails }) => {
  const narrative = buildAuditNarrative(action, details);
  const normalized = normalizeDetails(details);
  const success = String(action || '').toLowerCase().includes('login')
    ? (normalized?.success === true || normalized?.success === 'true')
    : null;

  return (
    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        {success != null ? (
          <Chip
            icon={success ? <CheckCircleIcon /> : <ErrorIcon />}
            label={success ? 'Success' : 'Failed'}
            color={success ? 'success' : 'error'}
            size="small"
            sx={{ height: 22, fontSize: '0.72rem' }}
          />
        ) : null}
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
          {narrative.headline}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.5 }}>
        {narrative.secondary}
      </Typography>
      <Box>
        <Button
          size="small"
          variant="text"
          startIcon={<ViewIcon sx={{ fontSize: 16 }} />}
          onClick={() => onOpenDetails({
            action,
            timestamp,
            details: normalized,
          })}
          sx={{ px: 0, minWidth: 0 }}
        >
          View Details
        </Button>
      </Box>
    </Stack>
  );
};

const AuditDetailDialog = ({ open, title, action, timestamp, details, onClose }) => {
  const normalized = normalizeDetails(details);
  const fields = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? Object.entries(normalized)
    : [['Details', normalized]];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={prettifyKey(action)} variant="outlined" />
              <Chip size="small" label={formatDateTime(timestamp)} variant="outlined" />
            </Stack>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '200px 1fr' }, gap: 1.25 }}>
          {fields.map(([key, value]) => (
            <React.Fragment key={key}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>
                {prettifyKey(key)}
              </Typography>
              <Typography sx={{ fontSize: 13, color: '#0f172a', lineHeight: 1.7, wordBreak: 'break-word' }}>
                {stringifyValue(value)}
              </Typography>
            </React.Fragment>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default AuditTrailScreen;
