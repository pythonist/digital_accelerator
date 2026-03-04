import React, { useState, useEffect } from 'react';
import { useAppContext } from "../../context/AppContext";
import { useNavigate } from 'react-router-dom';
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';
import { motion, AnimatePresence } from 'framer-motion';
import { FadeIn, SlideSwitcher, ScaleIn } from "@components/MotionWrappers/MotionWrappers";

import {
  Box, Typography, Button, OutlinedInput,
  InputAdornment, IconButton, CircularProgress,
} from '@mui/material';

import {
  Lock, Person, ArrowForward, ErrorOutline,
  Visibility, VisibilityOff, Smartphone
} from '@mui/icons-material';

const colors = {
  pwcOrange: '#B45309',
  pwcOrangeBright: '#F59E0B',
  pwcOrangeHover: '#92400E',
  pwcDark: '#1E1E1E',
  pwcLightGray: '#F5F4F2',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  slate200: '#e2e8f0',
  red50: '#fef2f2',
  red600: '#dc2626',
  white: '#ffffff',
};

// Defined OUTSIDE any component so it never gets recreated on render
const FieldShell = ({ label, children, helper }) => (
  <Box>
    <Typography
      variant="subtitle2"
      sx={{ mb: 0.75, fontWeight: 600, color: colors.slate700, fontSize: '0.82rem', letterSpacing: '0.01em' }}
    >
      {label}
    </Typography>
    {children}
    {helper && (
      <Typography variant="caption" sx={{ color: colors.red600, mt: 0.5, display: 'block' }}>
        {helper}
      </Typography>
    )}
  </Box>
);

// Also outside - pure function of isFocused, no closure over component state
const getInputSx = (isFocused) => ({
  borderRadius: '10px',
  backgroundColor: colors.white,
  transition: 'box-shadow 0.2s ease',
  boxShadow: isFocused
    ? '0 0 0 3px rgba(180, 83, 9, 0.15), 0 4px 12px rgba(180,83,9,0.08)'
    : '0 1px 4px rgba(15, 23, 42, 0.06)',
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: isFocused ? colors.pwcOrange : colors.slate300,
    borderWidth: isFocused ? '2px' : '1px',
    transition: 'border-color 0.2s ease, border-width 0.2s ease',
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: isFocused ? colors.pwcOrange : colors.slate400,
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: colors.pwcOrange,
    borderWidth: '2px',
  },
  '& input': {
    padding: '13px 14px 13px 0',
    fontSize: '0.925rem',
  }
});

const heroSlides = [
  {
    image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072',
    title: 'AML Intelligence Workbench',
    subtitle: 'AI-assisted, human-in-the-loop support for AML detection logic',
  },
  {
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=2072',
    title: 'Human-in-the-Loop AI',
    subtitle: 'AI suggestions with explicit human review and control',
  },
  {
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2072',
    title: 'Advanced Analytics',
    subtitle: 'Analytical insights to support AML logic review and refinement',
  }
];

const heroHighlights = [
  'Financial Crime Prevention',
  'Advanced Analytics',
  'AML Workbench',
  'AI-Assisted Decisions'
];

const HeroPanel = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentHighlight, setCurrentHighlight] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentSlide((p) => (p + 1) % heroSlides.length), 7000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentHighlight((p) => (p + 1) % heroHighlights.length), 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box sx={{ display: { xs: 'none', lg: 'flex' }, width: '55%', position: 'relative', bgcolor: colors.pwcDark, overflow: 'hidden' }}>
      <AnimatePresence>
        <Box
          component={motion.div}
          key={currentSlide}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          sx={{ position: 'absolute', inset: 0, zIndex: 0 }}
        >
          <Box
            component="img"
            src={`${heroSlides[currentSlide].image}&auto=format&fit=crop`}
            alt={heroSlides[currentSlide].title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(30,30,30,0.95) 0%, rgba(180,83,9,0.65) 50%, rgba(30,30,30,0.95) 100%)' }} />
        </Box>
      </AnimatePresence>

      <Box sx={{ position: 'relative', zIndex: 10, p: 8, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%' }}>
        <FadeIn delay={0.2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              component="img"
              src={SentinelLogo}
              alt="PwC"
              sx={{
                height: 36, width: 'auto', display: 'block', flexShrink: 0,
                filter: 'brightness(0) saturate(100%) invert(72%) sepia(60%) saturate(500%) hue-rotate(5deg) brightness(105%)',
              }}
            />
            <Box sx={{ width: '1px', height: 28, bgcolor: 'rgba(245,158,11,0.4)', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.3, color: '#F59E0B', letterSpacing: '0.01em', userSelect: 'none' }}>
              Financial Crime Intelligence<br />Platform (FCIP)
            </Typography>
          </Box>
        </FadeIn>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '600px' }}>
          <Box sx={{ minHeight: '120px' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSlide}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
              >
                <Typography variant="h3" sx={{ fontWeight: 700, color: colors.white, mb: 2, lineHeight: 1.2 }}>
                  {heroSlides[currentSlide].title}
                </Typography>
                <Typography variant="h6" sx={{ color: '#e0e0e0', lineHeight: 1.6, fontWeight: 400 }}>
                  {heroSlides[currentSlide].subtitle}
                </Typography>
              </motion.div>
            </AnimatePresence>
          </Box>

          <Box sx={{ pt: 3, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{
                width: 8, height: 8, bgcolor: colors.pwcOrange, borderRadius: '50%',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: .5 } }
              }} />
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#e0e0e0' }}>
                Real-time
              </Typography>
            </Box>
            <Box sx={{ minHeight: '64px', display: 'flex', alignItems: 'center' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentHighlight}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <Typography variant="h4" sx={{ fontWeight: 700, color: colors.white }}>
                    {heroHighlights[currentHighlight]}
                  </Typography>
                </motion.div>
              </AnimatePresence>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            {heroSlides.map((_, index) => (
              <Box
                component="button"
                key={index}
                onClick={() => setCurrentSlide(index)}
                sx={{
                  height: 4, borderRadius: 999, transition: 'all 300ms', cursor: 'pointer', border: 'none',
                  width: currentSlide === index ? 32 : 16,
                  bgcolor: currentSlide === index ? colors.pwcOrange : 'rgba(255,255,255,0.3)',
                  '&:hover': { bgcolor: currentSlide === index ? colors.pwcOrange : 'rgba(255,255,255,0.5)' }
                }}
              />
            ))}
          </Box>
        </Box>

        <Typography variant="caption" sx={{ color: '#b0b0b0', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Lock sx={{ fontSize: 14 }} />
          Secure Access Portal - Enterprise Grade Security
        </Typography>
      </Box>
    </Box>
  );
};

const LoginScreen = () => {
  const { handleLogin } = useAppContext();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [otp, setOtp] = useState('');
  const [loginTempToken, setLoginTempToken] = useState('');
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState('');

  const validate = () => {
    const errors = {};
    if (step === 1) {
      if (!formData.username.trim()) errors.username = 'Email required';
      if (!formData.password) errors.password = 'Password required';
    } else {
      if (otp.length < 6) errors.otp = '6-digit code required';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);
    setError('');
    try {
      if (step === 1) {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("Invalid API response. Check backend connection.");
        const data = await res.json();
        if (res.ok) {
          if (data.require_mfa) { setLoginTempToken(data.temp_token || ''); setStep(2); }
          else if (data.success && data.token) { await handleLogin({ token: data.token, user: data.user }); navigate('/'); }
          else setError('Unexpected server response.');
        } else {
          setError(data.error || 'Invalid credentials');
        }
      } else {
        const res = await fetch('/api/login/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ temp_token: loginTempToken, code: otp, username: formData.username, password: formData.password })
        });
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("Invalid API response during verification.");
        const data = await res.json();
        if (res.ok && data.success && data.token) { await handleLogin({ token: data.token, user: data.user }); navigate('/'); }
        else setError(data.error || 'Invalid authentication code');
      }
    } catch (err) {
      setError(err.message || 'Connection error. Please try again.');
    }
    setIsLoading(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%', bgcolor: colors.white }}>
      <HeroPanel />

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, bgcolor: colors.pwcLightGray }}>
        <Box sx={{ width: '100%', maxWidth: '420px' }}>

          <FadeIn delay={0.2}>
            <Box sx={{ mb: 5 }}>
              <Box sx={{ mb: 2 }}>
                <Box sx={{
                  display: 'inline-block', px: 1.5, py: 0.5,
                  bgcolor: 'rgba(180,83,9,0.08)', color: colors.pwcOrange,
                  fontSize: '0.72rem', fontWeight: 700, borderRadius: '9999px',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  border: '1px solid rgba(180,83,9,0.18)'
                }}>
                  Secure Login
                </Box>
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: colors.pwcDark, mb: 1 }}>
                {step === 1 ? 'Welcome Back' : 'Verify Identity'}
              </Typography>
              <Typography variant="body1" sx={{ color: colors.slate600 }}>
                {step === 1 ? 'Enter your credentials to access your workspace' : 'Enter the code from your authenticator app'}
              </Typography>
            </Box>
          </FadeIn>

          <AnimatePresence>
            {error && (
              <ScaleIn key="error-message">
                <Box sx={{ mb: 3, p: 2, bgcolor: colors.red50, border: '1px solid #fecaca', borderRadius: '10px', display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <ErrorOutline sx={{ fontSize: 20, color: colors.red600, mt: 0.2 }} />
                  <Typography variant="body2" sx={{ color: '#b91c1c', fontWeight: 500 }}>{error}</Typography>
                </Box>
              </ScaleIn>
            )}
          </AnimatePresence>

          <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <SlideSwitcher itemKey={step} direction={step === 1 ? -1 : 1}>
              {step === 1 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FieldShell label="Email Address" helper={fieldErrors.username}>
                    <OutlinedInput
                      fullWidth
                      name="username"
                      type="email"
                      autoComplete="username"
                      value={formData.username}
                      onChange={handleChange}
                      onFocus={() => setActiveField('username')}
                      onBlur={() => setActiveField('')}
                      placeholder="your.email@company.com"
                      startAdornment={
                        <InputAdornment position="start">
                          <Person sx={{ color: activeField === 'username' ? colors.pwcOrange : colors.slate400, fontSize: 20, transition: 'color 0.2s' }} />
                        </InputAdornment>
                      }
                      sx={getInputSx(activeField === 'username')}
                    />
                  </FieldShell>

                  <FieldShell label="Password" helper={fieldErrors.password}>
                    <OutlinedInput
                      fullWidth
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={formData.password}
                      onChange={handleChange}
                      onFocus={() => setActiveField('password')}
                      onBlur={() => setActiveField('')}
                      placeholder="Enter your password"
                      startAdornment={
                        <InputAdornment position="start">
                          <Lock sx={{ color: activeField === 'password' ? colors.pwcOrange : colors.slate400, fontSize: 20, transition: 'color 0.2s' }} />
                        </InputAdornment>
                      }
                      endAdornment={
                        <InputAdornment position="end">
                          <IconButton
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            onMouseDown={(e) => e.preventDefault()}
                            edge="end"
                            sx={{ color: colors.slate400, '&:hover': { color: colors.slate600 } }}
                          >
                            {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                          </IconButton>
                        </InputAdornment>
                      }
                      sx={getInputSx(activeField === 'password')}
                    />
                  </FieldShell>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <FieldShell label="Authentication Code" helper={fieldErrors.otp}>
                    <OutlinedInput
                      fullWidth
                      autoFocus
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      onFocus={() => setActiveField('otp')}
                      onBlur={() => setActiveField('')}
                      placeholder="000000"
                      inputProps={{ maxLength: 6, style: { textAlign: 'center', letterSpacing: '0.25em', fontFamily: 'monospace', fontSize: '1.2rem', padding: '13px 14px' } }}
                      startAdornment={
                        <InputAdornment position="start">
                          <Smartphone sx={{ color: activeField === 'otp' ? colors.pwcOrange : colors.slate400, fontSize: 20, transition: 'color 0.2s' }} />
                        </InputAdornment>
                      }
                      sx={getInputSx(activeField === 'otp')}
                    />
                  </FieldShell>
                </Box>
              )}
            </SlideSwitcher>

            <Button
              type="submit"
              fullWidth
              disabled={isLoading}
              variant="contained"
              sx={{
                py: 1.6, mt: 0.5, borderRadius: '10px', fontWeight: 600,
                textTransform: 'none', fontSize: '0.975rem',
                bgcolor: colors.pwcOrange,
                boxShadow: '0 4px 14px rgba(180, 83, 9, 0.25)',
                '&:hover': { bgcolor: colors.pwcOrangeHover, boxShadow: '0 6px 20px rgba(180, 83, 9, 0.35)' },
                '&:active': { transform: 'scale(0.985)' },
                '&.Mui-disabled': { bgcolor: colors.slate300, color: colors.white },
                transition: 'all 0.2s ease'
              }}
            >
              {isLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} sx={{ color: colors.white }} />
                  <span>Verifying...</span>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span>{step === 1 ? 'Sign In' : 'Verify & Continue'}</span>
                  <ArrowForward sx={{ fontSize: 18 }} />
                </Box>
              )}
            </Button>

            {step === 1 && (
              <Box sx={{ textAlign: 'center', pt: 0.5 }}>
                <Typography variant="body2" sx={{ color: colors.slate600 }}>
                  Don't have an account?{' '}
                  <Button
                    onClick={() => navigate('/register')}
                    disableRipple
                    sx={{ p: 0, minWidth: 0, fontWeight: 600, textTransform: 'none', color: colors.pwcOrange, '&:hover': { bgcolor: 'transparent', color: colors.pwcOrangeHover } }}
                  >
                    Register here
                  </Button>
                </Typography>
              </Box>
            )}
          </Box>

          <FadeIn delay={0.6}>
            <Box sx={{ mt: 5, pt: 3, borderTop: `1px solid ${colors.slate200}` }}>
              <Typography variant="caption" display="block" align="center" sx={{ color: colors.slate500, lineHeight: 1.6 }}>
                This is a secure system. All access is logged and monitored for compliance purposes.
              </Typography>
            </Box>
          </FadeIn>

        </Box>
      </Box>
    </Box>
  );
};

export default LoginScreen;