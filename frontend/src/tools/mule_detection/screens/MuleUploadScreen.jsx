// frontend/src/tools/mule_detection/screens/MuleUploadScreen.jsx
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Alert,
  Stack, LinearProgress, Chip
} from '@mui/material';
import { CloudUpload, CheckCircle, Description } from '@mui/icons-material';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';

const MuleUploadScreen = ({ onUploadComplete }) => {
  const [files, setFiles] = useState({ transactions: null, accounts: null });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleFileSelect = (type, event) => {
    const file = event.target.files[0];
    if (file) {
      setFiles(prev => ({ ...prev, [type]: file }));
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!files.transactions) {
      setError('Transactions file is required');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await muleApi.uploadData(files);
      
      if (response.success) {
        setSuccess(true);
        setTimeout(() => {
          onUploadComplete();
        }, 1500);
      } else {
        setError(response.error || 'Upload failed');
      }
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 4 }}>
      <Typography variant="h5" gutterBottom sx={{ color: pwcColors.textMain, mb: 3 }}>
        Upload Mule Detection Data
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          Required: Transaction Data
        </Typography>
        <Typography variant="caption">
          Upload a CSV with columns: account_id, txn_timestamp, amount, direction, channel, counterparty_account
        </Typography>
      </Alert>

      <Stack spacing={3}>
        {/* Transactions Upload */}
        <Card elevation={0}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Description sx={{ color: pwcColors.primary, fontSize: 32 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Transactions CSV *
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {files.transactions ? files.transactions.name : 'No file selected'}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                component="label"
                disabled={uploading}
                sx={{ borderColor: pwcColors.primary, color: pwcColors.primary }}
              >
                Select File
                <input
                  type="file"
                  hidden
                  accept=".csv"
                  onChange={(e) => handleFileSelect('transactions', e)}
                />
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* Accounts Upload (Optional) */}
        <Card elevation={0}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Description sx={{ color: pwcColors.textMuted, fontSize: 32 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Accounts CSV (Optional)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {files.accounts ? files.accounts.name : 'Additional account metadata'}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                component="label"
                disabled={uploading}
              >
                Select File
                <input
                  type="file"
                  hidden
                  accept=".csv"
                  onChange={(e) => handleFileSelect('accounts', e)}
                />
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* Upload Button */}
        <Box>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleUpload}
            disabled={!files.transactions || uploading}
            startIcon={uploading ? null : <CloudUpload />}
            sx={{
              bgcolor: pwcColors.primary,
              '&:hover': { bgcolor: '#c14a0a' },
              py: 1.5
            }}
          >
            {uploading ? 'Uploading...' : 'Upload Data'}
          </Button>
          {uploading && <LinearProgress sx={{ mt: 2 }} />}
        </Box>

        {/* Error / Success */}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" icon={<CheckCircle />}>
            Data uploaded successfully! Redirecting...
          </Alert>
        )}
      </Stack>
    </Box>
  );
};

export default MuleUploadScreen;