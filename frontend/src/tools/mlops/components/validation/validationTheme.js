export const V = {
  // PwC core
  orange: '#E87722',
  navy: '#1F2A44',
  green: '#2E7D32',
  purple: '#6F2C91',
  // Slate header
  slateDark: '#1A1A24',
  slateMid: '#2D2D3A',
  // Neutrals
  canvas: '#F6F7F9',
  paper: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#64748B',
  textDim: '#94A3B8',
  // Status
  good: '#2E7D32',
  warn: '#B45309',
  bad: '#B42318',
  goodLight: '#ECFDF3',
  warnLight: '#FFF7ED',
  badLight: '#FEF2F2',
  // Chart palette
  chart: ['#1F2A44', '#E87722', '#2E7D32', '#6F2C91'],
};

export const chartColorForIndex = (idx = 0) => V.chart[idx % V.chart.length];
