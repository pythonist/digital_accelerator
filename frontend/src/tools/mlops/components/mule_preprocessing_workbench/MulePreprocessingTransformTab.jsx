import React from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AutoFixHigh, Refresh } from '@mui/icons-material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

const encodingOptions = ['none', 'binary', 'one_hot', 'ordinal', 'frequency', 'target_safe'];
const missingOptions = ['median', 'mean', 'mode', 'constant', 'missing_flag', 'leave'];
const scalingOptions = ['none', 'standard', 'minmax', 'robust', 'log', 'winsorize'];

const fmt = (value) => Number(value || 0).toLocaleString();

const summaryItems = (summary = {}) => {
  const roles = summary?.role_counts || {};
  const types = summary?.type_counts || {};
  return [
    { label: 'Columns', value: fmt(summary?.column_count || 0), helper: 'Current transform plan scope' },
    { label: 'Identifiers', value: fmt(roles.identifier || 0), helper: 'Preserved for lineage and traceability' },
    { label: 'Numerical', value: fmt(types.numerical || 0), helper: 'Median-style missing handling by default' },
    { label: 'Categorical', value: fmt(types.categorical || 0), helper: 'Auto-routed to encoding recommendations' },
  ];
};

export default function MulePreprocessingTransformTab({
  data,
  preview,
  onColumnConfigChange,
  onSave,
  onValidate,
  onPreview,
  onAutoConfigure,
  saving,
  autoBusy,
}) {
  const rows = data?.column_profiles || [];
  const summary = data?.transform_summary || {};

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <WorkbenchSection
        title="Transform"
        description="Auto-classify identifier, numeric, categorical, and datetime columns, then adjust deterministic encoding, missing-value, and scaling rules before the Mule preprocessing run."
        action={(
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={autoBusy ? <Refresh /> : <AutoFixHigh />}
              onClick={onAutoConfigure}
              disabled={autoBusy}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              {autoBusy ? 'Auto Configuring...' : 'Auto Configure Columns'}
            </Button>
            <Button variant="outlined" onClick={onValidate} sx={{ textTransform: 'none', borderRadius: 0 }}>
              Validate Config
            </Button>
            <Button variant="outlined" onClick={onPreview} sx={{ textTransform: 'none', borderRadius: 0 }}>
              Preview Transform Plan
            </Button>
            <Button
              variant="contained"
              onClick={onSave}
              disabled={saving}
              sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}
            >
              {saving ? 'Saving...' : 'Save Transform Settings'}
            </Button>
          </Stack>
        )}
      >
        <Typography sx={{ fontSize: 12.25, color: '#667085', lineHeight: 1.7 }}>
          One click will inspect the current Mule feature-store dataset, classify columns by role and type, and populate a backend transform plan that the downstream feature-selection analysis and preprocessing run can reuse.
        </Typography>
      </WorkbenchSection>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
        {summaryItems(summary).map((item) => (
          <Paper key={item.label} variant="outlined" sx={{ p: 1.25, borderRadius: 0, boxShadow: 'none' }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: '#667085', textTransform: 'uppercase', letterSpacing: 0.65 }}>
              {item.label}
            </Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#101828', mt: 0.2 }}>
              {item.value}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: '#667085', mt: 0.35, lineHeight: 1.55 }}>
              {item.helper}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.45fr) minmax(320px,0.75fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Column Transform Plan" description="Review or override the auto-filled transform choices column by column.">
          <Paper variant="outlined" sx={{ borderRadius: 0, boxShadow: 'none' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  <TableCell sx={{ fontWeight: 800 }}>Column</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Encoding</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Missing</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Scaling</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(0, 60).map((row) => (
                  <TableRow key={row.column_name}>
                    <TableCell sx={{ minWidth: 230 }}>
                      <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>
                        {row.column_name}
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        <Chip label={row.business_role || 'feature'} size="small" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#FFF7ED', color: '#C65A11' }} />
                        <Chip label={`missing ${Number(row.missing_pct || 0).toFixed(1)}%`} size="small" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467' }} />
                        <Chip label={`unique ${fmt(row.unique_values)}`} size="small" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#F8FAFC', color: '#475467' }} />
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 140 }}>
                      <Typography sx={{ fontSize: 12.25, color: '#101828' }}>{row.detected_type}</Typography>
                      <Typography sx={{ fontSize: 10.75, color: '#667085', mt: 0.4 }}>
                        Recommended: {row.recommended_encoding || 'none'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.25, minWidth: 150 }}>
                      <Select
                        size="small"
                        fullWidth
                        value={row.selected_encoding || 'none'}
                        onChange={(e) => onColumnConfigChange(row.column_name, { encoding: e.target.value })}
                        sx={{ borderRadius: 0 }}
                      >
                        {encodingOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.25, minWidth: 150 }}>
                      <Select
                        size="small"
                        fullWidth
                        value={row.missing_strategy || row.recommended_missing_strategy || 'median'}
                        onChange={(e) => onColumnConfigChange(row.column_name, { missing_strategy: e.target.value })}
                        sx={{ borderRadius: 0 }}
                      >
                        {missingOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.25, minWidth: 150 }}>
                      <Select
                        size="small"
                        fullWidth
                        value={row.selected_scaling || 'none'}
                        onChange={(e) => onColumnConfigChange(row.column_name, { scaling: e.target.value })}
                        sx={{ borderRadius: 0 }}
                      >
                        {scalingOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
          {rows.length > 60 ? (
            <Typography sx={{ fontSize: 11, color: '#667085' }}>
              Showing the first 60 columns in the planner. The backend auto-config still covers the full dataset.
            </Typography>
          ) : null}
        </WorkbenchSection>

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <WorkbenchSection title="Auto-Classification Summary">
            <Stack spacing={0.9}>
              <Typography sx={{ fontSize: 12.25, color: '#475467', lineHeight: 1.7 }}>
                The backend classifies each field as identifier, target, feature, or datetime-aware context, then picks a starting transform choice using dataset cardinality, parseability, and model-family-safe defaults.
              </Typography>
              <Typography sx={{ fontSize: 12.25, color: '#475467', lineHeight: 1.7 }}>
                Model family hint: <strong>{data?.transform_config?.model_family_hint || 'tree_ensemble'}</strong>
              </Typography>
            </Stack>
          </WorkbenchSection>

          <WorkbenchSection title="Transformation Guidance">
            {Object.entries(data?.recommendations || {}).map(([key, value]) => (
              <Box key={key} sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: 12.25, fontWeight: 800, color: '#101828', textTransform: 'capitalize' }}>
                  {key}
                </Typography>
                <Typography sx={{ fontSize: 12.25, color: '#667085', mt: 0.4, lineHeight: 1.7 }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </WorkbenchSection>

          <WorkbenchSection title="Preview of Applied Transformations">
            {(preview?.transform_plan || []).length ? (
              <Stack spacing={0.75}>
                {(preview.transform_plan || []).slice(0, 12).map((row, idx) => (
                  <Box key={`${row.column}_${idx}`} sx={{ borderBottom: '1px solid rgba(15,23,42,0.08)', pb: 0.7 }}>
                    <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>
                      {row.column}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#667085', mt: 0.25 }}>
                      {row.action}
                    </Typography>
                    {(row.created_columns || []).length ? (
                      <Typography sx={{ fontSize: 11, color: '#667085', mt: 0.35 }}>
                        Created: {(row.created_columns || []).join(', ')}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
                Run transform preview to inspect the exact backend transform plan that will flow into feature selection and the preprocessing run.
              </Typography>
            )}
          </WorkbenchSection>
        </Box>
      </Box>
    </Box>
  );
}
