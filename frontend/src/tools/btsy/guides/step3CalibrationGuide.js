export const STEP3_CALIBRATION_GUIDE = {
  guideId: 'STEP3_CALIBRATION_GUIDE',
  screen: 'SCENARIO_CALIBRATION_WORKBENCH',
  title: 'Calibration (Step 3) Guided Walkthrough',
  steps: [
    {
      id: '3.0.1',
      target: '[data-guide-id="wb-behavior-run-select"]',
      instruction: 'Select a Behaviour Run to anchor the session and signal.',
      action: { type: 'STATE', key: 'selectedBehaviorRunId', op: 'truthy' }
    },
    {
      id: '3.0.2',
      target: '[data-guide-id="wb-new-session-button"]',
      instruction: 'Create a new Calibration Session. This is your working container for Step 3.',
      action: { type: 'EVENT', name: 'CALIBRATION_SESSION_CREATED' }
    },
    {
      id: '3.1',
      target: '[data-guide-id="wb-aggregation-panel"]',
      instruction: 'Define the aggregation lens. Step 3 evaluates signals on the reduced entity distribution.',
      action: { type: 'EVENT', name: 'AGGREGATION_APPLIED' }
    },
    {
      id: '3.3.1',
      target: '[data-guide-id="wb-tab-threshold"]',
      instruction: 'Open Threshold Simulation to explore boundary placement.',
      action: { type: 'CLICK' }
    },
    {
      id: '3.3.2',
      target: '[data-guide-id="wb-save-strategy-button"]',
      instruction: 'Persist a threshold strategy so it can be used consistently downstream.',
      action: { type: 'EVENT', name: 'THRESHOLD_STRATEGY_SAVED' }
    },
    {
      id: '3.3.3',
      target: '[data-guide-id="wb-tab-split"]',
      instruction: 'Open Risk Split to materialize a scenario boundary (ATL/BTL + optional review band).',
      action: { type: 'CLICK' }
    },
    {
      id: '3.3.4',
      target: '[data-guide-id="wb-create-boundary-button"]',
      instruction: 'Create the boundary from your chosen strategy.',
      action: { type: 'EVENT', name: 'RISK_BOUNDARY_CREATED' }
    },
    {
      id: '3.4',
      target: '[data-guide-id="wb-compute-ks-button"]',
      instruction: 'Compute KS to validate separation between ATL and BTL proxy groups.',
      action: { type: 'EVENT', name: 'KS_COMPUTED' }
    },
    {
      id: '3.6.1',
      target: '[data-guide-id="wb-j-enable-checkbox"]',
      instruction: 'Enable Step 3.6 to compute separation strength for the selected signal.',
      action: { type: 'CLICK' }
    },
    {
      id: '3.6.2',
      target: '[data-guide-id="wb-compute-j-button"]',
      instruction: 'Compute separation strength (J-Statistic) on the scenario-defined groups.',
      action: { type: 'EVENT', name: 'J_COMPUTED' }
    }
  ]
};

