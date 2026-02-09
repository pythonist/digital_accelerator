import React, { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, CardHeader, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';
import { formatInteger, formatProbability } from '../utils/formatters';

const barColor = (risk) => {
  const r = String(risk || '').toUpperCase();
  if (r === 'HIGH') return '#b91c1c';
  if (r === 'MEDIUM') return '#b45309';
  return '#15803d';
};

const level = (score, thresholds = { high: 0.7, medium: 0.4 }) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'UNKNOWN';
  if (n >= thresholds.high) return 'HIGH';
  if (n >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
};

const BarRow = ({ title, subtitle, pct, color }) => {
  const p = Math.round(Math.max(0, Math.min(1, Number(pct) || 0)) * 100);
  return (
    <Box sx={{ p: 1, borderRadius: 1, bgcolor: '#fff' }}>
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>{title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{subtitle}</Typography>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 800 }}>{p}%</Typography>
      </Stack>
      <Box sx={{ mt: 0.75, height: 8, borderRadius: 10, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
        <Box sx={{ width: `${p}%`, height: '100%', bgcolor: color }} />
      </Box>
    </Box>
  );
};

const InvestigationNetworkPanel = () => {
  const { selectedAccountId, openInvestigation } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [network, setNetwork] = useState(null);
  const [patterns, setPatterns] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!selectedAccountId) return;
      setLoading(true);
      setError(null);
      try {
        const [res, g] = await Promise.all([
          muleApi.explainAccount({ account_id: selectedAccountId, high: 0.7, medium: 0.4 }),
          muleApi.getAccountGraph(selectedAccountId)
        ]);
        if (!res?.success) throw new Error(res?.error || 'Failed to load network');
        setNetwork(res?.layers?.network_context || null);
        setPatterns(g?.patterns || null);
      } catch (e) {
        setNetwork(null);
        setPatterns(null);
        setError(e?.response?.data?.error || e?.message || 'Failed to load network');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedAccountId]);

  const examples = (network?.risky_neighbor_examples || []).slice(0, 8);

  return (
    <Box sx={{ p: 0 }}>
      {error ? <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert> : null}
      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}

      <Card elevation={0}>
        <CardHeader title="Network" subheader="Relationships, clusters, and nearby risk" />
        <CardContent>
          {!selectedAccountId ? (
            <Typography variant="body2" color="text.secondary">Select an account.</Typography>
          ) : !network?.has_results ? (
            <Typography variant="body2" color="text.secondary">No network context available for this account.</Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  Neighbors: {formatInteger(network.neighbor_count || 0)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  High-risk neighbors: {formatInteger(network.risky_neighbors_high || 0)}
                </Typography>
              </Stack>

              {examples.length ? (
                <>
                  <Divider />
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Risky neighbor examples</Typography>
                  <Stack spacing={1}>
                    {examples.map((n) => {
                      const r = level(n.risk_score);
                      return (
                        <Box
                          key={n.account_id}
                          onClick={() => openInvestigation(n.account_id, 'explain')}
                          sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, borderRadius: 1 }}
                        >
                          <BarRow
                            title={n.account_id}
                            subtitle={`Risk ${r} · score ${formatProbability(n.risk_score || 0, 2)}`}
                            pct={Math.max(0, Math.min(1, Number(n.risk_score || 0)))}
                            color={barColor(r)}
                          />
                        </Box>
                      );
                    })}
                  </Stack>
                </>
              ) : null}

              {patterns ? (
                <>
                  <Divider />
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Detected patterns</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {Array.isArray(patterns) && patterns.length ? patterns.slice(0, 6).map((p) => p.title || p.id).join(' · ') : 'No patterns available.'}
                  </Typography>
                </>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default InvestigationNetworkPanel;

