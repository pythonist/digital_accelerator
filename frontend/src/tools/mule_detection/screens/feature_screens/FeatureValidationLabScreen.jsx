import React, { useMemo } from 'react';
import {
  Box,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  LinearProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Chip,
  Grid,
  ListSubheader
} from '@mui/material';

const FeatureValidationLabScreen = ({
  T,
  card,
  cellSx,
  headCellSx,
  SectionHeader,
  MetricPill,
  dataSchema,
  targetName,
  setTargetName,
  targetSummary,
  targetLoading,
  featureMode,
  catalog,
  formatNum,
  formatPct,
  ivLevel,
  psiLevel
}) => {
  const accounts = useMemo(() => dataSchema?.accounts || [], [dataSchema]);
  const transactions = useMemo(() => dataSchema?.transactions || [], [dataSchema]);
  const canUseOutcome = Boolean(targetSummary?.usable_for_supervised_learning);

  return (
    <>
      <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <SectionHeader
          title="Target Variable & Validation Mode"
          subtitle="Select an outcome label if available to enable supervised validation"
          right={<Chip label={`Mode: ${featureMode === 'outcome' ? 'Outcome Linked' : 'Behavioral Intelligence'}`} size="small" />}
        />
        {targetLoading && <LinearProgress sx={{ height: 2, bgcolor: T.border, '& .MuiLinearProgress-bar': { bgcolor: T.accent } }} />}
        <Box sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={5}>
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff' }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 800, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>TARGET SELECTION</Typography>
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel sx={{ fontSize: 11 }}>Target variable</InputLabel>
                    <Select
                      value={targetName || ''}
                      label="Target variable"
                      onChange={(e) => setTargetName(e.target.value)}
                      sx={{ borderRadius: 0, fontSize: 12, fontFamily: T.mono, background: '#ffffff', color: T.text, '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border } }}
                    >
                      <MenuItem value=""><em style={{ fontSize: 11 }}>No target available (Behavioral Mode)</em></MenuItem>
                      <ListSubheader sx={{ fontSize: 10, fontFamily: T.sans }}>Accounts</ListSubheader>
                      {accounts.map((c) => (
                        <MenuItem key={`acc-${c.name}`} value={c.name} sx={{ fontSize: 11, fontFamily: T.mono }}>
                          {c.name}
                        </MenuItem>
                      ))}
                      <ListSubheader sx={{ fontSize: 10, fontFamily: T.sans }}>Transactions</ListSubheader>
                      {transactions.map((c) => (
                        <MenuItem key={`txn-${c.name}`} value={c.name} sx={{ fontSize: 11, fontFamily: T.mono }}>
                          {c.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                    <MetricPill label="Target" value={targetSummary?.target_name || targetName || '—'} />
                    <MetricPill label="Usable" value={canUseOutcome ? 'YES' : 'NO'} color={canUseOutcome ? T.green : T.red} />
                    <MetricPill label="Positives" value={targetSummary?.positives ?? '—'} />
                    <MetricPill label="Negatives" value={targetSummary?.negatives ?? '—'} />
                    <MetricPill label="Rate" value={targetSummary?.positive_rate != null ? formatPct(targetSummary.positive_rate, 2) : '—'} />
                  </Stack>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} md={7}>
              <Box sx={{ border: `1px solid ${T.border}`, background: '#ffffff', height: '100%' }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${T.border}` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 800, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em' }}>VALIDATION STRATEGY</Typography>
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography sx={{ fontSize: 12, color: T.textDim, fontFamily: T.sans, lineHeight: 1.7 }}>
                    {canUseOutcome
                      ? 'Outcome-linked validation enabled. IV/WOE, leakage diagnostics, and supervised stability metrics are computed for each feature using the selected target.'
                      : 'Behavioral intelligence mode active. Validation focuses on stability drift, missingness, extremes, and correlations without requiring outcome labels.'}
                  </Typography>
                  <Box sx={{ mt: 1.5 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: T.textMuted, fontFamily: T.sans, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
                      Data Columns
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {accounts.slice(0, 6).map((c) => (
                        <Chip key={`acc-chip-${c.name}`} label={`ACC · ${c.name}`} size="small" />
                      ))}
                      {transactions.slice(0, 6).map((c) => (
                        <Chip key={`txn-chip-${c.name}`} label={`TXN · ${c.name}`} size="small" />
                      ))}
                    </Stack>
                  </Box>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Box>

      <Box sx={{ ...card, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        <SectionHeader
          title="Feature Validation Matrix"
          subtitle="Comparative view of predictive strength, stability, and leakage"
          right={<Typography sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{catalog.length} features</Typography>}
        />
        <TableContainer sx={{ maxHeight: 420, background: T.surface }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Feature', 'IV', 'PSI', 'Leakage', 'Stability', 'Missing', 'Mode'].map((h) => (
                  <TableCell key={h} sx={headCellSx}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {catalog.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ ...cellSx, textAlign: 'center', py: 3, color: T.textMuted }}>
                    No features available for validation yet.
                  </TableCell>
                </TableRow>
              ) : catalog.map((f) => (
                <TableRow key={`val-${f.feature_name}`} sx={{ '&:hover': { background: 'rgba(255,255,255,0.02)' } }}>
                  <TableCell sx={{ ...cellSx, color: T.text }}>{f.feature_name}</TableCell>
                  <TableCell sx={{ ...cellSx, color: f.iv != null ? ivLevel(f.iv) : T.textMuted }}>
                    {canUseOutcome && f.iv != null ? formatNum(f.iv, 3) : '—'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: f.psi != null ? psiLevel(f.psi) : T.textMuted }}>
                    {f.psi != null ? formatNum(f.psi, 3) : '—'}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {canUseOutcome && f.leakage_score != null ? formatNum(f.leakage_score, 3) : '—'}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {f.stability_score != null ? formatNum(f.stability_score, 3) : '—'}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    {f.missing_pct != null ? formatPct(f.missing_pct, 1) : '—'}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Chip label={canUseOutcome ? 'Outcome' : 'Behavior'} size="small" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </>
  );
};

export default FeatureValidationLabScreen;
