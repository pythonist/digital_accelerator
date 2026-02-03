// frontend/tools/calibration/screens/Step0_DataFoundation/DataUploadScreen.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Button, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, CircularProgress, Stack, Tooltip, LinearProgress, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Paper
} from '@mui/material';
import {
  CloudUpload, Delete, Edit, Refresh, CheckCircle, 
  Description, ArrowForward, Storage
} from '@mui/icons-material';
import apiClient from '@services/api';
import { PageTransition, MotionContainer, MotionItem } from '@components/MotionWrappers/MotionWrappers';
import FileUploadCard from './components/FileUploadCard';

const DataUploadScreen = ({ envId, onComplete }) => {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [editDialog, setEditDialog] = useState({ open: false, dataset: null, newName: '' });

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setDatasets(response.datasets || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load datasets');
    } finally {
      setLoading(false);
    }
  }, [envId]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const handleUpload = async (file, datasetName) => {
    setUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('env_id', envId);
    
    if (datasetName) {
      formData.append('dataset_name', datasetName);
    }

    try {
      const response = await apiClient.post('/api/v2/calibration/data/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.success) {
        setSuccess(`Uploaded: ${response.dataset_name} (${response.row_count.toLocaleString()} rows)`);
        await loadDatasets();
        
        // Auto-infer schema
        await apiClient.post(`/api/v2/calibration/data/schema/${response.dataset_id}/infer`, {
          env_id: envId
        });
        
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(response.error || 'Upload failed');
      }
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (datasetId) => {
    if (!window.confirm('Delete this dataset? This cannot be undone.')) {
      return;
    }

    try {
      const response = await apiClient.delete(`/api/v2/calibration/data/dataset/${datasetId}`);
      
      if (response.success) {
        setSuccess('Dataset deleted');
        await loadDatasets();
        setTimeout(() => setSuccess(null), 2000);
      } else {
        setError(response.error || 'Delete failed');
      }
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  };

  const handleRename = async () => {
    if (!editDialog.newName.trim()) {
      setError('Dataset name cannot be empty');
      return;
    }

    try {
      const response = await apiClient.post(
        `/api/v2/calibration/data/dataset/${editDialog.dataset.id}/rename`,
        { new_name: editDialog.newName }
      );

      if (response.success) {
        setSuccess('Dataset renamed');
        await loadDatasets();
        setEditDialog({ open: false, dataset: null, newName: '' });
        setTimeout(() => setSuccess(null), 2000);
      } else {
        setError(response.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const openRenameDialog = (dataset) => {
    setEditDialog({
      open: true,
      dataset: dataset,
      newName: dataset.name
    });
  };

  // Calculate progress
  const totalRows = datasets.reduce((sum, d) => sum + d.row_count, 0);
  const hasData = datasets.length > 0;

  return (
    <PageTransition>
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <MotionContainer>
          <MotionItem>
            <Alert 
              severity="info" 
              variant="outlined"
              sx={{ mb: 3 }}
              icon={<Storage />}
            >
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Upload Data Files
              </Typography>
              <Typography variant="body2">
                Upload CSV files for calibration. Multiple files supported with automatic schema detection.
              </Typography>
            </Alert>
          </MotionItem>

          <MotionItem>
            <FileUploadCard 
              onUpload={handleUpload}
              uploading={uploading}
              disabled={uploading || loading}
            />
          </MotionItem>

          {error && (
            <MotionItem>
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            </MotionItem>
          )}
          
          {success && (
            <MotionItem>
              <Alert severity="success" onClose={() => setSuccess(null)} icon={<CheckCircle />}>
                {success}
              </Alert>
            </MotionItem>
          )}

          {/* Progress Summary */}
          {hasData && (
            <MotionItem>
              <Card 
                sx={{ 
                  bgcolor: '#f8fafc', 
                  border: '2px solid #e2e8f0',
                  borderRadius: 2
                }} 
                elevation={0}
              >
                <CardContent>
                  <Stack spacing={3}>
                    {/* Metrics Row */}
                    <Stack direction="row" spacing={4}>
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                          <Storage sx={{ fontSize: 18, color: '#D04A02' }} />
                          <Typography variant="caption" color="text.secondary" fontWeight={500}>
                            Datasets Uploaded
                          </Typography>
                        </Stack>
                        <Typography variant="h3" fontWeight={700} color="#D04A02">
                          {datasets.length}
                        </Typography>
                      </Box>
                      
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                          <Description sx={{ fontSize: 18, color: '#0284c7' }} />
                          <Typography variant="caption" color="text.secondary" fontWeight={500}>
                            Total Rows
                          </Typography>
                        </Stack>
                        <Typography variant="h3" fontWeight={700} color="#0284c7">
                          {totalRows.toLocaleString()}
                        </Typography>
                      </Box>
                      
                      <Box sx={{ flex: 1 }} />
                      
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Button
                          variant="contained"
                          size="large"
                          endIcon={<ArrowForward />}
                          onClick={() => onComplete && onComplete()}
                          sx={{
                            bgcolor: '#D04A02',
                            '&:hover': { bgcolor: '#B23D01' },
                            px: 4,
                            fontWeight: 600
                          }}
                        >
                          Continue to Schema Review
                        </Button>
                      </Box>
                    </Stack>

                    {/* Progress Bar */}
                    <Box>
                      <Stack direction="row" justifyContent="space-between" mb={1}>
                        <Typography variant="caption" color="text.secondary">
                          Data Foundation Progress
                        </Typography>
                        <Typography variant="caption" fontWeight={600} color="#D04A02">
                          Step 1 of 5
                        </Typography>
                      </Stack>
                      <LinearProgress 
                        variant="determinate" 
                        value={20} 
                        sx={{ 
                          height: 8, 
                          borderRadius: 4,
                          bgcolor: '#e2e8f0',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: '#D04A02',
                            borderRadius: 4
                          }
                        }} 
                      />
                      <Stack direction="row" spacing={2} mt={1}>
                        <Chip 
                          label="Upload" 
                          size="small" 
                          sx={{ bgcolor: '#D04A02', color: 'white', fontWeight: 600 }} 
                        />
                        <Chip label="Schema" size="small" variant="outlined" />
                        <Chip label="Mapping" size="small" variant="outlined" />
                        <Chip label="Join" size="small" variant="outlined" />
                        <Chip label="Validation" size="small" variant="outlined" />
                      </Stack>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </MotionItem>
          )}

          <MotionItem>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" fontWeight={600}>
                    Uploaded Datasets
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<Refresh />}
                    onClick={loadDatasets}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>

                {loading && <LinearProgress sx={{ mb: 2 }} />}

                {datasets.length === 0 && !loading ? (
                  <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                    <CloudUpload sx={{ fontSize: 48, opacity: 0.3, mb: 2 }} />
                    <Typography variant="body2">
                      No datasets uploaded yet
                    </Typography>
                  </Box>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                          <TableCell sx={{ fontWeight: 600 }}>Dataset Name</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Rows</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Uploaded</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 600 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {datasets.map((ds) => (
                          <TableRow key={ds.id} hover>
                            <TableCell>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Description sx={{ fontSize: 16, color: '#64748b' }} />
                                <Box>
                                  <Typography variant="body2" fontWeight={500}>
                                    {ds.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                    {ds.table}
                                  </Typography>
                                </Box>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              <Chip 
                                label={ds.row_count.toLocaleString()} 
                                size="small" 
                                variant="outlined"
                                sx={{ fontWeight: 600 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(ds.uploaded_at).toLocaleString()}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={0.5} justifyContent="center">
                                <Tooltip title="Rename">
                                  <IconButton 
                                    size="small"
                                    onClick={() => openRenameDialog(ds)}
                                  >
                                    <Edit fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete">
                                  <IconButton 
                                    size="small" 
                                    color="error"
                                    onClick={() => handleDelete(ds.id)}
                                  >
                                    <Delete fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </MotionItem>
        </MotionContainer>

        <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, dataset: null, newName: '' })}>
          <DialogTitle>Rename Dataset</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Dataset Name"
              fullWidth
              value={editDialog.newName}
              onChange={(e) => setEditDialog({ ...editDialog, newName: e.target.value })}
              sx={{ mt: 2 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialog({ open: false, dataset: null, newName: '' })}>
              Cancel
            </Button>
            <Button 
              onClick={handleRename} 
              variant="contained"
              sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#B23D01' } }}
            >
              Rename
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </PageTransition>
  );
};

export default DataUploadScreen;