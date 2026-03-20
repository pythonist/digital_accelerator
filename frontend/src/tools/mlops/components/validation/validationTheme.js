import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

export const V = {
  orange: FCC_THEME.accent,
  navy: '#3A4857',
  green: FCC_THEME.success,
  purple: '#86624B',
  slateDark: '#2F2924',
  slateMid: '#4B4239',
  canvas: FCC_THEME.canvas,
  paper: FCC_THEME.panel,
  border: FCC_THEME.border,
  text: FCC_THEME.text,
  textMuted: FCC_THEME.textMuted,
  textDim: FCC_THEME.textSoft,
  good: FCC_THEME.success,
  warn: FCC_THEME.warning,
  bad: FCC_THEME.error,
  goodLight: FCC_THEME.successBg,
  warnLight: FCC_THEME.warningBg,
  badLight: FCC_THEME.errorBg,
  chart: ['#3A4857', FCC_THEME.accent, FCC_THEME.success, '#86624B'],
};

export const chartColorForIndex = (idx = 0) => V.chart[idx % V.chart.length];
