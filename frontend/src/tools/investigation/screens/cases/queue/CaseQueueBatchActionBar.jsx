import React from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { CASE_QUEUE_STATUSES } from './queueConfig';

const CaseQueueBatchActionBar = ({
  selectedCount,
  statusValue,
  ownerValue,
  remarksValue,
  onStatusChange,
  onOwnerChange,
  onRemarksChange,
  onApplyStatus,
  onApplyOwner,
  onEscalate,
  onSendMail,
  onExport,
}) => {
  if (!selectedCount) return null;

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'sticky',
        bottom: 16,
        zIndex: 4,
        mt: 2,
        p: 1.5,
        borderRadius: 2.5,
        border: '1px solid #cbd5e1',
        backgroundColor: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', lg: 'center' }} justifyContent="space-between">
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
              {selectedCount} case{selectedCount > 1 ? 's' : ''} selected
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: '#64748b' }}>
              Batch actions are intended for logically related cases such as the same branch, region, or review queue.
            </Typography>
          </Box>
          <Alert severity="info" sx={{ py: 0, px: 1.25 }}>
            Mixed recipient mappings will be grouped automatically during escalation preview.
          </Alert>
        </Stack>

        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1}>
          <TextField select size="small" label="Change Status" value={statusValue} onChange={(event) => onStatusChange(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">Select status</MenuItem>
            {CASE_QUEUE_STATUSES.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
          </TextField>
          <Button variant="outlined" onClick={onApplyStatus} disabled={!statusValue}>Apply Status</Button>
          <TextField size="small" label="Assign Owner" value={ownerValue} onChange={(event) => onOwnerChange(event.target.value)} sx={{ minWidth: 220 }} />
          <Button variant="outlined" onClick={onApplyOwner} disabled={!ownerValue}>Assign Owner</Button>
          <TextField size="small" label="Batch Remarks" value={remarksValue} onChange={(event) => onRemarksChange(event.target.value)} sx={{ flex: 1, minWidth: 220 }} />
          <Button variant="contained" onClick={onEscalate}>Escalate</Button>
          <Button variant="outlined" onClick={onSendMail}>Send Mail</Button>
          <Button variant="outlined" onClick={onExport}>Export Case Pack</Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export default CaseQueueBatchActionBar;
