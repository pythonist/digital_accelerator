/**
 * steps/StepGoal.jsx
 * Wizard step 3: What's your business goal?
 * Uses GoalCard - fully plain English, no ML jargon.
 */
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import GoalCard from '../components/GoalCard';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

const GOALS = [
  {
    id: 'catch_most',
    code: 'HIG',
    title: 'Catch everything',
    description: 'Find as many fraud cases as possible. Your team will review more alerts, but you\'ll miss fewer real threats.',
    tradeoff: 'Higher analyst workload',
    color: FCC_THEME.accent,
    bgColor: FCC_THEME.accentSoft,
  },
  {
    id: 'balanced',
    code: 'BAL',
    title: 'Strike a balance',
    description: 'A sensible middle ground - catch most real cases while keeping your team\'s workload manageable.',
    tradeoff: 'Balanced precision and recall',
    color: FCC_THEME.accentHover,
    bgColor: '#FFF6F0',
  },
  {
    id: 'minimize_false_alarms',
    code: 'EFF',
    title: 'Reduce false alarms',
    description: 'Only surface the most confident cases. Your team reviews fewer alerts - but some real cases may be missed.',
    tradeoff: 'Smaller review queue',
    color: FCC_THEME.warning,
    bgColor: FCC_THEME.warningBg,
  },
];

const StepGoal = ({ selectedGoal, onGoalChange }) => (
  <Stack spacing={2}>
    <Box sx={{ p: 2, bgcolor: FCC_THEME.panelAlt, borderRadius: 2, border: `1px solid ${FCC_THEME.border}` }}>
      <Typography sx={{ fontSize: 13, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
        Every model makes a tradeoff. Pick the one that fits how your team works.
        <strong> You can always retune this later.</strong>
      </Typography>
    </Box>

    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      {GOALS.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          selected={selectedGoal === goal.id}
          onClick={() => onGoalChange(goal.id)}
        />
      ))}
    </Box>
  </Stack>
);

export default StepGoal;
