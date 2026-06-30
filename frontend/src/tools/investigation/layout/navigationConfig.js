import {
  AccountTree,
  AutoAwesome,
  AutoFixHigh,
  Chat,
  CleaningServices,
  ContentCopy,
  Dashboard,
  Description,
  Explore,
  FactCheck,
  History,
  Hub,
  Inbox,
  Link,
  MenuBook,
  Psychology,
  Search,
  Security,
  Settings,
  TableChart,
  TrendingUp,
  UploadFile,
  Warning,
} from '@mui/icons-material';

export const getInvestigationNavigationSections = (hasData = false) => ([
  {
    key: 'DATA_MANAGEMENT',
    label: 'Data Management',
    items: [
      { id: 'load', label: 'Load Data', icon: UploadFile },
      { id: 'history', label: 'Ingestion History', icon: History, disabled: !hasData },
      { id: 'table', label: 'Data Viewer', icon: TableChart, disabled: !hasData },
      { id: 'dynamic', label: 'Discovery', icon: Explore, disabled: !hasData },
      { id: 'merge', label: 'Create Data', icon: AutoAwesome },
      { id: 'schema', label: 'Schema Map', icon: Hub },
      { id: 'build', label: 'AI Auto-Master', icon: AutoFixHigh, disabled: !hasData },
      { id: 'clean', label: 'Data Cleaning', icon: CleaningServices, disabled: !hasData },
      { id: 'dashboard', label: 'Dashboard', icon: Dashboard, disabled: !hasData },
    ],
  },
  {
    key: 'FCC_BRIDGE',
    label: 'FCC Bridge',
    items: [
      { id: 'fcc_bridge', label: 'Published Runs', icon: Link },
    ],
  },
  {
    key: 'PRIORITY_QUEUE',
    label: 'Priority Queue',
    items: [
      { id: 'priority', label: 'Priority Inbox', icon: Inbox, disabled: !hasData, highlight: true },
    ],
  },
  {
    key: 'INVESTIGATION',
    label: 'Investigation',
    items: [
      { id: 'casepack', label: 'Case Packs', icon: Description, disabled: !hasData },
      { id: 'investigate', label: 'Copilot Investigation', icon: Search, disabled: !hasData },
      { id: 'agentic', label: 'Agentic Investigation', icon: Psychology, highlight: true },
      { id: 'tree', label: 'Lineage Explorer', icon: AccountTree, disabled: !hasData },
      { id: 'retrieval_compare', label: 'Case Retrieval', icon: ContentCopy, disabled: !hasData },
      { id: 'chat', label: 'AI Assistant', icon: Chat },
    ],
  },
  {
    key: 'ANALYSIS',
    label: 'Analysis',
    items: [
      { id: 'graph', label: 'Network Intelligence', icon: AccountTree, disabled: !hasData },
      { id: 'rules', label: 'Rule Engine', icon: MenuBook, disabled: !hasData },
      { id: 'typology', label: 'Typology Intelligence', icon: Warning, disabled: !hasData },
      { id: 'baseline', label: 'Baseline', icon: TrendingUp, disabled: !hasData },
    ],
  },
  {
    key: 'RESOLUTION',
    label: 'Resolution',
    items: [
      { id: 'resolution', label: 'Case Resolution', icon: FactCheck, disabled: !hasData },
      { id: 'case_queue', label: 'Case Queue', icon: Inbox, disabled: !hasData },
      { id: 'case_reports', label: 'Generate Report', icon: Description, disabled: !hasData },
      { id: 'report_history', label: 'Report History', icon: History, disabled: !hasData },
      { id: 'mail_config', label: 'Mail', icon: Settings, disabled: !hasData },
      { id: 'escalation_history', label: 'Escalation History', icon: History, disabled: !hasData },
    ],
  },
  {
    key: 'SYSTEM',
    label: 'System',
    items: [
      { id: 'audit', label: 'Audit Trail', icon: Security },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]);
