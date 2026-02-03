import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';

import btsyApi from '../../services/btsyApi';

const DOMAINS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'customers', label: 'Customers' },
  { key: 'str', label: 'STR' }
];

const DataTypeReviewStep = ({ onComplete }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [uploadStatus, setUploadStatus] = useState({});
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState({ open: false, loading: false, row: null, result: null, error: null });

  const availableDomains = useMemo(() => DOMAINS.filter((d) => uploadStatus[d.key]?.uploaded), [uploadStatus]);
  const currentDomainKey = availableDomains[activeTab]?.key;

  const totalLocked = useMemo(() => {
    let locked = 0;
    let total = 0;
    for (const d of availableDomains) {
      const p = plans[d.key];
      const fields = p?.fields || [];
      total += fields.length;
      locked += fields.filter((f) => f.locked).length;
    }
    return { locked, total };
  }, [plans, availableDomains]);

  const allLocked = totalLocked.total > 0 && totalLocked.locked === totalLocked.total;

  const loadAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const statusRes = await btsyApi.upload.getStatus();
      if (statusRes?.success) {
        setUploadStatus(statusRes.data.domains || {});
      }
      const nextPlans = {};
      for (const d of DOMAINS) {
        if (statusRes?.data?.domains?.[d.key]?.uploaded) {
          const res = await btsyApi.dtypes.getPlan(d.key);
          if (res?.success) {
            nextPlans[d.key] = res.data;
          }
        }
      }
      setPlans(nextPlans);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const currentPlan = currentDomainKey ? plans[currentDomainKey] : null;
  const rows = currentPlan?.fields || [];

  const openDetail = async (row) => {
    setDetail({ open: true, loading: true, row, result: null, error: null });
    try {
      const res = await btsyApi.dtypes.validate(currentDomainKey, {
        field_kind: row.field_kind,
        field_key: row.field_key,
        proposed_type: row.proposed_type,
        sample_size: 50
      });
      if (!res?.success) {
        setDetail((p) => ({ ...p, loading: false, error: res?.error || 'Validation failed' }));
        return;
      }
      setDetail((p) => ({ ...p, loading: false, result: res.data }));
    } catch (e) {
      setDetail((p) => ({ ...p, loading: false, error: e.message || String(e) }));
    }
  };

  const lockField = async (row) => {
    try {
      setBusy(true);
      setError(null);
      const res = await btsyApi.dtypes.lock(currentDomainKey, {
        field_kind: row.field_kind,
        field_key: row.field_key,
        proposed_type: row.proposed_type,
        sample_size: 200
      });
      if (!res?.success) {
        setError(res?.error || 'Lock failed');
        return;
      }
      await loadAll();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    const pct = totalLocked.total ? (totalLocked.locked / totalLocked.total) * 100 : 5;
    return (
      <Box sx={{ minHeight: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading datatype review… {pct.toFixed(0)}% (estimated)
        </Typography>
        <Box sx={{ width: 380 }}>
          <LinearProgress variant="indeterminate" />
        </Box>
      </Box>
    );
  }

  if (availableDomains.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Alert severity="info">No uploaded domains. Complete upload first.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 2 }} gap={2}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Data Type Review & Locking
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Lock datatypes for canonical and extension fields. No silent coercion.
          </Typography>
        </Box>
        <Stack spacing={1} sx={{ minWidth: 260 }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            Fields locked: {totalLocked.locked} / {totalLocked.total}
          </Typography>
          <LinearProgress variant="determinate" value={totalLocked.total ? (totalLocked.locked / totalLocked.total) * 100 : 0} />
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!allLocked && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          Datatype locking is incomplete. Lock all fields to continue.
        </Alert>
      )}

      {allLocked && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
          All field datatypes are locked. Safe to proceed.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
          {availableDomains.map((d) => (
            <Tab key={d.key} label={d.label} />
          ))}
        </Tabs>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 800 }}>Source Column</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Mapped Name</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Source Type</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Proposed Type</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Risk</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 800 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.field_kind}:${r.field_key}`} hover>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.source_column_name}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.mapped_name}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.source_type || '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.proposed_type}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={r.risk || 'LOW'}
                    color={r.risk === 'HIGH' ? 'error' : 'default'}
                    variant="outlined"
                    sx={{ fontWeight: 800 }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={(r.status || (r.locked ? 'locked' : 'pending')).toUpperCase()}
                    color={r.locked ? 'success' : 'warning'}
                    variant={r.locked ? 'filled' : 'outlined'}
                    sx={{ fontWeight: 900 }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<VisibilityIcon />}
                      onClick={() => openDetail(r)}
                      sx={{ textTransform: 'none', fontWeight: 800 }}
                    >
                      Review
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<LockIcon />}
                      disabled={busy || r.locked}
                      onClick={() => lockField(r)}
                      sx={{ textTransform: 'none', fontWeight: 800 }}
                    >
                      Lock
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">
                    No fields to review for this domain.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" disabled={!allLocked} onClick={onComplete} sx={{ fontWeight: 900 }}>
          Continue to Normalization
        </Button>
      </Stack>

      <Dialog open={detail.open} onClose={() => setDetail({ open: false, loading: false, row: null, result: null, error: null })} maxWidth="md" fullWidth>
        <DialogTitle>Field Review</DialogTitle>
        <DialogContent dividers>
          {detail.loading && (
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Validating datatypes… (estimated)
              </Typography>
              <LinearProgress sx={{ mt: 1 }} />
            </Box>
          )}
          {detail.error && <Alert severity="error">{detail.error}</Alert>}
          {!detail.loading && detail.result && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                  Validation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Proposed type: <Box component="span" sx={{ fontFamily: 'monospace' }}>{detail.result.proposed_type}</Box>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Rows checked: {detail.result.sample_size} / {detail.result.total_non_null_rows}
                </Typography>
              </Box>

              {detail.result.ok ? (
                <Alert severity="success" icon={<CheckCircleIcon />}>
                  Validation passed. Locking is allowed.
                </Alert>
              ) : (
                <Alert severity="error">
                  Validation failed: {(detail.result.failures || []).join(' | ') || 'Unknown'}
                </Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
                  Checks
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {Object.entries(detail.result.checks || {}).map(([k, v]) => (
                    <Chip
                      key={k}
                      size="small"
                      label={`${k}: ${v.pass ? 'PASS' : 'FAIL'}`}
                      color={v.pass ? 'success' : 'error'}
                      variant="outlined"
                      sx={{ fontFamily: 'monospace', fontWeight: 800 }}
                    />
                  ))}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
                  Samples
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 900 }}>Raw</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>After Conversion</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail.result.raw_samples || []).map((v, idx) => (
                      <TableRow key={idx}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{String(v)}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{String((detail.result.cast_samples || [])[idx] ?? '')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail({ open: false, loading: false, row: null, result: null, error: null })} sx={{ fontWeight: 800 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DataTypeReviewStep;

