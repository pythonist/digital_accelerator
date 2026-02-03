import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';

function getTargetRect(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export default function GuideOverlay({ active, step, stepIndex, stepsCount, onSkip, onStop }) {
  const [rect, setRect] = useState(null);
  const rafRef = useRef(null);

  const targetSelector = step?.target || null;

  const recompute = () => {
    const r = getTargetRect(targetSelector);
    setRect(r);
  };

  useEffect(() => {
    if (!active || !targetSelector) return;
    recompute();
    const interval = setInterval(recompute, 250);
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    };
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(interval);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [active, targetSelector]);

  if (!active || !step) {
    return null;
  }

  if (!rect) {
    return (
      <Paper elevation={6} sx={{ position: 'fixed', left: '50%', top: '20%', transform: 'translateX(-50%)', zIndex: 1520, p: 2, borderRadius: 0, border: '1px solid #e2e8f0', maxWidth: 420 }}>
        <Typography variant="caption" sx={{ color: '#64748b' }}>{`Step ${stepIndex + 1} of ${stepsCount}`}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{step.instruction}</Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
          Target element is not visible on this screen.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" onClick={onStop}>Exit</Button>
          <Button variant="contained" size="small" sx={{ bgcolor: '#0f172a' }} onClick={onSkip}>Skip step</Button>
        </Box>
      </Paper>
    );
  }

  const pad = 10;
  const left = Math.max(0, rect.x - pad);
  const top = Math.max(0, rect.y - pad);
  const right = Math.min(window.innerWidth, rect.x + rect.w + pad);
  const bottom = Math.min(window.innerHeight, rect.y + rect.h + pad);
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);

  const spaceBelow = window.innerHeight - bottom;
  const coachX = Math.min(Math.max(12, left), window.innerWidth - 380);
  const coachPos = spaceBelow > 140
    ? { x: coachX, y: bottom + 12, transform: 'none' }
    : { x: coachX, y: top - 12, transform: 'translateY(-100%)' };

  return (
    <>
      <Box sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1500 }}>
        <Box sx={{ position: 'fixed', left: 0, top: 0, width: '100%', height: top, bgcolor: 'rgba(2,6,23,0.55)', pointerEvents: 'auto' }} />
        <Box sx={{ position: 'fixed', left: 0, top, width: left, height: h, bgcolor: 'rgba(2,6,23,0.55)', pointerEvents: 'auto' }} />
        <Box sx={{ position: 'fixed', left: right, top, width: Math.max(0, window.innerWidth - right), height: h, bgcolor: 'rgba(2,6,23,0.55)', pointerEvents: 'auto' }} />
        <Box sx={{ position: 'fixed', left: 0, top: bottom, width: '100%', height: Math.max(0, window.innerHeight - bottom), bgcolor: 'rgba(2,6,23,0.55)', pointerEvents: 'auto' }} />
      </Box>
      <Box
        sx={{
          position: 'fixed',
          left,
          top,
          width: w,
          height: h,
          border: '2px solid #D04A02',
          zIndex: 1510,
          pointerEvents: 'none'
        }}
      />
      <Paper
        elevation={6}
        sx={{
          position: 'fixed',
          left: coachPos.x,
          top: coachPos.y,
          transform: coachPos.transform,
          zIndex: 1520,
          p: 1.5,
          borderRadius: 0,
          border: '1px solid #e2e8f0',
          maxWidth: 360,
          pointerEvents: 'auto'
        }}
      >
        <Typography variant="caption" sx={{ color: '#64748b' }}>{`Step ${stepIndex + 1} of ${stepsCount}`}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{step.instruction}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" onClick={onStop}>Exit</Button>
          <Button variant="contained" size="small" sx={{ bgcolor: '#0f172a' }} onClick={onSkip}>Skip step</Button>
        </Box>
      </Paper>
      <Box sx={{ position: 'fixed', left: left + w - 6, top: top - 6, width: 12, height: 12, bgcolor: '#D04A02', zIndex: 1515, pointerEvents: 'none' }} />
    </>
  );
}
