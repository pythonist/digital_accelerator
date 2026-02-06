import React, { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, CardHeader, Alert, Typography, Grid, Stack, Chip } from '@mui/material';
import muleApi from '../services/muleApi';
import AccountCard from '../components/AccountCard';
import AccountSelector from '../components/AccountSelector';

const PatternAnalysisScreen = ({ onAccountSelect }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [top, setTop] = useState(null);
  const [methodology, setMethodology] = useState([]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.getMoneyFlowPatterns();
      setPatterns(res.patterns || []);
      setSummary(res.summary || null);
      setTop(res.top || null);
      setMethodology(res.methodology || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Pattern analysis failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
  }, []);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Card elevation={0} sx={{ mb: 2 }}>
        <CardContent>
          <AccountSelector dense />
        </CardContent>
      </Card>
      <Card elevation={0}>
        <CardHeader
          title="Pattern Analysis"
          subheader="Money flow graph behaviors detected from time-ordered transaction paths"
          action={<Button onClick={run} disabled={loading}>{loading ? 'Running…' : 'Re-run'}</Button>}
        />
        <CardContent>
          {patterns.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No results yet.</Typography>
          ) : (
            <Stack spacing={2}>
              {summary ? (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label={`Total: ${summary.total_accounts ?? patterns.length}`} />
                  <Chip label={`Flagged: ${summary.flagged_accounts ?? 0}`} sx={{ bgcolor: 'rgba(239,68,68,0.12)', color: '#991b1b' }} />
                  <Chip label={`Pass-through: ${summary.pass_through_accounts ?? 0}`} />
                  <Chip label={`Circular: ${summary.circular_chain_accounts ?? 0}`} />
                  <Chip label={`Multi-hop: ${summary.multi_hop_chain_accounts ?? 0}`} />
                  <Chip label={`Bursts: ${summary.velocity_burst_accounts ?? 0}`} />
                </Stack>
              ) : null}

              <Grid container spacing={2}>
                {[
                  { key: 'pass_through', title: 'Pass-Through', sub: 'Funds exit within 1 hour after entry' },
                  { key: 'circular', title: 'Circular Chains', sub: 'A → B → C → A style loops' },
                  { key: 'multi_hop', title: 'Multi-Hop Chains', sub: 'A → B → C → D propagation' },
                  { key: 'velocity_burst', title: 'Velocity Bursts', sub: 'Multiple hops in a short time window' }
                ].map((c) => (
                  <Grid item xs={12} md={6} key={c.key}>
                    <Card variant="outlined">
                      <CardHeader title={c.title} subheader={c.sub} />
                      <CardContent>
                        {Array.isArray(top?.[c.key]) && top[c.key].length > 0 ? (
                          <Grid container spacing={2}>
                            {top[c.key].slice(0, 6).map((a) => (
                              <Grid item xs={12} sm={6} key={`${c.key}-${a.account_id}`}>
                                <AccountCard
                                  account={{
                                    account_id: a.account_id,
                                    hybrid_score: a.flow_score,
                                    risk_level: a.risk_level
                                  }}
                                  onInvestigate={(id) => onAccountSelect && onAccountSelect(id)}
                                />
                              </Grid>
                            ))}
                          </Grid>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No accounts matched this pattern.
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {Array.isArray(methodology) && methodology.length > 0 ? (
                <Card variant="outlined">
                  <CardHeader title="Methodology" subheader="How patterns are computed" />
                  <CardContent>
                    <Stack spacing={0.5}>
                      {methodology.map((m) => (
                        <Typography key={m} variant="body2" color="text.secondary">
                          {m}
                        </Typography>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default PatternAnalysisScreen;
