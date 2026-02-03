// frontend/src/tools/calibration/components/aggregation/CoverageChart.jsx
import React from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DateRange } from '@mui/icons-material';

const CoverageChart = ({ data }) => {
  if (!data || !data.visuals?.coverage_chart || data.visuals.coverage_chart.length === 0) {
    return null;
  }

  const chartData = data.visuals.coverage_chart;

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <DateRange fontSize="small" color="primary" />
        <Box>
          <Typography variant="subtitle2" fontWeight="600">
            Time Coverage
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Row count distribution over time
          </Typography>
        </Box>
      </Box>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(value, name) => {
              if (name === 'row_count') return [value.toLocaleString(), 'Rows'];
              if (name === 'pct') return [`${value}%`, 'Percentage'];
              return [value, name];
            }}
          />
          <Bar dataKey="row_count" fill="#1976d2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', px: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Total Periods: {chartData.length}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Total Rows: {chartData.reduce((sum, d) => sum + d.row_count, 0).toLocaleString()}
        </Typography>
      </Box>
    </Paper>
  );
};

export default CoverageChart;