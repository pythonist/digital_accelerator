// frontend/src/tools/btsy/theme.js
import { createTheme } from '@mui/material';

export const pwcColors = {
  primary: '#0f172a',
  secondary: '#334155',
  accent: '#1f2937',
  bg: '#f8fafc',
  surface: '#ffffff',
  textMain: '#0f172a',
  textMuted: '#475569',
  border: '#e2e8f0',
  successBg: '#ffffff',
  successText: '#0f172a',
  errorBg: '#ffffff',
  errorText: '#0f172a',
  warningBg: '#ffffff',
  warningText: '#0f172a',
  infoBg: '#ffffff',
  infoText: '#0f172a',
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
      fontSize: '1.125rem',
    },
    h6: {
      fontWeight: 600,
      fontSize: '1rem',
    },
    subtitle1: {
      fontWeight: 500,
    },
    subtitle2: {
      fontWeight: 500,
      fontSize: '0.8125rem',
    },
    body1: {
      fontSize: '0.8125rem',
    },
    body2: {
      fontSize: '0.75rem',
    },
    caption: {
      fontSize: '0.6875rem',
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
          borderRadius: 2,
          padding: '4px 10px',
          minHeight: 28,
          '& .MuiButton-startIcon, & .MuiButton-endIcon': {
            display: 'none',
          },
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          }
        }
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
        outlined: {
          borderColor: pwcColors.border,
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          boxShadow: 'none',
          border: `1px solid ${pwcColors.border}`,
        }
      }
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 12,
          '&:last-child': {
            paddingBottom: 12,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.75rem',
          backgroundColor: 'transparent',
          border: 'none',
          borderRadius: 0,
          paddingLeft: 0,
          paddingRight: 0,
        }
      }
    },
    MuiAlert: {
      defaultProps: {
        icon: false,
      },
      styleOverrides: {
        root: {
          borderRadius: 2,
          border: `1px solid ${pwcColors.border}`,
          padding: '6px 10px',
        },
        standardInfo: {
          backgroundColor: pwcColors.surface,
          color: pwcColors.textMain,
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 10,
          paddingRight: 10,
          borderColor: pwcColors.border,
          fontSize: '0.75rem',
        },
        head: {
          fontWeight: 600,
          backgroundColor: pwcColors.bg,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': {
            borderBottom: 0,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 32,
        },
        indicator: {
          backgroundColor: pwcColors.secondary,
          height: 2,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 32,
          padding: '6px 10px',
          fontSize: '0.75rem',
          textTransform: 'none',
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 2,
          padding: '4px 8px',
          fontSize: '0.75rem',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
      },
    },
    MuiSvgIcon: {
      styleOverrides: {
        root: {
          color: pwcColors.secondary,
          fontSize: '1rem',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: pwcColors.border,
        },
      },
    },
    MuiSelect: {
      defaultProps: {
        MenuProps: {
          PaperProps: { sx: { borderRadius: 2 } }
        }
      }
    },
  },
});
