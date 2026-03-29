import React, { useMemo } from 'react';
import MasterDatasetFlowDiagram from './MasterDatasetFlowDiagram';
import { T, cardStyle } from './theme';
import { fmt, pct, safe, isEventTable } from './utils';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const guidanceForStep = ({
  currentStepId,
  anchorType,
  estimatedOutputRows,
  activeJoinCount,
  transformCount,
  strMode,
}) => {
  const anchor = anchorType || 'alerts';
  const byStep = {
    base: {
      now: `You are selecting the anchor table. One master row will represent one ${anchor} row.`,
      next: 'Next, choose which tables are allowed to enrich the anchor and verify join coverage.',
    },
    tables: {
      now: `You are choosing enrichment tables and join coverage. Active joins now: ${activeJoinCount}.`,
      next: 'Next, confirm transaction rollup to prevent row explosion before joins run.',
    },
    rollup: {
      now: 'You are confirming event-table rollup so high-volume tables do not duplicate anchor rows.',
      next: 'Next, review before/after aggregation tables to understand exactly how row squeeze works.',
    },
    aggregation: {
      now: 'You are reviewing raw vs aggregated transaction views and the exact row-compression logic.',
      next: 'Next, apply cleaning and transform rules before label mapping.',
    },
    transforms: {
      now: `You are defining data preparation rules. Active transforms now: ${transformCount}.`,
      next: 'Next, configure label policy and confirm supervision logic.',
    },
    labels: {
      now: `You are defining label governance. Current STR policy: ${strMode}.`,
      next: `Next, preview the final dataset and build an estimated ${fmt(estimatedOutputRows)} rows.`,
    },
    preview: {
      now: `You are in final validation. Expected master size is about ${fmt(estimatedOutputRows)} rows.`,
      next: 'Build will execute the configured join graph, transforms, and label policy.',
    },
  };
  return byStep[currentStepId] || byStep.base;
};

const MasterDatasetWorkbench = ({
  currentStepId,
  currentStepTitle,
  datasets,
  anchorType,
  enabledTables,
  activeJoins,
  joins,
  tableCards,
  rowImpact,
  estimatedOutputRows,
  joinProfileEstimated,
  transactionsSelected,
  skipRollup,
  rollupConfirmed,
  transforms,
  strMode,
  hasFanOutJoins,
  previewData = null,
  rollupTables = [],
}) => {
  const anchorKey = safe(anchorType);
  const tableCardByType = useMemo(() => {
    const map = new Map();
    (tableCards || []).forEach((table) => {
      map.set(safe(table.type), table);
    });
    return map;
  }, [tableCards]);

  const joinByType = useMemo(() => {
    const map = new Map();
    (joins || []).forEach((join) => {
      const left = safe(join.left);
      const right = safe(join.right);
      if (left === anchorKey && right) map.set(right, join);
      if (right === anchorKey && left) map.set(left, join);
    });
    (activeJoins || []).forEach((join) => {
      const left = safe(join.left);
      const right = safe(join.right);
      if (left === anchorKey && right) map.set(right, join);
      if (right === anchorKey && left) map.set(left, join);
    });
    return map;
  }, [joins, activeJoins, anchorKey]);

  const tableRows = useMemo(() => {
    return (datasets || []).map((dataset) => {
      const typeKey = safe(dataset.dataset_type);
      const isAnchor = typeKey === anchorKey;
      const selected = isAnchor || enabledTables.has(typeKey);
      const join = joinByType.get(typeKey) || null;
      const tableCard = tableCardByType.get(typeKey) || null;
      const matchedRows = Number(join?.matched_rows || 0);
      const anchorRows = Math.max(1, Number(rowImpact?.anchorRows || 0));
      const fallbackRate = matchedRows > 0 ? (matchedRows / anchorRows) * 100 : null;
      const matchRate = tableCard?.matchRate ?? fallbackRate;
      const joinKey = join?.key || tableCard?.key || '-';
      const joinType = String(join?.join_type || 'left').toUpperCase();

      let decision = 'Not selected';
      if (isAnchor) decision = 'Anchor grain';
      else if (selected && join) decision = `${joinType} join on ${joinKey}`;
      else if (selected) decision = 'Selected, waiting for join profile';

      let impactText = 'Excluded from final master dataset.';
      if (isAnchor) {
        impactText = `All rows start from this table (${fmt(rowImpact?.anchorRows || dataset.row_count || 0)} rows).`;
      } else if (selected && matchRate != null) {
        impactText = `${Math.round(clamp(Number(matchRate || 0), 0, 100))}% anchor coverage expected.`;
      } else if (selected) {
        impactText = 'Coverage is pending profile refresh.';
      }

      const rollupNeeded = selected && isEventTable(typeKey) && transactionsSelected && !skipRollup;
      return {
        id: `${dataset.dataset_id}_${dataset.dataset_type}`,
        name: dataset.dataset_type,
        rows: Number(dataset.row_count || 0),
        isAnchor,
        selected,
        decision,
        joinKey,
        matchRate,
        impactText,
        rollupNeeded,
      };
    });
  }, [datasets, anchorKey, enabledTables, joinByType, tableCardByType, rowImpact?.anchorRows, transactionsSelected, skipRollup]);

  const guidance = guidanceForStep({
    currentStepId,
    anchorType,
    estimatedOutputRows,
    activeJoinCount: activeJoins.length,
    transformCount: transforms.length,
    strMode,
  });

  const dagImpactRows = useMemo(() => {
    const previewImpact = Array.isArray(previewData?.impact) ? previewData.impact : [];
    if (previewImpact.length) {
      return previewImpact.map((row, idx) => ({
        idx: Number(row.step || idx + 1),
        left: row.from_source || anchorType || 'master',
        right: row.source || '-',
        key: row.join_key || row.key || '-',
        join_type: row.join_type || 'left',
        before_rows: Number(row.rows_before || 0),
        matched_rows: Number(row.matched_rows || 0),
        after_rows: Number(row.rows_after || 0),
        coverage_pct: Number(row.coverage_pct || 0),
        null_impact_pct: Number(row.null_impact_pct || 0),
      }));
    }
    return rowImpact?.steps || [];
  }, [previewData?.impact, rowImpact?.steps, anchorType]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ ...cardStyle, padding: 8, borderColor: T.orange, background: T.orangeSoft }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.orange }}>Current operation</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text, marginTop: 4 }}>{currentStepTitle}</div>
        <div style={{ fontSize: 11.5, color: T.text, marginTop: 6 }}>{guidance.now}</div>
        <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, border: `1px solid ${T.borderStrong}`, background: '#fff' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>What happens next</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 3 }}>{guidance.next}</div>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 6 }}>Execution telemetry</div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))' }}>
          <div style={{ ...cardStyle, padding: 7, background: '#fff' }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Anchor rows</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>{fmt(rowImpact?.anchorRows || 0)}</div>
          </div>
          <div style={{ ...cardStyle, padding: 7, background: '#fff' }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Active joins</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>{fmt(activeJoins.length)}</div>
          </div>
          <div style={{ ...cardStyle, padding: 7, background: '#fff' }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Transforms</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>{fmt(transforms.length)}</div>
          </div>
          <div style={{ ...cardStyle, padding: 7, background: '#fff' }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase' }}>Estimated output rows</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginTop: 2 }}>{fmt(estimatedOutputRows)}</div>
          </div>
        </div>
      </div>

      {joinProfileEstimated && (
        <div style={{ ...cardStyle, padding: 10, borderColor: '#fcd34d', background: T.warnSoft, color: '#92400e', fontSize: 11.5 }}>
          Join profile is estimated right now. Coverage values can change after you refresh the join profile.
        </div>
      )}

      {hasFanOutJoins && (
        <div style={{ ...cardStyle, padding: 10, borderColor: '#fca5a5', background: T.badSoft, color: '#991b1b', fontSize: 11.5 }}>
          Fan-out risk detected. Keep rollup enabled for event tables to preserve one row per anchor entity.
        </div>
      )}

      {transactionsSelected && !skipRollup && !rollupConfirmed && (
        <div style={{ ...cardStyle, padding: 10, borderColor: '#fcd34d', background: T.warnSoft, color: '#92400e', fontSize: 11.5 }}>
          Transaction-like tables are selected. Confirm rollup before build to avoid row multiplication.
        </div>
      )}

      <div style={{ ...cardStyle, padding: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 6 }}>Table workbench</div>
        <div style={{ overflowX: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {['Table', 'Rows', 'Role', 'Join key', 'Coverage', 'Decision impact'].map((head) => (
                  <th
                    key={head}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: `1px solid ${T.border}`,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: T.muted,
                      textTransform: 'uppercase',
                    }}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.id} style={{ background: row.isAnchor ? T.orangeSoft : '#fff' }}>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.text, fontWeight: row.isAnchor ? 700 : 600, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {row.name}
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {fmt(row.rows)}
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {row.isAnchor ? 'Anchor' : row.selected ? 'Selected join table' : 'Excluded'}
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {row.joinKey}
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {row.isAnchor ? '100%' : pct(row.matchRate)}
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, verticalAlign: 'top', wordBreak: 'break-word', lineHeight: 1.35 }}>
                    {row.decision}. {row.impactText}
                    {row.rollupNeeded && !rollupConfirmed ? ' Rollup confirmation is pending.' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MasterDatasetFlowDiagram
        datasets={datasets}
        anchorType={anchorType}
        activeJoins={activeJoins}
        rowImpact={{ ...(rowImpact || {}), steps: dagImpactRows }}
        estimatedOutputRows={estimatedOutputRows}
        previewData={previewData}
        rollupTables={rollupTables}
        joinProfileEstimated={joinProfileEstimated}
      />
    </div>
  );
};

export default MasterDatasetWorkbench;
