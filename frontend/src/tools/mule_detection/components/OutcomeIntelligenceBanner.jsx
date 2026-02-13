import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import muleApi from '../services/muleApi';

const OutcomeIntelligenceBanner = ({ dense = false }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(() => localStorage.getItem('mule_feature_mode') || 'behavioral');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await muleApi.getTargetSummary('is_mule');
        if (!mounted) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError(e?.response?.data?.error || e?.message || 'Failed to load outcome intelligence');
      }
    };
    load();
    const onStorage = (ev) => {
      if (ev.key === 'mule_feature_mode') {
        setMode(localStorage.getItem('mule_feature_mode') || 'behavioral');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mounted = false;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const usable = Boolean(data?.usable_for_supervised_learning);
  const effectiveMode = usable ? (mode === 'outcome' ? 'outcome' : 'behavioral') : 'behavioral';

  useEffect(() => {
    if (!usable) {
      localStorage.setItem('mule_feature_mode', 'behavioral');
      setMode('behavioral');
    }
  }, [usable]);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: dense ? 1.25 : 2,
        mb: 2,
        borderColor: usable ? 'rgba(15, 23, 42, 0.15)' : 'rgba(239, 68, 68, 0.35)',
        bgcolor: usable ? '#ffffff' : 'rgba(254, 242, 242, 0.55)'
      }}
    >
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontWeight: 900, letterSpacing: 1.2, fontSize: dense ? '0.75rem' : '0.8rem', color: '#0f172a' }}>
              OUTCOME INTELLIGENCE
            </Typography>
            <Typography sx={{ fontSize: dense ? '0.7rem' : '0.75rem', color: 'rgba(15, 23, 42, 0.7)' }}>
              Feature = governed risk asset
            </Typography>
          </Box>
          <Chip
            label={effectiveMode === 'outcome' ? 'Outcome Linked Mode' : 'Behavioral Intelligence Mode'}
            size="small"
            sx={{
              bgcolor: effectiveMode === 'outcome' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.14)',
              color: effectiveMode === 'outcome' ? '#166534' : '#92400e',
              fontWeight: 800
            }}
          />
          {usable && (
            <Chip
              label="Usable for supervised learning"
              size="small"
              sx={{ bgcolor: 'rgba(34, 197, 94, 0.12)', color: '#166534', fontWeight: 700 }}
            />
          )}
        </Box>

        {error && (
          <Alert severity="warning" variant="outlined">
            {error}
          </Alert>
        )}

        {!error && data && !usable && (
          <Alert severity="warning" variant="outlined">
            Outcome labels unavailable. System running in Behavioral Intelligence Mode.
          </Alert>
        )}

        {!error && data && usable && (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip label={`Target: ${data.target_name || 'is_mule'}`} size="small" />
            <Chip label={`Positive rate: ${(Number(data.positive_rate || 0) * 100).toFixed(2)}%`} size="small" />
            <Chip label={`Positives: ${data.positives ?? '-'}`} size="small" />
            <Chip label={`Negatives: ${data.negatives ?? '-'}`} size="small" />
            <Chip label={`Population: ${data.population ?? '-'}`} size="small" />
            <Chip label={`Coverage: ${data.coverage_start || '-'} → ${data.coverage_end || '-'}`} size="small" />
            <Chip label={`Source: ${data.source_system || '-'}`} size="small" />
            <Chip label={`Freshness: ${data.last_refresh || '-'}`} size="small" />
            <Chip label={`Approved by: ${data.approved_by || '-'}`} size="small" />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};

export default OutcomeIntelligenceBanner;
