// frontend/src/tools/btsy/screens/calibration/transaction_universe/TransactionUniverseScreen.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, Grid, Alert, Card, Accordion, AccordionSummary, AccordionDetails, Chip, FormControl, InputLabel, Select, MenuItem, Stack, LinearProgress } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Info as InfoIcon } from '@mui/icons-material';
import btsyApi from '@btsy/services/btsyApi';
import { useTransactionUniverses } from './hooks/useTransactionUniverses';
import SnapshotContextCard from './components/SnapshotContextCard';
import UniverseFilterBuilder from './components/UniverseFilterBuilder';
import UniverseHistoryTable from './components/UniverseHistoryTable';
import UniverseDashboardPanel from './components/UniverseDashboardPanel';
import UniverseCatalogPanel from './components/UniverseCatalogPanel';

/**
 * Transaction Universe Screen - Main Orchestrator
 */
const TransactionUniverseScreen = ({ calibrationRunId, snapshotId, onComplete, navigateTo }) => {
  const [snapshotInfo, setSnapshotInfo] = useState(null);
  const [previewMetrics, setPreviewMetrics] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [selectedUniverse, setSelectedUniverse] = useState(null);
  const [error, setError] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState(() => sessionStorage.getItem('btsy_selected_scenario_id') || '');
  const [scenarioPreset, setScenarioPreset] = useState(null);
  const [toast, setToast] = useState('');
  const selectedScenario = useMemo(() => {
    if (!scenarioId) return null;
    return (scenarios || []).find((s) => String(s.scenario_id) === String(scenarioId)) || null;
  }, [scenarios, scenarioId]);

  // Use custom hook for universe management
  const {
    universes,
    loading,
    error: universeError,
    createUniverse,
    freezeUniverse,
    deleteUniverse,
    refresh: refreshUniverses
  } = useTransactionUniverses(calibrationRunId, snapshotId);

  // Load snapshot info on mount
  useEffect(() => {
    if (snapshotId) {
      loadSnapshotInfo();
    }
  }, [snapshotId]);

  useEffect(() => {
    const loadScenarios = async () => {
      try {
        const res = await btsyApi.scenarios.list(null, 'ACTIVE');
        if (res.success) setScenarios(res.data || []);
      } catch (e) {
      }
    };
    loadScenarios();
  }, []);

  useEffect(() => {
    const applyScenario = async () => {
      if (!scenarioId) {
        setScenarioPreset(null);
        return;
      }
      try {
        const res = await btsyApi.scenarios.get(scenarioId);
        if (!res.success) return;
        const sj = res.data?.scenario_json || {};
        const filters = (sj.universe || {}).filters || {};
        const preset = {};

        const cats = filters.transaction_type || filters.transaction_category || filters.categories;
        if (Array.isArray(cats) && cats.length > 0) preset.categories = cats;

        const types = filters.types;
        if (Array.isArray(types) && types.length > 0) preset.types = types;

        preset.universe_name = sj.name ? `${sj.name} Universe` : undefined;
        preset.description = sj.description || undefined;

        setScenarioPreset(preset);
      } catch (e) {
        setScenarioPreset(null);
      }
    };
    applyScenario();
  }, [scenarioId]);

  // Refresh universes when calibrationRunId changes
  useEffect(() => {
    if (calibrationRunId && refreshUniverses) {
      refreshUniverses();
    }
  }, [calibrationRunId]);
  
  useEffect(() => {
    const loadSelected = async () => {
      if (!calibrationRunId) return;
      try {
        const res = await btsyApi.universe.getSelected(calibrationRunId);
        if (res.success && res.data) {
          setSelectedUniverse(res.data);
          const statsRes = await btsyApi.universe.getUniverseStats(res.data.id);
          if (statsRes.success) setDashboardStats(statsRes.data);
        }
      } catch {}
    };
    loadSelected();
  }, [calibrationRunId]);

  const loadSnapshotInfo = async () => {
    try {
      const response = await btsyApi.snapshot.getSnapshot(snapshotId);
      if (response.success) {
        setSnapshotInfo(response.data);
      }
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      setError('Failed to load snapshot information');
    }
  };

  const handlePreview = async (universeData) => {
    try {
      setError(null);
      
      const completeData = {
        ...universeData,
        calibration_run_id: calibrationRunId,
        scenario_id: scenarioId || null,
        snapshot_id: snapshotId
      };
      
      console.log('[UNIVERSE] Creating with data:', completeData);
      
      const result = await createUniverse(completeData);
      setPreviewMetrics(result.metrics);
      setToast('Universe created. Review stats and freeze when ready.');
      await refreshUniverses();
      const createdUniverseId = result.universe_id || result.id;
      if (createdUniverseId) {
        const statsRes = await btsyApi.universe.getUniverseStats(createdUniverseId);
        if (statsRes.success) setDashboardStats(statsRes.data);
      }
      
    } catch (err) {
      console.error('[UNIVERSE] Creation error:', err);
      setError(err.message || 'Failed to create universe');
    }
  };

  const handleFreeze = async (universeId) => {
    if (!window.confirm('Freeze this universe? This action is irreversible and makes the universe immutable.')) {
      return;
    }

    try {
      setError(null);
      await freezeUniverse(universeId);
      await refreshUniverses();
    } catch (err) {
      setError(err.message || 'Failed to freeze universe');
    }
  };

  const handleDelete = async (universeId) => {
    if (!window.confirm('Delete this draft universe? This action cannot be undone.')) {
      return;
    }

    try {
      setError(null);
      await deleteUniverse(universeId);
      await refreshUniverses();
    } catch (err) {
      setError(err.message || 'Failed to delete universe');
    }
  };

  const handleViewUniverse = async (universeId) => {
    try {
      setError(null);
      const res = await btsyApi.universe.getUniverseStats(universeId);
      if (res.success) {
        setDashboardStats(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load universe statistics');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#1e293b', mb: 1 }}>
          Transaction Universe Definition
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 800 }}>
          Define which transactions are relevant for this calibration scenario. Use filters to create 
          specific transaction universes that match your analysis criteria.
        </Typography>
      </Box>
      {loading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Card sx={{ mb: 3, border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Box sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid item xs={12} md={6}>
              <Stack spacing={1}>
              <FormControl size="small" fullWidth sx={{ minWidth: 320 }}>
                <InputLabel>Scenario (optional)</InputLabel>
                <Select
                  value={scenarioId}
                  label="Scenario (optional)"
                  renderValue={(v) => {
                    if (!v) return 'Ad-hoc';
                    const s = (scenarios || []).find((x) => String(x.scenario_id) === String(v));
                    if (!s) return String(v);
                    return `${s.scenario_id} • ${s.name}`;
                  }}
                  MenuProps={{
                    PaperProps: {
                      sx: { maxWidth: 560 }
                    }
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setScenarioId(v);
                    if (v) sessionStorage.setItem('btsy_selected_scenario_id', String(v));
                    else sessionStorage.removeItem('btsy_selected_scenario_id');
                  }}
                >
                  <MenuItem value="">Ad-hoc</MenuItem>
                  {(scenarios || []).map((s) => (
                    <MenuItem key={s.scenario_id} value={s.scenario_id} sx={{ whiteSpace: 'normal' }}>
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {`${s.scenario_id} • ${s.name}`}
                        </Typography>
                        {s.description && (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {s.description}
                          </Typography>
                        )}
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {scenarioId && !scenarioPreset && (
                <LinearProgress />
              )}
              {selectedScenario && (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip size="small" label={selectedScenario.ownership || 'SYSTEM'} />
                  <Chip size="small" label={selectedScenario.entity_level || 'account'} />
                  <Chip size="small" label={`Scenario: ${selectedScenario.scenario_id}`} />
                </Stack>
              )}
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Alert
                severity="info"
                sx={{ bgcolor: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}
              >
                Selecting a scenario auto-applies compatible filters and tags the universe for traceability.
              </Alert>
            </Grid>
          </Grid>
        </Box>
      </Card>

      {/* Explainability Section */}
      <Card sx={{ mb: 3, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 0 }}>
        <Accordion 
          elevation={0}
          sx={{ 
            bgcolor: 'transparent',
            '&:before': { display: 'none' }
          }}
        >
          <AccordionSummary 
            expandIcon={<ExpandMoreIcon />}
            sx={{ 
              '& .MuiAccordionSummary-content': { 
                alignItems: 'center',
                gap: 1
              }
            }}
          >
            <InfoIcon sx={{ color: '#334155' }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#0f172a' }}>
              Understanding Transaction Universes
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Typography variant="body2" sx={{ color: '#334155', mb: 2 }}>
              <strong>What is this step about?</strong><br />
              A Transaction Universe is a filtered subset of your complete transaction data. Instead of analyzing 
              all transactions, you define specific criteria to focus on transactions that matter for your use case.
            </Typography>
            
            <Typography variant="body2" sx={{ color: '#334155', mb: 2 }}>
              <strong>Why do we need this?</strong><br />
              • <strong>Focus:</strong> Only analyze relevant transactions (e.g., high-value wires, specific time periods)<br />
              • <strong>Performance:</strong> Smaller datasets mean faster calibration<br />
              • <strong>Accuracy:</strong> Calibrate behaviors on the right transaction patterns<br />
              • <strong>Audit Trail:</strong> Document exactly which transactions were included in the analysis
            </Typography>
            
            <Typography variant="body2" sx={{ color: '#334155', mb: 1 }}>
              <strong>What happens next?</strong><br />
              1. Create one or more draft universes using different filter combinations<br />
              2. Review the metrics for each universe<br />
              3. Freeze the universe(s) you want to use (makes them immutable)<br />
              4. Proceed to the next step where you'll define behaviors based on these universes
            </Typography>
          </AccordionDetails>
        </Accordion>
      </Card>

      {/* Error Display */}
      {(error || universeError) && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error || universeError}
        </Alert>
      )}

      {/* Snapshot Context */}
      {snapshotInfo && (
        <Box sx={{ mb: 3 }}>
          <SnapshotContextCard snapshotInfo={snapshotInfo} />
        </Box>
      )}

      {/* Main Content Grid */}
      <Grid container spacing={3}>
        {/* Filter Builder */}
        <Grid item xs={12} md={6}>
          <UniverseFilterBuilder 
            onPreview={handlePreview}
            loading={loading}
            snapshotId={snapshotId}
            preset={scenarioPreset}
            disabled={Boolean(selectedUniverse)}
          />
        </Grid>

        {/* Universe History */}
        <Grid item xs={12} md={6}>
          <UniverseHistoryTable
            universes={universes}
            onFreeze={handleFreeze}
            onDelete={handleDelete}
            onView={handleViewUniverse}
          />
        </Grid>
        
        {/* Past Universe Catalog - full width */}
        <Grid item xs={12}>
          <UniverseCatalogPanel
            calibrationRunId={calibrationRunId}
            snapshotId={snapshotId}
            onUse={async (universeId) => {
              const selected = calibrationRunId 
                ? (await btsyApi.universe.getSelected(calibrationRunId))
                : { success: false };
              setSelectedUniverse(selected.success ? selected.data : null);
              const statsRes = await btsyApi.universe.getUniverseStats(universeId);
              if (statsRes.success) setDashboardStats(statsRes.data);
              if (navigateTo) navigateTo('behavior');
            }}
          />
        </Grid>
      </Grid>

      {!!toast && (
        <Alert
          severity="success"
          sx={{ position: 'fixed', bottom: 20, right: 20, maxWidth: 420, zIndex: 1500 }}
          onClose={() => setToast('')}
        >
          {toast}
        </Alert>
      )}
      {dashboardStats && (
        <UniverseDashboardPanel
          stats={dashboardStats}
          onClose={() => setDashboardStats(null)}
        />
      )}
    </Box>
  );
};

export default TransactionUniverseScreen;
