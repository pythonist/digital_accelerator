import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Tune } from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';
import { V } from './validationTheme';
import {
  fmt,
  formatSplitLabel,
  getValidationContext,
  normalizeLabel,
  num,
  pct,
  safeNumber,
  totalFromConfusionMatrix,
  unwrap,
} from './validationUtils';
import {
  ConfusionMatrixGrid,
  DeltaPill,
  MetricChip,
  SectionCard,
  SectionTitle,
  StatCard,
  TableHeader,
} from './ValidationShared';

const normalizeThresholdRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const thresholdValue = Number(row.threshold ?? row.opt_threshold ?? row.score_threshold);
      if (!Number.isFinite(thresholdValue)) return null;
      const suppressionPct = Number(row.suppression_rate_pct ?? row.suppression_rate ?? 0);
      const eventLossPct = Number(row.event_loss_pct ?? 0);
      return {
        ...row,
        threshold: thresholdValue,
        suppression_rate_pct: Number.isFinite(suppressionPct) ? suppressionPct : 0,
        suppression_rate: Number.isFinite(suppressionPct) ? suppressionPct : 0,
        event_loss_pct: Number.isFinite(eventLossPct) ? eventLossPct : 0,
        precision: Number.isFinite(Number(row.precision)) ? Number(row.precision) : null,
        recall: Number.isFinite(Number(row.recall)) ? Number(row.recall) : null,
        f1: Number.isFinite(Number(row.f1)) ? Number(row.f1) : null,
        specificity: Number.isFinite(Number(row.specificity)) ? Number(row.specificity) : null,
        accuracy: Number.isFinite(Number(row.accuracy)) ? Number(row.accuracy) : null,
        balanced_accuracy: Number.isFinite(Number(row.balanced_accuracy)) ? Number(row.balanced_accuracy) : null,
        tn: Number.isFinite(Number(row.tn)) ? Number(row.tn) : 0,
        fp: Number.isFinite(Number(row.fp)) ? Number(row.fp) : 0,
        fn: Number.isFinite(Number(row.fn)) ? Number(row.fn) : 0,
        tp: Number.isFinite(Number(row.tp)) ? Number(row.tp) : 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.threshold - right.threshold);
};

const buildScoreFromRow = (row, fallbackThreshold = 0.5) => {
  if (!row || typeof row !== 'object') return null;
  const threshold = Number(row.threshold ?? fallbackThreshold);
  return {
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
    confusion_matrix: [
      [Number(row.tn ?? 0), Number(row.fp ?? 0)],
      [Number(row.fn ?? 0), Number(row.tp ?? 0)],
    ],
    suppression_rate_pct: Number(row.suppression_rate_pct ?? row.suppression_rate ?? 0),
    event_loss_pct: Number(row.event_loss_pct ?? 0),
    precision: Number.isFinite(Number(row.precision)) ? Number(row.precision) : 0,
    recall: Number.isFinite(Number(row.recall)) ? Number(row.recall) : 0,
    f1: Number.isFinite(Number(row.f1)) ? Number(row.f1) : 0,
    specificity: Number.isFinite(Number(row.specificity)) ? Number(row.specificity) : 0,
    accuracy: Number.isFinite(Number(row.accuracy)) ? Number(row.accuracy) : 0,
    balanced_accuracy: Number.isFinite(Number(row.balanced_accuracy)) ? Number(row.balanced_accuracy) : 0,
  };
};

const closestThresholdRow = (rows, thresholdValue) => {
  if (!Array.isArray(rows) || !rows.length) return null;
  const target = Number(thresholdValue);
  if (!Number.isFinite(target)) return rows[0];
  return rows.reduce((best, row) => (
    Math.abs(Number(row.threshold ?? 0.5) - target) < Math.abs(Number(best.threshold ?? 0.5) - target)
      ? row
      : best
  ), rows[0]);
};

const emptyPanel = (title, body) => (
  <Stack
    spacing={0.75}
    alignItems="center"
    justifyContent="center"
    sx={{
      minHeight: 260,
      border: `1px dashed ${V.border}`,
      borderRadius: 2.5,
      bgcolor: V.panelAlt,
      px: 2,
      textAlign: 'center',
    }}
  >
    <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{title}</Typography>
    <Typography sx={{ fontSize: 11.5, color: V.textMuted, maxWidth: 360 }}>{body}</Typography>
  </Stack>
);

const ThresholdTuningTab = ({
  jobId,
  runs,
  activeModel = null,
  savedValidationReport = null,
  onValidationComplete,
  onJobChange,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const [maxEventLoss, setMaxEventLoss] = useState(5);
  const [optimizationMode, setOptimizationMode] = useState('max_suppression_under_event_loss');
  const [targetSuppression, setTargetSuppression] = useState(70);
  const [report, setReport] = useState(null);
  const [selectedThreshold, setSelectedThreshold] = useState(0.5);
  const [selectedScore, setSelectedScore] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingThreshold, setLoadingThreshold] = useState(false);
  const [error, setError] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [activeJobId, setActiveJobId] = useState(jobId || '');
  const publishedSignatureRef = useRef('');
  const gatingMessage = actionsMessage || 'Validation outputs are outdated. Rerun the upstream stages before continuing.';

  useEffect(() => {
    if (jobId && jobId !== activeJobId) setActiveJobId(jobId);
  }, [jobId, activeJobId]);

  useEffect(() => {
    if (!activeJobId && Array.isArray(runs) && runs.length > 0) {
      setActiveJobId(String(runs[0].job_id || ''));
    }
  }, [activeJobId, runs]);

  useEffect(() => {
    if (activeJobId) onJobChange?.(activeJobId);
  }, [activeJobId, onJobChange]);

  const activeRun = useMemo(
    () => (String(activeModel?.job_id || '') === String(activeJobId || '') ? activeModel : null),
    [activeJobId, activeModel],
  );

  const buildSavedReport = useCallback((targetJobId = activeJobId) => {
    const normalizedJobId = String(targetJobId || '').trim();
    if (!normalizedJobId) return null;
    const reportCandidates = [
      savedValidationReport,
      activeRun?.validation?.report,
      activeRun?.validation,
      activeRun,
    ].filter((candidate) => candidate && typeof candidate === 'object');

    for (const candidate of reportCandidates) {
      const candidateJobId = String(candidate?.job_id || candidate?.run_id || activeRun?.job_id || '').trim();
      if (candidateJobId && candidateJobId !== normalizedJobId) continue;
      const thresholdTable = normalizeThresholdRows(
        candidate?.threshold_table
          || candidate?.report?.threshold_table
          || candidate?.metrics?.threshold_table
          || candidate?.validation?.report?.threshold_table,
      );
      if (!thresholdTable.length) continue;
      const selectedThreshold = Number(
        candidate?.selected_threshold
          ?? candidate?.locked_threshold
          ?? candidate?.configured_threshold
          ?? activeRun?.selected_threshold
          ?? activeRun?.threshold
          ?? candidate?.optimal_threshold
          ?? thresholdTable[0]?.threshold
          ?? 0.5,
      );
      const selectedRow = closestThresholdRow(thresholdTable, selectedThreshold) || thresholdTable[0];
      const reportBody = {
        ...candidate,
        job_id: normalizedJobId,
        threshold_table: thresholdTable,
        optimal_threshold: Number(
          candidate?.optimal_threshold
            ?? candidate?.recommended_threshold
            ?? selectedRow?.threshold
            ?? thresholdTable[0]?.threshold
            ?? 0.5,
        ),
        configured_threshold: selectedThreshold,
        selected_threshold: selectedThreshold,
        locked_threshold: Number(candidate?.locked_threshold ?? selectedThreshold),
        max_event_loss_pct: Number(candidate?.max_event_loss_pct ?? 5),
        suppression_rate_pct: candidate?.suppression_rate_pct ?? selectedRow?.suppression_rate_pct ?? 0,
        event_loss_pct: candidate?.event_loss_pct ?? selectedRow?.event_loss_pct ?? 0,
        precision: candidate?.precision ?? selectedRow?.precision ?? null,
        recall: candidate?.recall ?? selectedRow?.recall ?? null,
        f1: candidate?.f1 ?? selectedRow?.f1 ?? null,
        specificity: candidate?.specificity ?? selectedRow?.specificity ?? null,
        accuracy: candidate?.accuracy ?? selectedRow?.accuracy ?? null,
        balanced_accuracy: candidate?.balanced_accuracy ?? selectedRow?.balanced_accuracy ?? null,
        confusion_matrix: candidate?.confusion_matrix || buildScoreFromRow(selectedRow, selectedThreshold)?.confusion_matrix || [[0, 0], [0, 0]],
        constraint_satisfied: candidate?.constraint_satisfied ?? true,
        selection_note: candidate?.selection_note || 'Restored from the saved validation report for this run.',
      };
      reportBody.metrics = {
        ...(candidate?.metrics || {}),
        roc_auc: candidate?.roc_auc ?? candidate?.metrics?.roc_auc ?? null,
        pr_auc: candidate?.pr_auc ?? candidate?.metrics?.pr_auc ?? null,
        precision: reportBody.precision,
        recall: reportBody.recall,
        f1: reportBody.f1,
        accuracy: reportBody.accuracy,
        balanced_accuracy: reportBody.balanced_accuracy,
        specificity: reportBody.specificity,
      };
      return reportBody;
    }
    return null;
  }, [activeJobId, activeRun, savedValidationReport]);

  const buildLimitedReport = useCallback((targetJobId = activeJobId, detail = null) => {
    const normalizedJobId = String(targetJobId || '').trim();
    if (!normalizedJobId) return null;
    const thresholdHint = Number(
      detail?.selected_threshold
        ?? detail?.configured_threshold
        ?? detail?.recommended_threshold
        ?? activeRun?.selected_threshold
        ?? activeRun?.threshold
        ?? activeRun?.metrics?.optimal_threshold
        ?? 0.5,
    );
    const safeThreshold = Number.isFinite(thresholdHint) ? thresholdHint : 0.5;
    return {
      job_id: normalizedJobId,
      optimal_threshold: safeThreshold,
      selected_threshold: safeThreshold,
      locked_threshold: safeThreshold,
      configured_threshold: safeThreshold,
      max_event_loss_pct: Number(maxEventLoss) || 5,
      threshold_table: [],
      suppression_rate_pct: detail?.suppression_rate_pct ?? activeRun?.metrics?.suppression_rate_pct ?? 0,
      event_loss_pct: detail?.event_loss_pct ?? activeRun?.metrics?.event_loss_pct ?? 0,
      precision: detail?.precision ?? activeRun?.metrics?.precision ?? null,
      recall: detail?.recall ?? activeRun?.metrics?.recall ?? null,
      f1: detail?.f1 ?? activeRun?.metrics?.f1 ?? null,
      specificity: detail?.specificity ?? activeRun?.metrics?.specificity ?? null,
      accuracy: detail?.accuracy ?? activeRun?.metrics?.accuracy ?? null,
      balanced_accuracy: detail?.balanced_accuracy ?? activeRun?.metrics?.balanced_accuracy ?? null,
      confusion_matrix: detail?.confusion_matrix || activeRun?.metrics?.confusion_matrix || [[0, 0], [0, 0]],
      constraint_satisfied: true,
      restored_without_scores: true,
      selection_note: detail?.score_distribution_reason
        || 'Restored the saved model context for this run. Detailed threshold curves are unavailable because holdout score vectors were not persisted.',
      metrics: {
        roc_auc: detail?.roc_auc ?? activeRun?.metrics?.roc_auc ?? null,
        pr_auc: detail?.pr_auc ?? activeRun?.metrics?.pr_auc ?? null,
        precision: detail?.precision ?? activeRun?.metrics?.precision ?? null,
        recall: detail?.recall ?? activeRun?.metrics?.recall ?? null,
        f1: detail?.f1 ?? activeRun?.metrics?.f1 ?? null,
        accuracy: detail?.accuracy ?? activeRun?.metrics?.accuracy ?? null,
        balanced_accuracy: detail?.balanced_accuracy ?? activeRun?.metrics?.balanced_accuracy ?? null,
        specificity: detail?.specificity ?? activeRun?.metrics?.specificity ?? null,
      },
    };
  }, [activeJobId, activeRun, maxEventLoss]);

  const validationContext = useMemo(
    () => getValidationContext(activeRun),
    [activeRun],
  );

  const chartData = useMemo(() => {
    const rows = report?.threshold_table || [];
    return rows.map((row) => ({
      threshold: Number(row.threshold ?? 0),
      suppression: Number(row.suppression_rate_pct ?? row.suppression_rate ?? 0),
      eventLoss: Number(row.event_loss_pct ?? 0),
      precision: Number(row.precision ?? 0),
      recall: Number(row.recall ?? 0),
      f1: Number(row.f1 ?? 0),
      specificity: Number(row.specificity ?? 0),
    }));
  }, [report]);

  const minThr = chartData.length ? Math.min(...chartData.map((row) => row.threshold)) : 0.1;
  const maxThr = chartData.length ? Math.max(...chartData.map((row) => row.threshold)) : 0.9;
  const sliderStep = useMemo(() => {
    if (chartData.length < 2) return 0.01;
    const diffs = chartData
      .map((row, idx) => (idx === 0 ? null : Math.abs(row.threshold - chartData[idx - 1].threshold)))
      .filter((value) => value && value > 0);
    return diffs.length ? Number(Math.min(...diffs).toFixed(4)) : 0.01;
  }, [chartData]);

  const publishValidationState = useCallback((baseReport, scoreOverride, thresholdOverride) => {
    if (!baseReport || !activeJobId) return;
    const score = scoreOverride || null;
    const selected = Number(thresholdOverride ?? score?.threshold ?? selectedThreshold ?? baseReport?.configured_threshold ?? baseReport?.optimal_threshold ?? 0.5);
    const metrics = {
      roc_auc: baseReport?.roc_auc ?? baseReport?.metrics?.roc_auc ?? null,
      pr_auc: baseReport?.pr_auc ?? baseReport?.metrics?.pr_auc ?? null,
      precision: score?.precision ?? baseReport?.precision ?? baseReport?.metrics?.precision ?? null,
      recall: score?.recall ?? baseReport?.recall ?? baseReport?.metrics?.recall ?? null,
      f1: score?.f1 ?? baseReport?.f1 ?? baseReport?.metrics?.f1 ?? null,
      accuracy: score?.accuracy ?? baseReport?.accuracy ?? baseReport?.metrics?.accuracy ?? null,
      balanced_accuracy: score?.balanced_accuracy ?? baseReport?.balanced_accuracy ?? baseReport?.metrics?.balanced_accuracy ?? null,
      specificity: score?.specificity ?? baseReport?.specificity ?? baseReport?.metrics?.specificity ?? null,
    };
    const nextPayload = {
      ...baseReport,
      job_id: activeJobId,
      selected_threshold: selected,
      locked_threshold: selected,
      configured_threshold: selected,
      recommended_threshold: baseReport?.optimal_threshold ?? null,
      suppression_rate_pct: score?.suppression_rate_pct ?? baseReport?.suppression_rate_pct ?? null,
      event_loss_pct: score?.event_loss_pct ?? baseReport?.event_loss_pct ?? null,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      accuracy: metrics.accuracy,
      balanced_accuracy: metrics.balanced_accuracy,
      specificity: metrics.specificity,
      confusion_matrix: score?.confusion_matrix || baseReport?.confusion_matrix || [[0, 0], [0, 0]],
      metrics,
    };
    const nextSignature = JSON.stringify({
      job_id: nextPayload.job_id || '',
      selected_threshold: nextPayload.selected_threshold ?? null,
      optimal_threshold: nextPayload.optimal_threshold ?? nextPayload.metrics?.optimal_threshold ?? null,
      report_id: nextPayload.report_id || nextPayload.validation_id || '',
      suppression_rate_pct: nextPayload.suppression_rate_pct ?? null,
      event_loss_pct: nextPayload.event_loss_pct ?? null,
      precision: nextPayload.metrics?.precision ?? null,
      recall: nextPayload.metrics?.recall ?? null,
      f1: nextPayload.metrics?.f1 ?? null,
      accuracy: nextPayload.metrics?.accuracy ?? null,
      balanced_accuracy: nextPayload.metrics?.balanced_accuracy ?? null,
      specificity: nextPayload.metrics?.specificity ?? null,
      confusion_matrix: nextPayload.confusion_matrix || [[0, 0], [0, 0]],
    });
    if (publishedSignatureRef.current === nextSignature) return;
    publishedSignatureRef.current = nextSignature;
    onValidationComplete?.(nextPayload);
  }, [activeJobId, onValidationComplete, selectedThreshold]);

  useEffect(() => {
    if (!activeJobId) {
      setReport(null);
      setSelectedScore(null);
      setFallbackNotice(null);
      return;
    }
    if (String(report?.job_id || '') === String(activeJobId || '')) return;
    const restoredReport = buildSavedReport(activeJobId);
    if (!restoredReport) {
      const limitedReport = buildLimitedReport(activeJobId);
      if (!limitedReport) {
        setReport(null);
        setSelectedScore(null);
        setSelectedThreshold(Number(
          activeRun?.selected_threshold
            ?? activeRun?.threshold
            ?? activeRun?.metrics?.optimal_threshold
            ?? 0.5,
        ));
        setFallbackNotice(null);
        return;
      }
      setReport(limitedReport);
      setSelectedThreshold(Number(limitedReport.selected_threshold ?? 0.5));
      setSelectedScore(buildScoreFromRow(null, limitedReport.selected_threshold));
      setFallbackNotice('Restored the saved threshold for this run. Detailed validation curves are unavailable until a full validation report is regenerated.');
      setError(null);
      publishValidationState(limitedReport, buildScoreFromRow(null, limitedReport.selected_threshold), limitedReport.selected_threshold);
      return;
    }
    const restoredThreshold = Number(
      restoredReport.selected_threshold
        ?? restoredReport.locked_threshold
        ?? restoredReport.configured_threshold
        ?? restoredReport.optimal_threshold
        ?? 0.5,
    );
    const restoredRow = closestThresholdRow(restoredReport.threshold_table, restoredThreshold) || restoredReport.threshold_table?.[0] || null;
    const restoredScore = buildScoreFromRow(restoredRow, restoredThreshold);
    setReport(restoredReport);
    setSelectedThreshold(restoredThreshold);
    setSelectedScore(restoredScore);
    setFallbackNotice('Restored the saved validation report for this run.');
    setError(null);
    publishValidationState(restoredReport, restoredScore, restoredThreshold);
  }, [activeJobId, activeRun?.metrics?.optimal_threshold, activeRun?.selected_threshold, activeRun?.threshold, buildLimitedReport, buildSavedReport, publishValidationState, report?.job_id]);

  const runValidation = async () => {
    if (!activeJobId) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoadingReport(true);
    setError(null);
    setFallbackNotice(null);
    try {
      const res = await mlopsApi.validationReport({
        job_id: activeJobId,
        max_event_loss_pct: Number(maxEventLoss) || 5,
        optimization_mode: optimizationMode,
        target_suppression_pct: optimizationMode === 'target_suppression' ? Number(targetSuppression) : undefined,
      });
      const data = unwrap(res);
      const table = data?.threshold_table || [];
      const optimalThr = Number(data?.optimal_threshold ?? 0.5);
      const optimalRow = table.find((row) => Math.abs(Number(row.threshold ?? 0) - optimalThr) < 1e-6) || table[0];
      const cm = optimalRow
        ? [[Number(optimalRow.tn ?? 0), Number(optimalRow.fp ?? 0)], [Number(optimalRow.fn ?? 0), Number(optimalRow.tp ?? 0)]]
        : [[0, 0], [0, 0]];
      setReport(data);
      setSelectedThreshold(optimalThr);
      setSelectedScore({
        threshold: optimalThr,
        confusion_matrix: cm,
        suppression_rate_pct: Number(optimalRow?.suppression_rate_pct ?? 0),
        event_loss_pct: Number(optimalRow?.event_loss_pct ?? 0),
        precision: Number(optimalRow?.precision ?? 0),
        recall: Number(optimalRow?.recall ?? 0),
        f1: Number(optimalRow?.f1 ?? 0),
        specificity: Number(optimalRow?.specificity ?? 0),
        accuracy: Number(optimalRow?.accuracy ?? 0),
        balanced_accuracy: Number(optimalRow?.balanced_accuracy ?? 0),
      });
      const nextReport = {
        ...data,
        job_id: activeJobId,
        selected_threshold: optimalThr,
        locked_threshold: optimalThr,
        configured_threshold: optimalThr,
        algorithm: (runs || []).find((run) => String(run?.job_id || '') === String(activeJobId || ''))?.algorithm,
      };
      publishValidationState(nextReport, {
        threshold: optimalThr,
        confusion_matrix: cm,
        suppression_rate_pct: Number(optimalRow?.suppression_rate_pct ?? 0),
        event_loss_pct: Number(optimalRow?.event_loss_pct ?? 0),
        precision: Number(optimalRow?.precision ?? 0),
        recall: Number(optimalRow?.recall ?? 0),
        f1: Number(optimalRow?.f1 ?? 0),
        specificity: Number(optimalRow?.specificity ?? 0),
        accuracy: Number(optimalRow?.accuracy ?? 0),
        balanced_accuracy: Number(optimalRow?.balanced_accuracy ?? 0),
      }, optimalThr);
      setReport(nextReport);
    } catch (runError) {
      const restoredReport = buildSavedReport(activeJobId);
      if (restoredReport) {
        const restoredThreshold = Number(
          restoredReport.selected_threshold
            ?? restoredReport.locked_threshold
            ?? restoredReport.configured_threshold
            ?? restoredReport.optimal_threshold
            ?? 0.5,
        );
        const restoredRow = closestThresholdRow(restoredReport.threshold_table, restoredThreshold) || restoredReport.threshold_table?.[0] || null;
        const restoredScore = buildScoreFromRow(restoredRow, restoredThreshold);
        setReport(restoredReport);
        setSelectedThreshold(restoredThreshold);
        setSelectedScore(restoredScore);
        setFallbackNotice('Restored the saved validation report because live regeneration is unavailable for this run.');
        publishValidationState(restoredReport, restoredScore, restoredThreshold);
        return;
      }
      try {
        const detailRes = await mlopsApi.validationDetail(activeJobId);
        const detail = unwrap(detailRes);
        const limitedReport = buildLimitedReport(activeJobId, detail);
        if (limitedReport) {
          const limitedScore = buildScoreFromRow(null, limitedReport.selected_threshold);
          setReport(limitedReport);
          setSelectedThreshold(Number(limitedReport.selected_threshold ?? 0.5));
          setSelectedScore(limitedScore);
          setFallbackNotice('Restored the saved threshold and model context for this run. Full threshold analytics are unavailable because the historical holdout scores were not persisted.');
          publishValidationState(limitedReport, limitedScore, limitedReport.selected_threshold);
          return;
        }
      } catch {
        // Fall through to the original error below.
      }
      setError(runError?.response?.data?.error || 'Failed to generate validation report');
    } finally {
      setLoadingReport(false);
    }
  };

  const applyThreshold = useCallback(async (thresholdValue = selectedThreshold) => {
    if (!activeJobId) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoadingThreshold(true);
    setError(null);
    setFallbackNotice(null);
    try {
      const res = await mlopsApi.thresholdScore({
        job_id: activeJobId,
        threshold: Number(thresholdValue),
      });
      const data = unwrap(res);
      setSelectedThreshold(Number(data?.threshold ?? thresholdValue));
      setSelectedScore({
        threshold: Number(data?.threshold ?? thresholdValue),
        confusion_matrix: data?.confusion_matrix || [[0, 0], [0, 0]],
        suppression_rate_pct: Number(data?.suppression_rate_pct ?? 0),
        event_loss_pct: Number(data?.event_loss_pct ?? 0),
        precision: Number(data?.precision ?? 0),
        recall: Number(data?.recall ?? 0),
        f1: Number(data?.f1 ?? 0),
        specificity: Number(data?.specificity ?? 0),
        accuracy: Number(data?.accuracy ?? 0),
        balanced_accuracy: Number(data?.balanced_accuracy ?? 0),
      });
      publishValidationState(report, {
        threshold: Number(data?.threshold ?? thresholdValue),
        confusion_matrix: data?.confusion_matrix || [[0, 0], [0, 0]],
        suppression_rate_pct: Number(data?.suppression_rate_pct ?? 0),
        event_loss_pct: Number(data?.event_loss_pct ?? 0),
        precision: Number(data?.precision ?? 0),
        recall: Number(data?.recall ?? 0),
        f1: Number(data?.f1 ?? 0),
        specificity: Number(data?.specificity ?? 0),
        accuracy: Number(data?.accuracy ?? 0),
        balanced_accuracy: Number(data?.balanced_accuracy ?? 0),
      }, Number(data?.threshold ?? thresholdValue));
    } catch (thresholdError) {
      if (Array.isArray(report?.threshold_table) && report.threshold_table.length) {
        const fallbackRow = closestThresholdRow(report.threshold_table, thresholdValue);
        const fallbackScore = buildScoreFromRow(fallbackRow, thresholdValue);
        const fallbackThreshold = Number(fallbackScore?.threshold ?? thresholdValue ?? selectedThreshold ?? 0.5);
        setSelectedThreshold(fallbackThreshold);
        setSelectedScore(fallbackScore);
        setFallbackNotice('Applied the selected threshold from the saved validation table because live rescoring is unavailable for this run.');
        publishValidationState(report, fallbackScore, fallbackThreshold);
        return;
      }
      setError(thresholdError?.response?.data?.error || 'Failed to score threshold');
    } finally {
      setLoadingThreshold(false);
    }
  }, [actionsDisabled, activeJobId, gatingMessage, publishValidationState, report, selectedThreshold]);

  const recommended = useMemo(() => {
    if (!report) return null;
    const table = report.threshold_table || [];
    const optimalThr = Number(report?.optimal_threshold ?? 0.5);
    const optimalRow = table.find((row) => Math.abs(Number(row.threshold ?? 0) - optimalThr) < 1e-6) || table[0];
    const cm = optimalRow
      ? [[Number(optimalRow.tn ?? 0), Number(optimalRow.fp ?? 0)], [Number(optimalRow.fn ?? 0), Number(optimalRow.tp ?? 0)]]
      : [[0, 0], [0, 0]];
    return {
      threshold: optimalThr,
      confusion_matrix: cm,
      suppression_rate_pct: Number(optimalRow?.suppression_rate_pct ?? 0),
      event_loss_pct: Number(optimalRow?.event_loss_pct ?? 0),
      precision: Number(optimalRow?.precision ?? 0),
      recall: Number(optimalRow?.recall ?? 0),
      f1: Number(optimalRow?.f1 ?? 0),
      specificity: Number(optimalRow?.specificity ?? 0),
      accuracy: Number(optimalRow?.accuracy ?? 0),
    };
  }, [report]);

  const useRecommended = () => {
    if (!recommended) return;
    setSelectedThreshold(recommended.threshold);
    setSelectedScore(recommended);
    publishValidationState(report, recommended, recommended.threshold);
  };

  const active = selectedScore || recommended;
  const suppressionDelta = active && recommended
    ? safeNumber(active.suppression_rate_pct) - safeNumber(recommended.suppression_rate_pct)
    : 0;
  const eventLossDelta = active && recommended
    ? safeNumber(active.event_loss_pct) - safeNumber(recommended.event_loss_pct)
    : 0;
  const precisionDelta = active && recommended
    ? safeNumber(active.precision) - safeNumber(recommended.precision)
    : 0;
  const recallDelta = active && recommended
    ? safeNumber(active.recall) - safeNumber(recommended.recall)
    : 0;
  const activeHoldoutRows = Number.isFinite(validationContext.testRows)
    ? validationContext.testRows
    : totalFromConfusionMatrix(active?.confusion_matrix || report?.confusion_matrix);
  const activeTrainRows = Number.isFinite(validationContext.trainRows) ? validationContext.trainRows : null;

  return (
    <Stack spacing={2.5}>
      {!activeJobId && (!Array.isArray(runs) || runs.length === 0) && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          No trained model runs found. Complete Stage 6 to enable threshold tuning.
        </Alert>
      )}

      <SectionCard>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }} justifyContent="space-between">
          <SectionTitle
            icon={<Tune sx={{ fontSize: 18, color: V.orange }} />}
            title="Threshold tuning"
            subtitle="Tune suppression and event-loss tradeoffs on the actual validation holdout."
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Select
              size="small"
              value={activeJobId}
              onChange={(event) => setActiveJobId(event.target.value)}
              sx={{ minWidth: 220, fontSize: 12 }}
            >
              {(runs || []).map((run) => (
                <MenuItem key={run.job_id} value={run.job_id}>
                  {normalizeLabel(run)} - {run.algorithm_display || run.algorithm}
                </MenuItem>
              ))}
            </Select>
            <TextField
              size="small"
              type="number"
              label="Max event loss %"
              value={maxEventLoss}
              onChange={(event) => setMaxEventLoss(event.target.value)}
              sx={{ width: 160 }}
              inputProps={{ min: 0, max: 50, step: 0.5 }}
            />
            <Select
              size="small"
              value={optimizationMode}
              onChange={(event) => setOptimizationMode(event.target.value)}
              sx={{ minWidth: 240, fontSize: 12 }}
            >
              <MenuItem value="max_suppression_under_event_loss">
                Max suppression under event-loss limit
              </MenuItem>
              <MenuItem value="target_suppression">
                Target suppression under event-loss limit
              </MenuItem>
            </Select>
            {optimizationMode === 'target_suppression' && (
              <TextField
                size="small"
                type="number"
                label="Target suppression %"
                value={targetSuppression}
                onChange={(event) => setTargetSuppression(event.target.value)}
                sx={{ width: 180 }}
                inputProps={{ min: 0, max: 100, step: 1 }}
              />
            )}
            <Button
              variant="contained"
              onClick={runValidation}
              disabled={actionsDisabled || !activeJobId || loadingReport}
              sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
            >
              {loadingReport ? 'Running...' : 'Run validation'}
            </Button>
          </Stack>
        </Stack>
      </SectionCard>

      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      {fallbackNotice && <Alert severity="info" sx={{ borderRadius: 2 }}>{fallbackNotice}</Alert>}
      {actionsDisabled && <Alert severity="warning" sx={{ borderRadius: 2 }}>{gatingMessage}</Alert>}

      {report && (
        <>
          {!report.constraint_satisfied && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              No threshold satisfies Event Loss {'<='} {num(report.max_event_loss_pct, 2)}%. Recommendation falls back to the closest operating point.
            </Alert>
          )}

          <SectionCard>
            <Stack spacing={1.5}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ lg: 'flex-start' }}>
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: V.orange, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Validation set
                  </Typography>
                  <Typography sx={{ fontSize: 22, fontWeight: 800, color: V.text, mt: 0.35 }}>
                    {formatSplitLabel(validationContext)}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: V.textMuted, mt: 0.6, lineHeight: 1.7 }}>
                    {validationContext.splitStrategy === 'temporal'
                      ? `${validationContext.dateColumn || 'Date'}${validationContext.splitDate ? ` @ ${validationContext.splitDate}` : ''}`
                      : 'Threshold tuning is being evaluated on the saved validation holdout for this run.'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <MetricChip label={activeRun?.job_id ? normalizeLabel(activeRun) : 'Selected run'} tone="default" />
                  {activeRun?.algorithm && <MetricChip label={activeRun.algorithm_display || activeRun.algorithm} tone="default" />}
                  {validationContext.targetColumn && <MetricChip label={`Target ${validationContext.targetColumn}`} tone="default" />}
                  {validationContext.grain && <MetricChip label={`${validationContext.grain} grain`} tone="default" />}
                </Stack>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gap: 1.2,
                  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                <StatCard label="Validation Rows" value={activeHoldoutRows ? activeHoldoutRows.toLocaleString() : '-'} sub="Holdout rows used for scoring" />
                <StatCard label="Train Rows" value={activeTrainRows ? activeTrainRows.toLocaleString() : '-'} sub="Rows used to fit the model" />
                <StatCard label="Recommended Threshold" value={num(report.optimal_threshold, 2)} tone="good" sub="Best operating point under the active constraint" />
                <StatCard
                  label="Holdout Event Rate"
                  value={validationContext.testEventRatePct != null ? pct(validationContext.testEventRatePct, 1) : '-'}
                  sub="Positive class rate in the validation set"
                />
              </Box>

              {report.selection_note && (
                <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
                  {report.selection_note}
                </Typography>
              )}
            </Stack>
          </SectionCard>

          <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
            <StatCard label="Expected Suppression" value={pct(report.suppression_rate_pct, 2)} tone="good" />
            <StatCard
              label="Expected Event Loss"
              value={pct(report.event_loss_pct, 2)}
              tone={(report.event_loss_pct ?? 0) <= (Number(maxEventLoss) || 5) ? 'good' : 'bad'}
            />
            <StatCard label="Precision" value={fmt(report.precision, 4)} />
            <StatCard label="Recall" value={fmt(report.recall, 4)} />
            <StatCard label="F1" value={fmt(report.f1, 4)} />
            <StatCard label="Specificity" value={fmt(report.specificity, 4)} />
          </Stack>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.08fr 0.92fr' } }}>
            <SectionCard>
              <SectionTitle
                icon={<Tune sx={{ fontSize: 18, color: V.orange }} />}
                title="Suppression vs event loss"
                subtitle="The main trade-off curve, with the cap and recommended threshold highlighted."
              />
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                    <XAxis
                      dataKey="threshold"
                      type="number"
                      domain={[minThr, maxThr]}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => num(value, 2)}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value) => num(value, 0)} />
                    <Tooltip formatter={(value) => `${num(value, 2)}%`} labelFormatter={(value) => `Threshold ${num(value, 2)}`} />
                    <Legend />
                    <ReferenceLine
                      y={Number(report.max_event_loss_pct ?? maxEventLoss)}
                      stroke={V.bad}
                      strokeDasharray="4 4"
                      label={{
                        value: `Max loss ${num(report.max_event_loss_pct ?? maxEventLoss, 1)}%`,
                        fill: V.bad,
                        fontSize: 11,
                        position: 'insideBottomRight',
                      }}
                    />
                    <ReferenceLine
                      x={Number(report.optimal_threshold ?? 0.5)}
                      stroke={V.orange}
                      strokeDasharray="6 4"
                      label={{
                        value: `Recommended ${num(report.optimal_threshold, 2)}`,
                        fill: V.orange,
                        fontSize: 11,
                        position: 'insideTopLeft',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="suppression"
                      stroke={V.navy}
                      strokeWidth={2.35}
                      dot={false}
                      name="Suppression %"
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="eventLoss"
                      stroke={V.orange}
                      strokeWidth={2.35}
                      dot={false}
                      name="Event loss %"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                emptyPanel('Threshold trade-off unavailable', 'Run validation to generate the threshold table and draw the trade-off curve.')
              )}
            </SectionCard>

            <SectionCard>
              <SectionTitle
                icon={<Tune sx={{ fontSize: 18, color: V.orange }} />}
                title="Threshold explorer"
                subtitle="Move off the recommendation and instantly see the operational impact."
              />
              <Stack spacing={1.4}>
                <Box sx={{ px: 1.2 }}>
                  <Slider
                    min={minThr}
                    max={maxThr}
                    step={sliderStep}
                    value={Number(selectedThreshold)}
                    onChange={(_, value) => setSelectedThreshold(Array.isArray(value) ? value[0] : value)}
                    valueLabelDisplay="auto"
                    sx={{ color: V.orange }}
                  />
                </Box>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.1} alignItems={{ md: 'center' }}>
                  <TextField
                    size="small"
                    type="number"
                    label="Selected threshold"
                    value={num(selectedThreshold, 2)}
                    onChange={(event) => setSelectedThreshold(Number(event.target.value || 0.5))}
                    inputProps={{ min: minThr, max: maxThr, step: sliderStep }}
                    sx={{ width: 180 }}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => applyThreshold(selectedThreshold)}
                    disabled={actionsDisabled || loadingThreshold}
                    sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
                  >
                    {loadingThreshold ? 'Applying...' : 'Apply threshold'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={useRecommended}
                    disabled={actionsDisabled}
                    sx={{ textTransform: 'none', fontWeight: 700, borderColor: V.border, color: V.textMuted }}
                  >
                    Use recommended
                  </Button>
                </Stack>
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                  The last applied threshold becomes the locked validation threshold that carries forward into Model Release.
                </Alert>

                {active && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <MetricChip label={`Threshold ${num(active.threshold, 2)}`} tone="default" />
                    <MetricChip label={`Suppression ${pct(active.suppression_rate_pct, 2)}`} tone="good" />
                    <MetricChip label={`Event loss ${pct(active.event_loss_pct, 2)}`} tone={active.event_loss_pct <= (Number(maxEventLoss) || 5) ? 'good' : 'warn'} />
                  </Stack>
                )}

                {active && (
                  <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
                    <StatCard label="Active Suppression" value={pct(active.suppression_rate_pct, 2)} sub="vs recommended" tone="good" />
                    <DeltaPill value={suppressionDelta} />
                    <StatCard
                      label="Active Event Loss"
                      value={pct(active.event_loss_pct, 2)}
                      sub="vs recommended"
                      tone={active.event_loss_pct <= (Number(maxEventLoss) || 5) ? 'good' : 'bad'}
                    />
                    <DeltaPill value={eventLossDelta} />
                    <StatCard label="Active Precision" value={fmt(active.precision, 4)} sub="vs recommended" />
                    <DeltaPill value={precisionDelta} />
                    <StatCard label="Active Recall" value={fmt(active.recall, 4)} sub="vs recommended" />
                    <DeltaPill value={recallDelta} />
                  </Stack>
                )}

                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                      <XAxis
                        dataKey="threshold"
                        type="number"
                        domain={[minThr, maxThr]}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(value) => num(value, 2)}
                      />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(value) => num(value, 2)} />
                      <Tooltip formatter={(value) => num(value, 3)} labelFormatter={(value) => `Threshold ${num(value, 2)}`} />
                      <Legend />
                      <ReferenceLine x={Number(active?.threshold ?? selectedThreshold)} stroke={V.orange} strokeDasharray="5 4" />
                      <Line type="monotone" dataKey="precision" stroke={V.navy} strokeWidth={2.1} dot={false} name="Precision" isAnimationActive={false} />
                      <Line type="monotone" dataKey="recall" stroke={V.green} strokeWidth={2.1} dot={false} name="Recall" isAnimationActive={false} />
                      <Line type="monotone" dataKey="f1" stroke={V.purple} strokeWidth={2.1} dot={false} name="F1" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : null}
              </Stack>
            </SectionCard>
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <SectionCard>
              <SectionTitle title="Business outcome view at recommended threshold" subtitle="Read this as what happened to alerts in the validation set, not as raw TP/TN codes." />
              <ConfusionMatrixGrid
                cm={report.confusion_matrix}
                business
                title="Each box below explains whether the alert was actually low risk or suspicious, and whether the model set it aside or escalated it."
              />
            </SectionCard>
            <SectionCard>
              <SectionTitle title="Business outcome view at active threshold" subtitle="Updated instantly when you rescore another threshold." />
              <ConfusionMatrixGrid
                cm={active?.confusion_matrix || report.confusion_matrix}
                business
                title="This shows how the currently selected cut-off changes the balance between safe suppression, extra review, and missed suspicious cases."
              />
            </SectionCard>
          </Box>

          <SectionCard>
            <SectionTitle title="Threshold metrics table" subtitle="Every candidate threshold and its validation-set impact." />
            <Box sx={{ overflow: 'auto', maxHeight: 440 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Threshold', 'Supp %', 'Event Loss %', 'Precision', 'Recall', 'F1', 'Specificity', 'TP', 'FP', 'FN', 'TN', 'Action'].map((header) => (
                      <TableHeader key={header} text={header} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(report.threshold_table || []).map((row) => {
                    const rowThreshold = Number(row.threshold ?? 0);
                    const isRecommended = Math.abs(rowThreshold - Number(report.optimal_threshold ?? 0.5)) < 0.0001;
                    const isActive = Math.abs(rowThreshold - Number(active?.threshold ?? report.optimal_threshold ?? 0.5)) < 0.0001;
                    return (
                      <tr
                        key={`thr-${rowThreshold}`}
                        style={{
                          background: isActive ? '#FFF7ED' : isRecommended ? '#ECFDF3' : 'transparent',
                          borderBottom: `1px solid ${V.border}`,
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelectedThreshold(rowThreshold)}
                      >
                        <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: isRecommended ? 800 : 500 }}>{num(rowThreshold, 2)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{num(row.suppression_rate_pct ?? row.suppression_rate ?? 0, 2)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: (row.event_loss_pct ?? 0) <= (Number(maxEventLoss) || 5) ? V.good : V.bad }}>
                          {num(row.event_loss_pct ?? 0, 2)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.precision ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.recall ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.f1 ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.specificity ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.tp ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.fp ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.fn ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.tn ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                          <Button
                            size="small"
                            variant="text"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedThreshold(rowThreshold);
                              applyThreshold(rowThreshold);
                            }}
                            disabled={actionsDisabled}
                            sx={{ textTransform: 'none', minWidth: 64, fontSize: 11, color: V.orange }}
                          >
                            Apply
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
          </SectionCard>
        </>
      )}

      {!report && !loadingReport && (
        emptyPanel(
          'Validation report not generated yet',
          'Select a trained model run, set the event-loss constraint, and click Run validation to populate the threshold dashboard.',
        )
      )}
    </Stack>
  );
};

export default ThresholdTuningTab;
