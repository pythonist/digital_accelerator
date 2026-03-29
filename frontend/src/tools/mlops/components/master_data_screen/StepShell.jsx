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
  <div style={{ ...cardStyle, padding: 14, display: 'grid', gap: 12, gridTemplateRows: 'auto 1fr auto', minHeight: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4 }}>{purpose}</div>
      </div>
      {headerActions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{headerActions}</div> : null}
    </div>

    <div style={{ minHeight: 0 }}>{children}</div>

    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 3,
        marginTop: 4,
        borderTop: `1px solid ${T.border}`,
        paddingTop: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: 10,
        columnGap: 8,
        width: '100%',
        boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginRight: 'auto' }}>
        <button type="button" style={buttonStyle('secondary', !canBack)} disabled={!canBack} onClick={onBack}>
          Back
        </button>
      </div>
      {!hideNext && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" style={buttonStyle('primary', !canNext)} disabled={!canNext} onClick={onNext}>
            {nextLabel}
          </button>
        </div>
      )}
    </div>
  </div>
);

export default StepShell;
