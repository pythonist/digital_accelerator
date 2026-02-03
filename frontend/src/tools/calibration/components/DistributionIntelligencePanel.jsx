// frontend/src/tools/calibration/components/DistributionIntelligencePanel.jsx
// PwC Professional Design

import React, { useState } from 'react';
import { 
  Card, CardContent, Box, Typography, Tabs, Tab, Stack,
  Chip, ToggleButtonGroup, ToggleButton
} from '@mui/material';
import { Insights as InsightsIcon, TableChart, ShowChart } from '@mui/icons-material';
import DistributionTable from './DistributionTable';
import DistributionShapeInsights from './DistributionShapeInsights';
import HistogramChart from './HistogramChart';

const PWC_COLORS = {
  orange: '#D04A02',
  darkGray: '#2C2C2C',
  mediumGray: '#53565A',
  lightGray: '#E6E6E6',
  white: '#FFFFFF'
};

const DistributionIntelligencePanel = ({ 
  histogramData, 
  distributionTable, 
  distributionShape,
  threshold,
  percentile 
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [logScale, setLogScale] = useState(false);
  
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <InsightsIcon sx={{ color: PWC_COLORS.orange, fontSize: '1.25rem' }} />
          <Typography 
            variant="h6"
            sx={{ 
              color: PWC_COLORS.darkGray,
              fontSize: '1rem',
              fontWeight: 600,
              letterSpacing: '-0.01em'
            }}
          >
            Population Distribution
          </Typography>
        </Box>
        <Chip 
          label={`Selected: p${percentile}`} 
          sx={{ 
            bgcolor: PWC_COLORS.orange,
            color: PWC_COLORS.white,
            fontWeight: 600,
            fontSize: '0.813rem',
            height: 28
          }}
        />
      </Stack>
      
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: PWC_COLORS.lightGray, mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(e, v) => setActiveTab(v)}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: PWC_COLORS.mediumGray,
              letterSpacing: '-0.01em',
              '&.Mui-selected': {
                color: PWC_COLORS.orange
              }
            },
            '& .MuiTabs-indicator': {
              backgroundColor: PWC_COLORS.orange
            }
          }}
        >
          <Tab icon={<ShowChart sx={{ fontSize: '1.125rem' }} />} label="Chart" iconPosition="start" />
          <Tab icon={<TableChart sx={{ fontSize: '1.125rem' }} />} label="Table" iconPosition="start" />
          <Tab icon={<InsightsIcon sx={{ fontSize: '1.125rem' }} />} label="Shape Analysis" iconPosition="start" />
        </Tabs>
      </Box>
      
      {/* Tab Content */}
      <Box sx={{ minHeight: 300 }}>
        {activeTab === 0 && (
          <Box>
            {/* Chart Controls */}
            <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
              <ToggleButtonGroup
                value={logScale ? 'log' : 'linear'}
                exclusive
                onChange={(e, v) => setLogScale(v === 'log')}
                size="small"
                sx={{
                  '& .MuiToggleButton-root': {
                    textTransform: 'none',
                    fontSize: '0.813rem',
                    color: PWC_COLORS.mediumGray,
                    borderColor: PWC_COLORS.lightGray,
                    px: 2,
                    '&.Mui-selected': {
                      bgcolor: PWC_COLORS.orange,
                      color: PWC_COLORS.white,
                      '&:hover': {
                        bgcolor: '#B83F02'
                      }
                    }
                  }
                }}
              >
                <ToggleButton value="linear">Linear</ToggleButton>
                <ToggleButton value="log">Log Scale</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            
            {/* Histogram */}
            <HistogramChart 
              data={histogramData} 
              threshold={threshold}
              logScale={logScale}
            />
            
            {/* Legend & Help */}
            <Box 
              sx={{ 
                mt: 3, 
                p: 2, 
                bgcolor: '#FAFAFA', 
                borderRadius: 1,
                border: `1px solid ${PWC_COLORS.lightGray}`
              }}
            >
              <Typography 
                variant="caption" 
                sx={{ 
                  color: PWC_COLORS.mediumGray,
                  fontSize: '0.813rem',
                  lineHeight: 1.6
                }}
              >
                <strong>How to read this:</strong> Each bar represents a range of aggregated values. 
                Gray bars are suppressed (below threshold), orange bars are near-misses (within 10%), 
                and red bars will generate alerts.
              </Typography>
            </Box>
          </Box>
        )}
        
        {activeTab === 1 && (
          <DistributionTable bins={distributionTable} threshold={threshold} />
        )}
        
        {activeTab === 2 && (
          <DistributionShapeInsights shape={distributionShape} />
        )}
      </Box>
    </Box>
  );
};

export default DistributionIntelligencePanel;