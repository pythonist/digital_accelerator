// frontend/src/tools/btsy/screens/foundation/NormalizationStep.jsx
// FIXED: Shows existing normalization results, doesn't force re-normalization
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Button, Alert, Chip, CircularProgress,
  Stack, Grid, Card, CardContent, Collapse, IconButton, List, ListItem, ListItemText, LinearProgress
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoIcon from '@mui/icons-material/Info';
import TransformIcon from '@mui/icons-material/Transform';

import btsyApi from '../../services/btsyApi';

const DOMAINS = [
  { key: 'transactions', label: 'Transactions', description: 'Transform transaction data to canonical format' },
  { key: 'accounts', label: 'Accounts', description: 'Transform account data to canonical format' },
  { key: 'customers', label: 'Customers', description: 'Transform customer data to canonical format' },
  { key: 'str', label: 'STR', description: 'Transform STR data to canonical format' }
];

const NormalizationStep = ({ onComplete }) => {
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState({});
  const [normalizationResults, setNormalizationResults] = useState({});
  const [normalizing, setNormalizing] = useState({});
  const [progressByDomain, setProgressByDomain] = useState({});
  const [batchProgress, setBatchProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [expandedDomains, setExpandedDomains] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadProgress(10);
      setError(null);

      const statusRes = await btsyApi.upload.getStatus();
      if (statusRes.success) {
        setUploadStatus(statusRes.data.domains);
      }

      // Load existing normalization results
      const results = {};
      const progress = {};
      for (const domain of DOMAINS) {
        if (statusRes.data.domains[domain.key]?.uploaded) {
          try {
            const res = await btsyApi.normalization.getNormalizationResult(domain.key);
            if (res.success) {
              results[domain.key] = res.data;
              console.log(`[NORMALIZATION] Loaded existing result for ${domain.key}`);
            }
          } catch (err) {
            console.log(`[NORMALIZATION] No existing result for ${domain.key}`);
          }
          try {
            const p = await btsyApi.normalization.getNormalizationProgress(domain.key);
            if (p?.success) {
              progress[domain.key] = p.data?.job || {};
              if (p.data?.result && !results[domain.key]) {
                results[domain.key] = p.data.result;
              }
            }
          } catch {
          }
        }
      }
      setNormalizationResults(results);
      setProgressByDomain(progress);
    } catch (err) {
      setError(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
      setLoadProgress(100);
    }
  };

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setLoadProgress((p) => {
        const cur = Number(p || 0);
        const next = cur + Math.max(1, Math.round((95 - cur) * 0.08));
        return next >= 95 ? 95 : next;
      });
    }, 450);
    return () => clearInterval(id);
  }, [loading]);

  const anyNormalizing = useMemo(() => Object.values(normalizing).some((v) => v), [normalizing]);
  const anyJobRunning = useMemo(() => {
    return Object.values(progressByDomain || {}).some((j) => String(j?.status || '').toLowerCase() === 'running');
  }, [progressByDomain]);

  useEffect(() => {
    if (!anyNormalizing) {
      setBatchProgress(0);
      return;
    }
    setBatchProgress(5);
    const id = setInterval(() => {
      setBatchProgress((p) => {
        const cur = Number(p || 0);
        const next = cur + Math.max(1, Math.round((95 - cur) * 0.08));
        return next >= 95 ? 95 : next;
      });
    }, 450);
    return () => clearInterval(id);
  }, [anyNormalizing]);

  useEffect(() => {
    if (!anyJobRunning) return;
    const id = setInterval(async () => {
      const next = {};
      for (const d of DOMAINS) {
        if (!uploadStatus[d.key]?.uploaded) continue;
        try {
          const p = await btsyApi.normalization.getNormalizationProgress(d.key);
          if (p?.success) {
            next[d.key] = p.data?.job || {};
            if (p.data?.result) {
              setNormalizationResults((prev) => ({ ...prev, [d.key]: p.data.result }));
            }
          }
        } catch {
        }
      }
      if (Object.keys(next).length) {
        setProgressByDomain((prev) => ({ ...prev, ...next }));
      }
    }, 1200);
    return () => clearInterval(id);
  }, [anyJobRunning, uploadStatus]);

  const handleNormalize = async (domainKey) => {
    try {
      setNormalizing(prev => ({ ...prev, [domainKey]: true }));
      setError(null);
      setSuccess(null);

      const res = await btsyApi.normalization.startNormalization(domainKey, { resume: false });
      if (!res?.success) {
        setError(res?.error || 'Normalization failed to start');
        return;
      }
      setProgressByDomain((prev) => ({ ...prev, [domainKey]: { status: 'running', percent: 5, estimated: true } }));
    } catch (err) {
      setError(`Normalization failed: ${err.message}`);
    } finally {
      setNormalizing(prev => ({ ...prev, [domainKey]: false }));
    }
  };

  const handleResume = async (domainKey) => {
    try {
      setNormalizing((prev) => ({ ...prev, [domainKey]: true }));
      setError(null);
      const res = await btsyApi.normalization.startNormalization(domainKey, { resume: true });
      if (!res?.success) {
        setError(res?.error || 'Resume failed to start');
        return;
      }
      setProgressByDomain((prev) => ({ ...prev, [domainKey]: { status: 'running', percent: 5, estimated: true } }));
    } catch (err) {
      setError(`Resume failed: ${err.message}`);
    } finally {
      setNormalizing((prev) => ({ ...prev, [domainKey]: false }));
    }
  };

  const handleNormalizeAll = async () => {
    try {
      setError(null);
      setSuccess(null);

      for (const domain of DOMAINS) {
        if (uploadStatus[domain.key]?.uploaded && !normalizationResults[domain.key]) {
          setNormalizing(prev => ({ ...prev, [domain.key]: true }));
          await btsyApi.normalization.startNormalization(domain.key, { resume: false });
          setNormalizing(prev => ({ ...prev, [domain.key]: false }));
        }
      }

      setSuccess('Normalization started for all pending domains');
    } catch (err) {
      setError(`Batch normalization failed: ${err.message}`);
    }
  };

  const allNormalized = DOMAINS.every(d => {
    const uploaded = uploadStatus[d.key]?.uploaded;
    if (!uploaded) return true;
    return normalizationResults[d.key]?.status === 'success';
  });

  const anyUploaded = DOMAINS.some(d => uploadStatus[d.key]?.uploaded);
  const anyPending = DOMAINS.some(d => uploadStatus[d.key]?.uploaded && !normalizationResults[d.key]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 400, justifyContent: 'center', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading normalization status… {loadProgress.toFixed(0)}% (estimated)
        </Typography>
        <Box sx={{ width: 360 }}>
          <LinearProgress variant="determinate" value={loadProgress} />
        </Box>
      </Box>
    );
  }

  if (!anyUploaded) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Alert severity="info">No data uploaded. Please complete upload step first.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            Data Normalization & Validation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {allNormalized 
              ? 'All domains normalized. Data ready for snapshot.'
              : 'Transform raw bank data to canonical format with type coercion and validation'}
          </Typography>
        </Box>
        <Stack direction="row" gap={2}>
          {anyPending && (
            <Button
              variant="outlined"
              onClick={handleNormalizeAll}
              disabled={anyNormalizing}
              startIcon={<PlayArrowIcon />}
            >
              {anyNormalizing ? 'Normalizing…' : 'Normalize All'}
            </Button>
          )}
          {allNormalized && (
            <Button
              variant="contained"
              onClick={onComplete}
              sx={{ bgcolor: '#D04A02', '&:hover': { bgcolor: '#b03d02' } }}
            >
              Continue to Summary
            </Button>
          )}
        </Stack>
      </Stack>

      {anyNormalizing && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
            Normalizing (estimated)
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            {batchProgress.toFixed(0)}%
          </Typography>
          <LinearProgress variant="determinate" value={batchProgress} />
        </Paper>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {allNormalized && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 3 }}>
          All domains have been normalized. Proceed to summary to create snapshot.
        </Alert>
      )}

      {anyPending && (
        <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
            Normalization prepares data for consistent analysis. It does not generate alerts or make risk decisions.
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            What happens during normalization?
          </Typography>
          <List dense sx={{ pl: 2 }}>
            <ListItem sx={{ py: 0 }}>
              <ListItemText 
                primary="• Type Conversion: Dates → Timestamps, Amounts → Decimals, Flags → Booleans"
                primaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0 }}>
              <ListItemText 
                primary="• Data Cleaning: Remove currency symbols, trim whitespace, normalize text"
                primaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0 }}>
              <ListItemText 
                primary="• Validation: Check critical fields for nulls, verify data quality"
                primaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0 }}>
              <ListItemText 
                primary="• Output: Canonical Parquet files ready for calibration"
                primaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
          </List>
        </Alert>
      )}

      {/* Domain Cards */}
      <Stack spacing={2}>
        {DOMAINS.map(domain => {
          if (!uploadStatus[domain.key]?.uploaded) return null;

          const result = normalizationResults[domain.key];
          const expanded = expandedDomains[domain.key];
          const isNormalizing = normalizing[domain.key];
          const job = progressByDomain[domain.key] || {};
          const jobStatus = String(job.status || '').toLowerCase();
          const jobPercent = typeof job.percent === 'number' ? job.percent : 0;
          const canResume = !result && (jobStatus === 'paused' || jobStatus === 'failed');
          const isRunning = !result && jobStatus === 'running';

          return (
            <Card key={domain.key} variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={2}>
                    <TransformIcon color="primary" />
                    <Box>
                      <Typography variant="h6">{domain.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {result ? '✅ Normalized' : (job?.message || domain.description)}
                      </Typography>
                    </Box>
                    {result?.status === 'success' && (
                      <Chip icon={<CheckCircleIcon />} label="Complete" color="success" size="small" />
                    )}
                    {result?.status === 'failed' && (
                      <Chip icon={<ErrorIcon />} label="Failed" color="error" size="small" />
                    )}
                    {!result && isRunning && (
                      <Chip label="Running" color="warning" size="small" />
                    )}
                    {!result && jobStatus === 'paused' && (
                      <Chip label={`Paused ${jobPercent.toFixed(0)}%`} color="warning" size="small" variant="outlined" />
                    )}
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    {result && (
                      <IconButton size="small" onClick={() => setExpandedDomains(prev => ({ ...prev, [domain.key]: !prev[domain.key] }))}>
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    )}
                    {!result && !canResume && (
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleNormalize(domain.key)}
                        disabled={isNormalizing || isRunning}
                        startIcon={(isNormalizing || isRunning) ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                      >
                        {(isNormalizing || isRunning) ? 'Normalizing…' : 'Normalize'}
                      </Button>
                    )}
                    {canResume && (
                      <Button
                        variant="contained"
                        size="small"
                        color="warning"
                        onClick={() => handleResume(domain.key)}
                        disabled={isNormalizing}
                        startIcon={isNormalizing ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                      >
                        {isNormalizing ? 'Resuming…' : 'Resume'}
                      </Button>
                    )}
                  </Stack>
                </Stack>

                {!result && (isRunning || jobStatus === 'paused' || jobStatus === 'failed') && (
                  <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid #e2e8f0', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
                      {job?.phase ? `Phase: ${job.phase}` : 'Normalization progress'} {job?.estimated ? '(estimated)' : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                      {jobPercent.toFixed(0)}%
                    </Typography>
                    <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, jobPercent))} />
                    {jobStatus === 'failed' && job?.message && (
                      <Alert severity="error" sx={{ mt: 2 }}>{job.message}</Alert>
                    )}
                  </Paper>
                )}

                {result && (
                  <>
                    <Grid container spacing={2}>
                      <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary">Input Rows</Typography>
                        <Typography variant="h6">{result.input_rows?.toLocaleString() || 0}</Typography>
                      </Grid>
                      <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary">Output Rows</Typography>
                        <Typography variant="h6">{result.output_rows?.toLocaleString() || 0}</Typography>
                      </Grid>
                      <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary">Validation Errors</Typography>
                        <Typography variant="h6" color={result.validation_errors > 0 ? 'error.main' : 'success.main'}>
                          {result.validation_errors || 0}
                        </Typography>
                      </Grid>
                      <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary">Duration</Typography>
                        <Typography variant="h6">{result.duration_ms ? `${(result.duration_ms / 1000).toFixed(2)}s` : '-'}</Typography>
                      </Grid>
                    </Grid>

                    <Collapse in={expanded}>
                      <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                        {Array.isArray(result.breakdown) && result.breakdown.length > 0 && (
                          <>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>Normalization Summary (Read‑Only)</Typography>
                            <Grid container spacing={1} sx={{ mb: 2 }}>
                              {result.breakdown.map((b) => (
                                <Grid item xs={12} md={6} key={b.normalization_type}>
                                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{b.normalization_type}</Typography>
                                      <Chip size="small" label={b.applied ? 'Yes' : 'No'} color={b.applied ? 'success' : 'default'} variant="outlined" />
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary">
                                      Rows affected: {(b.rows_affected || 0).toLocaleString()}
                                    </Typography>
                                  </Paper>
                                </Grid>
                              ))}
                            </Grid>
                          </>
                        )}

                        {result.field_stats && (
                          <>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>Before / After Statistics (Key Fields)</Typography>
                            <Grid container spacing={1} sx={{ mb: 2 }}>
                              {['transaction_id','account_id','customer_id','transaction_datetime','transaction_amount'].filter((k) => result.field_stats[k]).map((k) => {
                                const s = result.field_stats[k];
                                return (
                                  <Grid item xs={12} md={6} key={k}>
                                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 900, fontFamily: 'monospace' }}>{k}</Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        Source: <Box component="span" sx={{ fontFamily: 'monospace' }}>{s.source_column_name}</Box> ({s.source_type || '—'})
                                      </Typography>
                                      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                                        <Box sx={{ flex: 1 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 800 }}>Before</Typography>
                                          <Typography variant="caption" color="text.secondary" display="block">Nulls: {s.before?.nulls ?? '—'}</Typography>
                                          {typeof s.before?.min !== 'undefined' && <Typography variant="caption" color="text.secondary" display="block">Min: {String(s.before?.min ?? '—')}</Typography>}
                                          {typeof s.before?.max !== 'undefined' && <Typography variant="caption" color="text.secondary" display="block">Max: {String(s.before?.max ?? '—')}</Typography>}
                                        </Box>
                                        <Box sx={{ flex: 1 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 800 }}>After</Typography>
                                          <Typography variant="caption" color="text.secondary" display="block">Nulls: {s.after?.nulls ?? '—'}</Typography>
                                          {typeof s.after?.min !== 'undefined' && <Typography variant="caption" color="text.secondary" display="block">Min: {String(s.after?.min ?? '—')}</Typography>}
                                          {typeof s.after?.max !== 'undefined' && <Typography variant="caption" color="text.secondary" display="block">Max: {String(s.after?.max ?? '—')}</Typography>}
                                        </Box>
                                      </Stack>
                                      {typeof s.changed_rows === 'number' && (
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                          Rows changed: {s.changed_rows.toLocaleString()} • Nulls introduced: {(s.nulls_introduced || 0).toLocaleString()}
                                        </Typography>
                                      )}
                                    </Paper>
                                  </Grid>
                                );
                              })}
                            </Grid>
                          </>
                        )}

                        {result.transformations && result.transformations.length > 0 && (
                          <>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>Transformations Applied:</Typography>
                            <Stack spacing={0.5}>
                              {result.transformations.map((t, i) => (
                                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                                  <Typography variant="caption">
                                    <strong>{t.field}:</strong> {t.transformation}
                                  </Typography>
                                </Box>
                              ))}
                            </Stack>
                          </>
                        )}
                        {result.validation_warnings && result.validation_warnings.length > 0 && (
                          <>
                            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Validation Warnings:</Typography>
                            <Stack spacing={0.5}>
                              {result.validation_warnings.map((w, i) => (
                                <Alert key={i} severity="warning" sx={{ py: 0.5 }}>
                                  {w}
                                </Alert>
                              ))}
                            </Stack>
                          </>
                        )}
                        {result.error && (
                          <>
                            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Error:</Typography>
                            <Alert severity="error">{result.error}</Alert>
                          </>
                        )}
                      </Box>
                    </Collapse>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
};

export default NormalizationStep;
