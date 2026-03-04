export const T = {
  orange: '#f97316',
  orangeDark: '#ea580c',
  orangeSoft: '#fff7ed',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#1f2937',
  muted: '#64748b',
  bg: '#f8fafc',
  panel: '#ffffff',
  good: '#16a34a',
  goodSoft: '#f0fdf4',
  warn: '#b45309',
  warnSoft: '#fffbeb',
  bad: '#dc2626',
  badSoft: '#fef2f2',
  blue: '#1d4ed8',
  blueSoft: '#eff6ff',
  chip: '#f1f5f9',
  shadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  radius: 12,
};

export const cardStyle = {
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  boxShadow: T.shadow,
};

export const buttonStyle = (kind = 'secondary', disabled = false) => {
  const base = {
    borderRadius: 8,
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
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 13,
  color: T.text,
  background: '#fff',
  outline: 'none',
};
