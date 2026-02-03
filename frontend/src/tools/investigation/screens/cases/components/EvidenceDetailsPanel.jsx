// frontend/src/screens/cases/components/EvidenceDetailsPanel.jsx
import React from 'react';
import { Box, Paper, Typography, Stack, IconButton, Alert, Chip, Button } from '@mui/material';
import { 
  Close as CloseIcon, 
  Flag as FlagIcon, 
  Download as DownloadIcon,
  Warning as AlertTriangleIcon,
  Storage as DatabaseIcon
} from '@mui/icons-material';
import { getIconForType, getStyleForType } from '../utils/treeIcons';

const EvidenceDetailsPanel = ({ node, onClose, isFlagged, onToggleFlag }) => {
  return (
    <Paper 
      elevation={4}
      sx={{ 
        borderRadius: 2, 
        border: '2px solid #e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'white'
      }}
    >
      {/* Header */}
      <Box sx={{ 
        p: 2.5, 
        bgcolor: '#fafafa', 
        borderBottom: '2px solid #e0e0e0',
        flexShrink: 0
      }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Stack direction="row" spacing={2} alignItems="center">
            <Paper 
              elevation={0}
              sx={{ 
                p: 1.5, 
                borderRadius: 1.5,
                border: '2px solid',
                ...getStyleForType(node.type)
              }}
            >
              {getIconForType(node.type)}
            </Paper>
            <Box>
              <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                {node.type}
              </Typography>
              <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
                {node.id}
              </Typography>
            </Box>
          </Stack>
          <IconButton 
            onClick={onClose}
            size="small"
            sx={{ '&:hover': { bgcolor: 'action.hover' } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      {/* Content - Scrollable */}
      <Box sx={{ p: 2.5, overflowY: 'auto', flexGrow: 1 }}>
        {/* Label Section */}
        {node.label && (
          <Alert 
            severity={node.type === 'DataQualityWarning' ? 'warning' : 'info'}
            icon={node.type === 'DataQualityWarning' ? <AlertTriangleIcon /> : <DatabaseIcon />}
            sx={{ mb: 3, border: '2px solid', borderColor: node.type === 'DataQualityWarning' ? 'warning.light' : 'info.light' }}
          >
            <Typography variant="caption" fontWeight="bold" display="block" sx={{ textTransform: 'uppercase', mb: 0.5, fontSize: '0.7rem' }}>
              {node.type === 'DerivedField' ? 'Computation' : 
               node.type === 'Rule' ? 'Rule Logic' :
               node.type === 'DataQualityWarning' ? 'Data Quality Issue' :
               'Descriptor'}
            </Typography>
            <Typography variant="body2">
              {node.label}
            </Typography>
          </Alert>
        )}

        {/* Evidence Strength Badge */}
        {node.details?.evidence_strength && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 1 }}>
              Evidence Strength
            </Typography>
            <Chip 
              label={node.details.evidence_strength}
              size="small"
              color={
                node.details.evidence_strength === 'STRONG' ? 'success' :
                node.details.evidence_strength === 'MODERATE' ? 'warning' : 'error'
              }
              sx={{ fontWeight: 'bold' }}
            />
          </Box>
        )}
        {/* Freshness Badge (for metrics) */}
        {node.details?.value_freshness && (
        <Box sx={{ mb: 2 }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 1 }}>
            Value Freshness
            </Typography>
            <Chip 
            label={node.details.value_freshness.toUpperCase()}
            size="small"
            color={
                node.details.value_freshness === 'realtime' ? 'success' :
                node.details.value_freshness === 'cached' ? 'info' : 'default'
            }
            sx={{ fontWeight: 'bold' }}
            />
            {node.details.value_freshness === 'cached' && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Pre-computed value from earlier analysis
            </Typography>
            )}
            {node.details.value_freshness === 'unavailable' && (
            <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>
                Metric could not be computed - check join paths
            </Typography>
            )}
        </Box>
        )}
        {/* Attributes */}
        <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 2, display: 'block', pb: 1, borderBottom: '2px solid #e0e0e0', fontSize: '0.7rem' }}>
          {node.type === 'Rule' ? 'Rule Details' :
           node.type === 'DerivedField' ? 'Computation Details' :
           'Attributes'}
        </Typography>
        
        <Paper variant="outlined" sx={{ border: '2px solid #e0e0e0', borderRadius: 1, overflow: 'hidden' }}>
          {node.details && Object.entries(node.details).length > 0 ? (
            Object.entries(node.details).map(([k, v], i) => (
              <Box 
                key={k} 
                sx={{ 
                  display: 'flex',
                  px: 2,
                  py: 1.5,
                  borderBottom: '1px solid #f5f5f5',
                  '&:last-child': { borderBottom: 'none' },
                  bgcolor: i % 2 === 0 ? 'white' : '#fafafa'
                }}
              >
                <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ width: '40%', textTransform: 'capitalize', fontSize: '0.75rem' }}>
                  {k.replace(/_/g, ' ')}
                </Typography>
                <Typography variant="body2" fontWeight="600" sx={{ width: '60%', wordBreak: 'break-word', fontSize: '0.875rem' }}>
                  {v !== null && v !== undefined ? String(v) : '-'}
                </Typography>
              </Box>
            ))
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.disabled">
                No additional details available
              </Typography>
            </Box>
          )}
        </Paper>
      </Box>

      {/* Actions Footer */}
      <Box sx={{ 
        p: 2, 
        borderTop: '2px solid #e0e0e0', 
        bgcolor: '#fafafa',
        flexShrink: 0
      }}>
        <Stack direction="row" spacing={1.5}>
          {node.metadata?.is_evidence && (
            <Button
              fullWidth
              variant={isFlagged ? 'contained' : 'outlined'}
              color="warning"
              startIcon={<FlagIcon />}
              onClick={onToggleFlag}
              sx={{ fontWeight: 'bold', borderWidth: 2, '&:hover': { borderWidth: 2 } }}
            >
              {isFlagged ? 'Flagged' : 'Flag Weak Evidence'}
            </Button>
          )}
          <Button
            fullWidth
            variant="contained"
            startIcon={<DownloadIcon />}
            sx={{ fontWeight: 'bold', boxShadow: 2 }}
          >
            Export Audit Log
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
};

export default EvidenceDetailsPanel;