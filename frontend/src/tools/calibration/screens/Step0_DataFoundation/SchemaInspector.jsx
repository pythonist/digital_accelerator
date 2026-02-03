// frontend/tools/calibration/screens/Step0_DataFoundation/SchemaInspector.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Alert, Button, Stack, 
  Tabs, Tab, Chip, IconButton, Select, MenuItem
} from '@mui/material';
import { CheckCircle, ArrowForward, Refresh } from '@mui/icons-material';
import apiClient from '@services/api';
import { PageTransition, MotionContainer, MotionItem } from '@components/MotionWrappers/MotionWrappers';
import DataTypeOverridePanel from './components/DataTypeOverridePanel';

const SchemaInspector = ({ envId, onComplete }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [schemas, setSchemas] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmedDatasets, setConfirmedDatasets] = useState(new Set());

  const loadDatasets = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      if (response.success) {
        const datasetList = response.datasets || [];
        setDatasets(datasetList);
        
        if (datasetList.length > 0 && !selectedDataset) {
          setSelectedDataset(datasetList[0].id);
        }

        await loadAllSchemas(datasetList);
      }
    } catch (err) {
      setError(err.message);
    }
  }, [envId, selectedDataset]);

  const loadAllSchemas = async (datasetList) => {
    setLoading(true);
    const schemaMap = {};

    for (const dataset of datasetList) {
      try {
        const response = await apiClient.get(`/api/v2/calibration/data/schema/${dataset.id}`, {
          params: { env_id: envId }
        });
        
        if (response.success) {
          schemaMap[dataset.id] = response;
        }
      } catch (err) {
        console.error(`Failed to load schema for ${dataset.id}:`, err);
      }
    }

    setSchemas(schemaMap);
    setLoading(false);
  };

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const handleTypeOverride = async (columnName, newType) => {
    if (!selectedDataset) return;

    try {
      const response = await apiClient.post(
        `/api/v2/calibration/data/schema/${selectedDataset}/override`,
        {
          env_id: envId,
          column_name: columnName,
          new_type: newType
        }
      );

      if (response.success) {
        const schemaResponse = await apiClient.get(
          `/api/v2/calibration/data/schema/${selectedDataset}`,
          { params: { env_id: envId } }
        );
        
        if (schemaResponse.success) {
          setSchemas(prev => ({
            ...prev,
            [selectedDataset]: schemaResponse
          }));
        }
      } else {
        setError(response.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetOverrides = async () => {
    if (!window.confirm('Reset all type overrides to inferred types?')) return;
    if (!selectedDataset) return;

    try {
      const response = await apiClient.post(
        `/api/v2/calibration/data/schema/${selectedDataset}/reset`
      );

      if (response.success) {
        const schemaResponse = await apiClient.get(
          `/api/v2/calibration/data/schema/${selectedDataset}`,
          { params: { env_id: envId } }
        );
        
        if (schemaResponse.success) {
          setSchemas(prev => ({
            ...prev,
            [selectedDataset]: schemaResponse
          }));
        }
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmDataset = () => {
    if (selectedDataset) {
      setConfirmedDatasets(prev => new Set([...prev, selectedDataset]));
      
      const nextDataset = datasets.find(d => 
        d.id !== selectedDataset && !confirmedDatasets.has(d.id)
      );
      
      if (nextDataset) {
        setSelectedDataset(nextDataset.id);
      }
    }
  };

  const allConfirmed = datasets.length > 0 && datasets.every(d => confirmedDatasets.has(d.id));
  const currentSchema = selectedDataset ? schemas[selectedDataset] : null;
  
  const totalColumns = Object.values(schemas).reduce((sum, schema) => {
    return sum + (schema?.columns?.length || 0);
  }, 0);

  if (!datasets || datasets.length === 0) {
    return (
      <Alert severity="warning" variant="outlined">
        No datasets uploaded. Please upload at least one CSV file first.
      </Alert>
    );
  }

  return (
    <PageTransition>
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <MotionContainer>
          <MotionItem>
            <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
              <Typography variant="subtitle2" fontWeight={500} gutterBottom>
                Schema Review & Type Validation
              </Typography>
              <Typography variant="body2">
                Review inferred datatypes for each dataset. Override types if needed.
              </Typography>
            </Alert>
          </MotionItem>

          <MotionItem>
            <Card sx={{ bgcolor: '#fafafa', border: '1px solid #e0e0e0' }} elevation={0}>
              <CardContent>
                <Stack direction="row" spacing={4}>
                  <Box>
                    <Typography variant="h4" fontWeight={600} color="primary">
                      {datasets.length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Datasets
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600} color="primary">
                      {totalColumns}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Total Columns
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={600} color="primary">
                      {confirmedDatasets.size}/{datasets.length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Confirmed
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </MotionItem>

          <MotionItem>
            <Card elevation={0} sx={{ border: '1px solid #e0e0e0' }}>
              <Tabs 
                value={selectedDataset || false}
                onChange={(e, newValue) => setSelectedDataset(newValue)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ borderBottom: '1px solid #e0e0e0' }}
              >
                {datasets.map(ds => (
                  <Tab 
                    key={ds.id} 
                    value={ds.id}
                    label={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2">{ds.name}</Typography>
                        {confirmedDatasets.has(ds.id) && (
                          <CheckCircle sx={{ fontSize: 16, color: '#2e7d32' }} />
                        )}
                      </Stack>
                    }
                  />
                ))}
              </Tabs>
            </Card>
          </MotionItem>

          {error && (
            <MotionItem>
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            </MotionItem>
          )}

          {currentSchema && (
            <MotionItem>
              <DataTypeOverridePanel
                schema={currentSchema}
                onTypeOverride={handleTypeOverride}
                onResetAll={handleResetOverrides}
              />

              {!confirmedDatasets.has(selectedDataset) && (
                <Box sx={{ mt: 2, textAlign: 'right' }}>
                  <Button
                    variant="contained"
                    onClick={handleConfirmDataset}
                    startIcon={<CheckCircle />}
                  >
                    Confirm Schema for {datasets.find(d => d.id === selectedDataset)?.name}
                  </Button>
                </Box>
              )}
            </MotionItem>
          )}

          {allConfirmed && (
            <MotionItem>
              <Card sx={{ bgcolor: '#f1f8f4', border: '1px solid #c8e6c9' }} elevation={0}>
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <CheckCircle sx={{ color: '#2e7d32', fontSize: 32 }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2" fontWeight={500} sx={{ color: '#1b5e20' }}>
                        All Schemas Confirmed
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {totalColumns} columns across {datasets.length} dataset{datasets.length > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      size="large"
                      endIcon={<ArrowForward />}
                      onClick={() => onComplete && onComplete()}
                    >
                      Continue to Mapping
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </MotionItem>
          )}
        </MotionContainer>
      </Box>
    </PageTransition>
  );
};

export default SchemaInspector;