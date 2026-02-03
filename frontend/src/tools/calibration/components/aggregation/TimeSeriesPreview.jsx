// frontend/src/tools/calibration/components/aggregation/TimeSeriesPreview.jsx
import React from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShowChart } from '@mui/icons-material';

const TimeSeriesPreview = ({ data }) => {
  if (!data || !data.visuals?.time_series_sample || data.visuals.time_series_sample.length === 0) {
    return null;
  }

  const samples = data.visuals.time_series_sample;
  
  // Prepare chart data - combine all entities into single timeline
  const allDates = new Set();
  samples.forEach(sample => {
    sample.series.forEach(point => allDates.add(point.date));
  });
  
  const chartData = Array.from(allDates).sort().map(date => {
    const point = { date };
    samples.forEach((sample, idx) => {
      const dataPoint = sample.series.find(p => p.date === date);
      if (dataPoint) {
        // Use first metric found
        const metricKey = Object.keys(dataPoint).find(k => k !== 'date');
        if (metricKey) {
          point[`entity_${idx + 1}`] = dataPoint[metricKey];
        }
      }
    });
    return point;
  });

  const colors = ['#1976d2', '#dc004e'];

  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <ShowChart fontSize="small" color="primary" />
        <Box>
          <Typography variant="subtitle2" fontWeight="600">
            Behavior Preview
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Sample entities over time (illustrative)
          </Typography>
        </Box>
      </Box>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => value.slice(5, 10)} // Show MM-DD
          />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(value) => value?.toLocaleString()}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {samples.map((sample, idx) => (
            <Line
              key={`entity_${idx + 1}`}
              type="monotone"
              dataKey={`entity_${idx + 1}`}
              stroke={colors[idx]}
              strokeWidth={2}
              dot={false}
              name={`Entity ${sample.entity_id}`}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <Box sx={{ mt: 1, p: 1, bgcolor: 'info.50', borderRadius: 1 }}>
        <Typography variant="caption" color="info.dark">
          ℹ️ Showing {samples.length} sample entit{samples.length > 1 ? 'ies' : 'y'} with most data points
        </Typography>
      </Box>
    </Paper>
  );
};

export default TimeSeriesPreview;