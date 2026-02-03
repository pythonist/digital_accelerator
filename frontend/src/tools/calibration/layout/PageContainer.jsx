import React from 'react';
import { Box, Typography, Breadcrumbs } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';

const PageContainer = ({ 
  title, 
  subtitle,
  breadcrumbs = [], 
  actions, 
  children,
  fullHeight = true 
}) => {
  return (
    <Box 
      sx={{ 
        display: 'flex',
        flexDirection: 'column',
        height: fullHeight ? '100%' : 'auto',
        minHeight: '100%',
      }}
    >
      {/* Clean Header - No background colors */}
      <Box 
        sx={{ 
          px: 4,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {breadcrumbs.length > 0 && (
            <Breadcrumbs 
              separator={<ChevronRight sx={{ fontSize: 14, color: 'text.disabled' }} />}
              sx={{ mb: 1 }}
            >
              {breadcrumbs.map((crumb, idx) => (
                <Typography 
                  key={idx}
                  variant="caption"
                  sx={{ 
                    color: 'text.secondary',
                    fontWeight: 400,
                    textTransform: 'uppercase',
                    fontSize: '0.6875rem',
                  }}
                >
                  {crumb}
                </Typography>
              ))}
            </Breadcrumbs>
          )}
          
          <Typography 
            variant="h5" 
            sx={{ 
              fontWeight: 500, // Fixed from 600
              color: 'text.primary',
              mb: subtitle ? 0.5 : 0
            }}
          >
            {title}
          </Typography>
          
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        
        {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, p: 4, overflow: 'auto' }}>
        {children}
      </Box>
    </Box>
  );
};

export default PageContainer;