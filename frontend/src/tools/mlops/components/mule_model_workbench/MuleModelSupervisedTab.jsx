import React from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { WorkbenchMetricGrid, WorkbenchSection } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();

export default function MuleModelSupervisedTab({ data, onSave, onTrain, training }) {
  const cfg = data?.config || {};
  const selected = new Set(cfg.selected_algorithms || []);
  const latest = data?.latest_run || {};
  const dataset = data?.dataset_summary || {};
  const target = data?.target_definition || {};
  const split = data?.split_summary || {};
  const splitRows = Array.isArray(split?.splits) ? split.splits : [];
  const primaryParams = data?.primary_hyperparameters || {};
  const failedModels = (latest?.model_failures || []).filter((row) => row?.error);
  const toggle = (algorithmId) => {
    const next = new Set(selected);
    if (next.has(algorithmId)) next.delete(algorithmId);
    else if (next.size < 5) next.add(algorithmId);
    onSave?.({ selected_algorithms: Array.from(next), primary_algorithm: cfg.primary_algorithm && next.has(cfg.primary_algorithm) ? cfg.primary_algorithm : Array.from(next)[0] || '' });
  };

  return (
    <Stack spacing={1.5}>
      <WorkbenchMetricGrid
        items={[
          { label: 'Dataset', value: dataset?.dataset_type || 'Pending', helper: 'Latest upstream dataset currently used for training.', emphasize: true },
          { label: 'Rows', value: fmt(dataset?.row_count), helper: 'Rows in the model-build dataset.' },
          { label: 'Columns', value: fmt(dataset?.column_count), helper: 'Columns currently loaded in model build.' },
          { label: 'Target', value: target?.derived_name || 'Pending', helper: `Source: ${target?.resolved_source || 'auto'}` },
          { label: 'Classes', value: fmt((target?.classes || []).length), helper: (target?.classes || []).join(', ') || 'Not resolved yet.' },
          { label: 'Selected Features', value: fmt((data?.selected_features || []).length), helper: 'Governed features passed into supervised training.' },
        ]}
      />
      <WorkbenchSection
        title="Supervised Model Studio"
        description="Shortlist up to five strong multiclass algorithms, set the primary training candidate, and start a governed Mule typology run."
        action={(
          <Button variant="contained" onClick={onTrain} disabled={!data?.trainable || training} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
            {training ? 'Training...' : 'Run Multiclass Training'}
          </Button>
        )}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
          {(data?.algorithms || []).map((item) => {
            const isSelected = selected.has(item.id);
            const isPrimary = cfg.primary_algorithm === item.id;
            return (
              <Paper key={item.id} variant="outlined" sx={{ p: 1.25, borderRadius: 0, bgcolor: isSelected ? '#FFF7ED' : '#FFFFFF' }}>
                <Stack spacing={0.8}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 800 }}>{item.label}</Typography>
                      <Typography sx={{ fontSize: 12, color: '#667085' }}>{item.family}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 12, color: item.available ? '#027A48' : '#B42318', fontWeight: 700 }}>{item.available ? item.speed : 'Unavailable'}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12.25, color: '#475467', lineHeight: 1.55 }}>{item.business_suitability}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button variant={isSelected ? 'contained' : 'outlined'} size="small" onClick={() => toggle(item.id)} disabled={!item.available} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: isSelected ? '#111827' : undefined }}>{isSelected ? 'Selected' : 'Select'}</Button>
                    <Button variant={isPrimary ? 'contained' : 'outlined'} size="small" onClick={() => onSave?.({ ...cfg, primary_algorithm: item.id })} disabled={!isSelected} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: isPrimary ? '#C65A11' : undefined }}>{isPrimary ? 'Primary' : 'Set Primary'}</Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Box>
      </WorkbenchSection>

      <WorkbenchSection title="Primary Model Hyperparameters">
        <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
          <Chip size="small" label={`Primary: ${data?.primary_algorithm || cfg.primary_algorithm || 'not set'}`} sx={{ borderRadius: 0, bgcolor: '#FFF7ED', color: '#C65A11', fontWeight: 700 }} />
          {Object.entries(primaryParams).map(([key, value]) => (
            <Chip key={key} size="small" label={`${key}: ${value}`} sx={{ borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467' }} />
          ))}
          {!Object.keys(primaryParams || {}).length ? (
            <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
              No manual hyperparameters are configured for the current primary model yet. Use the Hyperparameter Tuning tab.
            </Typography>
          ) : null}
        </Stack>
      </WorkbenchSection>

      <WorkbenchSection title="Split Snapshot">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 800 }}>Split</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Rows</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Class distribution</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {splitRows.map((row) => (
              <TableRow key={row.name}>
                <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.name}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{fmt(row.row_count)}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{(row.class_distribution || []).map((item) => `${item.class_name}: ${item.count}`).join(' | ')}</TableCell>
              </TableRow>
            ))}
            {!splitRows.length ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ fontSize: 12.25, color: '#667085' }}>
                  Split distribution will appear after target and split resolution.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </WorkbenchSection>

      <WorkbenchSection title="Latest Candidate Metrics">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 800 }}>Model</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Macro F1</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Weighted F1</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Top-2</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Top-3</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>OVR AUC</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(latest.candidate_results || []).map((row) => (
              <TableRow key={row.model_key}>
                <TableCell sx={{ fontSize: 12.25, fontWeight: row.model_key === latest.champion_model ? 800 : 500 }}>{row.model_key}</TableCell>
                <TableCell sx={{ fontSize: 12.25, color: row.status === 'failed' ? '#B42318' : '#027A48' }}>{row.status || 'completed'}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.macro_f1}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.weighted_f1}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.top_2_accuracy}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.top_3_accuracy}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{row.ovr_auc ?? 'N/A'}</TableCell>
              </TableRow>
            ))}
            {!(latest.candidate_results || []).length ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ fontSize: 12.25, color: '#667085' }}>
                  No training run yet. Use Run Multiclass Training to populate candidate metrics.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {failedModels.length ? (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {failedModels.map((row) => (
              <Typography key={`${row.model_key}_${row.error}`} sx={{ fontSize: 12.25, color: '#B42318' }}>
                {row.model_key}: {row.error}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </WorkbenchSection>
    </Stack>
  );
}
