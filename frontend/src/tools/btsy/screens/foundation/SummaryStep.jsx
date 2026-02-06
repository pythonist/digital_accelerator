// frontend/src/tools/btsy/screens/foundation/SummaryStep.jsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Grid,
  Chip,
  Divider,
  Stack,
  Paper
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import btsyApi from '../../services/btsyApi';
import { useSnapshot } from '../../context/SnapshotContext';

const SummaryStep = ({ onComplete, onProceed, draftSnapshot }) => {
  const [uploadStatus, setUploadStatus] = useState(null);
  const [normResults, setNormResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const { createNewSnapshot, refreshSnapshots } = useSnapshot();

  useEffect(() => {
    loadSummaryData();
  }, []);

  const loadSummaryData = async () => {
    try {
      setLoading(true);
      setError(null);

      const statusResponse = await btsyApi.upload.getStatus();
      if (statusResponse.success) {
        setUploadStatus(statusResponse.data.domains);
      }

      const domains = ['transactions', 'accounts', 'customers', 'str'];
      const results = {};
      
      for (const domain of domains) {
        try {
          const normResponse = await btsyApi.normalization.getNormalizationResult(domain);
          if (normResponse.success) {
            results[domain] = normResponse.data;
          }
        } catch (err) {
          console.log(`No normalization result for ${domain}`);
        }
      }
      
      setNormResults(results);
    } catch (err) {
      console.error('Failed to load summary:', err);
      setError('Failed to load foundation summary');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSnapshot = async () => {
    let tick = null;
    try {
      setCreating(true);
      setError(null);
      setSuccessMsg('');
      setCreateProgress(5);
      tick = setInterval(() => {
        setCreateProgress((p) => {
          const next = p + Math.max(1, Math.round((95 - p) * 0.08));
          return next >= 95 ? 95 : next;
        });
      }, 450);

      const snapshot = await createNewSnapshot('user', {
        snapshotId: draftSnapshot?.snapshot_id || null,
        snapshotName: draftSnapshot?.snapshot_name || null,
      });
      await refreshSnapshots();
      
      if (onComplete) {
        onComplete();
      }
      if (tick) clearInterval(tick);
      setCreateProgress(100);
      setSuccessMsg(`Snapshot created: ${snapshot.snapshot_name || snapshot.snapshot_id}`);
      
    } catch (err) {
      console.error('Failed to create snapshot:', err);
      setError(err.message || 'Failed to create snapshot');
      setCreateProgress(0);
    } finally {
      if (tick) clearInterval(tick);
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 400, justifyContent: 'center', gap: 2 }}>
        <CircularProgress size={48} sx={{ color: '#D97706' }} />
        <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.875rem' }}>Loading summary...</Typography>
      </Box>
    );
  }

  const totalDomains = Object.keys(normResults).length;
  const totalRows = Object.values(normResults).reduce(
    (sum, r) => sum + (r.output_rows || 0), 
    0
  );

  return (
    <Box sx={{ bgcolor: '#F9FAFB', minHeight: '100vh' }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: 4, py: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, color: '#111827', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          Foundation Summary
        </Typography>
        <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.9375rem', mb: 4 }}>
          Review your foundation data and create an immutable snapshot for calibration
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: '2px', border: '1px solid #FEE2E2', bgcolor: '#FEF2F2' }}>
            {error}
          </Alert>
        )}
        {successMsg && (
          <Alert severity="success" sx={{ mb: 3, borderRadius: '2px', border: '1px solid #bbf7d0', bgcolor: '#f0fdf4' }}>
            {successMsg}
          </Alert>
        )}

        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ p: 3, border: '1px solid #E5E7EB', borderRadius: '2px', bgcolor: '#FFFFFF' }}>
              <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Domains Processed
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: '2rem' }}>
                {totalDomains}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ p: 3, border: '1px solid #E5E7EB', borderRadius: '2px', bgcolor: '#FFFFFF' }}>
              <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Total Rows Normalized
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: '2rem' }}>
                {totalRows.toLocaleString()}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ p: 3, border: '1px solid #E5E7EB', borderRadius: '2px', bgcolor: '#FFFFFF' }}>
              <Typography variant="caption" sx={{ color: '#6B7280', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Foundation Status
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#059669', fontSize: '2rem' }}>
                Ready
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        <Card elevation={0} sx={{ mb: 3, border: '1px solid #E5E7EB', borderRadius: '2px' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2.5, color: '#111827', fontSize: '1.125rem' }}>
              Domain Details
            </Typography>

            <Stack spacing={0} divider={<Divider />}>
              {Object.entries(normResults).map(([domain, result]) => (
                <Box key={domain} sx={{ py: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <Box sx={{ width: 32, height: 32, borderRadius: '2px', bgcolor: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircleIcon sx={{ fontSize: 18, color: '#059669' }} />
                      </Box>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
                          {domain.charAt(0).toUpperCase() + domain.slice(1)}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#6B7280', fontSize: '0.8125rem', fontFamily: 'monospace' }}>
                          {result.input_rows?.toLocaleString()} rows input → {result.output_rows?.toLocaleString()} rows output
                        </Typography>
                        {result.validation_errors > 0 && (
                          <Chip
                            label={`${result.validation_errors} validation errors`}
                            size="small"
                            sx={{ mt: 1, bgcolor: '#FEF3C7', color: '#92400E', fontSize: '0.6875rem', height: 22, fontWeight: 600 }}
                          />
                        )}
                      </Box>
                    </Stack>

                    <Chip
                      label={result.status === 'success' ? 'Success' : result.status}
                      size="small"
                      sx={{
                        bgcolor: result.status === 'success' ? '#DCFCE7' : '#FEE2E2',
                        color: result.status === 'success' ? '#15803D' : '#991B1B',
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        height: 24,
                        textTransform: 'uppercase'
                      }}
                    />
                  </Stack>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

      {foundationSummary && (
        <Card elevation={0} sx={{ mb: 3, border: '1px solid #E5E7EB', borderRadius: '2px' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2.5, color: '#111827', fontSize: '1.125rem' }}>
              Data Foundation Merge Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0' }}>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>Transactions</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{(foundationSummary.transactions_count || 0).toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0' }}>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>Accounts</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{(foundationSummary.accounts_count || 0).toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0' }}>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>Customers</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{(foundationSummary.customers_count || 0).toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0' }}>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>Merge Coverage</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {foundationSummary.merge_customer_coverage?.coverage_pct != null
                      ? `${foundationSummary.merge_customer_coverage.coverage_pct}%`
                      : '—'}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            {mergedPreview?.rows?.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Merged Preview (sample)
                </Typography>
                <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 1, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr>
                        {Object.keys(mergedPreview.rows[0]).slice(0, 12).map((k) => (
                          <th key={k} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e2e8f0', color: '#334155' }}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mergedPreview.rows.map((r, idx) => (
                        <tr key={idx}>
                          {Object.keys(mergedPreview.rows[0]).slice(0, 12).map((k) => (
                            <td key={`${idx}-${k}`} style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontFamily: 'monospace' }}>
                              {String(r[k] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Paper>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

        <Stack direction="row" justifyContent="flex-end" spacing={2} sx={{ mb: 3 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={creating ? null : <SaveIcon />}
            onClick={handleCreateSnapshot}
            disabled={creating || totalDomains === 0}
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
            {creating ? 'Creating Snapshot...' : 'Create Foundation Snapshot'}
          </Button>
        </Stack>

        {creating && (
          <Paper elevation={0} sx={{ p: 2, mb: 3, border: '1px solid #e2e8f0', borderRadius: '2px', bgcolor: '#ffffff' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
              Creating snapshot (estimated)
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              {createProgress.toFixed(0)}% • Rows processed: {totalRows.toLocaleString()}
            </Typography>
            <LinearProgress variant="determinate" value={createProgress} />
          </Paper>
        )}

        <Alert 
          severity="info" 
          sx={{ 
            borderRadius: '2px',
            border: '1px solid #BFDBFE',
            bgcolor: '#F0F9FF'
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#1E3A8A', fontSize: '0.875rem' }}>
            What happens when you create a snapshot?
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ color: '#1E40AF', fontSize: '0.8125rem' }}>
              A frozen, immutable snapshot of your foundation data is created
            </Typography>
            <Typography variant="body2" sx={{ color: '#1E40AF', fontSize: '0.8125rem' }}>
              All raw files, mappings, and normalized data are locked in
            </Typography>
            <Typography variant="body2" sx={{ color: '#1E40AF', fontSize: '0.8125rem' }}>
              This snapshot becomes the basis for all calibration runs
            </Typography>
            <Typography variant="body2" sx={{ color: '#1E40AF', fontSize: '0.8125rem' }}>
              You can create multiple snapshots over time as your data evolves
            </Typography>
          </Stack>
        </Alert>
      </Box>
    </Box>
  );
};

export default SummaryStep;
