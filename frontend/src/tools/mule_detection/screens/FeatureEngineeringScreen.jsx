import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Stack,
  Typography,
  LinearProgress,
  Chip,
  Divider,
  Paper,
  Grid,
  Select,
  MenuItem,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  FormControl,
  InputLabel
} from '@mui/material';
import muleApi from '../services/muleApi';
import { pwcColors } from '../theme';

const FeatureEngineeringScreen = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runDetail, setRunDetail] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [selectedFeature, setSelectedFeature] = useState('');
  const [profile, setProfile] = useState(null);
  const [drift, setDrift] = useState(null);
  const [leakage, setLeakage] = useState(null);
  const [compare, setCompare] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState('needs_review');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalOwner, setApprovalOwner] = useState('');
  const [leftRun, setLeftRun] = useState('');
  const [rightRun, setRightRun] = useState('');
  const [config, setConfig] = useState({
    dataset_version: '',
    population: '',
    reference_date: '',
    lookback: '',
    transaction_scope: '',
    segmentation: '',
    families: ''
  });
  const [builder, setBuilder] = useState({
    aggregation: '',
    window: '',
    condition: '',
    normalization: '',
    peer_comparison: ''
  });
  const [candidateTemplate, setCandidateTemplate] = useState('');
  const pollRef = useRef(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadRuns = async () => {
    try {
      const res = await muleApi.getFeatureRunsHistory({ limit: 20 });
      setRuns(res?.runs || []);
    } catch (e) {
      setRuns([]);
    }
  };

  const loadCatalog = async () => {
    try {
      const res = await muleApi.getFeaturesCatalog();
      const list = res?.features || [];
      if (Array.isArray(list) && list.length) {
        setCatalog(list);
        return;
      }
      const fallback = await muleApi.listFeatures();
      const cols = fallback?.features || [];
      setCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null })));
    } catch (e) {
      try {
        const fallback = await muleApi.listFeatures();
        const cols = fallback?.features || [];
        setCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null })));
      } catch {
        setCatalog([]);
      }
    }
  };

  const loadFeaturePanels = async (feature) => {
    if (!feature) return;
    try {
      const [p, d, l, c, lin] = await Promise.all([
        muleApi.getFeatureProfile(feature),
        muleApi.getFeatureDrift(feature),
        muleApi.getFeatureLeakage(feature),
        muleApi.compareFeatures(feature, leftRun || undefined, rightRun || undefined),
        muleApi.getFeatureLineage(feature)
      ]);
      setProfile(p?.profile || null);
      setDrift(d || null);
      setLeakage(l || null);
      setCompare(c || null);
      setLineage(lin?.lineage || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load feature analysis');
    }
  };

  const loadRunDetail = async (runId) => {
    if (!runId) return;
    try {
      const res = await muleApi.getFeatureRunDetails(runId);
      setRunDetail(res?.run || null);
    } catch {
      setRunDetail(null);
    }
  };

  useEffect(() => {
    loadRuns();
    loadCatalog();
    const restore = async () => {
      try {
        const lastJobId = localStorage.getItem('mule_fe_job_id') || undefined;
        const s = await muleApi.getFeatureEngineeringStatus(lastJobId);
        if (s?.success && s?.job_id) {
          setStatus(s);
          localStorage.setItem('mule_fe_job_id', s.job_id);
          if (s?.state === 'running' || s?.state === 'queued') {
            clearPoll();
            pollRef.current = setInterval(async () => {
              try {
                const next = await muleApi.getFeatureEngineeringStatus(s.job_id);
                if (next?.success) setStatus(next);
                if (next?.state === 'completed') {
                  clearPoll();
                  setLoading(false);
                  loadRuns();
                  loadCatalog();
                }
                if (next?.state === 'failed') {
                  clearPoll();
                  setLoading(false);
                  setError(next?.error || 'Feature engineering failed');
                }
              } catch {}
            }, 1000);
          }
        }
      } catch {}
    };
    restore();
    return () => clearPoll();
  }, []);

  const run = async (mode) => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const start = await muleApi.engineerFeatures({ mode, config });
      if (!start?.success) {
        throw new Error(start?.error || 'Failed to start feature engineering');
      }
      const jobId = start.job_id;
      if (jobId) localStorage.setItem('mule_fe_job_id', jobId);
      setStatus({ ...start, step: 'queued', message: 'Queued' });
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const s = await muleApi.getFeatureEngineeringStatus(jobId);
          if (s?.success) setStatus(s);
          if (s?.state === 'completed') {
            clearPoll();
            setLoading(false);
            loadRuns();
            loadCatalog();
          }
          if (s?.state === 'failed') {
            clearPoll();
            setLoading(false);
            setError(s?.error || 'Feature engineering failed');
          }
        } catch (e) {
          clearPoll();
          setLoading(false);
          setError(e?.response?.data?.error || e?.message || 'Failed to fetch status');
        }
      }, 1000);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Feature engineering failed');
      setLoading(false);
    }
  };

  const approveFeature = async (statusValue) => {
    if (!selectedFeature) return;
    try {
      await muleApi.approveFeature({
        feature: selectedFeature,
        status: statusValue,
        comment: approvalComment,
        owner: approvalOwner,
        version: compare?.right_run || compare?.left_run || undefined
      });
      setApprovalStatus(statusValue);
      setApprovalComment('');
      loadCatalog();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to update approval status');
    }
  };

  const runOptions = useMemo(() => runs.map((r) => r.run_id), [runs]);

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
            <CardHeader title="Pipeline Control Center" subheader="Configure and execute reproducible feature runs" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Dataset version"
                        value={config.dataset_version}
                        onChange={(e) => setConfig({ ...config, dataset_version: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Population"
                        value={config.population}
                        onChange={(e) => setConfig({ ...config, population: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Reference date"
                        value={config.reference_date}
                        onChange={(e) => setConfig({ ...config, reference_date: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Lookback definitions"
                        value={config.lookback}
                        onChange={(e) => setConfig({ ...config, lookback: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Transaction scope"
                        value={config.transaction_scope}
                        onChange={(e) => setConfig({ ...config, transaction_scope: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Segmentation"
                        value={config.segmentation}
                        onChange={(e) => setConfig({ ...config, segmentation: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Recompute families"
                        value={config.families}
                        onChange={(e) => setConfig({ ...config, families: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                  </Grid>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" onClick={() => run('run')} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>
                        Run
                      </Button>
                      <Button variant="outlined" onClick={() => run('dry_run')} disabled={loading}>
                        Dry Run
                      </Button>
                      <Button variant="outlined" onClick={() => run('incremental')} disabled={loading}>
                        Incremental
                      </Button>
                    </Stack>
                    {(status?.state === 'running' || status?.state === 'queued') && (
                      <LinearProgress
                        variant={typeof status?.progress_pct === 'number' ? 'determinate' : 'indeterminate'}
                        value={typeof status?.progress_pct === 'number' ? status.progress_pct : 0}
                      />
                    )}
                    {status?.state && (
                      <Chip
                        label={`${status.state?.toUpperCase()} · ${status.step || ''} ${status.message || ''}${typeof status?.progress_pct === 'number' ? ` · ${status.progress_pct.toFixed(1)}%` : ''}${status?.processed_accounts != null && status?.total_accounts != null ? ` · ${status.processed_accounts}/${status.total_accounts}` : ''}${status?.queue_position ? ` · Q${status.queue_position}` : ''}`}
                        sx={{ bgcolor: pwcColors.warningBg, color: pwcColors.warningText }}
                      />
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Run History" subheader="Operational lineage for feature generation" />
            <CardContent>
              {runs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No feature runs found.</Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Run ID</TableCell>
                        <TableCell>Timestamp</TableCell>
                        <TableCell>Duration</TableCell>
                        <TableCell>Features</TableCell>
                        <TableCell>Failures</TableCell>
                        <TableCell>Owner</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {runs.map((r) => (
                        <TableRow key={r.run_id} hover onClick={() => loadRunDetail(r.run_id)}>
                          <TableCell>{r.run_id}</TableCell>
                          <TableCell>{r.timestamp}</TableCell>
                          <TableCell>{r.duration_seconds ?? '-'}</TableCell>
                          <TableCell>{r.features_produced ?? '-'}</TableCell>
                          <TableCell>{r.failures ?? 0}</TableCell>
                          <TableCell>{r.owner || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              {runDetail && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700}>Run Details</Typography>
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    <Chip label={`Run: ${runDetail.run_id}`} />
                    <Chip label={`Dataset: ${runDetail.dataset_version || '-'}`} />
                    <Chip label={`Config: ${runDetail.config_version || '-'}`} />
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Feature Catalog & Build" subheader="Searchable, filterable, comparable registry" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Feature</TableCell>
                          <TableCell>Category</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell>Formula</TableCell>
                          <TableCell>Owner</TableCell>
                          <TableCell>Version</TableCell>
                          <TableCell>Missing %</TableCell>
                          <TableCell>Stability</TableCell>
                          <TableCell>Leakage</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {catalog.map((f) => (
                          <TableRow key={f.feature_name} hover onClick={() => { setSelectedFeature(f.feature_name); loadFeaturePanels(f.feature_name); }}>
                            <TableCell>{f.feature_name}</TableCell>
                            <TableCell>{f.category || '-'}</TableCell>
                            <TableCell>{f.description || '-'}</TableCell>
                            <TableCell>{f.formula || '-'}</TableCell>
                            <TableCell>{f.owner || '-'}</TableCell>
                            <TableCell>{f.version || '-'}</TableCell>
                            <TableCell>{f.missing_pct !== undefined ? `${(Number(f.missing_pct) * 100).toFixed(1)}%` : '-'}</TableCell>
                            <TableCell>{f.stability !== undefined ? Number(f.stability).toFixed(2) : '-'}</TableCell>
                            <TableCell>{f.leakage_risk !== undefined ? Number(f.leakage_risk).toFixed(2) : '-'}</TableCell>
                            <TableCell>{f.approval_status || 'needs_review'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card elevation={0}>
                    <CardHeader title="Feature Builder" subheader="Structured creation blocks" />
                    <CardContent>
                      <Stack spacing={2}>
                        <TextField
                          label="Aggregation"
                          value={builder.aggregation}
                          onChange={(e) => setBuilder({ ...builder, aggregation: e.target.value })}
                          fullWidth
                        />
                        <TextField
                          label="Window"
                          value={builder.window}
                          onChange={(e) => setBuilder({ ...builder, window: e.target.value })}
                          fullWidth
                        />
                        <TextField
                          label="Condition"
                          value={builder.condition}
                          onChange={(e) => setBuilder({ ...builder, condition: e.target.value })}
                          fullWidth
                        />
                        <TextField
                          label="Normalization"
                          value={builder.normalization}
                          onChange={(e) => setBuilder({ ...builder, normalization: e.target.value })}
                          fullWidth
                        />
                        <TextField
                          label="Peer comparison"
                          value={builder.peer_comparison}
                          onChange={(e) => setBuilder({ ...builder, peer_comparison: e.target.value })}
                          fullWidth
                        />
                        <Button variant="outlined">Generate Spec</Button>
                      </Stack>
                    </CardContent>
                  </Card>
                  <Card elevation={0} sx={{ mt: 2 }}>
                    <CardHeader title="Candidate Generation" subheader="Template-driven variations" />
                    <CardContent>
                      <FormControl fullWidth>
                        <InputLabel>Template</InputLabel>
                        <Select
                          value={candidateTemplate}
                          label="Template"
                          onChange={(e) => setCandidateTemplate(e.target.value)}
                        >
                          <MenuItem value="">Select</MenuItem>
                          <MenuItem value="rolling_window">Rolling window × metrics</MenuItem>
                          <MenuItem value="segment_variants">Segment × aggregation</MenuItem>
                          <MenuItem value="peer_benchmark">Peer benchmark</MenuItem>
                        </Select>
                      </FormControl>
                      <Button variant="outlined" sx={{ mt: 2 }}>Generate Candidates</Button>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Generated candidates will appear after execution.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Analysis & Qualification" subheader="Distribution, drift, leakage, correlation, and readiness" />
            <CardContent>
              {!selectedFeature ? (
                <Typography variant="body2" color="text.secondary">Select a feature from the catalog to analyze.</Typography>
              ) : (
                <Stack spacing={3}>
                  <Card elevation={0}>
                    <CardHeader title="Distribution" />
                    <CardContent>
                      {profile?.bins?.length ? (
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {profile.bins.map((b, i) => (
                            <Chip key={i} label={`${Number(b.start).toFixed(2)}–${Number(b.end).toFixed(2)}: ${b.count}`} />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">No distribution data available.</Typography>
                      )}
                    </CardContent>
                  </Card>
                  <Card elevation={0}>
                    <CardHeader title="Missingness & Cardinality" />
                    <CardContent>
                      <Stack direction="row" spacing={2} flexWrap="wrap">
                        <Chip label={`Missing: ${(Number(profile?.missing_pct || 0) * 100).toFixed(2)}%`} />
                        {profile?.cardinality !== undefined && <Chip label={`Cardinality: ${profile.cardinality}`} />}
                        {profile?.mean !== undefined && <Chip label={`Mean: ${Number(profile.mean).toFixed(2)}`} />}
                        {profile?.std !== undefined && <Chip label={`Std: ${Number(profile.std).toFixed(2)}`} />}
                      </Stack>
                    </CardContent>
                  </Card>
                  <Card elevation={0}>
                    <CardHeader title="Drift Metrics" />
                    <CardContent>
                      {drift?.has_results ? (
                        <Stack direction="row" spacing={2} flexWrap="wrap">
                          <Chip label={`Drift score: ${Number(drift.drift_score || 0).toFixed(3)}`} />
                          <Chip label={`Prev mean: ${Number(drift.previous?.mean || 0).toFixed(2)}`} />
                          <Chip label={`Cur mean: ${Number(drift.current?.mean || 0).toFixed(2)}`} />
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">No drift baseline available.</Typography>
                      )}
                    </CardContent>
                  </Card>
                  <Card elevation={0}>
                    <CardHeader title="Leakage Warnings" />
                    <CardContent>
                      {leakage?.has_results ? (
                        <Chip label={`Leakage score: ${Number(leakage.leakage_score || 0).toFixed(2)}`} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">No leakage signal available.</Typography>
                      )}
                    </CardContent>
                  </Card>
                  <Card elevation={0}>
                    <CardHeader title="Version Compare" />
                    <CardContent>
                      <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
                        <Select value={leftRun} onChange={(e) => setLeftRun(e.target.value)} displayEmpty>
                          <MenuItem value="">Left run</MenuItem>
                          {runOptions.map((r) => <MenuItem key={`l-${r}`} value={r}>{r}</MenuItem>)}
                        </Select>
                        <Select value={rightRun} onChange={(e) => setRightRun(e.target.value)} displayEmpty>
                          <MenuItem value="">Right run</MenuItem>
                          {runOptions.map((r) => <MenuItem key={`r-${r}`} value={r}>{r}</MenuItem>)}
                        </Select>
                        <Button variant="outlined" onClick={() => loadFeaturePanels(selectedFeature)}>Compare</Button>
                      </Stack>
                      {compare?.has_results && (
                        <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 2 }}>
                          <Chip label={`Left mean: ${Number(compare.left?.mean || 0).toFixed(2)}`} />
                          <Chip label={`Right mean: ${Number(compare.right?.mean || 0).toFixed(2)}`} />
                          <Chip label={`Left missing: ${(Number(compare.left?.missing_pct || 0) * 100).toFixed(1)}%`} />
                          <Chip label={`Right missing: ${(Number(compare.right?.missing_pct || 0) * 100).toFixed(1)}%`} />
                        </Stack>
                      )}
                    </CardContent>
                  </Card>
                  <Card elevation={0}>
                    <CardHeader title="Lineage & Governance" />
                    <CardContent>
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={2} flexWrap="wrap">
                          <Chip label={`Feature: ${selectedFeature}`} />
                          <Chip label={`Run: ${lineage?.latest_run_id || '-'}`} />
                          <Chip label={`Dataset: ${lineage?.dataset_version || '-'}`} />
                        </Stack>
                        <Divider />
                        <Stack direction="row" spacing={2} flexWrap="wrap">
                          <FormControl sx={{ minWidth: 200 }}>
                            <InputLabel>Status</InputLabel>
                            <Select
                              value={approvalStatus}
                              label="Status"
                              onChange={(e) => setApprovalStatus(e.target.value)}
                            >
                              <MenuItem value="approved">Approve</MenuItem>
                              <MenuItem value="rejected">Reject</MenuItem>
                              <MenuItem value="needs_review">Needs Review</MenuItem>
                              <MenuItem value="retired">Retire</MenuItem>
                            </Select>
                          </FormControl>
                          <TextField
                            label="Owner"
                            value={approvalOwner}
                            onChange={(e) => setApprovalOwner(e.target.value)}
                          />
                          <TextField
                            label="Comment"
                            value={approvalComment}
                            onChange={(e) => setApprovalComment(e.target.value)}
                            fullWidth
                          />
                          <Button variant="contained" onClick={() => approveFeature(approvalStatus)} sx={{ bgcolor: pwcColors.primary }}>
                            Submit
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FeatureEngineeringScreen;
