import React, { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, CardHeader, Divider, LinearProgress, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import muleApi from '../services/muleApi';
import { useMuleStore } from '../store/muleStore';
import { formatInteger, formatNumber, formatPercentFromRatio } from '../utils/formatters';

const InvestigationTimelinePanel = () => {
  const { selectedAccountId } = useMuleStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!selectedAccountId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await muleApi.explainAccount({ account_id: selectedAccountId, high: 0.7, medium: 0.4 });
        if (!res?.success) throw new Error(res?.error || 'Failed to load timeline');
        setTimeline(res?.layers?.temporal_story || null);
      } catch (e) {
        setTimeline(null);
        setError(e?.response?.data?.error || e?.message || 'Failed to load timeline');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedAccountId]);

  return (
    <Box sx={{ p: 0 }}>
      {error ? <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert> : null}
      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}

      <Card elevation={0}>
        <CardHeader title="Timeline" subheader="What happened, when, and how quickly funds moved" />
        <CardContent>
          {!selectedAccountId ? (
            <Typography variant="body2" color="text.secondary">Select an account.</Typography>
          ) : !timeline?.has_results ? (
            <Typography variant="body2" color="text.secondary">No timeline available for this account.</Typography>
          ) : (
            <Stack spacing={2}>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Window</TableCell>
                    <TableCell>{timeline.window?.start || '-'} → {timeline.window?.end || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Inflow</TableCell>
                    <TableCell>
                      {formatInteger(timeline.inflow?.count || 0)} tx · {formatNumber(timeline.inflow?.amount || 0, { maxFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Outflow</TableCell>
                    <TableCell>
                      {formatInteger(timeline.outflow?.count || 0)} tx · {formatNumber(timeline.outflow?.amount || 0, { maxFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Holding time</TableCell>
                    <TableCell>
                      {timeline.holding_time_hours == null ? '-' : `${formatNumber(timeline.holding_time_hours, { maxFractionDigits: 1 })} h`} · {timeline.fast_exit?.flag ? 'Fast exit: Yes' : 'Fast exit: No'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Beneficiaries</TableCell>
                    <TableCell>
                      {formatInteger(timeline.beneficiaries?.unique || 0)} · new 7d {timeline.beneficiaries?.new_ratio_7d == null ? '-' : formatPercentFromRatio(timeline.beneficiaries?.new_ratio_7d, 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <Divider />

              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Quick interpretation</Typography>
              <Stack spacing={0.75}>
                <Typography variant="body2" color="text.secondary">
                  Fast exit indicates funds leave shortly after arrival (typical mule pass-through behaviour).
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  New beneficiary ratio shows how often money goes to first-time counterparties (spreading risk).
                </Typography>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default InvestigationTimelinePanel;

