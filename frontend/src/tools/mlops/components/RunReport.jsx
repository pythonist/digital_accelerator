import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  Assessment,
  AutoGraph,
  CloudDownload,
  FactCheck,
  PictureAsPdf,
  Refresh,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import mlopsApi from '../services/mlopsApi';

const C = {
  orange: '#D04A02',
  orangeSoft: '#fff1ec',
  dark: '#1f2937',
  slate: '#475569',
  border: '#e2e8f0',
  bg: '#f8fafc',
  good: '#15803d',
  warn: '#b45309',
  bad: '#b91c1c',
  info: '#1d4ed8',
};

const pick = (res) => {
  const level1 = res?.data ?? res;
  return level1?.data ?? level1;
};

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString());
const fmtPct = (v, d = 2) => (v == null ? '-' : `${toNum(v).toFixed(d)}%`);
const fmtRatio = (v, d = 4) => (v == null ? '-' : toNum(v).toFixed(d));

const Section = ({ icon: Icon, title, subtitle, children }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
    <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${C.border}`, bgcolor: '#fff' }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {Icon ? <Icon sx={{ fontSize: 16, color: C.orange }} /> : null}
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.dark }}>{title}</Typography>
          {subtitle ? (
            <Typography sx={{ fontSize: 11, color: C.slate }}>{subtitle}</Typography>
          ) : null}
        </Box>
      </Stack>
    </Box>
    <Box sx={{ p: 2 }}>{children}</Box>
  </Paper>
);

const MetricCard = ({ label, value, tone = 'default' }) => {
  const color = tone === 'good' ? C.good : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : C.dark;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, borderColor: C.border, bgcolor: '#fff' }}>
      <Typography sx={{ fontSize: 10, color: C.slate, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 800, color }}>{value}</Typography>
    </Paper>
  );
};

const svgToPngDataUrl = async (svgNode) => {
  if (!svgNode) return null;
  const box = svgNode.getBoundingClientRect();
  const viewBox = svgNode.viewBox && svgNode.viewBox.baseVal
    ? svgNode.viewBox.baseVal
    : null;
  const width = Math.max(1, Math.round(box.width || viewBox?.width || 800));
  const height = Math.max(1, Math.round(box.height || viewBox?.height || 360));

  const cloned = svgNode.cloneNode(true);
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('width', String(width));
  cloned.setAttribute('height', String(height));
  const svgMarkup = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

const collectRenderedChartImages = async () => {
  if (typeof document === 'undefined') return [];
  const containers = Array.from(document.querySelectorAll('[data-report-chart]'));
  const images = [];
  for (const node of containers) {
    const svg = node.querySelector('svg');
    if (!svg) continue;
    const title = String(node.getAttribute('data-chart-title') || 'Report Chart');
    const caption = String(node.getAttribute('data-chart-caption') || '');
    // eslint-disable-next-line no-await-in-loop
    const dataUrl = await svgToPngDataUrl(svg);
    if (!dataUrl) continue;
    images.push({ title, caption, data_url: dataUrl });
  }
  return images;
};

const ConfusionGrid = ({ cm = {} }) => {
  const tn = toNum(cm?.tn, 0);
  const fp = toNum(cm?.fp, 0);
  const fn = toNum(cm?.fn, 0);
  const tp = toNum(cm?.tp, 0);
  const cell = (label, value, bg) => (
    <Box sx={{ p: 1.2, borderRadius: 1.5, border: `1px solid ${C.border}`, bgcolor: bg }}>
      <Typography sx={{ fontSize: 10, color: C.slate }}>{label}</Typography>
      <Typography sx={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 700, color: C.dark }}>
        {fmt(value)}
      </Typography>
    </Box>
  );
  return (
    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {cell('True Negative (correct suppress)', tn, '#f0fdf4')}
      {cell('False Positive (extra review)', fp, '#fff7ed')}
      {cell('False Negative (missed SAR)', fn, '#fef2f2')}
      {cell('True Positive (correct escalate)', tp, '#ecfeff')}
    </Box>
  );
};

const RunReport = ({ runId = null, onRunIdChange, compact = false, showHistory = true }) => {
  const [reports, setReports] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(runId ? String(runId) : '');
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [listError, setListError] = useState('');
  const [reportError, setReportError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareData, setCompareData] = useState(null);
  const [compareError, setCompareError] = useState('');
  const [comparing, setComparing] = useState(false);
  const [reportAudience, setReportAudience] = useState('business');

  useEffect(() => {
    if (runId != null && String(runId).trim()) {
      setSelectedRunId(String(runId));
    }
  }, [runId]);

  const loadReports = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const res = await mlopsApi.listReports({ limit: 200 });
      const rows = pick(res);
      const nextRows = Array.isArray(rows) ? rows : [];
      setReports(nextRows);

      if (!selectedRunId && nextRows.length > 0) {
        const nextId = String(nextRows[0].run_id || '');
        setSelectedRunId(nextId);
        onRunIdChange?.(nextId);
      }

      if (!compareA && nextRows.length > 0) setCompareA(String(nextRows[0].run_id || ''));
      if (!compareB && nextRows.length > 1) setCompareB(String(nextRows[1].run_id || ''));
    } catch (e) {
      setListError(e?.message || 'Failed to load report history.');
      setReports([]);
    } finally {
      setLoadingList(false);
    }
  }, [compareA, compareB, onRunIdChange, selectedRunId]);

  const loadReport = useCallback(async (id) => {
    if (!id) {
      setReport(null);
      setPending(false);
      return;
    }
    setLoadingReport(true);
    setReportError('');
    try {
      const res = await mlopsApi.getReport(id);
      const payload = pick(res);
      if (payload?.status === 'pending') {
        setPending(true);
        setReport(null);
      } else {
        setPending(false);
        setReport(payload || null);
      }
    } catch (e) {
      setReportError(e?.message || 'Failed to load run report.');
      setReport(null);
      setPending(false);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!selectedRunId) return;
    onRunIdChange?.(selectedRunId);
    loadReport(selectedRunId);
  }, [loadReport, onRunIdChange, selectedRunId]);

  const handleGenerate = useCallback(async () => {
    if (!selectedRunId) return;
    setGenerating(true);
    setReportError('');
    try {
      const res = await mlopsApi.generateReport({ run_id: selectedRunId });
      const payload = pick(res);
      const generated = payload?.report || payload;
      setReport(generated || null);
      setPending(false);
      await loadReports();
    } catch (e) {
      setReportError(e?.message || 'Failed to generate report.');
    } finally {
      setGenerating(false);
    }
  }, [loadReports, selectedRunId]);

  const handleCompare = useCallback(async () => {
    if (!compareA || !compareB) return;
    setComparing(true);
    setCompareError('');
    setCompareData(null);
    try {
      const res = await mlopsApi.compareReports(compareA, compareB);
      setCompareData(pick(res) || null);
    } catch (e) {
      setCompareError(e?.message || 'Failed to compare reports.');
    } finally {
      setComparing(false);
    }
  }, [compareA, compareB]);

  const handleDownloadJson = useCallback(() => {
    if (!report) return;
    const safeRunId = String(report?.run_id || selectedRunId || 'run').replace(/[^a-zA-Z0-9_-]/g, '_');
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aml_run_report_${safeRunId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, selectedRunId]);

  const handleDownloadPdf = useCallback(async () => {
    if (!report) return;
    const safeRunId = String(report?.run_id || selectedRunId || 'run').replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const chartImages = await collectRenderedChartImages();
      const pdfBlob = await mlopsApi.downloadReportPdf({
        run_id: report?.run_id || selectedRunId,
        pipeline_id: report?.pipeline_id || null,
        strict_min_pages: true,
        audience: reportAudience,
        chart_images: chartImages,
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aml_run_report_${safeRunId}_${reportAudience}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setReportError(e?.message || 'Failed to download PDF report.');
    }
  }, [report, reportAudience, selectedRunId]);

  const runIdentity = report?.run_identity || {};
  const dataSummary = report?.data_summary || {};
  const edaSummary = report?.eda_summary || {};
  const targetDef = report?.target_definition || {};
  const modelPerf = report?.model_performance || {};
  const threshold = report?.threshold_analysis || {};
  const impact = report?.business_impact || {};
  const governance = report?.governance || {};
  const narratives = report?.narratives || {};

  const chartData = edaSummary?.chart_data || {};
  const classDistribution = useMemo(() => {
    if (Array.isArray(chartData?.class_distribution_chart) && chartData.class_distribution_chart.length > 0) {
      return chartData.class_distribution_chart.map((x) => ({ name: String(x.name || ''), value: toNum(x.value, 0) }));
    }
    const pos = toNum(edaSummary?.class_balance?.positive_pct, 0);
    const neg = toNum(edaSummary?.class_balance?.negative_pct, 0);
    return [
      { name: 'Positive', value: pos },
      { name: 'Negative', value: neg },
    ];
  }, [chartData, edaSummary]);

  const thresholdTable = Array.isArray(threshold?.threshold_table) ? threshold.threshold_table : [];
  const thresholdChart = thresholdTable.map((row) => ({
    threshold: toNum(row.threshold, 0),
    suppression_pct: toNum(row.suppression_pct, row.suppression_rate_pct),
    event_loss_pct: toNum(row.event_loss_pct),
  }));
  const confusionBusinessFallback = useMemo(() => {
    const cm = modelPerf?.confusion_matrix || {};
    const tn = toNum(cm?.tn, 0);
    const fp = toNum(cm?.fp, 0);
    const fn = toNum(cm?.fn, 0);
    const tp = toNum(cm?.tp, 0);
    const total = tn + fp + fn + tp;
    return `Out of ${fmt(total)} scored records, ${fmt(tn)} were correctly auto-suppressed, ${fmt(tp)} were correctly escalated, ${fmt(fp)} were unnecessary escalations, and ${fmt(fn)} were missed SARs.`;
  }, [modelPerf]);
  const thresholdBusinessFallback = useMemo(() => {
    const thr = toNum(threshold?.recommended_threshold, 0.5).toFixed(2);
    const suppression = toNum(threshold?.recommended_suppression_pct, 0).toFixed(2);
    const eventLoss = toNum(threshold?.recommended_event_loss_pct, 0).toFixed(2);
    const limit = toNum(threshold?.regulatory_limit_pct, 5).toFixed(2);
    return `At threshold ${thr}, the model suppresses ${suppression}% of workload and keeps Event Loss at ${eventLoss}% (regulatory cap: ${limit}%).`;
  }, [threshold]);

  const spacing = compact ? 1.5 : 2.5;

  return (
    <Stack spacing={spacing}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: C.border, bgcolor: '#fff' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.25}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Assessment sx={{ fontSize: 18, color: C.orange }} />
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: C.dark }}>Run Report</Typography>
            <Chip
              size="small"
              label={String(runIdentity?.run_type || report?.run_type || 'standalone').toUpperCase()}
              sx={{ height: 22, fontSize: 10.5, bgcolor: C.orangeSoft, color: C.orange, fontWeight: 700 }}
            />
            <Chip
              size="small"
              label={edaSummary?.chart_data ? 'EDA included' : 'EDA backfilled'}
              sx={{ height: 22, fontSize: 10.5, bgcolor: '#eff6ff', color: C.info, fontWeight: 700 }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {showHistory && (
              <FormControl size="small" sx={{ minWidth: 260 }}>
                <InputLabel id="report-run-select">Run</InputLabel>
                <Select
                  labelId="report-run-select"
                  label="Run"
                  value={selectedRunId}
                  onChange={(e) => setSelectedRunId(String(e.target.value || ''))}
                >
                  {(reports || []).map((r) => (
                    <MenuItem key={`${r.report_id || 'report'}-${r.run_id}`} value={String(r.run_id)}>
                      {String(r.run_name || r.run_id)} | {String(r.algorithm || '-')} | AUC {fmtRatio(r.auc, 3)} | {r.has_report ? 'Report ready' : 'Generate on open'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="report-audience-select">Audience</InputLabel>
              <Select
                labelId="report-audience-select"
                label="Audience"
                value={reportAudience}
                onChange={(e) => setReportAudience(String(e.target.value || 'business'))}
              >
                <MenuItem value="business">Business PDF</MenuItem>
                <MenuItem value="technical">Technical PDF</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Refresh sx={{ fontSize: 14 }} />}
              onClick={() => {
                loadReports();
                if (selectedRunId) loadReport(selectedRunId);
              }}
              sx={{ textTransform: 'none', borderColor: C.border, color: C.slate }}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudDownload sx={{ fontSize: 14 }} />}
              onClick={handleDownloadJson}
              disabled={!report}
              sx={{ textTransform: 'none', borderColor: C.border, color: C.slate }}
            >
              Download JSON
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PictureAsPdf sx={{ fontSize: 14 }} />}
              onClick={handleDownloadPdf}
              disabled={!report}
              sx={{ textTransform: 'none', borderColor: C.border, color: C.slate }}
            >
              {reportAudience === 'technical' ? 'Download Technical PDF' : 'Download Business PDF'}
            </Button>
            {pending && (
              <Button
                variant="contained"
                size="small"
                disabled={generating || !selectedRunId}
                onClick={handleGenerate}
                sx={{ textTransform: 'none', bgcolor: C.orange, '&:hover': { bgcolor: '#b83d00' } }}
              >
                {generating ? 'Generating...' : 'Generate Now'}
              </Button>
            )}
          </Stack>
        </Stack>

        {loadingList || loadingReport ? <LinearProgress sx={{ mt: 1.5 }} /> : null}
        {listError ? <Alert severity="error" sx={{ mt: 1.5 }}>{listError}</Alert> : null}
        {reportError ? <Alert severity="error" sx={{ mt: 1.5 }}>{reportError}</Alert> : null}
      </Paper>

      {pending ? (
        <Alert severity="info">
          Report is pending for this run. Use <strong>Generate Now</strong> to create it immediately.
        </Alert>
      ) : null}

      {!report && !pending && !loadingReport ? (
        <Alert severity="warning">No report found for this run yet.</Alert>
      ) : null}

      {report ? (
        <>
          <Section
            icon={AutoGraph}
            title={runIdentity?.run_name || `Run ${String(runIdentity?.run_id || report?.run_id || '').slice(0, 8)}`}
            subtitle={`${runIdentity?.algorithm || '-'} | ${runIdentity?.created_at || '-'} | ${runIdentity?.status || 'completed'}`}
          >
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.problem || 'Run summary unavailable.'}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <MetricCard label="AUC ROC" value={fmtRatio(modelPerf?.test_auc_roc, 3)} />
                <MetricCard label="Suppression" value={fmtPct(threshold?.recommended_suppression_pct, 2)} tone="good" />
                <MetricCard label="Event Loss" value={fmtPct(threshold?.recommended_event_loss_pct, 2)} tone={toNum(threshold?.recommended_event_loss_pct, 0) <= toNum(threshold?.regulatory_limit_pct, 5) ? 'good' : 'bad'} />
                <MetricCard label="Recommended Threshold" value={fmtRatio(threshold?.recommended_threshold, 2)} />
              </Stack>
            </Stack>
          </Section>

          <Section icon={FactCheck} title="Data And Label Summary" subtitle="Inputs, label coverage, and derivation strategy">
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.data || '-'}</Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
                <MetricCard label="Rows Before Exclusion" value={fmt(dataSummary?.total_rows_before_exclusion)} />
                <MetricCard label="Labelled Rows" value={fmt(dataSummary?.labelled_rows)} />
                <MetricCard label="Excluded Rows" value={fmt(dataSummary?.excluded_rows)} />
              </Box>
              <Typography sx={{ fontSize: 11.5, color: C.slate }}>
                Source: <strong>{dataSummary?.label_source || '-'}</strong> | Strategy: <strong>{dataSummary?.label_strategy || '-'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: C.slate }}>{dataSummary?.label_derivation || '-'}</Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, borderColor: C.border }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>Dataset</TableCell>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>Type</TableCell>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>Rows</TableCell>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>Role</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(dataSummary?.datasets_used || []).map((d) => (
                      <TableRow key={`${d.dataset_id}-${d.filename}`}>
                        <TableCell sx={{ fontSize: 11.5 }}>{d.filename || '-'}</TableCell>
                        <TableCell sx={{ fontSize: 11.5 }}>{d.dataset_type || '-'}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmt(d.row_count)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5 }}>{d.role || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </Section>

          <Section icon={FactCheck} title="Target Definition" subtitle="Business label mapping and exclusions">
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.target || '-'}</Typography>
              <Typography sx={{ fontSize: 11.5, color: C.slate }}>
                Source Column: <strong>{targetDef?.source_column || '-'}</strong> | Derived Column: <strong>{targetDef?.derived_column || '-'}</strong>
              </Typography>
              {targetDef?.proxy_warning ? <Alert severity="warning">{targetDef.proxy_warning}</Alert> : null}
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, borderColor: C.border }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>CASE_STATUS</TableCell>
                      <TableCell sx={{ fontSize: 10.5, color: C.slate, fontWeight: 700 }}>Mapped Label</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(targetDef?.mapping || {}).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell sx={{ fontSize: 11.5 }}>{k}</TableCell>
                        <TableCell sx={{ fontSize: 11.5 }}>{String(v)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </Section>

          <Section icon={AutoGraph} title="EDA Snapshot" subtitle="Class balance and score behavior">
            {!edaSummary?.chart_data ? (
              <Alert severity="info">
                EDA was not run as part of this standalone run. Re-run as a full pipeline to include EDA analysis.
              </Alert>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                <Paper
                  variant="outlined"
                  sx={{ p: 1, borderColor: C.border }}
                  data-report-chart
                  data-chart-title="Class Distribution"
                  data-chart-caption="Target class split used to evaluate model balance and expected skew."
                >
                  <Typography sx={{ fontSize: 11, color: C.slate, mb: 0.5 }}>Class Distribution</Typography>
                  <Box sx={{ height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={classDistribution} dataKey="value" nameKey="name" outerRadius={70}>
                          {classDistribution.map((_, idx) => (
                            <Cell key={`class-${idx}`} fill={idx === 0 ? C.orange : '#94a3b8'} />
                          ))}
                        </Pie>
                        <Legend />
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
                <Paper
                  variant="outlined"
                  sx={{ p: 1, borderColor: C.border }}
                  data-report-chart
                  data-chart-title="Risk Score Separation"
                  data-chart-caption="Distribution of true-positive and false-positive counts by score bucket."
                >
                  <Typography sx={{ fontSize: 11, color: C.slate, mb: 0.5 }}>Risk Score Separation</Typography>
                  <Box sx={{ height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData?.risk_score_by_label_chart || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="score_bucket" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RechartsTooltip />
                        <Legend />
                        <Bar dataKey="tp_count" name="TP" fill={C.orange} />
                        <Bar dataKey="fp_count" name="FP" fill="#64748b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
              </Box>
            )}
          </Section>

          <Section icon={AutoGraph} title="Model Performance" subtitle="Confusion matrix and explainers">
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.model || '-'}</Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' } }}>
                <MetricCard label="Precision" value={fmtRatio(modelPerf?.precision, 4)} />
                <MetricCard label="Recall" value={fmtRatio(modelPerf?.recall, 4)} />
                <MetricCard label="F1" value={fmtRatio(modelPerf?.f1, 4)} />
                <MetricCard label="PR AUC" value={fmtRatio(modelPerf?.test_auc_pr, 4)} />
              </Box>
              <ConfusionGrid cm={modelPerf?.confusion_matrix} />
              <Alert severity="info">
                {modelPerf?.confusion_matrix_business_explainer || narratives?.confusion_matrix_business || confusionBusinessFallback}
              </Alert>
            </Stack>
          </Section>

          <Section icon={AutoGraph} title="Threshold And HML" subtitle="Workload vs Event Loss decision curve">
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.threshold || '-'}</Typography>
              <Box
                sx={{ height: 260 }}
                data-report-chart
                data-chart-title="Threshold Curve"
                data-chart-caption="Suppression and event-loss rates across threshold candidates."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={thresholdChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="threshold" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="suppression_pct" name="Suppression %" stroke={C.orange} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="event_loss_pct" name="Event Loss %" stroke="#334155" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              <Alert severity="info">
                {threshold?.business_threshold_explainer || narratives?.thresholds_business || thresholdBusinessFallback}
              </Alert>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, borderColor: C.border, maxHeight: 240 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Threshold</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Suppression %</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Event Loss %</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Precision</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Recall</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {thresholdTable.map((r, idx) => (
                      <TableRow
                        key={`${r.threshold}-${idx}`}
                        sx={{
                          bgcolor: r.recommended ? C.orangeSoft : 'inherit',
                        }}
                      >
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtRatio(r.threshold, 2)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtPct(r.suppression_pct, 2)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtPct(r.event_loss_pct, 2)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtRatio(r.precision, 4)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtRatio(r.recall, 4)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          </Section>

          <Section icon={Assessment} title="Business Impact" subtitle="Operational savings and risk tradeoff">
            <Stack spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.impact || '-'}</Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' } }}>
                <MetricCard label="Suppressed Alerts" value={fmt(impact?.alerts_suppressed)} tone="good" />
                <MetricCard label="Escalated Alerts" value={fmt(impact?.alerts_escalated)} />
                <MetricCard label="Hours Recovered" value={fmt(impact?.hours_recovered)} tone="good" />
                <MetricCard label="Cost Saving" value={`${impact?.cost_currency || ''} ${fmt(impact?.cost_saving_estimate)}`} tone="good" />
              </Box>
              <Typography sx={{ fontSize: 11.5, color: C.slate }}>
                Before: {impact?.before_model?.description || '-'}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: C.slate }}>
                After: {impact?.after_model?.description || '-'}
              </Typography>
            </Stack>
          </Section>

          <Section icon={FactCheck} title="Governance" subtitle="Auditability and model risk controls">
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12, color: C.dark }}>{narratives?.governance || '-'}</Typography>
              {[ 
                ['Label Audit Trail', governance?.label_audit_trail],
                ['Split Strategy', governance?.split_strategy],
                ['Encoder Fit', governance?.encoder_fit],
                ['Event Loss Constraint', governance?.event_loss_constraint],
                ['Retraining Recommendation', governance?.retraining_recommendation],
              ].map(([k, v]) => (
                <Typography key={k} sx={{ fontSize: 11.5, color: C.slate }}>
                  <strong>{k}:</strong> {v || '-'}
                </Typography>
              ))}
              {Array.isArray(governance?.regulatory_frameworks) && governance.regulatory_frameworks.length > 0 ? (
                <Typography sx={{ fontSize: 11.5, color: C.slate }}>
                  <strong>Frameworks:</strong> {governance.regulatory_frameworks.join(', ')}
                </Typography>
              ) : null}
            </Stack>
          </Section>
        </>
      ) : null}

      {showHistory && reports.length >= 2 ? (
        <Section icon={AutoGraph} title="Report Comparison" subtitle="Delta view across two completed runs">
          <Stack spacing={1.25}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="compare-run-a">Run A</InputLabel>
                <Select labelId="compare-run-a" label="Run A" value={compareA} onChange={(e) => setCompareA(String(e.target.value))}>
                  {reports.map((r) => <MenuItem key={`a-${r.report_id || 'report'}-${r.run_id}`} value={String(r.run_id)}>{r.run_name || r.run_id}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="compare-run-b">Run B</InputLabel>
                <Select labelId="compare-run-b" label="Run B" value={compareB} onChange={(e) => setCompareB(String(e.target.value))}>
                  {reports.map((r) => <MenuItem key={`b-${r.report_id || 'report'}-${r.run_id}`} value={String(r.run_id)}>{r.run_name || r.run_id}</MenuItem>)}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                disabled={!compareA || !compareB || comparing}
                onClick={handleCompare}
                sx={{ textTransform: 'none', bgcolor: C.orange, '&:hover': { bgcolor: '#b83d00' } }}
              >
                {comparing ? 'Comparing...' : 'Compare'}
              </Button>
            </Stack>
            {compareError ? <Alert severity="error">{compareError}</Alert> : null}
            {compareData?.deltas ? (
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, borderColor: C.border }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Metric</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Run A</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Run B</TableCell>
                      <TableCell sx={{ fontSize: 10.5, fontWeight: 700 }}>Delta</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(compareData.deltas).map(([metric, val]) => (
                      <TableRow key={metric}>
                        <TableCell sx={{ fontSize: 11.5 }}>{metric}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtRatio(val?.run_a, 4)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{fmtRatio(val?.run_b, 4)}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace', color: toNum(val?.delta, 0) >= 0 ? C.good : C.bad }}>
                          {fmtRatio(val?.delta, 4)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
};

export default RunReport;
