// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/DatasetMappingSelector.jsx
// ============================================================================
/**
 * Final Step of Step 0: Map uploaded datasets to semantic purpose
 * This creates the canonical tables that Step 1 expects
 */
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, FormControl,
  InputLabel, Select, MenuItem, Alert, CircularProgress, Stack,
  Chip, Divider
} from '@mui/material';
import { CheckCircle, ArrowForward, Warning } from '@mui/icons-material';
import apiClient from '@services/api';
import { useCalibration } from '../../context/CalibrationContext';

const DatasetMappingSelector = ({ envId, onComplete }) => {
  const { checkStep0Readiness } = useCalibration();
  
  const [datasets, setDatasets] = useState([]);
  const [mapping, setMapping] = useState({
    transactions: '',
    customers: '',
    accounts: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState(null);

  useEffect(() => {
    loadDatasets();
  }, [envId]);

  const loadDatasets = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setDatasets(response.datasets || []);
      }
      
      // Get suggestions
      const statusResponse = await apiClient.get('/api/v2/calibration/data/step0-status', {
        params: { env_id: envId }
      });
      
      if (statusResponse.success && statusResponse.dataset_options) {
        setSuggestions(statusResponse.dataset_options);
        
        // Auto-select if only one option per category
        const newMapping = {};
        if (statusResponse.dataset_options.transactions?.length === 1) {
          newMapping.transactions = statusResponse.dataset_options.transactions[0].id;
        }
        if (statusResponse.dataset_options.customers?.length === 1) {
          newMapping.customers = statusResponse.dataset_options.customers[0].id;
        }
        if (statusResponse.dataset_options.accounts?.length === 1) {
          newMapping.accounts = statusResponse.dataset_options.accounts[0].id;
        }
        
        if (Object.keys(newMapping).length > 0) {
          setMapping(prev => ({ ...prev, ...newMapping }));
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    // Validate
    if (!mapping.transactions || !mapping.customers) {
      setError('Transactions and Customers datasets are required');
      return;
    }

    setCompleting(true);
    setError(null);

    try {
      // Complete Step 0 and materialize tables
      const response = await apiClient.post('/api/v2/calibration/data/complete-step0', {
        env_id: envId,
        dataset_mapping: {
          transactions: mapping.transactions,
          customers: mapping.customers,
          ...(mapping.accounts && { accounts: mapping.accounts })
        }
      });

      if (response.success) {
        // Update context
        await checkStep0Readiness();
        
        // Navigate to Step 1
        if (onComplete) onComplete();
      } else {
        setError(response.error || 'Failed to complete Step 0');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const canProceed = mapping.transactions && mapping.customers;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3, bgcolor: '#dbeafe', border: '1px solid #bfdbfe' }}>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          🎯 Final Step: Map Datasets to Purpose
        </Typography>
        <Typography variant="body2">
          Select which uploaded dataset corresponds to Transactions, Customers, and Accounts.
          This creates the standardized tables needed for calibration.
        </Typography>
      </Alert>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card elevation={2}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Dataset Mapping
          </Typography>
          
          <Stack spacing={3} sx={{ mt: 3 }}>
            {/* Transactions */}
            <Box>
              <FormControl fullWidth required>
                <InputLabel>Transactions Dataset</InputLabel>
                <Select
                  value={mapping.transactions}
                  onChange={(e) => setMapping({ ...mapping, transactions: e.target.value })}
                  label="Transactions Dataset"
                >
                  <MenuItem value="">
                    <em>Select dataset...</em>
                  </MenuItem>
                  {datasets.map(ds => (
                    <MenuItem key={ds.id} value={ds.id}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                        <Typography variant="body2">{ds.name}</Typography>
                        <Chip 
                          label={`${ds.row_count.toLocaleString()} rows`} 
                          size="small"
                          sx={{ ml: 'auto' }}
                        />
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {suggestions?.transactions && suggestions.transactions.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  💡 Suggested: {suggestions.transactions.map(d => d.name).join(', ')}
                </Typography>
              )}
            </Box>

            {/* Customers */}
            <Box>
              <FormControl fullWidth required>
                <InputLabel>Customers Dataset</InputLabel>
                <Select
                  value={mapping.customers}
                  onChange={(e) => setMapping({ ...mapping, customers: e.target.value })}
                  label="Customers Dataset"
                >
                  <MenuItem value="">
                    <em>Select dataset...</em>
                  </MenuItem>
                  {datasets.map(ds => (
                    <MenuItem key={ds.id} value={ds.id}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                        <Typography variant="body2">{ds.name}</Typography>
                        <Chip 
                          label={`${ds.row_count.toLocaleString()} rows`} 
                          size="small"
                          sx={{ ml: 'auto' }}
                        />
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {suggestions?.customers && suggestions.customers.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  💡 Suggested: {suggestions.customers.map(d => d.name).join(', ')}
                </Typography>
              )}
            </Box>

            {/* Accounts (Optional) */}
            <Box>
              <FormControl fullWidth>
                <InputLabel>Accounts Dataset (Optional)</InputLabel>
                <Select
                  value={mapping.accounts}
                  onChange={(e) => setMapping({ ...mapping, accounts: e.target.value })}
                  label="Accounts Dataset (Optional)"
                >
                  <MenuItem value="">
                    <em>None (skip accounts)</em>
                  </MenuItem>
                  {datasets.map(ds => (
                    <MenuItem key={ds.id} value={ds.id}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                        <Typography variant="body2">{ds.name}</Typography>
                        <Chip 
                          label={`${ds.row_count.toLocaleString()} rows`} 
                          size="small"
                          sx={{ ml: 'auto' }}
                        />
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                ℹ️ If transactions already contain customer info, accounts table is not required
              </Typography>
            </Box>
          </Stack>

          <Divider sx={{ my: 3 }} />

          {/* Preview */}
          {canProceed && (
            <Box sx={{ p: 2, bgcolor: '#f0fdf4', borderRadius: 1, border: '1px solid #86efac', mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: '#065f46' }}>
                📋 What will be created:
              </Typography>
              <Stack spacing={0.5}>
                <Typography variant="body2" sx={{ color: '#065f46' }}>
                  • {envId}_transactions → {datasets.find(d => d.id === mapping.transactions)?.name}
                </Typography>
                <Typography variant="body2" sx={{ color: '#065f46' }}>
                  • {envId}_customers → {datasets.find(d => d.id === mapping.customers)?.name}
                </Typography>
                {mapping.accounts && (
                  <Typography variant="body2" sx={{ color: '#065f46' }}>
                    • {envId}_accounts → {datasets.find(d => d.id === mapping.accounts)?.name}
                  </Typography>
                )}
              </Stack>
            </Box>
          )}

          {/* Complete Button */}
          <Button
            variant="contained"
            fullWidth
            size="large"
            disabled={!canProceed || completing}
            onClick={handleComplete}
            startIcon={completing ? <CircularProgress size={20} /> : <CheckCircle />}
            endIcon={<ArrowForward />}
            sx={{
              bgcolor: '#ea580c',
              '&:hover': { bgcolor: '#c2410c' },
              py: 1.5,
              fontWeight: 600
            }}
          >
            {completing ? 'Creating Tables...' : 'Complete Step 0 & Start Calibration'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
};

export default DatasetMappingSelector;