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
      
      {/* ✅ CONTENT TITLE BAR 
        - Reduced vertical padding (py: 1.5) to fix "gap"
        - Reduced horizontal padding (px: 3)
        - Matches Calibration's compact style
      */}
      <Box 
        sx={{ 
          px: 3, 
          py: 1.5, 
          bgcolor: 'background.paper', 
          borderBottom: '1px solid', 
          borderColor: 'divider' 
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            {/* Breadcrumbs: Compact and faded */}
            {breadcrumbs.length > 0 && (
              <Breadcrumbs 
                separator={<ChevronRight sx={{ fontSize: 14, color: 'text.disabled' }} />} 
                sx={{ mb: 0.5, '& .MuiBreadcrumbs-ol': { alignItems: 'center' } }}
              >
                {breadcrumbs.map((crumb, idx) => (
                  <Typography 
                    key={idx} 
                    variant="caption" 
                    sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 500 }}
                  >
                    {crumb.toUpperCase()}
                  </Typography>
                ))}
              </Breadcrumbs>
            )}
            
            {/* Title: H6 is smaller than H5, reducing visual weight */}
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2, fontSize: '1.1rem' }}>
              {title}
            </Typography>
            
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.8rem' }}>
                {subtitle}
              </Typography>
            )}
          </Box>

          {/* Actions Area */}
          {actions && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {actions}
            </Box>
          )}
        </Box>
      </Box>

      {/* ✅ CONTENT BODY 
        - Standard padding (p: 3)
        - No extra margins here
      */}
      <Box sx={{ p: 3, flex: 1 }}>
        {children}
      </Box>
    </Box>
  );
};

export default PageContainer;
