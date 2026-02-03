// frontend/src/screens/cases/AiReviewPanel.jsx
import React, { useState } from 'react';
import { Box, Paper, Typography, Button, CircularProgress, Alert, List, ListItem, ListItemText, ListItemIcon } from '@mui/material';
import { HelpOutline as QuestionIcon, AutoAwesome as SparklesIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import apiClient from '@services/api';

const AiReviewPanel = ({ caseId }) => {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generateQuestions = async () => {
    if (!caseId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await apiClient.post('/api/v2/llm/review-questions', {
        case_id: caseId,
        model: 'llama3.2:1b'
      });
      
      if (res.success) {
        setQuestions(res.questions);
      } else {
        setError(res.error || 'Failed to generate questions');
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
            <Typography variant="h6" fontWeight="bold">AI Review Questions</Typography>
            <Typography variant="body2" color="text.secondary">
              Critical questions a regulator might ask
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : questions.length > 0 ? <RefreshIcon /> : <SparklesIcon />}
            onClick={generateQuestions}
            disabled={loading}
            sx={{ fontWeight: 'bold' }}
          >
            {loading ? 'Generating...' : questions.length > 0 ? 'Regenerate' : 'Generate Questions'}
          </Button>
        </Box>

        {/* Content */}
        <Box sx={{ p: 4 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {questions.length === 0 && !loading && !error && (
            <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
              <QuestionIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1" fontWeight="500">
                Click "Generate Questions" to prepare for review
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                AI will generate critical questions regulators might ask
              </Typography>
            </Box>
          )}

          {questions.length > 0 && (
            <List sx={{ bgcolor: '#fafafa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
              {questions.map((q, i) => (
                <ListItem
                  key={i}
                  sx={{
                    borderBottom: i < questions.length - 1 ? '1px solid #e0e0e0' : 'none',
                    py: 2.5,
                    '&:hover': { bgcolor: '#f5f5f5' }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '0.75rem'
                      }}
                    >
                      {i + 1}
                    </Box>
                  </ListItemIcon>
                  <ListItemText
                    primary={q}
                    primaryTypographyProps={{
                      fontWeight: 500,
                      fontSize: '0.95rem',
                      lineHeight: 1.6
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        {/* Footer Note */}
        <Box sx={{ p: 2, borderTop: '1px solid #e0e0e0', bgcolor: '#fffbf0' }}>
          <Typography variant="caption" color="warning.dark" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <SparklesIcon sx={{ fontSize: 14 }} />
            AI-generated questions. Analyst determines answers and actions.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default AiReviewPanel;