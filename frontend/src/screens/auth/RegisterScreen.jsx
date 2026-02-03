import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from "react-qr-code";

// 1. Assets & Theme
import SentinelLogo from '../../assets/PwC_2025_Logo.svg';
import { pwcColors } from '../../tools/calibration/theme';

// 2. Motion Wrappers (From your specified path)
import { 
  MotionContainer, 
  MotionItem, 
  FadeIn, 
  SlideSwitcher, 
  ScaleIn 
} from "@components/MotionWrappers/MotionWrappers";

// 3. MUI Imports
import {
  Box,
  Typography,
  Button,
  OutlinedInput,
  InputAdornment,
  IconButton,
  Paper,
  CircularProgress,
  useTheme,
  useMediaQuery
} from '@mui/material';

// 4. Icons
import {
  Lock,
  Email,
  Phone,
  Smartphone,
  CheckCircle,
  Visibility,
  VisibilityOff
} from '@mui/icons-material';

// --- Local Styles (Theme-linked) ---
const inputStyles = {
  borderRadius: '8px',
  backgroundColor: pwcColors.surface,
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: pwcColors.border,
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: pwcColors.textMuted,
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: pwcColors.primary,
    borderWidth: '2px',
  },
  input: { padding: '14px 14px 14px 0', color: pwcColors.textMain }
};

const RegisterScreen = () => {
  const navigate = useNavigate();
  
  // --- State ---
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form Data
  const [formData, setFormData] = useState({ email: '', password: '', phone: '' });
  const [showPassword, setShowPassword] = useState(false);

  // Auth Data (Returned from Backend)
  const [tempToken, setTempToken] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  // --- API: Step 1 (Initialize Registration) ---
  const handleInit = async (e) => {
    e.preventDefault();
    setLoading(true); 
    setError('');

    try {
      const res = await fetch('/api/register/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        // Backend should return a temp_token and the QR URI for 2FA setup
        setTempToken(data.temp_token);
        setQrUri(data.qr_uri);
        setStep(2); // Move to QR Scan
      } else {
        setError(data.error || 'Registration failed. User may already exist.');
      }
    } catch (err) { 
      setError("Network connection error. Please try again."); 
      console.error(err);
    }
    setLoading(false);
  };

  // --- API: Step 2 (Verify OTP & Finalize) ---
  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true); 
    setError('');

    try {
      const res = await fetch('/api/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            temp_token: tempToken, 
            code: otpCode 
        })
      });

      const data = await res.json();
      
      if (res.ok && data.success) {
        setStep(3); // Move to Success Screen
      } else {
        setError(data.error || 'Invalid authentication code.');
      }
    } catch (err) { 
      setError("Network connection error."); 
    }
    setLoading(false);
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%', bgcolor: pwcColors.surface, overflow: 'hidden' }}>
      
      {/* LEFT: BRANDING SIDEBAR */}
      <Box
        sx={{
          display: { xs: 'none', lg: 'flex' },
          width: '45%',
          bgcolor: pwcColors.secondary,
          position: 'relative',
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 8
        }}
      >
        {/* Background Image Overlay */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80')`,
            backgroundSize: 'cover',
            opacity: 0.1,
            mixBlendMode: 'overlay'
          }}
        />

        <FadeIn delay={0.2}>
            <Box sx={{ position: 'relative', zIndex: 10 }}>
              {/* LOGO SECTION */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
                  <Box 
                    component="img"
                    src={SentinelLogo}
                    alt="PwC Logo"
                    sx={{ width: 36, height: 'auto', filter: 'brightness(0) invert(1)' }}
                  />
                  <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '0.22em', color: pwcColors.surface, lineHeight: 1 }}>
                      FCIP
                    </Typography>
                    <Typography variant="caption" sx={{ mt: 0.75, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.75)', lineHeight: 1 }}>
                      Financial Crime | Digital Accelerator
                    </Typography>
                  </Box>
              </Box>
              
              <Typography variant="h2" sx={{ fontWeight: 800, color: pwcColors.surface, lineHeight: 1.2, mb: 2 }}>
                  Create Admin <br/> Account
              </Typography>
              
              <Typography variant="body1" sx={{ color: '#9e9e9e', maxWidth: '400px', fontSize: '1.125rem' }}>
                  Secure enrollment with mandatory 2-Factor Authentication.
              </Typography>
            </Box>
        </FadeIn>
      </Box>

      {/* RIGHT: FORM CONTENT */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', p: { xs: 4, lg: 8 }, bgcolor: pwcColors.bg }}>
        
        <Box sx={{ width: '100%', maxWidth: '480px', bgcolor: pwcColors.surface, p: 5, borderRadius: 4, boxShadow: '0px 4px 20px rgba(0,0,0,0.05)' }}>

            {/* ERROR BANNER */}
            {error && (
                <ScaleIn>
                    <Box sx={{ mb: 3, p: 2, bgcolor: pwcColors.errorBg, border: `1px solid ${pwcColors.errorText}`, borderRadius: '8px', color: pwcColors.errorText, fontWeight: 700, fontSize: '0.875rem' }}>
                        {error}
                    </Box>
                </ScaleIn>
            )}

            {/* --- SLIDE SWITCHER FOR STEPS --- */}
            <SlideSwitcher itemKey={step} direction={1}>
                
                {/* STEP 1: USER DETAILS FORM */}
                {step === 1 && (
                    <MotionContainer component="form" onSubmit={handleInit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <MotionItem>
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="h4" sx={{ fontWeight: 700, color: pwcColors.textMain, mb: 1 }}>
                                    Sign Up
                                </Typography>
                                <Typography variant="body1" sx={{ color: pwcColors.textMuted }}>
                                    Enter your details to begin setup.
                                </Typography>
                            </Box>
                        </MotionItem>

                        <MotionItem>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {/* Email */}
                                <OutlinedInput
                                    fullWidth
                                    name="email"
                                    type="email"
                                    required
                                    placeholder="admin@company.com"
                                    value={formData.email}
                                    onChange={handleChange}
                                    startAdornment={<InputAdornment position="start"><Email sx={{ color: pwcColors.textMuted }} /></InputAdornment>}
                                    sx={inputStyles}
                                />
                                
                                {/* Phone */}
                                <OutlinedInput
                                    fullWidth
                                    name="phone"
                                    required
                                    placeholder="+1 555 000 0000"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    startAdornment={<InputAdornment position="start"><Phone sx={{ color: pwcColors.textMuted }} /></InputAdornment>}
                                    sx={inputStyles}
                                />

                                {/* Password */}
                                <OutlinedInput
                                    fullWidth
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    placeholder="Password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    startAdornment={<InputAdornment position="start"><Lock sx={{ color: pwcColors.textMuted }} /></InputAdornment>}
                                    endAdornment={
                                    <InputAdornment position="end">
                                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                    }
                                    sx={inputStyles}
                                />
                            </Box>
                        </MotionItem>

                        <MotionItem>
                            <Button
                                type="submit"
                                disabled={loading}
                                variant="contained"
                                fullWidth
                                sx={{
                                    py: 1.5,
                                    borderRadius: '8px',
                                    bgcolor: pwcColors.primary,
                                    color: '#fff',
                                    fontWeight: 700,
                                    fontSize: '1rem',
                                    '&:hover': { bgcolor: '#c2410c' },
                                    '&.Mui-disabled': { bgcolor: pwcColors.border, color: pwcColors.textMuted }
                                }}
                            >
                                {loading ? (
                                  <CircularProgress size={24} sx={{ color: 'white' }} />
                                ) : 'Continue to Security Setup'}
                            </Button>
                        </MotionItem>

                        <MotionItem>
                            <Box sx={{ textAlign: 'center', pt: 1 }}>
                                <Typography variant="body2" sx={{ color: pwcColors.textMuted }}>
                                    Already have an account?{' '}
                                    <Box 
                                        component="span" 
                                        onClick={() => navigate('/login')}
                                        sx={{ 
                                            color: pwcColors.primary, 
                                            fontWeight: 700, 
                                            cursor: 'pointer', 
                                            '&:hover': { textDecoration: 'underline' } 
                                        }}
                                    >
                                        Login
                                    </Box>
                                </Typography>
                            </Box>
                        </MotionItem>
                    </MotionContainer>
                )}

                {/* STEP 2: SCAN QR & VERIFY OTP */}
                {step === 2 && (
                    <MotionContainer component="form" onSubmit={handleVerify} sx={{ textAlign: 'center' }}>
                         <MotionItem>
                            <Box sx={{ display: 'inline-flex', p: 1.5, bgcolor: pwcColors.warningBg, borderRadius: '50%', color: pwcColors.primary, mb: 2 }}>
                                <Smartphone sx={{ fontSize: 32 }} />
                            </Box>
                            <Typography variant="h5" sx={{ fontWeight: 700, color: pwcColors.textMain, mb: 1 }}>
                                Setup Authenticator
                            </Typography>
                            <Typography variant="body2" sx={{ color: pwcColors.textMuted, mb: 4 }}>
                                Scan this code with your Authenticator App.
                            </Typography>
                         </MotionItem>

                         <MotionItem>
                            <Paper elevation={0} sx={{ p: 2, border: `2px solid ${pwcColors.border}`, borderRadius: '16px', display: 'inline-block', mb: 4, bgcolor: pwcColors.surface }}>
                                {/* Ensure QR URI is valid to prevent errors */}
                                {qrUri && <QRCode value={qrUri} size={160} />}
                            </Paper>
                         </MotionItem>

                         <MotionItem>
                            <Box sx={{ mb: 3, textAlign: 'left' }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: pwcColors.textMuted, display: 'block', mb: 1, ml: 0.5 }}>
                                    Enter 6-Digit Code
                                </Typography>
                                <OutlinedInput
                                    fullWidth
                                    autoFocus
                                    required
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value)}
                                    placeholder="000 000"
                                    inputProps={{ 
                                        maxLength: 6, 
                                        style: { textAlign: 'center', fontSize: '1.5rem', fontFamily: 'monospace', letterSpacing: '0.2em' } 
                                    }}
                                    sx={{
                                        ...inputStyles,
                                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: pwcColors.primary }
                                    }}
                                />
                            </Box>
                         </MotionItem>

                         <MotionItem>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <Button
                                    onClick={() => setStep(1)}
                                    variant="outlined"
                                    disabled={loading}
                                    sx={{
                                        px: 3, py: 1.5,
                                        borderRadius: '8px',
                                        borderColor: pwcColors.border,
                                        color: pwcColors.textMuted,
                                        fontWeight: 700,
                                        '&:hover': { borderColor: pwcColors.textMuted, bgcolor: pwcColors.bg }
                                    }}
                                >
                                    Back
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={loading || otpCode.length < 6}
                                    variant="contained"
                                    fullWidth
                                    sx={{
                                        py: 1.5,
                                        borderRadius: '8px',
                                        bgcolor: pwcColors.primary,
                                        color: '#fff',
                                        fontWeight: 700,
                                        '&:hover': { bgcolor: '#c2410c' }
                                    }}
                                >
                                    {loading ? 'Verifying...' : 'Verify & Create'}
                                </Button>
                            </Box>
                         </MotionItem>
                    </MotionContainer>
                )}

                {/* STEP 3: SUCCESS & REDIRECT */}
                {step === 3 && (
                    <MotionContainer sx={{ textAlign: 'center' }}>
                         <MotionItem>
                            <ScaleIn>
                                <Box sx={{ 
                                    width: 96, height: 96, 
                                    bgcolor: pwcColors.successBg, 
                                    color: pwcColors.successText, 
                                    borderRadius: '50%', 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                    mx: 'auto', mb: 3 
                                }}>
                                    <CheckCircle sx={{ fontSize: 48 }} />
                                </Box>
                            </ScaleIn>
                            
                            <Typography variant="h4" sx={{ fontWeight: 700, color: pwcColors.textMain, mb: 1 }}>
                                You're All Set!
                            </Typography>
                            
                            <Typography variant="body1" sx={{ color: pwcColors.textMuted, mb: 4, maxWidth: '280px', mx: 'auto' }}>
                                Your admin account has been created and 2FA is active.
                            </Typography>

                            <Button
                                onClick={() => navigate('/login')}
                                fullWidth
                                variant="contained"
                                sx={{
                                    py: 1.5,
                                    borderRadius: '8px',
                                    bgcolor: pwcColors.primary,
                                    color: '#fff',
                                    fontWeight: 700,
                                    fontSize: '1rem',
                                    '&:hover': { bgcolor: '#c2410c' }
                                }}
                            >
                                Proceed to Login
                            </Button>
                         </MotionItem>
                    </MotionContainer>
                )}

            </SlideSwitcher>

        </Box>
      </Box>
    </Box>
  );
};

export default RegisterScreen;
