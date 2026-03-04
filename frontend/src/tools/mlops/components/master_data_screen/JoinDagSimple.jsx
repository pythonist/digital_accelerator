import React, { useMemo } from 'react';
import { T, cardStyle } from './theme';
import { fmt, safe } from './utils';

const JoinDagSimple = ({ anchorType, activeJoins, datasets, masterRows }) => {
  const rowsByType = useMemo(() => {
    const map = {};
    datasets.forEach((d) => { map[safe(d.dataset_type)] = Number(d.row_count || 0); });
    return map;
  }, [datasets]);

  const edges = useMemo(() => activeJoins.map((j, idx) => ({
    id: `${idx}_${j.left}_${j.right}_${j.key}`,
    left: j.left,
    right: j.right,
    key: j.key,
    joinType: String(j.join_type || 'left').toUpperCase(),
  })), [activeJoins]);

  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Join DAG</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ ...cardStyle, padding: 10, borderColor: T.orange, background: T.orangeSoft }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.orange }}>
            Anchor: {anchorType || '-'}
          </div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 2 }}>
            {fmt(rowsByType[safe(anchorType)] || 0)} rows
          </div>
        </div>

        {edges.length === 0 && (
          <div style={{ fontSize: 11.5, color: T.muted }}>
            No active joins.
          </div>
        )}

        {edges.map((e) => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
            <div style={{ ...cardStyle, padding: '8px 10px', fontSize: 12, color: T.text }}>
              {e.left} ({fmt(rowsByType[safe(e.left)] || 0)})
            </div>
            <div style={{ fontSize: 11, color: T.muted, textAlign: 'center' }}>
              {e.joinType} on <strong style={{ color: T.text }}>{e.key}</strong>
              <div style={{ fontSize: 14 }}>-&gt;</div>
            </div>
            <div style={{ ...cardStyle, padding: '8px 10px', fontSize: 12, color: T.text }}>
              {e.right} ({fmt(rowsByType[safe(e.right)] || 0)})
            </div>
          </div>
        ))}

        <div style={{ ...cardStyle, padding: 10, borderColor: '#fed7aa', background: '#fffaf0' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.orange }}>MASTER DATASET</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 2 }}>{fmt(masterRows)} rows (estimated)</div>
        </div>
      </div>
    </div>
  );
};

export default JoinDagSimple;
