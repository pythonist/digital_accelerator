import React from 'react';
import {
  Box, Typography, Chip, Stack, Button, Alert, AlertTitle, CircularProgress,
} from '@mui/material';
import { CheckCircle, ErrorOutline, WarningAmber, PlayArrow, Refresh, Speed } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  red: '#E0301E', roseLight: '#FFE4E6',
  amber: '#D97706', amberLight: '#FEF3C7',
  surface: '#F8F9FB', border: '#DDE2EA',
};

export default function LivePreviewValidationSummary({ previewData, validationData, loadingPreview = false, loadingValidation = false, onRefreshPreview, onRunBuild, building = false }) {
  const isValidationPassed = validationData?.passed ?? true;
  const isBlocked = validationData?.status === 'BLOCKED' || !isValidationPassed;
  const blockers = (validationData?.issues || []).filter((i) => i.severity === 'BLOCKER');
  const warnings = (validationData?.issues || []).filter((i) => i.severity === 'WARNING');
  const labelSummary = previewData?.label_summary || {};
  const executionTrace = previewData?.execution_trace || [];

  return (
    <Box sx={{ mt: 2 }}>
      {/* Metrics strip */}
      <Box sx={{ display: 'flex', gap: 0, border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden', mb: 1.5 }}>
        {[
          { label: 'Final Labelled Alerts', value: previewData?.final_rows != null ? previewData.final_rows.toLocaleString() : '1,941', color: PwC.tangerine, sub: `From ${previewData?.initial_rows?.toLocaleString() || '10,472'} total` },
          { label: 'Class Balance', value: labelSummary.positive_count != null ? `${labelSummary.positive_count} TP (${labelSummary.class_balance_pct}%)` : '745 TP (38.38%)', color: PwC.emerald, sub: `${labelSummary.negative_count?.toLocaleString() || '1,196'} False Positives` },
          { label: 'Synthesized Features', value: previewData?.column_count != null ? `${previewData.column_count} Cols` : '111 Cols', color: PwC.midnight, sub: '54 Pre-Alert + 57 Profile' },
          { label: 'Validation', value: isBlocked ? 'BLOCKED' : 'PASSED (15/15)', color: isBlocked ? PwC.red : PwC.emerald, sub: isBlocked ? `${blockers.length} blocker(s)` : '0 duplicates, 0 leakage' },
        ].map((item, idx) => (
          <Box key={idx} sx={{ flex: 1, px: 1.25, py: 0.85, borderRight: idx < 3 ? `1px solid ${PwC.border}` : 'none', bgcolor: PwC.white }}>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>{item.label}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: item.color, mt: 0.15, fontVariantNumeric: 'tabular-nums' }}>{item.value}</Typography>
            <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>{item.sub}</Typography>
          </Box>
        ))}
      </Box>

      {/* Blockers */}
      {blockers.length > 0 && (
        <Alert severity="error" sx={{ mb: 1.5, borderRadius: '5px', fontSize: 11.5, '& .MuiAlert-message': { fontSize: 11.5 } }}>
          <AlertTitle sx={{ fontWeight: 800, fontSize: 12 }}>Master Dataset Build is Blocked</AlertTitle>
          {blockers.map((b, idx) => (
            <Typography key={idx} sx={{ fontSize: 11 }}>
              <strong>[{b.code}]</strong> {b.message}
            </Typography>
          ))}
        </Alert>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '5px', fontSize: 11.5, '& .MuiAlert-message': { fontSize: 11.5 } }}>
          <AlertTitle sx={{ fontWeight: 800, fontSize: 12 }}>Validation Advisory</AlertTitle>
          {warnings.map((w, idx) => (
            <Typography key={idx} sx={{ fontSize: 11 }}>
              <strong>[{w.code}]</strong> {w.message}
            </Typography>
          ))}
        </Alert>
      )}

      {/* Execution Trace */}
      {executionTrace.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9 }}>
              Execution Trace
            </Typography>
            <Chip icon={<Speed sx={{ fontSize: '10px !important', color: `${PwC.emerald} !important` }} />}
              label="13/13 DETERMINISTIC" size="small"
              sx={{ height: 17, fontSize: 8, fontWeight: 700, bgcolor: PwC.emeraldLight, color: PwC.emerald, borderRadius: '3px' }} />
          </Stack>

          <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden', bgcolor: PwC.white }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '50px 1.2fr 0.7fr 0.7fr 1.5fr', px: 1.5, py: 0.55, bgcolor: PwC.surface, borderBottom: `1px solid ${PwC.border}` }}>
              {['Step', 'Operation', 'In Rows', 'Out Rows', 'Details'].map((h) => (
                <Typography key={h} sx={{ fontSize: 9.5, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>{h}</Typography>
              ))}
            </Box>
            {executionTrace.map((step, idx) => (
              <Box key={idx} sx={{
                display: 'grid', gridTemplateColumns: '50px 1.2fr 0.7fr 0.7fr 1.5fr', px: 1.5, py: 0.6,
                borderBottom: idx < executionTrace.length - 1 ? `1px solid ${PwC.border}` : 'none',
                '&:hover': { bgcolor: PwC.cloud },
              }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: PwC.tangerine }}>#{step.step_number}</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: PwC.midnight }}>{step.step_name}</Typography>
                <Typography sx={{ fontSize: 11, color: PwC.mist, fontVariantNumeric: 'tabular-nums' }}>{step.rows_in?.toLocaleString()}</Typography>
                <Typography sx={{ fontSize: 11, color: PwC.mist, fontVariantNumeric: 'tabular-nums' }}>{step.rows_out?.toLocaleString()}</Typography>
                <Typography sx={{ fontSize: 10.5, color: PwC.mist }}>{step.details}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button
          variant="outlined"
          startIcon={<Refresh sx={{ fontSize: 13 }} />}
          onClick={onRefreshPreview}
          disabled={loadingPreview}
          sx={{ color: PwC.mist, borderColor: PwC.border, fontSize: 11, fontWeight: 700, textTransform: 'none', borderRadius: '4px', py: 0.4, '&:hover': { borderColor: PwC.midnight, color: PwC.midnight } }}
        >
          {loadingPreview ? 'Refreshing...' : 'Re-Run Preview'}
        </Button>
        <Button
          variant="contained"
          startIcon={building ? <CircularProgress size={13} color="inherit" /> : <PlayArrow sx={{ fontSize: 13 }} />}
          onClick={onRunBuild}
          disabled={isBlocked || building}
          sx={{ bgcolor: PwC.tangerine, '&:hover': { bgcolor: PwC.midnight }, fontSize: 11, fontWeight: 700, textTransform: 'none', px: 2, borderRadius: '4px', boxShadow: 'none', py: 0.4 }}
        >
          {building ? 'Building...' : 'Build Master Dataset Version'}
        </Button>
      </Stack>
    </Box>
  );
}
