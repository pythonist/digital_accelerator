import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Close,
  Description,
  Email,
  FileDownload,
  Save,
  SupportAgent,
  Visibility,
} from '@mui/icons-material';

import { CASE_QUEUE_STATUSES } from './queueConfig';
import { formatCurrency, formatDateOnly, formatDateTime, severityTone, statusTone } from './queueUtils';

const Section = ({ title, children }) => (
  <Box>
    <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {title}
    </Typography>
    <Stack spacing={1.15} sx={{ mt: 1.2 }}>
      {children}
    </Stack>
  </Box>
);

const InfoRow = ({ label, value, emphasize = false }) => (
  <Stack direction="row" justifyContent="space-between" spacing={1.5}>
    <Typography sx={{ fontSize: 12.5, color: '#64748b' }}>{label}</Typography>
    <Typography sx={{ fontSize: 12.75, color: emphasize ? '#0f172a' : '#334155', fontWeight: emphasize ? 700 : 500, textAlign: 'right' }}>
      {value || '-'}
    </Typography>
  </Stack>
);

const CompactList = ({ rows = [], renderRow }) => (
  <Stack spacing={1}>
    {rows.length ? rows.map(renderRow) : (
      <Typography sx={{ fontSize: 12.5, color: '#64748b' }}>No records available.</Typography>
    )}
  </Stack>
);

const CaseQueueDetailDrawer = ({
  open,
  detail,
  loading,
  onClose,
  onUpdateStatus,
  onAssignOwner,
  onEscalate,
  onOpenCasePack,
  onViewSar,
  onSendMail,
  onExportSummary,
}) => {
  const [statusValue, setStatusValue] = useState('');
  const [statusRemarks, setStatusRemarks] = useState('');
  const [ownerValue, setOwnerValue] = useState('');
  const [ownerRemarks, setOwnerRemarks] = useState('');

  const queueCase = detail?.case || {};
  const detailData = detail?.detail || {};

  const severity = useMemo(() => severityTone(queueCase.severity), [queueCase.severity]);
  const status = useMemo(() => statusTone(queueCase.current_status), [queueCase.current_status]);

  useEffect(() => {
    if (!open) {
      setStatusValue('');
      setStatusRemarks('');
      setOwnerValue('');
      setOwnerRemarks('');
      return;
    }
    setStatusValue('');
    setStatusRemarks('');
    setOwnerValue(queueCase.assigned_to || '');
    setOwnerRemarks('');
  }, [open, queueCase.assigned_to, queueCase.case_id]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', lg: 540 } } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid #e2e8f0' }}>
          <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
            <Box>
              <Typography sx={{ fontSize: 19, fontWeight: 800, color: '#0f172a' }}>
                {queueCase.case_id || 'Case details'}
              </Typography>
              <Typography sx={{ mt: 0.45, fontSize: 12.5, color: '#64748b' }}>
                Operational case detail, escalation status, and case action controls.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                <Chip label={queueCase.current_status || '-'} size="small" sx={{ color: status.fg, backgroundColor: status.bg, border: `1px solid ${status.border}`, fontWeight: 700 }} />
                <Chip label={queueCase.severity || '-'} size="small" sx={{ color: severity.fg, backgroundColor: severity.bg, border: `1px solid ${severity.border}`, fontWeight: 700 }} />
              </Stack>
            </Box>
            <Button size="small" onClick={onClose} startIcon={<Close />}>Close</Button>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>
          {loading ? (
            <Typography sx={{ fontSize: 13, color: '#64748b' }}>Loading case detail...</Typography>
          ) : (
            <Stack spacing={2.25}>
              <Section title="Case Overview">
                <InfoRow label="Case ID" value={detailData.case_overview?.case_id || queueCase.case_id} emphasize />
                <InfoRow label="Linked Alerts" value={(detailData.case_overview?.linked_alert_ids || []).join(', ') || '-'} />
                <InfoRow label="Customer ID" value={detailData.case_overview?.customer_id || queueCase.customer_id} />
                <InfoRow label="Account ID" value={detailData.case_overview?.account_id || queueCase.account_id} />
                <InfoRow label="Branch" value={detailData.case_overview?.branch || queueCase.branch_code} />
                <InfoRow label="Current Owner" value={detailData.case_overview?.current_owner || queueCase.assigned_to} />
                <InfoRow label="Stage" value={detailData.case_overview?.stage || queueCase.current_stage} />
                <InfoRow label="Created Date" value={formatDateTime(detailData.case_overview?.created_date || queueCase.created_at)} />
                <InfoRow label="Last Updated" value={formatDateTime(detailData.case_overview?.last_updated || queueCase.last_updated_at)} />
                <InfoRow label="SLA Due Date" value={formatDateOnly(detailData.case_overview?.sla_due_date || queueCase.sla_due_at)} />
              </Section>

              <Divider />

              <Section title="Customer and Account Snapshot">
                <CompactList
                  rows={detailData.customer_account_snapshot?.customer || []}
                  renderRow={(item, index) => (
                    <Paper key={`cust_${index + 1}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.75 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                        {item.customer_name || item.name || item.CUSTOMER_ID || item.customer_id || 'Customer'}
                      </Typography>
                      <Typography sx={{ mt: 0.35, fontSize: 12, color: '#64748b' }}>
                        {item.customer_id || item.CUSTOMER_ID || queueCase.customer_id || '-'}
                      </Typography>
                    </Paper>
                  )}
                />
                <CompactList
                  rows={detailData.customer_account_snapshot?.accounts || []}
                  renderRow={(item, index) => (
                    <Paper key={`acct_${index + 1}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.75 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                        {item.account_id || item.ACCOUNT_ID || queueCase.account_id || '-'}
                      </Typography>
                      <Typography sx={{ mt: 0.35, fontSize: 12, color: '#64748b' }}>
                        {item.account_type || item.ACCOUNT_TYPE || 'Account record'}
                      </Typography>
                    </Paper>
                  )}
                />
              </Section>

              <Divider />

              <Section title="Alert and Scenario Summary">
                <InfoRow label="Scenario" value={detailData.alert_summary?.alert_name || queueCase.scenario_name} />
                <InfoRow label="Why generated" value={detailData.alert_summary?.why_generated} />
                <InfoRow label="Aggregate risk indicators" value={(detailData.alert_summary?.aggregate_risk_indicators || []).join(', ') || '-'} />
                <InfoRow label="Linked alert count" value={detailData.alert_summary?.linked_alert_count} />
                <InfoRow label="Suspicious activity markers" value={(detailData.alert_summary?.recent_markers || []).join(', ') || '-'} />
              </Section>

              <Divider />

              <Section title="Transaction Highlights">
                <InfoRow label="Suspicious transaction count" value={detailData.transaction_highlights?.suspicious_transaction_count} />
                <InfoRow
                  label="Date range"
                  value={`${formatDateOnly(detailData.transaction_highlights?.date_range?.from)} to ${formatDateOnly(detailData.transaction_highlights?.date_range?.to)}`}
                />
                <InfoRow label="Total suspicious amount" value={formatCurrency(detailData.transaction_highlights?.total_suspicious_amount)} />
                <InfoRow
                  label="Top counterparties"
                  value={(detailData.transaction_highlights?.top_counterparties || []).map((item) => `${item.name} (${item.count})`).join(', ') || '-'}
                />
                <InfoRow label="Unusual behavior summary" value={detailData.transaction_highlights?.unusual_behavior_summary} />
              </Section>

              <Divider />

              <Section title="Evidence Summary">
                <InfoRow label="Rule triggers" value={(detailData.evidence_summary?.rule_triggers_summary || []).join(', ') || '-'} />
                <InfoRow
                  label="Model / score summary"
                  value={
                    detailData.evidence_summary?.model_score_summary
                      ? `Risk ${detailData.evidence_summary.model_score_summary.risk_score || '-'} | Severity ${detailData.evidence_summary.model_score_summary.severity || '-'}`
                      : '-'
                  }
                />
                <InfoRow label="Analyst findings summary" value={detailData.evidence_summary?.analyst_findings_summary} />
                <InfoRow
                  label="Linked documents"
                  value={(detailData.evidence_summary?.linked_documents || []).map((item) => item.label).join(', ') || '-'}
                />
                <InfoRow label="SAR draft status" value={detailData.resolution_workspace?.sar_status || 'Not Started'} />
              </Section>

              <Divider />

              <Section title="Analyst Notes">
                <CompactList
                  rows={detailData.analyst_notes || []}
                  renderRow={(item, index) => (
                    <Paper key={`note_${index + 1}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.75 }}>
                      <Typography sx={{ fontSize: 12.25, color: '#334155' }}>
                        {item.remarks || item.new_status || 'Operational note'}
                      </Typography>
                      <Typography sx={{ mt: 0.5, fontSize: 11.5, color: '#64748b' }}>
                        {item.changed_by || 'system'} | {formatDateTime(item.changed_at)}
                      </Typography>
                    </Paper>
                  )}
                />
              </Section>

              <Divider />

              <Section title="Escalation History">
                <CompactList
                  rows={detailData.escalation_history || []}
                  renderRow={(item, index) => (
                    <Paper key={`esc_${index + 1}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.75 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                        {item.recipient_role || 'Escalation'} | {item.recipient_email || '-'}
                      </Typography>
                      <Typography sx={{ mt: 0.35, fontSize: 12, color: '#64748b' }}>
                        {item.status || '-'} | {formatDateTime(item.sent_at)}
                      </Typography>
                      <Typography sx={{ mt: 0.6, fontSize: 12.25, color: '#334155' }}>
                        {item.remarks || item.subject || 'No remarks'}
                      </Typography>
                    </Paper>
                  )}
                />
              </Section>

              <Divider />

              <Section title="Actions">
                <Stack spacing={1.25}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField select size="small" label="Update Status" value={statusValue} onChange={(event) => setStatusValue(event.target.value)} sx={{ flex: 1 }}>
                      <MenuItem value="">Select status</MenuItem>
                      {CASE_QUEUE_STATUSES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                    </TextField>
                    <Button
                      variant="outlined"
                      startIcon={<Save />}
                      onClick={() => onUpdateStatus(statusValue, statusRemarks)}
                      disabled={!statusValue}
                    >
                      Update
                    </Button>
                  </Stack>
                  <TextField size="small" label="Status remarks" value={statusRemarks} onChange={(event) => setStatusRemarks(event.target.value)} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField size="small" label="Assign Owner" value={ownerValue} onChange={(event) => setOwnerValue(event.target.value)} sx={{ flex: 1 }} />
                    <Button
                      variant="outlined"
                      startIcon={<SupportAgent />}
                      onClick={() => onAssignOwner(ownerValue, ownerRemarks)}
                      disabled={!ownerValue}
                    >
                      Assign
                    </Button>
                  </Stack>
                  <TextField size="small" label="Assignment remarks" value={ownerRemarks} onChange={(event) => setOwnerRemarks(event.target.value)} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
                    <Button variant="contained" startIcon={<Email />} onClick={onEscalate}>Escalate for Review</Button>
                    <Button variant="outlined" startIcon={<Email />} onClick={onSendMail}>Send Email</Button>
                    <Button variant="outlined" startIcon={<Description />} onClick={onOpenCasePack}>Generate Case Pack</Button>
                    <Button
                      variant="outlined"
                      startIcon={<Visibility />}
                      onClick={onViewSar}
                      disabled={!detailData.resolution_workspace?.has_sar_draft}
                    >
                      View SAR
                    </Button>
                    <Button variant="outlined" startIcon={<FileDownload />} onClick={onExportSummary}>Export Summary</Button>
                  </Stack>
                </Stack>
              </Section>
            </Stack>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default CaseQueueDetailDrawer;
