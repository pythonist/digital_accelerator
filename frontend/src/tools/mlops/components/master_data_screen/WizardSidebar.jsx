import React from 'react';
import { T, cardStyle } from './theme';

const statusDot = (status) => {
  if (status === 'completed') return { bg: T.good, border: T.good };
  if (status === 'current') return { bg: T.orange, border: T.orange };
  if (status === 'skipped') return { bg: '#fff', border: T.borderStrong };
  return { bg: '#fff', border: T.borderStrong };
};

const WizardSidebar = ({ steps, currentStepId, completedSteps, skipRollup }) => {
  return (
    <div style={{ ...cardStyle, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: T.text, marginBottom: 6 }}>
        Master Dataset Builder
      </div>
      <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 8 }}>
        Follow one decision at a time.
      </div>
      {steps.map((step, idx) => {
        const status = step.id === currentStepId
          ? 'current'
          : completedSteps.has(step.id)
          ? 'completed'
          : ['rollup', 'aggregation'].includes(step.id) && skipRollup
          ? 'skipped'
          : 'upcoming';
        const dot = statusDot(status);
        return (
          <div key={step.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                border: `2px solid ${dot.border}`,
                background: dot.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                color: '#fff',
                flexShrink: 0,
                fontWeight: 800,
              }}
            >
              {status === 'completed' ? '✓' : status === 'current' ? String(idx + 1) : ''}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: status === 'current' ? T.orange : T.text }}>
                {idx + 1}. {step.title}
              </div>
              <div style={{ fontSize: 10, color: T.muted }}>
                {status === 'skipped' ? 'Skipped (transactions not selected)' : step.subtitle}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WizardSidebar;
