// frontend/src/tools/calibration/components/KSInterpretationBadge.jsx
// PwC Professional Design - Fixed Size & Realistic Interpretation

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  Collapse,
  IconButton,
  Alert
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon
} from '@mui/icons-material';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF',
  error: '#C5281C',
  success: '#107C41',
  warning: '#F7941E'
};

const KSInterpretationBadge = ({ ksStatistic, narrative }) => {
  const [expanded, setExpanded] = useState(false);

  if (!ksStatistic || !narrative) {
    return null;
  }

  const { ks_statistic, interpretation, p_value } = ksStatistic;

  // FIXED: More realistic interpretation thresholds
  const interpretationConfig = {
    'weak': {
      color: PWC_COLORS.error,
      icon: <WarningIcon sx={{ fontSize: '0.875rem' }} />,
      label: 'Weak Separation',
      bgcolor: '#FFF5F5'
    },
    'moderate': {
      color: PWC_COLORS.warning,
      icon: <InfoIcon sx={{ fontSize: '0.875rem' }} />,
      label: 'Moderate Separation',
      bgcolor: '#FFF9F0'
    },
    'strong': {
      color: PWC_COLORS.success,
      icon: <CheckCircleIcon sx={{ fontSize: '0.875rem' }} />,
      label: 'Strong Separation',
      bgcolor: '#F0F8F4'
    },
    'very_strong': {
      color: PWC_COLORS.orange,
      icon: <CheckCircleIcon sx={{ fontSize: '0.875rem' }} />,
      label: 'Excellent Separation',
      bgcolor: '#FFF5F0'
    },
    'insufficient_data': {
      color: PWC_COLORS.mediumGray,
      icon: <WarningIcon sx={{ fontSize: '0.875rem' }} />,
      label: 'Insufficient Data',
      bgcolor: '#FAFAFA'
    }
  };

  const config = interpretationConfig[interpretation] || interpretationConfig['weak'];

  return (
    <Paper 
      variant="outlined" 
      sx={{ 
        p: 2,
        border: `1px solid ${PWC_COLORS.lightGray}`,
        boxShadow: 'none'
      }}
    >
      {/* KS Value Display - SMALLER */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography 
          variant="subtitle2" 
          sx={{ 
            color: PWC_COLORS.mediumGray,
            fontSize: '0.813rem',
            fontWeight: 500
          }}
        >
          KS Statistic
        </Typography>
        <Chip
          icon={config.icon}
          label={config.label}
          size="small"
          sx={{
            bgcolor: config.bgcolor,
            color: config.color,
            border: `1px solid ${config.color}`,
            fontWeight: 500,
            fontSize: '0.688rem',
            height: 22,
            '& .MuiChip-icon': {
              color: config.color,
              fontSize: '0.875rem'
            }
          }}
        />
      </Box>

      {/* FIXED: Smaller KS Value Display */}
      <Typography 
        variant="h4" 
        fontWeight={600}
        sx={{ 
          color: config.color,
          fontSize: '1.75rem',
          letterSpacing: '-0.01em',
          mb: 0.5
        }}
      >
        {interpretation === 'insufficient_data' ? 'N/A' : ks_statistic?.toFixed(3) || '—'}
      </Typography>

      {p_value !== null && p_value !== undefined && (
        <Typography 
          variant="caption" 
          display="block" 
          sx={{ 
            color: PWC_COLORS.mediumGray,
            fontSize: '0.75rem'
          }}
        >
          p-value: {p_value < 0.001 ? '<0.001' : p_value.toFixed(4)}
        </Typography>
      )}

      {/* Expandable Explanation */}
      <Box mt={2}>
        <Box 
          display="flex" 
          alignItems="center" 
          justifyContent="space-between"
          sx={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography 
            variant="body2" 
            fontWeight={500}
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '0.813rem'
            }}
          >
            {narrative.headline}
          </Typography>
          <IconButton size="small" sx={{ color: PWC_COLORS.mediumGray }}>
            <ExpandMoreIcon 
              sx={{ 
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.25s ease',
                fontSize: '1.25rem'
              }} 
            />
          </IconButton>
        </Box>

        <Collapse in={expanded}>
          <Box 
            sx={{ 
              mt: 2,
              p: 2,
              bgcolor: config.bgcolor,
              borderRadius: 1,
              border: `1px solid ${PWC_COLORS.lightGray}`
            }}
          >
            <Typography 
              variant="body2" 
              paragraph
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.813rem',
                lineHeight: 1.6,
                mb: 1.5
              }}
            >
              <strong>Explanation:</strong> {narrative.explanation}
            </Typography>
            
            <Typography 
              variant="body2" 
              paragraph
              sx={{ 
                color: PWC_COLORS.darkGray,
                fontSize: '0.813rem',
                lineHeight: 1.6,
                mb: 1.5
              }}
            >
              <strong>Recommendation:</strong> {narrative.recommendation}
            </Typography>
            
            <Typography 
              variant="caption" 
              sx={{ 
                color: PWC_COLORS.mediumGray,
                fontSize: '0.75rem',
                lineHeight: 1.6,
                display: 'block'
              }}
            >
              {narrative.technical_note}
            </Typography>
          </Box>
        </Collapse>
      </Box>

      {/* Realistic Context Note */}
      {ks_statistic >= 0.7 && (
        <Alert 
          severity="info" 
          sx={{ 
            mt: 2,
            py: 0.5,
            border: `1px solid ${PWC_COLORS.lightGray}`,
            '& .MuiAlert-icon': {
              color: PWC_COLORS.orange,
              fontSize: '1rem'
            },
            '& .MuiAlert-message': {
              fontSize: '0.75rem',
              color: PWC_COLORS.darkGray
            }
          }}
        >
          <strong>Note:</strong> KS values above 0.7 are rare in financial data and indicate exceptional separation. Verify data quality and threshold selection.
        </Alert>
      )}
    </Paper>
  );
};

export default KSInterpretationBadge;