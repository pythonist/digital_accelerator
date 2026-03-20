/**
 * ModelReadyScreen.jsx â€” Step 9: Model Deployment & Export
 *
 * New features added:
 *   1. PipelineSummary      â€” Full narrative recap (business + technical mode)
 *   2. LiveInferencePanel   â€” Score a single record via inferenceExplain() before deploy
 *   3. BatchScoringPanel    â€” Upload CSV â†’ score via ledgerScore() â†’ distribution
 *   4. DeployConfigPanel    â€” Threshold slider with live TP/suppression preview
 *   5. Rollback awareness   â€” Shows active deployment state
 *
 * All new features use EXISTING mlopsApi methods â€” zero new backend endpoints.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider,
  IconButton, List, ListItem, Paper, Slider, Stack, Tab, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import {
  CheckCircle, ChevronRight, CloudDownload, Code, ExpandLess, ExpandMore,
  ErrorOutline, Functions, Lock, ModelTraining, RadioButtonUnchecked,
  RocketLaunch, TableChart, Tune, Upload, BugReport, DataObject,
  Assessment, History, Person, Settings,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';
import { ALLOW_INCOMPLETE_ACTIONS } from '../utils/uiFlags';

const canDisable = (cond) => !ALLOW_INCOMPLETE_ACTIONS && cond;

const T = {
  orange:      '#D04A02',
  orangeHover: '#b83d00',
  orangeLight: '#fff1ec',
  done:        '#22c55e',
  doneLight:   '#f0fdf4',
  border:      '#e2e8f0',
  textMuted:   '#64748b',
  textDim:     '#94a3b8',
  mono:        '"Fira Code","Cascadia Code",monospace',
  info:        '#2B6CB0',
  infoBg:      '#EBF8FF',
  infoBd:      '#BEE3F8',
};

const unwrap = (res) => { const b = res?.data ?? res; return b?.data ?? b; };
const metricsForRun = (run) => run?.results?.metrics || {};
const numOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const runThreshold = (run) => numOrNull(run?.threshold ?? run?.hml_low_threshold ?? run?.selected_threshold) ?? 0.5;
const runAuc = (run) => numOrNull(metricsForRun(run)?.roc_auc ?? run?.auc);
const runF1 = (run) => numOrNull(metricsForRun(run)?.f1 ?? run?.f1);
const runPrecision = (run) => numOrNull(metricsForRun(run)?.precision ?? run?.precision);
const runRecall = (run) => numOrNull(metricsForRun(run)?.recall ?? run?.recall);

// â”€â”€â”€ Shared sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SectionCard = ({ title, subtitle, icon: Icon, defaultOpen = true, children, action }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row" alignItems="center" justifyContent="space-between"
        onClick={() => setOpen(v => !v)}
        sx={{
          px: 2.5, py: 1.75, cursor: 'pointer',
          bgcolor: open ? 'white' : '#fafbfc',
          borderBottom: open ? `1px solid ${T.border}` : 'none',
          '&:hover': { bgcolor: '#fafbfc' },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          {Icon && <Icon sx={{ fontSize: 16, color: T.orange }} />}
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b', lineHeight: 1.3 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography sx={{ fontSize: 11, color: T.textMuted, lineHeight: 1.3 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          {action}
          <IconButton size="small" sx={{ p: 0.25 }}>
            {open ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
          </IconButton>
        </Stack>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ p: 2.5 }}>{children}</Box>
      </Collapse>
    </Paper>
  );
};

const StatRow = ({ label, value, mono, highlight }) => (
  <Stack direction="row" alignItems="baseline" justifyContent="space-between"
    sx={{ py: 0.6, borderBottom: `1px solid ${T.border}` }}>
    <Typography sx={{ fontSize: 12, color: T.textMuted }}>{label}</Typography>
    <Typography sx={{
      fontSize: 12.5, fontWeight: 700,
      color: highlight ? T.orange : '#1e293b',
      fontFamily: mono ? T.mono : 'inherit',
      textAlign: 'right', ml: 1,
    }}>
      {value ?? 'â€”'}
    </Typography>
  </Stack>
);

const CheckItem = ({ label, done, desc }) => (
  <ListItem disableGutters sx={{ py: 0.75 }}>
    <Stack direction="row" alignItems="center" spacing={1.5}>
      {done ? <CheckCircle sx={{ fontSize: 18, color: T.done }} />
              : <RadioButtonUnchecked sx={{ fontSize: 18, color: T.textDim }} />}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: done ? 600 : 400, color: done ? '#1e293b' : T.textMuted }}>
          {label}
        </Typography>
        {desc && <Typography sx={{ fontSize: 11, color: T.textDim }}>{desc}</Typography>}
      </Box>
    </Stack>
  </ListItem>
);

// â”€â”€â”€ 1. Pipeline Journey Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const buildBusinessNarrative = ({ uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun }) => {
  const tableCount = (uploadedDatasets || []).length;
  const totalRows  = (masterDataset?.row_count || 0).toLocaleString();
  const algo       = activeModelRun?.algorithm?.replace(/_/g, ' ') || 'a machine learning model';
  const aucValue   = runAuc(activeModelRun);
  const auc        = aucValue != null ? `${(aucValue * 100).toFixed(0)}%` : null;

  const sections = [];

  if (tableCount > 0) {
    sections.push(`You started with ${tableCount} data table${tableCount > 1 ? 's' : ''}${totalRows ? ` containing ${totalRows} records` : ''}.`);
  }
  if (masterDataset) {
    sections.push(`These were combined into a single unified view for analysis.`);
  }
  if (targetColumn) {
    sections.push(`The model was built to predict: "${targetColumn}".`);
  }
  if (preprocessedDataset) {
    const featCount = preprocessedDataset.col_count ?? '?';
    sections.push(`The data was cleaned and prepared â€” ${featCount} signals were selected for the model to learn from.`);
  }
  if (activeModelRun) {
    sections.push(`Using ${algo}, the model ${auc ? `achieved ROC-AUC of ${auc}` : 'was trained successfully'} against held-out test data.`);
    const m       = activeModelRun.results?.metrics || {};
    const table   = m.threshold_table || [];
    const thresh  = runThreshold(activeModelRun);
    const tRow    = table.find(r => Math.abs((r.threshold ?? 0.5) - thresh) < 0.03);
    if (tRow) {
      const supp = tRow.suppression_rate?.toFixed(0);
      const tp   = tRow.tp_retained && tRow.fn != null ? Math.round((tRow.tp_retained / (tRow.tp_retained + tRow.fn)) * 100) : null;
      if (supp) sections.push(`At the selected decision threshold, approximately ${supp}% of low-risk alerts will be suppressed automatically${tp ? `, while retaining ${tp}% of genuine risk cases for investigation` : ''}.`);
    }
  }

  return sections.join(' ') || 'Complete the pipeline steps to generate a summary.';
};

const buildTechnicalSteps = ({ uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun }) => {
  const steps = [];
  const ds    = uploadedDatasets || [];
  if (ds.length) {
    steps.push({ step: '01', label: 'Data Ingestion', detail: `${ds.length} table${ds.length > 1 ? 's' : ''} uploaded â€” ${ds.map(d => d.dataset_type).join(', ')}` });
  }
  if (masterDataset) {
    steps.push({ step: '02', label: 'Master Build', detail: `${(masterDataset.row_count || 0).toLocaleString()} rows Ã- ${masterDataset.col_count ?? '?'} columns` });
  }
  if (targetColumn) {
    steps.push({ step: '03', label: 'Target Variable', detail: `column: ${targetColumn}` });
  }
  if (preprocessedDataset) {
    const before = masterDataset?.row_count || '?';
    const after  = preprocessedDataset.row_count || '?';
    steps.push({ step: '04/05', label: 'EDA + Preprocessing', detail: `${before.toLocaleString()} â†’ ${(after || 0).toLocaleString()} rows, ${preprocessedDataset.col_count ?? '?'} features retained` });
  }
  if (activeModelRun) {
    const m = activeModelRun.results?.metrics || {};
    const aucValue = runAuc(activeModelRun);
    const threshold = runThreshold(activeModelRun);
    steps.push({ step: '06', label: 'Training', detail: `${activeModelRun.algorithm} · AUC ${aucValue != null ? aucValue.toFixed(4) : '-'} · Threshold ${threshold.toFixed(2)}` });
    if (m.roc_auc || m.f1) {
      steps.push({ step: '07', label: 'Validation', detail: `ROC-AUC ${m.roc_auc?.toFixed(4) ?? 'â€”'} Â· F1 ${m.f1?.toFixed(4) ?? 'â€”'} Â· Precision ${m.precision?.toFixed(4) ?? 'â€”'} Â· Recall ${m.recall?.toFixed(4) ?? 'â€”'}` });
    }
  }
  return steps;
};

const PipelineSummary = ({ persona, uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun }) => {
  const narrative = useMemo(() => buildBusinessNarrative({ uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun }), [uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun]);
  const techSteps = useMemo(() => buildTechnicalSteps({ uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun }), [uploadedDatasets, masterDataset, targetColumn, preprocessedDataset, activeModelRun]);

  return (
    <SectionCard title="Pipeline Journey" subtitle="What happened at every step" icon={History} defaultOpen>
      {persona === 'business' ? (
        <Box>
          <Typography sx={{ fontSize: 13, color: '#1e293b', lineHeight: 1.8, mb: 1.5 }}>
            {narrative}
          </Typography>
          <Alert severity="info" sx={{ borderRadius: 1.5, fontSize: 12 }}>
            Switch to <strong>Technical</strong> mode using the toggle in the top bar to see detailed metrics at each step.
          </Alert>
        </Box>
      ) : (
        <Stack spacing={0}>
          {techSteps.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>
              Complete pipeline steps to populate the technical summary.
            </Typography>
          ) : techSteps.map((s, i) => (
            <Box key={s.step} sx={{
              display: 'flex', gap: 2, py: 1,
              borderBottom: i < techSteps.length - 1 ? `1px solid ${T.border}` : 'none',
            }}>
              <Typography sx={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.orange, minWidth: 32, pt: 0.25 }}>
                {s.step}
              </Typography>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{s.label}</Typography>
                <Typography sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{s.detail}</Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </SectionCard>
  );
};

// â”€â”€â”€ 2. Deployment Configuration Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DeployConfigPanel = ({ activeModelRun, onThresholdChange, actionsDisabled = false }) => {
  const thresholdTable = useMemo(() => {
    return (activeModelRun?.results?.metrics?.threshold_table || [])
      .filter(r => r.threshold != null)
      .sort((a, b) => a.threshold - b.threshold);
  }, [activeModelRun]);

  const defaultThresh = runThreshold(activeModelRun);
  const [threshold, setThreshold] = useState(defaultThresh);

  const preview = useMemo(() => {
    if (!thresholdTable.length) return null;
    const closest = thresholdTable.reduce((best, row) => {
      return Math.abs(row.threshold - threshold) < Math.abs(best.threshold - threshold) ? row : best;
    }, thresholdTable[0]);
    const total    = (closest.tp_retained ?? 0) + (closest.fn ?? 0);
    const tpPct    = total > 0 ? Math.round((closest.tp_retained / total) * 100) : null;
    const suppPct  = closest.suppression_rate != null ? Number(closest.suppression_rate).toFixed(1) : null;
    return { tpPct, suppPct, row: closest };
  }, [threshold, thresholdTable]);

  const handleChange = (_, val) => {
    setThreshold(val);
    onThresholdChange?.(val);
  };

  if (!activeModelRun) return null;

  return (
    <SectionCard title="Deployment Configuration" subtitle="Set the decision threshold before going live" icon={Tune} defaultOpen>
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
          <Typography sx={{ fontSize: 12, color: T.textMuted }}>Decision threshold</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: T.orange, fontFamily: T.mono }}>
            {threshold.toFixed(2)}
          </Typography>
        </Stack>

        {thresholdTable.length > 0 ? (
          <>
            <Slider
              value={threshold}
              onChange={handleChange}
              disabled={actionsDisabled}
              min={0.1} max={0.9} step={0.01}
              sx={{ color: T.orange, '& .MuiSlider-thumb': { width: 16, height: 16 } }}
            />

            {preview && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 1.5 }}>
                {[
                  { label: 'Alert suppression', value: preview.suppPct ? `${preview.suppPct}%` : 'â€”', sub: 'Alerts auto-suppressed', good: true },
                  { label: 'Case retention', value: preview.tpPct ? `${preview.tpPct}%` : 'â€”', sub: 'Genuine risk kept', good: preview.tpPct > 80 },
                ].map(({ label, value, sub, good }) => (
                  <Box key={label} sx={{
                    p: 1.5, borderRadius: 1.5,
                    border: `1px solid ${good ? '#bbf7d0' : '#fecaca'}`,
                    bgcolor: good ? '#f0fdf4' : '#fef2f2',
                  }}>
                    <Typography sx={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: good ? '#16a34a' : '#dc2626', lineHeight: 1.2 }}>{value}</Typography>
                    <Typography sx={{ fontSize: 10, color: T.textMuted }}>{sub}</Typography>
                  </Box>
                ))}
              </Box>
            )}
            <Typography sx={{ fontSize: 10.5, color: T.textMuted, mt: 1.5 }}>
              Drag the slider to see how the threshold affects your team's workload vs case coverage.
              The threshold was set to <strong>{defaultThresh.toFixed(2)}</strong> during validation.
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 12, color: T.textMuted, mt: 1 }}>
            Threshold table not available for this model. The validation threshold ({defaultThresh.toFixed(2)}) will be used.
          </Typography>
        )}
      </Box>
    </SectionCard>
  );
};

// â”€â”€â”€ 3. Live Inference Test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const RISK_COLORS = { high: '#dc2626', medium: '#d97706', low: '#16a34a' };
const RISK_BG     = { high: '#fef2f2', medium: '#fffbeb', low: '#f0fdf4' };

const LiveInferencePanel = ({ activeModelRun, persona, actionsDisabled = false, actionsMessage = '' }) => {
  const [input,     setInput]     = useState('');
  const [result,    setResult]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [jsonError, setJsonError] = useState(null);
  const gatingMessage = actionsMessage || 'Deployment readiness actions are blocked because this run is outdated. Rerun the upstream stages first.';

  const threshold = runThreshold(activeModelRun);
  const jobId     = activeModelRun?.job_id;
  const features  = activeModelRun?.results?.feature_names || [];

  // Build placeholder JSON from known features
  const placeholder = useMemo(() => {
    if (!features.length) return '{\n  "feature_1": 0,\n  "feature_2": 0\n}';
    const sample = Object.fromEntries(features.slice(0, 8).map(f => [f, 0]));
    return JSON.stringify(sample, null, 2);
  }, [features]);

  const handleScore = async () => {
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setJsonError(null);
    setError(null);
    let record;
    try { record = JSON.parse(input || '{}'); }
    catch (e) { setJsonError('Invalid JSON â€” check your syntax'); return; }

    if (!jobId) { setError('No model run selected'); return; }
    setLoading(true);
    try {
      const res  = await mlopsApi.inferenceExplain({ run_id: jobId, record, threshold, top_n: 6 });
      const data = unwrap(res);
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.error || 'Scoring failed');
    } finally {
      setLoading(false);
    }
  };

  const score    = result?.score ?? null;
  const decision = score != null ? (score >= threshold ? 'flag' : 'suppress') : null;
  const riskTier = score == null ? null : score >= 0.7 ? 'high' : score >= threshold ? 'medium' : 'low';
  const factors  = result?.top_features || result?.explanations || [];

  const businessDecision = {
    flag:     'This record would be flagged for analyst review.',
    suppress: 'This record would be suppressed â€” not sent to an analyst.',
  };

  return (
    <SectionCard title="Test Before You Deploy" subtitle="Score a single record and see why the model makes its decision" icon={BugReport} defaultOpen={false}>
      {!jobId ? (
        <Alert severity="warning" sx={{ borderRadius: 1.5 }}>Select a model run first.</Alert>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
          {/* Input */}
          <Box>
            <Typography sx={{ fontSize: 11.5, color: T.textMuted, mb: 1, lineHeight: 1.5 }}>
              Paste a JSON record with the same fields used during training.
              {features.length > 0 && ` Model uses ${features.length} features.`}
            </Typography>
            <TextField
              multiline minRows={8} maxRows={16} fullWidth
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              error={!!jsonError}
              helperText={jsonError}
              sx={{
                '& .MuiInputBase-input': { fontFamily: T.mono, fontSize: 11.5 },
                mb: 1.5,
              }}
            />
            <Button
              variant="contained" fullWidth onClick={handleScore}
              disabled={actionsDisabled || !input.trim() || loading}
              startIcon={loading ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <BugReport />}
              sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', fontWeight: 700 }}
            >
              {loading ? 'Scoring...' : 'Score this record'}
            </Button>
            {error && <Alert severity="error" sx={{ mt: 1, borderRadius: 1.5 }}>{error}</Alert>}
          </Box>

          {/* Result */}
          <Box>
            {result ? (
              <Stack spacing={1.5}>
                {/* Score + decision */}
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: riskTier ? RISK_BG[riskTier] : '#f8fafc', border: `1.5px solid ${riskTier ? RISK_COLORS[riskTier] + '40' : T.border}` }}>
                  <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                    <Box>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Risk Score
                      </Typography>
                      <Typography sx={{ fontSize: 32, fontWeight: 800, color: riskTier ? RISK_COLORS[riskTier] : '#1e293b', lineHeight: 1 }}>
                        {score != null ? score.toFixed(3) : 'â€”'}
                      </Typography>
                    </Box>
                    <Chip
                      label={decision === 'flag' ? 'âš‘ FLAGGED' : 'âœ“ SUPPRESSED'}
                      sx={{
                        bgcolor: decision === 'flag' ? '#fef2f2' : '#f0fdf4',
                        color:   decision === 'flag' ? '#dc2626'  : '#16a34a',
                        border:  `1px solid ${decision === 'flag' ? '#fecaca' : '#bbf7d0'}`,
                        fontWeight: 800, fontSize: 11, height: 28,
                      }}
                    />
                  </Stack>
                  {persona === 'business' && decision && (
                    <Typography sx={{ fontSize: 12, color: '#475569', mt: 1 }}>
                      {businessDecision[decision]}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 0.5 }}>
                    Threshold: {threshold.toFixed(2)} Â· Score {score >= threshold ? 'â‰¥' : '<'} threshold â†’ {decision}
                  </Typography>
                </Box>

                {/* Top contributing factors */}
                {factors.length > 0 && (
                  <Box>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1 }}>
                      {persona === 'business' ? 'Why the model decided this' : 'Top contributing features (SHAP)'}
                    </Typography>
                    {factors.slice(0, 6).map((f, i) => {
                      const name  = f.feature || f.name || `feature_${i}`;
                      const val   = f.shap_value ?? f.contribution ?? 0;
                      const isPos = val > 0;
                      const pct   = Math.min(Math.abs(val) * 200, 100);
                      return (
                        <Box key={name} sx={{ mb: 0.75 }}>
                          <Stack direction="row" justifyContent="space-between" mb={0.25}>
                            <Typography sx={{ fontSize: 11, color: '#1e293b', fontFamily: persona === 'technical' ? T.mono : 'inherit' }}>
                              {name}
                            </Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: isPos ? '#dc2626' : '#16a34a', fontFamily: T.mono }}>
                              {isPos ? '+' : ''}{val.toFixed(3)}
                            </Typography>
                          </Stack>
                          <Box sx={{ height: 4, borderRadius: 2, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
                            <Box sx={{
                              height: '100%', width: `${pct}%`, borderRadius: 2,
                              bgcolor: isPos ? '#fca5a5' : '#86efac',
                              ml: isPos ? 'auto' : 0,
                            }} />
                          </Box>
                        </Box>
                      );
                    })}
                    {persona === 'business' && (
                      <Typography sx={{ fontSize: 10.5, color: T.textDim, mt: 1, fontStyle: 'italic' }}>
                        Red bars push the score higher (toward flagging). Green bars lower it (toward suppression).
                      </Typography>
                    )}
                  </Box>
                )}
              </Stack>
            ) : (
              <Box sx={{
                height: '100%', minHeight: 200,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1.5px dashed ${T.border}`, borderRadius: 2,
                color: T.textDim, textAlign: 'center', p: 3,
              }}>
                <Box>
                  <DataObject sx={{ fontSize: 32, mb: 1, opacity: 0.3 }} />
                  <Typography sx={{ fontSize: 12 }}>Score result will appear here</Typography>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </SectionCard>
  );
};

// â”€â”€â”€ 4. Batch CSV Scoring Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BatchScoringPanel = ({ activeModelRun, actionsDisabled = false, actionsMessage = '' }) => {
  const [file,      setFile]      = useState(null);
  const [parsing,   setParsing]   = useState(false);
  const [scoring,   setScoring]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState(null);
  const [progress,  setProgress]  = useState(0);
  const fileRef = useRef();
  const gatingMessage = actionsMessage || 'Deployment readiness actions are blocked because this run is outdated. Rerun the upstream stages first.';

  const lowThreshold = numOrNull(activeModelRun?.hml_low_threshold ?? activeModelRun?.threshold) ?? 0.35;
  const highThreshold = numOrNull(activeModelRun?.hml_high_threshold) ?? 0.65;
  const grain = String(activeModelRun?.grain || 'alert').toLowerCase() === 'case' ? 'case' : 'alert';

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  };

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row  = {};
      headers.forEach((h, i) => {
        const n = Number(vals[i]);
        row[h] = isNaN(n) ? vals[i] : n;
      });
      return row;
    });
    return records;
  };

  const handleScore = async () => {
    if (!file || !activeModelRun?.job_id) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setParsing(true);
    setError(null);
    setProgress(0);

    try {
      const text    = await file.text();
      const records = parseCSV(text);
      if (records.length > 5000) throw new Error('Maximum 5,000 rows per batch. Please trim your file.');
      setParsing(false);
      setScoring(true);

      // Split into chunks of 500 for progress tracking
      const chunkSize = 500;
      const allResults = [];
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const res   = await mlopsApi.ledgerScore({
          job_id: activeModelRun.job_id,
          rows: chunk,
          grain,
          hml_high_threshold: highThreshold,
          hml_low_threshold: lowThreshold,
        });
        const data = unwrap(res);
        const scored = Array.isArray(data?.scored) ? data.scored : Array.isArray(data) ? data : [];
        allResults.push(...scored);
        const processed = Math.min(i + chunkSize, records.length);
        setProgress(Math.round((processed / records.length) * 100));
      }

      // Compute distribution
      const decisionOf = (row) => String(row?.hml_decision || '').toUpperCase();
      const scoreOf = (row) => Number(row?.probability ?? row?.score ?? 0);
      const high      = allResults.filter((r) => decisionOf(r) === 'HIGH').length;
      const medium    = allResults.filter((r) => decisionOf(r) === 'MEDIUM').length;
      const low       = allResults.filter((r) => decisionOf(r) === 'LOW').length;
      const flagged   = high + medium;
      const suppressed = low;
      const scores    = allResults.map(scoreOf).filter((s) => Number.isFinite(s));
      const avg       = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      // Top 10 highest scoring
      const top10 = [...allResults].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 10);

      setResult({
        total: allResults.length,
        flagged,
        suppressed,
        avg,
        high,
        medium,
        low,
        top10,
        scored: allResults,
        thresholds: { high: highThreshold, low: lowThreshold },
      });
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Scoring failed');
    } finally {
      setParsing(false);
      setScoring(false);
      setProgress(0);
    }
  };

  const handleDownloadScored = () => {
    if (!result?.scored?.length) return;
    const headers = Object.keys(result.scored[0]).join(',');
    const rows    = result.scored.map(r => Object.values(r).join(','));
    const csv     = [headers, ...rows].join('\n');
    const blob    = new Blob([csv], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href = url; a.download = 'scored_output.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const Bar = ({ label, count, total, color }) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <Box sx={{ mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" mb={0.25}>
          <Typography sx={{ fontSize: 11.5, color: '#1e293b', fontWeight: 600 }}>{label}</Typography>
          <Typography sx={{ fontSize: 11.5, color: T.textMuted, fontFamily: T.mono }}>
            {count.toLocaleString()} ({pct}%)
          </Typography>
        </Stack>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
        </Box>
      </Box>
    );
  };

  return (
    <SectionCard title="Score a Test File" subtitle="Upload a CSV to see how this model would perform on your data" icon={Assessment} defaultOpen={false}>
      {!activeModelRun?.job_id ? (
        <Alert severity="warning" sx={{ borderRadius: 1.5 }}>Select a model run first.</Alert>
      ) : (
        <Stack spacing={2}>
          {/* Upload */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
            <Box
              onClick={() => !actionsDisabled && fileRef.current?.click()}
              sx={{
                flex: 1, p: 2, border: `1.5px dashed ${file ? T.orange : T.border}`,
                borderRadius: 2, cursor: actionsDisabled ? 'not-allowed' : 'pointer', textAlign: 'center',
                bgcolor: file ? T.orangeLight : '#fafbfc',
                transition: 'all 0.12s',
                '&:hover': { borderColor: T.orange, bgcolor: T.orangeLight },
                opacity: actionsDisabled ? 0.72 : 1,
              }}
            >
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
              <Upload sx={{ fontSize: 24, color: file ? T.orange : T.textDim, mb: 0.5 }} />
              <Typography sx={{ fontSize: 12, color: file ? T.orange : T.textMuted, fontWeight: file ? 700 : 400 }}>
                {file ? file.name : 'Click to select a CSV file'}
              </Typography>
              <Typography sx={{ fontSize: 10.5, color: T.textDim }}>Max 5,000 rows</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button
                variant="contained" onClick={handleScore}
                disabled={actionsDisabled || !file || parsing || scoring}
                startIcon={(parsing || scoring) ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <Assessment />}
                sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, textTransform: 'none', fontWeight: 700, minWidth: 140 }}
              >
                {parsing ? 'Parsing...' : scoring ? `Scoring ${progress}%` : 'Run Scoring'}
              </Button>
              {result && (
                <Button variant="outlined" onClick={handleDownloadScored} startIcon={<CloudDownload />}
                  disabled={actionsDisabled}
                  sx={{ textTransform: 'none', borderColor: T.border, color: T.textMuted, '&:hover': { borderColor: T.orange, color: T.orange } }}>
                  Download scored CSV
                </Button>
              )}
            </Box>
          </Stack>

          {error && <Alert severity="error" sx={{ borderRadius: 1.5 }}>{error}</Alert>}

          {/* Results */}
          {result && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              {/* Distribution */}
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.5 }}>
                  Score Distribution â€” {result.total.toLocaleString()} records
                </Typography>
                <Bar label="Flagged for review"    count={result.flagged}    total={result.total} color="#fca5a5" />
                <Bar label="Suppressed (auto)"     count={result.suppressed} total={result.total} color="#86efac" />
                <Divider sx={{ my: 1.5 }} />
                 <Bar label={`High risk (>=${(result.thresholds?.high ?? highThreshold).toFixed(2)})`} count={result.high} total={result.total} color="#dc2626" />
                 <Bar label={`Medium risk (${(result.thresholds?.low ?? lowThreshold).toFixed(2)}-${(result.thresholds?.high ?? highThreshold).toFixed(2)})`} count={result.medium} total={result.total} color="#f59e0b" />
                 <Bar label={`Low risk (<${(result.thresholds?.low ?? lowThreshold).toFixed(2)})`} count={result.low} total={result.total} color="#22c55e" />
                <Box sx={{ mt: 1.5, p: 1.25, bgcolor: '#f8fafc', borderRadius: 1.5 }}>
                  <Typography sx={{ fontSize: 11.5, color: '#1e293b' }}>
                    Average score: <strong style={{ fontFamily: 'monospace' }}>{result.avg.toFixed(3)}</strong>
                    {' · '}HML low/high: <strong style={{ fontFamily: 'monospace' }}>{(result.thresholds?.low ?? lowThreshold).toFixed(2)} / {(result.thresholds?.high ?? highThreshold).toFixed(2)}</strong>
                  </Typography>
                </Box>
              </Box>

              {/* Top 10 highest scoring */}
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.5 }}>
                  Top 10 Highest Scored
                </Typography>
                <Box sx={{ overflow: 'auto', maxHeight: 260 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr>
                        {['#', 'Entity ID', 'Score', 'Decision'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${T.border}`, color: T.textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.top10.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                          <td style={{ padding: '5px 8px', color: T.textDim, fontFamily: 'monospace' }}>{i + 1}</td>
                          <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 10.5 }}>{row.entity_id || row.id || 'â€”'}</td>
                          <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, color: String(row.hml_decision || '').toUpperCase() === 'HIGH' ? '#dc2626' : String(row.hml_decision || '').toUpperCase() === 'MEDIUM' ? '#d97706' : '#16a34a' }}>
                            {(Number(row.probability ?? row.score ?? 0)).toFixed(3)}
                          </td>
                          <td style={{ padding: '5px 8px' }}>
                            <Chip
                              label={String(row.hml_decision || 'LOW').toUpperCase()}
                              size="small"
                              sx={{ height: 18, fontSize: 9.5, fontWeight: 700,
                                bgcolor: String(row.hml_decision || '').toUpperCase() === 'HIGH' ? '#fef2f2' : String(row.hml_decision || '').toUpperCase() === 'MEDIUM' ? '#fffbeb' : '#f0fdf4',
                                color: String(row.hml_decision || '').toUpperCase() === 'HIGH' ? '#dc2626' : String(row.hml_decision || '').toUpperCase() === 'MEDIUM' ? '#b45309' : '#16a34a',
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            </Box>
          )}
        </Stack>
      )}
    </SectionCard>
  );
};

// â”€â”€â”€ Main Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ModelReadyScreen = ({
  persona,
  uploadedDatasets,
  masterDataset,
  targetColumn,
  preprocessedDataset,
  activeModelRun,
  onDeploy,
  onViewReport,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const [deployThreshold, setDeployThreshold] = useState(runThreshold(activeModelRun));
  const [deploying,       setDeploying]       = useState(false);
  const [deployed,        setDeployed]        = useState(false);
  const [deployError,     setDeployError]     = useState(null);
  const [downloading,     setDownloading]     = useState(null);
  const gatingMessage = actionsMessage || 'Deployment readiness actions are blocked because this run is outdated. Rerun the upstream stages first.';

  // Update threshold if model changes
  useEffect(() => {
    setDeployThreshold(runThreshold(activeModelRun));
    setDeployed(false);
    setDeployError(null);
  }, [activeModelRun?.job_id]);

  const aucValue = runAuc(activeModelRun);
  const f1Value = runF1(activeModelRun);
  const precisionValue = runPrecision(activeModelRun);
  const recallValue = runRecall(activeModelRun);
  const trainRows = numOrNull(activeModelRun?.results?.train_rows);
  const featuresUsed = numOrNull(activeModelRun?.results?.features_used) ?? activeModelRun?.results?.feature_names?.length ?? null;

  const checks = [
    { label: 'Data uploaded',           done: (uploadedDatasets || []).length > 0,  desc: `${(uploadedDatasets||[]).length} table${(uploadedDatasets||[]).length !== 1 ? 's' : ''} loaded` },
    { label: 'Master dataset built',    done: !!masterDataset,                        desc: masterDataset ? `${masterDataset.row_count?.toLocaleString()} rows` : 'Not yet built' },
    { label: 'Target variable defined', done: !!targetColumn,                         desc: targetColumn ? `Predicting: ${targetColumn}` : 'Not selected' },
    { label: 'Dataset preprocessed',    done: !!preprocessedDataset,                  desc: preprocessedDataset ? `${preprocessedDataset.row_count?.toLocaleString()} rows Â· ${preprocessedDataset.col_count ?? '?'} features` : 'Not run' },
    { label: 'Model trained',           done: !!activeModelRun,                       desc: activeModelRun ? `${activeModelRun.algorithm} Â· AUC ${aucValue != null ? aucValue.toFixed(3) : '-'}` : 'Select in Step 6' },
  ];
  const allDone = checks.every(c => c.done);

  const handleDeploy = async () => {
    if (!activeModelRun?.job_id) return;
    if (actionsDisabled) {
      setDeployError(gatingMessage);
      return;
    }
    setDeploying(true);
    setDeployError(null);
    try {
      const res = await mlopsApi.deployModel(activeModelRun.job_id, deployThreshold);
      setDeployed(true);
      onDeploy?.(unwrap(res));
    } catch (e) {
      setDeployError(e?.response?.data?.error || 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  const handleDownloadCard = async () => {
    if (!activeModelRun?.job_id) return;
    if (actionsDisabled) {
      setDeployError(gatingMessage);
      return;
    }
    setDownloading('card');
    try {
      const res  = await mlopsApi.exportModel({ job_id: activeModelRun.job_id });
      const data = res?.data?.data || res?.data;
      if (data?.model_card) {
        const blob = new Blob([JSON.stringify(data.model_card, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'model_card.json'; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silent */ }
    finally { setDownloading(null); }
  };

  const handleDownloadPkl = async () => {
    if (!activeModelRun?.job_id) return;
    if (actionsDisabled) {
      setDeployError(gatingMessage);
      return;
    }
    setDownloading('pkl');
    try {
      const res  = await mlopsApi.exportModel({ job_id: activeModelRun.job_id });
      const data = res?.data?.data || res?.data;
      if (data?.pkl_base64) {
        const binary = atob(data.pkl_base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'model.pkl'; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silent */ }
    finally { setDownloading(null); }
  };

  return (
    <Stack spacing={2.5}>
      {/* Deploy success */}
      {deployed && (
        <Alert severity="success" icon={<CheckCircle />} sx={{ borderRadius: 2, fontWeight: 600 }}>
          {persona === 'business'
            ? 'Your model has been deployed. The scoring endpoint is now live.'
            : `Model ${activeModelRun?.job_id?.slice(0, 8)} deployed at threshold ${deployThreshold.toFixed(2)}.`}
        </Alert>
      )}
      {actionsDisabled && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          {gatingMessage}
        </Alert>
      )}

      {/* 1. Pipeline summary */}
      <PipelineSummary
        persona={persona}
        uploadedDatasets={uploadedDatasets}
        masterDataset={masterDataset}
        targetColumn={targetColumn}
        preprocessedDataset={preprocessedDataset}
        activeModelRun={activeModelRun}
      />

      {/* 2. Checklist + model card (side by side) */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Pipeline Checklist</Typography>
            {allDone && (
              <Chip label="Ready" size="small" icon={<CheckCircle sx={{ fontSize: 12 }} />}
                sx={{ height: 20, fontSize: 10.5, bgcolor: T.doneLight, color: '#15803d', border: '1px solid #bbf7d0' }} />
            )}
          </Stack>
          <List dense disablePadding>
            {checks.map(c => <CheckItem key={c.label} {...c} />)}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
            <ModelTraining sx={{ fontSize: 16, color: T.orange }} />
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Model Card</Typography>
          </Stack>
          {activeModelRun ? (
            <>
              <StatRow label="Algorithm"    value={activeModelRun.algorithm} />
              <StatRow label="ROC-AUC"      value={aucValue != null ? aucValue.toFixed(4) : '-'} mono />
              {persona === 'technical' && <>
                <StatRow label={`F1 @ ${runThreshold(activeModelRun).toFixed(2)}`} value={f1Value != null ? f1Value.toFixed(4) : '-'} mono />
                <StatRow label="Precision"    value={precisionValue != null ? precisionValue.toFixed(4) : '-'} mono />
                <StatRow label="Recall"       value={recallValue != null ? recallValue.toFixed(4) : '-'} mono />
              </>}
              <StatRow label="Threshold"    value={`${deployThreshold.toFixed(2)} (active)`} mono highlight />
              <StatRow label="Features"     value={featuresUsed != null ? String(featuresUsed) : '-'} />
              <StatRow label="Training rows" value={trainRows != null ? trainRows.toLocaleString() : '-'} />
              <StatRow label="Job ID"       value={activeModelRun.job_id?.slice(0, 12) + 'â€¦'} mono />
            </>
          ) : (
            <Stack py={2} alignItems="center" spacing={1}>
              <Lock sx={{ fontSize: 32, color: T.textDim }} />
              <Typography sx={{ fontSize: 12.5, color: T.textMuted, textAlign: 'center' }}>
                Select a model in Step 6 to populate this card.
              </Typography>
            </Stack>
          )}
        </Paper>
      </Box>

      {/* 3. Deployment config */}
      <DeployConfigPanel activeModelRun={activeModelRun} onThresholdChange={setDeployThreshold} actionsDisabled={actionsDisabled} />

      {/* 4. Live inference test */}
      <LiveInferencePanel activeModelRun={activeModelRun} persona={persona} actionsDisabled={actionsDisabled} actionsMessage={gatingMessage} />

      {/* 5. Batch scoring */}
      <BatchScoringPanel activeModelRun={activeModelRun} actionsDisabled={actionsDisabled} actionsMessage={gatingMessage} />

      {/* 6. Export + Deploy */}
      <SectionCard title="Export and Deploy" subtitle={allDone ? 'All steps complete â€” ready to go live' : 'Complete all checklist steps before deploying'} icon={RocketLaunch} defaultOpen>
        {deployError && <Alert severity="error" sx={{ borderRadius: 1.5, mb: 2 }}>{deployError}</Alert>}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="large"
            onClick={() => onViewReport?.(activeModelRun?.job_id)}
            disabled={!activeModelRun?.job_id}
            sx={{
              height: 42,
              px: 2.5,
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 600,
              borderColor: T.border,
              color: T.textMuted,
              '&:hover': { borderColor: T.orange, color: T.orange },
            }}
          >
            View Business Report
          </Button>
          <Button
            variant="contained" size="large" onClick={handleDeploy}
            disabled={actionsDisabled || canDisable(!allDone || deploying || deployed)}
            startIcon={deploying ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <RocketLaunch />}
            sx={{ bgcolor: T.orange, '&:hover': { bgcolor: T.orangeHover }, height: 42, px: 3, borderRadius: 2, fontWeight: 700, textTransform: 'none', boxShadow: 'none' }}
          >
            {deploying ? 'Deployingâ€¦' : deployed ? `Deployed at ${deployThreshold.toFixed(2)}` : `Deploy at threshold ${deployThreshold.toFixed(2)}`}
          </Button>
          <Button variant="outlined" size="large" onClick={handleDownloadCard}
            disabled={actionsDisabled || canDisable(!activeModelRun || downloading === 'card')}
            startIcon={downloading === 'card' ? <CircularProgress size={16} /> : <CloudDownload />}
            sx={{ height: 42, px: 2.5, borderRadius: 2, textTransform: 'none', fontWeight: 600, borderColor: T.border, color: T.textMuted, '&:hover': { borderColor: T.orange, color: T.orange } }}>
            Download model card
          </Button>
          <Button variant="outlined" size="large" onClick={handleDownloadPkl}
            disabled={actionsDisabled || canDisable(!activeModelRun || downloading === 'pkl')}
            startIcon={downloading === 'pkl' ? <CircularProgress size={16} /> : <CloudDownload />}
            sx={{ height: 42, px: 2.5, borderRadius: 2, textTransform: 'none', fontWeight: 600, borderColor: T.border, color: T.textMuted, '&:hover': { borderColor: T.orange, color: T.orange } }}>
            Download model (.pkl)
          </Button>
        </Stack>
        {deployed && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: T.doneLight, borderRadius: 1.5, border: `1px solid #bbf7d0` }}>
            <Typography sx={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
              Inference endpoint active. Navigate to Live Dashboard (Step 10) to monitor scoring in real time.
            </Typography>
          </Box>
        )}
      </SectionCard>
    </Stack>
  );
};

export default ModelReadyScreen;

