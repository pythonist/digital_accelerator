// frontend/src/tools/btsy/theme.js
import { createTheme } from '@mui/material';

export const pwcColors = {
  primary: '#0f172a',
  secondary: '#334155',
  accent: '#D04A02',
  bg: '#f8fafc',
  surface: '#ffffff',
  textMain: '#0f172a',
  textMuted: '#475569',
  border: '#e2e8f0',
  successBg: '#f0fdf4',
  successText: '#166534',
  errorBg: '#fef2f2',
  errorText: '#991b1b',
  warningBg: '#fff7ed',
  warningText: '#9a3412',
  infoBg: '#eff6ff',
  infoText: '#1e40af',
};

export const btsyTheme = createTheme({
  palette: {
    primary: { main: pwcColors.primary },
    secondary: { main: pwcColors.secondary },
    background: { 
      default: pwcColors.bg, 
      paper: pwcColors.surface 
    },
    text: { 
      primary: pwcColors.textMain, 
      secondary: pwcColors.textMuted 
    },
    divider: pwcColors.border,
    success: {
      main: pwcColors.successText,
      light: pwcColors.successBg,
    },
    error: {
      main: pwcColors.errorText,
      light: pwcColors.errorBg,
    },
    warning: {
      main: pwcColors.warningText,
      light: pwcColors.warningBg,
    },
    info: {
      main: pwcColors.infoText,
      light: pwcColors.infoBg,
    }
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: {
      fontWeight: 600,
      fontSize: '1.25rem',
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.125rem',
    },
    subtitle1: {
      fontWeight: 500,
    },
    subtitle2: {
      fontWeight: 500,
      fontSize: '0.875rem',
    },
    body1: {
      fontSize: '0.875rem',
    },
    body2: {
      fontSize: '0.8125rem',
    },
    caption: {
      fontSize: '0.75rem',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { 
          overflow: 'hidden',
          height: '100dvh' 
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { 
          fontWeight: 600, 
          textTransform: 'none',
          borderRadius: 6,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }
        }
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
        outlined: {
          borderColor: pwcColors.border,
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.75rem',
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          border: `1px solid ${pwcColors.border}`,
        },
        standardInfo: {
          backgroundColor: pwcColors.bg,
          color: pwcColors.textMain,
        }
      }
    },
    MuiSelect: {
      defaultProps: {
        MenuProps: {
          PaperProps: { sx: { borderRadius: 8 } }
        }
      }
    },
  },
});
