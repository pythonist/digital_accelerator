import React from 'react';
import { Paper, Stack, Typography } from '@mui/material';

import ComparisonSelectionBar from './ComparisonSelectionBar';
import DetailedCompareView from './DetailedCompareView';
import PortfolioCompareView from './PortfolioCompareView';

const CaseComparisonTab = ({
  baseCaseId,
  selectedCaseIds,
  comparisonData,
  comparing,
  onOpenComparison,
  onOpenPair,
}) => (
  <Stack spacing={2.25}>
    <ComparisonSelectionBar
      baseCaseId={baseCaseId}
      selectedCaseIds={selectedCaseIds}
      onCompare={onOpenComparison}
      comparing={comparing}
    />

    {!comparisonData ? (
      <Paper variant="outlined" sx={{ p: 6, borderRadius: 2.5, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#334155' }}>
          Select relevant matches, then compare them here
        </Typography>
        <Typography sx={{ mt: 0.8, fontSize: 13.5, color: '#64748b' }}>
          Detailed Compare is used for two cases. Portfolio Compare is used for three or more cases.
        </Typography>
      </Paper>
    ) : comparisonData.mode === 'detailed' ? (
      <DetailedCompareView data={comparisonData} />
    ) : (
      <PortfolioCompareView data={comparisonData} onOpenPair={onOpenPair} />
    )}
  </Stack>
);

export default CaseComparisonTab;
