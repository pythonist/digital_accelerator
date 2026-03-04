import React, { useMemo } from 'react';
import { T, cardStyle } from './theme';
import { fmt, TXN_AGG_FEATURES, safe } from './utils';

const stageBox = (tone = 'default') => {
  const palette = {
    default: { bg: '#fff', border: T.border, fg: T.text },
    warn: { bg: T.warnSoft, border: '#fcd34d', fg: '#92400e' },
    good: { bg: T.goodSoft, border: '#86efac', fg: '#166534' },
  }[tone];
  return {
    ...cardStyle,
    padding: 10,
    background: palette.bg,
    borderColor: palette.border,
    color: palette.fg,
    display: 'grid',
    gap: 4,
    alignContent: 'start',
    minHeight: 72,
    textAlign: 'left',
    fontSize: 11.5,
  };
};

const StepTransactionRollup = ({
  rollups,
  rollupConfirmed,
  onConfirm,
  datasets = [],
  anchorType = '',
  labelSummary = null,
}) => {
  const primary = rollups[0] || null;

  const anchorRows = useMemo(() => {
    const ds = datasets.find((d) => safe(d.dataset_type) === safe(anchorType));
    return Number(ds?.row_count || 0);
  }, [datasets, anchorType]);

  const txnDataset = useMemo(() => (
    datasets.find((d) => safe(d.dataset_type) === safe(primary?.eventTable || ''))
  ), [datasets, primary?.eventTable]);

  const rawCols = Array.isArray(txnDataset?.columns) ? txnDataset.columns.slice(0, 14) : [];

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ ...cardStyle, padding: 8, background: T.badSoft, borderColor: '#fecaca' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#991b1b' }}>
          Rollup is mandatory to prevent row explosion
        </div>
        <div style={{ fontSize: 12, color: '#7f1d1d', marginTop: 4 }}>
          {primary
            ? `${fmt(primary.sourceRows)} transaction events cannot be joined directly to ${anchorType || 'alerts'}.`
            : 'Raw transaction events cannot be joined directly to alerts.'}
        </div>
      </div>

      {rollups.map((rollup) => {
        const before = Number(rollup.sourceRows || 0);
        const afterSqueeze = Math.max(1, Number(rollup.summaryRows || 0));
        const compressionRatio = before > 0 ? before / afterSqueeze : 0;
        const afterJoin = Math.max(anchorRows, Number(labelSummary?.n_total || anchorRows || afterSqueeze));
        const labelRows = Math.max(0, Number(labelSummary?.n_labelled || 0));
        const excludedRows = Math.max(0, afterJoin - labelRows);

        return (
          <div key={rollup.eventTable} style={{ ...cardStyle, padding: 8, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>
              Squeeze plan for {rollup.eventTable}
            </div>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div style={stageBox('warn')}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Raw table</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(before)} rows</div>
                <div>Many rows per account.</div>
              </div>
              <div style={stageBox('good')}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Grouped by {rollup.key || 'account_id'}</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(afterSqueeze)} rows</div>
                <div>{compressionRatio > 0 ? `${compressionRatio.toFixed(1)}x compression` : '-'}</div>
              </div>
              <div style={stageBox('default')}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>After join to {anchorType || 'alerts'}</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(afterJoin)} rows</div>
                <div>Rows stay at anchor grain.</div>
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 7, background: '#f8fafc' }}>
              <div style={{ fontSize: 11.5, color: T.text }}>
                Plain English: we keep one row per anchor entity. Transaction rows are converted into summary signals first,
                then joined as extra columns, not extra rows.
              </div>
              <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
                If your anchor starts at {fmt(afterJoin)} rows, joins enrich those rows; final {fmt(labelRows || afterJoin)} rows come from label eligibility,
                with {fmt(excludedRows)} removed as unlabeled or open cases.
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <div style={{ ...cardStyle, padding: 7 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  Raw transaction columns
                </div>
                <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                  {rawCols.length > 0 ? rawCols.map((c) => (
                    <div key={`${rollup.eventTable}_raw_${c}`} style={{ ...cardStyle, padding: '4px 6px', fontSize: 11, color: T.text, background: '#fff' }}>
                      {c}
                    </div>
                  )) : (
                    <div style={{ fontSize: 11, color: T.muted }}>Columns unavailable.</div>
                  )}
                </div>
              </div>

              <div style={{ ...cardStyle, padding: 7 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  Aggregated columns added after squeeze
                </div>
                <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                  <div style={{ ...cardStyle, padding: '4px 6px', fontSize: 11, color: T.text, background: '#fff' }}>
                    {rollup.key || 'account_id'}
                  </div>
                  {TXN_AGG_FEATURES.map((f) => (
                    <div key={`${rollup.eventTable}_agg_${f.col}`} style={{ ...cardStyle, padding: '4px 6px', fontSize: 11, color: T.text, background: '#fff' }}>
                      {f.col}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: T.text }}>
        <input
          aria-label="Confirm transaction rollup"
          type="checkbox"
          checked={rollupConfirmed}
          onChange={(e) => onConfirm(Boolean(e.target.checked))}
        />
        I understand the squeeze logic and confirm transaction rollup before join.
      </label>
    </div>
  );
};

export default StepTransactionRollup;
