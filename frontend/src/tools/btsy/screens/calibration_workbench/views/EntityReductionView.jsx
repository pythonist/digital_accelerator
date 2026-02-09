import React, { useMemo } from 'react';
import { Box, Grid, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Alert } from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const EntityReductionView = ({ session, aggregateView }) => {
  const histogram = aggregateView?.histogram || null;
  const bins = histogram?.bins || 0;

  const histData = useMemo(() => {
    const rows = histogram?.rows || [];
    if (!bins) return rows.map(r => ({ bucket: r.bucket, count: r.count }));
    const map = new Map(rows.map(r => [r.bucket, r.count]));
    const filled = [];
    for (let i = 0; i <= bins; i += 1) {
      filled.push({ bucket: i, count: map.get(i) || 0 });
    }
    return filled;
  }, [histogram, bins]);

  if (!session) return null;

  if (!aggregateView?.summary) {
    return (
      <Alert severity="info">
        Apply an interpretation lens to collapse Step-2 time-series into entity-level values.
      </Alert>
    );
  }

  return (
    <Box>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Entity Reduction Summary</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Step-2 produces a time-series signal. Step-3.1 collapses it using the selected interpretation lens.
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Entities: {(aggregateView.summary.entities || 0).toLocaleString()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Median: {Number(aggregateView.summary.median || 0).toLocaleString()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                P95: {Number(aggregateView.summary.p95 || 0).toLocaleString()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                P99: {Number(aggregateView.summary.p99 || 0).toLocaleString()}
              </Typography>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Collapsed Distribution</Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={histData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="count" fill="#0f172a" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Top Entities (by aggregated value)</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Entity</TableCell>
                    <TableCell align="right">Aggregated Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(aggregateView.top_entities || []).map((r) => (
                    <TableRow key={r.entity_id}>
                      <TableCell>{r.entity_id}</TableCell>
                      <TableCell align="right">{Number(r.aggregated_value || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {(aggregateView.top_entities || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} sx={{ color: 'text.secondary' }}>No data.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default EntityReductionView;

