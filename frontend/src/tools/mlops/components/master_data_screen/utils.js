export const safe = (s) => String(s || '').trim().toLowerCase();
export const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString());
export const pct = (n) => (n == null ? '-' : `${Number(n).toFixed(1)}%`);

export const EVENT_TABLE_TYPES = new Set([
  'transactions', 'transaction', 'txns', 'txn',
  'payments', 'payment', 'transfers', 'transfer',
  'wire_transfers', 'events', 'activity',
]);

export const ENTITY_KEYS = new Set([
  'account_id', 'acct_id', 'customer_id', 'cust_id', 'entity_id',
]);

export const TXN_AGG_FEATURES = [
  { col: 'txn_count', label: 'Transaction count' },
  { col: 'total_txn_volume', label: 'Total volume' },
  { col: 'avg_txn_amount', label: 'Avg amount' },
  { col: 'max_txn_amount', label: 'Max amount' },
  { col: 'std_txn_amount', label: 'Std dev amount' },
  { col: 'velocity_ratio', label: 'Velocity ratio' },
  { col: 'unique_channels', label: 'Unique channels' },
  { col: 'unique_beneficiary_countries', label: 'Unique countries' },
  { col: 'cash_txn_count', label: 'Cash txn count' },
  { col: 'swift_txn_count', label: 'SWIFT txn count' },
  { col: 'pct_high_risk_dest', label: '% High-risk destination' },
];

export const isEventTable = (datasetType) => EVENT_TABLE_TYPES.has(safe(datasetType));

export const findDatasetByType = (datasets, datasetType) => {
  const key = safe(datasetType);
  return datasets.find((d) => safe(d.dataset_type) === key) || null;
};

export const datasetColumns = (dataset) => (Array.isArray(dataset?.columns) ? dataset.columns : []);

export const inferAnchorType = (grain, datasets) => {
  const map = {
    transaction: ['transactions', 'txn', 'transaction'],
    account: ['accounts', 'account'],
    customer: ['customers', 'customer'],
    case: ['cases', 'case'],
    alert: ['alerts', 'alert'],
  };
  const candidates = map[grain] || [];
  for (const t of candidates) {
    const match = findDatasetByType(datasets, t);
    if (match) return match.dataset_type;
  }
  return datasets[0]?.dataset_type || '';
};

export const sharedKeys = (leftDs, rightDs) => {
  const leftCols = new Set(datasetColumns(leftDs).map((c) => safe(c)));
  const rightCols = new Set(datasetColumns(rightDs).map((c) => safe(c)));
  const commonHints = ['transaction_id', 'account_id', 'customer_id', 'case_id', 'alert_id', 'entity_id'];
  const keys = [];

  for (const key of commonHints) {
    if (leftCols.has(key) && rightCols.has(key)) keys.push(key);
  }
  for (const c of datasetColumns(leftDs)) {
    const lc = safe(c);
    if ((!lc.endsWith('_id') && lc !== 'id') || keys.includes(lc)) continue;
    if (rightCols.has(lc)) keys.push(lc);
  }
  return keys;
};

export const cardinalityLabel = (leftRows, rightRows, matchedRows) => {
  const l = Math.max(1, Number(leftRows || 0));
  const r = Math.max(1, Number(rightRows || 0));
  const m = Math.max(0, Number(matchedRows || 0));
  const leftRate = m / l;
  const rightRate = m / r;

  if (leftRate > 0.9 && rightRate > 0.9) return '1:1 likely';
  if (leftRate > 0.8 && rightRate <= 0.8) return 'many:1 likely';
  if (leftRate <= 0.8 && rightRate > 0.8) return '1:many risk';
  return 'many:many risk';
};

export const estimateRowsAfterJoin = (currentRows, joinType, rightRows, matchedRows) => {
  const cur = Math.max(0, Number(currentRows || 0));
  const rhs = Math.max(0, Number(rightRows || 0));
  const matched = Math.max(0, Number(matchedRows || 0));
  const jt = safe(joinType);

  if (jt === 'inner') return Math.min(cur, matched || cur);
  if (jt === 'right') return Math.max(rhs, matched || rhs);
  if (jt === 'full') return Math.max(cur + rhs - matched, cur, rhs);
  return cur;
};

export const joinWouldFanOut = (join, datasets) => {
  const rightType = safe(join?.right || '');
  const leftType = safe(join?.left || '');
  const key = safe(join?.key || '');
  const side = isEventTable(rightType) ? rightType : isEventTable(leftType) ? leftType : null;
  if (!side || !ENTITY_KEYS.has(key)) return false;
  const ds = datasets.find((d) => safe(d.dataset_type) === side);
  return ds && Number(ds.row_count || 0) > 5000;
};

export const stageRowImpact = (joins, anchorType, datasets) => {
  const anchor = findDatasetByType(datasets, anchorType);
  let runningRows = Number(anchor?.row_count || 0);
  const steps = [];

  joins.filter((j) => j.enabled !== false).forEach((j, idx) => {
    const leftDs = findDatasetByType(datasets, j.left);
    const rightDs = findDatasetByType(datasets, j.right);
    const rightRows = Number(rightDs?.row_count || 0);
    const matched = Number(j.matched_rows || 0);
    const before = runningRows;
    const after = estimateRowsAfterJoin(runningRows, j.join_type, rightRows, matched);
    const duplicationFactor = before > 0 ? (after / before) : 1;
    const nullImpactPct = safe(j.join_type) === 'left'
      ? ((Math.max(before - matched, 0) / Math.max(before, 1)) * 100)
      : safe(j.join_type) === 'inner'
      ? ((Math.max(before - after, 0) / Math.max(before, 1)) * 100)
      : 0;

    steps.push({
      idx: idx + 1,
      left: j.left,
      right: j.right,
      key: j.key,
      join_type: j.join_type,
      before_rows: before,
      matched_rows: matched,
      after_rows: after,
      coverage_pct: before > 0 ? (matched / before) * 100 : 0,
      duplication_factor: duplicationFactor,
      null_impact_pct: nullImpactPct,
      cardinality: cardinalityLabel(leftDs?.row_count, rightDs?.row_count, matched),
    });

    runningRows = after;
  });

  return { anchorRows: Number(anchor?.row_count || 0), finalRows: runningRows, steps };
};

export const makeJoinId = (left, right, key, suffix = '') =>
  `${safe(left)}__${safe(right)}__${safe(key)}${suffix}`;

export const buildDefaultTransforms = () => ([
  { id: `t_${Date.now()}_1`, type: 'drop_high_nulls', config: { threshold_pct: 95 } },
  { id: `t_${Date.now()}_2`, type: 'deduplicate', config: { key: 'alert_id' } },
]);

export const mapTransformsForPreview = (transforms) => (transforms || []).flatMap((t) => {
  const type = safe(t.type);
  const cfg = t.config || {};
  if (type === 'date_parts') {
    return [{ type: 'datetime_extract', columns: cfg.column ? [cfg.column] : [], drop_original: false }];
  }
  if (type === 'aggregate') {
    return [{ type: 'aggregate', group_by: cfg.group_by || 'account_id', metrics: cfg.metrics || ['sum', 'avg', 'count'] }];
  }
  return [{ type, ...cfg }];
});

export const tableDescription = (tableType) => {
  const key = safe(tableType);
  const map = {
    alerts: 'Rule-engine alert decisions. One row should represent one alert.',
    accounts: 'Account-level profile and static banking attributes.',
    customers: 'Customer KYC and demographic profile.',
    transactions: 'Raw payment events that must be rolled up before joining.',
    cases: 'Investigation outcomes used as fallback supervision signal.',
    str: 'Suspicious transaction reports used as primary positive signal.',
    sar: 'Suspicious activity reports used as primary positive signal.',
  };
  return map[key] || `Additional enrichment table: ${tableType}`;
};
