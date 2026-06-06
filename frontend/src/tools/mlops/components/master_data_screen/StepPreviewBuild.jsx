import React from 'react';
import { T, cardStyle, buttonStyle } from './theme';
import { fmt } from './utils';

const StepPreviewBuild = ({
  estimatedOutputRows,
  previewData,
  previewError,
  labelStats,
  labelSummary,
  onRefreshPreview,
  previewLoading,
  onBuild,
  building,
  canContinue = false,
  onContinue,
  error,
  buildLog,
  targetLabelName = 'str_label',
}) => {
  const columns = Array.isArray(previewData?.columns) ? previewData.columns.slice(0, 16) : [];
  const rows = Array.isArray(previewData?.rows) ? previewData.rows.slice(0, 12) : [];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...cardStyle, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>Master dataset preview (first 12 rows)</div>
          <button type="button" style={buttonStyle('secondary', previewLoading)} onClick={onRefreshPreview} disabled={previewLoading}>
            {previewLoading ? 'Refreshing...' : 'Refresh preview'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 8 }}>
          Rows: {fmt(previewData?.row_count ?? estimatedOutputRows)} | Columns shown: {fmt(columns.length)} / {fmt(previewData?.columns?.length || 0)} | Target: {targetLabelName}
        </div>
        {previewError && (
          <div style={{ ...cardStyle, marginBottom: 8, padding: 8, background: T.badSoft, borderColor: '#fecaca', color: '#991b1b', fontSize: 11.5 }}>
            {previewError}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} style={{ textAlign: 'left', fontSize: 10, color: T.muted, textTransform: 'uppercase', padding: '6px 8px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`pr_${idx}`}>
                  {columns.map((c) => (
                    <td
                      key={`${idx}_${c}`}
                      style={{
                        fontSize: 11.5,
                        color: T.text,
                        padding: '6px 8px',
                        borderBottom: `1px solid ${T.border}`,
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        verticalAlign: 'top',
                        minWidth: 120,
                      }}
                    >
                      {String(r?.[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, columns.length)} style={{ fontSize: 11.5, color: T.muted, padding: '8px 8px' }}>
                    No preview rows yet. Refresh preview.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>Label distribution</div>
        <div style={{ fontSize: 12, color: T.text }}>
          Positives: <strong>{fmt(labelStats.positive)}</strong> | Negatives: <strong>{fmt(labelStats.negative)}</strong>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>Build status</div>
        <div style={{ fontSize: 11.5, color: T.text }}>
          {building
            ? 'Building the master dataset now. The footer action is locked until the run finishes.'
            : canContinue
              ? 'The build is current. Use the footer action to continue to the target step.'
              : 'Use the single footer action to build this master dataset after the join checks look right.'}
        </div>

        {error && (
          <div style={{ ...cardStyle, marginTop: 10, padding: 10, background: T.badSoft, borderColor: '#fecaca', color: '#991b1b', fontSize: 12 }}>
            {error}
          </div>
        )}

        {buildLog.length > 0 && (
          <div style={{ marginTop: 10, background: '#0f172a', color: '#94a3b8', borderRadius: 10, padding: 10, fontFamily: 'monospace', fontSize: 11.5 }}>
            {buildLog.map((line, idx) => (
              <div key={`blog_${idx}`} style={{ marginBottom: 3 }}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StepPreviewBuild;
