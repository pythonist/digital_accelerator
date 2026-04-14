import React from 'react';
import {
  Alert,
  Box,
  ButtonBase,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle,
  ErrorOutline,
  LockOutlined,
  RadioButtonUnchecked,
  Schedule,
  WarningAmber,
} from '@mui/icons-material';

const STEP_TO_STAGE = {
  data: 'upload_data',
  master: 'master_dataset',
  featurestore: 'feature_store',
  preprocess: 'preprocessing_feature_selection',
  model: 'model_build',
  validation: 'model_output_validation',
  pipelines: 'pipeline_hub',
};

const STATUS_META = {
  completed: {
    label: 'Completed',
    icon: CheckCircle,
    text: '#0F5F44',
    border: 'rgba(15,95,68,0.18)',
    background: 'rgba(15,95,68,0.08)',
  },
  in_progress: {
    label: 'In Progress',
    icon: Schedule,
    text: '#155EEF',
    border: 'rgba(21,94,239,0.18)',
    background: 'rgba(21,94,239,0.08)',
  },
  blocked: {
    label: 'Blocked',
    icon: LockOutlined,
    text: '#8A5A00',
    border: 'rgba(138,90,0,0.18)',
    background: 'rgba(138,90,0,0.10)',
  },
  failed: {
    label: 'Failed',
    icon: ErrorOutline,
    text: '#B42318',
    border: 'rgba(180,35,24,0.18)',
    background: 'rgba(180,35,24,0.08)',
  },
  stale: {
    label: 'Stale',
    icon: WarningAmber,
    text: '#9A3412',
    border: 'rgba(154,52,18,0.18)',
    background: 'rgba(154,52,18,0.08)',
  },
  not_started: {
    label: 'Not Started',
    icon: RadioButtonUnchecked,
    text: '#475467',
    border: 'rgba(71,84,103,0.16)',
    background: 'rgba(71,84,103,0.06)',
  },
};

const formatLabel = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase())
  .trim();

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const getStatusMeta = (status) => STATUS_META[String(status || '').trim().toLowerCase()] || STATUS_META.not_started;

const stageWarnings = (stageSummary) => {
  const summary = stageSummary?.summary;
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.warnings)) return [];
  return summary.warnings.map((item) => String(item || '').trim()).filter(Boolean);
};

export const getStageWorkspaceState = (workspace, stepId) => {
  if (!workspace || typeof workspace !== 'object') return null;
  const stageName = STEP_TO_STAGE[String(stepId || '').trim().toLowerCase()] || '';
  const stageSummaries = workspace.stage_summaries && typeof workspace.stage_summaries === 'object'
    ? workspace.stage_summaries
    : {};
  const stagePayload = stageSummaries[String(stepId || '').trim().toLowerCase()] || null;
  if (stagePayload) return stagePayload;
  const stages = Array.isArray(workspace.stages) ? workspace.stages : [];
  return stages.find((item) => String(item?.stage_name || '').trim().toLowerCase() === stageName) || null;
};

export const getStageArtifacts = (workspace, stepId) => {
  const stageName = STEP_TO_STAGE[String(stepId || '').trim().toLowerCase()] || '';
  const artifacts = Array.isArray(workspace?.artifacts) ? workspace.artifacts : [];
  return artifacts.filter((artifact) => String(artifact?.stage_name || '').trim().toLowerCase() === stageName);
};

export const WorkbenchStatusBadge = ({ status, label }) => {
  const meta = getStatusMeta(status);
  const Icon = meta.icon;
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{
        border: `1px solid ${meta.border}`,
        bgcolor: meta.background,
        color: meta.text,
        borderRadius: 0,
        px: 0.95,
        py: 0.5,
      }}
    >
      <Icon sx={{ fontSize: 15 }} />
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'inherit' }}>
        {label || meta.label}
      </Typography>
    </Stack>
  );
};

export const WorkbenchMetricGrid = ({ items = [] }) => {
  const rows = items.filter((item) => item && item.label);
  if (!rows.length) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: `repeat(${Math.min(rows.length, 4)}, minmax(0, 1fr))` }, gap: 1.25 }}>
      {rows.map((item) => (
        <Paper
          key={item.label}
          variant="outlined"
          sx={{
            p: 1.25,
            borderRadius: 0,
            bgcolor: item.emphasize ? '#FFF7ED' : '#FBFCFE',
            borderColor: item.emphasize ? 'rgba(198,90,17,0.24)' : 'rgba(21,27,39,0.10)',
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {item.label}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#101828', mt: 0.3 }}>
            {item.value}
          </Typography>
          {item.helper ? (
            <Typography sx={{ fontSize: 12.5, color: '#667085', mt: 0.45, lineHeight: 1.55 }}>
              {item.helper}
            </Typography>
          ) : null}
        </Paper>
      ))}
    </Box>
  );
};

export const WorkbenchSection = ({ title, description, action, children, sx = {} }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, ...sx }}>
    <Stack spacing={1.1}>
      {(title || description || action) ? (
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Box>
            {title ? (
              <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: '#101828' }}>
                {title}
              </Typography>
            ) : null}
            {description ? (
              <Typography sx={{ fontSize: 12.25, color: '#667085', mt: 0.35, lineHeight: 1.55 }}>
                {description}
              </Typography>
            ) : null}
          </Box>
          {action ? <Box>{action}</Box> : null}
        </Stack>
      ) : null}
      {children}
    </Stack>
  </Paper>
);

export const WorkbenchRunPanel = ({
  workspace,
  stepId,
  summaryRows = [],
  title = 'Run Summary',
  emptyArtifactsText = 'No persisted artifacts are registered for this stage yet.',
  extra = null,
}) => {
  const run = workspace?.run || {};
  const stageState = getStageWorkspaceState(workspace, stepId);
  const artifacts = getStageArtifacts(workspace, stepId).slice(0, 6);
  const latestJob = workspace?.latest_job || null;
  const relevantJob = latestJob && String(latestJob.stage_name || '').trim().toLowerCase() === String(STEP_TO_STAGE[stepId] || '').trim().toLowerCase()
    ? latestJob
    : null;
  const rows = [
    { label: 'Run', value: run?.metadata?.pipeline_name || `Run ${run?.run_id || '-'}` },
    { label: 'Run status', value: formatLabel(run?.status || 'not_started') },
    { label: 'Stage status', value: formatLabel(stageState?.status || 'not_started') },
    { label: 'Substage', value: stageState?.substage ? formatLabel(stageState.substage) : 'Not recorded' },
    { label: 'Updated', value: formatDateTime(run?.updated_at) },
    ...summaryRows.filter((item) => item && item.label),
  ];

  return (
    <WorkbenchSection title={title} sx={{ p: 1.75 }}>
      <Stack spacing={1}>
        {rows.map((row) => (
          <Stack key={row.label} direction="row" justifyContent="space-between" spacing={1.25}>
            <Typography sx={{ fontSize: 12.5, color: '#667085' }}>{row.label}</Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828', textAlign: 'right' }}>{row.value}</Typography>
          </Stack>
        ))}
      </Stack>

      {relevantJob ? (
        <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 0, bgcolor: '#FBFCFE', mt: 0.5 }}>
          <Stack spacing={0.8}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>
                Latest Job
              </Typography>
              <WorkbenchStatusBadge status={relevantJob.status} />
            </Stack>
            <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
              {formatLabel(relevantJob.job_type || relevantJob.job_id)}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={Math.max(0, Math.min(100, Number(relevantJob.progress_pct || 0)))}
              sx={{
                height: 7,
                borderRadius: 0,
                bgcolor: 'rgba(21,27,39,0.08)',
                '& .MuiLinearProgress-bar': { bgcolor: '#C65A11' },
              }}
            />
            <Typography sx={{ fontSize: 12, color: '#667085' }}>
              {Math.round(Number(relevantJob.progress_pct || 0))}% complete
            </Typography>
          </Stack>
        </Paper>
      ) : null}

      {extra}

      <Stack spacing={0.8}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.7 }}>
          Persisted Artifacts
        </Typography>
        {artifacts.length ? artifacts.map((artifact) => (
          <Paper key={`${artifact.artifact_id}_${artifact.artifact_type}`} variant="outlined" sx={{ p: 1.15, borderRadius: 0, bgcolor: '#FBFCFE' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>
              {formatLabel(artifact.artifact_type)}
            </Typography>
            <Typography sx={{ fontSize: 12, color: '#667085', mt: 0.25 }}>
              {artifact.storage_ref || 'Registered in backend artifact registry'}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: '#98A2B3', mt: 0.25 }}>
              Version {artifact.version || 1} | {formatDateTime(artifact.created_at)}
            </Typography>
          </Paper>
        )) : (
          <Typography sx={{ fontSize: 12.5, color: '#667085' }}>
            {emptyArtifactsText}
          </Typography>
        )}
      </Stack>
    </WorkbenchSection>
  );
};

export const MuleStageHeader = ({
  title,
  description,
  workspace,
  stepId,
  metrics = [],
  actions = null,
  showHeading = true,
  showRunControl = true,
}) => {
  const stageState = getStageWorkspaceState(workspace, stepId);
  const run = workspace?.run || {};
  const stageStatus = stageState?.status || 'not_started';
  const warnings = [
    ...stageWarnings(stageState),
    ...((Array.isArray(workspace?.warnings) ? workspace.warnings : []).slice(0, 2)),
  ].filter(Boolean);
  const blockers = Array.isArray(workspace?.blockers) ? workspace.blockers : [];
  const relevantActions = Array.isArray(workspace?.allowed_actions)
    ? workspace.allowed_actions.filter((item) => String(item || '').startsWith(`${STEP_TO_STAGE[stepId] || 'workspace'}.`))
    : [];

  return (
    <WorkbenchSection
      sx={{ p: 2.25, bgcolor: '#FFFFFF' }}
      action={actions}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.65fr) minmax(280px, 0.95fr)' }, gap: 1.5 }}>
        <Stack spacing={1.35}>
          {showHeading ? (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                <Typography sx={{ fontSize: 31, fontWeight: 800, color: '#101828', letterSpacing: -0.4 }}>
                  {title}
                </Typography>
                <WorkbenchStatusBadge status={stageStatus} />
              </Stack>
              <Typography sx={{ fontSize: 14, color: '#667085', lineHeight: 1.7, maxWidth: 980 }}>
                {description}
              </Typography>
            </>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <WorkbenchStatusBadge status={stageStatus} />
            </Stack>
          )}
          {metrics.length ? <WorkbenchMetricGrid items={metrics} /> : null}
        </Stack>

        {showRunControl ? (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, bgcolor: '#FBFCFE' }}>
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Run Control
              </Typography>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Run</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>
                  {run?.metadata?.pipeline_name || `Run ${run?.run_id || '-'}`}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Current step</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>
                  {formatLabel(run?.current_step_label || run?.current_stage || stepId)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Run status</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828' }}>
                  {formatLabel(run?.status || 'not_started')}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontSize: 12.5, color: '#667085' }}>Updated</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#101828', textAlign: 'right' }}>
                  {formatDateTime(run?.updated_at)}
                </Typography>
              </Stack>
              {relevantActions.length ? (
                <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.55 }}>
                  Allowed actions: <strong>{relevantActions.map((item) => formatLabel(String(item).split('.').slice(1).join(' ') || item)).join(', ')}</strong>
                </Typography>
              ) : (
                <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.55 }}>
                  Backend state is the source of truth. Refresh and resume actions reload this stage from the persisted run snapshot.
                </Typography>
              )}
            </Stack>
          </Paper>
        ) : null}
      </Box>

      {blockers.slice(0, 1).map((item) => (
        <Alert key={`blocker_${item}`} severity="warning">
          {item}
        </Alert>
      ))}
      {warnings.slice(0, 2).map((item) => (
        <Alert key={`warning_${item}`} severity="info">
          {item}
        </Alert>
      ))}
    </WorkbenchSection>
  );
};

export const MuleSubstageRail = ({
  items = [],
  current,
  onChange,
  saving = false,
  helper = '',
}) => {
  const steps = items.filter((item) => item && item.id);
  if (!steps.length) return null;
  return (
    <WorkbenchSection
      title="Stage Workflow"
      description={helper || 'Substage selection is persisted so the workbench reopens exactly where the run last stopped.'}
      action={saving ? <WorkbenchStatusBadge status="in_progress" label="Saving" /> : null}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `repeat(${Math.min(steps.length, 7)}, minmax(0, 1fr))` }, gap: 1 }}>
        {steps.map((item, index) => {
          const active = String(current || '') === item.id;
          return (
            <ButtonBase
              key={item.id}
              onClick={() => onChange?.(item.id)}
              sx={{
                textAlign: 'left',
                alignItems: 'stretch',
                borderRadius: 0,
                border: active ? '1px solid rgba(198,90,17,0.26)' : '1px solid rgba(21,27,39,0.10)',
                bgcolor: active ? '#FFF7ED' : '#FBFCFE',
                p: 1.4,
              }}
            >
              <Stack spacing={0.55} sx={{ width: '100%' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: active ? '#9A3412' : '#98A2B3', textTransform: 'uppercase', letterSpacing: 0.65 }}>
                  Step {index + 1}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#101828' }}>
                  {item.label}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.5 }}>
                  {item.helper}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}
      </Box>
    </WorkbenchSection>
  );
};
