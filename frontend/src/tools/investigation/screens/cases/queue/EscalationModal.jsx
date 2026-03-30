import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import apiClient from '@services/api';
import { ESCALATION_TARGETS } from './queueConfig';
import MailPreviewModal from './MailPreviewModal';

const EscalationModal = ({
  open,
  onClose,
  caseIds,
  rows,
  mode = 'single',
  onSuccess,
}) => {
  const [targetRole, setTargetRole] = useState('L2 Reviewer');
  const [copyRole, setCopyRole] = useState('');
  const [templateType, setTemplateType] = useState('');
  const [mailMode, setMailMode] = useState('grouped');
  const [analystComment, setAnalystComment] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    if (!open) return;
    apiClient.getMailTemplates()
      .then((response) => setTemplates(response.rows || []))
      .catch(() => setTemplates([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setPreviewOpen(false);
      setError('');
      setAnalystComment('');
      setMailMode('grouped');
      setTargetRole('L2 Reviewer');
      setCopyRole('');
      setTemplateType('');
    }
  }, [open]);

  const activeTemplateOptions = useMemo(
    () => (templates || []).filter((item) => !targetRole || item.template_type === targetRole),
    [templates, targetRole],
  );

  const payload = useMemo(() => ({
    case_id: caseIds?.[0],
    case_ids: mode === 'batch' ? caseIds : undefined,
    target_role: targetRole,
    copy_role: copyRole || undefined,
    template_type: templateType || targetRole,
    analyst_comment: analystComment,
    mail_mode: mailMode,
  }), [analystComment, caseIds, copyRole, mailMode, mode, targetRole, templateType]);

  const handlePreview = async () => {
    setLoadingPreview(true);
    setError('');
    try {
      const result = await apiClient.previewEscalation(payload);
      setPreview(result);
      setPreviewOpen(true);
    } catch (previewError) {
      setError(previewError.message || 'Unable to preview escalation mail.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const result = mode === 'batch'
        ? await apiClient.escalateCaseBatch(payload)
        : await apiClient.escalateSingleCase(payload);
      onSuccess?.(result);
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'Unable to send escalation mail.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {mode === 'batch' ? 'Batch Escalation' : 'Escalate Case for Review'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              {mode === 'batch'
                ? `${caseIds.length} selected case(s) will be grouped by recipient when needed. Preview before send to confirm routing.`
                : `Review the target, template, and analyst comments before sending the escalation for ${caseIds[0] || '-'}.`}
            </Typography>

            {error ? <Alert severity="error">{error}</Alert> : null}
            {preview?.warnings?.length ? (
              <Alert severity="warning">
                {preview.warnings.join(' ')}
              </Alert>
            ) : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
              <TextField select size="small" label="Escalation Target" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} sx={{ minWidth: 220 }}>
                {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="CC Role" value={copyRole} onChange={(event) => setCopyRole(event.target.value)} sx={{ minWidth: 220 }}>
                <MenuItem value="">No CC</MenuItem>
                {ESCALATION_TARGETS.filter((value) => value !== targetRole).map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Template" value={templateType} onChange={(event) => setTemplateType(event.target.value)} sx={{ minWidth: 240 }}>
                <MenuItem value="">Use default for target</MenuItem>
                {activeTemplateOptions.map((item) => (
                  <MenuItem key={item.id} value={item.template_type}>
                    {item.template_name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            {mode === 'batch' ? (
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                  Mail mode
                </Typography>
                <RadioGroup row value={mailMode} onChange={(event) => setMailMode(event.target.value)}>
                  <FormControlLabel value="grouped" control={<Radio size="small" />} label="Consolidated by recipient" />
                  <FormControlLabel value="separate" control={<Radio size="small" />} label="Separate mail per case" />
                </RadioGroup>
              </Stack>
            ) : null}

            <TextField
              size="small"
              label="Analyst Comment"
              value={analystComment}
              onChange={(event) => setAnalystComment(event.target.value)}
              multiline
              minRows={4}
              placeholder="Explain why additional review is required, what should be checked, and the expected next action."
            />

            {mode === 'batch' && rows?.length ? (
              <Alert severity="info">
                Selected branch and region mix: {[...new Set(rows.map((item) => `${item.branch_code || '-'} / ${item.region || '-'}`))].join(', ')}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="outlined" onClick={handlePreview} disabled={loadingPreview}>
            {loadingPreview ? 'Preparing Preview...' : 'Preview Mail'}
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Sending...' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
      <MailPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} preview={preview} />
    </>
  );
};

export default EscalationModal;
