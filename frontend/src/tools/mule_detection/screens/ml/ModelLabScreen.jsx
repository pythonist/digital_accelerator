import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Typography,
  Stack,
  TextField,
  Button,
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Select,
  MenuItem,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  IconButton,
  Popover,
  Switch,
  FormControlLabel
} from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend } from 'recharts';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import muleApi from '../../services/muleApi';
import { pwcColors } from '../../theme';
import { formatInteger, formatNumber, formatPercentFromRatio, formatProbability } from '../../utils/formatters';
import { useMuleStore } from '../../store/muleStore';

const MODEL_PARAM_SCHEMAS = {
  xgboost: [
    {
      key: 'n_estimators',
      label: 'Trees',
      type: 'number',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 300,
      level: 'beginner',
      what: 'How many boosting rounds to run (more trees = more opportunities to fit).',
      overfit_risk: 'High values can overfit if trees are deep or learning rate is high.',
      compute_cost: 'Increases training time roughly linearly with tree count.'
    },
    {
      key: 'max_depth',
      label: 'Max depth',
      type: 'number',
      min: 2,
      max: 12,
      step: 1,
      defaultValue: 5,
      level: 'beginner',
      what: 'Maximum depth of each tree (how complex each tree can become).',
      overfit_risk: 'Higher depth can memorize patterns and overfit quickly.',
      compute_cost: 'Deeper trees increase training cost and memory.'
    },
    {
      key: 'learning_rate',
      label: 'Learning rate',
      type: 'number',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      defaultValue: 0.08,
      level: 'beginner',
      what: 'How big each boosting step is (smaller steps learn more gradually).',
      overfit_risk: 'Higher values can overfit and make training unstable.',
      compute_cost: 'Lower values typically need more trees to reach the same accuracy.'
    },
    {
      key: 'subsample',
      label: 'Row subsample',
      type: 'number',
      min: 0.5,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.9,
      level: 'beginner',
      what: 'Fraction of rows used to build each tree.',
      overfit_risk: 'Lower values often reduce overfitting by adding randomness.',
      compute_cost: 'Slightly lower cost per tree when subsample is lower.'
    },
    {
      key: 'colsample_bytree',
      label: 'Column subsample',
      type: 'number',
      min: 0.5,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.9,
      level: 'beginner',
      what: 'Fraction of features used to build each tree.',
      overfit_risk: 'Lower values can reduce overfitting when many correlated features exist.',
      compute_cost: 'Lower values reduce compute per tree.'
    },
    {
      key: 'reg_lambda',
      label: 'L2 regularization',
      type: 'number',
      min: 0.0,
      max: 10.0,
      step: 0.1,
      defaultValue: 1.0,
      level: 'expert',
      what: 'Penalty on large weights to keep the model conservative.',
      overfit_risk: 'Higher values usually reduce overfitting but can underfit if too high.',
      compute_cost: 'Minimal impact on compute; mainly affects the solution.'
    },
    {
      key: 'min_child_weight',
      label: 'Min child weight',
      type: 'number',
      min: 0.0,
      max: 10.0,
      step: 0.5,
      defaultValue: 1.0,
      level: 'expert',
      what: 'Minimum total weight in a leaf before a split is allowed.',
      overfit_risk: 'Higher values reduce overfitting by preventing tiny, noisy splits.',
      compute_cost: 'Can reduce compute by pruning splits early.'
    },
    {
      key: 'gamma',
      label: 'Min split loss',
      type: 'number',
      min: 0.0,
      max: 10.0,
      step: 0.1,
      defaultValue: 0.0,
      level: 'expert',
      what: 'Minimum improvement required to create a split.',
      overfit_risk: 'Higher values reduce overfitting by requiring stronger evidence to split.',
      compute_cost: 'Can reduce compute by limiting splits.'
    }
  ],
  randomforest: [
    {
      key: 'n_estimators',
      label: 'Trees',
      type: 'number',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 500,
      level: 'beginner',
      what: 'How many trees are averaged together.',
      overfit_risk: 'More trees usually reduce variance, but very deep trees can still overfit.',
      compute_cost: 'More trees increases training time and memory.'
    },
    {
      key: 'max_depth',
      label: 'Max depth',
      type: 'number',
      min: 2,
      max: 30,
      step: 1,
      defaultValue: 10,
      level: 'beginner',
      what: 'How deep each tree can grow.',
      overfit_risk: 'Deep trees can overfit; shallower trees generalize better.',
      compute_cost: 'Deeper trees increase compute and model size.'
    },
    {
      key: 'max_features',
      label: 'Max features',
      type: 'text',
      defaultValue: 'sqrt',
      level: 'beginner',
      what: 'How many features each split may consider (adds randomness).',
      overfit_risk: 'Lower values can reduce overfitting by de-correlating trees.',
      compute_cost: 'Lower values can reduce compute per split.'
    },
    {
      key: 'class_weight',
      label: 'Class weight',
      type: 'text',
      defaultValue: 'balanced',
      level: 'beginner',
      what: 'How to handle class imbalance between mule and non-mule.',
      overfit_risk: 'Incorrect weighting can cause unstable decision boundaries.',
      compute_cost: 'Minimal impact; changes how errors are treated.'
    },
    {
      key: 'min_samples_split',
      label: 'Min split',
      type: 'number',
      min: 2,
      max: 50,
      step: 1,
      defaultValue: 2,
      level: 'expert',
      what: 'Minimum samples needed to split an internal node.',
      overfit_risk: 'Higher values reduce overfitting by preventing small noisy splits.',
      compute_cost: 'Higher values can reduce compute by limiting growth.'
    },
    {
      key: 'min_samples_leaf',
      label: 'Min leaf',
      type: 'number',
      min: 1,
      max: 50,
      step: 1,
      defaultValue: 1,
      level: 'expert',
      what: 'Minimum samples required in a leaf node.',
      overfit_risk: 'Higher values reduce overfitting and improve stability.',
      compute_cost: 'Higher values can reduce compute and tree size.'
    }
  ],
  isolation_forest: [
    {
      key: 'contamination',
      label: 'Contamination',
      type: 'number',
      min: 0.001,
      max: 0.5,
      step: 0.01,
      defaultValue: 0.05,
      level: 'beginner',
      what: 'Expected fraction of anomalies in the population.',
      overfit_risk: 'Too high may overwhelm investigators with false positives.',
      compute_cost: 'Minimal impact; mostly affects thresholding.'
    },
    {
      key: 'n_estimators',
      label: 'Trees',
      type: 'number',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 300,
      level: 'beginner',
      what: 'How many isolation trees to build.',
      overfit_risk: 'Generally low; too few trees may be noisy/unstable.',
      compute_cost: 'More trees increases runtime and memory.'
    },
    {
      key: 'max_samples',
      label: 'Max samples',
      type: 'text',
      defaultValue: 'auto',
      level: 'expert',
      what: 'How many samples each tree uses.',
      overfit_risk: 'Small sample sizes can make results unstable.',
      compute_cost: 'Lower sample size reduces compute per tree.'
    }
  ]
  ,
  logistic: [
    {
      key: 'C',
      label: 'Regularization (C)',
      type: 'number',
      min: 0.01,
      max: 10.0,
      step: 0.01,
      defaultValue: 1.0,
      level: 'beginner',
      what: 'Controls how strongly coefficients are regularized (lower = more regularization).',
      overfit_risk: 'High C can overfit when many correlated features exist.',
      compute_cost: 'Low; trains fast.'
    },
    {
      key: 'class_weight',
      label: 'Class weight',
      type: 'text',
      defaultValue: 'balanced',
      level: 'beginner',
      what: 'Balances mule vs non-mule classes when positives are rare.',
      overfit_risk: 'Incorrect weighting can shift decision boundary.',
      compute_cost: 'Minimal.'
    },
    {
      key: 'max_iter',
      label: 'Max iterations',
      type: 'number',
      min: 50,
      max: 2000,
      step: 50,
      defaultValue: 500,
      level: 'expert',
      what: 'Optimization iterations.',
      overfit_risk: 'Not a direct overfit driver; affects convergence.',
      compute_cost: 'Higher iterations increase training time.'
    }
  ],
  lightgbm: [
    {
      key: 'n_estimators',
      label: 'Trees',
      type: 'number',
      min: 50,
      max: 3000,
      step: 50,
      defaultValue: 600,
      level: 'beginner',
      what: 'Number of boosting rounds.',
      overfit_risk: 'Very high tree counts can overfit without regularization.',
      compute_cost: 'Increases training time.'
    },
    {
      key: 'learning_rate',
      label: 'Learning rate',
      type: 'number',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      defaultValue: 0.05,
      level: 'beginner',
      what: 'Step size per boosting round.',
      overfit_risk: 'Higher values can overfit and destabilize.',
      compute_cost: 'Lower values often need more trees.'
    },
    {
      key: 'num_leaves',
      label: 'Leaves',
      type: 'number',
      min: 8,
      max: 255,
      step: 1,
      defaultValue: 31,
      level: 'beginner',
      what: 'Model complexity per tree.',
      overfit_risk: 'More leaves increases overfit risk.',
      compute_cost: 'More leaves can increase compute.'
    },
    {
      key: 'subsample',
      label: 'Row subsample',
      type: 'number',
      min: 0.5,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.9,
      level: 'beginner',
      what: 'Fraction of rows per tree.',
      overfit_risk: 'Lower values reduce overfitting by adding randomness.',
      compute_cost: 'Slightly lower cost.'
    },
    {
      key: 'colsample_bytree',
      label: 'Column subsample',
      type: 'number',
      min: 0.5,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.9,
      level: 'beginner',
      what: 'Fraction of features per tree.',
      overfit_risk: 'Lower values reduce correlation and overfit risk.',
      compute_cost: 'Lower values reduce compute.'
    }
  ],
  kmeans: [
    {
      key: 'n_clusters',
      label: 'Clusters',
      type: 'number',
      min: 2,
      max: 30,
      step: 1,
      defaultValue: 8,
      level: 'beginner',
      what: 'How many population segments to form.',
      overfit_risk: 'Too many clusters can fragment population and create unstable scoring.',
      compute_cost: 'More clusters increases training cost.'
    }
  ],
  dbscan: [
    {
      key: 'eps',
      label: 'Epsilon',
      type: 'number',
      min: 0.1,
      max: 5.0,
      step: 0.1,
      defaultValue: 0.8,
      level: 'beginner',
      what: 'Neighborhood radius used to define dense regions.',
      overfit_risk: 'Too small flags many outliers; too large hides anomalies.',
      compute_cost: 'Higher eps can increase neighbor checks.'
    },
    {
      key: 'min_samples',
      label: 'Min samples',
      type: 'number',
      min: 3,
      max: 200,
      step: 1,
      defaultValue: 10,
      level: 'beginner',
      what: 'Minimum points to form a dense region.',
      overfit_risk: 'Too low marks noise as clusters; too high may miss small rings.',
      compute_cost: 'Higher values may reduce sensitivity.'
    }
  ],
  pca_autoencoder: [
    {
      key: 'n_components',
      label: 'Components',
      type: 'number',
      min: 2,
      max: 80,
      step: 1,
      defaultValue: 10,
      level: 'beginner',
      what: 'How much behavior is treated as “normal structure”.',
      overfit_risk: 'Too many components can memorize; too few can miss structure.',
      compute_cost: 'More components increases compute.'
    }
  ]
};

const defaultHyperparams = (modelType) => {
  const schema = MODEL_PARAM_SCHEMAS[modelType] || [];
  const out = {};
  schema.forEach((p) => {
    out[p.key] = p.defaultValue;
  });
  return out;
};

const daysSince = (iso) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  const d = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(d)) return null;
  return Math.max(0, d);
};

const ParamInfoButton = ({ param }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const id = open ? `param-info-${param.key}` : undefined;
  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} aria-describedby={id}>
        <InfoOutlinedIcon fontSize="small" />
      </IconButton>
      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { p: 2, maxWidth: 360 } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
          {param.label}
        </Typography>
        <Stack spacing={1}>
          <Box>
            <Typography variant="caption" color="text.secondary">What it does</Typography>
            <Typography variant="body2">{param.what || '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Overfit risk</Typography>
            <Typography variant="body2">{param.overfit_risk || '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Compute cost</Typography>
            <Typography variant="body2">{param.compute_cost || '-'}</Typography>
          </Box>
        </Stack>
      </Popover>
    </>
  );
};

const CorrelationHeatmap = ({ heatmap }) => {
  if (!heatmap?.features?.length || !heatmap?.matrix?.length) return null;
  const features = heatmap.features;
  const matrix = heatmap.matrix;
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const bg = (v) => {
    const a = clamp(v);
    return `rgba(234, 88, 12, ${0.08 + a * 0.45})`;
  };
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: '#fff', fontWeight: 700 }}>Feature</TableCell>
            {features.map((f) => (
              <TableCell key={f} sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{f}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {features.map((rowF, i) => (
            <TableRow key={rowF}>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {rowF}
              </TableCell>
              {features.map((colF, j) => {
                const v = Number(matrix?.[i]?.[j] ?? 0);
                return (
                  <TableCell key={`${rowF}-${colF}`} sx={{ bgcolor: bg(v), fontVariantNumeric: 'tabular-nums' }}>
                    {v.toFixed(2)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const ModelLabScreen = () => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { starredModels } = useMuleStore();

  const [experiments, setExperiments] = useState([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState('');
  const [experimentForm, setExperimentForm] = useState({
    name: '',
    objective: '',
    owner: '',
    dataset_version: '',
    feature_set_version: ''
  });

  const [eligibleFeatures, setEligibleFeatures] = useState([]);
  const [featureFilter, setFeatureFilter] = useState({ drop_high_leakage: false, leakage_threshold: 2.5, drop_unstable: false, stability_threshold: 0.4 });
  const [featureSelection, setFeatureSelection] = useState({ include: [], exclude: [] });
  const [labelStats, setLabelStats] = useState(null);
  const [featureCatalog, setFeatureCatalog] = useState([]);
  const [featureRuns, setFeatureRuns] = useState([]);
  const [marketFilters, setMarketFilters] = useState({ q: '', category: '', risk: '', used_only: false, eligible_only: false });
  const [expandedFeatureCategories, setExpandedFeatureCategories] = useState([]);
  const [previewFeature, setPreviewFeature] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewProfile, setPreviewProfile] = useState(null);
  const [previewDistribution, setPreviewDistribution] = useState(null);
  const [previewLineage, setPreviewLineage] = useState(null);

  const [validation, setValidation] = useState({ type: 'random', test_size: 0.2, random_state: 42, oot_days: 30 });
  const [validationResult, setValidationResult] = useState(null);

  const [training, setTraining] = useState({ model_type: 'xgboost', use_smote: true, cv_folds: 5, threshold: 0.5, hyperparams: defaultHyperparams('xgboost') });
  const [trainingResult, setTrainingResult] = useState(null);
  const [expertMode, setExpertMode] = useState(false);

  const [globalExplain, setGlobalExplain] = useState([]);
  const [localExplainAccount, setLocalExplainAccount] = useState('');
  const [localExplain, setLocalExplain] = useState(null);

  const [biasResult, setBiasResult] = useState(null);

  const [models, setModels] = useState([]);
  const [compare, setCompare] = useState({ champion_model: '', challenger_model: '', threshold: 0.5 });
  const [compareResult, setCompareResult] = useState(null);

  const [approval, setApproval] = useState({ model_version: '', reviewer: '', decision: 'approve', comments: '', valid_until: '', activate: false });
  const [approvalResult, setApprovalResult] = useState(null);

  const [autoPickOpen, setAutoPickOpen] = useState(false);
  const [autoPickReport, setAutoPickReport] = useState(null);

  const selectedExperiment = useMemo(() => experiments.find((e) => e.experiment_id === selectedExperimentId) || null, [experiments, selectedExperimentId]);

  const dropdownModels = useMemo(() => {
    const starred = new Set((starredModels || []).map((x) => String(x)));
    if (starred.size === 0) return models;
    const keep = new Set(
      [compare.champion_model, compare.challenger_model, approval.model_version, ...Array.from(starred)]
        .filter(Boolean)
        .map((x) => String(x))
    );
    return models.filter((m) => keep.has(String(m.model_version)));
  }, [approval.model_version, compare.challenger_model, compare.champion_model, models, starredModels]);

  const loadExperiments = async () => {
    const res = await muleApi.listExperiments({ limit: 50 });
    const list = res?.experiments || [];
    setExperiments(list);
    if (!selectedExperimentId && list.length) setSelectedExperimentId(list[0].experiment_id);
  };

  const loadModels = async () => {
    try {
      const res = await muleApi.listModels();
      const list = res?.models || [];
      setModels(list);
      if (list.length) {
        const starred = new Set((starredModels || []).map((x) => String(x)));
        const preferred = list.filter((m) => starred.has(String(m.model_version)));
        const a = preferred[0] || list[0];
        const b = preferred[1] || list[1] || list[0];
        if (!compare.champion_model) setCompare((p) => ({ ...p, champion_model: a.model_version }));
        if (!compare.challenger_model && list.length > 1) setCompare((p) => ({ ...p, challenger_model: b.model_version }));
        if (!approval.model_version) setApproval((p) => ({ ...p, model_version: a.model_version }));
      }
    } catch {
      setModels([]);
    }
  };

  const refreshEligible = async () => {
    const res = await muleApi.getEligibleFeatures(featureFilter);
    setEligibleFeatures(res?.features || []);
    setLabelStats(res?.label_stats || null);
  };

  const loadFeatureCatalog = async () => {
    try {
      const res = await muleApi.getFeaturesCatalog();
      const list = res?.features || [];
      if (Array.isArray(list) && list.length) {
        setFeatureCatalog(list);
        return;
      }
      const fallback = await muleApi.listFeatures();
      const cols = fallback?.features || [];
      setFeatureCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null })));
    } catch {
      try {
        const fallback = await muleApi.listFeatures();
        const cols = fallback?.features || [];
        setFeatureCatalog(cols.map((c) => ({ feature_name: c.name, category: null, description: null, formula: null, owner: null, version: null })));
      } catch {
        setFeatureCatalog([]);
      }
    }
  };

  const loadFeatureRuns = async () => {
    try {
      const res = await muleApi.getFeatureRunsHistory({ limit: 25 });
      setFeatureRuns(res?.runs || []);
    } catch {
      setFeatureRuns([]);
    }
  };

  const openFeaturePreview = async (featureName) => {
    if (!featureName) return;
    setPreviewFeature(featureName);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const [p, d, lin] = await Promise.all([
        muleApi.getFeatureProfile(featureName),
        muleApi.getFeatureDistribution(featureName),
        muleApi.getFeatureLineage(featureName)
      ]);
      setPreviewProfile(p?.profile || null);
      setPreviewDistribution(d || null);
      setPreviewLineage(lin?.lineage || null);
    } catch {
      setPreviewProfile(null);
      setPreviewDistribution(null);
      setPreviewLineage(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadExperiments(), loadModels(), refreshEligible(), loadFeatureCatalog(), loadFeatureRuns()]);
      } catch (e) {
        setError(e?.response?.data?.error || e?.message || 'Failed to load Model Lab');
      }
    })();
  }, []);

  const createExperiment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.createExperiment(experimentForm);
      const exp = res?.experiment?.experiment_id;
      await loadExperiments();
      if (exp) setSelectedExperimentId(exp);
      setExperimentForm({ name: '', objective: '', owner: '', dataset_version: '', feature_set_version: '' });
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to create experiment');
    } finally {
      setLoading(false);
    }
  };

  const toggleInclude = (name) => {
    setFeatureSelection((p) => {
      const set = new Set(p.include || []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return { ...p, include: Array.from(set) };
    });
  };

  const toggleExclude = (name) => {
    setFeatureSelection((p) => {
      const set = new Set(p.exclude || []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return { ...p, exclude: Array.from(set) };
    });
  };

  const catalogByName = useMemo(() => {
    const m = new Map();
    (featureCatalog || []).forEach((f) => {
      if (f?.feature_name) m.set(String(f.feature_name), f);
    });
    return m;
  }, [featureCatalog]);

  const runTimestampById = useMemo(() => {
    const m = new Map();
    (featureRuns || []).forEach((r) => {
      if (r?.run_id) m.set(String(r.run_id), String(r.timestamp || ''));
    });
    return m;
  }, [featureRuns]);

  const importanceByFeature = useMemo(() => {
    const m = new Map();
    const imp = trainingResult?.feature_importance;
    if (Array.isArray(imp)) {
      imp.forEach((r) => {
        const name = r?.feature_name ?? r?.feature ?? r?.name;
        const v = r?.importance ?? r?.gain ?? r?.value ?? r?.score;
        if (name != null && v != null && Number.isFinite(Number(v))) m.set(String(name), Number(v));
      });
      return m;
    }
    if (imp && typeof imp === 'object') {
      Object.entries(imp).forEach(([k, v]) => {
        if (Number.isFinite(Number(v))) m.set(String(k), Number(v));
      });
    }
    return m;
  }, [trainingResult]);

  const usedInCurrentModel = useMemo(() => {
    const s = new Set();
    (trainingResult?.features_used || []).forEach((f) => s.add(String(f)));
    return s;
  }, [trainingResult]);

  const correlatedDropped = useMemo(() => {
    const s = new Set();
    (trainingResult?.feature_selection_report?.dropped_correlated || []).forEach((f) => s.add(String(f)));
    return s;
  }, [trainingResult]);

  const mergedFeatures = useMemo(() => {
    return (eligibleFeatures || []).map((f) => {
      const name = String(f.feature_name || '');
      const meta = catalogByName.get(name) || {};
      const runId = meta.created_in_run || meta.version;
      const ts = runTimestampById.get(String(runId || ''));
      const ageDays = daysSince(ts);
      const freshness = ageDays == null ? '-' : `${Math.round(ageDays)}d`;
      const imp = importanceByFeature.get(name);
      const computedImp = imp != null ? imp : (
        (1 - Math.min(1, Math.max(0, Number(f.missing_pct ?? meta.missing_pct ?? 0)))) * 0.35 +
        (Number(f.stability ?? meta.stability ?? 0.5) || 0) * 0.45 -
        (Number(f.leakage_risk ?? meta.leakage_risk ?? 0) || 0) * 0.20
      );
      return {
        ...meta,
        ...f,
        feature_name: name,
        category: meta.category || 'Uncategorized',
        description: meta.description || 'Engineered behavioral feature.',
        freshness,
        importance_score: Number.isFinite(Number(computedImp)) ? Number(computedImp) : 0,
        used_in_current_model: usedInCurrentModel.has(name),
        correlation_risk: correlatedDropped.has(name) ? 'HIGH' : 'UNKNOWN'
      };
    });
  }, [eligibleFeatures, catalogByName, runTimestampById, usedInCurrentModel, correlatedDropped, importanceByFeature]);

  const categories = useMemo(() => {
    const set = new Set();
    mergedFeatures.forEach((f) => set.add(String(f.category || 'Uncategorized')));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mergedFeatures]);

  const maxImportance = useMemo(() => {
    let m = 0;
    mergedFeatures.forEach((f) => {
      const v = Number(f.importance_score || 0);
      if (Number.isFinite(v) && v > m) m = v;
    });
    return m;
  }, [mergedFeatures]);

  const previewMeta = useMemo(() => mergedFeatures.find((f) => f.feature_name === previewFeature) || null, [mergedFeatures, previewFeature]);

  const previewCorrelations = useMemo(() => {
    const h = trainingResult?.correlation_heatmap;
    if (!previewFeature || !h?.features?.length || !h?.matrix?.length) return [];
    const idx = h.features.findIndex((x) => String(x) === String(previewFeature));
    if (idx < 0) return [];
    const row = h.matrix[idx] || [];
    const out = [];
    h.features.forEach((f, j) => {
      if (j === idx) return;
      const v = Number(row[j] ?? 0);
      if (!Number.isFinite(v)) return;
      out.push({ feature: String(f), corr: v });
    });
    return out.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)).slice(0, 10);
  }, [previewFeature, trainingResult]);

  const filteredFeatures = useMemo(() => {
    const q = String(marketFilters.q || '').trim().toLowerCase();
    const cat = String(marketFilters.category || '');
    const risk = String(marketFilters.risk || '');
    const usedOnly = Boolean(marketFilters.used_only);
    const eligibleOnly = Boolean(marketFilters.eligible_only);

    return mergedFeatures
      .filter((f) => {
        if (eligibleOnly && f.eligible !== true) return false;
        if (usedOnly && f.used_in_current_model !== true) return false;
        if (cat && String(f.category || '') !== cat) return false;
        if (q) {
          const hay = `${f.feature_name} ${f.description || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (!risk) return true;
        const warnings = Array.isArray(f.warnings) ? f.warnings.map((w) => String(w)) : [];
        if (risk === 'safe') return warnings.length === 0 && f.correlation_risk !== 'HIGH';
        if (risk === 'leakage') return warnings.some((w) => w.includes('LEAKAGE'));
        if (risk === 'unstable') return warnings.some((w) => w.includes('STABILITY') || w.includes('UNSTABLE'));
        if (risk === 'correlation') return f.correlation_risk === 'HIGH';
        return true;
      })
      .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
  }, [mergedFeatures, marketFilters]);

  const selectedFeatureNames = useMemo(
    () => new Set((featureSelection.include || []).map((item) => String(item))),
    [featureSelection.include],
  );

  const excludedFeatureNames = useMemo(
    () => new Set((featureSelection.exclude || []).map((item) => String(item))),
    [featureSelection.exclude],
  );

  const featureCategorySections = useMemo(() => {
    const grouped = new Map();
    filteredFeatures.forEach((feature) => {
      const categoryName = String(feature.category || 'Uncategorized');
      if (!grouped.has(categoryName)) {
        grouped.set(categoryName, []);
      }
      grouped.get(categoryName).push(feature);
    });
    return Array.from(grouped.entries())
      .map(([categoryName, items]) => ({
        categoryName,
        items,
        selectedCount: items.filter((item) => selectedFeatureNames.has(String(item.feature_name))).length,
        excludedCount: items.filter((item) => excludedFeatureNames.has(String(item.feature_name))).length,
        ineligibleCount: items.filter((item) => item.eligible !== true).length,
      }))
      .sort((left, right) => {
        if (right.items.length !== left.items.length) return right.items.length - left.items.length;
        return left.categoryName.localeCompare(right.categoryName);
      });
  }, [excludedFeatureNames, filteredFeatures, selectedFeatureNames]);

  const selectionSummary = useMemo(() => {
    const selected = selectedFeatureNames;
    const redundant = Array.from(selected).filter((n) => correlatedDropped.has(n)).length;
    const count = selected.size;
    const redundancy = count ? redundant / count : 0;
    const expectedDimensionality = Math.max(0, count - redundant);
    return { count, redundant, redundancy, expectedDimensionality };
  }, [selectedFeatureNames, correlatedDropped]);

  const handleFeatureCategoryToggle = (categoryName) => (_event, expanded) => {
    setExpandedFeatureCategories((previous) => {
      const active = new Set(previous);
      if (expanded) active.add(categoryName);
      else active.delete(categoryName);
      return Array.from(active);
    });
  };

  useEffect(() => {
    if (!featureCategorySections.length) {
      setExpandedFeatureCategories([]);
      return;
    }
    if (String(marketFilters.q || '').trim() || featureCategorySections.length === 1) {
      setExpandedFeatureCategories(featureCategorySections.map((section) => section.categoryName));
      return;
    }
    setExpandedFeatureCategories((previous) => {
      if (previous.length) return previous.filter((name) => featureCategorySections.some((section) => section.categoryName === name));
      return featureCategorySections.slice(0, 3).map((section) => section.categoryName);
    });
  }, [featureCategorySections, marketFilters.q]);

  const autoPickOptimalSet = () => {
    const excluded = new Set((featureSelection.exclude || []).map((x) => String(x)));
    const supervised = Boolean(labelStats?.has_results && Number(labelStats?.positives || 0) > 0 && Number(labelStats?.positives || 0) < Number(labelStats?.total || 0));

    const all = mergedFeatures || [];
    const ineligible = all.filter((f) => f.eligible !== true).length;
    const excludedByUser = excluded.size;

    const candidates = all.filter((f) => f.eligible === true && !excluded.has(f.feature_name));
    const leakageFlagged = candidates.filter((f) => (Array.isArray(f.warnings) ? f.warnings : []).some((w) => String(w).includes('LEAKAGE'))).length;
    const unstableFlagged = candidates.filter((f) => (Array.isArray(f.warnings) ? f.warnings : []).some((w) => String(w).includes('STABILITY') || String(w).includes('UNSTABLE'))).length;
    const corrFlagged = candidates.filter((f) => f.correlation_risk === 'HIGH').length;

    const scored = candidates
      .map((f) => {
        const iv = Number(f.iv);
        const rarity = String(f.rarity_verdict || '').toUpperCase();
        const ivBoost = supervised && Number.isFinite(iv) ? Math.min(1.5, Math.max(0, iv)) * 0.9 : 0;
        const rarityBoost = !supervised ? (rarity === 'EXTREME' ? 0.45 : rarity === 'UNUSUAL' ? 0.2 : 0) : 0;
        const corrPenalty = f.correlation_risk === 'HIGH' ? 0.25 : 0;
        const score = Number(f.importance_score || 0) + ivBoost + rarityBoost - corrPenalty;
        return { name: f.feature_name, score, typology: String(f.typology || 'UNMAPPED') };
      })
      .sort((a, b) => b.score - a.score);

    const maxFeatures = 50;
    const picked = [];
    const seenTypologies = new Set();
    const byTypology = new Map();
    for (const s of scored) {
      if (!byTypology.has(s.typology)) byTypology.set(s.typology, []);
      byTypology.get(s.typology).push(s);
    }
    const typologyLeaders = Array.from(byTypology.entries())
      .map(([_t, list]) => list[0])
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    for (const s of typologyLeaders) {
      if (picked.length >= Math.min(12, maxFeatures)) break;
      picked.push(s.name);
      seenTypologies.add(s.typology);
    }
    for (const s of scored) {
      if (picked.length >= maxFeatures) break;
      if (picked.includes(s.name)) continue;
      picked.push(s.name);
      seenTypologies.add(s.typology);
    }

    setFeatureSelection((prev) => ({ ...prev, include: picked }));

    setAutoPickReport({
      supervised,
      total_available: all.length,
      ineligible,
      excluded_by_user: excludedByUser,
      candidates: candidates.length,
      leakage_flagged: leakageFlagged,
      unstable_flagged: unstableFlagged,
      correlation_flagged: corrFlagged,
      typology_covered: seenTypologies.size,
      picked: picked.length,
      max_features: maxFeatures,
      rules: {
        remove_leakage: Boolean(featureFilter.drop_high_leakage),
        leakage_threshold: Number(featureFilter.leakage_threshold),
        remove_unstable: Boolean(featureFilter.drop_unstable),
        stability_threshold: Number(featureFilter.stability_threshold),
        correlation_threshold: 0.85
      }
    });
    setAutoPickOpen(true);
  };

  const runValidation = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.runValidation({ experiment_id: selectedExperimentId, strategy: validation });
      setValidationResult(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  const runTraining = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.runTraining({
        experiment_id: selectedExperimentId,
        feature_set_version: selectedExperiment?.feature_set_version || '',
        model_type: training.model_type,
        use_smote: training.use_smote,
        cv_folds: Number(training.cv_folds),
        threshold: Number(training.threshold),
        hyperparams: training.hyperparams || {},
        validation,
        feature_selection: featureSelection
      });
      setTrainingResult(res);
      if (res?.model_version) {
        const ge = await muleApi.getGlobalExplain({ model_version: res.model_version });
        setGlobalExplain(ge?.global || []);
      }
      await loadModels();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Training failed');
    } finally {
      setLoading(false);
    }
  };

  const runLocalExplain = async () => {
    const model_version = trainingResult?.model_version || approval.model_version;
    if (!model_version || !localExplainAccount) return;
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.getLocalExplain({ model_version, account_id: localExplainAccount });
      setLocalExplain(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Local explain failed');
    } finally {
      setLoading(false);
    }
  };

  const runBias = async () => {
    const model_version = trainingResult?.model_version || approval.model_version;
    if (!model_version) return;
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.runBiasChecks({ model_version, threshold: Number(training.threshold) });
      setBiasResult(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Bias checks failed');
    } finally {
      setLoading(false);
    }
  };

  const runCompare = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.compareModels(compare);
      setCompareResult(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Compare failed');
    } finally {
      setLoading(false);
    }
  };

  const submitApproval = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await muleApi.approveModel({ ...approval, experiment_id: selectedExperimentId, decision: approval.decision });
      setApprovalResult(res);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Approval update failed');
    } finally {
      setLoading(false);
    }
  };

  const tradeoffs = trainingResult?.tradeoffs || null;
  const prCurve = tradeoffs?.precision_recall || null;
  const prData = useMemo(() => {
    if (!prCurve?.precision || !prCurve?.recall) return [];
    const p = prCurve.precision;
    const r = prCurve.recall;
    const out = [];
    const n = Math.min(p.length, r.length);
    for (let i = 0; i < n; i += 1) out.push({ recall: r[i], precision: p[i] });
    return out;
  }, [prCurve]);
  const suppressionData = tradeoffs?.suppression_vs_event_loss || [];

  const readiness = useMemo(() => {
    const l = trainingResult?.metrics?.roc_auc;
    const leak = eligibleFeatures.filter((f) => (f.warnings || []).includes('LEAKAGE_RISK') || (f.warnings || []).includes('HIGH_LEAKAGE')).length;
    const unstable = eligibleFeatures.filter((f) => (f.warnings || []).includes('LOW_STABILITY') || (f.warnings || []).includes('UNSTABLE')).length;
    if (leak > 0 || unstable > 0) return { label: 'CAUTION', color: pwcColors.warningText, bg: pwcColors.warningBg };
    if (l && Number(l) < 0.6) return { label: 'BLOCK', color: pwcColors.errorText, bg: pwcColors.errorBg };
    return { label: 'READY', color: pwcColors.successText, bg: pwcColors.successBg };
  }, [eligibleFeatures, trainingResult]);

  const visibleParams = useMemo(() => {
    const schema = MODEL_PARAM_SCHEMAS[training.model_type] || [];
    return expertMode ? schema : schema.filter((p) => p.level !== 'expert');
  }, [expertMode, training.model_type]);

  const guidance = useMemo(() => {
    const warnings = [];
    const recommendations = [];

    const leak = eligibleFeatures.filter((f) => (f.warnings || []).includes('LEAKAGE_RISK') || (f.warnings || []).includes('HIGH_LEAKAGE')).length;
    const unstable = eligibleFeatures.filter((f) => (f.warnings || []).includes('LOW_STABILITY') || (f.warnings || []).includes('UNSTABLE')).length;
    if (leak > 0) {
      warnings.push({
        title: 'Leakage suspicion',
        detail: `${leak} features are flagged for leakage risk. Consider tightening the leakage threshold or excluding suspicious features.`
      });
    }
    if (unstable > 0) {
      warnings.push({
        title: 'Unstable features detected',
        detail: `${unstable} features are flagged for low stability. These can cause drift and noisy explanations.`
      });
    }

    const corrDropped = (trainingResult?.feature_selection_report?.dropped_correlated || []).length;
    const corrThresh = trainingResult?.feature_selection_report?.correlation_threshold;
    if (corrDropped > 0) {
      warnings.push({
        title: 'High correlation',
        detail: `${corrDropped} features were dropped as redundant${corrThresh != null ? ` (threshold ${Number(corrThresh).toFixed(2)})` : ''}. Consider reducing similar features and keeping the most interpretable signal per cluster.`
      });
    }

    const sel = new Set((featureSelection.include || []).map((x) => String(x)));
    const selectedVelocity = Array.from(sel).filter((n) => /velocity|tx_count|txn_count|count_24h|avg_per_day|peak_day/i.test(n)).length;
    if (sel.size > 0 && selectedVelocity >= Math.max(8, Math.round(sel.size * 0.35))) {
      warnings.push({
        title: 'Too many velocity features',
        detail: `${selectedVelocity} of ${sel.size} selected features look like velocity/volume signals. This can over-weight one theme and hurt generalization. Keep a few representative velocity features and add diversity (device, network, counterparties, retention).`
      });
    }

    const posRate = labelStats?.has_results ? Number(labelStats.positive_rate) : null;
    if (posRate != null && Number.isFinite(posRate)) {
      if (posRate < 0.03) {
        warnings.push({
          title: 'Imbalance risk',
          detail: `Positive rate is ${Math.round(posRate * 1000) / 10}%. Severe imbalance can inflate accuracy and reduce recall. Consider SMOTE, threshold tuning, and PR/recall-focused monitoring.`
        });
      } else if (posRate < 0.08) {
        recommendations.push({
          title: 'Class imbalance is meaningful',
          detail: `Positive rate is ${Math.round(posRate * 1000) / 10}%. Use PR curve, recall, and investigator capacity when selecting thresholds.`
        });
      }
    }

    if (validation.type === 'random') {
      recommendations.push({
        title: 'Prefer time-based validation for transaction data',
        detail: 'Random splits can leak time signals. Use a time split with an out-of-time window to reflect production behavior.'
      });
    }
    if (Number(training.cv_folds || 0) < 3) {
      recommendations.push({
        title: 'Increase CV folds',
        detail: 'Use at least 3 folds to reduce variance in model selection. 5 folds is a common default.'
      });
    }

    const hp = training.hyperparams || {};
    if (training.model_type === 'xgboost') {
      const depth = Number(hp.max_depth);
      const trees = Number(hp.n_estimators);
      const lr = Number(hp.learning_rate);
      const subs = Number(hp.subsample);
      const cols = Number(hp.colsample_bytree);

      if (Number.isFinite(depth) && depth >= 8) {
        warnings.push({
          title: 'High overfitting risk (deep trees)',
          detail: 'Max depth is high. Consider reducing depth or adding stronger regularization.'
        });
      }
      if (Number.isFinite(trees) && trees >= 1000) {
        warnings.push({
          title: 'High compute cost (many trees)',
          detail: 'Tree count is high and will increase training time. Consider fewer trees or a smaller learning rate.'
        });
      }
      if (Number.isFinite(lr) && lr >= 0.18) {
        warnings.push({
          title: 'Learning rate is aggressive',
          detail: 'Higher learning rates can overfit quickly. Consider lowering learning rate and increasing trees gradually.'
        });
      }
      if (Number.isFinite(subs) && subs >= 0.98 && Number.isFinite(cols) && cols >= 0.98 && Number.isFinite(depth) && depth >= 6) {
        recommendations.push({
          title: 'Add randomness to generalize better',
          detail: 'Try row subsample and column subsample below 1.0 to reduce correlation and improve generalization.'
        });
      }
    }

    if (training.model_type === 'randomforest') {
      const depth = Number(hp.max_depth);
      const trees = Number(hp.n_estimators);
      if (Number.isFinite(depth) && depth >= 20) {
        warnings.push({
          title: 'Very deep trees can overfit',
          detail: 'Consider reducing max depth or increasing minimum leaf size for stability.'
        });
      }
      if (Number.isFinite(trees) && trees >= 1200) {
        warnings.push({
          title: 'High compute cost (many trees)',
          detail: 'Large forests can be slow to train and evaluate. Consider fewer trees unless variance is still high.'
        });
      }
    }

    if (training.model_type === 'isolation_forest') {
      const contam = Number(hp.contamination);
      if (Number.isFinite(contam) && contam >= 0.15) {
        warnings.push({
          title: 'Contamination may be too high',
          detail: 'This will label many accounts as anomalies. Consider reducing contamination to match expected case volumes.'
        });
      }
    }

    return { warnings, recommendations };
  }, [eligibleFeatures, featureSelection.include, labelStats, training, trainingResult, validation.type]);

  const modeInfo = useMemo(() => {
    const total = Number(labelStats?.total || 0);
    const positives = Number(labelStats?.positives || 0);
    const supervised = Boolean(labelStats?.has_results && total > 0 && positives > 0 && positives < total);
    const eligibleCount = (eligibleFeatures || []).filter((f) => f?.eligible === true).length;
    const positiveRate = labelStats?.positive_rate != null ? Number(labelStats.positive_rate) : null;
    return {
      supervised,
      target: 'is_mule',
      eligibleCount,
      totalLabelled: total || null,
      positives: positives || null,
      positiveRate: positiveRate != null && Number.isFinite(positiveRate) ? positiveRate : null
    };
  }, [eligibleFeatures, labelStats]);

  const leaderboard = useMemo(() => {
    const list = Array.isArray(models) ? models : [];
    const rows = list
      .map((m) => ({
        model_version: m.model_version,
        algorithm: m.algorithm,
        trained_at: m.trained_at,
        auc: m.auc != null ? Number(m.auc) : null,
        recall: m.recall != null ? Number(m.recall) : null,
        precision: m.precision != null ? Number(m.precision) : null,
        f1: m.f1 != null ? Number(m.f1) : null,
        status: m.status
      }))
      .filter((m) => m.model_version)
      .sort((a, b) => (Number.isFinite(b.auc) ? b.auc : -1) - (Number.isFinite(a.auc) ? a.auc : -1));
    return { champion: rows[0]?.model_version || '', rows: rows.slice(0, 12) };
  }, [models]);

  const businessThreshold = useMemo(() => {
    if (!tradeoffs?.confusion_matrix?.length) return null;
    const cm = tradeoffs.confusion_matrix;
    const tn = Number(cm?.[0]?.[0] ?? 0);
    const fp = Number(cm?.[0]?.[1] ?? 0);
    const fn = Number(cm?.[1]?.[0] ?? 0);
    const tp = Number(cm?.[1]?.[1] ?? 0);
    const total = tn + fp + fn + tp;
    const alerts = fp + tp;
    const suppressed = tn + fn;
    const suppressionPct = total > 0 ? suppressed / total : null;
    const positives = (labelStats?.positives != null ? Number(labelStats.positives) : null);
    const missedRate = positives && positives > 0 ? fn / positives : null;
    const t = Number(tradeoffs.threshold ?? training.threshold ?? 0.5);
    const curve = Array.isArray(suppressionData) ? suppressionData : [];
    const closest = curve.length
      ? curve.reduce((best, cur) => (Math.abs(Number(cur.threshold) - t) < Math.abs(Number(best.threshold) - t) ? cur : best), curve[0])
      : null;
    return {
      threshold: t,
      alerts,
      suppressionPct: closest?.suppression != null ? Number(closest.suppression) : suppressionPct,
      missed: fn,
      missedRate: closest?.event_loss != null ? Number(closest.event_loss) : missedRate
    };
  }, [labelStats, suppressionData, tradeoffs, training.threshold]);

  const featureTheme = (featureName) => {
    const name = String(featureName || '');
    const n = name.toLowerCase();
    const meta = catalogByName.get(name) || {};
    const cat = String(meta.category || '').trim();
    const typ = String(meta.typology || '').trim();

    if (/(pass[_-]?through|in[_-]?out|out[_-]?in|outbound[_-]?to[_-]?inbound)/i.test(n)) return { theme: 'Velocity', statement: 'rapid outward movement' };
    if (/(count_24h|tx_count|txn_count|velocity|avg_per_day|peak_day)/i.test(n)) return { theme: 'Velocity', statement: 'high transaction velocity' };
    if (/(device|ip|vpn|fingerprint|imei|mac)/i.test(n)) return { theme: 'Device', statement: 'shares devices across accounts' };
    if (/(centrality|pagerank|community|clustering|degree|network|graph)/i.test(n)) return { theme: 'Network', statement: 'network coordination patterns' };
    if (/(cycle|circular|round_trip|loop)/i.test(n)) return { theme: 'Circularity', statement: 'circular transfer behavior' };
    if (/(time_to|dwell|hold|minutes|hours)/i.test(n)) return { theme: 'Timing', statement: 'funds exit unusually fast' };
    if (/(cash|atm|withdraw)/i.test(n)) return { theme: 'Cash', statement: 'cash intensity patterns' };
    if (/(counterparty|unique_counterparty|distinct_counterparty)/i.test(n)) return { theme: 'Counterparties', statement: 'unusually broad counterparty activity' };
    if (/(kyc|age|occupation|income|risk_rating)/i.test(n)) return { theme: 'KYC', statement: 'risky KYC profile signals' };

    const fallbackTheme = cat || (typ ? 'Typology' : 'Behavior');
    const fallbackStatement = typ ? typ.toLowerCase() : (cat ? `${cat.toLowerCase()} pattern` : 'unusual behavior');
    return { theme: fallbackTheme, statement: fallbackStatement };
  };

  const globalNarrative = useMemo(() => {
    if (!Array.isArray(globalExplain) || globalExplain.length === 0) return null;
    const themes = [];
    const seen = new Set();
    for (const r of globalExplain.slice(0, 12)) {
      const t = featureTheme(r?.feature).theme;
      const key = String(t || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      themes.push(key);
      if (themes.length >= 4) break;
    }
    if (themes.length === 0) return null;
    return { themes, sentence: `High impact drivers → ${themes.join(' + ')}` };
  }, [globalExplain, catalogByName]);

  const localNarrative = useMemo(() => {
    if (!localExplain?.success) return null;
    const rows = Array.isArray(localExplain.local) ? localExplain.local : [];
    if (rows.length === 0) return null;
    const method = String(localExplain.method || '');
    const scored = rows
      .map((r) => {
        const value = r?.value;
        const contrib = method === 'shap' ? Number(r?.shap || 0) : Number(r?.importance || 0);
        return { feature: String(r?.feature || ''), value, contrib };
      })
      .filter((r) => r.feature);
    const positives = scored.filter((r) => r.contrib > 0).sort((a, b) => b.contrib - a.contrib);
    const picked = (method === 'shap' && positives.length ? positives : scored.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))).slice(0, 6);

    const bullets = [];
    const seen = new Set();
    const themes = [];
    for (const p of picked) {
      const { theme, statement } = featureTheme(p.feature);
      const key = String(statement || '').trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        bullets.push(statement);
      }
      if (theme && !themes.includes(theme)) themes.push(theme);
      if (bullets.length >= 3) break;
    }
    if (bullets.length === 0) return null;
    const meaning = modeInfo.supervised ? 'Likelihood of mule involvement' : 'Behavioral abnormality requiring review';
    const headline = modeInfo.supervised ? 'Account is risky because:' : 'Account requires review because:';
    return { meaning, headline, bullets, themes };
  }, [catalogByName, localExplain, modeInfo.supervised]);

  return (
    <Box sx={{ p: 0 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Model Lab" subheader="Experiment → validate → train → explain → govern → register" />
            <CardContent>
              <Box sx={{ p: 2, mb: 2, borderRadius: 1, border: '1px solid rgba(15,23,42,0.12)', bgcolor: modeInfo.supervised ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.10)' }}>
                <Typography sx={{ fontWeight: 900, letterSpacing: 1.1 }}>
                  {modeInfo.supervised ? 'YOU ARE IN SUPERVISED LEARNING MODE' : 'YOU ARE IN BEHAVIORAL / ANOMALY MODE'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {modeInfo.supervised ? 'Models are validated against an approved outcome label.' : 'Outcome label unavailable. This run focuses on defensible behavioral ranking and monitoring.'}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.25 }}>
                  <Chip label={`Target: ${modeInfo.target}`} />
                  <Chip label={`Eligible features: ${formatInteger(modeInfo.eligibleCount)}`} />
                  {modeInfo.supervised ? (
                    <>
                      <Chip label={`Positives: ${formatInteger(modeInfo.positives || 0)}`} />
                      <Chip label={`Positive rate: ${formatPercentFromRatio(modeInfo.positiveRate || 0)}`} />
                    </>
                  ) : (
                    <Chip label="Output: abnormality ranking" />
                  )}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                <Chip label={`Status: ${readiness.label}`} sx={{ bgcolor: readiness.bg, color: readiness.color }} />
                <Chip label={`Experiment: ${selectedExperimentId || '-'}`} />
                <Chip label={`Dataset: ${selectedExperiment?.dataset_version || '-'}`} />
                <Chip label={`Feature set: ${selectedExperiment?.feature_set_version || '-'}`} />
                {trainingResult?.model_version && <Chip label={`Model: ${trainingResult.model_version}`} />}
                <Button onClick={() => { loadExperiments(); refreshEligible(); loadModels(); }} disabled={loading}>Refresh</Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Experiment Setup" subheader="Every run becomes a historical record" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={7}>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Experiment</TableCell>
                          <TableCell>Objective</TableCell>
                          <TableCell>Owner</TableCell>
                          <TableCell>Dataset</TableCell>
                          <TableCell>Feature Set</TableCell>
                          <TableCell>Created</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {experiments.map((e) => (
                          <TableRow key={e.experiment_id} hover selected={e.experiment_id === selectedExperimentId} onClick={() => setSelectedExperimentId(e.experiment_id)}>
                            <TableCell>{e.name}</TableCell>
                            <TableCell>{e.objective}</TableCell>
                            <TableCell>{e.owner}</TableCell>
                            <TableCell>{e.dataset_version}</TableCell>
                            <TableCell>{e.feature_set_version}</TableCell>
                            <TableCell>{String(e.created_at || '')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
                <Grid item xs={12} md={5}>
                  <Card elevation={0}>
                    <CardHeader title="Create Experiment" />
                    <CardContent>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField label="Experiment name" value={experimentForm.name} onChange={(e) => setExperimentForm({ ...experimentForm, name: e.target.value })} fullWidth />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField label="Objective" value={experimentForm.objective} onChange={(e) => setExperimentForm({ ...experimentForm, objective: e.target.value })} fullWidth />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField label="Owner" value={experimentForm.owner} onChange={(e) => setExperimentForm({ ...experimentForm, owner: e.target.value })} fullWidth />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField label="Dataset version" value={experimentForm.dataset_version} onChange={(e) => setExperimentForm({ ...experimentForm, dataset_version: e.target.value })} fullWidth />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField label="Feature set version" value={experimentForm.feature_set_version} onChange={(e) => setExperimentForm({ ...experimentForm, feature_set_version: e.target.value })} fullWidth />
                        </Grid>
                        <Grid item xs={12}>
                          <Button variant="contained" onClick={createExperiment} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>Create</Button>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Data & Feature Selection" subheader="Include/exclude, warn, and enforce governance rules" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={3}>
                  <Card elevation={0}>
                    <CardHeader title="Filters" subheader="Search, segment, and pick features visually" />
                    <CardContent>
                      <Stack spacing={2}>
                        <TextField
                          size="small"
                          label="Search"
                          value={marketFilters.q}
                          onChange={(e) => setMarketFilters((p) => ({ ...p, q: e.target.value }))}
                          fullWidth
                        />

                        <FormControl size="small" fullWidth>
                          <InputLabel>Category</InputLabel>
                          <Select
                            value={marketFilters.category}
                            label="Category"
                            onChange={(e) => setMarketFilters((p) => ({ ...p, category: e.target.value }))}
                          >
                            <MenuItem value="">All</MenuItem>
                            {categories.map((c) => (
                              <MenuItem key={c} value={c}>{c}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <FormControl size="small" fullWidth>
                          <InputLabel>Risk</InputLabel>
                          <Select
                            value={marketFilters.risk}
                            label="Risk"
                            onChange={(e) => setMarketFilters((p) => ({ ...p, risk: e.target.value }))}
                          >
                            <MenuItem value="">All</MenuItem>
                            <MenuItem value="safe">Safe</MenuItem>
                            <MenuItem value="leakage">Leakage</MenuItem>
                            <MenuItem value="unstable">Unstable</MenuItem>
                            <MenuItem value="correlation">Correlation</MenuItem>
                          </Select>
                        </FormControl>

                        <FormControlLabel
                          control={<Switch checked={marketFilters.used_only} onChange={(e) => setMarketFilters((p) => ({ ...p, used_only: e.target.checked }))} />}
                          label="Used in model"
                        />
                        <FormControlLabel
                          control={<Switch checked={marketFilters.eligible_only} onChange={(e) => setMarketFilters((p) => ({ ...p, eligible_only: e.target.checked }))} />}
                          label="Eligible only"
                        />

                        <Divider />

                        <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                          Governance Rules
                        </Typography>
                        <Stack direction="row" spacing={2}>
                          <FormControl size="small" fullWidth>
                            <InputLabel>Leakage</InputLabel>
                            <Select
                              value={featureFilter.drop_high_leakage ? 'drop' : 'warn'}
                              label="Leakage"
                              onChange={(e) => setFeatureFilter({ ...featureFilter, drop_high_leakage: e.target.value === 'drop' })}
                            >
                              <MenuItem value="drop">Drop high leakage</MenuItem>
                              <MenuItem value="warn">Warn only</MenuItem>
                            </Select>
                          </FormControl>
                          <TextField
                            size="small"
                            label="Threshold"
                            value={featureFilter.leakage_threshold}
                            onChange={(e) => setFeatureFilter({ ...featureFilter, leakage_threshold: Number(e.target.value) })}
                          />
                        </Stack>
                        <Stack direction="row" spacing={2}>
                          <FormControl size="small" fullWidth>
                            <InputLabel>Stability</InputLabel>
                            <Select
                              value={featureFilter.drop_unstable ? 'drop' : 'warn'}
                              label="Stability"
                              onChange={(e) => setFeatureFilter({ ...featureFilter, drop_unstable: e.target.value === 'drop' })}
                            >
                              <MenuItem value="drop">Drop unstable</MenuItem>
                              <MenuItem value="warn">Warn only</MenuItem>
                            </Select>
                          </FormControl>
                          <TextField
                            size="small"
                            label="Threshold"
                            value={featureFilter.stability_threshold}
                            onChange={(e) => setFeatureFilter({ ...featureFilter, stability_threshold: Number(e.target.value) })}
                          />
                        </Stack>
                        <Button variant="outlined" onClick={() => { refreshEligible(); loadFeatureCatalog(); loadFeatureRuns(); }} disabled={loading}>
                          Refresh Marketplace
                        </Button>

                        <Divider />

                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip label={`Showing: ${formatInteger(filteredFeatures.length)}`} />
                          <Chip label={`Selected: ${formatInteger(selectionSummary.count)}`} />
                          <Chip label={`Excluded: ${formatInteger((featureSelection.exclude || []).length)}`} />
                        </Stack>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip label={`Redundancy: ${formatProbability(selectionSummary.redundancy, 2)}`} />
                          <Chip label={`Expected dims: ${formatInteger(selectionSummary.expectedDimensionality)}`} />
                        </Stack>

                        <Button variant="contained" onClick={autoPickOptimalSet} sx={{ bgcolor: pwcColors.primary }}>
                          Auto pick optimal set
                        </Button>
                        <Button variant="outlined" onClick={() => setFeatureSelection({ include: [], exclude: [] })}>
                          Clear selection
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={9}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }} sx={{ mb: 2 }}>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                          Feature selection workspace
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Features are grouped by category so large selections stay scan-friendly during review and demo walkthroughs.
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip label={`${formatInteger(featureCategorySections.length)} categories`} />
                        <Chip label={`${formatInteger(filteredFeatures.length)} filtered features`} />
                        <Chip label={`${formatInteger(selectionSummary.count)} selected`} color="primary" variant="outlined" />
                      </Stack>
                    </Stack>

                    <Stack spacing={1.25}>
                      {featureCategorySections.map((section) => (
                        <Accordion
                          key={section.categoryName}
                          expanded={expandedFeatureCategories.includes(section.categoryName)}
                          onChange={handleFeatureCategoryToggle(section.categoryName)}
                          disableGutters
                          sx={{ border: '1px solid rgba(15,23,42,0.08)', borderRadius: 1.5, overflow: 'hidden', '&:before': { display: 'none' } }}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                                  {section.categoryName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {`${formatInteger(section.items.length)} features in this category`}
                                </Typography>
                              </Box>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip size="small" label={`${formatInteger(section.selectedCount)} selected`} color={section.selectedCount ? 'primary' : 'default'} variant="outlined" />
                                <Chip size="small" label={`${formatInteger(section.excludedCount)} excluded`} color={section.excludedCount ? 'error' : 'default'} variant="outlined" />
                                <Chip size="small" label={`${formatInteger(section.ineligibleCount)} ineligible`} variant="outlined" />
                              </Stack>
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails sx={{ p: 0 }}>
                            <TableContainer sx={{ maxHeight: 420 }}>
                              <Table size="small" stickyHeader>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Feature</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Freshness</TableCell>
                                    <TableCell>Importance</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Correlation</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Nulls</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Stability</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Leakage</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="center">Select</TableCell>
                                    <TableCell align="center">Exclude</TableCell>
                                    <TableCell align="center">Preview</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {section.items.map((f) => {
                                    const included = selectedFeatureNames.has(String(f.feature_name));
                                    const excluded = excludedFeatureNames.has(String(f.feature_name));
                                    const eligible = f.eligible === true;
                                    const impNorm = maxImportance > 0 ? Number(f.importance_score || 0) / maxImportance : 0;
                                    const impLabel = impNorm >= 0.67 ? 'High' : impNorm >= 0.34 ? 'Medium' : 'Low';
                                    const corrLabel = f.correlation_risk === 'HIGH' ? 'High' : 'Not evaluated';
                                    const missing = f.missing_pct != null ? formatPercentFromRatio(f.missing_pct, 1) : '-';
                                    const stable = f.stability != null ? formatProbability(f.stability, 2) : '-';
                                    const leak = f.leakage_risk != null ? formatProbability(f.leakage_risk, 2) : '-';
                                    return (
                                      <TableRow
                                        key={f.feature_name}
                                        hover
                                        onClick={() => openFeaturePreview(f.feature_name)}
                                        sx={{ opacity: !eligible ? 0.85 : 1 }}
                                      >
                                        <TableCell>
                                          <Stack spacing={0.25}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>
                                              {f.feature_name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                              {f.description}
                                            </Typography>
                                          </Stack>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{f.freshness || '-'}</TableCell>
                                        <TableCell>
                                          <Chip size="small" label={impLabel} color={impLabel === 'High' ? 'primary' : impLabel === 'Medium' ? 'warning' : 'default'} />
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                          <Chip size="small" label={corrLabel} color={f.correlation_risk === 'HIGH' ? 'error' : 'default'} />
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{missing}</TableCell>
                                        <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{stable}</TableCell>
                                        <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{leak}</TableCell>
                                        <TableCell>
                                          <Stack direction="row" spacing={1} flexWrap="wrap">
                                            {!eligible ? <Chip size="small" variant="outlined" label="Ineligible" /> : null}
                                            {f.used_in_current_model ? <Chip size="small" color="success" label="Used" /> : null}
                                          </Stack>
                                        </TableCell>
                                        <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                          <Checkbox
                                            checked={included}
                                            disabled={!eligible}
                                            onClick={() => toggleInclude(f.feature_name)}
                                          />
                                        </TableCell>
                                        <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                          <Button
                                            size="small"
                                            variant={excluded ? 'contained' : 'outlined'}
                                            onClick={() => toggleExclude(f.feature_name)}
                                            color={excluded ? 'error' : 'inherit'}
                                          >
                                            {excluded ? 'Excluded' : 'Exclude'}
                                          </Button>
                                        </TableCell>
                                        <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                          <Button size="small" variant="text" onClick={() => openFeaturePreview(f.feature_name)}>
                                            Preview
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </Stack>
                    {filteredFeatures.length === 0 ? (
                      <Alert
                        severity="info"
                        variant="outlined"
                        sx={{ mt: 2 }}
                        action={
                          <Stack direction="row" spacing={1}>
                            {marketFilters.eligible_only ? (
                              <Button size="small" onClick={() => setMarketFilters((p) => ({ ...p, eligible_only: false }))}>
                                Show all
                              </Button>
                            ) : null}
                            <Button size="small" onClick={() => setMarketFilters((p) => ({ ...p, q: '', category: '', risk: '', used_only: false, eligible_only: false }))}>
                              Clear filters
                            </Button>
                          </Stack>
                        }
                      >
                        No features match the current filters{eligibleFeatures.length ? `. ${formatInteger(eligibleFeatures.length)} features are available; try widening filters.` : '.'}
                      </Alert>
                    ) : null}
                  </Paper>
                </Grid>
              </Grid>

              <Drawer
                anchor="right"
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, p: 2 } }}
              >
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 900 }} noWrap>
                      Feature Preview
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      Distribution · nulls · correlations
                    </Typography>
                  </Box>
                  <Button variant="outlined" onClick={() => setPreviewOpen(false)}>Close</Button>
                </Stack>

                {!previewMeta ? (
                  <Alert severity="info" variant="outlined">Select a feature to preview.</Alert>
                ) : (
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{previewMeta.feature_name}</Typography>
                      <Typography variant="body2" color="text.secondary">{previewMeta.description}</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                        <Chip label={previewMeta.category} />
                        <Chip label={`Freshness: ${previewMeta.freshness}`} />
                        {previewMeta.used_in_current_model ? <Chip color="success" label="Used in model" /> : null}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button variant={(featureSelection.include || []).includes(previewMeta.feature_name) ? 'contained' : 'outlined'} onClick={() => toggleInclude(previewMeta.feature_name)} sx={{ bgcolor: (featureSelection.include || []).includes(previewMeta.feature_name) ? pwcColors.primary : undefined }}>
                          {(featureSelection.include || []).includes(previewMeta.feature_name) ? 'Selected' : 'Select'}
                        </Button>
                        <Button variant={(featureSelection.exclude || []).includes(previewMeta.feature_name) ? 'contained' : 'outlined'} color={(featureSelection.exclude || []).includes(previewMeta.feature_name) ? 'error' : 'inherit'} onClick={() => toggleExclude(previewMeta.feature_name)}>
                          {(featureSelection.exclude || []).includes(previewMeta.feature_name) ? 'Excluded' : 'Exclude'}
                        </Button>
                      </Stack>
                    </Box>

                    {previewLoading ? <LinearProgress /> : null}

                    <Card variant="outlined">
                      <CardHeader title="Summary" />
                      <CardContent>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip label={`Nulls: ${previewMeta.missing_pct != null ? formatPercentFromRatio(previewMeta.missing_pct, 1) : '-'}`} />
                          <Chip label={`Stability: ${previewMeta.stability != null ? formatProbability(previewMeta.stability, 2) : '-'}`} />
                          <Chip label={`Leakage: ${previewMeta.leakage_risk != null ? formatProbability(previewMeta.leakage_risk, 2) : '-'}`} />
                          <Chip label={`Correlation risk: ${previewMeta.correlation_risk === 'HIGH' ? 'High' : 'Not evaluated'}`} color={previewMeta.correlation_risk === 'HIGH' ? 'error' : 'default'} />
                        </Stack>
                      </CardContent>
                    </Card>

                    <Card variant="outlined">
                      <CardHeader title="Distribution" />
                      <CardContent>
                        {!previewDistribution?.success ? (
                          <Typography variant="body2" color="text.secondary">Distribution not available.</Typography>
                        ) : previewDistribution.mode === 'numeric' ? (
                          <>
                            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                              <Chip label={`Count: ${formatInteger(previewDistribution.stats?.count ?? 0)}`} />
                              <Chip label={`Nulls: ${formatInteger(previewDistribution.stats?.nulls ?? 0)}`} />
                              <Chip label={`Min: ${previewDistribution.stats?.min == null ? '-' : formatNumber(previewDistribution.stats.min, { maxFractionDigits: 3 })}`} />
                              <Chip label={`Max: ${previewDistribution.stats?.max == null ? '-' : formatNumber(previewDistribution.stats.max, { maxFractionDigits: 3 })}`} />
                              <Chip label={`Avg: ${previewDistribution.stats?.avg == null ? '-' : formatNumber(previewDistribution.stats.avg, { maxFractionDigits: 3 })}`} />
                            </Stack>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Range</TableCell>
                                  <TableCell align="right">Count</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(previewDistribution.bins || []).slice(0, 16).map((b) => (
                                  <TableRow key={b.bin}>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                      {formatNumber(b.start, { maxFractionDigits: 3 })} – {formatNumber(b.end, { maxFractionDigits: 3 })}
                                    </TableCell>
                                    <TableCell align="right">{formatInteger(b.count)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </>
                        ) : (
                          <>
                            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                              <Chip label={`Count: ${formatInteger(previewDistribution.stats?.count ?? 0)}`} />
                              <Chip label={`Nulls: ${formatInteger(previewDistribution.stats?.nulls ?? 0)}`} />
                              <Chip label={`Unique: ${formatInteger(previewDistribution.stats?.unique ?? 0)}`} />
                            </Stack>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Value</TableCell>
                                  <TableCell align="right">Count</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(previewDistribution.categories || []).slice(0, 16).map((c) => (
                                  <TableRow key={c.value}>
                                    <TableCell>{String(c.value)}</TableCell>
                                    <TableCell align="right">{formatInteger(c.count)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card variant="outlined">
                      <CardHeader title="Correlations" subheader="From latest training heatmap (if available)" />
                      <CardContent>
                        {previewCorrelations.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No correlation analysis available yet.</Typography>
                        ) : (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Feature</TableCell>
                                <TableCell align="right">Correlation</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {previewCorrelations.map((c) => (
                                <TableRow key={c.feature}>
                                  <TableCell>{c.feature}</TableCell>
                                  <TableCell align="right">{formatProbability(c.corr, 2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </Stack>
                )}
              </Drawer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Validation Strategy" subheader="Regulator-grade split definition and rationale" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Strategy</InputLabel>
                    <Select value={validation.type} label="Strategy" onChange={(e) => setValidation({ ...validation, type: e.target.value })}>
                      <MenuItem value="random">Train/Validation (Random)</MenuItem>
                      <MenuItem value="case">Case-level split</MenuItem>
                      <MenuItem value="time">Time-based with OOT</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="Test size" value={validation.test_size} onChange={(e) => setValidation({ ...validation, test_size: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="Random state" value={validation.random_state} onChange={(e) => setValidation({ ...validation, random_state: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="OOT days" value={validation.oot_days} onChange={(e) => setValidation({ ...validation, oot_days: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <Button variant="contained" onClick={runValidation} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>Run</Button>
                </Grid>
                {validationResult && (
                  <Grid item xs={12}>
                    <Alert severity="info">
                      <Typography variant="body2" fontWeight={700}>{validationResult.explanation}</Typography>
                      <Typography variant="body2">Train: {validationResult.sizes?.train_idx || 0} · Val: {validationResult.sizes?.val_idx || 0} · OOT: {validationResult.sizes?.oot_idx || 0}</Typography>
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Training & Tuning" subheader="Algorithm choice inside context, with audit trail" />
            <CardContent>
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', lg: 'row' }, alignItems: 'stretch' }}>
                <Box sx={{ width: { lg: '30%' }, minWidth: 0 }}>
                  <Card elevation={0} sx={{ height: '100%' }}>
                    <CardHeader
                      title="Configuration"
                      subheader="Set parameters without reading docs"
                      action={
                        <FormControlLabel
                          control={<Switch checked={expertMode} onChange={(e) => setExpertMode(e.target.checked)} />}
                          label={expertMode ? 'Expert' : 'Beginner'}
                        />
                      }
                    />
                    <CardContent>
                      <Stack spacing={2}>
                        <FormControl fullWidth>
                          <InputLabel>Algorithm</InputLabel>
                          <Select
                            value={training.model_type}
                            label="Algorithm"
                            onChange={(e) => {
                              const nextType = e.target.value;
                              setTraining((p) => ({ ...p, model_type: nextType, hyperparams: defaultHyperparams(nextType) }));
                            }}
                          >
                            <MenuItem value="xgboost">XGBoost</MenuItem>
                            <MenuItem value="lightgbm">LightGBM</MenuItem>
                            <MenuItem value="logistic">Logistic Regression</MenuItem>
                            <MenuItem value="randomforest">Random Forest</MenuItem>
                            <MenuItem value="isolation_forest">Isolation Forest</MenuItem>
                            <MenuItem value="kmeans">KMeans (Anomaly)</MenuItem>
                            <MenuItem value="dbscan">DBSCAN (Anomaly)</MenuItem>
                            <MenuItem value="pca_autoencoder">Autoencoder (PCA)</MenuItem>
                          </Select>
                        </FormControl>

                        <Grid container spacing={2}>
                          <Grid item xs={6}>
                            <TextField
                              label="CV folds"
                              value={training.cv_folds}
                              onChange={(e) => setTraining({ ...training, cv_folds: Number(e.target.value) })}
                              fullWidth
                            />
                          </Grid>
                          <Grid item xs={6}>
                            <TextField
                              label="Threshold"
                              value={training.threshold}
                              onChange={(e) => setTraining({ ...training, threshold: Number(e.target.value) })}
                              fullWidth
                            />
                          </Grid>
                        </Grid>

                        <Paper variant="outlined" sx={{ p: 1.25 }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                              Parameters
                            </Typography>
                            <Chip size="small" variant="outlined" label={expertMode ? 'Expert view' : 'Beginner view'} />
                          </Stack>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Value</TableCell>
                                <TableCell align="right">Info</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {visibleParams.map((p) => (
                                <TableRow key={p.key}>
                                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                                    {p.label}
                                  </TableCell>
                                  <TableCell>
                                    <TextField
                                      size="small"
                                      type={p.type === 'number' ? 'number' : 'text'}
                                      value={training.hyperparams?.[p.key] ?? ''}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const next = p.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
                                        setTraining((prev) => ({ ...prev, hyperparams: { ...(prev.hyperparams || {}), [p.key]: next } }));
                                      }}
                                      inputProps={p.type === 'number' ? { min: p.min, max: p.max, step: p.step } : undefined}
                                      fullWidth
                                    />
                                  </TableCell>
                                  <TableCell align="right">
                                    <ParamInfoButton param={p} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setTraining((prev) => ({ ...prev, hyperparams: defaultHyperparams(prev.model_type) }))}
                            >
                              Reset defaults
                            </Button>
                          </Stack>
                        </Paper>

                        <Button variant="contained" onClick={runTraining} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>
                          Train
                        </Button>
                        {loading && <LinearProgress />}
                      </Stack>
                    </CardContent>
                  </Card>
                </Box>

                <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                  <Card elevation={0} sx={{ height: '100%' }}>
                    <CardHeader title="Diagnostics" subheader="What happened during training" />
                    <CardContent>
                      {!trainingResult ? (
                        <Typography variant="body2" color="text.secondary">
                          Train a model to populate diagnostics (metrics, logs, feature selection, correlations).
                        </Typography>
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                            <Chip label={`Model: ${trainingResult.model_version}`} />
                            <Chip label={`AUC: ${Number(trainingResult.metrics?.roc_auc || 0).toFixed(3)}`} />
                            <Chip label={`Precision: ${Number(trainingResult.metrics?.precision || 0).toFixed(3)}`} />
                            <Chip label={`Recall: ${Number(trainingResult.metrics?.recall || 0).toFixed(3)}`} />
                            <Chip label={`F1: ${Number(trainingResult.metrics?.f1_score || 0).toFixed(3)}`} />
                            <Chip label={`Duration: ${trainingResult.duration_seconds || 0}s`} />
                          </Stack>

                          <Grid container spacing={2}>
                            <Grid item xs={12} md={6}>
                              <Card elevation={0}>
                                <CardHeader title="Training Steps" subheader="What ran, in what order" />
                                <CardContent>
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Step</TableCell>
                                        <TableCell>Message</TableCell>
                                        <TableCell align="right">Time</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(trainingResult.logs || []).map((l, idx) => (
                                        <TableRow key={idx}>
                                          <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{String(l.step || '')}</TableCell>
                                          <TableCell>{String(l.message || '')}</TableCell>
                                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{String(l.ts || '')}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </CardContent>
                              </Card>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Card elevation={0}>
                                <CardHeader title="Feature Selection" subheader="Selected vs removed" />
                                <CardContent>
                                  <Stack direction="row" spacing={1} flexWrap="wrap">
                                    <Chip label={`After filter: ${trainingResult.feature_selection_report?.selected_after_filter ?? '-'}`} />
                                    <Chip label={`After prepare: ${trainingResult.feature_selection_report?.selected_after_prepare ?? '-'}`} />
                                    <Chip label={`Dropped correlated: ${(trainingResult.feature_selection_report?.dropped_correlated || []).length}`} />
                                    {trainingResult.feature_selection_report?.correlation_threshold != null && (
                                      <Chip label={`Corr threshold: ${Number(trainingResult.feature_selection_report.correlation_threshold).toFixed(2)}`} />
                                    )}
                                  </Stack>
                                  {(trainingResult.feature_selection_report?.dropped_correlated || []).length > 0 && (
                                    <Box sx={{ mt: 1 }}>
                                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                        Dropped due to high correlation
                                      </Typography>
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                        {(trainingResult.feature_selection_report.dropped_correlated || []).slice(0, 24).map((f) => (
                                          <Chip key={f} label={f} size="small" />
                                        ))}
                                      </Box>
                                    </Box>
                                  )}
                                </CardContent>
                              </Card>
                            </Grid>
                            {trainingResult.correlation_heatmap && (
                              <Grid item xs={12}>
                                <Card elevation={0}>
                                  <CardHeader title="Correlation Heatmap" subheader="Up to 25 selected features" />
                                  <CardContent>
                                    <CorrelationHeatmap heatmap={trainingResult.correlation_heatmap} />
                                  </CardContent>
                                </Card>
                              </Grid>
                            )}
                          </Grid>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Box>

                <Box sx={{ width: { lg: '25%' }, minWidth: 0 }}>
                  <Card elevation={0} sx={{ height: '100%' }}>
                    <CardHeader title="Warnings & Recommendations" subheader="Overfitting risk, compute cost, and next steps" />
                    <CardContent>
                      <Stack spacing={1.5}>
                        {guidance.warnings.map((w) => (
                          <Alert key={w.title} severity="warning" variant="outlined">
                            <Typography variant="body2" fontWeight={800}>{w.title}</Typography>
                            <Typography variant="body2">{w.detail}</Typography>
                          </Alert>
                        ))}
                        {guidance.recommendations.map((r) => (
                          <Alert key={r.title} severity="info" variant="outlined">
                            <Typography variant="body2" fontWeight={800}>{r.title}</Typography>
                            <Typography variant="body2">{r.detail}</Typography>
                          </Alert>
                        ))}
                        {guidance.warnings.length === 0 && guidance.recommendations.length === 0 ? (
                          <Alert severity="success" variant="outlined">
                            <Typography variant="body2" fontWeight={800}>No immediate issues detected</Typography>
                            <Typography variant="body2">Train to generate diagnostics and confirm performance.</Typography>
                          </Alert>
                        ) : null}
                      </Stack>
                    </CardContent>
                  </Card>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Training Leaderboard" subheader="Best performing trained models (decision view)" />
            <CardContent>
              {leaderboard.rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Train at least one model to populate the leaderboard.</Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Champion', 'Model', 'Algo', 'AUC', 'Recall', 'Precision', 'F1', 'Trained'].map((h) => (
                          <TableCell key={h} sx={{ fontWeight: 900 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {leaderboard.rows.map((m) => {
                        const isChampion = String(m.model_version) === String(leaderboard.champion);
                        return (
                          <TableRow
                            key={m.model_version}
                            hover
                            onClick={() => {
                              setCompare((p) => ({ ...p, champion_model: m.model_version }));
                              setApproval((p) => ({ ...p, model_version: m.model_version }));
                            }}
                            sx={{ cursor: 'pointer', bgcolor: isChampion ? 'rgba(34,197,94,0.08)' : undefined }}
                          >
                            <TableCell>{isChampion ? '★' : ''}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 800 }}>{m.model_version}</TableCell>
                            <TableCell>{m.algorithm || '—'}</TableCell>
                            <TableCell>{Number.isFinite(m.auc) ? m.auc.toFixed(3) : '—'}</TableCell>
                            <TableCell>{Number.isFinite(m.recall) ? m.recall.toFixed(3) : '—'}</TableCell>
                            <TableCell>{Number.isFinite(m.precision) ? m.precision.toFixed(3) : '—'}</TableCell>
                            <TableCell>{Number.isFinite(m.f1) ? m.f1.toFixed(3) : '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{String(m.trained_at || '').slice(0, 19) || '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Performance & Tradeoffs" subheader="Suppression vs event loss, thresholds, confusion matrix, PR curve" />
            <CardContent>
              {!tradeoffs ? (
                <Typography variant="body2" color="text.secondary">Train a model to populate performance tradeoffs.</Typography>
              ) : (
                <>
                  {businessThreshold && (
                    <Box sx={{ p: 2, mb: 2, borderRadius: 1, border: '1px solid rgba(15,23,42,0.12)', bgcolor: 'rgba(15,23,42,0.02)' }}>
                      <Typography sx={{ fontWeight: 900, mb: 0.75 }}>Business impact at selected threshold</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        <Chip label={`Threshold: ${Number(businessThreshold.threshold).toFixed(2)}`} />
                        <Chip label={`Alerts: ${formatInteger(businessThreshold.alerts)}`} />
                        <Chip label={`Alerts ↓: ${formatPercentFromRatio(businessThreshold.suppressionPct || 0)}`} />
                        <Chip label={`Missed STR: ${formatInteger(businessThreshold.missed)}`} />
                        <Chip label={`Event loss: ${formatPercentFromRatio(businessThreshold.missedRate || 0)}`} />
                      </Stack>
                    </Box>
                  )}

                  <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Card elevation={0}>
                      <CardHeader title="Confusion Matrix" />
                      <CardContent>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell></TableCell>
                              <TableCell>Pred 0</TableCell>
                              <TableCell>Pred 1</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            <TableRow>
                              <TableCell>True 0</TableCell>
                              <TableCell>{tradeoffs.confusion_matrix?.[0]?.[0] ?? 0}</TableCell>
                              <TableCell>{tradeoffs.confusion_matrix?.[0]?.[1] ?? 0}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>True 1</TableCell>
                              <TableCell>{tradeoffs.confusion_matrix?.[1]?.[0] ?? 0}</TableCell>
                              <TableCell>{tradeoffs.confusion_matrix?.[1]?.[1] ?? 0}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <Card elevation={0}>
                      <CardHeader title="Precision–Recall Curve" />
                      <CardContent sx={{ height: 260 }}>
                        {prData.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">PR curve not available.</Typography>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={prData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="recall" />
                              <YAxis />
                              <ReTooltip />
                              <Legend />
                              <Line type="monotone" dataKey="precision" stroke={pwcColors.primary} dot={false} strokeWidth={2} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12}>
                    <Card elevation={0}>
                      <CardHeader title="Suppression vs Event Loss" />
                      <CardContent sx={{ height: 260 }}>
                        {suppressionData.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">Tradeoff curve not available.</Typography>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={suppressionData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="threshold" />
                              <YAxis />
                              <ReTooltip />
                              <Legend />
                              <Line type="monotone" dataKey="suppression" stroke="#0f172a" dot={false} strokeWidth={2} />
                              <Line type="monotone" dataKey="event_loss" stroke={pwcColors.errorText} dot={false} strokeWidth={2} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  </Grid>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Explainability" subheader="Global drivers and local account justification" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card elevation={0}>
                    <CardHeader title="Global Drivers" />
                    <CardContent>
                      {globalExplain.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">Train a model to populate global drivers.</Typography>
                      ) : (
                        <>
                          {globalNarrative && (
                            <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                              <Typography variant="body2" fontWeight={900}>Narrative</Typography>
                              <Typography variant="body2">{globalNarrative.sentence}</Typography>
                            </Alert>
                          )}
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Feature</TableCell>
                                <TableCell align="right">Importance</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {globalExplain.slice(0, 15).map((r) => (
                                <TableRow key={r.feature}>
                                  <TableCell>{r.feature}</TableCell>
                                  <TableCell align="right">{Number(r.importance || 0).toFixed(4)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card elevation={0}>
                    <CardHeader title="Local Justification" />
                    <CardContent>
                      <Stack spacing={2}>
                        <TextField label="Account ID" value={localExplainAccount} onChange={(e) => setLocalExplainAccount(e.target.value)} />
                        <Button variant="outlined" onClick={runLocalExplain} disabled={loading}>Explain Account</Button>
                        {localExplain?.success && (
                          <Box>
                            {localNarrative && (
                              <Box sx={{ p: 1.5, borderRadius: 1, border: '1px solid rgba(15,23,42,0.12)', bgcolor: 'rgba(15,23,42,0.02)', mb: 2 }}>
                                <Typography sx={{ fontWeight: 900 }}>{localNarrative.meaning}</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{localNarrative.headline}</Typography>
                                <Box sx={{ mt: 1 }}>
                                  {localNarrative.bullets.map((b) => (
                                    <Typography key={b} variant="body2">+ {b}</Typography>
                                  ))}
                                </Box>
                              </Box>
                            )}

                            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                              <Chip label={`Score: ${Number(localExplain.score || 0).toFixed(4)}`} />
                              <Chip label={`Method: ${String(localExplain.method || '').toUpperCase()}`} />
                              {(localExplain.mule_types || []).slice(0, 3).map((t) => (
                                <Chip key={t} label={`Type: ${String(t).replaceAll('_', ' ')}`} />
                              ))}
                            </Stack>
                            <Table size="small" sx={{ mt: 2 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Feature</TableCell>
                                  <TableCell align="right">Value</TableCell>
                                  <TableCell align="right">{localExplain.method === 'shap' ? 'SHAP' : 'Importance'}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(localExplain.local || []).slice(0, 12).map((r) => (
                                  <TableRow key={r.feature}>
                                    <TableCell>{r.feature}</TableCell>
                                    <TableCell align="right">{Number(r.value || 0).toFixed(4)}</TableCell>
                                    <TableCell align="right">{Number((localExplain.method === 'shap' ? r.shap : r.importance) || 0).toFixed(4)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Bias & Stability" subheader="Automatic checks by geography and segments" />
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Button variant="outlined" onClick={runBias} disabled={loading}>Run Bias Checks</Button>
                {biasResult?.has_results && <Chip label={`Groups: ${(biasResult.groups || []).length}`} />}
              </Stack>
              {biasResult?.has_results && (
                <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, maxHeight: 520 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Dimension</TableCell>
                        <TableCell>Group</TableCell>
                        <TableCell align="right">Count</TableCell>
                        <TableCell>Confusion Matrix</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(biasResult.groups || []).slice(0, 50).map((g, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{g.dimension}</TableCell>
                          <TableCell>{g.group}</TableCell>
                          <TableCell align="right">{g.count}</TableCell>
                          <TableCell>
                            <Table size="small" sx={{ minWidth: 160 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell></TableCell>
                                  <TableCell align="right">Pred 0</TableCell>
                                  <TableCell align="right">Pred 1</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                <TableRow>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>True 0</TableCell>
                                  <TableCell align="right">{g.confusion_matrix?.[0]?.[0] ?? 0}</TableCell>
                                  <TableCell align="right">{g.confusion_matrix?.[0]?.[1] ?? 0}</TableCell>
                                </TableRow>
                                <TableRow>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>True 1</TableCell>
                                  <TableCell align="right">{g.confusion_matrix?.[1]?.[0] ?? 0}</TableCell>
                                  <TableCell align="right">{g.confusion_matrix?.[1]?.[1] ?? 0}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Challenger / Champion Comparison" subheader="Compare two models on the same population" />
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Champion</InputLabel>
                    <Select value={compare.champion_model} label="Champion" onChange={(e) => setCompare({ ...compare, champion_model: e.target.value })}>
                      {dropdownModels.map((m) => <MenuItem key={`c-${m.model_version}`} value={m.model_version}>{m.model_version}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Challenger</InputLabel>
                    <Select value={compare.challenger_model} label="Challenger" onChange={(e) => setCompare({ ...compare, challenger_model: e.target.value })}>
                      {dropdownModels.map((m) => <MenuItem key={`d-${m.model_version}`} value={m.model_version}>{m.model_version}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="Threshold" value={compare.threshold} onChange={(e) => setCompare({ ...compare, threshold: Number(e.target.value) })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <Button variant="contained" onClick={runCompare} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>Compare</Button>
                </Grid>
              </Grid>
              {compareResult?.success && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Champion" subheader={compareResult.champion.model_version} />
                      <CardContent>
                        <Typography variant="body2">Mean score: {Number(compareResult.champion.mean_score || 0).toFixed(4)}</Typography>
                        <Table size="small" sx={{ mt: 1, maxWidth: 360 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell></TableCell>
                              <TableCell align="right">Pred 0</TableCell>
                              <TableCell align="right">Pred 1</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>True 0</TableCell>
                              <TableCell align="right">{compareResult.champion.confusion_matrix?.[0]?.[0] ?? 0}</TableCell>
                              <TableCell align="right">{compareResult.champion.confusion_matrix?.[0]?.[1] ?? 0}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>True 1</TableCell>
                              <TableCell align="right">{compareResult.champion.confusion_matrix?.[1]?.[0] ?? 0}</TableCell>
                              <TableCell align="right">{compareResult.champion.confusion_matrix?.[1]?.[1] ?? 0}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card elevation={0}>
                      <CardHeader title="Challenger" subheader={compareResult.challenger.model_version} />
                      <CardContent>
                        <Typography variant="body2">Mean score: {Number(compareResult.challenger.mean_score || 0).toFixed(4)}</Typography>
                        <Table size="small" sx={{ mt: 1, maxWidth: 360 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell></TableCell>
                              <TableCell align="right">Pred 0</TableCell>
                              <TableCell align="right">Pred 1</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            <TableRow>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>True 0</TableCell>
                              <TableCell align="right">{compareResult.challenger.confusion_matrix?.[0]?.[0] ?? 0}</TableCell>
                              <TableCell align="right">{compareResult.challenger.confusion_matrix?.[0]?.[1] ?? 0}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>True 1</TableCell>
                              <TableCell align="right">{compareResult.challenger.confusion_matrix?.[1]?.[0] ?? 0}</TableCell>
                              <TableCell align="right">{compareResult.challenger.confusion_matrix?.[1]?.[1] ?? 0}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card elevation={0}>
            <CardHeader title="Approval Workflow & Registry" subheader="Reviewer decision and long-lived audit trail" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Model version</InputLabel>
                    <Select value={approval.model_version} label="Model version" onChange={(e) => setApproval({ ...approval, model_version: e.target.value })}>
                      {dropdownModels.map((m) => <MenuItem key={`m-${m.model_version}`} value={m.model_version}>{m.model_version}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="Reviewer" value={approval.reviewer} onChange={(e) => setApproval({ ...approval, reviewer: e.target.value })} fullWidth />
                </Grid>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel>Decision</InputLabel>
                    <Select value={approval.decision} label="Decision" onChange={(e) => setApproval({ ...approval, decision: e.target.value })}>
                      <MenuItem value="approve">Approve</MenuItem>
                      <MenuItem value="reject">Reject</MenuItem>
                      <MenuItem value="needs_review">Needs Review</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField label="Valid until" value={approval.valid_until} onChange={(e) => setApproval({ ...approval, valid_until: e.target.value })} fullWidth />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField label="Comments" value={approval.comments} onChange={(e) => setApproval({ ...approval, comments: e.target.value })} fullWidth />
                </Grid>
                <Grid item xs={12}>
                  <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                    <Button variant="contained" onClick={submitApproval} disabled={loading} sx={{ bgcolor: pwcColors.primary }}>Submit Decision</Button>
                    <Button variant="outlined" onClick={() => setApproval({ ...approval, activate: !approval.activate })}>
                      {approval.activate ? 'Will Activate on Submit' : 'Do Not Activate'}
                    </Button>
                    {approvalResult?.success && <Chip label={`Approval: ${approvalResult.approval_id}`} />}
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={autoPickOpen} onClose={() => setAutoPickOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Auto Pick Optimal Set</DialogTitle>
        <DialogContent dividers>
          {!autoPickReport ? (
            <Typography variant="body2" color="text.secondary">No selection report available.</Typography>
          ) : (
            <Stack spacing={2}>
              <Box sx={{ p: 1.5, borderRadius: 1, border: '1px solid rgba(15,23,42,0.12)', bgcolor: autoPickReport.supervised ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.10)' }}>
                <Typography sx={{ fontWeight: 900 }}>
                  {autoPickReport.supervised ? 'SUPERVISED SELECTION STRATEGY' : 'BEHAVIORAL SELECTION STRATEGY'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {autoPickReport.supervised
                    ? 'Optimizes for clean, stable signals and predictive strength while protecting typology coverage.'
                    : 'Optimizes for stable, high-contrast behavioral signals while protecting typology coverage.'}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label={`Available: ${formatInteger(autoPickReport.total_available)}`} />
                <Chip label={`Ineligible: ${formatInteger(autoPickReport.ineligible)}`} />
                <Chip label={`Excluded (manual): ${formatInteger(autoPickReport.excluded_by_user)}`} />
                <Chip label={`Candidates: ${formatInteger(autoPickReport.candidates)}`} />
                <Chip label={`Picked: ${formatInteger(autoPickReport.picked)} / ${formatInteger(autoPickReport.max_features)}`} />
                <Chip label={`Typology covered: ${formatInteger(autoPickReport.typology_covered)}`} />
              </Stack>

              <Box>
                <Typography sx={{ fontWeight: 900, mb: 0.75 }}>Selection checks</Typography>
                <Stack spacing={1}>
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      Remove leakage
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {autoPickReport.rules.remove_leakage ? 'ENFORCED' : 'WARN ONLY'} · threshold {Number(autoPickReport.rules.leakage_threshold).toFixed(2)} · flagged {formatInteger(autoPickReport.leakage_flagged)}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      Remove unstable features
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {autoPickReport.rules.remove_unstable ? 'ENFORCED' : 'WARN ONLY'} · stability threshold {Number(autoPickReport.rules.stability_threshold).toFixed(2)} · flagged {formatInteger(autoPickReport.unstable_flagged)}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      Reduce redundancy
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Penalize known correlation risk · target correlation threshold {Number(autoPickReport.rules.correlation_threshold).toFixed(2)} · flagged {formatInteger(autoPickReport.correlation_flagged)}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      Preserve typology diversity
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Seed from top feature per typology first, then fill by score (importance + IV/rarity adjustments).
                    </Typography>
                  </Paper>
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutoPickOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModelLabScreen;
