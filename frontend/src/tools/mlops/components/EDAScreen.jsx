/**
 * EDAScreen.jsx - Enhanced AML MLOps EDA Workbench
 * Place: frontend/src/tools/mlops/components/EDAScreen.jsx
 *
 * Sections:
 *  1. Dashboard       - 6-panel AML overview (matches notebook output)
 *  2. Alert Imbalance & Label Health
 *  3. Risk Score Behaviour (KS, separation, drift)
 *  4. Rule Intelligence (most important for AML)
 *  5. Entity Risk Segmentation (customer, account, geo, occupation)
 *  6. Behavioural Patterns (velocity, amounts, burst)
 *  7. Compliance Enrichment (PEP, sanctions, KYC gaps)
 *  8. Column Explorer - per-column profiling
 *  9. Data Quality
 * 10. Correlations
 * 11. Feature vs Target
 * 12. Advanced EDA (suppression estimator, leakage, drift, predictive power)
 * 13. Insights
 * 14. Interactive Explorer
 *
 * Modes:
 *   Analyst Mode - notebook-like grid, technical detail
 *   Business Mode - plain-English insight panels only
 *
 * Design: PwC palette - primary #D04A02, light canvas, no emoji (MUI icons only)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider,
  Dialog, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
  Paper, Select, Slider, Stack, Switch, Tab, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Analytics, BarChart as BarChartIcon, BubbleChart, CheckCircle,
  Close, Download, ErrorOutline, ExpandMore, Flag, Insights,
  Refresh, ScatterPlot, Search, Settings, TableChart,
  TravelExplore, Warning, ZoomIn, PieChart as PieChartIcon,
  Timeline, AccountTree, Security, Person, Business,
  AutoGraph, FilterList, Lightbulb, Speed, GppBad,
  TrendingUp, TrendingDown, Balance, Rule, Hub,
  ManageSearch, QueryStats, DataObject, VisibilityOff,
  Psychology, Assessment, NotificationsActive, CompareArrows,
  AccessTime, WarningAmber, Public, Article,
} from '@mui/icons-material';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis,
  PieChart, Pie, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  Treemap, Brush,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

// --- API shim - reuse existing mlopsApi endpoints -----------------------------
const segmentTargetApi = async (payload) => {
  try {
    if (typeof mlopsApi.segmentTarget === 'function') return await mlopsApi.segmentTarget(payload);
    return { data: { segments: {}, class_counts: {}, rows_analyzed: 0 } };
  } catch { return { data: { segments: {}, class_counts: {}, rows_analyzed: 0 } }; }
};

// --- Design Tokens (PwC palette, light canvas) -------------------------------
const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const D = {
  // PwC brand
  orange:       '#D04A02',
  orangeHover:  '#B03D00',
  orangeLight:  '#FEF2EE',
  orangeMid:    '#F97316',
  // Canvas
  chrome:       '#0f1117',
  canvas:       '#f5f6f8',
  border:       '#e2e8f0',
  borderLight:  '#f1f5f9',
  cardBg:       '#ffffff',
  // Text
  textPri:      '#0f172a',
  textSec:      '#64748b',
  textMute:     '#94a3b8',
  // Status - only green/red for data signals
  ok:           '#16a34a',
  okLight:      '#f0fdf4',
  okBorder:     '#bbf7d0',
  warn:         '#d97706',
  warnLight:    '#fffbeb',
  danger:       '#dc2626',
  dangerLight:  '#fff1f2',
  info:         '#2563eb',
  infoLight:    '#eff6ff',
  // Chart palette (PwC-aligned, no green/red overuse)
  chart: ['#D04A02','#2563EB','#7C3AED','#0891B2','#B45309','#0F766E','#9333EA','#C026D3','#475569','#854D0E'],
  chartFP:      '#2563EB',  // False Positive = blue
  chartTP:      '#D04A02',  // True Positive = orange
};

// --- AML column name patterns -------------------------------------------------
const AML_COL = {
  target:       ['final_label','is_true_pos','is_true_positive','label','target','is_tp','str_flag'],
  riskScore:    ['risk_score','risk score','score','alert_score','risk_level_score'],
  rule:         ['rule_risk_profile','rule_risk_band','rule_triggered','rule_id','alert_rule','rule','rule_name'],
  riskRating:   ['customer_risk_rating','risk_rating','cust_risk_rating','crr'],
  accountType:  ['account_type','acct_type','account_category'],
  accountStatus:['account_status','acct_status','status'],
  pepFlag:      ['pep_flag','is_pep','pep'],
  sanctionHit:  ['sanction_hit','sanction_flag','is_sanctioned','sanctions'],
  adverseMedia: ['adverse_media_flag','adverse_media','is_adverse_media','adverse_news'],
  alertDate:    ['alert_date','alert_timestamp','txn_date','txn_timestamp','date','created_at'],
  nationality:  ['nationality','country','customer_country','origin_country'],
  occupation:   ['occupation','job_type','employment','profession'],
  txnAmount:    ['txn_amount','amount','transaction_amount','total_txn_volume','avg_txn_amount'],
  txnCount:     ['txn_count','transaction_count','num_transactions'],
  kyc:          ['kyc_completeness_pct','kyc_score','kyc_completeness','days_since_kyc'],
  cashIntensity:['cash_intensity','cash_txn_count','cash_pct'],
  velocity:     ['velocity_ratio','txn_velocity','unique_channels'],
  income:       ['income_bracket','income_level','income_band'],
  volSpike:     ['vol_spike_30_vs_90','vol_spike_7_vs_30'],
  passThrough:  ['pass_through_ratio_30d','pass_through_ratio'],
  counterparty: ['counterparty_hhi','top_dest_concentration'],
  peerZScore:   ['zscore_vol_vs_peer','peer_deviation','zscore_avg_vs_peer'],
  layering:     ['layering_score','swift_cnt_30d'],
  offHours:     ['pct_offhour_txns_30d','pct_offhour_txns'],
  actualExpected:['actual_vs_expected_vol','turnover_vs_expected','actual_expected_ratio'],
  structuring:  ['structuring_txn_cnt','pct_just_below_10k'],
  highRiskDest: ['pct_hr_dest_30d','pct_high_risk_dest'],
};

const BEHAVIOURAL_HINTS = {
  txnAmount:    ['txn_amount', 'transaction_amount', 'amount', 'avg_txn_amount', 'total_txn_volume', 'value'],
  txnCount:     ['txn_count', 'transaction_count', 'num_transactions', 'count_txn', 'volume_count'],
  cashIntensity:['cash_intensity', 'cash_txn', 'cash_ratio', 'cash_pct', 'cash_share'],
  velocity:     ['velocity', 'windowed_velocity', 'rapid', 'burst', 'movement_rate', 'txn_velocity'],
  volSpike:     ['spike', 'vol_spike', 'volume_spike', 'surge_ratio', 'growth_ratio', '30_vs_90'],
  passThrough:  ['pass_through', 'passthrough', 'flow_through', 'in_out_ratio', 'pass_ratio'],
  counterparty: ['counterparty', 'beneficiary_hhi', 'hhi', 'concentration', 'top_dest', 'dest_concentration'],
  peerZScore:   ['peer_z', 'zscore', 'z_score', 'peer_deviation', 'peer_outlier'],
  layering:     ['layering', 'layer_score', 'swift_cnt', 'hop_count', 'round_trip'],
  offHours:     ['offhour', 'off_hour', 'after_hour', 'night_activity', 'weekend'],
  actualExpected: ['actual_vs_expected', 'expected_ratio', 'turnover_vs_expected', 'actual_expected'],
  structuring:  ['structuring', 'below_10k', 'smurf', 'just_below'],
  highRiskDest: ['high_risk_dest', 'high_risk_country', 'hr_dest', 'sanction_country'],
};

const featureScaleForName = (name = '') => {
  const n = normToken(name);
  if (!n) return 'ratio';
  if (/(?:^|_)(count|cnt|num|volume_count)(?:_|$)/.test(n)) return 'int';
  if (/(?:^|_)(pct|percent|ratio|share)(?:_|$)/.test(n)) return 'pct';
  if (/(?:^|_)(amount|amt|value|balance|turnover|volume)(?:_|$)/.test(n)) return 'amount';
  if (/(?:^|_)(zscore|z_score|std_dev)(?:_|$)/.test(n)) return 'zscore';
  return 'ratio';
};

const scoreColumnHintMatch = (columnName, hints = []) => {
  const token = normToken(columnName).replace(/[^a-z0-9]+/g, '_');
  if (!token) return 0;
  let score = 0;
  hints.forEach((hint) => {
    const h = normToken(hint).replace(/[^a-z0-9]+/g, '_');
    if (!h) return;
    if (token === h) score += 10;
    else if (token.startsWith(`${h}_`) || token.endsWith(`_${h}`)) score += 7;
    else if (token.includes(h)) score += 5;
    else {
      const parts = h.split('_').filter(Boolean);
      if (parts.length > 1 && parts.every((p) => token.includes(p))) score += 3;
    }
  });
  return score;
};

const inferBehaviouralColumns = (columns = [], colTypes = {}, resolved = {}) => {
  const available = Array.isArray(columns) ? columns : [];
  const numericCandidates = available.filter(
    (col) => isNum((colTypes || {})[col] || '') && !isIdCol(col),
  );
  const picked = new Set(Object.values(resolved || {}).filter(Boolean));
  const out = { ...(resolved || {}) };

  Object.entries(BEHAVIOURAL_HINTS).forEach(([key, hints]) => {
    if (out[key]) return;
    const ranked = numericCandidates
      .filter((col) => !picked.has(col))
      .map((col) => ({ col, score: scoreColumnHintMatch(col, hints) }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 6) {
      out[key] = ranked[0].col;
      picked.add(ranked[0].col);
    }
  });

  return out;
};

const findCol = (columns, patterns) => {
  const lcMap = columns.map(c => ({ orig: c, lc: c.toLowerCase().replace(/\s+/g,'_') }));
  for (const pat of patterns) {
    const found = lcMap.find(c => c.lc === pat.toLowerCase() || c.lc.includes(pat.toLowerCase()));
    if (found) return found.orig;
  }
  return null;
};

const columnNameOf = (column) => {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object') return String(column.name || column.column || column.field || '').trim();
  return '';
};

const normalizeDatasetColumns = (columns = []) => (Array.isArray(columns) ? columns : [])
  .map((column) => columnNameOf(column))
  .filter(Boolean);

const normalizeDatasetColumnTypes = (dataset = null) => {
  const merged = { ...(dataset?.column_types || {}) };
  (Array.isArray(dataset?.columns) ? dataset.columns : []).forEach((column) => {
    if (column && typeof column === 'object') {
      const name = columnNameOf(column);
      if (name) merged[name] = column.dtype || column.type || column.data_type || merged[name] || '';
    }
  });
  return merged;
};

// ID-like columns to exclude from analysis charts (not from drilldown)
const isIdCol = (c) => /(_id$|^id$|_key$|^key$|_uuid$|_ref$|_no$|^alert_id|^case_id|^account_id|^customer_id|^transaction_id|^txn_id)/i.test(c);

// --- Formatters ---------------------------------------------------------------
const fmt    = (n) => n == null ? '-' : Number(n).toLocaleString();
const fmtPct = (v, d=1) => v == null ? '-' : `${Number(v).toFixed(d)}%`;
const fmtF   = (v, d=2) => v == null ? '-' : Number(v).toFixed(d);
const short  = (s, n=20) => String(s||'').length > n ? String(s).slice(0,n-1)+'...' : String(s||'');
const isNum  = (dt='') => /int|float|double|decimal|numeric|real|number/.test(dt.toLowerCase());
const qColor = (s) => s >= 80 ? D.ok : s >= 60 ? D.warn : D.danger;
const asArray = (v) => (Array.isArray(v) ? v : []);
const corrColor = (v) => {
  if (v==null) return '#f8fafc';
  const t = Math.max(-1,Math.min(1,v));
  if (t>=0) return `rgb(${Math.round(255-t*180)},${Math.round(255-t*80)},${Math.round(255-t*230)})`;
  const f=-t; return `rgb(255,${Math.round(255-f*200)},${Math.round(255-f*200)})`;
};

const normToken = (v) => String(v ?? '').trim().toLowerCase();
const POSITIVE_CLASS_MARKERS = new Set([
  '1','1.0','true','yes','y','tp','true positive','positive','str','sar','flagged','closed_sar_filed',
]);
const NEGATIVE_CLASS_MARKERS = new Set([
  '0','0.0','false','no','n','fp','false positive','negative','not_flagged','non_sar',
]);

const isPositiveClassValue = (v) => {
  const key = normToken(v);
  if (!key) return false;
  if (POSITIVE_CLASS_MARKERS.has(key)) return true;
  const n = Number(key);
  return Number.isFinite(n) && n > 0;
};

const isNegativeClassValue = (v) => {
  const key = normToken(v);
  if (!key) return false;
  if (NEGATIVE_CLASS_MARKERS.has(key)) return true;
  const n = Number(key);
  return Number.isFinite(n) && n === 0;
};

const splitTargetCounts = (classCounts = {}, valueCounts = []) => {
  let negative = 0;
  let positive = 0;

  Object.entries(classCounts || {}).forEach(([k, v]) => {
    const count = Number(v) || 0;
    if (isPositiveClassValue(k)) positive += count;
    else if (isNegativeClassValue(k)) negative += count;
  });

  if (!positive && !negative && Array.isArray(valueCounts)) {
    valueCounts.forEach((row) => {
      const value = row?.value;
      const count = Number(row?.count) || 0;
      if (isPositiveClassValue(value)) positive += count;
      else if (isNegativeClassValue(value)) negative += count;
    });
  }

  return { negative, positive };
};

const targetLexicon = (targetColumn, persona = 'analyst') => {
  const col = normToken(targetColumn);
  const targetName = targetColumn || 'target';
  const isLegacyAmlTarget = /is_true_pos|is_tp|str|sar/.test(col);
  const isFinalLabel = col === 'final_label' || col.endsWith('_label');

  if (persona === 'business') {
    if (isLegacyAmlTarget) {
      return {
        negative: 'Noise Alerts (0)',
        positive: 'Genuine Alerts (1)',
        negativeShort: 'Noise Alerts',
        positiveShort: 'Genuine Alerts',
        negativeMetric: 'Noise Alerts',
        positiveMetric: 'Genuine Alerts',
      };
    }
    if (isFinalLabel) {
      return {
        negative: 'Likely False Positive (0)',
        positive: 'Likely Actionable Alert (1)',
        negativeShort: 'Likely False Positive',
        positiveShort: 'Likely Actionable Alert',
        negativeMetric: 'Likely False Positive Count',
        positiveMetric: 'Likely Actionable Alert Count',
      };
    }
    return {
      negative: 'Lower-Priority Outcome (0)',
      positive: 'Higher-Priority Outcome (1)',
      negativeShort: 'Lower-Priority Outcome',
      positiveShort: 'Higher-Priority Outcome',
      negativeMetric: 'Lower-Priority Count',
      positiveMetric: 'Higher-Priority Count',
    };
  }

  return {
    negative: `${targetName} = 0`,
    positive: `${targetName} = 1`,
    negativeShort: 'Class 0',
    positiveShort: 'Class 1',
    negativeMetric: 'Class 0',
    positiveMetric: 'Class 1',
  };
};

const classNameFromSeries = (seriesKey, lexicon) =>
  seriesKey === 'fp_count' || seriesKey === 'FP' || seriesKey === 'cumFP' || seriesKey === 'fp_share_pct'
    ? lexicon.negativeShort
    : lexicon.positiveShort;

const targetSemantics = (targetColumn) => {
  const token = normToken(targetColumn);
  if (!token) {
    return {
      kind: 'none',
      title: 'Target Not Set',
      summary: 'Target-dependent rates are hidden until you select a target column.',
      detail: 'Set a binary target to unlock class-wise TP-rate style analytics.',
    };
  }
  if (/(?:^|_)(is_true_pos|is_true_positive|is_tp|sar|str)(?:_|$)/.test(token)) {
    return {
      kind: 'true_positive',
      title: `Target = ${targetColumn}`,
      summary: 'Positive class is interpreted as a genuine suspicious event outcome.',
      detail: 'TP rate means the share of records where this target is positive (typically 1/true/SAR).',
    };
  }
  if (/(?:^|_)(final_label|label|target|flag)(?:_|$)/.test(token)) {
    return {
      kind: 'label_proxy',
      title: `Target = ${targetColumn}`,
      summary: 'Positive class is inferred from your selected label column.',
      detail: 'TP rate here is label-positive rate, not guaranteed adjudicated SAR truth unless your label is curated as such.',
    };
  }
  return {
    kind: 'custom',
    title: `Target = ${targetColumn}`,
    summary: 'Positive class follows the selected target coding.',
    detail: 'TP rate means percentage of records mapped to the positive marker (usually class 1).',
  };
};

const TargetSemanticsNote = ({ targetColumn, compact = false }) => {
  const semantics = targetSemantics(targetColumn);
  const severity = semantics.kind === 'label_proxy' ? 'warning' : semantics.kind === 'none' ? 'info' : 'success';
  return (
    <Alert severity={severity} sx={{ borderRadius: 2, py: compact ? 0.25 : 0.75 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, mb: compact ? 0 : 0.25 }}>
        {semantics.title}
      </Typography>
      <Typography sx={{ fontSize: 11, color: D.textSec }}>
        {semantics.summary}
      </Typography>
      {!compact && (
        <Typography sx={{ fontSize: 10.5, color: D.textSec, mt: 0.35 }}>
          {semantics.detail}
        </Typography>
      )}
    </Alert>
  );
};

// --- Shared atoms -------------------------------------------------------------
const Spinner = ({ label }) => (
  <Box sx={{ py:8, textAlign:'center' }}>
    <CircularProgress size={32} sx={{ color: D.orange, mb:1.5 }} />
    <Typography variant="body2" color="text.secondary">{label||'Loading...'}</Typography>
  </Box>
);

const ErrBox = ({ msg, onRetry }) => (
  <Alert severity="error" sx={{ borderRadius:2 }}
    action={onRetry && <Button size="small" onClick={onRetry}>Retry</Button>}>
    {msg}
  </Alert>
);

const Card = ({ children, sx={}, highlight, danger: isDanger }) => (
  <Paper variant="outlined" sx={{
    p:{ xs:1.5, md:1.75 }, borderRadius:1.25, bgcolor: D.cardBg,
    borderColor: highlight ? '#f3c6af' : isDanger ? '#fca5a5' : D.border,
    boxShadow:'none',
    ...sx,
  }}>
    {children}
  </Paper>
);

const SectionLabel = ({ children, icon: Icon }) => (
  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb:1 }}>
    {Icon && <Icon sx={{ fontSize:13, color:D.textSec }} />}
    <Typography variant="caption" sx={{
      fontWeight:700, textTransform:'uppercase', letterSpacing:0.9,
      fontSize:10, color:D.textSec,
    }}>
      {children}
    </Typography>
  </Stack>
);

const StatCell = ({ label, value, sub, warn, ok, danger: isDanger }) => (
  <Box sx={{
    p:1.5, borderRadius:1.5,
    bgcolor: isDanger ? D.dangerLight : ok ? D.okLight : warn ? D.warnLight : '#f8fafc',
    border:`1px solid ${isDanger ? '#fecdd3' : ok ? D.okBorder : warn ? '#fde68a' : D.border}`,
    minWidth:90,
  }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, display:'block' }}>{label}</Typography>
    <Typography sx={{ fontWeight:800, fontSize:20, lineHeight:1.1,
      color: isDanger ? D.danger : ok ? D.ok : warn ? D.warn : D.textPri }}>
      {value}
    </Typography>
    {sub && <Typography variant="caption" color="text.secondary" sx={{ fontSize:10 }}>{sub}</Typography>}
  </Box>
);

// Business insight panel - shown per chart in business mode
const InsightPanel = ({ what, why, action, severity='info' }) => {
  const colors = {
    info:    { border: '#bfdbfe', icon: D.info,   Icon: Lightbulb },
    warning: { border: '#fde68a', icon: D.warn,   Icon: Warning },
    success: { border: D.okBorder,icon: D.ok,     Icon: CheckCircle },
    danger:  { border: '#fecdd3', icon: D.danger, Icon: GppBad },
  };
  const c = colors[severity] || colors.info;
  return (
    <Box sx={{ mt:1.15, pt:1.1, borderTop:`1px solid ${D.borderLight}` }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <c.Icon sx={{ fontSize:15, color:c.icon, mt:0.1, flexShrink:0 }} />
        <Box sx={{ borderLeft:`2px solid ${c.border}`, pl:1 }}>
          {what && <Typography sx={{ fontSize:11, fontWeight:700, color:D.textPri, mb:0.25 }}>{what}</Typography>}
          {why  && <Typography sx={{ fontSize:11, color:D.textSec, lineHeight:1.5 }}>{why}</Typography>}
          {action && (
            <Typography sx={{ fontSize:11, color:c.icon, fontWeight:600, mt:0.5 }}>
              Action: {action}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
};

const buildLocalChartAnalysis = ({ title, explain, analysisPayload }) => {
  const payload = analysisPayload || {};
  const deterministic = payload?.deterministic_insight || {};
  const facts = compactFacts(payload?.facts || [explain].filter(Boolean), 8);
  const focus = String(payload?.chart_focus || title || 'this analysis').trim();
  const sections = {
    what_this_says: String(
      deterministic.what
      || explain
      || `This view summarises the current pattern in ${focus.toLowerCase()}.`
    ).trim(),
    why_it_matters: String(
      deterministic.why
      || `This matters because it shows whether ${focus.toLowerCase()} is concentrated, stable, separated, or weak before you move into modelling.`
    ).trim(),
    how_it_helps_model_building: String(
      deterministic.how_it_helps_model_building
      || `Use this view to decide whether ${focus.toLowerCase()} should be kept as a feature, transformed, deprioritised, or reviewed with business stakeholders.`
    ).trim(),
    recommended_action: String(
      deterministic.action
      || deterministic.recommended_action
      || 'Use this chart with target response, quality checks, and leakage checks before changing the model design.'
    ).trim(),
    watch_out: String(
      payload?.watch_out
      || deterministic.watch_out
      || 'Treat this as one piece of evidence. Confirm the pattern against support, missingness, and other EDA views before acting.'
    ).trim(),
  };
  return {
    analysis_source: 'deterministic',
    llm_available: false,
    chart_title: title,
    facts,
    sections,
  };
};

const DrilldownFrame = ({ title, persona, explain, analysisPayload, children }) => {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const localAnalysis = useMemo(
    () => buildLocalChartAnalysis({ title, explain, analysisPayload }),
    [title, explain, analysisPayload],
  );
  const requestKey = useMemo(
    () => (analysisPayload ? JSON.stringify(analysisPayload) : ''),
    [analysisPayload],
  );

  const loadAnalysis = useCallback(async ({ force = false } = {}) => {
    if (!analysisPayload?.dataset_id) {
      setAnalysis(localAnalysis);
      return;
    }
    if (!force && loadedKey === requestKey && analysis) return;
    setAnalysisLoading(true);
    setAnalysisNotice('');
    try {
      const res = await mlopsApi.edaChartExplain(analysisPayload);
      const data = res?.data || res;
      setAnalysis(data || localAnalysis);
      setLoadedKey(requestKey);
    } catch (error) {
      setAnalysis(localAnalysis);
      setLoadedKey(requestKey);
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('method not allowed') || message.includes('not found')) {
        setAnalysisNotice('Using local chart facts. Restart the backend to enable the new EDA explanation route.');
      } else if (message.includes('no response')) {
        setAnalysisNotice('Using local chart facts because the AI explanation service is not reachable right now.');
      } else {
        setAnalysisNotice('Using local chart facts because the AI explanation service is unavailable.');
      }
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysis, analysisPayload, loadedKey, requestKey, localAnalysis]);

  useEffect(() => {
    if (!open || !analysisPayload?.dataset_id || !requestKey) return;
    if (loadedKey === requestKey) return;
    loadAnalysis();
  }, [analysisPayload, loadAnalysis, loadedKey, open, requestKey]);

  const sections = analysis?.sections || {};
  const factLines = compactFacts(analysis?.facts || analysisPayload?.facts || [], 8);
  const analysisSourceLabel = analysis?.analysis_source === 'ai' ? 'AI explanation' : 'Grounded explanation';
  const analysisSourceNote = analysis?.analysis_source === 'ai'
    ? 'Uses live chart facts and the configured local LLM provider.'
    : 'Built directly from the chart facts because AI is unavailable or not configured.';
  const sectionMeta = [
    ['what_this_says', 'What this says'],
    ['why_it_matters', 'Why this matters'],
    ['how_it_helps_model_building', 'How this helps model building'],
    ['recommended_action', 'Recommended action'],
    ['watch_out', 'Watch out'],
  ];

  return (
    <>
      <Box>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb:0.25 }}>
          <Tooltip title={analysisPayload ? 'Open chart insights' : 'Open chart analysis'}>
            <Button
              size="small"
              variant="text"
              onClick={()=>setOpen(true)}
              startIcon={<Insights sx={{ fontSize:15 }} />}
              sx={{ textTransform:'none', fontSize:11, color:D.textSec, px:0.75, minWidth:0 }}
            >
              Insights
            </Button>
          </Tooltip>
        </Stack>
        <Box
          role="button"
          tabIndex={0}
          onClick={()=>setOpen(true)}
          onKeyDown={(e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setOpen(true); } }}
          aria-label={`Open drilldown for ${title}`}
          sx={{ cursor:'zoom-in', borderRadius:1, outline:'none' }}
        >
          {children}
        </Box>
        {persona==='business' && explain && (
          <Typography sx={{ mt:0.75, fontSize:11, color:D.textSec }}>
            {explain}
          </Typography>
        )}
      </Box>

      <Dialog
        open={open}
        onClose={()=>setOpen(false)}
        fullWidth
        maxWidth="xl"
        PaperProps={{
          sx: {
            width: 'min(1480px, calc(100vw - 48px))',
            maxWidth: '1480px',
            height: 'min(88vh, 980px)',
            maxHeight: '88vh',
            borderRadius: 1.25,
          },
        }}
      >
        <DialogTitle sx={{ borderBottom:`1px solid ${D.border}`, pr: 1.25 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontWeight:800, fontSize:18, color:D.textPri }}>{title}</Typography>
              {persona==='business' && explain && (
                <Typography sx={{ fontSize:12, color:D.textSec, mt:0.25 }}>{explain}</Typography>
              )}
            </Box>
            <IconButton onClick={()=>setOpen(false)} size="small" sx={{ border:`1px solid ${D.border}`, borderRadius:1 }}>
              <Close sx={{ fontSize:16, color:D.textSec }} />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p:2.25, overflowY:'auto', overflowX:'hidden' }}>
          <Box sx={{
            display:'grid',
            gridTemplateColumns: analysisPayload
              ? { xs:'1fr', xl:'minmax(0,1.45fr) minmax(320px,0.95fr)' }
              : '1fr',
            gap:2,
            alignItems:'start',
          }}>
            <Box sx={{ minWidth:0 }}>
              {persona==='business' && explain && (
                <Alert severity="info" sx={{ mb:1.5, borderRadius:1.25 }}>
                  What are we looking at? {explain}
                </Alert>
              )}
              <Box sx={{
                p:{ xs:1, md:1.5 },
                border:`1px solid ${D.border}`,
                borderRadius:1.25,
                bgcolor:'#fff',
                '& .recharts-responsive-container': { minHeight:'52vh !important' },
              }}>
                {children}
              </Box>
            </Box>

            {analysisPayload && (
              <Paper variant="outlined" sx={{ borderRadius:1.25, p:0, minWidth:0, overflow:'hidden' }}>
                <Box sx={{ px:1.5, py:1.35, borderBottom:`1px solid ${D.border}`, bgcolor:'#fcfcfd' }}>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography sx={{ fontSize:12, fontWeight:700, color:D.textPri }}>
                        Model-building interpretation
                      </Typography>
                      <Typography sx={{ fontSize:11, color:D.textSec, mt:0.25 }}>
                        {analysisSourceNote}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => loadAnalysis({ force: true })}
                      disabled={analysisLoading}
                      startIcon={analysisLoading ? <CircularProgress size={12} sx={{ color:D.orange }} /> : <Refresh sx={{ fontSize:14 }} />}
                      sx={{ textTransform:'none', fontSize:11, color:D.orange, minWidth:0 }}
                    >
                      Refresh
                    </Button>
                  </Stack>
                  <Stack direction="row" spacing={0.75} sx={{ mt:1, flexWrap:'wrap' }}>
                    <Chip size="small" label={analysisSourceLabel} sx={{ fontSize:10, height:22, bgcolor:D.orangeLight, color:D.orange }} />
                    {analysis?.provider && (
                      <Chip size="small" label={`Provider: ${analysis.provider}`} sx={{ fontSize:10, height:22 }} />
                    )}
                    {analysis?.model && (
                      <Chip size="small" label={`Model: ${analysis.model}`} sx={{ fontSize:10, height:22 }} />
                    )}
                  </Stack>
                </Box>

                <Box sx={{ px:1.5, py:1.35 }}>
                  {analysisNotice && (
                    <Alert severity="info" sx={{ mb:1.25, borderRadius:1.25 }}>
                      {analysisNotice}
                    </Alert>
                  )}
                  {analysisLoading && !analysis && (
                    <Spinner label="Building chart explanation..." />
                  )}
                  {!analysisLoading && (
                    <Stack spacing={1.25}>
                      {sectionMeta.map(([key, label]) => (
                        sections?.[key] ? (
                          <Box key={key} sx={{ pb:1.1, borderBottom: key === 'watch_out' ? 'none' : `1px solid ${D.borderLight}` }}>
                            <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.45 }}>
                              {label}
                            </Typography>
                            <Typography sx={{ fontSize:12, color:D.textPri, lineHeight:1.65 }}>
                              {sections[key]}
                            </Typography>
                          </Box>
                        ) : null
                      ))}
                      {factLines.length > 0 && (
                        <Box>
                          <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.5 }}>
                            Grounding facts
                          </Typography>
                          <Stack spacing={0.6}>
                            {factLines.map((fact, index) => (
                              <Typography key={`${fact}-${index}`} sx={{ fontSize:11, color:D.textSec, lineHeight:1.55 }}>
                                {fact}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  )}
                </Box>
              </Paper>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

const average = (values = []) => {
  const valid = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
};

const weightedMeanFromBins = (bins = [], key = 'count') => {
  const total = bins.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
  if (!total) return null;
  const weighted = bins.reduce(
    (sum, row) => sum + ((Number(row?.bin_start) || 0) * (Number(row?.[key]) || 0)),
    0,
  );
  return weighted / total;
};

const overlapFromBins = (bins = []) => {
  const totalNegative = bins.reduce((sum, row) => sum + (Number(row?.fp_count) || 0), 0) || 1;
  const totalPositive = bins.reduce((sum, row) => sum + (Number(row?.tp_count) || 0), 0) || 1;
  const overlap = bins.reduce((sum, row) => {
    const negativeShare = (Number(row?.fp_count) || 0) / totalNegative;
    const positiveShare = (Number(row?.tp_count) || 0) / totalPositive;
    return sum + Math.min(negativeShare, positiveShare);
  }, 0);
  return Math.max(0, Math.min(1, overlap));
};

const buildTargetBreakdownInsight = (classData = [], lexicon) => {
  const rows = [...asArray(classData)].sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0));
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + (Number(row?.count) || 0), 0) || 1;
  const top = rows[0];
  const second = rows[1];
  const topShare = (Number(top?.count) || 0) / total;
  const secondShare = (Number(second?.count) || 0) / total;
  return {
    what: `${fmtPct(topShare * 100)} of records currently fall into ${top?.label || lexicon?.negativeShort || 'the largest class'}.`,
    why: second
      ? `The gap between ${top.label} and ${second.label} is ${fmtPct((topShare - secondShare) * 100)}. Larger gaps usually mean stronger class imbalance and more pressure on threshold selection.`
      : `This view currently shows one dominant class segment across ${fmt(total)} records.`,
    action: top?.bucket === 'negative'
      ? `Keep class weighting on, and size suppression targets around the ${top?.label || lexicon?.negativeShort} population rather than the whole book.`
      : `Confirm the positive class is curated correctly and check that there are enough examples before training.`,
    severity: topShare >= 0.8 ? 'warning' : topShare >= 0.65 ? 'info' : 'success',
  };
};

const buildRiskHistogramInsight = (riskHistData = [], lexicon) => {
  const bins = asArray(riskHistData);
  if (!bins.length) return null;
  const negativeMean = weightedMeanFromBins(bins, 'fp_count');
  const positiveMean = weightedMeanFromBins(bins, 'tp_count');
  const overlap = overlapFromBins(bins);
  const scoreGap = (positiveMean != null && negativeMean != null) ? (positiveMean - negativeMean) : null;
  const gapText = scoreGap == null ? 'n/a' : fmtF(scoreGap, 1);
  return {
    what: scoreGap != null && scoreGap > 0
      ? `${lexicon?.positiveShort || 'Positive alerts'} score about ${gapText} points higher on average than ${lexicon?.negativeShort || 'negative alerts'}.`
      : `${lexicon?.negativeShort || 'Negative alerts'} and ${lexicon?.positiveShort || 'positive alerts'} are still heavily overlapping on score.`,
    why: `Estimated distribution overlap is ${fmtPct(overlap * 100)}. Lower overlap means the existing risk score already separates the two classes better.`,
    action: overlap > 0.65
      ? 'Treat rule score as one feature, not the decision rule by itself. The model needs additional behavioral signals here.'
      : 'Keep risk score in the feature set and use it as a major explanation factor, because it is already separating the classes reasonably well.',
    severity: overlap < 0.35 ? 'success' : overlap < 0.6 ? 'info' : 'warning',
  };
};

const buildRuleVolumeInsight = (ruleData = [], ruleColIsProfile = false) => {
  const rows = [...asArray(ruleData)].sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0));
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + (Number(row?.count) || 0), 0) || 1;
  const top = rows[0];
  const topShare = (Number(top?.count) || 0) / total;
  const topThreeShare = rows.slice(0, 3).reduce((sum, row) => sum + (Number(row?.count) || 0), 0) / total;
  return {
    what: `${top?.label || 'Top segment'} contributes ${fmtPct(topShare * 100)} of the displayed ${ruleColIsProfile ? 'profile' : 'rule'} volume.`,
    why: `The top three ${ruleColIsProfile ? 'profiles' : 'rules'} together represent ${fmtPct(topThreeShare * 100)} of alerts in this chart, so the concentration is meaningful.`,
    action: topShare > 0.35
      ? `Start review with the highest-volume ${ruleColIsProfile ? 'profiles' : 'rules'} first. They will move the suppression needle fastest.`
      : `Use this chart with STR conversion or precision to rank which ${ruleColIsProfile ? 'profiles' : 'rules'} are worth redesigning first.`,
    severity: topShare > 0.45 ? 'warning' : 'info',
  };
};

const buildRiskTierInsight = (ratingData = []) => {
  const rows = asArray(ratingData).filter((row) => Number.isFinite(Number(row?.tp_rate)));
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => Number(a?.label) - Number(b?.label));
  const highest = [...rows].sort((a, b) => (Number(b?.tp_rate) || 0) - (Number(a?.tp_rate) || 0))[0];
  const lowest = [...rows].sort((a, b) => (Number(a?.tp_rate) || 0) - (Number(b?.tp_rate) || 0))[0];
  const trend = (Number(sorted.at(-1)?.tp_rate) || 0) - (Number(sorted[0]?.tp_rate) || 0);
  const spread = (Number(highest?.tp_rate) || 0) - (Number(lowest?.tp_rate) || 0);
  return {
    what: spread >= 8
      ? `Customer risk tier ${highest?.label || '-'} has the highest positive rate at ${fmtPct(highest?.tp_rate)}.`
      : 'Customer risk tiers are fairly flat in this sample.',
    why: `Across the visible tiers, the positive rate ranges from ${fmtPct(lowest?.tp_rate)} to ${fmtPct(highest?.tp_rate)}. End-to-end spread is ${fmtPct(spread)}.`,
    action: trend > 5
      ? 'Keep customer risk tier as a supporting model feature, but do not use it alone to suppress or escalate alerts.'
      : 'Treat customer risk tier as weak evidence on its own. The live transaction patterns matter more than the onboarding band here.',
    severity: spread < 5 ? 'warning' : trend > 5 ? 'success' : 'info',
  };
};

const buildAccountTypeInsight = (acctData = []) => {
  const rows = asArray(acctData).filter((row) => Number.isFinite(Number(row?.tp_rate)));
  if (!rows.length) return null;
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const spread = (Number(top?.tp_rate) || 0) - (Number(bottom?.tp_rate) || 0);
  return {
    what: `${top?.label || 'The top account type'} has the highest positive rate at ${fmtPct(top?.tp_rate)}.`,
    why: `The spread between the highest and lowest displayed account types is ${fmtPct(spread)}. Larger spreads mean account type is materially influencing alert quality.`,
    action: spread > 12
      ? 'Keep account type in the model and use it in business explanation, because the differences are large enough to matter.'
      : 'Use account type as context, but expect the model to rely more on behavior and transaction history than on type alone.',
    severity: spread > 15 ? 'success' : spread > 8 ? 'info' : 'warning',
  };
};

const buildComplianceFlagInsight = (flagData = null) => {
  if (!flagData) return null;
  const comparisons = (flagData.flagNames || []).map((name, index) => {
    const flagged = Number(flagData.flagged?.[index]?.value);
    const unflagged = Number(flagData.unflagged?.[index]?.value);
    return {
      name,
      flagged,
      unflagged,
      gap: (Number.isFinite(flagged) ? flagged : 0) - (Number.isFinite(unflagged) ? unflagged : 0),
    };
  });
  const best = [...comparisons].sort((a, b) => b.gap - a.gap)[0];
  const avgFlagged = average(comparisons.map((row) => row.flagged));
  const avgUnflagged = average(comparisons.map((row) => row.unflagged));
  const avgGap = (avgFlagged != null && avgUnflagged != null) ? (avgFlagged - avgUnflagged) : null;
  return {
    what: best?.gap > 0
      ? `${best.name} raises the positive rate by ${fmtPct(best.gap)} compared with the unflagged group.`
      : 'The available compliance flags are not separating the classes very much in this sample.',
    why: avgGap == null
      ? 'Flag comparison data is incomplete for at least one compliance signal.'
      : `Across the displayed flags, flagged populations average ${fmtPct(avgFlagged)} versus ${fmtPct(avgUnflagged)} for unflagged populations.`,
    action: best?.gap > 6
      ? 'Use these flags as strong supporting features, but still avoid letting them act as automatic escalation rules by themselves.'
      : 'Review whether the rule engine is overusing these flags, because the observed gap is small.',
    severity: (best?.gap || 0) > 10 ? 'success' : (best?.gap || 0) > 4 ? 'info' : 'warning',
  };
};

const compactFacts = (facts = [], maxItems = 6) => asArray(facts)
  .map((fact) => String(fact || '').trim())
  .filter(Boolean)
  .slice(0, maxItems);

const buildChartExplanationPayload = ({
  ds,
  chartKey,
  chartTitle,
  chartFocus,
  targetColumn,
  lexicon,
  deterministicInsight,
  facts,
  watchOut,
  analysisScope = 'chart',
}) => ({
  dataset_id: ds?.dataset_id,
  chart_key: chartKey,
  chart_title: chartTitle,
  chart_focus: chartFocus,
  analysis_scope: analysisScope,
  target_column: targetColumn || '',
  business_labels: {
    negative: lexicon?.negativeShort || '',
    positive: lexicon?.positiveShort || '',
    target_display: lexicon?.positiveShort || targetColumn || 'Predicted outcome',
  },
  deterministic_insight: deterministicInsight || null,
  facts: compactFacts(facts),
  watch_out: watchOut || '',
});

const buildTargetBreakdownFacts = (classData = [], lexicon) => {
  const rows = asArray(classData);
  if (!rows.length) return [];
  const total = rows.reduce((sum, row) => sum + (Number(row?.count) || 0), 0) || 1;
  const top = [...rows].sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0))[0];
  return compactFacts([
    `${fmt(total)} records are currently split between ${lexicon?.negativeShort || 'class 0'} and ${lexicon?.positiveShort || 'class 1'}.`,
    rows.map((row) => `${row.label}: ${fmt(row.count)} records (${fmtPct((Number(row?.pct) || 0) * 100)})`).join(' | '),
    top ? `${top.label} is the largest segment in this target view.` : '',
  ]);
};

const buildRiskHistogramFacts = (riskHistData = [], lexicon) => {
  const bins = asArray(riskHistData);
  if (!bins.length) return [];
  const negativeMean = weightedMeanFromBins(bins, 'fp_count');
  const positiveMean = weightedMeanFromBins(bins, 'tp_count');
  const overlap = overlapFromBins(bins);
  const separation = (positiveMean != null && negativeMean != null) ? positiveMean - negativeMean : null;
  return compactFacts([
    `Average score is ${fmtF(negativeMean, 1)} for ${lexicon?.negativeShort || 'class 0'} and ${fmtF(positiveMean, 1)} for ${lexicon?.positiveShort || 'class 1'}.`,
    `Estimated overlap between the two score distributions is ${fmtPct(overlap * 100)}.`,
    separation != null ? `The score gap between the two groups is ${fmtF(separation, 1)} points.` : '',
  ]);
};

const buildRuleVolumeFacts = (ruleData = [], ruleColIsProfile = false) => {
  const rows = [...asArray(ruleData)].sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0));
  if (!rows.length) return [];
  const total = rows.reduce((sum, row) => sum + (Number(row?.count) || 0), 0) || 1;
  const topThree = rows.slice(0, 3);
  const topThreeShare = topThree.reduce((sum, row) => sum + (Number(row?.count) || 0), 0) / total;
  return compactFacts([
    `This view covers ${fmt(total)} alerts across the highest-volume ${ruleColIsProfile ? 'risk profiles' : 'rules'}.`,
    `${rows[0]?.label || 'Top segment'} contributes ${fmt(rows[0]?.count)} alerts (${fmtPct(((Number(rows[0]?.count) || 0) / total) * 100)}).`,
    `The top three ${ruleColIsProfile ? 'profiles' : 'rules'} contribute ${fmtPct(topThreeShare * 100)} of the visible alert volume.`,
  ]);
};

const buildRiskTierFacts = (ratingData = []) => {
  const rows = asArray(ratingData).filter((row) => Number.isFinite(Number(row?.tp_rate)));
  if (!rows.length) return [];
  const highest = [...rows].sort((a, b) => (Number(b?.tp_rate) || 0) - (Number(a?.tp_rate) || 0))[0];
  const lowest = [...rows].sort((a, b) => (Number(a?.tp_rate) || 0) - (Number(b?.tp_rate) || 0))[0];
  return compactFacts([
    `Visible customer risk tiers range from ${lowest?.label || '-'} to ${highest?.label || '-'}.`,
    `The lowest observed positive rate is ${fmtPct(lowest?.tp_rate)} and the highest is ${fmtPct(highest?.tp_rate)}.`,
    highest ? `Tier ${highest.label} currently has the highest positive rate in this sample.` : '',
  ]);
};

const buildAccountTypeFacts = (acctData = [], lexicon) => {
  const rows = asArray(acctData).filter((row) => Number.isFinite(Number(row?.tp_rate)));
  if (!rows.length) return [];
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  return compactFacts([
    `${rows.length} account types are displayed for ${lexicon?.positiveShort || 'the positive outcome'} rate comparison.`,
    `${top?.label || 'Top account type'} has the highest rate at ${fmtPct(top?.tp_rate)} with ${fmt(top?.count)} records.`,
    bottom ? `${bottom.label} is the lowest displayed group at ${fmtPct(bottom.tp_rate)}.` : '',
  ]);
};

const buildComplianceFacts = (flagData = null, lexicon) => {
  if (!flagData) return [];
  const comparisons = (flagData.flagNames || []).map((name, index) => {
    const flagged = Number(flagData.flagged?.[index]?.value);
    const unflagged = Number(flagData.unflagged?.[index]?.value);
    return {
      name,
      flagged,
      unflagged,
      gap: (Number.isFinite(flagged) ? flagged : 0) - (Number.isFinite(unflagged) ? unflagged : 0),
    };
  }).filter((row) => Number.isFinite(row.flagged) || Number.isFinite(row.unflagged));
  if (!comparisons.length) return [];
  const best = [...comparisons].sort((a, b) => b.gap - a.gap)[0];
  return compactFacts([
    `${comparisons.length} compliance flag groups are compared against ${lexicon?.positiveShort || 'the positive outcome'} rate.`,
    `${best?.name || 'Top flag'} shows the largest uplift: ${fmtPct(best?.flagged)} flagged versus ${fmtPct(best?.unflagged)} unflagged.`,
    `Flag gap for ${best?.name || 'the top signal'} is ${fmtPct(best?.gap)}.`,
  ]);
};

const MatrixHeatmap = ({ data }) => {
  const rows = data?.x_values || [];
  const cols = data?.y_values || [];
  const matrix = data?.matrix || [];
  const maxVal = matrix.reduce((m, r) => Math.max(m, r?.value || 0), 0) || 1;
  const lookup = useMemo(() => {
    const map = new Map();
    matrix.forEach(m => map.set(`${m.x}||${m.y}`, m.value));
    return map;
  }, [matrix]);
  const cellColor = (v) => {
    if (v == null) return '#f8fafc';
    const t = Math.min(1, v / maxVal);
    return `rgba(208,74,2,${0.15 + 0.85 * t})`;
  };

  if (!rows.length || !cols.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        No categorical matrix available for these columns.
      </Typography>
    );
  }

  return (
    <Box sx={{ minWidth: cols.length * 46 + 120 }}>
      <Box sx={{ display:'flex', mb:0.5 }}>
        <Box sx={{ width:100 }} />
        {cols.map(c=>(
          <Typography key={c} sx={{ width:40, fontSize:9, color:D.textSec, textAlign:'center' }} noWrap>
            {short(c,10)}
          </Typography>
        ))}
      </Box>
      {rows.map(r=>(
        <Box key={r} sx={{ display:'flex', alignItems:'center', mb:'2px' }}>
          <Box sx={{ width:100 }}>
            <Typography sx={{ fontSize:9, color:D.textSec }} noWrap>{short(r,12)}</Typography>
          </Box>
          {cols.map(c=>{
            const v = lookup.get(`${r}||${c}`);
            return (
              <Tooltip key={`${r}-${c}`} title={`${short(r,16)} x ${short(c,16)}: ${fmt(v)}`}>
                <Box sx={{
                  width:40, height:22, borderRadius:'2px',
                  bgcolor:cellColor(v), border:`1px solid ${D.borderLight}`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  {v!=null&&(
                    <Typography sx={{ fontSize:8, color:v/maxVal>0.6?'white':'#374151', fontWeight:600 }}>
                      {fmt(v)}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

// --- Tab definitions ----------------------------------------------------------
const TABS = [
  { id:'dashboard',  Icon:Analytics,  label:'Dashboard',          biz:'Summary',
    desc:'Six-panel overview of class balance, score behaviour, rules, and risk flags.',
    bizDesc:'Quick health check and key AML signals at a glance.' },
  { id:'imbalance',  Icon:Balance,    label:'Alert Imbalance',    biz:'Alert Health',
    desc:'Class balance, suppression opportunity, and label quality.',
    bizDesc:'How much noise vs real alerts, and what that means for cost savings.' },
  { id:'riskscore',  Icon:Speed,      label:'Risk Score Analysis',biz:'Score Behaviour',
    desc:'KS separation, score distributions, and discrimination strength.',
    bizDesc:'Does the existing risk score separate real alerts from noise?' },
  { id:'rules',      Icon:Rule,       label:'Rule Intelligence',  biz:'Rule Analysis',
    desc:'Top alerting rules, TP rates, and suppression impact by rule.',
    bizDesc:'Which rules drive the most alerts and which are low-value.' },
  { id:'entity',     Icon:Person,     label:'Entity Risk',        biz:'Customer Risk',
    desc:'TP rate by customer and account segments (rating, type, geo, income).',
    bizDesc:'Which customer segments are highest risk.' },
  { id:'behaviour',  Icon:Timeline,   label:'Behavioural Patterns',biz:'Transaction Patterns',
    desc:'Transaction amount, velocity, cash intensity patterns and outliers.',
    bizDesc:'How transaction behaviour differs for true vs false alerts.' },
  { id:'compliance', Icon:Security,   label:'Compliance Flags',   biz:'Compliance Risk',
    desc:'PEP/sanctions/adverse media/KYC impact on TP rates.',
    bizDesc:'How compliance flags change genuine alert likelihood.' },
  { id:'columns',    Icon:TableChart, label:'Column Explorer',    biz:'Column Details',
    desc:'Per-column profiling: distributions, missingness, and top values.',
    bizDesc:'Drill into any field to see quality and distribution.' },
  { id:'quality',    Icon:Assessment, label:'Data Quality',       biz:'Data Health',
    desc:'Missingness, outliers, duplicates, and overall quality score.',
    bizDesc:'Is the data clean enough to build a reliable model?' },
  { id:'corr',       Icon:BubbleChart,label:'Correlations',       biz:'Relationships',
    desc:'Correlation heatmap to spot redundancy and leakage.',
    bizDesc:'Which fields move together and may be redundant.' },
  { id:'drivers',    Icon:Flag,       label:'Feature vs Target',  biz:'What Drives It',
    desc:'Feature importance/IV ranking and leakage flags.',
    bizDesc:'Which fields best predict genuine alerts.' },
  { id:'advanced',   Icon:Psychology, label:'Advanced EDA',       biz:'Deep Analysis',
    desc:'Leakage detection, suppression sizing, drift checks, and stability.',
    bizDesc:'Advanced diagnostics before model training.' },
  { id:'insights',   Icon:Insights,   label:'Insights',           biz:'Recommendations',
    desc:'Automated AML insights and recommended actions.',
    bizDesc:'Actionable recommendations based on the data.' },
  { id:'explorer',   Icon:TravelExplore, label:'Explorer',        biz:'Explore',
    desc:'Custom bivariate analysis and scatter matrix (pairplot).',
    bizDesc:'Explore any two columns and relationships interactively.' },
];

// ============================================================================
// ROOT COMPONENT
// ============================================================================
const EDAScreen = ({ persona: propPersona, datasets=[], masterDataset, targetColumn:propTarget, onEdaDone, edaDone = false }) => {
  const [tab,          setTab]          = useState('dashboard');
  const [localTarget,  setLocalTarget]  = useState(propTarget||'');
  const [viewMode,     setViewMode]     = useState(propPersona==='business' ? 'business' : 'analyst');
  const [showQualityNote, setShowQualityNote] = useState(false);
  const [compactHeader, setCompactHeader] = useState(true);

  const masterDs = masterDataset || datasets.find(d =>
    d.dataset_type==='master_dataset' || d.dataset_type?.startsWith('master')
  );

  useEffect(()=>{ if(propTarget) setLocalTarget(propTarget); },[propTarget]);

  const colNames  = useMemo(() => normalizeDatasetColumns(masterDs?.columns), [masterDs?.columns]);
  const colTypes  = useMemo(() => normalizeDatasetColumnTypes(masterDs), [masterDs]);

  // Detect AML columns
  const detectedCols = useMemo(()=>({
    target:       localTarget || findCol(colNames, AML_COL.target),
    riskScore:    findCol(colNames, AML_COL.riskScore),
    rule:         findCol(colNames, AML_COL.rule),
    riskRating:   findCol(colNames, AML_COL.riskRating),
    accountType:  findCol(colNames, AML_COL.accountType),
    accountStatus:findCol(colNames, AML_COL.accountStatus),
    pep:          findCol(colNames, AML_COL.pepFlag),
    sanction:     findCol(colNames, AML_COL.sanctionHit),
    adverse:      findCol(colNames, AML_COL.adverseMedia),
    alertDate:    findCol(colNames, AML_COL.alertDate),
    nationality:  findCol(colNames, AML_COL.nationality),
    occupation:   findCol(colNames, AML_COL.occupation),
    txnAmount:    findCol(colNames, AML_COL.txnAmount),
    txnCount:     findCol(colNames, AML_COL.txnCount),
    kyc:          findCol(colNames, AML_COL.kyc),
    cashIntensity:findCol(colNames, AML_COL.cashIntensity),
    velocity:     findCol(colNames, AML_COL.velocity),
    income:       findCol(colNames, AML_COL.income),
    volSpike:     findCol(colNames, AML_COL.volSpike),
    passThrough:  findCol(colNames, AML_COL.passThrough),
    counterparty: findCol(colNames, AML_COL.counterparty),
    peerZScore:   findCol(colNames, AML_COL.peerZScore),
    layering:     findCol(colNames, AML_COL.layering),
    offHours:     findCol(colNames, AML_COL.offHours),
    actualExpected: findCol(colNames, AML_COL.actualExpected),
    structuring:  findCol(colNames, AML_COL.structuring),
    highRiskDest: findCol(colNames, AML_COL.highRiskDest),
  }), [colNames, localTarget]);

  const effectiveTarget = localTarget || detectedCols.target || '';
  const currentLexicon = targetLexicon(effectiveTarget, viewMode);

  useEffect(() => {
    if (!localTarget && detectedCols.target) {
      setLocalTarget(detectedCols.target);
    }
  }, [localTarget, detectedCols.target]);

  if (!masterDs) {
    return (
      <Box sx={{ p:3 }}>
        <Alert severity="warning" sx={{ borderRadius:2, mb:2 }}>
          <Typography fontWeight={700} sx={{ mb:0.5 }}>Master Dataset Not Built Yet</Typography>
          <Typography variant="body2">
            {viewMode==='business'
              ? 'Go back to Step 2 (Combine Tables) and build the master dataset before exploring your data.'
              : 'EDA operates on the merged master_dataset. Complete Step 2 first - this joins alerts <- transactions <- accounts <- customers into a single analysis table.'}
          </Typography>
        </Alert>
        {datasets.length>0 && (
          <Typography variant="caption" color="text.secondary">
            {datasets.length} raw table{datasets.length>1?'s':''} uploaded: {datasets.map(d=>d.dataset_type).join(', ')}
          </Typography>
        )}
      </Box>
    );
  }

  const tabProps = { ds:masterDs, persona:viewMode, targetColumn:effectiveTarget, colTypes, detectedCols };
  const activeTab = TABS.find(t=>t.id===tab);

  return (
    <Box sx={{ display:'flex', flexDirection:'column', minHeight:'100%', gap:0, overflow:'visible' }}>

      {/* Mixed-case warning */}
      <Collapse in={!compactHeader}>
      <Alert severity="info" sx={{ mb:1.1, borderRadius:1.25, bgcolor:'#fff', border:`1px solid ${D.border}`, flexShrink:0 }}
        icon={<Warning sx={{ color:D.warn }} />}
        action={(
          <Button size="small" onClick={()=>setShowQualityNote(s=>!s)} sx={{ textTransform:'none', color:D.textSec }}>
            {showQualityNote ? 'Hide details' : 'What is this?'}
          </Button>
        )}>
        <Typography variant="body2" fontWeight={600} sx={{ color:D.textPri, mb:0.25 }}>
          Data quality note: mixed-case text values detected
        </Typography>
        <Collapse in={showQualityNote}>
          <Typography variant="body2" sx={{ color:D.textSec, fontSize:12 }}>
            Mixed casing in raw text fields is normalized during preprocessing. No manual action is required here.
          </Typography>
        </Collapse>
      </Alert>
      </Collapse>

      {/* Control bar */}
      <Paper variant="outlined" sx={{ px:1.5, py:1, borderRadius:1.25, mb:1.0, flexShrink:0,
        display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap', bgcolor:'#fff', boxShadow:'none' }}>

        {/* Dataset badge */}
        <Box sx={{ display:'flex', alignItems:'center', gap:1.5,
          px:2, py:1, bgcolor:'#f0fdf4', borderRadius:1.5, border:`1px solid ${D.okBorder}` }}>
          <TableChart sx={{ fontSize:16, color:D.ok }} />
          <Box>
            <Typography variant="caption" sx={{ color:D.ok, fontWeight:700, fontSize:11, display:'block' }}>
              master_dataset (Step 2 output)
            </Typography>
            <Typography variant="caption" sx={{ color:'#166534', fontSize:10 }}>
              {fmt(masterDs.row_count)} rows | {fmt(colNames.length)} cols
            </Typography>
          </Box>
          <Chip label="EDA source" size="small" sx={{ height:18, fontSize:9, bgcolor:'#dcfce7', color:'#166534' }} />
        </Box>

        {/* Target selector */}
        <FormControl size="small" sx={{ minWidth:200 }}>
          <InputLabel sx={{ fontSize:12 }}>
            {viewMode==='business' ? 'Prediction target' : 'Target column'}
          </InputLabel>
          <Select value={localTarget} displayEmpty
            label={viewMode==='business' ? 'Prediction target' : 'Target column'}
            onChange={e=>setLocalTarget(e.target.value)} sx={{ fontSize:13 }}>
            <MenuItem value=""><em style={{ color:'#94a3b8', fontSize:12 }}>None - unsupervised EDA</em></MenuItem>
            {colNames.filter(c=>!isIdCol(c)).map(c=>(
              <MenuItem key={c} value={c}><span style={{ fontFamily:'monospace', fontSize:12 }}>{c}</span></MenuItem>
            ))}
          </Select>
        </FormControl>

        {effectiveTarget && (
          <Chip
            size="small"
            label={viewMode==='business'
              ? `Optimising for ${currentLexicon.positiveShort}`
              : `Using target: ${effectiveTarget} (0 vs 1)`}
            sx={{ height:24, fontSize:11, bgcolor:'#f8fafc', color:D.textPri, border:`1px solid ${D.border}` }}
          />
        )}

        {/* Mode toggle */}
        <ToggleButtonGroup size="small" value={viewMode} exclusive
          onChange={(_,v)=>v&&setViewMode(v)}>
          <ToggleButton value="analyst" sx={{ px:2, fontSize:11, textTransform:'none', gap:0.5 }}>
            <QueryStats sx={{ fontSize:13 }} /> Analyst
          </ToggleButton>
          <ToggleButton value="business" sx={{ px:2, fontSize:11, textTransform:'none', gap:0.5 }}>
            <Business sx={{ fontSize:13 }} /> Business
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Stats */}
        <Stack direction="row" spacing={2.5} sx={{ ml:{ md:'auto' }, flexWrap:'wrap', rowGap:0.75 }}>
          {[
            { k:'Rows',    v:fmt(masterDs.row_count) },
            { k:'Columns', v:fmt(colNames.length) },
            { k:'Target',  v:viewMode==='business' && effectiveTarget ? currentLexicon.positiveShort : (effectiveTarget || 'not set') },
          ].map(({k,v})=>(
            <Box key={k} sx={{ textAlign:'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, display:'block' }}>{k}</Typography>
              <Typography sx={{ fontWeight:700, fontSize:13, fontFamily:k==='Target' && viewMode!=='business'?'monospace':'inherit',
                color:k==='Target'&&!effectiveTarget?'#94a3b8':'inherit' }}>{v}</Typography>
            </Box>
          ))}
        </Stack>
        <Button
          size="small"
          variant={edaDone ? 'contained' : 'outlined'}
          color={edaDone ? 'success' : 'primary'}
          startIcon={<CheckCircle sx={{ fontSize: 14 }} />}
          onClick={() => onEdaDone?.()}
          sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
        >
          {edaDone ? 'EDA Complete' : 'Complete EDA and Continue'}
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={() => setCompactHeader((v) => !v)}
          sx={{ textTransform: 'none', fontSize: 11, color: D.textSec }}
        >
          {compactHeader ? 'Show details' : 'Compact view'}
        </Button>
      </Paper>

      {/* Business mode: show summary banner */}
      {viewMode==='business' && !compactHeader && (
        <Box sx={{ mb:1.15, p:1.35, borderRadius:1.25, bgcolor:'#fff', border:`1px solid ${D.border}`, borderLeft:`3px solid ${D.orange}`, flexShrink:0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Business sx={{ color:D.orange, fontSize:18 }} />
            <Box>
              <Typography sx={{ fontWeight:700, fontSize:13, color:D.textPri }}>Business View Active</Typography>
              <Typography sx={{ fontSize:12, color:D.textSec }}>
                Each chart includes a plain-English explanation of what it means and what you should do.
                Switch to Analyst Mode for full technical detail.
              </Typography>
            </Box>
          </Stack>
        </Box>
      )}

      {!compactHeader && (
        <Box sx={{ mb:1.15, p:1.2, borderRadius:1.25, bgcolor:'#fff', border:`1px solid ${D.border}`, flexShrink:0 }}>
          <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.7, textTransform:'uppercase', color:D.textSec, mb:0.35 }}>
            How EDA insights are generated
          </Typography>
          <Typography sx={{ fontSize:11.5, color:D.textSec, lineHeight:1.65 }}>
            Every insight starts from live chart facts, profile statistics, and target-response values from the current dataset. If a local LLM provider is configured, the app rewrites those grounded facts into clearer business language. If no provider is available, the screen still shows deterministic explanations built directly from the numbers.
          </Typography>
        </Box>
      )}

      {!compactHeader && (
        <Box sx={{ mb: 1.25, flexShrink: 0 }}>
          <TargetSemanticsNote targetColumn={effectiveTarget} compact />
        </Box>
      )}

      {/* Tab bar */}
      <Box sx={{ mb:1.25, flexShrink:0 }}>
        <Tabs
          value={tab}
          onChange={(_,v)=>setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          TabIndicatorProps={{ style:{ backgroundColor:D.orange, height:3 } }}
          sx={{
            minHeight:34,
            '& .MuiTabs-scrollButtons':{ color:D.textSec },
            '& .MuiTab-root':{
              minHeight:34, textTransform:'none', fontSize:11,
              color:D.textSec, px:1.25, py:0.5, borderRadius:1,
            },
            '& .MuiTab-root.Mui-selected':{ color:D.orange, fontWeight:700 },
          }}
        >
          {TABS.map(({ id, Icon, label, biz })=>(
            <Tab key={id} value={id}
              icon={<Icon sx={{ fontSize:13 }} />} iconPosition="start"
              label={viewMode==='business' ? biz : label} />
          ))}
        </Tabs>
      </Box>

      {/* Tab description */}
      {activeTab && !compactHeader && (
        <Box sx={{ p:0, mb:1.15, flexShrink:0, borderBottom:`1px solid ${D.border}`, pb:1 }}>
          <Typography sx={{ fontWeight:700, fontSize:12, color:D.textPri }}>
            {viewMode==='business' ? activeTab.biz : activeTab.label}
          </Typography>
          <Typography sx={{ fontSize:11, color:D.textSec, mt:0.25 }}>
            {viewMode==='business' ? activeTab.bizDesc : activeTab.desc}
          </Typography>
        </Box>
      )}

      {/* Tab content */}
      <Box sx={{ flex:1, minHeight:0, overflow:'visible', pb:2 }}>
        {tab==='dashboard'  && <DashboardTab {...tabProps} />}
        {tab==='imbalance'  && <AlertImbalanceTab {...tabProps} />}
        {tab==='riskscore'  && <RiskScoreTab {...tabProps} />}
        {tab==='rules'      && <RuleIntelligenceTab {...tabProps} />}
        {tab==='entity'     && <EntityRiskTab {...tabProps} />}
        {tab==='behaviour'  && <BehaviouralPatternsTab {...tabProps} />}
        {tab==='compliance' && <ComplianceEnrichmentTab {...tabProps} />}
        {tab==='columns'    && <ColumnExplorerTab {...tabProps} colNames={colNames} />}
        {tab==='quality'    && <QualityTab {...tabProps} />}
        {tab==='corr'       && <CorrelationTab {...tabProps} colNames={colNames} />}
        {tab==='drivers'    && <DriversTab {...tabProps} colNames={colNames} onTargetChange={setLocalTarget} />}
        {tab==='advanced'   && <AdvancedEDATab {...tabProps} colNames={colNames} />}
        {tab==='insights'   && <InsightsTab {...tabProps} />}
        {tab==='explorer'   && <ExplorerTab {...tabProps} colNames={colNames} colTypes={colTypes} />}
      </Box>
    </Box>
  );
};

// ============================================================================
// SHARED DATA HOOK - loads profile + quality + segments
// ============================================================================
function useEdaData(ds, targetCol, segCols=[]) {
  const [profile,  setProfile]  = useState(null);
  const [quality,  setQuality]  = useState(null);
  const [segments, setSegments] = useState({});
  const [classCounts, setClassCounts] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState(null);

  const load = useCallback(async () => {
    if (!ds) return;
    setLoading(true); setErr(null);
    try {
      const calls = [
        mlopsApi.profileMetadata({ dataset_id:ds.dataset_id, sample_rows:20000 }),
        mlopsApi.qualityScore({ dataset_id:ds.dataset_id, target_column:targetCol||'', sample_rows:10000 }),
      ];
      if (targetCol && segCols.length>0) {
        calls.push(segmentTargetApi({ dataset_id:ds.dataset_id, target_column:targetCol, columns:segCols, sample_rows:15000 }));
      }
      const res = await Promise.allSettled(calls);
      const prof = res[0].status==='fulfilled' ? (res[0].value?.data||res[0].value) : null;
      const qual = res[1].status==='fulfilled' ? (res[1].value?.data||res[1].value) : null;
      const seg  = res[2]?.status==='fulfilled' ? (res[2].value?.data||res[2].value) : null;
      setProfile(prof);
      setQuality(qual);
      setSegments(seg?.segments||{});
      setClassCounts(seg?.class_counts||null);
    } catch(e) { setErr(e?.message||'Failed to load data'); }
    finally { setLoading(false); }
  }, [ds?.dataset_id, targetCol, segCols.join(',')]);

  useEffect(()=>{ load(); }, [load]);
  return { profile, quality, segments, classCounts, loading, err, reload:load };
}

// ============================================================================
// TAB 1 - DASHBOARD (matches notebook 01_eda_dashboard.png exactly)
// ============================================================================
const DashboardTab = ({ ds, persona, targetColumn, colTypes, detectedCols }) => {
  const segCols = [
    detectedCols.riskScore, detectedCols.rule, detectedCols.riskRating,
    detectedCols.accountType, detectedCols.pep, detectedCols.sanction, detectedCols.adverse,
  ].filter(Boolean);

  const { profile, quality, segments, classCounts, loading, err, reload } = useEdaData(ds, targetColumn, segCols);

  if (loading) return <Spinner label="Building AML EDA dashboard..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  const colStats     = profile?.columns||{};
  const classCountsAll  = classCounts || profile?.class_counts || {};
  const qScore       = quality?.score??profile?.health_score??null;
  const lexicon = targetLexicon(targetColumn, persona);

  // Panel 1: class distribution
  const classData = (() => {
    const valueCounts = colStats[targetColumn]?.value_counts||[];
    const split = splitTargetCounts(classCountsAll, valueCounts);
    if (!split.negative&&!split.positive) {
      return valueCounts.slice(0,4).map(v=>({ label:String(v.value), count:v.count, pct:v.count/(ds.row_count||1), bucket:'other' }));
    }
    const tot = split.negative + split.positive;
    return [
      { label:lexicon.negative, count:split.negative, pct:tot?split.negative/tot:0, bucket:'negative' },
      { label:lexicon.positive, count:split.positive, pct:tot?split.positive/tot:0, bucket:'positive' },
    ];
  })();

  const riskHistData = segments[detectedCols.riskScore]?.bins||null;
  const ruleData     = [...asArray(segments[detectedCols.rule])].sort((a,b)=>b.count-a.count).slice(0,8);
  const ruleColIsProfile = /rule_risk_profile/i.test(String(detectedCols.rule || ''));
  const ratingData   = [...asArray(segments[detectedCols.riskRating])].sort((a,b)=>Number(a.label)-Number(b.label));
  const acctData     = [...asArray(segments[detectedCols.accountType])].sort((a,b)=>b.tp_rate-a.tp_rate).slice(0,14);
  const flagData     = (() => {
    const flags = [
      { col:detectedCols.pep,      label:'PEP Flag' },
      { col:detectedCols.sanction, label:'Sanction Hit' },
      { col:detectedCols.adverse,  label:'Adverse Media' },
    ].filter(f=>f.col&&segments[f.col]);
    if (!flags.length) return null;
    const un=[]; const fl=[];
    flags.forEach(({col,label})=>{
      const seg = asArray(segments[col]);
      un.push({ label, value:(seg.find(r=>r.label==='0'||r.label==='false')?.tp_rate??null) });
      fl.push({ label, value:(seg.find(r=>r.label==='1'||r.label==='true')?.tp_rate??null) });
    });
    return { unflagged:un, flagged:fl, flagNames:flags.map(f=>f.label) };
  })();
  const classInsight = buildTargetBreakdownInsight(classData, lexicon);
  const riskInsight = buildRiskHistogramInsight(riskHistData, lexicon);
  const ruleInsight = buildRuleVolumeInsight(ruleData, ruleColIsProfile);
  const ratingInsight = buildRiskTierInsight(ratingData);
  const accountInsight = buildAccountTypeInsight(acctData);
  const complianceInsight = buildComplianceFlagInsight(flagData);
  const classExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'prediction_target_breakdown',
    chartTitle: 'Prediction target breakdown',
    chartFocus: 'how records split between likely false positives and likely actionable alerts',
    targetColumn,
    lexicon,
    deterministicInsight: classInsight,
    facts: buildTargetBreakdownFacts(classData, lexicon),
    watchOut: 'If one class dominates the dataset, threshold setting and class weighting matter more than raw accuracy.',
  });
  const riskExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'risk_score_class_split',
    chartTitle: 'Risk score class split',
    chartFocus: 'how well the existing risk score separates the two outcome groups',
    targetColumn,
    lexicon,
    deterministicInsight: riskInsight,
    facts: buildRiskHistogramFacts(riskHistData, lexicon),
    watchOut: 'Heavy overlap means the current rule score alone will not separate noise from genuine alerts.',
  });
  const ruleExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'alerts_by_rule_profile',
    chartTitle: ruleColIsProfile ? 'Alerts by rule risk profile' : 'Alerts by rule',
    chartFocus: 'which rule groups create the largest alert volume',
    targetColumn,
    lexicon,
    deterministicInsight: ruleInsight,
    facts: buildRuleVolumeFacts(ruleData, ruleColIsProfile),
    watchOut: 'High alert volume alone does not prove a rule is weak. Pair this with conversion or precision before suppressing.',
  });
  const riskTierExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'customer_risk_tier',
    chartTitle: 'Customer risk tier vs outcome rate',
    chartFocus: 'how onboarding risk tier relates to the modeled alert outcome',
    targetColumn,
    lexicon,
    deterministicInsight: ratingInsight,
    facts: buildRiskTierFacts(ratingData),
    watchOut: 'Customer risk tier is often useful context, but it should not replace live transaction behavior.',
  });
  const accountExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'account_type_outcome_rate',
    chartTitle: 'Account type vs outcome rate',
    chartFocus: 'how account categories differ in their rate of actionable alerts',
    targetColumn,
    lexicon,
    deterministicInsight: accountInsight,
    facts: buildAccountTypeFacts(acctData, lexicon),
    watchOut: 'Large gaps by account type can help the model, but do not use type alone as a suppression rule.',
  });
  const complianceExplainPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'compliance_flag_outcome_rate',
    chartTitle: 'Compliance flags vs outcome rate',
    chartFocus: 'how PEP, sanctions, and adverse media flags change the modeled alert outcome',
    targetColumn,
    lexicon,
    deterministicInsight: complianceInsight,
    facts: buildComplianceFacts(flagData, lexicon),
    watchOut: 'Flags can be strong signals, but over-relying on them can hide useful behavioral evidence.',
  });

  const ratingGradient = (label) => {
    const n=Number(label); if(isNaN(n)) return D.info;
    const t=(n-1)/9;
    return `rgb(${Math.round(34+t*221)},${Math.round(197-t*175)},34)`;
  };

  return (
    <Stack spacing={2.5}>

      {/* Top stat row */}
      <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:1.5 }}>
        <StatCell label="Total Rows"     value={fmt(ds.row_count)} />
        <StatCell label="Columns"        value={fmt((ds.columns||[]).length)} />
        <StatCell label="Missing Data"
          value={fmtPct((quality?.missing_rate??0)*100)}
          warn={(quality?.missing_rate??0)>0.1}
          ok={(quality?.missing_rate??1)===0} />
        <StatCell label="Duplicate Rows"
          value={fmt(quality?.duplicate_count??0)}
          warn={(quality?.duplicate_count??0)>0}
          ok={(quality?.duplicate_count??1)===0} />
        {targetColumn&&classData[0]&&(
          <StatCell label={lexicon.negativeMetric} value={fmt(classData[0]?.count)} sub={fmtPct(classData[0]?.pct*100)} />
        )}
        {targetColumn&&classData[1]&&(
          <StatCell label={lexicon.positiveMetric} value={fmt(classData[1]?.count)} sub={fmtPct(classData[1]?.pct*100)} ok />
        )}
        {qScore!=null&&(
          <Box sx={{ p:1.5, borderRadius:1.5,
            bgcolor: qScore>=80?D.okLight:qScore>=60?D.warnLight:D.dangerLight,
            border:`1px solid ${qColor(qScore)}40`,
            display:'flex', alignItems:'center', gap:1.5 }}>
            <Box sx={{ position:'relative', flexShrink:0 }}>
              <CircularProgress variant="determinate" value={qScore} size={50}
                sx={{ color:qColor(qScore), '& .MuiCircularProgress-circle':{ strokeLinecap:'round' } }} />
              <Box sx={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Typography sx={{ fontWeight:900, fontSize:12, color:qColor(qScore) }}>{Math.round(qScore)}</Typography>
              </Box>
            </Box>
            <Box>
              <Typography sx={{ fontWeight:700, fontSize:12 }}>Quality Score</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize:10 }}>
                {qScore>=80?'Model-ready':qScore>=60?'Needs review':'Action required'}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {!targetColumn&&(
        <Alert severity="info" sx={{ borderRadius:2, py:0.5 }}>
          Select a <strong>target column</strong> (for example FINAL_LABEL or IS_TRUE_POS) above to unlock AML-specific charts: class distribution,
          risk score separation, rule analysis, and compliance flag analysis.
        </Alert>
      )}

      {/* AML Dashboard Grid - 2x3 matching notebook output */}
      {targetColumn&&(
        <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'repeat(2,minmax(0,1fr))', xl:'repeat(3,minmax(0,1fr))' }, gap:1.75 }}>

          {/* P1 - Target class distribution */}
          <Card>
            <SectionLabel icon={BarChartIcon}>
              {persona==='business' ? 'Prediction target breakdown' : 'Target class distribution'}
            </SectionLabel>
            {classData.length>0 ? (
              <>
                <DrilldownFrame
                  title={persona==='business' ? 'Prediction target breakdown' : `Class distribution for ${targetColumn}`}
                  persona={persona}
                  analysisPayload={classExplainPayload}
                  explain={persona==='business'
                    ? `This chart shows how records split between ${lexicon.negativeShort} and ${lexicon.positiveShort}.`
                    : `This chart shows how records split across ${targetColumn}. It tells you whether class 0 or class 1 dominates the dataset.`}
                >
                  <Box>
                    <ResponsiveContainer width="100%" height={185}>
                      <BarChart data={classData} margin={{ top:22,right:8,bottom:18,left:-10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis dataKey="label" tick={{ fontSize:9 }} />
                        <YAxis tick={{ fontSize:10 }} tickFormatter={fmt} />
                        <RTooltip formatter={v=>[fmt(v),'Count']}
                          labelFormatter={(_,p)=>p?.[0]?`${p[0].payload.label} - ${fmtPct(p[0].payload.pct*100)}`:''}/>
                        <Bar dataKey="count" radius={[4,4,0,0]}
                          label={{ position:'top', fontSize:9, formatter:v=>fmt(v) }}>
                          {classData.map((d,i)=><Cell key={i} fill={d.bucket==='negative' ? D.chartFP : d.bucket==='positive' ? D.chartTP : D.chart[i%D.chart.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <Stack direction="row" spacing={0.75} justifyContent="center" flexWrap="wrap" sx={{ mt:0.5 }}>
                      {classData.map((d,i)=>(
                        <Chip key={i} size="small" label={`${d.label}: ${fmtPct(d.pct*100)}`}
                          sx={{
                            fontSize:9,
                            bgcolor:d.bucket==='negative' ? '#dbeafe' : d.bucket==='positive' ? '#fed7aa' : '#e2e8f0',
                            color:d.bucket==='negative' ? '#1e40af' : d.bucket==='positive' ? '#9a3412' : '#334155',
                          }} />
                      ))}
                    </Stack>
                  </Box>
                </DrilldownFrame>
                {persona==='business' && classInsight && (
                  <InsightPanel
                    what={classInsight.what}
                    why={classInsight.why}
                    action={classInsight.action}
                    severity={classInsight.severity}
                  />
                )}
              </>
            ) : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">Loading class distribution...</Typography>
              </Box>
            )}
          </Card>

          {/* P2 - Risk score distribution by label */}
          <Card>
            <SectionLabel icon={Speed}>
              {detectedCols.riskScore
                ? (persona==='business' ? 'Risk score - class split' : `${detectedCols.riskScore} by target class`)
                : 'Risk score distribution by label'}
            </SectionLabel>
            {riskHistData ? (
              <>
                <DrilldownFrame
                  title={persona==='business' ? 'Risk score class split' : `${detectedCols.riskScore || 'risk_score'} by ${targetColumn}`}
                  persona={persona}
                  analysisPayload={riskExplainPayload}
                  explain={`This compares risk-score distributions for ${lexicon.negativeShort} and ${lexicon.positiveShort}. More separation means better discrimination.`}
                >
                  <ResponsiveContainer width="100%" height={185}>
                    <ComposedChart data={riskHistData} margin={{ top:8,right:8,bottom:18,left:-10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="bin_start" tick={{ fontSize:9 }} tickFormatter={v=>Number(v).toFixed(0)} />
                      <YAxis tick={{ fontSize:10 }} />
                      <RTooltip formatter={(v,n)=>[fmt(v),classNameFromSeries(n, lexicon)]} />
                      <Legend iconSize={9} wrapperStyle={{ fontSize:10 }}
                        formatter={v=>classNameFromSeries(v, lexicon)} />
                      <Bar dataKey="fp_count" fill={D.chartFP} opacity={0.65} radius={[2,2,0,0]} />
                      <Bar dataKey="tp_count" fill={D.chartTP} opacity={0.65} radius={[2,2,0,0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                {persona==='business' && riskInsight && (
                  <InsightPanel
                    what={riskInsight.what}
                    why={riskInsight.why}
                    action={riskInsight.action}
                    severity={riskInsight.severity}
                  />
                )}
              </>
            ) : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">Loading risk score distribution...</Typography>
              </Box>
            )}
          </Card>

          {/* P3 - Alerts by rule / risk profile */}
          <Card>
            <SectionLabel icon={Rule}>
              {ruleColIsProfile
                ? (persona==='business' ? 'Alerts by rule risk profile' : 'Alert volume by rule risk profile')
                : (persona==='business' ? 'Alerts by rule triggered' : 'Alert volume by rule')}
            </SectionLabel>
            {ruleData.length>0 ? (
              <>
                <DrilldownFrame
                  title={ruleColIsProfile ? 'Alerts by rule risk profile' : 'Alerts by rule volume'}
                  persona={persona}
                  analysisPayload={ruleExplainPayload}
                  explain="This chart ranks top rule groups by alert volume so you can target high-impact suppression opportunities first."
                >
                  <ResponsiveContainer width="100%" height={185}>
                    <BarChart data={ruleData} layout="vertical" margin={{ top:4,right:16,bottom:4,left:80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={75} />
                      <RTooltip formatter={v=>[fmt(v),'Alerts']} />
                      <Bar dataKey="count" fill={D.orange} radius={[0,3,3,0]}>
                        {ruleData.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                {persona==='business' && ruleInsight && (
                  <InsightPanel
                    what={ruleInsight.what}
                    why={ruleInsight.why}
                    action={ruleInsight.action}
                    severity={ruleInsight.severity}
                  />
                )}
              </>
            ) : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">
                  {ruleColIsProfile ? 'Loading rule risk profile data...' : 'Loading rule data...'}
                </Typography>
              </Box>
            )}
          </Card>

          {/* P4 - TP rate by customer risk rating */}
          <Card>
            <SectionLabel icon={TrendingUp}>
              {persona==='business' ? 'STR rate by customer risk tier' : `Positive class rate by customer risk rating (${targetColumn})`}
            </SectionLabel>
            {ratingData.length>0 ? (
              <>
                <DrilldownFrame
                  title={persona==='business' ? 'Customer risk tier vs outcome rate' : 'Customer risk tier vs target rate'}
                  persona={persona}
                  analysisPayload={riskTierExplainPayload}
                  explain={`This shows how ${lexicon.positiveShort} rate changes across customer risk ratings.`}
                >
                  <ResponsiveContainer width="100%" height={185}>
                    <BarChart data={ratingData} margin={{ top:8,right:8,bottom:18,left:-10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="label" tick={{ fontSize:10 }} label={{ value:'Risk Rating (1=Low, 10=High)', position:'insideBottom', offset:-12, fontSize:9 }} />
                      <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                      <RTooltip formatter={v=>[`${fmtF(v)}%`,`${lexicon.positiveShort} rate`]} />
                      <Bar dataKey="tp_rate" radius={[3,3,0,0]}>
                        {ratingData.map((d,i)=><Cell key={i} fill={ratingGradient(d.label)}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                {persona==='business' && ratingInsight && (
                  <InsightPanel
                    what={ratingInsight.what}
                    why={ratingInsight.why}
                    action={ratingInsight.action}
                    severity={ratingInsight.severity}
                  />
                )}
              </>
            ) : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">No risk rating column detected.</Typography>
              </Box>
            )}
          </Card>

          {/* P5 - TP rate by account type */}
          <Card>
            <SectionLabel icon={AccountTree}>
              {persona==='business' ? 'STR rate by account type' : `Positive class rate by account type (${targetColumn})`}
            </SectionLabel>
            {acctData.length>0 ? (
              <>
                <DrilldownFrame
                  title={persona==='business' ? 'Account type vs outcome rate' : 'Account type vs target rate'}
                  persona={persona}
                  analysisPayload={accountExplainPayload}
                  explain={`This compares ${lexicon.positiveShort} rate by account type.`}
                >
                  <ResponsiveContainer width="100%" height={185}>
                    <BarChart data={acctData} layout="vertical" margin={{ top:4,right:16,bottom:4,left:70 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={65} />
                      <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}% (n=${fmt(p.payload.count)})`,`${lexicon.positiveShort} rate`]} />
                      <Bar dataKey="tp_rate" radius={[0,3,3,0]} fill={D.chartFP} />
                    </BarChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                {persona==='business' && accountInsight && (
                  <InsightPanel
                    what={accountInsight.what}
                    why={accountInsight.why}
                    action={accountInsight.action}
                    severity={accountInsight.severity}
                  />
                )}
              </>
            ) : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">No account type column detected.</Typography>
              </Box>
            )}
          </Card>

          {/* P6 - TP rate by compliance flags */}
          <Card>
            <SectionLabel icon={Security}>
              {persona==='business' ? 'STR rate by compliance flags' : `Positive class rate by customer risk flags (${targetColumn})`}
            </SectionLabel>
            {flagData ? (()=>{
              const barData=[
                { group:'No Flag (0)', ...Object.fromEntries(flagData.unflagged.map(f=>[f.label,f.value])) },
                { group:'Flagged (1)', ...Object.fromEntries(flagData.flagged.map(f=>[f.label,f.value])) },
              ];
              return (
                <>
                  <DrilldownFrame
                    title={persona==='business' ? 'Compliance flags vs outcome rate' : 'Compliance flags vs target rate'}
                    persona={persona}
                    analysisPayload={complianceExplainPayload}
                    explain={`This compares ${lexicon.positiveShort} rate for flagged versus non-flagged populations.`}
                  >
                    <ResponsiveContainer width="100%" height={185}>
                      <BarChart data={barData} margin={{ top:8,right:8,bottom:18,left:-10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis dataKey="group" tick={{ fontSize:10 }} />
                        <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                        <RTooltip formatter={v=>[`${v!=null?v.toFixed(1):'-'}%`,`${lexicon.positiveShort} rate`]} />
                        <Legend iconSize={9} wrapperStyle={{ fontSize:10 }} />
                        {flagData.flagNames.map((name,i)=>(
                          <Bar key={name} dataKey={name} fill={D.chart[i%D.chart.length]} radius={[3,3,0,0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </DrilldownFrame>
                  {persona==='business' && complianceInsight && (
                    <InsightPanel
                      what={complianceInsight.what}
                      why={complianceInsight.why}
                      action={complianceInsight.action}
                      severity={complianceInsight.severity}
                    />
                  )}
                </>
              );
            })() : (
              <Box sx={{ py:3,textAlign:'center' }}>
                <Typography variant="caption" color="text.secondary">
                  No risk flag columns detected (expected: pep_flag, sanction_hit, adverse_media_flag)
                </Typography>
              </Box>
            )}
          </Card>

        </Box>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 2 - ALERT IMBALANCE & LABEL HEALTH
// ============================================================================
const AlertImbalanceTab = ({ ds, persona, targetColumn, detectedCols }) => {
  const segCols = [detectedCols.alertDate, detectedCols.rule, targetColumn].filter(Boolean);
  const { profile, quality, segments, classCounts, loading, err, reload } = useEdaData(ds, targetColumn, segCols);
  const [trendData, setTrendData] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState('');
  const [trendReason, setTrendReason] = useState('');

  useEffect(() => {
    let alive = true;
    if (!ds?.dataset_id || !targetColumn) {
      setTrendData([]);
      setTrendLoading(false);
      setTrendError('');
      setTrendReason('Select a dataset and target to run the alert trend.');
      return () => { alive = false; };
    }
    if (!detectedCols.alertDate) {
      setTrendData([]);
      setTrendLoading(false);
      setTrendError('');
      setTrendReason('No date column detected for trend analysis. Add a transaction/alert timestamp to master dataset.');
      return () => { alive = false; };
    }
    setTrendLoading(true);
    setTrendError('');
    setTrendReason('');
    mlopsApi.timeTrend({
      dataset_id: ds.dataset_id,
      date_col: detectedCols.alertDate,
      target_column: targetColumn,
      freq: 'W',
      sample_rows: 25000,
    })
      .then((res) => {
        if (!alive) return;
        const payload = res?.data || res || {};
        const trend = Array.isArray(payload.trend) ? payload.trend : [];
        setTrendData(trend);
        if (!trend.length) {
          setTrendReason(payload?.reason || 'No data available for the selected date column and sample window.');
        }
      })
      .catch((e) => {
        if (!alive) return;
        setTrendData([]);
        setTrendError(e?.message || 'Trend request failed');
      });
    return () => { alive = false; };
  }, [detectedCols.alertDate, ds?.dataset_id, targetColumn]);

  useEffect(() => {
    if (!trendLoading) return;
    if (trendData.length || trendError || trendReason) setTrendLoading(false);
  }, [trendData.length, trendError, trendLoading, trendReason]);

  if (loading) return <Spinner label="Analysing alert imbalance..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  const combinedCounts = classCounts || profile?.class_counts || {};
  const colStats = profile?.columns||{};
  const vc = targetColumn ? (colStats[targetColumn]?.value_counts||[]) : [];
  const lexicon = targetLexicon(targetColumn, persona);

  const split = splitTargetCounts(combinedCounts, vc);
  let fp = split.negative;
  let tp = split.positive;

  const totalFromVC = vc.reduce((s,v)=>s+(v.count||0),0);
  const total = (fp+tp)||totalFromVC||1;
  const fpRate = fp/total;
  const tpRate = tp/total;
  const suppressOpp = fpRate>0.7 ? 'High - significant cost savings possible' : fpRate>0.5 ? 'Moderate' : 'Low';

  return (
    <Stack spacing={2.5}>
      {/* Section header */}
      <Card highlight>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>
              Alert Imbalance & Label Health
            </Typography>
            <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
              {persona==='business'
                ? `Understanding the ${targetColumn} split between lower-value and higher-value outcomes - foundation for suppression strategy`
                : 'Class balance analysis, imbalance ratio, suppression opportunity sizing, and label quality assessment'}
            </Typography>
          </Box>
          <Button size="small" onClick={reload} startIcon={<Refresh sx={{ fontSize:14 }} />}
            sx={{ textTransform:'none', borderColor:D.border, color:D.textSec }} variant="outlined">
            Refresh
          </Button>
        </Stack>
      </Card>

      {!targetColumn&&(
        <Alert severity="warning">Set a target column above to see imbalance analysis.</Alert>
      )}

      {targetColumn&&(
        <>
          {/* Key metrics */}
          <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:1.5 }}>
            <StatCell label="Total Alerts"       value={fmt(total)} />
            <StatCell label={lexicon.negativeMetric} value={fmt(fp)} sub={fmtPct(fpRate*100)} />
            <StatCell label={lexicon.positiveMetric} value={fmt(tp)} sub={fmtPct(tpRate*100)} ok />
            <StatCell label="Imbalance Ratio"    value={`${Math.round(fp/(tp||1))}:1`} warn={fpRate>0.8} />
            <StatCell label="Suppression Opportunity" value={suppressOpp} ok={fpRate>0.7} warn={fpRate>0.5&&fpRate<=0.7} />
          </Box>

          {persona==='business'&&(
            <InsightPanel
              what={`${fmtPct(fpRate*100)} of records are in ${lexicon.negativeShort}`}
              why={`With ${fmt(fp)} records in ${lexicon.negativeShort}, investigators review ${Math.round(fp/(tp||1))} low-value alerts for every high-value one. This is the core suppression opportunity.`}
              action={`If the model achieves ${fmtPct(fpRate*80)} suppression rate, analysts will only review ~${fmt(Math.round(tp*1.3))} alerts instead of ${fmt(total)}.`}
              severity={fpRate>0.85?'danger':fpRate>0.7?'warning':'info'}
            />
          )}

          {/* Class distribution bar chart */}
          <Box sx={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:2 }}>
            <Card>
              <SectionLabel icon={BarChartIcon}>Class distribution</SectionLabel>
              <DrilldownFrame
                title={`Imbalance breakdown for ${targetColumn}`}
                persona={persona}
                explain={`This chart compares ${lexicon.negativeShort} and ${lexicon.positiveShort} counts for ${targetColumn}.`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[
                    { label:`${lexicon.negativeShort}\n(0)`, count:fp, pct:fpRate*100 },
                    { label:`${lexicon.positiveShort}\n(1)`, count:tp, pct:tpRate*100 },
                  ]} margin={{ top:24,right:10,bottom:20,left:-5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                    <XAxis dataKey="label" tick={{ fontSize:10 }} />
                    <YAxis tick={{ fontSize:10 }} tickFormatter={fmt} />
                    <RTooltip formatter={v=>[fmt(v),'Count']} />
                    <Bar dataKey="count" radius={[4,4,0,0]}
                      label={{ position:'top', fontSize:11, formatter:v=>`${fmt(v)}` }}>
                      <Cell fill={D.chartFP} /><Cell fill={D.chartTP} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </DrilldownFrame>
              {persona==='technical'&&(
                <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, mt:1, display:'block' }}>
                  Imbalance ratio {Math.round(fp/(tp||1))}:1 - use class_weight="balanced" or SMOTE in preprocessing
                </Typography>
              )}
            </Card>

            {/* Donut */}
            <Card>
              <SectionLabel icon={PieChartIcon}>Proportional split</SectionLabel>
              <DrilldownFrame
                title={`Proportional split for ${targetColumn}`}
                persona={persona}
                explain="This donut view highlights the share of class 0 versus class 1 records."
              >
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={[{ name:lexicon.negativeShort, value:fp },{ name:lexicon.positiveShort, value:tp }]}
                      cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                      paddingAngle={3} dataKey="value">
                      <Cell fill={D.chartFP}/><Cell fill={D.chartTP}/>
                    </Pie>
                    <RTooltip formatter={(v,n)=>[fmt(v),n]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize:11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </DrilldownFrame>
            </Card>
          </Box>

          {/* STR over time */}
          <Card>
            <SectionLabel icon={Timeline}>
              {persona==='business' ? 'STR rate over time (trend)' : 'Alert volume & TP rate trend (time-series)'}
            </SectionLabel>
            {trendLoading && <Spinner label="Loading trend analysis..." />}
            {!trendLoading && trendError && (
              <ErrBox msg={trendError} onRetry={reload} />
            )}
            {!trendLoading && !trendError && trendData.length > 0 && (
              <>
                <DrilldownFrame
                  title={`${targetColumn} trend over time`}
                  persona={persona}
                  explain="This trend combines alert volume with positive-class rate over time to spot drift and operational shifts."
                >
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={trendData} margin={{ top:8,right:16,bottom:18,left:-5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="period" tick={{ fontSize:9 }} />
                      <YAxis yAxisId="left" tick={{ fontSize:10 }} tickFormatter={fmt} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                      <RTooltip />
                      <Legend iconSize={9} wrapperStyle={{ fontSize:10 }} />
                      <Bar yAxisId="left" dataKey="count" name="Alert Volume" fill={D.chartFP} opacity={0.5} radius={[2,2,0,0]} />
                      <Line yAxisId="right" dataKey="tp_rate" name={`${lexicon.positiveShort} Rate %`} type="monotone" stroke={D.chartTP} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                <Typography sx={{ mt: 1, fontSize: 11, color: D.textSec }}>
                  X-axis: weekly period from <strong>{detectedCols.alertDate}</strong>. Left Y-axis: alert volume. Right Y-axis: positive-class rate for <strong>{targetColumn}</strong>.
                </Typography>
              </>
            )}
            {!trendLoading && !trendError && trendData.length === 0 && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                {trendReason || 'No data available for trend analysis.'}
              </Alert>
            )}
            {persona==='business'&&(
              <InsightPanel
                what="Alert volume and STR rate should be tracked over time"
                why="A rising STR rate is a sign of improving model performance. Falling alert volume with stable STR rate means the model is effectively suppressing noise."
                action="Monitor this chart monthly post-deployment as part of your performance review."
                severity="info"
              />
            )}
          </Card>

          {/* Analyst-mode: imbalance details */}
          {persona==='technical'&&(
            <Card>
              <SectionLabel>Imbalance diagnostics</SectionLabel>
              <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'repeat(2,minmax(0,1fr))', xl:'repeat(3,minmax(0,1fr))' }, gap:1.5 }}>
                {[
                  { k:'Majority class', v:`${lexicon.negativeShort} (${fmtPct(fpRate*100)})` },
                  { k:'Minority class', v:`${lexicon.positiveShort} (${fmtPct(tpRate*100)})` },
                  { k:'Imbalance ratio', v:`${Math.round(fp/(tp||1))}:1` },
                  { k:'Recommended handling', v:fpRate>0.9?'SMOTE + class_weight':fpRate>0.7?'class_weight="balanced"':'No special handling needed' },
                  { k:'Suppression opportunity', v:suppressOpp },
                  { k:'Min event rate for model', v:tpRate>0.03?'Sufficient (>3%)':'Low - model may struggle' },
                ].map(({k,v})=>(
                  <Box key={k} sx={{ p:1.5, bgcolor:'#f8fafc', borderRadius:1.5, border:`1px solid ${D.border}` }}>
                    <Typography sx={{ fontSize:10, color:D.textSec, mb:0.25 }}>{k}</Typography>
                    <Typography sx={{ fontWeight:600, fontSize:12 }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          )}
        </>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 3 - RISK SCORE BEHAVIOUR
// ============================================================================
const RiskScoreTab = ({ ds, persona, targetColumn, detectedCols }) => {
  const segCols = [detectedCols.riskScore].filter(Boolean);
  const { segments, loading, err, reload } = useEdaData(ds, targetColumn, segCols);
  const lexicon = targetLexicon(targetColumn, persona);

  // Compute KS statistic from histograms
  const scoreData = detectedCols.riskScore ? (segments[detectedCols.riskScore]?.bins||[]) : [];
  const ksScore = useMemo(()=>{
    if (!scoreData.length) return null;
    let cumFP=0, cumTP=0;
    const totalFP = scoreData.reduce((s,b)=>s+(b.fp_count||0),0)||1;
    const totalTP = scoreData.reduce((s,b)=>s+(b.tp_count||0),0)||1;
    let maxKS=0;
    for (const b of scoreData) {
      cumFP += (b.fp_count||0)/totalFP;
      cumTP += (b.tp_count||0)/totalTP;
      maxKS = Math.max(maxKS, Math.abs(cumTP-cumFP));
    }
    return maxKS;
  }, [scoreData]);

  const ksQuality = ksScore!=null ? (ksScore>0.4?'Excellent':ksScore>0.25?'Good':ksScore>0.1?'Moderate':'Poor') : null;

  // Cumulative KS curve data
  const ksData = useMemo(()=>{
    if (!scoreData.length) return [];
    let cumFP=0, cumTP=0;
    const totalFP = scoreData.reduce((s,b)=>s+(b.fp_count||0),0)||1;
    const totalTP = scoreData.reduce((s,b)=>s+(b.tp_count||0),0)||1;
    return scoreData.map(b=>{
      cumFP += (b.fp_count||0)/totalFP;
      cumTP += (b.tp_count||0)/totalTP;
      return { score:b.bin_start, cumFP:+(cumFP*100).toFixed(1), cumTP:+(cumTP*100).toFixed(1), ks:+(Math.abs(cumTP-cumFP)*100).toFixed(1) };
    });
  }, [scoreData]);

  if (loading) return <Spinner label="Analysing risk score behaviour..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Risk Score Behaviour Analysis</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? `How well does the existing risk score separate ${lexicon.positiveShort} from ${lexicon.negativeShort}?`
            : 'KS statistic, score separation, cumulative distribution curves, and score drift analysis'}
        </Typography>
      </Card>

      {!detectedCols.riskScore&&(
        <Alert severity="info">No risk score column detected. Expected columns: risk_score, score, alert_score</Alert>
      )}

      {detectedCols.riskScore&&(
        <>
          {/* KS metrics */}
          <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:1.5 }}>
            <StatCell label="Risk Score Column" value={detectedCols.riskScore} />
            {ksScore!=null&&(
              <>
                <StatCell label="KS Statistic"
                  value={fmtPct(ksScore*100)}
                  ok={ksScore>0.4} warn={ksScore>0.25&&ksScore<=0.4} danger={ksScore<=0.1} />
                <StatCell label="Separation Quality"
                  value={ksQuality}
                  ok={ksQuality==='Excellent'||ksQuality==='Good'}
                  warn={ksQuality==='Moderate'} danger={ksQuality==='Poor'} />
              </>
            )}
            <StatCell label="Data Points" value={fmt(scoreData.reduce((s,b)=>s+(b.fp_count||0)+(b.tp_count||0),0))} />
          </Box>

          {persona==='business'&&ksScore!=null&&(
            <InsightPanel
              what={`The risk score has ${ksQuality} separation ability (KS = ${fmtPct(ksScore*100)})`}
              why={ksScore>0.35
                ? "Clear separation suggests the existing risk score is a strong predictor. The ML model will amplify this."
                : "Weak separation means the risk score alone cannot distinguish real alerts. The ML model must use other features."}
              action={ksScore>0.35
                ? "Include risk_score as a top feature in the ML model."
                : "Do not rely on risk score alone. Enrich with customer and behavioural features."}
              severity={ksScore>0.35?'success':ksScore>0.15?'warning':'danger'}
            />
          )}

          {/* Overlapping histogram */}
          {scoreData.length>0&&(
            <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
              <Card>
                <SectionLabel icon={BarChartIcon}>
                  {persona==='business' ? 'Risk score distribution - real alerts vs noise' : 'Risk score histogram by class'}
                </SectionLabel>
                <DrilldownFrame
                  title={`${detectedCols.riskScore || 'risk_score'} distribution by ${targetColumn}`}
                  persona={persona}
                  explain={`This histogram compares ${lexicon.negativeShort} and ${lexicon.positiveShort} across risk-score bands.`}
                >
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={scoreData} margin={{ top:8,right:8,bottom:18,left:-5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="bin_start" tick={{ fontSize:9 }} tickFormatter={v=>Number(v).toFixed(0)} />
                      <YAxis tick={{ fontSize:10 }} />
                      <RTooltip formatter={(v,n)=>[fmt(v),classNameFromSeries(n, lexicon)]} />
                      <Legend iconSize={9} wrapperStyle={{ fontSize:10 }}
                        formatter={v=>classNameFromSeries(v, lexicon)} />
                      <Bar dataKey="fp_count" fill={D.chartFP} opacity={0.6} radius={[2,2,0,0]} />
                      <Bar dataKey="tp_count" fill={D.chartTP} opacity={0.7} radius={[2,2,0,0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
              </Card>

              {/* KS Curve */}
              {ksData.length>0&&(
                <Card>
                  <SectionLabel icon={AutoGraph}>
                    {persona==='business' ? 'Cumulative separation curve (KS)' : 'KS curve - cumulative FP vs TP distribution'}
                  </SectionLabel>
                  <DrilldownFrame
                    title={`KS curve for ${targetColumn}`}
                    persona={persona}
                    explain={`The distance between cumulative ${lexicon.negativeShort} and ${lexicon.positiveShort} curves is the KS signal.`}
                  >
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={ksData} margin={{ top:8,right:16,bottom:18,left:-5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis dataKey="score" tick={{ fontSize:9 }} tickFormatter={v=>Number(v).toFixed(0)} />
                        <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                        <RTooltip formatter={(v,n)=>[`${v}%`,n==='cumFP'?`Cum. ${lexicon.negativeShort}`:n==='cumTP'?`Cum. ${lexicon.positiveShort}`:'KS Gap']} />
                        <Legend iconSize={9} wrapperStyle={{ fontSize:10 }} />
                        <Line dataKey="cumFP" name={`Cum. ${lexicon.negativeShort}`} stroke={D.chartFP} strokeWidth={2} dot={false} />
                        <Line dataKey="cumTP" name={`Cum. ${lexicon.positiveShort}`} stroke={D.chartTP} strokeWidth={2} dot={false} />
                        <Line dataKey="ks"    name="KS Gap"  stroke="#7C3AED"   strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      </LineChart>
                    </ResponsiveContainer>
                  </DrilldownFrame>
                  {persona==='technical'&&(
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, mt:0.5, display:'block' }}>
                      Max KS separation: {ksScore!=null?fmtPct(ksScore*100):'-'} - good predictors show KS {'>'} 30%
                    </Typography>
                  )}
                </Card>
              )}
            </Box>
          )}

          {/* Score bands analysis */}
          {scoreData.length>0&&(
            <Card>
              <SectionLabel icon={Speed}>
                {persona==='business' ? 'Risk score bands - where are the real alerts?' : 'Score band TP rate analysis'}
              </SectionLabel>
              {(() => {
                const bands = [
                  { label:'Low (0-50)',    fp:0, tp:0 },
                  { label:'Medium (51-65)',fp:0, tp:0 },
                  { label:'High (66-80)', fp:0, tp:0 },
                  { label:'Very High (81+)',fp:0,tp:0 },
                ];
                for (const b of scoreData) {
                  const s=b.bin_start;
                  const i=s<51?0:s<66?1:s<81?2:3;
                  bands[i].fp+=(b.fp_count||0);
                  bands[i].tp+=(b.tp_count||0);
                }
                return (
                  <DrilldownFrame
                    title={`Risk-score band performance for ${targetColumn}`}
                    persona={persona}
                    explain={`Each bar shows ${lexicon.positiveShort} rate within a risk-score band.`}
                  >
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={bands.map(b=>({
                        ...b, tpRate:b.fp+b.tp>0?+(b.tp/(b.fp+b.tp)*100).toFixed(1):0
                      }))} margin={{ top:8,right:16,bottom:8,left:-5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis dataKey="label" tick={{ fontSize:10 }} />
                        <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                        <RTooltip formatter={v=>[`${v}%`,`${lexicon.positiveShort} rate in band`]} />
                        <Bar dataKey="tpRate" name={`${lexicon.positiveShort} Rate %`} radius={[4,4,0,0]}>
                          {bands.map((_,i)=><Cell key={i} fill={[D.chartFP,'#0891B2',D.warn,D.chartTP][i]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </DrilldownFrame>
                );
              })()}
            </Card>
          )}
        </>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 4 - RULE INTELLIGENCE (Most important for AML teams)
// ============================================================================
const RuleIntelligenceTab = ({ ds, persona, targetColumn, detectedCols }) => {
  const segCols = [detectedCols.rule].filter(Boolean);
  const { segments, loading, err, reload } = useEdaData(ds, targetColumn, segCols);

  if (loading) return <Spinner label="Analysing rule intelligence..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  const ruleSegs = asArray(segments[detectedCols.rule]);
  const ruleData = [...ruleSegs].sort((a,b)=>b.count-a.count);
  const ruleColIsProfile = /rule_risk_profile/i.test(String(detectedCols.rule || ''));

  // Suppression opportunity matrix - rules with high count + low TP rate
  const suppressionMatrix = ruleData.map(r=>({
    ...r,
    fp_count: r.count - Math.round(r.count*(r.tp_rate/100)),
    tp_count: Math.round(r.count*(r.tp_rate/100)),
    suppressionOpp: r.count*(1-r.tp_rate/100),
    suppressionScore: ((1-r.tp_rate/100) * Math.log(r.count+1)).toFixed(2),
  })).sort((a,b)=>b.suppressionOpp-a.suppressionOpp);

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>
          {ruleColIsProfile ? 'Rule Profile Intelligence' : 'Rule Intelligence'}
        </Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? (ruleColIsProfile
                ? 'Which rule-risk profiles are generating the most noise? Profiles with low STR conversion are the fastest path to workload reduction.'
                : 'Which rules are generating the most noise? Finding rules with low STR conversion is the fastest way to reduce analyst workload.')
            : (ruleColIsProfile
                ? 'Alert volume, STR rate, FP rate, and suppression opportunity scoring by rule risk profile.'
                : 'Alert volume, STR rate, FP rate, and suppression opportunity scoring per rule. High suppression score = high priority for ML-based suppression.')}
        </Typography>
      </Card>

      {!detectedCols.rule&&(
        <Alert severity="info">No rule column detected. Expected: rule_risk_profile, rule_triggered, rule_id, rule_name</Alert>
      )}

      {ruleData.length>0&&(
        <>
          {persona==='business'&&(
            <InsightPanel
              what={ruleColIsProfile
                ? "Some risk profiles generate many alerts but rarely find real money laundering"
                : "Some rules generate many alerts but rarely find real money laundering"}
              why={ruleColIsProfile
                ? "Rule profiles summarize risk intent without leaking exact rule identity. Low-conversion profiles are ideal suppression targets."
                : "Rules are intentionally over-sensitive - they catch everything but also catch too much. Identifying the noisiest rules lets you target ML suppression where it matters most."}
              action={ruleColIsProfile
                ? "Focus on profiles with high alert count (large bar) but low STR rate - those are your quick wins."
                : "Focus on rules with high alert count (large bar) but low STR rate - those are your quick wins."}
              severity="warning"
            />
          )}

          <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>

            {/* Alerts per rule / profile */}
            <Card>
              <SectionLabel icon={Rule}>
                {ruleColIsProfile
                  ? (persona==='business' ? 'Alert volume per profile' : 'Alert count by rule profile')
                  : (persona==='business' ? 'Alert volume per rule' : 'Alert count by rule')}
              </SectionLabel>
              <ResponsiveContainer width="100%" height={Math.min(300, ruleData.length*28+40)}>
                <BarChart data={ruleData} layout="vertical" margin={{ top:4,right:60,bottom:4,left:120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                  <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={115} />
                  <RTooltip formatter={v=>[fmt(v),'Alerts']} />
                  <Bar dataKey="count" radius={[0,3,3,0]}
                    label={{ position:'right', fontSize:9, formatter:v=>fmt(v) }}>
                    {ruleData.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* STR rate per rule / profile */}
            <Card>
              <SectionLabel icon={TrendingDown}>
                {ruleColIsProfile
                  ? (persona==='business' ? 'STR conversion rate per profile' : 'True positive rate by rule profile')
                  : (persona==='business' ? 'STR conversion rate per rule' : 'True positive rate by rule')}
              </SectionLabel>
              <ResponsiveContainer width="100%" height={Math.min(300, ruleData.length*28+40)}>
                <BarChart
                  data={[...ruleData].sort((a,b)=>b.tp_rate-a.tp_rate)}
                  layout="vertical" margin={{ top:4,right:60,bottom:4,left:120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                  <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={115} />
                  <RTooltip formatter={v=>[`${fmtF(v)}%`,'STR Rate']} />
                  <Bar dataKey="tp_rate" radius={[0,3,3,0]}
                    label={{ position:'right', fontSize:9, formatter:v=>`${v}%` }}>
                    {[...ruleData].sort((a,b)=>b.tp_rate-a.tp_rate).map((r,i)=>(
                      <Cell key={i} fill={r.tp_rate<15?D.danger:r.tp_rate<40?D.warn:D.ok}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Box>

          {/* Suppression opportunity matrix */}
          <Card>
            <SectionLabel icon={AutoGraph}>
              {ruleColIsProfile
                ? (persona==='business' ? 'Suppression opportunity matrix - which profiles to target first' : 'Rule-profile suppression opportunity matrix (alerts x FP rate)')
                : (persona==='business' ? 'Suppression opportunity matrix - which rules to target first' : 'Rule suppression opportunity matrix (alerts x FP rate)')}
            </SectionLabel>
            {persona==='business'&&(
              <Typography sx={{ fontSize:11, color:D.textSec, mb:1.5 }}>
                {ruleColIsProfile ? 'Profiles' : 'Rules'} at the top of this table have the highest suppression opportunity - many alerts and low genuine case conversion.
                These should be prioritised for ML-based auto-suppression.
              </Typography>
            )}
            <Box sx={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`2px solid ${D.border}`, bgcolor:D.canvas }}>
                    {[(ruleColIsProfile ? 'Rule Profile' : 'Rule'),'Total Alerts','TP Count','FP Count','STR Rate','FP Rate','Suppression Score'].map(h=>(
                      <th key={h} style={{ padding:'8px 12px', textAlign:'left', color:D.textSec, fontWeight:700, fontSize:10, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppressionMatrix.map((r,i)=>(
                    <tr key={r.label} style={{ background:i%2===0?'#fafbfc':'white', borderBottom:`1px solid ${D.border}` }}>
                      <td style={{ padding:'6px 12px', fontFamily:'monospace', fontWeight:600, fontSize:11 }}>{r.label}</td>
                      <td style={{ padding:'6px 12px' }}>{fmt(r.count)}</td>
                      <td style={{ padding:'6px 12px', color:D.ok, fontWeight:600 }}>{fmt(r.tp_count)}</td>
                      <td style={{ padding:'6px 12px', color:D.danger, fontWeight:600 }}>{fmt(r.fp_count)}</td>
                      <td style={{ padding:'6px 12px' }}>
                        <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
                          <LinearProgress variant="determinate" value={Math.min(100,r.tp_rate||0)}
                            sx={{ flex:1, height:6, borderRadius:3,
                              bgcolor:'#f1f5f9', '& .MuiLinearProgress-bar':{ bgcolor:r.tp_rate<15?D.danger:r.tp_rate<40?D.warn:D.ok } }} />
                          <Typography sx={{ fontSize:10, minWidth:35 }}>{fmtF(r.tp_rate,1)}%</Typography>
                        </Box>
                      </td>
                      <td style={{ padding:'6px 12px', color:r.fp_count/r.count>0.8?D.danger:D.warn }}>
                        {fmtPct((r.fp_count/r.count)*100)}
                      </td>
                      <td style={{ padding:'6px 12px' }}>
                        <Chip size="small" label={r.suppressionScore}
                          sx={{ fontSize:9, bgcolor:Number(r.suppressionScore)>5?'#fee2e2':Number(r.suppressionScore)>2?'#fef9c3':'#dcfce7',
                            color:Number(r.suppressionScore)>5?D.danger:Number(r.suppressionScore)>2?D.warn:D.ok }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
            {persona==='technical'&&(
              <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, mt:1, display:'block' }}>
                Suppression Score = (1 - TP_rate) x log(count+1). Higher score = more analyst time wasted by this {ruleColIsProfile ? 'profile' : 'rule'}.
              </Typography>
            )}
          </Card>
        </>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 5 - ENTITY RISK SEGMENTATION
// ============================================================================
const EntityRiskTab = ({ ds, persona, targetColumn, detectedCols }) => {
  const segCols = [
    detectedCols.riskRating, detectedCols.accountType, detectedCols.nationality,
    detectedCols.occupation, detectedCols.income, detectedCols.accountStatus,
  ].filter(Boolean);
  const { segments, loading, err, reload } = useEdaData(ds, targetColumn, segCols);

  if (loading) return <Spinner label="Analysing entity risk..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  const ratingData    = [...asArray(segments[detectedCols.riskRating])].sort((a,b)=>Number(a.label)-Number(b.label));
  const acctData      = [...asArray(segments[detectedCols.accountType])].sort((a,b)=>b.tp_rate-a.tp_rate).slice(0,12);
  const natData       = [...asArray(segments[detectedCols.nationality])].sort((a,b)=>b.tp_rate-a.tp_rate).slice(0,15);
  const occData       = [...asArray(segments[detectedCols.occupation])].sort((a,b)=>b.tp_rate-a.tp_rate).slice(0,10);
  const incomeData    = [...asArray(segments[detectedCols.income])];
  const acctStatusData= [...asArray(segments[detectedCols.accountStatus])].sort((a,b)=>b.tp_rate-a.tp_rate);

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Entity Risk Segmentation</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? 'Which types of customers and accounts generate the most genuine alerts? This reveals where to focus compliance attention.'
            : 'TP rate by customer risk tier, account type, nationality, occupation, income bracket, and account vintage'}
        </Typography>
      </Card>

      {persona==='business'&&(
        <InsightPanel
          what="Not all customer segments pose equal risk"
          why="By understanding which segments generate real alerts, the compliance team can refine risk appetite statements and the ML model learns segment-specific patterns."
          action="Segments with high STR rate should have tighter monitoring thresholds in the rule engine."
          severity="info"
        />
      )}

      <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>

        {/* Risk rating */}
        {ratingData.length>0&&(
          <Card>
            <SectionLabel icon={TrendingUp}>
              {persona==='business' ? 'STR rate by customer risk tier' : 'TP rate by customer risk rating'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ratingData} margin={{ top:8,right:8,bottom:18,left:-5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis dataKey="label" tick={{ fontSize:10 }} label={{ value:'Risk Rating',position:'insideBottom',offset:-12,fontSize:9 }} />
                <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}% (n=${fmt(p.payload.count)})`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[3,3,0,0]}>
                  {ratingData.map((d,i)=>{
                    const n=Number(d.label); const t=(n-1)/9;
                    const r=Math.round(34+t*221); const g=Math.round(197-t*175);
                    return <Cell key={i} fill={`rgb(${r},${g},34)`}/>;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Account type */}
        {acctData.length>0&&(
          <Card>
            <SectionLabel icon={AccountTree}>
              {persona==='business' ? 'STR rate by account type' : 'TP rate by account type'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={acctData} layout="vertical" margin={{ top:4,right:50,bottom:4,left:75 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={70} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}%`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[0,3,3,0]} fill={D.chartFP}
                  label={{ position:'right', fontSize:9, formatter:v=>`${v}%` }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Geography */}
        {natData.length>0&&(
          <Card>
            <SectionLabel icon={Hub}>
              {persona==='business' ? 'STR rate by customer nationality' : 'TP rate by nationality (top 15)'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={natData} layout="vertical" margin={{ top:4,right:50,bottom:4,left:45 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={40} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}% (n=${fmt(p.payload.count)})`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[0,3,3,0]}>
                  {natData.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {persona==='business'&&(
              <InsightPanel
                what="Certain nationalities appear in more genuine alerts"
                why="High-risk jurisdictions (offshore financial centres, FATF grey-listed countries) tend to show higher STR conversion. This should inform enhanced due diligence criteria."
                action="Cross-reference with FATF country risk ratings and your bank's internal country risk list."
                severity="warning"
              />
            )}
          </Card>
        )}

        {/* Occupation */}
        {occData.length>0&&(
          <Card>
            <SectionLabel icon={Person}>
              {persona==='business' ? 'STR rate by occupation' : 'TP rate by customer occupation'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={occData} layout="vertical" margin={{ top:4,right:50,bottom:4,left:85 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={80} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}%`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[0,3,3,0]} fill={D.orange} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Account status */}
        {acctStatusData.length>0&&(
          <Card>
            <SectionLabel icon={NotificationsActive}>
              {persona==='business' ? 'STR rate by account status' : 'TP rate by account status'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={acctStatusData} margin={{ top:8,right:8,bottom:18,left:-5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis dataKey="label" tick={{ fontSize:10 }} />
                <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}% (n=${fmt(p.payload.count)})`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[3,3,0,0]}>
                  {acctStatusData.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {persona==='business'&&(
              <InsightPanel
                what="Dormant accounts that become active are a key AML red flag"
                why="If dormant accounts show high STR rates, sudden reactivation is a strong signal. The ML model should be trained to recognise this pattern."
                action="Ensure ACCOUNT_STATUS is included as a feature in the preprocessing step."
                severity="warning"
              />
            )}
          </Card>
        )}

        {/* Income */}
        {incomeData.length>0&&(
          <Card>
            <SectionLabel icon={TrendingUp}>
              {persona==='business' ? 'STR rate by income bracket' : 'TP rate by income bracket'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={incomeData} margin={{ top:8,right:8,bottom:18,left:-5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis dataKey="label" tick={{ fontSize:10 }} />
                <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} />
                <RTooltip formatter={(v,_,p)=>[`${fmtF(v)}%`,'STR Rate']} />
                <Bar dataKey="tp_rate" radius={[3,3,0,0]} fill={D.chartFP} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Box>
    </Stack>
  );
};

// ============================================================================
// TAB 6 - BEHAVIOURAL PATTERNS
// ============================================================================
const BehaviouralPatternsTab = ({ ds, persona, targetColumn, detectedCols, colTypes }) => {
  const allCols = useMemo(() => normalizeDatasetColumns(ds?.columns), [ds?.columns]);
  const lexicon = targetLexicon(targetColumn, persona);
  const resolvedCols = useMemo(
    () => inferBehaviouralColumns(allCols, colTypes, detectedCols),
    [allCols, colTypes, detectedCols],
  );

  const behaviouralKeys = [
    'txnAmount',
    'txnCount',
    'cashIntensity',
    'velocity',
    'volSpike',
    'passThrough',
    'counterparty',
    'peerZScore',
    'layering',
    'offHours',
    'actualExpected',
    'structuring',
    'highRiskDest',
  ];

  const detectedBehaviouralCols = useMemo(
    () => Array.from(new Set(behaviouralKeys.map((k) => resolvedCols[k]).filter(Boolean))),
    [resolvedCols],
  );

  const numericWorkbenchCols = useMemo(
    () => allCols.filter((c) => isNum((colTypes || {})[c] || '') && !isIdCol(c)),
    [allCols, colTypes],
  );
  const [customWorkbench, setCustomWorkbench] = useState(false);
  const [customCols, setCustomCols] = useState([]);

  useEffect(() => {
    setCustomCols((prev) => {
      const validPrev = prev.filter((c) => numericWorkbenchCols.includes(c)).slice(0, 8);
      if (validPrev.length > 0) return validPrev;
      return Array.from(
        new Set([
          ...detectedBehaviouralCols.slice(0, 4),
          ...numericWorkbenchCols.slice(0, 6),
        ]),
      ).slice(0, 6);
    });
  }, [numericWorkbenchCols, detectedBehaviouralCols]);

  const segCols = useMemo(
    () => Array.from(
      new Set([
        ...detectedBehaviouralCols,
        ...(customWorkbench ? customCols : []),
      ].filter(Boolean)),
    ),
    [detectedBehaviouralCols, customWorkbench, customCols],
  );

  const { segments, loading, err, reload } = useEdaData(ds, targetColumn, segCols);

  if (loading) return <Spinner label="Analysing behavioural patterns..." />;
  if (err) return <ErrBox msg={err} onRetry={reload} />;

  const chartConfigs = [
    {
      key: 'txnAmount',
      icon: BarChartIcon,
      analystTitle: `${resolvedCols.txnAmount || 'txn_amount'} distribution by class`,
      businessTitle: 'Transaction amount - real vs noise',
      scale: 'amount',
      meaning: 'Shows where suspicious outcomes concentrate across transaction size buckets.',
    },
    {
      key: 'txnCount',
      icon: Timeline,
      analystTitle: `${resolvedCols.txnCount || 'txn_count'} distribution by class`,
      businessTitle: 'Transaction frequency - real vs noise',
      scale: 'int',
      meaning: 'Compares high-frequency versus normal activity to identify burst behaviour.',
    },
    {
      key: 'cashIntensity',
      icon: Speed,
      analystTitle: 'Cash intensity ratio distribution by class',
      businessTitle: 'Cash usage intensity - real vs noise',
      scale: 'pct',
      meaning: 'Higher concentration in flagged class indicates stronger cash-led risk.',
    },
    {
      key: 'velocity',
      icon: Speed,
      analystTitle: 'Velocity ratio distribution by class',
      businessTitle: 'Transaction velocity - real vs noise',
      scale: 'ratio',
      meaning: 'Detects rapid movement patterns that often align with suspicious behaviour.',
    },
    {
      key: 'volSpike',
      icon: TrendingUp,
      analystTitle: '30d vs 90d volume spike distribution',
      businessTitle: 'Behaviour change spike (30d vs 90d)',
      scale: 'ratio',
      meaning: 'Captures sudden behaviour shifts relative to historical baseline.',
    },
    {
      key: 'passThrough',
      icon: CompareArrows,
      analystTitle: 'Pass-through ratio distribution',
      businessTitle: 'Pass-through flow ratio (mule signal)',
      scale: 'ratio',
      meaning: 'High pass-through with low retention can indicate mule-like account behaviour.',
    },
    {
      key: 'counterparty',
      icon: AccountTree,
      analystTitle: 'Counterparty concentration distribution',
      businessTitle: 'Counterparty concentration (HHI)',
      scale: 'ratio',
      meaning: 'Highlights exposure concentration into few destinations or counterparties.',
    },
    {
      key: 'peerZScore',
      icon: ScatterPlot,
      analystTitle: 'Peer-group z-score distribution',
      businessTitle: 'Peer deviation vs customer cohort',
      scale: 'zscore',
      meaning: 'Quantifies how far each behaviour is from peer-group norms.',
    },
    {
      key: 'layering',
      icon: Insights,
      analystTitle: 'Layering score distribution',
      businessTitle: 'Layering behaviour intensity',
      scale: 'ratio',
      meaning: 'Measures complexity and chaining patterns often seen in layering typologies.',
    },
    {
      key: 'offHours',
      icon: AccessTime,
      analystTitle: 'Off-hours transaction percentage distribution',
      businessTitle: 'Off-hours activity share',
      scale: 'pct',
      meaning: 'Elevated off-hours activity can indicate concealment-oriented behaviour.',
    },
    {
      key: 'actualExpected',
      icon: QueryStats,
      analystTitle: 'Actual vs expected volume distribution',
      businessTitle: 'Declared vs observed turnover',
      scale: 'ratio',
      meaning: 'Compares observed volumes against expected customer profile behaviour.',
    },
    {
      key: 'structuring',
      icon: WarningAmber,
      analystTitle: 'Structuring count distribution',
      businessTitle: 'Structuring signal strength',
      scale: 'int',
      meaning: 'Tracks repeated near-threshold transaction behaviour.',
    },
    {
      key: 'highRiskDest',
      icon: Public,
      analystTitle: 'High-risk destination share distribution',
      businessTitle: 'High-risk destination exposure',
      scale: 'pct',
      meaning: 'Shows concentration of flows to higher-risk jurisdictions.',
    },
  ];

  const baseItems = chartConfigs
    .map((cfg) => {
      const col = resolvedCols[cfg.key];
      const bins = col ? (segments[col]?.bins || []) : [];
      return { ...cfg, col, data: bins };
    })
    .filter((item) => item.col && item.data.length > 0);

  const takenCols = new Set(baseItems.map((item) => item.col));
  const customItems = (customWorkbench ? customCols : [])
    .filter((col) => !takenCols.has(col))
    .map((col) => ({
      key: `custom_${col}`,
      col,
      icon: ManageSearch,
      analystTitle: `${col} distribution by class`,
      businessTitle: `${col} behavioural split`,
      scale: featureScaleForName(col),
      meaning: `User-selected EDA view for ${col}. Compare class distribution to validate whether this signal separates noisy vs meaningful alerts.`,
      data: segments[col]?.bins || [],
    }))
    .filter((item) => item.data.length > 0);

  const chartItems = [...baseItems, ...customItems];

  const fmtBin = (value, scale) => {
    if (value == null || Number.isNaN(Number(value))) return '-';
    if (scale === 'int') return Number(value).toFixed(0);
    if (scale === 'pct') return fmtF(value, 0);
    if (scale === 'amount') return Number(value).toFixed(0);
    if (scale === 'zscore') return fmtF(value, 2);
    return fmtF(value, 2);
  };

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Behavioural Patterns</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? 'Behavioural signals now include velocity windows, spike ratios, peer deviation, concentration, pass-through, and temporal activity patterns.'
            : 'Behaviour tab includes v3 AML engineered signals (windowed velocity, peer z-scores, typology-aligned metrics, and temporal patterns).'}
        </Typography>
        <Box sx={{ mt: 1.25 }}>
          <TargetSemanticsNote targetColumn={targetColumn} />
        </Box>
      </Card>

      <Card>
        <SectionLabel icon={ManageSearch}>
          Intelligent Detection + EDA Workbench
        </SectionLabel>
        <Typography sx={{ fontSize: 11.5, color: D.textSec, mb: 1 }}>
          Auto-detected behavioural columns from your schema. Toggle custom workbench to run your own column-level behavioural EDA.
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
          {detectedBehaviouralCols.length > 0 ? detectedBehaviouralCols.map((col) => (
            <Chip
              key={col}
              size="small"
              label={col}
              sx={{ fontFamily: 'monospace', bgcolor: '#f8fafc', border: `1px solid ${D.border}` }}
            />
          )) : (
            <Typography sx={{ fontSize: 11, color: D.textSec }}>
              No engineered behavioural column confidently detected.
            </Typography>
          )}
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <FormControlLabel
            control={(
              <Switch
                checked={customWorkbench}
                onChange={(e) => setCustomWorkbench(e.target.checked)}
                size="small"
              />
            )}
            label={(
              <Typography sx={{ fontSize: 11.5, color: D.textPri }}>
                Enable custom behavioural workbench
              </Typography>
            )}
          />
          {customWorkbench && (
            <FormControl size="small" sx={{ minWidth: 320, maxWidth: 600 }}>
              <InputLabel sx={{ fontSize: 12 }}>Custom columns (max 8)</InputLabel>
              <Select
                multiple
                value={customCols}
                label="Custom columns (max 8)"
                onChange={(e) => {
                  const next = asArray(e.target.value).slice(0, 8);
                  setCustomCols(next);
                }}
                renderValue={(selected) => selected.map((s) => short(s, 18)).join(', ')}
                sx={{ fontSize: 12 }}
              >
                {numericWorkbenchCols.map((col) => (
                  <MenuItem key={col} value={col}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{col}</span>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
        {customWorkbench && (
          <Alert severity="info" sx={{ mt: 1.25 }}>
            Select up to 8 numeric columns. Each selected column is rendered as a class-split distribution so you can quickly see whether it separates class 0 and class 1 well enough to keep for modelling.
          </Alert>
        )}
      </Card>

      <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'1fr 1fr' }, gap:2 }}>
        {chartItems.map((item) => {
          const Icon = item.icon;
          const distributionData = buildSegmentDistributionData(item.data);
          const distributionPayload = buildChartExplanationPayload({
            ds,
            chartKey: `behaviour_${item.col}`,
            chartTitle: persona === 'business' ? item.businessTitle : item.analystTitle,
            chartFocus: item.col,
            targetColumn,
            lexicon,
            deterministicInsight: {
              what: item.meaning,
              why: 'Behavioural distributions help you see whether the signal separates low-value alerts from more actionable ones.',
              action: 'Focus on variables where the two class distributions diverge consistently across the range.',
            },
            facts: compactFacts([
              `${distributionData.length} bins are shown for ${item.col}.`,
              distributionData[0] ? `The first visible bin starts at ${fmtBin(distributionData[0].bin_start, item.scale)}.` : '',
              `${lexicon.negativeShort} and ${lexicon.positiveShort} are shown as separate distributions.`,
            ]),
            watchOut: 'A distribution can look strong in one sample and weaken later. Recheck the signal after preprocessing and validation.',
          });
          return (
            <Card key={item.key}>
              <SectionLabel icon={Icon}>
                {persona === 'business' ? item.businessTitle : item.analystTitle}
              </SectionLabel>
              <DrilldownFrame
                title={persona === 'business' ? item.businessTitle : item.analystTitle}
                persona={persona}
                analysisPayload={distributionPayload}
                explain={item.meaning}
              >
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={distributionData} margin={{ top:8,right:12,bottom:18,left:-5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                    <XAxis dataKey="bin_start" tick={{ fontSize:9 }} tickFormatter={(v) => fmtBin(v, item.scale)} />
                    <YAxis yAxisId="count" tick={{ fontSize:10 }} />
                    <YAxis yAxisId="share" orientation="right" tick={{ fontSize:9 }} tickFormatter={(v) => `${fmtF(v, 0)}%`} />
                    <RTooltip
                      formatter={(value, key) => {
                        if (key === 'fp_share_pct' || key === 'tp_share_pct') return [`${fmtF(value, 1)}%`, classNameFromSeries(key, lexicon)];
                        return [fmt(value), classNameFromSeries(key, lexicon)];
                      }}
                    />
                    <Legend
                      iconSize={9}
                      wrapperStyle={{ fontSize:10 }}
                      formatter={(v)=>classNameFromSeries(v, lexicon)}
                    />
                    <Bar yAxisId="count" dataKey="fp_count" fill={D.chartFP} opacity={0.5} radius={[2,2,0,0]} />
                    <Bar yAxisId="count" dataKey="tp_count" fill={D.chartTP} opacity={0.65} radius={[2,2,0,0]} />
                    <Line yAxisId="share" type="monotone" dataKey="fp_share_pct" stroke={D.chartFP} strokeWidth={2} dot={false} />
                    <Line yAxisId="share" type="monotone" dataKey="tp_share_pct" stroke={D.chartTP} strokeWidth={2.2} dot={false} />
                    <Brush dataKey="bin_start" height={18} travellerWidth={10} />
                  </ComposedChart>
                </ResponsiveContainer>
              </DrilldownFrame>
              <Typography sx={{ mt: 1, fontSize: 11, color: D.textSec }}>
                {item.meaning}
              </Typography>
              <Typography sx={{ mt: 0.5, fontSize: 10.5, color: D.textMute }}>
                X-axis: binned values for <strong>{item.col}</strong>. Left Y-axis: record count. Right Y-axis: class-share curve.
              </Typography>
            </Card>
          );
        })}
      </Box>

      {chartItems.length === 0 && (
        <Alert severity="info">
          No behavioural columns detected. Expected engineered features include windowed velocity, spike ratios,
          pass-through ratio, counterparty concentration, peer z-scores, structuring/layering signals, and off-hours activity.
          Enable the custom behavioural workbench above to run your own EDA on selected numeric columns.
        </Alert>
      )}
    </Stack>
  );
};
const ComplianceEnrichmentTab = ({ ds, persona, targetColumn, detectedCols }) => {
  const segCols = [
    detectedCols.pep, detectedCols.sanction, detectedCols.adverse, detectedCols.kyc,
  ].filter(Boolean);
  const { segments, loading, err, reload } = useEdaData(ds, targetColumn, segCols);

  if (loading) return <Spinner label="Analysing compliance enrichment..." />;
  if (err)     return <ErrBox msg={err} onRetry={reload} />;

  const pepData     = asArray(segments[detectedCols.pep]);
  const sanctData   = asArray(segments[detectedCols.sanction]);
  const adverseData = asArray(segments[detectedCols.adverse]);
  const kycData     = segments[detectedCols.kyc]?.bins||[];

  // Build combined flag comparison
  const complianceCompare = [
    { flag:'PEP Flag',      data:pepData },
    { flag:'Sanction Hit',  data:sanctData },
    { flag:'Adverse Media', data:adverseData },
  ].filter(f=>f.data.length>0).map(f=>{
    const no  = f.data.find(r=>r.label==='0'||r.label==='false');
    const yes = f.data.find(r=>r.label==='1'||r.label==='true');
    return {
      flag:f.flag,
      unflagged: no?.tp_rate??0,
      flagged:   yes?.tp_rate??0,
      lift:      no?.tp_rate>0 ? ((yes?.tp_rate||0)/(no?.tp_rate||1)).toFixed(1) : '-',
    };
  });

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Compliance Enrichment Analysis</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? 'How do PEP status, sanction hits, adverse media, and KYC quality affect genuine alert rates?'
            : 'TP rate analysis across compliance flags - PEP, sanctions, adverse media, KYC completeness and staleness'}
        </Typography>
      </Card>

      {persona==='business'&&(
        <InsightPanel
          what="Compliance flags are meant to identify high-risk customers - but do they actually predict genuine alerts?"
          why="If PEP or sanction flags don't significantly increase STR rates, the bank may be over-flagging low-risk customers and wasting analyst time on compliance reviews."
          action="Use the lift ratios below to assess whether compliance flags are actually predictive. Lift < 1.5 suggests the flag adds limited value."
          severity="info"
        />
      )}

      {complianceCompare.length>0&&(
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>

          {/* Grouped comparison bar */}
          <Card>
            <SectionLabel icon={Security}>
              {persona==='business' ? 'STR rate: flagged vs unflagged customers' : 'TP rate by compliance flag (flagged vs unflagged)'}
            </SectionLabel>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={complianceCompare} margin={{ top:8,right:8,bottom:18,left:-5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis dataKey="flag" tick={{ fontSize:10 }} />
                <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                <RTooltip formatter={v=>[`${fmtF(v)}%`,'STR Rate']} />
                <Legend iconSize={9} wrapperStyle={{ fontSize:10 }} />
                <Bar dataKey="unflagged" name="Not Flagged" fill={D.chartFP} radius={[3,3,0,0]} />
                <Bar dataKey="flagged"   name="Flagged"     fill={D.chartTP} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Lift table */}
          <Card>
            <SectionLabel icon={TrendingUp}>
              {persona==='business' ? 'How much do compliance flags increase genuine alert probability?' : 'Flag lift analysis'}
            </SectionLabel>
            <Box sx={{ mt:1 }}>
              {complianceCompare.map((c,i)=>(
                <Box key={i} sx={{ mb:1.5, p:1.5, borderRadius:1.5, bgcolor:'#f8fafc', border:`1px solid ${D.border}` }}>
                  <Typography sx={{ fontWeight:700, fontSize:12, mb:0.75 }}>{c.flag}</Typography>
                  <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:1 }}>
                    <Box>
                      <Typography sx={{ fontSize:10, color:D.textSec }}>Unflagged STR%</Typography>
                      <Typography sx={{ fontWeight:700, fontSize:16, color:D.chartFP }}>{fmtF(c.unflagged)}%</Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize:10, color:D.textSec }}>Flagged STR%</Typography>
                      <Typography sx={{ fontWeight:700, fontSize:16, color:D.chartTP }}>{fmtF(c.flagged)}%</Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize:10, color:D.textSec }}>Lift</Typography>
                      <Typography sx={{ fontWeight:700, fontSize:16,
                        color:Number(c.lift)>=2?D.ok:Number(c.lift)>=1.5?D.warn:D.danger }}>
                        {c.lift}x
                      </Typography>
                    </Box>
                  </Box>
                  <LinearProgress variant="determinate"
                    value={Math.min(100, (Number(c.lift)/3)*100)}
                    sx={{ mt:0.75, height:5, borderRadius:3, bgcolor:'#f1f5f9',
                      '& .MuiLinearProgress-bar':{ bgcolor:Number(c.lift)>=2?D.ok:Number(c.lift)>=1.5?D.warn:D.danger }
                    }} />
                  <Typography variant="caption" sx={{ fontSize:10, color:D.textSec }}>
                    {Number(c.lift)>=2?'Strong predictor - include in model':Number(c.lift)>=1.5?'Moderate predictor':'Weak predictor - may add limited model value'}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Card>
        </Box>
      )}

      {/* KYC completeness */}
      {kycData.length>0&&(
        <Card>
          <SectionLabel icon={GppBad}>
            {persona==='business' ? 'KYC completeness vs genuine alerts' : 'KYC completeness / staleness distribution by class'}
          </SectionLabel>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={kycData} margin={{ top:8,right:8,bottom:18,left:-5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
              <XAxis dataKey="bin_start" tick={{ fontSize:9 }} />
              <YAxis tick={{ fontSize:10 }} />
              <RTooltip />
              <Legend iconSize={9} wrapperStyle={{ fontSize:10 }}
                formatter={v=>v==='fp_count'?'Class 0':'Class 1'} />
              <Bar dataKey="fp_count" fill={D.chartFP} opacity={0.6} radius={[2,2,0,0]} />
              <Bar dataKey="tp_count" fill={D.chartTP} opacity={0.7} radius={[2,2,0,0]} />
            </ComposedChart>
          </ResponsiveContainer>
          {persona==='business'&&(
            <InsightPanel
              what="Incomplete KYC correlates with higher genuine alert rates"
              why="Customers who haven't updated their KYC are often less scrutinised. If low KYC completeness corresponds to higher STR rates, it signals a gap in the bank's onboarding controls."
              action="Flag customers with KYC completeness below 70% for enhanced review. Include KYC_COMPLETENESS_PCT as a model feature."
              severity="warning"
            />
          )}
        </Card>
      )}

      {complianceCompare.length===0&&kycData.length===0&&(
        <Alert severity="info">
          No compliance columns detected. Expected: pep_flag, sanction_hit, adverse_media_flag, kyc_completeness_pct
        </Alert>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 8 - COLUMN EXPLORER
// ============================================================================
const histToDensity = (bins) => {
  if (!bins?.length) return [];
  const total = bins.reduce((s,b)=>s+(b.count||0),0)||1;
  return bins.map(b=>({ x:Number(b.bin_start), density:(b.count||0)/total, count:b.count||0 }));
};

const inferSemanticType = (columnName = '', profile = {}) => {
  const name = normToken(columnName);
  if (isIdCol(columnName) || profile?.is_id) return 'Identifier / key';
  if (/date|time|timestamp/.test(name)) return 'Date / time';
  if (/amount|balance|turnover|volume|income|amt|value/.test(name)) return 'Financial amount';
  if (/score|risk|rating|prob|likelihood/.test(name)) return 'Risk score / ordinal signal';
  if (/country|city|state|region|geo|nationality/.test(name)) return 'Location / geography';
  if (/name|type|segment|category|occupation|status|rule/.test(name)) return 'Business category';
  if (/pep|sanction|flag|hit|binary|is_/.test(name)) return 'Binary control / flag';
  if (isNum(profile?.dtype || '')) return 'Numeric measure';
  return 'Categorical attribute';
};

const inferTreatmentGuidance = ({ columnName = '', profile = {}, isNumeric = false, isIdLike = false, skew = null, missingRate = 0 }) => {
  if (isIdLike) {
    return {
      title: 'Keep for traceability only',
      note: 'Use this field for joins, lineage, and record traceability. Exclude it from model learning.',
    };
  }
  if (missingRate >= 0.5) {
    return {
      title: 'Review for drop or fallback source',
      note: 'Very high missingness reduces reliability. Consider dropping the field or sourcing a stronger replacement.',
    };
  }
  if (isNumeric && Math.abs(Number(skew || 0)) >= 1.5) {
    return {
      title: 'Transform before modelling',
      note: 'This numeric field is strongly skewed. Use clipping or log-style transformation during preprocessing.',
    };
  }
  if (isNumeric) {
    return {
      title: 'Keep with scaling review',
      note: 'Numeric fields usually stay in the model, but check spread, outliers, and target response before finalising.',
    };
  }
  if (/status|type|segment|category|occupation|country|nationality|rule/.test(normToken(columnName))) {
    return {
      title: 'Keep as grouped category',
      note: 'Categorical fields are useful when the event rate differs by group. Consider grouping rare levels before encoding.',
    };
  }
  return {
    title: 'Check usefulness with target response',
    note: 'Use the target-response and category concentration views to confirm that this field adds useful signal.',
  };
};

const buildSegmentDistributionData = (rows = []) => {
  const cleanRows = asArray(rows);
  const totalFp = cleanRows.reduce((sum, row) => sum + (Number(row?.fp_count) || 0), 0) || 1;
  const totalTp = cleanRows.reduce((sum, row) => sum + (Number(row?.tp_count) || 0), 0) || 1;
  return cleanRows.map((row) => ({
    ...row,
    fp_share_pct: ((Number(row?.fp_count) || 0) / totalFp) * 100,
    tp_share_pct: ((Number(row?.tp_count) || 0) / totalTp) * 100,
  }));
};

const ColumnExplorerTab = ({ ds, persona, targetColumn, colTypes, colNames }) => {
  const allCols   = (colNames && colNames.length ? colNames : normalizeDatasetColumns(ds?.columns)) || [];
  const isIdLike  = (c) => isIdCol(c);

  // Sort: non-ID first, ID at bottom
  const sortedCols = [...allCols.filter(c=>!isIdLike(c)), ...allCols.filter(c=>isIdLike(c))];

  const [selCol,    setSelCol]    = useState(sortedCols[0]||'');
  const [prof,      setProf]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState(null);
  const [search,    setSearch]    = useState('');
  const [chartMode, setChartMode] = useState('histogram');
  const [analysisCols, setAnalysisCols] = useState(sortedCols.filter(c=>!isIdLike(c)).slice(0,4));

  useEffect(() => {
    if (!selCol || !sortedCols.includes(selCol)) {
      setSelCol(sortedCols[0] || '');
    }
  }, [selCol, sortedCols]);

  const normalizeProfile = useCallback((payload, col) => {
    const data = payload?.columns?.[col] || payload || {};
    const stats = data?.stats || {};
    const q1 = stats?.p25 ?? data?.q1;
    const median = stats?.median ?? data?.median;
    const q3 = stats?.p75 ?? data?.q3;
    return {
      ...data,
      _col: col,
      dtype: data?.dtype || 'object',
      role: data?.role || 'categorical',
      histogram: Array.isArray(data?.histogram) ? data.histogram : [],
      top_categories: Array.isArray(data?.top_values)
        ? data.top_values.map((item) => ({
            label: String(item?.value ?? ''),
            value: item?.value,
            count: Number(item?.count || 0),
            pct: Number(item?.pct || 0),
          }))
        : [],
      value_counts: Array.isArray(data?.top_values)
        ? data.top_values.map((item) => ({
            label: String(item?.value ?? ''),
            value: item?.value,
            count: Number(item?.count || 0),
            pct: Number(item?.pct || 0),
          }))
        : [],
      total_count: data?.n_total ?? data?.total_count ?? 0,
      distinct_count: data?.n_unique ?? data?.distinct_count ?? data?.unique_count ?? 0,
      unique_count: data?.n_unique ?? data?.distinct_count ?? data?.unique_count ?? 0,
      missing_pct: (data?.missing_pct ?? 0) / 100,
      null_pct: (data?.missing_pct ?? 0) / 100,
      sample_value: Array.isArray(data?.top_values) && data.top_values.length ? data.top_values[0]?.value : '',
      min: stats?.min ?? data?.min,
      q1,
      median,
      mean: stats?.mean ?? data?.mean,
      q3,
      max: stats?.max ?? data?.max,
      std: stats?.std ?? data?.std,
      skew: stats?.skewness ?? data?.skew,
      skewness: stats?.skewness ?? data?.skewness,
      kurtosis: stats?.kurtosis ?? data?.kurtosis,
      iqr: stats?.iqr ?? data?.iqr,
      boxplot: { q1, median, q3 },
      entropy: stats?.entropy ?? data?.entropy,
      mode: stats?.mode ?? data?.mode,
      mode_count: stats?.mode_count ?? data?.mode_count,
      target_breakdown: Array.isArray(data?.target_breakdown) ? data.target_breakdown : [],
      is_binary: data?.role === 'binary' || Number(data?.n_unique || 0) === 2,
      is_id: Boolean(data?.is_id),
    };
  }, []);

  const load = useCallback(async (col) => {
    if (!col) return;
    setLoading(true); setErr(null); setProf(null);
    try {
      const res = await mlopsApi.columnProfile({
        dataset_id:ds.dataset_id,
        column:col,
        target_column:targetColumn||'',
        sample_rows:10000,
        bins:25,
      });
      const data = res?.data||res;
      setProf(normalizeProfile(data, col));
    } catch(e) { setErr(e?.message||'Profile failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, normalizeProfile, targetColumn]);

  useEffect(()=>{ if(selCol) load(selCol); }, [selCol, load]);
  useEffect(() => {
    setAnalysisCols((prev) => {
      const next = prev.filter((col) => sortedCols.includes(col)).slice(0, 6);
      if (next.length) return next;
      return sortedCols.filter((col) => !isIdLike(col)).slice(0, 4);
    });
  }, [sortedCols]);

  const filtered = sortedCols.filter(c=>c.toLowerCase().includes(search.toLowerCase()));
  const isNumeric = prof ? (isNum(prof.dtype)||prof.min!=null) : false;
  const isBinary  = prof ? (prof.is_binary||prof.unique_count===2||prof.distinct_count===2) : false;
  const isIdLikeCol = selCol ? isIdLike(selCol) : false;

  const histData = useMemo(()=>{
    if (!prof?.histogram) return [];
    return prof.histogram.map(b=>({ label:Number(b.bin_start).toFixed(2), count:b.count||0, density:b.density??0 }));
  }, [prof]);

  const catData = useMemo(()=>{
    const raw = prof?.top_categories||prof?.value_counts||[];
    return raw.slice(0,20).map(item=>({
      label:String(item.value??item.label??'?').slice(0,24),
      count:Number(item.count??item.freq??0),
      pct:Number(item.pct??0),
    }));
  }, [prof]);

  const analysisSummary = useMemo(() => (
    analysisCols.map((col) => ({
      column: col,
      dtype: colTypes[col] || 'object',
      role: isNum((colTypes[col] || '').toLowerCase()) ? 'numeric' : 'categorical',
    }))
  ), [analysisCols, colTypes]);

  const targetBreakdownData = useMemo(() => {
    if (!targetColumn || !prof?.target_breakdown?.length) return [];
    if (isNumeric) {
      return prof.target_breakdown.map((row, index) => ({
        bucket: `Bin ${index + 1}`,
        mean_val: Number(row.mean_val ?? 0),
        tp_rate_pct: Number(row.tp_rate ?? 0) * 100,
        count: Number(row.count ?? 0),
      }));
    }
    return prof.target_breakdown.slice(0, 15).map((row) => ({
      label: short(String(row.value ?? '-'), 24),
      tp_rate_pct: Number(row.tp_rate ?? 0) * 100,
      count: Number(row.count ?? 0),
    }));
  }, [isNumeric, prof, targetColumn]);

  const boxplotStats = useMemo(() => {
    if (!isNumeric || !prof) return null;
    const stats = {
      min: Number(prof.min),
      q1: Number(prof.boxplot?.q1 ?? prof.q1),
      median: Number(prof.boxplot?.median ?? prof.median),
      q3: Number(prof.boxplot?.q3 ?? prof.q3),
      max: Number(prof.max),
    };
    if (Object.values(stats).some((value) => Number.isNaN(value))) return null;
    const span = Math.max(stats.max - stats.min, 1e-9);
    const pct = (value) => `${((value - stats.min) / span) * 100}%`;
    return { ...stats, pct };
  }, [isNumeric, prof]);

  const missingRate = Number(prof?.null_pct ?? prof?.missing_pct ?? 0);
  const semanticType = useMemo(
    () => inferSemanticType(selCol, prof),
    [selCol, prof],
  );
  const treatmentGuidance = useMemo(
    () => inferTreatmentGuidance({
      columnName: selCol,
      profile: prof,
      isNumeric,
      isIdLike: isIdLikeCol,
      skew: prof?.skewness ?? prof?.skew,
      missingRate,
    }),
    [selCol, prof, isNumeric, isIdLikeCol, missingRate],
  );
  const columnWarnings = useMemo(() => compactFacts([
    isIdLikeCol ? 'This looks like an identifier and should stay out of model features.' : '',
    missingRate >= 0.5 ? 'More than half of the rows are missing for this field.' : '',
    !isIdLikeCol && missingRate >= 0.2 && missingRate < 0.5 ? 'Missingness is material and should be handled explicitly in preprocessing.' : '',
    isNumeric && Math.abs(Number(prof?.skewness ?? prof?.skew ?? 0)) >= 1.5 ? 'The distribution is strongly skewed and may need transformation.' : '',
    !isNumeric && Number(prof?.distinct_count ?? prof?.unique_count ?? 0) > 100 ? 'This categorical field is high-cardinality and may need grouping or frequency encoding.' : '',
  ], 5), [isIdLikeCol, missingRate, isNumeric, prof]);

  const columnFacts = useMemo(() => compactFacts([
    `${selCol} is currently typed as ${prof?.dtype || 'object'} and treated as ${prof?.role || 'categorical'}.`,
    `Missing rate is ${fmtPct((Number(prof?.null_pct ?? prof?.missing_pct ?? 0)) * 100)} across ${fmt(prof?.total_count)} rows.`,
    `Distinct values: ${fmt(prof?.distinct_count ?? prof?.unique_count)}.`,
    isNumeric && prof?.mean != null ? `Mean is ${fmtF(prof.mean, 3)}, median is ${fmtF(prof.median, 3)}, and spread extends from ${fmtF(prof.min, 3)} to ${fmtF(prof.max, 3)}.` : '',
    !isNumeric && catData[0] ? `Most common visible value is ${catData[0].label} with ${fmt(catData[0].count)} rows.` : '',
  ]), [selCol, prof, isNumeric, catData]);

  const columnOverviewInsight = useMemo(() => ({
    what: isNumeric
      ? `${selCol} is a numeric signal with ${fmt(prof?.distinct_count ?? prof?.unique_count)} distinct values.`
      : `${selCol} is a categorical field with ${fmt(prof?.distinct_count ?? prof?.unique_count)} distinct values.`,
    why: isIdLikeCol
      ? 'This is an identifier field, so it is useful for joins and traceability but not for model learning.'
      : isNumeric
        ? 'This helps you judge whether the distribution is stable, skewed, sparse, or likely to need transformation.'
        : 'This helps you see whether a few categories dominate the field or whether the values are too fragmented to be useful.',
    action: isIdLikeCol
      ? 'Keep this field for mapping and audit only. Do not use it as a predictive feature.'
      : isNumeric
        ? 'Check the target-response view and density shape before deciding whether to keep or transform this feature.'
        : 'Use the target-response view to see whether category-level event rates are informative enough for modelling.',
  }), [selCol, prof, isNumeric, isIdLikeCol]);

  const columnOverviewPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'column_overview',
    chartTitle: `${selCol} column overview`,
    chartFocus: `the quality and modelling relevance of ${selCol}`,
    targetColumn,
    lexicon: targetLexicon(targetColumn, persona),
    deterministicInsight: columnOverviewInsight,
    facts: columnFacts,
    watchOut: isIdLikeCol
      ? 'Identifier fields should stay available for tracing records, but they should not be fed into the model.'
      : 'A clean distribution alone does not make a feature useful. Confirm target response and leakage risk before keeping it.',
  }), [ds, selCol, targetColumn, persona, columnOverviewInsight, columnFacts, isIdLikeCol]);

  const targetBreakdownPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'column_target_response',
    chartTitle: `${selCol} vs target response`,
    chartFocus: `how ${selCol} changes the rate of ${targetLexicon(targetColumn, persona).positiveShort}`,
    targetColumn,
    lexicon: targetLexicon(targetColumn, persona),
    deterministicInsight: {
      what: isNumeric
        ? `${selCol} is split into bins so you can see how event rate changes across the value range.`
        : `${selCol} is compared by category so you can see which values are associated with higher event rates.`,
      why: 'This is one of the fastest ways to decide whether a field contains useful signal for suppression or escalation decisions.',
      action: 'Prioritise fields that show meaningful rate differences with enough record support.',
    },
    facts: compactFacts([
      `${targetBreakdownData.length} ${isNumeric ? 'bins' : 'categories'} are visible in the target-response view.`,
      isNumeric && targetBreakdownData[0] ? `Highest displayed event rate is ${fmtF(Math.max(...targetBreakdownData.map((row) => Number(row.tp_rate_pct || 0))), 2)}%.` : '',
      !isNumeric && targetBreakdownData[0] ? `${targetBreakdownData[0].label} shows ${fmtF(targetBreakdownData[0].tp_rate_pct, 2)}% event rate across ${fmt(targetBreakdownData[0].count)} rows.` : '',
    ]),
    watchOut: 'Do not overreact to bins or categories with low support. Always read event rate together with row count.',
  }), [ds, selCol, targetColumn, persona, isNumeric, targetBreakdownData]);

  const histogramPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'column_histogram',
    chartTitle: `${selCol} histogram`,
    chartFocus: `the spread of ${selCol}`,
    targetColumn,
    lexicon: targetLexicon(targetColumn, persona),
    deterministicInsight: {
      what: `${selCol} is grouped into histogram bins to show where most rows are concentrated.`,
      why: 'This helps detect skew, sparse tails, zero-inflation, and feature ranges that may distort modelling.',
      action: 'Use this shape with the density and target-response views before deciding on scaling or transformation.',
    },
    facts: compactFacts([
      `${histData.length} bins are visible in the histogram.`,
      histData.length ? `Largest visible bin contains ${fmt(Math.max(...histData.map((row) => Number(row.count || 0))))} rows.` : '',
      prof?.mean != null ? `Mean is ${fmtF(prof.mean, 3)} and median is ${fmtF(prof.median, 3)}.` : '',
    ]),
    watchOut: 'A visually smooth histogram can still hide target imbalance or leakage. Use the other analysis views too.',
  }), [ds, selCol, targetColumn, persona, histData, prof]);

  const densityPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'column_density',
    chartTitle: `${selCol} density`,
    chartFocus: `where ${selCol} values cluster`,
    targetColumn,
    lexicon: targetLexicon(targetColumn, persona),
    deterministicInsight: {
      what: 'The density curve highlights where values are most concentrated across the selected column.',
      why: 'Density is easier to read than raw counts when you want to compare the center, tails, and concentration of a numeric feature.',
      action: 'If the curve is sharply skewed or compressed near zero, consider transformation or clipping during preprocessing.',
    },
    facts: compactFacts([
      prof?.mean != null ? `Mean is marked at ${fmtF(prof.mean, 3)}.` : '',
      prof?.median != null ? `Median is marked at ${fmtF(prof.median, 3)}.` : '',
      prof?.skew != null ? `Observed skew is ${fmtF(prof.skew, 2)}.` : '',
    ]),
    watchOut: 'Density is shape only. Use the histogram or target-response view when support counts matter.',
  }), [ds, selCol, targetColumn, persona, prof]);

  const categoryPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'column_categories',
    chartTitle: `${selCol} top categories`,
    chartFocus: `which categories dominate ${selCol}`,
    targetColumn,
    lexicon: targetLexicon(targetColumn, persona),
    deterministicInsight: {
      what: 'This chart ranks the most common categories in the selected field by row volume.',
      why: 'It helps you see whether the field is clean and concentrated enough to be model-ready or too fragmented to be useful.',
      action: 'Use the category distribution together with event rate to decide whether to group rare levels or keep the field as-is.',
    },
    facts: compactFacts([
      `${catData.length} categories are shown.`,
      catData[0] ? `${catData[0].label} is the most common visible value with ${fmt(catData[0].count)} rows.` : '',
      catData[1] ? `${catData[1].label} is the next largest visible value with ${fmt(catData[1].count)} rows.` : '',
    ]),
    watchOut: 'High-cardinality fields can look informative by frequency but still be weak model features if their event rates are flat.',
  }), [ds, selCol, targetColumn, persona, catData]);

  if (!sortedCols.length) {
    return <Alert severity="info">No columns available for analysis in the current dataset.</Alert>;
  }

  return (
    <Box sx={{ display:'flex', gap:2, height:'100%' }}>
      {/* Sidebar */}
      <Paper variant="outlined" sx={{ width:220, flexShrink:0, borderRadius:2, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <Box sx={{ p:1.25, borderBottom:`1px solid ${D.border}` }}>
          <TextField size="small" placeholder="Search columns..." value={search}
            onChange={e=>setSearch(e.target.value)} fullWidth
            InputProps={{ startAdornment:<Search sx={{ fontSize:15, color:'#9ca3af', mr:0.5 }} /> }}
            sx={{ '& input':{ fontSize:12 }, '& fieldset':{ borderColor:D.border } }} />
        </Box>
        {/* ID warning */}
        <Box sx={{ p:1, bgcolor:'#fffbeb', borderBottom:`1px solid #fde68a` }}>
          <Typography sx={{ fontSize:9, color:'#92400e' }}>
            ID columns shown at bottom - excluded from model analysis
          </Typography>
        </Box>
        <Box sx={{ flex:1, overflowY:'auto' }}>
          {filtered.map(col=>{
            const dtype = (colTypes[col]||'').toLowerCase();
            const isN   = isNum(dtype);
            const isId  = isIdLike(col);
            const active = selCol===col;
            return (
              <Box key={col} onClick={()=>setSelCol(col)} sx={{
                px:1.5, py:0.85, cursor:'pointer',
                borderBottom:`1px solid #f8fafc`,
                bgcolor: active?D.orangeLight:isId?'#fafafa':'white',
                borderLeft:`3px solid ${active?D.orange:'transparent'}`,
                '&:hover':{ bgcolor:active?D.orangeLight:'#fafafa' },
                opacity: isId ? 0.65 : 1,
              }}>
                <Typography variant="caption" sx={{ fontFamily:'monospace', fontWeight:active?700:400,
                  display:'block', color:active?D.orange:isId?D.textMute:D.textPri }} noWrap>
                  {col}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ mt:0.25 }}>
                  <Chip label={isN?'num':'cat'} size="small" sx={{
                    height:13, fontSize:8,
                    bgcolor:isN?'#dbeafe':'#dcfce7',
                    color:isN?'#1e40af':'#166534',
                  }} />
                  {isId&&<Chip label="ID" size="small" sx={{ height:13, fontSize:8, bgcolor:'#f1f5f9', color:D.textMute }} />}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Paper>

      {/* Detail panel */}
      <Box sx={{ flex:1, minWidth:0, overflow:'auto' }}>
        <Stack spacing={2}>
          <Card highlight>
            <Stack direction={{ xs:'column', md:'row' }} spacing={1.5} justifyContent="space-between">
              <Box>
                <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>
                  {persona==='business' ? 'Column Analysis Workbench' : 'Bivariate and Multivariate Column Analysis'}
                </Typography>
                <Typography sx={{ fontSize:12, color:D.textSec, mt:0.4 }}>
                  Pick up to six columns, then click any of them for a target-aware drilldown. This replaces the old single-column dead end with a reusable analysis set.
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 320, maxWidth: 620 }}>
                <InputLabel>Analysis columns (max 6)</InputLabel>
                <Select
                  multiple
                  value={analysisCols}
                  label="Analysis columns (max 6)"
                  onChange={(e) => setAnalysisCols(asArray(e.target.value).slice(0, 6))}
                  renderValue={(selected) => selected.join(', ')}
                >
                  {sortedCols.filter((col) => !isIdLike(col)).map((col) => (
                    <MenuItem key={col} value={col}>
                      <span style={{ fontFamily:'monospace', fontSize:11 }}>{col}</span>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
              {analysisSummary.map((item) => (
                <Chip
                  key={item.column}
                  label={item.column}
                  onClick={() => setSelCol(item.column)}
                  sx={{
                    fontFamily:'monospace',
                    bgcolor:item.column === selCol ? D.orangeLight : '#fff',
                    border:`1px solid ${item.column === selCol ? `${D.orange}55` : D.border}`,
                  }}
                />
              ))}
            </Stack>
            {targetColumn && (
              <Typography sx={{ mt: 1, fontSize: 10.5, color: D.textMute }}>
                Target-aware comparisons use <strong>{targetColumn}</strong>. Numeric columns show bin-level event rate; categorical columns show top category event rate with support.
              </Typography>
            )}
          </Card>

        {loading ? <Spinner label="Profiling column..." /> :
         err     ? <ErrBox msg={err} onRetry={()=>load(selCol)} /> :
         prof    ? (
          <Stack spacing={2}>

            {isIdLikeCol&&(
              <Alert severity="warning" icon={<VisibilityOff sx={{ fontSize:16 }} />}>
                <Typography variant="body2" fontWeight={600}>ID Column - Excluded from Analysis</Typography>
                <Typography variant="body2" sx={{ fontSize:11 }}>
                  This column is an identifier used for joining tables, not for model training. It will not appear in correlations, feature importance, or model features.
                </Typography>
              </Alert>
            )}

            {/* Header */}
            <Card>
              <Stack direction={{ xs:'column', lg:'row' }} justifyContent="space-between" alignItems={{ lg:'flex-start' }} gap={1.5}>
                <Box>
                  <Typography sx={{ fontFamily:'monospace', fontWeight:800, fontSize:18, color:D.textPri }}>
                    {prof._col}
                  </Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt:0.5 }}>
                    <Chip label={prof.dtype||'object'} size="small" sx={{ fontFamily:'monospace', fontSize:10, bgcolor:'#f1f5f9' }} />
                    <Chip label={prof.role||'categorical'} size="small" sx={{ fontSize:10, bgcolor:'#eef2ff', color:'#4338ca' }} />
                    <Chip label={semanticType} size="small" sx={{ fontSize:10, bgcolor:'#f8fafc', color:D.textPri }} />
                    {isBinary&&<Chip label="binary" size="small" sx={{ fontSize:10, bgcolor:'#dcfce7', color:'#166534' }} />}
                    {(isIdLikeCol || prof.is_id)&&<Chip label="ID / key" size="small" sx={{ fontSize:10, bgcolor:'#f1f5f9', color:D.textMute }} />}
                    {persona==='technical'&&prof.skew!=null&&Math.abs(prof.skew)>1&&(
                      <Chip label={`skew: ${fmtF(prof.skew,2)}`} size="small" sx={{ fontSize:10, bgcolor:'#fef9c3', color:'#854d0e' }} />
                    )}
                  </Stack>
                </Box>
                <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'repeat(2, minmax(120px, 1fr))', md:'repeat(4, minmax(110px, 1fr))' }, gap:1, width:{ xs:'100%', lg:'auto' } }}>
                  {[
                    { k:'Missing', v:fmtPct((prof.null_pct??prof.missing_pct??0)*100), warn:(prof.null_pct??0)>0.2 },
                    { k:'Unique',    v:fmt(prof.distinct_count??prof.unique_count) },
                    { k:'Total',     v:fmt(prof.total_count) },
                    { k:'Sample',    v:String(prof.sample_value??prof.mode??'-').slice(0,18) },
                  ].map(({k,v,warn})=>(
                    <Box key={k} sx={{ p:1, borderRadius:1.5, bgcolor:'#fafbfc', border:`1px solid ${D.border}` }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, display:'block' }}>{k}</Typography>
                      <Typography sx={{ fontWeight:700, fontSize:14, color:warn?D.danger:D.textPri }}>{v}</Typography>
                    </Box>
                  ))}
                </Box>
              </Stack>
              <InsightPanel
                what={columnOverviewInsight.what}
                why={columnOverviewInsight.why}
                action={columnOverviewInsight.action}
                severity={isIdLikeCol ? 'warning' : 'info'}
              />
              <Box sx={{ mt: 1.1, display:'grid', gridTemplateColumns:{ xs:'1fr', lg:'1.05fr 0.95fr' }, gap:1.25 }}>
                <Box sx={{ p:1.15, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
                  <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.4 }}>
                    Recommended treatment
                  </Typography>
                  <Typography sx={{ fontSize:12.5, fontWeight:700, color:D.textPri }}>
                    {treatmentGuidance.title}
                  </Typography>
                  <Typography sx={{ fontSize:11.5, color:D.textSec, lineHeight:1.6, mt:0.45 }}>
                    {treatmentGuidance.note}
                  </Typography>
                </Box>
                <Box sx={{ p:1.15, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
                  <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.4 }}>
                    Warnings to review
                  </Typography>
                  {columnWarnings.length ? (
                    <Stack spacing={0.55}>
                      {columnWarnings.map((warning, index) => (
                        <Typography key={`${warning}-${index}`} sx={{ fontSize:11.5, color:D.textSec, lineHeight:1.5 }}>
                          {warning}
                        </Typography>
                      ))}
                    </Stack>
                  ) : (
                    <Typography sx={{ fontSize:11.5, color:D.textSec, lineHeight:1.5 }}>
                      No immediate warnings. Confirm target response and business meaning before keeping the field.
                    </Typography>
                  )}
                </Box>
              </Box>
            </Card>

            {targetBreakdownData.length > 0 && (
              <Card>
                <SectionLabel icon={Flag}>
                  {persona==='business' ? `How ${selCol} behaves against the target` : `Target response by ${selCol}`}
                </SectionLabel>
                <DrilldownFrame
                  title={persona==='business' ? `${selCol} vs predicted outcome` : `Target response by ${selCol}`}
                  persona={persona}
                  analysisPayload={targetBreakdownPayload}
                  explain={isNumeric
                    ? `This chart shows how event rate changes across the value range of ${selCol}.`
                    : `This chart shows which categories of ${selCol} are associated with higher event rates.`}
                >
                {isNumeric ? (
                  <Box>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={targetBreakdownData} margin={{ top:8, right:12, bottom:18, left:-5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis dataKey="bucket" tick={{ fontSize:10 }} />
                        <YAxis yAxisId="rate" tick={{ fontSize:10 }} tickFormatter={(v) => `${fmtF(v, 0)}%`} />
                        <YAxis yAxisId="count" orientation="right" tick={{ fontSize:10 }} />
                        <RTooltip
                          formatter={(value, name, item) => {
                            if (name === 'count') return [fmt(value), 'Rows'];
                            return [`${fmtF(value, 2)}%`, `Event rate (${fmtF(item?.payload?.mean_val, 3)} avg)`];
                          }}
                        />
                        <Legend iconSize={9} wrapperStyle={{ fontSize:10 }} />
                        <Bar yAxisId="count" dataKey="count" fill="#cbd5e1" radius={[3, 3, 0, 0]} name="Rows" />
                        <Line yAxisId="rate" type="monotone" dataKey="tp_rate_pct" stroke={D.orange} strokeWidth={2.5} dot={{ r:3 }} name="Event rate" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <Typography sx={{ mt:1, fontSize:10.5, color:D.textMute }}>
                      X-axis: equal-frequency bins of <strong>{selCol}</strong>. Left Y-axis: event rate for <strong>{targetColumn}</strong>. Right Y-axis: row count in each bin.
                    </Typography>
                  </Box>
                ) : (
                  <Box>
                    <ResponsiveContainer width="100%" height={Math.min(360, targetBreakdownData.length * 26 + 70)}>
                      <BarChart data={targetBreakdownData} layout="vertical" margin={{ top:8, right:18, bottom:8, left:110 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                        <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={(v) => `${fmtF(v, 0)}%`} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={105} />
                        <RTooltip formatter={(value, name, item) => name === 'count' ? [fmt(value), 'Rows'] : [`${fmtF(value, 2)}%`, `Event rate (${fmt(item?.payload?.count)} rows)`]} />
                        <Bar dataKey="tp_rate_pct" fill={D.orange} radius={[0, 3, 3, 0]} name="Event rate" />
                      </BarChart>
                    </ResponsiveContainer>
                    <Typography sx={{ mt:1, fontSize:10.5, color:D.textMute }}>
                      X-axis: event rate for <strong>{targetColumn}</strong>. Y-axis: top values of <strong>{selCol}</strong> ranked by support and target lift.
                    </Typography>
                  </Box>
                )}
                </DrilldownFrame>
              </Card>
            )}

            {/* Numeric stats */}
            {isNumeric&&(
              <Card>
                <SectionLabel>{persona==='business'?'Summary statistics':'Descriptive statistics'}</SectionLabel>
                <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(90px,1fr))', gap:1 }}>
                  {[
                    { k:'Min',    v:fmtF(prof.min,3) },
                    { k:'Q1',     v:fmtF(prof.boxplot?.q1??prof.q1,3) },
                    { k:'Median', v:fmtF(prof.boxplot?.median??prof.median,3) },
                    { k:'Mean',   v:fmtF(prof.mean,3) },
                    { k:'Q3',     v:fmtF(prof.boxplot?.q3??prof.q3,3) },
                    { k:'Max',    v:fmtF(prof.max,3) },
                    { k:'Std',    v:fmtF(prof.std,3) },
                    { k:'Skew',   v:fmtF(prof.skewness??prof.skew,3), warn:Math.abs(prof.skewness??prof.skew??0)>2 },
                    { k:'Kurt',   v:fmtF(prof.kurtosis,3) },
                    { k:'IQR',    v:fmtF(prof.iqr,3) },
                  ].filter(x=>x.v!=='-').map(({k,v,warn})=>(
                    <Box key={k} sx={{ p:1, bgcolor:'#fafbfc', borderRadius:1.5, border:`1px solid ${D.border}` }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, textTransform:'uppercase', display:'block' }}>{k}</Typography>
                      <Typography sx={{ fontWeight:700, fontFamily:'monospace', fontSize:13, color:warn?D.danger:D.textPri }}>{v}</Typography>
                    </Box>
                  ))}
                </Box>
                {persona==='business'&&prof.skew!=null&&Math.abs(prof.skew)>1&&(
                  <InsightPanel
                    what="This column has a skewed distribution"
                    why="Most values are concentrated at one end, with a long tail. This is common for financial amounts."
                    action="Log transformation will be applied automatically in preprocessing to make this feature more useful for the model."
                    severity="info"
                  />
                )}
              </Card>
            )}

            {/* Chart mode toggle */}
            {isNumeric&&(
              <Stack direction="row" spacing={1} alignItems="center">
                <ToggleButtonGroup size="small" value={chartMode} exclusive onChange={(_,v)=>v&&setChartMode(v)}>
                  {[['histogram','Histogram'],['density','Density'],['boxplot','Box Plot'],['both','Hist+Density']].map(([v,l])=>(
                    <ToggleButton key={v} value={v} sx={{ px:1.5, fontSize:11, textTransform:'none' }}>{l}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            )}

            {/* Histogram */}
            {isNumeric&&(chartMode==='histogram'||chartMode==='both')&&histData.length>0&&(
              <Card>
                <SectionLabel>{persona==='business'?'How values are spread':'Histogram'}</SectionLabel>
                <DrilldownFrame
                  title={persona==='business' ? `${selCol} value spread` : `${selCol} histogram`}
                  persona={persona}
                  analysisPayload={histogramPayload}
                  explain={`This histogram shows where most values of ${selCol} are concentrated.`}
                >
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={histData} margin={{ top:5,right:10,bottom:25,left:-5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="label" tick={{ fontSize:9 }} angle={-30} textAnchor="end" interval={Math.ceil(histData.length/12)} />
                      <YAxis tick={{ fontSize:10 }} />
                      <RTooltip formatter={v=>[fmt(v),'Count']} />
                      <Bar dataKey="count" fill={D.orange} radius={[2,2,0,0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
              </Card>
            )}

            {/* Density */}
            {isNumeric&&(chartMode==='density'||chartMode==='both')&&histData.length>0&&(
              <Card>
                <SectionLabel>{persona==='business'?'Value concentration':'Density curve'}</SectionLabel>
                <DrilldownFrame
                  title={persona==='business' ? `${selCol} concentration curve` : `${selCol} density curve`}
                  persona={persona}
                  analysisPayload={densityPayload}
                  explain={`This density curve highlights where ${selCol} values cluster and where the tails begin.`}
                >
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={histToDensity(prof.histogram)} margin={{ top:5,right:10,bottom:25,left:-5 }}>
                      <defs>
                        <linearGradient id="densGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={D.orange} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={D.orange} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis dataKey="x" tick={{ fontSize:9 }} tickFormatter={v=>fmtF(v,1)} />
                      <YAxis tick={{ fontSize:10 }} />
                      <RTooltip formatter={v=>[v.toFixed(4),'Density']} />
                      <Area dataKey="density" stroke={D.orange} strokeWidth={2} fill="url(#densGrad)" />
                      {prof.mean!=null&&<ReferenceLine x={prof.mean} stroke="#374151" strokeDasharray="4 2" label={{ value:'mean',fontSize:9,fill:'#374151' }} />}
                      {prof.median!=null&&<ReferenceLine x={prof.median} stroke={D.info} strokeDasharray="4 2" label={{ value:'median',fontSize:9,fill:D.info }} />}
                    </AreaChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
              </Card>
            )}

            {isNumeric&&chartMode==='boxplot'&&boxplotStats&&(
              <Card>
                <SectionLabel>{persona==='business' ? 'Spread and central tendency' : 'Box-plot summary'}</SectionLabel>
                <Box sx={{ mt:1.5, px:1 }}>
                  <Box sx={{ position:'relative', height:70 }}>
                    <Box sx={{ position:'absolute', top:32, left:0, right:0, height:4, bgcolor:'#e2e8f0', borderRadius:999 }} />
                    <Box sx={{ position:'absolute', top:22, left:boxplotStats.pct(boxplotStats.q1), width:`calc(${boxplotStats.pct(boxplotStats.q3)} - ${boxplotStats.pct(boxplotStats.q1)})`, height:24, bgcolor:D.orangeLight, border:`1px solid ${D.orange}44`, borderRadius:1.5 }} />
                    <Box sx={{ position:'absolute', top:18, left:boxplotStats.pct(boxplotStats.min), width:2, height:32, bgcolor:'#64748b' }} />
                    <Box sx={{ position:'absolute', top:18, left:boxplotStats.pct(boxplotStats.max), width:2, height:32, bgcolor:'#64748b' }} />
                    <Box sx={{ position:'absolute', top:18, left:boxplotStats.pct(boxplotStats.median), width:3, height:32, bgcolor:D.orange }} />
                  </Box>
                  <Box sx={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:1, mt:0.5 }}>
                    {[
                      ['Min', boxplotStats.min],
                      ['Q1', boxplotStats.q1],
                      ['Median', boxplotStats.median],
                      ['Q3', boxplotStats.q3],
                      ['Max', boxplotStats.max],
                    ].map(([label, value]) => (
                      <Box key={label}>
                        <Typography sx={{ fontSize:10, color:D.textSec }}>{label}</Typography>
                        <Typography sx={{ fontSize:12, fontWeight:700, fontFamily:'monospace' }}>{fmtF(value, 3)}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography sx={{ mt:1, fontSize:10.5, color:D.textMute }}>
                    The box shows the interquartile range. The line inside marks the median. The whisker endpoints mark the observed minimum and maximum values.
                  </Typography>
                </Box>
              </Card>
            )}

            {/* Categorical bar */}
            {!isNumeric&&catData.length>0&&(
              <Card>
                <SectionLabel>{persona==='business'?'Most common values':'Value frequency (top 20)'}</SectionLabel>
                <DrilldownFrame
                  title={persona==='business' ? `${selCol} category concentration` : `${selCol} top categories`}
                  persona={persona}
                  analysisPayload={categoryPayload}
                  explain={`This chart ranks the most common categories in ${selCol}.`}
                >
                  <ResponsiveContainer width="100%" height={Math.min(320, catData.length*22+60)}>
                    <BarChart data={catData} layout="vertical" margin={{ top:4,right:60,bottom:4,left:110 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                      <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize:9 }} width={105} />
                      <RTooltip formatter={(value, name, item) => {
                        if (name === 'pct') return [`${fmtF(value, 2)}%`, 'Share'];
                        return [fmt(value), `Count (${fmtF(item?.payload?.pct, 2)}%)`];
                      }} />
                      <Bar dataKey="count" fill={D.orange} radius={[0,3,3,0]}
                        label={{ position:'right', fontSize:9, formatter:v=>fmt(v) }}>
                        {catData.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </DrilldownFrame>
                <Typography sx={{ mt:1, fontSize:10.5, color:D.textMute }}>
                  Y-axis: top values of <strong>{selCol}</strong>. X-axis: supporting row count. Use the target-response panel above to see which categories carry the highest event rate.
                </Typography>
              </Card>
            )}
          </Stack>
         ) : null}
        </Stack>
      </Box>
    </Box>
  );
};

// ============================================================================
// TAB 9 - DATA QUALITY
// ============================================================================
const QualityTab = ({ ds, persona, targetColumn }) => {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const calls = await Promise.allSettled([
        mlopsApi.missingAnalysis({ dataset_id:ds.dataset_id, sample_rows:20000 }),
        mlopsApi.qualityScore({ dataset_id:ds.dataset_id, target_column:targetColumn||'', sample_rows:20000 }),
        mlopsApi.outliers({ dataset_id:ds.dataset_id, method:'iqr', sample_rows:10000 }),
        mlopsApi.duplicates({ dataset_id:ds.dataset_id }),
      ]);
      setData({
        missing: calls[0].status==='fulfilled' ? (calls[0].value?.data||calls[0].value) : null,
        quality: calls[1].status==='fulfilled' ? (calls[1].value?.data||calls[1].value) : null,
        outliers: calls[2].status==='fulfilled' ? (calls[2].value?.data||calls[2].value) : null,
        duplicates: calls[3].status==='fulfilled' ? (calls[3].value?.data||calls[3].value) : null,
      });
    } catch(e) { setErr(e?.message||'Quality analysis failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, targetColumn]);

  useEffect(()=>{ load(); }, [load]);

  if (loading) return <Spinner label="Running data quality analysis..." />;
  if (err)     return <ErrBox msg={err} onRetry={load} />;
  if (!data)   return null;

  const missing = data.missing || {};
  const q = data.quality || {};
  const qScore = q?.overall_score ?? q?.score ?? null;
  const qDims = q?.dimensions || {};
  const missingCols = asArray(missing?.column_summary).filter((row) => Number(row?.pct_missing || 0) > 0).slice(0, 15);
  const outlierCols = asArray(data.outliers?.columns)
    .filter((row) => Number(row?.consensus_outliers || 0) > 0)
    .sort((a, b) => Number(b?.consensus_pct || 0) - Number(a?.consensus_pct || 0))
    .slice(0, 12);
  const recommendations = asArray(q?.recommendations);
  const exactDupCount = Number(data.duplicates?.exact_duplicates ?? data.duplicates?.duplicate_count ?? 0);
  const nonIdDupCount = Number(data.duplicates?.non_id_duplicates ?? 0);
  const completeRowsPct = missing?.total_rows ? (Number(missing.rows_complete || 0) / Number(missing.total_rows || 1)) * 100 : null;
  const lexicon = targetLexicon(targetColumn, persona);
  const qualityDecision = qScore >= 80 ? 'Ready for preprocessing' : qScore >= 60 ? 'Proceed with cleanup plan' : 'Hold and fix quality risks';
  const missingChartData = missingCols.map((row) => ({
    column: short(row.column, 26),
    full_column: row.column,
    pct_missing: Number(row.pct_missing || 0),
    missing_rows: Number(row.missing_count || row.null_count || 0),
  }));
  const outlierChartData = outlierCols.map((row) => ({
    column: short(row.column, 24),
    full_column: row.column,
    outlier_pct: Number(row.consensus_pct || 0),
    outlier_rows: Number(row.consensus_outliers || 0),
  }));
  const missingPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'quality_missingness',
    chartTitle: 'Missingness by column',
    chartFocus: 'where data completeness is weakest',
    targetColumn,
    lexicon,
    deterministicInsight: {
      what: 'This chart ranks the columns with the highest missingness so you can see where the dataset is incomplete.',
      why: 'Missingness affects model reliability, business interpretation, and how much cleanup is required before training.',
      action: 'Prioritise columns with the highest missingness for imputation, fallback sourcing, or removal.',
    },
    facts: compactFacts([
      `${missingChartData.length} columns with missing values are shown.`,
      missingChartData[0] ? `${missingChartData[0].full_column} has ${fmtF(missingChartData[0].pct_missing, 1)}% missing values.` : '',
      missingChartData[1] ? `${missingChartData[1].full_column} is the next most incomplete column at ${fmtF(missingChartData[1].pct_missing, 1)}%.` : '',
    ]),
    watchOut: 'Do not judge a column on missingness alone. Some sparse fields can still be strong if their presence is informative.',
  });
  const outlierPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'quality_outliers',
    chartTitle: 'Outlier concentration by column',
    chartFocus: 'which columns contain the most extreme values',
    targetColumn,
    lexicon,
    deterministicInsight: {
      what: 'This chart highlights where extreme values are concentrated across numeric fields.',
      why: 'Outliers can distort scaling, inflate thresholds, and create unstable model behaviour if not handled consistently.',
      action: 'Review fields with the heaviest outlier concentration for clipping, winsorising, or robust scaling.',
    },
    facts: compactFacts([
      `${outlierChartData.length} numeric columns with outliers are shown.`,
      outlierChartData[0] ? `${outlierChartData[0].full_column} has ${fmt(outlierChartData[0].outlier_rows)} outlier rows (${fmtF(outlierChartData[0].outlier_pct, 1)}%).` : '',
    ]),
    watchOut: 'Extreme values are not always bad data. Some are genuine AML signals and should be retained with careful transformation.',
  });

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Data Quality Assessment</Typography>
            <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
              {persona==='business'
                ? 'Is your data clean enough to build a reliable model?'
                : 'Missing values, outliers, duplicates, consistency checks, and leakage detection'}
            </Typography>
          </Box>
          {qScore!=null&&(
            <Box sx={{ textAlign:'center', px:2 }}>
              <Box sx={{ position:'relative', display:'inline-flex' }}>
                <CircularProgress variant="determinate" value={qScore} size={64}
                  sx={{ color:qColor(qScore), '& .MuiCircularProgress-circle':{ strokeLinecap:'round' } }} />
                <Box sx={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Typography sx={{ fontWeight:900, fontSize:16, color:qColor(qScore) }}>{Math.round(qScore)}</Typography>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ display:'block', fontSize:10, color:D.textSec, mt:0.25 }}>Quality Score</Typography>
              <Typography sx={{ fontSize:11, fontWeight:700, color:qColor(qScore) }}>
                {qScore>=80?'Model-ready':qScore>=60?'Needs review':'Action required'}
              </Typography>
            </Box>
          )}
        </Stack>
      </Card>

      {/* Key quality metrics */}
      <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:1.5 }}>
        <StatCell label="Missing %" value={fmtPct(Number(missing?.overall_missing_pct ?? q?.missing_pct ?? 0))} warn={Number(missing?.overall_missing_pct ?? q?.missing_pct ?? 0) > 5} ok={Number(missing?.overall_missing_pct ?? q?.missing_pct ?? 0) === 0} />
        <StatCell label="Cols Missing" value={fmt(missing?.cols_with_missing ?? missingCols.length)} warn={Number(missing?.cols_with_missing ?? 0) > 0} />
        <StatCell label="Exact Duplicates" value={fmt(exactDupCount)} warn={exactDupCount > 0} ok={exactDupCount === 0} />
        <StatCell label="Non-ID Dups" value={fmt(nonIdDupCount)} warn={nonIdDupCount > 0} />
        <StatCell label="Outlier Rows %" value={fmtPct(Number(data.outliers?.outlier_row_pct ?? 0))} warn={Number(data.outliers?.outlier_row_pct ?? 0) > 3} />
        <StatCell label="Rows Complete" value={completeRowsPct == null ? '-' : fmtPct(completeRowsPct)} ok={completeRowsPct != null && completeRowsPct >= 95} warn={completeRowsPct != null && completeRowsPct < 90} />
      </Box>

      <Card>
        <SectionLabel icon={Article}>
          {persona === 'business' ? 'EDA quality report' : 'Quality readiness report'}
        </SectionLabel>
        <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'repeat(3,minmax(0,1fr))' }, gap:1.25 }}>
          <Box sx={{ p:1.2, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
            <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Decision</Typography>
            <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.35 }}>{qualityDecision}</Typography>
            <Typography sx={{ fontSize:11, color:D.textSec, lineHeight:1.6, mt:0.45 }}>
              This is the quality checkpoint before you move into cleaning, encoding, and feature preparation.
            </Typography>
          </Box>
          <Box sx={{ p:1.2, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
            <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Biggest issue</Typography>
            <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.35 }}>
              {missingChartData[0]?.full_column || outlierChartData[0]?.full_column || 'No major issue flagged'}
            </Typography>
            <Typography sx={{ fontSize:11, color:D.textSec, lineHeight:1.6, mt:0.45 }}>
              {missingChartData[0]
                ? `Highest missingness is ${fmtF(missingChartData[0].pct_missing, 1)}% and should be resolved in preprocessing.`
                : outlierChartData[0]
                  ? `Highest outlier concentration is ${fmtF(outlierChartData[0].outlier_pct, 1)}%.`
                  : 'No dominant missingness or outlier concentration was detected.'}
            </Typography>
          </Box>
          <Box sx={{ p:1.2, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
            <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Next step</Typography>
            <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.35 }}>
              Move to Clean & Transform
            </Typography>
            <Typography sx={{ fontSize:11, color:D.textSec, lineHeight:1.6, mt:0.45 }}>
              Use the preprocessing stage to impute gaps, handle outliers, remove duplicates, and prepare model-ready features.
            </Typography>
          </Box>
        </Box>
      </Card>

      {persona==='business'&&(
        <InsightPanel
          what={qScore>=80?"Your data is in good shape for modelling":"Your data needs cleaning before modelling"}
          why={qScore>=80
            ? "Missing values and duplicates are within acceptable limits. Preprocessing will handle the remaining issues."
            : `High missing rates or duplicate rows can bias the model's predictions. These must be fixed in Step 5 (Preprocessing).`}
          action={qScore>=80?"Proceed to Clean & Transform (Step 5)":"Review the missing value and duplicate sections below before proceeding."}
          severity={qScore>=80?'success':qScore>=60?'warning':'danger'}
        />
      )}

      <Card>
        <SectionLabel icon={Assessment}>
          {persona==='business' ? 'Data health dimensions' : 'Quality dimension breakdown'}
        </SectionLabel>
        <Stack spacing={1}>
          {[
            ['Completeness', Number(qDims.completeness ?? 0)],
            ['Uniqueness', Number(qDims.uniqueness ?? 0)],
            ['Validity', Number(qDims.validity ?? 0)],
            ['Consistency', Number(qDims.consistency ?? 0)],
          ].map(([label, value]) => (
            <Box key={label}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb:0.35 }}>
                <Typography sx={{ fontSize:11, color:D.textPri }}>{label}</Typography>
                <Typography sx={{ fontSize:11, color:qColor(Number(value)), fontWeight:700 }}>{fmtF(value, 1)}</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, Number(value)))}
                sx={{
                  height:8,
                  borderRadius:999,
                  bgcolor:'#e2e8f0',
                  '& .MuiLinearProgress-bar': { bgcolor:qColor(Number(value)) },
                }}
              />
            </Box>
          ))}
        </Stack>
      </Card>

      {recommendations.length > 0 && (
        <Card>
          <SectionLabel icon={Lightbulb}>
            {persona==='business' ? 'Recommended cleanup actions' : 'Service recommendations'}
          </SectionLabel>
          <Stack spacing={1}>
            {recommendations.map((item, index) => (
              <Alert key={`${item.message}-${index}`} severity={item.type === 'success' ? 'success' : item.type === 'warning' ? 'warning' : 'info'}>
                {item.message}
              </Alert>
            ))}
          </Stack>
        </Card>
      )}

      {/* Missing by column */}
      {missingCols.length>0&&(
        <Card>
          <SectionLabel icon={Warning}>
            {persona==='business' ? 'Columns with missing data' : 'Missing value analysis by column'}
          </SectionLabel>
          <DrilldownFrame
            title={persona === 'business' ? 'Missingness by column' : 'Missing value analysis by column'}
            persona={persona}
            analysisPayload={missingPayload}
            explain="This view shows where data completeness is weakest so you can plan imputation, removal, or fallback sourcing."
          >
            <ResponsiveContainer width="100%" height={Math.min(420, missingChartData.length * 28 + 60)}>
              <BarChart data={missingChartData} layout="vertical" margin={{ top:4, right:18, bottom:4, left:160 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={(v) => `${fmtF(v, 0)}%`} domain={[0, 100]} />
                <YAxis type="category" dataKey="column" tick={{ fontSize:9 }} width={150} />
                <RTooltip formatter={(value, name, item) => [`${fmtF(value, 1)}%`, `${item?.payload?.full_column || 'Column'} missing`]} />
                <Bar dataKey="pct_missing" radius={[0, 3, 3, 0]}>
                  {missingChartData.map((row, index) => (
                    <Cell
                      key={`${row.full_column}-${index}`}
                      fill={row.pct_missing > 30 ? D.danger : row.pct_missing > 10 ? D.warn : D.info}
                    />
                  ))}
                </Bar>
                <Brush dataKey="column" height={18} travellerWidth={10} />
              </BarChart>
            </ResponsiveContainer>
          </DrilldownFrame>
          {persona==='business'&&(
            <InsightPanel
              what={`${missingCols.filter((row)=>Number(row.pct_missing || 0)>20).length} columns have more than 20% missing data`}
              why="High missing rates reduce the model's ability to learn from those features. They will be imputed automatically in preprocessing."
              action="Columns with over 50% missing data may need to be dropped. Review the preprocessing plan."
              severity={missingCols.some((row)=>Number(row.pct_missing || 0)>20)?'warning':'info'}
            />
          )}
        </Card>
      )}

      {/* Outliers */}
      {outlierCols.length>0&&(
        <Card>
          <SectionLabel icon={ErrorOutline}>
            {persona==='business' ? 'Columns with extreme values' : 'Outlier detection by column (IQR method)'}
          </SectionLabel>
          <DrilldownFrame
            title={persona === 'business' ? 'Outlier concentration by column' : 'Outlier detection by column'}
            persona={persona}
            analysisPayload={outlierPayload}
            explain="This view shows which numeric columns contain the heaviest concentration of extreme values."
          >
            <ResponsiveContainer width="100%" height={Math.min(380, outlierChartData.length * 26 + 50)}>
              <BarChart data={outlierChartData} layout="vertical" margin={{ top:4, right:18, bottom:4, left:150 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} tickFormatter={(v) => `${fmtF(v, 0)}%`} />
                <YAxis type="category" dataKey="column" tick={{ fontSize:9 }} width={140} />
                <RTooltip formatter={(value, name, item) => [`${fmtF(value, 1)}%`, `${item?.payload?.full_column || 'Column'} outlier rate`]} />
                <Bar dataKey="outlier_pct" fill={D.warn} radius={[0, 3, 3, 0]} />
                <Brush dataKey="column" height={18} travellerWidth={10} />
              </BarChart>
            </ResponsiveContainer>
          </DrilldownFrame>
          {persona==='technical'&&(
            <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, mt:1, display:'block' }}>
              IQR method: values below Q1-1.5xIQR or above Q3+1.5xIQR flagged as outliers
            </Typography>
          )}
        </Card>
      )}

      <Card>
        <SectionLabel icon={TableChart}>
          {persona==='business' ? 'Duplicate analysis' : 'Exact vs non-ID duplicate review'}
        </SectionLabel>
        <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'repeat(3,1fr)' }, gap:1.5 }}>
          <Box sx={{ p:1.25, borderRadius:1.5, bgcolor:'#fafbfc', border:`1px solid ${D.border}` }}>
            <Typography sx={{ fontSize:10, color:D.textSec }}>Exact duplicate rows</Typography>
            <Typography sx={{ fontWeight:800, fontSize:18, color:exactDupCount > 0 ? D.warn : D.ok }}>{fmt(exactDupCount)}</Typography>
            <Typography sx={{ fontSize:10, color:D.textMute }}>{fmtPct(Number(data.duplicates?.exact_dup_pct ?? 0))} of sampled rows</Typography>
          </Box>
          <Box sx={{ p:1.25, borderRadius:1.5, bgcolor:'#fafbfc', border:`1px solid ${D.border}` }}>
            <Typography sx={{ fontSize:10, color:D.textSec }}>Non-ID duplicate rows</Typography>
            <Typography sx={{ fontWeight:800, fontSize:18, color:nonIdDupCount > 0 ? D.warn : D.ok }}>{fmt(nonIdDupCount)}</Typography>
            <Typography sx={{ fontSize:10, color:D.textMute }}>{fmtPct(Number(data.duplicates?.non_id_dup_pct ?? 0))} after excluding identifier columns</Typography>
          </Box>
          <Box sx={{ p:1.25, borderRadius:1.5, bgcolor:'#fafbfc', border:`1px solid ${D.border}` }}>
            <Typography sx={{ fontSize:10, color:D.textSec }}>ID columns excluded</Typography>
            <Typography sx={{ fontWeight:800, fontSize:18, color:D.textPri }}>{fmt(asArray(data.duplicates?.id_columns_excluded).length)}</Typography>
            <Typography sx={{ fontSize:10, color:D.textMute, fontFamily:'monospace' }}>
              {asArray(data.duplicates?.id_columns_excluded).slice(0, 3).join(', ') || 'None'}
            </Typography>
          </Box>
        </Box>
      </Card>
    </Stack>
  );
};

// ============================================================================
// TAB 10 - CORRELATIONS
// ============================================================================
const CorrelationTab = ({ ds, persona, targetColumn, colNames }) => {
  const [method,   setMethod]   = useState('pearson');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState(null);
  const [selCols,  setSelCols]  = useState([]);

  // Exclude ID columns from correlation
  const eligibleCols = (colNames||ds.columns||[]).filter(c=>!isIdCol(c));

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await mlopsApi.correlation({ dataset_id:ds.dataset_id, method, sample_rows:10000,
        columns:eligibleCols.slice(0,30) });
      setData(res?.data||res);
    } catch(e) { setErr(e?.message||'Correlation failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, method]);

  useEffect(()=>{ load(); }, [load]);

  const matrix = data?.matrix||[];
  const cols   = data?.columns||[];
  const HM_CELL = Math.min(52, Math.floor(560/Math.max(cols.length,1)));
  const lkp = {};
  matrix.forEach(r=>{ lkp[`${r.x}||${r.y}`]=r.value; });

  // Top correlated pairs with target
  const targetPairs = cols.length>0&&targetColumn
    ? cols.filter(c=>c!==targetColumn).map(c=>({
        col:c, value:lkp[`${c}||${targetColumn}`]??lkp[`${targetColumn}||${c}`]??null,
      })).filter(p=>p.value!=null).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,12)
    : [];
  const corrLexicon = targetLexicon(targetColumn, persona);
  const targetPairChartData = targetPairs.map((item) => ({
    column: item.col,
    score: Number(item.value || 0),
    abs_score: Math.abs(Number(item.value || 0)),
  }));
  const targetCorrelationPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'correlation_target_pairs',
    chartTitle: `${method} correlation with target`,
    chartFocus: `which columns move most strongly with ${corrLexicon.positiveShort}`,
    targetColumn,
    lexicon: corrLexicon,
    deterministicInsight: {
      what: 'This view ranks the columns most associated with the target so you can see which signals are strongest.',
      why: 'Strong target relationships can indicate useful predictive power, but very high values can also signal leakage or redundant logic.',
      action: 'Review the strongest relationships first and confirm that they are available before prediction time.',
    },
    facts: compactFacts([
      `${targetPairChartData.length} target-linked columns are shown.`,
      targetPairChartData[0] ? `${targetPairChartData[0].column} has ${fmtF(targetPairChartData[0].score, 3)} ${method} correlation with the target.` : '',
      targetPairChartData[1] ? `${targetPairChartData[1].column} is the next strongest visible relationship at ${fmtF(targetPairChartData[1].score, 3)}.` : '',
    ]),
    watchOut: 'Correlation is direction plus strength, not causality. Confirm the field is business-valid and not duplicated elsewhere.',
  });
  const heatmapPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'correlation_heatmap',
    chartTitle: `${method} feature relationship heatmap`,
    chartFocus: 'how features move together as a group',
    targetColumn,
    lexicon: corrLexicon,
    deterministicInsight: {
      what: 'The heatmap shows which features move together and which ones provide independent information.',
      why: 'Highly correlated feature clusters often indicate redundant signals, unstable coefficients, or leakage chains.',
      action: 'Use this view to spot redundant groups and simplify the final feature set before training.',
    },
    facts: compactFacts([
      `${cols.length} columns are included in the heatmap.`,
      targetPairChartData[0] ? `${targetPairChartData[0].column} is currently the strongest visible target-linked signal.` : '',
    ]),
    watchOut: 'A correlation map does not tell you which field is better. Use target-response and business meaning before dropping anything.',
  });

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Box>
          <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Correlation Analysis</Typography>
          <Typography sx={{ fontSize:12, color:D.textSec, mt:0.25 }}>
            {persona==='business'
              ? 'Which columns move together? Strong correlations may be redundant or indicate data leakage.'
              : 'Pearson/Spearman/Kendall correlation heatmap - ID columns excluded automatically'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup size="small" value={method} exclusive onChange={(_,v)=>v&&setMethod(v)}>
            {['pearson','spearman','kendall'].map(m=>(
              <ToggleButton key={m} value={m} sx={{ px:1.5, fontSize:11, textTransform:'none' }}>
                {m.charAt(0).toUpperCase()+m.slice(1)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Button size="small" onClick={load} variant="outlined" startIcon={<Refresh sx={{ fontSize:14 }} />}
            disabled={canDisable(loading)} sx={{ textTransform:'none', borderColor:D.border, color:D.textSec }}>
            {loading?<CircularProgress size={12} sx={{ color:D.orange }} />:'Run'}
          </Button>
        </Stack>
      </Stack>

      {err&&<ErrBox msg={err} onRetry={load} />}

      {/* Top correlated with target */}
      {targetPairs.length>0&&(
        <Card>
          <SectionLabel icon={Flag}>
            {persona==='business' ? `Top features correlated with ${targetColumn}` : `${method} correlation with target: ${targetColumn}`}
          </SectionLabel>
          <DrilldownFrame
            title={persona==='business' ? 'Top target-linked columns' : `${method} correlation with target`}
            persona={persona}
            analysisPayload={targetCorrelationPayload}
            explain="This view ranks the columns that move most strongly with the current prediction target."
          >
            <ResponsiveContainer width="100%" height={Math.min(420, targetPairChartData.length * 28 + 60)}>
              <BarChart data={targetPairChartData} layout="vertical" margin={{ top:4, right:18, bottom:4, left:190 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                <XAxis type="number" tick={{ fontSize:9 }} domain={[-1, 1]} />
                <YAxis type="category" dataKey="column" tick={{ fontSize:9 }} width={180} />
                <RTooltip formatter={(value) => [fmtF(value, 3), `${method} correlation`]} />
                <Bar dataKey="score" radius={[0, 3, 3, 0]}>
                  {targetPairChartData.map((row, index) => (
                    <Cell key={`${row.column}-${index}`} fill={row.score >= 0 ? D.chartTP : D.chartFP} />
                  ))}
                </Bar>
                <ReferenceLine x={0} stroke={D.textMute} strokeDasharray="4 3" />
              </BarChart>
            </ResponsiveContainer>
          </DrilldownFrame>
          {persona==='business'&&(
            <InsightPanel
              what="Columns with high correlation to the target are most predictive"
              why="A correlation above 0.5 (positive or negative) is a strong signal. Correlations above 0.9 may indicate data leakage - the column might be derived from the target."
              action="Check any column with correlation > 0.8 for potential leakage before model training."
              severity="info"
            />
          )}
        </Card>
      )}

      {/* Heatmap */}
      {cols.length>0&&(
        <Card>
          <SectionLabel icon={BubbleChart}>
            {persona==='business' ? 'Feature relationship map' : `${method} correlation heatmap (${cols.length} features)`}
          </SectionLabel>
          <DrilldownFrame
            title={persona==='business' ? 'Feature relationship map' : `${method} correlation heatmap`}
            persona={persona}
            analysisPayload={heatmapPayload}
            explain="This map shows which columns move together, which helps you spot redundancy and potential leakage chains."
          >
          <Box sx={{ overflowX:'auto' }}>
            {/* Column headers */}
            <Box sx={{ display:'flex', ml:`${HM_CELL+4}px` }}>
              {cols.map(c=>(
                <Box key={c} sx={{ width:HM_CELL, flexShrink:0 }}>
                  <Typography sx={{ fontSize:8, fontFamily:'monospace',
                    transform:'rotate(-45deg)', transformOrigin:'bottom left',
                    display:'block', ml:0.5, whiteSpace:'nowrap', color:D.textSec }}>
                    {short(c,10)}
                  </Typography>
                </Box>
              ))}
            </Box>
            {/* Rows */}
            {cols.map(row=>(
              <Box key={row} sx={{ display:'flex', alignItems:'center', mb:'2px' }}>
                <Box sx={{ width:HM_CELL, flexShrink:0 }}>
                  <Typography sx={{ fontSize:8, fontFamily:'monospace', color:D.textSec }} noWrap>{short(row,10)}</Typography>
                </Box>
                {cols.map(col=>{
                  const val=lkp[`${row}||${col}`];
                  return (
                    <Tooltip key={col} title={`${short(row,16)} x ${short(col,16)}: ${val!=null?fmtF(val,3):'-'}`}>
                      <Box sx={{
                        width:HM_CELL, height:HM_CELL, flexShrink:0,
                        bgcolor:corrColor(val), mr:'2px', borderRadius:'2px', cursor:'default',
                        '&:hover':{ transform:'scale(1.2)', zIndex:5, position:'relative', boxShadow:2 },
                        transition:'transform 0.1s',
                      }}>
                        {HM_CELL>=30&&val!=null&&(
                          <Typography sx={{ fontSize:7, color:Math.abs(val)>0.5?'white':'#374151',
                            fontWeight:600, textAlign:'center', lineHeight:`${HM_CELL}px` }}>
                            {fmtF(val,1)}
                          </Typography>
                        )}
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            ))}
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ mt:1.5, flexWrap:'wrap' }} alignItems="center">
            <Typography variant="caption" sx={{ fontSize:10, color:D.textSec }}>Scale: </Typography>
            {[[-1,'negative'],[0,'neutral'],[1,'positive']].map(([v,label])=>(
              <Box key={label} sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
                <Box sx={{ width:14, height:14, bgcolor:corrColor(v), borderRadius:'2px', border:`1px solid ${D.border}` }} />
                <Typography variant="caption" sx={{ fontSize:10, color:D.textSec }}>{label}</Typography>
              </Box>
            ))}
          </Stack>
          </DrilldownFrame>
        </Card>
      )}

      {loading&&<Spinner label="Computing correlation matrix..." />}
    </Stack>
  );
};

// ============================================================================
// TAB 11 - FEATURE VS TARGET (Drivers)
// ============================================================================
const DriversTab = ({ ds, persona, targetColumn, colTypes, colNames, onTargetChange }) => {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const load = useCallback(async () => {
    if (!targetColumn) return;
    setLoading(true); setErr(null);
    try {
      const res = await mlopsApi.featureTarget({ dataset_id:ds.dataset_id, target_column:targetColumn, sample_rows:15000 });
      setData(res?.data||res);
    } catch(e) { setErr(e?.message||'Feature-target analysis failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, targetColumn]);

  useEffect(()=>{ load(); }, [load]);

  const features = useMemo(() => (
    asArray(data?.features)
      .filter((feature) => !isIdCol(feature?.column))
      .map((feature) => {
        const rawScore = feature?.information_gain ?? feature?.importance ?? feature?.iv ?? feature?.correlation ?? 0;
        const metricLabel = feature?.information_gain != null
          ? 'Information Gain'
          : feature?.role === 'categorical'
            ? 'Cramer\'s V'
            : 'Point-Biserial / signal';
        return {
          ...feature,
          score: Math.abs(Number(rawScore || 0)),
          raw_score: Number(rawScore || 0),
          metric_label: metricLabel,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  ), [data]);

  const ivRows = useMemo(() => (
    asArray(data?.features)
      .filter((feature) => !isIdCol(feature?.column) && feature?.iv != null)
      .map((feature) => {
        const woeBins = asArray(feature?.woe_bins);
        const woeValues = woeBins.map((bin) => Number(bin?.woe)).filter((value) => !Number.isNaN(value));
        const range = woeValues.length
          ? `${fmtF(Math.min(...woeValues), 2)} to ${fmtF(Math.max(...woeValues), 2)}`
          : '-';
        return {
          feature: feature.column,
          iv: Number(feature.iv || 0),
          strength: feature.iv_strength || 'Weak',
          woe_range: range,
        };
      })
      .sort((a, b) => b.iv - a.iv)
      .slice(0, 20)
  ), [data]);
  const driverLexicon = targetLexicon(targetColumn, persona);
  const driverChartPayload = buildChartExplanationPayload({
    ds,
    chartKey: 'feature_target_importance',
    chartTitle: 'Top predictive columns',
    chartFocus: `which columns best separate ${driverLexicon.positiveShort} from the rest`,
    targetColumn,
    lexicon: driverLexicon,
    deterministicInsight: {
      what: 'This ranking shows which features currently carry the strongest predictive signal against the selected outcome.',
      why: 'It helps you see which variables are worth protecting in preprocessing and which ones are currently driving model behaviour.',
      action: 'Use the strongest features to validate business logic, while screening them for leakage or instability before training.',
    },
    facts: compactFacts([
      `${features.length} top-ranked features are shown.`,
      features[0] ? `${features[0].column} is currently the strongest visible feature using ${features[0].metric_label}.` : '',
      features[1] ? `${features[1].column} is the next strongest visible feature.` : '',
    ]),
    watchOut: 'Ranking strength is not enough on its own. A strong feature can still be unstable, biased, or unavailable at prediction time.',
  });

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Feature vs Target Analysis</Typography>
          <Typography sx={{ fontSize:12, color:D.textSec, mt:0.25 }}>
            {persona==='business'
              ? 'Which data columns are most useful for predicting genuine alerts?'
              : 'IV/WoE, feature importance ranking, predictive power - ID columns excluded'}
          </Typography>
        </Box>
        <Button size="small" onClick={load} disabled={canDisable(loading||!targetColumn)} variant="outlined"
          startIcon={<Refresh sx={{ fontSize:14 }} />}
          sx={{ textTransform:'none', borderColor:D.border, color:D.textSec }}>
          {loading?<CircularProgress size={12} sx={{ color:D.orange }} />:'Run'}
        </Button>
      </Stack>

      {!targetColumn&&(
        <Alert severity="warning">Select a target column above to run feature-target analysis.</Alert>
      )}

      {err&&<ErrBox msg={err} onRetry={load} />}

      {data&&(
        <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:1.5 }}>
          <StatCell label="Rows Analysed" value={fmt(data.rows_analyzed ?? 0)} />
          <StatCell label="Target Positive %" value={fmtPct(Number(data.target_mean ?? 0) * 100)} />
          <StatCell label="Top Numeric Signals" value={fmt(asArray(data.top_numeric).length)} />
          <StatCell label="Top Categorical Signals" value={fmt(asArray(data.top_categorical).length)} />
        </Box>
      )}

      {features.length>0&&(
        <>
          {persona==='business'&&(
            <InsightPanel
              what="These columns are most predictive of genuine alerts"
              why="A higher importance score means the column carries more signal about whether an alert is real. The model will rely heavily on these features."
              action="Ensure the top features are included in preprocessing and not dropped due to high missing rates."
              severity="info"
            />
          )}

          {/* Feature importance bar */}
          <Card>
            <SectionLabel icon={Flag}>
              {persona==='business' ? 'Top 20 most predictive columns' : 'Feature importance / IV ranking (ID columns excluded)'}
            </SectionLabel>
            <DrilldownFrame
              title={persona==='business' ? 'Top predictive columns' : 'Feature importance and signal ranking'}
              persona={persona}
              analysisPayload={driverChartPayload}
              explain="This chart ranks the columns most strongly associated with the selected target, based on statistical signal rather than GenAI."
            >
              <ResponsiveContainer width="100%" height={Math.min(450, features.length*22+50)}>
                <BarChart data={features} layout="vertical"
                  margin={{ top:4,right:80,bottom:4,left:160 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                  <XAxis type="number" tick={{ fontSize:9 }} />
                  <YAxis type="category" dataKey="column" tick={{ fontSize:9 }} width={155} />
                  <RTooltip formatter={(v,_,p)=>[fmtF(v,4),p.payload.metric_label||'Importance']} />
                  <Bar dataKey="score" radius={[0,3,3,0]}
                    label={{ position:'right', fontSize:9, formatter:v=>fmtF(v,3) }}>
                    {features.map((_,i)=><Cell key={i} fill={D.chart[i%D.chart.length]}/>)}
                  </Bar>
                  <Brush dataKey="column" height={18} travellerWidth={10} />
                </BarChart>
              </ResponsiveContainer>
            </DrilldownFrame>
            <Box sx={{ mt:1.15, p:1.15, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
              <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.45 }}>
                How to read this
              </Typography>
              <Typography sx={{ fontSize:11.5, color:D.textSec, lineHeight:1.65 }}>
                This ranking is statistics-driven. It is not a GenAI judgement and it is not the final trained model. It simply measures which columns look most informative for the current target so the team can decide what to keep, transform, or review.
              </Typography>
            </Box>
          </Card>

          {/* Leakage flags */}
          {features.some(f=>f.leakage_risk==='high')&&(
            <Card danger>
              <SectionLabel icon={Warning}>Potential leakage detected</SectionLabel>
              <Stack spacing={0.75}>
                {features.filter(f=>f.leakage_risk==='high').map(f=>(
                  <Stack key={f.column} direction="row" spacing={1} alignItems="center"
                    sx={{ p:1, bgcolor:D.dangerLight, borderRadius:1, border:`1px solid #fecdd3` }}>
                    <Warning sx={{ fontSize:14, color:D.danger }} />
                    <Box>
                      <Typography sx={{ fontFamily:'monospace', fontSize:11, fontWeight:700 }}>{f.column}</Typography>
                      <Typography sx={{ fontSize:10, color:D.textSec }}>{f.leakage_reason||'High correlation with target - may be derived from it'}</Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
              {persona==='business'&&(
                <InsightPanel
                  what="Some columns may be leaking the answer to the model"
                  why="If a column is derived from the target or would not be available at prediction time, including it will inflate model performance in testing but fail in production."
                  action="Review flagged columns with your data engineering team before proceeding to model training."
                  severity="danger"
                />
              )}
            </Card>
          )}

          {/* IV table - technical only */}
          {persona==='technical'&&ivRows.length>0&&(
            <Card>
              <SectionLabel>Information Value (IV) summary</SectionLabel>
              <Box sx={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:`2px solid ${D.border}` }}>
                      {['Feature','IV','Strength','WoE range'].map(h=>(
                        <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:D.textSec, fontSize:10, fontWeight:700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ivRows.map((r,i)=>(
                      <tr key={r.feature} style={{ background:i%2===0?'#fafbfc':'white', borderBottom:`1px solid ${D.border}` }}>
                        <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:600 }}>{r.feature}</td>
                        <td style={{ padding:'5px 10px' }}>{fmtF(r.iv,4)}</td>
                        <td style={{ padding:'5px 10px' }}>
                          <Chip size="small" label={r.strength||'-'}
                            sx={{ fontSize:9, bgcolor:
                              r.strength==='Very Strong'?D.okLight:r.strength==='Strong'?D.infoLight:D.warnLight,
                              color:r.strength==='Very Strong'?D.ok:r.strength==='Strong'?D.info:D.warn }} />
                        </td>
                        <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:10 }}>{r.woe_range||'-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            </Card>
          )}
        </>
      )}

      {!loading&&features.length===0&&targetColumn&&(
        <Alert severity="info">
          Feature-target analysis returned no ranked features. Check that <strong>{targetColumn}</strong> contains a usable binary outcome such as 0/1, true/false, yes/no, SAR/Non-SAR, or equivalent labelled outcomes.
        </Alert>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 12 - ADVANCED EDA (Suppression Estimator, Leakage, Predictive Power, Drift)
// ============================================================================
const AdvancedEDATab = ({ ds, persona, targetColumn, colNames, detectedCols }) => {
  const [leakage, setLeakage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const eligibleCols = (colNames||[]).filter(c=>!isIdCol(c));

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await mlopsApi.leakageChecks({ dataset_id:ds.dataset_id, target_column:targetColumn, sample_rows:10000 });
      setLeakage(res?.data||res);
    } catch(e) { setErr(e?.message||'Advanced EDA failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, targetColumn]);

  useEffect(()=>{ if(targetColumn) load(); }, [load]);

  // Suppression opportunity estimator (based on class imbalance)
  const fpRate = 0.856; // placeholder - ideally from profile data
  const analytSaved = Math.round(fpRate * (ds.row_count||0) * 0.7);
  const analytCost  = Math.round(analytSaved * 15); // minutes per alert
  const leakageRisks = asArray(leakage?.risks);

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Advanced EDA</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? 'Advanced analysis tools: suppression opportunity sizing, data leakage detection, and feature stability checks'
            : 'Suppression opportunity estimator, predictive power ranking, leakage detection, alert deduplication, and OOT drift analysis'}
        </Typography>
      </Card>

      {/* 1 - Suppression Opportunity Estimator */}
      <Card>
        <SectionLabel icon={AutoGraph}>Suppression Opportunity Estimator</SectionLabel>
        {persona==='business'&&(
          <Typography sx={{ fontSize:11, color:D.textSec, mb:1.5 }}>
            How many analyst-hours can the ML model save if deployed?
          </Typography>
        )}
        <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:1.5, mb:2 }}>
          <StatCell label="Total Alerts"          value={fmt(ds.row_count)} />
          <StatCell label="Est. Class 0 records"  value={fmt(Math.round((ds.row_count||0)*fpRate))} />
          <StatCell label="Suppressible at 70% SR" value={fmt(analytSaved)} ok />
          <StatCell label="Analyst-minutes saved"  value={fmt(analytCost)} ok />
          <StatCell label="Analyst-days (est.)"    value={fmt(Math.round(analytCost/480))} ok />
        </Box>
        {persona==='business'&&(
          <InsightPanel
            what={`The model could eliminate ~${fmt(analytSaved)} false positive reviews`}
            why={`At 70% suppression rate, investigators save approximately ${fmt(Math.round(analytCost/60))} analyst-hours. This estimate assumes ${fmt(ds.row_count)} alerts with 85.6% false positive rate.`}
            action="Present this estimate to leadership to build the business case for model deployment."
            severity="success"
          />
        )}
        {persona==='technical'&&(
          <Typography variant="caption" color="text.secondary" sx={{ fontSize:10 }}>
            Estimate based on: total_alerts x fp_rate x target_suppression_rate x avg_review_time (15 min/alert).
            Actual savings depend on threshold selection and event loss constraint.
          </Typography>
        )}
      </Card>

      {/* 2 - Alert Deduplication Detection */}
      <Card>
        <SectionLabel icon={FilterList}>Alert Deduplication Detection</SectionLabel>
        <Typography sx={{ fontSize:11, color:D.textSec, mb:1.5 }}>
          {persona==='business'
            ? 'Are the same transactions triggering multiple alerts? Duplicate alerts inflate analyst workload artificially.'
            : 'Checking for duplicate alerts across rule engine: same transaction_id, account_id, and risk_score appearing in multiple alerts'}
        </Typography>
        <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'repeat(2,minmax(0,1fr))', xl:'repeat(3,minmax(0,1fr))' }, gap:1.5 }}>
          <Box sx={{ p:1.5, bgcolor:'#f8fafc', borderRadius:1.5, border:`1px solid ${D.border}`, textAlign:'center' }}>
            <ManageSearch sx={{ fontSize:24, color:D.textSec, mb:0.5 }} />
            <Typography sx={{ fontSize:11, color:D.textSec }}>Run deduplication analysis from the Data Quality tab</Typography>
          </Box>
          <Box sx={{ p:1.5, bgcolor:'#f8fafc', borderRadius:1.5, border:`1px solid ${D.border}`, textAlign:'center' }}>
            <DataObject sx={{ fontSize:24, color:D.textSec, mb:0.5 }} />
            <Typography sx={{ fontSize:11, color:D.textSec }}>Duplicate rows are flagged and can be removed in Preprocessing</Typography>
          </Box>
          <Box sx={{ p:1.5, bgcolor:'#f8fafc', borderRadius:1.5, border:`1px solid ${D.border}`, textAlign:'center' }}>
            <CheckCircle sx={{ fontSize:24, color:D.ok, mb:0.5 }} />
            <Typography sx={{ fontSize:11, color:D.textSec }}>Deduplication handled automatically in Step 4 (Clean & Transform)</Typography>
          </Box>
        </Box>
      </Card>

      {/* 3 - Leakage Detection */}
      <Card>
        <SectionLabel icon={GppBad}>Data Leakage Detection</SectionLabel>
        <Typography sx={{ fontSize:11, color:D.textSec, mb:1.5 }}>
          {persona==='business'
            ? 'Are any columns directly revealing the answer to the model? This would make the model look great in testing but fail in production.'
            : 'Columns with correlation > 0.9 to target, or derived from target, or with near-perfect predictive power - potential leakage candidates'}
        </Typography>
        <Alert severity="info" sx={{ mb:1.25 }}>
          Leakage checks combine column-name heuristics with target correlation. Use this panel to identify post-outcome fields such as case status, SAR filing outcome, investigator resolution, or any feature computed after the alert decision point.
        </Alert>
        {!targetColumn&&(
          <Alert severity="info" sx={{ mt:1 }}>Set a target column above to run leakage detection.</Alert>
        )}
        {targetColumn&&(
          <>
            {loading&&<Spinner label="Running leakage checks..." />}
            {err&&<ErrBox msg={err} onRetry={load} />}
            {leakage&&(
              <Stack spacing={1}>
                <Box sx={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:1.25 }}>
                  <StatCell label="Total Risks" value={fmt(leakage?.n_total ?? leakageRisks.length)} warn={Number(leakage?.n_total ?? leakageRisks.length) > 0} />
                  <StatCell label="Critical" value={fmt(leakage?.n_critical ?? 0)} warn={Number(leakage?.n_critical ?? 0) > 0} />
                  <StatCell label="High" value={fmt(leakage?.n_high ?? 0)} warn={Number(leakage?.n_high ?? 0) > 0} />
                </Box>
                {leakageRisks.map((c,i)=>(
                  <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start"
                    sx={{ p:1.5, bgcolor:c.risk_level==='critical'?D.dangerLight:'#fff7ed', borderRadius:1.5, border:`1px solid ${c.risk_level==='critical'?'#fecdd3':'#fed7aa'}` }}>
                    <GppBad sx={{ fontSize:16, color:c.risk_level==='critical'?D.danger:D.warn, mt:0.2 }} />
                    <Box>
                      <Typography sx={{ fontFamily:'monospace', fontSize:11, fontWeight:700 }}>{c.column}</Typography>
                      <Typography sx={{ fontSize:10, color:D.textSec }}>{c.reason}</Typography>
                      <Stack direction="row" spacing={0.75} sx={{ mt:0.5 }}>
                        <Chip size="small" label={c.risk_level || 'risk'} sx={{ fontSize:9, textTransform:'capitalize', bgcolor:c.risk_level==='critical'?D.dangerLight:'#fff7ed', color:c.risk_level==='critical'?D.danger:D.warn }} />
                        {c.correlation != null && (
                          <Chip size="small" label={`correlation: ${fmtF(c.correlation,3)}`}
                            sx={{ fontSize:9, bgcolor:D.dangerLight, color:D.danger }} />
                        )}
                      </Stack>
                    </Box>
                  </Stack>
                ))}
                {leakageRisks.length===0&&(
                  <Alert severity="success">No high-risk leakage detected. Dataset looks clean.</Alert>
                )}
              </Stack>
            )}
            {!leakage&&!loading&&!err&&(
              <Button size="small" variant="outlined" onClick={load}
                sx={{ textTransform:'none', borderColor:D.orange, color:D.orange }}>
                Run Leakage Detection
              </Button>
            )}
          </>
        )}
      </Card>

      {/* 4 - Feature Stability / Behaviour Drift */}
      <Card>
        <SectionLabel icon={Timeline}>Behaviour Drift Detection</SectionLabel>
        <Typography sx={{ fontSize:11, color:D.textSec, mb:1 }}>
          {persona==='business'
            ? 'Have transaction patterns changed over time? Drift means the model trained on old data may not work as well today.'
            : 'OOT (Out-of-Time) stability - compare feature distributions between training period and recent period to detect population shift'}
        </Typography>
        <Alert severity="info">
          Behaviour drift analysis requires a date column. Detected: <code style={{ fontSize:11 }}>{detectedCols.alertDate||'none - check that a date column exists in master dataset'}</code>.
          Run time-trend analysis in the Behavioural Patterns tab as a proxy for drift.
        </Alert>
      </Card>

      {/* 5 - STR Rarity Cluster Detection */}
      <Card>
        <SectionLabel icon={ScatterPlot}>STR Rarity Cluster Detection</SectionLabel>
        <Typography sx={{ fontSize:11, color:D.textSec, mb:1.5 }}>
          {persona==='business'
            ? 'Are there hidden groups of suspicious customers that look similar to each other but different from the rest?'
            : 'Cluster analysis on true positive alerts to identify typology sub-groups (structuring, layering, mule, rapid movement) before model training'}
        </Typography>
        <Box sx={{ p:2, bgcolor:'#f8fafc', borderRadius:1.5, border:`1px solid ${D.border}` }}>
          <Typography sx={{ fontSize:11, color:D.textSec }}>
            This analysis is available after feature engineering in the preprocessing step. The cluster detection runs on the engineered feature set
            ({eligibleCols.filter(c=>c.startsWith('LOG_')||c.startsWith('IS_')||c==='COMBINED_RISK_FLAGS').length} engineered features detected).
            Use the model training step (Step 6) to run unsupervised clustering on the true positive population.
          </Typography>
        </Box>
      </Card>
    </Stack>
  );
};

// ============================================================================
// TAB 13 - INSIGHTS
// ============================================================================
const InsightsTab = ({ ds, persona, targetColumn }) => {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [insightsRes, qualityRes, driversRes] = await Promise.allSettled([
        mlopsApi.insights({ dataset_id:ds.dataset_id, target_column:targetColumn||'', sample_rows:15000 }),
        mlopsApi.qualityScore({ dataset_id:ds.dataset_id, target_column:targetColumn||'', sample_rows:15000 }),
        targetColumn
          ? mlopsApi.featureTarget({ dataset_id:ds.dataset_id, target_column:targetColumn, sample_rows:12000 })
          : Promise.resolve({ data: null }),
      ]);
      setData({
        insights: insightsRes.status === 'fulfilled' ? (insightsRes.value?.data || insightsRes.value || {}) : {},
        quality: qualityRes.status === 'fulfilled' ? (qualityRes.value?.data || qualityRes.value || {}) : {},
        drivers: driversRes.status === 'fulfilled' ? (driversRes.value?.data || driversRes.value || {}) : {},
      });
    } catch(e) { setErr(e?.message||'Insights failed'); }
    finally { setLoading(false); }
  }, [ds.dataset_id, targetColumn]);

  useEffect(()=>{ load(); }, [load]);

  const typeCfg = {
    critical: { bg:D.dangerLight, color:D.danger, border:'#fecdd3', Icon:GppBad,    label:'Critical' },
    warning:  { bg:D.warnLight,   color:D.warn,   border:'#fde68a', Icon:Warning,   label:'Warning'  },
    info:     { bg:D.infoLight,   color:D.info,   border:'#bfdbfe', Icon:Lightbulb, label:'Info'     },
    success:  { bg:D.okLight,     color:D.ok,     border:D.okBorder,Icon:CheckCircle,label:'Good'    },
  };

  const insightData = data?.insights || {};
  const qualityData = data?.quality || {};
  const driverData = data?.drivers || {};
  const groupedInsights = Object.entries(
    (insightData.insights||[]).reduce((acc,i)=>{ acc[i.category]=acc[i.category]||[]; acc[i.category].push(i); return acc; },{})
  );
  const qScore = Number(qualityData?.overall_score ?? qualityData?.score ?? 0);
  const topDriver = asArray(driverData?.features)
    .filter((item) => !isIdCol(item?.column))
    .sort((a, b) => Math.abs(Number(b?.information_gain ?? b?.importance ?? b?.iv ?? 0)) - Math.abs(Number(a?.information_gain ?? a?.importance ?? a?.iv ?? 0)))[0];
  const warningsCount = Number(insightData?.n_warnings || insightData?.n_warning || 0);
  const criticalCount = Number(insightData?.n_criticals || insightData?.n_critical || 0);
  const goodCount = Number(insightData?.n_success || insightData?.n_successes || 0);
  const reportDecision = criticalCount > 0
    ? 'Hold before modelling'
    : warningsCount > 0 || qScore < 75
      ? 'Proceed with controlled cleanup'
      : 'Ready to move to preprocessing';
  const reportRows = [
    ['Quality readiness', qScore ? `${Math.round(qScore)}/100` : '-', qScore >= 80 ? 'Strong enough to proceed with normal cleanup.' : 'Review missingness, duplicates, and outliers before trusting model results.'],
    ['Critical findings', fmt(criticalCount), criticalCount > 0 ? 'Critical issues should be resolved before model building.' : 'No critical blockers were raised by the current automated checks.'],
    ['Warnings', fmt(warningsCount), warningsCount > 0 ? 'Warnings can usually be handled in preprocessing if the business impact is understood.' : 'No material warning cluster is currently visible.'],
    ['Top driver', topDriver?.column || 'Not available', topDriver ? 'This is the strongest current signal against the selected target.' : 'Set a target and run feature analysis to identify the top signals.'],
  ];

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>
            {persona==='business' ? 'Recommendations for Your Data' : 'Automated EDA Insights'}
          </Typography>
          <Typography sx={{ fontSize:12, color:D.textSec, mt:0.25 }}>
            {persona==='business'
              ? 'Plain-English summary of what the data analysis found and what you should do next'
              : 'AML-domain insight engine - automated recommendations from data quality, leakage, imbalance, and feature analysis'}
          </Typography>
        </Box>
        <Button size="small" onClick={load} disabled={canDisable(loading)} variant="outlined"
          startIcon={<Refresh sx={{ fontSize:14 }} />}
          sx={{ textTransform:'none', borderColor:D.border, color:D.textSec }}>
          {loading?<CircularProgress size={12} sx={{ color:D.orange }} />:'Refresh'}
        </Button>
      </Stack>

      {err&&<ErrBox msg={err} onRetry={load} />}
      {loading&&<Spinner label="Generating AML insights..." />}

      {data&&(
        <Stack spacing={2}>
          <Card highlight>
            <SectionLabel icon={Article}>EDA handoff report</SectionLabel>
            <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', md:'repeat(3,minmax(0,1fr))' }, gap:1.25 }}>
              <Box sx={{ p:1.25, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
                <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Decision</Typography>
                <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.3 }}>{reportDecision}</Typography>
                <Typography sx={{ fontSize:11, color:D.textSec, mt:0.55 }}>
                  Use this as the checkpoint before moving into cleaning and feature preparation.
                </Typography>
              </Box>
              <Box sx={{ p:1.25, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
                <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Data readiness</Typography>
                <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.3 }}>
                  Quality score {qScore ? Math.round(qScore) : '-'}
                </Typography>
                <Typography sx={{ fontSize:11, color:D.textSec, mt:0.55 }}>
                  {qScore >= 80 ? 'Data quality is strong enough to move forward with routine cleanup.' : 'Data quality issues should be reviewed before trusting model results.'}
                </Typography>
              </Box>
              <Box sx={{ p:1.25, border:`1px solid ${D.border}`, borderRadius:1.25, bgcolor:'#fff' }}>
                <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.7 }}>Top modelling signal</Typography>
                <Typography sx={{ fontSize:14, fontWeight:700, color:D.textPri, mt:0.3 }}>
                  {topDriver?.column || 'Not available'}
                </Typography>
                <Typography sx={{ fontSize:11, color:D.textSec, mt:0.55 }}>
                  {topDriver ? 'One of the strongest currently observed features from the target-response analysis.' : 'Set a target and run feature analysis to identify the strongest drivers.'}
                </Typography>
              </Box>
            </Box>
          </Card>

          <Card>
            <SectionLabel icon={Assessment}>Report checkpoints</SectionLabel>
            <Box sx={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${D.border}` }}>
                    {['Checkpoint', 'Current status', 'Interpretation'].map((header) => (
                      <th key={header} style={{ textAlign:'left', padding:'7px 10px', color:D.textSec, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5 }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map(([label, value, interpretation]) => (
                    <tr key={label} style={{ borderBottom:`1px solid ${D.borderLight}` }}>
                      <td style={{ padding:'8px 10px', fontWeight:700, color:D.textPri }}>{label}</td>
                      <td style={{ padding:'8px 10px', fontFamily:'monospace', color:D.textPri }}>{value}</td>
                      <td style={{ padding:'8px 10px', color:D.textSec, lineHeight:1.6 }}>{interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Card>

          {/* Summary badges */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {[
              { label:'Critical', value:criticalCount },
              { label:'Warnings', value:warningsCount },
              { label:'Good signals', value:goodCount },
            ].map(({ label, value }) => {
              if (!value) return null;
              return (
                <Box key={label} sx={{ px:1.5, py:0.9, borderRadius:999, bgcolor:'#fff', border:`1px solid ${D.border}` }}>
                  <Typography sx={{ fontSize:16, fontWeight:800, color:D.textPri, lineHeight:1 }}>{value}</Typography>
                  <Typography sx={{ fontSize:10, color:D.textSec, textTransform:'uppercase', letterSpacing:0.8 }}>{label}</Typography>
                </Box>
              );
            })}
          </Stack>

          {/* Grouped by category */}
          {groupedInsights.map(([cat,items])=>(
            <Card key={cat}>
              <SectionLabel>{cat}</SectionLabel>
              <Stack spacing={1}>
                {items.map((insight,i)=>{
                  const cfg = typeCfg[insight.type]||typeCfg.info;
                  return (
                    <Box key={i} sx={{ p:1.25, borderRadius:1, border:`1px solid ${D.border}`, bgcolor:'#fff', display:'flex', gap:1.25 }}>
                      <cfg.Icon sx={{ fontSize:16, color:cfg.color, flexShrink:0, mt:0.1 }} />
                      <Box sx={{ flex:1 }}>
                        <Typography sx={{ fontSize:12, color:D.textPri, lineHeight:1.5 }}>{insight.message}</Typography>
                        {insight.action&&persona==='business'&&(
                          <Typography sx={{ fontSize:11, color:cfg.color, fontWeight:600, mt:0.5 }}>
                            Action: {insight.action}
                          </Typography>
                        )}
                        {insight.metric!=null&&persona==='technical'&&(
                          <Typography sx={{ fontSize:10, color:cfg.color, mt:0.5, fontFamily:'monospace', fontWeight:600 }}>
                            Metric: {typeof insight.metric==='number'?fmtF(insight.metric,4):insight.metric}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Card>
          ))}

          {insightData.insights?.length===0&&(
            <Alert severity="success">No issues detected. Dataset looks clean and ready for preprocessing.</Alert>
          )}

          {/* Business mode: next steps */}
          {persona==='business'&&(
            <Card>
              <SectionLabel icon={CheckCircle}>Recommended Next Steps</SectionLabel>
              <Stack spacing={0}>
                {[
                  'Review any critical or warning issues above with your data engineering team',
                  'Ensure the target column is set correctly before proceeding',
                  'Note the top 5 most predictive features for inclusion in the model',
                  'Confirm that no leakage columns are present',
                  'Proceed to Clean & Transform to fix data quality issues and prepare model-ready features',
                ].map((step,i)=>(
                  <Stack key={i} direction="row" spacing={1.25} alignItems="flex-start" sx={{ py:1.05, borderTop: i === 0 ? 'none' : `1px solid ${D.borderLight}` }}>
                    <Typography sx={{ fontSize:10, fontWeight:700, color:D.orange, minWidth:20, textAlign:'center', pt:0.15 }}>
                      {String(i + 1).padStart(2, '0')}
                    </Typography>
                    <Typography sx={{ fontSize:12, color:D.textSec, lineHeight:1.6 }}>{step}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>
      )}
    </Stack>
  );
};

// ============================================================================
// TAB 14 - INTERACTIVE EXPLORER
// ============================================================================
const ExplorerTab = ({ ds, persona, targetColumn, colNames, colTypes }) => {
  const eligibleCols = (colNames||ds.columns||[]).filter(c=>!isIdCol(c));
  const [xCol,        setXCol]        = useState(eligibleCols[0]||'');
  const [yCol,        setYCol]        = useState(eligibleCols[1]||'');
  const [pairData,    setPairData]    = useState(null);
  const [loadingPair, setLoadingPair] = useState(false);
  const [selCols,     setSelCols]     = useState(eligibleCols.slice(0,5));
  const [bivData,     setBivData]     = useState(null);
  const [loadingBiv,  setLoadingBiv]  = useState(false);
  const isNumericCol = (c) => isNum((colTypes||{})[c]||'');
  const xIsNum = isNumericCol(xCol);
  const yIsNum = isNumericCol(yCol);
  const explorerLexicon = targetLexicon(targetColumn, persona);

  const toggleCol = (col, list, setList, max=8) => {
    setList(prev=>prev.includes(col)?prev.filter(c=>c!==col):prev.length<max?[...prev,col]:prev);
  };

  const runPairplot = async () => {
    setLoadingPair(true);
    try {
      const res = await mlopsApi.pairplot({ dataset_id:ds.dataset_id, columns:selCols, sample_rows:1000 });
      setPairData(res?.data||res);
    } catch {}
    finally { setLoadingPair(false); }
  };

  const runBiv = async () => {
    if (!xCol||!yCol) return;
    setLoadingBiv(true);
    try {
      if (xIsNum && yIsNum) {
        const res = await mlopsApi.pairplot({ dataset_id:ds.dataset_id, columns:[xCol,yCol], sample_rows:1500 });
        const data = res?.data||res;
        const pair = (data?.pairs||[]).find(p=>p.type==='scatter' && p.x===xCol && p.y===yCol);
        setBivData({ mode:'scatter', points: pair?.points||[] });
      } else {
        const res = await mlopsApi.bivariateCategorical({ dataset_id:ds.dataset_id, col_x:xCol, col_y:yCol,
          target_column:targetColumn, sample_rows:5000 });
        const data = res?.data||res;
        setBivData({ mode:'matrix', ...data });
      }
    } catch {}
    finally { setLoadingBiv(false); }
  };

  const bivariatePayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'interactive_bivariate',
    chartTitle: `${xCol || 'X'} vs ${yCol || 'Y'}`,
    chartFocus: `the relationship between ${xCol || 'x'} and ${yCol || 'y'}`,
    targetColumn,
    lexicon: explorerLexicon,
    deterministicInsight: {
      what: xIsNum && yIsNum
        ? `This scatter view shows how ${xCol} and ${yCol} move together across the sampled records.`
        : `This matrix shows how categories of ${xCol} and ${yCol} combine across the sampled records.`,
      why: 'Relationship views help you spot redundant features, natural segments, and combinations that may drive alert outcomes.',
      action: xIsNum && yIsNum
        ? 'Look for clear slopes, clusters, or empty bands that could indicate useful separation or redundancy.'
        : 'Look for dense intersections and category combinations that deserve dedicated target-response checks.',
    },
    facts: compactFacts([
      xCol && yCol ? `Selected columns are ${xCol} and ${yCol}.` : '',
      bivData?.mode === 'scatter' ? `${fmt(asArray(bivData?.points).length)} sampled points are shown.` : '',
      bivData?.mode === 'matrix' ? `${fmt(asArray(bivData?.matrix).length)} matrix cells are available for the selected category pair.` : '',
    ]),
    watchOut: 'Pairwise relationships can be visually interesting but still weak for modelling. Validate them against target response and support.',
  }), [ds, xCol, yCol, targetColumn, explorerLexicon, xIsNum, yIsNum, bivData]);

  const pairplotPayload = useMemo(() => buildChartExplanationPayload({
    ds,
    chartKey: 'interactive_pairplot',
    chartTitle: 'Scatter matrix',
    chartFocus: 'how the selected columns move together as a group',
    targetColumn,
    lexicon: explorerLexicon,
    deterministicInsight: {
      what: 'The scatter matrix compares every selected column against every other selected column in one view.',
      why: 'It helps you spot collinearity, duplicate signal, nonlinear patterns, and columns that have no usable variance.',
      action: 'Use this matrix to decide which columns are redundant, which need transformation, and which are good candidates for the final feature set.',
    },
    facts: compactFacts([
      `${selCols.length} columns are currently selected for the scatter matrix.`,
      pairData?.pairs ? `${fmt(pairData.pairs.length)} mini-charts were generated in the current matrix.` : '',
      selCols.length ? `Selected columns: ${selCols.join(', ')}.` : '',
    ]),
    watchOut: 'Scatter matrices are exploratory. Use feature-target analysis and leakage checks before making final feature decisions.',
  }), [ds, targetColumn, explorerLexicon, selCols, pairData]);
  const scatterPreviewRows = useMemo(
    () => asArray(bivData?.points).slice(0, 12).map((row, index) => ({
      id: index + 1,
      x: row?.x,
      y: row?.y,
    })),
    [bivData],
  );
  const matrixPreviewRows = useMemo(
    () => asArray(bivData?.matrix)
      .map((row) => ({
        x: row?.x,
        y: row?.y,
        value: Number(row?.value || 0),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
    [bivData],
  );

  return (
    <Stack spacing={2.5}>
      <Card highlight>
        <Typography sx={{ fontWeight:800, fontSize:16, color:D.textPri }}>Interactive Explorer</Typography>
        <Typography sx={{ fontSize:12, color:D.textSec, mt:0.5 }}>
          {persona==='business'
            ? 'Explore any two columns together to find patterns. ID columns are excluded automatically.'
            : 'Custom bivariate analysis, scatter matrix, and column-pair exploration - ID columns excluded from selections'}
        </Typography>
      </Card>

      <Alert severity="info" sx={{ borderRadius:2 }}>
        <Typography sx={{ fontSize:12, fontWeight:700, mb:0.5 }}>How to use these charts</Typography>
        <Typography sx={{ fontSize:11, color:D.textSec }}>
          Pick two columns and click Analyse. For scatter plots, choose numeric columns with variance; for categorical pairs, use fields with a small number of categories.
        </Typography>
        <Typography sx={{ fontSize:11, color:D.textSec }}>
          Pairplot needs at least 2 columns. If a chart looks empty, try different columns or reduce highly-sparse/ID fields.
        </Typography>
      </Alert>

      <Card>
        <SectionLabel icon={Insights}>What this tab helps you answer</SectionLabel>
        <Typography sx={{ fontSize:12, color:D.textSec, lineHeight:1.7 }}>
          Use Interactive Explorer when you want to inspect relationships between columns, not just each column alone. It helps answer:
          are two features telling the same story, do categories combine into high-risk pockets, and do selected variables form clean clusters worth keeping in the model?
        </Typography>
      </Card>

      {/* Bivariate custom analysis */}
      <Card>
        <SectionLabel icon={ScatterPlot}>Custom bivariate analysis</SectionLabel>
        <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap" gap={1.5}>
          <FormControl size="small" sx={{ minWidth:180 }}>
            <InputLabel sx={{ fontSize:12 }}>X Column</InputLabel>
            <Select value={xCol} label="X Column" onChange={e=>setXCol(e.target.value)} sx={{ fontSize:12 }}>
              {eligibleCols.map(c=><MenuItem key={c} value={c}><span style={{ fontFamily:'monospace',fontSize:11 }}>{c}</span></MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth:180 }}>
            <InputLabel sx={{ fontSize:12 }}>Y Column</InputLabel>
            <Select value={yCol} label="Y Column" onChange={e=>setYCol(e.target.value)} sx={{ fontSize:12 }}>
              {eligibleCols.map(c=><MenuItem key={c} value={c}><span style={{ fontFamily:'monospace',fontSize:11 }}>{c}</span></MenuItem>)}
            </Select>
          </FormControl>
          <Button size="small" variant="contained" onClick={runBiv} disabled={canDisable(!xCol||!yCol||loadingBiv)}
            sx={{ bgcolor:D.orange, '&:hover':{ bgcolor:D.orangeHover }, boxShadow:'none', textTransform:'none' }}>
            {loadingBiv?<CircularProgress size={14} sx={{ color:'white' }} />:'Analyse'}
          </Button>
        </Stack>

        {bivData?.mode==='scatter' && (
          <Box sx={{ mt:2 }}>
            <DrilldownFrame
              title={`${xCol} vs ${yCol}`}
              persona={persona}
              analysisPayload={bivariatePayload}
              explain={`This scatter view shows how ${xCol} and ${yCol} move together in the sampled records.`}
            >
              <ResponsiveContainer width="100%" height={250}>
                <ScatterChart margin={{ top:8,right:16,bottom:18,left:-5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.borderLight} />
                  <XAxis dataKey="x" name={xCol} tick={{ fontSize:9 }} />
                  <YAxis dataKey="y" name={yCol} tick={{ fontSize:9 }} />
                  <RTooltip cursor={{ strokeDasharray:'3 3' }} />
                  <Scatter data={bivData.points||[]} fill={D.orange} opacity={0.55} r={3} />
                </ScatterChart>
              </ResponsiveContainer>
            </DrilldownFrame>
            {scatterPreviewRows.length > 0 && (
              <Box sx={{ mt:1.1, p:1.1, border:`1px solid ${D.border}`, borderRadius:1.2, bgcolor:'#fff' }}>
                <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.45 }}>
                  Sample row slice
                </Typography>
                <Typography sx={{ fontSize:11.2, color:D.textSec, mb:0.8 }}>
                  These are sampled records from the current scatter view so you can inspect the raw value pairs behind the pattern.
                </Typography>
                <Box sx={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${D.border}` }}>
                        {[ '#', xCol, yCol ].map((header) => (
                          <th key={header} style={{ textAlign:'left', padding:'6px 8px', color:D.textSec, fontSize:10, fontWeight:700 }}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scatterPreviewRows.map((row) => (
                        <tr key={`${row.id}-${row.x}-${row.y}`} style={{ borderBottom:`1px solid ${D.borderLight}` }}>
                          <td style={{ padding:'6px 8px', color:D.textSec }}>{row.id}</td>
                          <td style={{ padding:'6px 8px', fontFamily:'monospace' }}>{fmtF(row.x, 3)}</td>
                          <td style={{ padding:'6px 8px', fontFamily:'monospace' }}>{fmtF(row.y, 3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {bivData?.mode==='matrix' && (
          <Box sx={{ mt:2, overflow:'auto' }}>
            <DrilldownFrame
              title={`${xCol} by ${yCol}`}
              persona={persona}
              analysisPayload={bivariatePayload}
              explain={`This matrix shows which combinations of ${xCol} and ${yCol} occur most often.`}
            >
              <MatrixHeatmap data={bivData} />
            </DrilldownFrame>
            {matrixPreviewRows.length > 0 && (
              <Box sx={{ mt:1.1, p:1.1, border:`1px solid ${D.border}`, borderRadius:1.2, bgcolor:'#fff' }}>
                <Typography sx={{ fontSize:10, fontWeight:700, letterSpacing:0.6, textTransform:'uppercase', color:D.textSec, mb:0.45 }}>
                  Top combinations
                </Typography>
                <Typography sx={{ fontSize:11.2, color:D.textSec, mb:0.8 }}>
                  These are the densest category intersections in the current matrix so you can see which combinations dominate.
                </Typography>
                <Box sx={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${D.border}` }}>
                        {[xCol, yCol, 'Rows'].map((header) => (
                          <th key={header} style={{ textAlign:'left', padding:'6px 8px', color:D.textSec, fontSize:10, fontWeight:700 }}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrixPreviewRows.map((row, index) => (
                        <tr key={`${row.x}-${row.y}-${index}`} style={{ borderBottom:`1px solid ${D.borderLight}` }}>
                          <td style={{ padding:'6px 8px', fontFamily:'monospace' }}>{row.x}</td>
                          <td style={{ padding:'6px 8px', fontFamily:'monospace' }}>{row.y}</td>
                          <td style={{ padding:'6px 8px', color:D.textSec }}>{fmt(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {!loadingBiv && bivData?.mode==='scatter' && (bivData.points||[]).length===0 && (
          <Alert severity="info" sx={{ mt:2 }}>
            No scatter points returned. Try columns with variance (not all zeros) or increase sample size.
          </Alert>
        )}
      </Card>

      {/* Pairplot */}
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb:1.5 }}>
          <Box>
            <Typography sx={{ fontWeight:700, fontSize:14 }}>Scatter matrix (pairplot)</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize:11 }}>
              {persona==='technical'?'Diagonal: histogram. Off-diagonal: scatter. Select up to 8 columns.':'How all selected columns relate to each other at once.'}
            </Typography>
          </Box>
          <Button size="small" variant="contained" onClick={runPairplot}
            disabled={canDisable(selCols.length<2||loadingPair)}
            sx={{ bgcolor:D.orange, '&:hover':{ bgcolor:D.orangeHover }, boxShadow:'none', textTransform:'none', px:2 }}>
            {loadingPair?<CircularProgress size={14} sx={{ color:'white' }} />:'Generate'}
          </Button>
        </Stack>

        <Box sx={{ mb:1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize:10, display:'block', mb:0.75 }}>
            Select columns (up to 8, ID columns excluded):
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {eligibleCols.slice(0,30).map(col=>(
              <Chip key={col} label={col} size="small" clickable
                onClick={()=>toggleCol(col,selCols,setSelCols,8)}
                sx={{
                  fontSize:10, fontFamily:'monospace',
                  bgcolor:selCols.includes(col)?D.orange:'#f1f5f9',
                  color:selCols.includes(col)?'white':D.textSec,
                  '&:hover':{ bgcolor:selCols.includes(col)?D.orangeHover:'#e2e8f0' },
                }} />
            ))}
          </Stack>
        </Box>

        {loadingPair&&<Spinner label="Generating scatter matrix..." />}

        {pairData&&(
          <DrilldownFrame
            title="Scatter matrix"
            persona={persona}
            analysisPayload={pairplotPayload}
            explain="This matrix compares every selected column against every other selected column in one place."
          >
            <Box sx={{ display:'flex', flexWrap:'wrap', gap:1 }}>
              {(pairData.pairs||[]).map((pair,idx)=>(
                <Box key={idx} sx={{ width:160, height:135, border:`1px solid ${D.border}`, borderRadius:1, overflow:'hidden', bgcolor:'#fafbfc' }}>
                  <Typography variant="caption" sx={{ display:'block', textAlign:'center', fontSize:9, fontFamily:'monospace', color:D.textSec, py:0.25, bgcolor:'#f8fafc', borderBottom:`1px solid ${D.border}` }}>
                    {pair.x===pair.y?pair.x:`${short(pair.x,8)} x ${short(pair.y,8)}`}
                  </Typography>
                  {pair.type==='hist' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={pair.bins} margin={{ top:2,right:2,bottom:2,left:-20 }}>
                        <Bar dataKey="count" fill={D.orange} radius={[1,1,0,0]} />
                        <XAxis dataKey="bin_start" tick={{ fontSize:7 }} tickFormatter={v=>fmtF(v,0)} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top:4,right:4,bottom:4,left:-18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey={pair.x} tick={{ fontSize:7 }} />
                        <YAxis dataKey={pair.y} tick={{ fontSize:7 }} />
                        <RTooltip cursor={{ strokeDasharray:'3 3' }} />
                        <Scatter data={pair.points||[]} fill={D.orange} opacity={0.45} r={2} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </Box>
              ))}
            </Box>
          </DrilldownFrame>
        )}
      </Card>
    </Stack>
  );
};

export default EDAScreen;
