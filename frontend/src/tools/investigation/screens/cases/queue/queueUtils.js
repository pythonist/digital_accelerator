export const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

export const formatDateOnly = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
};

export const formatNumber = (value, digits = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const formatCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const severityTone = (severity) => {
  const text = String(severity || '').toLowerCase();
  if (text.includes('critical')) return { fg: '#991b1b', bg: '#fee2e2', border: '#fecaca' };
  if (text.includes('high')) return { fg: '#9a3412', bg: '#ffedd5', border: '#fed7aa' };
  if (text.includes('medium')) return { fg: '#92400e', bg: '#fef3c7', border: '#fde68a' };
  return { fg: '#0f766e', bg: '#ccfbf1', border: '#99f6e4' };
};

export const statusTone = (status) => {
  const text = String(status || '').toLowerCase();
  if (text.includes('closed') || text.includes('rejected')) return { fg: '#166534', bg: '#dcfce7', border: '#bbf7d0' };
  if (text.includes('sar')) return { fg: '#92400e', bg: '#fef3c7', border: '#fde68a' };
  if (text.includes('awaiting') || text.includes('pending')) return { fg: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' };
  if (text.includes('escalated')) return { fg: '#7c2d12', bg: '#ffedd5', border: '#fed7aa' };
  if (text.includes('review')) return { fg: '#1e3a8a', bg: '#e0e7ff', border: '#c7d2fe' };
  return { fg: '#334155', bg: '#f8fafc', border: '#e2e8f0' };
};

export const riskBand = (score) => {
  const num = Number(score);
  if (!Number.isFinite(num)) return 'Low';
  if (num >= 80) return 'High';
  if (num >= 45) return 'Medium';
  return 'Low';
};

export const toTitleCase = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const downloadJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
