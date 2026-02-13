import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Alert,
  Stack,
  Typography,
  LinearProgress,
  Chip,
  Grid,
  Tabs,
  Tab,
  Select,
  MenuItem,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stepper,
  Step,
  StepLabel
} from '@mui/material';
import muleApi from '../services/muleApi';
import AutoBuildFeatureScreen from './feature_screens/AutoBuildFeatureScreen';
import BuildFeatureScreen from './feature_screens/BuildFeatureScreen';
import FeatureStoreScreen from './feature_screens/FeatureStoreScreen';
import FeatureValidationLabScreen from './feature_screens/FeatureValidationLabScreen';
import FeatureDiagnosticsLabScreen from './feature_screens/FeatureDiagnosticsLabScreen';

/* ─── Design tokens ─────────────────────────────────────────── */
const T = {
  bg: '#f6f8fb',
  surface: '#ffffff',
  border: '#e2e8f0',
  borderBright: '#cbd5e1',
  accent: '#e8531a',
  accentDim: 'rgba(232,83,26,0.08)',
  accentDimBorder: 'rgba(232,83,26,0.25)',
  gold: '#c9a227',
  goldDim: 'rgba(201,162,39,0.10)',
  green: '#22c55e',
  greenDim: 'rgba(34,197,94,0.10)',
  amber: '#f59e0b',
  amberDim: 'rgba(245,158,11,0.10)',
  red: '#ef4444',
  redDim: 'rgba(239,68,68,0.10)',
  blue: '#3b82f6',
  text: '#0f172a',
  textMuted: '#475569',
  textDim: '#334155',
  mono: '"JetBrains Mono", "IBM Plex Mono", "Roboto Mono", "Cascadia Code", "Consolas", "Courier New", monospace',
  sans: '"Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif',
  headerBg: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
};

/* ─── Micro components ────────────────────────────────────────── */
const Mono = ({ children, sx = {} }) => (
  <Box component="span" sx={{ fontFamily: T.mono, fontSize: 11, ...sx }}>{children}</Box>
);

const SectionHeader = ({ title, subtitle, right, collapsed, onToggle }) => (
  <Box sx={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    px: 2, py: 1.25,
    borderBottom: `1px solid ${T.border}`,
    background: T.headerBg,
    cursor: onToggle ? 'pointer' : 'default',
  }} onClick={onToggle}>
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: T.textDim, fontFamily: T.sans, textTransform: 'uppercase' }}>
        {title}
      </Typography>
      {subtitle && <Typography sx={{ fontSize: 10, color: T.textMuted, mt: 0.25, fontFamily: T.mono }}>{subtitle}</Typography>}
    </Box>
    <Stack direction="row" spacing={1} alignItems="center" onClick={(e) => e.stopPropagation()}>
      {right}
    </Stack>
  </Box>
);

const MetricPill = ({ label, value, color = T.textDim, bg = 'transparent', border = T.border }) => (
  <Box sx={{
    px: 1.5, py: 0.4,
    border: `1px solid ${border}`,
    background: bg,
    display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
    minWidth: 80,
  }}>
    <Typography sx={{ fontSize: 9, letterSpacing: '0.1em', color: T.textMuted, fontFamily: T.sans, textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: 12, fontWeight: 700, color, fontFamily: T.mono, mt: 0.25 }}>{value ?? '—'}</Typography>
  </Box>
);

const StatusBadge = ({ label, level = 'neutral' }) => {
  const map = {
    good: { bg: T.greenDim, border: 'rgba(34,197,94,0.4)', color: T.green },
    watch: { bg: T.amberDim, border: 'rgba(245,158,11,0.4)', color: T.amber },
    danger: { bg: T.redDim, border: 'rgba(239,68,68,0.4)', color: T.red },
    neutral: { bg: 'rgba(100,116,139,0.1)', border: T.border, color: T.textDim },
    active: { bg: T.accentDim, border: T.accentDimBorder, color: T.accent },
    approved: { bg: T.greenDim, border: 'rgba(34,197,94,0.4)', color: T.green },
    draft: { bg: 'rgba(100,116,139,0.1)', border: T.border, color: T.textMuted },
    retired: { bg: 'rgba(100,116,139,0.07)', border: T.border, color: T.textMuted },
    production: { bg: T.accentDim, border: T.accentDimBorder, color: T.accent },
  };
  const s = map[level] || map.neutral;
  return (
    <Box sx={{ px: 1, py: 0.3, background: s.bg, border: `1px solid ${s.border}`, display: 'inline-block' }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: s.color, fontFamily: T.mono }}>
        {label}
      </Typography>
    </Box>
  );
};

/* ─── Helpers ─────────────────────────────────────────────────── */
const isMissing = (v) => v == null || v === '' || v === '-' || v === '—' || v === 'NaN' || v === 'nan';
const formatPct = (v, digits = 1) => {
  if (isMissing(v) || Number.isNaN(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(digits)}%`;
};
const formatNum = (v, digits = 3) => {
  if (isMissing(v) || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits);
};
const windowHint = (name) => {
  const n = String(name || '').toLowerCase();
  if (n.includes('24h') || n.includes('1d')) return '1D';
  if (n.includes('7d') || n.includes('1w')) return '7D';
  if (n.includes('30d') || n.includes('1m')) return '30D';
  if (n.includes('90d') || n.includes('3m')) return '90D';
  return '—';
};
const healthFor = (row) => {
  const missing = Number(row?.missing_pct ?? 0);
  const leakageHigh = ['HIGH', 'LEAKING'].includes(String(row?.leakage_status || '').toUpperCase());
  const driftBad = String(row?.drift_status || '').toUpperCase() === 'DRIFT';
  if (leakageHigh || missing >= 0.4) return { label: 'DANGER', level: 'danger' };
  if (driftBad || missing >= 0.2) return { label: 'WATCH', level: 'watch' };
  return { label: 'GOOD', level: 'good' };
};
const lifecycleLevel = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'production' || v === 'live') return 'production';
  if (v === 'approved') return 'approved';
  if (v === 'draft') return 'draft';
  if (v === 'retired') return 'retired';
  return 'neutral';
};
const ivLevel = (v) => {
  if (v == null) return T.textMuted;
  const n = Number(v);
  if (n >= 0.3) return T.green;
  if (n >= 0.1) return T.amber;
  return T.red;
};
const psiLevel = (v) => {
  if (v == null) return T.textMuted;
  const n = Number(v);
  if (n < 0.1) return T.green;
  if (n < 0.25) return T.amber;
  return T.red;
};

/* ═══════════════════════════════════════════════════════════════ */
const FeatureEngineeringScreen = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runDetail, setRunDetail] = useState(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [featureExplanation, setFeatureExplanation] = useState(null);
  const [screenTab, setScreenTab] = useState('auto_build');
  const [lastRunUi, setLastRunUi] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [typologyMapping, setTypologyMapping] = useState([]);
  const [selectedTypology, setSelectedTypology] = useState('');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [originInfo, setOriginInfo] = useState(null);
  const [profile, setProfile] = useState(null);
  const [drift, setDrift] = useState(null);
  const [leakage, setLeakage] = useState(null);
  const [compare, setCompare] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [correlations, setCorrelations] = useState(null);
  const [extremes, setExtremes] = useState(null);
  const [governanceHistory, setGovernanceHistory] = useState([]);
  const [approvalStatus, setApprovalStatus] = useState('Draft');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalOwner, setApprovalOwner] = useState('');
  const [leftRun, setLeftRun] = useState('');
  const [rightRun, setRightRun] = useState('');
  const [labTab, setLabTab] = useState('origin');
  const [impact, setImpact] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [monitoring, setMonitoring] = useState({ enabled: true, psi_max: 0.1, iv_min: 0.1, missing_max: 0.2 });
  const [dataStatus, setDataStatus] = useState(null);
  const [dataSchema, setDataSchema] = useState(null);
  const [targetName, setTargetName] = useState(() => localStorage.getItem('mule_target_name') || '');
  const [targetLoading, setTargetLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogStage, setCatalogStage] = useState('');
  const [catalogTag, setCatalogTag] = useState('');
  const [catalogSort, setCatalogSort] = useState({ key: 'feature_name', dir: 'asc' });
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [featureMode, setFeatureMode] = useState(() => localStorage.getItem('mule_feature_mode') || 'behavioral');
  const [entryGateOpen, setEntryGateOpen] = useState(false);
  const [entryGateLoading, setEntryGateLoading] = useState(false);
  const [targetSummary, setTargetSummary] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingRunMode, setPendingRunMode] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardTouchedName, setWizardTouchedName] = useState(false);
  const [wizard, setWizard] = useState({
    feature_name: '',
    typology: '',
    typology_other: '',
    business_description: '',
    expected_behavior: '',
    window: '7d',
    window_days: 7,
    aggregation: 'sum',
    direction: 'outbound',
    entity_level: 'account',
    owner: '',
    data_source: 'mule_transactions'
  });
  const [config, setConfig] = useState({
    dataset_version: '', population: '', reference_date: '',
    lookback: '', transaction_scope: '', segmentation: '', families: '', triggered_by: ''
  });
  const [builder, setBuilder] = useState({
    template: '', aggregation: '', group_by: '', window: '',
    condition: '', normalization: '', peer_comparison: '',
    join_source: '', join_key: '', expression: ''
  });
  const [candidateTemplate, setCandidateTemplate] = useState('');
  const [autoIdeas, setAutoIdeas] = useState([]);
  const [labLoading, setLabLoading] = useState(false);

  const pollRef = useRef(null);
  const validationRef = useRef(null);

  const clearPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const setMode = (m) => {
    const v = m === 'outcome' ? 'outcome' : 'behavioral';
    localStorage.setItem('mule_feature_mode', v);
    setFeatureMode(v);
  };

  const loadTargetSummary = async (name, setLoading) => {
    if (!name) {
      setTargetSummary({ usable_for_supervised_learning: false, target_name: name });
      return null;
    }
    try {
      if (setLoading) setLoading(true);
      const res = await muleApi.getTargetSummary(name);
      setTargetSummary(res || null);
      return res || null;
    } catch (e) {
      setTargetSummary(null);
      return null;
    } finally {
      if (setLoading) setLoading(false);
    }
  };

  const ensureTarget = async () => loadTargetSummary(targetName || 'is_mule', setEntryGateLoading);

  const openEntryGate = async ({ action, runMode = null } = {}) => {
    setPendingAction(action || null);
    setPendingRunMode(runMode);
    setEntryGateOpen(true);
    await ensureTarget();
  };

  const computeDefaultFeatureName = (w) => {
    const agg = String(w?.aggregation || 'sum').toLowerCase();
    const dir = String(w?.direction || '').toLowerCase();
    const wd = w?.window === 'custom' ? `${Number(w?.window_days || 30)}d` : String(w?.window || '30d');
    const base = `${agg}_${dir || 'both'}_${wd}`.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return base || 'custom_feature';
  };

  const previewSql = useMemo(() => {
    const w = wizard || {};
    const feature = (w.feature_name || computeDefaultFeatureName(w)).replace(/[^a-zA-Z0-9_]/g, '_');
    const windowDays = w.window === 'custom' ? Number(w.window_days || 30) : Number(String(w.window || '30d').replace('d', ''));
    const dir = String(w.direction || 'both').toLowerCase();
    const agg = String(w.aggregation || 'sum').toLowerCase();
    const whereDir = dir === 'both' ? '' : `AND LOWER(direction) = '${dir}'\n`;
    const baseWhere = `WHERE environment_id = :env_id\n  AND timestamp >= (SELECT MAX(timestamp) - INTERVAL '${windowDays} days' FROM mule_transactions WHERE environment_id = :env_id)\n  ${whereDir}`.trimEnd();

    if (agg === 'count') {
      return `SELECT\n  account_id,\n  COUNT(*) AS ${feature}\nFROM mule_transactions\n${baseWhere}\nGROUP BY account_id;`;
    }
    if (agg === 'sum') {
      return `SELECT\n  account_id,\n  SUM(amount) AS ${feature}\nFROM mule_transactions\n${baseWhere}\nGROUP BY account_id;`;
    }
    if (agg === 'distinct_counterparty') {
      return `SELECT\n  account_id,\n  COUNT(DISTINCT counterparty_account) AS ${feature}\nFROM mule_transactions\n${baseWhere}\nGROUP BY account_id;`;
    }
    if (agg === 'out_in_ratio') {
      return `WITH w AS (\n  SELECT *\n  FROM mule_transactions\n  WHERE environment_id = :env_id\n    AND timestamp >= (SELECT MAX(timestamp) - INTERVAL '${windowDays} days' FROM mule_transactions WHERE environment_id = :env_id)\n)\nSELECT\n  account_id,\n  SUM(CASE WHEN LOWER(direction) = 'outbound' THEN amount ELSE 0 END)\n    / NULLIF(SUM(CASE WHEN LOWER(direction) = 'inbound' THEN amount ELSE 0 END), 0) AS ${feature}\nFROM w\nGROUP BY account_id;`;
    }
    if (agg === 'avg_time_gap_seconds') {
      return `WITH w AS (\n  SELECT *\n  FROM mule_transactions\n  WHERE environment_id = :env_id\n    AND timestamp >= (SELECT MAX(timestamp) - INTERVAL '${windowDays} days' FROM mule_transactions WHERE environment_id = :env_id)\n), o AS (\n  SELECT account_id, timestamp,\n         LAG(timestamp) OVER (PARTITION BY account_id ORDER BY timestamp) AS prev_ts\n  FROM w\n)\nSELECT\n  account_id,\n  AVG(EXTRACT(EPOCH FROM (timestamp - prev_ts))) AS ${feature}\nFROM o\nWHERE prev_ts IS NOT NULL\nGROUP BY account_id;`;
    }
    return `SELECT\n  account_id,\n  NULL AS ${feature}\nFROM mule_accounts\nWHERE environment_id = :env_id;`;
  }, [wizard]);

  useEffect(() => {
    if (!wizardOpen) return;
    if (wizardTouchedName) return;
    const next = computeDefaultFeatureName(wizard);
    if (String(wizard.feature_name || '') !== String(next)) {
      setWizard((prev) => ({ ...prev, feature_name: next }));
    }
  }, [wizardOpen, wizardTouchedName, wizard.aggregation, wizard.direction, wizard.window, wizard.window_days]);

  const loadRuns = async () => {
    try { const res = await muleApi.getFeatureRunsHistory({ limit: 50 }); setRuns(res?.runs || []); }
    catch { setRuns([]); }
  };
  const loadDataStatus = async () => {
    try { const res = await muleApi.getDataStatus(); setDataStatus(res || null); }
    catch { setDataStatus(null); }
  };
  const loadDataSchema = async () => {
    try {
      const res = await muleApi.getDataSchema();
      setDataSchema(res?.success ? res : null);
    } catch {
      setDataSchema(null);
    }
  };
  const loadCatalog = async () => {
    try {
      const targetParam = targetName ? targetName : '__none__';
      const res = await muleApi.getFeaturesCatalog({ target_name: targetParam });
      const list = res?.features || [];
      if (Array.isArray(list) && list.length) { setCatalog(list); return; }
      const fb = await muleApi.listFeatures();
      const cols = fb?.features || [];
      setCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null, lifecycle_state: 'Draft', production_live: false })));
    } catch {
      try {
        const fb = await muleApi.listFeatures();
        const cols = fb?.features || [];
        setCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null, lifecycle_state: 'Draft', production_live: false })));
      } catch { setCatalog([]); }
    }
  };

  const loadTypologyMapping = async () => {
    try {
      const res = await muleApi.getTypologyMapping();
      const list = Array.isArray(res) ? res : (res?.mappings || []);
      setTypologyMapping(Array.isArray(list) ? list : []);
      if (!selectedTypology && Array.isArray(list) && list.length) {
        setSelectedTypology(list[0]?.typology || '');
      }
    } catch {
      setTypologyMapping([]);
    }
  };

  const loadFeaturePanels = async (feature) => {
    if (!feature) return;
    setLabLoading(true);
    try {
      const targetParam = targetName ? targetName : '__none__';
      const [o, p, d, l, c, lin, corr, gov, ex] = await Promise.all([
        muleApi.getFeatureOrigin(feature).catch(() => null),
        muleApi.getFeatureProfile(feature, undefined, targetParam).catch(() => null),
        muleApi.getFeatureDrift(feature).catch(() => null),
        muleApi.getFeatureLeakage(feature, targetParam).catch(() => null),
        muleApi.compareFeatures(feature, leftRun || undefined, rightRun || undefined).catch(() => null),
        muleApi.getFeatureLineage(feature).catch(() => null),
        muleApi.getFeatureCorrelations(feature, 10).catch(() => null),
        muleApi.getFeatureGovernanceHistory(feature, 50).catch(() => null),
        muleApi.getFeatureExtremes(feature, 20).catch(() => null),
      ]);
      setOriginInfo(o?.success ? o : null);
      setProfile(p?.profile || null);
      setDrift(d || null);
      setLeakage(l || null);
      setCompare(c || null);
      setLineage(lin?.lineage || null);
      setCorrelations(corr || null);
      setGovernanceHistory(gov?.history || []);
      setExtremes(ex || null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load feature analysis');
    } finally {
      setLabLoading(false);
    }
  };

  const loadRunDetail = async (runId) => {
    if (!runId) return;
    setRunDetailLoading(true);
    try { const res = await muleApi.getFeatureRunDetails(runId); setRunDetail(res?.run || null); }
    catch { setRunDetail(null); }
    finally { setRunDetailLoading(false); }
  };

  useEffect(() => {
    loadRuns(); loadDataStatus(); loadTypologyMapping(); loadDataSchema();
    const restore = async () => {
      try {
        const lastJobId = localStorage.getItem('mule_fe_job_id') || undefined;
        const s = await muleApi.getFeatureEngineeringStatus(lastJobId);
        if (s?.success && s?.job_id) {
          setStatus(s);
          localStorage.setItem('mule_fe_job_id', s.job_id);
          if (s?.state === 'running' || s?.state === 'queued') {
            clearPoll();
            pollRef.current = setInterval(async () => {
              try {
                const next = await muleApi.getFeatureEngineeringStatus(s.job_id);
                if (next?.success) setStatus(next);
                if (next?.state === 'completed') { clearPoll(); setLoading(false); loadRuns(); loadCatalog(); }
                if (next?.state === 'failed') { clearPoll(); setLoading(false); setError(next?.error || 'Feature engineering failed'); }
              } catch {}
            }, 1000);
          }
        }
      } catch {}
    };
    restore();
    return () => clearPoll();
  }, []);

  useEffect(() => {
    if (!dataSchema) return;
    const accounts = (dataSchema.accounts || []).map((c) => c.name);
    if (targetName && accounts.includes(targetName)) return;
    const next = accounts.includes('is_mule') ? 'is_mule' : '';
    setTargetName(next);
  }, [dataSchema, targetName]);

  useEffect(() => {
    if (targetName !== undefined) localStorage.setItem('mule_target_name', targetName || '');
    loadTargetSummary(targetName, setTargetLoading);
    loadCatalog();
    if (selectedFeature) loadFeaturePanels(selectedFeature);
  }, [targetName]);

  useEffect(() => {
    setMode(targetSummary?.usable_for_supervised_learning ? 'outcome' : 'behavioral');
  }, [targetSummary?.usable_for_supervised_learning]);

  useEffect(() => {
    if (!selectedFeature && Array.isArray(catalog) && catalog.length) {
      const next = catalog[0]?.feature_name;
      if (next) { setSelectedFeature(next); loadFeaturePanels(next); }
    }
  }, [catalog, selectedFeature]);

  const selectedCatalogRow = useMemo(() => {
    if (!selectedFeature) return null;
    return (catalog || []).find((c) => c.feature_name === selectedFeature) || null;
  }, [catalog, selectedFeature]);

  useEffect(() => {
    setImpact(null);
    const raw = selectedCatalogRow?.governance_comment;
    if (!raw) return;
    try {
      const obj = JSON.parse(String(raw));
      const m = obj?.monitoring;
      if (m && typeof m === 'object') {
        setMonitoring((prev) => ({
          enabled: typeof m.enabled === 'boolean' ? m.enabled : prev.enabled,
          psi_max: m.psi_max != null ? Number(m.psi_max) : prev.psi_max,
          iv_min: m.iv_min != null ? Number(m.iv_min) : prev.iv_min,
          missing_max: m.missing_max != null ? Number(m.missing_max) : prev.missing_max,
        }));
      }
    } catch {}
  }, [selectedCatalogRow?.governance_comment]);

  const readiness = useMemo(() => {
    const row = selectedCatalogRow;
    if (!row) return { ok: false, reasons: ['No feature selected'] };
    const psi = row.psi != null ? Number(row.psi) : null;
    const iv = row.iv != null ? Number(row.iv) : null;
    const missing = row.missing_pct != null ? Number(row.missing_pct) : null;
    const lk = String(row.leakage_status || '').toUpperCase();
    const dr = String(row.drift_status || '').toUpperCase();
    const reasons = [];
    if (psi != null && psi > monitoring.psi_max) reasons.push(`PSI ${formatNum(psi, 3)} > ${monitoring.psi_max}`);
    if (iv != null && iv < monitoring.iv_min) reasons.push(`IV ${formatNum(iv, 3)} < ${monitoring.iv_min}`);
    if (missing != null && missing > monitoring.missing_max) reasons.push(`Missing ${formatPct(missing)} > ${formatPct(monitoring.missing_max)}`);
    if (lk === 'LEAKING') reasons.push('Leakage LEAKING');
    if (dr === 'DRIFT') reasons.push('Stability drift');
    return { ok: reasons.length === 0, reasons };
  }, [selectedCatalogRow, monitoring]);

  const simulateRemovalImpact = async () => {
    if (!selectedFeature) return;
    setImpactLoading(true); setError(null); setImpact(null);
    try {
      const base = { model_type: 'xgboost', validation: { type: 'random', test_size: 0.2, random_state: 42 }, feature_selection: {}, threshold: 0.5, use_smote: true, cv_folds: 3 };
      const baseline = await muleApi.runTraining(base);
      if (!baseline?.success) throw new Error(baseline?.error || 'Baseline training failed');
      const removed = await muleApi.runTraining({ ...base, feature_selection: { exclude: [selectedFeature] } });
      if (!removed?.success) throw new Error(removed?.error || 'Removal training failed');
      setImpact({ baseline, removed, auc_delta: (removed?.metrics?.roc_auc ?? 0) - (baseline?.metrics?.roc_auc ?? 0) });
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'Impact simulation failed'); }
    finally { setImpactLoading(false); }
  };

  const startRun = async (mode, extraPayload = {}) => {
    setLoading(true); setError(null); setStatus(null);
    setLastRunUi((prev) => ({ ...(prev || {}), mode, phase: 'started', started_at: new Date().toISOString() }));
    try {
      const start = await muleApi.engineerFeatures({ mode, config, ...extraPayload });
      if (!start?.success) throw new Error(start?.error || 'Failed to start feature engineering');
      const jobId = start.job_id;
      if (jobId) localStorage.setItem('mule_fe_job_id', jobId);
      setStatus({ ...start, step: 'queued', message: 'Queued' });
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const s = await muleApi.getFeatureEngineeringStatus(jobId);
          if (s?.success) setStatus(s);
          if (s?.state === 'completed') {
            clearPoll();
            setLoading(false);
            await loadRuns();
            await loadCatalog();
            const fn = s?.result?.feature_name;
            if (fn) {
              setSelectedFeature(fn);
              await loadFeaturePanels(fn);
                  await openExplanationFor(fn);
              setTimeout(() => { if (validationRef.current) validationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
            }
            setLastRunUi((prev) => ({ ...(prev || {}), mode, phase: 'completed', completed_at: new Date().toISOString(), job_id: jobId }));
          }
          if (s?.state === 'failed') {
            setLastRunUi((prev) => ({ ...(prev || {}), mode, phase: 'failed', failed_at: new Date().toISOString(), job_id: jobId }));
            clearPoll(); setLoading(false); setError(s?.error || 'Feature engineering failed');
          }
        } catch (e) { clearPoll(); setLoading(false); setError(e?.response?.data?.error || e?.message || 'Status fetch failed'); }
      }, 1000);
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'Feature engineering failed'); setLoading(false); }
  };

  const requestRun = async (mode) => {
    setLastRunUi({ mode, phase: 'clicked', clicked_at: new Date().toISOString() });
    await openEntryGate({ action: 'run', runMode: mode });
  };

  const proceedFromGate = async (nextMode) => {
    setMode(nextMode);
    setEntryGateOpen(false);
    const action = pendingAction;
    const rm = pendingRunMode;
    setPendingAction(null);
    setPendingRunMode(null);
    if (action === 'run' && rm) {
      await startRun(rm);
    }
    if (action === 'wizard') {
      setWizardOpen(true);
      setWizardStep(0);
    }
  };

  const closeGate = () => {
    setEntryGateOpen(false);
    setPendingAction(null);
    setPendingRunMode(null);
  };

  const canUseOutcome = Boolean(targetSummary?.usable_for_supervised_learning);

  const submitWizard = async () => {
    const fName = String(wizard.feature_name || '').trim();
    const typ = String(wizard.typology || '').trim();
    const typOther = String(wizard.typology_other || '').trim();
    const expected = String(wizard.expected_behavior || '').trim();
    const desc = String(wizard.business_description || '').trim();
    const owner = String(wizard.owner || '').trim();
    const window = wizard.window === 'custom' ? 'custom' : String(wizard.window || '30d');
    const windowDays = wizard.window === 'custom' ? Number(wizard.window_days || 30) : Number(String(wizard.window || '30d').replace('d', ''));
    const typology = typ === 'other' ? typOther : typ;
    if (!fName || !typology || !expected || !desc) {
      setError('Please complete: feature name, typology, expected behavior, and business intent.');
      return;
    }
    if (wizard.window === 'custom' && (!Number.isFinite(windowDays) || windowDays <= 0)) {
      setError('Custom window must be a positive number of days.');
      return;
    }

    const expectedRiskDirection =
      expected === 'higher' ? 'HIGHER_MORE_SUSPICIOUS'
        : expected === 'lower' ? 'LOWER_MORE_SUSPICIOUS'
          : expected === 'extreme' ? 'EXTREME_DEVIATION_SUSPICIOUS' : expected;

    setWizardOpen(false);
    await startRun('custom_feature', {
      custom_feature: {
        feature_name: fName,
        typology,
        expected_behavior: expected,
        window,
        window_days: windowDays,
        aggregation: wizard.aggregation,
        direction: wizard.direction,
        entity_level: wizard.entity_level,
      },
      feature_metadata: {
        typology: typology,
        typology_description: typ === 'other' ? typOther : null,
        business_description: desc,
        expected_risk_direction: expectedRiskDirection,
        owner: owner || null,
        window: wizard.window === 'custom' ? `${windowDays}d` : String(wizard.window),
        data_source: wizard.data_source,
        entity_level: wizard.entity_level,
        aggregation: wizard.aggregation,
        direction: wizard.direction,
        transformation_sql: previewSql,
        origin_module: 'wizard',
        built_by: 'custom_feature()',
        code_location: 'backend/api/routes/mule_detection/platform_routes.py::_compute_custom_feature',
      }
    });
  };

  const approveFeature = async (statusValue, { commentOverride, ownerOverride, versionOverride } = {}) => {
    if (!selectedFeature) return;
    try {
      await muleApi.approveFeature({ feature: selectedFeature, status: statusValue, comment: commentOverride ?? approvalComment, owner: ownerOverride ?? approvalOwner, version: versionOverride ?? (compare?.right_run || compare?.left_run || undefined) });
      setApprovalStatus(statusValue); setApprovalComment('');
      loadCatalog();
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'Failed to update approval status'); }
  };

  const runOptions = useMemo(() => runs.map((r) => r.run_id), [runs]);
  const estimation = useMemo(() => {
    const accounts = dataStatus?.accounts_row_count ?? dataStatus?.accountsCount ?? dataStatus?.accounts ?? status?.total_accounts ?? null;
    const tx = dataStatus?.txn_row_count ?? dataStatus?.transactions_row_count ?? dataStatus?.txnCount ?? dataStatus?.transactions ?? null;
    const estRuntimeSec = accounts ? Math.max(10, Math.round(Number(accounts) / 500 * 3)) : null;
    const impact = accounts ? (Number(accounts) >= 100000 ? 'HIGH' : Number(accounts) >= 25000 ? 'MEDIUM' : 'LOW') : null;
    return { accounts, tx, estRuntimeSec, impact };
  }, [dataStatus, status]);

  const filteredCatalog = useMemo(() => {
    const search = String(catalogSearch || '').trim().toLowerCase();
    const tag = String(catalogTag || '').trim().toLowerCase();
    const stage = String(catalogStage || '').trim().toLowerCase();
    const base = Array.isArray(catalog) ? catalog : [];
    const list = base.filter((f) => {
      const lc = String(f.lifecycle_state || f.approval_status || '').toLowerCase();
      if (stage && lc !== stage) return false;
      if (tag && !String(f.category || '').toLowerCase().includes(tag)) return false;
      if (!search) return true;
      return [f.feature_name, f.description, f.formula, f.owner, f.category, f.lifecycle_state].map((x) => String(x || '').toLowerCase()).join(' ').includes(search);
    });
    const { key, dir } = catalogSort || {};
    const mul = dir === 'desc' ? -1 : 1;
    const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    list.sort((a, b) => {
      const av = a?.[key], bv = b?.[key];
      const an = toNum(av), bn = toNum(bv);
      if (an !== null && bn !== null) return (an - bn) * mul;
      return String(av || '').localeCompare(String(bv || '')) * mul;
    });
    return list;
  }, [catalog, catalogSearch, catalogStage, catalogTag, catalogSort]);

  const toggleCatalogSort = (key) => setCatalogSort((prev) => (!prev || prev.key !== key) ? { key, dir: 'asc' } : { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' });

  const selectFeature = async (name) => {
    if (!name || name === selectedFeature) return;
    setSelectedFeature(name); setLabTab('origin');
    await loadFeaturePanels(name);
    setTimeout(() => { if (validationRef.current) validationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
  };

  const openRunDetail = async (runId) => { setRunDetailOpen(true); await loadRunDetail(runId); };
  const closeRunDetail = () => { setRunDetailOpen(false); setRunDetail(null); };

  const openExplanationFor = async (featureName) => {
    const f = String(featureName || '').trim();
    if (!f) return;
    setExplanationOpen(true);
    setExplanationLoading(true);
    setFeatureExplanation(null);
    try {
      const res = await muleApi.getFeatureExplanation(f);
      if (res?.success) {
        setFeatureExplanation(res);
      } else {
        setFeatureExplanation(null);
        setError(res?.error || 'Failed to load feature explanation');
      }
    } catch (e) {
      setFeatureExplanation(null);
      setError(e?.response?.data?.error || e?.message || 'Failed to load feature explanation');
    } finally {
      setExplanationLoading(false);
    }
  };
  const closeExplanation = () => { setExplanationOpen(false); setFeatureExplanation(null); };

  useEffect(() => {
    if (!selectedFeature) return;
    const row = (catalog || []).find((f) => f.feature_name === selectedFeature);
    if (!row) return;
    if (row.lifecycle_state && row.lifecycle_state !== approvalStatus) setApprovalStatus(row.lifecycle_state);
    if ((row.owner || '') !== approvalOwner) setApprovalOwner(row.owner || '');
    if ((row.governance_comment || '') !== approvalComment) setApprovalComment(row.governance_comment || '');
  }, [selectedFeature, catalog]);

  useEffect(() => {
    if (autoIdeas.length) return;
    if (!Array.isArray(catalog) || !catalog.length) return;
    setAutoIdeas(catalog.slice(0, 8).map((f, idx) => ({
      id: `${f.feature_name || 'idea'}-${idx}`,
      feature_name: `${f.feature_name || 'feature'}_rolling_7d`,
      description: `Rolling window variant of ${f.feature_name || 'feature'}`,
      formula: `ROLLING_SUM(${f.feature_name || 'feature'}, 7d)`,
      stage: 'Draft', decision: 'proposed'
    })));
  }, [catalog, autoIdeas.length]);

  const updateAutoIdeaDecision = (id, decision, stage = null) =>
    setAutoIdeas((prev) => prev.map((x) => x.id !== id ? x : { ...x, decision, stage: stage || x.stage }));

  const parseTs = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const durationFromStatus = useMemo(() => {
    const s = status || null;
    const created = parseTs(s?.created_at), updated = parseTs(s?.updated_at);
    if (!created || !updated) return null;
    return Math.max(0, Math.round((updated.getTime() - created.getTime()) / 1000));
  }, [status]);

  /* ─────────────────── STORYTELLING ─────────────────── */
  const story = useMemo(() => {
    const row = selectedCatalogRow;
    if (!row) return null;
    const parts = [];
    const fn = row.feature_name || 'This feature';
    parts.push(`${fn} captures behaviour consistent with mule typologies${row.description ? ` via ${row.description}` : ''}.`);
    if (row.iv != null) {
      const n = Number(row.iv);
      parts.push(`Predictive strength (IV = ${formatNum(row.iv, 3)}) is ${n >= 0.3 ? 'strong — suitable for production modelling' : n >= 0.1 ? 'moderate — useful as supporting signal' : 'weak — consider enrichment before promoting'}.`);
    }
    if (row.psi != null) {
      const n = Number(row.psi);
      parts.push(`Population stability (PSI = ${formatNum(row.psi, 3)}) indicates ${n < 0.1 ? 'no significant distribution shift' : n < 0.25 ? 'moderate shift — monitor closely' : 'significant shift — investigate root cause'}.`);
    }
    if (row.leakage_status) parts.push(`Leakage check: ${String(row.leakage_status).toUpperCase() === 'LEAKING' ? 'SUSPECT — possible post-event contamination. Requires review before promotion.' : String(row.leakage_status).toUpperCase() === 'AT_RISK' ? 'AT RISK — monitor and validate timing boundaries.' : 'CLEAR — no temporal contamination detected.'}`);
    parts.push(readiness.ok ? 'Recommended for production under active monitoring.' : `Not production-ready. Address: ${readiness.reasons.join('; ')}.`);
    return parts.join(' ');
  }, [selectedCatalogRow, readiness]);

  /* ─────────────────── STYLES ─────────────────── */
  const card = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    overflow: 'hidden',
  };
  const cellSx = {
    fontSize: 11, fontFamily: T.mono, py: 0.5, px: 1,
    borderBottom: `1px solid ${T.border}`,
    color: T.textDim,
    whiteSpace: 'nowrap',
  };
  const headCellSx = {
    fontSize: 10, fontFamily: T.sans, py: 0.6, px: 1,
    fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    background: '#f1f5f9',
    color: T.textMuted,
    borderBottom: `1px solid ${T.borderBright}`,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const sortArrow = (key) => {
    if (catalogSort?.key !== key) return '';
    return catalogSort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const runState = status?.state || 'idle';
  const runStateLevel = runState === 'completed' ? 'approved' : runState === 'failed' ? 'danger' : runState === 'running' ? 'active' : 'neutral';
  const sharedUi = { T, card, cellSx, headCellSx, SectionHeader, MetricPill, StatusBadge, formatNum, formatPct, ivLevel, psiLevel, lifecycleLevel, windowHint, healthFor };

  /* ═══════════════════ RENDER ════════════════════════════ */
  return (
    <Box sx={{ p: 0, background: T.bg, minHeight: '100vh', fontFamily: T.sans, color: T.text }}>
      {error && (
        <Alert severity="error" sx={{ borderRadius: 0, mb: 0, fontSize: 12, background: T.redDim, color: T.red, border: `1px solid rgba(239,68,68,0.3)` }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ── TOP COMMAND BAR ── */}
      <Box sx={{
        background: 'linear-gradient(90deg, #ffffff 0%, #f1f5f9 100%)',
        borderBottom: `1px solid ${T.borderBright}`,
        px: 2.5, py: 1.25,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1,
      }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', color: T.text, fontFamily: T.sans }}>
            FEATURE RISK &amp; VALIDATION WORKBENCH
          </Typography>
          <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, mt: 0.25 }}>
            MULE DETECTION · FEATURE ENGINEERING · ASSET GOVERNANCE
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <MetricPill label="Dataset" value={dataStatus?.dataset_version?.slice(0, 14) || 'No data'} />
          <MetricPill label="Accounts" value={estimation.accounts ? Number(estimation.accounts).toLocaleString() : '—'} />
          <MetricPill label="Transactions" value={estimation.tx ? Number(estimation.tx).toLocaleString() : '—'} />
          <MetricPill label="Features" value={catalog.length || '—'} />
          <MetricPill label="Progress" value={typeof status?.progress_pct === 'number' ? `${Math.round(status.progress_pct)}%` : '—'} />
          <MetricPill label="Last Action" value={lastRunUi?.phase ? `${String(lastRunUi.mode || '').toUpperCase()} · ${String(lastRunUi.phase).toUpperCase()}` : '—'} />
          <MetricPill label="Engine" value={runState.toUpperCase()} color={runStateLevel === 'active' ? T.accent : runStateLevel === 'approved' ? T.green : T.textDim} />
        </Stack>
      </Box>

      <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <Tabs value={screenTab} onChange={(_e, v) => setScreenTab(v)}
          sx={{
            minHeight: 44,
            px: 1,
            background: T.surface,
            borderBottom: `1px solid ${T.border}`,
            '& .MuiTab-root': { fontSize: 12, fontWeight: 800, color: T.textMuted, fontFamily: T.sans, minHeight: 44, textTransform: 'none' },
            '& .Mui-selected': { color: T.accent },
            '& .MuiTabs-indicator': { background: T.accent, height: 3 },
          }}>
          <Tab value="auto_build" label="Auto Build Feature" />
          <Tab value="build_feature" label="Feature Workbench" />
          <Tab value="feature_store" label="Feature Store / Asset Registry" />
          <Tab value="feature_validation" label="Feature Validation Lab" />
          <Tab value="feature_lab" label="Feature Diagnostic Lab" />
        </Tabs>
      </Box>

      {screenTab === 'auto_build' && (
        <AutoBuildFeatureScreen
          {...sharedUi}
          loading={loading}
          status={status}
          pipelineOpen={pipelineOpen}
          setPipelineOpen={setPipelineOpen}
          config={config}
          setConfig={setConfig}
          estimation={estimation}
          requestRun={requestRun}
          openEntryGate={openEntryGate}
          runState={runState}
          runStateLevel={runStateLevel}
          durationFromStatus={durationFromStatus}
          runs={runs}
          openRunDetail={openRunDetail}
        />
      )}

      {screenTab === 'build_feature' && (
        <BuildFeatureScreen
          {...sharedUi}
          dataSchema={dataSchema}
          targetSummary={targetSummary}
          featureMode={featureMode}
          targetName={targetName}
        />
      )}

      {screenTab === 'feature_store' && (
        <FeatureStoreScreen
          {...sharedUi}
          filteredCatalog={filteredCatalog}
          catalog={catalog}
          catalogSearch={catalogSearch}
          setCatalogSearch={setCatalogSearch}
          catalogStage={catalogStage}
          setCatalogStage={setCatalogStage}
          catalogTag={catalogTag}
          setCatalogTag={setCatalogTag}
          toggleCatalogSort={toggleCatalogSort}
          sortArrow={sortArrow}
          selectFeature={selectFeature}
          selectedFeature={selectedFeature}
          typologyMapping={typologyMapping}
          selectedTypology={selectedTypology}
          setSelectedTypology={setSelectedTypology}
        />
      )}

      {screenTab === 'feature_validation' && (
        <FeatureValidationLabScreen
          {...sharedUi}
          dataSchema={dataSchema}
          targetName={targetName}
          setTargetName={setTargetName}
          targetSummary={targetSummary}
          targetLoading={targetLoading}
          featureMode={featureMode}
          catalog={catalog}
        />
      )}

      {screenTab === 'feature_lab' && (
        <FeatureDiagnosticsLabScreen
          {...sharedUi}
          featureMode={featureMode}
          selectedFeature={selectedFeature}
          selectedCatalogRow={selectedCatalogRow}
          labTab={labTab}
          setLabTab={setLabTab}
          labLoading={labLoading}
          originInfo={originInfo}
          profile={profile}
          drift={drift}
          leakage={leakage}
          compare={compare}
          lineage={lineage}
          correlations={correlations}
          extremes={extremes}
          governanceHistory={governanceHistory}
          approvalStatus={approvalStatus}
          approvalComment={approvalComment}
          approvalOwner={approvalOwner}
          setApprovalStatus={setApprovalStatus}
          setApprovalComment={setApprovalComment}
          setApprovalOwner={setApprovalOwner}
          approveFeature={approveFeature}
          leftRun={leftRun}
          rightRun={rightRun}
          setLeftRun={setLeftRun}
          setRightRun={setRightRun}
          runOptions={runOptions}
          simulateRemovalImpact={simulateRemovalImpact}
          impact={impact}
          impactLoading={impactLoading}
          readiness={readiness}
          monitoring={monitoring}
          setMonitoring={setMonitoring}
          story={story}
          openExplanationFor={openExplanationFor}
          validationRef={validationRef}
        />
      )}

      {/* ── RUN DETAIL DIALOG ── */}
      <Dialog open={runDetailOpen} onClose={closeRunDetail} maxWidth="lg" fullWidth
        PaperProps={{ sx: { background: T.surface, border: `1px solid ${T.borderBright}`, borderRadius: 0 } }}>
        <DialogTitle sx={{ fontSize: 12, fontWeight: 800, color: T.accent, fontFamily: T.mono, letterSpacing: '0.08em', borderBottom: `1px solid ${T.border}`, py: 1.5 }}>
          RUN REPORT
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: T.border }}>
          {runDetailLoading ? (
            <LinearProgress sx={{ '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />
          ) : !runDetail ? (
            <Typography sx={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>No run detail available.</Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <MetricPill label="Run ID" value={String(runDetail.run_id).slice(0, 20)} />
                <MetricPill label="Type" value={runDetail.run_type || '—'} />
                <MetricPill label="Triggered by" value={runDetail.triggered_by || '—'} />
                <MetricPill label="Status" value={runDetail.status || '—'} color={runDetail.status === 'failed' ? T.red : T.green} />
                <MetricPill label="Input" value={String(runDetail.input_version || '—').slice(0, 18)} />
                <MetricPill label="Output" value={String(runDetail.output_version || runDetail.dataset_version || '—').slice(0, 18)} />
              </Stack>
              <Box>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Summary</Typography>
                <Box sx={{ background: '#ffffff', border: `1px solid ${T.border}`, p: 1.5 }}>
                  <Typography component="pre" sx={{ m: 0, fontSize: 11, fontFamily: T.mono, color: T.text, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(runDetail.summary || {}, null, 2)}
                  </Typography>
                </Box>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', fontFamily: T.sans, textTransform: 'uppercase', mb: 1 }}>Execution Logs</Typography>
                {(runDetail.result?.logs || []).length ? (
                  <TableContainer sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {['Timestamp', 'Step', 'Message'].map((h) => (
                            <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {runDetail.result.logs.map((l, idx) => (
                          <TableRow key={idx}>
                            <TableCell sx={{ ...cellSx, fontSize: 10, color: T.textMuted }}>{l.ts}</TableCell>
                            <TableCell sx={{ ...cellSx, color: T.accent }}>{l.step}</TableCell>
                            <TableCell sx={{ ...cellSx, fontFamily: T.sans }}>{l.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>No logs recorded.</Typography>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${T.border}`, px: 2 }}>
          <Button onClick={closeRunDetail} sx={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, borderRadius: 0 }}>CLOSE</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={explanationOpen} onClose={closeExplanation} maxWidth="md" fullWidth
        PaperProps={{ sx: { background: T.surface, border: `1px solid ${T.borderBright}`, borderRadius: 0 } }}>
        <DialogTitle sx={{ fontSize: 12, fontWeight: 800, color: T.accent, fontFamily: T.mono, letterSpacing: '0.08em', borderBottom: `1px solid ${T.border}`, py: 1.5 }}>
          FEATURE EXPLANATION
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: T.border }}>
          {explanationLoading ? (
            <LinearProgress sx={{ '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />
          ) : !featureExplanation?.explanation ? (
            <Typography sx={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>No explanation available.</Typography>
          ) : (
            <Stack spacing={2}>
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5 }}>
                <Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>FEATURE</Typography>
                <Typography sx={{ fontSize: 12, color: T.text, fontFamily: T.mono, fontWeight: 800 }}>
                  {featureExplanation.feature_name}
                </Typography>
                <Typography sx={{ fontSize: 13, color: T.textDim, fontFamily: T.sans, mt: 0.75, lineHeight: 1.6 }}>
                  {featureExplanation.explanation.display_name}
                </Typography>
              </Box>

              <Grid container spacing={1.5}>
                <Grid item xs={12} md={6}>
                  <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, height: '100%' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                      DATA USED
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
                      Tables: {(featureExplanation.explanation.data_used?.tables || []).join(', ') || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.5 }}>
                      Columns: {(featureExplanation.explanation.data_used?.columns || []).join(', ') || '—'}
                    </Typography>
                    {featureExplanation.explanation.data_used?.entity_level && (
                      <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.5 }}>
                        Level: {featureExplanation.explanation.data_used.entity_level}
                      </Typography>
                    )}
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, height: '100%' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                      TIME LOGIC
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
                      Window: {featureExplanation.explanation.time_logic?.window || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.5 }}>
                      Reference: {featureExplanation.explanation.time_logic?.reference || '—'}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, height: '100%' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                      WHAT WAS MEASURED
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
                      Measure: {featureExplanation.explanation.what_was_measured?.measure || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.5 }}>
                      Aggregation: {featureExplanation.explanation.what_was_measured?.aggregation || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.5 }}>
                      Direction: {featureExplanation.explanation.what_was_measured?.direction || '—'}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5, height: '100%' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                      SUSPICIOUS DIRECTION
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
                      {featureExplanation.explanation.suspicious_direction || '—'}
                    </Typography>
                    {featureExplanation.explanation.typology && (
                      <Typography sx={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, mt: 0.75 }}>
                        Typology: {featureExplanation.explanation.typology}
                      </Typography>
                    )}
                  </Box>
                </Grid>
              </Grid>

              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                  BUSINESS MEANING
                </Typography>
                <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
                  {featureExplanation.explanation.business_meaning || '—'}
                </Typography>
              </Box>

              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', p: 1.5 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', mb: 1 }}>
                  WHAT DOES A HIGH VALUE MEAN?
                </Typography>
                <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
                  {featureExplanation.explanation.high_value_means || '—'}
                </Typography>
              </Box>

              <Box sx={{ border: `1px solid ${T.border}`, background: 'rgba(232,83,26,0.08)', p: 1.5 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.accent, fontFamily: T.mono, letterSpacing: '0.08em', mb: 0.75 }}>
                  BUILD THIS FEATURE (WORKBENCH)
                </Typography>
                <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
                  Use CREATE NEW FEATURE, then describe the behavior, choose the time window, pick the aggregation, and set the suspicious direction.
                </Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${T.border}`, px: 2 }}>
          <Button onClick={closeExplanation} sx={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, borderRadius: 0 }}>CLOSE</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={entryGateOpen} onClose={closeGate} maxWidth="md" fullWidth
        PaperProps={{ sx: { background: T.surface, border: `1px solid ${T.borderBright}`, borderRadius: 0 } }}>
        <DialogTitle sx={{ fontSize: 12, fontWeight: 900, color: T.text, fontFamily: T.sans, letterSpacing: '0.12em', borderBottom: `1px solid ${T.border}`, py: 1.5 }}>
          FEATURE CREATION ENTRY GATE
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: T.border }}>
          {entryGateLoading && <LinearProgress sx={{ mb: 2, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />}

          <Box sx={{ p: 2, border: `1px solid ${T.border}`, background: '#ffffff', mb: 2 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 900, color: T.text, fontFamily: T.sans, mb: 0.75 }}>
              Is an approved outcome label available for validation?
            </Typography>
            <Typography sx={{ fontSize: 12, color: T.textMuted, fontFamily: T.sans, lineHeight: 1.7 }}>
              This decision sets the operating mode for validation and governance. Features are hypothesis-driven risk signals — not blind transformations.
            </Typography>
          </Box>

          {!canUseOutcome && (
            <Alert severity="warning" variant="outlined" sx={{ borderRadius: 0, mb: 2, background: 'rgba(254, 242, 242, 0.4)' }}>
              Outcome labels unavailable. System running in Behavioral Intelligence Mode.
            </Alert>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
            <Chip label={`Current mode: ${featureMode === 'outcome' ? 'Outcome Linked Mode' : 'Behavioral Intelligence Mode'}`} size="small" />
            <Chip label={`Target usable: ${canUseOutcome ? 'YES' : 'NO'}`} size="small" />
            {targetSummary?.positive_rate != null && <Chip label={`Positive rate: ${(Number(targetSummary.positive_rate) * 100).toFixed(2)}%`} size="small" />}
            {targetSummary?.population != null && <Chip label={`Population: ${Number(targetSummary.population).toLocaleString()}`} size="small" />}
            {targetSummary?.last_refresh && <Chip label={`Freshness: ${String(targetSummary.last_refresh).slice(0, 16)}`} size="small" />}
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="contained"
              disabled={entryGateLoading || !canUseOutcome}
              onClick={() => proceedFromGate('outcome')}
              sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 12, fontWeight: 900, px: 2, py: 1, '&:hover': { bgcolor: '#c9461a' }, '&:disabled': { bgcolor: 'rgba(232,83,26,0.25)', color: T.textMuted } }}
            >
              YES – Use supervised validation
            </Button>
            <Button
              variant="outlined"
              disabled={entryGateLoading}
              onClick={() => proceedFromGate('behavioral')}
              sx={{ borderColor: T.border, color: T.textDim, borderRadius: 0, fontSize: 12, fontWeight: 900, px: 2, py: 1 }}
            >
              NO – Use behavioral/anomaly validation
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${T.border}`, px: 2 }}>
          <Button onClick={closeGate} sx={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, borderRadius: 0 }}>CLOSE</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={wizardOpen} onClose={() => setWizardOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { background: T.surface, border: `1px solid ${T.borderBright}`, borderRadius: 0 } }}>
        <DialogTitle sx={{ fontSize: 12, fontWeight: 900, color: T.text, fontFamily: T.sans, letterSpacing: '0.12em', borderBottom: `1px solid ${T.border}`, py: 1.5 }}>
          FEATURE BUILD WIZARD
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: T.border }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`Mode: ${featureMode === 'outcome' ? 'Outcome Linked Mode' : 'Behavioral Intelligence Mode'}`} size="small" />
              <Chip label="Entity: account" size="small" />
            </Stack>

            <Stepper activeStep={wizardStep} alternativeLabel>
              {['Typology', 'Expected behavior', 'Window & aggregation', 'Identity', 'Preview'].map((l) => (
                <Step key={l}><StepLabel>{l}</StepLabel></Step>
              ))}
            </Stepper>

            {wizardStep === 0 && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Typology</InputLabel>
                    <Select
                      value={wizard.typology}
                      label="Typology"
                      onChange={(e) => setWizard((p) => ({ ...p, typology: e.target.value }))}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      <MenuItem value=""><em style={{ fontSize: 11 }}>Select typology</em></MenuItem>
                      {['rapid movement', 'structuring', 'funnel', 'device sharing', 'velocity', 'dormancy break', 'peer deviation', 'other'].map((t) => (
                        <MenuItem key={t} value={t} sx={{ fontSize: 12, fontFamily: T.mono }}>{t}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  {wizard.typology === 'other' ? (
                    <TextField
                      size="small"
                      label="Describe typology"
                      value={wizard.typology_other}
                      onChange={(e) => setWizard((p) => ({ ...p, typology_other: e.target.value }))}
                      fullWidth
                      InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                      sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    />
                  ) : (
                    <Box sx={{ p: 1.5, border: `1px solid ${T.border}`, background: '#ffffff', height: '100%' }}>
                      <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, lineHeight: 1.7 }}>
                        Selecting a typology links the feature to AML expertise and enables governance mapping.
                      </Typography>
                    </Box>
                  )}
                </Grid>
              </Grid>
            )}

            {wizardStep === 1 && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Expected behavior</InputLabel>
                    <Select
                      value={wizard.expected_behavior}
                      label="Expected behavior"
                      onChange={(e) => setWizard((p) => ({ ...p, expected_behavior: e.target.value }))}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      <MenuItem value=""><em style={{ fontSize: 11 }}>Select expectation</em></MenuItem>
                      <MenuItem value="higher" sx={{ fontSize: 12, fontFamily: T.mono }}>Higher value → more suspicious</MenuItem>
                      <MenuItem value="lower" sx={{ fontSize: 12, fontFamily: T.mono }}>Lower value → more suspicious</MenuItem>
                      <MenuItem value="extreme" sx={{ fontSize: 12, fontFamily: T.mono }}>Extreme deviation → suspicious</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    size="small"
                    label="Business intent"
                    value={wizard.business_description}
                    onChange={(e) => setWizard((p) => ({ ...p, business_description: e.target.value }))}
                    fullWidth
                    multiline
                    rows={3}
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.sans, background: '#ffffff', color: T.text } }}
                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                  />
                </Grid>
              </Grid>
            )}

            {wizardStep === 2 && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Time window</InputLabel>
                    <Select
                      value={wizard.window}
                      label="Time window"
                      onChange={(e) => {
                        const v = e.target.value;
                        setWizard((p) => ({ ...p, window: v, window_days: v === '7d' ? 7 : v === '30d' ? 30 : v === '90d' ? 90 : p.window_days }));
                      }}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      {['7d', '30d', '90d', 'custom'].map((w) => (
                        <MenuItem key={w} value={w} sx={{ fontSize: 12, fontFamily: T.mono }}>{w}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Aggregation</InputLabel>
                    <Select
                      value={wizard.aggregation}
                      label="Aggregation"
                      onChange={(e) => setWizard((p) => ({ ...p, aggregation: e.target.value }))}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      <MenuItem value="sum" sx={{ fontSize: 12, fontFamily: T.mono }}>sum(amount)</MenuItem>
                      <MenuItem value="count" sx={{ fontSize: 12, fontFamily: T.mono }}>count(tx)</MenuItem>
                      <MenuItem value="distinct_counterparty" sx={{ fontSize: 12, fontFamily: T.mono }}>distinct(counterparty)</MenuItem>
                      <MenuItem value="out_in_ratio" sx={{ fontSize: 12, fontFamily: T.mono }}>outbound/inbound ratio</MenuItem>
                      <MenuItem value="avg_time_gap_seconds" sx={{ fontSize: 12, fontFamily: T.mono }}>avg time gap (seconds)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Direction</InputLabel>
                    <Select
                      value={wizard.direction}
                      label="Direction"
                      onChange={(e) => setWizard((p) => ({ ...p, direction: e.target.value }))}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      <MenuItem value="outbound" sx={{ fontSize: 12, fontFamily: T.mono }}>outbound</MenuItem>
                      <MenuItem value="inbound" sx={{ fontSize: 12, fontFamily: T.mono }}>inbound</MenuItem>
                      <MenuItem value="both" sx={{ fontSize: 12, fontFamily: T.mono }}>both</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {wizard.window === 'custom' && (
                  <Grid item xs={12} md={4}>
                    <TextField
                      size="small"
                      label="Custom window (days)"
                      value={wizard.window_days}
                      onChange={(e) => setWizard((p) => ({ ...p, window_days: Number(e.target.value) }))}
                      fullWidth
                      InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                      sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    />
                  </Grid>
                )}
              </Grid>
            )}

            {wizardStep === 3 && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    size="small"
                    label="Feature name"
                    value={wizard.feature_name}
                    onChange={(e) => { setWizardTouchedName(true); setWizard((p) => ({ ...p, feature_name: e.target.value })); }}
                    fullWidth
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    size="small"
                    label="Owner"
                    value={wizard.owner}
                    onChange={(e) => setWizard((p) => ({ ...p, owner: e.target.value }))}
                    fullWidth
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    size="small"
                    label="Data source"
                    value={wizard.data_source}
                    onChange={(e) => setWizard((p) => ({ ...p, data_source: e.target.value }))}
                    fullWidth
                    InputProps={{ sx: { borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text } }}
                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                  />
                </Grid>
              </Grid>
            )}

            {wizardStep === 4 && (
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 900, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>
                    PREVIEW FORMULA (SQL)
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography component="pre" sx={{ m: 0, fontSize: 11, fontFamily: T.mono, color: T.text, whiteSpace: 'pre-wrap' }}>
                    {previewSql}
                  </Typography>
                </Box>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${T.border}`, px: 2, justifyContent: 'space-between' }}>
          <Button
            onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
            disabled={wizardStep === 0}
            sx={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, borderRadius: 0 }}
          >
            BACK
          </Button>
          <Stack direction="row" spacing={1}>
            {wizardStep < 4 ? (
              <Button
                variant="contained"
                onClick={() => setWizardStep((s) => Math.min(4, s + 1))}
                disabled={
                  (wizardStep === 0 && (!wizard.typology || (wizard.typology === 'other' && !wizard.typology_other))) ||
                  (wizardStep === 1 && (!wizard.expected_behavior || !wizard.business_description)) ||
                  (wizardStep === 2 && (wizard.window === 'custom' && (!wizard.window_days || Number(wizard.window_days) <= 0))) ||
                  (wizardStep === 3 && (!wizard.feature_name || !wizard.business_description))
                }
                sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 900, '&:hover': { bgcolor: '#c9461a' } }}
              >
                NEXT
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={submitWizard}
                sx={{ bgcolor: T.accent, color: '#fff', borderRadius: 0, fontSize: 11, fontWeight: 900, '&:hover': { bgcolor: '#c9461a' } }}
              >
                RUN
              </Button>
            )}
            <Button onClick={() => setWizardOpen(false)} sx={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, borderRadius: 0 }}>
              CLOSE
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FeatureEngineeringScreen;
