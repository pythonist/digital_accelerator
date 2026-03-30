import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tabs,
  Typography,
} from '@mui/material';
import { Add, Refresh } from '@mui/icons-material';

import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import MailboxPanel from './MailboxPanel';
import RecipientTable from './RecipientTable';
import RoutingRulesPanel from './RoutingRulesPanel';
import { ESCALATION_TARGETS } from './queueConfig';

const emptyRecipient = {
  id: null,
  name: '',
  role: 'L2 Reviewer',
  email: '',
  branch_code: '',
  region: '',
  case_types_supported: '',
  auto_route_enabled: true,
  is_active: true,
};

const emptyRule = {
  rule_name: '',
  recipient_role: 'L2 Reviewer',
  branch_code: '',
  region: '',
  risk_score_min: '',
  pep_required: false,
  sanctions_required: false,
  adverse_media_required: false,
  linked_accounts_threshold: '',
  case_type_pattern: '',
  copy_role: '',
};

const emptyTemplate = {
  template_name: '',
  template_type: 'L2 Reviewer',
  subject_template: '',
  body_template: '',
};

const MailConfigurationPage = () => {
  const [activeTab, setActiveTab] = useState('mailbox');
  const [recipientRows, setRecipientRows] = useState([]);
  const [ruleRows, setRuleRows] = useState([]);
  const [templateRows, setTemplateRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientRoleFilter, setRecipientRoleFilter] = useState('');
  const [recipientDialogOpen, setRecipientDialogOpen] = useState(false);
  const [recipientForm, setRecipientForm] = useState(emptyRecipient);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [testMailForm, setTestMailForm] = useState({
    recipient_id: '',
    subject: 'FCC Case Queue Test Mail',
    body: 'This is a test mail from the FCC Case Queue configuration area.',
  });
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [testingMail, setTestingMail] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, severity: 'success', message: '' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [recipients, rules, templates] = await Promise.all([
        apiClient.getMailRecipients({ search: recipientSearch || undefined, role: recipientRoleFilter || undefined }),
        apiClient.getMailRoutingRules(),
        apiClient.getMailTemplates(),
      ]);
      setRecipientRows(recipients.rows || []);
      setRuleRows(rules.rows || []);
      setTemplateRows(templates.rows || []);
    } catch (loadError) {
      setFeedback({ open: true, severity: 'error', message: loadError.message || 'Unable to load mail configuration.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientSearch, recipientRoleFilter]);

  const recipientDialogTitle = useMemo(
    () => (recipientForm.id ? 'Edit Recipient' : 'Add Recipient'),
    [recipientForm.id],
  );

  const handleSaveRecipient = async () => {
    setSavingRecipient(true);
    try {
      const payload = {
        ...recipientForm,
        case_types_supported: String(recipientForm.case_types_supported || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
      if (recipientForm.id) {
        await apiClient.updateMailRecipient(recipientForm.id, payload);
      } else {
        await apiClient.createMailRecipient(payload);
      }
      setRecipientDialogOpen(false);
      setRecipientForm(emptyRecipient);
      await fetchData();
      setFeedback({ open: true, severity: 'success', message: 'Recipient configuration saved.' });
    } catch (saveError) {
      setFeedback({ open: true, severity: 'error', message: saveError.message || 'Unable to save recipient.' });
    } finally {
      setSavingRecipient(false);
    }
  };

  const handleCreateRule = async () => {
    setCreatingRule(true);
    try {
      await apiClient.createMailRoutingRule({
        ...ruleForm,
        risk_score_min: ruleForm.risk_score_min ? Number(ruleForm.risk_score_min) : null,
        linked_accounts_threshold: ruleForm.linked_accounts_threshold ? Number(ruleForm.linked_accounts_threshold) : null,
      });
      setRuleForm(emptyRule);
      await fetchData();
      setFeedback({ open: true, severity: 'success', message: 'Routing rule added.' });
    } catch (ruleError) {
      setFeedback({ open: true, severity: 'error', message: ruleError.message || 'Unable to create routing rule.' });
    } finally {
      setCreatingRule(false);
    }
  };

  const handleCreateTemplate = async () => {
    setCreatingTemplate(true);
    try {
      await apiClient.createMailTemplate(templateForm);
      setTemplateForm(emptyTemplate);
      await fetchData();
      setFeedback({ open: true, severity: 'success', message: 'Mail template added.' });
    } catch (templateError) {
      setFeedback({ open: true, severity: 'error', message: templateError.message || 'Unable to create template.' });
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleTestMail = async () => {
    setTestingMail(true);
    try {
      const response = await apiClient.testMailConfiguration(testMailForm);
      setFeedback({
        open: true,
        severity: response.status === 'failed' ? 'error' : 'success',
        message: response.status === 'failed' ? response.error || 'Test mail failed.' : 'Test mail sent or queued successfully.',
      });
    } catch (testError) {
      setFeedback({ open: true, severity: 'error', message: testError.message || 'Unable to send test mail.' });
    } finally {
      setTestingMail(false);
    }
  };

  const handleDeleteRecipient = async (row) => {
    try {
      await apiClient.deleteMailRecipient(row.id);
      await fetchData();
      setFeedback({ open: true, severity: 'success', message: 'Recipient deleted.' });
    } catch (error) {
      setFeedback({ open: true, severity: 'error', message: error.message || 'Unable to delete recipient.' });
    }
  };

  return (
    <PageContainer
      title="Mail"
      subtitle="Mailbox activity, recipient routing, templates, and operational notification controls for Sentinel case workflows"
      breadcrumbs={['Resolution', 'Mail']}
      actions={(
        <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={fetchData} disabled={loading}>
          Refresh
        </Button>
      )}
    >
      <Stack spacing={2.25}>
        <Paper variant="outlined" sx={{ borderRadius: 2.5 }}>
          <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} sx={{ px: 1.5, pt: 1 }}>
            <Tab value="mailbox" label="Mailbox" />
            <Tab value="config" label="Mail Config" />
          </Tabs>
        </Paper>

        {activeTab === 'mailbox' ? (
          <MailboxPanel
            recipientRows={recipientRows}
            templateRows={templateRows}
            onFeedback={setFeedback}
          />
        ) : (
          <>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
              <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', xl: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Recipient Master</Typography>
                  <Typography sx={{ mt: 0.4, fontSize: 12.5, color: '#64748b' }}>
                    Manage recipient ownership, routing eligibility, and supported case types for each reviewer role.
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField size="small" label="Search recipients" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} sx={{ minWidth: 220 }} />
                  <TextField select size="small" label="Role" value={recipientRoleFilter} onChange={(event) => setRecipientRoleFilter(event.target.value)} sx={{ minWidth: 200 }}>
                    <MenuItem value="">All roles</MenuItem>
                    {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </TextField>
                  <Button variant="contained" startIcon={<Add />} onClick={() => { setRecipientForm(emptyRecipient); setRecipientDialogOpen(true); }}>
                    Add Recipient
                  </Button>
                </Stack>
              </Stack>
            </Paper>

            <RecipientTable
              rows={recipientRows}
              onEdit={(row) => {
                setRecipientForm({
                  ...row,
                  case_types_supported: (row.case_types_supported || []).join(', '),
                });
                setRecipientDialogOpen(true);
              }}
              onDelete={handleDeleteRecipient}
            />

            <RoutingRulesPanel
              rows={ruleRows}
              form={ruleForm}
              onChange={(field, value) => setRuleForm((previous) => ({ ...previous, [field]: value }))}
              onCreate={handleCreateRule}
              creating={creatingRule}
            />

            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Routing rules are applied automatically when cases are escalated from Case Queue. Manual mailbox send does not use routing rules; it sends only to the saved recipients selected by the analyst.
            </Alert>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.9fr' }, gap: 2.25 }}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Mail Templates</Typography>
                <Typography sx={{ mt: 0.4, fontSize: 12.5, color: '#64748b' }}>
                  Maintain reusable operational templates for L2, branch, vigilance, and compliance review.
                </Typography>
                <Stack spacing={1.25} sx={{ mt: 2 }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                    <TextField size="small" label="Template Name" value={templateForm.template_name} onChange={(event) => setTemplateForm((previous) => ({ ...previous, template_name: event.target.value }))} sx={{ flex: 1 }} />
                    <TextField select size="small" label="Template Type" value={templateForm.template_type} onChange={(event) => setTemplateForm((previous) => ({ ...previous, template_type: event.target.value }))} sx={{ minWidth: 220 }}>
                      {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                    </TextField>
                  </Stack>
                  <TextField size="small" label="Subject Template" value={templateForm.subject_template} onChange={(event) => setTemplateForm((previous) => ({ ...previous, subject_template: event.target.value }))} />
                  <TextField size="small" label="Body Template" value={templateForm.body_template} onChange={(event) => setTemplateForm((previous) => ({ ...previous, body_template: event.target.value }))} multiline minRows={5} />
                  <Button variant="contained" onClick={handleCreateTemplate} disabled={creatingTemplate || !templateForm.template_name || !templateForm.subject_template || !templateForm.body_template}>
                    {creatingTemplate ? 'Saving...' : 'Add Template'}
                  </Button>
                </Stack>
                <TableContainer sx={{ mt: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Template Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Subject</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {templateRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.template_name}</TableCell>
                          <TableCell>{row.template_type}</TableCell>
                          <TableCell>{row.subject_template}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Test Mail Configuration</Typography>
                <Typography sx={{ mt: 0.4, fontSize: 12.5, color: '#64748b' }}>
                  Validate delivery using a saved recipient instead of typing ad hoc email addresses.
                </Typography>
                <Stack spacing={1.25} sx={{ mt: 2 }}>
                  <TextField
                    select
                    size="small"
                    label="Saved Recipient"
                    value={testMailForm.recipient_id}
                    onChange={(event) => setTestMailForm((previous) => ({ ...previous, recipient_id: event.target.value }))}
                  >
                    {recipientRows.map((row) => (
                      <MenuItem key={row.id} value={row.id}>
                        {row.name} | {row.email}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField size="small" label="Subject" value={testMailForm.subject} onChange={(event) => setTestMailForm((previous) => ({ ...previous, subject: event.target.value }))} />
                  <TextField size="small" label="Body" value={testMailForm.body} onChange={(event) => setTestMailForm((previous) => ({ ...previous, body: event.target.value }))} multiline minRows={6} />
                  <Button variant="contained" onClick={handleTestMail} disabled={testingMail || !testMailForm.recipient_id}>
                    {testingMail ? 'Sending...' : 'Send Test Mail'}
                  </Button>
                  <Alert severity="info">
                    Use routing rules for case-driven escalation. Use Mailbox for manual one-off or multi-recipient communication from Sentinel.
                  </Alert>
                </Stack>
              </Paper>
            </Box>
          </>
        )}
      </Stack>

      <Dialog open={recipientDialogOpen} onClose={() => setRecipientDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>{recipientDialogTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField size="small" label="Name" value={recipientForm.name} onChange={(event) => setRecipientForm((previous) => ({ ...previous, name: event.target.value }))} />
            <TextField select size="small" label="Role" value={recipientForm.role} onChange={(event) => setRecipientForm((previous) => ({ ...previous, role: event.target.value }))}>
              {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Email" value={recipientForm.email} onChange={(event) => setRecipientForm((previous) => ({ ...previous, email: event.target.value }))} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" label="Branch" value={recipientForm.branch_code} onChange={(event) => setRecipientForm((previous) => ({ ...previous, branch_code: event.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Region" value={recipientForm.region} onChange={(event) => setRecipientForm((previous) => ({ ...previous, region: event.target.value }))} sx={{ flex: 1 }} />
            </Stack>
            <TextField size="small" label="Case Types Supported" value={recipientForm.case_types_supported} onChange={(event) => setRecipientForm((previous) => ({ ...previous, case_types_supported: event.target.value }))} helperText="Comma-separated values such as AML, Fraud, Mule" />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField select size="small" label="Auto Routing Enabled" value={String(recipientForm.auto_route_enabled)} onChange={(event) => setRecipientForm((previous) => ({ ...previous, auto_route_enabled: event.target.value === 'true' }))} sx={{ flex: 1 }}>
                <MenuItem value="true">Yes</MenuItem>
                <MenuItem value="false">No</MenuItem>
              </TextField>
              <TextField select size="small" label="Active" value={String(recipientForm.is_active)} onChange={(event) => setRecipientForm((previous) => ({ ...previous, is_active: event.target.value === 'true' }))} sx={{ flex: 1 }}>
                <MenuItem value="true">Yes</MenuItem>
                <MenuItem value="false">No</MenuItem>
              </TextField>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRecipientDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveRecipient} disabled={savingRecipient || !recipientForm.name || !recipientForm.email}>
            {savingRecipient ? 'Saving...' : 'Save Recipient'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={feedback.open} autoHideDuration={4500} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
        <Alert severity={feedback.severity} onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  );
};

export default MailConfigurationPage;
