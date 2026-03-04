import React from 'react';
import { T, cardStyle } from './theme';
import { fmt, safe, tableDescription } from './utils';

const StepBaseTable = ({ datasets, anchorType, onSelectAnchor }) => {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ ...cardStyle, borderColor: T.orange, background: T.orangeSoft, padding: 8, fontSize: 11.5, color: T.text }}>
        Every row in your master dataset will be one <strong>{anchorType || 'alerts'}</strong> row.
        All other tables will be joined onto this base.
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {datasets.map((ds) => {
          const typeKey = safe(ds.dataset_type);
          const selected = safe(anchorType) === typeKey;
          const recommended = typeKey === 'alerts';
          return (
            <button
              key={ds.dataset_id}
              type="button"
              onClick={() => onSelectAnchor(ds.dataset_type)}
              style={{
                ...cardStyle,
                textAlign: 'left',
                padding: 8,
                cursor: 'pointer',
                borderColor: selected ? T.orange : T.border,
                background: selected ? T.orangeSoft : '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{ds.dataset_type}</div>
                {recommended && (
                  <span style={{ fontSize: 10, fontWeight: 800, background: T.goodSoft, color: T.good, border: `1px solid #86efac`, borderRadius: 999, padding: '2px 8px' }}>
                    Recommended
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{fmt(ds.row_count)} rows</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 5 }}>{tableDescription(ds.dataset_type)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StepBaseTable;
