import React, { useId, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';

import { T, buttonStyle, cardStyle } from './theme';
import { findDatasetByType, fmt, safe, tableDescription } from './utils';

const FLOW_COLORS = {
  blueFill: '#E6F1FB',
  blueStroke: '#185FA5',
  blueText: '#0C447C',
  amberFill: '#FAEEDA',
  amberStroke: '#854F0B',
  amberText: '#633806',
  greenFill: '#EAF3DE',
  greenStroke: '#3B6D11',
  greenText: '#27500A',
  grayFill: '#F1EFE8',
  grayStroke: '#5F5E5A',
  grayText: '#444441',
  arrow: '#888',
};

const KNOWN_STEP_ORDER = ['cases', 'accounts', 'customers', 'transactions', 'str', 'sar'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const humanizeType = (value) => {
  const key = safe(value).replace(/_agg$/, '');
  const map = {
    alerts: 'alerts',
    alert: 'alerts',
    cases: 'cases',
    case: 'cases',
    accounts: 'accounts',
    account: 'accounts',
    customers: 'customers',
    customer: 'customers',
    transactions: 'transactions',
    transaction: 'transactions',
    txns: 'transactions',
    txn: 'transactions',
    str: 'STR',
    sar: 'SAR',
  };
  return map[key] || String(value || 'table').replace(/_/g, ' ');
};

const titleCase = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const rowLabel = (value, { approximate = false } = {}) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return approximate ? '~0 rows' : '0 rows';
  return `${approximate ? '~' : ''}${fmt(n)} rows`;
};

const pctLabel = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'Coverage pending';
  return `${Number(value).toFixed(1)}% coverage`;
};

const canonicalJoinType = (value) => {
  const key = safe(value) || 'left';
  if (key === 'outer') return 'full';
  return key;
};

const joinTypeLabel = (value) => {
  const key = canonicalJoinType(value);
  if (key === 'inner') return 'INNER JOIN';
  if (key === 'right') return 'RIGHT JOIN';
  if (key === 'full') return 'FULL JOIN';
  return 'LEFT JOIN';
};

const normalizeStepSource = (value) => safe(value).replace(/_agg$/, '');

const describeJoinStep = ({ step, rollupMap, anchorType }) => {
  const sourceKey = normalizeStepSource(step.source);
  const joinKey = String(step.join_key || step.key || 'id').toUpperCase();
  const joinLabel = `${joinTypeLabel(step.join_type)} on ${joinKey}`;
  const coverage = step.coverage_pct == null ? null : Number(step.coverage_pct);
  const matchedRows = Number(step.matched_rows || 0);
  const beforeRows = Number(step.rows_before || 0);
  const afterRows = Number(step.rows_after || 0);
  const unmatchedRows = Math.max(beforeRows - matchedRows, 0);
  const isAggregated = Boolean(step.was_aggregated) || /_agg$/i.test(String(step.source || ''));
  const rollup = rollupMap.get(sourceKey) || null;
  const aggregatedColumns = Array.isArray(step.aggregated_columns) ? step.aggregated_columns.slice(0, 6) : [];
  const sourceLabel = humanizeType(step.source || sourceKey || 'table');

  if (sourceKey === 'cases' || sourceKey === 'case') {
    return {
      title: 'Case outcome join',
      accent: FLOW_COLORS.blueStroke,
      joinLabel,
      why: 'Matches each alert to its investigation record so the workflow can decide whether the alert is supervised, unresolved, or excluded.',
      adds: 'Adds case status and final investigation outcome used to derive the training label.',
      effect: `${fmt(matchedRows)} alerts matched a case, leaving ${fmt(unmatchedRows)} alerts without investigation coverage.`,
      coverage: pctLabel(coverage),
      rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
      detail: 'Alerts with no case stay unmatched after the left join and later drop out of supervised training because they do not have a reliable outcome.',
    };
  }

  if (sourceKey === 'accounts' || sourceKey === 'account') {
    return {
      title: 'Account enrichment join',
      accent: FLOW_COLORS.greenStroke,
      joinLabel,
      why: 'Connects each alert to the account it belongs to so the model sees account-level risk, product, segment, and lifecycle context.',
      adds: 'Typical additions include account type, segment, customer linkages, and account risk descriptors.',
      effect: `${fmt(matchedRows)} alerts matched account context.${coverage != null ? ` ${pctLabel(coverage)}.` : ''}`,
      coverage: pctLabel(coverage),
      rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
      detail: 'This is designed to preserve one row per alert. Unmatched alerts stay in the master table with null account attributes rather than duplicating rows.',
    };
  }

  if (sourceKey === 'customers' || sourceKey === 'customer') {
    return {
      title: 'Customer KYC join',
      accent: FLOW_COLORS.greenStroke,
      joinLabel,
      why: 'Brings customer ownership and KYC context onto the alert through the customer relationship.',
      adds: 'Adds customer profile, geography, occupation, PEP or sanctions flags, and broader customer risk context.',
      effect: `${fmt(matchedRows)} alert rows received customer enrichment.${coverage != null ? ` ${pctLabel(coverage)}.` : ''}`,
      coverage: pctLabel(coverage),
      rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
      detail: 'Customer enrichment helps the model understand who owns the alerted account without changing the alert grain.',
    };
  }

  if (sourceKey === 'transactions' || sourceKey === 'transaction' || sourceKey === 'txns' || sourceKey === 'txn') {
    const rollupLine = rollup
      ? `${fmt(rollup.sourceRows)} raw transactions are summarized to about ${fmt(rollup.summaryRows)} ${humanizeType(rollup.key || 'account')} groups before the join.`
      : 'High-volume transaction rows are summarized before joining so one alert does not explode into many rows.';
    const addedCols = aggregatedColumns.length
      ? `Aggregated features include ${aggregatedColumns.join(', ')}.`
      : 'Aggregated features typically include counts, total volume, averages, and velocity signals.';
    return {
      title: isAggregated ? 'Transaction rollup join' : 'Transaction enrichment join',
      accent: FLOW_COLORS.amberStroke,
      joinLabel,
      why: 'Raw transactions are many-to-one against alerts and accounts, so the workflow compresses them into account-level features before joining.',
      adds: addedCols,
      effect: rollupLine,
      coverage: pctLabel(coverage),
      rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
      detail: 'This prevents row fan-out and keeps the finished master dataset at one row per alert while still capturing behavioral signals from transaction history.',
    };
  }

  if (sourceKey === 'str' || sourceKey === 'sar') {
    return {
      title: 'STR linkage join',
      accent: FLOW_COLORS.amberStroke,
      joinLabel,
      why: 'Links alerts to suspicious report evidence so confirmed suspicious outcomes can be treated as high-confidence positives.',
      adds: 'Adds a high-precision supervisory signal that complements case outcomes.',
      effect: `${fmt(matchedRows)} alerts linked to STR evidence.${coverage != null ? ` ${pctLabel(coverage)}.` : ''}`,
      coverage: pctLabel(coverage),
      rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
      detail: 'STR linkage is typically sparse but valuable because it confirms real suspicious behavior with stronger evidence than broad alert rules alone.',
    };
  }

  return {
    title: `${titleCase(sourceLabel)} join`,
    accent: T.orange,
    joinLabel,
    why: tableDescription(sourceKey),
    adds: `Adds ${sourceLabel} attributes using ${joinLabel.toLowerCase()}.`,
    effect: `${fmt(matchedRows)} rows matched.${coverage != null ? ` ${pctLabel(coverage)}.` : ''}`,
    coverage: pctLabel(coverage),
    rows: `Rows before ${fmt(beforeRows)} -> after ${fmt(afterRows)}`,
    detail: 'The join enriches the anchor alert row without changing the intended master grain unless the selected source is left unaggregated.',
  };
};

const FlowSvg = ({ metrics }) => {
  const markerId = useId().replace(/:/g, '');
  const hasCaseFilter = metrics.hasCaseJoin;
  const step1Title = hasCaseFilter ? 'Filter 1: no case = no label' : 'Filter 1: no label evidence';
  const step1Subtitle = hasCaseFilter
    ? `${fmt(metrics.noCaseDropped)} alerts had no matched case`
    : `${fmt(metrics.totalExcluded)} alerts lacked resolved label evidence`;
  const middleTitle = hasCaseFilter ? 'Alerts with a case' : 'Alerts with label evidence';
  const middleSubtitle = hasCaseFilter
    ? rowLabel(metrics.withCaseRows)
    : `${fmt(metrics.totalRows - metrics.totalExcluded)} rows still eligible`;
  const step2Title = hasCaseFilter ? 'Filter 2: OPEN cases excluded' : 'Filter 2: unresolved outcomes excluded';
  const step2Subtitle = hasCaseFilter
    ? `${fmt(metrics.openDropped)} OPEN or unresolved rows removed`
    : 'Unknown outcomes do not train the model';
  const dropped2Label = hasCaseFilter ? `${rowLabel(metrics.openDropped)} (OPEN)` : rowLabel(metrics.totalExcluded);

  return (
    <svg width="100%" viewBox="0 0 680 500" role="img" aria-label="Master dataset creation flow">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      <g>
        <rect x="190" y="30" width="300" height="56" rx="8" fill={FLOW_COLORS.blueFill} stroke={FLOW_COLORS.blueStroke} strokeWidth="0.5" />
        <text x="340" y="51" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.blueText}>
          {metrics.topTitle}
        </text>
        <text x="340" y="70" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.blueText}>
          {rowLabel(metrics.totalRows)}
        </text>
      </g>

      <line x1="340" y1="86" x2="340" y2="126" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <g>
        <rect x="190" y="130" width="300" height="56" rx="8" fill={FLOW_COLORS.amberFill} stroke={FLOW_COLORS.amberStroke} strokeWidth="0.5" />
        <text x="340" y="151" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.amberText}>
          {step1Title}
        </text>
        <text x="340" y="170" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.amberText}>
          {step1Subtitle}
        </text>
      </g>

      <g>
        <rect x="520" y="140" width="140" height="44" rx="8" fill={FLOW_COLORS.grayFill} stroke={FLOW_COLORS.grayStroke} strokeWidth="0.5" />
        <text x="590" y="157" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.grayText}>
          Dropped
        </text>
        <text x="590" y="175" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.grayText}>
          {rowLabel(metrics.noCaseDropped)}
        </text>
      </g>
      <line x1="490" y1="158" x2="518" y2="162" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <line x1="340" y1="186" x2="340" y2="226" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <g>
        <rect x="220" y="230" width="240" height="44" rx="8" fill={FLOW_COLORS.blueFill} stroke={FLOW_COLORS.blueStroke} strokeWidth="0.5" />
        <text x="340" y="247" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.blueText}>
          {middleTitle}
        </text>
        <text x="340" y="265" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.blueText}>
          {middleSubtitle}
        </text>
      </g>

      <line x1="340" y1="274" x2="340" y2="314" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <g>
        <rect x="190" y="318" width="300" height="56" rx="8" fill={FLOW_COLORS.amberFill} stroke={FLOW_COLORS.amberStroke} strokeWidth="0.5" />
        <text x="340" y="339" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.amberText}>
          {step2Title}
        </text>
        <text x="340" y="358" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.amberText}>
          {step2Subtitle}
        </text>
      </g>

      <g>
        <rect x="520" y="328" width="140" height="44" rx="8" fill={FLOW_COLORS.grayFill} stroke={FLOW_COLORS.grayStroke} strokeWidth="0.5" />
        <text x="590" y="345" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.grayText}>
          Dropped
        </text>
        <text x="590" y="363" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.grayText}>
          {dropped2Label}
        </text>
      </g>
      <line x1="490" y1="346" x2="518" y2="350" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <line x1="340" y1="374" x2="340" y2="414" stroke={FLOW_COLORS.arrow} strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />

      <g>
        <rect x="220" y="418" width="240" height="56" rx="8" fill={FLOW_COLORS.greenFill} stroke={FLOW_COLORS.greenStroke} strokeWidth="0.5" />
        <text x="340" y="439" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="500" fontFamily="sans-serif" fill={FLOW_COLORS.greenText}>
          Training dataset
        </text>
        <text x="340" y="458" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="400" fontFamily="sans-serif" fill={FLOW_COLORS.greenText}>
          {rowLabel(metrics.labelledRows)}
        </text>
      </g>
    </svg>
  );
};

const JoinCard = ({ item }) => (
  <div style={{ ...cardStyle, padding: 12, background: '#fff', borderColor: item.accent }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: item.accent, textTransform: 'uppercase', letterSpacing: 0.45 }}>
      {item.title}
    </div>
    <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginTop: 4 }}>
      {item.joinLabel}
    </div>
    <div style={{ fontSize: 11.5, color: T.text, marginTop: 7, lineHeight: 1.55 }}>
      {item.why}
    </div>
    <div style={{ fontSize: 11.5, color: T.text, marginTop: 6, lineHeight: 1.55 }}>
      <strong>What it adds:</strong> {item.adds}
    </div>
    <div style={{ fontSize: 11.5, color: T.text, marginTop: 6, lineHeight: 1.55 }}>
      <strong>Row effect:</strong> {item.effect}
    </div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
        {item.coverage}
      </div>
      <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
        {item.rows}
      </div>
    </div>
    <div style={{ fontSize: 11, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
      {item.detail}
    </div>
  </div>
);

const MasterDatasetFlowDiagram = ({
  datasets,
  anchorType,
  activeJoins,
  rowImpact,
  estimatedOutputRows,
  previewData,
  rollupTables,
  joinProfileEstimated,
}) => {
  const [expanded, setExpanded] = useState(false);

  const impactSteps = useMemo(() => {
    const previewImpact = Array.isArray(previewData?.impact) ? previewData.impact : [];
    if (previewImpact.length) return previewImpact;

    const fallbackSteps = Array.isArray(rowImpact?.steps) ? rowImpact.steps : [];
    if (fallbackSteps.length) {
      return fallbackSteps.map((step) => ({
        ...step,
        source: step.right || step.source,
        from_source: step.left || step.from_source,
        join_key: step.key || step.join_key,
        rows_before: step.before_rows,
        rows_after: step.after_rows,
      }));
    }

    return (activeJoins || []).map((join, idx) => {
      const anchorKey = safe(anchorType);
      const leftKey = safe(join.left);
      const rightKey = safe(join.right);
      const source = leftKey === anchorKey ? join.right : rightKey === anchorKey ? join.left : join.right;
      const fromSource = leftKey === anchorKey ? join.left : rightKey === anchorKey ? join.right : join.left;
      return {
        step: idx + 1,
        source,
        from_source: fromSource,
        join_key: join.key,
        join_type: join.join_type || 'left',
        matched_rows: Number(join.matched_rows || 0),
        rows_before: Number(rowImpact?.anchorRows || 0),
        rows_after: Number(rowImpact?.anchorRows || 0),
        coverage_pct: Number(rowImpact?.anchorRows || 0) > 0
          ? (Number(join.matched_rows || 0) / Math.max(Number(rowImpact?.anchorRows || 0), 1)) * 100
          : null,
      };
    });
  }, [previewData?.impact, rowImpact?.steps, activeJoins, anchorType, rowImpact?.anchorRows]);

  const metrics = useMemo(() => {
    const labelSummary = previewData?.label_summary || {};
    const alertsDataset = findDatasetByType(datasets, 'alerts') || findDatasetByType(datasets, anchorType);
    const totalRows = Number(labelSummary?.n_total || rowImpact?.anchorRows || alertsDataset?.row_count || 0);
    const labelledRows = Number(labelSummary?.n_labelled || labelSummary?.labelled_rows || estimatedOutputRows || rowImpact?.finalRows || 0);
    const totalExcluded = Number(labelSummary?.n_excluded || labelSummary?.excluded_rows || Math.max(totalRows - labelledRows, 0));
    const caseStep = impactSteps.find((step) => ['cases', 'case'].includes(normalizeStepSource(step.source)));
    const caseMatched = Number(caseStep?.matched_rows || 0);
    const hasCaseJoin = Boolean(caseStep);
    const noCaseDropped = hasCaseJoin ? clamp(totalRows - caseMatched, 0, totalRows) : 0;
    const withCaseRows = hasCaseJoin ? clamp(caseMatched, 0, totalRows) : Math.max(totalRows - totalExcluded, 0);
    const openDropped = hasCaseJoin ? Math.max(totalExcluded - noCaseDropped, 0) : totalExcluded;
    const topTitle = ['alerts', 'alert'].includes(safe(anchorType))
      ? 'All alerts'
      : `All ${humanizeType(anchorType || alertsDataset?.dataset_type || 'rows')}`;

    return {
      topTitle,
      totalRows,
      labelledRows,
      totalExcluded,
      noCaseDropped,
      withCaseRows,
      openDropped,
      hasCaseJoin,
    };
  }, [previewData?.label_summary, datasets, anchorType, rowImpact?.anchorRows, rowImpact?.finalRows, estimatedOutputRows, impactSteps]);

  const rollupMap = useMemo(() => {
    const map = new Map();
    (rollupTables || []).forEach((item) => {
      map.set(normalizeStepSource(item.eventTable), item);
    });
    return map;
  }, [rollupTables]);

  const joinExplanations = useMemo(() => {
    const sorted = [...impactSteps].sort((a, b) => {
      const stepA = Number(a.step || 0);
      const stepB = Number(b.step || 0);
      if (stepA && stepB) return stepA - stepB;
      const typeA = normalizeStepSource(a.source);
      const typeB = normalizeStepSource(b.source);
      const rankA = KNOWN_STEP_ORDER.indexOf(typeA);
      const rankB = KNOWN_STEP_ORDER.indexOf(typeB);
      return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB);
    });
    return sorted.map((step) => describeJoinStep({ step, rollupMap, anchorType }));
  }, [impactSteps, rollupMap, anchorType]);

  const joinExplanationCards = useMemo(() => {
    if (!joinExplanations.length) {
      return [
        (
          <div key="no_join_explanations" style={{ ...cardStyle, padding: 12, background: '#fff' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Join explanations will appear here</div>
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6, lineHeight: 1.6 }}>
              Select enrichment tables and refresh the preview to see the exact join order, row impact, and business explanation for each join step.
            </div>
          </div>
        ),
      ];
    }
    return joinExplanations.map((item) => (
      <JoinCard key={`${item.title}_${item.joinLabel}`} item={item} />
    ));
  }, [joinExplanations]);

  const flowNarrative = useMemo(() => {
    const lines = [];
    lines.push(
      `The build starts from ${rowLabel(metrics.totalRows)} at the ${safe(anchorType) === 'alerts' ? 'alert' : humanizeType(anchorType)} grain.`,
    );
    if (metrics.hasCaseJoin) {
      lines.push(
        `${fmt(metrics.noCaseDropped)} rows drop out first because there is no matched case outcome, and another ${fmt(metrics.openDropped)} rows are removed because the investigation outcome is still OPEN or unresolved.`,
      );
    } else {
      lines.push(
        `${fmt(metrics.totalExcluded)} rows are excluded because the workflow could not confirm a resolved supervision outcome for them.`,
      );
    }
    lines.push(
      `${rowLabel(metrics.labelledRows)} remain in the finished training dataset after label eligibility is applied.`,
    );
    if (rollupTables?.length) {
      lines.push('Transaction-like tables are rolled up before their join runs so the master dataset stays at one row per alert.');
    }
    return lines;
  }, [metrics, anchorType, rollupTables?.length]);

  const renderExpandedContent = () => (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...cardStyle, padding: 16, background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 8 }}>Training-set funnel</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 12, lineHeight: 1.6 }}>
          This view explains how the raw alert universe is reduced to the labelled master dataset that can safely train the model.
        </div>
        <FlowSvg metrics={metrics} />
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {flowNarrative.map((line) => (
          <div key={line} style={{ ...cardStyle, padding: 12, background: '#fff' }}>
            <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.6 }}>{line}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Each join explained</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>
            Every selected join is described below so the user can see what it adds, why it exists, and how it affects row preservation.
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {joinExplanationCards}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div style={{ ...cardStyle, padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>Master dataset creation flow</div>
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, lineHeight: 1.55, maxWidth: 720 }}>
              Replaces the generic DAG with a business-readable funnel that shows where alerts are excluded, how the labelled training set is formed, and why each enrichment join exists.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={buttonStyle('secondary', false)} onClick={() => setExpanded(true)}>
              Expand flow
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
            Input {rowLabel(metrics.totalRows)}
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
            Labelled output {rowLabel(metrics.labelledRows)}
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
            {joinProfileEstimated ? 'Join coverage is estimated' : 'Join coverage from current preview'}
          </div>
          {rollupTables?.length > 0 && (
            <div style={{ padding: '4px 8px', borderRadius: 999, border: `1px solid ${T.borderStrong}`, background: '#fffaf5', fontSize: 10.5, color: T.text }}>
              Transaction rollup is active
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, background: '#fff', borderRadius: 12, border: `1px solid ${T.border}` }}>
          <FlowSvg metrics={metrics} />
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {joinExplanationCards}
        </div>
      </div>

      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            borderRadius: 0,
            border: `1px solid ${T.border}`,
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.18)',
          },
        }}
      >
        <DialogTitle sx={{ px: 2.25, py: 1.5, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Master dataset creation flow</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
              Expanded training funnel plus a join-by-join explanation of how the master dataset is assembled.
            </div>
          </div>
          <IconButton onClick={() => setExpanded(false)} size="small" sx={{ borderRadius: 0, border: `1px solid ${T.border}` }}>
            <Close fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 2, bgcolor: '#f7f8f9' }}>
          {renderExpandedContent()}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MasterDatasetFlowDiagram;
