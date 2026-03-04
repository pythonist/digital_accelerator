import {
  AccountTree,
  Assessment,
  BubbleChart,
  CloudUpload,
  Dashboard,
  Psychology,
  Science,
  Settings,
  Speed,
  Storage,
  TrendingUp,
  Visibility,
} from '@mui/icons-material';

export const getMuleNavigationSections = (hasData = false) => ([
  {
    key: 'DATA_MODULE',
    label: 'Data Module',
    items: [
      { id: 'upload', label: 'Upload Data', icon: CloudUpload },
      { id: 'data-introspection', label: 'Data Introspection', icon: Assessment, disabled: !hasData },
    ],
  },
  {
    key: 'ACCOUNT_ANALYSIS',
    label: 'Account Analysis',
    items: [
      { id: 'account-analysis', label: 'Account Analysis', icon: Dashboard, disabled: !hasData },
      { id: 'risk-dashboard', label: 'Risk Dashboard', icon: TrendingUp, disabled: !hasData },
    ],
  },
  {
    key: 'ML_PIPELINE',
    label: 'ML Pipeline',
    items: [
      { id: 'feature-engineering', label: 'Feature Engineering', icon: Science, disabled: !hasData },
      { id: 'feature-store', label: 'Feature Store', icon: Storage, disabled: !hasData },
      { id: 'feature-explorer', label: 'Feature Explorer', icon: Visibility, disabled: !hasData },
      { id: 'train-model', label: 'Model Lab', icon: Settings, disabled: !hasData },
      { id: 'train-model-legacy', label: 'Train Model (Legacy)', icon: Settings, disabled: !hasData },
      { id: 'inference', label: 'Inference', icon: Speed, disabled: !hasData },
      { id: 'explainability', label: 'Explainability (SHAP)', icon: Psychology, disabled: !hasData },
    ],
  },
  {
    key: 'RULES_NETWORK',
    label: 'Rules & Network',
    items: [
      { id: 'rule-engine', label: 'Rule Engine', icon: TrendingUp, disabled: !hasData },
      { id: 'hybrid-scoring', label: 'Hybrid Scoring', icon: TrendingUp, disabled: !hasData },
      { id: 'network-graph', label: 'Network Graph (3D)', icon: AccountTree, disabled: !hasData },
      { id: 'pattern-analysis', label: 'Pattern Analysis', icon: BubbleChart, disabled: !hasData },
    ],
  },
]);
