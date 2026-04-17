// tools/investigation/theme.js
import { createTheme } from '@mui/material';

// 1. The Raw Palette (Exported for manual use in sx props)
export const pwcColors = {
  primary: '#ea580c',       // PwC Orange
  secondary: '#2d2d2d',     // Dark Grey
  bg: '#f2f2f2',            // Light Grey Background
  surface: '#ffffff',       // White
  textMain: '#1a1a1a',      // Near Black
  textMuted: '#5e5e5e',     // Medium Grey
  border: '#e0e0e0',        // Subtle Border
  successBg: '#ecfdf5',     // Light Green
  successText: '#047857',   // Dark Green
  errorBg: '#fef2f2',       // Light Red
  errorText: '#b91c1c',     // Dark Red
  warningBg: '#fff7ed',     // Light Orange
};

// 2. The MUI Theme (Exported for MainLayout)
export const appTheme = createTheme({
  palette: {
    primary: { main: pwcColors.primary },
    secondary: { main: pwcColors.secondary },
    background: { default: pwcColors.bg, paper: pwcColors.surface },
    text: { primary: pwcColors.textMain, secondary: pwcColors.textMuted },
    divider: pwcColors.border,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 0,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { overflow: 'hidden', height: '100vh' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 0 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { fontWeight: 600, textTransform: 'none', borderRadius: 0 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 0 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 0 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 0 },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: 0 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 0 },
      },
    },
  },
});
