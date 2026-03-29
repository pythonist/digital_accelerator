import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';

import { T, buttonStyle, cardStyle } from './theme';
import WizardSidebar from './WizardSidebar';
import StepShell from './StepShell';
import StepBaseTable from './StepBaseTable';
import StepSelectTables from './StepSelectTables';
import StepTransactionRollup from './StepTransactionRollup';
import StepAggregationExplain from './StepAggregationExplain';
import StepTransforms from './StepTransforms';
import StepLabelConfig from './StepLabelConfig';
import StepPreviewBuild from './StepPreviewBuild';
import MasterDatasetWorkbench from './MasterDatasetWorkbench';
import {
  safe,
  fmt,
  inferAnchorType,
  findDatasetByType,
  sharedKeys,
  stageRowImpact,
  makeJoinId,
  buildDefaultTransforms,
  mapTransformsForPreview,
  joinWouldFanOut,
  isEventTable,
} from './utils';

const STEP_DEFS = [
  { id: 'base', title: 'Choose Base Table', subtitle: 'Pick the anchor table for one row per alert.' },
  { id: 'tables', title: 'Select Tables to Join', subtitle: 'Choose which uploaded tables should enrich alerts.' },
  { id: 'rollup', title: 'Transaction Rollup', subtitle: 'Summarize event rows before joining to avoid fan-out.' },
  { id: 'aggregation', title: 'Aggregation View', subtitle: 'See transaction before/after squeeze and added columns.' },
  { id: 'transforms', title: 'Cleaning and Transforms', subtitle: 'Apply sparse-column and deduplicate rules.' },
  { id: 'labels', title: 'Label Configuration', subtitle: 'Define str_label from STR and case outcomes.' },
  { id: 'preview', title: 'Preview and Build', subtitle: 'Review final shape and run master dataset build.' },
];

const GRAIN_BY_TABLE = {
  alerts: 'alert',
  alert: 'alert',
  transactions: 'transaction',
  transaction: 'transaction',
  txns: 'transaction',
  txn: 'transaction',
  accounts: 'account',
  account: 'account',
  customers: 'customer',
  customer: 'customer',
  cases: 'case',
  case: 'case',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dedupe = (arr) => Array.from(new Set(arr));

const estimateFallbackMatchRate = (leftType, rightType, key, anchorType) => {
  const left = safe(leftType);
  const right = safe(rightType);
  const anchor = safe(anchorType);
  const other = left === anchor ? right : right === anchor ? left : '';

  const byType = {
    accounts: 0.9,
    account: 0.9,
    customers: 0.82,
    customer: 0.82,
    transactions: 0.88,
    transaction: 0.88,
    txns: 0.88,
    txn: 0.88,
    cases: 0.15,
    case: 0.15,
    str: 0.07,
    sar: 0.07,
  };

  const k = safe(key);
  if (byType[other] != null) return byType[other];
  if (k.includes('account')) return 0.85;
  if (k.includes('customer')) return 0.75;
  if (k.includes('case')) return 0.2;
  if (k.includes('str') || k.includes('sar')) return 0.08;
  return 0.6;
};

const MasterDatasetWizardContainer = ({
  persona,
  datasets,
  masterDataset,
  onBuildComplete,
  onStepAdvance,
  onStepBack,
  activePipelineId = null,
  onPipelineActivated,
  initialCurrentStepId = 'base',
  onCurrentStepChange,
}) => {
  const [grain, setGrain] = useState('alert');
  const [anchorType, setAnchorType] = useState('');
  const [joins, setJoins] = useState([]);
  const [enabledTables, setEnabledTables] = useState(new Set());
  const [rollupConfirmed, setRollupConfirmed] = useState(false);
  const [outputName, setOutputName] = useState('master_dataset');
  const [transforms, setTransforms] = useState(buildDefaultTransforms);
  const [strMode, setStrMode] = useState('detect');
  const [replacementLabelColumn, setReplacementLabelColumn] = useState('');

  const [loadingGraph, setLoadingGraph] = useState(false);
  const [joinProfileEstimated, setJoinProfileEstimated] = useState(false);
  const [building, setBuilding] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [error, setError] = useState(null);
  const [buildLog, setBuildLog] = useState([]);

  const [profileSummary, setProfileSummary] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [aggregationByTable, setAggregationByTable] = useState({});
  const [aggregationLoading, setAggregationLoading] = useState(false);

  const [currentStepId, setCurrentStepId] = useState(initialCurrentStepId || 'base');
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1600);
  const [buildReadyForContinue, setBuildReadyForContinue] = useState(Boolean(masterDataset?.dataset_id));
  const [builtConfigFingerprint, setBuiltConfigFingerprint] = useState('');
  const rootRef = useRef(null);

  const datasetTypeOptions = useMemo(
    () => datasets.map((d) => d.dataset_type).filter(Boolean),
    [datasets],
  );

  useEffect(() => {
    const next = String(initialCurrentStepId || 'base').trim().toLowerCase();
    if (!next) return;
    setCurrentStepId((prev) => (prev === next ? prev : next));
  }, [initialCurrentStepId]);

  useEffect(() => {
    onCurrentStepChange?.(currentStepId);
  }, [currentStepId, onCurrentStepChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const el = rootRef.current;
    if (!el) return undefined;

    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width || window.innerWidth || 1600);
      setContainerWidth((prev) => (prev === next ? prev : next));
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const anchorDataset = useMemo(
    () => findDatasetByType(datasets, anchorType),
    [datasets, anchorType],
  );

  useEffect(() => {
    if (!datasets.length) {
      setAnchorType('');
      return;
    }
    setAnchorType((prev) => {
      if (prev && datasets.some((d) => safe(d.dataset_type) === safe(prev))) return prev;
      return inferAnchorType(grain, datasets);
    });
  }, [datasets, grain]);

  useEffect(() => {
    const anchor = safe(anchorType);
    const available = dedupe(datasets.map((d) => safe(d.dataset_type)).filter(Boolean));
    const defaultEnabled = new Set(available.filter((t) => t !== anchor));
    setEnabledTables((prev) => {
      if (!prev.size) return defaultEnabled;
      const kept = Array.from(prev).filter((t) => defaultEnabled.has(t));
      return kept.length ? new Set(kept) : defaultEnabled;
    });
  }, [datasets, anchorType]);

  const normalizeServerJoins = useCallback((relationships = []) => {
    const rows = [];
    relationships.forEach((r, idx) => {
      const left = r.left;
      const right = r.right;
      const leftDs = findDatasetByType(datasets, left);
      const rightDs = findDatasetByType(datasets, right);
      if (!leftDs || !rightDs) return;
      const keyOptions = sharedKeys(leftDs, rightDs);
      const selectedKey = keyOptions.includes(safe(r.key)) ? safe(r.key) : keyOptions[0] || safe(r.key);
      rows.push({
        id: makeJoinId(left, right, selectedKey, `__${idx}`),
        left,
        right,
        key: selectedKey,
        key_options: keyOptions,
        join_type: 'left',
        matched_rows: Number(r.matched_rows || 0),
        enabled: true,
      });
    });
    return rows;
  }, [datasets]);

  const fallbackJoins = useMemo(() => {
    const anchorRows = Number(anchorDataset?.row_count || 0);
    const rows = [];
    datasets.forEach((left, i) => {
      datasets.slice(i + 1).forEach((right, j) => {
        const keyOptions = sharedKeys(left, right);
        if (!keyOptions.length) return;
        const key = keyOptions[0];
        const rate = estimateFallbackMatchRate(left.dataset_type, right.dataset_type, key, anchorType);
        const leftRows = Number(left.row_count || 0);
        const rightRows = Number(right.row_count || 0);
        const anchorInPair = safe(left.dataset_type) === safe(anchorType) || safe(right.dataset_type) === safe(anchorType);
        const baseRows = anchorInPair && anchorRows > 0 ? anchorRows : Math.min(leftRows, rightRows);
        rows.push({
          id: makeJoinId(left.dataset_type, right.dataset_type, key, `__fallback_${i}_${j}`),
          left: left.dataset_type,
          right: right.dataset_type,
          key,
          key_options: keyOptions,
          join_type: 'left',
          matched_rows: Math.round(baseRows * rate),
          enabled: true,
        });
      });
    });
    return rows;
  }, [datasets, anchorType, anchorDataset?.row_count]);

  const fetchJoinGraph = useCallback(async () => {
    if (datasets.length < 2) {
      setJoins([]);
      return;
    }
    setLoadingGraph(true);
    setError(null);
    try {
      const res = await mlopsApi.joinGraph({
        dataset_ids: datasets.map((d) => d.dataset_id),
        sample_rows: 10000,
      });
      const payload = res?.data || res;
      const rel = payload?.relationships || payload?.data?.relationships || [];
      const normalized = normalizeServerJoins(rel);
      if (normalized.length) {
        setJoins(normalized);
        setJoinProfileEstimated(false);
      } else {
        setJoins(fallbackJoins);
        setJoinProfileEstimated(true);
      }
    } catch (e) {
      setJoins(fallbackJoins);
      setJoinProfileEstimated(true);
    } finally {
      setLoadingGraph(false);
    }
  }, [datasets, normalizeServerJoins, fallbackJoins]);

  useEffect(() => {
    fetchJoinGraph();
  }, [fetchJoinGraph]);

  useEffect(() => {
    if (!anchorDataset?.dataset_id) {
      setProfileSummary(null);
      return;
    }
    let alive = true;
    setProfileLoading(true);
    mlopsApi.profileMetadata({
      dataset_id: anchorDataset.dataset_id,
      sample_rows: 8000,
    })
      .then((res) => {
        if (!alive) return;
        const payload = res?.data || res;
        setProfileSummary(payload || null);
      })
      .catch(() => {
        if (!alive) return;
        setProfileSummary(null);
      })
      .finally(() => {
        if (alive) setProfileLoading(false);
      });
    return () => { alive = false; };
  }, [anchorDataset?.dataset_id]);

  const enabledTypeSet = useMemo(() => {
    const next = new Set(Array.from(enabledTables));
    if (anchorType) next.add(safe(anchorType));
    return next;
  }, [enabledTables, anchorType]);

  const transactionsSelected = useMemo(
    () => Array.from(enabledTables).some((t) => ['transactions', 'transaction', 'txns', 'txn'].includes(safe(t))),
    [enabledTables],
  );

  const activeJoins = useMemo(() => {
    let list = joins.filter((j) => {
      const left = safe(j.left);
      const right = safe(j.right);
      return j.enabled !== false && enabledTypeSet.has(left) && enabledTypeSet.has(right);
    });
    if (strMode === 'unlink') {
      list = list.filter((j) => !['str', 'sar'].includes(safe(j.left)) && !['str', 'sar'].includes(safe(j.right)));
    }
    return list;
  }, [joins, enabledTypeSet, strMode]);

  const rowImpact = useMemo(
    () => stageRowImpact(activeJoins, anchorType, datasets),
    [activeJoins, anchorType, datasets],
  );

  const hasFanOutJoins = useMemo(
    () => activeJoins.some((j) => joinWouldFanOut(j, datasets)),
    [activeJoins, datasets],
  );

  const selectedJoinKeys = useMemo(
    () => activeJoins
      .map((j) => ({
        left: j.left,
        right: j.right,
        key: j.key,
        join_type: j.join_type || 'left',
        enabled: true,
      }))
      .filter((j) => j.left && j.right && j.key),
    [activeJoins],
  );

  const masterPipelineState = useMemo(() => ({
    grain,
    anchorType,
    outputName,
    builtMasterDatasetId: Number(masterDataset?.dataset_id || 0) || null,
    outputDatasetId: Number(masterDataset?.dataset_id || 0) || null,
    joins,
    enabledTables: Array.from(enabledTables),
    rollupConfirmed,
    transforms,
    strMode,
    replacementLabelColumn,
    dataset_ids: datasets.map((d) => d.dataset_id),
    currentStepId,
    status: buildReadyForContinue ? 'completed' : 'draft',
  }), [
    grain,
    anchorType,
    outputName,
    masterDataset?.dataset_id,
    joins,
    enabledTables,
    rollupConfirmed,
    transforms,
    strMode,
    replacementLabelColumn,
    datasets,
    currentStepId,
    buildReadyForContinue,
  ]);

  const buildFingerprint = useMemo(() => JSON.stringify({
    anchorType,
    enabledTables: Array.from(enabledTables).sort(),
    selectedJoinKeys,
    outputName,
    transforms,
    strMode,
    replacementLabelColumn,
  }), [anchorType, enabledTables, selectedJoinKeys, outputName, transforms, strMode, replacementLabelColumn]);

  const replacementOptions = useMemo(() => {
    const anchor = findDatasetByType(datasets, anchorType);
    return (Array.isArray(anchor?.columns) ? anchor.columns : []).slice(0, 300);
  }, [datasets, anchorType]);

  const strDataset = useMemo(
    () => findDatasetByType(datasets, 'str') || findDatasetByType(datasets, 'sar'),
    [datasets],
  );

  const caseDataset = useMemo(
    () => findDatasetByType(datasets, 'cases') || findDatasetByType(datasets, 'case'),
    [datasets],
  );

  const labelSurvivalRate = useMemo(() => {
    const anchorRows = Number(rowImpact.anchorRows || 0);
    if (!anchorRows) return 0.18;

    const labelledFromPreview = Number(previewData?.label_summary?.n_labelled || 0);
    if (labelledFromPreview > 0) {
      return clamp(labelledFromPreview / anchorRows, 0.05, 0.95);
    }

    const strJoin = activeJoins.find((j) => ['str', 'sar'].includes(safe(j.left)) || ['str', 'sar'].includes(safe(j.right)));
    const caseJoin = activeJoins.find((j) => ['cases', 'case'].includes(safe(j.left)) || ['cases', 'case'].includes(safe(j.right)));

    const strCoverage = strMode === 'unlink'
      ? 0
      : strJoin
      ? Number(strJoin.matched_rows || 0) / anchorRows
      : Number(strDataset?.row_count || 0) / anchorRows;

    const caseCoverage = caseJoin
      ? Number(caseJoin.matched_rows || 0) / anchorRows
      : Number(caseDataset?.row_count || 0) / anchorRows;

    const caseClosureCoverage = caseCoverage * 0.8;
    const estimated = strCoverage + caseClosureCoverage;
    return clamp(estimated || 0.18, 0.05, 0.6);
  }, [rowImpact.anchorRows, previewData?.label_summary?.n_labelled, activeJoins, strDataset?.row_count, caseDataset?.row_count, strMode]);

  const transformRetention = useMemo(() => {
    const hasDedup = transforms.some((t) => safe(t.type) === 'deduplicate');
    return hasDedup ? 0.99 : 1;
  }, [transforms]);

  const estimatedOutputRows = useMemo(() => {
    const backendRows = Number(previewData?.row_count || 0);
    if (backendRows > 0) return backendRows;

    const baseRows = hasFanOutJoins ? Number(rowImpact.anchorRows || 0) : Number(rowImpact.finalRows || 0);
    const afterTransforms = Math.round(baseRows * transformRetention);
    return Math.max(0, Math.round(afterTransforms * labelSurvivalRate));
  }, [previewData?.row_count, hasFanOutJoins, rowImpact.anchorRows, rowImpact.finalRows, transformRetention, labelSurvivalRate]);

  const tableCards = useMemo(() => {
    const anchorRows = Number(rowImpact.anchorRows || 0);
    const anchorKey = safe(anchorType);
    return datasets
      .filter((d) => safe(d.dataset_type) !== anchorKey)
      .map((d) => {
        const typeKey = safe(d.dataset_type);
        const candidateJoins = joins.filter((j) => safe(j.left) === typeKey || safe(j.right) === typeKey);
        const direct = candidateJoins.find((j) => safe(j.left) === anchorKey || safe(j.right) === anchorKey);
        const best = direct || candidateJoins[0] || null;
        const matchedRows = Number(best?.matched_rows || 0);
        const matchRate = anchorRows > 0 ? (matchedRows / anchorRows) * 100 : null;
        const shortName = String(d.dataset_type || 'table').toLowerCase().replace(/s$/, '');
        return {
          type: d.dataset_type,
          rows: Number(d.row_count || 0),
          key: best?.key || 'not_profiled',
          matchRate,
          explainer: matchRate != null
            ? `${clamp(matchRate, 0, 100).toFixed(0)}% of alerts have a matching ${shortName}.`
            : `Coverage not profiled yet for ${d.dataset_type}.`,
        };
      });
  }, [datasets, joins, anchorType, rowImpact.anchorRows]);

  const rollupTables = useMemo(() => {
    const selectedEventTypes = dedupe(Array.from(enabledTables).filter((t) => isEventTable(t)));
    const rows = [];
    selectedEventTypes.forEach((eventType) => {
      const eventDs = findDatasetByType(datasets, eventType);
      const eventRows = Number(eventDs?.row_count || 0);
      const relatedJoin = activeJoins.find((j) => safe(j.left) === eventType || safe(j.right) === eventType);
      const key = relatedJoin?.key || 'account_id';
      const summarySideType = relatedJoin
        ? safe(relatedJoin.left) === eventType ? relatedJoin.right : relatedJoin.left
        : 'accounts';
      const summaryDs = findDatasetByType(datasets, summarySideType) || findDatasetByType(datasets, 'accounts');
      rows.push({
        eventTable: eventDs?.dataset_type || eventType,
        sourceRows: eventRows,
        summaryRows: Number(summaryDs?.row_count || rowImpact.anchorRows || 0),
        key,
      });
    });
    return rows;
  }, [enabledTables, datasets, activeJoins, rowImpact.anchorRows]);

  const refreshAggregationPreview = useCallback(async () => {
    if (!rollupTables.length) {
      setAggregationByTable({});
      return;
    }

    setAggregationLoading(true);
    try {
      const pairs = await Promise.all(
        rollupTables.map(async (rollup) => {
          const ds = findDatasetByType(datasets, rollup.eventTable);
          if (!ds?.dataset_id) return null;
          const res = await mlopsApi.datasetRows(ds.dataset_id, {
            sample_rows: 18,
            aggregate: 'true',
            aggregate_by: rollup.key || 'account_id',
          });
          const payload = res?.data || res;
          const data = payload?.data || payload;
          return [safe(rollup.eventTable), data];
        }),
      );

      const next = {};
      pairs.forEach((entry) => {
        if (!entry) return;
        const [key, data] = entry;
        if (!key || !data) return;
        next[key] = data;
      });
      setAggregationByTable(next);
    } catch (e) {
      setAggregationByTable({});
    } finally {
      setAggregationLoading(false);
    }
  }, [rollupTables, datasets]);

  const tableSchemas = useMemo(() => (
    datasets.map((d) => ({
      type: d.dataset_type,
      rows: Number(d.row_count || 0),
      columns: Array.isArray(d.columns) ? d.columns : [],
    }))
  ), [datasets]);

  const labelStats = useMemo(() => {
    const pos = Number(previewData?.label_summary?.n_positive || 0);
    const neg = Number(previewData?.label_summary?.n_negative || 0);
    if (pos > 0 || neg > 0) return { positive: pos, negative: neg };
    const total = Math.max(0, Number(estimatedOutputRows || 0));
    const positive = Math.round(total * 0.384);
    return { positive, negative: Math.max(0, total - positive) };
  }, [previewData?.label_summary?.n_positive, previewData?.label_summary?.n_negative, estimatedOutputRows]);

  const refreshPreview = useCallback(async () => {
    const anchor = findDatasetByType(datasets, anchorType);
    if (!anchor?.dataset_id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const preprocessRes = await mlopsApi.preprocessPreview({
        dataset_id: anchor.dataset_id,
        steps: mapTransformsForPreview(transforms),
        sample_rows: 120,
      });

      let basePreview = preprocessRes?.data || preprocessRes;
      if (basePreview?.data) basePreview = basePreview.data;

      let masterPreview = null;
      try {
        const masterRes = await mlopsApi.masterPreview({
          dataset_ids: datasets.map((d) => d.dataset_id),
          base_dataset_type: anchorType,
          join_keys: selectedJoinKeys,
          str_policy: strMode,
          replacement_label_column: replacementLabelColumn || null,
          master_mode: 'notebook',
          preview_rows: 40,
        });
        masterPreview = masterRes?.data || masterRes;
        if (masterPreview?.data) masterPreview = masterPreview.data;
      } catch (e) {
        masterPreview = null;
      }

      if (masterPreview?.preview) {
        setPreviewData({
          source: 'master-preview',
          columns: masterPreview.columns || [],
          rows: masterPreview.preview || [],
          row_count: masterPreview.rows,
          impact: masterPreview.impact || [],
          aggregated_joins: masterPreview.aggregated_joins || [],
          label_summary: masterPreview.label_summary || null,
          target_candidates: masterPreview.target_candidates || [],
        });
      } else {
        setPreviewData({
          source: 'preprocess-preview',
          columns: basePreview?.columns || [],
          rows: basePreview?.preview || [],
          row_count: basePreview?.row_count,
          impact: [],
          aggregated_joins: [],
          label_summary: null,
          target_candidates: [],
        });
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to refresh preview';
      setPreviewError(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [datasets, anchorType, transforms, selectedJoinKeys, strMode, replacementLabelColumn]);

  useEffect(() => {
    if (!datasets.length || !anchorType) return;
    const timer = setTimeout(() => {
      refreshPreview();
    }, 350);
    return () => clearTimeout(timer);
  }, [datasets.length, anchorType, selectedJoinKeys, transforms, strMode, replacementLabelColumn, refreshPreview]);

  useEffect(() => {
    if (!transactionsSelected || !rollupTables.length) {
      setAggregationByTable({});
      return;
    }
    if (currentStepId !== 'rollup' && currentStepId !== 'aggregation') return;
    refreshAggregationPreview();
  }, [transactionsSelected, rollupTables, currentStepId, refreshAggregationPreview]);

  const handleBuild = useCallback(async () => {
    if (!datasets.length) return;
    setBuilding(true);
    setError(null);
    setBuildReadyForContinue(false);
    setBuildLog([
      'Validating join plan',
      `Anchor grain: ${grain}`,
      `Selected joins: ${selectedJoinKeys.length}`,
      `STR policy: ${strMode}${strMode === 'replace' && replacementLabelColumn ? ` -> ${replacementLabelColumn}` : ''}`,
      'Submitting build request',
    ]);

    try {
      const res = await mlopsApi.preprocessMasterBuild({
        dataset_ids: datasets.map((d) => d.dataset_id),
        output_name: outputName,
        join_keys: selectedJoinKeys,
        base_dataset_type: anchorType,
        str_policy: strMode,
        replacement_label_column: replacementLabelColumn || null,
        master_mode: 'notebook',
        transform_steps: transforms,
      });
      const data = res?.data || res;
      const built = data?.dataset || data;
      const builtDatasetId = Number(built?.dataset_id || 0) || null;
      const nextMasterState = {
        ...masterPipelineState,
        builtMasterDatasetId: builtDatasetId,
        outputDatasetId: builtDatasetId,
        currentStepId: 'preview',
        status: 'completed',
      };
      if (built?.dataset_id) {
        setBuildLog((prev) => [...prev, `Build completed: ${built.dataset_type}`]);
        setBuiltConfigFingerprint(buildFingerprint);
        setBuildReadyForContinue(true);
      } else {
        setBuildLog((prev) => [...prev, 'Build completed']);
      }
      await onBuildComplete?.(built);
      const pipelineId = Number(activePipelineId || 0);
      if (pipelineId > 0) {
        try {
          const saved = await mlopsApi.pipelineSaveScreenState(pipelineId, {
            screen: 'master',
            state: nextMasterState,
          });
          const payload = saved?.data || saved;
          if (payload?.pipeline_id) {
            onPipelineActivated?.(payload);
          }
        } catch (screenStateError) {
          const saveMsg = screenStateError?.message || 'Master build saved, but progress refresh did not complete.';
          setBuildLog((prev) => [...prev, `Pipeline state warning: ${saveMsg}`]);
        }
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Master dataset build failed';
      setError(msg);
      setBuildLog((prev) => [...prev, `Build failed: ${msg}`]);
    } finally {
      setBuilding(false);
    }
  }, [datasets, outputName, selectedJoinKeys, onBuildComplete, grain, strMode, replacementLabelColumn, anchorType, transforms, activePipelineId, buildFingerprint, masterPipelineState, onPipelineActivated]);

  const updateTransform = useCallback((id, patch) => {
    setTransforms((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const removeTransform = useCallback((id) => {
    setTransforms((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addTransform = useCallback((type) => {
    const defaults = {
      date_parts: { column: 'transaction_date' },
      impute: { strategy: 'median' },
      aggregate: { group_by: 'account_id', metrics: ['sum', 'avg', 'count'] },
    };
    setTransforms((prev) => ([
      ...prev,
      { id: `t_${Date.now()}`, type, config: defaults[type] || {} },
    ]));
  }, []);

  const setNullThreshold = useCallback((thresholdPct) => {
    setTransforms((prev) => {
      const existing = prev.find((t) => safe(t.type) === 'drop_high_nulls');
      if (existing) {
        return prev.map((t) => (safe(t.type) === 'drop_high_nulls'
          ? { ...t, config: { ...(t.config || {}), threshold_pct: thresholdPct } }
          : t));
      }
      return [{ id: `t_${Date.now()}`, type: 'drop_high_nulls', config: { threshold_pct: thresholdPct } }, ...prev];
    });
  }, []);

  const updateTransformConfigFromText = useCallback((id, rawText) => {
    let parsed = null;
    try {
      parsed = JSON.parse(rawText || '{}');
    } catch (e) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return;
    updateTransform(id, { config: parsed });
  }, [updateTransform]);

  const toggleTable = useCallback((tableType) => {
    const key = safe(tableType);
    setEnabledTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onSelectAnchor = useCallback((nextAnchorType) => {
    const nextAnchor = String(nextAnchorType || 'alerts');
    setAnchorType(nextAnchor);
    const nextGrain = GRAIN_BY_TABLE[safe(nextAnchor)] || 'alert';
    setGrain(nextGrain);
  }, []);

  const sparseTransform = useMemo(
    () => transforms.find((t) => safe(t.type) === 'drop_high_nulls') || null,
    [transforms],
  );
  const dedupTransform = useMemo(
    () => transforms.find((t) => safe(t.type) === 'deduplicate') || null,
    [transforms],
  );
  const nullThreshold = Number(sparseTransform?.config?.threshold_pct || 95);
  const dedupKey = String(dedupTransform?.config?.key || 'alert_id');

  const skipRollup = !transactionsSelected;
  const effectiveSteps = useMemo(
    () => (skipRollup ? STEP_DEFS.filter((s) => !['rollup', 'aggregation'].includes(s.id)) : STEP_DEFS),
    [skipRollup],
  );

  useEffect(() => {
    if (effectiveSteps.some((s) => s.id === currentStepId)) return;
    setCurrentStepId('transforms');
  }, [effectiveSteps, currentStepId]);

  const canContinue = useMemo(() => {
    if (currentStepId === 'base') return Boolean(anchorType);
    if (currentStepId === 'tables') return enabledTables.size > 0;
    if (currentStepId === 'rollup') return skipRollup || rollupConfirmed;
    if (currentStepId === 'aggregation') return true;
    if (currentStepId === 'transforms') return transforms.length > 0;
    if (currentStepId === 'labels') return strMode !== 'replace' || Boolean(replacementLabelColumn);
    return true;
  }, [currentStepId, anchorType, enabledTables.size, skipRollup, rollupConfirmed, transforms.length, strMode, replacementLabelColumn]);

  const goNext = useCallback(() => {
    if (!canContinue) return;
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(currentStepId);
      return next;
    });
    const idx = effectiveSteps.findIndex((s) => s.id === currentStepId);
    if (idx >= 0 && idx < effectiveSteps.length - 1) {
      setCurrentStepId(effectiveSteps[idx + 1].id);
    }
  }, [canContinue, currentStepId, effectiveSteps]);

  const goBack = useCallback(() => {
    const idx = effectiveSteps.findIndex((s) => s.id === currentStepId);
    if (idx > 0) setCurrentStepId(effectiveSteps[idx - 1].id);
  }, [effectiveSteps, currentStepId]);

  useEffect(() => {
    if (!masterDataset?.dataset_id) return;
    setBuiltConfigFingerprint((prev) => prev || buildFingerprint);
  }, [masterDataset?.dataset_id, buildFingerprint]);

  useEffect(() => {
    if (!builtConfigFingerprint) {
      setBuildReadyForContinue(Boolean(masterDataset?.dataset_id));
      return;
    }
    setBuildReadyForContinue(buildFingerprint === builtConfigFingerprint);
  }, [buildFingerprint, builtConfigFingerprint, masterDataset?.dataset_id]);

  const summaryLines = useMemo(() => {
    const selectedTableSet = new Set(Array.from(enabledTables));
    const joinLine = datasets
      .filter((d) => safe(d.dataset_type) !== safe(anchorType))
      .map((d) => `${d.dataset_type} ${selectedTableSet.has(safe(d.dataset_type)) ? '[x]' : '[ ]'}`)
      .join(' ');
    const rollupLine = transactionsSelected
      ? 'Rollup: transactions -> 11 signals per account'
      : 'Rollup: not required (transactions not selected)';
    const transformLine = transforms
      .map((t) => {
        if (safe(t.type) === 'drop_high_nulls') return `drop >${t.config?.threshold_pct ?? 95}% null`;
        if (safe(t.type) === 'deduplicate') return `deduplicate on ${t.config?.key || 'alert_id'}`;
        return t.type;
      })
      .join(', ');
    return [
      `Base table: ${anchorType || '-'} (${fmt(rowImpact.anchorRows)} rows)`,
      `Joins: ${joinLine || 'none selected'}`,
      rollupLine,
      `Transforms: ${transformLine || 'none'}`,
      'Label: build str_label from STR look-forward plus case fallback',
      `Estimated output: ~${fmt(estimatedOutputRows)} rows (label eligibility and match coverage)`,
    ];
  }, [datasets, anchorType, enabledTables, transactionsSelected, transforms, estimatedOutputRows, rowImpact.anchorRows]);

  const renderStepContent = () => {
    if (currentStepId === 'base') {
      return <StepBaseTable datasets={datasets} anchorType={anchorType} onSelectAnchor={onSelectAnchor} />;
    }
    if (currentStepId === 'tables') {
      return (
        <StepSelectTables
          tables={tableCards}
          enabledTables={enabledTables}
          onToggle={toggleTable}
          joinProfileEstimated={joinProfileEstimated}
          onRefreshJoinProfile={fetchJoinGraph}
          loadingJoinProfile={loadingGraph}
          datasets={datasets}
          anchorRows={Number(rowImpact.anchorRows || 0)}
          anchorType={anchorType}
          activeJoins={activeJoins}
          rowImpact={rowImpact}
          hasFanOutJoins={hasFanOutJoins}
        />
      );
    }
    if (currentStepId === 'rollup') {
      return (
        <StepTransactionRollup
          rollups={rollupTables}
          rollupConfirmed={rollupConfirmed}
          onConfirm={setRollupConfirmed}
          datasets={datasets}
          anchorType={anchorType}
          labelSummary={previewData?.label_summary || null}
        />
      );
    }
    if (currentStepId === 'aggregation') {
      return (
        <StepAggregationExplain
          rollups={rollupTables}
          aggregationByTable={aggregationByTable}
          loading={aggregationLoading}
          onRefresh={refreshAggregationPreview}
          anchorType={anchorType}
          labelSummary={previewData?.label_summary || null}
        />
      );
    }
    if (currentStepId === 'transforms') {
      return (
        <StepTransforms
          transforms={transforms}
          nullThreshold={nullThreshold}
          onChangeNullThreshold={setNullThreshold}
          dedupKey={dedupKey}
          onAddTransform={addTransform}
          onRemoveTransform={removeTransform}
          onUpdateTransformConfig={updateTransformConfigFromText}
        />
      );
    }
    if (currentStepId === 'labels') {
      return (
        <StepLabelConfig
          anchorRows={Number(rowImpact.anchorRows || 0)}
          strRows={Number(strDataset?.row_count || 0)}
          caseRows={Number(caseDataset?.row_count || 0)}
          strMode={strMode}
          onChangeStrMode={setStrMode}
          replacementLabelColumn={replacementLabelColumn}
          replacementOptions={replacementOptions}
          onReplacementChange={setReplacementLabelColumn}
          estimatedRows={estimatedOutputRows}
          labelSummary={previewData?.label_summary || null}
          targetLabelName="str_label"
        />
      );
    }
    return (
      <StepPreviewBuild
        summaryLines={summaryLines}
        anchorType={anchorType}
        activeJoins={activeJoins}
        datasets={datasets}
        estimatedOutputRows={estimatedOutputRows}
        previewData={previewData}
        previewError={previewError}
        labelStats={labelStats}
        labelSummary={previewData?.label_summary || null}
        onRefreshPreview={refreshPreview}
        previewLoading={previewLoading}
        onBuild={handleBuild}
        building={building}
        canContinue={buildReadyForContinue}
        onContinue={() => onStepAdvance?.('target')}
        error={error}
        buildLog={buildLog}
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
        rowImpact={rowImpact}
        tableSchemas={tableSchemas}
        targetLabelName="str_label"
      />
    );
  };

  const currentMeta = STEP_DEFS.find((s) => s.id === currentStepId) || STEP_DEFS[0];
  const isPreviewStep = currentStepId === 'preview';
  const handlePreviewNext = useCallback(() => {
    if (buildReadyForContinue) {
      onStepAdvance?.('target');
      return;
    }
    handleBuild();
  }, [buildReadyForContinue, handleBuild, onStepAdvance]);

  const layoutMode = containerWidth >= 980 ? 'two' : 'one';

  const sidebarNode = (
    <div style={{ display: 'grid', gap: 8 }}>
      <WizardSidebar
        steps={STEP_DEFS}
        currentStepId={currentStepId}
        completedSteps={completedSteps}
        skipRollup={skipRollup}
      />

      <div style={{ ...cardStyle, padding: 8, fontSize: 11.5, color: T.muted }}>
        {masterDataset
          ? `Current master dataset: ${masterDataset.dataset_type} (${fmt(masterDataset.row_count)} rows)`
          : 'No master dataset built yet in this environment.'}
        <div style={{ marginTop: 6 }}>
          Quality score: {profileLoading ? 'loading...' : (profileSummary?.quality_score != null ? Number(profileSummary.quality_score).toFixed(0) : '-')}
        </div>
      </div>
    </div>
  );

  const stepNode = (
    <div style={{ display: 'grid', gap: 10 }}>
      <StepShell
        title={currentMeta.title}
        purpose={currentMeta.subtitle}
        onBack={goBack}
        onNext={isPreviewStep ? handlePreviewNext : goNext}
        canBack={effectiveSteps.findIndex((s) => s.id === currentStepId) > 0}
        canNext={isPreviewStep ? !building : canContinue}
        nextLabel={
          isPreviewStep
            ? (buildReadyForContinue ? 'Continue to Target Variable' : (building ? 'Building...' : 'Build Master Dataset'))
            : currentStepId === 'labels'
              ? 'Continue to Preview'
              : 'Continue'
        }
        hideNext={false}
        headerActions={(
          <button
            type="button"
            style={buttonStyle('secondary', false)}
            onClick={() => setInspectorOpen(true)}
          >
            Open full view
          </button>
        )}
      >
        {renderStepContent()}
      </StepShell>
    </div>
  );

  const rightRailNode = (
    <div style={{ display: 'grid', gap: 8 }}>
      <MasterDatasetWorkbench
        currentStepId={currentStepId}
        currentStepTitle={currentMeta.title}
        datasets={datasets}
        anchorType={anchorType}
        enabledTables={enabledTables}
        joins={joins}
        activeJoins={activeJoins}
        tableCards={tableCards}
        rowImpact={rowImpact}
        estimatedOutputRows={estimatedOutputRows}
        joinProfileEstimated={joinProfileEstimated}
        transactionsSelected={transactionsSelected}
        skipRollup={skipRollup}
        rollupConfirmed={rollupConfirmed}
        transforms={transforms}
        strMode={strMode}
        hasFanOutJoins={hasFanOutJoins}
        previewData={previewData}
        rollupTables={rollupTables}
      />

    </div>
  );

  if (layoutMode === 'two') {
    return (
      <>
        <div ref={rootRef} style={{ display: 'grid', width: '100%', height: '100%', minHeight: 0, minWidth: 0, gap: 12, alignItems: 'start', overflowX: 'auto', gridTemplateColumns: 'minmax(190px, 210px) minmax(0, 1fr)' }}>
          <div style={{ minWidth: 0, minHeight: 0 }}>{sidebarNode}</div>
          <div style={{ minWidth: 0, minHeight: 0, display: 'grid', gap: 8 }}>
            <div style={{ minWidth: 0, minHeight: 0 }}>{stepNode}</div>
          </div>
        </div>

        <Dialog
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          fullWidth
          maxWidth="xl"
          PaperProps={{
            sx: {
              borderRadius: 0,
              border: `1px solid ${T.border}`,
              boxShadow: '0 18px 44px rgba(15, 23, 42, 0.18)',
            },
          }}
        >
          <DialogTitle sx={{ px: 2.25, py: 1.5, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Master dataset full view</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                Open a wider workspace for join impact, build guidance, and saved master dataset plans.
              </div>
            </div>
            <IconButton onClick={() => setInspectorOpen(false)} size="small" sx={{ borderRadius: 0, border: `1px solid ${T.border}` }}>
              <Close fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 2, bgcolor: '#f7f8f9' }}>
            {rightRailNode}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <div ref={rootRef} style={{ display: 'grid', width: '100%', height: '100%', minHeight: 0, minWidth: 0, gap: 10, overflowX: 'auto' }}>
        {sidebarNode}
        {stepNode}
      </div>

      <Dialog
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        fullWidth
        maxWidth="xl"
        PaperProps={{
          sx: {
            borderRadius: 0,
            border: `1px solid ${T.border}`,
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.18)',
          },
        }}
      >
        <DialogTitle sx={{ px: 2.25, py: 1.5, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Master dataset full view</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
              Open a wider workspace for join impact, build guidance, and saved master dataset plans.
            </div>
          </div>
          <IconButton onClick={() => setInspectorOpen(false)} size="small" sx={{ borderRadius: 0, border: `1px solid ${T.border}` }}>
            <Close fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 2, bgcolor: '#f7f8f9' }}>
          {rightRailNode}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MasterDatasetWizardContainer;
