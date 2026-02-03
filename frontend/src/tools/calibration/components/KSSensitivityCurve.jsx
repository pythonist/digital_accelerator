// frontend/src/tools/calibration/components/KSSensitivityCurve.jsx
/**
 * KS Sensitivity Curve
 * ====================
 * Shows how KS changes across percentile range.
 * Helps identify optimal separation zones.
 */

import React from 'react';
import {
  Box,
  Typography,
  Alert,
  Chip
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea
} from 'recharts';

const KSSensitivityCurve = ({ sensitivityData, currentPercentile }) => {
  if (!sensitivityData || !sensitivityData.sensitivity_curve) {
    return null;
  }

  const { sensitivity_curve, optimal_separation } = sensitivityData;

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Box sx={{ bgcolor: 'background.paper', p: 1.5, border: 1, borderColor: 'divider' }}>
          <Typography variant="caption" display="block">
            <strong>Percentile:</strong> p{data.percentile}
          </Typography>
          <Typography variant="caption" display="block">
            <strong>Threshold:</strong> ₹{data.threshold.toLocaleString()}
          </Typography>
          <Typography variant="caption" display="block" color="primary.main">
            <strong>KS Value:</strong> {data.ks_statistic.toFixed(3)}
          </Typography>
          <Typography variant="caption" display="block">
            <strong>Interpretation:</strong> {data.interpretation}
          </Typography>
        </Box>
      );
    }
    return null;
  };

  // Color bands for KS interpretation
  const getColorForKS = (ks) => {
    if (ks >= 0.7) return '#2e7d32'; // very strong - green
    if (ks >= 0.4) return '#1976d2'; // strong - blue
    if (ks >= 0.2) return '#ed6c02'; // moderate - orange
    return '#d32f2f'; // weak - red
  };

  // Add color to each point
  const chartData = sensitivity_curve.map(point => ({
    ...point,
    color: getColorForKS(point.ks_statistic)
  }));

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle2" fontWeight="bold">
          KS Sensitivity Across Percentiles
        </Typography>
        
        {optimal_separation && (
          <Chip 
            label={`Optimal: p${optimal_separation.percentile} (KS=${optimal_separation.ks_statistic.toFixed(3)})`}
            color="primary"
            size="small"
          />
        )}
      </Box>
      
      <Typography variant="caption" color="text.secondary" paragraph>
        Shows how threshold placement affects population separation quality. 
        Higher KS = stronger behavioral distinction.
      </Typography>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          
          <XAxis 
            dataKey="percentile" 
            label={{ value: 'Percentile', position: 'insideBottom', offset: -5 }}
            tickFormatter={(v) => `p${v}`}
          />
          
          <YAxis 
            label={{ value: 'KS Statistic', angle: -90, position: 'insideLeft' }}
            domain={[0, 1]}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          {/* Reference lines for interpretation bands */}
          <ReferenceLine y={0.2} stroke="#ed6c02" strokeDasharray="3 3" label="Weak/Moderate" />
          <ReferenceLine y={0.4} stroke="#1976d2" strokeDasharray="3 3" label="Moderate/Strong" />
          <ReferenceLine y={0.7} stroke="#2e7d32" strokeDasharray="3 3" label="Strong/Very Strong" />
          
          {/* Current percentile marker */}
          {currentPercentile && (
            <ReferenceLine 
              x={currentPercentile} 
              stroke="#9c27b0" 
              strokeWidth={2}
              label={{ value: 'Current', position: 'top', fill: '#9c27b0' }}
            />
          )}
          
          {/* Optimal point marker */}
          {optimal_separation && (
            <ReferenceLine 
              x={optimal_separation.percentile} 
              stroke="orange" 
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          )}
          
          <Line 
            type="monotone" 
            dataKey="ks_statistic" 
            stroke="#1976d2" 
            strokeWidth={2}
            dot={{ fill: '#1976d2', r: 3 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Interpretation Legend */}
      <Box display="flex" gap={1} mt={2} flexWrap="wrap">
        <Chip label="Weak (< 0.2)" size="small" sx={{ bgcolor: '#d32f2f', color: 'white' }} />
        <Chip label="Moderate (0.2-0.4)" size="small" sx={{ bgcolor: '#ed6c02', color: 'white' }} />
        <Chip label="Strong (0.4-0.7)" size="small" sx={{ bgcolor: '#1976d2', color: 'white' }} />
        <Chip label="Very Strong (> 0.7)" size="small" sx={{ bgcolor: '#2e7d32', color: 'white' }} />
      </Box>
    </Box>
  );
};

export default KSSensitivityCurve;