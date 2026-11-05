import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
  ErrorOutline as ErrorIcon,
  Hub as HubIcon,
  Layers as LayersIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';

import apiClient from '@services/api';

const RebuildIndexModal = ({ open, onClose, onIndexRebuilt, existingIndexStatus }) => {
  const [status, setStatus] = useState('idle'); // 'idle' | 'building' | 'completed' | 'error'
  const [progress, setProgress] = useState({
    total: 0,
    current: 0,
    currentCaseId: '',
    percentage: 0,
    message: '',
    error: null,
  });
  const pollTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // When modal opens, initialize build
  useEffect(() => {
    if (open) {
      startRebuild();
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setStatus('idle');
      setProgress({
        total: 0,
        current: 0,
        currentCaseId: '',
        percentage: 0,
        message: '',
        error: null,
      });
    }
  }, [open]);

  const startRebuild = async () => {
    setStatus('building');
    setProgress({
      total: existingIndexStatus?.case_count || 0,
      current: 0,
      currentCaseId: '',
      percentage: 2,
      message: 'Initializing case portfolio and calculating dimensions...',
      error: null,
    });

    try {
      const initResp = await apiClient.rebuildCaseRetrievalIndex({ force_rebuild: true, async: true });
      if (initResp?.total) {
        setProgress((prev) => ({
          ...prev,
          total: initResp.total,
          message: `Identified ${initResp.total} cases to index. Extracting signals...`,
        }));
      }

      // Begin polling progress
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(pollProgress, 250);
    } catch (err) {
      if (!isMountedRef.current) return;
      setStatus('error');
      setProgress((prev) => ({
        ...prev,
        error: err.message || 'Failed to start index rebuild.',
      }));
    }
  };

  const pollProgress = async () => {
    try {
      const data = await apiClient.getCaseRetrievalRebuildProgress();
      if (!isMountedRef.current) return;

      const currentStatus = data?.status;
      setProgress({
        total: data?.total || 0,
        current: data?.current || 0,
        currentCaseId: data?.current_case_id || '',
        percentage: Math.min(100, Math.max(0, data?.percentage || 0)),
        message: data?.message || '',
        error: data?.error || null,
      });

      if (currentStatus === 'completed') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setStatus('completed');
        // Fetch fresh index status to return to parent
        try {
          const freshStatus = await apiClient.getCaseRetrievalIndexStatus();
          if (onIndexRebuilt) onIndexRebuilt(freshStatus);
        } catch {
          // ignore
        }
      } else if (currentStatus === 'error') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setStatus('error');
      }
    } catch (pollErr) {
      console.warn('Poll error:', pollErr);
    }
  };

  const handleDone = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={status === 'building' ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2.5,
          boxShadow: '0 20px 40px rgba(15, 23, 42, 0.18)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        },
      }}
    >
      {/* Header */}
      <DialogTitle sx={{ m: 0, p: 2.5, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                bgcolor: status === 'completed' ? '#ecfdf5' : '#fff7ed',
                border: '1px solid',
                borderColor: status === 'completed' ? '#a7f3d0' : '#fed7aa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: status === 'completed' ? '#059669' : '#ea580c',
              }}
            >
              {status === 'completed' ? <CheckCircleIcon fontSize="small" /> : <StorageIcon fontSize="small" />}
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                {status === 'completed'
                  ? 'Case Retrieval Index Ready'
                  : status === 'error'
                  ? 'Index Rebuild Error'
                  : 'Rebuilding Vector Retrieval Index'}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b' }}>
                Multi-vector behavioral, typology, alert, and network indexing
              </Typography>
            </Box>
          </Stack>
          {status !== 'building' && (
            <IconButton size="small" onClick={onClose} sx={{ color: '#94a3b8' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </DialogTitle>

      {/* Content */}
      <DialogContent sx={{ p: 3, bgcolor: '#ffffff' }}>
        {status === 'building' && (
          <Stack spacing={2.5}>
            {/* Live Progress Bar Card */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#fcfcfd', borderColor: '#e2e8f0' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  Live Indexing Progress
                </Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#ea580c', fontFamily: 'monospace' }}>
                  {progress.percentage}%
                </Typography>
              </Stack>

              <LinearProgress
                variant="determinate"
                value={progress.percentage}
                sx={{
                  height: 10,
                  borderRadius: 1.5,
                  bgcolor: '#e2e8f0',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: '#ea580c',
                    borderRadius: 1.5,
                    transition: 'transform 0.2s ease-out',
                  },
                }}
              />

              <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                  Processed: <strong style={{ color: '#0f172a' }}>{progress.current}</strong> of{' '}
                  <strong style={{ color: '#0f172a' }}>{progress.total || 'calculating...'}</strong> cases
                </Typography>
                {progress.currentCaseId && (
                  <Typography
                    sx={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#475569',
                      bgcolor: '#f1f5f9',
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    Active: {progress.currentCaseId}
                  </Typography>
                )}
              </Stack>
            </Paper>

            {/* Current Step Status */}
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 0.5 }}>
              <CircularProgress size={16} sx={{ color: '#ea580c' }} />
              <Typography sx={{ fontSize: 12.5, color: '#475569', fontStyle: 'italic' }}>
                {progress.message || 'Extracting features and building normalized embeddings...'}
              </Typography>
            </Stack>

            {/* Info note */}
            <Typography sx={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6, px: 0.5 }}>
              The index builds multi-dimensional similarity representations across transactions, typologies, counterparties, and alerts. This ensures instant sub-second similarity matching.
            </Typography>
          </Stack>
        )}

        {status === 'completed' && (
          <Stack spacing={2.5}>
            <Box
              sx={{
                p: 2.5,
                bgcolor: '#ecfdf5',
                borderRadius: 2,
                border: '1px solid #a7f3d0',
                display: 'flex',
                gap: 2,
                alignItems: 'center',
              }}
            >
              <CheckCircleIcon sx={{ color: '#059669', fontSize: 32 }} />
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#065f46' }}>
                  Index Rebuild Complete
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: '#047857' }}>
                  Successfully indexed and normalized <strong>{progress.total || progress.current} cases</strong>.
                </Typography>
              </Box>
            </Box>

            {/* Index Vectors Summary */}
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: '#e2e8f0' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1.5 }}>
                Indexed Vector Components
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {[
                  { label: 'Behavioral Signals', sub: 'Volume & Velocity' },
                  { label: 'Typology Vectors', sub: 'Structuring & Layering' },
                  { label: 'Alert Overlap', sub: 'Rule Patterns' },
                  { label: 'Network Proximity', sub: 'Counterparties' },
                  { label: 'Hybrid FAISS', sub: 'Multi-layer Index' },
                ].map((item, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      mb: 1,
                      bgcolor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 1.5,
                    }}
                  >
                    <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a' }}>
                      {item.label}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: '#64748b' }}>{item.sub}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Stack>
        )}

        {status === 'error' && (
          <Stack spacing={2}>
            <Box
              sx={{
                p: 2.5,
                bgcolor: '#fef2f2',
                borderRadius: 2,
                border: '1px solid #fecaca',
                display: 'flex',
                gap: 2,
                alignItems: 'center',
              }}
            >
              <ErrorIcon sx={{ color: '#dc2626', fontSize: 32 }} />
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#991b1b' }}>
                  Failed to Rebuild Index
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: '#b91c1c' }}>
                  {progress.error || 'An unexpected error occurred during index generation.'}
                </Typography>
              </Box>
            </Box>
            <Button
              variant="outlined"
              color="error"
              startIcon={<RefreshIcon />}
              onClick={startRebuild}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              Retry Rebuild
            </Button>
          </Stack>
        )}
      </DialogContent>

      <Divider />

      {/* Actions */}
      <DialogActions sx={{ p: 2, px: 3, bgcolor: '#f8fafc' }}>
        {status === 'building' ? (
          <Button variant="text" size="small" onClick={onClose} sx={{ color: '#64748b', textTransform: 'none' }}>
            Run in Background
          </Button>
        ) : (
          <Button
            variant="contained"
            disableElevation
            onClick={handleDone}
            sx={{
              bgcolor: '#0f172a',
              color: '#ffffff',
              fontWeight: 600,
              textTransform: 'none',
              px: 3,
              '&:hover': { bgcolor: '#1e293b' },
            }}
          >
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RebuildIndexModal;

