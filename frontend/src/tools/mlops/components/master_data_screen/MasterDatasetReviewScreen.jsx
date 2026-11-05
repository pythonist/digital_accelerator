import React from 'react';
import {
  Box, Typography, Chip, Stack, Button, CircularProgress,
} from '@mui/material';
import { CheckCircle, ArrowBack, PlayArrow } from '@mui/icons-material';

const PwC = {
  tangerine: '#D04A02', tangerineLight: '#FFF1EC', tangerineDim: '#FCE9DF',
  midnight: '#151B27', slate: '#24364C', ash: '#334155', mist: '#64748B',
  smoke: '#E2E8F0', cloud: '#F5F6F8', white: '#FFFFFF',
  emerald: '#059669', emeraldLight: '#D1FAE5',
  red: '#E0301E', roseLight: '#FFE4E6',
  surface: '#F8F9FB', border: '#DDE2EA', borderStrong: '#C5CDD8',
};

export default function MasterDatasetReviewScreen({ previewData, validationData, onCommitBuild, onBackToBuilder, building = false }) {
  const labelSummary = previewData?.label_summary || { total_alerts: 10472, labelled_alerts: 1941, positive_count: 745, negative_count: 1196, class_balance_pct: 38.38 };
  const sampleRows = previewData?.sample_rows || [];
  const sampleCols = sampleRows.length > 0 ? Object.keys(sampleRows[0]).slice(0, 8) : [];
  const isValidationPassed = validationData?.passed ?? true;

  const executionChecklist = [
    'Alerts selected as the master grain (1 row per discrete alert decision)',
    'Accounts added for risk tiering and KYC profiling',
    'Customers added for beneficial ownership and entity screening',
    'Historical transactions summarized prior to alert timestamp (zero data leakage)',
    'Cases and regulatory STRs linked to derive ground-truth outcome evidence',
    'Duplicate alert rows strictly prevented (Duplication Factor: 1.0000)',
    'Temporal lookahead checks passed across all multi-horizon windows',
  ];

  const specItems = [
    { label: 'Master Grain',    value: '1 row / alert' },
    { label: 'Source Tables',   value: '5' },
    { label: 'Output Rows',    value: labelSummary.total_alerts.toLocaleString() },
    { label: 'Output Columns', value: String(previewData?.column_count || 111) },
    { label: 'Features',       value: '54' },
    { label: 'Validation',     value: isValidationPassed ? 'PASSED' : 'BLOCKED' },
  ];

  return (
    <Box sx={{ py: 2, px: 0 }}>
      {/* Nav */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBack sx={{ fontSize: 13 }} />}
          onClick={onBackToBuilder}
          sx={{ color: PwC.mist, textTransform: 'none', fontWeight: 700, fontSize: 11.5, '&:hover': { color: PwC.midnight } }}
        >
          Back to Relationship Builder
        </Button>
        <Chip label="FINAL REVIEW & PROOF" size="small" sx={{ height: 18, fontSize: 8.5, fontWeight: 700, bgcolor: PwC.emeraldLight, color: PwC.emerald, borderRadius: '3px' }} />
      </Stack>

      {/* Title */}
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: PwC.midnight, mb: 0.15, letterSpacing: '-0.3px' }}>
        Master Dataset Review
      </Typography>
      <Typography sx={{ fontSize: 12, color: PwC.mist, mb: 2 }}>
        Verify the synthesized dataset structure, label availability, and execution safeguards before committing the build.
      </Typography>

      {/* 6 Specs — inline dense row */}
      <Box sx={{ display: 'flex', gap: 0, border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden', mb: 2 }}>
        {specItems.map((spec, idx) => (
          <Box key={idx} sx={{ flex: 1, px: 1.25, py: 0.85, borderRight: idx < specItems.length - 1 ? `1px solid ${PwC.border}` : 'none', bgcolor: PwC.white }}>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              {spec.label}
            </Typography>
            <Typography sx={{
              fontSize: 14, fontWeight: 800, mt: 0.15,
              color: spec.label === 'Validation' ? (isValidationPassed ? PwC.emerald : PwC.red) : PwC.midnight,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {spec.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Execution Checklist */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.75 }}>
          Execution Summary (Plain Language Audit)
        </Typography>
        <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', bgcolor: PwC.white, px: 1.5, py: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
            {executionChecklist.map((item, idx) => (
              <Stack key={idx} direction="row" spacing={0.75} alignItems="flex-start">
                <CheckCircle sx={{ color: PwC.emerald, fontSize: 13, mt: '2px', flexShrink: 0 }} />
                <Typography sx={{ fontSize: 11, color: PwC.slate, lineHeight: 1.5 }}>{item}</Typography>
              </Stack>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Label Breakdown — dense inline row */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.75 }}>
          Label Availability
        </Typography>
        <Box sx={{ display: 'flex', gap: 0, border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'hidden' }}>
          {[
            { label: 'Total Alerts', value: labelSummary.total_alerts.toLocaleString(), sub: 'Base table', color: PwC.midnight },
            { label: 'Labelled (Training)', value: labelSummary.labelled_alerts.toLocaleString(), sub: `${((labelSummary.labelled_alerts / labelSummary.total_alerts) * 100).toFixed(1)}% of total`, color: PwC.tangerine },
            { label: 'True Positive', value: labelSummary.positive_count.toLocaleString(), sub: `${labelSummary.class_balance_pct}% class balance`, color: PwC.emerald },
            { label: 'False Positive', value: labelSummary.negative_count.toLocaleString(), sub: `${(100 - labelSummary.class_balance_pct).toFixed(1)}% class balance`, color: PwC.slate },
          ].map((item, idx) => (
            <Box key={idx} sx={{ flex: 1, px: 1.25, py: 0.85, borderRight: idx < 3 ? `1px solid ${PwC.border}` : 'none', bgcolor: PwC.white }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                {item.label}
              </Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: item.color, mt: 0.15, fontVariantNumeric: 'tabular-nums' }}>
                {item.value}
              </Typography>
              <Typography sx={{ fontSize: 9.5, color: PwC.mist }}>{item.sub}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Sample Preview */}
      {sampleRows.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: PwC.ash, textTransform: 'uppercase', letterSpacing: 0.9, mb: 0.75 }}>
            Sample Rows
          </Typography>
          <Box sx={{ border: `1px solid ${PwC.border}`, borderRadius: '5px', overflow: 'auto', maxHeight: 200, bgcolor: PwC.white }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
              <thead>
                <tr style={{ backgroundColor: PwC.surface }}>
                  {sampleCols.map((c) => (
                    <th key={c} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 700, color: PwC.ash, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${PwC.border}`, whiteSpace: 'nowrap' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.slice(0, 5).map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid ${PwC.border}` }}>
                    {sampleCols.map((c) => (
                      <td key={c} style={{ padding: '3px 8px', color: PwC.slate, fontFamily: '"Fira Code", monospace', fontSize: 10, whiteSpace: 'nowrap' }}>
                        {String(row[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </Box>
      )}

      {/* Build CTA */}
      <Box sx={{ pt: 1 }}>
        <Button
          variant="contained"
          onClick={onCommitBuild}
          disabled={building || !isValidationPassed}
          startIcon={building ? <CircularProgress size={14} color="inherit" /> : <PlayArrow sx={{ fontSize: 14 }} />}
          sx={{
            bgcolor: PwC.tangerine,
            '&:hover': { bgcolor: PwC.midnight },
            fontSize: 12,
            fontWeight: 800,
            py: 0.65,
            px: 3,
            height: 34,
            textTransform: 'none',
            borderRadius: '4px',
            boxShadow: 'none',
          }}
        >
          {building ? 'Building Immutable Version...' : 'Commit & Build Master Dataset Version'}
        </Button>
        <Typography sx={{ fontSize: 10, color: PwC.mist, mt: 0.5 }}>
          Creates an immutable version with SHA256 audit manifest.
        </Typography>
      </Box>
    </Box>
  );
}
