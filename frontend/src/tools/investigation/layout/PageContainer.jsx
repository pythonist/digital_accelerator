import React, { useEffect, useRef } from 'react';
import { Box, Typography, Breadcrumbs } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import apiClient from '@services/api';

const PageContainer = ({ 
  title, 
  subtitle, 
  breadcrumbs = [], 
  actions, 
  children 
}) => {
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    apiClient.logSessionEvent({
      event_type: 'screen_visited',
      screen: title,
      breadcrumbs,
      path: window.location.pathname,
      started_at: new Date(startedAt).toISOString(),
    });
    return () => {
      const endedAt = Date.now();
      apiClient.logSessionEvent({
        event_type: 'screen_left',
        screen: title,
        path: window.location.pathname,
        started_at: new Date(startedAtRef.current).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        duration_ms: Math.max(0, endedAt - startedAtRef.current),
      });
    };
  }, [title]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      
      {/* CONTENT TITLE BAR */}
      <Box 
        sx={{ 
          px: { xs: 1.5, sm: 2, md: 3 }, 
          py: { xs: 1, sm: 1.25, md: 1.5 }, 
          bgcolor: 'background.paper', 
          borderBottom: '1px solid', 
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            {/* Breadcrumbs: Compact and faded */}
            {breadcrumbs.length > 0 && (
              <Breadcrumbs 
                separator={<ChevronRight sx={{ fontSize: 13, color: 'text.disabled' }} />} 
                sx={{ mb: 0.25, '& .MuiBreadcrumbs-ol': { alignItems: 'center' } }}
              >
                {breadcrumbs.map((crumb, idx) => (
                  <Typography 
                    key={idx} 
                    variant="caption" 
                    sx={{ color: 'text.secondary', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.04em' }}
                  >
                    {crumb.toUpperCase()}
                  </Typography>
                ))}
              </Breadcrumbs>
            )}
            
            <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', lineHeight: 1.2, fontSize: { xs: '0.95rem', sm: '1.05rem', md: '1.15rem' } }}>
              {title}
            </Typography>
            
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontSize: { xs: '0.72rem', sm: '0.78rem' }, lineHeight: 1.3 }}>
                {subtitle}
              </Typography>
            )}
          </Box>

          {/* Actions Area */}
          {actions && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
              {actions}
            </Box>
          )}
        </Box>
      </Box>

      {/* CONTENT BODY */}
      <Box sx={{ p: { xs: 1.5, sm: 2, md: 2.5 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {children}
      </Box>
    </Box>
  );
};

export default PageContainer;
