const asArray = (value) => (Array.isArray(value) ? value : []);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeString = (value) => String(value || '').trim();

const uniqueColumns = (columns = []) => {
  const seen = new Set();
  const out = [];
  asArray(columns).forEach((column) => {
    const next = safeString(column);
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  });
  return out;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isObject(value)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
};

const GROUP_KEY_FIELDS = {
  mapping_id: ['mapping_only'],
  tag_mapping_id: ['mapping_only'],
  keep_mapping: ['mapping_only'],
  drop_columns: ['reason'],
  imputation: ['strategy', 'value', 'k', 'iterations'],
  encoding_label: [],
  encoding_onehot: ['max_categories'],
  encoding_ordinal: ['order'],
  encoding_frequency: [],
  scaling_standard: [],
  scaling_minmax: [],
  scaling_robust: [],
  normalize_l2: [],
  datetime_extract: ['drop_original'],
  text_features: [],
};

const groupedStepTypes = new Set(Object.keys(GROUP_KEY_FIELDS));

const toColumns = (item) => uniqueColumns([
  ...asArray(item?.columns),
  ...(safeString(item?.column) ? [item.column] : []),
]);

const buildGroupingKey = (item) => {
  const type = safeString(item?.type).toLowerCase();
  if (!groupedStepTypes.has(type)) return null;

  const key = { type };
  (GROUP_KEY_FIELDS[type] || []).forEach((field) => {
    const value = item?.[field];
    if (value !== undefined) key[field] = stableValue(value);
  });
  return JSON.stringify(key);
};

const summarizeColumns = (columns = [], limit = 3) => {
  const cols = uniqueColumns(columns);
  if (cols.length === 0) return 'No columns';
  const head = cols.slice(0, limit).join(', ');
  return cols.length > limit ? `${head}, +${cols.length - limit} more` : head;
};

const buildExplanation = (item) => {
  const columns = uniqueColumns(item?.columns);
  const count = columns.length;
  const plural = count === 1 ? '' : 's';
  const preview = summarizeColumns(columns, 3);
  const type = safeString(item?.type).toLowerCase();

  if (type === 'mapping_id' || type === 'tag_mapping_id' || type === 'keep_mapping') {
    return `${count} identifier-like column${plural} can stay for traceability while remaining outside model features: ${preview}.`;
  }
  if (type === 'drop_columns') {
    const reason = safeString(item?.reason);
    return `${count} column${plural} can be removed together${reason ? ` (${reason})` : ''}: ${preview}.`;
  }
  if (type === 'imputation') {
    const strategy = safeString(item?.strategy) || 'median';
    const value = item?.value;
    const valueText = value != null && value !== '' ? ` (fill value: ${value})` : '';
    return `${count} column${plural} can share one ${strategy} imputation step${valueText}: ${preview}.`;
  }
  if (type === 'encoding_onehot') {
    return `${count} low-cardinality categorical column${plural} are suitable for one-hot encoding together: ${preview}.`;
  }
  if (type === 'encoding_frequency') {
    return `${count} high-cardinality categorical column${plural} are better handled with frequency encoding: ${preview}.`;
  }
  if (type === 'encoding_label' || type === 'encoding_ordinal') {
    return `${count} categorical column${plural} can share one encoding step: ${preview}.`;
  }
  if (type === 'datetime_extract') {
    return `${count} datetime column${plural} can be expanded into reusable date parts together: ${preview}.`;
  }
  if (type === 'scaling_standard' || type === 'scaling_minmax' || type === 'scaling_robust' || type === 'normalize_l2') {
    return `${count} numeric column${plural} can share one scaling step: ${preview}.`;
  }
  if (type === 'text_features') {
    return `${count} text column${plural} can share one text-feature extraction step: ${preview}.`;
  }
  return `${count} column${plural}: ${preview}.`;
};

const finalizeItem = (item, withExplanation) => {
  const next = { ...item };
  const columns = toColumns(next);
  delete next.column;

  if (columns.length > 0) {
    next.columns = columns;
    next.column_count = columns.length;
    next.column_preview = columns.slice(0, 6);
    if (withExplanation && groupedStepTypes.has(safeString(next.type).toLowerCase())) {
      next.explanation = buildExplanation(next);
    }
  } else {
    delete next.columns;
    delete next.column_count;
    delete next.column_preview;
  }

  return next;
};

const normalizeCollection = (items, { withExplanation = false } = {}) => {
  const ordered = [];
  const groups = new Map();

  asArray(items).forEach((rawItem) => {
    if (!isObject(rawItem)) return;
    const item = finalizeItem(rawItem, false);
    const key = buildGroupingKey(item);
    if (!key) {
      ordered.push(finalizeItem(item, withExplanation));
      return;
    }

    const existing = groups.get(key);
    if (!existing) {
      const created = { ...item, columns: toColumns(item) };
      groups.set(key, created);
      ordered.push(created);
      return;
    }

    existing.columns = uniqueColumns([...(existing.columns || []), ...toColumns(item)]);
  });

  return ordered.map((item) => finalizeItem(item, withExplanation));
};

export const unwrapApiPayload = (raw) => {
  const levelOne = raw?.data ?? raw;
  return levelOne?.data ?? levelOne;
};

export const normalizePreprocessSuggestions = (items) => {
  return normalizeCollection(items, { withExplanation: true });
};

export const normalizePreprocessSteps = (items) => {
  return normalizeCollection(items, { withExplanation: false });
};
