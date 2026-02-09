import React from 'react';

// ============================================
// INTERPRETATION ENGINE - Core Logic
// ============================================

export const interpretationEngine = {
  
  // Step 3.1: Population & Distribution Health
  interpretDistribution: (summary) => {
    if (!summary) return null;
    
    const { entities, median, p99, gini } = summary;
    const tailConcentration = p99 / (median || 1);
    
    // Low sample size check
    if (entities < 1000) {
      return {
        status: 'error',
        title: 'Low Sample Size',
        message: `Only ${entities.toLocaleString()} entities. Statistical measures may be unreliable.`,
        impact: 'Percentile-based thresholds will be unstable. Small population changes cause large threshold shifts.',
        action: 'Review Step 3.1 interpretation settings. Check if filters are too restrictive.',
        confidence: 'low'
      };
    }
    
    // Heavy-tailed distribution check
    if (tailConcentration > 20 || (gini && gini > 0.8)) {
      return {
        status: 'warning',
        title: 'Heavy-Tailed Distribution',
        message: `P99 is ${tailConcentration.toFixed(1)}x the median. Behavior concentrated in few entities.`,
        impact: 'Percentile thresholds may be sensitive to outliers. Top 1% entities dominate the signal.',
        action: 'Consider "top-N" strategy instead of percentiles, or use log-scale thresholds.',
        confidence: 'medium'
      };
    }
    
    return {
      status: 'success',
      title: 'Well-Distributed Signal',
      message: `${entities.toLocaleString()} entities with moderate concentration (P99/median = ${tailConcentration.toFixed(1)}x).`,
      impact: 'Signal appears calibratable with standard percentile approaches.',
      action: 'Proceed to Step 3.3: Threshold Selection.',
      confidence: 'high'
    };
  },

  // Step 3.4: KS Validation Interpretation
  interpretKS: (ksValue, nAtl, nBtl) => {
    const atlRatio = nAtl / (nAtl + nBtl);
    
    if (ksValue >= 0.7) {
      return {
        status: 'success',
        title: 'Strong Separation',
        message: `KS = ${ksValue.toFixed(3)} indicates ATL and BTL distributions are well-separated.`,
        impact: 'This boundary creates a meaningful behavioral split. ATL entities are statistically distinct from BTL.',
        action: atlRatio > 0.05 
          ? `Note: ATL is ${(atlRatio * 100).toFixed(1)}% of population. Verify this aligns with risk appetite.`
          : 'Proceed to Step 3.5: Stress Testing to confirm stability.',
        confidence: 'high',
        metrics: {
          'Separation Strength': 'Strong',
          'ATL Population': `${(atlRatio * 100).toFixed(2)}%`,
          'Recommended Action': 'Proceed'
        }
      };
    }
    
    if (ksValue >= 0.5) {
      return {
        status: 'warning',
        title: 'Moderate Separation',
        message: `KS = ${ksValue.toFixed(3)} shows detectable separation, but overlap exists between ATL/BTL.`,
        impact: 'Boundary may struggle with edge cases. Some entities near threshold are ambiguous.',
        action: 'Review CDF plot. If curves are close, consider adjusting threshold or changing interpretation lens (Step 3.1).',
        confidence: 'medium',
        metrics: {
          'Separation Strength': 'Moderate',
          'ATL Population': `${(atlRatio * 100).toFixed(2)}%`,
          'Recommended Action': 'Review & Adjust'
        }
      };
    }
    
    return {
      status: 'error',
        title: 'Weak Separation',
      message: `KS = ${ksValue.toFixed(3)} indicates minimal difference between ATL and BTL.`,
      impact: 'Heavy distribution overlap. The boundary may be arbitrary rather than behavioral.',
      action: 'Return to Step 3.3 and try a different threshold strategy, or reconsider interpretation lens in Step 3.1.',
      confidence: 'low',
      metrics: {
        'Separation Strength': 'Weak',
        'ATL Population': `${(atlRatio * 100).toFixed(2)}%`,
        'Recommended Action': 'Rebuild Boundary'
      }
    };
  },

  // Step 3.5: Stress Test / Fragility
  interpretStress: (stressResults) => {
    if (!stressResults || stressResults.length === 0) {
      return {
        status: 'info',
        title: 'Stress Test Required',
        message: 'No stress testing performed yet.',
        impact: 'Unknown how threshold changes affect entity assignments.',
        action: 'Run stress test to measure boundary fragility.',
        confidence: null
      };
    }
    
    const maxChurn = Math.max(...stressResults.map(r => r.entity_churn_pct || 0));
    
    if (maxChurn < 10) {
      return {
        status: 'success',
        title: '✓ Stable Boundary',
        message: `Max churn under stress is ${maxChurn.toFixed(1)}%. Minimal population shifts.`,
        impact: 'Small threshold changes produce stable results. Boundary is robust to calibration drift.',
        action: 'Proceed to Step 3.6: J-Statistic separation strength analysis.',
        confidence: 'high',
        metrics: {
          'Max Churn': `${maxChurn.toFixed(1)}%`,
          'Stability': 'Strong',
          'Recommended Action': 'Proceed'
        }
      };
    }
    
    if (maxChurn < 25) {
      return {
        status: 'warning',
        title: '⚠️ Moderate Sensitivity',
        message: `Max churn is ${maxChurn.toFixed(1)}%. Boundary shows some sensitivity to adjustments.`,
        impact: 'Entity assignments may shift if threshold drifts during production monitoring.',
        action: 'Document acceptable churn range. Monitor threshold stability in deployment.',
        confidence: 'medium',
        metrics: {
          'Max Churn': `${maxChurn.toFixed(1)}%`,
          'Stability': 'Moderate',
          'Recommended Action': 'Document & Monitor'
        }
      };
    }
    
    return {
      status: 'error',
      title: '❌ Fragile Boundary',
      message: `Max churn is ${maxChurn.toFixed(1)}%. Highly sensitive to small threshold changes.`,
      impact: 'Entity assignments are unstable. Minor calibration updates could drastically change ATL population.',
      action: 'Return to Step 3.3 and choose a threshold in a more stable region of the distribution.',
      confidence: 'low',
      metrics: {
        'Max Churn': `${maxChurn.toFixed(1)}%`,
        'Stability': 'Fragile',
        'Recommended Action': 'Rebuild Boundary'
      }
    };
  },

  // Step 3.6: J-Statistic Separation
  interpretJ: (maxJ, stabilityLabel) => {
    if (maxJ >= 0.6 && stabilityLabel === 'stable') {
      return {
        status: 'success',
        title: '✓ Strong & Stable Separation',
        message: `Max J = ${maxJ.toFixed(3)} with ${stabilityLabel} stability.`,
        impact: 'ATL/BTL are well-separated and the boundary is robust to data sampling variations.',
        action: 'This boundary is production-ready. Proceed to freeze session or run orchestrated workflow.',
        confidence: 'high',
        metrics: {
          'Separation': 'Strong',
          'Stability': stabilityLabel,
          'Recommended Action': 'Approve for Production'
        }
      };
    }
    
    if (maxJ >= 0.4) {
      const isStable = stabilityLabel === 'stable';
      return {
        status: isStable ? 'warning' : 'error',
        title: isStable ? '⚠️ Moderate Separation' : '❌ Unstable Boundary',
        message: `Max J = ${maxJ.toFixed(3)} with ${stabilityLabel} stability.`,
        impact: isStable 
          ? 'Separation exists but could be stronger with threshold adjustment.'
          : `Stability is ${stabilityLabel}. Small data changes may flip entity assignments.`,
        action: isStable
          ? 'Acceptable for initial deployment. Monitor performance in production.'
          : 'Document why you accept this instability, or return to Step 3.3 to refine boundary.',
        confidence: 'medium',
        metrics: {
          'Separation': 'Moderate',
          'Stability': stabilityLabel,
          'Recommended Action': isStable ? 'Monitor in Production' : 'Refine Boundary'
        }
      };
    }
    
    return {
      status: 'error',
      title: 'Insufficient Separation',
      message: `Max J = ${maxJ.toFixed(3)} is too weak for reliable classification.`,
      impact: 'ATL/BTL may not represent distinct behavioral groups. Boundary lacks predictive power.',
      action: 'Revisit Step 3.1 (interpretation lens) and Step 3.3 (threshold). Current signal may not be calibratable.',
      confidence: 'low',
      metrics: {
        'Separation': 'Weak',
        'Stability': stabilityLabel,
        'Recommended Action': 'Rebuild from Step 3.1'
      }
    };
  },

  // Overall Calibration Readiness
  assessReadiness: (interpretations) => {
    const statuses = Object.values(interpretations).map(i => i?.status).filter(Boolean);
    
    const hasError = statuses.includes('error');
    const hasWarning = statuses.includes('warning');
    const allSuccess = statuses.every(s => s === 'success');
    
    if (allSuccess) {
      return {
        readiness: 'production_ready',
        color: '#0f172a',
        title: 'Production Ready',
        summary: 'All validation metrics are strong. This boundary is ready for deployment.',
        nextSteps: [
          'Freeze this session to lock the configuration',
          'Proceed to Step 4: Alerting to generate production alerts',
          'Or run orchestrated workflow for automated validation'
        ]
      };
    }
    
    if (hasError) {
      return {
        readiness: 'needs_revision',
        color: '#0f172a',
        title: 'Requires Revision',
        summary: 'One or more critical issues detected. Boundary is not production-ready.',
        nextSteps: [
          'Review red-flagged validation steps above',
          'Adjust threshold (Step 3.3) or interpretation lens (Step 3.1)',
          'Re-run validation after changes'
        ]
      };
    }
    
    if (hasWarning) {
      return {
        readiness: 'acceptable_with_monitoring',
        color: '#0f172a',
        title: 'Acceptable with Monitoring',
        summary: 'Some concerns exist, but boundary may be acceptable for controlled deployment.',
        nextSteps: [
          'Document known limitations in annotations',
          'Establish monitoring thresholds for flagged metrics',
          'Consider A/B testing before full rollout'
        ]
      };
    }
    
    return {
      readiness: 'incomplete',
      color: '#0f172a',
      title: 'Validation Incomplete',
      summary: 'Run all validation steps to assess calibration readiness.',
      nextSteps: [
        'Complete Steps 3.4, 3.5, and 3.6',
        'Review results as they become available'
      ]
    };
  }
};

// ============================================
// VISUAL COMPONENTS
// ============================================

export const InterpretationCard = ({ interpretation, showMetrics = false }) => {
  if (!interpretation) return null;
  
  const colors = {
    success: { bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
    warning: { bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
    error: { bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
    info: { bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' }
  };
  
  const color = colors[interpretation.status] || colors.info;
  
  return (
    <div style={{
      backgroundColor: color.bg,
      border: `1px solid ${color.border}`,
      borderRadius: 2,
      padding: 12,
      marginBottom: 12
    }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: color.text, marginBottom: 6 }}>
          {interpretation.title}
        </div>
          
          <div style={{ marginBottom: 8, color: '#374151' }}>
            <strong>What this means:</strong> {interpretation.message}
          </div>
          
          <div style={{ marginBottom: 12, color: '#374151' }}>
            <strong>Impact:</strong> {interpretation.impact}
          </div>
          
          <div style={{ 
            padding: 10, 
            backgroundColor: '#f8fafc', 
            borderRadius: 2,
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Next Step</div>
            <div style={{ color: '#1f2937' }}>{interpretation.action}</div>
          </div>
          
          {showMetrics && interpretation.metrics && (
            <div style={{ 
              marginTop: 12, 
              padding: 10, 
              backgroundColor: '#ffffff',
              borderRadius: 2,
              border: '1px solid #e2e8f0'
            }}>
              <strong>Key Metrics:</strong>
              <div style={{ marginTop: 8 }}>
                {Object.entries(interpretation.metrics).map(([key, value]) => (
                  <div key={key} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    marginBottom: 6,
                    paddingBottom: 6,
                    borderBottom: '1px solid #e2e8f0'
                  }}>
                    <span style={{ color: '#6b7280' }}>{key}:</span>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {interpretation.confidence && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
              Confidence: {interpretation.confidence}
            </div>
          )}
        </div>
    </div>
  );
};

export const ReadinessPanel = ({ readiness }) => {
  if (!readiness) return null;
  
  return (
    <div style={{
      padding: 16,
      backgroundColor: '#ffffff',
      color: '#0f172a',
      borderRadius: 2,
      border: '1px solid #e2e8f0',
      marginTop: 16
    }}>
      <div style={{ marginBottom: 12, fontWeight: 700, fontSize: 16 }}>{readiness.title}</div>
      
      <p style={{ marginBottom: 12, fontSize: 14 }}>
        {readiness.summary}
      </p>
      
      <div style={{
        padding: 12,
        backgroundColor: '#f8fafc',
        borderRadius: 2,
        border: '1px solid #e2e8f0'
      }}>
        <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Next Steps</strong>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {readiness.nextSteps.map((step, i) => (
            <li key={i} style={{ marginBottom: 8 }}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
};

// ============================================
// USAGE EXAMPLE / DEMO
// ============================================

const CalibrationGuidanceDemo = () => {
  // Mock data representing realistic Step 3 outputs
  const mockData = {
    distribution: { entities: 45230, median: 1250, p99: 47600, gini: 0.72 },
    ks: { ksValue: 0.68, nAtl: 452, nBtl: 44778 },
    stress: [
      { delta_pct: -5, entity_churn_pct: 8.2 },
      { delta_pct: 5, entity_churn_pct: 12.4 }
    ],
    jStat: { maxJ: 0.64, stabilityLabel: 'stable' }
  };
  
  // Generate interpretations using the engine
  const interps = {
    distribution: interpretationEngine.interpretDistribution(mockData.distribution),
    ks: interpretationEngine.interpretKS(mockData.ks.ksValue, mockData.ks.nAtl, mockData.ks.nBtl),
    stress: interpretationEngine.interpretStress(mockData.stress),
    j: interpretationEngine.interpretJ(mockData.jStat.maxJ, mockData.jStat.stabilityLabel)
  };
  
  const readiness = interpretationEngine.assessReadiness(interps);
  
  return (
    <div style={{ padding: 24, backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>
        Step 3: Scenario Calibration with Interpretation
      </h1>
      <p style={{ color: '#64748b', marginBottom: 32, fontSize: 16 }}>
        Each step now includes guided interpretation to help you understand what the numbers mean
        and what to do next.
      </p>
      
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
          Step 3.1: Entity Reduction & Distribution
        </h2>
        <InterpretationCard interpretation={interps.distribution} showMetrics />
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
          Step 3.4: KS Validation
        </h2>
        <InterpretationCard interpretation={interps.ks} showMetrics />
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
          Step 3.5: Boundary Fragility (Stress Test)
        </h2>
        <InterpretationCard interpretation={interps.stress} showMetrics />
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
          Step 3.6: Separation Strength (J-Statistic)
        </h2>
        <InterpretationCard interpretation={interps.j} showMetrics />
      </div>
      
      <ReadinessPanel readiness={readiness} />
    </div>
  );
};

export default CalibrationGuidanceDemo;
