import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Paper, FormControl, InputLabel, Select, MenuItem, Alert } from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

const EntityDrilldownView = ({ sessionId, topEntities, strategies, onLoadEntity }) => {
  const [entityId, setEntityId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const topOptions = useMemo(() => topEntities || [], [topEntities]);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [sessionId]);

  const load = async (nextEntityId) => {
    setError(null);
    try {
      const res = await onLoadEntity(nextEntityId);
      setData(res);
    } catch (e) {
      setError(e.message);
      setData(null);
    }
  };

  useEffect(() => {
    if (!entityId) return;
    load(entityId);
  }, [entityId]);

  const series = useMemo(() => {
    const rows = data?.series || [];
    return rows.map((r) => ({
      as_of_date: r.as_of_date,
      metric_value: r.metric_value
    }));
  }, [data]);

  return (
    <Box>
      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Entity Drilldown</Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
          Inspect behaviour evolution for a specific entity under the selected Behaviour Run. Threshold lines are scenario references only.
        </Typography>
        <FormControl fullWidth size="small">
          <InputLabel>Entity</InputLabel>
          <Select
            value={entityId}
            label="Entity"
            onChange={(e) => setEntityId(e.target.value)}
          >
            {topOptions.map((e) => (
              <MenuItem key={e.entity_id} value={e.entity_id}>
                {`${e.entity_id} • ${Number(e.aggregated_value || 0).toLocaleString()}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!entityId && (
        <Alert severity="info">
          Pick an entity from the top-entities list to view its time series.
        </Alert>
      )}

      {entityId && series.length === 0 && (
        <Alert severity="info">
          No series found for this entity.
        </Alert>
      )}

      {entityId && series.length > 0 && (
        <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Behaviour Time Series
          </Typography>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="as_of_date" tick={{ fontSize: 11 }} stroke="#64748b" hide />
              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
              <Tooltip labelStyle={{ color: '#1e293b' }} contentStyle={{ borderRadius: 0, border: '1px solid #e2e8f0', fontSize: 12 }} />
              {(strategies || []).filter(s => s.threshold_value !== null && s.threshold_value !== undefined).map((s) => (
                <ReferenceLine key={s.strategy_id} y={s.threshold_value} stroke="#0f172a" strokeDasharray="3 3" />
              ))}
              <Line type="monotone" dataKey="metric_value" stroke="#D04A02" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}
    </Box>
  );
};

export default EntityDrilldownView;

