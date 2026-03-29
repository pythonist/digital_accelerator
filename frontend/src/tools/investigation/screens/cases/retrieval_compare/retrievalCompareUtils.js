import { formatCompact, formatNumber } from '@investigation/utils/format';

export const formatPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${Math.round(num * 100)}%`;
};

export const formatRisk = (value) => formatNumber(value, { decimals: 0 });

export const formatAmount = (value) => formatCompact(value, { decimals: 1 });

export const outcomeTone = (value) => {
  const text = String(value || '').toLowerCase();
  if (text.includes('sar')) return { fg: '#92400e', bg: '#fef3c7', border: '#fde68a' };
  if (text.includes('pending') || text.includes('escalated')) return { fg: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' };
  if (text.includes('closed') || text.includes('rejected')) return { fg: '#166534', bg: '#dcfce7', border: '#bbf7d0' };
  return { fg: '#475569', bg: '#f8fafc', border: '#e2e8f0' };
};

export const modeOptions = [
  'Behavioral Similarity',
  'Typology Similarity',
  'Network Similarity',
  'Hybrid Similarity',
];

export const sortSimilarResults = (rows, sortBy) => {
  const items = [...(rows || [])];
  if (sortBy === 'recency') {
    items.sort((left, right) => new Date(right.last_updated_at || 0).getTime() - new Date(left.last_updated_at || 0).getTime());
    return items;
  }
  if (sortBy === 'risk') {
    items.sort((left, right) => Number(right.risk_score || 0) - Number(left.risk_score || 0));
    return items;
  }
  if (sortBy === 'outcome') {
    items.sort((left, right) => String(left.resolution_outcome || '').localeCompare(String(right.resolution_outcome || '')));
    return items;
  }
  items.sort((left, right) => Number(right.similarity_score || 0) - Number(left.similarity_score || 0));
  return items;
};
