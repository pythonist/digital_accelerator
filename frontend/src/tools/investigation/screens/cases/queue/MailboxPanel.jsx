import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add, MarkEmailRead, Refresh, Send } from '@mui/icons-material';

import apiClient from '@services/api';

const emptyCompose = {
  recipient_ids: [],
  template_id: '',
  subject: '',
  body: '',
  case_id: '',
  batch_ref: '',
};

const emptyReply = {
  sender_email: '',
  subject: '',
  body: '',
  case_id: '',
  batch_ref: '',
  thread_ref: '',
};

const formatTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const MailboxPanel = ({
  recipientRows,
  templateRows,
  onFeedback,
}) => {
  const [mailboxRows, setMailboxRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [directionFilter, setDirectionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [composeForm, setComposeForm] = useState(emptyCompose);
  const [replyForm, setReplyForm] = useState(emptyReply);
  const [sending, setSending] = useState(false);
  const [savingReply, setSavingReply] = useState(false);

  const loadMailbox = async () => {
    setLoading(true);
    try {
      const response = await apiClient.getMailboxMessages({
        direction: directionFilter || undefined,
        search: search || undefined,
      });
      setMailboxRows(response.rows || []);
    } catch (error) {
      onFeedback?.({ open: true, severity: 'error', message: error.message || 'Unable to load mailbox.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMailbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directionFilter, search]);

  const mailboxStats = useMemo(() => ({
    total: mailboxRows.length,
    sent: mailboxRows.filter((row) => row.direction === 'sent').length,
    received: mailboxRows.filter((row) => row.direction === 'received').length,
  }), [mailboxRows]);

  const handleTemplateChange = (templateId) => {
    const template = templateRows.find((row) => String(row.id) === String(templateId));
    setComposeForm((previous) => ({
      ...previous,
      template_id: templateId,
      subject: template?.subject_template || previous.subject,
      body: template?.body_template || previous.body,
    }));
  };

  const handleSendMail = async () => {
    setSending(true);
    try {
      await apiClient.sendMailboxMessage({
        ...composeForm,
        recipient_ids: composeForm.recipient_ids,
      });
      setComposeOpen(false);
      setComposeForm(emptyCompose);
      await loadMailbox();
      onFeedback?.({ open: true, severity: 'success', message: 'Mail sent to the selected saved recipients.' });
    } catch (error) {
      onFeedback?.({ open: true, severity: 'error', message: error.message || 'Unable to send mail.' });
    } finally {
      setSending(false);
    }
  };

  const handleRecordReply = async () => {
    setSavingReply(true);
    try {
      await apiClient.recordMailboxReply(replyForm);
      setReplyOpen(false);
      setReplyForm(emptyReply);
      await loadMailbox();
      onFeedback?.({ open: true, severity: 'success', message: 'Reply recorded in the mailbox.' });
    } catch (error) {
      onFeedback?.({ open: true, severity: 'error', message: error.message || 'Unable to record reply.' });
    } finally {
      setSavingReply(false);
    }
  };

  return (
    <Stack spacing={2.25}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Mailbox</Typography>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Routing rules are used when a case is escalated from Case Queue. Manual mailbox send is separate and lets the analyst choose one or more saved recipients directly.
          </Alert>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Total ${mailboxStats.total}`} />
              <Chip label={`Sent ${mailboxStats.sent}`} color="primary" variant="outlined" />
              <Chip label={`Received ${mailboxStats.received}`} color="success" variant="outlined" />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField
                size="small"
                label="Search mailbox"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                sx={{ minWidth: 220 }}
              />
              <TextField
                select
                size="small"
                label="Direction"
                value={directionFilter}
                onChange={(event) => setDirectionFilter(event.target.value)}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">All mail</MenuItem>
                <MenuItem value="sent">Sent</MenuItem>
                <MenuItem value="received">Received</MenuItem>
              </TextField>
              <Button variant="outlined" startIcon={<Refresh />} onClick={loadMailbox} disabled={loading}>
                Refresh
              </Button>
              <Button variant="contained" startIcon={<Send />} onClick={() => setComposeOpen(true)}>
                Send Mail
              </Button>
              <Button variant="outlined" startIcon={<MarkEmailRead />} onClick={() => setReplyOpen(true)}>
                Record Reply
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 520 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Direction</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>From / To</TableCell>
                <TableCell>Case / Batch</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Time</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mailboxRows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.direction === 'received' ? 'Received' : 'Sent'}
                      color={row.direction === 'received' ? 'success' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 340 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{row.subject || '-'}</Typography>
                    <Typography sx={{ fontSize: 11, color: '#64748b', mt: 0.35 }}>
                      {row.source === 'routing' ? 'Case routing' : 'Mailbox'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 12 }}>{row.direction === 'received' ? row.sender_email : row.recipient_emails}</Typography>
                  </TableCell>
                  <TableCell>{row.case_id || row.batch_ref || '-'}</TableCell>
                  <TableCell>{row.mail_status || '-'}</TableCell>
                  <TableCell>{formatTime(row.created_at)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="text" onClick={() => setDetailRow(row)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && mailboxRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Box sx={{ py: 5, textAlign: 'center', color: '#64748b' }}>
                      No mailbox activity is available for the current filters.
                    </Box>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={composeOpen} onClose={() => setComposeOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>Send Mail</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField
              select
              size="small"
              label="Saved Recipients"
              SelectProps={{ multiple: true }}
              value={composeForm.recipient_ids}
              onChange={(event) => setComposeForm((previous) => ({ ...previous, recipient_ids: event.target.value }))}
              helperText="Select one or multiple saved recipients."
            >
              {recipientRows.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {row.name} | {row.role} | {row.email}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Template"
              value={composeForm.template_id}
              onChange={(event) => handleTemplateChange(event.target.value)}
            >
              <MenuItem value="">No template</MenuItem>
              {templateRows.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {row.template_name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <TextField size="small" label="Case ID" value={composeForm.case_id} onChange={(event) => setComposeForm((previous) => ({ ...previous, case_id: event.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Batch Ref" value={composeForm.batch_ref} onChange={(event) => setComposeForm((previous) => ({ ...previous, batch_ref: event.target.value }))} sx={{ flex: 1 }} />
            </Stack>
            <TextField size="small" label="Subject" value={composeForm.subject} onChange={(event) => setComposeForm((previous) => ({ ...previous, subject: event.target.value }))} />
            <TextField size="small" label="Body" value={composeForm.body} onChange={(event) => setComposeForm((previous) => ({ ...previous, body: event.target.value }))} multiline minRows={7} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<Add />} onClick={handleSendMail} disabled={sending || !composeForm.recipient_ids.length || !composeForm.subject || !composeForm.body}>
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={replyOpen} onClose={() => setReplyOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>Record Reply</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <TextField size="small" label="Sender Email" value={replyForm.sender_email} onChange={(event) => setReplyForm((previous) => ({ ...previous, sender_email: event.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Thread Ref" value={replyForm.thread_ref} onChange={(event) => setReplyForm((previous) => ({ ...previous, thread_ref: event.target.value }))} sx={{ flex: 1 }} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <TextField size="small" label="Case ID" value={replyForm.case_id} onChange={(event) => setReplyForm((previous) => ({ ...previous, case_id: event.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Batch Ref" value={replyForm.batch_ref} onChange={(event) => setReplyForm((previous) => ({ ...previous, batch_ref: event.target.value }))} sx={{ flex: 1 }} />
            </Stack>
            <TextField size="small" label="Subject" value={replyForm.subject} onChange={(event) => setReplyForm((previous) => ({ ...previous, subject: event.target.value }))} />
            <TextField size="small" label="Reply Body" value={replyForm.body} onChange={(event) => setReplyForm((previous) => ({ ...previous, body: event.target.value }))} multiline minRows={7} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setReplyOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRecordReply} disabled={savingReply || !replyForm.sender_email || !replyForm.subject || !replyForm.body}>
            {savingReply ? 'Saving...' : 'Save Reply'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(detailRow)} onClose={() => setDetailRow(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{detailRow?.subject || 'Mail Detail'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>
              {detailRow?.direction === 'received'
                ? `From ${detailRow?.sender_email || '-'}`
                : `To ${detailRow?.recipient_emails || '-'}`}
            </Typography>
            <Typography sx={{ fontSize: 12, color: '#64748b' }}>
              {detailRow?.case_id || detailRow?.batch_ref || 'No linked case'}
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
              <Typography sx={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
                {detailRow?.body_snapshot || 'No body captured.'}
              </Typography>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDetailRow(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default MailboxPanel;
