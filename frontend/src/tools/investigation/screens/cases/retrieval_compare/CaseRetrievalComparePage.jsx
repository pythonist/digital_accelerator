import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext, usePersistentState } from '@context/AppContext';
import {
  Alert,
  Box,
  Button,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Download as DownloadIcon,
  HelpOutline as HelpIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';

import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import CaseRetrievalManual from '@investigation/components/guide/CaseRetrievalManual';
import SimilarCasesTab from './SimilarCasesTab';
import CaseComparisonTab from './CaseComparisonTab';
import RebuildIndexModal from './RebuildIndexModal';
import {
  readInvestigationSettings,
  subscribeInvestigationSettings,
} from '../../../utils/investigationSettings';

const formatIndexTime = (isoString) => {
  if (!isoString) return 'Not built yet';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
};

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
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
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
        mode: previous?.mode || nextDefaults.mode,
        topK: previous?.topK || nextDefaults.topK,
        threshold: previous?.threshold !== undefined ? previous.threshold : nextDefaults.threshold,
        weights: {
          ...nextDefaults.weights,
          ...(previous?.weights || {}),
        },
        filters: {
          ...nextDefaults.filters,
          ...(previous?.filters || {}),
        },
      }));
    };

    return subscribeInvestigationSettings(applySettings);
  }, []);

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
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="text" startIcon={<HelpIcon />} onClick={() => setGuideOpen(true)} sx={{ flexShrink: 0, textTransform: 'none', fontWeight: 600 }}>
            Guide
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={activeTab === 'similar' ? !similarResults.length : !comparisonData} sx={{ flexShrink: 0, textTransform: 'none', fontWeight: 600 }}>
            Export
          </Button>

          {/* Inline index status badge directly beside Rebuild Index button */}
          <Tooltip
            title={
              indexStatus?.case_count
                ? `Vector retrieval ready for ${indexStatus.case_count} cases using behavioral, typology, alert, and network embeddings.`
                : 'Vector index has not been built yet. Click Rebuild Index to generate vectors.'
            }
            arrow
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                py: 0.5,
                bgcolor: indexStatus?.case_count ? '#f8fafc' : '#fffbeb',
                border: '1px solid',
                borderColor: indexStatus?.case_count ? '#cbd5e1' : '#fde68a',
                borderRadius: 1.5,
                height: 32,
                flexShrink: 0,
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: indexStatus?.case_count ? '#16a34a' : '#d97706',
                  boxShadow: indexStatus?.case_count ? '0 0 0 2px rgba(22, 163, 74, 0.2)' : 'none',
                  flexShrink: 0,
                }}
              />
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                {indexStatus?.case_count
                  ? `Last built: ${formatIndexTime(indexStatus.last_rebuilt_at)} (${indexStatus.case_count} cases)`
                  : 'Vector index: Not built yet'}
              </Typography>
            </Box>
          </Tooltip>

          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<RefreshIcon />}
            onClick={() => setRebuildModalOpen(true)}
            sx={{
              bgcolor: '#ea580c',
              color: '#ffffff',
              fontWeight: 600,
              textTransform: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              '&:hover': { bgcolor: '#c2410c' },
            }}
          >
            Rebuild Index
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2.25}>
        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}

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

      <CaseRetrievalManual open={guideOpen} onClose={() => setGuideOpen(false)} />

      <RebuildIndexModal
        open={rebuildModalOpen}
        onClose={() => setRebuildModalOpen(false)}
        existingIndexStatus={indexStatus}
        onIndexRebuilt={(freshStatus) => {
          setIndexStatus(freshStatus);
          setFeedback({
            open: true,
            severity: 'success',
            message: `Case retrieval index rebuilt successfully for ${freshStatus.case_count} cases.`,
          });
        }}
      />

      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default CaseRetrievalComparePage;
