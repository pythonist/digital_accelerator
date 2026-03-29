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
  panelAlt: FCC_THEME.panelAlt,
  panelMuted: FCC_THEME.panelMuted,
  border: FCC_THEME.border,
  borderStrong: FCC_THEME.borderStrong,
  text: FCC_THEME.text,
  textMuted: FCC_THEME.textMuted,
  textDim: FCC_THEME.textSoft,
  info: FCC_THEME.info,
  infoBg: FCC_THEME.infoBg,
  accentSoft: FCC_THEME.accentSoft,
  accentSoftStrong: FCC_THEME.accentSoftStrong,
  good: FCC_THEME.success,
  warn: FCC_THEME.warning,
  bad: FCC_THEME.error,
  goodLight: FCC_THEME.successBg,
  warnLight: FCC_THEME.warningBg,
  badLight: FCC_THEME.errorBg,
  shadowSm: FCC_THEME.shadowSm,
  shadowMd: FCC_THEME.shadowMd,
  chart: ['#3A4857', FCC_THEME.accent, FCC_THEME.success, '#86624B'],
};

export const chartColorForIndex = (idx = 0) => V.chart[idx % V.chart.length];
