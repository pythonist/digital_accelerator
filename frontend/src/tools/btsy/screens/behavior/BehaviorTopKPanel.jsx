import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Box, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Alert, FormControl, Select, MenuItem, InputLabel, Button, TextField } from '@mui/material';
import btsyApi from '../../services/btsyApi';

const BehaviorTopKPanel = ({ runId, onViewTimeline }) => {
  const [topKData, setTopKData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(10);
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('max');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    const loadTopK = async () => {
      if (!runId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await btsyApi.behavior.topEntities(runId, limit);
        if (res.success) {
          setTopKData(res.data || []);
        } else {
          setError(res.error || 'Failed to load top entities');
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    loadTopK();
  }, [runId, limit]);

  if (!runId) return null;

  const filtered = useMemo(() => {
    let rows = [...(topKData || [])];
    const qq = String(q || '').trim().toLowerCase();
    if (qq) rows = rows.filter((r) => String(r.entity_id || '').toLowerCase().includes(qq));
    const dir = sortDir === 'asc' ? 1 : -1;
    const get = (r) => {
      if (sortBy === 'avg') return Number(r.avg_value ?? 0);
      if (sortBy === 'last') return Number(r.last_value ?? 0);
      return Number(r.max_value ?? 0);
    };
    rows.sort((a, b) => (get(a) - get(b)) * dir);
    return rows;
  }, [topKData, q, sortBy, sortDir]);

  return (
    <Paper sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Top Entities by Behavior Value
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <TextField size="small" label="Search Account" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 220 }} />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Sort</InputLabel>
            <Select value={sortBy} label="Sort" onChange={(e) => setSortBy(e.target.value)}>
              <MenuItem value="max">Highest behaviour value</MenuItem>
              <MenuItem value="avg">Highest avg value</MenuItem>
              <MenuItem value="last">Highest last value</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Order</InputLabel>
            <Select value={sortDir} label="Order" onChange={(e) => setSortDir(e.target.value)}>
              <MenuItem value="desc">Desc</MenuItem>
              <MenuItem value="asc">Asc</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Show Top</InputLabel>
            <Select
              value={limit}
              label="Show Top"
              onChange={(e) => setLimit(e.target.value)}
            >
              <MenuItem value={5}>Top 5</MenuItem>
              <MenuItem value={10}>Top 10</MenuItem>
              <MenuItem value={20}>Top 20</MenuItem>
              <MenuItem value={50}>Top 50</MenuItem>
              <MenuItem value={100}>Top 100</MenuItem>
            </Select>
          </FormControl>
        </Box>
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

      {!loading && !error && filtered.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Rank</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Account</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Behaviour</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Max Value</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Avg Value</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Last Value</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row, idx) => (
              <TableRow key={idx} hover>
                <TableCell>#{idx + 1}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {row.entity_id}
                </TableCell>
                <TableCell>{row.metric_name}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  {(row.max_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell align="right">
                  {(row.avg_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell align="right">
                  {(row.last_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() => onViewTimeline && onViewTimeline(row.entity_id)}
                    sx={{ textTransform: 'none' }}
                    disabled={!onViewTimeline}
                  >
                    View Behaviour Timeline
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Typography variant="body2" sx={{ color: '#64748b', textAlign: 'center', py: 3 }}>
          No data available
        </Typography>
      )}
    </Paper>
  );
};

export default BehaviorTopKPanel;
