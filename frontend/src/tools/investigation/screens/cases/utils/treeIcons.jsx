import {
  Work as BriefcaseIcon,
  Person as UserIcon,
  Security as ShieldIcon,
  AccountBalance as LandmarkIcon,
  Warning as AlertTriangleIcon,
  ArrowForward as ArrowRightIcon,
  Storage as DatabaseIcon,
  AccountTree as LineageIcon,
  Transform as DerivedIcon,
  Functions as RuleIcon,
  ViewColumn as ColumnIcon,
  FilterAlt as FilterIcon,
  Calculate as AggregationIcon,
} from '@mui/icons-material';

export const getIconForType = (type, size = 18) => {
  const iconProps = { sx: { fontSize: size } };

  const iconMap = {
    Case: <BriefcaseIcon {...iconProps} />,
    UCIC: <UserIcon {...iconProps} />,
    Customer: <ShieldIcon {...iconProps} />,
    Account: <LandmarkIcon {...iconProps} />,
    Alert: <AlertTriangleIcon {...iconProps} />,
    AlertsSection: <AlertTriangleIcon {...iconProps} />,
    Transaction: <ArrowRightIcon {...iconProps} />,
    Lineage: <LineageIcon {...iconProps} />,
    DerivedField: <DerivedIcon {...iconProps} />,
    Rule: <RuleIcon {...iconProps} />,
    SourceColumn: <ColumnIcon {...iconProps} />,
    Filter: <FilterIcon {...iconProps} />,
    Aggregation: <AggregationIcon {...iconProps} />,
    DataQualityWarning: <AlertTriangleIcon {...iconProps} />,
  };

  return iconMap[type] || <DatabaseIcon {...iconProps} />;
};

export const getStyleForType = (type) => {
  const styleMap = {
    Case: { color: '#1976d2', bgcolor: '#e3f2fd', borderColor: '#90caf9' },
    Lineage: { color: '#6a1b9a', bgcolor: '#f3e5f5', borderColor: '#ba68c8' },
    DerivedField: { color: '#0288d1', bgcolor: '#e1f5fe', borderColor: '#4fc3f7' },
    Rule: { color: '#f57c00', bgcolor: '#fff3e0', borderColor: '#ffb74d' },
    SourceColumn: { color: '#5d4037', bgcolor: '#efebe9', borderColor: '#a1887f' },
    Filter: { color: '#00897b', bgcolor: '#e0f2f1', borderColor: '#4db6ac' },
    Aggregation: { color: '#5e35b1', bgcolor: '#ede7f6', borderColor: '#9575cd' },
    DataQualityWarning: { color: '#f57c00', bgcolor: '#fff3e0', borderColor: '#ffb74d' },
    UCIC: { color: '#7b1fa2', bgcolor: '#f3e5f5', borderColor: '#ce93d8' },
    Customer: { color: '#388e3c', bgcolor: '#e8f5e9', borderColor: '#81c784' },
    Account: { color: '#0097a7', bgcolor: '#e0f7fa', borderColor: '#4dd0e1' },
    Alert: { color: '#d32f2f', bgcolor: '#ffebee', borderColor: '#ef5350' },
    AlertsSection: { color: '#d32f2f', bgcolor: '#ffebee', borderColor: '#ef5350' },
    Transaction: { color: '#616161', bgcolor: '#f5f5f5', borderColor: '#e0e0e0' },
  };

  return (
    styleMap[type] || {
      color: '#757575',
      bgcolor: '#fafafa',
      borderColor: '#e0e0e0',
    }
  );
};
