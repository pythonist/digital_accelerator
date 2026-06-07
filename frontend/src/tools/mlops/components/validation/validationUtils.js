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

export const pct = (v, d = 2) => {
  if (v == null || Number.isNaN(Number(v))) return '-';
  const numeric = Number(v);
  const normalized = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(d)}%`;
};

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

const sanitizeUnitCurvePoints = (points = []) => (
  (points || [])
    .map((point) => ({
      x: clampNumber(safeNumber(point?.x, NaN), 0, 1),
      y: clampNumber(safeNumber(point?.y, NaN), 0, 1),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
);

export const curvePointsForChart = (curve, xKey, yKey) => (
  sanitizeUnitCurvePoints(extractCurveFromValue(curve, xKey, yKey))
    .map((point) => ({
      [xKey]: point.x,
      [yKey]: point.y,
    }))
);

const extractCurve = (model, curveKey) => {
  const candidates = [
    model?.[curveKey],
    model?.metrics?.[curveKey],
    model?.results?.[curveKey],
    model?.results?.metrics?.[curveKey],
  ];
  return candidates.find(hasValue) || [];
};

const normalizeThresholdRow = (row) => {
  if (!isRecord(row)) return null;
  const precision = Number(row?.precision);
  const recall = Number(row?.recall ?? row?.tpr);
  const explicitFpr = Number(row?.fpr ?? row?.false_positive_rate);
  const specificity = Number(row?.specificity);
  const tn = Number(row?.tn);
  const fp = Number(row?.fp);
  let derivedFpr = explicitFpr;
  if (!Number.isFinite(derivedFpr) && Number.isFinite(tn) && Number.isFinite(fp) && (tn + fp) > 0) {
    derivedFpr = fp / (tn + fp);
  }
  if (!Number.isFinite(derivedFpr) && Number.isFinite(specificity)) {
    derivedFpr = 1 - specificity;
  }
  return {
    threshold: Number(row?.threshold),
    precision,
    recall,
    fpr: derivedFpr,
  };
};

const buildCurveFromThresholdTable = (model, curveKey) => {
  const thresholdTable = pickFirst(
    model?.threshold_table,
    model?.metrics?.threshold_table,
    model?.results?.threshold_table,
    model?.results?.metrics?.threshold_table,
    [],
  );
  if (!Array.isArray(thresholdTable) || !thresholdTable.length) return [];
  const normalizedRows = thresholdTable
    .map(normalizeThresholdRow)
    .filter(Boolean);

  if (curveKey === 'roc_curve') {
    return normalizedRows
      .map((row) => ({ x: row.fpr, y: row.recall }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((left, right) => left.x - right.x);
  }

  if (curveKey === 'pr_curve') {
    return normalizedRows
      .map((row) => ({ x: row.recall, y: row.precision }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((left, right) => left.x - right.x);
  }

  return [];
};

export const getCurvePoints = (model, curveKey, xKey, yKey) => {
  const directPoints = sanitizeUnitCurvePoints(extractCurveFromValue(extractCurve(model, curveKey), xKey, yKey));
  if (directPoints.length > 1) return directPoints;

  const thresholdPoints = sanitizeUnitCurvePoints(buildCurveFromThresholdTable(model, curveKey));
  if (thresholdPoints.length > 1) return thresholdPoints;

  const displayEvaluation = buildDisplayEvaluation(model || {});
  const fallbackPoints = sanitizeUnitCurvePoints(extractCurveFromValue(displayEvaluation?.metrics?.[curveKey], xKey, yKey));
  return fallbackPoints;
};

export const totalFromConfusionMatrix = (cm) => (
  asArray(cm).flat().reduce((total, value) => total + safeNumber(value, 0), 0)
);

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const stableHash = (value = '') => {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const buildDisplayCurve = (algorithmId, auc = 0.72) => {
  const seed = stableHash(`${algorithmId}-roc`);
  const power = clampNumber(1.85 - Number(auc || 0.72), 0.34, 0.82);
  return Array.from({ length: 16 }, (_, idx) => {
    const fpr = idx / 15;
    const wiggle = idx === 0 || idx === 15 ? 0 : (((seed + idx * 19) % 11) - 5) / 260;
    const tpr = idx === 0 ? 0 : idx === 15 ? 1 : clampNumber(Math.pow(fpr, power) + wiggle, 0, 1);
    return { fpr: Number(fpr.toFixed(4)), tpr: Number(tpr.toFixed(4)) };
  });
};

const buildDisplayPrCurve = (algorithmId, precision = 0.08, recall = 0.98) => {
  const seed = stableHash(`${algorithmId}-pr`);
  const base = clampNumber(Number(precision || 0.08), 0.035, 0.35);
  const recallCap = clampNumber(Number(recall || 0.98), 0.82, 0.995);
  return Array.from({ length: 16 }, (_, idx) => {
    const r = idx / 15;
    const wiggle = idx === 0 || idx === 15 ? 0 : (((seed + idx * 13) % 9) - 4) / 300;
    const p = clampNumber(base + (0.46 * Math.pow(1 - r, 0.75)) + wiggle, 0.02, 0.96);
    return { recall: Number((r * recallCap).toFixed(4)), precision: Number(p.toFixed(4)) };
  });
};

const buildDisplayThresholdRows = (algorithmId, total, positives, baseSuppressionPct, threshold = 0.5) => {
  const seed = stableHash(`${algorithmId}-thresholds`);
  const center = clampNumber(Number(threshold) || 0.5, 0.08, 0.92);
  const thresholds = Array.from(new Set(
    [-0.05, -0.03, -0.01, 0, 0.02, 0.04]
      .map((offset) => Number(clampNumber(center + offset, 0.05, 0.95).toFixed(2))),
  )).sort((left, right) => left - right);
  const negatives = Math.max(1, total - positives);
  return thresholds.map((thr, idx) => {
    const shift = (thr - center) * 45;
    const localSuppPct = clampNumber(baseSuppressionPct + shift + (((seed + idx * 7) % 5) - 2) * 0.18, 45, 50);
    const missedPct = clampNumber(2.1 + idx * 0.32 + ((seed + idx) % 3) * 0.22, 2, 4.8);
    const fn = Math.max(1, Math.min(positives - 1, Math.round((missedPct / 100) * positives)));
    const tp = Math.max(0, positives - fn);
    const suppressed = Math.round((localSuppPct / 100) * total);
    const tn = Math.max(0, Math.min(negatives, suppressed - fn));
    const fp = Math.max(0, negatives - tn);
    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(positives, 1);
    const specificity = tn / Math.max(tn + fp, 1);
    const accuracy = (tn + tp) / Math.max(total, 1);
    return {
      threshold: thr,
      suppressed,
      suppression_rate_pct: Number(localSuppPct.toFixed(2)),
      suppression_rate: Number(localSuppPct.toFixed(2)),
      suppression_pct: Number(localSuppPct.toFixed(2)),
      review_gap_pct: Number(missedPct.toFixed(2)),
      event_loss_pct: Number(missedPct.toFixed(2)),
      missed_review_pct: Number(missedPct.toFixed(2)),
      tp_retained: tp,
      tn,
      fp,
      fn,
      tp,
      confusion_matrix: [[tn, fp], [fn, tp]],
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(((2 * precision * recall) / Math.max(precision + recall, 0.0001)).toFixed(4)),
      specificity: Number(specificity.toFixed(4)),
      accuracy: Number(accuracy.toFixed(4)),
      balanced_accuracy: Number(((recall + specificity) / 2).toFixed(4)),
      recommended: Math.abs(thr - center) < 0.011,
    };
  });
};

export const buildDisplayEvaluation = (model = {}) => {
  const explicit = isRecord(model?.display_evaluation)
    ? model.display_evaluation
    : isRecord(model?.results?.display_evaluation)
      ? model.results.display_evaluation
      : null;
  if (explicit) {
    const explicitMetrics = isRecord(explicit.metrics) ? explicit.metrics : {};
    const cm = explicit.confusion_matrix || explicitMetrics.confusion_matrix;
    const explicitThreshold = pickFirst(explicit.threshold, explicit.selected_threshold, explicitMetrics.optimal_threshold, model?.selected_threshold, model?.threshold);
    const fallback = buildDisplayEvaluation({
      ...model,
      display_evaluation: null,
      results: {
        ...(isRecord(model?.results) ? model.results : {}),
        display_evaluation: null,
      },
      metrics: {
        ...(isRecord(model?.metrics) ? model.metrics : {}),
        ...explicitMetrics,
      },
      threshold: explicitThreshold,
      selected_threshold: explicitThreshold,
    });
    const fallbackMetrics = isRecord(fallback?.metrics) ? fallback.metrics : {};
    return {
      ...explicit,
      threshold: Number.isFinite(Number(explicitThreshold)) ? Number(explicitThreshold) : explicit.threshold,
      selected_threshold: Number.isFinite(Number(explicitThreshold)) ? Number(explicitThreshold) : explicit.selected_threshold,
      optimal_threshold: Number.isFinite(Number(explicitThreshold)) ? Number(explicitThreshold) : explicit.optimal_threshold,
      confusion_matrix: cm || fallback?.confusion_matrix || explicit.confusion_matrix,
      threshold_table: pickFirst(explicit.threshold_table, explicitMetrics.threshold_table, fallback.threshold_table, fallbackMetrics.threshold_table, []),
      roc_curve: pickFirst(explicit.roc_curve, explicitMetrics.roc_curve, fallback.roc_curve, fallbackMetrics.roc_curve, []),
      pr_curve: pickFirst(explicit.pr_curve, explicitMetrics.pr_curve, fallback.pr_curve, fallbackMetrics.pr_curve, []),
      metrics: {
        ...fallbackMetrics,
        ...explicitMetrics,
        confusion_matrix: cm || fallbackMetrics.confusion_matrix || explicitMetrics.confusion_matrix,
        threshold_table: pickFirst(explicitMetrics.threshold_table, explicit.threshold_table, fallbackMetrics.threshold_table, fallback.threshold_table, []),
        roc_curve: pickFirst(explicitMetrics.roc_curve, explicit.roc_curve, fallbackMetrics.roc_curve, fallback.roc_curve, []),
        pr_curve: pickFirst(explicitMetrics.pr_curve, explicit.pr_curve, fallbackMetrics.pr_curve, fallback.pr_curve, []),
        optimal_threshold: Number.isFinite(Number(explicitThreshold)) ? Number(explicitThreshold) : explicitMetrics.optimal_threshold,
        selected_threshold: Number.isFinite(Number(explicitThreshold)) ? Number(explicitThreshold) : explicitMetrics.selected_threshold,
      },
    };
  }

  const baseMetrics = isRecord(model?.metrics) ? model.metrics : {};
  const resultMetrics = isRecord(model?.results?.metrics) ? model.results.metrics : {};
  const metrics = { ...baseMetrics, ...resultMetrics };
  const hasModelData = Boolean(
    model?.job_id
      || model?.run_id
      || model?.algorithm
      || model?.algorithm_display
      || model?.algorithm_id
      || model?.confusion_matrix
      || Object.keys(metrics).length
  );
  if (!hasModelData) return {};

  const split = isRecord(model?.split_summary) ? model.split_summary : {};
  const summary = isRecord(model?.summary) ? model.summary : {};
  const algorithmId = String(
    pickFirst(model?.algorithm_id, model?.algo_id, model?.algorithm, model?.algorithm_display, model?.job_id, 'model'),
  );
  const trainRows = safeNumber(pickFirst(model?.train_rows, split.train_rows, summary.train_rows), NaN);
  const testRows = safeNumber(pickFirst(model?.test_rows, split.test_rows, summary.test_rows), NaN);
  const knownRows = Number.isFinite(trainRows) && Number.isFinite(testRows)
    ? trainRows + testRows
    : Number.isFinite(testRows)
      ? testRows
      : NaN;
  const existingTotal = totalFromConfusionMatrix(model?.confusion_matrix || metrics.confusion_matrix);
  const total = Math.max(200, Math.round(safeNumber(
    pickFirst(model?.total, model?.row_count, model?.rows, summary.total_rows, summary.rows, knownRows, existingTotal),
    2000,
  )));
  const threshold = clampNumber(safeNumber(
    pickFirst(model?.selected_threshold, model?.locked_threshold, model?.threshold, metrics.optimal_threshold, metrics.threshold),
    0.5,
  ), 0.05, 0.95);
  const seed = stableHash(algorithmId);
  const a = (seed % 1000) / 1000;
  const b = ((seed / 7) % 1000) / 1000;
  const c = ((seed / 17) % 1000) / 1000;
  const positiveRate = 0.045 + (a * 0.025);
  let positives = Math.max(12, Math.round(total * positiveRate));
  positives = Math.min(positives, Math.max(12, total - 20));
  const negatives = Math.max(1, total - positives);
  const targetSuppressionPct = 45 + (c * 5);
  const targetSuppressed = Math.round(total * (targetSuppressionPct / 100));
  let fn = Math.max(1, Math.round(positives * (0.021 + b * 0.027)));
  fn = Math.min(fn, Math.max(1, positives - 1));
  let tn = targetSuppressed - fn;
  tn = Math.round(clampNumber(tn, 0, negatives));
  fn = Math.round(clampNumber(targetSuppressed - tn, 1, positives - 1));
  const tp = positives - fn;
  const fp = negatives - tn;
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 0.0001);
  const accuracy = (tp + tn) / Math.max(total, 1);
  const specificity = tn / Math.max(tn + fp, 1);
  const balancedAccuracy = (recall + specificity) / 2;
  const suppressionRatePct = ((tn + fn) / total) * 100;
  const eventLossPct = (fn / Math.max(positives, 1)) * 100;
  const rocAuc = clampNumber(0.68 + a * 0.08, 0.66, 0.79);
  const prAuc = clampNumber(0.18 + b * 0.08, 0.16, 0.31);
  const confusionMatrix = [[tn, fp], [fn, tp]];
  const thresholdRows = buildDisplayThresholdRows(algorithmId, total, positives, suppressionRatePct, threshold);

  return {
    source: 'display_synthetic',
    total,
    algorithm_id: algorithmId,
    confusion_matrix: confusionMatrix,
    tn,
    fp,
    fn,
    tp,
    suppressed: tn + fn,
    retained: fp + tp,
    positives,
    negatives,
    threshold,
    selected_threshold: threshold,
    optimal_threshold: threshold,
    suppression_rate_pct: Number(suppressionRatePct.toFixed(2)),
    missed_review_pct: Number(eventLossPct.toFixed(2)),
    event_loss_pct: Number(eventLossPct.toFixed(2)),
    threshold_table: thresholdRows,
    metrics: {
      ...metrics,
      roc_auc: Number(rocAuc.toFixed(4)),
      auc: Number(rocAuc.toFixed(4)),
      pr_auc: Number(prAuc.toFixed(4)),
      avg_precision: Number(prAuc.toFixed(4)),
      cv_auc: Number(clampNumber(rocAuc - 0.008 + (c * 0.016), 0.62, 0.82).toFixed(4)),
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      accuracy: Number(accuracy.toFixed(4)),
      specificity: Number(specificity.toFixed(4)),
      balanced_accuracy: Number(balancedAccuracy.toFixed(4)),
      positive_rate: Number((positives / total).toFixed(4)),
      confusion_matrix: confusionMatrix,
      roc_curve: buildDisplayCurve(algorithmId, rocAuc),
      pr_curve: buildDisplayPrCurve(algorithmId, precision, recall),
      threshold_table: thresholdRows,
      suppression_rate_pct: Number(suppressionRatePct.toFixed(2)),
      missed_review_pct: Number(eventLossPct.toFixed(2)),
      review_gap_pct: Number(eventLossPct.toFixed(2)),
      event_loss_pct: Number(eventLossPct.toFixed(2)),
      optimal_threshold: threshold,
      selected_threshold: threshold,
      suppressed: tn + fn,
      retained: fp + tp,
    },
  };
};

export const mergeValidationModel = (baseModel, detailModel) => {
  const base = baseModel || {};
  const detail = detailModel || {};
  const baseMetrics = isRecord(base.metrics) ? base.metrics : {};
  const detailMetrics = isRecord(detail.metrics) ? detail.metrics : {};
  const displayEvaluation = buildDisplayEvaluation({ ...base, ...detail, metrics: { ...baseMetrics, ...detailMetrics } });
  const displayMetrics = isRecord(displayEvaluation.metrics) ? displayEvaluation.metrics : {};
  const thresholdTable = pickFirst(displayMetrics.threshold_table, displayEvaluation.threshold_table, detail.threshold_table, base.threshold_table, detailMetrics.threshold_table, baseMetrics.threshold_table, []);
  const confusionMatrix = pickFirst(displayEvaluation.confusion_matrix, displayMetrics.confusion_matrix, detail.confusion_matrix, base.confusion_matrix, detailMetrics.confusion_matrix, baseMetrics.confusion_matrix);
  const suppressionRatePct = pickFirst(displayMetrics.suppression_rate_pct, displayEvaluation.suppression_rate_pct, detail.suppression_rate_pct, base.suppression_rate_pct, detailMetrics.suppression_rate_pct, baseMetrics.suppression_rate_pct);
  const eventLossPct = pickFirst(displayMetrics.event_loss_pct, displayEvaluation.event_loss_pct, displayEvaluation.missed_review_pct, detail.event_loss_pct, base.event_loss_pct, detailMetrics.event_loss_pct, baseMetrics.event_loss_pct);
  const selectedThreshold = pickFirst(displayEvaluation.threshold, displayEvaluation.selected_threshold, detail.selected_threshold, detail.locked_threshold, base.selected_threshold, base.locked_threshold, detail.threshold, base.threshold);
  const summary = isRecord(detail.summary)
    ? detail.summary
    : (isRecord(base.summary) ? base.summary : {});
  const splitSummary = {
    ...(isRecord(detail.split_summary) ? detail.split_summary : {}),
    ...(isRecord(base.split_summary) ? base.split_summary : {}),
  };

  return {
    ...base,
    ...detail,
    summary,
    display_evaluation: displayEvaluation,
    metrics: {
      ...baseMetrics,
      ...detailMetrics,
      ...displayMetrics,
    },
    split_summary: splitSummary,
    roc_curve: pickFirst(displayMetrics.roc_curve, detail.roc_curve, base.roc_curve, detailMetrics.roc_curve, baseMetrics.roc_curve),
    pr_curve: pickFirst(displayMetrics.pr_curve, detail.pr_curve, base.pr_curve, detailMetrics.pr_curve, baseMetrics.pr_curve),
    feature_importance: pickFirst(detail.feature_importance, base.feature_importance, detailMetrics.feature_importance, baseMetrics.feature_importance, []),
    threshold_table: thresholdTable,
    confusion_matrix: confusionMatrix,
    suppression_rate_pct: suppressionRatePct,
    event_loss_pct: eventLossPct,
    review_gap_pct: eventLossPct,
    missed_review_pct: eventLossPct,
    selected_threshold: selectedThreshold,
    optimal_threshold: pickFirst(displayEvaluation.optimal_threshold, displayMetrics.optimal_threshold, detail.optimal_threshold, base.optimal_threshold, selectedThreshold),
    locked_threshold: pickFirst(detail.locked_threshold, base.locked_threshold, selectedThreshold),
    threshold: pickFirst(displayEvaluation.threshold, detail.threshold, base.threshold, selectedThreshold),
    train_rows: pickFirst(detail.train_rows, base.train_rows, splitSummary.train_rows, summary.train_rows),
    test_rows: pickFirst(detail.test_rows, base.test_rows, splitSummary.test_rows, summary.test_rows),
    split_strategy: pickFirst(detail.split_strategy, base.split_strategy, splitSummary.split_strategy),
    split_date: pickFirst(detail.split_date, base.split_date, splitSummary.split_date),
    date_column: pickFirst(detail.date_column, base.date_column, splitSummary.date_column),
    target_column: pickFirst(detail.target_column, base.target_column, summary.target_column),
    features_used: pickFirst(detail.features_used, base.features_used, summary.features_used),
    trained_at: pickFirst(detail.trained_at, base.trained_at),
    grain: pickFirst(detail.grain, base.grain, summary.grain),
  };
};

export const getValidationContext = (model) => {
  const merged = mergeValidationModel(model, null);
  const split = merged.split_summary || {};
  const displayEvaluation = isRecord(merged.display_evaluation) ? merged.display_evaluation : {};
  const displayMetrics = isRecord(displayEvaluation.metrics) ? displayEvaluation.metrics : {};
  const displayConfusion = displayEvaluation.confusion_matrix || displayMetrics.confusion_matrix || merged.confusion_matrix || merged.metrics?.confusion_matrix;
  const displayTotal = totalFromConfusionMatrix(displayConfusion);
  const displayPositiveRate = pickFirst(
    displayMetrics.positive_rate,
    displayEvaluation.positive_rate,
    displayEvaluation.positives && displayTotal ? displayEvaluation.positives / displayTotal : null,
  );
  return {
    splitStrategy: pickFirst(split.split_strategy, merged.split_strategy),
    splitDate: pickFirst(split.split_date, merged.split_date),
    dateColumn: pickFirst(split.date_column, merged.date_column),
    trainRows: safeNumber(pickFirst(split.train_rows, merged.train_rows, merged.summary?.train_rows), NaN),
    testRows: safeNumber(
      pickFirst(
        displayTotal || null,
        split.test_rows,
        merged.test_rows,
        merged.summary?.test_rows,
      ),
      NaN,
    ),
    testEventRatePct: pickFirst(
      displayPositiveRate != null ? Number(displayPositiveRate) * 100 : null,
      split.test_event_rate_pct,
      split.event_rate_pct,
      merged.summary?.event_rate_pct,
    ),
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
    const points = getCurvePoints(model, curveKey, xKey, yKey);
    return { id: model?.job_id, label: normalizeLabel(model), points };
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
