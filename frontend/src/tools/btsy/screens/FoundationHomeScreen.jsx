import React, { useMemo, useState } from 'react';
import { Box, Button, Paper, Typography, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useSnapshot } from '../context/SnapshotContext';
import SnapshotSelectionScreen from './SnapshotSelectionScreen';
import DataFoundationContainer from './DataFoundationContainer';
import SnapshotSetupScreen from './foundation/SnapshotSetupScreen';

const FoundationHomeScreen = ({ onProceedToRuns }) => {
  const { activeSnapshot, startNewDraft, draftSnapshot } = useSnapshot();
  const [mode, setMode] = useState('list');
  const [setupName, setSetupName] = useState('');
  const [setupError, setSetupError] = useState('');
  const [starting, setStarting] = useState(false);

  const canContinueDraft = useMemo(() => {
    const s = activeSnapshot;
    if (!s) return false;
    const status = String(s.status_label || s.status || '').toLowerCase();
    return status === 'draft';
  }, [activeSnapshot]);

  const beginDraft = async () => {
    const name = (setupName || '').trim();
    if (!name) {
      setSetupError('Snapshot name is required.');
      return;
    }
    setStarting(true);
    setSetupError('');
    try {
      await startNewDraft(name, 'user');
      setMode('workflow');
    } catch (e) {
      setSetupError(e.message || 'Failed to start snapshot draft');
    } finally {
      setStarting(false);
    }
  };

  if (mode === 'setup') {
    return (
      <SnapshotSetupScreen
        snapshotName={setupName}
        setSnapshotName={setSetupName}
        error={setupError}
        starting={starting}
        onCancel={() => {
          setSetupError('');
          setMode('list');
        }}
        onStart={beginDraft}
      />
    );
  }

  if (mode === 'workflow') {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Data Foundation</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {draftSnapshot?.snapshot_id
                  ? `Draft: ${draftSnapshot.snapshot_name || draftSnapshot.snapshot_id}`
                  : (activeSnapshot?.snapshot_name ? `Snapshot: ${activeSnapshot.snapshot_name}` : 'Draft session')}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => setMode('list')}
              sx={{ textTransform: 'none' }}
            >
              Back to snapshots
            </Button>
          </Box>
          {canContinueDraft && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              You are continuing a draft snapshot. Upload is optional until you decide to freeze the snapshot.
            </Alert>
          )}
        </Paper>

        <DataFoundationContainer
          onProceed={onProceedToRuns}
          onBackToSnapshots={() => setMode('list')}
        />
      </Box>
    );
  }

  return (
    <SnapshotSelectionScreen
      onProceed={onProceedToRuns}
      onCreateNew={() => {
        setSetupError('');
        setSetupName('');
        setMode('setup');
      }}
      onContinueDraft={() => setMode('workflow')}
      canContinueDraft={canContinueDraft}
    />
  );
};

export default FoundationHomeScreen;

