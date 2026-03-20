import React from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  Analytics,
  ArrowForward,
  CheckCircleOutline,
  HubOutlined,
  RuleFolderOutlined,
  VerifiedOutlined,
} from '@mui/icons-material';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

const FLOW_STEPS = [
  { icon: RuleFolderOutlined, title: 'Review the alert problem', detail: 'Start from the alerts that are currently being created and escalated.' },
  { icon: Analytics, title: 'Understand the data', detail: 'Check what transactions, accounts, customers, and alert history are telling us.' },
  { icon: HubOutlined, title: 'Build the reduction model', detail: 'Use those patterns to distinguish likely false positives from higher-value alerts.' },
  { icon: VerifiedOutlined, title: 'Validate the trade-off', detail: 'Measure workload reduction against missed-risk and control expectations.' },
  { icon: CheckCircleOutline, title: 'Support suppression decisions', detail: 'Keep stronger alerts visible while reducing low-value reviews.' },
];

const VALIDATION_TRACKS = [
  {
    title: 'Supervised models',
    body: 'Validate with precision, recall, confusion matrix, threshold simulation, false positive reduction, and missed-risk trade-offs.',
  },
  {
    title: 'Unsupervised models',
    body: 'Validate by checking where anomalies or clusters concentrate, whether they align to escalated cases, and whether they reduce rule noise in a plausible way.',
  },
  {
    title: 'Deep learning models',
    body: 'Validate with temporal holdouts, stability across retraining windows, calibration checks, and explainability or surrogate evidence where possible.',
  },
];

export default function DefineObjectivePanel() {
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel }}>
        <Box sx={{ px: 2, py: 1.75, borderBottom: `1px solid ${FCC_THEME.border}` }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>
            What this workbench does
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 2 }}>
          <Typography sx={{ fontSize: 12, color: FCC_THEME.textMuted, lineHeight: 1.7 }}>
            Transaction monitoring rules generate large numbers of alerts. Many of those alerts are false positives and still go to L1 and L2 review.
            This workbench helps the team understand the underlying data, build a model to identify low-value false positive alerts, and reduce unnecessary manual review while keeping higher-risk alerts visible.
          </Typography>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel }}>
        <Box sx={{ px: 2, py: 1.75, borderBottom: `1px solid ${FCC_THEME.border}` }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>
            How the business flow works
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 2 }}>
          <Stack spacing={1.25}>
            {FLOW_STEPS.map((item, idx) => {
              const Icon = item.icon;
              return (
                <Stack key={item.title} direction="row" spacing={1.25} alignItems="flex-start">
                  <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: FCC_THEME.accentSoft, border: `1px solid ${FCC_THEME.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon sx={{ fontSize: 16, color: FCC_THEME.accent }} />
                  </Box>
                  <Box sx={{ flex: 1, pt: 0.2 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: FCC_THEME.text }}>
                      {item.title}
                    </Typography>
                    <Typography sx={{ fontSize: 11.25, color: FCC_THEME.textMuted, lineHeight: 1.55 }}>
                      {item.detail}
                    </Typography>
                  </Box>
                  {idx < FLOW_STEPS.length - 1 ? <ArrowForward sx={{ fontSize: 15, color: FCC_THEME.textSoft, mt: 0.8 }} /> : null}
                </Stack>
              );
            })}
          </Stack>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel }}>
        <Box sx={{ px: 2, py: 1.75, borderBottom: `1px solid ${FCC_THEME.border}` }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>
            How model types are validated
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 2 }}>
          <Stack spacing={1.1}>
            {VALIDATION_TRACKS.map((track) => (
              <Box key={track.title} sx={{ px: 1.5, py: 1.25, borderRadius: 2, border: `1px solid ${FCC_THEME.border}`, bgcolor: FCC_THEME.panelAlt }}>
                <Typography sx={{ fontSize: 11.75, fontWeight: 700, color: FCC_THEME.text, mb: 0.35 }}>
                  {track.title}
                </Typography>
                <Typography sx={{ fontSize: 11.1, color: FCC_THEME.textMuted, lineHeight: 1.55 }}>
                  {track.body}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Paper>
    </Stack>
  );
}
