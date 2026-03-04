/**
 * GoalCard.jsx
 * One card in the "What's your goal?" selector.
 * Completely self-contained - no external state.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import Check from '@mui/icons-material/Check';

const GoalCard = ({ goal, selected, onClick }) => {
  const isSelected = selected;

  return (
    <Box
      onClick={onClick}
      sx={{
        flex: 1,
        minWidth: 180,
        cursor: 'pointer',
        borderRadius: 3,
        border: `2px solid ${isSelected ? goal.color : '#e2e8f0'}`,
        bgcolor: isSelected ? goal.bgColor : '#fff',
        p: 2.5,
        transition: 'all 0.18s ease',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': {
          borderColor: goal.color,
          bgcolor: goal.bgColor,
          transform: 'translateY(-2px)',
          boxShadow: `0 8px 24px ${goal.color}1f`,
        },
      }}
    >
      {/* Decorative orb */}
      <Box sx={{
        position: 'absolute',
        top: -20,
        right: -20,
        width: 80,
        height: 80,
        borderRadius: '50%',
        bgcolor: `${goal.color}18`,
        pointerEvents: 'none',
      }} />

      <Box sx={{
        width: 34,
        height: 22,
        mb: 1.1,
        borderRadius: 1,
        border: `1px solid ${goal.color}55`,
        bgcolor: '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: goal.color }}>{goal.code || 'GOAL'}</Typography>
      </Box>

      <Typography sx={{
        fontSize: 13.5,
        fontWeight: 700,
        color: isSelected ? goal.color : '#1e293b',
        mb: 0.5,
        lineHeight: 1.3,
      }}>
        {goal.title}
      </Typography>

      <Typography sx={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
        {goal.description}
      </Typography>

      {goal.tradeoff && (
        <Box sx={{
          mt: 1.5,
          px: 1,
          py: 0.5,
          bgcolor: `${goal.color}14`,
          borderRadius: 1.5,
          display: 'inline-block',
        }}>
          <Typography sx={{ fontSize: 10.5, color: goal.color, fontWeight: 600 }}>
            {goal.tradeoff}
          </Typography>
        </Box>
      )}

      {isSelected && (
        <Box sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 19,
          height: 19,
          borderRadius: '50%',
          bgcolor: goal.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Check sx={{ fontSize: 13, color: '#fff', fontWeight: 700 }} />
        </Box>
      )}
    </Box>
  );
};

export default GoalCard;
