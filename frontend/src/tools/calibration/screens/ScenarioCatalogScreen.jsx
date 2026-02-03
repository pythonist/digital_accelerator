// frontend/src/tools/calibration/screens/ScenarioCatalogScreen.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Grid, Card, CardContent, Typography, Button, Chip,
  Stack, IconButton, Tooltip
} from '@mui/material';
import {
  ArrowForward, TrendingUp, Schedule, Check
} from '@mui/icons-material';
import PageContainer from '../layout/PageContainer';
import apiClient from '@services/api';
import { useCalibration } from '../context/CalibrationContext';

const ScenarioCard = ({ scenario, onSelect }) => {
  return (
    <Card 
      variant="outlined" 
      sx={{ 
        height: '100%',
        transition: 'all 0.2s',
        '&:hover': {
          boxShadow: 3,
          borderColor: 'primary.main'
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
          
          <Stack direction="row" spacing={2} alignItems="center">
            {scenario.use_count > 0 && (
              <Tooltip title="Times used">
                <Chip 
                  icon={<TrendingUp />}
                  label={`${scenario.use_count} uses`}
                  size="small"
                  variant="outlined"
                />
              </Tooltip>
            )}
            {scenario.last_calibrated && (
              <Tooltip title="Last calibrated">
                <Chip 
                  icon={<Schedule />}
                  label={new Date(scenario.last_calibrated).toLocaleDateString()}
                  size="small"
                  variant="outlined"
                />
              </Tooltip>
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

const ScenarioCatalogScreen = () => {
  const { createRun } = useCalibration();
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadScenarios();
  }, []);
  
  const loadScenarios = async () => {
    try {
      const res = await apiClient.get('/api/v2/calibration/scenario/list');
      setScenarios(res.scenarios);
    } catch (err) {
      console.error('Failed to load scenarios:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSelectScenario = async (scenario) => {
    // Create new run with scenario template
    await createRun(scenario.name, scenario);
    // Navigate to Step 1 (will auto-populate from scenario)
  };
  
  return (
    <PageContainer
      title="Scenario Catalog"
      subtitle="Select a pre-built scenario or create custom filters"
    >
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Scenarios define the <strong>behavior of interest</strong>, not thresholds. 
          Each scenario includes recommended filters and aggregation settings.
        </Typography>
      </Box>
      
      <Grid container spacing={3}>
        {scenarios.map((scenario) => (
          <Grid item xs={12} md={6} lg={4} key={scenario.scenario_id}>
            <ScenarioCard 
              scenario={scenario} 
              onSelect={handleSelectScenario}
            />
          </Grid>
        ))}
      </Grid>
    </PageContainer>
  );
};

export default ScenarioCatalogScreen;