import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  ToggleButton,
  ToggleButtonGroup,
  Button,
  Divider
} from '@mui/material';
import btsyApi from '../../services/btsyApi';

const BehaviorReconstructionScreen = () => {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [rawFilter, setRawFilter] = useState('all');

  useEffect(() => {
    const raw = sessionStorage.getItem('btsy_behavior_recon_payload');
    if (!raw) {
      setError('No behaviour reconstruction payload found. Trigger from Step 2.');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setPayload(parsed);
    } catch (e) {
      setError('Failed to parse reconstruction payload.');
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!payload) return;
      setLoading(true);
      setError(null);
      try {
        const res = await btsyApi.behaviour.reconstruct({
          behavior_run_id: payload.behavior_run_id || payload.run_id,
          entity_id: payload.entity_id,
          as_of_date: payload.as_of_date,
          entity_level: payload.entity_level || 'account',
          created_by: payload.created_by || 'user'
        });
        if (!res?.success) {
          throw new Error(res?.error || 'Reconstruction failed');
        }
        setResult(res.data || null);
      } catch (e) {
        setError(e.message || 'Reconstruction failed');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [payload]);

  const rawRows = useMemo(() => {
    if (!result?.raw_transactions) return [];
    if (rawFilter === 'included') {
      return result.raw_transactions.filter((r) => r.included_in_step2 || r.included_step2);
    }
    if (rawFilter === 'excluded') {
      return result.raw_transactions.filter((r) => !(r.included_in_step2 || r.included_step2));
    }
    return result.raw_transactions;
  }, [result, rawFilter]);

  const formulaLines = useMemo(() => {
    if (!result?.formula?.components) return [];
    const comps = result.formula.components || [];
    const lines = comps.map((v, idx) => ({
      value: Number(v),
      op: idx === 0 ? null : '+'
    }));
    return lines;
  }, [result]);

  const integrityStatus = useMemo(() => {
    if (!result?.integrity) return null;
    const issues = Array.isArray(result.integrity.dropped_unexpected) ? result.integrity.dropped_unexpected : [];
    if (!issues.length) return { ok: true, issues: [] };
    return { ok: false, issues };
  }, [result]);

  const handleCopyFormula = () => {
    if (!result?.formula) return;
    const comps = result.formula.components || [];
    const final = result.formula.final_value;
    const parts = [];
    comps.forEach((v, idx) => {
      const line = `${idx === 0 ? '' : '+ '}${Number(v).toLocaleString()}`;
      parts.push(line);
    });
    parts.push(`= ${Number(final).toLocaleString()}`);
    const text = parts.join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleExportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `behaviour_reconstruction_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Behaviour Reconstruction
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Full Step 2 threshold replay for a single entity and date.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {result && (
        <Paper sx={{ p: 1.5, mb: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={8}>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell>Run</TableCell>
                    <TableCell>{result.meta.behavior_run_id}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Entity</TableCell>
                    <TableCell>{payload?.entity_id || ''}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Level</TableCell>
                    <TableCell>{result.meta.entity_level}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>As of</TableCell>
                    <TableCell>{payload?.as_of_date || ''}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Metric</TableCell>
                    <TableCell>{result.meta.metric_name}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Aggregation</TableCell>
                    <TableCell>{result.meta.aggregation_level}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Lookback</TableCell>
                    <TableCell>{result.meta.lookback_days} days</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>{result.meta.transaction_type}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Button variant="outlined" size="small" onClick={handleExportJson}>
                  Export JSON
                </Button>
                <Button variant="outlined" size="small" onClick={handleCopyFormula}>
                  Copy Math
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}

      {loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Reconstructing behaviour...
        </Alert>
      )}

      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Raw Transactions
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={rawFilter}
                exclusive
                onChange={(_, v) => v && setRawFilter(v)}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="included">Included</ToggleButton>
                <ToggleButton value="excluded">Excluded</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Datetime</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Included</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rawRows.map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{r.transaction_datetime || r.txn_datetime || ''}</TableCell>
                    <TableCell align="right">{Number(r.transaction_amount || r.amount || 0).toLocaleString()}</TableCell>
                    <TableCell>{r.transaction_type || r.type || ''}</TableCell>
                    <TableCell>{r.included_in_step2 || r.included_step2 ? 'YES' : 'NO'}</TableCell>
                    <TableCell>{r.exclusion_reason || ''}</TableCell>
                  </TableRow>
                ))}
                {rawRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ color: '#64748b' }}>
                      No transactions.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Filter Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 1.25 }}>
                  <Typography variant="caption">Total raw</Typography>
                  <Typography variant="h6">{result.filter_summary.total_raw}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 1.25 }}>
                  <Typography variant="caption">After basic filters</Typography>
                  <Typography variant="h6">{result.filter_summary.after_basic_filters}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 1.25 }}>
                  <Typography variant="caption">After type filter</Typography>
                  <Typography variant="h6">{result.filter_summary.after_type_filter}</Typography>
                </Paper>
              </Grid>
            </Grid>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Aggregation Buckets
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Month End</TableCell>
                  <TableCell align="right">Aggregated Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(result.aggregated_rows || []).map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{r.transaction_datetime || ''}</TableCell>
                    <TableCell>{r.month_last_date || ''}</TableCell>
                    <TableCell align="right">{Number(r.total_daily_amount || 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {(!result.aggregated_rows || result.aggregated_rows.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={3} sx={{ color: '#64748b' }}>
                      No aggregation rows.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Lookback Window
            </Typography>
            <Table size="small" sx={{ mb: 1 }}>
              <TableBody>
                <TableRow>
                  <TableCell>Start</TableCell>
                  <TableCell>{result.lookback_window.start || ''}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>End</TableCell>
                  <TableCell>{result.lookback_window.end || ''}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2">Used dates</Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e8f0', p: 1, mt: 1 }}>
                  {(result.included_rows || []).map((d) => (
                    <Typography key={d} variant="body2">
                      {d}
                    </Typography>
                  ))}
                  {(!result.included_rows || result.included_rows.length === 0) && (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>
                      None.
                    </Typography>
                  )}
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2">Rejected dates</Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e8f0', p: 1, mt: 1 }}>
                  {(result.excluded_rows || []).map((d) => (
                    <Typography key={d} variant="body2">
                      {d}
                    </Typography>
                  ))}
                  {(!result.excluded_rows || result.excluded_rows.length === 0) && (
                    <Typography variant="body2" sx={{ color: '#64748b' }}>
                      None.
                    </Typography>
                  )}
                </Box>
              </Grid>
            </Grid>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Contribution to Final Threshold
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(result.formula.components || []).map((v, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell align="right">{Number(v).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>FINAL</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {Number(result.formula.final_value || 0).toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Formula Replay
            </Typography>
            <Box sx={{ fontFamily: 'monospace', whiteSpace: 'pre', fontSize: 14 }}>
              {formulaLines.map((line, idx) => (
                <Box key={idx}>
                  {line.op ? `${line.op} ` : ''}
                  {line.value.toLocaleString()}
                </Box>
              ))}
              {formulaLines.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Box>= {Number(result.formula.final_value || 0).toLocaleString()}</Box>
                </>
              )}
            </Box>
          </Paper>

          <Paper sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Integrity Result
            </Typography>
            {integrityStatus && integrityStatus.ok && (
              <Alert severity="success">
                Reconstruction matches stored value. No unexpected dropped rows.
              </Alert>
            )}
            {integrityStatus && !integrityStatus.ok && (
              <Alert severity="error">
                Reconstruction does not perfectly match stored value.
              </Alert>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
};

export default BehaviorReconstructionScreen;
