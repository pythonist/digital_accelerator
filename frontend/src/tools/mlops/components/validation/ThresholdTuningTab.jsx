import React, { useEffect, useMemo, useState } from 'react';
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
import { unwrap, fmt, num, pct, safeNumber, normalizeLabel } from './validationUtils';
import { SectionCard, SectionTitle, StatCard, ConfusionMatrixGrid, DeltaPill, TableHeader } from './ValidationShared';

const ThresholdTuningTab = ({
  jobId,
  runs,
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
  const [activeJobId, setActiveJobId] = useState(jobId || '');
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

  const chartData = useMemo(() => {
    const rows = report?.threshold_table || [];
    return rows.map((row) => ({
      threshold: Number(row.threshold ?? 0),
      suppression: Number(row.suppression_rate_pct ?? row.suppression_rate ?? 0),
      eventLoss: Number(row.event_loss_pct ?? 0),
      precision: Number(row.precision ?? 0),
      recall: Number(row.recall ?? 0),
    }));
  }, [report]);

  const minThr = chartData.length ? Math.min(...chartData.map((r) => r.threshold)) : 0.1;
  const maxThr = chartData.length ? Math.max(...chartData.map((r) => r.threshold)) : 0.9;

  const runValidation = async () => {
    if (!activeJobId) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoadingReport(true);
    setError(null);
    try {
      const res = await mlopsApi.validationReport({
        job_id: activeJobId,
        max_event_loss_pct: Number(maxEventLoss) || 5,
        optimization_mode: optimizationMode,
        target_suppression_pct:
          optimizationMode === 'target_suppression'
            ? Number(targetSuppression)
            : undefined,
      });
      const data = unwrap(res);
      const table = data?.threshold_table || [];
      const optimalThr = Number(data?.optimal_threshold ?? 0.5);
      const optimalRow = table.find((r) => Math.abs(Number(r.threshold ?? 0) - optimalThr) < 1e-6) || table[0];
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
      });
      onValidationComplete?.({
        ...data,
        job_id: activeJobId,
        algorithm: (runs || []).find((run) => String(run?.job_id || '') === String(activeJobId || ''))?.algorithm,
      });
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to generate validation report');
    } finally {
      setLoadingReport(false);
    }
  };

  const applyThreshold = async (thr = selectedThreshold) => {
    if (!activeJobId) return;
    if (actionsDisabled) {
      setError(gatingMessage);
      return;
    }
    setLoadingThreshold(true);
    setError(null);
    try {
      const res = await mlopsApi.thresholdScore({
        job_id: activeJobId,
        threshold: Number(thr),
      });
      const data = unwrap(res);
      setSelectedThreshold(Number(data?.threshold ?? thr));
      setSelectedScore({
        threshold: Number(data?.threshold ?? thr),
        confusion_matrix: data?.confusion_matrix || [[0, 0], [0, 0]],
        suppression_rate_pct: Number(data?.suppression_rate_pct ?? 0),
        event_loss_pct: Number(data?.event_loss_pct ?? 0),
        precision: Number(data?.precision ?? 0),
        recall: Number(data?.recall ?? 0),
        f1: Number(data?.f1 ?? 0),
        specificity: Number(data?.specificity ?? 0),
        accuracy: Number(data?.accuracy ?? 0),
      });
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to score threshold');
    } finally {
      setLoadingThreshold(false);
    }
  };

  const useRecommended = () => {
    if (!report) return;
    const table = report?.threshold_table || [];
    const optimal = Number(report?.optimal_threshold ?? 0.5);
    const optimalRow = table.find((r) => Math.abs(Number(r.threshold ?? 0) - optimal) < 1e-6) || table[0];
    const cm = optimalRow
      ? [[Number(optimalRow.tn ?? 0), Number(optimalRow.fp ?? 0)], [Number(optimalRow.fn ?? 0), Number(optimalRow.tp ?? 0)]]
      : [[0, 0], [0, 0]];
    setSelectedThreshold(optimal);
    setSelectedScore({
      threshold: optimal,
      confusion_matrix: cm,
      suppression_rate_pct: Number(optimalRow?.suppression_rate_pct ?? 0),
      event_loss_pct: Number(optimalRow?.event_loss_pct ?? 0),
      precision: Number(optimalRow?.precision ?? 0),
      recall: Number(optimalRow?.recall ?? 0),
      f1: Number(optimalRow?.f1 ?? 0),
      specificity: Number(optimalRow?.specificity ?? 0),
      accuracy: Number(optimalRow?.accuracy ?? 0),
    });
  };

  const recommended = useMemo(() => {
    if (!report) return null;
    const table = report?.threshold_table || [];
    const optimalThr = Number(report?.optimal_threshold ?? 0.5);
    const optimalRow = table.find((r) => Math.abs(Number(r.threshold ?? 0) - optimalThr) < 1e-6) || table[0];
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

  return (
    <Stack spacing={2.5}>
      {!activeJobId && (!Array.isArray(runs) || runs.length === 0) && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          No trained model runs found. Complete Stage 6 to enable threshold tuning.
        </Alert>
      )}

      <SectionCard>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
          <SectionTitle
            icon={<Tune sx={{ fontSize: 18, color: V.orange }} />}
            title="Threshold Tuning"
            subtitle="Constraint-based optimization with interactive rescoring."
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Select
              size="small"
              value={activeJobId}
              onChange={(e) => setActiveJobId(e.target.value)}
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
              label="Max Event Loss %"
              value={maxEventLoss}
              onChange={(e) => setMaxEventLoss(e.target.value)}
              sx={{ width: 160 }}
              inputProps={{ min: 0, max: 50, step: 0.5 }}
            />
            <Select
              size="small"
              value={optimizationMode}
              onChange={(e) => setOptimizationMode(e.target.value)}
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
                label="Target Suppression %"
                value={targetSuppression}
                onChange={(e) => setTargetSuppression(e.target.value)}
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
              {loadingReport ? 'Running...' : 'Run Validation'}
            </Button>
          </Stack>
        </Stack>
      </SectionCard>

      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      {actionsDisabled && <Alert severity="warning" sx={{ borderRadius: 2 }}>{gatingMessage}</Alert>}

      {report && (
        <>
          {!report.constraint_satisfied && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              No threshold satisfies Event Loss {'<='} {num(report.max_event_loss_pct, 2)}%. Recommendation is fallback near 0.50.
            </Alert>
          )}
          {report.selection_note && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {report.selection_note}
            </Alert>
          )}

          <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
            <StatCard label="Recommended Threshold" value={num(report.optimal_threshold, 2)} tone="good" />
            <StatCard label="Expected Suppression" value={pct(report.suppression_rate_pct, 2)} tone="good" />
            <StatCard label="Expected Event Loss" value={pct(report.event_loss_pct, 2)} tone={(report.event_loss_pct ?? 0) <= (Number(maxEventLoss) || 5) ? 'good' : 'bad'} />
            <StatCard label="Precision" value={fmt(report.precision, 4)} />
            <StatCard label="Recall" value={fmt(report.recall, 4)} />
            <StatCard label="F1" value={fmt(report.f1, 4)} />
          </Stack>

          <SectionCard>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>
              Threshold Tuning Curve
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" />
                <XAxis dataKey="threshold" tick={{ fontSize: 11 }} type="number" domain={[minThr, maxThr]} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <ReferenceLine
                  y={Number(report.max_event_loss_pct ?? maxEventLoss)}
                  stroke={V.bad}
                  strokeDasharray="3 3"
                  label={{ value: `Max Event Loss (${num(report.max_event_loss_pct ?? maxEventLoss, 1)}%)`, fill: V.bad, fontSize: 11, position: 'insideBottomRight' }}
                />
                <ReferenceLine
                  x={Number(report.optimal_threshold ?? 0.5)}
                  stroke={V.orange}
                  strokeDasharray="6 4"
                  label={{ value: `Optimal ${num(report.optimal_threshold, 2)}`, fill: V.orange, fontSize: 11, position: 'insideTopLeft' }}
                />
                {report.target_suppression_pct != null && (
                  <ReferenceLine
                    y={Number(report.target_suppression_pct)}
                    stroke={V.purple}
                    strokeDasharray="5 4"
                    label={{
                      value: `Target Suppression (${num(report.target_suppression_pct, 1)}%)`,
                      fill: V.purple,
                      fontSize: 11,
                      position: 'insideTopRight',
                    }}
                  />
                )}
                <Line type="monotone" dataKey="suppression" stroke={V.navy} strokeWidth={2.25} name="Suppression Rate %" dot={{ r: 2.2 }} />
                <Line type="monotone" dataKey="eventLoss" stroke={V.orange} strokeWidth={2.25} strokeDasharray="6 3" name="Event Loss %" dot={{ r: 2.2 }} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 0.8 }}>
              Try Another Threshold
            </Typography>
            <Stack spacing={1.2}>
              <Box sx={{ px: 1.2 }}>
                <Slider
                  min={minThr}
                  max={maxThr}
                  step={0.01}
                  value={Number(selectedThreshold)}
                  onChange={(_, v) => setSelectedThreshold(Array.isArray(v) ? v[0] : v)}
                  valueLabelDisplay="auto"
                  sx={{ color: V.orange }}
                />
              </Box>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
                <TextField
                  size="small"
                  type="number"
                  label="Selected threshold"
                  value={num(selectedThreshold, 2)}
                  onChange={(e) => setSelectedThreshold(Number(e.target.value || 0.5))}
                  inputProps={{ min: minThr, max: maxThr, step: 0.01 }}
                  sx={{ width: 180 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => applyThreshold(selectedThreshold)}
                  disabled={actionsDisabled || loadingThreshold}
                  sx={{ bgcolor: V.orange, '&:hover': { bgcolor: '#d46b1f' }, textTransform: 'none', fontWeight: 700 }}
                >
                  {loadingThreshold ? 'Applying...' : 'Apply Threshold'}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={useRecommended}
                  disabled={actionsDisabled}
                  sx={{ textTransform: 'none', fontWeight: 700, borderColor: V.border, color: V.textMuted }}
                >
                  Use Recommended
                </Button>
              </Stack>

              {active && (
                <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
                  <StatCard label="Active Suppression" value={pct(active.suppression_rate_pct, 2)} sub="vs recommended" tone="good" />
                  <DeltaPill value={suppressionDelta} />
                  <StatCard label="Active Event Loss" value={pct(active.event_loss_pct, 2)} sub="vs recommended" tone={active.event_loss_pct <= (Number(maxEventLoss) || 5) ? 'good' : 'bad'} />
                  <DeltaPill value={eventLossDelta} />
                  <StatCard label="Active Precision" value={fmt(active.precision, 4)} sub="vs recommended" />
                  <DeltaPill value={precisionDelta} />
                  <StatCard label="Active Recall" value={fmt(active.recall, 4)} sub="vs recommended" />
                  <DeltaPill value={recallDelta} />
                </Stack>
              )}
            </Stack>
          </SectionCard>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25}>
            <SectionCard>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>
                Confusion Matrix @ Recommended
              </Typography>
              <ConfusionMatrixGrid cm={report.confusion_matrix} />
            </SectionCard>
            <SectionCard>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>
                Confusion Matrix @ Active
              </Typography>
              <ConfusionMatrixGrid cm={active?.confusion_matrix || report.confusion_matrix} />
            </SectionCard>
          </Stack>

          <SectionCard>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: V.text, mb: 1 }}>
              Threshold Metrics Table
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Threshold', 'Supp %', 'Event Loss %', 'Precision', 'Recall', 'F1', 'Specificity', 'TP', 'FP', 'FN', 'TN', 'Action'].map((h) => (
                      <TableHeader key={h} text={h} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(report.threshold_table || []).map((row) => {
                    const rowThr = Number(row.threshold ?? 0);
                    const isRecommended = Math.abs(rowThr - Number(report.optimal_threshold ?? 0.5)) < 0.0001;
                    const isActive = Math.abs(rowThr - Number(active?.threshold ?? report.optimal_threshold ?? 0.5)) < 0.0001;
                    return (
                      <tr
                        key={`thr-${rowThr}`}
                        style={{
                          background: isActive ? '#FFF7ED' : isRecommended ? '#ECFDF3' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelectedThreshold(rowThr)}
                      >
                        <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: isRecommended ? 700 : 500 }}>{num(rowThr, 2)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{num(row.suppression_rate_pct ?? row.suppression_rate ?? 0, 2)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px', color: (row.event_loss_pct ?? 0) <= (Number(maxEventLoss) || 5) ? V.good : V.bad }}>
                          {num(row.event_loss_pct ?? 0, 2)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmt(row.precision ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmt(row.recall ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmt(row.f1 ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmt(row.specificity ?? 0, 4)}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{row.tp ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{row.fp ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{row.fn ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>{row.tn ?? '-'}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px' }}>
                          <Button
                            size="small"
                            variant="text"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedThreshold(rowThr);
                              applyThreshold(rowThr);
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
    </Stack>
  );
};

export default ThresholdTuningTab;
