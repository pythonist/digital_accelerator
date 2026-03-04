/**
 * steps/StepData.jsx
 * Wizard step 1: Select which uploaded datasets to use.
 * Shows datasets in plain language (no technical IDs).
 */
import React from 'react';
import { Box, Stack, Typography, Checkbox } from '@mui/material';

const DATASET_LABELS = {
  transactions: { code: 'TXN', title: 'Transaction Records', hint: 'Payment and transfer history' },
  accounts: { code: 'ACCT', title: 'Account Information', hint: 'Account profile and status data' },
  customers: { code: 'CUST', title: 'Customer Profiles', hint: 'Customer attributes and risk profile' },
  alerts: { code: 'ALRT', title: 'Alert History', hint: 'Rule-triggered alert events' },
  cases: { code: 'CASE', title: 'Case Records', hint: 'Investigation outcomes and dispositions' },
  default: { code: 'DATA', title: 'Data Table', hint: 'Uploaded dataset' },
};

const DatasetRow = ({ dataset, selected, onToggle }) => {
  const meta = DATASET_LABELS[dataset.dataset_type] || {
    ...DATASET_LABELS.default,
    title: dataset.dataset_type?.replace(/_/g, ' ') || 'Data Table',
  };
  const rows = dataset.row_count ? Number(dataset.row_count).toLocaleString() : '-';
  const cols = dataset.column_count ?? dataset.columns?.length ?? '-';

  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2, py: 1.5,
        border: `2px solid ${selected ? '#D04A02' : '#e2e8f0'}`,
        borderRadius: 2,
        bgcolor: selected ? '#fff1ec' : '#fff',
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { borderColor: '#D04A02', bgcolor: '#fff1ec' },
      }}
    >
      <Checkbox
        checked={selected}
        onChange={onToggle}
        sx={{ p: 0, color: '#D04A02', '&.Mui-checked': { color: '#D04A02' } }}
        onClick={(e) => e.stopPropagation()}
      />
      <Box sx={{
        minWidth: 46,
        px: 1,
        py: 0.5,
        borderRadius: 1.25,
        border: '1px solid #f2c8b5',
        bgcolor: '#fff7f3',
      }}>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#A83A00', textAlign: 'center', letterSpacing: 0.3 }}>
          {meta.code}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{meta.title}</Typography>
        <Typography sx={{ fontSize: 11, color: '#64748b' }}>{meta.hint}</Typography>
      </Box>
      <Stack alignItems="flex-end">
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{rows} rows</Typography>
        <Typography sx={{ fontSize: 10.5, color: '#94a3b8' }}>{cols} columns</Typography>
      </Stack>
    </Box>
  );
};

const StepData = ({ datasets, selectedIds, onToggle }) => {
  if (!datasets?.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', bgcolor: '#f8fafc', borderRadius: 2, border: '1.5px dashed #e2e8f0' }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: '#1e293b', mb: 0.5 }}>No data uploaded yet</Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b' }}>
          Go to the Data Upload step first, then come back here.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1}>
      {datasets.map((d) => (
        <DatasetRow
          key={d.dataset_id}
          dataset={d}
          selected={selectedIds.includes(d.dataset_id)}
          onToggle={() => onToggle(d.dataset_id)}
        />
      ))}
    </Stack>
  );
};

export default StepData;
