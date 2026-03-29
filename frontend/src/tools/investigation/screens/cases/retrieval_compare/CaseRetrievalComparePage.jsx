import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext, usePersistentState } from '@context/AppContext';
import {
  Alert,
  Button,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  Download as DownloadIcon,
  HelpOutline as HelpIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';

import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import ModuleGuideDrawer from './ModuleGuideDrawer';
import SimilarCasesTab from './SimilarCasesTab';
import CaseComparisonTab from './CaseComparisonTab';
import {
  readInvestigationSettings,
  subscribeInvestigationSettings,
} from '../../../utils/investigationSettings';

const buildDefaultControls = (settings = readInvestigationSettings()) => ({
  baseCaseId: '',
  mode: settings?.case_retrieval?.default_mode || 'Hybrid Similarity',
  topK: settings?.case_retrieval?.default_top_k || 8,
  threshold: settings?.case_retrieval?.default_threshold || 0.35,
  weights: {
    behavioral: settings?.case_retrieval?.default_weights?.behavioral ?? 0.45,
    typology: settings?.case_retrieval?.default_weights?.typology ?? 0.25,
    network: settings?.case_retrieval?.default_weights?.network ?? 0.20,
    alert: settings?.case_retrieval?.default_weights?.alert ?? 0.10,
  },
  filters: {
    same_branch: false,
    same_alert_family: false,
    same_risk_tier: false,
    same_customer_segment: false,
    same_time_period: false,
    branch: '',
    time_period: '',
    outcome_filter: settings?.case_retrieval?.default_outcome_filter || '',
    include_resolved: settings?.case_retrieval?.include_resolved_by_default ?? true,
    include_only_escalated: false,
    include_only_sar_recommended: false,
  },
});

const CaseRetrievalComparePage = () => {
  const { caseList, loadCaseList } = useAppContext();
  const [activeTab, setActiveTab] = usePersistentState('retrieval_compare_tab', 'similar');
  const [controls, setControls] = usePersistentState('retrieval_compare_controls', buildDefaultControls());
  const [similarResults, setSimilarResults] = usePersistentState('retrieval_compare_results', []);
  const [selectedMatches, setSelectedMatches] = usePersistentState('retrieval_compare_selected', []);
  const [comparisonData, setComparisonData] = usePersistentState('retrieval_compare_comparison', null);
  const [similarSortBy, setSimilarSortBy] = usePersistentState('retrieval_compare_sort', 'score');
  const [similarPage, setSimilarPage] = usePersistentState('retrieval_compare_page', 1);
  const [indexStatus, setIndexStatus] = useState(null);
  const [guide, setGuide] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!caseList.length) loadCaseList();
  }, []);

  useEffect(() => {
    if (caseList.length && !controls.baseCaseId) {
      const firstCaseId = String(caseList[0]?.case_id || caseList[0]?.caseid || caseList[0]?.id || '');
      if (firstCaseId) {
        setControls((previous) => ({ ...previous, baseCaseId: firstCaseId }));
      }
    }
  }, [caseList, controls.baseCaseId, setControls]);

  useEffect(() => {
    apiClient.getCaseRetrievalGuide().then(setGuide).catch(() => {});
    apiClient.getCaseRetrievalIndexStatus().then(setIndexStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const applySettings = (latestSettings) => {
      const nextDefaults = buildDefaultControls(latestSettings);
      setControls((previous) => ({
        ...previous,
        mode: nextDefaults.mode,
        topK: nextDefaults.topK,
        threshold: nextDefaults.threshold,
        weights: {
          ...previous.weights,
          ...nextDefaults.weights,
        },
        filters: {
          ...previous.filters,
          outcome_filter: nextDefaults.filters.outcome_filter,
          include_resolved: nextDefaults.filters.include_resolved,
        },
      }));
    };

    applySettings(readInvestigationSettings());
    return subscribeInvestigationSettings(applySettings);
  }, [setControls]);

  const caseOptions = useMemo(
    () => (caseList || []).map((item) => {
      const caseId = String(item?.case_id || item?.caseid || item?.id || '');
      const label = caseId ? `${caseId}${item?.customer_id ? ` | ${item.customer_id}` : ''}` : 'Unknown case';
      return { value: caseId, label };
    }),
    [caseList],
  );

  const handleControlChange = (key, value) => {
    setControls((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const handleSearch = async () => {
    setSearching(true);
    setError('');
    try {
      const response = await apiClient.retrieveSimilarCases({
        base_case_id: controls.baseCaseId,
        mode: controls.mode,
        top_k: controls.topK,
        threshold: controls.threshold,
        weights: controls.weights,
        filters: controls.filters,
      });
      setSimilarResults(response.results || []);
      setSelectedMatches([]);
      setComparisonData(null);
      setSimilarPage(1);
      setIndexStatus((previous) => ({
        ...(previous || {}),
        last_rebuilt_at: response.last_index_refresh || previous?.last_rebuilt_at,
      }));
    } catch (searchError) {
      setError(searchError.message || 'Unable to retrieve similar cases.');
    } finally {
      setSearching(false);
    }
  };

  const handleToggleSelected = (caseId) => {
    setSelectedMatches((previous) => (
      previous.includes(caseId)
        ? previous.filter((item) => item !== caseId)
        : [...previous, caseId]
    ));
  };

  const openComparison = async (explicitCaseIds = null, explicitBaseCaseId = null) => {
    const compareIds = explicitCaseIds || selectedMatches;
    const baseCaseId = explicitBaseCaseId || controls.baseCaseId;
    if (!baseCaseId || compareIds.length < 1) return;
    setComparing(true);
    setError('');
    try {
      const ordered = [baseCaseId, ...compareIds.filter((item) => item !== baseCaseId)];
      const response = await apiClient.compareRetrievedCases({
        base_case_id: baseCaseId,
        case_ids: ordered,
      });
      setComparisonData(response);
      setActiveTab('comparison');
    } catch (compareError) {
      setError(compareError.message || 'Unable to compare selected cases.');
    } finally {
      setComparing(false);
    }
  };

  const handleCompareNow = (caseId) => {
    setSelectedMatches([caseId]);
    openComparison([caseId]);
  };

  const handleExport = () => {
    const payload = activeTab === 'comparison' ? comparisonData : similarResults;
    const blob = new Blob([JSON.stringify(payload || {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeTab === 'comparison' ? 'case_compare_export.json' : 'similar_cases_export.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRebuildIndex = async () => {
    try {
      const response = await apiClient.rebuildCaseRetrievalIndex({ force_rebuild: true });
      setIndexStatus(response);
      setFeedback({ open: true, severity: 'success', message: `Case retrieval index rebuilt for ${response.case_count} cases.` });
    } catch (rebuildError) {
      setFeedback({ open: true, severity: 'error', message: rebuildError.message || 'Unable to rebuild the case retrieval index.' });
    }
  };

  return (
    <PageContainer
      title="Case Retrieval and Compare"
      subtitle="Find behaviorally similar cases using structured risk, transaction, alert, network, and typology signals, then compare them in a single workflow."
      breadcrumbs={['Investigation', 'Case Retrieval and Compare']}
      actions={(
        <Stack direction="row" spacing={1.25}>
          <Button size="small" variant="text" startIcon={<HelpIcon />} onClick={() => setGuideOpen(true)}>
            Guide
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={activeTab === 'similar' ? !similarResults.length : !comparisonData}>
            Export
          </Button>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRebuildIndex}>
            Rebuild Index
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2.25}>
        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}

        {indexStatus ? (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, backgroundColor: '#fcfcfd' }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }}>
              <Stack spacing={0.35}>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                  Retrieval Workspace Status
                </Typography>
                <Typography sx={{ fontSize: 12.75, color: '#475569', lineHeight: 1.7 }}>
                  {indexStatus.case_count
                    ? `Structured case retrieval is ready for ${indexStatus.case_count} indexed cases. Similarity is driven by case behavior, typology, alert, and network signals.`
                    : 'The retrieval index has not been built yet. Rebuild the index once before running similar-case retrieval.'}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                Last refreshed: {indexStatus.last_rebuilt_at || 'Not built'}
              </Typography>
            </Stack>
          </Paper>
        ) : null}

        <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} sx={{ borderBottom: '1px solid #e2e8f0' }}>
          <Tab value="similar" label="Similar Cases" />
          <Tab value="comparison" label="Case Comparison" />
        </Tabs>

        {activeTab === 'similar' ? (
          <SimilarCasesTab
            controls={controls}
            onControlChange={handleControlChange}
            onSearch={handleSearch}
            searching={searching}
            caseOptions={caseOptions}
            results={similarResults}
            selectedCaseIds={selectedMatches}
            onToggleSelected={handleToggleSelected}
            onCompareNow={handleCompareNow}
            onOpenComparison={() => openComparison()}
            sortBy={similarSortBy}
            onSortChange={setSimilarSortBy}
            page={similarPage}
            onPageChange={setSimilarPage}
            comparing={comparing}
          />
        ) : (
          <CaseComparisonTab
            baseCaseId={controls.baseCaseId}
            selectedCaseIds={selectedMatches}
            comparisonData={comparisonData}
            comparing={comparing}
            onOpenComparison={() => openComparison()}
            onOpenPair={(left, right) => {
              setControls((previous) => ({ ...previous, baseCaseId: left }));
              setSelectedMatches([right]);
              openComparison([right], left);
            }}
          />
        )}
      </Stack>

      <ModuleGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} guide={guide} />

      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default CaseRetrievalComparePage;
