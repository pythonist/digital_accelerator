// frontend/src/tools/btsy/screens/SnapshotSelectionScreen.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Alert, IconButton,
  Tooltip, Divider, Paper, Stack, Dialog, DialogTitle, DialogContent, DialogActions, Tabs, Tab, CircularProgress
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Lock as LockIcon,
  Add as AddIcon,
  Visibility as VisibilityIcon,
  LockOpen as LockOpenIcon,
  History as HistoryIcon,
  Info as InfoIcon,
  Close as CloseIcon,
  ArrowForward as ArrowForwardIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { useSnapshot } from '../context/SnapshotContext';
import btsyApi from '../services/btsyApi';

const SnapshotSelectionScreen = ({ onProceed, onCreateNew, onContinueDraft, canContinueDraft }) => {
  const {
    activeSnapshot,
    snapshots,
    loading,
    selectSnapshot,
    refreshSnapshots
  } = useSnapshot();

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
  const [tab, setTab] = useState('all');
  const currentEnvId = sessionStorage.getItem('btsy_env_id') || 'default';
  const [viewDialog, setViewDialog] = useState({
    open: false,
    loading: false,
    snapshot: null,
    error: null
  });
  const [renameDialog, setRenameDialog] = useState({ open: false, snapshot: null, name: '', saving: false, error: '' });

  useEffect(() => {
    if (activeSnapshot?.snapshot_id) {
      setSelectedSnapshotId(activeSnapshot.snapshot_id);
      return;
    }
    if (!selectedSnapshotId && snapshots.length > 0) {
      setSelectedSnapshotId(snapshots[0].snapshot_id);
    }
  }, [activeSnapshot?.snapshot_id, selectedSnapshotId, snapshots]);

  const filteredSnapshots = useMemo(() => {
    if (tab === 'active') {
      return activeSnapshot ? snapshots.filter(s => s.snapshot_id === activeSnapshot.snapshot_id) : [];
    }
    if (tab === 'archived') {
      return snapshots.filter(s => s.snapshot_id !== activeSnapshot?.snapshot_id);
    }
    return snapshots;
  }, [tab, snapshots, activeSnapshot?.snapshot_id]);

  const openView = async (snapshotId) => {
    try {
      setViewDialog({ open: true, loading: true, snapshot: null, error: null });
      const res = await btsyApi.snapshot.getSnapshot(snapshotId);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to load snapshot');
      }
      setViewDialog({ open: true, loading: false, snapshot: res.data, error: null });
    } catch (e) {
      setViewDialog({ open: true, loading: false, snapshot: null, error: e.message });
    }
  };

  const handleUseSnapshot = async (snapshotId) => {
    setSelectedSnapshotId(snapshotId);
    await selectSnapshot(snapshotId);
  };

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><Typography variant="body2">Loading repository...</Typography></Box>;

  return (
    <Box sx={{ p: 4, maxWidth: 1400, margin: '0 auto' }}>
      {/* Institutional Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid #e2e8f0', pb: 2 }}>
        <Box>
          <Typography variant="overline" sx={{ color: '#64748b', fontWeight: 700, letterSpacing: 1.2 }}>
            ATLAS SYSTEM / CALIBRATION
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a', mt: 0.5 }}>
            Foundation Snapshots
          </Typography>
        </Box>
        
        {(
          <Button
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={() => onCreateNew?.()}
            sx={{ bgcolor: '#0f172a', '&:hover': { bgcolor: '#1e293b' }, borderRadius: 1, textTransform: 'none', px: 3 }}
          >
            Create New Snapshot
          </Button>
        )}
      </Box>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3}>
        {/* Left: Main Table Area */}
        <Box sx={{ flex: 1 }}>
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            Current environment: <Box component="span" sx={{ fontFamily: 'monospace' }}>{currentEnvId}</Box>. Snapshots and runs are saved per environment.
          </Alert>
          {!activeSnapshot && snapshots.length === 0 ? (
            <Alert severity="warning" variant="outlined" sx={{ borderRadius: 1, border: '1px solid #cbd5e1' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>No Foundation Snapshots Found</Typography>
              <Typography variant="body2">Complete the Data Foundation workflow to initialize calibration.</Typography>
            </Alert>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: 1, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <Box sx={{ px: 2, pt: 1.5, borderBottom: '1px solid #e2e8f0', bgcolor: '#ffffff' }}>
                <Tabs
                  value={tab}
                  onChange={(_, v) => setTab(v)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{
                    minHeight: 36,
                    '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 700 },
                    '& .MuiTabs-indicator': { bgcolor: '#0f172a' }
                  }}
                >
                  <Tab value="all" label={`All (${snapshots.length})`} />
                  <Tab value="active" label="Active" />
                  <Tab value="archived" label="Archived" />
                </Tabs>
              </Box>

              <TableContainer>
                <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, color: '#475569', py: 2 }}>SNAPSHOT NAME</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: '#475569' }}>CREATED AT</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: '#475569' }}>STATUS</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: '#475569' }}>USED BY RUNS</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: '#475569' }}>TOTAL ROWS</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>ACTIONS</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredSnapshots.map((snapshot) => {
                    const isActive = activeSnapshot?.snapshot_id === snapshot.snapshot_id;
                    const statusLabel = snapshot.status_label || (String(snapshot.status || '').toLowerCase() === 'draft' ? 'Draft' : 'Locked');
                    return (
                      <TableRow 
                        key={snapshot.snapshot_id} 
                        hover 
                        selected={isActive}
                        onClick={() => handleUseSnapshot(snapshot.snapshot_id)}
                        sx={{ cursor: 'pointer', '&.Mui-selected': { bgcolor: '#f1f5f9 !important' } }}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#1e293b' }}>
                            {snapshot.snapshot_name || snapshot.snapshot_id}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#64748b' }}>
                            {snapshot.snapshot_id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#0f172a' }}>
                            {formatDate(snapshot.created_at)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={statusLabel.toUpperCase()} 
                            size="small" 
                            variant="outlined"
                            sx={{ 
                              borderRadius: 1, 
                              fontSize: '0.65rem', 
                              fontWeight: 800,
                              borderColor: statusLabel.toLowerCase() === 'in use' ? '#10b981' : statusLabel.toLowerCase() === 'draft' ? '#f59e0b' : '#0f172a',
                              color: statusLabel.toLowerCase() === 'in use' ? '#10b981' : statusLabel.toLowerCase() === 'draft' ? '#b45309' : '#0f172a'
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {Number(snapshot.used_by_runs || 0).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {Number(snapshot.total_output_rows || 0).toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="View details">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                openView(snapshot.snapshot_id);
                              }}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Rename snapshot">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameDialog({
                                  open: true,
                                  snapshot,
                                  name: snapshot.snapshot_name || '',
                                  saving: false,
                                  error: '',
                                });
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={isActive ? 'In use' : 'Use snapshot'}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={isActive}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUseSnapshot(snapshot.snapshot_id);
                                }}
                              >
                                <CheckCircleIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>

        {/* Right: Active Snapshot Panel (The "Summary Sidebar") */}
        {activeSnapshot && (
          <Box sx={{ width: { lg: 340 } }}>
            <Card variant="outlined" sx={{ borderRadius: 1, border: '1px solid #e2e8f0', position: 'sticky', top: 24 }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon /> Selection Summary
                </Typography>
                
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Snapshot</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: '#f8fafc', p: 1, mt: 0.5, borderRadius: 1, border: '1px solid #e2e8f0' }}>
                      {activeSnapshot.snapshot_name || activeSnapshot.snapshot_id}
                    </Typography>
                  </Box>

                  <Divider />

                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>USED BY RUNS</Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>{Number(activeSnapshot.used_by_runs || 0).toLocaleString()}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>TOTAL ROWS</Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>{activeSnapshot.total_output_rows?.toLocaleString()}</Typography>
                    </Box>
                  </Box>

                  <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 1, border: '1px solid #e2e8f0' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Typography variant="caption" sx={{ color: '#475569', fontWeight: 800, textTransform: 'uppercase' }}>
                        Aggregate Quality Score
                      </Typography>
                      <Tooltip title="Average of per-domain quality scores captured at snapshot freeze time (0–100). If it shows 0%, quality scoring was not computed for the uploaded data.">
                        <IconButton size="small" sx={{ color: '#64748b' }}>
                          <InfoIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 900, color: '#0f172a', mt: 0.5 }}>
                      {typeof activeSnapshot.quality_summary?.avg_quality === 'number'
                        ? `${activeSnapshot.quality_summary.avg_quality.toFixed(1)}%`
                        : '—'}
                    </Typography>
                  </Box>

                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    onClick={onProceed}
                    endIcon={<ArrowForwardIcon />}
                    sx={{ bgcolor: '#0f172a', py: 1.5, fontWeight: 700, '&:hover': { bgcolor: '#1e293b' } }}
                  >
                    Proceed to Calibration
                  </Button>
                  {canContinueDraft && (
                    <Button
                      fullWidth
                      variant="outlined"
                      size="large"
                      onClick={onContinueDraft}
                      sx={{ borderColor: '#e2e8f0', color: '#334155', textTransform: 'none', py: 1.2, fontWeight: 700 }}
                    >
                      Continue Draft
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Box>
        )}
      </Stack>

      <Dialog
        open={viewDialog.open}
        onClose={() => setViewDialog({ open: false, loading: false, snapshot: null, error: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ color: '#64748b', fontWeight: 800, letterSpacing: 0.6 }}>
              SNAPSHOT DETAILS
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 900, color: '#0f172a' }}>
              {viewDialog.snapshot?.snapshot_id || 'Foundation Snapshot'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Use this snapshot">
              <span>
                <Button
                  variant="contained"
                  disableElevation
                  onClick={async () => {
                    const sid = viewDialog.snapshot?.snapshot_id;
                    if (!sid) return;
                    await handleUseSnapshot(sid);
                    setViewDialog({ open: false, loading: false, snapshot: null, error: null });
                  }}
                  sx={{ bgcolor: '#0f172a', '&:hover': { bgcolor: '#1e293b' }, textTransform: 'none' }}
                  startIcon={<CheckCircleIcon />}
                  disabled={!viewDialog.snapshot?.snapshot_id}
                >
                  Use
                </Button>
              </span>
            </Tooltip>
            <IconButton onClick={() => setViewDialog({ open: false, loading: false, snapshot: null, error: null })}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {viewDialog.loading ? (
            <Box sx={{ py: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <CircularProgress size={24} />
              <Typography variant="body2" sx={{ color: '#475569', fontWeight: 600 }}>
                Loading snapshot…
              </Typography>
            </Box>
          ) : viewDialog.error ? (
            <Alert severity="error" variant="outlined">
              {viewDialog.error}
            </Alert>
          ) : viewDialog.snapshot ? (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Created</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    {formatDate(viewDialog.snapshot.created_at)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Frozen By</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    {viewDialog.snapshot.frozen_by || 'system'}
                  </Typography>
                </Box>
              </Box>

              <Paper variant="outlined" sx={{ borderRadius: 1, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Domain</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Input Rows</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Output Rows</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Validation Errors</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Quality</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(viewDialog.snapshot.domains || []).map((d) => (
                      <TableRow key={d.domain} hover>
                        <TableCell sx={{ fontWeight: 700, color: '#0f172a' }}>
                          {d.domain}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {Number(d.input_rows || 0).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {Number(d.output_rows || 0).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {Number(d.validation_errors || 0).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {typeof d.quality_score === 'number' ? `${d.quality_score.toFixed(1)}%` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setViewDialog({ open: false, loading: false, snapshot: null, error: null })}
            variant="outlined"
            sx={{ borderColor: '#e2e8f0', color: '#334155', textTransform: 'none' }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={renameDialog.open}
        onClose={() => setRenameDialog({ open: false, snapshot: null, name: '', saving: false, error: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rename Snapshot</DialogTitle>
        <DialogContent dividers>
          {renameDialog.error && <Alert severity="error" sx={{ mb: 2 }}>{renameDialog.error}</Alert>}
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Snapshot ID: <Box component="span" sx={{ fontFamily: 'monospace' }}>{renameDialog.snapshot?.snapshot_id || '—'}</Box>
          </Typography>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Snapshot name</Typography>
            <Box sx={{ mt: 1 }}>
              <input
                value={renameDialog.name}
                onChange={(e) => setRenameDialog((p) => ({ ...p, name: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog({ open: false, snapshot: null, name: '', saving: false, error: '' })} variant="outlined" sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const sid = renameDialog.snapshot?.snapshot_id;
              const name = (renameDialog.name || '').trim();
              if (!sid) return;
              if (!name) {
                setRenameDialog((p) => ({ ...p, error: 'Snapshot name is required.' }));
                return;
              }
              setRenameDialog((p) => ({ ...p, saving: true, error: '' }));
              try {
                const res = await btsyApi.snapshot.renameSnapshot(sid, name);
                if (!res.success) throw new Error(res.error || 'Rename failed');
                await refreshSnapshots();
                setRenameDialog({ open: false, snapshot: null, name: '', saving: false, error: '' });
              } catch (e) {
                setRenameDialog((p) => ({ ...p, saving: false, error: e.message }));
              }
            }}
            disabled={renameDialog.saving}
            variant="contained"
            sx={{ bgcolor: '#0f172a', '&:hover': { bgcolor: '#1e293b' }, textTransform: 'none' }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SnapshotSelectionScreen;
