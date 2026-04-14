// ─── DataUploadScreen.jsx  ·  Part 1 / 3
// PwC FCC Workbench — Enterprise-grade layout
// Tokens · Constants · Helpers · Sub-components

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider,
  Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, LinearProgress,
  MenuItem, Select, Stack, TextField, Tooltip, Typography,
  ToggleButton, ToggleButtonGroup, Table, TableBody,
  TableCell, TableHead, TableRow, Paper,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  CheckCircle, CloudUpload, Delete, ErrorOutline,
  FilePresent, Info, Refresh, TableChart, Warning,
  Insights, VpnKey, OpenInFull, Close,
  LinkOff, Schedule, TrendingUp, Assessment,
  BubbleChart, Notifications, AccountTree, Add,
  FolderOpen, PlayArrow, MoreVert, Circle,
  CheckCircleOutline, RadioButtonUnchecked,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';
import { getScreenState } from '../utils/pipelineState';

// ─── PwC Design Tokens ────────────────────────────────────────────────────────
const PwC = {
  tangerine:      '#D04A02',
  tangerineMid:   '#E8651A',
  tangerineLight: '#FFF1EC',
  tangerineDim:   '#FCE9DF',
  red:            '#E0301E',
  midnight:       '#151B27',
  midnightMid:    '#1E2D3D',
  slate:          '#24364C',
  ash:            '#334155',
  mist:           '#64748B',
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
  // Enterprise surface tones
  surface:        '#F8F9FB',
  surfaceAlt:     '#F1F3F6',
  border:         '#DDE2EA',
  borderStrong:   '#C5CDD8',
};

// ─── Constants ────────────────────────────────────────────────────────────────
const PRESET_TYPES = [
  { value: 'transactions',   label: 'Transactions',    desc: 'Payment & transfer records',       icon: '⇄',   color: PwC.sapphireLight, bizHint: 'Financial movement data' },
  { value: 'accounts',       label: 'Accounts',         desc: 'Account master data',              icon: '◫',  color: PwC.cloud,          bizHint: 'Customer account records' },
  { value: 'customers',      label: 'Customers',        desc: 'Customer KYC profiles',            icon: '◯',  color: PwC.cloud,          bizHint: 'Know Your Customer data' },
  { value: 'alerts',         label: 'Alerts',           desc: 'Rule-engine alert outputs',        icon: '⚑',  color: PwC.amberLight,     bizHint: 'System-generated flags' },
  { value: 'cases',          label: 'Cases',            desc: 'Investigation case records',       icon: '⊞',  color: PwC.cloud,          bizHint: 'AML investigation cases' },
  { value: 'str',            label: 'STR / SAR',        desc: 'Suspicious transaction reports',   icon: '⚠',  color: PwC.roseLight,      bizHint: 'Regulatory filings' },
  { value: 'sanctions',      label: 'Sanctions',        desc: 'Sanctions / watchlist data',       icon: '⊗',  color: PwC.cloud,          bizHint: 'Watchlist entities' },
  { value: 'counterparties', label: 'Counterparties',   desc: 'Beneficiary / sender entities',    icon: '⇌',  color: PwC.cloud,          bizHint: 'Third-party entities' },
  { value: 'custom',         label: '+ Custom',         desc: 'Enter any table name',             icon: '✎',  color: PwC.surfaceAlt,     bizHint: 'Custom data type' },
];
const MULE_PRESET_TYPES = [
  { value: 'device_logs', label: 'Device Logs', desc: 'Device and channel access activity', icon: 'DEV', color: PwC.cloud, bizHint: 'Digital access signals' },
  { value: 'external_signals', label: 'External Signals', desc: 'External risk and intelligence signals', icon: 'EXT', color: PwC.cloud, bizHint: 'External intelligence' },
  { value: 'graph_nodes', label: 'Graph Nodes', desc: 'Entity nodes for network analytics', icon: 'NODE', color: PwC.cloud, bizHint: 'Network entities' },
  { value: 'graph_edges', label: 'Graph Edges', desc: 'Relationship edges for network analytics', icon: 'EDGE', color: PwC.cloud, bizHint: 'Network relationships' },
  { value: 'account_daily_summary', label: 'Account Daily Summary', desc: 'Daily account-level aggregates', icon: 'DAY', color: PwC.cloud, bizHint: 'Historical account behavior' },
  { value: 'mule_labels', label: 'Mule Outcome Labels', desc: 'Confirmed or proxy mule outcomes', icon: 'LBL', color: PwC.roseLight, bizHint: 'Outcome reference data' },
  { value: 'mule_typology', label: 'Mule Typology', desc: 'Typology propensity reference data', icon: 'TYP', color: PwC.violetLight, bizHint: 'Typology scoring context' },
];
const ALL_PRESET_TYPES = [
  ...PRESET_TYPES.slice(0, -1),
  ...MULE_PRESET_TYPES,
  PRESET_TYPES[PRESET_TYPES.length - 1],
];
const TYPE_META = Object.fromEntries(ALL_PRESET_TYPES.map(t => [t.value, t]));

// Type badge colors — muted, catalog-style
const TYPE_BADGE = {
  transactions:   { bg: '#EFF6FF', fg: '#1D4ED8', label: 'TXN' },
  accounts:       { bg: '#F1F5F9', fg: '#334155', label: 'ACCT' },
  customers:      { bg: '#F0FDF4', fg: '#15803D', label: 'CUST' },
  alerts:         { bg: '#FFFBEB', fg: '#B45309', label: 'ALRT' },
  cases:          { bg: '#F5F3FF', fg: '#6D28D9', label: 'CASE' },
  str:            { bg: '#FFF1F2', fg: '#BE123C', label: 'STR' },
  sanctions:      { bg: '#FEF2F2', fg: '#B91C1C', label: 'SANC' },
  counterparties: { bg: '#F0F9FF', fg: '#0369A1', label: 'CP' },
};
const typeBadge = (type) => ({
  device_logs: { bg: '#ECFEFF', fg: '#0F766E', label: 'DEV' },
  external_signals: { bg: '#FFF7ED', fg: '#C2410C', label: 'EXT' },
  graph_nodes: { bg: '#EEF2FF', fg: '#4338CA', label: 'NODE' },
  graph_edges: { bg: '#F5F3FF', fg: '#7C3AED', label: 'EDGE' },
  account_daily_summary: { bg: '#F8FAFC', fg: '#475569', label: 'DAY' },
  mule_labels: { bg: '#FFF1F2', fg: '#BE123C', label: 'LBL' },
  mule_typology: { bg: '#F5F3FF', fg: '#6D28D9', label: 'TYP' },
}[type] || TYPE_BADGE[type] || { bg: PwC.cloud, fg: PwC.ash, label: (type || 'DATA').slice(0, 4).toUpperCase() });

const MAX_MB = 500;
const fmtBytes  = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtNum    = (n) => n == null ? 'N/A' : Number(n).toLocaleString();
const ext       = (f) => (f.name || '').split('.').pop().toLowerCase();
const safe      = (v) => String(v || '').trim().toLowerCase();
const ratio     = (v) => { const n = Number(v); if (!Number.isFinite(n)) return null; return n > 1 ? n / 100 : n; };
const pct       = (v, d = 1) => { const r = ratio(v); return r == null ? 'N/A' : `${(r * 100).toFixed(d)}%`; };
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;
const toColumnName = (column) => {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object') return String(column.name || column.column || column.field || '').trim();
  return '';
};
const normalizeColumns = (columns = []) => (Array.isArray(columns) ? columns : [])
  .map((column) => toColumnName(column)).filter(Boolean);
const normalizeColumnTypes = (...sources) => {
  const merged = {};
  sources.forEach((source) => {
    const types = source?.column_types || {};
    Object.entries(types).forEach(([key, value]) => { if (key && value != null) merged[key] = value; });
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
  for (const { value } of ALL_PRESET_TYPES.slice(0, -1)) { if (lower.includes(value)) return value; }
  if (lower.includes('txn') || lower.includes('payment')) return 'transactions';
  if (lower.includes('acct') || lower.includes('account')) return 'accounts';
  if (lower.includes('cust') || lower.includes('client')) return 'customers';
  if (lower.includes('counterpart')) return 'counterparties';
  if (lower.includes('device')) return 'device_logs';
  if (lower.includes('external') || lower.includes('intel') || lower.includes('signal')) return 'external_signals';
  if (lower.includes('graph_node')) return 'graph_nodes';
  if (lower.includes('graph_edge')) return 'graph_edges';
  if (lower.includes('daily_summary') || lower.includes('daily')) return 'account_daily_summary';
  if (lower.includes('mule_label') || lower.includes('outcome_label') || lower.includes('labels')) return 'mule_labels';
  if (lower.includes('typology')) return 'mule_typology';
  if (lower.includes('sar') || lower.includes('suspi')) return 'str';
  return 'transactions';
};

// ─── Data builders (unchanged logic) ──────────────────────────────────────────
const buildColumnRows = (dataset, schema, profile) => {
  const schemaDetails  = Array.isArray(schema?.columns_detail)  ? schema.columns_detail  : [];
  const profileDetails = Array.isArray(profile?.columns_detail) ? profile.columns_detail : [];
  const detailsBySchema  = new Map(schemaDetails.map((d) => [safe(d?.name), d]));
  const detailsByProfile = new Map(profileDetails.map((d) => [safe(d?.name), d]));
  const columnTypes = normalizeColumnTypes(dataset, schema);
  const previewRows = Array.isArray(schema?.rows) && schema.rows.length ? schema.rows
    : Array.isArray(schema?.preview_rows) ? schema.preview_rows : [];
  const previewKeys = previewRows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : [])).filter(Boolean);
  const names = new Set([
    ...normalizeColumns(dataset?.columns), ...normalizeColumns(schema?.columns),
    ...schemaDetails.map((d) => d?.name).filter(Boolean),
    ...profileDetails.map((d) => d?.name).filter(Boolean), ...previewKeys,
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
    return { id: `${idx}_${String(name)}`, name: String(name), dtype, role, null_pct: nullPct,
      unique_count: uniqueCount, cardinality_ratio: cardinalityRatio,
      sample: sampleValue != null ? String(sampleValue) : 'N/A',
      identifier_confidence: idConfidence, model_action: modelAction,
      is_identifier: isIdentifier, is_high_card: isHighCard, temporal_gaps: temporalGaps, issue_flags: issueFlags };
  });
  rows.sort((a, b) => { if (a.is_identifier !== b.is_identifier) return a.is_identifier ? -1 : 1; return a.name.localeCompare(b.name); });
  return rows;
};

const getPreviewRows = (schema) => (
  Array.isArray(schema?.rows) && schema.rows.length ? schema.rows
    : Array.isArray(schema?.preview_rows) ? schema.preview_rows : []
);

const buildPreviewColumns = (previewRows, variant = 'inline') => {
  if (!Array.isArray(previewRows) || !previewRows.length) return [];
  const isDialog = variant === 'dialog';
  const keys = Array.from(new Set(previewRows.flatMap((row) => (
    row && typeof row === 'object' ? Object.keys(row) : []
  )))).slice(0, isDialog ? 40 : 30);
  return keys.map((key) => ({
    field: key, headerName: key, minWidth: isDialog ? 160 : 110, flex: 1,
    renderCell: ({ value }) => (
      <Typography sx={{ fontSize: isDialog ? 11.5 : 10, color: PwC.mist, fontFamily: 'monospace', lineHeight: 1.5 }} noWrap>
        {value == null ? '' : String(value)}
      </Typography>
    ),
  }));
};

const deriveJoinCandidates = (dataset, allDatasets) => {
  const myCols = new Set(normalizeColumns(dataset?.columns).map(safe));
  const links = [];
  for (const other of allDatasets) {
    if (other.dataset_id === dataset.dataset_id) continue;
    const otherCols = new Set(normalizeColumns(other?.columns).map(safe));
    const shared = [...myCols].filter((c) => otherCols.has(c) && (c.endsWith('_id') || c === 'id'));
    if (shared.length) links.push({ to: other.dataset_type, keys: shared });
  }
  return links;
};

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
      : days <= 30 ? `Data freshness: ${days} days old. Verify recency`
      : `Data freshness: potentially stale (${days} days since last record)`;
  }
  return { summary: parts.join(' · '), freshnessNote };
};

// ─── Shared UI Atoms ──────────────────────────────────────────────────────────

// Enterprise metric tile — tighter, more Redshift-console feel
const MetricTile = ({ label, value, sub, accent = PwC.tangerine, icon: Icon }) => (
  <Box sx={{
    flex: '1 1 0', minWidth: 100,
    bgcolor: PwC.white,
    border: `1px solid ${PwC.border}`,
    borderRadius: '6px',
    px: 1.75, py: 1.25,
    position: 'relative',
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: '2px',
      bgcolor: accent,
    },
  }}>
    <Stack direction="row" alignItems="center" spacing={0.6} mb={0.5}>
      {Icon && <Icon sx={{ fontSize: 11, color: accent }} />}
      <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.mist, textTransform: 'uppercase', letterSpacing: 0.9 }}>
        {label}
      </Typography>
    </Stack>
    <Typography sx={{ fontSize: 20, fontWeight: 800, color: PwC.midnight, lineHeight: 1, letterSpacing: '-0.5px' }}>
      {value}
    </Typography>
    {sub && <Typography sx={{ fontSize: 10, color: PwC.mist, mt: 0.35 }}>{sub}</Typography>}
  </Box>
);

const QualityRing = ({ score, size = 36 }) => {
  const color = qualityColor(score);
  return (
    <Box sx={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <CircularProgress variant="determinate" value={100} size={size} sx={{ color: PwC.smoke, position: 'absolute' }} />
      <CircularProgress variant="determinate" value={Math.min(100, score)} size={size}
        sx={{ color, position: 'absolute', '& .MuiCircularProgress-circle': { strokeLinecap: 'round' } }} />
      <Typography sx={{ fontSize: size < 36 ? 8 : 9, fontWeight: 800, color, zIndex: 1, letterSpacing: '-0.3px' }}>
        {Math.round(score)}
      </Typography>
    </Box>
  );
};

const NullBar = ({ value }) => {
  const r = ratio(value);
  if (r == null) return <Typography sx={{ fontSize: 11, color: PwC.mist }}>N/A</Typography>;
  const pctVal = r * 100;
  const color = pctVal > 20 ? PwC.red : pctVal > 5 ? PwC.amber : PwC.emerald;
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <Box sx={{ width: 44, height: 4, bgcolor: PwC.smoke, borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.min(100, pctVal)}%`, height: '100%', bgcolor: color, borderRadius: 2 }} />
      </Box>
      <Typography sx={{ fontSize: 10, color, fontWeight: 600, minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>
        {pctVal.toFixed(1)}%
      </Typography>
    </Stack>
  );
};

// ─── QueueItem ─────────────────────────────────────────────────────────────────
const QueueItem = ({ item, persona, uploadDisabled = false, onTypeChange, onCustomNameChange, onUpload, onRemove }) => {
  const STATUS = {
    pending:   { color: PwC.border,   icon: RadioButtonUnchecked, label: 'Ready' },
    uploading: { color: PwC.sapphire, icon: CloudUpload,          label: 'Uploading…' },
    done:      { color: PwC.emerald,  icon: CheckCircleOutline,   label: 'Uploaded' },
    error:     { color: PwC.red,      icon: ErrorOutline,         label: 'Error' },
  };
  const meta = STATUS[item.status] || STATUS.pending;
  const StatusIcon = meta.icon;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25,
      bgcolor: PwC.white,
      border: `1px solid ${PwC.border}`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: '5px',
      px: 1.25, py: 0.85,
      transition: 'border-color 0.15s',
    }}>
      <StatusIcon sx={{ fontSize: 16, color: meta.color, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: PwC.midnight, fontFamily: 'monospace' }} noWrap>
          {item.file.name}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" mt={0.1}>
          <Typography sx={{ fontSize: 10, color: PwC.mist }}>
            {fmtBytes(item.file.size)} · {ext(item.file).toUpperCase()}
          </Typography>
          {item.status === 'error' && (
            <Typography sx={{ fontSize: 10, color: PwC.red }}>{item.error}</Typography>
          )}
        </Stack>
        {item.status === 'uploading' && (
          <LinearProgress variant="determinate" value={item.progress}
            sx={{ mt: 0.5, height: 2, borderRadius: 2, bgcolor: PwC.smoke, '& .MuiLinearProgress-bar': { bgcolor: PwC.tangerine } }} />
        )}
      </Box>

      {item.status === 'pending' && (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <FormControl size="small" sx={{ width: 148 }}>
            <InputLabel sx={{ fontSize: 11 }}>Dataset type</InputLabel>
            <Select value={item.type} label="Dataset type" onChange={(e) => onTypeChange(e.target.value)}
              sx={{ fontSize: 11.5, '& .MuiSelect-select': { py: 0.65 } }}>
              {ALL_PRESET_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value} sx={{ fontSize: 11.5 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 11.5 }}>{t.label}</Typography>
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
            <TextField size="small" label="Table name" placeholder="e.g. fx_trades"
              value={item.customName}
              onChange={(e) => onCustomNameChange(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              sx={{ width: 120, '& .MuiInputBase-input': { fontSize: 11.5 } }} />
          )}
        </Stack>
      )}

      <Stack direction="row" spacing={0.25} alignItems="center" flexShrink={0}>
        {item.status === 'pending' && (
          <Button size="small" variant="contained" onClick={onUpload} disabled={uploadDisabled}
            sx={{
              bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight },
              fontSize: 11, fontWeight: 700, py: 0.45, height: 27,
              textTransform: 'none', borderRadius: '4px', boxShadow: 'none', minWidth: 64,
            }}>
            Upload
          </Button>
        )}
        <IconButton size="small" onClick={onRemove} sx={{ color: PwC.smoke, '&:hover': { color: PwC.red }, p: 0.35 }}>
          <Delete sx={{ fontSize: 15 }} />
        </IconButton>
      </Stack>
    </Box>
  );
};

// ─── Pipeline Run Panel ────────────────────────────────────────────────────────
const PipelineRunPanel = ({
  activePipelineId, activePipelineName, pipelineName, pipelineType, savedRuns,
  selectedRunId, loadingRuns, creatingRun, openingRun,
  onPipelineNameChange, onPipelineTypeChange, onCreateRun, onSelectedRunChange, onOpenRun, onRefresh,
  summaryItems = [],
}) => (
  <Box sx={{
    display: 'flex', flexDirection: 'column', gap: 0,
    borderRadius: '8px',
    border: `1px solid ${PwC.border}`,
    bgcolor: PwC.white,
    overflow: 'hidden',
  }}>
    {/* Panel header */}
    <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${PwC.border}`, bgcolor: PwC.surface }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <AccountTree sx={{ fontSize: 15, color: PwC.tangerine }} />
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: PwC.midnight, letterSpacing: 0.1 }}>
            PIPELINE RUN
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onRefresh} sx={{ p: 0.4, color: PwC.mist }}>
          <Refresh sx={{ fontSize: 14 }} />
        </IconButton>
      </Stack>
    </Box>

    <Box sx={{ p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* Status chip */}
      {activePipelineId ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.9, bgcolor: PwC.emeraldLight, borderRadius: '5px', border: `1px solid #A7F3D0` }}>
          <Circle sx={{ fontSize: 7, color: PwC.emerald }} />
          <Typography sx={{ fontSize: 11.5, color: '#065F46', fontWeight: 600 }}>
            {activePipelineName || `Run #${activePipelineId}`}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.9, bgcolor: PwC.amberLight, borderRadius: '5px', border: `1px solid #FDE68A` }}>
          <Circle sx={{ fontSize: 7, color: PwC.amber }} />
          <Typography sx={{ fontSize: 11, color: '#78350F', fontWeight: 500 }}>
            No active run. Create or open one below
          </Typography>
        </Box>
      )}

      {/* New run name */}
      <TextField
        size="small"
        label="Run name"
        value={pipelineName}
        onChange={(e) => onPipelineNameChange(e.target.value)}
        placeholder="e.g. Experiment 1"
        InputLabelProps={{ sx: { fontSize: 11.5, fontWeight: 600 } }}
        sx={{ '& .MuiInputBase-input': { fontSize: 13, fontWeight: 600, color: PwC.midnight } }}
      />

      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: 11.5, fontWeight: 600 }}>Model family</InputLabel>
        <Select
          value={pipelineType}
          label="Model family"
          onChange={(e) => onPipelineTypeChange(String(e.target.value || 'fcc'))}
          sx={{ '& .MuiSelect-select': { fontSize: 12.5, fontWeight: 600, color: PwC.midnight } }}
        >
          <MenuItem value="fcc" sx={{ fontSize: 12 }}>FCC False Positive Suppression</MenuItem>
          <MenuItem value="mule" sx={{ fontSize: 12 }}>Mule Account Detection</MenuItem>
        </Select>
      </FormControl>

      <Button
        variant="contained"
        startIcon={<Add sx={{ fontSize: 14 }} />}
        onClick={onCreateRun}
        disabled={creatingRun}
        sx={{
          height: 34, fontSize: 12, fontWeight: 700, textTransform: 'none',
          borderRadius: '5px', bgcolor: PwC.tangerine,
          '&:hover': { bgcolor: PwC.midnight }, boxShadow: 'none',
        }}
      >
        {creatingRun ? 'Creating…' : 'Create New Run'}
      </Button>

      <Divider sx={{ borderColor: PwC.border }} />

      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: 11.5, fontWeight: 600 }}>Open existing run</InputLabel>
        <Select value={selectedRunId} label="Open existing run"
          onChange={(e) => onSelectedRunChange(String(e.target.value))}
          sx={{ '& .MuiSelect-select': { fontSize: 12.5, fontWeight: 600, color: PwC.midnight } }}>
          {savedRuns.length === 0 && (
            <MenuItem value="" disabled sx={{ fontSize: 12 }}>No runs yet</MenuItem>
          )}
          {savedRuns.map((run) => (
            <MenuItem key={run.pipeline_id} value={String(run.pipeline_id)} sx={{ fontSize: 12 }}>
              {run.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Button
        variant="outlined"
        startIcon={<FolderOpen sx={{ fontSize: 14 }} />}
        onClick={onOpenRun}
        disabled={!selectedRunId || openingRun || loadingRuns}
        sx={{
          height: 34, fontSize: 12, fontWeight: 700, textTransform: 'none',
          borderRadius: '5px', borderColor: PwC.border, color: PwC.slate,
          '&:hover': { borderColor: PwC.tangerine, color: PwC.tangerine },
        }}
      >
        {openingRun ? 'Opening…' : 'Open Selected Run'}
      </Button>
    </Box>

    {/* Summary footer */}
    {summaryItems.length > 0 && (
      <Box sx={{ px: 1.75, py: 1.25, borderTop: `1px solid ${PwC.border}`, bgcolor: PwC.surface }}>
        <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.mist, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.65 }}>
          Run Summary
        </Typography>
        <Stack spacing={0.3}>
          {summaryItems.map((line) => (
            <Typography key={line} sx={{ fontSize: 11.5, color: PwC.ash, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' }}>
              {line}
            </Typography>
          ))}
        </Stack>
      </Box>
    )}
  </Box>
);

// ─── DataUploadScreen.jsx  ·  Part 2 / 3
// Business panel · Technical panel · Dataset viewer dialog · Dataset catalog row

// ─── Business Persona Panel ────────────────────────────────────────────────────
const BusinessPanel = ({ dataset, profile, allDatasets, variant = 'inline' }) => {
  const isDialog = variant === 'dialog';
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: isDialog ? 2 : 1.5 }}>
      {/* Narrative strip */}
      <Box sx={{
        px: isDialog ? 2 : 1.5, py: isDialog ? 1.5 : 1.1,
        bgcolor: PwC.white,
        border: `1px solid ${PwC.border}`,
        borderLeft: `3px solid ${PwC.tangerine}`,
        borderRadius: '5px',
      }}>
        <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.tangerine, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.4 }}>
          Dataset Summary
        </Typography>
        <Typography sx={{ fontSize: isDialog ? 13 : 12, color: PwC.slate, fontWeight: 500, lineHeight: 1.7 }}>
          {summary || 'Loading summary…'}
        </Typography>
        {freshnessNote && (
          <Typography sx={{ fontSize: isDialog ? 11.5 : 11, color: PwC.mist, mt: 0.4 }}>
            {freshnessNote}
          </Typography>
        )}
      </Box>

      {/* KPI row */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <MetricTile label="Total Records" value={fmtNum(dataset.row_count)} accent={PwC.tangerine} icon={Assessment} />
        {flagRate && (
          <MetricTile label="Flagged Rate" value={`${flagRate}%`}
            accent={Number(flagRate) > 5 ? PwC.red : PwC.amber} icon={Notifications} />
        )}
        {coveragePct && (
          <MetricTile label="Coverage" value={`${coveragePct}%`}
            accent={Number(coveragePct) > 80 ? PwC.emerald : PwC.amber} icon={TrendingUp} />
        )}
        {uniqueEntities && (
          <MetricTile label="Unique Entities" value={fmtNum(uniqueEntities)} accent={PwC.slate} icon={BubbleChart} />
        )}
      </Stack>

      {/* Quality bar */}
      {hasQuality && (
        <Box sx={{ px: 0 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.6}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              Data Quality Score
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: qualityColor(qualityScore), fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(qualityScore)}%
            </Typography>
          </Stack>
          <Box sx={{ height: 5, bgcolor: PwC.smoke, borderRadius: 3, overflow: 'hidden' }}>
            <Box sx={{
              height: '100%', width: `${Math.min(100, qualityScore)}%`,
              bgcolor: qualityColor(qualityScore), borderRadius: 3,
              transition: 'width 0.9s ease',
            }} />
          </Box>
        </Box>
      )}

      {/* Observations */}
      {businessSignals.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.6 }}>
            Key Observations
          </Typography>
          <Stack spacing={0.4}>
            {businessSignals.slice(0, 5).map((s, i) => (
              <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: PwC.tangerine, flexShrink: 0, mt: '6px' }} />
                <Typography sx={{ fontSize: isDialog ? 12.5 : 11.5, color: PwC.slate, lineHeight: 1.65 }}>{s}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

// ─── Sample Preview ────────────────────────────────────────────────────────────
const SamplePreviewPanel = ({ schema, variant = 'inline' }) => {
  const isDialog = variant === 'dialog';
  const previewRows = useMemo(() => getPreviewRows(schema), [schema]);
  const previewCols = useMemo(() => buildPreviewColumns(previewRows, variant), [previewRows, variant]);

  if (previewRows.length > 0 && previewCols.length > 0) {
    return (
      <Box>
        <Box sx={{ mb: 0.75 }}>
          <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
            Sample rows
          </Typography>
          <Typography sx={{ fontSize: isDialog ? 11.5 : 10, color: PwC.mist, mt: 0.2 }}>
            Sampled rows from the uploaded dataset.
          </Typography>
        </Box>
        <Box sx={{ height: isDialog ? 460 : 300 }}>
          <DataGrid
            rows={previewRows.map((row, index) => ({ id: index, ...row }))}
            columns={previewCols}
            density={isDialog ? 'standard' : 'compact'}
            disableColumnMenu
            disableRowSelectionOnClick
            pageSizeOptions={isDialog ? [10, 25, 50, 100] : [10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: isDialog ? 25 : 10, page: 0 } } }}
            sx={{
              border: `1px solid ${PwC.border}`,
              bgcolor: PwC.white,
              fontSize: isDialog ? 12 : 10,
              '& .MuiDataGrid-columnHeaders': {
                bgcolor: PwC.surface,
                minHeight: `${isDialog ? 38 : 28}px !important`,
                fontSize: isDialog ? 11 : 9,
                borderBottom: `1px solid ${PwC.border}`,
              },
              '& .MuiDataGrid-cell': { borderColor: PwC.border, py: isDialog ? 0.75 : 0.2 },
              '& .MuiDataGrid-row:hover': { bgcolor: PwC.tangerineLight },
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Typography sx={{ fontSize: 11, color: PwC.mist, fontStyle: 'italic' }}>
      No preview rows available for this dataset.
    </Typography>
  );
};

// ─── Technical Panel ───────────────────────────────────────────────────────────
const TechnicalPanel = ({ dataset, schema, profile, allDatasets, variant = 'inline' }) => {
  const isDialog = variant === 'dialog';
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

  const columns = [
    {
      field: 'name', headerName: 'Column', flex: 1.4, minWidth: 120,
      renderCell: ({ row, value }) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {row.is_identifier && <VpnKey sx={{ fontSize: 10, color: PwC.tangerine }} />}
          <Typography sx={{ fontSize: 11.5, fontFamily: '"Fira Code", "Cascadia Code", monospace', fontWeight: 600, color: PwC.midnight }}>
            {value}
          </Typography>
          {row.is_high_card && (
            <Chip label="high-card" size="small" sx={{ height: 14, fontSize: 8, bgcolor: PwC.tangerineLight, color: '#9A3412', borderRadius: '3px' }} />
          )}
          {row.temporal_gaps && (
            <Chip label="gaps" size="small" sx={{ height: 14, fontSize: 8, bgcolor: '#FEF2F2', color: '#991B1B', borderRadius: '3px' }} />
          )}
        </Stack>
      ),
    },
    {
      field: 'role', headerName: 'Role', width: 96,
      renderCell: ({ value }) => {
        const role  = safe(value) || 'categorical';
        const color = role === 'identifier' ? { bg: PwC.tangerineLight, fg: '#9A3412' }
          : role === 'numeric'   ? { bg: '#F1F5F9', fg: '#334155' }
          : role === 'binary'    ? { bg: '#F8FAFC', fg: '#475569' }
          : role === 'datetime'  ? { bg: PwC.amberLight, fg: '#92400E' }
          : { bg: '#F8FAFC', fg: '#475569' };
        return (
          <Chip label={value} size="small"
            sx={{ bgcolor: color.bg, color: color.fg, fontSize: 9, height: 18, borderRadius: '3px', fontWeight: 600 }} />
        );
      },
    },
    {
      field: 'dtype', headerName: 'Type', width: 100,
      renderCell: ({ value }) => {
        const { bg, fg } = colChip(value);
        return (
          <Chip label={value} size="small"
            sx={{ bgcolor: bg, color: fg, fontFamily: '"Fira Code", monospace', fontSize: 9, height: 18, borderRadius: '3px' }} />
        );
      },
    },
    {
      field: 'null_pct', headerName: 'Null %', width: 120,
      renderCell: ({ value }) => <NullBar value={value} />,
    },
    {
      field: 'unique_count', headerName: 'Unique', width: 76,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 11, color: PwC.ash, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(value)}</Typography>
      ),
    },
    {
      field: 'model_action', headerName: 'Model', width: 72,
      renderCell: ({ value }) => (
        <Typography sx={{
          fontSize: 10, fontWeight: 700,
          color: safe(value) === 'exclude' ? PwC.red : safe(value) === 'review' ? PwC.amber : PwC.emerald,
        }}>
          {value}
        </Typography>
      ),
    },
    {
      field: 'sample', headerName: 'Sample value', flex: 1, minWidth: 80,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 10, color: PwC.mist, fontFamily: 'monospace' }} noWrap>{value}</Typography>
      ),
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Issue chips */}
      {(highNulls.length > 0 || highCard.length > 0 || tempGaps.length > 0 || joinLinks.length > 0) && (
        <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
          {highNulls.length > 0 && (
            <Chip size="small" icon={<Warning sx={{ fontSize: '11px !important', color: `${PwC.red} !important` }} />}
              label={`${highNulls.length} high-null cols (>50%)`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#FEF2F2', color: PwC.red, border: `1px solid #FECACA`, borderRadius: '4px' }} />
          )}
          {highCard.length > 0 && (
            <Chip size="small" icon={<Warning sx={{ fontSize: '11px !important', color: `${PwC.amber} !important` }} />}
              label={`${highCard.length} high-cardinality`}
              sx={{ fontSize: 10, height: 22, bgcolor: PwC.amberLight, color: PwC.amber, border: `1px solid #FCD34D`, borderRadius: '4px' }} />
          )}
          {tempGaps.length > 0 && (
            <Chip size="small" icon={<Schedule sx={{ fontSize: '11px !important', color: `${PwC.slate} !important` }} />}
              label={`${tempGaps.length} temporal gaps`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#F1F5F9', color: PwC.slate, border: `1px solid ${PwC.border}`, borderRadius: '4px' }} />
          )}
          {joinLinks.map((lnk, i) => (
            <Chip key={i} size="small" icon={<AccountTree sx={{ fontSize: '11px !important', color: `${PwC.slate} !important` }} />}
              label={`→ ${lnk.to} via ${lnk.keys[0]}`}
              sx={{ fontSize: 10, height: 22, bgcolor: '#F8FAFC', color: PwC.slate, border: `1px solid ${PwC.border}`, borderRadius: '4px' }} />
          ))}
        </Stack>
      )}

      {/* Schema header row */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
            Schema · {schemaRows.length} columns
          </Typography>
          {/* Dtype distribution pills */}
          <Stack direction="row" spacing={0.4} flexWrap="wrap">
            {Object.entries(dtypeCounts).map(([k, v]) => {
              const { bg, fg } = colTypePalette[k];
              return (
                <Chip key={k} label={`${k} ×${v}`} size="small"
                  sx={{ bgcolor: bg, color: fg, fontSize: 8.5, height: 16, borderRadius: '3px' }} />
              );
            })}
          </Stack>
        </Stack>

        <ToggleButtonGroup exclusive size="small" value={viewMode} onChange={(_, v) => v && setViewMode(v)}
          sx={{
            '& .MuiToggleButton-root': {
              height: isDialog ? 26 : 22, px: 1, fontSize: isDialog ? 10 : 9,
              textTransform: 'none', border: `1px solid ${PwC.border}`,
              color: PwC.mist,
              '&.Mui-selected': { bgcolor: PwC.midnight, color: PwC.white, borderColor: PwC.midnight },
            },
          }}>
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="id">Keys</ToggleButton>
          <ToggleButton value="model">Model</ToggleButton>
          <ToggleButton value="issues">
            Issues {issueRows.length > 0 && `(${issueRows.length})`}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {/* Schema DataGrid */}
      <Box sx={{ height: isDialog ? 480 : Math.min(Math.max(visibleRows.length, 3) * 36 + 42, 400) }}>
        <DataGrid
          rows={visibleRows} columns={columns} density="compact"
          disableColumnMenu hideFooter disableRowSelectionOnClick
          sx={{
            border: `1px solid ${PwC.border}`,
            fontSize: 11.5, bgcolor: PwC.white,
            '& .MuiDataGrid-columnHeaders': {
              bgcolor: PwC.surface,
              minHeight: `${isDialog ? 38 : 32}px !important`,
              fontSize: isDialog ? 11 : 10,
              borderBottom: `1px solid ${PwC.border}`,
            },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700, color: PwC.ash },
            '& .MuiDataGrid-cell': { borderColor: PwC.border, py: isDialog ? 0.75 : 0.2 },
            '& .MuiDataGrid-row:hover': { bgcolor: PwC.tangerineLight },
          }}
        />
      </Box>

      {/* Sample preview */}
      <SamplePreviewPanel schema={schema} variant={variant} />
    </Box>
  );
};

// ─── Registered Dataset Row (catalog-style) ────────────────────────────────────
const RegisteredDatasetCard = ({ dataset, persona, schema, profile, onOpenViewer, onDelete }) => {
  const d        = dataset;
  const badge    = typeBadge(d.dataset_type);
  const schemaRows = useMemo(() => buildColumnRows(d, schema, profile), [d, schema, profile]);
  const idRows     = schemaRows.filter((r) => r.is_identifier);
  const issueRows  = schemaRows.filter((r) => (ratio(r.null_pct) || 0) >= 0.2 || r.issue_flags.length > 0);

  const qualityScore = Number(profile?.quality_score ?? schema?.quality_score);
  const qualitySafe  = Number.isFinite(qualityScore) ? qualityScore
    : schemaRows.length
      ? Math.max(0, Math.round(100 - (schemaRows.reduce((s, r) => s + ((ratio(r.null_pct) || 0) * 100), 0) / schemaRows.length)))
      : null;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto auto auto',
      alignItems: 'center',
      gap: 0,
      bgcolor: PwC.white,
      border: `1px solid ${PwC.border}`,
      borderRadius: '5px',
      overflow: 'hidden',
      transition: 'border-color 0.15s, box-shadow 0.15s',
      '&:hover': {
        borderColor: PwC.borderStrong,
        boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
      },
    }}>
      {/* Type badge column */}
      <Box sx={{
        px: 1.5, py: 1.1,
        borderRight: `1px solid ${PwC.border}`,
        bgcolor: badge.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 56, alignSelf: 'stretch',
      }}>
        <Typography sx={{ fontSize: 10, fontWeight: 800, color: badge.fg, letterSpacing: 0.5 }}>
          {badge.label}
        </Typography>
      </Box>

      {/* Main info */}
      <Box sx={{ px: 1.5, py: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" mb={0.2}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: PwC.midnight }}>
            {d.dataset_type}
          </Typography>
          {idRows.length > 0 && (
            <Chip icon={<VpnKey sx={{ fontSize: '9px !important' }} />} label={`${idRows.length} key`}
              size="small" sx={{ height: 16, fontSize: 8.5, bgcolor: PwC.tangerineLight, color: '#9A3412', borderRadius: '3px', fontWeight: 700 }} />
          )}
          {issueRows.length > 0 && (
            <Chip icon={<Warning sx={{ fontSize: '9px !important', color: `${PwC.amber} !important` }} />}
              label={`${issueRows.length} issues`} size="small"
              sx={{ height: 16, fontSize: 8.5, bgcolor: PwC.amberLight, color: PwC.amber, borderRadius: '3px', fontWeight: 700 }} />
          )}
        </Stack>
        <Typography sx={{ fontSize: 10.5, color: PwC.mist, fontVariantNumeric: 'tabular-nums' }}>
          {fmtNum(d.row_count)} rows · {d.columns?.length ?? 0} cols
          {d.filename ? ` · ${d.filename}` : ''}
        </Typography>
      </Box>

      {/* Quality ring */}
      {qualitySafe != null && (
        <Box sx={{ px: 1.5, borderLeft: `1px solid ${PwC.border}`, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          <QualityRing score={qualitySafe} size={34} />
        </Box>
      )}

      {/* Status dot */}
      <Box sx={{ px: 1, display: 'flex', alignItems: 'center' }}>
        <Circle sx={{ fontSize: 7, color: PwC.emerald }} />
      </Box>

      {/* Actions */}
      <Stack direction="row" spacing={0} alignItems="center"
        sx={{ px: 1, borderLeft: `1px solid ${PwC.border}`, alignSelf: 'stretch' }}>
        <Button
          size="small"
          onClick={onOpenViewer}
          startIcon={<OpenInFull sx={{ fontSize: 12 }} />}
          sx={{
            height: 28, px: 1.25, fontSize: 11, fontWeight: 600,
            textTransform: 'none', borderRadius: '4px',
            color: PwC.slate, bgcolor: 'transparent',
            '&:hover': { color: PwC.tangerine, bgcolor: PwC.tangerineLight },
          }}
        >
          {persona === 'business' ? 'View' : 'Inspect'}
        </Button>
        <Tooltip title="Remove dataset">
          <IconButton size="small" onClick={onDelete}
            sx={{ p: 0.5, color: PwC.smoke, '&:hover': { color: PwC.red } }}>
            <Delete sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
};

// ─── Dataset Viewer Dialog ─────────────────────────────────────────────────────
const DatasetViewerDialog = ({
  open, dataset, persona, schema, profile, allDatasets,
  loadingSchema, loadingProfile, duplicateCount, onClose, onDelete,
}) => {
  const d = dataset || null;
  const badge = typeBadge(d?.dataset_type);
  const detailsErr = schema?.error || profile?.error;
  const isLoading = Boolean(loadingSchema || loadingProfile);
  const schemaRows = useMemo(() => (d ? buildColumnRows(d, schema, profile) : []), [d, schema, profile]);
  const idRows = schemaRows.filter((row) => row.is_identifier);
  const issueRows = schemaRows.filter((row) => (ratio(row.null_pct) || 0) >= 0.2 || row.issue_flags.length > 0);
  const qualityScore = Number(profile?.quality_score ?? schema?.quality_score);
  const qualitySafe = Number.isFinite(qualityScore) ? qualityScore
    : schemaRows.length
      ? Math.max(0, Math.round(100 - (schemaRows.reduce((sum, row) => sum + ((ratio(row.null_pct) || 0) * 100), 0) / schemaRows.length)))
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: { xs: 'calc(100vw - 24px)', md: 'min(1480px, calc(100vw - 48px))' },
          height: { xs: 'calc(100vh - 24px)', md: 'calc(100vh - 48px)' },
          maxHeight: 'none',
          borderRadius: '8px',
          border: `1px solid ${PwC.border}`,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(15,23,42,0.18)',
        },
      }}
    >
      {/* Dialog chrome header */}
      <Box sx={{
        px: 3, py: 0,
        borderBottom: `1px solid ${PwC.border}`,
        bgcolor: PwC.midnight,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 52,
      }}>
        <Stack direction="row" spacing={2} alignItems="center">
          {/* Type badge */}
          <Box sx={{
            px: 1.25, py: 0.4,
            bgcolor: badge.bg, borderRadius: '4px',
          }}>
            <Typography sx={{ fontSize: 10, fontWeight: 800, color: badge.fg, letterSpacing: 0.6 }}>
              {badge.label}
            </Typography>
          </Box>

          <Typography sx={{ fontSize: 15, fontWeight: 700, color: PwC.white, letterSpacing: '-0.2px' }}>
            {d?.dataset_type || 'Dataset'}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            {d?.filename || 'Uploaded source table'}
          </Typography>

          {/* Stat chips */}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {[
              { label: `${fmtNum(d?.row_count)} rows` },
              { label: `${d?.columns?.length ?? 0} cols` },
              qualitySafe != null ? { label: `Quality ${Math.round(qualitySafe)}%`, color: qualityColor(qualitySafe) } : null,
              idRows.length > 0 ? { label: `${idRows.length} keys` } : null,
              issueRows.length > 0 ? { label: `${issueRows.length} issues`, warn: true } : null,
              persona === 'technical' && duplicateCount != null
                ? { label: `${fmtNum(duplicateCount)} dupes`, warn: duplicateCount > 0 } : null,
            ].filter(Boolean).map((chip, i) => (
              <Box key={i} sx={{
                px: 1, py: 0.25,
                bgcolor: chip.warn ? 'rgba(224,48,30,0.15)' : 'rgba(255,255,255,0.08)',
                borderRadius: '3px',
              }}>
                <Typography sx={{
                  fontSize: 10.5, fontWeight: 600,
                  color: chip.warn ? '#FCA5A5' : chip.color ? chip.color : 'rgba(255,255,255,0.7)',
                }}>
                  {chip.label}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center">
          <Button
            size="small" variant="outlined" color="error"
            startIcon={<Delete sx={{ fontSize: 13 }} />}
            onClick={onDelete}
            sx={{
              textTransform: 'none', borderRadius: '5px', fontSize: 11,
              borderColor: 'rgba(224,48,30,0.4)', color: '#FCA5A5',
              '&:hover': { borderColor: PwC.red, bgcolor: 'rgba(224,48,30,0.1)' },
            }}
          >
            Remove
          </Button>
          <IconButton onClick={onClose} sx={{ color: 'rgba(255,255,255,0.5)', p: 0.5, '&:hover': { color: PwC.white } }}>
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </Box>

      {/* Progress bar */}
      {isLoading && (
        <LinearProgress sx={{
          height: 2, bgcolor: 'transparent',
          '& .MuiLinearProgress-bar': { bgcolor: PwC.tangerine },
        }} />
      )}

      <DialogContent sx={{ p: { xs: 2, md: 3 }, bgcolor: PwC.surface, overflowY: 'auto' }}>
        {detailsErr && (
          <Alert severity="warning" sx={{ mb: 2, borderRadius: '5px' }}>{detailsErr}</Alert>
        )}

        {!d ? null : persona === 'business' ? (
          <Stack spacing={2.5}>
            <BusinessPanel dataset={d} profile={profile} allDatasets={allDatasets} variant="dialog" />
            <Box sx={{ p: 2.5, bgcolor: PwC.white, border: `1px solid ${PwC.border}`, borderRadius: '6px' }}>
              <SamplePreviewPanel schema={schema} variant="dialog" />
            </Box>
          </Stack>
        ) : (
          <Box sx={{ p: 2.5, bgcolor: PwC.white, border: `1px solid ${PwC.border}`, borderRadius: '6px' }}>
            <TechnicalPanel dataset={d} schema={schema} profile={profile} allDatasets={allDatasets} variant="dialog" />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};
// ─── DataUploadScreen.jsx  ·  Part 3 / 3
// Main component — enterprise 3-column layout

const DataUploadScreen = ({
  persona,
  datasets = [],
  onDatasetsRefresh,
  activePipelineId = null,
  activePipelineName = '',
  activePipelineType = 'fcc',
  onPipelineActivated,
  onCreatePipeline,
  onResumePipeline,
  onWorkspaceReset,
  onStepAdvance,
}) => {
  const [queue, setQueue]                       = useState([]);
  const [dragOver, setDragOver]                 = useState(false);
  const [viewerDatasetId, setViewerDatasetId]   = useState(null);
  const [schemaMap, setSchemaMap]               = useState({});
  const [loadingSchema, setLoadingSchema]       = useState(null);
  const [profileMap, setProfileMap]             = useState({});
  const [loadingProfile, setLoadingProfile]     = useState(null);
  const [resetting, setResetting]               = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [duplicateWarnings, setDuplicateWarnings] = useState({});
  const [uiError, setUiError]                   = useState('');
  const [uiInfo, setUiInfo]                     = useState('');
  const [savedRuns, setSavedRuns]               = useState([]);
  const [loadingRuns, setLoadingRuns]           = useState(false);
  const [creatingRun, setCreatingRun]           = useState(false);
  const [openingRun, setOpeningRun]             = useState(false);
  const [uploadingAll, setUploadingAll]         = useState(false);
  const [queueExpanded, setQueueExpanded]       = useState(true);
  const [selectedRunId, setSelectedRunId]       = useState('');
  const [pipelineName, setPipelineName]         = useState(activePipelineName || 'Experiment 1');
  const [pipelineType, setPipelineType]         = useState(activePipelineType || 'fcc');
  const fileInputRef = useRef();
  const screenStateSaveSignatureRef = useRef('');
  const screenStateSaveInFlightRef = useRef(false);
  const hasActivePipeline = Number(activePipelineId || 0) > 0;
  const hasUploadedData = datasets.length > 0;
  const isMulePipeline = pipelineType === 'mule';

  useEffect(() => {
    setPipelineType(String(activePipelineType || 'fcc').trim().toLowerCase() === 'mule' ? 'mule' : 'fcc');
  }, [activePipelineType]);

  // ── Data loaders (all logic preserved) ──────────────────────────────────────
  const loadSavedRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await mlopsApi.pipelineList();
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setSavedRuns(rows);
      return rows;
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Could not load saved runs.');
      setSavedRuns([]);
      return [];
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => { loadSavedRuns(); }, [loadSavedRuns]);

  useEffect(() => {
    if (activePipelineName) setPipelineName(String(activePipelineName));
    if (activePipelineId)   setSelectedRunId(String(activePipelineId));
    if (!activePipelineId && !activePipelineName) setSelectedRunId('');
  }, [activePipelineId, activePipelineName]);

  useEffect(() => {
    if (!hasActivePipeline) return undefined;
    const hasLiveQueue = queue.some((item) => item.status === 'pending' || item.status === 'uploading');
    if (hasLiveQueue) return undefined;
    const timeoutId = window.setTimeout(async () => {
      const snapshot = {
        activePipelineId: Number(activePipelineId || 0) || null,
        completed: hasUploadedData,
        status: hasUploadedData ? 'completed' : 'not_started',
        expected_dataset_types: queue.map((q) => ({
          type: q.type,
          custom_name: q.customName || '',
          file_name: q.file?.name || '',
        })),
        dataset_ids: datasets.map((d) => Number(d.dataset_id)).filter((id) => Number.isFinite(id) && id > 0),
        uploaded_dataset_types: datasets.map((d) => d.dataset_type),
        has_str_dataset: datasets.some((d) => ['str', 'sar'].includes(safe(d.dataset_type))),
        total_tables: datasets.length,
        total_rows: datasets.reduce((sum, d) => sum + (d.row_count || 0), 0),
      };
      const signature = JSON.stringify(snapshot);
      if (screenStateSaveInFlightRef.current || screenStateSaveSignatureRef.current === signature) {
        return;
      }
      screenStateSaveInFlightRef.current = true;
      try {
        const res = await mlopsApi.pipelineSaveScreenState(activePipelineId, {
          screen: 'data_upload',
          state: snapshot,
        });
        const payload = res?.data || res;
        screenStateSaveSignatureRef.current = signature;
        const nextPipelineId = Number(payload?.pipeline_id || 0) || null;
        if (nextPipelineId && nextPipelineId !== Number(activePipelineId || 0)) {
          onPipelineActivated?.(payload);
        }
      } catch (e) { console.error('Failed to persist data upload state', e); }
      finally {
        screenStateSaveInFlightRef.current = false;
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [activePipelineId, datasets, hasActivePipeline, hasUploadedData, onPipelineActivated, queue]);

  const requireActivePipeline = useCallback(() => {
    if (hasActivePipeline) return true;
    setUiError('Create or open a pipeline run first. Data upload stays disabled until a run is active.');
    return false;
  }, [hasActivePipeline]);

  const addToQueue = useCallback((files) => {
    if (!requireActivePipeline()) return;
    const items = Array.from(files).map((file) => ({
      id: `${Date.now()}_${Math.random()}`,
      file, type: autoDetectType(file.name), customName: '',
      status: 'pending', progress: 0, error: null, result: null,
    }));
    setQueue((prev) => [...prev, ...items]);
  }, [requireActivePipeline]);

  const updateItem = (id, patch) =>
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const removeFromQueue = (id) =>
    setQueue((prev) => prev.filter((item) => item.id !== id));

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    if (!requireActivePipeline()) return;
    addToQueue(e.dataTransfer.files);
  }, [addToQueue, requireActivePipeline]);

  const validateItem = (item) => {
    if (item.restoredPlaceholder) return 'Reattach the source file before upload';
    const e2 = ext(item.file);
    if (!['csv', 'parquet'].includes(e2)) return `".${e2}" not supported. Use CSV or Parquet only`;
    if (item.file.size / 1048576 > MAX_MB) return `File exceeds ${MAX_MB} MB limit`;
    const resolvedType = item.type === 'custom' ? item.customName : item.type;
    if (!resolvedType) return 'Select a dataset type';
    if (item.type === 'custom' && !/^[a-z0-9_-]+$/.test(resolvedType))
      return 'Custom name: lowercase letters, digits, underscores only';
    return null;
  };

  const uploadItem = async (item) => {
    if (!requireActivePipeline()) return;
    const err = validateItem(item);
    if (err) { updateItem(item.id, { status: 'error', error: err }); return; }
    const resolvedType = item.type === 'custom' ? item.customName : item.type;
    updateItem(item.id, { status: 'uploading', progress: 10, error: null });
    try {
      let prog = 10;
      const tick = setInterval(() => { prog = Math.min(prog + 15, 85); updateItem(item.id, { progress: prog }); }, 400);
      const res = await mlopsApi.uploadDataset(resolvedType, item.file, {
        pipeline_id: activePipelineId,
        pipeline_type: activePipelineType || pipelineType,
      });
      clearInterval(tick);
      updateItem(item.id, { status: 'done', progress: 100, result: res.data || res });
      onDatasetsRefresh?.();
    } catch (e) {
      updateItem(item.id, { status: 'error', error: e?.response?.data?.error || e?.message || 'Upload failed', progress: 0 });
    }
  };

  const uploadAll = useCallback(async () => {
    if (!requireActivePipeline() || uploadingAll) return;
    const pendingItems = queue.filter((item) => item.status === 'pending');
    if (!pendingItems.length) return;
    setUploadingAll(true);
    try {
      for (const item of pendingItems) {
        // Upload one file at a time so the backend can complete each dataset registration deterministically.
        // Parallel uploads were leaving the screen stuck in a half-uploaded state.
        await uploadItem(item);
      }
    } finally {
      setUploadingAll(false);
    }
  }, [queue, requireActivePipeline, uploadItem, uploadingAll]);

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
            : Array.isArray(previewPayload.columns) ? previewPayload.columns
            : previewKeys.length ? Array.from(new Set(previewKeys))
            : payload.columns;
        } catch { payload.preview_rows = payload.preview_rows || []; }
      }
      setSchemaMap((prev) => ({ ...prev, [dataset.dataset_id]: payload }));
    } catch {
      setSchemaMap((prev) => ({ ...prev, [dataset.dataset_id]: { error: 'Could not load schema' } }));
    } finally { setLoadingSchema(null); }
  };

  const loadProfile = async (dataset) => {
    if (profileMap[dataset.dataset_id]) return;
    setLoadingProfile(dataset.dataset_id);
    try {
      const res = await mlopsApi.profileMetadata({ dataset_id: dataset.dataset_id });
      setProfileMap((prev) => ({ ...prev, [dataset.dataset_id]: res.data || res }));
    } catch {
      setProfileMap((prev) => ({ ...prev, [dataset.dataset_id]: { error: 'Could not load profile' } }));
    } finally { setLoadingProfile(null); }
  };

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

  const openDatasetViewer = (dataset) => {
    setViewerDatasetId(dataset.dataset_id);
    loadSchema(dataset);
    loadProfile(dataset);
    if (persona === 'technical') loadDuplicates(dataset);
  };

  const deleteDataset = async (dataset) => {
    setUiError('');
    try {
      await mlopsApi.deleteDataset(dataset.dataset_id);
      onDatasetsRefresh?.();
      if (viewerDatasetId === dataset.dataset_id) setViewerDatasetId(null);
      setSchemaMap((prev)  => { const n = { ...prev }; delete n[dataset.dataset_id]; return n; });
      setProfileMap((prev) => { const n = { ...prev }; delete n[dataset.dataset_id]; return n; });
      setUiInfo(`Removed dataset "${dataset.dataset_type || dataset.dataset_id}".`);
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Delete failed');
    }
  };

  const resetWorkspace = async () => {
    setResetting(true); setUiError('');
    try {
      if (typeof onWorkspaceReset === 'function') {
        await onWorkspaceReset();
      } else {
        await mlopsApi.resetDatasets({ delete_files: true });
        onDatasetsRefresh?.({ sync: false });
      }
      setViewerDatasetId(null); setSchemaMap({}); setProfileMap({});
      setQueue([]); setSelectedRunId(''); setPipelineName('Experiment 1');
      setResetConfirmOpen(false);
      setUiInfo('Workspace cleared. Upload new source files to begin.');
      await loadSavedRuns();
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Reset failed');
    } finally { setResetting(false); }
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const totalRows      = datasets.reduce((s, d) => s + (d.row_count || 0), 0);
  const totalCols      = datasets.reduce((s, d) => s + (d.columns?.length || 0), 0);
  const pendingCount   = queue.filter((i) => i.status === 'pending').length;
  const strDataset     = datasets.find((d) => ['str', 'sar'].includes(safe(d.dataset_type)));
  const alertDataset   = datasets.find((d) => safe(d.dataset_type) === 'alerts');
  const muleOutcomeDataset = datasets.find((d) => ['mule_labels', 'mule_typology'].includes(safe(d.dataset_type)));
  const muleEnrichmentLoaded = datasets.some((d) => ['counterparties', 'device_logs', 'external_signals', 'graph_nodes', 'graph_edges', 'account_daily_summary'].includes(safe(d.dataset_type)));

  const avgQuality = useMemo(() => {
    const scores = Object.values(profileMap).map((p) => Number(p?.quality_score)).filter((n) => Number.isFinite(n));
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [profileMap]);

  const viewerDataset = useMemo(
    () => datasets.find((d) => Number(d.dataset_id) === Number(viewerDatasetId)) || null,
    [datasets, viewerDatasetId],
  );

  const uploadSummaryItems = useMemo(() => ([
    `Uploaded tables: ${datasets.length}`,
    `Queued files: ${queue.length}`,
    isMulePipeline
      ? `Mule outcome data: ${muleOutcomeDataset ? 'yes' : 'no'}`
      : `STR linked: ${strDataset ? 'yes' : 'no'}`,
    `Total rows: ${fmtNum(totalRows)}`,
  ]), [datasets.length, isMulePipeline, muleOutcomeDataset, queue.length, strDataset, totalRows]);
  const sourceStatusLabel = isMulePipeline
    ? ((muleEnrichmentLoaded || muleOutcomeDataset)
      ? `Mule sources ready${muleOutcomeDataset ? ' · outcome tables loaded' : ''}`
      : 'Optional Mule enrichment not loaded')
    : (strDataset ? `STR linked - ${fmtNum(strDataset.row_count)} records` : 'No STR/SAR dataset');

  const uploadedQueueCount  = useMemo(() => queue.filter((i) => i.status === 'done').length, [queue]);
  const completedQueueOnly  = queue.length > 0 && pendingCount === 0 && queue.every((i) => i.status === 'done');
  const showCompactUpload   = datasets.length > 0 || uploadedQueueCount > 0;

  useEffect(() => {
    if (!queue.length) { setQueueExpanded(false); return; }
    setQueueExpanded(!completedQueueOnly);
  }, [completedQueueOnly, queue.length]);

  // ── Pipeline restore ─────────────────────────────────────────────────────────
  const handleLoadUploadPipeline = useCallback((state, pipeline) => {
    const expected = Array.isArray(state?.expected_dataset_types) ? state.expected_dataset_types : [];
    if (!expected.length) return;
    const restored = expected.map((entry, idx) => ({
      id: `restored_${Date.now()}_${idx}`,
      file: { name: entry.file_name || `${entry.type || 'dataset'}.csv`, size: 0 },
      type: entry.type || 'transactions', customName: entry.custom_name || '',
      status: 'pending', progress: 0, error: 'Reattach file and upload again.', result: null,
      restoredPlaceholder: true,
    }));
    setQueue(restored);
    if (pipeline?.name) setViewerDatasetId(null);
  }, []);

  useEffect(() => {
    if (!hasActivePipeline) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await mlopsApi.pipelineGet(activePipelineId);
        const full = res?.data || res || {};
        const restoredState = getScreenState(full?.steps, 'data_upload');
        if (!cancelled && restoredState) handleLoadUploadPipeline(restoredState, full);
      } catch (e) { console.error('Failed to restore data upload state', e); }
    })();
    return () => { cancelled = true; };
  }, [activePipelineId, handleLoadUploadPipeline, hasActivePipeline]);

  // ── Run handlers ─────────────────────────────────────────────────────────────
  const handleCreateRun = useCallback(async () => {
    const trimmed = String(pipelineName || '').trim();
    if (!trimmed) { setUiError('Enter a run name first.'); return; }
    setCreatingRun(true); setUiError('');
    try {
      const created = typeof onCreatePipeline === 'function'
        ? await onCreatePipeline(trimmed, { pipeline_type: pipelineType })
        : ((await mlopsApi.pipelineSave({
            name: trimmed, dataset_id: 0, dataset_ids: [],
            pipeline_type: pipelineType,
            created_by_persona: persona || 'technical',
            steps: [{ type: 'screen_state', screen: 'pipeline_hub', state: {
              stage_order: pipelineType === 'mule'
                ? ['data', 'master', 'preprocess', 'model', 'validation']
                : ['data', 'master', 'target', 'eda', 'preprocess', 'model', 'validation', 'registry'],
              created_from: 'data_upload',
            }}],
          }))?.data || null);
      if (created?.pipeline_id) {
        setSelectedRunId(String(created.pipeline_id));
        onPipelineActivated?.({
          ...created,
          pipeline_id: created.pipeline_id,
          name: created.name || trimmed,
          pipeline_type: created.pipeline_type || pipelineType,
          model_family: created.model_family || pipelineType,
        });
      }
      setUiInfo(`Run "${trimmed}" created. Upload source tables below.`);
      await loadSavedRuns();
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Could not create pipeline run.');
    } finally { setCreatingRun(false); }
  }, [loadSavedRuns, onCreatePipeline, onPipelineActivated, persona, pipelineName, pipelineType]);

  const handleOpenRun = useCallback(async () => {
    const selected = savedRuns.find((r) => String(r?.pipeline_id || '') === String(selectedRunId || '')) || null;
    if (!selected) { setUiError('Choose a saved run before opening.'); return; }
    setOpeningRun(true); setUiError('');
    try {
      if (typeof onResumePipeline === 'function') {
        await onResumePipeline(selected);
      } else {
        const res = await mlopsApi.pipelineGet(selected.pipeline_id);
        const full = res?.data || res || selected;
        onPipelineActivated?.(full);
      }
      setUiInfo(`Opened run "${selected.name || selected.pipeline_id}".`);
    } catch (e) {
      setUiError(e?.response?.data?.error || e?.message || 'Could not open selected run.');
    } finally { setOpeningRun(false); }
  }, [onPipelineActivated, onResumePipeline, savedRuns, selectedRunId]);

  // ── Readiness checks ─────────────────────────────────────────────────────────
  const readinessChecks = isMulePipeline
    ? [
        { label: 'Accounts', ok: datasets.some((d) => ['accounts', 'account'].includes(safe(d.dataset_type))) },
        { label: 'Customers', ok: datasets.some((d) => ['customers', 'customer'].includes(safe(d.dataset_type))) },
        { label: 'Transactions', ok: datasets.some((d) => ['transactions', 'txn', 'transaction'].includes(safe(d.dataset_type))) },
        { label: 'Enrichment / network', ok: muleEnrichmentLoaded || Boolean(muleOutcomeDataset) },
      ]
    : [
        { label: 'Transaction data', ok: datasets.some((d) => ['transactions','txn'].includes(safe(d.dataset_type))) },
        { label: 'Customer / Account', ok: datasets.some((d) => ['accounts','customers'].includes(safe(d.dataset_type))) },
        { label: 'Alert / Case data', ok: datasets.some((d) => ['alerts','cases'].includes(safe(d.dataset_type))) },
        { label: 'STR labels', ok: Boolean(strDataset) },
      ];
  const readinessScore = readinessChecks.filter((c) => c.ok).length;
  const canAdvanceToMaster = hasActivePipeline && hasUploadedData;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      
      {/* ── Main 3-column body ─────────────────────────────────────────────── */}
      <Box sx={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: '280px 340px 1fr' },
        gap: 0,
        overflow: 'hidden',
      }}>

        {/* ── COL 1: Pipeline Run panel ──────────────────────────────────── */}
        <Box sx={{
          borderRight: `1px solid ${PwC.border}`,
          overflowY: 'auto',
          p: 2,
          bgcolor: PwC.surface,
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>
          <PipelineRunPanel
            activePipelineId={activePipelineId}
            activePipelineName={activePipelineName}
            pipelineName={pipelineName}
            pipelineType={pipelineType}
            savedRuns={savedRuns}
            selectedRunId={selectedRunId}
            loadingRuns={loadingRuns}
            creatingRun={creatingRun}
            openingRun={openingRun}
            onPipelineNameChange={setPipelineName}
            onPipelineTypeChange={setPipelineType}
            onCreateRun={handleCreateRun}
            onSelectedRunChange={setSelectedRunId}
            onOpenRun={handleOpenRun}
            onRefresh={loadSavedRuns}
            summaryItems={uploadSummaryItems}
          />
        </Box>

        {/* ── COL 2: Upload zone + queue ─────────────────────────────────── */}
        <Box sx={{
          borderRight: `1px solid ${PwC.border}`,
          overflowY: 'auto',
          p: 2,
          bgcolor: PwC.white,
          display: 'flex', flexDirection: 'column', gap: 1.75,
        }}>
          {/* Section label */}
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: PwC.midnight, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {isMulePipeline
                ? 'Upload Mule source tables'
                : (persona === 'business' ? 'Load source tables' : 'Upload data tables')}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: PwC.mist, mt: 0.3, lineHeight: 1.55 }}>
              {hasActivePipeline
                ? (isMulePipeline
                  ? 'Drop CSV or Parquet files for the Mule run. Accounts, customers, transactions, graph, device, external signals, and outcome tables are supported.'
                  : 'Drop CSV or Parquet files. Auto-type detection enabled.')
                : 'Create or open a pipeline run first to unlock upload.'}
            </Typography>
          </Box>

          {/* Alerts */}
          {uiError && (
            <Alert severity="error" onClose={() => setUiError('')}
              sx={{ borderRadius: '5px', py: 0.4, '& .MuiAlert-message': { fontSize: 12 } }}>
              {uiError}
            </Alert>
          )}
          {uiInfo && (
            <Alert severity="success" onClose={() => setUiInfo('')}
              sx={{ borderRadius: '5px', py: 0.4, '& .MuiAlert-message': { fontSize: 12 } }}>
              {uiInfo}
            </Alert>
          )}
          {isMulePipeline && (
            <Alert severity="info"
              sx={{ borderRadius: '5px', py: 0.4, '& .MuiAlert-message': { fontSize: 12 } }}>
              This run is building a Mule Account Detection model. After upload, the next step is to build the account-level analytical dataset.
            </Alert>
          )}
          {!hasActivePipeline && (
            <Alert severity="warning"
              sx={{ borderRadius: '5px', py: 0.4, '& .MuiAlert-message': { fontSize: 12 } }}>
              Upload locked. Create or open a run in the left panel.
            </Alert>
          )}

          <input ref={fileInputRef} type="file" multiple hidden accept=".csv,.parquet"
            onChange={(e) => { addToQueue(e.target.files); e.target.value = ''; }} />

          {/* Drop zone */}
          <Box
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); if (hasActivePipeline) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => { if (!requireActivePipeline()) return; fileInputRef.current?.click(); }}
            sx={{
              border: `2px dashed ${dragOver && hasActivePipeline ? PwC.tangerine : PwC.border}`,
              borderRadius: '6px',
              bgcolor: dragOver && hasActivePipeline ? PwC.tangerineLight
                : hasActivePipeline ? PwC.white : PwC.surface,
              py: showCompactUpload ? 2 : 3.5,
              px: 2,
              cursor: hasActivePipeline ? 'pointer' : 'not-allowed',
              transition: 'border-color 0.15s, background-color 0.15s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              opacity: hasActivePipeline ? 1 : 0.65,
              '&:hover': hasActivePipeline ? { borderColor: PwC.tangerine, bgcolor: PwC.tangerineLight } : {},
            }}
          >
            <Box sx={{
              width: showCompactUpload ? 36 : 44, height: showCompactUpload ? 36 : 44,
              borderRadius: '50%',
              bgcolor: dragOver && hasActivePipeline ? PwC.tangerine : PwC.surface,
              border: `1px solid ${dragOver && hasActivePipeline ? PwC.tangerine : PwC.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              <CloudUpload sx={{
                fontSize: showCompactUpload ? 18 : 22,
                color: dragOver && hasActivePipeline ? PwC.white : PwC.tangerine,
              }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: PwC.midnight }}>
                {!hasActivePipeline ? 'Unlock by creating a run'
                  : dragOver ? 'Release to add files'
                  : showCompactUpload ? 'Drop more files or click to browse'
                  : 'Drop files here or click to browse'}
              </Typography>
              {!showCompactUpload && (
                <Typography sx={{ fontSize: 11, color: PwC.mist, mt: 0.3 }}>
                  CSV · Parquet · Max 500 MB per file · Auto-type detection
                </Typography>
              )}
            </Box>
            {showCompactUpload && (
              <Typography sx={{ fontSize: 10, color: PwC.mist }}>
                CSV · Parquet · Max 500 MB
              </Typography>
            )}
          </Box>

          {/* Upload queue */}
          {queue.length > 0 && (
            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.85}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {completedQueueOnly ? 'Uploaded' : 'Queue'} ({queue.length})
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {completedQueueOnly && (
                    <Button size="small" variant="text"
                      onClick={() => setQueueExpanded((p) => !p)}
                      sx={{ textTransform: 'none', fontSize: 11, color: PwC.mist, fontWeight: 600, px: 0.75 }}>
                      {queueExpanded ? 'Hide' : 'Show'}
                    </Button>
                  )}
                  {pendingCount > 1 && (
                    <Button size="small" variant="contained" onClick={uploadAll} disabled={!hasActivePipeline || uploadingAll}
                      sx={{
                        bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight },
                        fontSize: 11, py: 0.35, height: 26,
                        textTransform: 'none', borderRadius: '4px', boxShadow: 'none',
                      }}>
                      {uploadingAll ? `Uploading... (${pendingCount})` : `Upload all (${pendingCount})`}
                    </Button>
                  )}
                </Stack>
              </Stack>
              {(!completedQueueOnly || queueExpanded) && (
                <Stack spacing={0.75}>
                  {queue.map((item) => (
                    <QueueItem key={item.id} item={item} persona={persona}
                      uploadDisabled={!hasActivePipeline}
                      onTypeChange={(v) => updateItem(item.id, { type: v })}
                      onCustomNameChange={(v) => updateItem(item.id, { customName: v })}
                      onUpload={() => uploadItem(item)}
                      onRemove={() => removeFromQueue(item.id)} />
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </Box>

        {/* ── COL 3: Dataset catalog ─────────────────────────────────────── */}
        <Box sx={{
          overflowY: 'auto',
          bgcolor: PwC.surface,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Catalog header bar */}
          <Box sx={{
            px: 2.5, py: 1.25,
            bgcolor: PwC.white,
            borderBottom: `1px solid ${PwC.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 2,
          }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
                {persona === 'business' ? 'Data Catalog' : 'Registered Tables'}
              </Typography>
              <Box sx={{
                px: 0.9, py: 0.15,
                bgcolor: datasets.length > 0 ? PwC.tangerineLight : PwC.smoke,
                borderRadius: '10px',
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 800, color: datasets.length > 0 ? PwC.tangerine : PwC.mist }}>
                  {datasets.length}
                </Typography>
              </Box>
              {/* ── ADD THESE KPIs here instead ── */}
              {datasets.length > 0 && (
                <Stack direction="row" spacing={2} alignItems="center" sx={{ ml: 1 }}>
                  {[
                    { label: 'Rows', value: fmtNum(totalRows) },
                    { label: 'Cols', value: fmtNum(totalCols) },
                    { label: 'Quality', value: avgQuality == null ? 'N/A' : `${avgQuality.toFixed(0)}%`,
                      color: avgQuality == null ? PwC.mist : qualityColor(avgQuality) },
                  ].map((k) => (
                    <Box key={k.label}>
                      <Typography sx={{ fontSize: 8.5, fontWeight: 700, color: PwC.mist, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        {k.label}
                      </Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: k.color || PwC.midnight, lineHeight: 1, letterSpacing: '-0.3px' }}>
                        {k.value}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Stack>

            {/* STR status + action buttons */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.1, py: 0.45,
                bgcolor: isMulePipeline
                  ? ((muleEnrichmentLoaded || muleOutcomeDataset) ? PwC.emeraldLight : PwC.amberLight)
                  : (strDataset ? PwC.emeraldLight : PwC.amberLight),
                borderRadius: '4px',
                border: `1px solid ${isMulePipeline
                  ? ((muleEnrichmentLoaded || muleOutcomeDataset) ? '#A7F3D0' : '#FDE68A')
                  : (strDataset ? '#A7F3D0' : '#FDE68A')}`,
              }}>
                {(isMulePipeline ? (muleEnrichmentLoaded || muleOutcomeDataset) : strDataset)
                  ? <CheckCircle sx={{ fontSize: 11, color: PwC.emerald }} />
                  : <Warning sx={{ fontSize: 11, color: PwC.amber }} />
                }
                <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: (isMulePipeline ? (muleEnrichmentLoaded || muleOutcomeDataset) : strDataset) ? '#065F46' : '#78350F' }}>
                  {sourceStatusLabel}
                </Typography>
              </Box>

              {/* ── Refresh + Start Fresh moved here ── */}
              <Tooltip title="Refresh">
                <IconButton size="small" onClick={onDatasetsRefresh} sx={{ p: 0.5, color: PwC.mist }}>
                  <Refresh sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Button size="small" variant="text"
                onClick={() => setResetConfirmOpen(true)}
                disabled={canDisable(resetting)}
                sx={{ textTransform: 'none', fontSize: 11, color: PwC.red, fontWeight: 600, px: 0.75, minWidth: 0 }}>
                {resetting ? 'Resetting…' : 'Start Fresh'}
              </Button>
            </Stack>
          </Box>

          {/* Table header row */}
          {datasets.length > 0 && (
            <Box sx={{
              px: 2.5, py: 0.6,
              display: 'grid',
              gridTemplateColumns: '56px 1fr 60px 20px 110px',
              bgcolor: PwC.surface,
              borderBottom: `1px solid ${PwC.border}`,
            }}>
              {['Type', 'Dataset', 'Quality', '', 'Actions'].map((h) => (
                <Typography key={h} sx={{ fontSize: 9, fontWeight: 700, color: PwC.mist, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {h}
                </Typography>
              ))}
            </Box>
          )}

          {/* Dataset rows */}
          <Box sx={{ flex: 1, px: 2, py: datasets.length > 0 ? 1.25 : 0 }}>
            {datasets.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <CloudUpload sx={{ fontSize: 28, color: PwC.smoke, mb: 1 }} />
                <Typography sx={{ fontSize: 12.5, color: PwC.mist, fontWeight: 500 }}>
                  {persona === 'business'
                    ? 'No tables loaded yet. Upload files to get started.'
                    : 'No datasets registered. Upload files to begin.'}
                </Typography>
              </Box>
            ) : (
              <Stack spacing={0.6}>
                {datasets.map((d) => (
                  <RegisteredDatasetCard
                    key={d.dataset_id}
                    dataset={d}
                    persona={persona}
                    schema={schemaMap[d.dataset_id] || null}
                    profile={profileMap[d.dataset_id] || null}
                    onOpenViewer={() => openDatasetViewer(d)}
                    onDelete={() => deleteDataset(d)}
                  />
                ))}
              </Stack>
            )}
          </Box>

          {/* Pipeline readiness footer */}
          {datasets.length >= 2 && (
            <Box sx={{
              mt: 'auto',
              px: 2.5, py: 1.75,
              borderTop: `1px solid ${PwC.border}`,
              bgcolor: PwC.white,
            }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
                  Pipeline Readiness
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: readinessScore === 4 ? PwC.emerald : PwC.amber }}>
                    {readinessScore}/4
                  </Typography>
                  <Box sx={{ width: 52, height: 4, bgcolor: PwC.smoke, borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{
                      width: `${(readinessScore / 4) * 100}%`, height: '100%',
                      bgcolor: readinessScore === 4 ? PwC.emerald : PwC.amber,
                      borderRadius: 2, transition: 'width 0.5s ease',
                    }} />
                  </Box>
                </Box>
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {readinessChecks.map(({ label, ok }) => (
                  <Stack key={label} direction="row" spacing={0.6} alignItems="center">
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ok ? PwC.emerald : PwC.smoke, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 10.5, color: ok ? PwC.slate : PwC.mist, fontWeight: ok ? 600 : 400 }}>
                      {label}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: 11, color: canAdvanceToMaster ? PwC.slate : PwC.mist }}>
                  {canAdvanceToMaster
                    ? (isMulePipeline
                      ? 'Data upload is complete. Continue to Analytical Dataset to build the account-level Mule modeling table.'
                      : 'Data upload is complete. Continue to Master Dataset to join and shape the source tables.')
                    : 'Upload at least one source dataset to unlock the next step.'}
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<PlayArrow sx={{ fontSize: 16 }} />}
                  disabled={!canAdvanceToMaster}
                  onClick={() => onStepAdvance?.('master')}
                  sx={{
                    alignSelf: { xs: 'stretch', sm: 'center' },
                    textTransform: 'none',
                    bgcolor: PwC.tangerine,
                    '&:hover': { bgcolor: PwC.midnight },
                    borderRadius: '5px',
                    boxShadow: 'none',
                    fontWeight: 700,
                  }}
                >
                  {isMulePipeline ? 'Continue to Analytical Dataset' : 'Continue to Master Dataset'}
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      <DatasetViewerDialog
        open={Boolean(viewerDataset)}
        dataset={viewerDataset}
        persona={persona}
        schema={viewerDataset ? schemaMap[viewerDataset.dataset_id] || null : null}
        profile={viewerDataset ? profileMap[viewerDataset.dataset_id] || null : null}
        allDatasets={datasets}
        loadingSchema={viewerDataset ? loadingSchema === viewerDataset.dataset_id : false}
        loadingProfile={viewerDataset ? loadingProfile === viewerDataset.dataset_id : false}
        duplicateCount={viewerDataset ? duplicateWarnings[viewerDataset.dataset_id] : null}
        onClose={() => setViewerDatasetId(null)}
        onDelete={() => viewerDataset && deleteDataset(viewerDataset)}
      />

      <Dialog open={resetConfirmOpen} onClose={() => !resetting && setResetConfirmOpen(false)}
        maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '8px', border: `1px solid ${PwC.border}` } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Warning sx={{ color: PwC.tangerine, fontSize: 18 }} />
            <Typography sx={{ fontSize: 15, fontWeight: 800, color: PwC.midnight }}>
              Start Fresh?
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Typography sx={{ fontSize: 13, color: PwC.slate, mb: 1.25 }}>
            This removes all uploaded tables, generated datasets, and saved pipeline progress for this environment.
          </Typography>
          <Alert severity="warning" sx={{ borderRadius: '5px', '& .MuiAlert-message': { fontSize: 11.5 }, mb: 1 }}>
            This cannot be undone. You will need to re-upload source files.
          </Alert>
          <Typography sx={{ fontSize: 11.5, color: PwC.mist }}>
            Use this only when you want a completely clean FCC workbench.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setResetConfirmOpen(false)} disabled={resetting}
            variant="text" sx={{ textTransform: 'none', color: PwC.ash, fontWeight: 600 }}>
            Cancel
          </Button>
          <Button onClick={resetWorkspace} disabled={resetting} variant="contained"
            sx={{ textTransform: 'none', bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight }, borderRadius: '5px', boxShadow: 'none', fontWeight: 700 }}>
            {resetting ? 'Resetting…' : 'Reset Workspace'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DataUploadScreen;

