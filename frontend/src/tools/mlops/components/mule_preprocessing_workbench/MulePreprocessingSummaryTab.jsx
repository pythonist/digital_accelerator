import React, { useMemo, useState } from 'react';
import {
  Alert,
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
import { ArrowForward, CheckCircle, Inventory2Outlined } from '@mui/icons-material';

import { WorkbenchMetricGrid, WorkbenchSection } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();
const clip = (value, limit = 88) => {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
};

export default function MulePreprocessingSummaryTab({
  data,
  onSendToModel,
  disabled,
}) {
  const [showAllSelected, setShowAllSelected] = useState(false);
  const [showAllDropped, setShowAllDropped] = useState(false);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);

  const selectedFeatures = data?.selected_features || [];
  const droppedFeatures = data?.dropped_features || [];
  const artifacts = data?.artifacts || [];
  const latestRun = data?.latest_run || null;
  const preprocessArtifact = useMemo(
    () => artifacts.find((item) => String(item?.artifact_type || '').trim().toLowerCase() === 'preprocess_dataset_csv') || null,
    [artifacts],
  );
  const outputTable = latestRun?.output_table_name || preprocessArtifact?.metadata?.output_table_name || 'mule_feature_studio';
  const outputRows = latestRun?.row_count || preprocessArtifact?.metadata?.row_count || 0;
  const outputColumns = latestRun?.column_count || preprocessArtifact?.metadata?.column_count || 0;
  const outputDatasetId = latestRun?.dataset_id || preprocessArtifact?.metadata?.dataset_id || null;
  const outputRunId = latestRun?.run_id || preprocessArtifact?.metadata?.run_id || null;
  const selectedVisible = showAllSelected ? selectedFeatures : selectedFeatures.slice(0, 28);
  const droppedVisible = showAllDropped ? droppedFeatures : droppedFeatures.slice(0, 14);
  const artifactVisible = showAllArtifacts ? artifacts : artifacts.slice(0, 5);
  const columnSettingsCount = Object.keys(data?.transformations_applied?.column_settings || {}).length;
  const autoSummary = data?.transformations_applied?.auto_summary || {};
  const familySummary = (selectedFeatures || []).reduce((acc, feature) => {
    const key = String(feature || '').split('_')[0] || 'general';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topFamilies = Object.entries(familySummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const buildStatus = data?.traceability?.build_status || (outputDatasetId ? 'built' : 'not_started');

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <WorkbenchSection
        title="Preprocessing Output Ready"
        description="This is the final handoff screen for Mule preprocessing. Review the saved output, confirm what was retained and removed, then move forward to Model Build."
        action={(
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            onClick={onSendToModel}
            disabled={disabled}
            sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}
          >
            Send to Model Build
          </Button>
        )}
      >
        <Stack spacing={1.1}>
          <Alert
            severity={disabled ? 'warning' : 'success'}
            icon={disabled ? <Inventory2Outlined /> : <CheckCircle />}
            sx={{ borderRadius: 0 }}
          >
            {disabled
              ? 'The handoff button will enable as soon as a persisted preprocessing dataset is visible in this screen.'
              : `Preprocessing output is persisted as ${outputTable}${outputDatasetId ? ` (dataset ${outputDatasetId})` : ''}. You can move to Model Build now.`}
          </Alert>
          <WorkbenchMetricGrid
            items={[
              { label: 'Selected features', value: fmt(selectedFeatures.length), helper: 'Final model-ready fields kept after selection.', emphasize: true },
              { label: 'Dropped features', value: fmt(droppedFeatures.length), helper: 'Fields removed by statistical screening or governance.' },
              { label: 'Output rows', value: fmt(outputRows), helper: 'Rows in the persisted preprocessing output.' },
              { label: 'Output columns', value: fmt(outputColumns), helper: 'Total columns handed to Model Build.' },
            ]}
          />
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip size="small" label={`Build status: ${buildStatus}`} sx={{ borderRadius: 0, bgcolor: '#FBFCFE', border: '1px solid rgba(15,23,42,0.10)' }} />
            {outputDatasetId ? <Chip size="small" label={`Dataset ID ${outputDatasetId}`} sx={{ borderRadius: 0, bgcolor: '#ECFDF3', color: '#027A48' }} /> : null}
            {outputRunId ? <Chip size="small" label={`Run ID ${outputRunId}`} sx={{ borderRadius: 0, bgcolor: '#EFF6FF', color: '#1D4ED8' }} /> : null}
            <Chip size="small" label={`Engineered features ${fmt((data?.engineered_features_added || []).length)}`} sx={{ borderRadius: 0, bgcolor: '#FFF7ED', color: '#C65A11' }} />
            <Chip size="small" label={`Configured columns ${fmt(columnSettingsCount)}`} sx={{ borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467' }} />
          </Box>
        </Stack>
      </WorkbenchSection>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.1fr) minmax(360px,0.9fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="What Will Move Forward" description="This is the clean handoff view for the next stage, not the raw trace log.">
          <Stack spacing={1.1}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
              <Paper variant="outlined" sx={{ p: 1.15, borderRadius: 0, bgcolor: '#FBFCFE' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Output table
                </Typography>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#101828', mt: 0.3 }}>
                  {outputTable}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.15, borderRadius: 0, bgcolor: '#FBFCFE' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Compatibility
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#101828', mt: 0.3 }}>
                  Supervised, graph, unsupervised
                </Typography>
              </Paper>
            </Box>
            <Typography sx={{ fontSize: 12.25, color: '#475467', lineHeight: 1.65 }}>
              {data?.downstream_compatibility?.notes || 'The output is ready for downstream Mule model-build tracks.'}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {topFamilies.map(([family, count]) => (
                <Chip
                  key={family}
                  size="small"
                  label={`${family}: ${count}`}
                  sx={{ borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467', border: '1px solid rgba(15,23,42,0.10)' }}
                />
              ))}
            </Stack>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {selectedVisible.map((feature) => (
                <Chip
                  key={`selected_${feature}`}
                  label={feature}
                  size="small"
                  sx={{ borderRadius: 0, fontFamily: 'monospace', bgcolor: '#ECFDF3', color: '#027A48', border: '1px solid rgba(2,122,72,0.16)' }}
                />
              ))}
            </Box>
            {selectedFeatures.length > selectedVisible.length ? (
              <Button variant="outlined" onClick={() => setShowAllSelected(true)} sx={{ width: 'fit-content', textTransform: 'none', borderRadius: 0 }}>
                Show all selected features ({selectedFeatures.length})
              </Button>
            ) : null}
          </Stack>
        </WorkbenchSection>

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <WorkbenchSection title="Why Features Were Dropped" description="This is the shortlist of features removed before model training.">
            {droppedVisible.length ? (
              <Paper variant="outlined" sx={{ borderRadius: 0 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                      <TableCell sx={{ fontWeight: 800 }}>Feature</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {droppedVisible.map((row, index) => (
                      <TableRow key={`dropped_${row?.feature || index}`}>
                        <TableCell sx={{ fontSize: 12.25, fontFamily: 'monospace' }}>{row?.feature || 'Unknown feature'}</TableCell>
                        <TableCell sx={{ fontSize: 12.25 }}>{row?.reason || 'Dropped by selection rules'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            ) : (
              <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
                No dropped features are recorded for this preprocessing configuration.
              </Typography>
            )}
            {droppedFeatures.length > droppedVisible.length ? (
              <Button variant="outlined" onClick={() => setShowAllDropped(true)} sx={{ width: 'fit-content', textTransform: 'none', borderRadius: 0 }}>
                Show all dropped features ({droppedFeatures.length})
              </Button>
            ) : null}
          </WorkbenchSection>

          <WorkbenchSection title="Configuration Snapshot">
            <Stack spacing={0.75}>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Missing strategy default: <strong>{data?.transformations_applied?.missing_strategy_default || 'Not set'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Scaling default: <strong>{data?.transformations_applied?.scaling_default || 'none'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Normalization default: <strong>{data?.transformations_applied?.normalization_default || 'none'}</strong>
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467' }}>
                Auto-generated transform rules: <strong>{data?.transformations_applied?.auto_generated ? 'Yes' : 'No'}</strong>
              </Typography>
              {!!Object.keys(autoSummary || {}).length && (
                <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mt: 0.35 }}>
                  {Object.entries(autoSummary).slice(0, 8).map(([key, value]) => (
                    <Chip key={key} size="small" label={`${key}: ${value}`} sx={{ borderRadius: 0, bgcolor: '#FBFCFE', border: '1px solid rgba(15,23,42,0.10)' }} />
                  ))}
                </Box>
              )}
            </Stack>
          </WorkbenchSection>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Engineered Features Included">
          {(data?.engineered_features_added || []).length ? (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(data?.engineered_features_added || []).map((feature) => (
                <Chip key={feature} size="small" label={feature} sx={{ borderRadius: 0, bgcolor: '#FFF7ED', color: '#C65A11' }} />
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
              No engineered features were added in this run.
            </Typography>
          )}
        </WorkbenchSection>

        <WorkbenchSection title="Artifacts Created">
          <Paper variant="outlined" sx={{ borderRadius: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  <TableCell sx={{ fontWeight: 800 }}>Artifact</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Path</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {artifactVisible.map((row) => (
                  <TableRow key={`${row.artifact_id}_${row.artifact_type}`}>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.artifact_type}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{clip(row.storage_ref, 120)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
          {artifacts.length > artifactVisible.length ? (
            <Button variant="outlined" onClick={() => setShowAllArtifacts(true)} sx={{ width: 'fit-content', textTransform: 'none', borderRadius: 0 }}>
              Show all artifacts ({artifacts.length})
            </Button>
          ) : null}
        </WorkbenchSection>
      </Box>
    </Box>
  );
}
