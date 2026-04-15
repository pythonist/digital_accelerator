import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import { V } from './validation/validationTheme';
import {
  formatSplitLabel,
  getValidationContext,
  mergeValidationModel,
  normalizeLabel,
  pct,
  totalFromConfusionMatrix,
  unwrap,
} from './validation/validationUtils';
import { MetricChip, SectionCard } from './validation/ValidationShared';
import OverviewTab from './validation/OverviewTab';
import ComparisonTab from './validation/ComparisonTab';
import ThresholdTuningTab from './validation/ThresholdTuningTab';
import StabilityRisksTab from './validation/StabilityRisksTab';
import OOTValidationTab from './validation/OOTValidationTab';
import ValidationSummaryTab from './validation/ValidationSummaryTab';
import mlopsApi from '../services/mlopsApi';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'comparison', label: 'Model Comparison' },
  { id: 'threshold', label: 'Threshold Tuning' },
  { id: 'oot', label: 'OOT Validation' },
  { id: 'stability', label: 'Stability & Risks' },
  { id: 'summary', label: 'Summary' },
];

const DETAIL_REQUEST_TIMEOUT_MS = 8000;

const withTimeout = (promise, timeoutMs = DETAIL_REQUEST_TIMEOUT_MS) => (
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Validation request timed out')), timeoutMs);
    }),
  ])
);

const normalizeSelectedIds = (value) => {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return Array.from(new Set(
    raw
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )).slice(0, 6);
};

const runHasSavedValidation = (run, validationReport) => {
  const runJobId = String(run?.job_id || '').trim();
  const reportJobId = String(validationReport?.job_id || validationReport?.run_id || '').trim();
  if (!runJobId || !reportJobId || runJobId !== reportJobId) return false;
  return Boolean(
    (Array.isArray(validationReport?.threshold_table) && validationReport.threshold_table.length)
    || validationReport?.selected_threshold != null
    || validationReport?.locked_threshold != null
    || validationReport?.optimal_threshold != null
    || validationReport?.report_id
  );
};

const isValidationCapableRun = (run, validationReport) => {
  if (!run || typeof run !== 'object') return false;
  if (runHasSavedValidation(run, validationReport)) return true;
  if (run?.validation_ready === true || run?.resume_ready === true) return true;
  if (Array.isArray(run?.metrics?.threshold_table) && run.metrics.threshold_table.length) return true;
  if (String(run?.artifact_source || '').trim().toLowerCase() === 'model_dir_scan') return false;
  return false;
};

const buildReleaseValidationSnapshot = (activeModelResolved, validationReport) => {
  const selectedThreshold = (
    validationReport?.selected_threshold
    ?? validationReport?.locked_threshold
    ?? validationReport?.optimal_threshold
    ?? activeModelResolved?.selected_threshold
    ?? activeModelResolved?.threshold
    ?? activeModelResolved?.metrics?.optimal_threshold
    ?? null
  );
  const normalizedThreshold = Number.isFinite(Number(selectedThreshold))
    ? Number(selectedThreshold)
    : null;
  return {
    ...(validationReport || {}),
    job_id: validationReport?.job_id || validationReport?.run_id || activeModelResolved?.job_id || '',
    run_id: validationReport?.run_id || validationReport?.job_id || activeModelResolved?.job_id || '',
    selected_threshold: normalizedThreshold,
    locked_threshold: Number.isFinite(Number(validationReport?.locked_threshold))
      ? Number(validationReport.locked_threshold)
      : normalizedThreshold,
    optimal_threshold: Number.isFinite(Number(validationReport?.optimal_threshold))
      ? Number(validationReport.optimal_threshold)
      : normalizedThreshold,
    report_id: validationReport?.report_id || validationReport?.validation_id || '',
    validation_id: validationReport?.validation_id || validationReport?.report_id || '',
    metrics: {
      ...(activeModelResolved?.metrics || {}),
      ...(validationReport?.metrics || {}),
    },
    confusion_matrix: validationReport?.confusion_matrix || activeModelResolved?.metrics?.confusion_matrix || [[0, 0], [0, 0]],
  };
};

const ModelValidationScreen = ({
  persona,
  jobId,
  activePipelineId = null,
  datasetId = null,
  activeModelRun,
  validationReport = null,
  initialActiveTab = 0,
  onActiveTabChange,
  onValidationComplete,
  onActiveRunChange,
  onTrainAnotherModel,
  onContinueToRelease,
  actionsDisabled = false,
  actionsMessage = '',
  staleWarningMessage = '',
}) => {
  const resolvedJobId = jobId || activeModelRun?.job_id || '';
  const [activeTab, setActiveTab] = useState(Number.isInteger(initialActiveTab) ? initialActiveTab : 0);
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [compareData, setCompareData] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [ootResult, setOotResult] = useState(null);
  const [error, setError] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(resolvedJobId || '');
  const [runDetailsByJobId, setRunDetailsByJobId] = useState({});
  const [showAllValidationRuns, setShowAllValidationRuns] = useState(false);
  const lastPropagatedRunRef = useRef('');
  const pendingSelectionJobIdRef = useRef('');
  const activeModelRunRef = useRef(activeModelRun);
  const gatingMessage = actionsMessage || 'Validation outputs are outdated. Rerun the upstream stages before continuing.';
  const hasComparisonSelection = selectedJobIds.length >= 2;

  useEffect(() => {
    activeModelRunRef.current = activeModelRun;
  }, [activeModelRun]);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const params = { limit: 200 };
      if (Number.isFinite(Number(activePipelineId)) && Number(activePipelineId) > 0) {
        params.pipeline_id = Number(activePipelineId);
      }
      if (Number.isFinite(Number(datasetId)) && Number(datasetId) > 0) {
        params.dataset_id = Number(datasetId);
      }
      const res = await mlopsApi.listTrainingRuns(params);
      const data = unwrap(res);
      const nextRuns = Array.isArray(data) ? data.slice() : [];
      const activeRun = activeModelRunRef.current;
      const activeJobId = String(activeRun?.job_id || '').trim();
      if (activeJobId && !nextRuns.some((run) => String(run?.job_id || '') === activeJobId)) {
        nextRuns.unshift(activeRun);
      }
      setRuns(nextRuns);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load training runs');
    } finally {
      setLoadingRuns(false);
    }
  }, [activePipelineId, datasetId]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await mlopsApi.workbenchSummary();
      const data = unwrap(res);
      setSummary(data);
    } catch (e) {
      // summary is optional
    }
  }, []);

  const loadCompare = useCallback(async () => {
    if (selectedJobIds.length < 2) {
      setCompareData([]);
      return;
    }
    setCompareLoading(true);
    setError(null);
    try {
      const res = await mlopsApi.compareRuns({ job_ids: selectedJobIds });
      const data = unwrap(res);
      setCompareData(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load comparison data');
    } finally {
      setCompareLoading(false);
    }
  }, [selectedJobIds]);

  const handleSelectJobIds = useCallback((value) => {
    const nextIds = normalizeSelectedIds(value);
    setSelectedJobIds((prev) => {
      if (prev.length === nextIds.length && prev.every((item, idx) => item === nextIds[idx])) {
        return prev;
      }
      return nextIds;
    });
  }, []);

  const handlePromoteChampion = useCallback(async (job_id) => {
    if (!job_id) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    try {
      await mlopsApi.workbenchChampion({ job_id });
      await loadSummary();
      await loadRuns();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to promote champion');
    }
  }, [actionsDisabled, gatingMessage, loadSummary, loadRuns]);

  const handleArchive = useCallback(async (job_id) => {
    if (!job_id) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    try {
      await mlopsApi.updateRegistryStage(job_id, { stage: 'archived' });
      await loadRuns();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to archive model');
    }
  }, [actionsDisabled, gatingMessage, loadRuns]);

  const handleBulkLabel = useCallback(async (labels) => {
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    try {
      await mlopsApi.workbenchBulkLabel({ labels });
      await loadRuns();
      await loadCompare();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update labels');
    }
  }, [actionsDisabled, gatingMessage, loadRuns, loadCompare]);

  useEffect(() => {
    loadRuns();
    loadSummary();
  }, [loadRuns, loadSummary]);

  useEffect(() => {
    const normalizedResolvedJobId = String(resolvedJobId || '').trim();
    const normalizedCurrentJobId = String(currentJobId || '').trim();
    const pendingSelectionJobId = String(pendingSelectionJobIdRef.current || '').trim();
    if (!normalizedResolvedJobId) return;
    if (pendingSelectionJobId) {
      if (normalizedResolvedJobId === pendingSelectionJobId) {
        pendingSelectionJobIdRef.current = '';
        if (normalizedCurrentJobId !== normalizedResolvedJobId) {
          setCurrentJobId(normalizedResolvedJobId);
        }
      }
      return;
    }
    if (normalizedResolvedJobId !== normalizedCurrentJobId) {
      setCurrentJobId(normalizedResolvedJobId);
    }
  }, [resolvedJobId, currentJobId]);

  useEffect(() => {
    if (!Number.isInteger(initialActiveTab)) return;
    setActiveTab((prev) => (prev === initialActiveTab ? prev : initialActiveTab));
  }, [initialActiveTab]);

  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);

  useEffect(() => {
    if (!selectedJobIds.length && (currentJobId || runs.length)) {
      setSelectedJobIds([currentJobId || runs[0].job_id].filter(Boolean));
    }
  }, [currentJobId, runs, selectedJobIds.length]);

  useEffect(() => {
    if (!currentJobId) return;
    setSelectedJobIds((prev) => {
      if (prev.includes(currentJobId)) return prev;
      return [currentJobId, ...prev].slice(0, 4);
    });
  }, [currentJobId]);

  useEffect(() => {
    if ((activeTab === 1 || activeTab === 4 || activeTab === 5) && selectedJobIds.length >= 2) {
      loadCompare();
    }
  }, [activeTab, selectedJobIds, loadCompare]);

  useEffect(() => {
    if (selectedJobIds.length < 2 && compareData.length) {
      setCompareData([]);
    }
  }, [compareData.length, selectedJobIds.length]);

  const activeModel = useMemo(() => (
    [...runs, ...compareData].find((r) => String(r?.job_id || '') === String(currentJobId || ''))
    || (String(activeModelRun?.job_id || '') === String(currentJobId || '') ? activeModelRun : null)
    || activeModelRun
    || runs.find((r) => String(r?.job_id || '') === String(selectedJobIds[0] || ''))
    || compareData.find((r) => String(r?.job_id || '') === String(selectedJobIds[0] || ''))
    || runs[0]
    || null
  ), [runs, compareData, currentJobId, activeModelRun, selectedJobIds]);
  const effectiveJobId = currentJobId || activeModel?.job_id || '';

  useEffect(() => {
    if (!activeModelRun?.job_id || !activeModelRun?.results) return;
    setRunDetailsByJobId((prev) => {
      if (prev[activeModelRun.job_id]) return prev;
      return { ...prev, [activeModelRun.job_id]: activeModelRun.results };
    });
  }, [activeModelRun?.job_id, activeModelRun?.results]);

  const requestedDetailIds = useMemo(
    () => Array.from(new Set([effectiveJobId, ...selectedJobIds].filter(Boolean))),
    [effectiveJobId, selectedJobIds],
  );

  useEffect(() => {
    const missingIds = requestedDetailIds.filter((id) => !Object.prototype.hasOwnProperty.call(runDetailsByJobId, id));
    if (!missingIds.length) return undefined;
    let cancelled = false;

    (async () => {
      setLoadingDetails(true);
      try {
        const payload = await Promise.all(
          missingIds.map(async (job_id) => {
            try {
              const res = await withTimeout(mlopsApi.modelResults(job_id));
              return [job_id, unwrap(res)];
            } catch (detailError) {
              return [job_id, null];
            }
          }),
        );
        if (cancelled) return;
        setRunDetailsByJobId((prev) => {
          const next = { ...prev };
          payload.forEach(([job_id, detail]) => {
            next[job_id] = detail;
          });
          return next;
        });
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedDetailIds, runDetailsByJobId]);

  const activeModelResolved = useMemo(
    () => mergeValidationModel(activeModel, runDetailsByJobId[effectiveJobId] || activeModel?.results || activeModelRun?.results),
    [activeModel, activeModelRun?.results, effectiveJobId, runDetailsByJobId],
  );

  const comparisonRuns = useMemo(() => {
    const order = new Map((selectedJobIds || []).map((job_id, idx) => [String(job_id), idx]));
    const compareMap = new Map((compareData || []).map((model) => [String(model?.job_id || ''), model]));
    const runMap = new Map((runs || []).map((run) => [String(run?.job_id || ''), run]));
    return (selectedJobIds || [])
      .map((job_id) => {
        const normalizedId = String(job_id || '');
        const baseModel = compareMap.get(normalizedId)
          || runMap.get(normalizedId)
          || { job_id: normalizedId };
        const detailModel = runDetailsByJobId[normalizedId];
        const merged = mergeValidationModel(baseModel, detailModel);
        return merged?.job_id ? merged : null;
      })
      .filter(Boolean)
      .sort((left, right) => (order.get(String(left?.job_id || '')) ?? 999) - (order.get(String(right?.job_id || '')) ?? 999));
  }, [compareData, runDetailsByJobId, runs, selectedJobIds]);

  const validationRunOptions = useMemo(() => {
    const baseRuns = Array.isArray(runs) ? runs : [];
    const seen = new Set();
    const merged = [];

    const pushRun = (candidate) => {
      const job_id = String(candidate?.job_id || '').trim();
      if (!job_id || seen.has(job_id)) return;
      seen.add(job_id);
      const hydrated = mergeValidationModel(candidate, runDetailsByJobId[job_id] || candidate?.results);
      merged.push(hydrated);
    };

    if (activeModelRun?.job_id) pushRun(activeModelRun);
    baseRuns.forEach(pushRun);

    return merged;
  }, [activeModelRun, runDetailsByJobId, runs]);

  const displayedValidationRuns = useMemo(() => {
    if (!validationRunOptions.length) return [];
    const selectedId = String(currentJobId || effectiveJobId || '').trim();
    const ordered = validationRunOptions.slice().sort((left, right) => {
      const leftSelected = String(left?.job_id || '') === selectedId ? 1 : 0;
      const rightSelected = String(right?.job_id || '') === selectedId ? 1 : 0;
      if (leftSelected !== rightSelected) return rightSelected - leftSelected;
      const leftCapable = isValidationCapableRun(left, validationReport) ? 1 : 0;
      const rightCapable = isValidationCapableRun(right, validationReport) ? 1 : 0;
      if (leftCapable !== rightCapable) return rightCapable - leftCapable;
      const leftTs = Date.parse(left?.trained_at || 0) || 0;
      const rightTs = Date.parse(right?.trained_at || 0) || 0;
      return rightTs - leftTs;
    });
    if (showAllValidationRuns) return ordered;
    return ordered.slice(0, 5);
  }, [currentJobId, effectiveJobId, showAllValidationRuns, validationReport, validationRunOptions]);

  const activeModelSignature = useMemo(() => JSON.stringify({
    job_id: activeModelResolved?.job_id || '',
    selected_threshold: activeModelResolved?.selected_threshold ?? activeModelResolved?.threshold ?? null,
    optimal_threshold: activeModelResolved?.optimal_threshold ?? activeModelResolved?.metrics?.optimal_threshold ?? null,
    algorithm: activeModelResolved?.algorithm || activeModelResolved?.algorithm_display || '',
    auc: activeModelResolved?.metrics?.roc_auc ?? activeModelResolved?.auc ?? null,
  }), [activeModelResolved]);

  useEffect(() => {
    if (!activeModelResolved?.job_id || typeof onActiveRunChange !== 'function') return;
    if (lastPropagatedRunRef.current === activeModelSignature) return;
    lastPropagatedRunRef.current = activeModelSignature;
    onActiveRunChange(activeModelResolved);
  }, [activeModelResolved, activeModelSignature, onActiveRunChange]);

  const activeContext = useMemo(
    () => getValidationContext(activeModelResolved),
    [activeModelResolved],
  );
  const activeHoldoutRows = Number.isFinite(activeContext.testRows)
    ? activeContext.testRows
    : totalFromConfusionMatrix(activeModelResolved?.confusion_matrix || activeModelResolved?.metrics?.confusion_matrix);
  const activeTrainRows = Number.isFinite(activeContext.trainRows) ? activeContext.trainRows : null;
  const activeSplitDetail = activeContext.splitStrategy === 'temporal'
    ? `${activeContext.dateColumn || 'date'}${activeContext.splitDate ? ` @ ${activeContext.splitDate}` : ''}`
    : activeContext.splitStrategy
      ? `${activeContext.splitStrategy} split`
      : 'Run a model comparison or validation report to populate holdout details.';
  const activeThreshold = activeModelResolved?.metrics?.optimal_threshold ?? activeModelResolved?.optimal_threshold ?? null;
  const activeThresholdText = activeThreshold == null || Number.isNaN(Number(activeThreshold))
    ? '-'
    : Number(activeThreshold).toFixed(2);
  const completedTabIndexes = useMemo(() => {
    const done = new Set();
    for (let idx = 0; idx < activeTab; idx += 1) done.add(idx);
    return done;
  }, [activeTab]);
  const headerCards = [
    {
      label: 'Active Model',
      value: activeModelResolved?.job_id ? normalizeLabel(activeModelResolved) : 'Select a run',
      detail: activeModelResolved?.algorithm_display || activeModelResolved?.algorithm || 'No active model selected',
    },
    {
      label: 'Validation Split',
      value: formatSplitLabel(activeContext),
      detail: activeSplitDetail,
    },
    {
      label: 'Validation Rows',
      value: activeHoldoutRows ? activeHoldoutRows.toLocaleString() : '-',
      detail: activeTrainRows ? `Train ${activeTrainRows.toLocaleString()} rows` : 'Train rows not available',
    },
    {
      label: 'Recommended Threshold',
      value: activeThresholdText,
      detail: staleWarningMessage
        ? 'Awaiting rerun after upstream change'
        : (activeContext.testEventRatePct != null ? `Event rate ${pct(activeContext.testEventRatePct, 1)}` : 'Event rate not available'),
    },
  ];

  const handleSelectValidationRun = useCallback((nextJobId) => {
    const normalizedId = String(nextJobId || '').trim();
    if (!normalizedId || normalizedId === String(currentJobId || '').trim()) return;
    const selectedRun = validationRunOptions.find((run) => String(run?.job_id || '').trim() === normalizedId);
    if (!isValidationCapableRun(selectedRun, validationReport)) {
      setError('This saved model only has the artifact file. Validation cannot reopen it after restart because its holdout scores and saved validation decision were not persisted.');
      return;
    }
    setError(null);
    pendingSelectionJobIdRef.current = normalizedId;
    setCurrentJobId(normalizedId);
    setSelectedJobIds((prev) => {
      const withoutCurrent = (Array.isArray(prev) ? prev : []).filter((item) => String(item || '').trim() !== normalizedId);
      return [normalizedId, ...withoutCurrent].slice(0, 6);
    });
  }, [currentJobId, validationReport, validationRunOptions]);

  const formatRunTimestamp = useCallback((value) => {
    const text = String(value || '').trim();
    if (!text) return '-';
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text.slice(0, 19).replace('T', ' ');
    return parsed.toLocaleString();
  }, []);

  return (
    <Stack spacing={2} sx={{ bgcolor: V.canvas, p: 0.25 }}>
      <SectionCard sx={{ bgcolor: V.paper }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ lg: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Validation Context
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: V.textMuted, mt: 0.45, maxWidth: 760, lineHeight: 1.6 }}>
                Holdout split, validation rows, and the active cut-off for the selected model.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {loadingRuns || loadingDetails ? <CircularProgress size={18} sx={{ color: V.orange }} /> : null}
              {activeModelResolved?.job_id && (
                <MetricChip label={normalizeLabel(activeModelResolved)} tone="default" />
              )}
              {activeModelResolved?.algorithm
                && String(activeModelResolved.algorithm_display || activeModelResolved.algorithm).toLowerCase()
                  !== String(normalizeLabel(activeModelResolved)).toLowerCase() && (
                <MetricChip label={activeModelResolved.algorithm_display || activeModelResolved.algorithm} tone="default" />
              )}
              {formatSplitLabel(activeContext) && (
                <MetricChip label={formatSplitLabel(activeContext)} tone="default" />
              )}
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
            }}
          >
            {headerCards.map((card) => (
              <Paper
                key={card.label}
                variant="outlined"
                sx={{
                  p: 1.2,
                  borderRadius: 0,
                  borderColor: V.border,
                  bgcolor: V.panelAlt,
                }}
              >
                <Typography sx={{ fontSize: 10.25, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                  {card.label}
                </Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800, color: V.text, mt: 0.45 }}>
                  {card.value}
                </Typography>
                <Typography sx={{ fontSize: 11, color: V.textMuted, mt: 0.45, minHeight: 34 }}>
                  {card.detail}
                </Typography>
              </Paper>
            ))}
          </Box>

          <Paper
            variant="outlined"
            sx={{
              borderRadius: 0,
              borderColor: V.border,
              bgcolor: V.panelAlt,
              p: 1.25,
            }}
          >
            <Stack spacing={1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: 10.25, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    Previously Trained Models
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: V.textMuted, mt: 0.4 }}>
                    Pick one saved model run for validation and Model Release. The selected row becomes the active pipeline model.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <MetricChip
                    label={`${validationRunOptions.length} saved run${validationRunOptions.length === 1 ? '' : 's'}`}
                    tone="default"
                  />
                  {validationRunOptions.length > 5 ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowAllValidationRuns((prev) => !prev)}
                      sx={{ textTransform: 'none', borderRadius: 0, color: V.textMuted, fontWeight: 700 }}
                    >
                      {showAllValidationRuns ? 'Show fewer' : 'Show all'}
                    </Button>
                  ) : null}
                </Stack>
              </Stack>

              {validationRunOptions.length ? (
                <Box
                  sx={{
                    border: `1px solid ${V.border}`,
                    bgcolor: V.paper,
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1,
                      gridTemplateColumns: 'minmax(0, 2.1fr) minmax(140px, 1.1fr) repeat(3, minmax(90px, 0.8fr)) 140px',
                      px: 1.2,
                      py: 0.9,
                      borderBottom: `1px solid ${V.border}`,
                      bgcolor: V.panelAlt,
                      '@media (max-width: 1100px)': {
                        display: 'none',
                      },
                    }}
                  >
                    {['Model', 'Trained At', 'ROC AUC', 'F1', 'Threshold', 'Action'].map((label) => (
                      <Typography
                        key={label}
                        sx={{ fontSize: 10.25, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
                      >
                        {label}
                      </Typography>
                    ))}
                  </Box>
                  {displayedValidationRuns.map((run) => {
                    const runJobId = String(run?.job_id || '').trim();
                    const selected = runJobId === String(currentJobId || effectiveJobId || '').trim();
                    const capable = isValidationCapableRun(run, validationReport);
                    return (
                      <Box
                        key={runJobId}
                        sx={{
                          display: 'grid',
                          gap: 1,
                          gridTemplateColumns: 'minmax(0, 2.1fr) minmax(140px, 1.1fr) repeat(3, minmax(90px, 0.8fr)) 140px',
                          alignItems: 'center',
                          px: 1.2,
                          py: 1,
                          borderBottom: `1px solid ${V.border}`,
                          bgcolor: selected ? '#fff7f0' : V.paper,
                          '@media (max-width: 1100px)': {
                            display: 'block',
                          },
                        }}
                      >
                        <Box sx={{ minWidth: 0, mb: { xs: 1, md: 0 } }}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography sx={{ fontSize: 14, fontWeight: 800, color: V.text }}>
                              {normalizeLabel(run)}
                            </Typography>
                            {selected ? <MetricChip label="Active" tone="good" /> : null}
                          </Stack>
                          <Typography sx={{ fontSize: 11, color: V.textMuted, mt: 0.25 }}>
                            {(run?.algorithm_display || run?.algorithm || 'Algorithm unavailable').replace(/_/g, ' ')}
                          </Typography>
                        </Box>

                        <Typography sx={{ fontSize: 11.5, color: V.text, mb: { xs: 0.8, md: 0 } }}>
                          {formatRunTimestamp(run?.trained_at)}
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: V.text, mb: { xs: 0.8, md: 0 } }}>
                          {run?.metrics?.roc_auc != null ? Number(run.metrics.roc_auc).toFixed(3) : 'Saved model'}
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: V.text, mb: { xs: 0.8, md: 0 } }}>
                          {run?.metrics?.f1 != null ? Number(run.metrics.f1).toFixed(3) : 'Saved model'}
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: V.text, mb: { xs: 0.8, md: 0 } }}>
                          {run?.selected_threshold != null
                            ? Number(run.selected_threshold).toFixed(2)
                            : run?.metrics?.optimal_threshold != null
                              ? Number(run.metrics.optimal_threshold).toFixed(2)
                              : '0.50'}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                          <Button
                            size="small"
                            variant={selected ? 'contained' : 'outlined'}
                            onClick={() => handleSelectValidationRun(runJobId)}
                            disabled={!selected && !capable}
                            sx={{
                              textTransform: 'none',
                              borderRadius: 0,
                              fontWeight: 700,
                              minWidth: 116,
                              bgcolor: selected ? V.orange : 'transparent',
                              color: selected ? '#fff' : V.text,
                              borderColor: selected ? V.orange : V.border,
                              '&:hover': {
                                bgcolor: selected ? '#d46b1f' : V.panelAlt,
                                borderColor: selected ? '#d46b1f' : V.border,
                              },
                            }}
                          >
                            {selected ? 'Selected' : capable ? 'Validate This' : 'History Only'}
                          </Button>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Alert severity="info" sx={{ borderRadius: 0 }}>
                  No saved training runs are available for this pipeline yet. Train a model in Stage 6 first.
                </Alert>
              )}
            </Stack>
          </Paper>
        </Stack>
      </SectionCard>

      {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}
      {actionsDisabled && <Alert severity="warning" sx={{ borderRadius: 0 }}>{gatingMessage}</Alert>}

      {!effectiveJobId && !loadingRuns && runs.length === 0 && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Train at least one model in Stage 6 before running validation.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 0, overflow: 'hidden', borderColor: V.border }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{
            bgcolor: V.paper,
            borderBottom: `1px solid ${V.border}`,
            minHeight: 54,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: 13,
              fontWeight: 700,
              minHeight: 54,
              color: V.textMuted,
            },
            '& .Mui-selected': { color: V.orange },
            '& .MuiTabs-indicator': { bgcolor: V.orange, height: 3 },
          }}
        >
          {tabs.map((tab, idx) => (
            <Tab
              key={tab.id}
              label={(
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>{tab.label}</span>
                  {completedTabIndexes.has(idx) && (
                    <CheckCircle sx={{ fontSize: 14, color: V.good }} />
                  )}
                </Stack>
              )}
            />
          ))}
        </Tabs>
      </Paper>

      <Box>
        {activeTab === 0 && (
          <OverviewTab
            summary={summary}
            runs={runs}
            activeModel={activeModelResolved}
            onPromoteChampion={handlePromoteChampion}
            persona={persona}
            actionsDisabled={actionsDisabled}
          />
        )}

        {activeTab === 1 && (
          <Stack spacing={1.25}>
            {!hasComparisonSelection && (
              <Alert
                severity="info"
                sx={{ borderRadius: 0 }}
                action={typeof onTrainAnotherModel === 'function' ? (
                  <Button color="inherit" size="small" onClick={onTrainAnotherModel} sx={{ textTransform: 'none', fontWeight: 700 }}>
                    Train another model
                  </Button>
                ) : undefined}
              >
                Validation is running in single-model mode. Review the active model now, then train another only if you want a side-by-side comparison later.
              </Alert>
            )}
            <ComparisonTab
              runs={runs}
              selectedJobIds={selectedJobIds}
              onSelectJobIds={handleSelectJobIds}
              compareData={comparisonRuns}
              loading={hasComparisonSelection ? compareLoading : false}
              onCompare={loadCompare}
              onPromoteChampion={handlePromoteChampion}
              onArchive={handleArchive}
              onBulkLabel={handleBulkLabel}
              actionsDisabled={actionsDisabled}
            />
          </Stack>
        )}

        {activeTab === 2 && (
          <ThresholdTuningTab
            jobId={effectiveJobId}
            runs={runs}
            activeModel={activeModelResolved}
            savedValidationReport={validationReport}
            onJobChange={setCurrentJobId}
            onValidationComplete={onValidationComplete}
            actionsDisabled={actionsDisabled}
            actionsMessage={gatingMessage}
          />
        )}

        {activeTab === 3 && (
          <OOTValidationTab
            runs={runs}
            defaultJobId={effectiveJobId}
            defaultThreshold={validationReport?.selected_threshold ?? activeModelResolved?.selected_threshold ?? activeModelResolved?.metrics?.optimal_threshold ?? null}
            result={ootResult}
            onResultChange={setOotResult}
            actionsDisabled={actionsDisabled}
            actionsMessage={gatingMessage}
          />
        )}

        {activeTab === 4 && (
          <StabilityRisksTab compareData={comparisonRuns} />
        )}

        {activeTab === 5 && (
          <ValidationSummaryTab
            activeModel={activeModelResolved}
            comparisonRuns={comparisonRuns}
            validationReport={validationReport}
            ootResult={ootResult}
            onValidationComplete={onValidationComplete}
            actionsDisabled={actionsDisabled}
            actionsMessage={gatingMessage}
          />
        )}
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 0, borderColor: V.border, bgcolor: V.paper, p: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between" alignItems={{ md: 'center' }}>
          <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
            {validationReport?.selected_threshold != null
              ? `Validation threshold ${Number(validationReport.selected_threshold).toFixed(2)} is locked and will flow into Model Release.`
              : 'Run threshold tuning to lock the validation threshold before moving into Model Release.'}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {typeof onTrainAnotherModel === 'function' ? (
              <Button
                variant="outlined"
                onClick={onTrainAnotherModel}
                sx={{ textTransform: 'none', borderRadius: 0, borderColor: V.border, color: V.textMuted, fontWeight: 700 }}
              >
                Back to Model Training
              </Button>
            ) : null}
            {typeof onContinueToRelease === 'function' ? (
              <Button
                variant="contained"
                onClick={() => onContinueToRelease({
                  activeModelRun: activeModelResolved,
                  validationReport: buildReleaseValidationSnapshot(activeModelResolved, validationReport),
                })}
                disabled={actionsDisabled || !(validationReport?.selected_threshold != null || validationReport?.optimal_threshold != null)}
                sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', borderRadius: 0, fontWeight: 700 }}
              >
                Continue to Model Release
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
};

export default ModelValidationScreen;
