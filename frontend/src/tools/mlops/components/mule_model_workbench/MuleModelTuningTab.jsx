import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';

import { WorkbenchMetricGrid, WorkbenchSection } from '../MuleWorkbenchChrome';

const TUNING_TABS = [
  { id: 'setup', label: 'Search Setup' },
  { id: 'ranges', label: 'Parameter Ranges' },
  { id: 'preview', label: 'Candidate Preview' },
  { id: 'results', label: 'CV Results' },
];

const toLabel = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
const fmt = (value) => Number(value || 0).toLocaleString();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const typedValue = (rawValue, row) => {
  if (String(row?.type || 'float').toLowerCase() === 'int') {
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) ? parsed : Number.parseInt(row?.default || 0, 10) || 0;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : Number(row?.default || 0);
};

const countFromRange = (row, range) => {
  const minValue = Number(range?.min ?? row?.min ?? row?.default ?? 0);
  const maxValue = Number(range?.max ?? row?.max ?? row?.default ?? 0);
  const stepValue = Number(range?.step ?? row?.step ?? 1);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || !Number.isFinite(stepValue) || stepValue <= 0) return 1;
  if (maxValue <= minValue) return 1;
  return clamp(Math.floor((maxValue - minValue) / stepValue) + 1, 1, 50);
};

export default function MuleModelTuningTab({ data, onSave, saving }) {
  const incomingConfig = data?.config || {};
  const parameterSchema = data?.parameter_schema || {};
  const selectedAlgorithms = Array.isArray(data?.selected_algorithms) && data.selected_algorithms.length
    ? data.selected_algorithms
    : Object.keys(parameterSchema || {});
  const targetClasses = data?.target_definition?.classes || [];
  const latestCv = data?.latest_cv_results || {};
  const leaderboard = Array.isArray(latestCv?.leaderboard) ? latestCv.leaderboard : [];

  const [activeTab, setActiveTab] = React.useState('setup');
  const [draft, setDraft] = React.useState(incomingConfig);
  const [focusAlgo, setFocusAlgo] = React.useState(selectedAlgorithms[0] || '');

  React.useEffect(() => {
    setDraft(incomingConfig || {});
  }, [incomingConfig]);

  React.useEffect(() => {
    if (!focusAlgo && selectedAlgorithms.length) setFocusAlgo(selectedAlgorithms[0]);
    if (focusAlgo && selectedAlgorithms.length && !selectedAlgorithms.includes(focusAlgo)) setFocusAlgo(selectedAlgorithms[0]);
  }, [focusAlgo, selectedAlgorithms]);

  const updateDraft = (patch) => setDraft((prev) => ({ ...(prev || {}), ...(patch || {}) }));
  const updateField = (key, value) => updateDraft({ [key]: value });

  const manualParams = draft?.manual_params || {};
  const searchSpaces = draft?.search_spaces || {};
  const activeSchema = parameterSchema?.[focusAlgo] || [];
  const activeManual = manualParams?.[focusAlgo] || {};
  const activeSpace = searchSpaces?.[focusAlgo] || {};
  const mode = String(draft?.mode || 'manual').toLowerCase();

  const metrics = [
    { label: 'Dataset Rows', value: fmt(data?.dataset_summary?.row_count), helper: 'Rows available for model tuning.', emphasize: true },
    { label: 'Target Classes', value: fmt(targetClasses.length), helper: targetClasses.join(', ') || 'Not resolved yet.' },
    { label: 'Algorithms', value: fmt(selectedAlgorithms.length), helper: 'Supervised algorithms selected for tuning.' },
    { label: 'CV Folds', value: fmt(draft?.cv_folds || 3), helper: 'Cross-validation folds used in tuning runs.' },
  ];

  const candidateCount = React.useMemo(() => {
    if (!focusAlgo || !activeSchema.length) return 0;
    if (mode === 'manual') return 1;
    if (mode === 'random') return clamp(Number(draft?.search_iterations || 12), 1, 200);
    return activeSchema.reduce((product, row) => product * countFromRange(row, activeSpace?.[row.key]), 1);
  }, [activeSchema, activeSpace, draft?.search_iterations, focusAlgo, mode]);

  const saveConfig = () => onSave?.(draft);
  const runCv = () => onSave?.({ ...draft, action: 'run_cv' });

  const setManualParam = (paramRow, rawValue) => {
    const nextValue = typedValue(rawValue, paramRow);
    updateDraft({
      manual_params: {
        ...manualParams,
        [focusAlgo]: {
          ...activeManual,
          [paramRow.key]: nextValue,
        },
      },
    });
  };

  const setRangeBound = (paramRow, field, rawValue) => {
    const typed = typedValue(rawValue, paramRow);
    const current = activeSpace?.[paramRow.key] || {};
    const candidate = { ...current, [field]: typed };
    const minValue = Number(candidate.min ?? paramRow.min);
    const maxValue = Number(candidate.max ?? paramRow.max);
    const fixed = {
      ...candidate,
      min: minValue <= maxValue ? minValue : maxValue,
      max: maxValue >= minValue ? maxValue : minValue,
      step: Number(candidate.step ?? paramRow.step ?? 1),
    };
    updateDraft({
      search_spaces: {
        ...searchSpaces,
        [focusAlgo]: {
          ...(searchSpaces?.[focusAlgo] || {}),
          [paramRow.key]: fixed,
        },
      },
    });
  };

  const setRangeSlider = (paramRow, rawValue) => {
    if (!Array.isArray(rawValue) || rawValue.length < 2) return;
    const [minRaw, maxRaw] = rawValue;
    const minValue = typedValue(minRaw, paramRow);
    const maxValue = typedValue(maxRaw, paramRow);
    setRangeBound(paramRow, 'min', Math.min(minValue, maxValue));
    setRangeBound(paramRow, 'max', Math.max(minValue, maxValue));
  };

  return (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid items={metrics} />
      <Alert severity="info" sx={{ borderRadius: 0 }}>
        This workbench runs true cross-validation over your Mule multiclass target. `0/1` values are only binary risk flags; class modelling still uses typology class labels.
      </Alert>
      <Box sx={{ borderBottom: '1px solid rgba(16,24,40,0.12)' }}>
        <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontSize: 12.5, fontWeight: 700 } }}>
          {TUNING_TABS.map((tab) => <Tab key={tab.id} value={tab.id} label={tab.label} />)}
        </Tabs>
      </Box>

      {activeTab === 'setup' ? (
        <WorkbenchSection title="Search Setup" description="Configure how cross-validation and hyperparameter search are executed.">
          <Stack spacing={1.2}>
            <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1}>
              <Select size="small" value={draft?.mode || 'manual'} onChange={(event) => updateField('mode', event.target.value)} sx={{ minWidth: 180, borderRadius: 0 }}>
                <MenuItem value="manual">Manual</MenuItem>
                <MenuItem value="grid">Grid Search</MenuItem>
                <MenuItem value="random">Random Search</MenuItem>
              </Select>
              <Select size="small" value={draft?.cv_strategy || 'stratified_kfold'} onChange={(event) => updateField('cv_strategy', event.target.value)} sx={{ minWidth: 220, borderRadius: 0 }}>
                <MenuItem value="stratified_kfold">Stratified K-Fold</MenuItem>
                <MenuItem value="time_series">Time-Series CV</MenuItem>
              </Select>
              <Select size="small" value={draft?.score_metric || 'macro_f1'} onChange={(event) => updateField('score_metric', event.target.value)} sx={{ minWidth: 190, borderRadius: 0 }}>
                <MenuItem value="macro_f1">Macro F1</MenuItem>
                <MenuItem value="weighted_f1">Weighted F1</MenuItem>
              </Select>
              <Select size="small" value={draft?.class_weighting || 'balanced'} onChange={(event) => updateField('class_weighting', event.target.value)} sx={{ minWidth: 170, borderRadius: 0 }}>
                <MenuItem value="balanced">Balanced</MenuItem>
                <MenuItem value="none">No Weighting</MenuItem>
              </Select>
            </Stack>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.6 }}>CV Folds: {draft?.cv_folds || 3}</Typography>
                <Slider value={Number(draft?.cv_folds || 3)} min={2} max={10} step={1} onChange={(_, value) => updateField('cv_folds', Number(value))} sx={{ color: '#C65A11' }} />
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.6 }}>Search Iterations: {draft?.search_iterations || 12}</Typography>
                <Slider value={Number(draft?.search_iterations || 12)} min={1} max={200} step={1} onChange={(_, value) => updateField('search_iterations', Number(value))} sx={{ color: '#C65A11' }} />
              </Paper>
            </Box>
          </Stack>
        </WorkbenchSection>
      ) : null}

      {activeTab === 'ranges' ? (
        <WorkbenchSection title="Parameter Ranges" description="Fine-grained control for each algorithm, similar to notebook-style search-space setup.">
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
              {selectedAlgorithms.map((algo) => (
                <Chip key={algo} label={toLabel(algo)} onClick={() => setFocusAlgo(algo)} sx={{ borderRadius: 0, cursor: 'pointer', bgcolor: focusAlgo === algo ? '#FFF7ED' : '#F8FAFC', color: focusAlgo === algo ? '#C65A11' : '#475467', border: focusAlgo === algo ? '1px solid rgba(198,90,17,0.35)' : '1px solid rgba(15,23,42,0.10)' }} />
              ))}
            </Stack>
            {activeSchema.length ? (
              <Stack spacing={1.25}>
                {activeSchema.map((row) => {
                  const manualValue = Number(activeManual?.[row.key] ?? row.default);
                  const range = activeSpace?.[row.key] || {};
                  const rangeMin = Number(range?.min ?? row.min ?? row.default);
                  const rangeMax = Number(range?.max ?? row.max ?? row.default);
                  const rangeStep = Number(range?.step ?? row.step ?? 1);
                  return (
                    <Paper key={`${focusAlgo}_${row.key}`} variant="outlined" sx={{ p: 1.15, borderRadius: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>{row.label}</Typography>
                      <Typography sx={{ fontSize: 11.75, color: '#667085' }}>{row.key}</Typography>
                      <Stack spacing={0.8} sx={{ mt: 0.8 }}>
                        <Box>
                          <Typography sx={{ fontSize: 12.1, color: '#475467' }}>Manual value: {manualValue}</Typography>
                          <Slider value={manualValue} min={Number(row.min)} max={Number(row.max)} step={Number(row.step)} onChange={(_, value) => setManualParam(row, value)} sx={{ color: '#111827' }} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 12.1, color: '#475467' }}>
                            Search range: {rangeMin} - {rangeMax} (step {rangeStep})
                          </Typography>
                          <Slider value={[rangeMin, rangeMax]} min={Number(row.min)} max={Number(row.max)} step={Number(row.step)} onChange={(_, value) => setRangeSlider(row, value)} sx={{ color: '#C65A11' }} />
                        </Box>
                        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1}>
                          <TextField size="small" type="number" label="Min" value={rangeMin} onChange={(event) => setRangeBound(row, 'min', event.target.value)} sx={{ maxWidth: 130 }} />
                          <TextField size="small" type="number" label="Max" value={rangeMax} onChange={(event) => setRangeBound(row, 'max', event.target.value)} sx={{ maxWidth: 130 }} />
                          <TextField size="small" type="number" label="Step" value={rangeStep} onChange={(event) => setRangeBound(row, 'step', event.target.value)} sx={{ maxWidth: 130 }} />
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            ) : (
              <Alert severity="warning" sx={{ borderRadius: 0 }}>
                No parameter schema is available for the selected algorithm.
              </Alert>
            )}
          </Stack>
        </WorkbenchSection>
      ) : null}

      {activeTab === 'preview' ? (
        <WorkbenchSection title="Candidate Preview" description="Preview how many parameter candidates will be tested before launching CV.">
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12.5, color: '#475467' }}>
              Mode: <strong>{toLabel(mode)}</strong> | Focus algorithm: <strong>{toLabel(focusAlgo)}</strong> | Estimated candidates: <strong>{fmt(candidateCount)}</strong>
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
              Multiclass mapping in backend uses class labels: <strong>{targetClasses.join(', ') || 'not available yet'}</strong>. Numeric 0/1 appears only in binary risk columns.
            </Typography>
          </Stack>
        </WorkbenchSection>
      ) : null}

      {activeTab === 'results' ? (
        <WorkbenchSection title="Cross-Validation Results" description="Leaderboard of model candidates scored by cross-validation macro F1.">
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
              Last run: <strong>{latestCv?.executed_at || 'Not executed yet'}</strong>
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  <TableCell sx={{ fontWeight: 800 }}>Model</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Candidate</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>CV Mean (Macro F1)</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>CV Std</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Folds</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Params</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leaderboard.map((row) => (
                  <TableRow key={`${row.model_key}_${row.candidate_id}`}>
                    <TableCell sx={{ fontSize: 12.25 }}>{toLabel(row.model_key)}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.candidate_id}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.cv_mean_macro_f1 != null ? Number(row.cv_mean_macro_f1).toFixed(4) : 'N/A'}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.cv_std_macro_f1 != null ? Number(row.cv_std_macro_f1).toFixed(4) : 'N/A'}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.scored_folds}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{Object.entries(row.params || {}).map(([key, value]) => `${key}=${value}`).join(', ')}</TableCell>
                  </TableRow>
                ))}
                {!leaderboard.length ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ fontSize: 12.25, color: '#667085' }}>
                      No CV results yet. Save setup, then click Run Cross-Validation.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            {Array.isArray(latestCv?.failures) && latestCv.failures.length ? (
              <Alert severity="warning" sx={{ borderRadius: 0 }}>
                Some candidates failed during CV: {latestCv.failures.slice(0, 3).map((item) => `${item.model_key} (${item.error})`).join(' | ')}
              </Alert>
            ) : null}
          </Stack>
        </WorkbenchSection>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" onClick={saveConfig} disabled={saving} sx={{ textTransform: 'none', borderRadius: 0 }}>
          Save Tuning Config
        </Button>
        <Button variant="contained" onClick={runCv} disabled={saving || !selectedAlgorithms.length} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
          {saving ? 'Running...' : 'Run Cross-Validation'}
        </Button>
      </Stack>
    </Stack>
  );
}
