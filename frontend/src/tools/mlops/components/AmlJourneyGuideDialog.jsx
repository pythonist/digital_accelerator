import React from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  AccountTree,
  Analytics,
  Assessment,
  CloudDone,
  Flag,
  Gavel,
  Hub,
  ModelTraining,
  Notifications,
  Tune,
} from '@mui/icons-material';

const JOURNEY_STEPS = [
  {
    id: 'data',
    title: 'Generate alerted activity',
    icon: Notifications,
    purpose: 'Start with synthetic alerted transactions that mimic what upstream monitoring platforms send into AML operations.',
    value: 'This frames the business problem clearly: too many alerts, too little analyst time, and a need to suppress false positives safely.',
  },
  {
    id: 'master',
    title: 'Assemble FCC master data',
    icon: AccountTree,
    purpose: 'Join customer, account, alert, and transaction context into one model-ready FCC dataset.',
    value: 'This gives the bank a governed, explainable training foundation rather than a black-box model built on disconnected files.',
  },
  {
    id: 'eda',
    title: 'Explain what the alert population looks like',
    icon: Analytics,
    purpose: 'Use EDA and preprocessing to show feature quality, class balance, missing values, and suspicious signal patterns.',
    value: 'Business users can see why the model is needed, what risk drivers matter, and which fields actually influence the decision.',
  },
  {
    id: 'model',
    title: 'Train the FCC suppression model',
    icon: ModelTraining,
    purpose: 'Train a model that learns which alerts are likely false positives and which should still be escalated.',
    value: 'The output to the bank is a governed false-positive reduction model with measurable precision, recall, and review-gap controls.',
  },
  {
    id: 'validation',
    title: 'Validate threshold and guardrails',
    icon: Flag,
    purpose: 'Tune the threshold so suppression volume increases without exceeding acceptable review-gap limits.',
    value: 'This is where the bank sees the operating trade-off: how much analyst effort is saved versus how much residual risk is tolerated.',
  },
  {
    id: 'dashboard',
    title: 'Score unseen synthetic data',
    icon: CloudDone,
    purpose: 'Generate a fresh unseen FCC batch so the operating flow behaves like a production scoring cycle instead of replaying training data.',
    value: 'This proves the deployed model can act on new alerts, not just historical examples used during build.',
  },
  {
    id: 'dashboard',
    title: 'Hand retained cases to Sentinel',
    icon: Hub,
    purpose: 'Suppress low-value FCC alerts and flow only the remaining retained cases into Sentinel with reusable case data.',
    value: 'This is the bank outcome: fewer false positives in the queue and richer downstream investigations on the cases that still matter.',
  },
  {
    id: 'dashboard',
    title: 'Investigate in Sentinel',
    icon: Gavel,
    purpose: 'Open Sentinel case packs, graph analysis, and copilot on the FCC-retained population.',
    value: 'The workflow becomes a full AML journey: monitoring -> suppression -> analyst investigation -> explainable case management.',
  },
];

const OUTCOME_CHIPS = [
  'Lower false-positive workload',
  'Governed model controls',
  'Explainable suppression decisions',
  'Reusable downstream case data',
  'Full FCC to Sentinel AML story',
];

const AmlJourneyGuideDialog = ({
  open,
  onClose,
  onJumpToStep,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle sx={{ fontWeight: 800 }}>
      FCC to Sentinel AML Journey
    </DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Box>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.7 }}>
            Use this guide when business users do not want to click through every technical control. It gives a clean story for what the platform does, why each stage exists, and what value we deliver to banks.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {OUTCOME_CHIPS.map((label) => (
              <Chip key={label} size="small" label={label} />
            ))}
          </Stack>
        </Box>

        {JOURNEY_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <Paper
              key={`${step.id}-${index}`}
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                borderColor: '#dbe4f0',
                background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
              }}
            >
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 240 }}>
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: '#edf4ff',
                      color: '#1d4ed8',
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                      Step {index + 1}
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {step.title}
                    </Typography>
                  </Box>
                </Stack>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                    What happens
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.65 }}>
                    {step.purpose}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, mt: 1 }}>
                    What the bank gets
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.65 }}>
                    {step.value}
                  </Typography>
                </Box>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => onJumpToStep?.(step.id)}
                  sx={{ textTransform: 'none', flexShrink: 0 }}
                >
                  Open Step
                </Button>
              </Stack>
            </Paper>
          );
        })}

        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: 2,
            borderColor: '#fed7aa',
            bgcolor: '#fff7ed',
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Assessment sx={{ color: '#c2410c' }} />
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                Dashboard shortcut
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.65 }}>
                Once the model is deployed, use the dashboard action to generate unseen FCC data, publish the retained queue, import it into Sentinel, and open case investigation in one flow.
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, py: 1.5 }}>
      <Button onClick={onClose} sx={{ textTransform: 'none' }}>
        Close
      </Button>
      <Button variant="contained" onClick={() => onJumpToStep?.('dashboard')} sx={{ textTransform: 'none' }}>
        Open Dashboard
      </Button>
    </DialogActions>
  </Dialog>
);

export default AmlJourneyGuideDialog;
