import React, { useMemo } from 'react';
import { T, cardStyle } from './theme';
import { fmt, pct, safe, joinWouldFanOut } from './utils';

const StepSelectTables = ({
  tables,
  enabledTables,
  onToggle,
  joinProfileEstimated,
  onRefreshJoinProfile,
  loadingJoinProfile,
  datasets = [],
  anchorRows = 0,
  anchorType = '',
  activeJoins = [],
  rowImpact = null,
  hasFanOutJoins = false,
}) => {
  const accountRows = useMemo(() => {
    const accountDs = datasets.find((d) => ['accounts', 'account'].includes(safe(d.dataset_type)));
    return Number(accountDs?.row_count || anchorRows || 0);
  }, [datasets, anchorRows]);
  const afterJoinRows = Number(rowImpact?.finalRows || anchorRows || 0);
  const joinPlan = useMemo(() => (
    tables.map((table) => {
      const relatedJoin = (activeJoins || []).find((join) => (
        safe(join.left) === safe(table.type) || safe(join.right) === safe(table.type)
      ));
      return {
        type: table.type,
        joinKey: relatedJoin?.key || table.key || '-',
        joinType: String(relatedJoin?.join_type || 'left').toUpperCase(),
        fanOutRisk: relatedJoin ? joinWouldFanOut(relatedJoin, datasets) : false,
      };
    })
  ), [activeJoins, datasets, tables]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ ...cardStyle, padding: 10, background: '#fff' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>
          Join plan and row checks
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div style={{ ...cardStyle, padding: 8, background: T.orangeSoft, borderColor: T.orange }}>
            <div style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', fontWeight: 700 }}>Anchor table</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{anchorType || 'alerts'}</div>
            <div style={{ fontSize: 11.5, color: T.text }}>{fmt(anchorRows)} starting rows</div>
          </div>
          <div style={{ ...cardStyle, padding: 8, background: '#fff' }}>
            <div style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', fontWeight: 700 }}>Projected rows after joins</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{fmt(afterJoinRows)}</div>
            <div style={{ fontSize: 11.5, color: T.text }}>This should stay close to the anchor row count before label filtering.</div>
          </div>
          <div style={{ ...cardStyle, padding: 8, background: hasFanOutJoins ? T.warnSoft : T.goodSoft, borderColor: hasFanOutJoins ? '#fcd34d' : '#86efac' }}>
            <div style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', fontWeight: 700 }}>Explosion check</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{hasFanOutJoins ? 'Review join map' : 'No row explosion flagged'}</div>
            <div style={{ fontSize: 11.5, color: T.text }}>
              {hasFanOutJoins
                ? 'A high-volume event table still looks like a 1:many join. Keep it aggregated before you build.'
                : 'Current join keys look compatible with a stable one-row-per-alert master grain.'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
          Enable only tables that add business value, then review them one by one.
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
          const joinMeta = joinPlan.find((item) => safe(item.type) === safe(table.type)) || null;
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
                  Join mode: <strong style={{ color: T.text }}>{joinMeta?.joinType || 'LEFT'}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: T.muted }}>
                  Match rate: <strong style={{ color: T.text }}>{pct(table.matchRate)}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: T.text }}>
                  {table.explainer}
                </div>
              </div>

              {joinMeta?.fanOutRisk && (
                <div style={{ ...cardStyle, padding: 8, background: T.warnSoft, borderColor: '#fcd34d', color: '#92400e', display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                    Join explosion check
                  </div>
                  <div style={{ fontSize: 11 }}>
                    This path can multiply alert rows if the table is joined raw. Aggregate or squeeze it first, then join on {joinMeta.joinKey}.
                  </div>
                </div>
              )}

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
