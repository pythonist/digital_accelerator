import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoFixHigh,
  DataObject,
  FilterAlt,
  Insights,
  PlaylistAddCheck,
  Schema,
  Star,
  StarBorder,
  Storage,
  Tune,
} from '@mui/icons-material';

import mlopsApi from '../services/mlopsApi';
import { WorkbenchMetricGrid, WorkbenchSection } from './MuleWorkbenchChrome';
import { getScreenState } from '../utils/pipelineState';

const TAB_DEFS = [
  { id: 'classification', label: 'Column Classification', Icon: Schema },
  { id: 'encoding', label: 'Encoding & Transformation', Icon: DataObject },
  { id: 'engineering', label: 'Feature Engineering', Icon: Insights },
  { id: 'store', label: 'Feature Store', Icon: Storage },
  { id: 'selection', label: 'Feature Selection', Icon: PlaylistAddCheck },
  { id: 'run', label: 'Pipeline Run', Icon: Tune },
];

const SCREEN_KEY = 'mule_preprocess_workbench';
const ID_REGEX = /(customer|account|device|merchant|counterparty|beneficiary|transaction|session|cluster|run|artifact|job)[_\s-]*id$/i;
const DATE_REGEX = /(date|timestamp|time|ts|opened_at|updated_at|created_at|event)/i;
const LEAKAGE_REGEX = /(label|outcome|target|mule_flag|mule_category|typology|prediction|score_output|post_)/i;
const NUMERIC_HINT_REGEX = /(amount|count|ratio|score|risk|age|days|velocity|turnover|balance|hour|month|week|gap|freq|number|pct|flag)$/i;
const SCALE_EXEMPT_REGEX = /(tree|forest|boost|xgboost|lightgbm|hist|extra trees)/i;

const fmt = (value) => Number(value || 0).toLocaleString();
const asArray = (value) => (Array.isArray(value) ? value : []);

const titleCase = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase())
  .trim();

const normalizeColumn = (entry) => {
  if (entry && typeof entry === 'object') {
    return {
      name: String(entry.name || entry.column_name || entry.id || '').trim(),
      dtype: String(entry.dtype || entry.type || entry.data_type || '').trim(),
      distinctCount: Number(entry.distinct_count || entry.unique_values_count || entry.nunique || 0),
      nullRate: Number(entry.null_rate || entry.missing_pct || 0),
      sourceTable: String(entry.source_table || entry.table || '').trim(),
    };
  }
  return {
    name: String(entry || '').trim(),
    dtype: '',
    distinctCount: 0,
    nullRate: 0,
    sourceTable: '',
  };
};

const inferDetectedType = (name, dtype = '') => {
  const loweredName = String(name || '').trim().toLowerCase();
  const loweredType = String(dtype || '').trim().toLowerCase();
  if (DATE_REGEX.test(loweredName) || /date|time|timestamp/.test(loweredType)) return 'datetime';
  if (/(bool|bit)/.test(loweredType) || loweredName.endsWith('_flag')) return 'categorical';
  if (/(int|float|double|decimal|number|numeric)/.test(loweredType) || NUMERIC_HINT_REGEX.test(loweredName)) return 'numerical';
  return 'categorical';
};

const inferBusinessRole = (name, detectedType) => {
  const lowered = String(name || '').trim().toLowerCase();
  if (LEAKAGE_REGEX.test(lowered)) return 'Leakage Risk';
  if (ID_REGEX.test(lowered)) return 'Identifier';
  if (/device|ip|counterparty|beneficiary|merchant|network|graph|ring/.test(lowered)) return 'Network Signal';
  if (/amount|balance|turnover|cash/.test(lowered)) return 'Monetary Behaviour';
  if (/hour|day|month|week|date|time|recency|age|gap/.test(lowered)) return 'Temporal Behaviour';
  if (detectedType === 'datetime') return 'Datetime Input';
  if (detectedType === 'numerical') return 'Numeric Signal';
  return 'Categorical Descriptor';
};

const inferEncoding = (name, detectedType, distinctCount) => {
  const lowered = String(name || '').trim().toLowerCase();
  if (LEAKAGE_REGEX.test(lowered) || ID_REGEX.test(lowered)) return 'Exclude from modelling';
  if (detectedType === 'datetime') return 'Datetime feature derivation';
  if (/(flag|yn|yes_no|is_)/.test(lowered)) return 'Binary mapping';
  if (detectedType === 'numerical') return 'Keep numeric';
  if (distinctCount > 50 || /device|ip|email|phone|counterparty|merchant/.test(lowered)) return 'Frequency encoding';
  if (/risk|rating|band|level|status/.test(lowered)) return 'Ordinal encoding';
  return 'One-hot encoding';
};

const inferColumnNotes = (role, encoding) => {
  if (role === 'Leakage Risk') return 'Potential outcome or post-event field. Keep out of model inputs.';
  if (role === 'Identifier') return 'Identifier-like field. Useful for lineage, not direct prediction.';
  if (encoding === 'Frequency encoding') return 'High-cardinality field. Frequency-based compression is safer than wide one-hot output.';
  if (encoding === 'Datetime feature derivation') return 'Convert to recency, hour-of-day, and cadence features rather than modelling raw timestamps.';
  return 'Available for governed preprocessing review.';
};

const featureEngineeringTemplates = [
  {
    category: 'Transaction Behaviour Features',
    rows: [
      { feature_name: 'txn_count_7d', source_columns: ['transaction_timestamp', 'transaction_id'], business_description: 'Number of transactions in the last seven days.', formula: 'count(transactions within 7d window)', data_type: 'numeric' },
      { feature_name: 'incoming_outgoing_ratio', source_columns: ['transaction_type', 'transaction_amount'], business_description: 'Relative balance of incoming versus outgoing value.', formula: 'sum(incoming amount) / sum(outgoing amount)', data_type: 'numeric' },
      { feature_name: 'burst_transaction_count', source_columns: ['transaction_timestamp'], business_description: 'Count of rapid-fire transactions in a tight window.', formula: 'count(events inside short burst interval)', data_type: 'numeric' },
      { feature_name: 'dormant_then_active_flag', source_columns: ['event_ts'], business_description: 'Flags accounts that become active after long dormancy.', formula: '1 if inactivity gap exceeds threshold before new burst', data_type: 'binary' },
    ],
  },
  {
    category: 'Counterparty Features',
    rows: [
      { feature_name: 'unique_counterparty_count', source_columns: ['counterparty_id'], business_description: 'Distinct counterparties linked to the account.', formula: 'nunique(counterparty_id)', data_type: 'numeric' },
      { feature_name: 'new_counterparty_ratio', source_columns: ['counterparty_id', 'event_ts'], business_description: 'Share of transactions with newly seen counterparties.', formula: 'new counterparties / total counterparties in window', data_type: 'numeric' },
      { feature_name: 'beneficiary_concentration', source_columns: ['beneficiary_id', 'transaction_amount'], business_description: 'Measures concentration of funds toward a small beneficiary set.', formula: 'top beneficiary amount / total amount', data_type: 'numeric' },
    ],
  },
  {
    category: 'Account Behaviour Features',
    rows: [
      { feature_name: 'account_age_days', source_columns: ['account_open_date', 'event_ts'], business_description: 'How old the account is at event time.', formula: 'event_ts - account_open_date', data_type: 'numeric' },
      { feature_name: 'balance_volatility', source_columns: ['account_balance_current'], business_description: 'Variation in balance over the observed window.', formula: 'std(balance over lookback)', data_type: 'numeric' },
      { feature_name: 'round_value_pattern_ratio', source_columns: ['transaction_amount'], business_description: 'Share of transactions occurring at round values.', formula: 'round-value transactions / total transactions', data_type: 'numeric' },
    ],
  },
  {
    category: 'Network / Relationship Features',
    rows: [
      { feature_name: 'shared_device_count', source_columns: ['device_id', 'account_id'], business_description: 'How many accounts are seen on the same device.', formula: 'nunique(account_id by device_id)', data_type: 'numeric' },
      { feature_name: 'shared_ip_count', source_columns: ['ip_address', 'account_id'], business_description: 'How many linked accounts share the same IP.', formula: 'nunique(account_id by ip_address)', data_type: 'numeric' },
      { feature_name: 'mule_ring_proxy_score', source_columns: ['device_id', 'counterparty_id', 'account_id'], business_description: 'Proxy indicator for ring participation through shared infrastructure and counterparties.', formula: 'weighted combination of shared-device and shared-beneficiary links', data_type: 'numeric' },
    ],
  },
  {
    category: 'Behavioural Risk Features',
    rows: [
      { feature_name: 'night_activity_ratio', source_columns: ['event_ts'], business_description: 'Share of account activity happening overnight.', formula: 'night events / total events', data_type: 'numeric' },
      { feature_name: 'weekend_activity_ratio', source_columns: ['event_ts'], business_description: 'Share of account activity taking place on weekends.', formula: 'weekend events / total events', data_type: 'numeric' },
      { feature_name: 'pass_through_behaviour_score', source_columns: ['transaction_amount', 'transaction_type'], business_description: 'Flags pass-through behaviour where credits are rapidly drained.', formula: 'rapid debits after credits across short windows', data_type: 'numeric' },
    ],
  },
];

const chipSx = {
  borderRadius: 1.5,
  fontWeight: 700,
  height: 24,
};

const sectionTableSx = {
  '& .MuiTableCell-head': {
    fontSize: 11,
    fontWeight: 800,
    color: '#667085',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    bgcolor: '#F8FAFC',
  },
  '& .MuiTableCell-body': {
    fontSize: 12.5,
    color: '#101828',
    verticalAlign: 'top',
  },
};

const buildRunLogs = (preprocessStatus) => {
  const rows = [];
  asArray(preprocessStatus?.warnings).forEach((warning) => rows.push({ level: 'warning', text: String(warning || '').trim() }));
  if (preprocessStatus?.build_status) {
    rows.push({ level: 'info', text: `Build status is ${String(preprocessStatus.build_status).replace(/_/g, ' ')}.` });
  }
  if (preprocessStatus?.latest_run?.output_table_name) {
    rows.push({ level: 'success', text: `Latest output table: ${preprocessStatus.latest_run.output_table_name}.` });
  }
  asArray(preprocessStatus?.recent_runs).slice(0, 3).forEach((run) => {
    rows.push({
      level: 'info',
      text: `Run ${run.run_id || '-'} produced ${run.output_table_name || 'a persisted dataset'} with ${fmt(run.row_count)} rows and ${fmt(run.column_count)} columns.`,
    });
  });
  return rows;
};

const buildTechnicalExplanation = (feature, decision) => {
  const name = String(feature || '').toLowerCase();
  if (decision === 'blocked' || LEAKAGE_REGEX.test(name)) return 'Dropped because it looks target-adjacent, post-outcome, or otherwise unsafe for training-time use.';
  if (ID_REGEX.test(name)) return 'Dropped because identifier-like fields increase memorisation risk without adding stable behavioural signal.';
  if (/shared|ring|graph|network|counterparty|beneficiary/.test(name)) return 'Retained because relationship structure can expose mule linkage, ring behaviour, or beneficiary reuse.';
  if (/pass_through|velocity|burst|night|weekend|round|dormant/.test(name)) return 'Retained because it captures behavioural timing or money-movement patterns relevant to mule detection.';
  if (/risk|score|ratio|count/.test(name)) return 'Retained as a compact numeric feature that is easy to govern, rank, and compare across training folds.';
  return 'Kept under governed preprocessing review pending business and technical checks.';
};

const buildBusinessExplanation = (feature, decision) => {
  const name = String(feature || '').toLowerCase();
  if (decision === 'blocked' || LEAKAGE_REGEX.test(name)) return `“${titleCase(feature)}” is blocked because it would tell the model the answer too directly or only becomes known after investigation starts.`;
  if (ID_REGEX.test(name)) return `“${titleCase(feature)}” is dropped because it identifies the record rather than describing mule behaviour.`;
  if (/shared_device|shared_ip|ring|network|graph/.test(name)) return `“${titleCase(feature)}” is retained because it may indicate mule syndicate linkage or ring participation.`;
  if (/counterparty|beneficiary/.test(name)) return `“${titleCase(feature)}” is retained because unusual beneficiary or counterparty reuse can indicate coordinated mule activity.`;
  if (/pass_through|velocity|burst|night|weekend|round|cash|dormant/.test(name)) return `“${titleCase(feature)}” is retained because it describes suspicious account behaviour rather than customer identity.`;
  return `“${titleCase(feature)}” remains available because it contributes usable analytical context without obviously violating timing or leakage rules.`;
};

const inferFeatureCategory = (name, source = '') => {
  const token = `${String(name || '').toLowerCase()} ${String(source || '').toLowerCase()}`;
  if (/graph|ring|network|shared|centrality|counterparty|beneficiary/.test(token)) return 'Network / Relationship';
  if (/night|weekend|dormant|velocity|burst|pass_through|hour|day|month|gap/.test(token)) return 'Behavioural Risk';
  if (/device|ip|channel|upi|merchant|gateway|atm|branch/.test(token)) return 'Channel / Device';
  if (/balance|amount|turnover|cash|txn|transaction/.test(token)) return 'Transaction Behaviour';
  if (/customer|identity|pep|kyc/.test(token)) return 'Customer / Identity';
  return 'General';
};

const findColumnSource = (columnName, datasets = [], fallback = '') => {
  const needle = String(columnName || '').trim().toLowerCase();
  const match = asArray(datasets).find((dataset) => asArray(dataset?.columns).some((column) => {
    const name = normalizeColumn(column).name.toLowerCase();
    return name === needle;
  }));
  return String(match?.name || match?.dataset_name || match?.table_name || fallback || 'master_dataset');
};

const buildFeatureRows = ({
  inputDataset,
  datasets,
  featureStoreStatus,
  preprocessStatus,
}) => {
  const governance = preprocessStatus?.feature_governance || {};
  const approved = new Set(asArray(governance?.approved_features).map((value) => String(value || '').trim()));
  const blocked = new Set([
    ...asArray(governance?.blocked_features),
    ...asArray(governance?.weak_features),
  ].map((value) => String(value || '').trim()));
  const review = new Set(asArray(governance?.needs_review).map((value) => String(value || '').trim()));

  const rows = asArray(featureStoreStatus?.feature_catalog).map((item) => {
    const featureName = String(item?.feature_name || item?.name || '').trim();
    const sourceColumns = asArray(item?.source_columns || item?.columns).map((value) => String(value || '').trim()).filter(Boolean);
    const sourceTable = String(item?.source_table || item?.table || findColumnSource(featureName, datasets, inputDataset?.name || 'master_dataset'));
    const transformation = String(item?.transformation_applied || item?.transform || (item?.is_derived ? 'Derived feature logic' : 'Raw / direct load'));
    const category = String(item?.feature_group || item?.category || inferFeatureCategory(featureName, sourceTable));
    const derived = Boolean(item?.is_derived || sourceColumns.length > 1 || /ratio|score|count|velocity|network|ring|shared|burst/.test(featureName.toLowerCase()));
    const status = blocked.has(featureName) ? 'blocked' : review.has(featureName) ? 'review' : approved.has(featureName) ? 'approved' : 'ready';
    return {
      feature_name: featureName,
      source_table: sourceTable,
      source_columns: sourceColumns,
      transformation_applied: transformation || 'Direct feature',
      derived,
      category,
      ready_for_modeling: status === 'approved' || status === 'ready',
      dropped: status === 'blocked',
      reason: status === 'blocked'
        ? 'Blocked by governance or weak-signal checks'
        : status === 'review'
          ? 'Awaiting analyst sign-off'
          : 'Available for modeling',
      null_rate: Number(item?.null_rate || 0),
      status,
      mule_types: String(item?.mule_types || ''),
    };
  });

  if (rows.length) return rows;

  return asArray(inputDataset?.columns).map((column) => {
    const normalized = normalizeColumn(column);
    const featureName = normalized.name;
    const category = inferFeatureCategory(featureName, normalized.sourceTable || inputDataset?.name);
    const status = blocked.has(featureName) ? 'blocked' : review.has(featureName) ? 'review' : approved.has(featureName) ? 'approved' : 'ready';
    return {
      feature_name: featureName,
      source_table: normalized.sourceTable || inputDataset?.name || 'master_dataset',
      source_columns: [featureName],
      transformation_applied: inferEncoding(featureName, inferDetectedType(featureName, normalized.dtype), normalized.distinctCount),
      derived: false,
      category,
      ready_for_modeling: status === 'approved' || status === 'ready',
      dropped: status === 'blocked',
      reason: status === 'blocked'
        ? 'Blocked by governance or weak-signal checks'
        : status === 'review'
          ? 'Awaiting analyst sign-off'
          : 'Available for modeling',
      null_rate: normalized.nullRate,
      status,
      mule_types: '',
    };
  });
};

const saveStateShape = ({
  activeTab,
  techView,
  columnTypeFilter,
  columnQuery,
  featureQuery,
  featureCategoryFilter,
  favoriteFeatures,
}) => ({
  activeTab,
  techView,
  columnTypeFilter,
  columnQuery,
  featureQuery,
  featureCategoryFilter,
  favoriteFeatures,
});

const StatusChip = ({ label, tone = 'neutral' }) => {
  const tones = {
    neutral: { bgcolor: '#F2F4F7', color: '#344054' },
    good: { bgcolor: '#ECFDF3', color: '#067647' },
    warn: { bgcolor: '#FFF7ED', color: '#B54708' },
    bad: { bgcolor: '#FEF3F2', color: '#B42318' },
  };
  return <Chip label={label} size="small" sx={{ ...chipSx, ...(tones[tone] || tones.neutral) }} />;
};

const FieldValue = ({ label, value }) => (
  <Stack spacing={0.3}>
    <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#98A2B3', textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 13, color: '#101828', lineHeight: 1.55 }}>
      {value}
    </Typography>
  </Stack>
);

export default function MulePreprocessingWorkbench(props) {
  const {
    activePipelineId,
    datasets = [],
    inputDataset = null,
    preprocessedDataset = null,
    targetColumn = '',
    featureStoreStatus = null,
    preprocessStatus = null,
    onPreviewRun,
    onPersistRun,
    updateControl,
  } = props;

  const pipelineId = Number(activePipelineId || 0);
  const [activeTab, setActiveTab] = useState('classification');
  const [techView, setTechView] = useState('technical');
  const [columnTypeFilter, setColumnTypeFilter] = useState('all');
  const [columnQuery, setColumnQuery] = useState('');
  const [featureQuery, setFeatureQuery] = useState('');
  const [featureCategoryFilter, setFeatureCategoryFilter] = useState('all');
  const [favoriteFeatures, setFavoriteFeatures] = useState([]);
  const [selectedEngineeredFeature, setSelectedEngineeredFeature] = useState('');
  const [persistMessage, setPersistMessage] = useState('');
  const saveRef = useRef('');
  const hydrateSkipRef = useRef(false);

  useEffect(() => {
    if (!pipelineId) return undefined;
    let alive = true;
    (async () => {
      try {
        const response = await mlopsApi.pipelineGet(pipelineId);
        const payload = response?.data || response || null;
        const saved = getScreenState(payload?.steps, SCREEN_KEY) || {};
        if (!alive || !saved || typeof saved !== 'object') return;
        hydrateSkipRef.current = true;
        setActiveTab(TAB_DEFS.some((item) => item.id === saved.activeTab) ? saved.activeTab : 'classification');
        setTechView(saved.techView === 'business' ? 'business' : 'technical');
        setColumnTypeFilter(String(saved.columnTypeFilter || 'all'));
        setColumnQuery(String(saved.columnQuery || ''));
        setFeatureQuery(String(saved.featureQuery || ''));
        setFeatureCategoryFilter(String(saved.featureCategoryFilter || 'all'));
        setFavoriteFeatures(asArray(saved.favoriteFeatures).map((value) => String(value || '')));
      } catch {
        // Screen state restore is best-effort.
      }
    })();
    return () => {
      alive = false;
    };
  }, [pipelineId]);

  const screenState = useMemo(() => saveStateShape({
    activeTab,
    techView,
    columnTypeFilter,
    columnQuery,
    featureQuery,
    featureCategoryFilter,
    favoriteFeatures,
  }), [activeTab, techView, columnTypeFilter, columnQuery, featureQuery, featureCategoryFilter, favoriteFeatures]);

  useEffect(() => {
    if (!pipelineId) return undefined;
    if (hydrateSkipRef.current) {
      hydrateSkipRef.current = false;
      return undefined;
    }
    const signature = JSON.stringify(screenState);
    if (signature === saveRef.current) return undefined;
    const timer = window.setTimeout(() => {
      mlopsApi.pipelineSaveScreenState(pipelineId, {
        screen: SCREEN_KEY,
        state: screenState,
      }).then(() => {
        saveRef.current = signature;
      }).catch(() => {});
    }, 650);
    return () => window.clearTimeout(timer);
  }, [pipelineId, screenState]);

  const columnCatalog = useMemo(() => {
    return asArray(inputDataset?.columns)
      .map((entry) => {
        const normalized = normalizeColumn(entry);
        const detectedType = inferDetectedType(normalized.name, normalized.dtype);
        const businessRole = inferBusinessRole(normalized.name, detectedType);
        const encodingRecommendation = inferEncoding(normalized.name, detectedType, normalized.distinctCount);
        const sourceTable = normalized.sourceTable || findColumnSource(normalized.name, datasets, inputDataset?.name || 'master_dataset');
        const include = businessRole !== 'Leakage Risk' && businessRole !== 'Identifier' && encodingRecommendation !== 'Exclude from modelling';
        return {
          ...normalized,
          detectedType,
          businessRole,
          encodingRecommendation,
          include,
          sourceTable,
          notes: inferColumnNotes(businessRole, encodingRecommendation),
        };
      })
      .filter((row) => row.name);
  }, [datasets, inputDataset]);

  const filteredColumns = useMemo(() => {
    const query = String(columnQuery || '').trim().toLowerCase();
    return columnCatalog.filter((row) => {
      if (query && !`${row.name} ${row.sourceTable} ${row.businessRole}`.toLowerCase().includes(query)) return false;
      if (columnTypeFilter === 'excluded' && row.include) return false;
      if (columnTypeFilter === 'leakage' && row.businessRole !== 'Leakage Risk') return false;
      if (['categorical', 'numerical', 'datetime'].includes(columnTypeFilter) && row.detectedType !== columnTypeFilter) return false;
      return true;
    });
  }, [columnCatalog, columnQuery, columnTypeFilter]);

  const featureRows = useMemo(() => buildFeatureRows({
    inputDataset,
    datasets,
    featureStoreStatus,
    preprocessStatus,
  }), [datasets, featureStoreStatus, inputDataset, preprocessStatus]);

  const featureCategoryOptions = useMemo(() => ['all', ...Array.from(new Set(featureRows.map((row) => row.category).filter(Boolean)))], [featureRows]);

  const visibleFeatureRows = useMemo(() => {
    const query = String(featureQuery || '').trim().toLowerCase();
    return featureRows.filter((row) => {
      if (featureCategoryFilter !== 'all' && row.category !== featureCategoryFilter) return false;
      if (query && !`${row.feature_name} ${row.source_table} ${row.reason} ${row.category}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [featureCategoryFilter, featureQuery, featureRows]);

  const engineeringRows = useMemo(() => {
    const actualFeatureNames = new Set(featureRows.map((row) => row.feature_name));
    return featureEngineeringTemplates.flatMap((section) => (
      section.rows.map((row) => {
        const created = actualFeatureNames.has(row.feature_name);
        return {
          ...row,
          category: section.category,
          created,
          null_rate: created ? Number(featureRows.find((item) => item.feature_name === row.feature_name)?.null_rate || 0) : null,
          lineage_tables: row.source_columns.map((column) => findColumnSource(column, datasets, inputDataset?.name || 'master_dataset')),
        };
      })
    ));
  }, [datasets, featureRows, inputDataset]);

  useEffect(() => {
    if (!selectedEngineeredFeature && engineeringRows.length) {
      setSelectedEngineeredFeature(engineeringRows[0].feature_name);
    }
  }, [engineeringRows, selectedEngineeredFeature]);

  const selectedEngineeringDetail = useMemo(
    () => engineeringRows.find((row) => row.feature_name === selectedEngineeredFeature) || engineeringRows[0] || null,
    [engineeringRows, selectedEngineeredFeature],
  );

  const governance = preprocessStatus?.feature_governance || {};
  const approvedSet = useMemo(() => new Set(asArray(governance?.approved_features).map((value) => String(value || '').trim())), [governance]);
  const blockedSet = useMemo(() => new Set([
    ...asArray(governance?.blocked_features),
    ...asArray(governance?.weak_features),
  ].map((value) => String(value || '').trim())), [governance]);
  const reviewSet = useMemo(() => new Set(asArray(governance?.needs_review).map((value) => String(value || '').trim())), [governance]);

  const selectionRows = useMemo(() => {
    const enriched = visibleFeatureRows.map((row) => {
      const importance = approvedSet.has(row.feature_name)
        ? 0.86
        : blockedSet.has(row.feature_name)
          ? 0.18
          : reviewSet.has(row.feature_name)
            ? 0.52
            : 0.66;
      const decision = blockedSet.has(row.feature_name)
        ? 'blocked'
        : reviewSet.has(row.feature_name)
          ? 'review'
          : approvedSet.has(row.feature_name)
            ? 'selected'
            : 'candidate';
      return {
        ...row,
        decision,
        importance,
        technical_explanation: buildTechnicalExplanation(row.feature_name, decision),
        business_explanation: buildBusinessExplanation(row.feature_name, decision),
        protected: /shared|ring|graph|network|pass_through|counterparty|beneficiary|velocity|burst/.test(String(row.feature_name || '').toLowerCase()),
      };
    });
    return enriched.sort((a, b) => {
      if (a.protected !== b.protected) return a.protected ? -1 : 1;
      return b.importance - a.importance;
    });
  }, [approvedSet, blockedSet, reviewSet, visibleFeatureRows]);

  const rawFeatureCount = featureRows.filter((row) => !row.derived).length;
  const engineeredFeatureCount = featureRows.filter((row) => row.derived).length;
  const encodedFeatureCount = featureRows.filter((row) => /encoding/i.test(row.transformation_applied)).length;
  const scaledFeatureCount = featureRows.filter((row) => /scale|normalize|winsor|cap|log/i.test(row.transformation_applied)).length;
  const droppedFeatureCount = featureRows.filter((row) => row.dropped).length;
  const leakageRiskFeatureCount = featureRows.filter((row) => LEAKAGE_REGEX.test(row.feature_name)).length;

  const categoricalColumns = columnCatalog.filter((row) => row.detectedType === 'categorical');
  const numericalColumns = columnCatalog.filter((row) => row.detectedType === 'numerical');
  const datetimeColumns = columnCatalog.filter((row) => row.detectedType === 'datetime');
  const excludedColumns = columnCatalog.filter((row) => !row.include);

  const controlState = preprocessStatus?.config?.controls || {};
  const selectedGroups = Object.entries(preprocessStatus?.config?.feature_groups || {})
    .filter(([, value]) => value?.enabled !== false)
    .map(([key]) => titleCase(key));

  const runLogs = useMemo(() => buildRunLogs(preprocessStatus), [preprocessStatus]);

  const runSummaryItems = [
    { label: 'Included Raw Features', value: fmt(rawFeatureCount), helper: 'Direct columns or minimally transformed variables carried into the run.' },
    { label: 'Engineered Features', value: fmt(engineeredFeatureCount), helper: 'Derived Mule signals created from behaviour, counterparties, and relationship logic.' },
    { label: 'Dropped Features', value: fmt(droppedFeatureCount), helper: 'Features excluded by leakage controls, governance review, or weak-signal checks.' },
    { label: 'Final Shape', value: `${fmt(preprocessedDataset?.row_count || preprocessStatus?.latest_run?.row_count || inputDataset?.row_count)} x ${fmt((preprocessedDataset?.columns || []).length || preprocessStatus?.latest_run?.column_count || featureRows.length)}`, helper: 'Model-ready output registered for downstream training.' },
  ];

  const currentModelFamily = String(preprocessStatus?.config?.model_family || preprocessStatus?.recommended_model_family || 'tree-based models').trim();
  const scalingGuidance = SCALE_EXEMPT_REGEX.test(currentModelFamily)
    ? `${titleCase(currentModelFamily)} usually does not require aggressive scaling, so scaling stays optional and column-specific.`
    : `${titleCase(currentModelFamily)} benefits more from standardized numeric ranges, so scaling guidance is shown more prominently.`;

  const handleFavoriteToggle = (featureName) => {
    setFavoriteFeatures((prev) => (
      prev.includes(featureName)
        ? prev.filter((value) => value !== featureName)
        : [...prev, featureName]
    ));
  };

  const renderClassificationTab = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Columns', value: fmt(columnCatalog.length), helper: 'All available columns in the active preprocessing input.' },
          { label: 'Categorical', value: fmt(categoricalColumns.length), helper: 'Nominal, ordinal, and binary descriptors.' },
          { label: 'Numerical', value: fmt(numericalColumns.length), helper: 'Counts, amounts, ratios, balances, and velocity measures.' },
          { label: 'Leakage Risk', value: fmt(columnCatalog.filter((row) => row.businessRole === 'Leakage Risk').length), helper: 'Columns that should not flow directly into modeling.' },
        ]}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.45fr) minmax(280px, 0.8fr)' }, gap: 1.5 }}>
        <WorkbenchSection
          title="Column Review Grid"
          description="Review detected column types, business roles, encoding recommendations, and whether each field should remain inside the governed preprocessing scope."
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1.25 }}>
            <TextField
              value={columnQuery}
              onChange={(event) => setColumnQuery(event.target.value)}
              placeholder="Search column, table, or business role"
              size="small"
              fullWidth
            />
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel>Column filter</InputLabel>
              <Select value={columnTypeFilter} label="Column filter" onChange={(event) => setColumnTypeFilter(String(event.target.value))}>
                <MenuItem value="all">All columns</MenuItem>
                <MenuItem value="categorical">Only categorical</MenuItem>
                <MenuItem value="numerical">Only numerical</MenuItem>
                <MenuItem value="datetime">Only datetime</MenuItem>
                <MenuItem value="excluded">Only excluded</MenuItem>
                <MenuItem value="leakage">Only leakage-risk columns</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={sectionTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell>Column Name</TableCell>
                  <TableCell>Source Table</TableCell>
                  <TableCell>Detected Type</TableCell>
                  <TableCell>Business Role</TableCell>
                  <TableCell>Encoding Recommendation</TableCell>
                  <TableCell>Include</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredColumns.slice(0, 150).map((row) => (
                  <TableRow key={row.name} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{row.name}</TableCell>
                    <TableCell>{row.sourceTable}</TableCell>
                    <TableCell>{titleCase(row.detectedType)}</TableCell>
                    <TableCell>{row.businessRole}</TableCell>
                    <TableCell>{row.encodingRecommendation}</TableCell>
                    <TableCell>
                      {row.include ? <StatusChip label="Included" tone="good" /> : <StatusChip label="Excluded" tone="bad" />}
                    </TableCell>
                    <TableCell sx={{ minWidth: 250 }}>{row.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </WorkbenchSection>

        <Stack spacing={1.5}>
          <WorkbenchSection
            title="What Are We Doing Here?"
            description="We are identifying which columns are IDs, which are categories, which are numbers, and which should not flow into modelling directly."
          >
            <Typography sx={{ fontSize: 13.5, color: '#667085', lineHeight: 1.75 }}>
              This tab is the first governance checkpoint. It classifies the incoming fields, separates identifiers from behaviour, highlights leakage-prone outcomes, and makes sure the rest of preprocessing starts from a clear, explainable column inventory.
            </Typography>
          </WorkbenchSection>

          <WorkbenchSection title="Current Filters" description="Use these numbers to quickly isolate the parts of the schema that need manual review.">
            <Stack spacing={0.8}>
              <FieldValue label="Excluded Columns" value={`${fmt(excludedColumns.length)} currently outside modelling scope`} />
              <FieldValue label="Datetime Inputs" value={`${fmt(datetimeColumns.length)} columns will be expanded into recency and cadence features`} />
              <FieldValue label="Identifier-Like Fields" value={`${fmt(columnCatalog.filter((row) => row.businessRole === 'Identifier').length)} columns held mainly for lineage and joins`} />
            </Stack>
          </WorkbenchSection>
        </Stack>
      </Box>
    </Stack>
  );

  const renderEncodingTab = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Categorical Columns', value: fmt(categoricalColumns.length), helper: 'Candidate fields for one-hot, ordinal, binary, or frequency encoding.' },
          { label: 'Numerical Columns', value: fmt(numericalColumns.length), helper: 'Candidate fields for scaling, capping, logging, or binning where justified.' },
          { label: 'Datetime Columns', value: fmt(datetimeColumns.length), helper: 'Candidate fields for recency, day-part, and sequence-gap derivation.' },
          { label: 'Scaling Guidance', value: SCALE_EXEMPT_REGEX.test(currentModelFamily) ? 'Optional' : 'Recommended', helper: scalingGuidance },
        ]}
      />

      <WorkbenchSection
        title="Encoding and Transformation Controls"
        description="Default recommendations are inferred from column type, cardinality, and Mule-specific modeling needs. Scaling is never applied blindly."
        action={(
          <Stack direction="row" spacing={1.25}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Missing values</Typography>
              <Switch
                size="small"
                checked={controlState?.missing_values?.enabled !== false}
                onChange={(event) => updateControl?.('missing_values', { enabled: event.target.checked }, 'Updated missing-value strategy for Mule preprocessing.')}
              />
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Outlier handling</Typography>
              <Switch
                size="small"
                checked={controlState?.outlier_handling?.enabled !== false}
                onChange={(event) => updateControl?.('outlier_handling', { enabled: event.target.checked }, 'Updated outlier treatment for Mule preprocessing.')}
              />
            </Stack>
          </Stack>
        )}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.4fr) minmax(0, 1fr)' }, gap: 1.5 }}>
          <Stack spacing={1.5}>
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 1.5, py: 1.1, borderBottom: '1px solid rgba(16,24,40,0.08)', bgcolor: '#FBFCFE' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>Categorical Encoding</Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.3 }}>
                  Nominal columns usually get one-hot encoding, ordered categories get ordinal encoding, high-cardinality fields compress through frequency encoding, and yes/no fields use binary mapping.
                </Typography>
              </Box>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={sectionTableSx}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Column</TableCell>
                      <TableCell>Detected Category Type</TableCell>
                      <TableCell>Unique Values</TableCell>
                      <TableCell>Recommended Encoding</TableCell>
                      <TableCell>Selected Encoding</TableCell>
                      <TableCell>Warning</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {categoricalColumns.slice(0, 60).map((row) => {
                      const selectedEncoding = inferEncoding(row.name, row.detectedType, row.distinctCount);
                      const categoryType = /risk|rating|band|level|status/i.test(row.name) ? 'Ordered category' : row.name.endsWith('_flag') ? 'Binary category' : 'Nominal category';
                      return (
                        <TableRow key={row.name}>
                          <TableCell sx={{ fontWeight: 700 }}>{row.name}</TableCell>
                          <TableCell>{categoryType}</TableCell>
                          <TableCell>{fmt(row.distinctCount)}</TableCell>
                          <TableCell>{row.encodingRecommendation}</TableCell>
                          <TableCell>{selectedEncoding}</TableCell>
                          <TableCell>
                            {row.distinctCount > 50 ? <StatusChip label="High cardinality" tone="warn" /> : <StatusChip label="No major warning" />}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 1.5, bgcolor: '#FBFCFE' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828' }}>Numeric Handling</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.3, lineHeight: 1.7 }}>
                Available options include standard scaling, min-max normalization, robust scaling, log transform, winsorization, and binning where needed. The UI explicitly explains when scaling is optional because the active model family is tree-based.
              </Typography>
              <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                <FieldValue label="Standard scaling" value="Recommended only for distance-based or linear models that care about feature magnitude." />
                <FieldValue label="Robust scaling" value="Safer when amount or turnover columns contain heavy tails and large outliers." />
                <FieldValue label="Log transform" value="Useful for highly skewed amount, balance, or velocity columns when interpretability remains acceptable." />
                <FieldValue label="Winsorization / capping" value="Use for extreme numeric tails before model ranking becomes overly driven by a few records." />
              </Stack>
            </Paper>
          </Stack>

          <Stack spacing={1.5}>
            <WorkbenchSection title="Datetime Handling" description="Datetimes are converted into business-useful signals instead of flowing into modelling as raw timestamps.">
              <Stack spacing={0.7}>
                {[
                  'Hour of day',
                  'Day of week',
                  'Weekend flag',
                  'Month',
                  'Days since first activity',
                  'Recency windows',
                  'Inter-event gaps where sequence data exists',
                ].map((item) => (
                  <StatusChip key={item} label={item} />
                ))}
              </Stack>
            </WorkbenchSection>

            <WorkbenchSection title="Missing Value Handling" description="Strategies can be applied per-column or grouped by role.">
              <Stack spacing={0.8}>
                <FieldValue label="Default grouped strategies" value="Median for numeric ratios and counts, mode for compact categories, constant plus missing-flag for operationally meaningful blanks, and leave-as-is only where emptiness is itself informative." />
                <FieldValue label="Review posture" value="Sparse behavioural columns can still be retained if missingness is expected and a missing-value flag is added." />
              </Stack>
            </WorkbenchSection>

            <WorkbenchSection title="Outlier Handling" description="Optional but visible. Analysts can detect heavy skew, cap extremes, and keep a record of the treatment choice.">
              <Typography sx={{ fontSize: 13, color: '#667085', lineHeight: 1.7 }}>
                Current control status: <strong>{controlState?.outlier_handling?.enabled !== false ? 'Enabled' : 'Disabled'}</strong>. This keeps extreme amount, turnover, and velocity columns from dominating the model without silently mutating the data.
              </Typography>
            </WorkbenchSection>
          </Stack>
        </Box>
      </WorkbenchSection>
    </Stack>
  );

  const renderEngineeringTab = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Templates', value: fmt(engineeringRows.length), helper: 'Curated Mule-specific feature templates exposed to the analyst.' },
          { label: 'Created Successfully', value: fmt(engineeringRows.filter((row) => row.created).length), helper: 'Feature templates that are already visible in the current feature inventory.' },
          { label: 'Pending Creation', value: fmt(engineeringRows.filter((row) => !row.created).length), helper: 'Templates not yet present in the persisted feature inventory.' },
          { label: 'Selected Groups', value: fmt(selectedGroups.length), helper: 'Feature groups currently enabled for this Mule run.' },
        ]}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.4fr) minmax(300px, 0.8fr)' }, gap: 1.5 }}>
        <WorkbenchSection
          title="Mule-Specific Feature Engineering"
          description="These engineered features focus on transaction behaviour, counterparties, account behaviour, network structure, and behavioural risk rather than generic ML-only transformations."
        >
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={sectionTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell>Feature Name</TableCell>
                  <TableCell>Source Columns Used</TableCell>
                  <TableCell>Business Description</TableCell>
                  <TableCell>Formula / Logic Summary</TableCell>
                  <TableCell>Data Type</TableCell>
                  <TableCell>Null Rate</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {engineeringRows.map((row) => (
                  <TableRow
                    key={row.feature_name}
                    hover
                    selected={selectedEngineeredFeature === row.feature_name}
                    onClick={() => setSelectedEngineeredFeature(row.feature_name)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ fontWeight: 700 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{row.feature_name}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: '#667085', mt: 0.2 }}>{row.category}</Typography>
                    </TableCell>
                    <TableCell>{row.source_columns.join(', ')}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>{row.business_description}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>{row.formula}</TableCell>
                    <TableCell>{titleCase(row.data_type)}</TableCell>
                    <TableCell>{row.null_rate == null ? '-' : `${Number(row.null_rate).toFixed(1)}%`}</TableCell>
                    <TableCell>{row.created ? <StatusChip label="Created" tone="good" /> : <StatusChip label="Pending" tone="warn" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </WorkbenchSection>

        <Stack spacing={1.5}>
          <WorkbenchSection title="Feature Lineage" description="This panel explains where the currently selected engineered feature comes from and why it matters to investigators.">
            {selectedEngineeringDetail ? (
              <Stack spacing={1.1}>
                <FieldValue label="Feature" value={selectedEngineeringDetail.feature_name} />
                <FieldValue label="Business Description" value={selectedEngineeringDetail.business_description} />
                <FieldValue label="Formula / Logic" value={selectedEngineeringDetail.formula} />
                <FieldValue label="Source Columns" value={selectedEngineeringDetail.source_columns.join(', ')} />
                <FieldValue label="Source Tables" value={Array.from(new Set(selectedEngineeringDetail.lineage_tables)).join(', ')} />
                <FieldValue label="Creation Status" value={selectedEngineeringDetail.created ? 'Created successfully in current inventory' : 'Not yet present in current inventory'} />
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, color: '#667085' }}>
                Select a feature from the table to inspect its lineage.
              </Typography>
            )}
          </WorkbenchSection>
        </Stack>
      </Box>
    </Stack>
  );

  const renderFeatureStoreTab = () => (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
        <TextField
          value={featureQuery}
          onChange={(event) => setFeatureQuery(event.target.value)}
          placeholder="Search feature, source table, or category"
          size="small"
          fullWidth
        />
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Category</InputLabel>
          <Select value={featureCategoryFilter} label="Category" onChange={(event) => setFeatureCategoryFilter(String(event.target.value))}>
            {featureCategoryOptions.map((option) => (
              <MenuItem key={option} value={option}>{option === 'all' ? 'All categories' : option}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
        <StatusChip label={`Raw features ${fmt(rawFeatureCount)}`} />
        <StatusChip label={`Engineered features ${fmt(engineeredFeatureCount)}`} />
        <StatusChip label={`Encoded features ${fmt(encodedFeatureCount)}`} />
        <StatusChip label={`Scaled features ${fmt(scaledFeatureCount)}`} />
        <StatusChip label={`Dropped features ${fmt(droppedFeatureCount)}`} tone="warn" />
        <StatusChip label={`Leakage-risk features ${fmt(leakageRiskFeatureCount)}`} tone="bad" />
      </Stack>

      <WorkbenchSection
        title="Governed Feature Inventory"
        description="This is the central inventory of all usable features, including lineage, transformation status, raw-versus-derived status, and whether each feature is ready for modelling."
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={sectionTableSx}>
            <TableHead>
              <TableRow>
                <TableCell>Favorite</TableCell>
                <TableCell>Feature Name</TableCell>
                <TableCell>Source Table</TableCell>
                <TableCell>Source Columns</TableCell>
                <TableCell>Transformation Applied</TableCell>
                <TableCell>Derived or Raw</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Ready for Modelling</TableCell>
                <TableCell>Dropped</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleFeatureRows.slice(0, 200).map((row) => (
                <TableRow key={row.feature_name} hover>
                  <TableCell>
                    <Tooltip title={favoriteFeatures.includes(row.feature_name) ? 'Remove from favorites' : 'Mark as favorite'}>
                      <IconButton size="small" onClick={() => handleFavoriteToggle(row.feature_name)}>
                        {favoriteFeatures.includes(row.feature_name) ? <Star sx={{ fontSize: 18, color: '#C65A11' }} /> : <StarBorder sx={{ fontSize: 18, color: '#98A2B3' }} />}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{row.feature_name}</TableCell>
                  <TableCell>{row.source_table}</TableCell>
                  <TableCell>{row.source_columns.join(', ') || row.feature_name}</TableCell>
                  <TableCell>{row.transformation_applied}</TableCell>
                  <TableCell>{row.derived ? 'Derived' : 'Raw'}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell>{row.ready_for_modeling ? <StatusChip label="Yes" tone="good" /> : <StatusChip label="No" tone="warn" />}</TableCell>
                  <TableCell>{row.dropped ? <StatusChip label="Yes" tone="bad" /> : <StatusChip label="No" />}</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>{row.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </WorkbenchSection>
    </Stack>
  );

  const renderSelectionTab = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Total Candidate Features', value: fmt(featureRows.length), helper: 'Features currently visible to the workbench.' },
          { label: 'Selected Features', value: fmt(selectionRows.filter((row) => row.decision === 'selected' || row.decision === 'candidate').length), helper: 'Features still inside the modelling candidate set.' },
          { label: 'Dropped Features', value: fmt(selectionRows.filter((row) => row.decision === 'blocked').length), helper: 'Features excluded by governance, leakage, or weak-signal logic.' },
          { label: 'Protected Behavioural Signals', value: fmt(selectionRows.filter((row) => row.protected).length), helper: 'Behaviourally meaningful Mule signals that should not be removed lightly.' },
        ]}
      />

      <WorkbenchSection
        title="Mule-Aware Feature Selection"
        description="Selection combines technical ranking with business reasoning. Behavioural and relationship signals can be protected when they carry meaningful Mule context."
        action={(
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={techView === 'technical' ? 'contained' : 'outlined'}
              onClick={() => setTechView('technical')}
              sx={{ textTransform: 'none', bgcolor: techView === 'technical' ? '#C65A11' : undefined, '&:hover': { bgcolor: techView === 'technical' ? '#A64B12' : undefined } }}
            >
              Technical ranking
            </Button>
            <Button
              size="small"
              variant={techView === 'business' ? 'contained' : 'outlined'}
              onClick={() => setTechView('business')}
              sx={{ textTransform: 'none', bgcolor: techView === 'business' ? '#C65A11' : undefined, '&:hover': { bgcolor: techView === 'business' ? '#A64B12' : undefined } }}
            >
              Business reasoning
            </Button>
          </Stack>
        )}
      >
        <Alert severity="info">
          Business rule layer is active. Investigator-approved behaviour, network, and ring-linked signals remain visible as protected candidates even when generic reduction methods would otherwise prune aggressively.
        </Alert>
        <Box sx={{ overflowX: 'auto', mt: 1 }}>
          <Table size="small" sx={sectionTableSx}>
            <TableHead>
              <TableRow>
                <TableCell>Feature</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Score / Importance</TableCell>
                <TableCell>Why Dropped / Retained</TableCell>
                <TableCell>{techView === 'technical' ? 'Technical Explanation' : 'Business Explanation'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectionRows.slice(0, 200).map((row) => (
                <TableRow key={row.feature_name} hover>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{row.feature_name}</Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.45 }}>
                      <StatusChip label={row.category} />
                      {row.protected ? <StatusChip label="Protected behavioural feature" tone="warn" /> : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {row.decision === 'blocked'
                      ? <StatusChip label="Dropped" tone="bad" />
                      : row.decision === 'review'
                        ? <StatusChip label="Review" tone="warn" />
                        : row.decision === 'selected'
                          ? <StatusChip label="Selected" tone="good" />
                          : <StatusChip label="Candidate" />}
                  </TableCell>
                  <TableCell>{row.importance.toFixed(2)}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                  <TableCell sx={{ minWidth: 300 }}>
                    {techView === 'technical' ? row.technical_explanation : row.business_explanation}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </WorkbenchSection>
    </Stack>
  );

  const renderRunTab = () => (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid items={runSummaryItems} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.3fr) minmax(300px, 0.85fr)' }, gap: 1.5 }}>
        <Stack spacing={1.5}>
          <WorkbenchSection
            title="Compiled Preprocessing Pipeline"
            description="This is the final checkpoint before model build. It shows exactly what happened, what will be persisted, and what remains blocked."
            action={(
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<Tune />}
                  onClick={async () => {
                    try {
                      await onPreviewRun?.();
                      setPersistMessage('Generated Mule preprocessing preview from backend.');
                    } catch (error) {
                      setPersistMessage(error?.message || 'Could not generate preprocessing preview.');
                    }
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  Preview Pipeline
                </Button>
                <Button
                  variant="contained"
                  startIcon={<AutoFixHigh />}
                  onClick={async () => {
                    try {
                      await onPersistRun?.();
                      setPersistMessage('Persisted the Mule preprocessing dataset for model build.');
                    } catch (error) {
                      setPersistMessage(error?.message || 'Could not persist the preprocessing dataset.');
                    }
                  }}
                  sx={{ textTransform: 'none', bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}
                >
                  Run Pipeline
                </Button>
              </Stack>
            )}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
              <Paper variant="outlined" sx={{ p: 1.35, borderRadius: 2.25, bgcolor: '#FBFCFE' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Included Feature Scope</Typography>
                <Stack spacing={0.7}>
                  <FieldValue label="Included raw features" value={fmt(rawFeatureCount)} />
                  <FieldValue label="Engineered features created" value={fmt(engineeredFeatureCount)} />
                  <FieldValue label="Encoded columns created" value={fmt(encodedFeatureCount)} />
                  <FieldValue label="Columns scaled / normalized" value={fmt(scaledFeatureCount)} />
                  <FieldValue label="Columns imputed" value={fmt(numericalColumns.length)} />
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.35, borderRadius: 2.25, bgcolor: '#FBFCFE' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#101828', mb: 0.8 }}>Excluded Scope</Typography>
                <Stack spacing={0.7}>
                  <FieldValue label="Dropped columns" value={fmt(droppedFeatureCount)} />
                  <FieldValue label="Leakage-blocked columns" value={fmt(leakageRiskFeatureCount)} />
                  <FieldValue label="Review-needed features" value={fmt(reviewSet.size)} />
                  <FieldValue label="Final model-ready dataset shape" value={`${fmt(preprocessedDataset?.row_count || preprocessStatus?.latest_run?.row_count || inputDataset?.row_count)} rows x ${fmt((preprocessedDataset?.columns || []).length || preprocessStatus?.latest_run?.column_count || featureRows.length)} columns`} />
                </Stack>
              </Paper>
            </Box>
          </WorkbenchSection>

          <WorkbenchSection title="Pipeline Run Logs" description="Warnings, success messages, and the most recent persisted run summaries are shown here.">
            <Stack spacing={0.9}>
              {runLogs.length ? runLogs.map((entry, index) => (
                <Paper
                  key={`${entry.level}_${index}`}
                  variant="outlined"
                  sx={{
                    p: 1.1,
                    borderRadius: 2,
                    bgcolor: entry.level === 'warning' ? '#FFF7ED' : entry.level === 'success' ? '#ECFDF3' : '#FBFCFE',
                  }}
                >
                  <Typography sx={{ fontSize: 12.5, color: '#101828' }}>{entry.text}</Typography>
                </Paper>
              )) : (
                <Typography sx={{ fontSize: 13, color: '#667085' }}>
                  No run logs are available yet. Generate a preview or run the pipeline to produce persisted execution records.
                </Typography>
              )}
            </Stack>
          </WorkbenchSection>
        </Stack>

        <Stack spacing={1.5}>
          <WorkbenchSection title="Downloadable Summary" description="This panel mirrors the final run checklist analysts expect before handing off to Model Build.">
            <Stack spacing={0.8}>
              <FieldValue label="Selected feature groups" value={selectedGroups.length ? selectedGroups.join(', ') : 'No specific groups recorded'} />
              <FieldValue label="Target column" value={targetColumn || 'mule_flag'} />
              <FieldValue label="Persisted output" value={preprocessStatus?.latest_run?.output_table_name || preprocessedDataset?.name || 'Not persisted yet'} />
              <FieldValue label="Recent run count" value={fmt(asArray(preprocessStatus?.recent_runs).length)} />
            </Stack>
          </WorkbenchSection>

          {persistMessage ? (
            <Alert severity={persistMessage.toLowerCase().includes('could not') ? 'error' : 'success'}>
              {persistMessage}
            </Alert>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  );

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.45, borderBottom: '1px solid rgba(16,24,40,0.08)', bgcolor: '#FCFCFD' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between" alignItems={{ md: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#101828' }}>
                Mule Preprocessing Workbench
              </Typography>
              <Typography sx={{ fontSize: 13, color: '#667085', mt: 0.45, lineHeight: 1.65, maxWidth: 980 }}>
                This is a dedicated analyst workbench, not a long settings page. It restores from persisted run state and organizes classification, encoding, feature engineering, governed inventory, selection, and final pipeline execution into explicit tabs.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<FilterAlt />}
                variant={techView === 'technical' ? 'contained' : 'outlined'}
                onClick={() => setTechView('technical')}
                sx={{ textTransform: 'none', bgcolor: techView === 'technical' ? '#C65A11' : undefined, '&:hover': { bgcolor: techView === 'technical' ? '#A64B12' : undefined } }}
              >
                Technical View
              </Button>
              <Button
                size="small"
                startIcon={<Insights />}
                variant={techView === 'business' ? 'contained' : 'outlined'}
                onClick={() => setTechView('business')}
                sx={{ textTransform: 'none', bgcolor: techView === 'business' ? '#C65A11' : undefined, '&:hover': { bgcolor: techView === 'business' ? '#A64B12' : undefined } }}
              >
                Business View
              </Button>
            </Stack>
          </Stack>
        </Box>

        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 1,
            bgcolor: '#FFFFFF',
            borderBottom: '1px solid rgba(16,24,40,0.08)',
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: 999,
              bgcolor: '#C65A11',
            },
            '& .MuiTab-root': {
              minHeight: 52,
              textTransform: 'none',
              color: '#667085',
              alignItems: 'flex-start',
              px: 1.5,
            },
            '& .Mui-selected': {
              color: '#101828',
            },
          }}
        >
          {TAB_DEFS.map(({ id, label, Icon }) => (
            <Tab
              key={id}
              value={id}
              icon={<Icon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label={(
                <Stack spacing={0.1} alignItems="flex-start">
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'inherit' }}>{label}</Typography>
                </Stack>
              )}
            />
          ))}
        </Tabs>
      </Paper>

      {activeTab === 'classification' ? renderClassificationTab() : null}
      {activeTab === 'encoding' ? renderEncodingTab() : null}
      {activeTab === 'engineering' ? renderEngineeringTab() : null}
      {activeTab === 'store' ? renderFeatureStoreTab() : null}
      {activeTab === 'selection' ? renderSelectionTab() : null}
      {activeTab === 'run' ? renderRunTab() : null}
    </Stack>
  );
}
