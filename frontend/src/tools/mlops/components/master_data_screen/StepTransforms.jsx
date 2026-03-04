import React from 'react';
import { T, cardStyle, buttonStyle, inputStyle } from './theme';

const friendlyType = (type) => {
  if (type === 'drop_high_nulls') return 'Drop sparse columns';
  if (type === 'deduplicate') return 'Remove duplicates';
  if (type === 'date_parts') return 'Date parts';
  if (type === 'impute') return 'Missing value imputation';
  if (type === 'aggregate') return 'Aggregate by grain';
  return type;
};

const StepTransforms = ({
  transforms,
  nullThreshold,
  onChangeNullThreshold,
  dedupKey,
  onAddTransform,
  onRemoveTransform,
  onUpdateTransformConfig,
}) => {
  const extraTransforms = transforms.filter((t) => !['drop_high_nulls', 'deduplicate'].includes(t.type));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div style={{ ...cardStyle, padding: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Transform A - Drop sparse columns</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>
            Cases table only matched 15% of alerts. Columns that are mostly empty can destabilize training.
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11.5, color: T.text, marginBottom: 4 }}>
              Remove columns above <strong>{nullThreshold}%</strong> null values
            </div>
            <input
              aria-label="Sparse column threshold"
              type="range"
              min={70}
              max={99}
              step={1}
              value={nullThreshold}
              onChange={(e) => onChangeNullThreshold(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>Transform B - Remove duplicates</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>
            If the same alert appears twice, keep one copy.
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.text }}>
            Dedup key: <strong>{dedupKey}</strong>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Additional transforms</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={buttonStyle('secondary', false)} onClick={() => onAddTransform('date_parts')}>
              Add date parts
            </button>
            <button type="button" style={buttonStyle('secondary', false)} onClick={() => onAddTransform('impute')}>
              Add impute
            </button>
            <button type="button" style={buttonStyle('secondary', false)} onClick={() => onAddTransform('aggregate')}>
              Add aggregate
            </button>
          </div>
        </div>

        {extraTransforms.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: T.muted }}>
            No extra transforms added.
          </div>
        )}

        {extraTransforms.map((t) => (
          <div key={t.id} style={{ ...cardStyle, marginTop: 6, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{friendlyType(t.type)}</div>
              <button type="button" style={buttonStyle('secondary', false)} onClick={() => onRemoveTransform(t.id)}>
                Remove
              </button>
            </div>
            <input
              aria-label={`${t.type} config`}
              style={inputStyle}
              value={JSON.stringify(t.config || {})}
              onChange={(e) => onUpdateTransformConfig(t.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default StepTransforms;
