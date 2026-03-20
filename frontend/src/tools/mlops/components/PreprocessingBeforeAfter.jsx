/**
 * PreprocessingBeforeAfter.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone component for showing side-by-side before/after preprocessing tables.
 * Import and use in PreprocessingWorkbench's PREVIEW tab.
 *
 * Usage in PreprocessingWorkbench.jsx (in the Preview/RunTab sections):
 *
 *   import PreprocessingBeforeAfter from './PreprocessingBeforeAfter';
 *
 *   <PreprocessingBeforeAfter
 *     masterDataset={masterDataset}        // before
 *     preprocessedDataset={preview?.dataset || preprocessDataset}  // after
 *     persona={persona}
 *   />
 *
 * Props:
 *   masterDataset         dataset object (has dataset_id)
 *   preprocessedDataset   dataset object (has dataset_id) - null until run
 *   preview               preview result object from onPreview (has before/after sample)
 *   persona               'business' | 'technical'
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider,
  Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import {
  ArrowForward,
  CheckCircle,
  CompareArrows,
  DataObject,
  ErrorOutline,
  Info,
  TableChart,
  TrendingDown,
  TrendingUp,
  Warning,
} from '@mui/icons-material';
import mlopsApi from '../services/mlopsApi';

// ── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  orange:    '#D04A02',
  orangeLight: '#fff1ec',
  done:      '#22c55e',
  doneLight: '#f0fdf4',
  amber:     '#f59e0b',
  red:       '#ef4444',
  border:    '#e2e8f0',
  canvas:    '#f5f6f8',
  textMuted: '#64748b',
  textDim:   '#94a3b8',
  paper:     '#ffffff',
  mono:      '"Fira Code", "Cascadia Code", monospace',
};

// ── Value cell renderer ───────────────────────────────────────────────────────
const CellValue = ({ value, colType, isChanged }) => {
  const isNull = value == null || value === '';
  return (
    <td style={{
      padding: '5px 8px', fontSize: 11.5, whiteSpace: 'nowrap',
      maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
      color: isNull ? T.textDim : isChanged ? T.orange : '#1e293b',
      fontFamily: colType === 'numeric' ? T.mono : 'inherit',
      background: isChanged ? T.orangeLight : 'transparent',
    }}>
      <span title={String(value ?? '')}>
        {isNull ? <span style={{ color: T.textDim, fontStyle: 'italic', fontSize: 10 }}>null</span> : String(value)}
      </span>
    </td>
  );
};

// ── Column diff summary ───────────────────────────────────────────────────────
const ColumnDiff = ({ before, after }) => {
  if (!before || !after) return null;

  const added   = after.columns.filter((c) => !before.columns.includes(c));
  const removed = before.columns.filter((c) => !after.columns.includes(c));
  const common  = before.columns.filter((c) => after.columns.includes(c));

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={3}>
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Before
          </Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>
            {before.col_count}
            <Typography component="span" sx={{ fontSize: 12, color: T.textMuted, fontWeight: 500, ml: 0.5 }}>
              columns
            </Typography>
          </Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>
            {before.row_count?.toLocaleString()} rows
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <ArrowForward sx={{ color: T.orange, fontSize: 24 }} />
        </Box>

        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            After
          </Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>
            {after.col_count}
            <Typography component="span" sx={{ fontSize: 12, color: T.textMuted, fontWeight: 500, ml: 0.5 }}>
              columns
            </Typography>
          </Typography>
          <Typography sx={{ fontSize: 11, color: T.textMuted }}>
            {after.row_count?.toLocaleString()} rows
          </Typography>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Stack spacing={0.5} justifyContent="center">
          {added.length > 0 && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <TrendingUp sx={{ fontSize: 14, color: T.done }} />
              <Typography sx={{ fontSize: 12, color: T.done }}>
                {added.length} column{added.length !== 1 ? 's' : ''} added
              </Typography>
            </Stack>
          )}
          {removed.length > 0 && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <TrendingDown sx={{ fontSize: 14, color: T.red }} />
              <Typography sx={{ fontSize: 12, color: T.red }}>
                {removed.length} column{removed.length !== 1 ? 's' : ''} removed
              </Typography>
            </Stack>
          )}
          {added.length === 0 && removed.length === 0 && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <CheckCircle sx={{ fontSize: 14, color: T.done }} />
              <Typography sx={{ fontSize: 12, color: T.done }}>Same schema</Typography>
            </Stack>
          )}
        </Stack>
      </Stack>

      {/* Added columns chips */}
      {added.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: T.textMuted, mb: 0.5 }}>
            NEW COLUMNS
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5} useFlexGap>
            {added.slice(0, 20).map((c) => (
              <Chip
                key={c}
                label={c}
                size="small"
                sx={{
                  height: 20, fontSize: 10.5,
                  bgcolor: T.doneLight, color: '#15803d',
                  border: '1px solid #bbf7d0',
                  fontFamily: T.mono,
                }}
              />
            ))}
            {added.length > 20 && (
              <Chip label={`+${added.length - 20} more`} size="small" sx={{ height: 20, fontSize: 10.5 }} />
            )}
          </Stack>
        </Box>
      )}

      {/* Removed columns chips */}
      {removed.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: T.textMuted, mb: 0.5 }}>
            REMOVED COLUMNS
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5} useFlexGap>
            {removed.slice(0, 20).map((c) => (
              <Chip
                key={c}
                label={c}
                size="small"
                sx={{
                  height: 20, fontSize: 10.5,
                  bgcolor: '#fef2f2', color: T.red,
                  border: '1px solid #fecaca',
                  fontFamily: T.mono,
                  textDecoration: 'line-through',
                }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
};

// ── Data table ────────────────────────────────────────────────────────────────
const DataTable = ({ data, label, highlightCols = [], maxRows = 30 }) => {
  if (!data?.sample?.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', color: T.textMuted }}>
        <TableChart sx={{ fontSize: 36, mb: 1, color: T.textDim }} />
        <Typography sx={{ fontSize: 13 }}>No data available</Typography>
      </Box>
    );
  }

  const cols = data.columns || [];
  const rows = data.sample.slice(0, maxRows);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 10, color: T.textDim }}>
          Showing {rows.length} of {data.row_count?.toLocaleString() ?? '?'} rows · {cols.length} columns
        </Typography>
      </Stack>

      <Box sx={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 1.5 }}>
        <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: `2px solid ${T.border}` }}>
              {cols.map((col) => {
                const isHighlighted = highlightCols.includes(col);
                return (
                  <th
                    key={col}
                    style={{
                      padding: '6px 8px', textAlign: 'left', fontSize: 10.5,
                      fontWeight: 700, color: isHighlighted ? T.orange : T.textMuted,
                      whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3,
                      background: isHighlighted ? T.orangeLight : 'transparent',
                      borderRight: `1px solid ${T.border}`,
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.25}>
                      <span>{col}</span>
                      {data.column_types?.[col] && (
                        <span style={{
                          fontSize: 9, padding: '1px 4px',
                          borderRadius: 3, background: '#e2e8f0',
                          color: T.textMuted, fontWeight: 500,
                        }}>
                          {data.column_types[col].substring(0, 3)}
                        </span>
                      )}
                    </Stack>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={{ borderBottom: `1px solid ${T.border}`, background: rowIdx % 2 === 0 ? T.paper : '#f8fafc' }}
              >
                {cols.map((col) => (
                  <CellValue
                    key={col}
                    value={row[col]}
                    colType={data.column_types?.[col]}
                    isChanged={highlightCols.includes(col)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const PreprocessingBeforeAfter = ({
  masterDataset,
  preprocessedDataset,
  preview,
  persona,
}) => {
  const [view, setView] = useState(0);   // 0=Schema diff, 1=Before table, 2=After table, 3=Side-by-side
  const [beforeData, setBeforeData] = useState(null);
  const [afterData, setAfterData]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  // Load data from API when datasets are available
  const loadData = useCallback(async () => {
    if (!masterDataset?.dataset_id) return;
    setLoading(true);
    setError(null);

    try {
      const params = {
        dataset_id: masterDataset.dataset_id,
        n_rows: 50,
        ...(preprocessedDataset?.dataset_id ? { after_dataset_id: preprocessedDataset.dataset_id } : {}),
      };
      const res  = await mlopsApi.preprocessBeforeAfter(params);
      const data = res?.data?.data || res?.data;
      if (data?.before) setBeforeData(data.before);
      if (data?.after)  setAfterData(data.after);
    } catch (e) {
      setError('Could not load dataset samples');
    } finally {
      setLoading(false);
    }
  }, [masterDataset?.dataset_id, preprocessedDataset?.dataset_id]);

  // Use preview data if available (from inline preview run)
  useEffect(() => {
    if (preview?.before_sample) {
      setBeforeData({
        columns:      preview.before_columns || [],
        column_types: preview.before_column_types || {},
        sample:       preview.before_sample,
        row_count:    masterDataset?.row_count,
        col_count:    (preview.before_columns || []).length,
      });
    }
    if (preview?.after_sample) {
      setAfterData({
        columns:      preview.after_columns || [],
        column_types: preview.after_column_types || {},
        sample:       preview.after_sample,
        row_count:    preview.output_rows,
        col_count:    (preview.after_columns || []).length,
      });
      return;
    }
    // Support preprocessPreview() shape: { columns, preview, row_count }
    if (preview?.preview && preview?.columns) {
      setAfterData({
        columns:      preview.columns || [],
        column_types: preview.column_types || {},
        sample:       preview.preview || [],
        row_count:    preview.row_count ?? preview.output_rows,
        col_count:    (preview.columns || []).length,
      });
    }
  }, [preview, masterDataset]);

  // Auto-load if no preview data
  useEffect(() => {
    if (!preview?.before_sample && masterDataset?.dataset_id) {
      loadData();
    }
  }, [masterDataset?.dataset_id, preprocessedDataset?.dataset_id, preview?.before_sample, loadData]);

  const changedCols = useMemo(() => {
    if (!beforeData || !afterData) return [];
    return afterData.columns.filter((c) => !beforeData.columns.includes(c));
  }, [beforeData, afterData]);

  return (
    <Stack spacing={2}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <CompareArrows sx={{ fontSize: 18, color: T.orange }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
            Before / After Comparison
          </Typography>
          {loading && <CircularProgress size={14} sx={{ color: T.orange }} />}
        </Stack>
        <Button
          size="small"
          startIcon={<CheckCircle />}
          onClick={loadData}
          disabled={loading || !masterDataset}
          sx={{ textTransform: 'none', fontSize: 11.5, color: T.textMuted, borderColor: T.border, borderRadius: 1.5 }}
          variant="outlined"
        >
          Refresh
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" icon={<ErrorOutline />} sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {!masterDataset && (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {persona === 'business'
            ? 'Build a master dataset first to see before/after comparisons.'
            : 'No masterDataset prop supplied - before sample unavailable.'}
        </Alert>
      )}

      {!preprocessedDataset && !preview?.after_sample && (
        <Alert severity="warning" icon={<Warning />} sx={{ borderRadius: 2 }}>
          {persona === 'business'
            ? 'Run the preprocessing pipeline to see the transformed data.'
            : 'No preprocessed dataset yet - run the pipeline or click Preview.'}
        </Alert>
      )}

      {/* View selector */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
        <Tabs
          value={view}
          onChange={(_, v) => setView(v)}
          sx={{
            bgcolor: '#f8fafc',
            borderBottom: `1px solid ${T.border}`,
            '& .MuiTab-root': { textTransform: 'none', fontSize: 12.5, fontWeight: 600, minHeight: 40 },
            '& .Mui-selected': { color: T.orange },
            '& .MuiTabs-indicator': { bgcolor: T.orange },
          }}
        >
          <Tab label="Schema Changes" icon={<DataObject sx={{ fontSize: 14 }} />} iconPosition="start" />
          <Tab label="Before" icon={<TableChart sx={{ fontSize: 14 }} />} iconPosition="start" disabled={!beforeData} />
          <Tab label="After" icon={<TableChart sx={{ fontSize: 14 }} />} iconPosition="start" disabled={!afterData} />
        </Tabs>
      </Paper>

      {/* Schema diff view */}
      {view === 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
          {beforeData || afterData ? (
            <ColumnDiff before={beforeData} after={afterData} />
          ) : !loading ? (
            <Typography sx={{ fontSize: 13, color: T.textMuted }}>
              Run the pipeline or click Refresh to populate this view.
            </Typography>
          ) : (
            <Stack alignItems="center" py={3}>
              <CircularProgress size={32} sx={{ color: T.orange }} />
            </Stack>
          )}
        </Paper>
      )}

      {/* Before table */}
      {view === 1 && beforeData && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <DataTable data={beforeData} label="Original (before preprocessing)" />
        </Paper>
      )}

      {/* After table */}
      {view === 2 && afterData && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <DataTable
            data={afterData}
            label="Transformed (after preprocessing)"
            highlightCols={changedCols}
          />
        </Paper>
      )}
    </Stack>
  );
};

export default PreprocessingBeforeAfter;
