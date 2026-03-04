import React from 'react';
import { T, cardStyle, buttonStyle } from './theme';
import { fmt, pct } from './utils';

const cell = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: `1px solid ${T.border}`,
  fontSize: 11.5,
  color: T.text,
};

const AdvancedTechnical = ({ open, onToggle, previewData }) => {
  const impactRows = Array.isArray(previewData?.impact) ? previewData.impact : [];
  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>Advanced / Technical</div>
        <button type="button" style={buttonStyle('secondary', false)} onClick={onToggle}>
          {open ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Step', 'From', 'To', 'Join key', 'Join', 'Aggregated', 'Before', 'Matched', 'After', 'Coverage'].map((h) => (
                  <th key={h} style={{ ...cell, fontSize: 10, textTransform: 'uppercase', color: T.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {impactRows.map((r, idx) => (
                <tr key={`adv_${idx}`}>
                  <td style={cell}>{fmt(r.step ?? idx + 1)}</td>
                  <td style={cell}>{r.from_source || '-'}</td>
                  <td style={cell}>{r.source || '-'}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{r.join_key || '-'}</td>
                  <td style={cell}>{String(r.join_type || '').toUpperCase()}</td>
                  <td style={cell}>{r.was_aggregated ? 'Yes' : 'No'}</td>
                  <td style={cell}>{fmt(r.rows_before)}</td>
                  <td style={cell}>{fmt(r.matched_rows)}</td>
                  <td style={cell}>{fmt(r.rows_after)}</td>
                  <td style={cell}>{pct(r.coverage_pct)}</td>
                </tr>
              ))}
              {impactRows.length === 0 && (
                <tr>
                  <td style={cell} colSpan={10}>No backend trace available yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdvancedTechnical;
