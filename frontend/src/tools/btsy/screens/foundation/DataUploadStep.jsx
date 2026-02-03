// frontend/src/tools/btsy/screens/foundation/DataUploadStep.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Alert, Grid, CircularProgress,
  Chip, Paper, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, LinearProgress
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  Close as CloseIcon,
  Description as DescriptionIcon,
  Info as InfoIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import btsyApi from '../../services/btsyApi';
import { useSnapshot } from '../../context/SnapshotContext';

const DOMAINS = [
  { key: 'transactions', label: 'Transactions', description: 'Transaction records with amounts, dates, categories', mandatory: true },
  { key: 'accounts', label: 'Accounts', description: 'Account metadata with status and dates', mandatory: true },
  { key: 'customers', label: 'Customers', description: 'Customer profiles with risk ratings and flags', mandatory: true },
  { key: 'str', label: 'STR Reports', description: 'Suspicious Transaction Reports (optional)', mandatory: false },
];

const ProfileDialog = ({ open, onClose, profile, domain, loading }) => {
  if (!profile && !loading) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: '2px' } }}>
      <DialogTitle sx={{ borderBottom: '1px solid #E5E7EB', bgcolor: '#F9FAFB', p: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ width: 32, height: 32, borderRadius: '2px', bgcolor: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DescriptionIcon sx={{ fontSize: 18, color: '#FFFFFF' }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827', fontSize: '1.125rem' }}>
              Data Profile: {domain?.label}
            </Typography>
          </Stack>
          <IconButton onClick={onClose} size="small" sx={{ color: '#6B7280' }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      
      <DialogContent sx={{ p: 3, bgcolor: '#FAFAFA' }}>
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 2 }}>
            <CircularProgress size={48} sx={{ color: '#D97706' }} />
            <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.875rem' }}>
              Profiling data...
            </Typography>
          </Box>
        ) : profile ? (
          <Stack spacing={3}>
            <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #E5E7EB', borderRadius: '2px', bgcolor: '#FFFFFF' }}>
              <Grid container spacing={3}>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                    Rows
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: '1.25rem' }}>
                    {profile.row_count?.toLocaleString() || '0'}
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                    Columns
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: '1.25rem' }}>
                    {profile.column_count || '0'}
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                    File Size
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: '1.25rem' }}>
                    {((profile.file_size_bytes || 0) / 1024 / 1024).toFixed(2)} MB
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {profile.quality && profile.quality.warnings && profile.quality.warnings.length > 0 && (
              <Alert severity="warning" sx={{ borderRadius: '2px', border: '1px solid #FDE68A', bgcolor: '#FFFBEB' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.8125rem', color: '#78350F' }}>
                  Quality Warnings
                </Typography>
                {profile.quality.warnings.map((warning, idx) => (
                  <Typography key={idx} variant="caption" display="block" sx={{ color: '#92400E', fontSize: '0.75rem', lineHeight: 1.6 }}>
                    {warning}
                  </Typography>
                ))}
              </Alert>
            )}

            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #E5E7EB', borderRadius: '2px' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Column</TableCell>
                    <TableCell sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Type</TableCell>
                    <TableCell align="right" sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Null %</TableCell>
                    <TableCell align="right" sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Unique</TableCell>
                    <TableCell align="right" sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Min</TableCell>
                    <TableCell align="right" sx={{ bgcolor: '#F9FAFB', fontWeight: 600, color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #E5E7EB' }}>Max</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profile.columns?.map((col, idx) => (
                    <TableRow key={idx} hover sx={{ '&:hover': { bgcolor: '#F9FAFB' } }}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', fontWeight: 500, color: '#111827' }}>
                        {col.name}
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={col.type} 
                          size="small" 
                          sx={{ 
                            bgcolor: '#F3F4F6',
                            color: '#374151',
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            height: 22,
                            fontFamily: 'monospace'
                          }} 
                        />
                      </TableCell>
                      <TableCell align="right">
                        {col.stats?.null_pct !== undefined ? (
                          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                            <LinearProgress 
                              variant="determinate" 
                              value={Math.min(col.stats.null_pct, 100)}
                              sx={{ 
                                width: 40, 
                                height: 4,
                                borderRadius: '2px',
                                bgcolor: '#E5E7EB',
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: col.stats.null_pct > 50 ? '#DC2626' : col.stats.null_pct > 20 ? '#D97706' : '#059669',
                                  borderRadius: '2px'
                                }
                              }}
                            />
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', minWidth: 45, textAlign: 'right' }}>
                              {col.stats.null_pct.toFixed(1)}%
                            </Typography>
                          </Stack>
                        ) : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: '#374151' }}>
                        {col.stats?.distinct_count?.toLocaleString() || '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6B7280' }}>
                        {col.stats?.min !== undefined ? (
                          typeof col.stats.min === 'number' ? 
                            col.stats.min.toLocaleString() : 
                            col.stats.min_date || col.stats.min
                        ) : (
                          col.stats?.sample_values?.[0] || '—'
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6B7280' }}>
                        {col.stats?.max !== undefined ? (
                          typeof col.stats.max === 'number' ? 
                            col.stats.max.toLocaleString() : 
                            col.stats.max_date || col.stats.max
                        ) : (
                          col.stats?.sample_values?.[col.stats.sample_values.length - 1] || '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        ) : null}
      </DialogContent>
      
      <DialogActions sx={{ p: 3, borderTop: '1px solid #E5E7EB', bgcolor: '#F9FAFB' }}>
        <Button 
          onClick={onClose}
          variant="contained"
          sx={{
            bgcolor: '#1F2937',
            color: '#FFFFFF',
            borderRadius: '2px',
            textTransform: 'none',
            fontWeight: 600,
            px: 3,
            '&:hover': { bgcolor: '#111827' }
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const ClearConfirmDialog = ({ open, onClose, onConfirm, domain }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '2px' } }}>
      <DialogTitle sx={{ bgcolor: '#FEF2F2', borderBottom: '1px solid #FECACA', p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ width: 28, height: 28, borderRadius: '2px', bgcolor: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <WarningIcon sx={{ fontSize: 16, color: '#FFFFFF' }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#991B1B', fontSize: '1.125rem' }}>
            Confirm Clear & Reset
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 3, pb: 2 }}>
        <Typography variant="body1" sx={{ mb: 2, fontSize: '0.9375rem', color: '#111827', lineHeight: 1.6 }}>
          Are you sure you want to clear the {domain?.label || 'dataset'} data?
        </Typography>
        <Paper elevation={0} sx={{ p: 2, bgcolor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '2px' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#991B1B', mb: 1, fontSize: '0.8125rem' }}>
            This action will:
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ color: '#B91C1C', fontSize: '0.8125rem' }}>
              Delete the uploaded file from this session
            </Typography>
            <Typography variant="body2" sx={{ color: '#B91C1C', fontSize: '0.8125rem' }}>
              Reset dataset status for this session
            </Typography>
            <Typography variant="body2" sx={{ color: '#B91C1C', fontSize: '0.8125rem' }}>
              Clear mapping and profiling configuration
            </Typography>
          </Stack>
        </Paper>
        <Typography variant="body2" sx={{ mt: 2, color: '#6B7280', fontSize: '0.8125rem' }}>
          This only affects your current draft session. Saved snapshots are immutable.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 3, borderTop: '1px solid #E5E7EB', bgcolor: '#F9FAFB' }}>
        <Button 
          onClick={onClose}
          sx={{
            color: '#6B7280',
            borderRadius: '2px',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': { bgcolor: '#F3F4F6' }
          }}
        >
          Cancel
        </Button>
        <Button 
          onClick={onConfirm}
          variant="contained"
          sx={{
            bgcolor: '#DC2626',
            color: '#FFFFFF',
            borderRadius: '2px',
            textTransform: 'none',
            fontWeight: 600,
            px: 3,
            '&:hover': { bgcolor: '#B91C1C' }
          }}
        >
          Clear Data
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const DomainCard = ({ domain, status, onUpload, onClear, onProfile, uploadingDomains, profiling, uploadProgress }) => {
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload(domain.key, file);
  };

  const isUploading = uploadingDomains[domain.key];
  const isProfiling = profiling === domain.key;
  const progress = uploadProgress?.[domain.key] ?? 0;

  return (
    <Card elevation={0} sx={{ border: '1px solid #E5E7EB', borderRadius: '2px', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827', fontSize: '1.125rem' }}>
                  {domain.label}
                </Typography>
                {domain.mandatory && (
                  <Chip 
                    label="Required" 
                    size="small" 
                    sx={{ 
                      height: 20,
                      bgcolor: '#FEF3C7',
                      color: '#92400E',
                      fontSize: '0.6875rem',
                      fontWeight: 600
                    }}
                  />
                )}
              </Stack>
              <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.8125rem', lineHeight: 1.5 }}>
                {domain.description}
              </Typography>
            </Box>
          </Stack>

          {status?.uploaded ? (
            <Paper elevation={0} sx={{ p: 2, bgcolor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '2px' }}>
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CheckCircleIcon sx={{ color: '#059669', fontSize: 20 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#065F46', fontSize: '0.875rem' }}>
                    Data Uploaded
                  </Typography>
                </Stack>
                
                <Stack spacing={0.5}>
                  <Typography variant="caption" sx={{ color: '#047857', fontSize: '0.75rem' }}>
                    <strong>File:</strong> {status.filename}
                  </Typography>
                  {status.row_count !== undefined && (
                    <Typography variant="caption" sx={{ color: '#047857', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      <strong>Rows:</strong> {status.row_count.toLocaleString()}
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ color: '#047857', fontSize: '0.75rem' }}>
                    <strong>Uploaded:</strong> {new Date(status.uploaded_at).toLocaleString('en-US', { 
                      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => onProfile(domain.key)}
                    disabled={isProfiling}
                    sx={{
                      borderColor: '#D1D5DB',
                      color: '#374151',
                      borderRadius: '2px',
                      textTransform: 'none',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      '&:hover': {
                        borderColor: '#9CA3AF',
                        bgcolor: '#F9FAFB'
                      }
                    }}
                  >
                    {isProfiling ? 'Profiling...' : 'View Profile'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DeleteIcon />}
                    onClick={() => onClear(domain.key)}
                    sx={{
                      borderColor: '#FECACA',
                      color: '#DC2626',
                      borderRadius: '2px',
                      textTransform: 'none',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      '&:hover': {
                        borderColor: '#FCA5A5',
                        bgcolor: '#FEF2F2'
                      }
                    }}
                  >
                    Clear
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ) : (
            <Box>
              <input
                type="file"
                accept=".csv,.parquet"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                id={`upload-${domain.key}`}
                disabled={isUploading}
              />
              <label htmlFor={`upload-${domain.key}`}>
                <Button
                  component="span"
                  variant="outlined"
                  fullWidth
                  startIcon={isUploading ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                  disabled={isUploading}
                  sx={{
                    borderColor: '#E5E7EB',
                    color: '#374151',
                    borderRadius: '2px',
                    textTransform: 'none',
                    fontWeight: 600,
                    py: 1.5,
                    borderStyle: 'dashed',
                    '&:hover': {
                      borderColor: '#9CA3AF',
                      bgcolor: '#F9FAFB'
                    }
                  }}
                >
                  {isUploading ? 'Uploading...' : 'Select File (CSV or Parquet)'}
                </Button>
                {isUploading && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ color: '#6B7280' }}>
                      {progress.toFixed(0)}% (estimated)
                    </Typography>
                    <LinearProgress variant="determinate" value={progress} sx={{ mt: 0.5 }} />
                  </Box>
                )}
              </label>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

const DataUploadStep = ({ onComplete }) => {
  const { envId } = useSnapshot();
  const [loading, setLoading] = useState(true);
  const [initProgress, setInitProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState({});
  const [uploadingDomains, setUploadingDomains] = useState({});
  const [uploadProgress, setUploadProgress] = useState({});
  const [profiling, setProfiling] = useState(null);
  const [error, setError] = useState(null);
  const [profileDialog, setProfileDialog] = useState({
    open: false,
    profile: null,
    domain: null,
    loading: false
  });
  const [clearDialog, setClearDialog] = useState({
    open: false,
    domain: null
  });

  useEffect(() => {
    fetchStatus();
  }, [envId]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setInitProgress(10);
      setUploadStatus({});
      const res = await btsyApi.upload.getStatus();
      if (res.success) {
        setUploadStatus(res.data.domains);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setInitProgress(100);
    }
  };

  const handleUpload = async (domain, file) => {
    let tick = null;
    try {
      setUploadingDomains(prev => ({ ...prev, [domain]: true }));
      setUploadProgress((p) => ({ ...p, [domain]: 5 }));
      tick = setInterval(() => {
        setUploadProgress((p) => {
          const cur = Number(p?.[domain] ?? 0);
          const next = cur + Math.max(1, Math.round((95 - cur) * 0.08));
          return { ...p, [domain]: next >= 95 ? 95 : next };
        });
      }, 450);
      setError(null);
      await btsyApi.upload.uploadDomain(domain, file);
      await fetchStatus();
      setUploadProgress((p) => ({ ...p, [domain]: 100 }));
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      setUploadProgress((p) => ({ ...p, [domain]: 0 }));
    } finally {
      if (tick) clearInterval(tick);
      setUploadingDomains(prev => ({ ...prev, [domain]: false }));
    }
  };

  const handleClearRequest = (domain) => {
    const domainInfo = DOMAINS.find(d => d.key === domain);
    setClearDialog({ open: true, domain: domainInfo });
  };

  const handleClearConfirm = async () => {
    const domain = clearDialog.domain?.key;
    if (!domain) return;

    try {
      setError(null);
      await btsyApi.upload.clearDomain(domain);
      await fetchStatus();
      setClearDialog({ open: false, domain: null });
    } catch (err) {
      setError(`Clear failed: ${err.message}`);
      setClearDialog({ open: false, domain: null });
    }
  };

  const handleProfile = async (domainKey) => {
    try {
      setError(null);
      setProfiling(domainKey);
      
      setProfileDialog({
        open: true,
        profile: null,
        domain: DOMAINS.find(d => d.key === domainKey),
        loading: true
      });

      const res = await btsyApi.profiling.profileDomain(domainKey);
      if (res.success) {
        setProfileDialog(prev => ({
          ...prev,
          profile: res.data,
          loading: false
        }));
        await fetchStatus();
      }
    } catch (err) {
      setError(`Profile failed: ${err.message}`);
      setProfileDialog(prev => ({ ...prev, loading: false }));
    } finally {
      setProfiling(null);
    }
  };

  const mandatoryComplete = ['transactions', 'accounts', 'customers'].every(
    d => uploadStatus[d]?.uploaded
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 400, justifyContent: 'center', gap: 2 }}>
        <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.875rem' }}>
          Initializing environment… {initProgress.toFixed(0)}% (estimated)
        </Typography>
        <Box sx={{ width: 320 }}>
          <LinearProgress variant="determinate" value={initProgress} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ bgcolor: '#F9FAFB', minHeight: '100vh' }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 4, py: 4 }}>
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#111827', mb: 1, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
            Data Foundation
          </Typography>
          <Typography variant="body2" sx={{ color: '#6B7280', maxWidth: 800, fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Upload your raw data files to establish the foundation for this calibration snapshot. The system accepts CSV or Parquet files.
          </Typography>
        </Box>

        {error && (
          <Alert 
            severity="error" 
            sx={{ mb: 3, borderRadius: '2px', border: '1px solid #FEE2E2', bgcolor: '#FEF2F2' }} 
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          {DOMAINS.map(domain => (
            <Grid item xs={12} md={6} key={domain.key}>
              <DomainCard
                domain={domain}
                status={uploadStatus[domain.key]}
                onUpload={handleUpload}
                onClear={handleClearRequest}
                onProfile={handleProfile}
                uploadingDomains={uploadingDomains}
                profiling={profiling}
                uploadProgress={uploadProgress}
              />
            </Grid>
          ))}
        </Grid>

        {mandatoryComplete && (
          <Paper 
            elevation={0}
            sx={{ 
              p: 3, 
              mt: 4, 
              bgcolor: '#FFFBEB', 
              border: '1px solid #FDE68A',
              borderRadius: '2px'
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ width: 44, height: 44, borderRadius: '2px', bgcolor: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircleIcon sx={{ color: '#FFFFFF', fontSize: 24 }} />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#78350F', fontSize: '0.9375rem' }}>
                    Foundation Complete
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#92400E', fontSize: '0.8125rem' }}>
                    All mandatory data domains have been successfully uploaded and profiled
                  </Typography>
                </Box>
              </Stack>
              <Button 
                variant="contained" 
                onClick={() => onComplete?.()}
                sx={{ 
                  bgcolor: '#1F2937',
                  color: '#FFFFFF',
                  borderRadius: '2px',
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 4,
                  py: 1.25,
                  fontSize: '0.9375rem',
                  '&:hover': { bgcolor: '#111827' }
                }}
              >
                Proceed to Mapping
              </Button>
            </Stack>
          </Paper>
        )}

        <ProfileDialog
          open={profileDialog.open}
          onClose={() => setProfileDialog({ open: false, profile: null, domain: null, loading: false })}
          profile={profileDialog.profile}
          domain={profileDialog.domain}
          loading={profileDialog.loading}
        />

        <ClearConfirmDialog
          open={clearDialog.open}
          onClose={() => setClearDialog({ open: false, domain: null })}
          onConfirm={handleClearConfirm}
          domain={clearDialog.domain}
        />
      </Box>
    </Box>
  );
};

export default DataUploadStep;
