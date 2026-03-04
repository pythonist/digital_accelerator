import {
  CheckCircle,
  CloudUpload,
  CompareArrows,
  Description,
  FilterAlt,
  Functions,
  Gavel,
  Tune,
} from '@mui/icons-material';

export const getCalibrationNavigationSections = ({
  step0Complete = false,
  runReady = false,
  currentStep = 'data_load',
}) => {
  const workflowOrder = ['scenario', 'aggregation', 'validation', 'calibration', 'approval', 'summary'];
  const currentIndex = workflowOrder.indexOf(currentStep);

  const canOpenStep = (stepId) => {
    if (!step0Complete) return false;
    const stepIndex = workflowOrder.indexOf(stepId);
    if (stepIndex === -1) return true;
    if (!runReady) return stepId === 'scenario';
    return stepIndex <= currentIndex;
  };

  return [
    {
      key: 'SETUP',
      label: 'Setup',
      items: [
        { id: 'data_load', label: 'Data Foundation', icon: CloudUpload },
      ],
    },
    {
      key: 'WORKFLOW',
      label: 'Workflow',
      items: [
        { id: 'scenario', label: 'Population Extraction', icon: FilterAlt, disabled: !canOpenStep('scenario') },
        { id: 'aggregation', label: 'Aggregation', icon: Functions, disabled: !canOpenStep('aggregation') },
        { id: 'validation', label: 'Validation', icon: CheckCircle, disabled: !canOpenStep('validation') },
        { id: 'calibration', label: 'Calibration', icon: Tune, disabled: !canOpenStep('calibration') },
        { id: 'approval', label: 'Governance Approval', icon: Gavel, disabled: !canOpenStep('approval') },
        { id: 'summary', label: 'Final Report', icon: Description, disabled: !canOpenStep('summary') },
      ],
    },
    {
      key: 'FUTURE',
      label: 'Future',
      items: [
        { id: 'comparison', label: 'Bank Comparison', icon: CompareArrows, disabled: !runReady },
      ],
    },
  ];
};
