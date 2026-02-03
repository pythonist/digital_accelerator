import React from 'react';
import { Box, Paper, Typography, TextField, Button, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon, CloudUpload as CloudUploadIcon } from '@mui/icons-material';

const SnapshotSetupScreen = ({ snapshotName, setSnapshotName, onCancel, onStart, starting, error }) => {
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>Snapshot Setup</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Create a snapshot draft with a user-defined name. Upload is optional until you freeze the snapshot.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          fullWidth
          size="small"
          label="Snapshot name"
          value={snapshotName}
          onChange={(e) => setSnapshotName(e.target.value)}
        />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={onCancel}
            sx={{ textTransform: 'none' }}
          >
            Cancel & return to snapshot list
          </Button>
          <Button
            variant="contained"
            startIcon={<CloudUploadIcon />}
            onClick={onStart}
            disabled={starting}
            sx={{ bgcolor: '#0f172a', '&:hover': { bgcolor: '#1e293b' }, textTransform: 'none' }}
          >
            Upload new data
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default SnapshotSetupScreen;

