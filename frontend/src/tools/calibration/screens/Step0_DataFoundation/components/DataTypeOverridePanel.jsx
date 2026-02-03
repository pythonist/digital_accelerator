// ============================================================================
// COMPONENT 2: DataTypeOverridePanel.jsx
// ============================================================================
import React, { useState } from 'react';
import {
  Card, CardContent, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Select, MenuItem, Chip, Box, Typography,
  Button, IconButton, Tooltip
} from '@mui/material';
import { Refresh, Info } from '@mui/icons-material';

const TYPE_COLORS = {
  string: { bg: '#dbeafe', color: '#1e40af' },
  numeric: { bg: '#dcfce7', color: '#15803d' },
  date: { bg: '#fef3c7', color: '#92400e' },
  boolean: { bg: '#f3e8ff', color: '#6b21a8' }
};

export const DataTypeOverridePanel = ({ schema, onTypeOverride, onResetAll }) => {
  const [editingColumn, setEditingColumn] = useState(null);

  const handleTypeChange = (columnName, newType) => {
    onTypeOverride(columnName, newType);
    setEditingColumn(null);
  };

  return (
    <Card elevation={2}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a' }}>
            Column Schema
          </Typography>
          <Button
            size="small"
            startIcon={<Refresh />}
            onClick={onResetAll}
            sx={{ color: '#64748b' }}
          >
            Reset All Overrides
          </Button>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f8fafc' }}>
                <TableCell sx={{ fontWeight: 700 }}>Column Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Inferred Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Effective Type</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Nulls %</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Unique %</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Sample Values</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {schema.columns?.map((col) => {
                const typeConfig = TYPE_COLORS[col.type] || TYPE_COLORS.string;
                const hasOverride = col.user_override !== null;

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
                      {editingColumn === col.name ? (
                        <Select
                          size="small"
                          value={col.type}
                          onChange={(e) => handleTypeChange(col.name, e.target.value)}
                          autoFocus
                          onBlur={() => setEditingColumn(null)}
                          sx={{ minWidth: 120 }}
                        >
                          <MenuItem value="string">String</MenuItem>
                          <MenuItem value="numeric">Numeric</MenuItem>
                          <MenuItem value="date">Date</MenuItem>
                          <MenuItem value="boolean">Boolean</MenuItem>
                        </Select>
                      ) : (
                        <Box 
                          onClick={() => setEditingColumn(col.name)}
                          sx={{ cursor: 'pointer', display: 'inline-block' }}
                        >
                          <Chip
                            label={col.type}
                            size="small"
                            icon={hasOverride ? <Info fontSize="small" /> : undefined}
                            sx={{
                              bgcolor: hasOverride ? '#fed7aa' : typeConfig.bg,
                              color: hasOverride ? '#9a3412' : typeConfig.color,
                              fontWeight: 700,
                              fontSize: '0.7rem',
                              border: hasOverride ? '2px solid #ea580c' : 'none'
                            }}
                          />
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {col.null_pct?.toFixed(1)}%
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {col.unique_pct?.toFixed(1)}%
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: '#64748b',
                          maxWidth: 200,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {col.sample_values?.join(', ') || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};
export default DataTypeOverridePanel;