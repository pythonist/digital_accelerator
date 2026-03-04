import React, { useMemo } from 'react';
import { T, cardStyle } from './theme';
import { fmt, pct, safe } from './utils';

const StepSelectTables = ({
  tables,
  enabledTables,
  onToggle,
  joinProfileEstimated,
  onRefreshJoinProfile,
  loadingJoinProfile,
  datasets = [],
  anchorRows = 0,
}) => {
  const accountRows = useMemo(() => {
    const accountDs = datasets.find((d) => ['accounts', 'account'].includes(safe(d.dataset_type)));
    return Number(accountDs?.row_count || anchorRows || 0);
  }, [datasets, anchorRows]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
          Enable only tables that add business value.
        </div>
        <button
          type="button"
          onClick={onRefreshJoinProfile}
          disabled={loadingJoinProfile}
          style={{
            borderRadius: 8,
            border: `1px solid ${T.borderStrong}`,
            background: '#fff',
            color: T.text,
            fontWeight: 700,
            fontSize: 12,
            padding: '7px 11px',
            cursor: loadingJoinProfile ? 'not-allowed' : 'pointer',
            opacity: loadingJoinProfile ? 0.6 : 1,
          }}
        >
          {loadingJoinProfile ? 'Refreshing...' : 'Refresh join profile'}
        </button>
      </div>

      {joinProfileEstimated && (
        <div style={{ ...cardStyle, padding: 10, background: T.warnSoft, borderColor: '#fcd34d', color: '#92400e', fontSize: 12 }}>
          Join profile is estimated right now. Refresh join profile for actual coverage and match counts.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {tables.map((table) => {
          const selected = enabledTables.has(safe(table.type));
          const isTxn = safe(table.type).includes('transaction');
          const squeezeTo = Math.max(1, Number(accountRows || anchorRows || 1));
          const squeezeRatio = isTxn ? Number(table.rows || 0) / squeezeTo : null;
          return (
            <div
              key={table.type}
              style={{
                ...cardStyle,
                padding: 8,
                borderColor: selected ? T.orange : T.border,
                background: selected ? T.orangeSoft : '#fff',
                display: 'grid',
                gap: 8,
                alignContent: 'start',
              }}
            >
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{table.type}</div>
                  <div style={{ fontSize: 11.5, color: T.muted }}>{fmt(table.rows)} rows</div>
                </div>
                <input
                  aria-label={`Enable ${table.type}`}
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(table.type)}
                />
              </label>

              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 11.5, color: T.muted }}>
                  Join key: <strong style={{ color: T.text }}>{table.key || '-'}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: T.muted }}>
                  Match rate: <strong style={{ color: T.text }}>{pct(table.matchRate)}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: T.text }}>
                  {table.explainer}
                </div>
              </div>

              {isTxn && (
                <div style={{ ...cardStyle, padding: 8, background: T.warnSoft, borderColor: '#fcd34d', color: '#92400e', display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                    This high-volume table is squeezed before join.
                  </div>
                  <div style={{ fontSize: 11 }}>
                    {fmt(table.rows)} raw rows -&gt; about {fmt(squeezeTo)} account-level rows before joining.
                  </div>
                  <div style={{ fontSize: 11 }}>
                    Compression ratio: {squeezeRatio ? `${squeezeRatio.toFixed(1)}x` : '-'}.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StepSelectTables;
