// frontend/src/tools/calibration/components/PercentileLadderTable.jsx
// FIXED VERSION - Handles null/undefined values properly
import React from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableRow, Paper,
  TableContainer, Box, Typography, Chip, IconButton, Tooltip
} from '@mui/material';
import { 
  TrendingDown, 
  Download as DownloadIcon,
  NavigateBefore as JumpIcon 
} from '@mui/icons-material';

/**
 * Percentile ladder with sensitivity
 * Click to jump to that percentile
 * 
 * FIXED: Properly handles null/undefined/NaN values in delta and sensitivity
 */
const PercentileLadderTable = ({ ladder = [], currentPercentile, onJumpToPercentile }) => {
  if (ladder.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Percentile ladder loading...
        </Typography>
      </Box>
    );
  }
  
  // Helper to safely check if value is valid number
  const isValidNumber = (val) => {
    return val !== null && val !== undefined && !isNaN(val) && isFinite(val);
  };
  
  const exportToCSV = () => {
    const headers = ['Percentile', 'Threshold', 'Alerts', 'Δ Alerts', 'Δ %', '% Population', 'Sensitivity'];
    const rows = ladder.map(row => [
      `p${row.percentile}`,
      row.threshold,
      row.alerts,
      isValidNumber(row.delta_alerts) ? row.delta_alerts : '-',
      isValidNumber(row.delta_pct) ? `${row.delta_pct}%` : '-',
      `${row.pct_population}%`,
      row.sensitivity?.alerts_per_1pct || '-'
    ]);
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'percentile_ladder.csv';
    a.click();
  };
  
  const getStabilityColor = (stability) => {
    switch (stability) {
      case 'STABLE': return 'success';
      case 'MODERATE': return 'warning';
      case 'SENSITIVE': return 'error';
      default: return 'default';
    }
  };
  
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight="bold">
            Percentile Ladder
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click any row to jump to that threshold
          </Typography>
        </Box>
        <Tooltip title="Export to CSV">
          <IconButton size="small" onClick={exportToCSV}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Percentile</TableCell>
              <TableCell align="right">Threshold</TableCell>
              <TableCell align="right">Alerts</TableCell>
              <TableCell align="right">
                <Tooltip title="Change from previous percentile">
                  <span>Δ Alerts</span>
                </Tooltip>
              </TableCell>
              <TableCell align="right">Δ %</TableCell>
              <TableCell align="right">% Population</TableCell>
              <TableCell align="center">
                <Tooltip title="Alerts per 1% percentile shift">
                  <span>Sensitivity</span>
                </Tooltip>
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ladder.map((row, idx) => {
              const isSelected = row.percentile === currentPercentile;
              
              // ✅ Safe value extraction with null checks
              const hasDelta = isValidNumber(row.delta_alerts);
              const hasDeltaPct = isValidNumber(row.delta_pct);
              const hasSensitivity = row.sensitivity && isValidNumber(row.sensitivity.alerts_per_1pct);
              
              return (
                <TableRow 
                  key={idx}
                  hover
                  selected={isSelected}
                  onClick={() => onJumpToPercentile && onJumpToPercentile(row.percentile)}
                  sx={{ 
                    cursor: 'pointer',
                    bgcolor: isSelected ? 'primary.50' : 'inherit',
                    '&:hover': { bgcolor: isSelected ? 'primary.100' : 'action.hover' }
                  }}
                >
                  <TableCell>
                    <Typography 
                      variant="body2" 
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      color={isSelected ? 'primary.main' : 'text.primary'}
                    >
                      p{row.percentile}
                    </Typography>
                  </TableCell>
                  
                  <TableCell align="right">
                    ₹{row.threshold?.toLocaleString() || '-'}
                  </TableCell>
                  
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {row.alerts?.toLocaleString() || '0'}
                  </TableCell>
                  
                  {/* ✅ FIXED: Delta Alerts with null check */}
                  <TableCell align="right">
                    {hasDelta ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                        {row.delta_alerts > 0 && <TrendingDown fontSize="small" color="success" />}
                        <Typography variant="body2" color="success.main">
                          {row.delta_alerts > 0 ? '-' : ''}
                          {Math.abs(row.delta_alerts).toLocaleString()}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  {/* ✅ FIXED: Delta % with null check */}
                  <TableCell align="right">
                    {hasDeltaPct ? (
                      <Typography variant="body2" color="success.main">
                        {row.delta_pct > 0 ? '-' : ''}
                        {Math.abs(row.delta_pct).toFixed(1)}%
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell align="right">
                    {isValidNumber(row.pct_population) ? `${row.pct_population}%` : '—'}
                  </TableCell>
                  
                  {/* ✅ FIXED: Sensitivity with null check */}
                  <TableCell align="center">
                    {hasSensitivity ? (
                      <Tooltip title={`Stability: ${row.sensitivity.stability || 'UNKNOWN'}`}>
                        <Chip
                          label={`±${row.sensitivity.alerts_per_1pct}`}
                          size="small"
                          color={getStabilityColor(row.sensitivity.stability)}
                          variant="outlined"
                          sx={{ fontSize: '0.7rem', height: 22 }}
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  
                  <TableCell>
                    {!isSelected && (
                      <Tooltip title="Jump to this threshold">
                        <IconButton size="small">
                          <JumpIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      
      <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'info.50', borderRadius: 1 }}>
        <Typography variant="caption" color="info.dark">
          <strong>How to read this:</strong> Each row shows what happens at that percentile cut. 
          "Δ Alerts" shows how many alerts you'd <em>drop</em> by moving to the next higher percentile. 
          Sensitivity shows how stable that threshold is—lower numbers mean small percentile changes won't drastically change alert counts.
        </Typography>
      </Box>
    </Box>
  );
};

export default PercentileLadderTable;