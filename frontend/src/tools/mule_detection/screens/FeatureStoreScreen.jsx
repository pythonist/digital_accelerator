import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Alert,
  Stack,
  TextField,
  Button,
  Typography,
  Grid,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Drawer,
  Tabs,
  Tab,
  LinearProgress
} from '@mui/material';
import muleApi from '../services/muleApi';

const levelColor = (level) => {
  const v = String(level || '').toUpperCase();
  if (v === 'APPROVED' || v === 'PRODUCTION') return { bg: 'rgba(34,197,94,0.08)', fg: '#22c55e', border: 'rgba(34,197,94,0.25)' };
  if (v === 'WATCHLIST' || v === 'VALIDATING') return { bg: 'rgba(245,158,11,0.08)', fg: '#f59e0b', border: 'rgba(245,158,11,0.25)' };
  if (v === 'RETIRED' || v === 'RESTRICTED' || v === 'REJECTED') return { bg: 'rgba(239,68,68,0.08)', fg: '#ef4444', border: 'rgba(239,68,68,0.25)' };
  return { bg: 'rgba(148,163,184,0.05)', fg: 'rgba(148,163,184,0.9)', border: 'rgba(148,163,184,0.18)' };
};

const usagePermission = (row) => {
  const st = String(row?.lifecycle_state || '').toUpperCase();
  if (st === 'APPROVED' || st === 'PRODUCTION') return 'MODEL ALLOWED';
  if (st === 'WATCHLIST') return 'MONITORING';
  if (st === 'RETIRED') return 'REJECTED';
  if (st === 'VALIDATING') return 'RESEARCH';
  return 'RESEARCH';
};

const stabilityVerdict = (row) => {
  if (!row) return 'UNKNOWN';
  if (row.drift_status === 'DRIFT') return 'DRIFT RISK';
  const psi = row.psi != null ? Number(row.psi) : null;
  if (psi != null && psi >= 0.2) return 'DRIFT RISK';
  if (row.drift_status === 'OK') return 'STABLE';
  return 'UNKNOWN';
};

const evidenceBadges = (row) => {
  const out = [];
  if (!row) return out;
  if (row.rarity_verdict) out.push({ label: `RARITY: ${row.rarity_verdict}`, kind: row.rarity_verdict });
  if (row.predictive_strength) out.push({ label: `IV: ${row.predictive_strength}`, kind: row.predictive_strength });
  return out;
};

const FeatureStoreScreen = () => {
  const [loading, setLoading] = useState(false);
  const [features, setFeatures] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filterFamily, setFilterFamily] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTypology, setFilterTypology] = useState('');
  const [filterStability, setFilterStability] = useState('');
  const [filterValidationMode, setFilterValidationMode] = useState('');

  const [dossierOpen, setDossierOpen] = useState(false);
  const [dossierTab, setDossierTab] = useState('origin');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [profile, setProfile] = useState(null);
  const [drift, setDrift] = useState(null);
  const [governance, setGovernance] = useState([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.getFeaturesCatalog();
      setFeatures(res?.features || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load features');
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = Array.isArray(features) ? features : [];
    if (q) {
      list = list.filter((f) => {
        const hay = [
          f.feature_name,
          f.category,
          f.typology,
          f.lifecycle_state,
          f.origin_type,
          f.origin_module,
          f.built_by,
          f.construction_source
        ].map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(q);
      });
    }
    if (filterFamily) list = list.filter((f) => String(f.category || '').toLowerCase() === String(filterFamily).toLowerCase());
    if (filterStatus) list = list.filter((f) => String(f.lifecycle_state || '').toUpperCase() === String(filterStatus).toUpperCase());
    if (filterTypology) list = list.filter((f) => String(f.typology || '').toLowerCase().includes(String(filterTypology).toLowerCase()));
    if (filterStability) list = list.filter((f) => stabilityVerdict(f) === filterStability);
    if (filterValidationMode) {
      if (filterValidationMode === 'SUPERVISED') list = list.filter((f) => Boolean(f.label_available));
      if (filterValidationMode === 'BEHAVIORAL') list = list.filter((f) => !Boolean(f.label_available));
    }
    return list;
  }, [features, query, filterFamily, filterStatus, filterTypology, filterStability, filterValidationMode]);

  const families = useMemo(() => {
    const set = new Set();
    for (const f of features || []) if (f?.category) set.add(String(f.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [features]);

  const typologies = useMemo(() => {
    const set = new Set();
    for (const f of features || []) if (f?.typology) set.add(String(f.typology));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [features]);

  const summary = useMemo(() => {
    const list = Array.isArray(features) ? features : [];
    const total = list.length;
    const approved = list.filter((f) => ['APPROVED', 'PRODUCTION'].includes(String(f.lifecycle_state || '').toUpperCase())).length;
    const modelEligible = list.filter((f) => usagePermission(f) === 'MODEL ALLOWED').length;
    const behaviorOnly = list.filter((f) => !Boolean(f.label_available)).length;
    const underReview = list.filter((f) => ['DRAFT', 'VALIDATING'].includes(String(f.lifecycle_state || '').toUpperCase())).length;
    const rejected = list.filter((f) => ['RETIRED'].includes(String(f.lifecycle_state || '').toUpperCase())).length;
    return { total, approved, modelEligible, behaviorOnly, underReview, rejected };
  }, [features]);

  const openDossier = async (featureName) => {
    const name = String(featureName || '').trim();
    if (!name) return;
    const row = (Array.isArray(features) ? features : []).find((x) => x?.feature_name === name) || null;
    setSelectedRow(row);
    setSelectedFeature(name);
    setDossierOpen(true);
    setDossierTab('origin');
    setDossierLoading(true);
    setOrigin(null); setProfile(null); setDrift(null); setGovernance([]);
    try {
      const [o, p, d, g] = await Promise.all([
        muleApi.getFeatureOrigin(name).catch(() => null),
        muleApi.getFeatureProfile(name).catch(() => null),
        muleApi.getFeatureDrift(name).catch(() => null),
        muleApi.getFeatureGovernanceHistory(name, 50).catch(() => null)
      ]);
      setOrigin(o?.success ? o : null);
      setProfile(p?.profile || null);
      setDrift(d || null);
      setGovernance(g?.history || []);
    } finally {
      setDossierLoading(false);
    }
  };

  const updateStatus = async (nextStatus) => {
    if (!selectedFeature) return;
    const status = String(nextStatus || '').trim();
    if (!status) return;
    await muleApi.approveFeature({ feature: selectedFeature, status });
    await load();
    await openDossier(selectedFeature);
  };

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Box sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 900, letterSpacing: 1.2 }}>GOVERNED FEATURE REGISTRY</Typography>
            <Typography variant="body2" color="text.secondary">Marketplace of governed AML signals · decision view first</Typography>
          </Box>
          <Button variant="outlined" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Chip label={`Total: ${summary.total}`} />
          <Chip label={`Approved: ${summary.approved}`} sx={{ bgcolor: 'rgba(34,197,94,0.12)' }} />
          <Chip label={`Model eligible: ${summary.modelEligible}`} sx={{ bgcolor: 'rgba(34,197,94,0.12)' }} />
          <Chip label={`Behavior only: ${summary.behaviorOnly}`} sx={{ bgcolor: 'rgba(245,158,11,0.12)' }} />
          <Chip label={`Under review: ${summary.underReview}`} sx={{ bgcolor: 'rgba(148,163,184,0.12)' }} />
          <Chip label={`Rejected: ${summary.rejected}`} sx={{ bgcolor: 'rgba(239,68,68,0.12)' }} />
        </Stack>

        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} md={4}>
            <TextField size="small" label="Search" value={query} onChange={(e) => setQuery(e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Family</InputLabel>
              <Select value={filterFamily} label="Family" onChange={(e) => setFilterFamily(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                {families.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={filterStatus} label="Status" onChange={(e) => setFilterStatus(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                {['DRAFT', 'VALIDATING', 'APPROVED', 'PRODUCTION', 'WATCHLIST', 'RETIRED'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Stability</InputLabel>
              <Select value={filterStability} label="Stability" onChange={(e) => setFilterStability(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                {['STABLE', 'DRIFT RISK', 'UNKNOWN'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Validation</InputLabel>
              <Select value={filterValidationMode} label="Validation" onChange={(e) => setFilterValidationMode(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                <MenuItem value="SUPERVISED">Target linked</MenuItem>
                <MenuItem value="BEHAVIORAL">Behavioral only</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Typology</InputLabel>
              <Select value={filterTypology} label="Typology" onChange={(e) => setFilterTypology(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                {typologies.slice(0, 100).map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={8}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ height: '100%' }}>
              <Button size="small" variant="text" onClick={() => { setQuery(''); setFilterFamily(''); setFilterStatus(''); setFilterTypology(''); setFilterStability(''); setFilterValidationMode(''); }}>
                Clear filters
              </Button>
              <Typography variant="body2" color="text.secondary">{filtered.length} features</Typography>
            </Stack>
          </Grid>
        </Grid>

        {loading && <LinearProgress sx={{ mb: 1 }} />}

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {[
                  'Feature Name', 'Family', 'Type', 'Origin', 'Construction Source', 'Typology', 'Evidence', 'Stability', 'Governance', 'Usage'
                ].map((h) => <TableCell key={h} sx={{ fontWeight: 900, fontSize: 11 }}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((r) => {
                const st = String(r.lifecycle_state || '').toUpperCase();
                const c = levelColor(st);
                const stab = stabilityVerdict(r);
                const ev = evidenceBadges(r);
                return (
                  <TableRow
                    key={r.feature_name}
                    hover
                    onClick={() => openDossier(r.feature_name)}
                    sx={{ cursor: 'pointer', background: c.bg }}
                  >
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 800 }}>{r.feature_name}</TableCell>
                    <TableCell>{r.category || '—'}</TableCell>
                    <TableCell>{r.type || '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{String(r.origin_type || '—').toUpperCase()}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{String(r.construction_source || '—')}</TableCell>
                    <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.typology || '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {ev.length ? ev.map((b) => (
                          <Chip key={b.label} size="small" label={b.label} sx={{ height: 22 }} />
                        )) : <Chip size="small" label={Boolean(r.label_available) ? 'TARGET: YES' : 'TARGET: NO'} sx={{ height: 22 }} />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={stab} sx={{ height: 22 }} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={st}
                        sx={{ height: 22, border: `1px solid ${c.border}`, color: c.fg, bgcolor: 'transparent', fontWeight: 900 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={usagePermission(r)} sx={{ height: 22 }} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && !loading && (
                <TableRow>
                  <TableCell colSpan={10}>
                    <Typography variant="body2" color="text.secondary">No features found. Run Feature Engineering first.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Drawer anchor="right" open={dossierOpen} onClose={() => setDossierOpen(false)} PaperProps={{ sx: { width: { xs: '100%', md: 520 }, p: 0 } }}>
        <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography sx={{ fontWeight: 900 }}>FEATURE DOSSIER</Typography>
              <Typography sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>{selectedFeature || '—'}</Typography>
            </Box>
            <Button size="small" onClick={() => setDossierOpen(false)}>Close</Button>
          </Stack>
        </Box>
        <Tabs value={dossierTab} onChange={(_e, v) => setDossierTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab value="origin" label="Signal Origin" />
          <Tab value="evidence" label="Evidence" />
          <Tab value="governance" label="Governance" />
        </Tabs>
        {dossierLoading && <LinearProgress />}
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
            <Button variant="outlined" size="small" onClick={() => updateStatus('VALIDATING')}>Promote to Candidate</Button>
            <Button variant="outlined" size="small" onClick={() => updateStatus('APPROVED')}>Approve for Model</Button>
            <Button variant="outlined" size="small" onClick={() => updateStatus('WATCHLIST')}>Restrict</Button>
            <Button variant="outlined" size="small" onClick={() => updateStatus('RETIRED')}>Retire</Button>
          </Stack>

          {dossierTab === 'origin' && (
            <Stack spacing={2}>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Identity</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip size="small" label={`Family: ${origin?.family || '—'}`} />
                  <Chip size="small" label={`Type: ${origin?.type || '—'}`} />
                  <Chip size="small" label={`Entity: ${origin?.entity_level || 'account'}`} />
                  <Chip size="small" label={`Window: ${origin?.window || '—'}`} />
                  <Chip size="small" label={`Origin: ${String(origin?.origin_type || '—').toUpperCase()}`} />
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Construction Logic</Typography>
                <Typography variant="body2" color="text.secondary">{origin?.construction_logic || origin?.business_meaning || '—'}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Transformation / Formula</Typography>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {origin?.transformation?.body || '—'}
                  </Typography>
                </Paper>
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Code Location</Typography>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {origin?.code_location ? JSON.stringify(origin.code_location, null, 2) : '—'}
                  </Typography>
                </Paper>
              </Box>
            </Stack>
          )}

          {dossierTab === 'evidence' && (
            <Stack spacing={2}>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Decision Evidence</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip size="small" label={selectedRow?.label_available ? 'Target involved: YES' : 'Target involved: NO'} />
                  <Chip size="small" label={selectedRow?.predictive_strength ? `IV: ${selectedRow.predictive_strength}` : 'IV: —'} />
                  <Chip size="small" label={selectedRow?.rarity_verdict ? `Rarity: ${selectedRow.rarity_verdict}` : 'Rarity: —'} />
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Profile</Typography>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {profile ? JSON.stringify(profile, null, 2) : '—'}
                  </Typography>
                </Paper>
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Stability</Typography>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {drift ? JSON.stringify(drift, null, 2) : '—'}
                  </Typography>
                </Paper>
              </Box>
            </Stack>
          )}

          {dossierTab === 'governance' && (
            <Stack spacing={2}>
              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.5 }}>Governance History</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Updated', 'Status', 'Owner', 'Version'].map((h) => <TableCell key={h} sx={{ fontWeight: 900, fontSize: 11 }}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(governance || []).slice(0, 30).map((g, idx) => (
                        <TableRow key={idx}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{String(g.updated_at || '').slice(0, 19) || '—'}</TableCell>
                          <TableCell>{g.status || '—'}</TableCell>
                          <TableCell>{g.owner || '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{String(g.version || '').slice(0, 14) || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {(!governance || governance.length === 0) && (
                        <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No governance history.</Typography></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}
        </Box>
      </Drawer>
    </Box>
  );
};

export default FeatureStoreScreen;
