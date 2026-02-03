// frontend/src/tools/calibration/components/DistributionTable.jsx
// PwC Professional Design

import React, { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableRow, Paper,
  TableContainer, Box, Typography, IconButton, Tooltip, TableSortLabel
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  errorLight: '#FFF5F5'
};

const DistributionTable = ({ bins = [], threshold }) => {
  const [orderBy, setOrderBy] = useState('bin_start');
  const [order, setOrder] = useState('asc');
  
  if (bins.length === 0) {
    return (
      <Box 
        sx={{ 
          p: 4, 
          textAlign: 'center', 
          bgcolor: '#FAFAFA', 
          borderRadius: 1,
          border: `1px solid ${PWC_COLORS.lightGray}`
        }}
      >
        <Typography 
          variant="caption" 
          sx={{ 
            color: PWC_COLORS.mediumGray,
            fontSize: '0.813rem'
          }}
        >
          Distribution table will appear here
        </Typography>
      </Box>
    );
  }
  
  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };
  
  const sortedBins = [...bins].sort((a, b) => {
    const aVal = a[orderBy];
    const bVal = b[orderBy];
    
    if (order === 'asc') {
      return aVal < bVal ? -1 : 1;
    } else {
      return aVal > bVal ? -1 : 1;
    }
  });
  
  const exportToCSV = () => {
    const headers = ['Value Range', 'Entity Count', '% Population', 'Cumulative %', 'Status'];
    const rows = bins.map(bin => {
      const entityCount = bin.entity_count ?? bin.count ?? 0;
      const pctPop = bin.pct_population ?? bin.percentage ?? 0;
      
      return [
        bin.range || `₹${bin.bin_start?.toLocaleString()} - ₹${bin.bin_end?.toLocaleString()}`,
        entityCount,
        pctPop,
        bin.cumulative_pct || 0,
        bin.is_above_threshold ? 'Alert' : 'Suppressed'
      ];
    });
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'distribution_table.csv';
    a.click();
  };
  
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography 
          variant="subtitle2" 
          fontWeight={600}
          sx={{ 
            color: PWC_COLORS.darkGray,
            fontSize: '0.938rem'
          }}
        >
          Distribution Table ({bins.length} bins)
        </Typography>
        <Tooltip title="Export to CSV">
          <IconButton 
            size="small" 
            onClick={exportToCSV}
            sx={{ color: PWC_COLORS.mediumGray }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      
      <TableContainer 
        component={Paper} 
        variant="outlined" 
        sx={{ 
          maxHeight: 400,
          border: `1px solid ${PWC_COLORS.lightGray}`,
          boxShadow: 'none'
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  bgcolor: '#FAFAFA',
                  fontWeight: 600,
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                <TableSortLabel
                  active={orderBy === 'bin_start'}
                  direction={orderBy === 'bin_start' ? order : 'asc'}
                  onClick={() => handleSort('bin_start')}
                  sx={{
                    '& .MuiTableSortLabel-icon': {
                      color: `${PWC_COLORS.orange} !important`
                    }
                  }}
                >
                  Value Range
                </TableSortLabel>
              </TableCell>
              <TableCell 
                align="right"
                sx={{
                  bgcolor: '#FAFAFA',
                  fontWeight: 600,
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                <TableSortLabel
                  active={orderBy === 'entity_count' || orderBy === 'count'}
                  direction={(orderBy === 'entity_count' || orderBy === 'count') ? order : 'asc'}
                  onClick={() => handleSort('entity_count')}
                  sx={{
                    '& .MuiTableSortLabel-icon': {
                      color: `${PWC_COLORS.orange} !important`
                    }
                  }}
                >
                  Entity Count
                </TableSortLabel>
              </TableCell>
              <TableCell 
                align="right"
                sx={{
                  bgcolor: '#FAFAFA',
                  fontWeight: 600,
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                <TableSortLabel
                  active={orderBy === 'pct_population' || orderBy === 'percentage'}
                  direction={(orderBy === 'pct_population' || orderBy === 'percentage') ? order : 'asc'}
                  onClick={() => handleSort('pct_population')}
                  sx={{
                    '& .MuiTableSortLabel-icon': {
                      color: `${PWC_COLORS.orange} !important`
                    }
                  }}
                >
                  % Population
                </TableSortLabel>
              </TableCell>
              <TableCell 
                align="right"
                sx={{
                  bgcolor: '#FAFAFA',
                  fontWeight: 600,
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                <TableSortLabel
                  active={orderBy === 'cumulative_pct'}
                  direction={orderBy === 'cumulative_pct' ? order : 'asc'}
                  onClick={() => handleSort('cumulative_pct')}
                  sx={{
                    '& .MuiTableSortLabel-icon': {
                      color: `${PWC_COLORS.orange} !important`
                    }
                  }}
                >
                  Cumulative %
                </TableSortLabel>
              </TableCell>
              <TableCell 
                align="center"
                sx={{
                  bgcolor: '#FAFAFA',
                  fontWeight: 600,
                  fontSize: '0.813rem',
                  color: PWC_COLORS.darkGray,
                  borderBottom: `1px solid ${PWC_COLORS.lightGray}`
                }}
              >
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedBins.map((bin, idx) => {
              const entityCount = bin.entity_count ?? bin.count ?? 0;
              const pctPopulation = bin.pct_population ?? bin.percentage ?? 0;
              const cumulativePct = bin.cumulative_pct ?? 0;
              const range = bin.range || `₹${bin.bin_start?.toLocaleString() ?? 'N/A'} - ₹${bin.bin_end?.toLocaleString() ?? 'N/A'}`;
              const isAboveThreshold = bin.is_above_threshold ?? false;
              
              return (
                <TableRow 
                  key={idx}
                  sx={{
                    bgcolor: isAboveThreshold ? PWC_COLORS.errorLight : PWC_COLORS.white,
                    '&:hover': { 
                      bgcolor: isAboveThreshold ? '#FFEAEA' : '#FAFAFA'
                    }
                  }}
                >
                  <TableCell 
                    sx={{ 
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {range}
                  </TableCell>
                  <TableCell 
                    align="right" 
                    sx={{ 
                      fontWeight: entityCount > 1000 ? 600 : 400,
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {entityCount.toLocaleString()}
                  </TableCell>
                  <TableCell 
                    align="right"
                    sx={{ 
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {pctPopulation}%
                  </TableCell>
                  <TableCell 
                    align="right"
                    sx={{ 
                      fontSize: '0.813rem',
                      color: PWC_COLORS.darkGray
                    }}
                  >
                    {cumulativePct}%
                  </TableCell>
                  <TableCell align="center">
                    {isAboveThreshold ? (
                      <Typography 
                        variant="caption" 
                        fontWeight={600}
                        sx={{ 
                          color: PWC_COLORS.error,
                          fontSize: '0.813rem'
                        }}
                      >
                        Alert
                      </Typography>
                    ) : (
                      <Typography 
                        variant="caption"
                        sx={{ 
                          color: PWC_COLORS.mediumGray,
                          fontSize: '0.813rem'
                        }}
                      >
                        Suppressed
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      
      <Box sx={{ mt: 1.5 }}>
        <Typography 
          variant="caption" 
          sx={{ 
            color: PWC_COLORS.mediumGray,
            fontSize: '0.813rem'
          }}
        >
          Rows highlighted in red are above the threshold and will generate alerts
        </Typography>
      </Box>
    </Box>
  );
};

export default DistributionTable;