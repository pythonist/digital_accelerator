import React, { useEffect, useState } from 'react';
import { Paper, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import btsyApi from '../../services/btsyApi';

const MetricOverTimePanel = ({ runId }) => {
  const [timeSeriesData, setTimeSeriesData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTimeSeries = async () => {
      if (!runId) return;
      setLoading(true);
      setError(null);
      try {
        // Using medianByDay API - note: aggregation dropdown is disabled for now
        const res = await btsyApi.behavior.medianByDay(runId);
        if (res.success) {
          // Transform the data to match expected format
          const transformedData = (res.data || []).map(item => ({
            date: item.date || item.day || item.as_of_date,
            value: item.median_value || item.value || 0
          }));
          setTimeSeriesData(transformedData);
        } else {
          setError(res.error || 'Failed to load time series data');
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    loadTimeSeries();
  }, [runId]);

  if (!runId) return null;

  return (
    <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Metric Over Time (Median by Day)
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress size={32} sx={{ color: '#D04A02' }} />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && timeSeriesData.length > 0 && (
        <Box sx={{ width: '100%', height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={timeSeriesData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                stroke="#64748b"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#64748b"
                tickFormatter={(value) => value.toLocaleString()}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 4
                }}
                formatter={(value) => [value.toLocaleString(undefined, { maximumFractionDigits: 2 }), 'Value']}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#D04A02"
                strokeWidth={2}
                dot={{ fill: '#D04A02', r: 3 }}
                activeDot={{ r: 5 }}
                name="Metric (median)"
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}

      {!loading && !error && timeSeriesData.length === 0 && (
        <Typography variant="body2" sx={{ color: '#64748b', textAlign: 'center', py: 3 }}>
          No time series data available
        </Typography>
      )}

      <Typography variant="caption" sx={{ display: 'block', mt: 2, color: '#64748b' }}>
        Shows the median of metric values across all entities over time, aggregated by day.
      </Typography>
    </Paper>
  );
};

export default MetricOverTimePanel;