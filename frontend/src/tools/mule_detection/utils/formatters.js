export const formatNumber = (value, opts = {}) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '-';
  const {
    minFractionDigits = 0,
    maxFractionDigits = 3,
    useGrouping = true
  } = opts;
  return new Intl.NumberFormat('en-US', {
    useGrouping,
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits
  }).format(n);
};

export const formatInteger = (value) => formatNumber(value, { minFractionDigits: 0, maxFractionDigits: 0 });

export const formatProbability = (value, digits = 3) =>
  formatNumber(value, { minFractionDigits: Math.min(2, digits), maxFractionDigits: digits });

export const formatPercentFromRatio = (ratio, digits = 1) => {
  const n = typeof ratio === 'number' ? ratio : Number(ratio);
  if (!Number.isFinite(n)) return '-';
  return `${formatNumber(n * 100, { minFractionDigits: digits, maxFractionDigits: digits })}%`;
};

