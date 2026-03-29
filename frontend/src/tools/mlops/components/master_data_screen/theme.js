import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

export const T = {
  orange: FCC_THEME.accent,
  orangeDark: FCC_THEME.accentHover,
  orangeSoft: FCC_THEME.accentSoft,
  border: FCC_THEME.border,
  borderStrong: FCC_THEME.borderStrong,
  text: FCC_THEME.text,
  muted: FCC_THEME.textMuted,
  bg: FCC_THEME.page,
  panel: FCC_THEME.panel,
  good: FCC_THEME.success,
  goodSoft: FCC_THEME.successBg,
  warn: FCC_THEME.warning,
  warnSoft: FCC_THEME.warningBg,
  bad: FCC_THEME.error,
  badSoft: FCC_THEME.errorBg,
  blue: FCC_THEME.info,
  blueSoft: FCC_THEME.infoBg,
  chip: FCC_THEME.panelMuted,
  shadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
  radius: 14,
};

export const cardStyle = {
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  boxShadow: T.shadow,
};

export const buttonStyle = (kind = 'secondary', disabled = false) => {
  const base = {
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    padding: '9px 14px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'all 0.15s ease',
  };
  if (kind === 'primary') {
    return {
      ...base,
      border: '1px solid transparent',
      color: '#fff',
      background: T.orange,
    };
  }
  return {
    ...base,
    border: `1px solid ${T.borderStrong}`,
    color: T.text,
    background: '#fff',
  };
};

export const inputStyle = {
  width: '100%',
  border: `1px solid ${T.borderStrong}`,
  borderRadius: 12,
  padding: '9px 11px',
  fontSize: 13,
  color: T.text,
  background: '#fff',
  outline: 'none',
};
