// frontend/src/tools/calibration/components/HistogramChart.jsx
import React from 'react';
import { Box, Typography, Stack } from '@mui/material';

/**
 * Pure SVG histogram implementation
 * Shows distribution, threshold line, and near-miss band
 */
const HistogramChart = ({ data, threshold, nearMissRange = 0.1, logScale = false }) => {
  if (!data || data.length === 0) {
    return (
      <Box sx={{ 
        height: 220, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        bgcolor: 'grey.50',
        borderRadius: 1
      }}>
        <Typography variant="caption" color="text.secondary">
          Loading Distribution...
        </Typography>
      </Box>
    );
  }

  const height = 220;
  const width = 1000;
  
  // Apply log scale if enabled
  const counts = data.map(d => d.count);
  const transformedCounts = logScale 
    ? counts.map(c => c > 0 ? Math.log10(c + 1) : 0)
    : counts;
  
  const maxCount = Math.max(...transformedCounts);
  const maxVal = data[data.length - 1].bin_end;
  const barWidth = width / data.length;

  // X Scale helper
  const getX = (val) => Math.min(width, Math.max(0, (val / maxVal) * width));
  
  const thresholdX = getX(threshold);
  const nearMissVal = threshold * (1 - nearMissRange);
  const nearMissX = getX(nearMissVal);

  return (
    <Box sx={{ width: '100%', position: 'relative', mb: 1 }}>
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        style={{ width: '100%', height: height, overflow: 'visible' }}
      >
        
        {/* Near Miss Band (Shaded) */}
        <rect 
          x={nearMissX} 
          y={0} 
          width={Math.max(0, thresholdX - nearMissX)} 
          height={height} 
          fill="#fff3e0" 
          opacity={0.6} 
        />

        {/* Bars */}
        {data.map((bin, i) => {
          const originalCount = bin.count;
          const transformedCount = logScale 
            ? (originalCount > 0 ? Math.log10(originalCount + 1) : 0)
            : originalCount;
          
          const h = (transformedCount / maxCount) * (height - 30);
          const isAlert = bin.bin_start >= threshold;
          const isNearMiss = !isAlert && bin.bin_end >= nearMissVal;
          
          return (
            <g key={i}>
              <rect
                x={i * barWidth}
                y={height - h - 20}
                width={Math.max(0, barWidth - 1)}
                height={h}
                fill={isAlert ? "#ef5350" : isNearMiss ? "#ff9800" : "#e0e0e0"}
                rx={2}
              />
              {/* Tooltip on hover - show original count */}
              <title>
                {`₹${bin.bin_start.toLocaleString()} - ₹${bin.bin_end.toLocaleString()}\nCount: ${originalCount.toLocaleString()}\n${bin.pct_of_total}% of population`}
              </title>
            </g>
          );
        })}

        {/* Threshold Line */}
        <line 
          x1={thresholdX} 
          y1={-10} 
          x2={thresholdX} 
          y2={height} 
          stroke="#d32f2f" 
          strokeWidth="2" 
          strokeDasharray="5,5" 
        />
        
        {/* Labels */}
        <text 
          x={thresholdX} 
          y={-15} 
          textAnchor="middle" 
          fill="#d32f2f" 
          fontSize="14" 
          fontWeight="bold"
        >
          ₹{threshold.toLocaleString()}
        </text>
        
        <text x={0} y={height} fill="#9e9e9e" fontSize="12">
          ₹0
        </text>
        <text x={width} y={height} textAnchor="end" fill="#9e9e9e" fontSize="12">
          ₹{maxVal.toLocaleString(undefined, {notation: 'compact'})}
        </text>
      </svg>
      
      {/* Legend */}
      <Stack direction="row" spacing={3} justifyContent="center" mt={1}>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#e0e0e0', borderRadius: 1 }} />
          <Typography variant="caption">Suppressed</Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#ff9800', borderRadius: 1 }} />
          <Typography variant="caption">Near Miss ({nearMissRange * 100}%)</Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#ef5350', borderRadius: 1 }} />
          <Typography variant="caption" color="error.main" fontWeight="bold">
            Alerts
          </Typography>
        </Box>
      </Stack>
      
      {logScale && (
        <Box sx={{ mt: 1, textAlign: 'center' }}>
          <Typography variant="caption" color="warning.main">
            ⚠️ Log scale active - heights are logarithmic
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default HistogramChart;