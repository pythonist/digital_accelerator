import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Alert,
  Divider,
  Button,
  Grid,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const ScenarioWorkbenchScreen = () => {
  const [scenarios, setScenarios] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const [newScenarioId, setNewScenarioId] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newEntityLevel, setNewEntityLevel] = useState('account');
  const [newDescription, setNewDescription] = useState('');

  const load = async () => {
    const res = await btsyApi.scenarios.list(null, 'ACTIVE');
    if (res.success) {
      setScenarios(res.data || []);
      if (!selectedId) {
        const firstUser = (res.data || []).find((s) => s.ownership === 'USER');
        const first = firstUser || (res.data || [])[0];
        if (first?.scenario_id) setSelectedId(String(first.scenario_id));
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const fetchOne = async () => {
      if (!selectedId) return;
      const res = await btsyApi.scenarios.get(selectedId);
      if (res.success) setSelected(res.data);
    };
    fetchOne();
  }, [selectedId]);

  const selectedSummary = useMemo(() => {
    if (!selected) return null;
    return {
      scenario_id: selected.scenario_id,
      name: selected.name,
      entity_level: selected.entity_level,
      ownership: selected.ownership,
      version: selected.version,
      metrics: selected.metrics || [],
    };
  }, [selected]);

  const filteredScenarios = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return scenarios || [];
    return (scenarios || []).filter((s) => {
      return (
        String(s.scenario_id || '').toLowerCase().includes(q) ||
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.description || '').toLowerCase().includes(q)
      );
    });
  }, [scenarios, query]);

  const createScenario = async () => {
    setError('');
    if (!newScenarioId || !newScenarioName) {
      setError('scenario_id and name are required');
      return;
    }
    setBusy(true);
    try {
      const res = await btsyApi.scenarios.create({
        scenario_id: newScenarioId,
        name: newScenarioName,
        entity_level: newEntityLevel,
        description: newDescription || null,
        scenario_json: {
          scenario_id: newScenarioId,
          name: newScenarioName,
          description: newDescription || null,
          entity_level: newEntityLevel,
          version: 1,
          ownership: 'USER'
        }
      }, 'user');
      if (!res.success) {
        setError(res.error || 'Failed to create scenario');
        return;
      }
      await load();
      setSelectedId(String(res.data?.scenario_id || newScenarioId));
      setNewScenarioId('');
      setNewScenarioName('');
      setNewDescription('');
    } finally {
      setBusy(false);
    }
  };

  const useInUniverse = async () => {
    if (!selectedSummary?.scenario_id) return;
    sessionStorage.setItem('btsy_selected_scenario_id', String(selectedSummary.scenario_id));
    window.dispatchEvent(new CustomEvent('btsy:navigate', { detail: { screen: 'universe' } }));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Scenarios</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Scenarios are first-class objects that define universe intent and behavioural metrics.
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Create Scenario (User)</Typography>
            <Stack spacing={1.25}>
              <TextField size="small" label="Scenario ID" value={newScenarioId} onChange={(e) => setNewScenarioId(e.target.value)} placeholder="SCN_MY_CASE_1" />
              <TextField size="small" label="Name" value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} />
              <FormControl size="small" fullWidth>
                <InputLabel>Entity Level</InputLabel>
                <Select value={newEntityLevel} label="Entity Level" onChange={(e) => setNewEntityLevel(e.target.value)}>
                  <MenuItem value="account">Account</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} multiline minRows={2} />
              <Button variant="contained" onClick={createScenario} disabled={busy}>
                Create
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Scenario Catalog</Typography>
                <Chip size="small" label={`${(filteredScenarios || []).length} active`} />
              </Stack>
              <TextField
                size="small"
                placeholder="Search scenarios"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                fullWidth
                sx={{ mb: 1 }}
              />
              <Divider sx={{ mb: 1 }} />
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Ownership</TableCell>
                    <TableCell>Entity</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(filteredScenarios || []).map((s) => (
                    <TableRow
                      key={s.scenario_id}
                      hover
                      selected={String(s.scenario_id) === String(selectedId)}
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setSelectedId(String(s.scenario_id))}
                    >
                      <TableCell>{s.scenario_id}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.ownership}</TableCell>
                      <TableCell>{s.entity_level}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Paper elevation={0} sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: 0, mt: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Selected Scenario</Typography>
          <Button variant="outlined" disabled={!selectedSummary?.scenario_id} onClick={useInUniverse}>
            Use in Universe
          </Button>
        </Stack>
        <Divider sx={{ my: 1 }} />
        {!selectedSummary && (
          <Alert severity="info">Select a scenario to view details.</Alert>
        )}
        {selectedSummary && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Stack spacing={0.5}>
                <Typography variant="body2">{`ID: ${selectedSummary.scenario_id}`}</Typography>
                <Typography variant="body2">{`Name: ${selectedSummary.name}`}</Typography>
                <Typography variant="body2">{`Entity: ${selectedSummary.entity_level}`}</Typography>
                <Typography variant="body2">{`Ownership: ${selectedSummary.ownership}`}</Typography>
                <Typography variant="body2">{`Version: ${selectedSummary.version}`}</Typography>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Metrics</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Metric</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Windows</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(selectedSummary.metrics || []).map((m) => (
                    <TableRow key={m.metric_id}>
                      <TableCell>{m.metric_id}</TableCell>
                      <TableCell>{m.aggregation_type}</TableCell>
                      <TableCell>{(m.windows || []).join(', ')}</TableCell>
                    </TableRow>
                  ))}
                  {(selectedSummary.metrics || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          No metrics defined for this scenario yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Grid>
          </Grid>
        )}
      </Paper>
    </Box>
  );
};

export default ScenarioWorkbenchScreen;
