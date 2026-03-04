/**
 * steps/StepGoal.jsx
 * Wizard step 3: What's your business goal?
 * Uses GoalCard - fully plain English, no ML jargon.
 */
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import GoalCard from '../components/GoalCard';

const GOALS = [
  {
    id: 'catch_most',
    code: 'HIG',
    title: 'Catch everything',
    description: 'Find as many fraud cases as possible. Your team will review more alerts, but you\'ll miss fewer real threats.',
    tradeoff: 'Higher analyst workload',
    color: '#D04A02',
    bgColor: '#fff4ee',
  },
  {
    id: 'balanced',
    code: 'BAL',
    title: 'Strike a balance',
    description: 'A sensible middle ground - catch most real cases while keeping your team\'s workload manageable.',
    tradeoff: 'Balanced precision and recall',
    color: '#A83A00',
    bgColor: '#fff7f3',
  },
  {
    id: 'minimize_false_alarms',
    code: 'EFF',
    title: 'Reduce false alarms',
    description: 'Only surface the most confident cases. Your team reviews fewer alerts - but some real cases may be missed.',
    tradeoff: 'Smaller review queue',
    color: '#7A5100',
    bgColor: '#fff9ef',
  },
];

const StepGoal = ({ selectedGoal, onGoalChange }) => (
  <Stack spacing={2}>
    <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
      <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
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
