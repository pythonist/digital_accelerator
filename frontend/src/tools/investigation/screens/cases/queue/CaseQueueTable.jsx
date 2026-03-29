import React from 'react';
import {
  Box,
  Checkbox,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import { ChevronRight } from '@mui/icons-material';

import { formatDateTime, formatNumber, severityTone, statusTone } from './queueUtils';

const headCells = [
  { id: 'case_id', label: 'Case ID' },
  { id: 'customer_name', label: 'Customer' },
  { id: 'account_id', label: 'Account' },
  { id: 'scenario_name', label: 'Scenario / Alert Type' },
  { id: 'risk_score', label: 'Risk Score', sortable: true, align: 'right' },
  { id: 'severity', label: 'Severity' },
  { id: 'assigned_to', label: 'Assigned Analyst' },
  { id: 'current_stage', label: 'Current Stage' },
  { id: 'current_status', label: 'Status' },
  { id: 'escalated_to', label: 'Escalated To' },
  { id: 'last_updated_at', label: 'Last Updated', sortable: true },
  { id: 'ageing', label: 'SLA / Ageing', sortable: true },
  { id: 'actions', label: 'Actions', align: 'center' },
];

const CaseQueueTable = ({
  rows,
  loading,
  pagination,
  selectedCaseIds,
  onToggleAll,
  onToggleRow,
  onSort,
  sortBy,
  sortDir,
  onOpenCase,
  onPageChange,
  onPageSizeChange,
}) => {
  const allChecked = rows.length > 0 && rows.every((row) => selectedCaseIds.includes(row.case_id));
  const someChecked = rows.some((row) => selectedCaseIds.includes(row.case_id));

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer sx={{ maxHeight: 'calc(100vh - 360px)' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ backgroundColor: '#f8fafc' }}>
                <Checkbox checked={allChecked} indeterminate={!allChecked && someChecked} onChange={() => onToggleAll(rows)} />
              </TableCell>
              {headCells.map((cell) => (
                <TableCell key={cell.id} align={cell.align || 'left'} sx={{ backgroundColor: '#f8fafc', whiteSpace: 'nowrap', fontWeight: 800 }}>
                  {cell.sortable ? (
                    <TableSortLabel
                      active={sortBy === cell.id}
                      direction={sortBy === cell.id ? sortDir : 'asc'}
                      onClick={() => onSort(cell.id)}
                    >
                      {cell.label}
                    </TableSortLabel>
                  ) : cell.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={headCells.length + 1}>
                  <Box sx={{ py: 8, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>No cases matched the current view</Typography>
                    <Typography sx={{ mt: 0.6, fontSize: 13, color: '#64748b' }}>
                      Adjust the saved view or filters to bring a queue slice back into scope.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((row) => {
              const selected = selectedCaseIds.includes(row.case_id);
              const severity = severityTone(row.severity);
              const status = statusTone(row.current_status);
              return (
                <TableRow
                  hover
                  key={row.case_id}
                  selected={selected}
                  sx={{
                    cursor: 'pointer',
                    backgroundColor: row.is_overdue ? '#fffaf0' : undefined,
                    '& td': {
                      borderBottomColor: '#e5e7eb',
                    },
                  }}
                  onClick={() => onOpenCase(row.case_id)}
                >
                  <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={selected} onChange={() => onToggleRow(row.case_id)} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 800, color: '#0f172a' }}>{row.case_id}</TableCell>
                  <TableCell>{row.customer_name || row.customer_id || '-'}</TableCell>
                  <TableCell>{row.account_id || '-'}</TableCell>
                  <TableCell sx={{ minWidth: 190 }}>{row.scenario_name || '-'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{formatNumber(row.risk_score)}</TableCell>
                  <TableCell>
                    <Chip
                      label={row.severity || '-'}
                      size="small"
                      sx={{ color: severity.fg, backgroundColor: severity.bg, border: `1px solid ${severity.border}`, fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell>{row.assigned_to || '-'}</TableCell>
                  <TableCell>{row.current_stage || '-'}</TableCell>
                  <TableCell>
                    <Chip
                      label={row.current_status || '-'}
                      size="small"
                      sx={{ color: status.fg, backgroundColor: status.bg, border: `1px solid ${status.border}`, fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell>{row.escalated_to || '-'}</TableCell>
                  <TableCell>{formatDateTime(row.last_updated_at)}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: row.is_overdue ? '#b45309' : '#0f172a' }}>
                      {row.sla_label}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>
                      {Number(row.ageing_days || 0)}d ageing
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Open case details">
                      <IconButton size="small">
                        <ChevronRight fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        rowsPerPageOptions={[10, 25, 50]}
        count={pagination.total || 0}
        rowsPerPage={pagination.page_size || 25}
        page={Math.max(0, (pagination.page || 1) - 1)}
        onPageChange={(_, page) => onPageChange(page + 1)}
        onRowsPerPageChange={(event) => onPageSizeChange(Number(event.target.value))}
      />
    </Paper>
  );
};

export default CaseQueueTable;
