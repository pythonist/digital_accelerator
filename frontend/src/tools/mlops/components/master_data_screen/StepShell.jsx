import React from 'react';
import { T, cardStyle, buttonStyle } from './theme';

const StepShell = ({
  title,
  purpose,
  children,
  onBack,
  onNext,
  canBack,
  canNext,
  nextLabel = 'Continue',
  hideNext = false,
  headerActions = null,
}) => (
  <div style={{ ...cardStyle, padding: 8, display: 'grid', gap: 6, gridTemplateRows: 'auto 1fr auto', minHeight: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4 }}>{purpose}</div>
      </div>
      {headerActions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{headerActions}</div> : null}
    </div>

    <div style={{ minHeight: 0 }}>{children}</div>

    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <button type="button" style={buttonStyle('secondary', !canBack)} disabled={!canBack} onClick={onBack}>
        Back
      </button>
      {!hideNext && (
        <button type="button" style={buttonStyle('primary', !canNext)} disabled={!canNext} onClick={onNext}>
          {nextLabel}
        </button>
      )}
    </div>
  </div>
);

export default StepShell;
