export const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const formatNumber = (value, opts = {}) => {
  const { decimals = 0 } = opts;
  const n = toNumber(value);
  if (n === null) return '-';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const formatCompact = (value, opts = {}) => {
  const { decimals = 1 } = opts;
  const n = toNumber(value);
  if (n === null) return '-';
  const abs = Math.abs(n);
  const units = [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  const unit = units.find((u) => abs >= u.v);
  if (!unit) return formatNumber(n, { decimals });
  const scaled = n / unit.v;
  const d = Math.abs(scaled) < 10 ? decimals : Math.max(0, decimals - 1);
  return `${formatNumber(scaled, { decimals: d })}${unit.s}`;
};

