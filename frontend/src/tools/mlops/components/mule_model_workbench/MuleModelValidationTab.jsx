import React from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Select,
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

export default function MuleModelValidationTab({ data, onSave, saving }) {
  const summary = data?.dataset_summary || {};
  const target = data?.target_definition || {};
  const typologyTraining = data?.typology_training || {};
  const split = data?.split_summary || {};
  const blockers = Array.isArray(data?.blockers) ? data.blockers : [];
  const typologyClasses = Array.isArray(typologyTraining.labeled_classes) ? typologyTraining.labeled_classes : [];
  const classRows = Array.isArray(target?.classes) ? target.classes : [];

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.15fr) minmax(0,0.85fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Validation Readiness" description="Confirm that the multiclass target is defined cleanly, split boundaries are governed, and leakage-prone fields stay out of training.">
          <Stack spacing={0.9}>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Dataset rows</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(summary.row_count)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Dataset columns</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(summary.column_count)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Resolved target source</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{target.resolved_source || 'Not resolved'}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Derived target</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{target.derived_name || 'mule_multiclass_target'}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Classes</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{(target.classes || []).join(', ') || 'Not available'}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Split strategy</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{split.strategy || 'Pending'}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Typology labelled rows</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(typologyTraining.labeled_rows)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontSize: 12.5, color: '#667085' }}>Typology labelled classes</Typography><Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{typologyClasses.join(', ') || 'Not available'}</Typography></Stack>
          </Stack>
        </WorkbenchSection>
        <WorkbenchSection
          title="Typology Prediction Readiness"
          action={(
            <Button
              variant="outlined"
              size="small"
              onClick={() => onSave?.({ target: { source: 'auto' } })}
              disabled={saving}
              sx={{ textTransform: 'none', borderRadius: 0 }}
            >
              Refresh Target Rule
            </Button>
          )}
        >
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.6 }}>
              The workbench treats Mule typology as the primary multiclass target. Empty typology rows are assigned to the governed `non_mule` class for validation, but client-facing category prediction still needs at least two real labelled typology classes.
            </Typography>
            <Select
              size="small"
              value={target.requested_source || 'auto'}
              onChange={(event) => onSave?.({ target: { source: event.target.value } })}
              sx={{ maxWidth: 320, borderRadius: 0 }}
            >
              <MenuItem value="auto">Auto-select best Mule label</MenuItem>
              {(target.candidate_columns || []).map((item) => (
                <MenuItem key={item.column} value={item.column}>{item.column}</MenuItem>
              ))}
            </Select>
            <Alert severity={typologyTraining.ready ? 'success' : 'warning'} sx={{ borderRadius: 0 }}>
              {typologyTraining.reason || 'Typology readiness has not been evaluated yet.'}
            </Alert>
            <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.6 }}>
              Client output will show predicted Mule category probabilities once the typology model trains successfully.
            </Typography>
            {blockers.length ? blockers.map((item) => (
              <Typography key={item} sx={{ fontSize: 12.5, color: '#B42318' }}>{item}</Typography>
            )) : (
              <Typography sx={{ fontSize: 12.5, color: '#027A48' }}>Training is unblocked at the validation layer.</Typography>
            )}
          </Stack>
        </WorkbenchSection>
      </Box>

      <WorkbenchSection title="Split Distribution">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 800 }}>Split</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Rows</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Class distribution</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(split.splits || []).map((row) => (
              <TableRow key={row.name}>
                <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.name}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{fmt(row.row_count)}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{(row.class_distribution || []).map((item) => `${item.class_name}: ${item.count} (${item.pct}%)`).join(' | ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </WorkbenchSection>

      <WorkbenchSection title="Multiclass Label Mapping">
        <Typography sx={{ fontSize: 12.5, color: '#667085', mb: 0.9, lineHeight: 1.6 }}>
          The model is trained on multiclass typology labels. Numeric `0/1` values are binary risk flags (`mule_flag`) and not the final typology class space.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F8FAFC' }}>
              <TableCell sx={{ fontWeight: 800 }}>Encoded ID</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Class Label</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {classRows.map((className, idx) => (
              <TableRow key={`${className}_${idx}`}>
                <TableCell sx={{ fontSize: 12.25 }}>{idx}</TableCell>
                <TableCell sx={{ fontSize: 12.25 }}>{className}</TableCell>
              </TableRow>
            ))}
            {!classRows.length ? (
              <TableRow>
                <TableCell colSpan={2} sx={{ fontSize: 12.25, color: '#667085' }}>
                  Class mapping will appear once target resolution is complete.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </WorkbenchSection>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Excluded Leakage / ID Columns">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...(data?.leakage_columns || []), ...(data?.excluded_id_columns || [])].slice(0, 18).map((row) => (
                <TableRow key={`${row.column}_${row.reason}`}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.column}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
        <WorkbenchSection title="Column Role Scan">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Role</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Family</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Missing %</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.column_roles || []).slice(0, 18).map((row) => (
                <TableRow key={row.column_name}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.column_name}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.role}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.family}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.missing_pct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
      </Box>
    </Stack>
  );
}
