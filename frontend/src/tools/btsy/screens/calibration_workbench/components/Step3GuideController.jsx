import React from 'react';
import { Button } from '@mui/material';
import { STEP3_CALIBRATION_GUIDE } from '../../../guides/step3CalibrationGuide';
import { useGuidedWalkthrough } from '../../../components/guide/useGuidedWalkthrough';
import GuideOverlay from '../../../components/guide/GuideOverlay';

const Step3GuideController = ({
  selectedBehaviorRunId,
  selectedSessionId,
  aggregationConfig,
  strategiesCount,
  boundariesCount,
  ksRunsCount,
  step36RunsCount
}) => {
  const guide = useGuidedWalkthrough({
    guide: STEP3_CALIBRATION_GUIDE,
    getContext: () => ({
      selectedBehaviorRunId,
      selectedSessionId,
      aggregationConfig,
      strategiesCount,
      boundariesCount,
      ksRunsCount,
      step36RunsCount
    })
  });

  return (
    <>
      <Button
        variant={guide.active ? 'contained' : 'outlined'}
        sx={guide.active ? { bgcolor: '#0f172a' } : {}}
        onClick={() => (guide.active ? guide.stop() : guide.start())}
      >
        {guide.active ? 'Exit Guide' : 'Guide Me'}
      </Button>
      <GuideOverlay
        active={guide.active}
        step={guide.currentStep}
        stepIndex={guide.stepIndex}
        stepsCount={guide.stepsCount}
        onSkip={guide.next}
        onStop={guide.stop}
      />
    </>
  );
};

export default Step3GuideController;

