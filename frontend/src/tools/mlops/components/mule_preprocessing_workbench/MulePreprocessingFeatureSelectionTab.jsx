import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
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

import { WorkbenchSection } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();
const fmtScore = (value, digits = 4) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : '-';
};
const humanize = (value = '') => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

export default function MulePreprocessingFeatureSelectionTab({
  data,
  methods,
  onMethodsChange,
  onSave,
  saving,
  loading = false,
}) {
  const candidateRows = data?.candidate_features || [];
  const droppedRows = data?.dropped_features || [];
  const methodCatalog = data?.method_catalog || Object.entries(methods || {}).map(([key, value]) => ({
    id: key,
    label: humanize(key),
    description: '',
    enabled: Boolean(value),
  }));

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {data?.warning ? (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Feature selection analysis fallback is active: {data.warning}
        </Alert>
      ) : null}
      {loading ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          Loading candidate features and selection decisions from backend analysis. This tab is not frozen, it is waiting for the Mule screening payload to return.
        </Alert>
      ) : null}
      <WorkbenchSection
        title="Feature Selection"
        description="Review the feature-store-selected columns, apply statistical screening techniques, and keep only the model-ready Mule signals for the next step."
        action={(
          <Button variant="contained" onClick={onSave} disabled={saving} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>
            {saving ? 'Saving...' : 'Save Selection Rules'}
          </Button>
        )}
      >
        <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
          <Chip size="small" label={`${fmt(data?.input_feature_count)} feature-store columns`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FFF7ED', color: '#C65A11' }} />
          <Chip size="small" label={`${fmt((data?.selected_features || []).length)} selected`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#ECFDF3', color: '#027A48' }} />
          <Chip size="small" label={`${fmt(droppedRows.length)} dropped`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#FEF3F2', color: '#B42318' }} />
          <Chip size="small" label={`${fmt(candidateRows.length)} candidates`} sx={{ borderRadius: 0, fontWeight: 700, bgcolor: '#F8FAFC', color: '#475467' }} />
        </Stack>
      </WorkbenchSection>

      <WorkbenchSection title="Selection Techniques" description="These techniques drive the statistical screening logic behind the candidate table.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(5, minmax(0,1fr))' }, gap: 1 }}>
          {methodCatalog.map((method) => (
            <Paper key={method.id} variant="outlined" sx={{ p: 1.1, borderRadius: 0, boxShadow: 'none' }}>
              <Stack direction="row" spacing={0.9} alignItems="flex-start">
                <Checkbox size="small" checked={Boolean((methods || {})[method.id])} onChange={(e) => onMethodsChange(method.id, e.target.checked)} sx={{ mt: -0.4 }} />
                <Box>
                  <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>
                    {method.label}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: '#667085', mt: 0.35, lineHeight: 1.6 }}>
                    {method.description || 'Selection logic for this technique is active in the Mule screening flow.'}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Box>
      </WorkbenchSection>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.25fr) minmax(0,0.75fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Candidate Features" description="Features selected from Feature Store carry a visible source tag so you can trace what is flowing from the stored library into model preparation.">
          <Paper variant="outlined" sx={{ borderRadius: 0, boxShadow: 'none' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  <TableCell sx={{ fontWeight: 800 }}>Feature</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Family</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Correlation</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Model Score</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Decision</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidateRows.slice(0, 120).map((row) => (
                  <TableRow key={row.feature_name}>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828' }}>
                        {row.feature_name}
                      </Typography>
                      <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" sx={{ mt: 0.45 }}>
                        {row.protected ? <Chip size="small" label="Protected" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#FFF7ED', color: '#C65A11' }} /> : null}
                        {row.selected_in_feature_store ? <Chip size="small" label="From Feature Store" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#EFF6FF', color: '#1D4ED8' }} /> : null}
                        {!row.selected_in_feature_store ? <Chip size="small" label="Engineered" sx={{ height: 18, fontSize: 9, borderRadius: 0, bgcolor: '#F5F3FF', color: '#6D28D9' }} /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.source_tag || row.origin || '-'}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.family}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{fmtScore(row.correlation_score)}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{fmtScore(row.model_score)}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>
                      <Typography sx={{ fontSize: 12.1, color: row.protected ? '#0F5F44' : '#475467' }}>
                        {row.technical_reason}
                      </Typography>
                      <Typography sx={{ fontSize: 11.25, color: '#667085', mt: 0.35 }}>
                        {row.business_reason}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {!candidateRows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ fontSize: 12.25, color: '#667085' }}>
                      {loading
                        ? 'Loading candidate features from backend analysis...'
                        : 'No candidate features returned yet. Refresh after the backend selection analysis completes.'}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Paper>
        </WorkbenchSection>

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <WorkbenchSection title="Selected vs Dropped">
            <Typography sx={{ fontSize: 12.25, color: '#475467', mb: 0.75 }}>
              Selected: <strong>{(data?.selected_features || []).length}</strong> | Dropped: <strong>{droppedRows.length}</strong>
            </Typography>
            <Stack spacing={0.6}>
              {droppedRows.slice(0, 14).map((row) => (
                <Typography key={`${row.feature}_${row.reason}`} sx={{ fontSize: 12.1, color: '#667085' }}>
                  {row.feature}: <strong>{row.reason}</strong>
                </Typography>
              ))}
              {!droppedRows.length ? (
                <Typography sx={{ fontSize: 12.1, color: '#667085' }}>
                  No features are currently marked as dropped.
                </Typography>
              ) : null}
            </Stack>
          </WorkbenchSection>

          <WorkbenchSection title="Feature Family Coverage">
            <Stack spacing={0.7}>
              {(data?.family_summary || []).map((row) => (
                <Box key={row.family} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontSize: 12.25, color: '#101828' }}>{row.family}</Typography>
                  <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#475467' }}>
                    {row.selected_count}/{row.candidate_count}
                  </Typography>
                </Box>
              ))}
              {!(data?.family_summary || []).length ? (
                <Typography sx={{ fontSize: 12.1, color: '#667085' }}>
                  Family coverage will appear after feature selection analysis returns candidates.
                </Typography>
              ) : null}
            </Stack>
          </WorkbenchSection>
        </Box>
      </Box>
    </Box>
  );
}
