// frontend/src/tools/calibration/components/ScenarioCard.jsx
import React from 'react';
import { Card, CardContent, Typography, Button, Chip, Stack, Box } from '@mui/material';
import { ArrowForward, TrendingUp, Schedule } from '@mui/icons-material';

const ScenarioCard = ({ scenario, onSelect }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        transition: 'all 0.2s',
        '&:hover': {
          boxShadow: 3,
          borderColor: 'primary.main',
          transform: 'translateY(-4px)'
        }
      }}
    >
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" fontWeight="600" gutterBottom>
              {scenario.name}
            </Typography>
            <Chip
              label={scenario.category}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ mb: 1 }}
            />
            <Typography variant="body2" color="text.secondary">
              {scenario.description}
            </Typography>
          </Box>

          <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight="600" display="block" mb={0.5}>
              Typical Behavior:
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {scenario.typical_behavior}
            </Typography>
          </Box>

          {scenario.risk_indicators && (
            <Box>
              <Typography variant="caption" fontWeight="600" display="block" mb={0.5}>
                Risk Indicators:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {scenario.risk_indicators.map((indicator, idx) => (
                  <Chip key={idx} label={indicator} size="small" variant="outlined" />
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction="row" spacing={2} alignItems="center">
            {scenario.use_count > 0 && (
              <Chip
                icon={<TrendingUp />}
                label={`${scenario.use_count} uses`}
                size="small"
                variant="outlined"
              />
            )}
            {scenario.last_calibrated && (
              <Chip
                icon={<Schedule />}
                label={new Date(scenario.last_calibrated).toLocaleDateString()}
                size="small"
                variant="outlined"
              />
            )}
          </Stack>

          <Button
            variant="contained"
            fullWidth
            endIcon={<ArrowForward />}
            onClick={() => onSelect(scenario)}
          >
            Use This Scenario
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ScenarioCard;