import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccountBalanceWallet as WalletIcon,
  BarChart as BarChartIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  RestartAlt as ResetIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Speed as SpeedIcon,
  Token as TokenIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import apiClient from '@services/api';

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
  const [tokenUsage, setTokenUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const fetchTokenUsage = useCallback(async () => {
    try {
      setLoadingUsage(true);
      const data = await apiClient.get('/api/v2/agentic/token-usage');
      setTokenUsage(data);
    } catch (err) {
      console.error('Failed to load token usage stats', err);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'token_usage') {
      fetchTokenUsage();
    }
  }, [activeTab, fetchTokenUsage]);

  const availableModels = useMemo(() => {
    const items = (ollamaModels || [])
      .map((item) => (typeof item === 'string' ? { id: item, name: item, label: item } : item))
      .filter((item) => item?.id || item?.name);
    const unique = new Map();
    items.forEach((item) => unique.set(item.id || item.name, item));
    return Array.from(unique.values());
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
    ...availableModels.map((model) => (
      <MenuItem key={model.id || model.name} value={model.id || model.name}>
        {model.label || model.name}
      </MenuItem>
    )),
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
            <Tab value="token_usage" label="Token Usage & Budget" />
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
                  {availableModels.map((model) => (
                    <MenuItem key={model.id || model.name} value={model.id || model.name}>
                      {model.label || model.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography sx={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.7 }}>
                Local GGUF models are discovered from the backend model directories and work without internet access. Cloud and API models are shown when their credentials are configured.
              </Typography>
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

        {activeTab === 'token_usage' ? (
          <Stack spacing={2.5}>
            {/* Header info & Refresh */}
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 2,
                bgcolor: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Box>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      bgcolor: '#fff7ed',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ea580c',
                      border: '1px solid #fed7aa',
                    }}
                  >
                    <TokenIcon />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                      Token Consumption & API Budget Tracking
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Empirical token metrics across all Sentinel agent workflows, copilot interactions, and background tasks.
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              <Stack direction="row" spacing={1.5} alignItems="center">
                <Chip
                  label="Configured Model: gpt-5.6-luna"
                  size="small"
                  sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700, border: '1px solid #bfdbfe' }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={loadingUsage ? <CircularProgress size={14} /> : <RefreshIcon />}
                  onClick={fetchTokenUsage}
                  disabled={loadingUsage}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Refresh Stats
                </Button>
              </Stack>
            </Paper>

            {/* KPI Cards Row */}
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr 1fr' },
              }}
            >
              {/* Card 1: Today's Tokens */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff' }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Tokens Used Today
                </Typography>
                <Typography sx={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', mt: 0.5, lineHeight: 1.1 }}>
                  {Number(tokenUsage?.tokens_today || 0).toLocaleString()}
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Cost: <strong>${Number(tokenUsage?.cost_today || 0).toFixed(4)}</strong>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    {tokenUsage?.calls_today || 0} calls
                  </Typography>
                </Stack>
              </Paper>

              {/* Card 2: Lifetime Tokens */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff' }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Lifetime Tokens
                </Typography>
                <Typography sx={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', mt: 0.5, lineHeight: 1.1 }}>
                  {Number(tokenUsage?.tokens_lifetime || 0).toLocaleString()}
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Total Cost: <strong>${Number(tokenUsage?.cost_lifetime || 0).toFixed(4)}</strong>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    {tokenUsage?.calls_lifetime || 0} calls
                  </Typography>
                </Stack>
              </Paper>

              {/* Card 3: $2 Credit Budget Limit */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff' }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Budget ($2.00 Limit)
                </Typography>
                <Typography sx={{ fontSize: '1.6rem', fontWeight: 900, color: '#16a34a', mt: 0.5, lineHeight: 1.1 }}>
                  ${Number(tokenUsage?.remaining_budget ?? 2.0).toFixed(4)}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Number(tokenUsage?.budget_used_percent || 0))}
                    sx={{
                      height: 6,
                      borderRadius: 3,
                      bgcolor: '#f1f5f9',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: (tokenUsage?.budget_used_percent || 0) > 80 ? '#dc2626' : (tokenUsage?.budget_used_percent || 0) > 50 ? '#f59e0b' : '#16a34a',
                      },
                    }}
                  />
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: '0.7rem', color: '#64748b' }}>
                    {Number(tokenUsage?.budget_used_percent || 0).toFixed(2)}% consumed
                  </Typography>
                  <Chip
                    label={Number(tokenUsage?.budget_used_percent || 0) > 85 ? 'Depleting' : 'Healthy'}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      bgcolor: Number(tokenUsage?.budget_used_percent || 0) > 85 ? '#fef2f2' : '#f0fdf4',
                      color: Number(tokenUsage?.budget_used_percent || 0) > 85 ? '#dc2626' : '#16a34a',
                    }}
                  />
                </Stack>
              </Paper>

              {/* Card 4: Token Efficiency */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: '#ffffff' }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Token Split (Prompt / Compl)
                </Typography>
                <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', mt: 0.5, lineHeight: 1.4 }}>
                  {Number(tokenUsage?.prompt_tokens_lifetime || 0).toLocaleString()} <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>/</span> {Number(tokenUsage?.completion_tokens_lifetime || 0).toLocaleString()}
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Avg prompt/call: <strong>{tokenUsage?.calls_lifetime ? Math.round(tokenUsage.prompt_tokens_lifetime / tokenUsage.calls_lifetime) : 0} tok</strong>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>
                    Quota Active
                  </Typography>
                </Stack>
              </Paper>
            </Box>

            {/* Daily Usage History Bar Chart */}
            <SectionCard
              title="Daily Token Consumption"
              subtitle="Daily breakdown of prompt and completion token volume over the past 14 days."
            >
              {tokenUsage?.daily_history && tokenUsage.daily_history.length > 0 ? (
                <Box sx={{ mt: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: { xs: 1, md: 2 },
                      height: 180,
                      pt: 2,
                      pb: 1,
                      px: 2,
                      bgcolor: '#f8fafc',
                      borderRadius: 2,
                      border: '1px solid #e2e8f0',
                      overflowX: 'auto',
                    }}
                  >
                    {(() => {
                      const maxDaily = Math.max(...tokenUsage.daily_history.map((d) => d.total_tokens || 1), 50);
                      return [...tokenUsage.daily_history].reverse().map((d) => {
                        const totalPct = Math.max(8, Math.round(((d.total_tokens || 0) / maxDaily) * 100));
                        return (
                          <Tooltip
                            key={d.day}
                            title={`${d.day}: ${d.total_tokens.toLocaleString()} tokens (${d.prompt_tokens} prompt, ${d.completion_tokens} completion) • $${d.cost_usd} • ${d.call_count} calls`}
                            arrow
                          >
                            <Box
                              sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                minWidth: 48,
                                flex: 1,
                                height: '100%',
                                justifyContent: 'flex-end',
                              }}
                            >
                              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', mb: 0.5 }}>
                                {d.total_tokens > 999 ? `${(d.total_tokens / 1000).toFixed(1)}k` : d.total_tokens}
                              </Typography>
                              <Box
                                sx={{
                                  width: '100%',
                                  maxWidth: 36,
                                  height: `${totalPct}%`,
                                  bgcolor: '#ea580c',
                                  borderRadius: '4px 4px 0 0',
                                  transition: 'height 0.3s ease',
                                  '&:hover': { bgcolor: '#c2410c' },
                                }}
                              />
                              <Typography sx={{ fontSize: '0.65rem', color: '#94a3b8', mt: 0.75, whiteSpace: 'nowrap' }}>
                                {d.day.slice(5)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        );
                      });
                    })()}
                  </Box>
                </Box>
              ) : (
                <Typography sx={{ color: '#64748b', fontSize: '0.85rem', py: 2 }}>
                  No historical usage logged yet. Invocations will automatically graph here.
                </Typography>
              )}
            </SectionCard>

            {/* Recent Invocations Table */}
            <SectionCard
              title="Recent LLM Invocations"
              subtitle="Audit log of the latest 30 requests processed through the OpenAI gateway."
            >
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Timestamp</TableCell>
                      <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Stage / Action</TableCell>
                      <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Model</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Prompt Tok</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Compl Tok</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Total Tok</TableCell>
                      <TableCell align="right" sx={{ fontSize: '0.72rem', fontWeight: 700 }}>Cost ($)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(tokenUsage?.recent_calls || []).map((row) => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                          {row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : '-'}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.72rem', fontWeight: 600 }}>
                          <Chip
                            label={row.stage || 'general'}
                            size="small"
                            sx={{ height: 20, fontSize: '0.65rem', textTransform: 'capitalize' }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#334155' }}>
                          {row.model || 'gpt-5.6-luna'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {row.prompt_tokens?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {row.completion_tokens?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#0f172a' }}>
                          {row.total_tokens?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                          ${Number(row.cost_usd || 0).toFixed(5)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!tokenUsage?.recent_calls || tokenUsage.recent_calls.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: '#94a3b8', fontSize: '0.8rem' }}>
                          No recent LLM invocations recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </SectionCard>
          </Stack>
        ) : null}
      </Stack>
    </PageContainer>
  );
};

export default InvestigationSettingsScreen;
