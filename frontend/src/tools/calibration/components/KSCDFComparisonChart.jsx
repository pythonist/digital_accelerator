// frontend/src/tools/calibration/components/KSCDFComparisonChart.jsx
/**
 * KS CDF Comparison Chart
 * =======================
 * Visualizes empirical CDFs for alerted vs suppressed populations.
 * Shows point of maximum separation.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea
} from 'recharts';

const KSCDFComparisonChart = ({ cdfData, threshold }) => {
  if (!cdfData || !cdfData.cdf_data || cdfData.cdf_data.length === 0) {
    return (
      <Alert severity="info">
        CDF comparison not available. Adjust threshold to generate distribution curves.
      </Alert>
    );
  }

  const { cdf_data, max_separation, threshold_marker } = cdfData;

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Paper sx={{ p: 1.5 }} elevation={3}>
          <Typography variant="caption" display="block">
            <strong>Value:</strong> ₹{data.value.toLocaleString()}
          </Typography>
          <Typography variant="caption" display="block" color="error.main">
            <strong>Alerted CDF:</strong> {(data.alerted_cdf * 100).toFixed(1)}%
          </Typography>
          <Typography variant="caption" display="block" color="success.main">
            <strong>Suppressed CDF:</strong> {(data.suppressed_cdf * 100).toFixed(1)}%
          </Typography>
          <Typography variant="caption" display="block" color="primary.main">
            <strong>Separation:</strong> {(data.separation * 100).toFixed(1)}%
          </Typography>
        </Paper>
      );
    }
    return null;
  };

  // Format currency for axis
  const formatCurrency = (value) => {
    if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
    return `₹${value}`;
  };

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom fontWeight="bold">
        Empirical CDF Comparison
      </Typography>
      
      <Typography variant="caption" color="text.secondary" paragraph>
        Shows cumulative distribution functions for alerted (red) vs suppressed (green) populations.
        Vertical distance = separation strength at each value.
      </Typography>

      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={cdf_data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          
          <XAxis 
            dataKey="value" 
            tickFormatter={formatCurrency}
            label={{ value: 'Transaction Amount', position: 'insideBottom', offset: -5 }}
          />
          
          <YAxis 
            label={{ value: 'Cumulative Probability', angle: -90, position: 'insideLeft' }}
            domain={[0, 1]}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Legend />
          
          {/* Threshold marker */}
          {threshold_marker && (
            <ReferenceLine 
              x={threshold_marker.value} 
              stroke="#666" 
              strokeDasharray="5 5"
              label={{ value: 'Threshold', position: 'top' }}
            />
          )}
          
          {/* Max separation marker */}
          {max_separation && (
            <ReferenceLine 
              x={max_separation.value} 
              stroke="orange" 
              strokeWidth={2}
              label={{ value: 'Max KS', position: 'top', fill: 'orange' }}
            />
          )}
          
          {/* CDF Lines */}
          <Line 
            type="monotone" 
            dataKey="alerted_cdf" 
            stroke="#d32f2f" 
            name="Alerted Population"
            strokeWidth={2}
            dot={false}
          />
          
          <Line 
            type="monotone" 
            dataKey="suppressed_cdf" 
            stroke="#2e7d32" 
            name="Suppressed Population"
            strokeWidth={2}
            dot={false}
          />
          
          <Line 
            type="monotone" 
            dataKey="separation" 
            stroke="#1976d2" 
            name="Separation"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Max Separation Info */}
      {max_separation && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Maximum KS separation:</strong> {(max_separation.separation * 100).toFixed(1)}% 
            at ₹{max_separation.value.toLocaleString()}. This is where the two populations 
            are most structurally different.
          </Typography>
        </Alert>
      )}
    </Box>
  );
};

export default KSCDFComparisonChart;