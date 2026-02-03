import React, { useState, useEffect } from 'react';
import { useAppContext } from "../../context/AppContext";
import { useNavigate } from 'react-router-dom';
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';
import { motion, AnimatePresence } from 'framer-motion';
// Import your motion wrappers
import { MotionContainer, MotionItem, FadeIn, SlideSwitcher, ScaleIn } from "@components/MotionWrappers/MotionWrappers"; 

// MUI Imports
import {
  Box,
  Typography,
  Button,
  OutlinedInput,
  InputAdornment,
  IconButton,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from '@mui/material';

// MUI Icons
import {
  Security as ShieldIcon,
  Lock,
  Person,
  ArrowForward,
  ErrorOutline,
  Visibility,
  VisibilityOff,
  Smartphone
} from '@mui/icons-material';

const LoginScreen = () => {
  const { handleLogin } = useAppContext();
  const navigate = useNavigate();
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg'));

  // --- Logic State ---
  const [step, setStep] = useState(1);
  const [otp, setOtp] = useState('');
  
  // Form State
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Hero Carousel State
  const [currentSlide, setCurrentSlide] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [typingSpeed, setTypingSpeed] = useState(150);

  const slides = [
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

  const typingTexts = [
    'Financial Crime Prevention',
    'Advanced Analytics',
    'AML Workbench',
    'AI-Assisted Decisions'
  ];

  // Carousel Effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [slides.length]);

  // Typing Effect
  useEffect(() => {
    const handleTyping = () => {
      const i = loopNum % typingTexts.length;
      const fullText = typingTexts[i];

      setTypedText(
        isDeleting
          ? fullText.substring(0, typedText.length - 1)
          : fullText.substring(0, typedText.length + 1)
      );

      setTypingSpeed(isDeleting ? 50 : 150);

      if (!isDeleting && typedText === fullText) {
        setTimeout(() => setIsDeleting(true), 2000);
      } else if (isDeleting && typedText === '') {
        setIsDeleting(false);
        setLoopNum(loopNum + 1);
      }
    };

    const timer = setTimeout(handleTyping, typingSpeed);
    return () => clearTimeout(timer);
  }, [typedText, isDeleting, loopNum, typingSpeed]);

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
        // --- STEP 1: INITIAL LOGIN ---
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });

        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           // If backend returns HTML (like a 404 page or index.html), throw specific error
           throw new Error("Invalid API response. Check backend connection.");
        }

        const data = await res.json();

        if (res.ok) {
           if (data.require_mfa) {
             setStep(2); // Move to 2FA
           } else if (data.success && data.token) {
             await handleLogin({ token: data.token, user: data.user });
             navigate('/'); 
           } else {
             setError('Unexpected server response.');
           }
        } else {
          setError(data.error || 'Invalid credentials');
        }

      } else {
        // --- STEP 2: VERIFY OTP ---
        // Note: I added '/verify' here as typically verification is a distinct action.
        // If your API uses the same endpoint, change '/api/login/verify' back to '/api/login'
        const res = await fetch('/api/login/verify', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, code: otp })
        });
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           throw new Error("Invalid API response during verification.");
        }

        const data = await res.json();

        if (res.ok && data.success && data.token) {
          await handleLogin({ token: data.token, user: data.user });
          navigate('/');
        } else {
          setError(data.error || 'Invalid authentication code');
        }
      }
    } catch (err) {
      console.error("Login Error:", err);
      setError(err.message || 'Connection error. Please try again.');
    }
    setIsLoading(false);
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  // --- PwC Color Palette ---
  const colors = {
    pwcOrange: '#D04A02',
    pwcOrangeBright: '#FFB600',
    pwcOrangeHover: '#B23F02',
    pwcDark: '#1E1E1E',
    pwcGray: '#3D3D3D',
    pwcLightGray: '#F2F2F2',
    slate700: '#334155',
    slate600: '#475569',
    slate500: '#64748b',
    slate400: '#94a3b8',
    slate300: '#cbd5e1',
    slate200: '#e2e8f0',
    red50: '#fef2f2',
    red600: '#dc2626',
    white: '#ffffff',
    emerald400: '#34d399',
  };

  const inputStyle = {
    borderRadius: '12px',
    backgroundColor: colors.white,
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: colors.slate300,
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: colors.slate400,
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: colors.pwcOrange,
      borderWidth: '2px',
    },
    input: { padding: '14px 14px 14px 0' }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%', bgcolor: colors.white }}>
      
      {/* LEFT: HERO CAROUSEL */}
      <Box
        sx={{
          display: { xs: 'none', lg: 'flex' },
          width: '55%',
          position: 'relative',
          bgcolor: colors.pwcDark,
          overflow: 'hidden'
        }}
      >
        <AnimatePresence>
            <Box
                component={motion.div}
                key={currentSlide}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                sx={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 0
                }}
            >
                <Box
                    component="img"
                    src={`${slides[currentSlide].image}&auto=format&fit=crop`}
                    alt={slides[currentSlide].title}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <Box
                    sx={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(135deg, rgba(30,30,30,0.95) 0%, rgba(208,74,2,0.7) 50%, rgba(30,30,30,0.95) 100%)'
                    }}
                />
            </Box>
        </AnimatePresence>

        <Box
          sx={{
            position: 'relative',
            zIndex: 10,
            p: 8,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%'
          }}
        >
          <FadeIn delay={0.2}>
  {/* Increased gap from 2 to 3 for more space between logo and text */}
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}> 
    <Box
      component="img"
      src={SentinelLogo}
      alt="Sentinel"
      sx={{
        height: 42,
        width: 'auto',
        display: 'block',
        transform: 'translateY(-4px)', // Adjusted slightly to center with taller text block
        filter: 'brightness(0) invert(1)',
      }}
    />

    <Typography
      variant="h4"
      sx={{
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1.25, // 👈 Increased for more vertical space between the lines
        color: colors.pwcOrangeBright,
        userSelect: 'none'
      }}
    >
      Financial Crime Intelligence Platform <br /> (FCIP)
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
                            {slides[currentSlide].title}
                        </Typography>
                        <Typography variant="h6" sx={{ color: '#e0e0e0', lineHeight: 1.6, fontWeight: 400 }}>
                            {slides[currentSlide].subtitle}
                        </Typography>
                    </motion.div>
                </AnimatePresence>
            </Box>

            <Box sx={{ pt: 3, borderTop: `1px solid rgba(255,255,255,0.2)` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    bgcolor: colors.pwcOrange,
                    borderRadius: '50%',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: .5 }
                    }
                  }}
                />
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#e0e0e0' }}>
                  Real-time
                </Typography>
              </Box>
              <Box sx={{ height: '64px', display: 'flex', alignItems: 'center' }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.white }}>
                  {typedText}
                  <Box component="span" sx={{ animation: 'blink 1s step-end infinite', '@keyframes blink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } } }}>
                    |
                  </Box>
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              {slides.map((_, index) => (
                <Box
                  component="button"
                  key={index}
                  onClick={() => setCurrentSlide(index)}
                  sx={{
                    height: 4,
                    borderRadius: 999,
                    transition: 'all 300ms',
                    cursor: 'pointer',
                    border: 'none',
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
            Secure Access Portal • Enterprise Grade Security
          </Typography>
        </Box>
      </Box>

      {/* RIGHT: LOGIN FORM */}
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, bgcolor: colors.pwcLightGray }}>
        <Box sx={{ width: '100%', maxWidth: '448px' }}>
          
          <FadeIn delay={0.2}>
            <Box sx={{ mb: 5 }}>
                <Box sx={{ mb: 2 }}>
                <Box
                    sx={{
                    display: 'inline-block',
                    px: 1.5,
                    py: 0.5,
                    bgcolor: 'rgba(208,74,2,0.1)',
                    color: colors.pwcOrange,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.025em',
                    border: `1px solid rgba(208,74,2,0.2)`
                    }}
                >
                    Secure Login
                </Box>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.pwcDark, mb: 1 }}>
                {step === 1 ? 'Welcome Back' : 'Verify Identity'}
                </Typography>
                <Typography variant="body1" sx={{ color: colors.slate600 }}>
                {step === 1 
                    ? 'Enter your credentials to access your workspace' 
                    : 'Enter the code from your authenticator app'}
                </Typography>
            </Box>
          </FadeIn>

          <AnimatePresence>
            {error && (
                <ScaleIn key="error-message">
                <Box
                    sx={{
                    mb: 3,
                    p: 2,
                    bgcolor: colors.red50,
                    border: `1px solid #fecaca`,
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    }}
                >
                    <ErrorOutline sx={{ fontSize: 20, color: colors.red600, mt: 0.2 }} />
                    <Typography variant="body2" sx={{ color: '#b91c1c', fontWeight: 500 }}>
                    {error}
                    </Typography>
                </Box>
                </ScaleIn>
            )}
          </AnimatePresence>

          <MotionContainer component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            
            <SlideSwitcher itemKey={step} direction={step === 1 ? -1 : 1}>
                {step === 1 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <MotionItem>
                        <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: colors.slate700 }}>
                            Email Address
                        </Typography>
                        <OutlinedInput
                            fullWidth
                            name="username"
                            type="email"
                            value={formData.username}
                            onChange={handleChange}
                            placeholder="your.email@company.com"
                            startAdornment={
                            <InputAdornment position="start">
                                <Person sx={{ color: colors.slate400, fontSize: 20 }} />
                            </InputAdornment>
                            }
                            sx={inputStyle}
                        />
                        {fieldErrors.username && (
                            <Typography variant="caption" sx={{ color: colors.red600, mt: 0.5, display: 'block' }}>
                            {fieldErrors.username}
                            </Typography>
                        )}
                        </Box>
                    </MotionItem>

                    <MotionItem>
                        <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: colors.slate700 }}>
                            Password
                        </Typography>
                        <OutlinedInput
                            fullWidth
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="Enter your password"
                            startAdornment={
                            <InputAdornment position="start">
                                <Lock sx={{ color: colors.slate400, fontSize: 20 }} />
                            </InputAdornment>
                            }
                            endAdornment={
                            <InputAdornment position="end">
                                <IconButton
                                onClick={() => setShowPassword(!showPassword)}
                                edge="end"
                                sx={{ color: colors.slate400, '&:hover': { color: colors.slate600 } }}
                                >
                                {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                </IconButton>
                            </InputAdornment>
                            }
                            sx={inputStyle}
                        />
                        {fieldErrors.password && (
                            <Typography variant="caption" sx={{ color: colors.red600, mt: 0.5, display: 'block' }}>
                            {fieldErrors.password}
                            </Typography>
                        )}
                        </Box>
                    </MotionItem>
                </Box>
                ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <MotionItem>
                        <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: colors.slate700 }}>
                            Authentication Code
                        </Typography>
                        <OutlinedInput
                            fullWidth
                            autoFocus
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            placeholder="000000"
                            inputProps={{ maxLength: 6, style: { textAlign: 'center', letterSpacing: '0.2em', fontFamily: 'monospace', fontSize: '1.125rem' } }}
                            startAdornment={
                            <InputAdornment position="start">
                                <Smartphone sx={{ color: colors.slate400, fontSize: 20 }} />
                            </InputAdornment>
                            }
                            sx={inputStyle}
                        />
                        {fieldErrors.otp && (
                            <Typography variant="caption" sx={{ color: colors.red600, mt: 0.5, display: 'block' }}>
                            {fieldErrors.otp}
                            </Typography>
                        )}
                        </Box>
                    </MotionItem>
                </Box>
                )}
            </SlideSwitcher>

            <MotionItem>
                <Button
                type="submit"
                fullWidth
                disabled={isLoading}
                variant="contained"
                sx={{
                    py: 1.75,
                    borderRadius: '12px',
                    fontWeight: 600,
                    textTransform: 'none',
                    fontSize: '1rem',
                    bgcolor: colors.pwcOrange,
                    boxShadow: '0 10px 15px -3px rgba(208, 74, 2, 0.2)',
                    '&:hover': {
                    bgcolor: colors.pwcOrangeHover,
                    },
                    '&:active': {
                    transform: 'scale(0.98)'
                    },
                    '&.Mui-disabled': {
                    bgcolor: colors.slate400,
                    color: colors.white
                    },
                    transition: 'all 0.2s'
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
            </MotionItem>

            {step === 1 && (
              <MotionItem>
                <Box sx={{ textAlign: 'center', pt: 1 }}>
                    <Typography variant="body2" sx={{ color: colors.slate600 }}>
                    Don't have an account?{' '}
                    <Button
                        onClick={() => navigate('/register')}
                        disableRipple
                        sx={{
                        p: 0,
                        minWidth: 0,
                        fontWeight: 600,
                        textTransform: 'none',
                        color: colors.pwcOrange,
                        '&:hover': {
                            bgcolor: 'transparent',
                            textDecoration: 'none',
                            color: colors.pwcOrangeHover
                        }
                        }}
                    >
                        Register here
                    </Button>
                    </Typography>
                </Box>
              </MotionItem>
            )}
          </MotionContainer>

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
