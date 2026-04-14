import React from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

const fmt = (value) => Number(value || 0).toLocaleString();

export default function MulePreprocessingDataOverviewTab({ data }) {
  const summary = data?.dataset_summary || {};
  const target = data?.target_metadata || {};
  if (!data?.dataset_ready) {
    return (
      <WorkbenchSection title="Data Overview">
        <Typography sx={{ fontSize: 12.5, color: '#667085', lineHeight: 1.7 }}>
          {data?.message || 'The selected Feature Store artifact is not available yet for preprocessing.'}
        </Typography>
      </WorkbenchSection>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Dataset Summary">
          {[
            ['Dataset id', summary.dataset_id || 'Not available'],
            ['Source', summary.dataset_type || 'feature_store'],
            ['Source file', summary.source_file || 'Not available'],
            ['Rows', fmt(summary.row_count)],
            ['Columns', fmt(summary.column_count)],
            ['Target column', target.target_column || 'mule_flag'],
            ['Positive class %', target?.positive_class_pct != null ? `${Number(target.positive_class_pct).toFixed(2)}%` : 'N/A'],
            ['Typology classes', Array.isArray(target.typology_classes) && target.typology_classes.length ? target.typology_classes.join(', ') : 'Not available'],
          ].map(([label, value]) => (
            <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.55, gap: 1.5 }}>
              <Typography sx={{ fontSize: 12.25, color: '#667085' }}>{label}</Typography>
              <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: '#101828', textAlign: 'right' }}>{value}</Typography>
            </Box>
          ))}
        </WorkbenchSection>
        <WorkbenchSection title="Feature Family Summary">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Family</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Count</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.feature_families || []).map((row) => (
                <TableRow key={row.family}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.family}</TableCell>
                  <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{fmt(row.feature_count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,0.8fr) minmax(0,1.2fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Class Distribution">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Class</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Count</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>%</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.class_distribution || []).map((row) => (
                <TableRow key={String(row.label)}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.label}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{fmt(row.count)}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.pct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
        <WorkbenchSection title="Highest Missingness">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Missing %</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Missing</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.missingness || []).slice(0, 12).map((row) => (
                <TableRow key={row.column}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.column}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.missing_pct}%</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{fmt(row.missing_count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkbenchSection>
      </Box>
      <WorkbenchSection title="Selected Feature Store Sample">
        {(data?.sample_rows || []).length ? (
          <Paper variant="outlined" sx={{ borderRadius: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  {(data?.sample_rows?.[0] ? Object.keys(data.sample_rows[0]).slice(0, 8) : []).map((column) => (
                    <TableCell key={column} sx={{ fontWeight: 800 }}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.sample_rows || []).slice(0, 8).map((row, idx) => (
                  <TableRow key={`sample_${idx}`}>
                    {Object.keys(data.sample_rows[0] || {}).slice(0, 8).map((column) => (
                      <TableCell key={`${idx}_${column}`} sx={{ fontSize: 12.25 }}>
                        {row[column] == null ? 'null' : String(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        ) : (
          <Typography sx={{ fontSize: 12.25, color: '#667085' }}>
            No sample rows are available yet.
          </Typography>
        )}
      </WorkbenchSection>
      <WorkbenchSection title="Column Roles and Types">
        <Paper variant="outlined" sx={{ borderRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                <TableCell sx={{ fontWeight: 800 }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Role</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Unique</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Missing %</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Family</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.column_profiles || []).slice(0, 40).map((row) => (
                <TableRow key={row.column_name}>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.column_name}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.detected_type}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.business_role}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{fmt(row.unique_values)}</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.missing_pct}%</TableCell>
                  <TableCell sx={{ fontSize: 12.25 }}>{row.family}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </WorkbenchSection>
    </Box>
  );
}
