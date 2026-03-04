import React, { useMemo } from 'react';
import { T, cardStyle, buttonStyle } from './theme';
import { fmt, safe } from './utils';
import JoinDagSimple from './JoinDagSimple';
import AdvancedTechnical from './AdvancedTechnical';

const normalizeImpact = (previewImpact, fallbackImpact, anchorType) => {
  const fromPreview = Array.isArray(previewImpact) ? previewImpact : [];
  if (fromPreview.length) {
    return fromPreview.map((row, idx) => ({
      step: Number(row.step || idx + 1),
      from_source: row.from_source || anchorType || 'master',
      source: row.source || '-',
      join_key: row.join_key || row.key || '-',
      join_type: String(row.join_type || 'left').toLowerCase(),
      was_aggregated: Boolean(row.was_aggregated),
      aggregated_columns: Array.isArray(row.aggregated_columns) ? row.aggregated_columns : [],
      rows_before: Number(row.rows_before || 0),
      matched_rows: Number(row.matched_rows || 0),
      rows_after: Number(row.rows_after || 0),
      coverage_pct: Number(row.coverage_pct || 0),
      null_impact_pct: Number(row.null_impact_pct || 0),
    }));
  }

  const fromFallback = Array.isArray(fallbackImpact) ? fallbackImpact : [];
  return fromFallback.map((row, idx) => ({
    step: Number(row.idx || idx + 1),
    from_source: row.left || anchorType || 'master',
    source: row.right || '-',
    join_key: row.key || '-',
    join_type: String(row.join_type || 'left').toLowerCase(),
    was_aggregated: false,
    aggregated_columns: [],
    rows_before: Number(row.before_rows || 0),
    matched_rows: Number(row.matched_rows || 0),
    rows_after: Number(row.after_rows || 0),
    coverage_pct: Number(row.coverage_pct || 0),
    null_impact_pct: Number(row.null_impact_pct || 0),
  }));
};

const joinBehaviorText = (step) => {
  if (step.was_aggregated) {
    return 'This source was squeezed first to one row per join key, so it adds features without multiplying rows.';
  }
  if (step.join_type === 'left') {
    return 'LEFT join keeps all anchor rows. Unmatched rows get nulls in joined columns.';
  }
  if (step.join_type === 'inner') {
    return 'INNER join drops rows without matches.';
  }
  if (step.join_type === 'full') {
    return 'FULL join can add rows from either side if keys are missing on one side.';
  }
  return 'Join behavior depends on key coverage and selected join type.';
};

const StepPreviewBuild = ({
  summaryLines,
  anchorType,
  activeJoins,
  datasets,
  estimatedOutputRows,
  previewData,
  previewError,
  labelStats,
  labelSummary,
  onRefreshPreview,
  previewLoading,
  onBuild,
  building,
  error,
  buildLog,
  advancedOpen,
  onToggleAdvanced,
  rowImpact,
  tableSchemas = [],
  targetLabelName = 'str_label',
}) => {
  const columns = Array.isArray(previewData?.columns) ? previewData.columns.slice(0, 16) : [];
  const rows = Array.isArray(previewData?.rows) ? previewData.rows.slice(0, 12) : [];

  const impactRows = useMemo(
    () => normalizeImpact(previewData?.impact, rowImpact?.steps, anchorType),
    [previewData?.impact, rowImpact?.steps, anchorType],
  );

  const schemaByType = useMemo(() => {
    const map = new Map();
    (tableSchemas || []).forEach((t) => map.set(safe(t.type), t));
    return map;
  }, [tableSchemas]);

  const joinNarratives = useMemo(() => (
    impactRows.map((step) => {
      const schema = schemaByType.get(safe(step.source));
      const sourceColumns = Array.isArray(schema?.columns) ? schema.columns : [];
      const sourcePreviewColumns = sourceColumns.slice(0, 12);
      const addedColumns = step.was_aggregated
        ? (step.aggregated_columns || [])
        : sourceColumns.filter((c) => safe(c) !== safe(step.join_key));
      return {
        ...step,
        source_preview_columns: sourcePreviewColumns,
        added_columns: addedColumns.slice(0, 16),
        hidden_added_count: Math.max(0, addedColumns.length - 16),
        story: joinBehaviorText(step),
      };
    })
  ), [impactRows, schemaByType]);

  const resolvedLabelSummary = labelSummary || previewData?.label_summary || null;
  const startRows = Number(rowImpact?.anchorRows || joinNarratives[0]?.rows_before || 0);
  const afterJoinRows = Number(joinNarratives[joinNarratives.length - 1]?.rows_after || startRows);
  const labelledRows = Number(resolvedLabelSummary?.n_labelled || estimatedOutputRows || afterJoinRows);
  const excludedRows = Math.max(0, afterJoinRows - labelledRows);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 8 }}>What will be built</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {summaryLines.map((line) => (
            <div key={line} style={{ fontSize: 12, color: T.text }}>{line}</div>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 8 }}>
          Row journey in plain English
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div style={{ ...cardStyle, padding: 8, background: T.orangeSoft, borderColor: T.orange }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: T.muted, fontWeight: 700 }}>Start</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmt(startRows)}</div>
            <div style={{ fontSize: 11, color: T.text }}>{anchorType || 'alerts'} anchor rows</div>
          </div>
          <div style={{ ...cardStyle, padding: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: T.muted, fontWeight: 700 }}>After joins</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmt(afterJoinRows)}</div>
            <div style={{ fontSize: 11, color: T.text }}>Rows mostly unchanged, columns added</div>
          </div>
          <div style={{ ...cardStyle, padding: 8, background: T.goodSoft, borderColor: '#86efac' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: T.muted, fontWeight: 700 }}>Labeled output</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmt(labelledRows)}</div>
            <div style={{ fontSize: 11, color: T.text }}>{fmt(excludedRows)} rows excluded as unlabeled/open</div>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: 8, padding: 8, background: '#f8fafc' }}>
          <div style={{ fontSize: 11.5, color: T.text }}>
            Why {fmt(startRows)} and {fmt(datasets.find((d) => safe(d.dataset_type).includes('transaction'))?.row_count || 0)} can end near {fmt(labelledRows)}:
            transaction rows are squeezed first, joins add features not rows, and label eligibility filters the final supervised set.
          </div>
        </div>
      </div>

      <JoinDagSimple
        anchorType={anchorType}
        activeJoins={activeJoins}
        datasets={datasets}
        masterRows={estimatedOutputRows}
      />

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 8 }}>
          Join-by-join breakdown (before vs after)
        </div>

        {joinNarratives.length === 0 && (
          <div style={{ fontSize: 11.5, color: T.muted }}>No join impact details yet. Refresh preview.</div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {joinNarratives.map((step) => (
            <div key={`join_story_${step.step}_${step.source}`} style={{ ...cardStyle, padding: 9, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                  Step {step.step}: join {step.source} on {step.join_key}
                </div>
                <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase' }}>
                  {String(step.join_type || 'left').toUpperCase()} | coverage {step.coverage_pct.toFixed(1)}%
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8, marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                <div style={{ ...cardStyle, padding: '6px 8px', background: '#f8fafc' }}>
                  <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Rows before</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{fmt(step.rows_before)}</div>
                </div>
                <div style={{ ...cardStyle, padding: '6px 8px', background: '#f8fafc' }}>
                  <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Matched</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{fmt(step.matched_rows)}</div>
                </div>
                <div style={{ ...cardStyle, padding: '6px 8px', background: '#f8fafc' }}>
                  <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Rows after</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{fmt(step.rows_after)}</div>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 11.5, color: T.text }}>{step.story}</div>

              <div style={{ display: 'grid', gap: 8, marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <div style={{ ...cardStyle, padding: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                    Source table columns
                  </div>
                  <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    {step.source_preview_columns.length > 0 ? step.source_preview_columns.map((col) => (
                      <div key={`${step.source}_src_${col}`} style={{ ...cardStyle, padding: '4px 6px', background: '#fff', fontSize: 10.5, color: T.text }}>
                        {col}
                      </div>
                    )) : (
                      <div style={{ fontSize: 11, color: T.muted }}>No schema available for this source.</div>
                    )}
                  </div>
                </div>

                <div style={{ ...cardStyle, padding: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                    Columns added to master dataset
                  </div>
                  <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    {step.added_columns.length > 0 ? step.added_columns.map((col) => (
                      <div key={`${step.source}_add_${col}`} style={{ ...cardStyle, padding: '4px 6px', background: '#fff', fontSize: 10.5, color: T.text }}>
                        {col}
                      </div>
                    )) : (
                      <div style={{ fontSize: 11, color: T.muted }}>No added-column trace available.</div>
                    )}
                  </div>
                  {step.hidden_added_count > 0 && (
                    <div style={{ marginTop: 4, fontSize: 10.5, color: T.muted }}>
                      +{fmt(step.hidden_added_count)} additional columns
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 8 }}>
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

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 6 }}>Label distribution</div>
        <div style={{ fontSize: 12, color: T.text }}>
          Positives: <strong>{fmt(labelStats.positive)}</strong> | Negatives: <strong>{fmt(labelStats.negative)}</strong>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 8 }}>
        <button
          type="button"
          style={buttonStyle('primary', building)}
          disabled={building}
          onClick={onBuild}
        >
          {building ? 'Building...' : 'Build Master Dataset'}
        </button>

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

      <AdvancedTechnical open={advancedOpen} onToggle={onToggleAdvanced} previewData={previewData} />
    </div>
  );
};

export default StepPreviewBuild;
