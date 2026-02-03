// frontend/src/screens/cases/utils/treeStyles.js
import React from 'react';
import {
  Functions as RuleIcon,
  AccountTree as LineageIcon,
  ViewColumn as ColumnIcon,
  FilterAlt as FilterIcon,
  Calculate as AggregationIcon,
  Warning as WarningIcon,
  DataObject as DerivedFieldIcon,
} from '@mui/icons-material';

/**
 * Tree Styling Utilities
 * Provides consistent styling logic for tree nodes based on their state and type
 */

/**
 * Get priority styling for evidence nodes
 * @param {boolean} isEvidence - Whether node is evidence type
 * @param {boolean} isFlagged - Whether node is flagged
 * @returns {object} MUI sx props
 */
export const getPriorityStyling = (isEvidence, isFlagged) => {
  let styles = {};

  if (isEvidence) {
    styles = {
      borderColor: '#1976d2',
      borderWidth: 2,
      boxShadow: '0 2px 4px rgba(25, 118, 210, 0.1)'
    };
  }

  if (isFlagged) {
    styles = {
      ...styles,
      bgcolor: '#fff3e0',
      borderColor: '#ff9800',
      boxShadow: '0 2px 4px rgba(255, 152, 0, 0.2)'
    };
  }

  return styles;
};

/**
 * Get selection styling for tree nodes
 * @param {boolean} isSelected - Whether node is currently selected
 * @returns {object} MUI sx props
 */
export const getSelectionStyling = (isSelected) => {
  if (!isSelected) return {};

  return {
    bgcolor: '#e3f2fd',
    borderColor: '#1976d2',
    borderWidth: 2,
    boxShadow: '0 0 0 3px rgba(25, 118, 210, 0.1)'
  };
};

/**
 * Get hover styling for tree nodes
 * @param {boolean} isSelected - Whether node is currently selected
 * @returns {object} MUI sx props for hover state
 */
export const getHoverStyling = (isSelected) => {
  return {
    bgcolor: isSelected ? '#e3f2fd' : '#fafafa',
    borderColor: isSelected ? '#1976d2' : '#e0e0e0'
  };
};

/**
 * Get connector line styling based on evidence status
 * @param {boolean} isEvidence - Whether parent node is evidence
 * @returns {object} MUI sx props
 */
export const getConnectorStyling = (isEvidence) => {
  return {
    bgcolor: isEvidence ? '#1976d2' : '#e0e0e0',
    width: 2,
    borderRadius: 1
  };
};

/**
 * Get complete node styling (combines all style functions)
 * @param {object} params - Styling parameters
 * @param {boolean} params.isSelected - Node selection state
 * @param {boolean} params.isEvidence - Node evidence type
 * @param {boolean} params.isFlagged - Node flagged state
 * @param {number} params.level - Tree depth level
 * @returns {object} Complete MUI sx props
 */
export const getNodeStyling = ({ isSelected, isEvidence, isFlagged, level }) => {
  const baseStyling = {
    ml: level * 4,
    mb: 1,
    p: 1.5,
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    cursor: 'pointer',
    border: '2px solid',
    borderColor: 'transparent',
    borderRadius: 1.5,
    transition: 'all 0.2s',
    position: 'relative',
    zIndex: 1
  };

  const prioritySx = getPriorityStyling(isEvidence, isFlagged);
  const selectionSx = getSelectionStyling(isSelected);
  const hoverSx = { '&:hover': getHoverStyling(isSelected) };

  return {
    ...baseStyling,
    ...selectionSx,
    ...prioritySx,
    ...hoverSx
  };
};

/**
 * Get icon container styling
 * @param {object} typeStyle - Style from getStyleForType
 * @returns {object} MUI sx props
 */
export const getIconContainerStyling = (typeStyle) => {
  return {
    p: 0.75,
    borderRadius: 1,
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 1,
    ...typeStyle
  };
};

/**
 * Get evidence strength color
 * @param {string} strength - STRONG | MODERATE | WEAK | INSUFFICIENT
 * @returns {string} MUI color name
 */
export const getEvidenceStrengthColor = (strength) => {
  const colorMap = {
    'STRONG': 'success',
    'MODERATE': 'warning',
    'WEAK': 'error',
    'INSUFFICIENT': 'error'
  };

  return colorMap[strength] || 'default';
};

/**
 * Get data completeness color
 * @param {string} completeness - COMPLETE | PARTIAL | INCOMPLETE
 * @returns {string} MUI color name
 */
export const getDataCompletenessColor = (completeness) => {
  const colorMap = {
    'COMPLETE': 'success',
    'PARTIAL': 'warning',
    'INCOMPLETE': 'error'
  };

  return colorMap[completeness] || 'default';
};

/**
 * Get node type icon component
 * @param {string} type - Node type
 * @returns {JSX.Element|null} React icon component or null
 */
export const getNodeTypeIcon = (type) => {
  const props = {
    sx: { fontSize: 16, color: 'text.secondary' },
  };

  switch (type) {
    case 'DerivedField':
      return React.createElement(DerivedFieldIcon, props);

    case 'Rule':
      return React.createElement(RuleIcon, props);

    case 'SourceColumn':
      return React.createElement(ColumnIcon, props);

    case 'Filter':
      return React.createElement(FilterIcon, props);

    case 'Aggregation':
      return React.createElement(AggregationIcon, props);

    case 'Lineage':
      return React.createElement(LineageIcon, props);

    case 'DataQualityWarning':
      return React.createElement(WarningIcon, {
        sx: { ...props.sx, color: 'warning.main' },
      });

    default:
      return null;
  }
};

/**
 * Get label styling based on selection state
 * @param {boolean} isSelected - Whether node is selected
 * @returns {object} Typography sx props
 */
export const getLabelStyling = (isSelected) => {
  return {
    display: 'block',
    maxWidth: 400,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    color: isSelected ? 'primary.main' : 'text.secondary'
  };
};

/**
 * Get expander button styling
 * @returns {object} MUI sx props
 */
export const getExpanderStyling = () => {
  return {
    width: 28,
    height: 28,
    '&:hover': { bgcolor: 'action.hover' }
  };
};

/**
 * Animation keyframes for evidence node pulse effect
 */
export const evidencePulseKeyframes = {
  '@keyframes evidencePulse': {
    '0%': {
      boxShadow: '0 0 0 0 rgba(25, 118, 210, 0.4)'
    },
    '70%': {
      boxShadow: '0 0 0 10px rgba(25, 118, 210, 0)'
    },
    '100%': {
      boxShadow: '0 0 0 0 rgba(25, 118, 210, 0)'
    }
  }
};

/**
 * Get pulse animation styling (for first-time load)
 * @param {boolean} shouldPulse - Whether to apply pulse animation
 * @returns {object} MUI sx props with animation
 */
export const getPulseAnimation = (shouldPulse) => {
  if (!shouldPulse) return {};

  return {
    animation: 'evidencePulse 2s ease-in-out 3',
    ...evidencePulseKeyframes
  };
};

/**
 * Get connector line positioning
 * @param {number} level - Tree depth level
 * @returns {object} MUI sx props for absolute positioning
 */
export const getConnectorPosition = (level) => {
  return {
    position: 'absolute',
    left: (level * 4) + 3.25,
    top: 0,
    bottom: 2,
    zIndex: 0
  };
};

/**
 * Get empty state container styling
 * @returns {object} MUI sx props
 */
export const getEmptyStateStyling = () => {
  return {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 400
  };
};

/**
 * Get empty state icon container styling
 * @returns {object} MUI sx props
 */
export const getEmptyStateIconStyling = () => {
  return {
    width: 80,
    height: 80,
    bgcolor: '#f5f5f5',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #e0e0e0',
    mb: 3
  };
};