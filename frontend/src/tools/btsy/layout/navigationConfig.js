import {
  AccountTree,
  AutoGraph,
  BubbleChart,
  FindInPage,
  Groups,
  Hub,
  Inventory2,
  NotificationsActive,
  PlayCircleOutline,
  Public,
  Rule,
  Science,
  Tune,
} from '@mui/icons-material';

export const btsyNavigationSections = [
  {
    key: 'FOUNDATION',
    label: 'Data Foundation',
    items: [
      { id: 'foundation', label: 'Foundation', icon: Inventory2 },
    ],
  },
  {
    key: 'CALIBRATION',
    label: 'Calibration',
    items: [
      { id: 'runs', label: 'Calibration Runs', icon: PlayCircleOutline },
      { id: 'scenarios', label: 'Scenarios', icon: AutoGraph },
      { id: 'universe', label: 'Transaction Universe', icon: Public },
      { id: 'behavior', label: 'Cortex Scenario Builder', icon: Hub },
      { id: 'calibration', label: 'Scenario Workbench', icon: Tune },
    ],
  },
  {
    key: 'ALERTING',
    label: 'Alerting',
    items: [
      { id: 'alerting_eligibility', label: 'Eligibility & Alert Generation', icon: NotificationsActive },
    ],
  },
  {
    key: 'VALIDATION',
    label: 'Validation',
    items: [
      { id: 'validation_str_alignment', label: 'STR Alignment & Validation', icon: Rule },
      { id: 'validation_missed_str', label: 'Missed STR Analysis', icon: FindInPage },
    ],
  },
  {
    key: 'OPS_INTELLIGENCE',
    label: 'Operations Intelligence',
    items: [
      { id: 'ops_scenario_interaction', label: 'Scenario Interaction Analysis', icon: BubbleChart },
      { id: 'ops_workload', label: 'Analyst Workload Simulation', icon: Groups },
    ],
  },
  {
    key: 'ADVANCED',
    label: 'Advanced Analysis',
    items: [
      { id: 'ml_validation', label: 'ML Validation Workbench', icon: Science },
    ],
  },
  {
    key: 'RELATIONSHIPS',
    label: 'Relationships',
    items: [
      { id: 'behavior_reconstruction', label: 'Behavior Reconstruction', icon: AccountTree },
    ],
  },
];

