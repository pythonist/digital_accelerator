import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';

const ReportGeneratorModal = ({ open, onClose, caseId, availableModels, onGenerate, loading }) => {
  const [model, setModel] = useState('');

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Generate Investigation Report</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.75 }}>
          <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
            Build a full case dossier for {caseId || '-'} using the current investigation record, connected module outputs, and the latest resolution context.
          </Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>Narrative model</InputLabel>
            <Select
              label="Narrative model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <MenuItem value="">Use default report model</MenuItem>
              {(availableModels || []).map((item) => (
                <MenuItem key={item} value={item}>{item}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onGenerate({ model })} disabled={loading || !caseId}>
          {loading ? 'Generating...' : 'Generate Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReportGeneratorModal;
