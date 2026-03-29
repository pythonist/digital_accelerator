import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Drawer,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';

import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import EscalationHistoryTable from './EscalationHistoryTable';
import { ESCALATION_TARGETS } from './queueConfig';
import { formatDateTime } from './queueUtils';

const EscalationHistoryPage = () => {
  const [filters, setFilters] = useState({
    case_id: '',
    recipient_role: '',
    mail_status: '',
  });
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await apiClient.getEscalationHistory(filters);
      setRows(response.rows || []);
    } catch (loadError) {
      setFeedback({ open: true, severity: 'error', message: loadError.message || 'Unable to load escalation history.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <PageContainer
      title="Escalation History"
      subtitle="Audit trail of case escalations, reviewer notifications, and mail delivery activity"
      breadcrumbs={['Resolution', 'Escalation History']}
      actions={(
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={fetchData} disabled={loading}>
          Refresh
        </Button>
      )}
    >
      <Stack spacing={2.25}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', xl: 'center' }}>
            <TextField size="small" label="Case ID / Batch Ref" value={filters.case_id} onChange={(event) => setFilters((previous) => ({ ...previous, case_id: event.target.value }))} sx={{ minWidth: 220 }} />
            <TextField select size="small" label="Recipient Role" value={filters.recipient_role} onChange={(event) => setFilters((previous) => ({ ...previous, recipient_role: event.target.value }))} sx={{ minWidth: 220 }}>
              <MenuItem value="">All roles</MenuItem>
              {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Mail Status" value={filters.mail_status} onChange={(event) => setFilters((previous) => ({ ...previous, mail_status: event.target.value }))} sx={{ minWidth: 200 }}>
              <MenuItem value="">All statuses</MenuItem>
              <MenuItem value="sent">Sent</MenuItem>
              <MenuItem value="queued">Queued</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
            </TextField>
          </Stack>
        </Paper>

        {rows.length === 0 && !loading ? (
          <Alert severity="info">No escalation history matched the current filters.</Alert>
        ) : null}

        <EscalationHistoryTable rows={rows} onOpen={setSelectedRow} />
      </Stack>

      <Drawer anchor="right" open={Boolean(selectedRow)} onClose={() => setSelectedRow(null)} PaperProps={{ sx: { width: { xs: '100%', lg: 480 } } }}>
        <Box sx={{ px: 2.5, py: 2.25 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            Escalation Detail
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#64748b' }}>
            Full mail metadata and audit snapshot for the selected escalation record.
          </Typography>
          <Stack spacing={1.2} sx={{ mt: 2.25 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Metadata</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Timestamp: {formatDateTime(selectedRow?.sent_at)}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Case ID: {selectedRow?.case_id || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Batch Ref: {selectedRow?.batch_ref || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Recipient Role: {selectedRow?.recipient_role || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Recipient Email: {selectedRow?.recipient_email || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Triggered By: {selectedRow?.sent_by || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Mail Status: {selectedRow?.status || '-'}</Typography>
            <Typography sx={{ fontSize: 12.75, color: '#334155' }}>Response Status: {selectedRow?.response_status || '-'}</Typography>

            <Typography sx={{ pt: 1.5, fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Subject</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12.75, color: '#0f172a' }}>{selectedRow?.subject || '-'}</Typography>
            </Paper>

            <Typography sx={{ pt: 1.5, fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Body Snapshot</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12.75, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {selectedRow?.body_snapshot || '-'}
              </Typography>
            </Paper>

            <Typography sx={{ pt: 1.5, fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Remarks</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12.75, color: '#334155' }}>{selectedRow?.remarks || 'No remarks recorded.'}</Typography>
            </Paper>
          </Stack>
        </Box>
      </Drawer>

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default EscalationHistoryPage;
