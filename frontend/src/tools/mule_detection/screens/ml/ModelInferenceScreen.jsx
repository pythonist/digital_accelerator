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
  CardHeader
} from '@mui/material';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';
import AccountCard from '../../components/AccountCard';
import { useMuleStore } from '../../store/muleStore';

const ModelInferenceScreen = () => {
  const { openInvestigation } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');

  const [predictions, setPredictions] = useState([]);
  const [runSummary, setRunSummary] = useState(null);
  const [runMeta, setRunMeta] = useState(null);

  const loadModels = async () => {
    try {
      const res = await muleApi.listModels();
      const list = res.models || [];
      setModels(list);
      if (!selectedModel && list.length) setSelectedModel(list[0].model_version);
    } catch {
      setModels([]);
    }
  };

  const loadLast = async () => {
    try {
      const res = await muleApi.getLastRun('ml_inference');
      if (res?.has_results) {
        const r = res.result || {};
        setPredictions(r.predictions || []);
        setRunSummary(r.run_summary || r.runSummary || null);
        setRunMeta({ created_at: res.created_at, model_version: r.model_version });
      }
    } catch {
      return;
    }
  };

  useEffect(() => {
    loadModels();
    loadLast();
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await muleApi.inferModel({ model_version: selectedModel || undefined });
      const t1 = performance.now();
      setPredictions(res.predictions || []);
      setRunSummary(res.run_summary || null);
      setRunMeta({
        created_at: res.run_meta?.created_at,
        model_version: res.model_version,
        processing_time_ms: res.run_meta?.processing_time_ms ?? Math.round(t1 - t0)
      });
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Inference failed');
    } finally {
      setLoading(false);
    }
  };

  const computed = useMemo(() => {
    const preds = predictions || [];
    const high = preds.filter((p) => Number(p.ml_score || 0) >= 0.7).length;
    const med = preds.filter((p) => Number(p.ml_score || 0) >= 0.4 && Number(p.ml_score || 0) < 0.7).length;
    const low = Math.max(0, preds.length - high - med);
    const ms = runMeta?.processing_time_ms;
    return {
      total: preds.length,
      high,
      med,
      low,
      sec: ms != null ? `${Number(ms / 1000).toFixed(2)}s` : '-'
    };
  }, [predictions, runMeta]);

  const topAccounts = useMemo(() => {
    return (predictions || [])
      .slice()
      .sort((a, b) => Number(b.ml_score || 0) - Number(a.ml_score || 0))
      .slice(0, 24)
      .map((p) => {
        const s = Number(p.ml_score || 0);
        const risk_level = s >= 0.7 ? 'HIGH' : s >= 0.4 ? 'MEDIUM' : 'LOW';
        return { account_id: p.account_id, ml_score: s, risk_level };
      });
  }, [predictions]);

  return (
    <Box sx={{ p: 0 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card elevation={0} sx={{ mb: 2 }}>
        <CardHeader
          title="Inference"
          subheader="Run ML inference across accounts and drill into investigation"
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <Button onClick={loadModels} disabled={loading}>
                Refresh Models
              </Button>
              <Button
                variant="contained"
                onClick={run}
                disabled={loading}
                sx={{ bgcolor: pwcColors.primary, '&:hover': { bgcolor: '#c2410c' } }}
              >
                {loading ? 'Running…' : 'Run Inference'}
              </Button>
            </Stack>
          }
        />
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <TextField select size="small" label="Model Version" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} sx={{ minWidth: 280 }}>
              {models.length === 0 ? (
                <MenuItem value="">No models</MenuItem>
              ) : (
                models.map((m) => (
                  <MenuItem key={m.model_version} value={m.model_version}>
                    {m.model_version} · {m.algorithm || 'model'}
                  </MenuItem>
                ))
              )}
            </TextField>
            <Chip label={`Accounts: ${computed.total}`} />
            <Chip label={`HIGH: ${computed.high}`} sx={{ bgcolor: 'rgba(239,68,68,0.12)', color: '#991b1b' }} />
            <Chip label={`MED: ${computed.med}`} sx={{ bgcolor: 'rgba(245,158,11,0.16)', color: '#9a3412' }} />
            <Chip label={`LOW: ${computed.low}`} sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#166534' }} />
            <Chip label={`Time: ${computed.sec}`} />
            {runMeta?.created_at ? <Chip label={`Last Run: ${new Date(runMeta.created_at).toLocaleString()}`} /> : null}
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2} mb={2}>
        {[
          { title: 'Accounts Analyzed', value: computed.total },
          { title: 'High Risk Detected', value: computed.high },
          { title: 'Low Risk', value: computed.low },
          { title: 'Processing Time', value: computed.sec }
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
      </Grid>

      <Card elevation={0}>
        <CardHeader title="Top Risky Accounts" subheader="Investigate why each account is flagged" />
        <CardContent>
          {topAccounts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Run inference to populate accounts.
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {topAccounts.map((a) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={a.account_id}>
                  <AccountCard
                    account={{
                      account_id: a.account_id,
                      ml_score: a.ml_score,
                      risk_level: a.risk_level
                    }}
                    onInvestigate={(id) => openInvestigation(id)}
                  />
                </Grid>
              ))}
            </Grid>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ModelInferenceScreen;
