import React, { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack, Typography, CircularProgress } from '@mui/material';
import { V } from './validationTheme';
import { fmt, num, pct, safeNumber } from './validationUtils';

export const SectionTitle = ({ icon, title, subtitle }) => (
  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
    {icon}
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 800, color: V.text }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{subtitle}</Typography>}
    </Box>
  </Stack>
);

export const StatCard = ({ label, value, sub, tone = 'default', accent = V.orange }) => {
  const toneColor = tone === 'good' ? V.good : tone === 'bad' ? V.bad : tone === 'warn' ? V.warn : V.text;
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.1,
        borderRadius: 0,
        minWidth: 145,
        borderColor: accent,
        flex: '1 1 145px',
      }}
    >
      <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 19, fontWeight: 800, color: toneColor, mt: 0.2 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: 11, color: V.textMuted }}>{sub}</Typography>}
    </Paper>
  );
};

export const RingGauge = ({ label, value, max = 1, format = (v) => fmt(v, 3), tone = 'good' }) => {
  const [display, setDisplay] = useState(0);
  const pctValue = Math.max(0, Math.min(100, (safeNumber(value, 0) / max) * 100));
  const color = tone === 'bad' ? V.bad : tone === 'warn' ? V.warn : V.good;

  useEffect(() => {
    const t = setTimeout(() => setDisplay(pctValue), 120);
    return () => clearTimeout(t);
  }, [pctValue]);

  return (
    <Paper variant="outlined" sx={{ p: 1.35, borderRadius: 0, minWidth: 160 }}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <CircularProgress
            variant="determinate"
            value={display}
            size={56}
            thickness={6}
            sx={{
              color,
              transition: 'all 0.6s ease',
              '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
            }}
          />
          <Box
            sx={{
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: V.text }}>
              {format(value)}
            </Typography>
          </Box>
        </Box>
        <Box>
          <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>
            {tone === 'good' ? 'Healthy' : tone === 'warn' ? 'Watch' : 'Risk'}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

export const KpiBar = ({ label, value, max = 1, format = (v) => fmt(v, 3) }) => {
  const pctValue = Math.max(0, Math.min(100, (safeNumber(value, 0) / max) * 100));
  return (
    <Box sx={{ flex: 1, minWidth: 140 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{label}</Typography>
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: V.text }}>{format(value)}</Typography>
      </Stack>
      <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#EDF2F7', overflow: 'hidden', mt: 0.5 }}>
        <Box sx={{ width: `${pctValue}%`, height: '100%', bgcolor: V.orange, transition: 'width 0.6s ease' }} />
      </Box>
    </Box>
  );
};

export const MetricChip = ({ label, tone = 'default' }) => {
  const color = tone === 'good' ? V.good : tone === 'warn' ? V.warn : tone === 'bad' ? V.bad : V.textMuted;
  const bg = tone === 'good' ? V.goodLight : tone === 'warn' ? V.warnLight : tone === 'bad' ? V.badLight : '#F8FAFC';
  return (
    <Chip
      size="small"
      label={label}
      sx={{ height: 20, fontSize: 10.5, bgcolor: bg, color, border: `1px solid ${V.border}` }}
    />
  );
};

export const ConfusionMatrixGrid = ({ cm, business = false, compact = false, title = '' }) => {
  const tn = Number(cm?.[0]?.[0] ?? 0);
  const fp = Number(cm?.[0]?.[1] ?? 0);
  const fn = Number(cm?.[1]?.[0] ?? 0);
  const tp = Number(cm?.[1]?.[1] ?? 0);
  const cells = business
    ? [
        {
          key: 'tn',
          value: tn,
          bg: '#F8FAFC',
          title: 'Actually low risk and predicted low risk',
          code: 'True Negative',
          note: 'These are the alerts the model safely set aside, which is where workload relief comes from.',
        },
        {
          key: 'fp',
          value: fp,
          bg: '#FFF7ED',
          title: 'Actually low risk but predicted escalate',
          code: 'False Positive',
          note: 'These create extra analyst work because the model kept alerts that later looked non-suspicious.',
        },
        {
          key: 'fn',
          value: fn,
          bg: '#FEF2F2',
          title: 'Actually suspicious but predicted low risk',
          code: 'False Negative',
          note: 'These are the missed suspicious cases and represent the main residual risk in suppression.',
        },
        {
          key: 'tp',
          value: tp,
          bg: '#ECFDF3',
          title: 'Actually suspicious and predicted escalate',
          code: 'True Positive',
          note: 'These are the suspicious cases the model correctly kept visible for investigators.',
        },
      ]
    : [
        { key: 'tn', value: tn, bg: '#F8FAFC', title: 'TN', code: '', note: '' },
        { key: 'fp', value: fp, bg: '#FFF7ED', title: 'FP', code: '', note: '' },
        { key: 'fn', value: fn, bg: '#FEF2F2', title: 'FN', code: '', note: '' },
        { key: 'tp', value: tp, bg: '#ECFDF3', title: 'TP', code: '', note: '' },
      ];
  return (
    <Stack spacing={1}>
      {business && title ? (
        <Typography sx={{ fontSize: compact ? 11 : 11.5, color: V.textMuted }}>
          {title}
        </Typography>
      ) : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? 0.9 : 1.1 }}>
        {cells.map((cell) => (
          <Box
            key={cell.key}
            sx={{
              p: compact ? 1 : 1.2,
              border: `1px solid ${V.border}`,
              borderRadius: 0,
              bgcolor: cell.bg,
              minHeight: compact ? 108 : 124,
            }}
          >
            <Typography sx={{ fontSize: compact ? 10.25 : 10.5, fontWeight: 700, color: V.text }}>
              {cell.title}
            </Typography>
            {cell.code ? (
              <Typography sx={{ fontSize: 10, color: V.textMuted, mt: 0.2 }}>
                ({cell.code})
              </Typography>
            ) : null}
            <Typography sx={{ fontSize: compact ? 22 : 24, fontWeight: 800, color: V.text, mt: 0.7 }}>
              {cell.value.toLocaleString()}
            </Typography>
            {cell.note ? (
              <Typography sx={{ fontSize: compact ? 10.25 : 10.5, color: V.textMuted, mt: 0.55, lineHeight: 1.45 }}>
                {cell.note}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
    </Stack>
  );
};

export const DeltaPill = ({ value, suffix = 'pp' }) => {
  const v = safeNumber(value, 0);
  const tone = v <= 0 ? 'good' : 'warn';
  const label = `${v >= 0 ? '+' : ''}${num(v, 2)}${suffix}`;
  return <MetricChip label={label} tone={tone} />;
};

export const MetricTableCell = ({ value, tone }) => (
  <td style={{ padding: '6px 8px', textAlign: 'right', color: tone === 'good' ? V.good : tone === 'bad' ? V.bad : V.text }}>
    {value}
  </td>
);

export const StatPillRow = ({ items }) => (
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
    {items.map((item) => (
      <MetricChip key={item.label} label={item.label} tone={item.tone} />
    ))}
  </Stack>
);

export const ModelBadge = ({ label, color }) => (
  <Chip
    size="small"
    label={label}
    sx={{ height: 20, fontSize: 10.5, bgcolor: `${color}15`, color, border: `1px solid ${V.border}` }}
  />
);

export const HealthScore = ({ value }) => {
  const pctValue = Math.max(0, Math.min(100, safeNumber(value, 0)));
  const tone = pctValue >= 80 ? 'good' : pctValue >= 60 ? 'warn' : 'bad';
  const color = tone === 'good' ? V.good : tone === 'warn' ? V.warn : V.bad;
  return (
    <Box sx={{ p: 1, borderRadius: 0, border: `1px solid ${V.border}`, minWidth: 120 }}>
      <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Health</Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color }}>{num(pctValue, 0)}%</Typography>
    </Box>
  );
};

export const TagLine = ({ text }) => (
  <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{text}</Typography>
);

export const InlineBadge = ({ label }) => (
  <Chip size="small" label={label} sx={{ height: 18, fontSize: 9.5, bgcolor: '#F8FAFC', color: V.textMuted, border: `1px solid ${V.border}` }} />
);

export const InlineValue = ({ value }) => (
  <Typography sx={{ fontFamily: '"Fira Code","Cascadia Code",monospace', fontSize: 12, color: V.text }}>
    {value}
  </Typography>
);

export const PercentBar = ({ value, color = V.orange }) => {
  const pctValue = Math.max(0, Math.min(100, safeNumber(value, 0)));
  return (
    <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#F1F5F9', overflow: 'hidden' }}>
      <Box sx={{ width: `${pctValue}%`, height: '100%', bgcolor: color }} />
    </Box>
  );
};

export const SmallMetric = ({ label, value }) => (
  <Box>
    <Typography sx={{ fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
    <Typography sx={{ fontSize: 13, fontWeight: 700, color: V.text }}>{value}</Typography>
  </Box>
);

export const MetricValue = ({ value, suffix = '' }) => (
  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>
    {value}{suffix}
  </Typography>
);

export const MetricDelta = ({ value }) => (
  <Chip
    size="small"
    label={`${value >= 0 ? '+' : ''}${fmt(value, 2)}pp`}
    sx={{
      height: 18,
      fontSize: 9.5,
      bgcolor: value <= 0 ? V.goodLight : V.warnLight,
      color: value <= 0 ? V.good : V.warn,
      border: `1px solid ${V.border}`,
    }}
  />
);

export const ValuePill = ({ label, value }) => (
  <Chip size="small" label={`${label}: ${value}`} sx={{ height: 20, fontSize: 10.5, bgcolor: '#F8FAFC', color: V.textMuted, border: `1px solid ${V.border}` }} />
);

export const MetricBadge = ({ label, tone = 'default' }) => {
  const bg = tone === 'good' ? V.goodLight : tone === 'warn' ? V.warnLight : tone === 'bad' ? V.badLight : '#F8FAFC';
  const fg = tone === 'good' ? V.good : tone === 'warn' ? V.warn : tone === 'bad' ? V.bad : V.textMuted;
  return (
    <Chip size="small" label={label} sx={{ height: 18, fontSize: 9.5, bgcolor: bg, color: fg, border: `1px solid ${V.border}` }} />
  );
};

export const MetricRow = ({ label, value, unit = '' }) => (
  <Stack direction="row" alignItems="center" justifyContent="space-between">
    <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{label}</Typography>
    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>{value}{unit}</Typography>
  </Stack>
);

export const MetricGrid = ({ items }) => (
  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
    {items.map((item) => (
      <StatCard key={item.label} label={item.label} value={item.value} sub={item.sub} tone={item.tone} accent={item.accent} />
    ))}
  </Stack>
);

export const ThresholdDeltaRow = ({ label, value, delta }) => (
  <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 160 }}>
    <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{label}</Typography>
    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text }}>{value}</Typography>
    <MetricDelta value={delta} />
  </Stack>
);

export const MetricPill = ({ label, value }) => (
  <Chip size="small" label={`${label}: ${value}`} sx={{ height: 20, fontSize: 10.5, bgcolor: '#F8FAFC', color: V.textMuted, border: `1px solid ${V.border}` }} />
);

export const NarrativeBox = ({ title, text }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FBFBFD' }}>
    <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: V.text }}>{title}</Typography>
    <Typography sx={{ fontSize: 11.5, color: V.textMuted, mt: 0.5 }}>{text}</Typography>
  </Paper>
);

export const MetricSummaryRow = ({ label, value, tone = 'default' }) => {
  const color = tone === 'good' ? V.good : tone === 'bad' ? V.bad : tone === 'warn' ? V.warn : V.text;
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.4 }}>
      <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>{label}</Typography>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color }}>{value}</Typography>
    </Stack>
  );
};

export const tiny = { fontSize: 10.5, color: V.textMuted };

export const TableHeader = ({ text }) => (
  <th
    style={{
      textAlign: 'right',
      padding: '6px 8px',
      fontSize: 10,
      color: V.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      borderBottom: `1px solid ${V.border}`,
    }}
  >
    {text}
  </th>
);

export const TableCell = ({ value, color }) => (
  <td style={{ textAlign: 'right', padding: '5px 8px', color: color || V.text }}>
    {value}
  </td>
);

export const MetricBadgeStack = ({ items }) => (
  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
    {items.map((item) => (
      <MetricBadge key={item.label} label={item.label} tone={item.tone} />
    ))}
  </Stack>
);

export const InlineLegend = ({ items }) => (
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
    {items.map((item) => (
      <Stack key={item.label} direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color }} />
        <Typography sx={{ fontSize: 10.5, color: V.textMuted }}>{item.label}</Typography>
      </Stack>
    ))}
  </Stack>
);

export const LegendRow = ({ items }) => (
  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
    {items.map((item) => (
      <Stack key={item.label} direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ width: 10, height: 10, borderRadius: 2, bgcolor: item.color }} />
        <Typography sx={{ fontSize: 10.5, color: V.textMuted }}>{item.label}</Typography>
      </Stack>
    ))}
  </Stack>
);

export const ThinDivider = () => (
  <Box sx={{ height: 1, bgcolor: V.border, width: '100%', my: 1 }} />
);

export const MetricRowList = ({ rows }) => (
  <Stack spacing={0.4}>
    {rows.map((row) => (
      <MetricSummaryRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
    ))}
  </Stack>
);

export const FaintNote = ({ text }) => (
  <Typography sx={{ fontSize: 11, color: V.textDim }}>{text}</Typography>
);

export const SectionCard = ({ children, sx = {} }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 1.9,
      borderRadius: 0,
      bgcolor: V.paper,
      borderColor: V.border,
      boxShadow: V.shadowSm,
      ...sx,
    }}
  >
    {children}
  </Paper>
);

export const DarkHeader = ({ title, subtitle, right }) => (
  <Box
    sx={{
      p: 2,
      borderRadius: 0,
      color: '#fff',
      background: `linear-gradient(90deg, ${V.slateDark}, ${V.slateMid})`,
      boxShadow: `inset 0 -2px 0 ${V.orange}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 2,
    }}
  >
    <Box>
      <Typography sx={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.3 }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: 12, color: '#D6D6E3' }}>{subtitle}</Typography>}
    </Box>
    {right}
  </Box>
);

export const ProgressChip = ({ label, value }) => (
  <Chip size="small" label={`${label}: ${pct(value, 1)}`} sx={{ height: 20, fontSize: 10.5, bgcolor: '#F8FAFC', color: V.textMuted, border: `1px solid ${V.border}` }} />
);
