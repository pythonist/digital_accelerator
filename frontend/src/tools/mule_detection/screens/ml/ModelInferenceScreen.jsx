import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  Grid,
  Stack,
  TextField,
  MenuItem,
  Chip,
  CardHeader,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Divider,
  Checkbox,
  FormControl,
  InputLabel,
  Select
} from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, LineChart, Line, Legend, CartesianGrid } from 'recharts';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';
import { useMuleStore } from '../../store/muleStore';
import StructuredValue from '../../components/StructuredValue';
import { formatInteger, formatPercentFromRatio, formatProbability } from '../../utils/formatters';

const ModelInferenceScreen = () => {
  const { openInvestigation, starredModels } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');

  const dropdownModels = useMemo(() => {
    const starred = new Set((starredModels || []).map((x) => String(x)));
    if (starred.size === 0) return models;
    return models.filter((m) => starred.has(String(m.model_version)) || String(m.model_version) === String(selectedModel));
  }, [models, selectedModel, starredModels]);

  const [thresholds, setThresholds] = useState({ high: 0.7, medium: 0.4 });
  const [population, setPopulation] = useState('');

  const [context, setContext] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [movement, setMovement] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [suppression, setSuppression] = useState(null);
  const [roleCounts, setRoleCounts] = useState(null);

  const [filters, setFilters] = useState({ risk_level: '', movement: '', pattern: '', investigator: '', cluster_id: '' });
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [assignInvestigator, setAssignInvestigator] = useState('');

  const loadModels = async () => {
    try {
      const res = await muleApi.listModels();
      const list = res.models || [];
      setModels(list);
      if (!selectedModel && list.length) {
        const starred = new Set((starredModels || []).map((x) => String(x)));
        const preferred = list.find((m) => starred.has(String(m.model_version)));
        setSelectedModel((preferred || list[0]).model_version);
      }
    } catch {
      setModels([]);
    }
  };

  const loadWorkbench = async (keepFilters = true) => {
    try {
      const params = {
        high: thresholds.high,
        medium: thresholds.medium,
        population: population || undefined
      };
      const [ctx, out, mv, pat, sup, role] = await Promise.all([
        muleApi.getInferenceRunContext(params),
        muleApi.getInferencePortfolioOutcome(params),
        muleApi.getInferenceAccountsMovement(params),
        muleApi.getInferencePortfolioPatterns(),
        muleApi.getInferenceSuppressionConfidence(params),
        muleApi.getInferenceRoleClassification({ limit: 2000 })
      ]);
      setContext(ctx?.run || null);
      setOutcome(out || null);
      setMovement(mv || null);
      setPatterns(pat?.patterns || []);
      setSuppression(sup?.suppression || null);
      setRoleCounts(role?.role_counts || null);
      if (!keepFilters) setFilters({ risk_level: '', movement: '', pattern: '', investigator: '', cluster_id: '' });
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load inference workbench');
    }
  };

  useEffect(() => {
    loadModels();
    loadWorkbench(true);
  }, []);

  const loadPrioritized = async () => {
    try {
      const params = {
        high: thresholds.high,
        medium: thresholds.medium,
        risk_level: filters.risk_level || undefined,
        movement: filters.movement || undefined,
        pattern: filters.pattern || undefined,
        investigator: filters.investigator || undefined,
        cluster_id: filters.cluster_id || undefined,
        limit: 500
      };
      const res = await muleApi.getInferenceAccountsPrioritized(params);
      setAccounts(res?.accounts || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load prioritized accounts');
    }
  };

  useEffect(() => {
    loadPrioritized();
  }, [filters, thresholds.high, thresholds.medium]);

  const runInference = async () => {
    setLoading(true);
    setError(null);
    try {
      await muleApi.inferModel({ model_version: selectedModel || undefined, force: true });
      await loadWorkbench(true);
      await loadPrioritized();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Inference failed');
    } finally {
      setLoading(false);
    }
  };

  const outcomeSummary = outcome?.summary || null;
  const histogram = outcome?.histogram || [];
  const selectedAll = accounts.length > 0 && selectedAccountIds.length === accounts.length;
  const selectedSome = selectedAccountIds.length > 0 && selectedAccountIds.length < accounts.length;

  const suppressionCurve = suppression?.curve || [];

  const exportCsv = () => {
    const rows = accounts || [];
    if (!rows.length) return;
    const cols = [
      'account_id',
      'risk_score',
      'risk_level',
      'decision',
      'risk_delta',
      'velocity_spike',
      'pass_through_indicator',
      'new_beneficiaries',
      'device_sharing',
      'network_cluster_id',
      'probable_role',
      'top_driver',
      'sla_aging_days',
      'assigned_investigator',
      'movement'
    ];
    const csv = [
      cols.join(','),
      ...rows.map((r) =>
        cols
          .map((c) => {
            const v = r?.[c];
            const s = v == null ? '' : String(v);
            const escaped = s.replaceAll('"', '""');
            return `"${escaped}"`;
          })
          .join(',')
      )
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mule_inference_priority_${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bulkAssign = async () => {
    if (!selectedAccountIds.length || !assignInvestigator) return;
    setLoading(true);
    setError(null);
    try {
      await muleApi.assignInferenceAccounts({ account_ids: selectedAccountIds, investigator: assignInvestigator });
      await loadPrioritized();
      setSelectedAccountIds([]);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Bulk assign failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Inference Workbench"
              subheader="Operational decision + explainability + prioritization (bank-grade)"
              action={
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button onClick={() => { loadModels(); loadWorkbench(true); loadPrioritized(); }} disabled={loading}>Refresh</Button>
                  <Button variant="contained" onClick={runInference} disabled={loading} sx={{ bgcolor: pwcColors.primary, '&:hover': { bgcolor: '#c2410c' } }}>
                    {loading ? 'Running…' : 'Run Inference'}
                  </Button>
                </Stack>
              }
            />
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={3}>
                  <TextField
                    select
                    size="small"
                    label="Model version (execution)"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    fullWidth
                  >
                    {dropdownModels.length === 0 ? (
                      <MenuItem value="">No models</MenuItem>
                    ) : (
                      dropdownModels.map((m) => (
                        <MenuItem key={m.model_version} value={m.model_version}>
                          {m.model_version} · {m.algorithm || 'model'}
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    size="small"
                    label="High threshold"
                    value={thresholds.high}
                    onChange={(e) => setThresholds({ ...thresholds, high: Number(e.target.value) })}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    size="small"
                    label="Medium threshold"
                    value={thresholds.medium}
                    onChange={(e) => setThresholds({ ...thresholds, medium: Number(e.target.value) })}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    size="small"
                    label="Population"
                    value={population}
                    onChange={(e) => setPopulation(e.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
                    <Chip label={`Run: ${context?.run_id || '-'}`} />
                    <Chip label={`Time: ${context?.timestamp || '-'}`} />
                  </Stack>
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                <Chip label={`Model: ${context?.model_version || '-'}`} />
                <Chip label={`Features: ${context?.feature_version || '-'}`} />
                <Chip label={`Dataset: ${context?.dataset_version || '-'}`} />
                <Chip label={`Approval: ${context?.approval?.approval_id || '-'}`} />
                {(context?.warnings || []).map((w) => (
                  <Chip key={w} label={w} sx={{ bgcolor: pwcColors.warningBg, color: pwcColors.warningText }} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Portfolio Outcome" subheader="Scored population, risk movement, and suppression candidates" />
            <CardContent>
              {!outcomeSummary ? (
                <Typography variant="body2" color="text.secondary">Run inference to generate portfolio outcomes.</Typography>
              ) : (
                <Grid container spacing={2}>
                  {[
                    { title: 'Total Scored', value: outcomeSummary.total_scored ?? 0 },
                    { title: 'HIGH', value: outcomeSummary.high ?? 0, tone: 'high' },
                    { title: 'MEDIUM', value: outcomeSummary.medium ?? 0, tone: 'med' },
                    { title: 'LOW', value: outcomeSummary.low ?? 0, tone: 'low' },
                    { title: 'New Highs', value: outcomeSummary.new_high ?? 0 },
                    { title: 'Upgrades', value: outcomeSummary.risk_upgrades ?? 0 },
                    { title: 'Downgrades', value: outcomeSummary.risk_downgrades ?? 0 },
                    { title: 'Suppression Candidates', value: outcomeSummary.suppression_candidates ?? 0 }
                  ].map((c) => (
                    <Grid item xs={12} sm={6} md={3} key={c.title}>
                      <Card elevation={0}>
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">{c.title}</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5 }}>
                            {c.value}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                  <Grid item xs={12}>
                    <Card elevation={0}>
                      <CardHeader title="Risk Distribution Histogram" />
                      <CardContent sx={{ height: 220 }}>
                        {histogram.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No distribution available.</Typography>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogram}>
                              <XAxis dataKey="start" tickFormatter={(v) => Number(v).toFixed(1)} />
                              <YAxis />
                              <ReTooltip />
                              <Bar dataKey="count" fill="#111827" />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader
              title="Mule Prioritization Grid"
              subheader="Operational queue: decide, assign, and investigate"
              action={
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" label="Investigator" value={assignInvestigator} onChange={(e) => setAssignInvestigator(e.target.value)} />
                  <Button variant="outlined" onClick={bulkAssign} disabled={loading || !selectedAccountIds.length || !assignInvestigator}>
                    Bulk Assign
                  </Button>
                  <Button variant="outlined" onClick={exportCsv} disabled={!accounts.length}>
                    Export
                  </Button>
                </Stack>
              }
            />
            <CardContent>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Risk level</InputLabel>
                    <Select label="Risk level" value={filters.risk_level} onChange={(e) => setFilters({ ...filters, risk_level: e.target.value })}>
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="HIGH">HIGH</MenuItem>
                      <MenuItem value="MEDIUM">MEDIUM</MenuItem>
                      <MenuItem value="LOW">LOW</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Movement</InputLabel>
                    <Select label="Movement" value={filters.movement} onChange={(e) => setFilters({ ...filters, movement: e.target.value })}>
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="new">new</MenuItem>
                      <MenuItem value="new high">new high</MenuItem>
                      <MenuItem value="rising fast">rising fast</MenuItem>
                      <MenuItem value="cooling">cooling</MenuItem>
                      <MenuItem value="stable">stable</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Pattern filter</InputLabel>
                    <Select label="Pattern filter" value={filters.pattern} onChange={(e) => setFilters({ ...filters, pattern: e.target.value })}>
                      <MenuItem value="">All</MenuItem>
                      {(patterns || []).map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField size="small" label="Cluster ID" value={filters.cluster_id} onChange={(e) => setFilters({ ...filters, cluster_id: e.target.value })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField size="small" label="Investigator" value={filters.investigator} onChange={(e) => setFilters({ ...filters, investigator: e.target.value })} fullWidth />
                </Grid>
              </Grid>

              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedAll}
                          indeterminate={selectedSome}
                          onChange={(e) => setSelectedAccountIds(e.target.checked ? accounts.map((a) => a.account_id) : [])}
                        />
                      </TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Risk</TableCell>
                      <TableCell>Decision</TableCell>
                      <TableCell>Δ vs last</TableCell>
                      <TableCell>Velocity spike</TableCell>
                      <TableCell>Pass-through</TableCell>
                      <TableCell>New beneficiaries</TableCell>
                      <TableCell>Device sharing</TableCell>
                      <TableCell>Cluster</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Top driver</TableCell>
                      <TableCell>SLA aging</TableCell>
                      <TableCell>Investigator</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(accounts || []).map((r) => (
                      <TableRow key={r.account_id} hover>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selectedAccountIds.includes(r.account_id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedAccountIds((prev) => checked ? Array.from(new Set([...prev, r.account_id])) : prev.filter((x) => x !== r.account_id));
                            }}
                          />
                        </TableCell>
                        <TableCell>{r.account_id}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip label={r.risk_level} size="small" />
                            <Typography variant="body2">{formatProbability(r.risk_score || 0, 3)}</Typography>
                            <Chip label={r.movement} size="small" />
                          </Stack>
                        </TableCell>
                        <TableCell>{r.decision}</TableCell>
                        <TableCell>{formatProbability(r.risk_delta || 0, 3)}</TableCell>
                        <TableCell>{r.velocity_spike ?? '-'}</TableCell>
                        <TableCell>{r.pass_through_indicator ?? '-'}</TableCell>
                        <TableCell>{r.new_beneficiaries ?? '-'}</TableCell>
                        <TableCell>{r.device_sharing ?? '-'}</TableCell>
                        <TableCell>{r.network_cluster_id}</TableCell>
                        <TableCell>{r.probable_role}</TableCell>
                        <TableCell><StructuredValue value={r.top_driver} inline mode="text" /></TableCell>
                        <TableCell>{formatInteger(r.sla_aging_days ?? '-')}</TableCell>
                        <TableCell>{r.assigned_investigator || '-'}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => openInvestigation(r.account_id, 'explain')}>Explain</Button>
                            <Button size="small" variant="outlined" onClick={() => openInvestigation(r.account_id, 'timeline')}>Timeline</Button>
                            <Button size="small" variant="outlined" onClick={() => openInvestigation(r.account_id, 'network')}>Network</Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                    {accounts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={15}>
                          <Typography variant="body2" color="text.secondary">Run inference to populate the grid.</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Behaviour & Network Intelligence" subheader="Portfolio-level signals that drive triage" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    {(patterns || []).map((p) => (
                      <Chip
                        key={p.id}
                        label={`${p.title}: ${formatInteger(p.count)}`}
                        onClick={() => setFilters((prev) => ({ ...prev, pattern: p.id }))}
                      />
                    ))}
                    {movement?.has_results && (
                      <>
                        <Chip label={`New high: ${formatInteger(movement.movement?.new_high || 0)}`} onClick={() => setFilters((prev) => ({ ...prev, movement: 'new high' }))} />
                        <Chip label={`Rising fast: ${formatInteger(movement.movement?.rising_fast || 0)}`} onClick={() => setFilters((prev) => ({ ...prev, movement: 'rising fast' }))} />
                        <Chip label={`Cooling: ${formatInteger(movement.movement?.cooling || 0)}`} onClick={() => setFilters((prev) => ({ ...prev, movement: 'cooling' }))} />
                      </>
                    )}
                  </Stack>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card elevation={0}>
                    <CardHeader title="Role Mix" />
                    <CardContent>
                      {!roleCounts ? (
                        <Typography variant="body2" color="text.secondary">No role classification available.</Typography>
                      ) : (
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {Object.entries(roleCounts).map(([k, v]) => (
                            <Chip key={k} label={`${k}: ${formatInteger(v)}`} />
                          ))}
                        </Stack>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Suppression Confidence" subheader="Regulator-grade justification for low-risk decisions" />
            <CardContent>
              {!suppression ? (
                <Typography variant="body2" color="text.secondary">No suppression confidence available.</Typography>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Card elevation={0}>
                      <CardHeader title="Expected Event Loss" />
                      <CardContent>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>
                          {suppression.expected_event_loss == null ? '-' : formatPercentFromRatio(suppression.expected_event_loss, 2)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">Estimated mule rate within suppression candidates.</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <Card elevation={0}>
                      <CardHeader title="Justification" />
                      <CardContent>
                        <Stack spacing={1}>
                          {(suppression.why_safe || []).map((t, i) => (
                            <Typography key={i} variant="body2">{t}</Typography>
                          ))}
                        </Stack>
                        <Divider sx={{ my: 2 }} />
                        <Table size="small" sx={{ maxWidth: 720 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Metric</TableCell>
                              <TableCell>Value</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(suppression.evidence || []).slice(0, 12).map((e, idx) => (
                              <TableRow key={idx}>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.metric}</TableCell>
                                <TableCell>
                                  <StructuredValue value={e.value} inline mode={typeof e.value === 'number' ? 'number' : 'text'} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12}>
                    <Card elevation={0}>
                      <CardHeader title="Suppression vs Event Loss" />
                      <CardContent sx={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={suppressionCurve}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="threshold" />
                            <YAxis />
                            <ReTooltip />
                            <Legend />
                            <Line type="monotone" dataKey="suppression" stroke="#0f172a" dot={false} strokeWidth={2} />
                            <Line type="monotone" dataKey="event_loss" stroke={pwcColors.errorText} dot={false} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ModelInferenceScreen;
