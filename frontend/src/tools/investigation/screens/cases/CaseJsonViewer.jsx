// frontend/src/screens/cases/CaseJsonViewer.jsx
import React, { useState } from 'react';
import { 
  Box, Paper, Typography, Stack, Button, IconButton, Collapse, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
  ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { 
  ExpandMore as ExpandMoreIcon, 
  ChevronRight as ChevronRightIcon, 
  ContentCopy as CopyIcon,
  Code as CodeIcon,
  TableChart as TableIcon,
  DataObject as JsonIcon
} from '@mui/icons-material';

// --- HELPER: Recursively Render Table Rows ---
const TableRowRenderer = ({ label, value, level = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  
  // Determine Type
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  const isEmpty = isObject && Object.keys(value).length === 0;
  const isPrimitive = !isObject;

  // Formatting Primitive Values
  const renderPrimitive = (val) => {
    if (typeof val === 'boolean') return val ? <Chip label="True" color="success" size="small" sx={{ height: 20 }}/> : <Chip label="False" color="error" size="small" sx={{ height: 20 }}/>;
    if (typeof val === 'number') return <Typography fontFamily="monospace" color="primary.main">{val.toLocaleString()}</Typography>;
    return <Typography fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>{String(val)}</Typography>;
  };

  // If Primitive, Render Simple Row
  if (isPrimitive) {
    return (
      <TableRow hover>
        <TableCell sx={{ pl: 2 + (level * 3), width: '30%', color: 'text.secondary', verticalAlign: 'top' }}>{label}</TableCell>
        <TableCell>{renderPrimitive(value)}</TableCell>
      </TableRow>
    );
  }

  // If Object/Array, Render Header Row + Expandable Children
  return (
    <>
      <TableRow hover selected sx={{ bgcolor: level === 0 ? '#f5f5f5' : 'transparent' }}>
        <TableCell 
          colSpan={2} 
          onClick={() => setExpanded(!expanded)} 
          sx={{ 
            cursor: 'pointer', 
            pl: 2 + (level * 3),
            py: 1,
            fontWeight: 'bold',
            color: '#1565c0'
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            <Typography variant="body2" fontWeight="bold">
              {label} 
              <span style={{ fontWeight: 'normal', color: '#757575', marginLeft: 8 }}>
                 {isArray ? `(${value.length} items)` : isEmpty ? '(Empty)' : ''}
              </span>
            </Typography>
          </Stack>
        </TableCell>
      </TableRow>
      
      {expanded && !isEmpty && Object.entries(value).map(([key, val]) => (
        <TableRowRenderer key={key} label={key} value={val} level={level + 1} />
      ))}
    </>
  );
};

// --- HELPER: Raw JSON Tree (Your Original View) ---
const JsonTree = ({ data, level = 0 }) => {
    // ... (Keep your existing JsonTree logic here or simplified version below) ...
    // Using a simple pre-formatted block for the "Raw" view to save space in this snippet
    return (
        <Box 
            component="pre" 
            sx={{ 
                m: 0, p: 2, 
                fontFamily: 'monospace', 
                fontSize: '0.8rem', 
                bgcolor: '#263238', 
                color: '#eceff1', 
                borderRadius: 2,
                overflowX: 'auto'
            }}
        >
            {JSON.stringify(data, null, 2)}
        </Box>
    );
};

// --- MAIN COMPONENT ---
const CaseJsonViewer = ({ casePack }) => {
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'raw'

  const handleCopyAll = () => {
    if (casePack) navigator.clipboard.writeText(JSON.stringify(casePack, null, 2));
  };

  if (!casePack) {
    return (
      <Box sx={{ p: 5, textAlign: 'center', color: 'text.disabled' }}>
        <CodeIcon sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} />
        <Typography>No Data Loaded</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4, height: '100%', overflowY: 'auto', bgcolor: '#f8f9fa' }}>
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, bgcolor: 'white', maxWidth: 1200, mx: 'auto' }}>
        
        {/* Header Controls */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ p: 1, bgcolor: '#e3f2fd', borderRadius: 1, color: 'primary.main' }}>
              <CodeIcon />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight="bold">Intelligence Pack Inspector</Typography>
              <Typography variant="body2" color="text.secondary">
                {viewMode === 'table' ? 'Structured Data View' : 'Raw JSON Source'}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={2}>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(e, newMode) => newMode && setViewMode(newMode)}
              size="small"
            >
              <ToggleButton value="table" sx={{ gap: 1 }}>
                <TableIcon fontSize="small" /> Table
              </ToggleButton>
              <ToggleButton value="raw" sx={{ gap: 1 }}>
                <JsonIcon fontSize="small" /> Raw JSON
              </ToggleButton>
            </ToggleButtonGroup>
            
            <Button startIcon={<CopyIcon />} variant="outlined" size="small" onClick={handleCopyAll}>
              Copy Data
            </Button>
          </Stack>
        </Stack>
        
        <Divider sx={{ mb: 0 }} />

        {/* View Switcher */}
        {viewMode === 'table' ? (
          <TableContainer>
            <Table size="small">
              <TableBody>
                {/* Prioritize Metadata at the top */}
                {casePack.metadata && (
                    <TableRowRenderer label="METADATA" value={casePack.metadata} />
                )}
                {/* Render everything else */}
                {Object.entries(casePack).map(([key, val]) => {
                    if (key === 'metadata') return null; // Already rendered
                    return <TableRowRenderer key={key} label={key.toUpperCase().replace('_', ' ')} value={val} />;
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <JsonTree data={casePack} />
        )}

      </Paper>
    </Box>
  );
};

export default CaseJsonViewer;