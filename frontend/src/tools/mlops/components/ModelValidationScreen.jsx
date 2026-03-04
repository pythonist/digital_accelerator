import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { V } from './validation/validationTheme';
import { unwrap, normalizeLabel } from './validation/validationUtils';
import { DarkHeader, SectionCard } from './validation/ValidationShared';
import OverviewTab from './validation/OverviewTab';
import ComparisonTab from './validation/ComparisonTab';
import ThresholdTuningTab from './validation/ThresholdTuningTab';
import StabilityRisksTab from './validation/StabilityRisksTab';
import OOTValidationTab from './validation/OOTValidationTab';
import mlopsApi from '../services/mlopsApi';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'comparison', label: 'Model Comparison' },
  { id: 'threshold', label: 'Threshold Tuning' },
  { id: 'oot', label: 'OOT Validation' },
  { id: 'stability', label: 'Stability & Risks' },
];

const ModelValidationScreen = ({ persona, jobId, activeModelRun, onValidationComplete, onActiveRunChange }) => {
  const resolvedJobId = jobId || activeModelRun?.job_id || '';
  const [activeTab, setActiveTab] = useState(0);
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [compareData, setCompareData] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(resolvedJobId || '');

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const res = await mlopsApi.listTrainingRuns({ limit: 200 });
      const data = unwrap(res);
      setRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load training runs');
    } finally {
      setLoadingRuns(false);
    }
  }, []);

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
    if (!selectedJobIds.length) return;
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

  const handlePromoteChampion = useCallback(async (job_id) => {
    if (!job_id) return;
    try {
      await mlopsApi.workbenchChampion({ job_id });
      await loadSummary();
      await loadRuns();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to promote champion');
    }
  }, [loadSummary, loadRuns]);

  const handleArchive = useCallback(async (job_id) => {
    if (!job_id) return;
    try {
      await mlopsApi.updateRegistryStage(job_id, { stage: 'archived' });
      await loadRuns();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to archive model');
    }
  }, [loadRuns]);

  const handleBulkLabel = useCallback(async (labels) => {
    try {
      await mlopsApi.workbenchBulkLabel({ labels });
      await loadRuns();
      await loadCompare();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update labels');
    }
  }, [loadRuns, loadCompare]);

  useEffect(() => {
    loadRuns();
    loadSummary();
  }, [loadRuns, loadSummary]);

  useEffect(() => {
    if (resolvedJobId && resolvedJobId !== currentJobId) setCurrentJobId(resolvedJobId);
  }, [resolvedJobId, currentJobId]);

  useEffect(() => {
    if (!selectedJobIds.length && runs.length) {
      setSelectedJobIds([runs[0].job_id]);
    }
  }, [runs, selectedJobIds.length]);

  useEffect(() => {
    if (!currentJobId) return;
    setSelectedJobIds((prev) => {
      if (prev.includes(currentJobId)) return prev;
      return [currentJobId, ...prev].slice(0, 4);
    });
  }, [currentJobId]);

  useEffect(() => {
    if ((activeTab === 1 || activeTab === 4) && selectedJobIds.length) {
      loadCompare();
    }
  }, [activeTab, selectedJobIds, loadCompare]);

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
    if (activeModel?.job_id) onActiveRunChange?.(activeModel);
  }, [activeModel, onActiveRunChange]);

  const headerSubtitle = activeModel
    ? `Active model: ${normalizeLabel(activeModel)} | ${activeModel.algorithm_display || activeModel.algorithm}`
    : 'Select a model run to begin validation.';

  return (
    <Stack spacing={2.5} sx={{ bgcolor: V.canvas, p: 0.5 }}>
      <DarkHeader
        title="Stage 8 - Validation and Threshold Tuning"
        subtitle={headerSubtitle}
        right={loadingRuns ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : null}
      />

      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

      {!effectiveJobId && !loadingRuns && runs.length === 0 && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          Train at least one model in Stage 6 before running validation.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', borderColor: V.border }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{
            bgcolor: '#F8FAFC',
            borderBottom: `1px solid ${V.border}`,
            '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 700 },
            '& .Mui-selected': { color: V.orange },
            '& .MuiTabs-indicator': { bgcolor: V.orange, height: 3 },
          }}
        >
          {tabs.map((tab) => (
            <Tab key={tab.id} label={tab.label} />
          ))}
        </Tabs>
      </Paper>

      <Box>
        {activeTab === 0 && (
          <OverviewTab
            summary={summary}
            runs={runs}
            activeModel={activeModel}
            onPromoteChampion={handlePromoteChampion}
            persona={persona}
          />
        )}

        {activeTab === 1 && (
          <ComparisonTab
            runs={runs}
            selectedJobIds={selectedJobIds}
            onSelectJobIds={setSelectedJobIds}
            compareData={compareData}
            loading={compareLoading}
            onCompare={loadCompare}
            onPromoteChampion={handlePromoteChampion}
            onArchive={handleArchive}
            onBulkLabel={handleBulkLabel}
          />
        )}

        {activeTab === 2 && (
          <ThresholdTuningTab
            jobId={effectiveJobId}
            runs={runs}
            onJobChange={setCurrentJobId}
            onValidationComplete={onValidationComplete}
          />
        )}

        {activeTab === 3 && (
          <OOTValidationTab
            runs={runs}
            defaultJobId={effectiveJobId}
          />
        )}

        {activeTab === 4 && (
          <StabilityRisksTab compareData={compareData} />
        )}
      </Box>

      <SectionCard>
        <Typography sx={{ fontSize: 11.5, color: V.textMuted }}>
          This workbench helps you compare models, tune thresholds, and communicate risk tradeoffs to business stakeholders.
        </Typography>
      </SectionCard>
    </Stack>
  );
};

export default ModelValidationScreen;
