// frontend/src/tools/investigation/components/FormattedMarkdown.jsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box, Table, TableCell, TableContainer, TableHead, Paper } from '@mui/material';

export const FormattedMarkdown = ({ content, sx = {} }) => {
  if (!content) return null;

  return (
    <Box
      sx={{
        '& h1, & h2, & h3, & h4': {
          color: '#0f172a',
          fontWeight: 800,
          mt: 2,
          mb: 1.25,
          lineHeight: 1.3
        },
        '& h1': { fontSize: '1.2rem' },
        '& h2': { fontSize: '1.05rem' },
        '& h3': { 
          fontSize: '0.95rem',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: '1px solid #f1f5f9',
          pb: 0.75,
          mt: 2
        },
        '& h4': { fontSize: '0.88rem' },
        '& p': {
          fontSize: '0.86rem',
          lineHeight: 1.7,
          color: '#334155',
          mb: 1.25
        },
        '& strong': {
          color: '#0f172a',
          fontWeight: 700
        },
        '& ul, & ol': {
          pl: 2.5,
          mb: 1.5,
          mt: 0.5
        },
        '& li': {
          fontSize: '0.86rem',
          lineHeight: 1.65,
          color: '#334155',
          mb: 0.75
        },
        '& li strong': {
          color: '#0f172a'
        },
        '& blockquote': {
          borderLeft: '3px solid #2563eb',
          bgcolor: '#eff6ff',
          p: 1.5,
          my: 1.5,
          borderRadius: '0 8px 8px 0',
          '& p': { mb: 0, color: '#1e40af', fontWeight: 500 }
        },
        '& code': {
          bgcolor: '#f1f5f9',
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          color: '#0f172a'
        },
        ...sx
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node, ...props }) => (
            <TableContainer component={Paper} variant="outlined" sx={{ my: 2, borderRadius: 1.5, borderColor: '#e2e8f0' }}>
              <Table size="small" {...props} />
            </TableContainer>
          ),
          thead: ({ node, ...props }) => (
            <TableHead sx={{ bgcolor: '#f8fafc' }} {...props} />
          ),
          th: ({ node, ...props }) => (
            <TableCell sx={{ fontWeight: 800, fontSize: '0.78rem', color: '#0f172a', py: 1 }} {...props} />
          ),
          td: ({ node, ...props }) => (
            <TableCell sx={{ fontSize: '0.8rem', color: '#334155', py: 0.8 }} {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
};

export default FormattedMarkdown;
