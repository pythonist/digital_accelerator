// frontend/src/tools/calibration/screens/PopulationDefinitionScreen.jsx
import React, { useState, useEffect } from 'react';
import { Box, Grid } from '@mui/material';
import PageContainer from '../layout/PageContainer';
import { useCalibration } from '../context/CalibrationContext';
import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';

// Import components
import ContextHeader from '../components/population/ContextHeader';
import FilterSection from '../components/population/FilterSection';
import ImpactMetrics from '../components/population/ImpactMetrics';
import PopulationNarrativeBox from '../components/PopulationNarrativeBox';
import CardinalityPreviewPanel from '../components/CardinalityPreviewPanel';
import ExcludedPopulationPanel from '../components/ExcludedPopulationPanel';
import FilterDependencyWarnings from '../components/FilterDependencyWarnings';
import SamplePreviewTable from '../components/population/SamplePreviewTable';

const PopulationDefinitionScreen = () => {
  const { run, confirmAndContinue } = useCalibration();
  const { activeEnv } = useAppContext();

  const [filters, setFilters] = useState({
    transaction_filters: { transaction_category: [], transaction_direction: [], min_amount: '', max_amount: '' },
    customer_filters: { customer_risk_rating: [], customer_type: [], pep_flag: '' },
    account_filters: { account_status: [], account_type: [] }
  });

  const [liveStats, setLiveStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [availableFilters, setAvailableFilters] = useState(null);
  const [showPreview, setShowPreview] = useState(true);

  // Load scenario defaults if available
  useEffect(() => {
    if (run?.scenario_template?.step1_defaults) {
      setFilters(prev => ({
        transaction_filters: { ...prev.transaction_filters, ...run.scenario_template.step1_defaults },
        customer_filters: prev.customer_filters,
        account_filters: prev.account_filters
      }));
    }
  }, [run?.scenario_template]);

  useEffect(() => {
    if (activeEnv && run?.run_id) loadAvailableFilters();
  }, [activeEnv, run?.run_id]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (run?.run_id) {
        fetchLivePreview();
        fetchEnhancedStats();
        fetchNarrative();
        if (showPreview) fetchDataSample();
      }
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [filters, run?.run_id, showPreview]);

  const loadAvailableFilters = async () => {
    try {
      const res = await apiClient.get(`/api/v2/calibration/population/${run.run_id}/filter-options`, { params: { env_id: activeEnv } });
      setAvailableFilters(res.filters);
    } catch (err) { console.error('Filter options failed:', err); }
  };

  const fetchLivePreview = async () => {
    try {
      const res = await apiClient.post(`/api/v2/calibration/population/${run.run_id}/explore`, { env_id: activeEnv, filters });
      setLiveStats(res.stats);
    } catch (err) { console.error('Preview failed:', err); }
  };

  const fetchEnhancedStats = async () => {
    try {
      const res = await apiClient.post(`/api/v2/calibration/population/${run.run_id}/enhanced-stats`, { env_id: activeEnv, filters });
      setEnhancedStats(res.stats);
    } catch (err) { console.error('Enhanced stats failed:', err); }
  };

  const fetchNarrative = async () => {
    try {
      const res = await apiClient.post(`/api/v2/calibration/population/${run.run_id}/narrative`, {
        scenario_name: run.scenario_name || 'Scenario',
        filters,
        stats: liveStats
      });
      setNarrative(res.narrative);
    } catch (err) { console.error('Narrative failed:', err); }
  };

  const fetchDataSample = async () => {
    try {
      const res = await apiClient.post(`/api/v2/calibration/population/${run.run_id}/preview`, { env_id: activeEnv, filters });
      if (res.success) setPreviewData(res.preview);
    } catch (err) { console.error('Sample preview failed:', err); }
  };

  const handleFilterChange = (section, field, value) => {
    setFilters(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  };

  return (
    <PageContainer title="Step 1: Population Definition" subtitle="Define transaction universe for scenario analysis">
      <ContextHeader />
      
      {narrative && <PopulationNarrativeBox narrative={narrative} />}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <FilterSection
            filters={filters}
            availableFilters={availableFilters}
            onFilterChange={handleFilterChange}
          />

          {showPreview && (
            <SamplePreviewTable previewData={previewData} />
          )}
        </Grid>

        <Grid item xs={12} md={4}>
          <ImpactMetrics liveStats={liveStats} />
          
          {enhancedStats?.warnings && (
            <FilterDependencyWarnings warnings={enhancedStats.warnings} />
          )}
          
          {enhancedStats?.cardinality && (
            <CardinalityPreviewPanel cardinality={enhancedStats.cardinality} />
          )}
          
          {enhancedStats?.excluded_summary && (
            <ExcludedPopulationPanel excluded={enhancedStats.excluded_summary} />
          )}
        </Grid>
      </Grid>
    </PageContainer>
  );
};

export default PopulationDefinitionScreen;