import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Science, QueryStats } from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';
import { V } from './validationTheme';
import { getCurvePoints, unwrap, fmt, pct, num, normalizeLabel } from './validationUtils';
import {
  ConfusionMatrixGrid,
  SectionCard,
  SectionTitle,
  StatCard,
  TableHeader,
} from './ValidationShared';

const OOTValidationTab = ({
  runs = [],
  defaultJobId = '',
  defaultThreshold = null,
  result: controlledResult = null,
  onResultChange = null,
  actionsDisabled = false,
  actionsMessage = '',
}) => {
  const [jobId, setJobId] = useState(defaultJobId || '');
  const [threshold, setThreshold] = useState(0.5);
  const [scenario, setScenario] = useState('steady');
  const [batchSize, setBatchSize] = useState(240);
  const [maxEventLoss, setMaxEventLoss] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [deploymentMeta, setDeploymentMeta] = useState(null);
  const [result, setResult] = useState(controlledResult);
  const gatingMessage = actionsMessage || 'Validation outputs are outdated. Rerun the upstream stages before continuing.';

  useEffect(() => {
    setResult(controlledResult);
  }, [controlledResult]);

  const activeRun = useMemo(
    () => (runs || []).find((r) => String(r?.job_id || '') === String(jobId || '')) || null,
    [runs, jobId],
  );

  useEffect(() => {
    if (!jobId && runs.length > 0) {
      setJobId(String(runs[0]?.job_id || ''));
    }
  }, [jobId, runs]);

  useEffect(() => {
    if (defaultThreshold != null && String(defaultJobId || '') === String(jobId || '')) {
      setThreshold(Number(defaultThreshold));
      return;
    }
    if (!activeRun) return;
    const nextThreshold = Number(
      activeRun?.selected_threshold
      || activeRun?.validation?.optimal_threshold
      || activeRun?.metrics?.optimal_threshold
      || 0.5,
    );
    setThreshold(nextThreshold);
  }, [activeRun, defaultJobId, defaultThreshold, jobId]);

  const runOOTValidation = useCallback(async () => {
    if (!jobId) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setStatusMsg('Resolving deployment context for selected model...');
      const activeDepRes = await mlopsApi.getActiveDeployment();
      const activeDep = unwrap(activeDepRes);

      let dep = activeDep;
      if (!dep?.deployment_id || String(dep?.job_id || '') !== String(jobId)) {
        setStatusMsg('Activating selected model deployment for OOT validation...');
        const swapRes = await mlopsApi.swapDeployment({
          new_job_id: jobId,
          threshold: Number(threshold || 0.5),
          deployment_name: `oot_${String(jobId).slice(0, 8)}`,
          validation_only: true,
        });
        dep = unwrap(swapRes);
      }

      if (!dep?.deployment_id) {
        throw new Error('Unable to resolve deployment for OOT validation');
      }
      setDeploymentMeta(dep);

      setStatusMsg('Generating unseen synthetic out-of-time batch and scoring...');
      const simRes = await mlopsApi.liveSimulate({
        deployment_id: dep.deployment_id,
        run_id: jobId,
        threshold: Number(threshold || 0.5),
        simulation_mode: 'synthetic_pipeline',
        auto_optimize_threshold: true,
        persist_to_ledger: false,
        max_event_loss_pct: Number(maxEventLoss || 5),
        scenario,
        batch_size: Number(batchSize || 240),
      });
      const nextResult = unwrap(simRes);
      setResult(nextResult);
      onResultChange?.(nextResult);
      setStatusMsg('OOT validation completed.');
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to run OOT validation');
    } finally {
      setLoading(false);
    }
  }, [actionsDisabled, batchSize, gatingMessage, jobId, maxEventLoss, onResultChange, scenario, threshold]);

  const oot = result?.oot_validation || null;
  const thresholdTable = oot?.threshold_table || [];
  const stages = result?.pipeline_stages || [];
  const ootRocData = useMemo(
    () => getCurvePoints(oot || {}, 'roc_curve', 'fpr', 'tpr').map((point) => ({ fpr: point.x, tpr: point.y })),
    [oot],
  );
  const ootPrData = useMemo(
    () => getCurvePoints(oot || {}, 'pr_curve', 'recall', 'precision').map((point) => ({ recall: point.x, precision: point.y })),
    [oot],
  );

  return (
    <Stack spacing={2.5}>
      <SectionCard>
        <SectionTitle
          icon={<Science sx={{ fontSize: 18, color: V.orange }} />}
          title="Out-of-Time Validation"
          subtitle="Generate unseen synthetic period data and evaluate the selected model."
        />
        <Typography sx={{ fontSize: 11.5, color: V.textMuted, mb: 1.25 }}>
          OOT validation checks whether the model generalizes to new unseen activity while preserving event-loss controls.
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} useFlexGap alignItems={{ md: 'center' }}>
          <Select
            size="small"
            value={jobId}
            onChange={(e) => setJobId(String(e.target.value || ''))}
            sx={{ minWidth: 260, fontSize: 12 }}
          >
            {(runs || []).map((run) => (
              <MenuItem key={run.job_id} value={run.job_id}>
                {normalizeLabel(run)} - {run.algorithm_display || run.algorithm || run.job_id}
              </MenuItem>
            ))}
          </Select>
          <TextField
            size="small"
            type="number"
            label="Base threshold"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            sx={{ width: 140 }}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
          />
          <TextField
            size="small"
            type="number"
            label="Batch size"
            value={batchSize}
            onChange={(e) => setBatchSize(e.target.value)}
            sx={{ width: 130 }}
            inputProps={{ min: 80, max: 1000, step: 10 }}
          />
          <TextField
            size="small"
            type="number"
            label="Max event loss %"
            value={maxEventLoss}
            onChange={(e) => setMaxEventLoss(e.target.value)}
            sx={{ width: 160 }}
            inputProps={{ min: 0, max: 50, step: 0.5 }}
          />
          <Select
            size="small"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="steady">Steady</MenuItem>
            <MenuItem value="noisy">Noisy</MenuItem>
            <MenuItem value="drifted">Drifted</MenuItem>
            <MenuItem value="bad_data">Bad Data</MenuItem>
          </Select>
          <Button
            variant="contained"
            onClick={runOOTValidation}
            disabled={actionsDisabled || loading || !jobId}
            sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
          >
            {loading ? 'Running OOT...' : 'Run OOT Validation'}
          </Button>
        </Stack>
        {statusMsg && <Alert severity="info" sx={{ mt: 1.25 }}>{statusMsg}</Alert>}
        {actionsDisabled && <Alert severity="warning" sx={{ mt: 1.25 }}>{gatingMessage}</Alert>}
        {deploymentMeta?.deployment_id && (
          <Typography sx={{ fontSize: 11, color: V.textMuted, mt: 1 }}>
            Deployment context: {String(deploymentMeta.deployment_id).slice(0, 12)}... | Run {String(jobId).slice(0, 12)}...
          </Typography>
        )}
      </SectionCard>

      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

      {oot?.defined && (
        <>
          <SectionCard>
            <SectionTitle icon={<QueryStats sx={{ fontSize: 18, color: V.orange }} />} title="OOT Metrics" subtitle="Performance on unseen labelled rows" />
            <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
              <StatCard label="Known Rows" value={fmt(oot.known_rows, 0)} />
              <StatCard label="ROC-AUC" value={oot.roc_auc == null ? '-' : num(oot.roc_auc, 4)} />
              <StatCard label="PR-AUC" value={oot.pr_auc == null ? '-' : num(oot.pr_auc, 4)} />
              <StatCard label="Suppression %" value={pct(oot.suppression_rate_pct)} />
              <StatCard label="Event Loss %" value={pct(oot.event_loss_pct)} tone={(oot.event_loss_pct ?? 0) <= 5 ? 'good' : 'bad'} />
              <StatCard label="Precision / Recall" value={`${num(oot.precision, 3)} / ${num(oot.recall, 3)}`} />
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: V.textMuted, mt: 1.25 }}>
              Interpretation: higher suppression is good only when event loss remains controlled and recall stays stable.
            </Typography>
          </SectionCard>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
            <SectionCard>
              <SectionTitle title="Confusion Matrix" subtitle="Thresholded OOT decisions" />
              <ConfusionMatrixGrid cm={oot.confusion_matrix} />
            </SectionCard>
            <SectionCard>
              <SectionTitle title="ROC / PR Curves" subtitle="Ranking and precision-recall behaviour on unseen data" />
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 10.5, color: V.textMuted, mb: 0.5 }}>ROC</Typography>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={ootRocData} margin={{ top: 4, right: 12, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                      <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <YAxis dataKey="tpr" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="tpr" name="TPR" stroke={V.orange} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 10.5, color: V.textMuted, mb: 0.5 }}>Precision-Recall</Typography>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={ootPrData} margin={{ top: 4, right: 12, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                      <XAxis dataKey="recall" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <YAxis dataKey="precision" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="precision" name="Precision" stroke={V.navy} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Stack>
            </SectionCard>
          </Stack>

          <SectionCard>
            <SectionTitle title="Threshold Tradeoff Table" subtitle="Suppression vs event loss on unseen batch" />
            <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 280 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Threshold', 'Suppression %', 'Event Loss %', 'Precision', 'Recall', 'F1', 'TN', 'FP', 'FN', 'TP'].map((h) => (
                      <TableHeader key={h} text={h} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {thresholdTable.map((row, idx) => (
                    <tr
                      key={`${row.threshold}-${idx}`}
                      style={{
                        borderBottom: `1px solid ${V.border}`,
                        background: row.is_selected ? V.warnLight : 'transparent',
                      }}
                    >
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontFamily: 'monospace', fontWeight: row.is_selected ? 700 : 500 }}>{num(row.threshold, 2)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{pct(row.suppression_rate_pct, 2)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: (row.event_loss_pct ?? 0) <= 5 ? V.good : V.bad }}>{pct(row.event_loss_pct, 2)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{num(row.precision, 4)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{num(row.recall, 4)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{num(row.f1, 4)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.tn, 0)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.fp, 0)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.fn, 0)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fmt(row.tp, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </SectionCard>

          <SectionCard>
            <SectionTitle title="Pipeline Stages" subtitle="Backend simulation steps executed for OOT run" />
            <Stack spacing={0.75}>
              {stages.map((s, idx) => (
                <Paper key={`${s.stage}-${idx}`} variant="outlined" sx={{ p: 1.1, borderRadius: 1.5, borderColor: V.border }}>
                  <Typography sx={{ fontSize: 10.5, color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{s.status || 'done'}</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: V.text }}>{s.stage}</Typography>
                  <Typography sx={{ fontSize: 11, color: V.textMuted }}>{s.detail}</Typography>
                </Paper>
              ))}
            </Stack>
          </SectionCard>
        </>
      )}

      {!loading && !oot?.defined && result && (
        <Alert severity="info">
          OOT run completed but labelled evaluation rows were insufficient for confusion/ROC metrics.
        </Alert>
      )}
    </Stack>
  );
};

export default OOTValidationTab;
