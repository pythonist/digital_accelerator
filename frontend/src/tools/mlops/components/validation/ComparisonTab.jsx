import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoAwesome,
  Close,
  CompareArrows,
  HubOutlined,
  Insights,
  Refresh,
  ShowChart,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
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
import mlopsApi from '../../services/mlopsApi';
import { V, chartColorForIndex } from './validationTheme';
import {
  buildCurveGrid,
  fmt,
  formatSplitLabel,
  getCurvePoints,
  getFeatureImportanceRows,
  getValidationContext,
  normalizeLabel,
  num,
  pct,
  unwrap,
} from './validationUtils';
import { ConfusionMatrixGrid, MetricChip, SectionCard, SectionTitle, TableHeader } from './ValidationShared';

const metricGroups = [
  {
    label: 'Discrimination',
    metrics: [
      { key: 'roc_auc', label: 'ROC-AUC' },
      { key: 'average_precision', label: 'PR-AUC' },
      { key: 'gini', label: 'Gini' },
    ],
  },
  {
    label: 'Classification',
    metrics: [
      { key: 'precision', label: 'Precision' },
      { key: 'recall', label: 'Recall' },
      { key: 'f1', label: 'F1' },
      { key: 'accuracy', label: 'Accuracy' },
      { key: 'balanced_accuracy', label: 'Balanced Acc' },
      { key: 'specificity', label: 'Specificity' },
    ],
  },
  {
    label: 'CV',
    metrics: [
      { key: 'cv_auc_mean', label: 'CV AUC' },
      { key: 'cv_auc_std', label: 'CV AUC Std' },
    ],
  },
  {
    label: 'Operational',
    metrics: [
      { key: 'optimal_threshold', label: 'Opt Thresh' },
      { key: 'suppression_rate_pct', label: 'Suppression %' },
      { key: 'event_loss_pct', label: 'Event Loss %' },
    ],
  },
];

const sectionMeta = [
  ['what_this_says', 'What this says'],
  ['why_it_matters', 'Why this matters'],
  ['how_it_helps_model_building', 'How this helps'],
  ['recommended_action', 'Recommended action'],
  ['watch_out', 'Watch out'],
];

const emptyChart = (title, body, minHeight = 260) => (
  <Stack
    spacing={0.75}
    alignItems="center"
    justifyContent="center"
    sx={{
      minHeight,
      border: `1px dashed ${V.border}`,
      borderRadius: 0,
      bgcolor: V.panelAlt,
      px: 2,
      textAlign: 'center',
    }}
  >
    <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{title}</Typography>
    <Typography sx={{ fontSize: 11.5, color: V.textMuted, maxWidth: 380 }}>{body}</Typography>
  </Stack>
);

const metricTile = (label, value, helper) => (
  <Box key={label}>
    <Typography sx={{ fontSize: 10, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 16, fontWeight: 800, color: V.text, mt: 0.25 }}>
      {value}
    </Typography>
    <Typography sx={{ fontSize: 10.5, color: V.textMuted, mt: 0.15 }}>
      {helper}
    </Typography>
  </Box>
);

const buildFeatureFallback = ({ model, feature, featureRows }) => {
  const topPeers = featureRows
    .slice(0, 5)
    .map((row) => `${row.feature_display} (${pct(row.contribution_pct, 1)})`)
    .join(', ');
  return {
    analysis_source: 'deterministic',
    llm_available: false,
    chart_title: `${feature.feature_display} importance`,
    facts: [
      `${feature.feature_display} is ranked #${feature.rank} for ${normalizeLabel(model)} with importance ${num(feature.importance, 4)}.`,
      `${feature.feature_display} contributes ${pct(feature.contribution_pct, 1)} of the visible top-feature signal.`,
      `${normalizeLabel(model)} uses ${model.algorithm_display || model.algorithm || 'the selected algorithm'} on the validation holdout.`,
      `Top peer features are ${topPeers || 'not available'}.`,
      'Feature importance shows which inputs moved the model score most strongly, not necessarily causation.',
    ],
    sections: {
      what_this_says: `${feature.feature_display} is one of the strongest signals the model relied on when separating low-risk alerts from suspicious cases.`,
      why_it_matters: 'A feature that ranks near the top is materially influencing who gets escalated versus set aside on the validation holdout.',
      how_it_helps_model_building: 'Use this to judge whether the model is leaning on sensible AML signals, proxies you can defend, or fields that need challenge and controls.',
      recommended_action: 'Review the top features with analysts and model risk, then confirm the direction and stability of the signal before production use.',
      watch_out: 'High importance does not prove business causality. It only shows the model found this field useful for ranking cases in the holdout sample.',
    },
  };
};

const buildModelOutcomeSummary = ({ model, detail, context, featureRows }) => {
  const cm = detail?.confusion_matrix || model?.confusion_matrix || model?.metrics?.confusion_matrix || [[0, 0], [0, 0]];
  const tn = Number(cm?.[0]?.[0] ?? 0);
  const fp = Number(cm?.[0]?.[1] ?? 0);
  const fn = Number(cm?.[1]?.[0] ?? 0);
  const tp = Number(cm?.[1]?.[1] ?? 0);
  const suppression = pct(model?.suppression_rate_pct ?? model?.metrics?.suppression_rate_pct, 2);
  const eventLoss = pct(model?.event_loss_pct ?? model?.metrics?.event_loss_pct, 2);
  const splitLabel = formatSplitLabel(context);
  const topFeature = featureRows?.[0]?.feature_display;
  return [
    `${normalizeLabel(model)} was judged on a ${splitLabel.toLowerCase()} of ${Number.isFinite(context?.testRows) ? context.testRows.toLocaleString() : 'the saved'} validation rows.`,
    `${tp.toLocaleString()} suspicious cases were kept visible for investigators, while ${tn.toLocaleString()} lower-value alerts were safely set aside.`,
    `${fp.toLocaleString()} alerts still went to review unnecessarily and ${fn.toLocaleString()} suspicious cases were missed at the active cut-off.`,
    `At this operating point the model suppresses ${suppression} of the holdout queue with ${eventLoss} event loss.`,
    topFeature ? `${topFeature} is the strongest visible feature signal behind this ranking.` : 'Feature importance is not available for this run yet.',
  ];
};

const FeatureExplainDialog = ({
  open,
  onClose,
  featureSelection,
  loading,
  analysis,
  notice,
  onRefresh,
}) => {
  const feature = featureSelection?.feature;
  const model = featureSelection?.model;
  if (!feature || !model) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          width: 'min(1180px, calc(100vw - 48px))',
          maxWidth: '1180px',
          borderRadius: 0,
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: `1px solid ${V.border}`, pr: 1.25 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: V.text }}>
              {feature.feature_display}
            </Typography>
            <Typography sx={{ fontSize: 12, color: V.textMuted, mt: 0.25 }}>
              Why this feature mattered for {normalizeLabel(model)}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ border: `1px solid ${V.border}`, borderRadius: 0 }}>
            <Close sx={{ fontSize: 16, color: V.textMuted }} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: 2.25, overflowY: 'auto' }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 0.95fr) minmax(320px, 1.05fr)' } }}>
          <Paper variant="outlined" sx={{ borderRadius: 0, p: 1.75, borderColor: V.border, bgcolor: V.panelAlt }}>
            <Stack spacing={1.1}>
              <Typography sx={{ fontSize: 11, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Grounded facts
              </Typography>
              <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: V.text }}>
                {feature.feature_display}
              </Typography>
              <Typography sx={{ fontSize: 12, color: V.textMuted }}>
                Rank #{feature.rank} with importance {num(feature.importance, 4)} and visible top-feature share of {pct(feature.contribution_pct, 1)}.
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <MetricChip label={normalizeLabel(model)} tone="default" />
                <MetricChip label={model.algorithm_display || model.algorithm || 'Model'} tone="default" />
                <MetricChip label={`Rank ${feature.rank}`} tone="default" />
              </Stack>
              <Typography sx={{ fontSize: 11.25, color: V.textMuted, lineHeight: 1.7 }}>
                Feature importance measures how strongly this field influenced the model score during validation. It does not prove the feature caused suspicious behavior; it shows the model leaned on this field while ranking alerts.
              </Typography>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 0, p: 0, borderColor: V.border, overflow: 'hidden' }}>
            <Box sx={{ px: 1.5, py: 1.35, borderBottom: `1px solid ${V.border}`, bgcolor: V.panelAlt }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>
                    Feature explanation
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: V.textMuted, mt: 0.25 }}>
                    Uses grounded facts first, then upgrades with the configured local LLM when available.
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="text"
                  startIcon={loading ? <CircularProgress size={12} sx={{ color: V.orange }} /> : <Refresh sx={{ fontSize: 14 }} />}
                  onClick={onRefresh}
                  disabled={loading}
                  sx={{ textTransform: 'none', fontSize: 11, color: V.orange, minWidth: 0 }}
                >
                  Refresh
                </Button>
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap' }} useFlexGap>
                <Chip
                  size="small"
                  label={analysis?.analysis_source === 'ai' ? 'AI explanation' : 'Grounded explanation'}
                  sx={{ fontSize: 10, height: 22, bgcolor: V.accentSoft, color: V.text }}
                />
                {analysis?.provider ? <Chip size="small" label={`Provider: ${analysis.provider}`} sx={{ fontSize: 10, height: 22 }} /> : null}
                {analysis?.model ? <Chip size="small" label={`Model: ${analysis.model}`} sx={{ fontSize: 10, height: 22 }} /> : null}
              </Stack>
            </Box>
            <Box sx={{ px: 1.5, py: 1.35 }}>
              {notice ? (
                <Alert severity="info" sx={{ mb: 1.25, borderRadius: 0 }}>
                  {notice}
                </Alert>
              ) : null}
              {loading && !analysis ? (
                <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                  <CircularProgress size={22} sx={{ color: V.orange }} />
                </Stack>
              ) : (
                <Stack spacing={1.15}>
                  {sectionMeta.map(([key, label]) => (
                    analysis?.sections?.[key] ? (
                      <Box key={key} sx={{ pb: 1.05, borderBottom: key === 'watch_out' ? 'none' : `1px solid ${V.border}` }}>
                        <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.65, textTransform: 'uppercase', color: V.textMuted, mb: 0.4 }}>
                          {label}
                        </Typography>
                        <Typography sx={{ fontSize: 11.5, color: V.text, lineHeight: 1.7 }}>
                          {analysis.sections[key]}
                        </Typography>
                      </Box>
                    ) : null
                  ))}
                </Stack>
              )}
            </Box>
          </Paper>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

const ComparisonTab = ({
  runs,
  selectedJobIds,
  onSelectJobIds,
  compareData,
  loading,
  onCompare,
  onPromoteChampion,
  onArchive,
  onBulkLabel,
  actionsDisabled = false,
}) => {
  const [labelDrafts, setLabelDrafts] = useState({});
  const [detailByJobId, setDetailByJobId] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [featureSelection, setFeatureSelection] = useState(null);
  const [featureAnalysis, setFeatureAnalysis] = useState(null);
  const [featureAnalysisLoading, setFeatureAnalysisLoading] = useState(false);
  const [featureAnalysisNotice, setFeatureAnalysisNotice] = useState('');

  const modelMap = useMemo(() => {
    const next = {};
    (runs || []).forEach((run) => {
      next[run.job_id] = run;
    });
    return next;
  }, [runs]);

  const modelBadgeLabel = useCallback((jobId) => {
    const run = modelMap[jobId];
    const baseLabel = normalizeLabel(run);
    const shortId = String(jobId || '').slice(0, 8);
    return shortId ? `${baseLabel} - ${shortId}` : baseLabel;
  }, [modelMap]);

  const comparisonModels = useMemo(() => {
    const order = new Map((selectedJobIds || []).map((jobId, idx) => [String(jobId), idx]));
    return [...(compareData || [])].sort(
      (left, right) => (order.get(String(left?.job_id || '')) ?? 999) - (order.get(String(right?.job_id || '')) ?? 999),
    );
  }, [compareData, selectedJobIds]);

  const rocGrid = useMemo(
    () => buildCurveGrid(comparisonModels, 'roc_curve', 'fpr', 'tpr', 0.01),
    [comparisonModels],
  );
  const prGrid = useMemo(
    () => buildCurveGrid(comparisonModels, 'pr_curve', 'recall', 'precision', 0.01),
    [comparisonModels],
  );

  useEffect(() => {
    const missingModels = comparisonModels.filter((model) => (
      model?.job_id
      && !Object.prototype.hasOwnProperty.call(detailByJobId, model.job_id)
      && !detailLoading[model.job_id]
    ));
    if (!missingModels.length) return undefined;
    let cancelled = false;

    (async () => {
      setDetailLoading((prev) => ({
        ...prev,
        ...Object.fromEntries(missingModels.map((model) => [model.job_id, true])),
      }));
      try {
        const payload = await Promise.all(
          missingModels.map(async (model) => {
            try {
              const res = await mlopsApi.validationDetail(model.job_id, {
                bins: 20,
                threshold: model.optimal_threshold ?? model.metrics?.optimal_threshold,
              });
              return [model.job_id, unwrap(res)];
            } catch (error) {
              return [model.job_id, null];
            }
          }),
        );
        if (cancelled) return;
        setDetailByJobId((prev) => {
          const next = { ...prev };
          payload.forEach(([jobId, detail]) => {
            next[jobId] = detail;
          });
          return next;
        });
      } finally {
        if (!cancelled) {
          setDetailLoading((prev) => {
            const next = { ...prev };
            missingModels.forEach((model) => {
              next[model.job_id] = false;
            });
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [comparisonModels, detailByJobId, detailLoading]);

  const loadFeatureExplanation = useCallback(async ({ selection, force = false }) => {
    if (!selection?.model || !selection?.feature) return;
    if (!force && featureSelection?.model?.job_id === selection.model.job_id && featureSelection?.feature?.feature === selection.feature.feature && featureAnalysis) {
      return;
    }

    const fallback = buildFeatureFallback({
      model: selection.model,
      feature: selection.feature,
      featureRows: selection.featureRows || [],
    });

    setFeatureSelection(selection);
    setFeatureAnalysis(force ? null : fallback);
    setFeatureAnalysisLoading(true);
    setFeatureAnalysisNotice('');

    try {
      const res = await mlopsApi.validationExplain({
        analysis_scope: 'feature_importance',
        chart_title: `${selection.feature.feature_display} importance`,
        chart_focus: `Why ${selection.feature.feature_display} matters for ${normalizeLabel(selection.model)}`,
        facts: fallback.facts,
        deterministic_insight: {
          what: fallback.sections.what_this_says,
          why: fallback.sections.why_it_matters,
          how_it_helps_model_building: fallback.sections.how_it_helps_model_building,
          recommended_action: fallback.sections.recommended_action,
          watch_out: fallback.sections.watch_out,
        },
      });
      const data = unwrap(res);
      setFeatureAnalysis(data || fallback);
    } catch (error) {
      setFeatureAnalysis(fallback);
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('method not allowed') || message.includes('not found')) {
        setFeatureAnalysisNotice('Using grounded feature facts because the new validation explanation route is not available from the backend yet.');
      } else if (message.includes('no response')) {
        setFeatureAnalysisNotice('Using grounded feature facts because the local AI provider is not reachable right now.');
      } else {
        setFeatureAnalysisNotice('Using grounded feature facts because the AI explanation service is unavailable.');
      }
    } finally {
      setFeatureAnalysisLoading(false);
    }
  }, [featureAnalysis, featureSelection]);

  const openFeatureDialog = useCallback((model, feature, featureRows) => {
    loadFeatureExplanation({
      selection: { model, feature, featureRows },
      force: true,
    });
  }, [loadFeatureExplanation]);

  const applyLabels = async () => {
    const payload = Object.entries(labelDrafts)
      .filter(([, value]) => value && value.trim())
      .reduce((acc, [jobId, value]) => ({ ...acc, [jobId]: value.trim() }), {});
    if (Object.keys(payload).length) {
      await onBulkLabel?.(payload);
      setLabelDrafts({});
    }
  };

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ lg: 'center' }}>
          <SectionTitle
            icon={<CompareArrows sx={{ fontSize: 18, color: V.orange }} />}
            title="Model comparison"
            subtitle="Compare discrimination, operating behavior, score separation, and the real validation split for each selected run."
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Select
              multiple
              size="small"
              value={selectedJobIds}
              onChange={(event) => onSelectJobIds?.(event.target.value)}
              renderValue={(selected) => (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {selected.map((jobId) => (
                    <Chip
                      key={jobId}
                      size="small"
                      label={modelBadgeLabel(jobId)}
                      sx={{ height: 22, fontSize: 10.5, bgcolor: V.accentSoft, color: V.text }}
                    />
                  ))}
                </Stack>
              )}
              sx={{ minWidth: 300, fontSize: 12 }}
            >
              {(runs || []).map((run) => (
                <MenuItem key={run.job_id} value={run.job_id}>
                  {modelBadgeLabel(run.job_id)} - {run.algorithm_display || run.algorithm}
                </MenuItem>
              ))}
            </Select>
            <Button
              size="small"
              variant="contained"
              onClick={onCompare}
              disabled={loading || selectedJobIds.length < 2}
              sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
            >
              {loading ? 'Loading...' : 'Compare selected'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Refresh />}
              onClick={onCompare}
              sx={{ textTransform: 'none', borderColor: V.border, color: V.textMuted }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard>
        <SectionTitle
          icon={<HubOutlined sx={{ fontSize: 18, color: V.orange }} />}
          title="Validation set and split proof"
          subtitle="This is where you can see the actual holdout set used to judge each selected model."
        />
        {selectedJobIds.length > comparisonModels.length && (
          <Alert severity="info" sx={{ mb: 1.5, borderRadius: 0 }}>
            {comparisonModels.length} of {selectedJobIds.length} selected runs have loaded comparison detail so far.
            Remaining runs will appear as soon as their validation detail payload is available.
          </Alert>
        )}
        {comparisonModels.length ? (
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', xl: comparisonModels.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr' },
            }}
          >
            {comparisonModels.map((model, idx) => {
              const context = getValidationContext(model);
              const splitLabel = formatSplitLabel(context);
              const splitDetail = context.splitStrategy === 'temporal'
                ? `${context.dateColumn || 'date'}${context.splitDate ? ` @ ${context.splitDate}` : ''}`
                : context.splitStrategy
                  ? `${context.splitStrategy} split`
                  : 'Validation split metadata not available';
              const accent = chartColorForIndex(idx);
              return (
                <Paper
                  key={model.job_id}
                  variant="outlined"
                  sx={{
                    p: 1.75,
                    borderRadius: 0,
                    borderColor: V.border,
                    bgcolor: V.paper,
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Box sx={{ width: 8, height: 28, borderRadius: 999, bgcolor: accent }} />
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 800, color: V.text }}>
                            {normalizeLabel(model)}
                          </Typography>
                          <Typography sx={{ fontSize: 11.25, color: V.textMuted }}>
                            {model.algorithm_display || model.algorithm}
                          </Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <MetricChip label={splitLabel} tone="default" />
                        {model.trained_at ? <MetricChip label={String(model.trained_at).replace('T', ' ').slice(0, 19)} tone="default" /> : null}
                      </Stack>
                    </Stack>
                    <Typography sx={{ fontSize: 11.25, color: V.textMuted, textAlign: 'right', maxWidth: 240 }}>
                      {splitDetail}
                    </Typography>
                  </Stack>

                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1.2,
                      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                      mt: 1.5,
                    }}
                  >
                    {metricTile('Train rows', Number.isFinite(context.trainRows) ? context.trainRows.toLocaleString() : '-', 'Rows used to fit the model')}
                    {metricTile('Validation rows', Number.isFinite(context.testRows) ? context.testRows.toLocaleString() : '-', 'Rows in the holdout set')}
                    {metricTile('Event rate', context.testEventRatePct != null ? pct(context.testEventRatePct, 1) : '-', 'Positive class rate on holdout')}
                    {metricTile('ROC-AUC', fmt(model.metrics?.roc_auc ?? model.roc_auc, 3), 'Ranking quality')}
                    {metricTile('PR-AUC', fmt(model.metrics?.average_precision ?? model.average_precision, 3), 'Minority-class lift')}
                    {metricTile('F1 / Loss', `${fmt(model.metrics?.f1 ?? model.f1, 3)} / ${pct(model.event_loss_pct ?? model.metrics?.event_loss_pct, 2)}`, 'Thresholded operating outcome')}
                  </Box>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                    {context.targetColumn ? <MetricChip label={`Target ${context.targetColumn}`} tone="default" /> : null}
                    {context.grain ? <MetricChip label={`${context.grain} grain`} tone="default" /> : null}
                    {context.featuresUsed != null ? <MetricChip label={`${context.featuresUsed} features`} tone="default" /> : null}
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        ) : (
          emptyChart('No comparison loaded yet', 'Pick one or more trained runs and click Apply to populate the validation set summary and charts.')
        )}
      </SectionCard>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
        <SectionCard>
          <SectionTitle
            icon={<ShowChart sx={{ fontSize: 18, color: V.orange }} />}
            title="ROC curves"
            subtitle="Side-by-side ranking performance across the selected validation holdouts."
          />
          {rocGrid.hasData ? (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={rocGrid.data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={V.textDim} strokeDasharray="5 5" />
                <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(value) => num(value, 2)} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(value) => num(value, 2)} />
                <Tooltip formatter={(value) => num(value, 3)} labelFormatter={(value) => `False positive rate ${num(value, 3)}`} />
                <Legend />
                {rocGrid.series.map((series, idx) => (
                  <Line
                    key={series.id}
                    type="stepAfter"
                    dataKey={series.id}
                    stroke={chartColorForIndex(idx)}
                    strokeWidth={2.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                    name={series.label}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            emptyChart('ROC curve unavailable', 'The selected runs do not expose usable ROC points yet. Refresh the comparison or load a completed run with stored holdout predictions.', 340)
          )}
        </SectionCard>

        <SectionCard>
          <SectionTitle
            icon={<ShowChart sx={{ fontSize: 18, color: V.orange }} />}
            title="Precision-recall curves"
            subtitle="This view is especially useful when suspicious cases are the minority class."
          />
          {prGrid.hasData ? (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={prGrid.data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(value) => num(value, 2)} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(value) => num(value, 2)} />
                <Tooltip formatter={(value) => num(value, 3)} labelFormatter={(value) => `Recall ${num(value, 3)}`} />
                <Legend />
                {prGrid.series.map((series, idx) => (
                  <Line
                    key={series.id}
                    type="stepAfter"
                    dataKey={series.id}
                    stroke={chartColorForIndex(idx)}
                    strokeWidth={2.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                    name={series.label}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            emptyChart('Precision-recall curve unavailable', 'Curve data is missing for the selected runs. The holdout summary above still shows the validation set and operating metrics.', 340)
          )}
        </SectionCard>
      </Box>

      <SectionCard>
        <SectionTitle
          icon={<Insights sx={{ fontSize: 18, color: V.orange }} />}
          title="Model evaluation boards"
          subtitle="Detailed validation cards inspired by the output mockup, including score separation, business-readable confusion outcomes, and top-15 feature signals."
        />
        {comparisonModels.length ? (
          <Box sx={{ maxHeight: comparisonModels.length > 2 ? '68vh' : 'none', overflowY: comparisonModels.length > 2 ? 'auto' : 'visible', pr: comparisonModels.length > 2 ? 0.5 : 0 }}>
            <Stack spacing={2}>
              {comparisonModels.map((model, idx) => {
                const detail = detailByJobId[model.job_id] || {};
                const context = getValidationContext(model);
                const featureRows = getFeatureImportanceRows(
                  detail?.feature_importance?.length
                    ? { feature_importance: detail.feature_importance }
                    : model,
                  15,
                );
                const featureMax = featureRows.length
                  ? Math.max(...featureRows.map((row) => Number(row.importance) || 0), 0)
                  : 0;
                const rocPoints = getCurvePoints(model, 'roc_curve', 'fpr', 'tpr');
                const prPoints = getCurvePoints(model, 'pr_curve', 'recall', 'precision');
                const distribution = detail?.score_distribution?.bins || [];
                const distributionThreshold = detail?.selected_threshold ?? detail?.recommended_threshold ?? model?.optimal_threshold ?? model?.metrics?.optimal_threshold;
                const thresholdBucket = distribution.find((row) => distributionThreshold >= Number(row.start) && distributionThreshold <= Number(row.end));
                const outcomeLines = buildModelOutcomeSummary({ model, detail, context, featureRows });

                return (
                      <Paper key={model.job_id} variant="outlined" sx={{ p: 1.6, borderRadius: 0, borderColor: V.border, bgcolor: V.paper }}>
                    <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" alignItems={{ lg: 'center' }} spacing={1.2} sx={{ mb: 1.5 }}>
                      <Stack spacing={0.45}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 10, height: 28, borderRadius: 999, bgcolor: chartColorForIndex(idx) }} />
                          <Box>
                            <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: V.text }}>
                              {normalizeLabel(model)}
                            </Typography>
                            <Typography sx={{ fontSize: 11.25, color: V.textMuted }}>
                              {model.algorithm_display || model.algorithm}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          <MetricChip label={formatSplitLabel(context)} tone="default" />
                          <MetricChip label={`Threshold ${num(model.optimal_threshold ?? model.metrics?.optimal_threshold, 2)}`} tone="default" />
                          <MetricChip label={`Suppression ${pct(model.suppression_rate_pct ?? model.metrics?.suppression_rate_pct, 2)}`} tone="good" />
                          <MetricChip label={`Event loss ${pct(model.event_loss_pct ?? model.metrics?.event_loss_pct, 2)}`} tone={(model.event_loss_pct ?? model.metrics?.event_loss_pct ?? 999) <= 5 ? 'good' : 'warn'} />
                        </Stack>
                      </Stack>
                      {detailLoading[model.job_id] ? (
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <CircularProgress size={16} sx={{ color: V.orange }} />
                          <Typography sx={{ fontSize: 11.25, color: V.textMuted }}>
                            Loading score distribution and feature detail...
                          </Typography>
                        </Stack>
                      ) : null}
                    </Stack>

                    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', xl: 'repeat(4, minmax(0, 1fr))' } }}>
                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>ROC</Typography>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted, mb: 1 }}>
                          Ranking quality on the validation holdout.
                        </Typography>
                        {rocPoints.length ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={rocPoints} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={V.textDim} strokeDasharray="5 5" />
                              <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(value) => num(value, 2)} />
                              <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(value) => num(value, 2)} />
                              <Tooltip formatter={(value) => num(value, 3)} labelFormatter={(value) => `FPR ${num(value, 3)}`} />
                              <Line type="stepAfter" dataKey="y" stroke={chartColorForIndex(idx)} strokeWidth={2.1} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          emptyChart('ROC unavailable', 'No usable ROC curve points were returned for this model.', 220)
                        )}
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>Precision-recall</Typography>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted, mb: 1 }}>
                          Queue quality as more suspicious cases are captured.
                        </Typography>
                        {prPoints.length ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={prPoints} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                              <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(value) => num(value, 2)} />
                              <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(value) => num(value, 2)} />
                              <Tooltip formatter={(value) => num(value, 3)} labelFormatter={(value) => `Recall ${num(value, 3)}`} />
                              <Line type="stepAfter" dataKey="y" stroke={chartColorForIndex(idx)} strokeWidth={2.1} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          emptyChart('PR unavailable', 'No usable precision-recall points were returned for this model.', 220)
                        )}
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>Business outcome view</Typography>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted, mb: 1 }}>
                          Read each box as actual outcome versus model decision, with the technical term in brackets.
                        </Typography>
                        <ConfusionMatrixGrid
                          cm={detail?.confusion_matrix || model.confusion_matrix || model.metrics?.confusion_matrix}
                          business
                          compact
                        />
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>Alert score distribution</Typography>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted, mb: 1 }}>
                          Shows how scores are spread for actually low-risk versus actually suspicious cases. Stronger separation means the threshold has more room to work.
                          {detail?.score_distribution_source && detail.score_distribution_source !== 'unavailable'
                            ? ` Source: ${detail.score_distribution_source.replace(/_/g, ' ')}.`
                            : ''}
                        </Typography>
                        {distribution.length ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={distribution} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} angle={-22} textAnchor="end" height={46} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip
                                formatter={(value, key) => [`${Number(value).toLocaleString()} alerts`, key === 'positive_count' ? 'Actually suspicious' : 'Actually low risk']}
                                labelFormatter={(value) => `Score band ${value}`}
                              />
                              <Legend />
                              {thresholdBucket ? (
                                <ReferenceLine x={thresholdBucket.label} stroke={V.bad} strokeDasharray="4 4" label={{ value: `T=${num(distributionThreshold, 2)}`, position: 'insideTopRight', fill: V.bad, fontSize: 10 }} />
                              ) : null}
                              <Bar dataKey="negative_count" fill={V.navy} radius={[3, 3, 0, 0]} name="Actually low risk" />
                              <Bar dataKey="positive_count" fill={V.orange} radius={[3, 3, 0, 0]} name="Actually suspicious" />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          emptyChart(
                            'Distribution unavailable',
                            detail?.score_distribution_reason || 'Stored holdout scores are not available for this model yet.',
                            220,
                          )
                        )}
                      </Paper>
                    </Box>

                    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' }, mt: 1.5 }}>
                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                          <Box>
                            <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>
                              Top 15 features
                            </Typography>
                            <Typography sx={{ fontSize: 10.75, color: V.textMuted }}>
                              The strongest visible signals behind the model score. Open a drilldown to see why a feature mattered.
                            </Typography>
                          </Box>
                          {featureRows.length ? (
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<AutoAwesome sx={{ fontSize: 14 }} />}
                              onClick={() => openFeatureDialog(model, featureRows[0], featureRows)}
                              sx={{ textTransform: 'none', color: V.orange, minWidth: 0 }}
                            >
                              Explain top feature
                            </Button>
                          ) : null}
                        </Stack>
                        {featureRows.length ? (
                          <ResponsiveContainer width="100%" height={Math.max(360, featureRows.length * 28)}>
                            <BarChart
                              data={[...featureRows].reverse()}
                              layout="vertical"
                              margin={{ top: 8, right: 16, left: 12, bottom: 8 }}
                              barCategoryGap={8}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#E7ECF2" />
                              <XAxis
                                type="number"
                                domain={[0, featureMax > 0 ? Number((featureMax * 1.08).toFixed(4)) : 1]}
                                tick={{ fontSize: 10 }}
                                tickFormatter={(value) => num(value, 3)}
                              />
                              <YAxis type="category" dataKey="feature_display" width={170} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value) => num(value, 4)} />
                              <Bar
                                dataKey="importance"
                                fill={chartColorForIndex(idx)}
                                stroke={chartColorForIndex(idx)}
                                fillOpacity={0.92}
                                strokeWidth={1}
                                radius={[0, 4, 4, 0]}
                                barSize={14}
                                minPointSize={6}
                                isAnimationActive={false}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          emptyChart('Feature importance unavailable', 'This run does not expose feature importance values yet.', 260)
                        )}
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, borderColor: V.border }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>
                          Business readout
                        </Typography>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted, mt: 0.2 }}>
                          The evaluation card now explains itself in business language instead of only showing raw validation metrics.
                        </Typography>
                        <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                          {outcomeLines.map((line) => (
                            <Typography key={line} sx={{ fontSize: 11.3, color: V.text, lineHeight: 1.7 }}>
                              {line}
                            </Typography>
                          ))}
                        </Stack>
                        {detail?.confusion_matrix_business_explainer ? (
                          <Alert severity="info" sx={{ mt: 1.25, borderRadius: 0 }}>
                            {detail.confusion_matrix_business_explainer}
                          </Alert>
                        ) : null}
                        <Paper variant="outlined" sx={{ mt: 1.25, p: 1.1, borderRadius: 0, borderColor: V.border, bgcolor: V.panelAlt }}>
                          <Typography sx={{ fontSize: 10.25, fontWeight: 800, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                            Feature drilldown
                          </Typography>
                          {featureRows.length ? (
                            <Stack spacing={0.55} sx={{ mt: 0.9 }}>
                              {featureRows.slice(0, 6).map((feature) => (
                                <Button
                                  key={`${model.job_id}-${feature.feature}`}
                                  size="small"
                                  variant="text"
                                  onClick={() => openFeatureDialog(model, feature, featureRows)}
                                  sx={{ justifyContent: 'space-between', textTransform: 'none', color: V.text, border: `1px solid ${V.border}`, borderRadius: 0, px: 1, py: 0.65 }}
                                >
                                  <span>{feature.feature_display}</span>
                                  <span>{pct(feature.contribution_pct, 1)}</span>
                                </Button>
                              ))}
                            </Stack>
                          ) : (
                            <Typography sx={{ fontSize: 11, color: V.textMuted, mt: 0.7 }}>
                              No drilldown is available because this run does not expose feature importance yet.
                            </Typography>
                          )}
                        </Paper>
                      </Paper>
                    </Box>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        ) : (
          emptyChart('No evaluation board yet', 'Apply at least one model to render the detailed validation board and feature drilldowns.', 320)
        )}
      </SectionCard>

      <SectionCard>
        <SectionTitle
          icon={<CompareArrows sx={{ fontSize: 18, color: V.orange }} />}
          title="Metrics comparison table"
          subtitle="Registry actions, editable labels, and the numeric detail behind the charts."
        />
        <Box sx={{ overflow: 'auto', maxHeight: 440 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 8px',
                    borderBottom: `1px solid ${V.border}`,
                    fontSize: 10,
                    color: V.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Model
                </th>
                {metricGroups.map((group) => (
                  <th
                    key={group.label}
                    colSpan={group.metrics.length}
                    style={{
                      textAlign: 'center',
                      padding: '8px 8px',
                      borderBottom: `1px solid ${V.border}`,
                      fontSize: 10,
                      color: V.textMuted,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {group.label}
                  </th>
                ))}
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 8px',
                    borderBottom: `1px solid ${V.border}`,
                    fontSize: 10,
                    color: V.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Registry
                </th>
              </tr>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${V.border}` }}> </th>
                {metricGroups.flatMap((group) => group.metrics.map((metric) => (
                  <TableHeader key={`${group.label}-${metric.key}`} text={metric.label} />
                )))}
                <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${V.border}` }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {comparisonModels.map((model, idx) => {
                const metrics = model.metrics || {};
                return (
                  <tr key={model.job_id} style={{ borderBottom: `1px solid ${V.border}`, background: idx % 2 ? V.panelAlt : 'transparent' }}>
                    <td style={{ padding: '8px 8px', textAlign: 'left', minWidth: 240 }}>
                      <Stack spacing={0.6}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 8, height: 30, borderRadius: 999, bgcolor: chartColorForIndex(idx) }} />
                          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: V.text }}>
                            {normalizeLabel(model)}
                          </Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 10.75, color: V.textMuted }}>{model.algorithm_display || model.algorithm}</Typography>
                        <TextField
                          size="small"
                          placeholder="Edit display label"
                          value={labelDrafts[model.job_id] ?? ''}
                          onChange={(event) => setLabelDrafts((prev) => ({ ...prev, [model.job_id]: event.target.value }))}
                          sx={{ '& .MuiOutlinedInput-root': { fontSize: 11, borderRadius: 0, height: 30, bgcolor: V.paper } }}
                        />
                      </Stack>
                    </td>
                    {metricGroups.flatMap((group) => group.metrics.map((metric) => {
                      const raw = metrics[metric.key] ?? model[metric.key];
                      const display = metric.key.includes('pct')
                        ? pct(raw, 2)
                        : metric.key.includes('threshold')
                          ? num(raw, 2)
                          : fmt(raw, 3);
                      return (
                        <td key={`${model.job_id}-${metric.key}`} style={{ textAlign: 'right', padding: '8px 8px', color: V.text, whiteSpace: 'nowrap' }}>
                          {display}
                        </td>
                      );
                    }))}
                    <td style={{ padding: '8px 8px', textAlign: 'left', minWidth: 170 }}>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => onPromoteChampion?.(model.job_id)}
                          disabled={actionsDisabled}
                          sx={{ height: 26, fontSize: 10.5, bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none' }}
                        >
                          Promote
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => onArchive?.(model.job_id)}
                          disabled={actionsDisabled}
                          sx={{ height: 26, fontSize: 10.5, textTransform: 'none', borderColor: V.border, color: V.textMuted }}
                        >
                          Archive
                        </Button>
                      </Stack>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            onClick={applyLabels}
            disabled={actionsDisabled}
            sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
          >
            Apply labels
          </Button>
          <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
            Edit model names here so the validation dashboard reads cleanly and the table becomes scrollable when you compare many runs.
          </Typography>
        </Stack>
      </SectionCard>

      <FeatureExplainDialog
        open={Boolean(featureSelection)}
        onClose={() => {
          setFeatureSelection(null);
          setFeatureAnalysis(null);
          setFeatureAnalysisNotice('');
        }}
        featureSelection={featureSelection}
        loading={featureAnalysisLoading}
        analysis={featureAnalysis}
        notice={featureAnalysisNotice}
        onRefresh={() => loadFeatureExplanation({ selection: featureSelection, force: true })}
      />
    </Stack>
  );
};

export default ComparisonTab;
