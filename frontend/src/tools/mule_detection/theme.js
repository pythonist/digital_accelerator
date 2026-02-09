// frontend/src/tools/mule_detection/theme.js
import { createTheme } from '@mui/material';

// ✅ Pure PwC Color Palette (Matching Investigation/Calibration)
export const pwcColors = {
  primary: '#ea580c',       // PwC Orange
  secondary: '#2d2d2d',     // Dark Grey
  bg: '#f2f2f2',            // Light Grey Background
  surface: '#ffffff',       // White
  textMain: '#1a1a1a',      // Near Black
  textMuted: '#5e5e5e',     // Medium Grey
  border: '#e0e0e0',        // Subtle Border
  
  // Status Colors
  successBg: '#ecfdf5',     // Light Green
  successText: '#047857',   // Dark Green
  errorBg: '#fef2f2',       // Light Red
  errorText: '#b91c1c',     // Dark Red
  warningBg: '#fff7ed',     // Light Orange
  warningText: '#ea580c',   // PwC Orange
  
  // Mule-Specific
  suspiciousBg: '#fff7ed',
  suspiciousText: '#ea580c',
  flaggedBg: '#fef2f2',
  flaggedText: '#b91c1c'
};

// ✅ MUI Theme for Mule Detection
export const muleTheme = createTheme({
  palette: {
    primary: { main: pwcColors.primary },
    secondary: { main: pwcColors.secondary },
    background: { default: pwcColors.bg, paper: pwcColors.surface },
    text: { primary: pwcColors.textMain, secondary: pwcColors.textMuted },
    divider: pwcColors.border,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
    button: { fontWeight: 600, textTransform: 'none' }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { 
          fontWeight: 600, 
          textTransform: 'none',
          borderRadius: 6
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: `1px solid ${pwcColors.border}`
        }
      }
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: 16,
          borderBottom: `1px solid ${pwcColors.border}`,
        },
        title: { fontWeight: 800 },
      }
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 16,
          '&:last-child': { paddingBottom: 16 }
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 800,
          backgroundColor: pwcColors.surface
        },
        root: {
          paddingTop: 10,
          paddingBottom: 10
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 }
      }
    }
  }
});
