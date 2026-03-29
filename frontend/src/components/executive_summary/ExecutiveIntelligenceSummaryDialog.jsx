import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import apiClient from '@services/api';
import WorkflowGraphDialog from './WorkflowGraphDialog';

const PHASE_COLORS = {
  FCC: { chipBg: '#fff7ed', chipText: '#9a3412', rail: '#f97316' },
  Bridge: { chipBg: '#fef3c7', chipText: '#92400e', rail: '#f59e0b' },
  Sentinel: { chipBg: '#eff6ff', chipText: '#1d4ed8', rail: '#2563eb' },
  Decision: { chipBg: '#fdf2f8', chipText: '#9d174d', rail: '#db2777' },
};

const tonePalette = {
  default: { bg: '#ffffff', border: '#e2e8f0', value: '#0f172a' },
  positive: { bg: '#f0fdf4', border: '#86efac', value: '#166534' },
  warning: { bg: '#fff7ed', border: '#fdba74', value: '#9a3412' },
  risk: { bg: '#fff1f2', border: '#fda4af', value: '#be123c' },
};

const chartColors = ['#f97316', '#2563eb', '#22c55e', '#7c3aed', '#f59e0b'];

const HeroMetric = ({ item }) => {
  const tone = tonePalette[item?.tone] || tonePalette.default;
  return (
    <Box
      sx={{
        minWidth: 220,
        flex: 1,
        borderRadius: 3,
        border: `1px solid ${tone.border}`,
        bgcolor: tone.bg,
        p: 2,
      }}
    >
      <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', letterSpacing: 0.45, textTransform: 'uppercase' }}>
        {item?.phase}
      </Typography>
      <Typography sx={{ mt: 0.6, fontSize: 28, lineHeight: 1, fontWeight: 800, color: tone.value }}>
        {item?.value}
      </Typography>
      <Typography sx={{ mt: 0.75, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
        {item?.label}
      </Typography>
    </Box>
  );
};

const MetricPill = ({ metric }) => (
  <Box
    sx={{
      minWidth: 132,
      borderRadius: 2,
      bgcolor: '#f8fafc',
      border: '1px solid #e2e8f0',
      px: 1.25,
      py: 1,
    }}
  >
    <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.35 }}>
      {metric?.label}
    </Typography>
    <Typography sx={{ mt: 0.45, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
      {metric?.value}
    </Typography>
  </Box>
);

const renderVisual = (visual) => {
  const type = String(visual?.type || '').trim();
  const data = Array.isArray(visual?.data) ? visual.data : [];
  if (!type) return null;

  if (type === 'donut') {
    return (
      <Box sx={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={54} outerRadius={84}>
              {data.map((item, index) => (
                <Cell key={`${item.label}-${index}`} fill={item.color || chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (['bars', 'comparison', 'stacked', 'decision_bars'].includes(type)) {
    return (
      <Box sx={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((item, index) => (
                <Cell key={`${item.label}-${index}`} fill={item.color || chartColors[index % chartColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (type === 'funnel') {
    return (
      <Box sx={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={128} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (type === 'tradeoff') {
    return (
      <Box sx={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="suppression_pct" stroke="#f97316" fill="#fed7aa" />
            <Area type="monotone" dataKey="event_loss_pct" stroke="#2563eb" fill="#bfdbfe" />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (type === 'flow') {
    return (
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center" sx={{ pt: 0.5 }}>
        {data.map((item, index) => (
          <React.Fragment key={`${item.label}-${index}`}>
            <Box
              sx={{
                minWidth: 150,
                borderRadius: 999,
                border: '1px solid #e2e8f0',
                bgcolor: index === 1 ? '#f0fdf4' : index === 2 ? '#eff6ff' : '#ffffff',
                px: 1.6,
                py: 1,
              }}
            >
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.35 }}>
                {item.label}
              </Typography>
              <Typography sx={{ mt: 0.35, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                {Number(item.value || 0).toLocaleString()}
              </Typography>
            </Box>
            {index < data.length - 1 ? (
              <Typography sx={{ fontSize: 20, color: '#f97316', lineHeight: 1 }}>→</Typography>
            ) : null}
          </React.Fragment>
        ))}
      </Stack>
    );
  }

  if (type === 'insight_list') {
    return (
      <Stack spacing={1.05}>
        {data.map((item) => (
          <Box key={item.label} sx={{ borderRadius: 2, border: '1px solid #e2e8f0', bgcolor: '#f8fafc', px: 1.4, py: 1.15 }}>
            <Typography sx={{ fontSize: 13.5, color: '#0f172a', fontWeight: 700 }}>
              {item.label}
            </Typography>
          </Box>
        ))}
      </Stack>
    );
  }

  if (type === 'summary_block') {
    return (
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
        {data.map((item) => (
          <MetricPill key={item.label} metric={{ label: item.label, value: Number(item.value || 0).toLocaleString() }} />
        ))}
      </Stack>
    );
  }

  return null;
};

const TimelineStepCard = ({ step, index, active, onOpenModule }) => {
  const phaseTone = PHASE_COLORS[step?.phase] || PHASE_COLORS.FCC;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '74px 1fr' }, gap: 2 }}>
      <Stack alignItems="center" sx={{ position: 'relative', pt: 0.3 }}>
        <Box
          sx={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            bgcolor: active ? phaseTone.rail : '#ffffff',
            color: active ? '#ffffff' : phaseTone.chipText,
            border: `2px solid ${phaseTone.rail}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 800,
            boxShadow: active ? '0 10px 26px rgba(15,23,42,0.12)' : 'none',
          }}
        >
          {index + 1}
        </Box>
        <Box sx={{ mt: 1, width: 2, flex: 1, minHeight: 42, bgcolor: '#e2e8f0', display: { xs: 'none', md: 'block' } }} />
      </Stack>

      <Box
        sx={{
          borderRadius: 3,
          border: active ? `1px solid ${phaseTone.rail}` : '1px solid #e2e8f0',
          bgcolor: '#ffffff',
          p: 2.2,
          boxShadow: active ? '0 12px 34px rgba(15,23,42,0.08)' : 'none',
        }}
      >
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between">
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <Chip
                size="small"
                label={step?.phase}
                sx={{
                  bgcolor: phaseTone.chipBg,
                  color: phaseTone.chipText,
                  border: 'none',
                  fontWeight: 700,
                }}
              />
              <Typography sx={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                Guided execution step
              </Typography>
            </Stack>
            <Typography sx={{ mt: 1.2, fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
              {step?.title}
            </Typography>
            <Typography sx={{ mt: 1.1, fontSize: 14.5, color: '#334155', lineHeight: 1.8 }}>
              {step?.description}
            </Typography>
          </Box>
          {step?.cta?.label ? (
            <Button
              variant="outlined"
              onClick={() => onOpenModule?.(step?.cta, step)}
              sx={{
                alignSelf: { xs: 'flex-start', lg: 'flex-start' },
                textTransform: 'none',
                borderColor: '#fdba74',
                color: '#c2410c',
              }}
            >
              {step.cta.label}
            </Button>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          {(step?.metrics || []).map((metric) => (
            <MetricPill key={`${step.id}-${metric.label}`} metric={metric} />
          ))}
        </Stack>

        <Box sx={{ mt: 2.2, borderRadius: 2.5, border: '1px solid #e2e8f0', bgcolor: '#fcfcfd', p: 1.75 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {step?.visual?.title || 'Step visual'}
          </Typography>
          <Box sx={{ mt: 1.5 }}>{renderVisual(step?.visual)}</Box>
        </Box>

        {(step?.highlights || []).length ? (
          <Stack spacing={0.7} sx={{ mt: 1.8 }}>
            {(step.highlights || []).map((item) => (
              <Typography key={item} sx={{ fontSize: 13.6, color: '#475569', lineHeight: 1.75 }}>
                • {item}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Box>
    </Box>
  );
};

const ExecutiveIntelligenceSummaryDialog = ({ open, onClose, context = {}, onOpenModule }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeStepId, setActiveStepId] = useState('');

  const params = useMemo(
    () => ({
      run_id: context?.runId || undefined,
      pipeline_id: context?.pipelineId || undefined,
      publish_id: context?.publishId || undefined,
    }),
    [context?.pipelineId, context?.publishId, context?.runId],
  );

  const timelineSteps = Array.isArray(summary?.timeline_steps) ? summary.timeline_steps : [];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await apiClient.getExecutiveIntelligenceSummary(params);
        if (!cancelled) {
          const payload = response?.summary || null;
          setSummary(payload);
          setActiveStepId((payload?.timeline_steps || [])[0]?.id || '');
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || 'Unable to load executive summary.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, params]);

  useEffect(() => {
    if (!playing || !timelineSteps.length) return undefined;
    const currentIndex = Math.max(0, timelineSteps.findIndex((step) => step.id === activeStepId));
    const timer = setTimeout(() => {
      if (currentIndex >= timelineSteps.length - 1) {
        setPlaying(false);
        return;
      }
      setActiveStepId(timelineSteps[currentIndex + 1]?.id || '');
    }, 1400);
    return () => clearTimeout(timer);
  }, [activeStepId, playing, timelineSteps]);

  const handlePlay = () => {
    if (!timelineSteps.length) return;
    if (!playing) {
      setActiveStepId(timelineSteps[0]?.id || '');
    }
    setPlaying((previous) => !previous);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
        <DialogTitle sx={{ pb: 1.2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>
                Executive Intelligence Summary
              </Typography>
              <Typography sx={{ mt: 0.75, fontSize: 14, color: '#64748b', maxWidth: 980 }}>
                A guided FCC-to-Sentinel execution timeline that explains what happened, why it matters, and how the retained workload turned into investigation and reporting decisions.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" onClick={handlePlay} sx={{ textTransform: 'none', borderColor: '#cbd5e1', color: '#0f172a' }}>
                {playing ? 'Pause Execution' : 'Play Execution'}
              </Button>
              <Button variant="outlined" onClick={() => setGraphOpen(true)} sx={{ textTransform: 'none', borderColor: '#fdba74', color: '#c2410c' }}>
                View Workflow Graph
              </Button>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {loading ? (
            <Box sx={{ py: 4 }}>
              <Stack spacing={1.2} alignItems="center">
                <CircularProgress size={28} sx={{ color: '#f97316' }} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  Building FCC to Sentinel business storyline
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
                  {[
                    'Reading FCC alert and threshold results',
                    'Connecting retained flow into Sentinel',
                    'Summarizing investigation decisions',
                    'Preparing guided execution timeline',
                  ].map((item) => (
                    <Chip key={item} label={item} sx={{ bgcolor: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74' }} />
                  ))}
                </Stack>
              </Stack>
              <Stack spacing={2} sx={{ mt: 3 }}>
                <Skeleton variant="rounded" height={120} />
                <Skeleton variant="rounded" height={240} />
                <Skeleton variant="rounded" height={240} />
              </Stack>
            </Box>
          ) : null}

          {!loading && error ? <Alert severity="error">{error}</Alert> : null}

          {!loading && !error && summary ? (
            <Stack spacing={2.5}>
              <Box sx={{ borderRadius: 3, border: '1px solid #e2e8f0', bgcolor: '#ffffff', p: 2.4 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                  {summary?.hero?.headline}
                </Typography>
                <Typography sx={{ mt: 1.2, fontSize: 14.5, color: '#475569', lineHeight: 1.8 }}>
                  {summary?.hero?.subheadline}
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.4} sx={{ mt: 2.2 }}>
                  {(summary?.hero?.phase_kpis || []).map((item) => (
                    <HeroMetric key={`${item.phase}-${item.label}`} item={item} />
                  ))}
                </Stack>
              </Box>

              <Box sx={{ borderRadius: 3, border: '1px solid #e2e8f0', bgcolor: '#ffffff', p: 2.3 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#64748b' }}>
                  Guided execution timeline
                </Typography>
                <Typography sx={{ mt: 0.6, fontSize: 13.5, color: '#475569', lineHeight: 1.7 }}>
                  Follow the live operating journey from FCC intake and suppression through Bridge handoff, Sentinel investigation, and final decisioning.
                </Typography>
              </Box>

              <Stack spacing={2.2}>
                {timelineSteps.map((step, index) => (
                  <TimelineStepCard
                    key={step.id}
                    step={step}
                    index={index}
                    active={step.id === activeStepId}
                    onOpenModule={onOpenModule}
                  />
                ))}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} sx={{ textTransform: 'none' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <WorkflowGraphDialog
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        params={params}
      />
    </>
  );
};

export default ExecutiveIntelligenceSummaryDialog;
