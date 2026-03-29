import React, { useMemo } from 'react';
import {
  Box,
  MenuItem,
  Pagination,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import SimilarityControlsPanel from './SimilarityControlsPanel';
import SimilarCaseCard from './SimilarCaseCard';
import ComparisonSelectionBar from './ComparisonSelectionBar';
import { sortSimilarResults } from './retrievalCompareUtils';

const PAGE_SIZE = 5;

const SimilarCasesTab = ({
  controls,
  onControlChange,
  onSearch,
  searching,
  caseOptions,
  results,
  selectedCaseIds,
  onToggleSelected,
  onCompareNow,
  onOpenComparison,
  sortBy,
  onSortChange,
  page,
  onPageChange,
  comparing,
}) => {
  const sortedResults = useMemo(() => sortSimilarResults(results, sortBy), [results, sortBy]);
  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PAGE_SIZE));
  const pagedResults = sortedResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasSelection = selectedCaseIds.length > 0;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '360px 1fr' }, gap: 2.25 }}>
      <SimilarityControlsPanel
        controls={controls}
        onChange={onControlChange}
        onSearch={onSearch}
        searching={searching}
        caseOptions={caseOptions}
      />

      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }}>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Similar Cases</Typography>
              <Typography sx={{ mt: 0.35, fontSize: 12.5, color: '#64748b' }}>
                Ranked case matches show both the score and the specific indicators that drove the match.
              </Typography>
            </Box>
            <TextField select size="small" label="Sort By" value={sortBy} onChange={(event) => onSortChange(event.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="score">Score</MenuItem>
              <MenuItem value="recency">Recency</MenuItem>
              <MenuItem value="risk">Risk</MenuItem>
              <MenuItem value="outcome">Outcome</MenuItem>
            </TextField>
          </Stack>
        </Paper>

        {hasSelection ? (
          <ComparisonSelectionBar
            baseCaseId={controls.baseCaseId}
            selectedCaseIds={selectedCaseIds}
            onCompare={onOpenComparison}
            comparing={comparing}
          />
        ) : null}

        {searching ? (
          <Stack spacing={1.5}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Paper key={`skeleton_${index + 1}`} variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Skeleton variant="text" width="35%" height={28} />
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="rectangular" height={82} sx={{ borderRadius: 2, mt: 1.25 }} />
              </Paper>
            ))}
          </Stack>
        ) : null}

        {!searching && !results.length ? (
          <Paper variant="outlined" sx={{ p: 6, borderRadius: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#334155' }}>
              Find similar cases to begin the comparison workflow
            </Typography>
            <Typography sx={{ mt: 0.9, fontSize: 13.5, color: '#64748b' }}>
              Start with a base case, then review explained matches before choosing cases for detailed comparison.
            </Typography>
          </Paper>
        ) : null}

        {!searching && pagedResults.map((item) => (
          <SimilarCaseCard
            key={item.case_id}
            item={item}
            selected={selectedCaseIds.includes(item.case_id)}
            onToggle={onToggleSelected}
            onCompare={onCompareNow}
          />
        ))}

        {sortedResults.length > PAGE_SIZE ? (
          <Stack direction="row" justifyContent="center">
            <Pagination count={totalPages} page={page} onChange={(_, value) => onPageChange(value)} />
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
};

export default SimilarCasesTab;
