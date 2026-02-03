// frontend/src/screens/cases/AiExplainPanel.jsx
import React, { useState } from 'react';
import { Box, Paper, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { AutoAwesome as SparklesIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import apiClient from '@services/api';

const AiExplainPanel = ({ caseId }) => {
  const [explanation, setExplanation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generateExplanation = async () => {
    if (!caseId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await apiClient.post('/api/v2/llm/explain-case', {
        case_id: caseId,
        model: 'llama3.2:1b'
      });
      
      if (res.success) {
        setExplanation(res.explanation);
      } else {
        setError(res.error || 'Failed to generate explanation');
      }
    } catch (e) {
      setError(e.message || 'AI service unavailable');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1000, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Header */}
        <Box sx={{ p: 3, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6" fontWeight="bold">AI Case Explanation</Typography>
            <Typography variant="body2" color="text.secondary">
              Analyst-style narrative based on case metrics
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : explanation ? <RefreshIcon /> : <SparklesIcon />}
            onClick={generateExplanation}
            disabled={loading}
            sx={{ fontWeight: 'bold' }}
          >
            {loading ? 'Generating...' : explanation ? 'Regenerate' : 'Generate Explanation'}
          </Button>
        </Box>

        {/* Content */}
        <Box sx={{ p: 4 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {!explanation && !loading && !error && (
            <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
              <SparklesIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1" fontWeight="500">
                Click "Generate Explanation" to analyze this case
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                AI will explain patterns and metrics in analyst-appropriate language
              </Typography>
            </Box>
          )}

          {explanation && (
            <Paper elevation={0} sx={{ p: 3, bgcolor: '#fafafa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
              <Typography
                variant="body1"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                  fontFamily: 'Georgia, serif',
                  fontSize: '0.95rem',
                  color: 'text.primary'
                }}
              >
                {explanation}
              </Typography>
            </Paper>
          )}
        </Box>

        {/* Footer Note */}
        <Box sx={{ p: 2, borderTop: '1px solid #e0e0e0', bgcolor: '#fffbf0' }}>
          <Typography variant="caption" color="warning.dark" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <SparklesIcon sx={{ fontSize: 14 }} />
            AI-generated content. Analyst retains full investigative authority.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default AiExplainPanel;