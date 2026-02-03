// frontend/src/screens/cases/components/EvidenceTreeView.jsx
import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { Layers as LayersIcon } from '@mui/icons-material';
import TreeNode from './TreeNode';

const EvidenceTreeView = ({ treeData, onNodeSelect, selectedNodeId, reviewedNodes, flaggedNodes }) => {
  return (
    <Paper 
      elevation={0}
      sx={{ 
        p: 3, 
        borderRadius: 2, 
        border: '2px solid #e0e0e0', 
        overflowY: 'auto',
        bgcolor: 'white',
        position: 'relative'
      }}
    >
      {treeData ? (
        <TreeNode 
          node={treeData} 
          level={0} 
          onSelect={onNodeSelect} 
          selectedId={selectedNodeId} 
          reviewedNodes={reviewedNodes}
          flaggedNodes={flaggedNodes}
        />
      ) : (
        <Box sx={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          minHeight: 400
        }}>
          <Box sx={{ 
            width: 80, 
            height: 80, 
            bgcolor: '#f5f5f5', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            border: '1px solid #e0e0e0',
            mb: 3
          }}>
            <LayersIcon sx={{ fontSize: 40, color: '#bdbdbd' }} />
          </Box>
          <Typography variant="h6" fontWeight="bold" color="text.secondary" gutterBottom>
            Enter an Entity ID
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Trace evidence provenance and verify system computations
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

export default EvidenceTreeView;