// frontend/src/tools/calibration/components/AlertPopulationTable.jsx
// PwC Professional Design

import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, Stack
} from '@mui/material';
import { Download } from '@mui/icons-material';
import apiClient from '@services/api';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  errorLight: '#FFF5F5',
  success: '#107C41',
  warning: '#F7941E'
};

const AlertPopulationTable = ({ runId, threshold, metric = 'amount' }) => {
  const [category, setCategory] = useState('alerted');
  const [data, setData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (runId && threshold) {
      loadPopulation();
    }
  }, [runId, threshold, category, page, rowsPerPage]);

  const loadPopulation = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        threshold: threshold.toString(),
        metric: metric,
        category: category,
        limit: rowsPerPage.toString(),
        offset: (page * rowsPerPage).toString()
      });
      
      const url = `/api/v2/calibration/percentile/${runId}/alert-population?${queryParams.toString()}`;
      
      const res = await apiClient.get(url);

      setData(res.records || []);
      setTotalCount(res.total_count || 0);
    } catch (err) {
      console.error('Failed to load population:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (newCategory) => {
    setCategory(newCategory);
    setPage(0);
  };

  const handleExport = () => {
    const headers = ['Account ID', 'Customer ID', 'Value', 'Distance from Threshold', 'Distance %', 'Category'];
    const rows = data.map(row => [
      row.account_id,
      row.customer_id,
      row.value,
      row.distance_from_threshold,
      row.distance_pct,
      row.category
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calibration_population_${category}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <Paper 
      variant="outlined" 
      sx={{ 
        p: 0, 
        overflow: 'hidden',
        border: `1px solid ${PWC_COLORS.lightGray}`,
        boxShadow: 'none'
      }}
    >
      {/* Header */}
      <Box 
        sx={{ 
          p: 2.5, 
          bgcolor: '#FAFAFA', 
          borderBottom: `1px solid ${PWC_COLORS.lightGray}`
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography 
              variant="subtitle2" 
              sx={{ 
                fontWeight: 600, 
                mb: 0.5,
                color: PWC_COLORS.darkGray,
                fontSize: '0.938rem'
              }}
            >
              Alert Population
            </Typography>
            <Typography 
              variant="caption" 
              sx={{ 
                color: PWC_COLORS.mediumGray,
                fontSize: '0.813rem'
              }}
            >
              Entity-level breakdown by threshold status
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Download sx={{ fontSize: '1rem' }} />}
            onClick={handleExport}
            disabled={data.length === 0}
            sx={{ 
              textTransform: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: PWC_COLORS.orange,
              borderColor: PWC_COLORS.orange,
              '&:hover': {
                borderColor: PWC_COLORS.orange,
                bgcolor: '#FFF5F0'
              },
              '&:disabled': {
                color: PWC_COLORS.mediumGray,
                borderColor: PWC_COLORS.lightGray
              }
            }}
          >
            Export
          </Button>
        </Stack>

        {/* Category Toggle */}
        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          {['alerted', 'suppressed', 'near_miss'].map((cat) => (
            <Button
              key={cat}
              variant={category === cat ? 'contained' : 'outlined'}
              size="small"
              onClick={() => handleCategoryChange(cat)}
              sx={{
                textTransform: 'none',
                fontSize: '0.813rem',
                fontWeight: 500,
                px: 2,
                bgcolor: category === cat ? (
                  cat === 'alerted' ? PWC_COLORS.error :
                  cat === 'near_miss' ? PWC_COLORS.warning : PWC_COLORS.mediumGray
                ) : 'transparent',
                color: category === cat ? PWC_COLORS.white : PWC_COLORS.mediumGray,
                borderColor: cat === 'alerted' ? PWC_COLORS.error :
                             cat === 'near_miss' ? PWC_COLORS.warning : PWC_COLORS.mediumGray,
                '&:hover': {
                  bgcolor: category === cat ? (
                    cat === 'alerted' ? '#A62319' :
                    cat === 'near_miss' ? '#E08519' : '#45484C'
                  ) : '#FAFAFA',
                  borderColor: cat === 'alerted' ? PWC_COLORS.error :
                               cat === 'near_miss' ? PWC_COLORS.warning : PWC_COLORS.mediumGray
                }
              }}
            >
              {cat === 'alerted' ? 'Alerted' : cat === 'near_miss' ? 'Near Miss' : 'Suppressed'}
            </Button>
          ))}
        </Stack>
      </Box>

      {/* Table */}
      <TableContainer sx={{ maxHeight: 400 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell 
                sx={{ 
                  fontWeight: 600, 
                  bgcolor: '#FAFAFA',
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Account ID
              </TableCell>
              <TableCell 
                sx={{ 
                  fontWeight: 600, 
                  bgcolor: '#FAFAFA',
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Customer ID
              </TableCell>
              <TableCell 
                align="right" 
                sx={{ 
                  fontWeight: 600, 
                  bgcolor: '#FAFAFA',
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Value
              </TableCell>
              <TableCell 
                align="right" 
                sx={{ 
                  fontWeight: 600, 
                  bgcolor: '#FAFAFA',
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Distance
              </TableCell>
              <TableCell 
                align="right" 
                sx={{ 
                  fontWeight: 600, 
                  bgcolor: '#FAFAFA',
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Distance %
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell 
                  colSpan={5} 
                  align="center" 
                  sx={{ py: 4 }}
                >
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: PWC_COLORS.mediumGray,
                      fontSize: '0.875rem'
                    }}
                  >
                    Loading...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell 
                  colSpan={5} 
                  align="center" 
                  sx={{ py: 4 }}
                >
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: PWC_COLORS.mediumGray,
                      fontSize: '0.875rem'
                    }}
                  >
                    No entities in this category
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow 
                  key={idx} 
                  hover
                  sx={{
                    '&:hover': {
                      bgcolor: '#FAFAFA'
                    }
                  }}
                >
                  <TableCell 
                    sx={{ 
                      fontFamily: 'Consolas, Monaco, monospace', 
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {row.account_id}
                  </TableCell>
                  <TableCell 
                    sx={{ 
                      fontFamily: 'Consolas, Monaco, monospace', 
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {row.customer_id}
                  </TableCell>
                  <TableCell 
                    align="right" 
                    sx={{ 
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    ₹{row.value?.toLocaleString()}
                  </TableCell>
                  <TableCell 
                    align="right" 
                    sx={{
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: '0.813rem',
                      color: row.distance_from_threshold >= 0 ? PWC_COLORS.error : PWC_COLORS.mediumGray
                    }}
                  >
                    {row.distance_from_threshold >= 0 ? '+' : ''}₹{row.distance_from_threshold?.toLocaleString()}
                  </TableCell>
                  <TableCell 
                    align="right" 
                    sx={{
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: '0.813rem',
                      color: row.distance_pct >= 0 ? PWC_COLORS.error : PWC_COLORS.mediumGray,
                      fontWeight: Math.abs(row.distance_pct) > 10 ? 600 : 400
                    }}
                  >
                    {row.distance_pct >= 0 ? '+' : ''}{row.distance_pct}%
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      <TablePagination
        component="div"
        count={totalCount}
        page={page}
        onPageChange={(e, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
        sx={{
          borderTop: `1px solid ${PWC_COLORS.lightGray}`,
          '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
            fontSize: '0.813rem',
            color: PWC_COLORS.mediumGray
          },
          '& .MuiTablePagination-select': {
            fontSize: '0.813rem',
            color: PWC_COLORS.darkGray
          }
        }}
      />

      {/* Footer Help */}
      <Box 
        sx={{ 
          p: 2, 
          bgcolor: '#FAFAFA', 
          borderTop: `1px solid ${PWC_COLORS.lightGray}`
        }}
      >
        <Typography 
          variant="caption" 
          sx={{ 
            color: PWC_COLORS.mediumGray,
            fontSize: '0.813rem',
            lineHeight: 1.6
          }}
        >
          <strong>Alert Defense:</strong> This table shows the exact entities that will be alerted.
          Distance shows how far each entity is from the threshold (positive = above threshold).
        </Typography>
      </Box>
    </Paper>
  );
};

export default AlertPopulationTable;