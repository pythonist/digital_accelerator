export const unwrap = (resp) => {
  const body = resp?.data ?? resp;
  return body?.data ?? body;
};

export const fmt = (v, d = 3) => (v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toFixed(d));

export const pct = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '-' : `${Number(v).toFixed(d)}%`);

export const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toFixed(d));

export const safeNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const normalizeLabel = (run) => run?.label || run?.algorithm_display || run?.algorithm || run?.job_id?.slice?.(0, 8) || 'Model';

export const buildCurveGrid = (models, curveKey, xKey, yKey, step = 0.02) => {
  const grid = Array.from({ length: Math.floor(1 / step) + 1 }, (_, i) => Number((i * step).toFixed(2)));
  const series = models.map((m) => {
    const raw = (m?.[curveKey] || []).map((p) => ({ x: Number(p[xKey] ?? 0), y: Number(p[yKey] ?? 0) }))
      .sort((a, b) => a.x - b.x);
    return { id: m.job_id, label: normalizeLabel(m), points: raw };
  });
  const interpolate = (points, x) => {
    if (!points.length) return 0;
    if (x <= points[0].x) return points[0].y;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(b.x - a.x, 1e-6);
        return a.y + (b.y - a.y) * t;
      }
    }
    return points[points.length - 1].y;
  };
  const data = grid.map((x) => {
    const row = { x };
    series.forEach((s) => {
      row[s.id] = interpolate(s.points, x);
    });
    return row;
  });
  return { data, series };
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
