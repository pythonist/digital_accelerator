import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { WorkbenchSection } from '../MuleWorkbenchChrome';

export default function MulePreprocessingFeatureBuilderTab({
  data,
  customDraft,
  onBuiltinToggle,
  onDraftChange,
  onValidateCustom,
  onAddCustom,
  validation,
  onSave,
  saving,
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12.5, color: '#475467' }}>
          Build engineered features before model training. This tab exposes backend feature logic, graph/ring enrichments, lineage, and controlled custom formulas.
        </Typography>
        <Button variant="contained" onClick={onSave} disabled={saving} sx={{ textTransform: 'none', borderRadius: 0, bgcolor: '#C65A11', '&:hover': { bgcolor: '#A64B12' } }}>{saving ? 'Saving...' : 'Save Feature Builder'}</Button>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.25fr) minmax(360px,0.75fr)' }, gap: 1.5 }}>
        <WorkbenchSection title="Available Engineered Features">
          <Paper variant="outlined" sx={{ borderRadius: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F8FAFC' }}>
                  <TableCell sx={{ fontWeight: 800 }}>Use</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Feature</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Family</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Business Meaning</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.builtin_features || []).map((row) => (
                  <TableRow key={row.feature_name}>
                    <TableCell sx={{ width: 56 }}>
                      <Checkbox size="small" checked={Boolean(row.selected)} onChange={(e) => onBuiltinToggle(row.feature_name, e.target.checked)} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.feature_name}</TableCell>
                    <TableCell sx={{ fontSize: 12.25 }}>{row.feature_family}</TableCell>
                    <TableCell sx={{ fontSize: 12.25, color: '#475467' }}>{row.business_meaning}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </WorkbenchSection>
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <WorkbenchSection title="Custom Feature Builder">
            <Box sx={{ display: 'grid', gap: 1 }}>
              <TextField label="Feature name" size="small" value={customDraft.feature_name} onChange={(e) => onDraftChange({ feature_name: e.target.value })} />
              <TextField label="Feature family" size="small" value={customDraft.feature_family} onChange={(e) => onDraftChange({ feature_family: e.target.value })} />
              <TextField label="Formula" size="small" multiline minRows={3} value={customDraft.formula} onChange={(e) => onDraftChange({ formula: e.target.value })} />
              <TextField label="Business meaning" size="small" multiline minRows={2} value={customDraft.business_meaning} onChange={(e) => onDraftChange({ business_meaning: e.target.value })} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button variant="outlined" onClick={onValidateCustom} sx={{ textTransform: 'none', borderRadius: 0 }}>Validate Formula</Button>
                <Button variant="outlined" onClick={onAddCustom} sx={{ textTransform: 'none', borderRadius: 0 }}>Add Custom Feature</Button>
              </Box>
              {validation ? (
                <Typography sx={{ fontSize: 12.25, color: validation.valid ? '#0F5F44' : '#B42318' }}>
                  {validation.message}
                </Typography>
              ) : null}
            </Box>
          </WorkbenchSection>
          <WorkbenchSection title="Lineage and Preview">
            {(data?.lineage_preview || []).slice(0, 12).map((row) => (
              <Box key={row.feature_name} sx={{ py: 0.5 }}>
                <Typography sx={{ fontSize: 12.25, fontWeight: 700 }}>{row.feature_name}</Typography>
                <Typography sx={{ fontSize: 12.1, color: '#667085' }}>
                  Source: {(row.source_columns || []).join(', ') || 'Derived from formula'} | Logic: {row.logic || row.formula}
                </Typography>
              </Box>
            ))}
          </WorkbenchSection>
        </Box>
      </Box>
    </Box>
  );
}
