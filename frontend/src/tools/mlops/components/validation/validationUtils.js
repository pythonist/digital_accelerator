export const unwrap = (resp) => {
  const body = resp?.data ?? resp;
  return body?.data ?? body;
};

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

export const pickFirst = (...values) => values.find(hasValue);

export const fmt = (v, d = 3) => (v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toFixed(d));

export const pct = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '-' : `${Number(v).toFixed(d)}%`);

export const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toFixed(d));

export const safeNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const normalizeLabel = (run) => run?.label || run?.algorithm_display || run?.algorithm || run?.job_id?.slice?.(0, 8) || 'Model';

const asArray = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const extractCurveFromValue = (curve, xKey, yKey) => {
  if (!curve) return [];

  if (Array.isArray(curve)) {
    return curve
      .map((point) => {
        if (Array.isArray(point)) {
          return { x: Number(point?.[0]), y: Number(point?.[1]) };
        }
        if (point && typeof point === 'object') {
          return {
            x: Number(point?.[xKey] ?? point?.x ?? point?.fpr ?? point?.recall ?? point?.threshold),
            y: Number(point?.[yKey] ?? point?.y ?? point?.tpr ?? point?.precision ?? point?.suppression_rate_pct),
          };
        }
        return null;
      })
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .sort((a, b) => a.x - b.x);
  }

  if (isRecord(curve)) {
    const nested = curve?.points || curve?.data;
    if (Array.isArray(nested)) {
      return extractCurveFromValue(nested, xKey, yKey);
    }
    const xs = curve?.[xKey] || curve?.x;
    const ys = curve?.[yKey] || curve?.y;
    if (Array.isArray(xs) && Array.isArray(ys)) {
      return xs
        .map((x, idx) => ({ x: Number(x), y: Number(ys[idx]) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .sort((a, b) => a.x - b.x);
    }
  }

  return [];
};

const extractCurve = (model, curveKey) => {
  const candidates = [
    model?.[curveKey],
    model?.metrics?.[curveKey],
    model?.results?.[curveKey],
    model?.results?.metrics?.[curveKey],
  ];
  return candidates.find(hasValue) || [];
};

export const getCurvePoints = (model, curveKey, xKey, yKey) => (
  extractCurveFromValue(extractCurve(model, curveKey), xKey, yKey)
);

export const totalFromConfusionMatrix = (cm) => (
  asArray(cm).flat().reduce((total, value) => total + safeNumber(value, 0), 0)
);

export const mergeValidationModel = (baseModel, detailModel) => {
  const base = baseModel || {};
  const detail = detailModel || {};
  const baseMetrics = isRecord(base.metrics) ? base.metrics : {};
  const detailMetrics = isRecord(detail.metrics) ? detail.metrics : {};
  const summary = isRecord(detail.summary)
    ? detail.summary
    : (isRecord(base.summary) ? base.summary : {});
  const splitSummary = {
    ...(isRecord(detail.split_summary) ? detail.split_summary : {}),
    ...(isRecord(base.split_summary) ? base.split_summary : {}),
  };

  return {
    ...detail,
    ...base,
    summary,
    metrics: {
      ...detailMetrics,
      ...baseMetrics,
    },
    split_summary: splitSummary,
    roc_curve: pickFirst(base.roc_curve, detail.roc_curve, detailMetrics.roc_curve, baseMetrics.roc_curve),
    pr_curve: pickFirst(base.pr_curve, detail.pr_curve, detailMetrics.pr_curve, baseMetrics.pr_curve),
    feature_importance: pickFirst(base.feature_importance, detail.feature_importance, detailMetrics.feature_importance, baseMetrics.feature_importance, []),
    threshold_table: pickFirst(base.threshold_table, detail.threshold_table, detailMetrics.threshold_table, baseMetrics.threshold_table, []),
    confusion_matrix: pickFirst(base.confusion_matrix, detail.confusion_matrix, detailMetrics.confusion_matrix, baseMetrics.confusion_matrix),
    train_rows: pickFirst(base.train_rows, detail.train_rows, splitSummary.train_rows, summary.train_rows),
    test_rows: pickFirst(base.test_rows, detail.test_rows, splitSummary.test_rows, summary.test_rows),
    split_strategy: pickFirst(base.split_strategy, detail.split_strategy, splitSummary.split_strategy),
    split_date: pickFirst(base.split_date, detail.split_date, splitSummary.split_date),
    date_column: pickFirst(base.date_column, detail.date_column, splitSummary.date_column),
    target_column: pickFirst(base.target_column, detail.target_column, summary.target_column),
    features_used: pickFirst(base.features_used, detail.features_used, summary.features_used),
    trained_at: pickFirst(base.trained_at, detail.trained_at),
    grain: pickFirst(base.grain, detail.grain, summary.grain),
  };
};

export const getValidationContext = (model) => {
  const merged = mergeValidationModel(model, null);
  const split = merged.split_summary || {};
  return {
    splitStrategy: pickFirst(split.split_strategy, merged.split_strategy),
    splitDate: pickFirst(split.split_date, merged.split_date),
    dateColumn: pickFirst(split.date_column, merged.date_column),
    trainRows: safeNumber(pickFirst(split.train_rows, merged.train_rows, merged.summary?.train_rows), NaN),
    testRows: safeNumber(
      pickFirst(
        split.test_rows,
        merged.test_rows,
        merged.summary?.test_rows,
        totalFromConfusionMatrix(merged.confusion_matrix || merged.metrics?.confusion_matrix),
      ),
      NaN,
    ),
    testEventRatePct: pickFirst(split.test_event_rate_pct, split.event_rate_pct, merged.summary?.event_rate_pct),
    targetColumn: pickFirst(merged.target_column, merged.summary?.target_column),
    grain: pickFirst(merged.grain, merged.summary?.grain),
    featuresUsed: pickFirst(merged.features_used, merged.summary?.features_used),
  };
};

export const formatSplitLabel = (contextOrModel) => {
  const context = contextOrModel?.splitStrategy !== undefined
    ? contextOrModel
    : getValidationContext(contextOrModel);
  const strategy = String(context?.splitStrategy || '').trim().toLowerCase();
  if (strategy === 'temporal') return 'Temporal holdout';
  if (strategy === 'random') return 'Random holdout';
  if (strategy === 'auto') return 'Auto holdout';
  return 'Validation holdout';
};

export const humanizeFeatureName = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'Feature';
  return text
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeImportanceRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const feature = row.feature ?? row.name ?? row.column ?? row.label;
        const importance = row.importance ?? row.weight ?? row.score ?? row.value;
        return {
          feature: String(feature || '').trim(),
          importance: safeNumber(importance, NaN),
        };
      }
      return null;
    })
    .filter((row) => row?.feature && Number.isFinite(row.importance))
    .sort((left, right) => right.importance - left.importance);
};

const normalizeImportanceObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const topFeatures = Array.isArray(value.top_features) ? value.top_features : [];
  const topImportance = Array.isArray(value.top_importance) ? value.top_importance : [];
  if (topFeatures.length && topImportance.length) {
    return topFeatures
      .map((feature, idx) => ({
        feature: String(feature || '').trim(),
        importance: safeNumber(topImportance[idx], NaN),
      }))
      .filter((row) => row.feature && Number.isFinite(row.importance))
      .sort((left, right) => right.importance - left.importance);
  }
  return Object.entries(value)
    .map(([feature, importance]) => ({
      feature: String(feature || '').trim(),
      importance: safeNumber(importance, NaN),
    }))
    .filter((row) => row.feature && Number.isFinite(row.importance))
    .sort((left, right) => right.importance - left.importance);
};

export const getFeatureImportanceRows = (model, limit = 15) => {
  const internals = model?.model_internals;
  const selectedInternals = model?.selected_algorithm?.internals;
  const candidates = [
    model?.feature_importance,
    model?.metrics?.feature_importance,
    model?.results?.feature_importance,
    internals?.viz_type === 'feature_importance' ? internals?.data : null,
    selectedInternals?.viz_type === 'feature_importance' ? selectedInternals?.data : null,
    model?.feature_importance_map,
    model?.metrics?.feature_importance_map,
  ];

  for (const candidate of candidates) {
    const rows = Array.isArray(candidate)
      ? normalizeImportanceRows(candidate)
      : normalizeImportanceObject(candidate);
    if (rows.length) {
      const topRows = rows.slice(0, limit);
      const total = topRows.reduce((sum, row) => sum + safeNumber(row.importance, 0), 0) || 1;
      return topRows.map((row, idx) => ({
        ...row,
        rank: idx + 1,
        feature_display: humanizeFeatureName(row.feature),
        contribution_pct: (safeNumber(row.importance, 0) / total) * 100,
      }));
    }
  }
  return [];
};

export const buildCurveGrid = (models, curveKey, xKey, yKey, step = 0.02) => {
  const baseGrid = Array.from({ length: Math.floor(1 / step) + 1 }, (_, i) => Number((i * step).toFixed(4)));
  const series = (models || []).map((model) => {
    const raw = extractCurveFromValue(extractCurve(model, curveKey), xKey, yKey);
    return { id: model?.job_id, label: normalizeLabel(model), points: raw };
  });
  const hasData = series.some((item) => item.points.length > 1);
  if (!hasData) {
    return { data: [], series, hasData: false };
  }

  const xValues = new Set(baseGrid);
  series.forEach((item) => {
    item.points.forEach((point) => {
      xValues.add(Number(point.x.toFixed(4)));
    });
  });
  xValues.add(0);
  xValues.add(1);

  const interpolateStep = (points, x) => {
    if (!points.length) return null;
    let value = points[0].y;
    for (let idx = 0; idx < points.length; idx += 1) {
      const point = points[idx];
      if (x < point.x) break;
      value = point.y;
    }
    return value;
  };

  const data = Array.from(xValues)
    .sort((a, b) => a - b)
    .map((x) => {
      const row = { x };
      series.forEach((item) => {
        row[item.id] = interpolateStep(item.points, x);
      });
      return row;
    });
  return { data, series, hasData: true };
};

export const buildRadarData = (models, metrics) => (
  metrics.map((metric) => {
    const row = { metric: metric.label };
    models.forEach((m) => {
      row[m.job_id] = Number(m?.metrics?.[metric.key] ?? m?.[metric.key] ?? 0);
    });
    return row;
  })
);

export const statusFromValue = (value, thresholds) => {
  if (value == null) return 'warn';
  if (value >= thresholds.good) return 'good';
  if (value >= thresholds.warn) return 'warn';
  return 'bad';
};
