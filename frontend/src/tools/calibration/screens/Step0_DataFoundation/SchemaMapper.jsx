// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/SchemaMapper.jsx
// ============================================================================
/**
 * Schema Mapper - Column Mapping & Datatype Control
 * Allows users to map columns to canonical fields and override datatypes
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Alert, Button, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, Chip, IconButton, TextField, InputAdornment
} from '@mui/material';
import {
  CheckCircle, SwapHoriz, Clear, Search
} from '@mui/icons-material';
import apiClient from '@services/api';
import DatasetSelector from './components/DatasetSelector';

// Canonical AML fields
const CANONICAL_FIELDS = {
  'Transaction': ['transaction_id', 'account_id', 'transaction_date', 'transaction_amount', 'transaction_type'],
  'Account': ['account_id', 'customer_id', 'account_type', 'account_status'],
  'Customer': ['customer_id', 'customer_name', 'country', 'risk_rating'],
  'Alert': ['alert_id', 'alert_date', 'alert_type', 'alert_score']
};

const TYPE_COLORS = {
  string: { bg: '#dbeafe', color: '#1e40af' },
  numeric: { bg: '#dcfce7', color: '#15803d' },
  date: { bg: '#fef3c7', color: '#92400e' },
  boolean: { bg: '#f3e8ff', color: '#6b21a8' }
};

const SchemaMapper = ({ envId, onComplete }) => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [schema, setSchema] = useState(null);
  const [mappings, setMappings] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const loadDatasets = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setDatasets(response.datasets || []);
        if (response.datasets?.length > 0 && !selectedDataset) {
          setSelectedDataset(response.datasets[0].id);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [envId, selectedDataset]);

  const loadSchema = useCallback(async (datasetId) => {
    if (!datasetId) return;
    
    setLoading(true);
    try {
      const response = await apiClient.get(`/api/v2/calibration/data/schema/${datasetId}`, {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setSchema(response);
        
        if (!mappings[datasetId]) {
          const initialMappings = {};
          response.columns?.forEach(col => {
            initialMappings[col.name] = {
              canonicalField: null,
              datatype: col.type
            };
          });
          setMappings(prev => ({ ...prev, [datasetId]: initialMappings }));
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [envId, mappings]);

  useEffect(() => { loadDatasets(); }, [loadDatasets]);
  useEffect(() => { if (selectedDataset) loadSchema(selectedDataset); }, [selectedDataset, loadSchema]);

  const handleDatatypeChange = async (columnName, newType) => {
    try {
      const response = await apiClient.post(
        `/api/v2/calibration/data/schema/${selectedDataset}/override`,
        { env_id: envId, column_name: columnName, new_type: newType }
      );

      if (response.success) {
        setMappings(prev => ({
          ...prev,
          [selectedDataset]: {
            ...prev[selectedDataset],
            [columnName]: { ...prev[selectedDataset][columnName], datatype: newType }
          }
        }));
        await loadSchema(selectedDataset);
        setSuccess(`Updated ${columnName} to ${newType}`);
        setTimeout(() => setSuccess(null), 2000);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCanonicalMapping = (columnName, canonicalField) => {
    setMappings(prev => ({
      ...prev,
      [selectedDataset]: {
        ...prev[selectedDataset],
        [columnName]: { ...prev[selectedDataset][columnName], canonicalField: canonicalField || null }
      }
    }));
  };

  const filteredColumns = schema?.columns?.filter(col =>
    col.name.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getMappedCount = () => {
    if (!selectedDataset || !mappings[selectedDataset]) return 0;
    return Object.values(mappings[selectedDataset]).filter(m => m.canonicalField).length;
  };

  if (!datasets || datasets.length === 0) {
    return <Alert severity="warning">No datasets uploaded.</Alert>;
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3, bgcolor: '#dbeafe', borderLeft: '4px solid #3b82f6' }}>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          🗺️ Schema Mapping & Datatype Control
        </Typography>
        <Typography variant="body2">
          Map columns to canonical fields (optional) and override datatypes. Full user control.
        </Typography>
      </Alert>

      <Card sx={{ mb: 3 }} elevation={2}>
        <CardContent>
          <DatasetSelector datasets={datasets} selectedDataset={selectedDataset} onSelectDataset={setSelectedDataset} />
        </CardContent>
      </Card>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>{success}</Alert>}

      {schema && (
        <>
          <Card sx={{ mb: 3, bgcolor: '#f8fafc' }} elevation={0}>
            <CardContent>
              <Stack direction="row" spacing={4}>
                <Box>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#ea580c' }}>
                    {schema.columns?.length || 0}
                  </Typography>
                  <Typography variant="caption">Total Columns</Typography>
                </Box>
                <Box>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#3b82f6' }}>
                    {getMappedCount()}
                  </Typography>
                  <Typography variant="caption">Mapped Fields</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card elevation={2}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>Column Mapping</Typography>
              
              <TextField
                size="small"
                placeholder="Search columns..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ mb: 2, width: 300 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>
                }}
              />

              <TableContainer sx={{ maxHeight: 600 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell sx={{ fontWeight: 700 }}>Dataset Column</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Inferred Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Override Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Map to Canonical Field</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Sample Values</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredColumns.map((col) => {
                      const mapping = mappings[selectedDataset]?.[col.name] || {};
                      const typeConfig = TYPE_COLORS[col.type] || TYPE_COLORS.string;

                      return (
                        <TableRow key={col.name} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                              {col.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={col.inferred_type}
                              size="small"
                              sx={{
                                bgcolor: TYPE_COLORS[col.inferred_type]?.bg,
                                color: TYPE_COLORS[col.inferred_type]?.color,
                                fontWeight: 600,
                                fontSize: '0.7rem'
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              value={mapping.datatype || col.type}
                              onChange={(e) => handleDatatypeChange(col.name, e.target.value)}
                              sx={{ minWidth: 120 }}
                            >
                              <MenuItem value="string">String</MenuItem>
                              <MenuItem value="numeric">Numeric</MenuItem>
                              <MenuItem value="date">Date</MenuItem>
                              <MenuItem value="boolean">Boolean</MenuItem>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              value={mapping.canonicalField || ''}
                              onChange={(e) => handleCanonicalMapping(col.name, e.target.value)}
                              displayEmpty
                              sx={{ minWidth: 200 }}
                            >
                              <MenuItem value="">
                                <em>None (Keep Original)</em>
                              </MenuItem>
                              {Object.entries(CANONICAL_FIELDS).map(([category, fields]) => [
                                <MenuItem key={category} disabled sx={{ fontWeight: 700, fontSize: '0.75rem' }}>
                                  {category}
                                </MenuItem>,
                                ...fields.map(field => (
                                  <MenuItem key={field} value={field} sx={{ pl: 4 }}>
                                    {field}
                                  </MenuItem>
                                ))
                              ])}
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" sx={{ color: '#64748b', maxWidth: 150, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {col.sample_values?.join(', ') || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            {mapping.canonicalField && (
                              <IconButton size="small" onClick={() => handleCanonicalMapping(col.name, null)}>
                                <Clear fontSize="small" />
                              </IconButton>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ mt: 3, p: 2, bgcolor: '#f0fdf4', borderRadius: 1, border: '1px solid #86efac' }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <CheckCircle sx={{ color: '#10b981' }} />
                  <Typography variant="body2" fontWeight={600} sx={{ color: '#065f46', flex: 1 }}>
                    Schema mapping complete • {getMappedCount()} fields mapped
                  </Typography>
                  <Button
                    variant="contained"
                    onClick={() => onComplete && onComplete()}
                    sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' } }}
                  >
                    Continue to Merge Builder
                  </Button>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
};

export default SchemaMapper;