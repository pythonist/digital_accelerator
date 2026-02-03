// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/MergeOptionSelector.jsx
// ============================================================================
/**
 * Merge Option Selector
 * Lets user choose between Visual Builder (Smart Merge) or SQL Editor
 */
import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Button, Stack, Alert } from '@mui/material';
import { ViewList, Code, Storage } from '@mui/icons-material';

import LogicalMergeBuilder from './LogicalMergeBuilder';
import SQLJoinEditor from './SQLJoinEditor';

const MergeOptionSelector = ({ envId, onComplete }) => {
  const [selectedMode, setSelectedMode] = useState(null);

  if (selectedMode === 'builder') {
    return (
      <LogicalMergeBuilder 
        envId={envId}
        onComplete={onComplete}
        onSwitchToSQL={() => setSelectedMode('sql')}
      />
    );
  }

  if (selectedMode === 'sql') {
    return (
      <SQLJoinEditor 
        envId={envId}
        onComplete={onComplete}
        onSwitchToBuilder={() => setSelectedMode('builder')}
      />
    );
  }

  // Selection Screen
  return (
    <Box>
      <Alert 
        severity="info" 
        sx={{ 
          mb: 3, 
          bgcolor: '#dbeafe', 
          borderLeft: '4px solid #0284c7',
          '& .MuiAlert-icon': {
            color: '#0284c7'
          }
        }}
      >
        <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ color: '#1e293b' }}>
          Choose Your Merge Approach
        </Typography>
        <Typography variant="body2" sx={{ color: '#334155' }}>
          Select how you want to join your datasets. Both options produce preview-only results - 
          no physical tables are created.
        </Typography>
      </Alert>

      <Stack direction="row" spacing={3}>
        {/* Visual Builder Option */}
        <Card 
          sx={{ 
            flex: 1,
            border: '2px solid #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              borderColor: '#D04A02',
              boxShadow: 3,
              transform: 'translateY(-2px)'
            }
          }}
          onClick={() => setSelectedMode('builder')}
        >
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: '#fff7ed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2
              }}
            >
              <ViewList sx={{ fontSize: 40, color: '#D04A02' }} />
            </Box>
            
            <Typography variant="h6" fontWeight={700} gutterBottom sx={{ color: '#1e293b' }}>
              Visual Builder
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, px: 2 }}>
              Smart Merge interface with drag-and-drop join configuration. 
              Perfect for users who prefer a visual approach.
            </Typography>

            <Stack spacing={1} sx={{ textAlign: 'left', mb: 3, px: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Visual join chain</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Auto-suggest join keys</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Interactive preview</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Join type selection</Typography>
              </Stack>
            </Stack>

            <Button 
              variant="contained"
              fullWidth
              sx={{ 
                bgcolor: '#D04A02', 
                '&:hover': { bgcolor: '#B23D01' },
                fontWeight: 600
              }}
            >
              Use Visual Builder
            </Button>
          </CardContent>
        </Card>

        {/* SQL Editor Option */}
        <Card 
          sx={{ 
            flex: 1,
            border: '2px solid #e2e8f0',
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              borderColor: '#0284c7',
              boxShadow: 3,
              transform: 'translateY(-2px)'
            }
          }}
          onClick={() => setSelectedMode('sql')}
        >
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2
              }}
            >
              <Code sx={{ fontSize: 40, color: '#0284c7' }} />
            </Box>
            
            <Typography variant="h6" fontWeight={700} gutterBottom sx={{ color: '#1e293b' }}>
              SQL Editor
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, px: 2 }}>
              Write custom SQL queries for complete control over joins.
              Ideal for users comfortable with SQL.
            </Typography>

            <Stack spacing={1} sx={{ textAlign: 'left', mb: 3, px: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Full SQL control</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Custom join logic</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Validation & suggestions</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981' }} />
                <Typography variant="caption" sx={{ color: '#334155' }}>Syntax highlighting</Typography>
              </Stack>
            </Stack>

            <Button 
              variant="contained"
              fullWidth
              sx={{ 
                bgcolor: '#0284c7', 
                '&:hover': { bgcolor: '#0369a1' },
                fontWeight: 600
              }}
            >
              Use SQL Editor
            </Button>
          </CardContent>
        </Card>
      </Stack>

      {/* Skip Option */}
      <Card sx={{ mt: 3, bgcolor: '#f8fafc' }} elevation={0}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
            <Storage sx={{ fontSize: 20, color: '#64748b' }} />
            <Typography variant="body2" color="text.secondary">
              Working with a single dataset? You can{' '}
              <Button 
                size="small" 
                onClick={() => onComplete && onComplete()}
                sx={{ 
                  textTransform: 'none', 
                  color: '#D04A02', 
                  fontWeight: 600,
                  minWidth: 'auto',
                  p: 0,
                  '&:hover': {
                    bgcolor: 'transparent',
                    textDecoration: 'underline'
                  }
                }}
              >
                skip this step
              </Button>
              {' '}and proceed to validation.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default MergeOptionSelector;