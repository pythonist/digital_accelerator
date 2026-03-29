import React from 'react';
import {
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { formatPercent, formatRisk } from './retrievalCompareUtils';

const PortfolioCompareView = ({ data, onOpenPair }) => (
  <Stack spacing={2.25}>
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Portfolio Insight
      </Typography>
      <Typography sx={{ mt: 0.85, fontSize: 13.5, color: '#1e293b', lineHeight: 1.8 }}>
        {data.portfolio_insight}
      </Typography>
    </Paper>

    <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>Strongest Matching Pairs</Typography>
        <Stack spacing={1} sx={{ mt: 1.25 }}>
          {(data.shared_feature_clusters || []).map((item) => (
            <Stack key={item.pair} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontSize: 12.75, color: '#334155' }}>{item.pair}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label={`${item.score}%`} size="small" color="primary" />
                <Button size="small" variant="outlined" onClick={() => {
                  const [left, right] = item.pair.split(' vs ');
                  onOpenPair(left, right);
                }}>
                  Drill Down
                </Button>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>Outlier Case Flags</Typography>
        <Stack spacing={1} sx={{ mt: 1.25 }}>
          {(data.outlier_case_flags || []).map((item) => (
            <Paper key={item.case_id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
              <Typography sx={{ fontSize: 12.75, fontWeight: 700, color: '#0f172a' }}>{item.case_id}</Typography>
              <Typography sx={{ mt: 0.35, fontSize: 12.5, color: '#475569' }}>{item.reason}</Typography>
            </Paper>
          ))}
        </Stack>
      </Paper>
    </Stack>

    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Case ID</TableCell>
              {(data.case_ids || []).map((caseId) => <TableCell key={`head_${caseId}`} align="center">{caseId}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {(data.comparison_matrix || []).map((row) => (
              <TableRow key={row.case_id}>
                <TableCell sx={{ fontWeight: 800 }}>{row.case_id}</TableCell>
                {(row.comparisons || []).map((cell) => (
                  <TableCell key={`${row.case_id}_${cell.case_id}`} align="center">
                    <Chip label={formatPercent(cell.similarity)} size="small" color={cell.similarity >= 0.8 ? 'success' : cell.similarity >= 0.6 ? 'primary' : 'default'} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>

    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Feature</TableCell>
              {(data.case_ids || []).map((caseId) => <TableCell key={`feature_${caseId}`}>{caseId}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {(data.feature_rows || []).map((row) => (
              <TableRow key={row.feature}>
                <TableCell sx={{ fontWeight: 700 }}>{row.feature}</TableCell>
                {(data.case_ids || []).map((caseId) => (
                  <TableCell key={`${row.feature}_${caseId}`}>
                    {row.feature === 'Risk Score' ? formatRisk(row.values?.[caseId]) : String(row.values?.[caseId] ?? '-')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  </Stack>
);

export default PortfolioCompareView;
