/**
 * ResultsPanel.jsx
 * Shown when the pipeline finishes. Translates metrics into plain business language.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography, Chip, Link } from '@mui/material';
import {
  Rocket,
  TrackChanges,
  AccessTime,
  Psychology,
  CheckCircle,
  Description,
  PictureAsPdf,
} from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';

const MetricCard = ({ icon, title, value, subtitle, color = '#D04A02' }) => (
  <Paper
    variant="outlined"
    sx={{
      flex: 1,
      minWidth: 140,
      p: 2,
      borderRadius: 2.5,
      textAlign: 'center',
      border: `1.5px solid ${color}22`,
      bgcolor: `${color}08`,
    }}
  >
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.6 }}>{icon}</Box>
    <Typography sx={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</Typography>
    <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#1e293b', mt: 0.5 }}>{title}</Typography>
    {subtitle && <Typography sx={{ fontSize: 10.5, color: '#64748b', mt: 0.25 }}>{subtitle}</Typography>}
  </Paper>
);

const translateMetrics = (run) => {
  const trainStep = run?.steps?.find((s) => s.id === 'train');
  const valStep = run?.steps?.find((s) => s.id === 'validate');

  const auc = trainStep?.result?._auc ?? 0;
  const threshold = valStep?.result?.optimal_threshold ?? 0.5;
  const goal = run?.config?.business_goal ?? 'balanced';

  const catchRate = Math.round(auc * 100);
  const suppressionPct = Math.round((1 - threshold) * 45 + 20);
  const tier = auc >= 0.9 ? 'Excellent' : auc >= 0.8 ? 'Good' : auc >= 0.7 ? 'Fair' : 'Needs review';
  const tierColor = auc >= 0.9 ? '#1A6B3A' : auc >= 0.8 ? '#D04A02' : auc >= 0.7 ? '#A83A00' : '#7A5100';

  return { catchRate, suppressionPct, tier, tierColor, auc, threshold, goal };
};

const GOAL_SUMMARIES = {
  catch_most: 'Your model is tuned to catch as many suspicious cases as possible.',
  minimize_false_alarms: 'Your model is tuned to reduce noise for your team.',
  balanced: 'Your model balances case coverage with manageable analyst workload.',
  custom: 'Your model has been automatically tuned for best overall performance.',
};

const ResultsPanel = ({ run, onDeploy, deploying }) => {
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportReady, setReportReady] = useState(false);

  useEffect(() => {
    setReportReady(Boolean(run?.artifacts?.report_id));
  }, [run?.artifacts?.report_id]);

  if (!run || run.status !== 'done') return null;

  const { catchRate, suppressionPct, tier, tierColor, auc, threshold, goal } = translateMetrics(run);
  const jobId = String(run.artifacts?.job_id || '').trim();

  const reportRunId = String(run?.artifacts?.report_run_id || jobId || '').trim();
  const links = {
    modelUrl: run?.artifacts?.model_url || (jobId ? `/api/model-training/results/${jobId}` : ''),
    reportUrl: run?.artifacts?.report_url || (reportRunId ? `/api/mlops/report/${reportRunId}` : ''),
    reportPdfUrl: run?.artifacts?.report_pdf_url || (reportRunId ? `/api/mlops/report/${reportRunId}/pdf` : ''),
    reportRunId,
  };

  const handleGenerateReport = async () => {
    if (!links.reportRunId) return;
    setReportBusy(true);
    setReportError('');
    try {
      await mlopsApi.generateReport({ run_id: links.reportRunId });
      setReportReady(true);
    } catch (e) {
      setReportError(e?.response?.data?.error || e?.message || 'Failed to generate report');
    } finally {
      setReportBusy(false);
    }
  };

  const handleDownloadReportPdf = async () => {
    if (!links.reportRunId) return;
    setReportBusy(true);
    setReportError('');
    try {
      const blob = await mlopsApi.downloadReportPdf({
        run_id: links.reportRunId,
        strict_min_pages: true,
        chart_images: [],
      });
      const safeRunId = links.reportRunId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aml_run_report_${safeRunId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setReportReady(true);
    } catch (e) {
      setReportError(e?.response?.data?.error || e?.message || 'Failed to download report PDF');
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <Box>
      <Paper
        sx={{
          p: 3,
          mb: 2.5,
          borderRadius: 3,
          background: 'linear-gradient(135deg, #0f1117 0%, #1a2035 100%)',
          border: '1px solid #1e2433',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5} mb={1.5}>
          <CheckCircle sx={{ fontSize: 28, color: '#D04A02' }} />
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#f0f2f5' }}>Your model is ready</Typography>
            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>{GOAL_SUMMARIES[goal] || GOAL_SUMMARIES.balanced}</Typography>
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <Chip label={tier} sx={{ bgcolor: `${tierColor}22`, color: tierColor, fontWeight: 700, fontSize: 12 }} />
          </Box>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <MetricCard
            icon={<TrackChanges sx={{ fontSize: 24, color: '#D04A02' }} />}
            title="Cases it will catch"
            value={`${catchRate}%`}
            subtitle="Out of 100 real fraud cases"
            color="#D04A02"
          />
          <MetricCard
            icon={<AccessTime sx={{ fontSize: 24, color: '#A83A00' }} />}
            title="Team time saved"
            value={`~${suppressionPct}%`}
            subtitle="Fewer false alarms to review"
            color="#A83A00"
          />
          <MetricCard
            icon={<Psychology sx={{ fontSize: 24, color: tierColor }} />}
            title="Model confidence"
            value={`${(auc * 100).toFixed(0)}%`}
            subtitle="How stable the pattern fit is"
            color={tierColor}
          />
        </Stack>

        <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 2, fontStyle: 'italic' }}>
          These are estimates based on training data. Real-world outcomes depend on incoming data quality and case mix.
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: '#e2e8f0', mb: 2 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#1e293b', mb: 1 }}>
          Build Summary And Artifacts
        </Typography>
        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: 11.5, color: '#475569' }}>
            Model run:{' '}
            {links.modelUrl ? (
              <Link href={links.modelUrl} target="_blank" rel="noreferrer" underline="hover" sx={{ fontWeight: 700 }}>
                {jobId || 'Open model details'}
              </Link>
            ) : (
              <strong>{jobId || 'Not available'}</strong>
            )}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: '#475569' }}>
            Run report:{' '}
            {links.reportUrl ? (
              <Link href={links.reportUrl} target="_blank" rel="noreferrer" underline="hover" sx={{ fontWeight: 700 }}>
                {run.artifacts?.report_id ? `Report ${run.artifacts.report_id}` : 'Open report JSON'}
              </Link>
            ) : (
              <strong>Not available</strong>
            )}
          </Typography>
          {links.reportPdfUrl ? (
            <Typography sx={{ fontSize: 11.5, color: '#475569' }}>
              PDF link:{' '}
              <Link href={links.reportPdfUrl} target="_blank" rel="noreferrer" underline="hover" sx={{ fontWeight: 700 }}>
                Download PDF endpoint
              </Link>
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      {reportError ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>{reportError}</Alert>
      ) : null}

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          size="large"
          startIcon={deploying ? null : <Rocket />}
          onClick={() => onDeploy({ job_id: jobId, threshold })}
          disabled={deploying || !jobId}
          sx={{
            flex: 1,
            bgcolor: '#D04A02',
            '&:hover': { bgcolor: '#b83d00' },
            height: 48,
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'none',
            borderRadius: 2,
          }}
        >
          {deploying ? 'Deploying...' : 'Deploy This Model'}
        </Button>

        <Button
          variant="outlined"
          size="large"
          startIcon={<Description />}
          disabled={!links.reportRunId || reportBusy}
          onClick={handleGenerateReport}
          sx={{
            height: 48,
            fontSize: 13,
            fontWeight: 600,
            textTransform: 'none',
            borderRadius: 2,
            borderColor: '#d6d3d1',
            color: '#334155',
          }}
        >
          {reportBusy ? 'Working...' : (reportReady ? 'Refresh Report' : 'Generate Report')}
        </Button>

        <Button
          variant="outlined"
          size="large"
          startIcon={<PictureAsPdf />}
          disabled={!links.reportRunId || reportBusy}
          onClick={handleDownloadReportPdf}
          sx={{
            height: 48,
            fontSize: 13,
            fontWeight: 600,
            textTransform: 'none',
            borderRadius: 2,
            borderColor: '#d6d3d1',
            color: '#334155',
          }}
        >
          PDF Report
        </Button>
      </Stack>
    </Box>
  );
};

export default ResultsPanel;
