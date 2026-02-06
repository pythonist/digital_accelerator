import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Grid,
  Typography,
  Stack,
  Chip,
  LinearProgress
} from '@mui/material';
import muleApi from '../services/muleApi';
import AccountCard from '../components/AccountCard';

const MuleDashboard = ({ onAccountSelect, dataStats, onReupload }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [featureReady, setFeatureReady] = useState(false);
  const [feJob, setFeJob] = useState(null);
  const pollRef = useRef(null);

  const getErr = (e, fallback) => {
    const status = e?.response?.status;
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || fallback;
    return status ? `${status}: ${msg}` : msg;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await muleApi.getAccounts();
      const rawList = Array.isArray(raw?.accounts) ? raw.accounts : [];
      setAccounts(rawList);
      setFeatureReady(false);

      try {
        const res = await muleApi.getAccountFeatures({ limit: 2000 });
        const enriched = Array.isArray(res?.accounts) ? res.accounts : [];
        if (enriched.length) {
          const byId = new Map(enriched.map((a) => [String(a.account_id), a]));
          const merged = rawList.map((a) => ({ ...a, ...(byId.get(String(a.account_id)) || {}) }));
          const mergedIds = new Set(merged.map((a) => String(a.account_id)));
          for (const a of enriched) {
            const id = String(a.account_id);
            if (!mergedIds.has(id)) merged.push(a);
          }
          setAccounts(merged);
          setFeatureReady(true);
        }
      } catch {
        setFeatureReady(false);
      }
    } catch (e) {
      const msg = getErr(e, 'Failed to load account features');
      const l = String(msg).toLowerCase();
      const missingFeatures = l.includes('no engineered features') || l.includes('run feature engineering');
      if (missingFeatures) {
        try {
          const raw = await muleApi.getAccounts();
          const list = raw?.accounts || [];
          setAccounts(Array.isArray(list) ? list : []);
          setFeatureReady(false);
        } catch (e2) {
          setAccounts([]);
          setError(getErr(e2, 'Failed to load accounts'));
        }
      } else {
        setAccounts([]);
        setError(msg);
        setFeatureReady(false);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPoll();
  }, []);

  const runFeatureEngineering = async () => {
    setLoading(true);
    setError(null);
    try {
      const startRes = await muleApi.engineerFeatures();
      if (!startRes?.success) {
        throw new Error(startRes?.error || 'Failed to start feature engineering');
      }
      const jobId = startRes.job_id;
      setFeJob({ job_id: jobId, state: startRes.state || 'queued', step: 'queued', message: 'Queued' });
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const s = await muleApi.getFeatureEngineeringStatus(jobId);
          if (s?.success) setFeJob(s);
          if (s?.state === 'completed') {
            clearPoll();
            await load();
          }
          if (s?.state === 'failed') {
            clearPoll();
            setError(s?.error || 'Feature engineering failed');
          }
        } catch (e) {
          clearPoll();
          setError(getErr(e, 'Failed to fetch feature engineering status'));
        }
      }, 1000);
    } catch (e) {
      setError(getErr(e, 'Feature engineering failed'));
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const total = accounts.length;
    const labeled = accounts.filter((a) => a.is_mule === true || a.is_mule === false);
    const muleCount = labeled.filter((a) => a.is_mule === true).length;
    const legitCount = labeled.filter((a) => a.is_mule === false).length;
    return { total, muleCount, legitCount };
  }, [accounts]);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card>
            <CardHeader
              title="Account Analysis Dashboard"
              subheader="Select an account to investigate. Run feature engineering to unlock full intelligence."
              action={
                <Stack direction="row" spacing={1}>
                  <Button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
                  <Button onClick={onReupload}>Re-upload Data</Button>
                </Stack>
              }
            />
            <CardContent>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Chip label={`Total Accounts: ${summary.total}`} />
                <Chip label={`Transactions: ${dataStats?.txn_count ?? dataStats?.num_transactions ?? '-'}`} />
                <Chip label={`Labeled Mule: ${summary.muleCount}`} />
                <Chip label={`Labeled Legit: ${summary.legitCount}`} />
              </Stack>
              <Box sx={{ mt: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  {!featureReady ? (
                    <Button variant="contained" onClick={runFeatureEngineering} disabled={loading || feJob?.state === 'running'}>
                      {feJob?.state === 'running' ? 'Running…' : 'Run Feature Engineering'}
                    </Button>
                  ) : (
                    <Chip label="Feature Engineering: READY" color="success" />
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {feJob?.state ? `Status: ${feJob.state}${feJob.step ? ` · ${feJob.step}` : ''}${feJob.message ? ` · ${feJob.message}` : ''}` : ''}
                  </Typography>
                </Stack>
                {feJob?.state === 'running' && <LinearProgress sx={{ mt: 1 }} />}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardHeader title="Accounts" subheader="Click Investigate to open the investigation panel" />
            <CardContent>
              {accounts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {featureReady ? 'No accounts found.' : 'Run Feature Engineering to unlock engineered metrics.'}
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  {accounts.slice(0, 60).map((a) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={a.account_id}>
                      <AccountCard account={a} onInvestigate={onAccountSelect} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MuleDashboard;
