import React from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';

import { WorkbenchMetricGrid, WorkbenchSection } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();

export default function MuleModelRunSummaryTab({ data, onAdvance, disabled }) {
  const latest = data?.latest_run || {};
  const trainingContext = data?.training_context || {};
  const latestJob = data?.latest_job || {};
  const summary = latest.summary || {};
  const supervised = latest.supervised || {};
  const evaluation = latest.evaluation || {};
  const sequence = latest.sequence || {};
  const artifacts = latest.artifacts || {};
  const classNames = summary.class_names || trainingContext.class_names || [];
  const sequenceTracks = Array.isArray(sequence?.tracks) ? sequence.tracks : [];
  const ready = Boolean(artifacts?.scored_output_path);
  const failed = String(latestJob?.status || '').toLowerCase() === 'failed';
  const splitRows = Array.isArray(trainingContext?.split_summary?.splits) ? trainingContext.split_summary.splits : [];
  const primaryParams = trainingContext?.primary_algorithm_params || summary?.primary_algorithm_params || {};

  return (
    <WorkbenchSection
      title="Model Handoff"
      description="This is the practical end of Model Build. Once a governed run exists, move straight to the final results screen."
      action={(
        <Button
          variant="contained"
          onClick={onAdvance}
          disabled={disabled}
          sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}
        >
          Open Final Results
        </Button>
      )}
    >
      <Stack spacing={1.25}>
        {ready ? (
          <Alert severity="success" sx={{ borderRadius: 0 }}>
            A persisted Mule model run is available. The final results screen will show multiclass predictions, sequence-track outputs, graph insights, and scored account previews.
          </Alert>
        ) : failed ? (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            Latest training attempt failed: {latestJob?.logs?.message || 'Unknown backend error.'}
          </Alert>
        ) : (
          <Alert severity="info" sx={{ borderRadius: 0 }}>
            Train the model first. This handoff will enable as soon as the scored output artifact is persisted by the backend runner.
          </Alert>
        )}

        <WorkbenchMetricGrid
          items={[
            { label: 'Champion Model', value: supervised?.champion_model || 'Pending', helper: 'Current best supervised model candidate.', emphasize: true },
            { label: 'Selected Features', value: fmt(summary.selected_feature_count), helper: 'Governed features used for training.' },
            { label: 'Classes', value: classNames.length ? fmt(classNames.length) : 'Pending', helper: classNames.length ? classNames.join(', ') : 'Resolved multiclass labels.' },
            { label: 'Macro F1', value: evaluation?.macro_f1 != null ? Number(evaluation.macro_f1).toFixed(3) : 'Pending', helper: 'Primary multiclass quality measure.' },
          ]}
        />

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {classNames.map((label) => (
            <Chip key={label} size="small" label={label} sx={{ borderRadius: 0, bgcolor: '#EFF6FF', color: '#1D4ED8' }} />
          ))}
          {!classNames.length ? (
            <Chip size="small" label="No trained classes yet" sx={{ borderRadius: 0 }} />
          ) : null}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.25 }}>
          <Box sx={{ p: 1.15, border: '1px solid rgba(15,23,42,0.10)', bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>
              Training Context
            </Typography>
            <Stack spacing={0.55} sx={{ mt: 0.8 }}>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Dataset: <strong>{trainingContext?.dataset_type || summary?.dataset_type || 'Pending'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Rows: <strong>{fmt(trainingContext?.dataset_rows || summary?.dataset_rows)}</strong> | Columns: <strong>{fmt(trainingContext?.dataset_columns || summary?.dataset_columns)}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Target: <strong>{trainingContext?.target_column || summary?.target_column || 'Pending'}</strong> ({trainingContext?.resolved_target_source || summary?.resolved_target_source || 'auto'})
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Split: <strong>{trainingContext?.split_summary?.strategy || summary?.split_strategy || 'Pending'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Primary model: <strong>{trainingContext?.primary_algorithm || summary?.primary_algorithm || supervised?.primary_model || 'Pending'}</strong>
              </Typography>
            </Stack>
          </Box>
          <Box sx={{ p: 1.15, border: '1px solid rgba(15,23,42,0.10)', bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>
              Sequence Track Status
            </Typography>
            <Stack spacing={0.55} sx={{ mt: 0.8 }}>
              {sequenceTracks.length ? sequenceTracks.map((track) => (
                <Typography key={track.track || track.label} sx={{ fontSize: 12.25, color: '#475467' }}>
                  {track.track || track.label}: <strong>{track.status || 'pending'}</strong>
                </Typography>
              )) : (
                <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
                  Sequence outputs will appear here after training.
                </Typography>
              )}
            </Stack>
          </Box>
          <Box sx={{ p: 1.15, border: '1px solid rgba(15,23,42,0.10)', bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>
              Persisted Artifacts
            </Typography>
            <Stack spacing={0.55} sx={{ mt: 0.8 }}>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Scored output: <strong>{artifacts?.scored_output_path ? 'Ready' : 'Pending'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Model bundle: <strong>{artifacts?.model_bundle_path ? 'Ready' : 'Pending'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Run report: <strong>{artifacts?.run_report_path ? 'Ready' : 'Pending'}</strong>
              </Typography>
            </Stack>
          </Box>
        </Box>
        {Object.keys(primaryParams || {}).length ? (
          <Box sx={{ p: 1.15, border: '1px solid rgba(15,23,42,0.10)', bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>
              Primary Hyperparameters
            </Typography>
            <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
              {Object.entries(primaryParams).map(([key, value]) => (
                <Chip key={key} size="small" label={`${key}: ${value}`} sx={{ borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467' }} />
              ))}
            </Stack>
          </Box>
        ) : null}
        {splitRows.length ? (
          <Box sx={{ p: 1.15, border: '1px solid rgba(15,23,42,0.10)', bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#101828' }}>
              Split Distribution
            </Typography>
            <Stack spacing={0.55} sx={{ mt: 0.8 }}>
              {splitRows.map((row) => (
                <Typography key={row.name} sx={{ fontSize: 12.25, color: '#475467' }}>
                  {row.name}: {fmt(row.row_count)} rows | {(row.class_distribution || []).map((item) => `${item.class_name}:${item.count}`).join(', ')}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </WorkbenchSection>
  );
}
