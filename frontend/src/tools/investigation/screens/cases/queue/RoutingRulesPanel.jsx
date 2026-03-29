import React from 'react';
import {
  Button,
  Chip,
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

import { ESCALATION_TARGETS } from './queueConfig';

const RoutingRulesPanel = ({
  rows,
  form,
  onChange,
  onCreate,
  creating,
}) => (
  <Stack spacing={2}>
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Routing Rules</Typography>
      <Typography sx={{ mt: 0.45, fontSize: 12.5, color: '#64748b' }}>
        Define branch, risk, and case-pattern routing rules without hard-coding recipient logic into the workflow.
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
          <TextField size="small" label="Rule Name" value={form.rule_name} onChange={(event) => onChange('rule_name', event.target.value)} sx={{ flex: 1 }} />
          <TextField select size="small" label="Recipient Role" value={form.recipient_role} onChange={(event) => onChange('recipient_role', event.target.value)} sx={{ minWidth: 220 }}>
            {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Branch" value={form.branch_code} onChange={(event) => onChange('branch_code', event.target.value)} sx={{ minWidth: 160 }} />
          <TextField size="small" label="Region" value={form.region} onChange={(event) => onChange('region', event.target.value)} sx={{ minWidth: 160 }} />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
          <TextField size="small" type="number" label="Risk Score Min" value={form.risk_score_min} onChange={(event) => onChange('risk_score_min', event.target.value)} sx={{ minWidth: 160 }} />
          <TextField size="small" type="number" label="Linked Accounts Threshold" value={form.linked_accounts_threshold} onChange={(event) => onChange('linked_accounts_threshold', event.target.value)} sx={{ minWidth: 220 }} />
          <TextField size="small" label="Case Type Pattern" value={form.case_type_pattern} onChange={(event) => onChange('case_type_pattern', event.target.value)} sx={{ flex: 1 }} />
          <TextField select size="small" label="Copy Role" value={form.copy_role} onChange={(event) => onChange('copy_role', event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">None</MenuItem>
            {ESCALATION_TARGETS.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={1.25}>
          <TextField select size="small" label="PEP Required" value={String(form.pep_required)} onChange={(event) => onChange('pep_required', event.target.value === 'true')} sx={{ minWidth: 140 }}>
            <MenuItem value="false">No</MenuItem>
            <MenuItem value="true">Yes</MenuItem>
          </TextField>
          <TextField select size="small" label="Sanctions Required" value={String(form.sanctions_required)} onChange={(event) => onChange('sanctions_required', event.target.value === 'true')} sx={{ minWidth: 170 }}>
            <MenuItem value="false">No</MenuItem>
            <MenuItem value="true">Yes</MenuItem>
          </TextField>
          <TextField select size="small" label="Adverse Media Required" value={String(form.adverse_media_required)} onChange={(event) => onChange('adverse_media_required', event.target.value === 'true')} sx={{ minWidth: 190 }}>
            <MenuItem value="false">No</MenuItem>
            <MenuItem value="true">Yes</MenuItem>
          </TextField>
          <Button variant="contained" onClick={onCreate} disabled={creating || !form.rule_name || !form.recipient_role}>
            {creating ? 'Saving...' : 'Add Rule'}
          </Button>
        </Stack>
      </Stack>
    </Paper>

    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Rule Name</TableCell>
              <TableCell>Recipient Role</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Thresholds</TableCell>
              <TableCell>Pattern</TableCell>
              <TableCell>Copy Role</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.rule_name}</TableCell>
                <TableCell>{row.recipient_role}</TableCell>
                <TableCell>{[row.branch_code, row.region].filter(Boolean).join(' / ') || 'Global'}</TableCell>
                <TableCell>
                  {[row.risk_score_min ? `Risk >= ${row.risk_score_min}` : null, row.linked_accounts_threshold ? `Linked accounts >= ${row.linked_accounts_threshold}` : null].filter(Boolean).join(', ') || '-'}
                </TableCell>
                <TableCell>{row.case_type_pattern || '-'}</TableCell>
                <TableCell>{row.copy_role || '-'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75}>
                    <Chip size="small" label={row.auto_route_enabled ? 'Auto-route' : 'Manual'} color={row.auto_route_enabled ? 'success' : 'default'} />
                    <Chip size="small" label={row.is_active ? 'Active' : 'Inactive'} color={row.is_active ? 'success' : 'default'} variant="outlined" />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  </Stack>
);

export default RoutingRulesPanel;
