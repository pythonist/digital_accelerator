import React, { useMemo } from 'react';
import { T, cardStyle, buttonStyle } from './theme';
import { fmt, safe, TXN_AGG_FEATURES } from './utils';

const metricTileStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 8,
  background: '#f8fafc',
};

const tableWrapStyle = {
  ...cardStyle,
  padding: 10,
  background: '#fff',
  display: 'grid',
  gap: 6,
};

const pickColumns = (rows = [], fallback = []) => {
  if (Array.isArray(rows) && rows.length > 0) {
    return Object.keys(rows[0]).slice(0, 8);
  }
  return (fallback || []).slice(0, 8);
};

const renderPreviewTable = ({ title, subtitle, columns, rows }) => (
  <div style={tableWrapStyle}>
    <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>{title}</div>
    {subtitle && <div style={{ fontSize: 10.5, color: T.muted }}>{subtitle}</div>}
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={`${title}_${col}`}
                style={{
                  textAlign: 'left',
                  padding: '5px 6px',
                  borderBottom: `1px solid ${T.border}`,
                  fontSize: 9.5,
                  color: T.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).slice(0, 6).map((row, idx) => (
            <tr key={`${title}_r_${idx}`} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
              {columns.map((col) => (
                <td
                  key={`${title}_${idx}_${col}`}
                  style={{
                    padding: '5px 6px',
                    borderBottom: `1px solid ${T.border}`,
                    fontSize: 10.5,
                    color: T.text,
                    verticalAlign: 'top',
                    wordBreak: 'break-word',
                  }}
                >
                  {String(row?.[col] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {(!rows || rows.length === 0) && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} style={{ padding: '8px 6px', fontSize: 10.5, color: T.muted }}>
                Preview unavailable.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

const StepAggregationExplain = ({
  rollups = [],
  aggregationByTable = {},
  loading = false,
  onRefresh,
  anchorType = 'alerts',
  labelSummary = null,
}) => {
  const labelRows = Number(labelSummary?.n_labelled || 0);
  const totalRows = Number(labelSummary?.n_total || 0);

  const content = useMemo(() => (
    (rollups || []).map((rollup) => {
      const key = safe(rollup.eventTable);
      const preview = aggregationByTable?.[key] || null;
      const rawRows = Array.isArray(preview?.preview) ? preview.preview : [];
      const rawColumns = pickColumns(rawRows, preview?.columns || []);
      const aggRows = Array.isArray(preview?.aggregation?.preview) ? preview.aggregation.preview : [];
      const aggFallbackColumns = [
        rollup.key || 'account_id',
        ...TXN_AGG_FEATURES.map((f) => f.col),
      ];
      const aggColumns = pickColumns(aggRows, preview?.aggregation?.columns || aggFallbackColumns);

      const rowsBefore = Number(rollup.sourceRows || preview?.row_count || 0);
      const rowsAfter = Math.max(1, Number(rollup.summaryRows || preview?.aggregation?.rows_after_sample || 1));
      const compression = rowsBefore > 0 ? rowsBefore / rowsAfter : 0;
      const joinedRows = Math.max(1, totalRows || rowsAfter);
      const finalRows = Math.max(0, labelRows || joinedRows);
      const removedRows = Math.max(0, joinedRows - finalRows);

      return {
        key,
        tableName: rollup.eventTable,
        joinKey: rollup.key || preview?.aggregation?.group_key || 'account_id',
        rowsBefore,
        rowsAfter,
        compression,
        joinedRows,
        finalRows,
        removedRows,
        rawRows,
        rawColumns,
        aggRows,
        aggColumns,
      };
    })
  ), [rollups, aggregationByTable, labelRows, totalRows]);

  if (!rollups.length) {
    return (
      <div style={{ ...cardStyle, padding: 10, background: '#f8fafc', fontSize: 11.5, color: T.muted }}>
        No transaction-like table is selected, so aggregation view is not required.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...cardStyle, padding: 12, background: T.orangeSoft, borderColor: T.orange }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.orange }}>
          Transaction aggregation view
        </div>
        <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
          We squeeze many transaction rows into one row per join key first, then join those features to {anchorType || 'alerts'}.
        </div>
        <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
          Plain English: joins add columns, not extra rows. Final drop to labeled rows comes from eligibility (no STR and no closed case outcome).
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            type="button"
            style={buttonStyle('secondary', loading)}
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? 'Refreshing...' : 'Refresh previews'}
          </button>
        </div>
      </div>

      {content.map((item) => (
        <div key={`agg_${item.key}`} style={{ ...cardStyle, padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>
            {item.tableName}: before and after squeeze
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div style={{ ...metricTileStyle, background: T.warnSoft, borderColor: '#fcd34d' }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Raw rows</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(item.rowsBefore)}</div>
            </div>
            <div style={{ ...metricTileStyle, background: T.goodSoft, borderColor: '#86efac' }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>After grouping by {item.joinKey}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(item.rowsAfter)}</div>
            </div>
            <div style={metricTileStyle}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Compression</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{item.compression > 0 ? `${item.compression.toFixed(1)}x` : '-'}</div>
            </div>
            <div style={{ ...metricTileStyle, background: '#fff' }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>After join at anchor grain</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(item.joinedRows)}</div>
            </div>
            <div style={{ ...metricTileStyle, background: '#fff' }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Final labeled rows</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(item.finalRows)}</div>
            </div>
            <div style={{ ...metricTileStyle, background: '#fff' }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Rows excluded later</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(item.removedRows)}</div>
            </div>
          </div>

          <div style={{ ...metricTileStyle, padding: 10 }}>
            <div style={{ fontSize: 11.5, color: T.text }}>
              Why this happens: {fmt(item.rowsBefore)} transaction rows are summarized to {fmt(item.rowsAfter)} {item.joinKey}-level rows.
              Joining this to {anchorType || 'alerts'} keeps about {fmt(item.joinedRows)} rows because each anchor row stays one row.
              Final labeled output is {fmt(item.finalRows)} after dropping unlabeled/open outcomes ({fmt(item.removedRows)} removed).
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {renderPreviewTable({
              title: 'Before: raw transaction sample',
              subtitle: `Table grain: many rows per ${item.joinKey}`,
              columns: item.rawColumns,
              rows: item.rawRows,
            })}
            {renderPreviewTable({
              title: 'After: aggregated sample',
              subtitle: `Table grain: one row per ${item.joinKey}`,
              columns: item.aggColumns,
              rows: item.aggRows,
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default StepAggregationExplain;
