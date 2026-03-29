import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

import { modeOptions } from './retrievalCompareUtils';

const modeDescriptions = {
  'Behavioral Similarity': 'Best when you want to match transaction rhythm, amount behavior, concentration, flow pattern, and time-based activity.',
  'Typology Similarity': 'Best when you want to match structuring, layering, mule, funnel, and other typology-aligned case traits.',
  'Network Similarity': 'Best when you want to match linked counterparties, beneficiaries, connected accounts, and relationship structure.',
  'Hybrid Similarity': 'Recommended for most analysts. This combines behavior, typology, network, and alert profile into one overall match score.',
};

const SimilarityControlsPanel = ({ controls, onChange, onSearch, searching, caseOptions }) => (
  <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Find Similar Cases</Typography>
    <Typography sx={{ mt: 0.35, fontSize: 12.5, color: '#64748b' }}>
      Start with the current case, choose the matching lens, then narrow the result set with operational filters.
    </Typography>

    <Stack spacing={2} sx={{ mt: 2 }}>
      <TextField select size="small" label="Base Case" value={controls.baseCaseId} onChange={(event) => onChange('baseCaseId', event.target.value)}>
        {caseOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
      </TextField>

      <TextField select size="small" label="Similarity Mode" value={controls.mode} onChange={(event) => onChange('mode', event.target.value)}>
        {modeOptions.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>

      <Alert severity="info" sx={{ py: 0.5 }}>
        {modeDescriptions[controls.mode] || modeDescriptions['Hybrid Similarity']}
      </Alert>

      <Stack spacing={1}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
          Result Limit: {controls.topK}
        </Typography>
        <Slider value={controls.topK} onChange={(_, value) => onChange('topK', value)} min={3} max={20} step={1} valueLabelDisplay="auto" />
      </Stack>

      <Stack spacing={1}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
          Minimum Similarity Threshold: {Math.round((controls.threshold || 0) * 100)}%
        </Typography>
        <Slider value={controls.threshold} onChange={(_, value) => onChange('threshold', value)} min={0} max={0.95} step={0.05} valueLabelDisplay="auto" />
      </Stack>

      <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Scope Filters</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <FormControlLabel control={<Checkbox checked={controls.filters.same_branch} onChange={(event) => onChange('filters', { ...controls.filters, same_branch: event.target.checked })} size="small" />} label="Same branch" />
        <FormControlLabel control={<Checkbox checked={controls.filters.same_alert_family} onChange={(event) => onChange('filters', { ...controls.filters, same_alert_family: event.target.checked })} size="small" />} label="Same alert family" />
        <FormControlLabel control={<Checkbox checked={controls.filters.same_risk_tier} onChange={(event) => onChange('filters', { ...controls.filters, same_risk_tier: event.target.checked })} size="small" />} label="Same risk tier" />
        <FormControlLabel control={<Checkbox checked={controls.filters.same_customer_segment} onChange={(event) => onChange('filters', { ...controls.filters, same_customer_segment: event.target.checked })} size="small" />} label="Same customer segment" />
      </Stack>

      <Stack direction="row" spacing={1}>
        <TextField size="small" label="Branch" value={controls.filters.branch || ''} onChange={(event) => onChange('filters', { ...controls.filters, branch: event.target.value })} sx={{ flex: 1 }} />
        <TextField size="small" label="Time Period" value={controls.filters.time_period || ''} onChange={(event) => onChange('filters', { ...controls.filters, time_period: event.target.value })} sx={{ flex: 1 }} />
      </Stack>

      <TextField select size="small" label="Outcome Filter" value={controls.filters.outcome_filter || ''} onChange={(event) => onChange('filters', { ...controls.filters, outcome_filter: event.target.value })}>
        <MenuItem value="">All outcomes</MenuItem>
        <MenuItem value="escalated">Escalated</MenuItem>
        <MenuItem value="closed">Closed</MenuItem>
        <MenuItem value="sar recommended">SAR Recommended</MenuItem>
      </TextField>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <FormControlLabel control={<Checkbox checked={controls.filters.include_resolved} onChange={(event) => onChange('filters', { ...controls.filters, include_resolved: event.target.checked })} size="small" />} label="Include resolved cases" />
        <FormControlLabel control={<Checkbox checked={controls.filters.include_only_escalated} onChange={(event) => onChange('filters', { ...controls.filters, include_only_escalated: event.target.checked })} size="small" />} label="Include only escalated cases" />
        <FormControlLabel control={<Checkbox checked={controls.filters.include_only_sar_recommended} onChange={(event) => onChange('filters', { ...controls.filters, include_only_sar_recommended: event.target.checked })} size="small" />} label="Include only SAR recommended cases" />
      </Stack>

      {controls.mode === 'Hybrid Similarity' ? (
        <Accordion disableGutters elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: '12px !important', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Stack spacing={0.25}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>
                Advanced Weighting
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#64748b' }}>
                Use the default weighting in most cases. Adjust only if you need to emphasize one similarity dimension.
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.25}>
              <Alert severity="info" sx={{ py: 0.5 }}>
                Hybrid weighting controls how much the final match score leans toward behavior, typology, network structure, or alert profile.
              </Alert>
              <Stack direction="row" spacing={1}>
                <TextField size="small" type="number" label="Behavioral" value={controls.weights.behavioral} onChange={(event) => onChange('weights', { ...controls.weights, behavioral: Number(event.target.value) })} sx={{ flex: 1 }} />
                <TextField size="small" type="number" label="Typology" value={controls.weights.typology} onChange={(event) => onChange('weights', { ...controls.weights, typology: Number(event.target.value) })} sx={{ flex: 1 }} />
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField size="small" type="number" label="Network" value={controls.weights.network} onChange={(event) => onChange('weights', { ...controls.weights, network: Number(event.target.value) })} sx={{ flex: 1 }} />
                <TextField size="small" type="number" label="Alert" value={controls.weights.alert} onChange={(event) => onChange('weights', { ...controls.weights, alert: Number(event.target.value) })} sx={{ flex: 1 }} />
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
      ) : null}

      <Button variant="contained" onClick={onSearch} disabled={searching || !controls.baseCaseId}>
        {searching ? 'Finding Similar Cases...' : 'Find Similar Cases'}
      </Button>
    </Stack>
  </Paper>
);

export default SimilarityControlsPanel;
