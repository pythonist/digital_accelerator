import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

const MailPreviewModal = ({ open, onClose, preview }) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
    <DialogTitle sx={{ fontWeight: 800 }}>Mail Preview</DialogTitle>
    <DialogContent>
      {!preview ? null : Array.isArray(preview.previews) ? (
        <Stack spacing={2}>
          {preview.previews.map((item, index) => (
            <Paper key={`${item.recipient?.email || 'preview'}_${index + 1}`} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.45 }}>
                {item.target_role} | {(item.recipient_emails || []).join(', ') || item.recipient?.email || '-'}
              </Typography>
              {item.cc_emails?.length ? (
                <Typography sx={{ mt: 0.75, fontSize: 12, color: '#64748b' }}>
                  {`CC | ${item.cc_emails.join(', ')}`}
                </Typography>
              ) : null}
              <Typography sx={{ mt: 1, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                {item.subject}
              </Typography>
              <Divider sx={{ my: 1.5 }} />
              <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
                {item.body}
              </Typography>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.45 }}>
            {preview.target_role} | {(preview.recipient_emails || []).join(', ') || (preview.recipients || []).map((item) => item.email).filter(Boolean).join(', ') || '-'}
          </Typography>
          {preview.cc_emails?.length ? (
            <Typography sx={{ mt: 0.75, fontSize: 12, color: '#64748b' }}>
              {`CC | ${preview.cc_emails.join(', ')}`}
            </Typography>
          ) : null}
          <Typography sx={{ mt: 1, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
            {preview.subject}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
            {preview.body}
          </Typography>
        </Paper>
      )}
    </DialogContent>
  </Dialog>
);

export default MailPreviewModal;
