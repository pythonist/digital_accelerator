// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/SQLJoinEditor.jsx
// ============================================================================
/**
 * SQL Join Editor - Advanced Mode
 * Allows users to write custom SQL joins for complete control
 */
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Alert, Stack,
  TextField, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Accordion, AccordionSummary, AccordionDetails,
  List, ListItem, ListItemText, Divider, Paper
} from '@mui/material';
import {
  PlayArrow, Code, ExpandMore, Info, CheckCircle, Warning, Lightbulb
} from '@mui/icons-material';
import apiClient from '@services/api';

const SQLJoinEditor = ({ envId, onComplete, onSwitchToBuilder }) => {
  const [sql, setSql] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [validation, setValidation] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [availableTables, setAvailableTables] = useState([]);

  useEffect(() => {
    loadAvailableTables();
  }, [envId]);

  const loadAvailableTables = async () => {
    try {
      const response = await apiClient.get('/api/v2/calibration/data/datasets', {
        params: { env_id: envId }
      });
      
      if (response.success) {
        setAvailableTables(response.datasets || []);
        
        // Generate template SQL
        if (response.datasets && response.datasets.length > 1) {
          const template = generateTemplateSql(response.datasets);
          setSql(template);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const generateTemplateSql = (datasets) => {
    if (datasets.length < 2) return '';
    
    const base = datasets[0];
    const join = datasets[1];
    
    return `-- Example SQL Join
-- Available tables: ${datasets.map(d => d.table).join(', ')}

SELECT 
  *
FROM "${base.table}" AS base
LEFT JOIN "${join.table}" AS t1
  ON base.column_name = t1.column_name
LIMIT 100;`;
  };

  const handleValidate = async () => {
    if (!sql.trim()) {
      setError('Please enter SQL query');
      return;
    }

    setValidation(null);
    setError(null);

    try {
      const response = await apiClient.post('/api/v2/calibration/data/sql/validate', {
        env_id: envId,
        sql: sql
      });

      setValidation(response);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExecute = async () => {
    if (!sql.trim()) {
      setError('Please enter SQL query');
      return;
    }

    setExecuting(true);
    setError(null);
    setPreviewData(null);

    try {
      const response = await apiClient.post('/api/v2/calibration/data/sql/execute', {
        env_id: envId,
        sql: sql,
        limit: 100
      });

      if (response.success) {
        setPreviewData(response);
      } else {
        setError(response.error || 'Execution failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleInsertTable = (tableName) => {
    const cursorPos = document.getElementById('sql-editor')?.selectionStart || sql.length;
    const before = sql.substring(0, cursorPos);
    const after = sql.substring(cursorPos);
    setSql(`${before}"${tableName}"${after}`);
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3, bgcolor: '#dbeafe', borderLeft: '4px solid #3b82f6' }}>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          💻 SQL Join Editor - Advanced Mode
        </Typography>
        <Typography variant="body2">
          Write custom SQL queries to join your datasets. Preview-only execution - no tables created.
          Not comfortable with SQL? <Button size="small" onClick={onSwitchToBuilder}>Switch to Visual Builder</Button>
        </Typography>
      </Alert>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        {/* SQL Editor */}
        <Card sx={{ flex: 2 }} elevation={2}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Code /> SQL Query Editor
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleValidate}
                  startIcon={<CheckCircle />}
                  sx={{ borderColor: '#cbd5e1' }}
                >
                  Validate
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleExecute}
                  disabled={executing}
                  startIcon={<PlayArrow />}
                  sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' } }}
                >
                  {executing ? 'Executing...' : 'Execute & Preview'}
                </Button>
              </Stack>
            </Box>

            <TextField
              id="sql-editor"
              multiline
              rows={15}
              fullWidth
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="Enter your SQL query here..."
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  lineHeight: 1.6
                }
              }}
            />

            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ mr: 1, alignSelf: 'center', color: 'text.secondary' }}>
                Quick Insert:
              </Typography>
              {availableTables.map(table => (
                <Chip
                  key={table.id}
                  label={table.table}
                  size="small"
                  onClick={() => handleInsertTable(table.table)}
                  sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem' }}
                />
              ))}
            </Box>
          </CardContent>
        </Card>

        {/* Reference Panel */}
        <Card sx={{ flex: 1, maxHeight: 600, overflow: 'auto' }} elevation={2}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Available Tables
            </Typography>
            
            <List dense>
              {availableTables.map((table, index) => (
                <React.Fragment key={table.id}>
                  <ListItem>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                          {table.table}
                        </Typography>
                      }
                      secondary={
                        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                          <Typography variant="caption">
                            Dataset: {table.name}
                          </Typography>
                          <Typography variant="caption">
                            Rows: {table.row_count.toLocaleString()}
                          </Typography>
                        </Stack>
                      }
                    />
                  </ListItem>
                  {index < availableTables.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              SQL Guidelines
            </Typography>
            <List dense>
              <ListItem>
                <ListItemText 
                  primary="✅ Use SELECT only"
                  primaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
              <ListItem>
                <ListItemText 
                  primary='✅ Quote table names: "table_name"'
                  primaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
              <ListItem>
                <ListItemText 
                  primary="✅ Add LIMIT for large results"
                  primaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
              <ListItem>
                <ListItemText 
                  primary="❌ No CREATE, DROP, INSERT"
                  primaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            </List>
          </CardContent>
        </Card>
      </Stack>

      {/* Validation Results */}
      {validation && (
        <Card sx={{ mb: 3 }} elevation={2}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckCircle sx={{ color: validation.valid ? '#10b981' : '#ef4444' }} />
              Validation {validation.valid ? 'Passed' : 'Failed'}
            </Typography>

            {validation.warnings && validation.warnings.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" fontWeight={700}>Warnings:</Typography>
                <List dense>
                  {validation.warnings.map((warning, i) => (
                    <ListItem key={i}>
                      <ListItemText primary={`• ${warning}`} />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}

            {validation.suggestions && validation.suggestions.length > 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Lightbulb fontSize="small" /> Suggestions:
                </Typography>
                <List dense>
                  {validation.suggestions.map((suggestion, i) => (
                    <ListItem key={i}>
                      <ListItemText primary={`• ${suggestion}`} />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Preview Results */}
      {previewData && (
        <Card elevation={2}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Preview Results
            </Typography>
            
            {previewData.warnings && previewData.warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {previewData.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            <Box sx={{ mb: 2 }}>
              <Chip label={`${previewData.metrics?.total_rows || 0} rows`} size="small" sx={{ mr: 1 }} />
              <Chip label={`${previewData.metrics?.total_columns || 0} columns`} size="small" />
            </Box>

            <TableContainer sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {previewData.columns?.map(col => (
                      <TableCell key={col} sx={{ bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.75rem' }}>
                        {col}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewData.data?.slice(0, 50).map((row, i) => (
                    <TableRow key={i} hover>
                      {previewData.columns?.map(col => (
                        <TableCell key={col} sx={{ fontSize: '0.75rem' }}>
                          {row[col] !== null ? String(row[col]) : '—'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ mt: 3, textAlign: 'right' }}>
              <Button
                variant="contained"
                onClick={() => onComplete && onComplete(previewData)}
                sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' } }}
              >
                Confirm SQL Join
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default SQLJoinEditor;