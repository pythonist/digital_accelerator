// frontend/src/tools/calibration/components/AIExplanationBox.jsx
// PROFESSIONAL BANKING DESIGN - NO EMOJIS
import React, { useState } from 'react';
import {
  Box, Paper, Typography, IconButton, Collapse, Alert, CircularProgress, Chip
} from '@mui/material';
import {
  Psychology, ExpandMore, ExpandLess, Refresh, Info
} from '@mui/icons-material';
import apiClient from '@services/api';
import { useAppContext } from '@context/AppContext';

/**
 * Professional AI Explanation Component
 * Banking-grade design with no emojis
 * 
 * Usage:
 * <AIExplanationBox 
 *   runId={run.run_id}
 *   section="data_foundation"
 *   sectionData={reportData.data_foundation}
 *   title="Data Quality Impact Analysis"
 * />
 */
const AIExplanationBox = ({ 
  runId, 
  section, 
  sectionData, 
  title = "AI-Enhanced Analysis",
  defaultExpanded = false 
}) => {
  const { activeEnv } = useAppContext();
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hasGenerated, setHasGenerated] = useState(false);

  const generateExplanation = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiClient.post(
        `/api/v2/calibration/report/${runId}/ai-explanation`,
        {
          section: section,
          data: sectionData
        },
        {
          params: { env_id: activeEnv }
        }
      );

      if (res.success) {
        setExplanation(res.explanation);
        setHasGenerated(true);
        setExpanded(true);
      } else {
        setError(res.error || 'AI analysis unavailable');
      }
    } catch (err) {
      console.error('AI explanation failed:', err);
      setError(err.response?.data?.error || 'AI service temporarily unavailable');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!hasGenerated && !expanded) {
      generateExplanation();
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        border: '1px solid',
        borderColor: explanation ? '#9C27B0' : '#E0E0E0',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: explanation ? '#F3E5F5' : '#FAFAFA',
        transition: 'all 0.2s',
        '&:hover': {
          borderColor: explanation ? '#7B1FA2' : '#BDBDBD',
          bgcolor: explanation ? '#F3E5F5' : '#F5F5F5'
        }
      }}
    >
      {/* Header - Professional */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          bgcolor: expanded && explanation ? '#F3E5F5' : 'transparent',
          borderBottom: expanded ? '1px solid #E0E0E0' : 'none'
        }}
        onClick={handleToggle}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Psychology sx={{ fontSize: 22, color: '#7B1FA2' }} />
          <Box>
            <Typography variant="subtitle2" fontWeight="600" color="#4A148C">
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              AI-Powered Insight
            </Typography>
          </Box>
          {hasGenerated && (
            <Chip 
              label="Generated" 
              size="small" 
              sx={{ 
                ml: 1, 
                height: 20, 
                fontSize: '0.7rem',
                bgcolor: '#E1BEE7',
                color: '#4A148C',
                fontWeight: 600
              }} 
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasGenerated && !loading && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                generateExplanation();
              }}
              sx={{ 
                color: '#7B1FA2',
                '&:hover': { bgcolor: '#F3E5F5' }
              }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          )}
          
          {loading ? (
            <CircularProgress size={20} sx={{ color: '#7B1FA2' }} />
          ) : (
            <IconButton 
              size="small" 
              sx={{ 
                color: '#7B1FA2',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s'
              }}
            >
              <ExpandMore />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Content */}
      <Collapse in={expanded}>
        <Box sx={{ p: 2.5, pt: 2 }}>
          {error && (
            <Alert 
              severity="warning" 
              sx={{ mb: 2 }}
              icon={<Info />}
            >
              {error}
            </Alert>
          )}

          {explanation && (
            <Box>
              <Typography
                variant="body2"
                sx={{
                  lineHeight: 1.8,
                  color: '#37474F',
                  '& b': { fontWeight: 600, color: '#212121' },
                  '& i': { fontStyle: 'italic' },
                  '& strong': { fontWeight: 700, color: '#1565C0' }
                }}
                dangerouslySetInnerHTML={{ __html: explanation }}
              />
              <Box sx={{ 
                mt: 2, 
                pt: 2, 
                borderTop: '1px solid #E0E0E0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <Typography variant="caption" color="text.secondary" fontWeight="500">
                  Generated by AI Analytics Engine
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Click refresh icon to regenerate
                </Typography>
              </Box>
            </Box>
          )}

          {!explanation && !loading && !error && (
            <Box sx={{ 
              textAlign: 'center', 
              py: 3,
              color: 'text.secondary'
            }}>
              <Psychology sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                Click to generate AI-powered analysis
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Provides contextual insights and explanations
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default AIExplanationBox;