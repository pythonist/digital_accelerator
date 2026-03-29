import React from 'react';
import {
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import ReportStatusIndicator from './ReportStatusIndicator';

const ReportHistoryPage = ({ rows, onDownload, onOpenCase }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Report</TableCell>
            <TableCell>Case</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Version</TableCell>
            <TableCell>Generated</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {!rows.length ? (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                <Typography sx={{ fontSize: 13, color: '#64748b' }}>No reports generated yet.</Typography>
              </TableCell>
            </TableRow>
          ) : rows.map((row) => (
            <TableRow key={row.report_id} hover>
              <TableCell sx={{ fontWeight: 700 }}>{row.report_name}</TableCell>
              <TableCell>{row.case_id ? row.case_id : (row.summary?.case_count ? `${row.summary.case_count} cases` : '-')}</TableCell>
              <TableCell><ReportStatusIndicator status={row.status} /></TableCell>
              <TableCell>v{row.version_no || 1}</TableCell>
              <TableCell>{row.generated_at || row.created_at || '-'}</TableCell>
              <TableCell>{row.created_by || '-'}</TableCell>
              <TableCell align="right">
                {row.case_id ? <Button size="small" onClick={() => onOpenCase?.(row.case_id)}>Open Case</Button> : null}
                <Button size="small" variant="outlined" onClick={() => onDownload(row.report_id)}>Download</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>
);

export default ReportHistoryPage;
