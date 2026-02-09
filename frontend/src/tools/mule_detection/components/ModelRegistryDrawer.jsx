import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Drawer, IconButton, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import StarIcon from '@mui/icons-material/Star';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';
import { TOOL_HEADER_HEIGHT } from '../layout/layout.constants';
import { formatInteger, formatProbability } from '../utils/formatters';

const ModelRegistryDrawer = () => {
  const { modelRegistryOpen, closeModelRegistry, starredModels, toggleStarModel } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.listModels();
      setModels(res?.models || []);
    } catch (e) {
      setModels([]);
      setError(e?.response?.data?.error || e?.message || 'Failed to load models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!modelRegistryOpen) return;
    load();
  }, [modelRegistryOpen]);

  const starredSet = useMemo(() => new Set((starredModels || []).map((x) => String(x))), [starredModels]);

  const remove = async (modelVersion) => {
    if (!modelVersion) return;
    setLoading(true);
    setError(null);
    try {
      await muleApi.deleteModel(modelVersion);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to delete model');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={modelRegistryOpen}
      onClose={closeModelRegistry}
      PaperProps={{
        sx: {
          width: { xs: '100%', md: 520 },
          bgcolor: '#fff',
          top: `${TOOL_HEADER_HEIGHT}px`,
          height: `calc(100% - ${TOOL_HEADER_HEIGHT}px)`,
        },
      }}
    >
      <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>Model Registry</Typography>
            <Typography variant="caption" color="text.secondary">Star models to make them available everywhere</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={load} disabled={loading}>Refresh</Button>
            <Button variant="outlined" onClick={closeModelRegistry}>Close</Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert> : null}
        {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}

        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 44 }}></TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Algo</TableCell>
              <TableCell align="right">AUC</TableCell>
              <TableCell align="right">F1</TableCell>
              <TableCell align="right">Features</TableCell>
              <TableCell align="right"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {models.map((m) => {
              const mv = m.model_version;
              const starred = starredSet.has(String(mv));
              return (
                <TableRow key={mv} hover>
                  <TableCell>
                    <IconButton size="small" onClick={() => toggleStarModel(mv)}>
                      {starred ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{mv}</TableCell>
                  <TableCell>{m.algorithm || '-'}</TableCell>
                  <TableCell align="right">{formatProbability(m.auc || 0, 3)}</TableCell>
                  <TableCell align="right">{formatProbability(m.f1 || 0, 3)}</TableCell>
                  <TableCell align="right">{formatInteger(m.feature_count ?? '-')}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => remove(mv)} disabled={loading}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">
                    No models found. Train a model in Model Lab first.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Box>
    </Drawer>
  );
};

export default ModelRegistryDrawer;

