/**
 * DataUploadScreen.jsx - AML MLOps Workbench - PwC Design System
 *
 * DUAL PERSONA:
 *   Business  → Narrative summaries, KPIs, alert volumes, coverage %, data freshness
 *   Technical → Schema grid, null heatmap bars, dtype distribution, join key fingerprints,
 *               duplicate key warnings, high-cardinality flags, temporal gap detection
 *
 * No external deps beyond MUI, MUI-X DataGrid, existing mlopsApi.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider,
  Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, LinearProgress,
  MenuItem, Select, Stack, TextField, Tooltip, Typography,
  ToggleButton, ToggleButtonGroup, Collapse,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  CheckCircle, CloudUpload, Delete, ErrorOutline,
  FilePresent, Info, Refresh, TableChart, Warning,
  Insights, VpnKey, ExpandMore, ExpandLess,
  LinkOff, Schedule, TrendingUp, Assessment,
  BubbleChart, Notifications, AccountTree,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import ScreenPipelineRail from './ScreenPipelineRail';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

// ─── PwC Design Tokens ────────────────────────────────────────────────────────
const PwC = {
  tangerine:      '#D04A02',
  tangerineMid:   '#E8651A',
  tangerineLight: '#FFF1EC',
  red:            '#E0301E',
  midnight:       '#151B27',
  midnightMid:    '#1E2D3D',
  slate:          '#2D3F55',
  ash:            '#475569',
  mist:           '#94A3B8',
  smoke:          '#E2E8F0',
  cloud:          '#F5F6F8',
  white:          '#FFFFFF',
  emerald:        '#059669',
  emeraldLight:   '#D1FAE5',
  amber:          '#D97706',
  amberLight:     '#FEF3C7',
  sapphire:       '#2563EB',
  sapphireLight:  '#DBEAFE',
  violet:         '#7C3AED',
  violetLight:    '#EDE9FE',
  rose:           '#E11D48',
  roseLight:      '#FFE4E6',
};

// ─── Constants ────────────────────────────────────────────────────────────────
const PRESET_TYPES = [
  { value: 'transactions',   label: 'Transactions',    desc: 'Payment & transfer records',       icon: 'TXN',   color: '#F1F5F9', bizHint: 'Financial movement data' },
  { value: 'accounts',       label: 'Accounts',         desc: 'Account master data',              icon: 'ACCT',  color: '#F8FAFC', bizHint: 'Customer account records' },
  { value: 'customers',      label: 'Customers',        desc: 'Customer KYC profiles',            icon: 'CUST',  color: '#F8FAFC', bizHint: 'Know Your Customer data' },
  { value: 'alerts',         label: 'Alerts',           desc: 'Rule-engine alert outputs',        icon: 'ALRT',  color: '#F1F5F9', bizHint: 'System-generated flags' },
  { value: 'cases',          label: 'Cases',            desc: 'Investigation case records',       icon: 'CASE',  color: '#F8FAFC', bizHint: 'AML investigation cases' },
  { value: 'str',            label: 'STR / SAR',        desc: 'Suspicious transaction reports',   icon: 'STR',   color: '#F8FAFC', bizHint: 'Regulatory filings' },
  { value: 'sanctions',      label: 'Sanctions',        desc: 'Sanctions / watchlist data',       icon: 'SANC',  color: '#F1F5F9', bizHint: 'Watchlist entities' },
  { value: 'counterparties', label: 'Counterparties',   desc: 'Beneficiary / sender entities',    icon: 'CP',    color: '#F8FAFC', bizHint: 'Third-party entities' },
  { value: 'custom',         label: '+ Custom',         desc: 'Enter any table name',             icon: 'EDIT',  color: '#F3F4F6', bizHint: 'Custom data type' },
];
const TYPE_META = Object.fromEntries(PRESET_TYPES.map(t => [t.value, t]));

const MAX_MB = 500;
const fmtBytes  = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtNum    = (n) => n == null ? '-' : Number(n).toLocaleString();
const ext       = (f) => (f.name || '').split('.').pop().toLowerCase();
const safe      = (v) => String(v || '').trim().toLowerCase();
const ratio     = (v) => { const n = Number(v); if (!Number.isFinite(n)) return null; return n > 1 ? n / 100 : n; };
const pct       = (v, d = 1) => { const r = ratio(v); return r == null ? '-' : `${(r * 100).toFixed(d)}%`; };
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;
const toColumnName = (column) => {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object') return String(column.name || column.column || column.field || '').trim();
  return '';
};
const normalizeColumns = (columns = []) => (Array.isArray(columns) ? columns : [])
  .map((column) => toColumnName(column))
  .filter(Boolean);
const normalizeColumnTypes = (...sources) => {
  const merged = {};
  sources.forEach((source) => {
    const types = source?.column_types || {};
    Object.entries(types).forEach(([key, value]) => {
      if (key && value != null) merged[key] = value;
    });
    (Array.isArray(source?.columns) ? source.columns : []).forEach((column) => {
      if (column && typeof column === 'object') {
        const name = toColumnName(column);
        if (name) merged[name] = column.dtype || column.type || column.data_type || merged[name] || 'object';
      }
    });
  });
  return merged;
};
const inferRole = (dtype = 'object') => {
  const t = safe(dtype);
  if (t.includes('date') || t.includes('time')) return 'datetime';
  if (t.includes('bool')) return 'binary';
  if (t.includes('int') || t.includes('float') || t.includes('double') || t.includes('decimal')) return 'numeric';
  return 'categorical';
};

const qualityColor = (score) => {
  if (score >= 85) return PwC.emerald;
  if (score >= 65) return PwC.amber;
  return PwC.red;
};

const colTypePalette = {
  int64:      { bg: '#F1F5F9', fg: '#334155' },
  float64:    { bg: '#F8FAFC', fg: '#475569' },
  object:     { bg: '#F8FAFC', fg: '#475569' },
  bool:       { bg: '#FEF3C7', fg: '#92400E' },
  datetime64: { bg: '#FFF1EC', fg: '#B45309' },
};
const colChip = (dtype) => {
  const key = Object.keys(colTypePalette).find((k) => (dtype || '').includes(k)) || 'object';
  return colTypePalette[key];
};

const autoDetectType = (filename) => {
  const lower = filename.toLowerCase();
  for (const { value } of PRESET_TYPES.slice(0, -1)) {
    if (lower.includes(value)) return value;
  }
  if (lower.includes('txn') || lower.includes('payment')) return 'transactions';
  if (lower.includes('acct') || lower.includes('account')) return 'accounts';
  if (lower.includes('cust') || lower.includes('client')) return 'customers';
  if (lower.includes('sar') || lower.includes('suspi')) return 'str';
  return 'transactions';
};

// Build column rows merging schema + profile
const buildColumnRows = (dataset, schema, profile) => {
  const schemaDetails  = Array.isArray(schema?.columns_detail)  ? schema.columns_detail  : [];
  const profileDetails = Array.isArray(profile?.columns_detail) ? profile.columns_detail : [];
  const detailsBySchema  = new Map(schemaDetails.map((d) => [safe(d?.name), d]));
  const detailsByProfile = new Map(profileDetails.map((d) => [safe(d?.name), d]));
  const columnTypes = normalizeColumnTypes(dataset, schema);

  const previewRows = Array.isArray(schema?.rows) && schema.rows.length
    ? schema.rows
    : Array.isArray(schema?.preview_rows)
      ? schema.preview_rows
      : [];
  const previewKeys = previewRows
    .flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : []))
    .filter(Boolean);

  const names = new Set([
    ...normalizeColumns(dataset?.columns),
    ...normalizeColumns(schema?.columns),
    ...schemaDetails.map((d) => d?.name).filter(Boolean),
    ...profileDetails.map((d) => d?.name).filter(Boolean),
    ...previewKeys,
  ]);

  const rows = Array.from(names).map((name, idx) => {
    const key = safe(name);
    const s   = detailsBySchema.get(key) || {};
    const p   = detailsByProfile.get(key) || {};
    const dtype          = p.dtype || s.dtype || columnTypes[name] || 'object';
    const role           = p.role || s.role || inferRole(dtype);
    const nullPct        = p.null_pct ?? s.null_pct ?? null;
    const uniqueCount    = p.unique_count ?? s.unique_count ?? null;
    const sampleValue    = p.sample_value ?? s.sample_value ?? null;
    const idConfidence   = p.identifier_confidence ?? s.identifier_confidence ?? null;
    const modelAction    = p.model_action || s.model_action || 'include';
    const isIdentifier   = Boolean(p.is_identifier ?? s.is_identifier);
    const temporalGaps   = Boolean(p.temporal_gaps_detected ?? s.temporal_gaps_detected);
    const cardinalityRatio = p.cardinality_ratio ?? s.cardinality_ratio ?? null;
    const isHighCard     = cardinalityRatio != null && cardinalityRatio > 0.95 && !isIdentifier;
    const issueFlags     = Array.from(new Set([
      ...(Array.isArray(s.issue_flags) ? s.issue_flags : []),
      ...(Array.isArray(p.issue_flags) ? p.issue_flags : []),
      ...(isHighCard ? ['high_cardinality'] : []),
      ...(temporalGaps ? ['temporal_gaps'] : []),
    ]));

    return {
      id: `${idx}_${String(name)}`,
      name: String(name),
      dtype,
      role,
      null_pct: nullPct,
      unique_count: uniqueCount,
      cardinality_ratio: cardinalityRatio,
      sample: sampleValue != null ? String(sampleValue) : '-',
      identifier_confidence: idConfidence,
      model_action: modelAction,
      is_identifier: isIdentifier,
      is_high_card: isHighCard,
      temporal_gaps: temporalGaps,
      issue_flags: issueFlags,
    };
  });

  rows.sort((a, b) => {
    if (a.is_identifier !== b.is_identifier) return a.is_identifier ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
};

// Derive join key candidates from column overlaps between datasets
const deriveJoinCandidates = (dataset, allDatasets) => {
  const myCols = new Set(normalizeColumns(dataset?.columns).map(safe));
  const links = [];
  for (const other of allDatasets) {
    if (other.dataset_id === dataset.dataset_id) continue;
    const otherCols = new Set(normalizeColumns(other?.columns).map(safe));
    const shared = [...myCols].filter((c) => otherCols.has(c) && (c.endsWith('_id') || c === 'id'));
    if (shared.length) {
      links.push({ to: other.dataset_type, keys: shared });
    }
  }
  return links;
};

// Build business narrative text from profile data
const buildNarrative = (dataset, profile, allDatasets) => {
  const rows        = fmtNum(dataset.row_count);
  const typeMeta    = TYPE_META[dataset.dataset_type] || {};
  const label       = typeMeta.label || dataset.dataset_type;
  const dateMin     = profile?.date_range_min || profile?.min_date;
  const dateMax     = profile?.date_range_max || profile?.max_date;
  const dateRange   = dateMin && dateMax ? `spanning ${dateMin} – ${dateMax}` : '';
  const flagRate    = profile?.flag_rate != null ? `${(Number(profile.flag_rate) * 100).toFixed(1)}% flagged` : null;
  const coverage    = profile?.coverage_pct != null ? `${Number(profile.coverage_pct).toFixed(0)}% coverage` : null;
  const uniqueEntities = profile?.unique_entity_count;
  const freshnessDays  = profile?.data_freshness_days;

  const parts = [`${rows} ${label.toLowerCase()} records`];
  if (dateRange) parts.push(dateRange);
  if (uniqueEntities) parts.push(`${fmtNum(uniqueEntities)} unique entities`);
  if (flagRate) parts.push(flagRate);
  if (coverage) parts.push(coverage);

  let freshnessNote = null;
  if (freshnessDays != null) {
    const days = Number(freshnessDays);
    freshnessNote = days <= 7 ? 'Data freshness: current (updated within 7 days)'
      : days <= 30 ? `Data freshness: ${days} days old, verify recency`
      : `Data freshness: potentially stale (${days} days since last record)`;
  }

  return { summary: parts.join(' · '), freshnessNote };
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const StatBadge = ({ label, value, accent, icon: Icon }) => (
  <Box sx={{
    flex: 1, minWidth: 110,
    bgcolor: PwC.white,
    border: `1px solid ${PwC.smoke}`,
    borderTop: `3px solid ${accent}`,
    borderRadius: '6px',
    px: 1.5, py: 1.25,
  }}>
    <Stack direction="row" alignItems="center" spacing={0.5} mb={0.25}>
      {Icon && <Icon sx={{ fontSize: 12, color: accent }} />}
      <Typography sx={{ fontSize: 10, color: PwC.mist, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>
        {label}
      </Typography>
    </Stack>
    <Typography sx={{ fontSize: 19, fontWeight: 800, color: PwC.midnight, lineHeight: 1.1, fontFamily: '"Georgia", serif' }}>
      {value}
    </Typography>
  </Box>
);

const QualityBar = ({ score }) => (
  <Box>
    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Data Quality Score
      </Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 800, color: qualityColor(score) }}>
        {Math.round(score)}%
      </Typography>
    </Stack>
    <Box sx={{ height: 7, bgcolor: PwC.smoke, borderRadius: 4, overflow: 'hidden' }}>
      <Box sx={{ height: '100%', width: `${Math.min(100, score)}%`, bgcolor: qualityColor(score), borderRadius: 4, transition: 'width 0.9s ease' }} />
    </Box>
  </Box>
);

// Null heatmap mini-bar for technical schema grid
const NullBar = ({ value }) => {
  const r = ratio(value);
  if (r == null) return <Typography sx={{ fontSize: 11, color: PwC.mist }}>-</Typography>;
  const pctVal = r * 100;
  const color = pctVal > 20 ? PwC.red : pctVal > 5 ? PwC.amber : PwC.emerald;
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box sx={{ width: 40, height: 5, bgcolor: PwC.smoke, borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.min(100, pctVal)}%`, height: '100%', bgcolor: color, borderRadius: 3 }} />
      </Box>
      <Typography sx={{ fontSize: 10, color, fontWeight: 600, minWidth: 30 }}>
        {pctVal.toFixed(1)}%
      </Typography>
    </Stack>
  );
};

// ─── QueueItem ─────────────────────────────────────────────────────────────────
const QueueItem = ({ item, persona, onTypeChange, onCustomNameChange, onUpload, onRemove }) => {
  const statusMeta = {
    pending:   { color: PwC.slate,    icon: FilePresent,    label: 'Ready' },
    uploading: { color: PwC.sapphire, icon: CloudUpload,    label: 'Uploading…' },
    done:      { color: PwC.emerald,  icon: CheckCircle,    label: 'Uploaded' },
    error:     { color: PwC.red,      icon: ErrorOutline,   label: 'Error' },
  };
  const meta = statusMeta[item.status] || statusMeta.pending;
  const StatusIcon = meta.icon;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5,
      bgcolor: PwC.white, border: `1px solid ${PwC.smoke}`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: '6px', px: 1.5, py: 1,
    }}>
      <StatusIcon sx={{ fontSize: 18, color: meta.color, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: PwC.midnight }} noWrap>
          {item.file.name}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontSize: 10, color: PwC.mist }}>
            {fmtBytes(item.file.size)} · {ext(item.file).toUpperCase()}
          </Typography>
          {item.status === 'error' && (
            <Typography sx={{ fontSize: 10, color: PwC.red }}>{item.error}</Typography>
          )}
        </Stack>
        {item.status === 'uploading' && (
          <LinearProgress variant="determinate" value={item.progress}
            sx={{ mt: 0.5, height: 3, borderRadius: 2, bgcolor: PwC.smoke, '& .MuiLinearProgress-bar': { bgcolor: PwC.tangerine } }} />
        )}
      </Box>

      {item.status === 'pending' && (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <FormControl size="small" sx={{ width: 155 }}>
            <InputLabel sx={{ fontSize: 11 }}>Table type</InputLabel>
            <Select value={item.type} label="Table type" onChange={(e) => onTypeChange(e.target.value)}
              sx={{ fontSize: 12, '& .MuiSelect-select': { py: 0.75 } }}>
              {PRESET_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value} sx={{ fontSize: 12 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <span style={{ fontSize: 13 }}>{t.icon}</span>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{t.label}</Typography>
                      <Typography variant="caption" sx={{ color: PwC.mist, fontSize: 10 }}>
                        {persona === 'business' ? t.bizHint : t.desc}
                      </Typography>
                    </Box>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {item.type === 'custom' && (
            <TextField size="small" label="Custom name" placeholder="e.g. fx_trades"
              value={item.customName}
              onChange={(e) => onCustomNameChange(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              sx={{ width: 130, '& .MuiInputBase-input': { fontSize: 12 } }} />
          )}
        </Stack>
      )}

      <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
        {item.status === 'pending' && (
          <Button size="small" variant="contained" onClick={onUpload}
            sx={{ bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight }, fontSize: 11, py: 0.5, height: 28, textTransform: 'none', borderRadius: '4px', boxShadow: 'none', minWidth: 64 }}>
            Upload
          </Button>
        )}
        <IconButton size="small" onClick={onRemove} sx={{ color: PwC.mist, '&:hover': { color: PwC.red } }}>
          <Delete fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
};

// ─── Business Persona Panel ────────────────────────────────────────────────────
const BusinessPanel = ({ dataset, profile, allDatasets }) => {
  const { summary, freshnessNote } = useMemo(
    () => buildNarrative(dataset, profile, allDatasets),
    [dataset, profile, allDatasets],
  );
  const businessSignals = Array.isArray(profile?.business_signals) ? profile.business_signals : [];
  const flagRate        = profile?.flag_rate != null ? (Number(profile.flag_rate) * 100).toFixed(1) : null;
  const coveragePct     = profile?.coverage_pct != null ? Number(profile.coverage_pct).toFixed(0) : null;
  const uniqueEntities  = profile?.unique_entity_count;
  const qualityScore    = Number(profile?.quality_score);
  const hasQuality      = Number.isFinite(qualityScore);

  return (
    <Box sx={{ p: 1.5, bgcolor: PwC.cloud, borderTop: `1px solid ${PwC.smoke}` }}>
      {/* Narrative summary */}
      <Box sx={{ mb: 1.25, p: 1.25, bgcolor: PwC.white, borderRadius: '6px', border: `1px solid ${PwC.smoke}`, borderLeft: `3px solid ${PwC.tangerine}` }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.tangerine, textTransform: 'uppercase', letterSpacing: 0.8, mb: 0.4 }}>
          Dataset Summary
        </Typography>
        <Typography sx={{ fontSize: 12, color: PwC.slate, fontWeight: 500 }}>
          {summary || 'Loading summary…'}
        </Typography>
        {freshnessNote && (
          <Typography sx={{ fontSize: 11, color: PwC.ash, mt: 0.5 }}>{freshnessNote}</Typography>
        )}
      </Box>

      {/* KPI badges */}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mb: 1.25 }} useFlexGap>
        <StatBadge label="Total Records" value={fmtNum(dataset.row_count)} accent={PwC.tangerine} icon={Assessment} />
        {flagRate && <StatBadge label="Flagged Rate" value={`${flagRate}%`} accent={Number(flagRate) > 5 ? PwC.red : PwC.amber} icon={Notifications} />}
        {coveragePct && <StatBadge label="Coverage" value={`${coveragePct}%`} accent={Number(coveragePct) > 80 ? PwC.emerald : PwC.amber} icon={TrendingUp} />}
        {uniqueEntities && <StatBadge label="Unique Entities" value={fmtNum(uniqueEntities)} accent={PwC.slate} icon={BubbleChart} />}
      </Stack>

      {/* Quality bar */}
      {hasQuality && (
        <Box sx={{ mb: 1.25 }}>
          <QualityBar score={Math.max(0, Math.min(100, qualityScore))} />
        </Box>
      )}

      {/* Business signals */}
      {businessSignals.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.5 }}>
            Key Observations
          </Typography>
          <Stack spacing={0.4}>
            {businessSignals.slice(0, 5).map((s, i) => (
              <Typography key={i} sx={{ fontSize: 11.5, color: PwC.slate }}>• {s}</Typography>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

// ─── Technical Persona Panel ───────────────────────────────────────────────────
const TechnicalPanel = ({ dataset, schema, profile, allDatasets }) => {
  const [viewMode, setViewMode] = useState('all');

  const schemaRows = useMemo(() => buildColumnRows(dataset, schema, profile), [dataset, schema, profile]);
  const idRows      = schemaRows.filter((r) => r.is_identifier);
  const issueRows   = schemaRows.filter((r) => (ratio(r.null_pct) || 0) >= 0.2 || r.issue_flags.length > 0);
  const modelRows   = schemaRows.filter((r) => safe(r.model_action) !== 'exclude');
  const highNulls   = schemaRows.filter((r) => (ratio(r.null_pct) || 0) >= 0.5);
  const highCard    = schemaRows.filter((r) => r.is_high_card);
  const tempGaps    = schemaRows.filter((r) => r.temporal_gaps);
  const joinLinks   = useMemo(() => deriveJoinCandidates(dataset, allDatasets), [dataset, allDatasets]);

  const visibleRows = useMemo(() => {
    if (viewMode === 'id')     return idRows;
    if (viewMode === 'model')  return modelRows;
    if (viewMode === 'issues') return issueRows;
    return schemaRows;
  }, [viewMode, idRows, modelRows, issueRows, schemaRows]);

  const dtypeCounts = schemaRows.reduce((acc, r) => {
    const k = Object.keys(colTypePalette).find((k2) => (r.dtype || '').toLowerCase().includes(k2)) || 'object';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const previewRows = Array.isArray(schema?.rows) && schema.rows.length
    ? schema.rows
    : Array.isArray(schema?.preview_rows)
      ? schema.preview_rows
      : [];
  const previewCols = useMemo(() => {
    if (!previewRows.length) return [];
    const keys = Array.from(new Set(previewRows.flatMap((row) => (
      row && typeof row === 'object' ? Object.keys(row) : []
    )))).slice(0, 30);
    return keys.map((key) => ({
      field: key, headerName: key, minWidth: 110, flex: 1,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 10, color: PwC.mist, fontFamily: 'monospace' }} noWrap>
          {value == null ? '' : String(value)}
        </Typography>
      ),
    }));
  }, [previewRows]);

  const columns = [
    {
      field: 'name', headerName: 'Column', flex: 1.4, minWidth: 110,
      renderCell: ({ row, value }) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {row.is_identifier && <VpnKey sx={{ fontSize: 11, color: PwC.tangerine }} />}
          <Typography sx={{ fontSize: 11, fontFamily: '"Fira Code", monospace', fontWeight: 600, color: PwC.midnight }}>{value}</Typography>
          {row.is_high_card && <Chip label="high-card" size="small" sx={{ height: 14, fontSize: 8, bgcolor: PwC.tangerineLight, color: '#9A3412' }} />}
          {row.temporal_gaps && <Chip label="gaps" size="small" sx={{ height: 14, fontSize: 8, bgcolor: '#FEF2F2', color: '#991B1B' }} />}
        </Stack>
      ),
    },
    {
      field: 'role', headerName: 'Role', width: 90,
      renderCell: ({ value }) => {
        const role  = safe(value) || 'categorical';
        const color = role === 'identifier' ? { bg: '#FFF1EC', fg: '#9A3412' }
          : role === 'numeric'   ? { bg: '#F1F5F9', fg: '#334155' }
          : role === 'binary'    ? { bg: '#F8FAFC', fg: '#475569' }
          : role === 'datetime'  ? { bg: '#FEF3C7', fg: '#92400E' }
          : { bg: '#F8FAFC', fg: '#475569' };
        return <Chip label={value} size="small" sx={{ bgcolor: color.bg, color: color.fg, fontSize: 9, height: 18 }} />;
      },
    },
    {
      field: 'dtype', headerName: 'Type', width: 96,
      renderCell: ({ value }) => {
        const { bg, fg } = colChip(value);
        return <Chip label={value} size="small" sx={{ bgcolor: bg, color: fg, fontFamily: 'monospace', fontSize: 9, height: 18 }} />;
      },
    },
    {
      field: 'null_pct', headerName: 'Nulls', width: 110,
      renderCell: ({ value }) => <NullBar value={value} />,
    },
    {
      field: 'unique_count', headerName: 'Unique', width: 70,
      renderCell: ({ value }) => <Typography sx={{ fontSize: 11, color: PwC.ash }}>{fmtNum(value)}</Typography>,
    },
    {
      field: 'model_action', headerName: 'Model', width: 68,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 10, fontWeight: 700,
          color: safe(value) === 'exclude' ? PwC.red : safe(value) === 'review' ? PwC.amber : PwC.emerald }}>
          {value}
        </Typography>
      ),
    },
    {
      field: 'sample', headerName: 'Sample', flex: 1, minWidth: 80,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 10, color: PwC.mist, fontFamily: 'monospace' }} noWrap>{value}</Typography>
      ),
    },
  ];

  return (
    <Box sx={{ borderTop: `1px solid ${PwC.smoke}` }}>
      {/* Warning badges row */}
      {(highNulls.length > 0 || highCard.length > 0 || tempGaps.length > 0 || joinLinks.length > 0) && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
          {highNulls.length > 0 && (
            <Chip size="small" icon={<Warning sx={{ fontSize: '12px !important', color: `${PwC.red} !important` }} />}
              label={`${highNulls.length} high-null cols (>50%)`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#FEF2F2', color: PwC.red, border: `1px solid #FECACA` }} />
          )}
          {highCard.length > 0 && (
            <Chip size="small" icon={<Warning sx={{ fontSize: '12px !important', color: `${PwC.amber} !important` }} />}
              label={`${highCard.length} high-cardinality cols`}
              sx={{ fontSize: 10, height: 22, bgcolor: PwC.amberLight, color: PwC.amber, border: `1px solid #FCD34D` }} />
          )}
          {tempGaps.length > 0 && (
            <Chip size="small" icon={<Schedule sx={{ fontSize: '12px !important', color: `${PwC.slate} !important` }} />}
              label={`${tempGaps.length} cols with temporal gaps`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#F1F5F9', color: PwC.slate, border: `1px solid ${PwC.smoke}` }} />
          )}
          {joinLinks.map((lnk, i) => (
            <Chip key={i} size="small" icon={<AccountTree sx={{ fontSize: '12px !important', color: `${PwC.slate} !important` }} />}
              label={`Links to ${lnk.to} via ${lnk.keys[0]}`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#F8FAFC', color: PwC.slate, border: `1px solid ${PwC.smoke}` }} />
          ))}
        </Stack>
      )}

      {/* Schema header + view toggle */}
      <Box sx={{ px: 1.5, pt: 1, pb: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Schema · {schemaRows.length} columns
        </Typography>
        <ToggleButtonGroup exclusive size="small" value={viewMode} onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { height: 21, px: 0.9, fontSize: 9, textTransform: 'none' } }}>
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="id">ID</ToggleButton>
          <ToggleButton value="model">Model</ToggleButton>
          <ToggleButton value="issues">Issues {issueRows.length > 0 && `(${issueRows.length})`}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Dtype distribution */}
      <Box sx={{ px: 1.5, pb: 0.75, display: 'flex', gap: 0.4, flexWrap: 'wrap' }}>
        {Object.entries(dtypeCounts).map(([k, v]) => {
          const { bg, fg } = colTypePalette[k];
          return <Chip key={k} label={`${k} (${v})`} size="small" sx={{ bgcolor: bg, color: fg, fontSize: 9, height: 18 }} />;
        })}
      </Box>

      {/* Schema grid */}
      <Box sx={{ height: Math.min(Math.max(visibleRows.length, 3) * 32 + 38, 420), px: 1.5, pb: 1 }}>
        <DataGrid rows={visibleRows} columns={columns} density="compact"
          disableColumnMenu hideFooter disableRowSelectionOnClick
          sx={{
            border: 'none', fontSize: 11,
            '& .MuiDataGrid-columnHeaders':   {
              bgcolor: PwC.cloud,
              minHeight: '32px !important',
              fontSize: 10,
              position: 'sticky',
              top: 0,
              zIndex: 2,
            },
            '& .MuiDataGrid-cell':            { borderColor: PwC.smoke, py: 0.25 },
            '& .MuiDataGrid-row:hover':       { bgcolor: PwC.tangerineLight },
          }} />
      </Box>

      {/* Raw data preview */}
      {previewRows.length > 0 && (
        <>
          <Box sx={{ px: 1.5, pb: 0.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Dataset sample preview
            </Typography>
            <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>
              Showing available sampled rows from backend schema preview.
            </Typography>
          </Box>
          <Box sx={{ height: 320, px: 1.5, pb: 1 }}>
            <DataGrid rows={previewRows.map((r, i) => ({ id: i, ...r }))} columns={previewCols}
              density="compact" disableColumnMenu disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              sx={{
                border: 'none', fontSize: 10,
                '& .MuiDataGrid-columnHeaders': {
                  bgcolor: PwC.cloud,
                  minHeight: '30px !important',
                  fontSize: 9,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                },
                '& .MuiDataGrid-cell':          { borderColor: PwC.smoke },
              }} />
          </Box>
        </>
      )}
      {previewRows.length > 0 && previewCols.length === 0 && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Alert severity="info" sx={{ py: 0.5 }}>
            Preview rows loaded, but no stable column keys were detected in sampled records.
          </Alert>
        </Box>
      )}
      {previewRows.length === 0 && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Typography sx={{ fontSize: 10.5, color: PwC.textMuted }}>
            No preview rows returned by backend for this dataset.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

// ─── Registered Dataset Card ───────────────────────────────────────────────────
const RegisteredDatasetCard = ({
  dataset, persona, expanded, schema, profile, allDatasets,
  loadingSchema, loadingProfile, onExpand, onDelete,
}) => {
  const d        = dataset;
  const typeMeta = TYPE_META[d.dataset_type] || { icon: 'DATA', color: '#F3F4F6', bizHint: d.dataset_type };
  const detailsErr = schema?.error || profile?.error;

  const schemaRows = useMemo(() => buildColumnRows(d, schema, profile), [d, schema, profile]);
  const idRows     = schemaRows.filter((r) => r.is_identifier);
  const issueRows  = schemaRows.filter((r) => (ratio(r.null_pct) || 0) >= 0.2 || r.issue_flags.length > 0);

  const qualityScore = Number(profile?.quality_score ?? schema?.quality_score);
  const qualitySafe  = Number.isFinite(qualityScore) ? qualityScore
    : schemaRows.length
      ? Math.max(0, Math.round(100 - (schemaRows.reduce((s, r) => s + ((ratio(r.null_pct) || 0) * 100), 0) / schemaRows.length)))
      : null;

  const isLoading = loadingSchema || loadingProfile;

  return (
    <Box sx={{ bgcolor: PwC.white, border: `1px solid ${PwC.smoke}`, borderRadius: '6px', overflow: 'hidden' }}>
      {/* Header row */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.1 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '6px', bgcolor: typeMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
          {typeMeta.icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: PwC.midnight }} noWrap>
              {d.dataset_type}
            </Typography>
            {idRows.length > 0 && (
              <Chip icon={<VpnKey sx={{ fontSize: '11px !important' }} />} label={`${idRows.length} id`}
                size="small" sx={{ height: 17, fontSize: 9, bgcolor: PwC.tangerineLight, color: '#9A3412' }} />
            )}
            {issueRows.length > 0 && (
              <Chip icon={<Warning sx={{ fontSize: '11px !important', color: `${PwC.amber} !important` }} />}
                label={`${issueRows.length} issues`} size="small"
                sx={{ height: 17, fontSize: 9, bgcolor: PwC.amberLight, color: PwC.amber }} />
            )}
          </Stack>
          <Typography sx={{ fontSize: 10, color: PwC.mist }}>
            {fmtNum(d.row_count)} rows · {d.columns?.length ?? 0} cols
            {d.filename ? ` · ${d.filename}` : ''}
          </Typography>
        </Box>

        {/* Quality mini-indicator */}
        {qualitySafe != null && (
          <Box sx={{ width: 36, height: 36, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CircularProgress variant="determinate" value={qualitySafe} size={32}
              sx={{ color: qualityColor(qualitySafe), position: 'absolute', '& .MuiCircularProgress-circle': { strokeLinecap: 'round' } }} />
            <CircularProgress variant="determinate" value={100} size={32}
              sx={{ color: PwC.smoke, position: 'absolute' }} />
            <Typography sx={{ fontSize: 8, fontWeight: 800, color: qualityColor(qualitySafe), zIndex: 1 }}>
              {Math.round(qualitySafe)}
            </Typography>
          </Box>
        )}

        <Stack direction="row" spacing={0.25} alignItems="center">
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: PwC.emerald }} />
          <Tooltip title={expanded ? 'Collapse' : persona === 'business' ? 'View insights' : 'View schema'}>
            <IconButton size="small" onClick={onExpand} sx={{ p: 0.5 }}>
              {isLoading
                ? <CircularProgress size={13} sx={{ color: PwC.tangerine }} />
                : expanded
                  ? <ExpandLess fontSize="small" sx={{ color: PwC.tangerine, fontSize: 15 }} />
                  : <ExpandMore fontSize="small" sx={{ color: PwC.mist, fontSize: 15 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove dataset">
            <IconButton size="small" onClick={onDelete} sx={{ p: 0.5 }}>
              <Delete fontSize="small" sx={{ color: PwC.smoke, fontSize: 15, '&:hover': { color: PwC.red } }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Expanded panel */}
      <Collapse in={expanded}>
        {detailsErr ? (
          <Alert severity="warning" sx={{ m: 1.5, py: 0.5, fontSize: 11 }}>{detailsErr}</Alert>
        ) : schemaRows.length === 0 && !isLoading ? (
          <Box sx={{ px: 1.5, py: 1.25 }}>
            <Typography sx={{ fontSize: 11, color: PwC.mist }}>Schema not available</Typography>
          </Box>
        ) : (
          persona === 'business'
            ? <BusinessPanel dataset={d} profile={profile} allDatasets={allDatasets} />
            : <TechnicalPanel dataset={d} schema={schema} profile={profile} allDatasets={allDatasets} />
        )}
      </Collapse>
    </Box>
  );
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
const DataUploadScreen = ({
  persona,
  datasets = [],
  onDatasetsRefresh,
  activePipelineId = null,
  activePipelineName = '',
  onPipelineActivated,
}) => {
  const [queue, setQueue]                   = useState([]);
  const [dragOver, setDragOver]             = useState(false);
  const [expandedId, setExpandedId]         = useState(null);
  const [schemaMap, setSchemaMap]           = useState({});
  const [loadingSchema, setLoadingSchema]   = useState(null);
  const [profileMap, setProfileMap]         = useState({});
  const [loadingProfile, setLoadingProfile] = useState(null);
  const [resetting, setResetting]           = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [duplicateWarnings, setDuplicateWarnings] = useState({});
  const [uiError, setUiError] = useState('');
  const [uiInfo, setUiInfo] = useState('');
  const fileInputRef = useRef();

  const addToQueue = (files) => {
    const items = Array.from(files).map((file) => ({
      id: `${Date.now()}_${Math.random()}`,
      file,
      type: autoDetectType(file.name),
      customName: '',
      status: 'pending',
      progress: 0,
      error: null,
      result: null,
    }));
    setQueue((prev) => [...prev, ...items]);
  };

  const updateItem = (id, patch) =>
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const removeFromQueue = (id) =>
    setQueue((prev) => prev.filter((item) => item.id !== id));

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    addToQueue(e.dataTransfer.files);
  }, []);

  const validateItem = (item) => {
    if (item.restoredPlaceholder) return 'Reattach the source file before upload';
    const e2 = ext(item.file);
    if (!['csv', 'parquet'].includes(e2)) return `".${e2}" not supported - CSV or Parquet only`;
    if (item.file.size / 1048576 > MAX_MB) return `File exceeds ${MAX_MB} MB limit`;
    const resolvedType = item.type === 'custom' ? item.customName : item.type;
    if (!resolvedType) return 'Select a dataset type';
    if (item.type === 'custom' && !/^[a-z0-9_-]+$/.test(resolvedType))
      return 'Custom name: lowercase letters, digits, underscores only';
    return null;
  };

  const uploadItem = async (item) => {
    const err = validateItem(item);
    if (err) { updateItem(item.id, { status: 'error', error: err }); return; }
    const resolvedType = item.type === 'custom' ? item.customName : item.type;
    updateItem(item.id, { status: 'uploading', progress: 10, error: null });
    try {
      let prog = 10;
      const tick = setInterval(() => { prog = Math.min(prog + 15, 85); updateItem(item.id, { progress: prog }); }, 400);
      const res = await mlopsApi.uploadDataset(resolvedType, item.file);
      clearInterval(tick);
      updateItem(item.id, { status: 'done', progress: 100, result: res.data || res });
      onDatasetsRefresh?.();
    } catch (e) {
      updateItem(item.id, { status: 'error', error: e?.response?.data?.error || e?.message || 'Upload failed', progress: 0 });
    }
  };

  const uploadAll = () => queue.filter((i) => i.status === 'pending').forEach(uploadItem);

  const loadSchema = async (dataset) => {
    if (schemaMap[dataset.dataset_id]) return;
    setLoadingSchema(dataset.dataset_id);
    try {
      const res = await mlopsApi.schemaPreview({ dataset_id: dataset.dataset_id });
      const payload = { ...(res.data || res || {}) };
      if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
        try {
          const previewRes = await mlopsApi.datasetRows(dataset.dataset_id, { sample_rows: 12 });
          const previewPayload = previewRes?.data || previewRes || {};
          payload.preview_rows = Array.isArray(previewPayload.preview) ? previewPayload.preview : [];
          const previewKeys = payload.preview_rows.flatMap((row) => (
            row && typeof row === 'object' ? Object.keys(row) : []
          ));
          payload.columns = Array.isArray(payload.columns) && payload.columns.length
            ? payload.columns
            : Array.isArray(previewPayload.columns)
              ? previewPayload.columns
              : previewKeys.length
                ? Array.from(new Set(previewKeys))
                : payload.columns;
        } catch {
          payload.preview_rows = payload.preview_rows || [];
        }
      }
      setSchemaMap((prev) => ({ ...prev, [dataset.dataset_id]: payload }));
    } catch {
      setSchemaMap((prev) => ({ ...prev, [dataset.dataset_id]: { error: 'Could not load schema' } }));
    } finally {
      setLoadingSchema(null);
    }
  };

  const loadProfile = async (dataset) => {
    if (profileMap[dataset.dataset_id]) return;
    setLoadingProfile(dataset.dataset_id);
    try {
      const res = await mlopsApi.profileMetadata({ dataset_id: dataset.dataset_id });
      setProfileMap((prev) => ({ ...prev, [dataset.dataset_id]: res.data || res }));
    } catch {
      setProfileMap((prev) => ({ ...prev, [dataset.dataset_id]: { error: 'Could not load profile' } }));
    } finally {
      setLoadingProfile(null);
    }
  };

  // Load duplicates for technical users when expanding
  const loadDuplicates = async (dataset) => {
    if (duplicateWarnings[dataset.dataset_id] !== undefined) return;
    try {
      const res = await mlopsApi.duplicates({ dataset_id: dataset.dataset_id, sample_rows: 50000 });
      const data = res?.data || res;
      setDuplicateWarnings((prev) => ({ ...prev, [dataset.dataset_id]: data?.duplicate_count ?? 0 }));
    } catch {
      setDuplicateWarnings((prev) => ({ ...prev, [dataset.dataset_id]: null }));
    }
  };

  const toggleExpanded = (dataset) => {
    const id = dataset.dataset_id;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    loadSchema(dataset);
    loadProfile(dataset);
    if (persona === 'technical') loadDuplicates(dataset);
  };

  const deleteDataset = async (dataset) => {
    setUiError('');
    try {
      await mlopsApi.deleteDataset(dataset.dataset_id);
      onDatasetsRefresh?.();
      if (expandedId === dataset.dataset_id) setExpandedId(null);
      setSchemaMap((prev)  => { const n = { ...prev };  delete n[dataset.dataset_id]; return n; });
      setProfileMap((prev) => { const n = { ...prev };  delete n[dataset.dataset_id]; return n; });
      setUiInfo(`Deleted dataset "${dataset.dataset_type || dataset.dataset_id}".`);
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Delete failed');
    }
  };

  const resetWorkspace = async () => {
    setResetting(true);
    setUiError('');
    try {
      await mlopsApi.resetDatasets({ delete_files: false });
      setExpandedId(null);
      setSchemaMap({});
      setProfileMap({});
      onDatasetsRefresh?.();
      setResetConfirmOpen(false);
      setUiInfo('Pipeline state reset. Raw uploaded files are still available.');
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const openResetConfirm = () => {
    if (canDisable(resetting)) return;
    setResetConfirmOpen(true);
  };

  const closeResetConfirm = () => {
    if (resetting) return;
    setResetConfirmOpen(false);
  };

  // Summary stats
  const totalRows    = datasets.reduce((s, d) => s + (d.row_count || 0), 0);
  const totalCols    = datasets.reduce((s, d) => s + (d.columns?.length || 0), 0);
  const pendingCount = queue.filter((i) => i.status === 'pending').length;
  const strDataset   = datasets.find((d) => ['str', 'sar'].includes(safe(d.dataset_type)));
  const alertDataset = datasets.find((d) => safe(d.dataset_type) === 'alerts');
  const avgQuality   = useMemo(() => {
    const scores = Object.values(profileMap).map((p) => Number(p?.quality_score)).filter((n) => Number.isFinite(n));
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [profileMap]);

  // Business: derive total flagged estimate from profile data
  const estimatedFlagged = useMemo(() => {
    if (!alertDataset) return null;
    return alertDataset.row_count;
  }, [alertDataset]);

  const uploadPipelineState = useMemo(() => ({
    expected_dataset_types: queue.map((q) => ({
      type: q.type,
      custom_name: q.customName || '',
      file_name: q.file?.name || '',
    })),
    dataset_ids: datasets.map((d) => Number(d.dataset_id)).filter((id) => Number.isFinite(id) && id > 0),
    uploaded_dataset_types: datasets.map((d) => d.dataset_type),
    has_str_dataset: Boolean(strDataset),
    total_tables: datasets.length,
    total_rows: totalRows,
  }), [queue, datasets, strDataset, totalRows]);

  const uploadSummaryItems = useMemo(() => ([
    `Uploaded tables: ${datasets.length}`,
    `Queued files: ${queue.length}`,
    `STR linked: ${strDataset ? 'yes' : 'no'}`,
    `Total rows: ${fmtNum(totalRows)}`,
  ]), [datasets.length, queue.length, strDataset, totalRows]);

  const handleLoadUploadPipeline = useCallback((state, pipeline) => {
    const expected = Array.isArray(state?.expected_dataset_types)
      ? state.expected_dataset_types
      : [];
    if (!expected.length) return;

    const restored = expected.map((entry, idx) => ({
      id: `restored_${Date.now()}_${idx}`,
      file: { name: entry.file_name || `${entry.type || 'dataset'}.csv`, size: 0 },
      type: entry.type || 'transactions',
      customName: entry.custom_name || '',
      status: 'pending',
      progress: 0,
      error: 'Attach file and upload again.',
      result: null,
      restoredPlaceholder: true,
    }));

    setQueue(restored);
    if (pipeline?.name) {
      setExpandedId(null);
    }
  }, []);

  const buildUploadSavePayload = useCallback(({ name, currentState, datasetId, persona: actor }) => ({
    name,
    dataset_id: Number(datasetId || 0),
    created_by_persona: actor || 'technical',
    steps: [{
      type: 'screen_state',
      screen: 'data_upload',
      state: currentState,
    }],
  }), []);

  return (
    <>
    <Box sx={{
      display: 'flex',
      gap: 2.5,
      height: '100%',
      minHeight: 0,
      alignItems: 'stretch',
      flexDirection: { xs: 'column', lg: 'row' },
      overflow: 'hidden',
    }}>
      <ScreenPipelineRail
        screenKey="data_upload"
        screenLabel="Data Upload"
        persona={persona}
        datasetId={datasets[0]?.dataset_id || null}
        currentState={uploadPipelineState}
        onLoadState={handleLoadUploadPipeline}
        buildSavePayload={buildUploadSavePayload}
        summaryItems={uploadSummaryItems}
        activePipelineId={activePipelineId}
        activePipelineName={activePipelineName}
        onPipelineActivated={onPipelineActivated}
      />

      {/* ── SIDE: Upload Zone + Queue ── */}
      <Box sx={{
        width: { xs: '100%', lg: 300 },
        maxWidth: { xs: '100%', lg: 320 },
        flexShrink: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        order: { xs: 2, lg: 3 },
        overflowY: { lg: 'auto' },
        pr: { lg: 0.5 },
      }}>

        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 800, color: PwC.midnight, fontFamily: '"Georgia", serif', mb: 0.25 }}>
            {persona === 'business' ? 'Load your data' : 'Upload data tables'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: PwC.ash }}>
            {persona === 'business'
              ? 'Drop your data files below - we\'ll automatically detect the table type and surface key business insights.'
              : 'Drop CSV or Parquet files. Auto-type detection active. Max 500 MB per file.'}
          </Typography>
        </Box>

        {uiError && (
          <Alert severity="error" onClose={() => setUiError('')} sx={{ borderRadius: 1.5 }}>
            {uiError}
          </Alert>
        )}
        {uiInfo && (
          <Alert severity="success" onClose={() => setUiInfo('')} sx={{ borderRadius: 1.5 }}>
            {uiInfo}
          </Alert>
        )}

        {/* Business top-level KPIs */}
        {persona === 'business' && datasets.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <StatBadge label="Tables Loaded" value={datasets.length} accent={PwC.tangerine} icon={TableChart} />
            <StatBadge label="Total Records" value={fmtNum(totalRows)} accent={PwC.slate} icon={Assessment} />
            <StatBadge label="Alert Records" value={estimatedFlagged != null ? fmtNum(estimatedFlagged) : '-'} accent={PwC.red} icon={Notifications} />
            <StatBadge label="Data Quality" value={avgQuality == null ? 'Pending' : `${avgQuality.toFixed(0)}%`}
              accent={avgQuality == null ? PwC.slate : qualityColor(avgQuality)} icon={TrendingUp} />
            <StatBadge label="STR Labels" value={strDataset ? 'Linked' : 'None'} accent={strDataset ? PwC.emerald : PwC.amber} icon={Insights} />
          </Stack>
        )}

        {/* Technical top-level stats */}
        {persona === 'technical' && datasets.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <StatBadge label="Tables" value={datasets.length} accent={PwC.tangerine} icon={TableChart} />
            <StatBadge label="Total Rows" value={fmtNum(totalRows)} accent={PwC.slate} icon={Assessment} />
            <StatBadge label="Total Columns" value={fmtNum(totalCols)} accent={PwC.ash} icon={BubbleChart} />
            <StatBadge label="Avg Quality" value={avgQuality == null ? '-' : `${avgQuality.toFixed(0)}%`}
              accent={avgQuality == null ? PwC.slate : qualityColor(avgQuality)} icon={TrendingUp} />
          </Stack>
        )}

        {/* Drop zone */}
        <Box
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            border: `2px dashed ${dragOver ? PwC.tangerine : PwC.smoke}`,
            borderRadius: '10px',
            bgcolor: dragOver ? PwC.tangerineLight : PwC.white,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            py: 4, px: 3, cursor: 'pointer', transition: 'all 0.2s ease',
            minHeight: 148,
            '&:hover': { borderColor: PwC.tangerine, bgcolor: PwC.tangerineLight },
          }}
        >
          <input ref={fileInputRef} type="file" multiple hidden accept=".csv,.parquet"
            onChange={(e) => { addToQueue(e.target.files); e.target.value = ''; }} />
          <Box sx={{
            width: 48, height: 48, borderRadius: '50%',
            bgcolor: dragOver ? PwC.tangerine : PwC.cloud,
            display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5,
            transition: 'all 0.2s ease',
          }}>
            <CloudUpload sx={{ fontSize: 24, color: dragOver ? PwC.white : PwC.tangerine }} />
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: PwC.midnight, mb: 0.25 }}>
            {dragOver ? 'Release to add files' : 'Drop files here, or click to browse'}
          </Typography>
          <Typography sx={{ fontSize: 12, color: PwC.mist }}>
            CSV · Parquet · Max 500 MB per file · Auto-type detection
          </Typography>
        </Box>

        {/* Upload queue */}
        {queue.length > 0 && (
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Upload Queue ({queue.length})
              </Typography>
              {pendingCount > 1 && (
                <Button size="small" variant="contained" onClick={uploadAll}
                  sx={{ bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight }, fontSize: 11, py: 0.5, height: 28, textTransform: 'none', borderRadius: '4px', boxShadow: 'none' }}>
                  Upload all ({pendingCount})
                </Button>
              )}
            </Stack>
            <Stack spacing={1}>
              {queue.map((item) => (
                <QueueItem key={item.id} item={item} persona={persona}
                  onTypeChange={(v) => updateItem(item.id, { type: v })}
                  onCustomNameChange={(v) => updateItem(item.id, { customName: v })}
                  onUpload={() => uploadItem(item)}
                  onRemove={() => removeFromQueue(item.id)} />
              ))}
            </Stack>
          </Box>
        )}
      </Box>

      {/* ── RIGHT: Registered Datasets ── */}
      <Box sx={{
        flex: '1 1 auto',
        minWidth: 0,
        width: { xs: '100%', lg: 'auto' },
        display: 'flex', flexDirection: 'column', gap: 1.5,
        bgcolor: PwC.cloud, borderRadius: '10px',
        border: `1px solid ${PwC.smoke}`,
        p: { xs: 1.5, lg: 2 },
        overflowY: 'auto',
        minHeight: { xs: 460, lg: 'calc(100vh - 210px)' },
        maxHeight: { lg: 'calc(100vh - 210px)' },
        order: { xs: 1, lg: 2 },
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {persona === 'business' ? `My Data Tables (${datasets.length})` : `Uploaded Tables (${datasets.length})`}
          </Typography>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" variant="text" onClick={openResetConfirm} disabled={canDisable(resetting)}
              sx={{ minWidth: 0, px: 0.8, py: 0.2, fontSize: 10, textTransform: 'none', color: PwC.red }}>
              {resetting ? 'Resetting…' : 'Start Fresh'}
            </Button>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={onDatasetsRefresh} sx={{ p: 0.5 }}>
                <Refresh sx={{ fontSize: 14, color: PwC.mist }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* STR status banner */}
        <Alert severity={strDataset ? 'success' : 'info'}
          icon={strDataset ? <CheckCircle fontSize="small" /> : <Info fontSize="small" />}
          sx={{ py: 0.5, fontSize: 11, borderRadius: '6px', '& .MuiAlert-message': { fontSize: 11 } }}>
          {strDataset
            ? `STR/SAR labels linked - ${fmtNum(strDataset.row_count)} records`
            : 'No STR/SAR dataset yet - upload to enable label attachment'}
        </Alert>

        {/* Dataset cards */}
        {datasets.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 12, color: PwC.mist }}>
              {persona === 'business'
                ? 'No data loaded yet. Drop your files in the upload panel to get started.'
                : 'No datasets registered. Upload files to begin.'}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={0.75}>
            {datasets.map((d) => (
              <RegisteredDatasetCard
                key={d.dataset_id}
                dataset={d}
                persona={persona}
                expanded={expandedId === d.dataset_id}
                schema={schemaMap[d.dataset_id] || null}
                profile={profileMap[d.dataset_id] || null}
                allDatasets={datasets}
                loadingSchema={loadingSchema === d.dataset_id}
                loadingProfile={loadingProfile === d.dataset_id}
                onExpand={() => toggleExpanded(d)}
                onDelete={() => deleteDataset(d)}
              />
            ))}
          </Stack>
        )}

        {/* Pipeline readiness indicator */}
        {datasets.length >= 2 && (
          <Box sx={{ mt: 'auto', pt: 1, borderTop: `1px solid ${PwC.smoke}` }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.6, mb: 0.5 }}>
              Pipeline Readiness
            </Typography>
            <Stack spacing={0.4}>
              {[
                { label: 'Transaction data', ok: datasets.some((d) => ['transactions', 'txn'].includes(safe(d.dataset_type))) },
                { label: 'Customer/Account data', ok: datasets.some((d) => ['accounts', 'customers'].includes(safe(d.dataset_type))) },
                { label: 'Alert/Case data', ok: datasets.some((d) => ['alerts', 'cases'].includes(safe(d.dataset_type))) },
                { label: 'STR labels', ok: Boolean(strDataset) },
              ].map(({ label, ok }) => (
                <Stack key={label} direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ok ? PwC.emerald : PwC.smoke, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10.5, color: ok ? PwC.slate : PwC.mist }}>{label}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </Box>
    </Box>

    <Dialog
      open={resetConfirmOpen}
      onClose={closeResetConfirm}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '10px',
          border: `1px solid ${PwC.smoke}`,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Warning sx={{ color: PwC.tangerine, fontSize: 20 }} />
          <Typography sx={{ fontSize: 16, fontWeight: 800, color: PwC.midnight }}>
            Reset Pipeline State?
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography sx={{ fontSize: 13, color: PwC.slate, mb: 1 }}>
          This will clear workbench pipeline state for this environment.
        </Typography>
        <Alert
          severity="info"
          sx={{
            borderRadius: '6px',
            '& .MuiAlert-message': { fontSize: 12 },
            mb: 1,
          }}
        >
          Raw uploaded files will be kept.
        </Alert>
        <Typography sx={{ fontSize: 12, color: PwC.ash }}>
          You can continue from a clean pipeline without re-uploading source files.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={closeResetConfirm}
          disabled={resetting}
          variant="text"
          sx={{ textTransform: 'none', color: PwC.ash }}
        >
          Cancel
        </Button>
        <Button
          onClick={resetWorkspace}
          disabled={resetting}
          variant="contained"
          sx={{
            textTransform: 'none',
            bgcolor: PwC.tangerine,
            '&:hover': { bgcolor: PwC.midnight },
          }}
        >
          {resetting ? 'Resetting…' : 'Reset State'}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
};

export default DataUploadScreen;
