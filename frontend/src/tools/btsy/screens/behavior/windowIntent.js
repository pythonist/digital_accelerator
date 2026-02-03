export const getWindowIntent = (windowSpec) => {
  const w = String(windowSpec || '').toUpperCase();
  if (w === '1D') return 'Intraday spike';
  if (w === '3D') return 'Short-term accumulation';
  if (w === '5D') return 'Short-term accumulation';
  if (w === '7D') return 'Weekly pattern';
  if (w === '14D') return 'Medium-term build-up';
  if (w === '30D') return 'Long-term behaviour';
  return null;
};

