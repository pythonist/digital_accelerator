// frontend/src/tools/mule_detection/screens/MuleUploadScreen.jsx
import React, { useEffect, useState } from 'react';
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
  const [onboarding, setOnboarding] = useState({
    loading: false,
    error: null,
    profile: null,
    validate: null,
    integrity: null,
    timeSanity: null,
    distribution: null,
    lineage: null
  });

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
        loadOnboarding();
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

  const loadOnboarding = async () => {
    setOnboarding((p) => ({ ...p, loading: true, error: null }));
    try {
      const [profile, validate, integrity, timeSanity, distribution, lineage] = await Promise.all([
        muleApi.getDataOnboardingProfile(),
        muleApi.getDataOnboardingValidate(),
        muleApi.getDataOnboardingIntegrity(),
        muleApi.getDataOnboardingTimeSanity(),
        muleApi.getDataOnboardingDistribution(20),
        muleApi.getDataOnboardingLineage()
      ]);
      setOnboarding({
        loading: false,
        error: null,
        profile,
        validate,
        integrity,
        timeSanity,
        distribution,
        lineage
      });
    } catch (e) {
      setOnboarding((p) => ({
        ...p,
        loading: false,
        error: e?.response?.data?.error || e?.message || 'Failed to load onboarding report'
      }));
    }
  };

  useEffect(() => {
    loadOnboarding();
  }, []);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 4 }}>
      <Typography variant="h5" gutterBottom sx={{ color: pwcColors.textMain, mb: 3 }}>
        Upload Mule Detection Data
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          Required: Transactions CSV
        </Typography>
        <Typography variant="caption">
          Transactions columns: txn_id, account_id, txn_timestamp, amount, direction, counterparty_account, counterparty_bank, channel, txn_type, is_suspicious, mule_pattern, hour, day_of_week, is_weekend, is_night, device_id, ip_address, geo_location, balance_after
        </Typography>
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          Accounts columns (optional): account_id, customer_id, account_open_date, customer_type, risk_rating, occupation, expected_turnover, is_mule
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

        {/* Accounts Upload */}
        <Card elevation={0}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Description sx={{ color: pwcColors.textMuted, fontSize: 32 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Accounts CSV (optional)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {files.accounts ? files.accounts.name : 'No file selected'}
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

      <Box sx={{ mt: 4 }}>
        <Card elevation={0}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Data Onboarding Workbench</Typography>
              <Button onClick={loadOnboarding} disabled={onboarding.loading}>
                {onboarding.loading ? 'Loading…' : 'Refresh'}
              </Button>
            </Stack>
            {onboarding.error && <Alert severity="error" sx={{ mb: 2 }}>{onboarding.error}</Alert>}
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Chip label={`Rows: ${onboarding.profile?.rows ?? 0}`} />
                <Chip label={`Accounts: ${onboarding.profile?.accounts ?? 0}`} />
                <Chip label={`Customers: ${onboarding.profile?.customers ?? 0}`} />
                <Chip label={`Activity Density: ${Number(onboarding.profile?.activity_density ?? 0).toFixed(2)}`} />
                <Chip label={`Coverage: ${onboarding.profile?.date_coverage?.start || '-'} → ${onboarding.profile?.date_coverage?.end || '-'}`} />
              </Stack>

              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Chip label={`Contract: ${onboarding.validate?.status || 'unknown'}`} color={onboarding.validate?.status === 'pass' ? 'success' : onboarding.validate?.status === 'warning' ? 'warning' : 'error'} />
                <Chip label={`Null rows: ${onboarding.validate?.nulls?.transactions_rows ?? 0}`} />
                <Chip label={`Dup txns: ${onboarding.validate?.duplicates?.transactions_txn_id ?? 0}`} />
                <Chip label={`Orphans: ${onboarding.integrity?.orphan_transactions ?? 0}`} />
                <Chip label={`Missing days: ${onboarding.timeSanity?.missing_days ?? 0}`} />
                <Chip label={`Future dates: ${onboarding.timeSanity?.future_dates ?? 0}`} />
              </Stack>

              <Stack spacing={1}>
                <Typography variant="subtitle2" fontWeight={700}>Recent Uploads</Typography>
                {Array.isArray(onboarding.lineage?.uploads) && onboarding.lineage.uploads.length ? (
                  <Stack spacing={1}>
                    {onboarding.lineage.uploads.slice(0, 3).map((u) => (
                      <Card key={u.upload_id} elevation={0} sx={{ border: `1px solid ${pwcColors.border}` }}>
                        <CardContent sx={{ py: 1.5 }}>
                          <Stack direction="row" spacing={2} flexWrap="wrap">
                            <Chip label={`Version: ${u.dataset_version || '-'}`} />
                            <Chip label={`Txn rows: ${u.txn_row_count ?? 0}`} />
                            <Chip label={`Acc rows: ${u.accounts_row_count ?? 0}`} />
                            <Chip label={`By: ${u.uploader || '-'}`} />
                            <Chip label={`At: ${u.uploaded_at || '-'}`} />
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">No uploads logged yet.</Typography>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default MuleUploadScreen;
