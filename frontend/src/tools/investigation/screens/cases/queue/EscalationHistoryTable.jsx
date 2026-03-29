import React from 'react';
import {
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import { ChevronRight } from '@mui/icons-material';

import { formatDateTime } from './queueUtils';

const EscalationHistoryTable = ({ rows, onOpen }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Timestamp</TableCell>
            <TableCell>Case ID / Batch Ref</TableCell>
            <TableCell>Escalation Type</TableCell>
            <TableCell>Sent To</TableCell>
            <TableCell>Recipient Role</TableCell>
            <TableCell>Triggered By</TableCell>
            <TableCell>Mail Status</TableCell>
            <TableCell>Response Status</TableCell>
            <TableCell>Remarks</TableCell>
            <TableCell align="center">Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`${row.id || row.case_id || row.batch_ref || 'row'}_${index + 1}`} hover>
              <TableCell>{formatDateTime(row.sent_at)}</TableCell>
              <TableCell>{row.case_id || row.batch_ref || '-'}</TableCell>
              <TableCell>{row.escalation_type || '-'}</TableCell>
              <TableCell>{row.recipient_email || '-'}</TableCell>
              <TableCell>{row.recipient_role || '-'}</TableCell>
              <TableCell>{row.sent_by || '-'}</TableCell>
              <TableCell>{row.status || '-'}</TableCell>
              <TableCell>{row.response_status || '-'}</TableCell>
              <TableCell>{row.remarks || '-'}</TableCell>
              <TableCell align="center">
                <Tooltip title="Open details">
                  <IconButton size="small" onClick={() => onOpen(row)}>
                    <ChevronRight fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>
);

export default EscalationHistoryTable;
