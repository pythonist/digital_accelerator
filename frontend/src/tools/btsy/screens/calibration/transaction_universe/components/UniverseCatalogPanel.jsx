import React, { useEffect, useState } from 'react';
import { Box, Paper, Typography, Chip, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Stack } from '@mui/material';
import btsyApi from '../../../../services/btsyApi';

const UniverseCatalogPanel = ({ calibrationRunId, snapshotId, onUse }) => {
  const [universes, setUniverses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await btsyApi.universe.listUniverseHistory(calibrationRunId, snapshotId, null, 50);
      if (res.success) setUniverses(res.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, [calibrationRunId, snapshotId]);

  return (
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #e2e8f0', borderRadius: 0, mt: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e293b' }}>Past Universes</Typography>
        <Button variant="outlined" onClick={loadHistory}>Refresh</Button>
      </Stack>

      {error && <Typography variant="body2" color="error">{error}</Typography>}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Transactions</TableCell>
              <TableCell>Date Range</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Filters</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {universes.map(u => (
              <TableRow key={u.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.universe_name}</Typography>
                  <Typography variant="caption" sx={{ color: '#64748b' }}>{new Date(u.created_at).toLocaleString()}</Typography>
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{u.transaction_count?.toLocaleString()}</TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {u.date_range_start ? new Date(u.date_range_start).toLocaleDateString() : '--'} → {u.date_range_end ? new Date(u.date_range_end).toLocaleDateString() : '--'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={u.status} size="small" sx={{ bgcolor: u.status === 'frozen' ? '#dcfce7' : '#f1f5f9', color: u.status === 'frozen' ? '#15803d' : '#475569', fontWeight: 600 }} />
                </TableCell>
                <TableCell>
                  {(u.filter_spec?.categories || []).map(cat => (
                    <Chip key={cat} label={cat} size="small" sx={{ mr: 0.5 }} />
                  ))}
                </TableCell>
                <TableCell align="right">
                  <Button 
                    variant="contained" 
                    size="small" 
                    onClick={async () => {
                      await btsyApi.universe.selectUniverse(u.id, 'Selected from catalog');
                      sessionStorage.setItem('btsy_next_screen', 'behavior');
                      sessionStorage.setItem('btsy_selected_universe_id', String(u.id));
                      onUse(u.id);
                    }}
                    sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#b13f02' }, fontWeight: 700 }}
                  >
                    Use Universe
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default UniverseCatalogPanel;
