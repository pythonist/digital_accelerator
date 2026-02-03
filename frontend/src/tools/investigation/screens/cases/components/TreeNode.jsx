import React, { useState, useCallback } from 'react';
import { Box, Paper, IconButton, Typography, Stack, Collapse } from '@mui/material';
import {
  ExpandMore as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  CheckCircle as CheckIcon,
  Flag as FlagIcon,
} from '@mui/icons-material';

import { getIconForType, getStyleForType } from '../utils/treeIcons';
import {
  getNodeStyling,
  getIconContainerStyling,
  getConnectorStyling,
  getConnectorPosition,
  getExpanderStyling,
  getLabelStyling,
  getNodeTypeIcon, // ✅ USE ICON, NOT EMOJI
} from '../utils/treeStyles';

const TreeNode = React.memo(
  ({ node, level, onSelect, selectedId, reviewedNodes, flaggedNodes }) => {
    const defaultExpanded = node.metadata?.expand_default !== false;
    const [expanded, setExpanded] = useState(defaultExpanded);

    const hasChildren = node.children && node.children.length > 0;
    const isSelected = node.id === selectedId;
    const isReviewed = reviewedNodes.has(node.id);
    const isFlagged = flaggedNodes.has(node.id);
    const isEvidence = node.metadata?.is_evidence;

    const handleClick = useCallback(
      (e) => {
        e.stopPropagation();
        onSelect(node);
      },
      [node, onSelect]
    );

    const handleToggle = useCallback((e) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    }, []);

    const typeStyle = getStyleForType(node.type);
    const nodeStyling = getNodeStyling({
      isSelected,
      isEvidence,
      isFlagged,
      level,
    });
    const iconStyling = getIconContainerStyling(typeStyle);

    return (
      <Box sx={{ position: 'relative' }}>
        {/* NODE ROW */}
        <Paper onClick={handleClick} elevation={0} sx={nodeStyling}>
          {/* EXPANDER */}
          <IconButton size="small" onClick={handleToggle} sx={getExpanderStyling()}>
            {hasChildren ? (
              expanded ? (
                <ChevronDownIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )
            ) : (
              <Box sx={{ width: 20, height: 20 }} />
            )}
          </IconButton>

          {/* TYPE ICON */}
          <Paper elevation={0} sx={iconStyling}>
            {getIconForType(node.type, 16)}
          </Paper>

          {/* CONTENT */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {/* ✅ PROFESSIONAL NODE TYPE ICON */}
              {getNodeTypeIcon(node.type)}

              <Typography
                variant="body2"
                fontWeight="bold"
                color={isSelected ? 'primary.main' : 'text.primary'}
              >
                {node.type}
              </Typography>

              {isReviewed && (
                <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
              )}
              {isFlagged && (
                <FlagIcon sx={{ fontSize: 16, color: 'warning.main' }} />
              )}
            </Stack>

            <Typography
              variant="caption"
              sx={getLabelStyling(isSelected)}
            >
              {node.label}
            </Typography>
          </Box>
        </Paper>

        {/* CHILDREN */}
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {hasChildren && (
            <Box sx={{ position: 'relative' }}>
              <Box
                sx={{
                  ...getConnectorPosition(level),
                  ...getConnectorStyling(isEvidence),
                }}
              />
              {node.children.map((child, i) => (
                <TreeNode
                  key={i}
                  node={child}
                  level={level + 1}
                  onSelect={onSelect}
                  selectedId={selectedId}
                  reviewedNodes={reviewedNodes}
                  flaggedNodes={flaggedNodes}
                />
              ))}
            </Box>
          )}
        </Collapse>
      </Box>
    );
  }
);

export default TreeNode;