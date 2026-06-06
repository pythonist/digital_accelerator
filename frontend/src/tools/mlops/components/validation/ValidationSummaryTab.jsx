import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { AutoAwesome, Refresh } from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';
import { V } from './validationTheme';
import { buildChecksForModel } from './StabilityRisksTab';
import { MetricChip, SectionCard, SectionTitle } from './ValidationShared';
import { fmt, formatSplitLabel, getValidationContext, normalizeLabel, pct, unwrap } from './validationUtils';

const buildWorkflowSteps = ({ activeModel, comparisonRuns, validationReport, ootResult }) => {
  const activeContext = getValidationContext(activeModel);
  const oot = ootResult?.oot_validation || null;
  const stability = buildChecksForModel(activeModel || {});
  const comparisonMode = comparisonRuns.length >= 2 ? 'multi-model comparison' : 'single-model evaluation';
  return [
    {
      title: 'Overview',
      detail: `${normalizeLabel(activeModel)} was reviewed on a ${formatSplitLabel(activeContext).toLowerCase()} with ${Number.isFinite(activeContext.testRows) ? activeContext.testRows.toLocaleString() : 'saved'} validation rows.`,
      status: activeModel?.job_id ? 'Completed' : 'Pending',
    },
    {
      title: 'Model comparison',
      detail: comparisonRuns.length >= 2
        ? `${comparisonRuns.length} models were compared side by side across ROC, precision-recall, metrics, and evaluation boards.`
        : 'Validation stayed in single-model mode, so the active run was reviewed without a side-by-side challenger.',
      status: comparisonRuns.length ? 'Completed' : 'Pending',
    },
    {
      title: 'Threshold tuning',
      detail: validationReport?.selected_threshold != null
        ? `Threshold ${fmt(validationReport.selected_threshold, 2)} was validated and locked, with ${pct(validationReport?.suppression_rate_pct, 1)} suppression and ${pct(validationReport?.event_loss_pct, 1)} event loss.`
        : 'Threshold tuning has not produced a locked validation decision yet.',
      status: validationReport?.selected_threshold != null ? 'Completed' : 'Pending',
    },
    {
      title: 'OOT validation',
      detail: oot?.defined
        ? `OOT validation completed with ROC-AUC ${fmt(oot?.roc_auc, 3)} and event loss ${pct(oot?.event_loss_pct, 1)} on unseen data.`
        : 'OOT validation has not been completed yet.',
      status: oot?.defined ? 'Completed' : 'Pending',
    },
    {
      title: 'Stability and risks',
      detail: `The active model finished with ${stability.summary.good} healthy checks, ${stability.summary.warn} watch items, and ${stability.summary.bad} review items across ranking strength, threshold robustness, leakage scan, and feature concentration.`,
      status: activeModel?.job_id ? 'Completed' : 'Pending',
    },
  ];
};

const buildSummaryPayload = ({ activeModel, comparisonRuns, validationReport, ootResult }) => {
  const activeContext = getValidationContext(activeModel);
  const oot = ootResult?.oot_validation || null;
  const stability = buildChecksForModel(activeModel || {});
  const steps = buildWorkflowSteps({ activeModel, comparisonRuns, validationReport, ootResult });
  const mode = comparisonRuns.length >= 2 ? 'multi-model comparison' : 'single-model evaluation';
  const selectedThreshold = validationReport?.selected_threshold ?? validationReport?.optimal_threshold ?? activeModel?.selected_threshold ?? activeModel?.metrics?.optimal_threshold ?? null;
  const recommendedThreshold = validationReport?.optimal_threshold ?? activeModel?.metrics?.optimal_threshold ?? null;
  const conclusion = validationReport?.selected_threshold != null
    ? `${normalizeLabel(activeModel)} is ready to move into Model Release with threshold ${fmt(selectedThreshold, 2)} locked from validation.`
    : `Complete threshold tuning before moving ${normalizeLabel(activeModel)} into Model Release.`;

  return {
    steps,
    conclusion,
    facts: [
      `${normalizeLabel(activeModel)} is the active validation run using ${activeModel?.algorithm_display || activeModel?.algorithm || 'the trained model'}.`,
      `${mode} is currently active on the Model Validation screen.`,
      `The validation split is ${formatSplitLabel(activeContext).toLowerCase()} with ${Number.isFinite(activeContext.testRows) ? activeContext.testRows.toLocaleString() : 'saved'} holdout rows.`,
      selectedThreshold != null ? `The locked validation threshold is ${fmt(selectedThreshold, 2)}.` : 'A locked validation threshold has not been confirmed yet.',
      validationReport?.suppression_rate_pct != null ? `At the locked threshold the model suppresses ${pct(validationReport.suppression_rate_pct, 1)} of the queue.` : 'Suppression impact is not available yet.',
      validationReport?.event_loss_pct != null ? `Event loss at the locked threshold is ${pct(validationReport.event_loss_pct, 1)}.` : 'Event-loss evidence is not available yet.',
      oot?.defined ? `OOT validation completed with ROC-AUC ${fmt(oot.roc_auc, 3)} and event loss ${pct(oot.event_loss_pct, 1)} on unseen data.` : 'OOT validation has not been completed yet.',
      `The stability and risk review finished with ${stability.summary.good} healthy checks, ${stability.summary.warn} watch items, and ${stability.summary.bad} review items.`,
      comparisonRuns.length >= 2
        ? `${comparisonRuns.length} models were compared across ROC, PR, metrics, and business outcome boards.`
        : 'The validation screen is currently operating in single-model mode.',
      recommendedThreshold != null && selectedThreshold != null && Math.abs(Number(recommendedThreshold) - Number(selectedThreshold)) > 0.0001
        ? `The final locked threshold differs from the recommendation of ${fmt(recommendedThreshold, 2)} and should be explained in release governance.`
        : 'The locked threshold matches the validation recommendation.',
    ],
    deterministicInsight: {
      what: `${normalizeLabel(activeModel)} has now been summarized across overview, model comparison, threshold tuning, OOT validation, and stability checks for business-facing review.`,
      why: 'This matters because the validation stage should explain not only model accuracy, but also operating threshold impact, holdout quality, unseen-data behavior, and governance readiness.',
      how_it_helps_model_building: 'Use this summary to brief business users, populate reports, and carry the final validated threshold into Model Release without reinterpreting the screen manually.',
      recommended_action: conclusion,
      watch_out: validationReport?.selected_threshold != null
        ? 'Do not allow the threshold to be edited again in Model Release. The release screen should display and govern the locked validation decision.'
        : 'Threshold tuning must be completed before release registration and deployment review.',
    },
  };
};

const ValidationSummaryTab = ({
  activeModel,
  comparisonRuns,
  validationReport,
  ootResult,
  onValidationComplete,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const [summary, setSummary] = useState(validationReport?.business_summary || null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const signatureRef = useRef('');
  const publishedSummaryRef = useRef('');
  const gatingMessage = actionsMessage || 'Validation outputs are outdated. Rerun the upstream stages before continuing.';

  const summaryPayload = useMemo(
    () => buildSummaryPayload({ activeModel, comparisonRuns: comparisonRuns || [], validationReport, ootResult }),
    [activeModel, comparisonRuns, ootResult, validationReport],
  );
  const summarySignature = useMemo(() => JSON.stringify({
    job_id: activeModel?.job_id || '',
    comparison: (comparisonRuns || []).map((run) => run?.job_id || ''),
    selected_threshold: validationReport?.selected_threshold ?? validationReport?.optimal_threshold ?? null,
    oot_defined: Boolean(ootResult?.oot_validation?.defined),
    stability_good: buildChecksForModel(activeModel || {}).summary.good,
    stability_warn: buildChecksForModel(activeModel || {}).summary.warn,
    stability_bad: buildChecksForModel(activeModel || {}).summary.bad,
  }), [activeModel, comparisonRuns, ootResult?.oot_validation?.defined, validationReport?.optimal_threshold, validationReport?.selected_threshold]);

  useEffect(() => {
    if (validationReport?.business_summary) {
      setSummary(validationReport.business_summary);
    }
  }, [validationReport?.business_summary]);

  const generateSummary = useCallback(async ({ force = false } = {}) => {
    if (!activeModel?.job_id) return;
    if (actionsDisabled) {
      setNotice(gatingMessage);
      return;
    }
    if (!force && signatureRef.current === summarySignature && summary) return;
    signatureRef.current = summarySignature;
    setLoading(true);
    setNotice('');
    try {
      const response = await mlopsApi.validationExplain({
        job_id: activeModel.job_id,
        persist: true,
        generated_for: 'model_validation_summary',
        chart_title: 'Model validation summary',
        chart_focus: `Business summary for ${normalizeLabel(activeModel)} across the validation workflow`,
        analysis_scope: 'model_validation_summary',
        facts: summaryPayload.facts,
        deterministic_insight: summaryPayload.deterministicInsight,
        workflow_steps: summaryPayload.steps,
        conclusion: summaryPayload.conclusion,
        summary_metadata: {
          comparison_mode: (comparisonRuns || []).length >= 2 ? 'multi_model' : 'single_model',
          compared_job_ids: (comparisonRuns || []).map((run) => run?.job_id).filter(Boolean),
          selected_threshold: validationReport?.selected_threshold ?? validationReport?.optimal_threshold ?? null,
          recommended_threshold: validationReport?.optimal_threshold ?? null,
          oot_defined: Boolean(ootResult?.oot_validation?.defined),
        },
      });
      const data = unwrap(response);
      const nextSummary = {
        ...(data || {}),
        workflow_steps: summaryPayload.steps,
        conclusion: summaryPayload.conclusion,
        metadata: {
          comparison_mode: (comparisonRuns || []).length >= 2 ? 'multi_model' : 'single_model',
          compared_job_ids: (comparisonRuns || []).map((run) => run?.job_id).filter(Boolean),
          selected_threshold: validationReport?.selected_threshold ?? validationReport?.optimal_threshold ?? null,
          recommended_threshold: validationReport?.optimal_threshold ?? null,
        },
      };
      setSummary(nextSummary);
      const nextPayload = {
        ...(validationReport || {}),
        job_id: activeModel.job_id,
        business_summary: nextSummary,
      };
      const nextPublishSignature = JSON.stringify({
        job_id: nextPayload.job_id || '',
        summary_signature: summarySignature,
        conclusion: nextSummary?.conclusion || '',
        source: nextSummary?.analysis_source || nextSummary?.generated_for || '',
      });
      if (publishedSummaryRef.current !== nextPublishSignature) {
        publishedSummaryRef.current = nextPublishSignature;
        onValidationComplete?.(nextPayload);
      }
    } catch (error) {
      const fallbackSummary = {
        analysis_source: 'deterministic',
        llm_available: false,
        sections: {
          what_this_says: summaryPayload.deterministicInsight.what,
          why_it_matters: summaryPayload.deterministicInsight.why,
          how_it_helps_model_building: summaryPayload.deterministicInsight.how_it_helps_model_building,
          recommended_action: summaryPayload.deterministicInsight.recommended_action,
          watch_out: summaryPayload.deterministicInsight.watch_out,
        },
        workflow_steps: summaryPayload.steps,
        conclusion: summaryPayload.conclusion,
        metadata: {
          comparison_mode: (comparisonRuns || []).length >= 2 ? 'multi_model' : 'single_model',
          compared_job_ids: (comparisonRuns || []).map((run) => run?.job_id).filter(Boolean),
        },
      };
      setSummary(fallbackSummary);
      const nextPayload = {
        ...(validationReport || {}),
        job_id: activeModel.job_id,
        business_summary: fallbackSummary,
      };
      const nextPublishSignature = JSON.stringify({
        job_id: nextPayload.job_id || '',
        summary_signature: summarySignature,
        conclusion: fallbackSummary?.conclusion || '',
        source: fallbackSummary?.analysis_source || fallbackSummary?.generated_for || '',
      });
      if (publishedSummaryRef.current !== nextPublishSignature) {
        publishedSummaryRef.current = nextPublishSignature;
        onValidationComplete?.(nextPayload);
      }
      setNotice(error?.response?.data?.error || 'Using grounded validation summary because the AI summary service is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [actionsDisabled, activeModel, comparisonRuns, gatingMessage, onValidationComplete, ootResult, summary, summaryPayload, summarySignature, validationReport]);

  useEffect(() => {
    if (!activeModel?.job_id || actionsDisabled) return;
    generateSummary();
  }, [actionsDisabled, activeModel?.job_id, generateSummary]);

  const lockedThreshold = validationReport?.selected_threshold
    ?? validationReport?.optimal_threshold
    ?? activeModel?.selected_threshold
    ?? activeModel?.metrics?.selected_threshold
    ?? activeModel?.metrics?.optimal_threshold
    ?? 0.5;

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ lg: 'center' }}>
          <SectionTitle
            icon={<AutoAwesome sx={{ fontSize: 18, color: V.orange }} />}
            title="Business summary"
            subtitle="Reusable GenAI-ready narrative for demos, PDF/Word reports, and validation history."
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <MetricChip label={(comparisonRuns || []).length >= 2 ? 'Multi-model mode' : 'Single-model mode'} tone="default" />
            {validationReport?.selected_threshold != null ? <MetricChip label={`Locked threshold ${fmt(validationReport.selected_threshold, 2)}`} tone="good" /> : null}
            <Button
              size="small"
              variant="outlined"
              startIcon={loading ? <CircularProgress size={12} sx={{ color: V.orange }} /> : <Refresh sx={{ fontSize: 14 }} />}
              onClick={() => generateSummary({ force: true })}
              disabled={loading || actionsDisabled || !activeModel?.job_id}
              sx={{ textTransform: 'none', borderColor: V.border, color: V.textMuted }}
            >
              Refresh summary
            </Button>
          </Stack>
        </Stack>
        {actionsDisabled ? <Alert severity="warning" sx={{ mt: 1.4, borderRadius: 0 }}>{gatingMessage}</Alert> : null}
        {notice ? <Alert severity="info" sx={{ mt: 1.4, borderRadius: 0 }}>{notice}</Alert> : null}
      </SectionCard>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: V.border }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.45 }}>
            Locked Threshold
          </Typography>
          <Typography sx={{ mt: 0.6, fontSize: 24, fontWeight: 800, color: V.text }}>
            {fmt(lockedThreshold, 2)}
          </Typography>
          <Typography sx={{ mt: 0.35, fontSize: 11.25, color: V.textMuted }}>
            This validation decision is immutable and must flow unchanged into release, deployment, FCC scoring, Bridge, and Sentinel.
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, borderColor: V.border }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.45 }}>
            Downstream Policy
          </Typography>
          <Typography sx={{ mt: 0.6, fontSize: 15, fontWeight: 700, color: V.text }}>
            No downstream screen should override the locked threshold
          </Typography>
          <Typography sx={{ mt: 0.35, fontSize: 11.25, color: V.textMuted }}>
            If unseen-data behavior suggests a different cut-off, take that change back into validation and release governance instead of editing live operations.
          </Typography>
        </Paper>
      </Box>

      <SectionCard>
        <SectionTitle title="Validation journey" subtitle="Step-by-step business summary of what was completed during Model Validation." />
        <Stack spacing={1.1}>
          {summaryPayload.steps.map((step) => (
            <Paper key={step.title} variant="outlined" sx={{ p: 1.3, borderRadius: 0, borderColor: V.border, bgcolor: V.paper }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: V.text }}>{step.title}</Typography>
                  <Typography sx={{ fontSize: 11.25, color: V.textMuted, mt: 0.35, lineHeight: 1.7 }}>{step.detail}</Typography>
                </Box>
                <MetricChip label={step.status} tone={step.status === 'Completed' ? 'good' : 'warn'} />
              </Stack>
            </Paper>
          ))}
        </Stack>
      </SectionCard>

      <SectionCard>
        <SectionTitle title="Summary and conclusion" subtitle="Business-facing language that can be reused in report generation and audit history." />
        {loading && !summary ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
            <CircularProgress size={24} sx={{ color: V.orange }} />
          </Stack>
        ) : (
          <Stack spacing={1.2}>
            <Paper variant="outlined" sx={{ p: 1.4, borderRadius: 0, borderColor: V.border, bgcolor: V.panelAlt }}>
              <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 }}>Conclusion</Typography>
              <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: V.text, mt: 0.55 }}>{summary?.conclusion || summaryPayload.conclusion}</Typography>
            </Paper>
            {[
              ['What this says', summary?.sections?.what_this_says],
              ['Why it matters', summary?.sections?.why_it_matters],
              ['How this helps', summary?.sections?.how_it_helps_model_building],
              ['Recommended action', summary?.sections?.recommended_action],
              ['Watch out', summary?.sections?.watch_out],
            ].map(([label, value]) => (
              <Paper key={label} variant="outlined" sx={{ p: 1.35, borderRadius: 0, borderColor: V.border }}>
                <Typography sx={{ fontSize: 10.25, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.65 }}>{label}</Typography>
                <Typography sx={{ fontSize: 11.5, color: V.text, mt: 0.5, lineHeight: 1.7 }}>{value || '-'}</Typography>
              </Paper>
            ))}
          </Stack>
        )}
      </SectionCard>
    </Stack>
  );
};

export default ValidationSummaryTab;
