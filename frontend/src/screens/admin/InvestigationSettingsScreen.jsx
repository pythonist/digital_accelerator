import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  RestartAlt as ResetIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';

import { useAppContext } from '@context/AppContext';
import PageContainer from '@investigation-layout/PageContainer';
import {
  defaultInvestigationSettings,
  readInvestigationSettings,
  resetInvestigationSettings,
  saveInvestigationSettings,
} from '../../tools/investigation/utils/investigationSettings';

const retrievalModes = [
  'Hybrid Similarity',
  'Behavioral Similarity',
  'Typology Similarity',
  'Network Similarity',
];

const caseQueueViews = [
  'All Cases',
  'SAR Candidates',
  'Pending L2',
  'Pending BM',
  'Pending Vigilance',
  'Escalated',
  'Awaiting Response',
  'Closed Today',
  'Overdue',
];

const SectionCard = ({ title, subtitle, children }) => (
  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{title}</Typography>
    {subtitle ? (
      <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#64748b', lineHeight: 1.7 }}>
        {subtitle}
      </Typography>
    ) : null}
    <Stack spacing={2} sx={{ mt: 2 }}>
      {children}
    </Stack>
  </Paper>
);

const InvestigationSettingsScreen = () => {
  const { ollamaModels } = useAppContext();
  const [activeTab, setActiveTab] = useState('global');
  const [settings, setSettings] = useState(() => readInvestigationSettings());
  const [notice, setNotice] = useState('');

  const availableModels = useMemo(() => {
    const names = (ollamaModels || [])
      .map((item) => (typeof item === 'string' ? item : item?.name))
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [ollamaModels]);

  const updateSection = (section, patch) => {
    setSettings((previous) => ({
      ...previous,
      [section]: {
        ...previous[section],
        ...patch,
      },
    }));
    setNotice('');
  };

  const updateNestedSection = (section, nestedKey, patch) => {
    setSettings((previous) => ({
      ...previous,
      [section]: {
        ...previous[section],
        [nestedKey]: {
          ...previous[section]?.[nestedKey],
          ...patch,
        },
      },
    }));
    setNotice('');
  };

  const handleSave = () => {
    const saved = saveInvestigationSettings(settings);
    setSettings(saved);
    setNotice('Sentinel settings saved. Screen defaults will be used the next time each workspace runs.');
  };

  const handleReset = () => {
    const reset = resetInvestigationSettings();
    setSettings(reset);
    setNotice('Sentinel settings were reset to the default operational profile.');
  };

  const renderModelOptions = () => [
    <MenuItem key="inherit" value="">Use global default</MenuItem>,
    ...availableModels.map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>),
  ];

  return (
    <PageContainer
      title="Settings"
      subtitle="Manage Sentinel-wide defaults once, then run each workspace without reconfiguring the same controls every time."
      breadcrumbs={['System', 'Settings']}
      actions={(
        <Stack direction="row" spacing={1.25}>
          <Button size="small" variant="outlined" startIcon={<ResetIcon />} onClick={handleReset}>
            Reset Defaults
          </Button>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
            Save Settings
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2.5}>
        <Alert severity="info" sx={{ border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
          Set the default behavior for the Investigation Workbench here. Analysts can still adjust controls inside a screen when needed, but they no longer have to repeat the same setup every time.
        </Alert>

        {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} sx={{ px: 1.5, pt: 1 }}>
            <Tab value="global" label="Global" />
            <Tab value="retrieval" label="Case Retrieval" />
            <Tab value="resolution" label="Case Resolution" />
            <Tab value="queue" label="Case Queue" />
            <Tab value="assistant" label="AI Assistant" />
          </Tabs>
        </Paper>

        {activeTab === 'global' ? (
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <SectionCard
              title="Global Defaults"
              subtitle="These settings act as the starting point for the whole Sentinel workspace."
            >
              <FormControl size="small" fullWidth>
                <InputLabel>Default model</InputLabel>
                <Select
                  label="Default model"
                  value={settings.global.default_model || ''}
                  onChange={(event) => updateSection('global', { default_model: event.target.value })}
                >
                  <MenuItem value="">Use first available model</MenuItem>
                  {availableModels.map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControlLabel
                control={(
                  <Switch
                    checked={Boolean(settings.global.auto_refresh_live_views)}
                    onChange={(event) => updateSection('global', { auto_refresh_live_views: event.target.checked })}
                  />
                )}
                label="Keep live operational screens refreshed automatically"
              />
              <FormControlLabel
                control={(
                  <Switch
                    checked={Boolean(settings.global.show_guides_by_default)}
                    onChange={(event) => updateSection('global', { show_guides_by_default: event.target.checked })}
                  />
                )}
                label="Open module guides by default"
              />
              <FormControlLabel
                control={(
                  <Switch
                    checked={Boolean(settings.global.compact_density)}
                    onChange={(event) => updateSection('global', { compact_density: event.target.checked })}
                  />
                )}
                label="Prefer compact density where supported"
              />
            </SectionCard>

            <SectionCard
              title="How These Defaults Work"
              subtitle="The goal is to make Sentinel easier to operate screen by screen, not to lock users into one fixed setup."
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.25} alignItems="flex-start">
                  <SettingsIcon sx={{ mt: 0.25, color: '#1d4ed8' }} />
                  <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.8 }}>
                    Save the preferred defaults here once. Each investigation screen can start from those values instead of making the user reconfigure the same options every session.
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1.25} alignItems="flex-start">
                  <TuneIcon sx={{ mt: 0.25, color: '#0f766e' }} />
                  <Typography sx={{ fontSize: 13, color: '#334155', lineHeight: 1.8 }}>
                    Analysts can still adjust settings inside a screen when needed. This page sets the operational baseline for the workbench.
                  </Typography>
                </Stack>
              </Stack>
            </SectionCard>
          </Box>
        ) : null}

        {activeTab === 'retrieval' ? (
          <SectionCard
            title="Case Retrieval Defaults"
            subtitle="Set the default Similar Cases behavior so investigators can open retrieval and run it immediately."
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
              <TextField
                select
                size="small"
                label="Default similarity mode"
                value={settings.case_retrieval.default_mode}
                onChange={(event) => updateSection('case_retrieval', { default_mode: event.target.value })}
              >
                {retrievalModes.map((mode) => <MenuItem key={mode} value={mode}>{mode}</MenuItem>)}
              </TextField>
              <TextField
                select
                size="small"
                label="Outcome filter"
                value={settings.case_retrieval.default_outcome_filter || ''}
                onChange={(event) => updateSection('case_retrieval', { default_outcome_filter: event.target.value })}
              >
                <MenuItem value="">All outcomes</MenuItem>
                <MenuItem value="escalated">Escalated</MenuItem>
                <MenuItem value="closed">Closed</MenuItem>
                <MenuItem value="sar recommended">SAR Recommended</MenuItem>
              </TextField>
            </Box>

            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>
                Default result limit: {settings.case_retrieval.default_top_k}
              </Typography>
              <Slider
                value={settings.case_retrieval.default_top_k}
                min={3}
                max={20}
                step={1}
                valueLabelDisplay="auto"
                onChange={(_, value) => updateSection('case_retrieval', { default_top_k: value })}
              />
            </Stack>

            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>
                Default similarity threshold: {Math.round((settings.case_retrieval.default_threshold || 0) * 100)}%
              </Typography>
              <Slider
                value={settings.case_retrieval.default_threshold}
                min={0}
                max={0.95}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, value) => updateSection('case_retrieval', { default_threshold: value })}
              />
            </Stack>

            <FormControlLabel
              control={(
                <Switch
                  checked={Boolean(settings.case_retrieval.include_resolved_by_default)}
                  onChange={(event) => updateSection('case_retrieval', { include_resolved_by_default: event.target.checked })}
                />
              )}
              label="Include resolved cases by default"
            />

            <FormControlLabel
              control={(
                <Switch
                  checked={Boolean(settings.case_retrieval.show_advanced_weighting)}
                  onChange={(event) => updateSection('case_retrieval', { show_advanced_weighting: event.target.checked })}
                />
              )}
              label="Show advanced weighting controls by default"
            />

            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
              <TextField
                size="small"
                type="number"
                label="Behavioral weight"
                value={settings.case_retrieval.default_weights.behavioral}
                onChange={(event) => updateNestedSection('case_retrieval', 'default_weights', { behavioral: Number(event.target.value) })}
              />
              <TextField
                size="small"
                type="number"
                label="Typology weight"
                value={settings.case_retrieval.default_weights.typology}
                onChange={(event) => updateNestedSection('case_retrieval', 'default_weights', { typology: Number(event.target.value) })}
              />
              <TextField
                size="small"
                type="number"
                label="Network weight"
                value={settings.case_retrieval.default_weights.network}
                onChange={(event) => updateNestedSection('case_retrieval', 'default_weights', { network: Number(event.target.value) })}
              />
              <TextField
                size="small"
                type="number"
                label="Alert weight"
                value={settings.case_retrieval.default_weights.alert}
                onChange={(event) => updateNestedSection('case_retrieval', 'default_weights', { alert: Number(event.target.value) })}
              />
            </Box>
          </SectionCard>
        ) : null}

        {activeTab === 'resolution' ? (
          <SectionCard
            title="Case Resolution Defaults"
            subtitle="Configure how the Resolution workspace prepares its narrative and SAR drafting flow."
          >
            <FormControl size="small" fullWidth sx={{ maxWidth: 420 }}>
              <InputLabel>SAR drafting model</InputLabel>
              <Select
                label="SAR drafting model"
                value={settings.case_resolution.preferred_model || ''}
                onChange={(event) => updateSection('case_resolution', { preferred_model: event.target.value })}
              >
                {renderModelOptions()}
              </Select>
            </FormControl>
            <FormControlLabel
              control={(
                <Switch
                  checked={Boolean(settings.case_resolution.auto_refresh_on_open)}
                  onChange={(event) => updateSection('case_resolution', { auto_refresh_on_open: event.target.checked })}
                />
              )}
              label="Refresh source modules automatically when the Resolution screen opens"
            />
          </SectionCard>
        ) : null}

        {activeTab === 'queue' ? (
          <SectionCard
            title="Case Queue Defaults"
            subtitle="Control how the live operational queue behaves for investigators and reviewers."
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' } }}>
              <TextField
                size="small"
                type="number"
                label="Refresh interval (seconds)"
                value={settings.case_queue.refresh_interval_seconds}
                onChange={(event) => updateSection('case_queue', {
                  refresh_interval_seconds: Math.max(5, Number(event.target.value) || 5),
                })}
              />
              <TextField
                select
                size="small"
                label="Default saved view"
                value={settings.case_queue.default_saved_view}
                onChange={(event) => updateSection('case_queue', { default_saved_view: event.target.value })}
              >
                {caseQueueViews.map((view) => <MenuItem key={view} value={view}>{view}</MenuItem>)}
              </TextField>
              <TextField
                size="small"
                type="number"
                label="Default page size"
                value={settings.case_queue.default_page_size}
                onChange={(event) => updateSection('case_queue', {
                  default_page_size: Math.max(10, Number(event.target.value) || 10),
                })}
              />
            </Box>
          </SectionCard>
        ) : null}

        {activeTab === 'assistant' ? (
          <SectionCard
            title="AI Assistant Defaults"
            subtitle="Set the default model behavior for the Sentinel assistant workspace."
          >
            <FormControl size="small" fullWidth sx={{ maxWidth: 420 }}>
              <InputLabel>Assistant model</InputLabel>
              <Select
                label="Assistant model"
                value={settings.assistant.preferred_model || ''}
                onChange={(event) => updateSection('assistant', { preferred_model: event.target.value })}
              >
                {renderModelOptions()}
              </Select>
            </FormControl>
            <FormControlLabel
              control={(
                <Switch
                  checked={Boolean(settings.assistant.keep_chat_history)}
                  onChange={(event) => updateSection('assistant', { keep_chat_history: event.target.checked })}
                />
              )}
              label="Keep chat history between screen visits"
            />
          </SectionCard>
        ) : null}
      </Stack>
    </PageContainer>
  );
};

export default InvestigationSettingsScreen;
