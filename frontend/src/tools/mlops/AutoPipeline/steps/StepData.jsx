/**
 * steps/StepData.jsx
 * Wizard step 1: Select which uploaded datasets to use.
 * Shows datasets in plain language (no technical IDs).
 */
import React from 'react';
import { Box, Stack, Typography, Checkbox } from '@mui/material';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

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
        border: `2px solid ${selected ? FCC_THEME.accent : FCC_THEME.border}`,
        borderRadius: 2,
        bgcolor: selected ? FCC_THEME.accentSoft : FCC_THEME.panel,
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { borderColor: FCC_THEME.accent, bgcolor: FCC_THEME.accentSoft },
      }}
    >
      <Checkbox
        checked={selected}
        onChange={onToggle}
        sx={{ p: 0, color: FCC_THEME.accent, '&.Mui-checked': { color: FCC_THEME.accent } }}
        onClick={(e) => e.stopPropagation()}
      />
      <Box sx={{
        minWidth: 46,
        px: 1,
        py: 0.5,
        borderRadius: 1.25,
        border: `1px solid ${FCC_THEME.accentBorder}`,
        bgcolor: FCC_THEME.accentSoft,
      }}>
        <Typography sx={{ fontSize: 11, fontWeight: 800, color: FCC_THEME.accentHover, textAlign: 'center', letterSpacing: 0.3 }}>
          {meta.code}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>{meta.title}</Typography>
        <Typography sx={{ fontSize: 11, color: FCC_THEME.textMuted }}>{meta.hint}</Typography>
      </Box>
      <Stack alignItems="flex-end">
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: FCC_THEME.textMuted }}>{rows} rows</Typography>
        <Typography sx={{ fontSize: 10.5, color: FCC_THEME.textSoft }}>{cols} columns</Typography>
      </Stack>
    </Box>
  );
};

const StepData = ({ datasets, selectedIds, onToggle }) => {
  if (!datasets?.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', bgcolor: FCC_THEME.panelAlt, borderRadius: 2, border: `1.5px dashed ${FCC_THEME.border}` }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: FCC_THEME.text, mb: 0.5 }}>No data uploaded yet</Typography>
        <Typography sx={{ fontSize: 12, color: FCC_THEME.textMuted }}>
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
