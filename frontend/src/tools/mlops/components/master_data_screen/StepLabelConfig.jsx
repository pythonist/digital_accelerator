import React from 'react';
import { T, cardStyle, inputStyle } from './theme';
import { fmt } from './utils';

const ModeButton = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      borderRadius: 8,
      border: `1px solid ${active ? T.orange : T.borderStrong}`,
      background: active ? T.orangeSoft : '#fff',
      color: active ? T.orange : T.text,
      fontWeight: 700,
      fontSize: 12,
      padding: '8px 12px',
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);

const StepLabelConfig = ({
  anchorRows,
  strRows,
  caseRows,
  strMode,
  onChangeStrMode,
  replacementLabelColumn,
  replacementOptions,
  onReplacementChange,
  estimatedRows,
  labelSummary,
  targetLabelName = 'str_label',
}) => (
  <div style={{ display: 'grid', gap: 8 }}>
    <div style={{ ...cardStyle, padding: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 6 }}>
        Target output column: {targetLabelName}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 10 }}>
        We keep `FINAL_LABEL` / `IS_TRUE_POS` internally for compatibility and expose it as {targetLabelName} in this workflow.
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ ...cardStyle, padding: 10, background: T.goodSoft, borderColor: '#86efac' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.good }}>Source 1 - STR table (primary)</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
            {fmt(strRows)} STR records. For each alert, check if an STR is filed within 60 days after alert date.
            If yes, closest alert before STR gets <strong>{targetLabelName} = 1</strong>.
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 10, background: T.blueSoft, borderColor: '#bfdbfe' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.blue }}>Source 2 - Cases (required fallback)</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
            {fmt(caseRows)} investigated alerts. CLOSED_SAR_FILED maps to 1, CLOSED_FALSE_POSITIVE maps to 0, OPEN is dropped.
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 10, background: T.warnSoft, borderColor: '#fcd34d' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.warn }}>Source 3 - Label eligibility filter</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
            Alerts with no STR evidence and no closed case outcome are excluded from supervised training.
            This is why output rows drop from anchor row count to labeled row count.
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 10, background: '#f8fafc' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>Why not STR only?</div>
          <div style={{ fontSize: 11.5, color: T.text, marginTop: 4 }}>
            STR alone is high precision but low coverage. Cases provide additional confirmed negatives and positives,
            which prevents severe class bias and reduces unlabeled noise.
          </div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>
            Anchor rows: {fmt(anchorRows)} | STR rows: {fmt(strRows)} | Case rows: {fmt(caseRows)} | Labeled output: {fmt(labelSummary?.n_labelled ?? estimatedRows)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: T.muted }}>
        Row journey: {fmt(anchorRows)} alerts -&gt; {fmt(labelSummary?.n_total ?? anchorRows)} after joins -&gt; {fmt(labelSummary?.n_labelled ?? estimatedRows)} labeled rows.
      </div>
    </div>

    <div style={{ ...cardStyle, padding: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Governance mode</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ModeButton active={strMode === 'detect'} label="Confirm STR linkage" onClick={() => onChangeStrMode('detect')} />
        <ModeButton active={strMode === 'unlink'} label="Unlink STR" onClick={() => onChangeStrMode('unlink')} />
        <ModeButton active={strMode === 'replace'} label="Replace mapping" onClick={() => onChangeStrMode('replace')} />
      </div>

      {strMode === 'replace' && (
        <div style={{ marginTop: 10, maxWidth: 420 }}>
          <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 6 }}>Replacement label column</div>
          <select
            style={inputStyle}
            value={replacementLabelColumn}
            onChange={(e) => onReplacementChange(e.target.value)}
          >
            <option value="">Select column</option>
            {replacementOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
    </div>
  </div>
);

export default StepLabelConfig;

